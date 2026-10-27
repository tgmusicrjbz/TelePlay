"""Add hourly Instagram quotas and sender-selected destinations.

Revision ID: 20261028_0009
Revises: 20261027_0008
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261028_0009"
down_revision = "20261027_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("instagram_inbox_senders")}
    if "hourly_limit" not in columns:
        op.add_column(
            "instagram_inbox_senders",
            sa.Column("hourly_limit", sa.Integer(), nullable=False, server_default="2"),
        )
    if "selected_destination_id" not in columns:
        op.add_column(
            "instagram_inbox_senders",
            sa.Column("selected_destination_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_instagram_sender_destination",
            "instagram_inbox_senders",
            "telegram_destinations",
            ["selected_destination_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(
            "ix_instagram_inbox_senders_selected_destination_id",
            "instagram_inbox_senders",
            ["selected_destination_id"],
        )


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("instagram_inbox_senders")}
    if "selected_destination_id" in columns:
        op.drop_index("ix_instagram_inbox_senders_selected_destination_id", table_name="instagram_inbox_senders")
        op.drop_constraint("fk_instagram_sender_destination", "instagram_inbox_senders", type_="foreignkey")
        op.drop_column("instagram_inbox_senders", "selected_destination_id")
    if "hourly_limit" in columns:
        op.drop_column("instagram_inbox_senders", "hourly_limit")
