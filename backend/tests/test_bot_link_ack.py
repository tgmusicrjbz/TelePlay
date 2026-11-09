import os
import sys
import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("JWT_SECRET", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.bot_link_feedback import acknowledge_link_request


def test_link_ack_uses_eyes_then_falls_back_to_heart():
    client = SimpleNamespace(set_reaction=AsyncMock(side_effect=[RuntimeError("not allowed"), object()]))
    message = SimpleNamespace(id=42, chat=SimpleNamespace(id=-1007))

    asyncio.run(acknowledge_link_request(client, message))

    assert client.set_reaction.await_count == 2
    assert client.set_reaction.await_args_list[0].args[2][0].emoji == "👀"
    assert client.set_reaction.await_args_list[1].args[2][0].emoji == "❤️"


def test_link_ack_reaction_failure_is_non_blocking():
    client = SimpleNamespace(set_reaction=AsyncMock(side_effect=RuntimeError("disabled")))
    message = SimpleNamespace(id=42, chat=SimpleNamespace(id=-1007))

    assert asyncio.run(acknowledge_link_request(client, message)) is None
    assert client.set_reaction.await_count == 2
