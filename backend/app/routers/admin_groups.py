"""Administrator-only Telegram group approval and quota management."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from pyrogram.types import InlineKeyboardButton, InlineKeyboardMarkup

from .. import telegram
from ..database import get_db
from ..models import TelegramDestination, TelegramGroupSettings, TelegramGroupUsage, User
from ..group_tools import get_group_voice, set_group_voice
from ..tts import VOICE_OPTIONS
from .accounts import require_admin

router = APIRouter(prefix="/admin/groups", tags=["Admin Telegram groups"])
OPERATIONS = ("tts", "stt", "link")


class GroupSettingsUpdate(BaseModel):
    approved: bool | None = None
    tts_enabled: bool | None = None
    stt_enabled: bool | None = None
    link_enabled: bool | None = None
    tts_daily_limit: int | None = None
    stt_daily_limit: int | None = None
    link_daily_limit: int | None = None
    member_tts_daily_limit: int | None = None
    member_stt_daily_limit: int | None = None
    member_link_daily_limit: int | None = None
    voice_name: str | None = None


async def _serialize_groups(db: AsyncSession) -> list[dict]:
    groups = (await db.execute(select(TelegramGroupSettings).order_by(TelegramGroupSettings.updated_at.desc()))).scalars().all()
    destinations = (await db.execute(select(TelegramDestination).where(
        TelegramDestination.chat_type.in_(("group", "supergroup", "channel"))
    ).order_by(TelegramDestination.created_at.desc()))).scalars().all()
    by_chat: dict[int, TelegramDestination] = {}
    for item in destinations:
        by_chat.setdefault(item.chat_id, item)
    owner_ids = {item.user_id for item in destinations}
    owners = (await db.execute(select(User).where(User.id.in_(owner_ids)))).scalars().all() if owner_ids else []
    owner_by_id = {item.id: item for item in owners}
    today = datetime.utcnow().date()
    usage_rows = (await db.execute(select(TelegramGroupUsage).where(
        TelegramGroupUsage.telegram_user_id == 0,
        TelegramGroupUsage.usage_date == today,
    ))).scalars().all()
    usage_by_chat = {item.chat_id: item for item in usage_rows}
    result = []
    for group in groups:
        destination = by_chat.get(group.chat_id)
        if destination is None:
            continue
        owner = owner_by_id.get(destination.user_id)
        usage = usage_by_chat.get(group.chat_id)
        result.append({
            "chat_id": group.chat_id, "title": group.title,
            "approved": bool(destination.enabled), "chat_type": destination.chat_type,
            "requested_at": destination.created_at,
            "requested_by": ({"telegram_id": owner.telegram_id, "name": owner.display_name or owner.first_name or owner.username or str(owner.telegram_id)} if owner else None),
            **{f"{operation}_enabled": bool(getattr(group, f"{operation}_enabled")) for operation in OPERATIONS},
            **{f"{operation}_daily_limit": int(getattr(group, f"{operation}_daily_limit")) for operation in OPERATIONS},
            **{f"member_{operation}_daily_limit": int(getattr(group, f"member_{operation}_daily_limit")) for operation in OPERATIONS},
            "usage": {f"{operation}_count": int(getattr(usage, f"{operation}_count", 0)) for operation in OPERATIONS},
            "voice_name": await get_group_voice(db, group.chat_id),
        })
    return result


@router.get("")
async def list_groups(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    return await _serialize_groups(db)


@router.patch("/{chat_id}")
async def update_group(chat_id: int, payload: GroupSettingsUpdate, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    group = await db.get(TelegramGroupSettings, chat_id)
    destinations = (await db.execute(select(TelegramDestination).where(TelegramDestination.chat_id == chat_id))).scalars().all()
    if group is None or not destinations:
        raise HTTPException(status_code=404, detail="گروه پیدا نشد.")
    values = payload.model_dump(exclude_unset=True)
    approved = values.pop("approved", None)
    voice_name = values.pop("voice_name", None)
    if voice_name is not None and voice_name not in {item["value"] for item in VOICE_OPTIONS}:
        raise HTTPException(status_code=422, detail="گوینده انتخاب‌شده معتبر نیست.")
    for key, value in values.items():
        if key.endswith("_daily_limit") and not 0 <= int(value) <= 100_000:
            raise HTTPException(status_code=422, detail="سقف مصرف باید بین صفر تا ۱۰۰٬۰۰۰ باشد.")
        setattr(group, key, value)
    if approved is not None:
        for destination in destinations:
            destination.enabled = approved
    await db.commit()
    if voice_name is not None:
        await set_group_voice(db, chat_id, voice_name)
    if approved and telegram.tg_client is not None:
        try:
            await telegram.tg_client.send_message(
                chat_id,
                "✅ اتصال این گروه توسط مدیر کمد تأیید شد. ابزارهای فعال از حالا قابل استفاده‌اند.",
                reply_markup=InlineKeyboardMarkup([
                    [InlineKeyboardButton("🎙️ متن به صدا", callback_data="grpmenu:tts"), InlineKeyboardButton("📝 صوت به متن", callback_data="grpmenu:stt")],
                    [InlineKeyboardButton("🔗 دریافت لینک", callback_data="grpmenu:link"), InlineKeyboardButton("📊 مصرف امروز", callback_data="grpmenu:usage")],
                    [InlineKeyboardButton("⚙️ تنظیمات خصوصی ادمین", callback_data="grpmenu:settings")],
                ]),
            )
        except Exception:
            pass
    return next(item for item in await _serialize_groups(db) if item["chat_id"] == chat_id)


@router.delete("/{chat_id}")
async def reject_group(chat_id: int, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    await db.execute(delete(TelegramDestination).where(TelegramDestination.chat_id == chat_id))
    await db.execute(delete(TelegramGroupUsage).where(TelegramGroupUsage.chat_id == chat_id))
    await db.execute(delete(TelegramGroupSettings).where(TelegramGroupSettings.chat_id == chat_id))
    await db.commit()
    return {"removed": True}
