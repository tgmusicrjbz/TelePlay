"""Speech-to-text queue endpoints."""
import asyncio
from datetime import datetime, timedelta
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import File, Folder, User
from ..stt import GeminiSTTProvider, STTJob, consume_stt_quota, stt_queue
from ..gemini_keys import decrypt_user_keys

router = APIRouter(prefix="/stt", tags=["Speech to text"])
_refine_jobs: dict[str, dict] = {}


class STTCreate(BaseModel):
    file_id: int
    title: str = Field(default="رونویسی صدا", min_length=1, max_length=180)
    prompt: str = Field(default="", max_length=4000)
    folder_id: int | None = None
    output_mode: Literal["temporary", "save"] = "save"


class STTRefine(BaseModel):
    content: str = Field(min_length=1, max_length=200_000)
    prompt: str = Field(min_length=1, max_length=4_000)


@router.post("/refine")
async def refine_stt_text(payload: STTRefine, current_user: User = Depends(get_current_user)):
    personal_keys = decrypt_user_keys(current_user.gemini_api_keys_encrypted)
    keys = list(dict.fromkeys(personal_keys + stt_queue.provider.api_keys))
    if not keys:
        raise HTTPException(status_code=503, detail="برای ویرایش متن، کلید Gemini تنظیم نشده است.")
    try:
        content = await GeminiSTTProvider(keys).refine_text(payload.content.strip(), payload.prompt.strip())
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    return {"content": content}


async def _run_refine_job(job_id: str, keys: list[str], content: str, prompt: str) -> None:
    job = _refine_jobs[job_id]
    job.update(state="processing", message="هوش مصنوعی در حال ویرایش متن است.", progress=35)
    try:
        result = await GeminiSTTProvider(keys).refine_text(content, prompt)
        job.update(state="done", message="نسخه تازه آماده شد.", progress=100, content=result, finished_at=datetime.utcnow().isoformat())
    except Exception as error:
        job.update(state="error", message=str(error) or "ویرایش متن انجام نشد.", progress=100, finished_at=datetime.utcnow().isoformat())


@router.post("/refine/jobs", status_code=202)
async def create_refine_job(payload: STTRefine, current_user: User = Depends(get_current_user)):
    personal_keys = decrypt_user_keys(current_user.gemini_api_keys_encrypted)
    keys = list(dict.fromkeys(personal_keys + stt_queue.provider.api_keys))
    if not keys:
        raise HTTPException(status_code=503, detail="برای ویرایش متن، کلید Gemini تنظیم نشده است.")
    cutoff = datetime.utcnow() - timedelta(hours=2)
    for stale_id, stale in list(_refine_jobs.items()):
        finished = stale.get("finished_at")
        if finished and datetime.fromisoformat(finished) < cutoff:
            _refine_jobs.pop(stale_id, None)
    job_id = uuid4().hex
    _refine_jobs[job_id] = {
        "id": job_id, "user_id": current_user.id, "state": "queued",
        "message": "درخواست ویرایش ثبت شد.", "progress": 10, "content": None,
    }
    asyncio.create_task(_run_refine_job(job_id, keys, payload.content.strip(), payload.prompt.strip()))
    return {"job_id": job_id, "state": "queued", "message": "درخواست ویرایش ثبت شد.", "progress": 10}


@router.get("/refine/jobs/{job_id}")
async def get_refine_job(job_id: str, current_user: User = Depends(get_current_user)):
    job = _refine_jobs.get(job_id)
    if not job or job["user_id"] != current_user.id:
        raise HTTPException(status_code=404, detail="این درخواست ویرایش پیدا نشد.")
    return {key: value for key, value in job.items() if key != "user_id"}


@router.post("/jobs", status_code=202)
async def create_stt_job(payload: STTCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    personal_keys = decrypt_user_keys(current_user.gemini_api_keys_encrypted)
    if not stt_queue.available and not personal_keys:
        raise HTTPException(status_code=503, detail="کلید Gemini روی سرور تنظیم نشده است.")
    source = (await db.execute(select(File).where(File.id == payload.file_id, File.user_id == current_user.id))).scalar_one_or_none()
    if source is None or source.file_type not in {"audio", "video"}:
        raise HTTPException(status_code=404, detail="فایل صوتی یا ویدیویی پیدا نشد.")
    folder_id = payload.folder_id if payload.output_mode == "save" else None
    if folder_id is not None and (await db.execute(select(Folder.id).where(Folder.id == folder_id, Folder.user_id == current_user.id))).scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="کشوی مقصد پیدا نشد.")
    try:
        await consume_stt_quota(db, current_user.id, int(source.duration or 0))
    except ValueError as error:
        raise HTTPException(status_code=429, detail=str(error)) from error
    job = STTJob(user_id=current_user.id, source_file_id=source.id, title=payload.title.strip(), folder_id=folder_id, prompt=payload.prompt.strip(), output_mode=payload.output_mode, api_keys=personal_keys)
    position = await stt_queue.enqueue(job)
    return {"job_id": job.id, "queue_position": position, "message": "تبدیل صدا به متن شروع شد."}


@router.get("/jobs")
async def list_stt_jobs(current_user: User = Depends(get_current_user)):
    return stt_queue.list_statuses(current_user.id)


@router.get("/jobs/{job_id}")
async def get_stt_job(job_id: str, current_user: User = Depends(get_current_user)):
    status = stt_queue.status(job_id, current_user.id)
    if status is None:
        raise HTTPException(status_code=404, detail="این کار پیدا نشد.")
    return status


@router.post("/jobs/{job_id}/cancel")
async def cancel_stt_job(job_id: str, current_user: User = Depends(get_current_user)):
    status = stt_queue.cancel(job_id, current_user.id)
    if status is None:
        raise HTTPException(status_code=404, detail="این کار پیدا نشد.")
    return status


@router.delete("/jobs/{job_id}", status_code=204)
async def dismiss_stt_job(job_id: str, current_user: User = Depends(get_current_user)):
    if not stt_queue.dismiss(job_id, current_user.id):
        raise HTTPException(status_code=409, detail="فقط کار پایان‌یافته را می‌توان پاک کرد.")
