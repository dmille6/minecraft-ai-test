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
PLAYBACK (tlvideo-01, owner 11-03 "better showcase videos"): each clip runs at OUT_FPS with a short linear DISSOLVE between
stored frames (ffmpeg `framerate` blend, no optical flow: building changes would grow invented motion). The source rate
fits the clip to about TARGET_S seconds (src_fps_for: never faster than MAX_SRC_FPS, never slower than MIN_SRC_FPS).
REEL: `daily` also builds daily/<day>-reel.mp4, the angled overview plus the most active views of the day (plan_reel), each
sped to fit REEL_SEG_S with a title. RETENTION: `tl_video.py thin [--apply]` keeps every frame of the last RETAIN_FULL_DAYS
days and the first frame of each UTC hour (what weekly/history/monthly sample) before that; it acts only below
THIN_BELOW_FREE_GB free, and the NAS keeps every frame (showcase-pull.sh, nightly).
"""
import argparse, datetime as dt, json, os, subprocess, sys, tempfile

ROOT = os.environ.get('TL_ROOT', '/srv/showcase/timelapse')
VIEWS = ('angled', 'topdown')
EXTRA = ("town", "iso", "workshop", "house1", "ziggurat", "paths", "wall", "treefarm", "expeditions", "storehouse", "copperhall", "patina", "grounds")    # owner 10-25: the town close-up; built from ITS OWN frames (it is not part of the pair)
FPS = 10                     # the source-rate ceiling of the hourly-sampled videos (weekly/history/monthly)
OUT_FPS = 30                 # every clip is encoded at this rate; the dissolve fills the frames between stored frames
TARGET_S = 20                # a daily clip aims for about this long (before the holds)
MIN_SRC_FPS, MAX_SRC_FPS = 2.0, 8.0
HOLD_FIRST_S, HOLD_LAST_S = 0.5, 2.5
BLEND = (64, 192)            # framerate interp_start/interp_end: the middle half of each step dissolves, the rest holds
REEL_SEG_S = 9.0
REEL_VIEWS = 4               # the overview + this many of the day's most active other views
RETAIN_FULL_DAYS = 14
THIN_BELOW_FREE_GB = 80
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
    kept, skipped, _ = dedup_scored(candidates, load, level, min_frac)
    return kept, skipped


def dedup_scored(candidates, load, level=LEVEL, min_frac=MIN_CHANGED_FRAC):
    """dedup + ACTIVITY: the summed changed fraction between consecutive kept frames (the reel ranks views by it).
    -> (kept, skipped, activity). Pure given `load` (tested)."""
    if len(candidates) <= 2:
        if len(candidates) == 2:
            return list(candidates), 0, round(changed_fraction(load(candidates[0]), load(candidates[1]), level), 5)
        return list(candidates), 0, 0.0
    kept, ref, skipped, act = [candidates[0]], load(candidates[0]), 0, 0.0
    for s in candidates[1:-1]:
        cur = load(s)
        f = changed_fraction(ref, cur, level)
        if f >= min_frac:
            kept.append(s)
            act += f
            ref = cur
        else:
            skipped += 1
    act += changed_fraction(ref, load(candidates[-1]), level)
    kept.append(candidates[-1])
    return kept, skipped, round(act, 5)


def src_fps_for(n, target_s=TARGET_S, lo=MIN_SRC_FPS, hi=MAX_SRC_FPS):
    """Stored frames per second of clip for n kept frames: about target_s seconds, clamped to [lo, hi]. Pure (tested)."""
    return round(min(hi, max(lo, n / float(target_s))), 3)


def encode_cmd(frames_glob, src_fps, out, out_fps=OUT_FPS, blend=BLEND):
    """The ffmpeg command for one clip: stored frames at src_fps, linear dissolve up to out_fps (no scene-cut detection:
    a project appearing is the point, not a cut). Pure (tested)."""
    vf = f'framerate=fps={out_fps}:interp_start={blend[0]}:interp_end={blend[1]}:scene=100'
    return NICE + ['ffmpeg', '-loglevel', 'error', '-y', '-framerate', str(src_fps), '-i', frames_glob, '-vf', vf,
                   '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-threads', '2', '-pix_fmt', 'yuv420p',
                   '-movflags', '+faststart', out]


def small_gray(path):
    p = subprocess.run(NICE + ['ffmpeg', '-loglevel', 'error', '-i', path, '-vf',
                               f'scale={SMALL[0]}:{SMALL[1]},format=gray', '-f', 'rawvideo', '-'],
                       capture_output=True)
    return p.stdout if p.returncode == 0 else b''


def build(view, stamps, out_mp4, label, max_src_fps=MAX_SRC_FPS):
    os.makedirs(os.path.dirname(out_mp4), exist_ok=True)
    side = {'view': view, 'label': label, 'candidates': len(stamps), 'fps': OUT_FPS, 'level': LEVEL,
            'min_changed_frac': MIN_CHANGED_FRAC}
    if not stamps:
        side.update(included=0, skipped_nochange=0, note='no frames in range')
        json.dump(side, open(out_mp4 + '.json', 'w'), indent=1)
        return side
    kept, skipped, activity = dedup_scored(stamps, lambda s: small_gray(frame_path(ROOT, view, s)))
    src = src_fps_for(len(kept), hi=max_src_fps)
    lines = load_lines()
    caps = captions(kept, lines)
    with tempfile.TemporaryDirectory(dir=os.path.join(ROOT, 'video')) as tmp:
        for i, s in enumerate(kept, 1):
            text = f"showcase {view}  {s[0:4]}-{s[4:6]}-{s[6:8]} {s[9:11]}\\:{s[11:13]} UTC"
            vf = overlay_filter(text, caps[i - 1], tally(lines, parse_stamp(s)), tmp, i)
            subprocess.run(NICE + ['ffmpeg', '-loglevel', 'error', '-y', '-i', frame_path(ROOT, view, s),
                                   '-vf', vf, os.path.join(tmp, '%06d.png' % i)], check=True)
        seq = hold_sequence(len(kept), src)
        for k, i in enumerate(seq, 1):           # the numbered input ffmpeg reads: holds are links to the same frame
            os.symlink(os.path.join(tmp, '%06d.png' % i), os.path.join(tmp, 's%06d.png' % k))
        part = out_mp4 + '.part.mp4'
        subprocess.run(encode_cmd(os.path.join(tmp, 's%06d.png'), src, part), check=True)
        os.replace(part, out_mp4)
    side.update(included=len(kept), skipped_nochange=skipped, first=kept[0], last=kept[-1], src_fps=src,
                duration_s=round(len(seq) / src, 1), activity=activity,
                bytes=os.path.getsize(out_mp4), captioned=sum(1 for c in caps if c), chat_lines=len(lines))
    json.dump(side, open(out_mp4 + '.json', 'w'), indent=1)
    return side


def hold_sequence(n, src_fps, first_s=HOLD_FIRST_S, last_s=HOLD_LAST_S):
    """The 1-based frame indices the encoder reads: the first frame held first_s, the last held last_s, every frame once
    between. Pure (tested)."""
    if n <= 0:
        return []
    a = max(1, int(round(first_s * src_fps)))
    b = max(1, int(round(last_s * src_fps)))
    return [1] * a + list(range(2, n)) + [n] * b if n > 1 else [1] * (a + b)


def plan_reel(sides, overview='angled', n=REEL_VIEWS, min_included=4):
    """The daily reel's views, in order: the overview first (when it has frames), then the n other views with the most
    ACTIVITY (summed changed fraction) among those with >= min_included kept frames; topdown never (it is the overview
    again from above). Pure (tested)."""
    ok = {s['view']: s for s in sides if s.get('included', 0) >= min_included and os.path.exists(s.get('out') or '')}
    rest = sorted((v for v in ok if v not in (overview, 'topdown')), key=lambda v: (-ok[v].get('activity', 0), v))
    return ([overview] if overview in ok else []) + [v for v in rest if ok[v].get('activity', 0) > 0][:n]


def build_reel(name, sides, out_mp4, seg_s=REEL_SEG_S):
    """One 1920x1080 reel: each planned view's daily clip sped up to fit seg_s, square views padded, a title on each,
    0.4 s fades at the joins. -> sidecar dict."""
    by = {s['view']: s for s in sides}
    plan = plan_reel(sides)
    side = {'label': name, 'views': plan}
    if not plan:
        side['note'] = 'no view had enough kept frames'
        json.dump(side, open(out_mp4 + '.json', 'w'), indent=1)
        return side
    cmd, parts = NICE + ['ffmpeg', '-loglevel', 'error', '-y'], []
    for k, v in enumerate(plan):
        d = float(by[v].get('duration_s') or seg_s)
        cmd += ['-i', by[v]['out']]
        speed = max(1.0, d / seg_s)
        seg = min(d, seg_s)
        title = f'{v}  {name.split("/")[-1]}'
        parts.append(f"[{k}:v]setpts=PTS/{speed:.4f},trim=duration={seg:.2f},setpts=PTS-STARTPTS,fps={OUT_FPS},"
                     f"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,"
                     f"drawtext=fontfile={CAPTION_FONT}:text='{title}':x=(w-tw)/2:y=24:fontsize=40:fontcolor=white:"
                     f"box=1:boxcolor=black@0.55:boxborderw=12,"
                     f"fade=t=in:st=0:d=0.4,fade=t=out:st={max(0.0, seg - 0.4):.2f}:d=0.4,setsar=1[v{k}]")
    fc = ';'.join(parts) + ';' + ''.join(f'[v{k}]' for k in range(len(plan))) + f'concat=n={len(plan)}:v=1:a=0[out]'
    part = out_mp4 + '.part.mp4'
    subprocess.run(cmd + ['-filter_complex', fc, '-map', '[out]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
                          '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', part], check=True)
    os.replace(part, out_mp4)
    side.update(bytes=os.path.getsize(out_mp4))
    json.dump(side, open(out_mp4 + '.json', 'w'), indent=1)
    return side


def thin_plan(stamps, today, retain_days=RETAIN_FULL_DAYS, usable=lambda s: True):
    """Raw-frame retention for ONE view: the stamps to remove. Days older than retain_days (UTC) keep, per hour, the
    first frame the videos can USE (usable: not blemished; for the pair, present in both views -- what weekly/history/
    monthly sample), or the hour's first frame when none is usable, plus every event frame; newer days keep everything.
    Pure (tested; Codex r1: a blemished first frame must not be the survivor)."""
    cut = (today - dt.timedelta(days=retain_days)).strftime('%Y%m%d')
    hours = {}
    for s in sorted(stamps):
        if '-event-' in s or s[:8] >= cut:
            continue
        hours.setdefault(s[:11], []).append(s)
    drop = []
    for h, ss in hours.items():
        keep = next((s for s in ss if usable(s)), ss[0])
        drop += [s for s in ss if s != keep]
    return sorted(drop)


def free_gb(path):
    st = os.statvfs(path)
    return st.f_bavail * st.f_frsize / 1e9


def thin(apply=False, today=None, below_gb=THIN_BELOW_FREE_GB):
    """`thin [--apply]`: report (and with --apply, when free space is below below_gb, remove) the frames thin_plan names.
    Never touches FRAME0, event frames, the hourly representatives, or the last RETAIN_FULL_DAYS days."""
    today = today or dt.datetime.now(dt.timezone.utc).date()
    free = round(free_gb(ROOT), 1)
    total, nbytes, removed = 0, 0, 0
    act = apply and free < below_gb
    paired = set(paired_stamps())
    for v in video_views():
        d = os.path.join(ROOT, 'frames', v)
        st = []
        for day in (os.listdir(d) if os.path.isdir(d) else []):
            if os.path.isdir(os.path.join(d, day)):
                st += [f[:-4] for f in os.listdir(os.path.join(d, day)) if f.endswith('.png')]
        ok = (lambda s: s in paired) if v in VIEWS else (lambda s, v=v: not blemished(v, s))   # paired_stamps is unblemished
        for s in thin_plan(st, today, usable=ok):
            p = frame_path(ROOT, v, s)
            total += 1
            nbytes += os.path.getsize(p)
            if act:
                os.remove(p)
                removed += 1
    print(json.dumps({'thin': 'applied' if act else 'report', 'free_gb': free, 'below_gb': below_gb,
                      'candidates': total, 'candidate_gb': round(nbytes / 1e9, 2), 'removed': removed}))
    return 0


def video_views(root=None):
    """The pair, then every extra camera: the EXTRA list plus any frames/<view>/ directory (a new camera in tl.conf needs
    no edit here). Hidden dirs (.staging) are not views. Pure given the filesystem."""
    d = os.path.join(root or ROOT, 'frames')
    found = [x for x in (os.listdir(d) if os.path.isdir(d) else []) if not x.startswith('.') and os.path.isdir(os.path.join(d, x))]
    return VIEWS + tuple(sorted((set(EXTRA) | set(found)) - set(VIEWS)))


# Stored frames the videos leave out: (first stamp, end stamp exclusive, views exempt). Frames on disk stay; BlueMap
# renders only the current world, so these cannot be re-rendered.
#   route-layer-1101: the whole-map S0 route layer (wm-* marker sets: trails, zone boxes, expedition pins) was drawn
#   over every camera from the 23:15Z capture after its 11-01 23:08Z install until the 11-02 capture fix
#   (capture.mjs per-camera `markers`). The `expeditions` camera is the one view meant to show it.
BLEMISHED = (('20261101T2315Z', '20261102T1330Z', ('expeditions',)),)


def blemished(view, stamp, windows=BLEMISHED):
    """True when this stored frame sits in a BLEMISHED window its view is not exempt from. Pure (tested)."""
    return any(lo <= stamp[:14] < hi and view not in exempt for lo, hi, exempt in windows)


def frame_path(root, view, stamp):
    return os.path.join(root, 'frames', view, stamp[:8], stamp + '.png')    # same layout as tl_showcase.frame_path


def all_stamps(view):
    d = os.path.join(ROOT, 'frames', view)
    out = []
    if os.path.isdir(d):
        for day in os.listdir(d):
            if os.path.isdir(os.path.join(d, day)):
                out += [f[:-4] for f in os.listdir(os.path.join(d, day)) if f.endswith('.png')]
    return sorted(s for s in out if not blemished(view, s))


def paired_stamps():
    """Readers use only stamps present in BOTH views (a pair is published together or not at all)."""
    return sorted(set(all_stamps('angled')) & set(all_stamps('topdown')))


def window(kind, a, now):
    """-> (lo, hi, bucket_min, name) for a video kind. Pure (tested)."""
    utc = dt.timezone.utc
    if kind in ('daily', 'reel'):
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
    if len(sys.argv) >= 2 and sys.argv[1] == 'thin':
        return thin(apply='--apply' in sys.argv[2:])
    ap = argparse.ArgumentParser()
    ap.add_argument('kind', choices=['daily', 'weekly', 'history', 'monthly', 'reel'])
    ap.add_argument('--day')
    ap.add_argument('--week-ending')
    ap.add_argument('--month')
    a = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    lo, hi, bucket, name = window(a.kind, a, now)
    if a.kind == 'monthly' and not sample(paired_stamps(), lo, hi, bucket) and \
            not any(sample(all_stamps(x), lo, hi, bucket) for x in video_views()[len(VIEWS):]):     # a town-only month is still built (review P2)
        print(f'monthly {name}: SKIP -- no frames in that month yet')
        return 0
    if a.kind == 'reel':          # the reel alone, from the day's clips already built (their sidecars)
        sides = []
        for v in video_views():
            out = os.path.join(ROOT, 'video', f'{name}-{v}.mp4')
            if os.path.isfile(out + '.json'):
                sides.append(dict(json.load(open(out + '.json')), out=out))
        print(json.dumps(build_reel(name, sides, os.path.join(ROOT, 'video', f'{name}-reel.mp4'))))
        return 0
    rc, sides = 0, []
    for v in video_views():
        if not all_stamps(v):
            continue
        st = sample(paired_stamps() if v in VIEWS else all_stamps(v), lo, hi, bucket)
        out = os.path.join(ROOT, 'video', f'{name}-{v}.mp4')
        try:
            side = build(v, st, out, name, max_src_fps=MAX_SRC_FPS if bucket is None else FPS)
            print(json.dumps(side))
            sides.append(dict(side, out=out))
        except subprocess.CalledProcessError as e:
            print(json.dumps({'view': v, 'label': name, 'error': str(e)[:300]}))
            rc = 1
    if a.kind == 'daily':
        try:
            print(json.dumps(build_reel(name, sides, os.path.join(ROOT, 'video', f'{name}-reel.mp4'))))
        except subprocess.CalledProcessError as e:
            print(json.dumps({'view': 'reel', 'label': name, 'error': str(e)[:300]}))
            rc = 1
        thin(apply=True)          # acts only below THIN_BELOW_FREE_GB free; otherwise one report line
    return rc


if __name__ == '__main__':
    sys.exit(main())
