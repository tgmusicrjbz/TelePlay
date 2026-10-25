"""FIFO background importer for YouTube and Instagram links via @allsaverbot."""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
import json
import logging
from pathlib import Path
import re
import tempfile
import time
import uuid
from datetime import datetime, timedelta
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

from pyrogram import Client
from pyrogram.errors import Timeout
from pyrogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from sqlalchemy import select

from .auth import create_access_token
from .config import get_settings
from .database import async_session
from .models import AppSetting, File, Folder, TelegramDestination, User
from .link_captions import render_link_caption
from .processing_jobs import create_job, delete_finished_jobs, delete_job, load_jobs, update_job
from .services import sanitize_filename, select_best_thumbnail
from . import telegram
from .bot_messages import bot_message

logger = logging.getLogger(__name__)
settings = get_settings()


class ImportCancelled(Exception):
    """Raised internally when a queued or active import is cancelled."""


@dataclass
class ImportJob:
    url: str
    user_id: int
    telegram_id: int
    folder_id: int | None = None
    quality: str = "480"
    notify: bool = True
    notification_chat_id: int | None = None
    visible_to_user: bool = True
    default_folder: bool = False
    save_to_library: bool = True
    send_to_telegram: bool = False
    destination_ids: list[int] = field(default_factory=list)
    retry_count: int = 0
    id: str = ""


def _clean_source_author(value: object) -> str | None:
    author = re.sub(r"\s+", " ", str(value or "")).strip(" -–—|\n\r\t")
    lowered = author.casefold().lstrip("@")
    if not author or any(marker in lowered for marker in ("allsaver", "all saver", "download bot")):
        return None
    return author[:180]


def _oembed_metadata(url: str) -> tuple[str, str | None]:
    is_youtube = "youtu" in url.lower()
    endpoints = ["https://noembed.com/embed?" + urlencode({"url": url})]
    if is_youtube:
        endpoints.insert(0, "https://www.youtube.com/oembed?" + urlencode({"url": url, "format": "json"}))
    for endpoint in endpoints:
        try:
            request = Request(endpoint, headers={"User-Agent": "Mozilla/5.0 Komod/1.0", "Accept": "application/json"})
            with urlopen(request, timeout=10) as response:
                payload = json.loads(response.read().decode("utf-8"))
                title = str(payload.get("title") or "").strip()
                author = _clean_source_author(payload.get("author_name"))
                if title:
                    return title, author
        except Exception:
            logger.debug("Could not resolve link metadata from %s", endpoint, exc_info=True)
    # yt-dlp exposes the real uploader/channel for both YouTube and many
    # Instagram URLs. It is deliberately metadata-only and downloads no file.
    try:
        from yt_dlp import YoutubeDL
        with YoutubeDL({"quiet": True, "no_warnings": True, "skip_download": True, "extract_flat": True}) as downloader:
            info = downloader.extract_info(url, download=False) or {}
        title = str(info.get("title") or info.get("description") or "").strip().splitlines()[0][:300]
        author = _clean_source_author(
            info.get("uploader") or info.get("channel") or info.get("creator") or info.get("uploader_id")
        )
        if title:
            return title, author
    except Exception:
        logger.debug("Could not resolve metadata with yt-dlp for %s", url, exc_info=True)
    return ("youtube" if is_youtube else "instagram"), None


def _youtube_playlist_entries(url: str) -> tuple[str | None, list[dict[str, str]]]:
    """Resolve a YouTube playlist without downloading its media."""
    if "youtu" not in url.lower() or "list=" not in url.lower():
        return None, []
    try:
        from yt_dlp import YoutubeDL
        with YoutubeDL({"quiet": True, "no_warnings": True, "extract_flat": "in_playlist", "playlistend": 250}) as downloader:
            info = downloader.extract_info(url, download=False)
        entries = []
        for item in (info or {}).get("entries") or []:
            video_id = str(item.get("id") or "").strip()
            item_url = str(item.get("webpage_url") or item.get("url") or "").strip()
            if not item_url and video_id:
                item_url = f"https://www.youtube.com/watch?v={video_id}"
            if item_url and not item_url.startswith("http") and video_id:
                item_url = f"https://www.youtube.com/watch?v={video_id}"
            if item_url:
                entries.append({"url": item_url, "title": str(item.get("title") or "ویدیو").strip()})
        return str((info or {}).get("title") or "پلی‌لیست یوتیوب").strip(), entries
    except Exception:
        logger.warning("Could not expand YouTube playlist", exc_info=True)
        return None, []


def _friendly_import_error(error: Exception) -> str:
    message = str(error).lower()
    if isinstance(error, TimeoutError) or "timeout" in message or "زمان" in message:
        return "سرویس دانلود در زمان مقرر فایل اصلی را آماده نکرد. کمی بعد دوباره امتحان کن."
    if "private" in message or "خصوص" in message:
        return "این محتوا خصوصی است و سرویس دانلود به آن دسترسی ندارد."
    if "not found" in message or "deleted" in message or "حذف" in message:
        return "این محتوا پیدا نشد؛ ممکن است حذف شده باشد یا لینک آن تغییر کرده باشد."
    if "copyright" in message or "restricted" in message:
        return "دسترسی به این محتوا محدود شده و امکان دریافتش وجود ندارد."
    return "فایل اصلی آماده نشد. لینک را بررسی کن و کمی بعد دوباره امتحان کن."


class LinkImportService:
    def __init__(self) -> None:
        self.clients: list[Client] = []
        self.queue: asyncio.Queue[ImportJob] = asyncio.Queue()
        self.tasks: list[asyncio.Task] = []
        self.statuses: dict[str, dict] = {}
        self.controls: dict[str, dict[str, bool]] = {}
        self.active_job_ids: set[str] = set()
        self.durable_job_ids: set[str] = set()
        self._recovered = False

    @property
    def available(self) -> bool:
        return bool(settings.telegram_worker_sessions)

    async def start(self) -> None:
        if not self.available:
            return
        if not self._recovered:
            await self._recover()
            self._recovered = True
        if not self.clients:
            try:
                for index, session in enumerate(settings.telegram_worker_sessions, 1):
                    client = Client(
                        f"komod-worker-{index}",
                        api_id=settings.telegram_api_id,
                        api_hash=settings.telegram_api_hash,
                        session_string=session,
                        in_memory=True,
                        no_updates=True,
                    )
                    await client.start()
                    self.clients.append(client)
            except Exception:
                await asyncio.gather(*(client.stop() for client in self.clients), return_exceptions=True)
                self.clients.clear()
                raise
        if not self.tasks or any(task.done() for task in self.tasks):
            for task in self.tasks:
                task.cancel()
            await asyncio.gather(*self.tasks, return_exceptions=True)
            self.tasks = [
                asyncio.create_task(self._run(client, index), name=f"link-import-worker-{index}")
                for index, client in enumerate(self.clients, 1)
            ]
            logger.info("Background link importer started with %s Telegram account(s)", len(self.clients))

    async def _recover(self) -> None:
        for payload, status in await load_jobs("link", recent_for=timedelta(seconds=45)):
            if not payload or not status:
                continue
            job_id = str(status.get("id") or payload.get("id") or "")
            if not job_id or job_id in self.statuses:
                continue
            if status.get("state") in {"done", "error", "cancelled"}:
                self.statuses[job_id] = status
                self.durable_job_ids.add(job_id)
                continue
            job = ImportJob(
                url=str(payload.get("url") or ""), user_id=int(payload["user_id"]),
                telegram_id=int(payload["telegram_id"]), folder_id=payload.get("folder_id"),
                quality=str(payload.get("quality") or "480"), notify=bool(payload.get("notify", True)),
                notification_chat_id=payload.get("notification_chat_id"),
                visible_to_user=bool(payload.get("visible_to_user", True)),
                default_folder=bool(payload.get("default_folder", False)),
                save_to_library=bool(payload.get("save_to_library", True)),
                send_to_telegram=bool(payload.get("send_to_telegram", False)),
                destination_ids=[int(value) for value in payload.get("destination_ids", []) if str(value).isdigit()],
                retry_count=int(status.get("retry_count") or 0), id=job_id,
            )
            status["visible_to_user"] = job.visible_to_user
            status.update(state="queued", message="ادامه پس از راه‌اندازی دوباره", progress=0)
            self.statuses[job_id] = status
            self.controls[job_id] = {"paused": False, "cancelled": False}
            self.durable_job_ids.add(job_id)
            await self._persist_status(job_id)
            await self.queue.put(job)

    async def stop(self) -> None:
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.tasks.clear()
        await asyncio.gather(*(client.stop() for client in self.clients), return_exceptions=True)
        self.clients.clear()

    async def enqueue(self, job: ImportJob) -> int:
        if not self.available:
            raise RuntimeError("TELEGRAM_WORKER_SESSION یا TELEGRAM_WORKER_SESSIONS تنظیم نشده است")
        if not self.clients or not self.tasks or any(task.done() for task in self.tasks):
            await self.start()
        position = 1 + sum(1 for status in self.statuses.values() if status.get("state") not in {"done", "error", "cancelled"})
        job.id = job.id or uuid.uuid4().hex
        self.statuses[job.id] = {"id": job.id, "user_id": job.user_id, "url": job.url, "quality": job.quality, "folder_id": job.folder_id, "state": "queued", "message": "در صف", "saved": 0, "progress": 0, "retry_count": job.retry_count, "visible_to_user": job.visible_to_user, "created_at": datetime.utcnow().isoformat()}
        self.controls[job.id] = {"paused": False, "cancelled": False}
        await create_job(
            job_id=job.id, user_id=job.user_id, kind="link", title=job.url,
            payload={"id": job.id, "url": job.url, "user_id": job.user_id,
                     "telegram_id": job.telegram_id, "folder_id": job.folder_id,
                     "quality": job.quality, "notify": job.notify, "default_folder": job.default_folder,
                     "notification_chat_id": job.notification_chat_id,
                     "visible_to_user": job.visible_to_user,
                     "save_to_library": job.save_to_library, "send_to_telegram": job.send_to_telegram,
                     "destination_ids": job.destination_ids},
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
        status = self.statuses.get(job_id)
        return status if status and status["user_id"] == user_id else None

    def list_statuses(self, user_id: int) -> list[dict]:
        # Terminal jobs are useful briefly, but keeping them forever made old
        # completed imports reappear whenever the user logged in again.
        cutoff = datetime.utcnow() - timedelta(seconds=45)
        expired = []
        for job_id, item in self.statuses.items():
            if item.get("state") not in {"done", "error", "cancelled"}:
                continue
            finished_at = item.get("finished_at")
            if not finished_at:
                expired.append(job_id)
                continue
            try:
                if datetime.fromisoformat(finished_at) < cutoff:
                    expired.append(job_id)
            except (TypeError, ValueError):
                expired.append(job_id)
        for job_id in expired:
            self.statuses.pop(job_id, None)
            self.controls.pop(job_id, None)
            self.durable_job_ids.discard(job_id)
            try:
                asyncio.get_running_loop().create_task(delete_job(job_id, user_id))
            except RuntimeError:
                pass
        jobs = [dict(item) for item in self.statuses.values() if item["user_id"] == user_id and item.get("visible_to_user", True)]
        return sorted(jobs, key=lambda item: item.get("created_at", ""), reverse=True)[:100]

    def toggle_pause(self, job_id: str, user_id: int) -> dict | None:
        status = self.status(job_id, user_id)
        control = self.controls.get(job_id)
        if status is None or control is None or status["state"] in {"done", "error", "cancelled"}:
            return status
        control["paused"] = not control["paused"]
        if control["paused"]:
            status.update(state="paused", message="متوقف شد")
        else:
            state = "downloading" if job_id in self.active_job_ids else "queued"
            status.update(state=state, message="ادامه یافت")
        self._persist_soon(job_id)
        return status

    def cancel(self, job_id: str, user_id: int) -> dict | None:
        status = self.status(job_id, user_id)
        control = self.controls.get(job_id)
        if status is None or control is None or status["state"] in {"done", "error", "cancelled"}:
            return status
        control["cancelled"] = True
        control["paused"] = False
        status.update(state="cancelled", message="لغو شد", finished_at=datetime.utcnow().isoformat())
        self._persist_soon(job_id)
        return status

    def cancel_all(self, user_id: int) -> int:
        cancellable = [
            job_id for job_id, status in self.statuses.items()
            if status.get("user_id") == user_id
            and status.get("visible_to_user", True)
            and status.get("state") not in {"done", "error", "cancelled"}
        ]
        for job_id in cancellable:
            self.cancel(job_id, user_id)
        return len(cancellable)

    def clear_finished(self, user_id: int) -> int:
        removable = [
            job_id for job_id, status in self.statuses.items()
            if status.get("user_id") == user_id and status.get("state") in {"done", "error", "cancelled"}
        ]
        for job_id in removable:
            self.statuses.pop(job_id, None)
            self.controls.pop(job_id, None)
            self.durable_job_ids.discard(job_id)
        try:
            asyncio.get_running_loop().create_task(delete_finished_jobs("link", user_id))
        except RuntimeError:
            pass
        return len(removable)

    async def _checkpoint(self, job: ImportJob) -> bool:
        control = self.controls.get(job.id, {})
        while control.get("paused") and not control.get("cancelled"):
            await asyncio.sleep(.35)
        return not control.get("cancelled")

    async def _run(self, client: Client, worker_index: int) -> None:
        while True:
            job = await self.queue.get()
            try:
                self.active_job_ids.add(job.id)
                if not await self._checkpoint(job):
                    continue
                self.statuses[job.id].update(
                    state="downloading", message="در حال دریافت فایل اصلی", progress=10,
                    worker=worker_index,
                )
                await self._persist_status(job.id)
                playlist_title, playlist_entries = await asyncio.to_thread(_youtube_playlist_entries, job.url)
                sources = playlist_entries or [{"url": job.url, "title": ""}]
                items: list[dict] = []
                for source_index, source in enumerate(sources, 1):
                    if not await self._checkpoint(job):
                        break
                    if len(sources) > 1:
                        progress = 10 + round((source_index - 1) / len(sources) * 65)
                        self.statuses[job.id].update(message=f"مورد {source_index} از {len(sources)}", progress=progress)
                        await self._persist_status(job.id)
                    downloaded = await self._download(client, job, source["url"], job.quality)
                    for item_index, item in enumerate(downloaded, 1):
                        item["source_url"] = source["url"]
                        item["collection_title"] = playlist_title
                        item["sequence"] = source_index if playlist_entries else item_index
                        if source.get("title") and item.get("title") in {"youtube", "instagram", ""}:
                            item["title"] = source["title"]
                    items.extend(downloaded)
                if not await self._checkpoint(job):
                    continue
                self.statuses[job.id].update(state="saving", message="در حال ذخیره در کمد", progress=80)
                await self._persist_status(job.id)
                saved = await self._store(client, job, items)
                if not saved:
                    raise RuntimeError("هیچ فایل قابل ذخیره‌ای در پاسخ پیدا نشد")
                if job.send_to_telegram:
                    await self._send_to_user(job, saved)
                if not job.save_to_library:
                    await self._discard_library_copies(saved)
                if job.notify:
                    count = str(len(saved)).translate(str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹"))
                    destination = "در تلگرام فرستاده و در کمد ذخیره شد" if job.send_to_telegram and job.save_to_library else "در تلگرام فرستاده شد" if job.send_to_telegram else "به کمد اضافه شد"
                    await self._notify(job, await bot_message("link_finished", count=count, destination=destination))
                self.statuses[job.id].update(state="done", message="آماده شد", saved=len(saved), progress=100, finished_at=datetime.utcnow().isoformat())
                await self._persist_status(job.id)
            except asyncio.CancelledError:
                raise
            except ImportCancelled:
                self.statuses[job.id].update(state="cancelled", message="لغو شد", finished_at=datetime.utcnow().isoformat())
                await self._persist_status(job.id)
            except Exception as error:
                friendly_error = _friendly_import_error(error)
                if isinstance(error, TimeoutError) and job.retry_count < 2 and not self.controls.get(job.id, {}).get("cancelled"):
                    job.retry_count += 1
                    logger.warning("Link import timed out; retrying %s (%s/2)", job.url, job.retry_count)
                    self.statuses[job.id].update(
                        state="queued", message=f"تلاش دوباره ({job.retry_count + 1} از 3)",
                        progress=0, retry_count=job.retry_count,
                    )
                    await self._persist_status(job.id)
                    await asyncio.sleep(2)
                    if await self._checkpoint(job):
                        await self.queue.put(job)
                    continue
                logger.exception("Link import failed for %s", job.url)
                if job.notify:
                    await self._notify(job, await bot_message("link_failed", error=friendly_error))
                self.statuses[job.id].update(state="error", message=friendly_error, finished_at=datetime.utcnow().isoformat())
                await self._persist_status(job.id)
            finally:
                self.active_job_ids.discard(job.id)
                self.queue.task_done()

    async def _download(self, client: Client, job: ImportJob, url: str, quality: str) -> list[dict]:
        raw_title, source_author = await asyncio.to_thread(_oembed_metadata, url)
        title = sanitize_filename(raw_title)
        is_instagram = "instagram.com" in url.lower()
        sent = await client.send_message("allsaverbot", url)
        clicked: set[str] = set()
        found: list[dict] = []
        seen: set[int] = set()
        audio_mode = quality.lower() == "audio"

        async def click_button(message, button) -> bool:
            try:
                if getattr(button, "callback_data", None):
                    await client.request_callback_answer(
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

        def button_key(message, button) -> str:
            callback = getattr(button, "callback_data", None)
            if isinstance(callback, bytes):
                callback = callback.hex()
            return f"{message.id}:{callback or button.text}"

        def button_ready(button) -> bool:
            text = (getattr(button, "text", "") or "").strip()
            return bool(text) and not any(marker in text for marker in ("⏳", "⌛", "…"))

        def media_kind(message) -> str | None:
            mime = (getattr(message.document, "mime_type", "") or "").lower() if message.document else ""
            if audio_mode:
                return "audio" if message.audio or message.voice or mime.startswith("audio/") else None
            if message.video or mime.startswith("video/"):
                return "video"
            # A video request may receive a preview/audio choice before the
            # requested resolution. Accepting it here made 480p imports save
            # the audio by mistake.
            if message.audio or message.voice or mime.startswith("audio/"):
                return None
            # YouTube download bots commonly send the thumbnail first. It must
            # never be mistaken for the requested video. Instagram photos are
            # real carousel items and should be preserved.
            if message.photo and is_instagram:
                return "image"
            return None

        started_at = time.monotonic()
        last_media_at: float | None = None
        language_wait_started: float | None = None
        language_retries = 0
        while time.monotonic() - started_at < 180:
            await asyncio.sleep(2)
            if not await self._checkpoint(job):
                raise ImportCancelled()
            received_now = 0
            async for message in client.get_chat_history("allsaverbot", limit=60):
                if message.id <= sent.id or message.id in seen or message.reply_markup:
                    continue
                kind = media_kind(message)
                if kind:
                    seen.add(message.id)
                    caption = str(getattr(message, "caption", "") or getattr(message, "text", "") or "").strip()
                    inferred_author = source_author
                    if not inferred_author and caption:
                        first_line = caption.splitlines()[0].strip()
                        candidate = _clean_source_author(first_line)
                        if candidate and len(candidate) <= 120 and not candidate.startswith("http"):
                            inferred_author = candidate
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
            async for raw in client.get_chat_history("allsaverbot", limit=4):
                if raw.id <= sent.id or not raw.reply_markup:
                    continue
                message = await client.get_messages("allsaverbot", raw.id)
                if not message.reply_markup:
                    continue
                buttons = [button for row in message.reply_markup.inline_keyboard for button in row if not getattr(button, "url", None)]
                ready_buttons = [button for button in buttons if button_ready(button)]
                # AllSaver sometimes first asks for a language and may only
                # expose an English/UK option. A button containing an hourglass
                # is still being prepared. Never click or mark that callback as
                # consumed: AllSaver often keeps the same callback_data after
                # editing the label, so doing so would permanently skip the
                # ready button on later polls.
                language_buttons = [button for button in buttons if (
                    any(flag in button.text for flag in ("🇬🇧", "🇺🇸", "🌐", "🌏"))
                    or re.search(r"\b(english|en)\b", button.text, re.IGNORECASE)
                )]
                if language_buttons and not any(button_ready(button) for button in language_buttons):
                    language_wait_started = language_wait_started or time.monotonic()
                    waited = int(time.monotonic() - language_wait_started)
                    self.statuses[job.id].update(message=f"آماده‌سازی زبان ویدیو · {waited} ثانیه", progress=min(34, 8 + waited // 2))
                    await self._persist_status(job.id)
                    # AllSaver occasionally leaves both language callbacks on
                    # an hourglass forever. Re-sending creates a fresh job
                    # instead of blocking Komod's entire FIFO queue.
                    if waited >= 32 and language_retries < 2:
                        sent = await client.send_message("allsaverbot", url)
                        clicked.clear()
                        language_retries += 1
                        language_wait_started = time.monotonic()
                        self.statuses[job.id].update(message="درخواست تازه برای دریافت ویدیو فرستاده شد")
                        await self._persist_status(job.id)
                    continue
                if language_buttons:
                    language_wait_started = None
                language_button = next((button for button in language_buttons if button_key(message, button) not in clicked and button_ready(button)), None)
                if language_button and not re.search(r"\b(360|480|720|1080)p?\b", language_button.text, re.IGNORECASE):
                    if await click_button(message, language_button):
                        clicked.add(button_key(message, language_button))
                        break
                if audio_mode:
                    audio_button = next((button for button in ready_buttons if any(word in button.text.lower() for word in ("audio", "صوت", "صدا", "mp3")) and button_key(message, button) not in clicked), None)
                    if audio_button and await click_button(message, audio_button):
                        clicked.add(button_key(message, audio_button))
                        break
                quality_buttons = [button for button in ready_buttons if re.search(r"\b(360|480|720|1080)p?\b", button.text, re.IGNORECASE)] if not audio_mode else []
                candidates = quality_buttons or [button for button in ready_buttons if not any(word in button.text.lower() for word in ("back", "بازگشت", "назад"))]
                target = next((button for button in candidates if quality != "auto" and quality in button.text and button_key(message, button) not in clicked), None) if quality_buttons else None
                if target is None and quality_buttons:
                    # If the requested resolution is unavailable, choose the
                    # best ready option instead of leaving the job stuck.
                    target = max(
                        (button for button in quality_buttons if button_key(message, button) not in clicked),
                        key=lambda button: int(re.search(r"(360|480|720|1080)", button.text).group(1)),
                        default=None,
                    )
                target = target or next((button for button in candidates if button_key(message, button) not in clicked), None)
                if target:
                    if await click_button(message, target):
                        clicked.add(button_key(message, target))
                        break
            async for message in client.get_chat_history("allsaverbot", limit=3):
                if message.id > sent.id and message.text and not message.reply_markup and any(word in message.text.lower() for word in ("error", "ошибка", "не удалось")):
                    raise RuntimeError(message.text[:180])
        if not found:
            raise TimeoutError("زمان دریافت فایل از سرویس دانلود تمام شد")
        return sorted(found, key=lambda item: item["message"].id)

    async def _copy_to_storage(self, client: Client, message, item_type: str, filename: str, channel_id: int):
        """Copy server-side when possible; fall back to bot re-upload.

        The Telegram account behind TELEGRAM_WORKER_SESSION does not need to be
        a member of the storage channel when the fallback is used.
        """
        try:
            return await message.copy(channel_id)
        except Exception:
            logger.warning("Worker could not copy media to storage; using bot upload fallback", exc_info=True)
        if telegram.tg_client is None:
            raise RuntimeError("ربات ذخیره‌سازی در دسترس نیست")
        with tempfile.TemporaryDirectory(prefix="komod-link-") as temp_dir:
            target = str(Path(temp_dir) / filename)
            downloaded = await client.download_media(message, file_name=target)
            if not downloaded:
                raise RuntimeError("دریافت فایل اصلی کامل نشد")
            if item_type == "video":
                return await telegram.tg_client.send_video(channel_id, downloaded, supports_streaming=True)
            if item_type == "audio":
                return await telegram.tg_client.send_audio(channel_id, downloaded)
            if item_type == "image":
                return await telegram.tg_client.send_photo(channel_id, downloaded)
            return await telegram.tg_client.send_document(channel_id, downloaded)

    async def _store(self, client: Client, job: ImportJob, items: list[dict]) -> list[File]:
        saved: list[File] = []
        async with async_session() as db:
            user = await db.get(User, job.user_id)
            if user is None:
                raise RuntimeError("کاربر پیدا نشد")
            target_channel_id = user.storage_channel_id or settings.telegram_storage_channel_id
            folder_id = job.folder_id if job.save_to_library else None
            if job.save_to_library and folder_id is None and job.default_folder:
                default_name = "Youtube" if "youtu" in job.url.lower() else "Instagram"
                folder = (await db.execute(select(Folder).where(Folder.user_id == user.id, Folder.parent_id.is_(None), Folder.name == default_name))).scalar_one_or_none()
                if folder is None:
                    folder = Folder(user_id=user.id, name=default_name, parent_id=None)
                    db.add(folder)
                    await db.flush()
                folder_id = folder.id
            if job.save_to_library and len(items) > 1:
                collection_name = sanitize_filename(
                    items[0].get("collection_title")
                    or (f"پست اینستاگرام {datetime.now().strftime('%Y-%m-%d %H-%M')}" if "instagram" in job.url.lower() else "مجموعه دانلودشده")
                )[:255]
                collection = Folder(user_id=user.id, name=collection_name, parent_id=folder_id)
                db.add(collection)
                await db.flush()
                folder_id = collection.id
            for index, item in enumerate(items, 1):
                suffix = ".mp4" if item["type"] == "video" else ".mp3" if item["type"] == "audio" else ".jpg"
                sequence = int(item.get("sequence") or index)
                indexed = f" - {sequence:02d}" if len(items) > 1 else ""
                filename = sanitize_filename(f"{item['title']}{indexed}{suffix}")
                copied = await self._copy_to_storage(client, item["message"], item["type"], filename, target_channel_id)
                media = copied.video or copied.audio or copied.voice or copied.document or (select_best_thumbnail(copied.photo.sizes) if copied.photo else None)
                if media is None:
                    continue
                is_youtube = "youtu" in (item.get("source_url") or job.url).lower()
                global_key = "caption_template_youtube" if is_youtube else "caption_template_instagram"
                global_template = await db.get(AppSetting, global_key)
                caption_template = (
                    global_template.value if global_template and global_template.value.strip()
                    else user.youtube_caption_template if is_youtube else user.instagram_caption_template
                )
                description = render_link_caption(
                    caption_template,
                    title=item.get("title"), author=item.get("author"),
                    url=item.get("source_url") or job.url,
                    platform="یوتیوب" if is_youtube else "اینستاگرام",
                    media_type={"video": "ویدیو", "audio": "صدا", "image": "عکس"}.get(item["type"], "فایل"),
                    quality="صدا" if job.quality == "audio" else f"{job.quality}p" if str(job.quality).isdigit() else job.quality,
                )
                stored = File(
                    user_id=user.id,
                    folder_id=folder_id,
                    channel_message_id=copied.id,
                    storage_channel_id=target_channel_id,
                    file_id=media.file_id,
                    file_unique_id=media.file_unique_id,
                    file_name=filename,
                    description=description,
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

    async def _send_to_user(self, job: ImportJob, files: list[File]) -> None:
        if telegram.tg_client is None:
            raise RuntimeError("ربات برای ارسال فایل در دسترس نیست")
        chat_ids: list[int] = []
        if job.destination_ids:
            async with async_session() as db:
                destinations = (await db.execute(select(TelegramDestination).where(
                    TelegramDestination.id.in_(job.destination_ids),
                    TelegramDestination.user_id == job.user_id,
                    TelegramDestination.enabled.is_(True),
                ))).scalars().all()
                chat_ids = [destination.chat_id for destination in destinations]
        elif job.send_to_telegram:
            async with async_session() as db:
                destination = (await db.execute(select(TelegramDestination).where(
                    TelegramDestination.user_id == job.user_id,
                    TelegramDestination.enabled.is_(True),
                    TelegramDestination.is_default.is_(True),
                ))).scalars().first()
                if destination is not None:
                    chat_ids = [destination.chat_id]
        if not chat_ids:
            chat_ids = [job.telegram_id]
        for file in files:
            for chat_id in dict.fromkeys(chat_ids):
                await telegram.copy_message_balanced(
                    chat_id=chat_id,
                    from_chat_id=file.storage_channel_id,
                    message_id=file.channel_message_id,
                    caption=file.description or "",
                )

    async def _discard_library_copies(self, files: list[File]) -> None:
        """Remove temporary storage records after Telegram-only delivery."""
        async with async_session() as db:
            for file in files:
                stored = await db.get(File, file.id)
                if stored is not None:
                    await db.delete(stored)
            await db.commit()
        if telegram.tg_client is None:
            return
        for file in files:
            try:
                await telegram.tg_client.delete_messages(file.storage_channel_id, file.channel_message_id)
            except Exception:
                logger.warning("Could not remove temporary link import message %s", file.channel_message_id, exc_info=True)

    async def _notify(self, job: ImportJob, text: str) -> None:
        if telegram.tg_client is None:
            return
        target_chat_id = job.notification_chat_id or job.telegram_id
        keyboard = None
        if target_chat_id == job.telegram_id:
            token = quote(create_access_token(job.telegram_id), safe="")
            url = f"{settings.web_base_url.rstrip('/')}/auth?token={token}"
            if url.startswith("https://"):
                keyboard = InlineKeyboardMarkup([[InlineKeyboardButton("🗄️ باز کردن کمد", web_app=WebAppInfo(url=url))]])
        message = await telegram.tg_client.send_message(target_chat_id, text, reply_markup=keyboard)
        async def remove_later() -> None:
            await asyncio.sleep(45)
            try:
                await telegram.tg_client.delete_messages(target_chat_id, message.id)
            except Exception:
                pass
        asyncio.create_task(remove_later())


link_importer = LinkImportService()
