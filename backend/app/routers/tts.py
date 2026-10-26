"""Gemini text-to-speech settings and background job endpoints."""
from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..config import get_settings
from ..models import AppSetting, Folder, TTSUsage, TTSVoicePreview, User
from ..tts import GeminiTTSProvider, STT_MODEL_OPTIONS, TEXT_MODEL_OPTIONS, TTSJob, TTS_MODEL_OPTIONS, VOICE_OPTIONS, consume_tts_quota, load_tts_settings, model_options, model_quota_cost, normalize_tts_settings, route_ai_model, tts_queue
from ..gemini_keys import check_gemini_key, decrypt_user_keys, encrypt_user_keys

router = APIRouter(prefix="/tts", tags=["Text to speech"])
VOICE_PREVIEW_VERSION = "v3"
settings = get_settings()
AI_MODEL_COSTS_KEY = "ai_model_quota_costs"
AI_MODEL_CATALOG_KEY = "ai_model_catalog"


def _default_model_costs() -> dict[str, int]:
    return {item["value"]: int(item.get("cost", 1)) for item in [*TTS_MODEL_OPTIONS, *STT_MODEL_OPTIONS, *TEXT_MODEL_OPTIONS]}


async def load_model_costs(db: AsyncSession) -> dict[str, int]:
    costs = _default_model_costs()
    row = await db.get(AppSetting, AI_MODEL_COSTS_KEY)
    if row:
        try:
            saved = json.loads(row.value)
            if isinstance(saved, dict):
                costs.update({str(key): max(1, min(100, int(value))) for key, value in saved.items()})
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    return costs


def _clean_model_ids(values: list[str] | object) -> list[str]:
    if not isinstance(values, list):
        return []
    return list(dict.fromkeys(str(value).strip()[:120] for value in values if str(value).strip()))[:12]


async def load_model_catalog(db: AsyncSession) -> dict[str, list[str]]:
    catalog = {"tts_models": [], "stt_models": [], "text_models": []}
    row = await db.get(AppSetting, AI_MODEL_CATALOG_KEY)
    if row:
        try:
            saved = json.loads(row.value)
            if isinstance(saved, dict):
                catalog = {key: _clean_model_ids(saved.get(key, [])) for key in catalog}
        except (TypeError, ValueError, json.JSONDecodeError):
            pass
    return catalog


def _with_catalog(preferences: dict, catalog: dict[str, list[str]]) -> dict:
    return normalize_tts_settings({
        **preferences,
        "custom_tts_models": catalog["tts_models"],
        "custom_stt_models": catalog["stt_models"],
        "custom_text_models": catalog["text_models"],
    })


def quota_payload(usage: TTSUsage | None) -> dict:
    if usage is None:
        return {"tts":{"limit":0,"used":0,"remaining":None},"stt":{"limit":0,"used":0,"remaining":None}}
    used_today = usage.used_today if usage.usage_date == datetime.utcnow().date() else 0
    stt_used_today = usage.stt_used_today if usage.usage_date == datetime.utcnow().date() else 0
    return {
        "tts": {"limit": usage.daily_limit, "used": used_today, "remaining": max(0, usage.daily_limit-used_today) if usage.daily_limit else None},
        "stt": {"limit": usage.stt_daily_limit, "used": stt_used_today, "remaining": max(0, usage.stt_daily_limit-stt_used_today) if usage.stt_daily_limit else None},
    }


class TTSSettingsUpdate(BaseModel):
    voice: str = Field(min_length=1, max_length=80)
    style: str = Field(default="", max_length=500)
    speed: float = Field(default=1, ge=.5, le=2)
    model: str = Field(min_length=1, max_length=120)
    stt_model: str | None = Field(default=None, min_length=1, max_length=120)
    stt_mode: Literal["verbatim", "smart"] | None = None
    text_model: str | None = Field(default=None, min_length=1, max_length=120)
    auto_expression: bool = True
    gender: Literal["all", "female", "male"] = "all"
    pitch: Literal["all", "low", "medium", "high"] = "all"
    use_case: Literal["general", "audiobook", "podcast", "story", "education", "news", "advertising", "accessibility"] = "general"
    folder_id: int | None = None
    ai_routing_mode: Literal["auto", "economy", "quality", "manual"] = "auto"
    custom_tts_models: list[str] = Field(default_factory=list, max_length=12)
    custom_stt_models: list[str] = Field(default_factory=list, max_length=12)
    custom_text_models: list[str] = Field(default_factory=list, max_length=12)
    model_costs: dict[str, int] | None = None


class AIModelCatalogUpdate(BaseModel):
    tts_models: list[str] = Field(default_factory=list, max_length=12)
    stt_models: list[str] = Field(default_factory=list, max_length=12)
    text_models: list[str] = Field(default_factory=list, max_length=12)
    costs: dict[str, int] = Field(default_factory=dict)


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


@router.post("/personal-keys/test")
async def test_personal_keys(current_user: User = Depends(get_current_user)):
    keys = decrypt_user_keys(current_user.gemini_api_keys_encrypted)
    if not keys:
        raise HTTPException(status_code=400, detail="هنوز کلید شخصی ذخیره نشده است.")
    results = await asyncio.gather(*(asyncio.to_thread(check_gemini_key, key) for key in keys))
    return {"results": results}


@router.get("/settings")
async def get_tts_settings(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    personal_keys = decrypt_user_keys(current_user.gemini_api_keys_encrypted)
    catalog = await load_model_catalog(db)
    preferences = _with_catalog(load_tts_settings(current_user), catalog)
    costs = await load_model_costs(db)
    usage = await db.get(TTSUsage, current_user.id)
    return {
        **preferences,
        "available": tts_queue.available or bool(personal_keys),
        "personal_key_count": len(personal_keys),
        "voices": VOICE_OPTIONS,
        "models": model_options(TTS_MODEL_OPTIONS, preferences["custom_tts_models"], costs),
        "stt_models": model_options(STT_MODEL_OPTIONS, preferences["custom_stt_models"], costs),
        "text_models": model_options(TEXT_MODEL_OPTIONS, preferences["custom_text_models"], costs),
        "model_costs": costs,
        "can_edit_model_costs": current_user.telegram_id in settings.admin_users,
        "quota": quota_payload(usage),
    }


@router.get("/model-catalog")
async def get_model_catalog(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    catalog = await load_model_catalog(db)
    costs = await load_model_costs(db)
    return {
        **catalog,
        "models": model_options(TTS_MODEL_OPTIONS, catalog["tts_models"], costs),
        "stt_models_available": model_options(STT_MODEL_OPTIONS, catalog["stt_models"], costs),
        "text_models_available": model_options(TEXT_MODEL_OPTIONS, catalog["text_models"], costs),
        "costs": costs,
        "can_edit": current_user.telegram_id in settings.admin_users,
    }


@router.put("/model-catalog")
async def update_model_catalog(payload: AIModelCatalogUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if current_user.telegram_id not in settings.admin_users:
        raise HTTPException(status_code=403, detail="فقط مدیر می‌تواند مدل‌ها و ضرایب سهمیه را تغییر دهد.")
    catalog = {
        "tts_models": _clean_model_ids(payload.tts_models),
        "stt_models": _clean_model_ids(payload.stt_models),
        "text_models": _clean_model_ids(payload.text_models),
    }
    known_ids = {
        item["value"] for item in [
            *model_options(TTS_MODEL_OPTIONS, catalog["tts_models"], {}),
            *model_options(STT_MODEL_OPTIONS, catalog["stt_models"], {}),
            *model_options(TEXT_MODEL_OPTIONS, catalog["text_models"], {}),
        ]
    }
    normalized_costs = {
        str(key)[:120]: max(1, min(100, int(value)))
        for key, value in payload.costs.items() if str(key) in known_ids
    }
    for key, value in ((AI_MODEL_CATALOG_KEY, catalog), (AI_MODEL_COSTS_KEY, normalized_costs)):
        row = await db.get(AppSetting, key)
        encoded = json.dumps(value, ensure_ascii=False)
        if row is None:
            db.add(AppSetting(key=key, value=encoded))
        else:
            row.value = encoded
    await db.commit()
    costs = await load_model_costs(db)
    return {
        **catalog,
        "models": model_options(TTS_MODEL_OPTIONS, catalog["tts_models"], costs),
        "stt_models_available": model_options(STT_MODEL_OPTIONS, catalog["stt_models"], costs),
        "text_models_available": model_options(TEXT_MODEL_OPTIONS, catalog["text_models"], costs),
        "costs": costs,
        "can_edit": True,
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
    payload_data = payload.model_dump(exclude_none=True)
    payload_data.pop("model_costs", None)
    payload_data.pop("custom_tts_models", None)
    payload_data.pop("custom_stt_models", None)
    payload_data.pop("custom_text_models", None)
    catalog = await load_model_catalog(db)
    preferences = _with_catalog({**load_tts_settings(current_user), **payload_data}, catalog)
    current_user.tts_settings_json = json.dumps(preferences, ensure_ascii=False)
    await db.commit()
    personal_keys = decrypt_user_keys(current_user.gemini_api_keys_encrypted)
    costs = await load_model_costs(db)
    usage = await db.get(TTSUsage, current_user.id)
    return {**preferences, "available": tts_queue.available or bool(personal_keys), "personal_key_count": len(personal_keys), "voices": VOICE_OPTIONS, "models": model_options(TTS_MODEL_OPTIONS, preferences["custom_tts_models"], costs), "stt_models": model_options(STT_MODEL_OPTIONS, preferences["custom_stt_models"], costs), "text_models": model_options(TEXT_MODEL_OPTIONS, preferences["custom_text_models"], costs), "model_costs": costs, "can_edit_model_costs": current_user.telegram_id in settings.admin_users, "quota": quota_payload(usage)}


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
    catalog = await load_model_catalog(db)
    preferences = _with_catalog(load_tts_settings(current_user), catalog)
    for key in ("voice", "style", "speed", "auto_expression", "gender", "pitch", "use_case"):
        value = getattr(payload, key)
        if value is not None:
            preferences[key] = value
    preferences = _with_catalog(preferences, catalog)
    preferences["model"] = route_ai_model(preferences, "tts", len(payload.text.strip()))
    costs = await load_model_costs(db)
    quota_cost = model_quota_cost(costs, preferences["model"])
    target_folder_id = payload.folder_id if payload.folder_id is not None else preferences.get("folder_id")
    if target_folder_id is not None:
        folder = (await db.execute(select(Folder).where(Folder.id == target_folder_id, Folder.user_id == current_user.id))).scalar_one_or_none()
        if folder is None:
            target_folder_id = None
    try:
        usage = await consume_tts_quota(db, current_user.id, len(payload.text.strip()), quota_cost)
    except ValueError as error:
        raise HTTPException(status_code=429, detail=str(error)) from error
    job = TTSJob(
        user_id=current_user.id, telegram_id=current_user.telegram_id,
        text=payload.text.strip(), title=payload.title.strip(), folder_id=target_folder_id,
        preferences=preferences, output_mode=payload.output_mode,
        api_keys=personal_keys,
    )
    position = await tts_queue.enqueue(job)
    remaining = max(0, usage.daily_limit-usage.used_today) if usage.daily_limit else None
    return {"job_id": job.id, "queue_position": position, "message": "ساخت صدا شروع شد.", "quota_cost": quota_cost, "quota_remaining": remaining}


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
    catalog = await load_model_catalog(db)
    preferences = _with_catalog(load_tts_settings(current_user), catalog)
    preferences["model"] = route_ai_model(preferences, "tts", 100)
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


@router.post("/jobs/cancel-all")
async def cancel_all_tts_jobs(current_user:User=Depends(get_current_user)):
    return {"cancelled":tts_queue.cancel_all(current_user.id)}


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
