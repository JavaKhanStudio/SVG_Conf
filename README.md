# SVG Workshop

Local browser-based tool for live-previewing SVGs with editable CSS variables, plus an optional Python backend for the photo→SVG agent pipeline (preprocessing, tracing, measurement, color sampling).

See `CLAUDE.md` for the SVG variable format. See `PLAN.md` for the build roadmap.

## Workshop only (Node)

The workshop on its own — open SVGs, tweak CSS variables, snapshot, replay.

```
npm install
node server.js ./examples
```

Then open http://localhost:5173. With no folder argument, watches the current directory.

## Full pipeline (Node + Python backend)

Adds the photo→SVG features: drop a phone photo on the preview, get preprocessed reference variants, trace, measure outline match against the source, sample flat fills.

One-time setup:
```
pip install -r backend/requirements.txt
```

Run both processes (in separate terminals):
```
node server.js ./examples         # workshop, port 5173
backend/start.sh                  # backend, port 5174  (use backend\start.bat on Windows)
```

When the backend is down, a red banner appears at the top of the workshop. Core workshop features (load, edit, snapshot) keep working without it.

## Agent CLI

The `svgw` command wraps the backend HTTP API so the photo→SVG agent loop can use Bash naturally.

```
npm link                          # one-time, makes svgw globally available
svgw health                       # ping the backend
svgw health --json                # machine-readable
```

More subcommands (`preprocess`, `trace`, `measure`, `colors`) land as later phases ship.

## Folder layout

```
project-root/
  examples/                    # original demo SVGs that ship with the workshop
    eye.svg, scene.svg, car.svg ...
  gallery/                     # SVGs produced by the agent pipeline
    coffee.svg, bundaberg.svg, puppy.svg ...
  sources/                     # reference photos for the pipeline
    coffee.jpg, bundaberg.jpg, puppy.jpg ...
  gallery/.workshop/           # per-SVG runtime state (auto-created)
    coffee.svg.snapshots.json     # committed
    coffee.svg.metrics.json       # gitignored
    coffee.svg.refs/              # gitignored — preprocessed PNG variants
      gray.png, canny.png, otsu.png ...
  backend/                     # Python backend (FastAPI on :5174)
  src/                         # shared frontend modules
  .claude/skills/              # agent skills (svg-from-photo)
```

Run the workshop on whichever folder you want to browse:
```
node server.js ./gallery     # see the session results
node server.js ./examples    # see the original demo SVGs
node server.js ./            # watch everything at the project root
```
