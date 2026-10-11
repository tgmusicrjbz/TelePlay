"""Unit tests for the Gemini TTS queue's deterministic building blocks."""
import io
import os
import sys
import tempfile
import unittest
import wave
from pathlib import Path

_temp = tempfile.TemporaryDirectory()
os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{(Path(_temp.name) / 'tts.sqlite').as_posix()}")
os.environ.setdefault("TELEGRAM_API_ID", "12345")
os.environ.setdefault("TELEGRAM_API_HASH", "test-hash")
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("TELEGRAM_STORAGE_CHANNEL_ID", "-1001234567890")
os.environ.setdefault("JWT_SECRET", "test-secret")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.tts import GeminiRequestError, GeminiTTSProvider, merge_wav, normalize_tts_settings, split_long_text


def wav_with_frames(frames: bytes, rate: int = 24000) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as target:
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(rate)
        target.writeframes(frames)
    return output.getvalue()


class TTSHelpersTests(unittest.IsolatedAsyncioTestCase):
    def test_long_text_is_split_without_losing_words(self):
        source = "جمله اول خیلی کوتاه است. جمله دوم برای آزمایش تقسیم متن نوشته شده است.\n\nپاراگراف سوم هم باقی می‌ماند."
        chunks = split_long_text(source, max_chars=45)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk) <= 45 for chunk in chunks))
        source_words = source.split()
        chunk_words = " ".join(chunks).split()
        self.assertEqual(source_words, chunk_words)

    def test_wav_chunks_are_merged_in_order(self):
        first = b"\x01\x00" * 10
        second = b"\x02\x00" * 12
        merged = merge_wav([wav_with_frames(first), wav_with_frames(second)])
        with wave.open(io.BytesIO(merged), "rb") as result:
            self.assertEqual(result.getframerate(), 24000)
            self.assertEqual(result.readframes(result.getnframes()), first + second)

    def test_preferences_are_bounded_and_unknown_voice_is_replaced(self):
        preferences = normalize_tts_settings({"voice": "unknown", "speed": 9, "style": " آرام "})
        self.assertEqual(preferences["voice"], "Kore")
        self.assertEqual(preferences["speed"], 2)
        self.assertEqual(preferences["style"], "آرام")

    async def test_provider_rotates_to_next_key_after_rate_limit(self):
        provider = GeminiTTSProvider(["first", "second"])
        calls = []

        async def fake_request(key, _text, _preferences):
            calls.append(key)
            if key == "first":
                raise GeminiRequestError(429, "limited")
            return wav_with_frames(b"\x00\x00")

        provider._request = fake_request
        result = await provider.synthesize("سلام", normalize_tts_settings({}))
        self.assertTrue(result.startswith(b"RIFF"))
        self.assertEqual(calls, ["first", "second"])


if __name__ == "__main__":
    unittest.main()
