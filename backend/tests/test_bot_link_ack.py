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

from app import bot_link_feedback
from app.bot_link_feedback import acknowledge_link_request, acknowledge_request, react_to_request, reply_to_request


def test_reply_to_request_quotes_in_private_chats_too():
    message = SimpleNamespace(reply=AsyncMock(return_value="sent"))

    result = asyncio.run(reply_to_request(message, "done", reply_markup="keyboard"))

    assert result == "sent"
    message.reply.assert_awaited_once_with("done", reply_markup="keyboard", quote=True)


def test_reply_to_request_preserves_explicit_quote_choice():
    message = SimpleNamespace(reply=AsyncMock(return_value="sent"))

    asyncio.run(reply_to_request(message, "done", quote=False))

    message.reply.assert_awaited_once_with("done", quote=False)


def test_link_ack_uses_eyes_then_falls_back_to_heart():
    client = SimpleNamespace(set_reaction=AsyncMock(side_effect=[RuntimeError("not allowed"), object()]))
    message = SimpleNamespace(id=42, chat=SimpleNamespace(id=-1007))

    asyncio.run(acknowledge_link_request(client, message))

    assert client.set_reaction.await_count == 2
    assert client.set_reaction.await_args_list[0].args[2][0].emoji == "👀"
    assert client.set_reaction.await_args_list[1].args[2][0].emoji == "❤"


def test_link_ack_reaction_failure_is_non_blocking():
    client = SimpleNamespace(set_reaction=AsyncMock(side_effect=RuntimeError("disabled")))
    message = SimpleNamespace(id=42, chat=SimpleNamespace(id=-1007))

    assert asyncio.run(acknowledge_link_request(client, message)) is None
    assert client.set_reaction.await_count == 2


def test_related_reaction_falls_back_to_eyes():
    client = SimpleNamespace(set_reaction=AsyncMock(side_effect=[RuntimeError("not allowed"), object()]))
    message = SimpleNamespace(id=42, chat=SimpleNamespace(id=-1007))

    asyncio.run(acknowledge_request(client, message, "✍️"))

    assert [call.args[2][0].emoji for call in client.set_reaction.await_args_list] == ["✍", "👀"]


def test_reaction_decorator_does_not_delay_the_handler():
    client = SimpleNamespace(set_reaction=AsyncMock(return_value=object()))
    message = SimpleNamespace(id=42, chat=SimpleNamespace(id=-1007))

    @react_to_request("🤝")
    async def handler(_client, _message):
        await asyncio.sleep(0)
        return "done"

    async def run():
        result = await handler(client, message)
        await asyncio.sleep(0)
        return result

    assert asyncio.run(run()) == "done"
    assert client.set_reaction.await_args.args[2][0].emoji == "🤝"


def test_bot_api_is_used_before_mtproto(monkeypatch):
    calls = []

    def fake_post(token, chat_id, message_id, emoji):
        calls.append((token, chat_id, message_id, emoji))
        return True, ""

    monkeypatch.setattr(bot_link_feedback, "_post_bot_api_reaction", fake_post)
    client = SimpleNamespace(bot_token="secret-token", set_reaction=AsyncMock())
    message = SimpleNamespace(id=42, chat=SimpleNamespace(id=-1007))

    asyncio.run(acknowledge_request(client, message, "✍️"))

    assert calls == [("secret-token", -1007, 42, "✍")]
    client.set_reaction.assert_not_awaited()


def test_bot_api_failure_falls_back_to_mtproto(monkeypatch):
    monkeypatch.setattr(bot_link_feedback, "_post_bot_api_reaction", lambda *_: (False, "reaction unavailable"))
    client = SimpleNamespace(bot_token="secret-token", set_reaction=AsyncMock(return_value=object()))
    message = SimpleNamespace(id=42, chat=SimpleNamespace(id=-1007))

    asyncio.run(acknowledge_request(client, message, "👀"))

    assert client.set_reaction.await_args.args[2][0].emoji == "👀"
