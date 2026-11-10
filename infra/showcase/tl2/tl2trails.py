#!/usr/bin/env python3
"""timelapse2 v2 top-down overlays (owner feedback 11-10): connected fading trails per bot, current-position markers with
names, a legend (offline bots grey), and a heat-map variant (time spent per block since 00:00 UTC of the frame's day).
Usage (on .30, ~/tl2-1110): python3 tl2trails.py trails|heat LO_YYYYMMDD HI_YYYYMMDD out.mp4 still.png
Input: posfull.tsv (every bot.pos sample: iso-time, bot, x, z), src/frames/topdown/<day>/<stamp>.png."""
import bisect, collections, datetime as dt, math, os, shutil, sys
import tl2
from tl2 import ff, frames, day_no, txtfile, FONT, GRADE, ORTHO_K, UTC

W, H, DIST = 1920, 1080, 95.0
S = H / (DIST * ORTHO_K)                       # 7.41 px/block (fitted against CoreProtect)
TRAIL = dt.timedelta(hours=2)
GAP_S, MAX_V, MAX_JUMP = 60.0, 6.5, 32.0      # break a line: sample gap > 60 s, speed > 6.5 b/s (faster than sprinting), jump > 32
ONLINE = dt.timedelta(minutes=10)             # a bot with no sample in the last 10 min is offline
HEAT_REF_S = 3600.0                           # 1 h in one block = full heat
# distinct, saturated, readable on green / brown / grey terrain (no greens close to grass, no browns)
COLORS = {'Alpha': (255, 59, 48), 'Bravo': (255, 214, 0), 'Comet': (0, 229, 255), 'Delta': (255, 64, 200),
          'Echo': (255, 255, 255), 'Frost': (255, 140, 0), 'Gale': (190, 255, 60), 'Haven': (160, 110, 255),
          'Iris': (40, 120, 255), 'Juno': (255, 150, 160), 'Kite': (0, 255, 170), 'Lumen': (255, 240, 150),
          'Maple': (200, 0, 90), 'Nova': (120, 200, 255), 'Onyx': (20, 20, 20)}
GREY = (130, 130, 130)


def px(x, z):
    return W / 2 + (x - 0.5) * S, H / 2 + (z - 0.5) * S


def load():
    pos = collections.defaultdict(list)
    for l in open('posfull.tsv'):
        t, b, x, z = l.rstrip('\n').split('\t')
        pos[b].append((dt.datetime.fromisoformat(t).replace(tzinfo=UTC), float(x), float(z)))
    for b in pos:
        pos[b].sort()
    return pos


def connected(a, b):
    d = (b[0] - a[0]).total_seconds()
    D = math.hypot(b[1] - a[1], b[2] - a[2])
    return d <= GAP_S and D <= MAX_JUMP and D / max(d, 0.05) <= MAX_V


class Canvas(tl2.Canvas):
    def put(self, x, y, rgba):
        x, y = int(x), int(y)
        if 0 <= x < self.W and 0 <= y < self.H:
            o = (y * self.W + x) * 4
            if rgba[3] >= self.b[o + 3]:
                self.b[o:o + 4] = bytes(rgba)

    def line(self, x0, y0, x1, y1, rgba, w=3):
        n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        h = w // 2
        last = None
        for i in range(n + 1):
            f = i / n
            x, y = int(x0 + (x1 - x0) * f), int(y0 + (y1 - y0) * f)
            if (x, y) == last:
                continue
            last = (x, y)
            for dy in range(-h, w - h):
                for dx in range(-h, w - h):
                    self.put(x + dx, y + dy, rgba)

    def disk(self, cx, cy, r, rgba):
        for dy in range(-r, r + 1):
            for dx in range(-r, r + 1):
                if dx * dx + dy * dy <= r * r:
                    self.put(cx + dx, cy + dy, rgba)


def trails(c, pos, t):
    lo = t - TRAIL
    for b, ps in pos.items():
        col = COLORS.get(b, (255, 255, 255))
        i = bisect.bisect_left(ps, (lo,))
        j = bisect.bisect_right(ps, (t, 1e9, 1e9))
        for k in range(i + 1, j):
            a, e = ps[k - 1], ps[k]
            if not connected(a, e):
                continue
            age = (t - e[0]) / TRAIL
            alpha = int(255 * (0.1 + 0.9 * (1 - age)))
            x0, y0 = px(a[1], a[2]); x1, y1 = px(e[1], e[2])
            if max(x0, x1) < 0 or min(x0, x1) > W or max(y0, y1) < 0 or min(y0, y1) > H:
                continue
            c.line(x0, y0, x1, y1, col + (alpha,), 3 if age < 0.25 else 2)


def current(pos, t):
    out = {}
    for b, ps in pos.items():
        j = bisect.bisect_right(ps, (t, 1e9, 1e9)) - 1
        if j >= 0:
            out[b] = (ps[j], t - ps[j][0] <= ONLINE)
    return out


def markers(c, cur, tmp, key):
    texts = []
    for b, ((tt, x, z), on) in sorted(cur.items()):
        if not on:
            continue
        X, Y = px(x, z)
        dark = (235, 235, 235, 255) if b == 'Onyx' else (15, 15, 15, 255)
        name = b
        if not (0 <= X < W and 0 <= Y < H):          # away (expedition): a smaller marker on the frame edge, with the distance
            m = 26
            X, Y = min(max(X, m), W - m), min(max(Y, m + 110), H - m)
            if X > W - 290 and Y < 420:
                X = W - 290
            c.disk(int(X), int(Y), 7, dark)                # unlabelled: the legend says where it is
            c.disk(int(X), int(Y), 4, COLORS.get(b, (255, 255, 255)) + (255,))
            continue
        else:
            c.disk(int(X), int(Y), 10, dark)
            c.disk(int(X), int(Y), 7, COLORS.get(b, (255, 255, 255)) + (255,))
        lx = int(X) + 13 if X < W - 160 else int(X) - 13 - 9 * len(name)
        texts.append(f"drawtext=fontfile={FONT}:textfile={txtfile(tmp, f'n-{b}.txt', name)}:expansion=none:fontsize=17:fontcolor=white:"
                     f"borderw=2:bordercolor=black:x={lx}:y={int(Y) - 9}")
    return texts


def compass(x, z):
    a = math.degrees(math.atan2(x, -z)) % 360       # 0 = north (-z), 90 = east (+x)
    return ('N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW')[int((a + 22.5) // 45) % 8]


def legend(c, cur, tmp):
    bots = sorted(COLORS)
    x0, y0, rh = W - 250, 20, 24
    c.rect(x0 - 12, y0 - 10, W - 12, y0 + rh * len(bots) + 4, (0, 0, 0, 150))
    texts = []
    for i, b in enumerate(bots):
        on = cur.get(b, (None, False))[1]
        y = y0 + i * rh
        c.rect(x0 - 2, y + 1, x0 + 18, y + 19, (15, 15, 15, 255) if b != 'Onyx' else (220, 220, 220, 255))
        c.rect(x0, y + 3, x0 + 16, y + 17, (COLORS[b] if on else GREY) + (255,))
        lab = b + ('' if on else '  offline')
        if on:
            (_, x, z) = cur[b][0]
            X, Y = px(x, z)
            if not (0 <= X < W and 0 <= Y < H):
                lab = f'{b}  away {int(math.hypot(x, z))} b {compass(x, z)}'
        texts.append(f"drawtext=fontfile={FONT}:textfile={txtfile(tmp, f'l-{b}.txt', lab)}:expansion=none:"
                     f"fontsize=17:fontcolor={'white' if on else '0x8a8a8a'}:x={x0 + 26}:y={y + 2}")
    return texts


class Heat:
    def __init__(self):
        self.gw, self.gh = int(W / S) + 2, int(H / S) + 2
        self.day, self.g, self.done = None, None, {}

    def advance(self, pos, t):
        """Accumulate seconds per block from 00:00 UTC of t's day up to t (incremental over sorted frames)."""
        d = t.date()
        if d != self.day:
            self.day, self.g, self.done = d, [0.0] * (self.gw * self.gh), {}
            start = dt.datetime(d.year, d.month, d.day, tzinfo=UTC)
            for b, ps in pos.items():
                self.done[b] = bisect.bisect_left(ps, (start,))
        for b, ps in pos.items():
            j = bisect.bisect_right(ps, (t, 1e9, 1e9))
            for k in range(max(self.done[b], 1), j):
                a, e = ps[k - 1], ps[k]
                if a[0].date() != d or not connected(a, e):
                    continue
                secs = (e[0] - a[0]).total_seconds()
                n = int(max(abs(e[1] - a[1]), abs(e[2] - a[2]))) + 1
                for i in range(n):
                    f = i / n
                    X = (a[1] + (e[1] - a[1]) * f - 0.5) + W / 2 / S
                    Z = (a[2] + (e[2] - a[2]) * f - 0.5) + H / 2 / S
                    gx, gz = int(X), int(Z)
                    if 0 <= gx < self.gw and 0 <= gz < self.gh:
                        self.g[gz * self.gw + gx] += secs / n
            self.done[b] = max(self.done[b], j)

    def save(self, p):
        out = bytearray(self.gw * self.gh * 4)
        ref = math.log1p(HEAT_REF_S)
        for i, v in enumerate(self.g):
            if v < 20:                                      # under 20 s in a block today: no heat
                continue
            f = min(1.0, math.sqrt(v / HEAT_REF_S))         # 1 min 0.13, 10 min 0.41, 1 h 1.0
            o = i * 4
            if f < 0.5:                                     # purple -> magenta -> yellow: reads on green, brown and grey
                g = f / 0.5; col = (int(120 + 135 * g), int(40 - 40 * g), int(255 - 105 * g))
            else:
                g = (f - 0.5) / 0.5; col = (255, int(230 * g), int(150 - 150 * g))
            out[o:o + 4] = bytes(col + (int(25 + 205 * f),))
        open(p, 'wb').write(out)


def still(src, dst, ovl, heat_raw, texts, tmp):
    inputs = ['-i', src, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{W}x{H}', '-i', ovl]
    chain = f'[0:v]scale={W}:{H}:flags=lanczos,setsar=1,{GRADE}[b]'
    if heat_raw:
        gw, gh, hp = heat_raw
        inputs += ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{gw}x{gh}', '-i', hp]
        ox, oy = -int(S * 0.5 + (gw * S - W) / 2 * 0), 0
        chain += (f';[2:v]scale={int(gw * S)}:{int(gh * S)}:flags=bicubic,gblur=sigma=5,format=rgba[h];'
                  f'[b][h]overlay=0:0:format=auto[b]')
    chain += ';[b][1:v]overlay=0:0:format=auto'
    if texts:
        chain += ',' + ','.join(texts)
    ff(inputs + ['-filter_complex', chain, '-frames:v', '1', '-q:v', '2', dst])


def run(kind, lo, hi, out, still_png, src_fps=8):
    pos = load()
    t_lo = dt.datetime.strptime(lo, '%Y%m%d').replace(tzinfo=UTC)
    t_hi = dt.datetime.strptime(hi, '%Y%m%d').replace(tzinfo=UTC) + dt.timedelta(days=1)
    fr = frames('topdown', t_lo, t_hi, minute=0)
    tmp = f'tmp/td2-{kind}'
    shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    heat = Heat() if kind == 'heat' else None
    stills = []
    for j, (t, p) in enumerate(fr):
        c = Canvas(W, H)
        if kind == 'trails':
            trails(c, pos, t)
        else:
            heat.advance(pos, t)
        cur = current(pos, t)
        texts = markers(c, cur, tmp, j) + legend(c, cur, tmp)
        sub = 'bot trails: last 2 h' if kind == 'trails' else 'heat: time spent per block since 00:00 UTC'
        for k, (s, y, sz) in enumerate(((f'Day {day_no(t)}   {t:%a %d %b  %H:00} UTC', 22, 40), (sub, 74, 24))):
            texts.append(f"drawtext=fontfile={FONT}:textfile={txtfile(tmp, f'h{j}-{k}.txt', s)}:expansion=none:fontsize={sz}:"
                         f"fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=10:x=26:y={y}")
        ov = os.path.join(tmp, 'ov.rgba'); c.save(ov)
        hr = None
        if heat:
            hp = os.path.join(tmp, 'heat.rgba'); heat.save(hp); hr = (heat.gw, heat.gh, hp)
        d = os.path.join(tmp, f's{j:05d}.jpg')
        still(p, d, ov, hr, texts, tmp)
        stills.append(d)
    n = tl2.seq_with_holds(stills, os.path.join(tmp, 'seq'), src_fps, 1.0, 3.0)
    ff(['-framerate', str(src_fps), '-pattern_type', 'glob', '-i', os.path.join(tmp, 'seq', '*.jpg'), '-vf',
        'framerate=fps=30:interp_start=64:interp_end=192:scene=100,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow',
        '-crf', '21', '-movflags', '+faststart', out])
    pick = stills[int(len(stills) * 0.8)]                  # a busy daytime frame near the end for the still
    ff(['-i', pick, '-frames:v', '1', still_png])
    print({'kind': kind, 'frames': len(fr), 'seq': n, 'seconds': round(n / src_fps, 1), 'bytes': os.path.getsize(out), 'still': pick})


if __name__ == '__main__':
    run(*sys.argv[1:6])
