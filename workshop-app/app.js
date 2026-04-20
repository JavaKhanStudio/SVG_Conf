// SVG Workshop frontend
// Single-file app. No framework, no build step.
//
// Parser + generic control builder are shared with workshop-viewer/
// via /src/ws-*.js. This file keeps everything that's editor-specific:
// the WebSocket file watcher, snapshots, metrics, reference overlays,
// and the point2d draggable-dot UI.

import {
  parseRootVars,
  isDerived,
  resolveDerived as resolveDerivedVars,
} from '/src/ws-parser.js';
import {
  buildControl as buildGenericControl,
  refreshDerivedSwatches as refreshSharedSwatches,
  mixLabel,
} from '/src/ws-controls.js';

const $ = sel => document.querySelector(sel);

const state = {
  files: [],
  currentFile: null,
  svgEl: null,          // parsed <svg> currently in the preview
  viewBox: null,        // {x,y,w,h}
  variables: [],        // [{name, rawValue, type, hint, group}]
  point2dGroups: [],    // [{group, xVar, yVar}]
  values: {},           // current values: { '--name': 'value' }
  snapshots: [],
  slideshowTimer: null,
};

// ---------- WebSocket ----------
function connectWS() {
  const ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = async (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'list') {
      state.files = msg.files;
      renderFileList();
    } else if (msg.type === 'change') {
      if (msg.file === state.currentFile) {
        await reloadCurrent();
        if ($('#auto-snap').checked) {
          // Give the DOM one frame to paint the new state before capturing.
          requestAnimationFrame(() => captureSnapshot());
        }
      }
    }
  };
  ws.onclose = () => setTimeout(connectWS, 1000);
}
connectWS();

// ---------- File list ----------
function renderFileList() {
  const ul = $('#file-list');
  ul.innerHTML = '';
  for (const f of state.files) {
    const li = document.createElement('li');
    li.textContent = f;
    if (f === state.currentFile) li.classList.add('active');
    li.addEventListener('click', () => selectFile(f));
    ul.appendChild(li);
  }
}

async function selectFile(name) {
  state.currentFile = name;
  renderFileList();
  await loadSvg(name);
  await loadSnapshots();
  loadReference(name);
  loadMetrics(name);
}

// ---------- SVG loading / parsing ----------
async function loadSvg(name) {
  const res = await fetch(`/files/${encodeURIComponent(name)}?t=${Date.now()}`);
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svgEl = doc.documentElement;
  if (svgEl.nodeName !== 'svg') {
    console.error('Not an SVG', name);
    return;
  }

  // Parse variables from all <style> blocks.
  const vars = [];
  const styles = svgEl.querySelectorAll('style');
  for (const s of styles) {
    vars.push(...parseRootVars(s.textContent || ''));
  }

  // Store view box
  const vbAttr = svgEl.getAttribute('viewBox');
  if (vbAttr) {
    const [x, y, w, h] = vbAttr.split(/[\s,]+/).map(Number);
    state.viewBox = { x, y, w, h };
  } else {
    state.viewBox = { x: 0, y: 0, w: 300, h: 150 };
  }

  // Inject into preview
  const host = $('#preview-host');
  host.innerHTML = '';
  // Import so it's an HTML-owned element
  const imported = document.importNode(svgEl, true);
  host.appendChild(imported);
  state.svgEl = imported;
  refreshTraceRefControl();

  // Build variable list, preserving existing in-memory values where possible
  const prevValues = state.values;
  const newValues = {};
  for (const v of vars) {
    if (v.hint?.type === 'ignore') continue;
    const key = v.name;
    if (prevValues[key] !== undefined) {
      newValues[key] = prevValues[key];
    } else {
      // try localStorage
      const stored = loadStoredValues(name);
      if (stored && stored[key] !== undefined) newValues[key] = stored[key];
      else newValues[key] = v.rawValue;
    }
  }
  state.variables = vars.filter(v => v.hint?.type !== 'ignore');
  state.values = newValues;

  // Group point2d pairs
  const groups = {};
  for (const v of state.variables) {
    if (v.hint?.type === 'point2d') {
      const g = v.hint.group;
      groups[g] = groups[g] || { group: g, vars: [] };
      groups[g].vars.push(v);
    }
  }
  state.point2dGroups = Object.values(groups)
    .filter(g => g.vars.length === 2)
    .map(g => ({ group: g.group, xVar: g.vars[0], yVar: g.vars[1] }));

  renderControls();
  applyAllValues();
  renderPointOverlay();
  positionReference();
  applyRefBgTransparency();

  $('#empty-hint').hidden = state.variables.length > 0;
  $('#no-vars-hint').hidden = state.variables.length > 0;
}

function reloadCurrent() {
  if (state.currentFile) return loadSvg(state.currentFile);
  return Promise.resolve();
}

// Parser + hint grammar + named-colour set live in /src/ws-parser.js.

// ---------- Controls rendering ----------
function renderControls() {
  const root = $('#controls');
  root.innerHTML = '';
  const handled = new Set();

  // point2d groups get a custom draggable-dot control; the shared
  // builder doesn't know about them.
  for (const g of state.point2dGroups) {
    handled.add(g.xVar.name);
    handled.add(g.yVar.name);
    root.appendChild(buildPoint2dControl(g));
  }

  const resolved = resolveDerivedVars(state.variables, state.values);
  const ctrlOpts = {
    getCurrentValue: (n) => state.values[n],
    setValue,
    isDerived,
    getDerivedColor: (n) => resolved[n],
    derivedLabel: mixLabel,
  };
  for (const v of state.variables) {
    if (handled.has(v.name)) continue;
    root.appendChild(buildGenericControl(v, ctrlOpts));
  }
}

function buildPoint2dControl(g) {
  const wrap = document.createElement('div');
  wrap.className = 'ctrl';
  const label = document.createElement('label');
  label.textContent = `point2d: ${g.group}  (${g.xVar.name}, ${g.yVar.name})`;
  wrap.appendChild(label);
  const row = document.createElement('div');
  row.className = 'p2d-xy';
  const xIn = document.createElement('input');
  xIn.type = 'number'; xIn.value = state.values[g.xVar.name] ?? g.xVar.rawValue;
  const yIn = document.createElement('input');
  yIn.type = 'number'; yIn.value = state.values[g.yVar.name] ?? g.yVar.rawValue;
  xIn.addEventListener('input', () => { setValue(g.xVar.name, xIn.value); renderPointOverlay(); });
  yIn.addEventListener('input', () => { setValue(g.yVar.name, yIn.value); renderPointOverlay(); });
  row.appendChild(xIn); row.appendChild(yIn);
  wrap.appendChild(row);
  // Remember inputs so drag can update them
  g._xIn = xIn; g._yIn = yIn;
  return wrap;
}

// ---------- Applying values ----------
function setValue(name, val) {
  state.values[name] = val;
  // Resolve derived colours and push everything to the rendered SVG so
  // that editing a base colour immediately propagates to its shades.
  if (state.svgEl) {
    const resolved = resolveDerivedVars(state.variables, state.values);
    for (const [k, v] of Object.entries(resolved)) {
      state.svgEl.style.setProperty(k, v);
    }
    refreshSharedSwatches(state.variables, resolved, isDerived);
  }
  saveStoredValues(state.currentFile, state.values);
  for (const g of state.point2dGroups) {
    if (g.xVar.name === name || g.yVar.name === name) {
      positionPointDot(g);
      break;
    }
  }
}

function positionPointDot(g) {
  if (!g._dot || !state.svgEl) return;
  const vb = state.viewBox;
  const svgRect = state.svgEl.getBoundingClientRect();
  const overlay = $('#point-overlay');
  const overlayRect = overlay.getBoundingClientRect();
  const drawn = fittedBox(svgRect, vb);
  const xVal = Number(state.values[g.xVar.name] ?? g.xVar.rawValue);
  const yVal = Number(state.values[g.yVar.name] ?? g.yVar.rawValue);
  const sx = drawn.left - overlayRect.left + ((xVal - vb.x) / vb.w) * drawn.width;
  const sy = drawn.top - overlayRect.top + ((yVal - vb.y) / vb.h) * drawn.height;
  g._dot.style.left = `${sx}px`;
  g._dot.style.top = `${sy}px`;
  if (g._label) {
    g._label.style.left = `${sx}px`;
    g._label.style.top = `${sy}px`;
  }
}

function applyAllValues() {
  if (!state.svgEl) return;
  const resolved = resolveDerivedVars(state.variables, state.values);
  for (const [k, v] of Object.entries(resolved)) {
    state.svgEl.style.setProperty(k, v);
  }
}

// ---------- Derived (linked) colours ----------
// Derived-colour logic (@ws mix=base:amount) lives in /src/ws-parser.js —
// isDerived + resolveDerived + mixColor are imported at the top of this file.

// Reset all variables to their source defaults: drop any inline overrides
// on the rendered SVG, clear the stored values for this file, reload the
// in-memory state from the source CSS, re-render controls.
function resetToDefaults() {
  if (!state.currentFile) return;
  // 1. Remove inline-style overrides from the rendered SVG so the source
  //    defaults take effect again.
  if (state.svgEl) {
    for (const k of Object.keys(state.values)) {
      state.svgEl.style.removeProperty(k);
    }
  }
  // 2. Clear stored values for this file.
  try { localStorage.removeItem(storageKey(state.currentFile)); } catch {}
  // 3. Reset the in-memory values to the source rawValues.
  state.values = {};
  for (const v of state.variables) state.values[v.name] = v.rawValue;
  // 4. Re-render controls + point overlay.
  renderControls();
  renderPointOverlay();
}

$('#reset-btn').addEventListener('click', resetToDefaults);

// ---------- localStorage ----------
function storageKey(file) { return `svgworkshop:${file}:values`; }
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

// ---------- Point2d overlay ----------
function renderPointOverlay() {
  const overlay = $('#point-overlay');
  overlay.innerHTML = '';
  if (!state.svgEl || state.point2dGroups.length === 0) return;

  const svgRect = state.svgEl.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  const vb = state.viewBox;

  // svg is max-width/max-height fitted; compute actual drawn rect inside svgRect
  const drawn = fittedBox(svgRect, vb);

  for (const g of state.point2dGroups) {
    const dot = document.createElement('div');
    dot.className = 'point-dot';
    overlay.appendChild(dot);

    const lbl = document.createElement('div');
    lbl.className = 'point-label';
    lbl.textContent = g.group;
    overlay.appendChild(lbl);

    g._dot = dot;
    g._label = lbl;
    positionPointDot(g);
    makeDraggable(dot, g);
  }
}

function fittedBox(svgRect, vb) {
  // SVG aspect vs container aspect
  const svgAR = vb.w / vb.h;
  const boxAR = svgRect.width / svgRect.height;
  let w, h;
  if (svgAR > boxAR) {
    w = svgRect.width; h = svgRect.width / svgAR;
  } else {
    h = svgRect.height; w = svgRect.height * svgAR;
  }
  const left = svgRect.left + (svgRect.width - w) / 2;
  const top = svgRect.top + (svgRect.height - h) / 2;
  return { left, top, width: w, height: h };
}

function makeDraggable(dot, g) {
  let dragging = false;
  const update = (ev) => {
    const vb = state.viewBox;
    const rect = state.svgEl.getBoundingClientRect();
    const d = fittedBox(rect, vb);
    const px = ev.clientX - d.left;
    const py = ev.clientY - d.top;
    const vx = vb.x + (px / d.width) * vb.w;
    const vy = vb.y + (py / d.height) * vb.h;
    const xClamped = Math.max(vb.x, Math.min(vb.x + vb.w, vx));
    const yClamped = Math.max(vb.y, Math.min(vb.y + vb.h, vy));
    const xStr = round(xClamped);
    const yStr = round(yClamped);
    // setValue repositions the dot in place via positionPointDot.
    setValue(g.xVar.name, xStr);
    setValue(g.yVar.name, yStr);
    if (g._xIn) g._xIn.value = xStr;
    if (g._yIn) g._yIn.value = yStr;
  };
  dot.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    dragging = true;
    dot.setPointerCapture(ev.pointerId);
    dot.classList.add('dragging');
    update(ev);
  });
  dot.addEventListener('pointermove', (ev) => { if (dragging) update(ev); });
  const stop = () => { dragging = false; dot.classList.remove('dragging'); };
  dot.addEventListener('pointerup', stop);
  dot.addEventListener('pointercancel', stop);
}
function round(n) { return Math.round(n * 100) / 100; }

window.addEventListener('resize', () => {
  renderPointOverlay();
  positionReference();
});

// ---------- Reference image overlay ----------
// State per SVG file lives at localStorage[svgworkshop:<file>:refstate] as JSON:
//   { variants: ['original','gray',...], current: 'canny', sourceName: 'voiture.jpg' }
// Image bytes themselves live on disk under .workshop/<file>.refs/<variant>.png
// and are served by the workshop server at /refs/<file>/<variant>.png.

const DEFAULT_VARIANT = 'canny';

function refStateKey(file) { return `svgworkshop:${file}:refstate`; }

function readRefState(file) {
  if (!file) return null;
  try {
    const raw = localStorage.getItem(refStateKey(file));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeRefState(file, refState) {
  if (!file) return;
  try { localStorage.setItem(refStateKey(file), JSON.stringify(refState)); } catch {}
}

function clearRefState(file) {
  if (!file) return;
  try { localStorage.removeItem(refStateKey(file)); } catch {}
}

function refImageUrl(file, variant) {
  // Cache-bust on every variant switch so reprocessed refs aren't stale.
  return `/refs/${encodeURIComponent(file)}/${encodeURIComponent(variant)}.png?t=${Date.now()}`;
}

function renderVariantDropdown(refState) {
  const sel = $('#ref-variant');
  sel.innerHTML = '';
  if (!refState || !refState.variants?.length) {
    sel.hidden = true;
    return;
  }
  for (const name of refState.variants) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    if (name === refState.current) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.hidden = false;
}

function loadReference(file) {
  const img = $('#reference-img');
  img.removeAttribute('src');
  img.hidden = true;
  applyRefBgTransparency();

  const refState = readRefState(file);
  renderVariantDropdown(refState);
  if (!refState) return;

  // Auto-enable the toggle when switching to a file that has a saved reference
  // so the user actually sees it.
  $('#ref-toggle').checked = true;
  img.src = refImageUrl(file, refState.current);
  img.onload = () => {
    positionReference();
    img.hidden = !$('#ref-toggle').checked;
    applyRefBgTransparency();
  };
}

function setVariant(file, variant) {
  const refState = readRefState(file);
  if (!refState || !refState.variants.includes(variant)) return;
  refState.current = variant;
  writeRefState(file, refState);
  const img = $('#reference-img');
  img.src = refImageUrl(file, variant);
  img.onload = () => positionReference();
}

// When the reference is visible, force the SVG's --bg custom property to
// transparent so a background <rect fill="var(--bg)"/> (our convention) doesn't
// cover the image. When the toggle is off, restore whatever value the user had.
function applyRefBgTransparency() {
  if (!state.svgEl) return;
  const img = $('#reference-img');
  const shouldHide = $('#ref-toggle').checked && img.src && !img.hidden;
  if (shouldHide) {
    state.svgEl.style.setProperty('--bg', 'transparent');
  } else {
    if (state.values['--bg'] !== undefined) {
      state.svgEl.style.setProperty('--bg', state.values['--bg']);
    } else {
      state.svgEl.style.removeProperty('--bg');
    }
  }
}

function clearReference(file) {
  clearRefState(file);
  const img = $('#reference-img');
  img.removeAttribute('src');
  img.hidden = true;
  renderVariantDropdown(null);
  applyRefBgTransparency();
}

function positionReference() {
  const img = $('#reference-img');
  if (!img.src || !state.svgEl) return;
  const svgRect = state.svgEl.getBoundingClientRect();
  if (svgRect.width === 0 || svgRect.height === 0) return;
  const wrap = $('#preview-wrap').getBoundingClientRect();
  const drawn = fittedBox(svgRect, state.viewBox);
  img.style.left = `${drawn.left - wrap.left}px`;
  img.style.top = `${drawn.top - wrap.top}px`;
  img.style.width = `${drawn.width}px`;
  img.style.height = `${drawn.height}px`;
  img.style.opacity = String(Number($('#ref-opacity').value) / 100);
}

$('#ref-toggle').addEventListener('change', () => {
  const img = $('#reference-img');
  img.hidden = !$('#ref-toggle').checked || !img.src;
  if (!img.hidden) positionReference();
  applyRefBgTransparency();
});
$('#ref-opacity').addEventListener('input', () => {
  $('#reference-img').style.opacity = String(Number($('#ref-opacity').value) / 100);
});
$('#ref-clear').addEventListener('click', () => {
  clearReference(state.currentFile);
  $('#ref-toggle').checked = false;
});
$('#ref-variant').addEventListener('change', (e) => {
  setVariant(state.currentFile, e.target.value);
});

// ---------- Trace-ref overlay toggle ----------
// When an SVG file contains <g id="trace-ref" display="none"> (injected by
// `svgw trace`), reveal a "Trace" toggle in the toolbar that flips its
// display at runtime. Off by default whenever a fresh SVG is loaded.
function refreshTraceRefControl() {
  const wrap = $('#trace-ref-toggle-wrap');
  const toggle = $('#trace-ref-toggle');
  const group = state.svgEl?.querySelector('#trace-ref');
  if (!group) {
    wrap.hidden = true;
    toggle.checked = false;
    return;
  }
  wrap.hidden = false;
  toggle.checked = false;
  group.style.display = 'none';
}

$('#trace-ref-toggle').addEventListener('change', (e) => {
  const group = state.svgEl?.querySelector('#trace-ref');
  if (!group) return;
  group.style.display = e.target.checked ? 'inline' : 'none';
});

// ---------- Metrics ----------
const METRIC_ROWS = [
  { key: 'outline_iou', label: 'outline IoU' },
  { key: 'pixel_iou',   label: 'pixel IoU' },
  { key: 'edge_ssim',   label: 'edge SSIM' },
];

function scoreClass(n) {
  if (n >= 0.85) return 'score-good';
  if (n >= 0.65) return 'score-mid';
  return 'score-bad';
}

function renderMetrics(entry) {
  const empty = $('#metrics-empty');
  const scores = $('#metrics-scores');
  if (!entry) {
    empty.hidden = false;
    scores.hidden = true;
    scores.innerHTML = '';
    return;
  }
  empty.hidden = true;
  scores.hidden = false;
  scores.innerHTML = '';
  for (const { key, label } of METRIC_ROWS) {
    const v = Number(entry[key] || 0);
    const pct = Math.max(0, Math.min(100, v * 100));
    const cls = scoreClass(v);
    const labelEl = document.createElement('div'); labelEl.className = 'label'; labelEl.textContent = label;
    const bar = document.createElement('div'); bar.className = `bar ${cls}`;
    const fill = document.createElement('span'); fill.style.width = `${pct}%`; bar.appendChild(fill);
    const score = document.createElement('div'); score.className = `score ${cls}`; score.textContent = v.toFixed(3);
    scores.appendChild(labelEl); scores.appendChild(bar); scores.appendChild(score);
  }
  const meta = document.createElement('div');
  meta.id = 'metrics-meta';
  const ts = entry.ts ? new Date(entry.ts * 1000).toLocaleTimeString() : '?';
  meta.textContent = `last run ${ts}${entry.label ? ` · ${entry.label}` : ''} · ${entry.target_size?.join('×') || ''}`;
  scores.appendChild(meta);
}

async function loadMetrics(file) {
  if (!file) return renderMetrics(null);
  try {
    const res = await fetch(`/api/metrics/${encodeURIComponent(file)}`);
    const history = await res.json();
    renderMetrics(history.length ? history[history.length - 1] : null);
  } catch {
    renderMetrics(null);
  }
}

$('#measure-btn').addEventListener('click', async () => {
  if (!state.currentFile) return;
  const btn = $('#measure-btn');
  btn.disabled = true; btn.textContent = '…';
  try {
    const res = await fetch(`/api/measure?for=${encodeURIComponent(state.currentFile)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'manual' }),
    });
    if (!res.ok) {
      const text = await res.text();
      alert(`Measure failed (${res.status}): ${text}`);
      return;
    }
    const entry = await res.json();
    renderMetrics(entry);
  } catch (err) {
    alert(`Measure failed: ${err.message}\n\nIs the Python backend running?`);
  } finally {
    btn.disabled = false; btn.textContent = 'Measure';
  }
});

// Drop any non-SVG image onto the preview pane → backend preprocess → variants saved.
const previewPane = $('#preview-pane');
['dragenter', 'dragover'].forEach(ev => previewPane.addEventListener(ev, (e) => {
  const hasFiles = [...(e.dataTransfer?.types || [])].includes('Files');
  if (!hasFiles) return;
  e.preventDefault();
  e.stopPropagation();
  previewPane.classList.add('drag-over');
}));
['dragleave', 'drop'].forEach(ev => previewPane.addEventListener(ev, (e) => {
  previewPane.classList.remove('drag-over');
}));
previewPane.addEventListener('drop', async (e) => {
  const file = e.dataTransfer?.files?.[0];
  if (!file) return;
  // SVGs are for the file-list drop zone (they become watched files).
  if (file.name.toLowerCase().endsWith('.svg')) return;
  if (!file.type.startsWith('image/')) return;
  e.preventDefault();
  e.stopPropagation();
  if (!state.currentFile) {
    alert('Select an SVG file first, then drop a reference image.');
    return;
  }

  const fd = new FormData();
  fd.append('image', file, file.name);
  let res;
  try {
    res = await fetch(`/api/preprocess-ref?for=${encodeURIComponent(state.currentFile)}`, {
      method: 'POST', body: fd,
    });
  } catch (err) {
    alert(`Preprocess failed: ${err.message}\n\nIs the Python backend running?`);
    return;
  }
  if (!res.ok) {
    const text = await res.text();
    alert(`Preprocess failed (${res.status}): ${text}`);
    return;
  }
  const payload = await res.json();
  const refState = {
    variants: payload.variants.map(v => v.name),
    current: payload.variants.some(v => v.name === DEFAULT_VARIANT) ? DEFAULT_VARIANT : payload.variants[0]?.name,
    sourceName: file.name,
  };
  writeRefState(state.currentFile, refState);
  renderVariantDropdown(refState);
  $('#ref-toggle').checked = true;
  const img = $('#reference-img');
  img.src = refImageUrl(state.currentFile, refState.current);
  img.onload = () => {
    img.hidden = false;
    positionReference();
    applyRefBgTransparency();
  };
});

// One-time migration: nuke the old data-URL-based reference keys from when
// references lived entirely in localStorage. Skipped on subsequent loads.
(function migrateOldReferenceKeys() {
  const FLAG = 'svgworkshop:migration:refs-v2';
  try {
    if (localStorage.getItem(FLAG)) return;
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && /^svgworkshop:.+:reference$/.test(k)) toDelete.push(k);
    }
    toDelete.forEach(k => localStorage.removeItem(k));
    localStorage.setItem(FLAG, '1');
  } catch {}
})();

// ---------- Snapshots ----------
async function loadSnapshots() {
  if (!state.currentFile) return;
  const res = await fetch(`/api/snapshots/${encodeURIComponent(state.currentFile)}`);
  state.snapshots = await res.json();
  renderSnapshots();
}

async function saveSnapshots() {
  if (!state.currentFile) return;
  await fetch(`/api/snapshots/${encodeURIComponent(state.currentFile)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state.snapshots),
  });
}

function renderSnapshots() {
  const strip = $('#snapshots-strip');
  strip.innerHTML = '';
  for (const s of state.snapshots) {
    const el = document.createElement('div');
    el.className = 'snap';
    el.innerHTML = `
      <img src="${s.thumbnail}" alt="${s.label}" />
      <div class="label">${escapeHtml(s.label)}</div>
      <div class="actions">
        <button data-act="rename">✏️</button>
        <button data-act="delete">🗑️</button>
      </div>
    `;
    el.querySelector('img').addEventListener('click', () => restoreSnapshot(s));
    el.querySelector('.label').addEventListener('click', () => restoreSnapshot(s));
    el.querySelector('[data-act="rename"]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const name = prompt('Label:', s.label);
      if (name) { s.label = name; renderSnapshots(); saveSnapshots(); }
    });
    el.querySelector('[data-act="delete"]').addEventListener('click', (ev) => {
      ev.stopPropagation();
      state.snapshots = state.snapshots.filter(x => x.id !== s.id);
      renderSnapshots();
      saveSnapshots();
    });
    strip.appendChild(el);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function restoreSnapshot(s) {
  state.values = { ...s.values };
  applyAllValues();
  renderControls();
  renderPointOverlay();
  saveStoredValues(state.currentFile, state.values);
}

async function captureSnapshot() {
  if (!state.svgEl) return;
  const thumbnail = await svgToThumbnail(state.svgEl);
  const snap = {
    id: String(Date.now()) + Math.random().toString(36).slice(2, 6),
    label: new Date().toLocaleTimeString(),
    timestamp: Date.now(),
    values: { ...state.values },
    thumbnail,
  };
  state.snapshots.push(snap);
  renderSnapshots();
  saveSnapshots();
}

async function svgToThumbnail(svgEl) {
  // Serialize a clone with inline styles applied
  const clone = svgEl.cloneNode(true);
  // Copy inline custom property overrides
  for (const [k, v] of Object.entries(state.values)) {
    clone.style.setProperty(k, v);
  }
  const xml = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([xml], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(svgBlob);
  try {
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const size = 200;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#0a0a10';
    ctx.fillRect(0, 0, size, size);
    // Fit contain
    const iw = img.width || state.viewBox.w;
    const ih = img.height || state.viewBox.h;
    const r = Math.min(size / iw, size / ih);
    const w = iw * r, h = ih * r;
    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

$('#capture-btn').addEventListener('click', captureSnapshot);

// ---------- Slideshow ----------
$('#slideshow-btn').addEventListener('click', () => {
  if (state.slideshowTimer) stopSlideshow();
  else startSlideshow();
});

function startSlideshow() {
  if (state.snapshots.length === 0) return;
  const ms = Number($('#interval-input').value) || 1500;
  document.body.classList.add('slideshow');
  let i = 0;
  restoreSnapshot(state.snapshots[0]);
  state.slideshowTimer = setInterval(() => {
    i = (i + 1) % state.snapshots.length;
    restoreSnapshot(state.snapshots[i]);
  }, ms);
  $('#slideshow-btn').textContent = '⏹';
}

function stopSlideshow() {
  clearInterval(state.slideshowTimer);
  state.slideshowTimer = null;
  document.body.classList.remove('slideshow');
  $('#slideshow-btn').textContent = '▶';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.slideshowTimer) stopSlideshow();
});
document.addEventListener('click', (e) => {
  if (state.slideshowTimer && !e.target.closest('#snapshots-section')) stopSlideshow();
}, true);

// ---------- Drop zone upload ----------
const dropZone = $('#drop-zone');
['dragenter','dragover'].forEach(ev => dropZone.addEventListener(ev, (e) => {
  e.preventDefault(); e.stopPropagation(); dropZone.classList.add('drag-over');
}));
['dragleave','drop'].forEach(ev => dropZone.addEventListener(ev, (e) => {
  e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('drag-over');
}));
dropZone.addEventListener('drop', async (e) => {
  const file = e.dataTransfer.files?.[0];
  if (!file) return;
  if (!file.name.toLowerCase().endsWith('.svg')) { alert('Only .svg files.'); return; }
  const fd = new FormData();
  fd.append('file', file, file.name);
  await fetch('/api/upload', { method: 'POST', body: fd });
  // The watcher will broadcast a new list; also select it
  setTimeout(() => selectFile(file.name), 300);
});

// Ignore drops outside drop zone
['dragover','drop'].forEach(ev => {
  window.addEventListener(ev, (e) => {
    if (!e.target.closest('#drop-zone')) { e.preventDefault(); }
  });
});
