"""
File management API endpoints.
"""
from typing import Optional
from fastapi import APIRouter, Depends, File as FormFile, Form, HTTPException, Query, UploadFile
import secrets
import logging
import os
import shutil
import tempfile
from pathlib import Path
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete, asc, desc
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import File, User, WatchProgress, Folder
from ..schemas import BatchFileUpdate, FileResponse, FileListResponse, FileUpdate, WatchProgressUpdate
from ..auth import get_current_user
from ..telegram import delete_from_storage_channel, get_message_from_channel
from .. import telegram
from ..config import get_settings
from ..services import (
    escape_like, 
    sanitize_filename, 
    add_urls_to_file, 
    fetch_recent_files, 
    fetch_continue_watching_files
)

router = APIRouter(prefix="/files", tags=["Files"])
settings = get_settings()
logger = logging.getLogger(__name__)


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
    if mime.startswith("video/") or extension in {".mp4", ".mkv", ".mov", ".webm", ".avi"}:
        return "video"
    if mime.startswith("audio/") or extension in {".mp3", ".m4a", ".aac", ".wav", ".ogg", ".flac", ".opus"}:
        return "audio"
    if mime.startswith("image/") or extension in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}:
        return "image"
    return "document"


@router.post("/upload", response_model=FileResponse, status_code=201)
async def upload_file(
    upload: UploadFile = FormFile(...),
    folder_id: Optional[int] = Form(None),
    description: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Upload a browser file into the Telegram storage channel."""
    filename = sanitize_filename(upload.filename or "file")
    if folder_id is not None:
        folder = (await db.execute(select(Folder).where(Folder.id == folder_id, Folder.user_id == current_user.id))).scalar_one_or_none()
        if folder is None:
            raise HTTPException(status_code=404, detail="Folder not found")

    temporary_dir: str | None = None
    temporary_path: str | None = None
    sent_message = None
    try:
        temporary_dir = tempfile.mkdtemp(prefix="komod-upload-")
        temporary_path = str(Path(temporary_dir) / filename)
        with open(temporary_path, "wb") as temporary:
            while chunk := await upload.read(1024 * 1024):
                temporary.write(chunk)
        file_size = os.path.getsize(temporary_path)
        if file_size == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        file_type = detect_upload_type(filename, upload.content_type)
        common = {
            "chat_id": settings.telegram_storage_channel_id,
            "caption": (description or "").strip()[:1024] or None,
            "parse_mode": None,
        }
        try:
            if file_type == "video":
                sent_message = await telegram.tg_client.send_video(video=temporary_path, supports_streaming=True, **common)
            elif file_type == "audio":
                sent_message = await telegram.tg_client.send_audio(audio=temporary_path, **common)
            else:
                sent_message = await telegram.tg_client.send_document(document=temporary_path, **common)
        except Exception:
            logger.exception("Typed Telegram upload failed; retrying as document")
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
            file_name=filename,
            description=(description or "").strip()[:1024] or None,
            file_size=media.file_size or file_size,
            mime_type=getattr(media, "mime_type", None) or upload.content_type,
            file_type=file_type,
            duration=getattr(media, "duration", None),
            width=getattr(media, "width", None),
            height=getattr(media, "height", None),
            thumbnail_file_id=(media.thumbs[0].file_id if getattr(media, "thumbs", None) else None),
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
                await delete_from_storage_channel(sent_message.id)
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
    return query.order_by(*criteria, asc(File.id))


@router.get("/{file_id}/text")
async def get_text_preview(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Preview a saved text message or a small UTF-8 text document."""
    file = (await db.execute(select(File).where(
        File.id == file_id, File.user_id == current_user.id
    ))).scalar_one_or_none()
    if file is None:
        raise HTTPException(status_code=404, detail="File not found")
    is_text_document = file.file_type == "document" and (
        (file.mime_type or "").startswith("text/")
        or (file.mime_type or "") in {"application/json", "application/xml"}
        or file.file_name.lower().endswith((".txt", ".md", ".json", ".csv", ".log", ".xml", ".yaml", ".yml"))
    )
    if file.file_type != "text" and not is_text_document:
        raise HTTPException(status_code=415, detail="Text preview is not available for this file")
    if file.file_size > 1024 * 1024:
        raise HTTPException(status_code=413, detail="Text preview is limited to 1 MB")
    message = await get_message_from_channel(file.channel_message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found in storage")
    if file.file_type == "text":
        return {"content": message.text or ""}
    contents = await telegram.tg_client.download_media(message, in_memory=True)
    if contents is None:
        raise HTTPException(status_code=502, detail="Could not load text document")
    try:
        raw = contents.getvalue()
        encoding = "utf-16" if raw.startswith((b"\xff\xfe", b"\xfe\xff")) else "utf-8-sig"
        return {"content": raw.decode(encoding)}
    except UnicodeDecodeError:
        raise HTTPException(status_code=415, detail="Only UTF-8 and UTF-16 text preview is supported")


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
):
    """List user's files with optional filtering."""
    query = select(File).where(File.user_id == current_user.id).options(selectinload(File.watch_progress))
    
    
    # Apply filters
    if folder_id is not None:
        query = query.where(File.folder_id == folder_id)
    elif not search and not file_type:
        # If simply browsing (no search/filter), only show files in root (folder_id is NULL)
        query = query.where(File.folder_id.is_(None))
        
    if file_type:
        file_types = [item.strip() for item in file_type.split(",") if item.strip()]
        if file_types:
            query = query.where(File.file_type.in_(file_types))
    if search:
        escaped = f"%{escape_like(search)}%"
        query = query.where(
            File.file_name.ilike(escaped, escape="\\") |
            File.description.ilike(escaped, escape="\\")
        )
    
    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar()
    
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
    )


@router.get("/recent", response_model=FileListResponse)
async def get_recent_files(
    limit: int = Query(20, ge=1, le=100),
    sort: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get recently added files across all folders."""
    query = select(File).where(File.user_id == current_user.id).options(selectinload(File.watch_progress))
    files = (await db.execute(apply_file_sort(query, sort).limit(limit))).scalars().all()
    
    return FileListResponse(
        files=[FileResponse(**add_urls_to_file(f)) for f in files],
        total=len(files),
        page=1,
        per_page=limit,
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
):
    """Get total storage usage."""
    query = select(func.sum(File.file_size)).where(File.user_id == current_user.id)
    result = await db.execute(query)
    total_size = result.scalar() or 0
    
    return {
        "total_size": total_size,
        "limit": -1  # Unlimited
    }


@router.get("/{file_id}", response_model=FileResponse)
async def get_file(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific file by ID."""
    result = await db.execute(
        select(File).where(File.id == file_id, File.user_id == current_user.id).options(selectinload(File.watch_progress))
    )
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(**add_urls_to_file(file))


@router.patch("/{file_id}", response_model=FileResponse)
async def update_file(
    file_id: int,
    update_data: FileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update file metadata (rename, move to folder)."""
    result = await db.execute(
        select(File).where(File.id == file_id, File.user_id == current_user.id)
    )
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Update fields
    if update_data.file_name is not None:
        file.file_name = sanitize_filename(update_data.file_name)
    if update_data.description is not None:
        file.description = update_data.description.strip()[:1024] or None
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
):
    """Delete a file from database and Telegram channel."""
    result = await db.execute(
        select(File).where(File.id == file_id, File.user_id == current_user.id)
    )
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Delete from Telegram storage channel
    if not await delete_from_storage_channel(file.channel_message_id):
        raise HTTPException(status_code=502, detail="Could not delete file from Telegram storage")
    
    # Delete from database
    await db.delete(file)
    await db.commit()
    
    return {"message": "File deleted successfully"}


@router.post("/batch-delete")
async def batch_delete_files(
    file_ids: list[int],
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete multiple files."""
    # Fetch all files
    result = await db.execute(
        select(File).where(File.id.in_(file_ids), File.user_id == current_user.id)
    )
    files = result.scalars().all()
    
    if not files:
        return {"message": "No files found to delete"}
    
    # Collect message IDs for Telegram deletion
    msg_ids = [f.channel_message_id for f in files]
    
    # Delete from Telegram (batch)
    for start in range(0, len(msg_ids), 100):
        if not await delete_from_storage_channel(msg_ids[start:start + 100]):
            raise HTTPException(status_code=502, detail="Could not delete files from Telegram storage")
    
    # Delete from DB
    for file in files:
        await db.delete(file)
        
    await db.commit()
    
    return {"message": f"Deleted {len(files)} files"}


@router.post("/batch-update")
async def batch_update_files(
    update_data: BatchFileUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Edit descriptions and names for a selected group of files."""
    files = (await db.execute(select(File).where(
        File.id.in_(dict.fromkeys(update_data.ids)), File.user_id == current_user.id
    ))).scalars().all()
    if not files:
        raise HTTPException(status_code=404, detail="No files found")
    if update_data.description_mode in {"set", "append"} and update_data.description is None:
        raise HTTPException(status_code=400, detail="Description is required")
    if update_data.rename_mode in {"prefix", "suffix"} and not update_data.rename_value:
        raise HTTPException(status_code=400, detail="Rename value is required")
    if update_data.rename_mode == "replace" and not update_data.rename_search:
        raise HTTPException(status_code=400, detail="Search text is required")

    description = (update_data.description or "").strip()[:1024]
    for file in files:
        if update_data.description_mode == "clear":
            file.description = None
        elif update_data.description_mode == "set":
            file.description = description or None
        elif update_data.description_mode == "append" and description:
            file.description = f"{file.description}\n{description}".strip()[:1024] if file.description else description

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
async def share_file(
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate a permanent public link for the file."""
    result = await db.execute(
        select(File).where(File.id == file_id, File.user_id == current_user.id).options(selectinload(File.watch_progress))
    )
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    
    # Generate hash if not exists or regenerate
    # Using 16 bytes = 32 hex chars
    file.public_hash = secrets.token_hex(16)
    
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
):
    """Move multiple files to a folder."""
    file_ids = move_data.get("ids", [])
    folder_id = move_data.get("folder_id")
    
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
