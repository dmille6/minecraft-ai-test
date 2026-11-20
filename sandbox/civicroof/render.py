#!/usr/bin/env python3
"""SANDBOX-ONLY (civicroof-01show): A PICTURE OF A BUILD from a COPY of a world's region files (never a live world) -- an isometric view
(from the south-east, above) as SVG, and a top-down view as PNG (stdlib only: no PIL on the hosts). Stairs and slabs are drawn in their
real shape and facing (the block states are read from the region), so a roof reads as it stands in the game.
    python3 render.py <region dir> <townplan_blockdump.py> --box X0 Z0 X1 Z1 --y Y0 Y1 --out <prefix> [--title T] [--ground Y]
-> <prefix>.svg (isometric), <prefix>-top.png (top-down, 24 px a block), <prefix>-blocks.json (every non-air block, with its state)."""
import argparse, importlib.util, json, struct, zlib

COL = {
    'dark_oak': (66, 43, 21), 'spruce': (115, 85, 52), 'oak': (162, 130, 78), 'stone_bricks': (122, 121, 122), 'stone_brick': (122, 121, 122),
    'cobblestone': (110, 110, 110), 'stone': (125, 125, 125), 'grass_block': (95, 145, 60), 'dirt': (134, 96, 67), 'lantern': (235, 190, 90),
    'torch': (240, 200, 90), 'spruce_log': (58, 37, 16), 'leaves': (60, 100, 50), 'deepslate': (80, 80, 85), 'andesite': (136, 136, 136),
    'diorite': (188, 188, 188), 'gravel': (130, 124, 122), 'short_grass': (110, 160, 70), 'fern': (100, 150, 70), 'sand': (219, 207, 163),
}
SKIP = {'air', 'cave_air', '?', 'short_grass', 'tall_grass', 'fern', 'large_fern'}


def colour(n):
    if n in COL: return COL[n]
    if n.endswith('_log') and n.replace('_log', '') in COL: return tuple(max(0, c - 30) for c in COL[n.replace('_log', '')])
    for k in sorted(COL, key=len, reverse=True):
        if k in n: return COL[k]
    return (170, 90, 170)


def load(rdir, dumper, box, ys):
    spec = importlib.util.spec_from_file_location('bd', dumper); bd = importlib.util.module_from_spec(spec); spec.loader.exec_module(bd)
    x0, z0, x1, z1 = box; y0, y1 = ys
    out = []
    for cx in range(x0 >> 4, (x1 >> 4) + 1):
        for cz in range(z0 >> 4, (z1 >> 4) + 1):
            ch = bd.chunk(rdir, cx, cz)
            if ch is None: continue
            secs = {s.get('Y'): s.get('block_states') or {} for s in ch.get('sections', [])}
            for sy in range(y0 >> 4, (y1 >> 4) + 1):
                bs = secs.get(sy)
                if bs is None: continue
                pal = bs.get('palette') or []
                vals = bd.section_values(bs)
                for ly in range(16):
                    y = sy * 16 + ly
                    if not y0 <= y <= y1: continue
                    for lz in range(16):
                        z = cz * 16 + lz
                        if not z0 <= z <= z1: continue
                        for lx in range(16):
                            x = cx * 16 + lx
                            if not x0 <= x <= x1: continue
                            e = pal[vals[(ly * 16 + lz) * 16 + lx]] if vals is not None else (pal[0] if pal else {})
                            n = e.get('Name', 'minecraft:air').replace('minecraft:', '')
                            if n in SKIP: continue
                            out.append({'at': [x, y, z], 'name': n, 'props': e.get('Properties') or {}})
    return out


def boxes(b):
    """The block's solid parts as unit-fraction boxes (x0, y0, z0, x1, y1, z1)."""
    n, p = b['name'], b['props']
    if n.endswith('_stairs'):
        top = p.get('half') == 'top'
        base = (0, 0.5, 0, 1, 1, 1) if top else (0, 0, 0, 1, 0.5, 1)
        ys = (0, 0.5) if top else (0.5, 1)
        f = p.get('facing', 'north')
        step = {'north': (0, ys[0], 0, 1, ys[1], 0.5), 'south': (0, ys[0], 0.5, 1, ys[1], 1), 'west': (0, ys[0], 0, 0.5, ys[1], 1), 'east': (0.5, ys[0], 0, 1, ys[1], 1)}[f]
        return [base, step]
    if n.endswith('_slab'):
        t = p.get('type', 'bottom')
        return [(0, 0, 0, 1, 1, 1)] if t == 'double' else [(0, 0.5, 0, 1, 1, 1)] if t == 'top' else [(0, 0, 0, 1, 0.5, 1)]
    if n in ('lantern', 'torch'):
        return [(0.3, 0, 0.3, 0.7, 0.5, 0.7)]
    if n.endswith('_wall') or n.endswith('_fence'):
        return [(0.3, 0, 0.3, 0.7, 1, 0.7)]
    return [(0, 0, 0, 1, 1, 1)]


def shade(c, k): return '#%02x%02x%02x' % tuple(max(0, min(255, int(v * k))) for v in c)


def iso_svg(blocks, title, sub):
    S = 26  # px per block edge
    pt = lambda x, y, z: ((x - z) * S * 0.866, (x + z) * S * 0.5 - y * S)
    polys = []
    for b in blocks:
        bx, by, bz = b['at']; c = colour(b['name'])
        for (a0, b0, c0, a1, b1, c1) in boxes(b):
            X0, Y0, Z0, X1, Y1, Z1 = bx + a0, by + b0, bz + c0, bx + a1, by + b1, bz + c1
            key = (X0 + X1) / 2 + (Z0 + Z1) / 2 + (Y0 + Y1) / 2 * 0.01, (Y0 + Y1) / 2
            faces = [
                ([pt(X0, Y1, Z0), pt(X1, Y1, Z0), pt(X1, Y1, Z1), pt(X0, Y1, Z1)], shade(c, 1.15)),   # top
                ([pt(X0, Y0, Z1), pt(X1, Y0, Z1), pt(X1, Y1, Z1), pt(X0, Y1, Z1)], shade(c, 0.80)),   # south (+z)
                ([pt(X1, Y0, Z0), pt(X1, Y0, Z1), pt(X1, Y1, Z1), pt(X1, Y1, Z0)], shade(c, 0.62)),   # east (+x)
            ]
            polys.append((key, faces))
    polys.sort(key=lambda q: (q[0][0] + q[0][1], q[0][1]))
    xs = [x for _, fs in polys for f, _ in fs for x, _ in f]; ys = [y for _, fs in polys for f, _ in fs for _, y in f]
    if not xs: xs, ys = [0, 1], [0, 1]
    pad = 40; ox, oy = -min(xs) + pad, -min(ys) + pad + 40
    W, H = max(xs) - min(xs) + 2 * pad, max(ys) - min(ys) + 2 * pad + 60
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" viewBox="0 0 {W:.0f} {H:.0f}">',
           f'<rect width="100%" height="100%" fill="#dfe9f2"/>',
           f'<text x="{pad}" y="30" font-family="Helvetica,Arial" font-size="18" fill="#222">{title}</text>',
           f'<text x="{pad}" y="52" font-family="Helvetica,Arial" font-size="12" fill="#444">{sub}</text>']
    for _, fs in polys:
        for f, col in fs:
            out.append('<polygon points="%s" fill="%s" stroke="#00000033" stroke-width="0.6"/>' % (' '.join(f'{x + ox:.1f},{y + oy:.1f}' for x, y in f), col))
    out.append('</svg>')
    return '\n'.join(out)


def png(w, h, px):
    raw = b''.join(b'\x00' + bytes(v for p in px[r * w:(r + 1) * w] for v in p) for r in range(h))
    ch = lambda t, d: struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw, 9)) + ch(b'IEND', b'')


def top_png(blocks, box):
    x0, z0, x1, z1 = box; P = 24
    top = {}
    for b in blocks:
        k = (b['at'][0], b['at'][2])
        if k not in top or b['at'][1] > top[k]['at'][1]: top[k] = b
    w, h = (x1 - x0 + 1) * P, (z1 - z0 + 1) * P
    px = [(223, 233, 242)] * (w * h)
    ymin = min((b['at'][1] for b in top.values()), default=0); ymax = max((b['at'][1] for b in top.values()), default=1)
    for (x, z), b in top.items():
        c = colour(b['name']); k = 0.75 + 0.35 * ((b['at'][1] - ymin) / max(1, ymax - ymin))
        c = tuple(max(0, min(255, int(v * k))) for v in c)
        f = b['props'].get('facing') if b['name'].endswith('_stairs') else None
        for dy in range(P):
            for dx in range(P):
                q = c
                if dx in (0, P - 1) or dy in (0, P - 1): q = tuple(int(v * 0.7) for v in c)
                # the stair's raised half (its facing side) a shade lighter: a roof's slope reads from above
                elif f and ((f == 'north' and dy < P // 2) or (f == 'south' and dy >= P // 2) or (f == 'west' and dx < P // 2) or (f == 'east' and dx >= P // 2)):
                    q = tuple(min(255, int(v * 1.25)) for v in c)
                px[((z - z0) * P + dy) * w + (x - x0) * P + dx] = q
    return png(w, h, px)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('region_dir'); ap.add_argument('dumper')
    ap.add_argument('--box', nargs=4, type=int, required=True); ap.add_argument('--y', nargs=2, type=int, required=True)
    ap.add_argument('--out', required=True); ap.add_argument('--title', default='build'); ap.add_argument('--sub', default='')
    ap.add_argument('--ground', type=int, default=None, help='draw nothing below this y (the terrain under the build)')
    a = ap.parse_args()
    bl = load(a.region_dir, a.dumper, a.box, a.y)
    if a.ground is not None: bl = [b for b in bl if b['at'][1] >= a.ground]
    open(a.out + '-blocks.json', 'w').write(json.dumps(bl))
    open(a.out + '.svg', 'w').write(iso_svg(bl, a.title, a.sub))
    open(a.out + '-top.png', 'wb').write(top_png(bl, a.box))
    names = {}
    for b in bl: names[b['name']] = names.get(b['name'], 0) + 1
    print(len(bl), 'blocks', json.dumps(names, sort_keys=True))


if __name__ == '__main__':
    main()
