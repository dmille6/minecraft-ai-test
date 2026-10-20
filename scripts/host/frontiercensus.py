#!/usr/bin/env python3
r"""frontiercensus.py -- E0, the FRONTIER CENSUS (expansion plan 2026-10-19, section 4). READ ONLY on the fleet.

Design: docs/reports/expansion-plan-2026-10-19.md section 4 (and 1.1-1.3 for the numbers its controls reproduce).
Results and controls: docs/reports/frontier-census-2026-10-20.md. Per SHARED town it keeps:

  visit map   a 64 x 64 region grid (ABSOLUTE: region (i, j) is x in [64i, 64i+64), z in [64j, 64j+64), the grid section
              1.1 measured on, aligned to chunk boundaries) out to 1,000 blocks from home (region centre), inside the world
              border minus 64 (every corner within WORLD_BORDER_RADIUS - 64 of the ORIGIN, the bots' own border measure,
              state.mjs horizontalDistanceFromSpawn). Folded from EVERY positioned row's position -- a skill row carries
              its END snapshot, an event row its instant -- never from samples, which miss passing visits. Per region:
              rows, bot-minutes (distinct (bot, minute) pairs with a row ending in the region), first and last visit.
  frontier    a region is `visited` when a row in the covered window ended in it; `not_observed` when none did AND every
              day of the window is covered; otherwise `unknown` -- never "unvisited", and never "reachable".
                window    from 2026-10-08 00:00Z (10-07 holds filebeat re-sends; estelemetry refuses it), at most 14 days
                coverage  per UTC day: the median positioned-row count per bot-day (pro-rated for a part day) against
                          the fleet median over the window's complete bot-days. A day below 80% marks every region not
                          visited as `unknown`. Per-town ratios are reported, not gated (towns differ by 0.63-1.4x on
                          identical code, measured 10-08..10-19)
                warm-up   the frontier file is PUBLISHED only after 48 h of live ticks with the self-test passed
                unreached a region whose expedition trip turned back for "no route" twice is `unreached` for 7 days.
                          STUB until expedition-01 exists: it folds `_expedition_turnback` rows (detail reason=no_route
                          target=<x>,<z>); none exist yet
                ranking   candidates: not_observed, in the 300-800 ring, no hazard, not unreached. Sorted by water label
                          (scanned land, then unknown, then water), then the half-plane facing away from the world origin
                          (explore's preference: skills.mjs explore heads away from 0,0), then 64-block distance step
                          from 300, then alignment with that bearing
  hazards     death sites from world-facts-<pool>.json `sites` (kind death:*) and `_death` rows; a region within 32
              blocks of one in the last 7 days is marked
  water       NOT visible from positions alone. A region is labelled by `_region_scan` rows (STUB for expedition-01:
              detail water=<n> land=<n>) and, for regions rows ended IN, by perception: NOTE perception.blocks.water is the
              DISTANCE (rounded) to the NEAREST water block within 40 (state.mjs perception()), not a count. A row is wet
              when it is <= 2, dry when perception ran and saw no water within 40. >= 10 perception rows and >= 50% wet
              -> perceived_water; >= 50% dry -> perceived_land; else unknown. A region nobody ended in is unknown
  baselines   rolling 7 d, by distance band (0-48, 48-100, 100-200, 200-300, 300+; lo <= d < hi, section 1.2) and depth
              (deep = feet more than 8 below home.y): logs and ore per gather BODY-hour (end position, every status,
              target family only -- section 1.2's e4); mine ore per mine body-hour; deaths per bot-hour (bot-hours =
              bot-minutes of presence: each bot's newest positioned row per minute); `home` success by START band and
              trigger (start = the bot's previous positioned row within 15 min, section 2's h1 join); bag-eligibility
              per town-hour (section 1.3: bag <= 24 slots, a pickaxe >= 40%, health >= 18, at town <= 48 h / 12 v, on the
              hourly latest-per-bot sample)

HOW IT READS (incremental). The unit of fold is the UTC hour. An hour is folded once it ended >= 10 min ago (a skill
row is stamped at its START and written at its END, up to 180 s + grace later, then up to 240 s of ingest), with three
server-side aggregations (no row pull for the visit map) and a bounded row pull for gather / mine / _death / home rows.
Each folded hour is ONE file (out/hours/YYYY-MM-DDTHH.json) holding that hour's contribution and the positioned-doc count
ES held when it was folded. Every tick re-counts every hour of the window in one histogram; an hour whose count changed
(late ingest, an ES stall that filled in) is REFOLDED and its file replaced, so the fold is idempotent and a stall that
recovers is never a permanent hole. An hour with no positioned doc is VOID (kept, re-checked each tick). Ticks fold
within a time budget, oldest first, so the 12-day backfill spreads over the first few ticks.

INSTRUMENT CHECKS, every tick (a failure is status `instrument`, never a quiet zero):
  * the region fold must contain every region the hourly latest-per-bot samples landed in (section 4's control);
  * the hour's Q1 (regions) and Q2 (presence) positioned-doc totals must agree;
  * every live mode runs the fixture self-test first and refuses to read the fleet if it fails.

MODES
    python3 -B frontiercensus.py --selftest          # the fixture world: known answers + controls; exit 1 on failure
    python3 -B frontiercensus.py --tick              # cron: fold new/changed hours, stage frontier files, daily text
    sudo -n python3 -B frontiercensus.py --publish   # cron, as root: staged files -> /var/lib/mcai/_pool-<pool>/
                                                     #   frontier-<home>.g<N>.json (the blueprint link() protocol),
                                                     #   only after the 48 h warm-up; files owned by the pool dir's owner
    python3 -B frontiercensus.py --report            # the current frontier from the hour files (no ES)
    python3 -B frontiercensus.py --control SINCE UNTIL   # section 1.1's band shares on the stored hourly samples, and
                                                         # the subset check, over [SINCE, UNTIL] (sample times)
    python3 -B frontiercensus.py --parity HOUR       # pull HOUR's raw rows, fold them in Python, compare with the
                                                     # stored aggregation record exactly

Runs on 10.0.0.31 (ES read-only key; /var/lib/mcai). --tick writes ONLY under --out-dir. --publish writes ONLY files
named frontier-<home>.g<N>.json (and its own .tmp) inside existing _pool-<pool> dirs, never follows a symlink, and
prunes only its own generations (single writer under the census lock, so a pruned number cannot be re-created).

CRON (installed 2026-10-20 from ~/frontiercensus, a stable copy; never /opt/minecraft-ai):
  */5 * * * * cd /home/mike/frontiercensus && /usr/bin/nice -n 19 /usr/bin/python3 -B scripts/host/frontiercensus.py --tick --out-dir /home/mike/frontiercensus/out >> /home/mike/frontiercensus/out/tick.log 2>&1; /usr/bin/sudo -n /usr/bin/nice -n 19 /usr/bin/python3 -B /home/mike/frontiercensus/scripts/host/frontiercensus.py --publish --out-dir /home/mike/frontiercensus/out >> /home/mike/frontiercensus/out/publish.log 2>&1
  3,33 * * * * /usr/bin/python3 -B /home/mike/frontiercensus/scripts/host/check-frontiercensus.py --dir /home/mike/frontiercensus/out >> /home/mike/frontiercensus/out/check.log 2>&1
"""
import sys

sys.dont_write_bytecode = True

import argparse  # noqa: E402
import datetime as dt  # noqa: E402
import fcntl  # noqa: E402
import glob  # noqa: E402
import hashlib  # noqa: E402
import importlib.util  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import statistics  # noqa: E402
import time  # noqa: E402
from collections import Counter, defaultdict  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))

UTC = dt.timezone.utc
MIN_MS = 60_000
HOUR_MS = 3600_000
DAY_MS = 24 * HOUR_MS
GRID = 64
DOMAIN_R = 1000              # region centre within this many blocks of home (horizontal)
BORDER_R = 1950              # config.mjs world.borderRadius default (WORLD_BORDER_RADIUS); measured from the ORIGIN
BORDER_MARGIN = 64
WINDOW_START = '2026-10-08T00:00:00Z'     # 10-07 is refused by estelemetry (filebeat re-sends)
WINDOW_DAYS = 14
BANDS = ((0, 48), (48, 100), (100, 200), (200, 300), (300, None))
DEEP_DY = -8                 # deep: feet more than 8 below home.y (section 1.1)
TOWN_R, TOWN_DY = 48, 12     # at town (treefarm.mjs farmOrder; section 1.3)
HAZARD_R = 32
HAZARD_MS = 7 * DAY_MS
COVER_SHARE = 0.8
WARMUP_H = 48
WARMUP_GAP_MIN = 30          # a gap longer than this between live ticks restarts the warm-up
RING = (300, 800)
SETTLE_MS = 10 * MIN_MS
UNREACHED_N = 2
UNREACHED_MS = 7 * DAY_MS
WET_DIST = 2                 # perception.blocks.water <= 2: the bot stands at or in water
LABEL_MIN_ROWS = 10
LABEL_SHARE = 0.5
HOME_PREV_MS = 15 * MIN_MS
SAMPLE_MS = 10 * MIN_MS      # section 1.1: the newest row per bot in the 10 minutes before each hour
TICK_BUDGET_S = 240
KEEP_GENS = 48
STALE_AFTER_MS = 3 * HOUR_MS     # a reader treats a frontier whose data_until is older than this as VOID
TOP_N = 50
STUB_KINDS = ('_region_scan', '_expedition_turnback')
ROW_KINDS = ('gather', 'mine', '_death', 'home')
ORE_ITEMS = ('coal', 'diamond', 'redstone', 'lapis_lazuli', 'emerald')

# section 1.3's bag-slot estimator (e3.py), verbatim
UNSTACK = ('pickaxe', '_axe', 'shovel', 'sword', 'hoe', 'bucket', 'bed', 'helmet', 'chestplate', 'leggings', 'boots',
           'shears', 'bow', 'flint_and_steel', 'fishing_rod', 'spyglass')
S16 = ('egg', 'snowball', 'ender_pearl', 'sign', 'honey_bottle')


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def ms_of(s):
    return int(dt.datetime.fromisoformat(str(s).replace('Z', '+00:00')).timestamp() * 1000)


def hour_key(ms):
    return iso(ms)[:13]


def floor_hour(ms):
    return ms - ms % HOUR_MS


# ---------------------------------------------------------------------------------------------- geometry (pure)
def region_of(x, z):
    return (math.floor(x / GRID), math.floor(z / GRID))


def rkey(i, j):
    return f'{i},{j}'


def unkey(k):
    a, b = k.split(',')
    return int(a), int(b)


def centre(i, j):
    return (GRID * i + GRID / 2, GRID * j + GRID / 2)


def hdist(ax, az, bx, bz):
    return math.hypot(ax - bx, az - bz)


def band_of(d):
    for lo, hi in BANDS:
        if d >= lo and (hi is None or d < hi):
            return f'{lo}-{hi}' if hi is not None else f'{lo}+'
    return 'neg'


BAND_NAMES = tuple(f'{lo}-{hi}' if hi is not None else f'{lo}+' for lo, hi in BANDS)


def depth_of(y, home_y):
    return 'deep' if (y - home_y) < DEEP_DY else 'surface'


def in_domain(i, j, home, border_r=BORDER_R):
    cx, cz = centre(i, j)
    if hdist(cx, cz, home[0], home[2]) > DOMAIN_R:
        return False
    lim = border_r - BORDER_MARGIN
    return all(math.hypot(x, z) <= lim for x in (GRID * i, GRID * (i + 1)) for z in (GRID * j, GRID * (j + 1)))


def domain(home, border_r=BORDER_R):
    i0, j0 = region_of(home[0], home[2])
    r = DOMAIN_R // GRID + 2
    return [(i, j) for i in range(i0 - r, i0 + r + 1) for j in range(j0 - r, j0 + r + 1) if in_domain(i, j, home, border_r)]


def rect_dist(px, pz, i, j):
    """Distance from a point to region (i, j)'s square [64i, 64i+64) x [64j, 64j+64) (0 inside)."""
    x0, z0 = GRID * i, GRID * j
    dx = max(x0 - px, 0, px - (x0 + GRID))
    dz = max(z0 - pz, 0, pz - (z0 + GRID))
    return math.hypot(dx, dz)


def alignment(home, cx, cz):
    """cos of the angle between (centre - home) and (home - origin): +1 straight away from the world origin. None when
    home is within 12 of the origin (explore's own rule: a random bearing there)."""
    hx, hz = home[0], home[2]
    if math.hypot(hx, hz) < 12:
        return None
    vx, vz = cx - hx, cz - hz
    n = math.hypot(vx, vz)
    if n == 0:
        return None
    return (vx * hx + vz * hz) / (n * math.hypot(hx, hz))


# ---------------------------------------------------------------------------------------------- row helpers (pure)
def slots(inv):
    n = 0
    for k, v in (inv or {}).items():
        if not isinstance(v, (int, float)) or v <= 0:
            continue
        if any(u in k for u in UNSTACK):
            n += v
        else:
            n += math.ceil(v / (16 if any(s in k for s in S16) else 64))
    return int(n)


def good_pick(tools):
    for k, L in (tools or {}).items():
        if 'pickaxe' not in k:
            continue
        for x in (L if isinstance(L, list) else []):
            mx = x.get('max', 1) or 1
            if (mx - (x.get('used', 0) or 0)) / max(1, mx) >= 0.4:
                return True
    return False


def has_axe(tools):
    return any('_axe' in k for k in (tools or {}))


def target_family(args):
    a = args if isinstance(args, dict) else {}
    blk = str(a.get('block') or a.get('name') or a.get('item') or '?')
    return 'log' if blk.endswith('_log') else ('ore' if blk.endswith('_ore') else None)


def is_ore_item(k):
    return k.startswith('raw_') or k in ORE_ITEMS or k.endswith('_ore')


def items_got(delta, fam):
    d = delta if isinstance(delta, dict) else {}
    out = 0
    for k, v in d.items():
        if isinstance(v, (int, float)) and v > 0 and (k.endswith('_log') if fam == 'log' else is_ore_item(k)):
            out += v
    return int(out)


def trigger_class(t):
    t = t or ''
    if t in ('watchdog_home', 'llm:idle') or t.startswith('interrupt:'):
        return t
    return 'other'


def kv(detail):
    return dict(re.findall(r'(\w+)=(\S+)', detail or ''))


def num(v, d=None):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


# ---------------------------------------------------------------------------------------------- the fold
def new_region():
    # [rows, bot_min, first_ms, last_ms, perc_rows, wet_rows, water_rows]
    return [0, 0, None, None, 0, 0, 0]


def fold_rows(rows, homes):
    """THE REFERENCE FOLD (pure): positioned rows -> {regions, presence, bots}. rows: dicts with t (ms), bot, pool, x, y, z,
    perc (bool: the row carries perception), water (nearest-water distance or None). Only pools in `homes` get regions
    and presence; bots counts every pool (coverage is fleet-wide). The live tick computes the same thing with ES
    aggregations (es_fold_hour); --parity compares the two on a real hour."""
    regions = defaultdict(dict)
    bm = defaultdict(set)                     # (pool, rkey) -> {(bot, minute)}
    newest = {}                               # (bot, minute) -> row
    bots = {}
    for r in rows:
        if r.get('x') is None or r.get('z') is None:
            continue
        b = bots.setdefault(r['bot'], [r['pool'], 0, set()])
        b[1] += 1
        minute = r['t'] - r['t'] % MIN_MS
        b[2].add(minute)
        k0 = (r['bot'], minute)
        if k0 not in newest or r['t'] >= newest[k0]['t']:
            newest[k0] = r
        if r['pool'] not in homes:
            continue
        k = rkey(*region_of(r['x'], r['z']))
        g = regions[r['pool']].setdefault(k, new_region())
        g[0] += 1
        g[2] = r['t'] if g[2] is None else min(g[2], r['t'])
        g[3] = r['t'] if g[3] is None else max(g[3], r['t'])
        if r.get('perc'):
            g[4] += 1
            w = r.get('water')
            if w is not None:
                g[6] += 1
                if w <= WET_DIST:
                    g[5] += 1
        bm[(r['pool'], k)].add(k0)
    for (pool, k), s in bm.items():
        regions[pool][k][1] = len(s)
    presence = presence_from_newest(newest.values(), homes)
    return {'regions': {p: dict(v) for p, v in regions.items()}, 'presence': presence,
            'bots': {b: [v[0], v[1], len(v[2])] for b, v in bots.items()}}


def presence_from_newest(newest_rows, homes):
    """Each (bot, minute)'s newest positioned row -> {pool: {'<band>|<depth>': bot-minutes}}. Pure."""
    out = defaultdict(Counter)
    for r in newest_rows:
        h = homes.get(r['pool'])
        if h is None or r.get('x') is None:
            continue
        d = hdist(r['x'], r['z'], h[0], h[2])
        out[r['pool']][f'{band_of(d)}|{depth_of(r["y"], h[1])}'] += 1
    return {p: dict(c) for p, c in out.items()}


def parse_q1(resp, homes):
    """The ES region aggregation -> {pool: {rkey: region}}. Pure. Histogram keys are floor(v / 64) * 64 (ES semantics)."""
    out = {}
    P = resp['aggregations']['p']
    _complete(P, 'q1 pools')
    for pb in P['buckets']:
        if pb['key'] not in homes:
            continue
        regs = {}
        for xb in pb['x']['buckets']:
            for zb in xb['z']['buckets']:
                if not zb['doc_count']:
                    continue
                i, j = int(round(xb['key'] / GRID)), int(round(zb['key'] / GRID))
                _complete(zb['b'], 'q1 bots')
                pc = zb['pc']
                _complete(pc['w'], 'q1 water')
                water = sum(w['doc_count'] for w in pc['w']['buckets'])
                wet = sum(w['doc_count'] for w in pc['w']['buckets'] if num(w['key'], 99) <= WET_DIST)
                regs[rkey(i, j)] = [zb['doc_count'], sum(len(bb['m']['buckets']) for bb in zb['b']['buckets']),
                                    int(zb['first']['value']), int(zb['last']['value']), pc['doc_count'], wet, water]
        out[pb['key']] = regs
    return out


def parse_q2(resp, homes):
    """The ES presence aggregation (each bot-minute's newest positioned row) -> (presence, bots). Pure."""
    P = resp['aggregations']['p']
    _complete(P, 'q2 pools')
    newest, bots = [], {}
    for pb in P['buckets']:
        _complete(pb['b'], 'q2 bots')
        for bb in pb['b']['buckets']:
            bots[bb['key']] = [pb['key'], bb['doc_count'], len(bb['m']['buckets'])]
            for mb in bb['m']['buckets']:
                hits = mb['top']['hits']['hits']
                if not hits:
                    continue
                p = (hits[0]['_source'].get('bot') or {}).get('pos') or {}
                if p.get('x') is None:
                    continue
                newest.append({'pool': pb['key'], 'bot': bb['key'], 'x': p['x'], 'y': p.get('y', 0), 'z': p['z'],
                               't': int(mb['key'])})
    return presence_from_newest(newest, homes), bots


def _complete(t, what):
    if t.get('sum_other_doc_count') or t.get('doc_count_error_upper_bound'):
        raise RuntimeError(f'{what}: terms truncated (other={t.get("sum_other_doc_count")}); raise size')
    return t


def fold_events(rows, homes, prev_pos):
    """Gather / mine / _death / home / stub rows -> the hour's event contribution. Pure. prev_pos(bot, t) -> (x, y, z) |
    None is the bot's previous positioned row within 15 min (the section 2 join)."""
    gather = defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0]))     # pool -> fam|band|depth -> [rows, ok, body_ms, got]
    mine = defaultdict(lambda: defaultdict(lambda: [0, 0, 0, 0]))       # pool -> band|depth -> [rows, ok, body_ms, ore]
    deaths, homes_out, scans, turns = [], [], [], []
    nopos = Counter()
    for r in rows:
        sk = r.get('skill') or {}
        kind = sk.get('name')
        pool = (r.get('exp') or {}).get('pool')
        h = homes.get(pool)
        if h is None:
            continue
        bot = (r.get('bot') or {}).get('name')
        p = (r.get('bot') or {}).get('pos') or {}
        t = ms_of(r['@timestamp'])
        has = p.get('x') is not None and p.get('z') is not None
        if not has:
            nopos[kind] += 1
        if kind == '_death':
            deaths.append([t, pool, bot, p.get('x'), p.get('y'), p.get('z'), sk.get('fail_class')])
            continue
        if kind == 'home':
            sp = prev_pos(bot, t)
            homes_out.append([t, pool, bot, sk.get('status'), sk.get('fail_class'), r.get('trigger'),
                              *(sp or (None, None, None)), p.get('x'), p.get('y'), p.get('z'), sk.get('duration_ms')])
            continue
        if kind == '_region_scan' and has:
            d = kv(sk.get('detail'))
            scans.append([t, pool, bot, p['x'], p['z'], num(d.get('water')), num(d.get('land'))])
            continue
        if kind == '_expedition_turnback':
            d = kv(sk.get('detail'))
            tg = (d.get('target') or '').split(',')
            if len(tg) == 2 and num(tg[0]) is not None and num(tg[1]) is not None:
                turns.append([t, pool, bot, num(tg[0]), num(tg[1]), d.get('reason')])
            continue
        if not has or kind not in ('gather', 'mine'):
            continue
        b = f'{band_of(hdist(p["x"], p["z"], h[0], h[2]))}|{depth_of(p.get("y", h[1]), h[1])}'
        ok = 1 if sk.get('status') == 'success' else 0
        body = int(sk.get('duration_ms') or 0)
        if kind == 'gather':
            fam = target_family(sk.get('args'))
            if fam is None:
                continue
            x = gather[pool][f'{fam}|{b}']
            x[0] += 1; x[1] += ok; x[2] += body; x[3] += items_got(sk.get('inventory_delta'), fam)   # noqa: E702
        else:
            x = mine[pool][b]
            x[0] += 1; x[1] += ok; x[2] += body; x[3] += items_got(sk.get('inventory_delta'), 'ore')  # noqa: E702
    return {'gather': {p: dict(v) for p, v in gather.items()}, 'mine': {p: dict(v) for p, v in mine.items()},
            'deaths': deaths, 'home': homes_out, 'scans': scans, 'turnbacks': turns, 'nopos': dict(nopos)}


def sample_rows(latest):
    """ES latest() per bot -> [[bot, pool, x, y, z, slots, goodpick, axe, health]]. Pure."""
    out = []
    for b, r in sorted(latest.items()):
        bo = r.get('bot') or {}
        p = bo.get('pos') or {}
        if p.get('x') is None:
            continue
        out.append([b, (r.get('exp') or {}).get('pool'), p['x'], p.get('y'), p['z'], slots(bo.get('inventory')),
                    good_pick(bo.get('tools')), has_axe(bo.get('tools')), bo.get('health')])
    return out


# ---------------------------------------------------------------------------------------------- reading the fold
def window_bounds(now_ms, data_until):
    since = max(ms_of(WINDOW_START), floor_hour(data_until) - WINDOW_DAYS * DAY_MS)
    return since, data_until


def records_in(records, since, until):
    return [r for r in records if since <= r['h0'] < until]


def coverage(records, since, until):
    """Per UTC day -> {ratio, hours, void_hours, covered, towns}. The fleet median is over complete bot-days (24 folded
    hours) of the window; a part day is pro-rated by its folded hours. Pure."""
    per_day = defaultdict(lambda: {'hours': 0, 'void': 0, 'bots': Counter(), 'pool_of': {}})
    for r in records_in(records, since, until):
        D = per_day[iso(r['h0'])[:10]]
        D['hours'] += 1
        if r.get('void'):
            D['void'] += 1
        for b, v in (r.get('bots') or {}).items():
            D['bots'][b] += v[1]
            D['pool_of'][b] = v[0]
    full = [c for D in per_day.values() if D['hours'] == 24 for c in D['bots'].values() if c > 0]
    M = statistics.median(full) if full else None
    out = {}
    for day, D in sorted(per_day.items()):
        counts = [c for c in D['bots'].values() if c > 0]
        scale = 24 / D['hours'] if D['hours'] else 0
        ratio = (statistics.median(counts) * scale / M) if (counts and M) else 0.0
        towns = defaultdict(list)
        for b, c in D['bots'].items():
            towns[D['pool_of'][b]].append(c)
        out[day] = {'ratio': round(ratio, 3), 'hours': D['hours'], 'void_hours': D['void'],
                    'covered': bool(M) and ratio >= COVER_SHARE,
                    'towns': {p: round(statistics.median(v) * scale / M, 3) if M else 0.0 for p, v in towns.items()}}
    return {'fleet_median_bot_day': M, 'days': out,
            'uncovered_days': [d for d, v in out.items() if not v['covered']]}


def sum_regions(records, pool):
    out = {}
    for r in records:
        for k, g in ((r.get('regions') or {}).get(pool) or {}).items():
            o = out.setdefault(k, new_region())
            o[0] += g[0]; o[1] += g[1]; o[4] += g[4]; o[5] += g[5]; o[6] += g[6]   # noqa: E702
            o[2] = g[2] if o[2] is None else min(o[2], g[2])
            o[3] = g[3] if o[3] is None else max(o[3], g[3])
    return out


def unreached(turnbacks, now_ms):
    """{rkey: until_ms}: a region with >= 2 `no_route` turn-backs; skipped for 7 days from the latest. Pure (STUB input)."""
    by = defaultdict(list)
    for t, _pool, _bot, x, z, reason in turnbacks:
        if reason == 'no_route':
            by[rkey(*region_of(x, z))].append(t)
    out = {}
    for k, ts in by.items():
        if len(ts) >= UNREACHED_N and max(ts) + UNREACHED_MS > now_ms:
            out[k] = max(ts) + UNREACHED_MS
    return out


def hazard_points(deaths, sites, pool, now_ms):
    """[(x, z, source, t)] of death sites in the last 7 days: `_death` rows and world-facts sites kind death:*."""
    pts = []
    for t, p, _bot, x, _y, z, fc in deaths:
        if p == pool and x is not None and z is not None and now_ms - HAZARD_MS < t <= now_ms:
            pts.append((x, z, f'_death:{fc}', t))
    for s in sites or []:
        if str(s.get('kind', '')).startswith('death:') and s.get('x') is not None and s.get('z') is not None:
            t = s.get('last')
            if isinstance(t, (int, float)) and now_ms - HAZARD_MS < t <= now_ms + HOUR_MS:
                pts.append((s['x'], s['z'], f'site:{s["kind"]}', int(t)))
    return pts


def water_label(g, scan):
    if scan:
        w, land = scan
        if w is not None and land is not None and (w + land) > 0:
            return ('scanned_water' if w > land else 'scanned_land'), '_region_scan'
    if g and g[4] >= LABEL_MIN_ROWS:
        if g[5] / g[4] >= LABEL_SHARE:
            return 'perceived_water', 'perception'
        if (g[4] - g[6]) / g[4] >= LABEL_SHARE:
            return 'perceived_land', 'perception'
    return 'unknown', None


WATER_RANK = {'scanned_land': 0, 'perceived_land': 0, 'unknown': 1, 'perceived_water': 2, 'scanned_water': 2}


def frontier(pool, home, records, cov, now_ms, data_until, sites=(), border_r=BORDER_R):
    """One town's frontier from the folded hours of the window. Pure."""
    since, until = window_bounds(now_ms, data_until)
    recs = records_in(records, since, until)
    regs = sum_regions(recs, pool)
    deaths = [d for r in recs for d in (r.get('deaths') or [])]
    scans = defaultdict(lambda: [0, 0])
    for r in recs:
        for t, p, _b, x, z, w, land in r.get('scans') or []:
            if p == pool:
                s = scans[rkey(*region_of(x, z))]
                s[0] += w or 0
                s[1] += land or 0
    turns = [t for r in recs for t in (r.get('turnbacks') or []) if t[1] == pool]
    unr = unreached(turns, data_until)
    hz = hazard_points(deaths, sites, pool, data_until)
    covered = not cov['uncovered_days'] and bool(cov['days'])
    out_regions, cands = [], []
    dom = domain(home, border_r)
    domset = {rkey(i, j) for i, j in dom}
    for i, j in dom:
        k = rkey(i, j)
        cx, cz = centre(i, j)
        d = hdist(cx, cz, home[0], home[2])
        g = regs.get(k)
        al = alignment(home, cx, cz)
        near = [p for p in hz if rect_dist(p[0], p[1], i, j) <= HAZARD_R]
        wl, wsrc = water_label(g, scans.get(k))
        status = 'visited' if g else ('not_observed' if covered else 'unknown')
        rec = {'i': i, 'j': j, 'cx': cx, 'cz': cz, 'd': round(d, 1), 'align': None if al is None else round(al, 3),
               'status': status, 'water': wl, 'water_src': wsrc}
        if g:
            rec.update(rows=g[0], bot_min=g[1], first=iso(g[2]), last=iso(g[3]), perc_rows=g[4], wet_rows=g[5],
                       water_rows=g[6])
        if near:
            rec['hazard'] = {'deaths_7d': len(near), 'nearest': round(min(rect_dist(p[0], p[1], i, j) for p in near), 1),
                             'sources': sorted({p[2] for p in near})}
        if k in unr:
            rec['unreached_until'] = iso(unr[k])
        out_regions.append(rec)
        if status == 'not_observed' and RING[0] <= d <= RING[1] and not near and k not in unr:
            cands.append(rec)
    def rank_key(c):
        al = c['align']
        return (WATER_RANK[c['water']], 0 if (al is None or al >= 0) else 1, int((c['d'] - RING[0]) // GRID),
                -(al if al is not None else 0), c['d'], c['i'], c['j'])
    cands.sort(key=rank_key)
    outside = {k: g for k, g in regs.items() if k not in domset}
    vis = [r for r in out_regions if r['status'] == 'visited']
    return {
        'schema': 1, 'pool': pool, 'home': list(home),
        'grid': {'size': GRID, 'anchor': 'origin', 'domain_r': DOMAIN_R, 'border_r': border_r, 'border_margin': BORDER_MARGIN},
        'window': {'since': iso(since), 'until': iso(until), 'hours_folded': len(recs),
                   'void_hours': sum(1 for r in recs if r.get('void'))},
        'covered': covered, 'uncovered_days': cov['uncovered_days'],
        'counts': {'domain': len(out_regions), 'visited': len(vis),
                   'not_observed': sum(1 for r in out_regions if r['status'] == 'not_observed'),
                   'unknown': sum(1 for r in out_regions if r['status'] == 'unknown'),
                   'hazard': sum(1 for r in out_regions if 'hazard' in r),
                   'unreached': sum(1 for r in out_regions if 'unreached_until' in r),
                   'candidates': len(cands),
                   'visited_beyond_200': sum(1 for r in vis if r['d'] > 200),
                   'visited_outside_domain': len(outside),
                   'bot_min_outside_domain': sum(g[1] for g in outside.values())},
        'ranking': [{'rank': n + 1, 'i': c['i'], 'j': c['j'], 'cx': c['cx'], 'cz': c['cz'], 'd': c['d'],
                     'align': c['align'], 'water': c['water']} for n, c in enumerate(cands[:TOP_N])],
        'regions': out_regions,
        'hazard_points': [{'x': p[0], 'z': p[1], 'source': p[2], 'at': iso(p[3])} for p in hz],
        'stubs': {'unreached': 'STUB: folds _expedition_turnback (reason=no_route target=x,z); none exist before '
                               'expedition-01', 'region_scan': 'STUB: folds _region_scan (water=n land=n); none exist '
                                                                  'before expedition-01'},
    }


def baselines(records, pools, homes, since, until):
    """Section 1.2 / 2 / 1.3 baselines over [since, until) for the given pools. Pure."""
    recs = records_in(records, since, until)
    g = defaultdict(lambda: [0, 0, 0, 0])
    m = defaultdict(lambda: [0, 0, 0, 0])
    pres = Counter()
    for r in recs:
        for p in pools:
            for k, v in ((r.get('gather') or {}).get(p) or {}).items():
                x = g[k]
                for n in range(4):
                    x[n] += v[n]
            for k, v in ((r.get('mine') or {}).get(p) or {}).items():
                x = m[k]
                for n in range(4):
                    x[n] += v[n]
            pres.update((r.get('presence') or {}).get(p) or {})
    deaths = Counter()
    death_fc = defaultdict(Counter)
    for r in recs:
        for t, p, _b, x, y, z, fc in r.get('deaths') or []:
            if p not in pools:
                continue
            h = homes[p]
            if x is None or z is None:
                deaths['nopos'] += 1
                continue
            k = f'{band_of(hdist(x, z, h[0], h[2]))}|{depth_of(y if y is not None else h[1], h[1])}'
            deaths[k] += 1
            death_fc[band_of(hdist(x, z, h[0], h[2]))][fc] += 1
    home = defaultdict(lambda: [0, 0])
    for r in recs:
        for row in r.get('home') or []:
            t, p, _b, status, _fc, trig, sx, sy, sz = row[:9]
            if p not in pools:
                continue
            h = homes[p]
            sb = band_of(hdist(sx, sz, h[0], h[2])) if sx is not None else 'start_unknown'
            for k in (f'{sb}|{trigger_class(trig)}', f'{sb}|*', f'*|{trigger_class(trig)}', '*|*'):
                home[k][0] += 1
                home[k][1] += status == 'success'
    bag = {'town_hours': 0, 'town_hours_with_eligible': 0, 'bot_samples': 0, 'eligible': 0,
           'bag<=24': 0, 'bag<=30': 0, 'pick>=40%': 0, 'hp>=18': 0, 'at_town': 0}
    for r in recs:
        S = (r.get('sample') or {}).get('rows') or []
        if not (r.get('sample') or {}).get('at'):
            continue
        per = Counter()
        for b, p, x, y, z, sl, gp, _axe, hp in S:
            if p not in pools:
                continue
            h = homes[p]
            at = hdist(x, z, h[0], h[2]) <= TOWN_R and abs((y or 0) - h[1]) <= TOWN_DY
            e = sl <= 24 and gp and (hp or 0) >= 18 and at
            bag['bot_samples'] += 1
            bag['bag<=24'] += sl <= 24
            bag['bag<=30'] += sl <= 30
            bag['pick>=40%'] += bool(gp)
            bag['hp>=18'] += (hp or 0) >= 18
            bag['at_town'] += at
            bag['eligible'] += e
            per[p] += e
        for p in pools:
            bag['town_hours'] += 1
            bag['town_hours_with_eligible'] += per[p] >= 1
    def bh(band, depth=None):
        return sum(v for k, v in pres.items() if k.split('|')[0] == band and (depth is None or k.split('|')[1] == depth)) / 60
    bands = {}
    for b in BAND_NAMES:
        row = {'bot_h': round(bh(b), 2), 'bot_h_deep': round(bh(b, 'deep'), 2), 'bot_h_surface': round(bh(b, 'surface'), 2)}
        for fam in ('log', 'ore'):
            x = [sum(v[n] for k, v in g.items() if k.startswith(f'{fam}|{b}|')) for n in range(4)]
            row[f'{fam}_gathers'] = x[0]
            row[f'{fam}_ok_pct'] = round(100 * x[1] / x[0], 1) if x[0] else None
            row[f'{fam}_body_h'] = round(x[2] / HOUR_MS, 2)
            row[f'{fam}_got'] = x[3]
            row[f'{fam}_per_body_h'] = round(x[3] / (x[2] / HOUR_MS), 1) if x[2] else None
            for dep in ('surface', 'deep'):
                y = g.get(f'{fam}|{b}|{dep}', [0, 0, 0, 0])
                row[f'{fam}_per_body_h_{dep}'] = round(y[3] / (y[2] / HOUR_MS), 1) if y[2] else None
        mx = [sum(v[n] for k, v in m.items() if k.startswith(f'{b}|')) for n in range(4)]
        row['mine_rows'], row['mine_body_h'], row['mine_ore'] = mx[0], round(mx[2] / HOUR_MS, 2), mx[3]
        row['mine_ore_per_body_h'] = round(mx[3] / (mx[2] / HOUR_MS), 1) if mx[2] else None
        for dep in (None, 'surface', 'deep'):
            n = sum(v for k, v in deaths.items() if k.split('|')[0] == b and (dep is None or k.split('|')[1] == dep))
            h = bh(b, dep)
            sfx = '' if dep is None else f'_{dep}'
            row[f'deaths{sfx}'] = n
            row[f'deaths_per_1k_bot_h{sfx}'] = round(1000 * n / h, 1) if h else None
        row['death_causes'] = dict(death_fc[b].most_common(4))
        bands[b] = row
    return {'since': iso(since), 'until': iso(until), 'hours': len(recs), 'bands': bands,
            'deaths_nopos': deaths.get('nopos', 0),
            'home': {k: {'n': v[0], 'ok': v[1], 'pct': round(100 * v[1] / v[0], 1)} for k, v in sorted(home.items())},
            'bag': bag}


def control_shares(records, t0, t1, homes, pools=None):
    """Section 1.1's estimator on the stored hourly samples taken at t0..t1 inclusive: band shares, deep share. Pure."""
    n = 0
    bc, deep = Counter(), 0
    times = set()
    for r in records:
        s = r.get('sample') or {}
        if not s.get('at'):
            continue
        ta = ms_of(s['at'])
        if not (t0 <= ta <= t1):
            continue
        times.add(ta)
        for b, p, x, y, z, *_ in s.get('rows') or []:
            if p not in homes or (pools is not None and p not in pools):
                continue
            h = homes[p]
            n += 1
            bc[band_of(hdist(x, z, h[0], h[2]))] += 1
            deep += (y - h[1]) < DEEP_DY
    return {'samples': n, 'timepoints': len(times), 'shares': {b: round(100 * bc[b] / n, 1) if n else None for b in BAND_NAMES},
            'deep': round(100 * deep / n, 1) if n else None}


def control_subset(records, t0, t1, homes):
    """Every (pool, region) an hourly sample at t0..t1 landed in must be in the row fold of the hours that hold those
    samples' rows (the sample at H reads [H - 10 min, H), i.e. hour H - 1). -> (found, sampled, missing list). Pure."""
    by_h = {r['h0']: r for r in records}
    sampled, missing = 0, []
    fold_regions = 0
    for r in records:
        s = r.get('sample') or {}
        if not s.get('at') or not (t0 <= ms_of(s['at']) <= t1):
            continue
        for b, p, x, y, z, *_ in s.get('rows') or []:
            if p not in homes:
                continue
            sampled += 1
            k = rkey(*region_of(x, z))
            if k not in ((by_h.get(r['h0']) or {}).get('regions') or {}).get(p, {}):
                missing.append((s['at'], p, b, k))
    # the union, for the report: regions the fold found vs the regions the samples found
    fr, sr = set(), set()
    for r in records:
        s = r.get('sample') or {}
        if not s.get('at') or not (t0 <= ms_of(s['at']) <= t1):
            continue
        for p, regs in (r.get('regions') or {}).items():
            fr.update((p, k) for k in regs)
        for b, p, x, y, z, *_ in s.get('rows') or []:
            if p in homes:
                sr.add((p, rkey(*region_of(x, z))))
    fold_regions = len(fr)
    return {'sampled_rows': sampled, 'sample_regions': len(sr), 'fold_regions': fold_regions,
            'sample_regions_missing_from_fold': len(sr - fr), 'missing_rows': missing[:20], 'missing_n': len(missing)}


def warmup(lines, now_ms):
    """The live run's start from heartbeat lines: live = a tick whose self-test passed and did not crash. A gap > 30 min
    between live ticks, or a failed self-test, restarts it. -> {run_start, complete, complete_at}. Pure."""
    start = last = None
    for ln in lines:
        try:
            r = json.loads(ln)
        except ValueError:
            continue
        if not isinstance(r, dict) or r.get('mode') != 'tick' or not r.get('at'):
            continue
        t = ms_of(r['at'])
        st = r.get('status')
        if st == 'selftest_failed':
            start = last = None
            continue
        if st not in ('ok', 'idle', 'void', 'behind', 'locked'):
            continue
        if last is None or t - last > WARMUP_GAP_MIN * MIN_MS:
            start = t
        last = t
    if start is None or last is None or now_ms - last > WARMUP_GAP_MIN * MIN_MS:
        return {'run_start': None, 'complete': False, 'complete_at': None}
    return {'run_start': iso(start), 'complete': now_ms - start >= WARMUP_H * HOUR_MS,
            'complete_at': iso(start + WARMUP_H * HOUR_MS)}


def content_digest(doc):
    d = {k: v for k, v in doc.items() if k not in ('generated_at', 'census', 'warmup')}
    return hashlib.sha256(json.dumps(d, sort_keys=True, default=list).encode()).hexdigest()[:16]


# ---------------------------------------------------------------------------------------------- generation files
GEN_RE = r'^{key}\.g(\d+)\.json$'


def gen_key(home):
    return f'frontier-{home[0]}_{home[1]}_{home[2]}'


def highest_gen(dir_, key):
    rx = re.compile(GEN_RE.format(key=re.escape(key)))
    n = 0
    for f in os.listdir(dir_):
        m = rx.match(f)
        if m:
            n = max(n, int(m.group(1)))
    return n


def create_gen(dir_, key, body, owner=None, keep=KEEP_GENS, n=None):
    """The blueprint protocol (blueprint.mjs createGen): write a tmp file, link() it to <key>.g<N+1>.json -- link fails
    if the name exists, so exactly one writer wins each N -- then unlink the tmp. -> the generation created, or None.
    owner=(uid, gid) chowns the tmp before the link (a root publisher writing into a bot-owned dir)."""
    n = highest_gen(dir_, key) + 1 if n is None else n
    final = os.path.join(dir_, f'{key}.g{n}.json')
    tmp = f'{final}.{os.getpid()}.{os.urandom(4).hex()}.tmp'
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(body, f, sort_keys=True, default=list)
            f.flush()
            os.fsync(f.fileno())
        if owner is not None:
            os.chown(tmp, owner[0], owner[1], follow_symlinks=False)
        try:
            os.link(tmp, final)
        except FileExistsError:
            return None
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass
    rx = re.compile(GEN_RE.format(key=re.escape(key)))
    for f in os.listdir(dir_):
        m = rx.match(f)
        if m and int(m.group(1)) <= n - keep:
            try:
                os.unlink(os.path.join(dir_, f))
            except OSError:
                pass
    return n


def read_gen(dir_, key):
    n = highest_gen(dir_, key)
    if n <= 0:
        return 0, None
    try:
        with open(os.path.join(dir_, f'{key}.g{n}.json')) as f:
            return n, json.load(f)
    except (OSError, ValueError):
        return n, None


# ---------------------------------------------------------------------------------------------- host state
def pool_roster(state_dir):
    out = []
    for d in glob.glob(os.path.join(state_dir, '_pool-*')):
        p = os.path.basename(d)[len('_pool-'):]
        if os.path.isdir(d) and not os.path.islink(d) and '.' not in p and not p.startswith('self-'):
            out.append(p)
    return sorted(out)


HOME_SOURCES = (r'town-chest-(-?\d+)_(-?\d+)_(-?\d+)\.cobble\.jsonl$', r'junkwell-site-(-?\d+)_(-?\d+)_(-?\d+)\.g\d+\.json$',
                r'junkwell-plinth-(-?\d+)_(-?\d+)_(-?\d+)\.json$', r'composter-site-(-?\d+)_(-?\d+)_(-?\d+)\.g\d+\.json$')


def pool_homes(state_dir, pools):
    """{pool: (x, y, z)} from the town's own state-file keys; every source that names a home must agree, else the town
    is left out and listed as a conflict (never guessed). -> (homes, problems)."""
    homes, problems = {}, {}
    for p in pools:
        d = os.path.join(state_dir, f'_pool-{p}')
        seen = Counter()
        try:
            names = os.listdir(d)
        except OSError as e:
            problems[p] = f'unreadable: {e}'
            continue
        for f in names:
            for rx in HOME_SOURCES:
                m = re.match(rx, f)
                if m:
                    seen[tuple(int(v) for v in m.groups())] += 1
        if len(seen) == 1:
            homes[p] = next(iter(seen))
        else:
            problems[p] = 'no home file' if not seen else f'conflicting homes {sorted(seen)}'
    return homes, problems


def read_sites(state_dir, pool):
    f = os.path.join(state_dir, f'_pool-{pool}', f'world-facts-{pool}.json')
    try:
        with open(f) as fh:
            return (json.load(fh) or {}).get('sites') or [], None
    except (OSError, ValueError) as e:
        return [], f'{type(e).__name__}'


# ---------------------------------------------------------------------------------------------- ES
def _ev(since_ms, until_ms, pools=None):
    from lib.estelemetry import EsEvents
    return EsEvents.load('skill', since=iso(since_ms), until=iso(until_ms), pools=pools)


def es_hour_counts(since_ms, until_ms):
    """{hour_ms: positioned docs} for every hour in [since, until), one histogram (0 where ES holds nothing)."""
    ev = _ev(since_ms, until_ms)
    q = ev._query()
    q['bool']['filter'].append({'exists': {'field': 'bot.pos.x'}})
    r = ev._search({'size': 0, 'query': q, 'aggs': {'h': {'date_histogram': {
        'field': '@timestamp', 'fixed_interval': '1h', 'min_doc_count': 0,
        'extended_bounds': {'min': iso(since_ms), 'max': iso(until_ms - 1)}}}}})
    out = {h: 0 for h in range(since_ms, until_ms, HOUR_MS)}
    for b in r['aggregations']['h']['buckets']:
        if since_ms <= int(b['key']) < until_ms:
            out[int(b['key'])] = b['doc_count']
    return out


def q1_body(q):
    return {'size': 0, 'track_total_hits': True, 'query': q, 'aggs': {'p': {'terms': {'field': 'exp.pool', 'size': 500}, 'aggs': {
        'x': {'histogram': {'field': 'bot.pos.x', 'interval': GRID, 'min_doc_count': 1}, 'aggs': {
            'z': {'histogram': {'field': 'bot.pos.z', 'interval': GRID, 'min_doc_count': 1}, 'aggs': {
                'first': {'min': {'field': '@timestamp'}}, 'last': {'max': {'field': '@timestamp'}},
                'b': {'terms': {'field': 'bot.name', 'size': 200}, 'aggs': {
                    'm': {'date_histogram': {'field': '@timestamp', 'fixed_interval': '1m', 'min_doc_count': 1}}}},
                'pc': {'filter': {'exists': {'field': 'perception.block_kinds'}}, 'aggs': {
                    'w': {'terms': {'field': 'perception.blocks.water', 'size': 200}}}}}}}}}}}}


def q2_body(q):
    return {'size': 0, 'track_total_hits': True, 'query': q, 'aggs': {
        'p': {'terms': {'field': 'exp.pool', 'size': 500}, 'aggs': {
            'b': {'terms': {'field': 'bot.name', 'size': 200}, 'aggs': {
                'm': {'date_histogram': {'field': '@timestamp', 'fixed_interval': '1m', 'min_doc_count': 1}, 'aggs': {
                    'top': {'top_hits': {'size': 1, 'sort': [{'@timestamp': 'desc'}], '_source': ['bot.pos']}}}}}}}},
        'stub': {'filter': {'terms': {'skill.name': list(STUB_KINDS)}}}}}


def es_fold_hour(h0, homes, log=lambda *a: None):
    """One hour -> its record. Aggregations for the map and presence; a bounded row pull for the event kinds."""
    h1 = h0 + HOUR_MS
    ev = _ev(h0, h1)
    q = ev._query()
    q['bool']['filter'].append({'exists': {'field': 'bot.pos.x'}})
    r1 = ev._search(q1_body(q))
    n1 = r1['hits']['total']['value']
    rec = {'hour': hour_key(h0), 'h0': h0, 'folded_at': iso(int(time.time() * 1000)), 'es_pos_docs': n1,
           'homes': {p: list(h) for p, h in homes.items()}}
    if not n1:
        rec.update(void=True, void_why='es_empty: no positioned document in the hour', regions={}, presence={}, bots={},
                   gather={}, mine={}, deaths=[], home=[], scans=[], turnbacks=[], sample=es_sample(h1))
        return rec
    r2 = ev._search(q2_body(q))
    n2 = r2['hits']['total']['value']
    rec['regions'] = parse_q1(r1, homes)
    rec['presence'], rec['bots'] = parse_q2(r2, homes)
    rec['q1_q2_docs'] = [n1, n2]
    if n1 != n2:                       # late ingest between the two aggregations: never trusted, refolded next tick
        rec['es_pos_docs'] = -1
    pools = sorted(homes)
    evp = _ev(h0, h1, pools=pools)
    fields = ['@timestamp', 'bot.name', 'exp.pool', 'bot.pos', 'skill.name', 'skill.status', 'skill.duration_ms',
              'skill.args', 'skill.inventory_delta', 'skill.fail_class', 'trigger']
    rows = list(evp.rows(fields=fields, match={'skill.name': list(ROW_KINDS)}, allow_zero=True, max_rows=200_000))
    if r2['aggregations']['stub']['doc_count']:
        rows += list(evp.rows(fields=fields + ['skill.detail'], match={'skill.name': list(STUB_KINDS)}, allow_zero=True,
                              max_rows=50_000))

    def prev_pos(bot, t):
        b = {'size': 1, '_source': ['bot.pos', '@timestamp'], 'sort': [{'@timestamp': 'desc'}],
             'query': {'bool': {'filter': [{'term': {'bot.name': bot}}, {'exists': {'field': 'bot.pos.x'}},
                                           {'range': {'@timestamp': {'lt': iso(t)[:-1] + f'.{t % 1000:03d}Z',
                                                                     'gte': iso(t - HOME_PREV_MS)}}}]}}}
        h = ev._search(b)['hits']['hits']
        p = (h[0]['_source'].get('bot') or {}).get('pos') if h else None
        return (p['x'], p.get('y'), p['z']) if p and p.get('x') is not None else None
    rec.update(fold_events(rows, homes, prev_pos))
    rec['row_kinds'] = dict(Counter((r.get('skill') or {}).get('name') for r in rows))
    rec['sample'] = es_sample(h1)
    rec['void'] = False
    return rec


def es_sample(t_ms):
    """Section 1.1's sample at t: each bot's newest positioned row in [t - 10 min, t) (EsEvents.latest)."""
    ev = _ev(t_ms - SAMPLE_MS, t_ms)
    lat = ev.latest(require='bot.pos.x', fields=['bot.pos', 'bot.inventory', 'bot.tools', 'bot.health', 'exp.pool'],
                    allow_zero=True)
    return {'at': iso(t_ms), 'rows': sample_rows(lat)}


def es_raw_rows(h0):
    """--parity: every positioned row of the hour, for the reference fold."""
    ev = _ev(h0, h0 + HOUR_MS)
    out = []
    for r in ev.rows(fields=['@timestamp', 'bot.name', 'exp.pool', 'bot.pos', 'perception.block_kinds',
                             'perception.blocks.water'], max_rows=400_000, allow_zero=True):
        p = (r.get('bot') or {}).get('pos') or {}
        if p.get('x') is None:
            continue
        pc = r.get('perception') or {}
        w = (pc.get('blocks') or {}).get('water') if isinstance(pc, dict) else None
        out.append({'t': ms_of(r['@timestamp']), 'bot': r['bot']['name'], 'pool': (r.get('exp') or {}).get('pool'),
                    'x': p['x'], 'y': p.get('y'), 'z': p['z'], 'perc': isinstance(pc, dict) and 'block_kinds' in pc,
                    'water': num(w)})
    return out


# ---------------------------------------------------------------------------------------------- the out dir
def hours_dir(out):
    return os.path.join(out, 'hours')


def write_json_atomic(path, doc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f'{path}.{os.getpid()}.tmp'
    with open(tmp, 'w') as f:
        json.dump(doc, f, sort_keys=True, default=list)
    os.replace(tmp, path)


def load_records(out):
    recs = []
    for f in sorted(glob.glob(os.path.join(hours_dir(out), '*.json'))):
        try:
            with open(f) as fh:
                recs.append(json.load(fh))
        except (OSError, ValueError):
            continue
    return recs


def script_version():
    with open(os.path.abspath(__file__), 'rb') as f:
        return hashlib.sha256(f.read()).hexdigest()[:12]


def heartbeat(out, rec):
    os.makedirs(out, exist_ok=True)
    rec = dict(rec, at=iso(int(time.time() * 1000)), version=script_version())
    with open(os.path.join(out, 'heartbeat.jsonl'), 'a') as f:
        f.write(json.dumps(rec, sort_keys=True) + '\n')
    write_json_atomic(os.path.join(out, 'heartbeat.json'), rec)


def read_heartbeat_lines(out, n=20000):
    try:
        with open(os.path.join(out, 'heartbeat.jsonl')) as f:
            return f.readlines()[-n:]
    except OSError:
        return []


# ---------------------------------------------------------------------------------------------- text
def render(fr_by_pool, base, cov, ctl, label=''):
    L = [f'FRONTIER CENSUS (E0) {label}']
    L.append(f'  coverage: fleet median {cov["fleet_median_bot_day"]} positioned rows per bot-day; uncovered days '
             f'{cov["uncovered_days"] or "none"}')
    L.append('  day         ratio hours void  ' + ' '.join(f'{p[:9]:>9}' for p in sorted(fr_by_pool)))
    for day, D in cov['days'].items():
        L.append(f'  {day}  {D["ratio"]:5.2f} {D["hours"]:5} {D["void_hours"]:4}  ' +
                 ' '.join(f'{D["towns"].get(p, 0):9.2f}' for p in sorted(fr_by_pool)) + ('' if D['covered'] else '  UNCOVERED'))
    L.append('  town        domain visited (>200) not_obs unknown hazard cands  top-3 candidates (i,j d align water)')
    for p, F in sorted(fr_by_pool.items()):
        c = F['counts']
        top = '; '.join(f'({r["i"]},{r["j"]} {r["d"]:.0f} {r["align"]} {r["water"]})' for r in F['ranking'][:3])
        L.append(f'  {p:<11} {c["domain"]:6} {c["visited"]:7} ({c["visited_beyond_200"]:3}) {c["not_observed"]:7} '
                 f'{c["unknown"]:7} {c["hazard"]:6} {c["candidates"]:5}  {top or "-"}')
    B = base['bands']
    L.append(f'  BASELINES shared towns {base["since"]} .. {base["until"]} ({base["hours"]} hours folded)')
    L.append('  band     bot-h (deep)   log: n ok% body-h /body-h   ore: n ok% body-h /body-h   mine ore/body-h  '
             'deaths /1k-bot-h (surface / deep)')
    for b in BAND_NAMES:
        r = B[b]
        L.append(f'  {b:<8} {r["bot_h"]:7.0f} ({r["bot_h_deep"]:5.0f})  {r["log_gathers"]:6} {r["log_ok_pct"] or 0:5.1f} '
                 f'{r["log_body_h"]:6.1f} {r["log_per_body_h"] or 0:6.1f}   {r["ore_gathers"]:6} {r["ore_ok_pct"] or 0:5.1f} '
                 f'{r["ore_body_h"]:6.1f} {r["ore_per_body_h"] or 0:6.1f}   {r["mine_ore_per_body_h"] or 0:6.1f}  '
                 f'{r["deaths"]:4} {r["deaths_per_1k_bot_h"] or 0:6.1f} ({r["deaths_per_1k_bot_h_surface"] or 0:.1f} / '
                 f'{r["deaths_per_1k_bot_h_deep"] or 0:.1f}) {r["death_causes"]}')
    hm = base['home']
    L.append('  home by start band (all triggers): ' + ', '.join(
        f'{b} {hm[f"{b}|*"]["ok"]}/{hm[f"{b}|*"]["n"]}' for b in BAND_NAMES + ('start_unknown',) if f'{b}|*' in hm))
    L.append('  home by trigger (all bands): ' + ', '.join(
        f'{k[2:]} {v["ok"]}/{v["n"]}' for k, v in hm.items() if k.startswith('*|') and k != '*|*'))
    bg = base['bag']
    n = bg['bot_samples'] or 1
    L.append(f'  bag eligibility (hourly samples): {bg["bot_samples"]} bot-samples; bag<=24 {100 * bg["bag<=24"] / n:.1f}%, '
             f'bag<=30 {100 * bg["bag<=30"] / n:.1f}%, pick>=40% {100 * bg["pick>=40%"] / n:.1f}%, at town '
             f'{100 * bg["at_town"] / n:.1f}%, ALL {bg["eligible"]} ({100 * bg["eligible"] / n:.2f}%); town-hours with one '
             f'{bg["town_hours_with_eligible"]} of {bg["town_hours"]}')
    if ctl:
        L.append(f'  instrument: samples {ctl["sampled_rows"]} in {ctl["sample_regions"]} regions; fold found '
                 f'{ctl["fold_regions"]} regions; sample rows whose region the fold lacks: {ctl["missing_n"]}')
    return '\n'.join(L)


# ---------------------------------------------------------------------------------------------- modes
def compute(out, state_dir, now_ms, border_r=BORDER_R):
    roster = pool_roster(state_dir)
    homes, problems = pool_homes(state_dir, roster)
    records = load_records(out)
    good = [r for r in records if not r.get('void')]
    data_until = max((r['h0'] + HOUR_MS for r in records), default=None)
    if data_until is None:
        return None
    since, until = window_bounds(now_ms, data_until)
    cov = coverage(records, since, until)
    frs, site_err = {}, {}
    for p, h in sorted(homes.items()):
        sites, err = read_sites(state_dir, p)
        if err:
            site_err[p] = err
        frs[p] = frontier(p, h, records, cov, now_ms, data_until, sites, border_r)
    base7 = baselines(records, sorted(homes), homes, max(since, data_until - 7 * DAY_MS), data_until)
    ctl = control_subset(records, since, until, homes)
    newest_good = max((r['h0'] + HOUR_MS for r in good), default=None)
    return {'roster': roster, 'homes': homes, 'home_problems': problems, 'records': records, 'cov': cov, 'frs': frs,
            'base7': base7, 'ctl': ctl, 'data_until': data_until, 'newest_good_until': newest_good,
            'site_errors': site_err, 'since': since}


def run_tick(a):
    t_start = time.time()
    now = int(time.time() * 1000)
    roster = pool_roster(a.state_dir)
    homes, problems = pool_homes(a.state_dir, roster)
    if not homes:
        from lib.estelemetry import ZeroLooksWrong
        raise ZeroLooksWrong(f'no shared town with a home under {a.state_dir} (roster {roster}, problems {problems})')
    settled = floor_hour(now - SETTLE_MS)                  # hours ending at or before this are foldable
    since = max(ms_of(WINDOW_START), settled - WINDOW_DAYS * DAY_MS)
    counts = es_hour_counts(since, settled)
    if not any(counts.values()):
        from lib.estelemetry import ZeroLooksWrong
        raise ZeroLooksWrong(f'ES holds no positioned document in {iso(since)}..{iso(settled)}: the instrument, not the fleet')
    have = {r['h0']: r for r in load_records(a.out_dir)}
    want_homes = {p: list(h) for p, h in homes.items()}
    todo = []
    for h0, n in sorted(counts.items()):
        r = have.get(h0)
        if r is None:
            todo.append((h0, 'new'))
        elif r.get('es_pos_docs') != n:
            todo.append((h0, f'count {r.get("es_pos_docs")} -> {n}'))
        elif r.get('homes') != want_homes:
            todo.append((h0, 'homes changed'))
    folded, refolded, void, reasons = 0, 0, 0, Counter()
    for h0, why in todo:
        if time.time() - t_start > a.budget_s:
            break
        rec = es_fold_hour(h0, homes)
        write_json_atomic(os.path.join(hours_dir(a.out_dir), f'{hour_key(h0)}.json'), rec)
        folded += 1
        refolded += why != 'new'
        void += bool(rec.get('void'))
        reasons[why.split(' ')[0]] += 1
        if a.pace_s:
            time.sleep(a.pace_s)
    backlog = len(todo) - folded
    C = compute(a.out_dir, a.state_dir, now)
    staged = []
    instrument = []
    if C:
        if C['ctl']['missing_n']:
            instrument.append(f'{C["ctl"]["missing_n"]} sampled rows fall in regions the fold lacks')
        wu = warmup(read_heartbeat_lines(a.out_dir), now)
        for p, F in C['frs'].items():
            doc = dict(F, generated_at=iso(now), data_until=iso(C['data_until']),
                       stale_after=iso(C['data_until'] + STALE_AFTER_MS),
                       newest_measured_hour_end=iso(C['newest_good_until']) if C['newest_good_until'] else None,
                       instrument_ok=not instrument, instrument=instrument,
                       census={'script': 'scripts/host/frontiercensus.py', 'version': script_version()}, warmup=wu,
                       coverage={'fleet_median_bot_day': C['cov']['fleet_median_bot_day'],
                                 'days': {d: {k: v for k, v in D.items() if k != 'towns'} | {'town': D['towns'].get(p)}
                                          for d, D in C['cov']['days'].items()}},
                       baselines_7d=C['base7'])
            doc['digest'] = content_digest(doc)
            write_json_atomic(os.path.join(a.out_dir, 'publish', p, f'{gen_key(C["homes"][p])}.json'), doc)
            staged.append(p)
        daily(a.out_dir, C)
    newest_h = max(counts)
    blind = not counts[newest_h]
    if instrument:
        status = 'instrument'
    elif C is None or blind or (folded and void == folded):
        status = 'void'
    elif backlog:
        status = 'behind'
    elif folded:
        status = 'ok'
    else:
        status = 'idle'
    nu = C['newest_good_until'] if C else None
    return {'status': status, 'hours_folded': folded, 'refolded': refolded, 'void_hours_folded': void,
            'backlog_hours': backlog, 'fold_reasons': dict(reasons), 'towns': len(homes), 'home_problems': problems,
            'staged': len(staged), 'instrument': instrument,
            'data_until': iso(C['data_until']) if C else None, 'newest_measured_hour_end': iso(nu) if nu else None,
            'window_void_hours': sum(1 for h0, n in counts.items() if not n),
            'es_blind_since': (iso(min(h for h in counts if all(not counts[k] for k in counts if k >= h)))
                               if blind else None),
            'uncovered_days': C['cov']['uncovered_days'] if C else None,
            'subset_missing': C['ctl']['missing_n'] if C else None}


def daily(out, C):
    """One text per complete UTC day (all 24 hours folded), written once."""
    by_day = Counter(iso(r['h0'])[:10] for r in C['records'])
    for day, n in sorted(by_day.items()):
        path = os.path.join(out, 'daily', f'frontier-{day}.txt')
        if n < 24 or os.path.exists(path):
            continue
        d0 = ms_of(day + 'T00:00:00Z')
        base = baselines(C['records'], sorted(C['homes']), C['homes'], d0, d0 + DAY_MS)
        ctl = control_subset(C['records'], d0 + HOUR_MS, d0 + DAY_MS, C['homes'])
        txt = render(C['frs'], base, C['cov'], ctl, label=f'-- daily {day} (baselines: that day; frontier: window '
                                                          f'{iso(C["since"])} .. {iso(C["data_until"])})')
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, 'w') as f:
            f.write(txt + '\n')


def run_publish(a):
    """As root: staged frontier files -> the pool state dirs, as generation files owned by the pool dir's owner."""
    now = int(time.time() * 1000)
    wu = warmup(read_heartbeat_lines(a.out_dir), now)
    if not wu['complete']:
        return {'status': 'warmup', 'warmup': wu, 'published': 0}
    pub, same, refused = [], 0, []
    for f in sorted(glob.glob(os.path.join(a.out_dir, 'publish', '*', 'frontier-*.json'))):
        pool = os.path.basename(os.path.dirname(f))
        try:
            with open(f) as fh:
                doc = json.load(fh)
        except (OSError, ValueError) as e:
            refused.append(f'{pool}: unreadable staged file ({type(e).__name__})')
            continue
        key = os.path.basename(f)[:-len('.json')]
        if doc.get('pool') != pool or gen_key(doc.get('home') or (0, 0, 0)) != key:
            refused.append(f'{pool}: staged file names another town')
            continue
        if now - ms_of(doc['generated_at']) > 20 * MIN_MS:
            refused.append(f'{pool}: staged file is stale ({doc["generated_at"]})')
            continue
        if not doc.get('instrument_ok'):
            refused.append(f'{pool}: instrument check failed: {doc.get("instrument")}')
            continue
        d = os.path.join(a.state_dir, f'_pool-{pool}')
        if not os.path.isdir(d) or os.path.islink(d):
            refused.append(f'{pool}: no pool dir (never created by the census)')
            continue
        n, cur = read_gen(d, key)
        if cur and cur.get('digest') == doc.get('digest'):
            same += 1
            continue
        st = os.stat(d)
        doc = dict(doc, warmup=wu)
        g = create_gen(d, key, doc, owner=(st.st_uid, st.st_gid) if os.geteuid() == 0 else None)
        if g is None:
            refused.append(f'{pool}: generation {n + 1} was taken by another writer')
        else:
            pub.append(f'{pool}:g{g}')
    return {'status': 'ok' if not refused else 'partial', 'published': len(pub), 'unchanged': same, 'gens': pub,
            'refused': refused, 'warmup': wu}


def run_report(a):
    now = int(time.time() * 1000)
    C = compute(a.out_dir, a.state_dir, now)
    if C is None:
        print('FRONTIER CENSUS -- VOID: no folded hour on record')
        return {'status': 'void'}
    print(render(C['frs'], C['base7'], C['cov'], C['ctl'], label=f'-- window {iso(C["since"])} .. {iso(C["data_until"])}'))
    return {'status': 'ok'}


def run_control(a):
    t0, t1 = ms_of(a.control[0]), ms_of(a.control[1])
    roster = pool_roster(a.state_dir)
    homes, _ = pool_homes(a.state_dir, roster)
    recs = load_records(a.out_dir)
    sh = control_shares(recs, t0, t1, homes)
    sub = control_subset(recs, t0, t1, homes)
    print(json.dumps({'window': [iso(t0), iso(t1)], 'shares': sh, 'subset': sub}, indent=1, default=list))
    return {'status': 'ok'}


def run_parity(a):
    h0 = floor_hour(ms_of(a.parity))
    roster = pool_roster(a.state_dir)
    homes, _ = pool_homes(a.state_dir, roster)
    path = os.path.join(hours_dir(a.out_dir), f'{hour_key(h0)}.json')
    with open(path) as f:
        rec = json.load(f)
    rows = es_raw_rows(h0)
    ref = fold_rows(rows, homes)
    diffs = []
    for p in sorted(set(ref['regions']) | set(rec['regions'])):
        A, B = ref['regions'].get(p, {}), rec['regions'].get(p, {})
        for k in sorted(set(A) | set(B)):
            if A.get(k) != B.get(k):
                diffs.append(('region', p, k, A.get(k), B.get(k)))
    for p in sorted(set(ref['presence']) | set(rec['presence'])):
        if ref['presence'].get(p) != rec['presence'].get(p):
            diffs.append(('presence', p, ref['presence'].get(p), rec['presence'].get(p)))
    for b in sorted(set(ref['bots']) | set(rec['bots'])):
        if ref['bots'].get(b) != rec['bots'].get(b):
            diffs.append(('bots', b, ref['bots'].get(b), rec['bots'].get(b)))
    nreg = sum(len(v) for v in ref['regions'].values())
    print(json.dumps({'hour': hour_key(h0), 'raw_positioned_rows': len(rows), 'record_es_pos_docs': rec['es_pos_docs'],
                      'regions_ref': nreg, 'regions_agg': sum(len(v) for v in rec['regions'].values()),
                      'bot_minutes_ref': sum(g[1] for v in ref['regions'].values() for g in v.values()),
                      'bots_ref': len(ref['bots']), 'diffs': len(diffs), 'first_diffs': diffs[:10]}, indent=1, default=list))
    return {'status': 'ok' if not diffs else 'instrument', 'parity_diffs': len(diffs)}


# ---------------------------------------------------------------------------------------------- the fixture
FX_H0 = ms_of('2026-10-10T00:00:00Z')
FX_HOME = (1000, 64, 0)


def fixture_rows():
    """The fixture world 'fx' (home 1000,64,0, so 'away from the origin' is +x). Known path, known visits:
      fx-A walks +x from x=1024 at 64 blocks a minute, rows every 10 s for 10 minutes (00:00-09:50): in minute m every row
           has x in [1024+64m, 1024+64m+50] -> exactly regions (16+m, 0), m = 0..9: 10 regions, 6 rows and 1 bot-minute
           each. Region (20, 0)'s rows carry perception with water at distance 1 (wet), 6 rows (< 10: label unknown).
      fx-B stands at home (1000, 64, 3), one row a minute for 3 hours, perception, no water (dry) -> region (15, 0):
           180 rows, 180 bot-minutes, perceived_land. Hour 2 it is at y=40 (deep).
      fx-C swims at (330, 63, 200) -> region (5, 3), 30 rows at 00:20:00-00:24:50 every 10 s, water 0 -> perceived_water.
      fx-D dies at (1700, 64, 40) at 01:30 -> its `_death` row is positioned: region (26, 0) is visited, and the hazard
           (32 blocks) covers (26, 0), (27, 0), (26, 1) -- (27, 1) is 36.9 away, (25, 0) 36.
      a world-facts site death:fire at (790, -470), last = 02:00 -> hazard (11,-8), (12,-8), (11,-7), (12,-7);
           a death:fall site 8 days old -> no hazard.
      two `_expedition_turnback` no_route rows for target 1312,352 -> region (20, 5) unreached.
      a row with no position (ignored by the fold).
    """
    rows = []
    for m in range(10):
        for s in range(6):
            x = 1024 + 64 * m + 10 * s
            w = 1 if 16 + m == 20 else None
            rows.append({'t': FX_H0 + m * MIN_MS + s * 10_000, 'bot': 'fx-A', 'pool': 'fx', 'x': x + 0.5, 'y': 64, 'z': 5.5,
                         'perc': 16 + m == 20, 'water': w})
    for m in range(180):
        rows.append({'t': FX_H0 + m * MIN_MS + 30_000, 'bot': 'fx-B', 'pool': 'fx', 'x': 1000.5, 'y': 40 if m >= 120 else 64,
                     'z': 3.5, 'perc': True, 'water': None})
    for s in range(30):
        rows.append({'t': FX_H0 + 20 * MIN_MS + s * 10_000, 'bot': 'fx-C', 'pool': 'fx', 'x': 330.2, 'y': 63, 'z': 200.7,
                     'perc': True, 'water': 0})
    rows.append({'t': FX_H0 + 90 * MIN_MS, 'bot': 'fx-D', 'pool': 'fx', 'x': 1700.5, 'y': 64, 'z': 40.5, 'perc': False,
                 'water': None})
    rows.append({'t': FX_H0 + 5 * MIN_MS, 'bot': 'fx-A', 'pool': 'fx', 'x': None, 'y': None, 'z': None})
    return rows


def fixture_events():
    def row(t, bot, kind, pos=None, trigger=None, **sk):
        r = {'@timestamp': iso(t)[:-1] + '.000Z', 'bot': {'name': bot}, 'exp': {'pool': 'fx'},
             'skill': dict(name=kind, **sk)}
        if trigger:
            r['trigger'] = trigger
        if pos:
            r['bot']['pos'] = {'x': pos[0], 'y': pos[1], 'z': pos[2]}
        return r
    return [
        row(FX_H0 + 90 * MIN_MS, 'fx-D', '_death', (1700.5, 64, 40.5), fail_class='fall'),
        # gathers: a log gather ending at x=1305 (d 305: band 300+), 30 s, 4 logs; an ore gather at home, deep, failed
        row(FX_H0 + 5 * MIN_MS, 'fx-A', 'gather', (1305.5, 64, 5.5), status='success', duration_ms=30_000,
            args={'block': 'oak_log', 'count': 4}, inventory_delta={'oak_log': 4, 'stick': 2}),
        row(FX_H0 + 125 * MIN_MS, 'fx-B', 'gather', (1000.5, 40, 3.5), status='failed', duration_ms=12_000,
            args={'block': 'iron_ore'}, inventory_delta={}),
        row(FX_H0 + 126 * MIN_MS, 'fx-B', 'gather', (1000.5, 40, 3.5), status='success', duration_ms=6_000,
            args={'block': 'deepslate_iron_ore'}, inventory_delta={'raw_iron': 1, 'cobbled_deepslate': 1}),
        row(FX_H0 + 30 * MIN_MS, 'fx-A', 'home', (1001.5, 64, 2.5), status='success', duration_ms=40_000,
            trigger='watchdog_home'),
        row(FX_H0 + 70 * MIN_MS, 'fx-C', 'home', (900.5, 64, 2.5), status='failed', fail_class='travel_incomplete',
            duration_ms=60_000),
        row(FX_H0 + 100 * MIN_MS, 'fx-A', '_expedition_turnback', None, detail='reason=no_route target=1312,352'),
        row(FX_H0 + 110 * MIN_MS, 'fx-A', '_expedition_turnback', None, detail='reason=no_route target=1300,360'),
        row(FX_H0 + 111 * MIN_MS, 'fx-A', '_expedition_turnback', None, detail='reason=deadline target=1500,0'),
    ]


def fixture_prev(bot, t):
    return {'fx-A': (1310.5, 64, 5.5), 'fx-C': None}.get(bot)


def fixture_records(rows=None):
    """Three hour records built from the fixture rows through fold_rows + fold_events (the tick's own reducers)."""
    rows = rows if rows is not None else fixture_rows()
    homes = {'fx': FX_HOME}
    ev = fold_events(fixture_events(), homes, fixture_prev)
    recs = []
    for h in range(3):
        h0 = FX_H0 + h * HOUR_MS
        part = fold_rows([r for r in rows if h0 <= r['t'] < h0 + HOUR_MS], homes)
        rec = {'hour': hour_key(h0), 'h0': h0, 'es_pos_docs': 1, 'void': False, 'homes': {'fx': list(FX_HOME)}, **part}
        for k in ('gather', 'mine'):
            rec[k] = ev[k] if h == 0 else {}
        for k in ('deaths', 'home', 'scans', 'turnbacks'):
            rec[k] = [x for x in ev[k] if h0 <= x[0] < h0 + HOUR_MS]
        rec['sample'] = {'at': iso(h0 + HOUR_MS),
                         'rows': [['fx-B', 'fx', 1000.5, 40 if h == 2 else 64, 3.5, 20, True, True, 20]]}
        recs.append(rec)
    return recs


FX_SITES = [{'kind': 'death:fire', 'x': 790, 'y': 64, 'z': -470, 'last': FX_H0 + 2 * HOUR_MS},
            {'kind': 'death:fall', 'x': 1100, 'y': 64, 'z': 300, 'last': FX_H0 - 8 * DAY_MS},
            {'kind': 'entombed', 'x': 1100, 'y': 64, 'z': -300, 'last': FX_H0}]


def fake_q1(rows, pools):
    """Build an ES-SHAPED region aggregation response from rows (histogram keys floor(v/64)*64 as floats, empty
    buckets included the way ES returns them) -- to test parse_q1's reading of the nesting, not the arithmetic."""
    P = []
    for p in sorted(pools):
        R = [r for r in rows if r['pool'] == p and r.get('x') is not None]
        xs = sorted({math.floor(r['x'] / 64) * 64.0 for r in R})
        xb = []
        for xk in (range(int(xs[0]), int(xs[-1]) + 64, 64) if xs else []):
            XR = [r for r in R if math.floor(r['x'] / 64) * 64 == xk]
            zs = sorted({math.floor(r['z'] / 64) * 64.0 for r in XR})
            zb = []
            for zk in (range(int(zs[0]), int(zs[-1]) + 64, 64) if zs else []):
                ZR = [r for r in XR if math.floor(r['z'] / 64) * 64 == zk]
                bots = sorted({r['bot'] for r in ZR})
                wd = Counter(str(int(r['water'])) for r in ZR if r.get('perc') and r.get('water') is not None)
                zb.append({'key': float(zk), 'doc_count': len(ZR),
                           'first': {'value': float(min(r['t'] for r in ZR)) if ZR else None},
                           'last': {'value': float(max(r['t'] for r in ZR)) if ZR else None},
                           'b': {'sum_other_doc_count': 0, 'doc_count_error_upper_bound': 0, 'buckets': [
                               {'key': b, 'doc_count': 0, 'm': {'buckets': [
                                   {'key': m} for m in sorted({r['t'] - r['t'] % MIN_MS for r in ZR if r['bot'] == b})]}}
                               for b in bots]},
                           'pc': {'doc_count': sum(1 for r in ZR if r.get('perc')), 'w': {
                               'sum_other_doc_count': 0, 'doc_count_error_upper_bound': 0,
                               'buckets': [{'key': k, 'doc_count': v} for k, v in wd.items()]}}})
            xb.append({'key': float(xk), 'z': {'buckets': zb}})
        P.append({'key': p, 'x': {'buckets': xb}})
    return {'aggregations': {'p': {'sum_other_doc_count': 0, 'doc_count_error_upper_bound': 0, 'buckets': P}}}


def load_checker():
    spec = importlib.util.spec_from_file_location('check_frontiercensus', os.path.join(HERE, 'check-frontiercensus.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def selftest(verbose=True):
    fails = []

    def check(name, got, want):
        if got != want:
            fails.append(f'{name}: got {got!r}, want {want!r}')
        elif verbose:
            print(f'  ok  {name} = {got!r}')

    homes = {'fx': FX_HOME}
    rows = fixture_rows()
    recs = fixture_records(rows)
    regs = sum_regions(recs, 'fx')
    want_vis = {rkey(16 + m, 0) for m in range(10)} | {rkey(15, 0), rkey(5, 3), rkey(26, 0)}
    check('known visits: exactly the path, home, the swim and the death', set(regs), want_vis)
    check('fx-A path: 6 rows and 1 bot-minute per region', {k: regs[k][:2] for k in sorted(regs) if k.endswith(',0')
                                                             and 16 <= unkey(k)[0] <= 25},
          {rkey(16 + m, 0): [6, 1] for m in range(10)})
    check('fx-B at home: 180 rows, 180 bot-minutes', regs[rkey(15, 0)][:2], [180, 180])
    check('last visit of (25,0) is 00:09:50', iso(regs[rkey(25, 0)][3]), '2026-10-10T00:09:50Z')
    check('the unpositioned row is not folded', sum(g[0] for g in regs.values()), 60 + 180 + 30 + 1)
    # coverage: three equal fixture hours are one part day; a fleet median needs complete days -> no median, uncovered
    cov0 = coverage(recs, FX_H0, FX_H0 + 3 * HOUR_MS)
    check('a window with no complete day is not covered (no fleet median)', cov0['uncovered_days'], ['2026-10-10'])
    # synthetic coverage days: 24 h at 100 rows/bot-hour, then 24 h at 70% -> the 70% day is uncovered
    def cov_rec(h0, per):
        return {'h0': h0, 'bots': {'b1': ['fx', per, 60], 'b2': ['fx', per, 60]}}
    D0 = ms_of('2026-10-12T00:00:00Z')
    crecs = [cov_rec(D0 + d * DAY_MS + h * HOUR_MS, 100) for d in range(3) for h in range(24)] \
        + [cov_rec(D0 + 3 * DAY_MS + h * HOUR_MS, 70) for h in range(24)] \
        + [cov_rec(D0 + 4 * DAY_MS + h * HOUR_MS, 50) for h in range(6)]
    c = coverage(crecs, D0, D0 + 5 * DAY_MS)
    check('coverage: the fleet median is over complete bot-days (6 x 2400, 2 x 1680)', c['fleet_median_bot_day'], 2400)
    check('coverage: the 70% day is uncovered; a 6-h part day at 50/h pro-rates to 1200 x 2 = 50%',
          (c['uncovered_days'], c['days']['2026-10-15']['ratio'], c['days']['2026-10-16']['ratio']),
          (['2026-10-15', '2026-10-16'], 0.7, 0.5))
    c79 = coverage([cov_rec(D0 + h * HOUR_MS, 100) for h in range(24)] + [cov_rec(D0 + DAY_MS + h * HOUR_MS, 100) for h in range(24)]
                   + [cov_rec(D0 + 2 * DAY_MS + h * HOUR_MS, 79) for h in range(24)], D0, D0 + 3 * DAY_MS)
    check('coverage: 79% of the median is uncovered, 100% covered', c79['uncovered_days'], ['2026-10-14'])
    # the frontier with coverage forced covered, then uncovered
    covered = {'uncovered_days': [], 'days': {'2026-10-10': {'covered': True}}, 'fleet_median_bot_day': 1}
    now = FX_H0 + 3 * HOUR_MS
    F = frontier('fx', FX_HOME, recs, covered, now, now, FX_SITES)
    R = {rkey(r['i'], r['j']): r for r in F['regions']}
    check('border: (28,0) in the domain, (29,0) out (its corner is 1921 from the origin, limit 1886)',
          (rkey(28, 0) in R, rkey(29, 0) in R), (True, False))
    check('domain radius: (30,0) centre 952 in, (31,0) centre 1016 out',
          (in_domain(30, 0, FX_HOME, 99999), in_domain(31, 0, FX_HOME, 99999)), (True, False))
    check('statuses: 13 visited, the rest not_observed', (F['counts']['visited'], F['counts']['unknown'],
                                                         F['counts']['not_observed']),
          (13, 0, F['counts']['domain'] - 13))
    hz = sorted(k for k, r in R.items() if 'hazard' in r)
    check('hazard: death row (26,0) (27,0) (26,1) + site (11,-8) (12,-8) (11,-7) (12,-7); old site and entombed none',
          hz, sorted([rkey(26, 0), rkey(27, 0), rkey(26, 1), rkey(11, -8), rkey(12, -8), rkey(11, -7), rkey(12, -7)]))
    check('unreached: two no_route turn-backs on region (20,5); the deadline one does not count',
          sorted(k for k, r in R.items() if 'unreached_until' in r), [rkey(20, 5)])
    check('water: (15,0) perceived_land, (5,3) perceived_water, (20,0) unknown (6 rows < 10), unvisited unknown',
          (R[rkey(15, 0)]['water'], R[rkey(5, 3)]['water'], R[rkey(20, 0)]['water'], R[rkey(20, -1)]['water']),
          ('perceived_land', 'perceived_water', 'unknown', 'unknown'))
    top = F['ranking'][0]
    check('ranking: the top candidate is (20,-1), d 313.6, facing straight away from the origin',
          (top['i'], top['j'], top['d'], top['align']), (20, -1, 313.6, 0.995))
    ok_rank = all(RING[0] <= r['d'] <= RING[1] and R[rkey(r['i'], r['j'])]['status'] == 'not_observed'
                  and 'hazard' not in R[rkey(r['i'], r['j'])] and 'unreached_until' not in R[rkey(r['i'], r['j'])]
                  for r in F['ranking'])
    check('ranking: every candidate is in the ring, not observed, no hazard, not unreached', ok_rank, True)
    halves = [0 if r['align'] >= 0 else 1 for r in F['ranking']]
    check('ranking: the away half-plane comes first', halves == sorted(halves), True)
    check('ranking: the hazard region (27,0) and unreached (20,5) are not candidates',
          any((r['i'], r['j']) in ((27, 0), (20, 5)) for r in F['ranking']), False)
    U = frontier('fx', FX_HOME, recs, {'uncovered_days': ['2026-10-10'], 'days': {'2026-10-10': {}}}, now, now, FX_SITES)
    check('an uncovered day: every region not visited is unknown, never not_observed, and nothing is a candidate',
          (U['counts']['not_observed'], U['counts']['unknown'], U['counts']['candidates']),
          (0, U['counts']['domain'] - 13, 0))
    # the aggregation parsers read the ES nesting the same as the reference fold
    for h in range(3):
        hr = [r for r in rows if FX_H0 + h * HOUR_MS <= r['t'] < FX_H0 + (h + 1) * HOUR_MS]
        check(f'parse_q1 == fold_rows (hour {h})', parse_q1(fake_q1(hr, ['fx', 'other']), homes),
              {'fx': fold_rows(hr, homes)['regions'].get('fx', {})})
    q2 = {'aggregations': {'p': {'buckets': [{'key': 'fx', 'b': {'buckets': [
        {'key': 'fx-B', 'doc_count': 2, 'm': {'buckets': [
            {'key': FX_H0, 'top': {'hits': {'hits': [{'_source': {'bot': {'pos': {'x': 1000.5, 'y': 64, 'z': 3.5}}}}]}}},
            {'key': FX_H0 + MIN_MS, 'top': {'hits': {'hits': [{'_source': {'bot': {'pos': {'x': 1250.5, 'y': 50, 'z': 3.5}}}}]}}}]}}]}}]}}}
    check('parse_q2: presence by band and depth, bot counts', parse_q2(q2, homes),
          ({'fx': {'0-48|surface': 1, '200-300|deep': 1}}, {'fx-B': ['fx', 2, 2]}))
    # baselines
    B = baselines(recs, ['fx'], homes, FX_H0, FX_H0 + 3 * HOUR_MS)
    b3 = B['bands']['300+']
    check('baseline: log gathers at 300+: 1 row, 100% ok, 4 logs in 30 s = 480 per body-hour',
          (b3['log_gathers'], b3['log_ok_pct'], b3['log_got'], b3['log_per_body_h']), (1, 100.0, 4, 480.0))
    b0 = B['bands']['0-48']
    check('baseline: ore at home (deep): 2 rows, 50% ok, 1 ore in 18 s = 200 per body-hour, deep 200, surface none',
          (b0['ore_gathers'], b0['ore_ok_pct'], b0['ore_per_body_h'], b0['ore_per_body_h_deep'], b0['ore_per_body_h_surface']),
          (2, 50.0, 200.0, 200.0, None))
    # presence: fx-B 120 surface minutes + 60 deep at home; fx-C 5 min at d 686 (300+); fx-A 10 min at 24..
    check('baseline: bot-hours by band from the newest row per bot-minute',
          (B['bands']['0-48']['bot_h_surface'], B['bands']['0-48']['bot_h_deep'], B['bands']['300+']['bot_h']),
          (2.0, 1.0, 0.2))
    check('baseline: one death at 300+ (d 700), surface; per 1k bot-h on 0.2 bot-h',
          (b3['deaths'], b3['deaths_surface'], b3['deaths_per_1k_bot_h']), (1, 1, round(1000 / ((5 + 6 + 1) / 60), 1)))
    check('baseline: home by start band and trigger (fx-A start d 310 -> 300+ watchdog ok; fx-C start unknown)',
          (B['home'].get('300+|watchdog_home'), B['home'].get('start_unknown|other')),
          ({'n': 1, 'ok': 1, 'pct': 100.0}, {'n': 1, 'ok': 0, 'pct': 0.0}))
    check('baseline: bag eligibility: 3 town-hours, fx-B eligible in 2 (hour 3 it is deep: not at town)',
          (B['bag']['town_hours'], B['bag']['town_hours_with_eligible'], B['bag']['eligible']), (3, 2, 2))
    # the controls' own estimators
    sh = control_shares(recs, FX_H0, FX_H0 + 3 * HOUR_MS, homes)
    check('control_shares: 3 samples, all 0-48, one deep', (sh['samples'], sh['shares']['0-48'], sh['deep']), (3, 100.0, 33.3))
    sub = control_subset(recs, FX_H0, FX_H0 + 3 * HOUR_MS, homes)
    check('control_subset: every sampled region is in the fold', sub['missing_n'], 0)
    bad = [dict(r, regions={'fx': {}}) if r['h0'] == FX_H0 + HOUR_MS else r for r in recs]
    check('control_subset POSITIVE CONTROL: a fold that lost hour 1 is caught', control_subset(bad, FX_H0, FX_H0 + 3 * HOUR_MS,
                                                                                             homes)['missing_n'], 1)
    # warm-up
    def hb(t, st='ok'):
        return json.dumps({'mode': 'tick', 'at': iso(t), 'status': st})
    T = ms_of('2026-10-20T00:00:00Z')
    lines = [hb(T + n * 5 * MIN_MS) for n in range(int(48 * 12) + 1)]
    check('warm-up: 48 h of 5-min ticks completes', warmup(lines, T + 48 * HOUR_MS)['complete'], True)
    check('warm-up: 47 h does not', warmup(lines[:-12], T + 47 * HOUR_MS)['complete'], False)
    gap = lines[:100] + lines[107:]
    check('warm-up: a 40-min gap restarts it', warmup(gap, T + 48 * HOUR_MS)['run_start'], iso(T + 107 * 5 * MIN_MS))
    check('warm-up: a failed self-test restarts it',
          warmup(lines[:50] + [hb(T + 50 * 5 * MIN_MS + 1, 'selftest_failed')] + lines[51:], T + 48 * HOUR_MS)['run_start'],
          iso(T + 51 * 5 * MIN_MS))
    check('warm-up: a dead census (last tick 40 min ago) is not warm', warmup(lines, T + 48 * HOUR_MS + 45 * MIN_MS)['complete'],
          False)
    # the generation protocol
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        g1 = create_gen(td, 'frontier-1_2_3', {'a': 1})
        g2 = create_gen(td, 'frontier-1_2_3', {'a': 2})
        n, cur = read_gen(td, 'frontier-1_2_3')
        check('generations: g1, g2, the reader takes the highest', (g1, g2, n, cur), (1, 2, 2, {'a': 2}))
        with open(os.path.join(td, 'frontier-1_2_3.g3.json'), 'w') as fh:
            fh.write('{"other": 1}')
        lost = create_gen(td, 'frontier-1_2_3', {'a': 3}, n=3)          # a racing writer that read N = 2
        with open(os.path.join(td, 'frontier-1_2_3.g3.json')) as fh:
            g3 = json.load(fh)
        check('generations: a number another writer took is never overwritten (link fails -> None)', (lost, g3),
              (None, {'other': 1}))
        check('generations: the next writer takes g4', create_gen(td, 'frontier-1_2_3', {'a': 4}), 4)
        for _ in range(KEEP_GENS + 2):
            create_gen(td, 'frontier-1_2_3', {'a': 0})
        left = sorted(int(re.search(r'g(\d+)', f).group(1)) for f in os.listdir(td) if f.startswith('frontier-1_2_3.g'))
        check('generations: pruned to the newest KEEP_GENS, no tmp left', (len(left), left[-1],
                                                                          any(f.endswith('.tmp') for f in os.listdir(td))),
              (KEEP_GENS, 4 + KEEP_GENS + 2, False))
        open(os.path.join(td, 'other.g9.json'), 'w').write('{}')
        check('generations: another key is never touched', os.path.exists(os.path.join(td, 'other.g9.json')), True)
    # homes
    with tempfile.TemporaryDirectory() as td:
        for p, files in (('a', ['town-chest-1_2_3.cobble.jsonl', 'junkwell-site-1_2_3.g1.json']),
                         ('b', ['town-chest-1_2_3.cobble.jsonl', 'composter-site-4_5_6.g1.json']), ('c', [])):
            os.makedirs(os.path.join(td, f'_pool-{p}'))
            for f in files:
                open(os.path.join(td, f'_pool-{p}', f), 'w').close()
        os.makedirs(os.path.join(td, '_pool-self-isolated-a-Alpha'))
        os.makedirs(os.path.join(td, '_pool-a.pre-reseed-1'))
        H, P = pool_homes(td, pool_roster(td))
        check('homes: sources agree -> the home; disagree -> left out; none -> left out; isolated/reseed not towns',
              (H, sorted(P), pool_roster(td)), ({'a': (1, 2, 3)}, ['b', 'c'], ['a', 'b', 'c']))
    # the checker
    chk = load_checker()
    now_s = ms_of('2026-10-20T12:00:00Z') / 1000

    def hbc(at, st='ok', **kw):
        return json.dumps(dict({'mode': 'tick', 'at': at, 'status': st, 'newest_measured_hour_end': '2026-10-20T11:00:00Z'},
                               **kw))
    check('checker: a healthy tick', chk.assess([hbc('2026-10-20T11:58:00Z')], now_s)[0], [])
    check('checker: no heartbeat', chk.assess([], now_s)[0][0].startswith('FrontierMissing'), True)
    check('checker: 40-min-old tick is stale', any(x.startswith('FrontierStale') for x in chk.assess(
        [hbc('2026-10-20T11:20:00Z')], now_s)[0]), True)
    check('checker: error', any(x.startswith('FrontierError') for x in chk.assess(
        [hbc('2026-10-20T11:58:00Z', 'error', error='x')], now_s)[0]), True)
    check('checker: void (ES blind) reads VOID, never zero', any(x.startswith('FrontierVoid') for x in chk.assess(
        [hbc('2026-10-20T11:58:00Z', 'void', newest_measured_hour_end='2026-10-19T23:00:00Z')], now_s)[0]), True)
    check('checker: ticking but the newest measured hour is 3 h old', any(x.startswith('FrontierBehind') for x in chk.assess(
        [hbc('2026-10-20T11:58:00Z', 'idle', newest_measured_hour_end='2026-10-20T09:00:00Z')], now_s)[0]), True)
    check('checker: an instrument failure alarms', any(x.startswith('FrontierInstrument') for x in chk.assess(
        [hbc('2026-10-20T11:58:00Z', 'instrument', instrument=['x'])], now_s)[0]), True)
    check('checker: an ad-hoc run is not the standing census', chk.assess(
        [json.dumps({'mode': 'report', 'at': '2026-10-20T11:59:00Z', 'status': 'ok'})], now_s)[0][0].startswith('FrontierMissing'),
        True)
    if fails:
        print('SELFTEST FAILED:')
        for f in fails:
            print('  !! ' + f)
        return False
    if verbose:
        print('SELFTEST OK (fixture world + controls)')
    return True


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument('--selftest', action='store_true')
    g.add_argument('--tick', action='store_true')
    g.add_argument('--publish', action='store_true')
    g.add_argument('--report', action='store_true')
    g.add_argument('--control', nargs=2, metavar=('SINCE', 'UNTIL'))
    g.add_argument('--parity', metavar='HOUR')
    ap.add_argument('--out-dir', default=os.path.expanduser('~/frontiercensus/out'))
    ap.add_argument('--state-dir', default='/var/lib/mcai')
    ap.add_argument('--budget-s', type=float, default=TICK_BUDGET_S)
    ap.add_argument('--pace-s', type=float, default=0.5, help='sleep between hour folds (be gentle with ES)')
    a = ap.parse_args()
    if a.selftest:
        return 0 if selftest() else 1
    mode = next(m for m in ('tick', 'publish', 'report', 'control', 'parity') if getattr(a, m))
    t0 = time.time()
    rec = {'mode': mode}
    lock = None
    try:
        if not selftest(verbose=False):
            rec.update(status='selftest_failed', error='the fixture self-test failed: no live reading was made')
            print('SELFTEST FAILED -- refusing to read the fleet; run --selftest for the list')
            return 2
        if mode in ('tick', 'publish'):
            os.makedirs(a.out_dir, exist_ok=True)
            lock = open(os.path.join(a.out_dir, '.lock'), 'a')
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                rec.update(status='locked', error='another tick or publish holds the lock')
                return 3
        rec.update({'tick': run_tick, 'publish': run_publish, 'report': run_report, 'control': run_control,
                    'parity': run_parity}[mode](a))
        return 0 if rec.get('status') not in ('instrument',) else 4
    except Exception as e:
        rec.update(status='error', error=f'{type(e).__name__}: {e}'[:400])
        print(f'ERROR {type(e).__name__}: {e}', file=sys.stderr)
        return 1
    finally:
        rec['duration_s'] = round(time.time() - t0, 1)
        if mode == 'publish':
            print(f'{iso(int(time.time() * 1000))} publish {json.dumps(rec, sort_keys=True, default=list)}')
        elif mode == 'tick':
            try:
                heartbeat(a.out_dir, rec)
            except OSError as e:
                print(f'HEARTBEAT NOT WRITTEN: {e}', file=sys.stderr)
            print(f'{iso(int(time.time() * 1000))} tick {rec.get("status")} folded {rec.get("hours_folded")} '
                  f'(refold {rec.get("refolded")}, void {rec.get("void_hours_folded")}) backlog {rec.get("backlog_hours")} '
                  f'data_until {rec.get("data_until")} measured_until {rec.get("newest_measured_hour_end")} '
                  f'{rec.get("error", "")}'.rstrip())


if __name__ == '__main__':
    sys.exit(main())
