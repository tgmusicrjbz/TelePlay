"""Temporary synchronized media rooms with chat and WebRTC signaling."""
import asyncio
import json
import os
import time
import uuid
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response, WebSocket, WebSocketDisconnect
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import create_room_stream_token, get_current_user, verify_token_payload
from ..config import get_settings
from ..database import async_session, get_db
from ..models import File, PlaylistItem, RoomItem, RoomMember, RoomMessage, User, WatchRoom
from ..services import add_urls_to_file

router = APIRouter(prefix="/rooms", tags=["Rooms"])
settings = get_settings()
passwords = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
THEMES = {"violet", "midnight", "rose", "ocean", "forest", "amber"}
MAX_ACTIVE_ROOMS = 20
MAX_USER_ROOMS = 3
MAX_MEMBERS = 12
MAX_VOICE_MEMBERS = 6


class RoomCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    theme: str = "violet"
    password: str | None = Field(default=None, max_length=100)
    expires_in_minutes: int = Field(default=180, ge=15, le=10080)
    max_members: int = Field(default=8, ge=2, le=MAX_MEMBERS)
    chat_enabled: bool = True
    voice_enabled: bool = True
    playlist_id: int | None = None
    file_ids: list[int] = Field(default_factory=list, max_length=100)
    allowed_users: list[str] = Field(default_factory=list, max_length=50)
    controllers: list[str] = Field(default_factory=list, max_length=20)


class RoomUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    theme: str | None = None
    password: str | None = Field(default=None, max_length=100)
    clear_password: bool = False
    expires_in_minutes: int | None = Field(default=None, ge=15, le=10080)
    max_members: int | None = Field(default=None, ge=2, le=MAX_MEMBERS)
    chat_enabled: bool | None = None
    voice_enabled: bool | None = None


class RoomJoin(BaseModel):
    password: str | None = None


class RoomItemsUpdate(BaseModel):
    file_ids: list[int] = Field(max_length=100)


class RoomMemberInput(BaseModel):
    identifier: str = Field(min_length=1, max_length=255)
    role: Literal["viewer", "controller"] = "viewer"


class RoomMembersUpdate(BaseModel):
    members: list[RoomMemberInput] = Field(max_length=50)


def _is_admin(user: User) -> bool:
    return user.telegram_id in settings.admin_users


def _name(user: User) -> str:
    return user.display_name or " ".join(filter(None, [user.first_name, user.last_name])) or (f"@{user.username}" if user.username else str(user.telegram_id))


async def _room(db: AsyncSession, room_id: str) -> WatchRoom:
    room = await db.get(WatchRoom, room_id)
    if room is None:
        raise HTTPException(404, "روم پیدا نشد.")
    if room.expires_at <= datetime.utcnow():
        raise HTTPException(410, "زمان این روم تمام شده است.")
    return room


async def _cleanup_expired(db: AsyncSession) -> None:
    result = await db.execute(delete(WatchRoom).where(WatchRoom.expires_at <= datetime.utcnow()))
    if result.rowcount: await db.commit()


async def _member(db: AsyncSession, room_id: str, user_id: int) -> RoomMember | None:
    return (await db.execute(select(RoomMember).where(RoomMember.room_id == room_id, RoomMember.user_id == user_id))).scalar_one_or_none()


async def _require_member(db: AsyncSession, room: WatchRoom, user: User) -> RoomMember:
    member = await _member(db, room.id, user.id)
    if member is None:
        raise HTTPException(403, "برای ورود به این روم باید دعوت یا رمز داشته باشی.")
    return member


async def _resolve_users(db: AsyncSession, identifiers: list[str]) -> list[User]:
    result: list[User] = []
    seen: set[int] = set()
    for raw in identifiers:
        value = raw.strip().lstrip("@").lower()
        if not value:
            continue
        condition = User.telegram_id == int(value) if value.lstrip("-").isdigit() else func.lower(User.username) == value
        user = (await db.execute(select(User).where(condition, User.is_active.is_(True)))).scalar_one_or_none()
        if user is None:
            raise HTTPException(422, f"کاربر «{raw}» در کمد پیدا نشد.")
        if user.id not in seen:
            seen.add(user.id); result.append(user)
    return result


async def _files(db: AsyncSession, room: WatchRoom) -> list[File]:
    statement = select(File).options(selectinload(File.watch_progress)).join(
        RoomItem, RoomItem.file_id == File.id
    ).where(RoomItem.room_id == room.id).order_by(RoomItem.position, RoomItem.id)
    return list((await db.execute(statement)).scalars().all())


def _room_file(file: File, room: WatchRoom, owner: User, viewer: User) -> dict:
    data = add_urls_to_file(file)
    token = create_room_stream_token(owner.telegram_id, viewer.id, room.id, file.id, room.expires_at)
    for key in ("stream_url", "thumbnail_url", "audio_stream_url", "compatible_video_stream_url"):
        value = data.get(key)
        if value:
            data[key] = f"{value}{'&' if '?' in value else '?'}token={token}"
    return data


async def _serialize(db: AsyncSession, room: WatchRoom, viewer: User, include_messages: bool = False) -> dict:
    owner = await db.get(User, room.owner_user_id)
    rows = (await db.execute(select(RoomMember, User).join(User, User.id == RoomMember.user_id).where(RoomMember.room_id == room.id).order_by(RoomMember.joined_at))).all()
    files = await _files(db, room)
    payload = {
        "id": room.id, "name": room.name, "theme": room.theme, "has_password": bool(room.password_hash),
        "max_members": room.max_members, "chat_enabled": room.chat_enabled, "voice_enabled": room.voice_enabled,
        "current_index": room.current_index, "playback_position": room.playback_position, "playback_rate": room.playback_rate,
        "is_playing": room.is_playing, "state_updated_at": room.state_updated_at, "expires_at": room.expires_at,
        "created_at": room.created_at, "owner_user_id": room.owner_user_id, "owner_name": _name(owner),
        "my_role": next((member.role for member, user in rows if user.id == viewer.id), None),
        "members": [{"user_id": user.id, "telegram_id": user.telegram_id, "name": _name(user), "username": user.username, "role": member.role} for member, user in rows],
        "items": [_room_file(file, room, owner, viewer) for file in files],
    }
    if include_messages:
        messages = list(reversed((await db.execute(select(RoomMessage, User).join(User, User.id == RoomMessage.user_id).where(RoomMessage.room_id == room.id).order_by(RoomMessage.created_at.desc()).limit(80))).all()))
        payload["messages"] = [{"id": message.id, "user_id": user.id, "name": _name(user), "content": message.content, "created_at": message.created_at} for message, user in messages]
    return payload


@router.get("")
async def list_rooms(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _cleanup_expired(db)
    rooms = (await db.execute(select(WatchRoom).join(RoomMember, RoomMember.room_id == WatchRoom.id).where(RoomMember.user_id == user.id, WatchRoom.expires_at > datetime.utcnow()).order_by(WatchRoom.updated_at.desc()))).scalars().all()
    return [await _serialize(db, room, user) for room in rooms]


@router.post("", status_code=201)
async def create_room(payload: RoomCreate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await _cleanup_expired(db)
    if not (_is_admin(user) or user.can_create_rooms):
        raise HTTPException(403, "مدیر هنوز اجازه ساخت روم را برای حسابت فعال نکرده است.")
    global_count = (await db.execute(select(func.count(WatchRoom.id)).where(WatchRoom.expires_at > datetime.utcnow()))).scalar_one()
    own_count = (await db.execute(select(func.count(WatchRoom.id)).where(WatchRoom.owner_user_id == user.id, WatchRoom.expires_at > datetime.utcnow()))).scalar_one()
    if global_count >= MAX_ACTIVE_ROOMS or (not _is_admin(user) and own_count >= MAX_USER_ROOMS):
        raise HTTPException(429, "سقف روم‌های هم‌زمان پر شده است؛ یکی از روم‌های قبلی را ببند.")
    theme = payload.theme if payload.theme in THEMES else "violet"
    room = WatchRoom(id=str(uuid.uuid4()), owner_user_id=user.id, name=payload.name.strip(), theme=theme,
        password_hash=passwords.hash(payload.password) if payload.password else None, max_members=payload.max_members,
        chat_enabled=payload.chat_enabled, voice_enabled=payload.voice_enabled,
        expires_at=datetime.utcnow() + timedelta(minutes=payload.expires_in_minutes), state_updated_at=datetime.utcnow())
    db.add(room); await db.flush()
    db.add(RoomMember(room_id=room.id, user_id=user.id, role="owner"))
    allowed = await _resolve_users(db, payload.allowed_users)
    controllers = await _resolve_users(db, payload.controllers)
    roles = {candidate.id: "viewer" for candidate in allowed}; roles.update({candidate.id: "controller" for candidate in controllers})
    if len({user.id, *roles.keys()}) > room.max_members:
        raise HTTPException(422, "تعداد افراد دعوت‌شده از ظرفیت روم بیشتر است.")
    for user_id, role in roles.items():
        if user_id != user.id: db.add(RoomMember(room_id=room.id, user_id=user_id, role=role))
    file_ids = list(dict.fromkeys(payload.file_ids))
    if payload.playlist_id:
        file_ids += [value for value in (await db.execute(select(PlaylistItem.file_id).where(PlaylistItem.playlist_id == payload.playlist_id).order_by(PlaylistItem.position))).scalars().all() if value not in file_ids]
    if file_ids:
        owned = set((await db.execute(select(File.id).where(File.id.in_(file_ids), File.user_id == user.id, File.is_hidden.is_(False), File.file_type.in_(("audio", "video"))))).scalars().all())
        if owned != set(file_ids): raise HTTPException(422, "فقط فایل‌های صوتی و ویدیویی کمد خودت قابل افزودن هستند.")
        for position, file_id in enumerate(file_ids): db.add(RoomItem(room_id=room.id, file_id=file_id, position=position))
    await db.commit()
    return await _serialize(db, room, user, True)


@router.post("/{room_id}/join")
async def join_room(room_id: str, payload: RoomJoin, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    room = await _room(db, room_id)
    existing = await _member(db, room.id, user.id)
    if existing is None:
        if not room.password_hash or not payload.password or not passwords.verify(payload.password, room.password_hash):
            raise HTTPException(403, "رمز روم درست نیست یا برای ورود دعوت نشده‌ای.")
        count = (await db.execute(select(func.count(RoomMember.id)).where(RoomMember.room_id == room.id))).scalar_one()
        if count >= room.max_members: raise HTTPException(409, "ظرفیت روم تکمیل شده است.")
        db.add(RoomMember(room_id=room.id, user_id=user.id, role="viewer")); await db.commit()
    return await _serialize(db, room, user, True)


@router.get("/{room_id}")
async def get_room(room_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    room = await _room(db, room_id); await _require_member(db, room, user)
    return await _serialize(db, room, user, True)


@router.get("/{room_id}/ice")
async def get_ice_servers(room_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    room = await _room(db, room_id); await _require_member(db, room, user)
    servers: list[dict] = [{"urls": ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]}]
    if os.getenv("KOMOD_TURN_URL"):
        servers.append({"urls": os.environ["KOMOD_TURN_URL"], "username": os.getenv("KOMOD_TURN_USERNAME", ""), "credential": os.getenv("KOMOD_TURN_CREDENTIAL", "")})
    return {"iceServers": servers, "turn_configured": len(servers) > 1}


@router.patch("/{room_id}")
async def update_room(room_id: str, payload: RoomUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    room = await _room(db, room_id); member = await _require_member(db, room, user)
    if member.role != "owner": raise HTTPException(403, "فقط سازنده روم می‌تواند تنظیمات را تغییر دهد.")
    changes = payload.model_dump(exclude_unset=True)
    if payload.max_members is not None:
        member_count = (await db.execute(select(func.count(RoomMember.id)).where(RoomMember.room_id == room.id))).scalar_one()
        if payload.max_members < member_count: raise HTTPException(422, "ظرفیت نمی‌تواند از تعداد اعضای فعلی کمتر باشد.")
    for key in ("name", "max_members", "chat_enabled", "voice_enabled"):
        if key in changes: setattr(room, key, changes[key].strip() if key == "name" else changes[key])
    if payload.theme is not None: room.theme = payload.theme if payload.theme in THEMES else room.theme
    if payload.clear_password: room.password_hash = None
    elif "password" in payload.model_fields_set and payload.password: room.password_hash = passwords.hash(payload.password)
    if payload.expires_in_minutes is not None: room.expires_at = datetime.utcnow() + timedelta(minutes=payload.expires_in_minutes)
    await db.commit(); return await _serialize(db, room, user, True)


@router.put("/{room_id}/items")
async def update_items(room_id: str, payload: RoomItemsUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    room = await _room(db, room_id); member = await _require_member(db, room, user)
    if member.role not in ("owner", "controller"): raise HTTPException(403, "اجازه تغییر صف را نداری.")
    file_ids = list(dict.fromkeys(payload.file_ids))
    owned = set((await db.execute(select(File.id).where(File.id.in_(file_ids), File.user_id == room.owner_user_id, File.is_hidden.is_(False), File.file_type.in_(("audio", "video"))))).scalars().all()) if file_ids else set()
    if owned != set(file_ids): raise HTTPException(422, "بعضی فایل‌ها برای این روم قابل استفاده نیستند.")
    await db.execute(delete(RoomItem).where(RoomItem.room_id == room.id))
    for position, file_id in enumerate(file_ids): db.add(RoomItem(room_id=room.id, file_id=file_id, position=position))
    room.current_index = min(room.current_index, max(0, len(file_ids)-1)); room.playback_position = 0; room.is_playing = False; room.state_updated_at = datetime.utcnow()
    await db.commit(); await hub.broadcast(room.id, {"type":"queue_changed"}); return await _serialize(db, room, user, True)


@router.put("/{room_id}/members")
async def update_members(room_id: str, payload: RoomMembersUpdate, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    room = await _room(db, room_id); member = await _require_member(db, room, user)
    if member.role != "owner": raise HTTPException(403, "فقط سازنده روم می‌تواند اعضا را مدیریت کند.")
    resolved = [(await _resolve_users(db, [item.identifier]))[0] for item in payload.members]
    if len({room.owner_user_id, *(target.id for target in resolved)}) > room.max_members:
        raise HTTPException(422, "تعداد اعضا از ظرفیت روم بیشتر است.")
    await db.execute(delete(RoomMember).where(RoomMember.room_id == room.id, RoomMember.user_id != room.owner_user_id))
    for item, target in zip(payload.members, resolved):
        if target.id != room.owner_user_id: db.add(RoomMember(room_id=room.id, user_id=target.id, role=item.role))
    await db.commit(); await hub.broadcast(room.id, {"type":"members_changed"}); return await _serialize(db, room, user, True)


@router.delete("/{room_id}", status_code=204)
async def delete_room(room_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    room = await _room(db, room_id)
    if room.owner_user_id != user.id and not _is_admin(user): raise HTTPException(403, "اجازه حذف این روم را نداری.")
    await hub.broadcast(room.id, {"type":"room_closed"}); await db.delete(room); await db.commit(); return Response(status_code=204)


class RoomHub:
    def __init__(self):
        self.connections: dict[str, dict[int, WebSocket]] = {}
        self.voice: dict[str, set[int]] = {}
        self.lock = asyncio.Lock()

    async def connect(self, room_id: str, user_id: int, socket: WebSocket) -> bool:
        async with self.lock:
            room = self.connections.setdefault(room_id, {})
            room[user_id] = socket
            return True

    async def disconnect(self, room_id: str, user_id: int):
        async with self.lock:
            self.connections.get(room_id, {}).pop(user_id, None)
            self.voice.get(room_id, set()).discard(user_id)
        await self.broadcast(room_id, {"type":"presence", "user_id":user_id, "online":False})
        await self.broadcast(room_id, {"type":"voice_left", "user_id":user_id})

    async def send(self, room_id: str, user_id: int, payload: dict):
        socket = self.connections.get(room_id, {}).get(user_id)
        if socket:
            try: await socket.send_json(payload)
            except Exception: pass

    async def broadcast(self, room_id: str, payload: dict, exclude: int | None = None):
        sockets = list(self.connections.get(room_id, {}).items())
        await asyncio.gather(*(socket.send_json(payload) for uid, socket in sockets if uid != exclude), return_exceptions=True)


hub = RoomHub()


@router.websocket("/{room_id}/ws")
async def room_socket(websocket: WebSocket, room_id: str):
    token = websocket.query_params.get("token", "")
    payload = verify_token_payload(token)
    if not payload: await websocket.close(code=4401); return
    async with async_session() as db:
        user = (await db.execute(select(User).where(User.telegram_id == int(payload["sub"]), User.is_active.is_(True)))).scalar_one_or_none()
        room = await db.get(WatchRoom, room_id)
        member = await _member(db, room_id, user.id) if user and room else None
        if not user or not room or room.expires_at <= datetime.utcnow() or not member: await websocket.close(code=4403); return
        await websocket.accept(); await hub.connect(room_id, user.id, websocket)
        last_chat = 0.0; last_reaction = 0.0
        await websocket.send_json({"type":"ready", "user_id":user.id, "role":member.role, "online_users":list(hub.connections.get(room_id,{})), "voice_users":list(hub.voice.get(room_id,set()))})
        await hub.broadcast(room_id, {"type":"presence", "user_id":user.id, "name":_name(user), "online":True}, exclude=user.id)
        try:
            while True:
                remaining = (room.expires_at - datetime.utcnow()).total_seconds()
                if remaining <= 0:
                    await websocket.send_json({"type":"room_expired"}); await websocket.close(code=4000); break
                try:
                    data = await asyncio.wait_for(websocket.receive_json(), timeout=min(60, remaining))
                except asyncio.TimeoutError:
                    continue
                kind = data.get("type")
                if kind == "ping": await websocket.send_json({"type":"pong"}); continue
                if kind == "sync" and member.role in ("owner", "controller"):
                    room.current_index = max(0, min(int(data.get("index",0)), max(0, len(await _files(db, room))-1)))
                    room.playback_position = max(0.0, float(data.get("position",0)))
                    room.playback_rate = max(.5, min(2.0, float(data.get("rate",1))))
                    room.is_playing = bool(data.get("playing")); room.state_updated_at = datetime.utcnow(); await db.commit()
                    await hub.broadcast(room_id, {"type":"sync", "index":room.current_index, "position":room.playback_position, "rate":room.playback_rate, "playing":room.is_playing, "sent_at":datetime.utcnow().timestamp(), "by":user.id}, exclude=user.id)
                elif kind == "chat" and room.chat_enabled:
                    now = time.monotonic()
                    if now - last_chat < 0.6: continue
                    last_chat = now
                    text = str(data.get("text", "")).strip()[:500]
                    if text:
                        message=RoomMessage(room_id=room_id,user_id=user.id,content=text);db.add(message);await db.commit();await db.refresh(message)
                        if message.id % 20 == 0:
                            stale_ids = (await db.execute(select(RoomMessage.id).where(RoomMessage.room_id == room_id).order_by(RoomMessage.created_at.desc()).offset(200))).scalars().all()
                            if stale_ids: await db.execute(delete(RoomMessage).where(RoomMessage.id.in_(stale_ids))); await db.commit()
                        await hub.broadcast(room_id,{"type":"chat","message":{"id":message.id,"user_id":user.id,"name":_name(user),"content":text,"created_at":message.created_at.isoformat()}})
                elif kind == "reaction":
                    now = time.monotonic()
                    if now - last_reaction < 0.3: continue
                    last_reaction = now
                    emoji = str(data.get("emoji", ""))[:12]
                    if emoji in {"❤️","😂","👏","🔥","😮","😢","🎉","👍"}: await hub.broadcast(room_id,{"type":"reaction","user_id":user.id,"name":_name(user),"emoji":emoji})
                elif kind == "voice_join" and room.voice_enabled:
                    voice = hub.voice.setdefault(room_id,set())
                    if user.id not in voice and len(voice) >= MAX_VOICE_MEMBERS: await websocket.send_json({"type":"voice_error","message":"ظرفیت ویس روم تکمیل شده است."})
                    else:
                        peers = list(voice); voice.add(user.id)
                        await websocket.send_json({"type":"voice_peers","user_ids":peers})
                        await hub.broadcast(room_id,{"type":"voice_joined","user_id":user.id,"name":_name(user)},exclude=user.id)
                elif kind == "voice_leave":
                    hub.voice.get(room_id,set()).discard(user.id); await hub.broadcast(room_id,{"type":"voice_left","user_id":user.id},exclude=user.id)
                elif kind == "signal":
                    target=int(data.get("target",0));
                    if target in hub.voice.get(room_id,set()): await hub.send(room_id,target,{"type":"signal","from":user.id,"signal":data.get("signal")})
        except (WebSocketDisconnect, RuntimeError, ValueError, TypeError):
            pass
        finally:
            await hub.disconnect(room_id, user.id)
