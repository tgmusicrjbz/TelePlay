"""FIFO background importer for YouTube and Instagram links via @allsaverbot."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
import json
import logging
import re
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


def _oembed_title(url: str) -> str:
    if "youtu" not in url.lower():
        return "instagram"
    endpoints = (
        "https://www.youtube.com/oembed?" + urlencode({"url": url, "format": "json"}),
        "https://noembed.com/embed?" + urlencode({"url": url}),
    )
    for endpoint in endpoints:
        try:
            request = Request(endpoint, headers={"User-Agent": "Mozilla/5.0 Komod/1.0", "Accept": "application/json"})
            with urlopen(request, timeout=10) as response:
                title = str(json.loads(response.read().decode("utf-8")).get("title") or "").strip()
                if title:
                    return title
        except Exception:
            logger.debug("Could not resolve YouTube title from %s", endpoint, exc_info=True)
    return "youtube"


class LinkImportService:
    def __init__(self) -> None:
        self.client: Client | None = None
        self.queue: asyncio.Queue[ImportJob] = asyncio.Queue()
        self.task: asyncio.Task | None = None

    @property
    def available(self) -> bool:
        return bool(settings.telegram_worker_session)

    async def start(self) -> None:
        if not self.available or self.client is not None:
            return
        self.client = Client(
            "komod-worker",
            api_id=settings.telegram_api_id,
            api_hash=settings.telegram_api_hash,
            session_string=settings.telegram_worker_session,
            in_memory=True,
            no_updates=True,
        )
        await self.client.start()
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
        if self.client is None:
            await self.start()
        await self.queue.put(job)
        return self.queue.qsize()

    async def _run(self) -> None:
        while True:
            job = await self.queue.get()
            try:
                items = await self._download(job.url, job.quality)
                saved = await self._store(job, items)
                if job.notify:
                    await self._notify(job, f"✅ دانلود آماده شد؛ {len(saved)} فایل داخل کمدت ذخیره شد.")
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.exception("Link import failed for %s", job.url)
                if job.notify:
                    await self._notify(job, f"❌ ذخیره لینک انجام نشد: {str(error)[:180]}")
            finally:
                self.queue.task_done()

    async def _download(self, url: str, quality: str) -> list[dict]:
        if self.client is None:
            raise RuntimeError("Import worker is unavailable")
        title = sanitize_filename(await asyncio.to_thread(_oembed_title, url))
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
            if message.photo:
                return "image"
            return None

        for _ in range(80):
            await asyncio.sleep(2)
            async for message in self.client.get_chat_history("allsaverbot", limit=8):
                if message.id <= sent.id or message.id in seen or message.reply_markup:
                    continue
                kind = media_kind(message)
                if kind:
                    seen.add(message.id)
                    found.append({"message": message, "title": title, "type": kind})
            if found:
                await asyncio.sleep(3)
                async for message in self.client.get_chat_history("allsaverbot", limit=12):
                    if message.id <= sent.id or message.id in seen or message.reply_markup:
                        continue
                    kind = media_kind(message)
                    if kind:
                        seen.add(message.id)
                        found.append({"message": message, "title": title, "type": kind})
                break
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
        return found

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
                copied = await item["message"].copy(settings.telegram_storage_channel_id)
                media = copied.video or copied.audio or copied.voice or copied.document or (select_best_thumbnail(copied.photo.sizes) if copied.photo else None)
                if media is None:
                    continue
                suffix = ".mp4" if item["type"] == "video" else ".mp3" if item["type"] == "audio" else ".jpg"
                indexed = f"_{index}" if len(items) > 1 else ""
                stored = File(
                    user_id=user.id,
                    folder_id=folder_id,
                    channel_message_id=copied.id,
                    file_id=media.file_id,
                    file_unique_id=media.file_unique_id,
                    file_name=sanitize_filename(f"{item['title']}{indexed}{suffix}"),
                    description=job.url,
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
        await telegram.tg_client.send_message(job.telegram_id, text, reply_markup=keyboard)


link_importer = LinkImportService()
