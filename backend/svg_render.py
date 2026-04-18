"""Rasterize a workshop SVG to a numpy BGR image.

resvg (the only rasterizer that installs cleanly on Windows without system
deps) doesn't honor CSS custom properties — it renders our parametric SVGs
as solid black. We work around it by inlining the :root variables before
handing the SVG to resvg: replace every `var(--name)` with its declared
value, then rasterize.

This matches the workshop's runtime behavior closely enough for measurement:
the workshop applies var values via inline styles on the rendered <svg>; we
apply them by string substitution before rasterizing. Either way, downstream
attributes resolve to their var-defined defaults.
"""
from __future__ import annotations

import os
import re

import cv2
import numpy as np
import resvg_py

# Capture each line of `--name: value;` inside any `:root { ... }` block.
# Trailing comments are stripped so they don't end up in the substituted value.
_ROOT_BLOCK_RE = re.compile(r":root\s*\{([^}]*)\}", re.DOTALL)
_DECL_RE = re.compile(r"(--[\w-]+)\s*:\s*([^;]+?)\s*;")
_COMMENT_RE = re.compile(r"/\*.*?\*/", re.DOTALL)
_VAR_RE = re.compile(r"var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+?))?\s*\)")


def extract_root_vars(svg_text: str) -> dict[str, str]:
    """Pull all :root { --name: value; } declarations across all <style> blocks."""
    out: dict[str, str] = {}
    for block in _ROOT_BLOCK_RE.findall(svg_text):
        clean = _COMMENT_RE.sub("", block)
        for name, value in _DECL_RE.findall(clean):
            out[name] = value.strip()
    return out


def inline_css_vars(svg_text: str) -> str:
    """Substitute var(--name) references with the matching :root value.

    Handles `var(--name)` and `var(--name, fallback)`. Iterates a few times
    to resolve vars that reference other vars (rare, but allowed by spec).
    Vars referenced but never declared are replaced with their fallback if
    one is provided, else left intact.
    """
    vars_map = extract_root_vars(svg_text)

    def sub(m: re.Match) -> str:
        name, fallback = m.group(1), m.group(2)
        if name in vars_map:
            return vars_map[name]
        return fallback.strip() if fallback else m.group(0)

    out = svg_text
    for _ in range(4):  # cap on resolution depth
        new = _VAR_RE.sub(sub, out)
        if new == out:
            break
        out = new
    return out


def rasterize_svg(
    svg_path: str,
    target_w: int | None = None,
    target_h: int | None = None,
) -> np.ndarray:
    """Render an SVG to a BGR uint8 numpy array.

    If target_w/target_h are given, output is forced to that size. Otherwise
    the SVG's intrinsic size is used.
    """
    if not os.path.isfile(svg_path):
        raise FileNotFoundError(svg_path)

    with open(svg_path, "r", encoding="utf-8") as f:
        svg_text = f.read()
    inlined = inline_css_vars(svg_text)

    kwargs = {}
    if target_w:
        kwargs["width"] = int(target_w)
    if target_h:
        kwargs["height"] = int(target_h)

    png_bytes = bytes(resvg_py.svg_to_bytes(svg_string=inlined, **kwargs))
    arr = np.frombuffer(png_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError("resvg produced an undecodable image")
    return img
