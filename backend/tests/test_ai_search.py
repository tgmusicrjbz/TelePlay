"""Tests for constrained AI query expansion."""
import unittest

from app.ai_search import parse_search_expansion, parse_search_terms


class AISearchTests(unittest.TestCase):
    def test_expansion_uses_existing_or_query_syntax(self):
        result = parse_search_expansion(
            '```json\n{"terms":["جلسه کاری","meeting","#مهم","جلسه کاری"]}\n```',
            "گفت‌وگوی شرکت",
        )
        self.assertEqual(result["terms"], ["جلسه کاری", "meeting", "مهم"])
        self.assertEqual(result["query"], "گفت‌وگوی شرکت؛جلسه کاری؛meeting؛مهم")

    def test_invalid_response_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "پاسخ معتبری"):
            parse_search_expansion("not json", "جلسه")

    def test_related_terms_are_deduplicated_and_sanitized(self):
        terms = parse_search_terms('{"terms":[" پروژه آلفا ","پروژه آلفا","ویدیو؛جلسه",""]}')
        self.assertEqual(terms, ["پروژه آلفا", "ویدیو جلسه"])
