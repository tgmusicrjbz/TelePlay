"""Add playlist-local display names."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261114_0020"
down_revision = "20261103_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("playlist_items")}
    if "display_name" not in columns:
        op.add_column("playlist_items", sa.Column("display_name", sa.String(length=255), nullable=True))


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("playlist_items")}
    if "display_name" in columns:
        op.drop_column("playlist_items", "display_name")
