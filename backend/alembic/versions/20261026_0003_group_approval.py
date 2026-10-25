"""Separate group approval from destination availability.

Revision ID: 20261026_0003
Revises: 20261025_0002
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261026_0003"
down_revision = "20261025_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {item["name"] for item in inspect(op.get_bind()).get_columns("telegram_group_settings")}
    if "approved" not in columns:
        # Existing `destination.enabled` values mixed delivery preferences with
        # approval. Defaulting to false makes every legacy group request an
        # explicit administrator decision once.
        op.add_column(
            "telegram_group_settings",
            sa.Column("approved", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    columns = {item["name"] for item in inspect(op.get_bind()).get_columns("telegram_group_settings")}
    if "approved" in columns:
        op.drop_column("telegram_group_settings", "approved")
