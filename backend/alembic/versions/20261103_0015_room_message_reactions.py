"""Persist reactions on room chat messages.

Revision ID: 20261103_0015
Revises: 20261103_0014
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "20261103_0015"
down_revision = "20261103_0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "room_message_reactions" in inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "room_message_reactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("message_id", sa.Integer(), sa.ForeignKey("room_messages.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("emoji", sa.String(12), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("message_id", "user_id", "emoji", name="uq_room_message_reaction"),
    )
    op.create_index("ix_room_message_reactions_message_id", "room_message_reactions", ["message_id"])
    op.create_index("ix_room_message_reactions_user_id", "room_message_reactions", ["user_id"])


def downgrade() -> None:
    if "room_message_reactions" in inspect(op.get_bind()).get_table_names():
        op.drop_table("room_message_reactions")
