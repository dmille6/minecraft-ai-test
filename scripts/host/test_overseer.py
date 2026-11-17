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
            ("        if now_ms - last < grace_ms:", '        if False:', test_retire_grace),
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
