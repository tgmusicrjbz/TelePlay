from types import SimpleNamespace

from app.routers.streaming import playable_message_media


def test_video_note_is_a_playable_stream_source():
    note = SimpleNamespace(file_size=1200, mime_type="video/mp4")
    message = SimpleNamespace(video=None, video_note=note, audio=None, voice=None, document=None)
    assert playable_message_media(message) is note


def test_document_remains_a_playable_stream_source():
    document = SimpleNamespace(file_size=1200, mime_type="video/mp4")
    message = SimpleNamespace(video=None, video_note=None, audio=None, voice=None, document=document)
    assert playable_message_media(message) is document
