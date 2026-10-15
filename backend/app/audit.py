"""Small helpers for security and access audit events."""
from __future__ import annotations

import json
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from .models import SecurityEvent


def request_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    return forwarded or (request.client.host if request.client else None)


def add_security_event(
    db: AsyncSession,
    event_type: str,
    *,
    user_id: int | None = None,
    request: Request | None = None,
    success: bool = True,
    suspicious: bool = False,
    target_type: str | None = None,
    target_id: str | int | None = None,
    details: dict | None = None,
) -> SecurityEvent:
    event = SecurityEvent(
        user_id=user_id,
        event_type=event_type,
        success=success,
        suspicious=suspicious,
        target_type=target_type,
        target_id=str(target_id) if target_id is not None else None,
        ip_address=request_ip(request),
        user_agent=request.headers.get("user-agent") if request else None,
        details_json=json.dumps(details or {}, ensure_ascii=False),
    )
    db.add(event)
    return event
