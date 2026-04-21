// Shared @ws parser for the SVG workshop.
//
// Both the static showcase viewer (workshop-viewer/) and the interactive
// editor (blackroom/) consume the same SVG source format: CSS custom
// properties inside :root { }, optionally annotated with a trailing
// /* @ws ... */ comment that upgrades the default control.  This module
// is the single parse+inference implementation both hosts import, so
// changes to the hint syntax or type inference only have to land here.
//
// Exports are pure — no DOM, no state, safe to use from any context.
// See CLAUDE.md for the format itself.

export const NAMED_COLORS = new Set([
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

// Walk every :root { } rule in cssText and return a list of variable
// descriptors: {name, rawValue, type, hint}. `hint` is null when the
// declaration had no /* @ws ... */ comment.
export function parseRootVars(cssText) {
  const out = [];
  const rootRe = /:root\s*\{([^}]*)\}/g;
  let m;
  while ((m = rootRe.exec(cssText))) {
    // Decl + optional inline hint comment in one match — splitting on
    // ';' would drop the hint.
    const declRe = /(--[\w-]+)\s*:\s*([^;]*?)\s*;[ \t]*(?:\/\*\s*@ws\s*([^*]*?)\s*\*\/)?/g;
    let d;
    while ((d = declRe.exec(m[1]))) {
      const name = d[1];
      const rawValue = d[2].trim();
      const hint = d[3] ? parseHint(d[3]) : null;
      // Hints like point2d / seed / ignore / mix are *markers* — they
      // don't override the inferred control type. An explicit type
      // token (number, select, color, text) does.
      const type = hint?.type && !['point2d','seed','ignore','mix'].includes(hint.type)
        ? hint.type
        : inferType(rawValue);
      out.push({ name, rawValue, type, hint });
    }
  }
  return out;
}

// Parse a hint body like "number min=5 max=50 step=1" or
// "point2d=light" or "select options=a,b,c".
export function parseHint(s) {
  const parts = s.trim().split(/\s+/);
  const first = parts.shift();
  const hint = { raw: s.trim() };
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

export function inferType(val) {
  const v = String(val).trim();
  if (/^#([0-9a-f]{3,8})$/i.test(v)) return 'color';
  if (/^rgba?\(/i.test(v) || /^hsla?\(/i.test(v)) return 'color';
  if (NAMED_COLORS.has(v.toLowerCase())) return 'color';
  if (/^-?\d+(\.\d+)?(px|deg|%|em|rem)?$/.test(v)) return 'number';
  if (v === 'true' || v === 'false') return 'boolean';
  return 'text';
}

// Split "42px" into {number: 42, unit: 'px'} so number controls can
// preserve the unit when the user drags the slider.
export function splitNumber(val) {
  const m = /^(-?\d+(?:\.\d+)?)(px|deg|%|em|rem)?$/.exec(String(val).trim());
  if (!m) return { number: Number(val) || 0, unit: '' };
  return { number: Number(m[1]), unit: m[2] || '' };
}

// Pick slider bounds. Explicit min/max/step in the hint win; otherwise
// fall back to a reasonable auto-range based on the current value.
export function parseRange(hint, current) {
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

// ---------- derived colours (@ws mix=base:amount) ----------

export function isDerived(v) {
  return !!(v.hint?.raw && /\bmix=[\w-]+:-?\d*\.?\d+/.test(v.hint.raw));
}

// Return a new {name: value} map where any variable with @ws mix=base:amount
// is replaced by the computed colour. Variables whose base isn't a hex
// colour fall through (the caller gets back the raw value).
export function resolveDerived(variables, values) {
  const out = { ...values };
  for (const v of variables) {
    const raw = v.hint?.raw;
    if (!raw) continue;
    const m = /\bmix=([\w-]+):(-?\d*\.?\d+)/.exec(raw);
    if (!m) continue;
    const baseValue = out['--' + m[1]];
    if (!baseValue || !/^#[0-9a-f]{3,8}$/i.test(String(baseValue).trim())) continue;
    out[v.name] = mixColor(String(baseValue).trim(), Number(m[2]));
  }
  return out;
}

// Mix a hex colour toward white (amount > 0) or black (amount < 0).
// amount range is [-1, 1]. 0 = identity.
export function mixColor(baseHex, amount) {
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

export function hexToRgbTriple(hex) {
  const h = hex.replace('#', '');
  const s = h.length === 3 ? h.split('').map(c => c + c).join('') : h.slice(0, 6);
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}
