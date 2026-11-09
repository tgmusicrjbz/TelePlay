"""Bounded readers for JSON values persisted in legacy text columns."""
from __future__ import annotations

import json
from typing import Any


MAX_STORED_JSON_BYTES = 1_000_000


def _decode(value: str | bytes | bytearray | Any, fallback: Any, *, max_bytes: int) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if not isinstance(value, (str, bytes, bytearray)):
        return fallback
    if len(value) > max_bytes:
        return fallback
    try:
        return json.loads(value or "null")
    except (TypeError, ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return fallback


def load_json_object(value: Any, default: dict | None = None, *, max_bytes: int = MAX_STORED_JSON_BYTES) -> dict:
    """Return only a JSON object and isolate callers from malformed legacy data."""
    fallback = dict(default or {})
    decoded = _decode(value, fallback, max_bytes=max_bytes)
    return decoded if isinstance(decoded, dict) else fallback


def load_json_array(
    value: Any,
    default: list | None = None,
    *,
    max_bytes: int = MAX_STORED_JSON_BYTES,
    max_items: int | None = None,
) -> list:
    """Return only a JSON array, optionally truncating untrusted persisted lists."""
    fallback = list(default or [])
    decoded = _decode(value, fallback, max_bytes=max_bytes)
    if not isinstance(decoded, list):
        return fallback
    return decoded[:max_items] if max_items is not None else decoded


def bounded_int(value: Any, default: int = 0, *, minimum: int | None = None, maximum: int | None = None) -> int:
    """Coerce a persisted scalar without allowing invalid or unbounded values."""
    try:
        result = int(value)
    except (TypeError, ValueError, OverflowError):
        result = default
    if minimum is not None:
        result = max(minimum, result)
    if maximum is not None:
        result = min(maximum, result)
    return result
