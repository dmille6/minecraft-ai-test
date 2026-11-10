#!/usr/bin/env python3
"""timelapse2-1110 samples. Runs on .30 in ~/tl2-1110 (nice 19, few threads). Read-only on every source.
Inputs (all copies): src/frames/<cam>/<day>/<stamp>.png (NAS + relayed from .40), build.tsv (_build place/clear rows),
pos.tsv (bot positions, 1/min/bot), cp.tsv (CoreProtect co_block break/place, world only), showchat-lines.jsonl.
Subcommands: project, beforeafter, topdown, reel, film."""
import datetime as dt, glob, json, math, os, re, shutil, subprocess, sys, collections

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
FONT_R = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
GRADE = ('eq=contrast=1.06:saturation=1.15:gamma=0.98,colorbalance=rh=0.035:gh=0.01:bh=-0.035:rs=-0.01:bs=0.02,'
         'vignette=angle=PI/7')
DAY1 = dt.date(2026, 10, 20)
OUT = 'out'
THREADS = os.environ.get('TL2_THREADS', '4')
NICE = ['nice', '-n', '19', 'ionice', '-c3']
ORTHO_K = 2 * math.tan(math.radians(37.5))     # BlueMap flat/ortho: visible height in blocks = distance * this (fitted: 7.4 px/block on topdown)
UTC = dt.timezone.utc


def ts(stamp):
    return dt.datetime.strptime(stamp[:14], '%Y%m%dT%H%MZ').replace(tzinfo=UTC)


def iso(s):
    return dt.datetime.strptime(s[:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=UTC)


def day_no(t):
    return (t.date() - DAY1).days + 1


def frames(cam, lo=None, hi=None, minute=None):
    out = []
    for p in sorted(glob.glob(f'src/frames/{cam}/*/*.png')):
        s = os.path.basename(p)[:-4]
        if 'event' in s or not re.match(r'^\d{8}T\d{4}Z$', s):
            continue
        t = ts(s)
        if (lo and t < lo) or (hi and t > hi) or (minute is not None and t.minute != minute):
            continue
        out.append((t, p))
    return out


def ff(args, **kw):
    return subprocess.run(NICE + ['ffmpeg', '-loglevel', 'error', '-y', '-threads', THREADS] + args, check=True, **kw)


def small_gray(p, w=320, h=180):
    return subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', p, '-vf', f'scale={w}:{h}:flags=area', '-f', 'rawvideo',
                           '-pix_fmt', 'gray', '-'], capture_output=True, check=True).stdout


def changed(a, b, level=12):
    return sum(1 for x, y in zip(a, b) if abs(x - y) > level) / max(1, len(a))


def ev_frames(cam, project, lo=None, hi=None):
    """The event frames (tl_event) of one project on one camera: <stamp>-event-<project>.png."""
    out = []
    for p in sorted(glob.glob(f'src/frames/{cam}/*/*-event-{project}.png')):
        t = ts(os.path.basename(p)[:14])
        if (lo and t < lo) or (hi and t > hi):
            continue
        out.append((t, p))
    return out


def chat():
    out = []
    for l in open('showchat-lines.jsonl'):
        try:
            r = json.loads(l)
            out.append((iso(r['t']), r['bot'].replace('showcase-', ''), r.get('cat'), r['text']))
        except (ValueError, KeyError):
            pass
    return out


def build_rows():
    out = []
    for l in open('build.tsv'):
        t, bot, p, op, x, y, z, b = l.rstrip('\n').split('\t')
        out.append((iso(t), bot, p, op, int(x), int(y), int(z), b))
    out.sort()
    return out


def txtfile(tmp, name, text):
    p = os.path.join(tmp, name)
    open(p, 'w').write(text)
    return p


def dt_filters(tmp, key, items, H):
    """items: [(text, x_expr, y_expr, size_frac, box?)] -> drawtext chain. Text goes through files (no escaping)."""
    fs = []
    for i, (text, x, y, sz, box) in enumerate(items):
        if not text:
            continue
        f = txtfile(tmp, f'{key}-{i}.txt', text)
        s = max(12, int(H * sz))
        fs.append(f"drawtext=fontfile={FONT}:textfile={f}:expansion=none:fontsize={s}:fontcolor=white:x={x}:y={y}"
                  + (f":box=1:boxcolor=black@0.55:boxborderw={max(6, s // 3)}" if box else ":shadowcolor=black@0.8:shadowx=2:shadowy=2"))
    return fs


def still(src, dst, W, H, texts, tmp, key, overlay_rgba=None, grade=True, extra=None, pre=None):
    """One composited still: scale/pad to WxH, optional raw RGBA overlay (same WxH), grade, text."""
    inputs = ['-i', src]
    chain = (f"[0:v]{pre}," if pre else "[0:v]") + f"scale={W}:{H}:force_original_aspect_ratio=decrease:flags=lanczos,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1"
    chain += (',' + GRADE) if grade else ''
    if extra:
        chain += ',' + extra
    if overlay_rgba:
        inputs += ['-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', f'{W}x{H}', '-i', overlay_rgba]
        chain += '[b];[b][1:v]overlay=0:0:format=auto'
    tf = dt_filters(tmp, key, texts, H)
    if tf:
        chain += ',' + ','.join(tf)
    ff(inputs + ['-filter_complex', chain, '-frames:v', '1', '-q:v', '2', dst])


def encode(seq_glob, src_fps, out, holds=None, dissolve=True):
    """jpg sequence -> 30 fps H.264 with the existing dissolve look (framerate interp 64..192)."""
    vf = f"framerate=fps=30:interp_start=64:interp_end=192:scene=100,format=yuv420p" if dissolve else 'fps=30,format=yuv420p'
    ff(['-framerate', str(src_fps), '-pattern_type', 'glob', '-i', seq_glob, '-vf', vf, '-c:v', 'libx264', '-preset', 'slow',
        '-crf', '18', '-movflags', '+faststart', out])


def seq_with_holds(stills, d, src_fps, first_s=1.0, last_s=3.0):
    """Copy stills into d as 000001.jpg... repeating the first/last for the holds."""
    os.makedirs(d, exist_ok=True)
    order = [stills[0]] * max(1, int(first_s * src_fps)) + stills[1:-1] + [stills[-1]] * max(1, int(last_s * src_fps))
    for i, s in enumerate(order):
        dst = os.path.join(d, f'{i:06d}.jpg')
        if os.path.exists(dst):
            os.remove(dst)
        os.link(s, dst)
    return len(order)


def wrap(s, n=70):
    return s if len(s) <= n else s[:n - 1] + '…'


class Canvas:
    """Raw RGBA overlay with alpha-over drawing (pure Python; no numpy on the hosts)."""
    def __init__(self, W, H):
        self.W, self.H, self.b = W, H, bytearray(W * H * 4)

    def rect(self, x0, y0, x1, y1, rgba):
        r, g, bb, a = rgba
        x0, y0, x1, y1 = max(0, int(x0)), max(0, int(y0)), min(self.W, int(x1)), min(self.H, int(y1))
        if x0 >= x1 or y0 >= y1:
            return
        for y in range(y0, y1):
            o = (y * self.W + x0) * 4
            for _ in range(x1 - x0):
                oa = self.b[o + 3]
                if a >= oa:
                    self.b[o:o + 4] = bytes((r, g, bb, a))
                o += 4

    def save(self, p):
        open(p, 'wb').write(self.b)


# ---------------------------------------------------------------- 1. project build clip (event-driven)
def cmd_project(cam, project, label, title, out, step_min=15, W=1920, H=1080, src_fps=3, pre=None):
    rows = [r for r in build_rows() if r[2] == project and r[3] == 'place']
    if not rows:
        raise SystemExit(f'no place rows for {project}')
    first, last = rows[0][0], rows[-1][0]
    lo_, hi_ = first - dt.timedelta(minutes=step_min + 1), last + dt.timedelta(minutes=2 * step_min + 1)
    fr = sorted(frames(cam, lo_, hi_) + ev_frames(cam, project, lo_, hi_))
    if cam == 'project4k':   # follow camera: only the frames framed on this project (sidecar label)
        fr = [(t, p) for t, p in fr if os.path.exists(p[:-4] + '.json') and json.load(open(p[:-4] + '.json')).get('project') == project]
    total = len(rows)
    lines = chat()
    kept, prev_t = [], None
    for i, (t, p) in enumerate(fr):
        n_before = sum(1 for r in rows if r[0] <= t)
        n_win = sum(1 for r in rows if (prev_t is None or r[0] > prev_t) and r[0] <= t)
        if not kept or n_win > 0 or i == len(fr) - 1:
            kept.append((t, p, n_before, n_win, prev_t))
            prev_t = t
    tmp = f'tmp/project-{project}'
    shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    stills = []
    for j, (t, p, nb, nw, pt) in enumerate(kept):
        builders = sorted({r[1] for r in rows if (pt is None or r[0] > pt) and r[0] <= t})
        cap = [f'{b}: {x}' for (tt, b, c, x) in lines if (pt or t - dt.timedelta(minutes=30)) < tt <= t and c not in ('stuck', 'death', 'ore')][-2:]
        pct = nb / total
        texts = [(title, 40, 36, 0.042, True),
                 (f'Day {day_no(t)}  {t:%d %b %H:%M} UTC', 40, 36 + int(H * 0.075), 0.026, True),
                 (f'{nb} / {total} blocks placed' + (f'   (+{nw} by {", ".join(builders)})' if nw and builders else ''), 40, f'h-{int(H*0.17)}', 0.028, True)]
        for k, c in enumerate(cap):
            texts.append((wrap(c, 90), 40, f'h-{int(H*0.11) - k*int(H*0.045)}', 0.024, True))
        ov = Canvas(W, H)
        bx0, by, bw = 40, H - 26, W - 80                                     # progress bar
        ov.rect(bx0, by, bx0 + bw, by + 12, (0, 0, 0, 140))
        ov.rect(bx0, by, bx0 + int(bw * pct), by + 12, (120, 220, 90, 230))
        ovp = os.path.join(tmp, f'ov{j}.rgba'); ov.save(ovp)
        dst = os.path.join(tmp, f's{j:05d}.jpg')
        still(p, dst, W, H, texts, tmp, f't{j}', overlay_rgba=ovp, pre=pre)
        os.remove(ovp)
        stills.append(dst)
    n = seq_with_holds(stills, os.path.join(tmp, 'seq'), src_fps, 1.0, 3.5)
    encode(os.path.join(tmp, 'seq', '*.jpg'), src_fps, out)
    meta = {'cam': cam, 'project': project, 'place_rows': total, 'first': first.isoformat(), 'last': last.isoformat(),
            'candidate_frames': len(fr), 'kept_frames': len(kept), 'seq_frames': n, 'src_fps': src_fps}
    json.dump(meta, open(out + '.json', 'w'), indent=1)
    print(json.dumps(meta))


# ---------------------------------------------------------------- 2. daily before / after
TRIVIAL = re.compile(r'leaves|short_grass|tall_grass|^fern|large_fern|snow$|vine|dandelion|poppy|bush|dead_bush|sweet_berry|seagrass|kelp|fire|water|lava')
def cmd_beforeafter(cam, a, b, dist, out_png, out_mp4, W=1920, H=1080, cx=0.5, cz=0.5, ymin=63):
    ta, tb = ts(a), ts(b)
    s = H / (dist * ORTHO_K)
    blocks = {}
    nall = collections.Counter()
    for l in open('cp.tsv'):
        t, u, act, x, y, z, m = l.rstrip('\n').split('\t')
        t = int(t)
        if not (ta.timestamp() <= t < tb.timestamp()) or not u.startswith('showcase-'):
            continue
        nall['place' if act == '1' else 'break'] += 1
        if int(y) < ymin or TRIVIAL.search(m):
            continue
        k = (int(x), int(y), int(z))
        e = blocks.setdefault(k, [act, act, m])
        e[1] = act
    col = {}
    for (x, y, z), (f, l_, m) in blocks.items():
        kind = 'p' if (f == '1' and l_ == '1') else 'r' if (f == '0' and l_ == '0') else 'c'
        c = col.setdefault((x, z), set()); c.add(kind)
    ov = Canvas(W, H)
    counts = collections.Counter()
    for (x, z), ks in col.items():
        k = 'p' if 'p' in ks and 'r' not in ks else 'r' if 'r' in ks and 'p' not in ks else 'c'
        counts[k] += 1
        rgba = {'p': (40, 230, 70, 165), 'r': (235, 40, 40, 165), 'c': (250, 200, 40, 150)}[k]
        px, pz = W / 2 + (x + 0.5 - cx) * s, H / 2 + (z + 0.5 - cz) * s
        ov.rect(px - s / 2, pz - s / 2, px + s / 2 + 1, pz + s / 2 + 1, rgba)
    br = collections.Counter(r[2] for r in build_rows() if r[3] == 'place' and ta <= r[0] < tb)
    busy = ', '.join(f'{p} +{n}' for p, n in br.most_common(4))
    summary = (f'{ta:%d %b %H:%M} -> {tb:%d %b %H:%M} UTC: bots placed {nall["place"]:,} and broke {nall["break"]:,} blocks '
               f'in all.\nOn the map (y>={ymin}, no leaves/grass/snow): {counts["p"]:,} columns built, {counts["r"]:,} cleared, {counts["c"]:,} changed.   Busiest projects: {busy}.')
    tmp = 'tmp/ba'; shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    fa, fb = f'src/frames/{cam}/{a[:8]}/{a}.png', f'src/frames/{cam}/{b[:8]}/{b}.png'
    ovp = os.path.join(tmp, 'ov.rgba'); ov.save(ovp)
    hw, hh = W // 2, H // 2
    sa, sb, sbo = [os.path.join(tmp, n) for n in ('a.jpg', 'b.jpg', 'bo.jpg')]
    still(fa, sa, W, H, [(f'BEFORE  Day {day_no(ta)}  {ta:%d %b %H:%M} UTC', 30, 30, 0.04, True)], tmp, 'a')
    still(fb, sb, W, H, [(f'AFTER  Day {day_no(tb)}  {tb:%d %b %H:%M} UTC', 30, 30, 0.04, True)], tmp, 'b')
    still(fb, sbo, W, H, [(f'AFTER + changes  (green built, red cleared, yellow changed)', 30, 30, 0.04, True)], tmp, 'bo', overlay_rgba=ovp)
    sumf = txtfile(tmp, 'sum.txt', summary)
    # side-by-side PNG (3 panels: before | after | after+changes) with the summary under it
    fsz = 26
    ff(['-i', sa, '-i', sb, '-i', sbo, '-filter_complex',
        f'[0]scale={hw}:-1[a];[1]scale={hw}:-1[b];[2]scale={hw}:-1[c];[a][b][c]hstack=3,pad=iw:ih+110:0:0:color=0x111111,'
        f'drawtext=fontfile={FONT_R}:textfile={sumf}:expansion=none:fontsize={fsz}:fontcolor=white:x=20:y=h-90:line_spacing=6',
        '-frames:v', '1', out_png])
    # 12-s clip: before (3 s) -> dissolve to after (3 s) -> changes fade in (4 s) -> hold
    ff(['-loop', '1', '-t', '4', '-i', sa, '-loop', '1', '-t', '4', '-i', sb, '-loop', '1', '-t', '6', '-i', sbo,
        '-filter_complex', '[0][1]xfade=transition=fade:duration=1.2:offset=2.8[x];[x][2]xfade=transition=fade:duration=1.5:offset=5.8,'
        f'scale={W}:{H},drawtext=fontfile={FONT_R}:textfile={sumf}:expansion=none:fontsize={int(H*0.021)}:fontcolor=white:'
        f'box=1:boxcolor=black@0.6:boxborderw=10:x=30:y=h-th-30,format=yuv420p',
        '-r', '30', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', out_mp4])
    meta = {'cam': cam, 'a': a, 'b': b, 'px_per_block': round(s, 3), 'cp_place': nall['place'], 'cp_break': nall['break'],
            'surface_columns': dict(counts), 'summary': summary}
    json.dump(meta, open(out_mp4 + '.json', 'w'), indent=1)
    print(json.dumps(meta))


# ---------------------------------------------------------------- 3. top-down map timelapse with bot trails
BOTC = [(255, 80, 80), (255, 170, 40), (250, 240, 60), (120, 230, 80), (60, 220, 200), (70, 160, 255), (150, 110, 255),
        (240, 90, 220), (255, 255, 255), (255, 130, 160), (180, 255, 150), (120, 200, 255), (255, 210, 140), (200, 160, 255), (160, 255, 230)]


def cmd_topdown(cam, dist, out, W=1920, H=1080, src_fps=15, trail_h=2.0, every_h=1):
    s = H / (dist * ORTHO_K)
    pos = collections.defaultdict(list)
    for l in open('pos.tsv'):
        t, bot, x, y, z = l.rstrip('\n').split('\t')
        pos[bot].append((iso(t), float(x), float(z)))
    bots = sorted(pos)
    for b in bots:
        pos[b].sort()
    color = {b: BOTC[i % len(BOTC)] for i, b in enumerate(bots)}
    pos_lo = min(v[0][0] for v in pos.values())
    fr = [(t, p) for t, p in frames(cam, minute=0) if t.hour % every_h == 0]
    tmp = f'tmp/topdown-{cam}'; shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    lines = chat()
    stills, prev_g, kept = [], None, 0
    for j, (t, p) in enumerate(fr):
        ov = None
        if t >= pos_lo:
            c = Canvas(W, H)
            lo = t - dt.timedelta(hours=trail_h)
            for b in bots:
                for (tt, x, z) in pos[b]:
                    if lo < tt <= t:
                        age = (t - tt).total_seconds() / (trail_h * 3600)
                        a = int(235 * (1 - age) + 20)
                        px, pz = W / 2 + (x - 0.5) * s, H / 2 + (z - 0.5) * s
                        r = 6 if age < 0.15 else 4 if age < 0.5 else 3
                        c.rect(px - r, pz - r, px + r, pz + r, color[b] + (a,))
            ov = os.path.join(tmp, 'ov.rgba'); c.save(ov)
        done = [x for (tt, b, cat, x) in lines if cat == 'project_done' and t - dt.timedelta(hours=6) < tt <= t]
        texts = [(f'Day {day_no(t)}   {t:%a %d %b  %H:00} UTC', 30, 28, 0.04, True),
                 ('bot trails: last 2 h' if ov else 'bot trails: no position log this early', 30, 28 + int(H * 0.07), 0.024, True)]
        if done:
            texts.append((wrap(done[-1], 60), 30, f'h-{int(H*0.09)}', 0.03, True))
        dst = os.path.join(tmp, f's{j:05d}.jpg')
        still(p, dst, W, H, texts, tmp, f't{j}', overlay_rgba=ov)
        stills.append(dst)
    n = seq_with_holds(stills, os.path.join(tmp, 'seq'), src_fps, 1.0, 3.0)
    encode(os.path.join(tmp, 'seq', '*.jpg'), src_fps, out)
    meta = {'cam': cam, 'frames': len(fr), 'first': fr[0][0].isoformat(), 'last': fr[-1][0].isoformat(), 'px_per_block': round(s, 3),
            'trails_from': pos_lo.isoformat(), 'src_fps': src_fps, 'seconds': round(n / src_fps, 1)}
    json.dump(meta, open(out + '.json', 'w'), indent=1)
    print(json.dumps(meta))


# ---------------------------------------------------------------- 4. 60-s daily highlight reel
LABELS = {'copperhall': 'Copper hall', 'iso': 'Town (iso)', 'grounds': 'Grounds', 'stair': 'Mine stair', 'paths': 'Paths',
          'wall': 'Town wall', 'treefarm': 'Tree farm', 'ziggurat': 'Ziggurat', 'house1': 'House 1', 'storehouse': 'Storehouse',
          'workshop': 'Workshop', 'town': 'Town (top)', 'expeditions': 'Expeditions', 'project4k': 'Active project',
          'hero4k': 'Town', 'patina': 'Copper patina', 'angled': 'Overview', 'topdown': 'Map'}


def activity(cam, day):
    cp = f'tmp/act-{cam}-{day:%Y%m%d}.json'
    if os.path.exists(cp):
        return [(dt.datetime.fromisoformat(t), p, f) for t, p, f in json.load(open(cp))]
    sc = _activity(cam, day)
    json.dump([(t.isoformat(), p, f) for t, p, f in sc], open(cp, 'w'))
    return sc


def _activity(cam, day):
    fr = frames(cam, day, day + dt.timedelta(days=1))
    g = [(t, p, small_gray(p)) for t, p in fr]
    sc = [(g[i][0], g[i][1], changed(g[i - 1][2], g[i][2]) if i else 0.0) for i in range(len(g))]
    return sc


REEL_EXCLUDE = {'topdown', 'angled', 'town', 'expeditions', 'patina', 'projectev', 'grounds'}


def reel_windows(cams, rows, day, hours=4):
    """Each camera's busiest `hours` window by `_build` PLACEMENTS of its projects (tl.conf `project`), not pixel change
    (owner 11-10). A follow camera counts every project it may follow (not excluded). rows: build rows
    (t, bot, project, op, ...). -> {cam: (count, lo, hi)} for cameras with any placement. Pure (tested)."""
    out = {}
    for c, cam in cams.items():
        if c in REEL_EXCLUDE or cam.get('event_only'):
            continue
        if cam.get('follow'):
            ex = set(cam.get('exclude') or ())
            ts = [r[0] for r in rows if r[3] == 'place' and r[2] not in ex]
        else:
            names = cam.get('project') or []
            names = {names} if isinstance(names, str) else set(names)
            ts = [r[0] for r in rows if r[3] == 'place' and r[2] in names]
        best = (0, None, None)
        for k in range(0, 24 * 4):
            lo = day + dt.timedelta(minutes=15 * k)
            n = sum(1 for t in ts if lo <= t < lo + dt.timedelta(hours=hours))
            if n > best[0]:
                best = (n, lo, lo + dt.timedelta(hours=hours))
        if best[0]:
            out[c] = best
    return out


def sidecar_changed(p):
    try:
        return json.load(open(p[:-4] + '.json')).get('changed')
    except (OSError, ValueError, AttributeError):
        return None


def cmd_reel(day_s, out, trails_mp4=None, W=1920, H=1080, seg_s=10.0, n_seg=4):
    """The 60-s daily reel: the town (hero4k) day, the trails map of the day, then the n_seg cameras with the most
    placements, each in its busiest 4-h window; frames deduplicated by the capture sidecar's `changed` score (no PNG
    decode); the bots' own captions; the next morning's Chunky still."""
    day = dt.datetime.strptime(day_s, '%Y%m%d').replace(tzinfo=UTC)
    cams = json.load(open('cameras.json'))
    rows = [r for r in build_rows() if day <= r[0] < day + dt.timedelta(days=1)]
    win = reel_windows(cams, rows, day)
    rank = sorted(win, key=lambda c: -win[c][0])[:n_seg]
    rank.sort(key=lambda c: win[c][1])
    lines = chat()
    br = collections.Counter(r[2] for r in rows if r[3] == 'place')
    done = [x for (tt, b, c, x) in lines if c == 'project_done' and day <= tt < day + dt.timedelta(days=1)]
    tmp = 'tmp/reel'; shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    parts, info = [], {}

    def segment(cam, lo, hi, title, sub, key, secs):
        fr = frames(cam, lo, hi)
        keep = [(t, p) for i, (t, p) in enumerate(fr) if i in (0, len(fr) - 1) or (sidecar_changed(p) or 1.0) >= 0.002]
        if len(keep) < 2:
            return 0
        fps = max(0.7, len(keep) / max(1.0, secs - 1.5))
        st = []
        for j, (t, p) in enumerate(keep):
            cap = [f'{b}: {x}' for (tt, b, c, x) in lines if t - dt.timedelta(minutes=30) < tt <= t and c not in ('stuck', 'death')][-2:]
            texts = [(title, 40, 36, 0.045, True), (f'{sub}   {t:%H:%M} UTC', 40, 36 + int(H * 0.08), 0.026, True)]
            for k, c in enumerate(cap):
                texts.append((wrap(c, 90), 40, f'h-{int(H*0.07) + k*int(H*0.05)}', 0.026, True))
            d = os.path.join(tmp, f'{key}-{j:04d}.jpg')
            still(p, d, W, H, texts, tmp, f'{key}{j}', pre="crop=iw:'min(ih,iw*9/16)'")
            st.append(d)
        sd = os.path.join(tmp, f'seq-{key}')
        seq_with_holds(st, sd, fps, 0.6, 0.9)
        o = os.path.join(tmp, f'{key}.mp4')
        encode(os.path.join(sd, '*.jpg'), round(fps, 3), o)
        parts.append(o)
        return len(keep)
    hero = 'hero4k' if frames('hero4k', day, day + dt.timedelta(days=1)) else 'iso'
    info[hero] = segment(hero, day, day + dt.timedelta(days=1), f'Showcase  Day {day_no(day)}  {day:%a %d %b %Y}',
                         f'{sum(br.values()):,} blocks placed by the bots' + (f', {len(done)} finished' if done else ''), 'a0', 9.5)
    if trails_mp4 and os.path.exists(trails_mp4):
        o = os.path.join(tmp, 'a0trails.mp4')
        ff(['-i', trails_mp4, '-t', '9', '-vf', f'scale={W}:{H},format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', o])
        parts.append(o)
        info['trails_map'] = True
    for i, c in enumerate(rank):
        n, lo, hi = win[c]
        info[c] = segment(c, lo, hi, LABELS.get(c, c), f'{lo:%H:%M}-{hi:%H:%M}  {n} blocks placed', f'a{i+1}', seg_s)
    beauty = os.path.expanduser(f'~/chunky-beauty/frames/{(day + dt.timedelta(days=1)):%Y-%m-%d}/town.png')
    if os.path.exists(beauty):
        bo = os.path.join(tmp, 'beauty.jpg')
        still(beauty, bo, W, H, [(f'End of day {day_no(day)}  (Chunky, golden hour)', 90, 60, 0.04, True),
                                 (wrap('Busiest: ' + ', '.join(f'{p} +{n}' for p, n in br.most_common(4)), 90), 90, 'h-110', 0.026, True)], tmp, 'bo', grade=False)
        o = os.path.join(tmp, 'zz.mp4')
        ff(['-i', bo, '-vf', "zoompan=z='1+0.0003*on':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=150:s=%dx%d:fps=30,format=yuv420p" % (W, H),
            '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', o])
        parts.append(o)
    if not parts:
        print(json.dumps({'reel': day_s, 'skip': 'no frames'}))
        return
    concat_xfade(parts, out)
    meta = {'day': day_s, 'segments': info, 'windows': {c: [win[c][1].isoformat(), win[c][0]] for c in rank}, 'parts': len(parts),
            'seconds': round(dur(out), 1)}
    json.dump(meta, open(out + '.json', 'w'), indent=1)
    print(json.dumps(meta))


def dur(p):
    return float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p],
                                capture_output=True, text=True).stdout.strip())


def concat_xfade(parts, out, fade=0.6):
    if len(parts) == 1:
        shutil.copy(parts[0], out); return
    args, chain, off, last = [], [], 0.0, '[0:v]'
    for p in parts:
        args += ['-i', p]
    for i in range(1, len(parts)):
        off += dur(parts[i - 1]) - fade
        lab = f'[x{i}]'
        chain.append(f'{last}[{i}:v]xfade=transition=fade:duration={fade}:offset={off:.3f}{lab}')
        last = lab
    ff(args + ['-filter_complex', ';'.join(chain) + f';{last}format=yuv420p[o]', '-map', '[o]', '-c:v', 'libx264',
               '-preset', 'slow', '-crf', '18', '-movflags', '+faststart', out])


# ---------------------------------------------------------------- 5. "from day 1" short cut
def card(text, sub, out, W=1920, H=1080, secs=3.0, tmp='tmp/film'):
    os.makedirs(tmp, exist_ok=True)
    f1, f2 = txtfile(tmp, os.path.basename(out) + '1.txt', text), txtfile(tmp, os.path.basename(out) + '2.txt', sub)
    ff(['-f', 'lavfi', '-i', f'color=c=0x101418:s={W}x{H}:d={secs}:r=30', '-vf',
        f'drawtext=fontfile={FONT}:textfile={f1}:expansion=none:fontsize={int(H*0.07)}:fontcolor=white:x=(w-tw)/2:y=h*0.38,'
        f'drawtext=fontfile={FONT_R}:textfile={f2}:expansion=none:fontsize={int(H*0.032)}:fontcolor=0xd8d8d8:x=(w-tw)/2:y=h*0.52,'
        f'fade=t=in:d=0.5,fade=t=out:st={secs-0.5}:d=0.5,format=yuv420p', '-c:v', 'libx264', '-crf', '18', out])
    return out


def cmd_film(out, W=1920, H=1080):
    tmp = 'tmp/film'; shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    lines = chat()
    dones = sorted({(tt.date(), x) for (tt, b, c, x) in lines if c == 'project_done' and 'tidy' not in x and 'decor' not in x})
    parts = [card('The Showcase', 'From day 1 (20 Oct 2026) to today', os.path.join(tmp, 'c0.mp4'), secs=3.5)]
    # A: the overview camera, every 2 h, all days, dedup'd; day counter + finished projects
    fr = [(t, p) for t, p in frames('angled', minute=0) if t.hour % 2 == 0]
    st, prev = [], None
    for j, (t, p) in enumerate(fr):
        g = small_gray(p)
        if prev is not None and changed(prev, g) < 0.004 and j != len(fr) - 1:
            continue
        prev = g
        dn = [x for (d, x) in dones if d == t.date()]
        texts = [(f'Day {day_no(t)}', 40, 36, 0.06, True), (f'{t:%d %b %Y}', 40, 36 + int(H * 0.1), 0.028, True)]
        if dn:
            texts.append((wrap(' / '.join(dn), 90), 40, 'h-80', 0.03, True))
        d = os.path.join(tmp, f'A{j:05d}.jpg'); still(p, d, W, H, texts, tmp, f'A{j}'); st.append(d)
    seq_with_holds(st, os.path.join(tmp, 'seqA'), 8, 0.8, 1.5)
    encode(os.path.join(tmp, 'seqA', '*.jpg'), 8, os.path.join(tmp, 'A.mp4')); nA = len(st)
    parts.append(os.path.join(tmp, 'A.mp4'))
    parts.append(card('Since 7 Nov: the 4K town camera', 'every 30 min, the town from the south-east', os.path.join(tmp, 'c1.mp4'), secs=2.5))
    # B: hero4k hourly
    st = []
    for j, (t, p) in enumerate(frames('hero4k', minute=0)):
        d = os.path.join(tmp, f'B{j:05d}.jpg'); still(p, d, W, H, [(f'Day {day_no(t)}  {t:%d %b %H:%M} UTC', 40, 36, 0.035, True)], tmp, f'B{j}'); st.append(d)
    seq_with_holds(st, os.path.join(tmp, 'seqB'), 6, 0.5, 1.5)
    encode(os.path.join(tmp, 'seqB', '*.jpg'), 6, os.path.join(tmp, 'B.mp4')); nB = len(st)
    parts.append(os.path.join(tmp, 'B.mp4'))
    # C: the nightly Chunky beauty frames, 2 s each
    bs = sorted(glob.glob(os.path.expanduser('~/chunky-beauty/frames/*/town.png')))
    st = []
    for j, p in enumerate(bs):
        day = os.path.basename(os.path.dirname(p))
        d = os.path.join(tmp, f'C{j:05d}.jpg'); still(p, d, W, H, [(f'Golden hour  {day}', 40, 36, 0.035, True)], tmp, f'C{j}', grade=False); st.append(d)
    if st:
        seq_with_holds(st, os.path.join(tmp, 'seqC'), 0.5, 2, 3)
        encode(os.path.join(tmp, 'seqC', '*.jpg'), 0.5, os.path.join(tmp, 'C.mp4'))
        parts.append(os.path.join(tmp, 'C.mp4'))
    concat_xfade(parts, out)
    meta = {'angled_kept': nA, 'hero4k': nB, 'beauty': len(st), 'seconds': round(dur(out), 1)}
    json.dump(meta, open(out + '.json', 'w'), indent=1)
    print(json.dumps(meta))


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    c, a = sys.argv[1], sys.argv[2:]
    if c == 'project':
        cmd_project(a[0], a[1], a[2], a[3], a[4], step_min=int(a[5]) if len(a) > 5 else 15, pre=a[6] if len(a) > 6 else None)
    elif c == 'beforeafter':
        cmd_beforeafter(a[0], a[1], a[2], float(a[3]), a[4], a[5], W=int(a[6]), H=int(a[7]))
    elif c == 'topdown':
        cmd_topdown(a[0], float(a[1]), a[2])
    elif c == 'reel':
        cmd_reel(a[0], a[1], a[2] if len(a) > 2 else None)
    elif c == 'film':
        cmd_film(a[0])
