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
import zipfile
from pathlib import Path

from lxml import etree
from pptx import Presentation
from pptx.util import Emu

import animations

P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main"
C_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm"}
BUNDLE_BUILD_VERSION = 3



def validate_pptx_container(path: Path):
    """Reject malformed, oversized and potentially zip-bomb Office archives early."""
    if not zipfile.is_zipfile(path):
        raise ValueError("ملف PowerPoint غير صالح")
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        if len(members) > 15000:
            raise ValueError("الملف يحتوي على عدد غير معقول من العناصر")
        total = sum(item.file_size for item in members)
        if total > 2 * 1024 * 1024 * 1024:
            raise ValueError("حجم الملفات بعد فك الضغط يتجاوز 2 GB")
        names = set(archive.namelist())
        if "[Content_Types].xml" not in names or "ppt/presentation.xml" not in names:
            raise ValueError("هذا ليس ملف PPTX صالحاً")
        for item in members:
            if (item.file_size > 100 * 1024 * 1024 and
                    item.compress_size < item.file_size // 1000):
                raise ValueError("ضغط مريب لأحد عناصر العرض")

def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def bundle_fingerprint(path: Path) -> str:
    """Version bundle IDs so imports made by older renderers are refreshed."""
    value = f"{sha256_file(path)}:bundle:{BUNDLE_BUILD_VERSION}".encode("ascii")
    return hashlib.sha256(value).hexdigest()[:12]


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


def slide_compatibility(slide, model="auto"):
    """Report what PNG conversion could not keep, and how far build steps recover it.

    animationFidelity: "none" (no builds), "order-and-state" (click builds reproduced as
    per-click images; motion approximated), "partial" (some effects not reproducible) or
    "unsupported" (builds exist but could not be reproduced at all).
    """
    xml = slide._element
    timing = xml.find(f"{{{P_NS}}}timing")
    transition = xml.find(f"{{{P_NS}}}transition")
    chart_count = sum(
        1 for shape in iter_shapes(slide.shapes)
        if getattr(shape, "has_chart", False)
    )
    if model == "auto":
        model = animations.parse_build_model(slide)
    has_builds = model is not None and (bool(model.clicks) or bool(model.blocking))
    if not has_builds:
        fidelity = "none"
    elif not model.usable:
        fidelity = "unsupported"
    elif model.unsupported:
        fidelity = "partial"
    else:
        fidelity = "order-and-state"
    return {
        "animationsDetected": has_builds,
        "timingDetected": timing is not None,
        "transitionDetected": transition is not None,
        "chartCount": chart_count,
        "animationFidelity": fidelity,
        "animationPreserved": fidelity in ("order-and-state", "partial") if has_builds else None,
        "unsupportedEffects": list(model.unsupported + model.blocking) if has_builds else [],
    }


UNSUPPORTED_TEXT = {
    "emphasis-or-path-motion": "حركات التأكيد أو المسارات لا تُعاد؛ يبقى ترتيب الظهور والحالة",
    "chart-type": "نوع مخطط غير مدعوم في بناء الخطوات؛ يعرض كاملاً",
    "chart-build": "نمط بناء مخطط غير مدعوم؛ يعرض كاملاً",
    "interactive": "حركات تفاعلية بمحفزات؛ تعرض الشريحة بحالتها النهائية فقط",
    "smartart": "حركات SmartArt؛ تعرض الشريحة بحالتها النهائية فقط",
    "ole-chart": "مخطط OLE متحرك؛ تعرض الشريحة بحالتها النهائية فقط",
    "unsupported-target": "هدف حركة غير مدعوم؛ تعرض الشريحة بحالتها النهائية فقط",
}


def attach_builds(pptx: Path, out_dir: Path, width: int, deck, entries: list, problems: list):
    """Render per-click images for animated slides and describe them in the manifest."""
    models, by_slide = {}, {}
    for index, slide in enumerate(deck.slides, start=1):
        model = animations.parse_build_model(slide)
        if model is None or not (model.clicks or model.blocking):
            continue
        by_slide[index] = model
        if model.usable:
            models[index] = model
    images = animations.render_steps(pptx, out_dir, width, models) if models else {}
    for entry in entries:
        index = entry["index"]
        model = by_slide.get(index)
        entry["compatibility"] = slide_compatibility(deck.slides[index - 1], model)
        entry.pop("build", None)
        if index in images and len(images[index]) == len(models[index].clicks) + 1:
            entry["build"] = {
                "version": 1,
                "steps": animations.describe_steps(models[index], lambda k, i=images[index]: i[k]),
            }
        if model is not None:
            for reason in model.unsupported + model.blocking:
                problems.append({"slide": index,
                                 "problem": UNSUPPORTED_TEXT.get(reason, reason)})
    return entries


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
    """Return relationship IDs for the media parts a picture shape plays as video.

    PowerPoint can mark ``a:videoFile`` as an external link with a placeholder
    target (often ``NULL``), while storing the actual clip in a p14:media
    extension as an embedded relationship. Prefer the embedded relationship
    in that case so these clips remain portable with the presentation.
    """
    links = []
    for node in shape._element.iter(f"{{{A_NS}}}videoFile"):
        rid = node.get(f"{{{R_NS}}}link")
        if rid:
            links.append((rid, True))
    embedded = []
    for node in shape._element.iter():
        if node.tag.endswith("}media"):
            rid = node.get(f"{{{R_NS}}}embed")
            if rid:
                embedded.append((rid, False))
    return embedded or links


def unique_embedded_video_targets(shape, slide):
    """Yield each embedded media part once per shape.

    A single PowerPoint movie often has both a:videoFile and p14:media
    relationships pointing at the same binary. They are not two video overlays.
    Keep external links for the caller to report/skip as before.
    """
    seen_parts = set()
    for rid, is_video_link in video_targets(shape):
        rel = slide.part.rels[rid]
        if not rel.is_external:
            partname = rel.target_part.partname
            if partname in seen_parts:
                continue
            seen_parts.add(partname)
        yield rid, is_video_link


def probe_streams(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_name,codec_type,pix_fmt,profile,width,height:format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True, timeout=120,
    )
    data = json.loads(out.stdout)
    info = {"video": None, "audio": None, "pix_fmt": None, "profile": None,
            "width": None, "height": None, "duration": None}
    for stream in data.get("streams", []):
        kind = stream.get("codec_type")
        if kind in ("video", "audio") and info[kind] is None:
            info[kind] = stream.get("codec_name")
            if kind == "video":
                info["pix_fmt"], info["profile"] = stream.get("pix_fmt"), stream.get("profile")
                info["width"], info["height"] = stream.get("width"), stream.get("height")
    try:
        info["duration"] = round(float(data.get("format", {}).get("duration")), 2)
    except (TypeError, ValueError):
        pass
    return info


def probe_codecs(path: Path):
    info = probe_streams(path)
    return {k: v for k, v in (("video", info["video"]), ("audio", info["audio"])) if v}


def browser_safe_h264(info: dict) -> bool:
    """H.264 8-bit 4:2:0 with even dimensions and AAC/no audio plays in every mainstream browser."""
    even = all(isinstance(info.get(k), int) and info[k] % 2 == 0 for k in ("width", "height"))
    return (info["video"] == "h264" and info["pix_fmt"] == "yuv420p" and even and
            info["profile"] in (None, "Baseline", "Constrained Baseline", "Main", "High") and
            info["audio"] in (None, "aac"))


def prepare_video(src: Path, dst_dir: Path):
    """Copy a video into the bundle as an H.264/AAC MP4 that browsers play.

    Returns (mp4_name, webm_name, details). `details` tells the lecturer what was found and done.
    """
    info = probe_streams(src)
    if not info["video"]:
        raise ValueError("no video stream")
    dst = dst_dir / (src.stem + ".mp4")
    counter = 1
    while dst.exists():
        dst = dst_dir / f"{src.stem}-{counter}.mp4"
        counter += 1
    safe = browser_safe_h264(info)
    if safe:
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-c", "copy",
               "-movflags", "+faststart", str(dst)]
    else:
        cmd = ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-c:v", "libx264",
               "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
               "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
               "-c:a", "aac", "-movflags", "+faststart", str(dst)]
    subprocess.run(cmd, check=True, timeout=1800)
    # MP4 is enough for modern Chrome/Safari; VP9 backup is opt-in because
    # transcoding it can be very expensive for a full lecture.
    webm_name = None
    if os.environ.get("ALFA_WEBM_BACKUP") == "1":
        webm = dst.with_suffix(".webm")
        if not webm.exists():
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-i", str(dst), "-c:v", "libvpx-vp9",
                 "-b:v", "0", "-crf", "36", "-deadline", "realtime", "-cpu-used", "8",
                 "-c:a", "libopus", str(webm)], check=True, timeout=3600)
        webm_name = webm.name
    details = {
        "sourceVideo": info["video"], "sourceAudio": info["audio"],
        "hasAudio": info["audio"] is not None, "transcoded": not safe,
        "duration": info["duration"],
    }
    return dst.name, webm_name, details


def render_slides(pptx: Path, out_dir: Path, width: int) -> tuple[int, str]:
    # Keep one stable directory under the local bundles folder. macOS may ask
    # PowerPoint for folder access on first use; reusing this exact directory
    # avoids prompting again for every lecture's temporary bundle directory.
    work = out_dir.parent / ".alfa-render"
    if work.exists():
        for child in work.iterdir():
            if child.name == "deck.pptx":
                continue
            if child.is_dir():
                shutil.rmtree(child)
            else:
                child.unlink()
    work.mkdir(parents=True, exist_ok=True)
    shutil.copy(pptx, work / "deck.pptx")
    pdf = work / "deck.pdf"
    rendered_with_powerpoint = False
    # Native export is the fidelity path for a real Mac session. Tests and
    # unattended processes can opt out so a blocked Office automation dialog
    # never stalls the importer.
    powerpoint_available = (sys.platform == "darwin" and
                            os.environ.get("ALFA_NATIVE_POWERPOINT", "1") != "0" and
                            Path("/Applications/Microsoft PowerPoint.app").exists())
    if powerpoint_available:
        # Use Microsoft's renderer when available to preserve Office fonts,
        # spacing, shapes and line wrapping. Work on the temporary copy above;
        # the user's original presentation is never edited.
        script = '''on run argv
  set sourcePath to item 1 of argv
  set pdfPath to item 2 of argv
  tell application "Microsoft PowerPoint"
    open POSIX file sourcePath
    save active presentation in POSIX file pdfPath as save as PDF
    close active presentation saving no
  end tell
end run'''
        try:
            subprocess.run(["osascript", "-e", script, str(work / "deck.pptx"), str(pdf)],
                           check=True, capture_output=True, timeout=90)
            rendered_with_powerpoint = pdf.is_file() and pdf.stat().st_size > 0
        except (subprocess.SubprocessError, OSError):
            # Keep import available on Macs where PowerPoint is installed but
            # automation is unavailable or the Office export fails.
            pdf.unlink(missing_ok=True)
    if not rendered_with_powerpoint:
        pdf.unlink(missing_ok=True)
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
    for child in work.iterdir():
        if child.name == "deck.pptx":
            child.write_bytes(b"")
        elif child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()
    return len(pages), "PowerPoint" if rendered_with_powerpoint else "LibreOffice"


def rerender(pptx: Path, bundles_root: Path, width: int = 1920) -> Path:
    """Re-render only the slide images of an existing bundle (e.g. after installing fonts)."""
    out_dir = bundles_root / bundle_fingerprint(pptx)
    if not (out_dir / "manifest.json").exists():
        raise SystemExit(f"no bundle to re-render in {out_dir}; run a normal build first")
    shutil.rmtree(out_dir / "slides", ignore_errors=True)
    render_slides(pptx, out_dir, width)
    return out_dir


def build(pptx: Path, bundles_root: Path, width: int = 1920) -> Path:
    validate_pptx_container(pptx)
    fingerprint = bundle_fingerprint(pptx)
    out_dir = bundles_root / fingerprint
    if (out_dir / "manifest.json").exists():
        # Backfill text and build steps on older bundles without rerendering media.
        manifest_file = out_dir / "manifest.json"
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        deck = Presentation(str(pptx))
        for entry, slide in zip(manifest["slides"], deck.slides):
            entry["text"] = slide_text(slide)
        legacy = ("powerpoint animations are not preserved in PNG rendering",
                  "potentially animated PowerPoint chart: visual compatibility review required")
        manifest["problems"] = [x for x in manifest.get("problems", [])
                                if x.get("problem") not in legacy and x.get("problem") not in UNSUPPORTED_TEXT.values()]
        needs_steps = manifest.get("buildVersion") != BUNDLE_BUILD_VERSION
        if needs_steps:
            attach_builds(pptx, out_dir, width, deck, manifest["slides"], manifest["problems"])
            manifest["buildVersion"] = BUNDLE_BUILD_VERSION
        manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        write_indexes(bundles_root, fingerprint)
        print(f"bundle already built, slide text refreshed: {out_dir}")
        return out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    media_dir = out_dir / "media"
    media_dir.mkdir(exist_ok=True)

    deck = Presentation(str(pptx))
    slide_w, slide_h = deck.slide_width, deck.slide_height
    page_count, render_engine = render_slides(pptx, out_dir, width)

    video_cache = {}
    problems = []
    if (render_engine != "PowerPoint" and sys.platform == "darwin" and
            os.environ.get("ALFA_NATIVE_POWERPOINT", "1") != "0" and
            Path("/Applications/Microsoft PowerPoint.app").exists()):
        problems.append({"slide": 1, "problem": "تعذّر التصدير عبر PowerPoint؛ استُخدم LibreOffice كبديل"})
    slides = []
    for index, slide in enumerate(deck.slides, start=1):
        compatibility = slide_compatibility(slide)
        videos = []
        for shape in iter_shapes(slide.shapes):
            for rid, is_video_link in unique_embedded_video_targets(shape, slide):
                rel = slide.part.rels[rid]
                if rel.is_external and is_video_link:
                    # Some PowerPoint files carry both an external placeholder
                    # and an embedded p14:media relationship for the same clip.
                    # The embedded relationship is handled in the next iteration.
                    continue
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
                    try:
                        video_cache[name] = prepare_video(raw, media_dir)
                    except (subprocess.SubprocessError, ValueError, OSError):
                        # One unreadable clip must not lose the whole lecture.
                        video_cache[name] = None
                    finally:
                        raw.unlink(missing_ok=True)
                if video_cache[name] is None:
                    problems.append({"slide": index, "problem": "video could not be converted for the browser",
                                     "target": name})
                    continue
                mp4_name, webm_name, details = video_cache[name]
                if details["transcoded"]:
                    problems.append({"slide": index, "problem": "video was converted for browser playback",
                                     "target": f"{details['sourceVideo']}/{details['sourceAudio'] or 'no audio'}"})
                if not details["hasAudio"]:
                    problems.append({"slide": index, "problem": "video has no audio track", "target": name})
                videos.append({
                    "src": f"media/{mp4_name}",
                    "webm": f"media/{webm_name}" if webm_name else None,
                    "info": details,
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
    attach_builds(pptx, out_dir, width, deck, slides, problems)
    if page_count != len(slides):
        raise RuntimeError(f"rendered {page_count} pages but deck has {len(slides)} slides")

    manifest = {
        "id": fingerprint,
        "source": pptx.name,
        "slideCount": len(slides),
        "renderEngine": render_engine,
        "aspect": round(slide_w / slide_h, 6),
        "slides": slides,
        "buildVersion": BUNDLE_BUILD_VERSION,
        "problems": problems,
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    write_indexes(bundles_root, fingerprint)
    return out_dir


MAX_PDF_PAGES = 400


def pdf_info(pdf: Path) -> dict:
    """Validate a PDF with poppler (never executes embedded scripts) and read page count/size."""
    with pdf.open("rb") as fh:
        if fh.read(5) != b"%PDF-":
            raise ValueError("هذا ليس ملف PDF صالحاً")
    out = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, timeout=60)
    if out.returncode != 0:
        raise ValueError("تعذر قراءة ملف PDF (قد يكون تالفاً أو محمياً بكلمة مرور)")
    fields = dict(line.split(":", 1) for line in out.stdout.splitlines() if ":" in line)
    pages = int(fields.get("Pages", "0").strip() or 0)
    if pages < 1:
        raise ValueError("ملف PDF بلا صفحات")
    if pages > MAX_PDF_PAGES:
        raise ValueError(f"عدد صفحات PDF يتجاوز {MAX_PDF_PAGES}")
    size = fields.get("Page size", "").replace("x", " ").split()
    try:
        width_pt, height_pt = float(size[0]), float(size[1])
    except (IndexError, ValueError):
        width_pt, height_pt = 16.0, 9.0
    return {"pages": pages, "aspect": round(width_pt / height_pt, 6) if height_pt else 16 / 9,
            "encrypted": fields.get("Encrypted", "").strip().startswith("yes")}


def pdf_page_text(pdf: Path, page: int) -> str:
    out = subprocess.run(["pdftotext", "-f", str(page), "-l", str(page), "-layout", str(pdf), "-"],
                         capture_output=True, text=True, timeout=60)
    return " ".join(out.stdout.split())[:12000] if out.returncode == 0 else ""


def build_pdf(pdf: Path, bundles_root: Path, width: int = 1920, source_name: str | None = None,
              notes: list | None = None) -> Path:
    """A PDF becomes a lecture of still pages: no animation, no video, text from the PDF."""
    info = pdf_info(pdf)
    if info["encrypted"]:
        raise ValueError("ملف PDF مشفر؛ صدّر نسخة غير مشفرة")
    fingerprint = sha256_file(pdf)[:12]
    out_dir = bundles_root / fingerprint
    if (out_dir / "manifest.json").exists():
        write_indexes(bundles_root, fingerprint)
        print(f"bundle already built: {out_dir}")
        return out_dir
    slides_dir = out_dir / "slides"
    out_dir.mkdir(parents=True, exist_ok=True)
    slides_dir.mkdir(exist_ok=True)
    try:
        subprocess.run(["pdftoppm", "-png", "-scale-to-x", str(width), "-scale-to-y", "-1",
                        str(pdf), str(out_dir / "page")], check=True, timeout=1800)
        pages = sorted(out_dir.glob("page-*.png"))
        if len(pages) != info["pages"]:
            raise RuntimeError(f"rendered {len(pages)} pages but PDF has {info['pages']}")
        slides = []
        for index, page in enumerate(pages, start=1):
            shutil.move(str(page), slides_dir / f"{index:03d}.png")
            slides.append({"index": index, "image": f"slides/{index:03d}.png", "notes": "",
                           "text": pdf_page_text(pdf, index), "videos": [],
                           "compatibility": {"animationsDetected": False, "timingDetected": False,
                                             "transitionDetected": False, "chartCount": 0,
                                             "animationFidelity": "none", "animationPreserved": None,
                                             "unsupportedEffects": []}})
    except Exception:
        shutil.rmtree(out_dir, ignore_errors=True)
        raise
    problems = [{"slide": None, "problem": text} for text in (notes or [])]
    if not any(entry["text"] for entry in slides):
        problems.append({"slide": None, "problem": "PDF has no extractable text (scanned images?): the director cannot read slide content"})
    manifest = {"id": fingerprint, "source": source_name or pdf.name, "format": "pdf",
                "slideCount": len(slides), "aspect": info["aspect"], "slides": slides,
                "buildVersion": 1, "problems": problems}
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    write_indexes(bundles_root, fingerprint)
    return out_dir


def build_keynote(key: Path, bundles_root: Path, width: int = 1920) -> Path:
    """Best effort: LibreOffice (libetonyek) converts Keynote to PDF. Motion and video are lost."""
    work = bundles_root / "_keynote_work"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    try:
        shutil.copy(key, work / "deck.key")
        try:
            result = subprocess.run(["soffice", "--headless", "--convert-to", "pdf", "--outdir", str(work),
                                     str(work / "deck.key")], capture_output=True, timeout=600)
        except (OSError, subprocess.TimeoutExpired):
            result = None
        pdf = work / "deck.pdf"
        if result is None or result.returncode != 0 or not pdf.exists() or pdf.stat().st_size < 100:
            raise ValueError("تعذر تحويل ملف Keynote على هذا الجهاز؛ في Keynote اختر ملف ← تصدير إلى ← PowerPoint أو PDF ثم ارفع الناتج")
        return build_pdf(pdf, bundles_root, width, source_name=key.name, notes=[
            "Keynote was converted through PDF: build animations, transitions and embedded video are not carried over; "
            "export to PowerPoint from Keynote to keep embedded video"])
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pptx", type=Path)
    parser.add_argument("--bundles", type=Path, default=Path(__file__).resolve().parent.parent / "bundles")
    parser.add_argument("--width", type=int, default=1920)
    parser.add_argument("--rerender", action="store_true",
                        help="re-render slide images only, keep media and manifest")
    args = parser.parse_args(argv)
    suffix = args.pptx.suffix.lower()
    if suffix == ".pdf":
        out = build_pdf(args.pptx, args.bundles, args.width)
    elif suffix == ".key":
        out = build_keynote(args.pptx, args.bundles, args.width)
    elif args.rerender:
        out = rerender(args.pptx, args.bundles, args.width)
    else:
        out = build(args.pptx, args.bundles, args.width)
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
