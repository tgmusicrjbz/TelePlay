"""FFmpeg media processing service with durable job state."""
from __future__ import annotations

import asyncio, json, logging, shutil, tempfile, uuid
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
ALL_FORMATS = VIDEO_FORMATS | AUDIO_FORMATS | IMAGE_FORMATS
RUNNING_STATES = {"queued", "preparing", "processing", "saving"}


def _int(value: Any, default: int, low: int, high: int) -> int:
    try: return max(low, min(high, int(value)))
    except (TypeError, ValueError): return default


def _float(value: Any, default: float, low: float, high: float) -> float:
    try: return max(low, min(high, float(value)))
    except (TypeError, ValueError): return default


def output_extension(operation: str, source_type: str, options: dict[str, Any]) -> str:
    requested = str(options.get("format") or "").lower().lstrip(".")
    if operation == "extract_audio": return requested if requested in AUDIO_FORMATS else "mp3"
    if requested in ALL_FORMATS: return requested
    return "mp4" if source_type == "video" else "mp3" if source_type == "audio" else "webp"


def build_ffmpeg_command(operation: str, inputs: list[Path], output: Path, source_type: str, options: dict[str, Any]) -> list[str]:
    """Build a command only from allowlisted values; raw FFmpeg args are never accepted."""
    command = ["ffmpeg", "-hide_banner", "-y", "-progress", "pipe:1", "-nostats"]
    start, end = _float(options.get("start"), 0, 0, 86_400), _float(options.get("end"), 0, 0, 86_400)
    if operation == "merge":
        for path in inputs: command += ["-i", str(path)]
        if source_type == "audio":
            command += ["-filter_complex", "".join(f"[{i}:a]" for i in range(len(inputs))) + f"concat=n={len(inputs)}:v=0:a=1[out]", "-map", "[out]"]
        else:
            command += ["-filter_complex", "".join(f"[{i}:v:0][{i}:a:0]" for i in range(len(inputs))) + f"concat=n={len(inputs)}:v=1:a=1[v][a]", "-map", "[v]", "-map", "[a]"]
    else:
        if start: command += ["-ss", f"{start:.3f}"]
        command += ["-i", str(inputs[0])]
        if end > start: command += ["-t", f"{end-start:.3f}"]
    extension = output.suffix.lower().lstrip(".")
    preset = str(options.get("preset") or "balanced")
    if operation == "extract_audio" or source_type == "audio" or extension in AUDIO_FORMATS:
        command += ["-vn", "-b:a", f"{_int(options.get('audio_bitrate'), 160, 32, 512)}k"]
        if extension == "mp3": command += ["-c:a", "libmp3lame"]
    elif source_type == "image":
        command += ["-frames:v", "1"]
        width, quality = _int(options.get("width"), 0, 0, 16_384), _int(options.get("quality"), 72, 20, 95)
        if width: command += ["-vf", f"scale={width}:-2"]
        if extension in {"jpg", "jpeg"}: command += ["-q:v", str(max(2, round((100-quality)/4)))]
        elif extension == "webp": command += ["-quality", str(quality)]
    else:
        codec = {"h264":"libx264", "h265":"libx265", "av1":"libsvtav1"}.get(str(options.get("codec")), "libx264")
        crf = _int(options.get("crf"), {"smallest":30,"balanced":24,"best":19,"web":25,"social":23}.get(preset,24), 14, 38)
        command += ["-c:v", codec, "-crf", str(crf), "-preset", "fast" if preset == "smallest" else "medium"]
        height, fps = _int(options.get("resolution"),0,0,4320), _int(options.get("fps"),0,0,120)
        filters = ([f"scale=-2:min({height}\\,ih)"] if height else []) + ([f"fps={fps}"] if fps else [])
        if filters: command += ["-vf", ",".join(filters)]
        command += ["-c:a", "aac", "-b:a", f"{_int(options.get('audio_bitrate'),128,32,512)}k"]
        if extension == "mp4": command += ["-movflags", "+faststart"]
    return command + [str(output)]


class MediaStudioManager:
    def __init__(self):
        self.tasks: dict[str, asyncio.Task] = {}; self.processes: dict[str, asyncio.subprocess.Process] = {}
        self.semaphore = asyncio.Semaphore(2)

    @property
    def available(self): return bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))

    async def supported_codecs(self) -> list[str]:
        if not self.available: return []
        process=await asyncio.create_subprocess_exec("ffmpeg","-hide_banner","-encoders",stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.STDOUT)
        output=(await process.communicate())[0].decode(errors="ignore")
        return [label for label,encoder in (("h264","libx264"),("h265","libx265"),("av1","libsvtav1")) if encoder in output]

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
        process = self.processes.get(job_id)
        if process and process.returncode is None: process.terminate()
        task = self.tasks.get(job_id)
        if task and not task.done(): task.cancel()
        await self.update(job_id,"cancelled",0,"پردازش لغو شد.")

    async def probe(self, path: Path):
        process = await asyncio.create_subprocess_exec("ffprobe","-v","error","-show_entries","format=duration,size:stream=width,height,codec_type","-of","json",str(path),stdout=asyncio.subprocess.PIPE)
        stdout,_ = await process.communicate()
        try: return json.loads(stdout or b"{}")
        except json.JSONDecodeError: return {}

    async def run_ffmpeg(self, job_id: str, command: list[str], duration: float):
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
                    output=root/f"{Path(base).stem}.{extension}"; input_probe=await self.probe(inputs[0])
                    duration=float((input_probe.get("format") or {}).get("duration") or sources[0].duration or 0)
                    await self.update(job_id,"processing",20,"پردازش شروع شد…")
                    await self.run_ffmpeg(job_id,build_ffmpeg_command(operation,inputs,output,source_type,options),duration)
                    if not output.exists() or not output.stat().st_size: raise RuntimeError("فایل خروجی ساخته نشد.")
                    await self.update(job_id,"saving",92,"در حال ذخیره خروجی در کمد…")
                    probe=await self.probe(output); target_channel=user.storage_channel_id or settings.telegram_storage_channel_id
                    common={"chat_id":target_channel,"caption":str(payload.get("title") or output.name)[:1024]}
                    if extension in VIDEO_FORMATS: sent=await telegram.tg_client.send_video(video=str(output),supports_streaming=True,**common); media,file_type=sent.video or sent.document,"video"
                    elif extension in AUDIO_FORMATS: sent=await telegram.tg_client.send_audio(audio=str(output),**common); media,file_type=sent.audio or sent.document,"audio"
                    elif extension in IMAGE_FORMATS: sent=await telegram.tg_client.send_photo(photo=str(output),**common); media,file_type=sent.photo,"image"
                    else: sent=await telegram.tg_client.send_document(document=str(output),**common); media,file_type=sent.document,"document"
                    video=next((x for x in probe.get("streams",[]) if x.get("codec_type")=="video"),{})
                    stored=File(user_id=user.id,folder_id=payload.get("folder_id"),file_id=media.file_id,file_unique_id=media.file_unique_id,channel_message_id=sent.id,storage_channel_id=target_channel,file_name=output.name,file_size=output.stat().st_size,mime_type=getattr(media,"mime_type",None),file_type=file_type,duration=round(float((probe.get("format") or {}).get("duration") or 0)) or None,width=video.get("width"),height=video.get("height"),description="ساخته‌شده در استودیوی رسانه")
                    async with async_session() as db: db.add(stored); await db.commit(); await db.refresh(stored)
                    await self.update(job_id,"done",100,"خروجی آماده شد.",{"file_id":stored.id,"file_name":stored.file_name,"file_type":stored.file_type,"size":stored.file_size,"source_size":sum(item.file_size or 0 for item in sources),"stream_url":f"/api/stream/{stored.id}"})
        except asyncio.CancelledError:
            await self.update(job_id,"queued",0,"پس از راه‌اندازی دوباره سرویس ادامه پیدا می‌کند.")
        except Exception as error: logger.exception("Media Studio job failed"); await self.update(job_id,"error",100,f"پردازش انجام نشد: {str(error)[:350]}")
        finally: self.tasks.pop(job_id,None); self.processes.pop(job_id,None)


media_studio=MediaStudioManager()
def new_job_id(): return f"media-{uuid.uuid4().hex}"
