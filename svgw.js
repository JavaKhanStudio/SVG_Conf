#!/usr/bin/env node
// svgw — single CLI entry point for SVG Workshop backend operations.
// Wraps HTTP calls to the Python backend so agent workflows can use
// natural Bash commands. More subcommands land as later phases ship.

import fs from 'node:fs';
import path from 'node:path';

const BACKEND_URL = process.env.SVGW_BACKEND || 'http://127.0.0.1:5174';

const COMMANDS = {
  health: cmdHealth,
  preprocess: cmdPreprocess,
  trace: cmdTrace,
  measure: cmdMeasure,
  colors: cmdColors,
};

async function main() {
  const [, , cmd, ...args] = process.argv;
  if (!cmd || cmd === '-h' || cmd === '--help') {
    printUsage();
    process.exit(0);
  }
  const handler = COMMANDS[cmd];
  if (!handler) {
    console.error(`Unknown command: ${cmd}`);
    printUsage();
    process.exit(2);
  }
  try {
    await handler(args);
  } catch (err) {
    console.error(`svgw ${cmd}: ${err.message}`);
    process.exit(1);
  }
}

function printUsage() {
  console.log(`svgw — SVG Workshop backend CLI

Usage:
  svgw health [--json]
  svgw preprocess <photo> --for <svg-path> [--json]
  svgw trace --src <png> --into <svg-path>
             [--speckle N] [--mode spline|polygon|none] [--json]
  svgw measure <svg-path> [--ref <photo>] [--label "..."] [--json]
                          [--pass subject_bbox|per_region_density|symmetry] (repeatable)
                          [--all-passes]
  svgw colors <svg-path> [--ref <photo>] [--json]

Commands:
  health           Ping the Python backend and report status.
  preprocess       Upload a photo, generate all reference variants into
                   <svg-path>'s sibling .workshop/<basename>.refs/.
  trace            Vector-trace a preprocessed PNG (typically a canny or
                   otsu variant) and inject the result into <svg-path> as
                   <g id="trace-ref" display="none">. Re-running replaces
                   the existing trace-ref group.
  measure          Score the SVG against a reference photo. Returns
                   outline_iou (strict 1-to-1), pixel_iou (loose), and
                   edge_ssim. History appended to .workshop/<svg>.metrics.json.
                   Optional --pass adds focused diagnostics (proportion
                   mismatch, per-region detail, symmetry). --all-passes
                   runs every known pass.
  colors           For every named (id or class) <path> in the SVG,
                   suggest a flat fill color sampled from the reference.
                   Output is suggestions only — backend never edits the SVG.

Backend URL is taken from $SVGW_BACKEND (default: ${BACKEND_URL}).`);
}

function parseFlags(args) {
  const flags = { json: false, positional: [], named: {}, repeated: {} };
  const REPEATABLE = new Set(['pass']);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') flags.json = true;
    else if (a.startsWith('--')) {
      const key = a.slice(2);
      if (REPEATABLE.has(key)) {
        (flags.repeated[key] = flags.repeated[key] || []).push(args[++i]);
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags.named[key] = args[++i];
      } else {
        flags.named[key] = true;  // bare flag like --all-passes
      }
    }
    else flags.positional.push(a);
  }
  return flags;
}

const ALL_PASSES = ['subject_bbox', 'per_region_density', 'symmetry'];

async function cmdHealth(args) {
  const flags = parseFlags(args);
  let body, ok = false, status = 0, err;
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { cache: 'no-store' });
    status = res.status;
    ok = res.ok;
    body = await res.json();
  } catch (e) {
    err = e.message;
  }

  if (flags.json) {
    console.log(JSON.stringify({ url: BACKEND_URL, ok, status, body, err }, null, 2));
  } else if (ok) {
    console.log(`OK  ${BACKEND_URL}  v${body.version}  capabilities: [${(body.capabilities || []).join(', ')}]`);
  } else {
    console.log(`DOWN  ${BACKEND_URL}  ${err || `HTTP ${status}`}`);
  }
  process.exit(ok ? 0 : 1);
}

async function cmdPreprocess(args) {
  const flags = parseFlags(args);
  const [photo] = flags.positional;
  const forSvg = flags.named.for;
  if (!photo || !forSvg) {
    console.error('Usage: svgw preprocess <photo> --for <svg-path>');
    process.exit(2);
  }
  if (!fs.existsSync(photo)) {
    console.error(`Photo not found: ${photo}`);
    process.exit(1);
  }
  // out_dir = <dir-of-svg>/.workshop/<basename-of-svg>.refs/
  const svgPath = path.resolve(forSvg);
  const outDir = path.join(path.dirname(svgPath), '.workshop', `${path.basename(svgPath)}.refs`);
  fs.mkdirSync(outDir, { recursive: true });

  const photoBytes = fs.readFileSync(photo);
  const fd = new FormData();
  fd.append('image', new Blob([photoBytes]), path.basename(photo));
  fd.append('out_dir', outDir);

  let res;
  try {
    res = await fetch(`${BACKEND_URL}/preprocess`, { method: 'POST', body: fd });
  } catch (e) {
    console.error(`Backend unreachable at ${BACKEND_URL}: ${e.message}`);
    process.exit(1);
  }
  const text = await res.text();
  if (!res.ok) {
    console.error(`Backend error ${res.status}: ${text}`);
    process.exit(1);
  }
  const payload = JSON.parse(text);

  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(`Wrote ${payload.variants.length} variants → ${payload.out_dir}`);
  for (const v of payload.variants) {
    const kb = (v.bytes / 1024).toFixed(1);
    console.log(`  ${v.name.padEnd(10)} ${v.width}x${v.height}  ${kb} KB  (${v.description})`);
  }
}

async function cmdTrace(args) {
  const flags = parseFlags(args);
  const src = flags.named.src;
  const into = flags.named.into;
  if (!src || !into) {
    console.error('Usage: svgw trace --src <png> --into <svg-path> [--speckle N] [--mode spline|polygon|none]');
    process.exit(2);
  }

  const srcAbs = path.resolve(src);
  const intoAbs = path.resolve(into);
  if (!fs.existsSync(srcAbs)) { console.error(`Source PNG not found: ${srcAbs}`); process.exit(1); }
  if (!fs.existsSync(intoAbs)) { console.error(`Target SVG not found: ${intoAbs}`); process.exit(1); }

  const body = { src_path: srcAbs };
  if (flags.named.speckle != null) {
    body.filter_speckle = Number(flags.named.speckle);
  } else if (/[\\/]canny\.png$/i.test(srcAbs)) {
    // Canny edges are 1-2px hairlines; the backend default of 8 wipes them out.
    // Drop to 2 so we keep the detail. Adaptive thresholds get the same treatment.
    body.filter_speckle = 2;
  } else if (/[\\/]adaptive\.png$/i.test(srcAbs)) {
    body.filter_speckle = 4;
  }
  if (flags.named.mode) body.mode = flags.named.mode;

  let res;
  try {
    res = await fetch(`${BACKEND_URL}/trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error(`Backend unreachable at ${BACKEND_URL}: ${e.message}`);
    process.exit(1);
  }
  const text = await res.text();
  if (!res.ok) { console.error(`Backend error ${res.status}: ${text}`); process.exit(1); }
  const payload = JSON.parse(text);

  // Inject into the target SVG. Replace existing #trace-ref if present,
  // else insert as the last child of the root <svg>.
  let svgText = fs.readFileSync(intoAbs, 'utf8');

  // Compute a scale transform so the trace fits the target's viewBox.
  // Trace coords come from the source photo (e.g. 2903x2045); the target
  // SVG is usually authored at a much smaller viewBox.
  const targetVbMatch = svgText.match(/<svg\b[^>]*\bviewBox="([^"]+)"/);
  let transform = '';
  if (targetVbMatch && payload.viewBox) {
    const [, , tw, th] = payload.viewBox.split(/\s+/).map(Number);
    const targetVb = targetVbMatch[1].split(/\s+/).map(Number);
    const vw = targetVb[2], vh = targetVb[3];
    if (tw && th && vw && vh) {
      const sx = +(vw / tw).toFixed(6);
      const sy = +(vh / th).toFixed(6);
      transform = ` transform="scale(${sx} ${sy})"`;
    }
  }

  // Style block scoped to #trace-ref so the strokes look like a hairline
  // alignment reference, not a black silhouette. !important overrides the
  // per-path fill="#000000" that vtracer emits.
  const styleRule = '#trace-ref path { fill: none !important; stroke: #ff00ff; stroke-width: 0.5; vector-effect: non-scaling-stroke; opacity: 0.85; }';
  const indent = '  ';
  const newGroup =
    `${indent}<g id="trace-ref" display="none"${transform}>\n` +
    `${indent}  <style>${styleRule}</style>\n` +
    `${indent}  ${payload.paths_xml.replace(/\n/g, '\n' + indent + '  ')}\n` +
    `${indent}</g>\n`;

  const traceRefRe = /[ \t]*<g\s+id="trace-ref"[^>]*>[\s\S]*?<\/g>\n?/;
  if (traceRefRe.test(svgText)) {
    svgText = svgText.replace(traceRefRe, newGroup);
  } else {
    svgText = svgText.replace(/<\/svg>\s*$/, newGroup + '</svg>\n');
  }

  fs.writeFileSync(intoAbs, svgText, 'utf8');

  if (flags.json) {
    console.log(JSON.stringify({ ok: true, into: intoAbs, ...payload.stats, viewBox: payload.viewBox, transform: transform || null }, null, 2));
  } else {
    console.log(`Injected trace-ref into ${into}`);
    console.log(`  source viewBox: ${payload.viewBox}`);
    if (transform) console.log(`  scale${transform.replace(' transform=', ': ')}`);
    console.log(`  paths: ${payload.stats.paths}, bytes: ${payload.stats.bytes}`);
  }
}

function findDefaultRef(svgPath) {
  // Auto-discovery: look for sources/<basename-without-ext>.{jpg,png,jpeg,webp}
  // relative to the project root (parent of the svg's directory).
  const stem = path.basename(svgPath, path.extname(svgPath));
  const candidates = [
    path.join(path.dirname(svgPath), '..', 'sources', `${stem}.jpg`),
    path.join(path.dirname(svgPath), '..', 'sources', `${stem}.jpeg`),
    path.join(path.dirname(svgPath), '..', 'sources', `${stem}.png`),
    path.join(path.dirname(svgPath), '..', 'sources', `${stem}.webp`),
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
}

async function cmdMeasure(args) {
  const flags = parseFlags(args);
  const [svgArg] = flags.positional;
  if (!svgArg) {
    console.error('Usage: svgw measure <svg-path> [--ref <photo>] [--label "..."]');
    process.exit(2);
  }
  const svgPath = path.resolve(svgArg);
  if (!fs.existsSync(svgPath)) { console.error(`SVG not found: ${svgPath}`); process.exit(1); }

  let refPath = flags.named.ref;
  if (!refPath) {
    const auto = findDefaultRef(svgPath);
    if (!auto) {
      console.error(`No --ref given and no sibling photo found in sources/ for ${path.basename(svgPath)}`);
      process.exit(1);
    }
    refPath = auto;
  }
  refPath = path.resolve(refPath);
  if (!fs.existsSync(refPath)) { console.error(`Reference not found: ${refPath}`); process.exit(1); }

  const body = { svg_path: svgPath, ref_path: refPath };
  if (flags.named.label) body.label = flags.named.label;
  if (flags.named['all-passes']) body.passes = ALL_PASSES.slice();
  else if (flags.repeated.pass?.length) body.passes = flags.repeated.pass;

  let res;
  try {
    res = await fetch(`${BACKEND_URL}/measure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error(`Backend unreachable at ${BACKEND_URL}: ${e.message}`);
    process.exit(1);
  }
  const text = await res.text();
  if (!res.ok) { console.error(`Backend error ${res.status}: ${text}`); process.exit(1); }
  const payload = JSON.parse(text);

  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const fmt = (n) => {
    const s = n.toFixed(4);
    if (n >= 0.85) return `\x1b[32m${s}\x1b[0m`; // green
    if (n >= 0.65) return `\x1b[33m${s}\x1b[0m`; // yellow
    return `\x1b[31m${s}\x1b[0m`;                // red
  };
  console.log(`measured ${path.relative(process.cwd(), svgPath)} vs ${path.relative(process.cwd(), refPath)}`);
  console.log(`  outline_iou: ${fmt(payload.outline_iou)}   (strict 1-to-1)`);
  console.log(`  pixel_iou:   ${fmt(payload.pixel_iou)}   (loose silhouette)`);
  console.log(`  edge_ssim:   ${fmt(payload.edge_ssim)}   (edge layout)`);
  console.log(`  target:      ${payload.target_size[0]}x${payload.target_size[1]}`);
  console.log(`  history:     ${path.relative(process.cwd(), payload.history_path)}`);

  if (payload.passes) {
    for (const [name, result] of Object.entries(payload.passes)) {
      console.log(`\n  [pass: ${name}]`);
      if (!result.ok) { console.log(`    skipped: ${result.reason || result.error || 'unknown'}`); continue; }
      if (name === 'subject_bbox') {
        console.log(`    ref bbox  : ${result.ref_bbox.w}x${result.ref_bbox.h} (aspect h/w ${result.ref_bbox.aspect_h_over_w})`);
        console.log(`    your bbox : ${result.cand_bbox.w}x${result.cand_bbox.h} (aspect h/w ${result.cand_bbox.aspect_h_over_w})`);
        console.log(`    width  ratio yours/ref: ${result.width_ratio_yours_over_ref}`);
        console.log(`    height ratio yours/ref: ${result.height_ratio_yours_over_ref}`);
        const off = result.aspect_ratio_off_pct;
        const offColor = off > 25 ? '\x1b[31m' : off > 15 ? '\x1b[33m' : '\x1b[32m';
        console.log(`    aspect off: ${offColor}${off}%\x1b[0m   centroid drift: ${result.centroid_drift_px}px`);
      } else if (name === 'per_region_density') {
        const regions = Object.entries(result.regions);
        regions.sort((a, b) => Math.abs(Math.log((a[1].ratio_yours_over_ref || 1) || 1)) - Math.abs(Math.log((b[1].ratio_yours_over_ref || 1) || 1)));
        regions.reverse();
        for (const [r, info] of regions) {
          const ratio = info.ratio_yours_over_ref;
          const r2 = ratio == null ? 'n/a' : ratio.toFixed(2);
          const tag = ratio == null ? '' : (ratio < 0.3 ? '\x1b[31m UNDER-DETAILED\x1b[0m' : ratio > 3 ? '\x1b[31m OVER-DRAWN\x1b[0m' : ratio < 0.5 || ratio > 2 ? '\x1b[33m off\x1b[0m' : '\x1b[32m ok\x1b[0m');
          console.log(`    .${r.padEnd(18)} ratio yours/ref: ${r2.padStart(5)}${tag}`);
        }
      } else if (name === 'symmetry') {
        const s = result.ssim;
        const c = s >= 0.85 ? '\x1b[32m' : s >= 0.7 ? '\x1b[33m' : '\x1b[31m';
        console.log(`    mirror SSIM: ${c}${s}\x1b[0m`);
      }
      if (result._hint) console.log(`    hint: ${result._hint}`);
    }
  }
}

async function cmdColors(args) {
  const flags = parseFlags(args);
  const [svgArg] = flags.positional;
  if (!svgArg) {
    console.error('Usage: svgw colors <svg-path> [--ref <photo>]');
    process.exit(2);
  }
  const svgPath = path.resolve(svgArg);
  if (!fs.existsSync(svgPath)) { console.error(`SVG not found: ${svgPath}`); process.exit(1); }

  let refPath = flags.named.ref;
  if (!refPath) {
    const auto = findDefaultRef(svgPath);
    if (!auto) {
      console.error(`No --ref given and no sibling photo found in sources/ for ${path.basename(svgPath)}`);
      process.exit(1);
    }
    refPath = auto;
  }
  refPath = path.resolve(refPath);
  if (!fs.existsSync(refPath)) { console.error(`Reference not found: ${refPath}`); process.exit(1); }

  let res;
  try {
    res = await fetch(`${BACKEND_URL}/sample-colors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ svg_path: svgPath, ref_path: refPath }),
    });
  } catch (e) {
    console.error(`Backend unreachable at ${BACKEND_URL}: ${e.message}`);
    process.exit(1);
  }
  const text = await res.text();
  if (!res.ok) { console.error(`Backend error ${res.status}: ${text}`); process.exit(1); }
  const payload = JSON.parse(text);

  if (flags.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (!payload.suggestions.length) {
    console.log(`No named paths found in ${path.relative(process.cwd(), svgPath)}.`);
    console.log(`Tip: add id="..." or class="..." to <path> elements you want to color.`);
    return;
  }
  console.log(`Color suggestions for ${path.relative(process.cwd(), svgPath)} from ${path.relative(process.cwd(), refPath)}:`);
  for (const s of payload.suggestions) {
    const kind = s.region_kind === 'id' ? '#' : '.';
    const conf = (s.confidence * 100).toFixed(0).padStart(3) + '%';
    console.log(`  ${kind}${s.region.padEnd(16)} ${s.color}   conf ${conf}   (${s.pixels_sampled} px)`);
  }
  console.log(`\nTo apply: edit the --<region>-color CSS variables in the SVG, or set them via the workshop.`);
}

main();
