"""Add Telegram STT prompt and link notification preferences."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20261122_0021"
down_revision = "20261114_0020"
branch_labels = None
depends_on = None


def _add_boolean(table: str, name: str, default: bool) -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns(table)}
    if name not in columns:
        op.add_column(table, sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.true() if default else sa.false()))


def upgrade() -> None:
    _add_boolean("bot_user_states", "stt_ask_prompt", False)
    _add_boolean("bot_user_states", "link_notify_enabled", True)
    _add_boolean("telegram_group_settings", "stt_ask_prompt", False)
    _add_boolean("telegram_group_settings", "link_notify_enabled", True)


def downgrade() -> None:
    for table, names in (
        ("bot_user_states", ("link_notify_enabled", "stt_ask_prompt")),
        ("telegram_group_settings", ("link_notify_enabled", "stt_ask_prompt")),
    ):
        columns = {column["name"] for column in inspect(op.get_bind()).get_columns(table)}
        for name in names:
            if name in columns:
                op.drop_column(table, name)
