"""Focused database tests for folder deletion and text preview."""
import os
import io
import sys
import asyncio
import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

_temp = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{(Path(_temp.name) / 'library.sqlite').as_posix()}"
os.environ["TELEGRAM_API_ID"] = "12345"
os.environ["TELEGRAM_API_HASH"] = "test-hash"
os.environ["TELEGRAM_BOT_TOKEN"] = "test-token"
os.environ["TELEGRAM_STORAGE_CHANNEL_ID"] = "-1001234567890"
os.environ["JWT_SECRET"] = "test-secret"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi import HTTPException
from starlette.datastructures import Headers, UploadFile
from starlette.requests import Request
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import Base, async_session, engine
from app.models import AuthSession, BotUserState, ErrorLog, File, Folder, Pack, PackItem, Playlist, PlaylistItem, ProcessingJob, SecurityEvent, TTSUsage, User, WatchProgress
from app.routers.auth import _session_for_device, password_login, update_credentials
from app.routers.accounts import admin_error_logs, admin_health, delete_tag_definition, export_account_data, get_saved_filters, get_tag_settings, import_account_data, resolve_admin_error, update_saved_filters, update_tag_settings
from app.stt import consume_stt_quota
from app.routers.files import (
    batch_update_files,
    delete_file,
    get_activity,
    get_offline_manifest,
    get_player_state,
    playback_history,
    playback_recommendations,
    save_player_state,
    save_offline_manifest,
    share_file,
    get_storage_stats,
    get_text_preview,
    list_files,
    send_files_to_telegram,
    update_file,
    upload_file,
    SendToTelegramRequest,
    OfflineManifestUpdate,
)
from app.routers.folders import delete_folder_contents, list_folders, update_folder
from app.routers.streaming import public_share_info, stored_message_response, unlock_public_share
from app.routers.playlists import add_playlist_items, create_playlist, reorder_playlist, shuffle_playlist
from app.routers.packs import create_pack, get_pack, reorder_pack
from app.schemas import BatchFileUpdate, CredentialsUpdate, FileUpdate, FolderUpdate, PackCreate, PackReorder, PasswordLoginRequest, PlayerStateUpdate, PlaylistAddItems, PlaylistCreate, PlaylistReorder, PublicShareCreate, PublicShareUnlock, SavedFilter, SavedFiltersUpdate, TagDefinition, TagSettingsUpdate
from app.telegram import configure_main_client, start_one_client
from app import telegram


class LibraryOperationsTests(unittest.IsolatedAsyncioTestCase):
    async def test_mixed_pack_is_created_inside_folder_and_reordered(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            image = self.make_file(user.id, self.folder_id, 901)
            image.file_type = "image"; image.mime_type = "image/jpeg"; image.file_name = "cover.jpg"
            text_file = self.make_file(user.id, self.folder_id, 902)
            text_file.file_type = "text"; text_file.mime_type = "text/markdown"; text_file.file_name = "note.md"
            db.add_all([image, text_file]); await db.commit(); await db.refresh(image); await db.refresh(text_file)
            created = await create_pack(PackCreate(name="موضوع سفر", parent_folder_id=self.folder_id, hide_member_files=True, file_ids=[image.id, text_file.id]), db, user)
            self.assertEqual(created.parent_folder_id, self.folder_id)
            self.assertTrue(created.hide_member_files)
            self.assertEqual(created.item_count, 2)
            self.assertEqual(created.type_counts, {"image": 1, "text": 1})
            reordered = await reorder_pack(created.id, PackReorder(item_ids=[created.items[1].id, created.items[0].id]), db, user)
            self.assertEqual([item.file.id for item in reordered.items], [text_file.id, image.id])
            fetched = await get_pack(created.id, db, user)
            self.assertEqual([item.file.id for item in fetched.items], [text_file.id, image.id])
            folder_listing = await list_files(folder_id=self.folder_id, file_type=None, search=None, page=1, per_page=20, db=db, current_user=user)
            self.assertTrue({image.id, text_file.id}.isdisjoint({item.id for item in folder_listing.files}))

    async def test_caption_directives_are_parsed_and_removed_from_description(self):
        from app.caption_metadata import parse_file_caption

        metadata = parse_file_caption(
            "[کشو: موسیقی/اجرای زنده]\n"
            "[نام: شب تهران]\n"
            "[تگ‌ها: فارسی، زنده]\n"
            "[توضیح: اجرای کامل کنسرت]\n"
            "#محبوب"
        )

        self.assertEqual(metadata["folder"], "موسیقی/اجرای زنده")
        self.assertEqual(metadata["title"], "شب تهران")
        self.assertEqual(metadata["description"], "اجرای کامل کنسرت")
        self.assertEqual(metadata["tags"], ["فارسی", "زنده", "محبوب"])
        self.assertNotIn("[کشو:", str(metadata["description"]))

    async def test_caption_tag_exclusions_only_block_automatic_tags(self):
        from app.caption_metadata import parse_file_caption

        metadata = parse_file_caption(
            "[تگ‌ها: تبلیغ، دستی]\nاین توضیح #تبلیغ و #موسیقی دارد",
            excluded_tags=["تبلیغ", "موسیقی"],
        )

        self.assertEqual(metadata["tags"], ["تبلیغ", "دستی"])

    async def asyncSetUp(self):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)
        async with async_session() as db:
            user = User(telegram_id=111)
            db.add(user)
            await db.flush()
            parent = Folder(user_id=user.id, name="Parent")
            db.add(parent)
            await db.flush()
            folder = Folder(user_id=user.id, name="Target", parent_id=parent.id)
            db.add(folder)
            await db.flush()
            child = Folder(user_id=user.id, name="Child", parent_id=folder.id)
            db.add(child)
            await db.flush()
            direct = self.make_file(user.id, folder.id, 101)
            nested = self.make_file(user.id, child.id, 102)
            db.add_all([direct, nested])
            await db.flush()
            db.add(WatchProgress(user_id=user.id, file_id=nested.id, position=20))
            await db.commit()
            self.user_id, self.parent_id, self.folder_id, self.child_id = user.id, parent.id, folder.id, child.id
            self.direct_file_id = direct.id
            self.nested_file_id = nested.id

    @staticmethod
    def auth_request() -> Request:
        return Request({
            "type": "http", "method": "POST", "path": "/api/auth/password/login",
            "headers": [(b"user-agent", b"Komod Test"), (b"x-komod-device-id", b"test-device")],
            "client": ("127.0.0.1", 1234),
        })

    async def test_admin_health_reports_connected_bot_and_stuck_jobs(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            db.add(ProcessingJob(
                id="stuck-health-job", user_id=user.id, kind="stt", state="transcribing",
                title="نمونهٔ گیرکرده", progress=42, message="internal detail",
                payload_json='{"secret":"must-not-leak"}',
                updated_at=datetime.utcnow() - timedelta(minutes=20),
            ))
            await db.commit()
            with patch.object(telegram, "clients", [SimpleNamespace(is_connected=True)]):
                result = await admin_health(user, db)
        services = {item.key: item for item in result.services}
        self.assertEqual(result.overall, "warning")
        self.assertEqual(services["database"].status, "healthy")
        self.assertEqual(services["telegram"].active, 1)
        self.assertEqual([job.id for job in result.stuck_jobs], ["stuck-health-job"])
        self.assertFalse(hasattr(result.stuck_jobs[0], "payload_json"))

    async def test_admin_can_review_and_resolve_tracked_errors(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            db.add(ErrorLog(error_id="abc123def456", method="GET", path="/api/test", message="boom", traceback="private trace"))
            await db.commit()
            rows = await admin_error_logs(user, db)
            self.assertEqual(rows[0]["error_id"], "abc123def456")
            self.assertNotIn("traceback", rows[0])
            result = await resolve_admin_error("abc123def456", user, db)
            self.assertTrue(result["resolved"])

    async def test_password_credentials_can_be_enabled_and_used(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            response = await update_credentials(
                self.auth_request(),
                CredentialsUpdate(username="mahdi.komod", new_password="safe-password-1405"),
                user, db,
            )
            self.assertEqual(response.user.login_username, "mahdi.komod")
            login = await password_login(
                self.auth_request(),
                PasswordLoginRequest(username="MAHDI.KOMOD", password="safe-password-1405"),
                db,
            )
            self.assertEqual(login.user.telegram_id, 111)
            sessions = (await db.execute(select(AuthSession).where(
                AuthSession.user_id == self.user_id, AuthSession.revoked_at.is_(None)
            ))).scalars().all()
            self.assertEqual(len(sessions), 1)
            login_events = (await db.execute(select(SecurityEvent).where(
                SecurityEvent.user_id == self.user_id, SecurityEvent.event_type == "login_success"
            ))).scalars().all()
            self.assertEqual(len(login_events), 1)

    async def test_tag_settings_counts_and_hash_search(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            direct = await db.get(File, self.direct_file_id)
            nested = await db.get(File, self.nested_file_id)
            direct.tags_json = json.dumps(["پروژه", "تگ مستقیم"], ensure_ascii=False)
            nested.description = "پروژه‌ای که فقط در توضیحات آمده"
            await db.commit()
            settings = await update_tag_settings(TagSettingsUpdate(
                tags=[TagDefinition(name="پروژه", color="#14b8a6", category="کار")],
                excluded_tags=["تبلیغ"], show_file_tags=True, display_limit=3,
            ), user, db)
            self.assertEqual(settings.tags[0].file_count, 1)
            self.assertEqual(settings.tags[0].category, "کار")
            self.assertEqual(settings.excluded_tags, ["تبلیغ"])
            result = await list_files(None, None, "#پروژه", 1, 20, db, user)
            self.assertEqual(result.total, 1)
            self.assertEqual(result.files[0].id, direct.id)
            refreshed = await get_tag_settings(user, db)
            self.assertTrue(refreshed.show_file_tags)
            discovered = next(item for item in refreshed.tags if item.name == "تگ مستقیم")
            self.assertEqual(discovered.file_count, 1)
            self.assertRegex(discovered.color, r"^#[0-9a-f]{6}$")

    async def test_deleting_tag_removes_it_from_definitions_and_files(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            direct = await db.get(File, self.direct_file_id)
            direct.tags_json = json.dumps(["پروژه", "نگه‌دار"], ensure_ascii=False)
            await update_tag_settings(TagSettingsUpdate(
                tags=[TagDefinition(name="پروژه", color="#14b8a6"), TagDefinition(name="نگه‌دار", color="#2563eb")],
                show_file_tags=True, display_limit=3,
            ), user, db)
            result = await delete_tag_definition("#پروژه", user, db)
            await db.refresh(direct)
            self.assertNotIn("پروژه", [tag.name for tag in result.tags])
            self.assertEqual(json.loads(direct.tags_json), ["نگه‌دار"])

    async def test_stt_duration_limit_rejects_long_input(self):
        async with async_session() as db:
            db.add(TTSUsage(user_id=self.user_id, stt_max_seconds=60))
            await db.commit()
            with self.assertRaisesRegex(ValueError, "مدت فایل"):
                await consume_stt_quota(db, self.user_id, 61)

    async def test_search_supports_comma_and_semicolon_expressions(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            direct = await db.get(File, self.direct_file_id)
            nested = await db.get(File, self.nested_file_id)
            direct.description = "آموزش پایتون"
            direct.tags_json = json.dumps(["مهم", "پروژه"], ensure_ascii=False)
            nested.description = "موسیقی آرام"
            nested.tags_json = json.dumps(["تفریح"], ensure_ascii=False)
            await db.commit()

            and_result = await list_files(None, None, "آموزش،پروژه", 1, 20, db, user)
            self.assertEqual(and_result.total, 1)
            self.assertEqual(and_result.files[0].id, direct.id)

            or_result = await list_files(None, None, "آموزش؛موسیقی", 1, 20, db, user)
            self.assertEqual(or_result.total, 2)

            tag_without_hash = await list_files(None, None, "مهم", 1, 20, db, user)
            self.assertEqual(tag_without_hash.total, 1)

    async def test_search_finds_full_note_content_without_exposing_it(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            note = self.make_file(user.id, self.folder_id, 777)
            note.file_type = "text"
            note.file_name = "یادداشت معمولی"
            db.add(note)
            await db.commit()

            legacy_message = SimpleNamespace(
                text="جلسه درباره معماری سامانه و برنامه انتشار نسخه بعدی",
                document=None,
            )
            with patch("app.routers.files.get_message_from_channel", new_callable=AsyncMock, return_value=legacy_message) as load_note:
                result = await list_files(None, None, "معماری سامانه", 1, 20, db, user)
                load_note.assert_awaited_once_with(note.channel_message_id, note.storage_channel_id)
            self.assertEqual(result.total, 1)
            self.assertEqual(result.files[0].id, note.id)
            self.assertFalse(hasattr(result.files[0], "search_text"))
            await db.refresh(note)
            self.assertIn("معماری سامانه", note.search_text)

            with patch("app.routers.files.get_message_from_channel", new_callable=AsyncMock) as load_note_again:
                tag_only = await list_files(None, None, "#معماری", 1, 20, db, user)
                load_note_again.assert_not_awaited()
            self.assertEqual(tag_only.total, 0)

    async def test_search_tolerates_typo_and_returns_suggestions(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            file = self.make_file(user.id, self.folder_id, 778)
            file.file_name = "گزارش معماری پروژه.md"
            file.search_text = "تصمیم‌های راهبردی جلسه تیم محصول"
            db.add(file)
            await db.commit()

            title_typo = await list_files(None, None, "مهماری", 1, 20, db, user)
            self.assertEqual(title_typo.search_mode, "fuzzy")
            self.assertEqual(title_typo.files[0].id, file.id)
            self.assertIn("گزارش معماری پروژه", title_typo.suggestions)

            content_typo = await list_files(None, None, "راهبرذی", 1, 20, db, user)
            self.assertEqual(content_typo.search_mode, "fuzzy")
            self.assertEqual(content_typo.files[0].id, file.id)

            unrelated = await list_files(None, None, "هواشناسی", 1, 20, db, user)
            self.assertEqual(unrelated.total, 0)
            self.assertEqual(unrelated.suggestions, [])

    async def test_batch_files_can_be_hidden(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            user.vault_password_hash = "configured"
            await batch_update_files(BatchFileUpdate(ids=[self.direct_file_id], is_hidden=True), db, user)
            self.assertTrue((await db.get(File, self.direct_file_id)).is_hidden)

    async def test_hidden_only_returns_hidden_files_without_visible_page_noise(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            direct = await db.get(File, self.direct_file_id)
            direct.is_hidden = True
            await db.commit()
            with patch("app.routers.files.require_vault_access"):
                result = await list_files(
                    folder_id=None, file_type=None, search=None, page=1, per_page=20,
                    db=db, current_user=user, hidden_only=True,
                )
            self.assertEqual(result.total, 1)
            self.assertEqual(result.files[0].id, direct.id)
            self.assertTrue(result.files[0].is_hidden)

    async def test_selected_files_are_copied_to_signed_in_telegram_chat_in_requested_order(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            request = self.auth_request()
            request.state.signed_in_user = user
            client = SimpleNamespace(copy_message=AsyncMock())
            with patch("app.routers.files.telegram.tg_client", client):
                result = await send_files_to_telegram(
                    SendToTelegramRequest(ids=[self.nested_file_id, self.direct_file_id]),
                    request, db, user,
                )
            self.assertEqual(result, {"sent": 2, "failed": []})
            self.assertEqual(
                [call.args[2] for call in client.copy_message.await_args_list],
                [102, 101],
            )

    async def test_shared_storage_stats_only_count_granted_scope(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            request = self.auth_request()
            request.state.workspace_scope = {"folder_ids": [], "file_ids": [self.direct_file_id]}
            request.state.workspace_allowed_folder_ids = set()
            result = await get_storage_stats(db, user, request)
            self.assertEqual(result["total_size"], 5)

    async def asyncTearDown(self):
        await engine.dispose()

    @staticmethod
    def make_file(user_id: int, folder_id: int | None, message_id: int) -> File:
        return File(
            user_id=user_id, folder_id=folder_id, channel_message_id=message_id,
            file_id=f"test:{message_id}", file_unique_id=f"unique:{message_id}",
            file_name=f"file-{message_id}.txt", file_size=5,
            mime_type="text/plain", file_type="document",
        )

    async def test_keep_contents_moves_direct_files_and_children_up(self):
        async with async_session() as db:
            folder = await db.get(Folder, self.folder_id)
            await delete_folder_contents(db, folder, False)
            await db.commit()
        async with async_session() as db:
            self.assertIsNone(await db.get(Folder, self.folder_id))
            self.assertEqual((await db.get(Folder, self.child_id)).parent_id, self.parent_id)
            direct = (await db.execute(select(File).where(File.channel_message_id == 101))).scalar_one()
            nested = (await db.execute(select(File).where(File.channel_message_id == 102))).scalar_one()
            self.assertEqual(direct.folder_id, self.parent_id)
            self.assertEqual(nested.folder_id, self.child_id)

    async def test_delete_everything_removes_descendants_and_progress(self):
        async with async_session() as db:
            with patch("app.routers.folders.delete_from_storage_channel", new_callable=AsyncMock, return_value=True) as delete_remote:
                await delete_folder_contents(db, await db.get(Folder, self.folder_id), True)
                await db.commit()
                delete_remote.assert_awaited_once_with([101, 102])
        async with async_session() as db:
            self.assertIsNone(await db.get(Folder, self.folder_id))
            self.assertIsNone(await db.get(Folder, self.child_id))
            self.assertEqual((await db.execute(select(File))).scalars().all(), [])
            self.assertEqual((await db.execute(select(WatchProgress))).scalars().all(), [])

    async def test_root_folder_count_includes_nested_files(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            folders = await list_folders(parent_id=None, sort="name:asc", favorite_only=False, db=db, current_user=user)
        parent = next(folder for folder in folders if folder.id == self.parent_id)
        self.assertEqual(parent.file_count, 2)
        self.assertTrue(any(folder.is_default for folder in folders))

    async def test_remote_delete_failure_still_removes_stale_database_records(self):
        async with async_session() as db:
            with patch("app.routers.folders.delete_from_storage_channel", new_callable=AsyncMock, return_value=False):
                await delete_folder_contents(db, await db.get(Folder, self.folder_id), True)
                await db.commit()
        async with async_session() as db:
            self.assertIsNone(await db.get(Folder, self.folder_id))
            self.assertEqual((await db.execute(select(File))).scalars().all(), [])

    async def test_move_folder_into_child_is_rejected(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            with self.assertRaises(HTTPException) as raised:
                await update_folder(self.folder_id, FolderUpdate(parent_id=self.child_id), db, user)
            self.assertEqual(raised.exception.status_code, 400)

    async def test_folder_description_can_be_added_edited_and_removed(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            updated = await update_folder(
                self.folder_id, FolderUpdate(description="  توضیح پوشه  "), db, user
            )
            self.assertEqual(updated.description, "توضیح پوشه")
            cleared = await update_folder(
                self.folder_id, FolderUpdate(description=""), db, user
            )
            self.assertIsNone(cleared.description)

    async def test_file_description_can_be_added_edited_and_removed(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            updated = await update_file(
                self.direct_file_id, FileUpdate(description="  توضیح فایل  "), db, user
            )
            self.assertEqual(updated.description, "توضیح فایل")
            cleared = await update_file(
                self.direct_file_id, FileUpdate(description=""), db, user
            )
            self.assertIsNone(cleared.description)

    async def test_folder_color_and_icon_can_be_customized(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            updated = await update_folder(
                self.folder_id, FolderUpdate(color="#12abef", icon="🎵"), db, user
            )
            self.assertEqual(updated.color, "#12ABEF")
            self.assertEqual(updated.icon, "🎵")
            cleared = await update_folder(
                self.folder_id, FolderUpdate(color="", icon=""), db, user
            )
            self.assertIsNone(cleared.color)
            self.assertIsNone(cleared.icon)

    async def test_activity_feeds_include_recent_and_in_progress_files(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            activity = await get_activity(limit=50, db=db, current_user=user)

            self.assertEqual({item.id for item in activity.recent}, {self.direct_file_id, self.nested_file_id})
            self.assertEqual(len(activity.continue_watching), 1)
            self.assertEqual(activity.continue_watching[0].last_pos, 20)

    async def test_playlist_add_and_manual_reorder(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            first = self.make_file(user.id, None, 301)
            first.file_type, first.file_name, first.duration = "audio", "first.mp3", 120
            second = self.make_file(user.id, None, 302)
            second.file_type, second.file_name, second.duration = "video", "second.mp4", 240
            db.add_all([first, second])
            await db.commit()
            playlist = await create_playlist(PlaylistCreate(name="رانندگی"), db, user)
            result = await add_playlist_items(playlist.id, PlaylistAddItems(file_ids=[first.id, second.id]), db, user)
            self.assertEqual([item.file.id for item in result.items], [first.id, second.id])
            reordered = await reorder_playlist(playlist.id, PlaylistReorder(file_ids=[second.id, first.id]), db, user)
            self.assertEqual([item.file.id for item in reordered.items], [second.id, first.id])
            self.assertEqual(reordered.total_duration, 360)

        from app.telegram import build_clients
        build_clients()
        from app.bot import render_playlist_detail
        panel = SimpleNamespace(edit=AsyncMock())
        await render_playlist_detail(panel, 111, playlist.id)
        markup = panel.edit.await_args.kwargs["reply_markup"]
        labels = [button.text for row in markup.inline_keyboard for button in row]
        self.assertEqual(markup.inline_keyboard[2][0].text, "▶️ پخش همه (از اول)")
        self.assertIn("⚙️ تنظیمات نام و توضیح", labels)
        self.assertIn("🗑️ حذف پلی‌لیست", labels)

    async def test_saved_filters_are_validated_and_persisted(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            payload = SavedFiltersUpdate(filters=[SavedFilter(
                id="music-notes",
                name="  صداهای نشان‌شده  ",
                query="#مهم",
                file_types=["audio", "audio"],
                favorite_only=True,
                sort="name:asc",
            )])
            saved = await update_saved_filters(payload, user, db)
            self.assertEqual(saved[0]["name"], "صداهای نشان‌شده")
            self.assertEqual(saved[0]["file_types"], ["audio"])

        async with async_session() as db:
            user = await db.get(User, self.user_id)
            restored = await get_saved_filters(user)
            self.assertEqual(restored[0]["query"], "#مهم")
            self.assertTrue(restored[0]["favorite_only"])

    async def test_playlist_item_reorder_is_returned_and_persisted(self):
        """The web client reorders playlist-item IDs, including duplicate files."""
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            first = self.make_file(user.id, None, 311)
            first.file_type, first.file_name = "audio", "repeat.mp3"
            second = self.make_file(user.id, None, 312)
            second.file_type, second.file_name = "video", "clip.mp4"
            db.add_all([first, second])
            await db.commit()
            playlist = await create_playlist(PlaylistCreate(name="ترتیب آیتم‌ها"), db, user)
            created = await add_playlist_items(
                playlist.id,
                PlaylistAddItems(file_ids=[first.id, second.id, first.id], allow_duplicates=True),
                db,
                user,
            )
            requested = [created.items[2].id, created.items[0].id, created.items[1].id]
            response = await reorder_playlist(playlist.id, PlaylistReorder(item_ids=requested), db, user)
            self.assertEqual([item.id for item in response.items], requested)

        async with async_session() as db:
            stored = (await db.execute(
                select(PlaylistItem).where(PlaylistItem.playlist_id == playlist.id).order_by(PlaylistItem.position)
            )).scalars().all()
            self.assertEqual([item.id for item in stored], requested)

    async def test_playlist_rejects_non_media_file(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            playlist = await create_playlist(PlaylistCreate(name="فقط رسانه"), db, user)
            with self.assertRaises(HTTPException) as raised:
                await add_playlist_items(playlist.id, PlaylistAddItems(file_ids=[self.direct_file_id]), db, user)
            self.assertEqual(raised.exception.status_code, 400)

    async def test_playlist_shuffle_preserves_all_items(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            media = []
            for message_id in (401, 402, 403):
                file = self.make_file(user.id, None, message_id)
                file.file_type = "audio"
                media.append(file)
            db.add_all(media)
            await db.commit()
            playlist = await create_playlist(PlaylistCreate(name="شافل"), db, user)
            await add_playlist_items(playlist.id, PlaylistAddItems(file_ids=[item.id for item in media]), db, user)
            shuffled = await shuffle_playlist(playlist.id, db, user)
            self.assertEqual({item.file.id for item in shuffled.items}, {item.id for item in media})
            self.assertEqual([item.position for item in shuffled.items], [0, 1, 2])

    async def test_web_upload_sends_media_to_storage_and_creates_file(self):
        media = SimpleNamespace(
            file_id="telegram-file",
            file_unique_id="telegram-unique",
            file_size=4,
            mime_type="video/mp4",
            duration=10,
            width=640,
            height=360,
            thumbs=[],
        )
        sent = SimpleNamespace(id=901, video=media, audio=None, document=None)
        fake_client = SimpleNamespace(
            send_video=AsyncMock(return_value=sent),
            send_audio=AsyncMock(),
            send_document=AsyncMock(),
        )
        upload = UploadFile(
            file=io.BytesIO(b"test"),
            filename="my_video.mp4",
            headers=Headers({"content-type": "video/mp4"}),
        )

        with patch("app.routers.files.telegram.tg_client", fake_client):
            async with async_session() as db:
                user = await db.get(User, self.user_id)
                result = await upload_file(upload, None, "توضیح", db, user)

                self.assertEqual(result.file_name, "my_video.mp4")
                self.assertEqual(result.file_type, "video")
                fake_client.send_video.assert_awaited_once()
                saved = (
                    await db.execute(select(File).where(File.channel_message_id == 901))
                ).scalar_one()
                self.assertEqual(saved.description, "توضیح")
                self.assertEqual(saved.content_hash, "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08")

    async def test_duplicate_web_upload_creates_shortcut_without_sending_again(self):
        async with async_session() as db:
            original = self.make_file(self.user_id, None, 902)
            original.content_hash = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
            db.add(original)
            await db.commit()
            user = await db.get(User, self.user_id)
            upload = UploadFile(
                file=io.BytesIO(b"test"), filename="duplicate.txt",
                headers=Headers({"content-type": "text/plain"}),
            )
            fake_client = SimpleNamespace(
                send_video=AsyncMock(), send_audio=AsyncMock(), send_document=AsyncMock(),
            )
            with patch("app.routers.files.telegram.tg_client", fake_client):
                result = await upload_file(upload, None, None, db, user)
            self.assertTrue(result.is_shortcut)
            self.assertEqual(result.file_name, "duplicate.txt")
            self.assertEqual(result.file_id, original.file_id)
            fake_client.send_document.assert_not_awaited()

    async def test_player_state_round_trip_preserves_queue_order(self):
        async with async_session() as db:
            first = self.make_file(self.user_id, None, 910); first.file_type = "audio"
            second = self.make_file(self.user_id, None, 911); second.file_type = "video"
            db.add_all([first, second]); await db.commit()
            user = await db.get(User, self.user_id)
            saved = await save_player_state(PlayerStateUpdate(
                file_ids=[second.id, first.id], current_index=1, repeat_mode="all", position=42,
            ), db, user)
            self.assertEqual([item.id for item in saved.files], [second.id, first.id])
            restored = await get_player_state(db, user)
            self.assertEqual([item.id for item in restored.files], [second.id, first.id])
            self.assertEqual((restored.current_index, restored.repeat_mode, restored.position), (1, "all", 42))

    async def test_public_share_security_settings_are_persisted_and_unlockable(self):
        async with async_session() as db:
            item = self.make_file(self.user_id, None, 919); item.file_type = "audio"
            db.add(item); await db.commit()
            user = await db.get(User, self.user_id)
            request = Request({"type":"http","method":"POST","path":f"/api/files/{item.id}/share","headers":[(b"user-agent",b"Komod Test")],"client":("127.0.0.1",1234)})
            response = await share_file(item.id, request, PublicShareCreate(
                expires_in_hours=24, password="secret12", allow_download=False, view_limit=3,
            ), db, user)
            self.assertTrue(response.public_hash)
            self.assertTrue(response.public_password_protected)
            self.assertFalse(response.public_allow_download)
            self.assertEqual(response.public_view_limit, 3)
            stored = await db.get(File, item.id)
            self.assertNotEqual(stored.public_password_hash, "secret12")
            info_request = Request({"type":"http","method":"GET","path":f"/api/stream/s/{stored.public_hash}/info","headers":[],"client":("127.0.0.1",1234)})
            info = await public_share_info(stored.public_hash, info_request, db)
            self.assertTrue(info["password_required"])
            self.assertFalse(info["allow_download"])
            unlocked = await unlock_public_share(stored.public_hash, PublicShareUnlock(password="secret12"), info_request, db)
            self.assertTrue(unlocked["access_token"])
            events = (await db.execute(select(SecurityEvent).where(SecurityEvent.user_id == user.id))).scalars().all()
            self.assertIn("public_link_created", {event.event_type for event in events})
            self.assertIn("public_link_unlocked", {event.event_type for event in events})

    async def test_account_export_excludes_secrets_and_keeps_library_metadata(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            user.password_hash = "must-not-leak"
            user.gemini_api_keys_encrypted = "also-secret"
            await db.commit()
            response = await export_account_data(user, db)
            payload = json.loads(response.body.decode("utf-8"))
            self.assertEqual(payload["format"], "komod-account-export")
            self.assertTrue(payload["folders"])
            self.assertTrue(payload["files"])
            serialized = response.body.decode("utf-8")
            self.assertNotIn("must-not-leak", serialized)
            self.assertNotIn("also-secret", serialized)

    async def test_account_backup_restore_merges_file_metadata_and_playlists(self):
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            media = await db.get(File, self.direct_file_id)
            media.file_type = "audio"
            media.file_name = "original.mp3"
            media.tags_json = '["آرشیو"]'
            playlist = Playlist(user_id=user.id, name="نسخه پشتیبان", position=0)
            db.add(playlist); await db.flush()
            db.add(PlaylistItem(playlist_id=playlist.id, file_id=media.id, position=0))
            await db.commit()
            backup = json.loads((await export_account_data(user, db)).body.decode("utf-8"))
            media.file_name = "changed.mp3"
            media.tags_json = "[]"
            await db.delete(playlist)
            await db.commit()
            request = Request({"type":"http","method":"POST","path":"/api/accounts/import","headers":[(b"user-agent",b"Komod Test")],"client":("127.0.0.1",1234)})
            result = await import_account_data(request, backup, user, db)
            await db.refresh(media)
            self.assertEqual(media.file_name, "original.mp3")
            self.assertEqual(json.loads(media.tags_json), ["آرشیو"])
            self.assertEqual(result["playlists_restored"], 1)
            restored = (await db.execute(select(Playlist).where(Playlist.user_id == user.id, Playlist.name == "نسخه پشتیبان").options(selectinload(Playlist.items)))).scalar_one()
            self.assertEqual([item.file_id for item in restored.items], [media.id])

    async def test_offline_manifest_keeps_owned_visible_files_in_selected_order(self):
        async with async_session() as db:
            first = self.make_file(self.user_id, None, 920)
            second = self.make_file(self.user_id, None, 921)
            hidden = self.make_file(self.user_id, None, 922); hidden.is_hidden = True
            db.add_all([first, second, hidden]); await db.commit()
            user = await db.get(User, self.user_id)
            saved = await save_offline_manifest(OfflineManifestUpdate(
                file_ids=[second.id, hidden.id, first.id, second.id],
            ), db, user)
            self.assertEqual(saved.file_ids, [second.id, first.id])
            restored = await get_offline_manifest(db, user)
            self.assertEqual(restored.file_ids, [second.id, first.id])

    async def test_history_and_recommendations_use_progress_folder_and_tags(self):
        async with async_session() as db:
            current = self.make_file(self.user_id, self.folder_id, 912); current.file_type = "audio"; current.tags_json = '["آرام"]'
            related = self.make_file(self.user_id, self.folder_id, 913); related.file_type = "audio"; related.tags_json = '["آرام"]'
            unrelated = self.make_file(self.user_id, None, 914); unrelated.file_type = "video"
            db.add_all([current, related, unrelated]); await db.flush()
            db.add(WatchProgress(user_id=self.user_id, file_id=current.id, position=12, duration=100))
            await db.commit()
            user = await db.get(User, self.user_id)
            history = await playback_history(1, 30, db, user)
            self.assertEqual(history.files[0].id, current.id)
            suggestions = await playback_recommendations(current.id, 10, db, user)
            self.assertEqual(suggestions[0].id, related.id)

    async def test_deleting_shortcut_keeps_shared_storage_message(self):
        async with async_session() as db:
            original = self.make_file(self.user_id, None, 903)
            shortcut = self.make_file(self.user_id, None, 903)
            shortcut.file_unique_id = original.file_unique_id
            shortcut.is_shortcut = True
            db.add_all([original, shortcut])
            await db.commit()
            user = await db.get(User, self.user_id)
            with patch("app.routers.files.delete_from_storage_channel", new_callable=AsyncMock) as remove:
                result = await delete_file(shortcut.id, db, user)
            self.assertFalse(result["storage_deleted"])
            remove.assert_not_awaited()
            self.assertIsNotNone(await db.get(File, original.id))

    async def test_multiple_file_types_can_be_filtered_together(self):
        async with async_session() as db:
            video = self.make_file(self.user_id, None, 120)
            video.file_type = "video"
            db.add(video)
            await db.commit()
            user = await db.get(User, self.user_id)
            result = await list_files(None, "video,text", None, 1, 20, db, user)
            self.assertEqual([item.file_type for item in result.files], ["video"])

    async def test_files_support_multi_level_sorting(self):
        async with async_session() as db:
            first = self.make_file(self.user_id, None, 121)
            first.file_name, first.file_type = "B", "video"
            second = self.make_file(self.user_id, None, 122)
            second.file_name, second.file_type = "A", "audio"
            third = self.make_file(self.user_id, None, 123)
            third.file_name, third.file_type = "A", "video"
            db.add_all([first, second, third])
            await db.commit()
            user = await db.get(User, self.user_id)
            result = await list_files(None, None, None, 1, 20, db, user, "name:asc,type:desc")
            self.assertEqual([item.file_type for item in result.files], ["video", "audio", "video"])

    async def test_batch_edit_preserves_extensions_and_updates_descriptions(self):
        async with async_session() as db:
            first = self.make_file(self.user_id, None, 124)
            first.file_name = "one.mp4"
            first.description = "old"
            second = self.make_file(self.user_id, None, 125)
            second.file_name = "two.mp3"
            db.add_all([first, second])
            await db.commit()
            user = await db.get(User, self.user_id)
            await batch_update_files(BatchFileUpdate(
                ids=[first.id, second.id], description_mode="append", description="new",
                rename_mode="prefix", rename_value="fav-",
            ), db, user)
            refreshed = (await db.execute(select(File).where(File.id.in_([first.id, second.id])).order_by(File.id))).scalars().all()
            self.assertEqual([item.file_name for item in refreshed], ["fav-one.mp4", "fav-two.mp3"])
            self.assertEqual([item.description for item in refreshed], ["old\nnew", "new"])

    async def test_batch_edit_adds_removes_and_replaces_tags(self):
        async with async_session() as db:
            first = self.make_file(self.user_id, None, 126)
            first.tags_json = '["مهم", "قدیمی"]'
            second = self.make_file(self.user_id, None, 127)
            second.tags_json = '["موسیقی"]'
            db.add_all([first, second])
            await db.commit()
            user = await db.get(User, self.user_id)

            await batch_update_files(BatchFileUpdate(
                ids=[first.id, second.id], tags_add=["جدید", "مهم"], tags_remove=["قدیمی"],
            ), db, user)
            refreshed = (await db.execute(select(File).where(
                File.id.in_([first.id, second.id])
            ).order_by(File.id))).scalars().all()
            self.assertEqual(json.loads(refreshed[0].tags_json), ["مهم", "جدید"])
            self.assertEqual(json.loads(refreshed[1].tags_json), ["موسیقی", "جدید", "مهم"])

            await batch_update_files(BatchFileUpdate(
                ids=[first.id, second.id], tags_replace=["یکسان", "یکسان"],
            ), db, user)
            refreshed = (await db.execute(select(File).where(
                File.id.in_([first.id, second.id])
            ).order_by(File.id))).scalars().all()
            self.assertEqual([json.loads(item.tags_json) for item in refreshed], [["یکسان"], ["یکسان"]])

    async def test_folder_management_groups_edit_actions(self):
        from app.telegram import build_clients
        build_clients()
        from app.bot import handle_callback, settings
        callback = SimpleNamespace(
            data=f"folder_actions:{self.folder_id}",
            from_user=SimpleNamespace(id=111),
            message=SimpleNamespace(edit=AsyncMock(), chat=SimpleNamespace(id=111)),
            answer=AsyncMock(),
        )
        with patch.object(settings, "auth_users_str", ""):
            await handle_callback(None, callback)
        markup = callback.message.edit.await_args.kwargs["reply_markup"]
        callback_data = [button.callback_data for row in markup.inline_keyboard for button in row]
        self.assertIn(f"folder_edit:{self.folder_id}", callback_data)
        callback.data = f"folder_edit:{self.folder_id}"
        callback.message.edit.reset_mock()
        with patch.object(settings, "auth_users_str", ""):
            await handle_callback(None, callback)
        edit_markup = callback.message.edit.await_args.kwargs["reply_markup"]
        edit_callbacks = [button.callback_data for row in edit_markup.inline_keyboard for button in row]
        self.assertIn(f"folderdesc:{self.folder_id}", edit_callbacks)

    async def test_bot_ui_state_persists_across_memory_reset(self):
        from app.telegram import build_clients
        build_clients()
        from app.bot import (
            batch_return_targets, batch_selections, current_drawers,
            library_filters, load_user_ui_state, loaded_ui_state_users,
            persist_user_ui_state, search_filters, search_queries, sort_preferences,
        )
        telegram_id = 111
        current_drawers[telegram_id] = self.folder_id
        library_filters[telegram_id] = {"video", "audio"}
        search_filters[telegram_id] = {"folder"}
        search_queries[telegram_id] = "سفر"
        sort_preferences[telegram_id] = [("name", "asc"), ("type", "desc")]
        batch_return_targets[telegram_id] = "files:0"
        batch_selections[telegram_id] = {self.direct_file_id}
        await persist_user_ui_state(telegram_id)

        current_drawers.pop(telegram_id, None)
        library_filters.pop(telegram_id, None)
        search_filters.pop(telegram_id, None)
        search_queries.pop(telegram_id, None)
        sort_preferences.pop(telegram_id, None)
        batch_return_targets.pop(telegram_id, None)
        batch_selections.pop(telegram_id, None)
        loaded_ui_state_users.discard(telegram_id)
        await load_user_ui_state(telegram_id)

        self.assertEqual(current_drawers[telegram_id], self.folder_id)
        self.assertEqual(library_filters[telegram_id], {"video", "audio"})
        self.assertEqual(search_filters[telegram_id], {"folder"})
        self.assertEqual(search_queries[telegram_id], "سفر")
        self.assertEqual(sort_preferences[telegram_id], [("name", "asc"), ("type", "desc")])
        self.assertEqual(batch_selections[telegram_id], {self.direct_file_id})
        async with async_session() as db:
            self.assertIsNotNone(await db.get(BotUserState, self.user_id))

    async def test_telegram_upload_uses_selected_upload_drawer(self):
        from app.telegram import build_clients
        build_clients()
        from app.bot import handle_file, set_upload_drawer, upload_message_queues
        await set_upload_drawer(111, self.folder_id)
        media = SimpleNamespace(
            file_id="telegram-current", file_unique_id="telegram-current-unique",
            file_name="inside.mp4", file_size=1024, mime_type="video/mp4",
            duration=30, width=640, height=360, thumbs=[],
        )
        status = SimpleNamespace(edit=AsyncMock())
        message = SimpleNamespace(
            from_user=SimpleNamespace(id=111, username="test", first_name="Mahdi", last_name=None),
            video=media, audio=None, document=None, photo=None,
            caption="توضیح", id=501, reply=AsyncMock(return_value=status),
        )
        forwarded = SimpleNamespace(id=902, video=media, audio=None, document=None, photo=None)
        with patch("app.bot.forward_to_storage_channel", new_callable=AsyncMock, return_value=forwarded):
            await handle_file(None, message)
            await upload_message_queues[111].join()
        async with async_session() as db:
            saved = (await db.execute(select(File).where(File.channel_message_id == 902))).scalar_one()
            self.assertEqual(saved.folder_id, self.folder_id)
        self.assertIn("در کشوی", status.edit.await_args.args[0])

    async def test_manual_personal_channel_post_is_added_once(self):
        """A post written directly in a connected channel becomes a library item."""
        from app.telegram import build_clients
        build_clients()
        from app.bot import import_personal_channel_post

        channel_id = -1009876543210
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            user.storage_channel_id = -1001111111111
            user.storage_channels_json = json.dumps([-1001111111111, channel_id])
            await db.commit()

        message = SimpleNamespace(
            id=4455,
            chat=SimpleNamespace(id=channel_id),
            text="یادداشت مستقیم از کانال\nاین متن باید در جست‌وجو هم بماند.",
            video=None, audio=None, voice=None, animation=None,
            video_note=None, document=None, photo=None,
        )
        with patch("app.bot.asyncio.sleep", new=AsyncMock()):
            await import_personal_channel_post(message)
            await import_personal_channel_post(message)

        async with async_session() as db:
            records = (await db.execute(select(File).where(
                File.user_id == self.user_id,
                File.storage_channel_id == channel_id,
                File.channel_message_id == message.id,
            ))).scalars().all()
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0].file_type, "text")
            self.assertIn("این متن", records[0].search_text)

    async def test_device_login_reuses_one_session(self):
        request = SimpleNamespace(
            headers={
                "x-komod-device-id": "same-phone-installation",
                "user-agent": "Telegram Android",
                "x-forwarded-for": "192.0.2.10",
            },
            client=SimpleNamespace(host="192.0.2.10"),
        )
        async with async_session() as db:
            user = await db.get(User, self.user_id)
            first = await _session_for_device(db, request, user)
            db.add(first)
            await db.commit()
            second = await _session_for_device(db, request, user)
            db.add(second)
            await db.commit()
            sessions = (await db.execute(select(AuthSession).where(AuthSession.user_id == self.user_id))).scalars().all()
        self.assertEqual(first.id, second.id)
        self.assertTrue(first.id.startswith("device-"))
        self.assertEqual(len(sessions), 1)

    async def test_saved_text_message_can_be_previewed(self):
        async with async_session() as db:
            note = self.make_file(self.user_id, None, 103)
            note.file_type = "text"
            note.file_name = "Hello"
            db.add(note)
            await db.commit()
            await db.refresh(note)
            user = await db.get(User, self.user_id)
            with patch("app.routers.files.get_message_from_channel", new_callable=AsyncMock) as get_message:
                get_message.return_value = SimpleNamespace(text="Hello")
                result = await get_text_preview(note.id, db, user)
            self.assertEqual(result, {"content": "Hello"})

    async def test_photo_response_supports_range_requests(self):
        photo = self.make_file(self.user_id, None, 104)
        photo.file_type = "image"
        photo.mime_type = "image/jpeg"
        client = SimpleNamespace(download_media=AsyncMock(return_value=io.BytesIO(b"abcde")))
        with patch("app.routers.streaming.telegram.tg_client", client):
            response = await stored_message_response(photo, SimpleNamespace(photo=True), "bytes=1-3", 0)
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.body, b"bcd")
        self.assertEqual(response.headers["content-range"], "bytes 1-3/5")

    async def test_root_library_is_virtualized_and_paginated(self):
        from app.telegram import build_clients
        build_clients()
        from app.bot import library_filters, render_folder_page
        async with async_session() as db:
            db.add_all([Folder(user_id=self.user_id, name=f"Root {index}") for index in range(10)])
            await db.commit()
        library_filters.pop(111, None)
        message = SimpleNamespace(edit=AsyncMock())
        await render_folder_page(message, 111)
        markup = message.edit.await_args.kwargs["reply_markup"]
        callbacks = [button.callback_data for row in markup.inline_keyboard for button in row]
        self.assertNotIn("rootfiles:0", callbacks)
        self.assertTrue(any(callback and callback.startswith("folder:") for callback in callbacks))
        self.assertIn("folders:0:1", callbacks)

    async def test_utf8_text_document_can_be_previewed(self):
        async with async_session() as db:
            document = self.make_file(self.user_id, None, 105)
            db.add(document)
            await db.commit()
            await db.refresh(document)
            user = await db.get(User, self.user_id)
            client = SimpleNamespace(download_media=AsyncMock(return_value=io.BytesIO(b"hello")))
            with patch("app.routers.files.get_message_from_channel", new_callable=AsyncMock) as get_message, patch(
                "app.routers.files.telegram.tg_client", client
            ):
                get_message.return_value = SimpleNamespace(document=True)
                result = await get_text_preview(document.id, db, user)
            self.assertEqual(result, {"content": "hello"})

    async def test_utf16_text_document_can_be_previewed(self):
        async with async_session() as db:
            document = self.make_file(self.user_id, None, 106)
            db.add(document)
            await db.commit()
            await db.refresh(document)
            user = await db.get(User, self.user_id)
            client = SimpleNamespace(download_media=AsyncMock(return_value=io.BytesIO("سلام".encode("utf-16"))))
            with patch("app.routers.files.get_message_from_channel", new_callable=AsyncMock) as get_message, patch(
                "app.routers.files.telegram.tg_client", client
            ):
                get_message.return_value = SimpleNamespace(document=True)
                result = await get_text_preview(document.id, db, user)
            self.assertEqual(result, {"content": "سلام"})


class TelegramStartupTests(unittest.IsolatedAsyncioTestCase):
    async def test_optional_telegram_setup_does_not_block_web_startup(self):
        main_client = SimpleNamespace()
        helper_client = SimpleNamespace()
        helper_started = asyncio.Event()
        release_helper = asyncio.Event()

        async def fake_start(index, client):
            if index == 0:
                return True
            helper_started.set()
            await release_helper.wait()
            return True

        with patch.object(telegram, "clients", [main_client, helper_client]), patch.object(
            telegram, "start_one_client", side_effect=fake_start
        ), patch.object(telegram, "configure_main_client", new_callable=AsyncMock):
            await asyncio.wait_for(telegram.start_all_clients(), timeout=0.2)
            await asyncio.wait_for(helper_started.wait(), timeout=0.2)
            release_helper.set()
            await asyncio.gather(*list(telegram._background_tasks), return_exceptions=True)

    async def test_batch_storage_delete_falls_back_to_individual_messages(self):
        client = SimpleNamespace(delete_messages=AsyncMock(side_effect=[RuntimeError("batch failed"), None, None]))
        with patch.object(telegram, "tg_client", client):
            self.assertTrue(await telegram.delete_from_storage_channel([101, 102]))
        self.assertEqual(client.delete_messages.await_count, 3)

    async def test_home_callback_does_not_depend_on_a_folder(self):
        from app.telegram import build_clients
        build_clients()
        from app.bot import handle_callback, settings
        callback = SimpleNamespace(
            data="home",
            from_user=SimpleNamespace(id=111),
            message=SimpleNamespace(edit=AsyncMock(), chat=SimpleNamespace(id=111)),
            answer=AsyncMock(),
        )
        with patch.object(settings, "auth_users_str", ""):
            await handle_callback(None, callback)
        callback.message.edit.assert_awaited_once()
        self.assertIn("کمد من", callback.message.edit.await_args.args[0])

    async def test_main_client_failure_aborts_startup(self):
        client = SimpleNamespace(start=AsyncMock(side_effect=RuntimeError("invalid credentials")), is_connected=False)
        with self.assertRaisesRegex(RuntimeError, "invalid credentials"):
            await start_one_client(0, client)

    async def test_local_web_button_has_no_rejected_url(self):
        from app.telegram import build_clients
        build_clients()
        from app.bot import get_web_app_button, settings
        with patch.object(settings, "web_base_url", "http://localhost:3000"):
            button = get_web_app_button(111)
            self.assertEqual(button.callback_data, "get_web_link")
            self.assertIsNone(button.url)
            self.assertIsNone(button.web_app)
        with patch.object(settings, "web_base_url", "https://example.com"):
            self.assertTrue(get_web_app_button(111).web_app.url.startswith("https://example.com/auth?token="))

    async def test_bot_commands_and_description_detail(self):
        client = SimpleNamespace(
            start=AsyncMock(), get_me=AsyncMock(return_value=SimpleNamespace(username="teleplay_test_bot")),
            set_bot_commands=AsyncMock(), set_bot_name=AsyncMock(),
            set_bot_info_short_description=AsyncMock(), set_bot_info_description=AsyncMock(), is_connected=True,
        )
        await start_one_client(0, client)
        await configure_main_client(client)
        commands = client.set_bot_commands.await_args.args[0]
        self.assertIn("search", [command.command for command in commands])
        self.assertTrue(all(command.description for command in commands))
        client.set_bot_name.assert_awaited_once_with("🗂 کمد | درایو ابری تلگرام")
        client.set_bot_info_short_description.assert_awaited_once_with(
            "فایلات رو کشوبندی کن، فیلم و موزیکاتو بدون نیاز به دانلود استریم کن و همه‌چیز رو منظم نگه دار! 📦✨"
        )
        profile_description = client.set_bot_info_description.await_args.args[0]
        assert profile_description.startswith("به کُمُد 🗄 خوش اومدی!")
        assert "جست‌وجوی تیزبین" in profile_description

        from app.telegram import build_clients
        build_clients()
        from app.bot import file_detail_keyboard, file_detail_text, file_more_keyboard, format_duration, format_jalali, format_size, help_keyboard, main_menu_keyboard, pagination_row, search_type_keyboard, sort_keyboard, sort_drafts, truncate_description, type_filter_keyboard
        file = SimpleNamespace(
            file_type="video", file_name="clip.mp4", file_size=10,
            duration=5, description="توضیح همراه رسانه",
            created_at=datetime(2025, 3, 21, tzinfo=timezone.utc),
            updated_at=datetime(2025, 3, 21, tzinfo=timezone.utc),
            public_hash=None, id=99,
        )
        self.assertIn("توضیح همراه رسانه", file_detail_text(file))
        self.assertIn("۱۴۰۴/۰۱/۰۱", format_jalali(file.created_at))
        detail_callbacks = [button.callback_data for row in file_detail_keyboard(file, "search:2").inline_keyboard for button in row]
        self.assertIn("search:2", detail_callbacks)
        self.assertIn("filestt:99", detail_callbacks)
        self.assertIn("filemore:99", detail_callbacks)
        self.assertNotIn("delfile:99", detail_callbacks)
        more_callbacks = [button.callback_data for row in file_more_keyboard(file, "search:2").inline_keyboard for button in row]
        self.assertIn("delfile:99", more_callbacks)
        self.assertIn("openfile:99", more_callbacks)
        self.assertTrue(all(len(button.callback_data or "") <= 64 for button in pagination_row("folders:123", 1, 30)))
        search_callbacks = [button.callback_data for row in search_type_keyboard().inline_keyboard for button in row]
        self.assertIn("search_filter_toggle:folder", search_callbacks)
        self.assertIn("search_filter_toggle:video", search_callbacks)
        self.assertIn("search_filter_apply", search_callbacks)
        search_rows = search_type_keyboard().inline_keyboard
        self.assertEqual([len(row) for row in search_rows[:2]], [3, 3])
        library_buttons = type_filter_keyboard({"video", "image"}, "library").inline_keyboard
        selected_buttons = [button for row in library_buttons for button in row if (button.callback_data or "").startswith("library_filter_toggle:")]
        self.assertEqual(sum("✅" in button.text for button in selected_buttons), 2)
        self.assertTrue(truncate_description("\n".join(["خط"] * 6)).endswith("…"))
        sort_drafts[111] = [("name", "asc"), ("type", "desc")]
        sort_buttons = [button for row in sort_keyboard(111).inline_keyboard for button in row]
        self.assertTrue(any("۱. ↑" in button.text for button in sort_buttons))
        self.assertTrue(all(len(button.callback_data or "") <= 64 for button in sort_buttons))
        menu_labels = [button.text for row in main_menu_keyboard(111).inline_keyboard for button in row]
        self.assertIn("📦 همه‌ی فایل‌ها", menu_labels)
        self.assertIn("🗄️ کشوهای من", menu_labels)
        self.assertIn("🔍 بگرد تو کمد", menu_labels)
        self.assertEqual(
            [button.text for row in help_keyboard(111).inline_keyboard for button in row],
            ["✨ ورود به نسخهٔ وب", "🚪 بازگشت به منوی اصلی"],
        )
        self.assertIn("صفحه ۲ از ۴", [button.text for button in pagination_row("files", 1, 25)])
        self.assertEqual(format_size(1024 * 1024), "۱.۰ مگابایت")
        self.assertEqual(format_duration(3660), "۱ ساعت و ۱ دقیقه")


if __name__ == "__main__":
    unittest.main()
