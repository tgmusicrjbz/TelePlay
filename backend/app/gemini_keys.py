"""Encrypt user supplied Gemini keys at rest.

The application server must decrypt a key to call Gemini. Encryption protects
database backups and read-only database access; it does not make the key
invisible to an operator who controls the running server.
"""
import base64
import hashlib
import json
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings


def _cipher() -> Fernet:
    digest = hashlib.sha256((get_settings().jwt_secret + ":gemini-user-keys:v1").encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_user_keys(keys: list[str]) -> str | None:
    cleaned = list(dict.fromkeys(key.strip() for key in keys if key.strip()))[:8]
    if not cleaned:
        return None
    return _cipher().encrypt(json.dumps(cleaned).encode()).decode()


def decrypt_user_keys(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        decoded = json.loads(_cipher().decrypt(value.encode()).decode())
        return [str(key) for key in decoded if isinstance(key, str) and key]
    except (InvalidToken, ValueError, TypeError, json.JSONDecodeError):
        return []


def check_gemini_key(key: str, model: str = "gemini-3.8-flash", timeout: float = 12) -> dict:
    """Validate one key without running a billable generation request."""
    masked = f"••••{key[-4:]}"
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{quote(model, safe='')}?key={quote(key, safe='')}"
    try:
        with urlopen(Request(endpoint, headers={"Accept": "application/json"}), timeout=timeout) as response:
            if 200 <= response.status < 300:
                return {"masked": masked, "status": "healthy", "message": "آماده استفاده است."}
    except HTTPError as error:
        if error.code == 429:
            return {"masked": masked, "status": "limited", "message": "فعلاً به محدودیت درخواست رسیده است."}
        if error.code in {401, 403}:
            return {"masked": masked, "status": "denied", "message": "کلید رد شد یا دسترسی Gemini ندارد."}
        if error.code == 404:
            return {"masked": masked, "status": "healthy", "message": "کلید معتبر است؛ این مدل در پروژه فعال نیست."}
        return {"masked": masked, "status": "error", "message": f"پاسخ ناموفق سرویس ({error.code})."}
    except (URLError, TimeoutError, OSError):
        return {"masked": masked, "status": "unreachable", "message": "ارتباط با Gemini برقرار نشد؛ دوباره امتحان کن."}
    return {"masked": masked, "status": "error", "message": "وضعیت کلید مشخص نشد."}
