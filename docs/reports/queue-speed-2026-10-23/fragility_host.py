#!/usr/bin/env python3
"""fragility_host.py queries > q.json | fragility_host.py summarise r1-host.json -- the F4 check redone with the GATE'S
OWN loader on the host (hostbaseline.py), after round 1 showed the 5-min-bucket version (baseline_fragility.py) could
not be trusted at a one-vote margin. Every 4-pool set of the 11 drawable pools at ironpick-01's and poolescape-01's
actual declared times, at the +180 (240) and +360 (360) lookbacks, classified: clean / tied vote / an asymmetric row."""
import collections, itertools, json, sys

POOLS = ['board-a', 'board-b', 'board-c', 'board-d', 'hive-a', 'hive-b', 'hive-c', 'hive-d', 'placebo-a', 'placebo-b',
         'placebo-d']
TIMES = ('2026-10-22T00:36:03+00:00', '2026-10-23T01:48:44+00:00')

if sys.argv[1] == 'queries':
    q = {}
    for D in TIMES:
        for s in itertools.combinations(POOLS, 4):
            for L in (240, 360):
                q['%s|%s|%d' % (','.join(s), D, L)] = {'pools': list(s), 'D': D, 'L': L}
    print(json.dumps(q))
else:
    r = json.load(open(sys.argv[2]))
    c = collections.Counter()
    for k, v in r.items():
        D, L = k.split('|')[1][:16], k.split('|')[2]
        w = v['why']
        cat = 'clean' if v['ok'] else ('tied vote' if 'tied control majority' in w else
                                       ('asymmetric row' if 'asymmetric build' in w else 'other'))
        c[(D, L, cat)] += 1
    for k in sorted(c):
        print('%s lookback %s: %-15s %d' % (k[0], k[1], k[2], c[k]))
