"""
Configuration settings loaded from environment variables.
"""
from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache


class Settings(BaseSettings):
    # Telegram
    telegram_api_id: int
    telegram_api_hash: str
    telegram_bot_token: str
    
    # Use string field to avoid JSON parsing issues with comma-separated env var
    telegram_helper_bot_tokens_str: str = Field("", alias="TELEGRAM_HELPER_BOT_TOKENS")
    telegram_worker_session: str = Field("", alias="TELEGRAM_WORKER_SESSION")
    # Extra user sessions for parallel YouTube/Instagram imports.  Keep the
    # original singular setting so existing deployments keep working.
    telegram_worker_sessions_str: str = Field("", alias="TELEGRAM_WORKER_SESSIONS")
    
    # Authorized Users (optional - comma separated IDs)
    auth_users_str: str = Field("", alias="AUTH_USERS")
    admin_users_str: str = Field("", alias="ADMIN_USERS")
    
    @property
    def auth_users(self) -> list[int]:
        v = self.auth_users_str
        if not v:
            return []
        try:
            return [int(u.strip()) for u in v.split(",") if u.strip()]
        except ValueError:
            return []

    @property
    def admin_users(self) -> list[int]:
        value = self.admin_users_str.strip()
        if value:
            try:
                return [int(item.strip()) for item in value.split(",") if item.strip()]
            except ValueError:
                return []
        return self.auth_users[:1]

    @property
    def restrict_users(self) -> bool:
        """Whether unknown Telegram accounts require administrator approval."""
        return bool(self.auth_users_str.strip() or self.admin_users_str.strip())

    @property
    def bootstrap_users(self) -> set[int]:
        return set(self.auth_users) | set(self.admin_users)
    
    @property
    def telegram_helper_bot_tokens(self) -> list[str]:
        v = self.telegram_helper_bot_tokens_str
        if not v:
            return []
        return [t.strip() for t in v.split(",") if t.strip()]
    
    @property
    def all_bot_tokens(self) -> list[str]:
        return [self.telegram_bot_token] + self.telegram_helper_bot_tokens

    @property
    def telegram_worker_sessions(self) -> list[str]:
        """Configured import accounts, de-duplicated in a stable order."""
        values = [*self.telegram_worker_session.split(","), *self.telegram_worker_sessions_str.split(",")]
        sessions: list[str] = []
        for value in values:
            value = value.strip()
            if value and value not in sessions:
                sessions.append(value)
        return sessions
    
    telegram_storage_channel_id: int
    
    # Database
    database_url: str
    # Keep the application pool deliberately small. Supabase's shared session
    # pool can have a low client limit, and Railway briefly overlaps old and
    # new containers during a deployment.
    db_pool_size: int = 2
    db_max_overflow: int = 0
    
    
    # JWT
    jwt_secret: str
    jwt_expiry_minutes: int = 30
    refresh_token_expiry_days: int = 30
    
    # Server
    server_host: str = "0.0.0.0"
    server_port: int = 8000
    # A deliberately isolated local mode for UI/API development. It keeps the
    # HTTP server and a local database available but never starts Telegram,
    # Drive, link-import or scheduled monitor workers.
    local_dev_mode: bool = Field(False, alias="KOMOD_LOCAL_DEV")
    
    # Concurrency
    telegram_client_concurrency: int = 3
    
    # Web
    web_base_url: str = "http://localhost:3000"
    google_client_id: str = Field("", alias="GOOGLE_CLIENT_ID")
    google_client_secret: str = Field("", alias="GOOGLE_CLIENT_SECRET")
    google_redirect_uri: str = Field("", alias="GOOGLE_REDIRECT_URI")
    # Public Google Picker OAuth client. Keep the full Drive client above in
    # Testing for approved accounts and publish this narrower client.
    google_picker_client_id: str = Field("", alias="GOOGLE_PICKER_CLIENT_ID")
    google_picker_client_secret: str = Field("", alias="GOOGLE_PICKER_CLIENT_SECRET")
    google_picker_redirect_uri: str = Field("", alias="GOOGLE_PICKER_REDIRECT_URI")
    google_picker_api_key: str = Field("", alias="GOOGLE_PICKER_API_KEY")
    google_picker_app_id: str = Field("", alias="GOOGLE_PICKER_APP_ID")

    # Gemini text-to-speech. Keep these keys on the server; they must never be
    # returned by an API endpoint or embedded in the web bundle.
    gemini_api_keys_str: str = Field("", alias="GEMINI_API_KEYS")
    gemini_api_key: str = Field("", alias="GEMINI_API_KEY")
    gemini_tts_model: str = Field("gemini-3.8-flash-tts", alias="GEMINI_TTS_MODEL")
    gemini_stt_model: str = Field("gemini-3.8-flash", alias="GEMINI_STT_MODEL")

    @property
    def gemini_api_keys(self) -> list[str]:
        raw = self.gemini_api_keys_str or self.gemini_api_key
        values = raw.replace("\r", "\n").replace(",", "\n").split("\n")
        return list(dict.fromkeys(value.strip() for value in values if value.strip()))
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
