"""Async database setup and production schema verification."""
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool

from .config import get_settings


settings = get_settings()
url = make_url(settings.database_url)

if url.drivername == "postgresql":
    url = url.set(drivername="postgresql+asyncpg")
    query = dict(url.query)
    query.pop("schema", None)
    if "sslmode" in query and "ssl" not in query:
        query["ssl"] = query.pop("sslmode")
    if url.port == 6543:
        query["prepared_statement_cache_size"] = "0"
    url = url.set(query=query)
elif url.drivername == "sqlite":
    url = url.set(drivername="sqlite+aiosqlite")

engine_options: dict[str, object] = {"echo": False, "pool_pre_ping": True}
is_supabase_transaction_pooler = url.drivername == "postgresql+asyncpg" and url.port == 6543
is_supabase_session_pooler = url.drivername == "postgresql+asyncpg" and (
    (url.host or "").endswith(".pooler.supabase.com") and url.port != 6543
)
if url.drivername == "sqlite+aiosqlite":
    # Tests and local reloads create separate event loops. A connection reused
    # by another loop can leave SQLite in a stale state.
    engine_options.update(poolclass=NullPool)
elif is_supabase_transaction_pooler:
    query = dict(url.query)
    query["prepared_statement_cache_size"] = "0"
    url = url.set(query=query)
    engine_options.update(poolclass=NullPool, connect_args={"statement_cache_size": 0})
elif is_supabase_session_pooler:
    # Supabase's session pooler has a small, hard connection limit. NullPool
    # opened one connection per simultaneous asset/API request, so a page load
    # could exhaust the whole project and make webhooks fail before reaching
    # their handler. A bounded local pool queues bursts instead.
    engine_options.update(
        pool_size=max(1, min(settings.db_pool_size, 8)),
        max_overflow=0,
        pool_timeout=30,
        pool_recycle=900,
    )
else:
    engine_options.update(
        pool_recycle=1800,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
    )

engine = create_async_engine(url, **engine_options)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    """Yield one request-scoped database session."""
    async with async_session() as session:
        yield session


def _migration_heads() -> set[str]:
    backend_root = Path(__file__).resolve().parents[1]
    config = Config(str(backend_root / "alembic.ini"))
    config.set_main_option("script_location", str(backend_root / "alembic"))
    return set(ScriptDirectory.from_config(config).get_heads())


async def verify_database_schema() -> None:
    """Fail fast when deployment migrations have not reached the current head."""
    async with engine.connect() as connection:
        tables = await connection.run_sync(lambda sync: set(inspect(sync).get_table_names()))
        if "alembic_version" not in tables:
            raise RuntimeError(
                "Database migrations are missing. Run `alembic upgrade head` before starting the API."
            )
        current = set((await connection.execute(text("SELECT version_num FROM alembic_version"))).scalars())
    expected = _migration_heads()
    if current != expected:
        raise RuntimeError(
            f"Database revision is {sorted(current) or ['none']}; expected {sorted(expected)}. "
            "Run `alembic upgrade head` before starting the API."
        )
