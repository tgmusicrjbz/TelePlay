"""Add synchronized watch rooms.

Revision ID: 20261102_0013
Revises: 20261102_0012
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "20261102_0013"
down_revision = "20261102_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    user_columns = {item["name"] for item in inspect(bind).get_columns("users")}
    if "can_create_rooms" not in user_columns:
        op.add_column("users", sa.Column("can_create_rooms", sa.Boolean(), nullable=False, server_default=sa.false()))
    if "watch_rooms" not in tables:
        op.create_table("watch_rooms",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(100), nullable=False), sa.Column("theme", sa.String(24), nullable=False, server_default="violet"),
            sa.Column("password_hash", sa.Text()), sa.Column("max_members", sa.Integer(), nullable=False, server_default="8"),
            sa.Column("chat_enabled", sa.Boolean(), nullable=False, server_default=sa.true()), sa.Column("voice_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("current_index", sa.Integer(), nullable=False, server_default="0"), sa.Column("playback_position", sa.Float(), nullable=False, server_default="0"),
            sa.Column("playback_rate", sa.Float(), nullable=False, server_default="1"), sa.Column("is_playing", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("state_updated_at", sa.DateTime(), nullable=False), sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False), sa.Column("updated_at", sa.DateTime(), nullable=False))
        op.create_index("ix_watch_rooms_owner_user_id", "watch_rooms", ["owner_user_id"])
        op.create_index("ix_watch_rooms_expires_at", "watch_rooms", ["expires_at"])
    if "room_members" not in tables:
        op.create_table("room_members", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("room_id", sa.String(36), sa.ForeignKey("watch_rooms.id", ondelete="CASCADE"), nullable=False), sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False), sa.Column("role", sa.String(16), nullable=False, server_default="viewer"), sa.Column("joined_at", sa.DateTime(), nullable=False), sa.UniqueConstraint("room_id", "user_id", name="uq_room_member"))
        op.create_index("ix_room_members_room_id", "room_members", ["room_id"]); op.create_index("ix_room_members_user_id", "room_members", ["user_id"])
    if "room_items" not in tables:
        op.create_table("room_items", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("room_id", sa.String(36), sa.ForeignKey("watch_rooms.id", ondelete="CASCADE"), nullable=False), sa.Column("file_id", sa.Integer(), sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=False), sa.Column("position", sa.Integer(), nullable=False, server_default="0"))
        op.create_index("ix_room_items_room_id", "room_items", ["room_id"]); op.create_index("idx_room_item_position", "room_items", ["room_id", "position"])
    if "room_messages" not in tables:
        op.create_table("room_messages", sa.Column("id", sa.Integer(), primary_key=True), sa.Column("room_id", sa.String(36), sa.ForeignKey("watch_rooms.id", ondelete="CASCADE"), nullable=False), sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False), sa.Column("content", sa.String(500), nullable=False), sa.Column("created_at", sa.DateTime(), nullable=False))
        op.create_index("ix_room_messages_room_id", "room_messages", ["room_id"]); op.create_index("ix_room_messages_created_at", "room_messages", ["created_at"])


def downgrade() -> None:
    tables = set(inspect(op.get_bind()).get_table_names())
    for table in ("room_messages", "room_items", "room_members", "watch_rooms"):
        if table in tables: op.drop_table(table)
    columns = {item["name"] for item in inspect(op.get_bind()).get_columns("users")}
    if "can_create_rooms" in columns: op.drop_column("users", "can_create_rooms")
