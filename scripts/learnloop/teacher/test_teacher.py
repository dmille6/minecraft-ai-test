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
    cb, cc = sum(x['usd_expected'] for x in b), sum(x['usd_expected'] for x in c)
    assert 21.0 < cb < 22.5 and 10.5 < cc < 11.3, (cb, cc)
    rb = sum(x['usd'] for x in b)
    assert abs(rb - (tin / 1e6 * 2 + 1000 * T.MAX_TOKENS / 1e6 * 10)) < 0.01, 'the reservation bills output at max_tokens'
    inf = T.plan_batches(it, 'B', 'informed')
    assert sum(len(x['items']) for x in inf) == 200


def t_batches_never_exceed_ten_dollars():
    for arm in ('B', 'C'):
        bs = T.plan_batches(items(1000, pt=6000), arm, 'blind')
        assert all(x['usd'] <= T.BATCH_USD for x in bs) and sum(len(x['items']) for x in bs) == 1000, [x['usd'] for x in bs]
        assert len(bs) > 1 or arm == 'C'


def t_ledger_month_to_date_and_the_80pct_line():
    now = dt.datetime(2026, 11, 5, tzinfo=dt.timezone.utc)
    A = lambda **k: dict({'vendor': 'anthropic', 'arm': 'B'}, **k)
    rows = [A(ts='2026-11-01T00:00:00Z', kind='reserve', reservation='r1', usd=9.0),
            A(ts='2026-11-01T00:00:00Z', kind='submitted', reservation='r1', batch='b1'),
            A(ts='2026-11-02T00:00:00Z', kind='actual', reservation='r1', batch='b1', usd=7.5),
            A(ts='2026-11-03T00:00:00Z', kind='reserve', reservation='r2', usd=10.0),     # crashed before `submitted`
            A(ts='2026-11-03T00:00:00Z', kind='reserve', reservation='r3', usd=4.0),
            A(ts='2026-11-03T00:00:00Z', kind='released', reservation='r3'),
            A(ts='2026-10-30T00:00:00Z', kind='actual', reservation='r0', batch='b0', usd=70.0),
            {'ts': '2026-11-03T00:00:00Z', 'vendor': 'openai', 'arm': 'C', 'batch': 'c1', 'kind': 'actual', 'usd': 50.0}]
    assert T.month_to_date(rows, 'anthropic', now) == 17.5, 'actual b1 + the unsubmitted reservation r2; released r3 and October out'
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


def _submit_env(n=10):
    d = tempfile.mkdtemp(); pf = os.path.join(d, 'p.jsonl')
    open(pf, 'w').write(''.join(json.dumps(i) + '\n' for i in items(n)))
    T.HOME = d; T.LEDGER = os.path.join(d, 'spend.jsonl')
    os.makedirs(os.path.join(d, 'teacher-paid', 'B')); open(os.path.join(d, 'teacher-paid', 'B', 'PROBE-OK'), 'w').write('x')
    return d, pf


class Args:
    def __init__(self, pf, **k):
        self.i_will_spend, self.arm, self.pilot, self.probe, self.condition, self.resubmit = True, 'B', pf, False, 'blind', False
        self.__dict__.update(k)


def _as_mac(fn):
    import socket
    saved = (socket.gethostname, sys.platform)
    socket.gethostname = lambda: 'mini4.local'; sys.platform = 'darwin'
    try:
        return fn()
    finally:
        socket.gethostname, sys.platform = saved


def t_reservation_is_durable_before_the_vendor_call_and_blocks_double_pay():
    d, pf = _submit_env()
    seen = []
    def boom(arm, its, cond):
        seen.append([json.loads(l)['kind'] for l in open(T.LEDGER)])
        raise RuntimeError('network died after the vendor took the batch')
    try:
        _as_mac(lambda: T.cmd_submit(Args(pf), submit=boom)); raise AssertionError('no raise')
    except RuntimeError:
        pass
    assert seen == [['reserve']], 'the reservation was on disk before the call'
    rows = T.ledger_rows()
    assert T.month_to_date(rows, 'anthropic') > 0, 'an uncertain submit stays counted'
    try:
        _as_mac(lambda: T.cmd_submit(Args(pf), submit=lambda *a: 'b-x')); raise AssertionError('double pay allowed')
    except SystemExit as e:
        assert 'never recorded as submitted' in str(e), e
    _as_mac(lambda: T.cmd_submit(Args(pf, resubmit=True), submit=lambda *a: 'b-2'))
    kinds = [r['kind'] for r in T.ledger_rows()]
    assert kinds == ['reserve', 'reserve', 'submitted'], kinds


def t_the_cap_refuses_before_any_vendor_call():
    d, pf = _submit_env(2000)
    called = []
    try:
        _as_mac(lambda: T.cmd_submit(Args(pf), submit=lambda *a: called.append(1) or 'b')); raise AssertionError('no refusal')
    except SystemExit as e:
        assert 'REFUSED by the ledger' in str(e), e
    assert len(called) == int(0.8 * T.CAP_USD['anthropic'] // T.BATCH_USD), (len(called), 'batches up to the 80% line, then refused')
    assert T.month_to_date(T.ledger_rows(), 'anthropic') <= 0.8 * T.CAP_USD['anthropic']


def t_a_stopped_run_resumes_without_paying_twice_and_reservations_cross_months():
    d, pf = _submit_env(1000)
    sent = []
    def flaky(arm, its, cond):
        if len(sent) == 1:
            raise RuntimeError('vendor 500 on batch 2')
        sent.append(len(its)); return 'b-%d' % len(sent)
    try:
        _as_mac(lambda: T.cmd_submit(Args(pf), submit=flaky)); raise AssertionError('no raise')
    except RuntimeError:
        pass
    assert sent and len(sent) == 1
    try:                                             # batch 2's reservation has no `submitted`: the unknown case
        _as_mac(lambda: T.cmd_submit(Args(pf), submit=lambda *a: 'b-x')); raise AssertionError('unknown case passed')
    except SystemExit as e:
        assert 'never recorded as submitted' in str(e), e
    rid = [r for r in T.ledger_rows() if r['kind'] == 'reserve'][-1]['reservation']
    assert T.main(['release', rid]) == 0
    calls = []
    _as_mac(lambda: T.cmd_submit(Args(pf), submit=lambda arm, its, cond: calls.append(len(its)) or 'b-%d' % (len(calls) + 1)))
    nb = len(T.plan_batches(T.load(pf), 'B', 'blind'))
    assert len(calls) == nb - 1, ('batch 1 skipped, the rest sent', len(calls), nb)
    rows = T.ledger_rows()
    nxt = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=40)
    assert T.month_to_date(rows, 'anthropic', nxt) == T.month_to_date(rows, 'anthropic'), 'unresolved reservations count in every month'


def t_resubmit_never_resends_a_submitted_batch_and_ids_are_unique():
    """Claude r3 P2 + Codex r3 P2: --resubmit re-paid submitted batches; a same-second retry reused a released id."""
    d, pf = _submit_env(1000)
    sent = []
    def flaky(arm, its, cond):
        if len(sent) == 1:
            raise RuntimeError('lost on batch 2')
        sent.append(len(its)); return 'b-%d' % len(sent)
    try:
        _as_mac(lambda: T.cmd_submit(Args(pf), submit=flaky))
    except RuntimeError:
        pass
    calls = []
    _as_mac(lambda: T.cmd_submit(Args(pf, resubmit=True), submit=lambda arm, its, cond: calls.append(len(its)) or 'b-r%d' % len(calls)))
    nb = len(T.plan_batches(T.load(pf), 'B', 'blind'))
    assert len(calls) == nb - 1, ('batch 1 is never sent again, even with --resubmit', len(calls), nb)
    res = [r['reservation'] for r in T.ledger_rows() if r['kind'] == 'reserve']
    assert len(res) == len(set(res)), 'every reservation attempt has its own id'
    import datetime as _dt
    real = T.dt.datetime
    class Frozen(real):
        @classmethod
        def now(cls, tz=None):
            return real(2026, 11, 2, 12, 0, 0, tzinfo=tz)
    d, pf = _submit_env(10)
    T.dt.datetime = Frozen
    try:
        try:
            _as_mac(lambda: T.cmd_submit(Args(pf), submit=lambda *a: (_ for _ in ()).throw(RuntimeError('x'))))
        except RuntimeError:
            pass
        rid = [r for r in T.ledger_rows() if r['kind'] == 'reserve'][-1]['reservation']
        T.main(['release', rid])
        try:
            _as_mac(lambda: T.cmd_submit(Args(pf), submit=lambda *a: (_ for _ in ()).throw(RuntimeError('y'))))
        except RuntimeError:
            pass
        rows = T.ledger_rows()
        ids = [r['reservation'] for r in rows if r['kind'] == 'reserve']
        assert len(ids) == 2 and ids[0] != ids[1], ids
        assert T.month_to_date(rows, 'anthropic', Frozen.now(_dt.timezone.utc)) > 0, 'the retry stays counted'
    finally:
        T.dt.datetime = real


def t_paid_verbs_refuse_off_the_mac():
    import socket
    saved = socket.gethostname
    socket.gethostname = lambda: 'block2-bots'
    try:
        for fn in (lambda: T.mac_only(),):
            try:
                fn(); raise AssertionError('ran off the Mac')
            except SystemExit as e:
                assert 'only on the Mac mini' in str(e)
    finally:
        socket.gethostname = saved


def t_informed_subset_is_deterministic():
    it = items(1000)
    assert T.informed_ids(it) == T.informed_ids(list(reversed(it))) and len(T.informed_ids(it)) == 200


TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]
if __name__ == '__main__':
    for n, f in TESTS:
        check(n[2:], f)
    print('%d passed, %d failed' % (PASS, FAIL))
    sys.exit(1 if FAIL else 0)
