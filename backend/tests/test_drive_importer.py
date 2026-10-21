from app.drive_importer import _detect_type, _response_filename, extract_google_drive_file_id
from app.google_drive import decrypt_credentials, encrypt_credentials


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


def test_decodes_persian_rfc5987_filename():
    headers={"Content-Disposition":"attachment; filename*=UTF-8''%D8%A2%D9%87%D9%86%DA%AF%20%D8%AA%D8%B3%D8%AA.mp3"}
    assert _response_filename(headers,"fallback") == "آهنگ تست.mp3"


def test_repairs_utf8_filename_exposed_as_latin1():
    mojibake="آهنگ فارسی.mp3".encode("utf-8").decode("latin-1")
    assert _response_filename({"Content-Disposition":f'attachment; filename="{mojibake}"'},"fallback") == "آهنگ فارسی.mp3"
