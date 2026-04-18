"""Detect colour groups in a workshop SVG and propose `@ws mix=` links.

Algorithm:
1. Parse the SVG's :root block, get every --*-color variable + its value.
2. Convert each colour to HSL.
3. Cluster colours that share a hue band (~15 deg) AND a saturation band
   (~20%). These are the "shades of one base colour" groups.
4. Within each group, pick the most-saturated mid-luminance colour as the
   base.  Compute the `mix=` amount for each other group member by
   inverting the JS mixColor() formula:
     - amount > 0 (lighten): amount = avg((target_chan - base_chan) / (255 - base_chan))
     - amount < 0 (darken):  amount = avg((target_chan / base_chan) - 1)
5. Print proposed hint lines + apply them in-place to the SVG.
"""
import colorsys
import re
import sys
from pathlib import Path

SVG = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('gallery/puppy.svg')
HUE_TOL = 20            # degrees — within same hue band
SAT_TOL = 0.25          # 0..1 — similar saturation
LUM_NEAR = 0.08         # don't link two near-identical colours, just leave them
MIN_CHROMATIC_SAT = 0.05  # below this a colour is "neutral" and not linked


def hex_to_rgb(h):
    h = h.lstrip('#')
    if len(h) == 3:
        h = ''.join(c + c for c in h)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def rgb_to_hex(r, g, b):
    return '#' + ''.join(f'{int(round(c * 255)):02x}' for c in (r, g, b))


def hue_dist(a, b):
    d = abs(a - b) * 360
    return min(d, 360 - d)


def family(name):
    """Naming-family prefix: everything before the last meaningful token.

    --skin-color          -> 'skin'
    --skin-light-color    -> 'skin'
    --skin-shadow-color   -> 'skin'
    --couch-mid-color     -> 'couch'
    --beard-orange-color  -> 'beard'
    --text-yellow-color   -> 'text'
    --fur-tan-color       -> 'fur'
    --bg-color            -> 'bg'

    Colours in different families never auto-link, even when their hue
    and saturation are close, because they're semantically unrelated
    (fur and couch are both warm-grey but they're different regions).
    """
    stem = name.lstrip('-')
    if stem.endswith('-color'):
        stem = stem[:-len('-color')]
    # Family = first token before any hyphen.
    return stem.split('-')[0]


def cluster_colors(items):
    """Colours cluster together when they share a naming family AND a hue
    AND both are sufficiently saturated.  Naming-family constraint (fur-*
    only links with fur-*; skin-* only with skin-*) prevents cross-region
    links like 'skin linked to beard-orange because both are warm'."""
    pool = list(items)
    clusters = []
    while pool:
        seed = pool.pop(0)
        seed_family = family(seed[0])
        seed_rgb = hex_to_rgb(seed[1])
        sh, sl, ss = colorsys.rgb_to_hls(*seed_rgb)
        cluster = [seed]
        kept = []
        for it in pool:
            if family(it[0]) != seed_family:
                kept.append(it); continue
            r, g, b = hex_to_rgb(it[1])
            h, l, s = colorsys.rgb_to_hls(r, g, b)
            both_chromatic = ss >= MIN_CHROMATIC_SAT and s >= MIN_CHROMATIC_SAT
            # Within the same family we can relax chromatic constraints:
            # family alignment is already strong semantic evidence.
            same_hue_or_neutral = (
                both_chromatic and hue_dist(sh, h) < HUE_TOL and abs(ss - s) < SAT_TOL
                or not both_chromatic and abs(ss - s) < 0.15
            )
            if same_hue_or_neutral:
                cluster.append(it); continue
            kept.append(it)
        pool = kept
        clusters.append(cluster)
    return clusters


MODIFIERS = {'shadow', 'dark', 'light', 'deep', 'hi', 'high', 'low', 'lo',
             'tint', 'shade', 'bright', 'mute', 'muted'}


def modifier_count(name):
    """How many 'shadow/dark/light...' modifier words does this variable name
    contain? Fewer = more likely to be the base colour."""
    stem = name.lstrip('-').replace('-color', '')
    return sum(1 for w in stem.split('-') if w.lower() in MODIFIERS)


def propose_links(cluster):
    """Pick the base colour and compute mix amounts for the others.

    Base preference (in order):
    1. Fewest modifier words in the name (couch-mid beats couch-shadow).
    2. Middle luminance (so you can both lighten and darken from it).
    3. Highest saturation (tiebreaker).
    """
    if len(cluster) < 2:
        return []
    decoded = []
    for name, hx in cluster:
        r, g, b = hex_to_rgb(hx)
        h, l, s = colorsys.rgb_to_hls(r, g, b)
        decoded.append({'name': name, 'hex': hx, 'rgb': (r, g, b), 'h': h, 'l': l, 's': s,
                        'mods': modifier_count(name)})
    decoded.sort(key=lambda d: (d['mods'], abs(d['l'] - 0.5), -d['s']))
    base = decoded[0]
    out = []
    for d in decoded[1:]:
        if abs(d['l'] - base['l']) < LUM_NEAR:
            continue  # too close to base — not a useful link
        # Compute mix amount per channel and average
        br, bg, bb = base['rgb']
        tr, tg, tb = d['rgb']
        if d['l'] > base['l']:
            # lighten: target = base + (1 - base) * amount
            amts = []
            for bc, tc in [(br, tr), (bg, tg), (bb, tb)]:
                if 1 - bc < 0.01: continue
                amts.append((tc - bc) / (1 - bc))
            if not amts: continue
            amount = sum(amts) / len(amts)
        else:
            # darken: target = base * (1 + amount); amount in (-1, 0)
            amts = []
            for bc, tc in [(br, tr), (bg, tg), (bb, tb)]:
                if bc < 0.01: continue
                amts.append((tc / bc) - 1)
            if not amts: continue
            amount = sum(amts) / len(amts)
        amount = max(-1.0, min(1.0, amount))
        out.append({'derived': d['name'], 'base': base['name'], 'amount': round(amount, 2)})
    return out


def main():
    text = SVG.read_text(encoding='utf-8')
    # Strip any existing `@ws mix=` hints first so we can't create circular
    # references by layering a new hint on top of an old one.
    text = re.sub(r'\s*/\*\s*@ws\s+mix=[^*]*\*/', '', text)
    m = re.search(r':root\s*\{([^}]*)\}', text)
    if not m:
        print('no :root block found'); sys.exit(1)
    body = m.group(1)
    decls = re.findall(r'(--[\w-]+-color)\s*:\s*(#[0-9a-fA-F]{6})\s*;', body)
    print(f'{len(decls)} colour variables:')
    for n, h in decls:
        r, g, b = hex_to_rgb(h)
        hl, l, s = colorsys.rgb_to_hls(r, g, b)
        print(f'  {n:24} {h}  hue={hl*360:5.1f}  sat={s:.2f}  lum={l:.2f}')

    clusters = cluster_colors(decls)
    print(f'\n{len(clusters)} cluster(s):')
    for ci, cl in enumerate(clusters):
        names = [n for n, _ in cl]
        print(f'  cluster {ci}: {", ".join(names)}')

    proposals = []
    for cl in clusters:
        proposals.extend(propose_links(cl))

    print(f'\nProposed @ws mix= links:')
    for p in proposals:
        print(f'  {p["derived"]}  =  {p["base"]}  mix={p["amount"]:+.2f}')

    # Apply: for each derived var, replace the line with a hint-bearing line.
    for p in proposals:
        # current line (no hint)
        cur_re = re.compile(rf'(\s*{re.escape(p["derived"])}\s*:\s*)(#[0-9a-fA-F]{{6}})\s*;[^\n]*')
        base_short = p['base'].lstrip('-')
        amount = p['amount']
        new_hint = f'/* @ws mix={base_short}:{amount} */'
        def repl(m, h=new_hint):
            return f'{m.group(1)}{m.group(2)};      {h}'
        text2, n = cur_re.subn(repl, text, count=1)
        if n == 0:
            print(f'  WARN: failed to find line for {p["derived"]}')
            continue
        text = text2

    SVG.write_text(text, encoding='utf-8')
    print(f'\nWrote {SVG}')


if __name__ == '__main__':
    main()
