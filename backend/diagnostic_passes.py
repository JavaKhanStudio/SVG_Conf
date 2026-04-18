"""Optional diagnostic passes for /measure.

Each pass is a focused sanity check that the global outline_iou /
pixel_iou / edge_ssim metrics can miss. They're opt-in, return small
JSON-friendly dicts, and are documented in measure.py's module docstring
+ the svg-from-photo skill.

Adding a new pass: write `pass_<name>(...)` returning a JSON-able dict,
add it to PASSES below. Caller passes the name in the `passes` list.
"""
from __future__ import annotations

import cv2
import numpy as np
from skimage.metrics import structural_similarity as _ssim

from sample_colors import _build_parent_map, _collect_named_shapes, _render_mask, _viewbox
from xml.etree import ElementTree as ET


# ---------- helpers ----------

def _otsu_subject_mask(gray: np.ndarray) -> np.ndarray:
    """Otsu-binarize and pick the side that has fewer pixels — heuristically
    the 'subject' (lighter or darker depending on contrast direction).
    """
    _, b = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    if (b > 0).sum() > (b == 0).sum():
        b = 255 - b
    return b > 0


def _largest_component_bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    n, _, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if n <= 1:
        return None
    # stat row 0 is the background. Pick the largest non-bg component.
    areas = stats[1:, cv2.CC_STAT_AREA]
    idx = int(np.argmax(areas)) + 1
    x = int(stats[idx, cv2.CC_STAT_LEFT])
    y = int(stats[idx, cv2.CC_STAT_TOP])
    w = int(stats[idx, cv2.CC_STAT_WIDTH])
    h = int(stats[idx, cv2.CC_STAT_HEIGHT])
    return x, y, w, h


def _canny(gray: np.ndarray) -> np.ndarray:
    blurred = cv2.GaussianBlur(gray, (5, 5), 1.4)
    high, _ = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    high = max(40, min(int(high), 220))
    low = int(high * 0.5)
    return cv2.Canny(blurred, low, high)


# ---------- passes ----------

def pass_subject_bbox(svg_path, ref_bgr, cand_bgr, g_ref, g_cand, target_w, target_h):
    """Compare the bounding box + aspect ratio of the dominant subject in
    both images. Catches proportion mismatches (your bottle is taller-and-
    narrower than the real one, etc.) that outline IoU can miss because
    the silhouette mass is still roughly right."""
    ref_mask = _otsu_subject_mask(g_ref)
    cand_mask = _otsu_subject_mask(g_cand)
    ref_bbox = _largest_component_bbox(ref_mask)
    cand_bbox = _largest_component_bbox(cand_mask)
    if not ref_bbox or not cand_bbox:
        return {"ok": False, "reason": "no subject component found"}

    rx, ry, rw, rh = ref_bbox
    cx, cy, cw, ch = cand_bbox
    ref_aspect = rh / rw if rw else 0
    cand_aspect = ch / cw if cw else 0
    aspect_diff = abs(ref_aspect - cand_aspect)
    aspect_ratio_off_pct = 100 * aspect_diff / max(ref_aspect, 1e-6)

    return {
        "ok": True,
        "ref_bbox":  {"x": rx, "y": ry, "w": rw, "h": rh, "aspect_h_over_w": round(ref_aspect, 3)},
        "cand_bbox": {"x": cx, "y": cy, "w": cw, "h": ch, "aspect_h_over_w": round(cand_aspect, 3)},
        "width_ratio_yours_over_ref":  round(cw / rw, 3) if rw else None,
        "height_ratio_yours_over_ref": round(ch / rh, 3) if rh else None,
        "aspect_ratio_off_pct": round(aspect_ratio_off_pct, 1),
        "centroid_drift_px": round(float(np.hypot(
            (cx + cw / 2) - (rx + rw / 2),
            (cy + ch / 2) - (ry + rh / 2),
        )), 1),
        "_hint": (
            "If aspect_ratio_off_pct > 15 or either ratio is far from 1.0, "
            "fix the silhouette proportions before chasing IoU. "
            "centroid_drift_px > ~30 means your subject is shifted on the canvas."
        ),
    }


def pass_per_region_density(svg_path, ref_bgr, cand_bgr, g_ref, g_cand, target_w, target_h):
    """For each named SVG region, compare Canny edge density between the
    reference photo (inside that region's mask) and the candidate render
    (inside the same mask). Flags under-detailed regions
    (your_density << ref_density: you should draw more) and over-drawn
    regions (the inverse: you've added clutter the photo doesn't have)."""
    tree = ET.parse(svg_path)
    root = tree.getroot()
    vb = _viewbox(root)
    by_region = _collect_named_shapes(root)

    ref_canny = _canny(g_ref)
    cand_canny = _canny(g_cand)

    rh, rw = g_ref.shape[:2]
    out_regions = {}
    for (kind, region), elements in by_region.items():
        mask = _render_mask(elements, vb, rw, rh)
        if mask is None:
            continue
        if mask.shape[:2] != (rh, rw):
            mask = cv2.resize(mask.astype(np.uint8), (rw, rh),
                              interpolation=cv2.INTER_NEAREST).astype(bool)
        area = int(mask.sum())
        if area < 50:
            continue
        ref_edges = int(np.count_nonzero(ref_canny[mask]))
        cand_edges = int(np.count_nonzero(cand_canny[mask]))
        ref_d = ref_edges / area
        cand_d = cand_edges / area
        ratio = cand_d / ref_d if ref_d else None
        out_regions[region] = {
            "kind": kind,
            "area_px": area,
            "ref_density":  round(ref_d, 4),
            "your_density": round(cand_d, 4),
            "ratio_yours_over_ref": round(ratio, 3) if ratio is not None else None,
        }
    return {
        "ok": True,
        "regions": out_regions,
        "_hint": (
            "ratio < 0.3 → you've under-detailed this region (the photo has "
            "way more edges here). ratio > 3.0 → you've over-drawn it. "
            "ratio in [0.5, 2.0] is healthy."
        ),
    }


def pass_symmetry(svg_path, ref_bgr, cand_bgr, g_ref, g_cand, target_w, target_h):
    """Mirror-SSIM on the candidate. For subjects that should be roughly
    left-right symmetric (bottle, vase, face, centered axisymmetric object),
    low symmetry is a flag that the geometry is lopsided.

    Returns a single score in [0, 1]; ~0.95+ for clean symmetric subjects,
    <0.7 for noticeably asymmetric ones."""
    flipped = cv2.flip(g_cand, 1)
    score = _ssim(g_cand, flipped, data_range=255)
    return {
        "ok": True,
        "ssim": round(float(score), 4),
        "_hint": (
            "Use only when the subject *should* be symmetric (bottle, vase, "
            "face, axisymmetric object). Score under ~0.7 means the candidate "
            "is visibly lopsided. Don't apply to scenes (kitchens, landscapes)."
        ),
    }


PASSES = {
    "subject_bbox":       pass_subject_bbox,
    "per_region_density": pass_per_region_density,
    "symmetry":           pass_symmetry,
}


def run_passes(names, svg_path, ref_bgr, cand_bgr, g_ref, g_cand, target_w, target_h):
    out = {}
    for n in names:
        fn = PASSES.get(n)
        if fn is None:
            continue
        try:
            out[n] = fn(svg_path, ref_bgr, cand_bgr, g_ref, g_cand, target_w, target_h)
        except Exception as e:
            out[n] = {"ok": False, "error": str(e)}
    return out
