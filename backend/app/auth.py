"""
JWT authentication utilities.
"""
from datetime import datetime, timedelta
import json
from typing import Optional

from jose import jwt, JWTError
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import bindparam, select, text

from .config import get_settings
from .database import get_db
from .models import AuthSession, File, Folder, User, WorkspaceGrant
from .schemas import TokenPayload

settings = get_settings()
security = HTTPBearer(auto_error=False)


def workspace_scope(request: Request | None) -> dict[str, list[int]] | None:
    return getattr(request.state, "workspace_scope", None) if request else None


def require_scoped_folder(request: Request | None, folder_id: int | None) -> None:
    scope = workspace_scope(request)
    if not scope or not (scope["folder_ids"] or scope["file_ids"]):
        return
    if folder_id is None or folder_id not in getattr(request.state, "workspace_allowed_folder_ids", set()):
        raise HTTPException(status_code=403, detail="این کشوی مقصد با تو به اشتراک گذاشته نشده است.")


async def scoped_folder_ids(db: AsyncSession, owner_user_id: int, roots: list[int]) -> set[int]:
    if not roots:
        return set()
    statement = text("""
        WITH RECURSIVE descendants AS (
            SELECT id FROM folders WHERE user_id = :user_id AND id IN :root_ids
            UNION ALL
            SELECT f.id FROM folders f JOIN descendants d ON f.parent_id = d.id
            WHERE f.user_id = :user_id
        ) SELECT id FROM descendants
    """).bindparams(bindparam("root_ids", expanding=True))
    result = await db.execute(statement, {"user_id": owner_user_id, "root_ids": roots})
    return {int(value) for value in result.scalars().all()}



def create_access_token(telegram_id: int, version: int = 0, session_id: str | None = None) -> str:
    """Create a JWT access token."""
    expire = datetime.utcnow() + timedelta(minutes=settings.jwt_expiry_minutes)
    payload = {
        "sub": str(telegram_id),  # Subject must be string
        "exp": expire,
        "type": "access",
        "ver": version
    }
    if session_id:
        payload["sid"] = session_id
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_refresh_token(telegram_id: int, version: int = 0, session_id: str | None = None) -> str:
    """Create a JWT refresh token (longer expiry)."""
    expire = datetime.utcnow() + timedelta(days=settings.refresh_token_expiry_days)
    payload = {
        "sub": str(telegram_id),  # Subject must be string
        "exp": expire,
        "type": "refresh",
        "ver": version
    }
    if session_id:
        payload["sid"] = session_id
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def create_vault_token(telegram_id: int, version: int = 0) -> str:
    """Create a short-lived token for viewing protected hidden content."""
    payload = {
        "sub": str(telegram_id), "exp": datetime.utcnow() + timedelta(minutes=30),
        "type": "vault", "ver": version,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def has_vault_access(request: Request | None, user: User) -> bool:
    if not user.vault_password_hash:
        return False
    token = None
    if request is not None:
        token = request.headers.get("X-Komod-Vault-Token") or request.query_params.get("vault_token")
    payload = verify_token_payload(token, "vault") if token else None
    return bool(payload and payload.get("sub") == str(user.telegram_id) and payload.get("ver") == user.auth_version)


def require_vault_access(request: Request | None, user: User) -> None:
    if not has_vault_access(request, user):
        raise HTTPException(status_code=423, detail="گاوصندوق قفل است")


def verify_token_payload(token: str, token_type: str = "access") -> Optional[dict]:
    """Verify JWT token and return full payload if valid."""
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        if payload.get("type") != token_type:
            return None
        return payload
    except (JWTError, ValueError):
        return None


def verify_token(token: str, token_type: str = "access") -> Optional[int]:
    """Verify JWT token and return telegram_id if valid."""
    payload = verify_token_payload(token, token_type)
    if not payload:
        return None
    
    sub = payload.get("sub")
    return int(sub) if sub is not None else None



async def get_current_user(
    request: Request = None,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: AsyncSession = Depends(get_db)
) -> User:
    """Dependency to get current authenticated user. Supports Bearer token or query param."""
    token = None
    
    # Try getting token from Authorization header
    if credentials:
        token = credentials.credentials
    
    # If not in header, try query parameter (for streaming/images)
    if not token and request and "token" in request.query_params:
        token = request.query_params["token"]
        
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Verify token
    try:
        payload = verify_token_payload(token)
        telegram_id = int(payload.get("sub")) if payload and payload.get("sub") else None
        token_version = payload.get("ver") if payload else None
    except Exception:
        telegram_id = None
        token_version = None
    
    if not telegram_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    result = await db.execute(select(User).where(User.telegram_id == telegram_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")
    
    # Check token version for global logout
    if token_version is not None and token_version < user.auth_version:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session has been invalidated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    session_id = payload.get("sid") if payload else None
    if session_id:
        session = (await db.execute(select(AuthSession).where(
            AuthSession.id == session_id, AuthSession.user_id == user.id
        ))).scalar_one_or_none()
        if session is None or session.revoked_at is not None:
            raise HTTPException(status_code=401, detail="Session has been revoked")
        if session.last_seen_at < datetime.utcnow() - timedelta(minutes=5):
            session.last_seen_at = datetime.utcnow()
            await db.commit()

    # Auth and administration always operate on the signed-in identity.
    if request and not request.url.path.startswith(("/api/auth", "/api/admin", "/api/accounts")):
        workspace_raw = request.headers.get("X-Workspace-User") or request.query_params.get("workspace")
        if workspace_raw:
            try:
                workspace_user_id = int(workspace_raw)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid workspace")
            if workspace_user_id != user.id:
                grant = (await db.execute(select(WorkspaceGrant).where(
                    WorkspaceGrant.owner_user_id == workspace_user_id,
                    WorkspaceGrant.member_user_id == user.id,
                ))).scalar_one_or_none()
                if grant is None:
                    raise HTTPException(status_code=403, detail="Workspace access was not granted")
                if request.method not in {"GET", "HEAD", "OPTIONS"} and grant.permission != "write":
                    raise HTTPException(status_code=403, detail="This workspace is read-only")
                owner = await db.get(User, workspace_user_id)
                if owner is None or not owner.is_active:
                    raise HTTPException(status_code=404, detail="Workspace is unavailable")
                try:
                    raw_scope = json.loads(grant.scope_json or "{}")
                except (TypeError, ValueError, json.JSONDecodeError):
                    raw_scope = {}
                scope = {
                    "folder_ids": [int(value) for value in raw_scope.get("folder_ids", []) if str(value).isdigit()],
                    "file_ids": [int(value) for value in raw_scope.get("file_ids", []) if str(value).isdigit()],
                }
                request.state.workspace_scope = scope
                if scope["folder_ids"] or scope["file_ids"]:
                    allowed_folders = await scoped_folder_ids(db, owner.id, scope["folder_ids"])
                    request.state.workspace_allowed_folder_ids = allowed_folders
                    file_id = request.path_params.get("file_id")
                    if file_id is not None:
                        item = await db.get(File, int(file_id))
                        if item is None or item.user_id != owner.id or (item.id not in scope["file_ids"] and item.folder_id not in allowed_folders):
                            raise HTTPException(status_code=403, detail="این فایل با تو به اشتراک گذاشته نشده است.")
                    folder_id = request.path_params.get("folder_id")
                    if folder_id is not None and int(folder_id) not in allowed_folders:
                        raise HTTPException(status_code=403, detail="این کشو با تو به اشتراک گذاشته نشده است.")
                    if request.method not in {"GET", "HEAD", "OPTIONS"} and file_id is None and folder_id is None and request.url.path not in {"/api/files/upload", "/api/files/import-link"}:
                        raise HTTPException(status_code=403, detail="این عملیات خارج از محدودهٔ اشتراک‌گذاری است.")
                return owner

    return user
