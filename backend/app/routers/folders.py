"""
Folder management API endpoints.
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, update, delete, text

from ..database import get_db
from ..models import Folder, File, User, WatchProgress
from ..schemas import FolderResponse, FolderCreate, FolderUpdate, FolderWithChildren
from ..auth import get_current_user
from ..telegram import delete_from_storage_channel


router = APIRouter(prefix="/folders", tags=["Folders"])


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
    message_ids = [file.channel_message_id for file in files]
    for start in range(0, len(message_ids), 100):
        if not await delete_from_storage_channel(message_ids[start:start + 100]):
            raise HTTPException(status_code=502, detail="Could not delete files from Telegram storage")
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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List user's folders optimally."""
    # Select folder and count of files in one query
    stmt = (
        select(Folder, func.count(File.id).label("file_count"))
        .outerjoin(File, File.folder_id == Folder.id)
        .where(Folder.user_id == current_user.id)
        .group_by(Folder.id)
        .order_by(Folder.name)
    )
    
    if parent_id is not None:
        stmt = stmt.where(Folder.parent_id == parent_id)
    else:
        stmt = stmt.where(Folder.parent_id.is_(None))
    
    result = await db.execute(stmt)
    rows = result.all()
    
    return [
        FolderResponse(
            id=folder.id,
            name=folder.name,
            parent_id=folder.parent_id,
            user_id=folder.user_id,
            created_at=folder.created_at,
            updated_at=folder.updated_at,
            file_count=file_count
        )
        for folder, file_count in rows
    ]


@router.get("/tree", response_model=List[FolderWithChildren])
async def get_folder_tree(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the complete folder tree for the user optimally."""
    # Get all folders with counts in one query
    stmt = (
        select(Folder, func.count(File.id).label("file_count"))
        .outerjoin(File, File.folder_id == Folder.id)
        .where(Folder.user_id == current_user.id)
        .group_by(Folder.id)
        .order_by(Folder.name)
    )
    
    result = await db.execute(stmt)
    rows = result.all()
    
    # Build tree
    folder_map = {}
    for folder, file_count in rows:
        folder_map[folder.id] = {
            "id": folder.id,
            "name": folder.name,
            "parent_id": folder.parent_id,
            "user_id": folder.user_id,
            "created_at": folder.created_at,
            "updated_at": folder.updated_at,
            "file_count": file_count,
            "children": [],
        }
    
    # Link parents and children
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
):
    """Get a specific folder by ID with file count."""
    stmt = (
        select(Folder, func.count(File.id).label("file_count"))
        .outerjoin(File, File.folder_id == Folder.id)
        .where(Folder.id == folder_id, Folder.user_id == current_user.id)
        .group_by(Folder.id)
    )
    
    result = await db.execute(stmt)
    row = result.first()
    
    if not row:
        raise HTTPException(status_code=404, detail="Folder not found")
    
    folder, file_count = row
    
    return FolderResponse(
        id=folder.id,
        name=folder.name,
        parent_id=folder.parent_id,
        user_id=folder.user_id,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
        file_count=file_count,
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
        parent_id=folder_data.parent_id,
    )
    db.add(folder)
    await db.commit()
    await db.refresh(folder)
    
    return FolderResponse(
        id=folder.id,
        name=folder.name,
        parent_id=folder.parent_id,
        user_id=folder.user_id,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
        file_count=0,
    )


@router.patch("/{folder_id}", response_model=FolderResponse)
async def update_folder(
    folder_id: int,
    update_data: FolderUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a folder (rename, move)."""
    result = await db.execute(
        select(Folder).where(Folder.id == folder_id, Folder.user_id == current_user.id)
    )
    folder = result.scalar_one_or_none()
    
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    
    # Update fields
    if update_data.name is not None:
        name = update_data.name.strip()
        if not name or len(name) > 255:
            raise HTTPException(status_code=400, detail="Folder name must be 1–255 characters")
        folder.name = name
    if update_data.parent_id is not None:
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
        parent_id=folder.parent_id,
        user_id=folder.user_id,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
        file_count=file_count,
    )


@router.delete("/{folder_id}")
async def delete_folder(
    folder_id: int,
    delete_contents: bool = Query(False, description="Also delete files and subfolders"),
    move_files_to: Optional[int] = Query(None, description="Legacy destination for retained contents"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a folder; retain contents by default for older clients."""
    result = await db.execute(
        select(Folder).where(Folder.id == folder_id, Folder.user_id == current_user.id)
    )
    folder = result.scalar_one_or_none()
    
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    
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
):
    """Delete selected folders with the same explicit content choice."""
    deleted = 0
    for folder_id in dict.fromkeys(folder_ids):
        folder = (await db.execute(select(Folder).where(
            Folder.id == folder_id, Folder.user_id == current_user.id
        ))).scalar_one_or_none()
        if folder is None:
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
):
    """Move multiple folders to another folder."""
    folder_ids = move_data.get("ids", [])
    target_id = move_data.get("folder_id")
    
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
