"""Image preprocessing variants for the photo->SVG pipeline.

Each generator takes a BGR image (OpenCV native) and returns a numpy array
(grayscale uint8 or BGR uint8) ready to be encoded as PNG. Variants are
deliberately deterministic with no random seeds so re-running on the same
image gives identical bytes.
"""
from __future__ import annotations

import io
import os
from dataclasses import dataclass
from typing import Callable, Iterable

import cv2
import numpy as np

# Deliberate ordering: most-useful-first for the workshop dropdown.
# Names are stable and referenced from the frontend.
VARIANT_ORDER = ["original", "gray", "otsu", "adaptive", "canny", "bilateral", "depth"]


@dataclass
class Variant:
    name: str
    fn: Callable[[np.ndarray], np.ndarray]
    description: str


def _to_gray(bgr: np.ndarray) -> np.ndarray:
    if bgr.ndim == 2:
        return bgr
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)


def variant_original(bgr: np.ndarray) -> np.ndarray:
    # The source as-is (BGR), passed through so the dropdown has a baseline.
    return bgr


def variant_gray(bgr: np.ndarray) -> np.ndarray:
    return _to_gray(bgr)


def variant_otsu(bgr: np.ndarray) -> np.ndarray:
    gray = _to_gray(bgr)
    # Light Gaussian blur first to suppress JPEG noise before global threshold.
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return binary


def variant_adaptive(bgr: np.ndarray) -> np.ndarray:
    gray = _to_gray(bgr)
    # Block size scales with image size so it works on phone photos and tiny
    # crops. Force odd >= 11. C=10 is a typical "ink on paper" sweet spot.
    h, w = gray.shape[:2]
    block = max(11, (min(h, w) // 30) | 1)
    return cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, block, 10
    )


def variant_canny(bgr: np.ndarray) -> np.ndarray:
    gray = _to_gray(bgr)
    # Auto-threshold using the Otsu trick: pick high=Otsu, low=high/2.
    blurred = cv2.GaussianBlur(gray, (5, 5), 1.4)
    high, _ = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    low = high * 0.5
    edges = cv2.Canny(blurred, low, high)
    # Invert to black-on-white so it overlays sensibly on a light SVG canvas.
    return cv2.bitwise_not(edges)


def variant_bilateral(bgr: np.ndarray) -> np.ndarray:
    # Edge-preserving smoothing — flattens shading without losing the outline.
    # d=9 is a balance between speed and quality on phone-photo-sized inputs.
    return cv2.bilateralFilter(bgr, 9, 75, 75)


def variant_depth(bgr: np.ndarray) -> np.ndarray:
    # Placeholder fake-depth: bilateral-smoothed luminance, normalized to the
    # full 0-255 range so it reads as a depth map visually. Real depth (MiDaS)
    # is deferred — see PLAN.md decision B.
    gray = _to_gray(bgr)
    smooth = cv2.bilateralFilter(gray, 9, 50, 50)
    lo, hi = int(smooth.min()), int(smooth.max())
    if hi - lo < 2:
        return smooth
    norm = ((smooth.astype(np.float32) - lo) * (255.0 / (hi - lo))).clip(0, 255)
    return norm.astype(np.uint8)


VARIANTS: dict[str, Variant] = {
    "original": Variant("original", variant_original, "Source image, unchanged"),
    "gray":     Variant("gray",     variant_gray,     "Grayscale"),
    "otsu":     Variant("otsu",     variant_otsu,     "Global Otsu threshold"),
    "adaptive": Variant("adaptive", variant_adaptive, "Adaptive Gaussian threshold"),
    "canny":    Variant("canny",    variant_canny,    "Canny edges (inverted)"),
    "bilateral":Variant("bilateral",variant_bilateral,"Edge-preserving smoothed color"),
    "depth":    Variant("depth",    variant_depth,    "Luminance-as-fake-depth"),
}


def decode_image(data: bytes) -> np.ndarray:
    """Decode bytes into a BGR uint8 array. Raises ValueError on failure."""
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image (unsupported format or corrupt data)")
    return img


def encode_png(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".png", img, [cv2.IMWRITE_PNG_COMPRESSION, 6])
    if not ok:
        raise RuntimeError("PNG encode failed")
    return bytes(buf)


def write_all_variants(bgr: np.ndarray, out_dir: str, names: Iterable[str] | None = None) -> list[dict]:
    """Generate every variant and write to <out_dir>/<name>.png.

    Returns metadata: [{ name, file, width, height, bytes }].
    """
    os.makedirs(out_dir, exist_ok=True)
    selected = list(names) if names else VARIANT_ORDER
    out: list[dict] = []
    for name in selected:
        v = VARIANTS.get(name)
        if v is None:
            raise ValueError(f"Unknown variant: {name}")
        img = v.fn(bgr)
        png = encode_png(img)
        path = os.path.join(out_dir, f"{name}.png")
        with open(path, "wb") as f:
            f.write(png)
        h, w = img.shape[:2]
        out.append({
            "name": name,
            "file": f"{name}.png",
            "width": int(w),
            "height": int(h),
            "bytes": len(png),
            "description": v.description,
        })
    return out
