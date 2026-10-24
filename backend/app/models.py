"""
Database models for TelePlay streaming app.
"""
from datetime import date, datetime
from typing import Optional, List
from sqlalchemy import BigInteger, String, Integer, Boolean, ForeignKey, Date, DateTime, Text, Index, UniqueConstraint, LargeBinary
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


class User(Base):
    """Telegram user who uses the bot."""
    __tablename__ = "users"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, nullable=False, index=True)
    username: Mapped[Optional[str]] = mapped_column(String(255))
    first_name: Mapped[Optional[str]] = mapped_column(String(255))
    last_name: Mapped[Optional[str]] = mapped_column(String(255))
    display_name: Mapped[Optional[str]] = mapped_column(String(255))
    login_username: Mapped[Optional[str]] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[Optional[str]] = mapped_column(Text)
    totp_secret_encrypted: Mapped[Optional[str]] = mapped_column(Text)
    vault_password_hash: Mapped[Optional[str]] = mapped_column(Text)
    failed_login_attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    login_locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime)
    storage_channel_id: Mapped[Optional[int]] = mapped_column(BigInteger)
    storage_channels_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    delete_storage_files: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    youtube_caption_template: Mapped[str] = mapped_column(Text, default="📝 [عنوان]\n📺 [سازنده]\n🔗 [لینک]", nullable=False)
    instagram_caption_template: Mapped[str] = mapped_column(Text, default="📝 [عنوان]\n📷 [سازنده]\n🔗 [لینک]", nullable=False)
    tag_settings_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    tag_exclusions_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    saved_filters_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    show_file_tags: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    file_tag_limit: Mapped[int] = mapped_column(Integer, default=2, nullable=False)
    tts_settings_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    player_state_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    offline_manifest_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    gemini_api_keys_encrypted: Mapped[Optional[str]] = mapped_column(Text)
    google_drive_credentials_encrypted: Mapped[Optional[str]] = mapped_column(Text)
    google_drive_email: Mapped[Optional[str]] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    auth_version: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_active: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    folders: Mapped[List["Folder"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    files: Mapped[List["File"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    watch_progress: Mapped[List["WatchProgress"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    playlists: Mapped[List["Playlist"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    packs: Mapped[List["Pack"]] = relationship(back_populates="user", cascade="all, delete-orphan")


class AuthSession(Base):
    """One revocable browser or Mini App login session."""
    __tablename__ = "auth_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    device_name: Mapped[str] = mapped_column(String(255), default="دستگاه ناشناس", nullable=False)
    user_agent: Mapped[Optional[str]] = mapped_column(Text)
    ip_address: Mapped[Optional[str]] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    revoked_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    telegram_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime)


class WorkspaceGrant(Base):
    """Permission for one user to open another user's Komod space."""
    __tablename__ = "workspace_grants"

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    member_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    permission: Mapped[str] = mapped_column(String(16), default="read", nullable=False)
    scope_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("owner_user_id", "member_user_id", name="uq_workspace_grant"),)


class BotUserState(Base):
    """Persistent Telegram bot UI state for one user."""
    __tablename__ = "bot_user_states"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    current_drawer_id: Mapped[Optional[int]] = mapped_column(Integer)
    upload_drawer_id: Mapped[Optional[int]] = mapped_column(Integer)
    library_filters_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    search_filters_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    search_query: Mapped[Optional[str]] = mapped_column(String(100))
    sort_preferences_json: Mapped[str] = mapped_column(Text, default='[["created", "desc"]]', nullable=False)
    batch_selection_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    batch_target: Mapped[Optional[str]] = mapped_column(String(255))
    show_file_actions: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    link_delivery_mode: Mapped[str] = mapped_column(String(16), default="both", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class AppSetting(Base):
    """Small server-wide settings editable by administrators."""
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class TelegramDestination(Base):
    """A reusable Telegram person, group, or channel destination."""
    __tablename__ = "telegram_destinations"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    chat_type: Mapped[str] = mapped_column(String(24), default="unknown", nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    __table_args__ = (
        UniqueConstraint("user_id", "chat_id", name="uq_telegram_destination_user_chat"),
    )


class SourceMonitor(Base):
    """A scheduled source check that can route new entries to Telegram."""
    __tablename__ = "source_monitors"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    source_type: Mapped[str] = mapped_column(String(24), nullable=False)
    source_url: Mapped[str] = mapped_column(Text, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    interval_minutes: Mapped[int] = mapped_column(Integer, default=60, nullable=False)
    run_at: Mapped[Optional[str]] = mapped_column(String(5))
    filters_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    actions_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    last_cursor: Mapped[Optional[str]] = mapped_column(Text)
    last_checked_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    last_error: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class TTSVoicePreview(Base):
    """A server-wide cached voice sample shared by every user."""
    __tablename__ = "tts_voice_previews"

    id: Mapped[int] = mapped_column(primary_key=True)
    model: Mapped[str] = mapped_column(String(120), nullable=False)
    voice: Mapped[str] = mapped_column(String(80), nullable=False)
    audio: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("model", "voice", name="uq_tts_preview_model_voice"),)


class TTSUsage(Base):
    """Per-user speech limits and durable TTS/STT usage counters."""
    __tablename__ = "tts_usage"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    daily_limit: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    max_chars: Mapped[int] = mapped_column(Integer, default=200_000, nullable=False)
    used_today: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    usage_date: Mapped[Optional[date]] = mapped_column(Date)
    total_jobs: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    total_chars: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    stt_daily_limit: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    stt_max_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    stt_used_today: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    stt_total_jobs: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    stt_total_seconds: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class ProcessingJob(Base):
    """Durable state for background TTS/STT work across app restarts."""
    __tablename__ = "processing_jobs"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    state: Mapped[str] = mapped_column(String(32), default="queued", nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(255), default="", nullable=False)
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    message: Mapped[str] = mapped_column(String(500), default="", nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    result_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime)

    __table_args__ = (
        Index("idx_processing_job_user_kind_created", user_id, kind, created_at),
    )


class Folder(Base):
    """User-created folder for organizing files."""
    __tablename__ = "folders"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    color: Mapped[Optional[str]] = mapped_column(String(7))
    icon: Mapped[Optional[str]] = mapped_column(String(16))
    cover_file_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("files.id", ondelete="SET NULL", use_alter=True, name="fk_folder_cover_file"), nullable=True
    )
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user: Mapped["User"] = relationship(back_populates="folders")
    parent: Mapped[Optional["Folder"]] = relationship(back_populates="children", remote_side=[id])
    children: Mapped[List["Folder"]] = relationship(back_populates="parent", cascade="all, delete-orphan")
    files: Mapped[List["File"]] = relationship(back_populates="folder", foreign_keys="File.folder_id")
    
    # Indexes
    __table_args__ = (
        Index("idx_folder_user_parent", user_id, parent_id),
    )


class File(Base):
    """File stored in Telegram, metadata in database."""
    __tablename__ = "files"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    folder_id: Mapped[Optional[int]] = mapped_column(ForeignKey("folders.id", ondelete="SET NULL"))
    
    # Telegram-specific identifiers
    file_id: Mapped[str] = mapped_column(String(255), nullable=False)
    file_unique_id: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    channel_message_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    storage_channel_id: Mapped[Optional[int]] = mapped_column(BigInteger)
    
    # File metadata
    file_name: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    # Private normalized source used by library search. It is intentionally
    # absent from FileResponse so note contents never leak in list endpoints.
    search_text: Mapped[Optional[str]] = mapped_column(Text)
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), index=True)
    is_shortcut: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    tags_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    mime_type: Mapped[Optional[str]] = mapped_column(String(100))
    file_type: Mapped[str] = mapped_column(String(50), nullable=False)  # video, audio, document, image, text
    
    # Media-specific metadata
    duration: Mapped[Optional[int]] = mapped_column(Integer)  # seconds
    width: Mapped[Optional[int]] = mapped_column(Integer)
    height: Mapped[Optional[int]] = mapped_column(Integer)
    thumbnail_file_id: Mapped[Optional[str]] = mapped_column(String(255))
    audio_variant_file_id: Mapped[Optional[str]] = mapped_column(String(255))
    audio_variant_unique_id: Mapped[Optional[str]] = mapped_column(String(255))
    audio_variant_message_id: Mapped[Optional[int]] = mapped_column(BigInteger)
    audio_variant_storage_channel_id: Mapped[Optional[int]] = mapped_column(BigInteger)
    audio_variant_size: Mapped[Optional[int]] = mapped_column(BigInteger)
    compatible_video_file_id: Mapped[Optional[str]] = mapped_column(String(255))
    compatible_video_unique_id: Mapped[Optional[str]] = mapped_column(String(255))
    compatible_video_message_id: Mapped[Optional[int]] = mapped_column(BigInteger)
    compatible_video_storage_channel_id: Mapped[Optional[int]] = mapped_column(BigInteger)
    compatible_video_size: Mapped[Optional[int]] = mapped_column(BigInteger)
    
    # Sharing
    public_hash: Mapped[Optional[str]] = mapped_column(String(64), unique=True, index=True)
    public_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    public_password_hash: Mapped[Optional[str]] = mapped_column(Text)
    public_allow_download: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    public_view_limit: Mapped[Optional[int]] = mapped_column(Integer)
    public_view_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    
    # Timestamps
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user: Mapped["User"] = relationship(back_populates="files")
    folder: Mapped[Optional["Folder"]] = relationship(back_populates="files", foreign_keys=[folder_id])
    watch_progress: Mapped[List["WatchProgress"]] = relationship(back_populates="file", cascade="all, delete-orphan")
    playlist_items: Mapped[List["PlaylistItem"]] = relationship(back_populates="file", cascade="all, delete-orphan")
    
    # Indexes
    __table_args__ = (
        Index("idx_file_user_folder", user_id, folder_id),
        Index("idx_file_type", file_type),
    )


class WatchProgress(Base):
    """Track video watch progress for continue watching feature."""
    __tablename__ = "watch_progress"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    file_id: Mapped[int] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0)  # seconds
    duration: Mapped[Optional[int]] = mapped_column(Integer)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    user: Mapped["User"] = relationship(back_populates="watch_progress")
    file: Mapped["File"] = relationship(back_populates="watch_progress")
    
    # Unique constraint
    __table_args__ = (
        Index("idx_watch_user_file", user_id, file_id, unique=True),
    )


class Playlist(Base):
    """An ordered collection of the user's audio and video files."""
    __tablename__ = "playlists"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    cover_file_id: Mapped[Optional[int]] = mapped_column(ForeignKey("files.id", ondelete="SET NULL"), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="playlists")
    items: Mapped[List["PlaylistItem"]] = relationship(
        back_populates="playlist", cascade="all, delete-orphan", order_by="PlaylistItem.position"
    )
    cover_file: Mapped[Optional["File"]] = relationship(foreign_keys="Playlist.cover_file_id")

    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_playlist_user_name"),)


class PlaylistItem(Base):
    """A file and its manual position inside a playlist."""
    __tablename__ = "playlist_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    playlist_id: Mapped[int] = mapped_column(ForeignKey("playlists.id", ondelete="CASCADE"), nullable=False)
    file_id: Mapped[int] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    playlist: Mapped["Playlist"] = relationship(back_populates="items")
    file: Mapped["File"] = relationship(back_populates="playlist_items")

    __table_args__ = (
        Index("idx_playlist_position", playlist_id, position),
    )


class Pack(Base):
    """A named, ordered collection of mixed files shown beside folders."""
    __tablename__ = "packs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    parent_folder_id: Mapped[Optional[int]] = mapped_column(ForeignKey("folders.id", ondelete="SET NULL"), index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text)
    cover_file_id: Mapped[Optional[int]] = mapped_column(ForeignKey("files.id", ondelete="SET NULL"))
    cover_position_x: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    cover_position_y: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    hide_member_files: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user: Mapped["User"] = relationship(back_populates="packs")
    parent_folder: Mapped[Optional["Folder"]] = relationship(foreign_keys=[parent_folder_id])
    cover_file: Mapped[Optional["File"]] = relationship(foreign_keys=[cover_file_id])
    items: Mapped[List["PackItem"]] = relationship(
        back_populates="pack", cascade="all, delete-orphan", order_by="PackItem.position"
    )

    __table_args__ = (
        Index("idx_pack_user_parent_position", user_id, parent_folder_id, position),
    )


class PackItem(Base):
    """One file and its visual order inside a pack."""
    __tablename__ = "pack_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    pack_id: Mapped[int] = mapped_column(ForeignKey("packs.id", ondelete="CASCADE"), nullable=False)
    file_id: Mapped[int] = mapped_column(ForeignKey("files.id", ondelete="CASCADE"), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    caption: Mapped[Optional[str]] = mapped_column(Text)
    added_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    pack: Mapped["Pack"] = relationship(back_populates="items")
    file: Mapped["File"] = relationship()

    __table_args__ = (
        UniqueConstraint("pack_id", "file_id", name="uq_pack_file"),
        Index("idx_pack_item_position", pack_id, position),
    )


class LoginCode(Base):
    """Temporary login code for TV/Web auth."""
    __tablename__ = "login_codes"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(6), unique=True, index=True, nullable=False)
    telegram_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ErrorLog(Base):
    """A short, administrator-visible record for unexpected API failures."""
    __tablename__ = "error_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    error_id: Mapped[str] = mapped_column(String(16), unique=True, nullable=False, index=True)
    method: Mapped[str] = mapped_column(String(12), nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    traceback: Mapped[Optional[str]] = mapped_column(Text)
    resolved: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class SecurityEvent(Base):
    """Audit trail for authentication, sharing and sensitive account changes."""
    __tablename__ = "security_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    success: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    suspicious: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    target_type: Mapped[Optional[str]] = mapped_column(String(32))
    target_id: Mapped[Optional[str]] = mapped_column(String(128))
    ip_address: Mapped[Optional[str]] = mapped_column(String(64))
    user_agent: Mapped[Optional[str]] = mapped_column(Text)
    details_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)
