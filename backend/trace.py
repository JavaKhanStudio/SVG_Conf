"""Vector tracing for the photo->SVG pipeline.

Wraps `vtracer` (Rust-backed, prebuilt wheel for Windows). Input is a PNG
already preprocessed for tracing (typically the canny or otsu variant from
.workshop/<file>.refs/). Output is the inner XML of the resulting <svg>:
just the <path> elements, ready to drop into a `<g id="trace-ref">` inside
the target working SVG.
"""
from __future__ import annotations

import os
import re
import tempfile
from dataclasses import dataclass

import vtracer

# vtracer parameter defaults that produced clean, ~100KB outputs on the
# voiture.jpg canny variant during the Phase 2 calibration pass.
DEFAULTS = dict(
    colormode="binary",
    mode="spline",            # 'spline' | 'polygon' | 'none'
    filter_speckle=8,         # discard regions smaller than N pixels
    corner_threshold=60,
    length_threshold=4.0,
    splice_threshold=45,
    path_precision=2,
)


@dataclass
class TraceResult:
    paths_xml: str
    view_box: str
    width: int
    height: int
    path_count: int
    bytes: int


_SVG_RE = re.compile(r"<svg\s([^>]*)>(.*?)</svg>", re.DOTALL)
_WIDTH_RE = re.compile(r'\bwidth="(\d+(?:\.\d+)?)"')
_HEIGHT_RE = re.compile(r'\bheight="(\d+(?:\.\d+)?)"')
_VIEWBOX_RE = re.compile(r'\bviewBox="([^"]+)"')


def trace_png(src_path: str, **opts) -> TraceResult:
    if not os.path.isfile(src_path):
        raise FileNotFoundError(src_path)
    if not src_path.lower().endswith(".png"):
        raise ValueError("src_path must be a .png")

    params = {**DEFAULTS, **opts}

    fd, out_path = tempfile.mkstemp(suffix=".svg")
    os.close(fd)
    try:
        vtracer.convert_image_to_svg_py(src_path, out_path, **params)
        with open(out_path, "r", encoding="utf-8") as f:
            svg_text = f.read()
    finally:
        try:
            os.unlink(out_path)
        except OSError:
            pass

    m = _SVG_RE.search(svg_text)
    if not m:
        raise ValueError("vtracer output missing <svg> root")
    attrs, inner = m.group(1), m.group(2).strip()

    w_m = _WIDTH_RE.search(attrs)
    h_m = _HEIGHT_RE.search(attrs)
    vb_m = _VIEWBOX_RE.search(attrs)
    width = int(float(w_m.group(1))) if w_m else 0
    height = int(float(h_m.group(1))) if h_m else 0
    view_box = vb_m.group(1) if vb_m else f"0 0 {width} {height}"

    return TraceResult(
        paths_xml=inner,
        view_box=view_box,
        width=width,
        height=height,
        path_count=inner.count("<path "),
        bytes=len(inner),
    )
