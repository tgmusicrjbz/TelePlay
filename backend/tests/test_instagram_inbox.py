import hashlib
import hmac

from app.instagram_inbox import extract_shared_posts, normalize_instagram_post_url, verify_meta_signature


def test_normalize_instagram_post_url_accepts_posts_and_drops_tracking():
    assert normalize_instagram_post_url("https://instagram.com/reel/ABC123/?igsh=secret") == "https://www.instagram.com/reel/ABC123/"
    assert normalize_instagram_post_url("see https://www.instagram.com/p/Post42 now") == "https://www.instagram.com/p/Post42/"


def test_normalize_instagram_post_url_rejects_profiles_and_lookalike_hosts():
    assert normalize_instagram_post_url("https://instagram.com/example") is None
    assert normalize_instagram_post_url("https://instagram.com.evil.test/p/ABC") is None


def test_extract_shared_posts_handles_meta_share_attachment_and_deduplicates_urls():
    payload = {
        "object": "instagram",
        "entry": [{
            "messaging": [{
                "sender": {"id": "ig-scoped-user"},
                "message": {
                    "mid": "message-1",
                    "text": "https://www.instagram.com/p/ABC/?utm_source=test",
                    "attachments": [{"type": "share", "payload": {"url": "https://instagram.com/p/ABC/"}}],
                },
            }],
        }],
    }
    assert extract_shared_posts(payload) == [{
        "sender_id": "ig-scoped-user",
        "event_id": "message-1:0",
        "url": "https://www.instagram.com/p/ABC/",
    }]


def test_webhook_signature_formula_matches_meta_sha256_header():
    raw = b'{"object":"instagram"}'
    secret = "app-secret"
    expected = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    signature = "sha256=f9f60d2fd6f1498ad1636cf26d6916018f8c80c0a4ac67169c9499d510ee1762"
    assert hmac.compare_digest(expected, signature)
    assert verify_meta_signature(raw, signature, secret)
    assert not verify_meta_signature(raw + b" ", signature, secret)
