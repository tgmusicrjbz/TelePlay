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
from app.downloader import LinkImportService, _PinterestMetaParser, _pinterest_image_url, _pinterest_video_url, _validate_pinterest_pin_url, classify_import_url
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

    def test_supported_link_classifier_includes_public_pinterest_urls(self):
        self.assertEqual(classify_import_url("https://www.pinterest.com/pin/123456/"), "pinterest")
        self.assertEqual(classify_import_url("https://pin.it/abc123"), "pinterest")
        self.assertIsNone(classify_import_url("https://notpinterest.com/pin/123"))
        self.assertIsNone(classify_import_url("file:///tmp/pin"))

    def test_pinterest_validator_rejects_boards_and_redirects_off_site(self):
        valid = "https://www.pinterest.com/pin/123456789/"
        self.assertEqual(_validate_pinterest_pin_url(valid), valid)
        with self.assertRaisesRegex(ValueError, "برد یا مجموعه"):
            _validate_pinterest_pin_url("https://www.pinterest.com/example/my-board/")
        with self.assertRaisesRegex(ValueError, "معتبر"):
            _validate_pinterest_pin_url("https://example.com/pin/123456789/")

    def test_pinterest_metadata_parser_reads_open_graph_media(self):
        parser = _PinterestMetaParser()
        parser.feed('<meta property="og:title" content="نمونه"><meta property="og:image" content="https://i.pinimg.com/a.jpg">')
        self.assertEqual(parser.values["og:title"], "نمونه")
        self.assertEqual(parser.values["og:image"], "https://i.pinimg.com/a.jpg")

    def test_pinterest_metadata_parser_reads_video_object_from_share_page(self):
        parser = _PinterestMetaParser()
        parser.feed('''<script data-test-id="video-snippet" type="application/ld+json">{
            "@type":"VideoObject", "name":"Origami: Fox",
            "contentUrl":"https://v1.pinimg.com/videos/example_720w.mp4",
            "creator":{"@type":"Person","name":"AV. Origami"}
        }</script>''')
        self.assertEqual(parser.values["pinterest:video"], "https://v1.pinimg.com/videos/example_720w.mp4")
        self.assertEqual(parser.values["pinterest:title"], "Origami: Fox")
        self.assertEqual(parser.values["pinterest:author"], "AV. Origami")

    def test_pinterest_metadata_parser_rejects_non_pinterest_video_object(self):
        parser = _PinterestMetaParser()
        parser.feed('''<script type="application/ld+json">{
            "@type":"VideoObject", "contentUrl":"https://example.com/untrusted.mp4"
        }</script>''')
        self.assertNotIn("pinterest:video", parser.values)

    def test_pinterest_resource_prefers_mp4_over_cover_image(self):
        pin = {
            "images": {"orig": {"url": "https://i.pinimg.com/originals/cover.jpg", "width": 800, "height": 1200}},
            "videos": {"video_list": {
                "V_HLS": {"url": "https://v1.pinimg.com/video.m3u8", "width": 1920, "height": 1080},
                "V_720P": {"url": "https://v1.pinimg.com/video.mp4", "width": 1280, "height": 720},
            }},
        }
        self.assertEqual(_pinterest_video_url(pin), "https://v1.pinimg.com/video.mp4")
        self.assertEqual(_pinterest_image_url(pin), "https://i.pinimg.com/originals/cover.jpg")

    def test_pinterest_video_search_supports_nested_idea_pin_blocks(self):
        pin = {"story_pin_data": {"pages": [{"layout": {"blocks": [{"media": {
            "video_list": {
                "small": {"url": "https://v1.pinimg.com/small.mp4", "width": 360, "height": 640},
                "large": {"url": "https://v1.pinimg.com/large.mp4", "width": 1080, "height": 1920},
            }
        }}]}}]}}
        self.assertEqual(_pinterest_video_url(pin), "https://v1.pinimg.com/large.mp4")


if __name__ == "__main__":
    unittest.main()
