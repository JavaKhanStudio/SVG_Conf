"""Measure how close a candidate SVG is to a reference photo.

Two-tier metric set:

DEFAULT (always returned, fast, global):
  outline_iou — strict 1-to-1 outline match. Canny edges on both, IoU on
                edge pixels (after a small dilation so we tolerate ±1px
                misalignment). Primary metric for the agent loop.
  pixel_iou   — loose silhouette overlap. Both images binarized at a fixed
                threshold and downsampled, then IoU. Catches gross shape
                disagreement that outline matching can miss when edges are
                sparse.
  edge_ssim   — structural similarity on the Canny edge maps. Layout-
                sensitive tiebreaker.

OPTIONAL DIAGNOSTIC PASSES (opt-in via `passes=[...]`):
  subject_bbox        — global silhouette bbox (Otsu of both images).
                        Catches proportion mismatches (e.g. your bottle
                        is taller-and-narrower than the real one). The
                        global IoUs can stay flat while aspect_ratio_diff
                        screams.
  per_region_density  — Canny edge density per named region. For each
                        named SVG region, compares edges-per-pixel
                        between the reference photo (inside that
                        region's mask) and the candidate's render
                        (inside the same mask). Tells the agent which
                        region is under-detailed (your_density < ref_density)
                        or over-drawn (the inverse).
  symmetry            — Mirror-SSIM on the candidate. For subjects that
                        should be left-right symmetric (bottle, vase,
                        face, axisymmetric object), low symmetry score
                        is a flag that the geometry is lopsided.

All inputs/outputs use OpenCV BGR uint8 ndarrays. The reference and the
rasterized candidate are aligned to the same target size before comparison.
"""
from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np
from skimage.metrics import structural_similarity as ssim

from svg_render import rasterize_svg

# Comparison resolution. Big enough to keep edge detail meaningful, small
# enough that metrics run in a fraction of a second on phone-sized photos.
TARGET_LONG_SIDE = 768

# Canny thresholds — auto-derived per image, but bounded so we don't go
# crazy on completely blank inputs.
_CANNY_BLUR = (5, 5)


@dataclass
class Metrics:
    outline_iou: float
    pixel_iou: float
    edge_ssim: float
    target_size: tuple[int, int]  # (w, h) used for comparison
    passes: dict | None = None    # optional diagnostic pass results


def _resize_to_target(img: np.ndarray, target_w: int, target_h: int) -> np.ndarray:
    h, w = img.shape[:2]
    if (w, h) == (target_w, target_h):
        return img
    return cv2.resize(img, (target_w, target_h), interpolation=cv2.INTER_AREA)


def _to_gray(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img


def _auto_canny(gray: np.ndarray) -> np.ndarray:
    blurred = cv2.GaussianBlur(gray, _CANNY_BLUR, 1.4)
    high, _ = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    high = max(40, min(int(high), 220))
    low = int(high * 0.5)
    return cv2.Canny(blurred, low, high)


def _iou(mask_a: np.ndarray, mask_b: np.ndarray) -> float:
    inter = np.logical_and(mask_a, mask_b).sum()
    union = np.logical_or(mask_a, mask_b).sum()
    return float(inter) / float(union) if union else 0.0


def _outline_iou(gray_a: np.ndarray, gray_b: np.ndarray) -> float:
    edge_a = _auto_canny(gray_a)
    edge_b = _auto_canny(gray_b)
    # Dilate slightly so a 1-2px alignment drift doesn't tank the score.
    kernel = np.ones((3, 3), np.uint8)
    da = cv2.dilate(edge_a, kernel, iterations=1)
    db = cv2.dilate(edge_b, kernel, iterations=1)
    return _iou(da > 0, db > 0)


def _pixel_iou(gray_a: np.ndarray, gray_b: np.ndarray) -> float:
    # Otsu binarize each separately, then IoU on the dark regions
    # (subject vs background — assumes the SVG draws dark on light).
    _, ba = cv2.threshold(gray_a, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    _, bb = cv2.threshold(gray_b, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return _iou(ba > 0, bb > 0)


def _edge_ssim(gray_a: np.ndarray, gray_b: np.ndarray) -> float:
    edge_a = _auto_canny(gray_a)
    edge_b = _auto_canny(gray_b)
    # Soften the binary maps so SSIM, which is gradient-sensitive, has
    # something continuous to compare. Otherwise it collapses on bare 0/255.
    sa = cv2.GaussianBlur(edge_a, (7, 7), 1.5)
    sb = cv2.GaussianBlur(edge_b, (7, 7), 1.5)
    score = ssim(sa, sb, data_range=255)
    # SSIM is in [-1, 1]; clamp to [0, 1] so all metrics share a scale.
    return max(0.0, float(score))


def measure(svg_path: str, ref_path: str, passes: list[str] | None = None) -> Metrics:
    """Compare a workshop SVG against a reference image. Returns Metrics.

    If `passes` is given, also runs the named diagnostic passes — see the
    module docstring for what each catches. Unknown pass names are silently
    skipped (forward-compatible with future additions).
    """
    ref = cv2.imread(ref_path, cv2.IMREAD_COLOR)
    if ref is None:
        raise FileNotFoundError(f"could not read reference image: {ref_path}")

    rh, rw = ref.shape[:2]
    if max(rw, rh) > TARGET_LONG_SIDE:
        scale = TARGET_LONG_SIDE / float(max(rw, rh))
        target_w, target_h = int(rw * scale), int(rh * scale)
    else:
        target_w, target_h = rw, rh

    candidate = rasterize_svg(svg_path, target_w=target_w, target_h=target_h)
    candidate = _resize_to_target(candidate, target_w, target_h)

    ref_resized = _resize_to_target(ref, target_w, target_h)
    g_cand = _to_gray(candidate)
    g_ref = _to_gray(ref_resized)

    passes_out: dict | None = None
    if passes:
        from diagnostic_passes import run_passes
        passes_out = run_passes(passes, svg_path, ref, candidate, g_ref, g_cand,
                                target_w, target_h)

    return Metrics(
        outline_iou=_outline_iou(g_cand, g_ref),
        pixel_iou=_pixel_iou(g_cand, g_ref),
        edge_ssim=_edge_ssim(g_cand, g_ref),
        target_size=(target_w, target_h),
        passes=passes_out,
    )
