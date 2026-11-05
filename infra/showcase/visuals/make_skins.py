#!/usr/bin/env python3
"""visuals-1105: 15 simple role-themed Minecraft skins (64x64, classic arms), drawn from scratch -- no third-party art.
Pure stdlib (zlib PNG writer). Usage: make_skins.py OUTDIR  -> OUTDIR/<Name>.png + OUTDIR/skins.json (name -> role)."""
import json, os, struct, sys, zlib

W = H = 64


def png(path, px):
    raw = b''.join(b'\x00' + bytes(c for p in px[y] for c in p) for y in range(H))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def hexc(s, a=255):
    s = s.lstrip('#')
    return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), a)


def shade(c, f):
    return tuple(max(0, min(255, int(v * f))) for v in c[:3]) + (c[3],)


CLEAR = (0, 0, 0, 0)


class Skin:
    def __init__(self):
        self.px = [[CLEAR] * W for _ in range(H)]

    def rect(self, x0, y0, x1, y1, c):
        for y in range(y0, y1):
            for x in range(x0, x1):
                self.px[y][x] = c

    def noise_rect(self, x0, y0, x1, y1, c, seed):
        # a little per-pixel variation so a flat colour does not read as plastic
        for y in range(y0, y1):
            for x in range(x0, x1):
                h = ((x * 73856093) ^ (y * 19349663) ^ seed) & 0xff
                self.px[y][x] = shade(c, 0.92 + (h % 16) / 100.0)

    def box(self, ox, oy, w, h, d, c, seed=0, top=None, bottom=None):
        """A Minecraft box UV at (ox, oy): w wide, h tall, d deep."""
        self.noise_rect(ox + d, oy, ox + d + w, oy + d, top or shade(c, 1.08), seed)            # top
        self.noise_rect(ox + d + w, oy, ox + d + 2 * w, oy + d, bottom or shade(c, 0.8), seed)  # bottom
        self.noise_rect(ox, oy + d, ox + 2 * (w + d), oy + d + h, c, seed)                      # 4 sides


def make(role):
    s = Skin()
    skin, hair, shirt, pants, shoes = (hexc(role[k]) for k in ('skin', 'hair', 'shirt', 'pants', 'shoes'))
    sd = role['seed']
    # head (8x8x8 at 0,0)
    s.box(0, 0, 8, 8, 8, skin, sd)
    s.noise_rect(8, 0, 16, 8, hair, sd)                     # top of head
    s.noise_rect(0, 8, 32, 10, hair, sd)                    # hairline all round
    s.noise_rect(24, 8, 32, 14, hair, sd)                   # back of head
    s.noise_rect(0, 10, 2, 13, hair, sd); s.noise_rect(22, 10, 24, 13, hair, sd)   # sideburns
    # face (front = 8..16, 8..16)
    eye = hexc(role.get('eyes', '#3a5fcd'))
    s.rect(9, 12, 11, 13, hexc('#ffffff')); s.rect(13, 12, 15, 13, hexc('#ffffff'))
    s.rect(10, 12, 11, 13, eye); s.rect(13, 12, 14, 13, eye)
    s.rect(11, 14, 13, 15, shade(skin, 0.75))               # mouth
    s.rect(9, 11, 11, 12, shade(hair, 0.9)); s.rect(13, 11, 15, 12, shade(hair, 0.9))   # brows
    # body (8x12x4 at 16,16)
    s.box(16, 16, 8, 12, 4, shirt, sd)
    # arms (4x12x4): right at 40,16; left at 32,48
    for ax, ay in ((40, 16), (32, 48)):
        s.box(ax, ay, 4, 12, 4, shirt, sd, bottom=skin)
        s.noise_rect(ax, ay + 4 + 9, ax + 16, ay + 16, skin, sd)      # hands: bottom 3 rows
    # legs (4x12x4): right at 0,16; left at 16,48
    for lx, ly in ((0, 16), (16, 48)):
        s.box(lx, ly, 4, 12, 4, pants, sd, bottom=shoes)
        s.noise_rect(lx, ly + 4 + 10, lx + 16, ly + 16, shoes, sd)    # boots: bottom 2 rows
    # belt
    if role.get('belt'):
        s.noise_rect(16, 30, 40, 32, hexc(role['belt']), sd)
        s.rect(23, 30, 25, 32, hexc('#d8b04a'))
    # apron / vest / overalls / plaid on the body FRONT (20..28, 20..32)
    if role.get('apron'):
        a = hexc(role['apron'])
        s.noise_rect(21, 21, 27, 32, a, sd); s.noise_rect(21, 20, 22, 21, a, sd); s.noise_rect(26, 20, 27, 21, a, sd)
    if role.get('vest'):
        v = hexc(role['vest'])
        for (x0, x1) in ((20, 23), (25, 28)):
            s.noise_rect(x0, 20, x1, 31, v, sd)
        s.noise_rect(16, 20, 20, 31, v, sd); s.noise_rect(28, 20, 40, 31, v, sd)   # sides + back
        if role.get('stripe'):
            s.rect(16, 26, 40, 27, hexc(role['stripe']))
    if role.get('overalls'):
        o = hexc(role['overalls'])
        s.noise_rect(21, 23, 27, 32, o, sd); s.noise_rect(21, 20, 22, 23, o, sd); s.noise_rect(26, 20, 27, 23, o, sd)
        s.noise_rect(32, 25, 40, 32, o, sd)
        s.rect(21, 23, 22, 24, hexc('#d8b04a')); s.rect(26, 23, 27, 24, hexc('#d8b04a'))
        for lx, ly in ((0, 16), (16, 48)):
            s.noise_rect(lx, ly + 4, lx + 16, ly + 14, o, sd)
    if role.get('plaid'):
        p = hexc(role['plaid'])
        for y in range(20, 32):
            for x in list(range(16, 40)) + list(range(40, 56)):
                if (x // 2 + y // 2) % 3 == 0:
                    s.px[y][x] = p
        for y in range(52, 61):
            for x in range(32, 48):
                if (x // 2 + y // 2) % 3 == 0:
                    s.px[y][x] = p
    if role.get('dots'):
        for (x, y) in ((21, 22), (25, 25), (22, 28), (34, 23), (37, 29), (45, 24), (18, 27), (26, 30)):
            s.rect(x, y, x + 1, y + 1, hexc(role['dots'][(x + y) % len(role['dots'])]))
    if role.get('buttons'):
        for y in (22, 25, 28):
            s.rect(23, y, 24, y + 1, hexc(role['buttons'])); s.rect(24, y, 25, y + 1, hexc(role['buttons']))
    if role.get('bowtie'):
        s.rect(22, 20, 26, 21, hexc(role['bowtie']))
    if role.get('pack'):                                     # backpack on the body BACK (32..40, 20..32)
        s.noise_rect(33, 21, 39, 30, hexc(role['pack']), sd)
        s.rect(33, 21, 39, 22, shade(hexc(role['pack']), 0.7))
    # hat layer (head overlay at 32,0)
    hat = role.get('hat')
    if hat:
        c = hexc(hat['color'])
        rows = hat.get('rows', 3)
        s.noise_rect(40, 0, 48, 8, c, sd)                    # crown top
        s.noise_rect(32, 8, 64, 8 + rows, c, sd)             # band round the head
        if hat.get('brim'):
            s.noise_rect(32, 8 + rows, 64, 9 + rows, shade(c, 0.75), sd)
        if hat.get('lamp'):
            s.rect(43, 8, 45, 10, hexc('#fff3a0'))
        if hat.get('band'):
            s.rect(32, 8 + rows - 1, 64, 8 + rows, hexc(hat['band']))
    if role.get('bandana'):
        s.noise_rect(32, 14, 64, 15, hexc(role['bandana']), sd)
    if role.get('beard'):
        s.noise_rect(9, 14, 15, 16, hexc(role['beard']), sd); s.rect(11, 14, 13, 15, shade(skin, 0.75))
    return s


ROLES = {
    'Alpha': dict(role='builder', skin='#e0ac86', hair='#5a3a22', shirt='#4b6fa8', pants='#2f3f66', shoes='#3a2a1e',
                  vest='#f08a1c', stripe='#e8e8e8', hat=dict(color='#f2c21b', rows=3, brim=True), seed=11),
    'Bravo': dict(role='miner', skin='#c68d65', hair='#2a1d14', shirt='#5b4632', pants='#2b2b2b', shoes='#1e1e1e',
                  belt='#3b2a1a', hat=dict(color='#9aa0a6', rows=3, lamp=True), beard='#2a1d14', seed=23),
    'Comet': dict(role='deep miner', skin='#8d5a3b', hair='#151515', shirt='#6d6d6d', pants='#24325a', shoes='#1c1c1c',
                  overalls='#24325a', bandana='#b8322a', seed=37),
    'Delta': dict(role='groundskeeper', skin='#f1c7a5', hair='#b5651d', shirt='#e9e2c9', pants='#3f7a35', shoes='#4a3420',
                  overalls='#3f7a35', hat=dict(color='#d9b968', rows=2, brim=True, band='#7a4a1c'), seed=41),
    'Echo': dict(role='decorator', skin='#e8b996', hair='#1c1c1c', shirt='#f2f2f2', pants='#f2f2f2', shoes='#555555',
                 overalls='#f4f4f0', dots=['#d8342c', '#2c6fd8', '#f2c21b', '#3fa34d'],
                 hat=dict(color='#c0392b', rows=2), seed=53),
    'Frost': dict(role='clerk', skin='#f3d2b8', hair='#d9d2c5', shirt='#ffffff', pants='#55585e', shoes='#151515',
                  vest='#1f2228', bowtie='#a3202a', eyes='#6fa8dc', seed=67),
    'Gale': dict(role='lumberjack', skin='#d49a72', hair='#6b2d12', shirt='#b0241d', pants='#3b4a5e', shoes='#3a2617',
                 plaid='#1d1d1d', beard='#6b2d12', hat=dict(color='#2d4b2a', rows=3), seed=71),
    'Haven': dict(role='farmer', skin='#e7b48f', hair='#e3c16f', shirt='#c94f3d', pants='#3c64a0', shoes='#4b321d',
                  overalls='#3c64a0', hat=dict(color='#e6cc7e', rows=2, brim=True), seed=83),
    'Iris': dict(role='gardener', skin='#b97a56', hair='#3d2314', shirt='#8e5bb5', pants='#5c4a3a', shoes='#3b2b1e',
                 apron='#6aa84f', hat=dict(color='#f5a3c7', rows=1, band='#f5e663'), seed=97),
    'Juno': dict(role='smith', skin='#a46a47', hair='#121212', shirt='#7b7f86', pants='#3a3a3a', shoes='#1a1a1a',
                 apron='#7a4b26', belt='#2e1e12', seed=101),
    'Kite': dict(role='explorer', skin='#e2b28c', hair='#8a5a2b', shirt='#c2a46b', pants='#7d6a45', shoes='#4a321c',
                 belt='#5a3d1e', pack='#6b4a2b', hat=dict(color='#b89b62', rows=2, brim=True, band='#5a3d1e'), seed=113),
    'Lumen': dict(role='lamplighter', skin='#f0c9a8', hair='#2b2b2b', shirt='#1f2d4d', pants='#1a1f2e', shoes='#111111',
                  buttons='#e6c35c', hat=dict(color='#151a24', rows=4, band='#e6c35c'), seed=127),
    'Maple': dict(role='forester', skin='#f4cfb0', hair='#d2691e', shirt='#2f6b3a', pants='#6b4f2f', shoes='#3a2817',
                  belt='#4a331c', eyes='#4a8c3a', seed=131),
    'Nova': dict(role='storekeeper', skin='#c98f6b', hair='#4a2e1c', shirt='#2a8c8c', pants='#4a4a52', shoes='#262626',
                 apron='#8a6a46', hat=dict(color='#2a8c8c', rows=2, brim=True), seed=149),
    'Onyx': dict(role='mason', skin='#7e5034', hair='#0f0f0f', shirt='#a7a7a2', pants='#8a8a85', shoes='#3a3a3a',
                 overalls='#8d8d88', dots=['#c9c9c4', '#6f6f6a'], hat=dict(color='#e8e8e4', rows=2), seed=157),
}


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for name, r in ROLES.items():
        png(os.path.join(out, f'{name}.png'), make(r).px)
    json.dump({f'showcase-{n}': {'skin': f'mcai-{n.lower()}', 'role': r['role'], 'png': f'{n}.png'}
               for n, r in ROLES.items()}, open(os.path.join(out, 'skins.json'), 'w'), indent=1)
    print(len(ROLES), 'skins ->', out)


if __name__ == '__main__':
    main()
