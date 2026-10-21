"""Tests for non-billable Gemini key health checks."""
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("JWT_SECRET", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.gemini_keys import check_gemini_key


class GeminiKeyHealthTests(unittest.TestCase):
    @patch("app.gemini_keys.urlopen")
    def test_healthy_key_is_reported_without_exposing_it(self, mocked_urlopen):
        mocked_urlopen.return_value.__enter__.return_value.status = 200
        result = check_gemini_key("secret-key-1234567890")
        self.assertEqual(result["status"], "healthy")
        self.assertEqual(result["masked"], "••••7890")
        self.assertNotIn("secret-key", str(result))

    @patch("app.gemini_keys.urlopen")
    def test_denied_and_unreachable_keys_have_distinct_states(self, mocked_urlopen):
        mocked_urlopen.side_effect = HTTPError("url", 403, "denied", {}, None)
        self.assertEqual(check_gemini_key("x" * 24)["status"], "denied")
        mocked_urlopen.side_effect = URLError("offline")
        self.assertEqual(check_gemini_key("x" * 24)["status"], "unreachable")
