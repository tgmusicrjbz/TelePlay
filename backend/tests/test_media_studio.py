import shutil
import subprocess
import tempfile
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

    def test_output_extension_never_crosses_media_type(self):
        self.assertEqual(output_extension("compress","audio",{"format":"mp4"}),"mp3")
        self.assertEqual(output_extension("compress","image",{"format":"mp4"}),"webp")
        self.assertEqual(output_extension("convert","video",{"format":"mp3"}),"mp4")

    def test_trim_is_bounded_and_has_duration(self):
        command=build_ffmpeg_command("trim",[Path("input.mp3")],Path("output.mp3"),"audio",{"start":12,"end":20})
        self.assertIn("12.000",command)
        self.assertIn("8.000",command)

    def test_merge_does_not_accept_raw_arguments(self):
        command=build_ffmpeg_command("merge",[Path("a.mp3"),Path("b.mp3")],Path("out.mp3"),"audio",{"raw":"-dangerous"})
        self.assertNotIn("-dangerous",command)
        self.assertTrue(any("concat=n=2:v=0:a=1[out]" in item for item in command))

    def test_webm_uses_compatible_video_and_audio_codecs(self):
        command=build_ffmpeg_command("convert",[Path("input.mp4")],Path("output.webm"),"video",{
            "codec":"h264","_codec_encoder":"libx264","preset":"balanced",
        })
        self.assertIn("libvpx-vp9",command)
        self.assertIn("libopus",command)

    def test_video_merge_can_supply_silence_for_missing_audio(self):
        command=build_ffmpeg_command("merge",[Path("a.mp4"),Path("b.mp4")],Path("out.mp4"),"video",{
            "codec":"h264","_codec_encoder":"libx264","_merge_profiles":[
                {"width":320,"height":240,"has_audio":True,"duration":1},
                {"width":640,"height":360,"has_audio":False,"duration":1},
            ],
        })
        self.assertIn("anullsrc=channel_layout=stereo:sample_rate=48000",command)
        self.assertTrue(any("concat=n=2:v=1:a=1[v][a]" in item for item in command))

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg is not installed")
    def test_real_audio_extract_and_trim_commands_produce_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); video=root/"source.mp4"; audio=root/"audio.mp3"; trimmed=root/"trimmed.mp3"
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","lavfi","-i","color=c=blue:s=160x120:d=1","-f","lavfi","-i","sine=frequency=440:duration=1","-c:v","libx264","-c:a","aac","-shortest",str(video)],check=True)
            subprocess.run(build_ffmpeg_command("extract_audio",[video],audio,"video",{"format":"mp3","preset":"balanced"}),check=True,stdout=subprocess.DEVNULL)
            subprocess.run(build_ffmpeg_command("trim",[audio],trimmed,"audio",{"start":0.1,"end":0.7,"format":"mp3"}),check=True,stdout=subprocess.DEVNULL)
            self.assertGreater(audio.stat().st_size,0)
            self.assertGreater(trimmed.stat().st_size,0)

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg is not installed")
    def test_real_compress_convert_and_merge_commands_produce_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            first=root/"first.mp4"; second=root/"second.mp4"; image=root/"source.png"
            compressed=root/"compressed.mp4"; merged=root/"merged.mp4"; converted_image=root/"converted.jpg"
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","lavfi","-i","color=c=blue:s=160x120:d=0.7","-f","lavfi","-i","sine=frequency=440:duration=0.7","-c:v","libx264","-c:a","aac","-shortest",str(first)],check=True)
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","lavfi","-i","color=c=red:s=320x180:d=0.5","-c:v","libx264",str(second)],check=True)
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","lavfi","-i","color=c=green:s=120x90","-frames:v","1",str(image)],check=True)
            subprocess.run(build_ffmpeg_command("compress",[first],compressed,"video",{"format":"mp4","codec":"h264","_codec_encoder":"libx264","preset":"smallest"}),check=True,stdout=subprocess.DEVNULL)
            subprocess.run(build_ffmpeg_command("merge",[first,second],merged,"video",{"format":"mp4","codec":"h264","_codec_encoder":"libx264","_merge_profiles":[{"width":160,"height":120,"has_audio":True,"duration":0.7},{"width":320,"height":180,"has_audio":False,"duration":0.5}]}),check=True,stdout=subprocess.DEVNULL)
            subprocess.run(build_ffmpeg_command("convert",[image],converted_image,"image",{"format":"jpg","preset":"balanced"}),check=True,stdout=subprocess.DEVNULL)
            for output in (compressed,merged,converted_image): self.assertGreater(output.stat().st_size,0)
            video_outputs=(("mp4","h264","libx264"),("mov","h264","libx264"),("mkv","h264","libx264"),("webm","vp9","libvpx-vp9"))
            for extension,codec,encoder in video_outputs:
                output=root/f"video.{extension}"
                subprocess.run(build_ffmpeg_command("convert",[first],output,"video",{"format":extension,"codec":codec,"_codec_encoder":encoder,"preset":"smallest"}),check=True,stdout=subprocess.DEVNULL)
                self.assertGreater(output.stat().st_size,0,extension)

    @unittest.skipUnless(shutil.which("ffmpeg"), "FFmpeg is not installed")
    def test_real_advertised_audio_and_image_formats_produce_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); video=root/"source.mp4"; image=root/"source.png"
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","lavfi","-i","color=c=blue:s=160x120:d=0.4","-f","lavfi","-i","sine=frequency=440:duration=0.4","-c:v","libx264","-c:a","aac","-shortest",str(video)],check=True)
            subprocess.run(["ffmpeg","-hide_banner","-loglevel","error","-y","-f","lavfi","-i","color=c=green:s=120x90","-frames:v","1",str(image)],check=True)
            for extension in ("mp3","m4a","aac","wav","flac","ogg"):
                output=root/f"audio.{extension}"
                subprocess.run(build_ffmpeg_command("extract_audio",[video],output,"video",{"format":extension,"preset":"balanced"}),check=True,stdout=subprocess.DEVNULL)
                self.assertGreater(output.stat().st_size,0,extension)
            for extension in ("jpg","jpeg","png","webp","avif"):
                output=root/f"image.{extension}"
                subprocess.run(build_ffmpeg_command("convert",[image],output,"image",{"format":extension,"preset":"balanced"}),check=True,stdout=subprocess.DEVNULL)
                self.assertGreater(output.stat().st_size,0,extension)
