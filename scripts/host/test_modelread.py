#!/usr/bin/env python3
"""test_modelread.py -- modelread.py's pure decisions (qwen35-01, 10-30). Runs anywhere (no host files).

  stall       a bot is stalled only when no schema-valid row by the CANARY model on the CANARY build is newer than
              STALL_MIN; rows by the old model, on the old build, or schema-invalid do not count; a stopped unit is not
              a stall; nothing is stalled inside WARM_MIN
  poll        REVERT at two stalled bots, OK at one, UNREADABLE with no active unit
  repeats     rep_fail counts only after an admitted, non-transient FAILED decision; veto_repeat only after a
              repeat_loop refusal
  key_of      identical to bench/models/score.py key_of on every skill shape (the replay's definition)
  did         ratio-DiD arithmetic, and None (never 0) without a denominator
"""
import datetime as dt
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import modelread as M  # noqa: E402

T = []
D = dt.datetime(2026, 10, 31, 3, 0, tzinfo=dt.timezone.utc)
CS = 'c' * 40


def t(name, ok, detail=''):
    T.append(bool(ok))
    print('%s  %s' % ('PASS' if ok else 'FAIL', name) + ('' if ok else '\n        -> %r' % (detail,)))


def row(mins, model='qwen3.5:9b', valid=True, ver=CS, mismatch=None, skill='gather', args=None, status='success',
        detail='', admission='normal', error=None):
    return {'_t': D + dt.timedelta(minutes=mins), 'code': {'version': ver + '+abc'},
            'llm': {'model': model, 'schema_valid': valid, 'model_mismatch': mismatch, 'admission': admission, 'error': error},
            'tool_calls': [{'skill': skill, 'args': args or {'block': 'oak_log'}}], 'outcome': {'status': status, 'detail': detail}}


def main():
    now = D + dt.timedelta(minutes=60)
    act = {b: True for b in 'abcdef'}
    L = {'a': [row(55)],                                   # fresh
         'b': [row(45)],                                   # 15 min old: stalled
         'c': [row(58, model='qwen2.5:7b-instruct')],      # fresh but the old model: stalled
         'd': [row(58, ver='e' * 40)],                     # fresh but the old build: stalled
         'e': [row(58, valid=False)],                      # fresh but schema-invalid: stalled
         'f': []}                                          # nothing: stalled
    st = M.stall_bots(L, act, 'qwen3.5:9b', CS, now, D)
    t('stall: only the fresh canary-model row on the canary build counts', st == ['b', 'c', 'd', 'e', 'f'], st)
    t('stall: a stopped unit is not a stall', M.stall_bots({'f': []}, {'f': False}, 'qwen3.5:9b', CS, now, D) == [])
    t('stall: nothing inside WARM_MIN', M.stall_bots({'f': []}, {'f': True}, 'qwen3.5:9b', CS, D + dt.timedelta(minutes=10), D) == [])
    t('stall: a model_mismatch row does not count', M.stall_bots({'a': [row(58, mismatch='asked x served y')]}, {'a': True},
                                                                 'qwen3.5:9b', CS, now, D) == ['a'])
    t('stall: a quantisation-suffixed tag counts as the model', M.stall_bots({'a': [row(58, model='qwen3.5:9b-q4_K_M')]}, {'a': True},
                                                                             'qwen3.5:9b', CS, now, D) == [])
    t('poll: REVERT at 2', M.poll_decision(['a', 'b'], 10, False)[0] == 'REVERT')
    t('poll: OK at 1', M.poll_decision(['a'], 10, True)[0] == 'OK')
    t('poll: UNREADABLE with no active unit', M.poll_decision([], 0, True)[0] == 'UNREADABLE')

    seq = [row(1, status='failed', detail='no path to oak_log'),     # admitted failure
           row(2),                                                   # repeats it -> fail_rep
           row(3, skill='craft', args={'item': 'stick'}, status='failed', detail='busy with gather'),  # runner refused: not counted
           row(4, skill='craft', args={'item': 'stick'}),
           row(5, skill='mine', args={'y': 12}, status='failed', detail='timed out'),   # transient: not counted
           row(6, skill='mine', args={'y': 12}),
           row(7, skill='explore', args={'blocks': 40}, status='aborted', admission=None, error='repeat_loop (x3)'),  # veto
           row(8, skill='explore', args={'blocks': 80}),             # repeats the vetoed key (explore has no key arg)
           row(9, skill='goto', args={'x': 1, 'y': 2, 'z': 3}, status='aborted', admission=None, error='repeat_loop (x3)'),
           row(10, skill='goto', args={'x': 9, 'y': 2, 'z': 3})]     # a different goto: not a repeat
    c = M.repeat_rates(seq)
    t('repeats: rep_fail only after an admitted non-transient failure', (c['fail_n'], c['fail_rep']) == (1, 1), c)
    t('repeats: veto_repeat only after a repeat_loop refusal', (c['veto_n'], c['veto_rep']) == (2, 1), c)
    t('repeats: refused counted', c['refused'] == 2 and c['n'] == 10, c)

    try:
        sys.path.insert(0, os.path.join(HERE, '..', '..', 'bench', 'models'))
        import score as S
        shapes = [('gather', {'block': 'oak_log'}), ('craft', {'item': 'stick', 'count': 4}), ('mine', {'y': 11}),
                  ('goto', {'x': 1, 'y': 2, 'z': 3}), ('goto', {'player': 'Bob'}), ('bucket', {'action': 'fill'}),
                  ('build', {'plan': 'hut'}), ('explore', {'blocks': 9}), ('deposit', {'item': 'dirt'}), (None, None)]
        same = all(S.key_of(k, a) == M.key_of(k, a) for k, a in shapes)
        t('key_of: identical to bench/models/score.py on every shape', same)
    except ImportError as x:
        t('key_of: bench/models/score.py importable from the repo', False, x)

    t('did: arithmetic', abs(M.ratio_did(10, 12, 10, 10) - 0.2) < 1e-9)
    t('did: None without a denominator', M.ratio_did(0, 12, 10, 10) is None and M.ratio_did(None, 1, 1, 1) is None)
    t('share: None, never 0, without a denominator', M.share(0, 0) is None and M.share(0, 5) == 0)
    print('\n%d/%d pass' % (sum(T), len(T)))
    return 0 if all(T) else 1


if __name__ == '__main__':
    sys.exit(main())
