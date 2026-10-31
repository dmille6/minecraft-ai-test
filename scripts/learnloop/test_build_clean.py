#!/usr/bin/env python3
"""Tests for build_clean.py's decisions (behaviour, not source text). Run: python3 scripts/learnloop/test_build_clean.py"""
import json, os, sys, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_clean as BC  # noqa: E402

PASS = FAIL = 0


def check(name, fn):
    global PASS, FAIL
    try:
        fn(); PASS += 1; print('  PASS ', name)
    except Exception:
        FAIL += 1; print('  FAIL ', name); traceback.print_exc()


def trip(skill='gather', args=None, label='good', refused=False, reason=None, items600=3, ms120=0):
    return {'action': {'skill': skill, 'args': args or {'block': 'dirt'}}, 'label': label,
            'gate': {'refused': refused, 'reason': reason},
            'window': {'600': {'items': items600}, '120': {'milestones': ms120}}}


USER = 'You are at x=0 y=64 z=0.\nINVENTORY: dirt x3\nsaw_end: END-AAAA'


def item(kind='fail', skill='gather', args=None, vetoed=None):
    it = {'id': 'x', 'kind': kind, 'user': USER, 'sentinel': 'END-AAAA',
          'logged': {'skill': skill, 'args': args or {'block': 'stone'}}}
    if vetoed:
        it['vetoed'] = vetoed
    return it


def rec(skill, args, valid=True, prov='teacher-local:qwen3.8:27b'):
    return {'id': 'x', 'schemaValid': valid, 'proposal': {'reason': 'r', 'skill': skill, 'args': args}, 'provenance': prov}


def t_output_needs_items_or_milestone():
    assert BC.output_ok(trip(items600=1))
    assert BC.output_ok(trip(items600=0, ms120=1))
    assert not BC.output_ok(trip(items600=0, ms120=0))


def t_repeat_of_bad_prev_is_dropped_only_when_prev_was_bad():
    t = trip(skill='gather', args={'block': 'dirt'})
    assert BC.repeats_bad_prev(t, trip(skill='gather', args={'block': 'dirt'}, label='bad'))
    assert BC.repeats_bad_prev(t, trip(skill='gather', args={'block': 'dirt'}, label='neutral', refused=True))
    assert not BC.repeats_bad_prev(t, trip(skill='gather', args={'block': 'dirt'}, label='good'))   # repeating a success is fine
    assert not BC.repeats_bad_prev(t, trip(skill='mine', args={'block': 'dirt'}, label='bad'))
    assert not BC.repeats_bad_prev(t, None)


def t_top_half_is_per_skill():
    c = [{'skill': 'gather', 'items600': n} for n in (1, 2, 3, 4)] + [{'skill': 'craft', 'items600': n} for n in (10, 30)]
    out, med = BC.top_half(c)
    assert med == {'gather': 2.5, 'craft': 20.0}, med
    assert sorted((x['skill'], x['items600']) for x in out) == [('craft', 30), ('gather', 3), ('gather', 4)]


def t_canonical_format_and_reason_cap():
    s = BC.canonical({'skill': 'goto', 'args': {'x': 1, 'y': 2, 'z': 3}, 'reason': 'r' * 80, 'saw_end': 'WRONG'}, 'END-AAAA')
    d = json.loads(s)
    assert list(d) == ['reason', 'skill', 'args', 'saw_end'] and len(d['reason']) == 60 and d['saw_end'] == 'END-AAAA'
    assert ' ' not in s.replace('r' * 60, '')       # compact, like the fleet's own answers


def t_label_filter_drops_the_logged_failed_action():
    ok, why = BC.keep_label(item('fail', 'gather', {'block': 'stone'}), rec('gather', {'block': 'stone', 'count': 4}))
    assert not ok and why == 'repeats the logged failed action', why      # key_of = skill + key argument
    ok, why = BC.keep_label(item('fail', 'gather', {'block': 'stone'}), rec('gather', {'block': 'dirt'}))
    assert ok, why


def t_label_filter_drops_the_vetoed_action_after_a_veto():
    it = item('post_veto', 'explore', {}, vetoed=['gather', {'block': 'dirt'}])
    assert BC.keep_label(it, rec('gather', {'block': 'dirt'}))[1] == 'repeats the vetoed action'
    assert BC.keep_label(it, rec('gather', {'block': 'dirt', 'count': 9}))[1] == 'repeats the vetoed action'
    assert BC.keep_label(it, rec('explore', {}))[0]          # the logged action itself is not the vetoed one


def t_label_filter_invalid_paid_and_missing():
    assert BC.keep_label(item(), rec('gather', {'block': 'dirt'}, valid=False))[1] == 'schema invalid'
    assert BC.keep_label(item(), rec('gather', {'block': 'dirt'}, prov='teacher-paid:anthropic:claude-opus-5-5'))[1] == 'paid quarantine'
    assert BC.keep_label(item(), None)[1] == 'no answer'
    assert BC.keep_label(item(), {'id': 'x', 'transport_error': True})[1] == 'no answer'


def t_label_filter_refuses_an_unknown_or_missing_source():
    r = rec('gather', {'block': 'dirt'}); r.pop('provenance')
    assert BC.keep_label(item(), r)[1] == 'unknown source'                  # never defaulted to local
    assert BC.keep_label(item(), rec('gather', {'block': 'dirt'}, prov='teacher-local:claude-opus-5-5'))[1] == 'unknown source'
    assert BC.keep_label(item(), rec('gather', {'block': 'dirt'}, prov='fleet:qwen2.5:7b-instruct'))[1] == 'unknown source'


def t_post_veto_item_that_itself_failed_cannot_be_relabelled_with_that_action():
    it = item('post_veto', 'gather', {'block': 'stone'}, vetoed=['explore', {}])
    it['logged'].update({'label': 'bad', 'failure_class': 'failed:blocked'})
    assert BC.keep_label(it, rec('gather', {'block': 'stone'}))[1] == 'repeats the logged failed action'
    it['logged'].update({'failure_class': 'refused:cooldown'})               # transient: a retry may be right
    assert BC.keep_label(it, rec('gather', {'block': 'stone'}))[0]


def t_skill_cap_limits_one_action_and_keeps_the_rest():
    import random
    mk = lambda i, sk: {'id': '%04d' % i, 'assistant': json.dumps({'skill': sk})}
    mix = [('surface', 60), ('gather', 15), ('mine', 10), ('deposit', 10), ('goto', 5)]
    rows, i = [], 0
    for sk, n in mix:
        for _ in range(n):
            rows.append(mk(i, sk)); i += 1
    out, dropped = BC.cap_skill_share(rows, 0.30, random.Random(1))
    c = {}
    for r in out:
        k = json.loads(r['assistant'])['skill']; c[k] = c.get(k, 0) + 1
    assert {k: c[k] for k in ('gather', 'mine', 'deposit', 'goto')} == {'gather': 15, 'mine': 10, 'deposit': 10, 'goto': 5}, c
    assert c['surface'] == int(0.3 * 40 / 0.7) == 17 and dropped == {'surface': 43}, (c, dropped)
    assert c['surface'] / sum(c.values()) <= 0.30
    same, d2 = BC.cap_skill_share(out, 0.30, random.Random(1))      # already under the cap: unchanged
    assert d2 == {} and len(same) == len(out)
    # a smaller skill lifted over the cap by the first cut is capped too (Codex r3): 60/25/10/5 -> nobody above 30%
    rows2, i = [], 0
    for sk, n in [('surface', 60), ('gather', 25), ('mine', 10), ('goto', 5), ('home', 5), ('explore', 5)]:
        for _ in range(n):
            rows2.append(mk(i, sk)); i += 1
    out2, dr2 = BC.cap_skill_share(rows2, 0.30, random.Random(1))
    c2 = {}
    for r in out2:
        k = json.loads(r['assistant'])['skill']; c2[k] = c2.get(k, 0) + 1
    assert max(c2.values()) / sum(c2.values()) <= 0.30 + 1e-9 and set(dr2) == {'surface', 'gather'}, (c2, dr2)


def t_pilot_split_check_refuses_heldout_and_eval_items():
    split = {'heldout_worlds_excluded': ['board-a'], 'days': ['2026-10-08', '2026-10-09']}
    ok = {'id': 'a', 'world': 'board-b', 'day': '2026-10-08'}
    assert BC.split_problem(ok, split, set()) is None
    assert BC.split_problem(dict(ok, world='board-a'), split, set()).startswith('held-out world')
    assert BC.split_problem(dict(ok, day='2026-10-20'), split, set()).startswith('day 2026-10-20')
    assert BC.split_problem(ok, split, {'a'}) == 'an evaluation id'


def t_label_filter_runs_the_hard_check():
    # positive control: score.check_action must fire on SOMETHING the filter sees -- craft of an item it cannot craft
    import score as S
    f = S.facts(USER)
    hits = [(sk, a) for sk, a in (('craft', {'item': 'diamond_pickaxe'}), ('smelt', {'item': 'iron_ingot'}),
                                  ('mine', {'block': 'diamond_ore'})) if S.check_action(sk, a, f)[0]]
    assert hits, 'no hard-check positive control fired on this prompt'
    sk, a = hits[0]
    assert BC.keep_label(item(), rec(sk, a))[1] == 'hard check'


TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]
if __name__ == '__main__':
    for n, f in TESTS:
        check(n[2:], f)
    print('%d passed, %d failed' % (PASS, FAIL))
    sys.exit(1 if FAIL else 0)
