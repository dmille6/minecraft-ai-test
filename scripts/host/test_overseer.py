"""overseer-01show: the host wrapper's two decisions -- live or dry, and the roster/rows it hands the cycle. Run: python3 test_overseer.py"""
import datetime as dt
import json
import time
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import overseer as OV  # noqa: E402

NOW = dt.datetime(2026, 11, 17, 12, 0, tzinfo=dt.timezone.utc)


def row(name, mins, kind='_shop', detail='', pos=(1, 70, 2)):
    return {'t': NOW - dt.timedelta(minutes=mins), 'name': kind, 'detail': detail,
            'bot': {'name': name, 'pos': {'x': pos[0], 'y': pos[1], 'z': pos[2]}}}


def test_switch():
    d = tempfile.mkdtemp()
    f = os.path.join(d, 'LIVE')
    assert OV.switch_live(f) is False, 'no file: dry'
    open(f, 'w').write('')
    assert OV.switch_live(f) is True
    open(f, 'w').write('off\n')
    assert OV.switch_live(f) is False


def test_roster_and_rows():
    rows = [row('Ann', 30, pos=(5, 70, 5)), row('Ann', 2, pos=(9, 71, 9)), row('Bo', 60),
            row('Ann', 3, kind='_worklist', detail='op=ids list=1 ids=d:r:1,2,3')]
    bots, wl = OV.inputs_from_rows(rows, NOW, online_min=10)
    assert [b['name'] for b in bots] == ['Ann', 'Bo']
    assert bots[0]['online'] is True and bots[0]['pos'] == [9, 71, 9], bots[0]
    assert bots[1]['online'] is False
    assert len(wl) == 1 and wl[0]['bot'] == 'Ann' and wl[0]['detail'].startswith('op=ids')
    assert wl[0]['t'] == int((NOW - dt.timedelta(minutes=3)).timestamp() * 1000)


H = 3600 * 1000
NOWMS = 1_800_000_000_000


def _mklogs():
    """A log tree: Ann (plain), Bo (a good rotated .gz)."""
    import gzip
    root = tempfile.mkdtemp()
    for d in ('Ann', 'Bo'):
        os.makedirs(os.path.join(root, d))
    open(os.path.join(root, 'Ann', 'skill-Ann.jsonl'), 'w').write('{}\n')
    with gzip.open(os.path.join(root, 'Bo', 'skill-Bo.jsonl-20261116.gz'), 'wb') as fh:
        fh.write(b'{"a": 1}\n' * 5000)
    return root


def _files(root):
    import glob
    return glob.glob(os.path.join(root, '*', 'skill-*.jsonl*'))


def test_gzip_truncated(R=None):
    """r2: a truncated .gz fails the cycle closed (a 1-character read would not); a good one is read once, then cached."""
    R = R or OV
    root = _mklogs()
    p, seen, ret, cache = R.read_problems(_files(root), {}, NOWMS)
    assert p == [] and set(seen) == {'Ann', 'Bo'} and len(cache) == 1, (p, cache)
    calls = []
    p2, _, _, _ = R.read_problems(_files(root), {}, NOWMS, cache, check_gz=lambda f: calls.append(f))
    assert p2 == [] and calls == [], 'a checked rotated file is not read again'
    gz = os.path.join(root, 'Bo', 'skill-Bo.jsonl-20261116.gz')
    data = open(gz, 'rb').read()
    open(gz, 'wb').write(data[:len(data) // 2])
    os.utime(gz, (1, 1))
    p3, _, _, _ = R.read_problems(_files(root), {}, NOWMS, cache)
    assert len(p3) == 1 and 'unreadable' in p3[0] and 'Bo' in p3[0], p3
    os.chmod(os.path.join(root, 'Ann', 'skill-Ann.jsonl'), 0)
    if os.geteuid() != 0:
        p4, _, _, _ = R.read_problems([os.path.join(root, 'Ann', 'skill-Ann.jsonl')], {}, NOWMS)
        assert len(p4) == 1, 'an unreadable plain file fails closed'


def test_retire_grace(R=None):
    """r2: a directory gone < 60 min stops the cycle; gone longer it is retired once, and the next cycle runs."""
    R = R or OV
    root = _mklogs()
    prev = {'Ann': NOWMS - 10 * 60000, 'Bo': NOWMS - 10 * 60000, 'Cy': NOWMS - 30 * 60000}
    p, seen, ret, _ = R.read_problems(_files(root), prev, NOWMS)
    assert len(p) == 1 and 'Cy' in p[0] and ret == [] and seen['Cy'] == prev['Cy'], (p, ret)
    p, seen, ret, _ = R.read_problems(_files(root), seen, NOWMS + 31 * 60000)
    assert p == [] and ret == ['Cy'] and 'Cy' not in seen, (p, ret, seen)
    p, seen2, ret, _ = R.read_problems(_files(root), seen, NOWMS + 46 * 60000)
    assert p == [] and ret == [], 'cycles resume after the retirement'
    p, _, _, _ = R.read_problems(_files(root), ['Ann', 'Gone'], NOWMS)
    assert len(p) == 1 and 'Gone' in p[0], 'a pre-r2 list reads as seen now'


def test_observe_persists_on_blocked_cycles(R=None):
    """r3: the observation is kept on a blocked cycle -- a legacy ["Gone"] entry retires 60 min after it was first seen (not
    reset every cycle), and a healthy directory's time advances while cycles are blocked."""
    import json as _j
    R = R or OV
    root, state = _mklogs(), tempfile.mkdtemp()
    _j.dump(['Ann', 'Gone'], open(os.path.join(state, 'logdirs.json'), 'w'))
    for mins in (0, 30, 59):
        p, ret = R.observe(state, _files(root), NOWMS + mins * 60000)
        assert len(p) == 1 and 'Gone' in p[0] and ret == [], (mins, p)
        seen = _j.load(open(os.path.join(state, 'logdirs.json')))
        assert isinstance(seen, dict), 'the blocked cycle wrote its observation'
        assert seen['Gone'] == NOWMS, 'first seen once, never reset'
        assert seen['Ann'] == NOWMS + mins * 60000, 'a healthy directory advances during blocked cycles'
    p, ret = R.observe(state, _files(root), NOWMS + 61 * 60000)
    assert p == [] and ret == ['Gone'], (p, ret)
    p, ret = R.observe(state, _files(root), NOWMS + 76 * 60000)
    assert p == [] and ret == [], 'cycles run after it'


def _line(bot, mins, kind='_shop', detail='x', x=1):
    import json as _j
    t = (NOW + dt.timedelta(minutes=mins)).isoformat().replace('+00:00', 'Z')
    return _j.dumps({'@timestamp': t, 'bot': {'name': bot, 'pos': {'x': x, 'y': 70, 'z': 2}}, 'skill': {'name': kind, 'detail': detail}}) + '\n'


def test_tail_incremental(R=None):
    """r5: only new bytes are read; a half-written line waits; a rotation (rename + new file) loses nothing; rows roll out of the
    window; an unreadable file raises."""
    R = R or OV
    now_ms = int(NOW.timestamp() * 1000)
    root = tempfile.mkdtemp()
    d = os.path.join(root, 'showcase-Ann')
    os.makedirs(d)
    live = os.path.join(d, 'skill-Ann.jsonl')
    open(live, 'w').write(_line('Ann', 0) + _line('Ann', 1, '_worklist', 'op=ids list=1 ids=d:r:1,2,3') + _line('Ann', 2, x=7))
    st, n1 = R.tail_read([live], {}, now_ms)
    assert len(st['wl']) == 1 and st['bots']['Ann']['pos'] == [7, 70, 2] and n1 == os.path.getsize(live)
    st2, n2 = R.tail_read([live], st, now_ms)
    assert n2 == 0 and len(st2['wl']) == 1, 'nothing new: nothing read, nothing counted twice'
    partial = _line('Ann', 3, '_worklist', 'op=ids list=2 ids=g:r:4,4,4')
    open(live, 'a').write(partial[:20])
    st3, n3 = R.tail_read([live], st2, now_ms)
    assert n3 == 0 and len(st3['wl']) == 1, 'a half line waits'
    open(live, 'a').write(partial[20:])
    # rotation: the live file is renamed (its tail still unread is finished there) and a new one starts
    os.rename(live, live + '-20261117')
    open(live, 'w').write(_line('Ann', 5, '_worklist', 'op=ids list=3 ids=d:r:5,5,5'))
    st4, _ = R.tail_read([live, live + '-20261117'], st3, now_ms)
    assert [r['detail'][-7:] for r in sorted(st4['wl'], key=lambda r: r['t'])] == ['r:1,2,3', 'r:4,4,4', 'r:5,5,5'], st4['wl']
    st5, _ = R.tail_read([live, live + '-20261117'], st4, now_ms + 200 * 60000)
    assert st5['wl'] == [] and st5['bots'] == {}, 'rolled out of the 180-min window'
    try:
        R.tail_read([os.path.join(d, 'missing.jsonl')], {}, now_ms)
        raise AssertionError('an unreadable file must raise')
    except OSError:
        pass


def test_tail_fingerprint(R=None):
    """r6 (Codex B): a file truncated and regrown past the offset, and a deleted file whose inode is reused, are read again
    from 0 -- their new reports are taken exactly once."""
    R = R or OV
    now_ms = int(NOW.timestamp() * 1000)
    root = tempfile.mkdtemp()
    d = os.path.join(root, 'showcase-Ann')
    os.makedirs(d)
    f = os.path.join(d, 'skill-Ann.jsonl')
    open(f, 'w').write(_line('Ann', 0, '_worklist', 'op=ids list=1 ids=d:r:1,1,1') + _line('Ann', 1, '_shop', 'x' * 200))
    st, _ = R.tail_read([f], {}, now_ms)
    # truncated in place (same inode) and regrown longer than the old offset
    with open(f, 'r+') as fh:
        fh.truncate(0)
    with open(f, 'a') as fh:
        fh.write(_line('Ann', 2, '_worklist', 'op=ids list=2 ids=d:r:2,2,2') + _line('Ann', 3, '_shop', 'y' * 400))
    st2, _ = R.tail_read([f], st, now_ms)
    assert sorted(r['detail'][-7:] for r in st2['wl']) == ['r:1,1,1', 'r:2,2,2'], st2['wl']
    st3, n = R.tail_read([f], st2, now_ms)
    assert n == 0 and len(st3['wl']) == 2, 'taken once'
    # a deleted file's inode handed to a new one: the saved state claims that inode with an unrelated offset
    g = os.path.join(d, 'skill-Ann.jsonl-new')
    open(g, 'w').write(_line('Ann', 4, '_worklist', 'op=ids list=3 ids=d:r:4,4,4') + _line('Ann', 5, '_shop', 'z' * 900))
    fake = dict(st3)
    fake['files'] = {'/gone/old.jsonl': {'ino': os.stat(g).st_ino, 'off': 300, 'hl': 300, 'head': 'x', 'tail': 'y'}}
    st4, _ = R.tail_read([g], fake, now_ms)
    assert sorted(r['detail'][-7:] for r in st4['wl']) == ['r:1,1,1', 'r:2,2,2', 'r:4,4,4'], st4['wl']
    st5, _ = R.tail_read([g], st4, now_ms)
    assert len(st5['wl']) == 3
    # a pre-r6 state (offsets, no fingerprint) re-reads from 0: what it already holds is not taken twice
    legacy = dict(st5)
    legacy['files'] = {k: {'ino': v['ino'], 'off': v['off']} for k, v in st5['files'].items()}
    st6, n6 = R.tail_read([g], legacy, now_ms)
    assert n6 > 0 and len(st6['wl']) == 3, st6['wl']


def test_trip_reading(R=None):
    """r6: the tripwire's read is seen by its own command words; a pgrep or shell line naming the pattern, and this process, never."""
    R = R or OV
    run = ['  812 /usr/bin/python3 -B /opt/showcase/showcase_trip.py read --hour', '  900 bash -c sleep 5']
    assert R.trip_reading(run) is True
    assert R.trip_reading(['  812 python3 showcase_trip.py read']) is True
    assert R.trip_reading(['  901 pgrep -f showcase_trip.py read']) is False, 'pgrep matching itself'
    assert R.trip_reading(['  902 /bin/sh -c pgrep -f "showcase_trip.py read" || python3 overseer.py']) is False
    assert R.trip_reading(['  903 python3 showcase_trip.py status']) is False, 'another subcommand'
    assert R.trip_reading(['  812 python3 showcase_trip.py read'], self_pids=(812,)) is False, 'never itself'


def test_mem_cap(R=None):
    """r6: over-cap peak RSS is caught (kB on Linux, bytes on macOS); a node child over its heap cap fails the cycle closed."""
    import shutil
    R = R or OV
    assert R.over_cap(301 * 1024, 300, linux=True) is True and R.over_cap(299 * 1024, 300, linux=True) is False
    assert R.over_cap(301 * 1024 * 1024, 300, linux=False) is True
    node = shutil.which('node')
    if node:
        hog = 'const a = []; for (;;) a.push(new Array(1e6).fill(1))'
        out = R.run_child([node, '--max-old-space-size=32', '-e', hog], '{}', 32, timeout=60)
        assert 'error' in out and 'exit' in out['error'], out
        ok = R.run_child([node, '-e', 'process.stdout.write(JSON.stringify({row: "op=cycle"}) + "\\n")'], '{}', 300)
        assert ok.get('row') == 'op=cycle' and ok.get('peak_mb', 0) > 0, ok
        # r7: Buffers are outside V8's heap cap -- the measured peak RSS catches them, and the cycle fails closed
        buf = 'const b = []; for (let i = 0; i < 30; i++) b.push(Buffer.alloc(10 << 20, 1)); process.stdout.write(JSON.stringify({row: "x"}) + "\\n")'
        big = R.run_child([node, '--max-old-space-size=64', '-e', buf], '{}', 150)
        assert 'error' in big and 'over the cap' in big['error'] and big['peak_mb'] > 150, big


def test_tail_streams(R=None):
    """r7: a 50 MB backlog is read in bounded chunks: peak RSS stays under 120 MB and the offset reaches the end."""
    import subprocess as sp
    R = R or OV
    root = tempfile.mkdtemp()
    d = os.path.join(root, 'showcase-Ann')
    os.makedirs(d)
    f = os.path.join(d, 'skill-Ann.jsonl')
    with open(f, 'w') as fh:
        one = _line('Ann', 1, '_shop', 'x' * 900)
        fh.write(one * (50 * 1024 * 1024 // len(one)))
        fh.write(_line('Ann', 2, '_worklist', 'op=ids list=9 ids=d:r:9,9,9'))
    code = ("import importlib.util, json, resource, sys\n"
            "spec = importlib.util.spec_from_file_location('m', sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\n"
            "st, n = m.tail_read([sys.argv[2]], {}, int(sys.argv[3]))\n"
            "print(json.dumps({'n': n, 'off': st['files'][sys.argv[2]]['off'], 'wl': len(st['wl']), 'rss': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss}))\n")
    out = sp.run([sys.executable, '-c', code, R.__file__, f, str(int(NOW.timestamp() * 1000))], capture_output=True, text=True, cwd=os.path.dirname(OV.__file__), env={**os.environ, 'PYTHONPATH': os.path.join(os.path.dirname(OV.__file__), '..')})
    r = json.loads(out.stdout.strip().splitlines()[-1])
    assert r['off'] == os.path.getsize(f) and r['wl'] == 1, r
    assert not OV.over_cap(r['rss'], 120), 'peak %s over 120 MB' % r['rss']


def _stage(root, run, content):
    st = os.path.join(root, run)
    os.makedirs(st)
    open(os.path.join(st, '0.json'), 'w').write(json.dumps(content))
    return st


def test_apply_stage(R=None):
    """r7/r8: a run's plan is applied in order from ITS OWN stage; another run's manifest or sources are refused; older stages go."""
    R = R or OV
    root, pool = tempfile.mkdtemp(), tempfile.mkdtemp()
    a = _stage(root, '0000000000001-1-aa', {'list': 'A'})
    b = _stage(root, '0000000000002-2-bb', {'list': 'B'})
    open(os.path.join(pool, 'worklist-Old.json'), 'w').write('{}')
    dest = os.path.join(pool, 'worklist-Ann.json')
    json.dump({'v': 1, 'run': '0000000000002-2-bb', 'plan': [{'op': 'write', 'dest': dest, 'src': os.path.join(b, '0.json')},
               {'op': 'unlink', 'dest': os.path.join(pool, 'worklist-Old.json')}]}, open(os.path.join(b, 'manifest.json'), 'w'))
    # an orphan of run A wrote a manifest naming B's run, with A's sources: refused
    json.dump({'v': 1, 'run': '0000000000002-2-bb', 'plan': [{'op': 'write', 'dest': dest, 'src': os.path.join(a, '0.json')}]}, open(os.path.join(a, 'manifest.json'), 'w'))
    for st, run in ((a, '0000000000002-2-bb'), (a, '0000000000001-1-aa')):
        try:
            R.apply_stage(st, run)
            raise AssertionError('cross-run publish allowed')
        except ValueError:
            pass
    c = _stage(root, '0000000000003-3-cc', {'list': 'C'})
    json.dump({'v': 1, 'run': '0000000000003-3-cc', 'plan': [{'op': 'write', 'dest': dest, 'src': os.path.join(a, '0.json')}]}, open(os.path.join(c, 'manifest.json'), 'w'))
    try:
        R.apply_stage(c, '0000000000003-3-cc')
        raise AssertionError('a source from another run published')
    except ValueError:
        pass
    import shutil as _sh
    _sh.rmtree(c)
    assert not os.path.exists(dest), 'nothing crossed'
    assert R.apply_stage(b, '0000000000002-2-bb') == 2
    assert json.load(open(dest)) == {'list': 'B'} and sorted(os.listdir(pool)) == ['worklist-Ann.json']
    assert R.prune_stages(root, '0000000000002-2-bb') == 1 and os.listdir(root) == ['0000000000002-2-bb'], 'older stages removed'


def test_child_group_killed(R=None):
    """r8: a child that ignores SIGTERM and outlives the timeout is killed with its whole group -- no process is left."""
    import shutil
    R = R or OV
    node = shutil.which('node')
    if not node:
        return
    pidf = os.path.join(tempfile.mkdtemp(), 'pid')
    js = 'require("fs").writeFileSync(%r, String(process.pid)); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)' % pidf
    out = R.run_child([node, '-e', js], '{}', 300, timeout=2)
    assert 'timeout' in out.get('error', ''), out
    pid = int(open(pidf).read())
    time.sleep(0.3)
    try:
        os.kill(pid, 0)
        alive = True
    except ProcessLookupError:
        alive = False
    if alive:
        os.kill(pid, 9)
    assert not alive, 'node outlived its cycle'


def test_signal_between_popen_and_register(R=None):
    """r9 (Codex r7): a SIGTERM arriving right after Popen, before CHILD is set, must still end with the child's group killed."""
    import shutil
    import signal
    import subprocess
    R = R or OV
    node = shutil.which('node')
    if not node:
        return
    real, pids = R.subprocess.Popen, []

    def popen(*a, **k):
        p = real(*a, **k)
        pids.append(p.pid)
        os.kill(os.getpid(), signal.SIGTERM)   # the window Codex found
        return p

    def handler(sig, frm):
        if R.CHILD is not None:
            R.kill_group(R.CHILD)
        raise SystemExit(143)
    old_h = signal.signal(signal.SIGTERM, handler)
    R.subprocess.Popen = popen
    try:
        R.run_child([node, '-e', 'setInterval(() => {}, 1000)'], '{}', 300, timeout=20)
    except SystemExit:
        pass
    finally:
        R.subprocess.Popen = real
        signal.signal(signal.SIGTERM, old_h)
    time.sleep(0.5)
    alive = []
    for pid in pids:
        try:
            os.kill(pid, 0)
            alive.append(pid)
        except ProcessLookupError:
            pass
    for pid in alive:
        try:
            os.killpg(pid, 9)
        except Exception:
            pass
    assert not alive, 'a child survived a SIGTERM between Popen and registration: %s' % alive


def _load_mutant(old, new):
    import importlib.util
    src = open(OV.__file__).read()
    assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old
    path = os.path.join(tempfile.mkdtemp(dir=tempfile.mkdtemp()), 'ovm.py')   # HERE/.. goes on sys.path: a small dir, never the system temp
    open(path, 'w').write(src.replace(old, new))
    spec = importlib.util.spec_from_file_location('ovm', path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_mutants():
    """Anchored mutants: each applies exactly once and fails its test."""
    for old, new, test in [
            ("    signal.pthread_sigmask(signal.SIG_BLOCK, held)\n", '', test_signal_between_popen_and_register),
            ("                if key not in cache:\n                    check_gz(f)", "                if False:\n                    check_gz(f)", test_gzip_truncated),
            ("            problems.append('unreadable %s: %s' % (f, type(e).__name__))", '            pass', test_gzip_truncated),
            ("        if now_ms - last < grace_ms:", '        if True:', test_retire_grace),
            ("    for ln in ps_lines:\n        parts = ln.strip().split(None, 1)\n        if len(parts) < 2 or not parts[0].isdigit() or int(parts[0]) in set(self_pids):", "    for ln in ps_lines:\n        parts = ln.strip().split(None, 1)\n        if len(parts) < 2 or not parts[0].isdigit():", test_trip_reading),
            ("            if os.path.basename(w) == 'showcase_trip.py' and argv[i + 1] == 'read' and any(os.path.basename(x).startswith('python') for x in argv[:i]):", "            if 'showcase_trip.py' in w and argv[i + 1] == 'read':", test_trip_reading),
            ("    if p.returncode != 0:\n", "    if False:\n", test_mem_cap),
            ("    if over_cap(peak, cap_mb, linux):\n", "    if False:\n", test_mem_cap),
            ("    if man.get('run') != run_id or os.path.basename(os.path.normpath(stage)) != run_id:", "    if False:", test_apply_stage),
            ("        if op['op'] in ('write', 'append') and os.path.dirname(os.path.abspath(op['src'])) != os.path.abspath(stage):", "        if False:", test_apply_stage),
            ("            os.killpg(pg, sig)\n", "            os.kill(p.pid, sig)\n", test_child_group_killed),
            ("                    chunk = fh.read(min(chunk_bytes, todo))", "                    chunk = fh.read(todo)", test_tail_streams),
            ("        if now_ms - last < grace_ms:", '        if False:', test_retire_grace),
            ("        off = was['off'] if was and was['off'] <= s_.st_size else 0", '        off = 0', test_tail_incremental),
            ("        if off and not fingerprint_ok(f, was):\n            off = 0", "        if False:\n            off = 0", test_tail_fingerprint),
            ("                        if (name, t, r['detail']) not in have:", "                        if True:", test_tail_fingerprint),
            ("                    cut = data.rfind(b'\\n') + 1", '                    cut = len(data)', test_tail_incremental),
            ("    jwrite(dirs_file, seen)\n    return problems, retired", "    if not problems:\n        jwrite(dirs_file, seen)\n    return problems, retired", test_observe_persists_on_blocked_cycles)]:
        m = _load_mutant(old, new)
        try:
            test(m)
            killed = False
        except AssertionError:
            killed = True
        assert killed, 'mutant survived: ' + old




def test_classify_and_clocks():
    """overseer-02show: the replay's classes -- a work skill's success is work, a successful walk is an action, a failure or a log
    row is neither; tail_read keeps each bot's newest work and action time and its code version; release_of = the most-run version."""
    def ln(name, status='success', detail='x', mins=0, ver='v1'):
        t = (NOW + dt.timedelta(minutes=mins)).isoformat().replace('+00:00', 'Z')
        return json.dumps({'@timestamp': t, 'code': {'version': ver}, 'bot': {'name': 'Ann', 'pos': {'x': 1, 'y': 70, 'z': 2}},
                           'skill': {'name': name, 'status': status, 'detail': detail}}, separators=(',', ':')).encode()
    assert OV.classify(ln('gather')) == 'work' and OV.classify(ln('_build_visit')) == 'work'
    assert OV.classify(ln('goto')) == 'act' and OV.classify(ln('explore')) == 'act'
    assert OV.classify(ln('gather', status='failure')) is None and OV.classify(ln('_affordance_scan')) is None
    assert OV.classify(ln('_place_town', detail='reason=skill outcome=placed')) == 'work' and OV.classify(ln('_place_town', detail='reason=path outcome=placed')) is None
    root = tempfile.mkdtemp()
    os.makedirs(os.path.join(root, 'Ann'))
    f = os.path.join(root, 'Ann', 'skill-Ann.jsonl')
    open(f, 'wb').write(b'\n'.join([ln('gather', mins=-50), ln('goto', mins=-20), ln('goto', status='failure', mins=-5), ln('_affordance_scan', mins=-1, ver='v2')]) + b'\n')
    st, _ = OV.tail_read([f], {}, int(NOW.timestamp() * 1000))
    b = st['bots']['Ann']
    ms = lambda m: int((NOW + dt.timedelta(minutes=m)).timestamp() * 1000)  # noqa: E731
    assert (b['work'], b['act'], b['ver']) == (ms(-50), ms(-20), 'v2'), b
    bots, _ = OV.roster_from_tail(st, int(NOW.timestamp() * 1000))
    assert bots[0]['workAt'] == ms(-50) and bots[0]['actAt'] == ms(-20)
    assert OV.release_of([{'online': True, 'ver': 'a'}, {'online': True, 'ver': 'b'}, {'online': True, 'ver': 'b'}, {'online': False, 'ver': 'c'}]) == 'b'
    assert OV.release_of([]) is None

# ---------------------------------------------------------------- overseer-02show: THE DRY SWITCH (the test world's practice run)
DRY_NOW = '2026-11-19T02:10:00Z'


def _dry_fixture():
    """A town as the showcase stack writes it (overseer-02show): the clean-up record (one generation, a plain cut column, a hollow
    crust, a waived cell), a building record, a lease and its marker, a bot env file, an old order file (a list with an unstick order)
    in the town's directory; a LIVE switch that says live; a live book that says lists were published (stopLive's bait); two bots'
    skill logs at the cycle's minute, standing by the cuts."""
    root = tempfile.mkdtemp()
    pool, logs, state, envd = (os.path.join(root, d) for d in ('pool', 'logs', 'state', 'env'))
    for d in (pool, logs, state, envd):
        os.makedirs(d)
    tidy = {'v': 1, 'plot': 'tidy', 'gen': 1, 'prev': None, 'cells': [], 'structure_complete': False,
            'cut': [{'at': [-20, 72, 0], 'kind': 'tidy', 'name': 'dirt'}, {'at': [-20, 73, 0], 'kind': 'tidy', 'name': 'dirt', 'added': 1},
                    {'at': [20, 72, 1], 'kind': 'tidy', 'name': 'cobblestone'}, {'at': [21, 72, 1], 'kind': 'tidy', 'name': 'dirt', 'hollow': True},
                    {'at': [22, 72, 1], 'kind': 'tidy', 'name': 'dirt'}],
            'waived': {'22,72,1': {'why': 'no_stand', 'at': 1, 'by': 'showcase-Bo'}}}
    json.dump(tidy, open(os.path.join(pool, 'project-0_70_0.tidy.g1.json'), 'w'))
    json.dump({'v': 1, 'plot': 'cottage2', 'gen': 1, 'prev': None, 'cells': [{'at': [5, 72, 5], 'role': 'wall'}]},
              open(os.path.join(pool, 'project-0_70_0.cottage2.g1.json'), 'w'))
    json.dump({'holder': 'showcase-Ann', 'gen': 3}, open(os.path.join(pool, 'project-0_70_0.tidy.seg-T-1-0.lease.g3.json'), 'w'))
    open(os.path.join(pool, 'project-0_70_0.tidy.seg-T-1-0.lease.g3.json.released'), 'w').write('')
    json.dump({'version': 1, 'zones': []}, open(os.path.join(pool, 'protected-zones.json'), 'w'))
    json.dump({'v': 1, 'kind': 'worklist', 'bot': 'showcase-Ann', 'jobs': [], 'order': {'kind': 'unstick', 'id': 'unstick:showcase-Ann:1'}},
              open(os.path.join(pool, 'worklist-showcase-Ann.json'), 'w'))
    open(os.path.join(envd, 'showcase-Ann.env'), 'w').write('MC_HOST=127.0.0.1\n')
    open(os.path.join(root, 'LIVE'), 'w').write('on\n')
    json.dump({'v': 1, 'published': True, 'book': []}, open(os.path.join(state, 'book.live.json'), 'w'))
    t0 = dt.datetime(2026, 11, 19, 2, 9, tzinfo=dt.timezone.utc)
    for bot, x in (('showcase-Ann', -20), ('showcase-Bo', 20)):
        d = os.path.join(logs, bot)
        os.makedirs(d)
        with open(os.path.join(d, 'skill-%s.jsonl' % bot), 'w') as fh:
            for i in range(3):
                t = (t0 + dt.timedelta(seconds=10 * i)).isoformat().replace('+00:00', 'Z')
                fh.write(json.dumps({'@timestamp': t, 'bot': {'name': bot, 'pos': {'x': x, 'y': 71, 'z': 0}}, 'skill': {'name': '_shop', 'detail': 'x'}}) + '\n')
            # the newest row carries no position (8% of the test world's rows): the position is the newest that has one
            fh.write(json.dumps({'@timestamp': (t0 + dt.timedelta(seconds=40)).isoformat().replace('+00:00', 'Z'), 'bot': {'name': bot, 'pos': None},
                                 'skill': {'name': '_affordance_scan', 'detail': 'x'}}) + '\n')
    return root, pool, logs, state


def _snap(root, skip):
    """Every file under root (but `skip`) -> {path: (size, mtime_ns, sha1)}: what a cycle wrote, changed or removed."""
    import hashlib
    out = {}
    for dp, dn, fn in os.walk(root):
        if os.path.abspath(dp).startswith(os.path.abspath(skip)):
            continue
        for f in fn:
            p = os.path.join(dp, f)
            st = os.stat(p)
            out[p] = (st.st_size, st.st_mtime_ns, hashlib.sha1(open(p, 'rb').read()).hexdigest())
    return out


def _cycle(script, root, pool, logs, state, extra, now=DRY_NOW):
    """One whole cycle, as cron runs it: the script in its own process (its rlimits, signals and RSS are its own)."""
    import subprocess as sp
    p = sp.run([sys.executable, script, '--pool', pool, '--home', '0,70,0', '--state', state, '--zones', os.path.join(pool, 'protected-zones.json'),
                '--logs', logs, '--now', now] + extra, capture_output=True, text=True, timeout=120)
    try:
        return p.returncode, json.loads(p.stdout.strip().splitlines()[-1])
    except (IndexError, ValueError):
        raise AssertionError('no row: rc %s %s' % (p.returncode, p.stderr[-400:]))


DRY_STATE_FILES = {'cycles.jsonl', 'decisions.jsonl', 'book.dry.json', 'book.live.json', 'setaside.json', 'tail.json', 'logdirs.json', 'gzcheck.json', 'overseer.lock'}


def test_dry_writes_nothing(script=None):
    """overseer-02show: a --dry cycle writes NO record, lease, env or order (list) file -- nothing outside its own --state (its log
    decisions.jsonl and cycles.jsonl, its book) -- even with a LIVE switch saying live, a live book saying lists were published, and an
    old order file in the town. POSITIVE CONTROL first: the same town with the switch and no --dry DOES write lists into the town,
    so the snapshot sees a write when there is one, and the fixture has work to decide."""
    import shutil
    script = script or OV.__file__
    if not shutil.which('node'):
        raise AssertionError('node is required for the dry-switch test')
    # the control: live writes
    root, pool, logs, state = _dry_fixture()
    before = _snap(root, state)
    rc, row = _cycle(script, root, pool, logs, state, ['--switch', os.path.join(root, 'LIVE')])
    assert rc == 0 and 'error' not in row, row
    changed = {p for p, v in _snap(root, state).items() if before.get(p) != v} | (set(before) - set(_snap(root, state)))
    assert any(os.path.basename(p).startswith('worklist-') for p in changed), 'control: live must write lists (%s)' % sorted(changed)
    # the dry cycles: the same town, the switch still saying live
    root, pool, logs, state = _dry_fixture()
    live_book = open(os.path.join(state, 'book.live.json')).read()
    before = _snap(root, state)
    for now in (DRY_NOW, '2026-11-19T02:55:00Z'):   # the second: both bots offline -> their jobs released (a second kind of decision)
        rc, row = _cycle(script, root, pool, logs, state, ['--switch', os.path.join(root, 'LIVE'), '--dry'], now)
        after = _snap(root, state)
        assert after == before, 'DRY WROTE OUTSIDE ITS STATE: %s' % sorted({p for p in set(after) | set(before) if after.get(p) != before.get(p)})
        assert rc == 0 and 'error' not in row, row
        assert row['mode'] == 'dry' and row['hard_dry'] is True and row.get('stopped') is None, row
    assert open(os.path.join(state, 'book.live.json')).read() == live_book, 'the live book is not touched'
    names = set()
    for dp, dn, fn in os.walk(state):
        if os.path.basename(dp) == 'stage' or os.path.basename(os.path.dirname(dp)) == 'stage':
            continue
        names |= set(fn)
    assert names <= DRY_STATE_FILES, 'unexpected files in state: %s' % sorted(names - DRY_STATE_FILES)
    for dp, dn, fn in os.walk(state):
        for f in fn:
            assert not f.startswith('worklist-') and '.lease' not in f and not f.endswith('.env'), 'an order/lease/env file in state: %s' % f
    # the log says what dry decided, joinable by bot, time and cell (and the positive control for "nothing written": it decided)
    rows = [json.loads(ln) for ln in open(os.path.join(state, 'decisions.jsonl'))]
    adds = [r for r in rows if r['kind'] == 'add']
    assert {r['cell'] for r in adds} == {'-20,72,0', '-20,73,0', '20,72,1'}, adds   # not the hollow crust, the waived cell or the record cell
    for r in rows:
        for k in ('t', 'at', 'bot', 'kind', 'rule', 'id', 'cell', 'mode', 'run'):
            assert k in r, (k, r)
    a = [r for r in adds if r['cell'] == '-20,73,0'][0]
    assert a['bot'] == 'showcase-Ann' and a['id'] == 'r:-20,73,0' and a['at'] == '2026-11-19T02:10:00.000Z' and a['mode'] == 'dry'
    assert a['bot_pos'] == [-20, 71, 0], 'the position is the newest row that has one: %s' % a
    assert a['listed'] is True and a['list'] == 1795054200000 and a['rule'] == 'split:nearest_under_share', a
    rel = [r for r in rows if r['kind'] == 'release']
    assert {r['from'] for r in rel} == {'showcase-Ann', 'showcase-Bo'} and all(r['why'] == 'offline' and r['rule'] == 'release:offline' for r in rel), rel
    assert row['excluded']['hollow'] == 1 and row['excluded']['waived'] == 1, row


def _beside(name, src):
    """A mutated file written BESIDE the real one (its imports and HERE resolve) -> its path."""
    path = os.path.join(os.path.dirname(OV.__file__), name)
    open(path, 'w').write(src)
    return path


def _mut(src, old, new):
    assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old
    return src.replace(old, new)


DRY_MUTANTS = [
    ('dry reads the switch',
     [("    live = False if a.dry else switch_live(a.switch)", "    live = switch_live(a.switch)")], None),
    ('the cycle writes lists in dry (the publish guard refuses it: an error row)',
     [], ("  } else if (inp.dry) {\n", "  } else if (inp.dry) { for (const [b, d] of Object.entries(c.lists)) io.write(path.join(inp.pool, listFile(b)), d)\n")),
    ('the cycle writes lists in dry and the publish guard is off: the town changes',
     [("            out['published'] = apply_stage(inp['stage'], run_id, confine=a.state if a.dry else None)",
       "            out['published'] = apply_stage(inp['stage'], run_id, confine=None)")],
     ("  } else if (inp.dry) {\n", "  } else if (inp.dry) { for (const [b, d] of Object.entries(c.lists)) io.write(path.join(inp.pool, listFile(b)), d)\n")),
    ('dry runs stopLive and the publish guard is off: the old order file is removed',
     [("            out['published'] = apply_stage(inp['stage'], run_id, confine=a.state if a.dry else None)",
       "            out['published'] = apply_stage(inp['stage'], run_id, confine=None)")],
     ("  } else if (inp.dry) {\n", "  } else if (inp.dry) { summary.stopped = stopLive(inp, now, io)\n")),
]


def dry_mutant_results():
    """-> [(what, None | the AssertionError's message)]: each mutant run through test_dry_writes_nothing (None = it survived)."""
    out = []
    for what, pys, js in DRY_MUTANTS:
        made = []
        try:
            py = open(OV.__file__).read()
            for old, new in pys:
                py = _mut(py, old, new)
            if js:
                jpath = _beside('_mutant-ovc-%d.mjs' % os.getpid(), _mut(open(OV.CYCLE).read(), *js))
                made.append(jpath)
                py = _mut(py, "CYCLE = os.path.join(HERE, 'overseer-cycle.mjs')", 'CYCLE = %r' % jpath)
            made.append(_beside('_mutant-ov-%d.py' % os.getpid(), py))
            try:
                test_dry_writes_nothing(made[-1])
                out.append((what, None))
            except AssertionError as e:
                out.append((what, str(e)))
        finally:
            for f in made:
                os.unlink(f)
    return out


def test_dry_mutants():
    """overseer-02show: anchored mutants of the dry switch -- each must fail test_dry_writes_nothing, for its own reason (a mutant
    killed by a crash or a resource limit proves nothing)."""
    for what, msg in dry_mutant_results():
        assert msg is not None, 'dry mutant survived: ' + what
        assert 'DRY WROTE OUTSIDE ITS STATE' in msg or "'error': 'publish: dry: a write outside the state dir refused" in msg or 'error' in msg and 'dry and live both set' in msg, (what, msg[:300])

if __name__ == '__main__':
    for n, f in list(globals().items()):
        if n.startswith('test_'):
            f()
            print('PASS', n)
