#!/usr/bin/env python3
"""Behaviour tests for the learning-loop M1 pipeline: extract_triples.py, nightly.py (controls, day selection, raw
tar, heartbeat, relay client) and nas-relay.sh (run against a fake NAS). No network, no fleet.

    python3 scripts/learnloop/test_learnloop.py          (exit 1 on any failure)
"""
import datetime as dt, gzip, io, json, os, subprocess, sys, tarfile, tempfile, traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import extract_triples as X  # noqa: E402
import nightly as N  # noqa: E402

PASS = FAIL = SKIP = 0
DAY = '2026-10-20'


def check(name, fn):
    global PASS, FAIL, SKIP
    try:
        fn(); PASS += 1; print('  PASS  ' + name)
    except Exception as e:
        if type(e).__name__ == 'Skip':
            SKIP += 1; print('  SKIP  %s: %s' % (name, e)); return
        FAIL += 1; print('  FAIL  ' + name); traceback.print_exc()


def ts(h, m, s=0, ms=0, day=DAY):
    return '%sT%02d:%02d:%02d.%03dZ' % (day, h, m, s, ms)


def llm_row(t, skill, status, detail='', latency=1500, admission='normal', error=None, nonce='END-AAAA', args=None,
            recent='', version='abc12345+dirty', sh='hashA', trigger='idle'):
    prompt = 'TASK: x\nSTATE: position 1,2,3, day, day 4188\nNEARBY: stone@4m\n' + \
             ('RECENT EVENTS (oldest first):\n' + recent + '\n' if recent else '') + 'saw_end: ' + nonce
    resp = json.dumps({'reason': 'r', 'skill': skill, 'args': args or {}, 'saw_end': nonce})
    return {'@timestamp': t, 'trigger': trigger, 'bot': {'name': 'w-a-Alpha'}, 'exp': {'pool': 'w-a'},
            'code': {'version': version}, 'prompt': {'system_hash': sh, 'text': prompt}, 'response': {'text': resp},
            'llm': {'latency_ms': latency, 'model': 'qwen2.5:7b-instruct', 'endpoint': 'http://10.0.0.72:11434',
                    'schema_valid': True, 'admission': admission, 'error': error},
            'tool_calls': [{'skill': skill, 'args': args or {}, 'reason': 'r'}] if skill else [],
            'messages': [{'milestone': 'm1'}], 'outcome': {'status': status, 'detail': detail}}


def skill_row(t, name, status, detail='', dur=2000, delta=None, trigger='llm:idle'):
    return {'@timestamp': t, 'trigger': trigger, 'skill': {'name': name, 'status': status, 'detail': detail,
                                                           'duration_ms': dur, 'inventory_delta': delta or {}}}


def write(path, rows, gz=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    op = gzip.open if gz else open
    with op(path, 'wt') as fh:
        for r in rows:
            fh.write(json.dumps(r, separators=(',', ':')) + '\n')


def fixture():
    """One bot, one day. Decisions (in order):
      d1 10:00:00 gather success, joined exact, +3 cobblestone           -> good (own gain)
      d2 10:01:00 gather refused (aborted, admission None)               -> bad
      d3 10:02:00 mine failed 'paused after repeated failures'           -> void (no skill row by construction)
      d4 10:03:00 explore success, joined, no gain, value from the next prompt = valuable -> good (value)
      d5 10:04:00 goto success, no gain, value neutral, a _death at 10:13:30 (within 600 s, after 120 s) -> neutral
      d6 10:20:00 deterministic (latency 0)                               -> not a triple
      d7 10:21:00 craft failed, joined exact                              -> bad
      d8 23:59:00 explore success, value line in the NEXT DAY's first decision -> value read past midnight
    plus one unparseable line, and a skill row that STARTED 09:58 and ENDED 10:00:30 (end-time window count)."""
    root = tempfile.mkdtemp(); roster = os.path.join(root, 'env'); logs = os.path.join(root, 'logs')
    os.makedirs(roster); open(os.path.join(roster, 'w-a-Alpha.env'), 'w').close()
    open(os.path.join(roster, '._w-a-Alpha.env'), 'w').close()        # AppleDouble: not a bot
    b = os.path.join(logs, 'w-a-Alpha')
    L = [llm_row(ts(10, 0), 'gather', 'success', 'collected 3 cobblestone', args={'block': 'stone'}),
         llm_row(ts(10, 1), 'gather', 'aborted', 'identical action', admission=None, error='repeat_loop (x3)'),
         llm_row(ts(10, 2), 'mine', 'failed', 'paused after repeated failures (cooldown)'),
         llm_row(ts(10, 3), 'explore', 'success', 'explored', recent=''),
         llm_row(ts(10, 4), 'goto', 'success', 'arrived', recent='  - explore -> success (valuable): explored'),
         llm_row(ts(10, 20), 'deposit', 'success', 'work order', latency=0),
         llm_row(ts(10, 21), 'craft', 'failed', 'missing sticks', recent='  - goto -> success (neutral): arrived'),
         llm_row(ts(23, 59), 'explore', 'success', 'explored')]
    nxt = [llm_row(ts(0, 0, 30, day='2026-10-21'), 'gather', 'success', 'collected', recent='  - explore -> success (valuable): explored')]
    K = [skill_row(ts(9, 58), 'gather', 'success', 'earlier', dur=150000, delta={'dirt': 2}, trigger='llm:idle'),
         skill_row(ts(10, 0, 1), 'gather', 'success', 'collected 3 cobblestone', delta={'cobblestone': 3}),
         skill_row(ts(10, 3, 1), 'explore', 'success', 'explored'),
         skill_row(ts(10, 4, 1), 'goto', 'success', 'arrived'),
         skill_row(ts(10, 13, 30), '_death', 'failed', 'drowned', dur=0, trigger='reflex'),
         skill_row(ts(10, 21, 1), 'craft', 'failed', 'missing sticks'),
         skill_row(ts(23, 59, 1), 'explore', 'success', 'explored'),
         skill_row(ts(0, 1, day='2026-10-21'), 'gather', 'success', 'collected', delta={'dirt': 1})]
    # day rows live in the generation rotated at the next midnight; the next day's rows in the live file
    write(os.path.join(b, 'llm-w-a-Alpha.jsonl-20261021.gz'), L, gz=True)
    with gzip.open(os.path.join(b, 'llm-w-a-Alpha.jsonl-20261021.gz'), 'at') as fh:
        fh.write('{"@timestamp":"2026-10-20T11:00:00.000Z", broken\n')
    write(os.path.join(b, 'llm-w-a-Alpha.jsonl'), nxt)
    write(os.path.join(b, 'skill-w-a-Alpha.jsonl-20261021.gz'), K[:-1], gz=True)
    write(os.path.join(b, 'skill-w-a-Alpha.jsonl'), K[-1:])
    return root, roster, logs


def shard_rows(out):
    with gzip.open(os.path.join(out, 'triples-20261020.jsonl.gz'), 'rt') as fh:
        return [json.loads(l) for l in fh]


def t_extract_labels_joins_and_counts():
    root, roster, logs = fixture(); out = os.path.join(root, 'out')
    s = X.extract_day(DAY, logs, roster, out)
    rows = shard_rows(out)
    by = {r['ts'][11:16]: r for r in rows}
    assert [r['ts'][11:16] for r in rows] == ['10:00', '10:01', '10:02', '10:03', '10:04', '10:21', '23:59'], list(by)
    assert by['10:00']['label'] == 'good' and by['10:00']['outcome']['join'] == 'exact', by['10:00']
    assert by['10:01']['label'] == 'bad' and by['10:01']['gate'] == {'refused': True, 'reason': 'repeat_loop (x3)', 'admission': None}
    assert by['10:02']['label'] == 'void' and by['10:02']['outcome']['join'] == 'none'
    assert by['10:03']['label'] == 'good' and by['10:03']['outcome']['value'] == 'valuable', by['10:03']['outcome']
    assert by['10:04']['label'] == 'neutral' and by['10:04']['window']['600']['deaths'] == 1 and by['10:04']['window']['120']['deaths'] == 0
    assert by['10:21']['label'] == 'bad' and by['10:21']['outcome']['join'] == 'exact'
    assert by['23:59']['outcome']['value'] == 'valuable', 'the value line is read past midnight'
    # end-time windows: the 09:58 gather (ended 10:00:30) counts in d1's window, and not as its own row
    assert by['10:00']['window']['120']['items'] == 5 and by['10:00']['window']['120']['items_other'] == 2, by['10:00']['window']
    assert s['rows']['model_rows'] == 7 and s['rows']['deterministic_rows'] == 1 and s['positive_control']['llm_rows'] == 8
    assert s['rows_extra'] == {'llm_rows_raw': 9, 'triples_written': 7, 'dup_near': s['rows_extra']['dup_near'],
                               'admitted_without_skill': 0}, s['rows_extra']
    assert s['positive_control']['reader_rejects'] == {'unparseable_line': 1}, s['positive_control']
    assert s['labels'] == {'good': 2, 'bad': 2, 'void': 1, 'neutral': 2}, s['labels']
    assert by['23:59']['label'] == 'neutral' and not by['23:59']['window']['600']['observed'], 'censored: the bot has no row after 00:09'
    assert s['join_miss_why'] == {'paused (runner refused to start)': 1}, s['join_miss_why']
    assert s['system_hash_by_version'] == {'abc12345': {'hashA': 7}}, s['system_hash_by_version']
    assert all(r['label_rule'] == X.LABEL_RULE and r['extractor'] == X.EXTRACTOR_VERSION for r in rows)
    assert s['positive_control']['roster'] == 1, 'the AppleDouble ._ file is not a bot'


def t_shard_bytes_are_deterministic():
    """A re-run of a day that failed before `seal` re-sends its shard; the same rows must give the same sha256."""
    import hashlib
    root, roster, logs = fixture()
    X.extract_day(DAY, logs, roster, os.path.join(root, 'o1'))
    X.extract_day(DAY, logs, roster, os.path.join(root, 'o2'))
    h = lambda d: hashlib.sha256(open(os.path.join(root, d, 'triples-20261020.jsonl.gz'), 'rb').read()).hexdigest()
    assert h('o1') == h('o2')
    hdr = open(os.path.join(root, 'o1', 'triples-20261020.jsonl.gz'), 'rb').read(10)
    assert hdr[4:8] == b'\0\0\0\0', 'gzip MTIME is 0 (two runs a second apart would otherwise differ)'
    assert not os.path.exists(os.path.join(root, 'o1', 'triples-20261020.jsonl.gz.part'))


def t_label_rule_every_branch():
    w = lambda d=0, s=0, m=0, o=True: {'deaths': d, 'stagnation': s, 'milestones': m, 'observed': o}
    L = X.label
    assert L(False, 'failed', 'paused after repeated failures', None, 0, w(), w()) == 'void'
    assert L(False, 'failed', 'busy with mine', None, 0, w(), w()) == 'void'
    assert L(True, 'aborted', 'x', None, 5, w(), w()) == 'bad'
    assert L(False, 'aborted', 'x', None, 5, w(), w()) == 'bad'
    assert L(False, 'success', '', 'valuable', 0, w(s=1), w()) == 'bad'
    assert L(False, 'success', '', 'valuable', 0, w(d=1), w(d=1)) == 'bad'
    assert L(False, 'success', '', 'valuable', 0, w(), w()) == 'good'
    assert L(False, 'success', '', 'neutral', 3, w(), w()) == 'good'
    assert L(False, 'success', '', None, 0, w(m=1), w(m=1)) == 'good'
    assert L(False, 'success', '', 'valuable', 0, w(), w(d=1)) == 'neutral'
    assert L(False, 'success', '', 'valuable', 0, w(), w(o=False)) == 'neutral'
    assert L(False, 'success', '', 'neutral', 0, w(), w()) == 'neutral'
    assert L(False, 'unknown', '', None, 0, w(), w()) == 'neutral'


def t_near_key_strips_positions_and_clock_only():
    a = 'STATE: position 337,31,167, day, day 4188\nNEARBY: iron_ore@14m\nINVENTORY: cobblestone x264\n - water seen at x=336 y=55 z=170 (3 blocks away\nsaw_end: END-AB12'
    b = 'STATE: position 12,70,-9, day, day 5000\nNEARBY: iron_ore@3m\nINVENTORY: cobblestone x264\n - water seen at x=1 y=2 z=3 (40 blocks away\nsaw_end: END-ZZ99'
    c = a.replace('cobblestone x264', 'cobblestone x12')
    assert X.near_key('h', a) == X.near_key('h', b)
    assert X.near_key('h', a) != X.near_key('h', c), 'inventory counts are state, not noise'
    assert X.near_key('h', a) != X.near_key('g', a)


def t_rawhold_fills_a_rotated_out_generation_once():
    root, roster, logs = fixture()
    hold = os.path.join(root, 'hold', 'w-a-Alpha'); os.makedirs(hold)
    src = os.path.join(logs, 'w-a-Alpha', 'llm-w-a-Alpha.jsonl-20261021.gz')
    import shutil
    shutil.copy2(src, hold)                       # held copy AND live copy: read once
    s1 = X.extract_day(DAY, logs, roster, None, rawhold=os.path.join(root, 'hold'), write=False)
    os.remove(src)                                # rotated out of the live root: read from the hold
    s2 = X.extract_day(DAY, logs, roster, None, rawhold=os.path.join(root, 'hold'), write=False)
    s3 = X.extract_day(DAY, logs, roster, None, write=False)
    assert s1['positive_control']['llm_rows'] == s2['positive_control']['llm_rows'] == 8, (s1['positive_control'], s2['positive_control'])
    assert s3['positive_control']['llm_rows'] == 0 and s3['positive_control']['roster_bots_without_rows'] == 1


def _summ():
    root, roster, logs = fixture()
    return X.extract_day(DAY, logs, roster, os.path.join(root, 'out'))


def t_row_controls_pass_on_a_clean_day_and_fail_on_each_broken_identity():
    s = _summ()
    rc = N.row_controls(s)
    assert rc['ok'], rc
    for mut, name in ((lambda s: s['rows_extra'].__setitem__('llm_rows_raw', 12), 'raw lines == parsed rows'),
                      (lambda s: s['rows_extra'].__setitem__('triples_written', 6), 'triples written == model rows'),
                      (lambda s: s['labels'].__setitem__('good', 9), 'labels sum == model rows'),
                      (lambda s: s['positive_control'].__setitem__('roster', 80), 'bots with rows == roster'),
                      (lambda s: s['join'].__setitem__('exact', 1), 'joined + missed == admitted')):
        t = json.loads(json.dumps(s)); mut(t)
        r = N.row_controls(t)
        assert not r['ok'] and [c[0] for c in r['checks'] if not c[1]] == [name], (name, r)


def t_join_control_counts_executed_decisions_only():
    s = _summ()
    j = N.join_control(s)
    assert j['ok'] and j['executed'] == 5 and j['runner_refused'] == 1 and j['unexplained_misses'] == 0, j
    t = json.loads(json.dumps(s))
    t['join_miss_why']['OTHER: lost'] = 1; t['join']['none'] += 1; t['join']['exact'] -= 1
    j = N.join_control(t)
    assert not j['ok'] and j['unexplained_misses'] == 1 and j['allowance'] == 0, j
    j = N.join_control(t, tolerance=0.5)
    assert j['ok'], 'inside an explicit allowance'


def t_es_compare_tolerances_and_unreadable():
    f = {'llm': 1000, 'skill': 5000, '_death': 3, '_stagnation': 10, '_milestone_complete': 7}
    assert N.es_compare(f, dict(f))['ok']
    assert N.es_compare(f, dict(f, llm=1000 - 15, skill=5000 + 120, _death=5))['ok']
    assert not N.es_compare(f, dict(f, llm=1000 - 16))['ok']
    assert not N.es_compare(f, dict(f, _death=0))['ok']
    r = N.es_compare(f, {'error': 'ConnectionRefused'})
    assert not r['ok'] and 'ES unreadable' in r['text']
    assert not N.es_compare(f, None)['ok']


def t_days_to_do_waits_for_the_lookahead():
    now = dt.datetime(2026, 10, 22, 1, 14, tzinfo=dt.timezone.utc)
    assert N.days_to_do('2026-10-19', now, {}) == ['2026-10-19', '2026-10-20']
    now = dt.datetime(2026, 10, 22, 1, 15, tzinfo=dt.timezone.utc)
    assert N.days_to_do('2026-10-19', now, {'2026-10-20': {}}) == ['2026-10-19', '2026-10-21']


def t_generation_and_at_risk():
    assert N.generation_for('2026-10-08') == '20261009'
    today = dt.date(2026, 10, 22)
    r = N.at_risk({'20261009', '20261015', '20261022'}, {}, today)
    assert [x['day'] for x in r] == ['2026-10-08'] and r[0]['expires'] == '2026-10-23', r
    assert N.at_risk({'20261009'}, {'2026-10-08': {}}, today) == []


def t_heartbeat_status_order():
    H = N.heartbeat_status
    ok = {'controls_ok': True}
    assert H([], None, [], ok, [], []) == 'ok'
    assert H([], 'boom', [], ok, [], []) == 'error'
    assert H([{'archived': False}], None, [], ok, [], []) == 'archive_failed'
    assert H([], None, [], ok, [{'day': 'x'}], []) == 'at_risk'
    assert H([], None, ['2026-10-21'], ok, [], []) == 'behind'
    assert H([], None, [], ok, [], [{'day': '2026-10-09', 'why': 'x'}]) == 'control_failed'
    assert H([], None, [], None, [], []) == 'empty'


def t_unresolved_keeps_older_failures_until_acknowledged():
    """Codex r1 P2-7: an older failed day must not disappear behind a healthy newer one."""
    arch = {'2026-10-09': {'controls_ok': False, 'controls_failed': ['es'], 'raw_members': {'a': 'x'}, 'raw_left_out': []},
            '2026-10-10': {'controls_ok': True, 'raw_members': {'a': 'x'}, 'raw_left_out': []},
            '2026-10-11': {'controls_ok': True, 'raw_members': None},
            '2026-10-12': {'controls_ok': True, 'raw_members': {'a': 'x'}, 'raw_left_out': ['b/llm-b.jsonl-20261013.gz']}}
    u = N.unresolved(arch, {})
    assert [x['day'] for x in u] == ['2026-10-09', '2026-10-11', '2026-10-12'], u
    assert 'not proven' in u[1]['why'] and '--repair-raw 2026-10-12' in u[2]['why']
    assert [x['day'] for x in N.unresolved(arch, {'2026-10-09': {'why': 'ok'}})] == ['2026-10-11', '2026-10-12']


def t_raw_tar_lists_missing_and_corrupt_generations():
    root, roster, logs = fixture()
    hold = os.path.join(root, 'hold')
    os.makedirs(os.path.join(logs, 'w-a-Bravo'))
    with open(os.path.join(logs, 'w-a-Bravo', 'llm-w-a-Bravo.jsonl-20261021.gz'), 'wb') as fh:
        fh.write(b'\x1f\x8bnot gzip')
    os.makedirs(os.path.join(logs, 'w-a-Idle'))          # a log dir with no rows that day: not expected, not a failure
    dst = os.path.join(root, 'raw.tar')
    members, missing, bad = N.raw_tar(DAY, logs, hold, dst, ['w-a-Alpha', 'w-a-Bravo'])
    assert sorted(members) == ['w-a-Alpha/llm-w-a-Alpha.jsonl-20261021.gz', 'w-a-Alpha/skill-w-a-Alpha.jsonl-20261021.gz']
    assert missing == ['w-a-Bravo/skill-w-a-Bravo.jsonl-20261021.gz'] and len(bad) == 1, (members, missing, bad)
    with tarfile.open(dst) as tf:
        assert sorted(tf.getnames()) == sorted(members)
        assert all(m.uid == 0 and m.uname == '' for m in tf.getmembers()), 'owner-independent headers'
    m2, _, _ = N.raw_tar(DAY, logs, hold, dst + '2', ['w-a-Alpha', 'w-a-Bravo'])
    import hashlib
    h = lambda p: hashlib.sha256(open(p, 'rb').read()).hexdigest()
    assert h(dst) == h(dst + '2'), 'the same files tar to the same bytes' 


FAKE_SSH = r'''#!/usr/bin/env bash
# fake ssh for nas-relay.sh: "ssh -i KEY -o ... TARGET CMD" runs CMD locally with /volume1 mapped under $FAKE_NAS
while [ $# -gt 1 ]; do case "$1" in -i|-o) shift 2;; *) shift; break;; esac; done
cmd="$*"; cmd=${cmd//\/volume1/$FAKE_NAS/volume1}
# like a real ssh client, swallow ALL of stdin and hand it to the remote command (which may ignore it)
buf=$(mktemp); cat > "$buf"
bash -c "$cmd" < "$buf"; rc=$?; rm -f "$buf"; exit $rc
'''


def _gnu():
    """nas-relay.sh runs on Linux (.30) and its fake NAS runs locally: flock, sha256sum and GNU stat are needed."""
    import shutil
    ok = shutil.which('flock') and shutil.which('sha256sum') and subprocess.run(['stat', '-c', '%s', '/'], capture_output=True).returncode == 0
    if not ok:
        raise Skip('needs flock, sha256sum and GNU stat (run on Linux: the relay host is .30)')


class Skip(Exception):
    pass


def _relay_env():
    _gnu()
    root = tempfile.mkdtemp()
    fake = os.path.join(root, 'fakessh'); open(fake, 'w').write(FAKE_SSH); os.chmod(fake, 0o755)
    env = dict(os.environ, FAKE_NAS=os.path.join(root, 'nas'), LL_SSH=fake, LL_TMP=os.path.join(root, 'tmp'),
               LL_LOG=os.path.join(root, 'relay.log'), LL_NAS_KEY='/dev/null',
               LL_LOCKFILE=os.path.join(root, 'relay.lock'))
    os.makedirs(os.path.join(root, 'nas', 'volume1', 'homes', 'mike'))
    return root, env


def _relay(env, cmd, data=b''):
    r = subprocess.run(['bash', os.path.join(HERE, 'nas-relay.sh')], input=data, capture_output=True,
                       env=dict(env, SSH_ORIGINAL_COMMAND=cmd), timeout=60)
    return r.returncode, r.stdout.decode().strip()


def t_relay_put_is_verified_immutable_and_sealed():
    import hashlib, io
    root, env = _relay_env()
    data = b'hello triples\n' * 100
    sha = hashlib.sha256(data).hexdigest()
    rc, out = _relay(env, 'put 2026-10-20 triples-20261020.jsonl.gz %s' % sha, data)
    assert rc == 0 and out == 'OK %s %d' % (sha, len(data)), (rc, out)
    stored = os.path.join(root, 'nas/volume1/homes/mike/learnloop/daily/2026-10-20/triples-20261020.jsonl.gz')
    assert open(stored, 'rb').read() == data
    rc, out = _relay(env, 'put 2026-10-20 triples-20261020.jsonl.gz %s' % sha, data)
    assert rc == 0 and out.endswith('(already)'), out
    other = hashlib.sha256(b'x').hexdigest()
    rc, out = _relay(env, 'put 2026-10-20 triples-20261020.jsonl.gz %s' % other, b'x')
    assert rc == 0 and open(stored, 'rb').read() == b'x', 'an UNSEALED day is staging: a re-run may replace a file'
    rc, out = _relay(env, 'put 2026-10-20 triples-20261020.jsonl.gz %s' % sha, data)
    assert rc == 0 and open(stored, 'rb').read() == data, out
    rc, out = _relay(env, 'put 2026-10-20 bad.bin %s' % other, b'not x')
    assert rc == 1 and out.startswith('FAIL') and 'declared' in out, out
    assert not os.path.exists(os.path.dirname(stored) + '/bad.bin')
    rc, out = _relay(env, 'seal 2026-10-20')
    assert rc == 1 and 'no MANIFEST.json' in out, out
    man = json.dumps({'files': {'triples-20261020.jsonl.gz': {'sha256': sha, 'bytes': len(data)},
                                'missing.tar': {'sha256': other, 'bytes': 1}}}).encode()
    rc, out = _relay(env, 'put 2026-10-20 MANIFEST.json %s' % hashlib.sha256(man).hexdigest(), man)
    assert rc == 0, out
    rc, out = _relay(env, 'seal 2026-10-20')
    assert rc == 1 and 'missing' in out and not os.path.exists(os.path.dirname(stored) + '/_OK'), out
    man2 = json.dumps({'files': {'triples-20261020.jsonl.gz': {'sha256': sha, 'bytes': len(data)}}}).encode()
    _relay(env, 'put 2026-10-21 triples-20261020.jsonl.gz %s' % sha, data)
    _relay(env, 'put 2026-10-21 MANIFEST.json %s' % hashlib.sha256(man2).hexdigest(), man2)
    rc, out = _relay(env, 'seal 2026-10-21')
    assert rc == 0 and out == 'OK sealed 2026-10-21 1 files', out
    rc, out = _relay(env, 'put 2026-10-21 triples-20261020.jsonl.gz %s' % other, b'x')
    assert rc == 4 and 'sealed day is immutable' in out, out
    rc, out = _relay(env, 'put 2026-10-21 extra.bin %s' % other, b'x')
    assert rc == 4 and 'only a new repair-* file' in out, out
    rc, out = _relay(env, 'put 2026-10-21 repair-raw-20261021-1.tar %s' % other, b'x')
    assert rc == 0, 'a sealed day accepts a NEW repair-* file: %s' % out
    rc, out = _relay(env, 'verify 2026-10-21')
    assert rc == 0 and out == 'OK verified 2026-10-21 1 files', out
    rc, out = _relay(env, 'verify 2026-10-20')
    assert rc == 1 and ('missing' in out or 'NOT sealed' in out), 'an unsealed day never verifies: %s' % out
    rc, out = _relay(env, 'manifest 2026-10-21')
    assert rc == 0 and json.loads(out) == json.loads(man2), out
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w') as tf:
        for n, body in (('b1/llm-b1.jsonl-20261022.gz', b'one'), ('b1/skill-b1.jsonl-20261022.gz', b'two')):
            ti = tarfile.TarInfo(n); ti.size = len(body); tf.addfile(ti, io.BytesIO(body))
    tb = buf.getvalue()
    rc, out = _relay(env, 'put 2026-10-21 repair-raw-20261021-abc.tar %s' % hashlib.sha256(tb).hexdigest(), tb)
    assert rc == 0, out
    rc, out = _relay(env, 'members 2026-10-21 repair-raw-20261021-abc.tar')
    assert rc == 0 and out.splitlines() == ['%s  b1/llm-b1.jsonl-20261022.gz' % hashlib.sha256(b'one').hexdigest(),
                                            '%s  b1/skill-b1.jsonl-20261022.gz' % hashlib.sha256(b'two').hexdigest()], out
    rc, out = _relay(env, 'members 2026-10-21 MANIFEST.json')
    assert rc == 2 and out.startswith('REFUSED'), out
    assert open(stored.replace('2026-10-20/', '2026-10-21/'), 'rb').read() == data
    rc, out = _relay(env, 'status')
    lines = out.splitlines()
    assert lines[0].startswith('LASTGOOD ') and lines[0].endswith(' 2026-10-21'), lines
    assert lines[1] == 'SEALED 1 2026-10-21' and lines[2] == 'UNSEALED 2026-10-20', lines
    st = N.Relay(); st.call = lambda *a, **k: (rc, out)
    parsed = st.status()
    assert parsed['sealed'] == 1 and parsed['newest'] == '2026-10-21' and parsed['unsealed'] == ['2026-10-20'], parsed


def t_relay_refuses_everything_else():
    root, env = _relay_env()
    for cmd in ('rm -rf /', 'put 2026-10-20 ../x ' + '0' * 64, 'put 2026-10-20 .hidden ' + '0' * 64,
                'put 26-10-20 a ' + '0' * 64, 'put 2026-10-20 a short', 'bash', 'status; id', 'seal ../x', '',
                'list 2026-10-20 extra', 'put 2026-10-20 a..b ' + '0' * 64):
        rc, out = _relay(env, cmd)
        assert rc == 2 and out.startswith('REFUSED'), (cmd, rc, out)


def t_relay_status_on_an_empty_archive():
    root, env = _relay_env()
    rc, out = _relay(env, 'status')
    assert rc == 0 and out.splitlines() == ['LASTGOOD NONE', 'SEALED 0 NONE', 'UNSEALED'], out


class FakeRelay:
    """The relay's contract in memory: put (unsealed replaceable, sealed immutable except new repair-*), seal (every
    MANIFEST file present with its hash), verify, manifest, status. fail_* inject the failures nightly must survive."""
    def __init__(self):
        self.nas, self.sealed, self.calls, self.dry = {}, set(), [], False
        self.fail_put = None; self.lose_seal_ack = False

    def put(self, day, path):
        import hashlib
        name = os.path.basename(path); data = open(path, 'rb').read(); sha = hashlib.sha256(data).hexdigest()
        self.calls.append(('put', day, name))
        if self.fail_put == name:
            return False, sha, 'FAIL injected'
        d = self.nas.setdefault(day, {})
        if day in self.sealed and (name in d and d[name] != data or name not in d and not name.startswith('repair-')):
            return False, sha, 'REFUSED: sealed'
        d[name] = data
        return True, sha, 'OK %s %d' % (sha, len(data))

    def _check(self, day):
        import hashlib
        d = self.nas.get(day) or {}
        if 'MANIFEST.json' not in d:
            return False
        m = json.loads(d['MANIFEST.json'])
        return all(n in d and hashlib.sha256(d[n]).hexdigest() == f['sha256'] for n, f in m['files'].items())

    def seal(self, day):
        self.calls.append(('seal', day))
        if not self._check(day):
            return False, 'FAIL'
        self.sealed.add(day)
        return (False, 'FAIL ssh dropped') if self.lose_seal_ack else (True, 'OK sealed %s 5 files' % day)

    def verify(self, day):
        self.calls.append(('verify', day))
        ok = day in self.sealed and self._check(day)
        return ok, ('OK verified %s' % day) if ok else 'FAIL'

    def manifest(self, day):
        d = self.nas.get(day) or {}
        return json.loads(d['MANIFEST.json']) if 'MANIFEST.json' in d else None

    def members(self, day, name):
        import hashlib, io
        data = (self.nas.get(day) or {}).get(name)
        if data is None:
            return None
        with tarfile.open(fileobj=io.BytesIO(data)) as tf:
            return {m.name: hashlib.sha256(tf.extractfile(m).read()).hexdigest() for m in tf.getmembers() if m.isfile()}

    def status(self):
        return {'sealed': len(self.sealed), 'newest': max(self.sealed) if self.sealed else 'NONE'}

    def list(self, day):
        return sorted((self.nas.get(day) or {}))


def _nightly_env():
    root, roster, logs = fixture()
    home = os.path.join(root, 'home')
    os.makedirs(home)
    return root, roster, logs, home


def _run(home, logs, roster, relay, *extra):
    N_relay = N.Relay
    N.Relay = lambda *a, **k: relay
    try:
        return N.main(['--tick', '--home', home, '--logroot', logs, '--roster', roster, '--start', DAY, '--max-days', '1',
                       '--no-es', '--repo', '/nonexistent'] + list(extra))
    finally:
        N.Relay = N_relay


def t_process_day_end_to_end_with_the_relay_contract():
    """MANIFEST is sent last, state is written only after the seal, the tar is removed, the heartbeat names the day."""
    root, roster, logs, home = _nightly_env()
    rl = FakeRelay()
    _run(home, logs, roster, rl)
    puts = [c[2] for c in rl.calls if c[0] == 'put']
    assert puts[-1] == 'MANIFEST.json' and set(puts) == {'triples-20261020.jsonl.gz', 'summary.json', 'controls.json',
                                                         'sysprompts-20261020.json', 'raw-20261020.tar', 'MANIFEST.json'}, puts
    assert rl.calls[-1][0] == 'seal' or ('seal', DAY) in rl.calls
    st = json.load(open(os.path.join(home, 'state.json')))
    rec = st['archived'][DAY]
    assert rec['triples'] == 7 and sorted(rec['raw_members']) == ['w-a-Alpha/llm-w-a-Alpha.jsonl-20261021.gz',
                                                                  'w-a-Alpha/skill-w-a-Alpha.jsonl-20261021.gz'], rec
    assert not os.path.exists(os.path.join(home, 'days', DAY, 'raw-20261020.tar'))
    man = json.loads(rl.nas[DAY]['MANIFEST.json'])
    assert 'made_at' not in man and man['raw_members'] == rec['raw_members']
    hb = json.load(open(os.path.join(home, 'heartbeat.json')))
    assert hb['newest_archived_day'] == DAY and 'raw_members' not in (hb['newest'] or {}), hb
    # the sysprompt control FAILED (no repo here): it must show, and stay unresolved until acknowledged
    assert hb['unresolved'][0]['day'] == DAY and 'controls failed' in hb['unresolved'][0]['why'], hb['unresolved']
    # the pending list grows with the wall clock (every due day since): only its head is fixed by this fixture
    assert hb['status'] == 'behind' and hb['pending'][:1] == ['2026-10-21'], (hb['status'], hb['pending'])


def t_a_failed_put_leaves_the_day_unarchived_and_a_rerun_completes_it():
    root, roster, logs, home = _nightly_env()
    rl = FakeRelay(); rl.fail_put = 'raw-20261020.tar'
    _run(home, logs, roster, rl)
    st = json.load(open(os.path.join(home, 'state.json'))) if os.path.exists(os.path.join(home, 'state.json')) else {'archived': {}}
    assert DAY not in st['archived'] and DAY not in rl.sealed
    hb = json.load(open(os.path.join(home, 'heartbeat.json')))
    assert hb['status'] == 'archive_failed', hb['status']
    rl.fail_put = None
    _run(home, logs, roster, rl)
    assert DAY in json.load(open(os.path.join(home, 'state.json')))['archived'] and DAY in rl.sealed


def t_a_lost_seal_acknowledgement_is_recovered_by_verify_not_resent():
    """Both engines r1: seal succeeded remotely but the answer was lost; the day must be recorded, never stuck."""
    root, roster, logs, home = _nightly_env()
    rl = FakeRelay(); rl.lose_seal_ack = True
    _run(home, logs, roster, rl)
    assert DAY in json.load(open(os.path.join(home, 'state.json')))['archived'], 'verify after the failed seal'
    os.remove(os.path.join(home, 'state.json'))                 # a lost state.json: the NAS is the record
    rl.lose_seal_ack = False; n_puts = sum(1 for c in rl.calls if c[0] == 'put')
    _run(home, logs, roster, rl)
    rec = json.load(open(os.path.join(home, 'state.json')))['archived'][DAY]
    assert rec.get('from_nas') and sum(1 for c in rl.calls if c[0] == 'put') == n_puts, 'recorded from the NAS, nothing re-sent'
    assert rec['raw_members'], 'the NAS MANIFEST carries the members, so pruning stays possible'


def t_prune_deletes_only_files_proven_on_the_nas():
    """Both engines r1 P1: pruning by DAY deleted files a failed raw control had left out."""
    root, roster, logs, home = _nightly_env()
    hold = os.path.join(home, 'rawhold'); import shutil
    for f in ('llm-w-a-Alpha.jsonl-20261021.gz', 'skill-w-a-Alpha.jsonl-20261021.gz'):
        os.makedirs(os.path.join(hold, 'w-a-Alpha'), exist_ok=True)
        shutil.copy2(os.path.join(logs, 'w-a-Alpha', f), os.path.join(hold, 'w-a-Alpha', f))
    os.makedirs(os.path.join(hold, 'w-a-Bravo'))
    open(os.path.join(hold, 'w-a-Bravo', 'llm-w-a-Bravo.jsonl-20261021.gz'), 'wb').write(b'left out')
    llm_sha = N.sha256_file(os.path.join(hold, 'w-a-Alpha', 'llm-w-a-Alpha.jsonl-20261021.gz'))
    arch = {DAY: {'raw_members': {'w-a-Alpha/llm-w-a-Alpha.jsonl-20261021.gz': llm_sha,
                                  'w-a-Alpha/skill-w-a-Alpha.jsonl-20261021.gz': '0' * 64}}}
    n, kept = N.prune_rawhold(hold, logs, arch, lambda m: None)
    assert n == 0 and kept == 1, ('live copies still exist: nothing of Alpha is pruned; Bravo has no record', n, kept)
    for f in ('llm-w-a-Alpha.jsonl-20261021.gz', 'skill-w-a-Alpha.jsonl-20261021.gz'):
        os.remove(os.path.join(logs, 'w-a-Alpha', f))           # logrotate deleted the live generation
    n, kept = N.prune_rawhold(hold, logs, arch, lambda m: None)
    assert n == 1 and kept == 2, (n, kept)                       # the sha-matching member only
    assert not os.path.exists(os.path.join(hold, 'w-a-Alpha', 'llm-w-a-Alpha.jsonl-20261021.gz'))
    assert os.path.exists(os.path.join(hold, 'w-a-Alpha', 'skill-w-a-Alpha.jsonl-20261021.gz')), 'hash differs: kept'
    assert os.path.exists(os.path.join(hold, 'w-a-Bravo', 'llm-w-a-Bravo.jsonl-20261021.gz')), 'never archived: kept'
    n, kept = N.prune_rawhold(hold, logs, {}, lambda m: None)
    assert n == 0, 'a day with no record prunes nothing'


def t_repair_raw_sends_left_out_files_to_a_sealed_day():
    root, roster, logs, home = _nightly_env()
    rl = FakeRelay(); rl.sealed.add(DAY); rl.nas[DAY] = {'MANIFEST.json': b'{"files": {}}'}
    hold = os.path.join(home, 'rawhold'); os.makedirs(os.path.join(hold, 'w-a-Bravo'))
    import shutil
    shutil.copy2(os.path.join(logs, 'w-a-Alpha', 'llm-w-a-Alpha.jsonl-20261021.gz'),
                 os.path.join(hold, 'w-a-Bravo', 'llm-w-a-Bravo.jsonl-20261021.gz'))
    st = {'archived': {DAY: {'controls_ok': False, 'controls_failed': ['raw'], 'raw_members': {},
                             'raw_left_out': ['w-a-Bravo/llm-w-a-Bravo.jsonl-20261021.gz']}}, 'acknowledged': {}}
    json.dump(st, open(os.path.join(home, 'state.json'), 'w'))
    _run(home, logs, roster, rl, '--repair-raw', DAY)
    rec = json.load(open(os.path.join(home, 'state.json')))['archived'][DAY]
    assert rec['raw_left_out'] == [] and 'w-a-Bravo/llm-w-a-Bravo.jsonl-20261021.gz' in rec['raw_members'], rec
    assert any(n.startswith('repair-raw-20261020-') and n.endswith('.tar') for n in rl.nas[DAY]), rl.nas[DAY].keys()


def t_dry_run_never_records_an_archive():
    """Both engines r2 P1: --repair-raw under --dry-run recorded files as on the NAS; the next prune deleted them."""
    root, roster, logs, home = _nightly_env()
    st = {'archived': {DAY: {'controls_ok': True, 'raw_members': {}, 'raw_left_out': ['w-a-Alpha/llm-w-a-Alpha.jsonl-20261021.gz']}},
          'acknowledged': {}}
    json.dump(st, open(os.path.join(home, 'state.json'), 'w'))
    for extra in (['--repair-raw', DAY], ['--adopt-raw'], ['--ack', DAY, 'x']):
        rc = N.main(['--tick', '--home', home, '--logroot', logs, '--roster', roster, '--dry-run', '--no-es'] + extra)
        assert rc == 2, (extra, rc)
    assert json.load(open(os.path.join(home, 'state.json'))) == st, 'nothing recorded'
    ok, sha, out = N.Relay(dry=True).put(DAY, os.path.join(logs, 'w-a-Alpha', 'llm-w-a-Alpha.jsonl'))
    assert ok is False and 'DRY' in out, 'a dry put is never an upload'
    assert N.Relay(dry=True).seal(DAY)[0] is False


def t_adopt_raw_proves_members_from_the_nas_bytes():
    """Claude r2 P2: members are hashed from the sealed tar on the NAS -- no dependence on headers or live copies."""
    root, roster, logs, home = _nightly_env()
    rl = FakeRelay()
    _run(home, logs, roster, rl)                                  # seals DAY with the current code
    st = json.load(open(os.path.join(home, 'state.json')))
    proven = st['archived'][DAY]['raw_members']
    st['archived'][DAY]['raw_members'] = None                    # as the first backfill recorded it
    json.dump(st, open(os.path.join(home, 'state.json'), 'w'))
    for f in os.listdir(os.path.join(logs, 'w-a-Alpha')):         # the live copies have rotated away
        if f.endswith('-20261021.gz'):
            os.remove(os.path.join(logs, 'w-a-Alpha', f))
    _run(home, logs, roster, rl, '--adopt-raw')
    rec = json.load(open(os.path.join(home, 'state.json')))['archived'][DAY]
    assert rec['raw_members'] == proven and rec['raw_left_out'] == [], rec



TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]

if __name__ == '__main__':
    for n, f in TESTS:
        check(n[2:], f)
    print('%d passed, %d failed, %d skipped' % (PASS, FAIL, SKIP))
    sys.exit(1 if FAIL else 0)
