// Shared control builder for the SVG workshop.
//
// Both the static showcase viewer and the interactive editor build the
// same family of controls from a variable descriptor: colour picker +
// text, number slider + number input (plus seed randomizer when the
// hint requests it), select dropdown, boolean checkbox, text input, or
// a read-only derived-colour swatch.
//
// Host-specific concerns stay out:
//   - point2d groups are coordinated by the host (blackroom has an
//     overlay + drag logic for them; the static viewer has none).
//   - state mutation, persistence, and re-render after change happen in
//     the host's setValue callback.
//
// This module is DOM-aware but framework-free.

import { splitNumber, parseRange } from './ws-parser.js';

// Build a control element for a single variable descriptor.
//
// opts:
//   getCurrentValue(name) → string           current value for this variable
//   setValue(name, value) → void             persist + apply change
//   isDerived(variable) → boolean            derived colour? (read-only swatch)
//   getDerivedColor(name) → string|null      resolved colour for a derived var
//   derivedLabel(variable) → string          caption under the swatch (e.g. "mix=base:-0.5")
export function buildControl(v, opts) {
  const wrap = document.createElement('div');
  wrap.className = 'ctrl';

  const label = document.createElement('label');
  label.textContent = v.name;
  wrap.appendChild(label);

  const row = document.createElement('div');
  row.className = 'row';
  wrap.appendChild(row);

  // Derived variables are read-only — showing an editor would lie about
  // what the user can change.
  if (opts.isDerived?.(v)) {
    const swatch = document.createElement('div');
    swatch.setAttribute('data-derived-swatch', v.name);
    const fill = opts.getDerivedColor?.(v.name) || v.rawValue;
    swatch.style.cssText = `width:36px;height:24px;border:1px solid #444;border-radius:3px;background:${fill}`;
    const info = document.createElement('span');
    info.style.cssText = 'font-size:10px;color:#88899a;margin-left:6px;font-family:ui-monospace,monospace;';
    info.textContent = '= ' + (opts.derivedLabel?.(v) || 'derived');
    row.appendChild(swatch);
    row.appendChild(info);
    return wrap;
  }

  const current = opts.getCurrentValue(v.name) ?? v.rawValue;
  const isSeed = v.hint?.type === 'seed';

  if (v.hint?.type === 'select') {
    const sel = document.createElement('select');
    for (const opt of v.hint.options || []) {
      const o = document.createElement('option');
      o.value = opt; o.textContent = opt;
      if (opt === current) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => opts.setValue(v.name, sel.value));
    row.appendChild(sel);
    return wrap;
  }

  if (v.type === 'color') {
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.value = normalizeColorForPicker(current);
    picker.addEventListener('input', () => opts.setValue(v.name, picker.value));
    const text = document.createElement('input');
    text.type = 'text';
    text.value = current;
    text.addEventListener('change', () => {
      opts.setValue(v.name, text.value);
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
      opts.setValue(v.name, unit ? `${val}${unit}` : `${val}`);
    };
    slider.addEventListener('input', () => { num.value = slider.value; commit(slider.value); });
    num.addEventListener('input', () => { slider.value = num.value; commit(num.value); });

    // Seed controls skip the slider (a range is meaningless for a random seed)
    // and gain a 🎲 button.
    if (!isSeed) row.appendChild(slider);
    row.appendChild(num);

    if (isSeed) {
      const btn = document.createElement('button');
      btn.textContent = '🎲';
      btn.title = 'Randomize';
      btn.addEventListener('click', () => {
        const r = Math.floor(Math.random() * 1_000_000);
        num.value = r;
        commit(r);
      });
      row.appendChild(btn);
    }
    return wrap;
  }

  if (v.type === 'boolean') {
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = current === 'true';
    cb.addEventListener('change', () => opts.setValue(v.name, String(cb.checked)));
    row.appendChild(cb);
    return wrap;
  }

  // text (fallback)
  const text = document.createElement('input');
  text.type = 'text';
  text.value = current;
  text.addEventListener('change', () => opts.setValue(v.name, text.value));
  row.appendChild(text);
  return wrap;
}

// Coerce any CSS colour into the #rrggbb form <input type="color">
// requires. Falls back to rendering the string via a detached element
// for named colours and rgb()/hsl() notation.
export function normalizeColorForPicker(val) {
  if (typeof val !== 'string') return '#000000';
  const v = val.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return '#' + [1,2,3].map(i => v[i] + v[i]).join('').toLowerCase();
  }
  try {
    const d = document.createElement('div');
    d.style.color = v;
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

// Refresh every derived-colour swatch in the DOM after a base colour changed.
export function refreshDerivedSwatches(variables, resolved, isDerivedFn) {
  for (const v of variables) {
    if (!isDerivedFn(v)) continue;
    const el = document.querySelector(`[data-derived-swatch="${v.name}"]`);
    if (el) el.style.background = resolved[v.name] || v.rawValue;
  }
}

// Convenience for the caller to render a terse "= mix=orange:-0.55" label
// under a derived swatch.
export function mixLabel(v) {
  return v.hint?.raw?.match(/mix=[\w-]+:-?\d*\.?\d+/)?.[0] || 'derived';
}
