"""Focused tests for speech-to-text queue ownership and key rotation."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

_temp = tempfile.TemporaryDirectory()
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{(Path(_temp.name) / 'stt.sqlite').as_posix()}")
os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("JWT_SECRET", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.stt import GeminiSTTProvider, STTJob, STTQueue
from app.tts import GeminiRequestError


class STTQueueTests(unittest.IsolatedAsyncioTestCase):
    async def test_provider_rotates_after_rate_limit(self):
        provider = GeminiSTTProvider(["first", "second"])
        calls = []

        def fake_request(key, _path, _mime_type, _prompt):
            calls.append(key)
            if key == "first":
                raise GeminiRequestError(429, "limited")
            return "# متن\n\nخروجی دقیق"

        provider._request = fake_request
        result = await provider.transcribe(Path(__file__), "audio/mpeg", "")
        self.assertEqual(result, "# متن\n\nخروجی دقیق")
        self.assertEqual(calls, ["first", "second"])

    async def test_statuses_are_private_and_finished_jobs_can_be_dismissed(self):
        provider = GeminiSTTProvider([])
        queue = STTQueue(provider)
        queue.statuses["job"] = {
            "id": "job", "user_id": 7, "state": "done", "title": "رونویسی",
            "source_file_id": 2, "created_at": "2026-01-01T00:00:00",
        }
        self.assertIsNotNone(queue.status("job", 7))
        self.assertIsNone(queue.status("job", 8))
        self.assertFalse(queue.dismiss("job", 8))
        self.assertTrue(queue.dismiss("job", 7))

    async def test_cancelled_queued_job_never_runs(self):
        class Provider:
            api_keys = ["test"]

        queue = STTQueue(Provider())
        job = STTJob(user_id=3, source_file_id=4, title="نمونه", folder_id=None, id="cancel-me")
        queue.statuses[job.id] = {
            "id": job.id, "user_id": 3, "source_file_id": 4, "title": job.title,
            "state": "queued", "message": "منتظر نوبت", "progress": 0,
            "created_at": "2026-01-01T00:00:00",
        }
        queue.controls[job.id] = False
        result = queue.cancel(job.id, 3)
        self.assertEqual(result["state"], "cancelled")
        self.assertTrue(queue.controls[job.id])


if __name__ == "__main__":
    unittest.main()
