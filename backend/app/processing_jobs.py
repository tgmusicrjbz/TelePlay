"""Small persistence layer shared by background processing queues."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, select

from .database import async_session
from .models import ProcessingJob

logger = logging.getLogger(__name__)
TERMINAL_STATES = {"done", "error", "cancelled"}


def _parse_json(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


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


async def delete_job(job_id: str, user_id: int) -> None:
    async with async_session() as db:
        await db.execute(delete(ProcessingJob).where(ProcessingJob.id == job_id, ProcessingJob.user_id == user_id))
        await db.commit()


async def delete_finished_jobs(kind: str, user_id: int) -> int:
    async with async_session() as db:
        result = await db.execute(delete(ProcessingJob).where(
            ProcessingJob.kind == kind,
            ProcessingJob.user_id == user_id,
            ProcessingJob.state.in_(TERMINAL_STATES),
        ))
        await db.commit()
        return int(result.rowcount or 0)


async def load_jobs(kind: str, recent_for: timedelta = timedelta(minutes=5)) -> list[tuple[dict, dict]]:
    """Return recoverable jobs plus recent visible history and prune old history."""
    cutoff = datetime.utcnow() - recent_for
    async with async_session() as db:
        await db.execute(delete(ProcessingJob).where(
            ProcessingJob.kind == kind,
            ProcessingJob.state.in_(TERMINAL_STATES),
            ProcessingJob.finished_at.is_not(None),
            ProcessingJob.finished_at < cutoff,
        ))
        rows = (await db.execute(
            select(ProcessingJob).where(
                ProcessingJob.kind == kind,
                (ProcessingJob.state.not_in(TERMINAL_STATES))
                | (ProcessingJob.finished_at.is_(None))
                | (ProcessingJob.finished_at >= cutoff),
            ).order_by(ProcessingJob.created_at)
        )).scalars().all()
        await db.commit()
    return [(_parse_json(row.payload_json), _parse_json(row.result_json)) for row in rows]
