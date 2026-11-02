#!/usr/bin/env python3
"""test_servea_q.py -- servea-q.py's pure decisions (serving A, 11-02): when is servea-01 the scheduler's next launch."""
import importlib.util, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
def load(src=None):
    p = os.path.join(HERE, 'servea-q.py')
    spec = importlib.util.spec_from_loader('servea_q', loader=None)
    m = importlib.util.module_from_spec(spec)
    exec(compile(src if src is not None else open(p).read(), p, 'exec'), m.__dict__)
    return m
Q = load()
T = []
def t(name, ok, ctx=''):
    T.append(bool(ok)); print('  %s  %s%s' % ('PASS' if ok else 'FAIL', name, '' if ok else '  :: %r' % (ctx,)))

STATUS = '''tidy-01              running    -                  hold=None not_before=None after=['fleetbuild-01'] variants=c711879
fewerdec-01          ready      -                  hold=HELD 11-02 12:30Z by control session: autorebase REFUSED not_before=None
deepminer-01         ready      -                  hold=None not_before=None after=['stuckcells-01'] variants=963e99a
servea-01            ready      model-env          hold=HELD -- serving option A not_before=None after=['promptcache-01']
llmoai-01            ready      -                  hold=HELD -- serving A not_before=None after=['servea-01']
R11 EXPIRED (v37): cooldown15-01 closed 2026-11-02T03:33:11Z
DECISION: busy S2 running: canary-loop.sh (pid 331821: bash /home/mike/canary-loop.sh tidy-01)'''
ents, busy, dec = Q.parse_status(STATUS)
t('parse: five entries in queue order, holds read, the R11 line ignored',
  [e['run'] for e in ents] == ['tidy-01', 'fewerdec-01', 'deepminer-01', 'servea-01', 'llmoai-01']
  and [e['held'] for e in ents] == [False, True, False, True, True], ents)
t('parse: busy from the DECISION line', busy and dec.startswith('DECISION: busy'))
t('head: not ready while anything ahead is running / held / ready', not Q.head_ready(ents, 'servea-01'))
done = [dict(e, state='done') if e['run'] in ('tidy-01', 'deepminer-01') else dict(e, state='cancelled') if e['run'] == 'fewerdec-01' else e for e in ents]
t('head: ready once everything ahead is done/cancelled', Q.head_ready(done, 'servea-01'))
t('head: llmoai-01 is not ready while servea-01 is ahead', not Q.head_ready(done, 'llmoai-01'))
odd = [dict(e, state='weird-new-state') if e['run'] == 'deepminer-01' else e for e in done]
t('head: an UNKNOWN state ahead blocks (fail closed)', not Q.head_ready(odd, 'servea-01'))
t('head: a run not in the queue is never ready', not Q.head_ready(done, 'nope-01'))
_, b2, _ = Q.parse_status(STATUS.replace('DECISION: busy S2 running', 'DECISION: launch'))
_, b3, _ = Q.parse_status(STATUS.split('DECISION')[0])
t('busy: false on a non-busy decision; TRUE when there is no DECISION line (fail closed)', (not b2) and b3)
src = open(os.path.join(HERE, 'servea-q.py')).read()
old = "        if e['state'] not in TERMINAL:\n            return False"
assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE'
M = load(src.replace(old, "        pass"))
t('MUTANT KILLED: without the terminal check servea-01 looks ready behind a running canary', M.head_ready(ents, 'servea-01'))
print('\n%d/%d pass' % (sum(T), len(T)))
sys.exit(0 if all(T) else 1)
