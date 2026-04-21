// Studio entrypoint. Owns load / save / folder listing; delegates all
// editing UI to editor.js.

import { init as initEditor, setSvg, getSvg, onChange } from './editor.js';

const STUDIO_FOLDER = 'studio-work';
const BLANK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <rect x="20" y="20" width="160" height="160" rx="18" fill="#4a90e2"/>
  <circle cx="100" cy="100" r="40" fill="#ffeb99"/>
</svg>`;

const $ = sel => document.querySelector(sel);

const state = {
    currentName: null,   // source filename (as-loaded), e.g. "banana.svg" or "banana_V3.svg"
    dirty: false,
    serverAvailable: false,
};

// ---- boot --------------------------------------------------------------

initEditor();
onChange(() => { state.dirty = true; });

wireLoaders();
wireSave();
checkServer().then(ok => {
    state.serverAvailable = ok;
    $('#folder-status').textContent = ok
        ? `Connecte. Dossier : ./${STUDIO_FOLDER}/`
        : 'Serveur local injoignable. Download fonctionne, pas Save.';
    if (ok) refreshFolder();
});

// ---- server probing ----------------------------------------------------

async function checkServer() {
    try {
        const r = await fetch('/api/studio/list', { cache: 'no-store' });
        if (!r.ok) return false;
        const j = await r.json();
        return !!j && Array.isArray(j.files);
    } catch (_) { return false; }
}

async function refreshFolder() {
    try {
        const r = await fetch('/api/studio/list', { cache: 'no-store' });
        const j = await r.json();
        renderFolderList(j.files || []);
    } catch (_) {
        renderFolderList([]);
    }
}

function renderFolderList(files) {
    const ul = $('#folder-list');
    ul.innerHTML = '';
    if (!files.length) {
        const empty = document.createElement('li');
        empty.className = 'muted';
        empty.textContent = '(vide)';
        ul.appendChild(empty);
        return;
    }
    for (const f of files) {
        const li = document.createElement('li');
        li.textContent = f;
        if (f === state.currentName) li.classList.add('current');
        li.addEventListener('click', () => loadFromPath(`/${STUDIO_FOLDER}/${f}`));
        ul.appendChild(li);
    }
}

// ---- load pipeline -----------------------------------------------------

function wireLoaders() {
    const drop = $('#drop-zone');
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => {
        e.preventDefault(); drop.classList.add('drag');
    }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => {
        e.preventDefault(); drop.classList.remove('drag');
    }));
    drop.addEventListener('drop', async e => {
        const file = e.dataTransfer.files[0];
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.svg')) {
            alert('Pas un fichier SVG.');
            return;
        }
        const text = await file.text();
        loadSvgText(text, file.name);
    });
    drop.addEventListener('click', () => {
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = '.svg,image/svg+xml';
        picker.onchange = async () => {
            const f = picker.files[0];
            if (f) loadSvgText(await f.text(), f.name);
        };
        picker.click();
    });

    $('#load-path-btn').addEventListener('click', () => {
        const v = $('#path-input').value.trim();
        if (v) loadFromPath(v);
    });
    $('#path-input').addEventListener('keydown', e => {
        if (e.key === 'Enter') $('#load-path-btn').click();
    });

    $('#new-btn').addEventListener('click', () => loadSvgText(BLANK_SVG, 'untitled.svg'));
}

async function loadFromPath(pathOrUrl) {
    try {
        const url = pathOrUrl.startsWith('http') || pathOrUrl.startsWith('/')
            ? pathOrUrl
            : '/' + pathOrUrl.replace(/^\.?\//, '');
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const text = await r.text();
        const name = decodeURIComponent(url.split('/').pop() || 'loaded.svg');
        loadSvgText(text, name);
        log(`Charge : ${url}`, 'ok');
    } catch (e) {
        log(`Echec : ${e.message}`, 'err');
    }
}

function loadSvgText(text, name) {
    // Quick validity check
    if (!text.includes('<svg')) {
        log('Pas un SVG valide.', 'err');
        return;
    }
    setSvg(text);
    state.currentName = name;
    state.dirty = false;
    $('#filename-display').textContent = name;
    refreshFolder();
}

// ---- save --------------------------------------------------------------

function wireSave() {
    $('#save-btn').addEventListener('click', saveVersioned);
    $('#download-btn').addEventListener('click', downloadCurrent);
}

async function saveVersioned() {
    const svg = getSvg();
    if (!svg) { log('Rien a sauvegarder.', 'err'); return; }
    const base = extractBase(state.currentName || 'untitled.svg');
    if (!state.serverAvailable) {
        log('Serveur injoignable — utilise Download.', 'err');
        return;
    }
    try {
        const r = await fetch('/api/studio/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ base, svg }),
        });
        const j = await r.json();
        if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
        state.currentName = j.file;
        state.dirty = false;
        $('#filename-display').textContent = j.file;
        log(`Sauvegarde : ${STUDIO_FOLDER}/${j.file}`, 'ok');
        refreshFolder();
    } catch (e) {
        log(`Echec save : ${e.message}`, 'err');
    }
}

function extractBase(filename) {
    let name = filename.replace(/\.svg$/i, '');
    name = name.replace(/_V\d+$/i, '');
    return name || 'untitled';
}

function downloadCurrent() {
    const svg = getSvg();
    if (!svg) return;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.currentName || 'studio.svg';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    log(`Telecharge : ${a.download}`, 'ok');
}

// ---- log ---------------------------------------------------------------

function log(msg, cls) {
    const line = document.createElement('div');
    if (cls) line.className = cls;
    const ts = new Date().toLocaleTimeString();
    line.textContent = `[${ts}] ${msg}`;
    const box = $('#save-log');
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;
}

// ---- warn on unload if dirty ------------------------------------------

window.addEventListener('beforeunload', e => {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
});
