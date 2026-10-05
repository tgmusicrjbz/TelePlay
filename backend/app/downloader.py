"""FIFO background importer for YouTube and Instagram links via @allsaverbot."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
import json
import logging
from pathlib import Path
import re
import tempfile
import time
import uuid
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from pyrogram import Client
from pyrogram.errors import Timeout
from pyrogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from sqlalchemy import select

from .auth import create_access_token
from .config import get_settings
from .database import async_session
from .models import File, Folder, User
from .services import sanitize_filename, select_best_thumbnail
from . import telegram

logger = logging.getLogger(__name__)
settings = get_settings()


@dataclass
class ImportJob:
    url: str
    user_id: int
    telegram_id: int
    folder_id: int | None = None
    quality: str = "720"
    notify: bool = True
    default_folder: bool = False
    id: str = ""


def _oembed_metadata(url: str) -> tuple[str, str | None]:
    if "youtu" not in url.lower():
        return "instagram", None
    endpoints = (
        "https://www.youtube.com/oembed?" + urlencode({"url": url, "format": "json"}),
        "https://noembed.com/embed?" + urlencode({"url": url}),
    )
    for endpoint in endpoints:
        try:
            request = Request(endpoint, headers={"User-Agent": "Mozilla/5.0 Komod/1.0", "Accept": "application/json"})
            with urlopen(request, timeout=10) as response:
                payload = json.loads(response.read().decode("utf-8"))
                title = str(payload.get("title") or "").strip()
                author = str(payload.get("author_name") or "").strip() or None
                if title:
                    return title, author
        except Exception:
            logger.debug("Could not resolve YouTube title from %s", endpoint, exc_info=True)
    return "youtube", None


class LinkImportService:
    def __init__(self) -> None:
        self.client: Client | None = None
        self.queue: asyncio.Queue[ImportJob] = asyncio.Queue()
        self.task: asyncio.Task | None = None
        self.statuses: dict[str, dict] = {}
        self.controls: dict[str, dict[str, bool]] = {}
        self.active_job_id: str | None = None

    @property
    def available(self) -> bool:
        return bool(settings.telegram_worker_session)

    async def start(self) -> None:
        if not self.available:
            return
        if self.client is None:
            self.client = Client(
                "komod-worker",
                api_id=settings.telegram_api_id,
                api_hash=settings.telegram_api_hash,
                session_string=settings.telegram_worker_session,
                in_memory=True,
                no_updates=True,
            )
            await self.client.start()
        if self.task is None or self.task.done():
            if self.task is not None and not self.task.cancelled():
                error = self.task.exception()
                if error is not None:
                    logger.error("Restarting failed link-import worker: %s", error)
            self.task = asyncio.create_task(self._run(), name="link-import-worker")
            logger.info("Background link importer started")

    async def stop(self) -> None:
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            self.task = None
        if self.client:
            await self.client.stop()
            self.client = None

    async def enqueue(self, job: ImportJob) -> int:
        if not self.available:
            raise RuntimeError("TELEGRAM_WORKER_SESSION is not configured")
        if self.client is None or self.task is None or self.task.done():
            await self.start()
        job.id = job.id or uuid.uuid4().hex
        self.statuses[job.id] = {"id": job.id, "user_id": job.user_id, "state": "queued", "message": "توی صفه و به‌زودی شروع می‌شه.", "saved": 0}
        self.controls[job.id] = {"paused": False, "cancelled": False}
        await self.queue.put(job)
        return self.queue.qsize()

    def status(self, job_id: str, user_id: int) -> dict | None:
        status = self.statuses.get(job_id)
        return status if status and status["user_id"] == user_id else None

    def toggle_pause(self, job_id: str, user_id: int) -> dict | None:
        status = self.status(job_id, user_id)
        control = self.controls.get(job_id)
        if status is None or control is None or status["state"] in {"done", "error", "cancelled"}:
            return status
        control["paused"] = not control["paused"]
        if control["paused"]:
            status.update(state="paused", message="فعلاً متوقف شده؛ هر وقت خواستی ادامه بده.")
        else:
            state = "downloading" if self.active_job_id == job_id else "queued"
            status.update(state=state, message="دوباره ادامه پیدا کرد.")
        return status

    def cancel(self, job_id: str, user_id: int) -> dict | None:
        status = self.status(job_id, user_id)
        control = self.controls.get(job_id)
        if status is None or control is None or status["state"] in {"done", "error", "cancelled"}:
            return status
        control["cancelled"] = True
        control["paused"] = False
        status.update(state="cancelled", message="این مورد از صف کنار گذاشته شد.")
        return status

    async def _checkpoint(self, job: ImportJob) -> bool:
        control = self.controls.get(job.id, {})
        while control.get("paused") and not control.get("cancelled"):
            await asyncio.sleep(.35)
        return not control.get("cancelled")

    async def _run(self) -> None:
        while True:
            job = await self.queue.get()
            try:
                self.active_job_id = job.id
                if not await self._checkpoint(job):
                    continue
                self.statuses[job.id].update(state="downloading", message="دارم فایل اصلی رو آماده می‌کنم…")
                if job.notify:
                    await self._notify(job, "⏳ نوبت لینک تو رسید؛ دارم فایل اصلی رو آماده می‌کنم…")
                items = await self._download(job.url, job.quality)
                if not await self._checkpoint(job):
                    continue
                saved = await self._store(job, items)
                if not saved:
                    raise RuntimeError("هیچ فایل قابل ذخیره‌ای در پاسخ پیدا نشد")
                if job.notify:
                    count = str(len(saved)).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))
                    await self._notify(job, f"✅ آماده شد! {count} فایل توی کمدت قرار گرفت.")
                self.statuses[job.id].update(state="done", message="فایل‌ها با موفقیت به کمد اضافه شدند.", saved=len(saved))
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.exception("Link import failed for %s", job.url)
                if job.notify:
                    await self._notify(job, "❌ این لینک آماده نشد. ممکنه پست خصوصی، حذف‌شده یا موقتاً خارج از دسترس باشه؛ کمی بعد دوباره امتحانش کن.")
                self.statuses[job.id].update(state="error", message="آماده‌سازی این لینک انجام نشد.")
            finally:
                if self.active_job_id == job.id:
                    self.active_job_id = None
                self.queue.task_done()

    async def _download(self, url: str, quality: str) -> list[dict]:
        if self.client is None:
            raise RuntimeError("Import worker is unavailable")
        raw_title, source_author = await asyncio.to_thread(_oembed_metadata, url)
        title = sanitize_filename(raw_title)
        is_instagram = "instagram.com" in url.lower()
        sent = await self.client.send_message("allsaverbot", url)
        clicked: set[str] = set()
        found: list[dict] = []
        seen: set[int] = set()
        audio_mode = quality.lower() == "audio"

        async def click_button(message, button) -> bool:
            try:
                if getattr(button, "callback_data", None):
                    await self.client.request_callback_answer(
                        chat_id="allsaverbot",
                        message_id=message.id,
                        callback_data=button.callback_data,
                    )
                else:
                    await message.click(button.text)
                return True
            except (Timeout, TimeoutError):
                return False
            except Exception:
                logger.debug("Downloader button click failed", exc_info=True)
                return False

        def media_kind(message) -> str | None:
            mime = (getattr(message.document, "mime_type", "") or "").lower() if message.document else ""
            if audio_mode:
                return "audio" if message.audio or message.voice or mime.startswith("audio/") else None
            if message.video or mime.startswith("video/"):
                return "video"
            if message.audio or message.voice or mime.startswith("audio/"):
                return "audio"
            # YouTube download bots commonly send the thumbnail first. It must
            # never be mistaken for the requested video. Instagram photos are
            # real carousel items and should be preserved.
            if message.photo and is_instagram:
                return "image"
            return None

        started_at = time.monotonic()
        last_media_at: float | None = None
        while time.monotonic() - started_at < 180:
            await asyncio.sleep(2)
            received_now = 0
            async for message in self.client.get_chat_history("allsaverbot", limit=60):
                if message.id <= sent.id or message.id in seen or message.reply_markup:
                    continue
                kind = media_kind(message)
                if kind:
                    seen.add(message.id)
                    caption = str(getattr(message, "caption", "") or getattr(message, "text", "") or "").strip()
                    inferred_author = source_author
                    if not inferred_author and caption:
                        first_line = caption.splitlines()[0].strip()
                        if first_line and len(first_line) <= 120 and not first_line.startswith("http"):
                            inferred_author = first_line
                    found.append({"message": message, "title": title, "type": kind, "author": inferred_author})
                    received_now += 1
            if received_now:
                last_media_at = time.monotonic()
            # Albums may arrive one item at a time. Wait for a quiet window
            # after the latest item instead of stopping after the first result.
            if found and last_media_at is not None and time.monotonic() - last_media_at >= (10 if is_instagram else 6):
                break
            if found:
                continue
            async for raw in self.client.get_chat_history("allsaverbot", limit=4):
                if raw.id <= sent.id or not raw.reply_markup:
                    continue
                message = await self.client.get_messages("allsaverbot", raw.id)
                if not message.reply_markup:
                    continue
                buttons = [button for row in message.reply_markup.inline_keyboard for button in row if not getattr(button, "url", None)]
                if audio_mode:
                    audio_button = next((button for button in buttons if any(word in button.text.lower() for word in ("audio", "صوت", "mp3")) and "⏳" not in button.text), None)
                    if audio_button and audio_button.text not in clicked and await click_button(message, audio_button):
                        clicked.add(audio_button.text)
                        break
                quality_buttons = [button for button in buttons if re.search(r"\b(360|480|720|1080)p?\b", button.text, re.IGNORECASE)] if not audio_mode else []
                candidates = quality_buttons or [button for button in buttons if not any(word in button.text.lower() for word in ("back", "بازگشت", "назад"))]
                globe = next((button for button in buttons if ("🌏" in button.text or "🌐" in button.text) and button.text not in clicked), None)
                target = next((button for button in candidates if quality != "auto" and quality in button.text and "⏳" not in button.text), None) if quality_buttons else None
                target = target or globe
                target = target or next((button for button in candidates if "⏳" not in button.text and button.text not in clicked), None)
                if target:
                    if await click_button(message, target):
                        clicked.add(target.text)
                        break
            async for message in self.client.get_chat_history("allsaverbot", limit=3):
                if message.id > sent.id and message.text and not message.reply_markup and any(word in message.text.lower() for word in ("error", "ошибка", "не удалось")):
                    raise RuntimeError(message.text[:180])
        if not found:
            raise TimeoutError("زمان دریافت فایل از سرویس دانلود تمام شد")
        return sorted(found, key=lambda item: item["message"].id)

    async def _copy_to_storage(self, message, item_type: str, filename: str):
        """Copy server-side when possible; fall back to bot re-upload.

        The Telegram account behind TELEGRAM_WORKER_SESSION does not need to be
        a member of the storage channel when the fallback is used.
        """
        try:
            return await message.copy(settings.telegram_storage_channel_id)
        except Exception:
            logger.warning("Worker could not copy media to storage; using bot upload fallback", exc_info=True)
        if telegram.tg_client is None:
            raise RuntimeError("ربات ذخیره‌سازی در دسترس نیست")
        with tempfile.TemporaryDirectory(prefix="komod-link-") as temp_dir:
            target = str(Path(temp_dir) / filename)
            downloaded = await self.client.download_media(message, file_name=target)
            if not downloaded:
                raise RuntimeError("دریافت فایل اصلی کامل نشد")
            if item_type == "video":
                return await telegram.tg_client.send_video(settings.telegram_storage_channel_id, downloaded, supports_streaming=True)
            if item_type == "audio":
                return await telegram.tg_client.send_audio(settings.telegram_storage_channel_id, downloaded)
            if item_type == "image":
                return await telegram.tg_client.send_photo(settings.telegram_storage_channel_id, downloaded)
            return await telegram.tg_client.send_document(settings.telegram_storage_channel_id, downloaded)

    async def _store(self, job: ImportJob, items: list[dict]) -> list[File]:
        if self.client is None:
            raise RuntimeError("Import worker is unavailable")
        saved: list[File] = []
        async with async_session() as db:
            user = await db.get(User, job.user_id)
            if user is None:
                raise RuntimeError("کاربر پیدا نشد")
            folder_id = job.folder_id
            if folder_id is None and job.default_folder:
                default_name = "Youtube" if "youtu" in job.url.lower() else "Instagram"
                folder = (await db.execute(select(Folder).where(Folder.user_id == user.id, Folder.parent_id.is_(None), Folder.name == default_name))).scalar_one_or_none()
                if folder is None:
                    folder = Folder(user_id=user.id, name=default_name, parent_id=None)
                    db.add(folder)
                    await db.flush()
                folder_id = folder.id
            for index, item in enumerate(items, 1):
                suffix = ".mp4" if item["type"] == "video" else ".mp3" if item["type"] == "audio" else ".jpg"
                indexed = f"_{index}" if len(items) > 1 else ""
                filename = sanitize_filename(f"{item['title']}{indexed}{suffix}")
                copied = await self._copy_to_storage(item["message"], item["type"], filename)
                media = copied.video or copied.audio or copied.voice or copied.document or (select_best_thumbnail(copied.photo.sizes) if copied.photo else None)
                if media is None:
                    continue
                stored = File(
                    user_id=user.id,
                    folder_id=folder_id,
                    channel_message_id=copied.id,
                    file_id=media.file_id,
                    file_unique_id=media.file_unique_id,
                    file_name=filename,
                    description=(
                        f"{'📺' if 'youtu' in job.url.lower() else '📷'} {item.get('author')}\n\n🔗 {job.url}"
                        if item.get("author") else f"🔗 {job.url}"
                    ),
                    file_size=getattr(media, "file_size", None) or 0,
                    mime_type=(getattr(media, "mime_type", None) or ("video/mp4" if item["type"] == "video" else "audio/mpeg" if item["type"] == "audio" else "image/jpeg")),
                    file_type=item["type"],
                    duration=getattr(media, "duration", None),
                    width=getattr(media, "width", None),
                    height=getattr(media, "height", None),
                    thumbnail_file_id=(select_best_thumbnail(getattr(media, "thumbs", None)).file_id if select_best_thumbnail(getattr(media, "thumbs", None)) else media.file_id if item["type"] == "image" else None),
                )
                db.add(stored)
                saved.append(stored)
            await db.commit()
        return saved

    async def _notify(self, job: ImportJob, text: str) -> None:
        if telegram.tg_client is None:
            return
        token = quote(create_access_token(job.telegram_id), safe="")
        url = f"{settings.web_base_url.rstrip('/')}/auth?token={token}"
        keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("🗄️ باز کردن کمد", web_app=WebAppInfo(url=url))]]) if url.startswith("https://") else None
        message = await telegram.tg_client.send_message(job.telegram_id, text, reply_markup=keyboard)
        async def remove_later() -> None:
            await asyncio.sleep(45)
            try:
                await telegram.tg_client.delete_messages(job.telegram_id, message.id)
            except Exception:
                pass
        asyncio.create_task(remove_later())


link_importer = LinkImportService()
