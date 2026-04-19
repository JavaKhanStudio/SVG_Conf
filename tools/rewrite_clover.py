"""Rewrite leprechaun.svg to give the hat clover its own palette.

Reassigns:
  - mid-green  -> clover-shade   (linked: mix=clover-green-color:-0.4)
  - gold       -> clover-yellow  (independent default, NOT linked to the ribbon gold)

Only the paths inside the hat-clover cluster bbox identified by
find_clover_paths.py are touched. Other mid-green/gold paths
elsewhere in the SVG (suit, ribbon, etc.) stay on their current class.
"""
import json, re
from pathlib import Path

SVG_PATHS = [
    Path(r"C:\Users\Simon\Documents\SVG_Designer\gallery\leprechaun.svg"),
    Path(r"C:\Users\Simon\Documents\Formation_SVG\workshop\gallery\leprechaun.svg"),
]
SPANS = Path(r"C:\Users\Simon\Documents\SVG_Designer\tools\_clover_spans.json")

spans = json.loads(SPANS.read_text())
# Sort all spans by start byte; we apply substitutions in reverse so
# offsets don't shift.
flat = []
for cls, ranges in spans.items():
    for start, end in ranges:
        flat.append((start, end, cls))
flat.sort(key=lambda t: t[0])

REWRITE_MAP = {
    'mid-green': 'clover-shade',
    'gold':      'clover-yellow',
}

def rewrite_tag(tag, old_cls, new_cls):
    # Replace the first class= containing old_cls with new_cls.
    # Defensive: only modify the class attribute, not anything else.
    return re.sub(
        rf'(\bclass\s*=\s*"){re.escape(old_cls)}(")',
        rf'\g<1>{new_cls}\g<2>',
        tag,
        count=1,
    )

ROOT_OLD = """      --clover-green-color: #77C139;
      --mid-green-color: #3a7a2a;
      --hat-green-color: #1d5d24;      /* @ws mix=mid-green-color:-0.3 */"""

ROOT_NEW = """      --clover-green-color: #77C139;
      --clover-shade-color: #3a7a2a;   /* @ws mix=clover-green-color:-0.4 */
      --clover-yellow-color: #ECC329;
      --mid-green-color: #3a7a2a;
      --hat-green-color: #1d5d24;      /* @ws mix=mid-green-color:-0.3 */"""

CLASSES_OLD = """    .clover-green   { fill: var(--clover-green-color); }
    .mid-green      { fill: var(--mid-green-color); }
    .hat-green      { fill: var(--hat-green-color); }"""

CLASSES_NEW = """    .clover-green   { fill: var(--clover-green-color); }
    .clover-shade   { fill: var(--clover-shade-color); }
    .clover-yellow  { fill: var(--clover-yellow-color); }
    .mid-green      { fill: var(--mid-green-color); }
    .hat-green      { fill: var(--hat-green-color); }"""

for svg_path in SVG_PATHS:
    text = svg_path.read_text(encoding='utf-8')

    # Patch :root + class declarations once
    if ROOT_OLD not in text:
        print(f"!! root pattern not found in {svg_path.name}")
        continue
    text2 = text.replace(ROOT_OLD, ROOT_NEW, 1)
    text2 = text2.replace(CLASSES_OLD, CLASSES_NEW, 1)

    # Apply path-tag rewrites (in REVERSE so byte offsets stay valid).
    out = list(text2)
    # Re-find spans in the modified text — the text length changed by len(ROOT_NEW)-len(ROOT_OLD) etc.
    # Simpler: re-scan for the path tags by content.  Iterate flat spans in reverse,
    # but compute each span against the ORIGINAL text and translate to text2 offsets.
    delta = len(text2) - len(text)
    # Both root insert and class insert happen near the top of the file,
    # before any path. So all path spans need the same shift = delta.
    rewrites = 0
    skipped = 0
    # Apply in reverse so offsets within text2 don't drift.
    for start, end, cls in reversed(flat):
        s2, e2 = start + delta, end + delta
        if cls not in REWRITE_MAP:
            continue
        tag = ''.join(out[s2:e2])
        new_tag = rewrite_tag(tag, cls, REWRITE_MAP[cls])
        if new_tag == tag:
            skipped += 1
            continue
        out[s2:e2] = list(new_tag)
        rewrites += 1
    new_text = ''.join(out)
    svg_path.write_text(new_text, encoding='utf-8')
    print(f"{svg_path.name}: {rewrites} path rewrites, {skipped} skipped")
