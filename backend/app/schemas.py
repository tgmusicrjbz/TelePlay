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
    
    model_config = ConfigDict(from_attributes=True)


# ============== Folder Schemas ==============

class FolderBase(BaseModel):
    name: str
    description: Optional[str] = None
    parent_id: Optional[int] = None


class FolderCreate(FolderBase):
    pass


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    parent_id: Optional[int] = None


class FolderResponse(FolderBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    file_count: int = 0
    
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


class BatchFileUpdate(BaseModel):
    ids: List[int] = Field(min_length=1, max_length=500)
    description_mode: Optional[Literal["set", "append", "clear"]] = None
    description: Optional[str] = None
    rename_mode: Optional[Literal["prefix", "suffix", "replace"]] = None
    rename_value: Optional[str] = None
    rename_search: Optional[str] = None


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
    last_pos: int = 0
    is_favorite: bool = False
    
    model_config = ConfigDict(from_attributes=True)


class FileListResponse(BaseModel):
    files: List[FileResponse]
    total: int
    page: int
    per_page: int


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


class PlaylistAddItems(BaseModel):
    file_ids: List[int] = Field(min_length=1, max_length=200)
    allow_duplicates: bool = False


class PlaylistReorder(BaseModel):
    item_ids: Optional[List[int]] = Field(default=None, min_length=1, max_length=500)
    file_ids: Optional[List[int]] = Field(default=None, min_length=1, max_length=500)


class PlaylistSummary(BaseModel):
    id: int
    name: str
    description: Optional[str] = None
    item_count: int = 0
    total_duration: int = 0
    cover_url: Optional[str] = None
    cover_urls: List[str] = Field(default_factory=list)
    audio_count: int = 0
    video_count: int = 0
    created_at: datetime
    updated_at: datetime


class PlaylistItemResponse(BaseModel):
    id: int
    position: int
    added_at: datetime
    file: FileResponse


class PlaylistResponse(PlaylistSummary):
    items: List[PlaylistItemResponse] = Field(default_factory=list)


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


class AuthResponse(Token):
    user: UserResponse


class BotInfoResponse(BaseModel):
    username: str
    name: Optional[str] = None
    server_version: str = "1.0.0"


# Resolve forward references
FolderWithChildren.model_rebuild()
