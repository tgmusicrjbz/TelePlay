"""Metadata directives supported in Telegram upload captions."""
import re


def extract_tags_from_caption(caption: str | None, excluded_tags: list[str] | None = None) -> list[str]:
    if not caption:
        return []
    excluded = {str(tag).strip().lstrip("#").casefold() for tag in (excluded_tags or []) if str(tag).strip()}
    cleaned: list[str] = []
    seen: set[str] = set()
    hashtag_pattern = r"""#([^\s#.,;:!?'"()\[\]{}<>/\\+=*&^%$@~`|]+)"""
    for tag_match in re.findall(hashtag_pattern, caption):
        tag = tag_match.strip()[:40]
        key = tag.casefold()
        if tag and key not in seen and key not in excluded:
            cleaned.append(tag)
            seen.add(key)
    prefix_pattern = r"(?:^|\n)\s*(?:تگ[‌\s]*ها?|برچسب[‌\s]*ها?|tags?)\s*[:：]\s*(.+?)(?=\n|$)"
    for line_match in re.findall(prefix_pattern, caption, flags=re.IGNORECASE):
        for part in re.split(r"[,،;؛\s]+", line_match):
            tag = part.strip().lstrip("#")[:40]
            key = tag.casefold()
            if tag and key not in seen and key not in excluded:
                cleaned.append(tag)
                seen.add(key)
    return cleaned[:20]


CAPTION_DIRECTIVE_RE = re.compile(
    r"^\s*\[(کشو|پوشه|folder|نام|title|تگ(?:‌|\s)*ها?|برچسب(?:‌|\s)*ها?|tags?|توضیح|description)\s*[:：=]\s*(.*?)\]\s*$",
    flags=re.IGNORECASE,
)


def parse_file_caption(caption: str | None, excluded_tags: list[str] | None = None) -> dict[str, object]:
    """Parse upload directives and return clean user-facing metadata."""
    values: dict[str, object] = {"folder": None, "title": None, "description": None, "tags": []}
    remaining: list[str] = []
    explicit_description: list[str] = []
    explicit_tags: list[str] = []
    for line in (caption or "").splitlines():
        match = CAPTION_DIRECTIVE_RE.match(line)
        if not match:
            remaining.append(line)
            continue
        raw_key, raw_value = match.groups()
        key = re.sub(r"[‌\s]", "", raw_key).casefold()
        value = raw_value.strip()
        if key in {"کشو", "پوشه", "folder"}:
            values["folder"] = value[:255] or None
        elif key in {"نام", "title"}:
            values["title"] = value[:240] or None
        elif key in {"تگ", "تگها", "برچسب", "برچسبها", "tag", "tags"}:
            explicit_tags.extend(part.strip().lstrip("#") for part in re.split(r"[,،;؛]+", value))
        elif key in {"توضیح", "description"} and value:
            explicit_description.append(value)
    clean_caption = "\n".join(remaining).strip()
    description = "\n".join(explicit_description).strip() if explicit_description else clean_caption
    tags: list[str] = []
    seen: set[str] = set()
    for tag in [*explicit_tags, *extract_tags_from_caption(clean_caption, excluded_tags)]:
        clean_tag = tag.strip()[:40]
        key = clean_tag.casefold()
        if clean_tag and key not in seen:
            tags.append(clean_tag)
            seen.add(key)
    values.update(description=description[:1024] or None, tags=tags[:20], clean_caption=clean_caption)
    return values
