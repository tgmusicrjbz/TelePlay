"""Add the approved Instagram inbox bridge.

Revision ID: 20261027_0006
Revises: 20261026_0005
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261027_0006"
down_revision = "20261026_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(inspect(op.get_bind()).get_table_names())
    if "instagram_inbox_senders" not in tables:
        op.create_table(
            "instagram_inbox_senders",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("instagram_user_id", sa.String(128), nullable=False),
            sa.Column("username", sa.String(255)),
            sa.Column("telegram_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
            sa.Column("pairing_code", sa.String(12), nullable=False),
            sa.Column("approved", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("blocked", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("save_to_library", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("pairing_message_sent", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("received_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("forwarded_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("last_message_at", sa.DateTime()),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_instagram_inbox_senders_instagram_user_id", "instagram_inbox_senders", ["instagram_user_id"], unique=True)
        op.create_index("ix_instagram_inbox_senders_telegram_user_id", "instagram_inbox_senders", ["telegram_user_id"])
        op.create_index("ix_instagram_inbox_senders_pairing_code", "instagram_inbox_senders", ["pairing_code"], unique=True)
    if "instagram_inbox_events" not in tables:
        op.create_table(
            "instagram_inbox_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("sender_id", sa.Integer(), sa.ForeignKey("instagram_inbox_senders.id", ondelete="CASCADE"), nullable=False),
            sa.Column("event_id", sa.String(255), nullable=False),
            sa.Column("shared_url", sa.Text(), nullable=False),
            sa.Column("status", sa.String(24), nullable=False, server_default="pending"),
            sa.Column("import_job_id", sa.String(64)),
            sa.Column("error", sa.Text()),
            sa.Column("received_at", sa.DateTime(), nullable=False),
            sa.Column("queued_at", sa.DateTime()),
        )
        op.create_index("ix_instagram_inbox_events_sender_id", "instagram_inbox_events", ["sender_id"])
        op.create_index("ix_instagram_inbox_events_event_id", "instagram_inbox_events", ["event_id"], unique=True)
        op.create_index("ix_instagram_inbox_events_status", "instagram_inbox_events", ["status"])
        op.create_index("ix_instagram_inbox_events_import_job_id", "instagram_inbox_events", ["import_job_id"])
        op.create_index("idx_instagram_event_sender_status", "instagram_inbox_events", ["sender_id", "status"])


def downgrade() -> None:
    tables = set(inspect(op.get_bind()).get_table_names())
    if "instagram_inbox_events" in tables:
        op.drop_table("instagram_inbox_events")
    if "instagram_inbox_senders" in tables:
        op.drop_table("instagram_inbox_senders")
