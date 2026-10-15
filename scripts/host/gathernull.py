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


def did_of(ev, can, cut, inject=0.0, inject_bad=0.0, post=None):
    """PURE over the per-pool event lists: (success_share, bad_dig_share, calls_per_bot_h) DiDs for pool `can` at `cut`, with the
    READ's own windows (pre min(post, 180), post 180 or 360) and population (shared pools only). inject: drop that share of the
    canary's post successes; inject_bad: add that share of its post digs as bad (the positive controls)."""
    POSTM = post or POST
    PREM = min(POSTM, PRE)
    pre0, post1 = cut - PREM * 60, cut + POSTM * 60
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
                if inject_bad and arm == 'c' and per == 'post':
                    a[3] += x * inject_bad
    def m(arm, per):
        a = agg[(arm, per)]
        nb = max(1, len(a[4]))
        return share(a[1], a[0]), share(a[3], a[2]), a[0] / (nb * (PREM if per == 'pre' else POSTM) / 60)
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
    # ONE BAND PER READ WINDOW (Codex stage-4 r1 P2-4): the read's +180 and +360 reads, each with its own pre (min(post, 180))
    out = {'hours': HOURS, 'draws_asked': DRAWS, 'min_calls': 50, 'population': 'shared pools only (no isolated, no sandbox)', 'bands': {},
           'at': dt.datetime.now(dt.timezone.utc).isoformat()}
    for post in (180, 360, 540, 720, 1080):   # every read and extension read of the registration
        null, draws = [], []
        for _ in range(DRAWS):
            cut = random.uniform(T0 + min(post, PRE) * 60, T1 - post * 60)
            can = random.choice(pools)
            d = did_of(per_pool, can, cut, post=post)
            if d[3] >= 50:
                null.append(d); draws.append((can, cut))
        inj_s = [did_of(per_pool, c, t, inject=0.2, post=post) for c, t in draws]
        inj_b = [did_of(per_pool, c, t, inject_bad=0.01, post=post) for c, t in draws]
        succ = [d[0] for d in null]; bad = [d[1] for d in null]; calls = [d[2] for d in null]
        lo, hi = quant(succ, 0.01), quant(bad, 0.99)
        # POWER OVER THE DRAWS WHERE THE COMPONENT IS DEFINED (a NaN -- no digs in an arm's window -- is neither a hit nor a miss)
        defined = lambda xs, i: [d for d in xs if d[i] == d[i]]
        pw_s = sum(1 for d in defined(inj_s, 0) if d[0] < lo) / max(1, len(defined(inj_s, 0)))
        pw_b = sum(1 for d in defined(inj_b, 1) if d[1] > hi) / max(1, len(defined(inj_b, 1)))
        nan_b = 1 - len(defined(null, 1)) / max(1, len(null))
        ft = sum(1 for d in null if d[0] < lo or d[1] > hi) / max(1, len(null))
        ft_b = sum(1 for d in null if d[1] > hi) / max(1, len(null))
        # THE SMALLEST EFFECT EACH COMPONENT SEES WITH 80% POWER (the gate's honest reach), on a subsample of the draws
        sub = draws[:150]
        def mde(kind, sizes):
            for sz in sizes:
                i = 0 if kind == 's' else 1
                hits = [d for d in (did_of(per_pool, c, t, post=post, **({'inject': sz} if kind == 's' else {'inject_bad': sz})) for c, t in sub) if d[i] == d[i]]
                pw = sum(1 for d in hits if (d[0] < lo if kind == 's' else d[1] > hi)) / max(1, len(hits))
                if pw >= 0.8:
                    return sz
            return None
        mde_s = mde('s', (0.35, 0.5, 0.7))
        mde_b = mde('b', (0.01, 0.02, 0.03, 0.05, 0.08))
        print('post %d: MDE at 80%% power -- success loss %s, bad-dig rise %s | dig share undefined in %.0f%% of draws' % (post, mde_s, mde_b, 100 * nan_b))
        print('post %d: draws kept %d | success q01 %+.4f (power vs a 20%% loss %.0f%%) | bad-dig q99 %+.4f (power vs +1 pp %.0f%%) | calls q2.5/97.5 %+.2f/%+.2f | false trip both %.1f%%, dig only %.1f%%'
              % (post, len(null), lo, 100 * pw_s, hi, 100 * pw_b, quant(calls, .025), quant(calls, .975), 100 * ft, 100 * ft_b))
        out['bands'][str(post)] = {'pre': min(post, PRE), 'post': post, 'draws': len(null), 'success_share_did_q01': lo, 'bad_dig_share_did_q99': hi,
                                   'power_success_20pct': pw_s, 'power_bad_1pp': pw_b, 'false_trip_both': ft, 'false_trip_dig_only': ft_b,
                                   'mde_success_loss': mde_s, 'mde_bad_rise': mde_b, 'dig_share_undefined': nan_b,
                                   'calls_q025': quant(calls, .025), 'calls_q975': quant(calls, .975)}
    path = os.path.expanduser('~/mcai-analysis/monument-gathernull.json')
    json.dump(out, open(path, 'w'), indent=1)
    print('wrote', path)
