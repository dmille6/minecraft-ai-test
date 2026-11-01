#!/usr/bin/env python3
"""The tripwire's G3 (lid / unreachable found containers) over the REAL rows of the 11-01 storehouse-01 false trip.

    python3 infra/showcase/test_trip_g3_standing.py            # the checks; exit 1 on a failure
    python3 infra/showcase/test_trip_g3_standing.py --mutants  # each mutant must make the checks FAIL

What happened (2026-11-01): storehouse-01 walled in the five store chests at x -14..-8, z -3..3. From 14:42Z to 15:16Z every
bot's own `_townplan_audit` (bots/src/townplan.mjs auditPlan: a walk from the plan home, standFor each placed cell) named
them unreachable -- true while the doorway at -10,71,3 was blocked. From 15:16Z every audit read unreachable=0, and Juno
banked into -9,71,-2 at 15:33Z. G3 never reads the world: it reads those audits, and it LATCHED the first naming forever
(right for the found-01 canary read, where a REVERT stands; wrong for a tripwire that stops the bots). The 15:35Z read
tripped on audits that the bots had already overturned.

The fixture is the real rows (fixtures/g3-storehouse-01-20261101.jsonl): the five `_found` placements (10-25) and every
showcase `_townplan_audit` from 14:00Z to 15:50Z (11-01), run through the INSTALLED code path: showcase_trip.plan_rows
(the streaming loader) -> plan_read (the shared pool + FD.judge(standing=True)).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
FIXTURE = os.path.join(HERE, 'fixtures', 'g3-storehouse-01-20261101.jsonl')
CHESTS = {'-9,71,-2', '-13,71,0', '-13,71,2', '-11,71,-2', '-9,71,2'}

DRIVER = r'''
import datetime as dt, json, sys
import showcase_trip as ST
since = dt.datetime(2026, 10, 25, 15, 13, tzinfo=dt.timezone.utc)
rows, den = ST.plan_rows(since, paths=sys.argv[1])
defects, report = ST.plan_read(rows, since, plans={'showcase': {}})
print(json.dumps({'den': den, 'rows': len(rows), 'g3': defects['G3 lid_unreach'], 'items': report['items'].get('G3 lid_unreach', []),
                  'cleared': report['lists'].get('lid_unreach_cleared', [])}))
'''


def env(src_found=None, src_trip=None):
    d = tempfile.mkdtemp(prefix='g3stand-')
    os.makedirs(os.path.join(d, 'lib'))
    shutil.copy(src_trip or os.path.join(HERE, 'showcase_trip.py'), os.path.join(d, 'showcase_trip.py'))
    shutil.copy(os.path.join(ROOT, 'scripts', 'host', 'townplanread.py'), d)
    shutil.copy(src_found or os.path.join(ROOT, 'scripts', 'host', 'foundread.py'), os.path.join(d, 'foundread.py'))
    shutil.copy(os.path.join(ROOT, 'scripts', 'lib', 'telemetry.py'), os.path.join(d, 'lib'))
    open(os.path.join(d, 'lib', '__init__.py'), 'a').close()
    open(os.path.join(d, 'drv.py'), 'w').write(DRIVER)
    return d


def read(d, lines):
    p = os.path.join(d, 'rows.jsonl')
    with open(p, 'w') as fh:
        fh.write(''.join(lines))
    r = subprocess.run([sys.executable, 'drv.py', p], cwd=d, capture_output=True, text=True, timeout=120)
    if r.returncode:
        raise AssertionError('driver crashed: ' + (r.stdout + r.stderr)[-800:])
    return json.loads(r.stdout.strip().splitlines()[-1])


def g3_at(res):
    return {x.split()[1] for x in res['items']}


def checks(d):
    """-> [failure strings]; empty = pass."""
    fails = []
    lines = open(FIXTURE).readlines()
    ok = lambda c, why: None if c else fails.append(why)
    found = [l for l in lines if '"_found"' in l]
    audits = [l for l in lines if '"_townplan_audit"' in l]
    named = [l for l in audits if 'unreachable:-9,71,-2' in l]
    ok(len(found) == 6 and len(audits) >= 60 and len(named) >= 20, 'fixture shape: 6 _found, >=60 audits, >=20 naming (%d %d %d)'
       % (len(found), len(audits), len(named)))
    # 1. the real day: named 14:42-15:16, cleared by every later audit -> nothing stands
    full = read(d, lines)
    ok(full['rows'] == len(lines), 'positive control: the loader kept every fixture row (%d of %d)' % (full['rows'], len(lines)))
    ok(full['g3'] == 0 and not (g3_at(full) & CHESTS), 'storehouse chests reachable by the bots\' latest audits: G3 %d %s' % (full['g3'], full['items']))
    ok(full['cleared'] and {x.split()[1] for x in full['cleared']} <= CHESTS, 'cleared names reported (the report keeps 3): %s' % full['cleared'])
    # 2. SEALED: the same rows cut at 15:16Z (the doorway never cleared) -> all five stand, with the ACK item text unchanged
    cut = [l for l in lines if json.loads(l)['@timestamp'] < '2026-11-01T15:16:20']
    sealed = read(d, cut)
    ok(sealed['g3'] == 5 and g3_at(sealed) == CHESTS, 'a sealed storehouse still trips G3 on all five: %d %s' % (sealed['g3'], sealed['items']))
    ok(all(x.endswith('unreachable; no SOFT/BOX adopter in that box before it (unrelated or the found placement itself)')
           for x in sealed['items']), 'the item text (ACK.json key) is unchanged: %s' % sealed['items'][:1])
    # 3. RE-SEALED: one chest named again after the clear -> it stands again (the clear is not an amnesty)
    again = json.loads(named[-1])
    again['@timestamp'] = '2026-11-01T15:55:00.000Z'
    again['skill']['detail'] = again['skill']['detail'].replace('unreachable=6', 'unreachable=1').split(' first=')[0] + ' first=unreachable:-13,71,0'
    re_ = read(d, lines + [json.dumps(again) + '\n'])
    ok(re_['g3'] == 1 and g3_at(re_) == {'-13,71,0'}, 'named again after the clear, it stands: %d %s' % (re_['g3'], re_['items']))
    # 4. a later audit that cannot tell (unknown=1: a chunk unread) clears nothing
    blind = []
    for l in lines:
        r = json.loads(l)
        if r['@timestamp'] >= '2026-11-01T15:16:20' and r['skill']['name'] == '_townplan_audit':
            r['skill']['detail'] = r['skill']['detail'].replace('unknown=0', 'unknown=1')
        blind.append(json.dumps(r) + '\n')
    b = read(d, blind)
    ok(b['g3'] == 5, 'audits with unknown=1 never clear a name: %d' % b['g3'])
    # 5. a later audit whose 6-name list is FULL (7 defects) and omits the chests cannot tell either
    over = json.loads(named[-1])
    over['@timestamp'] = '2026-11-01T15:17:00.000Z'
    over['skill']['detail'] = over['skill']['detail'].split(' first=')[0].replace('unreachable=6', 'unreachable=7') + ' first=' + \
        ';'.join('unreachable:40,71,%d' % i for i in range(6))
    o = read(d, cut + [json.dumps(over) + '\n'])
    ok(o['g3'] == 5, 'a full (capped) name list that omits them clears nothing: %d' % o['g3'])
    return fails


MUTANTS = [
    ('scripts/host/foundread.py', "                    del raised[(k, cls)]\n", "                    pass\n", 'the clear never removes the name'),
    ('scripts/host/foundread.py', "    if c['unknown'] != 0:\n        return False\n", "", 'an unknown=1 audit clears'),
    ('scripts/host/foundread.py', "            if standing and cls in ('lid', 'unreachable'):\n                raised.setdefault((k, cls), r)\n                continue\n",
     "", 'standing ignored (the latch is back)'),
    ('scripts/host/foundread.py', "    if c[cls] == 0:\n        return True\n", "    if c[cls] >= 0:\n        return True\n", 'any audit clears'),
    ('infra/showcase/showcase_trip.py', "acc, zones, standing=True)", "acc, zones)", 'the tripwire does not ask for standing'),
]


def mutants():
    bad = 0
    for rel, old, new, what in MUTANTS:
        src = open(os.path.join(ROOT, rel)).read()
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: %s in %s' % (what, rel)
        td = tempfile.mkdtemp(prefix='g3mut-')
        p = os.path.join(td, os.path.basename(rel))
        open(p, 'w').write(src.replace(old, new))
        d = env(src_found=p if rel.endswith('foundread.py') else None, src_trip=p if rel.endswith('showcase_trip.py') else None)
        try:
            f = checks(d)
        except AssertionError as e:
            f = [str(e)]
        print('%-8s %s%s' % ('KILLED' if f else 'SURVIVED', what, (' -- ' + f[0][:110]) if f else ''))
        bad += not f
        shutil.rmtree(d, ignore_errors=True); shutil.rmtree(td, ignore_errors=True)
    return bad


def main():
    d = env()
    f = checks(d)
    shutil.rmtree(d, ignore_errors=True)
    for x in f:
        print('FAIL', x)
    if f:
        sys.exit(1)
    print('g3 standing: ok (real storehouse-01 rows: 0 standing, sealed 5, re-sealed 1, blind audits clear nothing)')
    if '--mutants' in sys.argv:
        n = mutants()
        print('mutants: %d survived' % n)
        sys.exit(1 if n else 0)


if __name__ == '__main__':
    main()
