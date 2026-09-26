"""Helpers for extracting embedded artwork before Telegram thumbnail fallback."""
from io import BytesIO
from pathlib import Path

try:
    from mutagen import File as MutagenFile
except ImportError:  # pragma: no cover - dependency is installed in deployment
    MutagenFile = None


def extract_embedded_cover(source: str | Path | BytesIO) -> bytes | None:
    if MutagenFile is None:
        return None
    try:
        audio = MutagenFile(source, easy=False)
        if audio is None:
            return None
        tags = getattr(audio, "tags", None)
        if tags:
            for value in tags.values():
                data = getattr(value, "data", None)
                if data:
                    return bytes(data)
        pictures = getattr(audio, "pictures", None)
        if pictures:
            return bytes(pictures[0].data)
    except Exception:
        return None
    return None
