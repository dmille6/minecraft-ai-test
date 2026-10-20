#!/usr/bin/env python3
"""Behaviour tests for scripts/host/fleetstatus.py on the FakeES of test_estelemetry.py.

No network, no credentials. Run: python3 scripts/test_fleetstatus.py   (exit 1 on any failure)
"""
import datetime as dt
import importlib.util
import contextlib
import io
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


def disk_fake(reading_at='2026-10-14T19:25:01Z', alarms=(), blocks=None, missing=False, used=27.2,
              rate=1.48, days=196.0, empty=False):
    """The two calls elk_disk() makes: the newest mcai-monitor-disk doc and the index blocks."""
    calls = []

    def client(method, path, body):
        calls.append(path)
        if path.startswith(FS.DISK_INDEX + '/_search'):
            if missing:
                raise FS._est.EsError(f'{FS.DISK_INDEX}/_search: HTTP 404: index_not_found_exception')
            if empty:
                return {'hits': {'hits': []}}
            return {'hits': {'hits': [{'_source': {
                '@timestamp': reading_at, 'host': 'minecraftelk', 'path': '/', 'used_pct': used,
                'total_gb': 526.0, 'growth_gb_per_day': rate, 'history_h': 167.0, 'proj_pct': 85.0,
                'days_to_proj_pct': days, 'alarms': list(alarms)}}]}}
        if '/_settings' in path:
            return blocks or {}
        raise AssertionError(f'unexpected disk call {path}')
    client.calls = calls
    return client


def run(docs, windows='3h,24h,2d', disk=None, stdout=None):
    fake = TE.FakeES(docs)
    real = FS.EsEvents.load
    FS.DISK_CLIENT = disk or disk_fake()

    def load(stream='skill', **kw):
        kw.setdefault('now', NOW)
        return real(stream, client=fake, **kw)
    FS.EsEvents.load = load
    try:
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as fh:
            json.dump({'cobblestone': 64, 'iron_pickaxe': 1}, fh)
        sys.argv = ['fleetstatus', '--windows', windows, '--now', NOW, '--stack', fh.name,
                    '--json', fh.name + '.out']
        if stdout is not None:
            with contextlib.redirect_stdout(stdout):
                FS.main()
        else:
            FS.main()
        return json.load(open(fh.name + '.out'))
    finally:
        FS.EsEvents.load = real
        FS.DISK_CLIENT = None


def t_disk_header_healthy():
    out = io.StringIO()
    d = run(fleet_docs(), stdout=out)['elk_disk']
    assert d['alarm'] is False and len(d['lines']) == 1, d
    assert d['lines'][0].startswith('ELK disk minecraftelk:/ 27.2% of 526.0 GB') and '85% in 196 d' in d['lines'][0], d
    head = out.getvalue().splitlines()
    assert head[0].startswith('FLEET STATUS') and head[1].startswith('ELK disk'), head[:3]   # in the HEADER


def t_disk_header_repeats_disklow():
    a = 'DiskLow: / projected to cross 85% in 9.6 days at +4.10 GB/day (fit over 168 h; now 77.5%)'
    out = io.StringIO()
    d = run(fleet_docs(), disk=disk_fake(alarms=[a], used=77.5, rate=4.1, days=9.6), stdout=out)['elk_disk']
    assert d['alarm'] is True and d['lines'][1] == '  !! ' + a, d
    assert '!! DiskLow: / projected' in '\n'.join(out.getvalue().splitlines()[:4])


def t_disk_header_stale_reading_is_an_alarm():
    d = run(fleet_docs(), disk=disk_fake(reading_at='2026-10-14T16:25:01Z'))['elk_disk']
    assert d['alarm'] is True and any('STALE (3.6 h old)' in x for x in d['lines']), d


def t_disk_header_fresh_twin_is_not_stale():
    d = run(fleet_docs(), disk=disk_fake(reading_at='2026-10-14T18:25:01Z'))['elk_disk']   # 1.6 h
    assert d['alarm'] is False and not any('STALE' in x for x in d['lines']), d


def t_disk_header_missing_reading_is_an_alarm_not_silence():
    d = run(fleet_docs(), disk=disk_fake(missing=True))['elk_disk']
    assert d['alarm'] is True and d['lines'][0].startswith('!! ELK disk: NO READING'), d


def t_disk_header_empty_index_is_an_alarm():
    d = run(fleet_docs(), disk=disk_fake(empty=True))['elk_disk']
    assert d['alarm'] is True and 'holds no reading' in d['lines'][0], d


def t_disk_header_names_a_write_block():
    blocks = {'.ds-mcai-skill-agents-2026.10.15-000011': {'settings': {'index': {'blocks': {
        'read_only_allow_delete': 'true'}}}}}
    d = run(fleet_docs(), disk=disk_fake(blocks=blocks))['elk_disk']
    assert d['alarm'] is True and d['blocked_indices'] == ['.ds-mcai-skill-agents-2026.10.15-000011'], d
    assert any('WRITE BLOCK on 1 indices' in x for x in d['lines']), d


def t_disk_header_never_breaks_the_report():
    def broken(method, path, body):
        raise OSError('network unreachable')
    rep = run(fleet_docs(), disk=broken)
    assert rep['elk_disk']['alarm'] is True and rep['windows']['3h']['deaths'] == 1


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


def _audit(text, hours_old):
    d = tempfile.mkdtemp(); p = os.path.join(d, 'opsaudit-latest.md')
    if text is not None:
        with open(p, 'w') as fh:
            fh.write(text)
        t = dt.datetime(2026, 10, 14, 20, tzinfo=dt.timezone.utc) - dt.timedelta(hours=hours_old)
        os.utime(p, (t.timestamp(), t.timestamp()))
    return FS.opsaudit_line(dt.datetime(2026, 10, 14, 20, tzinfo=dt.timezone.utc), path=p)


def t_opsaudit_clean_report_is_quiet():
    line = _audit('OPSAUDIT 2026-10-14 FLAGS: 0 (0 high)\n## Flags\nnone\n', 3)
    assert line.startswith('ops audit (Codex) 2026-10-14: 0 flag(s), 0 high, 3 h old'), line


def t_opsaudit_high_flag_is_an_alarm():
    line = _audit('OPSAUDIT 2026-10-14 FLAGS: 3 (1 high)\n', 2)
    assert line.startswith('!! ') and '3 flag(s), 1 high' in line, line


def t_opsaudit_stale_report_is_an_alarm():
    line = _audit('OPSAUDIT 2026-10-12 FLAGS: 0 (0 high)\n', 31)
    assert line.startswith('!! ') and 'STALE' in line, line


def t_opsaudit_missing_report_is_an_alarm_not_silence():
    line = _audit(None, 0)
    assert line.startswith('!! ops audit: NO REPORT'), line


def t_opsaudit_failed_run_is_an_alarm():
    line = _audit('OPSAUDIT 2026-10-14 FAILED: codex rc=1, no report line\n', 1)
    assert line.startswith('!! ops audit: UNREADABLE'), line


def t_opsaudit_line_opens_the_report():
    out = io.StringIO()
    rep = run(fleet_docs(), stdout=out)
    assert 'opsaudit' in rep and out.getvalue().splitlines()[2].startswith(('ops audit', '!! ops audit')), out.getvalue()[:400]


TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]

if __name__ == '__main__':
    for n, f in TESTS:
        TE.check(n[2:], f)
    print(f'{TE.PASS} passed, {TE.FAIL} failed')
    sys.exit(1 if TE.FAIL else 0)
