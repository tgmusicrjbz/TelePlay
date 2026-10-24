"""Render user configurable captions for files imported from public links."""
from __future__ import annotations

import re


YOUTUBE_CAPTION_TEMPLATE = "📝 [عنوان]\n📺 [سازنده]\n🔗 [لینک]"
INSTAGRAM_CAPTION_TEMPLATE = "📝 [عنوان]\n📷 [سازنده]\n🔗 [لینک]"

_PLACEHOLDER_ALIASES = {
    "عنوان": "title", "تیتر": "title", "title": "title",
    "سازنده": "author", "پیج": "author", "کانال": "author", "author": "author", "channel": "author",
    "لینک": "url", "آدرس": "url", "url": "url", "link": "url",
    "پلتفرم": "platform", "platform": "platform",
    "نوع": "media_type", "نوع فایل": "media_type", "type": "media_type",
    "کیفیت": "quality", "quality": "quality",
    "توضیحات": "description", "متن": "description", "caption": "description", "description": "description",
}


def render_link_caption(template: str | None, **values: object) -> str | None:
    """Replace known ``[placeholder]`` values and remove empty template rows."""
    source = (template or "").strip()
    if not source:
        return None
    normalized = {key: str(value or "").strip() for key, value in values.items()}

    def replace(match: re.Match[str]) -> str:
        key = _PLACEHOLDER_ALIASES.get(match.group(1).strip().casefold())
        return normalized.get(key, "") if key else match.group(0)

    lines: list[str] = []
    for source_line in source.splitlines():
        placeholders = re.findall(r"\[([^\[\]]+)\]", source_line)
        known_keys = [_PLACEHOLDER_ALIASES.get(item.strip().casefold()) for item in placeholders]
        if known_keys and all(key and not normalized.get(key, "") for key in known_keys):
            continue
        line = re.sub(r"\[([^\[\]]+)\]", replace, source_line)
        compact = line.strip()
        if not compact:
            if lines and lines[-1] != "":
                lines.append("")
            continue
        lines.append(line.rstrip())
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)[:1024] or None
