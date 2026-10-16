"""Account switching, shared spaces and administrator controls."""
import json
import hashlib
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from passlib.context import CryptContext
from pyrogram.enums import ChatMemberStatus, ChatType
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..auth import create_vault_token, get_current_user, require_vault_access
from ..config import get_settings
from ..database import get_db
from ..models import AuthSession, File, Folder, Playlist, PlaylistItem, ProcessingJob, SecurityEvent, TTSUsage, User, WorkspaceGrant
from ..schemas import AccountPreferences, AdminHealthResponse, AdminStatsResponse, AdminUserCreate, AdminUserResponse, AdminUserUpdate, SavedFilter, SavedFiltersUpdate, ServiceHealthItem, StorageChannelResponse, StorageChannelUpdate, StuckJobResponse, TagDefinitionResponse, TagSettingsResponse, TagSettingsUpdate, VaultPasswordRequest, VaultStatus, VaultTokenResponse, WorkspaceGrantCreate, WorkspaceResponse
from .. import telegram
from ..audit import add_security_event
from ..services import sanitize_filename

router = APIRouter(tags=["Accounts"])
settings = get_settings()
vault_password_context = CryptContext(schemes=["pbkdf2_sha256"], pbkdf2_sha256__default_rounds=600_000, deprecated="auto")
limiter = Limiter(key_func=get_remote_address)


@router.get("/accounts/security-events")
async def security_events(
    limit: int = 30,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return a compact, user-owned audit trail without exposing stored secrets."""
    safe_limit = max(1, min(limit, 100))
    events = (await db.execute(select(SecurityEvent).where(
        SecurityEvent.user_id == current_user.id,
    ).order_by(SecurityEvent.created_at.desc()).limit(safe_limit))).scalars().all()
    return [{
        "id": item.id,
        "event_type": item.event_type,
        "success": item.success,
        "suspicious": item.suspicious,
        "target_type": item.target_type,
        "ip_address": item.ip_address,
        "device": item.user_agent,
        "created_at": item.created_at,
    } for item in events]


@router.get("/accounts/export")
async def export_account_data(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Download a portable metadata backup. Passwords, tokens and API keys are excluded."""
    folders = (await db.execute(select(Folder).where(Folder.user_id == current_user.id).order_by(Folder.id))).scalars().all()
    files = (await db.execute(select(File).where(File.user_id == current_user.id).order_by(File.id))).scalars().all()
    playlists = (await db.execute(select(Playlist).where(
        Playlist.user_id == current_user.id,
    ).options(selectinload(Playlist.items).selectinload(PlaylistItem.file)).order_by(Playlist.position, Playlist.id))).scalars().all()

    def parsed(value: str | None, fallback):
        try:
            return json.loads(value or "")
        except (TypeError, ValueError, json.JSONDecodeError):
            return fallback

    payload = {
        "format": "komod-account-export",
        "version": 1,
        "exported_at": datetime.utcnow().isoformat() + "Z",
        "account": {
            "telegram_id": current_user.telegram_id,
            "username": current_user.username,
            "display_name": current_user.display_name,
        },
        "preferences": {
            "delete_storage_files": current_user.delete_storage_files,
            "show_file_tags": current_user.show_file_tags,
            "file_tag_limit": current_user.file_tag_limit,
            "tag_settings": parsed(current_user.tag_settings_json, []),
            "saved_filters": parsed(current_user.saved_filters_json, []),
            "tts_settings": parsed(current_user.tts_settings_json, {}),
        },
        "folders": [{
            "id": item.id, "parent_id": item.parent_id, "name": item.name,
            "description": item.description, "color": item.color, "icon": item.icon,
            "is_favorite": item.is_favorite, "is_pinned": item.is_pinned,
            "is_hidden": item.is_hidden, "is_default": item.is_default,
        } for item in folders],
        "files": [{
            "file_unique_id": item.file_unique_id, "folder_id": item.folder_id,
            "file_name": item.file_name, "description": item.description,
            "tags": parsed(item.tags_json, []), "file_type": item.file_type,
            "file_size": item.file_size, "duration": item.duration,
            "is_favorite": item.is_favorite, "is_pinned": item.is_pinned,
            "is_hidden": item.is_hidden, "created_at": item.created_at.isoformat(),
        } for item in files],
        "playlists": [{
            "name": item.name, "description": item.description, "position": item.position,
            "items": [entry.file.file_unique_id for entry in item.items if entry.file],
        } for item in playlists],
    }
    content = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
    return Response(
        content=content, media_type="application/json; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="komod-backup-{current_user.telegram_id}.json"'},
    )


@router.post("/accounts/import")
@limiter.limit("5/hour")
async def import_account_data(
    request: Request,
    payload: dict = Body(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Safely merge settings and metadata from a Komod export into the current account."""
    if payload.get("format") != "komod-account-export" or payload.get("version") != 1:
        raise HTTPException(status_code=422, detail="این فایل نسخهٔ پشتیبان معتبر کمد نیست.")
    raw_folders = payload.get("folders") if isinstance(payload.get("folders"), list) else []
    raw_files = payload.get("files") if isinstance(payload.get("files"), list) else []
    raw_playlists = payload.get("playlists") if isinstance(payload.get("playlists"), list) else []
    if len(raw_folders) > 5_000 or len(raw_files) > 100_000 or len(raw_playlists) > 2_000:
        raise HTTPException(status_code=413, detail="نسخهٔ پشتیبان بیش از حد بزرگ است.")

    preferences = payload.get("preferences") if isinstance(payload.get("preferences"), dict) else {}
    if "delete_storage_files" in preferences:
        current_user.delete_storage_files = bool(preferences["delete_storage_files"])
    current_user.show_file_tags = bool(preferences.get("show_file_tags", current_user.show_file_tags))
    current_user.file_tag_limit = max(1, min(int(preferences.get("file_tag_limit", current_user.file_tag_limit) or 2), 6))
    tag_settings = preferences.get("tag_settings")
    if isinstance(tag_settings, list):
        current_user.tag_settings_json = json.dumps(clean_tag_definitions(tag_settings), ensure_ascii=False)
    saved_filters = preferences.get("saved_filters")
    if isinstance(saved_filters, list):
        current_user.saved_filters_json = json.dumps(clean_saved_filters(saved_filters), ensure_ascii=False)
    tts_settings = preferences.get("tts_settings")
    if isinstance(tts_settings, dict):
        # Preferences contain no API keys; unknown values remain bounded by JSON size.
        encoded_tts = json.dumps(tts_settings, ensure_ascii=False)
        if len(encoded_tts) <= 50_000:
            current_user.tts_settings_json = encoded_tts

    folders = (await db.execute(select(Folder).where(Folder.user_id == current_user.id))).scalars().all()
    folder_by_key = {(item.parent_id, item.name.casefold()): item for item in folders}
    folder_map: dict[int, int] = {}
    pending = [item for item in raw_folders if isinstance(item, dict) and str(item.get("id", "")).isdigit()]
    created_folders = 0
    for _ in range(len(pending) + 1):
        progressed = False
        for item in list(pending):
            old_id = int(item["id"])
            old_parent = item.get("parent_id")
            if old_parent is not None and str(old_parent).isdigit() and int(old_parent) not in folder_map:
                continue
            parent_id = folder_map.get(int(old_parent)) if old_parent is not None and str(old_parent).isdigit() else None
            name = str(item.get("name") or "کشوی بازیابی‌شده").strip()[:255]
            key = (parent_id, name.casefold())
            folder = folder_by_key.get(key)
            if folder is None:
                folder = Folder(user_id=current_user.id, parent_id=parent_id, name=name)
                db.add(folder); await db.flush()
                folder_by_key[key] = folder
                created_folders += 1
            folder.description = str(item.get("description") or "").strip()[:2_000] or None
            color = str(item.get("color") or "")
            folder.color = color.lower() if len(color) == 7 and color.startswith("#") and all(char in "0123456789abcdefABCDEF" for char in color[1:]) else None
            folder.icon = str(item.get("icon") or "").strip()[:16] or None
            folder.is_favorite = bool(item.get("is_favorite"))
            folder.is_pinned = bool(item.get("is_pinned"))
            folder.is_hidden = bool(item.get("is_hidden")) and bool(current_user.vault_password_hash)
            folder_map[old_id] = folder.id
            pending.remove(item); progressed = True
        if not pending or not progressed:
            break

    files = (await db.execute(select(File).where(File.user_id == current_user.id))).scalars().all()
    files_by_unique = {item.file_unique_id: item for item in files}
    restored_files = 0
    for item in raw_files:
        if not isinstance(item, dict):
            continue
        file = files_by_unique.get(str(item.get("file_unique_id") or ""))
        if file is None:
            continue
        file.file_name = sanitize_filename(str(item.get("file_name") or file.file_name))
        file.description = str(item.get("description") or "").strip()[:10_000] or None
        tags = []
        for value in item.get("tags", []) if isinstance(item.get("tags"), list) else []:
            tag = " ".join(str(value).strip().lstrip("#").split())[:40]
            if tag and tag.casefold() not in {current.casefold() for current in tags}:
                tags.append(tag)
            if len(tags) >= 20:
                break
        file.tags_json = json.dumps(tags, ensure_ascii=False)
        old_folder = item.get("folder_id")
        if old_folder is None:
            file.folder_id = None
        elif str(old_folder).isdigit() and int(old_folder) in folder_map:
            file.folder_id = folder_map[int(old_folder)]
        file.is_favorite = bool(item.get("is_favorite"))
        file.is_pinned = bool(item.get("is_pinned"))
        file.is_hidden = bool(item.get("is_hidden")) and bool(current_user.vault_password_hash)
        restored_files += 1

    playlists = (await db.execute(select(Playlist).where(Playlist.user_id == current_user.id))).scalars().all()
    playlist_by_name = {item.name.casefold(): item for item in playlists}
    playlist_entries: dict[int, list[PlaylistItem]] = {item.id: [] for item in playlists}
    if playlists:
        entries = (await db.execute(select(PlaylistItem).where(
            PlaylistItem.playlist_id.in_([item.id for item in playlists]),
        ).order_by(PlaylistItem.position))).scalars().all()
        for entry in entries:
            playlist_entries.setdefault(entry.playlist_id, []).append(entry)
    restored_playlists = 0
    for raw in raw_playlists:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()[:255]
        if not name:
            continue
        playlist = playlist_by_name.get(name.casefold())
        if playlist is None:
            playlist = Playlist(user_id=current_user.id, name=name, position=len(playlist_by_name))
            db.add(playlist); await db.flush()
            playlist_by_name[name.casefold()] = playlist
            playlist_entries[playlist.id] = []
        playlist.description = str(raw.get("description") or "").strip()[:2_000] or None
        existing_counts: dict[int, int] = {}
        current_entries = playlist_entries.get(playlist.id, [])
        for entry in current_entries:
            existing_counts[entry.file_id] = existing_counts.get(entry.file_id, 0) + 1
        desired_counts: dict[int, int] = {}
        position = max((entry.position for entry in current_entries), default=-1) + 1
        for unique_id in raw.get("items", []) if isinstance(raw.get("items"), list) else []:
            file = files_by_unique.get(str(unique_id))
            if file is None or file.file_type not in {"audio", "video"}:
                continue
            desired_counts[file.id] = desired_counts.get(file.id, 0) + 1
            if desired_counts[file.id] <= existing_counts.get(file.id, 0):
                continue
            entry = PlaylistItem(playlist_id=playlist.id, file_id=file.id, position=position)
            db.add(entry)
            current_entries.append(entry)
            position += 1
        restored_playlists += 1

    add_security_event(
        db, "account_backup_restored", user_id=current_user.id, request=request,
        target_type="account", target_id=current_user.id,
        details={"folders_created": created_folders, "files_restored": restored_files, "playlists": restored_playlists},
    )
    await db.commit()
    return {
        "folders_created": created_folders,
        "folders_skipped": len(pending),
        "files_restored": restored_files,
        "playlists_restored": restored_playlists,
    }


def user_name(user: User) -> str:
    return user.display_name or " ".join(filter(None, [user.first_name, user.last_name])) or user.username or f"کاربر {user.telegram_id}"


def grant_scope(grant: WorkspaceGrant) -> dict[str, list[int]]:
    try:
        raw = json.loads(grant.scope_json or "{}")
    except (TypeError, ValueError, json.JSONDecodeError):
        raw = {}
    return {
        "folder_ids": [int(value) for value in raw.get("folder_ids", []) if str(value).isdigit()],
        "file_ids": [int(value) for value in raw.get("file_ids", []) if str(value).isdigit()],
    }


def workspace_response(user: User, permission: str, grant: WorkspaceGrant | None = None) -> WorkspaceResponse:
    scope = grant_scope(grant) if grant else {"folder_ids": [], "file_ids": []}
    return WorkspaceResponse(user_id=user.id, telegram_id=user.telegram_id, name=user_name(user), username=user.username, permission=permission, **scope)


def clean_tag_definitions(raw_tags) -> list[dict[str, str]]:
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in raw_tags:
        name = str(item.name if hasattr(item, "name") else item.get("name", "")).strip().lstrip("#")[:40]
        color = str(item.color if hasattr(item, "color") else item.get("color", "#a855f7")).lower()
        key = name.casefold()
        if name and key not in seen:
            result.append({"name": name, "color": color})
            seen.add(key)
    return result[:100]


def automatic_tag_color(name: str) -> str:
    """Return a stable readable color for tags first created on a file."""
    palette = ("#a855f7", "#3b82f6", "#06b6d4", "#14b8a6", "#22c55e", "#eab308", "#f97316", "#ec4899")
    digest = hashlib.sha256(name.casefold().encode("utf-8")).digest()
    return palette[digest[0] % len(palette)]


@router.get("/accounts/tags", response_model=TagSettingsResponse)
async def get_tag_settings(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    try:
        stored = json.loads(current_user.tag_settings_json or "[]")
        definitions = clean_tag_definitions(stored if isinstance(stored, list) else [])
    except (TypeError, ValueError, json.JSONDecodeError):
        definitions = []
    counts = {item["name"].casefold(): 0 for item in definitions}
    discovered: dict[str, str] = {}
    rows = (await db.execute(select(File.tags_json).where(File.user_id == current_user.id))).scalars().all()
    for raw in rows:
        try:
            values = json.loads(raw or "[]")
        except (TypeError, ValueError, json.JSONDecodeError):
            values = []
        unique: dict[str, str] = {}
        for raw_tag in values:
            name = " ".join(str(raw_tag).strip().lstrip("#").split())[:40]
            if name:
                unique.setdefault(name.casefold(), name)
        for key, name in unique.items():
            discovered.setdefault(key, name)
            counts[key] = counts.get(key, 0) + 1
    configured = {item["name"].casefold() for item in definitions}
    for key, name in sorted(discovered.items(), key=lambda item: item[1].casefold()):
        if key not in configured and len(definitions) < 100:
            definitions.append({"name": name, "color": automatic_tag_color(name)})
            configured.add(key)
    return TagSettingsResponse(
        tags=[TagDefinitionResponse(**item, file_count=counts.get(item["name"].casefold(), 0)) for item in definitions],
        show_file_tags=current_user.show_file_tags,
        display_limit=max(1, min(current_user.file_tag_limit or 2, 6)),
    )


@router.put("/accounts/tags", response_model=TagSettingsResponse)
async def update_tag_settings(payload: TagSettingsUpdate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    definitions = clean_tag_definitions(payload.tags)
    current_user.tag_settings_json = json.dumps(definitions, ensure_ascii=False)
    current_user.show_file_tags = payload.show_file_tags
    current_user.file_tag_limit = payload.display_limit
    await db.commit()
    return await get_tag_settings(current_user, db)


@router.delete("/accounts/tags/{tag_name}", response_model=TagSettingsResponse)
async def delete_tag_definition(tag_name: str, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    """Delete a tag definition and remove that tag from every file owned by the user."""
    normalized = " ".join(tag_name.strip().lstrip("#").split())[:40]
    if not normalized:
        raise HTTPException(status_code=400, detail="نام تگ معتبر نیست.")
    key = normalized.casefold()
    try:
        stored = json.loads(current_user.tag_settings_json or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        stored = []
    definitions = [item for item in clean_tag_definitions(stored if isinstance(stored, list) else []) if item["name"].casefold() != key]
    current_user.tag_settings_json = json.dumps(definitions, ensure_ascii=False)
    files = (await db.execute(select(File).where(File.user_id == current_user.id))).scalars().all()
    for file in files:
        try:
            tags = json.loads(file.tags_json or "[]")
        except (TypeError, ValueError, json.JSONDecodeError):
            tags = []
        cleaned = [tag for tag in tags if str(tag).strip().lstrip("#").casefold() != key]
        if cleaned != tags:
            file.tags_json = json.dumps(cleaned, ensure_ascii=False)
    await db.commit()
    return await get_tag_settings(current_user, db)


@router.get("/accounts/workspaces", response_model=list[WorkspaceResponse])
async def list_workspaces(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    grants = (await db.execute(select(WorkspaceGrant, User).join(User, User.id == WorkspaceGrant.owner_user_id).where(
        WorkspaceGrant.member_user_id == current_user.id, User.is_active.is_(True)
    ))).all()
    result = [workspace_response(current_user, "owner")]
    result.extend(workspace_response(owner, grant.permission, grant) for grant, owner in grants)
    return result


def clean_saved_filters(raw_filters) -> list[dict]:
    result: list[dict] = []
    seen: set[str] = set()
    for raw in raw_filters if isinstance(raw_filters, list) else []:
        if not isinstance(raw, dict):
            continue
        try:
            item = SavedFilter.model_validate(raw).model_dump()
        except ValueError:
            continue
        if item["id"] in seen:
            continue
        seen.add(item["id"])
        item["name"] = " ".join(item["name"].split())
        item["file_types"] = list(dict.fromkeys(item["file_types"]))
        result.append(item)
        if len(result) >= 20:
            break
    return result


@router.get("/accounts/saved-filters", response_model=list[SavedFilter])
async def get_saved_filters(current_user: User = Depends(get_current_user)):
    try:
        raw = json.loads(current_user.saved_filters_json or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        raw = []
    return clean_saved_filters(raw)


@router.put("/accounts/saved-filters", response_model=list[SavedFilter])
async def update_saved_filters(
    payload: SavedFiltersUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    filters = clean_saved_filters([item.model_dump() for item in payload.filters])
    current_user.saved_filters_json = json.dumps(filters, ensure_ascii=False)
    await db.commit()
    return filters


@router.get("/accounts/grants", response_model=list[WorkspaceResponse])
async def list_grants(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(WorkspaceGrant, User).join(User, User.id == WorkspaceGrant.member_user_id).where(
        WorkspaceGrant.owner_user_id == current_user.id
    ))).all()
    return [workspace_response(member, grant.permission, grant) for grant, member in rows]


@router.post("/accounts/grants", response_model=WorkspaceResponse)
@limiter.limit("20/hour")
async def grant_workspace(request: Request, payload: WorkspaceGrantCreate, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
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
    folder_ids = sorted(set(payload.folder_ids))
    file_ids = sorted(set(payload.file_ids))
    if folder_ids:
        valid_folders = set((await db.execute(select(Folder.id).where(Folder.user_id == current_user.id, Folder.id.in_(folder_ids)))).scalars().all())
        if valid_folders != set(folder_ids):
            raise HTTPException(status_code=400, detail="یکی از کشوهای انتخاب‌شده معتبر نیست.")
    if file_ids:
        valid_files = set((await db.execute(select(File.id).where(File.user_id == current_user.id, File.id.in_(file_ids)))).scalars().all())
        if valid_files != set(file_ids):
            raise HTTPException(status_code=400, detail="یکی از فایل‌های انتخاب‌شده معتبر نیست.")
    scope_json = json.dumps({"folder_ids": folder_ids, "file_ids": file_ids}, ensure_ascii=False)
    grant = (await db.execute(select(WorkspaceGrant).where(
        WorkspaceGrant.owner_user_id == current_user.id, WorkspaceGrant.member_user_id == member.id
    ))).scalar_one_or_none()
    if grant is None:
        grant = WorkspaceGrant(owner_user_id=current_user.id, member_user_id=member.id, permission=payload.permission)
        db.add(grant)
    else:
        grant.permission = payload.permission
    grant.scope_json = scope_json
    add_security_event(db, "workspace_grant_updated", user_id=current_user.id, request=request, target_type="user", target_id=member.id, details={"permission":payload.permission,"folders":len(folder_ids),"files":len(file_ids)})
    await db.commit()
    return workspace_response(member, grant.permission, grant)


@router.delete("/accounts/grants/{member_user_id}", status_code=204)
async def revoke_workspace(member_user_id: int, request: Request, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    grant = (await db.execute(select(WorkspaceGrant).where(
        WorkspaceGrant.owner_user_id == current_user.id, WorkspaceGrant.member_user_id == member_user_id
    ))).scalar_one_or_none()
    if grant is None:
        raise HTTPException(status_code=404, detail="دسترسی پیدا نشد")
    await db.delete(grant)
    add_security_event(db, "workspace_grant_revoked", user_id=current_user.id, request=request, target_type="user", target_id=member_user_id)
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
@limiter.limit("10/hour")
async def set_vault_password(
    payload: VaultPasswordRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.vault_password_hash:
        require_vault_access(request, current_user)
    current_user.vault_password_hash = vault_password_context.hash(payload.password)
    add_security_event(db, "vault_password_updated", user_id=current_user.id, request=request, target_type="account", target_id=current_user.id)
    await db.commit()
    return VaultTokenResponse(token=create_vault_token(current_user.telegram_id, current_user.auth_version))


@router.post("/accounts/vault/unlock", response_model=VaultTokenResponse)
@limiter.limit("10/minute")
async def unlock_vault(request: Request, payload: VaultPasswordRequest, current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    valid = bool(current_user.vault_password_hash) and vault_password_context.verify(payload.password, current_user.vault_password_hash)
    add_security_event(db, "vault_unlocked" if valid else "vault_unlock_failed", user_id=current_user.id, request=request, success=valid, suspicious=not valid, target_type="account", target_id=current_user.id)
    await db.commit()
    if not valid:
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
    tts_total_jobs, tts_total_chars, stt_total_jobs, stt_total_seconds = (await db.execute(select(
        func.coalesce(func.sum(TTSUsage.total_jobs), 0),
        func.coalesce(func.sum(TTSUsage.total_chars), 0),
        func.coalesce(func.sum(TTSUsage.stt_total_jobs), 0),
        func.coalesce(func.sum(TTSUsage.stt_total_seconds), 0),
    ))).one()
    tts_jobs_today = (await db.execute(select(
        func.coalesce(func.sum(TTSUsage.used_today), 0)
    ).where(TTSUsage.usage_date == datetime.utcnow().date()))).scalar_one()
    stt_jobs_today = (await db.execute(select(
        func.coalesce(func.sum(TTSUsage.stt_used_today), 0)
    ).where(TTSUsage.usage_date == datetime.utcnow().date()))).scalar_one()
    return AdminStatsResponse(
        active_users=int(active_users or 0), total_users=int(total_users or 0),
        total_files=int(total_files or 0), total_size=int(total_size or 0),
        tts_jobs_today=int(tts_jobs_today or 0), tts_total_jobs=int(tts_total_jobs or 0),
        tts_total_chars=int(tts_total_chars or 0),
        stt_jobs_today=int(stt_jobs_today or 0), stt_total_jobs=int(stt_total_jobs or 0),
        stt_total_seconds=int(stt_total_seconds or 0),
    )


@router.get("/admin/health", response_model=AdminHealthResponse)
async def admin_health(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Return a small, non-sensitive operational snapshot for administrators."""
    from ..downloader import link_importer
    from ..stt import stt_queue
    from ..tts import tts_queue

    services: list[ServiceHealthItem] = []
    started = time.perf_counter()
    try:
        await db.execute(select(1))
        latency_ms = round((time.perf_counter() - started) * 1000)
        services.append(ServiceHealthItem(
            key="database", label="دیتابیس", status="healthy",
            message=f"پاسخ‌گو در {latency_ms} میلی‌ثانیه", latency_ms=latency_ms,
        ))
    except Exception:
        try:
            await db.rollback()
        except Exception:
            pass
        services.append(ServiceHealthItem(
            key="database", label="دیتابیس", status="error",
            message="اتصال دیتابیس برقرار نیست",
        ))

    connected_bots = sum(1 for client in telegram.clients if getattr(client, "is_connected", False))
    bot_status = "healthy" if connected_bots else "error"
    services.append(ServiceHealthItem(
        key="telegram", label="ربات تلگرام", status=bot_status,
        message=f"{connected_bots} اتصال فعال" if connected_bots else "ربات به تلگرام متصل نیست",
        active=connected_bots,
    ))

    link_worker_alive = bool(link_importer.task and not link_importer.task.done())
    if not link_importer.available:
        link_status, link_message = "disabled", "سشن دریافت لینک تنظیم نشده"
    elif link_worker_alive and link_importer.client is not None:
        link_status, link_message = "healthy", "دریافت لینک آماده است"
    else:
        link_status, link_message = "error", "پردازشگر لینک متوقف شده"
    services.append(ServiceHealthItem(
        key="links", label="افزودن با لینک", status=link_status, message=link_message,
        queued=link_importer.queue.qsize(), active=1 if link_importer.active_job_id else 0,
    ))

    def speech_service(key: str, label: str, queue_service) -> ServiceHealthItem:
        workers = sum(1 for task in queue_service.tasks if not task.done())
        queued = queue_service.queue.qsize()
        if queue_service.available:
            status = "healthy" if workers else "warning"
            message = f"{workers} پردازشگر آماده" if workers else "کلید فعال است؛ پردازشگر هنگام درخواست اجرا می‌شود"
        elif queued or workers:
            status, message = "warning", "فقط با کلیدهای شخصی کاربران فعال است"
        else:
            status, message = "disabled", "کلید سراسری تنظیم نشده"
        active = len(getattr(queue_service, "active_job_ids", set()))
        if key == "stt":
            active = sum(1 for item in queue_service.statuses.values() if item.get("state") in {"downloading", "transcribing", "saving"})
        return ServiceHealthItem(key=key, label=label, status=status, message=message, queued=queued, active=active)

    services.append(speech_service("tts", "متن به صدا", tts_queue))
    services.append(speech_service("stt", "صدا به متن", stt_queue))

    active_states = ("queued", "paused", "downloading", "synthesizing", "merging", "uploading", "transcribing", "saving", "processing")
    cutoff = datetime.utcnow() - timedelta(minutes=15)
    try:
        stuck_rows = (await db.execute(
            select(ProcessingJob)
            .where(ProcessingJob.state.in_(active_states), ProcessingJob.updated_at < cutoff)
            .order_by(ProcessingJob.updated_at.asc())
            .limit(20)
        )).scalars().all()
    except Exception:
        stuck_rows = []
    stuck_jobs = [StuckJobResponse(
        id=job.id, kind=job.kind, title=job.title, state=job.state,
        progress=max(0, min(job.progress or 0, 100)), updated_at=job.updated_at,
    ) for job in stuck_rows]

    statuses = {item.status for item in services}
    overall = "error" if "error" in statuses else "warning" if stuck_jobs or "warning" in statuses else "healthy"
    return AdminHealthResponse(checked_at=datetime.utcnow(), overall=overall, services=services, stuck_jobs=stuck_jobs)


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
            TTSUsage,
        )
        .outerjoin(file_stats, file_stats.c.user_id == User.id)
        .outerjoin(session_stats, session_stats.c.user_id == User.id)
        .outerjoin(TTSUsage, TTSUsage.user_id == User.id)
        .order_by(User.created_at.desc())
    )).all()
    return [
        AdminUserResponse.model_validate(user, from_attributes=True).model_copy(update={
            "total_size": int(size or 0), "file_count": int(files or 0), "session_count": int(sessions or 0),
            "tts_daily_limit": usage.daily_limit if usage else 0,
            "tts_max_chars": usage.max_chars if usage else 200_000,
            "tts_used_today": usage.used_today if usage and usage.usage_date == datetime.utcnow().date() else 0,
            "tts_total_jobs": usage.total_jobs if usage else 0,
            "tts_total_chars": usage.total_chars if usage else 0,
            "stt_daily_limit": usage.stt_daily_limit if usage else 0,
            "stt_max_seconds": usage.stt_max_seconds if usage else 0,
            "stt_used_today": usage.stt_used_today if usage and usage.usage_date == datetime.utcnow().date() else 0,
            "stt_total_jobs": usage.stt_total_jobs if usage else 0,
            "stt_total_seconds": usage.stt_total_seconds if usage else 0,
        })
        for user, size, files, sessions, usage in rows
    ]


@router.post("/admin/users", response_model=AdminUserResponse)
async def add_authorized_user(payload: AdminUserCreate, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Add an allowed Telegram account without deleting any previous data."""
    if payload.telegram_id <= 0:
        raise HTTPException(status_code=422, detail="آیدی تلگرام معتبر نیست.")
    user = (await db.execute(select(User).where(User.telegram_id == payload.telegram_id))).scalar_one_or_none()
    if user is None:
        user = User(telegram_id=payload.telegram_id, display_name=(payload.display_name or "").strip() or None)
        db.add(user)
    else:
        user.is_active = True
        if payload.display_name is not None:
            user.display_name = payload.display_name.strip() or None
    await db.commit()
    await db.refresh(user)
    return AdminUserResponse.model_validate(user, from_attributes=True)


@router.delete("/admin/users/{user_id}", status_code=204)
async def remove_authorized_user(user_id: int, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Revoke access while preserving the user's files and account record."""
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="کاربر پیدا نشد.")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="نمی‌توانی دسترسی حساب مدیر فعلی را حذف کنی.")
    user.is_active = False
    user.auth_version += 1
    sessions = (await db.execute(select(AuthSession).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)))).scalars().all()
    for session in sessions:
        session.revoked_at = datetime.utcnow()
    await db.commit()
    return Response(status_code=204)


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
    usage = await db.get(TTSUsage, user.id)
    if any(value is not None for value in (payload.tts_daily_limit, payload.tts_max_chars, payload.stt_daily_limit, payload.stt_max_seconds)):
        if usage is None:
            usage = TTSUsage(user_id=user.id, usage_date=datetime.utcnow().date())
            db.add(usage)
        if payload.tts_daily_limit is not None:
            usage.daily_limit = payload.tts_daily_limit
        if payload.tts_max_chars is not None:
            usage.max_chars = payload.tts_max_chars
        if payload.stt_daily_limit is not None:
            usage.stt_daily_limit = payload.stt_daily_limit
        if payload.stt_max_seconds is not None:
            usage.stt_max_seconds = payload.stt_max_seconds
    await db.commit()
    size = (await db.execute(select(func.coalesce(func.sum(File.file_size), 0)).where(File.user_id == user.id))).scalar_one()
    files = (await db.execute(select(func.count(File.id)).where(File.user_id == user.id))).scalar_one()
    sessions = (await db.execute(select(func.count(AuthSession.id)).where(AuthSession.user_id == user.id, AuthSession.revoked_at.is_(None)))).scalar_one()
    return AdminUserResponse.model_validate(user, from_attributes=True).model_copy(update={
        "total_size": int(size or 0), "file_count": int(files or 0), "session_count": int(sessions or 0),
        "tts_daily_limit": usage.daily_limit if usage else 0,
        "tts_max_chars": usage.max_chars if usage else 200_000,
        "tts_used_today": usage.used_today if usage and usage.usage_date == datetime.utcnow().date() else 0,
        "tts_total_jobs": usage.total_jobs if usage else 0,
        "tts_total_chars": usage.total_chars if usage else 0,
        "stt_daily_limit": usage.stt_daily_limit if usage else 0,
        "stt_max_seconds": usage.stt_max_seconds if usage else 0,
        "stt_used_today": usage.stt_used_today if usage and usage.usage_date == datetime.utcnow().date() else 0,
        "stt_total_jobs": usage.stt_total_jobs if usage else 0,
        "stt_total_seconds": usage.stt_total_seconds if usage else 0,
    })


@router.get("/admin/errors")
async def admin_error_logs(_: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Return recent unexpected failures without exposing credentials or tracebacks."""
    from ..models import ErrorLog
    rows = (await db.execute(select(ErrorLog).order_by(ErrorLog.created_at.desc()).limit(50))).scalars().all()
    return [{
        "id": row.id, "error_id": row.error_id, "method": row.method,
        "path": row.path, "message": row.message, "resolved": row.resolved,
        "created_at": row.created_at,
    } for row in rows]


@router.patch("/admin/errors/{error_id}")
async def resolve_admin_error(error_id: str, _: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    from ..models import ErrorLog
    row = (await db.execute(select(ErrorLog).where(ErrorLog.error_id == error_id))).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="گزارش خطا پیدا نشد")
    row.resolved = True
    await db.commit()
    return {"error_id": error_id, "resolved": True}
