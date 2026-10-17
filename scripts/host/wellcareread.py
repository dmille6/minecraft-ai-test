#!/usr/bin/env python3
# wellcareread.py [window_min] -- the read for canary `wellcare-01` (the well clean-up bundle). Run under `nice`.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). Judges the CANARY ARM; the control is the instrument check.
#
# THE CHANGE (three fixes, one canary; OWNER 10-17 ~12:50Z):
#   1. minewell-02: `mine` never digs a known junk well's or plinth's shell (wellBreakCost's box, +-2 around the column from
#      cap.y-3 to the cap, and a plinth's stair treads); it walks off to a clear start first. Rows _mine_well_guard.
#   2. NO WELL ORDER FROM DEEP: dispose_well / build_well / close_well are HELD while the bot is more than 12 below the
#      well's stand (wellcare.mjs WELL_REACH_BELOW; measured 10-17: 238 of 262 dispose orders started > 12 below failed
#      well_unreachable, build_well 25 of 25). Rows _well_deep order= below= stand_y= feet_y= limit=12 remedy=surface|walk_up.
#   3. NO STATION ON A WELL: place() never puts a block in a well's shell, shaft (cap.y-2..+3), stands (the four cardinals
#      at cap.y+1/+2) or a plinth stair's headroom; build_well's own table keeps its plinth-ring cell. Rows _station_well
#      action=skip|refuse|room, and _station_placed (every station placed within 6 of a well: item= at= cap= keep= own= by=).
#
#   DENOMINATORS FIRST: rows walked, bots and bot-hours per arm and period, the caps known per pool.
#   LICENCE   _wellcare_mode (once per spawn; only this build writes it).
#   LEAK      any CONTROL row of the build's own kinds (_wellcare_mode, _well_deep, _station_well, _station_placed,
#             _mine_well_guard) -- blocks KEEP.
#   GATES (canary arm, post):
#     W1 breach_shell_dug_by_mine  a _dig_town row by mine inside a known shell or on a plinth stair tread. KNOWN = what the
#                                  bot knows (GATE_CAP_KINDS + plinth records, not retired), from when it became a well.
#     W2 breach_station_on_well    a _station_placed row with own=0 whose cell is a well's shell/shaft/stand/stair (judged
#                                  HERE from the cap and the records, not from the row's own keep=), or keep!=none own=0.
#     W3 breach_deep_order         a dispose_well / close_well row that STARTED more than 13 below a stand the order itself
#                                  names (well_unreachable's standing cell, the visit's _well_dispose at=): start = the bot's
#                                  last row before the order (its bot.pos). One block of slack over the bot's 12 (the bot
#                                  reads its exact feet, the read a row's). build_well is REPORTED (deep_build_orders), not
#                                  gated: a town with no well, no site record and no plinth record falls back to home's y in
#                                  the bot, and its stand is only known after the site search.
#   POSITIVE CONTROLS (reported): the same W1/W3 functions on the CONTROL arm (the base digs shells and orders from deep), and
#             W2's geometry on the control's `place` rows ("placed X at (x, y, z)"). Self-tests on the bots' row strings run on
#             every read.
#   LIVENESS  guard rows seen: _well_deep + acted _mine_well_guard (relocate|stop) + _station_well.
#   EXPOSURE  >= 3 canary _well_deep rows AND >= 1 control order from deep (named stand) in the window: the population fix 2
#             targets was present and the guard acted. Fixes 1 and 3 are rarer; their gates decide whenever they occur.
#   PRIMARY   (reported, not gated) well_unreachable failures per bot-h and dispose_well successes per bot-h, canary vs
#             control, pre vs post (DiD).
import sys, os, re, glob, json
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

AT = re.compile(r'(?:^| )at=(-?\d+),(-?\d+),(-?\d+)')
CAPF = re.compile(r'(?:^| )cap=(-?\d+),(-?\d+),(-?\d+)')
POS = re.compile(r'(?:^| )pos=(-?\d+),(-?\d+),(-?\d+)')
BY = re.compile(r'(?:^| )by=(\S+)')
STAND = re.compile(r"standing cell at (-?\d+),(-?\d+),(-?\d+)")
BUILT = re.compile(r"built the town junk well at (-?\d+),(-?\d+),(-?\d+)")
PLACED = re.compile(r"^placed (\w+) at \((-?\d+), (-?\d+), (-?\d+)\)")
CAP_KINDS = ('_well_built', '_well_dispose', '_well_retired', '_well_refused', '_well_recollected', '_mine_well_guard', '_well_pit_dug', '_station_placed')
# THE GATES judge only wells the bot itself knows (Claude r1 P2): a cap named by a working well's own rows (built, a dispose,
# a dug pit), the canary's own guard rows and station rows, and the plinth records. A cap named only by _well_refused /
# _well_recollected, or RETIRED (_well_retired: its trapdoor may be gone, so the bot no longer knows it), is REPORTED.
GATE_CAP_KINDS = ('_well_built', '_well_dispose', '_well_pit_dug', '_mine_well_guard', '_station_placed')
OWN_KINDS = ('_wellcare_mode', '_well_deep', '_station_well', '_station_placed', '_mine_well_guard')
ORDERS = ('dispose_well', 'build_well', 'close_well')
STATIONS = ('crafting_table', 'furnace', 'blast_furnace', 'smoker', 'chest', 'barrel')
REACH_BELOW = 12          # wellcare.mjs WELL_REACH_BELOW
SLACK = 1
DETAIL_CAP = 300
STATE_DIR = '/var/lib/mcai'
PLINTH_VERSION = 1


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def cap_of(detail, rx=AT):
    """The well cap a row names, or None (a match cut off by the 300-char detail cap is refused: minewellread)."""
    d = detail or ''
    m = rx.search(d)
    if not m or (m.end() == len(d) and len(d) >= DETAIL_CAP - 2):
        return None
    return tuple(int(v) for v in m.groups())


def in_shell(cell, cap):
    """well.mjs wellBreakCost: +-2 around the column, cap.y-3 .. cap."""
    x, y, z = cell; cx, cy, cz = cap
    return abs(x - cx) <= 2 and abs(z - cz) <= 2 and cy - 3 <= y <= cy


def keep_out(cell, cap, stair=(), own=False):
    """wellcare.mjs stationKeepOut, for one column -> 'shaft' | 'stand' | 'stair' | 'well' | None. PURE."""
    x, y, z = cell; cx, cy, cz = cap
    if x == cx and z == cz and cy - 2 <= y <= cy + 3:
        return 'shaft'
    if y in (cy + 1, cy + 2) and (abs(x - cx) + abs(z - cz)) == 1:
        return 'stand'
    for t in stair:
        if x == t[0] and z == t[2] and y in (t[1] + 1, t[1] + 2):
            return 'stair'
    if any((x, y, z) == tuple(t) for t in stair):
        return 'well'
    if in_shell(cell, cap):
        if own and max(abs(x - cx), abs(z - cz)) >= 2:
            return None          # build_well's own table on its plinth's outer ring (plinth-02 wellTableCell)
        return 'well'
    return None


def active(since, pool, cap, t):
    """Was this column a well (or a planned plinth) at time t? `since` {pool: {cap: datetime}}: a column first seen in a
    _well_built / _well_pit_dug row (built in the window) or planned by a record at `at` is judged only from then (Codex r1
    P2: never future geometry retroactively); any other column existed before the window. t None = not timed."""
    a = (since or {}).get(pool, {}).get(cap)
    return a is None or t is None or t >= a


def shell_digs(digs, cols, since=None):
    """PURE. digs [(pool, bot, detail[, t])] _dig_town rows; cols {pool: {cap: stair-tuple}} -> [(bot, cell, cap, by)] by mine."""
    out = []
    for row in digs:
        pool, bot, d = row[:3]; t = row[3] if len(row) > 3 else None
        m = POS.search(d or ''); by = BY.search(d or '')
        if not m or not by or not by.group(1).startswith('mine'):
            continue
        cell = tuple(int(v) for v in m.groups())
        for cap, stair in cols.get(pool, {}).items():
            if (in_shell(cell, cap) or cell in stair) and active(since, pool, cap, t):
                out.append((bot, cell, cap, by.group(1))); break
    return out


def station_breaches(placed, cols, since=None):
    """PURE. placed [(pool, bot, detail[, t])] _station_placed rows -> [(bot, item, cell, cap, kind)] whose cell is a well's
    (own=0), judged against every column of the pool known at that time (the row's own cap= included: the bot knew it)
    -- or keep!=none with own=0."""
    out = []
    for row in placed:
        pool, bot, d = row[:3]; t = row[3] if len(row) > 3 else None
        at = cap_of(d); cap = cap_of(d, CAPF)
        own = ' own=1' in (d or '')
        item = (re.search(r'(?:^| )item=(\S+)', d or '') or [None, '?'])[1]
        keep = (re.search(r'(?:^| )keep=(\S+)', d or '') or [None, 'none'])[1]
        if not at:
            continue
        known = dict(cols.get(pool, {}))
        if cap and cap not in known:
            known[cap] = ()
        kind = None
        for c, stair in known.items():
            if c != cap and not active(since, pool, c, t):
                continue
            kind = keep_out(at, c, stair, own=own and c == cap)
            if kind:
                break
        if kind or (keep != 'none' and not own):
            out.append((bot, item, at, cap, kind or keep))
    return out


def place_row_breaches(rows_, cols):
    """PURE. The CONTROL's `place` skill rows ("placed X at (x, y, z)") through the same geometry (instrument check)."""
    out = []
    for pool, bot, d in rows_:
        m = PLACED.search(d or '')
        if not m or m.group(1) not in STATIONS:
            continue
        cell = (int(m.group(2)), int(m.group(3)), int(m.group(4)))
        for c, stair in cols.get(pool, {}).items():
            k = keep_out(cell, c, stair)
            if k:
                out.append((bot, m.group(1), cell, c, k)); break
    return out


EVIDENCE_KINDS = ('_well_dispose', '_well_refused', '_well_built')


def deep_orders(seq, limit=REACH_BELOW + SLACK):
    """PURE. seq: ONE bot's rows [(t, kind, detail, pos_y, dur_ms)] -- t is the row's @timestamp (a skill row's START; a
    reflex row's moment), pos_y its bot.pos (a skill row's END position), dur_ms the skill's duration (0 for a reflex row).
    -> [(t, kind, start_y, stand_y)] for the orders whose START was more than `limit` below a stand the order names.
      START = the position of the row that ENDED last at or before the order's start (Codex r1 P1: ordering by @timestamp
              puts a long skill's end position before the reflex rows written during it -- a climb's mid-way row read as
              the start of the order that followed it).
      STAND = the order's own detail (well_unreachable's standing cell; build's "built ... at"), else the cap of an
              evidence row the order itself wrote: _well_dispose / _well_refused / _well_built with @timestamp inside
              [start, start + duration + 2 s] (Codex r1 P1: bounded by the order's duration, never the next visit's)."""
    rows = [(t, k, d, y, (t + dt.timedelta(milliseconds=max(0, dur or 0)))) for t, k, d, y, dur in seq]
    by_end = sorted((e, y) for t, k, d, y, e in rows if y is not None)
    ends = [e for e, _ in by_end]
    import bisect
    out = []
    for t, k, d, y, e in rows:
        if k not in ORDERS:
            continue
        stand = None
        m = STAND.search(d or '')
        if m:
            stand = int(m.group(2))
        else:
            m = BUILT.search(d or '')
            if m:
                stand = int(m.group(2)) + 1
            else:
                hi = e + dt.timedelta(seconds=2)
                for t2, k2, d2, _y2, _e2 in rows:
                    if k2 in EVIDENCE_KINDS and t <= t2 <= hi:
                        c = cap_of(d2)
                        if c:
                            stand = c[1] + 1; break
        if stand is None:
            continue
        i = bisect.bisect_left(ends, t) - 1   # rows that ENDED strictly before the order started (never the order itself)
        if i < 0:
            continue
        start_y = by_end[i][1]
        if stand - start_y > limit:
            out.append((t, k, start_y, stand))
    return out


def plinth_columns(pools, worlds, state_dir=STATE_DIR):
    """{pool: {cap: stair-tuple}} from the pools' plinth records (plan cap + every carried `prev` column, with stairs).
    World identity when this window saw the pool's world (w= on _plinth_mode / no_site rows); a pool with no world seen
    keeps its records (a missed breach is worse than a phantom cap; reported as unverified)."""
    out = defaultdict(dict); unverified = set(); since = defaultdict(dict)
    for pool in sorted(pools):
        for f in sorted(glob.glob('%s/_pool-%s/junkwell-plinth-*.json' % (state_dir, pool))):
            if '.lease.' in f:
                continue
            try:
                rec = json.load(open(f))
            except Exception:
                continue
            if not isinstance(rec, dict) or rec.get('v') != PLINTH_VERSION:
                continue
            seen = (worlds or {}).get(pool); world = str(rec.get('world') or '')
            if seen and world and not world.startswith(seen):
                continue
            if not seen:
                unverified.add(pool)
            plan = rec.get('plan') or {}
            cols = [(plan.get('cap') or {}, plan.get('stair') or [])] + [(c, c.get('stair') or []) for c in (rec.get('prev') or []) if isinstance(c, dict)]
            for j, (c, st) in enumerate(cols):
                if all(k in c for k in 'xyz'):
                    key = (int(c['x']), int(c['y']), int(c['z']))
                    out[pool][key] = tuple(tuple(int(v) for v in s) for s in st if isinstance(s, (list, tuple)) and len(s) == 3)
                    if j == 0 and isinstance(rec.get('at'), (int, float)):   # the plan's cap: planned at rec.at (prev: older)
                        since[pool][key] = dt.datetime.fromtimestamp(rec['at'] / 1000, dt.timezone.utc)
    return out, unverified, since


# ---- self-tests on the bots' own row strings ------------------------------------------------------------------------------
_HD = [('hive-d', 'hive-d-Echo', 'pos=79,57,77 block=sandstone class=ground purpose=target by=mine:y55 outcome=confirmed dt=19'),
       ('hive-d', 'hive-d-Delta', 'pos=79,57,76 block=sandstone class=ground purpose=other by=build_well outcome=confirmed dt=38'),
       ('board-b', 'board-b-Echo', 'pos=-247,70,138 block=cobblestone class=ground purpose=target by=mine:y40 outcome=confirmed dt=19'),
       ('board-b', 'board-b-Echo', 'pos=-247,70,139 block=stone class=ground purpose=target by=mine:y40 outcome=confirmed dt=19')]
_COLS = {'hive-d': {(79, 57, 76): ()}, 'board-b': {(-247, 72, 135): ((-247, 70, 138),)}}
_t0 = dt.datetime(2026, 10, 17, 4, 0, tzinfo=dt.timezone.utc)
assert shell_digs([('hive-d', 'e', _HD[0][2], _t0)], _COLS, {'hive-d': {(79, 57, 76): _t0 + dt.timedelta(minutes=5)}}) == [], 'a well built after the dig (Codex r1 P2)'
assert len(shell_digs([('hive-d', 'e', _HD[0][2], _t0 + dt.timedelta(minutes=6))], _COLS, {'hive-d': {(79, 57, 76): _t0 + dt.timedelta(minutes=5)}})) == 1
assert [c for _, c, _, _ in shell_digs(_HD, _COLS)] == [(79, 57, 77), (-247, 70, 138)], 'the wall by mine and the plinth stair tread; not the builder; not past the tread'
assert keep_out((365, 73, 135), (365, 73, 137)) == 'well' and keep_out((365, 73, 135), (365, 73, 137), own=True) is None, 'board-c table: the builder\'s only'
assert keep_out((365, 74, 136), (365, 73, 137)) == 'stand' and keep_out((365, 74, 137), (365, 73, 137)) == 'shaft' and keep_out((366, 74, 136), (365, 73, 137)) is None
assert keep_out((-247, 71, 138), (-247, 72, 135), ((-247, 70, 138),)) == 'stair'
_SP = [('board-c', 'b1', 'item=crafting_table at=365,74,136 cap=365,73,137 keep=none own=0 by=-'),
       ('board-c', 'b2', 'item=crafting_table at=365,73,135 cap=365,73,137 keep=none own=1 by=build_well'),
       ('board-c', 'b3', 'item=crafting_table at=368,74,140 cap=365,73,137 keep=none own=0 by=-'),
       ('board-c', 'b4', 'item=furnace at=368,74,141 cap=365,73,137 keep=stand own=0 by=-')]
assert [(b, k) for b, _, _, _, k in station_breaches(_SP, {})] == [('b1', 'stand'), ('b4', 'stand')], station_breaches(_SP, {})
assert [k for *_, k in place_row_breaches([('board-c', 'x', 'placed crafting_table at (365, 74, 137)'), ('board-c', 'y', 'placed dirt at (365, 74, 137)')], {'board-c': {(365, 73, 137): ()}})] == ['shaft']
_T = lambda m, s=0: dt.datetime(2026, 10, 17, 4, m, s, tzinfo=dt.timezone.utc)
_SEQ = [(_T(0), 'mine', 'ok', 33.0, 30000), (_T(1), 'dispose_well', "could not reach the junk well site's standing cell at 365,74,136 (the bot is at 377.50,33.00,136.50)", 33.0, 25000),
        (_T(2), 'surface', 'ok', 70.0, 20000), (_T(3), 'dispose_well', 'threw 118 junk item(s) down the town well (36 -> 27 slots)', 74.0, 9000), (_T(3, 8), '_well_dispose', 'slots=36->27 at=365,73,137 x=1', 74.0, 0),
        (_T(4), 'mine', 'ok', 60.0, 10000), (_T(5), 'dispose_well', 'threw 2', 74.0, 5000), (_T(5, 4), '_well_dispose', 'at=365,73,137', 74.0, 0)]
assert [(k, a, b) for _, k, a, b in deep_orders(_SEQ)] == [('dispose_well', 33.0, 74), ('dispose_well', 60.0, 74)], 'board-c-Alpha 10-17 04:11Z from 41 below, and 14 below; not 4 below after the climb'
assert [(a, b) for _, _, a, b in deep_orders(_SEQ, limit=14)] == [(33.0, 74)], 'the limit is the threshold'
assert [round(b - a) for _, _, a, b in deep_orders([(_T(0), 'x', '', 60.0, 0), (_T(1), 'dispose_well', 'threw', 70, 4000), (_T(1, 3), '_well_dispose', 'at=365,73,137', 70, 0)])] == [14], '14 below: a breach'
assert deep_orders([(_T(0), 'x', '', 61.0, 0), (_T(1), 'dispose_well', 'threw', 70, 4000), (_T(1, 3), '_well_dispose', 'at=365,73,137', 70, 0)]) == [], '13 below is the one block of slack'
assert deep_orders([(_T(0), 'x', '', 20.0, 0), (_T(1), 'dispose_well', 'nothing on the junk list', 20, 0)]) == [], 'an order that names no stand is not judged'
# Codex r1 P1 (the interleaved climb): surface STARTS at 0:00 and ends at 0:20 at y 74; a reflex row at 0:10 says y 50; the
# order at 0:30 started at 74 -- not 24 below
assert deep_orders([(_T(0), 'surface', 'ok', 74.0, 20000), (_T(0, 10), '_reflex', 'climbing', 50.0, 0), (_T(0, 30), 'dispose_well', 'threw', 74, 4000),
                    (_T(0, 33), '_well_dispose', 'at=365,73,137', 74, 0)]) == [], 'a reflex row inside the climb read as the start'
# Codex r1 P1 (the join): the next visit's evidence (after this order's duration) never names this order's stand
assert deep_orders([(_T(0), 'x', '', 40.0, 0), (_T(1), 'dispose_well', 'skipped', 40, 1000), (_T(3), '_well_dispose', 'at=365,73,137', 74, 0)]) == [], 'another visit\'s cap joined'


if __name__ == '__main__':
    from lib.telemetry import Events
    man = json.load(open('/srv/mcbots/trial-manifest.json'))
    ovr = os.environ.get('CANARY_DRYRUN')
    if ovr:
        CAN, CV, ISO = ovr.split(':', 2)
        CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
    else:
        CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
        CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
    CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
    now = dt.datetime.now(dt.timezone.utc)
    elapsed = (now - CUT).total_seconds() / 60
    assert elapsed > 0 and CAN, 'no canary declared'
    W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
    END = CUT + dt.timedelta(minutes=W)
    PRE = CUT - dt.timedelta(minutes=W)

    def load_window(since, until):
        ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
        key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
        out, seen = [], set()
        for r in ev.rows:
            if key(r) not in seen:
                out.append(r); seen.add(key(r))
        for k in range(0, (until.date() - since.date()).days + 1):
            tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
            for g in glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
                for r in Events.load(paths=g, since=since, until=until).rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    caps = defaultdict(dict); row_since = defaultdict(dict); worlds = {}; offbuild = 0; gate_caps = defaultdict(set); retired = defaultdict(set)
    bots = defaultdict(set); kinds = Counter(); per_bot = defaultdict(list)
    licence = 0; leak = Counter(); guard = Counter(); digs = {'canary': [], 'control': []}; placed = []; ctl_place = []
    outcome = Counter()
    for r in rows:
        b = (r.get('bot') or {}).get('name'); t = r.get('t'); k = r.get('name') or ''; d = r.get('detail') or ''
        if not b or t is None:
            continue
        p = pool_of(b); arm = 'canary' if p in CANS else 'control'; period = 'post' if t >= CUT else 'pre'
        raw = r.get('raw') or {}
        ver = ((raw.get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        bots[(period, arm)].add(b); kinds[(period, arm)] += 1
        m = re.search(r'(?:^| )w=(\S+)', d) if k in ('_plinth_mode', '_well_refused') else None
        if m and m.group(1) != '-':
            worlds[p] = m.group(1)[:40]
        if k in CAP_KINDS:
            c = cap_of(d, CAPF) if k == '_station_placed' else cap_of(d)
            if c:
                caps[p].setdefault(c, ())
                if k in GATE_CAP_KINDS:
                    gate_caps[p].add(c)
                if k == '_well_retired':
                    retired[p].add(c)
                # a well BUILT in the window is a well from then; one named by any other row existed before it
                first = t if k in ('_well_built', '_well_pit_dug') else dt.datetime.min.replace(tzinfo=dt.timezone.utc)
                if c not in row_since[p] or first < row_since[p][c]:
                    row_since[p][c] = first
        pos = (raw.get('bot') or {}).get('pos') or {}
        sk = raw.get('skill') or {}
        per_bot[b].append((t, k, d, pos.get('y') if isinstance(pos, dict) else None, sk.get('duration_ms') or 0))
        if k in ORDERS:
            outcome[(period, arm, 'unreach')] += sk.get('fail_class') == 'well_unreachable'
            outcome[(period, arm, 'dispose_ok')] += k == 'dispose_well' and sk.get('status') == 'success'
        if period != 'post':
            continue
        if k in OWN_KINDS and arm == 'control':
            leak[k] += 1
            continue
        if k == '_wellcare_mode':
            licence += 1
        elif k == '_well_deep':
            guard['well_deep'] += 1
        elif k == '_mine_well_guard':
            a = re.search(r'action=(\w+)', d); guard['mine_' + (a.group(1) if a else '?')] += 1
        elif k == '_station_well':
            a = re.search(r'action=(\w+)', d); guard['station_' + (a.group(1) if a else '?')] += 1
        elif k == '_station_placed':
            placed.append((p, b, d, t))
        elif k == '_dig_town':
            digs[arm].append((p, b, d, t))
        elif k == 'place' and arm == 'control':
            ctl_place.append((p, b, d))

    pcols, unverified, psince = plinth_columns(set(caps) | CANS, worlds)
    since = defaultdict(dict)
    for p in set(row_since) | set(psince):
        for c, a in list(row_since.get(p, {}).items()) + list(psince.get(p, {}).items()):
            since[p][c] = min(a, since[p].get(c, a))
    cols = defaultdict(dict); gcols = defaultdict(dict)
    for p in set(caps) | set(pcols):
        cols[p].update(caps.get(p, {}))
        cols[p].update(pcols.get(p, {}))   # a record's stair wins over a row's bare cap
        for c, st in cols[p].items():
            if (c in pcols.get(p, {}) or c in gate_caps.get(p, set())) and c not in retired.get(p, set()):
                gcols[p][c] = st
    # orders from deep, per arm (post): deep_orders joins each order's own evidence rows within its duration
    deep = {'canary': [], 'control': [], 'canary_build': [], 'control_build': []}
    for b, seq in per_bot.items():
        arm = 'canary' if pool_of(b) in CANS else 'control'
        for (t, k, ps, st) in deep_orders(seq):
            if t >= CUT:
                deep[arm if k != 'build_well' else arm + '_build'].append((b, t.strftime('%H:%MZ'), k, ps, st))
    w1 = shell_digs(digs['canary'], gcols, since); w1c = shell_digs(digs['control'], gcols, since)
    w2 = station_breaches(placed, gcols, since); w2c = place_row_breaches(ctl_place, gcols)
    w1u = [x for x in shell_digs(digs['canary'], cols, since) if x not in w1]; w2u = [x for x in station_breaches(placed, cols, since) if x not in w2]
    hours = W / 60
    bh = lambda per, arm: len(bots[(per, arm)]) * hours
    rate = lambda per, arm, key: (outcome[(per, arm, key)] / bh(per, arm)) if bh(per, arm) else float('nan')
    did = lambda key: (rate('post', 'canary', key) - rate('pre', 'canary', key)) - (rate('post', 'control', key) - rate('pre', 'control', key))
    acted_mine = guard['mine_relocate'] + guard['mine_stop']
    acted_station = sum(v for k2, v in guard.items() if k2.startswith('station_'))
    print('DENOMINATORS rows walked %d | canary %s sha %s cutoff %s window +%d min | bots canary pre %d post %d, control pre %d post %d | bot-h canary %.1f control %.1f | offbuild canary rows %d'
          % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('pre', 'canary')]), len(bots[('post', 'canary')]), len(bots[('pre', 'control')]), len(bots[('post', 'control')]),
             bh('post', 'canary'), bh('post', 'control'), offbuild))
    print('             columns known per pool %s | plinth records %s | world unverified %s'
          % ({p: len(c) for p, c in sorted(cols.items())}, {p: len(c) for p, c in sorted(pcols.items())}, sorted(unverified)))
    print('LICENCE      canary _wellcare_mode rows %d | LEAK control own-kind rows %d %s' % (licence, sum(leak.values()), dict(leak)))
    print('LIVENESS     guard rows: _well_deep %d | _mine_well_guard %s | _station_well %d' % (guard['well_deep'], {k2[5:]: v for k2, v in guard.items() if k2.startswith('mine_')}, acted_station))
    print('W1 (gate)    canary mine digs in a known shell / plinth stair: %d %s | ungated (retired / refusal-only caps) %d %s' % (len(w1), w1[:3], len(w1u), w1u[:2]))
    print('W2 (gate)    canary stations on a well cell: %d %s | _station_placed rows %d | ungated %d %s' % (len(w2), w2[:3], len(placed), len(w2u), w2u[:2]))
    print('             gate columns per pool %s | retired %s' % ({p: len(c) for p, c in sorted(gcols.items())}, {p: len(c) for p, c in sorted(retired.items()) if c}))
    print('W3 (gate)    canary dispose/close orders started > %d below a stand they name: %d %s | build_well (reported) canary %d control %d'
          % (REACH_BELOW + SLACK, len(deep['canary']), deep['canary'][:3], len(deep['canary_build']), len(deep['control_build'])))
    print('INSTRUMENT   control: mine shell digs %d %s | orders from deep %d %s | control place rows on a well cell %d %s'
          % (len(w1c), w1c[:2], len(deep['control']), deep['control'][:2], len(w2c), w2c[:2]))
    print('PRIMARY      well_unreachable /bot-h canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f | dispose ok /bot-h canary %.3f -> %.3f control %.3f -> %.3f DiD %+.3f'
          % (rate('pre', 'canary', 'unreach'), rate('post', 'canary', 'unreach'), rate('pre', 'control', 'unreach'), rate('post', 'control', 'unreach'), did('unreach'),
             rate('pre', 'canary', 'dispose_ok'), rate('post', 'canary', 'dispose_ok'), rate('pre', 'control', 'dispose_ok'), rate('post', 'control', 'dispose_ok'), did('dispose_ok')))
    print('             counts: unreachable canary %d -> %d control %d -> %d | dispose ok canary %d -> %d control %d -> %d'
          % (outcome[('pre', 'canary', 'unreach')], outcome[('post', 'canary', 'unreach')], outcome[('pre', 'control', 'unreach')], outcome[('post', 'control', 'unreach')],
             outcome[('pre', 'canary', 'dispose_ok')], outcome[('post', 'canary', 'dispose_ok')], outcome[('pre', 'control', 'dispose_ok')], outcome[('post', 'control', 'dispose_ok')]))
    ready = int(guard['well_deep'] >= 3 and len(deep['control']) >= 1)
    print('EXPOSURE     ready %d (canary _well_deep %d >= 3 and control orders from deep %d >= 1); fix 1 acted %d, fix 3 rows %d'
          % (ready, guard['well_deep'], len(deep['control']), acted_mine, acted_station))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        nan = lambda v: None if v != v else round(v, 4)
        emit('wellcareread', W, {
            'licence_rows': licence, 'control_leak_rows': sum(leak.values()),
            'guard_well_deep': guard['well_deep'], 'guard_mine_acted': acted_mine, 'guard_mine_refuse': guard['mine_refuse'], 'guard_station': acted_station,
            'guard_rows_seen': guard['well_deep'] + acted_mine + acted_station,
            'breach_shell_dug_by_mine': len(w1), 'breach_station_on_well': len(w2), 'breach_deep_order': len(deep['canary']),
            'ungated_shell_digs': len(w1u), 'ungated_station_on_well': len(w2u),
            'deep_build_orders_canary': len(deep['canary_build']), 'deep_build_orders_control': len(deep['control_build']),
            'control_shell_dug_by_mine': len(w1c), 'control_deep_orders': len(deep['control']), 'control_station_on_well': len(w2c),
            'unreach_rate_did': nan(did('unreach')), 'dispose_rate_did': nan(did('dispose_ok')),
            'bot_hours_canary': round(bh('post', 'canary'), 1), 'bot_hours_control': round(bh('post', 'control'), 1),
            'exposure_ready': ready,
        })
    except Exception as e:
        print('emit failed:', e)
