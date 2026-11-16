#!/usr/bin/env python3
"""Showcase timelapse videos from the stored frames (docs/reports/showcase-2026-10-20.md section 6).

    tl_video.py daily   [--day YYYY-MM-DD]      every frame of that UTC day (default: yesterday)
    tl_video.py weekly  [--week-ending YYYY-MM-DD]  one frame per hour, the 7 days ending that day
    tl_video.py history                          one frame per hour, frame 0 to now
    tl_video.py monthly [--month YYYY-MM]        one frame per 4 h (default: last month; skipped while it has no frames)
    tl_video.py progress                         ONE clip, video/progress.mp4: the whole area from above, one frame per 6 h
                                                 from its first frame to now, with a day counter and running counts

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
LOOK (tlpolish-1106, owner 11-07): every clip is colour graded at encode time (GRADE; the stored frames stay raw) and
encoded at CRF 17 / preset slow. SMOOTHING is OFF by default (owner 11-07 04:25Z: "if video smoothing takes that long
let's not do it" -- he runs minterpolate on a faster machine himself): every clip dissolves ("B"). tl.conf
`"smooth": "on"` brings it back: then `daily` and `history` use ffmpeg motion interpolation (minterpolate) instead of
the dissolve, at night, under the video lock (the two jobs never run at once) and against a
DEADLINE (smooth_deadline: 23:45 UTC, before the next day's daily job). A clip that would not finish by then -- its
estimate (output frames x the measured seconds per megapixel-frame, logs/video-smooth.json) passes the deadline, or its
encode is cut at the deadline -- is encoded with the dissolve ("B") instead, and so is every clip after it in that
job; each fallback is a row in logs/video-smooth.log and in the clip's sidecar (`smoothing`). weekly/monthly dissolve.
CAPTIONS name the camera: a frame's <stamp>.json sidecar (tl_showcase: the camera's label, the followed project) is
drawn in the stamp line; text scales with the frame height (a 4K frame gets 2x).
REEL: `daily` also builds daily/<day>-reel.mp4, the angled overview plus the most active views of the day (plan_reel), each
sped to fit REEL_SEG_S with a title. RETENTION: `tl_video.py thin [--apply]` keeps every frame of the last RETAIN_FULL_DAYS
days and the first frame of each UTC hour (what weekly/history/monthly sample) before that; it acts only below
THIN_BELOW_FREE_GB free, and the NAS keeps every frame (showcase-pull.sh, nightly).
NO WASTED REBUILDS (camdirector-01, owner 11-16 "videos of projects that are finished"): history / weekly / monthly
read tl.conf's cameras. A camera marked `off` gets no rebuild (its existing videos are left alone), and neither does a
camera with no new frame since its last build of that video: the video's .json sidecar records `newest_frame`, the
newest stored frame of the video's window when it was built (rebuild_skip). `daily` is unchanged.
SCENES (camdirector-01): the activity director (tl_director.py) films what the bots are doing. Its frames live in
frames/scene-<id>/ (surface, shot by tl_showcase) and frames/under-<id>/ (underground, drawn by tl_under.py); those
directories are NOT cameras: they get no daily/weekly/history video of their own. `daily` builds one clip per scene
that was live that day, daily/<day>-scene-<id>.mp4 (its frames in order, the scene's caption and its bots' names
burned in by the same text layer the chat captions use), ranks the day's scenes by score (logs/scenes-<day>.jsonl,
else the frames' sidecars) and builds the REEL from the top scenes, then the town overview. With no scene clip that
day the reel is the reel it was. A camera tl.conf marks `off` (a finished project) never appears in a reel.
PROGRESS: `progress` samples the whole-area top-down camera (tl.conf progress.view, else the first of expeditions /
grounds / topdown that has frames) once per 6 h bucket from its first frame, and draws "Day N" (N from FRAME0.json,
else the first frame) plus running counts read from what tl_extract.py already writes on this VM:
    blocks placed       data/<YYYYMMDD>/build.tsv   rows whose column 4 (op) is `place`, time = column 1
    projects finished   data/<YYYYMMDD>/chat.jsonl  lines whose `cat` is "project_done", time = field `t`
Those extracts start on the day tl_extract was installed (11-10), so the counts say "since <that day>"; a frame
older than the first extract, or a VM with no data/ at all, gets the day counter only.
"""
import argparse, bisect, datetime as dt, fcntl, json, os, subprocess, sys, tempfile, time

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
SCENE_PREFIXES = ('scene-', 'under-')   # frames/<prefix><id>/: a director scene's frames (surface / underground)
SCENE_MIN_FRAMES = 2         # a scene with fewer frames in the day gets no clip
SCENE_CLIPS_MAX = 12         # at most this many scene clips a day (the top scenes by score)
SCENE_MIN_SRC_FPS = 1.0      # a scene has few frames (one per slot): play them slower than a camera's day
SCENE_BOTS_SHOWN = 6
PROGRESS_VIEWS = ('expeditions', 'grounds', 'topdown')    # whole-area top-down first, the town top-down last
PROGRESS_BUCKET_MIN = 360    # one frame per 6 h
RETAIN_FULL_DAYS = 14
THIN_BELOW_FREE_GB = 80
LEVEL = 12
MIN_CHANGED_FRAC = 0.002
SMALL = (320, 180)
GRADE = ('eq=contrast=1.06:saturation=1.15:gamma=0.98,colorbalance=rh=0.035:gh=0.01:bh=-0.035:rs=-0.01:bs=0.02,'
         'vignette=angle=PI/7')
MINTERP = 'minterpolate=fps={fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1:scd=none'
SMOOTH_KINDS = ('daily', 'history')
TL_CONF = os.environ.get('TL_CONF', '/srv/showcase/timelapse/tl.conf')


def smooth_on(cfg, kind):
    """Motion interpolation for this video job? Only when tl.conf says `"smooth": "on"` (default OFF, owner 11-07) and
    the job is daily/history. Pure (tested)."""
    return str((cfg or {}).get('smooth', 'off')).strip().lower() == 'on' and kind in SMOOTH_KINDS


def load_tl_conf(path=None):
    try:
        return json.load(open(path or TL_CONF))
    except (OSError, ValueError):
        return {}


REBUILD_KINDS = ('history', 'weekly', 'monthly', 'progress')     # the videos rebuilt from stored frames under one name


def off_views(cfg):
    """The cameras tl.conf marks `off` (a finished project's camera: owner 11-14). Pure (tested)."""
    return {v for v, cam in ((cfg or {}).get('cameras') or {}).items() if isinstance(cam, dict) and cam.get('off')}


def newest_stamp(stamps, lo=None, hi=None):
    """The newest regular (non-event) frame stamp, inside [lo, hi) when given; None when there is none. Pure (tested)."""
    best = None
    for s in stamps:
        t = parse_stamp(s)
        if t is None or (lo is not None and t < lo) or (hi is not None and t >= hi):
            continue
        if best is None or s > best:
            best = s
    return best


def rebuild_skip(kind, view, off, newest, candidates, prev_side, have_mp4):
    """Should this history / weekly / monthly video NOT be encoded tonight? -> (skip, why, backfill).
      * the camera is `off` in tl.conf: never rebuilt (whatever exists is left alone);
      * the video exists and its sidecar's `newest_frame` equals the newest stored frame of the window: nothing new;
      * the video exists and its sidecar predates `newest_frame`: skipped only when its `last` and `candidates` equal
        tonight's sampled list, and then `backfill` is the value to record in the sidecar (no encode).
    Any other kind (daily) is never skipped here. Pure (tested)."""
    if kind not in REBUILD_KINDS:
        return False, None, None
    if view in off:
        return True, 'camera is off in tl.conf: no rebuild (existing videos are left alone)', None
    if not have_mp4 or not isinstance(prev_side, dict) or newest is None:
        return False, None, None
    if 'newest_frame' in prev_side:
        if prev_side['newest_frame'] == newest:
            return True, f'no new frame since the last build (newest {newest})', None
        return False, None, None
    if candidates and prev_side.get('last') == candidates[-1] and prev_side.get('candidates') == len(candidates):
        return True, f'no new frame since the last build (newest {newest}; newest_frame recorded)', newest
    return False, None, None


def read_side(out_mp4):
    """A video's .json sidecar, or None."""
    try:
        with open(out_mp4 + '.json') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None
SMOOTH_DEADLINE_HM = (23, 45)        # UTC; the next daily job starts 00:20
SMOOTH_S_PER_MPX = 0.9               # first guess, seconds per output megapixel-frame (measured .30, 4 threads: ~0.6)
SMOOTH_MARGIN = 1.25                 # an estimate must fit the time left with this much slack
SMOOTH_LOG = 'video-smooth.log'
SMOOTH_STATE = 'video-smooth.json'
CRF, PRESET = '17', 'slow'
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


def text_scale(height):
    """Caption size factor for a frame height: 1 up to 1440 px (the cameras the captions were tuned on), height/1080
    above (a 3840x2160 frame gets 2). Pure (tested)."""
    return 1.0 if height <= 1440 else round(height / 1080.0, 3)


def overlay_filter(stamp_text, cap, day, tmp, i, scale=1.0):
    """The -vf chain for one frame: the stamp (as before) + the caption lines + the tally, each from a TEXT FILE (no escaping of
    the bots' words; expansion=none so a '%' is literal). Writes the files into tmp. scale: text_scale. -> filter string."""
    k = lambda n: int(round(n * scale))
    vf = [f"drawtext=fontfile={FONT}:text='{stamp_text}':x=w-tw-{k(28)}:y=h-th-{k(28)}:fontsize={k(36)}:"
          f"fontcolor=white:box=1:boxcolor=black@0.55:boxborderw={k(12)}"]
    for j, line in enumerate(reversed(cap)):          # the newest line sits lowest
        f = os.path.join(tmp, f'cap{i:06d}_{j}.txt')
        with open(f, 'w') as fh:
            fh.write(line)
        vf.append(f"drawtext=fontfile={CAPTION_FONT}:textfile={f}:expansion=none:x={k(28)}:y=h-th-{k(110 + 62 * j)}:"
                  f"fontsize={k(34)}:fontcolor=white:box=1:boxcolor=black@0.6:boxborderw={k(12)}")
    if day:
        f = os.path.join(tmp, f'tally{i:06d}.txt')
        with open(f, 'w') as fh:
            fh.write(day)
        vf.append(f"drawtext=fontfile={CAPTION_FONT}:textfile={f}:expansion=none:x={k(28)}:y={k(28)}:fontsize={k(30)}:"
                  f"fontcolor=white:box=1:boxcolor=black@0.5:boxborderw={k(10)}")
    return ','.join(vf)


def stamp_text(view, stamp, side=None):
    """The stamp line: the camera's caption label (the frame's sidecar: e.g. 'town' or the followed project) or the
    view name, then the UTC time. Colons escaped for drawtext. Pure (tested)."""
    who = (side or {}).get('label') or view
    who = ''.join(ch for ch in str(who) if ch.isalnum() or ch in ' -_')[:40] or view
    return f"showcase {who}  {stamp[0:4]}-{stamp[4:6]}-{stamp[6:8]} {stamp[9:11]}\\:{stamp[11:13]} UTC"


def frame_side(view, stamp):
    """The frame's <stamp>.json sidecar (tl_showcase frame_sidecar) or None."""
    try:
        return json.load(open(frame_path(ROOT, view, stamp)[:-4] + '.json'))
    except (OSError, ValueError):
        return None


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


def encode_cmd(frames_glob, src_fps, out, out_fps=OUT_FPS, blend=BLEND, text_glob=None, smooth=False, grade=GRADE):
    """The ffmpeg command for one clip: stored frames at src_fps, colour graded (grade), then a linear dissolve up to
    out_fps (no scene-cut detection: a project appearing is the point, not a cut) or, with smooth, motion
    interpolation (MINTERP); text_glob, a transparent text layer per step, is laid over the moving picture WITHOUT
    blending (fps duplicates; it switches at the step's midpoint) and is never graded. Pure (tested)."""
    dis = (MINTERP.format(fps=out_fps) if smooth else
           f'framerate=fps={out_fps}:interp_start={blend[0]}:interp_end={blend[1]}:scene=100')
    if grade:
        dis = f'{grade},{dis}'
    cmd = NICE + ['ffmpeg', '-loglevel', 'error', '-y', '-framerate', str(src_fps), '-i', frames_glob]
    if text_glob:
        cmd += ['-framerate', str(src_fps), '-i', text_glob, '-filter_complex',
                f'[0:v]{dis}[b];[1:v]fps={out_fps}[t];[b][t]overlay=shortest=1:format=auto,format=yuv420p[v]', '-map', '[v]']
    else:
        cmd += ['-vf', dis]
    return cmd + ['-c:v', 'libx264', '-preset', PRESET, '-crf', CRF, '-threads', '2', '-pix_fmt', 'yuv420p',
                  '-movflags', '+faststart', out]


def smooth_deadline(now, hm=SMOOTH_DEADLINE_HM):
    """The epoch second a night's smoothing must end by: the next hm UTC after now (a job that starts at 00:20 gets
    until 23:45 the same day). Pure (tested)."""
    d = now.replace(hour=hm[0], minute=hm[1], second=0, microsecond=0)
    if d <= now:
        d += dt.timedelta(days=1)
    return d.timestamp()


def smooth_estimate_s(n_out_frames, w, h, s_per_mpx):
    """Seconds a minterpolate encode of n_out_frames at w x h should take. Pure (tested)."""
    return n_out_frames * (w * h / 1e6) * s_per_mpx


def smooth_choice(enabled, est_s, now_s, deadline_s, fell_back, margin=SMOOTH_MARGIN):
    """-> (smooth?, reason). Motion interpolation only when the job allows it, no earlier clip of this job fell back,
    and the estimate (with margin) fits before the deadline. Pure (tested)."""
    if not enabled:
        return False, 'dissolve (smoothing off, or weekly/monthly)'
    if fell_back:
        return False, 'fallback: an earlier clip of this job fell back'
    left = deadline_s - now_s
    if est_s * margin > left:
        return False, f'fallback: estimate {est_s:.0f} s x {margin} > {left:.0f} s to the deadline'
    return True, 'minterpolate'


def smooth_rate_update(old, measured, w=0.5):
    """EWMA of the measured seconds per megapixel-frame. Pure (tested)."""
    return round(measured if not old else (1 - w) * old + w * measured, 4)


def smooth_log(row):
    p = os.path.join(ROOT, 'logs', SMOOTH_LOG)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'a') as f:
        f.write(json.dumps(dict(row, t=dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'))) + '\n')


def smooth_rate():
    try:
        return float(json.load(open(os.path.join(ROOT, 'logs', SMOOTH_STATE))).get('s_per_mpx') or SMOOTH_S_PER_MPX)
    except (OSError, ValueError, TypeError):
        return SMOOTH_S_PER_MPX


def save_smooth_rate(v):
    p = os.path.join(ROOT, 'logs', SMOOTH_STATE)
    with open(p + '.part', 'w') as f:
        json.dump({'s_per_mpx': v}, f)
    os.replace(p + '.part', p)


class SmoothJob:
    """One video job's smoothing budget: enabled (daily/history), the deadline, and whether a clip already fell back."""
    def __init__(self, enabled, deadline_s):
        self.enabled, self.deadline_s, self.fell_back = enabled, deadline_s, False


def png_size(path):
    """(width, height) from a PNG's IHDR. Pure given the file."""
    with open(path, 'rb') as f:
        head = f.read(24)
    return int.from_bytes(head[16:20], 'big'), int.from_bytes(head[20:24], 'big')


def small_gray(path):
    p = subprocess.run(NICE + ['ffmpeg', '-loglevel', 'error', '-i', path, '-vf',
                               f'scale={SMALL[0]}:{SMALL[1]},format=gray', '-f', 'rawvideo', '-'],
                       capture_output=True)
    return p.stdout if p.returncode == 0 else b''


def build(view, stamps, out_mp4, label, max_src_fps=MAX_SRC_FPS, smooth_job=None, extra=None, captions_for=None,
          min_src_fps=MIN_SRC_FPS):
    """One clip of one frames directory. captions_for (kept stamps -> [[line, ...] per stamp]) replaces the chat
    captions and the tally with its own lines (a scene's caption and bots, the progress counts), drawn by the same
    text layer; min_src_fps lets a clip of few frames play slower."""
    os.makedirs(os.path.dirname(out_mp4), exist_ok=True)
    side = {'view': view, 'label': label, 'candidates': len(stamps), 'fps': OUT_FPS, 'level': LEVEL,
            'min_changed_frac': MIN_CHANGED_FRAC}
    side.update(extra or {})            # e.g. newest_frame (rebuild_skip reads it the next night)
    if not stamps:
        side.update(included=0, skipped_nochange=0, note='no frames in range')
        json.dump(side, open(out_mp4 + '.json', 'w'), indent=1)
        return side
    kept, skipped, activity = dedup_scored(stamps, lambda s: small_gray(frame_path(ROOT, view, s)))
    src = src_fps_for(len(kept), lo=min(min_src_fps, max_src_fps), hi=max_src_fps)
    lines = load_lines() if captions_for is None else []        # own captions: no chat lines, no tally
    caps = captions(kept, lines) if captions_for is None else captions_for(kept)
    with tempfile.TemporaryDirectory(dir=os.path.join(ROOT, 'video')) as tmp:
        # the TEXT is drawn on a transparent layer of its own and laid over AFTER the dissolve, so the stamp, captions
        # and tally switch crisply instead of ghosting through each other (11-03 proof clip)
        for i, s in enumerate(kept, 1):
            text = stamp_text(view, s, frame_side(view, s))
            w, h = png_size(frame_path(ROOT, view, s))
            vf = overlay_filter(text, caps[i - 1], tally(lines, parse_stamp(s)), tmp, i, scale=text_scale(h))
            subprocess.run(NICE + ['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
                                   f'color=c=black@0.0:s={w}x{h},format=rgba', '-vf', vf, '-frames:v', '1',
                                   os.path.join(tmp, 't%06d.png' % i)], check=True)
        seq = hold_sequence(len(kept), src)
        for k, i in enumerate(seq, 1):           # the numbered inputs ffmpeg reads: holds are links to the same frame
            os.symlink(frame_path(ROOT, view, kept[i - 1]), os.path.join(tmp, 's%06d.png' % k))
            os.symlink(os.path.join(tmp, 't%06d.png' % i), os.path.join(tmp, 'o%06d.png' % k))
        part = out_mp4 + '.part.mp4'
        n_out = int(round(len(seq) / src * OUT_FPS))
        w0, h0 = png_size(frame_path(ROOT, view, kept[-1]))
        sj = smooth_job or SmoothJob(False, 0)
        rate = smooth_rate()
        est = smooth_estimate_s(n_out, w0, h0, rate)
        use, why = smooth_choice(sj.enabled, est, time.time(), sj.deadline_s, sj.fell_back)
        args = (os.path.join(tmp, 's%06d.png'), src, part)
        kw = dict(text_glob=os.path.join(tmp, 'o%06d.png'))
        t0 = time.time()
        if use:
            try:
                subprocess.run(encode_cmd(*args, smooth=True, **kw), check=True,
                               timeout=max(1.0, sj.deadline_s - time.time()))
                took = time.time() - t0
                save_smooth_rate(smooth_rate_update(rate, took / max(1, n_out) / (w0 * h0 / 1e6)))
            except (subprocess.TimeoutExpired, subprocess.CalledProcessError) as e:
                use, why = False, f'fallback: minterpolate {type(e).__name__} after {time.time() - t0:.0f} s'
        if not use:
            if sj.enabled and why.startswith('fallback'):
                sj.fell_back = True
                smooth_log({'view': view, 'label': label, 'why': why, 'est_s': round(est), 'n_out': n_out,
                            'size': [w0, h0]})
            subprocess.run(encode_cmd(*args, smooth=False, **kw), check=True)
        os.replace(part, out_mp4)
    side.update(smoothing='minterpolate' if use else 'dissolve', smoothing_why=why, encode_s=round(time.time() - t0, 1),
                est_smooth_s=round(est))
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


def plan_reel(sides, overview=('hero4k', 'angled'), n=REEL_VIEWS, min_included=4, scenes=(), off=()):
    """The daily reel's views, in order.
    WITH SCENE CLIPS (camdirector-01; scenes: build_scene_clips' sides, each with 'view', 'score', 'out'): the n top
    scenes by score -- surface and underground alike -- then the town overview (the first of `overview` that has a
    clip). Nothing else: the reel shows what the bots did.
    WITHOUT: as before -- the overview first (the 4K town hero since tlpolish-1106, else angled), then the n other
    views with the most ACTIVITY (summed changed fraction) among those with >= min_included kept frames; topdown never
    (it is the overview again from above).
    Either way a camera in `off` (tl.conf: a finished project) never appears, and a clip that is not on disk is left
    out. Pure (tested)."""
    ok = {s['view']: s for s in sides if s.get('included', 0) >= min_included and os.path.exists(s.get('out') or '')
          and s['view'] not in off and not is_scene_view(s['view'])}
    prefs = (overview,) if isinstance(overview, str) else tuple(overview)
    overview = next((v for v in prefs if v in ok), prefs[-1])
    top = sorted((s for s in scenes if s.get('included', 0) >= SCENE_MIN_FRAMES and os.path.exists(s.get('out') or '')),
                 key=lambda s: (-(s.get('score') or 0), s['view']))[:n]
    if top:
        return [s['view'] for s in top] + ([overview] if overview in ok else [])
    rest = sorted((v for v in ok if v not in (overview, 'topdown')), key=lambda v: (-ok[v].get('activity', 0), v))
    return ([overview] if overview in ok else []) + [v for v in rest if ok[v].get('activity', 0) > 0][:n]


def reel_title(view, side, name):
    """A reel segment's title: a scene's caption, else the camera name; then the day. Only letters, digits, spaces
    and - _ , . survive (it is quoted inside the filter string). Pure (tested)."""
    what = ''.join(ch for ch in str((side or {}).get('title') or view) if ch.isalnum() or ch in ' -_,.')[:70] or view
    return f'{what}  {name.split("/")[-1]}'


def reel_cmd(name, plan, by, out, seg_s=REEL_SEG_S):
    """The ffmpeg command of one 1920x1080 reel: each planned view's clip (by[view]: 'out', 'duration_s', 'title')
    sped up to fit seg_s, square views padded, a title on each, 0.4 s fades at the joins. Pure (tested)."""
    cmd, parts = NICE + ['ffmpeg', '-loglevel', 'error', '-y'], []
    for k, v in enumerate(plan):
        d = float(by[v].get('duration_s') or seg_s)
        cmd += ['-i', by[v]['out']]
        speed = max(1.0, d / seg_s)
        seg = min(d, seg_s)
        title = reel_title(v, by[v], name)
        parts.append(f"[{k}:v]setpts=PTS/{speed:.4f},trim=duration={seg:.2f},setpts=PTS-STARTPTS,fps={OUT_FPS},"
                     f"scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,"
                     f"drawtext=fontfile={CAPTION_FONT}:text='{title}':x=w-tw-28:y=28:fontsize=40:fontcolor=white:"
                     f"box=1:boxcolor=black@0.55:boxborderw=12,"
                     f"fade=t=in:st=0:d=0.4,fade=t=out:st={max(0.0, seg - 0.4):.2f}:d=0.4,setsar=1[v{k}]")
    fc = ';'.join(parts) + ';' + ''.join(f'[v{k}]' for k in range(len(plan))) + f'concat=n={len(plan)}:v=1:a=0[out]'
    return cmd + ['-filter_complex', fc, '-map', '[out]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21',
                  '-threads', '2', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]


def build_reel(name, sides, out_mp4, seg_s=REEL_SEG_S, scenes=(), off=()):
    """One 1920x1080 reel of the day (plan_reel, reel_cmd). -> sidecar dict."""
    by = {s['view']: s for s in list(sides) + list(scenes)}
    plan = plan_reel(sides, scenes=scenes, off=off)
    side = {'label': name, 'views': plan, 'scenes': [by[v].get('scene') for v in plan if by[v].get('scene')]}
    if not plan:
        side['note'] = 'no view had enough kept frames'
        json.dump(side, open(out_mp4 + '.json', 'w'), indent=1)
        return side
    part = out_mp4 + '.part.mp4'
    subprocess.run(reel_cmd(name, plan, by, part, seg_s), check=True)
    os.replace(part, out_mp4)
    side.update(bytes=os.path.getsize(out_mp4))
    json.dump(side, open(out_mp4 + '.json', 'w'), indent=1)
    return side


# ---------------------------------------------------------------------------- scenes (camdirector-01, tl_director.py)
def is_scene_view(name):
    """frames/scene-<id> and frames/under-<id> hold a director scene's frames; they are not cameras. Pure (tested)."""
    return str(name).startswith(SCENE_PREFIXES)


def scene_id(view):
    """'scene-s20261116T1245a' / 'under-d20261116T1245a' -> the scene id. Pure."""
    return str(view).split('-', 1)[1] if is_scene_view(view) else None


def scene_views(root=None):
    """The scene frame directories on disk, sorted."""
    d = os.path.join(root or ROOT, 'frames')
    return sorted(x for x in (os.listdir(d) if os.path.isdir(d) else []) if is_scene_view(x) and os.path.isdir(os.path.join(d, x)))


def load_scene_log(day, root=None):
    """The director's slot rows of one UTC day (logs/scenes-<YYYYMMDD>.jsonl: the hand-off object, one line per slot).
    A missing file or a bad line is simply absent."""
    out = []
    try:
        f = open(os.path.join(root or ROOT, 'logs', f'scenes-{day}.jsonl'), errors='replace')
    except OSError:
        return out
    with f:
        for line in f:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if isinstance(r, dict) and isinstance(r.get('scenes'), list):
                out.append(r)
    return out


def day_scenes(stamps_by_view, log_rows, side_of=lambda view, stamp: None):
    """The scenes that have frames on a day, best first. stamps_by_view: {frames dir: [the day's stamps]} for the
    scene directories; log_rows: load_scene_log's; side_of(view, stamp): a frame's sidecar or None.
    A scene's SCORE is the sum of its score over the day's slots (the director's log: weighted bot-minutes, added up
    slot by slot); with no log row for it, the sum of its frames' sidecar `score`. Its caption and bots are those of
    its busiest slot. -> [{'id', 'view', 'layer', 'score', 'slots', 'caption', 'bots', 'stamps', 'by_stamp'}], where
    by_stamp maps a slot's frame stamp to that slot's {caption, bots} (scene_captions falls back on it). Pure (tested)."""
    logged = {}
    for row in log_rows:
        for sc in row.get('scenes') or ():
            if not isinstance(sc, dict) or not sc.get('id'):
                continue
            a = logged.setdefault(sc['id'], {'score': 0.0, 'slots': 0, 'best': None, 'by_stamp': {}})
            a['score'] += float(sc.get('score') or 0)
            a['slots'] += 1
            if a['best'] is None or float(sc.get('score') or 0) > float(a['best'].get('score') or 0):
                a['best'] = sc
            if row.get('stamp'):
                a['by_stamp'][row['stamp']] = {'caption': sc.get('caption'), 'bots': list(sc.get('bots') or ())}
    out = []
    for view in sorted(stamps_by_view):
        stamps = sorted(stamps_by_view[view])
        sid = scene_id(view)
        if not stamps or not sid:
            continue
        a = logged.get(sid)
        if a:
            best, score, slots, by_stamp = a['best'], a['score'], a['slots'], a['by_stamp']
        else:                               # no log: the frames' own sidecars
            sides = [x for x in (side_of(view, s) for s in stamps) if isinstance(x, dict)]
            best = max(sides, key=lambda x: float(x.get('score') or 0), default={})
            score, slots, by_stamp = sum(float(x.get('score') or 0) for x in sides), len(sides), {}
        out.append({'id': sid, 'view': view, 'layer': best.get('layer') or ('surface' if view.startswith('scene-') else 'underground'),
                    'score': round(score, 1), 'slots': slots, 'caption': best.get('caption') or '',
                    'bots': list(best.get('bots') or ()), 'stamps': stamps, 'by_stamp': by_stamp})
    return sorted(out, key=lambda s: (-s['score'], s['id']))


def bots_line(bots, shown=SCENE_BOTS_SHOWN):
    """['Alpha', 'Kite', ...] -> 'Alpha, Kite' (at most `shown` names, then '+N'). Pure (tested)."""
    bots = [str(b) for b in bots or ()]
    return ', '.join(bots[:shown]) + (f' +{len(bots) - shown}' if len(bots) > shown else '')


def caption_line(text):
    """One burned-in line: ASCII, capped (as caption_text does for the bots' chat lines). Pure."""
    s = ''.join(c for c in str(text or '') if 32 <= ord(c) < 127)
    return s if len(s) <= CAPTION_MAX_CHARS else s[:CAPTION_MAX_CHARS - 3] + '...'


def scene_captions(scene, stamps, side_of=lambda view, stamp: None):
    """The lines burned into each frame of a scene clip: [the caption, the bots' names] as they were AT THAT FRAME --
    its sidecar (tl_showcase / tl_under write caption + bots), else that slot's row in the director's log, else the
    scene's busiest slot. An empty line is left out. Pure (tested)."""
    out = []
    for s in stamps:
        side = side_of(scene['view'], s) or {}
        slot = (scene.get('by_stamp') or {}).get(s) or {}
        cap = side.get('caption') or slot.get('caption') or scene.get('caption')
        bots = side.get('bots') or slot.get('bots') or scene.get('bots')
        out.append([x for x in (caption_line(cap), caption_line(bots_line(bots))) if x])
    return out


def build_scene_clips(name, lo, hi, smooth_job=None):
    """`daily`: one clip per scene that has frames in [lo, hi) -- video/<name>-scene-<id>.mp4, the SCENE_CLIPS_MAX
    best -- its caption and bots burned in. -> the clips' sides (each with out, title, score, scene, layer)."""
    rows = load_scene_log(lo.strftime('%Y%m%d'))
    stamps = {v: sample(all_stamps(v), lo, hi, None) for v in scene_views()}
    out = []
    for sc in day_scenes(stamps, rows, frame_side)[:SCENE_CLIPS_MAX]:
        if len(sc['stamps']) < SCENE_MIN_FRAMES:
            continue
        mp4 = os.path.join(ROOT, 'video', f"{name}-scene-{sc['id']}.mp4")
        extra = {'scene': sc['id'], 'layer': sc['layer'], 'score': sc['score'], 'title': sc['caption'], 'bots': sc['bots'],
                 'slots': sc['slots']}
        try:
            side = build(sc['view'], sc['stamps'], mp4, name, smooth_job=smooth_job, min_src_fps=SCENE_MIN_SRC_FPS,
                         extra=extra, captions_for=lambda kept, sc=sc: scene_captions(sc, kept, frame_side))
        except subprocess.CalledProcessError as e:
            print(json.dumps({'view': sc['view'], 'label': name, 'error': str(e)[:300]}))
            continue
        print(json.dumps(side))
        out.append(dict(side, out=mp4))
    return out


# ------------------------------------------------------------------------------------- progress (camdirector-01)
def progress_view(cfg, has_frames):
    """The camera the progress clip is made from: tl.conf progress.view when it has frames, else the first of
    PROGRESS_VIEWS (whole-area top-down first) that has; None when none has. has_frames(view) -> bool. Pure (tested)."""
    want = ((cfg or {}).get('progress') or {}).get('view')
    for v in ([want] if want else []) + list(PROGRESS_VIEWS):
        if has_frames(v):
            return v
    return None


def frame0_day(root=None):
    """The UTC date of frame 0 (FRAME0.json: the empty world), or None."""
    try:
        with open(os.path.join(root or ROOT, 'FRAME0.json')) as f:
            return parse_stamp(json.load(f)['stamp']).date()
    except (OSError, ValueError, KeyError, TypeError, AttributeError):
        return None


def load_progress_counts(root=None):
    """What tl_extract.py already wrote on this VM, as two sorted lists of times (ISO, seconds) and the first day that
    has an extract: {'placed': [...], 'done': [...], 'from': date or None}.
      placed  data/<YYYYMMDD>/build.tsv   every row whose column 4 (op) is `place`; its time is column 1
      done    data/<YYYYMMDD>/chat.jsonl  every line whose `cat` is "project_done"; its time is field `t`
    A missing directory or file contributes nothing (the clip then shows the day counter only)."""
    d = os.path.join(root or ROOT, 'data')
    placed, done, first = [], [], None
    for day in sorted(os.listdir(d) if os.path.isdir(d) else []):
        if len(day) != 8 or not day.isdigit():
            continue
        seen = False
        try:
            with open(os.path.join(d, day, 'build.tsv'), errors='replace') as f:
                seen = True
                for line in f:
                    c = line.rstrip('\n').split('\t')
                    if len(c) >= 4 and c[3] == 'place':
                        placed.append(c[0][:19])
        except OSError:
            pass
        try:
            with open(os.path.join(d, day, 'chat.jsonl'), errors='replace') as f:
                seen = True
                for line in f:
                    try:
                        r = json.loads(line)
                    except ValueError:
                        continue
                    if isinstance(r, dict) and r.get('cat') == 'project_done' and r.get('t'):
                        done.append(str(r['t'])[:19])
        except OSError:
            pass
        if seen and first is None:
            first = dt.date(int(day[:4]), int(day[4:6]), int(day[6:8]))
    return {'placed': sorted(placed), 'done': sorted(done), 'from': first}


def progress_text(t, day0, counts):
    """The line burned into a progress frame taken at t: 'Day 27', and from the first day the extracts cover also
    '12,480 blocks placed, 9 projects finished since Nov 10'. Pure (tested)."""
    text = f'Day {(t.date() - day0).days + 1}'
    first = (counts or {}).get('from')
    if first is None or t.date() < first:
        return text
    upto = t.strftime('%Y-%m-%dT%H:%M:%S')
    n, k = bisect.bisect_right(counts['placed'], upto), bisect.bisect_right(counts['done'], upto)
    since = '' if first <= day0 else f" since {first.strftime('%b %d')}"
    return (f"{text}   {n:,} block{'' if n == 1 else 's'} placed, {k} project{'' if k == 1 else 's'} finished{since}")


def progress_captions(stamps, day0, counts):
    """build()'s captions_for for the progress clip: one line per frame. Pure (tested)."""
    return [[caption_line(progress_text(parse_stamp(s), day0, counts))] for s in stamps]


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


VERIFIED = '.nas-verified'          # timelapse2-1110: nas-sync writes frames/<view>/<day>/.nas-verified after a checksum match


def nas_verified(day_dir, listdir=os.listdir, read=lambda p: open(p).read()):
    """True when frames/<view>/<day>/ carries the NAS checksum marker AND its count still equals the day's .png count
    (a frame published after the verify makes the day unverified again). Pure given the fs callables (tested)."""
    try:
        n = int(read(os.path.join(day_dir, VERIFIED)).split()[0])
        return n == sum(1 for f in listdir(day_dir) if f.endswith('.png'))
    except (OSError, ValueError, IndexError):
        return False


def thin(apply=False, today=None, below_gb=THIN_BELOW_FREE_GB, retain_days=RETAIN_FULL_DAYS, verified=nas_verified):
    """`thin [--apply]`: report (and with --apply, when free space is below below_gb, remove) the frames thin_plan names.
    Never touches FRAME0, event frames, the hourly representatives, the last retain_days days, or any day whose NAS
    copy is not checksum-verified (timelapse2-1110: local frames are pruned only after the NAS has them)."""
    today = today or dt.datetime.now(dt.timezone.utc).date()
    free = round(free_gb(ROOT), 1)
    total, nbytes, removed = 0, 0, 0
    act = apply and free < below_gb
    unverified = 0
    for v in list(video_views()) + scene_views():          # the scene directories are thinned like any camera
        d = os.path.join(ROOT, 'frames', v)
        st = []
        for day in (os.listdir(d) if os.path.isdir(d) else []):
            if os.path.isdir(os.path.join(d, day)):
                st += [f[:-4] for f in os.listdir(os.path.join(d, day)) if f.endswith('.png')]
        ok = lambda s, v=v: not blemished(v, s)       # timelapse2-1110: each view by its own stamps (topdown is hourly)
        vdays = {}
        for s in thin_plan(st, today, retain_days=retain_days, usable=ok):
            if s[:8] not in vdays:
                vdays[s[:8]] = bool(verified(os.path.join(d, s[:8])))
            if not vdays[s[:8]]:
                unverified += 1
                continue
            p = frame_path(ROOT, v, s)
            total += 1
            nbytes += os.path.getsize(p)
            if act:
                os.remove(p)
                removed += 1
    print(json.dumps({'thin': 'applied' if act else 'report', 'free_gb': free, 'below_gb': below_gb,
                      'candidates': total, 'candidate_gb': round(nbytes / 1e9, 2), 'removed': removed,
                      'kept_unverified': unverified}))
    return 0


HERO_VIEWS = ('hero4k', 'project4k')     # tlpolish-1106: the 4K cameras get the night's smoothing first


def video_order(views, hero=HERO_VIEWS):
    """The build order: the hero cameras first (the showpieces get motion interpolation before the deadline runs
    out), then the rest in their usual order. Pure (tested)."""
    return [v for v in hero if v in views] + [v for v in views if v not in hero]


def video_views(root=None):
    """The pair, then every extra camera: the EXTRA list plus any frames/<view>/ directory (a new camera in tl.conf needs
    no edit here). Hidden dirs (.staging) are not views, and neither are the director's scene directories (scene-<id>,
    under-<id>: build_scene_clips makes their clips). Pure given the filesystem."""
    d = os.path.join(root or ROOT, 'frames')
    found = [x for x in (os.listdir(d) if os.path.isdir(d) else [])
             if not x.startswith('.') and not is_scene_view(x) and os.path.isdir(os.path.join(d, x))]
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
    if kind == 'progress':          # from day one, one frame per 6 h (buckets start at 00, 06, 12, 18 UTC)
        return dt.datetime(2000, 1, 1, tzinfo=utc), now, PROGRESS_BUCKET_MIN, 'progress'
    raise ValueError(kind)


def frame_one(view, stamp, out):
    """`frame <view> <stamp> <out.png>`: one frame with the overlay a video would give it (lookback FIRST_LOOKBACK_MIN)."""
    lines = load_lines()
    cap = captions([stamp], lines)[0]
    with tempfile.TemporaryDirectory() as tmp:
        text = stamp_text(view, stamp, frame_side(view, stamp))
        vf = overlay_filter(text, cap, tally(lines, parse_stamp(stamp)), tmp, 0,
                            scale=text_scale(png_size(frame_path(ROOT, view, stamp))[1]))
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', frame_path(ROOT, view, stamp), '-vf', vf, out], check=True)
    print(json.dumps({'view': view, 'stamp': stamp, 'out': out, 'caption': cap, 'tally': tally(lines, parse_stamp(stamp))}))
    return 0


def build_progress(conf, off, lo, hi, bucket, name, smooth_job=None):
    """`progress`: video/progress.mp4 from the whole-area top-down camera, one frame per 6 h, "Day N" and the running
    counts on every frame. Not rebuilt while its camera has no new frame (rebuild_skip). -> exit code."""
    view = progress_view(conf, lambda v: bool(all_stamps(v)))
    if view is None:
        print(json.dumps({'label': name, 'skipped': f'no frames in any of {list(PROGRESS_VIEWS)}'}))
        return 0
    stamps = all_stamps(view)
    st = sample(stamps, lo, hi, bucket)
    out = os.path.join(ROOT, 'video', f'{name}.mp4')
    newest = newest_stamp(stamps, lo, hi)
    skip, why, backfill = rebuild_skip('progress', view, off, newest, st, read_side(out), os.path.isfile(out))
    if skip:
        print(json.dumps({'view': view, 'label': name, 'skipped': why}))
        return 0
    counts = load_progress_counts()
    day0 = frame0_day() or parse_stamp(stamps[0]).date()
    extra = {'newest_frame': newest, 'bucket_min': bucket, 'day0': day0.isoformat(),
             'counts_from': counts['from'].isoformat() if counts['from'] else None,
             'blocks_placed': len(counts['placed']), 'projects_finished': len(counts['done'])}
    try:
        side = build(view, st, out, name, max_src_fps=FPS, smooth_job=smooth_job, extra=extra,
                     captions_for=lambda kept: progress_captions(kept, day0, counts))
    except subprocess.CalledProcessError as e:
        print(json.dumps({'view': view, 'label': name, 'error': str(e)[:300]}))
        return 1
    print(json.dumps(side))
    return 0


def main():
    if len(sys.argv) == 5 and sys.argv[1] == 'frame':
        return frame_one(sys.argv[2], sys.argv[3], sys.argv[4])
    if len(sys.argv) >= 2 and sys.argv[1] == 'thin':
        return thin(apply='--apply' in sys.argv[2:])
    ap = argparse.ArgumentParser()
    ap.add_argument('kind', choices=['daily', 'weekly', 'history', 'monthly', 'reel', 'progress'])
    ap.add_argument('--day')
    ap.add_argument('--week-ending')
    ap.add_argument('--month')
    a = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    lo, hi, bucket, name = window(a.kind, a, now)
    if a.kind == 'monthly' and not sample(all_stamps('angled'), lo, hi, bucket) and \
            not any(sample(all_stamps(x), lo, hi, bucket) for x in video_views()[len(VIEWS):]):     # a town-only month is still built (review P2)
        print(f'monthly {name}: SKIP -- no frames in that month yet')
        return 0
    if a.kind == 'reel':          # the reel alone, from the day's clips already built (their sidecars)
        sides, scenes = [], []
        for v in video_views():
            out = os.path.join(ROOT, 'video', f'{name}-{v}.mp4')
            if os.path.isfile(out + '.json'):
                sides.append(dict(json.load(open(out + '.json')), out=out))
        for v in scene_views():
            out = os.path.join(ROOT, 'video', f'{name}-scene-{scene_id(v)}.mp4')
            if os.path.isfile(out + '.json'):
                scenes.append(dict(read_side(out), out=out))
        print(json.dumps(build_reel(name, sides, os.path.join(ROOT, 'video', f'{name}-reel.mp4'), scenes=scenes,
                                    off=off_views(load_tl_conf()))))
        return 0
    # the deadline is fixed at the job's START, before waiting for the lock (Codex r1: a job that got the lock after
    # 23:45 would otherwise get tomorrow's deadline and run into its service timeout)
    conf = load_tl_conf()
    off = off_views(conf)
    sj = SmoothJob(smooth_on(conf, a.kind), smooth_deadline(dt.datetime.now(dt.timezone.utc)))
    # ONE video job at a time (daily 00:20 and history 01:00 would otherwise share the night's CPU and deadline)
    if a.kind in SMOOTH_KINDS or a.kind == 'progress':
        os.makedirs(os.path.join(ROOT, 'logs'), exist_ok=True)
        lockf = open(os.path.join(ROOT, 'logs', 'video.lock'), 'a+')
        fcntl.flock(lockf, fcntl.LOCK_EX)
    rc, sides = 0, []
    if a.kind == 'progress':
        return build_progress(conf, off, lo, hi, bucket, name, sj)
    for v in video_order(video_views()):
        stamps = all_stamps(v)
        if not stamps:
            continue
        st = sample(stamps, lo, hi, bucket)                 # timelapse2-1110: topdown is hourly, so not the pair's stamps
        out = os.path.join(ROOT, 'video', f'{name}-{v}.mp4')
        extra = None
        if a.kind in REBUILD_KINDS:          # an off camera, or no new frame since the last build: no encode
            newest = newest_stamp(stamps, lo, hi)
            skip, why, backfill = rebuild_skip(a.kind, v, off, newest, st, read_side(out), os.path.isfile(out))
            if skip:
                if backfill:
                    side = dict(read_side(out), newest_frame=backfill)
                    with open(out + '.json', 'w') as f:
                        json.dump(side, f, indent=1)
                print(json.dumps({'view': v, 'label': name, 'skipped': why}))
                continue
            extra = {'newest_frame': newest}
        try:
            side = build(v, st, out, name, max_src_fps=MAX_SRC_FPS if bucket is None else FPS, smooth_job=sj,
                         **({'extra': extra} if extra else {}))
            print(json.dumps(side))
            sides.append(dict(side, out=out))
        except subprocess.CalledProcessError as e:
            print(json.dumps({'view': v, 'label': name, 'error': str(e)[:300]}))
            rc = 1
    if a.kind == 'daily':
        scenes = build_scene_clips(name, lo, hi, sj)       # one clip per scene live that day (camdirector-01)
        try:
            print(json.dumps(build_reel(name, sides, os.path.join(ROOT, 'video', f'{name}-reel.mp4'), scenes=scenes,
                                        off=off)))
        except subprocess.CalledProcessError as e:
            print(json.dumps({'view': 'reel', 'label': name, 'error': str(e)[:300]}))
            rc = 1
        thin(apply=True)          # acts only below THIN_BELOW_FREE_GB free; otherwise one report line
    return rc


if __name__ == '__main__':
    sys.exit(main())
