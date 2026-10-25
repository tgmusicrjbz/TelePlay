"""Add Telegram group tools settings and quotas.

Revision ID: 20261025_0002
Revises: 20261024_0001
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261025_0002"
down_revision = "20261024_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = set(inspect(op.get_bind()).get_table_names())
    if "telegram_group_settings" not in existing:
        op.create_table(
        "telegram_group_settings",
        sa.Column("chat_id", sa.BigInteger(), primary_key=True),
        sa.Column("title", sa.String(255), nullable=False, server_default="گروه تلگرام"),
        sa.Column("tts_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("stt_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("link_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("tts_daily_limit", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("stt_daily_limit", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("link_daily_limit", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("member_tts_daily_limit", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("member_stt_daily_limit", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("member_link_daily_limit", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
    if "telegram_group_usage" not in existing:
        op.create_table(
        "telegram_group_usage",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("telegram_user_id", sa.BigInteger(), nullable=False),
        sa.Column("usage_date", sa.Date(), nullable=False),
        sa.Column("tts_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("stt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("link_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("chat_id", "telegram_user_id", "usage_date", name="uq_group_usage_member_day"),
        )
    indexes = {item["name"] for item in inspect(op.get_bind()).get_indexes("telegram_group_usage")}
    if "ix_telegram_group_usage_chat_id" not in indexes:
        op.create_index("ix_telegram_group_usage_chat_id", "telegram_group_usage", ["chat_id"])
    if "idx_group_usage_chat_day" not in indexes:
        op.create_index("idx_group_usage_chat_day", "telegram_group_usage", ["chat_id", "usage_date"])


def downgrade() -> None:
    op.drop_index("idx_group_usage_chat_day", table_name="telegram_group_usage")
    op.drop_index("ix_telegram_group_usage_chat_id", table_name="telegram_group_usage")
    op.drop_table("telegram_group_usage")
    op.drop_table("telegram_group_settings")
