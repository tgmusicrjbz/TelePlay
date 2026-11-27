"""Add per-user incoming file routing preferences."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261128_0022"
down_revision = "20261122_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    if "incoming_file_routing_json" not in columns:
        op.add_column("users", sa.Column("incoming_file_routing_json", sa.Text(), nullable=False, server_default="{}"))


def downgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("users")}
    if "incoming_file_routing_json" in columns:
        op.drop_column("users", "incoming_file_routing_json")
