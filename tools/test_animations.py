"""Build-step extraction tests. Rendering tests need LibreOffice + poppler and skip without them."""
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from PIL import Image
from pptx import Presentation

import animated_fixture
import animations
import build_bundle

HAVE_RENDER = bool(shutil.which("soffice") and shutil.which("pdftoppm"))


def deck_at(tmp):
    path = Path(tmp) / "anim.pptx"
    animated_fixture.build(path)
    return path, Presentation(str(path))


class ParseTests(unittest.TestCase):
    def test_paragraph_builds_keep_order_and_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, deck = deck_at(tmp)
            model = animations.parse_build_model(deck.slides[0])
            self.assertEqual(len(model.clicks), 2)
            sid = model.clicks[0].effects[0].units[0][1]
            self.assertEqual(model.initially_hidden, {("para", sid, i) for i in range(3)})
            self.assertEqual([k for k, v in model.visible_after(0).items() if v], [])
            after1 = model.visible_after(1)
            self.assertTrue(after1[("para", sid, 0)])
            self.assertFalse(after1[("para", sid, 1)])
            after2 = model.visible_after(2)
            self.assertTrue(all(after2.values()))
            # "with previous" effect starts inside the same click, after its own delay.
            self.assertEqual(model.clicks[1].effects[1].start_ms, 250)
            self.assertTrue(model.usable)

    def test_chart_series_builds(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, deck = deck_at(tmp)
            model = animations.parse_build_model(deck.slides[1])
            self.assertEqual(len(model.clicks), 2)
            gid = next(iter(model.initially_hidden))[1]
            self.assertEqual(len(model.initially_hidden), 6)
            self.assertTrue(model.visible_after(1)[("pt", gid, 0, 2)])
            self.assertFalse(model.visible_after(1)[("pt", gid, 1, 0)])

    def test_slide_without_builds_and_media_only_timing(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, deck = deck_at(tmp)
            self.assertIsNone(animations.parse_build_model(deck.slides[2]))

    def test_unsupported_motion_is_reported_not_hidden(self):
        with tempfile.TemporaryDirectory() as tmp:
            path, deck = deck_at(tmp)
            slide = deck.slides[0]
            timing = slide._element.find("p:timing", animations.NS)
            for ctn in timing.iter(animations.q("p", "cTn")):
                if ctn.get("presetClass") == "entr":
                    ctn.set("presetClass", "emph")
            model = animations.parse_build_model(slide)
            self.assertFalse(model.usable)
            self.assertIn("emphasis-or-path-motion", model.unsupported)
            compat = build_bundle.slide_compatibility(slide, model)
            self.assertEqual(compat["animationFidelity"], "none")

    def test_interactive_sequence_blocks_steps(self):
        with tempfile.TemporaryDirectory() as tmp:
            _, deck = deck_at(tmp)
            slide = deck.slides[0]
            timing = slide._element.find("p:timing", animations.NS)
            seq = next(timing.iter(animations.q("p", "seq")))
            import copy
            clone = copy.deepcopy(seq)
            clone.find("p:cTn", animations.NS).set("nodeType", "interactiveSeq")
            seq.getparent().append(clone)
            model = animations.parse_build_model(slide)
            self.assertIn("interactive", model.blocking)
            self.assertFalse(model.usable)
            self.assertEqual(build_bundle.slide_compatibility(slide, model)["animationFidelity"], "unsupported")


@unittest.skipUnless(HAVE_RENDER, "LibreOffice/poppler not installed")
class RenderTests(unittest.TestCase):
    def ink(self, path, box=None):
        image = Image.open(path).convert("L")
        if box:
            image = image.crop(box)
        return sum(1 for px in image.getdata() if px < 200)

    def test_bundle_has_one_image_per_click_with_correct_state(self):
        with tempfile.TemporaryDirectory() as tmp:
            path, _ = deck_at(tmp)
            out = build_bundle.build(path, Path(tmp) / "bundles", 960)
            manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
            text_slide, chart_slide, plain = manifest["slides"]
            self.assertIsNone(plain.get("build"))
            self.assertEqual(text_slide["compatibility"]["animationFidelity"], "order-and-state")
            steps = text_slide["build"]["steps"]
            self.assertEqual(len(steps), 3)
            top = (0, 0, 960, 250)
            ink = [self.ink(out / s["image"], top) for s in steps]
            self.assertLess(ink[0], 50)             # nothing visible before the first click
            self.assertTrue(ink[0] < ink[1] < ink[2])  # text accumulates in order
            chart = chart_slide["build"]["steps"]
            bars = [self.ink(out / s["image"], (0, 250, 960, 430)) for s in chart]
            # Axes are always drawn; each click adds bar pixels for one more series.
            self.assertTrue(bars[0] < bars[1] < bars[2], bars)
            self.assertFalse(manifest["problems"])
            # Re-import of the same file keeps the same build and does not duplicate problems.
            build_bundle.build(path, Path(tmp) / "bundles", 960)
            again = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(again["slides"][0]["build"], manifest["slides"][0]["build"])


if __name__ == "__main__":
    unittest.main()
