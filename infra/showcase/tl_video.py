#!/usr/bin/env python3
"""Showcase timelapse videos from the stored frames (docs/reports/showcase-2026-10-20.md section 6).

    tl_video.py daily   [--day YYYY-MM-DD]      every frame of that UTC day (default: yesterday)
    tl_video.py weekly  [--week-ending YYYY-MM-DD]  one frame per hour, the 7 days ending that day
    tl_video.py history                          one frame per hour, frame 0 to now
    tl_video.py monthly [--month YYYY-MM]        one frame per 4 h (default: last month; skipped while it has no frames)

SAMPLING is per BUCKET: the first frame whose stamp falls inside [bucket start, bucket end); an empty bucket
contributes nothing (it is not borrowed from a neighbour). Event frames (stamp-event-*) are never sampled.
NO-CHANGE SKIP, IN THE VIDEO ONLY: each candidate is downscaled to 320x180 grayscale (ffmpeg) and compared with the
last INCLUDED frame -- on the raw frames, before any overlay; it is dropped from this video when fewer than
MIN_CHANGED_FRAC of its pixels moved by more than LEVEL. The first and last candidates are always kept. Frames on
disk are never touched. Each video gets a .json sidecar: candidates, included, skipped_nochange, thresholds.
Both views are built; a view with no candidates is reported, not an error.
CAPTIONS (showchat-01, comms design 5.2 / owner C8): the bots' chat announcements (bots/src/showchat.mjs appends every spoken line
to TL_CHAT, the pool's showchat-lines.jsonl) are overlaid on the INCLUDED frames at encode time: up to CAPTION_LINES lines
spoken since the previous included frame (tier 1 first, then newest), bottom-left, and the UTC day's running tally top-left.
Frames on disk are untouched; no lines (or no file) -> the frame is drawn exactly as before.
    tl_video.py frame <view> <stamp> <out.png>   one captioned frame (a check of the overlay, nothing else written)
"""
import argparse, datetime as dt, json, os, subprocess, sys, tempfile

ROOT = os.environ.get('TL_ROOT', '/srv/showcase/timelapse')
VIEWS = ('angled', 'topdown')
EXTRA = ("town", "iso", "workshop", "house1", "ziggurat", "paths", "wall", "treefarm", "expeditions", "storehouse")    # owner 10-25: the town close-up; built from ITS OWN frames (it is not part of the pair)
FPS = 10
LEVEL = 12
MIN_CHANGED_FRAC = 0.002
SMALL = (320, 180)
NICE = ['nice', '-n', '19', 'ionice', '-c3']
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
CAPTION_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
TL_CHAT = os.environ.get('TL_CHAT', '/var/lib/mcai/_pool-showcase/showchat-lines.jsonl')
CAPTION_LINES = 2
CAPTION_MAX_CHARS = 96
FIRST_LOOKBACK_MIN = 15      # the first included frame shows the lines of the 15 min before it (one capture)
TALLY_CATS = (('project_done', 'project finished', 'projects finished'), ('section', 'section built', 'sections built'),
              ('ore', 'ore find', 'ore finds'), ('expedition_back', 'expedition home', 'expeditions home'),
              ('deposit', 'load stored', 'loads stored'), ('death', 'death', 'deaths'))


def load_lines(path=TL_CHAT):
    """The spoken lines (path and its rotated .1) -> [(datetime, bot, tier, cat, text)] sorted. A missing or bad line is skipped."""
    out = []
    for p in (path + '.1', path):
        try:
            f = open(p, errors='replace')
        except OSError:
            continue
        with f:
            for line in f:
                try:
                    r = json.loads(line)
                    t = dt.datetime.strptime(r['t'][:19], '%Y-%m-%dT%H:%M:%S').replace(tzinfo=dt.timezone.utc)
                    out.append((t, str(r.get('bot', '')), int(r.get('tier', 3)), str(r.get('cat', '')), str(r.get('text', ''))))
                except (ValueError, KeyError, TypeError):
                    continue
    return sorted(out)


def caption_text(bot, text):
    """'showcase-Juno', 'The storehouse is finished!' -> 'Juno: The storehouse is finished!' (ASCII, one line, capped). Pure."""
    who = bot[len('showcase-'):] if bot.startswith('showcase-') else bot
    s = ''.join(c for c in f'{who}: {text}' if 32 <= ord(c) < 127)
    return s if len(s) <= CAPTION_MAX_CHARS else s[:CAPTION_MAX_CHARS - 3] + '...'


def captions(stamps, lines, n=CAPTION_LINES, first_min=FIRST_LOOKBACK_MIN):
    """For each stamp (the INCLUDED frames, in order) -> [caption strings]: the lines spoken in (previous stamp, this stamp],
    tier 1 first then newest, at most n, shown oldest-first. Pure (tested)."""
    out, prev = [], None
    for s in stamps:
        t = parse_stamp(s)
        if t is None:
            out.append([])
            continue
        lo = prev if prev is not None else t - dt.timedelta(minutes=first_min)
        win = [l for l in lines if lo < l[0] <= t]
        pick = sorted(win, key=lambda l: (l[2], -l[0].timestamp()))[:n]
        out.append([caption_text(l[1], l[4]) for l in sorted(pick)])
        prev = t
    return out


def tally(lines, t):
    """The UTC day's running tally at time t -> 'Nov 01 so far: 1 project finished, 3 sections built' or ''. Pure (tested)."""
    day0 = dt.datetime(t.year, t.month, t.day, tzinfo=dt.timezone.utc)
    cnt = {}
    for l in lines:
        if day0 <= l[0] <= t:
            cnt[l[3]] = cnt.get(l[3], 0) + 1
    parts = [f'{cnt[c]} {one if cnt[c] == 1 else many}' for c, one, many in TALLY_CATS if cnt.get(c)]
    return f"{t.strftime('%b %d')} so far: " + ', '.join(parts) if parts else ''


def overlay_filter(stamp_text, cap, day, tmp, i):
    """The -vf chain for one frame: the stamp (as before) + the caption lines + the tally, each from a TEXT FILE (no escaping of
    the bots' words; expansion=none so a '%' is literal). Writes the files into tmp. -> filter string."""
    vf = [f"drawtext=fontfile={FONT}:text='{stamp_text}':x=w-tw-28:y=h-th-28:fontsize=36:"
          "fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=12"]
    for j, line in enumerate(reversed(cap)):          # the newest line sits lowest
        f = os.path.join(tmp, f'cap{i:06d}_{j}.txt')
        with open(f, 'w') as fh:
            fh.write(line)
        vf.append(f"drawtext=fontfile={CAPTION_FONT}:textfile={f}:expansion=none:x=28:y=h-th-{110 + 62 * j}:fontsize=34:"
                  "fontcolor=white:box=1:boxcolor=black@0.6:boxborderw=12")
    if day:
        f = os.path.join(tmp, f'tally{i:06d}.txt')
        with open(f, 'w') as fh:
            fh.write(day)
        vf.append(f"drawtext=fontfile={CAPTION_FONT}:textfile={f}:expansion=none:x=28:y=28:fontsize=30:"
                  "fontcolor=white:box=1:boxcolor=black@0.5:boxborderw=10")
    return ','.join(vf)


def parse_stamp(s):
    if '-event-' in s:
        return None
    try:
        return dt.datetime.strptime(s[:14], '%Y%m%dT%H%MZ').replace(tzinfo=dt.timezone.utc)
    except ValueError:
        return None


def sample(stamps, lo, hi, bucket_min):
    """First regular frame per bucket in [lo, hi). bucket_min=None keeps every regular frame. Pure (tested)."""
    out, seen = [], set()
    for s in sorted(stamps):
        t = parse_stamp(s)
        if t is None or not (lo <= t < hi):
            continue
        if bucket_min is None:
            out.append(s)
            continue
        k = int((t - lo).total_seconds() // (bucket_min * 60))
        if k not in seen:
            seen.add(k)
            out.append(s)
    return out


def changed_fraction(a, b, level=LEVEL):
    """Fraction of pixels (two equal-length grayscale byte strings) that differ by more than `level`. Pure."""
    if len(a) != len(b) or not a:
        return 1.0
    n = sum(1 for x, y in zip(a, b) if abs(x - y) > level)
    return n / len(a)


def dedup(candidates, load, level=LEVEL, min_frac=MIN_CHANGED_FRAC):
    """-> (kept, skipped). load(stamp) returns the small grayscale bytes. First and last always kept. Pure given
    `load` (tested)."""
    if len(candidates) <= 2:
        return list(candidates), 0
    kept, ref, skipped = [candidates[0]], load(candidates[0]), 0
    for s in candidates[1:-1]:
        cur = load(s)
        if changed_fraction(ref, cur, level) >= min_frac:
            kept.append(s)
            ref = cur
        else:
            skipped += 1
    kept.append(candidates[-1])
    return kept, skipped


def small_gray(path):
    p = subprocess.run(NICE + ['ffmpeg', '-loglevel', 'error', '-i', path, '-vf',
                               f'scale={SMALL[0]}:{SMALL[1]},format=gray', '-f', 'rawvideo', '-'],
                       capture_output=True)
    return p.stdout if p.returncode == 0 else b''


def build(view, stamps, out_mp4, label):
    os.makedirs(os.path.dirname(out_mp4), exist_ok=True)
    side = {'view': view, 'label': label, 'candidates': len(stamps), 'fps': FPS, 'level': LEVEL,
            'min_changed_frac': MIN_CHANGED_FRAC}
    if not stamps:
        side.update(included=0, skipped_nochange=0, note='no frames in range')
        json.dump(side, open(out_mp4 + '.json', 'w'), indent=1)
        return side
    kept, skipped = dedup(stamps, lambda s: small_gray(frame_path(ROOT, view, s)))
    lines = load_lines()
    caps = captions(kept, lines)
    with tempfile.TemporaryDirectory(dir=os.path.join(ROOT, 'video')) as tmp:
        for i, s in enumerate(kept, 1):
            text = f"showcase {view}  {s[0:4]}-{s[4:6]}-{s[6:8]} {s[9:11]}\\:{s[11:13]} UTC"
            vf = overlay_filter(text, caps[i - 1], tally(lines, parse_stamp(s)), tmp, i)
            subprocess.run(NICE + ['ffmpeg', '-loglevel', 'error', '-y', '-i', frame_path(ROOT, view, s),
                                   '-vf', vf, os.path.join(tmp, '%06d.png' % i)], check=True)
        # hold the last frame ~2 s so the finished state is readable
        last = os.path.join(tmp, '%06d.png' % len(kept))
        for j in range(1, 2 * FPS + 1):
            os.symlink(last, os.path.join(tmp, '%06d.png' % (len(kept) + j)))
        part = out_mp4 + '.part.mp4'
        subprocess.run(NICE + ['ffmpeg', '-loglevel', 'error', '-y', '-framerate', str(FPS), '-i',
                               os.path.join(tmp, '%06d.png'), '-c:v', 'libx264', '-preset', 'slow', '-crf', '20',
                               '-pix_fmt', 'yuv420p', '-movflags', '+faststart', part], check=True)
        os.replace(part, out_mp4)
    side.update(included=len(kept), skipped_nochange=skipped, first=kept[0], last=kept[-1],
                bytes=os.path.getsize(out_mp4), captioned=sum(1 for c in caps if c), chat_lines=len(lines))
    json.dump(side, open(out_mp4 + '.json', 'w'), indent=1)
    return side


def frame_path(root, view, stamp):
    return os.path.join(root, 'frames', view, stamp[:8], stamp + '.png')    # same layout as tl_showcase.frame_path


def all_stamps(view):
    d = os.path.join(ROOT, 'frames', view)
    out = []
    if os.path.isdir(d):
        for day in os.listdir(d):
            if os.path.isdir(os.path.join(d, day)):
                out += [f[:-4] for f in os.listdir(os.path.join(d, day)) if f.endswith('.png')]
    return sorted(out)


def paired_stamps():
    """Readers use only stamps present in BOTH views (a pair is published together or not at all)."""
    return sorted(set(all_stamps('angled')) & set(all_stamps('topdown')))


def window(kind, a, now):
    """-> (lo, hi, bucket_min, name) for a video kind. Pure (tested)."""
    utc = dt.timezone.utc
    if kind == 'daily':
        day = dt.date.fromisoformat(a.day) if a.day else (now - dt.timedelta(days=1)).date()
        lo = dt.datetime(day.year, day.month, day.day, tzinfo=utc)
        return lo, lo + dt.timedelta(days=1), None, f'daily/{day.isoformat()}'
    if kind == 'weekly':
        end = dt.date.fromisoformat(a.week_ending) if a.week_ending else (now - dt.timedelta(days=1)).date()
        hi = dt.datetime(end.year, end.month, end.day, tzinfo=utc) + dt.timedelta(days=1)
        return hi - dt.timedelta(days=7), hi, 60, f'weekly/week-ending-{end.isoformat()}'
    if kind == 'monthly':
        if a.month:
            y, m = map(int, a.month.split('-'))
        else:
            first = dt.date(now.year, now.month, 1) - dt.timedelta(days=1)
            y, m = first.year, first.month
        lo = dt.datetime(y, m, 1, tzinfo=utc)
        hi = dt.datetime(y + (m == 12), (m % 12) + 1, 1, tzinfo=utc)
        return lo, hi, 240, f'monthly/{y:04d}-{m:02d}'
    if kind == 'history':
        return dt.datetime(2000, 1, 1, tzinfo=utc), now, 60, 'history'
    raise ValueError(kind)


def frame_one(view, stamp, out):
    """`frame <view> <stamp> <out.png>`: one frame with the overlay a video would give it (lookback FIRST_LOOKBACK_MIN)."""
    lines = load_lines()
    cap = captions([stamp], lines)[0]
    with tempfile.TemporaryDirectory() as tmp:
        text = f"showcase {view}  {stamp[0:4]}-{stamp[4:6]}-{stamp[6:8]} {stamp[9:11]}\\:{stamp[11:13]} UTC"
        vf = overlay_filter(text, cap, tally(lines, parse_stamp(stamp)), tmp, 0)
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', frame_path(ROOT, view, stamp), '-vf', vf, out], check=True)
    print(json.dumps({'view': view, 'stamp': stamp, 'out': out, 'caption': cap, 'tally': tally(lines, parse_stamp(stamp))}))
    return 0


def main():
    if len(sys.argv) == 5 and sys.argv[1] == 'frame':
        return frame_one(sys.argv[2], sys.argv[3], sys.argv[4])
    ap = argparse.ArgumentParser()
    ap.add_argument('kind', choices=['daily', 'weekly', 'history', 'monthly'])
    ap.add_argument('--day')
    ap.add_argument('--week-ending')
    ap.add_argument('--month')
    a = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    lo, hi, bucket, name = window(a.kind, a, now)
    if a.kind == 'monthly' and not sample(paired_stamps(), lo, hi, bucket) and \
            not any(sample(all_stamps(x), lo, hi, bucket) for x in EXTRA):     # a town-only month is still built (review P2)
        print(f'monthly {name}: SKIP -- no frames in that month yet')
        return 0
    rc = 0
    for v in VIEWS + tuple(x for x in EXTRA if all_stamps(x)):
        st = sample(paired_stamps() if v in VIEWS else all_stamps(v), lo, hi, bucket)
        try:
            side = build(v, st, os.path.join(ROOT, 'video', f'{name}-{v}.mp4'), name)
            print(json.dumps(side))
        except subprocess.CalledProcessError as e:
            print(json.dumps({'view': v, 'label': name, 'error': str(e)[:300]}))
            rc = 1
    return rc


if __name__ == '__main__':
    sys.exit(main())
