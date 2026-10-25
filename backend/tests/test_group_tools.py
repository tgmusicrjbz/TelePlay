"""Tests for Telegram group settings and daily quotas."""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_temp = tempfile.TemporaryDirectory()
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{(Path(_temp.name) / 'groups.sqlite').as_posix()}")
os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("JWT_SECRET", "test-secret")
os.environ.setdefault("ADMIN_USERS", "999")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base, async_session, engine
from app.group_tools import consume_group_quota, get_group_usage, get_or_create_group_settings


class TelegramGroupQuotaTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)

    async def asyncTearDown(self):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)

    async def test_group_and_member_limits_are_counted_separately(self):
        async with async_session() as db:
            group = await get_or_create_group_settings(db, -1001, "آزمایش")
            group.tts_daily_limit = 3
            group.member_tts_daily_limit = 2
            await db.commit()
            await consume_group_quota(db, chat_id=-1001, telegram_user_id=10, operation="tts")
            await consume_group_quota(db, chat_id=-1001, telegram_user_id=10, operation="tts")
            with self.assertRaisesRegex(ValueError, "سهمیه امروز شما"):
                await consume_group_quota(db, chat_id=-1001, telegram_user_id=10, operation="tts")
            await consume_group_quota(db, chat_id=-1001, telegram_user_id=11, operation="tts")
            with self.assertRaisesRegex(ValueError, "سهمیه امروز گروه"):
                await consume_group_quota(db, chat_id=-1001, telegram_user_id=11, operation="tts")
            total, member = await get_group_usage(db, -1001, 10)
            self.assertEqual(total.tts_count, 3)
            self.assertEqual(member.tts_count, 2)

    async def test_disabled_operation_is_rejected(self):
        async with async_session() as db:
            group = await get_or_create_group_settings(db, -1002)
            group.stt_enabled = False
            await db.commit()
            with self.assertRaisesRegex(ValueError, "غیرفعال"):
                await consume_group_quota(db, chat_id=-1002, telegram_user_id=10, operation="stt")

    async def test_global_admin_bypasses_disabled_tools_and_limits(self):
        async with async_session() as db:
            group = await get_or_create_group_settings(db, -1003)
            group.link_enabled = False
            group.link_daily_limit = 1
            group.member_link_daily_limit = 1
            await db.commit()
            with patch("app.group_tools.is_global_admin", return_value=True):
                for _ in range(3):
                    await consume_group_quota(db, chat_id=-1003, telegram_user_id=999, operation="link", amount=10)
            total, member = await get_group_usage(db, -1003, 999)
            self.assertIsNone(total)
            self.assertIsNone(member)

    async def test_zero_limit_means_unlimited(self):
        async with async_session() as db:
            group = await get_or_create_group_settings(db, -1004)
            group.link_daily_limit = 0
            group.member_link_daily_limit = 0
            await db.commit()
            for _ in range(5):
                await consume_group_quota(db, chat_id=-1004, telegram_user_id=10, operation="link", amount=4)
            total, member = await get_group_usage(db, -1004, 10)
            self.assertEqual(total.link_count, 20)
            self.assertEqual(member.link_count, 20)


if __name__ == "__main__":
    unittest.main()
