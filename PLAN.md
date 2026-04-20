# PLAN.md — Photo → SVG pipeline build

This file is the resumable handoff document. If a session is interrupted, a fresh Claude reading `CLAUDE.md` + `SPEC.md` + this file should be able to continue without losing context.

Keep this file updated: when a phase completes, mark it done and write a brief "what landed" note. When a decision changes, update the Decisions section and note the date.

---

## Goal

Turn the SVG Workshop from a previewer into a complete pipeline: a Claude Code agent works iteratively in the project folder, using computer-vision tooling and SVG measurement, to convert phone photos into proper parametric SVGs that match the source closely.

The agent is the loop. Humans use the existing workshop UI to inspect intermediate snapshots and tweak values.

Initiating user request: see `TODO.txt`.

---

## Architecture (as decided)

- **Python backend (FastAPI)** — owns all image processing and measurement. Stateless HTTP service, run locally on demand.
- **Existing JS workshop (Node static + WS)** — stays the home base. Gains a backend-status banner; non-trace features keep working when Python is down.
- **Node CLI wrapper (`svgw`)** — thin shell wrapping backend HTTP, so the agent can use natural Bash commands during iteration.
- **Static showcase site** — same codebase, repo root serves the French conference site (index/gallery/concepts/stories/workshop pages + header/footer partials), `workshop-viewer/` is a static live-editing showcase embedded on `workshop.html`, `workshop-app/` is the full interactive editor reachable at `/workshop-app/` when the server runs. All three share `src/ws-parser.js` + `src/ws-controls.js`.
- **Folder contract**:
  - Canonical parametric SVGs in `gallery/`.
  - Reference photos in `sources/` (agent pipeline inputs) and `workshop-viewer/references/` (presentation-side copies for Compare mode).
  - Per-SVG state in `gallery/.workshop/<file>.{snapshots,metrics}.json` and `gallery/.workshop/<file>.refs/<variant>.png`.
  - `.workshop/` policy: commit `*.snapshots.json`, gitignore everything else.

## Decisions log (Q&A condensed)

- **Parametric vs traced** → hybrid (b): trace produces a reference layer, agent hand-builds parametric paths over it.
- **Input** → phone photos of objects (hard case). Pipeline: grayscale + simplify for outline reference, source image for color sampling. Flat fills only, no gradients/nuance.
- **Match metric** → outline IoU is the strict 1-to-1 metric. Plus loose pixel IoU and edge-map SSIM. Multi-metric is preferred.
- **Backend tech** → Python (OpenCV / scikit-image / potrace / resvg). Pure-JS path was abandoned — too weak for the scope.
- **ML for depth** → start without ML. Use luminance / edge-density heuristics as fake depth. Reconsider MiDaS later if heuristics prove insufficient.
- **Backend optional** → workshop's existing features (load SVG, edit vars, snapshots, reference overlay using cached preprocessed variants) keep working when backend is down. Trace/measure/preprocess UIs show "start the backend" warning. Static viewer never depends on backend.
- **Agent loop** → loop lives in the agent (Claude), not in code. Skill `/svg-from-photo` documents the protocol; the agent re-runs passes itself, reading metrics between passes. No `--passes` flag, no automated multi-pass endpoint.
- **Final SVG shape** → parametric paths in the foreground; a hidden `<g id="trace-ref" display="none">` keeps the trace for re-editing. Region colors live as CSS variables (e.g. `--body-color`), workshop-tweakable.
- **Reference-image UX** → the existing "drop a photo on preview, gets stored as a translucent overlay in localStorage" flow is replaced. New flow: drop photo → backend preprocesses → variants stored under `.workshop/<file>.refs/`. Overlay panel gains a dropdown (original / gray / threshold / edges / depth) + opacity. localStorage no longer holds image bytes.
- **Static showcase** → shared parser/controls in `src/`, consumed by both the static viewer (`workshop-viewer/viewer.js` loaded from `workshop.html`) and the live editor (`workshop-app/app.js`). Modules that import backend HTTP are only used by the live editor.
- **`.workshop/` git policy** → `.workshop/*.snapshots.json` committed, everything else gitignored.

## Phases

Status legend: `[ ]` not started · `[~]` in progress · `[x]` done

### [x] Phase 0 — Foundations

Goal: backend up, frontend can detect it, agent has a CLI entry point.

What landed:
- `backend/` (FastAPI on 127.0.0.1:5174): `main.py`, `requirements.txt`, `start.sh`, `start.bat`. CORS for `http://localhost:5173`. `/health` returns `{ok, version, capabilities}`.
- Frontend: `src/backend-status.js` polls `/health` every 5s; injects a red banner at the top of the page when down. Workshop core remains usable. Server (`server.js`) now serves `/src/*` so the module loads.
- CSS for the banner added to `style.css`.
- `svgw.js` CLI in repo root with `svgw health [--json]`. `package.json` `bin` entry registers it. `SVGW_BACKEND` env var overrides the URL.
- README split into "Workshop only" / "Full pipeline" / "Agent CLI" sections.
- `.gitignore` created with the agreed `.workshop/` policy (snapshots committed, refs/metrics local-only) plus Python and IDE noise.

Verified end-to-end: backend boots, `svgw health` reports OK with expected version/capabilities, JSON mode works, down-case (wrong port) reports DOWN with exit code 1, CORS header is set for the workshop origin.

### [x] Phase 1 — Preprocessing + new reference UX

Goal: dropping a photo gets you a useful set of preprocessed variants, viewable as overlays.

What landed:
- Backend `POST /preprocess` (multipart `image` + form `out_dir`) generates 7 variants: original, gray, otsu, adaptive (Gaussian, scale-aware block size), canny (Otsu-derived auto thresholds, inverted for visual overlay), bilateral, depth (bilateral-smoothed luminance, contrast-stretched). Variants written into `out_dir`. Logic in `backend/preprocess.py`, deterministic.
- Workshop server got a proxy: `POST /api/preprocess-ref?for=<svg>` forwards to backend with computed `out_dir`. Static refs serving at `GET /refs/<svg>/<variant>.png` with name + variant validation (path traversal blocked).
- Frontend reference flow rewritten: localStorage now stores only `{variants, current, sourceName}` (metadata, no image bytes). Variant dropdown in the toolbar, hidden when no ref. Drop on preview → POST to proxy → variants saved → default to canny.
- One-shot localStorage migration deletes old `svgworkshop:*:reference` data-URL keys, gated by a `:migration:refs-v2` flag.
- `svgw preprocess <photo> --for <svg-path>`: writes into `dirname(svg)/.workshop/basename(svg).refs/`, prints variant table or `--json`.
- README + PLAN updated. Backend version bumped to 0.2.0, capabilities now `["preprocess"]`.

Verified end-to-end: `svgw preprocess sources/voiture.jpg --for examples/car.svg` produced all 7 variants. Workshop server proxy returns the same payload. `/refs/car.svg/canny.png` serves the PNG (HTTP 200). Path traversal (`/refs/../../etc/passwd`) blocked (HTTP 404), bogus variant rejected (HTTP 400). Canny + Otsu visual quality on the test photo is solid (clean car silhouette, identifiable wheel/grille/headlight edges).

### [x] Phase 2 — Tracing → trace-ref layer

Goal: produce a vector trace of the source photo, embed it inside the working SVG as a hidden reference layer.

What landed:
- Backend `POST /trace` (JSON body): `src_path` is a server-side path to a preprocessed PNG (typically the canny or otsu variant from `.workshop/`). Returns `{ paths_xml, viewBox, width, height, stats }`. Tracer is `vtracer` with calibrated defaults (filter_speckle=8, mode=spline, corner_threshold=60, length_threshold=4, splice_threshold=45, path_precision=2). All params overridable per-request. Logic in `backend/trace.py`.
- `svgw trace --src <png> --into <svg-path>`: calls /trace, then injects `<g id="trace-ref" display="none" transform="scale(...)">…paths…</g>` as the last child of the target SVG's root. Re-running replaces the existing group (idempotent). Auto-computes a scale transform so the trace's photo-resolution coords fit the target's authored viewBox.
- The injected group includes a scoped `<style>` rule (`#trace-ref path { fill: none !important; stroke: #ff00ff; stroke-width: 0.5; vector-effect: non-scaling-stroke; opacity: 0.85; }`) so the trace renders as a magenta hairline alignment reference rather than a black silhouette.
- Frontend toolbar gained a "Trace" toggle that's hidden unless the loaded SVG contains `#trace-ref`. Toggling flips the group's `display` between `inline` and `none` at runtime via inline style on the rendered SVG. Toggle resets to off whenever a fresh SVG loads.
- Backend version bumped to 0.3.0; capabilities now `["preprocess", "trace"]`.

Verified: `svgw trace --src examples/.workshop/car.svg.refs/canny.png --into examples/car_traced.svg --speckle 8` injected 203 paths (~103KB) with auto-scale `scale(0.207 0.196)` for the 600×400 target viewBox over the 2903×2045 trace coords. Re-running with otsu (--speckle 16) replaced the group cleanly. UI toggle wiring is in place but **not browser-tested in this headless environment**.

`examples/car_traced.svg` is left in the repo as a demo file showing the trace-ref pattern. Delete it freely — re-runnable from sources/voiture.jpg.

### [x] Phase 3 — Measurement

Goal: numeric quality scores so the agent can iterate purposefully.

What landed:
- Backend `POST /measure` (JSON body): `{ svg_path, ref_path, label? }`. Rasterizes the candidate SVG at the reference's resolution (long side capped at 768 for speed), computes three metrics, appends to history.
  - `outline_iou` — Canny on both, IoU on edge pixels with a 1px dilation tolerance. The strict 1-to-1 metric.
  - `pixel_iou` — Otsu-binarized silhouette IoU. Loose, catches gross shape disagreement.
  - `edge_ssim` — SSIM on the (Gaussian-softened) Canny edge maps. Sensitive to layout, not exact pixels. Useful tiebreaker.
- Rasterization: resvg-py (clean Windows install, no system deps). resvg doesn't honor CSS custom properties, so we inline `:root` declarations into every `var(--name)` call before handing it to the renderer (`backend/svg_render.py`). Matches the workshop's runtime variable resolution closely enough for measurement.
- History persisted at `<dir-of-svg>/.workshop/<basename>.metrics.json`, capped at the last 50 entries.
- Workshop server got `GET /api/metrics/<svg>` and `POST /api/measure?for=<svg>` (proxies the backend, default ref is the dropped photo's `original.png` from `.workshop/<svg>.refs/`).
- Right sidebar gained a Metrics panel between controls and snapshots: shows the 3 scores as color-coded bars (green ≥0.85, yellow ≥0.65, red below) plus timestamp + target size + label. "Measure" button kicks off a fresh run.
- `svgw measure <svg> [--ref <photo>] [--label "..."] [--json]` — auto-finds `sources/<basename>.{jpg,png,jpeg,webp}` if `--ref` is omitted, prints color-coded scores. Returns exit 0 on success.
- Backend bumped to 0.4.0; capabilities now `["preprocess", "trace", "measure"]`.

Verified: `svgw measure examples/car.svg --ref sources/voiture.jpg` produced `outline_iou=0.0911, pixel_iou=0.0729, edge_ssim=0.2971` (low scores, expected — the parametric car illustration is a side view of a generic car, the photo is a 3/4 front of a Renault). History file landed correctly. Workshop proxies (`/api/metrics`, `/api/measure`) return matching payloads. Metrics UI bars + the "Measure" button work in the wiring path; not eyeball-validated in a real browser this session.

### [x] Phase 4 — Color sampling

Goal: pick flat fill colors for each named region from the source image.

What landed:
- Backend `POST /sample-colors` body: `{ svg_path, ref_path }`. For each `<path>` carrying `id` or `class` (excluding paths inside `#trace-ref`), parses the `d` attribute via `svgpathtools` to get a viewBox-space bbox, maps to ref-image pixels, samples via OpenCV k-means k=3, returns the largest cluster's centroid as `#rrggbb`.
- Returns `[ { region, region_kind, color, bbox, confidence, pixels_sampled } ]`. Confidence = largest-cluster fraction in [0, 1]. Agent uses confidence to flag noisy regions (low conf = bbox swept up mixed background).
- Backend never rewrites the SVG. Agent reads suggestions and edits `--<region>-color` CSS vars itself.
- `svgw colors <svg-path> [--ref <photo>] [--json]` — auto-finds `sources/<basename>.{jpg,png,jpeg,webp}` if `--ref` is omitted, prints region/color/confidence table.
- Backend bumped to 0.5.0; capabilities now `["preprocess", "trace", "measure", "sample-colors"]`.

Verified: `svgw colors examples/car.svg --ref sources/voiture.jpg` produced sensible suggestions (.body=#1f2b42 dark blue/gray matching the photo's car body, .window=#9fb1c4 light blue/gray for windows reflecting sky, .line/.accent dark interior). Confidence range 38-59% — normal for real photos with shading/highlights.

### [x] Phase 5 — Agent skill

Goal: documented protocol + convenience commands so the agent can run a full conversion.

What landed:
- `.claude/skills/svg-from-photo/SKILL.md` documents the 8-step workflow (preprocess → trace into hidden ref → draft parametric paths → measure → revise worst region → sample colors → snapshot → notify) with halt conditions, default cadence (1 pass then ping the user), and troubleshooting notes for common failure modes.
- Loop logic lives in agent reasoning per the architecture decision; no `--passes` flag in any tool, no automated multi-pass endpoint.

### [x] Phase 6 — Static showcase site + repo merge

Goal: GitHub-hostable viewer site that shares code with the workshop.

What landed:
- Merged with the separate Formation_SVG presentation repo (archived as
  `SVG_Demo_Conf`) so one repo holds both the public conference site and
  the workshop. Repo renamed `SVG_Designer` → `SVG_Conf`.
- Layout: presentation HTML + `css/` + `js/` + `parts/` + `images/` at
  repo root; canonical gallery in `gallery/`; static viewer in
  `workshop-viewer/`; interactive editor in `workshop-app/`; shared
  parser/controls in `src/ws-parser.js` + `src/ws-controls.js`.
- Shared modules: `parseRootVars`, `parseHint`, `inferType`,
  `splitNumber`, `parseRange`, `isDerived`, `resolveDerived`, `mixColor`,
  `hexToRgbTriple`, `NAMED_COLORS`, plus the generic
  `buildControl(variable, opts)` with callback-based state access so
  both hosts reuse it without agreeing on state shape.
- `workshop.html` (conference page) embeds the static viewer via
  `<script type="module" src="workshop-viewer/viewer.js">`; the manifest
  lists the 7 showcase SVGs and each carries a `reference:` path so
  Compare mode shows the source photo side-by-side.
- `workshop-app/index.html` serves the full editor at `/workshop-app/`
  when `server.js` runs. `server.js` got a generic static handler so
  the whole site (presentation + app + viewer + gallery) serves
  transparently from one process, plus a directory 301→trailing-slash
  redirect for `/workshop-app`.
- GitHub Pages enabled on `main` → `/`, published at
  `https://javakhanstudio.github.io/SVG_Conf/`.
- No bundler — everything loads directly as ES modules from the static
  origin.
- `start-server.bat` at repo root lets anyone on Windows double-click to
  launch the workshop server without a terminal.

Deferred: a landing CTA on the published site pointing to the
workshop-app isn't useful on GH Pages (the API routes don't exist
there), so `workshop.html` links to it in-page with a `node server.js`
invitation instead.

## Sequencing

`0 → 1 → (2 ∥ 3) → 4 → 5 → 6`

- 0–3 are the bulk of the work.
- 4 is small.
- 5 is mostly documentation.
- 6 is independent and can slip without blocking the agent loop.

## Dependencies (so the user knows what lands on their machine)

- Python 3.10+
- `fastapi`, `uvicorn`, `python-multipart`
- `opencv-python`, `numpy`, `Pillow`, `scikit-image`
- `potrace` system binary (Windows: install from potrace.sourceforge.net or via winget/chocolatey)
- `resvg-py` (preferred) OR `cairosvg` (fallback)
- Node side stays as today, plus a tiny in-repo `svgw` script (no extra npm deps).

## Conventions / gotchas

- The source SVG file is the source of truth for variable defaults. Workshop overrides at runtime via inline styles. The trace-ref `<g>` layer is the **only** thing the trace command writes back into the SVG file.
- Variable naming convention for region colors: `--<region-name>-color`, where `<region-name>` matches the path's `class` or `id`. The color sampler relies on this convention.
- The trace-ref group must be the **last** child of `<svg>` so it renders behind parametric content if accidentally shown. (Z-order in SVG is document order.)
- `.workshop/<svg>.refs/` filenames are stable: `original.png`, `gray.png`, `otsu.png`, `adaptive.png`, `canny.png`, `bilateral.png`, `depth.png`. The frontend dropdown is hardcoded to this list.
- All backend endpoints take and return JSON except `/preprocess` (multipart in, JSON out) and any future image-returning routes (PNG out).
- CLI output is human-readable by default and `--json` for the agent.

## Current status

**Phases 0–6 complete + 4.5 patch + 3.5 diagnostic passes.** Backend on 127.0.0.1:5174 (version 0.7.0, capabilities: preprocess, trace, measure, sample-colors-masked, diagnostic-passes). Repo merged, renamed `SVG_Conf`, published at `https://javakhanstudio.github.io/SVG_Conf/`.

Phase 3.5 (post-feedback): Added 3 optional diagnostic passes to `/measure` because the global metrics (outline_iou / pixel_iou / edge_ssim) are coarse averages that can hide proportion mismatches and per-region failures. Each pass is opt-in via `passes: [...]` in the request body or `--pass <name>` / `--all-passes` in the CLI. Default behavior unchanged.

- `subject_bbox`: Otsu+connected-components on each image → bbox + aspect ratio comparison. Flags proportion mismatches (e.g. bundaberg.svg's hand made the candidate's combined-subject bbox 506×314 while the photo's is 415×465 — 44.6% aspect-off, 78px centroid drift).
- `per_region_density`: For each named region's mask, ratio of (your Canny edge density) / (ref Canny edge density). Flags under-detailed regions (ratio < 0.3) and over-drawn ones (ratio > 3.0). On bundaberg.svg the `.skin` region scored 0.03 — the hand is dramatically under-detailed vs the photo's hand with fingers/knuckles/nails.
- `symmetry`: Mirror-SSIM on the candidate render. Flags lopsided drawings of subjects that should be symmetric.

Each pass returns a `_hint` string the agent reads to interpret the output. Skill (`svg-from-photo/SKILL.md`) gained a "Diagnostic passes" section documenting when to invoke each one and when to skip — written as decision-grade prose for the agent.

Phase 4.5 (post-feedback): Color sampling now renders a per-region binary mask via resvg (mini-SVG with all the region's shapes, CSS-overridden to solid black) and samples the reference at masked pixels only. Handles all shape types (path/rect/circle/ellipse/polygon/polyline), not just `<path>`. Coverage on the coffee scene jumped from 8 to 16 regions. Headline win: carafe color went from #171313 (sampling the dark cutout behind it) to #695549 (the actual brown-tinted glass). When suggested colors disagree with hand-picked ones, the disagreement is usually informative — it tells the agent which named regions are geometrically misaligned with what they represent in the photo.

Also patched: `svgw trace` auto-tunes `--filter_speckle` based on the source filename — drops to 2 for `canny.png`, 4 for `adaptive.png`, leaves 8 default for thresholded silhouettes. Canny edges are 1-2px hairlines and the default of 8 wiped them out (got 6 paths instead of 1195 in the first coffee.jpg run).

## Next action

All scoped phases shipped. Open-ended follow-ups (diagnostic refinement, colour sampler v2, hand-draft assistance, skill updates, remote-access story) are listed in `OVERVIEW.md` under "What's next".
