#!/usr/bin/env python3
# plinthread.py [window_min] -- the read for canary `plinth-01` (branch plinth-on-baa9487). Run under `nice`.
# CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
#
# THE CHANGE (bots/src/plinth.mjs, skills.mjs build_plinth; design docs/reports/townground-2026-10-13.md section 3):
#   A town whose last junk-well site search found no cell (wellsite-01's junkwell-nosite record) PLANS a raised well once
#   (the unchanged oracle on the world with the plan applied; every step's support, stand and route proven offline), records
#   it (junkwell-plinth-<home>.json), and BUILDS it in bounded visits -- placements only (leaves in planned cells cleared),
#   one builder per town (a lease), from the bag's surplus stone above STONE_GUARD and a pit cover, else a town chest's.
#   The finished plinth's cap becomes the town's well site; build_well floors and caps it as at any site.
#   Rows: _plinth (stage=planned|none|build|complete|<failClass>), _plinth_step (one per step: op, at, step, id, alt),
#   _well_pit_dug from=plinth|plinth_resume|plinth_cover, _well_pit_covered stage=plinth, _well_pit_open stage=plinth.
#
#   LICENCE      canary _plinth rows (the base never writes the kind).
#   POPULATION   a canary town with NO junk well (draw_exposure: no_site rows); control towns without a well are the DiD's
#                comparison (towns with a well are an instrument control only).
#   GATES (defect)
#     P1 breach_outside_shell   a canary _plinth_step op=place whose cell is neither in the 81-cell shell of its cap
#                               (plinthShell) nor on a stair line (a cardinal from the cap, 3..6 out, lateral -1..1, below g).
#     P2 breach_reserve         a canary _plinth build/complete row with placed>0 whose bag (the row's inventory) holds
#                               fewer than 64 RESERVE_STONE (cobblestone, cobbled_deepslate, andesite, diorite, granite).
#     P3 breach_pit_open_10m    a canary plinth pit (the last pit event at a plinth cap is dug/open, not covered/built)
#                               older than 10 min at the read's end -- an uncovered walled-in column nobody covered.
#     P4 breach_retired_plinth  a _well_retired at a canary plinth's cap (a raised well that did not hold).
#     P5 breach_stuck_plinth    > 1 canary entombment/stranded/livelock escape row with the body within 3 (horizontal
#                               Chebyshev, |dy| <= 5) of a plinth cap.
#     P6 control_plinth_rows    a CONTROL _plinth row (the control is not running the base). Blocks KEEP.
#   INSTRUMENT   the same row selectors on fixture rows (self-tests below, run every read); control no_site rows post >= 1.
#   PRIMARY      canary towns: planned / complete, blocks placed, alt stands, retries, step pace; _well_built at a plinth
#                cap; dispose_well successes per bot-hour DiD against control towns WITHOUT a well (report only).
#   EXPOSURE     a canary plinth complete AND a _well_built at its cap, in a window >= 180 min.
import sys, os, re
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

RESERVE = ('cobblestone', 'cobbled_deepslate', 'andesite', 'diorite', 'granite')   # well.mjs RESERVE_STONE
STONE_GUARD = 64
PIT_OPEN_MAX = dt.timedelta(minutes=10)
MAX_RAISE = 4                                                                        # plinth.mjs PLINTH_MAX_RAISE


def kv(d):
    out = {}
    for m in re.finditer(r'(?:^| )([a-z_]+)=(\S+)', d or ''):
        out.setdefault(m.group(1), m.group(2))
    return out


def xyz(s):
    try:
        a = [int(v) for v in (s or '').split(',')]
        return tuple(a) if len(a) == 3 else None
    except ValueError:
        return None


def in_shell(cap, c):
    """PURE. plinth.mjs plinthShell: g 3x3 minus the cap; g-1 5x5 minus the shaft; g-2 5x5 (floor included); g-3 5x5 minus
    the centre."""
    dx, dy, dz = c[0] - cap[0], c[1] - cap[1], c[2] - cap[2]
    r = max(abs(dx), abs(dz))
    if dy == 0:
        return r == 1
    if dy == -1 or dy == -3:
        return 1 <= r <= 2
    if dy == -2:
        return r <= 2
    return False


def on_stair_line(cap, c):
    """PURE. plinth.mjs stairOptions: from the ledge outward along a cardinal, 3..2+MAX_RAISE out, lateral -1..1, every
    cell below g-1 (a step's top is g-1-j)."""
    dx, dy, dz = c[0] - cap[0], c[1] - cap[1], c[2] - cap[2]
    if dy > -2:
        return False
    along, lat = (abs(dx), dz) if abs(dx) >= 3 else (abs(dz), dx)
    return 3 <= along <= 2 + MAX_RAISE and abs(lat) <= 1


def reserve_of(inv):
    return sum(int(inv.get(n, 0) or 0) for n in RESERVE)


def pit_open(events, end):
    """PURE. events: [(t, cap, kind)] kind in dug|open|covered|built. -> [cap] whose LAST event is dug/open and older than
    PIT_OPEN_MAX at `end` (a resume's dug restarts the clock, a cover or a built well ends it)."""
    last = {}
    for t, cap, kind in sorted(events, key=lambda e: e[0]):
        last[cap] = (t, kind)
    return [cap for cap, (t, kind) in last.items() if kind in ('dug', 'open') and end - t > PIT_OPEN_MAX]


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


# ---- self-tests on the bot's own row strings (skills.mjs plinthDetail / the step row / the pit rows) ----
_CAP = (100, 70, 100)
assert in_shell(_CAP, (101, 70, 100)) and in_shell(_CAP, (102, 69, 100)) and in_shell(_CAP, (100, 68, 100)) and in_shell(_CAP, (98, 67, 98))
assert not in_shell(_CAP, (100, 70, 100)) and not in_shell(_CAP, (100, 69, 100)) and not in_shell(_CAP, (102, 70, 100)) and not in_shell(_CAP, (100, 67, 100))
assert not in_shell(_CAP, (103, 69, 100)) and not in_shell(_CAP, (100, 71, 100))
assert on_stair_line(_CAP, (103, 68, 100)) and on_stair_line(_CAP, (100, 67, 104)) and on_stair_line(_CAP, (104, 66, 101))
assert not on_stair_line(_CAP, (103, 69, 100)), 'a step top is at most g-2'
assert not on_stair_line(_CAP, (110, 66, 100)) and not on_stair_line(_CAP, (104, 66, 104)), 'off the line'
_STEP = 'op=place at=101,70,100 step=12 id=board-a-Alpha-x1-ab12 stand=103,71,100 alt=0 block=cobblestone'
assert xyz(kv(_STEP)['at']) == (101, 70, 100) and kv(_STEP)['op'] == 'place' and kv(_STEP)['alt'] == '0'
_ROW = 'stage=build at=100,70,100 k=3 placed=12 cleared=0 alt=1 retries=0 done=40/60 left=20 budget=50 took=0 hazard=0 id=x'
assert kv(_ROW)['stage'] == 'build' and kv(_ROW)['placed'] == '12' and xyz(kv(_ROW)['at']) == _CAP
assert reserve_of({'cobblestone': 60, 'andesite': 4, 'dirt': 9}) == 64
_T = dt.datetime(2026, 10, 13, tzinfo=dt.timezone.utc)
_m = lambda n: _T + dt.timedelta(minutes=n)
assert pit_open([(_m(0), _CAP, 'dug')], _m(11)) == [_CAP], 'an uncovered pit older than 10 min'
assert pit_open([(_m(0), _CAP, 'dug')], _m(9)) == [], 'not yet'
assert pit_open([(_m(0), _CAP, 'dug'), (_m(1), _CAP, 'covered')], _m(30)) == [], 'covered'
assert pit_open([(_m(0), _CAP, 'dug'), (_m(1), _CAP, 'covered'), (_m(5), _CAP, 'dug')], _m(30)) == [_CAP], 'a resume re-opens it'
assert pit_open([(_m(0), _CAP, 'dug'), (_m(2), _CAP, 'built')], _m(30)) == [], 'a built well closes it'

if __name__ == '__main__':
    import json
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
        """Rotation-aware (wellread's pattern): day D's rows live in skill-*.jsonl-<D+1>.gz after the ~23:59Z rotation."""
        ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
        key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
        out, seen = [], set()
        for r in ev.rows:
            if key(r) not in seen:
                out.append(r); seen.add(key(r))
        import glob as _glob
        for k in range(0, (until.date() - since.date()).days + 1):
            tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
            for g in _glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
                e2 = Events.load(paths=g, since=since, until=until)
                for r in e2.rows:
                    if key(r) not in seen:
                        out.append(r); seen.add(key(r))
        return out

    ev_rows = sorted(load_window(PRE, END), key=lambda r: r['t'])
    bots = defaultdict(set); rows = Counter(); offbuild = 0; n = Counter()
    caps = {}                                       # canary plinth cap -> pool
    steps = []; reserve_breach = []; pit_events = []; retired = []; stuck = []; leak = 0
    no_well_pre = defaultdict(int); well_pre = defaultdict(int); disposed = Counter()
    plinth_rows = defaultdict(list); step_ts = defaultdict(list); built_at = set()
    for r in ev_rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
            continue
        arm = 'canary' if pool_of(b) in CANS else 'control'
        period = 'post' if t >= CUT else 'pre'
        raw = r.get('raw') or {}
        ver = ((raw.get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV and ver and not ver.startswith(CV):
            offbuild += 1
            continue
        bots[(period, arm)].add(b); rows[(period, arm)] += 1
        k = (r.get('name') or '').lstrip('_'); d = r.get('detail') or ''; f = kv(d)
        if k == 'well_refused' and d.startswith('order=build ') and (f.get('reason') or '').startswith('no_site'):
            n[(period, arm, 'no_site')] += 1
            if period == 'pre':
                no_well_pre[pool_of(b)] += 1
        if k == 'dispose_well' and ((raw.get('skill') or {}).get('status') == 'success'):
            n[(period, arm, 'dispose_success')] += 1
            if period == 'pre':
                well_pre[pool_of(b)] += 1
            if period == 'post' and arm == 'canary':
                disposed[pool_of(b)] += 1
        if period != 'post':
            continue
        if k == 'plinth':
            if arm == 'control':
                leak += 1
                continue
            n[('post', 'canary', 'licence')] += 1
            st = f.get('stage'); cap = xyz(f.get('at'))
            if cap:
                caps[cap] = pool_of(b)
            plinth_rows[pool_of(b)].append((t, st, f))
            n[('post', 'canary', 'stage_' + str(st))] += 1
            if st in ('build', 'complete') and int(f.get('placed', '0') or 0) > 0:
                inv = ((raw.get('bot') or {}).get('inventory') or {})
                if reserve_of(inv) < STONE_GUARD:
                    reserve_breach.append((b, t.strftime('%H:%M:%S'), reserve_of(inv)))
        elif k == 'plinth_step' and arm == 'canary':
            steps.append((b, t, f))
            step_ts[f.get('id')].append(t)
        elif k in ('well_pit_dug', 'well_pit_open', 'well_pit_covered', 'well_built') and arm == 'canary':
            at = xyz(f.get('at'))
            kind = {'well_pit_dug': 'dug', 'well_pit_open': 'open', 'well_pit_covered': 'covered', 'well_built': 'built'}[k]
            if at:
                pit_events.append((t, at, kind))
                if k == 'well_built':
                    built_at.add(at)
        elif k == 'well_retired':
            at = xyz(f.get('at'))
            if at:
                retired.append((b, t, at))
        elif k in ('entombed', 'livelock_escape') or k.startswith('stranded_escape'):
            p = ((raw.get('bot') or {}).get('pos') or {})
            if arm == 'canary' and 'x' in p:
                stuck.append((b, t, (p['x'], p['y'], p['z'])))
            n[('post', arm, 'stuck_any')] += 1

    outside = []
    for b, t, f in steps:
        if f.get('op') != 'place':
            continue
        c = xyz(f.get('at'))
        cap = None
        for cp in caps:
            if abs(cp[0] - (c or (0, 0, 0))[0]) <= 2 + MAX_RAISE and abs(cp[2] - (c or (0, 0, 0))[2]) <= 2 + MAX_RAISE:
                cap = cp
        if not c or not cap or not (in_shell(cap, c) or on_stair_line(cap, c)):
            outside.append((b, t.strftime('%H:%M:%S'), f.get('at')))
    plinth_caps = set(caps)
    pit_events = [e for e in pit_events if e[1] in plinth_caps]
    open_pits = pit_open(pit_events, END)
    retired_p = [x for x in retired if x[2] in plinth_caps]
    near = lambda p, cap: max(abs(p[0] - cap[0] - 0.5), abs(p[2] - cap[2] - 0.5)) <= 3.5 and abs(p[1] - cap[1]) <= 5
    stuck_p = [(b, t.strftime('%H:%M'), p) for b, t, p in stuck if any(near(p, c) for c in plinth_caps)]
    complete = {caps[c] for c in caps if any(st == 'complete' for _t, st, _f in plinth_rows[caps[c]])}
    built_plinths = [c for c in plinth_caps if c in built_at]

    hours = W / 60.0
    nowell_ctl = {p for p in no_well_pre if p not in CANS and well_pre.get(p, 0) == 0}
    def rate(period, arm, what, pools=None):
        bs = [x for x in bots[(period, arm)] if pools is None or pool_of(x) in pools]
        return (n[(period, arm, what)] / (len(bs) * hours)) if bs and hours else float('nan')
    alt = sum(1 for _b, _t, f in steps if f.get('alt') == '1')
    paces = []
    for _id, ts in step_ts.items():
        ts.sort(); paces += [(b - a).total_seconds() for a, b in zip(ts, ts[1:]) if (b - a).total_seconds() < 120]
    paces.sort()
    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  bots post canary %d control %d  |  offbuild canary rows %d'
          % (len(ev_rows), CAN, CV, CUT.strftime('%H:%MZ'), W, len(bots[('post', 'canary')]), len(bots[('post', 'control')]), offbuild))
    print('LIVENESS     licence (canary _plinth rows) %d | stages %s | steps %d (alt stands %d) | plinth caps %s'
          % (n[('post', 'canary', 'licence')], {k[2][6:]: v for k, v in n.items() if k[2].startswith('stage_')}, len(steps), alt, sorted(caps)))
    print('P1 (gate)    placements outside the shell / a stair line: %d %s' % (len(outside), outside[:3]))
    print('P2 (gate)    build rows that left the bag under %d reserve stone: %d %s' % (STONE_GUARD, len(reserve_breach), reserve_breach[:3]))
    print('P3 (gate)    plinth pits uncovered > 10 min at the read end: %d %s | pit events %d' % (len(open_pits), open_pits[:3], len(pit_events)))
    print('P4 (gate)    _well_retired at a plinth cap: %d' % len(retired_p))
    print('P5 (gate>1)  stuck/entombed rows within 3 of a plinth: %d %s | INSTRUMENT the same rows anywhere: canary %d control %d'
          % (len(stuck_p), stuck_p[:3], n[('post', 'canary', 'stuck_any')], n[('post', 'control', 'stuck_any')]))
    print('P6 (leak)    control _plinth rows: %d' % leak)
    print('INSTRUMENT   control no_site rows post %d (>= 1: no-well towns exist and the query sees them) | control towns without a well (pre) %s'
          % (n[('post', 'control', 'no_site')], sorted(nowell_ctl)))
    print('PRIMARY      canary towns complete %s | plinth caps with a built well %s | step pace s p50 %s p90 %s'
          % (sorted(complete), built_plinths, paces[len(paces) // 2] if paces else '-', paces[int(len(paces) * 0.9)] if paces else '-'))
    print('             dispose_well successes per bot-h: canary %.3f -> %.3f | control no-well towns %.3f -> %.3f | by canary town %s'
          % (rate('pre', 'canary', 'dispose_success'), rate('post', 'canary', 'dispose_success'),
             rate('pre', 'control', 'dispose_success', nowell_ctl), rate('post', 'control', 'dispose_success', nowell_ctl), dict(disposed)))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
        from readjson import emit
        nanless = lambda v: None if v != v else round(v, 4)
        d_can = rate('post', 'canary', 'dispose_success') - rate('pre', 'canary', 'dispose_success')
        d_ctl = rate('post', 'control', 'dispose_success', nowell_ctl) - rate('pre', 'control', 'dispose_success', nowell_ctl)
        emit('plinthread', W, {
            'rows_canary': rows[('post', 'canary')], 'rows_control': rows[('post', 'control')], 'offbuild_canary': offbuild,
            'licence_rows': n[('post', 'canary', 'licence')], 'steps_canary': len(steps), 'alt_steps': alt,
            'planned_canary': n[('post', 'canary', 'stage_planned')], 'complete_towns': len(complete), 'built_plinths': len(built_plinths),
            'breach_outside_shell': len(outside), 'breach_reserve': len(reserve_breach), 'breach_pit_open_10m': len(open_pits),
            'breach_retired_plinth': len(retired_p), 'breach_stuck_plinth': len(stuck_p), 'control_plinth_rows': leak,
            'instrument_control': n[('post', 'control', 'no_site')],
            'dispose_rate_did': nanless(d_can - d_ctl), 'dispose_success_canary': sum(disposed.values()),
            'exposure_ready': int(len(built_plinths) >= 1 and W >= 180),
        })
    except Exception as e:
        print('emit failed:', e)
