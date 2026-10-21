"""Background speech-to-text jobs backed by the configured Gemini keys."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timedelta
import json
import logging
import mimetypes
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from sqlalchemy import select

from . import telegram
from .config import get_settings
from .database import async_session
from .models import File, Folder, TTSUsage, User
from .gemini_keys import decrypt_user_keys
from .processing_jobs import create_job, delete_job, load_jobs, update_job
from .services import sanitize_filename
from .tts import GeminiRequestError

logger = logging.getLogger(__name__)
settings = get_settings()
TERMINAL_STATES = {"done", "error", "cancelled"}


def extract_interaction_text(payload: dict) -> str:
    """Read text from current and compatible Interactions API response shapes."""
    for key in ("output_text", "outputText"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    interaction = payload.get("interaction")
    if isinstance(interaction, dict):
        direct = extract_interaction_text(interaction)
        if direct:
            return direct

    texts: list[str] = []

    def walk(value, inside_output: bool = False) -> None:
        if isinstance(value, dict):
            kind = str(value.get("type") or "").lower()
            output_scope = inside_output or kind in {"model_output", "output", "text"}
            text = value.get("text")
            if output_scope and isinstance(text, str) and text.strip():
                texts.append(text.strip())
            for key, child in value.items():
                walk(child, output_scope or key.lower() in {"output", "outputs", "steps", "response"})
        elif isinstance(value, list):
            for child in value:
                walk(child, inside_output)

    walk(payload)
    return "\n".join(dict.fromkeys(texts)).strip()


async def consume_stt_quota(db, user_id: int, duration: int) -> TTSUsage:
    """Validate and account for an accepted transcription request."""
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
    if usage.stt_max_seconds and duration > usage.stt_max_seconds:
        raise ValueError("مدت فایل از سقف مجاز تبدیل صوت به متن بیشتر است.")
    if usage.stt_daily_limit and usage.stt_used_today >= usage.stt_daily_limit:
        raise ValueError("سهمیه روزانه استخراج متن برای این حساب تمام شده است.")
    usage.stt_used_today += 1
    usage.stt_total_jobs += 1
    usage.stt_total_seconds += max(0, duration)
    await db.commit()
    return usage


class GeminiSTTProvider:
    def __init__(self, api_keys: list[str], stt_model: str | None = None, text_model: str | None = None, stt_mode: str = "verbatim") -> None:
        self.api_keys = api_keys
        self.stt_model = stt_model or settings.gemini_stt_model
        self.text_model = text_model or "gemini-3.8-flash"
        self.stt_mode = stt_mode if stt_mode in {"verbatim", "smart"} else "verbatim"
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

    async def transcribe(self, path: Path, mime_type: str, prompt: str) -> str:
        last_error: Exception | None = None
        async with self._key_lock:
            ordered_keys = self._ordered_keys()
            if ordered_keys:
                self.cursor = (self.api_keys.index(ordered_keys[0]) + 1) % len(self.api_keys)
        for key in ordered_keys:
            try:
                result = await asyncio.to_thread(self._request, key, path, mime_type, prompt)
                self.cursor = (self.api_keys.index(key) + 1) % len(self.api_keys)
                return result
            except GeminiRequestError as error:
                last_error = error
                if error.status == 400:
                    raise RuntimeError(f"فایل صوتی یا تنظیمات پذیرفته نشد: {error.user_detail()}") from error
                if error.status in {429, 500, 502, 503, 504}:
                    self.cooldowns[key] = datetime.utcnow() + timedelta(seconds=60 if error.status == 429 else 15)
                    continue
                if error.status in {401, 403}:
                    self.cooldowns[key] = datetime.utcnow() + timedelta(minutes=10)
                    continue
                raise
            except (TimeoutError, URLError) as error:
                last_error = error
                self.cooldowns[key] = datetime.utcnow() + timedelta(seconds=15)
        if isinstance(last_error, GeminiRequestError):
            if last_error.status == 429:
                detail = "سهمیه یا محدودیت درخواست همه کلیدهای Gemini پر شده است. کمی بعد دوباره تلاش کن."
            elif last_error.status in {401, 403}:
                detail = "کلیدهای Gemini رد شدند؛ دسترسی API، محدودیت کلید و فعال‌بودن صورت‌حساب را بررسی کن."
            elif last_error.status in {500, 502, 503, 504}:
                detail = "سرویس Gemini موقتاً در دسترس نیست. کمی بعد دوباره تلاش کن."
            else:
                detail = last_error.user_detail()
            raise RuntimeError(f"تبدیل صدا با {self.stt_model} انجام نشد: {detail}") from last_error
        if isinstance(last_error, (TimeoutError, URLError)):
            raise RuntimeError("سرور کمد نتوانست به Gemini متصل شود؛ اتصال خروجی سرور را بررسی کن.") from last_error
        raise RuntimeError("Gemini متن معتبری از فایل برنگرداند.") from last_error

    async def refine_text(self, content: str, instruction: str) -> str:
        """Apply one user-directed edit to a transcription and return Markdown only."""
        last_error: Exception | None = None
        async with self._key_lock:
            ordered_keys = self._ordered_keys()
            if ordered_keys:
                self.cursor = (self.api_keys.index(ordered_keys[0]) + 1) % len(self.api_keys)
        for key in ordered_keys:
            try:
                result = await asyncio.to_thread(self._text_request, key, content, instruction)
                self.cursor = (self.api_keys.index(key) + 1) % len(self.api_keys)
                return result
            except GeminiRequestError as error:
                last_error = error
                if error.status == 400:
                    raise RuntimeError(f"دستور یا متن توسط Gemini پذیرفته نشد: {error.user_detail()}") from error
                if error.status in {429, 500, 502, 503, 504}:
                    self.cooldowns[key] = datetime.utcnow() + timedelta(seconds=60 if error.status == 429 else 15)
                    continue
                if error.status in {401, 403}:
                    self.cooldowns[key] = datetime.utcnow() + timedelta(minutes=10)
                    continue
                raise
            except (TimeoutError, URLError) as error:
                last_error = error
                self.cooldowns[key] = datetime.utcnow() + timedelta(seconds=15)
        if isinstance(last_error, GeminiRequestError):
            if last_error.status == 429:
                detail = "سهمیه همه کلیدهای Gemini پر شده است. کمی بعد دوباره تلاش کن."
            elif last_error.status in {401, 403}:
                detail = "کلیدهای Gemini معتبر نیستند یا اجازه استفاده از مدل را ندارند."
            elif last_error.status in {500, 502, 503, 504}:
                detail = "سرویس Gemini موقتاً در دسترس نیست."
            else:
                detail = last_error.user_detail()
            raise RuntimeError(f"ویرایش متن انجام نشد: {detail}") from last_error
        if isinstance(last_error, (TimeoutError, URLError)):
            raise RuntimeError("سرور کمد نتوانست برای ویرایش متن به Gemini متصل شود.") from last_error
        raise RuntimeError("هیچ کلید Gemini فعالی برای ویرایش متن وجود ندارد.")

    @staticmethod
    def _json_request(request: Request, timeout: int = 180) -> tuple[dict, object]:
        try:
            with urlopen(request, timeout=timeout) as response:
                return json.loads(response.read().decode("utf-8")), response.headers
        except HTTPError as error:
            try:
                detail = error.read().decode("utf-8")[:1500]
            except Exception:
                detail = str(error)
            raise GeminiRequestError(error.code, detail) from error

    def _request(self, key: str, path: Path, mime_type: str, custom_prompt: str) -> str:
        size = path.stat().st_size
        start = Request(
            f"https://generativelanguage.googleapis.com/upload/v1beta/files?{urlencode({'key': key})}",
            data=json.dumps({"file": {"display_name": path.name}}).encode(),
            headers={
                "Content-Type": "application/json",
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": str(size),
                "X-Goog-Upload-Header-Content-Type": mime_type,
            },
            method="POST",
        )
        try:
            with urlopen(start, timeout=60) as response:
                upload_url = response.headers.get("X-Goog-Upload-URL")
            if not upload_url:
                raise RuntimeError("آدرس آپلود Gemini دریافت نشد.")
            upload = Request(
                upload_url, data=path.read_bytes(),
                headers={"Content-Type": mime_type, "X-Goog-Upload-Command": "upload, finalize", "X-Goog-Upload-Offset": "0"},
                method="POST",
            )
            uploaded, _ = self._json_request(upload, 300)
            remote = uploaded.get("file", uploaded)
            file_uri = remote.get("uri")
            file_name = remote.get("name")
            if not file_uri:
                raise RuntimeError("فایل صوتی در Gemini آماده نشد.")
            state = str(remote.get("state", "ACTIVE")).upper()
            for _ in range(60):
                if state == "ACTIVE":
                    break
                if state == "FAILED":
                    raise RuntimeError("Gemini نتوانست فایل صوتی را پردازش کند.")
                if not file_name:
                    raise RuntimeError("وضعیت پردازش فایل Gemini قابل پیگیری نیست.")
                time.sleep(1)
                remote, _ = self._json_request(Request(
                    f"https://generativelanguage.googleapis.com/v1beta/{quote(file_name, safe='/')}?{urlencode({'key': key})}",
                    method="GET",
                ), 60)
                state = str(remote.get("state", "ACTIVE")).upper()
            else:
                raise RuntimeError("آماده‌شدن فایل برای تبدیل بیش از حد طول کشید.")
            if self.stt_model == "gemini-3.5-transcribe":
                payload = {
                    "model": self.stt_model,
                    "input": [{"type": "audio", "uri": file_uri, "mime_type": mime_type}],
                    "generation_config": {"transcription_config": {"mode": self.stt_mode}},
                }
                endpoint = f"https://generativelanguage.googleapis.com/v1beta/interactions?{urlencode({'key': key})}"
                try:
                    result, _ = self._json_request(Request(endpoint, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST"), 600)
                except GeminiRequestError as error:
                    if error.status not in {400, 404}:
                        raise
                    logger.warning("Dedicated transcription model unavailable; using Gemini 3.8 Flash fallback (%s)", error.status)
                else:
                    text = extract_interaction_text(result)
                    if not text:
                        raise RuntimeError("Gemini متن معتبری از فایل برنگرداند.")
                    if custom_prompt.strip():
                        text = self._text_request(key, text, custom_prompt.strip())
                    return text

            instruction = (
                "محتوای این فایل صوتی یا ویدیویی را بدون خلاصه‌سازی و بدون تغییر معنا، دقیق رونویسی کن. "
                "اصطلاحات تخصصی و کلمات انگلیسی را به همان زبان نگه دار. خروجی فقط Markdown خوانا باشد؛ "
                "برای پاراگراف‌ها و گوینده‌های متفاوت ساختار مناسب بساز و هیچ توضیح اضافه‌ای درباره فرایند ننویس."
            )
            if custom_prompt.strip():
                instruction += f"\n\nدستور تکمیلی کاربر:\n{custom_prompt.strip()}"
            payload = {
                "contents": [{"role": "user", "parts": [
                    {"text": instruction},
                    {"fileData": {"mimeType": mime_type, "fileUri": file_uri}},
                ]}],
                "generationConfig": {"temperature": 0.1},
            }
            fallback_model = "gemini-3.8-flash" if self.stt_model == "gemini-3.5-transcribe" else self.stt_model
            endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{fallback_model}:generateContent?{urlencode({'key': key})}"
            result, _ = self._json_request(Request(endpoint, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST"), 600)
            parts = result.get("candidates", [{}])[0].get("content", {}).get("parts", [])
            text = "\n".join(str(part.get("text", "")) for part in parts if part.get("text")).strip()
            if not text:
                raise RuntimeError("Gemini متن معتبری از فایل برنگرداند.")
            return text
        finally:
            if 'file_name' in locals() and file_name:
                try:
                    urlopen(Request(f"https://generativelanguage.googleapis.com/v1beta/{quote(file_name, safe='/')}?{urlencode({'key': key})}", method="DELETE"), timeout=30).close()
                except Exception:
                    pass

    def _text_request(self, key: str, content: str, instruction: str) -> str:
        system_instruction = (
            "You are an expert Persian and multilingual text editor. Apply the user's instruction to the supplied text. "
            "Preserve technical terms, English words, names, numbers and factual meaning unless the user explicitly asks otherwise. "
            "Return only the final edited text as clean Markdown. Do not explain your work and do not wrap the answer in a code fence."
        )
        payload = {
            "systemInstruction": {"parts": [{"text": system_instruction}]},
            "contents": [{"role": "user", "parts": [{"text": (
                f"دستور کاربر:\n{instruction.strip()}\n\n"
                "متن ورودی بین نشانگرها قرار دارد:\n---BEGIN TEXT---\n"
                f"{content}\n---END TEXT---"
            )}]}],
            "generationConfig": {"temperature": 0.2},
        }
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{self.text_model}:generateContent?{urlencode({'key': key})}"
        result, _ = self._json_request(Request(
            endpoint, data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"}, method="POST",
        ), 240)
        parts = result.get("candidates", [{}])[0].get("content", {}).get("parts", [])
        text = "\n".join(str(part.get("text", "")) for part in parts if part.get("text")).strip()
        if not text:
            raise RuntimeError("Gemini متن ویرایش‌شده‌ای برنگرداند.")
        return text


@dataclass
class STTJob:
    user_id: int
    source_file_id: int
    title: str
    folder_id: int | None
    prompt: str = ""
    post_prompts: list[str] | None = None
    output_mode: str = "save"
    telegram_id: int | None = None
    api_keys: list[str] | None = None
    cleanup_source: bool = False
    stt_model: str = ""
    text_model: str = ""
    stt_mode: str = "verbatim"
    id: str = ""


class STTQueue:
    def __init__(self, provider: GeminiSTTProvider | None = None) -> None:
        self.provider = provider or GeminiSTTProvider(settings.gemini_api_keys)
        self.queue: asyncio.Queue[STTJob] = asyncio.Queue()
        self.statuses: dict[str, dict] = {}
        self.controls: dict[str, bool] = {}
        self.task: asyncio.Task | None = None
        self.tasks: list[asyncio.Task] = []
        self.durable_job_ids: set[str] = set()
        self._recovered = False

    @property
    def available(self) -> bool:
        return bool(self.provider.api_keys)

    async def start(self) -> None:
        if not self._recovered:
            await self._recover()
            self._recovered = True
        if (self.available or not self.queue.empty()) and not any(not task.done() for task in self.tasks):
            recovered_key_count = max((len(job.api_keys or []) for job in list(self.queue._queue)), default=0)
            worker_count = min(4, max(1, len(self.provider.api_keys), recovered_key_count))
            self.tasks = [asyncio.create_task(self._run(), name=f"gemini-stt-worker-{index + 1}") for index in range(worker_count)]
            self.task = self.tasks[0]

    async def _recover(self) -> None:
        for payload, status in await load_jobs("stt"):
            if not status or not payload:
                continue
            job_id = str(status.get("id") or payload.get("id") or "")
            if not job_id or job_id in self.statuses:
                continue
            if status.get("state") in TERMINAL_STATES:
                self.statuses[job_id] = status
                continue
            async with async_session() as db:
                user = await db.get(User, int(payload["user_id"]))
            if user is None:
                continue
            job = STTJob(
                user_id=user.id, source_file_id=int(payload["source_file_id"]),
                title=str(payload.get("title") or "رونویسی صدا"), folder_id=payload.get("folder_id"),
                prompt=str(payload.get("prompt") or ""), post_prompts=list(payload.get("post_prompts") or []), output_mode=str(payload.get("output_mode") or "save"),
                telegram_id=payload.get("telegram_id"), api_keys=decrypt_user_keys(user.gemini_api_keys_encrypted),
                cleanup_source=bool(payload.get("cleanup_source", False)), id=job_id,
                stt_model=str(payload.get("stt_model") or settings.gemini_stt_model),
                text_model=str(payload.get("text_model") or "gemini-3.8-flash"),
                stt_mode=str(payload.get("stt_mode") or "verbatim"),
            )
            status.update(state="queued", message="ادامه پس از راه‌اندازی دوباره", progress=0, output_mode=job.output_mode)
            self.statuses[job_id] = status
            self.controls[job_id] = False
            self.durable_job_ids.add(job_id)
            await self._persist_status(job_id)
            await self.queue.put(job)

    async def stop(self) -> None:
        for task in self.tasks:
            task.cancel()
        if self.tasks:
            await asyncio.gather(*self.tasks, return_exceptions=True)
        self.tasks = []
        self.task = None

    async def enqueue(self, job: STTJob) -> int:
        if not self.available and not job.api_keys:
            raise RuntimeError("GEMINI_API_KEYS is not configured")
        if job.api_keys and not self.available and not any(not task.done() for task in self.tasks):
            worker_count = min(4, len(job.api_keys))
            self.tasks = [asyncio.create_task(self._run(), name=f"gemini-stt-worker-{index + 1}") for index in range(worker_count)]
            self.task = self.tasks[0]
        else:
            await self.start()
        position = 1 + sum(1 for status in self.statuses.values() if status.get("state") not in {"done", "error", "cancelled"})
        job.id = job.id or uuid.uuid4().hex
        self.statuses[job.id] = {"id": job.id, "user_id": job.user_id, "source_file_id": job.source_file_id, "title": job.title, "output_mode": job.output_mode, "model": job.stt_model or settings.gemini_stt_model, "state": "queued", "message": "منتظر نوبت", "progress": 0, "created_at": datetime.utcnow().isoformat()}
        self.controls[job.id] = False
        await create_job(
            job_id=job.id, user_id=job.user_id, kind="stt", title=job.title,
            payload={"id": job.id, "user_id": job.user_id, "source_file_id": job.source_file_id,
                     "title": job.title, "folder_id": job.folder_id, "prompt": job.prompt, "post_prompts": job.post_prompts or [],
                     "output_mode": job.output_mode, "telegram_id": job.telegram_id,
                     "cleanup_source": job.cleanup_source, "stt_model": job.stt_model,
                     "text_model": job.text_model, "stt_mode": job.stt_mode},
            status=self.statuses[job.id],
        )
        self.durable_job_ids.add(job.id)
        await self.queue.put(job)
        return position

    async def _persist_status(self, job_id: str) -> None:
        if job_id in self.durable_job_ids and job_id in self.statuses:
            await update_job(job_id, self.statuses[job_id])

    def _persist_soon(self, job_id: str) -> None:
        try:
            if job_id in self.durable_job_ids:
                asyncio.get_running_loop().create_task(update_job(job_id, dict(self.statuses[job_id])))
        except (RuntimeError, KeyError):
            pass

    def status(self, job_id: str, user_id: int) -> dict | None:
        item = self.statuses.get(job_id)
        return dict(item) if item and item["user_id"] == user_id else None

    def list_statuses(self, user_id: int) -> list[dict]:
        return sorted((dict(item) for item in self.statuses.values() if item["user_id"] == user_id), key=lambda item: item["created_at"], reverse=True)[:50]

    def cancel(self, job_id: str, user_id: int) -> dict | None:
        item = self.statuses.get(job_id)
        if not item or item["user_id"] != user_id:
            return None
        if item["state"] not in TERMINAL_STATES:
            self.controls[job_id] = True
            item.update(state="cancelled", message="لغو شد", finished_at=datetime.utcnow().isoformat())
            self._persist_soon(job_id)
        return dict(item)

    def dismiss(self, job_id: str, user_id: int) -> bool:
        item = self.statuses.get(job_id)
        if not item or item["user_id"] != user_id or item["state"] not in TERMINAL_STATES:
            return False
        self.statuses.pop(job_id, None); self.controls.pop(job_id, None)
        self.durable_job_ids.discard(job_id)
        try:
            asyncio.get_running_loop().create_task(delete_job(job_id, user_id))
        except RuntimeError:
            pass
        return True

    async def _run(self) -> None:
        while True:
            job = await self.queue.get()
            try:
                if not self.controls.get(job.id):
                    await self._process(job)
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.exception("STT job %s failed", job.id)
                self.statuses[job.id].update(state="error", message=str(error) or "تبدیل صدا به متن انجام نشد.", finished_at=datetime.utcnow().isoformat())
                await self._persist_status(job.id)
            finally:
                if job.cleanup_source:
                    await self._cleanup_temporary_source(job)
                self.queue.task_done()

    async def _cleanup_temporary_source(self, job: STTJob) -> None:
        async with async_session() as db:
            source = await db.get(File, job.source_file_id)
            if source is None or source.user_id != job.user_id or not source.is_hidden:
                return
            channel_id, message_id = source.storage_channel_id, source.channel_message_id
            await db.delete(source)
            await db.commit()
        try:
            await telegram.tg_client.delete_messages(channel_id or settings.telegram_storage_channel_id, message_id)
        except Exception:
            logger.warning("Could not remove temporary STT source %s", message_id, exc_info=True)

    async def _process(self, job: STTJob) -> None:
        provider = GeminiSTTProvider(
            list(dict.fromkeys((job.api_keys or []) + self.provider.api_keys)),
            stt_model=job.stt_model or settings.gemini_stt_model,
            text_model=job.text_model or "gemini-3.8-flash",
            stt_mode=job.stt_mode,
        )
        async with async_session() as db:
            source = (await db.execute(select(File).where(File.id == job.source_file_id, File.user_id == job.user_id))).scalar_one_or_none()
            user = await db.get(User, job.user_id)
            if source is None or user is None:
                raise RuntimeError("فایل صوتی پیدا نشد.")
            channel_id = source.storage_channel_id or user.storage_channel_id or settings.telegram_storage_channel_id
            message = await telegram.tg_client.get_messages(channel_id, source.channel_message_id)
            if not message:
                raise RuntimeError("نسخه اصلی فایل در دسترس نیست.")
            with tempfile.TemporaryDirectory(prefix="komod-stt-") as directory:
                suffix = Path(source.file_name).suffix or mimetypes.guess_extension(source.mime_type or "") or ".bin"
                input_path = Path(directory) / f"source{suffix}"
                self.statuses[job.id].update(state="downloading", message="دریافت فایل", progress=10)
                await self._persist_status(job.id)
                downloaded = await telegram.tg_client.download_media(message, file_name=str(input_path))
                if not downloaded:
                    raise RuntimeError("دریافت فایل از فضای ذخیره‌سازی انجام نشد.")
                media_path = Path(downloaded)
                mime_type = source.mime_type or mimetypes.guess_type(media_path.name)[0] or "audio/ogg"
                if shutil.which("ffmpeg") and (source.file_type == "video" or media_path.stat().st_size > 18 * 1024 * 1024):
                    compressed = Path(directory) / "speech.mp3"
                    command = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(media_path), "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", str(compressed)]
                    await asyncio.to_thread(subprocess.run, command, check=True, capture_output=True)
                    media_path, mime_type = compressed, "audio/mpeg"
                if self.controls.get(job.id):
                    return
                self.statuses[job.id].update(state="transcribing", message="در حال تبدیل", progress=45)
                await self._persist_status(job.id)
                markdown = await provider.transcribe(media_path, mime_type, job.prompt)
            if self.controls.get(job.id):
                return
            for index, instruction in enumerate(job.post_prompts or []):
                if self.controls.get(job.id):
                    return
                progress = min(82, 60 + int((index / max(1, len(job.post_prompts or []))) * 20))
                self.statuses[job.id].update(state="transcribing", message=f"پردازش هوشمند؛ مرحله {index + 1} از {len(job.post_prompts or [])}", progress=progress)
                await self._persist_status(job.id)
                markdown = await provider.refine_text(markdown, instruction)
            if job.output_mode == "temporary":
                self.statuses[job.id].update(state="done", message="متن آماده است", progress=100, content=markdown, finished_at=datetime.utcnow().isoformat())
                await self._persist_status(job.id)
                if job.telegram_id:
                    with tempfile.TemporaryDirectory(prefix="komod-stt-preview-") as directory:
                        path = Path(directory) / f"{sanitize_filename(job.title or 'متن')}.md"
                        path.write_text(markdown, encoding="utf-8")
                        await telegram.tg_client.send_document(job.telegram_id, str(path), caption="📝 متن آماده شد")
                return
            self.statuses[job.id].update(state="saving", message="ذخیره Markdown", progress=85)
            await self._persist_status(job.id)
            stored = await self._store(db, user, job, markdown)
            self.statuses[job.id].update(state="done", message="متن ذخیره شد", progress=100, content=markdown, file_id=stored.id, finished_at=datetime.utcnow().isoformat())
            await self._persist_status(job.id)
            if job.telegram_id:
                try:
                    await telegram.tg_client.copy_message(job.telegram_id, stored.storage_channel_id or settings.telegram_storage_channel_id, stored.channel_message_id)
                except Exception:
                    logger.warning("STT output was saved but could not be sent to user %s", job.telegram_id, exc_info=True)

    async def _store(self, db, user: User, job: STTJob, markdown: str) -> File:
        folder_id = job.folder_id
        if folder_id is None:
            default = (await db.execute(select(Folder).where(Folder.user_id == user.id, Folder.is_default.is_(True)))).scalar_one_or_none()
            if default is None:
                default = Folder(user_id=user.id, name="فایل‌های من", is_default=True); db.add(default); await db.flush()
            folder_id = default.id
        elif (await db.execute(select(Folder.id).where(Folder.id == folder_id, Folder.user_id == user.id))).scalar_one_or_none() is None:
            raise RuntimeError("کشوی مقصد پیدا نشد.")
        title = sanitize_filename(job.title or "رونویسی صدا")
        with tempfile.TemporaryDirectory(prefix="komod-stt-output-") as directory:
            path = Path(directory) / f"{title}.md"; path.write_text(markdown, encoding="utf-8")
            target = user.storage_channel_id or settings.telegram_storage_channel_id
            message = await telegram.tg_client.send_document(target, str(path), caption=job.title[:1024])
            media = message.document
            record = File(user_id=user.id, folder_id=folder_id, file_id=media.file_id, file_unique_id=media.file_unique_id, channel_message_id=message.id, storage_channel_id=target, file_name=path.name, description="🎙️ رونویسی‌شده با هوش مصنوعی", search_text=markdown, tags_json=json.dumps(["صدا‌به‌متن"], ensure_ascii=False), file_size=media.file_size or os.path.getsize(path), mime_type="text/markdown", file_type="text")
            db.add(record); await db.commit(); await db.refresh(record)
            return record


stt_queue = STTQueue()
