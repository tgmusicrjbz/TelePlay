"""Tests for safe AI file-insight parsing."""
import unittest

from app.ai_insights import parse_file_insights


class AIInsightsTests(unittest.TestCase):
    def test_insights_are_bounded_and_deduplicated(self):
        result = parse_file_insights(
            '```json\n{"summary":"خلاصه جلسه","key_points":["تصمیم اول","تصمیم اول","تصمیم دوم"],"topics":["جلسه","#جلسه","بودجه"]}\n```'
        )
        self.assertEqual(result["summary"], "خلاصه جلسه")
        self.assertEqual(result["key_points"], ["تصمیم اول", "تصمیم دوم"])
        self.assertEqual(result["topics"], ["جلسه", "بودجه"])

    def test_empty_summary_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "خلاصه‌ای"):
            parse_file_insights('{"summary":"","key_points":[],"topics":[]}')
