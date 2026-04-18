"""Suggest a flat fill color for each named region of a candidate SVG.

For each region (id or class), we render a binary mask containing **only**
that region's shapes, then sample the reference photo at the masked pixels
and pick the dominant color via k-means. Catches the actual painted shape
— sliver paths, concave outlines, multi-shape classes, even non-path
elements like <rect>/<circle>/<polygon> — instead of the bbox-naive
sampling that pulled in lots of background pixels.

Pipeline per region:

  1. Collect every named element (path/rect/circle/ellipse/polygon/polyline)
     with that id (always one) or class (often many) that isn't under
     #trace-ref.
  2. Build a minimal SVG with the same viewBox containing only those
     elements, with a CSS override forcing solid black fill on transparent.
  3. Rasterize to the reference's pixel resolution via resvg.
  4. Mask = (rasterized alpha > threshold). Use it to extract pixels from
     the reference image.
  5. k-means k=3 → return the largest-cluster centroid as #rrggbb.

Regions whose mask covers fewer than ~50 pixels are skipped (typical for
sliver outlines that rasterize to nothing at ref scale).

Caveat: group transforms are still ignored. The ElementTree serialization
preserves them on serialized children, but the parent <g transform=...>
isn't applied since we strip elements out of their groups. Hand-authored
workshop SVGs typically keep paths at root level with absolute coords, so
this is fine in practice.
"""
from __future__ import annotations

import re
from collections import OrderedDict
from dataclasses import dataclass
from xml.etree import ElementTree as ET

import cv2
import numpy as np
import resvg_py

# Make ET emit clean <path> instead of <ns0:path> when serializing children.
ET.register_namespace("", "http://www.w3.org/2000/svg")

SVG_NS = "{http://www.w3.org/2000/svg}"
TRACE_REF_ID = "trace-ref"
SHAPE_TAGS = {"path", "rect", "circle", "ellipse", "polygon", "polyline"}
SAMPLE_PIXEL_CAP = 5000
KMEANS_K = 3
MIN_MASK_PIXELS = 50
ALPHA_THRESHOLD = 32

# CSS override forcing every element in the mini-SVG to render as a solid
# black mask, regardless of attribute fills/strokes/opacities. !important
# beats SVG presentation attributes per the spec, so this is reliable.
_MASK_STYLE = (
    "<style>"
    "*{fill:#000 !important;stroke:none !important;opacity:1 !important;"
    "display:inline !important;visibility:visible !important;}"
    "</style>"
)


@dataclass
class ColorSuggestion:
    region: str
    region_kind: str  # 'id' or 'class'
    color: str        # '#rrggbb'
    confidence: float
    pixels_sampled: int
    shapes_in_region: int


def _viewbox(root: ET.Element) -> tuple[float, float, float, float]:
    vb = root.get("viewBox")
    if vb:
        x, y, w, h = (float(v) for v in re.split(r"[\s,]+", vb.strip())[:4])
        return x, y, w, h
    w = float(root.get("width", 300))
    h = float(root.get("height", 150))
    return 0.0, 0.0, w, h


def _build_parent_map(root: ET.Element) -> dict:
    return {id(child): parent for parent in root.iter() for child in parent}


def _is_under_trace_ref(elem: ET.Element, parents: dict) -> bool:
    cur = elem
    while cur is not None:
        if cur.get("id") == TRACE_REF_ID:
            return True
        cur = parents.get(id(cur))
    return False


def _local_tag(elem: ET.Element) -> str:
    t = elem.tag
    return t.split("}", 1)[-1] if "}" in t else t


def _collect_named_shapes(root: ET.Element) -> "OrderedDict[tuple[str, str], list[ET.Element]]":
    """Returns {(kind, region_name): [elements]} preserving document order.

    `kind` is 'id' (always one entry) or 'class' (often many). When a shape
    carries both, prefer the id — matches the rule the agent uses to wire
    --<region>-color CSS variables.
    """
    parents = _build_parent_map(root)
    by_region: "OrderedDict[tuple[str, str], list[ET.Element]]" = OrderedDict()
    for elem in root.iter():
        if _local_tag(elem) not in SHAPE_TAGS:
            continue
        if _is_under_trace_ref(elem, parents):
            continue
        rid = elem.get("id")
        rclasses = (elem.get("class") or "").strip().split()
        if rid:
            key = ("id", rid)
        elif rclasses:
            key = ("class", rclasses[0])
        else:
            continue
        by_region.setdefault(key, []).append(elem)
    return by_region


def _serialize_shape(elem: ET.Element) -> str:
    # Strip filter/clip-path/mask attrs that could prevent the mask from
    # rendering — we want raw geometry. Don't strip transform (rare on
    # individual shapes, but valid SVG).
    clone = ET.Element(elem.tag, dict(elem.attrib))
    for drop in ("filter", "clip-path", "mask", "style"):
        clone.attrib.pop(drop, None)
    return ET.tostring(clone, encoding="unicode")


def _render_mask(elements: list[ET.Element], vb: tuple[float, float, float, float],
                 target_w: int, target_h: int) -> np.ndarray | None:
    vb_str = f"{vb[0]} {vb[1]} {vb[2]} {vb[3]}"
    inner = "".join(_serialize_shape(e) for e in elements)
    svg = (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb_str}">'
        f"{_MASK_STYLE}{inner}</svg>"
    )
    try:
        png_bytes = bytes(resvg_py.svg_to_bytes(
            svg_string=svg, width=int(target_w), height=int(target_h)
        ))
    except Exception:
        return None
    arr = np.frombuffer(png_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
    if img is None:
        return None
    if img.ndim == 2:
        return img > 0
    if img.shape[2] == 4:
        return img[:, :, 3] > ALPHA_THRESHOLD
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return gray < (255 - ALPHA_THRESHOLD)


def _dominant_color_bgr(pixels: np.ndarray) -> tuple[tuple[int, int, int], float]:
    if pixels.size == 0:
        return (0, 0, 0), 0.0
    n = pixels.shape[0]
    if n > SAMPLE_PIXEL_CAP:
        idx = np.random.default_rng(0).choice(n, SAMPLE_PIXEL_CAP, replace=False)
        pixels = pixels[idx]
        n = SAMPLE_PIXEL_CAP

    data = pixels.astype(np.float32)
    k = min(KMEANS_K, max(1, n))
    if k == 1:
        c = data.mean(axis=0).astype(int)
        return (int(c[0]), int(c[1]), int(c[2])), 1.0

    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0)
    _, labels, centers = cv2.kmeans(data, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(labels.flatten(), minlength=k)
    biggest = int(np.argmax(counts))
    c = centers[biggest].astype(int)
    return (int(c[0]), int(c[1]), int(c[2])), float(counts[biggest] / counts.sum())


def _bgr_to_hex(bgr: tuple[int, int, int]) -> str:
    b, g, r = bgr
    return f"#{r:02x}{g:02x}{b:02x}"


def sample_colors(svg_path: str, ref_path: str) -> list[ColorSuggestion]:
    tree = ET.parse(svg_path)
    root = tree.getroot()
    vb = _viewbox(root)

    # Same alpha handling as measure.py — composite transparent PNGs onto
    # white so colour sampling sees the actual visual pixels rather than
    # cv2's black-out-the-alpha default.
    from svg_render import composite_on_white
    ref = cv2.imread(ref_path, cv2.IMREAD_UNCHANGED)
    if ref is None:
        raise FileNotFoundError(f"could not read reference image: {ref_path}")
    ref = composite_on_white(ref)
    rh, rw = ref.shape[:2]

    by_region = _collect_named_shapes(root)
    suggestions: list[ColorSuggestion] = []

    for (kind, region), elements in by_region.items():
        mask = _render_mask(elements, vb, rw, rh)
        if mask is None:
            continue
        if mask.shape[:2] != (rh, rw):
            mask = cv2.resize(mask.astype(np.uint8), (rw, rh),
                              interpolation=cv2.INTER_NEAREST).astype(bool)

        n = int(mask.sum())
        if n < MIN_MASK_PIXELS:
            continue
        pixels = ref[mask]
        bgr, conf = _dominant_color_bgr(pixels)
        suggestions.append(ColorSuggestion(
            region=region,
            region_kind=kind,
            color=_bgr_to_hex(bgr),
            confidence=conf,
            pixels_sampled=n,
            shapes_in_region=len(elements),
        ))

    return suggestions
