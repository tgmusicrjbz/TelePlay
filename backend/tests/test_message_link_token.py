import os

os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "000000:test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("JWT_SECRET", "message-link-test-secret")

from app.auth import create_telegram_message_link_token, verify_token_payload


def test_telegram_message_link_does_not_require_a_library_file():
    token = create_telegram_message_link_token(-10042, 87, "voice.ogg", "audio/ogg", "voice", True)
    payload = verify_token_payload(token, "telegram-message-link")

    assert payload is not None
    assert payload["sub"] == "-10042"
    assert payload["mid"] == 87
    assert payload["name"] == "voice.ogg"
    assert payload["mime"] == "audio/ogg"
    assert payload["kind"] == "voice"
    assert payload["download"] is True
