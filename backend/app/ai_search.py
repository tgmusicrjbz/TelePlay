"""Small, safe helpers for optional Gemini-assisted library search."""
from __future__ import annotations

import json
import re


MAX_SEARCH_TERMS = 8


def build_search_expansion_instruction(known_tags: list[str]) -> str:
    tags = "، ".join(tag for tag in known_tags[:80] if tag) or "تعریف نشده"
    return (
        "عبارت جست‌وجو را برای پیدا کردن فایل در یک کمد شخصی گسترش بده. "
        "فقط واژه‌ها و عبارت‌های کوتاه و نزدیک به قصد کاربر را پیشنهاد کن؛ حدس دور، اطلاعات تازه یا توضیح اضافه نکن. "
        "املای فارسی و انگلیسی رایج، مترادف‌های مستقیم و تگ‌های مرتبط را در نظر بگیر. "
        f"تگ‌های تعریف‌شده کاربر: {tags}. "
        'فقط JSON معتبر با ساختار {"terms":["عبارت اول","عبارت دوم"]} برگردان. '
        f"حداکثر {MAX_SEARCH_TERMS} مورد و بدون Markdown. عبارت اصلی را تکرار نکن."
    )


def build_related_file_instruction(known_tags: list[str]) -> str:
    tags = "، ".join(tag for tag in known_tags[:80] if tag) or "تعریف نشده"
    return (
        "از مشخصات فایل، کلیدواژه‌هایی استخراج کن که برای پیدا کردن فایل‌های واقعاً مرتبط در همان کمد مناسب باشند. "
        "موضوع، نام‌های خاص، پروژه، شخص، مکان و تگ‌های مستقیم را نگه دار؛ پسوند فایل، کلمات عمومی و حدس‌های دور را حذف کن. "
        f"تگ‌های تعریف‌شده کاربر: {tags}. "
        'فقط JSON معتبر با ساختار {"terms":["عبارت اول","عبارت دوم"]} برگردان. '
        f"حداکثر {MAX_SEARCH_TERMS} مورد، هر مورد کوتاه و بدون Markdown."
    )


def parse_search_terms(raw: str) -> list[str]:
    """Parse and constrain a model-produced list of search terms."""
    cleaned = raw.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL | re.IGNORECASE)
    candidate = fenced.group(1) if fenced else cleaned
    if not candidate.startswith("{"):
        object_match = re.search(r"\{.*\}", candidate, re.DOTALL)
        candidate = object_match.group(0) if object_match else candidate
    try:
        payload = json.loads(candidate)
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("جست‌وجوی هوشمند پاسخ معتبری برنگرداند.") from error

    raw_terms = payload.get("terms", []) if isinstance(payload, dict) else []
    if not isinstance(raw_terms, list):
        raise ValueError("جست‌وجوی هوشمند پاسخ معتبری برنگرداند.")

    seen: set[str] = set()
    terms: list[str] = []
    for item in raw_terms:
        term = re.sub(r"[;؛,،]+", " ", str(item or ""))
        term = re.sub(r"\s+", " ", term).strip(" #\t\r\n")[:80]
        key = term.casefold()
        if len(term) < 2 or key in seen:
            continue
        seen.add(key)
        terms.append(term)
        if len(terms) >= MAX_SEARCH_TERMS:
            break
    return terms


def parse_search_expansion(raw: str, original_query: str) -> dict[str, object]:
    """Parse model output, then build the existing OR query syntax."""
    original = re.sub(r"\s+", " ", original_query).strip()[:300]
    if not original:
        raise ValueError("عبارت جست‌وجو خالی است.")
    terms = [term for term in parse_search_terms(raw) if term.casefold() != original.casefold()]
    # Semicolons are OR groups in the library's existing search grammar.
    expanded_query = "؛".join([original, *terms])
    return {"query": expanded_query, "terms": terms}
