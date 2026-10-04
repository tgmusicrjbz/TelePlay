"""Account switching, shared spaces and administrator controls."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import get_current_user
from ..config import get_settings
from ..database import get_db
from ..models import AuthSession, File, User, WorkspaceGrant
from ..schemas import AdminUserResponse, AdminUserUpdate, WorkspaceGrantCreate, WorkspaceResponse

router = APIRouter(tags=["Accounts"])
settings = get_settings()


def user_name(user: User) -> str:
    return user.display_name or " ".join(filter(None, [user.first_name, user.last_name])) or user.username or f"کاربر {user.telegram_id}"


@router.get("/accounts/workspaces", response_model=list[WorkspaceResponse])
async def list_workspaces(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    grants = (await db.execute(select(WorkspaceGrant, User).join(User, User.id == WorkspaceGrant.owner_user_id).where(
        WorkspaceGrant.member_user_id == current_user.id, User.is_active.is_(True)
    ))).all()
    result = [WorkspaceResponse(user_id=current_user.id, telegram_id=current_user.telegram_id, name=user_name(current_user), username=current_user.username, permission="owner")]
    result.extend(WorkspaceResponse(user_id=owner.id, telegram_id=owner.telegram_id, name=user_name(owner), username=owner.username, permission=grant.permission) for grant, owner in grants)
    return result


@router.get("/accounts/grants", response_model=list[WorkspaceResponse])
async def list_grants(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(WorkspaceGrant, User).join(User, User.id == WorkspaceGrant.member_user_id).where(
        WorkspaceGrant.owner_user_id == current_user.id
    ))).all()
    return [WorkspaceResponse(user_id=member.id, telegram_id=member.telegram_id, name=user_name(member), username=member.username, permission=grant.permission) for grant, member in rows]


@router.post("/accounts/grants", response_model=WorkspaceResponse)
async def grant_workspace(payload: WorkspaceGrantCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    identifier = (payload.identifier or "").strip().lstrip("@")
    if payload.telegram_id is not None:
        member_query = select(User).where(User.telegram_id == payload.telegram_id)
    elif identifier:
        member_query = select(User).where(func.lower(User.username) == identifier.lower())
    else:
        raise HTTPException(status_code=400, detail="آیدی عددی یا نام کاربری تلگرام را وارد کن.")
    member = (await db.execute(member_query.where(User.is_active.is_(True)))).scalar_one_or_none()
    if member is None:
        raise HTTPException(status_code=404, detail="این کاربر باید حداقل یک بار وارد کمد شده باشد.")
    if member.id == current_user.id:
        raise HTTPException(status_code=400, detail="فضای خودت از قبل در دسترس است.")
    grant = (await db.execute(select(WorkspaceGrant).where(
        WorkspaceGrant.owner_user_id == current_user.id, WorkspaceGrant.member_user_id == member.id
    ))).scalar_one_or_none()
    if grant is None:
        grant = WorkspaceGrant(owner_user_id=current_user.id, member_user_id=member.id, permission=payload.permission)
        db.add(grant)
    else:
        grant.permission = payload.permission
    await db.commit()
    return WorkspaceResponse(user_id=member.id, telegram_id=member.telegram_id, name=user_name(member), username=member.username, permission=grant.permission)


@router.delete("/accounts/grants/{member_user_id}", status_code=204)
async def revoke_workspace(member_user_id: int, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    grant = (await db.execute(select(WorkspaceGrant).where(
        WorkspaceGrant.owner_user_id == current_user.id, WorkspaceGrant.member_user_id == member_user_id
    ))).scalar_one_or_none()
    if grant is None:
        raise HTTPException(status_code=404, detail="دسترسی پیدا نشد")
    await db.delete(grant)
    await db.commit()
    return Response(status_code=204)


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.telegram_id not in settings.admin_users:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


@router.get("/admin/users", response_model=list[AdminUserResponse])
async def admin_users(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    users = (await db.execute(select(User).order_by(User.created_at.desc()))).scalars().all()
    result = []
    for user in users:
        size, files = (await db.execute(select(func.coalesce(func.sum(File.file_size), 0), func.count(File.id)).where(File.user_id == user.id))).one()
        sessions = (await db.execute(select(func.count(AuthSession.id)).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)))).scalar_one()
        result.append(AdminUserResponse.model_validate(user, from_attributes=True).model_copy(update={"total_size": size, "file_count": files, "session_count": sessions}))
    return result


@router.patch("/admin/users/{user_id}", response_model=AdminUserResponse)
async def update_admin_user(user_id: int, payload: AdminUserUpdate, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin.id and payload.is_active is False:
        raise HTTPException(status_code=400, detail="نمی‌توانی حساب ادمین فعلی را غیرفعال کنی.")
    if payload.display_name is not None:
        user.display_name = payload.display_name.strip() or None
    if payload.is_active is not None:
        user.is_active = payload.is_active
        if not user.is_active:
            user.auth_version += 1
            sessions = (await db.execute(select(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)))).scalars().all()
            for session in sessions:
                session.revoked_at = datetime.utcnow()
    await db.commit()
    size = (await db.execute(select(func.coalesce(func.sum(File.file_size), 0)).where(File.user_id == user.id))).scalar_one()
    files = (await db.execute(select(func.count(File.id)).where(File.user_id == user.id))).scalar_one()
    sessions = (await db.execute(select(func.count(AuthSession.id)).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)))).scalar_one()
    return AdminUserResponse.model_validate(user, from_attributes=True).model_copy(update={"total_size": size, "file_count": files, "session_count": sessions})
