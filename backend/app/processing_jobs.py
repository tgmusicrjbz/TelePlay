"""Small persistence layer shared by background processing queues."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, select

from .database import async_session
from .json_fields import load_json_object
from .models import ProcessingJob

logger = logging.getLogger(__name__)
TERMINAL_STATES = {"done", "error", "cancelled"}


def _parse_json(value: str) -> dict[str, Any]:
    return load_json_object(value)


def _parse_time(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


async def create_job(*, job_id: str, user_id: int, kind: str, title: str, payload: dict, status: dict) -> None:
    async with async_session() as db:
        record = ProcessingJob(
            id=job_id,
            user_id=user_id,
            kind=kind,
            state=str(status.get("state", "queued")),
            title=title,
            progress=int(status.get("progress", 0) or 0),
            message=str(status.get("message", "")),
            payload_json=json.dumps(payload, ensure_ascii=False),
            result_json=json.dumps(status, ensure_ascii=False),
            created_at=_parse_time(status.get("created_at")) or datetime.utcnow(),
        )
        await db.merge(record)
        await db.commit()


async def update_job(job_id: str, status: dict) -> None:
    """Persist a status snapshot; missing records are harmless in unit tests."""
    try:
        async with async_session() as db:
            record = await db.get(ProcessingJob, job_id)
            if record is None:
                return
            record.state = str(status.get("state", record.state))
            record.progress = int(status.get("progress", record.progress) or 0)
            record.message = str(status.get("message", record.message))[:500]
            record.result_json = json.dumps(status, ensure_ascii=False)
            record.finished_at = _parse_time(status.get("finished_at"))
            await db.commit()
    except Exception:
        logger.warning("Could not persist processing job %s", job_id, exc_info=True)


async def delete_job(job_id: str, user_id: int) -> bool:
    async with async_session() as db:
        result = await db.execute(delete(ProcessingJob).where(ProcessingJob.id == job_id, ProcessingJob.user_id == user_id))
        await db.commit()
        return bool(result.rowcount)


async def delete_finished_jobs(kind: str, user_id: int) -> int:
    async with async_session() as db:
        result = await db.execute(delete(ProcessingJob).where(
            ProcessingJob.kind == kind,
            ProcessingJob.user_id == user_id,
            ProcessingJob.state.in_(TERMINAL_STATES),
        ))
        await db.commit()
        return int(result.rowcount or 0)


async def load_jobs(
    kind: str,
    recent_for: timedelta | None = None,
    history_limit: int = 100,
) -> list[tuple[dict, dict]]:
    """Return recoverable jobs and a bounded history for queue hydration.

    With the default ``recent_for=None``, finished jobs stay in the database
    until the user removes them. Ephemeral queues may pass a retention window
    to preserve their existing automatic cleanup behavior.
    """
    async with async_session() as db:
        if recent_for is not None:
            cutoff = datetime.utcnow() - recent_for
            await db.execute(delete(ProcessingJob).where(
                ProcessingJob.kind == kind,
                ProcessingJob.state.in_(TERMINAL_STATES),
                ProcessingJob.finished_at.is_not(None),
                ProcessingJob.finished_at < cutoff,
            ))
            rows = (await db.execute(select(ProcessingJob).where(
                ProcessingJob.kind == kind,
                (ProcessingJob.state.not_in(TERMINAL_STATES))
                | (ProcessingJob.finished_at.is_(None))
                | (ProcessingJob.finished_at >= cutoff),
            ).order_by(ProcessingJob.created_at))).scalars().all()
            await db.commit()
            return [(_parse_json(row.payload_json), _parse_json(row.result_json)) for row in rows]

        active = (await db.execute(
            select(ProcessingJob).where(
                ProcessingJob.kind == kind,
                ProcessingJob.state.not_in(TERMINAL_STATES),
            ).order_by(ProcessingJob.created_at)
        )).scalars().all()
        finished = (await db.execute(
            select(ProcessingJob).where(
                ProcessingJob.kind == kind,
                ProcessingJob.state.in_(TERMINAL_STATES),
            ).order_by(ProcessingJob.created_at.desc()).limit(max(0, history_limit))
        )).scalars().all()
    rows = sorted([*active, *finished], key=lambda row: row.created_at or datetime.min)
    return [(_parse_json(row.payload_json), _parse_json(row.result_json)) for row in rows]


def _status_from_row(row: ProcessingJob) -> dict[str, Any]:
    status = _parse_json(row.result_json)
    status.setdefault("id", row.id)
    status.setdefault("user_id", row.user_id)
    status.setdefault("title", row.title)
    status.setdefault("state", row.state)
    status.setdefault("progress", row.progress)
    status.setdefault("message", row.message)
    status.setdefault("created_at", row.created_at.isoformat() if row.created_at else "")
    if row.finished_at:
        status.setdefault("finished_at", row.finished_at.isoformat())
    # Preview audio lives only in process memory. A persisted playback URL must
    # not be returned after a restart because it would lead to a dead player.
    payload = _parse_json(row.payload_json)
    if row.kind == "tts" and payload.get("output_mode") == "preview":
        status.pop("stream_url", None)
    return status


async def list_job_statuses(kind: str, user_id: int, limit: int = 100) -> list[dict[str, Any]]:
    """Read one user's durable history directly from the database."""
    async with async_session() as db:
        rows = (await db.execute(select(ProcessingJob).where(
            ProcessingJob.kind == kind,
            ProcessingJob.user_id == user_id,
        ).order_by(ProcessingJob.created_at.desc()).limit(max(1, limit)))).scalars().all()
    return [_status_from_row(row) for row in rows]


async def job_status(job_id: str, user_id: int, kind: str) -> dict[str, Any] | None:
    """Return a persisted status for reliable manual history deletion."""
    async with async_session() as db:
        row = (await db.execute(select(ProcessingJob).where(
            ProcessingJob.id == job_id,
            ProcessingJob.user_id == user_id,
            ProcessingJob.kind == kind,
        ))).scalar_one_or_none()
    if row is None:
        return None
    return _status_from_row(row)
