import unittest
from pathlib import Path

from app.media_studio import build_ffmpeg_command, output_extension


class MediaStudioCommandTests(unittest.TestCase):
    def test_video_command_uses_allowlisted_settings(self):
        command=build_ffmpeg_command("compress",[Path("input.mp4")],Path("output.mp4"),"video",{
            "codec":"h264","resolution":720,"fps":30,"crf":22,"audio_bitrate":160,
        })
        self.assertIn("libx264",command)
        self.assertIn("scale=-2:min(720\\,ih),fps=30",command)
        self.assertEqual(command[-1],"output.mp4")

    def test_extract_audio_rejects_video_extension(self):
        self.assertEqual(output_extension("extract_audio","video",{"format":"mp4"}),"mp3")
        self.assertEqual(output_extension("extract_audio","video",{"format":"flac"}),"flac")

    def test_trim_is_bounded_and_has_duration(self):
        command=build_ffmpeg_command("trim",[Path("input.mp3")],Path("output.mp3"),"audio",{"start":12,"end":20})
        self.assertIn("12.000",command)
        self.assertIn("8.000",command)

    def test_merge_does_not_accept_raw_arguments(self):
        command=build_ffmpeg_command("merge",[Path("a.mp3"),Path("b.mp3")],Path("out.mp3"),"audio",{"raw":"-dangerous"})
        self.assertNotIn("-dangerous",command)
        self.assertTrue(any("concat=n=2:v=0:a=1[out]" in item for item in command))
