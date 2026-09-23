"""
Database setup with SQLAlchemy async support.
Supports both SQLite (for development) and PostgreSQL (for production).
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.engine import make_url
from sqlalchemy import inspect, text
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
    url = url.set(query=query)
elif url.drivername == "sqlite":
    url = url.set(drivername="sqlite+aiosqlite")

connect_args = {}
if url.drivername == "postgresql+asyncpg":
    # Disable asyncpg's local prepared statement cache. Without this, a pooled
    # connection (e.g. behind pgbouncer or a proxy) can raise
    # DuplicatePreparedStatementError when a statement name collides with one
    # prepared by a different logical session sharing the same physical connection.
    connect_args["statement_cache_size"] = 0

engine = create_async_engine(
    url, 
    echo=False,
    pool_pre_ping=True,
    pool_recycle=1800,  # Recycle connections every 30 minutes
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
    connect_args=connect_args,
)
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
