"""Admin API for editable Telegram bot messages."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..bot_messages import BOT_MESSAGE_DEFINITIONS, SETTING_PREFIX, invalidate_bot_message_cache, validate_bot_message
from ..database import get_db
from ..models import AppSetting, User
from .accounts import require_admin

router = APIRouter(prefix="/admin/bot-messages", tags=["Admin bot messages"])


class BotMessageUpdate(BaseModel):
    value: str


@router.get("")
async def list_bot_messages(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(AppSetting).where(AppSetting.key.like(f"{SETTING_PREFIX}%")))).scalars().all()
    overrides = {row.key.removeprefix(SETTING_PREFIX): row.value for row in rows}
    return [{
        "key": item.key, "title": item.title, "category": item.category,
        "default": item.default, "value": overrides.get(item.key, item.default),
        "customized": item.key in overrides, "variables": list(item.variables),
    } for item in BOT_MESSAGE_DEFINITIONS]


@router.put("/{key}")
async def update_bot_message(key: str, payload: BotMessageUpdate, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    try:
        value = validate_bot_message(key, payload.value)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    setting_key = f"{SETTING_PREFIX}{key}"
    row = await db.get(AppSetting, setting_key)
    if row is None:
        db.add(AppSetting(key=setting_key, value=value))
    else:
        row.value = value
    await db.commit()
    invalidate_bot_message_cache()
    return {"key": key, "value": value, "customized": True}


@router.delete("/{key}")
async def reset_bot_message(key: str, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    definition = next((item for item in BOT_MESSAGE_DEFINITIONS if item.key == key), None)
    if definition is None:
        raise HTTPException(status_code=404, detail="پیام پیدا نشد.")
    await db.execute(delete(AppSetting).where(AppSetting.key == f"{SETTING_PREFIX}{key}"))
    await db.commit()
    invalidate_bot_message_cache()
    return {"key": key, "value": definition.default, "customized": False}
