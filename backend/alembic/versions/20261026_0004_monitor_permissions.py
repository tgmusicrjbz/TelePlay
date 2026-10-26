"""Add per-account source-monitor permission.

Revision ID: 20261026_0004
Revises: 20261026_0003
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261026_0004"
down_revision = "20261026_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {item["name"] for item in inspect(op.get_bind()).get_columns("users")}
    if "can_use_monitors" not in columns:
        op.add_column(
            "users",
            sa.Column("can_use_monitors", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    columns = {item["name"] for item in inspect(op.get_bind()).get_columns("users")}
    if "can_use_monitors" in columns:
        op.drop_column("users", "can_use_monitors")
