// Studio editor: tree, selection, overlay, inspector, palette, :root vars.
//
// All the DOM wiring lives here. main.js owns load/save and drives this
// module via setSvg(svgText) / getSvg() / onChange(cb).

import { parsePath, serializePath, getHandles } from './paths.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const OVERLAY_ID = '__studio_overlay__';
const STAMP_PREFIX = 'el-';

// ---- module state ------------------------------------------------------

const state = {
    svg: null,          // live <svg> element in preview-host
    hostEl: null,       // #preview-host
    selected: null,     // currently selected element (or null)
    changeCbs: [],
    history: [],        // string snapshots for undo
    historyCap: 40,
    handleRadius: 4,    // viewBox units, set per-SVG
};

const $ = sel => document.querySelector(sel);

// ---- public API --------------------------------------------------------

export function init() {
    state.hostEl = $('#preview-host');
    $('#autotag-btn').addEventListener('click', autoTagAll);
    $('#undo-btn').addEventListener('click', undo);
    // Swallow Ctrl+Z globally when focus is in the stage.
    document.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.target.matches('input,textarea')) {
            e.preventDefault();
            undo();
        }
    });
    renderEmpty();
}

export function setSvg(svgText) {
    if (!svgText) { renderEmpty(); return; }
    state.hostEl.innerHTML = svgText;
    const svg = state.hostEl.querySelector('svg');
    if (!svg) { renderEmpty(); return; }
    state.svg = svg;
    state.selected = null;
    state.history = [];
    tuneHandleRadius();
    ensureOverlay();
    wireSvgClicks();
    refresh();
}

export function getSvg() {
    if (!state.svg) return '';
    // Strip overlay before serializing.
    const overlay = state.svg.querySelector('#' + OVERLAY_ID);
    if (overlay) overlay.remove();
    const text = new XMLSerializer().serializeToString(state.svg);
    // Re-attach overlay so UI stays intact.
    ensureOverlay();
    redrawOverlay();
    return text;
}

export function onChange(cb) { state.changeCbs.push(cb); }

// ---- history / change notification ------------------------------------

function snapshot() {
    if (!state.svg) return;
    const overlay = state.svg.querySelector('#' + OVERLAY_ID);
    if (overlay) overlay.remove();
    const text = new XMLSerializer().serializeToString(state.svg);
    ensureOverlay();
    redrawOverlay();
    state.history.push(text);
    if (state.history.length > state.historyCap) state.history.shift();
}

function undo() {
    if (state.history.length === 0) return;
    const text = state.history.pop();
    state.hostEl.innerHTML = text;
    state.svg = state.hostEl.querySelector('svg');
    state.selected = null;
    tuneHandleRadius();
    ensureOverlay();
    wireSvgClicks();
    refresh();
    fire();
}

function fire() {
    for (const cb of state.changeCbs) {
        try { cb(); } catch (e) { console.error(e); }
    }
}

// ---- overlay setup -----------------------------------------------------

function tuneHandleRadius() {
    if (!state.svg) return;
    const vb = state.svg.viewBox?.baseVal;
    const w = vb?.width || parseFloat(state.svg.getAttribute('width')) || 200;
    const h = vb?.height || parseFloat(state.svg.getAttribute('height')) || 200;
    state.handleRadius = Math.max(2, Math.hypot(w, h) * 0.006);
}

function ensureOverlay() {
    if (!state.svg) return null;
    let g = state.svg.querySelector('#' + OVERLAY_ID);
    if (!g) {
        g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('id', OVERLAY_ID);
        g.setAttribute('pointer-events', 'none');
        state.svg.appendChild(g);
    }
    return g;
}

function clearOverlay() {
    const g = state.svg?.querySelector('#' + OVERLAY_ID);
    if (g) g.innerHTML = '';
}

function wireSvgClicks() {
    if (!state.svg) return;
    state.svg.addEventListener('click', e => {
        const target = e.target;
        if (!target || target === state.svg) { select(null); return; }
        // Ignore clicks on overlay graphics (pointer-events:none already, but safety).
        if (target.closest('#' + OVERLAY_ID)) return;
        // Don't select <style>, <defs>, <metadata> children of the root.
        if (['style','defs','metadata','title','desc'].includes(target.tagName.toLowerCase())) return;
        select(target);
    });
}

// ---- auto-tag ----------------------------------------------------------

function autoTagAll() {
    if (!state.svg) return;
    snapshot();
    const used = new Set();
    state.svg.querySelectorAll('[id]').forEach(el => used.add(el.id));
    let counter = 1;
    const editable = state.svg.querySelectorAll(
        'path, rect, circle, ellipse, line, polygon, polyline, g, text, image, use, linearGradient, radialGradient, filter'
    );
    editable.forEach(el => {
        if (el.closest('#' + OVERLAY_ID)) return;
        if (el.id) return;
        let id;
        do { id = `${STAMP_PREFIX}${counter++}`; } while (used.has(id));
        used.add(id);
        el.setAttribute('id', id);
    });
    refresh();
    fire();
}

// ---- full refresh ------------------------------------------------------

function refresh() {
    renderTree();
    renderInspector();
    renderPalette();
    renderCssVars();
    redrawOverlay();
}

// ---- tree --------------------------------------------------------------

function renderEmpty() {
    if (state.hostEl) state.hostEl.innerHTML = '<div class="muted" style="color:#9ca3af; padding:2rem;">Pas de SVG charge.</div>';
    $('#element-tree').innerHTML = '';
    $('#inspector').innerHTML = '<p class="muted">Clique un element dans l\'arbre ou l\'apercu.</p>';
    $('#inspector-title').textContent = 'Inspecteur';
    $('#palette').innerHTML = '';
    $('#cssvars').innerHTML = '';
}

function renderTree() {
    const ul = $('#element-tree');
    ul.innerHTML = '';
    if (!state.svg) return;
    walk(state.svg, 0, ul);
}

function walk(el, depth, ul) {
    if (el.id === OVERLAY_ID) return;
    if (['style','metadata','title','desc'].includes(el.tagName.toLowerCase())) return;

    const li = document.createElement('li');
    li.dataset.ref = uniqueRef(el);
    if (state.selected === el) li.classList.add('selected');

    const indent = document.createElement('span');
    indent.className = 'depth';
    indent.style.width = (depth * 10) + 'px';
    li.appendChild(indent);

    const tagSpan = document.createElement('span');
    tagSpan.className = 'tag';
    tagSpan.textContent = '<' + el.tagName.toLowerCase() + '>';
    li.appendChild(tagSpan);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = el.id ? '#' + el.id : '(untagged)';
    li.appendChild(nameSpan);

    if (el.id) {
        const btn = document.createElement('button');
        btn.className = 'tree-btn';
        btn.textContent = 'untag';
        btn.title = 'Retirer l\'id';
        btn.addEventListener('click', e => {
            e.stopPropagation();
            snapshot();
            el.removeAttribute('id');
            refresh(); fire();
        });
        li.appendChild(btn);
    }

    if (el !== state.svg) {
        const del = document.createElement('button');
        del.className = 'tree-btn danger';
        del.textContent = '×';
        del.title = 'Supprimer';
        del.addEventListener('click', e => {
            e.stopPropagation();
            if (!confirm(`Supprimer <${el.tagName.toLowerCase()}>${el.id ? ' #' + el.id : ''} ?`)) return;
            snapshot();
            if (state.selected === el) state.selected = null;
            el.remove();
            refresh(); fire();
        });
        li.appendChild(del);
    }

    li.addEventListener('click', () => select(el));
    ul.appendChild(li);

    for (const child of el.children) walk(child, depth + 1, ul);
}

let refCounter = 0;
const refToEl = new WeakMap();
function uniqueRef(el) {
    let r = refToEl.get(el);
    if (!r) { r = 'r' + (++refCounter); refToEl.set(el, r); }
    return r;
}

// ---- selection ---------------------------------------------------------

function select(el) {
    state.selected = el;
    renderTree();
    renderInspector();
    redrawOverlay();
}

// ---- overlay redraw ----------------------------------------------------

function redrawOverlay() {
    if (!state.svg) return;
    clearOverlay();
    const g = ensureOverlay();
    if (!state.selected || state.selected === state.svg) return;
    const el = state.selected;
    const tag = el.tagName.toLowerCase();

    // Outline via bbox, transformed by element's CTM relative to SVG root.
    try {
        const bbox = el.getBBox();
        const ctm = getElToSvgMatrix(el);
        const corners = [
            transformPt(ctm, bbox.x, bbox.y),
            transformPt(ctm, bbox.x + bbox.width, bbox.y),
            transformPt(ctm, bbox.x + bbox.width, bbox.y + bbox.height),
            transformPt(ctm, bbox.x, bbox.y + bbox.height),
        ];
        const pts = corners.map(p => `${p.x},${p.y}`).join(' ');
        const poly = document.createElementNS(SVG_NS, 'polygon');
        poly.setAttribute('class', '__studio_outline');
        poly.setAttribute('points', pts);
        g.appendChild(poly);
    } catch (_) { /* bbox can fail on degenerate elements */ }

    if (tag === 'path') drawPathHandles(el, g);
}

function getElToSvgMatrix(el) {
    // Compose transforms from el up to (but not including) the root SVG.
    try {
        const root = state.svg;
        const elCTM = el.getCTM();
        const rootCTM = root.getCTM();
        if (elCTM && rootCTM) return rootCTM.inverse().multiply(elCTM);
    } catch (_) {}
    return new DOMMatrix();
}

function transformPt(m, x, y) {
    return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

function drawPathHandles(pathEl, g) {
    let cmds;
    try {
        cmds = parsePath(pathEl.getAttribute('d') || '');
    } catch (_) { return; }
    const handles = getHandles(cmds);
    const r = state.handleRadius;

    // Dashed links from anchor to its controls.
    for (const h of handles) {
        if (h.role === 'control' && h.linkFrom) {
            const line = document.createElementNS(SVG_NS, 'line');
            line.setAttribute('class', '__studio_link');
            line.setAttribute('x1', h.linkFrom.x);
            line.setAttribute('y1', h.linkFrom.y);
            line.setAttribute('x2', h.x);
            line.setAttribute('y2', h.y);
            g.appendChild(line);
        }
    }
    for (let idx = 0; idx < handles.length; idx++) {
        const h = handles[idx];
        const c = document.createElementNS(SVG_NS, 'circle');
        c.setAttribute('class', '__studio_handle' + (h.role === 'control' ? ' control' : ''));
        c.setAttribute('cx', h.x);
        c.setAttribute('cy', h.y);
        c.setAttribute('r', h.role === 'control' ? r * 0.8 : r);
        c.setAttribute('pointer-events', 'auto');
        wireHandleDrag(c, pathEl, cmds, idx);
        g.appendChild(c);
    }
}

function wireHandleDrag(circle, pathEl, cmds, handleIdx) {
    let dragging = false;
    let snapped = false;
    circle.addEventListener('pointerdown', e => {
        e.preventDefault(); e.stopPropagation();
        circle.setPointerCapture(e.pointerId);
        dragging = true;
        snapped = false;
    });
    circle.addEventListener('pointermove', e => {
        if (!dragging) return;
        if (!snapped) { snapshot(); snapped = true; }
        const pt = clientToSvg(e.clientX, e.clientY);
        const handles = getHandles(cmds);
        const h = handles[handleIdx];
        const cmd = cmds[h.cmdIdx];
        cmd[h.fieldX] = pt.x;
        cmd[h.fieldY] = pt.y;
        // Keep H/V constraints: H locks y to previous cy, V locks x.
        if (cmd.type === 'H') { /* only x matters on serialize */ }
        if (cmd.type === 'V') { /* only y matters on serialize */ }
        pathEl.setAttribute('d', serializePath(cmds));
        redrawOverlay();
    });
    circle.addEventListener('pointerup', e => {
        if (!dragging) return;
        dragging = false;
        try { circle.releasePointerCapture(e.pointerId); } catch (_) {}
        if (snapped) fire();
    });
}

function clientToSvg(clientX, clientY) {
    const pt = state.svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = state.svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
}

// ---- inspector ---------------------------------------------------------

function renderInspector() {
    const host = $('#inspector');
    const title = $('#inspector-title');
    host.innerHTML = '';
    if (!state.selected || state.selected === state.svg) {
        title.textContent = state.svg ? '<svg>' : 'Inspecteur';
        if (state.svg) {
            renderSvgRootFields(host);
        } else {
            host.innerHTML = '<p class="muted">Clique un element dans l\'arbre ou l\'apercu.</p>';
        }
        return;
    }
    const el = state.selected;
    const tag = el.tagName.toLowerCase();
    title.textContent = `<${tag}>${el.id ? ' #' + el.id : ''}`;

    if (el.id !== undefined) addTextField(host, 'id', el.id || '', v => {
        snapshot();
        if (v) el.setAttribute('id', v); else el.removeAttribute('id');
        renderTree(); fire();
    });

    const editor = EDITORS[tag] || renderGeneric;
    editor(host, el);

    // Common style fields for everything except root/gradient/filter
    if (!['lineargradient','radialgradient','stop','filter','fegaussianblur','fedropshadow','fecolormatrix','style','defs'].includes(tag)) {
        addSection(host, 'Style');
        addColorField(host, 'fill', el.getAttribute('fill') || '', v => setOrRemove(el, 'fill', v));
        addColorField(host, 'stroke', el.getAttribute('stroke') || '', v => setOrRemove(el, 'stroke', v));
        addNumberField(host, 'stroke-width', el.getAttribute('stroke-width') || '', 0, 50, 0.5, v => setOrRemove(el, 'stroke-width', v));
        addNumberField(host, 'opacity', el.getAttribute('opacity') ?? '', 0, 1, 0.05, v => setOrRemove(el, 'opacity', v));
    }

    if (['g','path','rect','circle','ellipse','line','polygon','polyline','text','image','use'].includes(tag)) {
        addSection(host, 'Transform');
        const transform = el.getAttribute('transform') || '';
        addTextField(host, 'transform', transform, v => setOrRemove(el, 'transform', v));
    }
}

function renderSvgRootFields(host) {
    const el = state.svg;
    addSection(host, 'Document');
    addTextField(host, 'viewBox', el.getAttribute('viewBox') || '', v => setOrRemove(el, 'viewBox', v));
    addTextField(host, 'width', el.getAttribute('width') || '', v => setOrRemove(el, 'width', v));
    addTextField(host, 'height', el.getAttribute('height') || '', v => setOrRemove(el, 'height', v));
}

const EDITORS = {
    path: (host, el) => {
        addSection(host, 'Path');
        const dVal = el.getAttribute('d') || '';
        addTextareaField(host, 'd', dVal, v => {
            try { parsePath(v); } catch (_) { /* still accept */ }
            setOrRemove(el, 'd', v);
            redrawOverlay();
        });
        const info = document.createElement('div');
        info.className = 'muted';
        info.style.fontSize = '0.78rem';
        try {
            const cmds = parsePath(dVal);
            info.textContent = `${cmds.length} commandes. Glisse les points bleus (anchors) et violets (controles Bezier) directement dans l'apercu.`;
        } catch (_) { info.textContent = 'd invalide.'; }
        host.appendChild(info);
    },
    rect: (host, el) => {
        addSection(host, 'Rectangle');
        addNumberAttr(host, el, 'x', -1000, 1000, 1);
        addNumberAttr(host, el, 'y', -1000, 1000, 1);
        addNumberAttr(host, el, 'width', 0, 2000, 1);
        addNumberAttr(host, el, 'height', 0, 2000, 1);
        addNumberAttr(host, el, 'rx', 0, 500, 1);
        addNumberAttr(host, el, 'ry', 0, 500, 1);
    },
    circle: (host, el) => {
        addSection(host, 'Cercle');
        addNumberAttr(host, el, 'cx', -1000, 2000, 1);
        addNumberAttr(host, el, 'cy', -1000, 2000, 1);
        addNumberAttr(host, el, 'r', 0, 2000, 1);
    },
    ellipse: (host, el) => {
        addSection(host, 'Ellipse');
        addNumberAttr(host, el, 'cx', -1000, 2000, 1);
        addNumberAttr(host, el, 'cy', -1000, 2000, 1);
        addNumberAttr(host, el, 'rx', 0, 2000, 1);
        addNumberAttr(host, el, 'ry', 0, 2000, 1);
    },
    line: (host, el) => {
        addSection(host, 'Ligne');
        addNumberAttr(host, el, 'x1', -1000, 2000, 1);
        addNumberAttr(host, el, 'y1', -1000, 2000, 1);
        addNumberAttr(host, el, 'x2', -1000, 2000, 1);
        addNumberAttr(host, el, 'y2', -1000, 2000, 1);
    },
    polygon: (host, el) => {
        addSection(host, 'Polygone');
        addTextareaField(host, 'points', el.getAttribute('points') || '', v => setOrRemove(el, 'points', v));
    },
    polyline: (host, el) => {
        addSection(host, 'Polyligne');
        addTextareaField(host, 'points', el.getAttribute('points') || '', v => setOrRemove(el, 'points', v));
    },
    g: (host, el) => {
        addSection(host, 'Groupe');
        addTextField(host, 'class', el.getAttribute('class') || '', v => setOrRemove(el, 'class', v));
    },
    text: (host, el) => {
        addSection(host, 'Texte');
        addNumberAttr(host, el, 'x', -1000, 2000, 1);
        addNumberAttr(host, el, 'y', -1000, 2000, 1);
        addTextField(host, 'content', el.textContent || '', v => {
            snapshot(); el.textContent = v; fire();
        });
        addNumberAttr(host, el, 'font-size', 4, 200, 1);
        addTextField(host, 'font-family', el.getAttribute('font-family') || '', v => setOrRemove(el, 'font-family', v));
        addTextField(host, 'text-anchor', el.getAttribute('text-anchor') || '', v => setOrRemove(el, 'text-anchor', v));
    },
    image: (host, el) => {
        addSection(host, 'Image');
        const href = el.getAttribute('href') || el.getAttribute('xlink:href') || '';
        addTextField(host, 'href', href, v => {
            snapshot();
            el.setAttribute('href', v);
            el.removeAttribute('xlink:href');
            fire();
        });
        addNumberAttr(host, el, 'x', -1000, 2000, 1);
        addNumberAttr(host, el, 'y', -1000, 2000, 1);
        addNumberAttr(host, el, 'width', 0, 2000, 1);
        addNumberAttr(host, el, 'height', 0, 2000, 1);
    },
    linearGradient: (host, el) => renderGradient(host, el, 'linear'),
    radialGradient: (host, el) => renderGradient(host, el, 'radial'),
    stop: (host, el) => {
        addSection(host, 'Stop');
        addNumberAttr(host, el, 'offset', 0, 1, 0.01);
        addColorField(host, 'stop-color', el.getAttribute('stop-color') || '', v => setOrRemove(el, 'stop-color', v));
        addNumberAttr(host, el, 'stop-opacity', 0, 1, 0.05);
    },
};

function renderGradient(host, el, kind) {
    addSection(host, kind === 'linear' ? 'Dégradé linéaire' : 'Dégradé radial');
    if (kind === 'linear') {
        addNumberAttr(host, el, 'x1', -500, 1500, 1);
        addNumberAttr(host, el, 'y1', -500, 1500, 1);
        addNumberAttr(host, el, 'x2', -500, 1500, 1);
        addNumberAttr(host, el, 'y2', -500, 1500, 1);
    } else {
        addNumberAttr(host, el, 'cx', -500, 1500, 1);
        addNumberAttr(host, el, 'cy', -500, 1500, 1);
        addNumberAttr(host, el, 'r', 0, 1500, 1);
    }
    addSection(host, 'Stops');
    const stops = el.querySelectorAll('stop');
    stops.forEach((s, i) => {
        const wrap = document.createElement('div');
        wrap.style.cssText = 'border-top:1px dashed #e5e7eb; margin-top:0.4rem; padding-top:0.3rem;';
        const label = document.createElement('div');
        label.className = 'section-title';
        label.textContent = `Stop ${i + 1}`;
        wrap.appendChild(label);
        host.appendChild(wrap);
        // render stop fields inline
        addNumberFieldNode(wrap, 'offset', parseFloat(s.getAttribute('offset') || 0), 0, 1, 0.01, v => setOrRemove(s, 'offset', v));
        addColorFieldNode(wrap, 'stop-color', s.getAttribute('stop-color') || '', v => setOrRemove(s, 'stop-color', v));
        addNumberFieldNode(wrap, 'stop-opacity', parseFloat(s.getAttribute('stop-opacity') ?? 1), 0, 1, 0.05, v => setOrRemove(s, 'stop-opacity', v));
    });
}

function renderGeneric(host, el) {
    addSection(host, 'Attributs');
    for (const attr of el.attributes) {
        if (attr.name === 'id' || attr.name === 'style' || attr.name === 'class') continue;
        addTextField(host, attr.name, attr.value, v => setOrRemove(el, attr.name, v));
    }
}

// ---- inspector field builders ------------------------------------------

function addSection(host, label) {
    const h = document.createElement('div');
    h.className = 'section-title';
    h.textContent = label;
    host.appendChild(h);
}

function addTextField(host, label, value, onchange) {
    const row = mkRow(label);
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    let pending = false;
    input.addEventListener('focus', () => { pending = false; });
    input.addEventListener('input', () => {
        if (!pending) { snapshot(); pending = true; }
        onchange(input.value);
    });
    input.addEventListener('change', () => { if (pending) fire(); });
    row.appendChild(input);
    host.appendChild(row);
}

function addTextareaField(host, label, value, onchange) {
    const row = mkRow(label);
    const ta = document.createElement('textarea');
    ta.value = value;
    let pending = false;
    ta.addEventListener('input', () => {
        if (!pending) { snapshot(); pending = true; }
        onchange(ta.value);
    });
    ta.addEventListener('change', () => { if (pending) fire(); });
    row.appendChild(ta);
    host.appendChild(row);
}

function addNumberField(host, label, value, min, max, step, onchange) {
    addNumberFieldNode(host, label, value, min, max, step, onchange);
}

function addNumberFieldNode(host, label, value, min, max, step, onchange) {
    const row = mkRow(label);
    const wrap = document.createElement('div');
    wrap.className = 'field-row';
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = min; slider.max = max; slider.step = step;
    const num = document.createElement('input');
    num.type = 'number';
    num.style.width = '64px';
    num.min = min; num.max = max; num.step = step;
    const setBoth = v => {
        slider.value = v;
        num.value = v;
    };
    setBoth(value === '' ? (min + max) / 2 : value);
    if (value === '') { slider.value = (min + max) / 2; num.value = ''; }

    let pending = false;
    const commit = v => {
        if (!pending) { snapshot(); pending = true; }
        onchange(v);
    };
    slider.addEventListener('input', () => { num.value = slider.value; commit(slider.value); });
    num.addEventListener('input', () => { slider.value = num.value; commit(num.value); });
    const done = () => { if (pending) { fire(); pending = false; } };
    slider.addEventListener('change', done);
    num.addEventListener('change', done);

    wrap.appendChild(slider);
    wrap.appendChild(num);
    row.appendChild(wrap);
    host.appendChild(row);
}

function addNumberAttr(host, el, attr, min, max, step) {
    const cur = el.getAttribute(attr) ?? '';
    addNumberFieldNode(host, attr, cur === '' ? '' : parseFloat(cur), min, max, step, v => setOrRemove(el, attr, v));
}

function addColorField(host, label, value, onchange) {
    addColorFieldNode(host, label, value, onchange);
}

function addColorFieldNode(host, label, value, onchange) {
    const row = mkRow(label);
    const wrap = document.createElement('div');
    wrap.className = 'field-row';
    const color = document.createElement('input');
    color.type = 'color';
    color.value = toHex(value) || '#000000';
    const txt = document.createElement('input');
    txt.type = 'text';
    txt.value = value;
    txt.placeholder = '#rrggbb, url(#…), none';

    let pending = false;
    const commit = v => {
        if (!pending) { snapshot(); pending = true; }
        onchange(v);
    };
    color.addEventListener('input', () => { txt.value = color.value; commit(color.value); });
    txt.addEventListener('input', () => {
        const hex = toHex(txt.value);
        if (hex) color.value = hex;
        commit(txt.value);
    });
    const done = () => { if (pending) { fire(); pending = false; } };
    color.addEventListener('change', done);
    txt.addEventListener('change', done);

    wrap.appendChild(color);
    wrap.appendChild(txt);
    row.appendChild(wrap);
    host.appendChild(row);
}

function mkRow(label) {
    const row = document.createElement('div');
    row.className = 'field';
    const lab = document.createElement('label');
    lab.textContent = label;
    row.appendChild(lab);
    return row;
}

function setOrRemove(el, name, v) {
    if (v === '' || v == null) el.removeAttribute(name);
    else el.setAttribute(name, v);
    fire();
    if (state.selected === el) redrawOverlay();
}

// ---- palette -----------------------------------------------------------

function renderPalette() {
    const host = $('#palette');
    host.innerHTML = '';
    if (!state.svg) return;
    const counts = new Map(); // hex → {count, nodes:[{el, attr}]}
    const targets = state.svg.querySelectorAll('*');
    targets.forEach(el => {
        if (el.closest('#' + OVERLAY_ID)) return;
        for (const attr of ['fill', 'stroke', 'stop-color']) {
            const v = el.getAttribute(attr);
            if (!v) continue;
            const hex = toHex(v);
            if (!hex) continue;
            const key = hex.toLowerCase();
            if (!counts.has(key)) counts.set(key, { hex: key, count: 0, nodes: [] });
            counts.get(key).count++;
            counts.get(key).nodes.push({ el, attr });
        }
    });

    const sorted = [...counts.values()].sort((a, b) => b.count - a.count);
    if (sorted.length === 0) {
        host.innerHTML = '<p class="muted" style="margin:0;">Aucune couleur litterale trouvee.</p>';
        return;
    }
    for (const entry of sorted) {
        const sw = document.createElement('div');
        sw.className = 'swatch';
        const dot = document.createElement('div');
        dot.className = 'dot';
        dot.style.background = entry.hex;
        const count = document.createElement('span');
        count.className = 'count';
        count.textContent = `${entry.hex} (${entry.count})`;
        sw.appendChild(dot);
        sw.appendChild(count);

        const picker = document.createElement('input');
        picker.type = 'color';
        picker.value = entry.hex;
        picker.style.cssText = 'width:28px;height:28px;padding:0;border:0;background:transparent;position:absolute;opacity:0;cursor:pointer;';
        sw.style.position = 'relative';
        sw.appendChild(picker);
        sw.addEventListener('click', () => picker.click());

        let pending = false;
        picker.addEventListener('input', () => {
            if (!pending) { snapshot(); pending = true; }
            dot.style.background = picker.value;
            for (const n of entry.nodes) n.el.setAttribute(n.attr, picker.value);
        });
        picker.addEventListener('change', () => {
            if (pending) { fire(); renderPalette(); renderInspector(); pending = false; }
        });

        host.appendChild(sw);
    }
}

// ---- :root CSS variables ----------------------------------------------

function renderCssVars() {
    const host = $('#cssvars');
    host.innerHTML = '';
    if (!state.svg) return;
    const style = state.svg.querySelector('style');
    if (!style) { host.innerHTML = '<p class="muted" style="margin:0;">Aucun bloc style.</p>'; return; }
    const css = style.textContent || '';
    const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/);
    if (!rootMatch) { host.innerHTML = '<p class="muted" style="margin:0;">Pas de <code>:root</code>.</p>'; return; }
    const body = rootMatch[1];
    const varRe = /(--[\w-]+)\s*:\s*([^;]+?)\s*;/g;
    let m;
    const found = [];
    while ((m = varRe.exec(body)) !== null) {
        found.push({ name: m[1], value: m[2].trim() });
    }
    if (found.length === 0) {
        host.innerHTML = '<p class="muted" style="margin:0;">Aucune variable dans :root.</p>';
        return;
    }
    for (const v of found) {
        const row = document.createElement('div');
        row.className = 'var-row';
        const label = document.createElement('span');
        label.className = 'var-name';
        label.textContent = v.name;
        row.appendChild(label);

        const isColor = !!toHex(v.value);
        const isNum = !isColor && /^-?\d+(\.\d+)?$/.test(v.value);
        let input;
        if (isColor) {
            input = document.createElement('input');
            input.type = 'color';
            input.value = toHex(v.value);
        } else if (isNum) {
            input = document.createElement('input');
            input.type = 'number';
            input.step = 'any';
            input.value = v.value;
            input.style.width = '80px';
        } else {
            input = document.createElement('input');
            input.type = 'text';
            input.value = v.value;
            input.style.width = '120px';
        }
        let pending = false;
        input.addEventListener('input', () => {
            if (!pending) { snapshot(); pending = true; }
            updateRootVar(v.name, input.value);
        });
        input.addEventListener('change', () => { if (pending) { fire(); pending = false; } });
        row.appendChild(input);
        host.appendChild(row);
    }
}

function updateRootVar(name, value) {
    const style = state.svg.querySelector('style');
    if (!style) return;
    const css = style.textContent || '';
    const re = new RegExp(`(${escapeRe(name)}\\s*:\\s*)[^;]+(;)`);
    if (re.test(css)) {
        style.textContent = css.replace(re, `$1${value}$2`);
    }
}

function escapeRe(s) { return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'); }

// ---- color helper -----------------------------------------------------

function toHex(input) {
    if (!input) return null;
    const s = String(input).trim().toLowerCase();
    if (s === 'none' || s === 'transparent' || s === 'currentcolor' || s.startsWith('url(')) return null;
    if (/^#[0-9a-f]{6}$/i.test(s)) return s;
    if (/^#[0-9a-f]{3}$/i.test(s)) {
        return '#' + s.slice(1).split('').map(c => c + c).join('');
    }
    const rgb = s.match(/^rgba?\(\s*([0-9.]+)[ ,]+([0-9.]+)[ ,]+([0-9.]+)/);
    if (rgb) {
        const r = Math.round(parseFloat(rgb[1]));
        const g = Math.round(parseFloat(rgb[2]));
        const b = Math.round(parseFloat(rgb[3]));
        return '#' + [r, g, b].map(n => n.toString(16).padStart(2, '0')).join('');
    }
    // Named colors: use a throwaway element + getComputedStyle.
    try {
        const probe = document.createElement('span');
        probe.style.color = s;
        document.body.appendChild(probe);
        const resolved = getComputedStyle(probe).color;
        document.body.removeChild(probe);
        const m2 = resolved.match(/^rgba?\((\d+)[ ,]+(\d+)[ ,]+(\d+)/);
        if (m2) return '#' + [m2[1], m2[2], m2[3]].map(n => (+n).toString(16).padStart(2, '0')).join('');
    } catch (_) {}
    return null;
}
