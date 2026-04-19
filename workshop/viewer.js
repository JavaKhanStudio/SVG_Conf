// Static workshop viewer for the Formation_SVG site.
//
// Loads the SVGs listed in manifest.json, parses their :root CSS
// variables (with @ws hint comments), builds live controls, and applies
// edits as inline style overrides on the rendered SVG.  Persists
// per-file values to localStorage.
//
// Stripped from the full SVG_Designer workshop:
//   - no WebSocket file watching  (static deployment, no server)
//   - no upload / snapshot save   (no backend)
//   - no backend health banner    (no backend)
//   - no trace overlay / measure / metrics
//   - no point2d controls         (none of the gallery SVGs use them)
//
// Reference photos: each manifest entry can carry a `reference` path
// (relative to the workshop folder).  A 3-state segmented control
// (SVG / Compare / Photo) lets the visitor view the SVG alone, the
// source photo alone, or both side-by-side in the preview pane.

const $ = sel => document.querySelector(sel);

// Paths are relative to the host page (workshop.html at site root),
// not to this script — so prefix everything with the workshop folder.
const BASE = 'workshop/';

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
}

// ============================================================ SVG load + parse
async function loadSvg(name) {
  const text = await fetch(`${BASE}gallery/${encodeURIComponent(name)}`).then(r => r.text());
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

function parseRootVars(cssText) {
  const out = [];
  const rootRe = /:root\s*\{([^}]*)\}/g;
  let m;
  while ((m = rootRe.exec(cssText))) {
    const declRe = /(--[\w-]+)\s*:\s*([^;]*?)\s*;[ \t]*(?:\/\*\s*@ws\s*([^*]*?)\s*\*\/)?/g;
    let d;
    while ((d = declRe.exec(m[1]))) {
      const hint = d[3] ? parseHint(d[3]) : null;
      const type = hint?.type && !['point2d','seed','ignore','mix'].includes(hint.type)
        ? hint.type : inferType(d[2].trim());
      out.push({ name: d[1], rawValue: d[2].trim(), type, hint });
    }
  }
  return out;
}

function parseHint(s) {
  const parts = s.trim().split(/\s+/);
  const first = parts.shift();
  const hint = { raw: s.trim() };
  if (first.includes('=')) {
    const [k, v] = first.split('=');
    hint.type = k; hint.group = v;
  } else hint.type = first;
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (v === undefined) continue;
    if (k === 'options') hint.options = v.split(',');
    else hint[k] = isNaN(Number(v)) ? v : Number(v);
  }
  return hint;
}

function inferType(v) {
  if (/^#([0-9a-f]{3,8})$/i.test(v)) return 'color';
  if (/^rgba?\(/i.test(v) || /^hsla?\(/i.test(v)) return 'color';
  if (/^-?\d+(\.\d+)?(px|deg|%|em|rem)?$/.test(v)) return 'number';
  if (v === 'true' || v === 'false') return 'boolean';
  return 'text';
}

// ============================================================ controls
function renderControls() {
  const root = $('#controls');
  root.innerHTML = '';
  for (const v of state.variables) {
    root.appendChild(buildControl(v));
  }
  const empty = $('#empty-hint');
  if (empty) empty.hidden = state.variables.length > 0;
}

function buildControl(v) {
  const wrap = document.createElement('div');
  wrap.className = 'ctrl';
  const label = document.createElement('label');
  label.textContent = v.name;
  wrap.appendChild(label);
  const row = document.createElement('div');
  row.className = 'row';
  wrap.appendChild(row);

  if (isDerived(v)) {
    const resolved = resolveDerived(state.values);
    const swatch = document.createElement('div');
    swatch.setAttribute('data-derived-swatch', v.name);
    swatch.style.cssText = 'width:36px;height:24px;border:1px solid #444;border-radius:3px;background:' + (resolved[v.name] || v.rawValue);
    const info = document.createElement('span');
    info.style.cssText = 'font-size:10px;color:#88899a;margin-left:6px;font-family:ui-monospace,monospace;';
    info.textContent = '= ' + (v.hint.raw.match(/mix=[\w-]+:-?\d*\.?\d+/)?.[0] || 'derived');
    row.appendChild(swatch); row.appendChild(info);
    return wrap;
  }

  const current = state.values[v.name] ?? v.rawValue;

  if (v.hint?.type === 'select') {
    const sel = document.createElement('select');
    for (const opt of v.hint.options || []) {
      const o = document.createElement('option');
      o.value = opt; o.textContent = opt;
      if (opt === current) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => setValue(v.name, sel.value));
    row.appendChild(sel);
    return wrap;
  }

  if (v.type === 'color') {
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = normalizeColorForPicker(current);
    picker.addEventListener('input', () => setValue(v.name, picker.value));
    const text = document.createElement('input');
    text.type = 'text'; text.value = current;
    text.addEventListener('change', () => {
      setValue(v.name, text.value);
      picker.value = normalizeColorForPicker(text.value);
    });
    row.appendChild(picker); row.appendChild(text);
    return wrap;
  }

  if (v.type === 'number') {
    const num = parseFloat(current);
    const min = v.hint?.min ?? Math.min(0, num);
    const max = v.hint?.max ?? Math.max(num * 2, 100);
    const step = v.hint?.step ?? (Number.isInteger(num) ? 1 : 0.1);
    const range = document.createElement('input');
    range.type = 'range'; range.min = min; range.max = max; range.step = step; range.value = num;
    const numIn = document.createElement('input');
    numIn.type = 'number'; numIn.min = min; numIn.max = max; numIn.step = step; numIn.value = num;
    range.addEventListener('input', () => { numIn.value = range.value; setValue(v.name, range.value); });
    numIn.addEventListener('change', () => { range.value = numIn.value; setValue(v.name, numIn.value); });
    row.appendChild(range); row.appendChild(numIn);
    return wrap;
  }

  if (v.type === 'boolean') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = current === 'true';
    cb.addEventListener('change', () => setValue(v.name, String(cb.checked)));
    row.appendChild(cb);
    return wrap;
  }

  const text = document.createElement('input');
  text.type = 'text'; text.value = current;
  text.addEventListener('change', () => setValue(v.name, text.value));
  row.appendChild(text);
  return wrap;
}

function normalizeColorForPicker(c) {
  c = (c || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) {
    return '#' + [1,2,3].map(i => c[i] + c[i]).join('').toLowerCase();
  }
  return '#000000';
}

// ============================================================ value application
function setValue(name, val) {
  state.values[name] = val;
  if (state.svgEl) {
    const resolved = resolveDerived(state.values);
    for (const [k, v] of Object.entries(resolved)) {
      state.svgEl.style.setProperty(k, v);
    }
    refreshDerivedSwatches(resolved);
  }
  saveStoredValues(state.currentFile, state.values);
}

function applyAllValues() {
  if (!state.svgEl) return;
  const resolved = resolveDerived(state.values);
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

  // Drop any previously-mounted reference image
  const stale = host.querySelector('img.reference');
  if (stale) stale.remove();

  // Tag the host with the active mode for CSS targeting
  host.dataset.viewMode = state.viewMode;

  // Show / hide the SVG
  if (state.svgEl) {
    state.svgEl.style.display = state.viewMode === 'ref' ? 'none' : '';
  }

  // Mount the reference image when needed
  if ((state.viewMode === 'ref' || state.viewMode === 'compare') && state.currentRef) {
    const img = document.createElement('img');
    img.className = 'reference';
    img.src = state.currentRef;
    img.alt = 'Reference photo';
    host.appendChild(img);
  }

  // Update segmented control highlights + disabled state for files without a reference
  for (const btn of document.querySelectorAll('.view-btn')) {
    btn.classList.toggle('active', btn.dataset.view === state.viewMode);
    if (btn.dataset.view !== 'svg') {
      btn.disabled = !state.currentRef;
    }
  }
}

// ============================================================ derived colours (@ws mix=)
function isDerived(v) {
  return !!(v.hint?.raw && /\bmix=[\w-]+:-?\d*\.?\d+/.test(v.hint.raw));
}

function mixColor(baseHex, amount) {
  const [r, g, b] = hexToRgbTriple(baseHex);
  let r2, g2, b2;
  if (amount < 0) {
    const f = 1 + amount;
    r2 = r * f; g2 = g * f; b2 = b * f;
  } else {
    r2 = r + (255 - r) * amount;
    g2 = g + (255 - g) * amount;
    b2 = b + (255 - b) * amount;
  }
  const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
  return '#' + [r2, g2, b2].map(n => clamp(n).toString(16).padStart(2, '0')).join('');
}

function hexToRgbTriple(hex) {
  const h = hex.replace('#', '');
  const s = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function resolveDerived(values) {
  const out = { ...values };
  for (const v of state.variables) {
    const raw = v.hint?.raw;
    if (!raw) continue;
    const m = /\bmix=([\w-]+):(-?\d*\.?\d+)/.exec(raw);
    if (!m) continue;
    const baseValue = out['--' + m[1]];
    if (!baseValue || !/^#[0-9a-f]{3,8}$/i.test(baseValue.trim())) continue;
    out[v.name] = mixColor(baseValue.trim(), Number(m[2]));
  }
  return out;
}

function refreshDerivedSwatches(resolved) {
  for (const v of state.variables) {
    if (!isDerived(v)) continue;
    const el = document.querySelector(`[data-derived-swatch="${v.name}"]`);
    if (el) el.style.background = resolved[v.name] || v.rawValue;
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
