"""Add public shares for folders, packs, and playlists.

Revision ID: 20261103_0014
Revises: 20261102_0013
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

revision = "20261103_0014"
down_revision = "20261102_0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "public_collection_shares" in inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "public_collection_shares",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("owner_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource_type", sa.String(16), nullable=False),
        sa.Column("resource_id", sa.Integer(), nullable=False),
        sa.Column("public_hash", sa.String(64), nullable=False),
        sa.Column("expires_at", sa.DateTime()),
        sa.Column("password_hash", sa.Text()),
        sa.Column("allow_download", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("view_limit", sa.Integer()),
        sa.Column("view_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("owner_user_id", "resource_type", "resource_id", name="uq_public_collection_resource"),
    )
    op.create_index("ix_public_collection_shares_owner_user_id", "public_collection_shares", ["owner_user_id"])
    op.create_index("ix_public_collection_shares_public_hash", "public_collection_shares", ["public_hash"], unique=True)
    op.create_index("idx_public_collection_resource", "public_collection_shares", ["resource_type", "resource_id"])


def downgrade() -> None:
    if "public_collection_shares" in inspect(op.get_bind()).get_table_names():
        op.drop_table("public_collection_shares")
