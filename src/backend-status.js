// Polls the Python backend's /health endpoint and toggles a top banner
// when the backend is unreachable. Backend powers the trace/measure/preprocess
// features; the workshop's core (load SVG, edit vars, snapshots) keeps
// working without it.

const BACKEND_URL = 'http://127.0.0.1:5174';
const POLL_INTERVAL_MS = 5000;

let banner = null;
let lastOk = null;

function ensureBanner() {
  if (banner) return banner;
  banner = document.createElement('div');
  banner.id = 'backend-status';
  banner.hidden = true;
  banner.innerHTML = `
    <span class="dot"></span>
    <span class="msg">Python backend offline — start it for trace/measure/preprocess features.</span>
    <code>./backend/start.sh</code>
    <span class="sep">or</span>
    <code>backend\\start.bat</code>
  `;
  document.body.prepend(banner);
  return banner;
}

async function poll() {
  let ok = false;
  try {
    const res = await fetch(`${BACKEND_URL}/health`, { cache: 'no-store' });
    ok = res.ok;
  } catch {
    ok = false;
  }
  if (ok !== lastOk) {
    ensureBanner().hidden = ok;
    document.body.classList.toggle('backend-down', !ok);
    lastOk = ok;
  }
}

poll();
setInterval(poll, POLL_INTERVAL_MS);

export const backendUrl = BACKEND_URL;
