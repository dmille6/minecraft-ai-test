#!/usr/bin/env python3
"""livecheck_indexsearch.py -- READ-ONLY, run ON THE HOST from the Mac (nothing is written there):
    ssh 10.0.0.31 'python3 -B - indexsearch-01 2026-10-23T12:14:44Z board-a,placebo-a' < livecheck_indexsearch.py
The v36 gate's OWN loader and decision (tierrule.load_buckets + asymmetric_rows, the code verdict.py calls for a tier-2
KEEP) on the live canary's arms, at the lookbacks of its +180 (240 min) and +360 (360 min) reads. Roster = the enabled
units, as verdict.py builds it."""
import datetime as dt, os, sys
sys.path.insert(0, os.path.expanduser('~/mcai-analysis'))
import tierrule

run, decl, pools = sys.argv[1], sys.argv[2], set(sys.argv[3].split(','))
D = dt.datetime.fromisoformat(decl.replace('Z', '+00:00'))
wants = '/etc/systemd/system/multi-user.target.wants'
roster = sorted(n[len('mcbot@'):-len('.service')] for n in os.listdir(wants) if n.startswith('mcbot@') and n.endswith('.service') and n != 'mcbot@.service')
can = [b for b in roster if '-'.join(b.split('-')[:2]) in pools]
ctl = [b for b in roster if b not in can]
print('%s: %d canary bots, %d control bots (enabled units)' % (run, len(can), len(ctl)))
for L in (240, 360):
    since = D - dt.timedelta(minutes=L)
    bk, bad = tierrule.load_buckets('/var/log/mcai', roster, since, D)
    ok, why, het = tierrule.asymmetric_rows({b: bk.get(b, {}) for b in can}, {b: bk.get(b, {}) for b in ctl}, can, since, D, bad)
    print('  lookback %d min: %s -- %s' % (L, 'CLEAN' if ok else 'NOT CLEAN', why))
