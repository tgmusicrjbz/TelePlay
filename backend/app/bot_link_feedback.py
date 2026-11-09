import asyncio
import json
import logging
from functools import wraps
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from pyrogram.types import Message, ReactionTypeEmoji

logger = logging.getLogger(__name__)


async def reply_to_request(message: Message, *args, **kwargs):
    """Reply to the originating request in both private and group chats."""
    kwargs.setdefault("quote", True)
    return await message.reply(*args, **kwargs)


def _post_bot_api_reaction(bot_token: str, chat_id: int, message_id: int, emoji: str) -> tuple[bool, str]:
    request = Request(
        f"https://api.telegram.org/bot{bot_token}/setMessageReaction",
        data=json.dumps({
            "chat_id": chat_id,
            "message_id": message_id,
            "reaction": [{"type": "emoji", "emoji": emoji}],
            "is_big": False,
        }).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
        return bool(payload.get("ok")), str(payload.get("description") or "")
    except HTTPError as error:
        try:
            payload = json.loads(error.read().decode("utf-8"))
            return False, str(payload.get("description") or f"HTTP {error.code}")
        except Exception:
            return False, f"HTTP {error.code}"
    except Exception as error:
        return False, f"{type(error).__name__}: {error}"


async def acknowledge_request(client, message: Message, *preferred: str) -> None:
    """React to a request without letting chat reaction restrictions block it."""
    candidates = tuple(dict.fromkeys(emoji.replace("\ufe0f", "") for emoji in (*preferred, "👀", "❤")))
    failures: list[str] = []
    for emoji in candidates:
        bot_token = str(getattr(client, "bot_token", "") or "")
        if bot_token:
            ok, reason = await asyncio.to_thread(
                _post_bot_api_reaction, bot_token, message.chat.id, message.id, emoji,
            )
            if ok:
                return
            if reason:
                failures.append(f"BotAPI {emoji}: {reason}")
        try:
            await client.set_reaction(
                message.chat.id,
                message.id,
                [ReactionTypeEmoji(emoji=emoji)],
                is_big=False,
                add_to_recent=False,
            )
            return
        except Exception as error:
            failures.append(f"MTProto {emoji}: {type(error).__name__}: {error}")
            continue
    logger.warning(
        "Telegram rejected request reactions chat=%s message=%s: %s",
        getattr(getattr(message, "chat", None), "id", "?"),
        getattr(message, "id", "?"),
        " | ".join(failures) or "no supported method",
    )


async def acknowledge_link_request(client, message: Message) -> None:
    await acknowledge_request(client, message, "👀")


def react_to_request(*preferred: str):
    """Start acknowledgement immediately, then run the command handler normally."""
    def decorator(handler):
        @wraps(handler)
        async def wrapped(client, message: Message, *args, **kwargs):
            asyncio.create_task(acknowledge_request(client, message, *preferred))
            return await handler(client, message, *args, **kwargs)
        return wrapped
    return decorator
