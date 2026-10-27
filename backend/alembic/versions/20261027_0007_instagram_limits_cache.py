"""Add Instagram sender quotas and reusable delivery cache.

Revision ID: 20261027_0007
Revises: 20261027_0006
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261027_0007"
down_revision = "20261027_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    sender_columns = {column["name"] for column in inspector.get_columns("instagram_inbox_senders")}
    if "daily_limit" not in sender_columns:
        op.add_column("instagram_inbox_senders", sa.Column("daily_limit", sa.Integer(), nullable=False, server_default="5"))
    if "monthly_limit" not in sender_columns:
        op.add_column("instagram_inbox_senders", sa.Column("monthly_limit", sa.Integer(), nullable=False, server_default="50"))
    event_columns = {column["name"] for column in inspector.get_columns("instagram_inbox_events")}
    if "cached_files_json" not in event_columns:
        op.add_column("instagram_inbox_events", sa.Column("cached_files_json", sa.Text(), nullable=False, server_default="[]"))


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    event_columns = {column["name"] for column in inspector.get_columns("instagram_inbox_events")}
    if "cached_files_json" in event_columns:
        op.drop_column("instagram_inbox_events", "cached_files_json")
    sender_columns = {column["name"] for column in inspector.get_columns("instagram_inbox_senders")}
    if "monthly_limit" in sender_columns:
        op.drop_column("instagram_inbox_senders", "monthly_limit")
    if "daily_limit" in sender_columns:
        op.drop_column("instagram_inbox_senders", "daily_limit")
