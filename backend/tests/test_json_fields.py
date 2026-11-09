import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "000000:test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("JWT_SECRET", "json-fields-test-secret")

from app.json_fields import bounded_int, load_json_array, load_json_object
from app.routers.accounts import grant_scope
from app import main


class StoredJsonValidationTests(unittest.TestCase):
    def test_readers_reject_wrong_shapes_and_bound_large_values(self):
        self.assertEqual(load_json_object('[]'), {})
        self.assertEqual(load_json_array('{}'), [])
        self.assertEqual(load_json_array('[1,2,3]', max_items=2), [1, 2])
        self.assertEqual(load_json_object('{"ok":true}', max_bytes=4), {})
        self.assertEqual(bounded_int("bad", 7, minimum=0, maximum=10), 7)
        self.assertEqual(bounded_int(999, minimum=0, maximum=10), 10)

    def test_workspace_scope_rejects_wrong_nested_json_types(self):
        self.assertEqual(grant_scope(SimpleNamespace(scope_json='[]')), {"folder_ids": [], "file_ids": []})
        self.assertEqual(
            grant_scope(SimpleNamespace(scope_json='{"folder_ids":"1","file_ids":["2","bad",3]}')),
            {"folder_ids": [], "file_ids": [2, 3]},
        )


class ReadinessTests(unittest.IsolatedAsyncioTestCase):
    @staticmethod
    def fake_engine(execute_side_effect=None):
        connection = AsyncMock()
        connection.execute.side_effect = execute_side_effect
        context = AsyncMock()
        context.__aenter__.return_value = connection
        context.__aexit__.return_value = False
        engine = SimpleNamespace(connect=Mock(return_value=context))
        return engine, connection

    async def test_readiness_reports_database_success_without_cache(self):
        engine, connection = self.fake_engine()
        with patch.object(main, "engine", engine):
            response = await main.readiness()

        payload = json.loads(response.body)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["status"], "ready")
        self.assertEqual(response.headers["cache-control"], "no-store")
        connection.execute.assert_awaited_once()

    async def test_readiness_returns_503_without_exposing_database_error(self):
        engine, _ = self.fake_engine(RuntimeError("secret database address"))
        with patch.object(main, "engine", engine):
            response = await main.readiness()

        payload = json.loads(response.body)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(payload, {"status": "not_ready", "database": "unavailable"})
        self.assertNotIn("secret", response.body.decode())


if __name__ == "__main__":
    unittest.main()
