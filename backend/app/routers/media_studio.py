"""Media Studio API."""
import json
from typing import Any, Literal
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..database import get_db
from ..media_studio import AUDIO_FORMATS, IMAGE_FORMATS, RUNNING_STATES, VIDEO_FORMATS, media_studio, new_job_id
from ..models import File, Folder, ProcessingJob, User

router = APIRouter(prefix="/media-studio", tags=["Media Studio"])


class MediaJobCreate(BaseModel):
    operation: Literal["compress", "convert", "extract_audio", "trim", "merge"]
    file_ids: list[int] = Field(min_length=1, max_length=12)
    title: str = Field(default="خروجی استودیوی رسانه", min_length=1, max_length=180)
    folder_id: int | None = None
    options: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_count(self):
        if self.operation == "merge" and len(self.file_ids) < 2: raise ValueError("برای ادغام حداقل دو فایل لازم است.")
        if self.operation != "merge" and len(self.file_ids) != 1: raise ValueError("این عملیات هر بار روی یک فایل اجرا می‌شود.")
        return self


def serialize(job: ProcessingJob):
    def decode(value: str):
        try: return json.loads(value or "{}")
        except json.JSONDecodeError: return {}
    request, result = decode(job.payload_json), decode(job.result_json)
    return {"id":job.id,"state":job.state,"progress":job.progress,"message":job.message,"title":job.title,
            "operation":request.get("operation"),"file_ids":request.get("file_ids",[]),"result":result,
            "created_at":job.created_at,"updated_at":job.updated_at,"finished_at":job.finished_at}


@router.get("/capabilities")
async def capabilities(_: User = Depends(get_current_user)):
    return {"available":media_studio.available,"max_batch":12,"max_concurrent":2,
            "engine":"ffmpeg" if media_studio.available else None,
            "operations":["compress","convert","extract_audio","trim","merge"],
            "formats":{"video":sorted(VIDEO_FORMATS),"audio":sorted(AUDIO_FORMATS),"image":sorted(IMAGE_FORMATS)},
            "codecs":await media_studio.supported_codecs(),"presets":["smallest","balanced","best","web","social","custom"]}


@router.get("/jobs")
async def jobs(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows=(await db.execute(select(ProcessingJob).where(ProcessingJob.user_id==current_user.id,ProcessingJob.kind=="media_studio").order_by(desc(ProcessingJob.created_at)).limit(60))).scalars().all()
    return [serialize(row) for row in rows]


@router.post("/jobs", status_code=202)
async def create(payload: MediaJobCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if not media_studio.available: raise HTTPException(503,"FFmpeg روی سرویس پردازش نصب نیست.")
    active=await db.scalar(select(func.count()).select_from(ProcessingJob).where(ProcessingJob.user_id==current_user.id,ProcessingJob.kind=="media_studio",ProcessingJob.state.in_(RUNNING_STATES)))
    if (active or 0)>=8: raise HTTPException(429,"حداکثر ۸ پردازش هم‌زمان در صف مجاز است.")
    if payload.folder_id is not None and not await db.scalar(select(Folder.id).where(Folder.id==payload.folder_id,Folder.user_id==current_user.id)): raise HTTPException(404,"کشوی مقصد پیدا نشد.")
    files=list((await db.execute(select(File).where(File.id.in_(payload.file_ids),File.user_id==current_user.id))).scalars())
    if len(files)!=len(set(payload.file_ids)): raise HTTPException(404,"یکی از فایل‌های ورودی پیدا نشد.")
    if payload.operation=="extract_audio" and files[0].file_type!="video": raise HTTPException(400,"استخراج صوت فقط برای ویدیو قابل انجام است.")
    if payload.operation=="merge" and len({item.file_type for item in files})!=1: raise HTTPException(400,"برای ادغام، نوع همه فایل‌ها باید یکسان باشد.")
    job=ProcessingJob(id=new_job_id(),user_id=current_user.id,kind="media_studio",state="queued",title=payload.title.strip(),progress=0,message="در صف پردازش",payload_json=json.dumps(payload.model_dump(),ensure_ascii=False),result_json="{}")
    db.add(job); await db.commit(); media_studio.start(job.id)
    return serialize(job)


@router.post("/jobs/{job_id}/retry", status_code=202)
async def retry(job_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    job=await db.get(ProcessingJob,job_id)
    if not job or job.user_id!=current_user.id or job.kind!="media_studio": raise HTTPException(404,"پردازش پیدا نشد.")
    if job.state in RUNNING_STATES: raise HTTPException(409,"پردازش هنوز در حال اجراست.")
    job.state,job.progress,job.message,job.result_json,job.finished_at="queued",0,"در صف پردازش","{}",None
    await db.commit(); media_studio.start(job.id); return serialize(job)


@router.delete("/jobs/{job_id}")
async def remove(job_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    job=await db.get(ProcessingJob,job_id)
    if not job or job.user_id!=current_user.id or job.kind!="media_studio": raise HTTPException(404,"پردازش پیدا نشد.")
    if job.state in RUNNING_STATES: await media_studio.cancel(job_id); return {"cancelled":True}
    await db.delete(job); await db.commit(); return {"deleted":True}
