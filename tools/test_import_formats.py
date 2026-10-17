"""PDF/Keynote import and video compatibility tests (ffmpeg, poppler required for most)."""
import json
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from PIL import Image

import build_bundle

HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))
HAVE_POPPLER = bool(shutil.which("pdftoppm") and shutil.which("pdfinfo") and shutil.which("pdftotext"))


def text_pdf(pages: int, word: str = "Page") -> bytes:
    """Smallest valid multi-page PDF with real text (no libraries)."""
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>"]
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(pages))
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {pages} >>".encode())
    for i in range(pages):
        content_id = 4 + 2 * i
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Contents {content_id} 0 R "
                       f"/Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>".encode())
        stream = f"BT /F1 48 Tf 100 270 Td ({word} {i + 1} alpha) Tj ET".encode()
        objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


@unittest.skipUnless(HAVE_POPPLER, "poppler not installed")
class PdfTests(unittest.TestCase):
    def test_pdf_becomes_a_lecture_with_pages_and_text(self):
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "lecture.pdf"
            pdf.write_bytes(text_pdf(3))
            out = build_bundle.build_pdf(pdf, Path(tmp) / "bundles", 960)
            manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["slideCount"], 3)
            self.assertEqual(manifest["format"], "pdf")
            self.assertAlmostEqual(manifest["aspect"], 960 / 540, places=3)
            self.assertIn("Page 2 alpha", manifest["slides"][1]["text"])
            self.assertEqual(manifest["slides"][0]["videos"], [])
            self.assertEqual(manifest["slides"][0]["compatibility"]["animationFidelity"], "none")
            self.assertEqual(manifest["problems"], [])
            for slide in manifest["slides"]:
                self.assertGreater(Image.open(out / slide["image"]).width, 500)
            listing = json.loads((Path(tmp) / "bundles" / "lectures.json").read_text(encoding="utf-8"))
            self.assertEqual(listing[0]["title"], "lecture.pdf")
            # Same file again reuses the bundle.
            self.assertEqual(build_bundle.build_pdf(pdf, Path(tmp) / "bundles", 960), out)

    def test_scanned_pdf_warns_that_text_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            pdf = Path(tmp) / "scan.pdf"
            Image.new("RGB", (800, 450), "white").save(pdf)
            out = build_bundle.build_pdf(pdf, Path(tmp) / "bundles", 800)
            manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
            self.assertTrue(any("no extractable text" in p["problem"] for p in manifest["problems"]))

    def test_invalid_and_oversized_pdfs_are_rejected_without_leftovers(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "bad.pdf"
            bad.write_bytes(b"not a pdf at all")
            with self.assertRaises(ValueError):
                build_bundle.build_pdf(bad, Path(tmp) / "bundles")
            big = Path(tmp) / "big.pdf"
            big.write_bytes(text_pdf(build_bundle.MAX_PDF_PAGES + 1))
            with self.assertRaises(ValueError):
                build_bundle.build_pdf(big, Path(tmp) / "bundles")
            self.assertFalse(list((Path(tmp) / "bundles").glob("*/manifest.json")))

    def test_unconvertible_keynote_gives_actionable_message(self):
        with tempfile.TemporaryDirectory() as tmp:
            key = Path(tmp) / "talk.key"
            key.write_bytes(b"PK\x03\x04 definitely not keynote")
            with self.assertRaises(ValueError) as caught:
                build_bundle.build_keynote(key, Path(tmp) / "bundles")
            self.assertIn("PowerPoint", str(caught.exception))
            self.assertFalse((Path(tmp) / "bundles" / "_keynote_work").exists())


def make_video(path: Path, *args: str):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=15:duration=1",
                    *args, str(path)], check=True)


@unittest.skipUnless(HAVE_FFMPEG, "ffmpeg not installed")
class VideoCompatibilityTests(unittest.TestCase):
    def prepare(self, make):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = tmp / "clip.mov"
            make(src)
            media = tmp / "media"
            media.mkdir()
            mp4, _webm, details = build_bundle.prepare_video(src, media)
            return details, build_bundle.probe_streams(media / mp4)

    def audio_args(self):
        return ["-f", "lavfi", "-i", "sine=frequency=440:duration=1"]

    def test_browser_safe_h264_is_copied_not_reencoded(self):
        details, out = self.prepare(lambda p: make_video(
            p, *self.audio_args(), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest"))
        self.assertFalse(details["transcoded"])
        self.assertTrue(details["hasAudio"])
        self.assertEqual((out["video"], out["pix_fmt"]), ("h264", "yuv420p"))

    def test_high_444_h264_is_transcoded_because_browsers_cannot_play_it(self):
        details, out = self.prepare(lambda p: make_video(
            p, *self.audio_args(), "-c:v", "libx264", "-pix_fmt", "yuv444p", "-c:a", "aac", "-shortest"))
        self.assertTrue(details["transcoded"])
        self.assertEqual(out["pix_fmt"], "yuv420p")

    def test_legacy_codecs_are_converted_to_h264_aac(self):
        details, out = self.prepare(lambda p: make_video(
            p, *self.audio_args(), "-c:v", "mpeg4", "-c:a", "libmp3lame", "-shortest"))
        self.assertTrue(details["transcoded"])
        self.assertEqual((out["video"], out["audio"]), ("h264", "aac"))
        self.assertEqual(details["sourceVideo"], "mpeg4")

    def test_odd_dimensions_become_even(self):
        def make(path):
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=321x181:rate=15:duration=1",
                            "-c:v", "libx264", "-pix_fmt", "yuv444p", str(path)], check=True)
        details, out = self.prepare(make)
        self.assertTrue(details["transcoded"])
        self.assertEqual((out["width"] % 2, out["height"] % 2), (0, 0))

    def test_silent_video_is_reported_as_silent(self):
        details, _ = self.prepare(lambda p: make_video(p, "-c:v", "libx264", "-pix_fmt", "yuv420p"))
        self.assertFalse(details["hasAudio"])

    def test_garbage_is_rejected_cleanly(self):
        with tempfile.TemporaryDirectory() as tmp:
            junk = Path(tmp) / "junk.mp4"
            junk.write_bytes(b"\x00\x01 not a video")
            (Path(tmp) / "media").mkdir()
            with self.assertRaises((subprocess.SubprocessError, ValueError)):
                build_bundle.prepare_video(junk, Path(tmp) / "media")


if __name__ == "__main__":
    unittest.main()
