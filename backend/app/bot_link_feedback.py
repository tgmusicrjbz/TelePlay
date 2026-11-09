from pyrogram.types import Message, ReactionTypeEmoji


async def acknowledge_link_request(client, message: Message) -> None:
    """React to a supported link without letting reaction restrictions block it."""
    for emoji in ("👀", "❤️"):
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
