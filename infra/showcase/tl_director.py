#!/usr/bin/env python3
"""THE ACTIVITY DIRECTOR (camdirector-01, owner 11-16: "I'd like cameras to show what the bots are working on, and
interesting things going on"). Measured the same day over 12 h: 64% of bot time is underground and 11% is on the surface
of the inner town, where every fixed camera points. The director finds where the bots ARE and what they are doing, and
gives the 15-minute slot its cameras from that.

OPERATOR NOTE
  Runs        inside tl_showcase.py's 15-minute slot (after the render, before the plan), only while tl.conf says
              "director": {"on": true}. No timer, no unit, no process of its own.
  Reads       the TAIL of each bot's skill log (tl.conf director.log_glob, default
              /var/log/mcai/showcase-*/skill-showcase-*.jsonl): `@timestamp`, `bot.pos {x, y, z}`, `skill.name`,
              `skill.duration_ms`, `skill.detail`; `_build` rows (op=place|clear project=<p> cell=x,y,z), `_death` rows,
              `_structure_complete` rows. The project records' boxes (handed in by tl_showcase.project_sites). Its own
              state, logs/scenes.json.
  Writes      logs/scenes.json            the live scenes (ids, boxes, captions, hold clocks), the still-bot tracker
              logs/scenes-slot.json       THE HAND-OFF: this slot's scene list (format below), for tl_under.py
              logs/scenes-<YYYYMMDD>.jsonl  the same object, one line per slot (tl_video ranks the day's scenes from it)
              all under tl.conf `root`, each written to a .part file and renamed. Nothing else; the world, the bots and
              their logs are only read.
  Cost bound  per pass: at most director.tail_bytes (2 MB) read from the END of each log file, whatever its size (a
              50 MB file is not read whole: tested by counting the bytes), so <= 14 x 2 MB; only lines stamped inside
              the window (45 min + 10 min slack) are JSON-parsed. No full log scan, no rotated file, no ffmpeg, no
              browser. Measured on the 11-16 sample: see the camdirector-01 report. THE CAMERAS it adds are bounded
              separately: its scene cameras go first in the slot plan but inside the slot's own budget_s, and never
              more than director.scene_budget_s (90 s) of estimated capture per slot; the cameras in director.replaces
              (project4k) give up their slot whenever a scene camera is planned, and the cameras in
              director.idle_only (grounds, patina, iso) drop to their idle interval while the director is on. A slot
              that shoots a scene camera plans no more than director.slot_s (360 s from its start: what a slot took
              on 11-16, 6 of every 15 minutes) -- a fixed camera that no longer fits waits for the next slot.
  Off switch  tl.conf "director": {"on": false} (or no `director` key at all): tl_showcase never imports this file
              and plans exactly the cameras it planned before (tested: test_director.py DirectorOff). Its three files
              then simply stop changing; delete them or leave them.
  Look        tl_director.py scenes     what the next slot would film and why; read-only, writes nothing
              tl_showcase.py plan       the whole slot plan, the director's cameras included; read-only
  After 23:59Z the bots' logs rotate (copytruncate + gzip): for up to 45 minutes the window is short. The rotated
  .gz is deliberately NOT read (it cannot be tailed); scenes live through it on the hold time.

WHAT A SCENE IS
  The last window_min (45) minutes of bot positions are binned into cells (cell = 24 blocks square) in three layers:
  surface (y >= surface_y 58), shallow (deep_y 30 <= y < 58), deep (y < 30). A cell's score is its bot-minutes weighted
  by the skill in hand (weights: build 4, mine 2.5, gather 2.5, work 1.2, walk 0.3, idle 0.05) plus change_weight
  (0.25) per `_build` block placed or cleared in it. Adjacent busy cells of ONE layer merge into a scene (at most
  max_span_cells = 3 cells across; a neighbour joins only with join_frac = a fifth of the busiest cell's score, so
  a path the bots merely walk does not stretch the scene), which gets a bounding box from the positions themselves, its bots, and a caption
  built from the data ("4 bots mining under the town, y 12-30", "2 bots building the yard").
  A scene keeps its id from slot to slot while a busy cluster of the same layer overlaps it; with none it stays live
  for hold_min (30), then closes. At most max_surface (3) surface and max_under (2) underground scenes are live.
  EVENTS open a short scene of their own (event_min, 15): a death, a project completion, a bot that moves again
  after still_min (30) minutes still. An event scene is shot first, once.
  A live SURFACE scene gets a BlueMap camera `scene-<id>` framed on its box exactly as a follow camera frames a
  project box (tl_showcase.follow_camera over director.scene_camera). An UNDERGROUND scene gets no camera here (the
  map cannot show it): it is handed to tl_under.py through the hand-off file.

THE HAND-OFF FILE  logs/scenes-slot.json  (rewritten every slot; one JSON object)
  v            1
  t            when the director ran, UTC, "2026-11-16T12:45:07Z"
  stamp        the slot's frame stamp, "20261116T1245Z": a frame of this slot is named <stamp>.png
  window_min   the minutes of bot activity behind the scores
  scenes       every LIVE scene, in shooting order (most important first). Each:
    id         stable for the scene's whole life, [a-z0-9T] only: "d20261116T1215a" (s surface, u shallow, d deep,
               e event; then the minute it opened; then a letter)
    layer      "surface" | "shallow" | "deep"
    kind       "activity" | "death" | "complete" | "moved"
    box        [x0, z0, x1, z1] block coordinates, inclusive, x0 <= x1 and z0 <= z1: the bots' own extent
    y          [lowest, highest] block height of the bots in it
    g          the height the bots stand at (the median): a camera's ground
    score      weighted bot-minutes in the window now (0 while the scene is only being held)
    active     true while a busy cluster matched it this slot; false = held (hold_min), then it disappears
    bots       names, busiest first ("Alpha", not "showcase-Alpha")
    caption    one plain line built from the data
    project    the project record it is named after, or null
    skill      the dominant skill class: build | mine | gather | work | walk | idle
    opened     when it opened, UTC
    camera     "scene-<id>" for a surface scene (tl_showcase shoots it), null for an underground one
    frames     the frames directory the scene's pictures belong in, relative to `root`:
               "frames/scene-<id>" (surface, written by tl_showcase) or "frames/under-<id>" (underground: tl_under
               writes frames/under-<id>/<YYYYMMDD>/<stamp>.png and, beside each, <stamp>.json carrying at least
               {"scene": id, "caption": ..., "bots": [...], "layer": ..., "score": ...} -- the same fields
               tl_showcase puts in a scene camera's sidecar; tl_video reads both the same way)

Pure functions (tested in test_director.py, each rule with a mutant): layer_of, skill_class, parse_row, when,
samples_of, changes_of, scene_project, caption_of, cluster, find_events, continuity, scene_rank, scene_cameras,
apply_cameras, slot_file, note_shots. I/O: read_tail, load_rows, run, finish.
"""
import bisect
import calendar
import datetime as dt
import glob
import json
import math
import os
import re
import sys
import time

DEFAULTS = {
    'on': False,
    'log_glob': '/var/log/mcai/showcase-*/skill-showcase-*.jsonl',
    'tail_bytes': 2_000_000,          # read from the end of each log file, never more
    'window_min': 45, 'slack_min': 10, 'fresh_min': 15,
    'bin_s': 10, 'max_gap_s': 60,
    'cell': 24, 'surface_y': 58, 'deep_y': 30,
    'weights': {'build': 4.0, 'mine': 2.5, 'gather': 2.5, 'work': 1.2, 'walk': 0.3, 'idle': 0.05},
    'skill_class': {},                # {skill name: class} overrides of SKILL_CLASS
    'change_weight': 0.25,
    'min_cell_score': 2.0, 'join_frac': 0.2, 'min_scene_score': 8.0, 'min_fresh_score': 1.0, 'max_span_cells': 3,
    'min_bot_s': 120, 'top': 8,
    'hold_min': 30, 'max_surface': 3, 'max_under': 2,
    'event_min': 15, 'still_min': 30, 'still_r': 3, 'moved_r': 8, 'event_r': 10, 'max_events': 2,
    'scene_budget_s': 90,             # the scene cameras' own ceiling per slot (estimated capture seconds)
    'slot_s': 360,                    # a slot with a scene camera plans no more than this in all (measured 11-16)
    'scene_camera': {'ortho': 0, 'mode': 'perspective', 'width': 1440, 'height': 1440, 'markers': [], 'est_s': 40,
                     'y': 69, 'rotation': 0.7854, 'angle': 0.6, 'fov': 32, 'min_distance': 40, 'fit': 2.2},
    'idle_only': ['grounds', 'patina', 'iso'],
    'replaces': ['project4k'],
    'town_r': 64, 'names': {}, 'name_min_changes': 3, 'name_max_side': 64,
    'name_exclude': ['tidy', 'paths', 'forest', 'decor', 'dress', 'road', 'wall', 'wallext', 'walldemo', 'grounds'],
}
LAYERS = ('surface', 'shallow', 'deep')
GROUP = {'surface': 'surface', 'shallow': 'under', 'deep': 'under'}
ID_PREFIX = {'surface': 's', 'shallow': 'u', 'deep': 'd'}
# The skill in hand -> what the bot is doing. Anything not named here: `build*` builds, `*mine*` mines, a name that
# starts with `_` or is unknown counts as work at a station.
SKILL_CLASS = {
    'place': 'build', 'repair': 'build',
    'mine': 'mine', 'deep_mine': 'mine',
    'gather': 'gather', 'bucket': 'gather', 'harvest': 'gather',
    'goto': 'walk', 'explore': 'walk', 'home': 'walk', 'surface': 'walk', 'follow': 'walk', 'come': 'walk',
    '?': 'idle', '': 'idle', 'status': 'idle', 'idle': 'idle', 'wait': 'idle', 'eat': 'idle', 'sleep': 'idle',
}
VERB = {'build': 'building', 'mine': 'mining', 'gather': 'gathering', 'work': 'working', 'walk': 'on the move',
        'idle': 'waiting'}
RX_P, RX_O = re.compile(r'project=(\S+)'), re.compile(r'op=(\S+)')
RX_C = re.compile(r'cell=(-?\d+),(-?\d+),(-?\d+)')
TS_KEY = b'"@timestamp":"'


def dconf(cfg):
    """tl.conf's `director` object over DEFAULTS (weights and scene_camera merge key by key). Pure (tested)."""
    d = (cfg or {}).get('director') or {}
    out = dict(DEFAULTS, **d)
    for k in ('weights', 'scene_camera'):
        out[k] = dict(DEFAULTS[k], **(d.get(k) or {}))
    return out


def director_on(cfg):
    """Only an explicit "director": {"on": true}. Pure (tested)."""
    return bool(((cfg or {}).get('director') or {}).get('on'))


def iso(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def epoch(s):
    """'2026-11-16T12:45:07.123Z' -> epoch seconds (float), else None."""
    try:
        base = calendar.timegm((int(s[0:4]), int(s[5:7]), int(s[8:10]), int(s[11:13]), int(s[14:16]), int(s[17:19])))
    except (ValueError, TypeError, IndexError):
        return None
    frac = s[20:23] if len(s) > 20 and s[19] == '.' else ''
    return base + (int(frac) / 10 ** len(frac) if frac.isdigit() else 0.0)


def layer_of(y, dc):
    """surface (y >= surface_y), shallow (deep_y <= y < surface_y), deep (y < deep_y). Pure (tested)."""
    return 'surface' if y >= dc['surface_y'] else ('shallow' if y >= dc['deep_y'] else 'deep')


def skill_class(name, dc):
    """build | mine | gather | work | walk | idle for a skill name. Pure (tested)."""
    name = str(name or '')
    over = dc.get('skill_class') or {}
    if name in over:
        return over[name]
    if name in SKILL_CLASS:
        return SKILL_CLASS[name]
    if name.startswith('build'):
        return 'build'
    if 'mine' in name:
        return 'mine'
    return 'work'


# --------------------------------------------------------------------------------------------- reading the logs
def parse_row(line):
    """One skill-log line (str or bytes) -> {'t': epoch s, 'bot': 'Alpha' or None, 'pos': (x, y, z) or None,
    'name': skill.name, 'dur': skill.duration_ms in s, 'detail': str}, else None. Pure (tested)."""
    try:
        r = json.loads(line)
    except ValueError:
        return None
    if not isinstance(r, dict):
        return None
    t = epoch(r.get('@timestamp') or '')
    if t is None:
        return None
    bot, sk = r.get('bot') or {}, r.get('skill') or {}
    p = bot.get('pos') if isinstance(bot, dict) else None
    pos = None
    if isinstance(p, dict):
        try:
            pos = (float(p['x']), float(p['y']), float(p['z']))
        except (KeyError, TypeError, ValueError):
            pos = None
    name = str((bot.get('name') if isinstance(bot, dict) else '') or '')
    try:
        dur = max(0.0, float(sk.get('duration_ms') or 0) / 1000.0)
    except (TypeError, ValueError):
        dur = 0.0
    return {'t': t, 'bot': name[len('showcase-'):] if name.startswith('showcase-') else (name or None), 'pos': pos,
            'name': str(sk.get('name') or ''), 'dur': dur, 'detail': str(sk.get('detail') or '')}


def read_tail(path, max_bytes, since=None):
    """The complete lines in the LAST max_bytes of a file that are stamped at or after `since` (an ISO prefix such as
    '2026-11-16T11:50:00'; None: all). The file is never read from its start: one seek, one read of at most max_bytes.
    A first line cut by the seek and a half-written last line are dropped. -> ([line bytes], bytes read)."""
    with open(path, 'rb') as f:
        size = os.fstat(f.fileno()).st_size
        off = max(0, size - int(max_bytes))
        f.seek(off)
        data = f.read(int(max_bytes))
    n = len(data)
    if off > 0:
        cut = data.find(b'\n')
        data = data[cut + 1:] if cut >= 0 else b''
    data = data[:data.rfind(b'\n') + 1]
    lo = since.encode() if since else None
    out = []
    for raw in data.split(b'\n'):
        i = raw.find(TS_KEY)
        if i < 0 or (lo is not None and raw[i + 14:i + 14 + len(lo)] < lo):
            continue
        out.append(raw)
    return out, n


def bot_of(path):
    """'/var/log/mcai/showcase-Alpha/skill-showcase-Alpha.jsonl' -> 'Alpha'. Pure."""
    b = os.path.basename(path)
    b = b[len('skill-'):] if b.startswith('skill-') else b
    b = b[len('showcase-'):] if b.startswith('showcase-') else b
    return b.split('.')[0]


def load_rows(dc, now):
    """The window's rows of every live bot log, by bot -> ({bot: [row]}, stats). At most tail_bytes per file. A file
    that cannot be read is counted, not fatal. FIXTURE logs are not bots (tl_extract's rule)."""
    since = iso(now - (dc['window_min'] + dc['slack_min']) * 60)[:19]
    out, stats = {}, {'files': 0, 'bytes': 0, 'lines': 0, 'rows': 0, 'unreadable': 0}
    for f in sorted(glob.glob(dc['log_glob'])):
        if 'FIXTURE' in f:
            continue
        try:
            lines, n = read_tail(f, dc['tail_bytes'], since)
        except OSError:
            stats['unreadable'] += 1
            continue
        stats['files'] += 1
        stats['bytes'] += n
        stats['lines'] += len(lines)
        name = bot_of(f)
        for raw in lines:
            r = parse_row(raw)
            if r:
                out.setdefault(r['bot'] or name, []).append(r)
                stats['rows'] += 1
    return out, stats


def when(r):
    """When a row's POSITION was true. A SKILL row is stamped when the skill STARTED and carries the position where it
    ENDED (logger.mjs logSkill: `@timestamp` = startedAt, the snapshot taken at completion): start + duration. An event
    row (`_name`) is stamped when it was written. Pure (tested)."""
    return r['t'] + (r['dur'] if r['name'] and not r['name'].startswith('_') else 0.0)


def samples_of(rows, lo, hi, dc):
    """One bot's rows -> its position samples [(t, x, y, z, skill in hand)], one per bin_s (the last row of the bin),
    each at the moment its position was true (when). The skill in hand at a moment is the latest skill row that had
    started by then: the one running, or -- for a skill still running and not logged yet -- the one before it.
    Pure (tested)."""
    starts, names, pts = [], [], []
    for r in sorted(rows, key=lambda r: r['t']):
        if r['name'] and not r['name'].startswith('_'):
            starts.append(r['t'])
            names.append(r['name'])
    for r in rows:
        if r['pos'] is None:
            continue
        t = when(r)
        if lo <= t <= hi:
            pts.append((t, r['pos']))
    pts.sort()
    bins = {}
    for t, p in pts:
        bins[int(t // dc['bin_s'])] = (t, p)
    out = []
    for k in sorted(bins):
        t, p = bins[k]
        i = bisect.bisect_right(starts, t) - 1
        out.append((t, p[0], p[1], p[2], names[i] if i >= 0 else '?'))
    return out


def changes_of(rows, lo, hi):
    """One bot's rows -> the blocks it placed or cleared in [lo, hi]: [(t, op, project, x, y, z)]. Pure (tested)."""
    out = []
    for r in rows:
        if r['name'] != '_build' or not (lo <= r['t'] <= hi):
            continue
        o, c = RX_O.search(r['detail']), RX_C.search(r['detail'])
        if not (o and c) or o.group(1) not in ('place', 'clear'):
            continue
        p = RX_P.search(r['detail'])
        out.append((r['t'], o.group(1), p.group(1) if p else None, int(c.group(1)), int(c.group(2)), int(c.group(3))))
    return out


# ------------------------------------------------------------------------------------------------------- scenes
def _median(v):
    v = sorted(v)
    return v[len(v) // 2] if v else None


def _compass(dx, dz):
    """Minecraft: north is -z, east is +x."""
    names = ('east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east')
    return names[int(round(math.atan2(dz, dx) / (math.pi / 4))) % 8]


def scene_project(box, layer, by_project, sites, dc):
    """The project a scene is named after, or None. First the project whose blocks the bots placed or cleared IN the
    scene (at least name_min_changes); else, for a surface scene, the project record whose box overlaps the scene's box
    the most. Never a name in name_exclude (area-wide jobs: tidy, paths, wall ...) and never by overlap with a box wider
    than name_max_side (it would name everything). Pure (tested)."""
    excl = set(dc['name_exclude'])
    placed = {p: n for p, n in (by_project or {}).items() if p and p not in excl and n >= dc['name_min_changes']}
    if placed:
        return max(sorted(placed), key=lambda p: placed[p])
    if layer != 'surface':
        return None
    best = None
    for name in sorted(sites or {}):
        b = (sites[name] or {}).get('box')
        if name in excl or not b:
            continue
        x0, x1, z0, z1 = min(b[0], b[2]), max(b[0], b[2]), min(b[1], b[3]), max(b[1], b[3])
        if max(x1 - x0, z1 - z0) + 1 > dc['name_max_side']:
            continue
        w = min(x1, box[2]) - max(x0, box[0]) + 1
        h = min(z1, box[3]) - max(z0, box[1]) + 1
        if w > 0 and h > 0 and (best is None or w * h > best[0]):
            best = (w * h, name)
    return best[1] if best else None


def caption_of(n_bots, skill, layer, box, yr, project, dc, home=(0, 0)):
    """The scene's one plain line, built from the data: who, doing what, where. Pure (tested)."""
    who = f"{n_bots} bot{'' if n_bots == 1 else 's'}"
    verb = VERB.get(skill, 'working')
    under = layer != 'surface'
    if project:
        label = (dc.get('names') or {}).get(project) or project
        where = f'the {label}' if skill == 'build' else f'at the {label}'
    else:
        cx, cz = (box[0] + box[2]) / 2.0, (box[1] + box[3]) / 2.0
        dist = math.hypot(cx - home[0], cz - home[1])
        if dist <= dc['town_r']:
            where = 'under the town' if under else 'in the town'
        else:
            where = (f"{'underground, ' if under else ''}{int(round(dist / 10.0)) * 10} blocks "
                     f"{_compass(cx - home[0], cz - home[1])} of the town")
    return f'{who} {verb} {where}' + ((f', y {yr[0]}-{yr[1]}' if yr[0] >= 0 else f', y {yr[0]} to {yr[1]}') if under else '')


def cluster(samples, changes, sites, now, dc, home=(0, 0)):
    """The window's scenes, ranked. samples: {bot: [(t, x, y, z, skill)]}; changes: [(t, op, project, x, y, z)];
    sites: {project: {'box': [x0, z0, x1, z1]}}; now: epoch s. Each sample holds until the bot's next one (at most
    max_gap_s; the last until `now`). -> [{'layer', 'cells', 'box', 'y', 'g', 'score', 'fresh', 'bot_min', 'bots',
    'skill', 'changes', 'project', 'caption'}], best first, at most `top`, none below min_scene_score. `fresh` is the
    part of the score earned in the last fresh_min. Pure (tested)."""
    size, fresh_lo, cells = dc['cell'], now - dc['fresh_min'] * 60, {}

    def cell(layer, x, z):
        k = (layer, int(math.floor(x / size)), int(math.floor(z / size)))
        if k not in cells:
            cells[k] = {'score': 0.0, 'fresh': 0.0, 'sec': 0.0, 'bots': {}, 'cls': {}, 'ys': [], 'cys': [],
                        'x0': x, 'x1': x, 'z0': z, 'z1': z, 'changes': 0, 'proj': {}}
        a = cells[k]
        a['x0'], a['x1'], a['z0'], a['z1'] = min(a['x0'], x), max(a['x1'], x), min(a['z0'], z), max(a['z1'], z)
        return a

    for bot, pts in samples.items():
        pts = sorted(pts)
        for i, (t, x, y, z, skill) in enumerate(pts):
            nxt = pts[i + 1][0] if i + 1 < len(pts) else now
            dwell = min(max(0.0, nxt - t), dc['max_gap_s'])
            if dwell <= 0:
                continue
            cls = skill_class(skill, dc)
            pts_score = dwell / 60.0 * float(dc['weights'].get(cls, 1.0))
            a = cell(layer_of(y, dc), x, z)
            a['score'] += pts_score
            a['fresh'] += pts_score if t >= fresh_lo else 0.0
            a['sec'] += dwell
            a['bots'][bot] = a['bots'].get(bot, 0.0) + dwell
            a['cls'][cls] = a['cls'].get(cls, 0.0) + pts_score
            a['ys'].append(y)
    for t, op, project, x, y, z in changes:
        a = cell(layer_of(y, dc), x, z)
        a['score'] += dc['change_weight']
        a['fresh'] += dc['change_weight'] if t >= fresh_lo else 0.0
        a['changes'] += 1
        a['cys'].append(y)
        if project:
            a['proj'][project] = a['proj'].get(project, 0) + 1

    hot = {k: a for k, a in cells.items() if a['score'] >= dc['min_cell_score']}
    rank = lambda k: (-hot[k]['score'], k)
    taken, scenes, span = set(), [], int(dc['max_span_cells'])
    for seed in sorted(hot, key=rank):
        if seed in taken:
            continue
        taken.add(seed)
        group, todo, floor = [seed], [seed], hot[seed]['score'] * float(dc.get('join_frac') or 0)
        bx0 = bx1 = seed[1]
        bz0 = bz1 = seed[2]
        while todo:                       # grow over adjacent busy cells of the same layer, busiest first
            cur = todo.pop(0)
            near = [(cur[0], cur[1] + dx, cur[2] + dz) for dx in (-1, 0, 1) for dz in (-1, 0, 1) if dx or dz]
            for n in sorted((n for n in near if n in hot and n not in taken and hot[n]['score'] >= floor), key=rank):
                x0, x1, z0, z1 = min(bx0, n[1]), max(bx1, n[1]), min(bz0, n[2]), max(bz1, n[2])
                if x1 - x0 + 1 > span or z1 - z0 + 1 > span:
                    continue
                bx0, bx1, bz0, bz1 = x0, x1, z0, z1
                taken.add(n)
                group.append(n)
                todo.append(n)
        parts = [hot[k] for k in group]
        score = sum(a['score'] for a in parts)
        if score < dc['min_scene_score']:
            continue
        bots, cls, proj, ys, cys = {}, {}, {}, [], []
        for a in parts:
            for b, s in a['bots'].items():
                bots[b] = bots.get(b, 0.0) + s
            for c, s in a['cls'].items():
                cls[c] = cls.get(c, 0.0) + s
            for p, n in a['proj'].items():
                proj[p] = proj.get(p, 0) + n
            ys += a['ys']
            cys += a['cys']
        ys = ys or cys
        layer = seed[0]
        box = [int(math.floor(min(a['x0'] for a in parts))), int(math.floor(min(a['z0'] for a in parts))),
               int(math.ceil(max(a['x1'] for a in parts))), int(math.ceil(max(a['z1'] for a in parts)))]
        yr = [int(math.floor(min(ys))), int(math.ceil(max(ys)))]
        order = sorted(bots, key=lambda b: (-bots[b], b))
        names = [b for b in order if bots[b] >= dc['min_bot_s']] or order[:1]
        skill = max(sorted(cls), key=lambda c: cls[c]) if cls else 'build'
        project = scene_project(box, layer, proj, sites, dc)
        scenes.append({'layer': layer, 'cells': sorted([k[1], k[2]] for k in group), 'box': box, 'y': yr,
                       'g': int(round(_median(ys))), 'score': round(score, 1),
                       'fresh': round(sum(a['fresh'] for a in parts), 1),
                       'bot_min': round(sum(a['sec'] for a in parts) / 60.0, 1), 'bots': names, 'skill': skill,
                       'changes': sum(a['changes'] for a in parts), 'project': project,
                       'caption': caption_of(len(names), skill, layer, box, yr, project, dc, home)})
    scenes.sort(key=lambda s: (-s['score'], LAYERS.index(s['layer']), s['cells']))
    return scenes[:int(dc['top'])]


# ------------------------------------------------------------------------------------------------------- events
def find_events(rows_by_bot, tracker, seen, since, now, dc, sites=None):
    """What happened since the last pass that deserves a look: a death (`_death` row), a project completion
    (`_structure_complete` row, op=complete), a bot that had not moved more than still_r blocks for still_min minutes
    and is now moved_r or more away. tracker: {bot: {'pos': [x, y, z], 'since': t, 'last': t}} (where each bot has
    been standing, kept between passes); seen: event keys already used. Only rows newer than `since` make an event.
    -> ([{'kind', 'key', 't', 'bot', 'pos', 'caption', 'project', 'box'}], tracker, seen). Pure (tested)."""
    tracker = {b: dict(v) for b, v in (tracker or {}).items()}
    seen, known, events = list(seen or []), set(seen or []), []
    names = dc.get('names') or {}
    for bot in sorted(rows_by_bot):
        rows = sorted(rows_by_bot[bot], key=lambda r: r['t'])
        for r in rows:
            if not (since < r['t'] <= now) or r['pos'] is None:
                continue
            ev = None
            if r['name'] == '_death':
                ev = {'kind': 'death', 'caption': f'{bot} died here', 'project': None}
            elif r['name'] == '_structure_complete' and 'op=complete' in r['detail']:
                p = RX_P.search(r['detail'])
                project = p.group(1) if p else None
                ev = {'kind': 'complete', 'project': project,
                      'caption': f"the {names.get(project) or project or 'project'} is finished"}
                b = ((sites or {}).get(project) or {}).get('box')
                if b:
                    ev['box'] = [min(b[0], b[2]), min(b[1], b[3]), max(b[0], b[2]), max(b[1], b[3])]
            if ev:
                ev.update(key=f"{ev['kind']}:{bot}:{int(r['t'])}", t=r['t'], bot=bot, pos=list(r['pos']))
                events.append(ev)
        tr = tracker.get(bot)
        for t, r in sorted(((when(r), r) for r in rows if r['pos'] is not None), key=lambda x: x[0]):
            if tr and t <= tr['last']:       # the still-bot tracker walks every position it has not seen yet
                continue
            if tr is None:
                tr = {'pos': list(r['pos']), 'since': t, 'last': t}
                continue
            d = math.dist(r['pos'], tr['pos'])
            if d <= dc['still_r']:
                tr['last'] = t
                continue
            still = tr['last'] - tr['since']
            if d >= dc['moved_r'] and still >= dc['still_min'] * 60 and since < t <= now:
                events.append({'kind': 'moved', 'key': f"moved:{bot}:{int(t)}", 't': t, 'bot': bot,
                               'pos': list(r['pos']), 'project': None,
                               'caption': f'{bot} is moving again after {int(still // 60)} min still'})
            tr = {'pos': list(r['pos']), 'since': t, 'last': t}
        if tr:
            tracker[bot] = tr
    out = []
    for ev in sorted(events, key=lambda e: (e['t'], e['key'])):
        if ev['key'] in known:
            continue
        known.add(ev['key'])
        seen.append(ev['key'])
        out.append(ev)
    return out, tracker, seen[-200:]


# --------------------------------------------------------------------------------------------------- continuity
def _ts(s):
    return epoch(s) if s else None


def _overlap(scene, c):
    """How much a cluster continues a scene: the cells they share, else 0.5 when only their boxes touch, else 0."""
    shared = len({tuple(k) for k in scene.get('cells') or ()} & {tuple(k) for k in c.get('cells') or ()})
    if shared:
        return float(shared)
    a, b = scene['box'], c['box']
    return 0.5 if a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3] else 0.0


def _new_id(prefix, now, used):
    stem = prefix + dt.datetime.fromtimestamp(now, dt.timezone.utc).strftime('%Y%m%dT%H%M')
    for k in range(26 * 26):
        sid = stem + (chr(97 + k) if k < 26 else chr(96 + k // 26) + chr(97 + k % 26))
        if sid not in used:
            used.add(sid)
            return sid
    raise ValueError('no free scene id this minute')


def _is_event(s):
    return s.get('kind', 'activity') != 'activity'


def scene_rank(s):
    """Shooting order: an event not yet shot (it takes priority ONCE), then scenes that are busy now, then held ones;
    inside each the higher score, then the id."""
    return (0 if _is_event(s) and not s.get('shots') else 1, 0 if s.get('active') else 1, -(s.get('score') or 0), s['id'])


def continuity(prev, clusters, events, now, dc):
    """The live scenes after this pass. prev: last pass's state ({'scenes': [...]}) or None; clusters: cluster()'s
    ranked scenes; events: find_events()'s; now: epoch s.
      * a live scene KEEPS ITS ID while a busy cluster (fresh >= min_fresh_score) of the same layer overlaps it
        (shares a cell, or at least touches its box; of several, the busiest), and takes that cluster's box, bots,
        caption and score;
      * with none it is HELD (active false, score 0, its last box and caption) for hold_min, then CLOSED;
      * an unclaimed busy cluster opens a new scene while its group (surface / underground) is under its cap
        (max_surface, max_under); at the cap it may take the place of a HELD scene, never of a busy one;
      * an event opens a scene that lives event_min; at most max_events at once (the oldest gives way).
    -> {'v': 1, 't': iso, 'scenes': [live, in shooting order], 'closed': [closed this pass, each with 'why']}.
    Pure (tested)."""
    now_s, hold = iso(now), dc['hold_min'] * 60
    old = [dict(s) for s in ((prev or {}).get('scenes') or [])]
    used = {s['id'] for s in old}
    live, closed = [], []
    for s in old:
        if _is_event(s):
            if (_ts(s.get('until')) or 0) <= now:
                closed.append(dict(s, closed=now_s, why='event over'))
            else:
                live.append(s)
    busy = [c for c in clusters if c.get('fresh', 0) >= dc['min_fresh_score']]
    claimed = set()
    for s in sorted((s for s in old if not _is_event(s)), key=lambda s: (-(s.get('score') or 0), s['id'])):
        best = None
        for i, c in enumerate(busy):
            if i in claimed or c['layer'] != s['layer']:
                continue
            ov = _overlap(s, c)                 # a cluster sharing a cell before one that only touches; then the
            key = (ov >= 1, c['score'], ov)     # BUSIEST: when a scene splits, its id follows the action
            if ov > 0 and (best is None or key > best[0]):
                best = (key, i)
        if best:
            claimed.add(best[1])
            c = busy[best[1]]
            s.update({k: c[k] for k in ('cells', 'box', 'y', 'g', 'score', 'fresh', 'bots', 'skill', 'project',
                                         'caption')})
            s.update(active=True, last_active=now_s, peak=max(s.get('peak') or 0, c['score']))
            live.append(s)
        elif now - (_ts(s.get('last_active')) or 0) > hold:
            closed.append(dict(s, active=False, score=0, closed=now_s, why=f"quiet for more than {dc['hold_min']} min"))
        else:
            s.update(active=False, score=0, fresh=0)
            live.append(s)
    for i, c in enumerate(busy):
        if i in claimed:
            continue
        group = GROUP[c['layer']]
        mine = [s for s in live if not _is_event(s) and GROUP[s['layer']] == group]
        if len(mine) >= int(dc['max_surface'] if group == 'surface' else dc['max_under']):
            held = [s for s in mine if not s.get('active')]
            if not held:
                continue
            out = min(held, key=lambda s: (s.get('last_active') or '', s['id']))
            live.remove(out)
            closed.append(dict(out, closed=now_s, why='gave its place to a busier scene'))
        live.append(dict({k: c[k] for k in ('layer', 'cells', 'box', 'y', 'g', 'score', 'fresh', 'bots', 'skill',
                                             'project', 'caption')},
                         id=_new_id(ID_PREFIX[c['layer']], now, used), kind='activity', active=True, opened=now_s,
                         last_active=now_s, peak=c['score'], shots=0, last_shot=None))
    r = int(dc['event_r'])
    for ev in events:
        x, y, z = ev['pos']
        box = ev.get('box') or [int(math.floor(x)) - r, int(math.floor(z)) - r, int(math.floor(x)) + r,
                                int(math.floor(z)) + r]
        live.append({'id': _new_id('e', now, used), 'kind': ev['kind'], 'layer': layer_of(y, dc), 'cells': [],
                     'box': box, 'y': [int(math.floor(y)), int(math.ceil(y))], 'g': int(round(y)), 'score': 0,
                     'fresh': 0, 'bots': [ev['bot']], 'skill': None, 'project': ev.get('project'),
                     'caption': ev['caption'], 'active': True, 'opened': now_s, 'last_active': now_s,
                     'until': iso(now + dc['event_min'] * 60), 'peak': 0, 'shots': 0, 'last_shot': None})
    evs = sorted((s for s in live if _is_event(s)), key=lambda s: (s['opened'], s['id']))
    for s in evs[:max(0, len(evs) - int(dc['max_events']))]:
        live.remove(s)
        closed.append(dict(s, closed=now_s, why='a newer event took its place'))
    live.sort(key=scene_rank)
    return {'v': 1, 't': now_s, 'scenes': live, 'closed': closed}


# ------------------------------------------------------------------------------------------------------ cameras
def scene_label(s, dc):
    """The few words a frame's stamp line carries (tl_video.stamp_text): the project's name, else what is going on."""
    if s.get('project'):
        return (dc.get('names') or {}).get(s['project']) or s['project']
    return VERB.get(s.get('skill')) or {'death': 'a death', 'complete': 'finished', 'moved': 'moving again'}.get(
        s.get('kind'), 'scene')


def scene_cameras(scenes, dc, frame, est_s=None):
    """A camera for every live SURFACE scene, made the way a follow camera is made: frame(base camera, name, {'box',
    'g'}) is tl_showcase.follow_camera (the box's centre, the bots' ground height, a distance that fits the box, the
    base camera's fixed rotation / angle / fov). Underground scenes get none. est_s: the measured seconds of a scene
    frame, once known. -> ({'scene-<id>': camera}, [names in shooting order: an unshot event, busy before held, the
    longest unshot, the higher score]). Pure (tested)."""
    base = dict(dc['scene_camera'])
    if est_s:
        base['est_s'] = est_s
    cams, order = {}, []
    for s in scenes:
        if s['layer'] != 'surface':
            continue
        cam = frame(base, s['id'], {'box': s['box'], 'g': s.get('g')})
        cam['label'] = scene_label(s, dc)
        cam['project'] = [s['project']] if s.get('project') else []
        cam['scene'] = {'id': s['id'], 'caption': s['caption'], 'bots': list(s['bots']), 'layer': s['layer'],
                        'score': s.get('score') or 0, 'kind': s.get('kind', 'activity'), 'project': s.get('project')}
        cams['scene-' + s['id']] = cam
        order.append((scene_rank(s)[:2] + (s.get('last_shot') or '',) + scene_rank(s)[2:], 'scene-' + s['id']))
    return cams, [name for _, name in sorted(order)]


def apply_cameras(cams, dc, scene_cams):
    """The slot's cameras with the director on: every camera in idle_only is shot at its idle interval only; while at
    least one scene camera exists, every camera in `replaces` gives up its slot (off for this slot); the scene cameras
    are added. The input is not changed. Pure (tested)."""
    out = dict(cams)
    for v in dc.get('idle_only') or ():
        if isinstance(out.get(v), dict):
            out[v] = dict(out[v], idle_only=True)
    if scene_cams:
        for v in dc.get('replaces') or ():
            if v in out:
                out[v] = dict(out[v] or {}, off=True, off_why='director: a scene camera has its slot')
    out.update(scene_cams)
    return out


def slot_file(state, stamp, dc):
    """The hand-off object (the format at the top of this file) from the pass's state. Pure (tested)."""
    scenes = []
    for s in state['scenes']:
        surface = s['layer'] == 'surface'
        scenes.append({'id': s['id'], 'layer': s['layer'], 'kind': s.get('kind', 'activity'), 'box': s['box'],
                       'y': s['y'], 'g': s.get('g'), 'score': s.get('score') or 0, 'active': bool(s.get('active')),
                       'bots': list(s['bots']), 'caption': s['caption'], 'project': s.get('project'),
                       'skill': s.get('skill'), 'opened': s.get('opened'),
                       'camera': 'scene-' + s['id'] if surface else None,
                       'frames': ('frames/scene-' if surface else 'frames/under-') + s['id']})
    return {'v': 1, 't': state['t'], 'stamp': stamp, 'window_min': dc['window_min'], 'scenes': scenes}


def note_shots(state, shots, now, w=0.4):
    """The state after the slot's frames are published. shots: {scene id: seconds the frame took, or None}. Each shot
    scene counts it (an event's priority is spent) and the scene cameras' shared cost estimate `cam_s` follows the
    measured seconds (EWMA). -> a new state. Pure (tested)."""
    out = dict(state, scenes=[dict(s) for s in state.get('scenes') or []])
    for s in out['scenes']:
        if s['id'] in shots:
            s['shots'] = int(s.get('shots') or 0) + 1
            s['last_shot'] = iso(now)
    for sec in shots.values():
        if isinstance(sec, (int, float)) and sec > 0:
            old = out.get('cam_s')
            out['cam_s'] = round(sec if not old else (1 - w) * old + w * sec, 1)
    return out


# ---------------------------------------------------------------------------------------------------------- I/O
def _path(cfg, name):
    return os.path.join(cfg['root'], 'logs', name)


def load_state(cfg):
    try:
        with open(_path(cfg, 'scenes.json')) as f:
            st = json.load(f)
        return st if isinstance(st, dict) else {}
    except (OSError, ValueError):
        return {}


def _write(path, obj):
    with open(path + '.part', 'w') as f:
        json.dump(obj, f, indent=1, sort_keys=True)
    os.replace(path + '.part', path)


def save_state(cfg, state):
    os.makedirs(os.path.join(cfg['root'], 'logs'), exist_ok=True)
    _write(_path(cfg, 'scenes.json'), {k: v for k, v in state.items() if k != 'closed'})


def run(cfg, now, sites, stamp=None, frame=None, write=True, rows=None):
    """One director pass. now: aware datetime or epoch s; sites: tl_showcase.project_sites(cfg); frame:
    tl_showcase.follow_camera; rows: ({bot: [row]}, stats) instead of reading the logs (tests). write False (the
    `plan` and `scenes` commands): nothing is written. -> {'dc', 'state', 'cameras', 'first', 'slot', 'stats'}."""
    t0 = time.time()
    now = now.timestamp() if hasattr(now, 'timestamp') else float(now)
    dc = dconf(cfg)
    prev = load_state(cfg)
    by_bot, stats = rows if rows is not None else load_rows(dc, now)
    lo = now - dc['window_min'] * 60
    home = cfg.get('home') or (0, 0, 0)
    samples = {b: samples_of(r, lo, now, dc) for b, r in by_bot.items()}
    changes = [c for r in by_bot.values() for c in changes_of(r, lo, now)]
    clusters = cluster(samples, changes, sites or {}, now, dc, (home[0], home[-1]))
    since = _ts(prev.get('t')) or now - dc['fresh_min'] * 60
    events, tracker, seen = find_events(by_bot, prev.get('bots'), prev.get('seen'), since, now, dc, sites)
    state = continuity(prev, clusters, events, now, dc)
    state.update(bots=tracker, seen=seen, cam_s=prev.get('cam_s'))
    cams, first = scene_cameras(state['scenes'], dc, frame, est_s=prev.get('cam_s')) if frame else ({}, [])
    slot = slot_file(state, stamp, dc)
    stats = dict(stats, clusters=len(clusters), events=len(events), live=len(state['scenes']),
                 closed=len(state['closed']), ms=int((time.time() - t0) * 1000))
    if write:
        save_state(cfg, state)
        _write(_path(cfg, 'scenes-slot.json'), slot)
        day = dt.datetime.fromtimestamp(now, dt.timezone.utc).strftime('%Y%m%d')
        with open(_path(cfg, f'scenes-{day}.jsonl'), 'a') as f:
            f.write(json.dumps(slot, sort_keys=True) + '\n')
    return {'dc': dc, 'state': state, 'cameras': cams, 'first': first, 'slot': slot, 'stats': stats}


def finish(cfg, res, shots, now):
    """After the slot's capture: record which scene cameras got their frame (note_shots) and save the state."""
    now = now.timestamp() if hasattr(now, 'timestamp') else float(now)
    state = note_shots(res['state'], shots, now)
    save_state(cfg, state)
    return state


def summary(res):
    """The director's part of the heartbeat row / the `plan` output."""
    return {'scenes': [{'id': s['id'], 'layer': s['layer'], 'score': s['score'], 'active': s['active'],
                        'caption': s['caption'], 'camera': s['camera']} for s in res['slot']['scenes']],
            'cameras': list(res['first']), **{k: res['stats'].get(k) for k in ('files', 'bytes', 'rows', 'ms')}}


def main():
    if sys.argv[1:] != ['scenes']:
        print('usage: tl_director.py scenes     (read-only: what the next slot would film and why)')
        return 2
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import tl_showcase as T
    cfg = T.load_conf()
    res = run(cfg, T.now_utc(), T.project_sites(cfg), stamp=T.stamp_of(T.now_utc()), frame=T.follow_camera, write=False)
    print(json.dumps({'on': director_on(cfg), 'slot': res['slot'], 'cameras': res['cameras'], 'first': res['first'],
                      'closed': [{'id': s['id'], 'why': s['why']} for s in res['state']['closed']],
                      'stats': res['stats']}, indent=1))
    return 0


if __name__ == '__main__':
    sys.exit(main())
