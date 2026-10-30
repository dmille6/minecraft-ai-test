#!/usr/bin/env python3
"""Behaviour tests for build_dataset.py's decisions (no fleet data).  python3 scripts/learnloop/test_build_dataset.py"""
import collections, os, random, sys, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_dataset as B  # noqa: E402

PASS = FAIL = 0
WORLDS = ['%s-%s' % (f, x) for f in ('board', 'hive', 'placebo', 'isolated') for x in 'abcd']


def check(n, f):
    global PASS, FAIL
    try:
        f(); PASS += 1; print('  PASS  ' + n)
    except Exception:
        FAIL += 1; print('  FAIL  ' + n); traceback.print_exc()


def t_heldout_draw_is_one_per_family_and_covers_every_world():
    seen = collections.Counter()
    for s in range(400):
        h = B.draw_heldout(WORLDS, random.Random(s))
        assert [B.world_family(w) for w in h] == ['board/hive', 'placebo', 'isolated'], h
        seen.update(h)
    assert set(seen) == set(WORLDS), 'every world can be drawn'
    try:
        B.draw_heldout([w for w in WORLDS if not w.startswith('placebo')]); raise AssertionError('drew without a placebo')
    except SystemExit:
        pass


def t_cells():
    h, nd = ['hive-b', 'placebo-c', 'isolated-a'], {'2026-10-20', '2026-10-21'}
    assert B.cell_of('hive-b', '2026-10-21', h, nd) == 'C' and B.cell_of('hive-b', '2026-10-12', h, nd) == 'A'
    assert B.cell_of('board-a', '2026-10-20', h, nd) == 'B' and B.cell_of('board-a', '2026-10-19', h, nd) == 'TRAIN'


def t_paid_quarantine():
    assert B.paid_refusal('fleet:qwen2.5:7b-instruct', None) is None
    assert 'without a recorded owner decision' in B.paid_refusal('teacher-paid:anthropic:claude-opus-5-5', None)
    assert B.paid_refusal('teacher-paid:anthropic:x', {'vendors': {'anthropic': ['eval']}}) is not None, 'eval is not train'
    assert B.paid_refusal('teacher-paid:anthropic:x', {'vendors': {'openai': ['train']}}) is not None, 'another vendor'
    assert B.paid_refusal('teacher-paid:anthropic:x', {'vendors': {'anthropic': ['eval', 'train']}}) is None


def t_lineage_share():
    ex = [{'provenance_model': 'qwen2.5:7b-instruct'}] * 3 + [{'provenance_model': 'cand-x'}]
    assert B.lineage_share(ex, {'cand-x'}) == 0.25 and B.lineage_share(ex, {'qwen3:8b'}) == 0.0


def t_stratified_floor_total_and_determinism():
    pools = {('refused:repeat_loop', 'gather'): [{'id': 'a%d' % i} for i in range(5000)],
             ('failed:missing', 'craft'): [{'id': 'b%d' % i} for i in range(40)],
             ('failed:timeout', 'mine'): [{'id': 'c%d' % i} for i in range(3)]}
    s1, q = B.stratified(pools, 1000, random.Random(7))
    s2, _ = B.stratified(pools, 1000, random.Random(7))
    assert len(s1) == 1000 and len({x['id'] for x in s1}) == 1000 and s1 == s2
    assert q[('failed:timeout', 'mine')] == 3 and q[('failed:missing', 'craft')] >= 10, q


def t_sqrt_allocation_balances_rare_skills():
    q = B.sqrt_allocate({'explore': 90000, 'gather': 40000, 'craft': 900, 'smelt': 30}, 2000)
    assert sum(q.values()) == 2000 and q['smelt'] >= 15, q          # natural share would be 0.46 of 2,000
    assert q['explore'] < 0.6 * 2000 and q['craft'] > 0.006 * 2000 * 3, q


def t_failure_class_and_transient():
    t = lambda refused, reason, status, detail, label='bad': {'gate': {'refused': refused, 'reason': reason},
                                                              'outcome': {'status': status, 'detail': detail}, 'label': label}
    assert B.failure_class(t(True, 'cooldown (x)', 'aborted', '')) == 'refused:cooldown' and B.is_transient(t(True, 'cooldown', 'aborted', ''))
    assert B.failure_class(t(False, None, 'failed', 'iron_ore found but unreachable')) == 'failed:unreachable'
    assert not B.is_transient(t(False, None, 'failed', 'missing sticks'))
    assert B.is_transient(t(False, None, 'failed', 'paused after repeated failures', label='void'))


def t_milestone_family():
    assert B.milestone_family('gather_iron_ore_3#2636') == 'gather_iron_ore' and B.milestone_family(None) == '-'


TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]
if __name__ == '__main__':
    for n, f in TESTS:
        check(n[2:], f)
    print('%d passed, %d failed' % (PASS, FAIL))
    sys.exit(1 if FAIL else 0)
