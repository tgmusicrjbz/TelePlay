"""Telegram group feature settings and quota accounting."""
from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import delete, func, select

from .config import get_settings
from .models import AppSetting, GroupCabinet, TelegramFileLinkUsage, TelegramGroupSettings, TelegramGroupUsage, TTSUsage, User


OPERATIONS = {"tts", "stt", "link"}
OPERATION_LABELS = {"tts": "تبدیل متن به صدا", "stt": "تبدیل صوت به متن", "link": "افزودن لینک"}
_locks: defaultdict[int, asyncio.Lock] = defaultdict(asyncio.Lock)
_link_locks: defaultdict[int, asyncio.Lock] = defaultdict(asyncio.Lock)
GROUP_VOICE_PREFIX = "telegram.group.voice."


def is_global_admin(telegram_user_id: int) -> bool:
    return telegram_user_id in get_settings().admin_users


async def get_or_create_group_settings(db, chat_id: int, title: str | None = None) -> TelegramGroupSettings:
    item = await db.get(TelegramGroupSettings, chat_id)
    if item is None:
        item = TelegramGroupSettings(chat_id=chat_id, title=(title or "گروه تلگرام")[:255])
        db.add(item)
        await db.flush()
    elif title and item.title != title[:255]:
        item.title = title[:255]
    return item


async def get_or_create_group_cabinet(db, chat_id: int, user_id: int | None = None, title: str | None = None) -> GroupCabinet:
    """Return the single shared cabinet for a connected group."""
    cabinet = (await db.execute(select(GroupCabinet).where(GroupCabinet.chat_id == chat_id))).scalar_one_or_none()
    if cabinet is None:
        cabinet = GroupCabinet(
            chat_id=chat_id,
            title=(title or "کمد گروه")[:255],
            created_by_user_id=user_id,
        )
        db.add(cabinet)
        await db.flush()
    elif title and cabinet.title != title[:255]:
        cabinet.title = title[:255]
    return cabinet


async def consume_group_quota(
    db, *, chat_id: int, telegram_user_id: int, operation: str,
    amount: int = 1, title: str | None = None,
) -> None:
    """Check and increment both group and member counters for one operation."""
    if operation not in OPERATIONS:
        raise ValueError("نوع عملیات گروه معتبر نیست.")
    amount = max(1, int(amount))
    async with _locks[chat_id]:
        group = await db.get(TelegramGroupSettings, chat_id)
        if group is None or not group.approved:
            raise ValueError("این گروه هنوز توسط مدیر کمد تأیید نشده است.")
        if title and group.title != title[:255]:
            group.title = title[:255]
        admin = is_global_admin(telegram_user_id)
        if not admin and not getattr(group, f"{operation}_enabled"):
            raise ValueError(f"{OPERATION_LABELS[operation]} در این گروه غیرفعال است.")

        today = datetime.utcnow().date()
        rows: dict[int, TelegramGroupUsage] = {}
        for member_id in (0, telegram_user_id):
            row = (await db.execute(select(TelegramGroupUsage).where(
                TelegramGroupUsage.chat_id == chat_id,
                TelegramGroupUsage.telegram_user_id == member_id,
                TelegramGroupUsage.usage_date == today,
            ))).scalar_one_or_none()
            if row is None:
                row = TelegramGroupUsage(chat_id=chat_id, telegram_user_id=member_id, usage_date=today)
                db.add(row)
                await db.flush()
            rows[member_id] = row

        counter = f"{operation}_count"
        group_limit = int(getattr(group, f"{operation}_daily_limit") or 0)
        member_limit = int(getattr(group, f"member_{operation}_daily_limit") or 0)
        if not admin and group_limit and getattr(rows[0], counter) + amount > group_limit:
            raise ValueError(f"سهمیه امروز گروه برای {OPERATION_LABELS[operation]} تمام شده است.")
        if not admin and member_limit and getattr(rows[telegram_user_id], counter) + amount > member_limit:
            raise ValueError(f"سهمیه امروز شما در این گروه برای {OPERATION_LABELS[operation]} تمام شده است.")
        setattr(rows[0], counter, getattr(rows[0], counter) + amount)
        setattr(rows[telegram_user_id], counter, getattr(rows[telegram_user_id], counter) + amount)
        await db.commit()


async def consume_file_link_quota(
    db, *, user_id: int, telegram_user_id: int, chat_id: int,
) -> dict[str, int]:
    """Apply one user's rolling hourly, daily and monthly link limits."""
    async with _link_locks[user_id]:
        usage = await db.get(TTSUsage, user_id)
        if usage is None:
            usage = TTSUsage(user_id=user_id, usage_date=datetime.utcnow().date())
            db.add(usage)
            await db.flush()
        now = datetime.utcnow()
        hour_start = now - timedelta(hours=1)
        day_start = datetime(now.year, now.month, now.day)
        month_start = datetime(now.year, now.month, 1)

        async def count_since(start: datetime) -> int:
            return int((await db.execute(select(func.count()).select_from(TelegramFileLinkUsage).where(
                TelegramFileLinkUsage.user_id == user_id,
                TelegramFileLinkUsage.created_at >= start,
            ))).scalar_one() or 0)

        hourly = await count_since(hour_start)
        daily = await count_since(day_start)
        monthly = await count_since(month_start)
        limits = {
            "hourly": int(usage.link_hourly_limit or 0),
            "daily": int(usage.link_daily_limit or 0),
            "monthly": int(usage.link_monthly_limit or 0),
        }
        labels = {"hourly": "ساعتی", "daily": "روزانه", "monthly": "ماهانه"}
        for scope, used in (("hourly", hourly), ("daily", daily), ("monthly", monthly)):
            if limits[scope] and used >= limits[scope]:
                raise ValueError(f"سهمیه {labels[scope]} ساخت لینک فایل برای این حساب تمام شده است.")
        db.add(TelegramFileLinkUsage(
            user_id=user_id, telegram_user_id=telegram_user_id,
            chat_id=chat_id, created_at=now,
        ))
        # Events older than the largest rolling window no longer affect limits.
        await db.execute(delete(TelegramFileLinkUsage).where(
            TelegramFileLinkUsage.user_id == user_id,
            TelegramFileLinkUsage.created_at < month_start - timedelta(days=2),
        ))
        await db.commit()
        return {"hourly": hourly + 1, "daily": daily + 1, "monthly": monthly + 1}


async def get_group_usage(db, chat_id: int, telegram_user_id: int) -> tuple[TelegramGroupUsage | None, TelegramGroupUsage | None]:
    today = datetime.utcnow().date()
    rows = (await db.execute(select(TelegramGroupUsage).where(
        TelegramGroupUsage.chat_id == chat_id,
        TelegramGroupUsage.telegram_user_id.in_((0, telegram_user_id)),
        TelegramGroupUsage.usage_date == today,
    ))).scalars().all()
    by_member = {row.telegram_user_id: row for row in rows}
    return by_member.get(0), by_member.get(telegram_user_id)


async def get_group_usage_breakdown(
    db, chat_id: int,
) -> tuple[TelegramGroupSettings | None, TelegramGroupUsage | None, list[tuple[TelegramGroupUsage, str]]]:
    """Return today's total and every member row with a friendly display name."""
    today = datetime.utcnow().date()
    group = await db.get(TelegramGroupSettings, chat_id)
    rows = (await db.execute(select(TelegramGroupUsage).where(
        TelegramGroupUsage.chat_id == chat_id,
        TelegramGroupUsage.usage_date == today,
    ))).scalars().all()
    total = next((row for row in rows if row.telegram_user_id == 0), None)
    member_rows = [row for row in rows if row.telegram_user_id != 0]
    member_ids = [row.telegram_user_id for row in member_rows]
    users = (await db.execute(select(User).where(User.telegram_id.in_(member_ids)))).scalars().all() if member_ids else []
    names = {
        user.telegram_id: (
            user.display_name
            or " ".join(part for part in (user.first_name, user.last_name) if part)
            or (f"@{user.username}" if user.username else None)
            or str(user.telegram_id)
        )
        for user in users
    }
    member_rows.sort(key=lambda row: row.tts_count + row.stt_count + row.link_count, reverse=True)
    return group, total, [(row, names.get(row.telegram_user_id, str(row.telegram_user_id))) for row in member_rows]


async def get_group_voice(db, chat_id:int, default:str="Kore") -> str:
    row=await db.get(AppSetting,f"{GROUP_VOICE_PREFIX}{chat_id}")
    return (row.value or default) if row else default


async def set_group_voice(db, chat_id:int, voice:str) -> None:
    key=f"{GROUP_VOICE_PREFIX}{chat_id}"
    row=await db.get(AppSetting,key)
    if row is None: db.add(AppSetting(key=key,value=voice))
    else: row.value=voice
    await db.commit()
