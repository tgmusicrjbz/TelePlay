"""
Streaming API endpoints for media playback.
"""
import re
import logging
import mimetypes
from fastapi import APIRouter, Depends, HTTPException, Request, Response, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..database import get_db
from ..models import File, User
from ..auth import get_current_user
from .. import telegram
from ..telegram import get_message_from_channel
from ..streaming import stream_file as stream_file_generator
from ..services import select_best_thumbnail

# Logger for internal debugging (not exposed to users)
logger = logging.getLogger(__name__)

# Rate limiter for public endpoints
limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/stream", tags=["Streaming"])


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
    if file.file_type == "text":
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
    
    # Get message from channel
    message = await get_message_from_channel(file.channel_message_id)
    if not message:
        raise HTTPException(status_code=404, detail="Message not found in channel")
    if file.file_type == "text" or message.photo:
        return await stored_message_response(file, message, request.headers.get("range"), download)

    media = message.video or message.audio or message.document
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
    
    try:
        # Get the message and download thumbnail
        message = await get_message_from_channel(file.channel_message_id)
        if not message:
            raise HTTPException(status_code=404, detail="Message not found")

        # Extract thumbnail object
        thumbnail = None
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
            headers={"Cache-Control": "private, no-cache"},
        )
    except Exception as e:
        # Log error internally, don't expose details to users
        logger.error(f"Thumbnail error for file {file_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to get thumbnail")


@router.get("/s/{public_hash}")
@limiter.limit("60/minute")  # Rate limit public streaming to prevent abuse
async def stream_public_file(
    public_hash: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    download: int = Query(0, description="Set to 1 to force download"),
):
    """Stream file via public link (no auth required)."""
    # Get file by hash
    result = await db.execute(select(File).where(File.public_hash == public_hash))
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(status_code=404, detail="File not found or link revoked")
        
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
    message = await get_message_from_channel(file.channel_message_id)
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
