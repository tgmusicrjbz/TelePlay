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

from app.auth import (
    create_recipient_delivery_token,
    create_short_link_token,
    create_telegram_message_link_token,
    verify_recipient_delivery_token,
    verify_short_link_token,
    verify_token_payload,
)
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


def test_short_file_link_is_compact_and_preserves_download_mode():
    token = create_short_link_token("file", 123456789, 987654321, True)
    payload = verify_short_link_token(token)

    assert len(token) <= 48
    assert payload is not None
    assert payload["kind"] == "file"
    assert payload["sub"] == 123456789
    assert payload["oid"] == 987654321
    assert payload["download"] is True


def test_short_message_link_supports_negative_chat_ids_and_rejects_tampering():
    token = create_short_link_token("message", -1001234567890, 87)
    payload = verify_short_link_token(token)

    assert payload is not None
    assert payload["kind"] == "message"
    assert payload["sub"] == -1001234567890
    assert payload["oid"] == 87
    assert payload["download"] is False

    replacement = "A" if token[-1] != "A" else "B"
    assert verify_short_link_token(f"{token[:-1]}{replacement}") is None


def test_recipient_delivery_token_is_compact_bound_and_rejects_tampering():
    token = create_recipient_delivery_token(123456789, -1001234567890, 87)
    payload = verify_recipient_delivery_token(token)

    assert len(f"private_{token}") <= 64
    assert payload is not None
    assert payload["recipient_id"] == 123456789
    assert payload["chat_id"] == -1001234567890
    assert payload["message_id"] == 87

    replacement = "A" if token[-1] != "A" else "B"
    assert verify_recipient_delivery_token(f"{token[:-1]}{replacement}") is None


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


def test_short_message_link_info_builds_short_stream_and_download_urls(monkeypatch):
    token = create_short_link_token("message", -10042, 87)
    media = SimpleNamespace(file_name="clip.mp4", mime_type="video/mp4", file_size=8192)
    message = SimpleNamespace(id=87, empty=False, video=media, photo=None)
    telegram_client = SimpleNamespace(get_messages=AsyncMock(return_value=message))
    monkeypatch.setattr(shares.telegram, "tg_client", telegram_client)

    result = asyncio.run(shares.temporary_link_info(token, None))

    assert result["file_name"] == "clip.mp4"
    assert result["file_type"] == "video"
    assert result["stream_url"].startswith("/api/shares/short-link/")
    assert result["download_url"].startswith("/l/")
    assert result["stream_url"] != result["download_url"]
    assert verify_short_link_token(result["stream_url"].rsplit("/", 1)[-1])["download"] is False
    assert verify_short_link_token(result["download_url"].rsplit("/", 1)[-1])["download"] is True


def test_short_message_stream_loads_original_message(monkeypatch):
    token = create_short_link_token("message", -10042, 87, True)
    media = SimpleNamespace(file_name="voice.ogg", mime_type="audio/ogg", file_size=4096)
    message = SimpleNamespace(id=87, empty=False, voice=media)
    telegram_client = SimpleNamespace(get_messages=AsyncMock(return_value=message))
    stream_result = object()
    stream_message = AsyncMock(return_value=stream_result)
    monkeypatch.setattr(shares.telegram, "tg_client", telegram_client)
    monkeypatch.setattr(shares, "_stream_message", stream_message)
    request = Request({"type": "http", "method": "GET", "path": "/", "headers": []})

    result = asyncio.run(shares.stream_short_link(token, request, None))

    assert result is stream_result
    telegram_client.get_messages.assert_awaited_once_with(-10042, 87)
    assert stream_message.await_args.args[0].file_name == "voice.ogg"
    assert stream_message.await_args.args[3] is True
