from app.drive_importer import _detect_type, _response_filename, extract_google_drive_file_id
from app.google_drive import credential_accounts, decode_state, decrypt_credentials, encrypt_account_store, encrypt_credentials, settings
from jose import jwt
import time


def test_extracts_file_id_from_google_drive_file_link():
    assert extract_google_drive_file_id(
        "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUv/view?usp=sharing"
    ) == "1AbCdEfGhIjKlMnOpQrStUv"


def test_extracts_file_id_from_google_drive_open_link():
    assert extract_google_drive_file_id(
        "https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUv"
    ) == "1AbCdEfGhIjKlMnOpQrStUv"


def test_rejects_non_drive_and_folder_links():
    assert extract_google_drive_file_id("https://example.com/file/d/1AbCdEfGhIjKlMnOpQrStUv") is None
    assert extract_google_drive_file_id("https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv") is None


def test_detects_common_media_types():
    assert _detect_type("track.mp3", None) == "audio"
    assert _detect_type("clip", "video/mp4") == "video"
    assert _detect_type("note.md", None) == "text"


def test_google_credentials_are_encrypted_at_rest():
    raw={"access_token":"secret-access","refresh_token":"secret-refresh","expires_at":123}
    encrypted=encrypt_credentials(raw)
    assert "secret-access" not in encrypted
    assert decrypt_credentials(encrypted)==raw


def test_google_account_store_supports_multiple_accounts_and_legacy_tokens():
    accounts=[{"email":"one@example.com","mode":"picker","refresh_token":"one"},{"email":"two@example.com","mode":"full","refresh_token":"two"}]
    encrypted=encrypt_account_store(accounts,"two@example.com|full")
    assert credential_accounts(encrypted)==(accounts,"two@example.com|full")
    legacy=encrypt_credentials({"refresh_token":"old"})
    assert credential_accounts(legacy,"legacy@example.com")[1]=="legacy@example.com|full"


def test_google_account_store_keeps_picker_and_full_for_same_email():
    accounts=[{"email":"same@example.com","mode":"picker"},{"email":"same@example.com","mode":"full"}]
    encrypted=encrypt_account_store(accounts,"same@example.com|picker")
    stored,active=credential_accounts(encrypted)
    assert len(stored)==2
    assert active=="same@example.com|picker"


def test_decodes_persian_rfc5987_filename():
    headers={"Content-Disposition":"attachment; filename*=UTF-8''%D8%A2%D9%87%D9%86%DA%AF%20%D8%AA%D8%B3%D8%AA.mp3"}
    assert _response_filename(headers,"fallback") == "آهنگ تست.mp3"


def test_repairs_utf8_filename_exposed_as_latin1():
    mojibake="آهنگ فارسی.mp3".encode("utf-8").decode("latin-1")
    assert _response_filename({"Content-Disposition":f'attachment; filename="{mojibake}"'},"fallback") == "آهنگ فارسی.mp3"


def test_google_oauth_state_preserves_connection_mode():
    state=jwt.encode({"sub":"42","purpose":"google-drive","mode":"picker","exp":int(time.time())+60},settings.jwt_secret,algorithm="HS256")
    assert decode_state(state)==(42,"picker")


def test_legacy_google_oauth_state_defaults_to_full_access():
    state=jwt.encode({"sub":"7","purpose":"google-drive","exp":int(time.time())+60},settings.jwt_secret,algorithm="HS256")
    assert decode_state(state)==(7,"full")
