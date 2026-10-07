"""Account switching, shared spaces and administrator controls."""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from passlib.context import CryptContext
from pyrogram.enums import ChatMemberStatus, ChatType
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from ..auth import create_vault_token, get_current_user, require_vault_access
from ..config import get_settings
from ..database import get_db
from ..models import AuthSession, File, User, WorkspaceGrant
from ..schemas import AccountPreferences, AdminStatsResponse, AdminUserResponse, AdminUserUpdate, StorageChannelResponse, StorageChannelUpdate, VaultPasswordRequest, VaultStatus, VaultTokenResponse, WorkspaceGrantCreate, WorkspaceResponse
from .. import telegram

router = APIRouter(tags=["Accounts"])
settings = get_settings()
vault_password_context = CryptContext(schemes=["pbkdf2_sha256"], pbkdf2_sha256__default_rounds=600_000, deprecated="auto")


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


@router.get("/accounts/storage-channel", response_model=StorageChannelResponse)
async def get_storage_channel(current_user: User = Depends(get_current_user)):
    if current_user.storage_channel_id is None:
        return StorageChannelResponse(configured=False)
    try:
        chat = await telegram.tg_client.get_chat(current_user.storage_channel_id)
        return StorageChannelResponse(configured=True, channel_id=current_user.storage_channel_id, title=chat.title)
    except Exception:
        return StorageChannelResponse(configured=True, channel_id=current_user.storage_channel_id, title="کانال تنظیم‌شده")


@router.put("/accounts/storage-channel", response_model=StorageChannelResponse)
async def set_storage_channel(payload: StorageChannelUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    channel_id = int(payload.channel_id)
    if channel_id >= 0 or not str(abs(channel_id)).startswith("100"):
        raise HTTPException(status_code=400, detail="آیدی عددی کانال خصوصی باید با ‎-100 شروع شود.")
    try:
        chat = await telegram.tg_client.get_chat(channel_id)
        if chat.type != ChatType.CHANNEL:
            raise HTTPException(status_code=400, detail="فضای انتخاب‌شده باید یک کانال تلگرام باشد.")
        user_member = await telegram.tg_client.get_chat_member(channel_id, current_user.telegram_id)
        bot_id = (await telegram.tg_client.get_me()).id
        bot_member = await telegram.tg_client.get_chat_member(channel_id, bot_id)
        if user_member.status not in {ChatMemberStatus.OWNER, ChatMemberStatus.ADMINISTRATOR}:
            raise HTTPException(status_code=403, detail="برای اتصال این کانال باید مدیر یا مالک آن باشی.")
        if bot_member.status not in {ChatMemberStatus.OWNER, ChatMemberStatus.ADMINISTRATOR}:
            raise HTTPException(status_code=403, detail="ابتدا ربات کمد را با دسترسی ارسال و حذف پیام، مدیر کانال کن.")
        privileges = getattr(bot_member, "privileges", None)
        if privileges and getattr(privileges, "can_post_messages", True) is False:
            raise HTTPException(status_code=403, detail="دسترسی ارسال پیام برای ربات در کانال فعال نیست.")
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=400, detail="کانال در دسترس نیست؛ عضویت و دسترسی مدیریتی ربات را بررسی کن.") from error
    current_user.storage_channel_id = channel_id
    await db.commit()
    return StorageChannelResponse(configured=True, channel_id=channel_id, title=chat.title)


@router.delete("/accounts/storage-channel", status_code=204)
async def reset_storage_channel(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    current_user.storage_channel_id = None
    await db.commit()
    return Response(status_code=204)


@router.get("/accounts/preferences", response_model=AccountPreferences)
async def get_account_preferences(current_user: User = Depends(get_current_user)):
    return AccountPreferences(delete_storage_files=current_user.delete_storage_files)


@router.put("/accounts/preferences", response_model=AccountPreferences)
async def update_account_preferences(
    payload: AccountPreferences,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    current_user.delete_storage_files = payload.delete_storage_files
    await db.commit()
    return AccountPreferences(delete_storage_files=current_user.delete_storage_files)


@router.get("/accounts/vault", response_model=VaultStatus)
async def get_vault_status(current_user: User = Depends(get_current_user)):
    return VaultStatus(configured=bool(current_user.vault_password_hash))


@router.put("/accounts/vault", response_model=VaultTokenResponse)
async def set_vault_password(
    payload: VaultPasswordRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.vault_password_hash:
        require_vault_access(request, current_user)
    current_user.vault_password_hash = vault_password_context.hash(payload.password)
    await db.commit()
    return VaultTokenResponse(token=create_vault_token(current_user.telegram_id, current_user.auth_version))


@router.post("/accounts/vault/unlock", response_model=VaultTokenResponse)
async def unlock_vault(payload: VaultPasswordRequest, current_user: User = Depends(get_current_user)):
    if not current_user.vault_password_hash or not vault_password_context.verify(payload.password, current_user.vault_password_hash):
        raise HTTPException(status_code=401, detail="رمز گاوصندوق درست نیست")
    return VaultTokenResponse(token=create_vault_token(current_user.telegram_id, current_user.auth_version))


@router.get("/admin/stats", response_model=AdminStatsResponse)
async def admin_stats(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    total_users, active_users = (await db.execute(select(
        func.count(User.id), func.count(User.id).filter(User.is_active.is_(True))
    ))).one()
    total_files, total_size = (await db.execute(select(
        func.count(File.id), func.coalesce(func.sum(File.file_size), 0)
    ))).one()
    return AdminStatsResponse(
        active_users=int(active_users or 0), total_users=int(total_users or 0),
        total_files=int(total_files or 0), total_size=int(total_size or 0),
    )


@router.get("/admin/users", response_model=list[AdminUserResponse])
async def admin_users(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    file_stats = select(
        File.user_id.label("user_id"),
        func.coalesce(func.sum(File.file_size), 0).label("total_size"),
        func.count(File.id).label("file_count"),
    ).group_by(File.user_id).subquery()
    session_stats = select(
        AuthSession.user_id.label("user_id"),
        func.count(AuthSession.id).label("session_count"),
    ).where(AuthSession.revoked_at.is_(None)).group_by(AuthSession.user_id).subquery()
    rows = (await db.execute(
        select(
            User,
            func.coalesce(file_stats.c.total_size, 0),
            func.coalesce(file_stats.c.file_count, 0),
            func.coalesce(session_stats.c.session_count, 0),
        )
        .outerjoin(file_stats, file_stats.c.user_id == User.id)
        .outerjoin(session_stats, session_stats.c.user_id == User.id)
        .order_by(User.created_at.desc())
    )).all()
    return [
        AdminUserResponse.model_validate(user, from_attributes=True).model_copy(update={
            "total_size": int(size or 0), "file_count": int(files or 0), "session_count": int(sessions or 0),
        })
        for user, size, files, sessions in rows
    ]


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
    return AdminUserResponse.model_validate(user, from_attributes=True).model_copy(update={"total_size": int(size or 0), "file_count": int(files or 0), "session_count": int(sessions or 0)})
