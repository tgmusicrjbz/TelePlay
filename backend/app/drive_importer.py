"""Background server-to-server imports for public Google Drive files."""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import mimetypes
import re
import tempfile
import uuid
from datetime import datetime, timedelta
from email.header import decode_header, make_header
from email.message import Message
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlencode, urlparse
from urllib.request import Request, urlopen

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .config import get_settings
from .database import async_session
from .models import AppSetting, File, ProcessingJob, TelegramDestination, User
from .link_captions import render_link_caption
from .processing_jobs import create_job, delete_finished_jobs, delete_job, load_jobs, update_job
from .services import sanitize_filename, select_best_thumbnail
from . import telegram

logger = logging.getLogger(__name__)
settings = get_settings()
MAX_DRIVE_FILE_SIZE = 2 * 1024 * 1024 * 1024


def extract_google_drive_file_id(value: str) -> str | None:
    try:
        parsed = urlparse(value.strip())
    except ValueError:
        return None
    host = (parsed.hostname or "").lower()
    if host not in {"drive.google.com", "drive.usercontent.google.com"}:
        return None
    match = re.search(r"/file/d/([A-Za-z0-9_-]{10,})", parsed.path)
    candidate = match.group(1) if match else (parse_qs(parsed.query).get("id") or [None])[0]
    return candidate if candidate and re.fullmatch(r"[A-Za-z0-9_-]{10,}", candidate) else None


def _response_filename(headers, file_id: str) -> str:
    disposition = headers.get("Content-Disposition", "")
    message=Message(); message["content-disposition"]=disposition
    name=message.get_filename()
    if not name:
        encoded = re.search(r"filename\*=UTF-8''([^;]+)", disposition, re.IGNORECASE)
        plain = re.search(r'filename="?([^";]+)', disposition, re.IGNORECASE)
        name = unquote(encoded.group(1)) if encoded else plain.group(1).strip() if plain else f"google-drive-{file_id}"
    try: name=str(make_header(decode_header(unquote(name))))
    except (UnicodeDecodeError,LookupError,ValueError): name=unquote(name)
    # Some Google/proxy responses expose UTF-8 header bytes as latin-1 text.
    if any(marker in name for marker in ("Ø","Ù","Ã","Â")):
        try: name=name.encode("latin-1").decode("utf-8")
        except (UnicodeEncodeError,UnicodeDecodeError): pass
    return sanitize_filename(name)[:500]


def _detect_type(filename: str, mime_type: str | None) -> str:
    mime = (mime_type or mimetypes.guess_type(filename)[0] or "").lower()
    suffix = Path(filename).suffix.lower()
    if mime.startswith("video/") or suffix in {".mp4", ".mkv", ".webm", ".mov", ".avi"}: return "video"
    if mime.startswith("audio/") or suffix in {".mp3", ".m4a", ".ogg", ".wav", ".flac", ".opus"}: return "audio"
    if mime.startswith("image/") or suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}: return "image"
    if mime.startswith("text/") or suffix in {".txt", ".md", ".markdown"}: return "text"
    return "document"


def _sha256(path: str) -> str:
    digest=hashlib.sha256()
    with open(path,"rb") as source:
        while chunk:=source.read(1024*1024): digest.update(chunk)
    return digest.hexdigest()


class GoogleDriveImporter:
    def __init__(self) -> None:
        self.statuses: dict[str, dict] = {}
        self.tasks: dict[str, asyncio.Task] = {}
        self.cancelled: set[str] = set()
        self.durable_job_ids: set[str] = set()
        self._persist_tasks: dict[str,asyncio.Task] = {}
        self._persist_dirty: set[str] = set()
        self._recovered = False
        self._stopping = False
        self._semaphore = asyncio.Semaphore(2)

    async def start(self) -> None:
        """Restore unfinished transfers after a deploy or process restart."""
        self._stopping = False
        if self._recovered:
            return
        recovered_jobs=await load_jobs("drive",recent_for=timedelta(seconds=45))
        self._recovered = True
        for payload,status in recovered_jobs:
            if not payload or not status:
                continue
            job_id=str(status.get("id") or payload.get("id") or "")
            if not job_id or job_id in self.statuses:
                continue
            self.statuses[job_id]=status
            self.durable_job_ids.add(job_id)
            if status.get("state") in {"done","error","cancelled"}:
                continue
            try:
                destination_ids=[int(value) for value in payload.get("destination_ids",[]) if str(value).isdigit()]
                status.update(state="queued",message="ادامه انتقال پس از راه‌اندازی دوباره",progress=0)
                await update_job(job_id,status)
                self.tasks[job_id]=asyncio.create_task(self._run(
                    job_id,str(payload["file_id"]),int(payload["user_id"]),int(payload["folder_id"]),
                    bool(payload.get("authenticated",False)),payload.get("file_name"),payload.get("mime_type"),
                    bool(payload.get("send_to_telegram",False)),destination_ids,
                ),name=f"drive-import-{job_id[:8]}")
            except (KeyError,TypeError,ValueError):
                logger.warning("Could not recover malformed Drive job %s",job_id,exc_info=True)
                status.update(state="error",message="اطلاعات انتقال قبلی ناقص بود؛ دوباره آن را ثبت کن.",progress=0,finished_at=datetime.utcnow().isoformat())
                await update_job(job_id,status)

    async def stop(self) -> None:
        """Checkpoint active transfers without treating a deploy as user cancellation."""
        self._stopping = True
        active=list(self.tasks.values())
        for task in active:
            task.cancel()
        if active:
            await asyncio.gather(*active,return_exceptions=True)
        self.tasks.clear()

    async def enqueue(self, *, url: str, file_id: str, user_id: int, folder_id: int, authenticated: bool=False, file_name: str|None=None, mime_type: str|None=None, send_to_telegram: bool=False, destination_ids: list[int]|None=None) -> str:
        await self.start()
        for existing_id,item in self.statuses.items():
            if item.get("user_id")==user_id and item.get("drive_file_id")==file_id and item.get("folder_id")==folder_id and item.get("state") not in {"done","error","cancelled"}:
                return existing_id
        job_id = uuid.uuid4().hex
        status = {"id":job_id,"source":"drive","url":url,"drive_file_id":file_id,"user_id":user_id,"folder_id":folder_id,"state":"queued","message":"در صف دریافت از گوگل درایو","progress":1,"created_at":datetime.utcnow().isoformat()}
        self.statuses[job_id] = status
        destination_ids=list(dict.fromkeys(destination_ids or []))
        await create_job(job_id=job_id,user_id=user_id,kind="drive",title=file_name or "Google Drive",payload={"id":job_id,"url":url,"file_id":file_id,"user_id":user_id,"folder_id":folder_id,"authenticated":authenticated,"file_name":file_name,"mime_type":mime_type,"send_to_telegram":send_to_telegram,"destination_ids":destination_ids},status=status)
        self.durable_job_ids.add(job_id)
        self.tasks[job_id] = asyncio.create_task(self._run(job_id, file_id, user_id, folder_id,authenticated,file_name,mime_type,send_to_telegram,destination_ids),name=f"drive-import-{job_id[:8]}")
        return job_id

    def list(self, user_id: int) -> list[dict]:
        cutoff=datetime.utcnow()-timedelta(seconds=45)
        expired=[]
        for job_id,item in self.statuses.items():
            if item.get("user_id")!=user_id or item.get("state") not in {"done","error","cancelled"}: continue
            finished_at=item.get("finished_at")
            try:
                if not finished_at or datetime.fromisoformat(finished_at)<cutoff: expired.append(job_id)
            except (TypeError,ValueError): expired.append(job_id)
        for job_id in expired:
            self.statuses.pop(job_id,None); self.cancelled.discard(job_id)
            try: asyncio.get_running_loop().create_task(delete_job(job_id,user_id))
            except RuntimeError: pass
        return [dict(item) for item in self.statuses.values() if item.get("user_id")==user_id]

    def status(self, job_id: str, user_id: int) -> dict | None:
        item = self.statuses.get(job_id)
        return dict(item) if item and item.get("user_id")==user_id else None

    def cancel(self, job_id: str, user_id: int) -> dict | None:
        item = self.statuses.get(job_id)
        if not item or item.get("user_id")!=user_id: return None
        self.cancelled.add(job_id)
        item.update(state="cancelled",message="لغو شد",progress=0,finished_at=datetime.utcnow().isoformat())
        return dict(item)

    async def cancel_all(self, user_id: int) -> int:
        ids=[key for key,item in self.statuses.items() if item.get("user_id")==user_id and item.get("state") not in {"done","error","cancelled"}]
        for key in ids:
            status=self.cancel(key,user_id)
            if status: await update_job(key,status)
        return len(ids)

    async def clear_finished(self, user_id: int) -> int:
        ids=[key for key,item in self.statuses.items() if item.get("user_id")==user_id and item.get("state") in {"done","error","cancelled"}]
        for key in ids: self.statuses.pop(key,None); self.cancelled.discard(key)
        await delete_finished_jobs("drive",user_id)
        return len(ids)

    async def retry(self,job_id:str,user_id:int) -> str|None:
        async with async_session() as db:
            record=await db.get(ProcessingJob,job_id)
            if record is None or record.user_id!=user_id or record.kind!="drive" or record.state not in {"error","cancelled"}:
                return None
            try:
                payload=json.loads(record.payload_json or "{}")
            except (TypeError,ValueError,json.JSONDecodeError):
                return None
        return await self.enqueue(
            url=str(payload.get("url") or f"drive://{payload.get('file_id','')}"),file_id=str(payload["file_id"]),
            user_id=user_id,folder_id=int(payload["folder_id"]),authenticated=bool(payload.get("authenticated",False)),
            file_name=payload.get("file_name"),mime_type=payload.get("mime_type"),send_to_telegram=bool(payload.get("send_to_telegram",False)),
            destination_ids=[int(value) for value in payload.get("destination_ids",[]) if str(value).isdigit()],
        )

    def _set(self, job_id: str, **changes) -> None:
        if job_id in self.statuses:
            self.statuses[job_id].update(changes)
            try:
                if job_id in self.durable_job_ids:
                    self._persist_dirty.add(job_id)
                    task=self._persist_tasks.get(job_id)
                    if task is None or task.done():
                        self._persist_tasks[job_id]=asyncio.get_running_loop().create_task(self._flush_status(job_id))
            except RuntimeError:
                # Progress callbacks can run inside asyncio.to_thread(). The
                # surrounding coroutine persists the next checkpoint.
                pass

    async def _flush_status(self,job_id:str) -> None:
        """Coalesce rapid progress changes and persist only ordered snapshots."""
        while job_id in self._persist_dirty:
            self._persist_dirty.discard(job_id)
            await asyncio.sleep(.05)
            status=self.statuses.get(job_id)
            if status is not None:
                await update_job(job_id,dict(status))

    def _download(self, job_id: str, file_id: str, target_dir: str, access_token: str|None=None, preferred_name: str|None=None, preferred_mime: str|None=None) -> tuple[str,str|None]:
        exports={"application/vnd.google-apps.document":("application/pdf",".pdf"),"application/vnd.google-apps.spreadsheet":("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",".xlsx"),"application/vnd.google-apps.presentation":("application/vnd.openxmlformats-officedocument.presentationml.presentation",".pptx"),"application/vnd.google-apps.drawing":("application/pdf",".pdf")}
        export=exports.get(preferred_mime or "")
        if access_token and export: url=f"https://www.googleapis.com/drive/v3/files/{file_id}/export?{urlencode({'mimeType':export[0]})}"
        else: url=f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media" if access_token else f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t"
        headers={"User-Agent":"Mozilla/5.0 Komod/1.0","Accept":"*/*"}
        if access_token: headers["Authorization"]=f"Bearer {access_token}"
        request=Request(url,headers=headers)
        with urlopen(request,timeout=90) as response:
            content_type=(response.headers.get_content_type() or "application/octet-stream").lower()
            total=int(response.headers.get("Content-Length") or 0)
            if total>MAX_DRIVE_FILE_SIZE: raise RuntimeError("حجم فایل برای انتقال مستقیم بیش از حد زیاد است.")
            filename=sanitize_filename(preferred_name)[:500] if preferred_name else _response_filename(response.headers,file_id)
            if export and not Path(filename).suffix: filename+=export[1]
            if not Path(filename).suffix:
                guessed_extension=mimetypes.guess_extension(content_type)
                if guessed_extension: filename=f"{filename}{guessed_extension}"
            target=str(Path(target_dir)/filename)
            received=0
            with open(target,"wb") as output:
                while chunk:=response.read(1024*1024):
                    if job_id in self.cancelled: raise asyncio.CancelledError()
                    output.write(chunk); received+=len(chunk)
                    if received>MAX_DRIVE_FILE_SIZE: raise RuntimeError("حجم فایل برای انتقال مستقیم بیش از حد زیاد است.")
                    progress=5+round(received/total*55) if total else min(55,5+received//(5*1024*1024))
                    self._set(job_id,state="downloading",message="در حال دریافت از گوگل درایو",progress=min(60,int(progress)))
            if received==0: raise RuntimeError("فایل دریافتی خالی بود.")
            if content_type.startswith("text/html"):
                Path(target).unlink(missing_ok=True)
                raise RuntimeError("فایل عمومی نیست. دسترسی را روی «هرکس لینک را دارد» بگذار.")
            return target, content_type

    async def _run(self, job_id: str, drive_file_id: str, user_id: int, folder_id: int, authenticated: bool=False, file_name: str|None=None, mime_type: str|None=None, send_to_telegram: bool=False, destination_ids: list[int]|None=None) -> None:
        if job_id in self.cancelled:
            return
        async with self._semaphore:
            if job_id in self.cancelled:
                return
            await self._execute(job_id,drive_file_id,user_id,folder_id,authenticated,file_name,mime_type,send_to_telegram,destination_ids)

    async def _execute(self, job_id: str, drive_file_id: str, user_id: int, folder_id: int, authenticated: bool=False, file_name: str|None=None, mime_type: str|None=None, send_to_telegram: bool=False, destination_ids: list[int]|None=None) -> None:
        sent=None; target_channel=None
        try:
            self._set(job_id,state="downloading",message="در حال اتصال به گوگل درایو",progress=3)
            with tempfile.TemporaryDirectory(prefix="komod-drive-") as temporary:
                token=None
                if authenticated:
                    from .google_drive import access_token
                    async with async_session() as token_db:
                        token_user=await token_db.get(User,user_id)
                        if token_user is None: raise RuntimeError("حساب کاربر پیدا نشد.")
                        token=await access_token(token_user,token_db)
                path,mime=await asyncio.to_thread(self._download,job_id,drive_file_id,temporary,token,file_name,mime_type)
                if job_id in self.cancelled: raise asyncio.CancelledError()
                filename=Path(path).name; file_size=Path(path).stat().st_size; file_type=_detect_type(filename,mime)
                digest=await asyncio.to_thread(_sha256,path)
                self._set(job_id,state="saving",message="در حال فرستادن به کمد",progress=68)
                async with async_session() as db:
                    user=await db.get(User,user_id)
                    if user is None: raise RuntimeError("حساب کاربر پیدا نشد.")
                    duplicate=(await db.execute(select(File).where(File.user_id==user_id,File.content_hash==digest).order_by(File.id))).scalars().first()
                    template_row=await db.get(AppSetting,"caption_template_drive")
                    description=render_link_caption(template_row.value if template_row else "☁️ [عنوان]",title=Path(filename).stem,platform="گوگل درایو",media_type=file_type) or "☁️ افزوده‌شده از گوگل درایو"
                    if duplicate is not None:
                        stored=File(user_id=user_id,folder_id=folder_id,file_id=duplicate.file_id,file_unique_id=duplicate.file_unique_id,channel_message_id=duplicate.channel_message_id,storage_channel_id=duplicate.storage_channel_id,file_name=filename,description=description,search_text=duplicate.search_text,content_hash=digest,is_shortcut=True,file_size=duplicate.file_size,mime_type=duplicate.mime_type,file_type=duplicate.file_type,duration=duplicate.duration,width=duplicate.width,height=duplicate.height,thumbnail_file_id=duplicate.thumbnail_file_id,audio_variant_file_id=duplicate.audio_variant_file_id,audio_variant_unique_id=duplicate.audio_variant_unique_id,audio_variant_message_id=duplicate.audio_variant_message_id,audio_variant_storage_channel_id=duplicate.audio_variant_storage_channel_id,audio_variant_size=duplicate.audio_variant_size,compatible_video_file_id=duplicate.compatible_video_file_id,compatible_video_unique_id=duplicate.compatible_video_unique_id,compatible_video_message_id=duplicate.compatible_video_message_id,compatible_video_storage_channel_id=duplicate.compatible_video_storage_channel_id,compatible_video_size=duplicate.compatible_video_size)
                    else:
                        target_channel=user.storage_channel_id or settings.telegram_storage_channel_id
                        common={"chat_id":target_channel,"caption":description,"parse_mode":None}
                        try:
                            if file_type=="video": sent=await telegram.tg_client.send_video(video=path,supports_streaming=True,**common)
                            elif file_type=="audio": sent=await telegram.tg_client.send_audio(audio=path,**common)
                            else: sent=await telegram.tg_client.send_document(document=path,**common)
                        except Exception:
                            logger.warning("Typed Drive upload failed; retrying as document",exc_info=True)
                            sent=await telegram.tg_client.send_document(document=path,**common)
                        media=sent.video or sent.audio or sent.document
                        if media is None: raise RuntimeError("ذخیره فایل در کمد کامل نشد.")
                        thumb=select_best_thumbnail(getattr(media,"thumbs",None))
                        search_text=Path(path).read_text("utf-8",errors="replace") if file_type=="text" and file_size<=1024*1024 else None
                        stored=File(user_id=user_id,folder_id=folder_id,file_id=media.file_id,file_unique_id=media.file_unique_id,channel_message_id=sent.id,storage_channel_id=target_channel,file_name=filename,description=description,search_text=search_text,content_hash=digest,file_size=media.file_size or file_size,mime_type=getattr(media,"mime_type",None) or mime,file_type=file_type,duration=getattr(media,"duration",None),width=getattr(media,"width",None),height=getattr(media,"height",None),thumbnail_file_id=thumb.file_id if thumb else None)
                    db.add(stored); await db.commit(); await db.refresh(stored)
                    # The library copy is durable from this point onward. An
                    # optional delivery failure must never delete that source.
                    sent=None
                    delivery_failures=0
                    if send_to_telegram:
                        chat_ids:list[int]=[]
                        if destination_ids:
                            destinations=(await db.execute(select(TelegramDestination).where(TelegramDestination.id.in_(destination_ids),TelegramDestination.user_id==user_id,TelegramDestination.enabled.is_(True)))).scalars().all()
                            chat_ids=[item.chat_id for item in destinations]
                        else:
                            default_destination=(await db.execute(select(TelegramDestination).where(TelegramDestination.user_id==user_id,TelegramDestination.enabled.is_(True),TelegramDestination.is_default.is_(True)))).scalars().first()
                            chat_ids=[default_destination.chat_id] if default_destination else [user.telegram_id]
                        if not chat_ids:
                            chat_ids=[user.telegram_id]
                        self._set(job_id,state="saving",message="در حال ارسال به تلگرام",progress=92)
                        for chat_id in dict.fromkeys(chat_ids):
                            try:
                                await telegram.copy_message_balanced(chat_id=chat_id,from_chat_id=stored.storage_channel_id,message_id=stored.channel_message_id,caption=stored.description or "")
                            except Exception:
                                delivery_failures+=1
                                logger.warning("Could not deliver Drive import %s to %s",stored.id,chat_id,exc_info=True)
                    message=f"{filename} به کمد اضافه شد"
                    if send_to_telegram:
                        message += " و در تلگرام فرستاده شد" if not delivery_failures else f"؛ ارسال به {delivery_failures} مقصد انجام نشد"
                    self._set(job_id,state="done",message=message,progress=100,file_id=stored.id,delivery_failures=delivery_failures,finished_at=datetime.utcnow().isoformat())
        except asyncio.CancelledError:
            if self._stopping and job_id not in self.cancelled:
                self._set(job_id,state="queued",message="پس از راه‌اندازی دوباره ادامه پیدا می‌کند",progress=0,finished_at=None)
            else:
                self._set(job_id,state="cancelled",message="انتقال لغو شد",progress=0,finished_at=datetime.utcnow().isoformat())
        except Exception as error:
            logger.exception("Google Drive import failed")
            if sent is not None:
                try: await telegram.tg_client.delete_messages(target_channel,sent.id)
                except Exception: pass
            self._set(job_id,state="error",message=str(error) or "انتقال از گوگل درایو انجام نشد.",progress=0,finished_at=datetime.utcnow().isoformat())
        finally:
            await update_job(job_id,self.statuses.get(job_id,{})); self.tasks.pop(job_id,None)


drive_importer=GoogleDriveImporter()
