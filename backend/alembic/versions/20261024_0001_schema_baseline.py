"""Create or adopt the current Komod schema.

Revision ID: 20261024_0001
Revises: None
"""
from alembic import op
from sqlalchemy import inspect, text

from app.database import Base
from app import models  # noqa: F401 - registers model metadata


revision = "20261024_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)

    # These constraints existed in early PostgreSQL installations but are no
    # longer part of the product rules (playlist duplicates and equal pack
    # names are both valid). Keep the legacy cleanup in the versioned baseline.
    if bind.dialect.name == "postgresql":
        bind.execute(text("ALTER TABLE playlist_items DROP CONSTRAINT IF EXISTS uq_playlist_file"))
        bind.execute(text("ALTER TABLE packs DROP CONSTRAINT IF EXISTS uq_pack_user_folder_name"))

    # Existing installations are adopted only when every current model column
    # exists. This prevents a partial legacy schema from being stamped current.
    inspector = inspect(bind)
    missing: list[str] = []
    for table in Base.metadata.sorted_tables:
        actual = {column["name"] for column in inspector.get_columns(table.name)}
        missing.extend(f"{table.name}.{column.name}" for column in table.columns if column.name not in actual)
        actual_indexes = {index["name"] for index in inspector.get_indexes(table.name)}
        for index in table.indexes:
            if index.name and index.name not in actual_indexes:
                index.create(bind=bind)
    if missing:
        raise RuntimeError(
            "The existing database is older than the Alembic baseline. "
            "Run the previous application build once, then retry the migration. "
            f"Missing columns: {', '.join(missing)}"
        )


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind(), checkfirst=True)
