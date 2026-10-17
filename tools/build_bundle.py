"""Build a lecture bundle from a .pptx file.

The bundle keeps the original slide look (rendered by LibreOffice), extracts the
embedded videos with their positions, and writes a manifest the web player reads.
The source .pptx is never modified.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from lxml import etree
from pptx import Presentation
from pptx.util import Emu

P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
C_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm"}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def iter_shapes(shapes):
    for shape in shapes:
        yield shape
        if shape.shape_type == 6:  # group
            yield from iter_shapes(shape.shapes)


def slide_text(slide):
    """Collect ordinary slide text for contextual teaching assistance, without AI."""
    texts = []
    for shape in iter_shapes(slide.shapes):
        if getattr(shape, "has_text_frame", False):
            value = shape.text_frame.text.strip()
            if value:
                texts.append(value)
        if getattr(shape, "has_table", False):
            for row in shape.table.rows:
                for cell in row.cells:
                    value = cell.text.strip()
                    if value:
                        texts.append(value)
    return "\n".join(texts)[:12000]


def slide_compatibility(slide):
    """Report PowerPoint features we cannot reproduce by PNG conversion.

    Detection is conservative: a timing tree implies an animation is present;
    it does not pretend the browser has recreated the animation.
    """
    xml = slide._element
    timing = xml.find(f"{{{P_NS}}}timing")
    transition = xml.find(f"{{{P_NS}}}transition")
    chart_count = sum(
        1 for shape in iter_shapes(slide.shapes)
        if getattr(shape, "has_chart", False)
    )
    return {
        "animationsDetected": timing is not None,
        "transitionDetected": transition is not None,
        "chartCount": chart_count,
        "animationPreserved": False if timing is not None else None,
    }


def write_indexes(bundles_root: Path, selected_id: str):
    """Regenerate public lecture selectors from successful manifests only."""
    available = []
    for file in sorted(bundles_root.glob("*/manifest.json")):
        try:
            manifest = json.loads(file.read_text(encoding="utf-8"))
            bundle_id = manifest.get("id")
            if bundle_id != file.parent.name or not isinstance(bundle_id, str):
                continue
            available.append({
                "id": bundle_id,
                "title": str(manifest.get("source", bundle_id)),
                "slideCount": manifest.get("slideCount", 0),
                "warnings": len(manifest.get("problems", [])),
            })
        except (ValueError, OSError, TypeError):
            continue
    bundles_root.mkdir(parents=True, exist_ok=True)
    for name, payload in [
        ("lectures.json", available), ("current.json", {"id": selected_id})
    ]:
        target = bundles_root / name
        pending = bundles_root / (name + ".tmp")
        pending.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        pending.replace(target)


def video_targets(shape):
    """Return the media part names a picture shape plays as video."""
    found = []
    for node in shape._element.iter(f"{{{A_NS}}}videoFile"):
        rid = node.get(f"{{{R_NS}}}link")
        if rid:
            found.append(rid)
    return found


def probe_codecs(path: Path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_name,codec_type",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True,
    )
    streams = json.loads(out.stdout).get("streams", [])
    return {s["codec_type"]: s["codec_name"] for s in streams}


def prepare_video(src: Path, dst_dir: Path) -> str:
    """Copy a video into the bundle as an H.264/AAC MP4 that browsers play."""
    codecs = probe_codecs(src)
    dst = dst_dir / (src.stem + ".mp4")
    counter = 1
    while dst.exists():
        dst = dst_dir / f"{src.stem}-{counter}.mp4"
        counter += 1
    h264_ok = codecs.get("video") == "h264" and codecs.get("audio") in (None, "aac")
    if h264_ok:
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-c", "copy",
               "-movflags", "+faststart", str(dst)]
    else:
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-c:v", "libx264",
               "-preset", "veryfast", "-crf", "23", "-c:a", "aac",
               "-movflags", "+faststart", str(dst)]
    subprocess.run(cmd, check=True)
    # MP4 is enough for modern Chrome/Safari; VP9 backup is opt-in because
    # transcoding it can be very expensive for a full lecture.
    webm_name = None
    if os.environ.get("ALFA_WEBM_BACKUP") == "1":
        webm = dst.with_suffix(".webm")
        if not webm.exists():
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-c:v", "libvpx-vp9",
                 "-b:v", "0", "-crf", "36", "-deadline", "realtime", "-cpu-used", "8",
                 "-c:a", "libopus", str(webm)], check=True)
        webm_name = webm.name
    return dst.name, webm_name


def render_slides(pptx: Path, out_dir: Path, width: int) -> int:
    work = out_dir / "_render"
    work.mkdir(parents=True, exist_ok=True)
    shutil.copy(pptx, work / "deck.pptx")
    subprocess.run(
        ["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(work),
         str(work / "deck.pptx")],
        check=True, capture_output=True,
    )
    subprocess.run(
        ["pdftoppm", "-png", "-scale-to-x", str(width), "-scale-to-y", "-1",
         str(work / "deck.pdf"), str(work / "page")],
        check=True,
    )
    pages = sorted(work.glob("page-*.png"))
    slides_dir = out_dir / "slides"
    slides_dir.mkdir(exist_ok=True)
    for index, page in enumerate(pages, start=1):
        shutil.move(str(page), slides_dir / f"{index:03d}.png")
    shutil.rmtree(work)
    return len(pages)


def rerender(pptx: Path, bundles_root: Path, width: int = 1920) -> Path:
    """Re-render only the slide images of an existing bundle (e.g. after installing fonts)."""
    out_dir = bundles_root / sha256_file(pptx)[:12]
    if not (out_dir / "manifest.json").exists():
        raise SystemExit(f"no bundle to re-render in {out_dir}; run a normal build first")
    shutil.rmtree(out_dir / "slides", ignore_errors=True)
    render_slides(pptx, out_dir, width)
    return out_dir


def build(pptx: Path, bundles_root: Path, width: int = 1920) -> Path:
    fingerprint = sha256_file(pptx)[:12]
    out_dir = bundles_root / fingerprint
    if (out_dir / "manifest.json").exists():
        # Backfill text on older bundles without rerendering expensive media.
        manifest_file = out_dir / "manifest.json"
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        deck = Presentation(str(pptx))
        for entry, slide in zip(manifest["slides"], deck.slides):
            entry["text"] = slide_text(slide)
        manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        write_indexes(bundles_root, fingerprint)
        print(f"bundle already built, slide text refreshed: {out_dir}")
        return out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    media_dir = out_dir / "media"
    media_dir.mkdir(exist_ok=True)

    deck = Presentation(str(pptx))
    slide_w, slide_h = deck.slide_width, deck.slide_height
    page_count = render_slides(pptx, out_dir, width)

    video_cache = {}
    problems = []
    slides = []
    for index, slide in enumerate(deck.slides, start=1):
        compatibility = slide_compatibility(slide)
        if compatibility["animationsDetected"]:
            problems.append({"slide": index, "problem": "powerpoint animations are not preserved in PNG rendering"})
        if compatibility["chartCount"] and compatibility["animationsDetected"]:
            problems.append({"slide": index, "problem": "potentially animated PowerPoint chart: visual compatibility review required"})
        videos = []
        for shape in iter_shapes(slide.shapes):
            for rid in video_targets(shape):
                rel = slide.part.rels[rid]
                if rel.is_external:
                    problems.append({"slide": index, "problem": "external video link", "target": rel.target_ref})
                    continue
                part = rel.target_part
                name = Path(str(part.partname)).name
                if Path(name).suffix.lower() not in VIDEO_EXTS:
                    continue
                if name not in video_cache:
                    tmp = out_dir / "_src"
                    tmp.mkdir(exist_ok=True)
                    raw = tmp / name
                    raw.write_bytes(part.blob)
                    video_cache[name] = prepare_video(raw, media_dir)
                    raw.unlink()
                mp4_name, webm_name = video_cache[name]
                videos.append({
                    "src": f"media/{mp4_name}",
                    "webm": f"media/{webm_name}",
                    "x": round(shape.left / slide_w, 6),
                    "y": round(shape.top / slide_h, 6),
                    "w": round(shape.width / slide_w, 6),
                    "h": round(shape.height / slide_h, 6),
                })
        notes = ""
        if slide.has_notes_slide:
            notes = slide.notes_slide.notes_text_frame.text.strip()
        slides.append({
            "index": index,
            "image": f"slides/{index:03d}.png",
            "notes": notes,
            "text": slide_text(slide),
            "videos": videos,
            "compatibility": compatibility,
        })

    shutil.rmtree(out_dir / "_src", ignore_errors=True)
    if page_count != len(slides):
        raise RuntimeError(f"rendered {page_count} pages but deck has {len(slides)} slides")

    manifest = {
        "id": fingerprint,
        "source": pptx.name,
        "slideCount": len(slides),
        "aspect": round(slide_w / slide_h, 6),
        "slides": slides,
        "problems": problems,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    write_indexes(bundles_root, fingerprint)
    return out_dir


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pptx", type=Path)
    parser.add_argument("--bundles", type=Path, default=Path(__file__).resolve().parent.parent / "bundles")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--rerender", action="store_true",
                        help="re-render slide images only, keep media and manifest")
    args = parser.parse_args(argv)
    if args.rerender:
        out = rerender(args.pptx, args.bundles, args.width)
    else:
        out = build(args.pptx, args.bundles, args.width)
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
