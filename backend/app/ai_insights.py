"""Constrained parsing for non-destructive AI file insights."""
from __future__ import annotations

import json
import re


def insights_instruction() -> str:
    return (
        "محتوای فایل را فقط بر اساس اطلاعات ورودی تحلیل کن. اطلاعات، نام یا نتیجه‌ای که در ورودی نیست نساز. "
        "خلاصه را روان و کوتاه و به زبان غالب متن بنویس. نکته‌های کلیدی مستقل، دقیق و بدون تکرار باشند. "
        'فقط JSON معتبر با ساختار {"summary":"...","key_points":["..."],"topics":["..."]} برگردان. '
        "summary حداکثر ۱۲۰۰ نویسه، key_points حداکثر ۸ مورد و topics حداکثر ۸ عبارت کوتاه باشد. "
        "بیرون JSON هیچ توضیح یا Markdown ننویس."
    )


def parse_file_insights(raw: str) -> dict[str, object]:
    match = re.search(r"\{[\s\S]*\}", raw.strip())
    if not match:
        raise ValueError("پاسخ خلاصه‌سازی ساختار معتبری نداشت.")
    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError as error:
        raise ValueError("پاسخ خلاصه‌سازی قابل خواندن نبود.") from error
    if not isinstance(payload, dict):
        raise ValueError("پاسخ خلاصه‌سازی ساختار معتبری نداشت.")

    summary = re.sub(r"\n{3,}", "\n\n", str(payload.get("summary") or "").strip())[:1200]
    if not summary:
        raise ValueError("هوش مصنوعی خلاصه‌ای برنگرداند.")

    def clean_list(value: object, *, limit: int, item_limit: int) -> list[str]:
        if not isinstance(value, list):
            return []
        result: list[str] = []
        seen: set[str] = set()
        for raw_item in value:
            item = re.sub(r"\s+", " ", str(raw_item or "")).strip(" -•#\t\r\n")[:item_limit]
            key = item.casefold()
            if item and key not in seen:
                result.append(item)
                seen.add(key)
            if len(result) >= limit:
                break
        return result

    return {
        "summary": summary,
        "key_points": clean_list(payload.get("key_points"), limit=8, item_limit=300),
        "topics": clean_list(payload.get("topics"), limit=8, item_limit=60),
    }
