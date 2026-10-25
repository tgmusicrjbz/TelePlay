import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_temp = tempfile.TemporaryDirectory()
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{(Path(_temp.name) / 'admin-groups.sqlite').as_posix()}")
os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("JWT_SECRET", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base, async_session, engine
from app.models import TelegramDestination, TelegramGroupSettings, User
from app.routers.admin_groups import GroupSettingsUpdate, list_groups, update_group


class AdminGroupSettingsTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)
        async with async_session() as db:
            owner = User(telegram_id=100, first_name="مالک")
            admin = User(telegram_id=999, first_name="مدیر")
            db.add_all([owner, admin])
            await db.flush()
            db.add(TelegramDestination(user_id=owner.id, name="گروه", chat_id=-10055, chat_type="supergroup", enabled=False))
            db.add(TelegramGroupSettings(chat_id=-10055, title="گروه آزمایشی"))
            await db.commit()
            self.admin_id = admin.id

    async def test_admin_can_approve_and_set_exact_limits(self):
        async with async_session() as db:
            admin = await db.get(User, self.admin_id)
            groups = await list_groups(admin, db)
            self.assertFalse(groups[0]["approved"])
            with patch("app.routers.admin_groups.telegram.tg_client", None):
                updated = await update_group(-10055, GroupSettingsUpdate(
                    approved=True, tts_daily_limit=42, member_tts_daily_limit=7,
                ), admin, db)
            self.assertTrue(updated["approved"])
            self.assertEqual(updated["tts_daily_limit"], 42)
            self.assertEqual(updated["member_tts_daily_limit"], 7)


if __name__ == "__main__":
    unittest.main()
