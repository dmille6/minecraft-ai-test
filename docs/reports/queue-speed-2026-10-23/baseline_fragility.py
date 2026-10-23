#!/usr/bin/env python3
"""baseline_fragility.py <snapshot> <scan.jsonl> <host mods> <patches> -- READ-ONLY.

FINDING behind design 1's flips. The v36 tier-2 baseline (tierrule.asymmetric_rows) passes a canary row on another
build only in the bucket EITHER SIDE of a change of the control majority. A fleet-wide promotion restarts 80 bots 12 s
apart (~16 min), so its rows straddle three 10-min buckets, and which bucket the majority flips in depends on a
one-vote margin -- i.e. on WHICH pools are in the control. This measures that: at each tier-2 run's ACTUAL declared
time since v36, every 3- and 4-pool canary set from the 11 drawable pools, the share whose +180 (240-min) and +360
(360-min) baselines come out NOT clean, and how many of those fail only on a transition-bucket row or a tied vote."""
import datetime as dt, itertools, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import drawsim, flips

RUNS = ['cobblekeep-01', 'bagbudget-01', 'toolkit-03', 'ironpick-01', 'protectzone-01', 'townindex-01', 'poolescape-01',
        'indexsearch-01']


def main(snap, scan, hostmods, patches):
    sim = drawsim.Sim(snap, scan, hostmods, patches)
    pools = [p for p in sim.pools if p != 'placebo-c' and not p.startswith('isolated')]
    print('%-15s %-12s %-30s %s' % ('run', 'declared', 'actual set: +180 / +360', 'all 3- and 4-pool sets NOT clean at +180 / +360'))
    for run in RUNS:
        D, (v, M), _dec = flips.recorded(sim, run)
        if D is None:
            continue
        act = set(next(r for r in sim.runs[run] if r['phase'] == 'deployed')['note'].split()[0].split(','))
        a180 = flips.baseline(sim, act, D, 240)[0]; a360 = flips.baseline(sim, act, D, 360)[0]
        promos = [p for p, _s in sim.promos]
        res = {}
        for k in (3, 4):
            sets = list(itertools.combinations(pools, k))
            cnt = [{'clean': 0, 'tie': 0, 'straddle': 0, 'genuine': 0, 'other': 0} for _ in (0, 1)]
            for s in sets:
                for j, L in enumerate((240, 360)):
                    ok, why = flips.baseline(sim, set(s), D, L)
                    if ok:
                        cnt[j]['clean'] += 1
                    elif 'tied control majority' in why:
                        cnt[j]['tie'] += 1
                    elif 'asymmetric build' in why:
                        m = re.search(r'bucket at (\d\d-\d\dT\d\d:\d\dZ)', why)
                        bt = drawsim.T('2026-' + m.group(1)) if m else None
                        # the offending bucket starts within 40 min after a fleet-wide promotion: a staggered restart
                        near = bt is not None and any(dt.timedelta(minutes=-10) <= bt - p <= dt.timedelta(minutes=40) for p in promos)
                        cnt[j]['straddle' if near else 'genuine'] += 1
                    else:
                        cnt[j]['other'] += 1
            res[k] = (len(sets), cnt)
        print('%-15s %s  %-5s / %-5s' % (run, drawsim.ISO(D), 'clean' if a180 else 'DIRTY', 'clean' if a360 else 'DIRTY'))
        for k, (n, cnt) in res.items():
            for j, L in enumerate((240, 360)):
                c = cnt[j]
                print('      k=%d L=%d: of %d sets clean %d | NOT clean: tied vote %d, restart straddle %d, a real other '
                      'build %d, other %d' % (k, L, n, c['clean'], c['tie'], c['straddle'], c['genuine'], c['other']))


if __name__ == '__main__':
    main(*sys.argv[1:5])
