import io
import os
import unittest

from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./profile-photo-test.sqlite")
os.environ.setdefault("JWT_SECRET", "test-secret")

from app.models import User
from app.routers.accounts import delete_profile_photo, update_profile_photo


class _Database:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1


def _upload(content: bytes, mime: str) -> UploadFile:
    return UploadFile(
        file=io.BytesIO(content),
        filename="profile.webp",
        headers=Headers({"content-type": mime}),
    )


class ProfilePhotoTests(unittest.IsolatedAsyncioTestCase):
    async def test_photo_is_saved_and_can_be_deleted(self):
        user = User(telegram_id=123)
        database = _Database()

        result = await update_profile_photo(_upload(b"valid-image-bytes", "image/webp"), user, database)

        self.assertTrue(result["has_profile_photo"])
        self.assertEqual(user.profile_photo, b"valid-image-bytes")
        self.assertEqual(user.profile_photo_mime, "image/webp")
        self.assertIsNotNone(user.profile_photo_updated_at)
        await delete_profile_photo(user, database)
        self.assertIsNone(user.profile_photo)
        self.assertIsNone(user.profile_photo_mime)
        self.assertEqual(database.commits, 2)

    async def test_non_image_upload_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            await update_profile_photo(_upload(b"plain text", "text/plain"), User(telegram_id=123), _Database())
        self.assertEqual(raised.exception.status_code, 415)


if __name__ == "__main__":
    unittest.main()
