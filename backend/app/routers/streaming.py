"""
Streaming API endpoints for media playback.
"""
import re
import asyncio
import logging
import mimetypes
import shutil
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import and_, select
from passlib.context import CryptContext
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..database import get_db
from ..models import File, SecurityEvent, User
from ..auth import create_public_share_token, get_current_user, require_vault_access, verify_public_share_token
from ..schemas import PublicShareUnlock
from ..audit import add_security_event, request_ip
from .. import telegram
from ..telegram import get_message_from_channel
from ..streaming import stream_file as stream_file_generator
from ..services import select_best_thumbnail
from ..media_metadata import extract_embedded_cover
from ..config import get_settings

# Logger for internal debugging (not exposed to users)
logger = logging.getLogger(__name__)

# Rate limiter for public endpoints
limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/stream", tags=["Streaming"])
settings = get_settings()
_audio_variant_locks: dict[int, asyncio.Lock] = {}
share_password_context = CryptContext(schemes=["pbkdf2_sha256"], pbkdf2_sha256__default_rounds=310_000, deprecated="auto")


def media_type_for(file: File) -> str:
    """Return a browser-friendly media type for legacy rows with generic MIME data."""
    stored = (file.mime_type or "").strip().lower()
    if stored and stored not in {"application/octet-stream", "binary/octet-stream"}:
        return stored
    guessed, _ = mimetypes.guess_type(file.file_name)
    if guessed:
        return guessed
    if file.file_type == "audio":
        return "audio/mpeg"
    if file.file_type == "video":
        return "video/mp4"
    return "application/octet-stream"


def parse_range_header(range_header: str, file_size: int) -> tuple[int, int]:
    """Parse HTTP Range header for video seeking support."""
    if not range_header:
        return 0, file_size - 1
    
    match = re.fullmatch(r'bytes=(\d*)-(\d*)', range_header.strip())
    if not match:
        return 0, file_size - 1
    start_raw, end_raw = match.groups()
    if not start_raw:
        suffix_length = int(end_raw or 0)
        if suffix_length <= 0:
            return 0, file_size - 1
        return max(0, file_size - suffix_length), file_size - 1
    start = int(start_raw)
    end = int(end_raw) if end_raw else file_size - 1
    
    return start, min(end, file_size - 1)


async def stored_message_response(file: File, message, range_header: str | None, download: int):
    """Serve text messages and Telegram photos, which have no document stream."""
    if file.file_type == "text" and message.document is None:
        content = (message.text or "").encode("utf-8")
    else:
        media = await telegram.tg_client.download_media(message, in_memory=True)
        if media is None:
            raise HTTPException(status_code=502, detail="Could not load photo")
        content = media.getvalue()
    size = len(content)
    if size == 0:
        return Response(content=b"", media_type=file.mime_type or "application/octet-stream")
    start, end = parse_range_header(range_header, size)
    if start >= size or end < start:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{size}"})
    from urllib.parse import quote
    disposition = "attachment" if download else "inline"
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(end - start + 1),
        "Content-Disposition": f"{disposition}; filename*=utf-8''{quote(file.file_name)}",
    }
    if range_header:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return Response(
        content=content[start:end + 1],
        media_type=media_type_for(file),
        status_code=206 if range_header else 200,
        headers=headers,
    )


@router.post("/{file_id}/audio-variant")
async def prepare_audio_variant(
    file_id: int, request: Request, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create and cache a low-bandwidth AAC version for video audio-only mode."""
    file = (await db.execute(select(File).where(
        File.id == file_id, File.user_id == current_user.id,
    ))).scalar_one_or_none()
    if file is None or file.file_type != "video":
        raise HTTPException(status_code=404, detail="Video not found")
    if file.is_hidden:
        require_vault_access(request, current_user)
    if file.audio_variant_message_id:
        return {"stream_url": f"/api/stream/{file.id}/audio", "size": file.audio_variant_size, "cached": True}
    if not shutil.which("ffmpeg"):
        raise HTTPException(status_code=503, detail="نسخه کم‌حجم صدا روی این سرور فعال نیست.")
    lock = _audio_variant_locks.setdefault(file_id, asyncio.Lock())
    async with lock:
        await db.refresh(file)
        if file.audio_variant_message_id:
            return {"stream_url": f"/api/stream/{file.id}/audio", "size": file.audio_variant_size, "cached": True}
        message = await get_message_from_channel(file.channel_message_id, file.storage_channel_id)
        if message is None:
            raise HTTPException(status_code=404, detail="فایل ویدیو در فضای ذخیره‌سازی پیدا نشد.")
        with tempfile.TemporaryDirectory(prefix="komod-audio-") as temporary:
            source = Path(temporary) / "source"
            output = Path(temporary) / "audio.m4a"
            downloaded = await telegram.tg_client.download_media(message, file_name=str(source))
            if not downloaded:
                raise HTTPException(status_code=502, detail="دریافت ویدیو برای ساخت نسخه صوتی انجام نشد.")
            process = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y", "-loglevel", "error", "-i", str(downloaded),
                "-vn", "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", str(output),
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
            )
            try:
                _, stderr = await asyncio.wait_for(process.communicate(), timeout=900)
            except asyncio.TimeoutError:
                process.kill(); await process.communicate()
                raise HTTPException(status_code=504, detail="ساخت نسخه صوتی بیش از حد طول کشید.")
            if process.returncode or not output.exists():
                logger.error("Audio variant ffmpeg failed: %s", stderr.decode("utf-8", "ignore")[-1000:])
                raise HTTPException(status_code=502, detail="ساخت نسخه کم‌حجم صدا انجام نشد.")
            target = file.storage_channel_id or current_user.storage_channel_id
            sent = await telegram.tg_client.send_audio(
                chat_id=target or settings.telegram_storage_channel_id,
                audio=str(output), title=f"صدای {Path(file.file_name).stem}"[:64],
            )
            media = sent.audio or sent.document
            if media is None:
                raise HTTPException(status_code=502, detail="ذخیره نسخه صوتی انجام نشد.")
            file.audio_variant_file_id = media.file_id
            file.audio_variant_unique_id = media.file_unique_id
            file.audio_variant_message_id = sent.id
            file.audio_variant_storage_channel_id = target or settings.telegram_storage_channel_id
            file.audio_variant_size = media.file_size or output.stat().st_size
            await db.commit()
        return {"stream_url": f"/api/stream/{file.id}/audio", "size": file.audio_variant_size, "cached": False}


@router.get("/{file_id}/audio")
async def stream_audio_variant(
    file_id: int, request: Request, db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    file = (await db.execute(select(File).where(
        File.id == file_id, File.user_id == current_user.id,
    ))).scalar_one_or_none()
    if file is None or not file.audio_variant_message_id or not file.audio_variant_size:
        raise HTTPException(status_code=404, detail="نسخه صوتی هنوز آماده نشده است.")
    if file.is_hidden:
        require_vault_access(request, current_user)
    message = await get_message_from_channel(file.audio_variant_message_id, file.audio_variant_storage_channel_id)
    if message is None:
        raise HTTPException(status_code=404, detail="نسخه صوتی پیدا نشد.")
    start, end = parse_range_header(request.headers.get("range"), file.audio_variant_size)
    if start >= file.audio_variant_size or end < start:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{file.audio_variant_size}"})
    async def audio_streamer():
        async for chunk in stream_file_generator(telegram.tg_client, message, start, end):
            yield chunk
    headers = {
        "Accept-Ranges": "bytes", "Content-Length": str(end - start + 1),
        "Cache-Control": "private, max-age=86400", "Content-Type": "audio/mp4",
    }
    if request.headers.get("range"):
        headers["Content-Range"] = f"bytes {start}-{end}/{file.audio_variant_size}"
    return StreamingResponse(audio_streamer(), status_code=206 if request.headers.get("range") else 200, media_type="audio/mp4", headers=headers)


@router.get("/{file_id}")
async def stream_file(
    file_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    download: int = Query(0, description="Set to 1 to force download"),
):
    """Stream file from Telegram with range request support for seeking."""
    # Get file from database
    result = await db.execute(
        select(File).where(File.id == file_id, File.user_id == current_user.id)
    )
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(status_code=404, detail="File not found")
    if file.is_hidden:
        require_vault_access(request, current_user)
    
    # Get message from channel
    message = await get_message_from_channel(file.channel_message_id, file.storage_channel_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found in channel")
    if file.file_type == "text" or message.photo:
        return await stored_message_response(file, message, request.headers.get("range"), download)

    media = message.video or message.audio or message.voice or message.document
    file_size = getattr(media, "file_size", None) or file.file_size
    range_header = request.headers.get("range")
    from_bytes, until_bytes = parse_range_header(range_header, file_size)
    if from_bytes >= file_size or from_bytes < 0 or until_bytes < from_bytes:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})
    req_length = until_bytes - from_bytes + 1
    if not any(getattr(client, "is_connected", False) for client in telegram.clients):
        raise HTTPException(status_code=503, detail="Telegram storage is temporarily unavailable")
    
    async def file_streamer():
        """Generator that streams file chunks from Telegram MTProto."""
        async for chunk in stream_file_generator(
            telegram.tg_client,
            message,
            from_bytes,
            until_bytes
        ):
            yield chunk
    
    # Determine content disposition
    mime_type = media_type_for(file)
    disposition = "attachment" if download else ("inline" if mime_type.startswith(("video/", "audio/", "image/", "text/")) else "attachment")
    
    from urllib.parse import quote
    encoded_filename = quote(file.file_name)
    
    headers = {
        "Content-Type": mime_type,
        "Content-Length": str(req_length),
        "Content-Disposition": f"{disposition}; filename*=utf-8''{encoded_filename}",
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-transform",
    }
    if range_header:
        headers["Content-Range"] = f"bytes {from_bytes}-{until_bytes}/{file_size}"
    
    return StreamingResponse(
        file_streamer(),
        status_code=206 if range_header else 200,
        media_type=mime_type,
        headers=headers
    )


@router.get("/{file_id}/thumbnail")
async def get_thumbnail(
    file_id: int,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get file thumbnail."""
    # Get file from database
    result = await db.execute(
        select(File).where(File.id == file_id, File.user_id == current_user.id)
    )
    file = result.scalar_one_or_none()
    
    if not file or not file.thumbnail_file_id:
        raise HTTPException(status_code=404, detail="Thumbnail not found")
    if file.is_hidden:
        require_vault_access(request, current_user)
    
    try:
        # Get the message and download thumbnail
        message = await get_message_from_channel(file.channel_message_id, file.storage_channel_id)
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")

        # Extract thumbnail object
        thumbnail = None
        if message.audio:
            audio_bytes = await telegram.tg_client.download_media(message, in_memory=True)
            embedded_cover = extract_embedded_cover(audio_bytes) if audio_bytes else None
            if embedded_cover:
                return Response(content=embedded_cover, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=604800, stale-while-revalidate=2592000"})
        if message.video and message.video.thumbs:
            thumbnail = select_best_thumbnail(message.video.thumbs)
        elif message.document and message.document.thumbs:
            thumbnail = select_best_thumbnail(message.document.thumbs)
        elif message.audio and message.audio.thumbs:
            thumbnail = select_best_thumbnail(message.audio.thumbs)
        elif message.photo:
            thumbnail = select_best_thumbnail(message.photo.sizes)
            
        if not thumbnail:
            # Try using the file_id directly if stored (fallback)
            if file.thumbnail_file_id:
                try:
                    thumb_bytes = await telegram.tg_client.download_media(file.thumbnail_file_id, in_memory=True)
                    return Response(content=thumb_bytes.getvalue(), media_type="image/jpeg")
                except Exception:
                    pass
            raise HTTPException(status_code=404, detail="Thumbnail not found in message")
        
        # Download thumbnail to memory
        thumb_bytes = await telegram.tg_client.download_media(thumbnail.file_id, in_memory=True)
        
        return Response(
            content=thumb_bytes.getvalue(),
            media_type="image/jpeg",
            headers={"Cache-Control": "private, max-age=604800, stale-while-revalidate=2592000"},
        )
    except Exception as e:
        # Log error internally, don't expose details to users
        logger.error(f"Thumbnail error for file {file_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get thumbnail")


async def _active_public_file(public_hash: str, db: AsyncSession) -> File:
    file = (await db.execute(select(File).where(File.public_hash == public_hash))).scalar_one_or_none()
    if not file:
        raise HTTPException(status_code=404, detail="این پیوند وجود ندارد یا لغو شده است.")
    if file.public_expires_at and file.public_expires_at <= datetime.utcnow():
        raise HTTPException(status_code=410, detail="زمان این پیوند به پایان رسیده است.")
    return file


@router.get("/s/{public_hash}/info")
@limiter.limit("60/minute")
async def public_share_info(public_hash: str, request: Request, db: AsyncSession = Depends(get_db)):
    file = await _active_public_file(public_hash, db)
    return {
        "file_name": file.file_name, "file_type": file.file_type, "file_size": file.file_size,
        "mime_type": media_type_for(file), "password_required": bool(file.public_password_hash),
        "allow_download": file.public_allow_download, "expires_at": file.public_expires_at,
        "view_limit": file.public_view_limit,
        "views_remaining": max(0, file.public_view_limit - file.public_view_count) if file.public_view_limit else None,
    }


@router.post("/s/{public_hash}/unlock")
@limiter.limit("10/minute")
async def unlock_public_share(public_hash: str, payload: PublicShareUnlock, request: Request, db: AsyncSession = Depends(get_db)):
    file = await _active_public_file(public_hash, db)
    if not file.public_password_hash:
        return {"access_token": create_public_share_token(public_hash)}
    try:
        valid = share_password_context.verify(payload.password, file.public_password_hash)
    except Exception:
        valid = False
    add_security_event(db, "public_link_unlocked" if valid else "public_link_password_failed", user_id=file.user_id, request=request, success=valid, suspicious=not valid, target_type="file", target_id=file.id)
    await db.commit()
    if not valid:
        raise HTTPException(status_code=401, detail="رمز پیوند درست نیست.")
    return {"access_token": create_public_share_token(public_hash)}


async def _register_public_view(file: File, request: Request, db: AsyncSession, download: bool) -> None:
    ip = request_ip(request)
    user_agent = request.headers.get("user-agent")
    recent = (await db.execute(select(SecurityEvent.id).where(
        SecurityEvent.event_type == "public_view",
        SecurityEvent.target_type == "file",
        SecurityEvent.target_id == str(file.id),
        SecurityEvent.ip_address == ip,
        SecurityEvent.user_agent == user_agent,
        SecurityEvent.created_at >= datetime.utcnow() - timedelta(hours=12),
    ).limit(1))).scalar_one_or_none()
    if recent is None:
        if file.public_view_limit and file.public_view_count >= file.public_view_limit:
            raise HTTPException(status_code=429, detail="سقف مشاهده این پیوند پر شده است.")
        file.public_view_count = int(file.public_view_count or 0) + 1
        add_security_event(db, "public_view", user_id=file.user_id, request=request, target_type="file", target_id=file.id, details={"download": download})
        await db.commit()


@router.get("/s/{public_hash}")
@limiter.limit("60/minute")  # Rate limit public streaming to prevent abuse
async def stream_public_file(
    public_hash: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    download: int = Query(0, description="Set to 1 to force download"),
    access_token: str | None = Query(default=None),
):
    """Stream file via public link (no auth required)."""
    # Get file by hash
    file = await _active_public_file(public_hash, db)
    if file.public_password_hash and not verify_public_share_token(access_token, public_hash):
        raise HTTPException(status_code=401, detail="این پیوند با رمز محافظت شده است.")
    if download and not file.public_allow_download:
        raise HTTPException(status_code=403, detail="دانلود برای این پیوند غیرفعال است.")
    await _register_public_view(file, request, db, bool(download))
        
    file_size = file.file_size
    
    # Parse range header
    range_header = request.headers.get("range")
    from_bytes, until_bytes = parse_range_header(range_header, file_size)
    
    # Validate range
    if (until_bytes > file_size) or (from_bytes < 0) or (until_bytes < from_bytes):
        return Response(
            status_code=416,
            content="416: Range not satisfiable",
            headers={"Content-Range": f"bytes */{file_size}"},
        )
    
    req_length = until_bytes - from_bytes + 1
    
    # Get message from channel
    message = await get_message_from_channel(file.channel_message_id, file.storage_channel_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found in channel")
    if file.file_type == "text" or message.photo:
        return await stored_message_response(file, message, range_header, download)
    
    async def file_streamer():
        """Generator that streams file chunks from Telegram MTProto."""
        async for chunk in stream_file_generator(
            telegram.tg_client,
            message,
            from_bytes,
            until_bytes
        ):
            yield chunk
    
    # Determine content disposition
    mime_type = media_type_for(file)
    disposition = "attachment" if download else ("inline" if mime_type.startswith(("video/", "audio/", "image/", "text/")) else "attachment")
    
    from urllib.parse import quote
    encoded_filename = quote(file.file_name)
    
    headers = {
        "Content-Type": mime_type,
        "Content-Length": str(req_length),
        "Content-Disposition": f"{disposition}; filename*=utf-8''{encoded_filename}",
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600, no-transform",
    }
    if range_header:
        headers["Content-Range"] = f"bytes {from_bytes}-{until_bytes}/{file_size}"
    
    return StreamingResponse(
        file_streamer(),
        status_code=206 if range_header else 200,
        media_type=mime_type,
        headers=headers
    )
