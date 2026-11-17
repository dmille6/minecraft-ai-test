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


class _Boom(Exception):
    pass


def test_read_problems():
    """r1 C3: an unreadable file, or a log directory gone since last cycle, is a problem (the cycle writes nothing)."""
    import contextlib
    import io

    def opener(f):
        if 'bad' in f:
            raise _Boom('gzip')
        return contextlib.nullcontext(io.StringIO('{}'))
    ok = ['/l/Ann/skill-Ann.jsonl', '/l/Bo/skill-Bo.jsonl-20261116.gz']
    p, dirs = OV.read_problems(ok, ['Ann', 'Bo'], opener)
    assert p == [] and dirs == {'Ann', 'Bo'}
    p, _ = OV.read_problems(ok + ['/l/Cy/skill-bad.jsonl'], ['Ann'], opener)
    assert len(p) == 1 and p[0].startswith('unreadable /l/Cy/'), p
    p, _ = OV.read_problems(ok[:1], ['Ann', 'Bo'], opener)
    assert p == ['no log for Bo (seen last cycle)'], p


def test_read_problems_mutants():
    """Anchored mutants: each must apply exactly once and make test_read_problems fail."""
    import importlib.util
    src = open(OV.__file__).read()
    for old, new in [("            problems.append('unreadable %s: %s' % (f, type(e).__name__))", '            pass'),
                     ("    for d in sorted(set(prev_dirs) - dirs):", '    for d in []:')]:
        assert src.count(old) == 1, 'ANCHOR MISSING OR NOT UNIQUE: ' + old
        path = os.path.join(tempfile.mkdtemp(), 'ovm.py')
        open(path, 'w').write(src.replace(old, new))
        sys.path.insert(0, os.path.dirname(OV.__file__))
        spec = importlib.util.spec_from_file_location('ovm', path)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        saved = OV.read_problems
        OV.read_problems = m.read_problems
        try:
            try:
                test_read_problems()
                killed = False
            except AssertionError:
                killed = True
        finally:
            OV.read_problems = saved
        assert killed, 'mutant survived: ' + old


if __name__ == '__main__':
    for n, f in list(globals().items()):
        if n.startswith('test_'):
            f()
            print('PASS', n)
