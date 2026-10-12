"""Speech-to-text queue endpoints."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..models import File, Folder, User
from ..stt import STTJob, stt_queue

router = APIRouter(prefix="/stt", tags=["Speech to text"])


class STTCreate(BaseModel):
    file_id: int
    title: str = Field(default="رونویسی صدا", min_length=1, max_length=180)
    prompt: str = Field(default="", max_length=4000)
    folder_id: int | None = None
    output_mode: Literal["temporary", "save"] = "save"


@router.post("/jobs", status_code=202)
async def create_stt_job(payload: STTCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not stt_queue.available:
        raise HTTPException(status_code=503, detail="کلید Gemini روی سرور تنظیم نشده است.")
    source = (await db.execute(select(File).where(File.id == payload.file_id, File.user_id == current_user.id))).scalar_one_or_none()
    if source is None or source.file_type not in {"audio", "video"}:
        raise HTTPException(status_code=404, detail="فایل صوتی یا ویدیویی پیدا نشد.")
    if payload.folder_id is not None and (await db.execute(select(Folder.id).where(Folder.id == payload.folder_id, Folder.user_id == current_user.id))).scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="کشوی مقصد پیدا نشد.")
    job = STTJob(user_id=current_user.id, source_file_id=source.id, title=payload.title.strip(), folder_id=payload.folder_id, prompt=payload.prompt.strip(), output_mode=payload.output_mode)
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
