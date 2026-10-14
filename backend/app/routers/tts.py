"""Gemini text-to-speech settings and background job endpoints."""
from __future__ import annotations

import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import Folder, TTSVoicePreview, User
from ..tts import GeminiTTSProvider, TTSJob, VOICE_OPTIONS, consume_tts_quota, load_tts_settings, normalize_tts_settings, tts_queue
from ..gemini_keys import decrypt_user_keys, encrypt_user_keys

router = APIRouter(prefix="/tts", tags=["Text to speech"])
VOICE_PREVIEW_VERSION = "v3"


class TTSSettingsUpdate(BaseModel):
    voice: str = Field(min_length=1, max_length=80)
    style: str = Field(default="", max_length=500)
    speed: float = Field(default=1, ge=.5, le=2)
    model: str = Field(min_length=1, max_length=120)
    auto_expression: bool = True
    gender: Literal["all", "female", "male"] = "all"
    pitch: Literal["all", "low", "medium", "high"] = "all"
    use_case: Literal["general", "audiobook", "podcast", "story", "education", "news", "advertising", "accessibility"] = "general"
    folder_id: int | None = None


class TTSCreate(BaseModel):
    text: str = Field(min_length=1, max_length=200_000)
    title: str = Field(default="صدای ساخته‌شده", min_length=1, max_length=180)
    folder_id: int | None = None
    voice: str | None = Field(default=None, max_length=80)
    style: str | None = Field(default=None, max_length=500)
    speed: float | None = Field(default=None, ge=.5, le=2)
    auto_expression: bool | None = None
    gender: Literal["all", "female", "male"] | None = None
    pitch: Literal["all", "low", "medium", "high"] | None = None
    use_case: Literal["general", "audiobook", "podcast", "story", "education", "news", "advertising", "accessibility"] | None = None
    output_mode: Literal["save", "preview", "telegram"] = "save"


class GeminiKeysUpdate(BaseModel):
    keys: list[str] = Field(default_factory=list, max_length=8)


def gemini_key_summary(user: User) -> dict:
    keys = decrypt_user_keys(user.gemini_api_keys_encrypted)
    return {"count": len(keys), "masked": [f"••••{key[-4:]}" for key in keys]}


@router.get("/personal-keys")
async def get_personal_keys(current_user: User = Depends(get_current_user)):
    return gemini_key_summary(current_user)


@router.put("/personal-keys")
async def update_personal_keys(payload: GeminiKeysUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    keys = list(dict.fromkeys(key.strip() for key in payload.keys if key.strip()))
    if any(len(key) < 20 for key in keys):
        raise HTTPException(status_code=400, detail="یکی از کلیدهای Gemini معتبر نیست.")
    current_user.gemini_api_keys_encrypted = encrypt_user_keys(keys)
    await db.commit()
    return gemini_key_summary(current_user)


@router.delete("/personal-keys")
async def delete_personal_keys(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    current_user.gemini_api_keys_encrypted = None
    await db.commit()
    return {"count": 0, "masked": []}


@router.get("/settings")
async def get_tts_settings(current_user: User = Depends(get_current_user)):
    personal_keys = decrypt_user_keys(current_user.gemini_api_keys_encrypted)
    return {
        **load_tts_settings(current_user),
        "available": tts_queue.available or bool(personal_keys),
        "personal_key_count": len(personal_keys),
        "voices": VOICE_OPTIONS,
    }


@router.put("/settings")
async def update_tts_settings(
    payload: TTSSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.folder_id is not None:
        folder = (await db.execute(select(Folder).where(Folder.id == payload.folder_id, Folder.user_id == current_user.id))).scalar_one_or_none()
        if folder is None:
            raise HTTPException(status_code=404, detail="کشوی پیش‌فرض پیدا نشد.")
    preferences = normalize_tts_settings(payload.model_dump())
    current_user.tts_settings_json = json.dumps(preferences, ensure_ascii=False)
    await db.commit()
    personal_keys = decrypt_user_keys(current_user.gemini_api_keys_encrypted)
    return {**preferences, "available": tts_queue.available or bool(personal_keys), "personal_key_count": len(personal_keys), "voices": VOICE_OPTIONS}


@router.post("/jobs", status_code=202)
async def create_tts_job(
    payload: TTSCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    personal_keys = decrypt_user_keys(current_user.gemini_api_keys_encrypted)
    if not tts_queue.available and not personal_keys:
        raise HTTPException(status_code=503, detail="کلید Gemini TTS هنوز روی سرور تنظیم نشده است.")
    if payload.folder_id is not None:
        folder = (await db.execute(select(Folder).where(Folder.id == payload.folder_id, Folder.user_id == current_user.id))).scalar_one_or_none()
        if folder is None:
            raise HTTPException(status_code=404, detail="کشوی مقصد پیدا نشد.")
    preferences = load_tts_settings(current_user)
    for key in ("voice", "style", "speed", "auto_expression", "gender", "pitch", "use_case"):
        value = getattr(payload, key)
        if value is not None:
            preferences[key] = value
    preferences = normalize_tts_settings(preferences)
    target_folder_id = payload.folder_id if payload.folder_id is not None else preferences.get("folder_id")
    if target_folder_id is not None:
        folder = (await db.execute(select(Folder).where(Folder.id == target_folder_id, Folder.user_id == current_user.id))).scalar_one_or_none()
        if folder is None:
            target_folder_id = None
    try:
        await consume_tts_quota(db, current_user.id, len(payload.text.strip()))
    except ValueError as error:
        raise HTTPException(status_code=429, detail=str(error)) from error
    job = TTSJob(
        user_id=current_user.id, telegram_id=current_user.telegram_id,
        text=payload.text.strip(), title=payload.title.strip(), folder_id=target_folder_id,
        preferences=preferences, output_mode=payload.output_mode,
        api_keys=personal_keys,
    )
    position = await tts_queue.enqueue(job)
    return {"job_id": job.id, "queue_position": position, "message": "ساخت صدا شروع شد."}


@router.get("/preview/{voice}")
async def preview_tts_voice(
    voice: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    voice_info = next((item for item in VOICE_OPTIONS if item["value"] == voice), None)
    if voice_info is None:
        raise HTTPException(status_code=404, detail="این گوینده پیدا نشد.")
    personal_keys = decrypt_user_keys(current_user.gemini_api_keys_encrypted)
    if not tts_queue.available and not personal_keys:
        raise HTTPException(status_code=503, detail="کلید Gemini TTS هنوز روی سرور تنظیم نشده است.")
    preferences = load_tts_settings(current_user)
    preferences.update(voice=voice, style="طبیعی، واضح و دوستانه", auto_expression=False, use_case="general", speed=1)
    preview_model_key = f'{preferences["model"]}::{VOICE_PREVIEW_VERSION}'
    # Remove samples generated with older prompts/models instead of merely
    # ignoring them. The v3 key also forces every browser to fetch fresh audio.
    await db.execute(delete(TTSVoicePreview).where(TTSVoicePreview.model != preview_model_key))
    await db.commit()
    cached = (await db.execute(select(TTSVoicePreview).where(
        TTSVoicePreview.model == preview_model_key, TTSVoicePreview.voice == voice,
    ))).scalar_one_or_none()
    if cached is None:
        provider = GeminiTTSProvider(list(dict.fromkeys(personal_keys + tts_queue.provider.api_keys))) if personal_keys else tts_queue.provider
        audio = await provider.synthesize(
            "سلام. من یکی از صداهای کُمُدم. این نمونه رو گوش کن و اگه خوشت اومد من رو انتخاب کن.",
            preferences,
        )
        cached = TTSVoicePreview(model=preview_model_key, voice=voice, audio=audio)
        db.add(cached)
        await db.commit()
    return Response(content=cached.audio, media_type="audio/wav", headers={"Cache-Control": "private, max-age=2592000"})


@router.get("/jobs/{job_id}/audio")
async def get_tts_job_audio(job_id: str, current_user: User = Depends(get_current_user)):
    status = tts_queue.status(job_id, current_user.id)
    audio = tts_queue.audio_outputs.get(job_id)
    if status is None or audio is None:
        raise HTTPException(status_code=404, detail="خروجی موقت پیدا نشد یا زمان نگهداری آن تمام شده است.")
    return Response(content=audio, media_type="audio/wav", headers={"Cache-Control": "private, no-store"})


@router.get("/jobs")
async def list_tts_jobs(current_user: User = Depends(get_current_user)):
    return tts_queue.list_statuses(current_user.id)


@router.delete("/jobs")
async def clear_finished_tts_jobs(current_user: User = Depends(get_current_user)):
    return {"removed": tts_queue.clear_finished(current_user.id)}


@router.get("/jobs/{job_id}")
async def get_tts_job(job_id: str, current_user: User = Depends(get_current_user)):
    status = tts_queue.status(job_id, current_user.id)
    if status is None:
        raise HTTPException(status_code=404, detail="این کار پیدا نشد.")
    return status


@router.delete("/jobs/{job_id}", status_code=204)
async def dismiss_tts_job(job_id: str, current_user: User = Depends(get_current_user)):
    if not tts_queue.dismiss(job_id, current_user.id):
        raise HTTPException(status_code=409, detail="فقط کارهای پایان‌یافته را می‌توان از تاریخچه پاک کرد.")


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
