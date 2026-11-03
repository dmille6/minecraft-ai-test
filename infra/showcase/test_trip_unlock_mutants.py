#!/usr/bin/env python3
"""Mutants for the tripwire's village-unlock rule (showcase_trip.py canon/STATE, villageunlock-01, owner 11-03): each must make
`showcase_trip.py selftest` FAIL BY ASSERTION with the expected message. Every anchor is asserted present and unique before it is
replaced (CLAUDE.md). A control run (no mutant) must pass first. Needs nothing beside the file (the S4 selftest lines run alone).

    python3 infra/showcase/test_trip_unlock_mutants.py
"""
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
MUTANTS = [
    # the state suffix no longer cut: a toggled trapdoor reads as a changed cell
    ("    n = OXID.sub('', STATE.sub('', name))\n", "    n = OXID.sub('', name)\n", 'a toggled trapdoor / fence gate is INTACT'),
    # an over-broad rule: every trapdoor name collapses, so a trapdoor turned into another block is not a change
    ("STATE = re.compile(r'\\[.*\\]$')\n", "STATE = re.compile(r'(^minecraft:[a-z_]+_trapdoor)?(\\[.*\\])?$')\n", 'turned into another block is still a change'),
    # removals dropped for a cell whose state changed (an allowance that swallowed the removal)
    ("    removed = sorted('%s %s' % (k, v) for k, v in base.items() if k not in now)\n",
     "    removed = sorted('%s %s' % (k, v) for k, v in base.items() if k not in now and '[' not in v)\n", 'REMOVED trapdoor is still a breach'),
]


def run(d):
    p = subprocess.run([sys.executable, '-I', os.path.join(d, 'showcase_trip.py'), 'selftest'], cwd=d, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def main():
    d = tempfile.mkdtemp(prefix='tripunlock-')
    shutil.copy(os.path.join(HERE, 'showcase_trip.py'), d)
    rc, out = run(d)
    assert rc == 0 and 'selftest ok' in out, 'CONTROL: the selftest must pass:\n' + out[-1500:]
    src = open(os.path.join(d, 'showcase_trip.py')).read()
    killed = 0
    for old, new, want in MUTANTS:
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: %r' % old[:80]
        open(os.path.join(d, 'showcase_trip.py'), 'w').write(src.replace(old, new))
        rc, out = run(d)
        ok = rc != 0 and 'AssertionError' in out and want in out
        killed += ok
        print('  %s  %s  (expected: %s)' % ('KILLED ' if ok else 'SURVIVED', old.strip()[:70], want))
        if not ok:
            print(out[-800:])
    shutil.rmtree(d, ignore_errors=True)
    print('%d of %d mutants killed' % (killed, len(MUTANTS)))
    return 0 if killed == len(MUTANTS) else 1


if __name__ == '__main__':
    sys.exit(main())
