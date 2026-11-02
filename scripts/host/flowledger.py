#!/usr/bin/env python3
"""FLOW LEDGER (flowledger-01; resource-model-1102 §9, docs/reports/resource-management-2026-11-02.md). Tooling: a host read,
nothing on a bot changes. Hourly on the canary host (cron :05). Per town (= pool, 16) it reports STOCK and FLOW, bags counted:

  stock   bags: the latest inventory row of every bot in the window (the RimWorld lesson: bag stock is counted, never left
          out); chests: the town's count journal folded by flowstock.mjs with the bots' own cobblecap.mjs (observed = newest
          count of each container, any age; containers with no count are UNKNOWN, never 0); the yard: the newest `_yard`
          row's `yard=` holdings (no yard rows = no yard on the fleet, said so)
  flow    per item family (cobble = cobblestone + cobbled_deepslate; logs; bamboo; stations) from every top-level skill
          row's `skill.inventory_delta`:
            supply    gains of every skill that is not a transfer (mine, goto, gather, surface, home, ...), by skill
            spend     losses of every skill that is not a transfer or the well (placements, scaffold, crafts, smelts)
            well      dispose_well losses (`_overflow` rows, once towngate-01 writes them, are a SUBSET of these)
            transfers deposit / town_deposit / withdraw* / toolkit / prune_town / yard, and build_shop's draws: internal,
                      they net to zero between bags and chests
            deaths    the `_death` row's inventory (what was dropped) -- INFORMATION: the drop is already inside the dying
                      skill's own delta, so it is never added to the balance
  balance THE POSITIVE CONTROL. Per bot, the bag at the end minus the bag at the start (the first delta row's END snapshot
          minus its delta) must equal the sum of the deltas (between-skill pickups and reflex placements are the residual). Per town the signed residual must be within
          CLOSE_PCT of the town's gross inflow; and fleet-wide the residual must be under half of the NULL residual (the
          same sum with every delta ignored) -- a read that missed the deltas would pass a 10 % test on a quiet bag, never
          this one. A balance that does not close means the READ is broken, not the fleet.
  bags    fill at departure: slots used (ceil(count / stack), ~/stack.json) at the end of every deposit / town_deposit row
          (the bag leaving town), p50 / p75 / at >= 34
  stations crafting tables and furnaces crafted per hour (craft rows whose item is one), and LEFT (a craft / smelt row
          that ended holding fewer than it began: placed and not taken back) -- an estimate of idle bot-placed stations,
          not a world read
  projects build_shop placements per hour and per visit

ALARMS (§9; each a key in ~/digest/ALARMS.log through lib/alarm.py, deduplicated and pushed; and the one line this writes to
~/digest/flowledger.log, which the fleetstatus header prints through alarmhead MONITOR_LOGS -- never a log nobody reads):
  sinks      the well takes more than 50 % of new cobble over 24 h (needs >= 20 hourly slices; fewer is WARMING, said so)
  starved    a town whose counted chest cobble is below LOW (256) in every run of the last 6 h (an unknown count never fires)
  bags       departure p75 above 30 slots in every slice of the last 6 h that had departures (>= 4 of them)
  yard       a yard full (>= YARD_FULL of YARD_CAP) in every run of the last 24 h
  stations   a town with more than 10 stations left (placed, not retaken) over 24 h
  bamboo     bag + yard bamboo growing over 48 h while that town's yard is full
  read       the balance does not close in more than 3 towns, or the fleet control fails

    python3 -B host/flowledger.py run [--window-min 360] [--no-push] [--print] [--out-dir ~/flowledger/out]
    python3 -B host/flowledger.py alarms --history <history.jsonl> [--now ISO]      (re-judge a history; tests)
"""
import argparse
import datetime as dt
import json
import math
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))

UTC = dt.timezone.utc
WINDOW_MIN = 360
SLICE_MIN = 60
CLOSE_PCT = 10.0
CLOSE_MIN_FLOW = 64          # a town with less gross inflow than one stack in the window is too quiet to judge
NULL_RATIO = 0.5             # fleet: residual must be under half of the residual with every delta ignored
READ_BROKEN_TOWNS = 3
LOW_COBBLE = 256             # BUILD_RESERVE.cobblestone (owner 10-23); marks-01 makes it the cobble group's LOW
SINK_SHARE = 0.50
SINK_SLICES = 20
BAG_P75 = 30
BAG_SLICES = 4
YARD_CAP = 304               # stockyard-01: 4 bays x 76 at 1x
YARD_FULL = 0.95
STATIONS_LEFT = 10
FULL_AT = 34
STARVE_H = 6
BAMBOO_H = 48

FAMILIES = {
    'cobble': lambda n: n in ('cobblestone', 'cobbled_deepslate'),
    'logs': lambda n: n.endswith('_log') or n.endswith('_stem'),
    'bamboo': lambda n: n in ('bamboo', 'bamboo_block'),
    'stations': lambda n: n in ('crafting_table', 'furnace'),
}
WEIGHT = {'bamboo_block': 9}          # a bamboo block is 9 bamboo
WELL = {'dispose_well'}
TRANSFER = {'deposit', 'town_deposit', 'withdraw', 'withdraw_pick', 'toolkit', 'prune_town', 'yard', 'take'}
DRAW = {'build_shop'}                 # gains are draws from the town (internal); losses are placements (spend)
STATION_ROWS = {'craft', 'smelt', 'smelt_town', 'make_material'}
DEPART = {'deposit', 'town_deposit'}
BUILD_PLACE = re.compile(r'\bop=place\b.*?\bblock=([a-z_]+)')    # one `_build` row per block a project placed
MEASURED_MIN = 0.5           # the control: at least half the gross inflow must come from MEASURED deltas (not inferred)

HOME = os.path.expanduser('~')
POOLS_DIR = '/var/lib/mcai'
LOGS = '/var/log/mcai/*/skill-*.jsonl*'
CC_PATH = '/opt/minecraft-ai/bots/src/cobblecap.mjs'
OUT_DIR = f'{HOME}/flowledger/out'
DIGEST_LOG = f'{HOME}/digest/flowledger.log'
STATE = f'{HOME}/flowledger/out/alarm-state.json'


# ------------------------------------------------------------------------------------------------ pure helpers
def canon(n):
    return n[1:] if isinstance(n, str) and n.startswith('_') else n


def fam(m, f):
    """How much of family f a {name: n} map holds (bamboo blocks weighted)."""
    test = FAMILIES[f]
    return sum((v if isinstance(v, (int, float)) else 0) * WEIGHT.get(k, 1) for k, v in (m or {}).items() if test(k))


def slots_of(inv, stack):
    s = 0
    for k, v in (inv or {}).items():
        if isinstance(v, (int, float)) and v > 0:
            s += math.ceil(v / max(1, stack.get(k, 64)))
    return s


def pct(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    i = min(len(xs) - 1, max(0, math.ceil(p / 100 * len(xs)) - 1))
    return xs[i]


def norm(raw):
    """A telemetry line (dict) -> the fields this read uses, or None."""
    sk = raw.get('skill') or {}
    if not sk.get('name'):
        return None
    try:
        t = dt.datetime.fromisoformat(str(raw.get('@timestamp', '')).replace('Z', '+00:00'))
    except ValueError:
        return None
    b = raw.get('bot') or {}
    return {'t': t, 'name': canon(sk['name']), 'top': not str(sk['name']).startswith('_'), 'bot': b.get('name'), 'pool': (raw.get('exp') or {}).get('pool'),
            'inv': b.get('inventory') if isinstance(b.get('inventory'), dict) else None,
            'delta': sk.get('inventory_delta') if isinstance(sk.get('inventory_delta'), dict) else None,
            'status': sk.get('status'), 'args': sk.get('args') or {}, 'detail': sk.get('detail') or ''}


def infer_deltas(rows):
    """PURE, in place. A TOP-LEVEL skill row (its kind has no leading underscore) that carries an inventory but no
    inventory_delta (MEASURED 11-02: 3,821 goto and 2,783 gather rows in 6 h -- failed or aborted runs, which still placed
    scaffold or picked up blocks) gets the bag change since the bot's previous top-level row as its delta, marked
    `inferred`. Without it those placements sat in the balance's residual (goto alone -152 of the fleet's -338 unexplained
    between delta rows). -> the number inferred."""
    by = defaultdict(list)
    for r in rows:
        if r.get('top') and r['bot'] and r['inv'] is not None:
            by[r['bot']].append(r)
    n = 0
    for rs in by.values():
        rs.sort(key=lambda r: r['t'])
        prev = None
        for r in rs:
            if r['delta'] is None and prev is not None:
                keys = set(r['inv']) | set(prev)
                d = {k: (r['inv'].get(k, 0) or 0) - (prev.get(k, 0) or 0) for k in keys}
                r['delta'] = {k: v for k, v in d.items() if isinstance(v, (int, float)) and v}
                r['inferred'] = True
                n += 1
            prev = r['inv']
    return n


def flows(rows, since=None):
    """PURE. rows: normalized rows. -> {pool: {family: {...}}} for rows with t >= since (all when None)."""
    P = defaultdict(lambda: {f: {'supply': Counter(), 'spend': Counter(), 'well': 0, 'banked': 0, 'withdrawn': 0,
                                 'drawn': 0, 'deaths': 0} for f in FAMILIES})
    extra = defaultdict(lambda: {'crafted_stations': 0, 'left_stations': 0, 'build_placed': 0, 'build_visits': 0,
                                 'departures': []})
    for r in rows:
        if since is not None and r['t'] < since:
            continue
        p = r['pool']
        if r['name'] == 'death' and r['inv']:
            for f in FAMILIES:
                P[p][f]['deaths'] += fam(r['inv'], f)
            continue
        if r['name'] == 'build':
            m = BUILD_PLACE.search(r['detail'])
            if m and r['status'] != 'failed':
                for f in FAMILIES:
                    if FAMILIES[f](m.group(1)):
                        P[p][f]['spend']['build_shop'] += 1
                        P[p][f]['drawn'] += 1    # the block came out of the bag: the visit's net draw was this much larger
                extra[p]['build_placed'] += 1
            continue
        d = r['delta']
        if d is None:
            continue
        for f in FAMILIES:
            v = fam(d, f)
            if not v:
                continue
            x = P[p][f]
            if r['name'] in WELL:
                if v < 0:
                    x['well'] += -v
                else:
                    x['supply'][r['name']] += v
            elif r['name'] in TRANSFER:
                if v < 0:
                    x['banked'] += -v
                else:
                    x['withdrawn'] += v
            elif r['name'] in DRAW:
                x['drawn'] += v          # NET town -> bag (draws minus the bank-back); its placements are the `_build` rows
            elif v > 0:
                x['supply'][r['name']] += v
            else:
                x['spend'][r['name']] += -v
        e = extra[p]
        if r['name'] == 'craft' and r['status'] == 'success' and str(r['args'].get('item')) in ('crafting_table', 'furnace'):
            e['crafted_stations'] += int(r['args'].get('count') or 1)
        if r['name'] in STATION_ROWS and fam(d, 'stations') < 0:
            e['left_stations'] += -fam(d, 'stations')
        if r['name'] == 'build_shop':
            e['build_visits'] += 1
    return P, extra


def balance(rows, f='cobble'):
    """PURE. THE POSITIVE CONTROL. Per bot over its delta rows: residual = (end bag - start bag) - sum(deltas), where
    start = the first delta row's END snapshot minus its delta. -> {pool: {res, null, gross, deaths, bots}}. MEASURED 11-02:
    a death's drop is ALREADY inside the dying skill's delta (adding the `_death` row's inventory made the residual
    +1,214 of 1,943 in placebo-b, = its 1,192 dropped), so deaths are reported, never added."""
    by = defaultdict(list)
    for r in rows:
        if r['bot'] and (r['delta'] is not None and r['inv'] is not None or r['name'] == 'death'):
            by[r['bot']].append(r)
    out = defaultdict(lambda: {'res': 0, 'null': 0, 'gross': 0, 'gross_measured': 0, 'deaths': 0, 'bots': 0, 'abs_res': 0})
    for bot, rs in by.items():
        rs.sort(key=lambda r: r['t'])
        dr = [r for r in rs if r['delta'] is not None and r['inv'] is not None]
        if not dr:
            continue
        t0, t1 = dr[0]['t'], dr[-1]['t']
        start = fam(dr[0]['inv'], f) - fam(dr[0]['delta'], f)
        end = fam(dr[-1]['inv'], f)
        sd = sum(fam(r['delta'], f) for r in dr)
        deaths = sum(fam(r['inv'], f) for r in rs if r['name'] == 'death' and r['inv'] and t0 < r['t'] < t1)
        res = (end - start) - sd
        o = out[dr[-1]['pool']]
        o['res'] += res
        o['abs_res'] += abs(res)
        o['null'] += abs(end - start)
        o['gross'] += sum(max(0, fam(r['delta'], f)) for r in dr)
        o['gross_measured'] += sum(max(0, fam(r['delta'], f)) for r in dr if not r.get('inferred'))
        o['deaths'] += deaths
        o['bots'] += 1
    return dict(out)


def closure(bal, close_pct=CLOSE_PCT, min_flow=CLOSE_MIN_FLOW, null_ratio=NULL_RATIO, measured_min=MEASURED_MIN):
    """PURE. -> (per-town {pool: 'closes'|'OPEN'|'quiet'}, fleet control dict). An INFERRED delta (infer_deltas) closes the
    balance by construction, so a town closes only when MEASURED deltas carry at least `measured_min` of its gross inflow
    (Codex r1 BLOCKER: with every delta field removed the balance closed on inferred rows alone)."""
    towns = {}
    share = lambda o: (o.get('gross_measured', 0) / o['gross']) if o['gross'] else 0
    for p, o in bal.items():
        if o['gross'] < min_flow:
            towns[p] = 'quiet'
        else:
            towns[p] = 'closes' if abs(o['res']) <= close_pct / 100 * o['gross'] and share(o) >= measured_min else 'OPEN'
    ar = sum(o['abs_res'] for o in bal.values())
    nl = sum(o['null'] for o in bal.values())
    g = sum(o['gross'] for o in bal.values())
    gm = sum(o.get('gross_measured', 0) for o in bal.values())
    ms = gm / g if g else 0
    ctl = {'abs_res': ar, 'null': nl, 'gross': g, 'measured_share': round(ms, 3),
           'ok': nl > 0 and ar <= null_ratio * nl and ms >= measured_min}
    return towns, ctl


def latest_inv(rows):
    """PURE. -> {bot: (pool, inv)} from the newest row with an inventory."""
    last = {}
    for r in rows:
        if r['bot'] and r['inv'] is not None and (r['bot'] not in last or r['t'] >= last[r['bot']][0]):
            last[r['bot']] = (r['t'], r['pool'], r['inv'])
    return {b: (p, inv) for b, (_, p, inv) in last.items()}


YARD_RE = re.compile(r'\byard=(\S+)')


def yard_held(rows):
    """PURE. -> {pool: {name: n}} from the newest `_yard` row per pool (no row = no yard)."""
    last = {}
    for r in rows:
        if r['name'] == 'yard':
            m = YARD_RE.search(r['detail'])
            if m and (r['pool'] not in last or r['t'] >= last[r['pool']][0]):
                held = {}
                for part in m.group(1).split(','):
                    k, _, v = part.partition(':')
                    if v.isdigit():
                        held[k] = held.get(k, 0) + int(v)
                last[r['pool']] = (r['t'], held)
    return {p: h for p, (_, h) in last.items()}


# ------------------------------------------------------------------------------------------------ the alarms (pure)
def _iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def _ts(s):
    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))


def spaced(H, gap=dt.timedelta(minutes=50)):
    """PURE. Runs at least `gap` apart, newest kept: each run's slice is its LAST hour, so two runs minutes apart (a hand run
    beside the cron) would count one hour twice."""
    out = []
    for h in reversed(H):
        if not out or _ts(out[-1]['ts']) - _ts(h['ts']) >= gap:
            out.append(h)
    return out[::-1]


def judge(history, now):
    """PURE. history: run records (oldest first) as `run` appends them. -> (active {key: line}, notes [str]).
    Each alarm needs its own evidence span; too little history is a NOTE (said), never a quiet pass."""
    H = spaced(sorted((h for h in history if h.get('ts')), key=lambda h: h['ts']))
    active, notes = {}, []
    if not H:
        return {'read:no-history': 'flowledger has no history at all: the read has never run'}, notes
    cur = H[-1]
    within = lambda hours: [h for h in H if now - _ts(h['ts']) <= dt.timedelta(hours=hours, minutes=10)]

    # read broken (this run)
    open_towns = [p for p, s in (cur.get('closure') or {}).items() if s == 'OPEN']
    if len(open_towns) > READ_BROKEN_TOWNS or not (cur.get('control') or {}).get('ok'):
        active['read:balance'] = (f"flow balance does not close: {len(open_towns)} town(s) OPEN ({', '.join(sorted(open_towns)[:6])})"
                                  f"; fleet control residual {cur.get('control', {}).get('abs_res')} vs null {cur.get('control', {}).get('null')}"
                                  ' -- the READ is broken, not the fleet')

    # sinks too small: 24 h of hourly slices
    s24 = within(24)
    sl = [h['slice'] for h in s24 if h.get('slice')]
    if len(sl) >= SINK_SLICES:
        sup = sum(s['cobble_supply'] for s in sl)
        well = sum(s['cobble_well'] for s in sl)
        share = well / sup if sup else 0
        if sup and share > SINK_SHARE:
            active['sinks'] = f'sinks too small: the well took {share:.0%} of new cobble over 24 h ({well:,} of {sup:,}; {len(sl)} hourly slices)'
    else:
        notes.append(f'sinks: WARMING ({len(sl)} of {SINK_SLICES} hourly slices in 24 h)')

    # starved: every run of the last 6 h below LOW, counted
    s6 = within(STARVE_H)
    if len(s6) >= STARVE_H - 1 and now - _ts(s6[0]['ts']) >= dt.timedelta(hours=STARVE_H - 0.6):
        pools = set((cur.get('chests') or {}).keys())
        for p in sorted(pools):
            seq = [(h.get('chests') or {}).get(p) for h in s6]
            if all(c is not None and c.get('uncounted', 1) == 0 and c.get('counted', 0) > 0 and c.get('observed', 0) < LOW_COBBLE for c in seq):
                active[f'starved:{p}'] = f'{p} starved: chest cobble below LOW {LOW_COBBLE} for {STARVE_H} h (now {seq[-1]["observed"]})'
    else:
        notes.append(f'starved: WARMING ({len(s6)} runs in {STARVE_H} h)')

    # bags at departure
    p75s = [h['slice'].get('depart_p75') for h in s6 if h.get('slice') and h['slice'].get('depart_n')]
    if len(p75s) >= BAG_SLICES:
        if all(x is not None and x > BAG_P75 for x in p75s):
            active['bags'] = f'bags: departure p75 above {BAG_P75} slots in all {len(p75s)} hourly slices of {STARVE_H} h (now {p75s[-1]})'
    else:
        notes.append(f'bags: WARMING ({len(p75s)} of {BAG_SLICES} slices with departures in {STARVE_H} h)')

    # yard full 24 h; bamboo growing 48 h with the yard full
    yards = cur.get('yard') or {}
    if not yards:
        notes.append('yard: no `_yard` rows (no yard on the fleet)')
    for p in sorted(yards):
        seq = [(h.get('yard') or {}).get(p) for h in s24]
        if len(s24) >= SINK_SLICES and all(y is not None and y >= YARD_FULL * YARD_CAP for y in seq):
            active[f'yard:{p}'] = f'{p} yard full for 24 h ({seq[-1]} of {YARD_CAP})'
            s48 = within(BAMBOO_H)
            bam = [(h.get('bamboo') or {}).get(p) for h in s48]
            if now - _ts(s48[0]['ts']) >= dt.timedelta(hours=BAMBOO_H - 1) and None not in bam and bam[-1] > bam[0]:
                active[f'bamboo:{p}'] = f'{p} bamboo (bags + yard) grew {bam[0]} -> {bam[-1]} over 48 h with the yard full: owner decides a sink or the well'

    # stations left behind, 24 h
    left = Counter()
    for h in s24:
        for p, n in ((h.get('slice') or {}).get('left_stations') or {}).items():
            left[p] += n
    for p, n in sorted(left.items()):
        if n > STATIONS_LEFT:
            active[f'stations:{p}'] = f'{p}: {n} crafting tables/furnaces placed and not retaken in 24 h (estimate from craft/smelt deltas)'
    return active, notes


# ------------------------------------------------------------------------------------------------ the run (impure)
# The fleet line's telemetry.py (predates_window: the size cap counts only files in the window) is the one that can walk 6 h
# on this host; main's copy refuses (WalkTooWide on ~22 GB of rotated history, 11-02). Loaded by path from the live tree.
TELEMETRY = '/opt/minecraft-ai/scripts/lib/telemetry.py'


def load_rows(window_min, paths=LOGS, telemetry=TELEMETRY):
    import importlib.util
    spec = importlib.util.spec_from_file_location('fl_telemetry', telemetry)
    tm = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(tm)
    Events = tm.Events
    ev = Events.load(paths=paths, since_minutes=window_min)
    rows = [x for x in (norm(r['raw']) for r in ev.rows) if x]
    proof_inferred = infer_deltas(rows)
    # positive control on the names this read depends on (ZeroLooksWrong when the window is empty or a name is off)
    proof = {n: ev.count(n) for n in ('mine', 'town_deposit', 'dispose_well', 'build_shop')}
    proof['inferred_delta_rows'] = proof_inferred
    proof['delta_rows'] = sum(1 for r in rows if r['delta'] is not None and not r.get('inferred'))
    return rows, proof, ev


def chest_stock(now, pools, cc=CC_PATH, pools_dir=POOLS_DIR):
    dirs = [os.path.join(pools_dir, f'_pool-{p}') for p in sorted(pools) if p]
    r = subprocess.run(['node', os.path.join(HERE, 'flowstock.mjs'), cc, str(int(now.timestamp() * 1000)), *dirs],
                       capture_output=True, text=True, timeout=600)
    if r.returncode:
        raise RuntimeError(f'flowstock.mjs rc={r.returncode}: {r.stderr.strip()[-200:]}')
    return json.loads(r.stdout)


def build(rows, proof, now, window_min, stack, stock):
    since = min(r['t'] for r in rows)
    pools = sorted({r['pool'] for r in rows if r['pool']})
    P, extra = flows(rows)
    PS, XS = flows(rows, since=now - dt.timedelta(minutes=SLICE_MIN))
    bal = balance(rows)
    towns, ctl = closure(bal)
    inv = latest_inv(rows)
    bags = defaultdict(Counter)
    for b, (p, i) in inv.items():
        for f in FAMILIES:
            bags[p][f] += fam(i, f)
        bags[p]['bots'] += 1
    dep_all = [slots_of(r['inv'], stack) for r in rows if r['name'] in DEPART and r['inv'] is not None]
    dep_slice = [slots_of(r['inv'], stack) for r in rows if r['name'] in DEPART and r['inv'] is not None
                 and r['t'] >= now - dt.timedelta(minutes=SLICE_MIN)]
    chests = {}
    for p in pools:
        t = (stock.get('towns') or {}).get(f'_pool-{p}')
        chests[p] = (t or {}).get('groups', {}).get('cobble') if t else None
    yard_items = yard_held(rows)
    yard = {p: sum(h.values()) for p, h in yard_items.items()}      # blocks in the bays (the alarm's fullness)
    sup = lambda X, f='cobble': sum(sum(X[p][f]['supply'].values()) for p in X)
    rec = {
        'ts': _iso(now), 'window_min': window_min, 'since': _iso(since), 'rows': len(rows),
        'bots': len({r['bot'] for r in rows if r['bot']}), 'proof': proof, 'pools': pools,
        'closure': towns, 'control': ctl,
        'balance': {p: dict(v) for p, v in bal.items()},
        'flows': {p: {f: {k: (dict(v) if isinstance(v, Counter) else v) for k, v in P[p][f].items()} for f in FAMILIES} for p in pools},
        'extra': {p: {k: v for k, v in extra[p].items() if k != 'departures'} for p in pools},
        'bags': {p: dict(bags[p]) for p in pools},
        'chests': chests, 'chests_unreadable': stock.get('unreadable') or [],
        'chest_groups': {p: ((stock.get('towns') or {}).get(f'_pool-{p}') or {}).get('groups') for p in pools},
        'yard': yard, 'yard_items': yard_items,
        # bags + the yard's bamboo blocks (9 bamboo each; Codex r1 BLOCKER: the yard was left out of the bamboo alarm)
        'bamboo': {p: bags[p]['bamboo'] + fam(yard_items.get(p) or {}, 'bamboo') for p in pools},
        'depart': {'n': len(dep_all), 'p50': pct(dep_all, 50), 'p75': pct(dep_all, 75), 'ge34': sum(x >= FULL_AT for x in dep_all)},
        'slice': {'cobble_supply': sup(PS), 'cobble_well': sum(PS[p]['cobble']['well'] for p in PS),
                  'left_stations': {p: XS[p]['left_stations'] for p in XS if XS[p]['left_stations']},
                  'crafted_stations': sum(XS[p]['crafted_stations'] for p in XS),
                  'depart_n': len(dep_slice), 'depart_p75': pct(dep_slice, 75)},
        'window_totals': {'cobble_supply': sup(P), 'cobble_well': sum(P[p]['cobble']['well'] for p in P),
                          'cobble_spend': sum(sum(P[p]['cobble']['spend'].values()) for p in P),
                          'cobble_banked': sum(P[p]['cobble']['banked'] for p in P),
                          'cobble_deaths': sum(P[p]['cobble']['deaths'] for p in P),
                          'build_placed': sum(extra[p]['build_placed'] for p in pools),
                          'build_visits': sum(extra[p]['build_visits'] for p in pools),
                          'crafted_stations': sum(extra[p]['crafted_stations'] for p in pools),
                          'left_stations': sum(extra[p]['left_stations'] for p in pools)},
    }
    return rec


def summary_line(rec, active, notes):
    w = rec['window_totals']
    cl = rec['closure']
    n_close = sum(1 for s in cl.values() if s == 'closes')
    n_judged = sum(1 for s in cl.values() if s != 'quiet')
    bag_c = sum(v.get('cobble', 0) for v in rec['bags'].values())
    ch = [c for c in rec['chests'].values() if c]
    ch_c = sum(c['observed'] for c in ch)
    ch_unk = sum(1 for c in rec['chests'].values() if not c or c.get('uncounted'))
    share = w['cobble_well'] / w['cobble_supply'] if w['cobble_supply'] else 0
    ctl = rec['control']
    head = f'{rec["ts"]} flowledger'
    status = (f'ALARMS {len(active)}: ' + '; '.join(v for _, v in sorted(active.items()))[:300]) if active else 'OK'
    return (f'{head} {status} | {rec["window_min"] // 60} h, {rec["rows"]:,} rows, {rec["bots"]} bots, {len(rec["pools"])} towns | '
            f'cobble new {w["cobble_supply"]:,}, well {w["cobble_well"]:,} ({share:.0%}), spent {w["cobble_spend"]:,}, banked '
            f'{w["cobble_banked"]:,}, deaths {w["cobble_deaths"]:,} | stock: bags {bag_c:,}, chests {ch_c:,} '
            f'({len(ch) - ch_unk} of {len(rec["chests"])} towns fully counted) | balance closes {n_close}/{n_judged} towns '
            f'(control: residual {ctl["abs_res"]:,} vs null {ctl["null"]:,} of {ctl["gross"]:,} in, {ctl["measured_share"]:.0%} measured) | departures {rec["depart"]["n"]}: '
            f'p50 {rec["depart"]["p50"]} p75 {rec["depart"]["p75"]} at>=34 {rec["depart"]["ge34"]} | stations crafted '
            f'{w["crafted_stations"]}, left {w["left_stations"]} | build_shop placed {w["build_placed"]:,} in {w["build_visits"]} visits'
            + (f' | {"; ".join(notes)}' if notes else ''))


def read_history(path, keep_h=72, now=None):
    out = []
    try:
        for line in open(path):
            try:
                out.append(json.loads(line))
            except ValueError:
                pass
    except OSError:
        pass
    if now is not None:
        out = [h for h in out if h.get('ts') and now - _ts(h['ts']) <= dt.timedelta(hours=keep_h)]
    return out


def cmd_run(a):
    from lib import alarm as AL
    now = dt.datetime.now(UTC).replace(microsecond=0)
    od = os.path.expanduser(a.out_dir)
    os.makedirs(od, exist_ok=True)
    hist_path = os.path.join(od, 'history.jsonl')
    try:
        stack = json.load(open(os.path.expanduser(a.stack)))
    except (OSError, ValueError):
        stack = {}
    try:
        rows, proof, _ = load_rows(a.window_min)
        stock = chest_stock(now, {r['pool'] for r in rows if r['pool']}, a.cc, a.pools_dir)
        rec = build(rows, proof, now, a.window_min, stack, stock)
    except Exception as e:  # noqa: BLE001 -- a failed read is an alarm line, never silence
        line = f'{_iso(now)} flowledger ERROR {type(e).__name__}: {str(e)[:200]}'
        with open(os.path.expanduser(a.digest_log), 'a') as f:
            f.write(line + '\n')
        if not a.no_push:
            AL.raise_alarms('flowledger', {'read:error': line}, now, a.state, push=True)
        print(line)
        return 1
    hist = read_history(hist_path, now=now)
    small = {k: rec[k] for k in ('ts', 'closure', 'control', 'chests', 'yard', 'bamboo', 'slice', 'bags')}
    hist.append(small)
    active, notes = judge(hist, now)
    line = summary_line(rec, active, notes)
    rec['alarms'], rec['notes'], rec['line'] = active, notes, line
    AL.write_json_atomic(os.path.join(od, 'latest.json'), rec)
    with open(hist_path, 'a') as f:
        f.write(json.dumps(small, sort_keys=True, default=str) + '\n')
    tmp = hist_path + '.tmp'                     # keep 72 h
    with open(tmp, 'w') as f:
        for h in hist:
            f.write(json.dumps(h, sort_keys=True, default=str) + '\n')
    os.replace(tmp, hist_path)
    with open(os.path.expanduser(a.digest_log), 'a') as f:
        f.write(line + '\n')
    AL.raise_alarms('flowledger', active, now, a.state, push=not a.no_push)
    if a.print:
        print(line)
        for p in rec['pools']:
            b, c = rec['balance'].get(p, {}), rec['chests'].get(p)
            fl = rec['flows'][p]['cobble']
            print(f'  {p:<12} bags {rec["bags"][p].get("cobble", 0):>6}  chests '
                  f'{(str(c["observed"]) + ("?" if c.get("uncounted") else "")) if c else "unread":>7}  new {sum(fl["supply"].values()):>6}'
                  f'  well {fl["well"]:>5}  spent {sum(fl["spend"].values()):>5}  banked {fl["banked"]:>5}  drawn {fl["drawn"]:>5}'
                  f'  deaths {fl["deaths"]:>4}  residual {b.get("res", 0):>5} of {b.get("gross", 0):>6} in -> {rec["closure"].get(p)}')
    return 0


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    r = sub.add_parser('run')
    r.add_argument('--window-min', type=int, default=WINDOW_MIN)
    r.add_argument('--out-dir', default=OUT_DIR)
    r.add_argument('--digest-log', default=DIGEST_LOG)
    r.add_argument('--state', default=STATE)
    r.add_argument('--stack', default='~/stack.json')
    r.add_argument('--cc', default=CC_PATH)
    r.add_argument('--pools-dir', default=POOLS_DIR)
    r.add_argument('--no-push', action='store_true')
    r.add_argument('--print', action='store_true')
    j = sub.add_parser('alarms')
    j.add_argument('--history', required=True)
    j.add_argument('--now')
    a = ap.parse_args()
    if a.cmd == 'run':
        sys.exit(cmd_run(a))
    now = _ts(a.now) if a.now else dt.datetime.now(UTC)
    active, notes = judge(read_history(a.history), now)
    print(json.dumps({'active': active, 'notes': notes}, indent=1))


if __name__ == '__main__':
    main()
