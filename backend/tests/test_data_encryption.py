import base64
import asyncio
import hashlib
import json
import os
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from cryptography.fernet import Fernet

os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./encryption-test.sqlite")
os.environ.setdefault("JWT_SECRET", "test-secret")

from app.account_security import decrypt_secret, encrypt_secret
from app.config import get_settings
from app.encrypted_data import needs_rotation, rotate_value
from app.gemini_keys import decrypt_user_keys, encrypt_user_keys
from app.google_drive import decrypt_credentials, encrypt_credentials
from app.secret_rotation import rotate_persisted_user_secrets


def legacy_token(root: str, context: str, value: str) -> str:
    digest = hashlib.sha256(f"{root}:{context}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest)).encrypt(value.encode()).decode()


class DataEncryptionTests(TestCase):
    def test_rejects_short_dedicated_key(self):
        from app.config import Settings

        with self.assertRaisesRegex(ValueError, "at least 32"):
            Settings.validate_data_encryption_key("too-short")

    def test_persistent_secrets_survive_jwt_rotation(self):
        settings = get_settings()
        with patch.object(settings, "data_encryption_key", "stable-data-key-0123456789-abcdef"), patch.object(settings, "data_encryption_previous_keys", ""), patch.object(settings, "jwt_secret", "jwt-one"):
            totp = encrypt_secret("TOTP-SECRET")
            gemini = encrypt_user_keys(["gemini-secret"])
            drive = encrypt_credentials({"refresh_token": "drive-secret"})
            self.assertTrue(totp.startswith("komod:v2:"))
            with patch.object(settings, "jwt_secret", "jwt-two"):
                self.assertEqual(decrypt_secret(totp), "TOTP-SECRET")
                self.assertEqual(decrypt_user_keys(gemini), ["gemini-secret"])
                self.assertEqual(decrypt_credentials(drive), {"refresh_token": "drive-secret"})

    def test_legacy_jwt_values_rotate_to_active_data_key(self):
        settings = get_settings()
        legacy_root = "legacy-jwt-key"
        legacy_totp = legacy_token(legacy_root, "komod-2fa", "OLD-TOTP")
        legacy_gemini = legacy_token(legacy_root, "gemini-user-keys:v1", json.dumps(["old-gemini"]))
        legacy_drive = legacy_token(legacy_root, "google-drive:v1", json.dumps({"refresh_token": "old-drive"}))
        with patch.object(settings, "data_encryption_key", "new-data-key-0123456789-abcdefgh"), patch.object(settings, "data_encryption_previous_keys", ""), patch.object(settings, "jwt_secret", legacy_root):
            self.assertEqual(decrypt_secret(legacy_totp), "OLD-TOTP")
            self.assertEqual(decrypt_user_keys(legacy_gemini), ["old-gemini"])
            self.assertEqual(decrypt_credentials(legacy_drive), {"refresh_token": "old-drive"})
            rotated = rotate_value(legacy_totp, context="komod-2fa")
            self.assertIsNotNone(rotated)
            self.assertTrue(rotated.startswith("komod:v2:"))
            self.assertFalse(needs_rotation(rotated))
            self.assertEqual(decrypt_secret(rotated), "OLD-TOTP")

    def test_previous_data_key_keeps_rotated_values_readable(self):
        settings = get_settings()
        with patch.object(settings, "data_encryption_key", "old-data-key-0123456789-abcdefgh"), patch.object(settings, "data_encryption_previous_keys", ""), patch.object(settings, "jwt_secret", "jwt"):
            encrypted = encrypt_secret("ROTATE-ME")
        with patch.object(settings, "data_encryption_key", "new-data-key-0123456789-abcdefgh"), patch.object(settings, "data_encryption_previous_keys", "old-data-key-0123456789-abcdefgh"), patch.object(settings, "jwt_secret", "new-jwt"):
            self.assertEqual(decrypt_secret(encrypted), "ROTATE-ME")
            self.assertTrue(needs_rotation(encrypted))

    def test_startup_rotation_updates_all_persistent_user_secrets(self):
        settings = get_settings()
        legacy_root = "legacy-jwt-key"
        user = SimpleNamespace(
            id=42,
            totp_secret_encrypted=legacy_token(legacy_root, "komod-2fa", "TOTP"),
            gemini_api_keys_encrypted=legacy_token(legacy_root, "gemini-user-keys:v1", json.dumps(["GEMINI"])),
            google_drive_credentials_encrypted=legacy_token(legacy_root, "google-drive:v1", json.dumps({"refresh_token": "DRIVE"})),
        )

        class Result:
            def scalars(self): return self
            def all(self): return [user]

        class Session:
            committed = False
            async def execute(self, _query): return Result()
            async def commit(self): self.committed = True

        class Context:
            def __init__(self, session): self.session = session
            async def __aenter__(self): return self.session
            async def __aexit__(self, *_args): return False

        session = Session()
        with patch.object(settings, "data_encryption_key", "new-data-key-0123456789-abcdefgh"), patch.object(settings, "data_encryption_previous_keys", ""), patch.object(settings, "jwt_secret", legacy_root), patch("app.secret_rotation.async_session", return_value=Context(session)):
            self.assertEqual(asyncio.run(rotate_persisted_user_secrets()), (3, 0))
            self.assertTrue(session.committed)
            self.assertEqual(decrypt_secret(user.totp_secret_encrypted), "TOTP")
            self.assertEqual(decrypt_user_keys(user.gemini_api_keys_encrypted), ["GEMINI"])
            self.assertEqual(decrypt_credentials(user.google_drive_credentials_encrypted), {"refresh_token": "DRIVE"})
