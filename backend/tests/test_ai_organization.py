"""Tests for constrained AI drawer suggestions."""
import unittest

from app.ai_organization import parse_folder_suggestions


class AIOrganizationTests(unittest.TestCase):
    def test_unknown_and_duplicate_folder_ids_are_removed(self):
        allowed = {4: {"name": "کار", "path": "اسناد / کار"}, 8: {"name": "شخصی", "path": "شخصی"}}
        result = parse_folder_suggestions(
            '{"suggestions":[{"folder_id":4,"reason":"مرتبط با پروژه","confidence":92},{"folder_id":999,"reason":"ساختگی","confidence":100},{"folder_id":"4","reason":"تکراری","confidence":70}]}',
            allowed,
        )
        self.assertEqual(result, [{"folder_id": 4, "name": "کار", "path": "اسناد / کار", "reason": "مرتبط با پروژه", "confidence": 92}])

    def test_confidence_is_bounded(self):
        result = parse_folder_suggestions('{"suggestions":[{"folder_id":8,"reason":"آرشیو شخصی","confidence":130}]}', {8: {"name": "شخصی", "path": "شخصی"}})
        self.assertEqual(result[0]["confidence"], 100)
