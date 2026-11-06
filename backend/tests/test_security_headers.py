from app.security_headers import browser_security_headers, content_security_policy


def test_csp_blocks_inline_scripts_and_untrusted_frames():
    policy = content_security_policy(secure=False)
    assert "default-src 'self'" in policy
    assert "object-src 'none'" in policy
    assert "frame-ancestors 'self'" in policy
    assert "script-src 'self' https://telegram.org" in policy
    assert "'unsafe-inline'" not in policy.split("script-src", 1)[1].split(";", 1)[0]
    assert "upgrade-insecure-requests" not in policy


def test_https_and_auth_responses_get_stricter_headers():
    headers = browser_security_headers("/api/auth/me", secure=True)
    assert headers["Cache-Control"] == "no-store"
    assert headers["Strict-Transport-Security"].startswith("max-age=31536000")
    assert headers["Content-Security-Policy"].endswith("upgrade-insecure-requests")
    assert headers["Permissions-Policy"] == "camera=(), microphone=(self), geolocation=(), payment=()"
