"""Mixed-media packs shown beside folders in the Komod library."""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import get_current_user
from ..database import get_db
from ..models import File, Folder, Pack, PackItem, User
from ..schemas import (
    FileResponse, PackAddItems, PackCreate, PackItemResponse, PackReorder,
    PackResponse, PackSummary, PackUpdate,
)
from ..services import add_urls_to_file


def _reject_shared_workspace(request: Request) -> None:
    if request.headers.get("X-Workspace-User") or request.query_params.get("workspace"):
        raise HTTPException(status_code=403, detail="پک‌ها فعلاً فقط در کمد شخصی قابل مدیریت هستند.")


router = APIRouter(prefix="/packs", tags=["Packs"], dependencies=[Depends(_reject_shared_workspace)])


def _file_response(file: File) -> FileResponse:
    return FileResponse(**add_urls_to_file(file))


def _pack_summary(pack: Pack) -> PackSummary:
    ordered = sorted((item for item in pack.items if not item.file.is_hidden), key=lambda item: (item.position, item.id))
    visual = [item.file for item in ordered if item.file.file_type in ("image", "video") and item.file.thumbnail_file_id]
    previews = [f"/api/stream/{file.id}/thumbnail?quality=best&workspace={pack.user_id}" for file in visual[:4]]
    custom_cover_id = pack.cover_file_id if pack.cover_file and not pack.cover_file.is_hidden else None
    if custom_cover_id:
        cover_path = f"/api/stream/{custom_cover_id}/thumbnail?quality=best" if pack.cover_file.thumbnail_file_id else f"/api/stream/{custom_cover_id}"
        cover_url = f"{cover_path}{'&' if '?' in cover_path else '?'}workspace={pack.user_id}"
    else:
        cover_url = previews[0] if previews else None
    counts: dict[str, int] = {}
    for item in ordered:
        counts[item.file.file_type] = counts.get(item.file.file_type, 0) + 1
    return PackSummary(
        id=pack.id, name=pack.name, description=pack.description,
        parent_folder_id=pack.parent_folder_id, item_count=len(ordered),
        cover_file_id=custom_cover_id, cover_position_x=pack.cover_position_x, cover_position_y=pack.cover_position_y,
        cover_zoom=pack.cover_zoom, hide_member_files=pack.hide_member_files, is_blurred=pack.is_blurred, cover_url=cover_url,
        cover_urls=([cover_url] + previews)[:4] if cover_url else previews,
        preview_names=[item.file.file_name for item in ordered[:2]],
        type_counts=counts, position=pack.position,
        created_at=pack.created_at, updated_at=pack.updated_at,
    )


def _pack_response(pack: Pack) -> PackResponse:
    ordered = sorted((item for item in pack.items if not item.file.is_hidden), key=lambda item: (item.position, item.id))
    return PackResponse(
        **_pack_summary(pack).model_dump(),
        items=[PackItemResponse(
            id=item.id, position=index, caption=item.caption, added_at=item.added_at,
            file=_file_response(item.file),
        ) for index, item in enumerate(ordered)],
    )


async def _owned_pack(db: AsyncSession, pack_id: int, user_id: int) -> Pack:
    pack = (await db.execute(
        select(Pack).where(Pack.id == pack_id, Pack.user_id == user_id).options(
            selectinload(Pack.items).selectinload(PackItem.file).selectinload(File.watch_progress),
            selectinload(Pack.cover_file),
        ).execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if pack is None:
        raise HTTPException(status_code=404, detail="پک پیدا نشد")
    return pack


async def _validate_folder(db: AsyncSession, user_id: int, folder_id: int | None) -> None:
    if folder_id is None:
        return
    if (await db.execute(select(Folder.id).where(Folder.id == folder_id, Folder.user_id == user_id))).scalar_one_or_none() is None:
        raise HTTPException(status_code=400, detail="کشوی مقصد پیدا نشد")


async def _owned_files(db: AsyncSession, user_id: int, file_ids: list[int]) -> list[File]:
    unique_ids = list(dict.fromkeys(file_ids))
    if not unique_ids:
        return []
    files = (await db.execute(select(File).where(
        File.user_id == user_id, File.id.in_(unique_ids), File.is_hidden.is_(False)
    ))).scalars().all()
    by_id = {file.id: file for file in files}
    if set(by_id) != set(unique_ids):
        raise HTTPException(status_code=400, detail="یکی از فایل‌ها پیدا نشد یا قابل افزودن نیست")
    return [by_id[file_id] for file_id in unique_ids]


@router.get("", response_model=list[PackSummary])
async def list_packs(
    parent_folder_id: int | None = Query(default=None),
    all_folders: bool = Query(default=False),
    db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user),
):
    condition = True if all_folders else (Pack.parent_folder_id.is_(None) if parent_folder_id is None else Pack.parent_folder_id == parent_folder_id)
    packs = (await db.execute(
        select(Pack).where(Pack.user_id == current_user.id, condition).options(
            selectinload(Pack.items).selectinload(PackItem.file),
            selectinload(Pack.cover_file),
        ).order_by(Pack.position, Pack.updated_at.desc())
    )).scalars().unique().all()
    return [_pack_summary(pack) for pack in packs]


@router.post("", response_model=PackResponse, status_code=201)
async def create_pack(payload: PackCreate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="نام پک را وارد کن")
    await _validate_folder(db, current_user.id, payload.parent_folder_id)
    files = await _owned_files(db, current_user.id, payload.file_ids)
    last_position = (await db.execute(select(func.coalesce(func.max(Pack.position), -1)).where(
        Pack.user_id == current_user.id,
        Pack.parent_folder_id == payload.parent_folder_id if payload.parent_folder_id is not None else Pack.parent_folder_id.is_(None),
    ))).scalar_one()
    pack = Pack(user_id=current_user.id, parent_folder_id=payload.parent_folder_id, name=name,
                description=(payload.description or "").strip() or None,
                hide_member_files=payload.hide_member_files, position=last_position + 1)
    db.add(pack); await db.flush()
    for position, file in enumerate(files):
        db.add(PackItem(pack_id=pack.id, file_id=file.id, position=position))
    await db.commit()
    return _pack_response(await _owned_pack(db, pack.id, current_user.id))


@router.get("/{pack_id}", response_model=PackResponse)
async def get_pack(pack_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _pack_response(await _owned_pack(db, pack_id, current_user.id))


@router.patch("/{pack_id}", response_model=PackResponse)
async def update_pack(pack_id: int, payload: PackUpdate, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    pack = await _owned_pack(db, pack_id, current_user.id)
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes:
        name = (changes["name"] or "").strip()
        if not name: raise HTTPException(status_code=400, detail="نام پک را وارد کن")
        pack.name = name
    if "description" in changes: pack.description = (changes["description"] or "").strip() or None
    if "hide_member_files" in changes: pack.hide_member_files = bool(changes["hide_member_files"])
    if "is_blurred" in changes: pack.is_blurred = bool(changes["is_blurred"])
    if "parent_folder_id" in changes:
        await _validate_folder(db, current_user.id, changes["parent_folder_id"])
        pack.parent_folder_id = changes["parent_folder_id"]
    if "cover_file_id" in changes:
        cover_id = changes["cover_file_id"]
        if cover_id is not None:
            cover = (await db.execute(select(File).where(File.id == cover_id, File.user_id == current_user.id, File.file_type == "image"))).scalar_one_or_none()
            if cover is None: raise HTTPException(status_code=400, detail="کاور باید یکی از عکس‌های کمد باشد")
        pack.cover_file_id = cover_id
    if "cover_position_x" in changes and changes["cover_position_x"] is not None:
        pack.cover_position_x = changes["cover_position_x"]
    if "cover_position_y" in changes and changes["cover_position_y"] is not None:
        pack.cover_position_y = changes["cover_position_y"]
    if "cover_zoom" in changes and changes["cover_zoom"] is not None:
        pack.cover_zoom = changes["cover_zoom"]
    await db.commit()
    return _pack_response(await _owned_pack(db, pack_id, current_user.id))


@router.delete("/{pack_id}", status_code=204)
async def delete_pack(pack_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    pack = await _owned_pack(db, pack_id, current_user.id)
    await db.delete(pack); await db.commit()
    return Response(status_code=204)


@router.post("/{pack_id}/items", response_model=PackResponse)
async def add_pack_items(pack_id: int, payload: PackAddItems, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    pack = await _owned_pack(db, pack_id, current_user.id)
    files = await _owned_files(db, current_user.id, payload.file_ids)
    existing = {item.file_id for item in pack.items}
    position = max((item.position for item in pack.items), default=-1) + 1
    for file in files:
        if file.id not in existing:
            db.add(PackItem(pack_id=pack.id, file_id=file.id, position=position)); position += 1
    await db.commit()
    return _pack_response(await _owned_pack(db, pack_id, current_user.id))


@router.delete("/{pack_id}/items/{item_id}", response_model=PackResponse)
async def remove_pack_item(pack_id: int, item_id: int, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    pack = await _owned_pack(db, pack_id, current_user.id)
    item = next((item for item in pack.items if item.id == item_id), None)
    if item is None: raise HTTPException(status_code=404, detail="آیتم پک پیدا نشد")
    await db.delete(item); await db.flush()
    remaining = (await db.execute(select(PackItem).where(PackItem.pack_id == pack.id).order_by(PackItem.position, PackItem.id))).scalars().all()
    for position, candidate in enumerate(remaining): candidate.position = position
    await db.commit()
    return _pack_response(await _owned_pack(db, pack_id, current_user.id))


@router.put("/{pack_id}/reorder", response_model=PackResponse)
async def reorder_pack(pack_id: int, payload: PackReorder, db: AsyncSession = Depends(get_db), current_user: User = Depends(get_current_user)):
    pack = await _owned_pack(db, pack_id, current_user.id)
    current = {item.id: item for item in pack.items}
    if len(payload.item_ids) != len(set(payload.item_ids)) or set(payload.item_ids) != set(current):
        raise HTTPException(status_code=400, detail="ترتیب باید همه آیتم‌های پک را داشته باشد")
    for position, item_id in enumerate(payload.item_ids): current[item_id].position = position
    await db.commit()
    return _pack_response(await _owned_pack(db, pack_id, current_user.id))
