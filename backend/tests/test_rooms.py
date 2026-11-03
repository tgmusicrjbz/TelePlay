import os
import unittest
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "000000:test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///./room-test.sqlite")
os.environ.setdefault("JWT_SECRET", "room-test-secret")

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.models import File, RoomItem, RoomMember, User, WatchRoom
from app.auth import verify_token_payload
from app.routers.rooms import RoomCreate, RoomItemsUpdate, RoomJoin, RoomUpdate, create_room, join_room, update_items, update_room


class RoomTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with self.engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def asyncTearDown(self):
        await self.engine.dispose()

    async def test_owner_can_create_room_and_reorder_owned_media(self):
        async with self.sessions() as db:
            owner = User(telegram_id=1001, first_name="Owner", can_create_rooms=True)
            db.add(owner); await db.flush()
            first = File(user_id=owner.id, file_id="a", file_unique_id="a", channel_message_id=1,
                         file_name="first.mp4", file_size=10, file_type="video")
            second = File(user_id=owner.id, file_id="b", file_unique_id="b", channel_message_id=2,
                          file_name="second.mp3", file_size=10, file_type="audio")
            db.add_all([first, second]); await db.commit()

            result = await create_room(RoomCreate(name="Test room", file_ids=[first.id, second.id]), db, owner)
            self.assertEqual(result["my_role"], "owner")
            self.assertEqual([item["id"] for item in result["items"]], [first.id, second.id])

            updated = await update_items(result["id"], RoomItemsUpdate(file_ids=[second.id, first.id]), db, owner)
            self.assertEqual([item["id"] for item in updated["items"]], [second.id, first.id])
            self.assertEqual(updated["current_index"], 1)
            self.assertEqual((await db.execute(select(WatchRoom))).scalars().one().name, "Test room")
            self.assertEqual(len((await db.execute(select(RoomMember))).scalars().all()), 1)
            self.assertEqual(len((await db.execute(select(RoomItem))).scalars().all()), 2)

            hidden = await update_room(result["id"], RoomUpdate(queue_visible_to_viewers=False), db, owner)
            self.assertFalse(hidden["queue_visible_to_viewers"])
            self.assertFalse((await db.execute(select(WatchRoom))).scalars().one().queue_visible_to_viewers)

    async def test_password_join_issues_member_scoped_media_token(self):
        async with self.sessions() as db:
            owner = User(telegram_id=2001, first_name="Owner", can_create_rooms=True)
            viewer = User(telegram_id=2002, first_name="Viewer")
            db.add_all([owner, viewer]); await db.flush()
            media = File(user_id=owner.id, file_id="video", file_unique_id="video", channel_message_id=3,
                         file_name="movie.mp4", file_size=10, file_type="video")
            db.add(media); await db.commit()
            room = await create_room(RoomCreate(name="Private", password="secret", file_ids=[media.id]), db, owner)

            joined = await join_room(room["id"], RoomJoin(password="secret"), db, viewer)
            self.assertEqual(joined["my_role"], "viewer")
            token = parse_qs(urlparse(joined["items"][0]["stream_url"]).query)["token"][0]
            payload = verify_token_payload(token, "room-stream")
            self.assertEqual(payload["uid"], viewer.id)
            self.assertEqual(payload["rid"], room["id"])
            self.assertEqual(payload["fid"], media.id)


if __name__ == "__main__":
    unittest.main()
