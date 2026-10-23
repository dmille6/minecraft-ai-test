"""Which change moved the ladder? For each promoted canary: the DiD of each rung group's SHARE of
decisions (canary vs control, pre 6 h before deploy, post = deploy+1 h .. promotion), with a
placebo-draw noise band; and for each fleet-wide step (promotion or owner-direct rollout): the
fleet share 12 h before vs 12 h after (+1 h restart gap), which is a before/after and is shown
only as timing evidence, never as an effect size (CLAUDE.md: world drift). No ES access.
"""
import os, sys, json, random, statistics, datetime as dt

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from canary_did import CANARIES, SHARED, ts  # noqa: E402

H = json.load(open(os.path.join(HERE, 'out', 'rung_hourly.json')))
G = ['wood', 'stone', 'iron', 'craft', 'lap', 'dirt']
STEPS = [  # fleet-wide timestamps (journal 'promoted' rows, owner-direct included)
    ('toolhygiene-01', '2026-10-10T11:31Z'), ('peacefulkit-02', '2026-10-11T01:32Z'), ('junkwell-02', '2026-10-11T19:31Z'),
    ('gridfix-01', '2026-10-12T18:20Z'), ('stocktarget-01', '2026-10-13T19:50Z'), ('orderroom-01', '2026-10-14T02:19Z'),
    ('digtown-01', '2026-10-14T11:10Z'), ('stocktarget-02', '2026-10-14T17:44Z'), ('wellsite-04', '2026-10-15T19:33Z'),
    ('townzone-01', '2026-10-16T05:02Z'), ('cobblecap-1000', '2026-10-16T11:54Z'), ('lidclear-01', '2026-10-16T23:14Z'),
    ('plinth-02 (direct)', '2026-10-17T12:34Z'), ('smeltjob-01', '2026-10-17T19:53Z'), ('plinth-02.1 (direct)', '2026-10-17T20:03Z'),
    ('logcap-01 (direct)', '2026-10-17T22:46Z'), ('toolkit-02', '2026-10-18T06:27Z'), ('wellcare-01', '2026-10-18T12:48Z'),
    ('townsearch-02', '2026-10-19T01:16Z'), ('plinthfirst-01 (direct)', '2026-10-19T01:26Z'), ('cobblekeep-01', '2026-10-20T11:23Z'),
    ('toolkit-03', '2026-10-21T13:37Z'), ('homefix-02', '2026-10-22T00:28Z'), ('ironpick-01', '2026-10-22T06:56Z'),
    ('keepout-01', '2026-10-22T13:22Z'), ('protectzone-01', '2026-10-22T16:54Z'), ('townindex-01', '2026-10-23T01:17Z'),
]


def share(pools, lo, hi):
    tot = {g: 0 for g in G}
    n = 0
    # only hours lying WHOLLY inside [lo, hi)
    t = lo.replace(minute=0, second=0, microsecond=0)
    if t < lo:
        t += dt.timedelta(hours=1)
    while t + dt.timedelta(hours=1) <= hi:
        k = t.strftime('%Y-%m-%dT%H')
        for w in pools:
            X = H.get(k, {}).get(w)
            if X:
                n += X['_all']
                for g in G:
                    tot[g] += X.get(g, 0)
        t += dt.timedelta(hours=1)
    return {g: (tot[g] / n if n else float('nan')) for g in G}, n


def did(can, ctl, pre, post):
    a, _ = share(can, *pre)
    b, nb = share(can, *post)
    c, _ = share(ctl, *pre)
    e, _ = share(ctl, *post)
    return {g: (b[g] - a[g]) - (e[g] - c[g]) for g in G}, nb


random.seed(7)
print('CANARY DiD of rung shares (percentage points of all decisions; z vs 300 placebo draws)')
print(f'{"run":16s} ' + ' '.join(f'{g:>13s}' for g in G))
out = []
for run, t0, t1, pools in CANARIES:
    can = pools.split(',')
    ctl = [w for w in SHARED if w not in can]
    T0, T1 = ts(t0), ts(t1)
    pre = (T0 - dt.timedelta(hours=6), T0)                 # whole hours before the deploy
    post = (T0 + dt.timedelta(hours=1), T1)                # whole hours from deploy + 1 h to the promotion
    d, nb = did(can, ctl, pre, post)
    null = {g: [] for g in G}
    for _ in range(300):
        fake = random.sample(ctl, len(can))
        rest = [w for w in ctl if w not in fake]
        dn, _ = did(fake, rest, pre, post)
        for g in G:
            null[g].append(dn[g])
    sd = {g: statistics.pstdev(null[g]) or float('nan') for g in G}
    out.append({'run': run, 'did': d, 'sd': sd, 'post_decisions_canary': nb})
    print(f'{run:16s} ' + ' '.join(f'{100 * d[g]:+6.1f}(z{d[g] / sd[g]:+4.1f})' for g in G))

print('\nFLEET step at each promotion (share 12 h after minus 12 h before; +1 h gap; timing evidence only)')
print(f'{"change":24s} ' + ' '.join(f'{g:>7s}' for g in G))
for name, t in STEPS:
    T = ts(t)
    a, _ = share(SHARED + ['isolated-a', 'isolated-b', 'isolated-c', 'isolated-d'], T - dt.timedelta(hours=12), T)
    b, _ = share(SHARED + ['isolated-a', 'isolated-b', 'isolated-c', 'isolated-d'], T + dt.timedelta(hours=1), T + dt.timedelta(hours=13))
    print(f'{name:24s} ' + ' '.join(f'{100 * (b[g] - a[g]):+7.1f}' for g in G))
json.dump(out, open(os.path.join(HERE, 'out', 'rung_did.json'), 'w'), indent=1)
