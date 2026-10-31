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
"""
import argparse, datetime as dt, json, os, subprocess, sys, tempfile

ROOT = os.environ.get('TL_ROOT', '/srv/showcase/timelapse')
VIEWS = ('angled', 'topdown')
EXTRA = ("town", "iso", "workshop", "house1", "ziggurat", "paths", "wall", "treefarm", "expeditions")    # owner 10-25: the town close-up; built from ITS OWN frames (it is not part of the pair)
FPS = 10
LEVEL = 12
MIN_CHANGED_FRAC = 0.002
SMALL = (320, 180)
NICE = ['nice', '-n', '19', 'ionice', '-c3']
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'


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
    with tempfile.TemporaryDirectory(dir=os.path.join(ROOT, 'video')) as tmp:
        for i, s in enumerate(kept, 1):
            text = f"showcase {view}  {s[0:4]}-{s[4:6]}-{s[6:8]} {s[9:11]}\\:{s[11:13]} UTC"
            subprocess.run(NICE + ['ffmpeg', '-loglevel', 'error', '-y', '-i', frame_path(ROOT, view, s),
                                   '-vf', f"drawtext=fontfile={FONT}:text='{text}':x=w-tw-28:y=h-th-28:fontsize=36:"
                                          "fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=12",
                                   os.path.join(tmp, '%06d.png' % i)], check=True)
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
                bytes=os.path.getsize(out_mp4))
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


def main():
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
