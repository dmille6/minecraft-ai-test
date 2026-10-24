#!/usr/bin/env python3
"""hazardmap.py -- the PER-SEED HAZARD MAP (OWNER 2026-10-24: host data first; bot use later via lavasight-01, mineshaft F5b).
READ-ONLY on the fleet: it reads Elasticsearch (read-only key), the world-facts files, and COPIES of the nightly world backup.

    hazardmap.py refresh  [--home ~/hazardmap]            10.0.0.31 cron: pull the verify file, fetch ES days, build, push request
    hazardmap.py fetch    [--home ~/hazardmap] [--since DAY]          ES -> day cache (closed days re-counted, refetched on change)
    hazardmap.py build    [--home ~/hazardmap] [--verify FILE]        day cache + seeds + world facts + verify -> the map
    hazardmap.py value    [--home ~/hazardmap] [--days 7]             the map's potential value (see value())
    hazardmap.py verify   --request FILE --out DIR [--staging /srv/world-backup/staging] [--live /srv/block2]
                          [--backup-log /var/log/mcai-monitor/world-backup.log]        10.0.0.30 cron, after the nightly backup
    hazardmap.py check    [--home ~/hazardmap]            one status line (OK / HAZARDMAP ALARM), exit 1 on alarm
    hazardmap.py selftest

WHAT A HAZARD IS. A place where the WORLD killed or trapped a bot, located in ABSOLUTE block coordinates. Worlds generated
from one seed have the same terrain at the same coordinates (verify() measures that with a bedrock fingerprint), so the
evidence of every world on a seed is merged into one map per seed. Blocks change (bots dig, fill, flow), so each hazard is
re-checked in every world of its seed against the newest staged backup, read-only.

THE KINDS (KINDS below is the versioned vocabulary). Every label comes from a row the bot wrote about the world, never from an
intent row: a death and its server death message, a guard row that named a lava cell, a trapped spell of position rows.

THE ZERO RULE. A renamed death kind, an unknown fail_class, a death message no category matches, a guard row whose cell no
longer parses, a source that went silent, an unknown world: each RAISES (Blind) in the validated window rather than folding
into a smaller map. ZeroLooksWrong (lib/estelemetry) guards every count; Blind adds the format guards ES cannot know.

Pure python; ES access is lazy (lib/estelemetry, imported only by fetch), so verify() runs on 10.0.0.30 without it.
"""
import argparse
import collections
import datetime as dt
import gzip
import hashlib
import json
import math
import os
import re
import struct
import subprocess
import sys
import time
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = 'mcai.hazardmap'
SCHEMA_VERSION = 1
VERIFY_SCHEMA = 'mcai.hazardmap.verify'
REQUEST_SCHEMA = 'mcai.hazardmap.request'
DAY_SCHEMA = 5                                   # the day-cache file format; a change refetches every day
HISTORY_SINCE = '2026-08-22T00:00:00Z'           # the first Block-2 world was created 08-22 14:16Z (ext4 birth time)
VALIDATED_SINCE = '2026-10-08T00:00:00Z'         # ES reconciled from here (docs/reports/es-completeness-2026-10-14.md)
REFUSED_DAYS = ('2026-10-07',)                   # duplicate docs (lib/estelemetry KNOWN_GAPS): never folded
QUARANTINE_MS = 10 * 60 * 1000                   # rows within 10 min after a world's creation are dropped (bots rejoining)
DAY_MS = 86_400_000
STALE_AFTER_H = 36

WORLD_RE = re.compile(r'^(hive|board|isolated|placebo)-[a-d]$')
FAIL_CLASSES = frozenset({'drowning', 'fire', 'fall', 'other', 'suffocation'})
HISTORY_FAIL_CLASSES = FAIL_CLASSES | {'unknown', None}

# The death-message tally (the server's own message, first clause). Order matters: the first match wins.
# (category, regex, hazard kind or None = recognised but not a terrain hazard)
DEATH_CATS = (
    ('lava', r'tried to swim in lava(?! after)', 'lava'),
    ('lava after a fall', r'tried to swim in lava after falling', 'lava'),
    ('magma', r'discovered the floor was lava', 'lava'),
    ('burned', r'burn|walked into fire|went up in flames|crisp', 'fire'),
    ('drowned', r'^drowned', 'drowning'),
    ('stalagmite', r'stalagmite', 'dripstone'),
    ('stalactite', r'stalactite', 'dripstone'),
    ('fall', r'fell from a high place|hit the ground|fell off|doomed to fall', 'cave_fall'),
    ('suffocated', r'suffocated', 'suffocation'),
    ('contact', r'pricked to death|poked to death', None),
)
HISTORY_UNKNOWN_OK = 0.03          # before VALIDATED_SINCE up to 3% unrecognised death messages are excluded and reported

KINDS = {
    'lava': {'what': 'lava, magma or fire: fire/lava deaths and guard rows that named a lava cell', 'link': (3, 4),
             'check': 'any lava, magma_block, fire or soul_fire within 2 (xz) and -2..+1 (y) of a probe cell'},
    'fire': {'what': 'a burn death that is not lava', 'link': (3, 4), 'check': 'as lava'},
    'drowning': {'what': 'drowning deaths', 'link': (3, 4),
                 'check': 'head-deep water (two stacked water, waterlogged or water-plant cells) within 1 (xz) and -1..+1 (y) '
                          'of the death cell'},
    'water_pit': {'what': 'a trapped spell >= 30 min, >= 20% _marooned rows, in >= 50% wet 10-min buckets (the board-d pit '
                          'shape: a water cell on a solid floor, its four head-level walls solid)', 'link': (2, 2),
                  'check': 'the pit shape at a cell within 1 of the spell cell'},
    'water_ceiling_trap': {'what': 'a trapped spell >= 30 min with >= 20% _water_no_air_route rows (the board-a copper '
                                   'trap: water under a solid ceiling)', 'link': (2, 2),
                           'check': 'water at feet and head with a solid block directly above, at a cell within 1'},
    'cave_fall': {'what': 'fall deaths', 'link': (3, 4),
                  'check': '>= 4 open cells straight up from the death cell in some column within 1'},
    'dripstone': {'what': 'stalagmite / stalactite deaths', 'link': (3, 4),
                  'check': 'pointed_dripstone within 2 (xz) and -2..+16 (y) of the death cell'},
    'entombment': {'what': 'suffocation deaths, entombed give-ups (>= 3) and trapped spells >= 30 min that are >= 50% '
                           '_entombed/_entombed_unrecoverable rows', 'link': (3, 3),
                   'check': 'not block-checkable (the trap is the bot\'s own geometry or a ghost block): not_applicable'},
}

# ------------------------------------------------------------------------------------------------- small helpers


class Blind(RuntimeError):
    """The instrument could not have seen a presence: a renamed kind, an unparsed format, a silent source."""


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_ms(s):
    return int(dt.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)


def world_of(bot):
    """'isolated-d-Echo' -> 'isolated-d'. exp.pool is NOT used: isolated bots log 'self-isolated-d-Echo'."""
    parts = (bot or '').split('-')
    return '-'.join(parts[:2]) if len(parts) >= 3 else (bot or '')


def cell(pos):
    return (math.floor(pos['x']), math.floor(pos['y']), math.floor(pos['z']))


def atomic_json(path, obj, gz=False):
    os.makedirs(os.path.dirname(path) or '.', exist_ok=True)
    tmp = '%s.tmp.%d' % (path, os.getpid())
    data = json.dumps(obj, sort_keys=True, separators=(',', ':')).encode()
    with open(tmp, 'wb') as f:
        f.write(gzip.compress(data, 6) if gz else data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def load_json(path):
    with open(path, 'rb') as f:
        b = f.read()
    if b[:2] == b'\x1f\x8b':
        b = gzip.decompress(b)
    return json.loads(b)


def categorize(msg):
    head = (msg or '').split(';')[0].split('|')[0].strip()
    for cat, rx, kind in DEATH_CATS:
        if re.search(rx, head):
            return cat, kind
    return None, None


# ------------------------------------------------------------------------------------------------- the ES sources
# Each source is one event kind. `cell` says where the hazard cell comes from:
#   pos        floor(bot.pos)                          (the body: deaths, spells, give-ups, lava-adjacent holds)
#   detail_at  'lava below|beside|beside the drop at X,Y,Z' in skill.detail   (the guard named the lava cell)
#   danger     floor(bot.pos) when the detail names the DANGER block the feet are in, one below when the feet are clear
#   site_at    'death:<class> xN at X,Y,Z' -- the bot's own record of its death site (the positive control on `_death`)
SOURCES = {
    'death': {'kind': '_death', 'cell': 'pos'},
    'corridor': {'kind': '_lava_corridor', 'cell': 'detail_at'},
    'blind_lava': {'kind': '_explore_blind_step_refused', 'cell': 'detail_at', 'detail_contains': 'lava'},
    'danger': {'kind': '_reflex_danger_block', 'cell': 'danger'},
    'adjacent': {'kind': '_lava_adjacent_no_retreat', 'cell': 'pos'},
    'standoff': {'kind': '_lava_adjacent_stand_off', 'cell': 'pos'},
    'marooned': {'kind': '_marooned', 'cell': 'pos'},
    'no_air': {'kind': '_water_no_air_route', 'cell': 'pos'},
    'entombed': {'kind': '_entombed', 'cell': 'pos'},
    'gave_up': {'kind': '_entombed_unrecoverable', 'cell': 'pos'},
    'site': {'kind': '_death_site_recorded', 'cell': 'site_at'},
}
# A source that is silent across the whole validated window is a renamed kind, not a safe fleet (raise).
MUST_SPEAK = ('death', 'corridor', 'blind_lava', 'danger', 'marooned', 'no_air', 'entombed', 'gave_up', 'site')
# Recognised variants that name no lava cell: counted as `skipped`, never as unparsed (a corridor refused for UNKNOWN cells)
NOT_LAVA = {'corridor': re.compile(r'^lava_corridor: unknown at -?\d+,-?\d+,-?\d+ ')}
SITE_AT = re.compile(r'death:(\w+) x\d+ at (-?\d+),(-?\d+),(-?\d+)')
LAVA_AT = re.compile(r'lava (below|beside the drop|beside) at (-?\d+),(-?\d+),(-?\d+)')
DANGER_FEET = frozenset({'lava', 'magma_block', 'fire', 'soul_fire'})
DANGER_NOT_LAVA = frozenset({'campfire', 'soul_campfire'})      # a town campfire: recognised, skipped, never a lava hazard
DANGER_BELOW = frozenset({'air', 'cave_air', 'void_air', 'bubble_column'})
UNPARSED_OK = 0.02
WET_KIND = '_water_float'
RECENT_DAYS = 3                  # every MUST_SPEAK source and the wet kind must speak on each of the newest 3 closed days
DEATH_SITE_SLACK = 2             # per day, _death and _death_site_recorded (written in the same ms) may differ by at most 2
FIELDS = ['@timestamp', 'bot.name', 'bot.pos', 'skill.detail', 'skill.fail_class']


def compact(src, r):
    """One ES row -> [t_ms, bot, x, y, z, tag], or ('unparsed', why), or ('skip', why) for a recognised variant that names
    no hazard cell. Pure: the fold never sees ES dicts."""
    spec = SOURCES[src]
    sk = r.get('skill') or {}
    det = sk.get('detail') or ''
    bot = (r.get('bot') or {}).get('name')
    pos = (r.get('bot') or {}).get('pos') or {}
    t = parse_ms(r['@timestamp'])
    if not bot:
        return ('unparsed', 'no bot.name')
    if spec['cell'] == 'detail_at':
        m = LAVA_AT.search(det)
        if not m:
            if src in NOT_LAVA and NOT_LAVA[src].search(det):
                return ('skip', 'names no lava cell')
            return ('unparsed', det[:80])
        return [t, bot, int(m.group(2)), int(m.group(3)), int(m.group(4)), m.group(1)]
    if spec['cell'] == 'site_at':
        m = SITE_AT.search(det)
        if not m:
            return ('unparsed', det[:80])
        return [t, bot, int(m.group(2)), int(m.group(3)), int(m.group(4)), m.group(1)]
    if pos.get('x') is None or pos.get('y') is None or pos.get('z') is None:
        return ('unparsed', 'no bot.pos')
    x, y, z = cell(pos)
    if spec['cell'] == 'danger':
        if det in DANGER_NOT_LAVA:
            return ('skip', 'campfire')
        if det in DANGER_FEET:
            return [t, bot, x, y, z, 'feet:' + det]
        if det in DANGER_BELOW or (re.match(r'^[a-z_]+$', det) and PASSABLE.match('minecraft:' + det)):
            return [t, bot, x, y - 1, z, 'below:' + det]        # the feet cell is clear (air, a vine, grass): DANGER below
        return ('unparsed', det[:80])
    if src == 'death':
        return [t, bot, x, y, z, '%s|%s' % (sk.get('fail_class'), det.split('|')[0].strip()[:160])]
    return [t, bot, x, y, z, '']


def day_bounds(day):
    t0 = parse_ms(day + 'T00:00:00Z')
    return t0, t0 + DAY_MS


def fetch_day(day, EsEvents, now_ms, max_rows=500_000):
    """One UTC day from ES -> the cache record. A day is CLOSED once it ended more than an hour ago."""
    t0, t1 = day_bounds(day)
    until = min(t1, now_ms - 10 * 60 * 1000)
    ev = EsEvents.load('skill', since=iso(t0), until=iso(until))
    rec = {'schema': DAY_SCHEMA, 'day': day, 'until': iso(until), 'closed': until == t1 and now_ms - t1 > 3_600_000,
           'fetched_at': iso(now_ms), 'caveats': list(ev.caveats), 'total': int(ev.total()), 'counts': {}, 'rows': {},
           'unparsed': {}, 'unparsed_examples': {}, 'skipped': {}, 'wet': {}, 'bot_hours': {}}
    if rec['total'] == 0:
        rec['void'] = 'no documents at all'
        return rec
    for src, spec in SOURCES.items():
        kw = {'detail_contains': spec['detail_contains']} if spec.get('detail_contains') else {}
        n = int(ev.count(spec['kind'], allow_zero=True, **kw))
        rec['counts'][src] = n
        out, bad, skip = [], collections.Counter(), 0
        if n:
            for r in ev.rows(spec['kind'], fields=FIELDS, max_rows=max_rows, **kw):
                c = compact(src, r)
                if isinstance(c, tuple):
                    if c[0] == 'skip':
                        skip += 1
                    else:
                        bad[c[1]] += 1
                else:
                    out.append(c)
        rec['rows'][src] = out
        rec['skipped'][src] = skip
        rec['unparsed'][src] = sum(bad.values())
        rec['unparsed_examples'][src] = [k for k, _ in bad.most_common(3)]
    # wet 10-minute buckets per bot (the poolescape spell rule: a bucket that holds a _water_float row). The kind is COUNTED
    # like a source, so a renamed _water_float trips the recent-health check instead of turning every pit 'dry'.
    rec['counts'][WET_KIND] = int(ev.count(WET_KIND, allow_zero=True))
    h = ev.histogram(WET_KIND, interval='10m', split='bot.name', allow_zero=True)
    wet = collections.defaultdict(list)
    for b, per in h.items():
        k = parse_ms(b) // 600_000
        for bot, c in per.items():
            if c:
                wet[bot].append(k)
    rec['wet'] = {b: sorted(v) for b, v in wet.items()}
    # bot-hours per world: (bot, hour) buckets holding >= 1 row (coverage()'s definition, without the edge fraction)
    hb = ev.histogram(None, interval='1h', split='bot.name', allow_zero=True)
    bh = collections.Counter()
    for b, per in hb.items():
        for bot, c in per.items():
            if c:
                bh[world_of(bot)] += 1
    rec['bot_hours'] = dict(bh)
    return rec


def recount(day, EsEvents, now_ms):
    """(total docs, {source: count}) for a whole day, server-side: what a cached closed day must still match."""
    t0, t1 = day_bounds(day)
    ev = EsEvents.load('skill', since=iso(t0), until=iso(t1))
    total = int(ev.total())
    out = {}
    if total:
        for src, spec in SOURCES.items():
            kw = {'detail_contains': spec['detail_contains']} if spec.get('detail_contains') else {}
            out[src] = int(ev.count(spec['kind'], allow_zero=True, **kw))
        out[WET_KIND] = int(ev.count(WET_KIND, allow_zero=True))
    return total, out


def days_between(since_iso, until_ms):
    d = dt.datetime.fromisoformat(since_iso.replace('Z', '+00:00')).date()
    end = dt.datetime.fromtimestamp(until_ms / 1000, dt.timezone.utc).date()
    out = []
    while d <= end:
        out.append(d.isoformat())
        d += dt.timedelta(days=1)
    return out


def refresh_cache(cache_dir, EsEvents, now_ms, since=HISTORY_SINCE, log=print):
    """Fetch every day not cached; refetch an open day, a day cached with another DAY_SCHEMA, or a closed day whose ES counts
    changed since (a late ingest or a backfill). REFUSED_DAYS are never fetched."""
    os.makedirs(cache_dir, exist_ok=True)
    stats = collections.Counter()
    for day in days_between(since, now_ms):
        if day in REFUSED_DAYS:
            stats['refused'] += 1
            continue
        path = os.path.join(cache_dir, 'day-%s.json.gz' % day)
        rec = None
        if os.path.exists(path):
            try:
                rec = load_json(path)
            except Exception:
                rec = None
        if rec and rec.get('schema') == DAY_SCHEMA and rec.get('closed'):
            if recount(day, EsEvents, now_ms) == (rec['total'], rec['counts']):
                stats['kept'] += 1
                continue
            stats['recount_changed'] += 1
        rec = fetch_day(day, EsEvents, now_ms)
        atomic_json(path, rec, gz=True)
        stats['fetched'] += 1
        log('fetched %s: %s' % (day, ' '.join('%s=%d' % kv for kv in sorted(rec['counts'].items()))))
    return dict(stats)


def load_days(cache_dir):
    out = []
    for name in sorted(os.listdir(cache_dir)):
        if name.startswith('day-') and name.endswith('.json.gz'):
            rec = load_json(os.path.join(cache_dir, name))
            if rec.get('schema') == DAY_SCHEMA and rec['day'] not in REFUSED_DAYS:
                out.append(rec)
    return out


# ------------------------------------------------------------------------------------------------- seeds
class Seeds:
    """Which seed each world was on at each time. Built from verify()'s measurement of level.dat (staged backup copies) and
    the pre-reseed world copies on 10.0.0.30. Seeds are STRINGS: 64-bit seeds exceed a JS number (lavasight is JS)."""

    def __init__(self, worlds, horizon_ms=None):
        self.worlds = worlds            # {world: {'seed', 'home', 'segments': [{'seed', 'from_ms', 'until_ms'|None}]}}
        self.horizon_ms = horizon_ms    # the seeds were OBSERVED at verify's made_at: a row after it (+1 h) is not resolved

    @classmethod
    def from_verify(cls, v):
        if v.get('schema') != VERIFY_SCHEMA:
            raise Blind('the verify file is not %s (got %r)' % (VERIFY_SCHEMA, v.get('schema')))
        worlds = {}
        for w, info in (v.get('worlds') or {}).items():
            if not WORLD_RE.fullmatch(w):
                raise Blind('verify names a world %r outside the fleet pattern' % w)
            segs = []
            for p in sorted(info.get('previous') or [], key=lambda p: p['created']):
                segs.append({'seed': str(p['seed']), 'from_ms': parse_ms(p['created']), 'until_ms': parse_ms(p['retired'])})
            segs.append({'seed': str(info['seed']), 'from_ms': parse_ms(info['created']), 'until_ms': None})
            for a, b in zip(segs, segs[1:]):
                if a['until_ms'] > b['from_ms']:
                    raise Blind('%s: world segments overlap (%s retired after %s was created)' % (w, a['seed'], b['seed']))
            worlds[w] = {'seed': str(info['seed']), 'home': info.get('home'), 'segments': segs}
        if len(worlds) < 1:
            raise Blind('the verify file names no worlds')
        if not v.get('made_at'):
            raise Blind('the verify file has no made_at: when the seeds were observed is unknown')
        return cls(worlds, horizon_ms=parse_ms(v['made_at']) + 3_600_000)

    def seed_at(self, world, t):
        """(seed, None) or (None, why)."""
        w = self.worlds.get(world)
        if w is None:
            return None, 'unknown_world'
        if self.horizon_ms is not None and t > self.horizon_ms:
            return None, 'after_seed_observation'
        for s in w['segments']:
            if s['from_ms'] <= t and (s['until_ms'] is None or t < s['until_ms']):
                if t < s['from_ms'] + QUARANTINE_MS:
                    return None, 'quarantine'
                return s['seed'], None
        return None, 'outside_world_lifetime'

    def current(self):
        out = collections.defaultdict(list)
        for w, info in sorted(self.worlds.items()):
            out[info['seed']].append(w)
        return dict(out)


# ------------------------------------------------------------------------------------------------- the fold
def spells(rows, deaths_by_bot, gap_ms=15 * 60 * 1000, reach=3, min_ms=30 * 60 * 1000):
    """Per bot: runs of rows <= gap apart and within `reach` (3-D, blocks) of the run's first row, split at the bot's deaths.
    Returns runs lasting >= min_ms as dicts {bot, first, last, cell (the median cell), rows, srcs (rows per source)}.
    A row is [t, bot, x, y, z, tag, src]."""
    by = collections.defaultdict(list)
    for r in rows:
        by[r[1]].append(r)
    out = []
    for bot, rs in by.items():
        rs.sort(key=lambda r: r[0])
        dts = sorted(deaths_by_bot.get(bot, ()))
        cur = None

        def close(c):
            if c and c['last'] - c['first'] >= min_ms:
                xs = sorted(r[2] for r in c['rows']); ys = sorted(r[3] for r in c['rows']); zs = sorted(r[4] for r in c['rows'])
                m = len(xs) // 2
                out.append({'bot': bot, 'first': c['first'], 'last': c['last'], 'cell': (xs[m], ys[m], zs[m]), 'rows': len(c['rows']),
                            'srcs': dict(collections.Counter(r[6] for r in c['rows']))})
        for r in rs:
            if cur is not None:
                a = cur['rows'][0]
                died = any(cur['last'] < d <= r[0] for d in dts)
                far = max(abs(r[2] - a[2]), abs(r[3] - a[3]), abs(r[4] - a[4])) > reach
                if r[0] - cur['last'] > gap_ms or died or far:
                    close(cur)
                    cur = None
            if cur is None:
                cur = {'first': r[0], 'last': r[0], 'rows': [r]}
            else:
                cur['last'] = r[0]
                cur['rows'].append(r)
        close(cur)
    return out


SPELL_SRC = ('marooned', 'no_air', 'entombed', 'gave_up')


def spell_kind(sp, wet):
    """What trapped the bot, from the spell's own rows: no-air-route rows -> a ceiling trap (the board-a copper trap); else
    maroon rows in water -> a water pit (board-d); else entombed rows -> entombment; else not a hazard this map labels."""
    n = max(1, sp['rows']); c = sp['srcs']
    if c.get('no_air', 0) / n >= 0.2:
        return 'water_ceiling_trap'
    if c.get('marooned', 0) / n >= 0.2:
        return 'water_pit' if wet >= 0.5 else 'excluded:marooned_dry'
    if (c.get('entombed', 0) + c.get('gave_up', 0)) / n >= 0.5:
        return 'entombment'
    return 'excluded:mixed'


def wet_share(sp, wet):
    ks = range(sp['first'] // 600_000, sp['last'] // 600_000 + 1)
    s = set(wet.get(sp['bot'], ()))
    return sum(1 for k in ks if k in s) / max(1, len(ks))


class UF:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, a):
        while self.p[a] != a:
            self.p[a] = self.p[self.p[a]]
            a = self.p[a]
        return a

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.p[max(a, b)] = min(a, b)


def cluster(points, link, max_extent=32):
    """Single-linkage on cells within `link` = (xz, y) blocks (Chebyshev). A cluster wider than max_extent in x or z is split
    into 16x16 tiles, so a long lava-lined tunnel never becomes one site. Returns lists of point indices. Linkage runs on the
    DISTINCT cells (a bot holding still repeats one cell thousands of times), then every point joins its cell's group."""
    lxz, ly = link
    by_cell = collections.defaultdict(list)
    for i, p in enumerate(points):
        by_cell[(p['x'], p['y'], p['z'])].append(i)
    cells = list(by_cell)
    grid = collections.defaultdict(list)
    for i, (x, y, z) in enumerate(cells):
        grid[(x // (lxz + 1), y // (ly + 1), z // (lxz + 1))].append(i)
    uf = UF(len(cells))
    for (gx, gy, gz), idx in grid.items():
        near = []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    near += grid.get((gx + dx, gy + dy, gz + dz), ())
        for i in idx:
            pi = cells[i]
            for j in near:
                if j > i:
                    pj = cells[j]
                    if abs(pi[0] - pj[0]) <= lxz and abs(pi[2] - pj[2]) <= lxz and abs(pi[1] - pj[1]) <= ly:
                        uf.union(i, j)
    groups = collections.defaultdict(list)
    for i, c in enumerate(cells):
        groups[uf.find(i)].append(c)
    out = []
    for g in groups.values():
        xs = [c[0] for c in g]; zs = [c[2] for c in g]
        if max(xs) - min(xs) > max_extent or max(zs) - min(zs) > max_extent:
            tiles = collections.defaultdict(list)
            for c in g:
                tiles[(c[0] >> 4, c[2] >> 4)] += by_cell[c]
            out += list(tiles.values())
        else:
            out.append([i for c in g for i in by_cell[c]])
    return out


def classify_deaths(days, validated_ms):
    """Every death row -> {t, bot, world, cell, fail_class, category, kind}. Raises Blind on an unknown fail_class or message
    in the validated window; before it, unknowns are excluded and counted (<= HISTORY_UNKNOWN_OK of the history)."""
    out, unknown_hist, n_hist, bad = [], collections.Counter(), 0, []
    for rec in days:
        for r in rec['rows'].get('death', ()):
            t, bot, x, y, z, tag = r
            fc, _, msg = tag.partition('|')
            fc = None if fc == 'None' else fc
            cat, kind = categorize(msg)
            validated = t >= validated_ms
            if not validated:
                n_hist += 1
            if fc not in (FAIL_CLASSES if validated else HISTORY_FAIL_CLASSES) or cat is None:
                if validated:
                    bad.append('%s %s fail_class=%r message=%r' % (iso(t), bot, fc, msg[:70]))
                else:
                    unknown_hist['%s|%s' % (fc, msg[:50])] += 1
                continue
            out.append({'t': t, 'bot': bot, 'world': world_of(bot), 'cell': (x, y, z), 'fail_class': fc, 'category': cat,
                        'kind': kind})
    if bad:
        raise Blind('%d death row(s) in the validated window carry an unknown fail_class or a death message no category '
                    'matches -- a renamed kind is a blind map, not fewer deaths. First: %s' % (len(bad), bad[0]))
    if n_hist and sum(unknown_hist.values()) / n_hist > HISTORY_UNKNOWN_OK:
        raise Blind('%d of %d history death rows are unrecognised (> %.0f%%): %s' % (
            sum(unknown_hist.values()), n_hist, 100 * HISTORY_UNKNOWN_OK, unknown_hist.most_common(3)))
    return out, dict(unknown_hist)


def source_controls(days, validated_ms):
    """The positive controls on the sources: totals, rows and unparsed shares in the validated window. Raises Blind."""
    tot = collections.Counter(); unp = collections.Counter(); ex = {}; vdays = 0; spoke = collections.Counter()
    for rec in days:
        if parse_ms(rec['day'] + 'T00:00:00Z') < validated_ms or rec.get('void'):
            continue
        vdays += 1
        for src in SOURCES:
            n = len(rec['rows'].get(src, ()))
            tot[src] += n
            unp[src] += rec['unparsed'].get(src, 0)
            if n:
                spoke[src] += 1
            if rec['unparsed'].get(src):
                ex[src] = rec['unparsed_examples'].get(src)
    if not vdays:
        raise Blind('no validated day is in the cache: nothing could have been seen')
    have = {r['day'] for r in days if not r.get('void')}
    newest = max(r['day'] for r in days)
    want = [d for d in days_between(VALIDATED_SINCE, parse_ms(newest + 'T00:00:00Z')) if d not in REFUSED_DAYS]
    missing = [d for d in want if d not in have and d >= iso(validated_ms)[:10]]
    if missing:
        raise Blind('validated day(s) missing or void in the cache: %s -- a gap is not a quiet week' % missing[:5])
    for src in MUST_SPEAK:
        if tot[src] == 0:
            raise Blind('source %r (%s) is SILENT over %d validated days: a renamed kind or a broken query, not a safe fleet'
                        % (src, SOURCES[src]['kind'], vdays))
    for src in SOURCES:
        seen = tot[src] + unp[src]
        if seen and unp[src] / seen > UNPARSED_OK:
            raise Blind('source %r: %d of %d rows did not parse (> %.0f%%) -- the detail format changed? e.g. %r'
                        % (src, unp[src], seen, 100 * UNPARSED_OK, (ex.get(src) or ['?'])[0]))
    # RECENT health: a kind renamed last week is hidden by the weeks it spoke before, so each source must speak on each of
    # the newest RECENT_DAYS closed validated days (a source's rows, unparsed or skipped rows all count as speaking)
    closed = sorted((r for r in days if r.get('closed') and not r.get('void')
                     and parse_ms(r['day'] + 'T00:00:00Z') >= validated_ms), key=lambda r: r['day'])
    recent = closed[-RECENT_DAYS:]
    if len(recent) < RECENT_DAYS:
        raise Blind('only %d closed validated day(s) in the cache: the recent-health check needs %d' % (len(recent), RECENT_DAYS))
    for rec in recent:
        for src in MUST_SPEAK:
            spoke_today = len(rec['rows'].get(src, ())) + rec['unparsed'].get(src, 0) + rec.get('skipped', {}).get(src, 0)
            if not spoke_today:
                raise Blind('source %r (%s) is SILENT on %s, one of the newest %d closed days: a renamed kind or a broken '
                            'query, not a safe day' % (src, SOURCES[src]['kind'], rec['day'], RECENT_DAYS))
        if not rec['counts'].get(WET_KIND):
            raise Blind('%s is SILENT on %s: every maroon spell would read dry' % (WET_KIND, rec['day']))
    # the death count against the bot's own death-site record, day by day (an independent second writer of every death)
    recon = {}
    for rec in days:
        if parse_ms(rec['day'] + 'T00:00:00Z') < validated_ms or rec.get('void'):
            continue
        nd = len(rec['rows'].get('death', ())) + rec['unparsed'].get('death', 0)
        ns = len(rec['rows'].get('site', ())) + rec['unparsed'].get('site', 0)
        recon[rec['day']] = (nd, ns)
        if abs(nd - ns) > DEATH_SITE_SLACK:
            raise Blind('%s: %d _death rows but %d _death_site_recorded rows -- one of the two kinds changed' % (rec['day'], nd, ns))
    return {'validated_days': vdays, 'rows': dict(tot), 'unparsed': dict(unp), 'days_with_rows': dict(spoke),
            'recent_days': [r['day'] for r in recent], 'death_vs_site_by_day': recon}


def evidence_points(days, seeds, validated_ms):
    """Every evidence point, resolved to its seed. Returns (points, deaths, excluded counter, spell list)."""
    excl = collections.Counter(); excl_h = collections.Counter(); lost_validated = collections.Counter()
    deaths, unknown_hist = classify_deaths(days, validated_ms)
    pts = []

    def seed_for(world, t, what):
        s, why = seeds.seed_at(world, t)
        if s is None:
            if why == 'unknown_world' and t >= validated_ms:
                raise Blind('%s row from world %r, which the seeds table does not know: a new world needs its seed measured '
                            'before its rows fold' % (what, world))
            excl['%s:%s' % (what, why)] += 1
            if t >= validated_ms and why in ('outside_world_lifetime', 'quarantine'):
                lost_validated[why] += 1
        return s

    deaths_by_bot = collections.defaultdict(list)
    for d in deaths:
        deaths_by_bot[d['bot']].append(d['t'])
        s = seed_for(d['world'], d['t'], 'death')
        d['seed'] = s
        if s is None or d['kind'] is None:
            if d['kind'] is None:
                excl['death:not_a_hazard:%s' % d['category']] += 1
            continue
        k = 'entombment' if d['kind'] == 'suffocation' else d['kind']
        pts.append({'seed': s, 'kind': k, 'x': d['cell'][0], 'y': d['cell'][1], 'z': d['cell'][2], 't': d['t'],
                    'world': d['world'], 'bot': d['bot'], 'ev': 'death', 'tag': d['category']})
    for rec in days:
        for src in ('corridor', 'blind_lava', 'danger', 'adjacent', 'standoff', 'gave_up'):
            for t, bot, x, y, z, tag in rec['rows'].get(src, ()):
                w = world_of(bot)
                s = seed_for(w, t, src)
                if s is None:
                    continue
                pts.append({'seed': s, 'kind': 'entombment' if src == 'gave_up' else 'lava', 'x': x, 'y': y, 'z': z,
                            't': t, 'world': w, 'bot': bot, 'ev': src, 'tag': tag})
    wet = collections.defaultdict(list)
    for rec in days:
        for b, ks in rec.get('wet', {}).items():
            wet[b] += ks
    spell_list = []
    rows = [list(r) + [src] for rec in days for src in SPELL_SRC for r in rec['rows'].get(src, ())]
    for sp in spells(rows, deaths_by_bot):
        w = world_of(sp['bot'])
        s = seed_for(w, sp['first'], 'spell')
        if s is None:
            continue
        kind = spell_kind(sp, wet_share(sp, wet))
        if kind.startswith('excluded:'):
            excl['spell:' + kind[9:]] += 1
            excl_h[kind[9:]] += (sp['last'] - sp['first']) / 3_600_000
            continue
        spell_list.append(dict(sp, seed=s, kind=kind, world=w))
        pts.append({'seed': s, 'kind': kind, 'x': sp['cell'][0], 'y': sp['cell'][1], 'z': sp['cell'][2], 't': sp['first'],
                    'world': w, 'bot': sp['bot'], 'ev': 'spell', 'tag': kind, 'spell_ms': sp['last'] - sp['first'],
                    't_last': sp['last']})
    for k, v in excl_h.items():
        excl['spell_bot_hours:' + k] = round(v, 1)
    for k, v in unknown_hist.items():
        excl['death:history_unrecognised:' + k] += v
    if sum(lost_validated.values()) > VALIDATED_LOSS_OK:
        raise Blind('%d validated rows fall outside every world segment %s: the seeds table does not describe these worlds '
                    '(a reseed or a wrong creation time)' % (sum(lost_validated.values()), dict(lost_validated)))
    return pts, deaths, excl, spell_list


SIGHT = ('corridor', 'blind_lava', 'danger', 'adjacent', 'standoff')
VALIDATED_LOSS_OK = 50           # validated rows outside every world segment (none expected: no reseed since 09-27)


def site_of(seed, kind, P, now_ms, validated_ms):
    first = min(P, key=lambda p: (p['t'], p['x'], p['y'], p['z']))
    xs = [p['x'] for p in P]; ys = [p['y'] for p in P]; zs = [p['z'] for p in P]
    deaths = [p for p in P if p['ev'] == 'death']
    sights = [p for p in P if p['ev'] in SIGHT]
    gave = [p for p in P if p['ev'] == 'gave_up']
    sp = [p for p in P if p['ev'] == 'spell']
    # the centre: the death cell if any (most recent), else the most-evidenced cell
    cnt = collections.Counter((p['x'], p['y'], p['z']) for p in P)
    centre = max(deaths, key=lambda p: p['t']) if deaths else None
    c = (centre['x'], centre['y'], centre['z']) if centre else max(cnt.items(), key=lambda kv: (kv[1], -kv[0][0], -kv[0][1], -kv[0][2]))[0]
    worlds = sorted({p['world'] for p in P})
    death_worlds = sorted({p['world'] for p in deaths})
    last = max(p.get('t_last', p['t']) for p in P)
    cells = collections.defaultdict(lambda: [0, 0])
    for p in sights:
        k = (p['x'], p['y'], p['z'])
        cells[k][0] += 1
        cells[k][1] = max(cells[k][1], p['t'])
    episodes = {(p['bot'], p['t'] // 600_000) for p in sights}
    spell_h = sum(p['spell_ms'] for p in sp) / 3_600_000
    h = {
        'id': '%s/%s/%d,%d,%d' % (seed, kind, first['x'], first['y'], first['z']),
        'kind': kind, 'center': list(c), 'bbox': [[min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]],
        'first_seen': iso(first['t']), 'last_seen': iso(last),
        'deaths': {'total': len(deaths), 'validated': sum(1 for p in deaths if p['t'] >= validated_ms),
                   'last_7d': sum(1 for p in deaths if p['t'] >= now_ms - 7 * DAY_MS),
                   'by_world': dict(collections.Counter(p['world'] for p in deaths)),
                   'messages': dict(collections.Counter(p['tag'] for p in deaths)),
                   'cells_total': len({(p['x'], p['y'], p['z']) for p in deaths}),
                   'cells': death_cells(deaths)[:16]},
        'sightings': {'rows': len(sights), 'episodes': len(episodes),
                      'by_source': dict(collections.Counter(p['ev'] for p in sights)), 'cells_total': len(cells),
                      'cells': sorted(([k[0], k[1], k[2], v[0], v[1]] for k, v in cells.items()), key=lambda a: (-a[3], a[:3]))[:64]},
        'gave_ups': len(gave),
        'spells': {'n': len(sp), 'bot_hours': round(spell_h, 2),
                   'longest_h': round(max((p['spell_ms'] for p in sp), default=0) / 3_600_000, 2),
                   'bots': sorted({p['bot'] for p in sp})},
        'worlds_with_evidence': worlds, 'death_worlds': death_worlds, 'bots': len({p['bot'] for p in P}),
    }
    return h


def death_cells(deaths):
    """Distinct death cells, most deaths first, then most recent: the cells a consumer and the probes should see first."""
    c = collections.defaultdict(lambda: [0, 0])
    for p in deaths:
        k = (p['x'], p['y'], p['z'])
        c[k][0] += 1
        c[k][1] = max(c[k][1], p['t'])
    return [list(k) for k, v in sorted(c.items(), key=lambda kv: (-kv[1][0], -kv[1][1], kv[0]))]


def qualifies(h):
    """Which clusters are hazards: any death; a lava cluster with >= 2 sighting episodes; any trapped spell; >= 3 give-ups."""
    if h['deaths']['total'] or h['spells']['n']:
        return True
    if h['kind'] == 'lava':
        return h['sightings']['episodes'] >= 2
    if h['kind'] == 'entombment':
        return h['gave_ups'] >= 3
    return False


CONFIDENCE_RULE = ('high: deaths in >= 2 worlds, or >= 3 deaths, or trapped spells summing >= 6 bot-h; medium: 2 deaths, or a '
                   'death plus >= 2 sighting episodes, or spells >= 2 bot-h, or >= 5 sighting episodes from >= 2 bots; low: the '
                   'rest. A hazard verified ABSENT in every world of its seed (none unknown) is lowered one step.')


def confidence(h):
    d = h['deaths']['total']; sh = h['spells']['bot_hours']; ep = h['sightings']['episodes']
    if len(h['death_worlds']) >= 2 or d >= 3 or sh >= 6:
        c = 'high'
    elif d == 2 or (d >= 1 and ep >= 2) or sh >= 2 or (ep >= 5 and h['bots'] >= 2):
        c = 'medium'
    else:
        c = 'low'
    if (h.get('exists') or {}).get('summary') == 'absent':
        c = {'high': 'medium', 'medium': 'low', 'low': 'low'}[c]
    return c


def apply_verify(h, verify, seed_worlds):
    """exists.by_world from verify's probe answers; summary present > absent (all checked absent) > unknown > unchecked."""
    if h['kind'] == 'entombment':
        h['exists'] = {'summary': 'not_applicable', 'why': KINDS['entombment']['check']}
        return
    if not verify:
        h['exists'] = {'summary': 'unchecked', 'why': 'no verify file yet'}
        return
    res = (verify.get('results') or {}).get(h['id'])
    if not res:
        h['exists'] = {'summary': 'unchecked', 'why': 'not in the last request (new since)', 'backup_day': verify.get('backup_day')}
        return
    # a NEGATIVE answer is only as good as what was asked: if the hazard's probe cells changed, or evidence arrived after the
    # request was made, an old `absent` no longer covers it (a `present` still does: those blocks were seen)
    changed = sorted(list(c) for c in probe_cells(h)) != res.get('cells')
    newer = bool(verify.get('request_made_at')) and parse_ms(h['last_seen']) > parse_ms(verify['request_made_at'])
    by = {}
    for w in seed_worlds:
        r = (res.get('by_world') or {}).get(w)
        if not r:
            r = {'state': 'unchecked'}
        elif r['state'] != 'present' and (changed or newer):
            r = {'state': 'unchecked', 'why': 'evidence changed since the check' if changed else 'new evidence since the request',
                 'was': r['state']}
        by[w] = r
    states = [r['state'] for r in by.values()]
    if 'present' in states:
        s = 'present'
    elif states and all(x == 'absent' for x in states):
        s = 'absent'
    elif not states or all(x == 'unchecked' for x in states):
        s = 'unchecked'
    else:
        s = 'unknown'
    h['exists'] = {'summary': s, 'backup_day': verify.get('backup_day'), 'by_world': by,
                   'present_in': sorted(w for w, r in by.items() if r['state'] == 'present')}


def build(days, seeds, verify=None, now_ms=None, world_facts=None):
    """THE FOLD. days: the day cache; seeds: Seeds; verify: the newest verify file (or None). Returns the map document."""
    now_ms = now_ms or int(time.time() * 1000)
    vms = parse_ms(VALIDATED_SINCE)
    controls = source_controls(days, vms)
    terrain_gate(verify, seeds)
    pts, deaths, excl, spell_list = evidence_points(days, seeds, vms)
    by = collections.defaultdict(list)
    for p in pts:
        by[(p['seed'], p['kind'])].append(p)
    current = seeds.current()
    out_seeds = {}
    for (seed, kind), P in sorted(by.items()):
        for g in cluster(P, KINDS[kind]['link']):
            h = site_of(seed, kind, [P[i] for i in g], now_ms, vms)
            if not qualifies(h):
                continue
            apply_verify(h, verify, current.get(seed, []))
            h['confidence'] = confidence(h)
            out_seeds.setdefault(seed, []).append(h)
    bot_hours = collections.Counter()
    for rec in days:
        for w, n in rec.get('bot_hours', {}).items():
            if WORLD_RE.fullmatch(w):
                bot_hours[w] += n
    seeds_doc = {}
    all_seeds = set(out_seeds) | set(current)
    for seed in sorted(all_seeds):
        hz = out_seeds.get(seed, [])
        hz.sort(key=lambda h: (-(h['deaths']['total']), -h['spells']['bot_hours'], -h['sightings']['episodes'], h['id']))
        past = [{'world': w, 'from': iso(s['from_ms']), 'until': iso(s['until_ms'])} for w, info in seeds.worlds.items()
                for s in info['segments'] if s['seed'] == seed and s['until_ms'] is not None]
        seeds_doc[seed] = {
            'worlds': {w: {'home': seeds.worlds[w]['home'],
                           'on_seed_since': iso(seeds.worlds[w]['segments'][-1]['from_ms'])} for w in current.get(seed, [])},
            'past_worlds': past,
            'hazards': hz,
            'counts': dict(collections.Counter(h['kind'] for h in hz)),
        }
    death_ctrl = death_site_control(days, vms)
    doc = {
        'schema': SCHEMA, 'schema_version': SCHEMA_VERSION,
        'generated_at': iso(now_ms), 'stale_after': iso(now_ms + STALE_AFTER_H * 3_600_000),
        'coords': ('absolute block coordinates, floor of the position; every world on one seed has the same terrain at the '
                   'same coordinates (verify.terrain_control), so a hazard applies to all of them until a world changes it'),
        'window': {'history_since': HISTORY_SINCE, 'validated_since': VALIDATED_SINCE, 'refused_days': list(REFUSED_DAYS),
                   'days_folded': len(days), 'until': max((r['until'] for r in days), default=None),
                   'history_note': 'rows before validated_since are ES-unreconciled history (lib/estelemetry caveat); '
                                   'every hazard carries deaths.validated separately'},
        'controls': dict(controls, death_site_recorded=death_ctrl, excluded=dict(excl),
                         bot_hours_by_world=dict(bot_hours),
                         terrain=(verify or {}).get('terrain_control'),
                         verify_backup_day=(verify or {}).get('backup_day'), verify_made_at=(verify or {}).get('made_at')),
        'kinds': KINDS, 'confidence_rule': CONFIDENCE_RULE,
        'seeds': seeds_doc,
    }
    return doc, deaths


TERRAIN_MIN_AGREE = 0.99
TERRAIN_MIN_CELLS = 500


def terrain_gate(verify, seeds):
    """Merging worlds by seed RESTS on same seed -> same terrain: every seed with >= 2 current worlds must show bedrock
    agreement >= 0.99 over >= 500 compared cells in the verify file, or the build refuses (it would merge unlike worlds)."""
    if verify is None:
        return
    tc = (verify.get('terrain_control') or {}).get('within_seed') or {}
    for seed, ws in seeds.current().items():
        if len(ws) < 2:
            continue
        t = tc.get(seed) or {}
        if (t.get('min_agreement') or 0) < TERRAIN_MIN_AGREE or (t.get('min_cells') or 0) < TERRAIN_MIN_CELLS:
            raise Blind('seed %s: the terrain control does not show one terrain (%s): worlds are not merged on a seed '
                        'whose bedrock disagrees' % (seed, t or 'missing'))


def death_site_control(days, validated_ms):
    """The positive control on the death POSITION: every death row should have the same bot's `_death_site_recorded` row
    within 2 s, naming a cell within 1 block of floor(bot.pos). If < 90% pair, or < 95% of pairs agree, the position the
    map folds is not the death site (Blind). Applied once >= 20 validated deaths are in the window."""
    deaths = [r for rec in days for r in rec['rows'].get('death', ()) if r[0] >= validated_ms]
    sites = collections.defaultdict(list)
    for rec in days:
        for r in rec['rows'].get('site', ()):
            if r[0] >= validated_ms - 5000:
                sites[r[1]].append(r)
    paired = agree = 0
    for d in deaths:
        near = [s for s in sites.get(d[1], ()) if abs(s[0] - d[0]) <= 2000]
        if near:
            paired += 1
            s = min(near, key=lambda s: abs(s[0] - d[0]))
            agree += max(abs(s[2] - d[2]), abs(s[3] - d[3]), abs(s[4] - d[4])) <= 1
    out = {'deaths_validated': len(deaths), 'paired_with_site_row': paired, 'site_within_1_block': agree}
    if len(deaths) >= 20 and (paired < 0.9 * len(deaths) or agree < 0.95 * paired):
        raise Blind('death-position control failed: %s -- the folded death cell is not the recorded death site' % out)
    return out


VERIFY_MAX_AGE_H = 72
VERIFY_ALARM_H = 30              # one missed nightly verify is an alarm in the header; three refuse the build


def check_fresh(v, now_ms):
    """The seeds come from the verify file: one older than 72 h may predate a reseed, so the build refuses it."""
    age = (now_ms - parse_ms(v['made_at'])) / 3_600_000
    if age > VERIFY_MAX_AGE_H:
        raise Blind('the verify file is %.0f h old (> %d h): the seeds table may predate a reseed; fix the .30 verify / pull'
                    % (age, VERIFY_MAX_AGE_H))
    return age


# ------------------------------------------------------------------------------------------------- value
def vkey(seed, x, z):
    """value()'s grid cell: 8x8 columns, PER SEED (a death is never compared with another seed's terrain)."""
    return (seed, x // 8, z // 8)


def value(deaths, now_ms, days=7, link=(3, 4), same_kind=True, prior_since_ms=None, transform=None, lag_ms=DAY_MS):
    """How many of the last `days` days' deaths happened where the map ALREADY KNEW the hazard from an EARLIER death in
    ANOTHER world on the same seed. Denominators: every death in the window; those on a seed that held >= 2 worlds at the
    time (only those could match). `transform(seed, x, z) -> (x, z)` moves the prior deaths (the chance nulls: same deaths,
    wrong place). `lag_ms`: an ANOTHER-world prior counts only if it is at least this much older -- a map refreshed daily
    cannot have known a death from an hour ago. An OWN-world prior counts with no lag (keepout and world facts update live),
    so `known_only_from_another_world` is what the map adds beyond per-world memory."""
    lo = now_ms - days * DAY_MS
    lxz, ly = link
    ok = [d for d in deaths if d.get('seed') and d['kind']]
    prior = [d for d in ok if prior_since_ms is None or d['t'] >= prior_since_ms]
    grid = collections.defaultdict(list)
    for p in prior:
        x, z = transform(p['seed'], p['cell'][0], p['cell'][2]) if transform else (p['cell'][0], p['cell'][2])
        grid[vkey(p['seed'], x, z)].append((x, z, p))
    window = [d for d in deaths if lo <= d['t'] < now_ms]
    res = collections.Counter(); by_kind = collections.Counter(); matched = []
    for d in window:
        res['deaths'] += 1
        if not d.get('seed') or not d['kind']:
            res['no_seed_or_not_hazard'] += 1
            continue
        res['resolved'] += 1
        hit_other = hit_same = False
        for dx in (-8, 0, 8):
            for dz in (-8, 0, 8):
                for px, pz, p in grid.get(vkey(d['seed'], d['cell'][0] + dx, d['cell'][2] + dz), ()):
                    if p['t'] >= d['t'] or (same_kind and p['kind'] != d['kind']):
                        continue
                    if abs(px - d['cell'][0]) <= lxz and abs(pz - d['cell'][2]) <= lxz and abs(p['cell'][1] - d['cell'][1]) <= ly:
                        if p['world'] != d['world']:
                            if p['t'] <= d['t'] - lag_ms:
                                hit_other = True
                        else:
                            hit_same = True
        if hit_other:
            res['known_from_another_world'] += 1
            by_kind[d['kind']] += 1
            matched.append(d)
            if not hit_same:
                res['known_only_from_another_world'] += 1
        if hit_same:
            res['known_from_own_world'] += 1
    return dict(res), dict(by_kind), matched


def could_match(deaths, seeds, lo, hi):
    """Deaths in [lo, hi) on a seed that held >= 2 worlds at that moment: the only deaths another world could have warned."""
    out = []
    for d in deaths:
        if lo <= d['t'] < hi and d.get('seed'):
            k = sum(1 for w, info in seeds.worlds.items() for s in info['segments']
                    if s['seed'] == d['seed'] and s['from_ms'] <= d['t'] and (s['until_ms'] is None or d['t'] < s['until_ms']))
            if k >= 2:
                out.append(d)
    return out


def shared_seed_deaths(deaths, seeds, lo, hi):
    return len(could_match(deaths, seeds, lo, hi))


NULL_OFFSETS = ((48, 0), (-48, 0), (0, 48), (0, -48), (34, 34), (-34, 34), (34, -34), (-34, -34))


def seed_homes(seeds):
    """{seed: (x, z)} of the seed's current home (all shared-seed worlds share one), for the rotation null."""
    out = {}
    for w, info in seeds.worlds.items():
        if info.get('home'):
            out.setdefault(info['seed'], (info['home'][0], info['home'][2]))
            for sgm in info['segments'][:-1]:
                out.setdefault(sgm['seed'], (info['home'][0], info['home'][2]) if sgm['seed'] == info['seed'] else None)
    return {k: v for k, v in out.items() if v}


def rotate(homes, quarter):
    """Rotate a prior about its seed's home by quarter * 90 degrees: the same distance from home (the town's density kept),
    the wrong bearing."""
    def f(seed, x, z):
        h = homes.get(seed)
        if not h:
            return x + 10_000, z + 10_000           # no home known: out of reach (never a match)
        dx, dz = x - h[0], z - h[1]
        for _ in range(quarter):
            dx, dz = -dz, dx
        return h[0] + dx, h[1] + dz
    return f


def value_report(deaths, seeds, now_ms, days=7):
    lo = now_ms - days * DAY_MS
    vms = parse_ms(VALIDATED_SINCE)
    out = {'window': [iso(lo), iso(now_ms)], 'link': 'within 3 blocks horizontally and 4 vertically',
           'lag': 'a prior counts only if >= 24 h older (a daily map)'}
    head, kinds, matched = value(deaths, now_ms, days)
    out['headline'] = head
    out['headline_by_kind'] = kinds
    out['shared_seed_deaths'] = shared_seed_deaths(deaths, seeds, lo, now_ms)
    out['deaths_by_kind'] = dict(collections.Counter(d['kind'] or 'not_a_hazard' for d in deaths if lo <= d['t'] < now_ms))
    could = could_match(deaths, seeds, lo, now_ms)
    out['could_match_by_kind'] = dict(collections.Counter(d['kind'] for d in could if d['kind']))
    ids = {id(d) for d in could}
    if any(id(d) not in ids for d in matched):
        raise Blind('a matched death is not one that could match (its seed held one world): the value fold is wrong')
    out['variants'] = {
        'priors_validated_only': value(deaths, now_ms, days, prior_since_ms=vms)[0],
        'any_kind': value(deaths, now_ms, days, same_kind=False)[0],
        'link_6_6': value(deaths, now_ms, days, link=(6, 6))[0],
        'no_lag': value(deaths, now_ms, days, lag_ms=1)[0],
    }
    nulls = [value(deaths, now_ms, days, transform=lambda s, x, z, o=o: (x + o[0], z + o[1]))[0].get('known_from_another_world', 0)
             for o in NULL_OFFSETS]
    out['chance_null'] = {'offsets': [list(o) for o in NULL_OFFSETS], 'matched': nulls,
                          'mean': round(sum(nulls) / len(nulls), 2), 'max': max(nulls)}
    homes = seed_homes(seeds)
    rot = [value(deaths, now_ms, days, transform=rotate(homes, q))[0].get('known_from_another_world', 0) for q in (1, 2, 3)]
    out['rotation_null'] = {'what': 'priors rotated 90/180/270 degrees about their seed\'s home (distance from home kept)',
                            'matched': rot, 'mean': round(sum(rot) / 3, 2), 'max': max(rot)}
    out['matched'] = [{'t': iso(d['t']), 'bot': d['bot'], 'kind': d['kind'], 'cell': list(d['cell']), 'category': d['category']}
                      for d in sorted(matched, key=lambda d: d['t'])]
    return out


# ------------------------------------------------------------------------------------------------- the request
MAX_PROBES = 100_000
PROBE_R = {'lava': 2, 'fire': 2, 'drowning': 1, 'water_pit': 1, 'water_ceiling_trap': 1, 'cave_fall': 1, 'dripstone': 2}


def probe_cells(h):
    """The cells a hazard is probed at (the request) -- also its fingerprint when the answer comes back."""
    cells = [tuple(c) for c in h['deaths']['cells'][:4]]
    if not cells:
        cells = [tuple(c[:3]) for c in h['sightings']['cells'][:4]]
    if not cells:
        cells = [tuple(h['center'])]
    return cells


def make_request(doc, now_ms):
    """Probe cells per hazard and per CURRENT world of its seed: the death cells (<= 4), else the top sighting cells (<= 4),
    else the centre. Highest-priority hazards first; at most MAX_PROBES probes."""
    probes = []
    order = []
    for seed, s in doc['seeds'].items():
        for h in s['hazards']:
            if h['kind'] not in PROBE_R:
                continue
            order.append((-(h['deaths']['total'] * 10 + h['spells']['bot_hours'] + h['sightings']['episodes']), h['id'], seed, h))
    order.sort(key=lambda o: (o[0], o[1]))
    for _, hid, seed, h in order:
        cells = probe_cells(h)
        for w in sorted(doc['seeds'][seed]['worlds']):
            for c in cells:
                if len(probes) >= MAX_PROBES:
                    break
                probes.append({'id': hid, 'world': w, 'kind': h['kind'], 'x': c[0], 'y': c[1], 'z': c[2], 'r': PROBE_R[h['kind']]})
    return {'schema': REQUEST_SCHEMA, 'schema_version': 1, 'made_at': iso(now_ms), 'probes': probes,
            'truncated': len(probes) >= MAX_PROBES}


def validate_request(req, max_probes=MAX_PROBES):
    """The forced command's and verify()'s gate on a request: schema, size, every field typed and bounded."""
    if not isinstance(req, dict) or req.get('schema') != REQUEST_SCHEMA or req.get('schema_version') != 1:
        raise ValueError('not a %s v1 document' % REQUEST_SCHEMA)
    ps = req.get('probes')
    if not isinstance(ps, list) or len(ps) > max_probes:
        raise ValueError('probes must be a list of at most %d' % max_probes)
    for p in ps:
        if not isinstance(p, dict) or set(p) != {'id', 'world', 'kind', 'x', 'y', 'z', 'r'}:
            raise ValueError('a probe has the wrong fields')
        if not (isinstance(p['world'], str) and WORLD_RE.fullmatch(p['world'])):
            raise ValueError('a probe names a world outside the fleet pattern')
        if p['kind'] not in PROBE_R or not isinstance(p['id'], str) or len(p['id']) > 120:
            raise ValueError('a probe has a bad kind or id')
        for k in ('x', 'z'):
            if not isinstance(p[k], int) or isinstance(p[k], bool) or abs(p[k]) > 30_000_000:
                raise ValueError('a probe coordinate is out of range')
        if not isinstance(p['y'], int) or isinstance(p['y'], bool) or not -64 <= p['y'] <= 319:
            raise ValueError('a probe y is out of range')
        if not isinstance(p['r'], int) or isinstance(p['r'], bool) or not 0 <= p['r'] <= 3:
            raise ValueError('a probe radius is out of range')
    return req


# ------------------------------------------------------------------------------------------------- world reader (verify)
def read_nbt(b):
    i = 0

    def payload(t):
        nonlocal i
        if t == 1: v = struct.unpack_from('>b', b, i)[0]; i += 1; return v
        if t == 2: v = struct.unpack_from('>h', b, i)[0]; i += 2; return v
        if t == 3: v = struct.unpack_from('>i', b, i)[0]; i += 4; return v
        if t == 4: v = struct.unpack_from('>q', b, i)[0]; i += 8; return v
        if t == 5: v = struct.unpack_from('>f', b, i)[0]; i += 4; return v
        if t == 6: v = struct.unpack_from('>d', b, i)[0]; i += 8; return v
        if t == 7: n = struct.unpack_from('>i', b, i)[0]; i += 4; v = b[i:i + n]; i += n; return v
        if t == 8: n = struct.unpack_from('>H', b, i)[0]; i += 2; v = b[i:i + n].decode('utf-8', 'replace'); i += n; return v
        if t == 9:
            et = b[i]; i += 1; n = struct.unpack_from('>i', b, i)[0]; i += 4
            return [payload(et) for _ in range(n)]
        if t == 10:
            d = {}
            while True:
                tt = b[i]; i += 1
                if tt == 0: return d
                n = struct.unpack_from('>H', b, i)[0]; i += 2; k = b[i:i + n].decode('utf-8', 'replace'); i += n
                d[k] = payload(tt)
        if t == 11: n = struct.unpack_from('>i', b, i)[0]; i += 4; v = struct.unpack_from('>%di' % n, b, i); i += 4 * n; return v
        if t == 12: n = struct.unpack_from('>i', b, i)[0]; i += 4; v = struct.unpack_from('>%dq' % n, b, i); i += 8 * n; return v
        raise ValueError('tag %d' % t)
    t = b[i]; i += 1
    n = struct.unpack_from('>H', b, i)[0]; i += 2 + n
    return payload(t)


def section_values(bs, npal):
    dat = bs.get('data')
    if dat is None or npal <= 1:
        return None
    bits = max(4, (npal - 1).bit_length()); per = 64 // bits; mask = (1 << bits) - 1
    vals = []
    for lo in dat:
        lo &= (1 << 64) - 1
        for k in range(per):
            vals.append((lo >> (k * bits)) & mask)
            if len(vals) >= 4096:
                return vals
    return vals


class World:
    """Block reads from Anvil region bytes. read_region(rx, rz) -> bytes | None (missing). block() returns a name, or
    None for a cell whose chunk is not generated / unreadable; status() says which."""

    def __init__(self, read_region):
        self.read_region = read_region
        self.regions = {}
        self.chunks = {}
        self.stats = collections.Counter()

    def chunk(self, cx, cz):
        key = (cx, cz)
        if key in self.chunks:
            return self.chunks[key]
        rk = (cx >> 5, cz >> 5)
        if rk not in self.regions:
            try:
                self.regions[rk] = self.read_region(*rk) or b''
            except Exception:
                self.regions[rk] = None
        data = self.regions[rk]
        if data is None:
            self.chunks[key] = ('unknown', None); self.stats['region_error'] += 1; return self.chunks[key]
        if not data:
            self.chunks[key] = ('not_generated', None); self.stats['region_missing'] += 1; return self.chunks[key]
        idx = 4 * ((cx & 31) + (cz & 31) * 32)
        off = int.from_bytes(data[idx:idx + 3], 'big') * 4096
        if off == 0:
            self.chunks[key] = ('not_generated', None); self.stats['chunk_absent'] += 1; return self.chunks[key]
        try:
            ln = int.from_bytes(data[off:off + 4], 'big'); comp = data[off + 4]; raw = data[off + 5:off + 4 + ln]
            if comp == 2: raw = zlib.decompress(raw)
            elif comp == 1: raw = zlib.decompress(raw, 16 + zlib.MAX_WBITS)
            elif comp != 3: raise ValueError('compression %d' % comp)
            ch = read_nbt(raw)
        except Exception:
            self.chunks[key] = ('unknown', None); self.stats['chunk_error'] += 1; return self.chunks[key]
        if str(ch.get('Status', '')).replace('minecraft:', '') != 'full':
            self.chunks[key] = ('not_generated', None); self.stats['chunk_not_full'] += 1; return self.chunks[key]
        secs = {}
        for s in ch.get('sections', []):
            bs = s.get('block_states') or {}
            pal = bs.get('palette') or []
            if pal:
                secs[s['Y']] = [[p.get('Name', '?') for p in pal], [p.get('Properties') or {} for p in pal], bs, None]
        self.chunks[key] = ('ok', secs)
        self.stats['chunk_ok'] += 1
        return self.chunks[key]

    def status(self, x, z):
        return self.chunk(x >> 4, z >> 4)[0]

    def block(self, x, y, z, props=False):
        st, secs = self.chunk(x >> 4, z >> 4)
        if st != 'ok':
            return (None, {}) if props else None
        s = secs.get(y >> 4)
        if s is None:
            return ('minecraft:air', {}) if props else 'minecraft:air'
        names, pprops, bs, vals = s
        if len(names) == 1:
            v = 0
        else:
            if vals is None:
                vals = s[3] = section_values(bs, len(names))
            if vals is None or len(vals) < 4096:
                self.stats['undecoded'] += 1
                return (None, {}) if props else None
            v = vals[(y & 15) * 256 + (z & 15) * 16 + (x & 15)]
            if v >= len(names):
                self.stats['undecoded'] += 1
                return (None, {}) if props else None
        return (names[v], pprops[v]) if props else names[v]


LAVAISH = frozenset({'minecraft:lava', 'minecraft:magma_block', 'minecraft:fire', 'minecraft:soul_fire'})
WATER_NAMES = frozenset({'minecraft:water', 'minecraft:bubble_column', 'minecraft:kelp', 'minecraft:kelp_plant',
                         'minecraft:seagrass', 'minecraft:tall_seagrass'})
PASSABLE = re.compile(r'^minecraft:(air|cave_air|void_air|light|short_grass|tall_grass|grass|fern|large_fern|dead_bush|vine|'
                      r'glow_lichen|[a-z_]+_carpet|torch|wall_torch|soul_torch|soul_wall_torch|redstone_torch|'
                      r'redstone_wall_torch|[a-z_]+_sign|[a-z_]+_wall_sign|[a-z_]+_door|ladder|[a-z_]+_pressure_plate|'
                      r'[a-z_]+_button|lever|rail|powered_rail|detector_rail|activator_rail|[a-z_]+_sapling|dandelion|poppy|'
                      r'blue_orchid|allium|azure_bluet|[a-z_]+_tulip|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|'
                      r'rose_bush|peony|brown_mushroom|red_mushroom|snow|pink_petals|leaf_litter|wildflowers|bush|firefly_bush|'
                      r'short_dry_grass|tall_dry_grass|cobweb|hanging_roots|cave_vines|cave_vines_plant|spore_blossom|'
                      r'sweet_berry_bush|wheat|carrots|potatoes|beetroots|sugar_cane|structure_void)$')


def is_water(name, props):
    return name in WATER_NAMES or str((props or {}).get('waterlogged', 'false')) == 'true'


def is_open(name, props):
    """A body can occupy it: air-like, plants, or a fluid."""
    return name is not None and (bool(PASSABLE.match(name)) or is_water(name, props) or name in LAVAISH)


def is_solid(name, props):
    return name is not None and not is_open(name, props)


def probe(w, p):
    """One probe -> {'state': present|absent|not_generated|unknown, 'found': {...}}. ABSENT is claimed only when every cell
    the check needs was read: a column in an ungenerated chunk or a cell that did not decode makes a negative `unknown`."""
    before = w.stats['undecoded']
    res = _probe(w, p)
    sts = {w.status(x, z) for x in range(p['x'] - p['r'], p['x'] + p['r'] + 1) for z in range(p['z'] - p['r'], p['z'] + p['r'] + 1)}
    if res['state'] == 'absent' and (sts != {'ok'} or w.stats['undecoded'] > before):
        return {'state': 'unknown', 'why': 'incomplete read (%s)' % ('ungenerated column' if sts != {'ok'} else 'undecoded cells'),
                'found': res.get('found', {})}
    return res


def _probe(w, p):
    x0, y0, z0, r, kind = p['x'], p['y'], p['z'], p['r'], p['kind']
    sts = {w.status(x, z) for x in range(x0 - r, x0 + r + 1) for z in range(z0 - r, z0 + r + 1)}
    if 'unknown' in sts:
        return {'state': 'unknown', 'why': 'unreadable chunk'}
    if sts == {'not_generated'}:
        return {'state': 'not_generated'}
    found = collections.Counter()

    def cells(dylo, dyhi, rr):
        for x in range(x0 - rr, x0 + rr + 1):
            for z in range(z0 - rr, z0 + rr + 1):
                for y in range(max(-64, y0 + dylo), min(319, y0 + dyhi) + 1):
                    yield x, y, z
    if kind in ('lava', 'fire'):
        for x, y, z in cells(-2, 1, r):
            n = w.block(x, y, z)
            if n in LAVAISH:
                found[n.replace('minecraft:', '')] += 1
    elif kind == 'drowning':
        for x, y, z in cells(-1, 1, r):                     # head-deep water: two stacked water cells (feet and head)
            a = w.block(x, y, z, props=True); b = w.block(x, y + 1, z, props=True)
            if a[0] is not None and b[0] is not None and is_water(*a) and is_water(*b):
                found['deep_water'] += 1
    elif kind == 'dripstone':
        for x, y, z in cells(-2, 16, r):
            if w.block(x, y, z) == 'minecraft:pointed_dripstone':
                found['pointed_dripstone'] += 1
    elif kind == 'cave_fall':
        best = 0
        for x in range(x0 - r, x0 + r + 1):
            for z in range(z0 - r, z0 + r + 1):
                h = 0
                for y in range(y0, min(319, y0 + 64)):
                    n, pr = w.block(x, y, z, props=True)
                    if n is None:
                        w.stats['undecoded'] += 1          # a blind cell ends the column AND marks the read incomplete
                        break
                    if is_solid(n, pr):
                        break
                    h += 1
                best = max(best, h)
        found['open_above'] = best
        return {'state': 'present' if best >= 4 else 'absent', 'found': dict(found)}
    elif kind == 'water_pit':
        for x, y, z in cells(-1, 1, r):
            feet = w.block(x, y, z, props=True); floor = w.block(x, y - 1, z, props=True); head = w.block(x, y + 1, z, props=True)
            if feet[0] is None or not is_water(*feet) or not is_solid(*floor) or is_solid(*head):
                continue
            walls = [w.block(x + dx, y + 1, z + dz, props=True) for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1))]
            if all(is_solid(*b) for b in walls):
                found['pit_cells'] += 1
        if not found:
            for x, y, z in cells(-1, 1, r):
                n, pr = w.block(x, y, z, props=True)
                if n is not None and is_water(n, pr):
                    found['water_not_pit'] += 1
        return {'state': 'present' if found.get('pit_cells') else 'absent', 'found': dict(found)}
    elif kind == 'water_ceiling_trap':
        for x, y, z in cells(-1, 1, r):
            feet = w.block(x, y, z, props=True); head = w.block(x, y + 1, z, props=True); cap = w.block(x, y + 2, z, props=True)
            if feet[0] is not None and is_water(*feet) and is_water(*head) and is_solid(*cap):
                found['trap_cells'] += 1
                found['ceiling:' + cap[0].replace('minecraft:', '')] += 1
        return {'state': 'present' if found.get('trap_cells') else 'absent', 'found': dict(found)}
    return {'state': 'present' if found else 'absent', 'found': dict(found)}


BEDROCK_CTRL = [(355 + dx, y, 147 + dz) for dx in range(-24, 25, 3) for dz in range(-24, 25, 3) for y in (-63, -62, -61)]


def terrain_control(worlds_by_seed, open_world):
    """Same seed -> same terrain: the bedrock floor (y -63..-61, seeded noise no bot digs) at 867 cells around the shared
    home, compared world against world. Within a seed agreement should be ~1.0; across seeds it is the chance level."""
    fp = {}
    for seed, ws in worlds_by_seed.items():
        for wname in ws:
            w = open_world(wname)
            fp[wname] = [w.block(x, y, z) == 'minecraft:bedrock' if w.block(x, y, z) is not None else None for x, y, z in BEDROCK_CTRL]
    out = {'cells': len(BEDROCK_CTRL), 'within_seed': {}, 'across_seeds': {}}
    names = sorted(fp)
    seed_of = {w: s for s, ws in worlds_by_seed.items() for w in ws}

    def agree(a, b):
        pairs = [(x, y) for x, y in zip(fp[a], fp[b]) if x is not None and y is not None]
        return (sum(1 for x, y in pairs if x == y) / len(pairs), len(pairs)) if pairs else (None, 0)
    for seed, ws in worlds_by_seed.items():
        ws = sorted(ws)
        if len(ws) >= 2:
            vals = [agree(ws[0], b) for b in ws[1:]]
            out['within_seed'][seed] = {'reference': ws[0], 'min_agreement': min((v for v, _ in vals if v is not None), default=None),
                                        'min_cells': min((n for _, n in vals), default=0),
                                        'pairs': {b: round(v, 4) if v is not None else None for b, (v, _) in zip(ws[1:], vals)}}
    reps = [sorted(ws)[0] for ws in worlds_by_seed.values()]
    for i, a in enumerate(reps):
        for b in reps[i + 1:]:
            v, n = agree(a, b)
            out['across_seeds']['%s~%s' % (a, b)] = round(v, 4) if v is not None else None
    return out


def read_backup_log(path, day):
    """'good <day>' line from world-backup.sh's log, or None."""
    try:
        with open(path, errors='replace') as f:
            for line in f:
                if (' good %s:' % day) in line:
                    return line.strip()
    except FileNotFoundError:
        return None
    return None


def sudo_cat(path):
    r = subprocess.run(['sudo', '-n', 'cat', path], capture_output=True)
    if r.returncode:
        if b'No such file' in r.stderr:
            return b''
        raise OSError('sudo cat %s: %s' % (path, r.stderr.decode(errors='replace')[:120]))
    return r.stdout


def sudo_birth(path):
    r = subprocess.run(['sudo', '-n', 'stat', '-c', '%W', path], capture_output=True, text=True)
    v = r.stdout.strip()
    if r.returncode or not v.isdigit() or v == '0':
        raise OSError('no birth time for %s' % path)
    return iso(int(v) * 1000)


def level_seed(raw):
    d = read_nbt(gzip.decompress(raw)).get('Data', {})
    return str((d.get('WorldGenSettings') or {})['seed'])


def measure_worlds(staging, live, cat=sudo_cat, birth=sudo_birth, ls=None, backup_ms=None):
    """{world: {seed, home, created, previous: [{seed, created, retired}]}} from the STAGED level.dat (the backup copy), the
    world dir's birth time, and every live `world.pre-reseed-<ts>` copy (seed from its level.dat, retired = its <ts>)."""
    ls = ls or (lambda d: subprocess.run(['sudo', '-n', 'ls', d], capture_output=True, text=True).stdout.split())
    out = {}
    for w in sorted(ls(staging)):
        if not WORLD_RE.fullmatch(w):
            continue
        raw = cat(os.path.join(staging, w, 'world', 'level.dat'))
        if not raw:
            continue
        tp = cat(os.path.join(staging, w, 'TOWN-PLACED.json'))
        home = json.loads(tp).get('home') if tp else None
        seed = level_seed(raw)
        live_raw = cat(os.path.join(live, w, 'world', 'level.dat'))
        if not live_raw or level_seed(live_raw) != seed:
            # the creation time below is the LIVE world's: it may only be paired with the staged seed if both are one world
            raise Blind('%s: the staged level.dat (seed %s) and the live one (%s) differ -- a reseed since the backup; the '
                        'next night\'s copy will agree' % (w, seed, level_seed(live_raw) if live_raw else 'missing'))
        info = {'seed': seed, 'home': home, 'created': birth(os.path.join(live, w, 'world', 'datapacks')),
                'previous': [], 'measured_at': iso(int(time.time() * 1000))}
        if backup_ms is not None and parse_ms(info['created']) > backup_ms:
            raise Blind('%s: the live world was created %s, after the backup (%s): the staged copy is another world'
                        % (w, info['created'], iso(backup_ms)))
        for name in sorted(ls(os.path.join(live, w))):
            m = re.match(r'^world\.pre-reseed-(\d{8}T\d{6}Z)$', name)
            if m:
                pr = cat(os.path.join(live, w, name, 'level.dat'))
                ts = dt.datetime.strptime(m.group(1), '%Y%m%dT%H%M%SZ').replace(tzinfo=dt.timezone.utc)
                info['previous'].append({'seed': level_seed(pr), 'created': birth(os.path.join(live, w, name, 'datapacks')),
                                         'retired': ts.strftime('%Y-%m-%dT%H:%M:%SZ')})
        out[w] = info
    return out


def verify(request, staging, live, backup_log, day=None, cat=sudo_cat, birth=sudo_birth, ls=None, now_ms=None):
    """10.0.0.30: the seeds table, the terrain control, and every probe answered from the STAGED backup copy (read-only)."""
    now_ms = now_ms or int(time.time() * 1000)
    day = day or iso(now_ms)[:10]
    good = read_backup_log(backup_log, day)
    if not good:
        raise Blind('no "good %s" line in %s: the staged copy may be mid-backup; refusing to read it' % (day, backup_log))
    m = re.match(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ) ', good)
    worlds = measure_worlds(staging, live, cat=cat, birth=birth, ls=ls, backup_ms=parse_ms(m.group(1)) if m else None)
    if not worlds:
        raise Blind('no fleet world found in %s' % staging)
    by_seed = collections.defaultdict(list)
    for w, info in worlds.items():
        by_seed[info['seed']].append(w)
    cache = {}

    def fresh(wname):
        return World(lambda rx, rz: cat(os.path.join(staging, wname, 'world', 'region', 'r.%d.%d.mca' % (rx, rz))))

    def open_world(wname):                                       # one world's region bytes in memory at a time
        if wname not in cache:
            cache.clear()
            cache[wname] = fresh(wname)
        return cache[wname]
    tc = terrain_control(dict(by_seed), fresh)
    per = collections.defaultdict(lambda: collections.defaultdict(list))
    cells = collections.defaultdict(set)
    state_counts = collections.Counter()
    probes = sorted((request or {}).get('probes', []), key=lambda p: (p['world'], p['x'] >> 9, p['z'] >> 9))
    for p in probes:
        cells[p['id']].add((p['x'], p['y'], p['z']))
        if p['world'] not in worlds:
            per[p['id']][p['world']].append({'state': 'unknown', 'why': 'world not staged'})
            continue
        a = probe(open_world(p['world']), p)
        per[p['id']][p['world']].append(a)
        state_counts[a['state']] += 1
    results = {}
    for hid, by in per.items():
        results[hid] = {'cells': sorted(list(c) for c in cells[hid]), 'by_world': {w: reduce_states(v) for w, v in by.items()}}
    null = null_control(probes, worlds, open_world)
    return {'schema': VERIFY_SCHEMA, 'schema_version': 1, 'made_at': iso(now_ms), 'backup_day': day, 'backup_line': good,
            'request_made_at': (request or {}).get('made_at'), 'probes': len((request or {}).get('probes', [])),
            'probe_states': dict(state_counts), 'null_control': null, 'worlds': worlds, 'terrain_control': tc,
            'results': dict(results)}


def reduce_states(answers):
    """One hazard's probes in one world -> one state: present if ANY probe found it; absent only if EVERY probe read
    absent; not_generated if every probe was ungenerated; otherwise unknown (an incomplete negative is not an absence)."""
    st = [a['state'] for a in answers]
    if 'present' in st:
        return next(a for a in answers if a['state'] == 'present')
    if st and all(x == 'absent' for x in st):
        return {'state': 'absent', 'found': {}, 'probes': len(st)}
    if st and all(x == 'not_generated' for x in st):
        return {'state': 'not_generated', 'probes': len(st)}
    return {'state': 'unknown', 'probes': len(st), 'states': dict(collections.Counter(st))}


NULL_SHIFT = (48, 48)


def null_control(probes, worlds, open_world, per_kind=400):
    """The existence check's NEGATIVE control: the same probes moved 48 blocks east and south (same y, same world). A check
    that also says `present` there is measuring the terrain's base rate, not the hazard. Up to per_kind probes per kind,
    every k-th one, so the sample spreads over the request."""
    by = collections.defaultdict(list)
    for p in probes:
        if p['world'] in worlds:
            by[p['kind']].append(p)
    out = {}
    for kind, ps in sorted(by.items()):
        step = max(1, len(ps) // per_kind)
        sample = ps[::step][:per_kind]
        st = collections.Counter(); real = collections.Counter()
        for p in sorted(sample, key=lambda p: p['world']):
            q = dict(p, x=p['x'] + NULL_SHIFT[0], z=p['z'] + NULL_SHIFT[1])
            st[probe(open_world(p['world']), q)['state']] += 1
            real[probe(open_world(p['world']), p)['state']] += 1
        out[kind] = {'n': len(sample), 'shifted': dict(st), 'same_probes': dict(real)}
    return out


# ------------------------------------------------------------------------------------------------- report text
def report_text(doc, val, top=8):
    L = []
    L.append('hazard map %s  (window %s .. %s; validated from %s; %s refused)' % (
        doc['generated_at'], doc['window']['history_since'], doc['window']['until'], VALIDATED_SINCE,
        ','.join(REFUSED_DAYS)))
    c = doc['controls']
    L.append('controls: %d validated days; rows %s; unparsed %s' % (c['validated_days'], c['rows'], c['unparsed']))
    for seed, s in sorted(doc['seeds'].items(), key=lambda kv: -len(kv[1]['worlds'])):
        L.append('')
        L.append('SEED %s  worlds now: %s  (past: %s)' % (seed, ', '.join(sorted(s['worlds'])) or '-',
                                                          ', '.join('%s until %s' % (p['world'], p['until'][:10]) for p in s['past_worlds']) or '-'))
        L.append('  hazards: %s' % s['counts'])
        for kind in ('lava', 'drowning', 'water_pit', 'water_ceiling_trap', 'cave_fall', 'dripstone', 'entombment', 'fire'):
            hz = [h for h in s['hazards'] if h['kind'] == kind]
            if not hz:
                continue
            hz.sort(key=lambda h: (-(h['deaths']['validated'] * 1000 + h['spells']['bot_hours'] * 10 + h['deaths']['total']), h['id']))
            for h in hz[:top if kind in ('lava', 'drowning', 'cave_fall', 'dripstone') else 4]:
                ex = h.get('exists') or {}
                L.append('  %-18s %-16s deaths %3d (validated %3d, 7d %2d; %d worlds)  spells %5.1f bot-h  sightings %4d ep  %-6s  exists=%s%s' % (
                    kind, '%d,%d,%d' % tuple(h['center']), h['deaths']['total'], h['deaths']['validated'], h['deaths']['last_7d'],
                    len(h['death_worlds']), h['spells']['bot_hours'], h['sightings']['episodes'], h['confidence'],
                    ex.get('summary'), (' in ' + ','.join(ex.get('present_in') or [])) if ex.get('present_in') else ''))
    if val:
        L.append('')
        hd = val['headline']
        L.append('VALUE (%s .. %s): of %d deaths, %d on a seed shared by >= 2 worlds; %d were within 3 xz / 4 y of a same-kind '
                 'death >= 24 h EARLIER in ANOTHER world (%d of them with no such earlier death in their own world). '
                 'Chance nulls: priors shifted 48 blocks mean %.1f (max %d); rotated about home mean %.1f (max %d).' % (
                     val['window'][0], val['window'][1], hd.get('deaths', 0), val['shared_seed_deaths'],
                     hd.get('known_from_another_world', 0), hd.get('known_only_from_another_world', 0),
                     val['chance_null']['mean'], val['chance_null']['max'], val['rotation_null']['mean'], val['rotation_null']['max']))
        L.append('  by kind matched: %s ; could match: %s ; all deaths: %s' % (val['headline_by_kind'], val['could_match_by_kind'],
                                                                              val['deaths_by_kind']))
        L.append('  variants: %s' % json.dumps(val['variants'], sort_keys=True))
    return '\n'.join(L) + '\n'


# ------------------------------------------------------------------------------------------------- CLI
def _es():
    sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..')))           # the repo's scripts/ (lib/estelemetry)
    extra = os.environ.get('MCAI_ESTEL_SCRIPTS')
    if extra:
        sys.path.insert(0, extra)
    from lib.estelemetry import EsEvents
    return EsEvents


def cmd_fetch(a):
    st = refresh_cache(os.path.join(a.home, 'cache'), _es(), int(time.time() * 1000), since=a.since or HISTORY_SINCE)
    print('cache: %s' % st)


def load_verify(path):
    if not path or not os.path.exists(path):
        return None
    v = load_json(path)
    if v.get('schema') != VERIFY_SCHEMA:
        raise Blind('%s is not a verify file' % path)
    return v


def world_facts(state_dir='/var/lib/mcai'):
    """Live fire sites from keepout's world-facts files, for the report only (the ES death rows are the evidence)."""
    out = {}
    try:
        names = os.listdir(state_dir)
    except OSError:
        return {'error': 'cannot list %s' % state_dir}
    for d in names:
        m = re.match(r'^_pool-((hive|board|isolated|placebo)-[a-d])$', d)
        if not m:
            continue
        p = os.path.join(state_dir, d, 'world-facts-%s.json' % m.group(1))
        try:
            wf = load_json(p)
        except Exception as e:
            out[m.group(1)] = {'error': type(e).__name__}
            continue
        out[m.group(1)] = dict(collections.Counter(s.get('kind') for s in wf.get('sites') or []))
    return out


def cmd_build(a, now_ms=None):
    now_ms = now_ms or int(time.time() * 1000)
    out = os.path.join(a.home, 'out')
    vpath = a.verify or os.path.join(a.home, 'in', 'verify.json')
    v = load_verify(vpath)
    if not v:
        raise Blind('no verify file at %s: the seeds come from it (10.0.0.30 measures level.dat); run the .30 verify first' % vpath)
    check_fresh(v, now_ms)
    seeds = Seeds.from_verify(v)
    days = load_days(os.path.join(a.home, 'cache'))
    doc, deaths = build(days, seeds, verify=v, now_ms=now_ms)
    doc['controls']['world_facts'] = world_facts()
    val = value_report(deaths, seeds, now_ms, days=7)
    doc['value'] = val
    day = iso(now_ms)[:10]
    atomic_json(os.path.join(out, 'hazardmap-%s.json' % day), doc)
    atomic_json(os.path.join(out, 'hazardmap.json'), doc)
    req = make_request(doc, now_ms)
    atomic_json(os.path.join(out, 'request.json'), req)
    txt = report_text(doc, val)
    with open(os.path.join(out, 'report-%s.txt' % day), 'w') as f:
        f.write(txt)
    atomic_json(os.path.join(out, 'heartbeat.json'), {'at': iso(now_ms), 'status': 'ok', 'hazards': sum(len(s['hazards']) for s in doc['seeds'].values()),
                                                      'probes': len(req['probes'])})
    for name in sorted(os.listdir(out)):                     # keep 21 days of dated files
        m = re.match(r'^(hazardmap|report)-(\d{4}-\d{2}-\d{2})\.(json|txt)$', name)
        if m and m.group(2) < iso(now_ms - 21 * DAY_MS)[:10]:
            os.remove(os.path.join(out, name))
    sys.stdout.write(txt)
    return doc


def ssh_cmd(a, req):
    return ['ssh', '-i', a.key, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=20', '-o', 'IdentitiesOnly=yes',
            '-o', 'StrictHostKeyChecking=accept-new', a.host, req]


def cmd_refresh(a):
    """The 10.0.0.31 cron: the test gate, then pull the verify file, fetch, build, push the new request. The gate runs the
    installed copy's own suite (fixtures, blind-input mutants, code mutants) first: a failing gate publishes nothing. A failed
    pull keeps the previous verify file (the map names the backup day it checked against); a failed push is reported."""
    hb = os.path.join(a.home, 'out', 'heartbeat.json')
    gate = subprocess.run([sys.executable, '-B', os.path.join(HERE, 'test_hazardmap.py')], capture_output=True, text=True)
    if gate.returncode:
        atomic_json(hb, {'at': iso(int(time.time() * 1000)), 'status': 'gate_failed',
                         'error': (gate.stdout.strip().splitlines() or ['?'])[-1][:300]})
        print('GATE FAILED: nothing published\n' + '\n'.join(l for l in gate.stdout.splitlines() if not l.endswith(' ok')))
        return 1
    try:
        r = subprocess.run(ssh_cmd(a, 'verify'), capture_output=True, timeout=600)
        if r.returncode == 0 and r.stdout:
            v = json.loads(r.stdout)
            if v.get('schema') == VERIFY_SCHEMA:
                atomic_json(os.path.join(a.home, 'in', 'verify.json'), v)
                print('verify pulled: backup %s, %d probes' % (v.get('backup_day'), v.get('probes', 0)))
        else:
            print('verify pull failed (exit %d): keeping the previous file' % r.returncode)
        cmd_fetch(a)
        cmd_build(a)
        reqp = os.path.join(a.home, 'out', 'request.json')
        with open(reqp, 'rb') as f:
            r = subprocess.run(ssh_cmd(a, 'request'), input=f.read(), capture_output=True, timeout=300)
        if r.returncode:
            print('request push FAILED (exit %d)' % r.returncode)
            hbv = load_json(hb)
            hbv.update(status='push_failed', error='request push exit %d: tomorrow\'s verify checks the previous request' % r.returncode)
            atomic_json(hb, hbv)
            return 1
        print('request pushed')
        return 0
    except Exception as e:
        atomic_json(hb, {'at': iso(int(time.time() * 1000)), 'status': 'error', 'error': '%s: %s' % (type(e).__name__, str(e)[:300])})
        raise


def cmd_value(a):
    v = load_verify(a.verify or os.path.join(a.home, 'in', 'verify.json'))
    seeds = Seeds.from_verify(v)
    days = load_days(os.path.join(a.home, 'cache'))
    now_ms = int(time.time() * 1000)
    pts, deaths, excl, _ = evidence_points(days, seeds, parse_ms(VALIDATED_SINCE))
    print(json.dumps(value_report(deaths, seeds, now_ms, days=a.days), indent=1, sort_keys=True))


def check_line(home, now_ms):
    """One status line for a header (fleetstatus can call it later): OK, or ALARM naming why. A missing or unreadable map,
    a map past stale_after, a heartbeat that is not ok, or a verify older than 72 h is an ALARM -- never a quiet OK."""
    out = os.path.join(home, 'out')
    try:
        hb = load_json(os.path.join(out, 'heartbeat.json'))
        doc = load_json(os.path.join(out, 'hazardmap.json'))
    except Exception as e:
        return 'HAZARDMAP ALARM: no readable map/heartbeat in %s (%s)' % (out, type(e).__name__), 1
    if hb.get('status') != 'ok':
        return 'HAZARDMAP ALARM: last refresh %s at %s: %s' % (hb.get('status'), hb.get('at'), hb.get('error', '')[:120]), 1
    if now_ms > parse_ms(doc['stale_after']):
        return 'HAZARDMAP ALARM: the map is past stale_after (%s)' % doc['stale_after'], 1
    vday = (doc.get('controls') or {}).get('verify_backup_day')
    vmade = (doc.get('controls') or {}).get('verify_made_at')
    if not vday or not vmade or now_ms - parse_ms(vmade) > VERIFY_ALARM_H * 3_600_000:
        # a stale verify also stops new rows folding (they are after the seeds' observation horizon): say so loudly
        return 'HAZARDMAP ALARM: the verify file (seeds + existence) is from %s, backup %s: the .30 verify or the pull is ' \
               'failing, and rows after it are not folded' % (vmade, vday), 1
    n = sum(len(x['hazards']) for x in doc['seeds'].values())
    v = (doc.get('value') or {}).get('headline') or {}
    return ('hazard map OK %s: %d hazards on %d seeds, backup %s; 7d deaths known from another world %s of %s'
            % (doc['generated_at'], n, len(doc['seeds']), vday, v.get('known_from_another_world'), v.get('deaths'))), 0


def cmd_check(a):
    line, rc = check_line(a.home, int(time.time() * 1000))
    print(line)
    return rc


def cmd_verify(a):
    req = None
    if a.request and os.path.exists(a.request):
        req = validate_request(load_json(a.request))
    v = verify(req, a.staging, a.live, a.backup_log)
    atomic_json(os.path.join(a.out, 'verify.json'), v)
    print('verify: backup %s, %d probes %s, %d worlds' % (v['backup_day'], v['probes'], v['probe_states'], len(v['worlds'])))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('cmd', choices=['refresh', 'fetch', 'build', 'value', 'verify', 'check', 'selftest'])
    ap.add_argument('--home', default=os.path.expanduser('~/hazardmap'))
    ap.add_argument('--since')
    ap.add_argument('--verify')
    ap.add_argument('--days', type=int, default=7)
    ap.add_argument('--request')
    ap.add_argument('--out')
    ap.add_argument('--staging', default='/srv/world-backup/staging')
    ap.add_argument('--live', default='/srv/block2')
    ap.add_argument('--backup-log', default='/var/log/mcai-monitor/world-backup.log')
    ap.add_argument('--key', default=os.path.expanduser('~/.ssh/id_hazardmap'))
    ap.add_argument('--host', default='mike@10.0.0.30')
    a = ap.parse_args(argv)
    if a.cmd == 'selftest':
        sys.path.insert(0, HERE)
        import test_hazardmap
        return test_hazardmap.main([])
    if os.geteuid() == 0:
        print('refusing to run as root'); return 2
    rc = {'refresh': cmd_refresh, 'fetch': cmd_fetch, 'build': cmd_build, 'value': cmd_value, 'verify': cmd_verify,
          'check': cmd_check}[a.cmd](a)
    return rc if isinstance(rc, int) else 0


if __name__ == '__main__':
    sys.exit(main())
