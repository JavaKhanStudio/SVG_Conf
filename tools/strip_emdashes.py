r"""Replace em-dashes (U+2014) in user-facing site files.

Context-aware:
  - " -- " inside prose     -> ", "
  - " --" / "-- " at bounds -> single comma
  - "\w+ -- [A-Z...]"        (looks like Title -- Subtitle) -> " : "
  - bullet "-- item"         -> "" (strip leading dash)

Dry-runs by default; pass --write to apply.
"""
import re
import sys
from pathlib import Path

# Files the user will see rendered on the site. Skip MD docs, svgw CLI,
# server, skill docs — those are internal.
TARGETS = [
    "index.html",
    "stories.html",
    "story-part1.html",
    "story-part2.html",
    "bezier.html",
    "svg-anatomy.html",
    "what-is-svg.html",
    "animations.html",
    "concepts.html",
    "gallery.html",
    "live-demo.html",
    "make-svg.html",
    "workshop.html",
    "js/main.js",
    "parts/header.html",
    "parts/footer.html",
]

# Match "Xxx — Yyy" where Xxx ends in a word character and Yyy starts with a
# capital letter -> probably a title/subtitle separator. Replace with " : ".
TITLE_RE = re.compile(r"(\w)\s+—\s+([A-ZÀ-Ö])")
# Match generic " — " in prose -> ", "
PROSE_RE = re.compile(r"\s+—\s+")
# Leading "— word" (e.g. at start of an attribute or line) -> just strip
LEADING_RE = re.compile(r"(^|[>\n])\s*—\s+")
# Single em-dash after a word boundary but no surrounding spaces (rare)
NAKED_RE = re.compile(r"—")


def transform(text: str) -> tuple[str, int]:
    before = text.count("\u2014")
    text = TITLE_RE.sub(r"\1 : \2", text)
    text = LEADING_RE.sub(r"\1", text)
    text = PROSE_RE.sub(", ", text)
    text = NAKED_RE.sub(",", text)
    after = text.count("\u2014")
    return text, before - after


def main():
    write = "--write" in sys.argv
    root = Path(__file__).resolve().parent.parent
    total = 0
    for rel in TARGETS:
        p = root / rel
        if not p.exists():
            continue
        raw = p.read_text(encoding="utf-8")
        new, n = transform(raw)
        if n == 0:
            continue
        total += n
        print(f"{rel}: {n} replaced")
        if write:
            p.write_text(new, encoding="utf-8")
    print(f"total: {total}")
    if not write:
        print("(dry-run — pass --write to apply)")


if __name__ == "__main__":
    main()
