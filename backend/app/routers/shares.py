"""Public collection shares and temporary file links."""
from __future__ import annotations

import secrets
from types import SimpleNamespace
from datetime import datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import telegram
from ..auth import create_collection_file_token, create_private_file_link_token, create_public_share_token, get_current_user, verify_public_share_token, verify_token_payload
from ..database import get_db
from ..models import File, Folder, Pack, PackItem, Playlist, PlaylistItem, PublicCollectionShare, User
from ..schemas import PublicShareCreate, PublicShareUnlock
from ..streaming import stream_file as stream_file_generator
from ..telegram import get_message_from_channel
from .streaming import media_type_for, parse_range_header, playable_message_media, stored_message_response

router = APIRouter(prefix="/shares", tags=["Public shares"])
password_context = CryptContext(schemes=["pbkdf2_sha256"], pbkdf2_sha256__default_rounds=310_000, deprecated="auto")
RESOURCE_MODELS = {"folder": Folder, "pack": Pack, "playlist": Playlist}


async def _owned_resource(db: AsyncSession, kind: str, resource_id: int, user_id: int):
    model = RESOURCE_MODELS.get(kind)
    if model is None:
        raise HTTPException(404, "نوع پیوند شناخته‌شده نیست.")
    resource = (await db.execute(select(model).where(model.id == resource_id, model.user_id == user_id))).scalar_one_or_none()
    if resource is None:
        raise HTTPException(404, "مورد موردنظر پیدا نشد.")
    return resource


async def _active_share(db: AsyncSession, public_hash: str, enforce_view_limit: bool = True) -> PublicCollectionShare:
    share = (await db.execute(select(PublicCollectionShare).where(PublicCollectionShare.public_hash == public_hash))).scalar_one_or_none()
    if share is None:
        raise HTTPException(404, "این پیوند وجود ندارد یا لغو شده است.")
    if share.expires_at and share.expires_at <= datetime.utcnow():
        raise HTTPException(410, "زمان این پیوند به پایان رسیده است.")
    if enforce_view_limit and share.view_limit and share.view_count >= share.view_limit:
        raise HTTPException(429, "سقف مشاهده این پیوند پر شده است.")
    return share


async def _folder_ids(db: AsyncSession, root_id: int, owner_id: int) -> set[int]:
    result, frontier = {root_id}, [root_id]
    while frontier:
        children = (await db.execute(select(Folder.id).where(Folder.user_id == owner_id, Folder.parent_id.in_(frontier)))).scalars().all()
        frontier = [item for item in children if item not in result]
        result.update(frontier)
    return result


async def _share_files(db: AsyncSession, share: PublicCollectionShare) -> list[File]:
    if share.resource_type == "folder":
        ids = await _folder_ids(db, share.resource_id, share.owner_user_id)
        query = select(File).where(File.user_id == share.owner_user_id, File.folder_id.in_(ids), File.is_hidden.is_(False)).order_by(File.created_at.desc())
    elif share.resource_type == "pack":
        query = select(File).join(PackItem, PackItem.file_id == File.id).where(PackItem.pack_id == share.resource_id, File.user_id == share.owner_user_id, File.is_hidden.is_(False)).order_by(PackItem.position, PackItem.id)
    elif share.resource_type == "playlist":
        query = select(File).join(PlaylistItem, PlaylistItem.file_id == File.id).where(PlaylistItem.playlist_id == share.resource_id, File.user_id == share.owner_user_id, File.is_hidden.is_(False)).order_by(PlaylistItem.position, PlaylistItem.id)
    else:
        return []
    return list((await db.execute(query)).scalars().unique().all())


@router.post("/{kind}/{resource_id}")
async def create_collection_share(kind: str, resource_id: int, payload: PublicShareCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    await _owned_resource(db, kind, resource_id, current_user.id)
    existing = (await db.execute(select(PublicCollectionShare).where(PublicCollectionShare.owner_user_id == current_user.id, PublicCollectionShare.resource_type == kind, PublicCollectionShare.resource_id == resource_id))).scalar_one_or_none()
    share = existing or PublicCollectionShare(owner_user_id=current_user.id, resource_type=kind, resource_id=resource_id, public_hash=secrets.token_hex(16))
    share.public_hash = secrets.token_hex(16)
    share.expires_at = datetime.utcnow() + timedelta(hours=payload.expires_in_hours) if payload.expires_in_hours else None
    share.password_hash = password_context.hash(payload.password) if payload.password else None
    share.allow_download, share.view_limit, share.view_count = payload.allow_download, payload.view_limit, 0
    db.add(share)
    await db.commit()
    return {"public_hash": share.public_hash, "url": f"/s/{share.public_hash}"}


@router.delete("/{kind}/{resource_id}")
async def revoke_collection_share(kind: str, resource_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    share = (await db.execute(select(PublicCollectionShare).where(PublicCollectionShare.owner_user_id == current_user.id, PublicCollectionShare.resource_type == kind, PublicCollectionShare.resource_id == resource_id))).scalar_one_or_none()
    if share:
        await db.delete(share)
        await db.commit()
    return {"revoked": bool(share)}


@router.post("/file/{file_id}/private-links")
async def private_file_links(file_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    file = (await db.execute(select(File).where(File.id == file_id, File.user_id == current_user.id, File.is_hidden.is_(False)))).scalar_one_or_none()
    if file is None:
        raise HTTPException(404, "فایل پیدا نشد.")
    play, download = create_private_file_link_token(current_user.id, file.id), create_private_file_link_token(current_user.id, file.id, True)
    return {"play_url": f"/api/shares/file-link/{play}", "download_url": f"/api/shares/file-link/{download}"}


@router.get("/public/{public_hash}")
async def public_collection_info(public_hash: str, access_token: str | None = None, db: AsyncSession = Depends(get_db)):
    share = await _active_share(db, public_hash)
    resource = await _owned_resource(db, share.resource_type, share.resource_id, share.owner_user_id)
    unlocked = not share.password_hash or verify_public_share_token(access_token, public_hash)
    response = {"resource_type": share.resource_type, "title": resource.name, "password_required": bool(share.password_hash), "unlocked": unlocked, "allow_download": share.allow_download, "expires_at": share.expires_at, "view_limit": share.view_limit, "views_remaining": max(0, share.view_limit-share.view_count) if share.view_limit else None, "items": []}
    if unlocked:
        files = await _share_files(db, share)
        response["items"] = [{"id": f.id, "file_name": f.file_name, "file_type": f.file_type, "file_size": f.file_size, "mime_type": media_type_for(f), "duration": f.duration, "stream_url": f"/api/shares/collection-file/{create_collection_file_token(public_hash, f.id)}"} for f in files]
        share.view_count += 1
        await db.commit()
    return response


@router.post("/public/{public_hash}/unlock")
async def unlock_collection(public_hash: str, payload: PublicShareUnlock, db: AsyncSession = Depends(get_db)):
    share = await _active_share(db, public_hash)
    if share.password_hash and not password_context.verify(payload.password, share.password_hash):
        raise HTTPException(401, "رمز پیوند درست نیست.")
    return {"access_token": create_public_share_token(public_hash)}


async def _stream_message(file, message, request: Request, download: bool):
    range_header = request.headers.get("range")
    if file.file_type == "text" or message.photo:
        return await stored_message_response(file, message, range_header, int(download))
    media = playable_message_media(message)
    if media is None:
        raise HTTPException(422, "این پیام فایل قابل پخشی ندارد.")
    size = getattr(media, "file_size", None) or getattr(file, "file_size", None)
    if not size:
        raise HTTPException(422, "اندازه فایل از تلگرام دریافت نشد؛ کمی بعد دوباره تلاش کن.")
    start, end = parse_range_header(range_header, size)
    if start >= size or start < 0 or end < start:
        raise HTTPException(416, "بازه فایل معتبر نیست.")
    async def chunks():
        async for chunk in stream_file_generator(telegram.tg_client, message, start, end):
            yield chunk
    headers = {"Content-Length": str(end-start+1), "Content-Disposition": f"{'attachment' if download else 'inline'}; filename*=utf-8''{quote(file.file_name)}", "Accept-Ranges": "bytes", "Cache-Control": "private, no-store, no-transform"}
    if range_header:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    return StreamingResponse(chunks(), status_code=206 if range_header else 200, media_type=media_type_for(file), headers=headers)


async def _stream_record(file: File, request: Request, download: bool):
    message = await get_message_from_channel(file.channel_message_id, file.storage_channel_id)
    if not message:
        raise HTTPException(404, "فایل در فضای ذخیره‌سازی پیدا نشد.")
    return await _stream_message(file, message, request, download)


@router.get("/file-link/{token}")
async def stream_private_link(token: str, request: Request, db: AsyncSession = Depends(get_db)):
    payload = verify_token_payload(token, "private-file-link")
    if not payload:
        raise HTTPException(401, "این پیوند موقت منقضی شده یا معتبر نیست.")
    file = (await db.execute(select(File).where(File.id == int(payload["fid"]), File.user_id == int(payload["sub"]), File.is_hidden.is_(False)))).scalar_one_or_none()
    if file is None:
        raise HTTPException(404, "فایل پیدا نشد.")
    return await _stream_record(file, request, bool(payload.get("download")))


@router.get("/message-link/{token}")
async def stream_telegram_message_link(token: str, request: Request):
    payload = verify_token_payload(token, "telegram-message-link")
    if not payload:
        raise HTTPException(401, "این پیوند موقت منقضی شده یا معتبر نیست.")
    try:
        message = await telegram.tg_client.get_messages(int(payload["sub"]), int(payload["mid"]))
    except Exception as error:
        raise HTTPException(404, "پیام اصلی در تلگرام در دسترس نیست.") from error
    if not message or getattr(message, "empty", False):
        raise HTTPException(404, "پیام اصلی حذف شده یا دیگر در دسترس نیست.")
    descriptor = SimpleNamespace(
        file_name=str(payload.get("name") or f"telegram-{payload['mid']}"),
        mime_type=str(payload.get("mime") or "") or None,
        file_type=str(payload.get("kind") or "document"),
        file_size=int(payload.get("size") or 0),
    )
    return await _stream_message(descriptor, message, request, bool(payload.get("download")))


@router.get("/collection-file/{token}")
async def stream_collection_file(token: str, request: Request, download: int = Query(0), db: AsyncSession = Depends(get_db)):
    payload = verify_token_payload(token, "collection-file")
    if not payload:
        raise HTTPException(401, "پیوند فایل منقضی شده است؛ صفحه را دوباره باز کن.")
    # The page view was counted when these signed item URLs were issued. Every
    # range request must remain usable afterwards, even when that view filled
    # the configured limit.
    share = await _active_share(db, str(payload["sub"]), enforce_view_limit=False)
    if download and not share.allow_download:
        raise HTTPException(403, "دانلود برای این پیوند غیرفعال است.")
    file = next((f for f in await _share_files(db, share) if f.id == int(payload["fid"])), None)
    if file is None:
        raise HTTPException(404, "این فایل دیگر داخل مجموعه نیست.")
    return await _stream_record(file, request, bool(download))
