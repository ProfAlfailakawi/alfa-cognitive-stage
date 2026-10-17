"""Tests for the bundle builder that do not need LibreOffice or a real lecture."""
import json
import tempfile
import unittest
import json
from lxml import etree
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

    def test_rejects_invalid_pptx_zip(self):
        with tempfile.TemporaryDirectory() as tmp:
            bad = Path(tmp) / "bad.pptx"
            bad.write_bytes(b"bad")
            with self.assertRaises(ValueError):
                build_bundle.validate_pptx_container(bad)

    def test_animation_inventory_and_registration(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            deck = Presentation()
            slide = deck.slides.add_slide(deck.slide_layouts[6])
            slide._element.append(etree.Element("{%s}timing" % build_bundle.P_NS))
            self.assertTrue(build_bundle.animation_inventory(slide)["hasAnimations"])
            out = tmp / "test.pptx"
            deck.save(out)
            build_bundle.validate_pptx_container(out)
            bundle = tmp / "bundles" / "abc123"
            bundle.mkdir(parents=True)
            manifest = {"id": "abc123", "slideCount": 1, "source": "deck.pptx",
                        "slides": [{"index": 1, "hasAnimations": True}]}
            (bundle / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            entry = build_bundle.register_bundle(bundle, tmp / "bundles", "اختبار.pptx")
            self.assertEqual(entry["warnings"], 1)
            self.assertEqual(json.loads((tmp / "bundles" / "current.json").read_text())["id"], "abc123")
            self.assertEqual(len(json.loads((tmp / "bundles" / "lectures.json").read_text())), 1)
            build_bundle.register_bundle(bundle, tmp / "bundles", "اختبار.pptx")
            self.assertEqual(len(json.loads((tmp / "bundles" / "lectures.json").read_text())), 1)

    def test_video_source_is_recognised_by_extension(self):
        self.assertIn(".mov", build_bundle.VIDEO_EXTS)
        self.assertIn(".mp4", build_bundle.VIDEO_EXTS)
        self.assertNotIn(".mp3", build_bundle.VIDEO_EXTS)


if __name__ == "__main__":
    unittest.main()
