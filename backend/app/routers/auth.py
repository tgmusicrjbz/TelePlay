"""
Authentication API endpoints.
"""
from datetime import datetime
import uuid
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from slowapi import Limiter
from slowapi.util import get_remote_address

from ..database import get_db
from ..models import AuthSession, User, LoginCode
from ..schemas import (
    Token, 
    UserResponse, 
    LoginCodeRequest,
    LoginCodeResponse, 
    VerifyCodeRequest, 
    AuthResponse,
    RefreshTokenRequest,
    BotInfoResponse, SessionResponse, TelegramWebAppRequest
)
from ..auth import (
    create_access_token,
    create_refresh_token,
    verify_token,
    verify_token_payload,
    get_current_user,
)
from .. import telegram
from ..config import get_settings

# Get limiter from main app
limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/auth", tags=["Authentication"])
settings = get_settings()


def _telegram_webapp_user(init_data: str) -> dict:
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    received_hash = pairs.pop("hash", None)
    if not received_hash:
        raise HTTPException(status_code=401, detail="Telegram session is missing")
    check_string = "\n".join(f"{key}={pairs[key]}" for key in sorted(pairs))
    secret = hmac.new(b"WebAppData", settings.telegram_bot_token.encode(), hashlib.sha256).digest()
    expected_hash = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_hash, received_hash):
        raise HTTPException(status_code=401, detail="Invalid Telegram session")
    try:
        auth_date = int(pairs.get("auth_date", "0"))
        user = json.loads(pairs["user"])
    except (ValueError, KeyError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Invalid Telegram session data")
    if auth_date <= 0 or time.time() - auth_date > 86400:
        raise HTTPException(status_code=401, detail="Telegram session has expired")
    if not isinstance(user, dict) or not user.get("id"):
        raise HTTPException(status_code=401, detail="Telegram user is missing")
    return user


def _device_name(user_agent: str) -> str:
    value = (user_agent or "").lower()
    platform = "آیفون/آیپد" if "iphone" in value or "ipad" in value else "اندروید" if "android" in value else "ویندوز" if "windows" in value else "مک" if "macintosh" in value else "دستگاه"
    browser = "تلگرام" if "telegram" in value else "کروم" if "chrome" in value else "سافاری" if "safari" in value else "مرورگر"
    return f"{browser} روی {platform}"


def _new_session(request: Request, user: User) -> AuthSession:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return AuthSession(
        id=uuid.uuid4().hex,
        user_id=user.id,
        device_name=_device_name(request.headers.get("user-agent", "")),
        user_agent=request.headers.get("user-agent"),
        ip_address=forwarded or (request.client.host if request.client else None),
    )


async def _session_for_device(db: AsyncSession, request: Request, user: User) -> AuthSession:
    """Reuse one revocable session per browser installation instead of per reconnect."""
    device_id = request.headers.get("x-komod-device-id", "").strip()[:128]
    if not device_id:
        return _new_session(request, user)

    session_id = f"device-{hashlib.sha256(f'komod:{user.id}:{device_id}'.encode()).hexdigest()[:57]}"
    session = await db.get(AuthSession, session_id)
    now = datetime.utcnow()
    user_agent = request.headers.get("user-agent")
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    ip_address = forwarded or (request.client.host if request.client else None)
    if session is None:
        # Clean up legacy duplicate sessions created by repeated Mini App logins
        # before stable device IDs were introduced.
        duplicates = (await db.execute(select(AuthSession).where(
            AuthSession.user_id == user.id,
            AuthSession.user_agent == user_agent,
            AuthSession.revoked_at.is_(None),
        ))).scalars().all()
        for duplicate in duplicates:
            duplicate.revoked_at = now
        session = AuthSession(
            id=session_id,
            user_id=user.id,
            device_name=_device_name(user_agent or ""),
            user_agent=user_agent,
            ip_address=ip_address,
            created_at=now,
            last_seen_at=now,
        )
    else:
        session.device_name = _device_name(user_agent or "")
        session.user_agent = user_agent
        session.ip_address = ip_address
        session.last_seen_at = now
        session.revoked_at = None
    return session



@router.get("/bot/info", response_model=BotInfoResponse)
async def get_bot_info_endpoint():
    """Get bot username and name for the login screen."""
    try:
        me = await telegram.tg_client.get_me()
        return BotInfoResponse(
            username=me.username,
            name=f"{me.first_name} {me.last_name or ''}".strip(),
            server_version="1.0.0"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/refresh", response_model=Token)
async def refresh_token(
    request: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
):
    """Refresh access token using refresh token."""
    payload = verify_token_payload(request.refresh_token, token_type="refresh")
    telegram_id = int(payload.get("sub")) if payload and payload.get("sub") else None
    token_version = payload.get("ver") if payload else None
    session_id = payload.get("sid") if payload else None
    
    if not telegram_id:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    
    # Verify user exists
    result = await db.execute(
        select(User).where(User.telegram_id == telegram_id)
    )
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")
    
    if token_version is not None and token_version < user.auth_version:
        raise HTTPException(status_code=401, detail="Refresh token has been invalidated")
    if session_id:
        session = await db.get(AuthSession, session_id)
        if session is None or session.user_id != user.id or session.revoked_at is not None:
            raise HTTPException(status_code=401, detail="Session has been revoked")
        session.last_seen_at = datetime.utcnow()
        await db.commit()
    
    # Generate new tokens
    new_access_token = create_access_token(telegram_id, version=user.auth_version, session_id=session_id)
    new_refresh_token = create_refresh_token(telegram_id, version=user.auth_version, session_id=session_id)
    
    return Token(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
    )


@router.post("/logout-all")
async def logout_all(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Invalidate all active sessions for the current user."""
    current_user.auth_version += 1
    sessions = (await db.execute(select(AuthSession).where(AuthSession.user_id == current_user.id, AuthSession.revoked_at.is_(None)))).scalars().all()
    for session in sessions:
        session.revoked_at = datetime.utcnow()
    db.add(current_user)
    await db.commit()
    return {"message": "All sessions have been invalidated"}


@router.get("/sessions", response_model=list[SessionResponse])
async def list_sessions(request: Request, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    credentials = request.headers.get("authorization", "").removeprefix("Bearer ")
    payload = verify_token_payload(credentials) if credentials else None
    current_id = payload.get("sid") if payload else None
    sessions = (await db.execute(select(AuthSession).where(
        AuthSession.user_id == current_user.id, AuthSession.revoked_at.is_(None)
    ).order_by(AuthSession.last_seen_at.desc()))).scalars().all()
    return [SessionResponse(id=item.id, device_name=item.device_name, user_agent=item.user_agent, ip_address=item.ip_address, created_at=item.created_at, last_seen_at=item.last_seen_at, current=item.id == current_id) for item in sessions]


@router.delete("/sessions/{session_id}", status_code=204)
async def revoke_session(session_id: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    session = (await db.execute(select(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == current_user.id))).scalar_one_or_none()
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    session.revoked_at = datetime.utcnow()
    await db.commit()
    return None


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
):
    """Get current authenticated user information."""
    return UserResponse(
        id=current_user.id,
        telegram_id=current_user.telegram_id,
        username=current_user.username,
        first_name=current_user.first_name,
        last_name=current_user.last_name,
        created_at=current_user.created_at,
        last_active=current_user.last_active,
        display_name=current_user.display_name,
        is_active=current_user.is_active,
        is_admin=current_user.telegram_id in settings.admin_users,
    )


@router.post("/session", response_model=AuthResponse)
async def register_current_session(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Turn a Telegram Mini App access link into a revocable device session."""
    session = await _session_for_device(db, request, current_user)
    db.add(session)
    await db.commit()
    return AuthResponse(
        access_token=create_access_token(current_user.telegram_id, current_user.auth_version, session.id),
        refresh_token=create_refresh_token(current_user.telegram_id, current_user.auth_version, session.id),
        user=UserResponse(
            id=current_user.id, telegram_id=current_user.telegram_id, username=current_user.username,
            first_name=current_user.first_name, last_name=current_user.last_name,
            display_name=current_user.display_name, is_active=current_user.is_active,
            is_admin=current_user.telegram_id in settings.admin_users,
            created_at=current_user.created_at, last_active=current_user.last_active,
        ),
    )


@router.post("/telegram-webapp", response_model=AuthResponse)
async def login_from_telegram_webapp(
    request: Request,
    payload: TelegramWebAppRequest,
    db: AsyncSession = Depends(get_db),
):
    """Authenticate the Telegram account that opened the persistent Mini App button."""
    tg_user = _telegram_webapp_user(payload.init_data)
    telegram_id = int(tg_user["id"])
    if settings.auth_users and telegram_id not in settings.auth_users:
        raise HTTPException(status_code=403, detail="This Telegram account is not authorized")
    user = (await db.execute(select(User).where(User.telegram_id == telegram_id))).scalar_one_or_none()
    if user is None:
        user = User(
            telegram_id=telegram_id,
            username=tg_user.get("username"),
            first_name=tg_user.get("first_name"),
            last_name=tg_user.get("last_name"),
        )
        db.add(user)
        await db.flush()
    else:
        user.username = tg_user.get("username")
        user.first_name = tg_user.get("first_name")
        user.last_name = tg_user.get("last_name")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="User account is inactive")
    session = await _session_for_device(db, request, user)
    db.add(session)
    await db.commit()
    return AuthResponse(
        access_token=create_access_token(user.telegram_id, user.auth_version, session.id),
        refresh_token=create_refresh_token(user.telegram_id, user.auth_version, session.id),
        user=UserResponse(
            id=user.id, telegram_id=user.telegram_id, username=user.username,
            first_name=user.first_name, last_name=user.last_name,
            display_name=user.display_name, is_active=user.is_active,
            is_admin=user.telegram_id in settings.admin_users,
            created_at=user.created_at, last_active=user.last_active,
        ),
    )


@router.post("/generate-code", response_model=LoginCodeResponse)
async def generate_login_code(
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a new login code for TV/Device authentication.
    The code is displayed to the user and entered in the Telegram bot.
    """
    # Generate unique 6-digit code
    import secrets
    import string
    
    alphabet = string.ascii_uppercase + string.digits
    code = ''.join(secrets.choice(alphabet) for _ in range(6))
    
    # Expiry in 5 minutes
    expires_at = datetime.utcnow().replace(minute=(datetime.utcnow().minute + 5) % 60)
    if expires_at < datetime.utcnow(): # Handle hour rollover roughly
        from datetime import timedelta
        expires_at = datetime.utcnow() + timedelta(minutes=5)
        
    login_code = LoginCode(
        code=code,
        telegram_id=None, # Initially null, set by bot
        expires_at=expires_at
    )
    db.add(login_code)
    await db.commit()
    await db.refresh(login_code)
    
    return LoginCodeResponse(
        code=code,
        expires_at=expires_at
    )


@router.post("/verify-code", response_model=AuthResponse)
@limiter.limit("40/minute")  # Allow TV polling while limiting brute force attempts
async def verify_login_code(
    request: Request,  # Required for rate limiter
    code_request: VerifyCodeRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Check if the login code has been claimed by a user via Telegram bot.
    If claimed, returns access tokens and user info.
    """
    # Find code (case-insensitive)
    result = await db.execute(
        select(LoginCode).where(LoginCode.code == code_request.code.upper())
    )
    login_code = result.scalar_one_or_none()
    
    if not login_code:
        raise HTTPException(status_code=400, detail="Invalid login code")
        
    if login_code.expires_at < datetime.utcnow():
        await db.delete(login_code)
        await db.commit()
        raise HTTPException(status_code=400, detail="Login code expired")
    
    # Check if user has claimed it (telegram_id is set)
    if not login_code.telegram_id:
        raise HTTPException(status_code=400, detail="Code not yet verified")
        
    # Get user
    result = await db.execute(
        select(User).where(User.telegram_id == login_code.telegram_id)
    )
    user = result.scalar_one_or_none()
    
    if not user:
        # Should not happen if bot flow is correct
        raise HTTPException(status_code=404, detail="User not found")
        
    # Generate tokens
    session = await _session_for_device(db, request, user)
    db.add(session)
    await db.flush()
    access_token = create_access_token(user.telegram_id, version=user.auth_version, session_id=session.id)
    refresh_token = create_refresh_token(user.telegram_id, version=user.auth_version, session_id=session.id)
    
    # Delete code after successful login
    await db.delete(login_code)
    await db.commit()
    
    return AuthResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        user=UserResponse.model_validate(user, from_attributes=True)
    )


# Keep this for backward compatibility or direct code login if needed, 
# but verify-code is the main one for TV flow now.
@router.post("/code", response_model=AuthResponse)
async def login_with_code(
    request: Request,
    code_request: LoginCodeRequest,
    db: AsyncSession = Depends(get_db),
):
   """Legacy endpoint - use verify-code instead."""
   # Same logic as verify-code but returns only Token
   # ... (reusing logic or redirecting)
   return await verify_login_code(
       request,
       VerifyCodeRequest(code=code_request.code),
       db
   )
