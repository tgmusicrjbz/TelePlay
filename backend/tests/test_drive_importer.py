from app.drive_importer import _detect_type, extract_google_drive_file_id


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
