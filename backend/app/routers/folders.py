"""
Folder management API endpoints.
"""
from typing import Optional, List
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, delete, text, asc, desc

from ..database import get_db
from ..models import Folder, File, User, WatchProgress
from ..schemas import FolderResponse, FolderCreate, FolderUpdate, FolderWithChildren
from ..auth import get_current_user, has_vault_access, require_vault_access, workspace_scope
from ..telegram import delete_from_storage_channel


router = APIRouter(prefix="/folders", tags=["Folders"])
logger = logging.getLogger(__name__)


async def ensure_default_folder(db: AsyncSession, user_id: int) -> Folder:
    """Create the system drawer once and migrate legacy root files into it."""
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        await db.execute(text("SELECT pg_advisory_xact_lock(:lock_id)"), {"lock_id": user_id})
    folder = (await db.execute(select(Folder).where(
        Folder.user_id == user_id, Folder.is_default.is_(True)
    ))).scalar_one_or_none()
    if folder is None:
        folder = (await db.execute(select(Folder).where(
            Folder.user_id == user_id, Folder.parent_id.is_(None), Folder.name == "فایل‌های من"
        ))).scalar_one_or_none()
        if folder is None:
            folder = Folder(user_id=user_id, name="فایل‌های من", parent_id=None, is_default=True)
            db.add(folder)
            await db.flush()
        else:
            folder.is_default = True
    await db.execute(update(File).where(
        File.user_id == user_id, File.folder_id.is_(None)
    ).values(folder_id=folder.id))
    await db.flush()
    return folder


async def get_all_folder_counts(db: AsyncSession, user_id: int, include_hidden: bool = False) -> dict[int, int]:
    result = await db.execute(text("""
        WITH RECURSIVE hierarchy(ancestor_id, descendant_id) AS (
            SELECT id, id FROM folders WHERE user_id = :user_id
            UNION ALL
            SELECT h.ancestor_id, f.id FROM hierarchy h
            JOIN folders f ON f.parent_id = h.descendant_id
            WHERE f.user_id = :user_id
        )
        SELECT h.ancestor_id, COUNT(fi.id)
        FROM hierarchy h
        LEFT JOIN files fi ON fi.folder_id = h.descendant_id AND fi.user_id = :user_id
            AND (:include_hidden OR NOT fi.is_hidden)
        GROUP BY h.ancestor_id
    """), {"user_id": user_id, "include_hidden": include_hidden})
    return {int(folder_id): int(count) for folder_id, count in result.all()}


async def delete_folder_contents(db: AsyncSession, folder: Folder, delete_contents: bool) -> None:
    """Remove one folder, optionally removing its entire subtree and channel media."""
    if not delete_contents:
        # Keep direct files and subfolders at the deleted folder's previous level.
        await db.execute(update(File).where(File.folder_id == folder.id).values(folder_id=folder.parent_id))
        await db.execute(update(Folder).where(Folder.parent_id == folder.id).values(parent_id=folder.parent_id))
        await db.delete(folder)
        return

    result = await db.execute(text("""
        WITH RECURSIVE descendants AS (
            SELECT id FROM folders WHERE id = :folder_id AND user_id = :user_id
            UNION ALL
            SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
            WHERE f.user_id = :user_id
        ) SELECT id FROM descendants
    """), {"folder_id": folder.id, "user_id": folder.user_id})
    folder_ids = result.scalars().all()
    files = (await db.execute(select(File).where(
        File.folder_id.in_(folder_ids), File.user_id == folder.user_id
    ))).scalars().all()
    owner = await db.get(User, folder.user_id)
    if owner is None or owner.delete_storage_files:
        messages_by_channel: dict[int | None, list[int]] = {}
        for item in files:
            messages_by_channel.setdefault(item.storage_channel_id, []).append(item.channel_message_id)
        for channel_id, message_ids in messages_by_channel.items():
            for start in range(0, len(message_ids), 100):
                batch = message_ids[start:start + 100]
                deleted = await delete_from_storage_channel(batch, channel_id) if channel_id is not None else await delete_from_storage_channel(batch)
                if not deleted:
                    logger.warning("Telegram cleanup failed for folder %s; deleting stale database rows", folder.id)
    file_ids = [file.id for file in files]
    if file_ids:
        await db.execute(delete(WatchProgress).where(WatchProgress.file_id.in_(file_ids)))
        await db.execute(delete(File).where(File.id.in_(file_ids)))
    await db.delete(folder)


async def get_folder_file_count(db: AsyncSession, folder_id: int) -> int:
    """Get the total number of files in a folder and all its subfolders."""
    # This is a recursive CTE approach for efficiency
    from sqlalchemy import text
    query = text("""
        WITH RECURSIVE subfolders AS (
            SELECT id FROM folders WHERE id = :root_id
            UNION ALL
            SELECT f.id FROM folders f
            INNER JOIN subfolders sf ON f.parent_id = sf.id
        )
        SELECT COUNT(*) FROM files
        WHERE folder_id IN (SELECT id FROM subfolders)
    """)
    result = await db.execute(query, {"root_id": folder_id})
    return result.scalar() or 0


@router.get("", response_model=List[FolderResponse])
async def list_folders(
    parent_id: Optional[int] = Query(None, description="Filter by parent folder ID"),
    sort: Optional[str] = None,
    favorite_only: bool = False,
    include_hidden: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """List drawers with recursive file counts."""
    if parent_id is None:
        await ensure_default_folder(db, current_user.id)
        await db.commit()
    stmt = select(Folder).where(Folder.user_id == current_user.id)
    scope = workspace_scope(request)
    if scope and (scope["folder_ids"] or scope["file_ids"]):
        stmt = stmt.where(Folder.id.in_(getattr(request.state, "workspace_allowed_folder_ids", set())))
    if include_hidden:
        require_vault_access(request, current_user)
    else:
        stmt = stmt.where(Folder.is_hidden.is_(False))
    if parent_id is not None:
        stmt = stmt.where(Folder.parent_id == parent_id)
    elif scope and scope["folder_ids"]:
        stmt = stmt.where(Folder.id.in_(scope["folder_ids"]))
    else:
        stmt = stmt.where(Folder.parent_id.is_(None))
    if favorite_only:
        stmt = stmt.where(Folder.is_favorite.is_(True))
    folders = (await db.execute(stmt)).scalars().all()
    counts = await get_all_folder_counts(db, current_user.id, include_hidden)
    criteria = []
    for raw in (sort or "name:asc").split(",")[:4]:
        field, _, direction = raw.strip().partition(":")
        if field in {"name", "count", "created", "updated"}:
            criteria.append((field, direction.lower() == "desc"))
    def key_for(folder: Folder, field: str):
        return {"name": folder.name.casefold(), "count": counts.get(folder.id, 0), "created": folder.created_at, "updated": folder.updated_at}[field]
    folders.sort(key=lambda folder: folder.id)
    for field, reverse in reversed(criteria or [("name", False)]):
        folders.sort(key=lambda folder, selected=field: key_for(folder, selected), reverse=reverse)
    folders.sort(key=lambda folder: not folder.is_pinned)
    return [FolderResponse(
        id=folder.id, name=folder.name, description=folder.description,
        parent_id=folder.parent_id, user_id=folder.user_id,
        created_at=folder.created_at, updated_at=folder.updated_at,
        file_count=counts.get(folder.id, 0), is_favorite=folder.is_favorite,
        is_pinned=folder.is_pinned, is_default=folder.is_default, is_hidden=folder.is_hidden,
    ) for folder in folders]


@router.get("/tree", response_model=List[FolderWithChildren])
async def get_folder_tree(
    include_hidden: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Get the complete drawer tree with recursive counts."""
    await ensure_default_folder(db, current_user.id)
    await db.commit()
    stmt = select(Folder).where(Folder.user_id == current_user.id)
    scope = workspace_scope(request)
    if scope and (scope["folder_ids"] or scope["file_ids"]):
        stmt = stmt.where(Folder.id.in_(getattr(request.state, "workspace_allowed_folder_ids", set())))
    if include_hidden:
        require_vault_access(request, current_user)
    else:
        stmt = stmt.where(Folder.is_hidden.is_(False))
    folders = (await db.execute(stmt.order_by(Folder.name))).scalars().all()
    counts = await get_all_folder_counts(db, current_user.id, include_hidden)
    folder_map = {folder.id: {
        "id": folder.id, "name": folder.name, "description": folder.description,
        "parent_id": folder.parent_id, "user_id": folder.user_id,
        "created_at": folder.created_at, "updated_at": folder.updated_at,
        "file_count": counts.get(folder.id, 0), "is_favorite": folder.is_favorite,
        "is_pinned": folder.is_pinned, "is_default": folder.is_default, "is_hidden": folder.is_hidden, "children": [],
    } for folder in folders}
    roots = []
    for folder_data in folder_map.values():
        parent_id = folder_data["parent_id"]
        if parent_id and parent_id in folder_map:
            folder_map[parent_id]["children"].append(folder_data)
        else:
            roots.append(folder_data)
    return roots


@router.get("/{folder_id}", response_model=FolderResponse)
async def get_folder(
    folder_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    folder = (await db.execute(select(Folder).where(
        Folder.id == folder_id, Folder.user_id == current_user.id
    ))).scalar_one_or_none()
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    if folder.is_hidden:
        require_vault_access(request, current_user)
    return FolderResponse(
        id=folder.id, name=folder.name, description=folder.description,
        parent_id=folder.parent_id, user_id=folder.user_id,
        created_at=folder.created_at, updated_at=folder.updated_at,
        file_count=await get_folder_file_count(db, folder.id),
        is_favorite=folder.is_favorite, is_pinned=folder.is_pinned,
        is_default=folder.is_default, is_hidden=folder.is_hidden,
    )


@router.post("", response_model=FolderResponse, status_code=201)
async def create_folder(
    folder_data: FolderCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new folder."""
    # Validate parent exists if specified
    if folder_data.parent_id:
        parent_result = await db.execute(
            select(Folder).where(
                Folder.id == folder_data.parent_id,
                Folder.user_id == current_user.id
            )
        )
        if not parent_result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Parent folder not found")
    
    # Check for duplicate name in same parent
    existing = await db.execute(
        select(Folder).where(
            Folder.user_id == current_user.id,
            Folder.parent_id == folder_data.parent_id,
            Folder.name == folder_data.name
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Folder with this name already exists")
    
    folder = Folder(
        user_id=current_user.id,
        name=folder_data.name,
        description=folder_data.description.strip()[:1024] if folder_data.description else None,
        parent_id=folder_data.parent_id,
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    
    return FolderResponse(
        id=folder.id,
        name=folder.name,
        description=folder.description,
        parent_id=folder.parent_id,
        user_id=folder.user_id,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
        file_count=0,
        is_favorite=folder.is_favorite,
        is_pinned=folder.is_pinned,
        is_default=folder.is_default,
    )


@router.patch("/{folder_id}", response_model=FolderResponse)
async def update_folder(
    folder_id: int,
    update_data: FolderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Update a folder (rename, move)."""
    result = await db.execute(
        select(Folder).where(Folder.id == folder_id, Folder.user_id == current_user.id)
    )
    folder = result.scalar_one_or_none()
    
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    if folder.is_hidden and not has_vault_access(request, current_user):
        require_vault_access(request, current_user)
    
    # Update fields
    if update_data.name is not None:
        name = update_data.name.strip()
        if not name or len(name) > 255:
            raise HTTPException(status_code=400, detail="Folder name must be 1–255 characters")
        folder.name = name
    if update_data.description is not None:
        folder.description = update_data.description.strip()[:1024] or None
    if update_data.is_favorite is not None:
        folder.is_favorite = update_data.is_favorite
    if update_data.is_pinned is not None:
        folder.is_pinned = update_data.is_pinned
    if update_data.is_hidden is not None:
        if update_data.is_hidden and not current_user.vault_password_hash:
            raise HTTPException(status_code=409, detail="ابتدا برای گاوصندوق رمز تعیین کن")
        descendants = (await db.execute(text("""
            WITH RECURSIVE subtree AS (
                SELECT id FROM folders WHERE id = :folder_id AND user_id = :user_id
                UNION ALL
                SELECT child.id FROM folders child JOIN subtree parent ON child.parent_id = parent.id
                WHERE child.user_id = :user_id
            ) SELECT id FROM subtree
        """), {"folder_id": folder.id, "user_id": current_user.id})).scalars().all()
        await db.execute(update(Folder).where(
            Folder.id.in_(descendants), Folder.user_id == current_user.id
        ).values(is_hidden=update_data.is_hidden))
        file_values = {"is_hidden": update_data.is_hidden}
        if update_data.is_hidden:
            file_values["public_hash"] = None
        await db.execute(update(File).where(
            File.folder_id.in_(descendants), File.user_id == current_user.id
        ).values(**file_values))
        folder.is_hidden = update_data.is_hidden
    if update_data.parent_id is not None:
        if folder.is_default:
            raise HTTPException(status_code=400, detail="Default folder must stay at the root")
        # Prevent moving folder into itself
        if update_data.parent_id == folder_id:
            raise HTTPException(status_code=400, detail="Cannot move folder into itself")
        
        # Verify target parent folder belongs to current user (security check)
        if update_data.parent_id != 0:
            parent_check = await db.execute(
                select(Folder).where(
                    Folder.id == update_data.parent_id,
                    Folder.user_id == current_user.id
                )
            )
            if not parent_check.scalar_one_or_none():
                raise HTTPException(status_code=404, detail="Parent folder not found")
            ancestor_id = update_data.parent_id
            while ancestor_id is not None:
                if ancestor_id == folder_id:
                    raise HTTPException(status_code=400, detail="Cannot move a folder into its descendant")
                ancestor = (await db.execute(select(Folder.parent_id).where(
                    Folder.id == ancestor_id, Folder.user_id == current_user.id
                ))).scalar_one_or_none()
                ancestor_id = ancestor
        
        folder.parent_id = update_data.parent_id if update_data.parent_id != 0 else None

    duplicate = (await db.execute(select(Folder.id).where(
        Folder.user_id == current_user.id,
        Folder.parent_id == folder.parent_id,
        Folder.name == folder.name,
        Folder.id != folder_id,
    ))).scalar_one_or_none()
    if duplicate is not None:
        raise HTTPException(status_code=400, detail="Folder with this name already exists at the destination")
    
    await db.commit()
    await db.refresh(folder)
    
    file_count = await get_folder_file_count(db, folder.id)
    
    return FolderResponse(
        id=folder.id,
        name=folder.name,
        description=folder.description,
        parent_id=folder.parent_id,
        user_id=folder.user_id,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
        file_count=file_count,
        is_favorite=folder.is_favorite,
        is_pinned=folder.is_pinned,
        is_default=folder.is_default, is_hidden=folder.is_hidden,
    )


@router.delete("/{folder_id}")
async def delete_folder(
    folder_id: int,
    delete_contents: bool = Query(False, description="Also delete files and subfolders"),
    move_files_to: Optional[int] = Query(None, description="Legacy destination for retained contents"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Delete a folder; retain contents by default for older clients."""
    result = await db.execute(
        select(Folder).where(Folder.id == folder_id, Folder.user_id == current_user.id)
    )
    folder = result.scalar_one_or_none()
    
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    if folder.is_hidden:
        require_vault_access(request, current_user)
    if folder.is_default:
        raise HTTPException(status_code=400, detail="Default folder cannot be deleted")
    
    if move_files_to is not None and not delete_contents:
        destination = move_files_to or None
        if destination is not None:
            target = (await db.execute(select(Folder).where(
                Folder.id == destination, Folder.user_id == current_user.id
            ))).scalar_one_or_none()
            if not target or destination == folder_id:
                raise HTTPException(status_code=400, detail="Invalid destination folder")
        await db.execute(update(File).where(File.folder_id == folder_id).values(folder_id=destination))
    await delete_folder_contents(db, folder, delete_contents)
    await db.commit()
    
    return {"message": "Folder deleted successfully"}


@router.post("/batch-delete")
async def batch_delete_folders(
    folder_ids: List[int],
    delete_contents: bool = Query(False, description="Also delete files and subfolders"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Delete selected folders with the same explicit content choice."""
    deleted = 0
    for folder_id in dict.fromkeys(folder_ids):
        folder = (await db.execute(select(Folder).where(
            Folder.id == folder_id, Folder.user_id == current_user.id
        ))).scalar_one_or_none()
        if folder is None:
            continue
        if folder.is_hidden:
            require_vault_access(request, current_user)
        if folder.is_default:
            continue
        await delete_folder_contents(db, folder, delete_contents)
        await db.flush()
        deleted += 1
    await db.commit()
    return {"message": f"Deleted {deleted} folders"}


@router.post("/batch-move")
async def batch_move_folders(
    move_data: dict,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Move multiple folders to another folder."""
    folder_ids = move_data.get("ids", [])
    target_id = move_data.get("folder_id")
    selected = (await db.execute(select(Folder).where(
        Folder.id.in_(folder_ids), Folder.user_id == current_user.id
    ))).scalars().all()
    if any(folder.is_hidden for folder in selected):
        require_vault_access(request, current_user)
    
    if target_id == 0:
        target_id = None
        
    # Prevent moving folder into itself
    if target_id in folder_ids:
        raise HTTPException(status_code=400, detail="Cannot move a folder into itself")
        
    # Verify target parent folder belongs to user
    if target_id is not None:
        parent_check = await db.execute(
            select(Folder).where(Folder.id == target_id, Folder.user_id == current_user.id)
        )
        if not parent_check.scalar_one_or_none():
            raise HTTPException(status_code=404, detail="Target parent folder not found")
        ancestor_id = target_id
        while ancestor_id is not None:
            if ancestor_id in folder_ids:
                raise HTTPException(status_code=400, detail="Cannot move a folder into its descendant")
            ancestor_id = (await db.execute(select(Folder.parent_id).where(
                Folder.id == ancestor_id, Folder.user_id == current_user.id
            ))).scalar_one_or_none()
            
    # Update folders
    from sqlalchemy import update
    await db.execute(
        update(Folder)
        .where(Folder.id.in_(folder_ids), Folder.user_id == current_user.id)
        .values(parent_id=target_id)
    )
    
    await db.commit()
    return {"message": f"Moved {len(folder_ids)} folders"}
