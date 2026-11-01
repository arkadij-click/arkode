"""Build app/glyphs.js: catalog metadata plus two faces for every glyph.

- font:  the drawn typeface, SVG from app/glyphs_svg (made by design.py)
- photo: the A16 source crop with paper and red guide lines removed,
         kept for comparing the drawing against the author's original

Usage (from the arkode folder):
    python app/tools/design.py
    python app/tools/build_glyphs.py
"""
import base64
import io
import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PKG = ROOT / "author_script_developer_package" / "language_handoff"
OUT = ROOT / "app" / "glyphs.js"
PREVIEW = ROOT / "app" / "tools" / "preview.png"
SVG_DIR = ROOT / "app" / "glyphs_svg"

# Thresholds are relative to each crop: 0 = darkest ink, 1 = paper (median).
# Below INK_FULL the pixel is solid ink, above PAPER it is transparent.
INK_FULL = 0.3
PAPER = 0.62
# Components touching the left/right edge narrower than this are neighbour traces.
EDGE_TRACE_MAX = 0.18


def ink_alpha(img):
    rgb = img.convert("RGB")
    w, h = rgb.size
    alpha = Image.new("L", (w, h), 0)
    src, dst = rgb.load(), alpha.load()
    levels = sorted(max(src[x, y]) for y in range(h) for x in range(w)
                    if src[x, y][0] - max(src[x, y][1:]) <= 45)
    ink, paper = levels[len(levels) // 100], levels[len(levels) // 2]
    full = ink + INK_FULL * (paper - ink)
    clear = ink + PAPER * (paper - ink)
    for y in range(h):
        for x in range(w):
            r, g, b = src[x, y]
            m = max(r, g, b)
            # reddish pixels are guide lines, never ink
            if r - max(g, b) > 45:
                continue
            if m <= full:
                dst[x, y] = 255
            elif m < clear:
                dst[x, y] = int(255 * (clear - m) / (clear - full))
    return alpha


def drop_edge_traces(alpha):
    """Remove ink blobs that only exist because the crop touched a neighbour cell."""
    w, h = alpha.size
    px = alpha.load()
    seen = [[False] * w for _ in range(h)]
    for sy in range(h):
        for sx in range(w):
            if seen[sy][sx] or px[sx, sy] < 60:
                continue
            stack, comp = [(sx, sy)], []
            seen[sy][sx] = True
            while stack:
                x, y = stack.pop()
                comp.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny][nx] and px[nx, ny] >= 60:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            xs = [p[0] for p in comp]
            ys = [p[1] for p in comp]
            touches = min(xs) <= 1 or max(xs) >= w - 2 or min(ys) <= 1 or max(ys) >= h - 2
            small = (max(xs) - min(xs)) < w * EDGE_TRACE_MAX and (max(ys) - min(ys)) < h * 0.5
            # flat strip along top/bottom edge: bottom of the cell above / top of the cell below
            flat = (min(ys) <= 3 or max(ys) >= h - 4) and (max(ys) - min(ys)) < h * 0.1
            if (touches and small) or flat:
                for x, y in comp:
                    px[x, y] = 0
    # faint halo left around removed blobs
    for y in range(h):
        for x in range(w):
            if px[x, y] < 25:
                px[x, y] = 0
    return alpha


def build(entry):
    img = Image.open(PKG / entry["source_crop_png"])
    alpha = drop_edge_traces(ink_alpha(img))
    w, h = alpha.size
    bbox = alpha.getbbox() or (0, 0, w, h)
    # trim horizontally to the ink, keep full cell height so glyphs share a centre line
    pad = 3
    left, right = max(0, bbox[0] - pad), min(w, bbox[2] + pad)
    alpha = alpha.crop((left, 0, right, h))
    out = Image.new("RGBA", alpha.size, (28, 26, 24, 0))
    out.putalpha(alpha)
    buf = io.BytesIO()
    out.save(buf, "PNG", optimize=True)
    return out, {
        "id": entry["asset_id"],
        "row": entry["row"],
        "kind": entry["kind"],
        "name": entry["name_ru"],
        "meaning": entry["meaning_ru"],
        "status": entry["meaning_status"],
        "variantOf": entry["variant_of_candidate"],
        "endsText": entry["suggested_character_id"].startswith("p.text-end"),
        "photo": {
            "width": out.width,
            "height": out.height,
            "src": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
        },
    }


def vector(gid):
    """Drawn typeface glyph from design.py; intrinsic size x4 so canvas scaling stays sharp."""
    svg = (SVG_DIR / f"{gid}.svg").read_text(encoding="utf-8").strip()
    w = float(re.search(r'width="([\d.]+)"', svg).group(1))
    h = float(re.search(r'height="([\d.]+)"', svg).group(1))
    big = re.sub(r'width="[\d.]+" height="[\d.]+"', f'width="{w * 4:g}" height="{h * 4:g}"', svg, count=1)
    return {"width": w, "height": h, "src": "data:image/svg+xml;base64," + base64.b64encode(big.encode()).decode()}


def main():
    catalog = json.loads((PKG / "catalog" / "glyphs.json").read_text(encoding="utf-8"))
    images, glyphs = [], []
    for entry in catalog["glyphs"]:
        im, g = build(entry)
        g["font"] = vector(g["id"])
        images.append((g["id"], im))
        glyphs.append(g)
    header = (
        "// Generated by tools/build_glyphs.py: drawn typeface (glyphs_svg, from design.py)\n"
        "// plus cleaned A16 photo crops for comparison. Each face: src, width, height.\n"
    )
    OUT.write_text(
        header + "window.GLYPH_SET = " + json.dumps(
            {"catalogVersion": catalog["catalog_version"], "faces": {"font": "прорисовка", "photo": "фото A16"},
             "glyphs": glyphs},
            ensure_ascii=False, indent=1) + ";\n",
        encoding="utf-8")

    # contact sheet for eyeballing the cleanup
    cell = 150
    sheet = Image.new("RGB", (cell * 8, cell * ((len(images) + 7) // 8)), "white")
    for i, (_, im) in enumerate(images):
        sheet.paste(im, ((i % 8) * cell + 5, (i // 8) * cell + 5), im)
    sheet.save(PREVIEW)
    print(f"wrote {OUT} ({len(glyphs)} glyphs), preview {PREVIEW}", file=sys.stderr)


if __name__ == "__main__":
    main()
