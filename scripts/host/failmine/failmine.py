#!/usr/bin/env python3
"""failmine.py -- FAILURE MINING -> SANDBOX SCENES (OWNER 2026-10-24: analysis and tooling, no bot code, no canary slot).

READ-ONLY on the fleet. Elasticsearch through scripts/lib/estelemetry.py (refuses 10-07, zero-guarded); world geometry
from COPIES of the nightly backup's staged region files (never a live world, never RCON). Design and evidence:
docs/reports/failmine-2026-10-24.md.

    failmine.py mine   --seeds META.json [--until ISO] [--days 7] [--out DIR] [--top-deaths 3] [--top-stuck 2]
    failmine.py cut    <clusters.json> <regions-dir> [--out DIR] [--only ID,...] [--library sandbox/scenes]
    failmine.py fetch  <clusters.json> <regions-dir> [--only ID,...]    region files for the picks (restricted key)
    failmine.py meta   <out.json>                                       seeds/homes/gamerules (restricted key)
    failmine.py weekly [--home ~/failmine]                              the cron entry on 10.0.0.31
    failmine.py table  <clusters.json>                                  print the ranked tables again

WHAT IT MEASURES (every label comes from WORLD, BAG or POSITION evidence, never from an intent row):
  * DEATHS: every `_death` row. The cause is the SERVER's death message at the head of the row's detail (the vanilla
    text: "tried to swim in lava", "was impaled on a stalagmite after falling 21 blocks", ...), the place is the row's
    bot.pos (= the death site the bot records: checked 277/277 against _death_site_recorded on 10-24).
  * STUCK: a STILL SPELL is >= 3 consecutive 10-minute buckets of one bot whose positioned rows each fit a 3x3x3-block
    box, every bucket's centre within 3 blocks of the spell's first. That is position evidence only: a bot that does not
    move for 30 min has lost that time whatever its rows say it intended. Whether it is TRAPPED is read from the world:
    the geometry label of the cut (wet under a ceiling, a water pit, an enclosed dry cell, or open ground).
  * CLUSTERS: deaths by (world SEED, cause family, place: single linkage within 6 blocks horizontally and vertically);
    still spells by (SEED, place: within 4). Ten of the sixteen worlds share seed 1239381899, so one cave kills bots in
    many worlds and is one cluster.
  * RANK: death clusters by deaths, stuck clusters by bot-hours lost. Denominators are printed with every number.
  * PICKS -> SCENES: the top clusters are cut from the region copy of the world that holds the cluster's newest
    member, with the bot's start (its own positioned rows), its bag (bot.inventory + bot.tools durability) and a
    success oracle. Intent rows are used for ONE thing only: the scene replays the skill the dead bot was running
    (`script`), a reproduction input whose result the oracle then reads from the world.

BLIND INPUT FAILS LOUDLY (CLAUDE.md "believing a cheap negative"): a renamed death kind, death rows without a
position, position buckets missing for bots that were present, positions that never change, a missing region file, an
ungenerated chunk, a palette index out of range -- each RAISES. Nothing here returns a zero it could not have seen past.
"""
import argparse, collections, datetime as dt, gzip, hashlib, io, json, math, os, re, shutil, struct, subprocess, sys, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA = 'failmine-scene/1'
CLUSTERS_SCHEMA = 'failmine-clusters/1'

# ------------------------------------------------------------------ the instrument's constants (docs section 2)
BUCKET_MS = 600_000          # the still detector's bucket (10 min)
STILL_BOX = 3.0              # a bucket is STILL when its positioned rows span <= 3 blocks on every axis
ANCHOR_TOL = 3.0             # ... and its centre lies within 3 blocks (each axis) of the spell's first bucket
MIN_SPELL_BUCKETS = 3        # a spell is >= 30 min
DEATH_LINK_H, DEATH_LINK_Y = 6.0, 6.0
STILL_LINK_H, STILL_LINK_Y = 4.0, 4.0
MIN_POSITIONED_BOT_SHARE = 0.9   # buckets must exist for >= 90% of the bots ES saw in the window
MAX_STILL_SHARE = 0.6            # > 60% of positioned bot-time still = positions are frozen, not a finding (7 d: 19.5%)
MAX_UNCLASSIFIED_DEATH_SHARE = 0.25
LEADUP_S = 180
INGEST_SLACK_MS = 10 * 60_000

class ZeroLooksWrong(LookupError):
    """A zero (or an absence) that is probably the instrument, not the fleet. Same name as lib/telemetry.py's."""

class BlindInput(ValueError):
    """The input cannot support a finding: a field missing, a file missing, a value out of range."""

# where scripts/lib (telemetry.py, estelemetry.py) lives: the repo checkout, or the host's ~/estel copy
# (an install copies a PINNED lib/ next to this file, so the cron does not drift with ~/estel)
LIB_DIRS = [os.environ.get('FAILMINE_LIB') or '', HERE, os.path.join(HERE, '..', '..'), os.path.expanduser('~/estel/scripts')]
for _d in LIB_DIRS:
    if _d and os.path.exists(os.path.join(_d, 'lib', 'estelemetry.py')):
        sys.path.insert(0, _d)
        break
try:                                    # one `except` covers both when the ES library is importable
    from lib.telemetry import ZeroLooksWrong as _TZ  # noqa: E402
    ZeroLooksWrong = _TZ                 # noqa: F811
except Exception:                        # pragma: no cover
    pass

# ------------------------------------------------------------------ death causes: the server's message
# (cause, family, regex on the message head). The family is the clustering key; the cause is reported inside it.
DEATH_CAUSES = [
    ('lava after a fall', 'lava', r'tried to swim in lava after falling'),
    ('lava', 'lava', r'tried to swim in lava'),
    ('magma', 'lava', r'discovered the floor was lava'),
    ('burned', 'lava', r'burn|walked into fire|went up in flames|crisp'),
    ('drowned', 'drowned', r'^drowned'),
    ('stalagmite', 'fall', r'impaled on a stalagmite'),
    ('fall', 'fall', r'fell from a high place|hit the ground|^fell (off|while|out of|into)'),
    ('doomed to fall', 'fall', r'doomed to fall'),
    ('stalactite', 'stalactite', r'stalactite'),
    ('suffocated', 'suffocated', r'suffocated'),
]
FAMILIES = sorted({f for _, f, _ in DEATH_CAUSES}) + ['unclassified']


def death_message(detail):
    return str(detail or '').split(';')[0].split('|')[0].strip()


def classify_death(detail):
    """-> (cause, family). An unknown message is 'unclassified' (kept and reported, never dropped)."""
    msg = death_message(detail)
    for cause, fam, rx in DEATH_CAUSES:
        if re.search(rx, msg):
            return cause, fam
    return 'other: ' + ' '.join(msg.split()[:4]), 'unclassified'


def fall_blocks(detail):
    m = re.search(r'after falling (\d+) blocks', str(detail or ''))
    return int(m.group(1)) if m else None


def world_of(bot):
    """board-a-Comet -> board-a. The world is the bot NAME's pool (exp.pool is the MEMORY pool: self-isolated-c-Delta)."""
    if not isinstance(bot, str) or bot.count('-') < 2:
        raise BlindInput(f'cannot read a world from bot name {bot!r}')
    return bot.rsplit('-', 1)[0]


def ms_of(ts):
    return int(dt.datetime.fromisoformat(str(ts).replace('Z', '+00:00')).timestamp() * 1000)


def iso_ms(t):
    return dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def pos_of(row):
    p = ((row or {}).get('bot') or {}).get('pos') or {}
    try:
        return (float(p['x']), float(p['y']), float(p['z']))
    except (KeyError, TypeError, ValueError):
        return None


def cell_of(p):
    return (math.floor(p[0]), math.floor(p[1]), math.floor(p[2]))


# ------------------------------------------------------------------ deaths -> points
def death_points(rows, meta, expected=None):
    """The `_death` rows as points. Raises on a missing position, an unknown world, or a count that disagrees."""
    if expected is not None and len(rows) != expected:
        raise BlindInput(f'{len(rows)} death rows streamed, {expected} counted: not a complete read')
    if not rows:
        raise ZeroLooksWrong('0 death rows: in a fleet that dies ~0.02 times per bot-hour this is the query, not the fleet')
    pts, nopos, unk = [], [], collections.Counter()
    for r in rows:
        bot = (r.get('bot') or {}).get('name')
        p = pos_of(r)
        if p is None:
            nopos.append(bot)
            continue
        w = world_of(bot)
        if w not in meta:
            raise BlindInput(f'death of {bot}: world {w!r} is not in the seeds file ({sorted(meta)})')
        det = (r.get('skill') or {}).get('detail')
        cause, fam = classify_death(det)
        if fam == 'unclassified':
            unk[cause] += 1
        pts.append({'t': ms_of(r['@timestamp']), 'bot': bot, 'world': w, 'seed': meta[w]['seed'], 'family': fam,
                    'cause': cause, 'pos': p, 'fell': fall_blocks(det), 'detail': str(det or '')[:400],
                    'fail_class': (r.get('skill') or {}).get('fail_class')})
    if nopos:
        raise BlindInput(f'{len(nopos)} of {len(rows)} death rows carry no bot.pos (e.g. {nopos[:3]}): '
                         f'the place of a death is the whole point; refusing to cluster a partial set')
    if sum(unk.values()) > MAX_UNCLASSIFIED_DEATH_SHARE * len(pts):
        raise BlindInput(f'{sum(unk.values())} of {len(pts)} death messages match no known cause ({unk.most_common(3)}): '
                         f'the detail format changed, so the cause split would be fiction')
    return pts


# ------------------------------------------------------------------ position buckets -> still spells
def check_boxes(boxes, bots_present, active=None):
    """Guards on the position stream (the positive controls the still detector needs). `active` = the number of
    (bot, 10-minute) buckets holding ANY row: positions must cover >= 90% of them, or the still detector is reading a
    thinned stream (a field that moved for some rows, a logger that stopped snapshotting)."""
    if not boxes:
        raise ZeroLooksWrong('0 position buckets: bot.pos is missing or renamed, not a fleet that never moved')
    if active is not None and len(boxes) < MIN_POSITIONED_BOT_SHARE * active:
        raise BlindInput(f'position buckets cover {len(boxes)} of {active} active (bot, 10-min) buckets '
                         f'({100 * len(boxes) / active:.0f}%): positions are missing from part of the stream')
    incomplete = [b for b in boxes if None in b[3:9]]
    if incomplete:
        raise BlindInput(f'{len(incomplete)} position buckets lack an axis (e.g. {incomplete[0][:2]}): a null extreme reads as '
                         f'motion, so the still detector would be blind there')
    seen = {b[0] for b in boxes}
    missing = sorted(set(bots_present) - seen)
    if bots_present and len(seen & set(bots_present)) < MIN_POSITIONED_BOT_SHARE * len(set(bots_present)):
        raise BlindInput(f'position buckets for {len(seen & set(bots_present))} of {len(set(bots_present))} bots '
                         f'present (missing e.g. {missing[:4]}): the position field is not where the query reads it')
    still = sum(1 for b in boxes if is_still(b))
    if still > MAX_STILL_SHARE * len(boxes):
        raise BlindInput(f'{still} of {len(boxes)} buckets are still ({100 * still / len(boxes):.0f}%): positions look '
                         f'frozen (a snapshot bug), not a fleet that stopped')
    return {'buckets': len(boxes), 'bot_h': round(len(boxes) / 6, 1), 'bots': len(seen), 'still_buckets': still,
            'still_share': round(still / len(boxes), 4), 'moving_buckets': len(boxes) - still, 'bots_missing': missing}


def is_still(b):
    _, _, n, x0, x1, y0, y1, z0, z1 = b
    if None in (x0, x1, y0, y1, z0, z1):
        return False
    if n < 2:                    # one row cannot show motion, so it cannot show stillness either (Claude r1 P3)
        return False
    return (x1 - x0) <= STILL_BOX and (y1 - y0) <= STILL_BOX and (z1 - z0) <= STILL_BOX


def merge_boxes(boxes):
    """One record per (bot, bucket). A bucket that straddles two query windows (the day-by-day reads) comes back twice,
    once per window, each with part of its rows: merged here, or every day boundary would cut every spell (and count
    its bucket twice -- measured 10-24: 81,175 records for 80,631 buckets, every spell capped at 24.2 h)."""
    m = {}
    for b in boxes:
        k = (b[0], b[1])
        if k not in m:
            m[k] = list(b)
            continue
        o = m[k]
        o[2] += b[2]
        for i, f in ((3, min), (4, max), (5, min), (6, max), (7, min), (8, max)):
            vals = [v for v in (o[i], b[i]) if v is not None]
            o[i] = f(vals) if vals else None
    return sorted(m.values(), key=lambda b: (b[0], b[1]))


def find_spells(boxes, window_lo_ms=None, window_hi_ms=None):
    """boxes: [bot, t_ms, n, minx, maxx, miny, maxy, minz, maxz] -> still spells (>= MIN_SPELL_BUCKETS)."""
    by = collections.defaultdict(list)
    for b in merge_boxes(boxes):
        by[b[0]].append(b)
    spells = []
    for bot, rows in by.items():
        rows.sort(key=lambda r: r[1])
        cur = None
        for r in rows:
            c = ((r[3] + r[4]) / 2, (r[5] + r[6]) / 2, (r[7] + r[8]) / 2) if is_still(r) else None
            if c and cur and r[1] - cur['t1'] == BUCKET_MS and all(abs(c[i] - cur['anchor'][i]) <= ANCHOR_TOL for i in range(3)):
                cur['t1'] = r[1]; cur['buckets'] += 1; cur['rows'] += r[2]
                continue
            if cur and cur['buckets'] >= MIN_SPELL_BUCKETS:
                spells.append(cur)
            cur = {'bot': bot, 't0': r[1], 't1': r[1], 'anchor': c, 'buckets': 1, 'rows': r[2]} if c else None
        if cur and cur['buckets'] >= MIN_SPELL_BUCKETS:
            spells.append(cur)
    last_seen = {bot: max(r[1] for r in rows) for bot, rows in by.items()}
    for s in spells:
        # hours CLIPPED to the window: an edge bucket counts only its part inside [lo, hi) (Codex r1 P2)
        lo = window_lo_ms if window_lo_ms is not None else s['t0']
        hi = window_hi_ms if window_hi_ms is not None else s['t1'] + BUCKET_MS
        s['bot_h'] = round(max(0, min(s['t1'] + BUCKET_MS, hi) - max(s['t0'], lo)) / 3_600_000, 3)
        s['from_window_start'] = window_lo_ms is not None and s['t0'] - window_lo_ms < BUCKET_MS
        # ONGOING (Codex r1 P2): the spell holds the bot's LAST observed bucket, and that bucket touches the window's end --
        # a spell followed by a moving bucket has ended, however close to the end it is
        s['ongoing'] = window_hi_ms is not None and s['t1'] == last_seen[s['bot']] and window_hi_ms - (s['t1'] + BUCKET_MS) < BUCKET_MS
    return spells


# ------------------------------------------------------------------ clustering (single linkage, grid-bucketed)
def link(items, pos, rh, ry):
    """Single-linkage components of `items` where two are linked when within rh horizontally and ry vertically."""
    par = list(range(len(items)))

    def find(i):
        while par[i] != i:
            par[i] = par[par[i]]
            i = par[i]
        return i
    grid = collections.defaultdict(list)
    cs = max(rh, 1.0)
    P = [pos(it) for it in items]
    for i, p in enumerate(P):
        grid[(math.floor(p[0] / cs), math.floor(p[2] / cs))].append(i)
    for i, p in enumerate(P):
        gx, gz = math.floor(p[0] / cs), math.floor(p[2] / cs)
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                for j in grid.get((gx + dx, gz + dz), ()):
                    if j < i:
                        q = P[j]
                        if math.hypot(p[0] - q[0], p[2] - q[2]) <= rh and abs(p[1] - q[1]) <= ry:
                            par[find(i)] = find(j)
    comp = collections.defaultdict(list)
    for i in range(len(items)):
        comp[find(i)].append(items[i])
    return list(comp.values())


def _centre(ps):
    return [round(sum(p[i] for p in ps) / len(ps), 1) for i in range(3)]


def _span(ps):
    return [round(max(p[i] for p in ps) - min(p[i] for p in ps), 1) for i in range(3)]


def _densest(members, pos, rh, ry):
    """The member with the most other members within (rh, ry); ties to the newest. The cut is centred on it."""
    def score(m):
        p = pos(m)
        return (sum(1 for o in members if math.hypot(pos(o)[0] - p[0], pos(o)[2] - p[2]) <= rh and abs(pos(o)[1] - p[1]) <= ry),
                m.get('t', m.get('t1', 0)))
    return max(members, key=score)


def cluster_deaths(pts):
    groups = collections.defaultdict(list)
    for p in pts:
        groups[(p['seed'], p['family'])].append(p)
    out = []
    for (seed, fam), L in groups.items():
        for comp in link(L, lambda q: q['pos'], DEATH_LINK_H, DEATH_LINK_Y):
            ps = [q['pos'] for q in comp]
            # the cut comes from the world holding the newest member: the least-drifted copy of the place
            newest = max(comp, key=lambda q: q['t'])
            rep = _densest([q for q in comp if q['world'] == newest['world']], lambda q: q['pos'], DEATH_LINK_H, DEATH_LINK_Y)
            out.append({'kind': 'death', 'family': fam, 'seed': seed, 'deaths': len(comp), 'centre': _centre(ps), 'span': _span(ps),
                        'worlds': sorted({q['world'] for q in comp}), 'bots': sorted({q['bot'] for q in comp}),
                        'causes': dict(collections.Counter(q['cause'] for q in comp).most_common()),
                        'y_range': [round(min(p[1] for p in ps), 1), round(max(p[1] for p in ps), 1)],
                        'first': iso_ms(min(q['t'] for q in comp)), 'last': iso_ms(newest['t']),
                        'rep_world': rep['world'], 'rep': {k: rep[k] for k in ('bot', 't', 'pos', 'cause', 'fell', 'detail')},
                        'members': [{'bot': q['bot'], 't': q['t'], 'pos': q['pos'], 'cause': q['cause'], 'fell': q['fell'],
                                     'detail': q['detail'][:300]} for q in sorted(comp, key=lambda q: q['t'])]})
    out.sort(key=lambda c: (-c['deaths'], -len(c['bots']), c['centre']))
    for i, c in enumerate(out, 1):
        c['rank'] = i
        c['id'] = cluster_id(c)
    return out


def cluster_stuck(spells, meta):
    groups = collections.defaultdict(list)
    for s in spells:
        w = world_of(s['bot'])
        if w not in meta:
            raise BlindInput(f'still spell of {s["bot"]}: world {w!r} is not in the seeds file')
        s = dict(s, world=w, seed=meta[w]['seed'])
        groups[s['seed']].append(s)
    out = []
    for seed, L in groups.items():
        for comp in link(L, lambda s: s['anchor'], STILL_LINK_H, STILL_LINK_Y):
            ps = [s['anchor'] for s in comp]
            longest = max(comp, key=lambda s: (s['ongoing'], s['bot_h'], s['t1']))
            out.append({'kind': 'stuck', 'family': 'stuck', 'seed': seed, 'bot_h': round(sum(s['bot_h'] for s in comp), 1),
                        'spells': len(comp), 'centre': _centre(ps), 'span': _span(ps),
                        'worlds': sorted({s['world'] for s in comp}), 'bots': sorted({s['bot'] for s in comp}),
                        'ongoing_bots': sorted({s['bot'] for s in comp if s['ongoing']}),
                        'longest_h': round(max(s['bot_h'] for s in comp), 1),
                        'first': iso_ms(min(s['t0'] for s in comp)), 'last': iso_ms(max(s['t1'] for s in comp) + BUCKET_MS),
                        'rep_world': longest['world'],
                        'rep': {'bot': longest['bot'], 't0': longest['t0'], 't1': longest['t1'], 'anchor': longest['anchor'],
                                'bot_h': longest['bot_h'], 'ongoing': longest['ongoing'], 'rows': longest['rows']}})
    out.sort(key=lambda c: (-c['bot_h'], -len(c['bots']), c['centre']))
    for i, c in enumerate(out, 1):
        c['rank'] = i
        c['id'] = cluster_id(c)
    return out


def cluster_id(c):
    x, y, z = (math.floor(v) for v in (c['rep']['pos'] if c['kind'] == 'death' else c['rep']['anchor']))
    return f"{c['family']}-{str(c['seed'])[-4:]}-{c['rep_world']}-{x}_{y}_{z}"


# ------------------------------------------------------------------ the dead bot's lead-up -> the scene's start
DANGER_BLOCKS = {'lava', 'magma_block', 'fire', 'soul_fire'}
LEAD_S = {'lava': 12, 'drowned': 45, 'suffocated': 30, 'stalactite': 10, 'fall': 10, 'unclassified': 15}
SCRIPTABLE = {'goto', 'mine', 'gather', 'explore', 'craft', 'withdraw', 'deposit', 'surface', 'idle'}


def leadup_start(rows, death):
    """From the dead bot's own positioned rows in [t-180 s, t]: the start the scene replays.
    FALL with N blocks: the last row at or above the pre-fall height (death y + N - 1.5) -- the ledge it left.
    Otherwise: the last positioned row at least LEAD_S[family] seconds before the death.
    Returns {'start': {...}, 'candidates': [...], 'running': {...}|None, 'path_goal': [x,y,z]|None}."""
    t = death['t']
    pos_rows = [(ms_of(r['@timestamp']), pos_of(r), r) for r in rows if pos_of(r) and ms_of(r['@timestamp']) <= t]
    pos_rows.sort(key=lambda x: x[0])
    if not pos_rows:
        raise BlindInput(f'{death["bot"]} {iso_ms(t)}: no positioned row in the {LEADUP_S} s before the death')
    cands = []
    for lead in (5, 10, 20, 40, 90):
        prior = [x for x in pos_rows if x[0] <= t - lead * 1000]
        if prior:
            cands.append({'rule': f'lead {lead} s', 'lead_s': round((t - prior[-1][0]) / 1000, 1), 'pos': prior[-1][1]})
    start = None
    fell = death.get('fell')
    if fell:
        floor_y = death['pos'][1] + fell - 1.5
        ledge = [x for x in pos_rows if x[1][1] >= floor_y and x[0] < t]
        if ledge:
            start = {'rule': f'pre-fall ledge (y >= {floor_y:.1f})', 'lead_s': round((t - ledge[-1][0]) / 1000, 1), 'pos': ledge[-1][1],
                     'row': ledge[-1][2]}
            cands.insert(0, {k: v for k, v in start.items() if k != 'row'})
    if start is None:
        lead = LEAD_S.get(death['family'], 15)
        prior = [x for x in pos_rows if x[0] <= t - lead * 1000] or pos_rows[:1]
        start = {'rule': f'lead {lead} s', 'lead_s': round((t - prior[-1][0]) / 1000, 1), 'pos': prior[-1][1], 'row': prior[-1][2]}
    # the skill it was running (INTENT: a reproduction input only, never a label)
    m = re.search(r'was running (\w+)', death.get('detail') or '')
    named = m.group(1) if m else None
    # skill rows are stamped at their START: only a skill begun before the death can have been running (a row begun
    # after it, e.g. trigger llm:death, is the next life's)
    skills = [r for r in rows if not str((r.get('skill') or {}).get('name', '_')).startswith('_') and ms_of(r['@timestamp']) < t
              and r.get('trigger') != 'llm:death']
    running = None
    if named:
        hit = [r for r in skills if r['skill']['name'] == named]
        if hit:
            running = hit[-1]
    elif skills:
        running = skills[-1]
    goal = None
    for r in rows:
        if (r.get('skill') or {}).get('name') == '_fall_path':
            g = re.search(r'goal (-?\d+),(-?\d+),(-?\d+)', str(r['skill'].get('detail') or ''))
            if g:
                goal = [int(v) for v in g.groups()]
    run = None
    if running:
        run = {'skill': running['skill']['name'], 'args': running['skill'].get('args') or {}, 'status': running['skill'].get('status'),
               'trigger': running.get('trigger'), 'named_in_death_row': named is not None}
    # CONTACT: the first row in the last 30 s whose reflex reports the bot's feet IN lava (or magma, fire): the moment the
    # danger reflex took the body (mineshaft-safety 2.4: 67 of 84 lava deaths died inside its escape). World evidence --
    # the reflex names the block at the feet.
    contact = None
    for x in pos_rows:
        r = x[2]
        if x[0] >= t - 30_000 and (r.get('skill') or {}).get('name') == '_reflex_danger_block' and \
                str((r['skill'].get('detail') or '')).split()[0:1] and str(r['skill']['detail']).split()[0] in DANGER_BLOCKS:
            contact = {'rule': f'lava contact ({r["skill"]["detail"]} at the feet)', 'lead_s': round((t - x[0]) / 1000, 1), 'pos': x[1],
                       'health': (r.get('bot') or {}).get('health'), 'row': r}
            break
    return {'start': start, 'candidates': cands, 'running': run, 'path_goal': goal, 'contact': contact}


def bag_of(row):
    """bot.inventory {name: count} + bot.tools {name: [{used, max, slot}]} -> a list of stacks with damage for tools."""
    b = (row or {}).get('bot') or {}
    inv = b.get('inventory')
    if not isinstance(inv, dict):
        raise BlindInput(f'no bot.inventory on the row at {row.get("@timestamp") if row else None}: the bag is the point')
    tools = b.get('tools') or {}
    out = []
    for name, n in sorted(inv.items()):
        n = int(n)
        inst = tools.get(name) or []
        for t in inst[:n]:
            out.append({'id': name, 'count': 1, 'damage': int(t.get('used', 0)), 'max': t.get('max')})
        rest = n - len(inst[:n])
        while rest > 0:
            k = min(rest, 64)
            out.append({'id': name, 'count': k})
            rest -= k
    return {'stacks': out, 'held': b.get('held'), 'health': b.get('health'), 'food': b.get('hunger', b.get('food'))}


def script_of(run):
    """The running skill as the sandbox brain's line format (sandbox/sandbox-brain.mjs parse())."""
    if not run or run['skill'] not in SCRIPTABLE:
        return None
    a = run['args'] or {}
    s = run['skill']
    if s == 'goto' and all(k in a for k in 'xyz'):
        return {'skill': 'goto', 'args': {'x': a['x'], 'y': a['y'], 'z': a['z']}}
    if s == 'gather' and a.get('block'):
        return {'skill': 'gather', 'args': {'block': a['block'], **({'count': a['count']} if a.get('count') else {})}}
    if s == 'mine' and a.get('y') is not None:
        return {'skill': 'mine', 'args': {'y': a['y']}}
    if s == 'explore':
        return {'skill': 'explore', 'args': {'blocks': a['blocks']} if a.get('blocks') else {}}
    if s == 'craft' and a.get('item'):
        return {'skill': 'craft', 'args': {'item': a['item'], **({'count': a['count']} if a.get('count') else {})}}
    return {'skill': s, 'args': {}}


# ------------------------------------------------------------------ the ES source (thin; estelemetry does the guarding)
DEATH_FIELDS = ['@timestamp', 'bot.name', 'exp.pool', 'bot.pos', 'skill.detail', 'skill.fail_class', 'bot.inventory',
                'bot.tools', 'bot.held', 'bot.health', 'bot.hunger', 'code.version']
ROW_FIELDS = ['@timestamp', 'skill.name', 'skill.status', 'skill.args', 'skill.detail', 'trigger', 'bot.pos', 'bot.health',
              'bot.hunger', 'bot.inventory', 'bot.tools', 'bot.held', 'code.version']


class EsSource:
    def __init__(self, since, until, client=None, now=None):
        from lib.estelemetry import EsEvents  # the ONE ES reader (CLAUDE.md); refuses 10-07
        self.E = EsEvents
        self.kw = {'client': client, 'now': now} if client else ({'now': now} if now else {})
        self.since, self.until = since, until
        self.ev = EsEvents.load('skill', since=since, until=until, **self.kw)

    def controls(self):
        nw = self.ev.newest_in_window()
        return {'docs': int(self.ev.total()), 'bots': self.ev.bots_present(), 'caveats': list(self.ev.caveats),
                'newest': int(nw.timestamp() * 1000) if nw else None}

    def deaths(self):
        n = int(self.ev.count('_death'))          # zero-guarded: a renamed kind raises ZeroLooksWrong here
        if n == 0:
            raise ZeroLooksWrong('_death: 0 in a window that holds documents (estelemetry found no near-miss name, '
                                 'so the kind was renamed to something unlike it, or the fleet stopped dying -- check it)')
        rows = list(self.ev.rows('_death', fields=DEATH_FIELDS))
        return n, rows

    def boxes(self):
        """Per bot per 10-minute bucket: rows, min/max of bot.pos.{x,y,z}. Day by day (ES bucket limit)."""
        out, active = [], set()
        lo = dt.datetime.fromisoformat(self.since.replace('Z', '+00:00'))
        hi = dt.datetime.fromisoformat(self.until.replace('Z', '+00:00'))
        t = lo
        while t < hi:
            u = min(t + dt.timedelta(days=1), hi)
            ev = self.E.load('skill', since=t.strftime('%Y-%m-%dT%H:%M:%SZ'), until=u.strftime('%Y-%m-%dT%H:%M:%SZ'), **self.kw)
            q = ev._query()
            for ax in 'xyz':           # Codex r1 P1: a bucket with one axis missing would read as MOVING, never still
                q['bool']['filter'].append({'exists': {'field': 'bot.pos.' + ax}})
            sub = {}
            for ax in 'xyz':
                sub['mn' + ax] = {'min': {'field': 'bot.pos.' + ax}}
                sub['mx' + ax] = {'max': {'field': 'bot.pos.' + ax}}
            r = ev._search({'size': 0, 'query': q, 'aggs': {'b': {'terms': {'field': 'bot.name', 'size': 1000}, 'aggs': {
                'h': {'date_histogram': {'field': '@timestamp', 'fixed_interval': '10m', 'min_doc_count': 1}, 'aggs': sub}}}}})
            ev._complete(r['aggregations']['b'], 'boxes(): bot terms')
            for b in r['aggregations']['b']['buckets']:
                for h in b['h']['buckets']:
                    out.append([b['key'], h['key'], h['doc_count']] + [h[k]['value'] for k in ('mnx', 'mxx', 'mny', 'mxy', 'mnz', 'mxz')])
            # the denominator for the coverage guard: buckets holding ANY row (positioned or not)
            ra = ev._search({'size': 0, 'query': ev._query(), 'aggs': {'b': {'terms': {'field': 'bot.name', 'size': 1000}, 'aggs': {
                'h': {'date_histogram': {'field': '@timestamp', 'fixed_interval': '10m', 'min_doc_count': 1}}}}}})
            ev._complete(ra['aggregations']['b'], 'boxes(): active bot terms')
            for b in ra['aggregations']['b']['buckets']:
                for h in b['h']['buckets']:
                    active.add((b['key'], h['key']))
            t = u
        self.active = len(active)
        return merge_boxes(out)

    def bot_rows(self, bot, t0_ms, t1_ms, max_rows=20000):
        ev = self.E.load('skill', since=iso_ms(t0_ms), until=iso_ms(t1_ms), bots=[bot], **self.kw)
        return list(ev.rows(None, fields=ROW_FIELDS, max_rows=max_rows))


# ------------------------------------------------------------------ mine: ES -> ranked clusters + picks
def mine(src, meta, top_deaths=3, top_stuck=2, min_deaths=3, min_bot_h=3.0):
    ctl = src.controls()
    if not ctl['docs']:
        raise ZeroLooksWrong('the window holds no documents at all')
    newest = ctl.get('newest')
    if newest is not None and ms_of(src.until) - newest > INGEST_SLACK_MS:
        # Claude r1 P3: ES behind the window's end leaves its last bucket empty, so no spell can be ongoing -- a silent zero
        raise BlindInput(f'the newest document is {iso_ms(newest)}, {(ms_of(src.until) - newest) / 60000:.0f} min before the window '
                         f'ends {src.until}: ES is behind (ingest lag) -- end the window earlier')
    n, rows = src.deaths()
    pts = death_points(rows, meta, expected=n)
    boxes = src.boxes()
    bstats = check_boxes(boxes, ctl['bots'], getattr(src, 'active', None))
    lo, hi = ms_of(src.since), ms_of(src.until)
    spells = find_spells(boxes, lo, hi)
    dcl = cluster_deaths(pts)
    scl = cluster_stuck(spells, meta)
    fam = collections.Counter(p['family'] for p in pts)
    res = {'schema': CLUSTERS_SCHEMA, 'window': {'since': src.since, 'until': src.until}, 'made_at': iso_ms(int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000)),
           'tool_sha256': file_sha(os.path.abspath(__file__)),
           'controls': {'docs': ctl['docs'], 'bots_present': len(ctl['bots']), 'caveats': ctl['caveats'],
                        'death_rows': n, 'positions': bstats},
           'denominators': {'deaths': len(pts), 'positioned_bot_h': bstats['bot_h'], 'still_spells': len(spells),
                            'still_spell_bot_h': round(sum(s['bot_h'] for s in spells), 1),
                            'bots_with_a_spell': len({s['bot'] for s in spells})},
           'deaths_by_family': dict(fam.most_common()), 'death_clusters': dcl, 'stuck_clusters': scl, 'picks': []}
    picks = [c for c in dcl if c['deaths'] >= min_deaths][:top_deaths]
    # a stuck scene is cut only for a spell still running at the window's end: the region copy is of that night, and an
    # ended spell's world already holds the escape (the cut would not be the trap)
    picks += [c for c in scl if c['bot_h'] >= min_bot_h and c['rep']['ongoing']][:top_stuck]
    for c in picks:
        res['picks'].append(pick_detail(src, c, meta))
    return res


def pick_detail(src, c, meta):
    w = c['rep_world']
    p = {'id': c['id'], 'kind': c['kind'], 'family': c['family'], 'rank': c['rank'], 'world': w, 'seed': c['seed'],
         'home': meta[w].get('home'), 'gamerules': meta[w].get('gamerules') or {}}
    if c['kind'] == 'death':
        # the representative first, then the cluster's other deaths IN THE SAME WORLD (the cut is that world's), newest
        # first: a single death is one draw of a rare event, so the scene carries up to MAX_STARTS starts and the base
        # proof runs each (docs section 4.3)
        same = sorted((m for m in c['members'] if world_of(m['bot']) == w and (m['bot'], m['t']) != (c['rep']['bot'], c['rep']['t'])),
                      key=lambda m: -m['t'])
        ds = [dict(c['rep'], family=c['family'], world=w)]
        for m in same[:MAX_STARTS - 1]:
            ds.append({'bot': m['bot'], 't': m['t'], 'pos': tuple(m['pos']), 'cause': m['cause'], 'family': c['family'], 'world': w,
                       'fell': m.get('fell'), 'detail': m.get('detail', '')})
        starts = [death_start(src, d) for d in ds]
        # each lava death with a recorded contact adds that moment as one more start (after every lead-up start)
        starts += [st.pop('contact') for st in list(starts) if st.get('contact')]
        for st in starts:
            st.pop('contact', None)
        first = starts[0]
        p['fleet_kinds'] = first.pop('fleet_kinds')
        for st in starts[1:]:
            st.pop('fleet_kinds', None)
        p.update({k: first[k] for k in ('start', 'start_candidates', 'running', 'script', 'path_goal', 'bag', 'death')})
        p['alternates'] = starts[1:]
        p['box'] = death_box([x['death']['pos'] for x in starts] + [x['start']['pos'] for x in starts] +
                             [x['path_goal'] for x in starts if x['path_goal']], keep=first['start']['pos'])
    else:
        r = c['rep']
        rows = src.bot_rows(r['bot'], r['t1'], r['t1'] + BUCKET_MS)
        sig_rows = src.bot_rows(r['bot'], max(r['t0'], r['t1'] - 3 * 3_600_000), r['t1'] + BUCKET_MS, max_rows=60000)
        pr = [x for x in rows if pos_of(x)]
        if not pr:
            raise BlindInput(f'{r["bot"]}: no positioned row in its spell\'s last bucket')
        last = pr[-1]
        bag = bag_of(last)
        bag['source'] = f'the newest row of the spell {last["@timestamp"]}'
        p['fleet_kinds'] = kinds_signature(sig_rows)
        p.update({'start': {'rule': 'newest positioned row of the spell', 'pos': pos_of(last), 'at': last['@timestamp']},
                  'spell': {'bot': r['bot'], 'from': iso_ms(r['t0']), 'to': iso_ms(r['t1'] + BUCKET_MS), 'bot_h': r['bot_h'],
                            'ongoing': r['ongoing'], 'anchor': r['anchor']},
                  'bag': bag, 'script': None, 'box': stuck_box(pos_of(last))})
    return p


GENERIC_KINDS = {'_reflex_tick', '_pose', '_affordance_scan', '_chunks_evicted', '_dig_town_sum', '_town_ground', '_pickups',
                 '_death', '_death_site_recorded', '_plant_spot', 'status'}


def kinds_signature(rows, n=12):
    """The fleet bot's most frequent REFLEX row kinds at the site: a FIDELITY descriptor the driver compares its own run
    with (does the sandbox bot go through the same rungs?). Reflex rows only: the reflex loop runs the same with the model
    off, the model's own choices do not. Rows are what the code logged, so this is never a label."""
    c = collections.Counter(str((r.get('skill') or {}).get('name')) for r in rows if r.get('trigger') == 'reflex')
    return [[k, v] for k, v in c.most_common() if k not in GENERIC_KINDS and k != 'None'][:n]


MAX_STARTS = 4


def death_start(src, d):
    """One death -> the start the scene replays from: position, bag, the replayed intent, the death itself."""
    rows = src.bot_rows(d['bot'], d['t'] - LEADUP_S * 1000, d['t'] + 2000)
    if not d.get('detail'):
        dr = [r for r in rows if (r.get('skill') or {}).get('name') == '_death' and abs(ms_of(r['@timestamp']) - d['t']) < 2000]
        if dr:
            d['detail'] = str(dr[-1]['skill'].get('detail') or '')
            d['fell'] = fall_blocks(d['detail'])
    lu = leadup_start(rows, d)
    drow = [r for r in rows if (r.get('skill') or {}).get('name') == '_death' and abs(ms_of(r['@timestamp']) - d['t']) < 2000]
    srow = lu['start'].pop('row')
    try:
        bag = bag_of(srow)
        bag['source'] = f'the start row {srow["@timestamp"]}'
    except BlindInput:
        if not drow:
            raise
        bag = bag_of(drow[-1])
        bag['source'] = f'the _death row {drow[-1]["@timestamp"]} (pre-drop snapshot)'
    # THE REPLAYED INTENT. When the bot's own fall row names the path it was walking (`goal X,Y,Z`), the scene walks
    # to that goal: it is the movement that ended in the fall, and it lies inside the cut. The running skill's own
    # target search can pick a block outside the cut (first cave-fall run, 10-24: `gather dirt` found none within
    # 32 blocks of the arena and never moved), so it is the fallback.
    goal = lu['path_goal']
    script = {'skill': 'goto', 'args': dict(zip('xyz', goal)), 'why': 'the fall row names the path goal'} if goal else script_of(lu['running'])
    out = {'start': lu['start'], 'start_candidates': lu['candidates'], 'running': lu['running'], 'script': script, 'path_goal': goal,
           'bag': bag, 'fleet_kinds': kinds_signature([r for r in rows if ms_of(r['@timestamp']) <= d['t']]),
           'death': {'pos': tuple(d['pos']), 'cause': d['cause'], 'fell': d.get('fell'), 'bot': d['bot'], 't': iso_ms(d['t']),
                     'detail': str(d.get('detail') or '')[:300]}}
    if lu.get('contact'):
        c = dict(lu['contact'])
        crow = c.pop('row')
        try:
            cbag = bag_of(crow)
            cbag['source'] = f'the contact row {crow["@timestamp"]}'
        except BlindInput:
            cbag = dict(bag)
        out['contact'] = dict(out, start=c, bag=cbag, start_candidates=[], fleet_kinds=[])
    return out


def death_box(pts, keep, pad_h=10, pad_down=4, pad_up=8, cap=(49, 60, 49)):
    lo = [math.floor(min(p[i] for p in pts)) for i in range(3)]
    hi = [math.floor(max(p[i] for p in pts)) for i in range(3)]
    lo = [lo[0] - pad_h, lo[1] - pad_down, lo[2] - pad_h]
    hi = [hi[0] + pad_h, hi[1] + pad_up, hi[2] + pad_h]
    return _cap_box(lo, hi, cap, keep)


def stuck_box(p, r=12, down=6, up=10):
    c = cell_of(p)
    return _cap_box([c[0] - r, c[1] - down, c[2] - r], [c[0] + r, c[1] + up, c[2] + r], (49, 60, 49), p)


def _cap_box(lo, hi, cap, keep):
    lo, hi = list(lo), list(hi)
    for i in range(3):
        if hi[i] - lo[i] + 1 > cap[i]:
            k = math.floor(keep[i])
            lo[i] = max(lo[i], k - cap[i] // 2)
            hi[i] = lo[i] + cap[i] - 1
    lo[1] = max(lo[1], -64)
    hi[1] = min(hi[1], 319)
    return {'lo': lo, 'hi': hi}


# ------------------------------------------------------------------ the table
def render(res, n=10):
    d = res['denominators']
    out = [f"FAILMINE {res['window']['since']} .. {res['window']['until']}  (made {res['made_at']})",
           f"  controls: {res['controls']['docs']:,} skill docs, {res['controls']['bots_present']} bots; positions "
           f"{res['controls']['positions']['buckets']:,} ten-minute buckets = {d['positioned_bot_h']:,} bot-h, of which "
           f"{100 * res['controls']['positions']['still_share']:.1f}% still (so the detector sees motion)",
           f"  deaths {d['deaths']} ({', '.join(f'{k} {v}' for k, v in res['deaths_by_family'].items())}); still spells >= 30 min "
           f"{d['still_spells']} = {d['still_spell_bot_h']:,} bot-h of {d['positioned_bot_h']:,} on {d['bots_with_a_spell']} bots",
           '', f'DEATH CLUSTERS (of {d["deaths"]} deaths; seed:place:family, linked within {DEATH_LINK_H:g} blocks)',
           f"  {'#':>2} {'deaths':>6} {'share':>6} {'family':<11} {'seed':<5} {'centre':<17} {'worlds':>6} {'bots':>4}  causes; cut from"]
    for c in res['death_clusters'][:n]:
        out.append(f"  {c['rank']:>2} {c['deaths']:>6} {100 * c['deaths'] / d['deaths']:>5.1f}% {c['family']:<11} {str(c['seed'])[-4:]:<5} "
                   f"{','.join(str(round(v)) for v in c['centre']):<17} {len(c['worlds']):>6} {len(c['bots']):>4}  "
                   f"{'; '.join(f'{k} {v}' for k, v in c['causes'].items())}; {c['rep_world']}")
    out += ['', f'STUCK CLUSTERS (still >= 30 min; of {d["positioned_bot_h"]:,} positioned bot-h; linked within {STILL_LINK_H:g} blocks)',
            f"  {'#':>2} {'bot-h':>7} {'share':>6} {'seed':<5} {'centre':<17} {'spells':>6} {'bots':>4} {'ongoing':>7}  longest; bots"]
    for c in res['stuck_clusters'][:n]:
        out.append(f"  {c['rank']:>2} {c['bot_h']:>7.1f} {100 * c['bot_h'] / d['positioned_bot_h']:>5.2f}% {str(c['seed'])[-4:]:<5} "
                   f"{','.join(str(round(v)) for v in c['centre']):<17} {c['spells']:>6} {len(c['bots']):>4} {len(c['ongoing_bots']):>7}  "
                   f"{c['longest_h']} h; {', '.join(c['bots'][:4])}{' ...' if len(c['bots']) > 4 else ''}")
    out += ['', 'PICKS (cut into scenes)']
    for p in res['picks']:
        out.append(f"  {p['id']}  ({p['kind']} rank {p['rank']}; start {p['start']['rule']}; script {p.get('script')})")
    return '\n'.join(out)


# ------------------------------------------------------------------ region copies -> cells
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
        if t == 11: n = struct.unpack_from('>i', b, i)[0]; i += 4; v = struct.unpack_from('>%di' % n, b, i); i += 4 * n; return list(v)
        if t == 12: n = struct.unpack_from('>i', b, i)[0]; i += 4; v = struct.unpack_from('>%dq' % n, b, i); i += 8 * n; return list(v)
        raise BlindInput('NBT tag %d' % t)
    t = b[i]; i += 1
    n = struct.unpack_from('>H', b, i)[0]; i += 2 + n
    return payload(t)


def state_str(p):
    """{'Name': 'minecraft:water', 'Properties': {'level': '2'}} -> 'water[level=2]' (properties sorted)."""
    n = str(p.get('Name', '?')).replace('minecraft:', '')
    props = p.get('Properties') or {}
    return n + ('[' + ','.join(f'{k}={props[k]}' for k in sorted(props)) + ']' if props else '')


class Regions:
    """Block states from COPIES of region files: <dir>/<world>/r.<rx>.<rz>.mca. Never a live world."""
    def __init__(self, root, world):
        self.root, self.world = root, world
        self.files, self.chunks, self.sections = {}, {}, {}
        self.provenance = {'region_sha256': {}, 'chunk_saved': {}}

    def _file(self, rx, rz):
        k = (rx, rz)
        if k not in self.files:
            p = os.path.join(self.root, self.world, f'r.{rx}.{rz}.mca')
            if not os.path.exists(p):
                raise BlindInput(f'region copy missing: {p} (fetch it first; a missing file is not an empty world)')
            data = open(p, 'rb').read()
            if len(data) < 8192:
                raise BlindInput(f'region copy {p} is {len(data)} bytes: truncated')
            self.files[k] = data
            self.provenance['region_sha256'][os.path.basename(p)] = hashlib.sha256(data).hexdigest()
        return self.files[k]

    def chunk(self, cx, cz):
        k = (cx, cz)
        if k in self.chunks:
            return self.chunks[k]
        data = self._file(cx >> 5, cz >> 5)
        idx = 4 * ((cx & 31) + (cz & 31) * 32)
        off = int.from_bytes(data[idx:idx + 3], 'big') * 4096
        if off == 0:
            raise BlindInput(f'{self.world} chunk ({cx},{cz}) is absent from its region copy: never generated or never saved')
        ts = struct.unpack('>I', data[4096 + idx:4096 + idx + 4])[0]
        ln = int.from_bytes(data[off:off + 4], 'big'); comp = data[off + 4]; raw = data[off + 5:off + 4 + ln]
        if comp == 2: raw = zlib.decompress(raw)
        elif comp == 1: raw = gzip.decompress(raw)
        elif comp != 3: raise BlindInput(f'{self.world} chunk ({cx},{cz}): compression {comp} (external chunk) not read')
        c = read_nbt(raw)
        status = str(c.get('Status', '')).replace('minecraft:', '')
        if status != 'full':
            raise BlindInput(f'{self.world} chunk ({cx},{cz}) status {status!r}, not full: its blocks are not final')
        self.provenance['chunk_saved'][f'{cx},{cz}'] = dt.datetime.fromtimestamp(ts, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
        self.chunks[k] = c
        return c

    def section(self, cx, sy, cz):
        k = (cx, sy, cz)
        if k in self.sections:
            return self.sections[k]
        c = self.chunk(cx, cz)
        sec = next((s for s in c.get('sections', []) if s.get('Y') == sy), None)
        if sec is None or not sec.get('block_states'):
            raise BlindInput(f'{self.world} chunk ({cx},{cz}) has no section Y={sy}: refusing to call it air')
        bs = sec['block_states']
        pal = [state_str(p) for p in bs.get('palette') or []]
        if not pal:
            raise BlindInput(f'{self.world} ({cx},{sy},{cz}): empty palette')
        dat = bs.get('data')
        if dat is None and len(pal) > 1:   # Codex r1 P1: never 4,096 copies of palette entry 0
            raise BlindInput(f'{self.world} ({cx},{sy},{cz}): a palette of {len(pal)} with no packed data')
        if len(pal) == 1:
            vals = None
        else:
            bits = max(4, (len(pal) - 1).bit_length()); per = 64 // bits; mask = (1 << bits) - 1
            vals = []
            for lo in dat:
                lo &= (1 << 64) - 1
                for k2 in range(per):
                    vals.append((lo >> (k2 * bits)) & mask)
                    if len(vals) >= 4096:
                        break
                if len(vals) >= 4096:
                    break
            if len(vals) < 4096 or max(vals) >= len(pal):
                raise BlindInput(f'{self.world} ({cx},{sy},{cz}): {len(vals)} values, max index {max(vals) if vals else None} '
                                 f'for a palette of {len(pal)}: corrupt or misread')
        self.sections[k] = (pal, vals)
        return self.sections[k]

    def block(self, x, y, z):
        pal, vals = self.section(x >> 4, y >> 4, z >> 4)
        if vals is None:
            return pal[0]
        return pal[vals[((y & 15) * 16 + (z & 15)) * 16 + (x & 15)]]


def cut(reg, lo, hi):
    """-> {'origin', 'size', 'palette', 'rle'}: y outer, z, x inner; rle = [palette index, run, ...] over the flattening."""
    sx, sy, sz = (hi[i] - lo[i] + 1 for i in range(3))
    if min(sx, sy, sz) <= 0:
        raise BlindInput(f'empty box {lo}..{hi}')
    pal, index, rle = [], {}, []
    last, run = None, 0
    for y in range(lo[1], hi[1] + 1):
        for z in range(lo[2], hi[2] + 1):
            for x in range(lo[0], hi[0] + 1):
                s = reg.block(x, y, z)
                if s not in index:
                    index[s] = len(pal); pal.append(s)
                i = index[s]
                if i == last:
                    run += 1
                else:
                    if last is not None:
                        rle += [last, run]
                    last, run = i, 1
    rle += [last, run]
    return {'origin': list(lo), 'size': [sx, sy, sz], 'palette': pal, 'rle': rle}


def decode(sc):
    """The inverse of cut(): {(x, y, z): state} in ABSOLUTE fleet coordinates. Raises on a length mismatch."""
    (ox, oy, oz), (sx, sy, sz) = sc['origin'], sc['size']
    flat = []
    rle = sc['rle']
    if len(rle) % 2:
        raise BlindInput('rle has an odd length')
    for k in range(0, len(rle), 2):
        if not (0 <= rle[k] < len(sc['palette'])) or rle[k + 1] <= 0:
            raise BlindInput(f'rle entry {k // 2} out of range')
        flat += [rle[k]] * rle[k + 1]
    if len(flat) != sx * sy * sz:
        raise BlindInput(f'rle covers {len(flat)} cells, the box is {sx * sy * sz}')
    out, i = {}, 0
    for y in range(sy):
        for z in range(sz):
            for x in range(sx):
                out[(ox + x, oy + y, oz + z)] = sc['palette'][flat[i]]
                i += 1
    return out


def cells_sha(sc):
    return hashlib.sha256(json.dumps({'origin': sc['origin'], 'size': sc['size'], 'palette': sc['palette'], 'rle': sc['rle']},
                                     sort_keys=True).encode()).hexdigest()


# ------------------------------------------------------------------ geometry labels (WORLD evidence)
AIRS = {'air', 'cave_air', 'void_air'}
PASSABLE = AIRS | {'short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'snow', 'vine', 'torch', 'wall_torch',
                   'ladder', 'leaf_litter', 'wildflowers', 'pink_petals', 'bush', 'firefly_bush', 'dandelion', 'poppy',
                   'sugar_cane', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant', 'glow_lichen', 'moss_carpet'}


def bname(s):
    return s.split('[', 1)[0] if s else s


def is_water(s):
    return bname(s) in ('water', 'bubble_column', 'seagrass', 'tall_seagrass', 'kelp', 'kelp_plant') or 'waterlogged=true' in (s or '')


def is_lava(s):
    return bname(s) == 'lava'


def is_open(s):
    return bname(s) in PASSABLE and not is_lava(s)


def site_facts(cells, feet):
    """Read from the cut, at the start cell. Everything here is a block in the region copy."""
    g = lambda d: cells.get((feet[0] + d[0], feet[1] + d[1], feet[2] + d[2]))
    f = {'feet': g((0, 0, 0)), 'head': g((0, 1, 0)), 'above': g((0, 2, 0)), 'below': g((0, -1, 0))}
    lat = {'N': (0, -1), 'S': (0, 1), 'E': (1, 0), 'W': (-1, 0)}
    f['side_feet'] = {k: g((dx, 0, dz)) for k, (dx, dz) in lat.items()}
    f['side_head'] = {k: g((dx, 1, dz)) for k, (dx, dz) in lat.items()}
    f['ceiling_dy'] = next((dy for dy in range(2, 8) if g((0, dy, 0)) is not None and not is_open(g((0, dy, 0))) and not is_water(g((0, dy, 0)))), None)
    f['open_sky_in_box'] = all((is_open(g((0, dy, 0))) or g((0, dy, 0)) is None) for dy in range(2, 40) if g((0, dy, 0)) is not None) and f['ceiling_dy'] is None
    drop = 0
    for dy in range(1, 70):
        b = g((0, -dy, 0))
        if b is None or not (is_open(b) or is_water(b)):
            break
        drop = dy
    f['air_below'] = drop
    near = lambda pred, r: sum(1 for (x, y, z), s in cells.items() if abs(x - feet[0]) <= r and abs(y - feet[1]) <= r and abs(z - feet[2]) <= r and pred(s))
    f['lava_within_4'] = near(is_lava, 4)
    f['water_within_2'] = near(is_water, 2)
    f['dripstone_within_4'] = near(lambda s: bname(s) == 'pointed_dripstone', 4)
    # DRY REACH: cells a standing body can enter without digging (feet+head open and dry, a solid floor), from the start
    seen, todo = set(), [tuple(feet)]
    while todo and len(seen) < 400:
        c = todo.pop()
        if c in seen:
            continue
        seen.add(c)
        for dx, dz in lat.values():
            for dy in (-1, 0, 1):
                n = (c[0] + dx, c[1] + dy, c[2] + dz)
                fe, he, fl = cells.get(n), cells.get((n[0], n[1] + 1, n[2])), cells.get((n[0], n[1] - 1, n[2]))
                if fe and he and fl and is_open(fe) and is_open(he) and not is_water(fe) and not is_water(he) and not is_open(fl) and not is_water(fl) and n not in seen:
                    todo.append(n)
    f['dry_reach'] = len(seen) - 1
    return f


def stuck_label(f):
    wet = is_water(f['feet']) or is_water(f['head'])
    if wet and f['ceiling_dy'] is not None and f['ceiling_dy'] <= 2:
        return 'stuck:wet-under-ceiling'
    if is_water(f['feet']) and is_open(f['head']) and not is_water(f['head']) and \
            sum(1 for v in f['side_head'].values() if v and not is_open(v) and not is_water(v)) >= 3:
        return 'stuck:water-pit'
    if wet:
        return 'stuck:wet-other'
    if f['dry_reach'] < 6:
        return 'stuck:enclosed-dry'
    return 'stuck:open'


# ------------------------------------------------------------------ scenes
def make_scene(pick, reg, made_at=None, backup_day=None):
    box = pick['box']
    sc = cut(reg, box['lo'], box['hi'])
    cells = decode(sc)
    start = pick['start']['pos']
    feet = cell_of(start)
    if feet not in cells:
        raise BlindInput(f'{pick["id"]}: the start {start} lies outside the cut {box}')
    facts = site_facts(cells, feet)
    # A START IS KEPT only when it, and the goal its script walks to, lie inside the cut (Claude r1 P3: a goal outside walks
    # the bot into the shell); the drops are counted in the scene, never silent
    inside = lambda q: q is None or cell_of(q) in cells
    goal_of = lambda sc: [sc['args'][k] for k in 'xyz'] if sc and sc.get('skill') == 'goto' else None
    if not inside(goal_of(pick.get('script'))):
        raise BlindInput(f'{pick["id"]}: the scene script walks to {goal_of(pick["script"])}, outside the cut {box}')
    kept_alts, dropped_alts = [], []
    for a in pick.get('alternates') or []:
        if inside(a['start']['pos']) and inside(goal_of(a.get('script'))):
            kept_alts.append(a)
        else:
            dropped_alts.append({'bot': a['death']['bot'], 't': a['death']['t'], 'why': 'start or goal outside the cut'})
    if pick['kind'] == 'stuck':
        label = stuck_label(facts)
        oracle = {'type': 'escape', 'minutes': 9, 'from_cell': list(feet), 'min_horizontal': 2, 'min_up': 2, 'hold_s': 20,
                  'text': 'PASS = alive, at the end >= 2 blocks (horizontally) from the start cell or >= 2 above it, held 20 s, inside the arena'}
        base = {'expect': 'stays', 'fleet': f"{pick['spell']['bot']} still at this cell {pick['spell']['from']} .. {pick['spell']['to']} "
                                            f"({pick['spell']['bot_h']} h{'; ongoing' if pick['spell']['ongoing'] else ''})"}
    else:
        dfacts = site_facts(cells, cell_of(pick['death']['pos'])) if cell_of(pick['death']['pos']) in cells else None
        label = 'death:' + pick['family']
        oracle = {'type': 'survive', 'minutes': 6, 'fail_families': [pick['family']],
                  'text': f'PASS = alive at the end and no {pick["family"]} death; any death is reported (another cause = FAILED, not matched)'}
        base = {'expect': 'dies', 'family': pick['family'], 'fleet': f"{pick['death']['bot']} {pick['death']['t']}: {pick['death']['detail'][:160]}"}
        facts = {'start': facts, 'death_cell': dfacts}
    checks = []
    for d in ((0, 0, 0), (0, 1, 0), (0, 2, 0), (0, -1, 0), (1, 0, 0), (-1, 0, 0), (0, 0, 1), (0, 0, -1)):
        c = (feet[0] + d[0], feet[1] + d[1], feet[2] + d[2])
        if c in cells:
            checks.append({'at': list(c), 'is': cells[c]})
    if pick['kind'] == 'death' and cell_of(pick['death']['pos']) in cells:
        c = cell_of(pick['death']['pos'])
        checks.append({'at': list(c), 'is': cells[c]})
    scene = {'schema': SCHEMA, 'id': pick['id'], 'label': label, 'family': pick['family'], 'kind': pick['kind'],
             'world': pick['world'], 'seed': pick['seed'], 'home': pick.get('home'), 'gamerules': pick.get('gamerules') or {},
             'source': {'backup_day': backup_day, 'cut_at': made_at, **reg.provenance, 'tool_sha256': file_sha(os.path.abspath(__file__))},
             'cluster_rank': pick['rank'], 'facts': facts,
             'bot': {'pos': list(start), 'start_rule': pick['start']['rule'], 'bag': pick['bag'],
                     'start_candidates': pick.get('start_candidates')},
             'alternates': [{'pos': list(a['start']['pos']), 'start_rule': a['start']['rule'], 'bag': a['bag'], 'script': a['script'],
                             'running': a['running'], 'death': a['death'], 'health': a['start'].get('health')} for a in kept_alts],
             'alternates_dropped': dropped_alts,
             'script': pick.get('script'), 'running': pick.get('running'), 'path_goal': pick.get('path_goal'),
             'death': pick.get('death'), 'spell': pick.get('spell'), 'fleet_kinds': pick.get('fleet_kinds') or [],
             'oracle': oracle, 'base': base, 'checks': checks,
             'cells': sc, 'cells_sha256': cells_sha(sc), 'proof': []}
    scene_valid(scene)
    return scene


def scene_valid(s):
    """The library contract. Raises on anything a driver could not rebuild or judge."""
    if s.get('schema') != SCHEMA:
        raise BlindInput(f'schema {s.get("schema")!r}')
    for k in ('id', 'label', 'kind', 'world', 'bot', 'oracle', 'base', 'cells', 'cells_sha256', 'checks'):
        if k not in s:
            raise BlindInput(f'scene {s.get("id")}: missing {k}')
    if s['cells_sha256'] != cells_sha(s['cells']):
        raise BlindInput(f'scene {s["id"]}: cells_sha256 does not match its cells')
    cells = decode(s['cells'])
    if cell_of(s['bot']['pos']) not in cells:
        raise BlindInput(f'scene {s["id"]}: the start is outside the cut')
    for i, a in enumerate(s.get('alternates') or []):
        if cell_of(a['pos']) not in cells:
            raise BlindInput(f'scene {s["id"]}: alternate start {i + 1} is outside the cut')
    if s['oracle'].get('type') not in ('escape', 'survive'):
        raise BlindInput(f'scene {s["id"]}: unknown oracle {s["oracle"].get("type")!r}')
    if not s['bot']['bag'].get('stacks') and s['kind'] == 'stuck':
        raise BlindInput(f'scene {s["id"]}: an empty bag for a stuck scene (the bag is what the trap is measured against)')
    for c in s['checks']:
        if cells.get(tuple(c['at'])) != c['is']:
            raise BlindInput(f'scene {s["id"]}: check {c} disagrees with the cells')
    return True


def library_covers(library_dir, pick):
    """A pick already in the library (same seed, same family, start within 6 blocks) is not cut again."""
    if not library_dir or not os.path.isdir(library_dir):
        return None
    for f in sorted(os.listdir(library_dir)):
        if not f.endswith('.json') or f == 'INDEX.json':
            continue
        s = json.load(open(os.path.join(library_dir, f)))
        if s.get('seed') == pick['seed'] and s.get('family') == pick['family']:
            a, b = s['bot']['pos'], pick['start']['pos']
            if math.hypot(a[0] - b[0], a[2] - b[2]) <= 6 and abs(a[1] - b[1]) <= 6:
                return s['id']
    return None


def file_sha(p):
    return hashlib.sha256(open(p, 'rb').read()).hexdigest()


# ------------------------------------------------------------------ the fetch channel (10.0.0.31 -> 10.0.0.30, read-only)
KEY = os.path.expanduser('~/.ssh/id_failmine')
WORLDS_HOST = 'mike@10.0.0.30'


def remote(req, key=KEY):
    """One request to fmserve.py (the forced command of the restricted key); bytes back or a raise."""
    r = subprocess.run(['ssh', '-i', key, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ConnectTimeout=20', WORLDS_HOST, req],
                       capture_output=True, timeout=600)
    if r.returncode != 0:
        raise BlindInput(f'fmserve {req!r}: exit {r.returncode} ({r.stderr.decode(errors="replace")[:200]})')
    return r.stdout


def regions_for(box):
    lo, hi = box['lo'], box['hi']
    return sorted({(cx >> 5, cz >> 5) for cx in range(lo[0] >> 4, (hi[0] >> 4) + 1) for cz in range(lo[2] >> 4, (hi[2] >> 4) + 1)})


def fetch(res, dest, only=None, req=remote, generation=None):
    """Region copies for the picks. `generation` = meta's backup_done: fmserve refuses a region of any other night."""
    if not generation:
        raise BlindInput('fetch needs the backup generation from meta (backup_done): an unbound read could mix two nights')
    got = []
    for p in res['picks']:
        if only and p['id'] not in only:
            continue
        for rx, rz in regions_for(p['box']):
            out = os.path.join(dest, p['world'], f'r.{rx}.{rz}.mca')
            if os.path.exists(out):
                continue
            data = req(f'region {p["world"]} {rx} {rz} {generation}')
            if len(data) < 8192:
                raise BlindInput(f'region {p["world"]} {rx} {rz}: {len(data)} bytes')
            os.makedirs(os.path.dirname(out), exist_ok=True)
            with open(out + '.part', 'wb') as f:
                f.write(data)
            os.replace(out + '.part', out)
            got.append(out)
    return got


# ------------------------------------------------------------------ CLI
def cmd_mine(a):
    meta = json.load(open(a.seeds))
    meta = meta.get('worlds', meta)
    until = a.until or dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0).strftime('%Y-%m-%dT%H:%M:%SZ')
    since = (dt.datetime.fromisoformat(until.replace('Z', '+00:00')) - dt.timedelta(days=a.days)).strftime('%Y-%m-%dT%H:%M:%SZ')
    res = mine(EsSource(since, until), meta, a.top_deaths, a.top_stuck)
    os.makedirs(a.out, exist_ok=True)
    json.dump(res, open(os.path.join(a.out, 'clusters.json'), 'w'), indent=1, default=list)
    open(os.path.join(a.out, 'table.txt'), 'w').write(render(res) + '\n')
    print(render(res))


def cmd_cut(a):
    res = json.load(open(a.clusters))
    os.makedirs(a.out, exist_ok=True)
    only = set(a.only.split(',')) if a.only else None
    made = iso_ms(int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000))
    for p in res['picks']:
        if only and p['id'] not in only:
            continue
        cov = library_covers(a.library, p)
        if cov:
            print(f'{p["id"]}: already in the library as {cov}; not cut again')
            continue
        sc = make_scene(p, Regions(a.regions, p['world']), made, a.backup_day)
        path = os.path.join(a.out, p['id'] + '.json')
        json.dump(sc, open(path, 'w'), separators=(',', ':'))
        print(f'{path}: {sc["label"]}; {sc["cells"]["size"]} cells, palette {len(sc["cells"]["palette"])}, facts '
              f'{json.dumps(sc["facts"])[:300]}')


def cmd_fetch(a):
    res = json.load(open(a.clusters))
    only = set(a.only.split(',')) if a.only else None
    gen = json.loads(remote('meta'))['backup_done']
    for f in fetch(res, a.regions, only, generation=gen):
        print('fetched', f)


def cmd_meta(a):
    m = json.loads(remote('meta'))
    if not m.get('worlds'):
        raise BlindInput('meta: no worlds')
    json.dump(m, open(a.out, 'w'), indent=1)
    print(f'{len(m["worlds"])} worlds; backup {m.get("backup_day")}')


def same_staging(m1, m2):
    """The staging the regions were read from is still the one the clusters were matched against (same night, same run)."""
    k = lambda m: (m.get('backup_day'), m.get('backup_done'))
    if not m1.get('backup_done') or k(m1) != k(m2):
        raise BlindInput(f'the staging changed during the run ({k(m1)} -> {k(m2)}): rerun')
    return True


def cmd_weekly(a):
    """The cron entry (10.0.0.31). One generation directory per run; nothing outside ~/failmine is written."""
    home = os.path.expanduser(a.home)
    gen = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%MZ')
    out = os.path.join(home, 'out', gen)
    os.makedirs(out, exist_ok=True)
    meta = json.loads(remote('meta'))
    json.dump(meta, open(os.path.join(out, 'meta.json'), 'w'), indent=1)
    until = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    # the window ENDS at the backup the region copies come from, so "ongoing" means the same night as the geometry
    bd = meta.get('backup_done')
    if bd:
        until = min(until, dt.datetime.fromisoformat(bd.replace('Z', '+00:00')).replace(second=0, microsecond=0))
    since = until - dt.timedelta(days=7)
    res = mine(EsSource(since.strftime('%Y-%m-%dT%H:%M:%SZ'), until.strftime('%Y-%m-%dT%H:%M:%SZ')), meta['worlds'], a.top_deaths, a.top_stuck)
    json.dump(res, open(os.path.join(out, 'clusters.json'), 'w'), indent=1, default=list)
    open(os.path.join(out, 'table.txt'), 'w').write(render(res) + '\n')
    regions = os.path.join(home, 'work', gen)
    fetch(res, regions, generation=meta['backup_done'])
    same_staging(meta, json.loads(remote('meta')))
    sdir = os.path.join(out, 'scenes')
    os.makedirs(sdir, exist_ok=True)
    made = iso_ms(int(dt.datetime.now(dt.timezone.utc).timestamp() * 1000))
    lib = a.library if a.library and os.path.isdir(a.library) else None
    for p in res['picks']:
        cov = library_covers(lib, p)
        if cov:
            p['in_library'] = cov
            continue
        sc = make_scene(p, Regions(regions, p['world']), made, meta.get('backup_day'))
        json.dump(sc, open(os.path.join(sdir, p['id'] + '.json'), 'w'), separators=(',', ':'))
    shutil.rmtree(regions, ignore_errors=True)
    with open(os.path.join(home, 'out', 'LATEST.tmp'), 'w') as f:
        f.write(gen + '\n')
    os.replace(os.path.join(home, 'out', 'LATEST.tmp'), os.path.join(home, 'out', 'LATEST'))
    # keep 12 weekly generations (~1 MB each); never the one LATEST names
    gens = sorted(g for g in os.listdir(os.path.join(home, 'out')) if re.match(r'^\d{8}T\d{4}Z$', g))
    for g in gens[:-12]:
        if g != gen:
            shutil.rmtree(os.path.join(home, 'out', g), ignore_errors=True)
    print(render(res))


def cmd_validate(a):
    s = json.load(open(a.scene))
    scene_valid(s)
    print(json.dumps({'ok': True, 'id': s['id'], 'cells': len(decode(s['cells'])), 'cells_sha256': s['cells_sha256']}))


def cmd_classify(a):
    cause, fam = classify_death(a.message)
    print(json.dumps({'cause': cause, 'family': fam}))


ADMIT_MIN_MATCHED = 2          # a start enters the library's gate with >= 2 base runs matching the fleet ...
ADMIT_MIN_RATE = 2 / 3         # ... in >= 2 of every 3, and no base run passing (Claude r1 P2: one draw is not a verdict)


def reproducing_starts(proof):
    """The starts whose BASE runs reproduce the fleet's failure often enough to gate a fix on."""
    by = collections.defaultdict(list)
    for p in proof:
        if p.get('role') == 'base' and p.get('matched_fleet') is not None:   # no-runs prove nothing either way
            by[p.get('start_index') or 0].append(p)
    out = []
    for st, ps in sorted(by.items()):
        m = sum(1 for p in ps if p['matched_fleet'])
        if m >= ADMIT_MIN_MATCHED and m / len(ps) >= ADMIT_MIN_RATE and not any(p.get('pass') for p in ps):
            out.append(st)
    return out


def prove(scene, results, sha_base, label=None):
    """Fold driver results (results.jsonl rows for this scene) into scene['proof']; returns the base verdict.
    A BASE proof is a run on the base build whose outcome MATCHED the fleet (stayed / died of the family nearby)."""
    if not re.match(r'^[0-9a-f]{7,40}$', sha_base or ''):
        raise BlindInput(f'--base-sha {sha_base!r}: give at least 7 hex digits of the base build')
    # only runs on THESE cells: a re-cut scene keeps its id, and an older arena's runs prove nothing about it
    rows = [r for r in results if r.get('scene') == scene['id'] and r.get('cells_sha256') == scene['cells_sha256']
            and (label is None or r.get('label') == label)]
    if not rows:
        raise BlindInput(f'no driver result for {scene["id"]}')
    for r in rows:
        entry = {k: r.get(k) for k in ('at', 'label', 'sha', 'server', 'start_index', 'outcome', 'pass', 'matched_fleet', 'fidelity',
                                       'mechanism', 'minutes', 'detail', 'death', 'script')}
        entry['role'] = 'base' if r.get('sha', '').startswith(sha_base) else 'other'
        if entry not in scene['proof']:
            scene['proof'].append(entry)
    base = [p for p in scene['proof'] if p['role'] == 'base']
    return {'base_runs': len(base), 'base_matched': sum(1 for p in base if p['matched_fleet']), 'base_passed': sum(1 for p in base if p['pass']),
            'reproducing_starts': reproducing_starts(scene['proof'])}


def cmd_prove(a):
    s = json.load(open(a.scene))
    rows = [json.loads(l) for l in open(a.results) if l.strip()]
    v = prove(s, rows, a.base_sha, a.label)
    scene_valid(s)
    json.dump(s, open(a.scene, 'w'), separators=(',', ':'))
    print(json.dumps(v))


def build_index(lib):
    """sandbox/scenes/INDEX.json: one entry per scene file, with its base proof summarised."""
    out = []
    for f in sorted(os.listdir(lib)):
        if not f.endswith('.json') or f == 'INDEX.json':
            continue
        sc = json.load(open(os.path.join(lib, f)))
        scene_valid(sc)
        base = [p for p in sc.get('proof') or [] if p.get('role') == 'base']
        out.append({'file': f, 'id': sc['id'], 'family': sc['family'], 'label': sc['label'], 'world': sc['world'], 'seed': sc['seed'],
                    'cells_sha256': sc['cells_sha256'], 'oracle': sc['oracle']['type'], 'fleet': sc['base'].get('fleet', '')[:200],
                    'base_runs': len(base), 'base_matched': sum(1 for p in base if p.get('matched_fleet')),
                    'base_passed': sum(1 for p in base if p.get('pass')),
                    'reproducing_starts': reproducing_starts(sc.get('proof') or [])})
    return {'schema': 'failmine-library/1', 'scenes': out,
            'rule': 'a fix touching a family must pass every scene of it on the reproducing starts; the base must still fail there '
                    '(sandbox/failmine/library-ab.mjs); a base that passes retires the scene, it never counts as a candidate pass'}


def cmd_index(a):
    ix = build_index(a.library)
    json.dump(ix, open(os.path.join(a.library, 'INDEX.json'), 'w'), indent=1)
    for e in ix['scenes']:
        print(f"{e['id']:<44} {e['label']:<26} base {e['base_matched']}/{e['base_runs']} matched, {e['base_passed']} passed; starts {e['reproducing_starts']}")


def main(argv=None):
    ap = argparse.ArgumentParser(prog='failmine.py')
    sub = ap.add_subparsers(dest='cmd', required=True)
    m = sub.add_parser('mine'); m.add_argument('--seeds', required=True); m.add_argument('--until'); m.add_argument('--days', type=int, default=7)
    m.add_argument('--out', default='.'); m.add_argument('--top-deaths', type=int, default=3); m.add_argument('--top-stuck', type=int, default=2)
    c = sub.add_parser('cut'); c.add_argument('clusters'); c.add_argument('regions'); c.add_argument('--out', default='scenes')
    c.add_argument('--only'); c.add_argument('--library'); c.add_argument('--backup-day')
    f = sub.add_parser('fetch'); f.add_argument('clusters'); f.add_argument('regions'); f.add_argument('--only')
    me = sub.add_parser('meta'); me.add_argument('out')
    w = sub.add_parser('weekly'); w.add_argument('--home', default='~/failmine'); w.add_argument('--top-deaths', type=int, default=3)
    w.add_argument('--top-stuck', type=int, default=2); w.add_argument('--library', default=os.path.expanduser('~/failmine/library'))
    t = sub.add_parser('table'); t.add_argument('clusters')
    v = sub.add_parser('validate'); v.add_argument('scene')
    k = sub.add_parser('classify'); k.add_argument('message')
    pr = sub.add_parser('prove'); pr.add_argument('scene'); pr.add_argument('results'); pr.add_argument('--base-sha', required=True)
    pr.add_argument('--label', help='only driver runs with this label (exploratory runs carry another)')
    ix = sub.add_parser('index'); ix.add_argument('library')
    a = ap.parse_args(argv)
    if a.cmd == 'table':
        print(render(json.load(open(a.clusters))))
        return 0
    {'mine': cmd_mine, 'cut': cmd_cut, 'fetch': cmd_fetch, 'meta': cmd_meta, 'weekly': cmd_weekly, 'validate': cmd_validate,
     'classify': cmd_classify, 'prove': cmd_prove, 'index': cmd_index}[a.cmd](a)
    return 0


if __name__ == '__main__':
    sys.exit(main())
