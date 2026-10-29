"""FFmpeg media processing service with durable job state."""
from __future__ import annotations

import asyncio, json, logging, mimetypes, os, shutil, tempfile, uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from sqlalchemy import select

from . import telegram
from .config import get_settings
from .database import async_session
from .models import File, ProcessingJob, User
from .services import sanitize_filename
from .telegram import get_message_from_channel

logger = logging.getLogger(__name__)
settings = get_settings()
VIDEO_FORMATS = {"mp4", "mkv", "webm", "mov"}
AUDIO_FORMATS = {"mp3", "m4a", "aac", "wav", "flac", "ogg"}
IMAGE_FORMATS = {"jpg", "jpeg", "png", "webp", "avif"}
RUNNING_STATES = {"queued", "preparing", "processing", "saving"}
CODEC_ENCODERS = {
    "h264": ("libx264",),
    "h265": ("libx265",),
    "vp9": ("libvpx-vp9",),
    "av1": ("libsvtav1", "libaom-av1"),
}
CODEC_COMPATIBILITY = {
    "mp4": ("h264", "h265", "av1"),
    "mov": ("h264", "h265"),
    "mkv": ("h264", "h265", "vp9", "av1"),
    "webm": ("vp9", "av1"),
}
AUDIO_CODEC_COMPATIBILITY = {
    "mp3": {"mp3"},
    "m4a": {"aac", "alac"},
    "aac": {"aac"},
    "wav": {"pcm_s16le", "pcm_s24le", "pcm_s32le", "pcm_f32le", "pcm_f64le"},
    "flac": {"flac"},
    "ogg": {"vorbis", "opus"},
}
CONTAINER_AUDIO_COMPATIBILITY = {
    "mp4": {"aac", "mp3", "alac"},
    "mov": {"aac", "mp3", "alac"},
    "webm": {"opus", "vorbis"},
}


def _executable(name: str) -> str | None:
    configured=os.getenv(f"{name.upper()}_BINARY","").strip()
    candidates=[configured,shutil.which(name),f"/usr/bin/{name}",f"/usr/local/bin/{name}"]
    return next((candidate for candidate in candidates if candidate and Path(candidate).is_file()),None)


def _int(value: Any, default: int, low: int, high: int) -> int:
    try: return max(low, min(high, int(value)))
    except (TypeError, ValueError): return default


def _float(value: Any, default: float, low: float, high: float) -> float:
    try: return max(low, min(high, float(value)))
    except (TypeError, ValueError): return default


def output_extension(operation: str, source_type: str, options: dict[str, Any]) -> str:
    requested = str(options.get("format") or "").lower().lstrip(".")
    if operation == "extract_audio": return requested if requested in AUDIO_FORMATS else "mp3"
    allowed = VIDEO_FORMATS if source_type == "video" else AUDIO_FORMATS if source_type == "audio" else IMAGE_FORMATS
    if requested in allowed: return requested
    return "mp4" if source_type == "video" else "mp3" if source_type == "audio" else "webp"


def _preset_value(options: dict[str, Any], values: dict[str, int], default: int) -> int:
    return values.get(str(options.get("preset") or "balanced"), default)


def _video_codec(extension: str, options: dict[str, Any]) -> tuple[str, str]:
    compatible = CODEC_COMPATIBILITY.get(extension, CODEC_COMPATIBILITY["mp4"])
    requested = str(options.get("codec") or "h264").lower()
    codec = requested if requested in compatible else compatible[0]
    allowed_encoders = CODEC_ENCODERS[codec]
    requested_encoder = str(options.get("_codec_encoder") or "")
    encoder = requested_encoder if requested_encoder in allowed_encoders else allowed_encoders[0]
    return codec, encoder


def _stream(probe: dict[str, Any], kind: str) -> dict[str, Any]:
    return next((item for item in probe.get("streams", []) if item.get("codec_type") == kind), {})


def _normal_video_codec(value: Any) -> str:
    return {"hevc": "h265", "h265": "h265"}.get(str(value or "").lower(), str(value or "").lower())


def _audio_matches(extension: str, codec: Any) -> bool:
    return str(codec or "").lower() in AUDIO_CODEC_COMPATIBILITY.get(extension, set())


def can_stream_copy(operation: str, inputs: list[Path], source_type: str, extension: str,
                    options: dict[str, Any], probes: list[dict[str, Any]]) -> bool:
    """Return true only when FFmpeg can safely avoid decoding and encoding."""
    if not inputs or not probes or source_type == "image" or operation == "compress":
        return False
    if source_type == "video" and (_int(options.get("resolution"), 0, 0, 4320) or _int(options.get("fps"), 0, 0, 120)):
        return False
    if operation == "trim":
        return inputs[0].suffix.lower().lstrip(".") == extension
    if operation == "extract_audio":
        return _audio_matches(extension, _stream(probes[0], "audio").get("codec_name"))
    if operation == "convert":
        if source_type == "audio":
            return _audio_matches(extension, _stream(probes[0], "audio").get("codec_name"))
        video_codec = _normal_video_codec(_stream(probes[0], "video").get("codec_name"))
        requested = str(options.get("codec") or "h264").lower()
        if video_codec != requested or requested not in CODEC_COMPATIBILITY.get(extension, ()):
            return False
        audio_codec = str(_stream(probes[0], "audio").get("codec_name") or "").lower()
        return not audio_codec or extension == "mkv" or audio_codec in CONTAINER_AUDIO_COMPATIBILITY.get(extension, set())
    if operation != "merge" or any(path.suffix.lower().lstrip(".") != extension for path in inputs):
        return False
    if source_type == "audio":
        signatures = [(
            _stream(probe, "audio").get("codec_name"),
            _stream(probe, "audio").get("sample_rate"),
            _stream(probe, "audio").get("channels"),
        ) for probe in probes]
    else:
        signatures = [(
            _stream(probe, "video").get("codec_name"),
            _stream(probe, "video").get("width"),
            _stream(probe, "video").get("height"),
            _stream(probe, "video").get("pix_fmt"),
            _stream(probe, "video").get("avg_frame_rate") or _stream(probe, "video").get("r_frame_rate"),
            _stream(probe, "audio").get("codec_name"),
            _stream(probe, "audio").get("sample_rate"),
            _stream(probe, "audio").get("channels"),
        ) for probe in probes]
    return bool(signatures[0][0]) and all(signature == signatures[0] for signature in signatures[1:])


def build_ffmpeg_command(operation: str, inputs: list[Path], output: Path, source_type: str, options: dict[str, Any]) -> list[str]:
    """Build a command only from allowlisted values; raw FFmpeg args are never accepted."""
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-progress", "pipe:1", "-nostats"]
    start, end = _float(options.get("start"), 0, 0, 86_400), _float(options.get("end"), 0, 0, 86_400)
    if operation == "merge" and options.get("_stream_copy") and options.get("_concat_list"):
        command += ["-f", "concat", "-safe", "0", "-i", str(options["_concat_list"]), "-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy"]
        if output.suffix.lower() == ".mp4": command += ["-movflags", "+faststart"]
        return command + [str(output)]
    if operation == "merge":
        for path in inputs: command += ["-i", str(path)]
        if source_type == "audio":
            chains = [f"[{i}:a:0]aresample=async=1:first_pts=0,asetpts=PTS-STARTPTS[a{i}]" for i in range(len(inputs))]
            chains.append("".join(f"[a{i}]" for i in range(len(inputs))) + f"concat=n={len(inputs)}:v=0:a=1[out]")
            command += ["-filter_complex", ";".join(chains), "-map", "[out]"]
        else:
            profiles = options.get("_merge_profiles") if isinstance(options.get("_merge_profiles"), list) else []
            profiles = profiles if len(profiles) == len(inputs) else [{} for _ in inputs]
            base_width = _int(profiles[0].get("width") if profiles else 0, 0, 0, 7680)
            base_height = _int(profiles[0].get("height") if profiles else 0, 0, 0, 4320)
            target_height = _int(options.get("resolution") or base_height, 0, 0, 4320)
            target_width = _int(options.get("width"), 0, 0, 7680)
            if not target_width and base_width and base_height and target_height:
                target_width = round(base_width * target_height / base_height)
            target_width -= target_width % 2; target_height -= target_height % 2
            target_fps = _int(options.get("fps"), 30, 1, 120) or 30
            has_any_audio = any(bool(profile.get("has_audio", True)) for profile in profiles)
            silence_inputs: dict[int, int] = {}
            if has_any_audio:
                next_input = len(inputs)
                for index, profile in enumerate(profiles):
                    if not bool(profile.get("has_audio", True)):
                        duration = _float(profile.get("duration"), 1, 0.05, 86_400)
                        command += ["-f", "lavfi", "-t", f"{duration:.3f}", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"]
                        silence_inputs[index] = next_input; next_input += 1
            chains: list[str] = []
            for index in range(len(inputs)):
                video_filters = []
                if target_width and target_height:
                    video_filters += [f"scale={target_width}:{target_height}:force_original_aspect_ratio=decrease", f"pad={target_width}:{target_height}:(ow-iw)/2:(oh-ih)/2"]
                video_filters += ["setsar=1", f"fps={target_fps}", "format=yuv420p", "setpts=PTS-STARTPTS"]
                chains.append(f"[{index}:v:0]{','.join(video_filters)}[v{index}]")
                if has_any_audio:
                    audio_input = silence_inputs.get(index, index)
                    chains.append(f"[{audio_input}:a:0]aresample=48000:async=1:first_pts=0,asetpts=PTS-STARTPTS[a{index}]")
            if has_any_audio:
                chains.append("".join(f"[v{i}][a{i}]" for i in range(len(inputs))) + f"concat=n={len(inputs)}:v=1:a=1[v][a]")
                command += ["-filter_complex", ";".join(chains), "-map", "[v]", "-map", "[a]"]
            else:
                chains.append("".join(f"[v{i}]" for i in range(len(inputs))) + f"concat=n={len(inputs)}:v=1:a=0[v]")
                command += ["-filter_complex", ";".join(chains), "-map", "[v]"]
    else:
        if start: command += ["-ss", f"{start:.3f}"]
        command += ["-i", str(inputs[0])]
        if end > start: command += ["-t", f"{end-start:.3f}"]
    extension = output.suffix.lower().lstrip(".")
    if options.get("_stream_copy"):
        if operation == "extract_audio" or source_type == "audio" or extension in AUDIO_FORMATS:
            command += ["-map", "0:a:0", "-vn", "-c:a", "copy"]
        else:
            command += ["-map", "0:v:0?", "-map", "0:a:0?", "-c", "copy"]
        if operation == "trim": command += ["-avoid_negative_ts", "make_zero"]
        if extension == "mp4": command += ["-movflags", "+faststart"]
        return command + [str(output)]
    preset = str(options.get("preset") or "balanced")
    if operation == "extract_audio" or source_type == "audio" or extension in AUDIO_FORMATS:
        bitrate = _int(options.get("audio_bitrate"), 160, 32, 512) if preset == "custom" else _preset_value(options, {"smallest":96,"balanced":160,"best":256,"web":128,"social":128}, 160)
        audio_codec = {"mp3":"libmp3lame", "m4a":"aac", "aac":"aac", "wav":"pcm_s16le", "flac":"flac", "ogg":"libvorbis"}.get(extension, "aac")
        command += ["-vn", "-c:a", audio_codec]
        if extension not in {"wav", "flac"}: command += ["-b:a", f"{bitrate}k"]
    elif source_type == "image":
        command += ["-frames:v", "1"]
        size = _int(options.get("resolution") or options.get("width"), 0, 0, 16_384)
        quality = _int(options.get("quality"), 72, 20, 95) if preset == "custom" else _preset_value(options, {"smallest":48,"balanced":72,"best":92,"web":76,"social":82}, 72)
        if size: command += ["-vf", f"scale=min({size}\\,iw):-2"]
        if extension in {"jpg", "jpeg"}: command += ["-c:v", "mjpeg", "-q:v", str(max(2, round((100-quality)/4)))]
        elif extension == "webp": command += ["-c:v", "libwebp", "-quality", str(quality)]
        elif extension == "png": command += ["-c:v", "png", "-compression_level", str(max(1, min(9, round((100-quality)/10))))]
        elif extension == "avif": command += ["-c:v", "libaom-av1", "-still-picture", "1", "-crf", str(max(14, round(50-quality*.36))), "-b:v", "0"]
    else:
        codec, encoder = _video_codec(extension, options)
        quality = _int(options.get("quality"), 72, 20, 95)
        crf = max(14, min(38, round(51-quality*.39))) if preset == "custom" else _preset_value(options, {"smallest":30,"balanced":24,"best":19,"web":25,"social":23}, 24)
        if codec in {"vp9", "av1"}: crf = min(45, crf + 7)
        command += ["-c:v", encoder, "-crf", str(crf)]
        if encoder in {"libx264", "libx265"}: command += ["-preset", "veryfast" if preset == "smallest" else "medium" if preset == "best" else "fast"]
        elif encoder == "libvpx-vp9": command += ["-b:v", "0", "-deadline", "good", "-cpu-used", "7" if preset == "smallest" else "4" if preset == "best" else "5"]
        elif encoder == "libsvtav1": command += ["-preset", "11" if preset == "smallest" else "7" if preset == "best" else "9"]
        elif encoder == "libaom-av1": command += ["-b:v", "0", "-cpu-used", "8" if preset == "smallest" else "5" if preset == "best" else "7"]
        height, fps = _int(options.get("resolution"),0,0,4320), _int(options.get("fps"),0,0,120)
        filters = ([f"scale=-2:min({height}\\,ih)"] if height else []) + ([f"fps={fps}"] if fps else [])
        if filters: command += ["-vf", ",".join(filters)]
        bitrate = _int(options.get("audio_bitrate"), 128, 32, 512) if preset == "custom" else _preset_value(options, {"smallest":96,"balanced":128,"best":192,"web":128,"social":128}, 128)
        command += ["-c:a", "libopus" if extension == "webm" else "aac", "-b:a", f"{bitrate}k"]
        if codec == "h265" and extension in {"mp4", "mov"}: command += ["-tag:v", "hvc1"]
        if extension == "mp4": command += ["-movflags", "+faststart"]
    return command + [str(output)]


class MediaStudioManager:
    def __init__(self):
        self.tasks: dict[str, asyncio.Task] = {}; self.processes: dict[str, asyncio.subprocess.Process] = {}
        self.user_cancellations: set[str] = set()
        self.max_concurrent = _int(os.getenv("MEDIA_STUDIO_CONCURRENCY"), 1, 1, 4)
        self.semaphore = asyncio.Semaphore(self.max_concurrent)
        self.ffmpeg=_executable("ffmpeg"); self.ffprobe=_executable("ffprobe")
        self._codec_encoders: dict[str, str] | None = None
        self._capability_task: asyncio.Task | None = None

    @property
    def available(self): return bool(self.ffmpeg and self.ffprobe)

    async def supported_codec_encoders(self) -> dict[str, str]:
        if not self.available: return {}
        if self._codec_encoders is not None: return dict(self._codec_encoders)
        process: asyncio.subprocess.Process | None = None
        try:
            process=await asyncio.create_subprocess_exec(self.ffmpeg,"-hide_banner","-encoders",stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
            output=(await asyncio.wait_for(process.communicate(),timeout=8))[0].decode(errors="ignore")
        except Exception:
            if process and process.returncode is None:
                process.kill()
                await process.wait()
            logger.warning("FFmpeg codec detection failed",exc_info=True)
            return {}
        self._codec_encoders = {
            label: next((encoder for encoder in encoders if encoder in output), "")
            for label, encoders in CODEC_ENCODERS.items()
        }
        self._codec_encoders = {label: encoder for label, encoder in self._codec_encoders.items() if encoder}
        return dict(self._codec_encoders)

    def cached_supported_codecs(self) -> list[str]:
        if not self.available: return []
        return list(self._codec_encoders.keys()) if self._codec_encoders is not None else list(CODEC_ENCODERS.keys())

    def warm_capabilities(self) -> None:
        if not self.available or self._codec_encoders is not None: return
        if not self._capability_task or self._capability_task.done():
            self._capability_task=asyncio.create_task(self.supported_codec_encoders(),name="media-capabilities")

    async def supported_codecs(self) -> list[str]:
        return list((await self.supported_codec_encoders()).keys())

    def start(self, job_id: str):
        if not self.tasks.get(job_id) or self.tasks[job_id].done():
            self.tasks[job_id] = asyncio.create_task(self._run(job_id), name=f"media-{job_id[:8]}")

    async def recover(self):
        """Resume jobs interrupted by a deploy or worker restart."""
        async with async_session() as db:
            jobs=list((await db.execute(select(ProcessingJob).where(ProcessingJob.kind=="media_studio",ProcessingJob.state.in_(RUNNING_STATES)))).scalars())
            for job in jobs: job.state,job.progress,job.message="queued",0,"از سرگیری پس از راه‌اندازی سرویس"
            await db.commit()
        for job in jobs: self.start(job.id)

    async def stop(self):
        tasks=list(self.tasks.values())
        for process in self.processes.values():
            if process.returncode is None: process.terminate()
        for task in tasks: task.cancel()
        if tasks: await asyncio.gather(*tasks,return_exceptions=True)

    async def update(self, job_id: str, state: str, progress: int, message: str, result: dict | None = None):
        async with async_session() as db:
            job = await db.get(ProcessingJob, job_id)
            if not job: return
            job.state, job.progress, job.message = state, max(0,min(100,progress)), message
            if result is not None: job.result_json = json.dumps(result, ensure_ascii=False)
            if state in {"done","error","cancelled"}: job.finished_at = datetime.utcnow()
            await db.commit()

    async def cancel(self, job_id: str):
        self.user_cancellations.add(job_id)
        process = self.processes.get(job_id)
        if process and process.returncode is None: process.terminate()
        task = self.tasks.get(job_id)
        if task and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        await self.update(job_id,"cancelled",0,"پردازش لغو شد.")

    async def probe(self, path: Path):
        process = await asyncio.create_subprocess_exec(self.ffprobe,"-v","error","-show_entries","format=duration,size:stream=width,height,codec_type,codec_name,pix_fmt,avg_frame_rate,r_frame_rate,sample_rate,channels,channel_layout","-of","json",str(path),stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
        stdout,stderr = await process.communicate()
        if process.returncode:
            logger.warning("Media Studio probe failed for %s: %s", path.name, stderr.decode(errors="ignore")[-500:])
            return {}
        try: return json.loads(stdout or b"{}")
        except json.JSONDecodeError: return {}

    async def run_ffmpeg(self, job_id: str, command: list[str], duration: float):
        command[0]=self.ffmpeg or command[0]
        process = await asyncio.create_subprocess_exec(*command,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
        self.processes[job_id] = process; last = 20
        assert process.stdout is not None
        while line := await process.stdout.readline():
            key,_,raw = line.decode(errors="ignore").strip().partition("=")
            if key in {"out_time_ms","out_time_us"} and duration:
                progress=min(88,20+round((float(raw or 0)/1_000_000)/duration*68))
                if progress>=last+2: last=progress; await self.update(job_id,"processing",progress,"در حال پردازش رسانه…")
        stderr=(await process.stderr.read()).decode(errors="ignore") if process.stderr else ""
        if await process.wait(): raise RuntimeError(stderr.strip().splitlines()[-1] if stderr.strip() else "خطای FFmpeg")

    async def _run(self, job_id: str):
        try:
            async with self.semaphore:
                async with async_session() as db:
                    job=await db.get(ProcessingJob,job_id); payload=json.loads(job.payload_json or "{}") if job else {}
                    user=await db.get(User,job.user_id) if job else None
                    rows=list((await db.execute(select(File).where(File.id.in_(payload.get("file_ids",[])),File.user_id==job.user_id))).scalars()) if job else []
                by_id={item.id:item for item in rows}; sources=[by_id.get(i) for i in payload.get("file_ids",[])]
                if not user or not sources or any(item is None for item in sources): raise ValueError("یکی از فایل‌های ورودی پیدا نشد.")
                await self.update(job_id,"preparing",5,"در حال دریافت فایل‌ها…")
                with tempfile.TemporaryDirectory(prefix="komod-studio-") as directory:
                    root=Path(directory); inputs=[]
                    for index,source in enumerate(sources):
                        message=await get_message_from_channel(source.channel_message_id,source.storage_channel_id)
                        target=root/f"input-{index}{Path(source.file_name).suffix or '.bin'}"
                        downloaded=await telegram.tg_client.download_media(message,file_name=str(target))
                        if not downloaded: raise RuntimeError("دریافت فایل از فضای ذخیره‌سازی انجام نشد.")
                        inputs.append(Path(downloaded)); await self.update(job_id,"preparing",8+round((index+1)/len(sources)*10),"در حال آماده‌سازی ورودی‌ها…")
                    operation,options=payload["operation"],payload.get("options") or {}; source_type=sources[0].file_type
                    extension=output_extension(operation,source_type,options); base=sanitize_filename(str(payload.get("title") or sources[0].file_name))
                    output=root/f"{Path(base).stem}.{extension}"; input_probes=await asyncio.gather(*(self.probe(path) for path in inputs))
                    durations=[float((probe.get("format") or {}).get("duration") or source.duration or 0) for probe,source in zip(input_probes,sources)]
                    duration=sum(durations) if operation=="merge" else durations[0]
                    if source_type=="video":
                        codec_encoders=await self.supported_codec_encoders(); requested_codec=str(options.get("codec") or "h264")
                        if requested_codec in codec_encoders: options["_codec_encoder"]=codec_encoders[requested_codec]
                    if operation=="merge" and source_type=="video":
                        options["_merge_profiles"]=[{
                            "width":next((stream.get("width") for stream in probe.get("streams",[]) if stream.get("codec_type")=="video"),0),
                            "height":next((stream.get("height") for stream in probe.get("streams",[]) if stream.get("codec_type")=="video"),0),
                            "has_audio":any(stream.get("codec_type")=="audio" for stream in probe.get("streams",[])),
                            "duration":item_duration,
                        } for probe,item_duration in zip(input_probes,durations)]
                    fast_copy=can_stream_copy(operation,inputs,source_type,extension,options,input_probes)
                    if fast_copy:
                        options["_stream_copy"]=True
                        if operation=="merge":
                            concat_list=root/"concat.txt"
                            concat_list.write_text("".join(f"file '{path.as_posix()}'\n" for path in inputs),encoding="utf-8")
                            options["_concat_list"]=str(concat_list)
                    await self.update(job_id,"processing",20,"پردازش سریع بدون تبدیل دوباره…" if fast_copy else "پردازش شروع شد…")
                    try:
                        await self.run_ffmpeg(job_id,build_ffmpeg_command(operation,inputs,output,source_type,options),duration)
                    except RuntimeError:
                        if not fast_copy: raise
                        logger.info("Media Studio stream-copy fallback for job %s", job_id)
                        output.unlink(missing_ok=True); options.pop("_stream_copy",None); options.pop("_concat_list",None)
                        await self.update(job_id,"processing",20,"مسیر سریع سازگار نبود؛ پردازش معمولی شروع شد…")
                        await self.run_ffmpeg(job_id,build_ffmpeg_command(operation,inputs,output,source_type,options),duration)
                    if not output.exists() or not output.stat().st_size: raise RuntimeError("فایل خروجی ساخته نشد.")
                    await self.update(job_id,"saving",92,"در حال ذخیره خروجی در کمد…")
                    probe=await self.probe(output); target_channel=user.storage_channel_id or settings.telegram_storage_channel_id
                    common={"chat_id":target_channel,"caption":str(payload.get("title") or output.name)[:1024],"parse_mode":None}
                    file_type="video" if extension in VIDEO_FORMATS else "audio" if extension in AUDIO_FORMATS else "image" if extension in IMAGE_FORMATS else "document"
                    try:
                        if file_type=="video": sent=await telegram.tg_client.send_video(video=str(output),supports_streaming=True,**common)
                        elif file_type=="audio": sent=await telegram.tg_client.send_audio(audio=str(output),**common)
                        elif file_type=="image": sent=await telegram.tg_client.send_document(document=str(output),**common)
                        else: sent=await telegram.tg_client.send_document(document=str(output),**common)
                    except Exception:
                        logger.exception("Typed Media Studio upload failed; retrying as document")
                        sent=await telegram.tg_client.send_document(document=str(output),**common)
                    media=sent.video or sent.audio or sent.photo or sent.document
                    if media is None: raise RuntimeError("تلگرام فایل خروجی را برنگرداند.")
                    video=next((x for x in probe.get("streams",[]) if x.get("codec_type")=="video"),{})
                    stored=File(user_id=user.id,folder_id=payload.get("folder_id"),file_id=media.file_id,file_unique_id=media.file_unique_id,channel_message_id=sent.id,storage_channel_id=target_channel,file_name=output.name,file_size=getattr(media,"file_size",None) or output.stat().st_size,mime_type=getattr(media,"mime_type",None) or mimetypes.guess_type(output.name)[0],file_type=file_type,duration=round(float((probe.get("format") or {}).get("duration") or 0)) or None,width=video.get("width"),height=video.get("height"),description="ساخته‌شده در استودیوی رسانه")
                    async with async_session() as db: db.add(stored); await db.commit(); await db.refresh(stored)
                    await self.update(job_id,"done",100,"خروجی آماده شد.",{"file_id":stored.id,"file_name":stored.file_name,"file_type":stored.file_type,"size":stored.file_size,"source_size":sum(item.file_size or 0 for item in sources),"stream_url":f"/api/stream/{stored.id}"})
        except asyncio.CancelledError:
            if job_id in self.user_cancellations: await self.update(job_id,"cancelled",0,"پردازش لغو شد.")
            else: await self.update(job_id,"queued",0,"پس از راه‌اندازی دوباره سرویس ادامه پیدا می‌کند.")
        except Exception as error:
            logger.exception("Media Studio job failed")
            message=str(error)
            friendly=message if any(token in message for token in ("پیدا نشد","انجام نشد","برنگرداند")) else "پردازش رسانه انجام نشد. فرمت فایل یا تنظیمات خروجی را بررسی کن."
            await self.update(job_id,"error",100,friendly[:350])
        finally:
            self.tasks.pop(job_id,None); self.processes.pop(job_id,None); self.user_cancellations.discard(job_id)


media_studio=MediaStudioManager()
def new_job_id(): return f"media-{uuid.uuid4().hex}"
