"""Add shared group cabinet indexes."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261103_0019"
down_revision = "20261103_0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "group_cabinets" not in tables:
        op.create_table(
            "group_cabinets",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("chat_id", sa.BigInteger(), nullable=False),
            sa.Column("title", sa.String(length=255), nullable=False, server_default="کمد گروه"),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("storage_channel_id", sa.BigInteger(), nullable=True),
            sa.Column("max_storage_bytes", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("member_daily_add_limit", sa.Integer(), nullable=False, server_default="50"),
            sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("chat_id", name="uq_group_cabinet_chat"),
        )
        op.create_index("ix_group_cabinets_chat_id", "group_cabinets", ["chat_id"])
    if "group_cabinet_items" not in tables:
        op.create_table(
            "group_cabinet_items",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("cabinet_id", sa.Integer(), sa.ForeignKey("group_cabinets.id", ondelete="CASCADE"), nullable=False),
            sa.Column("file_id", sa.Integer(), sa.ForeignKey("files.id", ondelete="CASCADE"), nullable=False),
            sa.Column("added_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("cabinet_id", "file_id", name="uq_group_cabinet_file"),
        )
        op.create_index("ix_group_cabinet_items_cabinet_id", "group_cabinet_items", ["cabinet_id"])
        op.create_index("ix_group_cabinet_items_file_id", "group_cabinet_items", ["file_id"])
        op.create_index("idx_group_cabinet_items_order", "group_cabinet_items", ["cabinet_id", "created_at", "id"])
    if "group_cabinet_members" not in tables:
        op.create_table(
            "group_cabinet_members",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("cabinet_id", sa.Integer(), sa.ForeignKey("group_cabinets.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("role", sa.String(length=16), nullable=False, server_default="viewer"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("cabinet_id", "user_id", name="uq_group_cabinet_member"),
        )
        op.create_index("ix_group_cabinet_members_cabinet_id", "group_cabinet_members", ["cabinet_id"])
        op.create_index("ix_group_cabinet_members_user_id", "group_cabinet_members", ["user_id"])


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    if "group_cabinet_items" in inspector.get_table_names():
        op.drop_table("group_cabinet_items")
    if "group_cabinet_members" in inspector.get_table_names():
        op.drop_table("group_cabinet_members")
    if "group_cabinets" in inspector.get_table_names():
        op.drop_table("group_cabinets")
