"""Create a tiny disposable lecture fixture for browser regression tests.

This is NOT an actual PPTX compatibility test; it tests the finished browser
presenter, video seeking, audience sync and voting without private user files.
"""
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ID = "testfixture1"
DIR = ROOT / "bundles" / ID
SLIDES = DIR / "slides"
MEDIA = DIR / "media"

SLIDES.mkdir(parents=True, exist_ok=True)
MEDIA.mkdir(parents=True, exist_ok=True)
for index in range(1, 8):
    img = Image.new("RGB", (960, 540), (248, 249, 248))
    draw = ImageDraw.Draw(img)
    draw.rectangle((60, 60, 900, 470), outline=(62, 92, 120), width=8)
    draw.text((120, 220), "ALFA TEST SLIDE %d" % index, fill=(22, 29, 35))
    img.save(SLIDES / ("%03d.png" % index))
video = MEDIA / "test.mp4"
subprocess.run([
    "ffmpeg", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
    "-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-preset", "ultrafast", "-c:a", "aac", str(video),
], check=True)
slides = []
for index in range(1, 8):
    slides.append({
        "index": index, "image": "slides/%03d.png" % index,
        "text": "ملف اختبار شريحة %d" % index,
        "notes": "ملاحظات اختبارية",
        "videos": ([{"src": "media/test.mp4", "webm": None, "x": .1, "y": .15, "w": .8, "h": .7}]
                   if index == 7 else []),
    })
(DIR / "manifest.json").write_text(json.dumps({
    "id": ID, "source": "Browser Test", "slideCount": 7,
    "aspect": 16/9, "slides": slides, "problems": [],
}, ensure_ascii=False), encoding="utf-8")
(ROOT / "bundles" / "current.json").write_text(json.dumps({"id": ID}), encoding="utf-8")
(ROOT / "bundles" / "lectures.json").write_text(json.dumps([
    {"id": ID, "title": "Browser Test", "slideCount": 7}
]), encoding="utf-8")
print("Fixture ready:", DIR)
