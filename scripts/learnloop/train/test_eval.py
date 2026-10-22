#!/usr/bin/env python3
"""Behaviour tests for eval_offline.py (no network).  python3 scripts/learnloop/train/test_eval.py"""
import os, sys, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import eval_offline as E  # noqa: E402

PASS = FAIL = 0
PROMPT = ('STATE: health 20/20, position 10,64,10, day\nINVENTORY: oak_log x3\nCAN CRAFT NOW: oak_planks, stick\n'
          'CAN SMELT NOW: raw_iron -> iron_ingot\nNEARBY: stone@3m, oak_log@5m\nsaw_end: END-AAAA')


def check(n, f):
    global PASS, FAIL
    try:
        f(); PASS += 1; print('  PASS  ' + n)
    except Exception:
        FAIL += 1; print('  FAIL  ' + n); traceback.print_exc()


def item(i, kind, skill, args, vetoed=None):
    it = {'id': 'i%d' % i, 'eval_kind': kind, 'user': PROMPT, 'logged': {'skill': skill, 'args': args}}
    if vetoed:
        it['vetoed'] = vetoed
    return it


ITEMS = [item(1, 'good', 'gather', {'block': 'stone'}), item(2, 'good', 'gather', {'block': 'oak_log'}),
         item(3, 'fail', 'craft', {'item': 'stone_pickaxe'}), item(4, 'fail', 'smelt', {'item': 'cobblestone'}),
         item(5, 'post_veto', 'explore', {}, vetoed=['gather', {'block': 'stone'}]),
         item(6, 'post_veto', 'gather', {'block': 'stone'}, vetoed=['gather', {'block': 'stone'}])]


def rec(i, skill, args, valid=True, retry=0):
    return {'id': 'i%d' % i, 'model': 'm', 'proposal': {'skill': skill, 'args': args} if valid else None,
            'schemaValid': valid, 'retryCount': retry}


def t_logged_positive_control_fires_on_failures_not_on_good():
    t = E.table(E.score_one(ITEMS))
    assert t['hard_on_fail_items'] == 100.0 and t['hard_on_good_items'] == 0.0, t
    assert t['post_veto_repeat'] == 50.0 and t['denominators'] == {'all': 6, 'fail': 2, 'post_veto': 2, 'good': 2}, t


def t_candidate_metrics_and_gates():
    ref = [rec(1, 'gather', {'block': 'stone'}), rec(2, 'gather', {'block': 'stone'}), rec(3, 'craft', {'item': 'stone_pickaxe'}),
           rec(4, 'smelt', {'item': 'raw_iron'}), rec(5, 'gather', {'block': 'stone'}), rec(6, 'explore', {})]
    cand = [rec(1, 'gather', {'block': 'stone'}), rec(2, 'gather', {'block': 'oak_log'}), rec(3, 'craft', {'item': 'oak_planks'}),
            rec(4, 'smelt', {'item': 'raw_iron'}), rec(5, 'explore', {}), rec(6, 'explore', {}, valid=False, retry=1)]
    r, c = E.table(E.score_one(ITEMS, ref)), E.table(E.score_one(ITEMS, cand))
    assert r['rep_fail'] == 50.0 and r['hard'] == 16.7 and r['post_veto_repeat'] == 50.0 and r['schema_valid'] == 100.0, r
    assert c['rep_fail'] == 0.0 and c['hard'] == 0.0 and c['schema_valid'] == 83.3 and c['retry'] == 16.7, c
    assert c['agree_key'] == 100.0 and r['agree_key'] == 50.0
    g = E.gates(c, r)
    assert not g['pass'] and not g['gates']['schema_valid >= ref - 0.5 pp'] and g['gates']['hard <= ref'], g
    assert E.gates(r, r)['pass'] and not E.gates(r, r, instrument_ok=False)['pass']


def t_a_candidate_that_skips_items_gets_no_verdict():
    """Codex r1 P1: 1 answer of 6 must not pass because its denominator shrank."""
    ref = [rec(i, 'explore', {}) for i in range(1, 7)]
    one = [rec(1, 'gather', {'block': 'stone'})]
    g = E.gates(E.table(E.score_one(ITEMS, one)), E.table(E.score_one(ITEMS, ref)))
    assert not g['pass'] and not g['gates']['complete coverage (candidate and reference answered every item)'], g


def t_missing_and_transport_errors_are_counted_not_scored():
    recs = [rec(1, 'gather', {'block': 'stone'}), dict(rec(2, 'gather', {}), transport_error=True)]
    t = E.table(E.score_one(ITEMS, recs))
    assert t['n'] == 1 and t['missing'] == 5, t


def t_export_check_needs_97pct_same_skill_and_no_validity_loss():
    f16 = [rec(i, 'gather', {}) for i in range(100)]
    q4 = [rec(i, 'gather' if i >= 3 else 'mine', {}) for i in range(100)]
    assert E.export_check(q4, f16)['pass']
    q4b = [rec(i, 'gather' if i >= 4 else 'mine', {}) for i in range(100)]
    assert not E.export_check(q4b, f16)['pass']
    q4c = [rec(i, 'gather', {}, valid=i > 0) for i in range(100)]
    assert not E.export_check(q4c, f16)['pass'], 'schema-valid share fell'
    ids = ['i%d' % i for i in range(100)]
    assert not E.export_check(q4[:1], f16, ids)['pass'], 'Codex r2: 1 Q4 answer against 100 must not pass'
    assert E.export_check(q4, f16, ids)['pass']


TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]
if __name__ == '__main__':
    for n, f in TESTS:
        check(n[2:], f)
    print('%d passed, %d failed' % (PASS, FAIL))
    sys.exit(1 if FAIL else 0)
