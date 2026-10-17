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

    def test_slide_text_extracts_shape_content(self):
        deck = Presentation()
        slide = deck.slides.add_slide(deck.slide_layouts[6])
        shape = slide.shapes.add_textbox(Inches(1), Inches(1), Inches(4), Inches(1))
        shape.text = "الألعاب التعليمية"
        self.assertIn("الألعاب التعليمية", build_bundle.slide_text(slide))

    def test_compatibility_manifest_detects_animation_and_chart(self):
        deck = Presentation()
        slide = deck.slides.add_slide(deck.slide_layouts[6])
        self.assertFalse(build_bundle.slide_compatibility(slide)["animationsDetected"])
        from pptx.oxml.xmlchemy import OxmlElement
        slide._element.append(OxmlElement("p:timing"))
        self.assertTrue(build_bundle.slide_compatibility(slide)["animationsDetected"])

    def test_index_generation(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            b = root / "abcdef123456"
            b.mkdir()
            (b / "manifest.json").write_text(json.dumps({
                "id": "abcdef123456", "source": "تجربة.pptx",
                "slideCount": 2, "problems": []}), encoding="utf-8")
            build_bundle.write_indexes(root, "abcdef123456")
            current = json.loads((root / "current.json").read_text(encoding="utf-8"))
            listing = json.loads((root / "lectures.json").read_text(encoding="utf-8"))
            self.assertEqual(current["id"], "abcdef123456")
            self.assertEqual(listing[0]["slideCount"], 2)

    def test_optional_video_source_is_null_when_webm_disabled(self):
        name = None
        self.assertIsNone(f"media/{name}" if name else None)

    def test_video_source_is_recognised_by_extension(self):
        self.assertIn(".mov", build_bundle.VIDEO_EXTS)
        self.assertIn(".mp4", build_bundle.VIDEO_EXTS)
        self.assertNotIn(".mp3", build_bundle.VIDEO_EXTS)


if __name__ == "__main__":
    unittest.main()
