#!/usr/bin/env python3
"""Tests for stategen.py's pure parts: python3 -B scripts/host/test_stategen.py"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import stategen as G  # noqa: E402

UTC = dt.timezone.utc
NOW = dt.datetime(2026, 11, 2, 13, 0, tzinfo=UTC)
FAILS = []


def check(name, ok):
    print(('PASS  ' if ok else 'FAIL  ') + name)
    if not ok:
        FAILS.append(name)


J = [
    {'ts': '2026-11-01T23:37:04Z', 'run': 'fleetbuild-01', 'phase': 'recorded', 'note': 'KEEP'},
    {'ts': '2026-11-01T23:47:04Z', 'run': 'fleetbuild-01', 'phase': 'promoted', 'note': 'c711879efec34974a1bc1c2d7ffd686c94a07104 fleet-wide'},
    {'ts': '2026-11-02T03:29:39Z', 'run': 'cooldown15-01', 'phase': 'recorded', 'note': 'REVERT'},
    {'ts': '2026-11-02T12:36:12Z', 'run': 'tidy-01', 'phase': 'deployed', 'note': 'placebo-a 2026-11-02T12:32:52Z'},
    {'ts': '2026-11-02T12:00:46Z', 'run': 'qwen35-roll', 'phase': 'rollout-hourly', 'note': '{}'},
    {'ts': '2026-10-30T12:00:46Z', 'run': 'old-roll', 'phase': 'rollout-start', 'note': 'old'},
    {'ts': 'bad', 'run': 'x', 'phase': 'promoted', 'note': 'c711879efec34974a1bc1c2d7ffd686c94a07104'},
]
F = G.journal_facts(J, NOW)
check('the newest promotion is the fleet sha, with its KEEP', F['promotions'][-1]['sha'].startswith('c711879e')
      and F['verdicts']['fleetbuild-01']['verdict'] == 'KEEP')
check('a row with an unreadable time is skipped (not a promotion)', len(F['promotions']) == 1)
check('rollouts: only the last 24 h', set(F['rollouts']) == {'qwen35-roll'})

STATUS = """fleetbuild-01        done       -                  hold=None not_before=None after=['apseal-01'] variants=0dfda7f
tidy-01              running    -                  hold=None not_before=None after=['fleetbuild-01'] variants=c711879
fewerdec-01          ready      -                  hold=HELD 11-02 12:30Z by control session: autorebase REFUSED not_before=None after=['cooldown15-01'] variants=dfb3ff1
drainpick-01         ready      -                  hold=None not_before=None after=['tidy-01'] variants=963e99a
townfloor-01         ready      -                  hold=PARKED -- DEAD VARIANT not_before=None after=['townzone-01'] variants=3b1ae8b
DECISION: busy S1 canary declared | S5 2 builds on the active units: {'c711879e+a2': 60, 'f1f5c16c+18': 20} | S7 tidy-01 is live"""
Q, D = G.parse_status(STATUS)
check('status rows parsed with state and hold', [(e['run'], e['state']) for e in Q][:2] == [('fleetbuild-01', 'done'), ('tidy-01', 'running')]
      and Q[2]['hold'].startswith('HELD') and Q[3]['hold'] is None)
check('the DECISION line is kept', D.startswith('busy S1'))

LOG = ['2026-11-02T12:30:01Z STILL   goalwatch-fleet goal:board-a/house1@1 :: STUCK 63 h',
       '2026-11-02T12:30:01Z NEW     slotwatch slot:idle :: idle',
       '2026-11-02T12:35:01Z CLEARED slotwatch slot:idle :: idle',
       'garbage line']
A = G.active_alarms(LOG)
check('alarms: a CLEARED key is not active, a STILL one is', list(A) == [('goalwatch-fleet', 'goal:board-a/house1@1')])

L = {'items': [{'id': 'a', 'state': 'open', 'owner_pending': 'which model?'}, {'id': 'b', 'state': 'done', 'owner_pending': 'x'},
               {'id': 'c', 'state': 'open'}]}
check('pending owner decisions: open rows with owner_pending only', G.pending_owner(L) == [('a', 'which model?')])

page = G.render_page('| gen |', 'my hand note\nsecond line')
check('the NOTES block round-trips verbatim', G.split_notes(page) == 'my hand note\nsecond line')
check('splice keeps the notes and replaces the generated part',
      G.split_notes(G.splice(page, '| new |')) == 'my hand note\nsecond line' and '| new |' in G.splice(page, '| new |')
      and '| gen |' not in G.splice(page, '| new |'))
check('a page without markers has no notes (None, never empty-as-ok)', G.split_notes('# old STATE') is None)

facts = {'journal': F, 'queue': Q, 'decision': D, 'builds': None, 'pending': [], 'alarms': A, 'stallcheck': 'STALLCHECK x',
         'opsaudit': 'OPSAUDIT y', 'breaker': 'ARMED', 'showcase': {'versions': {'d698024b' + '0' * 32: 900}, 'bots': 10,
                                                                     'restack': None}}
blk = G.generated_block(facts, NOW)
check('the slot names the canary and its +180 read time', 'tidy-01** deployed 11-02 12:36Z' in blk and '+180 11-02 15:36Z' in blk)
check('queue: free entries in order; HELD and PARKED named apart', 'drainpick-01' in blk and 'Held: fewerdec-01' in blk
      and 'Parked: townfloor-01' in blk)
check('no restack row is a !! line, not silence', '!! no `showcase_restack` row' in blk)
bad = G.generated_block({'journal': None, 'journal_error': 'gone', 'queue': None, 'queue_error': 'rc=1', 'pending': None,
                         'ledger_error': 'no clone', 'alarms': None, 'showcase': {'error': 'ES down'}}, NOW)
check('every unreadable source is a !! line', all(s in bad for s in ('!! journal UNREADABLE', '!! scheduler status UNREADABLE',
                                                                      '!! ledger UNREADABLE', '!! ALARMS.log UNREADABLE',
                                                                      '!! showcase stream UNREADABLE')))
stale = G.generated_block(dict(facts, fetch_error='git fetch rc=128: no network'), NOW)
check('Codex r1 BLOCK 3: a failed fetch is a !! line', '!! the ledger and NOTES are from a STALE clone' in stale)
print(f'\n{"FAILED " + str(len(FAILS)) if FAILS else "all passed"}')
sys.exit(1 if FAILS else 0)
