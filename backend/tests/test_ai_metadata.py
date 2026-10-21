"""Tests for reviewable AI file metadata suggestions."""
import unittest

from app.ai_metadata import parse_metadata_suggestion


class AIMetadataTests(unittest.TestCase):
    def test_suggestion_is_sanitized_and_keeps_original_extension(self):
        result = parse_metadata_suggestion(
            '```json\n{"title":"گزارش جلسه","description":" خلاصه جلسه ","tags":["#جلسه","تبلیغ","جلسه","کار"]}\n```',
            "voice.mp3",
            ["تبلیغ"],
        )
        self.assertEqual(result["title"], "گزارش جلسه.mp3")
        self.assertEqual(result["description"], "خلاصه جلسه")
        self.assertEqual(result["tags"], ["جلسه", "کار"])

    def test_invalid_response_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "ساختار معتبری"):
            parse_metadata_suggestion("پاسخ معمولی", "file.txt", [])
