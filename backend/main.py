"""SVG Workshop backend.

Local FastAPI service for the photo->SVG pipeline. Owns all image processing
and measurement; the Node workshop frontend is the home base and talks to this
service over HTTP. Run only when you need trace/measure/preprocess features.
"""
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from preprocess import VARIANT_ORDER, decode_image, write_all_variants
from trace import trace_png
from measure import measure as run_measure
from sample_colors import sample_colors as run_sample_colors

VERSION = "0.7.0"
CAPABILITIES = ["preprocess", "trace", "measure", "sample-colors-masked", "diagnostic-passes"]
KNOWN_PASSES = ["subject_bbox", "per_region_density", "symmetry"]
METRICS_HISTORY_CAP = 50

app = FastAPI(title="SVG Workshop backend", version=VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "ok": True,
        "version": VERSION,
        "capabilities": CAPABILITIES,
    }


@app.post("/preprocess")
async def preprocess(image: UploadFile = File(...), out_dir: str = Form(...)):
    """Decode the uploaded image, generate every reference variant, write PNGs
    into out_dir, and return their metadata. The caller (workshop server or
    svgw CLI) is responsible for choosing out_dir; the backend writes there
    blindly. out_dir must be an absolute filesystem path the backend can
    create / write to."""
    if not out_dir:
        raise HTTPException(status_code=400, detail="out_dir required")

    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty image")

    try:
        bgr = decode_image(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        variants = write_all_variants(bgr, out_dir)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"write failed: {e}")

    return {
        "ok": True,
        "out_dir": out_dir,
        "order": VARIANT_ORDER,
        "variants": variants,
    }


class TraceRequest(BaseModel):
    src_path: str
    filter_speckle: int | None = None
    mode: str | None = None
    corner_threshold: int | None = None
    length_threshold: float | None = None
    splice_threshold: int | None = None
    path_precision: int | None = None


@app.post("/trace")
def trace_endpoint(req: TraceRequest):
    """Trace a preprocessed PNG into SVG paths. The caller is responsible for
    pointing src_path at a sensible variant (canny gives detailed edges,
    otsu gives a clean silhouette). Returns just the inner <path> XML so the
    caller can wrap it in whatever group structure they want."""
    opts = {k: v for k, v in req.model_dump().items() if k != "src_path" and v is not None}
    try:
        result = trace_png(req.src_path, **opts)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except (ValueError, OSError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "ok": True,
        "src_path": req.src_path,
        "viewBox": result.view_box,
        "width": result.width,
        "height": result.height,
        "paths_xml": result.paths_xml,
        "stats": {"paths": result.path_count, "bytes": result.bytes},
    }


class MeasureRequest(BaseModel):
    svg_path: str
    ref_path: str
    label: str | None = None  # optional caller-provided tag for the history entry
    passes: list[str] | None = None  # optional diagnostic passes — see KNOWN_PASSES


def _metrics_path_for(svg_path: str) -> str:
    import os
    d = os.path.dirname(svg_path)
    base = os.path.basename(svg_path)
    return os.path.join(d, ".workshop", f"{base}.metrics.json")


def _append_metrics(svg_path: str, entry: dict) -> str:
    import json, os, time
    path = _metrics_path_for(svg_path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    history = []
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                history = json.load(f)
            if not isinstance(history, list):
                history = []
        except (json.JSONDecodeError, OSError):
            history = []
    history.append(entry)
    history = history[-METRICS_HISTORY_CAP:]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(history, f, indent=2)
    return path


@app.post("/measure")
def measure_endpoint(req: MeasureRequest):
    """Score a candidate SVG against a reference photo. Appends to a per-SVG
    metrics history file (.workshop/<svg-basename>.metrics.json, capped at
    the most recent 50 entries) so the agent can plot improvement over runs."""
    import os, time
    if not os.path.isfile(req.svg_path):
        raise HTTPException(status_code=404, detail=f"svg not found: {req.svg_path}")
    if not os.path.isfile(req.ref_path):
        raise HTTPException(status_code=404, detail=f"reference not found: {req.ref_path}")
    try:
        m = run_measure(req.svg_path, req.ref_path, passes=req.passes)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    entry = {
        "ts": int(time.time()),
        "label": req.label,
        "ref_path": req.ref_path,
        "outline_iou": m.outline_iou,
        "pixel_iou": m.pixel_iou,
        "edge_ssim": m.edge_ssim,
        "target_size": list(m.target_size),
    }
    if m.passes is not None:
        entry["passes"] = m.passes
    history_path = _append_metrics(req.svg_path, entry)
    return {"ok": True, "history_path": history_path, **entry}


class SampleColorsRequest(BaseModel):
    svg_path: str
    ref_path: str


@app.post("/sample-colors")
def sample_colors_endpoint(req: SampleColorsRequest):
    """For every named path (id or class) in the candidate SVG, suggest a
    flat fill color sampled from the reference photo. Backend doesn't write
    to the SVG — the agent reads suggestions and edits the corresponding
    --<region>-color CSS variables itself."""
    import os
    if not os.path.isfile(req.svg_path):
        raise HTTPException(status_code=404, detail=f"svg not found: {req.svg_path}")
    if not os.path.isfile(req.ref_path):
        raise HTTPException(status_code=404, detail=f"reference not found: {req.ref_path}")
    try:
        suggestions = run_sample_colors(req.svg_path, req.ref_path)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {
        "ok": True,
        "svg_path": req.svg_path,
        "ref_path": req.ref_path,
        "suggestions": [
            {
                "region": s.region,
                "region_kind": s.region_kind,
                "color": s.color,
                "confidence": s.confidence,
                "pixels_sampled": s.pixels_sampled,
                "shapes_in_region": s.shapes_in_region,
            }
            for s in suggestions
        ],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5174)
