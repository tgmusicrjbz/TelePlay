import os
import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

from starlette.requests import Request

os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "000000:test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("JWT_SECRET", "message-link-test-secret")

from app.auth import create_telegram_message_link_token, verify_token_payload
from app.routers import shares


def test_telegram_message_link_does_not_require_a_library_file():
    token = create_telegram_message_link_token(-10042, 87, "voice.ogg", "audio/ogg", "voice", 4096, True)
    payload = verify_token_payload(token, "telegram-message-link")

    assert payload is not None
    assert payload["sub"] == "-10042"
    assert payload["mid"] == 87
    assert payload["name"] == "voice.ogg"
    assert payload["mime"] == "audio/ogg"
    assert payload["kind"] == "voice"
    assert payload["size"] == 4096
    assert payload["download"] is True


def test_message_link_route_loads_the_original_telegram_message(monkeypatch):
    token = create_telegram_message_link_token(-10042, 87, "clip.mp4", "video/mp4", "video", 8192)
    message = SimpleNamespace(id=87, empty=False, video=SimpleNamespace(file_size=8192), photo=None)
    telegram_client = SimpleNamespace(get_messages=AsyncMock(return_value=message))
    stream_result = object()
    stream_message = AsyncMock(return_value=stream_result)
    monkeypatch.setattr(shares.telegram, "tg_client", telegram_client)
    monkeypatch.setattr(shares, "_stream_message", stream_message)
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})

    result = asyncio.run(shares.stream_telegram_message_link(token, request))

    assert result is stream_result
    telegram_client.get_messages.assert_awaited_once_with(-10042, 87)
    descriptor = stream_message.await_args.args[0]
    assert descriptor.file_name == "clip.mp4"
    assert descriptor.file_size == 8192


def test_message_link_info_builds_separate_play_and_download_urls():
    token = create_telegram_message_link_token(
        -10042, 87, "voice.ogg", "audio/ogg", "voice", 4096, True
    )

    result = asyncio.run(shares.temporary_link_info(token, None))

    assert result["file_name"] == "voice.ogg"
    assert result["file_type"] == "audio"
    assert result["file_size"] == 4096
    assert result["stream_url"].startswith("/api/shares/message-link/")
    assert result["download_url"].startswith("/api/shares/message-link/")
    assert result["stream_url"] != result["download_url"]

    play_payload = verify_token_payload(result["stream_url"].rsplit("/", 1)[-1], "telegram-message-link")
    download_payload = verify_token_payload(result["download_url"].rsplit("/", 1)[-1], "telegram-message-link")
    assert play_payload["download"] is False
    assert download_payload["download"] is True
