"""Find which paths in leprechaun.svg geometrically belong to the
small clover on the hat (the user's target — there are other green
elements scattered across the image, so we cluster).
"""
import re, sys, json
from pathlib import Path
from collections import Counter

import numpy as np
from sklearn.cluster import DBSCAN
import svgpathtools

SVG = Path(r"C:\Users\Simon\Documents\SVG_Designer\gallery\leprechaun.svg")
text = SVG.read_text(encoding='utf-8')

PATH_RE = re.compile(
    r'<path\b([^>]*?)\bd\s*=\s*"([^"]+)"([^>]*?)/?>',
    re.S
)

def attr(s, name):
    m = re.search(rf'\b{name}\s*=\s*"([^"]*)"', s)
    return m.group(1) if m else None

paths = []
for m in PATH_RE.finditer(text):
    pre, d, post = m.group(1), m.group(2), m.group(3)
    cls = attr(pre + post, 'class') or ''
    try:
        p = svgpathtools.parse_path(d)
        if not p:
            continue
        bbox = p.bbox()
        cx = (bbox[0] + bbox[1]) / 2
        cy = (bbox[2] + bbox[3]) / 2
        size = max(bbox[1] - bbox[0], bbox[3] - bbox[2])
        paths.append({
            'class': cls,
            'bbox': bbox,
            'centroid': (cx, cy),
            'size': size,
            'span_match': m.span(),
        })
    except Exception:
        pass

# Cluster clover-green paths by centroid; pick the densest cluster.
cg = [p for p in paths if 'clover-green' in p['class']]
print(f"clover-green path count: {len(cg)}")
print(f"clover-green centroid spread: x in [{min(p['centroid'][0] for p in cg):.0f}, "
      f"{max(p['centroid'][0] for p in cg):.0f}], "
      f"y in [{min(p['centroid'][1] for p in cg):.0f}, "
      f"{max(p['centroid'][1] for p in cg):.0f}]")

X = np.array([p['centroid'] for p in cg])
db = DBSCAN(eps=80, min_samples=4).fit(X)
labels = db.labels_

clusters = Counter(labels)
print(f"\nClusters found (label, count):")
for lbl, n in clusters.most_common():
    print(f"  {lbl}: {n}")

# Evaluate each cluster: bbox + density + median path size
best = None
for lbl in set(labels):
    if lbl == -1:
        continue
    members = [cg[i] for i in range(len(cg)) if labels[i] == lbl]
    xs = [p['centroid'][0] for p in members]
    ys = [p['centroid'][1] for p in members]
    bbox_w = max(xs) - min(xs)
    bbox_h = max(ys) - min(ys)
    print(f"  cluster {lbl}: {len(members)} paths, bbox {bbox_w:.0f}x{bbox_h:.0f} centred ({np.mean(xs):.0f}, {np.mean(ys):.0f})")

# The clover on the hat: I expect a fairly dense, roughly square cluster
# in the upper half. Pick the cluster with highest density (paths / area).
def density(lbl):
    members = [cg[i] for i in range(len(cg)) if labels[i] == lbl]
    xs = [p['centroid'][0] for p in members]
    ys = [p['centroid'][1] for p in members]
    area = (max(xs) - min(xs) + 1) * (max(ys) - min(ys) + 1)
    return len(members) / area

candidates = [lbl for lbl in set(labels) if lbl != -1 and clusters[lbl] >= 8]
candidates.sort(key=density, reverse=True)
print(f"\nDensest candidate clusters: {candidates[:3]}")

# But user said the clover is on the hat. The hat is in the upper half
# (y < 512). Pick the densest cluster whose centroid is in y < 512.
upper_candidates = []
for lbl in candidates:
    members = [cg[i] for i in range(len(cg)) if labels[i] == lbl]
    mean_y = np.mean([p['centroid'][1] for p in members])
    if mean_y < 600:
        upper_candidates.append((lbl, mean_y, density(lbl)))
upper_candidates.sort(key=lambda t: -t[2])
print(f"\nUpper-half candidates (lbl, mean_y, density): {upper_candidates}")

if not upper_candidates:
    print("no clover-on-hat cluster found"); sys.exit(1)

target_lbl = upper_candidates[0][0]
target_members = [cg[i] for i in range(len(cg)) if labels[i] == target_lbl]
xs = [p['centroid'][0] for p in target_members]
ys = [p['centroid'][1] for p in target_members]
cx_min, cx_max = min(xs), max(xs)
cy_min, cy_max = min(ys), max(ys)

# Inflate by 8% to catch outline paths and adjacent shading
w = cx_max - cx_min; h = cy_max - cy_min
margin_x = w * 0.08; margin_y = h * 0.08
cx_min -= margin_x; cx_max += margin_x
cy_min -= margin_y; cy_max += margin_y

print(f"\nClover-on-hat bbox: x=[{cx_min:.0f}, {cx_max:.0f}], y=[{cy_min:.0f}, {cy_max:.0f}]")
print(f"Target cluster has {len(target_members)} clover-green paths")

# Find non-clover-green, non-outline paths whose centroid is in this bbox
def in_target(p):
    cx, cy = p['centroid']
    return cx_min <= cx <= cx_max and cy_min <= cy <= cy_max

suspects = [p for p in paths
            if in_target(p)
            and 'clover-green' not in p['class']
            and 'outline' not in p['class']
            and 'highlight' not in p['class']]

by_class = Counter(p['class'] for p in suspects)
print(f"\nNon-clover-green, non-outline paths inside the clover-on-hat bbox:")
for cls, n in by_class.most_common():
    print(f"  {n:4d}  class={cls!r}")

# Save spans grouped by current class
out = {}
for p in suspects:
    out.setdefault(p['class'], []).append(list(p['span_match']))
Path(r"C:\Users\Simon\Documents\SVG_Designer\tools\_clover_spans.json").write_text(json.dumps(out, indent=2))
print(f"\nSaved {sum(len(v) for v in out.values())} span ranges to _clover_spans.json")
