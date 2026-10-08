#!/usr/bin/env python3
"""bagbands.py <bagnull.jsonl>  -- each bag fix's no-change band at +1440 under ITS OWN draw filter (bagnull.py), for its
primary field, beside the random-draw band. Edge = the empirical 2.5th percentile, floor(0.025 n) (the repository's
convention; at n < 40 that is the minimum). The effective n is the number of distinct cut DAYS, stated beside it."""
import sys, json, collections
PRIMARY = {'toolhygiene-01': 'pick_slots_did', 'peacefulkit-01': 'sword_slots_did', 'junkwell-02': 'slots_did',
           'gridfix-01': 'slots_did', 'stonecap-01': 'slots_did'}
recs = [json.loads(l) for l in open(sys.argv[1])]
by = collections.defaultdict(list)
for r in recs:
    if r.get('draw') and not r.get('unreadable') and not r.get('invalid'):     # the live read's validity rule
        by[r['scheme']].append(r)
out = {}
for scheme in ['random'] + list(PRIMARY):
    rs = by.get(scheme, [])
    for field in sorted({PRIMARY.get(scheme, 'slots_did'), 'slots_did'}):
        xs = sorted(r[field] for r in rs if r.get(field) == r.get(field) and r.get(field) is not None)
        n = len(xs)
        days = len({r['cut'][:10] for r in rs})
        cuts = len({r['cut'] for r in rs})
        if not n:
            print('%-15s %-17s n=0 (no cut had >= 4 eligible pools)' % (scheme, field)); continue
        q = lambda f: xs[min(n - 1, int(f * n))]
        edge = xs[int(0.025 * n)]
        print('%-15s %-17s n=%3d cuts=%2d days=%d  edge(2.5%%) %+.3f  p5 %+.3f  median %+.3f  p95 %+.3f  min %+.3f max %+.3f' % (
            scheme, field, n, cuts, days, edge, q(0.05), q(0.5), q(0.95), xs[0], xs[-1]))
        out['%s.%s' % (scheme, field)] = {'edge': round(edge, 3), 'n': n, 'cuts': cuts, 'days': days, 'median': round(q(0.5), 3)}
json.dump(out, open(sys.argv[1] + '.bands.json', 'w'), indent=1)
