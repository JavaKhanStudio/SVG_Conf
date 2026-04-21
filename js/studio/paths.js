// SVG path d parser/serializer with handle extraction.
// Normalizes all commands to absolute coords. Preserves command type
// (M/L/H/V/C/S/Q/T/A/Z) so the round-tripped d stays close to the
// user-authored source.

const TOKEN_RE = /[MLHVCSQTAZmlhvcsqtaz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

const ARGS_PER_CMD = {
    M: 2, m: 2, L: 2, l: 2, H: 1, h: 1, V: 1, v: 1,
    C: 6, c: 6, S: 4, s: 4, Q: 4, q: 4, T: 2, t: 2,
    A: 7, a: 7, Z: 0, z: 0,
};

export function parsePath(d) {
    if (!d) return [];
    const tokens = d.match(TOKEN_RE) || [];
    const cmds = [];
    let i = 0;
    let cx = 0, cy = 0;         // current point
    let sx = 0, sy = 0;         // subpath start (for Z)
    let lastCmd = null;         // for repeated-arg shorthand
    let lastCtrl = null;        // for S/T reflection: {x, y} of last C/S ctrl2 or Q/T ctrl

    while (i < tokens.length) {
        let letter = tokens[i];
        if (!/[A-Za-z]/.test(letter)) {
            // repeat the last command implicitly
            if (!lastCmd) throw new Error('path: number before any command');
            letter = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd;
        } else {
            i++;
        }
        const upper = letter.toUpperCase();
        const rel = letter !== upper;
        const n = ARGS_PER_CMD[letter];
        if (n === undefined) throw new Error(`path: bad command ${letter}`);

        if (upper === 'Z') {
            cmds.push({ type: 'Z' });
            cx = sx; cy = sy;
            lastCtrl = null;
            lastCmd = letter;
            continue;
        }

        const a = [];
        for (let k = 0; k < n; k++) {
            a.push(parseFloat(tokens[i++]));
        }

        let cmd;
        switch (upper) {
            case 'M': {
                const x = rel ? cx + a[0] : a[0];
                const y = rel ? cy + a[1] : a[1];
                cmd = { type: 'M', x, y };
                cx = x; cy = y; sx = x; sy = y;
                // subsequent pairs become implicit L
                lastCmd = rel ? 'm' : 'M';
                lastCtrl = null;
                break;
            }
            case 'L': {
                const x = rel ? cx + a[0] : a[0];
                const y = rel ? cy + a[1] : a[1];
                cmd = { type: 'L', x, y };
                cx = x; cy = y;
                lastCtrl = null;
                break;
            }
            case 'H': {
                const x = rel ? cx + a[0] : a[0];
                cmd = { type: 'H', x, y: cy };
                cx = x;
                lastCtrl = null;
                break;
            }
            case 'V': {
                const y = rel ? cy + a[0] : a[0];
                cmd = { type: 'V', x: cx, y };
                cy = y;
                lastCtrl = null;
                break;
            }
            case 'C': {
                const x1 = rel ? cx + a[0] : a[0];
                const y1 = rel ? cy + a[1] : a[1];
                const x2 = rel ? cx + a[2] : a[2];
                const y2 = rel ? cy + a[3] : a[3];
                const x  = rel ? cx + a[4] : a[4];
                const y  = rel ? cy + a[5] : a[5];
                cmd = { type: 'C', x1, y1, x2, y2, x, y };
                cx = x; cy = y;
                lastCtrl = { x: x2, y: y2 };
                break;
            }
            case 'S': {
                const x2 = rel ? cx + a[0] : a[0];
                const y2 = rel ? cy + a[1] : a[1];
                const x  = rel ? cx + a[2] : a[2];
                const y  = rel ? cy + a[3] : a[3];
                cmd = { type: 'S', x2, y2, x, y };
                cx = x; cy = y;
                lastCtrl = { x: x2, y: y2 };
                break;
            }
            case 'Q': {
                const x1 = rel ? cx + a[0] : a[0];
                const y1 = rel ? cy + a[1] : a[1];
                const x  = rel ? cx + a[2] : a[2];
                const y  = rel ? cy + a[3] : a[3];
                cmd = { type: 'Q', x1, y1, x, y };
                cx = x; cy = y;
                lastCtrl = { x: x1, y: y1 };
                break;
            }
            case 'T': {
                const x = rel ? cx + a[0] : a[0];
                const y = rel ? cy + a[1] : a[1];
                cmd = { type: 'T', x, y };
                cx = x; cy = y;
                // T's implicit control is the reflection of the previous Q/T ctrl
                break;
            }
            case 'A': {
                const rx = a[0], ry = a[1], rot = a[2], large = a[3], sweep = a[4];
                const x = rel ? cx + a[5] : a[5];
                const y = rel ? cy + a[6] : a[6];
                cmd = { type: 'A', rx, ry, rot, large, sweep, x, y };
                cx = x; cy = y;
                lastCtrl = null;
                break;
            }
        }
        cmds.push(cmd);
        lastCmd = letter;
    }
    return cmds;
}

export function serializePath(cmds) {
    const parts = [];
    for (const c of cmds) {
        switch (c.type) {
            case 'M': parts.push(`M ${fmt(c.x)} ${fmt(c.y)}`); break;
            case 'L': parts.push(`L ${fmt(c.x)} ${fmt(c.y)}`); break;
            case 'H': parts.push(`H ${fmt(c.x)}`); break;
            case 'V': parts.push(`V ${fmt(c.y)}`); break;
            case 'C': parts.push(`C ${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x2)} ${fmt(c.y2)} ${fmt(c.x)} ${fmt(c.y)}`); break;
            case 'S': parts.push(`S ${fmt(c.x2)} ${fmt(c.y2)} ${fmt(c.x)} ${fmt(c.y)}`); break;
            case 'Q': parts.push(`Q ${fmt(c.x1)} ${fmt(c.y1)} ${fmt(c.x)} ${fmt(c.y)}`); break;
            case 'T': parts.push(`T ${fmt(c.x)} ${fmt(c.y)}`); break;
            case 'A': parts.push(`A ${fmt(c.rx)} ${fmt(c.ry)} ${fmt(c.rot)} ${c.large|0} ${c.sweep|0} ${fmt(c.x)} ${fmt(c.y)}`); break;
            case 'Z': parts.push('Z'); break;
        }
    }
    return parts.join(' ');
}

function fmt(n) {
    if (!Number.isFinite(n)) return '0';
    const r = Math.round(n * 1000) / 1000;
    return String(r);
}

// Return a flat list of draggable points for a parsed path.
// Each handle: { role: 'anchor'|'control', cmdIdx, field: 'x'/'y'/'x1'/'y1'/'x2'/'y2', pairField, x, y, linkFrom? }
// linkFrom = {x, y} to draw a dashed line from, or null.
export function getHandles(cmds) {
    const handles = [];
    let prevAnchor = null;

    for (let i = 0; i < cmds.length; i++) {
        const c = cmds[i];
        switch (c.type) {
            case 'M':
            case 'L':
            case 'T':
                handles.push(anchor(i, c));
                prevAnchor = { x: c.x, y: c.y };
                break;
            case 'H':
            case 'V':
                handles.push(anchor(i, c));
                prevAnchor = { x: c.x, y: c.y };
                break;
            case 'C':
                handles.push(ctrl(i, c, 'x1', 'y1', prevAnchor));
                handles.push(ctrl(i, c, 'x2', 'y2', { x: c.x, y: c.y }));
                handles.push(anchor(i, c));
                prevAnchor = { x: c.x, y: c.y };
                break;
            case 'S':
                handles.push(ctrl(i, c, 'x2', 'y2', { x: c.x, y: c.y }));
                handles.push(anchor(i, c));
                prevAnchor = { x: c.x, y: c.y };
                break;
            case 'Q':
                handles.push(ctrl(i, c, 'x1', 'y1', prevAnchor));
                handles.push(anchor(i, c));
                prevAnchor = { x: c.x, y: c.y };
                break;
            case 'A':
                handles.push(anchor(i, c));
                prevAnchor = { x: c.x, y: c.y };
                break;
            case 'Z':
                // no handle
                break;
        }
    }
    return handles;
}

function anchor(cmdIdx, c) {
    return {
        role: 'anchor',
        cmdIdx,
        fieldX: 'x',
        fieldY: 'y',
        x: c.x,
        y: c.y,
        linkFrom: null,
    };
}

function ctrl(cmdIdx, c, fx, fy, linkFrom) {
    return {
        role: 'control',
        cmdIdx,
        fieldX: fx,
        fieldY: fy,
        x: c[fx],
        y: c[fy],
        linkFrom,
    };
}
