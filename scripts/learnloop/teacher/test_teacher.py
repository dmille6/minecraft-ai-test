#!/usr/bin/env python3
"""Behaviour tests for teacher_pilot.py: no network, no key read, no money.  python3 scripts/learnloop/teacher/test_teacher.py"""
import builtins, contextlib, datetime as dt, io, json, os, sys, tempfile, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import teacher_pilot as T  # noqa: E402

PASS = FAIL = 0


def check(name, fn):
    global PASS, FAIL
    try:
        fn(); PASS += 1; print('  PASS  ' + name)
    except Exception:
        FAIL += 1; print('  FAIL  ' + name); traceback.print_exc()


def items(n=1000, pt=2500):
    return [{'id': 'id%04d' % i, 'system': 'S' * 100, 'user': 'U saw_end: END-X', 'schema': {'type': 'object'},
             'prompt_tokens': pt, 'logged': {'skill': 'gather', 'args': {}, 'refused': i % 2 == 0, 'reason': 'repeat_loop',
                                             'status': 'failed', 'detail': 'x', 'failure_class': 'refused:repeat_loop'}}
            for i in range(n)]


def t_estimate_matches_the_design_arithmetic():
    """s.2.4: ~4.0 M input and 1.5 M output per 1,000 items; Opus 5.5 at batch $2/$10 -> ~$23, gpt-6.1-sol $1/$5 -> ~$11.5."""
    it = items(1000, pt=2494)
    b = T.plan_batches(it, 'B', 'blind'); c = T.plan_batches(it, 'C', 'blind')
    tin = sum(x['tin'] for x in b); tout = sum(x['tout'] for x in b)
    assert 3.3e6 < tin < 3.5e6 and tout == 1.5e6, (tin, tout)
    cb, cc = sum(x['usd'] for x in b), sum(x['usd'] for x in c)
    assert 21.0 < cb < 22.5 and 10.5 < cc < 11.3, (cb, cc)
    inf = T.plan_batches(it, 'B', 'informed')
    assert sum(len(x['items']) for x in inf) == 200


def t_batches_never_exceed_ten_dollars():
    for arm in ('B', 'C'):
        bs = T.plan_batches(items(1000, pt=6000), arm, 'blind')
        assert all(x['usd'] <= T.BATCH_USD for x in bs) and sum(len(x['items']) for x in bs) == 1000, [x['usd'] for x in bs]
        assert len(bs) > 1 or arm == 'C'


def t_ledger_month_to_date_and_the_80pct_line():
    now = dt.datetime(2026, 11, 5, tzinfo=dt.timezone.utc)
    rows = [{'ts': '2026-11-01T00:00:00Z', 'vendor': 'anthropic', 'arm': 'B', 'batch': 'b1', 'kind': 'estimate', 'usd': 9.0},
            {'ts': '2026-11-02T00:00:00Z', 'vendor': 'anthropic', 'arm': 'B', 'batch': 'b1', 'kind': 'actual', 'usd': 7.5},
            {'ts': '2026-11-03T00:00:00Z', 'vendor': 'anthropic', 'arm': 'B', 'batch': 'b2', 'kind': 'estimate', 'usd': 10.0},
            {'ts': '2026-10-30T00:00:00Z', 'vendor': 'anthropic', 'arm': 'B', 'batch': 'b0', 'kind': 'actual', 'usd': 70.0},
            {'ts': '2026-11-03T00:00:00Z', 'vendor': 'openai', 'arm': 'C', 'batch': 'c1', 'kind': 'actual', 'usd': 50.0}]
    assert T.month_to_date(rows, 'anthropic', now) == 17.5, 'actual b1 + pending estimate b2; October excluded'
    assert T.cap_check(rows, 'anthropic', 62.5, now)['ok'] and not T.cap_check(rows, 'anthropic', 62.6, now)['ok']
    assert not T.cap_check(rows, 'openai', 30.1, now)['ok'] and T.cap_check(rows, 'openai', 30.0, now)['ok']


def t_plan_never_reads_a_key_and_never_imports_an_sdk():
    d = tempfile.mkdtemp()
    for v in ('anthropic', 'openai'):
        p = os.path.join(d, v + '.key'); open(p, 'w').write('SECRET-' + v); os.chmod(p, 0o600)
    saved = dict(T.KEYS); T.KEYS.update({v: os.path.join(d, v + '.key') for v in ('anthropic', 'openai')})
    pf = os.path.join(d, 'pilot.jsonl')
    with open(pf, 'w') as fh:
        for i in items(50):
            fh.write(json.dumps(i) + '\n')
    real_open = builtins.open
    def guarded(f, *a, **k):
        if str(f).endswith('.key'):
            raise AssertionError('plan opened a key file: %s' % f)
        return real_open(f, *a, **k)
    builtins.open = guarded
    T.LEDGER = os.path.join(d, 'spend.jsonl')
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out):
            assert T.main(['plan', '--pilot', pf]) == 0
    finally:
        builtins.open = real_open; T.KEYS.clear(); T.KEYS.update(saved)
    text = out.getvalue()
    assert 'SECRET' not in text and 'key present, mode 0o600' in text and 'NOTHING WAS SENT' in text, text
    assert 'anthropic' not in sys.modules and 'openai' not in sys.modules
    assert not os.path.exists(T.LEDGER), 'plan writes no ledger row'


def t_key_mode_is_enforced_before_any_read():
    d = tempfile.mkdtemp(); p = os.path.join(d, 'anthropic.key'); open(p, 'w').write('x'); os.chmod(p, 0o644)
    saved = dict(T.KEYS); T.KEYS['anthropic'] = p
    try:
        assert T.key_status('anthropic')['mode_ok'] is False
        try:
            T.read_key('anthropic'); raise AssertionError('read a 644 key')
        except SystemExit as e:
            assert 'not mode 600' in str(e) and 'x' not in str(e).split('key')[0]
    finally:
        T.KEYS.clear(); T.KEYS.update(saved)


def t_request_shapes():
    it = items(1)[0]
    r = T.anthropic_request(it, 'blind')['params']
    assert r['model'] == 'claude-opus-5-5' and r['output_config']['effort'] == 'low'
    assert r['output_config']['format'] == {'type': 'json_schema', 'schema': it['schema']}
    assert 'thinking' not in r and 'fallbacks' not in r and 'betas' not in r, 'no thinking config (Opus 5.5 400s), no fallback'
    assert r['messages'][0]['content'] == it['user'], 'blind = exactly what the fleet model saw'
    o = T.openai_request(it, 'informed')['body']
    assert o['model'] == 'gpt-6.1-sol' and o['response_format']['json_schema']['strict'] is True
    assert 'LOGGED DECISION' in o['messages'][1]['content'] and 'refused by the gate: repeat_loop' in o['messages'][1]['content']


def t_submit_refuses_without_the_flag_and_without_a_probe():
    for argv, want in ((['submit', '--arm', 'B'], '--i-will-spend'),
                       (['submit', '--arm', 'B', '--i-will-spend', '--pilot', '/nonexistent'], None)):
        try:
            T.main(argv); raise AssertionError('submit ran')
        except SystemExit as e:
            if want:
                assert want in str(e), e
        except FileNotFoundError:
            pass
    d = tempfile.mkdtemp(); pf = os.path.join(d, 'p.jsonl')
    open(pf, 'w').write(''.join(json.dumps(i) + '\n' for i in items(10)))
    T.HOME = d
    try:
        T.main(['submit', '--arm', 'C', '--i-will-spend', '--pilot', pf]); raise AssertionError('submit ran without a probe')
    except SystemExit as e:
        assert 'probe' in str(e), e


def t_informed_subset_is_deterministic():
    it = items(1000)
    assert T.informed_ids(it) == T.informed_ids(list(reversed(it))) and len(T.informed_ids(it)) == 200


TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]
if __name__ == '__main__':
    for n, f in TESTS:
        check(n[2:], f)
    print('%d passed, %d failed' % (PASS, FAIL))
    sys.exit(1 if FAIL else 0)
