#!/usr/bin/env python3
"""add_edges3.py <bands.json> <regdir> [--write]  -- add bag_fix.primary_by_pools["3"] to every bag-fix registration
(<run>.<sha>.json with class bag-fix and a bag_fix.primary) from bagbands.py's output on the 3 pools x 32 h null
(bagnull.py BAGNULL_K=3 BAGNULL_H=32). The edge is the run's OWN scheme for its registered primary field
('<run>.<field>'); the registered read/field/op are untouched. A run with no band (no cut had 3 eligible pools under its
filter) gets NO three-pool edge, so its three-pool final is INCONCLUSIVE (bagfixrule.primary_spec). Without --write it
only prints what it would change. Gate v35 round 3 (Claude 2a)."""
import glob, json, os, sys

bands = json.load(open(sys.argv[1])); regdir = sys.argv[2]; write = '--write' in sys.argv
src = os.path.basename(sys.argv[1])
for p in sorted(glob.glob(os.path.join(regdir, '*.*.json'))):
    n = os.path.basename(p)
    if len(n.split('.')) != 3:
        continue
    reg = json.load(open(p))
    bf = reg.get('bag_fix')
    if reg.get('class') != 'bag-fix' or not isinstance(bf, dict) or not isinstance(bf.get('primary'), dict):
        continue
    run = n.split('.')[0]; field = bf['primary'].get('field')
    b = bands.get('%s.%s' % (run, field))
    if not b:
        print('%-36s %-17s NO 3x32 band: no three-pool edge (a three-pool final is INCONCLUSIVE)' % (n, field)); continue
    if bf['primary'].get('op') != '<=':
        print('%-36s op %r: the 2.5th-percentile edge only fits "<=" -- skipped' % (n, bf['primary'].get('op'))); continue
    new = {'value': b['edge'], 'n': b['n'], 'cuts': b['cuts'], 'days': b['days'], 'median': b['median'],
           'source': '3 pools x 32 h POST vs PRE no-change null under this fix\'s draw_exposure filter, 2.5th percentile '
                     '(scripts/host/bagnull.py BAGNULL_K=3 BAGNULL_H=32 + bagbands.py; %s on 10.0.0.31). Gate v35: a '
                     'three-pool final uses this edge; the four-pool primary.value is never applied to it.' % src}
    old = (bf.get('primary_by_pools') or {}).get('3')
    print('%-36s %-17s 4x24 edge %+.3f  3x32 edge %+.3f (n=%d, %d days)%s' % (n, field, bf['primary'].get('value'), b['edge'],
                                                                          b['n'], b['days'], '' if old != new else ' (unchanged)'))
    if write and old != new:
        bf.setdefault('primary_by_pools', {})['3'] = new
        with open(p, 'w') as f:
            json.dump(reg, f, indent=1)
            f.write('\n')
