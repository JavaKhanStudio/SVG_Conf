# SVG Workshop — Build Spec

## Purpose
A local browser-based tool for live-previewing an SVG with editable variables. Designed for visual concept exploration, paired with an external editor (VS Code / Claude Code) editing the SVG file on disk.

The SVG itself stays 100% valid and standalone — variables are real CSS custom properties declared in a `<style>` block. The tool is purely additive: a nicer way to explore values, never a required runtime.

## Tech stack
- **Frontend**: single `index.html` + `app.js` + `style.css`. No framework, no build step, native ES modules.
- **Server**: single `server.js`, Node. Dependencies: `ws`, `chokidar`, and a minimal static file server (`serve-static` + `finalhandler`, or equivalent).
- **Run**: `node server.js ./path/to/svg-folder` → opens on `http://localhost:5173`. If no folder arg is given, defaults to `./`.

## Folder layout (runtime)
```
my-svg-folder/
  eye.svg
  bricks.svg
  .workshop/
    eye.snapshots.json
    bricks.snapshots.json
```

## Variable format

Variables are **CSS custom properties** declared in a `:root { }` rule inside a `<style>` element that is a **direct child of the root `<svg>`**. The style block should be the first child element of the SVG so it's the first thing a human reader sees.

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <style>
    :root {
      --bg-color: #1a1a2e;
      --eye-color: rgb(100,255,155);
      --pupil-size: 20;                 /* @ws number min=5 max=50 step=1 */
      --style-mode: soft;               /* @ws select options=soft,sharp,neon */
      --seed: 12345;                    /* @ws seed */
      --light-x: 100;                   /* @ws point2d=light */
      --light-y: 50;                    /* @ws point2d=light */
      --glow: true;
    }
  </style>
  <rect width="100%" height="100%" fill="var(--bg-color)" />
  <circle cx="var(--light-x)" cy="var(--light-y)" r="var(--pupil-size)" fill="var(--eye-color)" />
</svg>
```

The SVG renders correctly in any browser, in Inkscape, or pasted into a Vue component, because it's just CSS. The tool overrides values at runtime by setting inline properties on the rendered SVG root — the source file is never mutated.

### Type inference (no hint required)
For each `--var` declaration, the tool guesses the control type from the value:

| Value pattern | Inferred type | Control |
|---|---|---|
| Starts with `#`, `rgb(`, `rgba(`, `hsl(`, `hsla(`, or is a CSS named color | `color` | color picker |
| Pure number, optionally with unit (`px`, `deg`, `%`, `em`, `rem`) | `number` | number input + slider with sensible auto-range |
| `true` or `false` | `boolean` | checkbox |
| Anything else | `text` | text input |

For auto-inferred numbers without an explicit range, default the slider to `0..100` if the value fits, otherwise `value*0..value*2` rounded to a sensible step.

### Hint comments (optional, upgrade the control)
A trailing comment on the same line, in the form `/* @ws <type> [key=value]... */`, upgrades the control with extra metadata. Comments are ignored by the browser, so the SVG stays valid.

| Hint | Effect |
|---|---|
| `@ws number min=5 max=50 step=1` | Number slider with explicit range |
| `@ws select options=soft,sharp,neon` | Dropdown with the listed options |
| `@ws seed` | Number input with a 🎲 randomize button |
| `@ws point2d=<groupname>` | Pairs two variables sharing the same groupname into a single draggable dot in the preview |
| `@ws color` | Force color picker (in case inference picks the wrong type) |
| `@ws text` | Force text input |
| `@ws ignore` | Skip this variable entirely (don't generate a control) |

**Point2d pairing rule**: any two variables tagged with the same `@ws point2d=<name>` are grouped into a single 2D control. Convention is `--<name>-x` and `--<name>-y` but the tool only relies on the hint group name, not the variable names. The 2D control renders as a draggable dot overlaid on the preview pane (in SVG viewBox coordinate space) plus two number inputs in the sidebar. The dot's range defaults to the SVG's viewBox.

## Server (`server.js`)

- Takes a folder path as CLI arg, defaults to `./`
- Serves static frontend assets (`index.html`, `app.js`, `style.css`) from the tool's install location
- Serves the watched folder's `.svg` files at `/files/<name>.svg`
- Watches the folder with chokidar (non-recursive, `.svg` files only, ignores `.workshop/`)
- Exposes a WebSocket on the same port:
  - On connect, sends `{ type: "list", files: [...] }`
  - On file change: `{ type: "change", file: "eye.svg" }`
  - On file added/removed: `{ type: "list", files: [...] }`
- Snapshot HTTP API:
  - `GET /api/snapshots/:file` → returns `.workshop/<file>.snapshots.json` contents (or `[]` if missing)
  - `POST /api/snapshots/:file` → writes the JSON body to that file (creates `.workshop/` if needed)
- Upload API:
  - `POST /api/upload` → accepts a multipart SVG upload, writes it into the watched folder

## Frontend layout

Three regions:

1. **Left sidebar — Files**
   - List of `.svg` files in the watched folder
   - Click an entry to lock it as the current reference
   - The top of this list is a drag-and-drop zone: dropping an SVG file here uploads it via `/api/upload` and it appears in the list
   - Drops anywhere else in the page are ignored

2. **Center — Preview**
   - The rendered SVG, scaled to fit
   - For each `point2d` variable, a draggable dot is overlaid on this pane in SVG viewBox coordinate space (transformed to screen space). Dragging updates both paired CSS variables live.

3. **Right sidebar — Controls + Snapshots**
   - Top half: auto-generated control panel for the current SVG's variables
   - Bottom half: snapshots strip with thumbnails, a 📸 capture button, a ▶ slideshow button, and an interval input (default 1500ms)

## Behavior

### Loading an SVG
1. Fetch the file, parse it with `DOMParser` as `image/svg+xml`
2. Inject the parsed SVG into the preview pane
3. Find all `<style>` elements anywhere in the SVG (scan all of them, not just the first)
4. From each `<style>`, extract the `:root { }` block's declarations along with any trailing `/* @ws ... */` hint comments. A small regex pass over the raw CSS text is fine — no need for a full CSS parser.
5. For each declaration: build a control using inference + hints, unless `@ws ignore`
6. Group `point2d`-tagged pairs into single controls
7. Initial values for each control come from: (1) localStorage if present for this file, else (2) the value in the source CSS
8. Apply all current values via `svgEl.style.setProperty('--name', value)` on the rendered SVG root

### Live updates from controls
- Every control change calls `svgEl.style.setProperty('--name', value)`
- Every change is mirrored to localStorage under `svgworkshop:<filename>:values`
- The source SVG file is **never** modified by the tool

### File watch reload
- WebSocket message `{ type: "change", file }` matching the locked file → refetch + re-parse
- For each variable in the new parse: if a value with the same name already exists in current state, keep it; otherwise use the new default from the source
- Drop variables that no longer exist
- Re-render and re-apply current values

### Empty case
If no `:root` declarations are found in any `<style>` block, show the SVG anyway and display a hint in the controls panel: *"No CSS variables declared. Add a `<style>` block with a `:root { }` rule to enable controls. See `CLAUDE.md`."*

### Snapshots
- 📸 button captures: `{ id, label, timestamp, values, thumbnail }`
  - `values` is a flat object: `{ "--bg-color": "#1a1a2e", "--pupil-size": "25", ... }`
  - `thumbnail` is the current rendered SVG serialized to a small PNG data URL (e.g. 200×200 via canvas)
- Snapshots persist via `POST /api/snapshots/:file` to `.workshop/<file>.snapshots.json`
- On load, fetch existing snapshots via `GET /api/snapshots/:file`
- Clicking a snapshot thumbnail restores its values
- Each snapshot has ✏️ rename and 🗑️ delete buttons

### Slideshow
- ▶ plays through snapshots in order in the preview pane
- Configurable interval next to the play button (default 1500ms)
- Click anywhere or press Esc to stop

### Drag-and-drop semantics
- Drop on the **file list area** → uploads into the watched folder, becomes a normal watched file
- Drop anywhere else → ignored

## Out of scope for v1
- Side-by-side multi-variant comparison
- Exporting snapshots as video/gif
- In-tool SVG source editing
- Nested or grouped variables in the sidebar
- Watching subfolders recursively

## Deliverables
1. `server.js`
2. `index.html`
3. `app.js`
4. `style.css`
5. `package.json` with `start` script
6. `README.md` — install, run, basic usage
7. `CLAUDE.md` — already provided alongside this spec; copy it into the project root
8. `examples/` folder with 2 sample SVGs that exercise every variable type and hint

## Implementation notes / gotchas

- **Parse SVGs with `DOMParser` in `image/svg+xml` mode**, not `text/html`. Namespaces matter.
- **The CSS `:root` parser can be a small regex**, not a full CSS parser. Match `:root\s*\{([^}]*)\}` then split declarations on `;`. For each declaration, capture the property name, value, and optional trailing `/\* @ws ([^*]*) \*/` comment. Keep it simple.
- **Live updates use `setProperty` on the inline style of the rendered `<svg>` root.** Never mutate the source `<style>` block.
- **Reset to source defaults** = remove the inline properties (`removeProperty('--name')`).
- **Generating thumbnails**: serialize the current rendered SVG with `XMLSerializer`, draw it to an offscreen `<canvas>` via `new Image()` + `drawImage`, then `canvas.toDataURL('image/png')`.
- **Snapshot files in `.workshop/`** should be human-readable JSON (pretty-printed, 2-space indent) — they're meant to be git-committable.
