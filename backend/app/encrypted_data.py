"""Versioned encryption for persistent user secrets.

Legacy values were derived directly from JWT_SECRET. The key ring keeps those
values readable while DATA_ENCRYPTION_KEY is introduced and keys are rotated.
"""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken

from .config import get_settings


PREFIX = "komod:v2"


def _configured_roots() -> list[str]:
    settings = get_settings()
    active = settings.data_encryption_key.strip() or settings.jwt_secret
    previous = settings.data_encryption_previous_keys.replace("\r", "\n").replace(",", "\n").split("\n")
    return list(dict.fromkeys([active, *(item.strip() for item in previous if item.strip()), settings.jwt_secret]))


def _key_id(root: str) -> str:
    return hashlib.sha256(root.encode()).hexdigest()[:12]


def _cipher(root: str, context: str) -> Fernet:
    digest = hashlib.sha256(f"{root}:{context}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_value(value: str, *, context: str) -> str:
    root = _configured_roots()[0]
    token = _cipher(root, context).encrypt(value.encode()).decode()
    return f"{PREFIX}:{_key_id(root)}:{token}"


def decrypt_value(value: str | None, *, context: str) -> str | None:
    if not value:
        return None
    roots = _configured_roots()
    token = value
    candidates = roots
    if value.startswith(f"{PREFIX}:"):
        parts = value.split(":", 3)
        if len(parts) != 4:
            return None
        key_id, token = parts[2], parts[3]
        candidates = [root for root in roots if _key_id(root) == key_id]
        if not candidates:
            return None
    for root in candidates:
        try:
            return _cipher(root, context).decrypt(token.encode()).decode()
        except (InvalidToken, ValueError):
            continue
    return None


def needs_rotation(value: str | None) -> bool:
    if not value:
        return False
    active_id = _key_id(_configured_roots()[0])
    return not value.startswith(f"{PREFIX}:{active_id}:")


def rotate_value(value: str | None, *, context: str) -> str | None:
    if not value or not needs_rotation(value):
        return value
    plaintext = decrypt_value(value, context=context)
    return encrypt_value(plaintext, context=context) if plaintext is not None else None
