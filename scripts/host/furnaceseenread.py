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
#   _furnace_seen_skip  f= why= now= changed=0|1 se=<entry id> sl=<lit-seen ms|-> so=<e|h>:<ms>|- off=<gen>:<bytes>   (one per
#                       furnace and entry skipped: the LICENCE; changed=1 when the base pick would have walked to it)
#   _furnace_seen_mode  once per spawn: phase=mode on=on|off ...
#   _furnace_drain      stop= furnace= ... t0= ledger= se= sl= so= off=   (the inputs the pick relied on for the furnace it walked to)
#   _ledger_station     id= f= phase= by= state= outcome= ... at=          (ledger-01: the entries the inputs name)
#   _furnace_session    furnace= ... by=smelt|smelt_town               (a load between two empty findings)
#
#   D1 (defect) `d1_defects`: THE SAME FUNCTION REPLAYED on the logged inputs (seen_skip is a port of smeltjob.mjs seenSkip,
#       bound to the JS function by the golden table): a canary drain that WALKED to a furnace whose logged inputs say skip, or
#       a skip row whose logged inputs say walk. An input naming an entry the read cannot find is UNRESOLVED (reported, not
#       counted). Reported, not counted: walks where a valid townmate empty existed that the pick could not see -- `races`:
#       `raced` (the entry lies past the logged fold offset, or was appended between the pick and the open) and
#       `ledger_unread` (the pick read no ledger, off='-') -- and walks the lit-seen evidence released (`lit_released`).
#   D1 POSITIVE CONTROL (blocks KEEP) `d1_instrument`: the replay resolved >= 1 walk or skip, unresolved <= 5% of the tries.
#   EFFECT (REVERT, no evidence class: blocks KEEP) `r_lb_minus_bar` >= 0: R = (control's change in repeat empty drains per
#       bot-h) - (canary's change), positive = fewer repeats on the canary, over a FROZEN pre-period [cut - 24 h, cut) the same
#       at every read (Codex r1 P2-1); its lower bound by RANDOMIZATION over towns (every relabelling of the 4 canary pools
#       among the canary + the FROZEN ELIGIBLE controls -- >= 40 drains in the pre-period, the draw's own rule, and >= 2 post
#       bot-h; a pool converted mid-pre is out, every dropped pool named: Claude r1 P2-1); the shift-inverted one-sided bound at
#       alpha 0.025 = Bonferroni over the k = 2 reads that can KEEP (+180 and the final; no extension reads) minus the bar
#       0.25 x the canary pools' pre-period rate. UNDEFINED -> None (UNREADABLE, never a pass): a drawn canary town without
#       both rates (Codex r1 P2-2), fewer than 2 controls.
#       A REPEAT EMPTY DRAIN: a drain with stop=empty on furnace F by bot b when another bot's drain found F empty < 60 min
#       before with no load on F between (a smelt / smelt_town furnace session on F, or a ledger load record).
#   ARMS      control `_furnace_seen_skip` / `_furnace_seen_mode` rows after the deploy (BLOCKS KEEP).
#   LIVENESS  canary `_furnace_seen_mode on=on` >= 1 and canary `_furnace_drain` >= 1.
#   POSITIVE CONTROL  control repeat empty drains in the window >= 1 (the instrument that sees the thing the change removes)
#             and control `_ledger_station` rows >= 1 (ledger-01 is on the fleet).
#   EXPOSURE  `skipped_walks` = canary skip rows with changed=1 (the walk the rule SAVED; distinct furnace x entry x bot) --
#             registered min 20 (Claude r1 P2-3).
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
PRE_MIN = 1440                # THE FROZEN PRE-PERIOD: [cut - 24 h, cut), the same at every read (registered)
MIN_PRE_DRAINS = 40           # a control pool must have drained this much in the pre-period (the draw's own exposure rule)
MIN_POOL_BH = 2.0             # a pool-period with fewer bot-hours has no rate (symmetric, named)


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


def eligible_controls(pre_drains, post_bh, cans, min_pre_drains=MIN_PRE_DRAINS, min_bh=MIN_POOL_BH):
    """PURE. The CONTROL set, frozen by the pre-period (Claude r1 P2-1, Codex r1 P2-2): non-canary pools with >= min_pre_drains
    drains in the frozen pre-window (the draw's own exposure requirement: a pool that could have been drawn) and >= min_bh
    bot-hours in the post window (a pool that stopped is dropped symmetrically, and named). A pool converted mid-pre (an
    isolated pool that gained a smelt job) fails the pre requirement. -> (eligible, dropped {pool: why})."""
    elig, dropped = [], {}
    for p in sorted(set(pre_drains) | set(post_bh)):
        if p in cans:
            continue
        if pre_drains.get(p, 0) < min_pre_drains:
            dropped[p] = 'pre drains %d < %d' % (pre_drains.get(p, 0), min_pre_drains)
        elif post_bh.get(p, 0) < min_bh:
            dropped[p] = 'post bot-h %.1f < %g' % (post_bh.get(p, 0), min_bh)
        else:
            elig.append(p)
    return elig, dropped


def effect_line(rates, cans, controls):
    """PURE. rates {(period, pool): repeats per bot-h or None} -> {R, lb, bar, margin, why}. EVERY drawn canary pool must have
    both rates (a canary town with no evidence makes the line UNDEFINED, never a pass on the others: Codex r1 P2-2); controls
    are the frozen eligible set. bar = BAR_SHARE x the canary pools' frozen pre-period mean rate."""
    if not cans:
        return {'R': None, 'lb': None, 'bar': None, 'margin': None, 'why': 'no canary pool'}
    missing = [p for p in cans if rates.get(('pre', p)) is None or rates.get(('post', p)) is None]
    if missing:
        return {'R': None, 'lb': None, 'bar': None, 'margin': None, 'why': 'canary pool(s) without both rates: %s' % ','.join(sorted(missing))}
    ctl = [p for p in controls if rates.get(('pre', p)) is not None and rates.get(('post', p)) is not None]
    if len(ctl) < 2:
        return {'R': None, 'lb': None, 'bar': None, 'margin': None, 'why': 'fewer than 2 control pools'}
    ch = lambda p: rates[('post', p)] - rates[('pre', p)]
    R, lb = lower_bound([ch(p) for p in sorted(cans)], [ch(p) for p in ctl])
    bar = BAR_SHARE * sum(rates[('pre', p)] for p in cans) / len(cans)
    return {'R': R, 'lb': lb, 'bar': bar, 'margin': None if lb is None else lb - bar, 'why': None}


def race_class(newest, open_at, logged_off, entry_pos):
    """PURE. Was a skip-worthy townmate entry on the walked furnace invisible to the pick? -> 'raced' (written after the pick's
    fold offset, or -- position unknown -- after the pick), 'ledger_unread' (the pick read no ledger: off='-'), or None.
    newest: the skip-worthy entry (at <= the drain's OPEN, so an append between pick and open counts) or None;
    entry_pos: (gen, end byte) of that entry in the ledger file, or None (rotated away / unknown)."""
    if not newest:
        return None
    if logged_off in (None, '-'):
        return 'ledger_unread'
    try:
        g, b = (int(x) for x in str(logged_off).split(':', 1))
    except ValueError:
        return 'ledger_unread'
    if entry_pos is not None:
        return 'raced' if entry_pos > (g, b) else None
    return 'raced'


def d1_instrument(d1):
    """PURE. The D1 positive control: the replay resolved something, and unresolved <= 5% of what it tried."""
    tried = d1['walks_replayed'] + d1['skips_replayed'] + d1['unresolved']
    return int(d1['walks_replayed'] + d1['skips_replayed'] >= 1 and d1['unresolved'] <= 0.05 * tried)


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
_skip = lambda **o: fields(' '.join(f'{k}={v}' for k, v in dict({'f': '1,64,1', 'why': 'townmate_empty', 'now': NOW, 'se': 'mate-1', 'sl': '-', 'so': '-', 'off': '1:99', 'changed': 1}, **o).items()))
assert d1_check([], [(NOW, 'Me', _skip())], _ent)['defects'] == []
assert d1_check([], [(NOW, 'Mate', _skip())], _ent)['defects'][0][0] == 'skipped_a_walk', 'its own entry: never a skip'
assert d1_instrument({'walks_replayed': 10, 'skips_replayed': 0, 'unresolved': 0}) == 1
assert d1_instrument({'walks_replayed': 0, 'skips_replayed': 0, 'unresolved': 0}) == 0, 'nothing replayed: the instrument saw nothing'
assert d1_instrument({'walks_replayed': 10, 'skips_replayed': 0, 'unresolved': 3}) == 0, 'too much unresolved'
# repeats: B after A within 60 min, no load between -> 1; a load between -> 0; the same bot -> 0; older than 60 min -> 0
_dr = [(0, 'A', 'F', 'empty'), (60_000, 'B', 'F', 'empty')]
assert repeat_empties(_dr, []) == 1 and repeat_empties(_dr, [(30_000, 'F')]) == 0
assert repeat_empties([(0, 'A', 'F', 'empty'), (60_000, 'A', 'F', 'empty')], []) == 0
assert repeat_empties([(0, 'A', 'F', 'empty'), (REPEAT_MS, 'B', 'F', 'empty')], []) == 0
# THE EFFECT LINE, the four fixtures: improvement, no change, worsening, undefined
_ctl = [0.10, -0.05, 0.02, 0.0, 0.08, -0.03, 0.04, 0.01, -0.02, 0.05, 0.0, 0.03]
R1, lb1 = lower_bound([-1.2, -1.0, -1.4, -1.1], _ctl)
assert R1 > 1.0 and lb1 > 0.25, (R1, lb1)
R2, lb2 = lower_bound([0.02, -0.01, 0.04, 0.0], _ctl)
assert abs(R2) < 0.05 and lb2 < 0
R3, lb3 = lower_bound([0.9, 1.1, 0.8, 1.0], _ctl)
assert R3 < -0.5 and lb3 < R3
assert lower_bound([], _ctl) == (None, None) and lower_bound([0.1, None, 0, 0], _ctl) == (None, None)
# effect_line over pools: improvement passes the bar; no change does not; a canary pool without evidence is UNDEFINED (never a
# pass on the other three); ONE CONTROL POOL JUMPING with the canary unchanged must not pass (Claude r1 P2-1's fixture)
_rates = lambda can_post, ctl_post, ctl_pre=0.5, can_pre=0.5: dict(
    [(('pre', 'c%d' % i), can_pre) for i in range(4)] + [(('post', 'c%d' % i), v) for i, v in enumerate(can_post)] +
    [(('pre', 'k%d' % i), ctl_pre) for i in range(len(ctl_post))] + [(('post', 'k%d' % i), v) for i, v in enumerate(ctl_post)])
_C = ['c0', 'c1', 'c2', 'c3']; _K = ['k%d' % i for i in range(11)]
_base_ctl = [0.5, 0.52, 0.48, 0.5, 0.51, 0.49, 0.5, 0.53, 0.47, 0.5, 0.5]
assert effect_line(_rates([0.05, 0.04, 0.06, 0.05], _base_ctl), _C, _K)['margin'] > 0, 'improvement'
assert effect_line(_rates([0.5, 0.52, 0.49, 0.5], _base_ctl), _C, _K)['margin'] < 0, 'no change'
assert effect_line(_rates([0.9, 0.95, 0.85, 1.0], _base_ctl), _C, _K)['margin'] < 0, 'worsening'
_r = _rates([0.05, 0.04, 0.06, 0.05], _base_ctl); del _r[('post', 'c3')]
assert effect_line(_r, _C, _K)['margin'] is None, 'a canary town with no post evidence: undefined'
_jump = _rates([0.5, 0.5, 0.5, 0.5], _base_ctl[:-1] + [3.0])
assert effect_line(_jump, _C, _K)['margin'] < 0, 'one control pool jumps, the canary unchanged: no pass'
# the frozen control set: a pool with no drains in the pre-window (converted mid-pre) is dropped and named
_el, _dp = eligible_controls({'a': 60, 'b': 3, 'c': 80, 'x': 99}, {'a': 20.0, 'b': 20.0, 'c': 0.5, 'x': 20.0}, {'x'})
assert _el == ['a'] and set(_dp) == {'b', 'c'}
# the race classifier: off unread; an entry past the logged offset; one inside it; position unknown
assert race_class(None, 1, '1:10', None) is None
assert race_class({'id': 'e'}, 1, '-', None) == 'ledger_unread'
assert race_class({'id': 'e'}, 1, '1:100', (1, 150)) == 'raced' and race_class({'id': 'e'}, 1, '1:100', (1, 90)) is None
assert race_class({'id': 'e'}, 1, '1:100', (2, 10)) == 'raced' and race_class({'id': 'e'}, 1, '1:100', None) == 'raced'
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
    CANS = sorted({x.strip() for x in str(CAN).split(',') if x.strip()})
    now = dt.datetime.now(dt.timezone.utc)
    elapsed = (now - CUT).total_seconds() / 60
    assert elapsed > 0 and CAN, 'no canary declared'
    W = min(elapsed, float(sys.argv[1]) if len(sys.argv) > 1 else 180)
    END = CUT + dt.timedelta(minutes=W)
    PRE = CUT - dt.timedelta(minutes=PRE_MIN)     # THE FROZEN PRE-PERIOD: the same for every read (Codex r1 P2-1)
    LOOK = PRE - dt.timedelta(minutes=60)          # the entries a pre-window drain or an early skip may name
    CUT_MS = int(CUT.timestamp() * 1000)
    raw_name = lambda r: (((r.get('raw') or {}).get('skill') or {}).get('name')) or ''
    dur_of = lambda r: ((((r.get('raw') or {}).get('skill') or {}).get('duration_ms')) or 0)
    WANT = {'_ledger_station', '_furnace_seen_skip', '_furnace_seen_mode', '_furnace_drain', 'furnace_drain', '_furnace_session'}

    def pool_rows(pool):
        """ONE pool's needed rows over [LOOK, END], rotation-aware, compacted (a 24 h + window walk of the whole fleet at
        once would not fit): (t, bot, kind, detail, version, duration)."""
        out, seen = [], set()
        def take(ev):
            for r in ev.rows:
                k = raw_name(r)
                key = (str(r.get('t')), ((r.get('bot') or {}).get('name')), k, r.get('detail'))
                if key in seen:
                    continue
                seen.add(key)
                b = (r.get('bot') or {}).get('name')
                if r.get('t') is None or not b:
                    continue
                out.append((r['t'], b, k if k in WANT else None, r.get('detail') or '' if k in WANT else '',
                            (((r.get('raw') or {}).get('code') or {}).get('version') or ''), dur_of(r)))
        take(Events.load(paths='/var/log/mcai/%s-*/skill-*.jsonl' % pool, since=LOOK, until=END))
        for k in range(0, (END.date() - LOOK.date()).days + 1):
            tag = (LOOK.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
            for g in glob.glob('/var/log/mcai/%s-*/skill-*.jsonl-%s.gz' % (pool, tag)):
                take(Events.load(paths=g, since=LOOK, until=END))
        return sorted(out, key=lambda x: x[0])

    POOLS = sorted({'-'.join(os.path.basename(d).split('-')[:2]) for d in glob.glob('/var/log/mcai/*-*-*') if os.path.isdir(d)})
    entries = {}
    span = defaultdict(lambda: [None, None]); nrows = Counter(); n = Counter(); leak = 0; offbuild = 0; noversion = 0
    drains_by = defaultdict(list); loads_by = defaultdict(list)
    can_drains, can_skips = [], []
    runs = defaultdict(list)
    for p in POOLS:
        for t, b, k, d, ver, dur in pool_rows(p):
            tms = int(t.timestamp() * 1000)
            if k == '_ledger_station':
                f = fields(d)
                if f.get('outcome') == 'entry':
                    entries[f.get('id')] = {'id': f.get('id'), 'at': num(f.get('at')) or tms, 'bot': b, 'state': f.get('state'), 'f': f.get('f'), 'pool': p}
                if f.get('phase') == 'load':
                    loads_by[p].append((tms, f.get('f')))
                if t >= CUT and p not in CANS:
                    n['ctl_station'] += 1
            if t < PRE:
                continue
            arm = 'canary' if p in CANS else 'control'
            period = 'post' if t >= CUT else 'pre'
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
                runs[b].append((tms, dur, period, p))
            elif k == '_furnace_session':
                f = fields(d)
                if f.get('by') in ('smelt', 'smelt_town'):
                    loads_by[p].append((tms, f.get('furnace')))
    bh = lambda period, p: sum(((sp[1] - sp[0]).total_seconds() / 3600.0) for (pe, pp, _), sp in span.items() if pe == period and pp == p and sp[0] is not None)
    rates = {}
    for p in POOLS:
        for period in ('pre', 'post'):
            h = bh(period, p)
            rates[(period, p)] = repeat_empties(drains_by[(period, p)], loads_by[p]) / h if h >= MIN_POOL_BH else None
    controls, dropped = eligible_controls({p: len(drains_by[('pre', p)]) for p in POOLS}, {p: bh('post', p) for p in POOLS}, set(CANS))
    eff = effect_line(rates, CANS, controls)
    d1 = d1_check(can_drains, can_skips, entries)
    # EXPOSURE: skips that CHANGED the pick (Claude r1 P2-3) -- the furnace the base pick would have walked to
    skipped = len({(f.get('f'), f.get('se'), b) for _, b, f in can_skips if f.get('changed') == '1'})
    # the ledger files' record positions, for the race classification
    pos = {}
    for p in CANS:
        for f_ in sorted(glob.glob('/var/lib/mcai/_pool-%s/ledger-*.g*.jsonl' % p)):
            m_ = re.search(r'\.g(\d+)\.jsonl$', f_)
            if not m_:
                continue
            g_, off_ = int(m_.group(1)), 0
            try:
                for ln in open(f_, 'rb'):
                    off_ += len(ln)
                    try:
                        rr = json.loads(ln)
                    except Exception:
                        continue
                    if rr.get('t') == 'station' and rr.get('id'):
                        pos.setdefault(rr['id'], (g_, off_))
            except OSError:
                pass
    ent_by_f = defaultdict(list)
    for e in entries.values():
        ent_by_f[(e['pool'], e['f'])].append(e)
    races = Counter(); lit_released = 0
    for t, b, f in can_drains:
        if 'se' not in f:
            continue
        t0 = num(f.get('t0')) or t
        open_at = (entries.get(f.get('ledger')) or {}).get('at') or t0      # an append between the pick and the OPEN counts
        cands = [e for e in ent_by_f[(pool_of(b), f.get('furnace'))] if e['at'] <= open_at]
        newest = max(cands, key=lambda e: (e['at'], e['id'])) if cands else None
        inp, ok = logged_inputs(f, entries)
        if newest and ok and newest['id'] != f.get('se') and seen_skip(entry=newest, litAt=inp['litAt'], own=inp['own'], me=b, now=t0)['skip']:
            c_ = race_class(newest, open_at, f.get('off'), pos.get(newest['id']))
            if c_:
                races[c_] += 1
        if ok and f.get('sl', '-') not in ('-', None) and seen_skip(**inp, me=b, now=t0)['why'] == 'lit_since':
            lit_released += 1
    ctl_repeats = sum(repeat_empties(drains_by[('post', p)], loads_by[p]) for p in controls)
    stop_at = defaultdict(list)
    for (period, p), xs in drains_by.items():
        for tms, b, _, st in xs:
            stop_at[b].append((tms, st))
    secs = Counter()
    for b, rs in runs.items():
        for st0, dur, period, p in rs:
            if p not in CANS and p not in controls:
                continue
            m = [s_ for tt, s_ in stop_at[b] if st0 <= tt <= st0 + dur + 2000]
            secs[('canary' if p in CANS else 'control', period, stop_class(m[0] if m else None))] += dur / 1000.0
    arm_bh = lambda arm, period: sum(bh(period, p) for p in (CANS if arm == 'canary' else controls))
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
    stops = Counter((('canary' if p in CANS else 'control'), period, stop_class(s)) for (period, p), xs in drains_by.items() if p in CANS or p in controls for _, _, _, s in xs)
    rnd = lambda x: None if x is None else round(x, 4)
    print('rows walked (compacted) %d  |  canary %s  sha %s  cutoff %s  window +%d min, FROZEN pre-period %d min  |  offbuild canary rows %d, no-version %d'
          % (sum(nrows.values()), ','.join(CANS), CV, CUT.strftime('%H:%MZ'), W, PRE_MIN, offbuild, noversion))
    print('POOLS        controls (frozen: >= %d pre drains, >= %g post bot-h) %d: %s | dropped %s' % (MIN_PRE_DRAINS, MIN_POOL_BH, len(controls), ','.join(controls), dropped or '-'))
    print('LIVENESS     canary _furnace_seen_mode on=on %d | canary drains %d' % (n['mode'], len(can_drains)))
    print('EXPOSURE     skipped walks that CHANGED the pick (distinct furnace x entry x bot) %d of %d skip rows (registered min 20)' % (skipped, len(can_skips)))
    print('D1 (defect)  %d defects | walks replayed %d, skips replayed %d, unresolved %d -> instrument %d | lit-released walks %d | %s'
          % (len(d1['defects']), d1['walks_replayed'], d1['skips_replayed'], d1['unresolved'], d1_instrument(d1), lit_released, d1['defects'][:4]))
    print('EFFECT       repeat empty drains per bot-h: canary pre %s post %s | R = %s, lower bound (alpha %.3f, randomization) %s, bar %s -> margin %s %s'
          % ([rnd(rates.get(('pre', p))) for p in CANS], [rnd(rates.get(('post', p))) for p in CANS], rnd(eff['R']), ALPHA, rnd(eff['lb']), rnd(eff['bar']), rnd(eff['margin']), eff['why'] or ''))
    print('REPORT       drains by stop class %s' % dict(sorted(stops.items())))
    print('             drain body-s per bot-h DiD by stop class %s (the saving, measured) | races (reported) %s' % (body_dids, dict(races) or '-'))
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
            'd1_defects': len(d1['defects']), 'd1_unresolved': d1['unresolved'], 'walks_replayed': d1['walks_replayed'],
            'skips_replayed': d1['skips_replayed'], 'd1_instrument': d1_instrument(d1), 'lit_released': lit_released,
            'r': eff['R'], 'r_lb': eff['lb'], 'bar': eff['bar'], 'r_lb_minus_bar': eff['margin'], 'effect_undefined_why': eff['why'],
            'controls': controls, 'controls_dropped': dropped, 'pre_min': PRE_MIN,
            'rows_control_post': leak, 'instrument_control': int(ctl_repeats >= 1 and n['ctl_station'] >= 1),
            'stops': {'%s.%s.%s' % k: v for k, v in stops.items()}, 'body_s_per_bh_did': body_dids, 'races': dict(races),
        })
    except Exception as e:
        print('emit failed:', e)
