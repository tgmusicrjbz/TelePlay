"""Small, dependency-free helpers for encrypted TOTP authentication."""
import base64
import hashlib
import hmac
import json
import secrets
import struct
import time
from urllib.parse import quote

from .encrypted_data import decrypt_value, encrypt_value


def new_totp_secret() -> str:
    return base64.b32encode(secrets.token_bytes(20)).decode().rstrip("=")


def encrypt_secret(secret: str) -> str:
    return encrypt_value(secret, context="komod-2fa")


def decrypt_secret(value: str | None) -> str | None:
    if not value:
        return None
    return decrypt_value(value, context="komod-2fa")


def setup_token(secret: str, lifetime_seconds: int = 600) -> str:
    payload = {"secret": secret, "exp": int(time.time()) + lifetime_seconds}
    return encrypt_value(json.dumps(payload), context="komod-2fa")


def secret_from_setup_token(value: str) -> str | None:
    try:
        decrypted = decrypt_value(value, context="komod-2fa")
        if not decrypted:
            return None
        payload = json.loads(decrypted)
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return str(payload["secret"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return None


def totp_code(secret: str, timestamp: int | None = None) -> str:
    padded = secret + "=" * ((8 - len(secret) % 8) % 8)
    key = base64.b32decode(padded, casefold=True)
    counter = int(timestamp if timestamp is not None else time.time()) // 30
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    value = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000
    return f"{value:06d}"


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    normalized = "".join(char for char in str(code) if char.isdigit())
    if len(normalized) != 6:
        return False
    now = int(time.time())
    return any(hmac.compare_digest(totp_code(secret, now + offset * 30), normalized) for offset in range(-window, window + 1))


def provisioning_uri(secret: str, account: str) -> str:
    label = quote(f"Komod:{account}")
    return f"otpauth://totp/{label}?secret={secret}&issuer=Komod&digits=6&period=30"
