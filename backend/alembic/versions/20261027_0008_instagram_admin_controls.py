"""Add Instagram sender names and daily quota reset markers.

Revision ID: 20261027_0008
Revises: 20261027_0007
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261027_0008"
down_revision = "20261027_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("instagram_inbox_senders")}
    if "display_name" not in columns:
        op.add_column("instagram_inbox_senders", sa.Column("display_name", sa.String(length=120), nullable=True))
    if "daily_quota_reset_at" not in columns:
        op.add_column("instagram_inbox_senders", sa.Column("daily_quota_reset_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("instagram_inbox_senders")}
    if "daily_quota_reset_at" in columns:
        op.drop_column("instagram_inbox_senders", "daily_quota_reset_at")
    if "display_name" in columns:
        op.drop_column("instagram_inbox_senders", "display_name")
