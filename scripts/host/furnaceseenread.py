#!/usr/bin/env python3
# furnaceseenread.py [window_min] -- the read for canary `furnaceseen-01` (cooperation tier B3; docs/reports/cooperation-tier-
# 2026-10-23.md 6.3 B3 and 6.4). THE CHANGE: the furnace drain skips the walk to a furnace a TOWNMATE found empty < 60 min ago
# (the town ledger's newest `station` entry, ledger-01), unless newer contrary evidence exists (a newer entry that holds items or
# is lit -- a load --, this bot's own later look that found items, or this bot's own sighting of it lit). The order path and the
# skill's re-pick share one pick (skills.mjs drainPickNow), so a skipped furnace is never ordered and then refused.
# Run under `nice`. CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits). `--selftest` runs the fixtures;
# `--golden <path>` also checks the port against bots/test/fixtures/seenskip-golden.json (the JS function's own table).
#
# ROWS:
#   _furnace_seen_skip  f= why= now= se=<entry id> sl=<lit-seen ms|-> so=<e|h>:<ms>|- off=<gen>:<bytes>   (one per furnace and
#                       entry skipped: the LICENCE, a kind the base cannot write)
#   _furnace_seen_mode  once per spawn: phase=mode on=on|off ...
#   _furnace_drain      stop= furnace= ... t0= ledger= se= sl= so= off=   (the inputs the pick relied on for the furnace it walked to)
#   _ledger_station     id= f= phase= by= state= outcome= ... at=          (ledger-01: the entries the inputs name)
#   _furnace_session    furnace= ... by=smelt|smelt_town               (a load between two empty findings)
#
#   D1 (defect) `d1_defects`: THE SAME FUNCTION REPLAYED on the logged inputs (seen_skip is a port of smeltjob.mjs seenSkip,
#       bound to the JS function by the golden table): a canary drain that WALKED to a furnace whose logged inputs say skip, or
#       a skip row whose logged inputs say walk. An input naming an entry the read cannot find is UNRESOLVED (reported, not
#       counted). Reported, not counted: walks where a valid townmate empty existed that the fold had not read when it picked
#       (an append racing the pick: `raced_walks`), and walks the lit-seen evidence released (`lit_released`).
#   EFFECT (REVERT, no evidence class: blocks KEEP) `r_lb_minus_bar` >= 0: R = (control's change in repeat empty drains per
#       bot-h) - (canary's change), positive = fewer repeats on the canary; its lower bound by RANDOMIZATION over towns (every
#       relabelling of the pools; the shift-inverted one-sided bound at alpha 0.025 = Bonferroni over the k = 2 reads that can
#       KEEP, +180 and the final) minus the bar 0.25 x the canary pools' pre-period repeat rate. Undefined (a pool with no
#       bot-hours, no control pool) is None: UNREADABLE, never a pass.
#       A REPEAT EMPTY DRAIN: a drain with stop=empty on furnace F by bot b when another bot's drain found F empty < 60 min
#       before with no load on F between (a smelt / smelt_town furnace session on F, or a ledger load record).
#   ARMS      control `_furnace_seen_skip` / `_furnace_seen_mode` rows after the deploy (BLOCKS KEEP).
#   LIVENESS  canary `_furnace_seen_mode on=on` >= 1 and canary `_furnace_drain` >= 1.
#   POSITIVE CONTROL  control repeat empty drains in the window >= 1 (the instrument that sees the thing the change removes)
#             and control `_ledger_station` rows >= 1 (ledger-01 is on the fleet).
#   EXPOSURE  `skipped_walks` = canary skip rows (distinct furnace x entry) -- registered min 20.
#   REPORT    drain bot-time per bot-h, DiD, by stop class (empty / drained / unreachable / lit / busy / other), so the saving is
#             measured, not inferred from R; the unreachable loop is its own class (design 6.4, Claude r9 #6).
import sys, os, re, json, glob, itertools
import datetime as dt
from collections import Counter, defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')

SEEN_EMPTY_MS = 60 * 60 * 1000
ALPHA = 0.025                 # one-sided, Bonferroni over the k = 2 reads that can KEEP
BAR_SHARE = 0.25
REPEAT_MS = 60 * 60 * 1000
STOP_CLASSES = ('empty', 'drained', 'unreachable', 'lit', 'busy')


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def fields(detail):
    """PURE. 'k=v k=v ...' -> {k: v}."""
    out = {}
    for tok in (detail or '').split():
        if '=' in tok:
            k, v = tok.split('=', 1)
            out[k] = v
    return out


def num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def seen_skip(entry=None, litAt=None, own=None, me=None, now=0):
    """PURE. The port of smeltjob.mjs seenSkip (bound to it by the golden table). -> {'skip': bool, 'why': str}."""
    if not entry:
        return {'skip': False, 'why': 'no_entry'}
    if entry.get('state') != 'empty':
        return {'skip': False, 'why': 'entry_not_empty'}
    if not entry.get('bot') or entry.get('bot') == me:
        return {'skip': False, 'why': 'own_entry'}
    at = entry.get('at')
    if not isinstance(at, (int, float)) or not (now - at < SEEN_EMPTY_MS) or at > now + 60_000:
        return {'skip': False, 'why': 'expired'}
    if litAt is not None and litAt >= at:
        return {'skip': False, 'why': 'lit_since'}
    if own and not own.get('empty') and isinstance(own.get('at'), (int, float)) and own['at'] >= at:
        return {'skip': False, 'why': 'own_newer_holds'}
    return {'skip': True, 'why': 'townmate_empty'}


def logged_inputs(f, entries):
    """PURE. A row's se= sl= so= fields + {entry id: {at, bot, state}} -> (inputs, resolved). An entry id the read cannot find
    is unresolved (None): the replay is not possible, never a guess."""
    se = f.get('se', '-')
    entry = None
    if se not in ('-', None):
        entry = entries.get(se)
        if entry is None:
            return None, False
    sl = num(f.get('sl'))
    so = f.get('so', '-')
    own = None
    if so not in ('-', None) and ':' in so:
        e, at = so.split(':', 1)
        own = {'empty': e == 'e', 'at': num(at)}
    return {'entry': entry, 'litAt': sl, 'own': own}, True


def d1_check(drains, skips, entries):
    """PURE. drains / skips [(t_ms, bot, f)] -> {defects, unresolved, walks_replayed, skips_replayed}. A walk whose logged
    inputs replay to skip, or a skip whose inputs replay to walk, is a defect."""
    defects, unresolved, wr, sr = [], 0, 0, 0
    for t, b, f in drains:
        if 'se' not in f:
            continue
        inp, ok = logged_inputs(f, entries)
        if not ok:
            unresolved += 1; continue
        wr += 1
        now = num(f.get('t0')) or t
        if seen_skip(**inp, me=b, now=now)['skip']:
            defects.append(('walked_a_skip', b, f.get('furnace'), f.get('se')))
    for t, b, f in skips:
        inp, ok = logged_inputs(f, entries)
        if not ok:
            unresolved += 1; continue
        sr += 1
        d = seen_skip(**inp, me=b, now=num(f.get('now')) or t)
        if not d['skip']:
            defects.append(('skipped_a_walk', b, f.get('f'), d['why']))
    return {'defects': defects, 'unresolved': unresolved, 'walks_replayed': wr, 'skips_replayed': sr}


def repeat_empties(drains, loads):
    """PURE. drains [(t_ms, bot, furnace, stop)] of ONE pool, loads [(t_ms, furnace)] -> the drains with stop=empty that
    repeat ANOTHER bot's empty finding on the same furnace < REPEAT_MS earlier with no load between."""
    last = {}
    loads_by = defaultdict(list)
    for t, f in loads:
        loads_by[f].append(t)
    n = 0
    for t, b, f, stop in sorted(drains):
        if stop != 'empty':
            continue
        e = last.get(f)
        if e and e[1] != b and t - e[0] < REPEAT_MS and not any(e[0] < tl < t for tl in loads_by[f]):
            n += 1
        last[f] = (t, b)
    return n


def lower_bound(can, ctl, alpha=ALPHA):
    """PURE. Canary and control per-pool CHANGES (post - pre repeat rate per bot-h) -> (R, lower bound) with
    R = mean(ctl) - mean(can). The bound inverts the randomization test of H0: R = r0 (canary changes shifted by r0 are
    exchangeable with the control's) over EVERY relabelling: the smallest r0 whose one-sided p > alpha. None when undefined."""
    if not can or not ctl or any(x is None or x != x for x in can + ctl):
        return None, None
    m = lambda xs: sum(xs) / len(xs)
    R = m(ctl) - m(can)
    k = len(can)
    def p_at(r0):
        vals = [x + r0 for x in can] + list(ctl)
        tobs = R - r0
        n = len(vals)
        tot = sum(vals)
        ge = cnt = 0
        for idx in itertools.combinations(range(n), k):
            s_can = sum(vals[i] for i in idx)
            t = (tot - s_can) / (n - k) - s_can / k
            ge += t >= tobs - 1e-12
            cnt += 1
        return ge / cnt
    spread = max(abs(x) for x in can + ctl) + abs(R) + 1e-9
    lo, hi = R - 10 * spread, R
    if p_at(lo) > alpha:
        return R, lo
    for _ in range(60):
        mid = (lo + hi) / 2
        if p_at(mid) > alpha:
            hi = mid
        else:
            lo = mid
    return R, hi


def stop_class(stop):
    """PURE. A drain's stop -> its report class."""
    s = stop or ''
    if s in ('empty', 'drained', 'unreachable', 'lit', 'busy'):
        return s
    return 'drained' if s.startswith('drain_') else 'other'


# ---- fixtures ----------------------------------------------------------------------------------------------------------------
NOW = 1792843200000
E = lambda **o: dict({'id': 'mate-1', 'at': NOW - 600_000, 'bot': 'Mate', 'state': 'empty'}, **o)
assert seen_skip(E(), me='Me', now=NOW) == {'skip': True, 'why': 'townmate_empty'}
assert seen_skip(E(), litAt=NOW - 300_000, me='Me', now=NOW)['why'] == 'lit_since'
assert seen_skip(E(at=NOW - SEEN_EMPTY_MS), me='Me', now=NOW)['why'] == 'expired'
# D1: a walk whose inputs say skip is a defect; a lit-released walk is not; an unresolvable entry is reported
_ent = {'mate-1': {'at': NOW - 600_000, 'bot': 'Mate', 'state': 'empty'}}
_walk = lambda **o: fields(' '.join(f'{k}={v}' for k, v in dict({'stop': 'empty', 'furnace': '1,64,1', 't0': NOW, 'se': 'mate-1', 'sl': '-', 'so': '-', 'off': '1:99'}, **o).items()))
assert d1_check([(NOW, 'Me', _walk())], [], _ent)['defects'][0][0] == 'walked_a_skip'
assert d1_check([(NOW, 'Me', _walk(sl=NOW - 300_000))], [], _ent)['defects'] == []
assert d1_check([(NOW, 'Me', _walk(se='zz'))], [], _ent)['unresolved'] == 1
assert d1_check([(NOW, 'Me', _walk(se='-'))], [], _ent)['defects'] == []
_skip = lambda **o: fields(' '.join(f'{k}={v}' for k, v in dict({'f': '1,64,1', 'why': 'townmate_empty', 'now': NOW, 'se': 'mate-1', 'sl': '-', 'so': '-', 'off': '1:99'}, **o).items()))
assert d1_check([], [(NOW, 'Me', _skip())], _ent)['defects'] == []
assert d1_check([], [(NOW, 'Mate', _skip())], _ent)['defects'][0][0] == 'skipped_a_walk', 'its own entry: never a skip'
# repeats: B after A within 60 min, no load between -> 1; a load between -> 0; the same bot -> 0; older than 60 min -> 0
_dr = [(0, 'A', 'F', 'empty'), (60_000, 'B', 'F', 'empty')]
assert repeat_empties(_dr, []) == 1 and repeat_empties(_dr, [(30_000, 'F')]) == 0
assert repeat_empties([(0, 'A', 'F', 'empty'), (60_000, 'A', 'F', 'empty')], []) == 0
assert repeat_empties([(0, 'A', 'F', 'empty'), (REPEAT_MS, 'B', 'F', 'empty')], []) == 0
# THE EFFECT LINE, the four fixtures: improvement, no change, worsening, undefined
_ctl = [0.10, -0.05, 0.02, 0.0, 0.08, -0.03, 0.04, 0.01, -0.02, 0.05, 0.0, 0.03]
R1, lb1 = lower_bound([-1.2, -1.0, -1.4, -1.1], _ctl)          # improvement: the canary's repeats fell by ~1.2/bot-h
assert R1 > 1.0 and lb1 > 0.25, (R1, lb1)
R2, lb2 = lower_bound([0.02, -0.01, 0.04, 0.0], _ctl)         # no change
assert abs(R2) < 0.05 and lb2 < 0
R3, lb3 = lower_bound([0.9, 1.1, 0.8, 1.0], _ctl)             # worsening
assert R3 < -0.5 and lb3 < R3
assert lower_bound([], _ctl) == (None, None) and lower_bound([0.1, None, 0, 0], _ctl) == (None, None)
assert stop_class('drain_left') == 'drained' and stop_class('no_target') == 'other'


def golden(path):
    g = json.load(open(path))
    assert g['SEEN_EMPTY_MS'] == SEEN_EMPTY_MS
    for row in g['rows']:
        got = seen_skip(**row['inputs'])
        assert got == row['out'], (row['name'], got, row['out'])
    return len(g['rows'])


if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1] == '--selftest':
    n = golden(sys.argv[3]) if len(sys.argv) > 3 and sys.argv[2] == '--golden' else 0
    print('SELFTEST OK' + (f' (golden {n} rows)' if n else ''))
    sys.exit(0)

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
    LOOK = PRE - dt.timedelta(minutes=60)        # the entries a pre-window drain or an early skip may name

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

    raw_name = lambda r: (((r.get('raw') or {}).get('skill') or {}).get('name')) or ''
    dur_of = lambda r: ((((r.get('raw') or {}).get('skill') or {}).get('duration_ms')) or 0)
    rows = sorted(load_window(LOOK, END), key=lambda r: r['t'])
    entries = {}
    span = defaultdict(lambda: [None, None]); nrows = Counter(); n = Counter(); leak = 0; offbuild = 0; noversion = 0
    drains_by = defaultdict(list); loads_by = defaultdict(list)
    can_drains, can_skips = [], []
    runs = defaultdict(list)           # bot -> [(start ms, duration ms, period, pool)] (runner rows: stamped at START)
    for r in rows:
        t = r.get('t'); b = (r.get('bot') or {}).get('name')
        if t is None or not b:
            continue
        k = raw_name(r); d = r.get('detail') or ''; tms = int(t.timestamp() * 1000); p = pool_of(b)
        if k == '_ledger_station':
            f = fields(d)
            if f.get('outcome') == 'entry':
                entries[f.get('id')] = {'id': f.get('id'), 'at': num(f.get('at')) or tms, 'bot': b, 'state': f.get('state'), 'f': f.get('f'), 'pool': p}
            if f.get('phase') == 'load':
                loads_by[p].append((tms, f.get('f')))
            if t >= CUT and p not in CANS:
                n['ctl_station'] += 1
        if t < PRE:
            continue                           # before the window only the entries and loads are read
        arm = 'canary' if p in CANS else 'control'
        period = 'post' if t >= CUT else 'pre'
        ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
        if arm == 'canary' and period == 'post' and CV:
            if not ver:
                noversion += 1; continue
            if not ver.startswith(CV):
                offbuild += 1; continue
        nrows[(period, arm)] += 1
        sp = span[(period, p, b)]; sp[0] = t if sp[0] is None else sp[0]; sp[1] = t
        if k in ('_furnace_seen_skip', '_furnace_seen_mode') and period == 'post' and arm == 'control':
            leak += 1
        if k == '_furnace_seen_mode' and period == 'post' and arm == 'canary' and ' on=on ' in f' {d} ':
            n['mode'] += 1
        elif k == '_furnace_seen_skip' and period == 'post' and arm == 'canary':
            can_skips.append((tms, b, fields(d)))
        elif k == '_furnace_drain':
            f = fields(d)
            drains_by[(period, p)].append((tms, b, f.get('furnace'), f.get('stop')))
            if period == 'post' and arm == 'canary':
                can_drains.append((tms, b, f))
        elif k == 'furnace_drain':
            runs[b].append((tms, dur_of(r), period, p))
        elif k == '_furnace_session':
            f = fields(d)
            if f.get('by') in ('smelt', 'smelt_town'):
                loads_by[p].append((tms, f.get('furnace')))
    # the drain body-time by stop class: the runner row carries the duration, the _furnace_drain row the stop; joined per
    # bot by time (the event row is written in the skill's finally, inside the runner row's span)
    pools = sorted({p for (_, p, _) in span})
    bh = lambda period, p: sum(((sp[1] - sp[0]).total_seconds() / 3600.0) for (pe, pp, _), sp in span.items() if pe == period and pp == p and sp[0] is not None)
    rate = {}
    for p in pools:
        for period in ('pre', 'post'):
            h = bh(period, p)
            rate[(period, p)] = repeat_empties(drains_by[(period, p)], loads_by[p]) / h if h > 0 else None
    change = lambda p: None if rate[('pre', p)] is None or rate[('post', p)] is None else rate[('post', p)] - rate[('pre', p)]
    can_ch = [change(p) for p in pools if p in CANS]
    ctl_ch = [change(p) for p in pools if p not in CANS]
    R, lb = lower_bound(can_ch, ctl_ch)
    pre_can = [rate[('pre', p)] for p in pools if p in CANS]
    bar = BAR_SHARE * (sum(pre_can) / len(pre_can)) if pre_can and all(x is not None for x in pre_can) else None
    margin = None if lb is None or bar is None else lb - bar
    d1 = d1_check(can_drains, can_skips, entries)
    skipped = len({(f.get('f'), f.get('se'), b) for _, b, f in can_skips})
    # reported: a valid townmate empty existed for the walked furnace that the pick's fold had not read (an append racing it)
    raced = lit_released = 0
    ent_by_f = defaultdict(list)
    for e in entries.values():
        ent_by_f[(e['pool'], e['f'])].append(e)
    for t, b, f in can_drains:
        if 'se' not in f:
            continue
        t0 = num(f.get('t0')) or t
        cands = [e for e in ent_by_f[(pool_of(b), f.get('furnace'))] if e['at'] <= t0]
        newest = max(cands, key=lambda e: (e['at'], e['id'])) if cands else None
        inp, ok = logged_inputs(f, entries)
        if newest and ok and newest['id'] != f.get('se') and seen_skip(entry=newest, litAt=inp['litAt'], own=inp['own'], me=b, now=t0)['skip']:
            raced += 1
        if f.get('sl', '-') not in ('-', None) and f.get('se') not in ('-', None):
            inp, ok = logged_inputs(f, entries)
            if ok and seen_skip(**inp, me=b, now=num(f.get('t0')) or t)['why'] == 'lit_since':
                lit_released += 1
    ctl_repeats = sum(repeat_empties(drains_by[('post', p)], loads_by[p]) for p in pools if p not in CANS)
    # DRAIN BODY-TIME by stop class (design 6.4, Claude r9 #6): each runner row joined to the same bot's _furnace_drain row
    # written inside its span (the skill's finally), per arm and period, per bot-h; DiD per class
    stop_at = defaultdict(list)
    for (period, p), xs in drains_by.items():
        for tms, b, _, st in xs:
            stop_at[b].append((tms, st))
    secs = Counter()
    for b, rs in runs.items():
        for st0, dur, period, p in rs:
            m = [s_ for tt, s_ in stop_at[b] if st0 <= tt <= st0 + dur + 2000]
            secs[('canary' if p in CANS else 'control', period, stop_class(m[0] if m else None))] += dur / 1000.0
    arm_bh = lambda arm, period: sum(bh(period, p) for p in pools if (p in CANS) == (arm == 'canary'))
    def body_did(cls):
        v = {}
        for arm in ('canary', 'control'):
            for period in ('pre', 'post'):
                h = arm_bh(arm, period)
                v[(arm, period)] = secs[(arm, period, cls)] / h if h else None
        if any(x is None for x in v.values()):
            return None
        return round((v[('canary', 'post')] - v[('canary', 'pre')]) - (v[('control', 'post')] - v[('control', 'pre')]), 2)
    body_dids = {c: body_did(c) for c in STOP_CLASSES + ('other',)}
    stops = Counter((('canary' if p in CANS else 'control'), period, stop_class(s)) for (period, p), xs in drains_by.items() for _, _, _, s in xs)
    print('rows walked %d  |  canary %s  sha %s  cutoff %s  window +%d min  |  offbuild canary rows %d, no-version %d' % (len(rows), CAN, CV, CUT.strftime('%H:%MZ'), W, offbuild, noversion))
    print('LIVENESS     canary _furnace_seen_mode on=on %d | canary drains %d' % (n['mode'], len(can_drains)))
    print('EXPOSURE     skipped walks (distinct furnace x entry x bot) %d (registered min 20)' % skipped)
    print('D1 (defect)  %d defects | walks replayed %d, skips replayed %d, unresolved %d | lit-released walks %d | %s'
          % (len(d1['defects']), d1['walks_replayed'], d1['skips_replayed'], d1['unresolved'], lit_released, d1['defects'][:4]))
    print('EFFECT       repeat empty drains per bot-h: canary pre %s | R = %s, lower bound (alpha %.3f, randomization) %s, bar %s -> margin %s'
          % ([None if x is None else round(x, 3) for x in pre_can], None if R is None else round(R, 4), ALPHA, None if lb is None else round(lb, 4),
             None if bar is None else round(bar, 4), None if margin is None else round(margin, 4)))
    print('REPORT       drains by stop class %s' % dict(sorted(stops.items())))
    print('             drain body-s per bot-h DiD by stop class %s (the saving, measured) | raced walks (an append after the pick read the fold; reported) %d' % (body_dids, raced))
    print('ARMS         control skip / mode rows post %d (blocks KEEP)' % leak)
    print('INSTRUMENT   control repeat empty drains post %d | control _ledger_station post %d' % (ctl_repeats, n['ctl_station']))
    try:
        if ovr:
            raise RuntimeError('CANARY_DRYRUN set -- not emitting')
        sys.path.insert(0, os.path.expanduser('~'))
        from readjson import emit
        emit('furnaceseenread', W, {
            'rows_canary': nrows[('post', 'canary')], 'rows_control': nrows[('post', 'control')], 'offbuild_canary': offbuild, 'noversion_canary': noversion,
            'liveness': int(n['mode'] >= 1 and len(can_drains) >= 1), 'skipped_walks': skipped, 'licence_rows': len(can_skips),
            'd1_defects': len(d1['defects']), 'd1_unresolved': d1['unresolved'], 'walks_replayed': d1['walks_replayed'], 'lit_released': lit_released,
            'r': R, 'r_lb': lb, 'bar': bar, 'r_lb_minus_bar': margin,
            'rows_control_post': leak, 'instrument_control': int(ctl_repeats >= 1 and n['ctl_station'] >= 1),
            'stops': {'%s.%s.%s' % k: v for k, v in stops.items()}, 'body_s_per_bh_did': body_dids, 'raced_walks': raced,
        })
    except Exception as e:
        print('emit failed:', e)
