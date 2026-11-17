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


if __name__ == '__main__':
    for n, f in list(globals().items()):
        if n.startswith('test_'):
            f()
            print('PASS', n)
