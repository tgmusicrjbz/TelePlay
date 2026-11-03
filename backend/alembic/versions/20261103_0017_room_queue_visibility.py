"""Add viewer queue visibility to watch rooms.

Revision ID: 20261103_0017
Revises: 20261103_0016
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261103_0017"
down_revision = "20261103_0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("watch_rooms")}
    if "queue_visible_to_viewers" not in columns:
        op.add_column("watch_rooms", sa.Column("queue_visible_to_viewers", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("watch_rooms")}
    if "queue_visible_to_viewers" in columns:
        op.drop_column("watch_rooms", "queue_visible_to_viewers")
