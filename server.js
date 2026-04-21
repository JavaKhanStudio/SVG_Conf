#!/usr/bin/env node
// SVG Workshop server — static assets + file watcher + snapshot API + upload.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 5173;
const BACKEND_URL = process.env.SVGW_BACKEND || 'http://127.0.0.1:5174';
const folderArg = process.argv[2] || './';
const WATCH_DIR = path.resolve(process.cwd(), folderArg);
const WORKSHOP_DIR = path.join(WATCH_DIR, '.workshop');

// Reference variants (must match backend/preprocess.py VARIANT_ORDER).
const VARIANT_NAMES = new Set(['original', 'gray', 'otsu', 'adaptive', 'canny', 'bilateral', 'depth']);

function refsDir(svgName) {
  return path.join(WORKSHOP_DIR, `${svgName}.refs`);
}

if (!fs.existsSync(WATCH_DIR)) {
  console.error(`Folder does not exist: ${WATCH_DIR}`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}

function safeName(name) {
  // Only allow simple filenames, no traversal.
  if (typeof name !== 'string') return null;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return null;
  if (!/^[\w\-. ]+$/.test(name)) return null;
  return name;
}

async function listSvgs() {
  const entries = await fsp.readdir(WATCH_DIR, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && e.name.toLowerCase().endsWith('.svg'))
    .map(e => e.name)
    .sort();
}

async function serveStatic(res, filePath) {
  try {
    const data = await fsp.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  } catch {
    send(res, 404, 'Not found');
  }
}

async function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Minimal multipart parser — one file field, SVG content.
function parseMultipart(buf, boundary) {
  const boundaryBuf = Buffer.from('--' + boundary);
  const parts = [];
  let start = 0;
  while (true) {
    const i = buf.indexOf(boundaryBuf, start);
    if (i === -1) break;
    if (start !== 0) parts.push(buf.slice(start, i - 2)); // strip trailing \r\n
    start = i + boundaryBuf.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    start += 2; // skip \r\n
  }
  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const header = part.slice(0, headerEnd).toString();
    const body = part.slice(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/.exec(header);
    const fileMatch = /filename="([^"]+)"/.exec(header);
    if (fileMatch) {
      return { field: nameMatch?.[1], filename: fileMatch[1], data: body };
    }
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // Static frontend. The repo root holds the presentation site;
    // the Blackroom (photo→SVG tracer) lives under /blackroom/ and
    // the creative Studio at /studio.html. All three share gallery/
    // and src/. Serve any file under __dirname so the whole site
    // works transparently.
    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
      return serveStatic(res, path.join(__dirname, 'index.html'));
    }
    if (req.method === 'GET' && pathname === '/blackroom/') {
      return serveStatic(res, path.join(__dirname, 'blackroom/index.html'));
    }
    if (req.method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/files/') && !pathname.startsWith('/refs/') && !pathname.startsWith('/ws')) {
      const rel = pathname.slice(1);
      if (!rel || rel.includes('..')) return send(res, 400, 'Bad path');
      const full = path.join(__dirname, rel);
      if (!full.startsWith(__dirname)) return send(res, 400, 'Bad path');
      try {
        const stat = await fsp.stat(full);
        if (stat.isFile()) return serveStatic(res, full);
        if (stat.isDirectory()) {
          // Redirect /foo → /foo/ so relative asset links resolve,
          // then serve index.html if the folder has one.
          if (!pathname.endsWith('/')) {
            return send(res, 301, '', { Location: pathname + '/' });
          }
          const indexPath = path.join(full, 'index.html');
          try {
            const istat = await fsp.stat(indexPath);
            if (istat.isFile()) return serveStatic(res, indexPath);
          } catch { /* no index — fall through to 404 */ }
        }
      } catch { /* fall through to 404 below */ }
    }

    // Watched SVG files
    if (req.method === 'GET' && pathname.startsWith('/files/')) {
      const name = safeName(decodeURIComponent(pathname.slice('/files/'.length)));
      if (!name) return send(res, 400, 'Bad name');
      return serveStatic(res, path.join(WATCH_DIR, name));
    }

    // Snapshots GET
    if (req.method === 'GET' && pathname.startsWith('/api/snapshots/')) {
      const name = safeName(decodeURIComponent(pathname.slice('/api/snapshots/'.length)));
      if (!name) return send(res, 400, 'Bad name');
      const file = path.join(WORKSHOP_DIR, `${name}.snapshots.json`);
      try {
        const data = await fsp.readFile(file, 'utf8');
        return send(res, 200, data, { 'Content-Type': MIME['.json'] });
      } catch {
        return send(res, 200, '[]', { 'Content-Type': MIME['.json'] });
      }
    }

    // Snapshots POST
    if (req.method === 'POST' && pathname.startsWith('/api/snapshots/')) {
      const name = safeName(decodeURIComponent(pathname.slice('/api/snapshots/'.length)));
      if (!name) return send(res, 400, 'Bad name');
      const body = await readBody(req);
      let parsed;
      try { parsed = JSON.parse(body.toString('utf8')); }
      catch { return send(res, 400, 'Bad JSON'); }
      await fsp.mkdir(WORKSHOP_DIR, { recursive: true });
      const file = path.join(WORKSHOP_DIR, `${name}.snapshots.json`);
      await fsp.writeFile(file, JSON.stringify(parsed, null, 2), 'utf8');
      return send(res, 200, '{"ok":true}', { 'Content-Type': MIME['.json'] });
    }

    // Per-SVG metrics history.
    if (req.method === 'GET' && pathname.startsWith('/api/metrics/')) {
      const svgName = safeName(decodeURIComponent(pathname.slice('/api/metrics/'.length)));
      if (!svgName) return send(res, 400, 'Bad name');
      const file = path.join(WORKSHOP_DIR, `${svgName}.metrics.json`);
      try {
        const data = await fsp.readFile(file, 'utf8');
        return send(res, 200, data, { 'Content-Type': MIME['.json'] });
      } catch {
        return send(res, 200, '[]', { 'Content-Type': MIME['.json'] });
      }
    }

    // Trigger a measurement: candidate SVG vs the reference (default = the
    // dropped-photo's original.png from .workshop/<svg>.refs/). Optionally
    // override with ?ref=<absolute-path> in the query.
    if (req.method === 'POST' && pathname === '/api/measure') {
      const svgName = safeName(url.searchParams.get('for') || '');
      if (!svgName) return send(res, 400, 'Bad ?for=<svg>');
      const svgPath = path.join(WATCH_DIR, svgName);
      const refOverride = url.searchParams.get('ref');
      const refPath = refOverride
        ? path.resolve(refOverride)
        : path.join(refsDir(svgName), 'original.png');
      if (!fs.existsSync(refPath)) {
        return send(res, 400, JSON.stringify({ error: 'no reference', detail: `expected ${refPath}` }), { 'Content-Type': MIME['.json'] });
      }
      let body = {};
      try {
        const raw = await readBody(req, 10 * 1024);
        if (raw.length) body = JSON.parse(raw.toString('utf8'));
      } catch {}
      const payload = JSON.stringify({ svg_path: svgPath, ref_path: refPath, label: body.label || null });
      let backendRes;
      try {
        backendRes = await fetch(`${BACKEND_URL}/measure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
        });
      } catch (e) {
        return send(res, 502, JSON.stringify({ error: 'backend unreachable', detail: String(e) }), { 'Content-Type': MIME['.json'] });
      }
      const text = await backendRes.text();
      return send(res, backendRes.status, text, { 'Content-Type': MIME['.json'] });
    }

    // Reference variant images (preprocessed PNGs in .workshop/<svg>.refs/).
    if (req.method === 'GET' && pathname.startsWith('/refs/')) {
      const rest = pathname.slice('/refs/'.length).split('/');
      if (rest.length !== 2) return send(res, 400, 'Bad refs path');
      const svgName = safeName(decodeURIComponent(rest[0]));
      const variantFile = decodeURIComponent(rest[1]);
      if (!svgName) return send(res, 400, 'Bad svg name');
      const m = /^([a-z]+)\.png$/.exec(variantFile);
      if (!m || !VARIANT_NAMES.has(m[1])) return send(res, 400, 'Bad variant');
      return serveStatic(res, path.join(refsDir(svgName), variantFile));
    }

    // Preprocess a reference photo via the Python backend, save variants
    // into .workshop/<svg>.refs/. Multipart in (single 'image' field), JSON out.
    if (req.method === 'POST' && pathname === '/api/preprocess-ref') {
      const svgName = safeName(url.searchParams.get('for') || '');
      if (!svgName) return send(res, 400, 'Bad ?for=<svg>');

      const ctype = req.headers['content-type'] || '';
      const m = /boundary=(.+)$/.exec(ctype);
      if (!m) return send(res, 400, 'Expected multipart');
      const body = await readBody(req);
      const file = parseMultipart(body, m[1]);
      if (!file) return send(res, 400, 'No file');

      const outDir = refsDir(svgName);
      await fsp.mkdir(outDir, { recursive: true });

      // Forward to backend as a fresh multipart request.
      const fd = new FormData();
      fd.append('image', new Blob([file.data]), file.filename || 'image.bin');
      fd.append('out_dir', outDir);

      let backendRes;
      try {
        backendRes = await fetch(`${BACKEND_URL}/preprocess`, { method: 'POST', body: fd });
      } catch (e) {
        return send(res, 502, JSON.stringify({ error: 'backend unreachable', detail: String(e) }), { 'Content-Type': MIME['.json'] });
      }
      const text = await backendRes.text();
      return send(res, backendRes.status, text, { 'Content-Type': MIME['.json'] });
    }

    // Studio: list SVGs in studio-work/.
    if (req.method === 'GET' && pathname === '/api/studio/list') {
      const dir = path.join(__dirname, 'studio-work');
      try { await fsp.mkdir(dir, { recursive: true }); } catch {}
      let files = [];
      try {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        files = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.svg'))
                       .map(e => e.name).sort();
      } catch {}
      return send(res, 200, JSON.stringify({ ok: true, files }), { 'Content-Type': MIME['.json'] });
    }

    // Studio: save with _Vn versioning.
    // Body: { base: "banana", svg: "<svg...>" }
    // Writes studio-work/<base>_V<n+1>.svg where n = max existing _Vn for that base, or 0.
    if (req.method === 'POST' && pathname === '/api/studio/save') {
      const raw = await readBody(req, 50 * 1024 * 1024);
      let body;
      try { body = JSON.parse(raw.toString('utf8')); }
      catch { return send(res, 400, JSON.stringify({ error: 'bad json' }), { 'Content-Type': MIME['.json'] }); }
      const base = typeof body?.base === 'string' ? body.base.trim() : '';
      const svg = typeof body?.svg === 'string' ? body.svg : '';
      if (!base || !/^[\w\-. ]+$/.test(base)) {
        return send(res, 400, JSON.stringify({ error: 'bad base' }), { 'Content-Type': MIME['.json'] });
      }
      if (!svg.includes('<svg')) {
        return send(res, 400, JSON.stringify({ error: 'bad svg' }), { 'Content-Type': MIME['.json'] });
      }
      const dir = path.join(__dirname, 'studio-work');
      await fsp.mkdir(dir, { recursive: true });
      let entries = [];
      try { entries = await fsp.readdir(dir); } catch {}
      const re = new RegExp('^' + base.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') + '_V(\\d+)\\.svg$', 'i');
      let maxV = 0;
      for (const e of entries) {
        const m = re.exec(e);
        if (m) { const n = parseInt(m[1], 10); if (n > maxV) maxV = n; }
      }
      const nextV = maxV + 1;
      const file = `${base}_V${nextV}.svg`;
      await fsp.writeFile(path.join(dir, file), svg, 'utf8');
      return send(res, 200, JSON.stringify({ ok: true, file, version: nextV }), { 'Content-Type': MIME['.json'] });
    }

    // Upload
    if (req.method === 'POST' && pathname === '/api/upload') {
      const ctype = req.headers['content-type'] || '';
      const m = /boundary=(.+)$/.exec(ctype);
      if (!m) return send(res, 400, 'Expected multipart');
      const body = await readBody(req);
      const file = parseMultipart(body, m[1]);
      if (!file) return send(res, 400, 'No file');
      const name = safeName(path.basename(file.filename));
      if (!name || !name.toLowerCase().endsWith('.svg')) return send(res, 400, 'Must be .svg');
      await fsp.writeFile(path.join(WATCH_DIR, name), file.data);
      return send(res, 200, JSON.stringify({ ok: true, file: name }), { 'Content-Type': MIME['.json'] });
    }

    send(res, 404, 'Not found');
  } catch (err) {
    console.error(err);
    send(res, 500, 'Server error');
  }
});

// WebSocket
const wss = new WebSocketServer({ server });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

wss.on('connection', async ws => {
  try {
    const files = await listSvgs();
    ws.send(JSON.stringify({ type: 'list', files }));
  } catch (err) {
    console.error(err);
  }
});

// Watcher
const watcher = chokidar.watch(WATCH_DIR, {
  depth: 0,
  ignoreInitial: true,
  ignored: (p) => {
    const base = path.basename(p);
    if (base === '.workshop') return true;
    if (p.includes(`${path.sep}.workshop${path.sep}`)) return true;
    return false;
  },
});

watcher.on('change', async (p) => {
  const name = path.basename(p);
  if (!name.toLowerCase().endsWith('.svg')) return;
  broadcast({ type: 'change', file: name });
});
watcher.on('add', async () => {
  broadcast({ type: 'list', files: await listSvgs() });
});
watcher.on('unlink', async () => {
  broadcast({ type: 'list', files: await listSvgs() });
});

server.listen(PORT, () => {
  console.log(`SVG Workshop: http://localhost:${PORT}`);
  console.log(`Watching: ${WATCH_DIR}`);
});
