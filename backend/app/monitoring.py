"""Lightweight scheduled checks for YouTube, Instagram, and Telegram sources."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from pyrogram import Client
from sqlalchemy import select

from .database import async_session
from .downloader import ImportJob, link_importer
from .models import SourceMonitor, TelegramDestination, User
from .tts import TTSJob, consume_tts_quota, load_tts_settings, tts_queue
from .gemini_keys import decrypt_user_keys
from .config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class TelegramMonitorClientPool:
    """Dedicated Telegram user sessions used only for source monitoring."""

    def __init__(self) -> None:
        self.clients: list[Client] = []
        self.accounts: list[dict[str, object]] = []
        self.locks: list[asyncio.Lock] = []

    @property
    def available(self) -> bool:
        return bool(settings.telegram_monitor_sessions)

    async def start(self) -> None:
        if self.clients or not self.available:
            return
        for index, session in enumerate(settings.telegram_monitor_sessions):
            client = Client(
                f"komod-monitor-{index + 1}", api_id=settings.telegram_api_id,
                api_hash=settings.telegram_api_hash, session_string=session,
                in_memory=True, no_updates=True,
            )
            try:
                await client.start()
                me = await client.get_me()
                self.clients.append(client)
                self.locks.append(asyncio.Lock())
                self.accounts.append({
                    "index": index,
                    "telegram_id": int(me.id),
                    "name": " ".join(value for value in (me.first_name, me.last_name) if value).strip() or str(me.id),
                    "username": me.username,
                })
            except Exception:
                logger.exception("Telegram monitor account %s could not start", index + 1)
                try:
                    await client.stop()
                except Exception:
                    pass
        if not self.clients:
            raise RuntimeError("هیچ حساب پایش تلگرام متصل نشد.")

    async def stop(self) -> None:
        await asyncio.gather(*(client.stop() for client in self.clients), return_exceptions=True)
        self.clients.clear()
        self.accounts.clear()
        self.locks.clear()

    async def selected(self, configured_index: object) -> tuple[Client, asyncio.Lock]:
        if not self.clients:
            await self.start()
        try:
            index = int(configured_index or 0)
        except (TypeError, ValueError):
            index = 0
        # Environment entries can fail independently. Match the original env
        # index first, then fall back to the first healthy monitor account.
        position = next((position for position, item in enumerate(self.accounts) if item["index"] == index), None)
        if position is None:
            if not self.clients:
                raise RuntimeError("حساب پایش تلگرام در دسترس نیست.")
            position = 0
        return self.clients[position], self.locks[position]


telegram_monitor_pool = TelegramMonitorClientPool()


def _json(raw: str) -> dict:
    try:
        value = json.loads(raw or "{}")
        return value if isinstance(value, dict) else {}
    except (TypeError, ValueError):
        return {}


def _extract_entries(source_url: str) -> list[dict]:
    from yt_dlp import YoutubeDL
    options = {
        "quiet": True, "no_warnings": True, "skip_download": True,
        "extract_flat": "in_playlist", "playlistend": 30,
    }
    with YoutubeDL(options) as downloader:
        info = downloader.extract_info(source_url, download=False) or {}
    raw_entries = info.get("entries") or [info]
    entries: list[dict] = []
    for item in raw_entries:
        if not item:
            continue
        entry_id = str(item.get("id") or item.get("display_id") or "").strip()
        url = str(item.get("webpage_url") or item.get("original_url") or item.get("url") or "").strip()
        if url and not url.startswith("http") and entry_id and "youtu" in source_url:
            url = f"https://www.youtube.com/watch?v={entry_id}"
        if entry_id and url:
            entries.append({
                "id": entry_id, "url": url, "title": str(item.get("title") or ""),
                "description": str(item.get("description") or ""),
                "type": "audio" if item.get("vcodec") == "none" else "video",
            })
    return entries


def _matches(entry: dict, filters: dict) -> bool:
    haystack = f"{entry.get('title', '')}\n{entry.get('description', '')}".casefold()
    include = [str(value).casefold() for value in filters.get("include_keywords", []) if str(value).strip()]
    exclude = [str(value).casefold() for value in filters.get("exclude_keywords", []) if str(value).strip()]
    types = [str(value) for value in filters.get("media_types", []) if str(value).strip()]
    mode = filters.get("keyword_mode", "or")
    if include and not (all(value in haystack for value in include) if mode == "and" else any(value in haystack for value in include)):
        return False
    if exclude and any(value in haystack for value in exclude):
        return False
    return not types or entry.get("type") in types


class SourceMonitorService:
    def __init__(self) -> None:
        self.task: asyncio.Task | None = None

    async def start(self) -> None:
        if self.task is None or self.task.done():
            self.task = asyncio.create_task(self._loop(), name="source-monitors")

    async def stop(self) -> None:
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)
            self.task = None

    async def _loop(self) -> None:
        while True:
            try:
                await self.run_due()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Source monitor loop failed")
            await asyncio.sleep(60)

    async def run_due(self) -> None:
        now = datetime.utcnow()
        iran_now = datetime.now(ZoneInfo("Asia/Tehran"))
        async with async_session() as db:
            monitors = (await db.execute(select(SourceMonitor).where(SourceMonitor.enabled.is_(True)))).scalars().all()
            due_ids = []
            for item in monitors:
                if item.run_at:
                    try:
                        hour, minute = (int(value) for value in item.run_at.split(":"))
                        scheduled = iran_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                        checked_today = item.last_checked_at and item.last_checked_at.replace(tzinfo=ZoneInfo("UTC")).astimezone(ZoneInfo("Asia/Tehran")).date() == iran_now.date()
                        if iran_now >= scheduled and not checked_today:
                            due_ids.append(item.id)
                    except (TypeError, ValueError):
                        pass
                elif not item.last_checked_at or item.last_checked_at <= now - timedelta(minutes=max(5, item.interval_minutes)):
                    due_ids.append(item.id)
        semaphore = asyncio.Semaphore(max(1, settings.monitor_worker_concurrency))

        async def run_due_monitor(monitor_id: int) -> None:
            async with semaphore:
                try:
                    await self.run_one(monitor_id)
                except Exception:
                    logger.exception("Monitor %s failed", monitor_id)

        await asyncio.gather(*(run_due_monitor(monitor_id) for monitor_id in due_ids))

    async def run_one(self, monitor_id: int) -> dict:
        async with async_session() as db:
            monitor = await db.get(SourceMonitor, monitor_id)
            if monitor is None:
                raise ValueError("پایش پیدا نشد.")
            user = await db.get(User, monitor.user_id)
            if user is None:
                raise ValueError("کاربر پایش پیدا نشد.")
            is_admin = user.telegram_id in settings.admin_users
            if not is_admin and not user.can_use_monitors:
                monitor.enabled = False
                monitor.last_error = "دسترسی پایش این حساب توسط مدیر غیرفعال شده است."
                await db.commit()
                raise PermissionError(monitor.last_error)
            if monitor.source_type == "saved_messages" and not is_admin:
                monitor.enabled = False
                monitor.last_error = "پایش Saved Messages فقط برای مدیر اصلی فعال است."
                await db.commit()
                raise PermissionError(monitor.last_error)
            filters = _json(monitor.filters_json)
            actions = _json(monitor.actions_json)
            previous_cursor = monitor.last_cursor
            try:
                if monitor.source_type in {"youtube", "instagram"}:
                    entries = await asyncio.to_thread(_extract_entries, monitor.source_url)
                    if not entries:
                        raise RuntimeError("موردی از این منبع پیدا نشد.")
                    newest_cursor = entries[0]["id"]
                    fresh: list[dict] = []
                    if previous_cursor:
                        for entry in entries:
                            if entry["id"] == previous_cursor:
                                break
                            fresh.append(entry)
                    elif actions.get("include_existing"):
                        fresh = entries[:max(1, min(int(actions.get("initial_count", 1)), 10))]
                    destination_ids = [int(value) for value in actions.get("destination_ids", [])]
                    queued = 0
                    for entry in reversed(fresh):
                        if not _matches(entry, filters):
                            continue
                        await link_importer.enqueue(ImportJob(
                            url=entry["url"], user_id=user.id, telegram_id=user.telegram_id,
                            folder_id=actions.get("folder_id"), quality=str(actions.get("quality") or "480"),
                            notify=False, default_folder=actions.get("folder_id") is None,
                            save_to_library=bool(actions.get("save_to_library", True)),
                            send_to_telegram=bool(actions.get("send_to_telegram", True)),
                            destination_ids=destination_ids,
                        ))
                        queued += 1
                    monitor.last_cursor = newest_cursor
                else:
                    queued = await self._run_telegram(monitor, user, filters, actions)
                monitor.last_checked_at = datetime.utcnow()
                monitor.last_error = None
                await db.commit()
                return {"queued": queued, "checked_at": monitor.last_checked_at}
            except Exception as error:
                monitor.last_checked_at = datetime.utcnow()
                monitor.last_error = str(error)[:1000]
                await db.commit()
                raise

    async def _run_telegram(self, monitor: SourceMonitor, user: User, filters: dict, actions: dict) -> int:
        # Reading history (including Saved Messages) is a user-session-only
        # MTProto operation. Bot clients fail here with BOT_METHOD_INVALID.
        if not telegram_monitor_pool.available:
            raise RuntimeError("برای پایش تلگرام باید TELEGRAM_MONITOR_SESSION یا TELEGRAM_MONITOR_SESSIONS تنظیم شود.")
        selected_index = actions.get("monitor_session_index")
        if selected_index is None:
            selected_index = monitor.id % max(1, len(settings.telegram_monitor_sessions))
        client, client_lock = await telegram_monitor_pool.selected(selected_index)
        source = "me" if monitor.source_type == "saved_messages" else monitor.source_url.strip()
        destinations: list[int] = []
        destination_ids = [int(value) for value in actions.get("destination_ids", [])]
        async with async_session() as db:
            if destination_ids:
                rows = (await db.execute(select(TelegramDestination).where(
                    TelegramDestination.id.in_(destination_ids),
                    TelegramDestination.user_id == user.id,
                    TelegramDestination.enabled.is_(True),
                ))).scalars().all()
                destinations = [row.chat_id for row in rows]
        if not destinations:
            destinations = [user.telegram_id]
        cursor = int(monitor.last_cursor or 0)
        messages = []
        async with client_lock:
            async for message in client.get_chat_history(source, limit=50):
                if message.id <= cursor:
                    break
                messages.append(message)
        if not messages:
            return 0
        if not monitor.last_cursor and not actions.get("include_existing"):
            monitor.last_cursor = str(max(message.id for message in messages))
            return 0
        sent = 0
        for message in reversed(messages):
            text = str(message.text or message.caption or "")
            entry = {"title": text[:160], "description": text, "type": "text" if message.text else "video" if message.video else "audio" if message.audio or message.voice else "image" if message.photo else "document"}
            if not _matches(entry, filters):
                continue
            if text and actions.get("text_to_speech"):
                async with async_session() as db:
                    owner = await db.get(User, user.id)
                    await consume_tts_quota(db, user.id, len(text))
                    preferences = load_tts_settings(owner)
                    personal_keys = decrypt_user_keys(owner.gemini_api_keys_encrypted)
                for chat_id in destinations:
                    await tts_queue.enqueue(TTSJob(
                        user_id=user.id, telegram_id=user.telegram_id, output_chat_id=chat_id,
                        text=text, title=str(actions.get("tts_title") or entry["title"] or "صدای پست")[:160],
                        folder_id=None, preferences=preferences, output_mode="telegram",
                        api_keys=personal_keys,
                    ))
                    sent += 1
            elif actions.get("copy_source", True):
                for chat_id in destinations:
                    await message.copy(chat_id)
                    sent += 1
            if monitor.source_type == "saved_messages" and actions.get("delete_source"):
                await client.delete_messages("me", message.id)
        monitor.last_cursor = str(max(message.id for message in messages))
        return sent


source_monitor_service = SourceMonitorService()
