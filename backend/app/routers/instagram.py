"""Meta Instagram Messaging webhook and admin controls."""
from __future__ import annotations

import hmac
from datetime import datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import get_settings
from ..database import get_db
from ..instagram_inbox import dispatch_pending_events, extract_shared_posts, extract_text_messages, instagram_destination_reply, new_pairing_code, send_instagram_notice, send_pairing_message, verify_meta_signature
from ..models import AppSetting, InstagramInboxEvent, InstagramInboxSender, TelegramDestination, User


router = APIRouter(prefix="/instagram", tags=["Instagram inbox"])
settings = get_settings()
DEFAULT_HOURLY_LIMIT_KEY = "instagram_default_hourly_limit"
DEFAULT_DAILY_LIMIT_KEY = "instagram_default_daily_limit"
DEFAULT_MONTHLY_LIMIT_KEY = "instagram_default_monthly_limit"


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.telegram_id not in settings.admin_users:
        raise HTTPException(status_code=403, detail="این بخش فقط برای مدیر است.")
    return current_user


class InstagramSenderUpdate(BaseModel):
    telegram_user_id: int | None = None
    approved: bool | None = None
    blocked: bool | None = None
    save_to_library: bool | None = None
    hourly_limit: int | None = None
    daily_limit: int | None = None
    monthly_limit: int | None = None
    display_name: str | None = None


class InstagramDefaultsUpdate(BaseModel):
    hourly_limit: int = Field(ge=0, le=10_000)
    daily_limit: int = Field(ge=0, le=10_000)
    monthly_limit: int = Field(ge=0, le=100_000)


def _bounded_limit(value: object, fallback: int, maximum: int) -> int:
    try:
        return max(0, min(maximum, int(value)))
    except (TypeError, ValueError):
        return fallback


async def instagram_default_limits(db: AsyncSession) -> tuple[int, int, int]:
    rows = (await db.execute(select(AppSetting).where(AppSetting.key.in_((
        DEFAULT_HOURLY_LIMIT_KEY, DEFAULT_DAILY_LIMIT_KEY, DEFAULT_MONTHLY_LIMIT_KEY,
    ))))).scalars().all()
    values = {row.key: row.value for row in rows}
    return (
        _bounded_limit(values.get(DEFAULT_HOURLY_LIMIT_KEY), 2, 10_000),
        _bounded_limit(values.get(DEFAULT_DAILY_LIMIT_KEY), 5, 10_000),
        _bounded_limit(values.get(DEFAULT_MONTHLY_LIMIT_KEY), 50, 100_000),
    )


def daily_usage_start(sender: InstagramInboxSender, now: datetime) -> datetime:
    day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    reset_at = sender.daily_quota_reset_at
    return reset_at if reset_at and reset_at > day_start else day_start


def quota_limit_reason(sender: InstagramInboxSender, hourly_used: int, daily_used: int, monthly_used: int) -> str | None:
    if sender.hourly_limit and hourly_used >= sender.hourly_limit:
        return "hourly"
    if sender.daily_limit and daily_used >= sender.daily_limit:
        return "daily"
    if sender.monthly_limit and monthly_used >= sender.monthly_limit:
        return "monthly"
    return None


def sender_payload(sender: InstagramInboxSender, user: User | None = None, destination: TelegramDestination | None = None, *, hourly_used: int = 0, daily_used: int = 0, monthly_used: int = 0) -> dict:
    return {
        "id": sender.id,
        "instagram_user_id": sender.instagram_user_id,
        "username": sender.username,
        "display_name": sender.display_name,
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
        "selected_destination_id": sender.selected_destination_id,
        "selected_destination_name": destination.name if destination else None,
        "hourly_limit": sender.hourly_limit,
        "daily_limit": sender.daily_limit,
        "monthly_limit": sender.monthly_limit,
        "hourly_used": hourly_used,
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
    default_hourly_limit, default_daily_limit, default_monthly_limit = await instagram_default_limits(db)
    for incoming in extract_text_messages(payload):
        sender = (await db.execute(select(InstagramInboxSender).where(
            InstagramInboxSender.instagram_user_id == incoming["sender_id"]
        ))).scalar_one_or_none()
        if sender is None:
            continue
        reply = await instagram_destination_reply(db, sender, incoming["text"])
        if reply:
            background_tasks.add_task(send_instagram_notice, sender.instagram_user_id, reply)
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
            sender = InstagramInboxSender(
                instagram_user_id=shared["sender_id"], pairing_code=code,
                hourly_limit=default_hourly_limit, daily_limit=default_daily_limit, monthly_limit=default_monthly_limit,
            )
            db.add(sender)
            await db.flush()
            new_senders.add(sender.id)
        now = datetime.utcnow()
        too_fast = bool(sender.last_message_at and (now - sender.last_message_at).total_seconds() < 3)
        calendar_day_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        day_start = daily_usage_start(sender, now)
        month_start = calendar_day_start.replace(day=1)
        hourly_used = int((await db.execute(select(func.count()).select_from(InstagramInboxEvent).where(
            InstagramInboxEvent.sender_id == sender.id,
            InstagramInboxEvent.received_at >= now - timedelta(hours=1),
            InstagramInboxEvent.status != "limited",
        ))).scalar() or 0)
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
        limit_reason = quota_limit_reason(sender, hourly_used, daily_used, monthly_used)
        limited = too_fast or limit_reason is not None
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
            elif limit_reason == "hourly":
                message = "سهمیه یک ساعت اخیرت پر شده. کمی بعد دوباره می‌تونی پست بفرستی ⏳"
            elif limit_reason == "daily":
                message = "سهمیه امروزت پر شده. از شروع روز بعد دوباره می‌تونی پست بفرستی 🌱"
            else:
                message = "سهمیه این ماهت پر شده. از شروع ماه بعد دوباره می‌تونی پست بفرستی 🌱"
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
    default_hourly_limit, default_daily_limit, default_monthly_limit = await instagram_default_limits(db)
    return {
        "configured": bool(settings.instagram_app_secret and settings.instagram_webhook_verify_token),
        "reply_configured": bool(settings.instagram_access_token and settings.instagram_account_id),
        "callback_url": f"{base}/api/instagram/webhook" if base else "",
        "total_senders": total,
        "pending_senders": pending,
        "default_hourly_limit": default_hourly_limit,
        "default_daily_limit": default_daily_limit,
        "default_monthly_limit": default_monthly_limit,
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
        sender_day_start=daily_usage_start(sender,now)
        hourly=int((await db.execute(select(func.count()).select_from(InstagramInboxEvent).where(InstagramInboxEvent.sender_id==sender.id,InstagramInboxEvent.received_at>=now-timedelta(hours=1),InstagramInboxEvent.status!="limited"))).scalar() or 0)
        daily=int((await db.execute(select(func.count()).select_from(InstagramInboxEvent).where(InstagramInboxEvent.sender_id==sender.id,InstagramInboxEvent.received_at>=sender_day_start,InstagramInboxEvent.status!="limited"))).scalar() or 0)
        monthly=int((await db.execute(select(func.count()).select_from(InstagramInboxEvent).where(InstagramInboxEvent.sender_id==sender.id,InstagramInboxEvent.received_at>=month_start,InstagramInboxEvent.status!="limited"))).scalar() or 0)
        destination = (await db.execute(select(TelegramDestination).where(
            TelegramDestination.id == sender.selected_destination_id,
            TelegramDestination.user_id == sender.telegram_user_id,
        ))).scalar_one_or_none() if sender.selected_destination_id and sender.telegram_user_id else None
        result.append(sender_payload(sender,user,destination,hourly_used=hourly,daily_used=daily,monthly_used=monthly))
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
    if payload.hourly_limit is not None:
        if not 0 <= payload.hourly_limit <= 10_000:
            raise HTTPException(status_code=400, detail="سقف ساعتی معتبر نیست.")
        sender.hourly_limit = payload.hourly_limit
    if payload.daily_limit is not None:
        if not 0 <= payload.daily_limit <= 10_000:
            raise HTTPException(status_code=400, detail="سقف روزانه معتبر نیست.")
        sender.daily_limit = payload.daily_limit
    if payload.monthly_limit is not None:
        if not 0 <= payload.monthly_limit <= 100_000:
            raise HTTPException(status_code=400, detail="سقف ماهانه معتبر نیست.")
        sender.monthly_limit = payload.monthly_limit
    if payload.display_name is not None:
        sender.display_name = payload.display_name.strip()[:120] or None
    await db.commit()
    await db.refresh(sender)
    if sender.approved and not sender.blocked and sender.telegram_user_id is not None:
        background_tasks.add_task(dispatch_pending_events, sender.id)
    if user is None and sender.telegram_user_id is not None:
        user = await db.get(User, sender.telegram_user_id)
    destination = (await db.execute(select(TelegramDestination).where(
        TelegramDestination.id == sender.selected_destination_id,
        TelegramDestination.user_id == sender.telegram_user_id,
    ))).scalar_one_or_none() if sender.selected_destination_id and sender.telegram_user_id else None
    return sender_payload(sender, user, destination)


@router.put("/settings")
async def update_instagram_defaults(
    payload: InstagramDefaultsUpdate, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    hourly = payload.hourly_limit
    daily = payload.daily_limit
    monthly = payload.monthly_limit
    for key, value in ((DEFAULT_HOURLY_LIMIT_KEY, hourly), (DEFAULT_DAILY_LIMIT_KEY, daily), (DEFAULT_MONTHLY_LIMIT_KEY, monthly)):
        row = await db.get(AppSetting, key)
        if row is None:
            db.add(AppSetting(key=key, value=str(value)))
        else:
            row.value = str(value)
    await db.commit()
    return {"hourly_limit": hourly, "daily_limit": daily, "monthly_limit": monthly}


@router.post("/senders/reset-daily")
async def reset_all_instagram_daily_usage(
    _: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    now = datetime.utcnow()
    result = await db.execute(update(InstagramInboxSender).values(daily_quota_reset_at=now))
    await db.commit()
    return {"reset": int(result.rowcount or 0), "reset_at": now}


@router.post("/senders/{sender_id}/reset-daily")
async def reset_instagram_sender_daily_usage(
    sender_id: int, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    sender = await db.get(InstagramInboxSender, sender_id)
    if sender is None:
        raise HTTPException(status_code=404, detail="فرستنده پیدا نشد.")
    sender.daily_quota_reset_at = datetime.utcnow()
    await db.commit()
    return {"reset": True, "sender_id": sender.id, "reset_at": sender.daily_quota_reset_at}


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
