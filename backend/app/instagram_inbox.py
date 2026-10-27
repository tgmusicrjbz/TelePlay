"""Approved Instagram DM bridge into Komod's existing link importer."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import re
import secrets
from datetime import datetime
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

from sqlalchemy import select

from . import telegram
from .config import get_settings
from .database import async_session
from .downloader import ImportJob, link_importer
from .models import InstagramInboxEvent, InstagramInboxSender, TelegramDestination, User


logger = logging.getLogger(__name__)
settings = get_settings()
PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
INSTAGRAM_URL_RE = re.compile(r"https?://(?:www\.)?instagram\.com/(?:p|reel|tv)/[^\s?#/]+", re.IGNORECASE)


def normalize_instagram_post_url(value: object) -> str | None:
    """Accept only canonical Instagram post/reel URLs."""
    raw = str(value or "").strip()
    match = INSTAGRAM_URL_RE.search(raw)
    if not match:
        return None
    parsed = urlparse(match.group(0))
    host = (parsed.hostname or "").lower()
    if host != "instagram.com" and not host.endswith(".instagram.com"):
        return None
    path = parsed.path.rstrip("/") + "/"
    return urlunparse(("https", "www.instagram.com", path, "", "", ""))


def extract_shared_posts(payload: dict) -> list[dict[str, str]]:
    """Extract sender, message id and post URL from Meta messaging webhooks."""
    found: list[dict[str, str]] = []
    for entry in payload.get("entry") or []:
        for item in entry.get("messaging") or []:
            sender_id = str((item.get("sender") or {}).get("id") or "").strip()
            message = item.get("message") or {}
            if not sender_id or message.get("is_echo"):
                continue
            candidates: list[object] = [message.get("text")]
            for attachment in message.get("attachments") or []:
                attachment_payload = attachment.get("payload") or {}
                candidates.extend((attachment_payload.get("url"), attachment_payload.get("link")))
            urls = list(dict.fromkeys(filter(None, (normalize_instagram_post_url(value) for value in candidates))))
            for index, url in enumerate(urls):
                message_id = str(message.get("mid") or "").strip()
                if not message_id:
                    fingerprint = json.dumps(item, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
                    message_id = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
                found.append({"sender_id": sender_id, "event_id": f"{message_id}:{index}", "url": url})
    return found


def extract_text_messages(payload: dict) -> list[dict[str, str]]:
    """Extract ordinary DM text so senders can manage their delivery destination."""
    found: list[dict[str, str]] = []
    for entry in payload.get("entry") or []:
        for item in entry.get("messaging") or []:
            sender_id = str((item.get("sender") or {}).get("id") or "").strip()
            message = item.get("message") or {}
            text = str(message.get("text") or "").strip()
            if not sender_id or not text or message.get("is_echo") or normalize_instagram_post_url(text):
                continue
            message_id = str(message.get("mid") or "").strip()
            if not message_id:
                fingerprint = json.dumps(item, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
                message_id = hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()
            found.append({"sender_id": sender_id, "event_id": message_id, "text": text})
    return found


async def instagram_destination_reply(db, sender: InstagramInboxSender, text: str) -> str | None:
    """Handle the small, safe destination menu exposed inside Instagram DM."""
    normalized = text.strip().translate(str.maketrans("۰۱۲۳۴۵۶۷۸۹", "0123456789"))
    if not (normalized == "مقصد" or normalized.startswith("مقصد ")):
        return None
    if sender.telegram_user_id is None:
        return "اول حسابت رو به تلگرام وصل کن؛ بعد می‌تونی مقصد ارسال رو همین‌جا انتخاب کنی 🌱"
    destinations = (await db.execute(
        select(TelegramDestination).where(
            TelegramDestination.user_id == sender.telegram_user_id,
            TelegramDestination.enabled.is_(True),
        ).order_by(TelegramDestination.is_default.desc(), TelegramDestination.created_at)
    )).scalars().all()
    if normalized == "مقصد":
        selected = sender.selected_destination_id
        rows = ["مقصد ارسال رو انتخاب کن 👇", "0️⃣ گفت‌وگوی خصوصی تلگرام"]
        rows.extend(f"{index}️⃣ {item.name}" for index, item in enumerate(destinations, start=1))
        rows.append("\nمثلاً بنویس «مقصد 2». برای ارسال به خودت بنویس «مقصد 0»." )
        if selected:
            current = next((item.name for item in destinations if item.id == selected), "گفت‌وگوی خصوصی تلگرام")
            rows.append(f"\nمقصد فعلی: {current} ✅")
        return "\n".join(rows)
    choice = normalized.removeprefix("مقصد").strip()
    if not choice.isdigit():
        return "شماره مقصد رو مثل «مقصد 1» بفرست. برای دیدن فهرست فقط بنویس «مقصد»."
    position = int(choice)
    if position == 0:
        sender.selected_destination_id = None
        await db.commit()
        return "از این به بعد پست‌ها به گفت‌وگوی خصوصی تلگرامت فرستاده می‌شن ✅"
    if position < 1 or position > len(destinations):
        return "این شماره توی فهرست مقصدها نیست. دوباره فقط بنویس «مقصد» تا فهرست تازه رو ببینی."
    selected = destinations[position - 1]
    sender.selected_destination_id = selected.id
    await db.commit()
    return f"انجام شد ✅ از این به بعد پست‌ها به «{selected.name}» فرستاده می‌شن."


def new_pairing_code() -> str:
    return "".join(secrets.choice(PAIRING_ALPHABET) for _ in range(8))


def verify_meta_signature(raw_body: bytes, supplied_signature: str, app_secret: str) -> bool:
    if not raw_body or not app_secret or not supplied_signature.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(supplied_signature, expected)


async def dispatch_pending_events(sender_id: int) -> int:
    """Queue pending shares once both the Telegram link and admin approval exist."""
    queued = 0
    async with async_session() as db:
        sender = await db.get(InstagramInboxSender, sender_id)
        if sender is None or sender.blocked or not sender.approved or sender.telegram_user_id is None:
            return 0
        user = await db.get(User, sender.telegram_user_id)
        if user is None or not user.is_active or user.telegram_id <= 0 or not link_importer.available:
            return 0
        events = (await db.execute(
            select(InstagramInboxEvent)
            .where(InstagramInboxEvent.sender_id == sender.id, InstagramInboxEvent.status == "pending")
            .order_by(InstagramInboxEvent.received_at)
        )).scalars().all()
        destination = None
        if sender.selected_destination_id is not None:
            destination = (await db.execute(select(TelegramDestination).where(
                TelegramDestination.id == sender.selected_destination_id,
                TelegramDestination.user_id == user.id,
                TelegramDestination.enabled.is_(True),
            ))).scalar_one_or_none()
            if destination is None:
                sender.selected_destination_id = None
                await db.commit()
        for event in events:
            try:
                cached = json.loads(event.cached_files_json or "[]")
                if cached:
                    for item in cached:
                        await telegram.copy_message_balanced(
                            chat_id=destination.chat_id if destination is not None else user.telegram_id,
                            from_chat_id=int(item["storage_channel_id"]),
                            message_id=int(item["channel_message_id"]),
                            caption=str(item.get("description") or ""),
                        )
                    event.status = "reused"
                    event.queued_at = datetime.utcnow()
                    event.error = None
                    sender.forwarded_count += 1
                    queued += 1
                    await db.commit()
                    continue
                job = ImportJob(
                    url=event.shared_url,
                    user_id=user.id,
                    telegram_id=user.telegram_id,
                    folder_id=None,
                    quality="auto",
                    notify=False,
                    visible_to_user=True,
                    default_folder=sender.save_to_library,
                    save_to_library=sender.save_to_library,
                    send_to_telegram=True,
                    destination_ids=[destination.id] if destination is not None else [],
                    instagram_sender_id=sender.id,
                    instagram_event_id=event.id,
                )
                await link_importer.enqueue(job)
                event.status = "queued"
                event.import_job_id = job.id
                event.queued_at = datetime.utcnow()
                event.error = None
                sender.forwarded_count += 1
                queued += 1
                await db.commit()
            except Exception as error:
                event.status = "failed"
                event.error = str(error)[:1000]
                await db.commit()
                logger.exception("Could not queue Instagram inbox event %s", event.id)
    return queued


async def record_instagram_delivery(event_id: int, files: list) -> None:
    """Keep Telegram storage references so repeated shares need no download."""
    async with async_session() as db:
        event = await db.get(InstagramInboxEvent, event_id)
        if event is None:
            return
        event.cached_files_json = json.dumps([{
            "storage_channel_id": int(file.storage_channel_id),
            "channel_message_id": int(file.channel_message_id),
            "description": file.description or "",
        } for file in files], ensure_ascii=False)
        event.status = "delivered"
        event.error = None
        await db.commit()


async def mark_instagram_delivery_failed(event_id: int, error: str) -> None:
    """Persist the final importer failure after all automatic retries are exhausted."""
    async with async_session() as db:
        event = await db.get(InstagramInboxEvent, event_id)
        if event is None:
            return
        event.status = "failed"
        event.error = str(error)[:1000]
        await db.commit()


async def pair_sender_with_telegram(pairing_code: str, telegram_id: int) -> tuple[str, InstagramInboxSender | None]:
    """Claim a pairing code without bypassing the separate admin approval."""
    code = re.sub(r"[^A-Z0-9]", "", pairing_code.upper())
    async with async_session() as db:
        sender = (await db.execute(select(InstagramInboxSender).where(
            InstagramInboxSender.pairing_code == code
        ))).scalar_one_or_none()
        user = (await db.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
        if sender is None:
            return "invalid", None
        if sender.blocked:
            return "blocked", sender
        if user is None or not user.is_active:
            return "user_unavailable", sender
        if sender.telegram_user_id is not None and sender.telegram_user_id != user.id:
            return "already_linked", sender
        sender.telegram_user_id = user.id
        await db.commit()
        sender_id = sender.id
        approved = sender.approved
    if approved:
        await dispatch_pending_events(sender_id)
        return "active", sender
    return "pending_approval", sender


def _send_instagram_text_sync(instagram_user_id: str, text: str) -> bool:
    if not settings.instagram_access_token or not settings.instagram_account_id:
        return False
    endpoint = (
        f"https://graph.instagram.com/{settings.instagram_graph_version.strip('/')}/"
        f"{settings.instagram_account_id}/messages"
    )
    body = json.dumps({
        "recipient": {"id": instagram_user_id},
        "message": {"text": text},
    }).encode("utf-8")
    request = Request(endpoint, data=body, method="POST", headers={
        "Authorization": f"Bearer {settings.instagram_access_token}",
        "Content-Type": "application/json",
    })
    with urlopen(request, timeout=15) as response:
        response.read()
    return True


def _send_pairing_message_sync(instagram_user_id: str, pairing_code: str) -> bool:
    return _send_instagram_text_sync(instagram_user_id, (
        "سلام 👋 پستت رسید!\n\n"
        "برای اینکه ویدیوها مستقیم توی تلگرامت بیان، ربات کمد رو باز کن و این پیام آماده رو براش بفرست:\n\n"
        f"/instagram {pairing_code}\n\n"
        "بعد از تأیید مدیر، همین پست و پست‌های بعدی برات فرستاده می‌شن ✨\n\n"
        "بعداً هم با نوشتن «مقصد» همین‌جا می‌تونی محل ارسال در تلگرام رو عوض کنی."
    ))


async def send_instagram_notice(instagram_user_id: str, text: str) -> bool:
    try:
        return await asyncio.to_thread(_send_instagram_text_sync, instagram_user_id, text)
    except Exception:
        logger.warning("Could not send Instagram notice to %s", instagram_user_id, exc_info=True)
        return False


async def send_instagram_sender_notice(sender_id: int, text: str) -> bool:
    async with async_session() as db:
        sender = await db.get(InstagramInboxSender, sender_id)
        instagram_user_id = sender.instagram_user_id if sender else ""
    return await send_instagram_notice(instagram_user_id, text) if instagram_user_id else False


async def send_pairing_message(sender_id: int) -> bool:
    """Send pairing instructions once; failure remains retryable from admin UI."""
    async with async_session() as db:
        sender = await db.get(InstagramInboxSender, sender_id)
        if sender is None or sender.pairing_message_sent:
            return False
        try:
            sent = await asyncio.to_thread(_send_pairing_message_sync, sender.instagram_user_id, sender.pairing_code)
        except Exception:
            logger.exception("Could not send Instagram pairing message to %s", sender.instagram_user_id)
            return False
        if not sent:
            return False
        sender.pairing_message_sent = True
        await db.commit()
        return True
