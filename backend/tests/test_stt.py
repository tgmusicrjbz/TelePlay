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

from app.database import Base, async_session, engine
from app.models import ProcessingJob, User
from app.processing_jobs import create_job
from app.stt import GeminiSTTProvider, STTJob, STTQueue
from app.tts import GeminiRequestError


class STTQueueTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)

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

    async def test_all_rate_limited_keys_report_the_real_reason(self):
        provider = GeminiSTTProvider(["first", "second"])

        def fake_request(_key, _path, _mime_type, _prompt):
            raise GeminiRequestError(429, "limited")

        provider._request = fake_request
        with self.assertRaisesRegex(RuntimeError, "سهمیه یا محدودیت درخواست"):
            await provider.transcribe(Path(__file__), "audio/mpeg", "")

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

    async def test_pending_job_is_recovered_after_queue_restart(self):
        async with async_session() as db:
            user = User(telegram_id=778899)
            db.add(user)
            await db.commit()
            await db.refresh(user)
            user_id = user.id
        status = {
            "id": "recover-stt", "user_id": user_id, "source_file_id": 42,
            "title": "نمونه", "state": "transcribing", "message": "در حال تبدیل",
            "progress": 45, "created_at": "2026-10-15T10:00:00",
        }
        await create_job(
            job_id="recover-stt", user_id=user_id, kind="stt", title="نمونه",
            payload={"id": "recover-stt", "user_id": user_id, "source_file_id": 42,
                     "title": "نمونه", "folder_id": None, "prompt": "", "output_mode": "save"},
            status=status,
        )
        queue = STTQueue(GeminiSTTProvider([]))
        await queue._recover()
        recovered = queue.status("recover-stt", user_id)
        self.assertEqual(recovered["state"], "queued")
        self.assertEqual(queue.queue.qsize(), 1)
        queued_job = await queue.queue.get()
        self.assertEqual((queued_job.id, queued_job.source_file_id), ("recover-stt", 42))
        queue.queue.task_done()
        async with async_session() as db:
            persisted = await db.get(ProcessingJob, "recover-stt")
            self.assertEqual(persisted.state, "queued")


if __name__ == "__main__":
    unittest.main()
