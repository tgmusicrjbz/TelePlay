"""Focused database tests for folder deletion and text preview."""
import os
import io
import sys
import asyncio
import tempfile
import unittest
from datetime import datetime, timezone
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
from sqlalchemy import select

from app.database import Base, async_session, engine
from app.models import BotUserState, File, Folder, Playlist, PlaylistItem, User, WatchProgress
from app.routers.files import batch_update_files, get_text_preview, list_files, update_file, upload_file
from app.routers.folders import delete_folder_contents, update_folder
from app.routers.streaming import stored_message_response
from app.routers.playlists import add_playlist_items, create_playlist, reorder_playlist, shuffle_playlist
from app.schemas import BatchFileUpdate, FileUpdate, FolderUpdate, PlaylistAddItems, PlaylistCreate, PlaylistReorder
from app.telegram import configure_main_client, start_one_client
from app import telegram


class LibraryOperationsTests(unittest.IsolatedAsyncioTestCase):
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

    async def test_remote_delete_failure_keeps_database_records(self):
        async with async_session() as db:
            with patch("app.routers.folders.delete_from_storage_channel", new_callable=AsyncMock, return_value=False):
                with self.assertRaises(HTTPException):
                    await delete_folder_contents(db, await db.get(Folder, self.folder_id), True)
                await db.rollback()
        async with async_session() as db:
            self.assertIsNotNone(await db.get(Folder, self.folder_id))
            self.assertEqual(len((await db.execute(select(File))).scalars().all()), 2)

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

    async def test_telegram_upload_uses_current_drawer(self):
        from app.telegram import build_clients
        build_clients()
        from app.bot import current_drawers, handle_file, persist_user_ui_state
        current_drawers[111] = self.folder_id
        await persist_user_ui_state(111)
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
        async with async_session() as db:
            saved = (await db.execute(select(File).where(File.channel_message_id == 902))).scalar_one()
            self.assertEqual(saved.folder_id, self.folder_id)
        self.assertIn("در کشوی", status.edit.await_args.args[0])

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
        self.assertIn("rootfiles:0", callbacks)
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
        self.assertIn("رسیدیم به کُمدت", callback.message.edit.await_args.args[0])

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
        from app.bot import file_detail_keyboard, file_detail_text, format_duration, format_jalali, format_size, help_keyboard, main_menu_keyboard, pagination_row, search_type_keyboard, sort_keyboard, sort_drafts, truncate_description, type_filter_keyboard
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
