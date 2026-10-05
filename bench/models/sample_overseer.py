#!/usr/bin/env python3
"""Draw overseer (shadow-mayor) snapshots for the model benchmark. READ-ONLY on the bots host.

    nice python3 sample_overseer.py --out /tmp/mbench-overseer.jsonl [--n 36] [--since 2026-10-04T12:00]

Only snapshots of the CURRENT mayor revision (the newest mayor_rev seen) since --since. Three equal
strata: CONTESTED (some duty has more feasible candidates than cap_per_duty), FEASIBLE (some feasible
candidate, none contested), NONE (shortages but no feasible candidate: abstain/unmet is correct).
Each record carries the snapshot and the deterministic mayor's answer for the same snap_id.
"""
import argparse, collections, glob, json, random

ap = argparse.ArgumentParser()
ap.add_argument('--out', required=True)
ap.add_argument('--n', type=int, default=36)
ap.add_argument('--since', default='2026-10-04T12:00')
ap.add_argument('--seed', type=int, default=20261005)
a = ap.parse_args()
rng = random.Random(a.seed)

det = {}
for f in glob.glob('/var/lib/mcai-mayor/assign-*.jsonl'):
    for line in open(f):
        try:
            r = json.loads(line)
        except ValueError:
            continue
        det[r.get('snap_id')] = r
snaps, revs = [], collections.Counter()
for f in glob.glob('/var/lib/mcai-mayor/snap-*.jsonl'):
    for line in open(f):
        try:
            s = json.loads(line)
        except ValueError:
            continue
        if s.get('t', '') < a.since:
            continue
        revs[s.get('mayor_rev')] += 1
        snaps.append(s)
rev = max(revs, key=lambda k: max(x['t'] for x in snaps if x.get('mayor_rev') == k))
print('POSITIVE CONTROL: snapshots since %s: %d, revisions %s, using %s; det answers %d'
      % (a.since, len(snaps), dict(revs), rev, len(det)))
snaps = [s for s in snaps if s.get('mayor_rev') == rev and s['snap_id'] in det and s.get('shortages')]
strata = collections.defaultdict(list)
for s in snaps:
    feas = [c for c in s['candidates'] if c.get('feasible')]
    per = collections.Counter(c['duty'] for c in feas)
    cap = s['cfg']['cap_per_duty']
    k = 'contested' if any(v > cap for v in per.values()) else ('feasible' if feas else 'none')
    strata[k].append(s)
out = []
for k in ('contested', 'feasible', 'none'):
    pool = strata[k]
    rng.shuffle(pool)
    seen = collections.Counter()
    for s in pool:
        if sum(1 for o in out if o['stratum'] == k) >= a.n // 3:
            break
        if seen[s['world']] >= 3:
            continue
        seen[s['world']] += 1
        out.append({'id': 'o-%03d' % len(out), 'set': 'overseer', 'stratum': k, 'snap': s, 'det': det[s['snap_id']]})
    print('  stratum %-9s population %5d drew %d' % (k, len(pool), sum(1 for o in out if o['stratum'] == k)))
with open(a.out, 'w') as fh:
    for o in out:
        fh.write(json.dumps(o) + '\n')
print('wrote', len(out))
