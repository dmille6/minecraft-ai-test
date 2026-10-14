#!/usr/bin/env python3
"""Behaviour tests for scripts/host/fleetstatus.py on the FakeES of test_estelemetry.py.

No network, no credentials. Run: python3 scripts/test_fleetstatus.py   (exit 1 on any failure)
"""
import datetime as dt
import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import test_estelemetry as TE  # noqa: E402  (FakeES, doc, check, raises)

spec = importlib.util.spec_from_file_location(
    'fleetstatus', os.path.join(os.environ.get('FLEETSTATUS_SRC') or os.path.join(HERE, 'host'), 'fleetstatus.py'))
FS = importlib.util.module_from_spec(spec)
spec.loader.exec_module(FS)
from lib.estelemetry import EsEvents, ZeroLooksWrong  # noqa: E402

NOW = '2026-10-14T20:00:00Z'
UNTIL = '2026-10-14T19:55:00Z'          # NOW - LAG


def fleet_docs(stop_at_hour=20):
    """Two bots, docs every 10 min from 10-12 00:00 to stop_at_hour on 10-14, all four actions,
    four deaths (three drownings, one of them and one fall with no exp.pool), and a bag that ends EMPTY."""
    out = []
    t = dt.datetime(2026, 10, 12, tzinfo=dt.timezone.utc)
    end = dt.datetime(2026, 10, 14, stop_at_hour, tzinfo=dt.timezone.utc)
    i = 0
    while t < end:
        ts = t.strftime('%Y-%m-%dT%H:%M:%S.000Z')
        for bot, pool in (('board-a-Alpha', 'board-a'), ('self-isolated-a-Bravo', 'self-isolated-a-Bravo')):
            name = FS.ACTIONS[i % 4]
            out.append(TE.doc(ts, name, bot=bot, pool=pool, status='success' if i % 3 else 'failed',
                              inv={'cobblestone': 70, 'iron_pickaxe': 1}))
        t += dt.timedelta(minutes=10)
        i += 1
    out.append(TE.doc('2026-10-14T19:10:00.000Z', '_death', status='failed', fail='drowning',
                      bot='self-isolated-a-Bravo', pool='self-isolated-a-Bravo'))
    out.append(TE.doc('2026-10-13T08:00:00.000Z', '_death', status='failed', fail='fall', bot='board-a-Alpha', pool=None))
    out.append(TE.doc('2026-10-13T09:00:00.000Z', '_death', status='failed', fail='drowning',
                      bot='self-isolated-a-Bravo', pool='self-isolated-a-Bravo'))
    out.append(TE.doc('2026-10-13T10:00:00.000Z', '_death', status='failed', fail='drowning', bot='board-a-Alpha', pool=None))
    out.append(TE.doc('2026-10-14T19:53:00.000Z', '_affordance_scan', bot='board-a-Alpha', inv={}))
    return out


def run(docs, windows='3h,24h,2d'):
    fake = TE.FakeES(docs)
    real = FS.EsEvents.load

    def load(stream='skill', **kw):
        kw.setdefault('now', NOW)
        return real(stream, client=fake, **kw)
    FS.EsEvents.load = load
    try:
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as fh:
            json.dump({'cobblestone': 64, 'iron_pickaxe': 1}, fh)
        sys.argv = ['fleetstatus', '--windows', windows, '--now', NOW, '--stack', fh.name,
                    '--json', fh.name + '.out']
        FS.main()
        return json.load(open(fh.name + '.out'))
    finally:
        FS.EsEvents.load = real


def t_report_numbers():
    rep = run(fleet_docs())
    w = rep['windows']['3h']
    assert w['deaths'] == 1 and w['drownings'] == 1
    assert w['drownings_by_pool'] == {'isolated-a': 1}, w['drownings_by_pool']   # grouped isolated pool
    assert w['bots'] == 2 and w['bots_absent'] == []
    # 16:55..19:55: the 16h edge holds no doc in the window, 17h and 18h are full, 19h counts 55 min
    # -- 2 bots x 2.917 h, not 2 x 4 hour buckets
    assert w['active_bot_hours'] == round(2 * (2 + 55 / 60), 3), w['active_bot_hours']
    w2 = rep['windows']['2d']
    assert w2['deaths'] == 4 and w2['deaths_by_pool'] == {'<missing>': 2, 'isolated-a': 2}, w2['deaths_by_pool']
    assert w2['deaths_by_cause'] == {'drowning': 3, 'fall': 1}
    assert w2['drownings'] == 3 and w2['drownings_by_pool'] == {'<missing>': 1, 'isolated-a': 2}
    for k, a in w2['actions'].items():
        assert a['attempts'] > a['success'] > 0, (k, a)


def t_drowning_breakdown_reconciled():
    """If the hourly/daily table ever disagrees with the direct count, refuse rather than print it."""
    real = FS.EsEvents.histogram

    def short(self, *a, **k):
        h = real(self, *a, **k)
        for t in list(h)[:1]:
            h[t] = {}
        return h
    FS.EsEvents.histogram = short
    try:
        TE.raises(ZeroLooksWrong, lambda: run(fleet_docs()), contains='time breakdown')
    finally:
        FS.EsEvents.histogram = real


def t_quiet_window_reports_zero_deaths():
    """No death in the 3 h window: an honest 0 (the names are proven in the wider window)."""
    docs = [d for d in fleet_docs() if not (d['skill']['name'] == '_death' and d['@timestamp'] > '2026-10-14T17')]
    w = run(docs)['windows']['3h']
    assert w['deaths'] == 0 and w['drownings'] == 0 and w['deaths_by_cause'] == {}, w


def t_short_stall_is_named():
    docs = [d for d in fleet_docs() if not ('2026-10-13T05:00' <= d['@timestamp'] < '2026-10-13T05:40')]
    w = run(docs)['windows']['2d']
    assert any('10-minute slots' in c and '2026-10-13T05:00' in c for c in w['caveats']), w['caveats']


def t_pos_row_without_inventory_is_not_an_empty_bag():
    docs = fleet_docs() + [{'@timestamp': '2026-10-14T19:52:00.000Z', 'skill': {'name': '_x', 'status': 'success'},
                            'bot': {'name': 'self-isolated-a-Bravo', 'pos': {'x': 1.0, 'y': 2.0, 'z': 3.0}},
                            'exp': {'pool': 'self-isolated-a-Bravo'}, 'code': {'version': 'v'}}]
    b = run(docs)['bags']
    assert b['pos_without_inventory'] == ['self-isolated-a-Bravo'] and b['bots_with_snapshot'] == 1, b


def t_emptied_bag_is_seen():
    b = run(fleet_docs())['bags']
    assert b['bots_with_snapshot'] == 2
    assert b['slots_min'] == 0, b            # board-a-Alpha's latest snapshot is an EMPTY bag
    assert b['slots_max'] == 3, b            # 70 cobblestone = 2 slots + 1 pickaxe
    assert 'LOWER bound' in b['method']


def t_stale_window_refused():
    """Ingest stopped at 18:00: the 3 h window must refuse, not print zeros."""
    docs = [d for d in fleet_docs(stop_at_hour=18) if d['@timestamp'] < '2026-10-14T18:00']
    TE.raises(ZeroLooksWrong, lambda: run(docs, '3h,2d'), contains='stalled')


def t_empty_window_refused():
    docs = [d for d in fleet_docs() if d['@timestamp'] < '2026-10-14T16:00']
    TE.raises(ZeroLooksWrong, lambda: run(docs, '3h,2d'), contains='NO documents')


def t_empty_hours_are_named():
    docs = [d for d in fleet_docs() if not ('2026-10-13T05' <= d['@timestamp'] < '2026-10-13T07')]
    w = run(docs)['windows']['2d']
    assert any("'2026-10-13T05', '2026-10-13T06'" in c for c in w['caveats']), w['caveats']


def t_unknown_name_refused():
    docs = [d for d in fleet_docs() if d['skill']['name'] != 'town_deposit']
    TE.raises(ZeroLooksWrong, lambda: run(docs), contains='town_deposit')


TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]

if __name__ == '__main__':
    for n, f in TESTS:
        TE.check(n[2:], f)
    print(f'{TE.PASS} passed, {TE.FAIL} failed')
    sys.exit(1 if TE.FAIL else 0)
