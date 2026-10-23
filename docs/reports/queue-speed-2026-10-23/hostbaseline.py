#!/usr/bin/env python3
"""hostbaseline.py <queries.json> -- builds a READ-ONLY program for the fleet host and prints it; pipe it to
`ssh 10.0.0.31 'nice -n 19 python3 -B -' > r1.json`. It answers flips.py's R1 queries with the v36 GATE'S OWN code
path (Codex r1 P1): tierrule.load_buckets (exact window-relative 10-min buckets, every generation, corrupt lines
counted) and tierrule.asymmetric_rows, with verdict.py's arms -- canary = the enabled units of the pools, control =
every other enabled unit. Roster = today's enabled units (the -Charlie units of 10-12..10-21 are not in it: stated).
Positive control: the first query of every batch is each run's ACTUAL arms where flips.py emitted them."""
import json, sys

q = json.load(open(sys.argv[1]))
prog = r'''
import datetime as dt, json, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.expanduser('~/mcai-analysis'))
import tierrule
Q = %s
wants = '/etc/systemd/system/multi-user.target.wants'
roster = sorted(n[len('mcbot@'):-len('.service')] for n in os.listdir(wants)
                if n.startswith('mcbot@') and n.endswith('.service') and n != 'mcbot@.service')
pool = lambda b: '-'.join(b.split('-')[:2])
by_win = {}
for k, v in Q.items():
    by_win.setdefault((v['D'], v['L']), []).append(k)
out = {}
for (D, L), keys in sorted(by_win.items()):
    until = dt.datetime.fromisoformat(D)
    since = until - dt.timedelta(minutes=L)
    bk, bad = tierrule.load_buckets('/var/log/mcai', roster, since, until)
    for k in keys:
        ps = set(Q[k]['pools'])
        can = [b for b in roster if pool(b) in ps]
        ctl = [b for b in roster if b not in can]
        ok, why, het = tierrule.asymmetric_rows({b: bk.get(b, {}) for b in can}, {b: bk.get(b, {}) for b in ctl},
                                                can, since, until, bad)
        out[k] = {'ok': ok, 'why': why, 'bad': bad}
print(json.dumps(out))
''' % json.dumps(q)
print(prog)
