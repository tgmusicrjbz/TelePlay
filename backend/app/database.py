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
        if "show_file_tags" not in user_columns:
            tag_bool_type = "BOOLEAN" if url.drivername.startswith("postgresql") else "INTEGER"
            tag_bool_default = "FALSE" if url.drivername.startswith("postgresql") else "0"
            await conn.execute(text(f"ALTER TABLE users ADD COLUMN show_file_tags {tag_bool_type} NOT NULL DEFAULT {tag_bool_default}"))
        if "file_tag_limit" not in user_columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN file_tag_limit INTEGER NOT NULL DEFAULT 2"))
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
        columns = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("files")}
        )
        if "description" not in columns:
            await conn.execute(text("ALTER TABLE files ADD COLUMN description TEXT"))
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
        bot_state_columns = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("bot_user_states")}
        )
        if "upload_drawer_id" not in bot_state_columns:
            await conn.execute(text("ALTER TABLE bot_user_states ADD COLUMN upload_drawer_id INTEGER"))
