"""Render an SVG file to PNG via headless Playwright.

Usage: python tools/export_svg_png.py <input.svg> <output.png> [width] [height]

Width/height default to 2x the SVG's viewBox size (DPI-ish upscale).
Playwright keeps SMIL + CSS filter fidelity so the export matches
what a real browser draws.
"""
import re
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright


def viewbox(svg_text: str) -> tuple[float, float]:
    m = re.search(r'viewBox="([^"]+)"', svg_text)
    if not m:
        return (600.0, 600.0)
    parts = [float(x) for x in m.group(1).split()]
    return (parts[2], parts[3]) if len(parts) == 4 else (600.0, 600.0)


def main():
    if len(sys.argv) < 3:
        print(__doc__, file=sys.stderr)
        sys.exit(1)
    src = Path(sys.argv[1]).resolve()
    out = Path(sys.argv[2]).resolve()
    svg_text = src.read_text(encoding="utf-8")
    vw, vh = viewbox(svg_text)
    w = int(sys.argv[3]) if len(sys.argv) > 3 else int(vw * 2)
    h = int(sys.argv[4]) if len(sys.argv) > 4 else int(vh * 2)

    html_path = out.with_suffix(".render.html")
    html_path.write_text(
        f"""<!doctype html><html><head><style>
html,body{{margin:0;padding:0;background:transparent;}}
svg{{display:block;width:{w}px;height:{h}px;}}
</style></head><body>{svg_text}</body></html>""",
        encoding="utf-8",
    )

    with sync_playwright() as p:
        b = p.chromium.launch()
        page = b.new_page(viewport={"width": w, "height": h})
        page.goto(html_path.as_uri())
        page.wait_for_timeout(600)
        page.locator("svg").screenshot(path=str(out), omit_background=True)
        b.close()

    try:
        html_path.unlink()
    except OSError:
        pass
    print("wrote", out, f"({w}x{h})")


if __name__ == "__main__":
    main()
