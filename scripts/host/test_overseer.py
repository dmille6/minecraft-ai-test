"""overseer-01show: the host wrapper's two decisions -- live or dry, and the roster/rows it hands the cycle. Run: python3 test_overseer.py"""
import datetime as dt
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
        assert ok == {'row': 'op=cycle'}, ok


def _load_mutant(old, new):
    import importlib.util
    src = open(OV.__file__).read()
    assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old
    path = os.path.join(tempfile.mkdtemp(), 'ovm.py')
    open(path, 'w').write(src.replace(old, new))
    spec = importlib.util.spec_from_file_location('ovm', path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def test_mutants():
    """Anchored mutants: each applies exactly once and fails its test."""
    for old, new, test in [
            ("                if key not in cache:\n                    check_gz(f)", "                if False:\n                    check_gz(f)", test_gzip_truncated),
            ("            problems.append('unreadable %s: %s' % (f, type(e).__name__))", '            pass', test_gzip_truncated),
            ("        if now_ms - last < grace_ms:", '        if True:', test_retire_grace),
            ("    for ln in ps_lines:\n        parts = ln.strip().split(None, 1)\n        if len(parts) < 2 or not parts[0].isdigit() or int(parts[0]) in set(self_pids):", "    for ln in ps_lines:\n        parts = ln.strip().split(None, 1)\n        if len(parts) < 2 or not parts[0].isdigit():", test_trip_reading),
            ("            if os.path.basename(w) == 'showcase_trip.py' and argv[i + 1] == 'read' and any(os.path.basename(x).startswith('python') for x in argv[:i]):", "            if 'showcase_trip.py' in w and argv[i + 1] == 'read':", test_trip_reading),
            ("    if p.returncode != 0:\n", "    if False:\n", test_mem_cap),
            ("        if now_ms - last < grace_ms:", '        if False:', test_retire_grace),
            ("        off = was['off'] if was and was['off'] <= s_.st_size else 0", '        off = 0', test_tail_incremental),
            ("        if off and not fingerprint_ok(f, was):\n            off = 0", "        if False:\n            off = 0", test_tail_fingerprint),
            ("                        if (name, t, r['detail']) not in have:", "                        if True:", test_tail_fingerprint),
            ("            end = buf.rfind(b'\\n') + 1", '            end = len(buf)', test_tail_incremental),
            ("    jwrite(dirs_file, seen)\n    return problems, retired", "    if not problems:\n        jwrite(dirs_file, seen)\n    return problems, retired", test_observe_persists_on_blocked_cycles)]:
        m = _load_mutant(old, new)
        try:
            test(m)
            killed = False
        except AssertionError:
            killed = True
        assert killed, 'mutant survived: ' + old


if __name__ == '__main__':
    for n, f in list(globals().items()):
        if n.startswith('test_'):
            f()
            print('PASS', n)
