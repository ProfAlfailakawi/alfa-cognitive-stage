"""Simple public-domain test lecture generated only inside CI."""
from pptx import Presentation
from pptx.util import Inches, Pt
from pathlib import Path
import sys
import subprocess
from PIL import Image
out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/alfa-ci-lecture.pptx")
deck = Presentation()
deck.slide_width = Inches(13.333)
deck.slide_height = Inches(7.5)
for i, phrase in enumerate(["الألعاب التعليمية", "التصويت والمشاركة"], start=1):
    slide = deck.slides.add_slide(deck.slide_layouts[6])
    shape = slide.shapes.add_textbox(Inches(1.0), Inches(2.0), Inches(10), Inches(2.3))
    paragraph = shape.text_frame.paragraphs[0]
    paragraph.text = phrase
    paragraph.font.size = Pt(36)
    slide.notes_slide.notes_text_frame.text = "ملاحظات تجربة " + str(i)
video = out.with_suffix(".mp4")
poster = out.with_suffix(".png")
Image.new("RGB", (320, 240), "#26465e").save(poster)
subprocess.run([
    "ffmpeg", "-v", "error", "-y",
    "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=1",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
    "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", str(video)
], check=True)
deck.slides[1].shapes.add_movie(
    str(video), Inches(1), Inches(1.5), Inches(8), Inches(4),
    poster_frame_image=str(poster), mime_type="video/mp4"
)
deck.save(out)
print(out)
