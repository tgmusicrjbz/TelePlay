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

from .config import get_settings
from .database import async_session
from .downloader import ImportJob, link_importer
from .models import InstagramInboxEvent, InstagramInboxSender, User


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
        for event in events:
            try:
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


def _send_pairing_message_sync(instagram_user_id: str, pairing_code: str) -> bool:
    if not settings.instagram_access_token or not settings.instagram_account_id:
        return False
    endpoint = (
        f"https://graph.instagram.com/{settings.instagram_graph_version.strip('/')}/"
        f"{settings.instagram_account_id}/messages"
    )
    body = json.dumps({
        "recipient": {"id": instagram_user_id},
        "message": {"text": (
            "برای دریافت پست در تلگرام، ربات کمد را باز کن و این دستور را بفرست:\n"
            f"/instagram {pairing_code}\n"
            "پس از تأیید مدیر، پست‌های بعدی و همین پست برایت ارسال می‌شوند."
        )},
    }).encode("utf-8")
    request = Request(endpoint, data=body, method="POST", headers={
        "Authorization": f"Bearer {settings.instagram_access_token}",
        "Content-Type": "application/json",
    })
    with urlopen(request, timeout=15) as response:
        response.read()
    return True


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
