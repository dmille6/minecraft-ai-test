#!/usr/bin/env python3
"""PIT-01SHOW: the pit plan's pictures (pure Python, no PIL). Read only.

    python3 scripts/host/pitpic.py <plan.json> <out dir> [label] [after-ground.json]

Writes <out>/pit-top.png (top down: ground by height, water, the keep-out rim, the cove outline, dig depth per column, the layers' yield)
and <out>/pit-iso.png (isometric, the ground BEFORE and the designed bowl AFTER). With an after-ground file (a pitplan.mjs run over a
later dump: its `ground`) the iso's right half is that real ground instead of the plan's target (the rig's before/after).
The plan is scripts/host/pitplan.mjs's output (bots/src/pit.mjs pitPlan + the box's ground)."""
import json, sys, os, zlib, struct

FONT = {
 'A': '0e11111f111111', 'B': '1e11111e11111e', 'C': '0e11101010110e', 'D': '1e11111111111e', 'E': '1f10101e10101f', 'F': '1f10101e101010',
 'G': '0e11101711110f', 'H': '1111111f111111', 'I': '0e04040404040e', 'J': '0702020202120c', 'K': '11121418141211', 'L': '1010101010101f',
 'M': '111b1515111111', 'N': '11191513111111', 'O': '0e11111111110e', 'P': '1e11111e101010', 'Q': '0e11111115120d', 'R': '1e11111e141211',
 'S': '0f10100e01011e', 'T': '1f040404040404', 'U': '1111111111110e', 'V': '11111111110a04', 'W': '1111111515151b', 'X': '11110a040a1111',
 'Y': '11110a04040404', 'Z': '1f01020408101f', '0': '0e11131519110e', '1': '040c040404040e', '2': '0e11010204081f', '3': '1e01010e01011e',
 '4': '02060a121f0202', '5': '1f101e0101110e', '6': '0608101e11110e', '7': '1f010204080808', '8': '0e11110e11110e', '9': '0e11110f01020c',
 '.': '00000000000606', ',': '00000000040408', ':': '00000400000400', '-': '0000000e000000', '+': '0004041f040400', '=': '00001f001f0000',
 '(': '02040808080402', ')': '08040202020408', '/': '01010204081010', ' ': '00000000000000', 'X2': '0'}


class Img:
    def __init__(s, w, h, bg=(250, 250, 247)):
        s.w, s.h = w, h
        s.b = bytearray(bytes(bg) * (w * h))

    def px(s, x, y, c):
        if 0 <= x < s.w and 0 <= y < s.h:
            i = (y * s.w + x) * 3; s.b[i:i + 3] = bytes(c)

    def rect(s, x, y, w, h, c):
        for yy in range(max(0, y), min(s.h, y + h)):
            x0, x1 = max(0, x), min(s.w, x + w)
            if x1 > x0: i = (yy * s.w + x0) * 3; s.b[i:i + 3 * (x1 - x0)] = bytes(c) * (x1 - x0)

    def text(s, x, y, txt, c=(0, 0, 0), k=2):
        for ch in txt.upper():
            g = FONT.get(ch, FONT[' '])
            for r in range(7):
                bits = int(g[2 * r:2 * r + 2], 16)
                for cc in range(5):
                    if bits & (16 >> cc): s.rect(x + cc * k, y + r * k, k, k, c)
            x += 6 * k

    def poly(s, pts, c):
        ys = [p[1] for p in pts]
        for y in range(max(0, int(min(ys))), min(s.h, int(max(ys)) + 1)):
            xs = []
            n = len(pts)
            for i in range(n):
                (x0, y0), (x1, y1) = pts[i], pts[(i + 1) % n]
                if (y0 <= y < y1) or (y1 <= y < y0):
                    xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
            xs.sort()
            for a, b in zip(xs[0::2], xs[1::2]):
                s.rect(int(round(a)), y, int(round(b)) - int(round(a)) + 1, 1, c)

    def save(s, path):
        raw = b''.join(b'\x00' + bytes(s.b[y * s.w * 3:(y + 1) * s.w * 3]) for y in range(s.h))
        def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
        open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', s.w, s.h, 8, 2, 0, 0, 0))
                               + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def mul(c, f): return tuple(max(0, min(255, int(v * f))) for v in c)
def mix(a, b, t): return tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3))


WATER, ICE, RIM, OUT = (60, 120, 215), (175, 210, 240), (235, 135, 30), (20, 20, 20)
GRASS, STONE, SAND, DIRT = (95, 160, 70), (140, 140, 140), (225, 210, 150), (140, 100, 60)
DEPTH = [(255, 240, 180), (240, 200, 120), (215, 150, 70), (170, 100, 45), (120, 70, 35), (90, 50, 25)]


def surf_color(name, h, lo=56, hi=72):
    base = WATER if name == 'water' else ICE if name == 'ice' else STONE if name in ('stone', 'granite', 'diorite', 'andesite', 'cobblestone', 'tuff') \
        else SAND if name in ('sand', 'gravel') else DIRT if name == 'dirt' else GRASS
    if name in ('water', 'ice') or h is None: return base
    return mul(base, 0.75 + 0.5 * max(0.0, min(1.0, (h - lo) / (hi - lo))))


def main():
    plan = json.load(open(sys.argv[1])); out = sys.argv[2]; label = sys.argv[3] if len(sys.argv) > 3 else ''
    after = json.load(open(sys.argv[4]))['ground'] if len(sys.argv) > 4 else None
    os.makedirs(out, exist_ok=True)
    G = {(x, z): (h, n) for x, z, h, n in plan['ground']}
    xs = [k[0] for k in G]; zs = [k[1] for k in G]
    x0, x1, z0, z1 = min(xs), max(xs), min(zs), max(zs)
    pit = {tuple(map(int, k.split(','))) for k in plan.get('pit', [])}
    outline = {tuple(map(int, k.split(','))) for k in plan.get('outline', [])}
    rim = {(r[0], r[1]) for r in plan.get('rim', [])}
    T = {(c['x'], c['z']): (c['g'], c['t']) for c in plan.get('cols', [])}
    # ---- top down ----
    S, MX, MY = 14, 20, 60
    W, H = MX * 2 + (x1 - x0 + 1) * S + 330, MY + (z1 - z0 + 1) * S + 40
    im = Img(W, H)
    im.text(MX, 14, 'PIT-01SHOW  P1 NORTH PIT  TOP DOWN  ' + label, k=2)
    im.text(MX, 34, 'north up. site %s floor y%d' % (','.join(str(plan['site'][k]) for k in ('cx', 'cz', 'w', 'l')), plan['site']['floor']), (60, 60, 60), k=1)
    for (x, z), (h, n) in G.items():
        px, py = MX + (x - x0) * S, MY + (z - z0) * S
        if (x, z) in T:
            g, t = T[(x, z)]
            im.rect(px, py, S, S, DEPTH[min(len(DEPTH) - 1, g - t)])
        else:
            im.rect(px, py, S, S, surf_color(n, h))
        if (x, z) in rim:
            for d in range(0, S, 3): im.rect(px + d, py + d, 2, 2, RIM); im.rect(px + S - 1 - d, py + d, 2, 2, RIM)
    for (x, z) in outline:   # the outline's edge
        px, py = MX + (x - x0) * S, MY + (z - z0) * S
        if (x, z - 1) not in outline: im.rect(px, py, S, 2, OUT)
        if (x, z + 1) not in outline: im.rect(px, py + S - 2, S, 2, OUT)
        if (x - 1, z) not in outline: im.rect(px, py, 2, S, OUT)
        if (x + 1, z) not in outline: im.rect(px + S - 2, py, 2, S, OUT)
    for x in range(x0, x1 + 1, 5): im.text(MX + (x - x0) * S, MY - 12, str(x), (90, 90, 90), k=1)
    for z in range(z0, z1 + 1, 5): im.text(2, MY + (z - z0) * S + 3, str(z), (90, 90, 90), k=1)
    lx, ly = MX + (x1 - x0 + 1) * S + 20, MY
    im.text(lx, ly, 'DIG DEPTH (BLOCKS)', k=2); ly += 22
    for i, c in enumerate(DEPTH):
        im.rect(lx, ly, 16, 12, c); im.text(lx + 24, ly + 2, str(i) if i < len(DEPTH) - 1 else '%d+' % i, k=1); ly += 16
    ly += 6
    for c, t in ((RIM, 'KEEP-OUT RIM (WATER WITHIN %d)' % 3), (OUT, 'COVE OUTLINE'), (ICE, 'SEA ICE'), (WATER, 'WATER'), (GRASS, 'GROUND (BY HEIGHT)')):
        im.rect(lx, ly, 16, 12, c); im.text(lx + 24, ly + 2, t, k=1); ly += 16
    ly += 10
    im.text(lx, ly, 'YIELD BY LAYER (TOP DOWN)', k=1); ly += 14
    for L in plan.get('layers', []):
        im.text(lx, ly, 'Y%d  %4d CELLS  %4d DIRT' % (L['y'], L['n'], L['dirt']), k=1); ly += 12
    ly += 6
    im.text(lx, ly, 'TOTAL DIRT %d  OTHER %d' % (plan.get('dirt', 0), plan.get('other', 0)), k=1); ly += 12
    im.text(lx, ly, 'COLUMNS DUG %d  RIM %d' % (len(pit), len(rim)), k=1); ly += 12
    im.text(lx, ly, 'NEW 2-HIGH STEPS %d' % plan.get('steps2', 0), k=1)
    im.save(os.path.join(out, 'pit-top.png'))
    # ---- iso: before | after ----
    A, B, U = 8, 4, 4    # half tile width, half tile height, one block's rise
    ys = [h for h, n in G.values() if h is not None]
    lo = min(ys) - 1
    def iso_panel(heights, ox, oy, im):
        cols = sorted(heights.items(), key=lambda kv: (kv[0][0] - x0) + (kv[0][1] - z0))
        for (x, z), (h, n, top) in cols:
            if h is None: continue
            i, j = x - x0, z - z0
            cx, cy = ox + (i - j) * A, oy + (i + j) * B
            hp = (h - lo) * U
            topc = top
            im.poly([(cx, cy - hp), (cx + A, cy + B - hp), (cx, cy + 2 * B - hp), (cx - A, cy + B - hp)], topc)
            side = mul(topc, 0.7) if n not in ('water', 'ice') else mul(topc, 0.85)
            im.poly([(cx - A, cy + B - hp), (cx, cy + 2 * B - hp), (cx, cy + 2 * B), (cx - A, cy + B)], side)
            im.poly([(cx + A, cy + B - hp), (cx, cy + 2 * B - hp), (cx, cy + 2 * B), (cx + A, cy + B)], mul(topc, 0.55))
    nx, nz = x1 - x0 + 1, z1 - z0 + 1
    pw = (nx + nz) * A + 40
    ph = (nx + nz) * B + (max(ys) - lo) * U + 60
    im2 = Img(pw * 2 + 20, ph + 50)
    im2.text(10, 10, 'PIT-01SHOW  P1 NORTH PIT  ISO  BEFORE | ' + ('AFTER (RIG)' if after else 'AFTER (DESIGN)') + '  ' + label, k=2)
    before = {}
    for (x, z), (h, n) in G.items():
        before[(x, z)] = (h, n, surf_color(n, h) if (x, z) not in rim else mix(surf_color(n, h), RIM, 0.5))
    aft = {}
    if after:
        AG = {(x, z): (h, n) for x, z, h, n in after}
        for (x, z), (h, n) in AG.items():
            c = surf_color(n, h)
            if (x, z) in pit: c = mix(c, (240, 200, 120), 0.35)
            aft[(x, z)] = (h, n, c)
    else:
        for (x, z), (h, n) in G.items():
            if (x, z) in T:
                t = T[(x, z)][1]
                aft[(x, z)] = (t, 'dirt', mix((185, 150, 95), (120, 85, 50), max(0, min(1, (64 - t) / 4))))
            else:
                aft[(x, z)] = before[(x, z)]
    oy = 50 + (max(ys) - lo) * U
    iso_panel(before, nz * A + 20, oy, im2)
    iso_panel(aft, pw + 20 + nz * A, oy, im2)
    im2.text(20, ph + 30, 'LEFT: THE GROUND NOW (RIM HATCHED ORANGE). RIGHT: THE PIT. NE OF THE PIT IS THE FROZEN SEA.', (60, 60, 60), k=1)
    im2.save(os.path.join(out, 'pit-iso.png'))
    print('wrote', os.path.join(out, 'pit-top.png'), os.path.join(out, 'pit-iso.png'))


main()
