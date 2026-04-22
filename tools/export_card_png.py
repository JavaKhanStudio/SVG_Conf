"""One-shot: recolour card_back_Showcase.svg (borders red, eye blue)
and render it to tmp_card_red_blue.png at 600x1000."""
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
src = (ROOT / "sources" / "card_back_Showcase.svg").read_text(encoding="utf-8")

out_svg = (
    src.replace("--pyramid-color: rgb(100,155,255);", "--pyramid-color: #e74c3c;")
       .replace("--eye-color: rgb(100,255,155);",    "--eye-color: #3498db;")
)

svg_path = ROOT / "tmp_card_red_blue.svg"
html_path = ROOT / "tmp_card_render.html"
png_path = ROOT / "tmp_card_red_blue.png"

svg_path.write_text(out_svg, encoding="utf-8")
html_path.write_text(
    f"""<!doctype html><html><head><style>
html,body{{margin:0;padding:0;background:transparent;}}
svg{{display:block;width:600px;height:1000px;}}
</style></head><body>{out_svg}</body></html>""",
    encoding="utf-8",
)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 600, "height": 1000})
    page.goto(html_path.as_uri())
    page.wait_for_timeout(700)
    page.locator("svg").screenshot(path=str(png_path), omit_background=True)
    b.close()

print("wrote", png_path)
