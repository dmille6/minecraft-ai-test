#!/usr/bin/env python3
# homefixread.py [window_min] [--selftest] -- the read for canary `homefix-01` (docs/reports/expansion-plan-2026-10-19.md
# §2 and §5, both engines APPROVE r7; OWNER 10-19 X1/X9). CANARY_DRYRUN=pool[,pool]:sha:iso for dry runs (never emits).
# Judges the CANARY ARM; DENOMINATORS FIRST; every gate has a positive control, and a gate whose control fails is VOID.
#
# THE CHANGE (four mechanisms, one build):
#   H1  `home` grades its arrival with goto's own final test (arrivedAt: <= 3 horizontally, |dy| <= 6 at range 2)
#   H2  the watchdog's rescue: pending from the verdict, cancel-and-reserve (runner_reserved), `current` always cleared,
#       the level held on a rescue that did not start (capped at 2 reserve_expired), the window reset at rescue START,
#       `_watchdog_rescue` attempt rows {attempt, level, remedy, phase} (requested -> started | declined:<c> -> terminal)
#   H3  the runner files any throw under its own aborted signal as aborted/interrupted (not failed/skill_error)
#   H4  HOME_BUDGET_MS 170 s (< the 180 s skill timeout), passed into nested goto/surface as `until`
#
# THE GATES (each "0 defects in >= D opportunities"; D = ceil(ln 0.05 / ln(1 - p)) from the pre-fix defect rate p):
#   G1   arrival: an arm `home` row, trigger NOT interrupt:*, moved >= 2, ending in the H1 BAND (2 < horiz <= 3, |dy| <= 6
#        of the bot's config.world home) -- graded anything but success is a DEFECT. p = 224/240 -> D = 2.
#   G1b  mirror: an arm `home` SUCCESS ending > 3 horizontally or |dy| > 6 is a DEFECT (the fix must not over-accept).
#   G2   classification: an arm `home` or `surface` row with an interrupt:* trigger filed failed/skill_error is a DEFECT.
#        D = 5, or more: the read needs P(0 defects | no fix) = prod(1 - p_skill) <= 0.05 on the arm's OWN mix
#        (h12: home 265/1,421 = 18.7%, surface 2,579/3,509 = 73.5%; an all-home arm needs 15).
#   G3   rescue survives: a `started` attempt joined to the runner's skill row (bot, start +-1 s) that saw a watchdog tick
#        (`tick_seen`) or was cut by interrupt:stagnation at any age. DEFECT: cut by a verdict whose window held a sample
#        from BEFORE the rescue started (`_stagnation` args.window_from < the `started` row). p = 34% -> D = 8.
#   G4   rescue reachable: a `requested` attempt (requested >= 230 s before the read boundary) with no TERMINAL phase
#        (completed:*, interrupted:*, declined:*, reconnected) is a DEFECT. D = 20. The `declined:reserve_expired` rate bar
#        (> 8% of attempts, 2x the 4.1% unwind proxy, an engineering threshold) is a SEPARATE line that BLOCKS KEEP
#        (INCONCLUSIVE) rather than reverting (see the registration and docs/reports/homefix-01-review-2026-10-20.md).
# POSITIVE CONTROLS (a failed one makes its gate VOID: the registration's control lines block KEEP):
#   G1, G2  the SAME reader finds the defect on the arm's own 24 h pre-period (old code).
#   G1b     fixtures (the two pre-fix dy -10 successes, h9), plus the pre-period count reported.
#   G3      (a) the HISTORICAL PROXY (a watchdog-origin row -- trigger watchdog_* or interrupt:*, starting <= 30 s after a
#           `_stagnation` row -- cut by interrupt:stagnation in < 150 s; r6: 150 not 165, the earliest legitimate verdict on
#           the rescue's own window lands ~165 s after its start) finds the defect on the pre-period; and (b) the NEW reader
#           passes a known-good fixture log and fails known-defective ones (cut at 15 s; a delayed handoff cut 5 s later;
#           a cut before 10 s).
#   G4      fixtures only (an attempt with no terminal row; a reconnect with its row; a declined attempt): old code has no
#           rows, and "rows absent on control" is not a positive control.
# EXPOSURE / DEADLINE (registered BEFORE the draw): reads 180 / 360, extension to 540 / 720 / 1080. `gates_complete` = every
#   gate has its D. `exposure_ready` = gates_complete OR the arm-size deadline is reached (+540 at >= 4 pools, +720 at 3,
#   +1080 at <= 2); at the deadline with gates_complete 0 the `gates_complete` line blocks KEEP -> INCONCLUSIVE.
# GUARDS (DiD, reported, never a verdict here): deaths (the gate's two-death floor decides), canary deaths within 120 s
#   after a `_watchdog_rescue` start; `_stranded*` / level-1 `_stagnation` / `_stagnation_reconnect` per bot-h; relocation
#   outcomes (goto trigger watchdog_relocate); `home` success, all rows and an S0-like filter.
import sys, os, json, re, math, glob
import datetime as dt
from collections import Counter, defaultdict

UTC = dt.timezone.utc
S = dt.timedelta(seconds=1)

# ------------------------------------------------------------------------------------------------------------------ constants
BAND_LO, BAND_HI, VERT = 2.0, 3.0, 6.0          # skills.mjs arrivedAt at range 2: max(2, 3) = 3 horizontally, 3 + 3 = 6 in y
# ROUNDING DEAD ZONE (Claude code r1 P2-1): bot.pos is rounded to 0.1 per coordinate (state.mjs round), so a horizontal
# distance read from it is off by up to ~0.071 from the one the code graded. A row within EPS of an edge is not evidence
# either way: G1 counts only (2 + EPS, 3 - EPS] with |dy| <= 6 - EPS, G1b only > 3 + EPS or |dy| > 6 + EPS.
EPS = 0.08
P_G1 = 224 / 240                                 # h13
P_G2 = {'home': 265 / 1421, 'surface': 2579 / 3509}   # h12, all pools, 7 d
G2_FLOOR = 5
P_G3 = 0.34                                      # 534 / 1,565 (proxy, old denominator)
D_G4 = 20
RE_BAR = 0.08                                    # 2 x the 4.1% unwind-latency proxy (h12)


def wilson_lower(k, n, z=1.645):
    """One-sided 95% Wilson lower bound of k/n (None for n = 0). Pure."""
    if not n:
        return None
    p = k / n
    den = 1 + z * z / n
    return (p + z * z / (2 * n) - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / den
# reservation 20 + skill timeout 180 + hard-stop grace 30 = 230, plus margin (Claude code r1 P3-6: a hard-stopped rescue
# writes its terminal ~20 + 0.5 + 210 s after `requested`); 260 is the watchdog's own pending backstop (bound + 30)
PENDING_BOUND_S = 260
PROXY_AFTER_S = 30
PROXY_CUT_S = 150
DEATH_AFTER_RESCUE_S = 120
PRE_H = 24
TERMINAL = re.compile(r'^(completed|interrupted|declined):|^reconnected$')
RESCUE_SKILLS = ('goto', 'home', 'surface', 'mine')
SPAWN_MARK = '_cobblecap_mode'                   # once per spawn, written by both builds (index.mjs)


def d_needed(p, alpha=0.05):
    """D = ceil(ln alpha / ln(1 - p)): 0 defects in D opportunities is <= alpha likely without the fix. Pure."""
    return int(math.ceil(math.log(alpha) / math.log(1 - p)))


D_G1 = d_needed(P_G1)
D_G3 = d_needed(P_G3)


def deadline_for(pools):
    """The arm-size deadline (r6: P(G1 reaches D) 0.93 by +540 at 20 bots, by +1080 at 10). Pure."""
    return 540 if pools >= 4 else 720 if pools == 3 else 1080


KEEP_EVENTS = {'_watchdog_rescue', '_stagnation', '_stagnation_reconnect', '_death', SPAWN_MARK, '_stranded', '_stranded_underground',
               '_stranded_unrecoverable', '_drowning', '_low_health', '_trap'}


def on_build(ver, arm, cv):
    """A row on the canary's own build (control rows always count). Pure."""
    return arm != 'canary' or not cv or str(ver or '').startswith(cv)


def classify(name, ver, t, arm, cut, cv):
    """One row -> (where, kind). where: 'drop' (an event no gate reads), 'offbuild' (a canary post row from another build:
    RESTART LAG, memory restart-lag-rows-are-not-canary -- applied to EVERY kept row, stubs included, Claude/Codex code r2),
    'pre' or 'post'. kind: 'full' (a rescue skill or a kept event) or 'stub' (any other skill row, kept only for its health).
    Pure."""
    if name.startswith('_') and name not in KEEP_EVENTS and not name.startswith('_drown'):
        return 'drop', None
    kind = 'full' if (name.startswith('_') or name in RESCUE_SKILLS) else 'stub'
    if t >= cut:
        if arm == 'canary' and cv and ver and not str(ver).startswith(cv):
            return 'offbuild', kind
        return 'post', kind
    return 'pre', kind


def horiz(pos, home):
    return math.hypot(float(pos['x']) - home[0], float(pos['z']) - home[2])


def in_band(pos, home):
    """The H1 band: more than 2 and at most 3 horizontally, |dy| <= 6. Pure."""
    if not pos or home is None:
        return False
    h = horiz(pos, home)
    return BAND_LO + EPS < h <= BAND_HI - EPS and abs(float(pos['y']) - home[1]) <= VERT - EPS


def over_accepted(pos, home):
    """G1b: a success ending outside goto's own final test. Pure."""
    if not pos or home is None:
        return False
    return horiz(pos, home) > BAND_HI + EPS or abs(float(pos['y']) - home[1]) > VERT + EPS


def interrupted_trigger(r):
    return str(r.get('trigger') or '').startswith('interrupt:')


def g1_rows(rows, home):
    """-> (opportunities, defects, [examples]). rows: one bot's compact rows. Pure."""
    o = d = 0; ex = []
    for r in rows:
        if r['name'] != 'home' or interrupted_trigger(r) or (r.get('moved') or 0) < 2 or not in_band(r.get('pos'), home):
            continue
        o += 1
        if r.get('status') != 'success':
            d += 1; ex.append(('G1', r['t'].isoformat(), r.get('status'), r.get('fc'), r.get('pos')))
    return o, d, ex


def g1b_rows(rows, home):
    o = d = 0; ex = []
    for r in rows:
        if r['name'] != 'home' or r.get('status') != 'success':
            continue
        o += 1
        if over_accepted(r.get('pos'), home):
            d += 1; ex.append(('G1b', r['t'].isoformat(), r.get('pos')))
    return o, d, ex


def g2_rows(rows):
    """-> (Counter of opportunities by skill, defects, [examples]). Pure."""
    o = Counter(); d = 0; ex = []
    for r in rows:
        if r['name'] not in P_G2 or not interrupted_trigger(r):
            continue
        o[r['name']] += 1
        if r.get('status') == 'failed' and r.get('fc') == 'skill_error':
            d += 1; ex.append(('G2', r['t'].isoformat(), r['name'], r.get('trigger')))
    return o, d, ex


def g2_p0(mix):
    """P(0 defects | no fix) on this arm's own home/surface mix. Pure."""
    p = 1.0
    for k, n in mix.items():
        p *= (1 - P_G2[k]) ** n
    return p


def g2_complete(mix):
    n = sum(mix.values())
    return n >= G2_FLOOR and g2_p0(mix) <= 0.05


def g2_need(mix):
    """The opportunities needed at this arm's mix (for the report): the floor, or the mix's own D. Pure."""
    n = sum(mix.values())
    if not n:
        return max(G2_FLOOR, d_needed(P_G2['home']))
    pbar = 1 - g2_p0(mix) ** (1 / n)            # the per-opportunity rate this mix implies
    return max(G2_FLOOR, d_needed(pbar))


def parse_t(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except Exception:
        return None


def attempts_of(rows):
    """One bot's `_watchdog_rescue` rows -> {attempt: {...}}. Pure."""
    out = {}
    for r in rows:
        if r['name'] != '_watchdog_rescue':
            continue
        a = r.get('args') or {}
        aid = str(a.get('attempt') or '')
        if not aid:
            continue
        x = out.setdefault(aid, {'attempt': aid, 'requested': None, 'started': None, 'run_started': None, 'tick_seen': False,
                                 'terminal': None, 'terminal_t': None, 'level': a.get('level'), 'remedy': a.get('remedy'), 'phases': []})
        ph = str(a.get('phase') or '')
        x['phases'].append(ph)
        if ph == 'requested' and x['requested'] is None:
            x['requested'] = r['t']
        elif ph == 'started' and x['started'] is None:
            x['started'] = r['t']; x['run_started'] = parse_t(a.get('run_started')) or r['t']
        elif ph == 'tick_seen':
            x['tick_seen'] = True
        elif TERMINAL.search(ph) and x['terminal'] is None:
            x['terminal'] = ph; x['terminal_t'] = r['t']
    return out


def join_row(att, skill_rows):
    """The runner's skill row for a started attempt: same bot (caller), start within +-1 s of run_started. Pure."""
    best = None
    for r in skill_rows:
        if abs((r['t'] - att['run_started']).total_seconds()) <= 1.0:
            if best is None or abs((r['t'] - att['run_started']).total_seconds()) < abs((best['t'] - att['run_started']).total_seconds()):
                best = r
    return best


def g3_eval(atts, skill_rows, verdicts, end=None, spawns=()):
    """-> (opportunities, defects, unjoined, [examples]). verdicts: [(t, window_from dt|None)] of the same bot. Pure.
    The skill row decides; with NO row the runner's own TERMINAL phase stands in (interrupted:stagnation is the cut; Codex
    r1 P1: a missing row must not hide a cut). A started attempt with neither row nor terminal is `unjoined` (a blocking
    line) unless it is still inside its bound at the read boundary (pending) or the bot respawned inside the bound
    (censored, as G4)."""
    o = d = un = 0; ex = []
    for a in atts.values():
        if a['started'] is None:
            continue
        row = join_row(a, skill_rows)
        if row is not None:
            cut = row.get('trigger') == 'interrupt:stagnation'
            row_end = row['t'] + dt.timedelta(milliseconds=row.get('dur') or 0)
        elif a['terminal'] is not None:
            cut = a['terminal'] == 'interrupted:stagnation'
            row_end = a['terminal_t']
        else:
            bound = a['started'] + dt.timedelta(seconds=PENDING_BOUND_S)
            pending = end is not None and end < bound
            censored = any(a['started'] < sp <= bound for sp in spawns)
            if not pending and not censored:
                un += 1; ex.append(('G3-unjoined', a['attempt'], a['phases']))
            continue
        if not (a['tick_seen'] or cut):
            continue
        o += 1
        if not cut:
            continue
        cands = [v for v in verdicts if a['started'] - 2 * S <= v[0] <= row_end + 2 * S]
        if not cands:
            d += 1; ex.append(('G3', a['attempt'], 'cut by stagnation, no verdict row found'))
            continue
        v = max(cands, key=lambda q: q[0])
        if v[1] is None or v[1] < a['started']:
            d += 1; ex.append(('G3', a['attempt'], 'cut by a verdict whose window began %s, before the rescue started %s'
                               % (v[1].isoformat() if v[1] else '?', a['started'].isoformat())))
    return o, d, un, ex


def g3_proxy(skill_rows, verdict_ts):
    """OLD-CODE PROXY (no attempt rows): a watchdog-origin row (trigger watchdog_* or interrupt:*, starting <= 30 s after a
    `_stagnation` row of the same bot) cut by interrupt:stagnation in < 150 s. -> (opportunities, defects). Pure."""
    o = d = 0
    vt = sorted(verdict_ts)
    for r in skill_rows:
        if r['name'] not in RESCUE_SKILLS:
            continue
        trg = str(r.get('trigger') or '')
        if not (trg.startswith('watchdog_') or trg.startswith('interrupt:')):
            continue
        if not any(r['t'] - dt.timedelta(seconds=PROXY_AFTER_S) <= v <= r['t'] for v in vt):
            continue
        o += 1
        if trg == 'interrupt:stagnation' and (r.get('dur') or 0) < PROXY_CUT_S * 1000:
            d += 1
    return o, d


def g4_eval(atts, end, spawns=()):
    """-> dict: opportunities, defects (no terminal), excused (a respawn inside the bound, no terminal: CENSORED, so not an
    opportunity either -- Codex r1 P2: it must not fill the D floor or the reserve_expired denominator), recent (excluded),
    declined classes. Pure."""
    out = {'opps': 0, 'defects': 0, 'excused': 0, 'recent': 0, 'declined': Counter(), 'orphan': 0, 'ex': []}
    for a in atts.values():
        if a['requested'] is None:
            out['orphan'] += 1
            continue
        if (end - a['requested']).total_seconds() < PENDING_BOUND_S:
            out['recent'] += 1
            continue
        if a['terminal'] is None:
            bound = a['requested'] + dt.timedelta(seconds=PENDING_BOUND_S)
            if any(a['requested'] < s <= bound for s in spawns):
                out['excused'] += 1
                continue
            out['opps'] += 1
            out['defects'] += 1; out['ex'].append(('G4', a['attempt'], a['phases']))
            continue
        out['opps'] += 1
        if a['terminal'].startswith('declined:'):
            out['declined'][a['terminal'].split(':', 1)[1]] += 1
    return out


# ------------------------------------------------------------------------------------------------------------- fixtures
T0 = dt.datetime(2026, 10, 20, 12, 0, tzinfo=UTC)
def _m(sec): return T0 + dt.timedelta(seconds=sec)
def _rr(sec, aid, phase, **kw): return {'t': _m(sec), 'name': '_watchdog_rescue', 'args': {'attempt': aid, 'level': kw.pop('level', 2), 'remedy': 'home', 'phase': phase, **kw}}
def _sk(sec, name, trigger, dur_s, status='aborted', fc='interrupted'): return {'t': _m(sec), 'name': name, 'trigger': trigger, 'dur': int(dur_s * 1000), 'status': status, 'fc': fc}


def fixture_g3():
    """-> (good, defective) logs: [(atts, skill_rows, verdicts, end)]."""
    end = _m(5000)
    # GOOD: a rescue starts, a tick lands while it runs (tick_seen), it completes; a later verdict is on its own window
    good_rows = [_rr(0, 'a1', 'requested'), _rr(3, 'a1', 'started', run_started=_m(3).isoformat()), _rr(18, 'a1', 'tick_seen'),
                 _rr(150, 'a1', 'completed:success')]
    good = (attempts_of(good_rows), [_sk(3, 'home', 'watchdog_home', 147, 'success', None)], [(_m(0), _m(-180)), (_m(400), _m(200))], end)
    # GOOD too: a stuck rescue cut by a LEGITIMATE verdict on its own window (window_from after its start)
    good2_rows = [_rr(0, 'a2', 'requested'), _rr(2, 'a2', 'started', run_started=_m(2).isoformat()), _rr(17, 'a2', 'tick_seen'),
                  _rr(185, 'a2', 'interrupted:stagnation')]
    good2 = (attempts_of(good2_rows), [_sk(2, 'home', 'interrupt:stagnation', 183)], [(_m(0), _m(-180)), (_m(184), _m(4))], end)
    # DEFECTIVE 1: cut at 15 s by a verdict on the OLD window (the H2b defect)
    d1_rows = [_rr(0, 'b1', 'requested'), _rr(1, 'b1', 'started', run_started=_m(1).isoformat()), _rr(16, 'b1', 'interrupted:stagnation')]
    d1 = (attempts_of(d1_rows), [_sk(1, 'home', 'interrupt:stagnation', 15)], [(_m(0), _m(-180)), (_m(15), _m(-165))], end)
    # DEFECTIVE 2: a delayed handoff (starts 10 s after the verdict) cut 5 s later
    d2_rows = [_rr(0, 'b2', 'requested'), _rr(10, 'b2', 'started', run_started=_m(10).isoformat()), _rr(15, 'b2', 'interrupted:stagnation')]
    d2 = (attempts_of(d2_rows), [_sk(10, 'goto', 'interrupt:stagnation', 5)], [(_m(0), _m(-180)), (_m(15), _m(-150))], end)
    # DEFECTIVE 3: cut before 10 s, no tick ever seen -- still an opportunity (cut at any age) and a defect
    d3_rows = [_rr(0, 'b3', 'requested'), _rr(1, 'b3', 'started', run_started=_m(1).isoformat()), _rr(8, 'b3', 'interrupted:stagnation')]
    d3 = (attempts_of(d3_rows), [_sk(1, 'home', 'interrupt:stagnation', 7)], [(_m(0), _m(-180)), (_m(8), _m(-170))], end)
    # DEFECTIVE 4: the rescue starts only after a FULL 20 s reservation (a slow unwind) and is cut 5 s later on the old window
    d4_rows = [_rr(0, 'b4', 'requested'), _rr(20, 'b4', 'started', run_started=_m(20).isoformat()), _rr(25, 'b4', 'interrupted:stagnation')]
    d4 = (attempts_of(d4_rows), [_sk(20, 'home', 'interrupt:stagnation', 5)], [(_m(0), _m(-180)), (_m(25), _m(-155))], end)
    # GOOD 3: the same 20 s handoff, and a verdict on the rescue's own window (window_from after its start) 170 s later
    g3_rows = [_rr(0, 'a3', 'requested'), _rr(20, 'a3', 'started', run_started=_m(20).isoformat()), _rr(35, 'a3', 'tick_seen'),
               _rr(190, 'a3', 'interrupted:stagnation')]
    good3 = (attempts_of(g3_rows), [_sk(20, 'home', 'interrupt:stagnation', 170)], [(_m(0), _m(-180)), (_m(190), _m(22))], end)
    return [good, good2, good3], [d1, d2, d3, d4]


def fixture_g4():
    end = _m(5000)
    no_terminal = attempts_of([_rr(0, 'c1', 'requested'), _rr(1, 'c1', 'started', run_started=_m(1).isoformat())])
    reconnect = attempts_of([_rr(0, 'c2', 'requested', level=3), _rr(0, 'c2', 'reconnected', level=3)])
    declined = attempts_of([_rr(0, 'c3', 'requested'), _rr(20, 'c3', 'declined:reserve_expired')])
    return end, no_terminal, reconnect, declined


def g3_fixtures_ok():
    good, bad = fixture_g3()
    try:
        return (all(g3_eval(*g)[1] == 0 and g3_eval(*g)[0] == 1 for g in good)
                and all(g3_eval(*b)[1] == 1 and g3_eval(*b)[0] == 1 for b in bad))
    except Exception:
        return False


def g4_fixtures_ok():
    try:
        end, nt, rc, de = fixture_g4()
        a, b, c = g4_eval(nt, end), g4_eval(rc, end), g4_eval(de, end)
        return (a['opps'] == 1 and a['defects'] == 1 and b['opps'] == 1 and b['defects'] == 0
                and c['opps'] == 1 and c['defects'] == 0 and c['declined']['reserve_expired'] == 1)
    except Exception:
        return False


def g1b_fixtures_ok():
    home = (355, 73, 147)
    try:
        h9 = [{'t': _m(0), 'name': 'home', 'status': 'success', 'pos': {'x': 356.5, 'y': 63, 'z': 147.5}, 'moved': 30},
              {'t': _m(9), 'name': 'home', 'status': 'success', 'pos': {'x': 354.5, 'y': 63, 'z': 148.5}, 'moved': 12}]
        ok = [{'t': _m(20), 'name': 'home', 'status': 'success', 'pos': {'x': 357.5, 'y': 73, 'z': 148.5}, 'moved': 40}]
        return g1b_rows(h9, home)[1] == 2 and g1b_rows(ok, home)[1] == 0
    except Exception:
        return False


def selftest():
    assert D_G1 == 2 and D_G3 == 8, (D_G1, D_G3)
    assert d_needed(P_G2['home']) == 15 and d_needed(0.577) == 4
    assert deadline_for(4) == 540 and deadline_for(5) == 540 and deadline_for(3) == 720 and deadline_for(2) == 1080 and deadline_for(1) == 1080
    home = (355, 73, 147)
    # G1: the band, the moved >= 2 filter, the interrupt filter; 2.5 out graded travel_incomplete is the defect
    rows = [{'t': _m(0), 'name': 'home', 'trigger': 'llm:idle', 'status': 'failed', 'fc': 'travel_incomplete', 'moved': 40, 'pos': {'x': 357.5, 'y': 73, 'z': 147.0}},
            {'t': _m(1), 'name': 'home', 'trigger': 'watchdog_home', 'status': 'success', 'moved': 40, 'pos': {'x': 357.6, 'y': 72, 'z': 147.0}},
            {'t': _m(2), 'name': 'home', 'trigger': 'interrupt:entombed', 'status': 'aborted', 'fc': 'interrupted', 'moved': 40, 'pos': {'x': 357.5, 'y': 73, 'z': 147}},
            {'t': _m(3), 'name': 'home', 'trigger': 'llm:idle', 'status': 'unknown', 'fc': 'no_measurable_change', 'moved': 0, 'pos': {'x': 357.5, 'y': 73, 'z': 147}},
            {'t': _m(4), 'name': 'home', 'trigger': 'llm:idle', 'status': 'success', 'moved': 30, 'pos': {'x': 356.5, 'y': 73, 'z': 147}},   # inside 2: not evidence
            {'t': _m(5), 'name': 'home', 'trigger': 'llm:idle', 'status': 'failed', 'fc': 'travel_incomplete', 'moved': 30, 'pos': {'x': 358.5, 'y': 80, 'z': 147}},  # dy 7: out
            {'t': _m(6), 'name': 'goto', 'trigger': 'llm:idle', 'status': 'failed', 'moved': 30, 'pos': {'x': 357.5, 'y': 73, 'z': 147}}]
    assert g1_rows(rows, home)[:2] == (2, 1), g1_rows(rows, home)
    assert in_band({'x': 357.9, 'y': 78.9, 'z': 147}, home) and not in_band({'x': 358.01, 'y': 73, 'z': 147}, home) and not in_band({'x': 357, 'y': 73, 'z': 147}, home)
    # ROUNDING (Claude code r1 P2-1): rows within EPS of an edge are not evidence either way
    assert not in_band({'x': 358.0, 'y': 73, 'z': 147}, home), 'a rounded 3.0 may be a true 3.04 failure'
    assert not over_accepted({'x': 358.0, 'y': 73, 'z': 147.4}, home), 'a rounded 3.03 may be a true 2.99 success'
    assert over_accepted({'x': 358.2, 'y': 73, 'z': 147}, home) and in_band({'x': 357.5, 'y': 73, 'z': 147}, home)
    assert not in_band({'x': 357.5, 'y': 79, 'z': 147}, home) and not over_accepted({'x': 357.5, 'y': 79, 'z': 147}, home)
    assert wilson_lower(0, 20) == 0 or wilson_lower(0, 20) < 1e-9
    assert wilson_lower(3, 20) < RE_BAR < wilson_lower(4, 20), (wilson_lower(3, 20), wilson_lower(4, 20))
    # COVERAGE (Claude/Codex code r2): an all-old-build canary bot has no on-build post row, stubs included
    cut = _m(0)
    rows_old = [('gather', 'aaaa1111', _m(10)), ('home', 'aaaa1111', _m(20)), ('_death', 'aaaa1111', _m(30)), ('_pickups', 'aaaa1111', _m(40))]
    got = [classify(n, v, tt, 'canary', cut, 'bbbb2222') for n, v, tt in rows_old]
    assert got == [('offbuild', 'stub'), ('offbuild', 'full'), ('offbuild', 'full'), ('drop', None)], got
    assert not any(w == 'post' and on_build(v, 'canary', 'bbbb2222') for (w, _), (_, v, _) in zip(got, rows_old))
    assert classify('gather', 'bbbb2222+x', _m(10), 'canary', cut, 'bbbb2222') == ('post', 'stub') and on_build('bbbb2222+x', 'canary', 'bbbb2222')
    assert not on_build('', 'canary', 'bbbb2222'), 'a versionless row does not prove the canary build'
    assert classify('gather', 'aaaa1111', _m(-10), 'canary', cut, 'bbbb2222') == ('pre', 'stub') and classify('home', 'aaaa1111', _m(10), 'control', cut, 'bbbb2222') == ('post', 'full')
    # G1b
    assert g1b_fixtures_ok()
    assert g1b_rows(rows, home)[:2] == (2, 0)
    # G2: home/surface under interrupt:* filed skill_error; the mix decides D
    r2 = [_sk(0, 'home', 'interrupt:entombed', 9, 'failed', 'skill_error'), _sk(1, 'surface', 'interrupt:stuck', 9),
          _sk(2, 'home', 'llm:idle', 9, 'failed', 'skill_error'), _sk(3, 'gather', 'interrupt:entombed', 9, 'failed', 'skill_error')]
    o2, d2, _ = g2_rows(r2)
    assert dict(o2) == {'home': 1, 'surface': 1} and d2 == 1
    assert not g2_complete(Counter(home=14)) and g2_complete(Counter(home=15)) and g2_need(Counter(home=3)) == 15
    assert not g2_complete(Counter(surface=4)) and g2_complete(Counter(surface=5)), 'the floor of 5 binds an all-surface arm'
    assert g2_complete(Counter(surface=2, home=2)) is False and g2_complete(Counter(surface=2, home=3)) is True, 'floor binds'
    assert g2_complete(Counter(surface=1, home=8)) is False and g2_complete(Counter(surface=1, home=9)) is True, 'the mix binds'
    # G3: fixtures, both directions
    assert g3_fixtures_ok()
    good, bad = fixture_g3()
    assert [g3_eval(*b)[1] for b in bad] == [1, 1, 1, 1]
    # an attempt that was never ticked nor cut is not an opportunity; a pending one near the boundary is not unjoined
    nt = attempts_of([_rr(0, 'n1', 'requested'), _rr(1, 'n1', 'started', run_started=_m(1).isoformat()), _rr(30, 'n1', 'completed:success')])
    assert g3_eval(nt, [_sk(1, 'home', 'watchdog_home', 29, 'success', None)], [], _m(5000))[:3] == (0, 0, 0)
    # with no skill row the TERMINAL stands in: a completed rescue is no opportunity (no tick), not unjoined
    assert g3_eval(nt, [], [], _m(5000))[:3] == (0, 0, 0)
    # ...and a stagnation-cut terminal with no row is still the defect (Codex r1 P1)
    cutnr = attempts_of([_rr(0, 'q1', 'requested'), _rr(1, 'q1', 'started', run_started=_m(1).isoformat()), _rr(16, 'q1', 'interrupted:stagnation')])
    assert g3_eval(cutnr, [], [(_m(15), _m(-165))], _m(5000))[:3] == (1, 1, 0)
    # neither row nor terminal: unjoined (blocking), unless pending at the boundary or censored by a respawn
    lone = attempts_of([_rr(0, 'u1', 'requested'), _rr(1, 'u1', 'started', run_started=_m(1).isoformat())])
    assert g3_eval(lone, [], [], _m(5000))[2] == 1 and g3_eval(lone, [], [], _m(100))[2] == 0 and g3_eval(lone, [], [], _m(5000), [_m(50)])[2] == 0
    # G3 proxy on old-code rows: a watchdog_home row 5 s after a verdict cut at 15 s is a defect; a brain row is not counted
    pr = [_sk(5, 'home', 'interrupt:stagnation', 15), _sk(200, 'home', 'watchdog_home', 100, 'success', None),
          _sk(400, 'home', 'llm:idle', 20, 'failed', 'no_path'), _sk(600, 'goto', 'interrupt:stagnation', 15)]
    assert g3_proxy(pr, [_m(0), _m(190), _m(395)]) == (2, 1), g3_proxy(pr, [_m(0), _m(190), _m(395)])
    # G4: fixtures; the 230 s boundary exclusion; a respawn inside the bound excuses
    assert g4_fixtures_ok()
    end, ntm, rc, de = fixture_g4()
    assert g4_eval(ntm, _m(100))['recent'] == 1 and g4_eval(ntm, end, spawns=[_m(60)])['excused'] == 1
    assert g4_eval(ntm, end, spawns=[_m(60)])['opps'] == 0, 'a censored attempt is not an opportunity (Codex r1 P2)'
    many = attempts_of([x for i in range(20) for x in ([_rr(i * 300, 'm%d' % i, 'requested')] + ([_rr(i * 300 + 10, 'm%d' % i, 'completed:success')] if i < 8 else []))])
    g = g4_eval(many, _m(6500), [_m(i * 300 + 10) for i in range(8, 20)])
    assert (g['opps'], g['defects'], g['excused']) == (8, 0, 12), g
    assert g4_eval(ntm, end, spawns=[_m(400)])['defects'] == 1, 'a respawn after the bound does not excuse'
    print('homefixread self-tests passed (G1 D=%d, G2 floor %d / home-only %d, G3 D=%d, G4 D=%d; fixtures G1b %s G3 %s G4 %s)'
          % (D_G1, G2_FLOOR, d_needed(P_G2['home']), D_G3, D_G4, g1b_fixtures_ok(), g3_fixtures_ok(), g4_fixtures_ok()))


if '--selftest' in sys.argv or os.environ.get('HOMEFIXREAD_SELFTEST'):
    selftest()
    sys.exit(0)

# ------------------------------------------------------------------------------------------------------------- the read
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
sys.path.insert(0, '/home/mike/mcai-analysis')
from lib.telemetry import Events, ZeroLooksWrong

selftest()
LOGROOT = os.environ.get('HOMEFIX_LOGROOT', '/var/log/mcai')
ENVDIR = os.environ.get('HOMEFIX_ENVDIR', '/srv/mcbots/harness/env')
man = json.load(open('/srv/mcbots/trial-manifest.json'))
ovr = os.environ.get('CANARY_DRYRUN')
if ovr:
    CAN, CV, ISO = ovr.split(':', 2)
    CUT = dt.datetime.fromisoformat(ISO.replace('Z', '+00:00'))
else:
    CUT = dt.datetime.fromisoformat(man['declared_at'].replace('Z', '+00:00'))
    CAN = man['canary_pool']; CV = man.get('canary_code_version') or ''
CANS = {x.strip() for x in str(CAN).split(',') if x.strip()}
now = dt.datetime.now(UTC)
elapsed = (now - CUT).total_seconds() / 60
assert elapsed > 0 and CAN, 'no canary declared'
args = [a for a in sys.argv[1:] if not a.startswith('--')]
W = min(elapsed, float(args[0]) if args else 180)
END = CUT + dt.timedelta(minutes=W)
PRE = CUT - dt.timedelta(hours=PRE_H)
NPOOLS = len(CANS)
DEADLINE = deadline_for(NPOOLS)


def pool_of(bot):
    return '-'.join((bot or '').split('-')[:2])


def home_of(bot):
    """config.world home: HOME_X/Y/Z in the bot's env file (the town-chest-<home> key). None if unreadable."""
    try:
        kv = dict(l.strip().split('=', 1) for l in open(os.path.join(ENVDIR, bot + '.env')) if '=' in l and not l.startswith('#'))
        return (float(kv['HOME_X']), float(kv['HOME_Y']), float(kv['HOME_Z']))
    except Exception:
        return None


def compact(r):
    raw = r.get('raw') or {}
    sk = raw.get('skill') or {}
    b = raw.get('bot') or {}
    return {'t': r['t'], 'name': r['name'], 'status': sk.get('status'), 'fc': sk.get('fail_class'), 'trigger': raw.get('trigger'),
            'dur': sk.get('duration_ms') or 0, 'moved': sk.get('distance_moved'), 'pos': b.get('pos'), 'health': b.get('health'),
            'args': sk.get('args') if r['name'].startswith('_') else None, 'detail': (sk.get('detail') or '')[:160],
            'ver': ((raw.get('code') or {}).get('version') or '')}


bots = sorted(os.path.basename(d.rstrip('/')) for d in glob.glob(LOGROOT + '/*/') if glob.glob(d + 'skill-*.jsonl*'))
walked = 0; first_t = last_t = None
per = {}                     # bot -> {'pre': [...], 'post': [...]}
offbuild = 0; blind = []
for bot in bots:
    try:
        ev = Events.load(paths='%s/%s/skill-*.jsonl*' % (LOGROOT, bot), since=PRE, until=END)
    except ZeroLooksWrong:
        continue
    except Exception as e:
        blind.append((bot, type(e).__name__)); continue
    seen = set(); pre, post = [], []; onb = 0
    arm = 'canary' if pool_of(bot) in CANS else 'control'
    for r in ev.rows:
        key = (r['t'], r['name'], r['detail'][:80])
        if key in seen:
            continue
        seen.add(key)
        walked += 1
        first_t = r['t'] if first_t is None or r['t'] < first_t else first_t
        last_t = r['t'] if last_t is None or r['t'] > last_t else last_t
        raw = r.get('raw') or {}
        ver = ((raw.get('code') or {}).get('version') or '')
        where, kind = classify(r['name'], ver, r['t'], arm, CUT, CV)
        if where == 'offbuild':
            offbuild += 1; continue
        if where == 'drop':
            continue
        if where == 'post' and on_build(ver, arm, CV):
            onb += 1
        if kind == 'stub':
            h = (raw.get('bot') or {}).get('health')
            if h is not None:
                (post if where == 'post' else pre).append({'t': r['t'], 'name': '.', 'health': h, 'ver': ver})
            continue
        (post if where == 'post' else pre).append(compact(r))
    pre.sort(key=lambda x: x['t']); post.sort(key=lambda x: x['t'])
    per[bot] = {'pre': pre, 'post': post, 'arm': arm, 'on_build': onb}
    del ev

can_bots = [b for b in per if per[b]['arm'] == 'canary']
ctl_bots = [b for b in per if per[b]['arm'] == 'control']
print('rows walked %d (%s .. %s) | bots %d (canary %d, control %d) | canary %s (%d pools) sha %s cutoff %s window +%d min | pre %d h'
      % (walked, first_t and first_t.strftime('%m-%d %H:%MZ'), last_t and last_t.strftime('%m-%d %H:%MZ'), len(per), len(can_bots),
         len(ctl_bots), ','.join(sorted(CANS)), NPOOLS, CV[:8], CUT.strftime('%m-%d %H:%MZ'), W, PRE_H))
if blind:
    print('UNREADABLE bot logs: %s' % blind[:6])
nohome = [b for b in can_bots if home_of(b) is None]
# COVERAGE (Codex r1 P1): every ENABLED canary bot must be in the walk with post rows, or healthy bots elsewhere could
# hide a missing one. The roster is the systemd enablement (verdict.py's own source for tier-2 baselines).
ROSTER = os.environ.get('HOMEFIX_ROSTER_DIR', '/etc/systemd/system/multi-user.target.wants')
try:
    enabled = sorted(n[len('mcbot@'):-len('.service')] for n in os.listdir(ROSTER)
                     if n.startswith('mcbot@') and n.endswith('.service') and n != 'mcbot@.service')
except OSError:
    enabled = []
roster_can = [b for b in enabled if pool_of(b) in CANS]
# SILENT = no post row ON THE CANARY BUILD (Claude code r2 P2-1, Codex code r2 P1): a bot whose restart failed keeps writing
# old-build rows, and those must not count as coverage
silent = [b for b in roster_can if not (per.get(b) or {}).get('on_build')]

# ---- the gates on the arm (post) and their pre-period controls (the arm's own pools, old code)
G = Counter(); mix = Counter(); mix_pre = Counter(); ex = []
g4 = {'opps': 0, 'defects': 0, 'excused': 0, 'recent': 0, 'declined': Counter(), 'orphan': 0}
licence = rows_ctl = 0; deaths_after_rescue = 0
for b in can_bots:
    home = home_of(b)
    post, pre = per[b]['post'], per[b]['pre']
    o, d, e = g1_rows(post, home); G['g1_opps'] += o; G['g1_defects'] += d; ex += e
    o, d, _ = g1_rows(pre, home); G['g1_pre_opps'] += o; G['g1_pre_defects'] += d
    o, d, e = g1b_rows(post, home); G['g1b_opps'] += o; G['g1b_defects'] += d; ex += e
    o, d, _ = g1b_rows(pre, home); G['g1b_pre_defects'] += d
    o, d, e = g2_rows(post); mix.update(o); G['g2_defects'] += d; ex += e
    o, d, _ = g2_rows(pre); mix_pre.update(o); G['g2_pre_defects'] += d
    atts = attempts_of(post)
    skill_post = [r for r in post if r['name'] in RESCUE_SKILLS]
    verdicts = [(r['t'], parse_t((r.get('args') or {}).get('window_from'))) for r in post if r['name'] == '_stagnation']
    spawns = [r['t'] for r in post if r['name'] == SPAWN_MARK]
    o, d, un, e = g3_eval(atts, skill_post, verdicts, END, spawns); G['g3_opps'] += o; G['g3_defects'] += d; G['g3_unjoined'] += un; ex += e
    po, pd = g3_proxy([r for r in pre if r['name'] in RESCUE_SKILLS], [r['t'] for r in pre if r['name'] == '_stagnation'])
    G['g3_proxy_pre_opps'] += po; G['g3_proxy_pre_defects'] += pd
    x = g4_eval(atts, END, spawns)
    for k in ('opps', 'defects', 'excused', 'recent', 'orphan'):
        g4[k] += x[k]
    g4['declined'].update(x['declined']); ex += x['ex']
    licence += sum(1 for r in post if r['name'] == '_watchdog_rescue')
    starts = [a['started'] for a in atts.values() if a['started']]
    deaths_after_rescue += sum(1 for r in post if r['name'] == '_death'
                               and any(s < r['t'] <= s + dt.timedelta(seconds=DEATH_AFTER_RESCUE_S) for s in starts))
for b in ctl_bots:
    rows_ctl += sum(1 for r in per[b]['post'] if r['name'] == '_watchdog_rescue')

g1_ok_ctl = G['g1_pre_defects'] >= 1
g2_ok_ctl = G['g2_pre_defects'] >= 1
g3_fix = g3_fixtures_ok(); g4_fix = g4_fixtures_ok(); g1b_fix = g1b_fixtures_ok()
g3_ok_ctl = G['g3_proxy_pre_defects'] >= 1 and g3_fix
g2_d = g2_need(mix)
re_n = g4['declined']['reserve_expired']
re_rate = re_n / g4['opps'] if g4['opps'] else None
re_bar_fail = int(g4['opps'] >= D_G4 and re_rate is not None and re_rate > RE_BAR)
# THE DEFECT PATH THE SPEC NAMES, without the small-n false trip (Claude code r1 P3-7): REVERT only when the one-sided 95%
# LOWER bound of the reserve_expired rate is above the 8% bar (at n = 20 that needs >= 4 of 20, which a true 4.1% reaches
# 0.8% of the time; at n = 180, >= 21). The point estimate above the bar alone BLOCKS KEEP (re_bar_fail).
re_lcb = wilson_lower(re_n, g4['opps'])
re_lcb_fail = int(g4['opps'] >= D_G4 and re_lcb is not None and re_lcb > RE_BAR)
complete = {'G1': G['g1_opps'] >= D_G1, 'G2': g2_complete(mix), 'G3': G['g3_opps'] >= D_G3, 'G4': g4['opps'] >= D_G4}
gates_complete = int(all(complete.values()))
at_deadline = W >= DEADLINE - 1
exposure_ready = int(gates_complete or at_deadline)
defects = G['g1_defects'] + G['g1b_defects'] + G['g2_defects'] + G['g3_defects'] + g4['defects']

# ---- guards (DiD; reported, never a verdict here)
def bot_h(arm, period):
    bs = can_bots if arm == 'canary' else ctl_bots
    hrs = PRE_H if period == 'pre' else W / 60
    return sum(1 for b in bs if per[b][period]) * hrs


def count(arm, period, pred):
    bs = can_bots if arm == 'canary' else ctl_bots
    return sum(1 for b in bs for r in per[b][period] if pred(r))


def did(pred):
    v = {}
    for arm in ('canary', 'control'):
        for p in ('pre', 'post'):
            h = bot_h(arm, p)
            v[(arm, p)] = count(arm, p, pred) / h if h else float('nan')
            v[(arm, p, 'n')] = count(arm, p, pred); v[(arm, p, 'h')] = h
    return (v[('canary', 'post')] - v[('canary', 'pre')]) - (v[('control', 'post')] - v[('control', 'pre')]), v


def l1(r):
    if r['name'] != '_stagnation':
        return False
    a = r.get('args') or {}
    if a.get('escalation') is not None:
        return str(a.get('escalation')) == '1'
    return bool(re.search(r'escalation 1$', r.get('detail') or ''))


guards = {
    'deaths': did(lambda r: r['name'] == '_death'),
    'stranded': did(lambda r: r['name'].startswith('_stranded')),
    'stagnation_l1': did(l1),
    'reconnect': did(lambda r: r['name'] == '_stagnation_reconnect'),
}
reloc = Counter((r.get('status'), r.get('fc')) for b in can_bots for r in per[b]['post'] if r['name'] == 'goto' and r.get('trigger') == 'watchdog_relocate')
reloc_ctl = Counter(r.get('status') for b in ctl_bots for r in per[b]['post'] if r['name'] == 'goto' and r.get('trigger') == 'watchdog_relocate')


def home_success(arm, period, s0=False):
    n = k = 0
    bs = can_bots if arm == 'canary' else ctl_bots
    for b in bs:
        rows = per[b][period]
        for i, r in enumerate(rows):
            if r['name'] != 'home':
                continue
            if s0:
                # S0-LIKE (approximate; the overseer's validator owns the real filter): no interrupt:stagnation, start health
                # (the previous row's) known and > 10, and no drowning/trap/low-health event in the 5 min before
                if r.get('trigger') == 'interrupt:stagnation':
                    continue
                prev = next((q for q in reversed(rows[:i]) if q.get('health') is not None), None)
                if prev is None or (prev.get('health') or 0) <= 10:
                    continue
                if any(q['name'].startswith(('_drown', '_trap', '_low_health')) and r['t'] - dt.timedelta(minutes=5) <= q['t'] <= r['t'] for q in rows[max(0, i - 200):i]):
                    continue
            n += 1; k += r.get('status') == 'success'
    return k, n


hs = {(a, p, s): home_success(a, p, s) for a in ('canary', 'control') for p in ('pre', 'post') for s in (False, True)}
fmt = lambda kn: '%d/%d (%s)' % (kn[0], kn[1], ('%.0f%%' % (100 * kn[0] / kn[1])) if kn[1] else '-')

print('-' * 100)
readable = bool(walked and can_bots and ctl_bots and not blind and not nohome and roster_can and not silent)
print('LIVENESS     canary _watchdog_rescue rows %d (>= 1) | ARMS control _watchdog_rescue rows %d (must be 0) | off-build canary rows %d%s'
      % (licence, rows_ctl, offbuild, (' | canary bots with no readable home: %s' % nohome) if nohome else ''))
print('COVERAGE     enabled canary bots %d, silent (no post row on the canary build) %d %s, unreadable logs %d -> readable %s%s'
      % (len(roster_can), len(silent), silent[:5], len(blind), readable,
         ('  [THE ROSTER %s IS UNREADABLE OR EMPTY: coverage cannot be shown, so KEEP is blocked -- not a bot failure]' % ROSTER) if not enabled else ''))
print('G1  arrival  opps %d / D %d  defects %d | CONTROL pre-period (old code) %d defects in %d opps -> %s'
      % (G['g1_opps'], D_G1, G['g1_defects'], G['g1_pre_defects'], G['g1_pre_opps'], 'OK' if g1_ok_ctl else 'VOID'))
print('G1b mirror   home successes %d  over-accepted %d | CONTROL fixtures (h9 dy -10) %s; pre-period over-accepted %d (reported)'
      % (G['g1b_opps'], G['g1b_defects'], 'OK' if g1b_fix else 'VOID', G['g1b_pre_defects']))
print('G2  classify opps %d %s / need %d (P(0|no fix) %.3f)  defects %d | CONTROL pre-period %d defects in %s -> %s'
      % (sum(mix.values()), dict(mix), g2_d, g2_p0(mix), G['g2_defects'], G['g2_pre_defects'], dict(mix_pre), 'OK' if g2_ok_ctl else 'VOID'))
print('G3  survives opps %d / D %d  defects %d  (started, no skill row past the bound: %d) | CONTROL proxy pre %d defects in %d opps (%s), fixtures %s -> %s'
      % (G['g3_opps'], D_G3, G['g3_defects'], G['g3_unjoined'], G['g3_proxy_pre_defects'], G['g3_proxy_pre_opps'],
         ('%.0f%%' % (100 * G['g3_proxy_pre_defects'] / G['g3_proxy_pre_opps'])) if G['g3_proxy_pre_opps'] else '-',
         'pass' if g3_fix else 'FAIL', 'OK' if g3_ok_ctl else 'VOID'))
print('G4  reachable opps %d / D %d  no-terminal defects %d  excused (respawn) %d  recent (< %d s, excluded) %d  orphan %d | declined %s'
      % (g4['opps'], D_G4, g4['defects'], g4['excused'], PENDING_BOUND_S, g4['recent'], g4['orphan'], dict(g4['declined'])))
print('             reserve_expired %d = %s of attempts (bar %.0f%%, judged from %d attempts: %s) | CONTROL fixtures %s'
      % (re_n, ('%.1f%%' % (100 * re_rate)) if re_rate is not None else '-', 100 * RE_BAR, D_G4,
         ('FAIL' if re_bar_fail else 'ok') + ('; 95%% lower bound %.1f%% -> %s' % (100 * re_lcb, 'DEFECT' if re_lcb_fail else 'ok') if re_lcb is not None else ''),
         'OK' if g4_fix else 'VOID'))
print('EXPOSURE     gates complete %s -> %d | arm-size deadline +%d (%d pools) %s -> exposure_ready %d'
      % (complete, gates_complete, DEADLINE, NPOOLS, 'REACHED' if at_deadline else 'not yet', exposure_ready))
for k, (dv, v) in guards.items():
    print('GUARD %-14s per bot-h canary pre %.3f (%d/%.0f) post %.3f (%d/%.0f) | control pre %.3f (%d/%.0f) post %.3f (%d/%.0f) | DiD %+.3f'
          % ((k,) + tuple(x for a in ('canary', 'control') for p_ in ('pre', 'post') for x in (v[(a, p_)], v[(a, p_, 'n')], v[(a, p_, 'h')])) + (dv,)))
print('GUARD canary deaths within %d s after a rescue start: %d | relocations canary %s, control %s'
      % (DEATH_AFTER_RESCUE_S, deaths_after_rescue, dict(reloc), dict(reloc_ctl)))
print('REPORTED home success all rows: canary pre %s post %s | control pre %s post %s'
      % (fmt(hs[('canary', 'pre', False)]), fmt(hs[('canary', 'post', False)]), fmt(hs[('control', 'pre', False)]), fmt(hs[('control', 'post', False)])))
print('REPORTED home success S0-like:  canary pre %s post %s | control pre %s post %s'
      % (fmt(hs[('canary', 'pre', True)]), fmt(hs[('canary', 'post', True)]), fmt(hs[('control', 'pre', True)]), fmt(hs[('control', 'post', True)])))
for x in ex[:8]:
    print('  defect:', x)

try:
    if ovr:
        raise RuntimeError('CANARY_DRYRUN set -- not emitting')
    sys.path.insert(0, os.path.expanduser('~')); sys.path.insert(0, '/tmp')
    from readjson import emit
    r3 = lambda v: None if v is None or v != v else round(v, 4)
    emit('homefixread', W, {
        'rows_walked': walked, 'canary_bots': len(can_bots), 'control_bots': len(ctl_bots), 'offbuild_canary': offbuild,
        'readable': int(readable), 'canary_bots_enabled': len(roster_can), 'canary_bots_silent': len(silent),
        'licence_canary': licence, 'rows_control': rows_ctl,
        'g1_opps': G['g1_opps'], 'g1_defects': G['g1_defects'], 'g1_need': D_G1, 'g1_pre_defects': G['g1_pre_defects'], 'g1_control_ok': int(g1_ok_ctl),
        'g1b_opps': G['g1b_opps'], 'g1b_defects': G['g1b_defects'], 'g1b_control_ok': int(g1b_fix), 'g1b_pre_defects': G['g1b_pre_defects'],
        'g2_opps': sum(mix.values()), 'g2_opps_home': mix['home'], 'g2_opps_surface': mix['surface'], 'g2_defects': G['g2_defects'],
        'g2_need': g2_d, 'g2_p0': r3(g2_p0(mix)), 'g2_pre_defects': G['g2_pre_defects'], 'g2_control_ok': int(g2_ok_ctl),
        'g3_opps': G['g3_opps'], 'g3_defects': G['g3_defects'], 'g3_unjoined': G['g3_unjoined'], 'g3_need': D_G3,
        'g3_proxy_pre_opps': G['g3_proxy_pre_opps'], 'g3_proxy_pre_defects': G['g3_proxy_pre_defects'], 'g3_fixtures_ok': int(g3_fix),
        'g3_control_ok': int(g3_ok_ctl),
        'g4_opps': g4['opps'], 'g4_defects': g4['defects'], 'g4_excused': g4['excused'], 'g4_recent': g4['recent'], 'g4_need': D_G4,
        'g4_reserve_expired': re_n, 'g4_reserve_expired_rate': r3(re_rate), 'g4_reserve_bar_fail': re_bar_fail,
        'g4_reserve_lcb': r3(re_lcb), 'g4_reserve_lcb_fail': re_lcb_fail,
        'g4_body_held': g4['declined']['body_held'], 'g4_runner_paused': g4['declined']['runner_paused'], 'g4_control_ok': int(g4_fix),
        'defects': defects, 'gates_complete': gates_complete, 'deadline_min_for_pools': DEADLINE, 'pools': NPOOLS,
        'at_deadline': int(at_deadline), 'exposure_ready': exposure_ready,
        'deaths_after_rescue_120s': deaths_after_rescue,
        'deaths_did': r3(guards['deaths'][0]), 'stranded_did': r3(guards['stranded'][0]), 'stagnation_l1_did': r3(guards['stagnation_l1'][0]),
        'reconnect_did': r3(guards['reconnect'][0]),
        'home_success_canary_post': list(hs[('canary', 'post', False)]), 'home_success_s0_canary_post': list(hs[('canary', 'post', True)]),
    })
except Exception as e:
    print('emit failed:', e)
