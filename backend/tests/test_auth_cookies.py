import os
import tempfile
import unittest
from pathlib import Path

_temp = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = f"sqlite+aiosqlite:///{(Path(_temp.name) / 'auth-cookie.sqlite').as_posix()}"
os.environ["TELEGRAM_API_ID"] = "12345"
os.environ["TELEGRAM_API_HASH"] = "test-hash"
os.environ["TELEGRAM_BOT_TOKEN"] = "test-token"
os.environ["TELEGRAM_STORAGE_CHANNEL_ID"] = "-1001234567890"
os.environ["JWT_SECRET"] = "test-secret"

from fastapi import Request, Response

from app.routers.auth import (
    _clear_refresh_cookie,
    _refresh_cookie_name,
    _set_refresh_cookie,
)
from app.schemas import RefreshTokenRequest, Token


def request(*, secure: bool = True) -> Request:
    headers = [(b"x-forwarded-proto", b"https")] if secure else []
    return Request({
        "type": "http",
        "method": "POST",
        "scheme": "http",
        "path": "/api/auth/refresh",
        "headers": headers,
        "client": ("127.0.0.1", 1234),
        "server": ("testserver", 80),
    })


class RefreshCookieTests(unittest.TestCase):
    def test_cookie_is_account_scoped_http_only_and_secure(self):
        response = Response()
        _set_refresh_cookie(response, request(), -123, "secret-token")

        cookie = response.headers["set-cookie"]
        self.assertIn("komod_refresh_n123=secret-token", cookie)
        self.assertIn("HttpOnly", cookie)
        self.assertIn("Secure", cookie)
        self.assertIn("SameSite=lax", cookie)
        self.assertIn("Path=/api/auth", cookie)

    def test_local_http_cookie_is_not_marked_secure(self):
        response = Response()
        _set_refresh_cookie(response, request(secure=False), 456, "local-token")
        self.assertNotIn("Secure", response.headers["set-cookie"])

    def test_clear_cookie_uses_the_same_name_and_path(self):
        response = Response()
        _clear_refresh_cookie(response, request(), 456)
        cookie = response.headers["set-cookie"]
        self.assertIn(f"{_refresh_cookie_name(456)}=", cookie)
        self.assertIn("Max-Age=0", cookie)
        self.assertIn("Path=/api/auth", cookie)

    def test_refresh_request_accepts_new_and_legacy_field_names(self):
        modern = RefreshTokenRequest.model_validate({"account_id": 11, "refresh_token": "old"})
        legacy = RefreshTokenRequest.model_validate({"accountId": 12, "refreshToken": "older"})
        self.assertEqual((modern.account_id, modern.refresh_token), (11, "old"))
        self.assertEqual((legacy.account_id, legacy.refresh_token), (12, "older"))

    def test_refresh_token_is_omitted_when_serializing_new_responses(self):
        token = Token(access_token="access")
        self.assertNotIn("refresh_token", token.model_dump(exclude_none=True))


if __name__ == "__main__":
    unittest.main()
