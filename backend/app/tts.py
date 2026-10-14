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
from .models import File, Folder, TTSUsage, User
from .services import sanitize_filename, select_best_thumbnail

logger = logging.getLogger(__name__)
settings = get_settings()

DEFAULT_TTS_SETTINGS = {
    "voice": "Kore",
    "gender": "all",
    "pitch": "all",
    "use_case": "general",
    "style": "طبیعی، گرم و واضح",
    "speed": 1.0,
    "model": settings.gemini_tts_model,
    "auto_expression": True,
    "folder_id": None,
    "bot_output_mode": "save",
}
VOICE_OPTIONS = [
    {"value": "Kore", "label": "🌷 Kore · گرم و متعادل", "description": "صدایی گرم برای روایت، آموزش و متن‌های روزمره", "gender": "female", "pitch": "medium"},
    {"value": "Aoede", "label": "✨ Aoede · روشن و لطیف", "description": "مناسب متن‌های دوستانه، معرفی و محتوای سبک", "gender": "female", "pitch": "high"},
    {"value": "Leda", "label": "🌱 Leda · جوان و روان", "description": "برای گفتگو، داستان کوتاه و محتوای شبکه‌های اجتماعی", "gender": "female", "pitch": "high"},
    {"value": "Sulafat", "label": "🌙 Sulafat · آرام و عمیق", "description": "برای کتاب صوتی، آرامش و روایت‌های احساسی", "gender": "female", "pitch": "low"},
    {"value": "Puck", "label": "⚡ Puck · پرانرژی", "description": "برای تبلیغ، سرگرمی و متن‌های هیجان‌انگیز", "gender": "male", "pitch": "high"},
    {"value": "Charon", "label": "🎙️ Charon · رسمی و شمرده", "description": "برای خبر، مستند، گزارش و محتوای رسمی", "gender": "male", "pitch": "low"},
    {"value": "Fenrir", "label": "🔥 Fenrir · قدرتمند", "description": "برای روایت حماسی، تریلر و اجرای پرقدرت", "gender": "male", "pitch": "low"},
    {"value": "Orus", "label": "🧭 Orus · محکم و واضح", "description": "برای آموزش، پادکست و توضیح‌های فنی", "gender": "male", "pitch": "medium"},
]
TERMINAL_STATES = {"done", "error", "cancelled"}
USE_CASE_STYLES = {
    "general": "طبیعی و روان",
    "audiobook": "روایت پیوسته و مناسب کتاب صوتی",
    "podcast": "صمیمی و مناسب پادکست",
    "story": "داستانی و تصویرساز",
    "education": "آموزشی، روشن و شمرده",
    "news": "رسمی، دقیق و مناسب خبر",
    "advertising": "پرانرژی و مناسب معرفی محصول",
    "accessibility": "بسیار واضح، آرام و دسترس‌پذیر",
}
SCOPED_STYLE_TAGS = {
    "whisper": "با صدای نجوا و بسیار آرام",
    "soft": "نرم و آرام",
    "excited": "هیجان‌زده و پرانرژی",
    "sad": "غمگین و احساسی",
    "angry": "عصبانی اما واضح و کنترل‌شده",
    "formal": "رسمی و شمرده",
    "story": "داستانی و تصویرساز",
}


def normalize_tts_settings(value: dict | None) -> dict:
    raw = {**DEFAULT_TTS_SETTINGS, **(value or {})}
    voices = {item["value"] for item in VOICE_OPTIONS}
    raw["voice"] = raw["voice"] if raw["voice"] in voices else DEFAULT_TTS_SETTINGS["voice"]
    raw["style"] = str(raw.get("style") or DEFAULT_TTS_SETTINGS["style"]).strip()[:500]
    raw["model"] = str(raw.get("model") or settings.gemini_tts_model).strip()[:120]
    if raw["model"] == "gemini-2.5-flash-preview-tts":
        raw["model"] = "gemini-3.8-flash-tts"
    raw["speed"] = min(2.0, max(0.5, float(raw.get("speed") or 1)))
    raw["auto_expression"] = bool(raw.get("auto_expression", True))
    raw["gender"] = raw.get("gender") if raw.get("gender") in {"all", "female", "male"} else DEFAULT_TTS_SETTINGS["gender"]
    raw["pitch"] = raw.get("pitch") if raw.get("pitch") in {"all", "low", "medium", "high"} else DEFAULT_TTS_SETTINGS["pitch"]
    raw["use_case"] = raw.get("use_case") if raw.get("use_case") in USE_CASE_STYLES else DEFAULT_TTS_SETTINGS["use_case"]
    try:
        raw["folder_id"] = int(raw["folder_id"]) if raw.get("folder_id") is not None else None
    except (TypeError, ValueError):
        raw["folder_id"] = None
    raw["bot_output_mode"] = raw.get("bot_output_mode") if raw.get("bot_output_mode") in {"save", "telegram"} else "save"
    return raw


async def consume_tts_quota(db, user_id: int, character_count: int) -> TTSUsage:
    """Validate and atomically account for an accepted TTS request."""
    today = datetime.utcnow().date()
    usage = await db.get(TTSUsage, user_id)
    if usage is None:
        usage = TTSUsage(user_id=user_id, usage_date=today)
        db.add(usage)
        await db.flush()
    if usage.usage_date != today:
        usage.usage_date = today
        usage.used_today = 0
        usage.stt_used_today = 0
    if character_count > usage.max_chars:
        raise ValueError(f"طول متن از سقف {to_persian_digits(usage.max_chars)} نویسه بیشتر است.")
    if usage.daily_limit and usage.used_today >= usage.daily_limit:
        raise ValueError("سهمیه روزانه ساخت صدا برای این حساب تمام شده است.")
    usage.used_today += 1
    usage.total_jobs += 1
    usage.total_chars += character_count
    await db.commit()
    return usage


def build_interaction_content(text: str, base_style: str) -> list[dict]:
    """Turn paired style tags into scoped Gemini speech metadata.

    Point cues such as ``<laugh>`` stay inside the text unchanged. Paired
    tags such as ``<whisper>...</whisper>`` only affect their enclosed text.
    """
    tag_pattern = re.compile(
        r"<(whisper|soft|excited|sad|angry|formal|story)>(.*?)</\1>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    content: list[dict] = []
    cursor = 0

    after_scoped_segment = False

    def append_part(value: str, scoped_style: str | None = None) -> None:
        nonlocal after_scoped_segment
        if not value:
            return
        part: dict = {"type": "text", "text": value}
        styles = [item for item in (base_style, scoped_style) if item]
        if styles:
            part["annotations"] = [{"type": "speech_metadata", "style": "؛ ".join(styles)}]
        if after_scoped_segment and scoped_style is None:
            part.setdefault("annotations", []).append({
                "type": "speech_metadata",
                "style": "لحن بخش قبلی تمام شده است؛ از همین بخش دقیقاً به لحن پایه برگرد",
            })
        content.append(part)
        after_scoped_segment = scoped_style is not None

    for match in tag_pattern.finditer(text):
        append_part(text[cursor:match.start()])
        append_part(match.group(2), SCOPED_STYLE_TAGS[match.group(1).lower()])
        cursor = match.end()
    append_part(text[cursor:])
    return content or [{"type": "text", "text": text}]


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


def extract_interaction_audio(result: dict) -> tuple[bytes, str]:
    """Extract audio from raw Interactions REST responses.

    ``output_audio`` is an SDK convenience property. The REST endpoint usually
    returns the same block nested in ``steps[].content[]`` instead.
    """
    interaction = result.get("interaction", result) if isinstance(result, dict) else {}
    direct = interaction.get("output_audio") or interaction.get("outputAudio")
    candidates: list[dict] = [direct] if isinstance(direct, dict) else []

    outputs = interaction.get("outputs")
    if isinstance(outputs, list):
        candidates.extend(item for item in reversed(outputs) if isinstance(item, dict))

    steps = interaction.get("steps")
    if isinstance(steps, list):
        for step in reversed(steps):
            if not isinstance(step, dict):
                continue
            content = step.get("content") or step.get("outputs")
            if isinstance(content, dict):
                content = [content]
            if isinstance(content, list):
                candidates.extend(item for item in reversed(content) if isinstance(item, dict))

    for item in candidates:
        content_type = str(item.get("type") or "").lower()
        if content_type and content_type not in {"audio", "audio_content"}:
            continue
        data = item.get("data")
        if not isinstance(data, str) or not data:
            inline = item.get("inline_data") or item.get("inlineData")
            if isinstance(inline, dict):
                data = inline.get("data")
                item = {**item, **inline}
        if isinstance(data, str) and data:
            try:
                return base64.b64decode(data, validate=True), str(item.get("mime_type") or item.get("mimeType") or "audio/wav")
            except (ValueError, TypeError) as error:
                raise RuntimeError("داده صوتی Gemini قابل خواندن نبود.") from error

    status = interaction.get("status")
    errors = interaction.get("errors")
    logger.warning(
        "Gemini interaction contained no audio (status=%s, keys=%s, errors=%s)",
        status,
        sorted(interaction.keys()) if isinstance(interaction, dict) else [],
        errors,
    )
    if errors:
        raise RuntimeError("Gemini ساخت صدا را کامل نکرد؛ جزئیات خطا در گزارش سرور ثبت شد.")
    raise RuntimeError("پاسخ Gemini کامل بود، اما داده صوتی در آن پیدا نشد.")


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
        self._key_lock = asyncio.Lock()

    def _ordered_keys(self) -> list[str]:
        if not self.api_keys:
            return []
        now = datetime.utcnow()
        ordered = self.api_keys[self.cursor:] + self.api_keys[:self.cursor]
        ready = [key for key in ordered if self.cooldowns.get(key, datetime.min) <= now]
        return ready or ordered

    async def synthesize(self, text: str, preferences: dict) -> bytes:
        last_error: Exception | None = None
        async with self._key_lock:
            ordered_keys = self._ordered_keys()
            if ordered_keys:
                self.cursor = (self.api_keys.index(ordered_keys[0]) + 1) % len(self.api_keys)
        for key in ordered_keys:
            try:
                audio = await self._request(key, text, preferences)
                self.cursor = (self.api_keys.index(key) + 1) % len(self.api_keys)
                return audio
            except GeminiRequestError as error:
                last_error = error
                status = error.status
                if status == 400:
                    detail = error.user_detail()
                    raise RuntimeError(f"متن یا تنظیمات صدا پذیرفته نشد: {detail}") from error
                if status in {429, 500, 502, 503, 504}:
                    self.cooldowns[key] = datetime.utcnow() + timedelta(seconds=60 if status == 429 else 15)
                    continue
                if status in {401, 403}:
                    logger.warning("Gemini TTS rejected one configured key (%s)", status)
                    self.cooldowns[key] = datetime.utcnow() + timedelta(minutes=10)
                    continue
                raise
            except (TimeoutError, URLError) as error:
                last_error = error
                self.cooldowns[key] = datetime.utcnow() + timedelta(seconds=15)
        raise RuntimeError("هیچ‌کدام از کلیدهای Gemini در حال حاضر پاسخ ندادند.") from last_error

    async def _request(self, key: str, text: str, preferences: dict) -> bytes:
        style = preferences.get("style", "").strip()
        use_case_style = USE_CASE_STYLES.get(preferences.get("use_case", "general"), "")
        if use_case_style:
            style = f"{style}؛ {use_case_style}".strip("؛ ")
        if preferences.get("auto_expression"):
            style = f"{style}؛ احساس، مکث و لحن را متناسب با معنای متن و بدون اغراق انتخاب کن".strip("؛ ")
        model = preferences["model"]
        if model.startswith("gemini-3.8-"):
            endpoint = f"https://generativelanguage.googleapis.com/v1beta/interactions?{urlencode({'key': key})}"
            payload = {
                "model": model,
                "input": [{"type": "user_input", "content": build_interaction_content(text, style)}],
                "response_format": {"type": "audio"},
                "generation_config": {"speech_config": [{"voice": preferences["voice"]}]},
            }
            result = await asyncio.to_thread(self._request_sync, endpoint, payload)
            raw, mime_type = extract_interaction_audio(result)
            rate_match = re.search(r"rate=(\d+)", mime_type)
            return _pcm_to_wav(raw, int(rate_match.group(1)) if rate_match else 24000)

        prompt = f"این متن را با این شیوه بخوان: {style}\n\n{text}" if style else text
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?{urlencode({'key': key})}"
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
        self.detail = detail
        super().__init__(detail or f"Gemini request failed ({status})")

    def user_detail(self) -> str:
        try:
            payload = json.loads(self.detail)
            message = payload.get("error", {}).get("message")
            if message:
                return str(message)[:350]
        except (TypeError, ValueError, AttributeError):
            pass
        return "تگ‌ها، متن یا تنظیمات انتخاب‌شده با این مدل سازگار نیستند."


def to_persian_digits(value: object) -> str:
    return str(value).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))


@dataclass
class TTSJob:
    user_id: int
    telegram_id: int
    text: str
    title: str
    folder_id: int | None
    preferences: dict
    output_mode: str = "save"
    api_keys: list[str] | None = None
    id: str = ""


class TTSQueue:
    def __init__(self, provider: GeminiTTSProvider | None = None) -> None:
        self.provider = provider or GeminiTTSProvider(settings.gemini_api_keys)
        self.queue: asyncio.Queue[TTSJob] = asyncio.Queue()
        self.statuses: dict[str, dict] = {}
        self.controls: dict[str, dict[str, bool]] = {}
        self.audio_outputs: dict[str, bytes] = {}
        self.task: asyncio.Task | None = None
        self.tasks: list[asyncio.Task] = []
        self.active_job_ids: set[str] = set()

    @property
    def available(self) -> bool:
        return bool(self.provider.api_keys)

    async def start(self) -> None:
        if not self.available:
            return
        if not any(not task.done() for task in self.tasks):
            worker_count = min(4, max(1, len(self.provider.api_keys)))
            self.tasks = [asyncio.create_task(self._run(), name=f"gemini-tts-worker-{index + 1}") for index in range(worker_count)]
            self.task = self.tasks[0]

    async def stop(self) -> None:
        for task in self.tasks:
            task.cancel()
        if self.tasks:
            await asyncio.gather(*self.tasks, return_exceptions=True)
        self.tasks = []
        self.task = None

    async def enqueue(self, job: TTSJob) -> int:
        if not self.available and not job.api_keys:
            raise RuntimeError("GEMINI_API_KEYS is not configured")
        if job.api_keys and not self.available and not any(not task.done() for task in self.tasks):
            worker_count = min(4, len(job.api_keys))
            self.tasks = [asyncio.create_task(self._run(), name=f"gemini-tts-worker-{index + 1}") for index in range(worker_count)]
            self.task = self.tasks[0]
        else:
            await self.start()
        job.id = job.id or uuid.uuid4().hex
        chunks = split_long_text(job.text)
        self.statuses[job.id] = {
            "id": job.id, "user_id": job.user_id, "state": "queued", "message": "منتظر نوبت",
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
        self._prune_finished()
        return sorted((dict(item) for item in self.statuses.values() if item["user_id"] == user_id), key=lambda item: item["created_at"], reverse=True)[:100]

    def _prune_finished(self, max_age: timedelta = timedelta(minutes=5)) -> None:
        cutoff = datetime.utcnow() - max_age
        for job_id, item in list(self.statuses.items()):
            finished_at = item.get("finished_at")
            if item.get("state") not in TERMINAL_STATES or not finished_at:
                continue
            try:
                expired = datetime.fromisoformat(finished_at) < cutoff
            except (TypeError, ValueError):
                expired = True
            if expired:
                self.statuses.pop(job_id, None)
                self.controls.pop(job_id, None)
                self.audio_outputs.pop(job_id, None)

    def dismiss(self, job_id: str, user_id: int) -> bool:
        item = self.statuses.get(job_id)
        if not item or item["user_id"] != user_id or item["state"] not in TERMINAL_STATES:
            return False
        self.statuses.pop(job_id, None)
        self.controls.pop(job_id, None)
        self.audio_outputs.pop(job_id, None)
        return True

    def clear_finished(self, user_id: int) -> int:
        job_ids = [job_id for job_id, item in self.statuses.items() if item["user_id"] == user_id and item["state"] in TERMINAL_STATES]
        for job_id in job_ids:
            self.statuses.pop(job_id, None)
            self.controls.pop(job_id, None)
            self.audio_outputs.pop(job_id, None)
        return len(job_ids)

    def toggle_pause(self, job_id: str, user_id: int) -> dict | None:
        item = self.statuses.get(job_id)
        control = self.controls.get(job_id)
        if not item or item["user_id"] != user_id or not control or item["state"] in TERMINAL_STATES:
            return dict(item) if item and item["user_id"] == user_id else None
        control["paused"] = not control["paused"]
        item.update(state="paused" if control["paused"] else ("synthesizing" if job_id in self.active_job_ids else "queued"), message="متوقف شد" if control["paused"] else "ادامه یافت")
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
                self.active_job_ids.add(job.id)
                await self._process(job)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.exception("TTS job %s failed", job.id)
                self.statuses[job.id].update(state="error", message=str(error) or "ساخت صدا انجام نشد.", finished_at=datetime.utcnow().isoformat())
            finally:
                self.active_job_ids.discard(job.id)
                self.queue.task_done()

    async def _process(self, job: TTSJob) -> None:
        provider = GeminiTTSProvider(list(dict.fromkeys((job.api_keys or []) + self.provider.api_keys))) if job.api_keys else self.provider
        chunks = split_long_text(job.text)
        parts: list[bytes] = []
        for index, chunk in enumerate(chunks, 1):
            if not await self._checkpoint(job):
                return
            self.statuses[job.id].update(state="synthesizing", message=f"بخش {to_persian_digits(index)} از {to_persian_digits(len(chunks))}")
            parts.append(await provider.synthesize(chunk, job.preferences))
            self.statuses[job.id].update(chunks_done=index, progress=round(index / len(chunks) * 80))
        if not await self._checkpoint(job):
            return
        self.statuses[job.id].update(state="merging", message="آماده‌سازی نهایی", progress=85)
        wav_data = await asyncio.to_thread(merge_wav, parts)
        if job.output_mode == "preview":
            self.audio_outputs[job.id] = wav_data
            self.statuses[job.id].update(
                state="done", message="آمادهٔ پخش", progress=100,
                stream_url=f"/api/tts/jobs/{job.id}/audio", finished_at=datetime.utcnow().isoformat(),
            )
            return
        if job.output_mode == "telegram":
            await self._send_only(job, wav_data)
            self.statuses[job.id].update(
                state="done", message="در تلگرام فرستاده شد", progress=100,
                finished_at=datetime.utcnow().isoformat(),
            )
            return
        stored = await self._store(job, wav_data)
        self.statuses[job.id].update(
            state="done", message="صدا آماده شد", progress=100, file_id=stored.id,
            stream_url=f"/api/stream/{stored.id}?workspace={stored.user_id}", finished_at=datetime.utcnow().isoformat(),
        )

    async def _send_only(self, job: TTSJob, wav_data: bytes) -> None:
        with tempfile.TemporaryDirectory(prefix="komod-tts-send-") as temporary_dir:
            safe_title = sanitize_filename(job.title or "صدای ساخته‌شده")
            wav_path = Path(temporary_dir) / f"{safe_title}.wav"
            ogg_path = Path(temporary_dir) / f"{safe_title}.ogg"
            wav_path.write_bytes(wav_data)
            output_path = wav_path
            if shutil.which("ffmpeg"):
                command = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav_path)]
                speed = float(job.preferences.get("speed", 1))
                if abs(speed - 1) > .01:
                    command.extend(["-filter:a", f"atempo={speed:.2f}"])
                command.extend(["-c:a", "libopus", "-b:a", "48k", str(ogg_path)])
                await asyncio.to_thread(subprocess.run, command, check=True, capture_output=True)
                output_path = ogg_path
            self.statuses[job.id].update(state="uploading", message="ارسال به تلگرام", progress=90)
            if output_path.suffix == ".ogg":
                await telegram.tg_client.send_voice(job.telegram_id, str(output_path), caption=job.title[:1024])
            else:
                await telegram.tg_client.send_audio(job.telegram_id, str(output_path), caption=job.title[:1024])

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
                    description="🤖 تولیدشده با هوش مصنوعی", file_size=media.file_size or os.path.getsize(output_path),
                    tags_json=json.dumps(["متن‌به‌صدا"], ensure_ascii=False),
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
