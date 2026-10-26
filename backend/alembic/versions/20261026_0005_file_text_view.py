"""Persist the preferred caption-first view for attachments.

Revision ID: 20261026_0005
Revises: 20261026_0004
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision = "20261026_0005"
down_revision = "20261026_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {item["name"] for item in inspect(op.get_bind()).get_columns("files")}
    if "prefer_text_view" not in columns:
        op.add_column(
            "files",
            sa.Column("prefer_text_view", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    # Adopt and remove synthetic rows created by the old text companion
    # implementation. Their content already lives in the original caption.
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        bind.execute(text("""
            UPDATE files AS media SET prefer_text_view = TRUE
            FROM files AS note
            WHERE note.file_id = 'text-post:' || media.id::text
        """))
    else:
        bind.execute(text("""
            UPDATE files SET prefer_text_view = 1
            WHERE id IN (
                SELECT CAST(substr(file_id, 11) AS INTEGER)
                FROM files WHERE file_id LIKE 'text-post:%'
            )
        """))
    bind.execute(text("DELETE FROM files WHERE file_id LIKE 'text-post:%'"))


def downgrade() -> None:
    columns = {item["name"] for item in inspect(op.get_bind()).get_columns("files")}
    if "prefer_text_view" in columns:
        op.drop_column("files", "prefer_text_view")
