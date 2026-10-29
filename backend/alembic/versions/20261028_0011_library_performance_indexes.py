"""Add indexes for large library browsing.

Revision ID: 20261028_0011
Revises: 20261028_0010
"""
from alembic import op
from sqlalchemy import inspect


revision = "20261028_0011"
down_revision = "20261028_0010"
branch_labels = None
depends_on = None


INDEXES = {
    "files": (
        ("idx_file_user_hidden_created", ("user_id", "is_hidden", "created_at")),
        ("idx_file_user_folder_hidden_created", ("user_id", "folder_id", "is_hidden", "created_at")),
        ("idx_file_user_favorite_created", ("user_id", "is_favorite", "created_at")),
        ("idx_file_user_type_created", ("user_id", "file_type", "created_at")),
    ),
    "folders": (
        ("idx_folder_user_parent_hidden_name", ("user_id", "parent_id", "is_hidden", "name")),
        ("idx_folder_user_cover", ("user_id", "cover_file_id")),
    ),
    "playlists": (("idx_playlist_user_cover", ("user_id", "cover_file_id")),),
    "packs": (("idx_pack_user_hidden", ("user_id", "hide_member_files", "id")),),
    "pack_items": (("idx_pack_item_file_pack", ("file_id", "pack_id")),),
}


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for table_name, definitions in INDEXES.items():
        if table_name not in tables:
            continue
        existing = {item["name"] for item in inspector.get_indexes(table_name)}
        for name, columns in definitions:
            if name not in existing:
                op.create_index(name, table_name, list(columns), unique=False)


def downgrade() -> None:
    inspector = inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    for table_name, definitions in reversed(tuple(INDEXES.items())):
        if table_name not in tables:
            continue
        existing = {item["name"] for item in inspect(op.get_bind()).get_indexes(table_name)}
        for name, _columns in reversed(definitions):
            if name in existing:
                op.drop_index(name, table_name=table_name)
