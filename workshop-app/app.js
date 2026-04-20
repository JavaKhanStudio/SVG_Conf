// SVG Workshop frontend
// Single-file app. No framework, no build step.

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

// Parse :root { } declarations with optional trailing @ws hint comment.
// Hints live AFTER the semicolon on the same line, e.g.
//   --pupil-size: 20;  /* @ws number min=5 max=50 */
// so we match the whole declaration in one shot rather than splitting on ';'.
function parseRootVars(cssText) {
  const out = [];
  const rootRe = /:root\s*\{([^}]*)\}/g;
  let m;
  while ((m = rootRe.exec(cssText))) {
    const body = m[1];
    const declRe = /(--[\w-]+)\s*:\s*([^;]*?)\s*;[ \t]*(?:\/\*\s*@ws\s*([^*]*?)\s*\*\/)?/g;
    let d;
    while ((d = declRe.exec(body))) {
      const name = d[1];
      const rawValue = d[2].trim();
      const hintRaw = d[3];
      const hint = hintRaw ? parseHint(hintRaw) : null;
      const type = hint?.type && hint.type !== 'point2d' && hint.type !== 'seed' && hint.type !== 'ignore'
        ? hint.type
        : inferType(rawValue);
      out.push({ name, rawValue, type, hint });
    }
  }
  return out;
}

function parseHint(s) {
  // e.g. "number min=5 max=50 step=1"  or "point2d=light"  or "select options=a,b,c"
  const parts = s.trim().split(/\s+/);
  const first = parts.shift();
  const hint = { raw: s.trim() };
  // Type token may be "point2d=light" or "number"
  if (first.includes('=')) {
    const [k, v] = first.split('=');
    hint.type = k;
    hint.group = v;
  } else {
    hint.type = first;
  }
  for (const p of parts) {
    const [k, v] = p.split('=');
    if (v === undefined) continue;
    if (k === 'options') hint.options = v.split(',');
    else hint[k] = isNaN(Number(v)) ? v : Number(v);
  }
  return hint;
}

function inferType(val) {
  const v = val.trim();
  if (/^#([0-9a-f]{3,8})$/i.test(v)) return 'color';
  if (/^rgba?\(/i.test(v) || /^hsla?\(/i.test(v)) return 'color';
  if (NAMED_COLORS.has(v.toLowerCase())) return 'color';
  if (/^-?\d+(\.\d+)?(px|deg|%|em|rem)?$/.test(v)) return 'number';
  if (v === 'true' || v === 'false') return 'boolean';
  return 'text';
}

const NAMED_COLORS = new Set([
  'aliceblue','antiquewhite','aqua','aquamarine','azure','beige','bisque','black','blanchedalmond','blue',
  'blueviolet','brown','burlywood','cadetblue','chartreuse','chocolate','coral','cornflowerblue','cornsilk',
  'crimson','cyan','darkblue','darkcyan','darkgoldenrod','darkgray','darkgreen','darkkhaki','darkmagenta',
  'darkolivegreen','darkorange','darkorchid','darkred','darksalmon','darkseagreen','darkslateblue','darkslategray',
  'darkturquoise','darkviolet','deeppink','deepskyblue','dimgray','dodgerblue','firebrick','floralwhite','forestgreen',
  'fuchsia','gainsboro','ghostwhite','gold','goldenrod','gray','green','greenyellow','honeydew','hotpink','indianred',
  'indigo','ivory','khaki','lavender','lavenderblush','lawngreen','lemonchiffon','lightblue','lightcoral','lightcyan',
  'lightgoldenrodyellow','lightgray','lightgreen','lightpink','lightsalmon','lightseagreen','lightskyblue',
  'lightslategray','lightsteelblue','lightyellow','lime','limegreen','linen','magenta','maroon','mediumaquamarine',
  'mediumblue','mediumorchid','mediumpurple','mediumseagreen','mediumslateblue','mediumspringgreen','mediumturquoise',
  'mediumvioletred','midnightblue','mintcream','mistyrose','moccasin','navajowhite','navy','oldlace','olive','olivedrab',
  'orange','orangered','orchid','palegoldenrod','palegreen','paleturquoise','palevioletred','papayawhip','peachpuff',
  'peru','pink','plum','powderblue','purple','rebeccapurple','red','rosybrown','royalblue','saddlebrown','salmon',
  'sandybrown','seagreen','seashell','sienna','silver','skyblue','slateblue','slategray','snow','springgreen',
  'steelblue','tan','teal','thistle','tomato','turquoise','violet','wheat','white','whitesmoke','yellow','yellowgreen',
  'transparent'
]);

// ---------- Controls rendering ----------
function renderControls() {
  const root = $('#controls');
  root.innerHTML = '';
  const handled = new Set();

  // Render point2d groups first
  for (const g of state.point2dGroups) {
    handled.add(g.xVar.name);
    handled.add(g.yVar.name);
    root.appendChild(buildPoint2dControl(g));
  }

  for (const v of state.variables) {
    if (handled.has(v.name)) continue;
    root.appendChild(buildControl(v));
  }
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

  // Derived variables get a read-only swatch instead of an editor so the
  // workshop doesn't pretend the user can set them directly.
  if (isDerived(v)) {
    const resolved = resolveDerived(state.values);
    const swatch = document.createElement('div');
    swatch.setAttribute('data-derived-swatch', v.name);
    swatch.style.cssText = 'width: 36px; height: 24px; border: 1px solid #444; border-radius: 3px; background: ' + (resolved[v.name] || v.rawValue);
    const info = document.createElement('span');
    info.style.cssText = 'font-size: 10px; color: #88899a; margin-left: 6px; font-family: ui-monospace, monospace;';
    info.textContent = '= ' + (v.hint.raw.match(/mix=[\w-]+:-?\d*\.?\d+/)?.[0] || 'derived');
    row.appendChild(swatch);
    row.appendChild(info);
    return wrap;
  }

  const current = state.values[v.name] ?? v.rawValue;

  const isSeed = v.hint?.type === 'seed';

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
    text.type = 'text';
    text.value = current;
    text.addEventListener('change', () => {
      setValue(v.name, text.value);
      picker.value = normalizeColorForPicker(text.value);
    });
    row.appendChild(picker);
    row.appendChild(text);
    return wrap;
  }

  if (v.type === 'number' || isSeed) {
    const { number: num0, unit } = splitNumber(current);
    const range = parseRange(v.hint, num0);
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = range.min; slider.max = range.max; slider.step = range.step;
    slider.value = num0;
    const num = document.createElement('input');
    num.type = 'number';
    num.min = range.min; num.max = range.max; num.step = range.step;
    num.value = num0;

    const commit = (val) => {
      const v2 = unit ? `${val}${unit}` : `${val}`;
      setValue(v.name, v2);
    };
    slider.addEventListener('input', () => { num.value = slider.value; commit(slider.value); });
    num.addEventListener('input', () => { slider.value = num.value; commit(num.value); });

    if (!isSeed) row.appendChild(slider);
    row.appendChild(num);

    if (isSeed) {
      const btn = document.createElement('button');
      btn.textContent = '🎲';
      btn.title = 'Randomize';
      btn.addEventListener('click', () => {
        const r = Math.floor(Math.random() * 1_000_000);
        num.value = r; commit(r);
      });
      row.appendChild(btn);
    }
    return wrap;
  }

  if (v.type === 'boolean') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = current === 'true';
    cb.addEventListener('change', () => setValue(v.name, cb.checked ? 'true' : 'false'));
    row.appendChild(cb);
    return wrap;
  }

  // text
  const text = document.createElement('input');
  text.type = 'text';
  text.value = current;
  text.addEventListener('change', () => setValue(v.name, text.value));
  row.appendChild(text);
  return wrap;
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

function parseRange(hint, current) {
  if (hint && hint.min !== undefined && hint.max !== undefined) {
    return {
      min: Number(hint.min),
      max: Number(hint.max),
      step: Number(hint.step ?? 1),
    };
  }
  const n = Number(current);
  if (!isFinite(n)) return { min: 0, max: 100, step: 1 };
  if (n >= 0 && n <= 100) return { min: 0, max: 100, step: n < 2 ? 0.01 : 1 };
  const max = Math.max(1, Math.round(n * 2));
  return { min: 0, max, step: n < 2 ? 0.01 : 1 };
}

function splitNumber(val) {
  const m = /^(-?\d+(?:\.\d+)?)(px|deg|%|em|rem)?$/.exec(String(val).trim());
  if (!m) return { number: Number(val) || 0, unit: '' };
  return { number: Number(m[1]), unit: m[2] || '' };
}

function normalizeColorForPicker(val) {
  if (typeof val !== 'string') return '#000000';
  if (/^#[0-9a-f]{6}$/i.test(val)) return val;
  if (/^#[0-9a-f]{3}$/i.test(val)) {
    return '#' + val.slice(1).split('').map(c => c + c).join('');
  }
  // Try using a temp element
  try {
    const d = document.createElement('div');
    d.style.color = val;
    document.body.appendChild(d);
    const cs = getComputedStyle(d).color;
    document.body.removeChild(d);
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)/.exec(cs);
    if (m) {
      return '#' + [1,2,3].map(i => Number(m[i]).toString(16).padStart(2,'0')).join('');
    }
  } catch {}
  return '#000000';
}

// ---------- Applying values ----------
function setValue(name, val) {
  state.values[name] = val;
  // Resolve derived colours and push everything to the rendered SVG so
  // that editing a base colour immediately propagates to its shades.
  if (state.svgEl) {
    const resolved = resolveDerived(state.values);
    for (const [k, v] of Object.entries(resolved)) {
      state.svgEl.style.setProperty(k, v);
    }
    // Update any derived-colour swatches in the control panel.
    refreshDerivedSwatches(resolved);
  }
  saveStoredValues(state.currentFile, state.values);
  for (const g of state.point2dGroups) {
    if (g.xVar.name === name || g.yVar.name === name) {
      positionPointDot(g);
      break;
    }
  }
}

function refreshDerivedSwatches(resolved) {
  for (const v of state.variables) {
    if (!isDerived(v)) continue;
    const el = document.querySelector(`[data-derived-swatch="${v.name}"]`);
    if (el) el.style.background = resolved[v.name] || v.rawValue;
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
  const resolved = resolveDerived(state.values);
  for (const [k, v] of Object.entries(resolved)) {
    state.svgEl.style.setProperty(k, v);
  }
}

// ---------- Derived (linked) colours ----------
// Hint syntax: `/* @ws mix=<base-var-short-name>:<amount> */` on a colour
// variable.  amount ∈ [-1, 1]: negative darkens (mix toward black),
// positive lightens (mix toward white), 0 = base unchanged.
//
// Example:
//   --fur-tan: #cb9464;
//   --fur-brown: #55371a;   /* @ws mix=fur-tan:-0.4 */
//
// When the user tweaks --fur-tan in the workshop, --fur-brown is recomputed
// as `mix(#cb9464, -0.4)` and applied as an inline style.  Because the
// workshop resolves the derived value to a literal colour before applying,
// the SVG still rasterises correctly in resvg (which doesn't understand
// CSS color-mix()).
function mixColor(baseHex, amount) {
  const [r, g, b] = hexToRgbTriple(baseHex);
  let r2, g2, b2;
  if (amount < 0) {
    const f = 1 + amount;                // -0.4 → 0.6
    r2 = r * f; g2 = g * f; b2 = b * f;
  } else {
    const f = amount;                    // 0.4 → 0.4
    r2 = r + (255 - r) * f;
    g2 = g + (255 - g) * f;
    b2 = b + (255 - b) * f;
  }
  const clamp = n => Math.max(0, Math.min(255, Math.round(n)));
  return '#' + [r2, g2, b2].map(n => clamp(n).toString(16).padStart(2, '0')).join('');
}

function hexToRgbTriple(hex) {
  const h = hex.replace('#', '');
  const s = h.length === 3
    ? h.split('').map(c => c + c).join('')
    : h.slice(0, 6);
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function resolveDerived(values) {
  // Pass-through all non-derived values; replace derived ones with the
  // computed mix.  A derived var that points at an unknown or
  // non-colour base falls back to its rawValue.
  const out = { ...values };
  for (const v of state.variables) {
    if (v.hint?.type === 'mix') continue;  // safety
    if (!v.hint?.mix) continue;
    // hint.mix is the raw "base:amount" string from parseHint's remainder,
    // so we parse it here instead of in parseHint.
  }
  // Walk state.variables, looking at hint.raw for "mix=base:amount"
  for (const v of state.variables) {
    const raw = v.hint?.raw;
    if (!raw) continue;
    const m = /\bmix=([\w-]+):(-?\d*\.?\d+)/.exec(raw);
    if (!m) continue;
    const baseShort = m[1];
    const amount = Number(m[2]);
    const baseFullName = '--' + baseShort;
    const baseValue = out[baseFullName];
    if (!baseValue || !/^#[0-9a-f]{3,8}$/i.test(baseValue.trim())) continue;
    out[v.name] = mixColor(baseValue.trim(), amount);
  }
  return out;
}

function isDerived(v) {
  return !!(v.hint?.raw && /\bmix=[\w-]+:-?\d*\.?\d+/.test(v.hint.raw));
}

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
