"""Best-effort migration of legacy encrypted user fields to the active key."""

from __future__ import annotations

import logging

from sqlalchemy import or_, select

from .config import get_settings
from .database import async_session
from .encrypted_data import needs_rotation, rotate_value
from .models import User


logger = logging.getLogger(__name__)

_FIELDS = (
    ("totp_secret_encrypted", "komod-2fa"),
    ("gemini_api_keys_encrypted", "gemini-user-keys:v1"),
    ("google_drive_credentials_encrypted", "google-drive:v1"),
)


async def rotate_persisted_user_secrets() -> tuple[int, int]:
    """Re-encrypt readable legacy values; return (rotated, unreadable)."""
    if not get_settings().data_encryption_key.strip():
        return 0, 0
    rotated = 0
    unreadable = 0
    async with async_session() as db:
        users = (await db.execute(select(User).where(or_(*(
            getattr(User, field).isnot(None) for field, _context in _FIELDS
        ))))).scalars().all()
        for user in users:
            for field, context in _FIELDS:
                current = getattr(user, field)
                if not needs_rotation(current):
                    continue
                updated = rotate_value(current, context=context)
                if updated is None:
                    unreadable += 1
                    logger.error("Could not rotate encrypted field user=%s field=%s", user.id, field)
                    continue
                setattr(user, field, updated)
                rotated += 1
        if rotated:
            await db.commit()
    return rotated, unreadable
