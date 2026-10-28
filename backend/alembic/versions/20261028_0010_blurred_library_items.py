"""Add persistent blur flags to library items.

Revision ID: 20261028_0010
Revises: 20261028_0009
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261028_0010"
down_revision = "20261028_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    for table_name in ("files", "folders", "packs"):
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        if "is_blurred" not in columns:
            op.add_column(table_name, sa.Column("is_blurred", sa.Boolean(), nullable=False, server_default=sa.false()))
    pack_columns = {column["name"] for column in inspector.get_columns("packs")}
    if "cover_zoom" not in pack_columns:
        op.add_column("packs", sa.Column("cover_zoom", sa.Integer(), nullable=False, server_default="100"))


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    pack_columns = {column["name"] for column in inspector.get_columns("packs")}
    if "cover_zoom" in pack_columns:
        op.drop_column("packs", "cover_zoom")
    for table_name in ("packs", "folders", "files"):
        columns = {column["name"] for column in inspector.get_columns(table_name)}
        if "is_blurred" in columns:
            op.drop_column(table_name, "is_blurred")
