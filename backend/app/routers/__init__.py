"""
Router package initialization.
"""
from .files import router as files_router
from .folders import router as folders_router
from .streaming import router as streaming_router
from .auth import router as auth_router
from .tv import router as tv_router
from .playlists import router as playlists_router
from .accounts import router as accounts_router
from .tts import router as tts_router
from .stt import router as stt_router
from .packs import router as packs_router
from .bot_messages import router as bot_messages_router
from .admin_groups import router as admin_groups_router

__all__ = ["files_router", "folders_router", "streaming_router", "auth_router", "tv_router", "playlists_router", "accounts_router", "tts_router", "stt_router", "packs_router", "bot_messages_router", "admin_groups_router"]

