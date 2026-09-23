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
if url.drivername == "postgresql+asyncpg" and url.port == 6543:
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
        columns = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("files")}
        )
        if "description" not in columns:
            await conn.execute(text("ALTER TABLE files ADD COLUMN description TEXT"))
        folder_columns = await conn.run_sync(
            lambda sync_conn: {column["name"] for column in inspect(sync_conn).get_columns("folders")}
        )
        if "description" not in folder_columns:
            await conn.execute(text("ALTER TABLE folders ADD COLUMN description TEXT"))
