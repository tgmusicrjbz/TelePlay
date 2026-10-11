"""Gemini text-to-speech settings and background job endpoints."""
from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import Folder, User
from ..tts import TTSJob, VOICE_OPTIONS, load_tts_settings, normalize_tts_settings, tts_queue

router = APIRouter(prefix="/tts", tags=["Text to speech"])


class TTSSettingsUpdate(BaseModel):
    voice: str = Field(min_length=1, max_length=80)
    style: str = Field(default="", max_length=500)
    speed: float = Field(default=1, ge=.5, le=2)
    model: str = Field(min_length=1, max_length=120)
    auto_expression: bool = True


class TTSCreate(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)
    title: str = Field(default="صدای ساخته‌شده", min_length=1, max_length=180)
    folder_id: int | None = None
    voice: str | None = Field(default=None, max_length=80)
    style: str | None = Field(default=None, max_length=500)
    speed: float | None = Field(default=None, ge=.5, le=2)
    auto_expression: bool | None = None


@router.get("/settings")
async def get_tts_settings(current_user: User = Depends(get_current_user)):
    return {
        **load_tts_settings(current_user),
        "available": tts_queue.available,
        "voices": VOICE_OPTIONS,
    }


@router.put("/settings")
async def update_tts_settings(
    payload: TTSSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    preferences = normalize_tts_settings(payload.model_dump())
    current_user.tts_settings_json = json.dumps(preferences, ensure_ascii=False)
    await db.commit()
    return {**preferences, "available": tts_queue.available, "voices": VOICE_OPTIONS}


@router.post("/jobs", status_code=202)
async def create_tts_job(
    payload: TTSCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if not tts_queue.available:
        raise HTTPException(status_code=503, detail="کلید Gemini TTS هنوز روی سرور تنظیم نشده است.")
    if payload.folder_id is not None:
        folder = (await db.execute(select(Folder).where(Folder.id == payload.folder_id, Folder.user_id == current_user.id))).scalar_one_or_none()
        if folder is None:
            raise HTTPException(status_code=404, detail="کشوی مقصد پیدا نشد.")
    preferences = load_tts_settings(current_user)
    for key in ("voice", "style", "speed", "auto_expression"):
        value = getattr(payload, key)
        if value is not None:
            preferences[key] = value
    preferences = normalize_tts_settings(preferences)
    job = TTSJob(
        user_id=current_user.id, telegram_id=current_user.telegram_id,
        text=payload.text.strip(), title=payload.title.strip(), folder_id=payload.folder_id,
        preferences=preferences,
    )
    position = await tts_queue.enqueue(job)
    return {"job_id": job.id, "queue_position": position, "message": "متن در صف ساخت صدا قرار گرفت."}


@router.get("/jobs")
async def list_tts_jobs(current_user: User = Depends(get_current_user)):
    return tts_queue.list_statuses(current_user.id)


@router.get("/jobs/{job_id}")
async def get_tts_job(job_id: str, current_user: User = Depends(get_current_user)):
    status = tts_queue.status(job_id, current_user.id)
    if status is None:
        raise HTTPException(status_code=404, detail="این کار پیدا نشد.")
    return status


@router.post("/jobs/{job_id}/{action}")
async def control_tts_job(
    job_id: str,
    action: Literal["pause", "cancel"],
    current_user: User = Depends(get_current_user),
):
    status = tts_queue.toggle_pause(job_id, current_user.id) if action == "pause" else tts_queue.cancel(job_id, current_user.id)
    if status is None:
        raise HTTPException(status_code=404, detail="این کار پیدا نشد.")
    return status
