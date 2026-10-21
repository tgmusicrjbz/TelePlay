"""Safe, reviewable AI metadata suggestions for cabinet files."""
from __future__ import annotations

import json
from pathlib import Path
import re


def build_metadata_source(file) -> str:
    try:
        current_tags = json.loads(file.tags_json or "[]")
    except (TypeError, ValueError, json.JSONDecodeError):
        current_tags = []
    content = (file.search_text or "").strip()[:12_000] if file.file_type == "text" else ""
    return "\n".join((
        f"نام فعلی: {file.file_name}",
        f"نوع: {file.file_type}",
        f"فرمت: {file.mime_type or 'نامشخص'}",
        f"توضیحات فعلی: {file.description or 'ندارد'}",
        f"تگ‌های فعلی: {', '.join(map(str, current_tags)) or 'ندارد'}",
        f"محتوای متنی:\n{content}" if content else "",
    )).strip()


def metadata_instruction(known_tags: list[str], excluded_tags: list[str]) -> str:
    return (
        "اطلاعات این فایل را تحلیل کن و فقط یک شیء JSON معتبر با کلیدهای title، description و tags برگردان. "
        "title نام کوتاه و دقیق فایل با همان پسوند فعلی باشد. description حداکثر ۵۰۰ نویسه و فارسی روان باشد. "
        "tags آرایه‌ای از حداکثر ۸ تگ کوتاه، مرتبط و بدون علامت # باشد. اطلاعاتی که از ورودی قابل استنتاج نیست نساز. "
        f"در صورت ارتباط، تگ‌های موجود را ترجیح بده: {', '.join(known_tags[:80]) or 'تگی تعریف نشده'}. "
        f"این واژه‌ها هرگز تگ نشوند: {', '.join(excluded_tags[:80]) or 'موردی نیست'}. "
        "هیچ توضیح، Markdown یا code fence بیرون JSON ننویس."
    )


def parse_metadata_suggestion(raw: str, original_name: str, excluded_tags: list[str]) -> dict:
    match = re.search(r"\{[\s\S]*\}", raw.strip())
    if not match:
        raise ValueError("پاسخ هوش مصنوعی ساختار معتبری نداشت.")
    try:
        payload = json.loads(match.group(0))
    except json.JSONDecodeError as error:
        raise ValueError("پاسخ هوش مصنوعی قابل خواندن نبود.") from error
    if not isinstance(payload, dict):
        raise ValueError("پاسخ هوش مصنوعی ساختار معتبری نداشت.")

    original_suffix = Path(original_name).suffix
    title = " ".join(str(payload.get("title") or original_name).strip().split())[:500] or original_name
    if original_suffix and Path(title).suffix.casefold() != original_suffix.casefold():
        title = f"{Path(title).stem or title}{original_suffix}"
    description = str(payload.get("description") or "").strip()[:1024]
    excluded = {str(item).strip().lstrip("#").casefold() for item in excluded_tags}
    tags: list[str] = []
    seen: set[str] = set()
    values = payload.get("tags") if isinstance(payload.get("tags"), list) else []
    for value in values:
        tag = " ".join(str(value).strip().lstrip("#").split())[:40]
        key = tag.casefold()
        if tag and key not in excluded and key not in seen:
            tags.append(tag)
            seen.add(key)
        if len(tags) >= 8:
            break
    return {"title": title, "description": description, "tags": tags}
