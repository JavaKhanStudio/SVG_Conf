// Static workshop viewer for the Formation_SVG site.
//
// Loads the SVGs listed in manifest.json, parses their :root CSS
// variables (with @ws hint comments), builds live controls, and applies
// edits as inline style overrides on the rendered SVG.  Persists
// per-file values to localStorage.
//
// Stripped from the full workshop-app/:
//   - no WebSocket file watching  (static deployment, no server)
//   - no upload / snapshot save   (no backend)
//   - no backend health banner    (no backend)
//   - no trace overlay / measure / metrics
//   - no point2d controls         (none of the gallery SVGs use them)
//
// Parser + control builder come from /src/ws-parser.js and
// /src/ws-controls.js — shared with workshop-app/ so the two hosts
// can't drift on hint syntax or type inference.

import {
  parseRootVars,
  isDerived as isDerivedVar,
  resolveDerived as resolveDerivedVars,
} from '/src/ws-parser.js';
import {
  buildControl,
  refreshDerivedSwatches,
  mixLabel,
} from '/src/ws-controls.js';

const $ = sel => document.querySelector(sel);

// Paths are relative to the host page (workshop.html at site root),
// not to this script. BASE is where the viewer's own assets live
// (manifest + reference photos). GALLERY_BASE is the canonical SVG
// source folder, shared with the live workshop app.
const BASE = 'workshop-viewer/';
const GALLERY_BASE = 'gallery/';

const state = {
  files: [],
  currentFile: null,
  currentRef: null,
  svgEl: null,
  variables: [],
  values: {},
  viewMode: 'svg',  // 'svg' | 'compare' | 'ref'
};

// ============================================================ boot
async function init() {
  const m = await fetch(BASE + 'manifest.json', {cache: 'no-store'}).then(r => r.json());
  state.files = m.files;
  renderFileList();
  if (state.files.length) selectFile(state.files[0].name);
  $('#reset-btn').addEventListener('click', resetToDefaults);
  $('#download-btn').addEventListener('click', downloadCurrentSvg);
  for (const btn of document.querySelectorAll('.view-btn')) {
    btn.addEventListener('click', () => setViewMode(btn.dataset.view));
  }
}

// ============================================================ file list
function renderFileList() {
  const ul = $('#file-list');
  ul.innerHTML = '';
  for (const f of state.files) {
    const li = document.createElement('li');
    li.textContent = f.label || f.name;
    if (f.name === state.currentFile) li.classList.add('active');
    li.addEventListener('click', () => selectFile(f.name));
    ul.appendChild(li);
  }
}

async function selectFile(name) {
  state.currentFile = name;
  const meta = state.files.find(f => f.name === name);
  state.currentRef = meta?.reference ? BASE + meta.reference : null;
  renderFileList();
  await loadSvg(name);
  applyViewMode();
  updateSourceLink(name);
}

function updateSourceLink(name) {
  const link = $('#source-link');
  if (!link) return;
  link.href = `${GALLERY_BASE}${encodeURIComponent(name)}`;
  link.hidden = false;
}

// ============================================================ SVG load + parse
async function loadSvg(name) {
  const text = await fetch(`${GALLERY_BASE}${encodeURIComponent(name)}`).then(r => r.text());
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svgEl = doc.documentElement;
  if (svgEl.nodeName !== 'svg') return;

  const vars = [];
  for (const s of svgEl.querySelectorAll('style')) {
    vars.push(...parseRootVars(s.textContent || ''));
  }

  const host = $('#preview-host');
  host.innerHTML = '';
  const imported = document.importNode(svgEl, true);
  host.appendChild(imported);
  state.svgEl = imported;

  const stored = loadStoredValues(name) || {};
  state.variables = vars.filter(v => v.hint?.type !== 'ignore');
  state.values = {};
  for (const v of state.variables) {
    state.values[v.name] = stored[v.name] !== undefined ? stored[v.name] : v.rawValue;
  }

  renderControls();
  applyAllValues();
}

// ============================================================ controls
function renderControls() {
  const root = $('#controls');
  root.innerHTML = '';
  const resolved = resolveDerivedVars(state.variables, state.values);
  for (const v of state.variables) {
    root.appendChild(buildControl(v, {
      getCurrentValue: (n) => state.values[n],
      setValue,
      isDerived: isDerivedVar,
      getDerivedColor: (n) => resolved[n],
      derivedLabel: mixLabel,
    }));
  }
  const empty = $('#empty-hint');
  if (empty) empty.hidden = state.variables.length > 0;
}

// ============================================================ value application
function setValue(name, val) {
  state.values[name] = val;
  if (state.svgEl) {
    const resolved = resolveDerivedVars(state.variables, state.values);
    for (const [k, v] of Object.entries(resolved)) {
      state.svgEl.style.setProperty(k, v);
    }
    refreshDerivedSwatches(state.variables, resolved, isDerivedVar);
  }
  saveStoredValues(state.currentFile, state.values);
}

function applyAllValues() {
  if (!state.svgEl) return;
  const resolved = resolveDerivedVars(state.variables, state.values);
  for (const [k, v] of Object.entries(resolved)) state.svgEl.style.setProperty(k, v);
}

function resetToDefaults() {
  if (!state.currentFile) return;
  if (state.svgEl) {
    for (const k of Object.keys(state.values)) state.svgEl.style.removeProperty(k);
  }
  try { localStorage.removeItem(storageKey(state.currentFile)); } catch {}
  state.values = {};
  for (const v of state.variables) state.values[v.name] = v.rawValue;
  renderControls();
}

// ============================================================ download
// Bakes the user's current variable overrides into a standalone .svg
// file. The live SVG root already has inline `style="--var: value"`
// declarations set by setValue/applyAllValues — those declarations
// take precedence over the file's internal `:root { ... }` defaults
// when the file is opened directly, so the visitor's tweaks survive.
function downloadCurrentSvg() {
  if (!state.svgEl || !state.currentFile) return;
  const clone = state.svgEl.cloneNode(true);
  // Strip our display:none toggle (only used for the reference-photo view)
  clone.style.removeProperty('display');
  if (!clone.getAttribute('xmlns')) {
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
            + new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stem = state.currentFile.replace(/\.svg$/i, '');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `${stem}-${stamp}.svg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================ view mode (SVG / Compare / Photo)
function setViewMode(mode) {
  // Fall back to 'svg' if the requested mode needs a reference but
  // the current file has none.
  if ((mode === 'compare' || mode === 'ref') && !state.currentRef) mode = 'svg';
  state.viewMode = mode;
  applyViewMode();
}

function applyViewMode() {
  const host = $('#preview-host');
  if (!host) return;

  const stale = host.querySelector('img.reference');
  if (stale) stale.remove();

  host.dataset.viewMode = state.viewMode;

  if (state.svgEl) {
    state.svgEl.style.display = state.viewMode === 'ref' ? 'none' : '';
  }

  if ((state.viewMode === 'ref' || state.viewMode === 'compare') && state.currentRef) {
    const img = document.createElement('img');
    img.className = 'reference';
    img.src = state.currentRef;
    img.alt = 'Reference photo';
    host.appendChild(img);
  }

  for (const btn of document.querySelectorAll('.view-btn')) {
    btn.classList.toggle('active', btn.dataset.view === state.viewMode);
    if (btn.dataset.view !== 'svg') {
      btn.disabled = !state.currentRef;
    }
  }
}

// ============================================================ localStorage
function storageKey(file) { return `formation-svg:workshop:${file}:values`; }
function saveStoredValues(file, values) {
  if (!file) return;
  try { localStorage.setItem(storageKey(file), JSON.stringify(values)); } catch {}
}
function loadStoredValues(file) {
  try {
    const s = localStorage.getItem(storageKey(file));
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

init();
