import os
import sys
import tempfile
import unittest
from pathlib import Path

_temp = tempfile.TemporaryDirectory()
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{(Path(_temp.name) / 'bot-messages.sqlite').as_posix()}")
os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("JWT_SECRET", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.bot_messages import BOT_MESSAGE_DEFINITIONS, SETTING_PREFIX, bot_message, invalidate_bot_message_cache, validate_bot_message
from app.database import Base, async_session, engine
from app.models import AppSetting


class BotMessageTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)
        invalidate_bot_message_cache()

    async def test_custom_template_is_loaded_and_rendered(self):
        async with async_session() as db:
            db.add(AppSetting(key=f"{SETTING_PREFIX}link_queued", value="تعداد: {count}{queue_note}"))
            await db.commit()
        self.assertEqual(await bot_message("link_queued", count="۲", queue_note=" · نوبت ۳"), "تعداد: ۲ · نوبت ۳")

    async def test_unknown_variables_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "متغیر ناشناخته"):
            validate_bot_message("welcome", "سلام {unknown}")

    async def test_literal_braces_are_supported(self):
        self.assertEqual(validate_bot_message("help", "نمونه {{متن}}"), "نمونه {{متن}}")

    async def test_all_default_templates_are_valid(self):
        for definition in BOT_MESSAGE_DEFINITIONS:
            self.assertEqual(validate_bot_message(definition.key, definition.default), definition.default)


if __name__ == "__main__":
    unittest.main()
