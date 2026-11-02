#!/usr/bin/env python3
"""Tests for restack_prep.py's pure parts: python3 -B infra/showcase/test_restack_prep.py"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import restack_prep as RP  # noqa: E402

FAILS = []


def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok:
        FAILS.append(name)


T = lambda h: dt.datetime(2026, 11, 2, h, tzinfo=dt.timezone.utc)
A, B, C, L = 'a' * 40, 'b' * 40, 'c' * 40, 'f' * 40
kept = [(T(10), C, 'fleetbuild-01'), (T(8), B, 'apseal-01'), (T(1), A, 'zigfleet-02')]
same_as = lambda build: (lambda x, y: [] if x == build else ['bots/src/reflex.mjs'])
anc = lambda x, y: True

p = RP.plan(L, kept, same_as(C), anc)
check('in sync: the newest kept build has the live protected tree', p['status'] == 'in_sync')
p = RP.plan(L, kept, same_as(A), anc)
check('behind: restack onto the newest, base = the build the live release sits on',
      p['status'] == 'restack' and p['fleet'] == C and p['base'] == A and p['behind'] == ['fleetbuild-01', 'apseal-01'])
p = RP.plan(L, kept, lambda x, y: ['x'], anc)
check('no kept build matches the live protected tree: no_base (by hand)', p['status'] == 'no_base')
p = RP.plan(L, kept, same_as(A), lambda x, y: False)
check('a base that is not the target\'s ancestor: diverged (by hand)', p['status'] == 'diverged')
p = RP.plan(L, kept, lambda x, y: None, anc)
check('an undecidable protected diff is an error, never in_sync', p['status'] == 'error')
check('no live release / no fleet build are named', RP.plan(None, kept, same_as(C), anc)['status'] == 'error'
      and RP.plan(L, [], same_as(C), anc)['status'] == 'no_fleet')

J = [{'ts': '2026-11-02T01:00:00Z', 'run': 'x-01', 'phase': 'recorded', 'note': 'KEEP'},
     {'ts': '2026-11-02T01:10:00Z', 'run': 'x-01', 'phase': 'promoted', 'note': f'{A} fleet-wide'},
     {'ts': '2026-11-02T02:00:00Z', 'run': 'y-01', 'phase': 'recorded', 'note': 'REVERT'},
     {'ts': '2026-11-02T02:10:00Z', 'run': 'y-01', 'phase': 'promoted', 'note': f'{B} fleet-wide'}]
k = RP.kept_promotions(J, lambda h: h if len(h) == 40 else None)
check('only KEEP runs count as kept promotions', [x[2] for x in k] == ['x-01'])

check('failed files parsed', RP.failed_files('...\nFAILED (2): a.test.mjs b.test.mjs\n377/379 files passed\n') == {'a.test.mjs', 'b.test.mjs'})
check('a clean run is the empty set', RP.failed_files('wall 1s\n379/379 files passed\n') == set())
check('an unfinished run is None (never a pass)', RP.failed_files('ok a.test.mjs\nTIMEOUT\n') is None)
check('tests: pass', RP.judge_tests(set(), None)[0] == 'pass')
check('tests: failures all on the fleet build too -> same_as_fleet', RP.judge_tests({'well.test.mjs'}, {'well.test.mjs', 'x'})[0] == 'same_as_fleet')
check('tests: a failure only on the restack -> tests_failed', RP.judge_tests({'well.test.mjs', 'shop.test.mjs'}, {'well.test.mjs'})[0] == 'tests_failed')
check('tests: unfinished stays unfinished', RP.judge_tests(None, None)[0] == 'unfinished')
check('next steps name the record line with both engines', '--review codex:APPROVE' in RP.next_steps(C, L, A, 'r')
      and '--review claude:APPROVE' in RP.next_steps(C, L, A, 'r') and f'--base {L}' in RP.next_steps(C, L, A, 'r'))
print(f'\n{"FAILED " + str(len(FAILS)) if FAILS else "all passed"}')
sys.exit(1 if FAILS else 0)
