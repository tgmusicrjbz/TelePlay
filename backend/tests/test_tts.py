"""Unit tests for the Gemini TTS queue's deterministic building blocks."""
import io
import base64
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

from app.database import Base, async_session, engine
from app.models import AppSetting, TTSUsage, User
from app.routers.tts import AI_MODEL_CATALOG_KEY, _clean_model_ids, load_model_catalog
from app.tts import DIRECTOR_NOTES_SYSTEM_INSTRUCTION, GeminiRequestError, GeminiTTSProvider, TTSJob, TTSQueue, build_interaction_content, consume_tts_quota, extract_interaction_audio, merge_wav, normalize_director_notes, normalize_tts_settings, route_ai_model, split_long_text


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
        preferences = normalize_tts_settings({"voice": "unknown", "speed": 9, "style": " آرام ", "folder_id": "42", "use_case": "podcast"})
        self.assertEqual(preferences["voice"], "Kore")
        self.assertEqual(preferences["speed"], 2)
        self.assertEqual(preferences["style"], "آرام")
        self.assertEqual(preferences["folder_id"], 42)
        self.assertEqual(preferences["use_case"], "podcast")

    def test_tts_model_is_allowlisted_and_lite_model_is_available(self):
        self.assertEqual(normalize_tts_settings({"model": "gemini-3.8-flash-lite-tts"})["model"], "gemini-3.8-flash-lite-tts")
        self.assertEqual(normalize_tts_settings({"model": "made-up-model"})["model"], "gemini-3.8-flash-tts")

    def test_stt_and_text_models_are_allowlisted(self):
        preferences = normalize_tts_settings({"stt_model": "gemini-3.5-transcribe", "stt_mode": "smart", "text_model": "unknown"})
        self.assertEqual(preferences["stt_model"], "gemini-3.5-transcribe")
        self.assertEqual(preferences["stt_mode"], "smart")
        self.assertEqual(preferences["text_model"], "gemini-3.8-flash")

    def test_custom_models_are_account_scoped_and_manual_only(self):
        preferences = normalize_tts_settings({
            "ai_routing_mode": "manual", "custom_text_models": ["my-project/text-v2"],
            "text_model": "my-project/text-v2",
        })
        self.assertEqual(preferences["text_model"], "my-project/text-v2")
        self.assertEqual(route_ai_model(preferences, "text", 20), "my-project/text-v2")

    def test_auto_routing_uses_workload_to_control_cost(self):
        preferences = normalize_tts_settings({"ai_routing_mode": "auto"})
        self.assertEqual(route_ai_model(preferences, "text", 500), "gemini-3.5-flash-lite")
        self.assertEqual(route_ai_model(preferences, "text", 20_000), "gemini-3.8-flash")
        self.assertEqual(route_ai_model(preferences, "stt", 120), "gemini-3.5-flash-lite")
        self.assertEqual(route_ai_model(preferences, "stt", 1_200), "gemini-3.8-flash")

    def test_legacy_scoped_tags_become_director_notes(self):
        content = build_interaction_content("شروع <whisper>این بخش آرام است.</whisper> پایان", "روان")
        self.assertEqual(content[0]["text"], "شروع [whispering]این بخش آرام است.[resumes normal speech] پایان")
        self.assertTrue(content[0]["annotations"][0]["style"].startswith("روان; "))
        self.assertIn("Do not speak", content[0]["annotations"][0]["style"])
        self.assertNotIn("<", content[0]["text"])

    def test_point_cues_are_kept_verbatim(self):
        content = build_interaction_content("سلام <laugh> دنیا", "طبیعی")
        self.assertEqual(content[0]["text"], "سلام [chuckle] دنیا")

    def test_all_legacy_tags_are_normalized_without_angle_brackets(self):
        result = normalize_director_notes("<phew> <laughter> <story>قصه</story>")
        self.assertEqual(result, "[relieved sigh] [laughs] [storytelling]قصه[resumes normal speech]")
        self.assertNotIn("<", result)
        self.assertNotIn(">", result)

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

    async def test_bad_request_reports_the_request_problem_instead_of_all_keys_failed(self):
        provider = GeminiTTSProvider(["first", "second"])

        async def fake_request(_key, _text, _preferences):
            raise GeminiRequestError(400, '{"error":{"message":"unsupported speech tag"}}')

        provider._request = fake_request
        with self.assertRaisesRegex(RuntimeError, "unsupported speech tag"):
            await provider.synthesize("<unknown>سلام", normalize_tts_settings({}))

    async def test_preview_output_stays_temporary_and_is_streamable(self):
        class Provider:
            api_keys = ["test"]

            async def synthesize(self, _text, _preferences):
                return wav_with_frames(b"\x01\x00" * 4)

        queue = TTSQueue(Provider())
        job = TTSJob(
            user_id=1, telegram_id=2, text="سلام", title="نمونه", folder_id=None,
            preferences=normalize_tts_settings({}), output_mode="preview", id="preview-job",
        )
        queue.statuses[job.id] = {"id": job.id, "user_id": 1, "state": "queued", "created_at": "2026-01-01T00:00:00"}
        queue.controls[job.id] = {"paused": False, "cancelled": False}
        await queue._process(job)
        self.assertEqual(queue.statuses[job.id]["state"], "done")
        self.assertEqual(queue.statuses[job.id]["stream_url"], "/api/tts/jobs/preview-job/audio")
        self.assertTrue(queue.audio_outputs[job.id].startswith(b"RIFF"))

    async def test_gemini_38_uses_interactions_and_keeps_transcript_verbatim(self):
        provider = GeminiTTSProvider(["key"])
        expected = wav_with_frames(b"\x03\x00" * 8)
        captured = {}

        def fake_request(endpoint, payload):
            captured.update(endpoint=endpoint, payload=payload)
            return {
                "status": "completed",
                "steps": [{
                    "type": "model_output",
                    "content": [{"type": "audio", "data": base64.b64encode(expected).decode("ascii"), "mime_type": "audio/wav"}],
                }],
            }

        provider._request_sync = fake_request
        preferences = normalize_tts_settings({"model": "gemini-3.8-flash-tts", "style": "آرام"})
        result = await provider._request("key", "متن اصلی", preferences)
        self.assertEqual(result, expected)
        self.assertIn("/v1beta/interactions", captured["endpoint"])
        text_part = captured["payload"]["input"][0]["content"][0]
        self.assertEqual(text_part["text"], "متن اصلی")
        self.assertEqual(text_part["annotations"][0]["type"], "speech_metadata")
        self.assertNotIn("system_instruction", captured["payload"])
        self.assertIn("Do not speak", text_part["annotations"][0]["style"])

    async def test_gemini_38_sends_director_notes_without_unsupported_system_instruction(self):
        provider = GeminiTTSProvider(["key"])
        expected = wav_with_frames(b"\\x05\\x00" * 8)
        payloads = []

        def fake_request(_endpoint, payload):
            payloads.append(payload)
            return {
                "status": "completed",
                "steps": [{
                    "type": "model_output",
                    "content": [{"type": "audio", "data": base64.b64encode(expected).decode("ascii"), "mime_type": "audio/wav"}],
                }],
            }

        provider._request_sync = fake_request
        preferences = normalize_tts_settings({"model": "gemini-3.8-flash-tts"})
        result = await provider._request("key", "سلام <laugh>", preferences)

        self.assertEqual(result, expected)
        self.assertEqual(len(payloads), 1)
        self.assertNotIn("system_instruction", payloads[0])
        text_part = payloads[0]["input"][0]["content"][0]
        self.assertEqual(text_part["text"], "سلام [chuckle]")
        self.assertIn("Do not speak", text_part["annotations"][0]["style"])

    def test_interaction_audio_supports_sdk_convenience_shape(self):
        expected = wav_with_frames(b"\x04\x00" * 4)
        raw, mime_type = extract_interaction_audio({
            "interaction": {"outputAudio": {"type": "audio", "data": base64.b64encode(expected).decode("ascii"), "mimeType": "audio/wav"}}
        })
        self.assertEqual(raw, expected)
        self.assertEqual(mime_type, "audio/wav")

    def test_finished_history_can_be_dismissed_or_cleared(self):
        queue = TTSQueue(GeminiTTSProvider([]))
        queue.statuses = {
            "done": {"id": "done", "user_id": 1, "state": "done", "created_at": "2026-01-01T00:00:00", "finished_at": "2026-01-01T00:00:00"},
            "active": {"id": "active", "user_id": 1, "state": "queued", "created_at": "2026-01-01T00:00:00"},
            "other": {"id": "other", "user_id": 2, "state": "done", "created_at": "2026-01-01T00:00:00", "finished_at": "2026-01-01T00:00:00"},
        }
        queue.controls = {key: {"paused": False, "cancelled": False} for key in queue.statuses}
        self.assertFalse(queue.dismiss("active", 1))
        self.assertTrue(queue.dismiss("done", 1))
        self.assertEqual(queue.clear_finished(1), 0)
        self.assertIn("active", queue.statuses)
        self.assertIn("other", queue.statuses)


class TTSQuotaTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)
        async with async_session() as db:
            user = User(telegram_id=991100)
            db.add(user)
            await db.commit()
            await db.refresh(user)
            self.user_id = user.id

    async def test_daily_limit_and_character_limit_are_enforced(self):
        async with async_session() as db:
            db.add(TTSUsage(user_id=self.user_id, daily_limit=1, max_chars=10))
            await db.commit()
            usage = await consume_tts_quota(db, self.user_id, 5)
            self.assertEqual((usage.used_today, usage.total_jobs, usage.total_chars), (1, 1, 5))
            with self.assertRaisesRegex(ValueError, "سهمیه روزانه"):
                await consume_tts_quota(db, self.user_id, 5)
        async with async_session() as db:
            usage = await db.get(TTSUsage, self.user_id)
            usage.daily_limit = 0
            await db.commit()
            with self.assertRaisesRegex(ValueError, "طول متن"):
                await consume_tts_quota(db, self.user_id, 11)

    async def test_model_cost_consumes_weighted_quota(self):
        async with async_session() as db:
            db.add(TTSUsage(user_id=self.user_id, daily_limit=3, max_chars=100))
            await db.commit()
            usage = await consume_tts_quota(db, self.user_id, 10, cost=2)
            self.assertEqual(usage.used_today, 2)
            self.assertEqual(usage.total_jobs, 1)
            with self.assertRaisesRegex(ValueError, "سهمیه روزانه"):
                await consume_tts_quota(db, self.user_id, 10, cost=2)


class AIModelCatalogTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
            await connection.run_sync(Base.metadata.create_all)

    def test_model_ids_are_trimmed_deduplicated_and_limited(self):
        values = ["  custom/model  ", "custom/model", *[f"model-{index}" for index in range(20)]]
        cleaned = _clean_model_ids(values)
        self.assertEqual(cleaned[0], "custom/model")
        self.assertEqual(len(cleaned), 12)

    async def test_catalog_is_loaded_from_global_app_setting(self):
        async with async_session() as db:
            db.add(AppSetting(key=AI_MODEL_CATALOG_KEY, value='{"tts_models":["voice/custom"],"stt_models":["speech/custom"],"text_models":[]}'))
            await db.commit()
            catalog = await load_model_catalog(db)
        self.assertEqual(catalog["tts_models"], ["voice/custom"])
        self.assertEqual(catalog["stt_models"], ["speech/custom"])


if __name__ == "__main__":
    unittest.main()
