"""Background Gemini TTS queue and audio storage helpers."""
from __future__ import annotations

import asyncio
import base64
from dataclasses import dataclass
from datetime import datetime, timedelta
import io
import json
import logging
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import uuid
import wave

from sqlalchemy import select
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from . import telegram
from .config import get_settings
from .database import async_session
from .models import File, Folder, User
from .services import sanitize_filename, select_best_thumbnail

logger = logging.getLogger(__name__)
settings = get_settings()

DEFAULT_TTS_SETTINGS = {
    "voice": "Kore",
    "style": "طبیعی، گرم و واضح",
    "speed": 1.0,
    "model": settings.gemini_tts_model,
    "auto_expression": True,
}
VOICE_OPTIONS = [
    {"value": "Kore", "label": "Kore · زن، گرم"},
    {"value": "Aoede", "label": "Aoede · زن، روشن"},
    {"value": "Leda", "label": "Leda · زن، جوان"},
    {"value": "Sulafat", "label": "Sulafat · زن، گرم"},
    {"value": "Puck", "label": "Puck · مرد، پرانرژی"},
    {"value": "Charon", "label": "Charon · مرد، رسمی"},
    {"value": "Fenrir", "label": "Fenrir · مرد، پرقدرت"},
    {"value": "Orus", "label": "Orus · مرد، محکم"},
]
TERMINAL_STATES = {"done", "error", "cancelled"}


def normalize_tts_settings(value: dict | None) -> dict:
    raw = {**DEFAULT_TTS_SETTINGS, **(value or {})}
    voices = {item["value"] for item in VOICE_OPTIONS}
    raw["voice"] = raw["voice"] if raw["voice"] in voices else DEFAULT_TTS_SETTINGS["voice"]
    raw["style"] = str(raw.get("style") or DEFAULT_TTS_SETTINGS["style"]).strip()[:500]
    raw["model"] = str(raw.get("model") or settings.gemini_tts_model).strip()[:120]
    raw["speed"] = min(2.0, max(0.5, float(raw.get("speed") or 1)))
    raw["auto_expression"] = bool(raw.get("auto_expression", True))
    return raw


def load_tts_settings(user: User) -> dict:
    try:
        payload = json.loads(user.tts_settings_json or "{}")
    except (TypeError, ValueError):
        payload = {}
    return normalize_tts_settings(payload if isinstance(payload, dict) else {})


def split_long_text(text: str, max_chars: int = 3600) -> list[str]:
    """Split at paragraphs/sentences while preserving every non-space word."""
    cleaned = text.replace("\r\n", "\n").strip()
    if not cleaned:
        return []
    units: list[str] = []
    for paragraph in re.split(r"\n{2,}", cleaned):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        sentences = re.split(r"(?<=[.!?؟؛])\s+", paragraph)
        units.extend(sentence.strip() for sentence in sentences if sentence.strip())
        units.append("\n\n")
    if units and units[-1] == "\n\n":
        units.pop()

    chunks: list[str] = []
    current = ""
    for unit in units:
        separator = "" if not current or unit == "\n\n" else " "
        candidate = current + separator + unit
        if len(candidate) <= max_chars:
            current = candidate
            continue
        if current.strip():
            chunks.append(current.strip())
        current = ""
        while len(unit) > max_chars:
            cut = unit.rfind(" ", 0, max_chars + 1)
            cut = cut if cut > max_chars // 2 else max_chars
            chunks.append(unit[:cut].strip())
            unit = unit[cut:].strip()
        current = unit
    if current.strip():
        chunks.append(current.strip())
    return chunks


def _pcm_to_wav(data: bytes, sample_rate: int = 24000) -> bytes:
    if data.startswith(b"RIFF"):
        return data
    target = io.BytesIO()
    with wave.open(target, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(sample_rate)
        output.writeframes(data)
    return target.getvalue()


def merge_wav(parts: list[bytes]) -> bytes:
    if not parts:
        raise ValueError("No audio chunks were generated")
    output = io.BytesIO()
    params = None
    frames: list[bytes] = []
    for payload in parts:
        with wave.open(io.BytesIO(payload), "rb") as source:
            current = (source.getnchannels(), source.getsampwidth(), source.getframerate())
            if params is None:
                params = current
            if current != params:
                raise ValueError("Generated audio chunks use incompatible formats")
            frames.append(source.readframes(source.getnframes()))
    with wave.open(output, "wb") as target:
        target.setnchannels(params[0])
        target.setsampwidth(params[1])
        target.setframerate(params[2])
        target.writeframes(b"".join(frames))
    return output.getvalue()


class GeminiTTSProvider:
    def __init__(self, api_keys: list[str]) -> None:
        self.api_keys = api_keys
        self.cursor = 0
        self.cooldowns: dict[str, datetime] = {}

    def _ordered_keys(self) -> list[str]:
        if not self.api_keys:
            return []
        now = datetime.utcnow()
        ordered = self.api_keys[self.cursor:] + self.api_keys[:self.cursor]
        ready = [key for key in ordered if self.cooldowns.get(key, datetime.min) <= now]
        return ready or ordered

    async def synthesize(self, text: str, preferences: dict) -> bytes:
        last_error: Exception | None = None
        for key in self._ordered_keys():
            try:
                audio = await self._request(key, text, preferences)
                self.cursor = (self.api_keys.index(key) + 1) % len(self.api_keys)
                return audio
            except GeminiRequestError as error:
                last_error = error
                status = error.status
                if status in {429, 500, 502, 503, 504}:
                    self.cooldowns[key] = datetime.utcnow() + timedelta(seconds=60 if status == 429 else 15)
                    continue
                if status in {400, 401, 403}:
                    logger.warning("Gemini TTS rejected one configured key (%s)", status)
                    self.cooldowns[key] = datetime.utcnow() + timedelta(minutes=10)
                    continue
                raise
            except (TimeoutError, URLError) as error:
                last_error = error
                self.cooldowns[key] = datetime.utcnow() + timedelta(seconds=15)
        raise RuntimeError("هیچ‌کدام از کلیدهای Gemini در حال حاضر پاسخ ندادند.") from last_error

    async def _request(self, key: str, text: str, preferences: dict) -> bytes:
        prompt = text
        style = preferences.get("style", "").strip()
        if style:
            prompt = f"این متن را با این شیوه بخوان: {style}\n\n{text}"
        if preferences.get("auto_expression"):
            prompt = "احساس، مکث و لحن را متناسب با معنای متن و بدون اغراق انتخاب کن.\n" + prompt
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{preferences['model']}:generateContent?{urlencode({'key': key})}"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": preferences["voice"]}}},
            },
        }
        result = await asyncio.to_thread(self._request_sync, endpoint, payload)
        try:
            inline = result["candidates"][0]["content"]["parts"][0]["inlineData"]
            raw = base64.b64decode(inline["data"])
            rate_match = re.search(r"rate=(\d+)", inline.get("mimeType", ""))
            return _pcm_to_wav(raw, int(rate_match.group(1)) if rate_match else 24000)
        except (KeyError, IndexError, TypeError, ValueError) as error:
            raise RuntimeError("پاسخ صوتی معتبری از Gemini دریافت نشد.") from error

    @staticmethod
    def _request_sync(endpoint: str, payload: dict) -> dict:
        request = Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "Komod-TTS/1.0"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=90) as response:
                return json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            try:
                detail = error.read().decode("utf-8")[:1000]
            except Exception:
                detail = str(error)
            raise GeminiRequestError(error.code, detail) from error


class GeminiRequestError(RuntimeError):
    def __init__(self, status: int, detail: str = "") -> None:
        self.status = status
        super().__init__(detail or f"Gemini request failed ({status})")


@dataclass
class TTSJob:
    user_id: int
    telegram_id: int
    text: str
    title: str
    folder_id: int | None
    preferences: dict
    id: str = ""


class TTSQueue:
    def __init__(self, provider: GeminiTTSProvider | None = None) -> None:
        self.provider = provider or GeminiTTSProvider(settings.gemini_api_keys)
        self.queue: asyncio.Queue[TTSJob] = asyncio.Queue()
        self.statuses: dict[str, dict] = {}
        self.controls: dict[str, dict[str, bool]] = {}
        self.task: asyncio.Task | None = None
        self.active_job_id: str | None = None

    @property
    def available(self) -> bool:
        return bool(self.provider.api_keys)

    async def start(self) -> None:
        if not self.available:
            return
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._run(), name="gemini-tts-worker")

    async def stop(self) -> None:
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            self.task = None

    async def enqueue(self, job: TTSJob) -> int:
        if not self.available:
            raise RuntimeError("GEMINI_API_KEYS is not configured")
        await self.start()
        job.id = job.id or uuid.uuid4().hex
        chunks = split_long_text(job.text)
        self.statuses[job.id] = {
            "id": job.id, "user_id": job.user_id, "state": "queued", "message": "در صف ساخت صدا",
            "progress": 0, "chunks_total": len(chunks), "chunks_done": 0,
            "title": job.title, "created_at": datetime.utcnow().isoformat(),
        }
        self.controls[job.id] = {"paused": False, "cancelled": False}
        await self.queue.put(job)
        return self.queue.qsize()

    def status(self, job_id: str, user_id: int) -> dict | None:
        item = self.statuses.get(job_id)
        return dict(item) if item and item["user_id"] == user_id else None

    def list_statuses(self, user_id: int) -> list[dict]:
        return sorted((dict(item) for item in self.statuses.values() if item["user_id"] == user_id), key=lambda item: item["created_at"], reverse=True)[:100]

    def toggle_pause(self, job_id: str, user_id: int) -> dict | None:
        item = self.statuses.get(job_id)
        control = self.controls.get(job_id)
        if not item or item["user_id"] != user_id or not control or item["state"] in TERMINAL_STATES:
            return dict(item) if item and item["user_id"] == user_id else None
        control["paused"] = not control["paused"]
        item.update(state="paused" if control["paused"] else ("synthesizing" if self.active_job_id == job_id else "queued"), message="متوقف شد" if control["paused"] else "ادامه یافت")
        return dict(item)

    def cancel(self, job_id: str, user_id: int) -> dict | None:
        item = self.statuses.get(job_id)
        control = self.controls.get(job_id)
        if not item or item["user_id"] != user_id or not control or item["state"] in TERMINAL_STATES:
            return dict(item) if item and item["user_id"] == user_id else None
        control.update(cancelled=True, paused=False)
        item.update(state="cancelled", message="لغو شد", finished_at=datetime.utcnow().isoformat())
        return dict(item)

    async def _checkpoint(self, job: TTSJob) -> bool:
        control = self.controls[job.id]
        while control["paused"] and not control["cancelled"]:
            await asyncio.sleep(.25)
        return not control["cancelled"]

    async def _run(self) -> None:
        while True:
            job = await self.queue.get()
            try:
                self.active_job_id = job.id
                await self._process(job)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.exception("TTS job %s failed", job.id)
                self.statuses[job.id].update(state="error", message=str(error) or "ساخت صدا انجام نشد.", finished_at=datetime.utcnow().isoformat())
            finally:
                self.active_job_id = None
                self.queue.task_done()

    async def _process(self, job: TTSJob) -> None:
        chunks = split_long_text(job.text)
        parts: list[bytes] = []
        for index, chunk in enumerate(chunks, 1):
            if not await self._checkpoint(job):
                return
            self.statuses[job.id].update(state="synthesizing", message=f"ساخت بخش {index} از {len(chunks)}")
            parts.append(await self.provider.synthesize(chunk, job.preferences))
            self.statuses[job.id].update(chunks_done=index, progress=round(index / len(chunks) * 80))
        if not await self._checkpoint(job):
            return
        self.statuses[job.id].update(state="merging", message="یکپارچه‌سازی صدا", progress=85)
        wav_data = await asyncio.to_thread(merge_wav, parts)
        stored = await self._store(job, wav_data)
        self.statuses[job.id].update(state="done", message="صدا آماده شد", progress=100, file_id=stored.id, finished_at=datetime.utcnow().isoformat())

    async def _store(self, job: TTSJob, wav_data: bytes) -> File:
        with tempfile.TemporaryDirectory(prefix="komod-tts-") as temporary_dir:
            safe_title = sanitize_filename(job.title or "صدای ساخته‌شده")
            wav_path = Path(temporary_dir) / f"{safe_title}.wav"
            ogg_path = Path(temporary_dir) / f"{safe_title}.ogg"
            wav_path.write_bytes(wav_data)
            output_path = wav_path
            is_voice = False
            if shutil.which("ffmpeg"):
                command = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path)]
                speed = float(job.preferences.get("speed", 1))
                if abs(speed - 1) > .01:
                    command.extend(["-filter:a", f"atempo={speed:.2f}"])
                command.extend(["-c:a", "libopus", "-b:a", "48k", str(ogg_path)])
                await asyncio.to_thread(subprocess.run, command, check=True, capture_output=True)
                output_path, is_voice = ogg_path, True

            async with async_session() as db:
                user = await db.get(User, job.user_id)
                if user is None:
                    raise RuntimeError("حساب کاربر پیدا نشد.")
                folder_id = job.folder_id
                if folder_id is None:
                    default_folder = (await db.execute(select(Folder).where(Folder.user_id == user.id, Folder.is_default.is_(True)))).scalar_one_or_none()
                    if default_folder is None:
                        default_folder = Folder(user_id=user.id, name="فایل‌های من", is_default=True)
                        db.add(default_folder)
                        await db.flush()
                    folder_id = default_folder.id
                if folder_id is not None:
                    folder = (await db.execute(select(Folder).where(Folder.id == folder_id, Folder.user_id == user.id))).scalar_one_or_none()
                    if folder is None:
                        raise RuntimeError("کشوی مقصد پیدا نشد.")
                target_channel = user.storage_channel_id or settings.telegram_storage_channel_id
                self.statuses[job.id].update(state="uploading", message="ذخیره در کمد", progress=90)
                if is_voice:
                    message = await telegram.tg_client.send_voice(target_channel, str(output_path), caption=job.title[:1024])
                    media = message.voice
                else:
                    message = await telegram.tg_client.send_audio(target_channel, str(output_path), caption=job.title[:1024])
                    media = message.audio
                if media is None:
                    raise RuntimeError("ذخیره خروجی صوتی در کمد کامل نشد.")
                record = File(
                    user_id=user.id, folder_id=folder_id, file_id=media.file_id,
                    file_unique_id=media.file_unique_id, channel_message_id=message.id,
                    storage_channel_id=target_channel, file_name=output_path.name,
                    description="ساخته‌شده از متن با Gemini TTS", file_size=media.file_size or os.path.getsize(output_path),
                    mime_type=getattr(media, "mime_type", None) or ("audio/ogg" if is_voice else "audio/wav"),
                    file_type="audio", duration=getattr(media, "duration", None),
                    thumbnail_file_id=(select_best_thumbnail(getattr(media, "thumbs", None)).file_id if select_best_thumbnail(getattr(media, "thumbs", None)) else None),
                )
                db.add(record)
                await db.commit()
                await db.refresh(record)
                try:
                    await telegram.tg_client.copy_message(job.telegram_id, target_channel, message.id)
                except Exception:
                    logger.warning("TTS output was saved but could not be copied to user %s", job.telegram_id, exc_info=True)
                return record


tts_queue = TTSQueue()
