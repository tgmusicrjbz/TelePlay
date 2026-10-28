"""
Configuration settings loaded from environment variables.
"""
from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache


def _session_values(*raw_values: str) -> list[str]:
    """Normalize Railway/env session values without ever logging their contents."""
    sessions: list[str] = []
    variable_names = {"TELEGRAM_MONITOR_SESSION", "TELEGRAM_MONITOR_SESSIONS", "TELEGRAM_WORKER_SESSION", "TELEGRAM_WORKER_SESSIONS"}
    for raw in raw_values:
        for candidate in str(raw or "").replace("\r", "\n").replace("\n", ",").split(","):
            value = candidate.strip()
            if value[:1] in {'"', "'"} and value[-1:] == value[:1]:
                value = value[1:-1].strip()
            prefix, separator, remainder = value.partition("=")
            if separator and prefix.strip() in variable_names:
                value = remainder.strip()
            if value and value not in sessions:
                sessions.append(value)
    return sessions


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
    # Dedicated user sessions for Telegram channel/Saved Messages monitoring.
    # They are deliberately never handed to the YouTube/Instagram importer.
    telegram_monitor_session: str = Field("", alias="TELEGRAM_MONITOR_SESSION")
    telegram_monitor_sessions_str: str = Field("", alias="TELEGRAM_MONITOR_SESSIONS")
    
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
        return _session_values(self.telegram_worker_session, self.telegram_worker_sessions_str)

    @property
    def telegram_monitor_sessions(self) -> list[str]:
        """Monitoring-only Telegram accounts, de-duplicated in stable order."""
        return _session_values(self.telegram_monitor_session, self.telegram_monitor_sessions_str)

    monitor_user_max_sources: int = Field(5, alias="MONITOR_USER_MAX_SOURCES")
    monitor_user_min_interval_minutes: int = Field(30, alias="MONITOR_USER_MIN_INTERVAL_MINUTES")
    monitor_worker_concurrency: int = Field(3, alias="MONITOR_WORKER_CONCURRENCY")
    
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
    public_registration_enabled: bool = Field(True, alias="PUBLIC_REGISTRATION_ENABLED")
    public_user_tts_daily_limit: int = Field(5, alias="PUBLIC_USER_TTS_DAILY_LIMIT")
    public_user_tts_max_chars: int = Field(20_000, alias="PUBLIC_USER_TTS_MAX_CHARS")
    public_user_stt_daily_limit: int = Field(5, alias="PUBLIC_USER_STT_DAILY_LIMIT")
    public_user_stt_max_seconds: int = Field(600, alias="PUBLIC_USER_STT_MAX_SECONDS")
    
    # Concurrency
    telegram_client_concurrency: int = 3
    
    # Web
    web_base_url: str = "http://localhost:5173"
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

    # Instagram Messaging webhook. The access token and account id are only
    # needed for sending the one-time pairing instructions back in Instagram.
    instagram_app_secret: str = Field("", alias="INSTAGRAM_APP_SECRET")
    instagram_webhook_verify_token: str = Field("", alias="INSTAGRAM_WEBHOOK_VERIFY_TOKEN")
    instagram_access_token: str = Field("", alias="INSTAGRAM_ACCESS_TOKEN")
    instagram_account_id: str = Field("", alias="INSTAGRAM_ACCOUNT_ID")
    instagram_graph_version: str = Field("v26.0", alias="INSTAGRAM_GRAPH_VERSION")

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
        # `.env` contains the normal local defaults. `.env.local` is ignored
        # by Git and deliberately wins over it, so a developer can point a
        # local API instance at another database without editing or exposing
        # the shared configuration file.
        env_file = (".env", ".env.local")
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
