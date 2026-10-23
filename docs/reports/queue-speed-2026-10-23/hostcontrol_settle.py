#!/usr/bin/env python3
"""hostcontrol_settle.py <patched drawsteady.py> <settlerule.py> <run> <STEADY_NOW ISO> <fleet sha> <declared_at ISO>
-- builds a READ-ONLY program for the fleet host and prints it; pipe it to `ssh 10.0.0.31 python3 -B -`. NOTHING is
written on the host: the two proposed modules travel inside the program, the manifest as it was at STEADY_NOW is served
from memory, and the incoming registration is the host's own with the replay's settle block added in memory.

The POSITIVE CONTROL of design 1's wiring: the PATCHED drawsteady.py, on the host's real ledger, journal, logs and
tierrule/bagread, at a past instant (STEADY_NOW, its own replay switch), must print today's lines unchanged for the
pools today's rule decides and a `STEADY settle ...` line for each settle candidate -- compare with replay_settle.py."""
import json, sys

ds, sr, run, now, sha, decl = sys.argv[1:7]
prog = r'''
import builtins, io, json, os, sys, types
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.expanduser('~/mcai-analysis'))
SRC = %(src)s
for name in ('settlerule', 'drawsteady'):
    m = types.ModuleType(name); m.__file__ = os.path.expanduser('~/mcai-analysis/%%s.py' %% name)
    sys.modules[name] = m
    exec(compile(SRC[name], m.__file__, 'exec'), m.__dict__)
D = sys.modules['drawsteady']
MAN = %(man)s
_real_open = builtins.open
def _open(p, *a, **k):
    if p == D.MANIFEST:
        return io.StringIO(json.dumps(MAN))
    return _real_open(p, *a, **k)
D.open = _open
_reg = D._incoming_reg
def _inj(run, regdir=None):
    r = _reg(run, regdir)
    if r is not None:
        r = dict(r, settle={'lookback_min': 0})
    return r
D._incoming_reg = _inj
os.environ['STEADY_NOW'] = %(now)r
os.environ['DRAW_RUN'] = %(run)r
D.main()
''' % {'src': repr({'drawsteady': open(ds).read(), 'settlerule': open(sr).read()}),
       'man': repr({'declared_code_version': sha, 'declared_at': decl, 'canary_pool': None,
                    'canary_code_version': None}), 'now': now, 'run': run}
print(prog)
