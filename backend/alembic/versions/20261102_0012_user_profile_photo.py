"""Add user-owned profile photos.

Revision ID: 20261102_0012
Revises: 20261028_0011
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261102_0012"
down_revision = "20261028_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "users" not in inspect(op.get_bind()).get_table_names():
        return
    columns = {item["name"] for item in inspect(op.get_bind()).get_columns("users")}
    if "profile_photo" not in columns:
        op.add_column("users", sa.Column("profile_photo", sa.LargeBinary(), nullable=True))
    if "profile_photo_mime" not in columns:
        op.add_column("users", sa.Column("profile_photo_mime", sa.String(length=64), nullable=True))
    if "profile_photo_updated_at" not in columns:
        op.add_column("users", sa.Column("profile_photo_updated_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    if "users" not in inspect(op.get_bind()).get_table_names():
        return
    columns = {item["name"] for item in inspect(op.get_bind()).get_columns("users")}
    for name in ("profile_photo_updated_at", "profile_photo_mime", "profile_photo"):
        if name in columns:
            op.drop_column("users", name)
