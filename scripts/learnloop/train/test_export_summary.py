#!/usr/bin/env python3
"""Behaviour tests for export_summary.py (no network).  python3 scripts/learnloop/train/test_export_summary.py"""
import os, sys, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import export_summary as X  # noqa: E402

PASS = FAIL = 0
IDS = ['i%d' % i for i in range(100)]


def check(n, f):
    global PASS, FAIL
    try:
        f(); PASS += 1; print('  PASS  ' + n)
    except Exception:
        FAIL += 1; print('  FAIL  ' + n); traceback.print_exc()


def run(skills, valid=True):
    return [{'id': i, 'schemaValid': valid, 'proposal': {'skill': s, 'args': {}}} for i, s in zip(IDS, skills)]


BF = run(['gather'] * 100)
SAME = run(['gather'] * 100)
OFF = lambda k: run(['explore'] * k + ['gather'] * (100 - k))


def t_ceiling_flag_follows_the_determinism_control():
    assert X.summarise(IDS, BF, SAME, SAME, {'q': SAME})['ceiling_below_gate'] is False
    r = X.summarise(IDS, BF, SAME, OFF(4), {'q': SAME})                 # the control itself only reaches 96%
    assert r['ceiling_below_gate'] is True and r['determinism_control']['same_skill_pct'] == 96.0


def t_quant_verdicts_are_the_unchanged_gate():
    r = X.summarise(IDS, BF, SAME, SAME, {'good': OFF(3), 'bad': OFF(4)})
    assert r['quants']['good']['pass'] is True and r['quants']['bad']['pass'] is False     # 97% passes, 96% fails
    short = SAME[:90]
    assert X.summarise(IDS, BF, SAME, SAME, {'short': short})['quants']['short']['pass'] is False   # coverage first


TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]
if __name__ == '__main__':
    for n, f in TESTS:
        check(n[2:], f)
    print('%d passed, %d failed' % (PASS, FAIL))
    sys.exit(1 if FAIL else 0)
