"""Encrypt user supplied Gemini keys at rest.

The application server must decrypt a key to call Gemini. Encryption protects
database backups and read-only database access; it does not make the key
invisible to an operator who controls the running server.
"""
import base64
import hashlib
import json

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
