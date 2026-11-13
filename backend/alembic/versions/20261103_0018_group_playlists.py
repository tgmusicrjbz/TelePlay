"""Add Telegram group playlist ownership.

Revision ID: 20261103_0018
Revises: 20261103_0017
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261103_0018"
down_revision = "20261103_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("playlists")}
    if "group_chat_id" not in columns:
        op.add_column("playlists", sa.Column("group_chat_id", sa.BigInteger(), nullable=True))
    indexes = {index["name"] for index in inspect(op.get_bind()).get_indexes("playlists")}
    if "ix_playlists_group_chat_id" not in indexes:
        op.create_index("ix_playlists_group_chat_id", "playlists", ["group_chat_id"])
    constraints = {constraint["name"] for constraint in inspect(op.get_bind()).get_unique_constraints("playlists")}
    if "uq_playlist_group_name" not in constraints:
        op.create_unique_constraint("uq_playlist_group_name", "playlists", ["group_chat_id", "name"])


def downgrade() -> None:
    constraints = {constraint["name"] for constraint in inspect(op.get_bind()).get_unique_constraints("playlists")}
    if "uq_playlist_group_name" in constraints:
        op.drop_constraint("uq_playlist_group_name", "playlists", type_="unique")
    indexes = {index["name"] for index in inspect(op.get_bind()).get_indexes("playlists")}
    if "ix_playlists_group_chat_id" in indexes:
        op.drop_index("ix_playlists_group_chat_id", table_name="playlists")
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("playlists")}
    if "group_chat_id" in columns:
        op.drop_column("playlists", "group_chat_id")
