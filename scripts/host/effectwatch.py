#!/usr/bin/env python3
"""effectwatch.py -- did each promoted change move the thing it was built to move? (effectwatch-01, OWNER 11-03 item 1)

    effectwatch.py run [--no-push] [--print] [--since 2026-10-28] [--now ISO]
    effectwatch.py report <run> [--horizon h24|h72]        # recompute and print one read; writes nothing
    effectwatch.py validate <registration.json>            # check an `effect` field (and its metric on the last 24 h)
    effectwatch.py busy [--hours 24] [--end ISO]           # busy-time shares from the cache

READ-AND-ALARM ONLY. It reads the canary journal, the registrations, config/effect-targets.json and the hourly cache
(effectcache.py); it never touches the queue, the scheduler, a manifest or a bot. A canary KEEP is "nothing objected";
this is the separate question the gate never asks (verdict.py lists `primary` as advisory).

THE READ, per promotion and target (lib/effectmetrics names the metric), at two horizons:
  baseline  B   = the W hours before the target's canary DEPLOYED (so its own canary pools never sit in it), W = 24 or 72
  h24       P24 = 24 h from the first whole hour after promotion + 1 h (the restart hour is dropped)
  h72       P72 = hours +48..+72 of the same clock (persistence); a 72-h metric (rare events) reads all 72 h here
  cells     a (bot, hour, build) cell counts only when its build is a PROMOTED build and the hour is after that build's
            promotion (a canary of anything is excluded), the baseline only on builds before the target, the post only on
            the target or later; cells whose model calls are mostly NOT the hour's majority model are excluded (an
            owner-direct model A/B such as qwen35-roll, 15 bots 11-01 22:25Z..11-02 22:35Z, is dropped without a list)
  delta     signed so + is the claimed direction; relative (default: the LOG RATIO post/base, printed as a percent;
            a halving and a doubling are the same size) or absolute (target scale)
  noise     the SAME read placed 1..7 days earlier (placebo anchors, builds before the target only): tau = max(2 sd, floor)
  pools     the 16 pools, each a cluster: the share of eligible pools moving the same way as the fleet

VERDICTS (each with its numerator, denominator, bots and bot-hours on the line):
  UNREADABLE  a cache hole, coverage < 40 % of nominal bot-hours, rows/bot-h changed by 2x (logging changed), too few
              events (share/mean den < 30 a window; rate: < 20 events across both), < 3 placebo anchors, < 8 eligible
              pools, pools split (|delta| >= tau but < 75 % of pools agree), the canary DiD or a same-family overlap
              disagreeing, a zero baseline, a rare metric at h24, or no effect declared
  EFFECT      delta >= tau, >= 75 % of pools agree, and delta >= half the declared minimum
  WORSE       delta <= -tau and >= 75 % of pools agree (or a guardrail is WORSE)
  NO-EFFECT   |delta| < tau, or it moved but by less than half the declared minimum

OVERLAPS. Several promotions land a day. Every promotion between the baseline start and the post end is named with its
offset. One that declares the SAME metric (same family) is a joint read: the post is recomputed without its hours and a
verdict that changes becomes UNREADABLE "joint with X".

THE CANARY DiD. The 3 h the canary pools ran the change before promotion: canary vs control pools, relative to the same
pools a day earlier. Reported; it vetoes EFFECT / WORSE (-> UNREADABLE) only when it is itself readable and points the
other way by >= tau.

OUTPUT
  ~/digest/effect/<run>/<h24|h72>.json   write-once (O_EXCL); a later recompute never overwrites a committed verdict
  ~/digest/effect-fleet.json             {generated_at, summary, alarms} -> fleetstatus header (alarmhead FILES)
  ~/digest/busy-fleet.json               the 24-h busy-time line -> fleetstatus header
  ~/digest/effect-latest.md              every verdict as a table (the owner / ops audit read)
  ~/digest/effect-ledger-pending.json    the ledger row each NO-EFFECT / WORSE still needs
  alarms (lib/alarm.raise_alarms -> ALARMS.log, journald, ntfy): effect:<run>:<h> for NO-EFFECT / WORSE until the ledger
  (origin/main of ~/stallcheck/repo, as stallcheck reads it) has row `effect-<run>` -- "fix or remove", never silence;
  effect:<run>:undeclared for a promotion with no effect field, no backfill entry and no none_reason.
"""
import argparse
import datetime as dt
import json
import math
import os
import statistics
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..'))
from lib import alarm as AL             # noqa: E402
from lib import busytime as BT          # noqa: E402
from lib import effectmetrics as EM     # noqa: E402
import effectcache as EC                # noqa: E402

UTC = dt.timezone.utc
H1 = dt.timedelta(hours=1)
JOURNAL = '~/canary-journal.jsonl'
REGDIR = '~/mcai-analysis/registrations'
TARGETS = os.path.join(HERE, '..', '..', 'config', 'effect-targets.json')
STATE = '~/digest'
REPO = '~/stallcheck/repo'
# effect targets are read from origin/main of this clone (fetched each run), the installed copy only as a fallback: the
# copy install-effectwatch.sh made on 11-03 never saw a later entry, so stuckcells-01's none_reason (40d825ad) and every
# entry after it alarmed "no effect declared" on 11-04/05. None = the installed copy only (tests).
TARGETS_REPO = REPO
SINCE = '2026-10-28T00:00:00Z'
DUE_AFTER = dt.timedelta(minutes=20)        # after the cache's FINAL_AFTER
HOLE_GRACE = dt.timedelta(hours=48)
MIN_COVERAGE = 0.40
ROWS_BAND = (0.5, 2.0)
MIN_DEN = 30
MIN_RATE_EVENTS = 20
MIN_RATE_BOT_H = 100
MIN_ANCHORS = 3
ANCHORS = 7
MIN_POOLS = 8
POOL_AGREE = 0.75
FLOOR = {'relative': {'rate': 0.10, 'share': 0.05, 'mean': 0.05}, 'absolute': {'rate': 0.0, 'share': 0.01, 'mean': 0.0}}


def ts(s):
    try:
        return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))
    except (TypeError, ValueError):
        return None


def iso(t):
    return t.astimezone(UTC).strftime('%Y-%m-%dT%H:%M:%SZ')


def hfloor(t):
    return t.replace(minute=0, second=0, microsecond=0)


def hceil(t):
    f = hfloor(t)
    return f if f == t else f + H1


def hours_between(a, b):
    out, h = [], hceil(a)
    while h + H1 <= b:
        out.append(h)
        h += H1
    return out


# ------------------------------------------------------------------------------------------------------------ journal --
def read_journal(path=JOURNAL):
    rows = []
    try:
        with open(os.path.expanduser(path)) as f:
            for line in f:
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
    except OSError:
        pass
    return rows


def promotions(journal):
    """PURE. -> [{'run', 'sha', 'P', 'D', 'R', 'pools'}] oldest first: every `promoted` row with its canary's deployed /
    recorded times and drawn pools (the latest of each before the promotion)."""
    out = []
    for r in journal:
        if r.get('phase') != 'promoted':
            continue
        P = ts(r.get('ts'))
        sha = str(r.get('note') or '').split(' ')[0]
        if P is None or len(sha) < 7:
            continue
        run = r.get('run')
        D = R = None
        pools = []
        for x in journal:
            if x.get('run') != run:
                continue
            t = ts(x.get('ts'))
            if t is None or t > P:
                continue
            if x.get('phase') == 'deployed':
                D = t
            elif x.get('phase') == 'recorded':
                R = t
            elif x.get('phase') == 'drawn':
                pools = [p for p in str(x.get('note') or '').split(' ')[0].split(',') if p]
        if D is None or D < P - dt.timedelta(hours=48):
            D = P - dt.timedelta(hours=4)
        out.append({'run': run, 'sha': sha, 'P': P, 'D': D, 'R': R or P, 'pools': pools})
    out.sort(key=lambda x: x['P'])
    return out


# ------------------------------------------------------------------------------------------------------------ targets --
def load_targets(path=None, repo=None):
    """-> the `runs` map. An explicit path is read as a file. Else origin/main of `repo` (default TARGETS_REPO, fetched
    first), and the installed copy TARGETS only when the clone cannot be read."""
    repo = TARGETS_REPO if repo is None else repo
    if path is None and repo:
        r = os.path.expanduser(repo)
        try:
            subprocess.run(['git', '-C', r, 'fetch', '-q', 'origin'], timeout=60, check=False, capture_output=True)
            out = subprocess.run(['git', '-C', r, 'show', 'origin/main:config/effect-targets.json'],
                                 capture_output=True, text=True, timeout=30, check=True).stdout
            return json.loads(out).get('runs') or {}
        except Exception:       # noqa: BLE001
            pass
    try:
        with open(path or TARGETS) as f:
            return json.load(f).get('runs') or {}
    except (OSError, ValueError):
        return {}


def effect_for(run, regdir=REGDIR, sidecar=None):
    """-> (effect dict or None, source). The registration's own `effect` wins; else the backfill sidecar."""
    try:
        with open(os.path.join(os.path.expanduser(regdir), f'{run}.json')) as f:
            reg = json.load(f)
        if isinstance(reg.get('effect'), dict):
            return reg['effect'], 'registration'
    except (OSError, ValueError):
        pass
    sc = load_targets() if sidecar is None else sidecar
    if run in sc:
        return sc[run], 'config/effect-targets.json'
    return None, 'none'


# -------------------------------------------------------------------------------------------------------------- cells --
class Cache:
    def __init__(self, out=EC.OUT):
        self.out, self.mem = out, {}

    def hour(self, h):
        if h not in self.mem:
            self.mem[h] = EC.load_hour(self.out, h)
        return self.mem[h]


def majority_model(hd):
    tot = {}
    for cells in hd['bots'].values():
        for c in cells.values():
            for m, n in c['llm']['model'].items():
                tot[m] = tot.get(m, 0) + n
    return max(tot, key=tot.get) if tot else None


def dominant_model(c):
    m = c['llm']['model']
    return max(m, key=m.get) if m else None


def select(cache, hours, ok, expo_model=None, want_expo=None):
    """-> (cells [(meta, cell)], controls). ok(sha, hour) decides the build. expo_model / want_expo: a model-env run's
    exposure (post wants cells whose dominant model is expo_model, the baseline the others)."""
    cells, holes, nominal, rows, bh = [], [], 0, 0, 0.0
    for h in hours:
        hd = cache.hour(h)
        if hd is None or hd['controls'].get('bots_with_rows', 0) < hd['controls'].get('bot_dirs', 0) / 2:
            holes.append(iso(h))
            continue
        nominal += hd['controls'].get('bot_dirs', 0)
        maj = majority_model(hd)
        for bot, builds in hd['bots'].items():
            for sha, c in builds.items():
                if not ok(sha, h):
                    continue
                n = c['llm']['n']
                if expo_model is not None:
                    dm = dominant_model(c) or ''
                    if want_expo != (expo_model in dm):
                        continue
                elif n >= 3 and maj is not None and c['llm']['model'].get(maj, 0) / n < 0.5:
                    continue
                cells.append(({'bot': bot, 'pool': c['pool'], 'hour': h, 'sha': sha}, c))
                rows += c['rows']
                bh += EM.obs_h(c)
    return cells, {'hours': len(hours), 'holes': holes, 'nominal_bot_h': nominal, 'bot_h': bh, 'rows': rows,
                   'coverage': (bh / nominal) if nominal else 0.0, 'rows_per_bot_h': (rows / bh) if bh else 0.0}


class Lineage:
    def __init__(self, promos):
        self.idx, self.P = {}, {}
        for i, p in enumerate(promos):
            self.idx.setdefault(p['sha'], i)
            self.P.setdefault(p['sha'], p['P'])

    def fleet(self, sha, h):
        """the build is a promoted one and the hour starts after its promotion (a canary hour of it is not fleet)."""
        P = self.P.get(sha)
        return P is not None and h >= hceil(P)

    def before(self, ti):
        return lambda sha, h: self.fleet(sha, h) and self.idx[sha] < ti

    def from_(self, ti):
        return lambda sha, h: self.fleet(sha, h) and self.idx[sha] >= ti


# ------------------------------------------------------------------------------------------------------------- verdict --
def delta(base, post, scale):
    if base is None or post is None:
        return None
    if scale == 'absolute':
        return post - base
    # RELATIVE IS A LOG RATIO (first real run 11-03: kit_no_iron 64 % -> 0.5 % read NO-EFFECT against a placebo sd
    # inflated by +300 % swings; a percent change is bounded at -100 % and unbounded above, so its sd is lopsided)
    return None if base <= 0 or post <= 0 else math.log(post / base)


def half_minimum(minimum, direction, scale):
    """Half the declared change, in decide()'s units: a claimed -60 % needs at least -30 %."""
    return min_log(minimum / 2.0, direction, scale) if minimum else None


def min_log(minimum, direction, scale):
    """The declared minimum in the units decide() compares: absolute as is; relative as the log ratio it implies
    (an increase of m: ln(1 + m); a decrease of m: -ln(1 - m), m capped at 0.95)."""
    if not minimum or scale == 'absolute':
        return minimum
    return math.log(1 + minimum) if direction == 'increase' else -math.log(1 - min(minimum, 0.95))


def enough(mb, mp):
    """-> '' or why the denominators are too small."""
    if mb['kind'] == 'rate':
        if mb['num'] + mp['num'] < MIN_RATE_EVENTS:
            return f'too few events ({mb["num"]:.0f} + {mp["num"]:.0f} < {MIN_RATE_EVENTS})'
        if min(mb['den'], mp['den']) < MIN_RATE_BOT_H:
            return f'too few bot-hours ({mb["den"]:.0f} / {mp["den"]:.0f} < {MIN_RATE_BOT_H})'
        return ''
    if min(mb['den'], mp['den']) < MIN_DEN:
        return f'denominator too small ({mb["den"]:.0f} / {mp["den"]:.0f} < {MIN_DEN})'
    return ''


def pool_agreement(mb, mp, sign, scale):
    """-> (eligible, agreeing, against). A pool is eligible with den >= 5 in both windows (rates: >= 5 bot-h and >= 3
    events across both)."""
    el = ag = an = 0
    for pool in set(mb['pools']) & set(mp['pools']):
        nb, db = mb['pools'][pool]
        np_, dp = mp['pools'][pool]
        if mb['kind'] == 'rate':
            if min(db, dp) < 5 or nb + np_ < 3:
                continue
        elif min(db, dp) < 5:
            continue
        vb, vp = nb / db, np_ / dp
        d = (vp - vb)
        el += 1
        if d * sign > 0:
            ag += 1
        elif d * sign < 0:
            an += 1
    return el, ag, an


def decide(s, tau, half_min, el, ag, an, scale, sign=1):
    """PURE. s = signed delta (+ = claimed direction); half_min = half the declared minimum in the same units
    (half_minimum()); sign only prints the real direction. -> (verdict, why)."""
    if el < MIN_POOLS:
        return 'UNREADABLE', f'{el} eligible pools < {MIN_POOLS}'
    if s >= tau:
        if ag / el < POOL_AGREE:
            return 'UNREADABLE', f'pools split: {ag}/{el} agree (< {POOL_AGREE:.0%})'
        if half_min and s < half_min:
            return 'NO-EFFECT', (f'moved {fmt_d(sign * s, scale)} but less than half the claimed change '
                                 f'(needs {fmt_d(sign * half_min, scale)})')
        return 'EFFECT', f'{ag}/{el} pools agree'
    if s <= -tau:
        if an / el < POOL_AGREE:
            return 'UNREADABLE', f'pools split: {an}/{el} against (< {POOL_AGREE:.0%})'
        return 'WORSE', f'{an}/{el} pools moved against the claim'
    return 'NO-EFFECT', f'{fmt_d(sign * s, scale)} is within the noise ({fmt_tau(tau, scale)})'


def fmt_tau(tau, scale):
    return f'x/{math.exp(tau):.2f}' if scale == 'relative' else f'+/-{tau:.4g}'


def fmt_d(x, scale):
    """relative values are log ratios: printed as the percent change they mean"""
    return f'{100 * (math.exp(x) - 1):+.1f}%' if scale == 'relative' else f'{x:+.4g}'


def windows(p, W, horizon):
    """-> (baseline hours, post hours) or None (a 72-h metric at h24)."""
    ps = hceil(p['P']) + H1
    base = hours_between(p['D'] - dt.timedelta(hours=W), p['D'])
    if W == 72:
        if horizon == 'h24':
            return None
        post = [ps + i * H1 for i in range(72)]
    else:
        post = [ps + i * H1 for i in range(24)] if horizon == 'h24' else [ps + (48 + i) * H1 for i in range(24)]
    return base, post


def read_target(cache, lin, promos, ti, t, horizon, expo=None, guard=False, sidecar=None):
    """One target (or guardrail) of promotion promos[ti] at a horizon. -> result dict (verdict + every number)."""
    p = promos[ti]
    W = t.get('window_h', 24)
    scale = t.get('scale', 'relative')
    sign = 1 if t['direction'] == 'increase' else -1
    res = {'metric': t['metric'], 'params': t.get('params') or {}, 'direction': t['direction'], 'scale': scale,
           'minimum': t.get('minimum'), 'claim': t.get('claim'), 'window_h': W, 'guardrail': guard}
    w = windows(p, W, horizon)
    if w is None:
        res.update(verdict='UNREADABLE', why='rare-event metric: read on 72-h windows at +72 h only', pending72=True)
        return res
    bh, ph = w
    em = (expo or {}).get('model')
    cb, kb = select(cache, bh, lin.before(ti), em, False if em else None)
    cp, kp = select(cache, ph, lin.from_(ti), em, True if em else None)
    res['controls'] = {'baseline': kb, 'post': kp}
    res['windows'] = {'baseline': [iso(bh[0]), iso(bh[-1] + H1)] if bh else None,
                      'post': [iso(ph[0]), iso(ph[-1] + H1)]}
    why = []
    for nm, k in (('baseline', kb), ('post', kp)):
        if k['holes']:
            why.append(f'{nm}: {len(k["holes"])} cache hole(s) from {k["holes"][0]}')
        elif k['coverage'] < MIN_COVERAGE:
            why.append(f'{nm}: coverage {k["coverage"]:.0%} of {k["nominal_bot_h"]} nominal bot-h < {MIN_COVERAGE:.0%}')
    if not why and kb['rows_per_bot_h'] and not (ROWS_BAND[0] <= kp['rows_per_bot_h'] / kb['rows_per_bot_h'] <= ROWS_BAND[1]):
        why.append(f'skill rows per bot-h changed {kb["rows_per_bot_h"]:.0f} -> {kp["rows_per_bot_h"]:.0f} (logging changed)')
    mb = EM.measure(cb, t['metric'], t.get('params') or {})
    mp = EM.measure(cp, t['metric'], t.get('params') or {})
    strip = lambda m: {k: v for k, v in m.items() if k != 'pools'}
    res['baseline'], res['post'] = strip(mb), strip(mp)
    if why:
        res.update(verdict='UNREADABLE', why='; '.join(why))
        return res
    e = enough(mb, mp)
    if e:
        res.update(verdict='UNREADABLE', why=e)
        return res
    if mp['num'] == 0 and mb['num'] > 0:          # any kind (Codex review r1 BLOCKER 2)
        res.update(verdict='UNREADABLE', why=f'the target event vanished ({mb["num"]:.0f} -> 0): renamed or switched off '
                                             f'by a later change? A zero is not read as an effect')
        return res
    d = delta(mb['value'], mp['value'], scale)
    if d is None:
        res.update(verdict='UNREADABLE', why='zero baseline: a relative change cannot be read')
        return res
    s = sign * d
    res['delta'], res['signed'] = d, s
    # noise: the same read 1..7 days earlier, builds before the target on both sides
    pl, in_holes = [], 0
    for k in range(1, ANCHORS + 1):
        sh = dt.timedelta(hours=24 * k)
        b2, p2 = [h - sh for h in bh], [h - sh for h in ph]
        c1, k1 = select(cache, b2, lin.before(ti), em, False if em else None)
        c2, k2 = select(cache, p2, lin.before(ti), em, False if em else None)
        if k1['holes'] or k2['holes']:
            in_holes += 1
            continue
        if min(k1['coverage'], k2['coverage']) < MIN_COVERAGE:
            continue
        m1 = EM.measure(c1, t['metric'], t.get('params') or {})
        m2 = EM.measure(c2, t['metric'], t.get('params') or {})
        if enough(m1, m2):
            continue
        x = delta(m1['value'], m2['value'], scale)
        if x is not None:
            pl.append(x)
    res['placebo'] = pl
    if len(pl) < MIN_ANCHORS:
        res.update(verdict='UNREADABLE', why=f'{len(pl)} readable placebo anchors < {MIN_ANCHORS} (noise unknown)'
                                             + (f'; {in_holes} in cache holes' if in_holes else ''))
        return res
    tau = max(2 * statistics.stdev(pl), FLOOR[scale][mb['kind']])
    res['tau'] = tau
    el, ag, an = pool_agreement(mb, mp, sign, scale)
    res['pools'] = {'eligible': el, 'agree': ag, 'against': an}
    v, why1 = decide(s, tau, half_minimum(t.get('minimum'), t['direction'], scale), el, ag, an, scale, sign)
    # the canary DiD
    res['did'] = canary_did(cache, lin, p, ti, t, scale, sign)
    if v in ('EFFECT', 'WORSE') and res['did'].get('signed') is not None and res['did']['signed'] * (1 if v == 'EFFECT' else -1) <= -tau:
        v, why1 = 'UNREADABLE', f'{why1}; but the canary DiD points the other way ({fmt_d(res["did"]["signed"], scale)})'
    # same-family promotions after the target and before the post window ends (Codex review r1 BLOCKER 1: including
    # those before the post window starts): recompute on the post hours before them; < 8 such hours is UNREADABLE
    fam = EM.family(t)
    joint = []
    for q in promos[ti + 1:]:
        if not (q['P'] < ph[-1] + H1):
            continue
        eff, _ = effect_for(q['run'], sidecar=sidecar)
        if not eff or fam not in {EM.family(x) for x in (eff.get('targets') or [])}:
            continue
        cut = [h for h in ph if h + H1 <= q['P']]
        if len(cut) < 8:
            joint.append(f'{q["run"]} (same metric, {len(cut)} h before it: joint read)')
            v, why1 = 'UNREADABLE', (f'{why1}; joint with {q["run"]} (same metric, promoted '
                                     f'{(q["P"] - p["P"]).total_seconds() / 3600:+.1f} h): {len(cut)} uncontaminated post h < 8')
            continue
        cq, _ = select(cache, cut, lin.from_(ti), em, True if em else None)
        mq = EM.measure(cq, t['metric'], t.get('params') or {})
        dq = delta(mb['value'], mq['value'], scale)
        vq = 'UNREADABLE' if dq is None or enough(mb, mq) else decide(sign * dq, tau, half_minimum(t.get('minimum'), t['direction'], scale),
                                                                        *pool_agreement(mb, mq, sign, scale), scale)[0]
        joint.append(f'{q["run"]} (same metric: {vq} on the {len(cut)} h before it)')
        if vq != v and v != 'UNREADABLE':
            v, why1 = 'UNREADABLE', f'{why1}; joint with {q["run"]}: {vq} without its hours'
    res['joint'] = joint
    res.update(verdict=v, why=why1)
    return res


def canary_did(cache, lin, p, ti, t, scale, sign):
    if not p['pools']:
        return {'why': 'no drawn pools in the journal'}
    hrs = hours_between(p['D'], p['R'])
    if len(hrs) < 2:
        return {'why': f'{len(hrs)} whole canary hour(s)'}
    prev = [h - dt.timedelta(hours=24) for h in hrs]
    pools = set(p['pools'])
    tre = lambda sha, h: sha == p['sha']
    ctl = lin.before(ti)

    def m(hours, ok, inpool):
        cells, k = select(cache, hours, ok)
        cells = [(a, c) for a, c in cells if (a['pool'] in pools) == inpool]
        return EM.measure(cells, t['metric'], t.get('params') or {})
    t1, t0 = m(hrs, tre, True), m(prev, ctl, True)
    c1, c0 = m(hrs, ctl, False), m(prev, ctl, False)
    lim = 5 if t1['kind'] == 'rate' else MIN_DEN
    key = 'num' if t1['kind'] == 'rate' else 'den'
    if min(x[key] for x in (t1, t0, c1, c0)) < lim:
        return {'why': f'too thin ({", ".join(f"{x[key]:.0f}" for x in (t1, t0, c1, c0))} {key}; needs {lim} each)'}
    try:
        r = math.log((t1['value'] / t0['value']) / (c1['value'] / c0['value']))
    except (TypeError, ZeroDivisionError, ValueError):
        return {'why': 'a zero value'}
    return {'ratio': r, 'signed': sign * r, 'hours': len(hrs), 'canary': [t0['value'], t1['value']],
            'control': [c0['value'], c1['value']]}


def overall(results):
    """PURE. targets + guardrails -> (verdict, why)."""
    tg = [r for r in results if not r['guardrail']]
    gd = [r for r in results if r['guardrail']]
    if any(r['verdict'] == 'WORSE' for r in tg) or any(r['verdict'] == 'WORSE' for r in gd):
        bad = [r['metric'] + (' (guardrail)' if r['guardrail'] else '') for r in results if r['verdict'] == 'WORSE']
        return 'WORSE', 'worse: ' + ', '.join(bad)
    readable = [r for r in tg if r['verdict'] != 'UNREADABLE']
    if not readable:
        return 'UNREADABLE', '; '.join(f'{r["metric"]}: {r["why"]}' for r in tg)[:400]
    ne = [r for r in readable if r['verdict'] == 'NO-EFFECT']
    ef = [r for r in readable if r['verdict'] == 'EFFECT']
    if ne:
        return 'NO-EFFECT', ('partial: ' if ef else '') + '; '.join(f'{r["metric"]}: {r["why"]}' for r in ne)
    return 'EFFECT', ', '.join(r['metric'] for r in ef) + (' (some targets unreadable)' if len(readable) < len(tg) else '')


def read_run(cache, promos, ti, horizon, sidecar=None):
    p = promos[ti]
    eff, src = effect_for(p['run'], sidecar=sidecar)
    lin = Lineage(promos)
    out = {'run': p['run'], 'sha': p['sha'], 'horizon': horizon, 'promoted': iso(p['P']), 'deployed': iso(p['D']),
           'source': src, 'computed_at': iso(dt.datetime.now(UTC))}
    if eff is None:
        out.update(verdict='UNREADABLE', why='no effect declared (registration or config/effect-targets.json)',
                   undeclared=True, targets=[])
        return out
    bad = EM.validate(eff)
    if bad:
        out.update(verdict='UNREADABLE', why='effect field invalid: ' + '; '.join(bad), targets=[])
        return out
    if not eff.get('targets'):
        out.update(verdict='UNREADABLE', why='none_reason: ' + str(eff.get('none_reason')), none_reason=True, targets=[])
        return out
    rs = [read_target(cache, lin, promos, ti, t, horizon, eff.get('exposure'), False, sidecar) for t in eff['targets']]
    rs += [read_target(cache, lin, promos, ti, t, horizon, eff.get('exposure'), True, sidecar)
           for t in eff.get('guardrails') or []]
    v, why = overall(rs)
    if v == 'UNREADABLE' and all(r.get('pending72') for r in rs if not r['guardrail']):
        out['pending72'] = True
    lo = min(iso(promos[ti]['D'] - dt.timedelta(hours=72)), iso(promos[ti]['D']))
    hi = iso(hceil(p['P']) + dt.timedelta(hours=74 if horizon == 'h72' else 26))
    out['overlaps'] = [f'{q["run"]} ({(q["P"] - p["P"]).total_seconds() / 3600:+.1f} h)' for q in promos
                       if q is not p and lo <= iso(q['P']) <= hi]
    out.update(verdict=v, why=why, targets=rs, retrospective=bool(eff.get('retrospective')))
    return out


def is_hole_only(v):
    """PURE. The run is UNREADABLE and every target that could not be read failed on cache holes or on placebo anchors
    (which are skipped for holes)."""
    if v.get('verdict') != 'UNREADABLE' or not v.get('targets'):
        return False
    tg = [r for r in v['targets'] if not r['guardrail'] and r['verdict'] == 'UNREADABLE' and not r.get('pending72')]
    return bool(tg) and all('cache hole' in r.get('why', '') for r in tg)


def one_line(v):
    t = next((r for r in v.get('targets') or [] if not r['guardrail'] and 'delta' in r), None)
    head = f'{v["run"]} {v["horizon"]} {v["verdict"]}'
    if t is None:
        return f'{head}: {v.get("why", "")[:200]}'
    b, p = t['baseline'], t['post']
    num = lambda m: f'{m["value"]:.4g} ({m["num"]:,.0f}/{m["den"]:,.0f})'
    return (f'{head}: {t["metric"]}{json.dumps(t["params"]) if t["params"] else ""} {num(b)} -> {num(p)} '
            f'{fmt_d(t["delta"], t["scale"])} (noise {fmt_tau(t.get("tau", 0), t["scale"])}, '
            f'{p["bots"]} bots {p["bot_h"]:,.0f} bot-h; {v.get("why", "")[:120]})')


# --------------------------------------------------------------------------------------------------------------- run ---
def ledger_ids(repo=REPO, ledger_path=None):
    try:
        if ledger_path:
            d = json.load(open(ledger_path))
        else:
            r = os.path.expanduser(repo)
            subprocess.run(['git', '-C', r, 'fetch', '-q', 'origin'], timeout=60, check=False)
            d = json.loads(subprocess.run(['git', '-C', r, 'show', 'origin/main:config/owner-commitments.json'],
                                          capture_output=True, text=True, timeout=30, check=True).stdout)
        return {i.get('id') for i in d.get('items') or []}, None
    except Exception as e:      # noqa: BLE001
        return None, f'{type(e).__name__}: {str(e)[:80]}'


def write_once(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except FileExistsError:
        return False
    with os.fdopen(fd, 'w') as f:
        json.dump(obj, f, indent=1, default=str)
    return True


def busy_window(cache, end, hours=24):
    tot, n = {}, 0
    for i in range(hours):
        hd = cache.hour(hfloor(end) - (i + 1) * H1)
        if hd is None:
            continue
        n += 1
        for builds in hd['bots'].values():
            for c in builds.values():
                for k, v in (c.get('busy') or {}).items():
                    tot[k] = tot.get(k, 0.0) + v
    return tot, n


def cmd_run(a):
    now = ts(a.now) if a.now else dt.datetime.now(UTC)
    sd = os.path.expanduser(a.state_dir)
    cache = Cache(a.cache)
    promos = promotions(read_journal(a.journal))
    final = hfloor(now - EC.FINAL_AFTER)
    since = ts(a.since)
    side = load_targets()
    verdicts, new = [], []
    for ti, p in enumerate(promos):
        if p['P'] < since:
            continue
        for hz, end in (('h24', hceil(p['P']) + dt.timedelta(hours=26)), ('h72', hceil(p['P']) + dt.timedelta(hours=74))):
            path = os.path.join(sd, 'effect', p['run'], f'{hz}.json')
            stale = False
            try:
                old = json.load(open(path))
                # an UNDECLARED verdict is not final: the entry may land on main later; re-read it every run
                if not old.get('undeclared'):
                    verdicts.append(old)
                    continue
                stale = True
            except (OSError, ValueError):
                pass
            if end > final or now < end + EC.FINAL_AFTER + DUE_AFTER:
                continue
            v = read_run(cache, promos, ti, hz, sidecar=side)
            if v.get('undeclared'):
                verdicts.append(v)
                continue
            if stale:
                os.remove(path)
            # a read made UNREADABLE only by missing cache hours (a backfill not done, a cron gap) is NOT committed: it is
            # retried every run, and committed as it stands only HOLE_GRACE after it fell due (Claude review r1)
            if is_hole_only(v) and now < end + EC.FINAL_AFTER + DUE_AFTER + HOLE_GRACE:
                v['retrying'] = True
                verdicts.append(v)
                continue
            if write_once(path, v):
                new.append(v)
            verdicts.append(v)
    ids, lerr = ledger_ids(ledger_path=a.ledger)
    alarms, pending = {}, []
    for v in verdicts:
        key = f'effect:{v["run"]}:{v["horizon"]}'
        if v['verdict'] in ('NO-EFFECT', 'WORSE'):
            row = f'effect-{v["run"]}'
            if ids is None or row not in ids:
                alarms[key] = (f'EFFECT {one_line(v)[:300]} -- fix or remove: ledger row {row} needed'
                               + (f' (ledger unreadable: {lerr})' if ids is None else ''))
                pending.append(ledger_row(v, now))
        elif is_hole_only(v) and not v.get('retrying'):
            row = f'effect-{v["run"]}'
            if ids is None or row not in ids:
                alarms[key] = (f'EFFECT {v["run"]} {v["horizon"]} read LOST to cache holes ({v.get("why", "")[:160]}): '
                               f'rebuild those hours (effectcache.py build --from ... --rebuild), move the verdict file '
                               f'aside to re-read, or add ledger row {row}')
        elif v.get('undeclared'):
            alarms[f'effect:{v["run"]}:undeclared'] = (f'EFFECT {v["run"]} promoted with no effect declared: add it to '
                                                       f'config/effect-targets.json (metric + direction) or a none_reason')
    counts = {}
    for v in verdicts:
        counts[v['verdict']] = counts.get(v['verdict'], 0) + 1
    upcoming = sorted((hceil(p['P']) + dt.timedelta(hours=26) + EC.FINAL_AFTER + DUE_AFTER, p['run']) for p in promos
                      if p['P'] >= since and not os.path.exists(os.path.join(sd, 'effect', p['run'], 'h24.json'))
                      and hceil(p['P']) + dt.timedelta(hours=26) + EC.FINAL_AFTER + DUE_AFTER > now)
    nxt = f'; next {upcoming[0][1]} h24 ~{iso(upcoming[0][0])[5:16]}Z' if upcoming else ''
    summary = (f'promotion effects: {len(verdicts)} reads since {a.since[:10]} -- ' +
               ', '.join(f'{k} {counts[k]}' for k in ('EFFECT', 'NO-EFFECT', 'WORSE', 'UNREADABLE') if k in counts) + nxt)
    AL.write_json_atomic(os.path.join(sd, 'effect-fleet.json'),
                         {'generated_at': iso(now), 'summary': summary, 'alarms': alarms, 'new': [one_line(v) for v in new]})
    AL.write_json_atomic(os.path.join(sd, 'effect-ledger-pending.json'), {'generated_at': iso(now), 'rows': pending})
    tot, n = busy_window(cache, final)
    bl = BT.line(tot, f'busy time (last {n} final h, fleet)') if n else '!! busy time: no cache hour in the last 24 h'
    AL.write_json_atomic(os.path.join(sd, 'busy-fleet.json'),
                         {'generated_at': iso(now), 'summary': bl, 'alarms': {} if n else {'busy:nocache': bl},
                          'seconds': tot, 'hours': n})
    write_md(os.path.join(sd, 'effect-latest.md'), verdicts, now, bl)
    # ALARMS.log lives in the state dir (~/digest/ALARMS.log in production): a test's temp state dir never writes the live
    # log (11-03 install self-test left 6 fixture x-01 rows in .31's ~/digest/ALARMS.log)
    AL.raise_alarms('effectwatch', alarms, now, os.path.join(sd, 'effect.pushstate.json'),
                    log_path=os.path.join(sd, 'ALARMS.log'), push=not a.no_push)
    if a.print:
        print(summary)
        print(bl)
        for v in verdicts:
            print('  ' + one_line(v))
        for k, l in alarms.items():
            print('!! ' + l)
    print(f'{iso(now)} effectwatch OK: {len(new)} new read(s), {len(verdicts)} total, {len(alarms)} alarm(s)')


def ledger_row(v, now):
    return {'id': f'effect-{v["run"]}', 'title': f'{v["run"]} {v["verdict"]} at {v["horizon"]}: fix or remove '
            f'({one_line(v)[:180]})', 'owner_date': iso(now)[:10], 'memory': ['owner-gaps-1103.md'], 'kind': 'canary',
            'lane': 'ops', 'state': 'open', 'owner': 'control session', 'max_quiet_hours': 72,
            'next_step': 'Fix (a follow-up change with an effect target) or remove (revert behind its switch); or show '
                         'the read is wrong (name the confound) and park with a date.',
            'evidence': {'runs': [v['run']], 'grep': [f'effect-{v["run"]}']}, 'covers_alarms': [f'effect:{v["run"]}']}


def write_md(path, verdicts, now, busy):
    L = [f'# Promotion effects (generated {iso(now)})', '', busy, '',
         '| run | horizon | verdict | metric | baseline | post | delta | noise tau | pools | bots / bot-h | why |',
         '|---|---|---|---|---|---|---|---|---|---|---|']
    for v in sorted(verdicts, key=lambda x: (x['promoted'], x['horizon'])):
        ts_ = v.get('targets') or []
        if not ts_:
            L.append(f'| {v["run"]} | {v["horizon"]} | {v["verdict"]} | - | - | - | - | - | - | - | {v.get("why", "")[:160]} |')
        for t in ts_:
            b, p = t.get('baseline') or {}, t.get('post') or {}
            f = lambda m: '-' if not m or m.get('value') is None else f'{m["value"]:.4g} ({m["num"]:,.0f}/{m["den"]:,.0f})'
            pl = t.get('pools') or {}
            L.append(f'| {v["run"]} | {v["horizon"]} | {t["verdict"]}{" (guardrail)" if t["guardrail"] else ""} '
                     f'(run: {v["verdict"]}) | {t["metric"]} {json.dumps(t["params"]) if t["params"] else ""} | {f(b)} | {f(p)} | '
                     f'{fmt_d(t["delta"], t["scale"]) if "delta" in t else "-"} | '
                     f'{fmt_tau(t["tau"], t["scale"]) if "tau" in t else "-"} | '
                     f'{pl.get("agree", "-")}/{pl.get("eligible", "-")} | {p.get("bots", "-")} / {p.get("bot_h", 0):,.0f} | '
                     f'{t.get("why", "")[:160]}; overlaps: {", ".join(v.get("overlaps") or [])[:200]} |')
    with open(path + '.tmp', 'w') as fh:
        fh.write('\n'.join(L) + '\n')
    os.replace(path + '.tmp', path)


def cmd_report(a):
    promos = promotions(read_journal(a.journal))
    ti = next((i for i, p in enumerate(promos) if p['run'] == a.target), None)
    if ti is None:
        raise SystemExit(f'{a.target}: no promoted row in the journal')
    v = read_run(Cache(a.cache), promos, ti, a.horizon)
    print(one_line(v))
    print(json.dumps(v, indent=1, default=str)[:20000])


def cmd_validate(a):
    reg = json.load(open(a.target))
    eff = reg.get('effect', reg)
    bad = EM.validate(eff)
    if bad:
        print('INVALID: ' + '; '.join(bad))
        raise SystemExit(1)
    cache = Cache(a.cache)
    end = hfloor(dt.datetime.now(UTC) - EC.FINAL_AFTER)
    hrs = [end - (i + 1) * H1 for i in range(24)]
    cells, k = select(cache, hrs, lambda sha, h: True)
    for t in eff.get('targets') or []:
        m = EM.measure(cells, t['metric'], t.get('params') or {})
        ok = m['num'] > 0 and m['den'] > 0
        print(f'{"ok  " if ok else "ZERO"} {t["metric"]} {t.get("params") or {}}: {m["num"]:,.0f}/{m["den"]:,.0f} '
              f'on the last 24 h ({k["bot_h"]:,.0f} bot-h)')
        if not ok:
            print('  a zero on the last 24 h: the metric cannot see a baseline (wrong name/key, or a new instrument) -- '
                  'pick one that exists before the change')
            raise SystemExit(1)
    print('valid')


def cmd_busy(a):
    end = ts(a.end) if a.end else hfloor(dt.datetime.now(UTC) - EC.FINAL_AFTER)
    cache = Cache(a.cache)
    tot, n = busy_window(cache, end, a.hours)
    print(BT.line(tot, f'busy time {a.hours} h to {iso(end)[5:16]}Z ({n} cache hours)'))
    by = {}
    for i in range(a.hours):
        hd = cache.hour(hfloor(end) - (i + 1) * H1)
        for builds in (hd or {}).get('bots', {}).values():
            for c in builds.values():
                d = by.setdefault(c['pool'], {})
                for k, v in (c.get('busy') or {}).items():
                    d[k] = d.get(k, 0.0) + v
    for pool in sorted(by):
        print('  ' + BT.line(by[pool], pool))


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['run', 'report', 'validate', 'busy'])
    ap.add_argument('target', nargs='?')
    ap.add_argument('--horizon', default='h24', choices=['h24', 'h72'])
    ap.add_argument('--no-push', action='store_true')
    ap.add_argument('--print', action='store_true')
    ap.add_argument('--since', default=SINCE)
    ap.add_argument('--now')
    ap.add_argument('--end')
    ap.add_argument('--hours', type=int, default=24)
    ap.add_argument('--journal', default=JOURNAL)
    ap.add_argument('--cache', default=EC.OUT)
    ap.add_argument('--state-dir', default=STATE)
    ap.add_argument('--ledger', help='a local ledger file instead of origin/main of ~/stallcheck/repo')
    a = ap.parse_args(argv)
    {'run': cmd_run, 'report': cmd_report, 'validate': cmd_validate, 'busy': cmd_busy}[a.cmd](a)


if __name__ == '__main__':
    main()
