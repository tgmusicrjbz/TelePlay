import hashlib
import hmac
from datetime import datetime, timedelta

from app.instagram_inbox import extract_shared_posts, extract_text_messages, normalize_instagram_post_url, verify_meta_signature
from app.models import InstagramInboxSender
from app.routers.instagram import daily_usage_start, quota_limit_reason


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


def test_extract_text_messages_keeps_commands_and_ignores_shared_post_text():
    payload = {
        "object": "instagram",
        "entry": [{"messaging": [
            {"sender": {"id": "sender"}, "message": {"mid": "command-1", "text": "مقصد ۲"}},
            {"sender": {"id": "sender"}, "message": {"mid": "post-1", "text": "https://instagram.com/p/ABC/"}},
        ]}],
    }
    assert extract_text_messages(payload) == [{
        "sender_id": "sender", "event_id": "command-1", "text": "مقصد ۲",
    }]


def test_webhook_signature_formula_matches_meta_sha256_header():
    raw = b'{"object":"instagram"}'
    secret = "app-secret"
    expected = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    signature = "sha256=f9f60d2fd6f1498ad1636cf26d6916018f8c80c0a4ac67169c9499d510ee1762"
    assert hmac.compare_digest(expected, signature)
    assert verify_meta_signature(raw, signature, secret)
    assert not verify_meta_signature(raw + b" ", signature, secret)


def test_daily_usage_reset_only_moves_the_current_day_boundary_forward():
    now = datetime(2026, 10, 27, 18, 30)
    sender = InstagramInboxSender(instagram_user_id="sender", pairing_code="ABCDEFGH")
    assert daily_usage_start(sender, now) == datetime(2026, 10, 27)
    sender.daily_quota_reset_at = now - timedelta(hours=2)
    assert daily_usage_start(sender, now) == datetime(2026, 10, 27, 16, 30)
    sender.daily_quota_reset_at = now - timedelta(days=1)
    assert daily_usage_start(sender, now) == datetime(2026, 10, 27)


def test_instagram_quota_checks_hourly_before_daily_and_zero_is_unlimited():
    sender = InstagramInboxSender(
        instagram_user_id="sender", pairing_code="ABCDEFGH",
        hourly_limit=2, daily_limit=5, monthly_limit=20,
    )
    assert quota_limit_reason(sender, 1, 4, 19) is None
    assert quota_limit_reason(sender, 2, 5, 20) == "hourly"
    sender.hourly_limit = 0
    assert quota_limit_reason(sender, 99, 5, 20) == "daily"
    sender.daily_limit = 0
    assert quota_limit_reason(sender, 99, 99, 20) == "monthly"
    sender.monthly_limit = 0
    assert quota_limit_reason(sender, 99, 99, 99) is None
