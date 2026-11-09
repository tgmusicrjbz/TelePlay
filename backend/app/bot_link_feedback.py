import asyncio
from functools import wraps

from pyrogram.types import Message, ReactionTypeEmoji


async def acknowledge_request(client, message: Message, *preferred: str) -> None:
    """React to a request without letting chat reaction restrictions block it."""
    candidates = tuple(dict.fromkeys((*preferred, "👀", "❤️")))
    for emoji in candidates:
        try:
            await client.set_reaction(
                message.chat.id,
                message.id,
                [ReactionTypeEmoji(emoji=emoji)],
                is_big=False,
                add_to_recent=False,
            )
            return
        except Exception:
            continue


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
