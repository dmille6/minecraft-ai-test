#!/usr/bin/env python3
"""gathernull.py [hours=72] [draws=600] -- the NO-CHANGE band for monument-01's gather no-regression gate (coordinator 10-15:
"gather success per call and dig-outcome shares, canary vs control as DiD, with thresholds calibrated on no-change samples").

monument-01 changes one thing every bot does with or without a monument: every gather dig now looks (forced) and then digs
with forceLook 'ignore' (structureguard-01's last-word check). The read gates that change on three DiDs (pre 180 / post 360,
one pool of five as the canary, every other shared pool the control):
  success_share   gather calls ending `success` / gather calls
  bad_dig_share   (unconfirmed + rejected) / all digs, from the `_dig_town_sum` minute summaries (every dig, anywhere)
  calls_per_bot_h gather calls per bot-hour (population stability: reported, not gated)
Their NULL distributions come from historical windows where nothing changed between arms: a random shared pool is the
pseudo-canary at a random cutoff. Positive control: an injected 20% loss of the pseudo-canary's post-period successes must
land beyond the 1% band in most draws. Writes ~/mcai-analysis/monument-gathernull.json. Run under `nice`.
"""
import sys, os, glob, json, random, bisect, datetime as dt
from collections import defaultdict
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events

HOURS = int(sys.argv[1]) if len(sys.argv) > 1 else 72
DRAWS = int(sys.argv[2]) if len(sys.argv) > 2 else 600
PRE, POST = 180, 360
TIMES = {}
random.seed(20261015)


def load_all(minutes):
    now = dt.datetime.now(dt.timezone.utc); start = now - dt.timedelta(minutes=minutes)
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since_minutes=minutes)
    d = start.date()
    while d <= now.date():
        tag = (d + dt.timedelta(days=1)).strftime('%Y%m%d')
        if glob.glob(f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz'):
            ev.rows.extend(Events.load(paths=f'/var/log/mcai/*/skill-*.jsonl-{tag}.gz', since_minutes=minutes).rows)
        d += dt.timedelta(days=1)
    return ev


def pool_of(b):
    return '-'.join((b or '').split('-')[:2])


def share(num, den):
    return num / den if den else float('nan')


def did_of(ev, can, cut, inject=0.0):
    """PURE over the per-pool event lists: (success_share, bad_dig_share, calls_per_bot_h) DiDs for pool `can` at `cut`."""
    pre0, post1 = cut - PRE * 60, cut + POST * 60
    agg = {(a, p): [0, 0, 0, 0, set()] for a in ('c', 'k') for p in ('pre', 'post')}   # calls, ok, digs_all, digs_bad, bots
    for pool, rows in ev.items():
        arm = 'c' if pool == can else 'k'
        times = TIMES[pool]
        for (t, kind, b, x, y) in rows[bisect.bisect_left(times, pre0):bisect.bisect_left(times, post1)]:
            per = 'pre' if t < cut else 'post'
            a = agg[(arm, per)]
            a[4].add(b)
            if kind == 'g':
                a[0] += 1
                ok = x
                if inject and arm == 'c' and per == 'post' and ok and random.random() < inject:
                    ok = 0
                a[1] += ok
            else:
                a[2] += x; a[3] += y
    def m(arm, per):
        a = agg[(arm, per)]
        nb = max(1, len(a[4]))
        return share(a[1], a[0]), share(a[3], a[2]), a[0] / (nb * (PRE if per == 'pre' else POST) / 60)
    out = []
    for i in range(3):
        v = (m('c', 'post')[i] - m('c', 'pre')[i]) - (m('k', 'post')[i] - m('k', 'pre')[i])
        out.append(v)
    out.append(agg[('c', 'post')][0])
    return out


def quant(xs, q):
    s = sorted(x for x in xs if x == x)
    return s[min(len(s) - 1, max(0, int(q * (len(s) - 1))))] if s else float('nan')


if __name__ == '__main__':
    ev = load_all(HOURS * 60)
    per_pool = defaultdict(list)
    n_g = n_d = 0
    for r in ev.rows:
        b = (r.get('bot') or {}).get('name') or ''
        if not b or b.startswith('isolated') or b.startswith('self-isolated') or b.startswith('sandbox'):
            continue
        t = r['t'].timestamp() if hasattr(r['t'], 'timestamp') else float(r['t'])
        k = str(r.get('name') or '')
        sk = (r.get('raw') or {}).get('skill') or {}
        if k == 'gather':
            st = sk.get('status')
            if st == 'aborted':
                continue
            per_pool[pool_of(b)].append((t, 'g', b, 1 if st == 'success' else 0, 0)); n_g += 1
        elif k == '_dig_town_sum':
            a = sk.get('args') or {}
            allv = a.get('all') or 0
            bad = (a.get('o_unconfirmed') or 0) + (a.get('o_rejected') or 0)
            if allv:
                per_pool[pool_of(b)].append((t, 'd', b, allv, bad)); n_d += 1
    for v in per_pool.values():
        v.sort(key=lambda x: x[0])
    TIMES.update({p: [x[0] for x in v] for p, v in per_pool.items()})
    pools = sorted(per_pool)
    ts = [x[0] for v in per_pool.values() for x in v]
    T0, T1 = min(ts), max(ts)
    print('positive control: %d rows walked, %d gather calls, %d dig summaries, %d shared pools, span %.1f h'
          % (len(ev.rows), n_g, n_d, len(pools), (T1 - T0) / 3600))
    assert n_g > 1000 and n_d > 1000 and len(pools) >= 8, 'the instrument sees too little to calibrate'
    null, inj = [], []
    for _ in range(DRAWS):
        cut = random.uniform(T0 + PRE * 60, T1 - POST * 60)
        can = random.choice(pools)
        d = did_of(per_pool, can, cut)
        if d[3] >= 50:                     # the gate's own exposure floor: >= 50 canary gather calls post
            null.append(d)
            inj.append(did_of(per_pool, can, cut, inject=0.2))
    succ = [d[0] for d in null]; bad = [d[1] for d in null]; calls = [d[2] for d in null]
    band = {'success_share_did': {q: quant(succ, q) for q in (0.005, 0.01, 0.025, 0.5, 0.975, 0.99, 0.995)},
            'bad_dig_share_did': {q: quant(bad, q) for q in (0.005, 0.01, 0.025, 0.5, 0.975, 0.99, 0.995)},
            'calls_per_bot_h_did': {q: quant(calls, q) for q in (0.025, 0.5, 0.975)}}
    lo = band['success_share_did'][0.01]
    caught = sum(1 for d in inj if d[0] < lo) / max(1, len(inj))
    print('draws kept %d of %d (>= 50 canary gather calls post)' % (len(null), DRAWS))
    for k, v in band.items():
        print('%-22s %s' % (k, '  '.join('q%.3g=%+.4f' % (q, x) for q, x in v.items())))
    print('positive control: an injected 20%% success loss falls below the 1%% band in %.0f%% of draws' % (100 * caught))
    false_trip = sum(1 for d in null if d[0] < lo or d[1] > band['bad_dig_share_did'][0.99]) / max(1, len(null))
    print('false-trip rate of the combined gate on no-change draws: %.1f%%' % (100 * false_trip))
    out = {'hours': HOURS, 'draws': len(null), 'pre': PRE, 'post': POST, 'min_calls': 50,
           'success_share_did_q01': lo, 'bad_dig_share_did_q99': band['bad_dig_share_did'][0.99],
           'band': {k: {str(q): x for q, x in v.items()} for k, v in band.items()},
           'positive_control_injected_20pct_caught': caught, 'false_trip': false_trip,
           'at': dt.datetime.now(dt.timezone.utc).isoformat()}
    path = os.path.expanduser('~/mcai-analysis/monument-gathernull.json')
    json.dump(out, open(path, 'w'), indent=1)
    print('wrote', path)
