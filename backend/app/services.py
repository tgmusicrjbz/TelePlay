"""
Shared business logic and database queries.
"""
import json
import re
from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc, exists, and_, or_
from sqlalchemy.orm import selectinload

from .models import File, WatchProgress, Folder, Playlist

def telegram_text_with_links(value) -> str:
    """Return Telegram text as Markdown so hidden text links survive previews."""
    if value is None:
        return ""
    markdown = getattr(value, "markdown", None)
    if callable(markdown):
        try:
            markdown = markdown()
        except Exception:
            markdown = None
    return str(markdown or value)

def select_best_thumbnail(thumbnails):
    """Pick the largest Telegram thumbnail instead of relying on list order."""
    return max(
        thumbnails or [],
        key=lambda thumb: (
            (getattr(thumb, "width", 0) or 0) * (getattr(thumb, "height", 0) or 0),
            getattr(thumb, "file_size", 0) or 0,
        ),
        default=None,
    )

def escape_like(value: str) -> str:
    """Escape special LIKE/ILIKE characters to prevent SQL injection."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

def sanitize_filename(name: str) -> str:
    """
    Sanitize filename to prevent path traversal and XSS attacks.
    """
    if not name:
        return "unnamed_file"
    
    # Remove null bytes and path separators
    name = name.replace("\x00", "").replace("/", "_").replace("\\", "_")
    
    # Remove dangerous characters
    name = re.sub(r'[<>:"|?*\x00-\x1f]', '_', name)
    
    # Remove leading/trailing dots and spaces
    name = name.strip(". ")
    
    # Limit length
    if len(name) > 255:
        if "." in name:
            ext = name.rsplit(".", 1)[-1][:10]
            name = name[:255 - len(ext) - 1] + "." + ext
        else:
            name = name[:255]
    
    return name if name else "unnamed_file"

def add_urls_to_file(file: File) -> dict:
    """Add stream and thumbnail URLs to file response."""
    try:
        tags = [str(item) for item in json.loads(file.tags_json or "[]") if str(item).strip()]
    except (TypeError, ValueError, json.JSONDecodeError):
        tags = []
    data = {
        "id": file.id,
        "user_id": file.user_id,
        "folder_id": file.folder_id,
        "file_id": file.file_id,
        "file_unique_id": file.file_unique_id,
        "file_name": file.file_name,
        "description": file.description,
        "prefer_text_view": bool(file.prefer_text_view),
        "tags": tags,
        "file_size": file.file_size,
        "mime_type": file.mime_type,
        "file_type": file.file_type,
        "duration": file.duration,
        "width": file.width,
        "height": file.height,
        "created_at": file.created_at,
        "updated_at": file.updated_at,
        "is_favorite": bool(file.is_favorite),
        "is_pinned": bool(file.is_pinned),
        "is_hidden": bool(file.is_hidden),
        "is_shortcut": bool(file.is_shortcut),
        "audio_stream_url": f"/api/stream/{file.id}/audio?workspace={file.user_id}" if file.audio_variant_message_id else None,
        "audio_variant_size": file.audio_variant_size,
        "compatible_video_stream_url": f"/api/stream/{file.id}/compatible?workspace={file.user_id}" if file.compatible_video_message_id else None,
        "compatible_video_size": file.compatible_video_size,
        "public_expires_at": file.public_expires_at,
        "public_allow_download": file.public_allow_download,
        "public_view_limit": file.public_view_limit,
        "public_view_count": file.public_view_count,
        "public_password_protected": bool(file.public_password_hash),
        "stream_url": f"/api/stream/{file.id}?workspace={file.user_id}",
        "thumbnail_url": f"/api/stream/{file.id}/thumbnail?quality=best&workspace={file.user_id}" if file.thumbnail_file_id else None,
        "last_pos": file.watch_progress[0].position if file.watch_progress else 0,
    }
    
    if file.public_hash:
        data["public_hash"] = file.public_hash
        data["public_stream_url"] = f"/api/stream/s/{file.public_hash}"
        
    return data


async def unreferenced_storage_messages(db: AsyncSession, files: List[File]) -> dict[int | None, list[int]]:
    """Group remote messages that no surviving File row references."""
    deleting_ids = {item.id for item in files if item.id is not None}
    references = {(item.storage_channel_id, item.channel_message_id) for item in files}
    if not references:
        return {}
    conditions = [and_(
        File.storage_channel_id.is_(None) if channel_id is None else File.storage_channel_id == channel_id,
        File.channel_message_id == message_id,
    ) for channel_id, message_id in references]
    query = select(File.storage_channel_id, File.channel_message_id).where(or_(*conditions))
    if deleting_ids:
        query = query.where(File.id.notin_(deleting_ids))
    retained = set((await db.execute(query)).all())
    grouped: dict[int | None, list[int]] = {}
    for channel_id, message_id in references - retained:
        grouped.setdefault(channel_id, []).append(message_id)
    return grouped


async def unreferenced_audio_variant_messages(db: AsyncSession, files: List[File]) -> dict[int | None, list[int]]:
    """Return cached media variants no longer shared by surviving shortcuts."""
    deleting_ids = {item.id for item in files if item.id is not None}
    audio_references = {(item.audio_variant_storage_channel_id, item.audio_variant_message_id) for item in files if item.audio_variant_message_id}
    video_references = {(item.compatible_video_storage_channel_id, item.compatible_video_message_id) for item in files if item.compatible_video_message_id}
    references = audio_references | video_references
    if not references:
        return {}
    audio_conditions = [and_(
        File.audio_variant_storage_channel_id.is_(None) if channel_id is None else File.audio_variant_storage_channel_id == channel_id,
        File.audio_variant_message_id == message_id,
    ) for channel_id, message_id in references]
    video_conditions = [and_(
        File.compatible_video_storage_channel_id.is_(None) if channel_id is None else File.compatible_video_storage_channel_id == channel_id,
        File.compatible_video_message_id == message_id,
    ) for channel_id, message_id in references]
    audio_query = select(File.audio_variant_storage_channel_id, File.audio_variant_message_id).where(or_(*audio_conditions))
    video_query = select(File.compatible_video_storage_channel_id, File.compatible_video_message_id).where(or_(*video_conditions))
    if deleting_ids:
        audio_query = audio_query.where(File.id.notin_(deleting_ids))
        video_query = video_query.where(File.id.notin_(deleting_ids))
    retained = set((await db.execute(audio_query)).all()) | set((await db.execute(video_query)).all())
    grouped: dict[int | None, list[int]] = {}
    for channel_id, message_id in references - retained:
        grouped.setdefault(channel_id, []).append(message_id)
    return grouped

async def fetch_recent_files(db: AsyncSession, user_id: int, limit: int) -> List[File]:
    """Get recently added files across all folders."""
    query = (
        select(File)
        .where(
            File.user_id == user_id, File.is_hidden.is_(False),
            ~exists().where(Playlist.cover_file_id == File.id, Playlist.user_id == user_id),
            ~exists().where(Folder.cover_file_id == File.id, Folder.user_id == user_id),
        )
        .options(selectinload(File.watch_progress))
        .order_by(desc(File.created_at))
        .limit(limit)
    )
    result = await db.execute(query)
    return result.scalars().all()

async def fetch_continue_watching_files(db: AsyncSession, user_id: int, limit: int) -> List[File]:
    """Get files with watch progress (not completed)."""
    query = (
        select(File)
        .join(WatchProgress, File.id == WatchProgress.file_id)
        .where(
            File.user_id == user_id,
            File.is_hidden.is_(False),
            WatchProgress.user_id == user_id,
            WatchProgress.position > 0,
            WatchProgress.completed == False
        )
        .options(selectinload(File.watch_progress))
        .order_by(desc(WatchProgress.updated_at))
        .limit(limit)
    )
    result = await db.execute(query)
    return result.scalars().unique().all()
