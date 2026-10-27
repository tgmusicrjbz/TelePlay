"""Meta Instagram Messaging webhook and admin controls."""
from __future__ import annotations

import hmac
from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import get_settings
from ..database import get_db
from ..instagram_inbox import dispatch_pending_events, extract_shared_posts, new_pairing_code, send_instagram_notice, send_pairing_message, verify_meta_signature
from ..models import InstagramInboxEvent, InstagramInboxSender, User


router = APIRouter(prefix="/instagram", tags=["Instagram inbox"])
settings = get_settings()


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.telegram_id not in settings.admin_users:
        raise HTTPException(status_code=403, detail="این بخش فقط برای مدیر است.")
    return current_user


class InstagramSenderUpdate(BaseModel):
    telegram_user_id: int | None = None
    approved: bool | None = None
    blocked: bool | None = None
    save_to_library: bool | None = None
    daily_limit: int | None = None
    monthly_limit: int | None = None


def sender_payload(sender: InstagramInboxSender, user: User | None = None, *, daily_used: int = 0, monthly_used: int = 0) -> dict:
    return {
        "id": sender.id,
        "instagram_user_id": sender.instagram_user_id,
        "username": sender.username,
        "pairing_code": sender.pairing_code,
        "telegram_user_id": sender.telegram_user_id,
        "telegram_name": (
            user.display_name or " ".join(filter(None, (user.first_name, user.last_name))) or user.username
            if user else None
        ),
        "telegram_id": user.telegram_id if user else None,
        "approved": sender.approved,
        "blocked": sender.blocked,
        "save_to_library": sender.save_to_library,
        "daily_limit": sender.daily_limit,
        "monthly_limit": sender.monthly_limit,
        "daily_used": daily_used,
        "monthly_used": monthly_used,
        "pairing_message_sent": sender.pairing_message_sent,
        "received_count": sender.received_count,
        "forwarded_count": sender.forwarded_count,
        "last_message_at": sender.last_message_at,
        "created_at": sender.created_at,
    }


@router.get("/webhook", include_in_schema=False)
async def verify_webhook(
    mode: str | None = Query(None, alias="hub.mode"),
    token: str | None = Query(None, alias="hub.verify_token"),
    challenge: str | None = Query(None, alias="hub.challenge"),
):
    if mode == "subscribe" and settings.instagram_webhook_verify_token and hmac.compare_digest(
        token or "", settings.instagram_webhook_verify_token
    ):
        return Response(content=challenge or "", media_type="text/plain")
    raise HTTPException(status_code=403, detail="Webhook verification failed")


@router.post("/webhook", include_in_schema=False)
async def instagram_webhook(request: Request, background_tasks: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    raw = await request.body()
    if not settings.instagram_app_secret:
        raise HTTPException(status_code=503, detail="Instagram webhook is not configured")
    supplied = request.headers.get("x-hub-signature-256", "")
    if not verify_meta_signature(raw, supplied, settings.instagram_app_secret):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")
    try:
        payload = await request.json()
    except ValueError as error:
        raise HTTPException(status_code=400, detail="Invalid webhook payload") from error
    if payload.get("object") != "instagram":
        return {"received": 0}

    affected: set[int] = set()
    new_senders: set[int] = set()
    received = 0
    for shared in extract_shared_posts(payload):
        existing = (await db.execute(select(InstagramInboxEvent.id).where(
            InstagramInboxEvent.event_id == shared["event_id"]
        ))).scalar_one_or_none()
        if existing is not None:
            continue
        sender = (await db.execute(select(InstagramInboxSender).where(
            InstagramInboxSender.instagram_user_id == shared["sender_id"]
        ))).scalar_one_or_none()
        if sender is None:
            for _ in range(8):
                code = new_pairing_code()
                if not (await db.execute(select(InstagramInboxSender.id).where(InstagramInboxSender.pairing_code == code))).scalar_one_or_none():
                    break
            sender = InstagramInboxSender(instagram_user_id=shared["sender_id"], pairing_code=code)
            db.add(sender)
            await db.flush()
            new_senders.add(sender.id)
        now = datetime.utcnow()
        too_fast = bool(sender.last_message_at and (now - sender.last_message_at).total_seconds() < 3)
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        month_start = day_start.replace(day=1)
        daily_used = int((await db.execute(select(func.count()).select_from(InstagramInboxEvent).where(
            InstagramInboxEvent.sender_id == sender.id,
            InstagramInboxEvent.received_at >= day_start,
            InstagramInboxEvent.status != "limited",
        ))).scalar() or 0)
        monthly_used = int((await db.execute(select(func.count()).select_from(InstagramInboxEvent).where(
            InstagramInboxEvent.sender_id == sender.id,
            InstagramInboxEvent.received_at >= month_start,
            InstagramInboxEvent.status != "limited",
        ))).scalar() or 0)
        limited = too_fast or bool(sender.daily_limit and daily_used >= sender.daily_limit) or bool(sender.monthly_limit and monthly_used >= sender.monthly_limit)
        previous = (await db.execute(select(InstagramInboxEvent).where(
            InstagramInboxEvent.sender_id == sender.id,
            InstagramInboxEvent.shared_url == shared["url"],
            InstagramInboxEvent.cached_files_json != "[]",
        ).order_by(InstagramInboxEvent.received_at.desc()).limit(1))).scalar_one_or_none()
        already_processing = None if previous is not None else (await db.execute(select(InstagramInboxEvent.id).where(
            InstagramInboxEvent.sender_id == sender.id,
            InstagramInboxEvent.shared_url == shared["url"],
            InstagramInboxEvent.status.in_(("pending", "queued")),
        ).limit(1))).scalar_one_or_none()
        duplicate_in_progress = already_processing is not None
        limited = limited or duplicate_in_progress
        sender.received_count += 1
        sender.last_message_at = now
        db.add(InstagramInboxEvent(
            sender_id=sender.id, event_id=shared["event_id"], shared_url=shared["url"],
            status="limited" if limited else "pending",
            cached_files_json=previous.cached_files_json if previous is not None else "[]",
        ))
        if limited:
            if duplicate_in_progress:
                message = "این پست همین الان در حال آماده‌شدنه؛ لازم نیست دوباره بفرستیش. به‌محض آماده‌شدن توی تلگرام میاد ✨"
            elif too_fast:
                message = "چند لینک خیلی سریع پشت‌سرهم فرستادی؛ کمی صبر کن و دوباره بفرست 🙏"
            else:
                message = "سهمیهٔ دریافت پستت فعلاً پر شده. بعد از شروع بازهٔ بعدی دوباره می‌تونی بفرستی 🌱"
            background_tasks.add_task(send_instagram_notice, sender.instagram_user_id, message)
        else:
            affected.add(sender.id)
        received += 1
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()  # A concurrent delivery of the same Meta event won the race.
        return {"received": 0}
    for sender_id in new_senders:
        background_tasks.add_task(send_pairing_message, sender_id)
    for sender_id in affected:
        background_tasks.add_task(dispatch_pending_events, sender_id)
    return {"received": received}


@router.get("/status")
async def instagram_status(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    total = int((await db.execute(select(func.count()).select_from(InstagramInboxSender))).scalar() or 0)
    pending = int((await db.execute(select(func.count()).select_from(InstagramInboxSender).where(
        InstagramInboxSender.blocked.is_(False),
        or_(InstagramInboxSender.approved.is_(False), InstagramInboxSender.telegram_user_id.is_(None)),
    ))).scalar() or 0)
    base = settings.web_base_url.rstrip("/")
    if base and not base.startswith(("http://", "https://")):
        base = "https://" + base
    return {
        "configured": bool(settings.instagram_app_secret and settings.instagram_webhook_verify_token),
        "reply_configured": bool(settings.instagram_access_token and settings.instagram_account_id),
        "callback_url": f"{base}/api/instagram/webhook" if base else "",
        "total_senders": total,
        "pending_senders": pending,
    }


@router.get("/senders")
async def instagram_senders(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(InstagramInboxSender, User)
        .outerjoin(User, User.id == InstagramInboxSender.telegram_user_id)
        .order_by(InstagramInboxSender.last_message_at.desc().nullslast())
    )).all()
    now=datetime.utcnow();day_start=now.replace(hour=0,minute=0,second=0,microsecond=0);month_start=day_start.replace(day=1)
    result=[]
    for sender,user in rows:
        daily=int((await db.execute(select(func.count()).select_from(InstagramInboxEvent).where(InstagramInboxEvent.sender_id==sender.id,InstagramInboxEvent.received_at>=day_start,InstagramInboxEvent.status!="limited"))).scalar() or 0)
        monthly=int((await db.execute(select(func.count()).select_from(InstagramInboxEvent).where(InstagramInboxEvent.sender_id==sender.id,InstagramInboxEvent.received_at>=month_start,InstagramInboxEvent.status!="limited"))).scalar() or 0)
        result.append(sender_payload(sender,user,daily_used=daily,monthly_used=monthly))
    return result


@router.patch("/senders/{sender_id}")
async def update_instagram_sender(
    sender_id: int, payload: InstagramSenderUpdate, background_tasks: BackgroundTasks,
    _: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    sender = await db.get(InstagramInboxSender, sender_id)
    if sender is None:
        raise HTTPException(status_code=404, detail="فرستنده پیدا نشد.")
    user = None
    if payload.telegram_user_id is not None:
        user = await db.get(User, payload.telegram_user_id)
        if user is None or not user.is_active or user.telegram_id <= 0:
            raise HTTPException(status_code=400, detail="حساب تلگرام فعال و قابل ارسال نیست.")
        sender.telegram_user_id = user.id
    if payload.approved is not None:
        sender.approved = payload.approved
    if payload.blocked is not None:
        sender.blocked = payload.blocked
        if payload.blocked:
            sender.approved = False
    if payload.save_to_library is not None:
        sender.save_to_library = payload.save_to_library
    if payload.daily_limit is not None:
        if not 0 <= payload.daily_limit <= 10_000:
            raise HTTPException(status_code=400, detail="سقف روزانه معتبر نیست.")
        sender.daily_limit = payload.daily_limit
    if payload.monthly_limit is not None:
        if not 0 <= payload.monthly_limit <= 100_000:
            raise HTTPException(status_code=400, detail="سقف ماهانه معتبر نیست.")
        sender.monthly_limit = payload.monthly_limit
    await db.commit()
    await db.refresh(sender)
    if sender.approved and not sender.blocked and sender.telegram_user_id is not None:
        background_tasks.add_task(dispatch_pending_events, sender.id)
    if user is None and sender.telegram_user_id is not None:
        user = await db.get(User, sender.telegram_user_id)
    return sender_payload(sender, user)


@router.post("/senders/{sender_id}/pairing-message")
async def retry_pairing_message(sender_id: int, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    sender = await db.get(InstagramInboxSender, sender_id)
    if sender is None:
        raise HTTPException(status_code=404, detail="فرستنده پیدا نشد.")
    sender.pairing_message_sent = False
    await db.commit()
    sent = await send_pairing_message(sender_id)
    if not sent:
        raise HTTPException(status_code=502, detail="ارسال پیام اتصال در اینستاگرام انجام نشد؛ توکن و شناسه حساب را بررسی کن.")
    return {"sent": True}


@router.post("/events/{event_id}/retry")
async def retry_instagram_event(event_id: int, background_tasks: BackgroundTasks, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    event = await db.get(InstagramInboxEvent, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="رویداد پیدا نشد.")
    event.status = "pending"
    event.error = None
    event.import_job_id = None
    await db.commit()
    background_tasks.add_task(dispatch_pending_events, event.sender_id)
    return {"queued": True}
