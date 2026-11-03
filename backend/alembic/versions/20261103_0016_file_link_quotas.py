"""Add per-user Telegram file-link quotas and rolling usage events.

Revision ID: 20261103_0016
Revises: 20261103_0015
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261103_0016"
down_revision = "20261103_0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    usage_columns = {column["name"] for column in inspector.get_columns("tts_usage")}
    for name in ("link_hourly_limit", "link_daily_limit", "link_monthly_limit"):
        if name not in usage_columns:
            op.add_column("tts_usage", sa.Column(name, sa.Integer(), nullable=False, server_default="0"))

    if "telegram_file_link_usage" not in inspector.get_table_names():
        op.create_table(
            "telegram_file_link_usage",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("telegram_user_id", sa.BigInteger(), nullable=False),
            sa.Column("chat_id", sa.BigInteger(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_telegram_file_link_usage_user_id", "telegram_file_link_usage", ["user_id"])
        op.create_index("ix_telegram_file_link_usage_telegram_user_id", "telegram_file_link_usage", ["telegram_user_id"])
        op.create_index("ix_telegram_file_link_usage_chat_id", "telegram_file_link_usage", ["chat_id"])
        op.create_index("ix_telegram_file_link_usage_created_at", "telegram_file_link_usage", ["created_at"])
        op.create_index("idx_file_link_usage_user_created", "telegram_file_link_usage", ["user_id", "created_at"])


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    if "telegram_file_link_usage" in inspector.get_table_names():
        op.drop_table("telegram_file_link_usage")
    usage_columns = {column["name"] for column in inspect(op.get_bind()).get_columns("tts_usage")}
    for name in ("link_monthly_limit", "link_daily_limit", "link_hourly_limit"):
        if name in usage_columns:
            op.drop_column("tts_usage", name)
