# SVG Conf

Companion repo for the "SVG and AI" presentation. Two things live here:

1. **The presentation site** (static HTML) — what visitors see on GitHub Pages.
2. **The interactive workshop** (Node server + optional Python backend) — the live-editing tool people can run locally if they clone the repo.

The static site works with no dependencies; starting `server.js` adds the interactive workshop on the same port.

## Presentation site

Just open `index.html` in a browser, or serve the folder statically:

```
python -m http.server 8080
```

Then visit http://localhost:8080. The published build is at `https://javakhanstudio.github.io/SVG_Conf/`.

## Interactive workshop (Node)

Live-edit any SVG's CSS variables, take snapshots, replay them.

```
npm install
node server.js ./gallery
```

Open http://localhost:5173 for the presentation site, or http://localhost:5173/workshop-app/ to launch the live editor.

## Full pipeline (Node + Python backend)

Adds the photo→SVG features: drop a phone photo on the preview, get preprocessed reference variants, trace, measure outline match against the source, sample flat fills.

One-time setup:
```
pip install -r backend/requirements.txt
```

Run both processes (in separate terminals):
```
node server.js ./gallery          # web + workshop, port 5173
backend/start.sh                  # backend, port 5174  (backend\start.bat on Windows)
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
.
├── index.html, gallery.html, concepts.html, ...   # presentation pages (GH Pages root)
├── css/, js/, parts/, images/                     # presentation assets
├── gallery/                                       # canonical SVG sources (shared)
│   ├── puppy.svg, leprechaun.svg, stone.svg, ...
│   └── .workshop/                                 # per-SVG runtime state (auto-created)
│       ├── *.snapshots.json                       # committed
│       └── *.metrics.json, *.refs/                # gitignored
├── workshop-viewer/                               # static viewer (used by workshop.html)
│   ├── viewer.js, viewer.css, manifest.json
│   └── references/                                # source photos shown in Compare mode
├── workshop-app/                                  # interactive editor (needs server.js)
│   ├── index.html, app.js, style.css
├── backend/                                       # Python backend (FastAPI on :5174)
├── src/                                           # shared frontend modules
├── sources/                                       # raw reference photos for the pipeline
├── examples/                                      # original demo SVGs
├── server.js, svgw.js                             # Node entry points
├── CLAUDE.md, PLAN.md, SPEC.md, OVERVIEW.md
└── .claude/skills/                                # agent skills (svg-from-photo)
```

See `CLAUDE.md` for the `@ws` SVG variable format. See `PLAN.md` / `SPEC.md` for the build roadmap.
