"""Durability tests for the background link importer."""
import os
import sys
import tempfile
import unittest
from pathlib import Path

_temp = tempfile.TemporaryDirectory()
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{(Path(_temp.name) / 'downloader.sqlite').as_posix()}")
os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("JWT_SECRET", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import Base, async_session, engine
from app.downloader import LinkImportService
from app.models import ProcessingJob, User
from app.processing_jobs import create_job


class LinkImportDurabilityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)

    async def test_active_link_job_is_requeued_after_restart(self):
        async with async_session() as db:
            user = User(telegram_id=112233)
            db.add(user)
            await db.commit()
            await db.refresh(user)
            user_id = user.id

        status = {
            "id": "recover-link", "user_id": user_id,
            "url": "https://youtu.be/example", "quality": "480",
            "folder_id": None, "state": "downloading", "message": "در حال دریافت",
            "saved": 0, "progress": 35, "retry_count": 1,
            "created_at": "2026-10-15T10:00:00",
        }
        await create_job(
            job_id="recover-link", user_id=user_id, kind="link", title=status["url"],
            payload={"id": "recover-link", "url": status["url"], "user_id": user_id,
                     "telegram_id": 112233, "folder_id": None, "quality": "480",
                     "notify": True, "notification_chat_id": -100445566,
                     "visible_to_user": False, "default_folder": False},
            status=status,
        )

        service = LinkImportService()
        await service._recover()
        recovered = service.status("recover-link", user_id)
        self.assertEqual(recovered["state"], "queued")
        self.assertEqual(recovered["progress"], 0)
        self.assertEqual(service.queue.qsize(), 1)
        job = await service.queue.get()
        self.assertEqual((job.id, job.retry_count), ("recover-link", 1))
        self.assertEqual(job.notification_chat_id, -100445566)
        self.assertFalse(job.visible_to_user)
        self.assertEqual(service.list_statuses(user_id), [])
        service.queue.task_done()
        async with async_session() as db:
            persisted = await db.get(ProcessingJob, "recover-link")
            self.assertEqual(persisted.state, "queued")

    async def test_cancel_all_only_cancels_jobs_owned_by_user(self):
        service = LinkImportService()
        service.statuses = {
            "mine": {"id": "mine", "user_id": 1, "state": "queued"},
            "other": {"id": "other", "user_id": 2, "state": "queued"},
            "done": {"id": "done", "user_id": 1, "state": "done"},
        }
        service.controls = {"mine": {"paused": False, "cancelled": False}, "other": {"paused": False, "cancelled": False}}
        self.assertEqual(service.cancel_all(1), 1)
        self.assertEqual(service.statuses["mine"]["state"], "cancelled")
        self.assertEqual(service.statuses["other"]["state"], "queued")


if __name__ == "__main__":
    unittest.main()
