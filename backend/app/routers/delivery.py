"""Telegram destinations, global captions, and source-monitor settings."""
from __future__ import annotations

import json
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import get_settings
from ..database import get_db
from ..models import AppSetting, SourceMonitor, TelegramDestination, User
from .. import telegram

router = APIRouter(prefix="/delivery", tags=["Delivery"])
settings = get_settings()

CAPTION_KEYS = {
    "youtube": "caption_template_youtube",
    "instagram": "caption_template_instagram",
    "telegram": "caption_template_telegram",
    "drive": "caption_template_drive",
    "generic": "caption_template_generic",
}
DEFAULT_CAPTIONS = {
    "youtube": "📝 [عنوان]\n📺 [سازنده]\n🔗 [لینک]",
    "instagram": "📝 [عنوان]\n📷 [سازنده]\n🔗 [لینک]",
    "telegram": "📝 [عنوان]",
    "drive": "📝 [عنوان]",
    "generic": "📝 [عنوان]",
}


def _require_admin(user: User) -> None:
    if user.telegram_id not in settings.admin_users:
        raise HTTPException(status_code=403, detail="این بخش فقط برای مدیر در دسترس است.")


async def global_caption_templates(db: AsyncSession) -> dict[str, str]:
    rows = (await db.execute(select(AppSetting).where(AppSetting.key.in_(CAPTION_KEYS.values())))).scalars().all()
    by_key = {row.key: row.value for row in rows}
    return {name: by_key.get(key, DEFAULT_CAPTIONS[name]) for name, key in CAPTION_KEYS.items()}


class CaptionTemplatesUpdate(BaseModel):
    youtube: str = Field(max_length=2000)
    instagram: str = Field(max_length=2000)
    telegram: str = Field(max_length=2000)
    drive: str = Field(max_length=2000)
    generic: str = Field(max_length=2000)


@router.get("/caption-templates")
async def read_caption_templates(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    templates = await global_caption_templates(db)
    return {"templates": templates, "can_edit": current_user.telegram_id in settings.admin_users}


@router.put("/caption-templates")
async def update_caption_templates(payload: CaptionTemplatesUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    _require_admin(current_user)
    for name, key in CAPTION_KEYS.items():
        value = getattr(payload, name).strip()
        row = await db.get(AppSetting, key)
        if row is None:
            db.add(AppSetting(key=key, value=value))
        else:
            row.value = value
    await db.commit()
    return {"templates": await global_caption_templates(db), "can_edit": True}


class DestinationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    chat_id: int
    is_default: bool = False


class DestinationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    is_default: Optional[bool] = None
    enabled: Optional[bool] = None


def _destination_dict(item: TelegramDestination) -> dict:
    return {
        "id": item.id, "name": item.name, "chat_id": item.chat_id,
        "chat_type": item.chat_type, "is_default": item.is_default,
        "enabled": item.enabled, "created_at": item.created_at,
    }


async def _resolve_chat(chat_id: int) -> tuple[str, str]:
    if telegram.tg_client is None:
        raise HTTPException(status_code=503, detail="ربات تلگرام در دسترس نیست.")
    try:
        chat = await telegram.tg_client.get_chat(chat_id)
    except Exception as error:
        raise HTTPException(status_code=400, detail="گفت‌وگو پیدا نشد؛ ربات را به گروه یا کانال اضافه کن و دسترسی ارسال بده.") from error
    chat_type = str(getattr(chat, "type", "unknown")).split(".")[-1].lower()
    title = str(getattr(chat, "title", None) or getattr(chat, "first_name", None) or chat_id)
    return chat_type, title


@router.get("/destinations")
async def list_destinations(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    items = (await db.execute(select(TelegramDestination).where(TelegramDestination.user_id == current_user.id).order_by(TelegramDestination.is_default.desc(), TelegramDestination.created_at))).scalars().all()
    return [_destination_dict(item) for item in items]


@router.post("/destinations", status_code=201)
async def create_destination(payload: DestinationCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    chat_type, resolved_name = await _resolve_chat(payload.chat_id)
    if payload.is_default:
        await db.execute(select(TelegramDestination).where(TelegramDestination.user_id == current_user.id).with_for_update())
        await db.execute(
            TelegramDestination.__table__.update().where(TelegramDestination.user_id == current_user.id).values(is_default=False)
        )
    item = TelegramDestination(
        user_id=current_user.id, name=payload.name.strip() or resolved_name,
        chat_id=payload.chat_id, chat_type=chat_type, is_default=payload.is_default,
    )
    db.add(item)
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(status_code=409, detail="این مقصد قبلاً اضافه شده است.") from error
    await db.refresh(item)
    return _destination_dict(item)


@router.patch("/destinations/{destination_id}")
async def update_destination(destination_id: int, payload: DestinationUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = (await db.execute(select(TelegramDestination).where(TelegramDestination.id == destination_id, TelegramDestination.user_id == current_user.id))).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="مقصد پیدا نشد.")
    if payload.is_default:
        await db.execute(TelegramDestination.__table__.update().where(TelegramDestination.user_id == current_user.id).values(is_default=False))
    if payload.name is not None:
        item.name = payload.name.strip()
    if payload.is_default is not None:
        item.is_default = payload.is_default
    if payload.enabled is not None:
        item.enabled = payload.enabled
    await db.commit()
    await db.refresh(item)
    return _destination_dict(item)


@router.delete("/destinations/{destination_id}", status_code=204)
async def delete_destination(destination_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(delete(TelegramDestination).where(TelegramDestination.id == destination_id, TelegramDestination.user_id == current_user.id))
    if not result.rowcount:
        raise HTTPException(status_code=404, detail="مقصد پیدا نشد.")
    await db.commit()


class MonitorPayload(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    source_type: Literal["youtube", "instagram", "telegram", "saved_messages"]
    source_url: str = Field(min_length=1, max_length=2048)
    enabled: bool = False
    interval_minutes: int = Field(default=60, ge=5, le=10080)
    run_at: Optional[str] = Field(default=None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    filters: dict = Field(default_factory=dict)
    actions: dict = Field(default_factory=dict)


def _monitor_dict(item: SourceMonitor) -> dict:
    def load(raw: str) -> dict:
        try:
            value = json.loads(raw or "{}")
            return value if isinstance(value, dict) else {}
        except (TypeError, ValueError):
            return {}
    return {
        "id": item.id, "name": item.name, "source_type": item.source_type,
        "source_url": item.source_url, "enabled": item.enabled,
        "interval_minutes": item.interval_minutes, "run_at": item.run_at,
        "filters": load(item.filters_json), "actions": load(item.actions_json),
        "last_checked_at": item.last_checked_at, "last_error": item.last_error,
    }


@router.get("/monitors")
async def list_monitors(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    items = (await db.execute(select(SourceMonitor).where(SourceMonitor.user_id == current_user.id).order_by(SourceMonitor.created_at.desc()))).scalars().all()
    return [_monitor_dict(item) for item in items]


@router.post("/monitors", status_code=201)
async def create_monitor(payload: MonitorPayload, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = SourceMonitor(
        user_id=current_user.id, name=payload.name.strip(), source_type=payload.source_type,
        source_url=payload.source_url.strip(), enabled=payload.enabled,
        interval_minutes=payload.interval_minutes, run_at=payload.run_at,
        filters_json=json.dumps(payload.filters, ensure_ascii=False),
        actions_json=json.dumps(payload.actions, ensure_ascii=False),
    )
    db.add(item)
    await db.commit()
    await db.refresh(item)
    return _monitor_dict(item)


@router.put("/monitors/{monitor_id}")
async def update_monitor(monitor_id: int, payload: MonitorPayload, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = (await db.execute(select(SourceMonitor).where(SourceMonitor.id == monitor_id, SourceMonitor.user_id == current_user.id))).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="پایش پیدا نشد.")
    for field in ("name", "source_type", "source_url", "enabled", "interval_minutes", "run_at"):
        setattr(item, field, getattr(payload, field))
    item.filters_json = json.dumps(payload.filters, ensure_ascii=False)
    item.actions_json = json.dumps(payload.actions, ensure_ascii=False)
    await db.commit()
    await db.refresh(item)
    return _monitor_dict(item)


@router.delete("/monitors/{monitor_id}", status_code=204)
async def delete_monitor(monitor_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    result = await db.execute(delete(SourceMonitor).where(SourceMonitor.id == monitor_id, SourceMonitor.user_id == current_user.id))
    if not result.rowcount:
        raise HTTPException(status_code=404, detail="پایش پیدا نشد.")
    await db.commit()


@router.post("/monitors/{monitor_id}/run")
async def run_monitor_now(monitor_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    item = (await db.execute(select(SourceMonitor).where(SourceMonitor.id == monitor_id, SourceMonitor.user_id == current_user.id))).scalar_one_or_none()
    if item is None:
        raise HTTPException(status_code=404, detail="پایش پیدا نشد.")
    from ..monitoring import source_monitor_service
    try:
        return await source_monitor_service.run_one(monitor_id)
    except Exception as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
