"""Playlist API shared by the web app and Telegram bot."""
import random

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import get_current_user
from ..database import get_db
from ..models import File, Playlist, PlaylistItem, User
from ..schemas import (
    FileResponse, PlaylistAddItems, PlaylistCreate, PlaylistItemResponse,
    PlaylistReorder, PlaylistResponse, PlaylistSummary, PlaylistUpdate,
)
from ..services import add_urls_to_file

router = APIRouter(prefix="/playlists", tags=["Playlists"])


def _file_response(file: File) -> FileResponse:
    return FileResponse(**add_urls_to_file(file))


def _playlist_response(playlist: Playlist) -> PlaylistResponse:
    ordered = sorted(playlist.items, key=lambda item: (item.position, item.id))
    covers = [f"/api/stream/{item.file.id}/thumbnail" for item in ordered if item.file.thumbnail_file_id][:4]
    cover_url = f"/api/stream/{playlist.cover_file_id}" if playlist.cover_file_id else (covers[0] if covers else None)
    return PlaylistResponse(
        id=playlist.id,
        name=playlist.name,
        description=playlist.description,
        item_count=len(ordered),
        total_duration=sum(item.file.duration or 0 for item in ordered),
        cover_url=cover_url,
        cover_file_id=playlist.cover_file_id,
        cover_urls=([cover_url] + covers)[:4] if cover_url else covers,
        audio_count=sum(item.file.file_type == "audio" for item in ordered),
        video_count=sum(item.file.file_type == "video" for item in ordered),
        preview_names=[item.file.file_name for item in ordered[:2]],
        created_at=playlist.created_at,
        updated_at=playlist.updated_at,
        items=[PlaylistItemResponse(id=item.id, position=index, added_at=item.added_at, file=_file_response(item.file)) for index, item in enumerate(ordered)],
    )


async def _owned_playlist(db: AsyncSession, playlist_id: int, user_id: int) -> Playlist:
    playlist = (await db.execute(
        select(Playlist)
        .where(Playlist.id == playlist_id, Playlist.user_id == user_id)
        .options(selectinload(Playlist.items).selectinload(PlaylistItem.file).selectinload(File.watch_progress), selectinload(Playlist.cover_file))
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if playlist is None:
        raise HTTPException(status_code=404, detail="Playlist not found")
    return playlist


@router.get("", response_model=list[PlaylistSummary])
async def list_playlists(db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    playlists = (await db.execute(
        select(Playlist)
        .where(Playlist.user_id == current_user.id)
        .options(selectinload(Playlist.items).selectinload(PlaylistItem.file).selectinload(File.watch_progress), selectinload(Playlist.cover_file))
        .order_by(Playlist.updated_at.desc(), Playlist.id.desc())
    )).scalars().unique().all()
    return [PlaylistSummary(**_playlist_response(playlist).model_dump(exclude={"items"})) for playlist in playlists]


@router.post("", response_model=PlaylistResponse, status_code=201)
async def create_playlist(payload: PlaylistCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Playlist name is required")
    duplicate = (await db.execute(select(Playlist.id).where(Playlist.user_id == current_user.id, func.lower(Playlist.name) == name.lower()))).scalar_one_or_none()
    if duplicate:
        raise HTTPException(status_code=409, detail="A playlist with this name already exists")
    playlist = Playlist(user_id=current_user.id, name=name, description=(payload.description or "").strip() or None)
    db.add(playlist)
    await db.commit()
    return _playlist_response(await _owned_playlist(db, playlist.id, current_user.id))


@router.get("/{playlist_id}", response_model=PlaylistResponse)
async def get_playlist(playlist_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _playlist_response(await _owned_playlist(db, playlist_id, current_user.id))


@router.patch("/{playlist_id}", response_model=PlaylistResponse)
async def update_playlist(playlist_id: int, payload: PlaylistUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    playlist = await _owned_playlist(db, playlist_id, current_user.id)
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        name = (changes["name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Playlist name is required")
        duplicate = (await db.execute(select(Playlist.id).where(Playlist.user_id == current_user.id, func.lower(Playlist.name) == name.lower(), Playlist.id != playlist_id))).scalar_one_or_none()
        if duplicate:
            raise HTTPException(status_code=409, detail="A playlist with this name already exists")
        playlist.name = name
    if "description" in changes:
        playlist.description = (changes["description"] or "").strip() or None
    if "cover_file_id" in changes:
        cover_id = changes["cover_file_id"]
        if cover_id is not None:
            cover = (await db.execute(select(File).where(File.id == cover_id, File.user_id == current_user.id, File.file_type == "image"))).scalar_one_or_none()
            if cover is None:
                raise HTTPException(status_code=400, detail="Cover must be one of your image files")
        playlist.cover_file_id = cover_id
    await db.commit()
    return _playlist_response(await _owned_playlist(db, playlist_id, current_user.id))


@router.delete("/{playlist_id}", status_code=204)
async def delete_playlist(playlist_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    playlist = await _owned_playlist(db, playlist_id, current_user.id)
    await db.delete(playlist)
    await db.commit()
    return Response(status_code=204)


@router.post("/{playlist_id}/items", response_model=PlaylistResponse)
async def add_playlist_items(playlist_id: int, payload: PlaylistAddItems, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    playlist = await _owned_playlist(db, playlist_id, current_user.id)
    requested_ids = payload.file_ids if payload.allow_duplicates else list(dict.fromkeys(payload.file_ids))
    unique_ids = list(dict.fromkeys(requested_ids))
    files = (await db.execute(select(File).where(File.user_id == current_user.id, File.id.in_(unique_ids), File.file_type.in_(("audio", "video"))))).scalars().all()
    found = {file.id for file in files}
    if found != set(unique_ids):
        raise HTTPException(status_code=400, detail="Only owned audio and video files can be added")
    existing = {item.file_id for item in playlist.items}
    position = max((item.position for item in playlist.items), default=-1) + 1
    for file_id in requested_ids:
        if payload.allow_duplicates or file_id not in existing:
            db.add(PlaylistItem(playlist_id=playlist.id, file_id=file_id, position=position))
            position += 1
    await db.commit()
    return _playlist_response(await _owned_playlist(db, playlist_id, current_user.id))


@router.delete("/{playlist_id}/items/{file_id}", response_model=PlaylistResponse)
async def remove_playlist_item(playlist_id: int, file_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    playlist = await _owned_playlist(db, playlist_id, current_user.id)
    if file_id not in {item.file_id for item in playlist.items}:
        raise HTTPException(status_code=404, detail="Playlist item not found")
    await db.execute(delete(PlaylistItem).where(PlaylistItem.playlist_id == playlist.id, PlaylistItem.file_id == file_id))
    await db.flush()
    await _normalize_positions(db, playlist.id)
    await db.commit()
    return _playlist_response(await _owned_playlist(db, playlist_id, current_user.id))


async def _normalize_positions(db: AsyncSession, playlist_id: int, file_ids: list[int] | None = None):
    if file_ids is None:
        items = (await db.execute(select(PlaylistItem).where(PlaylistItem.playlist_id == playlist_id).order_by(PlaylistItem.position, PlaylistItem.id))).scalars().all()
    else:
        items_by_file = {item.file_id: item for item in (await db.execute(select(PlaylistItem).where(PlaylistItem.playlist_id == playlist_id))).scalars().all()}
        items = [items_by_file[file_id] for file_id in file_ids]
    for position, item in enumerate(items):
        item.position = position


async def _normalize_item_positions(db: AsyncSession, playlist_id: int, item_ids: list[int]):
    items_by_id = {item.id: item for item in (await db.execute(select(PlaylistItem).where(PlaylistItem.playlist_id == playlist_id))).scalars().all()}
    for position, item_id in enumerate(item_ids):
        items_by_id[item_id].position = position


@router.put("/{playlist_id}/reorder", response_model=PlaylistResponse)
async def reorder_playlist(playlist_id: int, payload: PlaylistReorder, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    playlist = await _owned_playlist(db, playlist_id, current_user.id)
    if payload.item_ids is not None:
        current_ids = [item.id for item in playlist.items]
        if len(payload.item_ids) != len(set(payload.item_ids)) or set(payload.item_ids) != set(current_ids):
            raise HTTPException(status_code=400, detail="Reorder must include every playlist item exactly once")
        await _normalize_item_positions(db, playlist.id, payload.item_ids)
    elif payload.file_ids is not None:
        current_ids = [item.file_id for item in playlist.items]
        if len(payload.file_ids) != len(set(payload.file_ids)) or set(payload.file_ids) != set(current_ids):
            raise HTTPException(status_code=400, detail="Reorder must include every playlist file exactly once")
        await _normalize_positions(db, playlist.id, payload.file_ids)
    else:
        raise HTTPException(status_code=400, detail="No playlist order supplied")
    await db.commit()
    return _playlist_response(await _owned_playlist(db, playlist_id, current_user.id))


@router.delete("/{playlist_id}/items/item/{item_id}", response_model=PlaylistResponse)
async def remove_playlist_item_by_id(playlist_id: int, item_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    playlist = await _owned_playlist(db, playlist_id, current_user.id)
    item = next((candidate for candidate in playlist.items if candidate.id == item_id), None)
    if item is None:
        raise HTTPException(status_code=404, detail="Playlist item not found")
    await db.delete(item)
    await db.flush()
    await _normalize_positions(db, playlist.id)
    await db.commit()
    return _playlist_response(await _owned_playlist(db, playlist_id, current_user.id))


@router.post("/{playlist_id}/shuffle", response_model=PlaylistResponse)
async def shuffle_playlist(playlist_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    playlist = await _owned_playlist(db, playlist_id, current_user.id)
    file_ids = [item.file_id for item in playlist.items]
    random.shuffle(file_ids)
    if file_ids:
        await _normalize_positions(db, playlist.id, file_ids)
        await db.commit()
    return _playlist_response(await _owned_playlist(db, playlist_id, current_user.id))
