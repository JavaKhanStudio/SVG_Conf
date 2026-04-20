# SVG Conf — Photo → SVG Pipeline + Conference Site

A French-language conference site about SVG and AI (the public-facing
part, served from the repo root as GitHub Pages) plus a local browser
workshop + Python image-processing backend + agent skill that together
let a Claude Code agent convert source images into parametric SVGs
ready for the workshop's live-tweakable variable model.

The conference site is the static showcase of the work. The workshop
is the tool that produced the SVGs in it, kept in the same repo so
anyone cloning can run the live editor on the same gallery.

This document captures what the project is, how it's built, the
decisions behind each piece, and the lessons that came out of building
it through real iterations on real images.

---

## What it does

Given a source image (photograph, logo, illustration), the agent produces
an SVG that:

- Renders close to the source visually.
- Uses CSS custom properties (`var(--name)`) for the tweakable values, so
  the workshop UI can present every colour, stroke width, and named knob
  as a live control.
- Stays 100% valid SVG — opens in any browser, in Inkscape, pastes into a
  Vue/React component.

The conversion is iterative: preprocess → trace → draft/extract paths →
measure → revise → sample colours → snapshot → notify. The agent is the
loop; the backend gives it tools at each step; the workshop UI is for the
human to spectate, snapshot, and tweak values.

## Architecture

Four pieces, opt-in layering:

**0. Presentation site** (static HTML at the repo root). The public face
— `index.html`, `gallery.html`, `concepts.html`, `stories.html`,
`workshop.html`, etc., backed by `css/`, `js/main.js`, `parts/` (header
/ footer includes), and `images/`. Published by GitHub Pages straight
from the main branch root, no build step. Works offline. Embeds
`workshop-viewer/` as a static live-editing showcase on `workshop.html`.

**1. Frontend workshops** (Node, no build step, native ES modules). Two
hosts share a `src/ws-parser.js` + `src/ws-controls.js` pair so the
`@ws` hint format has one implementation:
- `workshop-viewer/` — static showcase embedded by `workshop.html`.
  Loads the manifest + gallery SVGs, renders controls, supports
  Compare/Photo view modes + Download. No server required.
- `workshop-app/` — interactive editor. Same controls, plus WebSocket
  file watching, snapshot capture/replay, reference-photo overlays,
  metrics panel, drag-to-upload. Reachable at `/workshop-app/` when
  `server.js` is running.

**2. Backend** (Python, FastAPI on port 5174). Owns all image processing.
Five endpoints:
- `/preprocess` — generates 7 reference variants per source image (gray,
  Otsu threshold, adaptive Gaussian threshold, Canny edges, bilateral,
  luminance-as-fake-depth, plus the original). Cheap, deterministic.
- `/trace` — vector tracing via vtracer (Rust-backed, prebuilt Windows
  wheel). Two modes:
  - Binary trace of a preprocessed mask → dropped into the target SVG as
    `<g id="trace-ref" display="none">` for use as an alignment overlay.
  - Colour trace of the source PNG → produces actual fill paths the agent
    extracts and re-colours parametrically.
- `/measure` — rasterises the candidate SVG via resvg, composites onto
  white, computes three metrics: outline_iou (Canny edges + IoU, strict),
  pixel_iou (binary silhouette IoU, loose), edge_ssim (SSIM on softened
  edge maps, layout-sensitive). Three optional diagnostic passes opt in
  via `passes:[...]`: `subject_bbox` (proportion mismatch), `per_region_density`
  (per-class detail balance), `symmetry` (lopsided check).
- `/sample-colors` — for each named region in the candidate SVG, renders
  a binary mask of just that region's shapes, samples the reference at
  the masked pixels, runs k-means k=3 to suggest a flat fill colour.
  Returns suggestions only — agent edits the SVG itself.
- `/health` — version + capabilities advertisement.

**2b. Workshop server** (`server.js`, Node). Serves the whole site at
port 5173 (presentation at `/`, workshop-app at `/workshop-app/`),
watches a gallery folder with chokidar, pushes change notifications
over WebSocket, proxies the Python backend at `/api/*`, serves
preprocessed reference variants at `/refs/*`, handles uploads at
`/api/upload`.

**3. Agent CLI + skill**. A thin Node CLI (`svgw`) wraps each backend
endpoint as a Bash command. A Claude Code skill at
`.claude/skills/svg-from-photo/SKILL.md` documents the 8-step workflow
the agent follows, with halt conditions, per-pass decision rubrics, and
the trace-as-geometry-vs-hand-draft decision (see Lessons below).

The frontend talks to the backend via the workshop server's proxy
endpoints (`/api/preprocess-ref`, `/api/measure`, `/api/metrics/<svg>`).
A red banner appears at the top of the workshop when the backend is
down — non-trace features keep working.

## Workflow

The skill prescribes 8 steps. The agent moves through them, looping back
to step 4 (measure) until the metrics validate or improvement plateaus.

1. **Preprocess** the source → 7 variants in `.workshop/<svg>.refs/`.
2. **Trace.** Decide: clean source (logo/icon/cartoon)? Use vtracer in
   colour mode and extract the paths as the geometry. Photo? Use vtracer
   in binary mode on the canny variant, drop the result into the target
   SVG as a hidden alignment layer.
3. **Build the SVG.**
   - Trace-as-geometry: bucket each fill into 6-10 semantic CSS classes
     by RGB heuristic, wire each class through a `--<class>-color` CSS
     variable, leave long-tail detail fills literal so nuanced shading
     survives.
   - Hand-draft: open the workshop, toggle the trace-ref overlay on,
     hand-build parametric paths over the magenta hairlines.
4. **Measure.** Default thresholds: outline_iou ≥ 0.20, pixel_iou ≥ 0.20.
   If the source has a tonal range that confuses subject-bbox, fall back
   to eyeballing the otsu.png variant.
5. **Read the diagnostic passes.** `per_region_density` flags under-
   detailed (ratio < 0.3) and over-drawn (ratio > 3.0) regions.
   `subject_bbox` flags proportion + position mismatches.
6. **Revise.** Fix the worst region. Re-measure. Stop when metrics +
   side-by-side render both validate, or after ~5 passes (sanity cap).
7. **Sample colours.** `svgw colors` returns suggested fills per named
   region. Apply only the trustworthy ones — disagreements between sample
   and hand-pick usually mean the geometry is misaligned, not that the
   sampler is wrong.
8. **Notify.** Telegram reply with metrics + thumbnail.

## Key technical decisions

- **Python backend.** Pure JS path was attempted and abandoned —
  potrace/vtracer/scikit-image/OpenCV are all far stronger in Python.
- **Backend optional.** Workshop's existing features (load, edit, snapshot)
  keep working without it; only trace/measure/preprocess require it.
- **vtracer over potrace.** pypotrace fails to build on Windows + Python
  3.13. vtracer (Rust-backed) installs cleanly via pip and supports both
  binary and colour tracing.
- **resvg for rasterisation.** Cleanest install on Windows with no system
  deps. Limitation: doesn't honour CSS custom properties — worked around
  by inlining `:root` variables before handing the SVG to resvg.
- **Per-shape mask sampling** (Phase 4.5 patch). Original `/sample-colors`
  used path bounding boxes; failed when a shape was concave or overlapped
  background. Replaced with per-region rasterised masks: each region's
  shapes get assembled into a mini-SVG with a CSS override forcing solid
  black fills, rasterised, used as a precise mask.
- **Alpha-channel composite** (real bug fix, post-goldenspring). cv2's
  `IMREAD_COLOR` strips alpha to black, so a transparent PNG ended up
  comparing "gold on black" against the candidate's "gold on white" —
  Otsu thresholded them into completely different subject masks and the
  metrics were silently meaningless. Now everything reads with
  `IMREAD_UNCHANGED` and composites onto white.
- **Loop logic in agent reasoning, not in code.** No `--passes` flag in
  any tool, no automated multi-pass endpoint. The agent decides when to
  stop based on metrics + visual side-by-side.

## Lessons learned (during real iterations)

- **Embrace overlap.** Real scenes are layered (hand grips bottle, camera
  mounts in front of wall, coffee maker sits on toaster). Avoiding
  overlap to "keep shapes clean" distorts composition. Use document
  order: back-element first, foreground next, visible front elements
  last.

- **Proportions before details.** The biggest single-iteration metric
  jump in this project (bundaberg outline_iou +47%) came from fixing a
  too-slender bottle. Hours of finer finger detail moved metrics by
  single percentages. When the silhouette feels off, measure otsu.png
  pixel widths first, before adding any shading.

- **Trace-as-geometry vs hand-draft.** For clean source images (logos,
  icons, cartoons, screenshots), the trace tool produces ground-truth
  geometry. Extract its paths, re-route fills through CSS classes, done.
  Hand-drafting in those cases wastes iterations and produces worse
  output. Goldenspring went outline_iou 0.05 (10 hand-draft attempts) →
  0.68 (single trace-extract) just by switching approach. Hand-draft is
  reserved for photos where the trace needs human interpretation.

- **Conservative trace settings for line art.** Default
  `filter_speckle=8, color_precision=4, layer_difference=12` over-merges
  on cartoons: thin outlines get filtered, adjacent colour regions
  average together. Use `filter_speckle=4, color_precision=6,
  layer_difference=8` for line art — hundreds of paths instead of tens,
  but outlines stay crisp and adjacent colours don't bleed (leprechaun
  outline_iou +29% from this single change).

- **Trust the metrics, but also look at the render.** Cherry-picking the
  one metric that looks good is a real failure mode — happened on
  goldenspring v1, shipped a bad result because edge_ssim was 0.81 while
  pixel_iou (broken by the alpha bug) was treated as background noise.
  The skill now requires side-by-side visual checking before commit, with
  hard thresholds (outline_iou ≥ 0.20, pixel_iou ≥ 0.20).

- **Colour sampler honesty.** When a sampled colour disagrees with a
  hand-pick, it usually means the geometry is misplaced, not that the
  sampler is wrong. The disagreement is informative, not noise.

## Real examples (this session)

| Subject       | Approach          | Passes | outline_iou | pixel_iou | Notes |
|---------------|-------------------|-------:|------------:|----------:|-------|
| coffee.svg    | Hand-draft (photo)| 3      | 0.061       | 0.351     | Multi-object kitchen scene; perspective stayed flat. |
| bundaberg.svg | Hand-draft (photo)| 10     | 0.149       | 0.508     | Bottle + hand. v6→v7 proportion fix +47% outline_iou. |
| goldenspring  | Trace-as-geometry | 1+1    | 0.680       | 0.863     | Spring leaf logo. Single extract, alpha-bug-fix retry. |
| leprechaun    | Trace-as-geometry | 2      | 0.756       | 0.973     | Cartoon. Conservative trace settings unlocked outlines. |

## What's next

- **Diagnostic pass refinement.** `subject_bbox` currently uses the
  largest connected component, which lies when the source has tonal
  variation that breaks Otsu into multiple components while the
  flat-colour candidate stays as one mass. Fix: use the union of all
  components above a size threshold, or run the pass on the union of
  named regions instead.

- **Color sampler v2.** Per-region masks already use real shape
  geometry. Could add an outlier-tolerant clustering (DBSCAN with
  MAD-based ε) so highlights and shadows inside a flat region don't
  drag the centroid.

- **Hand-draft assistance.** For photo subjects, the trace overlay is
  helpful but the agent still has to author bezier curves blindly.
  Could expose the trace's individual paths as draggable starting
  shapes the agent uses as seeds, then cleans up by hand.

- **Skill improvements** as more iterations surface new gotchas. The
  skill is the project's persistent memory — every session that finds a
  new failure mode should add a paragraph to it.

- **Remote-access deployment story.** Tried a Cloudflare quick-tunnel
  on the workshop (`cloudflared tunnel --url http://localhost:5173`)
  and the tunnel itself came up clean (HTTP 200 at the trycloudflare
  URL within seconds). Browsing it remotely failed in practice for
  reasons I didn't fully diagnose — most likely culprits:
  - The workshop's WebSocket connection for file-watching uses
    `new WebSocket('ws://${location.host}')`. Cloudflare quick-tunnels
    proxy WebSockets, but the upgrade handshake can fail silently if
    headers aren't passed cleanly. The file list would stay empty.
  - The backend health-check banner (`src/backend-status.js`) hits
    `http://127.0.0.1:5174` from the user's browser — which is the
    user's localhost, not the host's. So the banner permanently shows
    "backend offline" remotely. Same issue would affect any other
    direct backend call.
  - The workshop has no auth on `/api/upload` or `/api/snapshots`, so
    public exposure has real risk even if it worked.

  Proper fix for next time: (a) add a `--public-url` arg to the workshop
  server so it can advertise its own external base URL to the frontend,
  (b) route the backend through the workshop's proxy endpoints
  exclusively (no direct browser → backend calls), (c) put basic-auth
  in front of the upload + snapshot routes, (d) verify the WS upgrade
  works through the tunnel before claiming it's live. Two named tunnels
  + a small `cloudflared` config file is probably cleaner than two
  quick-tunnels with hard-coded URLs.
