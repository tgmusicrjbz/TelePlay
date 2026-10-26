"""
Pydantic schemas for API request/response validation.
"""
from datetime import datetime
from typing import Literal, Optional, List
from pydantic import BaseModel, ConfigDict, Field


# ============== User Schemas ==============

class UserBase(BaseModel):
    telegram_id: int
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class UserCreate(UserBase):
    pass


class UserResponse(UserBase):
    id: int
    created_at: datetime
    last_active: datetime
    display_name: Optional[str] = None
    is_active: bool = True
    is_admin: bool = False
    can_use_monitors: bool = False
    login_username: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)


# ============== Folder Schemas ==============

class FolderBase(BaseModel):
    name: str
    description: Optional[str] = None
    parent_id: Optional[int] = None


class FolderCreate(FolderBase):
    color: Optional[str] = None
    icon: Optional[str] = None
    cover_file_id: Optional[int] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    parent_id: Optional[int] = None
    is_favorite: Optional[bool] = None
    is_pinned: Optional[bool] = None
    is_hidden: Optional[bool] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    cover_file_id: Optional[int] = None


class FolderResponse(FolderBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    file_count: int = 0
    is_favorite: bool = False
    is_pinned: bool = False
    is_default: bool = False
    is_hidden: bool = False
    color: Optional[str] = None
    icon: Optional[str] = None
    cover_file_id: Optional[int] = None
    cover_url: Optional[str] = None
    
    model_config = ConfigDict(from_attributes=True)


class FolderWithChildren(FolderResponse):
    children: List["FolderWithChildren"] = []
    

# ============== File Schemas ==============

class FileBase(BaseModel):
    file_name: str
    description: Optional[str] = None
    file_size: int
    mime_type: Optional[str] = None
    file_type: str  # video, audio, document, image, text
    tags: List[str] = Field(default_factory=list)
    duration: Optional[float] = None
    width: Optional[int] = None
    height: Optional[int] = None


class FileCreate(FileBase):
    file_id: str
    file_unique_id: str
    channel_message_id: int
    thumbnail_file_id: Optional[str] = None
    folder_id: Optional[int] = None


class FileUpdate(BaseModel):
    file_name: Optional[str] = None
    description: Optional[str] = None
    folder_id: Optional[int] = None
    is_favorite: Optional[bool] = None
    is_pinned: Optional[bool] = None
    tags: Optional[List[str]] = None
    is_hidden: Optional[bool] = None


class BatchFileUpdate(BaseModel):
    ids: List[int] = Field(min_length=1, max_length=500)
    description_mode: Optional[Literal["set", "append", "clear"]] = None
    description: Optional[str] = None
    cleanup_links: bool = False
    cleanup_mentions: bool = False
    cleanup_hashtags: bool = False
    rename_mode: Optional[Literal["prefix", "suffix", "replace"]] = None
    rename_value: Optional[str] = None
    rename_search: Optional[str] = None
    tags_add: List[str] = Field(default_factory=list, max_length=20)
    tags_remove: List[str] = Field(default_factory=list, max_length=20)
    tags_replace: Optional[List[str]] = Field(default=None, max_length=20)
    is_hidden: Optional[bool] = None


class TagDefinition(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    color: str = Field(pattern=r"^#[0-9a-fA-F]{6}$")
    category: str = Field(default="", max_length=40)


class TagSettingsUpdate(BaseModel):
    tags: List[TagDefinition] = Field(default_factory=list, max_length=100)
    excluded_tags: List[str] = Field(default_factory=list, max_length=100)
    show_file_tags: bool = False
    display_limit: int = Field(default=2, ge=1, le=6)


class TagBatchDelete(BaseModel):
    names: List[str] = Field(min_length=1, max_length=100)


class TagDefinitionResponse(TagDefinition):
    file_count: int = 0


class TagSettingsResponse(BaseModel):
    tags: List[TagDefinitionResponse] = Field(default_factory=list)
    excluded_tags: List[str] = Field(default_factory=list)
    show_file_tags: bool = False
    display_limit: int = 2


class SavedFilter(BaseModel):
    id: str = Field(min_length=1, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    name: str = Field(min_length=1, max_length=40)
    query: str = Field(default="", max_length=100)
    file_types: List[Literal["video", "audio", "image", "document", "text"]] = Field(default_factory=list, max_length=5)
    favorite_only: bool = False
    sort: str = Field(default="created:desc", max_length=120)


class SavedFiltersUpdate(BaseModel):
    filters: List[SavedFilter] = Field(default_factory=list, max_length=20)


class FileResponse(FileBase):
    id: int
    user_id: int
    folder_id: Optional[int] = None
    file_id: str
    file_unique_id: str
    created_at: datetime
    updated_at: datetime
    thumbnail_url: Optional[str] = None
    stream_url: Optional[str] = None
    download_url: Optional[str] = None
    public_hash: Optional[str] = None
    public_stream_url: Optional[str] = None
    public_expires_at: Optional[datetime] = None
    public_allow_download: bool = True
    public_view_limit: Optional[int] = None
    public_view_count: int = 0
    public_password_protected: bool = False
    last_pos: int = 0
    is_favorite: bool = False
    is_pinned: bool = False
    is_hidden: bool = False
    is_shortcut: bool = False
    audio_stream_url: Optional[str] = None
    audio_variant_size: Optional[int] = None
    compatible_video_stream_url: Optional[str] = None
    compatible_video_size: Optional[int] = None
    
    model_config = ConfigDict(from_attributes=True)


class FileListResponse(BaseModel):
    files: List[FileResponse]
    total: int
    page: int
    per_page: int
    search_mode: Literal["exact", "fuzzy"] = "exact"
    suggestions: List[str] = Field(default_factory=list)


class PlayerStateUpdate(BaseModel):
    file_ids: List[int] = Field(default_factory=list, max_length=250)
    current_index: int = Field(default=-1, ge=-1, le=249)
    repeat_mode: Literal["off", "all", "one"] = "off"
    position: int = Field(default=0, ge=0)


class PlayerStateResponse(BaseModel):
    files: List[FileResponse] = Field(default_factory=list)
    current_index: int = -1
    repeat_mode: Literal["off", "all", "one"] = "off"
    position: int = 0
    updated_at: Optional[datetime] = None


class ActivityResponse(BaseModel):
    continue_watching: List[FileResponse]
    recent: List[FileResponse]
    favorites: List[FileResponse] = Field(default_factory=list)


# ============== Playlist Schemas ==============

class PlaylistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=1024)


class PlaylistUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=1024)
    cover_file_id: Optional[int] = None


class PlaylistAddItems(BaseModel):
    file_ids: List[int] = Field(min_length=1, max_length=200)
    allow_duplicates: bool = False


class PlaylistReorder(BaseModel):
    item_ids: Optional[List[int]] = Field(default=None, min_length=1, max_length=500)
    file_ids: Optional[List[int]] = Field(default=None, min_length=1, max_length=500)


class PlaylistCatalogReorder(BaseModel):
    playlist_ids: List[int] = Field(min_length=1, max_length=500)


class PlaylistSummary(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    item_count: int = 0
    total_duration: int = 0
    cover_url: Optional[str] = None
    cover_file_id: Optional[int] = None
    cover_urls: List[str] = Field(default_factory=list)
    audio_count: int = 0
    video_count: int = 0
    preview_names: List[str] = Field(default_factory=list)
    position: int = 0
    created_at: datetime
    updated_at: datetime


class PlaylistItemResponse(BaseModel):
    id: int
    position: int
    added_at: datetime
    file: FileResponse


class PlaylistResponse(PlaylistSummary):
    items: List[PlaylistItemResponse] = Field(default_factory=list)


# ============== Pack Schemas ==============

class PackCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2048)
    parent_folder_id: Optional[int] = None
    hide_member_files: bool = False
    file_ids: List[int] = Field(default_factory=list, max_length=500)


class PackUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=2048)
    parent_folder_id: Optional[int] = None
    cover_file_id: Optional[int] = None
    cover_position_x: Optional[int] = Field(default=None, ge=0, le=100)
    cover_position_y: Optional[int] = Field(default=None, ge=0, le=100)
    hide_member_files: Optional[bool] = None


class PackAddItems(BaseModel):
    file_ids: List[int] = Field(min_length=1, max_length=500)


class PackReorder(BaseModel):
    item_ids: List[int] = Field(min_length=1, max_length=500)


class PackItemResponse(BaseModel):
    id: int
    position: int
    caption: Optional[str] = None
    added_at: datetime
    file: FileResponse


class PackSummary(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    parent_folder_id: Optional[int] = None
    item_count: int = 0
    cover_file_id: Optional[int] = None
    cover_position_x: int = 50
    cover_position_y: int = 50
    hide_member_files: bool = False
    cover_url: Optional[str] = None
    cover_urls: List[str] = Field(default_factory=list)
    preview_names: List[str] = Field(default_factory=list)
    type_counts: dict[str, int] = Field(default_factory=dict)
    position: int = 0
    created_at: datetime
    updated_at: datetime


class PackResponse(PackSummary):
    items: List[PackItemResponse] = Field(default_factory=list)


# ============== Watch Progress Schemas ==============

class WatchProgressBase(BaseModel):
    position: int
    duration: Optional[float] = None
    completed: bool = False


class WatchProgressUpdate(BaseModel):
    position: int
    duration: Optional[float] = None


class WatchProgressResponse(WatchProgressBase):
    id: int
    file_id: int
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


# ============== Auth Schemas ==============

class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshTokenRequest(BaseModel):
    """Request body for token refresh."""
    refresh_token: str = Field(..., alias="refreshToken")
    
    model_config = ConfigDict(populate_by_name=True)


class TokenPayload(BaseModel):
    sub: int  # user telegram_id
    exp: datetime


class LoginCodeRequest(BaseModel):
    code: str


class LoginCodeResponse(BaseModel):
    code: str
    expires_at: datetime


class VerifyCodeRequest(BaseModel):
    code: str
    otp: Optional[str] = Field(default=None, min_length=6, max_length=8)


class AuthResponse(Token):
    user: UserResponse


class PasswordRegistrationResponse(BaseModel):
    status: Literal["pending_approval"] = "pending_approval"
    message: str
    username: str


class TelegramWebAppRequest(BaseModel):
    init_data: str = Field(min_length=1)
    otp: Optional[str] = Field(default=None, min_length=6, max_length=8)


class TelegramTokenLoginRequest(BaseModel):
    token: str = Field(min_length=20)
    otp: Optional[str] = Field(default=None, min_length=6, max_length=8)


class PasswordLoginRequest(BaseModel):
    username: str = Field(min_length=4, max_length=32)
    # Keep login compatible with legacy hashes. New and changed passwords
    # still use the stricter policy below.
    password: str = Field(min_length=1, max_length=128)
    otp: Optional[str] = Field(default=None, min_length=6, max_length=8)


class PasswordRegisterRequest(BaseModel):
    username: str = Field(min_length=4, max_length=32)
    password: str = Field(min_length=8, max_length=128)
    display_name: str = Field(min_length=2, max_length=80)


class CredentialsUpdate(BaseModel):
    username: str = Field(min_length=4, max_length=32)
    current_password: Optional[str] = Field(default=None, max_length=128)
    new_password: Optional[str] = Field(default=None, min_length=8, max_length=128)


class CredentialsStatus(BaseModel):
    enabled: bool
    username: Optional[str] = None
    two_factor_enabled: bool = False
    recovery_available: bool = False


class TwoFactorSetupResponse(BaseModel):
    secret: str
    provisioning_uri: str
    setup_token: str


class TwoFactorEnableRequest(BaseModel):
    setup_token: str = Field(min_length=20)
    code: str = Field(min_length=6, max_length=8)
    current_password: Optional[str] = Field(default=None, max_length=128)


class TwoFactorDisableRequest(BaseModel):
    code: Optional[str] = Field(default=None, min_length=6, max_length=8)
    current_password: Optional[str] = Field(default=None, max_length=128)


class PublicShareCreate(BaseModel):
    expires_in_hours: Optional[int] = Field(default=None, ge=1, le=24 * 365)
    password: Optional[str] = Field(default=None, min_length=4, max_length=128)
    allow_download: bool = True
    view_limit: Optional[int] = Field(default=None, ge=1, le=1_000_000)


class PublicShareUnlock(BaseModel):
    password: str = Field(min_length=1, max_length=128)


class SessionResponse(BaseModel):
    id: str
    device_name: str
    user_agent: Optional[str] = None
    ip_address: Optional[str] = None
    created_at: datetime
    last_seen_at: datetime
    current: bool = False


class WorkspaceGrantCreate(BaseModel):
    telegram_id: Optional[int] = None
    identifier: Optional[str] = Field(default=None, min_length=1, max_length=255)
    permission: Literal["read", "write"] = "read"
    folder_ids: list[int] = Field(default_factory=list)
    file_ids: list[int] = Field(default_factory=list)


class WorkspaceResponse(BaseModel):
    user_id: int
    telegram_id: int
    name: str
    username: Optional[str] = None
    permission: Literal["owner", "read", "write"]
    folder_ids: list[int] = Field(default_factory=list)
    file_ids: list[int] = Field(default_factory=list)


class AdminUserUpdate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=255)
    is_active: Optional[bool] = None
    tts_daily_limit: Optional[int] = Field(default=None, ge=0, le=10000)
    tts_max_chars: Optional[int] = Field(default=None, ge=100, le=200_000)
    stt_daily_limit: Optional[int] = Field(default=None, ge=0, le=10000)
    stt_max_seconds: Optional[int] = Field(default=None, ge=0, le=604_800)
    can_use_monitors: Optional[bool] = None


class AdminUserCreate(BaseModel):
    telegram_id: int
    display_name: Optional[str] = Field(default=None, max_length=255)


class AdminUserResponse(UserResponse):
    total_size: int = 0
    file_count: int = 0
    session_count: int = 0
    tts_daily_limit: int = 0
    tts_max_chars: int = 200_000
    tts_used_today: int = 0
    tts_total_jobs: int = 0
    tts_total_chars: int = 0
    stt_daily_limit: int = 0
    stt_max_seconds: int = 0
    stt_used_today: int = 0
    stt_total_jobs: int = 0
    stt_total_seconds: int = 0


class AdminStatsResponse(BaseModel):
    active_users: int = 0
    total_users: int = 0
    total_files: int = 0
    total_size: int = 0
    tts_jobs_today: int = 0
    tts_total_jobs: int = 0
    tts_total_chars: int = 0
    stt_jobs_today: int = 0
    stt_total_jobs: int = 0
    stt_total_seconds: int = 0


class ServiceHealthItem(BaseModel):
    key: str
    label: str
    status: Literal["healthy", "warning", "error", "disabled"]
    message: str
    queued: int = 0
    active: int = 0
    latency_ms: Optional[int] = None


class StuckJobResponse(BaseModel):
    id: str
    kind: str
    title: str
    state: str
    progress: int = 0
    updated_at: datetime


class AdminHealthResponse(BaseModel):
    checked_at: datetime
    overall: Literal["healthy", "warning", "error"]
    services: list[ServiceHealthItem] = Field(default_factory=list)
    stuck_jobs: list[StuckJobResponse] = Field(default_factory=list)


class StorageChannelUpdate(BaseModel):
    channel_id: int


class StorageChannelItem(BaseModel):
    channel_id: int
    title: Optional[str] = None
    active: bool = False


class StorageChannelResponse(BaseModel):
    configured: bool
    channel_id: Optional[int] = None
    title: Optional[str] = None
    channels: list[StorageChannelItem] = Field(default_factory=list)


class AccountPreferences(BaseModel):
    delete_storage_files: bool = True
    youtube_caption_template: str = Field(default="📝 [عنوان]\n📺 [سازنده]\n🔗 [لینک]", max_length=1000)
    instagram_caption_template: str = Field(default="📝 [عنوان]\n📷 [سازنده]\n🔗 [لینک]", max_length=1000)


class AccountPreferencesUpdate(BaseModel):
    delete_storage_files: Optional[bool] = None
    youtube_caption_template: Optional[str] = Field(default=None, max_length=1000)
    instagram_caption_template: Optional[str] = Field(default=None, max_length=1000)


class VaultStatus(BaseModel):
    configured: bool


class VaultPasswordRequest(BaseModel):
    password: str = Field(min_length=6, max_length=128)


class VaultTokenResponse(BaseModel):
    token: str


class BotInfoResponse(BaseModel):
    username: str
    name: Optional[str] = None
    server_version: str = "1.0.0"


# Resolve forward references
FolderWithChildren.model_rebuild()
