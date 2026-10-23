#!/usr/bin/env python3
"""test_lookahead.py [--mutants] -- behaviour tests for lookahead.py (design 2, proposed). Pure; runs anywhere.
--mutants: every guard of the owner's criteria (30 min, never twice in a row, no looking past a HOLD / refusal / unmet
`after` / missing variant / R11) is mutated on ONE anchored, unique line and must be killed; a positive control proves
the harness refuses an absent anchor."""
import datetime as dt, importlib.util, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'lookahead.py')
UTC = dt.timezone.utc
NOW = dt.datetime(2026, 10, 23, 10, 30, tzinfo=UTC)
ago = lambda m: NOW - dt.timedelta(minutes=m)


def load(path):
    spec = importlib.util.spec_from_file_location('lookahead_under_test_%d' % abs(hash(path)), path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def tests(L):
    out = []

    def t(name, cond, detail=''):
        out.append((name, bool(cond), detail))
    E = lambda run, **k: L.Entry(run=run, state=k.get('state', 'ready'), hold=k.get('hold', False),
                                 after_unmet=k.get('after_unmet', []), has_variant=k.get('has_variant', True),
                                 klass=k.get('klass', ''), other_blockers=k.get('other', []))
    H = lambda since=40, hard=(), skipped=False: L.Head(run='head', hard_blockers=list(hard),
                                                         draw_blocked_since=ago(since) if since is not None else None,
                                                         skipped_last=skipped)
    D = lambda head, behind, **k: L.decide(head, behind, NOW, k.get('free', True), k.get('r11', False), k.get('ns', False))
    ok = D(H(), [E('next')])
    t('launches the next ready entry after 30+ min draw-blocked', ok[0] == 'lookahead' and ok[1] == 'next', ok)
    t('29 min is not enough', D(H(29), [E('next')])[0] == 'no')
    t('exactly 30 min is enough', D(H(30), [E('next')])[0] == 'lookahead')
    t('a head that is not draw-blocked is never skipped', D(H(None), [E('next')])[0] == 'no')
    t('a HELD head is never looked past', D(H(hard=['held']), [E('next')])[0] == 'no')
    t('a head with a missing variant is never looked past', D(H(hard=['no variant for the fleet base']), [E('next')])[0] == 'no')
    t('never skipped twice in a row', D(H(skipped=True), [E('next')])[0] == 'no')
    t('R11 death-hold: nothing', D(H(), [E('next')], r11=True)[0] == 'no')
    t('slot not free: nothing', D(H(), [E('next')], free=False)[0] == 'no')
    t('NEXT-SLOT reservation: nothing', D(H(), [E('next')], ns=True)[0] == 'no')
    t('no looking past a HELD next entry', D(H(), [E('next', hold=True), E('third')])[0] == 'no')
    t('no looking past a refusal (blocked state)', D(H(), [E('next', state='blocked'), E('third')])[0] == 'no')
    # at depth 1 the scan ends after one position anyway; the deeper replay scan must stop at a refusal too
    t('no looking past a refusal, deeper scan', L.decide(H(), [E('next', state='blocked'), E('third')], NOW, True, False,
                                                         False, depth=0)[0] == 'no')
    t('no looking past a launching/running entry, deeper scan', L.decide(H(), [E('next', state='running'), E('third')],
                                                                         NOW, True, False, False, depth=0)[0] == 'no')
    t('no looking past an unmet after', D(H(), [E('next', after_unmet=['head']), E('third')])[0] == 'no')
    t('no looking past a missing variant', D(H(), [E('next', has_variant=False), E('third')])[0] == 'no')
    t('no looking past another blocker (H3-H6)', D(H(), [E('next', other=['H6 bag fix needs TARGET_K >= 4']), E('third')])[0] == 'no')
    t('done/cancelled entries are not positions', D(H(), [E('gone', state='done'), E('x', state='cancelled'), E('next')])[1] == 'next')
    t('depth 1: a draw-blocked-but-ready second entry is not reached past the first', D(H(), [E('next'), E('third')])[1] == 'next')
    t('empty queue behind: nothing', D(H(), [])[0] == 'no')
    rows = [{'state': 'drawwait', 'run': 'head', 'at': ago(50)}, {'state': 'drawwait', 'run': 'head', 'at': ago(45)}]
    t('episode start = the FIRST drawwait of the current run of them', L.draw_blocked_since(rows, 'head', NOW) == ago(50))
    rows2 = rows + [{'state': 'drawclear', 'run': 'head', 'at': ago(20)}, {'state': 'drawwait', 'run': 'head', 'at': ago(10)}]
    t('a drawclear restarts the episode', L.draw_blocked_since(rows2, 'head', NOW) == ago(10))
    rows3 = rows + [{'state': 'launching', 'run': 'head', 't0': 'x'}]
    t('a launch of the head ends the episode', L.draw_blocked_since(rows3, 'head', NOW) is None)
    t('another run\'s rows are ignored', L.draw_blocked_since([{'state': 'drawwait', 'run': 'other', 'at': ago(90)}], 'head', NOW) is None)
    st = [{'state': 'launching', 'run': 'a'}, {'state': 'launching', 'run': 'next', 'lookahead_past': 'head'}]
    t('skipped_last: the last launch skipped this head', L.skipped_last(st, 'head'))
    t('skipped_last: cleared once the head itself launches', not L.skipped_last(st + [{'state': 'launching', 'run': 'head'}], 'head'))
    t('skipped_last: a skip of ANOTHER head does not bind this one', not L.skipped_last(st, 'zzz'))
    return out


MUTANTS = [
    ("    if mins < wait_min:", "    if mins < 0:"),
    ("    if head.skipped_last:", "    if False:"),
    ("    if head.hard_blockers:", "    if False:"),
    ("    if death_hold:", "    if False:"),
    ("    if not slot_free:", "    if False:"),
    ("    if next_slot:", "    if False:"),
    ("    if e.hold:", "    if False:"),
    ("    if e.after_unmet:", "    if False:"),
    ("    if not e.has_variant:", "    if False:"),
    ("    if e.state in HARD_STATES:", "    if False:"),
    ("    out.extend(e.other_blockers or [])", "    pass"),
    ("        if hb:\n            return ('no',", "        if False:\n            return ('no',"),
    ("        elif r.get('state') in ('drawclear', 'launching'):", "        elif r.get('state') in ('launching',):"),
    ("            since = since or r.get('at')", "            since = r.get('at')"),
    ("    return bool(last and last.get('lookahead_past') == head_run)", "    return bool(last and last.get('lookahead_past'))"),
    ("        if e.state in ('done', 'cancelled'):\n            continue", "        if e.state in ('done', 'cancelled'):\n            return ('no', 'x')"),
    ("this anchor is not in lookahead.py", None),
]


def run_suite(L):
    res = tests(L)
    return [r for r in res if not r[1]], len(res)


def main():
    L = load(SRC)
    bad, n = run_suite(L)
    for name, _ok, d in bad:
        print('FAIL', name, d)
    print('test_lookahead: %d/%d pass' % (n - len(bad), n))
    if '--mutants' not in sys.argv:
        sys.exit(1 if bad else 0)
    src = open(SRC).read()
    fired = 0
    for a in [a for a, b in MUTANTS if b is None]:
        try:
            assert src.count(a) == 1, 'ANCHOR MISSING OR NOT UNIQUE'
        except AssertionError:
            fired += 1
    assert fired == len([1 for _a, b in MUTANTS if b is None]) and fired, 'the anchor assertion did not fire'
    print('positive control: the anchor assertion fired on %d absent anchor(s); refused, never scored' % fired)
    survived = 0
    real = [m for m in MUTANTS if m[1] is not None]
    for old, new in real:
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: %r (%d)' % (old, src.count(old))
        p = SRC + '.mutant.py'
        open(p, 'w').write(src.replace(old, new, 1))
        try:
            fails, _ = run_suite(load(p))
        except Exception as e:
            fails = [('crash', False, repr(e))]
        finally:
            os.remove(p)
        print('  mutant %-70r %s' % (old.strip()[:70], 'killed by %d test(s)' % len(fails) if fails else 'SURVIVED'))
        survived += not fails
    print('mutants: %d of %d killed' % (len(real) - survived, len(real)))
    sys.exit(1 if (bad or survived) else 0)


if __name__ == '__main__':
    main()
