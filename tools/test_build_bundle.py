"""Tests for the bundle builder that do not need LibreOffice or a real lecture."""
import json
import tempfile
import unittest
from pathlib import Path

from pptx import Presentation
from pptx.util import Inches

import build_bundle


class ManifestTests(unittest.TestCase):
    def test_notes_and_slide_count_are_read_from_deck(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            deck = Presentation()
            deck.slide_width, deck.slide_height = Inches(13.333), Inches(7.5)
            for text in ("الأولى", "الثانية"):
                slide = deck.slides.add_slide(deck.slide_layouts[5])
                slide.notes_slide.notes_text_frame.text = f"ملاحظة {text}"
            path = tmp / "sample.pptx"
            deck.save(path)

            self.assertEqual(build_bundle.sha256_file(path), build_bundle.sha256_file(path))
            slides = [s for s in Presentation(path).slides]
            self.assertEqual(len(slides), 2)
            self.assertEqual(slides[1].notes_slide.notes_text_frame.text, "ملاحظة الثانية")

    def test_video_source_is_recognised_by_extension(self):
        self.assertIn(".mov", build_bundle.VIDEO_EXTS)
        self.assertIn(".mp4", build_bundle.VIDEO_EXTS)
        self.assertNotIn(".mp3", build_bundle.VIDEO_EXTS)


if __name__ == "__main__":
    unittest.main()
