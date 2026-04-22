---
name: svg-from-scratch
description: >-
  Design a parametric SVG from scratch via Studio. TRIGGER when the user wants to make an SVG and has NO source photo — direct ("fais-moi un SVG de X", "design an icon for Y", "crée une icône", "draw a logo") OR exploratory ("how do I create an SVG for this project", "je veux un SVG", "do you know how I should do this SVG?", "I want to generate an SVG"). Don't deliver a W3C tutorial — the repo already has Studio + CLAUDE.md + canonical templates.
  HARD RULES YOU MUST FOLLOW EVERY TIME:
  (1) Write destination is ALWAYS studio-work/<base>.svg. NEVER images/, NEVER sources/, NEVER gallery/, NEVER the repo root. Those are for promotion in step 8 only.
  (2) After writing, you MUST reply with the Studio handoff — include the deep link `http://localhost:5100/studio.html?path=./studio-work/<base>.svg` (Studio auto-loads from the `path=` query param; no manual paste needed), drag to adjust, click Save. Ping via Telegram (mcp__plugin_telegram_telegram__reply) if connected, in-chat otherwise. Attach a Playwright screenshot if the user isn't on-screen.
  (3) After the handoff, STOP. Wait for the user to save <base>_V<n>.svg before writing v2. Do not iterate autonomously.
  SKIP this skill and use svg-from-photo instead if the user provides a source photo.
  Full workflow (brief capture, 4 canonical scaffold patterns, read-back diff logic, promotion destinations, traps) is in SKILL.md — read it after invoking.
---

# svg-from-scratch — design a parametric SVG via Studio

You are the drafter. Studio is the spectator's seat: it renders the SVG, exposes every attribute in an inspector, gives the user draggable Bezier handles, and saves `_Vn` snapshots. You write the SVG; the user tweaks it directly in the browser; you read their tweaks back and keep going. **Ping the user after every iteration** — via Telegram if the `plugin:telegram:telegram` MCP is connected (check the available-tools list for `mcp__plugin_telegram_telegram__reply`), otherwise in the main chat with the same format. This loop is meant to be watched live.

## THE 3 HARD RULES (re-read before EVERY response while this skill is active)

1. **Write path: `studio-work/<base>.svg`. No exceptions.** Not `images/`. Not `sources/`. Not `gallery/`. Not the repo root. Those are promotion destinations handled in step 8, AFTER the user approves the final version. If you're tempted to write elsewhere because the SVG "belongs" in `images/elements/` or similar — stop. Write to `studio-work/` first, iterate, promote at the end.

2. **After writing, reply with the MANDATORY handoff template** (copy-paste, fill the `<...>` slots):

   ```
   ✍️ v<N> écrite : studio-work/<base>.svg
   Shape : viewBox <X Y W H>, <M> vars, <K> régions.
   Laissé exprès : <what you deliberately didn't do>.

   👉 Ouvrir Studio (auto-chargé) :
      http://localhost:5100/studio.html?path=./studio-work/<base>.svg
      Drag anchors bleus + controles violets → Save → <base>_V<N+1>.svg.

   Feedback voulu : <specific ask>.
   ```

   If `mcp__plugin_telegram_telegram__reply` is in the available-tools list, send the same text via Telegram *in addition* to the in-chat reply. Attach a Playwright screenshot of the Studio-rendered SVG if the user isn't actively on-screen.

3. **STOP after the handoff.** Do not write v2. Do not loop. Wait for the user to (a) answer your feedback ask, or (b) save `<base>_V<n>.svg` themselves. Only then read `_V<n>` and write v<n+1>.

Anti-patterns you must avoid:
- Replying with a vanilla "SVG is XML text, here's a `<circle>`, what do you want to draw?" tutorial.
- Writing to `images/elements/` / `images/<anything>/` / `sources/` on v1 because "that's where the final file will go".
- Saying "visible dans le panneau de prévisualisation" / "visible in the Launch preview panel" / "visible in the preview" and moving on. **The Claude Code harness shows a preview pane when you write a file — that is NOT Studio.** Studio is a separate browser page at `http://localhost:5100/studio.html` with an Inspector, draggable Bezier handles, and versioned save. Confusing the two is the #1 failure mode on this skill. Always give the explicit Studio URL + load instructions in the handoff template.
- Iterating (v2, v3...) without waiting for the user's Save.

## When to use this skill vs svg-from-photo

- **svg-from-scratch (this one):** the user has a *description*, a *vibe*, or a *functional requirement* (e.g., "an icon for 'faction' in a tarot-style card", "a placeholder avatar", "a cover illustration for the stories page"). No photo. Output is *designed*, not *traced*.
- **svg-from-photo:** the user drops a phone photo and wants an SVG that resembles it. Output is *measured* against the reference via `svgw measure`.

If the user starts with a photo, stop and use svg-from-photo.

## Preconditions

1. **Node server must be reachable at `http://localhost:5100`.** Studio hits `/api/studio/list` and `/api/studio/save`. Probe with:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:5100/api/studio/list
   ```
   If it's down, start it **detached** so it outlives this session (memory: `feedback_start_server_detached`). On Windows use PowerShell:
   ```powershell
   Start-Process -FilePath "node" -ArgumentList "server.js",".\gallery" `
     -WorkingDirectory "C:\Users\Simon\Documents\SVG_Designer" `
     -RedirectStandardOutput "server.log" -RedirectStandardError "server.err.log" `
     -WindowStyle Hidden -PassThru
   ```
   Don't use Bash `run_in_background` — it dies with the agent.

2. **Target folder is `studio-work/`.** Studio's list/save APIs are hard-wired to it. Pick a base name (kebab-case, no spaces, no underscores in the base — `_V<n>` is the suffix grammar). Examples: `faction-icon`, `dogtag-wolf`, `cover-act3`.

3. **Read `CLAUDE.md` at the repo root** (or the relevant section) for the parametric-variable convention. Output format:
   - `<style>` as the first child of `<svg>`
   - One `:root { --name: value; }` rule inside
   - Every shape references variables via `var(--name)` in attributes
   - `/* @ws ... */` hint comments on vars that need a specific control type
   Studio's :root panel and the Black Room's auto-discovery both depend on this shape. Get it wrong and nothing is tweakable.

## The loop

Each pass is: **draft → user tweaks → read back → refine**. One pass is 1-3 SVG writes on your side.

### 1. Brief capture

Pin down before writing:
- **Subject** — what is being drawn?
- **Format** — viewBox dimensions.
- **Theme** — palette direction + mood.
- **Tweakable axes** — what the user might want to change later (colours by default; sometimes sizes, counts, rotations).
- **Neighbours** — existing SVGs the output should visually match.

If anything is vague, **ask one clarifying question**. One. Not five. Pick the question whose answer most affects the structure.

**Good question (affects structure):** "Style géométrique ou organique ?" — geometric = triangles/polygons + sharp edges; organic = Q-curves + varied stroke widths. Affects every path.

**Good question:** "Format carré pour la galerie ou portrait pour une carte ?" — determines viewBox aspect ratio, which constrains the whole composition.

**Bad question (noise at v1):** "Quelle couleur exactement ?" — at v1, pick a plausible colour from the project palette and let them override in the :root panel. Colour is a 1-click tweak, not a blocker.

**Bad question:** "Tu veux combien de décorations ?" — just do a sparse v1 with a count that looks clean, and make it a variable if they care.

### 2. Name-collision check

Before writing, always:
```bash
ls studio-work/ 2>/dev/null | grep -E "^<base>(_V[0-9]+)?\.svg$"
```
If existing `<base>.svg` or any `<base>_V<n>.svg` exists, **it's someone's in-progress work**. Don't clobber. Either pick a different base name or confirm with the user ("Je vois <base>_V3.svg déjà en cours — je continue dessus ou je démarre un nouveau fichier ?").

### 3. Scaffold v1

Sparse. Silhouette + dominant colour + structure. No decoration. Pick one pattern below and adapt.

**Write destination is always `studio-work/<base>.svg`.** Never the repo root, never `sources/`, never `images/`. Studio's `/api/studio/list` endpoint only reads `studio-work/`; if you write anywhere else, the user can't load it via the Studio's path-input or folder list without extra steps. Promotion to `sources/` or `images/<cat>/` happens in step 8, after the user approves the final version.

#### Pattern A — Icon / single-subject square (`0 0 200 200`)

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    :root {
      --bg-color: #1a1a2e;
      --subject-color: #d4a574;
      --accent-color: #c68654;
      --stroke: #000000;
      --subject-size: 70;      /* @ws number min=30 max=90 step=1 */
    }
  </style>
  <rect width="200" height="200" rx="12" fill="var(--bg-color)"/>
  <g id="subject" transform="translate(100,100)">
    <circle r="var(--subject-size)" fill="var(--subject-color)" stroke="var(--stroke)" stroke-width="2"/>
    <!-- Replace the circle with the actual subject shape. -->
  </g>
  <text x="100" y="185" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#888">LABEL</text>
</svg>
```

#### Pattern B — Tarot-style card (`0 0 300 500`)

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 500">
  <style>
    :root {
      --bg-color: #1a1a2e;
      --frame-color: #d4a574;
      --decoration-color: #c68654;
      --subject-color: rgb(100,155,255);
      --eye-color: rgb(100,255,155);
    }
  </style>
  <defs>
    <!-- TODO v2: decorative corner ornament here. v1 leaves corners blank. -->
  </defs>
  <rect width="300" height="500" fill="var(--bg-color)" rx="10"/>
  <rect x="5" y="5" width="290" height="490" fill="none" stroke="var(--frame-color)" stroke-width="1" rx="8"/>
  <rect x="12" y="12" width="276" height="476" fill="none" stroke="var(--frame-color)" stroke-width="1.5" rx="6"/>
  <g id="subject" transform="translate(150,250)">
    <circle r="60" fill="var(--subject-color)" opacity="0.3"/>
    <!-- Replace with the actual subject: eye, symbol, figure... -->
  </g>
</svg>
```
Canonical full version: `sources/card_back_Showcase_Matiere.svg` (481 lines; shows decorative corners, gradients, glow-pulse filter, clipPath bricks). Don't copy it wholesale — too much for v1.

#### Pattern C — Flower / organic (`0 0 100 100`)

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <style>
    :root {
      --petal-color: #E6A5B9;
      --petal-stroke: #D4879C;
      --stem-color: #7A8C38;
      --stamen-color: #FFD700;
    }
  </style>
  <path d="M50 80 Q50 70 50 60" fill="none" stroke="var(--stem-color)" stroke-width="1.5"/>
  <path id="corolla"
        d="M50 60 Q55 60 58 55 Q60 50 58 45 Q55 40 50 40 Q45 40 42 45 Q40 50 42 55 Q45 60 50 60"
        fill="var(--petal-color)" stroke="var(--petal-stroke)" stroke-width="0.8"/>
  <circle cx="50" cy="45" r="0.8" fill="var(--stamen-color)"/>
</svg>
```
Real worked example: inline code in `bezier.html` (the "courbe écrite par une IA" section), which also exposes each path as a toggleable element.

#### Pattern D — Character / figure silhouette (`0 0 400 400`)

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" fill="none">
  <style>
    :root {
      --bg-color: #1c1917;
      --border-color: #78350f;
      --body-color: #292524;
      --accent-color: #b45309;
      --label-color: #a8a29e;
    }
  </style>
  <rect width="400" height="400" rx="12" fill="var(--bg-color)"/>
  <rect x="1" y="1" width="398" height="398" rx="11"
        stroke="var(--border-color)" stroke-opacity="0.3" stroke-width="2"/>
  <!-- Silhouette bust -->
  <ellipse cx="200" cy="360" rx="100" ry="60" fill="var(--body-color)"/>
  <circle cx="200" cy="180" r="65" fill="var(--body-color)"/>
  <!-- Accent -->
  <line x1="310" y1="100" x2="310" y2="300"
        stroke="var(--accent-color)" stroke-opacity="0.4" stroke-width="3" stroke-linecap="round"/>
  <text x="200" y="380" text-anchor="middle" fill="var(--label-color)"
        font-family="sans-serif" font-size="14" opacity="0.5">CHARACTER</text>
</svg>
```
Template matches the `images/projetFoD/*.svg` family (character / event / faction / group / item / location — all share this frame + silhouette + accent + label layout, only the silhouette and accent palette change).

#### Rules for every pattern

- **Start deliberately sparse.** Don't decorate at v1 — the user will spot proportion problems immediately and you'll waste effort ornamenting something that needs to be resized.
- **Call out intentional emptiness** in a comment: `<!-- TODO v2: corner ornaments. v1 leaves them blank to pin down proportions first. -->`
- **Wrap semantic regions** in `<g class="<region>">` or give them `id="..."` so Studio's tree reads cleanly.
- **Only promote values to variables** if the user might actually tune them. A `stroke-width="0.5"` on a single internal detail stays literal.

### 4. Validate v1 (Playwright, before pinging)

Don't hand off an SVG that doesn't render. After writing, open it in the Studio via Playwright, screenshot, and catch XML parse errors before the user does:

```javascript
// tools/pw/snap_studio.mjs — run as: node tools/pw/snap_studio.mjs <base>
import { chromium } from 'playwright';
const base = process.argv[2];
if (!base) { console.error('usage: node snap_studio.mjs <base>'); process.exit(1); }
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const errs = [];
page.on('pageerror', e => errs.push(e.message));
page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('http://localhost:5100/studio.html', { waitUntil: 'networkidle' });
// Load the file via the path input
await page.locator('#path-input').fill(`./studio-work/${base}.svg`);
await page.locator('#load-path-btn').click();
await page.waitForTimeout(500);
// Check that an <svg> was actually rendered in the preview
const rendered = await page.evaluate(() => !!document.querySelector('#preview-host svg'));
console.log('rendered?', rendered, 'errors:', errs);
await page.locator('#preview-host').screenshot({ path: `tools/pw/studio_${base}.png` });
await browser.close();
```

If `rendered` is false or `errs` is non-empty, there's a syntax issue (most common: `--` inside an XML comment; unbalanced tags; semicolon inside a `:root` value). Fix before pinging.

Also validate XML well-formedness cheaply before firing up Playwright:
```bash
python -c "import xml.etree.ElementTree as ET; ET.parse('studio-work/<base>.svg'); print('XML OK')"
```

### 5. Ping after every iteration

**Every single write**, send a Telegram reply. This skill's loop is designed to be watched live. The user explicitly wants the ping cadence for presentations.

Format:
> **v1** écrite dans `studio-work/<base>.svg` — viewBox 0 0 300 500, 4 variables, 2 régions (frame + subject).
> J'ai laissé les coins blanc exprès pour qu'on valide la silhouette d'abord. Ouvre le Studio, glisse ce qui te semble off, sauve. Je reprends au `_V2`.

Contents, in order:
1. **Which version**, in what file
2. **One-line shape summary** (viewBox, count of vars, count of named regions)
3. **What you deliberately didn't do yet** (so they know it's intentional)
4. **What you want from them** (drag what? answer what?)

Attach a Playwright screenshot if practical — helps them see it without having to open Studio if they're on mobile.

### 6. Read back the user's version

The user's Save button produces `<base>_V<n>.svg`. Find the latest:
```bash
ls studio-work/ | grep -E "^<base>_V[0-9]+\.svg$" | sort -V | tail -1
```
Or list them all, `sort -V`, take the last.

Read the file. Diff it against what you wrote last (mentally — use the Read tool on both). Edit types:
- **Positional tweaks** (cx/cy nudged, bbox moved) → they like the shape, refining. Keep direction.
- **Attribute rewrites** (colour overridden, font-size tuned in `:root`) → they're exploring the parametric axes. Consider `@ws` hint upgrades.
- **Structural surgery** (elements deleted, `d` replaced, new `<path>` inserted) → v1 approach was wrong or partial. Ask before rewriting.
- **Retag / untag** (Studio's tree buttons) → they're reshaping semantic regions. Honour the new names.

### 7. Refine → write next version

Write `studio-work/<base>.svg` (the no-suffix file; user's next Save pushes to `_V(n+1)`). Priority order:

1. **Fix what the user changed, don't override.** If they moved a circle and you write the old cx, that's regression.
2. **Add one layer of detail** — a secondary region, a gradient, a pattern. Not seven.
3. **Promote hard-coded values to variables** when you notice yourself writing the same colour/size twice.
4. **Add `@ws` hints** for ranges, discrete choices, linked colours. Closed vocabulary (don't invent):
   - `number min=N max=N step=N`
   - `select options=a,b,c`
   - `color`, `text`
   - `seed` (adds 🎲 button)
   - `point2d=<group-name>` (pairs x/y vars into draggable dot — apply to both vars with same group)
   - `mix=<base-var>:<amount>` (derive colour from another, amount ∈ [-1, 1])
   - `ignore` (hide from controls)

Then repeat from step 4 (Validate) → step 5 (Ping).

**Halt the loop when:**
- User says "done" / "ship it" / "parfait" / stops responding after a ping, OR
- You've done ≥ 4 passes without a structural change (diminishing returns — tell them so explicitly), OR
- User promotes the file out of `studio-work/` themselves (notice the move and ping to confirm promotion).

Default cadence: **1 pass → ping → wait for explicit "keep going" before the next autonomous write.** Don't loop.

### 8. Promote

When the user approves the final version:

**Destination by type:**
- Gallery card (`gallery.html` displays it as a `.gallery-card`) → `images/<category>/<name>.svg` where `<category>` matches the filter buttons (`flowerWorkshop/`, `bones/`, `exemple_AI/`, `projetFoD/`, `cheatSheets/`, or a new one).
- Central reference for a story page (loaded via `<object>` or `<img>` in story-part*.html) → `sources/<name>.svg`.
- Parametric demo loaded by the Black Room → `gallery/<name>.svg` (the Black Room's default watched folder).
- One-off asset used only once on one page → colocate near the page (e.g., `images/story/<name>.svg`).

**Promotion steps:**
1. Pick the final `_V<n>` file — the one the user approved, usually the highest n.
2. Copy to the destination, stripping `_V<n>` and giving it its final kebab-case name.
3. If the file is >20 KB **and** the user cares about bytes (GH Pages, slow networks): run SVGO with the workshop-safe config:
   ```bash
   npx svgo --config tools/svgo.config.mjs studio-work/<base>_V<n>.svg -o images/<cat>/<name>.svg
   ```
   The config preserves `:root` variables (disables `inlineStyles`, `convertStyleToAttrs`, `minifyStyles`). Always check the promoted file still renders — run the Playwright snippet against its new URL.
4. Wire it into the page that will display it:
   - Gallery: add a `<div class="gallery-card" data-category="...">` in `gallery.html`.
   - Story: add a `<img>` or `<object>` tag; tag it `class="zoomable"` if it should open in the lightbox.
   - Concepts: new card in `concepts.html`.
5. Update `js/main.js` with any new i18n keys (`gallery_<name>_desc`, etc.).
6. Final Playwright screenshot on the rendering page — send to Telegram as "shipped".

## Studio capabilities cheat sheet

Things Studio can do well (don't re-implement):
- **Drag Bezier handles** on `<path>` elements directly in the preview. Blue dots = anchors, purple dots = control points.
- **Inline attribute editing** for every primitive (rect, circle, ellipse, line, polygon, polyline, text, image, use, gradients, stops).
- **Common style panel** (fill, stroke, stroke-width, opacity) on any visual element.
- **Transform** field accepts `translate(...) rotate(...) scale(...)` composable.
- **Auto-tag** button — assigns `el-N` ids to untagged elements so they become referable.
- **Undo** (Ctrl+Z, 40 deep).
- **:root panel** — edits CSS variables without touching the `<style>` block text.
- **Palette panel** — swatches of used colours.
- **Versioned save** — `<base>_V<n>.svg`, latest `n` wins.

Things Studio cannot do (do them yourself via Write):
- **Add new elements.** Studio tree only deletes. New `<rect>` = new Write.
- **Boolean operations** (union, subtract, intersect). Paths are crafted.
- **Import / merge** another SVG. Copy-paste via the text field or write a fresh file.
- **Grid snap / align tools.** Positions are freeform.
- **Text-to-path conversion.** `<text>` stays as text.

## Common traps

- **No `--` inside XML comments.** `<!-- set --bg-color to dark -->` breaks the whole SVG silently (browser shows nothing, Studio prints a parse error). Write `<!-- set bg-color to dark -->` instead. Quick check: `python -c "import xml.etree.ElementTree as ET; ET.parse('file.svg')"`.
- **Don't put `<style>` inside `<defs>`.** Must be a direct child of `<svg>`, first position. The Black Room's parser is regex-based and expects that exact shape.
- **Don't strip the `:root { }` selector.** A bare `--foo: bar;` at the top level won't be parsed as a custom property.
- **Careful with `;` inside `:root` values.** `--foo: "a; b"` needs quoting or will be truncated at the first `;`. Safest: simple numeric / colour / token values.
- **Don't over-promote to variables.** If a value appears once and is obviously fixed, leave it literal. Variables are for things the user might tune.
- **Don't invent fake `@ws` hints.** Closed vocabulary listed above. Anything else is a no-op — worse, it mutates future silently if you later add that hint keyword.
- **Kebab-case variable names.** `--light-x`, not `--lightX`. CSS convention; `point2d` hint matching keys off exact names.

## Useful references already in the repo

- `CLAUDE.md` — authoritative spec for the parametric-variable format and `@ws` hints.
- `sources/card_back_Showcase_Matiere.svg` — full-featured tarot card template (bg + frame + decoration + subject + glow-pulse filter). 481 lines.
- `sources/card_back_animated.svg` — same but with CSS keyframes + `--anim-speed` variable pattern + eye-energy aura.
- `images/projetFoD/{character,event,faction,group,item,location}.svg` — minimal 400×400 icon-family: same frame + silhouette + accent + label layout, one file per concept.
- `images/flowerWorkshop/newFlower/*.svg` — organic Q-curve flowers (Daisy, Rose, Bluebell, Pansy...).
- `images/bones/boneV13.svg` — JS-template pattern: file has `COLOR_*` / `DOG_NAME` placeholders that get substituted at runtime by `makeBone()`. Reference when the design has many reusable instances.
- `images/cheatSheets/cs_general.svg` — busy multi-section SVG with text + tables, good reference for `<text>` layout.
- `bezier.html` (the AI curve section) — shows how 8 path/circle elements combine into a complete flower. Each line is individually toggleable.

## Tools this skill expects

- `Read` / `Write` / `Edit` on files under `studio-work/` and sibling `images/` / `sources/` / `gallery/`.
- `Bash` to list versioned files and run quick XML / curl checks.
- `Playwright` (local install — `npx playwright install chromium` if missing) for visual verification. Scripts live under `tools/pw/`.
- Python (for the `xml.etree.ElementTree` quick validator — already available in the repo).
- Telegram reply tool for iteration pings.
- **Not required**: the Python backend on port 5174 (that's svg-from-photo's concern). Studio only needs the Node server on 5173.
