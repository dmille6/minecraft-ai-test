"""Difference-in-differences of every promoted canary on the FOUR production metrics (plus time
in gather/explore/goto), from the compact rows. No ES access.

For each canary (deploy T0, promotion T1, canary pools P, from ~/canary-journal.jsonl, quoted below):
  pre  = [T0 - 6 h, T0)          post = [T0 + 15 min, T1)   (the first 15 min are restarts)
  rate = events per bot-hour, bot-hours = distinct bots seen per world-hour (5 per pool when whole)
  DiD  = (canary post - canary pre) - (control post - control pre), per bot-hour
Noise: within the SAME window, 300 placebo draws of |P| pools from the control pools, each
scored against the remaining controls. The SD of those placebo DiDs is the noise band; z = DiD / SD.
Fleet-day effect = DiD x 1,920 bot-h (80 bots), IF the effect is homogeneous and persists.

The isolated pools are left out of every control (their bots ran private towns: several town
fixes cannot act there) and are reported separately when they were canary pools (never, here).
"""
import os, sys, gzip, json, glob, random, statistics, datetime as dt
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROWS = os.path.join(HERE, 'out', 'rows')
sys.path.insert(0, HERE)
from analyze import world, HOMES  # noqa: E402

# run, deployed (journal 'deployed' note time), promoted (journal ts), canary pools
CANARIES = [
    ('toolhygiene-01', '2026-10-10T05:15:23Z', '2026-10-10T11:31Z', 'board-b,placebo-a,board-d,hive-c'),
    ('peacefulkit-02', '2026-10-10T19:15:24Z', '2026-10-11T01:32Z', 'placebo-b,board-c'),
    ('junkwell-02', '2026-10-11T13:15:48Z', '2026-10-11T19:31Z', 'placebo-a,board-b,placebo-d,hive-b'),
    ('gridfix-01', '2026-10-12T09:03:55Z', '2026-10-12T18:20Z', 'placebo-a,board-a,board-d,board-b'),
    ('stocktarget-01', '2026-10-13T16:36:09Z', '2026-10-13T19:50Z', 'placebo-a,hive-a,hive-b,board-b'),
    ('orderroom-01', '2026-10-13T19:59:52Z', '2026-10-14T02:19Z', 'board-a,placebo-b,board-d,hive-c'),
    ('digtown-01', '2026-10-14T04:54:59Z', '2026-10-14T11:10Z', 'placebo-d,hive-d'),
    ('stocktarget-02', '2026-10-14T11:30:03Z', '2026-10-14T17:44Z', 'board-c,hive-b'),
    ('wellsite-04', '2026-10-15T13:14:58Z', '2026-10-15T19:33Z', 'placebo-b,board-c,board-b,board-d'),
    ('townzone-01', '2026-10-15T22:45:37Z', '2026-10-16T05:02Z', 'board-a,hive-b,hive-c'),
    ('cobblecap-1000', '2026-10-16T05:32:18Z', '2026-10-16T11:54Z', 'placebo-a,hive-a'),
    ('lidclear-01', '2026-10-16T17:00:08Z', '2026-10-16T23:14Z', 'board-a,placebo-b,hive-c,board-b'),
    ('smeltjob-01', '2026-10-17T13:40:02Z', '2026-10-17T19:53Z', 'board-d,hive-a,placebo-a,hive-b'),
    ('toolkit-02', '2026-10-18T00:07:22Z', '2026-10-18T06:27Z', 'placebo-d,placebo-b'),
    ('wellcare-01', '2026-10-18T06:34:20Z', '2026-10-18T12:48Z', 'hive-d,board-c,board-b,hive-c'),
    ('townsearch-02', '2026-10-18T13:00:37Z', '2026-10-19T01:16Z', 'board-a,board-d'),
    ('cobblekeep-01', '2026-10-20T05:06:57Z', '2026-10-20T11:23Z', 'board-a,placebo-d,hive-c,placebo-a'),
    ('toolkit-03', '2026-10-21T01:11:13Z', '2026-10-21T13:37Z', 'board-a,placebo-a,hive-b'),
    ('homefix-02', '2026-10-21T18:05:53Z', '2026-10-22T00:28Z', 'placebo-d,hive-a,board-c,board-b'),
    ('ironpick-01', '2026-10-22T00:36:03Z', '2026-10-22T06:56Z', 'hive-d,placebo-b,hive-c'),
    ('keepout-01', '2026-10-22T07:05:30Z', '2026-10-22T13:22Z', 'hive-b,placebo-a'),
    ('protectzone-01', '2026-10-22T13:36:13Z', '2026-10-22T16:54Z', 'board-a,board-c,board-b,hive-a'),
    ('townindex-01', '2026-10-22T18:56:29Z', '2026-10-23T01:17Z', 'placebo-d,hive-c,hive-d'),
    ('poolescape-01', '2026-10-23T01:48:44Z', '2026-10-23T08:05Z', 'board-d,placebo-a,hive-b'),
]
METRICS = ('gather_ok', 'mine_ok', 'craft_ok', 'td_n', 'td_ok', 'gather_h', 'explore_h', 'goto_h', 'gather_items')
SHARED = sorted(w for w in HOMES if not w.startswith('isolated'))


def ts(s):
    return dt.datetime.fromisoformat(s.replace('Z', '+00:00'))


def build_bins():
    """{(world, minute10_iso): {metric: value, '_bots': set}} at 10-minute resolution."""
    B = defaultdict(lambda: defaultdict(float))
    bots = defaultdict(set)
    for path in sorted(glob.glob(os.path.join(ROWS, '*.jsonl.gz'))):
        with gzip.open(path, 'rt') as f:
            for l in f:
                r = json.loads(l)
                w = world(r['p'])
                if w not in HOMES:
                    continue
                t = r['t']
                key = (w, t[:15])          # YYYY-MM-DDTHH:M -> 10-minute bin
                bots[key].add(r['b'])
                k, s, h = r['k'], r['s'], (r['ms'] or 0) / 3.6e6
                X = B[key]
                if k == 'gather':
                    X['gather_h'] += h
                    if s == 'success':
                        X['gather_ok'] += 1
                    X['gather_items'] += sum(v for v in (r['inv'] or {}).values() if v > 0)
                elif k == 'mine' and s == 'success':
                    X['mine_ok'] += 1
                elif k == 'craft' and s == 'success':
                    X['craft_ok'] += 1
                elif k == 'town_deposit':
                    X['td_n'] += 1
                    X['td_ok'] += s == 'success'
                elif k == 'explore':
                    X['explore_h'] += h
                elif k == 'goto':
                    X['goto_h'] += h
    return B, bots


def rate(B, bots, pools, lo, hi):
    """events per bot-hour over [lo, hi) for the pools; bot-hours = sum over 10-min bins of distinct bots / 6."""
    tot = defaultdict(float)
    bh = 0.0
    t = lo.replace(minute=(lo.minute // 10) * 10, second=0, microsecond=0)
    while t < hi:
        k = t.strftime('%Y-%m-%dT%H:%M')[:15]
        for w in pools:
            n = len(bots.get((w, k), ()))
            bh += n / 6.0
            for m, v in B.get((w, k), {}).items():
                tot[m] += v
        t += dt.timedelta(minutes=10)
    return {m: (tot[m] / bh if bh else float('nan')) for m in METRICS}, bh


def did(B, bots, can, ctl, pre, post):
    cpre, _ = rate(B, bots, can, *pre)
    cpo, bhc = rate(B, bots, can, *post)
    kpre, _ = rate(B, bots, ctl, *pre)
    kpo, bhk = rate(B, bots, ctl, *post)
    return {m: (cpo[m] - cpre[m]) - (kpo[m] - kpre[m]) for m in METRICS}, (cpre, cpo, kpre, kpo, bhc, bhk)


def main():
    B, bots = build_bins()
    random.seed(20261023)
    res = []
    for run, t0, t1, pools in CANARIES:
        can = pools.split(',')
        ctl = [w for w in SHARED if w not in can]
        T0, T1 = ts(t0), ts(t1)
        pre = (T0 - dt.timedelta(hours=6), T0)
        post = (T0 + dt.timedelta(minutes=15), T1)
        d, (cpre, cpo, kpre, kpo, bhc, bhk) = did(B, bots, can, ctl, pre, post)
        null = defaultdict(list)
        for _ in range(300):
            fake = random.sample(ctl, len(can))
            rest = [w for w in ctl if w not in fake]
            dn, _ = did(B, bots, fake, rest, pre, post)
            for m in METRICS:
                null[m].append(dn[m])
        sd = {m: statistics.pstdev(null[m]) for m in METRICS}
        row = {'run': run, 'pools': can, 'post_hours': round((T1 - T0).total_seconds() / 3600, 2),
               'canary_bot_h_post': round(bhc, 1), 'control_bot_h_post': round(bhk, 1),
               'did': d, 'null_sd': sd, 'z': {m: (d[m] / sd[m] if sd[m] else None) for m in METRICS},
               'fleet_day': {m: d[m] * 1920 for m in METRICS},
               'canary_pre': cpre, 'canary_post': cpo, 'control_pre': kpre, 'control_post': kpo}
        res.append(row)
        print(f"{run:15s} {len(can)}p post {row['post_hours']:5.1f}h  " + '  '.join(
            f"{m}={d[m]:+.2f}(z{row['z'][m]:+.1f})" for m in ('gather_ok', 'mine_ok', 'craft_ok', 'td_n', 'explore_h')),
            flush=True)
    json.dump(res, open(os.path.join(HERE, 'out', 'canary_did.json'), 'w'), indent=1)
    # summed effect
    print('\nSUM over promoted canaries (fleet events/day if additive and persistent; +-1.96 x sqrt(sum sd^2) x 1920):')
    for m in METRICS:
        s = sum(r['fleet_day'][m] for r in res)
        se = (sum(r['null_sd'][m] ** 2 for r in res)) ** 0.5 * 1920
        print(f'  {m:12s} {s:+9.0f}  +-{1.96 * se:7.0f}')


if __name__ == '__main__':
    main()
