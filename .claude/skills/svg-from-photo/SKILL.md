---
name: svg-from-photo
description: Convert a phone photo into a parametric workshop SVG. Iterative pipeline using preprocess → trace → hand-build paths → measure → sample colors. Invoke when the user asks to "turn this photo into an SVG", "trace this image", or similar. Requires the Python backend running on port 5174.
---

# svg-from-photo — convert a phone photo into a parametric workshop SVG

You are the loop. The Python backend gives you tools (preprocess, trace, measure, sample-colors); the parametric SVG is built and revised by you. The workshop UI is for the human to spectate.

## Preconditions

1. Python backend is running. Check with `svgw health`. If down, tell the user to start it: `backend\start.bat` (Windows) or `backend/start.sh`. Don't proceed without it.
2. The reference photo exists somewhere (typically `sources/<name>.jpg`).
3. A target SVG path is decided (e.g. `<name>.svg` at the repo root, or wherever the user asks).

## SVG conventions (read CLAUDE.md if not already in context)

- Variables in `:root { --name: value; }` inside a `<style>` block that is the first child of root `<svg>`.
- Reference vars from attributes via `var(--name)`.
- Region colors live as `--<region-name>-color` so the color sampler maps cleanly.
- Group region paths under a shared `class="<region>"` so the auto-color step finds them. Use `id="..."` only for one-off shapes.
- Don't strip `/* @ws ... */` hint comments.

## Workflow (one full pass)

Each numbered step maps to a single tool call or a small reasoning step. Run them sequentially.

### 1. Preprocess

```
svgw preprocess <photo> --for <target.svg>
```

Writes 7 variants (original, gray, otsu, adaptive, canny, bilateral, depth) into `<dir-of-target>/.workshop/<basename>.refs/`. The canny variant is your primary outline reference; otsu is the silhouette.

### 2. Trace into a hidden reference layer

```
svgw trace --src <dir>/.workshop/<basename>.refs/canny.png --into <target.svg>
```

Injects `<g id="trace-ref" display="none">…</g>` as the last child of the target SVG. The workshop UI gets a "Trace" toggle to flash this overlay on/off. Re-runs replace the group cleanly, so you can swap canny → otsu and back without leaving leftovers.

If the SVG doesn't exist yet, create it first with the minimal workshop template (see CLAUDE.md), then trace into it.

### 3a. Decide: trace-as-geometry, or hand-draft?

**Look at the source.** If the source is clean line art, a logo, an icon, a screenshot, or any image with crisp edges and flat colour regions, **don't hand-draft**. Run `vtracer` directly in colour mode on the original PNG, extract the resulting paths (preserving their `transform` attributes!), drop them into your SVG as the geometry, and re-route their fills through CSS classes for parametric tuning. The trace IS the ground truth — your job is just to wrap it in the workshop variable convention. This is dramatically faster and produces dramatically better metrics than hand-drafting (goldenspring jumped from outline_iou 0.05 to 0.68 just by switching approach).

How to do it from Python:
```python
import vtracer
vtracer.convert_image_to_svg_py(
    'sources/foo.png', 'tmp_color_trace.svg',
    colormode='color', mode='spline',
    filter_speckle=4, color_precision=6, layer_difference=8,
)
```
Then regex-parse the resulting `<path d="..." fill="..." transform="..."/>` lines, dedupe by fill, give each fill a CSS class, drop them into your workshop SVG.

**Trace-settings calibration for line art / cartoons.** Default vtracer settings (filter_speckle=8, color_precision=4, layer_difference=12) merge adjacent regions too aggressively for illustrations: thin dark outlines get filtered as speckle, and adjacent colour regions (e.g. orange beard next to green coat) get averaged into a brown mid-tone. For cartoon line art use **filter_speckle=4, color_precision=6, layer_difference=8** — preserves outlines and keeps neighbouring colours separate. Cost: more paths (~hundreds vs ~tens), slightly larger SVG. Easily worth it for the visible quality lift (leprechaun outline_iou went 0.59 → 0.76 from this single change).

**Trace-settings + preprocessing for hard photos** (real-world photographs with subtle gradients and low subject/background contrast). Even the line-art settings can collapse the subject into the background palette — a cream-furred puppy on a grey couch traces as one big grey blob because the photo's white-balance / lighting put both at similar luminance, and vtracer's colour quantization conflates them. Two-step fix: (1) **boost source saturation** before tracing — read with cv2, convert to HSV, multiply S channel by ~1.5, write a temp PNG, trace that. The warm/cool separation amplifies just enough for vtracer to keep the subject distinct. (2) Use **color_precision=8 (max), layer_difference=6** so the quantization preserves the now-distinct tones. Trace size jumps (~10k paths instead of ~hundreds) but the subject is faithfully there.

**Bucketing on hard photos: less is more.** The bucket-and-recolour approach that works beautifully on logos and cartoons actively hurts on photos. A `couch-grey` rule that catches every desaturated mid-tone will pull half the subject's fur shadows and edges into the grey CSS variable and make them grey. For photos: drop wide buckets, keep most fills literal, only parametrise unambiguous regions (very-white wall, very-dark eyes/nose, etc.). The trade-off is fewer workshop knobs but a faithful render.

**…unless you want a stylised illustration, in which case k-means posterise FIRST.** The workshop is built around tweakable CSS-variable regions; a "faithful photo trace" with all-literal fills has nothing to tweak. To get both faithfulness AND parametric colour: (1) HSV-saturation-boost the source ~2.5x, (2) `cv2.kmeans` with k=6-10 to force exactly that many colour centroids, (3) write the posterised image to a temp PNG, (4) `vtracer` color-trace the posterised image (filter_speckle=8, color_precision=5, layer_difference=10 work well), (5) snap each traced fill to its closest k-means centroid via RGB distance, (6) each centroid becomes one named CSS-variable bucket. Result: ~300 paths instead of ~17,000, ~1 MB instead of ~20 MB, 8 named tweakable regions, recognisably stylised. Puppy went 17900 → 279 paths, 20.7 MB → 1.4 MB, 0 → 8 CSS variables.

**Bucketing strategy when there are many fills.** With finer trace settings you can end up with 1000+ distinct fills. Bucket each fill into a semantic CSS class via an RGB heuristic (e.g. greens with `g > r and g > b` go into `.clover-green`; warm peach into `.skin`; very dark into `.outline`). Major bucketed regions get tweakable `--<class>-color` CSS vars. **Don't force every fill into a bucket** — small detail fills that don't fit cleanly should be kept literal (`fill="#abc123"` on the path). Over-bucketing flattens the nuanced shading the trace gave you for free; under-bucketing means the workshop has nothing to tweak. Aim for ~6-10 named buckets covering the dominant regions, with the long tail of detail colours kept literal.

**Real-text overlay (for designs containing text).** vtracer renders text as bezier paths, which are chunky at any zoom and impossible to re-edit. For images where text is a first-class element (podcast covers, posters, logos with wordmarks), add a real-text overlay layer:

1. Bucket the white text fills into `.text-white`, red/coloured text fills into `.text-red`, etc. — be permissive on the threshold (`r > 180 and max-min < 35` catches anti-aliased white) but **tight enough to exclude skin-shadow tones**. True text-red is `r > 140 and g < 60 and b < 60` (saturation > 75%); skin shadows are `r > 140 and g ~ 100 and b ~ 80` (saturation < 50%) and will land in your red bucket if you don't filter them out.
2. Add a `--traced-text` CSS variable defaulting to `none`, and set the relevant text bucket classes to `display: var(--traced-text)`. This hides the chunky traced characters.
3. Auto-derive text positions from the traced bboxes — don't eyeball coordinates. For each path in a text bucket, compute its world-coord bbox via `svgpathtools.parse_path(d).bbox()` and apply the path's `translate(...)`. Cluster paths whose Y-ranges overlap (tolerance ~4px) into discrete text "lines". Each line's union bbox gives `x = bbox.xmin, baseline_y = bbox.ymax, font-size = round(bbox.h / 0.72)` (cap-height ratio). Map clusters to text labels by Y order.
4. Append a `<g id="text-overlay" style="display: var(--text-overlay)">` containing real `<text>` elements with the auto-derived `x=`, `y=`, `font-size=`. Font family / colour can be CSS-variable parametric; position attributes must be literal — resvg doesn't support `calc(var(...) * 1px)`.
5. Default `--text-overlay: inline` and `--traced-text: none` — overlay on, traced off. Switching either via the workshop dropdown lets users see crisp editable text or the original traced version.

Watch out:
- CSS variable values that contain quotes (`--font: "Impact, Arial"`) become invalid XML when inlined into attributes. Use unquoted single names (`--font: Impact`) or use the variable only in CSS rules, never directly in attributes.
- XML comments cannot contain `--` anywhere. A comment like `<!-- toggle off with --foo: none -->` silently breaks the SVG.
- Cluster tolerance for Y-overlap is sensitive. Tolerance 10 merges "THE" (small) into "BOYSCAST" (big) below it. Tolerance 4 keeps them separate. Start at 4, tune up only if a known multi-line block fragments.
- **Spatial filter on the bucket assignment, not just on clustering.** When the title text uses a colour that also appears elsewhere in the image (e.g. medium neutral greys appearing in skin shadows / glasses / lab equipment as well as in the title), the bucket will catch *all* of them and re-colour the whole image with the title's CSS variable. Restrict the bucket itself with a spatial guard: only assign `title-grey` to paths whose bbox falls within the top 25-30px text band; same RGB elsewhere stays in the literal-fill bucket. Same applies to footer text, sidebar text, etc. — bucket assignment should consider both colour AND position.
- **Filter non-letter-shaped paths out of text buckets before deriving size.** A single wide-and-short path (decorative underline, accent bar) inside a text bucket will inflate the union bbox vertically and your auto-derived font-size will be 2-3x too large. Filter to paths with `width / height ≤ 4` before computing sizes; everything else stays in the bucket for colouring but is excluded from position/size derivation.
- **Use the MEDIAN single-letter height, not the union bbox height, for font-size.** Even after the letter-shape filter, occasional outliers (a tall capital, a descender) still distort the union. `font-size = round(median(letter_heights) / 0.72)` is robust — *for clusters of 4+ letters*. For clusters of 1-3 letters (typical of accent text like "-2", "®", "TM"), median misleads — use **max** letter height instead so the digit dominates over the hyphen.
- **Baseline = MEDIAN of letter ymax values, not max.** Max can be dragged down by one outlier path that slipped through the shape filter. Median picks the actual baseline most letters share.
- **Same-line unification.** After deriving each overlay independently, find pairs whose baselines are within ~15px and unify both their font-size (to the larger) and baseline-y (to the lower). Catches the XENONAUTS + -2 case where the accent should visually align with the main word but its bbox-derived baseline is slightly off.
- **Surgically hide antialias-halo paths instead of painting over them.** Anti-aliased text edges in the source get partially bucketed into neighbouring categories (edge pixels of white text on a dark bg aren't pure white, so some land in other buckets). Hiding only the main text-colour bucket leaves those edge fragments as visible halos. *Don't* fix this by painting a flat backing rect — it covers the original background's texture and looks like a brick patch. Instead: for every traced path, if its bbox is entirely inside a text cluster's padded bbox AND its area is less than ~1/4 of the cluster's area AND it isn't classified as a background category, tag it with a `text-noise` class that hides via `display: var(--traced-text)`. The original background bands stay intact (they cover most of the cluster, fail the size test, provide the natural backing); only the small antialias fragments around the letters disappear. Subtle, no flat patches, original bg texture preserved.
- **Don't overlook accent colours for text.** A small bright accent (the "-2" in yellow on a XENONAUTS-2 logo, the "®" in red on a brand) needs its own bucket — `text-yellow`, `text-red-accent` — and gets rendered as a separate `<text>` element in the overlay, not folded into the main text colour. Easy to miss because the accent is small; checks: enumerate distinct fills in your text-bucket region, look for outliers.
- **Side-by-side comparison is the real ship gate.** Numerical thresholds (outline_iou ≥ 0.20) and per_region_density bands tell you whether you're in the right ballpark, but they don't catch "the title is 2x too big" or "this should be yellow not white" — both showed acceptable metrics while being visibly wrong. Render the candidate and the source at the same size, view them next to each other, and verify each named region matches: position, size, colour. Only commit when both the metrics AND the side-by-side validate.

Hand-draft when: the source is a phone photo with depth, lighting, shading, occlusion. The trace then becomes a *reference layer* (`<g id="trace-ref">`) instead of the geometry, and you draw parametric paths that approximate the photo's structure rather than copy its pixels.

### 3b. Draft parametric paths (photo case)

This is the part you actually do — read CLAUDE.md and existing examples (e.g. `examples/car.svg`) for the convention, then hand-build clean semantic paths over the trace reference. Open the workshop in a browser and toggle "Trace" on to see how the magenta hairlines line up with your work.

Naming guidance:
- Each visually distinct flat region gets a `class="<name>"` (e.g. `body`, `window`, `wheel`, `light`).
- Each color a region uses gets a CSS var: `--<name>-color`. Wire it in `:root { --body-color: #888; }` and on the path element via inline style or via a class rule in the same `<style>` block (`.body { fill: var(--body-color); }`).
- Outline strokes share a `--outline` var; line widths a `--stroke-width` var with a workshop hint (`@ws number min=...`). Make tweakables tweakable.

Don't try to be pixel-perfect. Hit the major silhouette, the wheels, the lights, the windows. The metrics will tell you what to tighten next.

**Embrace overlap.** If an object overlaps another in the photo (a hand gripping a bottle, a camera mounted in front of a wall, a coffee maker on top of a toaster), draw BOTH in the SVG and let document order handle the occlusion — earlier elements get covered by later ones. Default instinct may be to keep shapes adjacent and "clean" — that distorts the composition because real scenes are layered. Pattern: draw the back-most element first (e.g. palm + back of hand), then the foreground object (e.g. bottle), then any visible front elements (e.g. fingertips that wrap to the front of the bottle). Same applies to anything that sits on or in front of something else.

**Proportions before details.** When the silhouette feels off, check actual photo dimensions BEFORE adding more detail. Open the otsu.png and canny.png variants and measure pixel widths/heights of the dominant objects. The biggest single-pass quality jump in agent runs has come from fixing slender-vs-stocky proportions, not from adding finger creases or bottle highlights. The `subject_bbox` diagnostic pass is the official measurement, but its current largest-component implementation can lie when the photo's tonal range breaks Otsu into pieces — fall back to eyeballing the otsu.png if subject_bbox numbers contradict your gut.

### 4. Measure

```
svgw measure <target.svg>
```

If `--ref` is omitted and `sources/<basename>.{jpg,png,jpeg,webp}` exists, it's used automatically. Otherwise pass `--ref <photo>` explicitly.

Returns three scores in [0, 1]:

- **outline_iou** (strict) — Canny+IoU. The metric to optimize for.
- **pixel_iou** (loose) — silhouette overlap. Catches gross shape disagreement.
- **edge_ssim** — edge-layout similarity. Tiebreaker.

Color coding: green ≥0.85, yellow ≥0.65, red below. Each run also appends to `.workshop/<basename>.metrics.json` so the user can see the trajectory in the workshop UI.

#### Optional diagnostic passes

The default 3 metrics are global averages — they wash out per-region failures. When you've got an outline_iou that looks "fine" but the result still feels wrong, opt into one or more of these focused passes. Each is cheap, opt-in, and prints an actionable hint.

```
svgw measure <svg> --pass <name>            # one specific pass
svgw measure <svg> --pass a --pass b        # multiple
svgw measure <svg> --all-passes             # every known pass
```

Pass catalog — read these and pick by symptom, don't blanket-run all of them:

- **`subject_bbox`** — Compares the bounding box + aspect ratio of the dominant subject in both images. Reports `aspect_ratio_off_pct` and `centroid_drift_px`.
  - **Use when**: outline_iou is low *but you suspect your shapes are roughly right* — the global metrics can hide proportion mismatches when the silhouette area is approximately right. If `aspect_ratio_off_pct > 15`, fix proportions before chasing IoU. If `centroid_drift_px > ~30`, your subject is shifted on the canvas.
  - **Cost**: one extra Otsu + connected-components on each image. Fast.
  - **Skip when**: the scene has multiple disconnected subjects (kitchen counter, group portrait) — the "largest component" picked by Otsu won't be meaningful.

- **`per_region_density`** — For every named SVG region, compares Canny edge density between the reference photo (inside the region's mask) and your candidate render (inside the same mask). Output: ratio per region, with under-detailed/over-drawn flags.
  - **Use when**: you want to know which region is the bottleneck. ratio < 0.3 → you've under-detailed (the photo has way more edges here than your drawing); ratio > 3.0 → you've over-drawn (clutter the photo doesn't have); 0.5–2.0 is healthy.
  - **Cost**: one Canny pass + one mask per region. Scales with number of named regions.
  - **Skip when**: you have very few named regions, or you're at the early-draft stage where everything is under-detailed.

- **`symmetry`** — Mirror-SSIM on the candidate render. Single score in [0, 1].
  - **Use when**: the subject *should* be left-right symmetric (bottle, vase, axisymmetric object, centered face). Score < ~0.7 means visibly lopsided.
  - **Cost**: one SSIM call. Negligible.
  - **Skip when**: the subject isn't supposed to be symmetric (asymmetric objects, scenes with figure on one side, hands holding things). The score will be low for unrelated reasons and mislead you.

When in doubt, start with `subject_bbox` — it's cheap and the most universally useful. Add `per_region_density` once you've fixed gross proportions and want to know where to push next. Reserve `symmetry` for cases where you genuinely expect it.

### 5. Read scores; revise the worst region

Look at the workshop in the browser if you can — the metrics panel shows the latest scores as bars. Identify which region is dragging the score down (compare the rendered SVG against the canny variant by toggling "Trace"). Edit just that region's paths, then go back to step 4.

Halt the loop when:
- outline_iou is at an acceptable level (≥ 0.85 typically), OR
- the last 2 passes haven't improved any metric by more than 0.01 (you've plateaued — diminishing returns), OR
- the user has told you to stop, OR
- you've run more than ~5 passes (sanity cap).

Default cadence: **1 full pass**, then ping the user. They can ask you to keep going. Don't loop autonomously without explicit "keep going" or a higher pass budget.

### 6. Color sampling

Once the geometry is acceptable:

```
svgw colors <target.svg>
```

Returns one color suggestion per `id`/`class` named region, with confidence. Apply by editing the matching `--<region>-color` CSS vars in the `:root { }` block. Sanity-check each: low confidence (under ~30%) means the region's bbox swept up a noisy mix — pick a manual color or accept the suggestion knowing it's approximate.

### 7. Final snapshot

Capture a workshop snapshot via the workshop UI's 📸 button (the user can do this), or write directly to `.workshop/<basename>.snapshots.json` if you need to commit a snapshot programmatically (the format is documented in `SPEC.md`).

### 8. Notify

Send a Telegram reply summarizing: final scores, number of passes, total path count, any regions where confidence was low. Include a thumbnail attachment if practical (the workshop's snapshot endpoint can produce one).

## When something goes wrong

- Backend unreachable → tell the user, suggest `backend/start.bat`. Don't fall back to anything; this skill needs the backend.
- Trace produces a noisy or empty result → try `--src <refs>/otsu.png` instead of canny, or bump `--speckle 16`.
- Scores aren't budging → re-look at the source. The problem is usually that you're drafting from memory of "a car" instead of from the trace. Toggle the trace overlay back on and follow the magenta lines.
- Confidence on a color sample is low (< 0.3) → the region's bbox includes background. Either tighten the path (smaller bbox) or override the color manually.

## Tools the skill expects

- Bash with `svgw` on PATH (`npm link` from the project root once, or `node svgw.js` from the project root).
- Read/Write/Edit on the SVG file.
- The Python backend on `http://127.0.0.1:5174` (override with `SVGW_BACKEND` env var).
