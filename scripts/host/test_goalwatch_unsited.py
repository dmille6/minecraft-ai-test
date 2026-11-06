#!/usr/bin/env python3
"""goalwatch skips an UNSITED record (pathsfix-01, 11-06): the paths' no-site record is no longer structure_complete (an
unroutable network is unsited, not done) and must not page as a stuck open goal; an open record still counts (the control)."""
import datetime as dt, json, os, sys, tempfile
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import goalwatch as GW  # noqa: E402

fails = 0
def check(ok, msg):
    global fails
    print(('  PASS  ' if ok else '  FAIL  ') + msg)
    fails += 0 if ok else 1

with tempfile.TemporaryDirectory() as root, tempfile.TemporaryDirectory() as logs:
    d = os.path.join(root, '_pool-board-a'); os.makedirs(d)
    def rec(plot, body):
        p = os.path.join(d, f'project-355_73_147.{plot}.g1.json')
        json.dump({'at': 1, **body}, open(p, 'w'))
    rec('paths', {'blueprint': 'paths@1', 'state': 'no_site', 'structure_complete': False, 'cells': []})
    rec('wall', {'blueprint': 'wall@1', 'state': 'open', 'structure_complete': False, 'cells': [{'at': [1, 2, 3]}]})
    now = dt.datetime.now(dt.timezone.utc)
    rep = GW.collect(root, logs, now)
    check(rep['records_scanned'] == 2, f"both records scanned (got {rep['records_scanned']})")
    check(rep['open'] == 1, f"the unsited paths record is no open goal; the open wall is (open={rep['open']})")
sys.exit(1 if fails else 0)
