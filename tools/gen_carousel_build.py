"""Render a LinkedIn carousel to PNGs + PDF from a JSON spec.

Deterministic Pillow-based build: each slide is a 1080x1350 canvas with
brand-locked colors and Montserrat/Inter fonts. No logo (per project
decision). Output is one PNG per slide plus a combined PDF ready for
LinkedIn document upload.

Spec format (JSON):
  {
    "angle_id": "...",
    "slides": [
      {
        "n": 1,
        "bg": "#1C1C1C",
        "elements": [
          {"kind": "text", "content": "STUCK BIDDING FROM JULY 1?",
           "font": "Montserrat-Bold", "size": 110, "color": "#FFFFFF",
           "x": 80, "y": 320, "max_width": 920, "align": "left",
           "line_height": 132},
          {"kind": "rect", "x": 0, "y": 1300, "w": 1080, "h": 50,
           "color": "#C6F21F"}
        ]
      }
    ]
  }

Every slide gets a page indicator (NN / TOTAL) bottom-right on slides 2..N-1
per brand reference §9, unless `"page_indicator": false` on the slide.

Run:
  python3 tools/gen_carousel_build.py \
      --spec-file temp/outputs/assets/<angle-id>/spec.json
  python3 tools/gen_carousel_build.py --spec-file <path> --out-dir <path>
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FONTS_DIR = PROJECT_ROOT / "temp" / "resources" / "fonts"

SLIDE_W = 1080
SLIDE_H = 1350
DEFAULT_BG = "#1C1C1C"
DEFAULT_PAGE_INDICATOR_FONT = "Inter-Medium"
DEFAULT_PAGE_INDICATOR_SIZE = 24
DEFAULT_LINE_HEIGHT_RATIO = 1.18

FONT_FILES: dict[str, str] = {
    "Montserrat-Bold": "Montserrat-Bold.ttf",
    "Montserrat-SemiBold": "Montserrat-SemiBold.ttf",
    "Montserrat-Medium": "Montserrat-Medium.ttf",
    "Inter-Regular": "Inter-Regular.ttf",
    "Inter-Medium": "Inter-Medium.ttf",
    "Inter-SemiBold": "Inter-SemiBold.ttf",
}

# Backgrounds where dark on-canvas content reads best.
LIGHT_BACKGROUNDS = {"#F5F5F5", "#FFFFFF", "#FFF", "#C6F21F", "#E9E1D8"}


def _font_path(name: str) -> Path:
    fname = FONT_FILES.get(name)
    if not fname:
        sys.exit(
            f"Unknown font alias '{name}'. Known: {sorted(FONT_FILES)}"
        )
    p = FONTS_DIR / fname
    if not p.exists():
        sys.exit(
            f"Font file missing: {p}.\n"
            f"Run the font-download step from setup, or place the .ttf in "
            f"temp/resources/fonts/."
        )
    return p


_FONT_CACHE: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}


def _load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    key = (name, size)
    if key not in _FONT_CACHE:
        _FONT_CACHE[key] = ImageFont.truetype(str(_font_path(name)), size)
    return _FONT_CACHE[key]


def _wrap_lines(
    text: str, font: ImageFont.FreeTypeFont, max_width: int, draw: ImageDraw.ImageDraw,
) -> list[str]:
    """Greedy word-wrap that preserves explicit newlines."""
    out: list[str] = []
    for paragraph in text.split("\n"):
        words = paragraph.split(" ")
        if not words or words == [""]:
            out.append("")
            continue
        line = words[0]
        for w in words[1:]:
            test = f"{line} {w}"
            bbox = draw.textbbox((0, 0), test, font=font)
            if bbox[2] - bbox[0] <= max_width:
                line = test
            else:
                out.append(line)
                line = w
        out.append(line)
    return out


def _resolve_align_x(line: str, font, draw, x: int, max_width: int, align: str) -> int:
    if align in ("center", "right"):
        bbox = draw.textbbox((0, 0), line, font=font)
        line_w = bbox[2] - bbox[0]
        if align == "center":
            return x + (max_width - line_w) // 2
        return x + max_width - line_w
    return x


def _draw_text(draw: ImageDraw.ImageDraw, el: dict) -> None:
    font = _load_font(el.get("font", "Inter-Regular"), el.get("size", 32))
    color = el.get("color", "#FFFFFF")
    x = el.get("x", 80)
    y = el.get("y", 100)
    max_width = el.get("max_width", SLIDE_W - 2 * x)
    align = el.get("align", "left")
    line_height = el.get("line_height") or int(el.get("size", 32) * DEFAULT_LINE_HEIGHT_RATIO)

    lines = _wrap_lines(el["content"], font, max_width, draw)
    cur_y = y
    for line in lines:
        line_x = _resolve_align_x(line, font, draw, x, max_width, align)
        draw.text((line_x, cur_y), line, fill=color, font=font)
        cur_y += line_height


def _draw_rect(draw: ImageDraw.ImageDraw, el: dict) -> None:
    x = int(el["x"])
    y = int(el["y"])
    w = int(el["w"])
    h = int(el["h"])
    color = el.get("color", "#C6F21F")
    draw.rectangle([(x, y), (x + w, y + h)], fill=color)


def _draw_page_indicator(
    draw: ImageDraw.ImageDraw, n: int, total: int, bg: str,
) -> None:
    text = f"{n:02d} / {total:02d}"
    font = _load_font(DEFAULT_PAGE_INDICATOR_FONT, DEFAULT_PAGE_INDICATOR_SIZE)
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    color = "#1C1C1C" if bg.upper() in LIGHT_BACKGROUNDS else "#FFFFFF"
    draw.text((SLIDE_W - 80 - w, SLIDE_H - 70), text, fill=color, font=font)


def render_slide(slide: dict, total: int) -> Image.Image:
    bg = slide.get("bg", DEFAULT_BG)
    img = Image.new("RGB", (SLIDE_W, SLIDE_H), bg)
    draw = ImageDraw.Draw(img)

    # Render rect elements first (acting as backgrounds/blocks), text on top.
    elements = slide.get("elements", [])
    for el in elements:
        if el.get("kind") == "rect":
            _draw_rect(draw, el)
    for el in elements:
        if el.get("kind", "text") == "text":
            _draw_text(draw, el)

    n = slide["n"]
    show_indicator = slide.get("page_indicator", True) and 2 <= n <= total - 1
    if show_indicator:
        _draw_page_indicator(draw, n, total, bg)

    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec-file", required=True)
    ap.add_argument("--out-dir", default=None,
                    help="Default = same folder as spec-file")
    ap.add_argument("--png-only", action="store_true",
                    help="Skip the combined PDF, just write per-slide PNGs.")
    args = ap.parse_args()

    spec_path = Path(args.spec_file)
    if not spec_path.exists():
        sys.exit(f"Spec file not found: {spec_path}")

    spec = json.loads(spec_path.read_text())
    out_dir = Path(args.out_dir) if args.out_dir else spec_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    slides = spec.get("slides", [])
    if not slides:
        sys.exit("Spec has no slides.")
    total = len(slides)

    images: list[Image.Image] = []
    for slide in slides:
        img = render_slide(slide, total)
        png_path = out_dir / f"slide_{slide['n']:02d}.png"
        img.save(png_path, "PNG")
        images.append(img)
        print(f"  rendered slide {slide['n']:02d} -> {png_path.name}", file=sys.stderr)

    if not args.png_only:
        pdf_path = out_dir / "carousel.pdf"
        # Pillow's PDF save flattens to RGB at the requested resolution.
        images[0].save(
            pdf_path, "PDF",
            save_all=True, append_images=images[1:],
            resolution=150,
        )
        size_kb = pdf_path.stat().st_size // 1024
        print(f"OK -> {pdf_path} ({total} slides, {size_kb} KB)")
    else:
        print(f"OK -> {total} PNGs in {out_dir}")


if __name__ == "__main__":
    main()
