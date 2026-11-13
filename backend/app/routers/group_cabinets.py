"""Authenticated Mini App API for connected Telegram group cabinets."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..database import get_db
from ..models import File, GroupCabinet, GroupCabinetItem, GroupCabinetMember, Playlist, PlaylistItem, User
from ..auth import get_current_user

router = APIRouter(prefix="/group-cabinets", tags=["Group cabinets"])


class GroupCabinetItemsCreate(BaseModel):
    file_ids: list[int] = Field(min_length=1, max_length=100)


class GroupCabinetMemberUpdate(BaseModel):
    user_id: int
    role: str = Field(pattern="^(viewer|editor)$")


async def _access(db: AsyncSession, chat_id: int, user: User) -> tuple[GroupCabinet, GroupCabinetMember]:
    cabinet = (await db.execute(select(GroupCabinet).where(GroupCabinet.chat_id == chat_id))).scalar_one_or_none()
    if cabinet is None or not cabinet.enabled:
        raise HTTPException(status_code=404, detail="کمد گروه پیدا نشد یا غیرفعال است.")
    member = (await db.execute(select(GroupCabinetMember).where(
        GroupCabinetMember.cabinet_id == cabinet.id,
        GroupCabinetMember.user_id == user.id,
    ))).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=403, detail="این حساب عضو کمد گروه نیست.")
    return cabinet, member


def _file_payload(file: File) -> dict:
    return {
        "id": file.id,
        "user_id": file.user_id,
        "folder_id": file.folder_id,
        "name": file.file_name,
        "file_id": file.file_id,
        "file_unique_id": file.file_unique_id,
        "description": file.description,
        "file_type": file.file_type,
        "mime_type": file.mime_type,
        "size": file.file_size,
        "file_size": file.file_size,
        "duration": file.duration,
        "width": file.width,
        "height": file.height,
        "created_at": file.created_at,
        "updated_at": file.updated_at,
        "is_hidden": file.is_hidden,
        "thumbnail_url": f"/api/stream/{file.id}/thumbnail?quality=best&workspace={file.user_id}" if file.thumbnail_file_id else None,
        "stream_url": f"/api/stream/{file.id}?workspace={file.user_id}",
    }


@router.get("/{chat_id}")
async def get_group_cabinet(
    chat_id: int,
    search: str = Query(default="", max_length=120),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cabinet, member = await _access(db, chat_id, current_user)
    items = (await db.execute(select(GroupCabinetItem).where(
        GroupCabinetItem.cabinet_id == cabinet.id,
    ).options(selectinload(GroupCabinetItem.file)).order_by(GroupCabinetItem.created_at.desc(), GroupCabinetItem.id.desc()))).scalars().all()
    needle = search.strip().casefold()
    if needle:
        items = [item for item in items if needle in item.file.file_name.casefold() or needle in (item.file.description or "").casefold()]
    playlists = (await db.execute(select(Playlist).where(Playlist.group_chat_id == chat_id).options(selectinload(Playlist.items)))).scalars().all()
    return {
        "chat_id": chat_id,
        "title": cabinet.title,
        "role": member.role,
        "can_edit": member.role in {"owner", "editor"},
        "files": [_file_payload(item.file) for item in items],
        "playlists": [{
            "id": playlist.id,
            "name": playlist.name,
            "item_count": len(playlist.items),
            "file_ids": [item.file_id for item in sorted(playlist.items, key=lambda row: (row.position, row.id))],
        } for playlist in playlists],
    }


@router.post("/{chat_id}/items")
async def add_group_cabinet_items(
    chat_id: int,
    payload: GroupCabinetItemsCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cabinet, member = await _access(db, chat_id, current_user)
    if member.role not in {"owner", "editor"}:
        raise HTTPException(status_code=403, detail="برای افزودن از مینی‌اپ، نقش ویرایشگر لازم است.")
    files = (await db.execute(select(File).where(
        File.id.in_(set(payload.file_ids)), File.user_id == current_user.id, File.is_hidden.is_(False),
    ))).scalars().all()
    existing = set((await db.execute(select(GroupCabinetItem.file_id).where(GroupCabinetItem.cabinet_id == cabinet.id))).scalars().all())
    added = 0
    for file in files:
        if file.id not in existing:
            db.add(GroupCabinetItem(cabinet_id=cabinet.id, file_id=file.id, added_by_user_id=current_user.id))
            added += 1
    await db.commit()
    return {"added": added}


@router.delete("/{chat_id}/items/{file_id}")
async def remove_group_cabinet_item(
    chat_id: int,
    file_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cabinet, member = await _access(db, chat_id, current_user)
    if member.role not in {"owner", "editor"}:
        raise HTTPException(status_code=403, detail="برای حذف از مینی‌اپ، نقش ویرایشگر لازم است.")
    await db.execute(delete(GroupCabinetItem).where(GroupCabinetItem.cabinet_id == cabinet.id, GroupCabinetItem.file_id == file_id))
    await db.commit()
    return {"removed": True}


@router.patch("/{chat_id}/members")
async def update_group_cabinet_member(
    chat_id: int,
    payload: GroupCabinetMemberUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cabinet, member = await _access(db, chat_id, current_user)
    if member.role != "owner":
        raise HTTPException(status_code=403, detail="فقط صاحب کمد گروه می‌تواند نقش‌ها را تغییر دهد.")
    target_user = (await db.execute(select(User).where(User.id == payload.user_id))).scalar_one_or_none()
    if target_user is None:
        raise HTTPException(status_code=404, detail="کاربر پیدا نشد.")
    target = (await db.execute(select(GroupCabinetMember).where(
        GroupCabinetMember.cabinet_id == cabinet.id,
        GroupCabinetMember.user_id == target_user.id,
    ))).scalar_one_or_none()
    if target is None:
        target = GroupCabinetMember(cabinet_id=cabinet.id, user_id=target_user.id, role=payload.role)
        db.add(target)
    else:
        target.role = payload.role
    await db.commit()
    return {"user_id": target_user.id, "role": target.role}


@router.get("/{chat_id}/members")
async def list_group_cabinet_members(
    chat_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cabinet, member = await _access(db, chat_id, current_user)
    if member.role not in {"owner", "editor"}:
        raise HTTPException(status_code=403, detail="فقط مدیرها و ویرایشگرهای کمد می‌توانند اعضا را ببینند.")
    rows = (await db.execute(select(GroupCabinetMember, User).join(User, User.id == GroupCabinetMember.user_id).where(
        GroupCabinetMember.cabinet_id == cabinet.id,
    ).order_by(GroupCabinetMember.role, User.display_name, User.id))).all()
    return [{
        "user_id": cabinet_member.user_id,
        "telegram_id": user.telegram_id,
        "name": user.display_name or " ".join(part for part in (user.first_name, user.last_name) if part) or str(user.telegram_id),
        "role": cabinet_member.role,
    } for cabinet_member, user in rows]
