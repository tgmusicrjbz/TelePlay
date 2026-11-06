"""Browser security headers shared by API and SPA responses."""

from __future__ import annotations


_CSP_DIRECTIVES = (
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "form-action 'self'",
    "script-src 'self' https://telegram.org https://*.google.com https://*.googleapis.com https://*.gstatic.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob: https:",
    "connect-src 'self' https: ws: wss:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'self' https://*.google.com https://*.googleapis.com",
)


def content_security_policy(*, secure: bool) -> str:
    directives = list(_CSP_DIRECTIVES)
    if secure:
        directives.append("upgrade-insecure-requests")
    return "; ".join(directives)


def browser_security_headers(path: str, *, secure: bool) -> dict[str, str]:
    headers = {
        "Content-Security-Policy": content_security_policy(secure=secure),
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "no-referrer",
        "Permissions-Policy": "camera=(), microphone=(self), geolocation=(), payment=()",
    }
    if secure:
        headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    if path.startswith("/api/auth"):
        headers["Cache-Control"] = "no-store"
    return headers
