"""Validation helpers for reviewable AI drawer suggestions."""
from __future__ import annotations

import json
import re


def folder_suggestion_instruction(folder_lines: list[str]) -> str:
    choices = "\n".join(folder_lines)
    return (
        "برای این فایل حداکثر سه کشوی مناسب را فقط از فهرست مجاز انتخاب کن. "
        "شناسه‌ای خارج از فهرست نساز و کشوی فعلی را پیشنهاد نده. اگر ارتباط روشنی وجود ندارد، suggestions را خالی برگردان. "
        "دلیل هر پیشنهاد کوتاه، مشخص و بر اساس اطلاعات فایل باشد. "
        'فقط JSON معتبر با ساختار {"suggestions":[{"folder_id":12,"reason":"...","confidence":85}]} برگردان. '
        "confidence عددی بین صفر تا صد باشد و بیرون JSON چیزی ننویس.\n\n"
        f"کشوهای مجاز:\n{choices}"
    )


def parse_folder_suggestions(raw: str, allowed_folders: dict[int, dict[str, str]]) -> list[dict[str, object]]:
    match = re.search(r"\{[\s\S]*\}", raw.strip())
    if not match:
        raise ValueError("پاسخ پیشنهاد کشو ساختار معتبری نداشت.")
    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError as error:
        raise ValueError("پاسخ پیشنهاد کشو قابل خواندن نبود.") from error
    values = payload.get("suggestions", []) if isinstance(payload, dict) else []
    if not isinstance(values, list):
        raise ValueError("پاسخ پیشنهاد کشو ساختار معتبری نداشت.")

    result: list[dict[str, object]] = []
    seen: set[int] = set()
    for value in values:
        if not isinstance(value, dict):
            continue
        try:
            folder_id = int(value.get("folder_id"))
        except (TypeError, ValueError):
            continue
        folder = allowed_folders.get(folder_id)
        if not folder or folder_id in seen:
            continue
        reason = re.sub(r"\s+", " ", str(value.get("reason") or "")).strip()[:180]
        try:
            confidence = max(0, min(100, int(value.get("confidence", 0))))
        except (TypeError, ValueError):
            confidence = 0
        result.append({
            "folder_id": folder_id,
            "name": folder["name"],
            "path": folder["path"],
            "reason": reason,
            "confidence": confidence,
        })
        seen.add(folder_id)
        if len(result) >= 3:
            break
    return result
