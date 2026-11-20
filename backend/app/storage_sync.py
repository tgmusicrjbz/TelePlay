"""Keep database media references aligned with Telegram storage messages."""
from collections.abc import Iterable

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .models import File, Folder, Pack, Playlist


async def purge_deleted_storage_messages(
    db: AsyncSession,
    channel_id: int,
    message_ids: Iterable[int],
    *,
    include_unassigned: bool = False,
) -> list[int]:
    """Remove records whose source message vanished and clear stale variants."""
    ids = sorted({int(value) for value in message_ids})
    if not ids:
        return []

    channel_condition = or_(
        File.storage_channel_id == int(channel_id),
        File.storage_channel_id.is_(None) if include_unassigned else False,
    )
    source_condition = and_(
        channel_condition,
        File.channel_message_id.in_(ids),
    )
    files = (await db.execute(select(File).where(source_condition))).scalars().all()
    file_ids = [item.id for item in files]

    # A manually removed generated variant should fall back to the original
    # media; it must not delete that original cabinet item.
    await db.execute(update(File).where(and_(
        or_(
            File.audio_variant_storage_channel_id == int(channel_id),
            File.audio_variant_storage_channel_id.is_(None) if include_unassigned else False,
        ),
        File.audio_variant_message_id.in_(ids),
    )).values(
        audio_variant_file_id=None,
        audio_variant_unique_id=None,
        audio_variant_message_id=None,
        audio_variant_storage_channel_id=None,
        audio_variant_size=None,
    ))
    await db.execute(update(File).where(and_(
        or_(
            File.compatible_video_storage_channel_id == int(channel_id),
            File.compatible_video_storage_channel_id.is_(None) if include_unassigned else False,
        ),
        File.compatible_video_message_id.in_(ids),
    )).values(
        compatible_video_file_id=None,
        compatible_video_unique_id=None,
        compatible_video_message_id=None,
        compatible_video_storage_channel_id=None,
        compatible_video_size=None,
    ))

    if file_ids:
        await db.execute(update(Folder).where(Folder.cover_file_id.in_(file_ids)).values(cover_file_id=None))
        await db.execute(update(Playlist).where(Playlist.cover_file_id.in_(file_ids)).values(cover_file_id=None))
        await db.execute(update(Pack).where(Pack.cover_file_id.in_(file_ids)).values(cover_file_id=None))
        for item in files:
            await db.delete(item)

    await db.commit()
    return file_ids
