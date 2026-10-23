import os
import time
import unittest

os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./security-test.sqlite")
os.environ.setdefault("JWT_SECRET", "test-secret")

from app.account_security import decrypt_secret, encrypt_secret, new_totp_secret, secret_from_setup_token, setup_token, totp_code, verify_totp


class AccountSecurityTests(unittest.TestCase):
    def test_totp_secret_is_encrypted_and_current_code_is_verified(self):
        secret = new_totp_secret()
        encrypted = encrypt_secret(secret)
        self.assertNotIn(secret, encrypted)
        self.assertEqual(decrypt_secret(encrypted), secret)
        code = totp_code(secret, int(time.time()))
        self.assertTrue(verify_totp(secret, code))
        self.assertFalse(verify_totp(secret, "000000") if code != "000000" else verify_totp(secret, "111111"))

    def test_setup_token_carries_secret_without_exposing_it(self):
        secret = new_totp_secret()
        token = setup_token(secret)
        self.assertNotIn(secret, token)
        self.assertEqual(secret_from_setup_token(token), secret)


if __name__ == "__main__":
    unittest.main()
