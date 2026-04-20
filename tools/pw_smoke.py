"""Smoke-test the merged site + workshop-app with Playwright.

Reports per-page: final URL, title, visible body length, JS/console
errors, failed network requests.
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:5173"
PAGES = [
    "/",
    "/stories.html",
    "/gallery.html",
    "/workshop.html",
    "/workshop-app/",
]


def probe(page, path):
    url = BASE + path
    errors, failures, console = [], [], []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: console.append((m.type, m.text)) if m.type in ("error", "warning") else None)
    page.on("requestfailed", lambda r: failures.append((r.url, r.failure)))

    print(f"\n=== {path} ===")
    try:
        resp = page.goto(url, wait_until="networkidle", timeout=15000)
        print(f"  http:  {resp.status if resp else 'n/a'}")
        print(f"  title: {page.title()!r}")
        body = page.evaluate("() => document.body ? document.body.innerText.length : 0")
        print(f"  body text length: {body}")
        visible_headings = page.evaluate(
            "() => [...document.querySelectorAll('h1,h2,h3')].slice(0,4).map(h => h.innerText.trim()).filter(Boolean)"
        )
        if visible_headings:
            print("  headings:")
            for h in visible_headings:
                print(f"    - {h}")
    except Exception as e:
        print(f"  NAV FAILED: {e}")

    if errors:
        print("  JS errors:")
        for e in errors:
            print(f"    ! {e}")
    if console:
        print("  console:")
        for kind, text in console[:8]:
            print(f"    [{kind}] {text}")
    if failures:
        print("  failed requests:")
        for u, f in failures[:8]:
            print(f"    x {u}  ({f})")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context()
        page = context.new_page()
        for path in PAGES:
            probe(page, path)
        browser.close()


if __name__ == "__main__":
    main()
