"""
File management API endpoints.
"""
from typing import Optional
import asyncio
import hashlib
from difflib import SequenceMatcher
import json
import re
from fastapi import APIRouter, Depends, File as FormFile, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import RedirectResponse
import secrets
import logging
import os
import shutil
import tempfile
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, asc, desc, exists, false, and_, or_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel, Field
from datetime import datetime, timedelta
from passlib.context import CryptContext
from slowapi import Limiter
from slowapi.util import get_remote_address
from urllib.parse import urlparse

from ..database import get_db
from ..models import File, User, WatchProgress, Folder, Playlist, Pack, PackItem
from ..schemas import ActivityResponse, BatchFileUpdate, FileResponse, FileListResponse, FileUpdate, PlayerStateResponse, PlayerStateUpdate, PublicShareCreate, WatchProgressUpdate
from ..auth import get_current_user, has_vault_access, require_scoped_folder, require_vault_access, workspace_scope
from ..telegram import delete_from_storage_channel, get_message_from_channel
from .. import telegram
from ..config import get_settings
from ..media_metadata import extract_embedded_cover
from ..downloader import ImportJob, link_importer
from ..drive_importer import drive_importer, extract_google_drive_file_id
from ..google_drive import authorization_url, decode_state, exchange_code, account_email, access_token as google_access_token, list_files as google_list_files, configured as google_drive_configured, full_configured as google_drive_full_configured, picker_configured as google_picker_configured, picker_bootstrap, active_credentials, account_key, credential_accounts, encrypt_account_store
from ..processing_jobs import update_job
from .folders import ensure_default_folder
from ..services import (
    escape_like, 
    sanitize_filename, 
    add_urls_to_file, 
    fetch_recent_files, 
    fetch_continue_watching_files,
    select_best_thumbnail,
    unreferenced_storage_messages,
    unreferenced_audio_variant_messages,
    telegram_text_with_links,
)
from ..audit import add_security_event
from ..ai_metadata import build_metadata_source, metadata_instruction, parse_metadata_suggestion
from ..ai_search import build_search_expansion_instruction, parse_search_expansion
from ..gemini_keys import decrypt_user_keys
from ..stt import GeminiSTTProvider, stt_queue
from ..tts import load_tts_settings

router = APIRouter(prefix="/files", tags=["Files"])
settings = get_settings()
logger = logging.getLogger(__name__)
limiter = Limiter(key_func=get_remote_address)
share_password_context = CryptContext(schemes=["pbkdf2_sha256"], pbkdf2_sha256__default_rounds=310_000, deprecated="auto")
_text_index_locks: dict[int, asyncio.Lock] = {}
_smart_search_cache: dict[tuple[int, str, str, str], tuple[datetime, dict[str, object]]] = {}


class TextContentUpdate(BaseModel):
    content: str = Field(min_length=1, max_length=1_000_000)


class SmartSearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=300)


@router.post("/search/expand")
@limiter.limit("12/minute")
async def expand_smart_search(
    payload: SmartSearchRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Expand one explicit query without exposing library contents to Gemini."""
    personal_keys = decrypt_user_keys(current_user.gemini_api_keys_encrypted)
    keys = list(dict.fromkeys(personal_keys + stt_queue.provider.api_keys))
    if not keys:
        raise HTTPException(status_code=503, detail="برای جست‌وجوی هوشمند، کلید Gemini تنظیم نشده است.")
    try:
        stored_tags = json.loads(current_user.tag_settings_json or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        stored_tags = []
    known_tags = [str(item.get("name") or "").strip() for item in stored_tags if isinstance(item, dict) and item.get("name")]
    preferences = load_tts_settings(current_user)
    normalized_query = re.sub(r"\s+", " ", payload.query).strip()
    tag_fingerprint = hashlib.sha256("\0".join(known_tags).encode("utf-8")).hexdigest()[:12]
    cache_key = (current_user.id, preferences["text_model"], normalized_query.casefold(), tag_fingerprint)
    cached = _smart_search_cache.get(cache_key)
    if cached and cached[0] > datetime.utcnow():
        return cached[1]
    provider = GeminiSTTProvider(keys, text_model=preferences["text_model"])
    try:
        raw = await provider.refine_text(normalized_query, build_search_expansion_instruction(known_tags))
        result = parse_search_expansion(raw, normalized_query)
        if len(_smart_search_cache) >= 500:
            now = datetime.utcnow()
            for key, (expires_at, _) in list(_smart_search_cache.items()):
                if expires_at <= now:
                    _smart_search_cache.pop(key, None)
            if len(_smart_search_cache) >= 500:
                _smart_search_cache.pop(next(iter(_smart_search_cache)))
        _smart_search_cache[cache_key] = (datetime.utcnow() + timedelta(minutes=20), result)
        return result
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@router.post("/{file_id}/ai-metadata")
async def suggest_file_metadata(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    file = (await db.execute(select(File).where(File.id == file_id, File.user_id == current_user.id))).scalar_one_or_none()
    if file is None:
        raise HTTPException(status_code=404, detail="فایل پیدا نشد.")
    if file.is_hidden and not has_vault_access(request, current_user):
        require_vault_access(request, current_user)
    personal_keys = decrypt_user_keys(current_user.gemini_api_keys_encrypted)
    keys = list(dict.fromkeys(personal_keys + stt_queue.provider.api_keys))
    if not keys:
        raise HTTPException(status_code=503, detail="برای پیشنهاد هوشمند، کلید Gemini تنظیم نشده است.")
    try:
        stored_tags = json.loads(current_user.tag_settings_json or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        stored_tags = []
    known_tags = [str(item.get("name") or "").strip() for item in stored_tags if isinstance(item, dict) and item.get("name")]
    try:
        excluded_tags = [str(item) for item in json.loads(current_user.tag_exclusions_json or "[]")]
    except (TypeError, ValueError, json.JSONDecodeError):
        excluded_tags = []
    preferences = load_tts_settings(current_user)
    provider = GeminiSTTProvider(keys, text_model=preferences["text_model"])
    try:
        raw = await provider.refine_text(build_metadata_source(file), metadata_instruction(known_tags, excluded_tags))
        return parse_metadata_suggestion(raw, file.file_name, excluded_tags)
    except (RuntimeError, ValueError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


class LinkImportRequest(BaseModel):
    url: str = Field(min_length=8, max_length=2048)
    folder_id: Optional[int] = None
    new_folder_name: Optional[str] = Field(default=None, max_length=255)
    quality: Optional[str] = Field(default="480", pattern="^(auto|audio|480|720|1080)$")


class DriveImportRequest(BaseModel):
    url: str = Field(min_length=20, max_length=2048)
    folder_id: Optional[int] = None

class DriveSelectionImportRequest(BaseModel):
    file_ids: list[str] = Field(min_length=1,max_length=50)
    file_names: dict[str,str] = Field(default_factory=dict)
    mime_types: dict[str,str] = Field(default_factory=dict)
    folder_id: Optional[int] = None

class DriveAccountRequest(BaseModel):
    email: str = Field(min_length=3,max_length=255)
    mode: Optional[str] = None


class SendToTelegramRequest(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=50)


class OfflineManifestUpdate(BaseModel):
    file_ids: list[int] = Field(default_factory=list, max_length=1000)


class OfflineManifestResponse(BaseModel):
    file_ids: list[int] = Field(default_factory=list)
    files: list[FileResponse] = Field(default_factory=list)
    updated_at: Optional[datetime] = None


FILE_SORT_FIELDS = {
    "name": func.lower(File.file_name),
    "type": File.file_type,
    "size": File.file_size,
    "duration": File.duration,
    "created": File.created_at,
    "updated": File.updated_at,
}


def detect_upload_type(filename: str, mime_type: str | None) -> str:
    mime = (mime_type or "").lower()
    extension = Path(filename).suffix.lower()
    if mime.startswith("text/") or extension in {".txt", ".md", ".log", ".csv", ".json", ".xml", ".yaml", ".yml"}:
        return "text"
    if mime.startswith("video/") or extension in {".mp4", ".mkv", ".mov", ".webm", ".avi"}:
        return "video"
    if mime.startswith("audio/") or extension in {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac", ".opus"}:
        return "audio"
    if mime.startswith("image/") or extension in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}:
        return "image"
    return "document"


def decode_searchable_text(raw: bytes) -> str | None:
    """Decode supported small text files for private full-content search."""
    if not raw or len(raw) > 1024 * 1024:
        return None


def normalize_fuzzy_text(value: str) -> str:
    """Normalize common Persian/Arabic variants before typo comparison."""
    value = (value or "").casefold().replace("ي", "ی").replace("ك", "ک")
    value = value.replace("ة", "ه").replace("ۀ", "ه").replace("ؤ", "و")
    value = re.sub(r"[\u064b-\u065f\u0670\u200c\u200d]", "", value)
    value = re.sub(r"[^0-9a-zآ-ی]+", " ", value)
    return " ".join(value.split())


def fuzzy_text_score(needle: str, value: str) -> float:
    """Return the best bounded similarity against words and short phrases."""
    sampled = value if len(value) <= 20_000 else f"{value[:10_000]} {value[-10_000:]}"
    normalized = normalize_fuzzy_text(sampled)
    if not needle or not normalized:
        return 0.0
    if needle in normalized:
        return 1.0
    needle_words = needle.split()
    words = normalized.split()[:600]
    if not words:
        return 0.0
    if len(needle_words) == 1:
        target = needle_words[0]
        target_chars = set(target)
        compatible = [word for word in words if abs(len(word) - len(target)) <= max(2, len(target) // 3)]
        likely = sorted(
            compatible,
            key=lambda word: len(target_chars & set(word)) / max(1, len(target_chars | set(word))),
            reverse=True,
        )[:24]
        return max((SequenceMatcher(None, target, word).ratio() for word in likely), default=0.0)
    best = 0.0
    width = len(needle_words)
    needle_chars = set(needle)
    for size in {max(1, width - 1), width, width + 1}:
        phrases = (" ".join(words[index:index + size]) for index in range(0, max(0, len(words) - size + 1)))
        likely = sorted(
            phrases,
            key=lambda phrase: len(needle_chars & set(phrase)) / max(1, len(needle_chars | set(phrase))),
            reverse=True,
        )[:24]
        for phrase in likely:
            best = max(best, SequenceMatcher(None, needle, phrase).ratio())
            if best >= 0.94:
                return best
    return best


def fuzzy_file_score(file: File, search: str) -> float:
    """Rank one file without exposing its indexed note content."""
    needle = normalize_fuzzy_text(search)
    if len(needle) < 3:
        return 0.0
    try:
        tags = " ".join(str(item) for item in json.loads(file.tags_json or "[]"))
    except (TypeError, ValueError, json.JSONDecodeError):
        tags = ""
    title = str(Path(file.file_name).stem)
    return max(
        fuzzy_text_score(needle, title),
        fuzzy_text_score(needle, tags),
        fuzzy_text_score(needle, file.description or ""),
        fuzzy_text_score(needle, file.search_text or ""),
    )
    encoding = "utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
    try:
        return raw.decode(encoding)[:1_000_000]
    except UnicodeDecodeError:
        return None


async def index_missing_text_notes(db: AsyncSession, user_id: int) -> int:
    """Lazily index legacy notes once, keeping app startup fast."""
    lock = _text_index_locks.setdefault(user_id, asyncio.Lock())
    async with lock:
        notes = (await db.execute(select(File).where(
            File.user_id == user_id, File.file_type == "text", File.search_text.is_(None)
        ).order_by(File.id))).scalars().all()
        indexed = 0
        for note in notes:
            try:
                message = await get_message_from_channel(note.channel_message_id, note.storage_channel_id)
                if message is None:
                    continue
                document = getattr(message, "document", None)
                if document is None:
                    content = getattr(message, "text", None) or note.description or ""
                elif (note.file_size or 0) <= 1024 * 1024:
                    contents = await telegram.tg_client.download_media(message, in_memory=True)
                    content = decode_searchable_text(contents.getvalue()) if contents is not None else None
                else:
                    content = ""
                if content is not None:
                    note.search_text = content
                    indexed += 1
            except Exception:
                logger.warning("Could not index legacy text note %s", note.id, exc_info=True)
        if indexed:
            await db.commit()
        return indexed


@router.post("/import-link", status_code=202)
async def import_link(
    payload: LinkImportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    host = (urlparse(payload.url.strip()).hostname or "").lower()
    if not any(host == domain or host.endswith(f".{domain}") for domain in ("youtube.com", "youtu.be", "instagram.com")):
        raise HTTPException(status_code=400, detail="فعلاً فقط لینک یوتیوب و اینستاگرام پشتیبانی می‌شود.")
    if not link_importer.available:
        raise HTTPException(status_code=503, detail="دانلود از لینک هنوز روی سرور تنظیم نشده است.")
    folder_id = payload.folder_id
    scoped_new_folder = bool(payload.new_folder_name and payload.new_folder_name.strip())
    if scoped_new_folder:
        require_scoped_folder(request, payload.folder_id)
    if payload.new_folder_name and payload.new_folder_name.strip():
        name = payload.new_folder_name.strip()
        folder = Folder(user_id=current_user.id, parent_id=payload.folder_id, name=name)
        db.add(folder)
        await db.commit()
        await db.refresh(folder)
        folder_id = folder.id
    elif folder_id is not None:
        folder = (await db.execute(select(Folder).where(Folder.id == folder_id, Folder.user_id == current_user.id))).scalar_one_or_none()
        if folder is None:
            raise HTTPException(status_code=404, detail="کشوی مقصد پیدا نشد.")
    else:
        folder_id = (await ensure_default_folder(db, current_user.id)).id
        await db.commit()
    if not scoped_new_folder:
        require_scoped_folder(request, folder_id)
    quality = "auto" if host == "instagram.com" or host.endswith(".instagram.com") else (payload.quality or "480")
    job = ImportJob(url=payload.url.strip(), user_id=current_user.id, telegram_id=current_user.telegram_id, folder_id=folder_id, quality=quality, notify=True)
    position = await link_importer.enqueue(job)
    return {"message": "لینک رفت توی صف؛ وضعیتش همین‌جا هم به‌روز می‌شه.", "queue_position": position, "job_id": job.id}


@router.get("/import-link/status/{job_id}")
async def import_link_status(job_id: str, current_user: User = Depends(get_current_user)):
    status = link_importer.status(job_id, current_user.id)
    if status is None:
        raise HTTPException(status_code=404, detail="وضعیت این لینک پیدا نشد.")
    return status


@router.get("/import-link/status")
async def import_link_queue(current_user: User = Depends(get_current_user)):
    return link_importer.list_statuses(current_user.id)


@router.post("/import-link/status/{job_id}/pause")
async def toggle_import_link_pause(job_id: str, current_user: User = Depends(get_current_user)):
    status = link_importer.toggle_pause(job_id, current_user.id)
    if status is None:
        raise HTTPException(status_code=404, detail="وضعیت این لینک پیدا نشد.")
    return status


@router.post("/import-link/status/{job_id}/cancel")
async def cancel_import_link(job_id: str, current_user: User = Depends(get_current_user)):
    status = link_importer.cancel(job_id, current_user.id)
    if status is None:
        raise HTTPException(status_code=404, detail="وضعیت این لینک پیدا نشد.")
    return status


@router.post("/import-link/status/{job_id}/retry", status_code=202)
async def retry_import_link(job_id: str, current_user: User = Depends(get_current_user)):
    previous = link_importer.status(job_id, current_user.id)
    if previous is None:
        raise HTTPException(status_code=404, detail="وضعیت این لینک پیدا نشد.")
    if previous.get("state") not in {"error", "cancelled"}:
        raise HTTPException(status_code=409, detail="این مورد هنوز در حال پردازش است.")
    job = ImportJob(
        url=str(previous.get("url") or ""), user_id=current_user.id,
        telegram_id=current_user.telegram_id, folder_id=previous.get("folder_id"),
        quality=str(previous.get("quality") or "480"), notify=True,
        retry_count=int(previous.get("retry_count") or 0) + 1,
    )
    position = await link_importer.enqueue(job)
    return {"message": "دوباره به صف اضافه شد.", "queue_position": position, "job_id": job.id, "status": link_importer.status(job.id, current_user.id)}


@router.delete("/import-link/status")
async def clear_finished_import_links(current_user: User = Depends(get_current_user)):
    removed = link_importer.clear_finished(current_user.id)
    return {"removed": removed}


@router.post("/import-drive", status_code=202)
async def import_from_google_drive(
    payload: DriveImportRequest, request: Request, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    drive_file_id=extract_google_drive_file_id(payload.url)
    if not drive_file_id:
        raise HTTPException(status_code=400,detail="لینک فایل گوگل درایو معتبر نیست.")
    folder_id=payload.folder_id
    if folder_id is None:
        folder_id=(await ensure_default_folder(db,current_user.id)).id
        await db.commit()
    else:
        folder=(await db.execute(select(Folder).where(Folder.id==folder_id,Folder.user_id==current_user.id))).scalar_one_or_none()
        if folder is None: raise HTTPException(status_code=404,detail="کشوی مقصد پیدا نشد.")
    require_scoped_folder(request,folder_id)
    job_id=await drive_importer.enqueue(url=payload.url.strip(),file_id=drive_file_id,user_id=current_user.id,folder_id=folder_id)
    return {"job_id":job_id,"message":"انتقال از گوگل درایو شروع شد."}

@router.get("/drive/status")
async def google_drive_status(current_user:User=Depends(get_current_user)):
    accounts,active=credential_accounts(current_user.google_drive_credentials_encrypted,current_user.google_drive_email)
    active_account=next((item for item in accounts if account_key(item)==active),None)
    return {"configured":google_drive_configured(),"full_configured":google_drive_full_configured(),"picker_configured":google_picker_configured(),"connected":bool(accounts),"email":(active_account or {}).get("email"),"mode":(active_account or {}).get("mode") if active_account else None,"accounts":[{"email":item.get("email"),"mode":item.get("mode","full")} for item in accounts]}

@router.get("/drive/connect")
async def connect_google_drive(mode:str="picker",current_user:User=Depends(get_current_user)):
    if mode not in {"full","picker"}: raise HTTPException(status_code=400,detail="نوع اتصال گوگل معتبر نیست.")
    try: return {"url":authorization_url(current_user.id,mode)}
    except ValueError as error: raise HTTPException(status_code=503,detail=str(error))

@router.get("/drive/oauth/callback")
async def google_drive_callback(code:str,state:str,db:AsyncSession=Depends(get_db)):
    try:
        (user_id,mode)=decode_state(state); token=await exchange_code(code,mode)
        user=await db.get(User,user_id)
        if user is None: raise ValueError("user")
        email=await account_email(token["access_token"])
        if not email: raise ValueError("email")
        accounts,_=credential_accounts(user.google_drive_credentials_encrypted,user.google_drive_email)
        previous=next((item for item in accounts if item.get("email")==email and item.get("mode","full")==mode),{})
        if previous.get("mode","full")==mode and previous.get("refresh_token") and not token.get("refresh_token"): token["refresh_token"]=previous["refresh_token"]
        import time
        token["expires_at"]=time.time()+int(token.get("expires_in",3600))
        token["email"]=email
        token["mode"]=mode
        accounts=[item for item in accounts if not (item.get("email")==email and item.get("mode","full")==mode)]+[token]
        user.google_drive_credentials_encrypted=encrypt_account_store(accounts,account_key(token))
        user.google_drive_email=email
        await db.commit()
        return RedirectResponse(f"{settings.web_base_url.rstrip('/')}?drive=connected")
    except Exception:
        logger.exception("Google Drive OAuth callback failed")
        return RedirectResponse(f"{settings.web_base_url.rstrip('/')}?drive=error")

@router.post("/drive/switch")
async def switch_google_drive(payload:DriveAccountRequest,current_user:User=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    accounts,_=credential_accounts(current_user.google_drive_credentials_encrypted,current_user.google_drive_email)
    target=next((item for item in accounts if item.get("email")==payload.email and (not payload.mode or item.get("mode","full")==payload.mode)),None)
    if not target: raise HTTPException(status_code=404,detail="این اتصال گوگل پیدا نشد.")
    current_user.google_drive_credentials_encrypted=encrypt_account_store(accounts,account_key(target));current_user.google_drive_email=target.get("email");await db.commit()
    return {"ok":True,"email":target.get("email"),"mode":target.get("mode","full")}

@router.delete("/drive/disconnect")
async def disconnect_google_drive(email:Optional[str]=None,mode:Optional[str]=None,current_user:User=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    accounts,active=credential_accounts(current_user.google_drive_credentials_encrypted,current_user.google_drive_email)
    target=next((item for item in accounts if account_key(item)==active),None) if not email else next((item for item in accounts if item.get("email")==email and (not mode or item.get("mode","full")==mode)),None)
    if target: accounts=[item for item in accounts if account_key(item)!=account_key(target)]
    next_key=active if any(account_key(item)==active for item in accounts) else (account_key(accounts[0]) if accounts else None)
    next_account=next((item for item in accounts if account_key(item)==next_key),None)
    current_user.google_drive_credentials_encrypted=encrypt_account_store(accounts,next_key);current_user.google_drive_email=(next_account or {}).get("email");await db.commit()
    return {"ok":True,"email":(next_account or {}).get("email"),"mode":(next_account or {}).get("mode")}

@router.get("/drive/browse")
async def browse_google_drive(folder_id:str="root",q:str="",current_user:User=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    try:
        _,credentials=active_credentials(current_user)
        if credentials and credentials.get("mode","full")!="full": raise ValueError("برای مرور همه پوشه‌ها، اتصال کامل آزمایشی را انتخاب کن.")
        token=await google_access_token(current_user,db); return await google_list_files(token,folder_id,q)
    except ValueError as error: raise HTTPException(status_code=401,detail=str(error))

@router.get("/drive/picker-config")
async def google_drive_picker_config(current_user:User=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    if not google_picker_configured(): raise HTTPException(status_code=503,detail="انتخاب‌گر عمومی گوگل هنوز روی سرور تنظیم نشده است.")
    try: return await picker_bootstrap(current_user,db)
    except ValueError as error: raise HTTPException(status_code=401,detail=str(error))

@router.post("/drive/import-selected",status_code=202)
async def import_selected_google_drive(payload:DriveSelectionImportRequest,request:Request,current_user:User=Depends(get_current_user),db:AsyncSession=Depends(get_db)):
    folder_id=payload.folder_id
    if folder_id is None: folder_id=(await ensure_default_folder(db,current_user.id)).id; await db.commit()
    else:
        folder=(await db.execute(select(Folder).where(Folder.id==folder_id,Folder.user_id==current_user.id))).scalar_one_or_none()
        if folder is None: raise HTTPException(status_code=404,detail="کشوی مقصد پیدا نشد.")
    require_scoped_folder(request,folder_id)
    if not current_user.google_drive_credentials_encrypted: raise HTTPException(status_code=401,detail="اول حساب گوگل را متصل کن.")
    jobs=[]
    for file_id in payload.file_ids:
        if not re.fullmatch(r"[A-Za-z0-9_-]{10,}",file_id): continue
        jobs.append(await drive_importer.enqueue(url=f"drive://{file_id}",file_id=file_id,user_id=current_user.id,folder_id=folder_id,authenticated=True,file_name=payload.file_names.get(file_id),mime_type=payload.mime_types.get(file_id)))
    if not jobs: raise HTTPException(status_code=400,detail="فایل معتبری انتخاب نشده است.")
    return {"job_ids":jobs,"message":f"{len(jobs)} فایل به صف انتقال اضافه شد."}


@router.get("/import-drive/status")
async def google_drive_import_queue(current_user: User = Depends(get_current_user)):
    return drive_importer.list(current_user.id)


@router.get("/import-drive/status/{job_id}")
async def google_drive_import_status(job_id: str,current_user: User = Depends(get_current_user)):
    status=drive_importer.status(job_id,current_user.id)
    if status is None: raise HTTPException(status_code=404,detail="وضعیت این انتقال پیدا نشد.")
    return status


@router.post("/import-drive/status/{job_id}/cancel")
async def cancel_google_drive_import(job_id: str,current_user: User = Depends(get_current_user)):
    status=drive_importer.cancel(job_id,current_user.id)
    if status is None: raise HTTPException(status_code=404,detail="وضعیت این انتقال پیدا نشد.")
    await update_job(job_id,status)
    return status


@router.delete("/import-drive/status")
async def clear_finished_google_drive_imports(current_user: User = Depends(get_current_user)):
    return {"removed":await drive_importer.clear_finished(current_user.id)}


@router.get("/offline-manifest", response_model=OfflineManifestResponse)
async def get_offline_manifest(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the media the user selected for optional cross-device offline sync."""
    try:
        state = json.loads(current_user.offline_manifest_json or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        state = {}
    ids = list(dict.fromkeys(int(value) for value in state.get("file_ids", [])[:1000] if str(value).isdigit()))
    files = (await db.execute(select(File).where(
        File.user_id == current_user.id,
        File.id.in_(ids),
        File.is_hidden.is_(False),
    ).options(selectinload(File.watch_progress)))).scalars().all() if ids else []
    by_id = {item.id: item for item in files}
    ordered = [by_id[file_id] for file_id in ids if file_id in by_id]
    return OfflineManifestResponse(
        file_ids=[item.id for item in ordered],
        files=[FileResponse(**add_urls_to_file(item)) for item in ordered],
        updated_at=state.get("updated_at"),
    )


@router.put("/offline-manifest", response_model=OfflineManifestResponse)
async def save_offline_manifest(
    payload: OfflineManifestUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ids = list(dict.fromkeys(payload.file_ids))
    files = (await db.execute(select(File).where(
        File.user_id == current_user.id,
        File.id.in_(ids),
        File.is_hidden.is_(False),
    ).options(selectinload(File.watch_progress)))).scalars().all() if ids else []
    by_id = {item.id: item for item in files}
    ordered = [by_id[file_id] for file_id in ids if file_id in by_id]
    now = datetime.utcnow()
    current_user.offline_manifest_json = json.dumps({"file_ids": [item.id for item in ordered], "updated_at": now.isoformat()})
    await db.commit()
    return OfflineManifestResponse(
        file_ids=[item.id for item in ordered],
        files=[FileResponse(**add_urls_to_file(item)) for item in ordered],
        updated_at=now,
    )


@router.get("/player-state", response_model=PlayerStateResponse)
async def get_player_state(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Restore the latest queue and position on another signed-in device."""
    try:
        state = json.loads(current_user.player_state_json or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        state = {}
    ids = [int(value) for value in state.get("file_ids", [])[:250] if str(value).isdigit()]
    files = (await db.execute(select(File).where(
        File.user_id == current_user.id, File.id.in_(ids),
        File.file_type.in_(("audio", "video")), File.is_hidden.is_(False),
    ).options(selectinload(File.watch_progress)))).scalars().all() if ids else []
    by_id = {item.id: item for item in files}
    ordered = [by_id[file_id] for file_id in ids if file_id in by_id]
    index = min(max(int(state.get("current_index", -1)), -1), len(ordered) - 1)
    return PlayerStateResponse(
        files=[FileResponse(**add_urls_to_file(item)) for item in ordered],
        current_index=index,
        repeat_mode=state.get("repeat_mode") if state.get("repeat_mode") in {"off", "all", "one"} else "off",
        position=max(0, int(state.get("position", 0) or 0)),
        updated_at=state.get("updated_at"),
    )


@router.put("/player-state", response_model=PlayerStateResponse)
async def save_player_state(
    payload: PlayerStateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    unique_ids = list(dict.fromkeys(payload.file_ids))
    files = (await db.execute(select(File).where(
        File.user_id == current_user.id, File.id.in_(unique_ids),
        File.file_type.in_(("audio", "video")), File.is_hidden.is_(False),
    ).options(selectinload(File.watch_progress)))).scalars().all() if unique_ids else []
    by_id = {item.id: item for item in files}
    ordered = [by_id[file_id] for file_id in unique_ids if file_id in by_id]
    index = min(max(payload.current_index, -1), len(ordered) - 1)
    now = datetime.utcnow()
    current_user.player_state_json = json.dumps({
        "file_ids": [item.id for item in ordered], "current_index": index,
        "repeat_mode": payload.repeat_mode, "position": payload.position,
        "updated_at": now.isoformat(),
    })
    await db.commit()
    return PlayerStateResponse(
        files=[FileResponse(**add_urls_to_file(item)) for item in ordered],
        current_index=index, repeat_mode=payload.repeat_mode,
        position=payload.position, updated_at=now,
    )


@router.get("/play-history", response_model=FileListResponse)
async def playback_history(
    page: int = Query(1, ge=1), per_page: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    base = select(File).join(WatchProgress, WatchProgress.file_id == File.id).where(
        WatchProgress.user_id == current_user.id, File.user_id == current_user.id,
        File.file_type.in_(("audio", "video")), File.is_hidden.is_(False),
    )
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()
    files = (await db.execute(base.options(selectinload(File.watch_progress)).order_by(
        WatchProgress.updated_at.desc()
    ).offset((page - 1) * per_page).limit(per_page))).scalars().unique().all()
    return FileListResponse(
        files=[FileResponse(**add_urls_to_file(item)) for item in files],
        total=total, page=page, per_page=per_page,
    )


@router.get("/recommendations", response_model=list[FileResponse])
async def playback_recommendations(
    after_file_id: Optional[int] = Query(None), limit: int = Query(12, ge=1, le=30),
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    """Suggest media using the current file, tags, folders and recent playback."""
    current = await db.get(File, after_file_id) if after_file_id else None
    if current is not None and current.user_id != current_user.id:
        current = None
    recent = (await db.execute(select(File).join(WatchProgress, WatchProgress.file_id == File.id).where(
        File.user_id == current_user.id, WatchProgress.user_id == current_user.id,
    ).order_by(WatchProgress.updated_at.desc()).limit(40))).scalars().all()
    folder_affinity: dict[int | None, int] = {}
    tag_affinity: dict[str, int] = {}
    for rank, item in enumerate(recent):
        weight = max(1, 10 - rank // 4)
        folder_affinity[item.folder_id] = folder_affinity.get(item.folder_id, 0) + weight
        try:
            tags = json.loads(item.tags_json or "[]")
        except (TypeError, ValueError, json.JSONDecodeError):
            tags = []
        for tag in tags:
            tag_affinity[str(tag).casefold()] = tag_affinity.get(str(tag).casefold(), 0) + weight
    candidates = (await db.execute(select(File).where(
        File.user_id == current_user.id, File.file_type.in_(("audio", "video")),
        File.is_hidden.is_(False), File.id != (after_file_id or -1),
    ).options(selectinload(File.watch_progress)).order_by(File.created_at.desc()).limit(500))).scalars().all()
    current_tags: set[str] = set()
    if current:
        try: current_tags = {str(tag).casefold() for tag in json.loads(current.tags_json or "[]")}
        except (TypeError, ValueError, json.JSONDecodeError): pass
    def score(item: File) -> tuple[float, int]:
        try: tags = {str(tag).casefold() for tag in json.loads(item.tags_json or "[]")}
        except (TypeError, ValueError, json.JSONDecodeError): tags = set()
        value = float(folder_affinity.get(item.folder_id, 0))
        value += sum(tag_affinity.get(tag, 0) for tag in tags)
        if current:
            value += 30 if item.folder_id == current.folder_id else 0
            value += 18 * len(tags & current_tags)
            value += 8 if item.file_type == current.file_type else 0
        value += 3 if item.is_favorite else 0
        return value, item.id
    selected = sorted(candidates, key=score, reverse=True)[:limit]
    return [FileResponse(**add_urls_to_file(item)) for item in selected]


@router.post("/upload", response_model=FileResponse, status_code=201)
async def upload_file(
    upload: UploadFile = FormFile(...),
    folder_id: Optional[int] = Form(None),
    description: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Upload a browser file into the Telegram storage channel."""
    filename = sanitize_filename(upload.filename or "file")
    if folder_id is None:
        folder_id = (await ensure_default_folder(db, current_user.id)).id
        await db.commit()
    if folder_id is not None:
        folder = (await db.execute(select(Folder).where(Folder.id == folder_id, Folder.user_id == current_user.id))).scalar_one_or_none()
        if folder is None:
            raise HTTPException(status_code=404, detail="Folder not found")
    require_scoped_folder(request, folder_id)

    temporary_dir: str | None = None
    temporary_path: str | None = None
    sent_message = None
    try:
        temporary_dir = tempfile.mkdtemp(prefix="komod-upload-")
        temporary_path = str(Path(temporary_dir) / filename)
        digest = hashlib.sha256()
        with open(temporary_path, "wb") as temporary:
            while chunk := await upload.read(1024 * 1024):
                temporary.write(chunk)
                digest.update(chunk)
        file_size = os.path.getsize(temporary_path)
        if file_size == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        file_type = detect_upload_type(filename, upload.content_type)
        content_hash = digest.hexdigest()
        search_text = decode_searchable_text(Path(temporary_path).read_bytes()) if file_type == "text" and file_size <= 1024 * 1024 else None
        duplicate = (await db.execute(select(File).where(
            File.user_id == current_user.id, File.content_hash == content_hash,
        ).order_by(File.id.asc()))).scalars().first()
        if duplicate is not None:
            shortcut = File(
                user_id=current_user.id, folder_id=folder_id,
                file_id=duplicate.file_id, file_unique_id=duplicate.file_unique_id,
                channel_message_id=duplicate.channel_message_id,
                storage_channel_id=duplicate.storage_channel_id,
                file_name=filename, description=(description or "").strip()[:1024] or None,
                search_text=duplicate.search_text, content_hash=content_hash, is_shortcut=True,
                file_size=duplicate.file_size, mime_type=duplicate.mime_type,
                file_type=duplicate.file_type, duration=duplicate.duration,
                width=duplicate.width, height=duplicate.height,
                thumbnail_file_id=duplicate.thumbnail_file_id,
                audio_variant_file_id=duplicate.audio_variant_file_id,
                audio_variant_unique_id=duplicate.audio_variant_unique_id,
                audio_variant_message_id=duplicate.audio_variant_message_id,
                audio_variant_storage_channel_id=duplicate.audio_variant_storage_channel_id,
                audio_variant_size=duplicate.audio_variant_size,
                compatible_video_file_id=duplicate.compatible_video_file_id,
                compatible_video_unique_id=duplicate.compatible_video_unique_id,
                compatible_video_message_id=duplicate.compatible_video_message_id,
                compatible_video_storage_channel_id=duplicate.compatible_video_storage_channel_id,
                compatible_video_size=duplicate.compatible_video_size,
            )
            db.add(shortcut)
            await db.commit()
            shortcut = (await db.execute(select(File).where(File.id == shortcut.id).options(
                selectinload(File.watch_progress)
            ))).scalar_one()
            return FileResponse(**add_urls_to_file(shortcut))
        embedded_cover_path: str | None = None
        if file_type == "audio" and Path(filename).suffix.lower() == ".mp3":
            cover_bytes = extract_embedded_cover(temporary_path)
            if cover_bytes:
                embedded_cover_path = str(Path(temporary_dir) / "embedded-cover.jpg")
                Path(embedded_cover_path).write_bytes(cover_bytes)
        target_channel_id = current_user.storage_channel_id or settings.telegram_storage_channel_id
        common = {
            "chat_id": target_channel_id,
            "caption": (description or "").strip()[:1024] or None,
            "parse_mode": None,
        }
        if embedded_cover_path:
            common["thumb"] = embedded_cover_path
        try:
            if file_type == "video":
                sent_message = await telegram.tg_client.send_video(video=temporary_path, supports_streaming=True, **common)
            elif file_type == "audio":
                sent_message = await telegram.tg_client.send_audio(audio=temporary_path, **common)
            else:
                sent_message = await telegram.tg_client.send_document(document=temporary_path, **common)
        except Exception:
            logger.exception("Typed Telegram upload failed; retrying as document")
            common.pop("thumb", None)
            sent_message = await telegram.tg_client.send_document(document=temporary_path, **common)
            file_type = detect_upload_type(filename, upload.content_type)

        media = sent_message.video or sent_message.audio or sent_message.document
        if media is None:
            raise RuntimeError("Telegram returned a message without uploaded media")
        stored = File(
            user_id=current_user.id,
            folder_id=folder_id,
            file_id=media.file_id,
            file_unique_id=media.file_unique_id,
            channel_message_id=sent_message.id,
            storage_channel_id=target_channel_id,
            file_name=filename,
            description=(description or "").strip()[:1024] or None,
            search_text=search_text,
            content_hash=content_hash,
            file_size=media.file_size or file_size,
            mime_type=getattr(media, "mime_type", None) or upload.content_type,
            file_type=file_type,
            duration=getattr(media, "duration", None),
            width=getattr(media, "width", None),
            height=getattr(media, "height", None),
            thumbnail_file_id=(select_best_thumbnail(getattr(media, "thumbs", None)).file_id if select_best_thumbnail(getattr(media, "thumbs", None)) else None),
        )
        db.add(stored)
        await db.commit()
        stored = (await db.execute(
            select(File).where(File.id == stored.id).options(selectinload(File.watch_progress))
        )).scalar_one()
        return FileResponse(**add_urls_to_file(stored))
    except HTTPException:
        raise
    except Exception as error:
        await db.rollback()
        if sent_message is not None:
            try:
                await delete_from_storage_channel(sent_message.id, target_channel_id if 'target_channel_id' in locals() else None)
            except Exception:
                pass
        logger.exception("Web upload failed")
        raise HTTPException(status_code=502, detail="Could not save this file in Telegram") from error
    finally:
        await upload.close()
        if temporary_dir:
            shutil.rmtree(temporary_dir, ignore_errors=True)


def apply_file_sort(query, sort: Optional[str]):
    """Apply a comma-separated, stable multi-column sort such as name:asc,type:desc."""
    criteria = []
    for raw in (sort or "created:desc").split(",")[:6]:
        field, _, direction = raw.strip().partition(":")
        column = FILE_SORT_FIELDS.get(field)
        if column is None:
            continue
        criteria.append(desc(column) if direction.lower() == "desc" else asc(column))
    if not criteria:
        criteria = [desc(File.created_at)]
    return query.order_by(desc(File.is_pinned), *criteria, asc(File.id))


@router.get("/{file_id}/text")
async def get_text_preview(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Preview a saved text message or a small UTF-8 text document."""
    file = (await db.execute(select(File).where(
        File.id == file_id, File.user_id == current_user.id
    ))).scalar_one_or_none()
    if file is None:
        raise HTTPException(status_code=404, detail="File not found")
    if file.is_hidden:
        require_vault_access(request, current_user)
    is_text_document = file.file_type == "document" and (
        (file.mime_type or "").startswith("text/")
        or (file.mime_type or "") in {"application/json", "application/xml"}
        or file.file_name.lower().endswith((".txt", ".md", ".json", ".csv", ".log", ".xml", ".yaml", ".yml"))
    )
    if file.file_type != "text" and not is_text_document:
        raise HTTPException(status_code=415, detail="Text preview is not available for this file")
    if file.file_size > 1024 * 1024:
        raise HTTPException(status_code=413, detail="Text preview is limited to 1 MB")
    message = await get_message_from_channel(file.channel_message_id, file.storage_channel_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found in storage")
    if file.file_type == "text" and getattr(message, "document", None) is None:
        content = telegram_text_with_links(message.text)
        if file.search_text != content:
            file.search_text = content
            await db.commit()
        return {"content": content}
    contents = await telegram.tg_client.download_media(message, in_memory=True)
    if contents is None:
        raise HTTPException(status_code=502, detail="Could not load text document")
    try:
        raw = contents.getvalue()
        encoding = "utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
        content = raw.decode(encoding)
        if file.search_text != content:
            file.search_text = content
            await db.commit()
        return {"content": content}
    except UnicodeDecodeError:
        raise HTTPException(status_code=415, detail="Only UTF-8 and UTF-16 text preview is supported")


@router.patch("/{file_id}/text")
async def update_text_content(
    file_id: int,
    payload: TextContentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Edit a saved Telegram text note and keep the file metadata in sync."""
    file = (await db.execute(select(File).where(File.id == file_id, File.user_id == current_user.id))).scalar_one_or_none()
    if file is None:
        raise HTTPException(status_code=404, detail="File not found")
    if file.is_hidden:
        require_vault_access(request, current_user)
    if file.file_type != "text":
        raise HTTPException(status_code=415, detail="Only saved text notes can be edited")
    message = await get_message_from_channel(file.channel_message_id, file.storage_channel_id)
    try:
        if message is not None and message.document is not None:
            suffix = Path(file.file_name).suffix or ".md"
            with tempfile.TemporaryDirectory(prefix="komod-text-") as temporary_dir:
                text_path = Path(temporary_dir) / f"note{suffix}"
                text_path.write_text(payload.content, encoding="utf-8")
                replacement = await telegram.tg_client.send_document(
                    chat_id=file.storage_channel_id or settings.telegram_storage_channel_id,
                    document=str(text_path),
                    caption=file.description,
                    parse_mode=None,
                )
            media = replacement.document
            if media is None:
                raise RuntimeError("Telegram returned no document for edited note")
            old_message_id = file.channel_message_id
            file.file_id = media.file_id
            file.file_unique_id = media.file_unique_id
            file.channel_message_id = replacement.id
            file.file_size = media.file_size or len(payload.content.encode("utf-8"))
            file.mime_type = media.mime_type or "text/markdown"
            remaining = (await db.execute(select(File.id).where(
                File.id != file.id,
                File.storage_channel_id == file.storage_channel_id,
                File.channel_message_id == old_message_id,
            ).limit(1))).scalar_one_or_none()
            if remaining is None:
                await delete_from_storage_channel(old_message_id, file.storage_channel_id)
        else:
            await telegram.tg_client.edit_message_text(file.storage_channel_id or settings.telegram_storage_channel_id, file.channel_message_id, payload.content)
            file.file_name = sanitize_filename(payload.content.strip().splitlines()[0][:80])
            file.file_size = len(payload.content.encode("utf-8"))
    except Exception as error:
        logger.exception("Could not edit text note %s", file_id)
        raise HTTPException(status_code=502, detail="Could not update text in Telegram") from error
    file.updated_at = datetime.utcnow()
    file.search_text = payload.content
    file.content_hash = hashlib.sha256(payload.content.encode("utf-8")).hexdigest()
    file.is_shortcut = False
    await db.commit()
    return {"content": payload.content, "file": add_urls_to_file(file)}


@router.get("", response_model=FileListResponse)
async def list_files(
    folder_id: Optional[int] = Query(None, description="Filter by folder ID (null for root)"),
    file_type: Optional[str] = Query(None, description="Comma-separated file types"),
    search: Optional[str] = Query(None, description="Search by filename"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    sort: Optional[str] = None,
    favorite_only: bool = False,
    include_playlist_covers: bool = False,
    include_hidden: bool = False,
    request: Request = None,
    hidden_only: bool = False,
):
    """List user's files with optional filtering."""
    query = select(File).where(File.user_id == current_user.id).options(selectinload(File.watch_progress))
    scope = workspace_scope(request)
    if scope and (scope["folder_ids"] or scope["file_ids"]):
        allowed_folders = getattr(request.state, "workspace_allowed_folder_ids", set())
        clauses = []
        if scope["file_ids"]:
            clauses.append(File.id.in_(scope["file_ids"]))
        if allowed_folders:
            clauses.append(File.folder_id.in_(allowed_folders))
        query = query.where(or_(*clauses))
    if hidden_only:
        require_vault_access(request, current_user)
        query = query.where(File.is_hidden.is_(True))
    elif include_hidden:
        require_vault_access(request, current_user)
    else:
        query = query.where(File.is_hidden.is_(False))

    if not include_playlist_covers:
        query = query.where(
            ~exists().where(Playlist.cover_file_id == File.id, Playlist.user_id == current_user.id),
            ~exists().where(Folder.cover_file_id == File.id, Folder.user_id == current_user.id),
        )
    
    
    # Apply filters
    if folder_id is not None:
        query = query.where(File.folder_id == folder_id)
    elif scope and (scope["folder_ids"] or scope["file_ids"]) and not search and not file_type and not favorite_only:
        query = query.where(File.id.in_(scope["file_ids"]) if scope["file_ids"] else false())
    elif not hidden_only and not search and not file_type and not favorite_only and not (scope and (scope["folder_ids"] or scope["file_ids"])):
        # If simply browsing (no search/filter), only show files in root (folder_id is NULL)
        query = query.where(File.folder_id.is_(None))

    # A pack marked as exclusive owns the visibility of its members regardless
    # of where the pack and source files live. Stable file ids still keep the
    # members available inside the pack itself.
    query = query.where(~exists().where(
        PackItem.file_id == File.id,
        PackItem.pack_id == Pack.id,
        Pack.user_id == current_user.id,
        Pack.hide_member_files.is_(True),
    ))
        
    if file_type:
        file_types = [item.strip() for item in file_type.split(",") if item.strip()]
        if file_types:
            query = query.where(File.file_type.in_(file_types))
    if favorite_only:
        query = query.where(File.is_favorite.is_(True))
    base_query = query
    if search:
        # Older notes predate the local content index. Populate them on the
        # first content search so existing libraries become searchable too.
        search_terms = [term.strip() for term in re.split(r"[;؛,،]+", search.strip()) if term.strip()]
        if any(not term.startswith("#") for term in search_terms):
            await index_missing_text_notes(db, current_user.id)
        # Semicolon-separated groups are alternatives (OR). Terms separated by a
        # comma inside each group must all match (AND). Persian punctuation is
        # accepted too: `درس،مهم؛موسیقی`.
        or_groups = []
        for raw_group in re.split(r"[;؛]+", search.strip()):
            and_terms = []
            for raw_term in re.split(r"[,،]+", raw_group):
                raw_term = raw_term.strip()
                if not raw_term:
                    continue
                tag_only = raw_term.startswith("#")
                normalized = raw_term[1:].strip() if tag_only else raw_term
                if not normalized:
                    continue
                escaped = f"%{escape_like(normalized)}%"
                if tag_only:
                    and_terms.append(File.tags_json.ilike(escaped, escape="\\"))
                else:
                    and_terms.append(or_(
                        File.file_name.ilike(escaped, escape="\\"),
                        File.description.ilike(escaped, escape="\\"),
                        File.tags_json.ilike(escaped, escape="\\"),
                        File.search_text.ilike(escaped, escape="\\"),
                    ))
            if and_terms:
                or_groups.append(and_(*and_terms))
        if or_groups:
            query = query.where(or_(*or_groups))
    
    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()

    # Preserve exact search semantics first. A single plain phrase falls back
    # to typo-tolerant ranking only when there are no exact matches.
    simple_fuzzy_search = bool(search and not re.search(r"[#;؛,،]", search) and len(normalize_fuzzy_text(search)) >= 3)
    if simple_fuzzy_search and not total:
        candidates = (await db.execute(base_query.limit(2000))).scalars().unique().all()
        threshold = 0.72 if len(normalize_fuzzy_text(search)) <= 5 else 0.64
        ranked = sorted(
            ((fuzzy_file_score(file, search), file) for file in candidates),
            key=lambda item: (-item[0], item[1].file_name.casefold(), item[1].id),
        )
        ranked = [item for item in ranked if item[0] >= threshold]
        if ranked:
            fuzzy_files = [item[1] for item in ranked]
            page_files = fuzzy_files[(page - 1) * per_page:page * per_page]
            suggestions = []
            for file in fuzzy_files:
                suggestion = Path(file.file_name).stem.strip()
                if suggestion and suggestion.casefold() not in {item.casefold() for item in suggestions}:
                    suggestions.append(suggestion)
                if len(suggestions) == 5:
                    break
            return FileListResponse(
                files=[FileResponse(**add_urls_to_file(file)) for file in page_files],
                total=len(fuzzy_files), page=page, per_page=per_page,
                search_mode="fuzzy", suggestions=suggestions,
            )
    
    # Apply pagination
    query = apply_file_sort(query, sort)
    query = query.offset((page - 1) * per_page).limit(per_page)
    
    result = await db.execute(query)
    files = result.scalars().all()
    
    return FileListResponse(
        files=[FileResponse(**add_urls_to_file(f)) for f in files],
        total=total,
        page=page,
        per_page=per_page,
        search_mode="exact",
        suggestions=[],
    )


@router.get("/recent", response_model=FileListResponse)
async def get_recent_files(
    limit: int = Query(20, ge=1, le=100),
    sort: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get recently added files across all folders."""
    query = select(File).where(
        File.user_id == current_user.id, File.is_hidden.is_(False),
        ~exists().where(Playlist.cover_file_id == File.id, Playlist.user_id == current_user.id),
        ~exists().where(Folder.cover_file_id == File.id, Folder.user_id == current_user.id),
    ).options(selectinload(File.watch_progress))
    files = (await db.execute(apply_file_sort(query, sort).limit(limit))).scalars().all()
    
    return FileListResponse(
        files=[FileResponse(**add_urls_to_file(f)) for f in files],
        total=len(files),
        page=1,
        per_page=limit,
    )


@router.get("/activity", response_model=ActivityResponse)
async def get_activity(
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return both activity feeds in one request, ordered by their natural timestamps."""
    continue_watching = await fetch_continue_watching_files(db, current_user.id, limit)
    recent = await fetch_recent_files(db, current_user.id, limit)
    favorites = (await db.execute(
        select(File)
        .where(
            File.user_id == current_user.id, File.is_hidden.is_(False), File.is_favorite.is_(True),
            ~exists().where(Playlist.cover_file_id == File.id, Playlist.user_id == current_user.id),
            ~exists().where(Folder.cover_file_id == File.id, Folder.user_id == current_user.id),
        )
        .options(selectinload(File.watch_progress))
        .order_by(File.updated_at.desc(), File.id.desc())
        .limit(limit)
    )).scalars().all()
    return ActivityResponse(
        continue_watching=[FileResponse(**add_urls_to_file(file)) for file in continue_watching],
        recent=[FileResponse(**add_urls_to_file(file)) for file in recent],
        favorites=[FileResponse(**add_urls_to_file(file)) for file in favorites],
    )


@router.get("/continue-watching", response_model=FileListResponse)
async def get_continue_watching(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    sort: Optional[str] = None,
):
    """Get files with watch progress."""
    if sort:
        query = (
            select(File)
            .join(WatchProgress, File.id == WatchProgress.file_id)
            .where(
                File.user_id == current_user.id,
                File.is_hidden.is_(False),
                WatchProgress.user_id == current_user.id,
                WatchProgress.position > 0,
                WatchProgress.completed == False,
            )
            .options(selectinload(File.watch_progress))
        )
        files = (await db.execute(apply_file_sort(query, sort).limit(limit))).scalars().unique().all()
    else:
        files = await fetch_continue_watching_files(db, current_user.id, limit)
    
    return FileListResponse(
        files=[FileResponse(**add_urls_to_file(f)) for f in files],
        total=len(files),
        page=1,
        per_page=limit,
    )


@router.get("/storage", response_model=dict)
async def get_storage_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Get total storage usage."""
    conditions = [File.user_id == current_user.id]
    scope = workspace_scope(request)
    if scope and (scope["folder_ids"] or scope["file_ids"]):
        clauses = []
        if scope["file_ids"]:
            clauses.append(File.id.in_(scope["file_ids"]))
        allowed_folders = getattr(request.state, "workspace_allowed_folder_ids", set())
        if allowed_folders:
            clauses.append(File.folder_id.in_(allowed_folders))
        if clauses:
            conditions.append(or_(*clauses))
    result = await db.execute(select(func.sum(File.file_size), func.count(File.id)).where(*conditions))
    total_size, total_files = result.one()
    breakdown_result = await db.execute(
        select(File.file_type, func.count(File.id), func.sum(File.file_size))
        .where(*conditions)
        .group_by(File.file_type)
    )
    by_type = [
        {"type": file_type or "document", "count": count or 0, "size": size or 0}
        for file_type, count, size in breakdown_result.all()
    ]
    
    return {
        "total_size": total_size or 0,
        "total_files": total_files or 0,
        "by_type": by_type,
        "limit": -1  # Unlimited
    }


@router.get("/{file_id}", response_model=FileResponse)
async def get_file(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Get a specific file by ID."""
    result = await db.execute(
        select(File).where(File.id == file_id, File.user_id == current_user.id).options(selectinload(File.watch_progress))
    )
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if file.is_hidden:
        require_vault_access(request, current_user)
    
    return FileResponse(**add_urls_to_file(file))


@router.patch("/{file_id}", response_model=FileResponse)
async def update_file(
    file_id: int,
    update_data: FileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Update file metadata (rename, move to folder)."""
    result = await db.execute(
        select(File).where(File.id == file_id, File.user_id == current_user.id)
    )
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if file.is_hidden and not has_vault_access(request, current_user):
        require_vault_access(request, current_user)
    
    # Update fields
    if update_data.file_name is not None:
        file.file_name = sanitize_filename(update_data.file_name)
    if update_data.description is not None:
        file.description = update_data.description.strip()[:1024] or None
    if update_data.is_favorite is not None:
        file.is_favorite = update_data.is_favorite
    if update_data.is_pinned is not None:
        file.is_pinned = update_data.is_pinned
    if update_data.is_hidden is not None:
        if update_data.is_hidden and not current_user.vault_password_hash:
            raise HTTPException(status_code=409, detail="ابتدا برای گاوصندوق رمز تعیین کن")
        file.is_hidden = update_data.is_hidden
        if file.is_hidden:
            file.public_hash = None
    if update_data.tags is not None:
        tags: list[str] = []
        for raw in update_data.tags:
            tag = " ".join(str(raw).strip().lstrip("#").split())[:40]
            if tag and tag.casefold() not in {item.casefold() for item in tags}:
                tags.append(tag)
            if len(tags) >= 20:
                break
        file.tags_json = json.dumps(tags, ensure_ascii=False)
    if update_data.folder_id is not None:
        target_id = update_data.folder_id or None
        if target_id is not None:
            target = (await db.execute(select(Folder).where(
                Folder.id == target_id, Folder.user_id == current_user.id
            ))).scalar_one_or_none()
            if target is None:
                raise HTTPException(status_code=404, detail="Destination folder not found")
        file.folder_id = target_id
    
    await db.commit()
    
    # Re-fetch with relationships
    result = await db.execute(
        select(File).where(File.id == file_id).options(selectinload(File.watch_progress))
    )
    file = result.scalar_one()
    
    return FileResponse(**add_urls_to_file(file))


@router.delete("/{file_id}")
async def delete_file(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Delete a file from database and Telegram channel."""
    result = await db.execute(
        select(File).where(File.id == file_id, File.user_id == current_user.id)
    )
    file = result.scalar_one_or_none()
    if file is not None and file.is_hidden:
        require_vault_access(request, current_user)
    
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Old Telegram messages may already be gone or belong to a previous storage
    # channel.  Their stale metadata must still be removable from Komod.
    storage_deleted = False
    if current_user.delete_storage_files:
        messages = await unreferenced_storage_messages(db, [file])
        if messages:
            channel_id, message_ids = next(iter(messages.items()))
            storage_deleted = await delete_from_storage_channel(message_ids, channel_id)
        for channel_id, message_ids in (await unreferenced_audio_variant_messages(db, [file])).items():
            await delete_from_storage_channel(message_ids, channel_id)
    
    # Delete from database
    await db.delete(file)
    await db.commit()
    
    return {"message": "File deleted successfully", "storage_deleted": storage_deleted}


@router.post("/batch-delete")
async def batch_delete_files(
    file_ids: list[int],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Delete multiple files."""
    # Fetch all files
    result = await db.execute(
        select(File).where(File.id.in_(file_ids), File.user_id == current_user.id)
    )
    files = result.scalars().all()
    if any(file.is_hidden for file in files):
        require_vault_access(request, current_user)
    if not files:
        return {"message": "No files found to delete"}
    
    # Telegram message ids are only unique inside their own channel.
    if current_user.delete_storage_files:
        messages_by_channel = await unreferenced_storage_messages(db, files)
        audio_messages_by_channel = await unreferenced_audio_variant_messages(db, files)
        for channel_id, msg_ids in messages_by_channel.items():
            for start in range(0, len(msg_ids), 100):
                batch = msg_ids[start:start + 100]
                if channel_id is None:
                    await delete_from_storage_channel(batch)
                else:
                    await delete_from_storage_channel(batch, channel_id)
        for channel_id, msg_ids in audio_messages_by_channel.items():
            for start in range(0, len(msg_ids), 100):
                await delete_from_storage_channel(msg_ids[start:start + 100], channel_id)
    
    # Delete from DB
    for file in files:
        await db.delete(file)
        
    await db.commit()
    
    return {"message": f"Deleted {len(files)} files"}


@router.post("/send-to-telegram")
async def send_files_to_telegram(
    payload: SendToTelegramRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Copy selected stored files to the signed-in user's Telegram chat."""
    unique_ids = list(dict.fromkeys(payload.ids))
    files = (await db.execute(select(File).where(
        File.id.in_(unique_ids), File.user_id == current_user.id,
    ))).scalars().all()
    if not files:
        raise HTTPException(status_code=404, detail="فایلی برای ارسال پیدا نشد.")
    if any(item.is_hidden for item in files):
        require_vault_access(request, current_user)
    signed_in_user = getattr(request.state, "signed_in_user", current_user)
    by_id = {item.id: item for item in files}
    sent = 0
    failed: list[int] = []
    for file_id in unique_ids:
        item = by_id.get(file_id)
        if item is None:
            failed.append(file_id)
            continue
        try:
            await telegram.tg_client.copy_message(
                signed_in_user.telegram_id,
                item.storage_channel_id or settings.telegram_storage_channel_id,
                item.channel_message_id,
            )
            sent += 1
        except Exception:
            logger.warning("Could not send file %s to Telegram user %s", item.id, signed_in_user.telegram_id, exc_info=True)
            failed.append(item.id)
    if sent == 0:
        raise HTTPException(status_code=502, detail="ارسال فایل‌ها به تلگرام انجام نشد؛ اول یک‌بار ربات را باز کن.")
    return {"sent": sent, "failed": failed}


@router.post("/batch-update")
async def batch_update_files(
    update_data: BatchFileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Edit descriptions and names for a selected group of files."""
    files = (await db.execute(select(File).where(
        File.id.in_(dict.fromkeys(update_data.ids)), File.user_id == current_user.id
    ))).scalars().all()
    if not files:
        raise HTTPException(status_code=404, detail="No files found")
    if any(file.is_hidden for file in files):
        require_vault_access(request, current_user)
    if update_data.is_hidden and not current_user.vault_password_hash:
        raise HTTPException(status_code=409, detail="ابتدا برای گاوصندوق رمز تعیین کن")
    if update_data.description_mode in {"set", "append"} and update_data.description is None:
        raise HTTPException(status_code=400, detail="Description is required")
    if update_data.rename_mode in {"prefix", "suffix"} and not update_data.rename_value:
        raise HTTPException(status_code=400, detail="Rename value is required")
    if update_data.rename_mode == "replace" and not update_data.rename_search:
        raise HTTPException(status_code=400, detail="Search text is required")

    def clean_tags(values: list[str]) -> list[str]:
        cleaned: list[str] = []
        seen: set[str] = set()
        for raw in values:
            tag = raw.strip()[:40]
            key = tag.casefold()
            if tag and key not in seen:
                cleaned.append(tag)
                seen.add(key)
            if len(cleaned) >= 20:
                break
        return cleaned

    description = (update_data.description or "").strip()[:1024]
    tags_to_add = clean_tags(update_data.tags_add)
    tags_to_remove = {tag.casefold() for tag in clean_tags(update_data.tags_remove)}
    replacement_tags = clean_tags(update_data.tags_replace) if update_data.tags_replace is not None else None
    def clean_description(value: str | None) -> str | None:
        if not value:
            return None
        cleaned = value
        if update_data.cleanup_links:
            cleaned = re.sub(r"\[([^\]]+)\]\(https?://[^)]+\)", r"\1", cleaned, flags=re.IGNORECASE)
            cleaned = re.sub(r"<a\s+[^>]*href=[\"']https?://[^\"']+[\"'][^>]*>(.*?)</a>", r"\1", cleaned, flags=re.IGNORECASE | re.DOTALL)
            cleaned = re.sub(r"https?://\S+", "", cleaned, flags=re.IGNORECASE)
        if update_data.cleanup_mentions:
            cleaned = re.sub(r"(?<![\w@])@[A-Za-z0-9_]{3,}", "", cleaned)
        if update_data.cleanup_hashtags:
            cleaned = re.sub(r"(?<![\w#])#[^\s#]+", "", cleaned)
        cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
        cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
        cleaned = re.sub(r"\n[ \t]+", "\n", cleaned)
        cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
        return cleaned[:1024] or None
    for file in files:
        if update_data.is_hidden is not None:
            file.is_hidden = update_data.is_hidden
            if update_data.is_hidden:
                file.public_hash = None
        if update_data.description_mode == "clear":
            file.description = None
        elif update_data.description_mode == "set":
            file.description = description or None
        elif update_data.description_mode == "append" and description:
            file.description = f"{file.description}\n{description}".strip()[:1024] if file.description else description
        if update_data.cleanup_links or update_data.cleanup_mentions or update_data.cleanup_hashtags:
            file.description = clean_description(file.description)

        if update_data.rename_mode:
            name = file.file_name
            stem, dot, extension = name.rpartition(".")
            if not dot or not stem:
                stem, extension = name, ""
            if update_data.rename_mode == "prefix":
                stem = f"{update_data.rename_value}{stem}"
            elif update_data.rename_mode == "suffix":
                stem = f"{stem}{update_data.rename_value}"
            else:
                stem = stem.replace(update_data.rename_search or "", update_data.rename_value or "")
            file.file_name = sanitize_filename(f"{stem}.{extension}" if extension else stem)

        if replacement_tags is not None:
            tags = list(replacement_tags)
        else:
            try:
                stored_tags = json.loads(file.tags_json or "[]")
                tags = clean_tags(stored_tags if isinstance(stored_tags, list) else [])
            except (TypeError, ValueError, json.JSONDecodeError):
                tags = []
            if tags_to_remove:
                tags = [tag for tag in tags if tag.casefold() not in tags_to_remove]
            existing = {tag.casefold() for tag in tags}
            for tag in tags_to_add:
                if tag.casefold() not in existing and len(tags) < 20:
                    tags.append(tag)
                    existing.add(tag.casefold())
        file.tags_json = json.dumps(tags, ensure_ascii=False)

    await db.commit()
    return {"message": f"Updated {len(files)} files", "updated": len(files)}


@router.post("/{file_id}/progress")
@router.put("/{file_id}/progress")
async def update_progress(
    file_id: int,
    progress: WatchProgressUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update watch progress. Supports both POST and PUT."""
    # Check file exists
    result = await db.execute(select(File).where(File.id == file_id, File.user_id == current_user.id))
    file = result.scalar_one_or_none()
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
        
    # Get or create progress
    result = await db.execute(
        select(WatchProgress).where(WatchProgress.file_id == file_id, WatchProgress.user_id == current_user.id)
    )
    watch_progress = result.scalar_one_or_none()
    
    if not watch_progress:
        watch_progress = WatchProgress(
            user_id=current_user.id,
            file_id=file_id,
            position=progress.position,
            duration=int(progress.duration) if progress.duration else None,
            completed=False
        )
        db.add(watch_progress)
    else:
        watch_progress.position = progress.position
        if progress.duration:
             watch_progress.duration = int(progress.duration)
    try:
        player_state = json.loads(current_user.player_state_json or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        player_state = {}
    file_ids = player_state.get("file_ids") or []
    current_index = int(player_state.get("current_index", -1))
    if 0 <= current_index < len(file_ids) and file_ids[current_index] == file_id:
        player_state["position"] = progress.position
        player_state["updated_at"] = datetime.utcnow().isoformat()
        current_user.player_state_json = json.dumps(player_state)
        
    await db.commit()
    await db.refresh(watch_progress)
    return watch_progress


@router.get("/{file_id}/progress")
async def get_progress(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get watch progress for a file."""
    result = await db.execute(
        select(WatchProgress).where(
            WatchProgress.file_id == file_id, 
            WatchProgress.user_id == current_user.id
        )
    )
    progress = result.scalar_one_or_none()
    
    if not progress:
        return {"position": 0, "duration": 0, "completed": False}
    
    return {
        "position": progress.position,
        "duration": progress.duration or 0,
        "completed": progress.completed
    }


@router.post("/{file_id}/share", response_model=FileResponse)
@limiter.limit("20/minute")
async def share_file(
    file_id: int,
    request: Request,
    payload: PublicShareCreate = PublicShareCreate(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create or replace a configurable public link for the file."""
    result = await db.execute(
        select(File).where(File.id == file_id, File.user_id == current_user.id).options(selectinload(File.watch_progress))
    )
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if file.is_hidden:
        raise HTTPException(status_code=409, detail="فایل مخفی را نمی‌توان عمومی کرد")
    
    # Generate hash if not exists or regenerate
    # Using 16 bytes = 32 hex chars
    file.public_hash = secrets.token_hex(16)
    file.public_expires_at = datetime.utcnow() + timedelta(hours=payload.expires_in_hours) if payload.expires_in_hours else None
    file.public_password_hash = share_password_context.hash(payload.password) if payload.password else None
    file.public_allow_download = payload.allow_download
    file.public_view_limit = payload.view_limit
    file.public_view_count = 0
    add_security_event(
        db, "public_link_created", user_id=current_user.id, request=request,
        target_type="file", target_id=file.id,
        details={"expires": bool(payload.expires_in_hours), "password": bool(payload.password), "download": payload.allow_download, "view_limit": payload.view_limit},
    )
    
    await db.commit()
    
    # Re-fetch with relationships
    result = await db.execute(
        select(File).where(File.id == file_id).options(selectinload(File.watch_progress))
    )
    file = result.scalar_one()
    
    return FileResponse(**add_urls_to_file(file))


@router.delete("/{file_id}/share", response_model=FileResponse)
async def revoke_share(
    file_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Revoke the public link for the file."""
    result = await db.execute(
        select(File).where(File.id == file_id, File.user_id == current_user.id).options(selectinload(File.watch_progress))
    )
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    file.public_hash = None
    file.public_expires_at = None
    file.public_password_hash = None
    file.public_view_limit = None
    file.public_view_count = 0
    add_security_event(db, "public_link_revoked", user_id=current_user.id, request=request, target_type="file", target_id=file.id)
    
    await db.commit()
    
    # Re-fetch with relationships
    result = await db.execute(
        select(File).where(File.id == file_id).options(selectinload(File.watch_progress))
    )
    file = result.scalar_one()
    
    return FileResponse(**add_urls_to_file(file))
@router.post("/batch-move")
async def batch_move_files(
    move_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Move multiple files to a folder."""
    file_ids = move_data.get("ids", [])
    folder_id = move_data.get("folder_id")
    selected = (await db.execute(select(File).where(
        File.id.in_(file_ids), File.user_id == current_user.id
    ))).scalars().all()
    if any(file.is_hidden for file in selected):
        require_vault_access(request, current_user)
    
    if folder_id == 0:
        folder_id = None
        
    # Verify target folder belongs to user
    if folder_id is not None:
        from ..models import Folder
        folder_check = await db.execute(
            select(Folder).where(Folder.id == folder_id, Folder.user_id == current_user.id)
        )
        if not folder_check.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Target folder not found")
            
    # Update files
    from sqlalchemy import update
    await db.execute(
        update(File)
        .where(File.id.in_(file_ids), File.user_id == current_user.id)
        .values(folder_id=folder_id)
    )
    
    await db.commit()
    return {"message": f"Moved {len(file_ids)} files"}
