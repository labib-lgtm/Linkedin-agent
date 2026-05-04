"""Render a lead-magnet PDF from a JSON spec.

Pillow-based, deterministic. Reuses Montserrat + Inter from
temp/resources/fonts/. Same architectural pattern as gen_carousel_build.py
but with letter-portrait page size (1275x1650 px @ ~150 DPI), page
indicators on inner pages only, and a slightly different element vocab
(text + rect + list).

Spec format (JSON):
  {
    "angle_id": "...",
    "title": "The Pre-Pause Checklist",
    "page_size": [1275, 1650],         // optional; defaults to letter portrait
    "pages": [
      {
        "n": 1,
        "bg": "#1C1C1C",
        "show_indicator": false,        // optional; default true on inner pages
        "elements": [
          {"kind": "text", "content": "...", "font": "Montserrat-Bold",
           "size": 96, "color": "#C6F21F", "x": 100, "y": 600,
           "max_width": 1075, "line_height": 110, "align": "left"},
          {"kind": "rect", "x": 0, "y": 1600, "w": 1275, "h": 50,
           "color": "#C6F21F"},
          {"kind": "list", "items": ["...", "..."], "font": "Inter-Regular",
           "size": 36, "color": "#1C1C1C", "x": 100, "y": 400,
           "max_width": 1075, "line_height": 60, "marker": "1.",
           "marker_color": "#C6F21F", "marker_font": "Montserrat-Bold",
           "marker_size": 40, "indent": 80}
        ]
      }
    ]
  }

Run:
  python3 tools/gen_lead_magnet.py \
      --spec-file temp/outputs/assets/<angle-id>/lead_magnet_spec.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PROJECT_ROOT = Path(__file__).resolve().parent.parent
FONTS_DIR = PROJECT_ROOT / "temp" / "resources" / "fonts"

DEFAULT_PAGE_W = 1275
DEFAULT_PAGE_H = 1650
DEFAULT_BG = "#FFFFFF"
DEFAULT_INDICATOR_FONT = "Inter-Medium"
DEFAULT_INDICATOR_SIZE = 22
DEFAULT_LINE_HEIGHT_RATIO = 1.2

FONT_FILES: dict[str, str] = {
    "Montserrat-Bold": "Montserrat-Bold.ttf",
    "Montserrat-SemiBold": "Montserrat-SemiBold.ttf",
    "Montserrat-Medium": "Montserrat-Medium.ttf",
    "Inter-Regular": "Inter-Regular.ttf",
    "Inter-Medium": "Inter-Medium.ttf",
    "Inter-SemiBold": "Inter-SemiBold.ttf",
}

LIGHT_BACKGROUNDS = {"#F5F5F5", "#FFFFFF", "#FFF", "#C6F21F", "#E9E1D8"}


def _font_path(name: str) -> Path:
    fname = FONT_FILES.get(name)
    if not fname:
        sys.exit(f"Unknown font alias '{name}'. Known: {sorted(FONT_FILES)}")
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
    text: str, font: ImageFont.FreeTypeFont, max_width: int,
    draw: ImageDraw.ImageDraw,
) -> list[str]:
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
    color = el.get("color", "#1C1C1C")
    x = el.get("x", 100)
    y = el.get("y", 100)
    max_width = el.get("max_width", DEFAULT_PAGE_W - 2 * x)
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


def _draw_list(draw: ImageDraw.ImageDraw, el: dict) -> None:
    """Numbered or bulleted list with a colored marker.

    `marker` is either a literal string (e.g. "•", "→") used for every item,
    or "1." which auto-numbers (1., 2., 3., ...).
    """
    items: list[str] = el.get("items", [])
    if not items:
        return
    item_font = _load_font(el.get("font", "Inter-Regular"), el.get("size", 32))
    item_color = el.get("color", "#1C1C1C")
    marker_font = _load_font(
        el.get("marker_font", "Montserrat-Bold"),
        el.get("marker_size", el.get("size", 32)),
    )
    marker_color = el.get("marker_color", "#C6F21F")
    raw_marker = el.get("marker", "1.")
    auto_number = raw_marker.strip() == "1."

    x = el.get("x", 100)
    y = el.get("y", 100)
    indent = el.get("indent", 70)
    max_width = el.get("max_width", DEFAULT_PAGE_W - 2 * x) - indent
    line_height = el.get("line_height") or int(el.get("size", 32) * DEFAULT_LINE_HEIGHT_RATIO)
    item_spacing = el.get("item_spacing", line_height // 2)

    cur_y = y
    for i, item in enumerate(items):
        marker_text = f"{i + 1}." if auto_number else raw_marker
        draw.text((x, cur_y), marker_text, fill=marker_color, font=marker_font)
        lines = _wrap_lines(item, item_font, max_width, draw)
        for j, line in enumerate(lines):
            draw.text((x + indent, cur_y + j * line_height), line,
                      fill=item_color, font=item_font)
        cur_y += line_height * len(lines) + item_spacing


def _draw_page_indicator(
    draw: ImageDraw.ImageDraw, n: int, total: int, bg: str,
    page_w: int, page_h: int,
) -> None:
    text = f"{n:02d} / {total:02d}"
    font = _load_font(DEFAULT_INDICATOR_FONT, DEFAULT_INDICATOR_SIZE)
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    color = "#1C1C1C" if bg.upper() in LIGHT_BACKGROUNDS else "#FFFFFF"
    draw.text((page_w - 100 - w, page_h - 70), text, fill=color, font=font)


def render_page(page: dict, total: int, page_w: int, page_h: int) -> Image.Image:
    bg = page.get("bg", DEFAULT_BG)
    img = Image.new("RGB", (page_w, page_h), bg)
    draw = ImageDraw.Draw(img)

    elements = page.get("elements", [])
    # Rects first (act as backgrounds/blocks), then text/list on top.
    for el in elements:
        if el.get("kind") == "rect":
            _draw_rect(draw, el)
    for el in elements:
        kind = el.get("kind", "text")
        if kind == "text":
            _draw_text(draw, el)
        elif kind == "list":
            _draw_list(draw, el)

    n = page["n"]
    default_show = 2 <= n <= total - 1 if total > 2 else False
    if page.get("show_indicator", default_show):
        _draw_page_indicator(draw, n, total, bg, page_w, page_h)

    return img


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--spec-file", required=True)
    ap.add_argument("--out-dir", default=None,
                    help="Default = same folder as spec-file")
    ap.add_argument("--png-only", action="store_true")
    args = ap.parse_args()

    spec_path = Path(args.spec_file)
    if not spec_path.exists():
        sys.exit(f"Spec file not found: {spec_path}")

    spec = json.loads(spec_path.read_text())
    out_dir = Path(args.out_dir) if args.out_dir else spec_path.parent
    out_dir.mkdir(parents=True, exist_ok=True)

    page_size = spec.get("page_size") or [DEFAULT_PAGE_W, DEFAULT_PAGE_H]
    page_w, page_h = page_size[0], page_size[1]

    pages = spec.get("pages", [])
    if not pages:
        sys.exit("Spec has no pages.")
    total = len(pages)

    images: list[Image.Image] = []
    for page in pages:
        img = render_page(page, total, page_w, page_h)
        png_path = out_dir / f"lead_magnet_p{page['n']:02d}.png"
        img.save(png_path, "PNG")
        images.append(img)
        print(f"  rendered page {page['n']:02d} -> {png_path.name}", file=sys.stderr)

    if not args.png_only:
        pdf_path = out_dir / "lead_magnet.pdf"
        images[0].save(
            pdf_path, "PDF",
            save_all=True, append_images=images[1:],
            resolution=150,
        )
        size_kb = pdf_path.stat().st_size // 1024
        print(f"OK -> {pdf_path} ({total} pages, {size_kb} KB)")
    else:
        print(f"OK -> {total} PNGs in {out_dir}")


if __name__ == "__main__":
    main()
