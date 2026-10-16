"""
Database setup with SQLAlchemy async support.
Supports both SQLite (for development) and PostgreSQL (for production).
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.engine import make_url
from sqlalchemy import inspect, text
from sqlalchemy.pool import NullPool
from .config import get_settings

settings = get_settings()

# Convert database URL for async drivers and handle query params
url = make_url(settings.database_url)

if url.drivername == "postgresql":
    url = url.set(drivername="postgresql+asyncpg")
    # Normalize provider-style query parameters for asyncpg.
    query = dict(url.query)
    query.pop("schema", None)
    if "sslmode" in query and "ssl" not in query:
        query["ssl"] = query.pop("sslmode")
    # Supabase/Supavisor uses port 6543 for transaction pooling. Connections
    # must not be retained by a second application-side pool, and asyncpg's
    # statement caches need to be disabled for this mode.
    if url.port == 6543:
        query["prepared_statement_cache_size"] = "0"
    url = url.set(query=query)
elif url.drivername == "sqlite":
    url = url.set(drivername="sqlite+aiosqlite")

engine_options = {
    "echo": False,
    "pool_pre_ping": True,
}
is_supabase_pooler = url.drivername == "postgresql+asyncpg" and (
    url.port == 6543 or (url.host or "").endswith(".pooler.supabase.com")
)
if is_supabase_pooler:
    # Supavisor's session endpoint (usually port 5432) has the same small
    # client budget as its transaction endpoint. Holding an application pool
    # on Railway can exhaust that budget during overlapping deployments.
    query = dict(url.query)
    query["prepared_statement_cache_size"] = "0"
    url = url.set(query=query)
    engine_options.update(
        poolclass=NullPool,
        connect_args={"statement_cache_size": 0},
    )
else:
    engine_options.update(
        pool_recycle=1800,  # Recycle connections every 30 minutes
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
    )

engine = create_async_engine(url, **engine_options)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    """Dependency for getting database session."""
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    """Create all tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        grant_columns = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("workspace_grants")}
        )
        if "scope_json" not in grant_columns:
            await conn.execute(text("ALTER TABLE workspace_grants ADD COLUMN scope_json TEXT NOT NULL DEFAULT '{}'"))
        user_columns = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("users")}
        )
        if "display_name" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN display_name VARCHAR(255)"))
        if "storage_channel_id" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN storage_channel_id BIGINT"))
        if "delete_storage_files" not in user_columns:
            delete_default = "TRUE" if url.drivername.startswith("postgresql") else "1"
            delete_type = "BOOLEAN" if url.drivername.startswith("postgresql") else "INTEGER"
            await conn.execute(text(f"ALTER TABLE users ADD COLUMN delete_storage_files {delete_type} NOT NULL DEFAULT {delete_default}"))
        if "tag_settings_json" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN tag_settings_json TEXT NOT NULL DEFAULT '[]'"))
        if "saved_filters_json" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN saved_filters_json TEXT NOT NULL DEFAULT '[]'"))
        if "show_file_tags" not in user_columns:
            tag_bool_type = "BOOLEAN" if url.drivername.startswith("postgresql") else "INTEGER"
            tag_bool_default = "FALSE" if url.drivername.startswith("postgresql") else "0"
            await conn.execute(text(f"ALTER TABLE users ADD COLUMN show_file_tags {tag_bool_type} NOT NULL DEFAULT {tag_bool_default}"))
        if "file_tag_limit" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN file_tag_limit INTEGER NOT NULL DEFAULT 2"))
        if "tts_settings_json" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN tts_settings_json TEXT NOT NULL DEFAULT '{}'"))
        if "player_state_json" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN player_state_json TEXT NOT NULL DEFAULT '{}'"))
        if "offline_manifest_json" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN offline_manifest_json TEXT NOT NULL DEFAULT '{}'"))
        if "gemini_api_keys_encrypted" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN gemini_api_keys_encrypted TEXT"))
        if "login_username" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN login_username VARCHAR(64)"))
        await conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_login_username ON users (login_username)"))
        if "password_hash" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN password_hash TEXT"))
        if "vault_password_hash" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN vault_password_hash TEXT"))
        if "failed_login_attempts" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER NOT NULL DEFAULT 0"))
        if "login_locked_until" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN login_locked_until TIMESTAMP"))
        if "is_active" not in user_columns:
            active_type = "BOOLEAN" if url.drivername.startswith("postgresql") else "INTEGER"
            active_default = "TRUE" if url.drivername.startswith("postgresql") else "1"
            await conn.execute(text(f"ALTER TABLE users ADD COLUMN is_active {active_type} NOT NULL DEFAULT {active_default}"))
        usage_columns = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("tts_usage")}
        )
        for column_name in ("stt_daily_limit", "stt_max_seconds", "stt_used_today", "stt_total_jobs", "stt_total_seconds"):
            if column_name not in usage_columns:
                column_type = "BIGINT" if column_name == "stt_total_seconds" else "INTEGER"
                await conn.execute(text(f"ALTER TABLE tts_usage ADD COLUMN {column_name} {column_type} NOT NULL DEFAULT 0"))
        columns = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("files")}
        )
        if "description" not in columns:
            await conn.execute(text("ALTER TABLE files ADD COLUMN description TEXT"))
        if "search_text" not in columns:
            await conn.execute(text("ALTER TABLE files ADD COLUMN search_text TEXT"))
        if "content_hash" not in columns:
            await conn.execute(text("ALTER TABLE files ADD COLUMN content_hash VARCHAR(64)"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS ix_files_content_hash ON files (content_hash)"))
        if "is_shortcut" not in columns:
            shortcut_type = "BOOLEAN" if url.drivername.startswith("postgresql") else "INTEGER"
            shortcut_default = "FALSE" if url.drivername.startswith("postgresql") else "0"
            await conn.execute(text(f"ALTER TABLE files ADD COLUMN is_shortcut {shortcut_type} NOT NULL DEFAULT {shortcut_default}"))
        if "tags_json" not in columns:
            await conn.execute(text("ALTER TABLE files ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'"))
        if "storage_channel_id" not in columns:
            await conn.execute(text("ALTER TABLE files ADD COLUMN storage_channel_id BIGINT"))
        if "is_favorite" not in columns:
            favorite_type = "BOOLEAN" if url.drivername.startswith("postgresql") else "INTEGER"
            favorite_default = "FALSE" if url.drivername.startswith("postgresql") else "0"
            await conn.execute(text(f"ALTER TABLE files ADD COLUMN is_favorite {favorite_type} NOT NULL DEFAULT {favorite_default}"))
        if "is_pinned" not in columns:
            favorite_type = "BOOLEAN" if url.drivername.startswith("postgresql") else "INTEGER"
            favorite_default = "FALSE" if url.drivername.startswith("postgresql") else "0"
            await conn.execute(text(f"ALTER TABLE files ADD COLUMN is_pinned {favorite_type} NOT NULL DEFAULT {favorite_default}"))
        if "is_hidden" not in columns:
            hidden_type = "BOOLEAN" if url.drivername.startswith("postgresql") else "INTEGER"
            hidden_default = "FALSE" if url.drivername.startswith("postgresql") else "0"
            await conn.execute(text(f"ALTER TABLE files ADD COLUMN is_hidden {hidden_type} NOT NULL DEFAULT {hidden_default}"))
        share_bool_type = "BOOLEAN" if url.drivername.startswith("postgresql") else "INTEGER"
        share_bool_default = "TRUE" if url.drivername.startswith("postgresql") else "1"
        if "public_expires_at" not in columns:
            await conn.execute(text("ALTER TABLE files ADD COLUMN public_expires_at TIMESTAMP"))
        if "public_password_hash" not in columns:
            await conn.execute(text("ALTER TABLE files ADD COLUMN public_password_hash TEXT"))
        if "public_allow_download" not in columns:
            await conn.execute(text(f"ALTER TABLE files ADD COLUMN public_allow_download {share_bool_type} NOT NULL DEFAULT {share_bool_default}"))
        if "public_view_limit" not in columns:
            await conn.execute(text("ALTER TABLE files ADD COLUMN public_view_limit INTEGER"))
        if "public_view_count" not in columns:
            await conn.execute(text("ALTER TABLE files ADD COLUMN public_view_count INTEGER NOT NULL DEFAULT 0"))
        for column_name, column_type in (
            ("audio_variant_file_id", "VARCHAR(255)"),
            ("audio_variant_unique_id", "VARCHAR(255)"),
            ("audio_variant_message_id", "BIGINT"),
            ("audio_variant_storage_channel_id", "BIGINT"),
            ("audio_variant_size", "BIGINT"),
        ):
            if column_name not in columns:
                await conn.execute(text(f"ALTER TABLE files ADD COLUMN {column_name} {column_type}"))
        playlist_columns = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("playlists")}
        )
        if "cover_file_id" not in playlist_columns:
            await conn.execute(text("ALTER TABLE playlists ADD COLUMN cover_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL"))
        if "position" not in playlist_columns:
            await conn.execute(text("ALTER TABLE playlists ADD COLUMN position INTEGER NOT NULL DEFAULT 0"))
        if url.drivername.startswith("postgresql"):
            await conn.execute(text("ALTER TABLE playlist_items DROP CONSTRAINT IF EXISTS uq_playlist_file"))
        folder_columns = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("folders")}
        )
        if "description" not in folder_columns:
            await conn.execute(text("ALTER TABLE folders ADD COLUMN description TEXT"))
        favorite_type = "BOOLEAN" if url.drivername.startswith("postgresql") else "INTEGER"
        favorite_default = "FALSE" if url.drivername.startswith("postgresql") else "0"
        if "is_favorite" not in folder_columns:
            await conn.execute(text(f"ALTER TABLE folders ADD COLUMN is_favorite {favorite_type} NOT NULL DEFAULT {favorite_default}"))
        if "is_pinned" not in folder_columns:
            await conn.execute(text(f"ALTER TABLE folders ADD COLUMN is_pinned {favorite_type} NOT NULL DEFAULT {favorite_default}"))
        if "is_default" not in folder_columns:
            await conn.execute(text(f"ALTER TABLE folders ADD COLUMN is_default {favorite_type} NOT NULL DEFAULT {favorite_default}"))
        if "is_hidden" not in folder_columns:
            await conn.execute(text(f"ALTER TABLE folders ADD COLUMN is_hidden {favorite_type} NOT NULL DEFAULT {favorite_default}"))
        if "color" not in folder_columns:
            await conn.execute(text("ALTER TABLE folders ADD COLUMN color VARCHAR(7)"))
        if "icon" not in folder_columns:
            await conn.execute(text("ALTER TABLE folders ADD COLUMN icon VARCHAR(16)"))
        if "cover_file_id" not in folder_columns:
            await conn.execute(text("ALTER TABLE folders ADD COLUMN cover_file_id INTEGER REFERENCES files(id) ON DELETE SET NULL"))
        bot_state_columns = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("bot_user_states")}
        )
        if "upload_drawer_id" not in bot_state_columns:
            await conn.execute(text("ALTER TABLE bot_user_states ADD COLUMN upload_drawer_id INTEGER"))
