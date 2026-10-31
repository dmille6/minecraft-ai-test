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


FNOW = dt.datetime(2026, 10, 22, 12, 0, tzinfo=dt.timezone.utc)


def _hb(**kw):
    """A heartbeat.json as frontiercensus.py --tick writes it; kw overrides. None -> no file at all."""
    d = tempfile.mkdtemp(); p = os.path.join(d, 'heartbeat.json')
    if kw.get('_absent'):
        return p
    hb = {'mode': 'tick', 'at': '2026-10-22T11:57:00Z', 'status': 'idle', 'newest_measured_hour_end': '2026-10-22T11:00:00Z',
          'last_publish': {'at': '2026-10-22T11:57:30Z', 'status': 'warmup', 'usable': 13, 'offered': 13},
          'towns': 13, 'isolated_folded': ['isolated-a', 'isolated-c', 'isolated-d'], 'backlog_hours': 0,
          'home_problems': {}, 'site_errors': {}, 'uncovered_days': [],
          'warmup': {'run_start': '2026-10-22T00:00:00Z', 'complete': False, 'complete_at': '2026-10-24T00:00:00Z'}}
    hb.update(kw)
    with open(p, 'w') as fh:
        fh.write(kw['_raw'] if '_raw' in kw else json.dumps(hb))
    return p


def t_frontier_healthy_line_names_its_denominators():
    line = FS.frontier_line(FNOW, path=_hb())
    assert line.startswith('frontier census (E0): idle, tick 3 min ago, 13 towns (+3 isolated folded), measured to 11:00Z'), line
    assert 'warm-up ends 2026-10-24T00:00Z' in line and '!!' not in line, line


def t_frontier_missing_heartbeat_is_an_alarm_not_silence():
    line = FS.frontier_line(FNOW, path=_hb(_absent=True))
    assert line.startswith('!! frontier census (E0): NO HEARTBEAT (FileNotFoundError)'), line


def t_frontier_unreadable_heartbeat_is_an_alarm():
    line = FS.frontier_line(FNOW, path=_hb(_raw='{"at": '))
    assert line.startswith('!! frontier census (E0): NO HEARTBEAT (JSONDecodeError)'), line


def t_frontier_stale_tick_is_an_alarm():
    line = FS.frontier_line(FNOW, path=_hb(at='2026-10-22T11:40:00Z'))
    assert line.startswith('!! ') and 'STALE: newest tick 20 min old' in line, line


def t_frontier_void_reads_void_never_zero():
    line = FS.frontier_line(FNOW, path=_hb(status='void', es_blind_since='2026-10-22T10:00:00Z'))
    assert line.startswith('!! ') and 'VOID: ES blind since 2026-10-22T10:00:00Z' in line, line


def t_frontier_error_instrument_behind_and_towns_are_alarms():
    for kw, want in (({'status': 'error', 'error': 'EsError: x'}, 'ERROR: EsError: x'),
                     ({'status': 'selftest_failed'}, 'SELFTEST_FAILED'),
                     ({'status': 'instrument', 'instrument': ['3 sampled rows fall in regions the fold lacks']}, 'INSTRUMENT: 3'),
                     ({'newest_measured_hour_end': '2026-10-22T09:00:00Z'}, 'BEHIND: newest measured hour ended 09:00Z'),
                     ({'newest_measured_hour_end': None}, 'BEHIND: no measured hour'),
                     ({'home_problems': {'hive-c': 'conflicting homes'}}, 'towns left out'),
                     ({'site_errors': {'hive-c': 'OSError'}}, 'hazards unread'),
                     ({'last_publish': {'at': '2026-10-22T11:57:30Z', 'status': 'warmup',
                                        'unusable': {'hive-c': 'not writable'}}}, 'PUBLISHER cannot write')):
        line = FS.frontier_line(FNOW, path=_hb(**kw))
        assert line.startswith('!! frontier census (E0): ') and want in line, (kw, line)


def t_frontier_backlog_is_quiet_while_warming_and_an_alarm_once_warm():
    """Claude r2 P2-3: a backlog during the warm-up (the first backfill) is expected; a warm census that has not staged
    for 30 min because of one is not."""
    line = FS.frontier_line(FNOW, path=_hb(status='behind', backlog_hours=40))
    assert line.startswith('frontier census (E0): behind') and 'backlog 40 h' in line and 'warm-up ends' in line, line
    line = FS.frontier_line(FNOW, path=_hb(status='behind', backlog_hours=40, last_staged_at='2026-10-22T10:00:00Z',
                                            withheld='backlog 40 hours, unstable []',
                                            last_publish={'at': '2026-10-22T11:57:30Z', 'status': 'ok'},
                                            warmup={'complete': True, 'complete_at': '2026-10-21T00:00:00Z'}))
    assert line.startswith('!! ') and 'NOT STAGING since 2026-10-22T10:00:00Z (withheld: backlog 40' in line, line


def t_frontier_malformed_heartbeat_never_raises():
    for raw in ('[1, 2]', '{"at": "2026-10-22T11:57:00"}', '{"at": "2026-10-22T11:57:00Z", "warmup": 5}',
                '{"at": "2026-10-22T11:57:00Z", "newest_measured_hour_end": 7}'):
        line = FS.frontier_line(FNOW, path=_hb(_raw=raw))
        assert line.startswith('!! frontier census (E0): '), (raw, line)


def t_frontier_warm_census_that_stops_staging_or_publishing_alarms():
    warm = {'run_start': '2026-10-20T00:00:00Z', 'complete': True, 'complete_at': '2026-10-22T00:00:00Z'}
    okp = {'at': '2026-10-22T11:57:30Z', 'status': 'ok', 'published': 13}
    line = FS.frontier_line(FNOW, path=_hb(warmup=warm, last_staged_at='2026-10-22T11:57:00Z', last_publish=okp))
    assert line.startswith('frontier census (E0): idle') and 'warm-up complete' in line, line
    for kw, want in (({'last_staged_at': '2026-10-22T11:00:00Z', 'last_publish': okp}, 'NOT STAGING'),
                     ({'last_staged_at': None, 'last_publish': okp}, 'NOT STAGING'),
                     ({'last_staged_at': '2026-10-22T11:57:00Z', 'last_publish': None}, 'PUBLISHER silent'),
                     ({'last_staged_at': '2026-10-22T11:57:00Z', 'last_publish': dict(okp, at='2026-10-22T11:30:00Z')},
                      'PUBLISHER ok at 2026-10-22T11:30:00Z'),
                     ({'last_staged_at': '2026-10-22T11:57:00Z',
                       'last_publish': dict(okp, status='refused', why='running as root')}, 'PUBLISHER refused')):
        line = FS.frontier_line(FNOW, path=_hb(warmup=warm, **kw))
        assert line.startswith('!! ') and want in line, (kw, line)


def t_frontier_publisher_silent_during_warmup_alarms():
    """Claude r4 P2-1: the 48 h warm-up must not hide a publisher that never runs."""
    for lp, want in ((None, 'PUBLISHER silent'), ({'at': '2026-10-22T11:00:00Z', 'status': 'warmup'}, 'during the warm-up'),
                     ({'at': '2026-10-22T11:57:30Z', 'status': 'error'}, 'PUBLISHER error'),
                     ({'at': '2026-10-22T11:57:30Z', 'status': 'warmup', 'usable': 12, 'offered': 13}, 'usable 12 of 13')):
        line = FS.frontier_line(FNOW, path=_hb(last_publish=lp))
        assert line.startswith('!! ') and want in line, (lp, line)


def t_frontier_publisher_age_is_judged_against_the_tick_that_carried_it():
    """Claude r5 P3-2: the heartbeat carries the PREVIOUS run's publisher line; a slow backfill tick (cron slot skipped)
    must not make a live publisher read stale. The tick's own age is STALE's job."""
    line = FS.frontier_line(dt.datetime(2026, 10, 22, 12, 9, tzinfo=dt.timezone.utc),
                            path=_hb(at='2026-10-22T11:57:00Z', last_publish={'at': '2026-10-22T11:47:30Z',
                                                                              'status': 'warmup', 'usable': 13, 'offered': 13}))
    assert line.startswith('frontier census (E0): idle'), line
    warm = {'run_start': '2026-10-20T00:00:00Z', 'complete': True, 'complete_at': '2026-10-22T00:00:00Z'}
    line = FS.frontier_line(dt.datetime(2026, 10, 22, 12, 9, tzinfo=dt.timezone.utc),
                            path=_hb(at='2026-10-22T11:57:00Z', warmup=warm, last_staged_at='2026-10-22T11:57:00Z',
                                     last_publish={'at': '2026-10-22T11:47:30Z', 'status': 'ok'}))
    assert line.startswith('frontier census (E0): idle') and 'warm-up complete' in line, line


def t_frontier_line_is_in_the_header():
    out = io.StringIO()
    rep = run(fleet_docs(), stdout=out)
    head = out.getvalue().splitlines()[:5]
    assert 'frontier' in rep and any(x.startswith(('frontier census (E0)', '!! frontier census (E0)')) for x in head), head


READER = os.path.join(HERE, 'host', 'structcount', 'scread.py')


def _sc_mirror(day='2026-10-23', status='OK', attempt='A1', newer=None, started='2026-10-23T03:45:00+00:00', ended=None):
    """A structcount mirror (the layout pull.py writes) in a temp dir; returns its path."""
    import hashlib
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, 'gen-1')); os.makedirs(os.path.join(d, 'attempts'))
    p = os.path.join(d, 'gen-1', 'structcount-day.json')
    json.dump({'hive-a': {'buildings': 2}, 'board-a': {'buildings': 0}}, open(p, 'w'))
    h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
    json.dump({'day': day, 'attempt': attempt, 'status': status, 'why': 'invalid: hive-a: stamp control 1 < floor 150',
               'generation': 'gen-1', 'files': {'structcount-day.json': h, 'cells.json.gz': 'x'},
               'last_good': {'generation': 'gen-1', 'sha': h},
               'totals': {'buildings': 2, 'unlit_rooms': 1, 'surface_structures': 1533, 'worlds': 16}}, open(os.path.join(d, 'manifest.json'), 'w'))
    att = {'attempt': newer or attempt, 'day': day, 'started': started}
    if ended:
        att['ended'] = ended
    json.dump(att, open(os.path.join(d, 'attempts', 'attempt.json'), 'w'))
    return d


SCNOW = dt.datetime(2026, 10, 23, 12, 0, tzinfo=dt.timezone.utc)


def t_structcount_line_ok():
    line = FS.structcount_line(SCNOW, sdir=_sc_mirror(), reader=READER)
    assert line.startswith('structcount (B5 buildings, from the world): OK today: 2 buildings (hive-a 2)'), line


def t_structcount_line_unknown_is_an_alarm():
    line = FS.structcount_line(SCNOW, sdir=_sc_mirror(status='UNKNOWN'), reader=READER)
    assert line.startswith('!! structcount') and 'stamp control' in line, line


def t_structcount_line_failed_retry_after_ok_is_an_alarm():
    line = FS.structcount_line(SCNOW, sdir=_sc_mirror(newer='A2', ended='2026-10-23T04:00:00+00:00'), reader=READER)
    assert line.startswith('!! structcount') and 'A2 has no manifest' in line, line


def t_structcount_line_running_is_not_an_alarm():
    line = FS.structcount_line(SCNOW, sdir=_sc_mirror(newer='A2', started='2026-10-23T11:50:00+00:00'), reader=READER)
    assert line.startswith('structcount (B5 buildings, from the world): RUNNING'), line


def t_structcount_line_before_due_shows_yesterday():
    early = dt.datetime(2026, 10, 24, 2, 0, tzinfo=dt.timezone.utc)
    line = FS.structcount_line(early, sdir=_sc_mirror(), reader=READER)
    assert 'OK yesterday' in line and not line.startswith('!!'), line
    late = dt.datetime(2026, 10, 24, 7, 0, tzinfo=dt.timezone.utc)
    line = FS.structcount_line(late, sdir=_sc_mirror(), reader=READER)
    assert line.startswith('!! structcount') and 'stale manifest' in line, line


def t_structcount_line_never_raises():
    line = FS.structcount_line(SCNOW, sdir='/nonexistent', reader='/nonexistent/scread.py')
    assert line.startswith('!! structcount: UNREADABLE'), line
    line = FS.structcount_line(SCNOW, sdir='/nonexistent', reader=READER)
    assert line.startswith('!! structcount') and 'no readable manifest' in line, line
    bad = os.path.join(tempfile.mkdtemp(), 'scread.py')
    open(bad, 'w').write('def status(:\n')                      # a broken reader (SyntaxError, not an OSError)
    line = FS.structcount_line(SCNOW, sdir=_sc_mirror(), reader=bad)
    assert line.startswith('!! structcount: UNREADABLE (SyntaxError'), line


def t_structcount_line_is_in_the_header():
    out = io.StringIO()
    rep = run(fleet_docs(), stdout=out)
    head = out.getvalue().splitlines()[:8]
    assert 'structcount' in rep and any('structcount' in x for x in head), head


def t_showcase_block_never_raises():
    """docs/reports/showcase-2026-10-20.md s.4: the SHOWCASE block reads only its own streams and NEVER takes the
    fleet report down: an ES that refuses everything yields one line per part, no exception."""
    def dead(method, path, body=None, timeout=120):
        raise RuntimeError(f'refused {path}')
    until = dt.datetime(2026, 10, 14, 19, 55, tzinfo=dt.timezone.utc)
    out = FS.showcase_report(until, client=dead)
    text = '\n'.join(out['lines'])
    assert 'SHOWCASE bots: stream unreadable' in text, text
    assert 'SHOWCASE BRAIN: stream unreadable' in text, text
    assert 'SHOWCASE TIMELAPSE: heartbeat unreadable' in text, text


def t_showcase_block_without_its_helper_module():
    import lib
    saved = sys.modules.get('lib.showcasestatus')
    attr = lib.__dict__.pop('showcasestatus', None)
    sys.modules['lib.showcasestatus'] = None            # makes `from lib import showcasestatus` fail
    try:
        out = FS.showcase_report(dt.datetime(2026, 10, 14, 19, 55, tzinfo=dt.timezone.utc), client=None)
    finally:
        if saved is None:
            sys.modules.pop('lib.showcasestatus', None)
        else:
            sys.modules['lib.showcasestatus'] = saved
        if attr is not None:
            lib.showcasestatus = attr
    assert out['lines'][0].startswith('SHOWCASE: block unavailable'), out


def t_showcase_streams_are_not_the_bench_streams():
    """The bench stream names are pinned; the showcase keys point elsewhere and share only the family."""
    S = FS._est.STREAMS
    assert (S['skill']['index'], S['llm']['index']) == ('mcai-skill-agents', 'mcai-llm-agents'), S
    assert (S['showcase-skill']['index'], S['showcase-llm']['index']) == ('mcai-skill-showcase', 'mcai-llm-showcase')
    assert S['showcase-skill']['family'] == 'skill' and S['showcase-llm']['family'] == 'llm'
    assert not ({S['skill']['index'], S['llm']['index']} & {S['showcase-skill']['index'], S['showcase-llm']['index']})



# SHOWCASE HEADER (2026-10-26: an 18 h tripwire stop sat unnoticed at the bottom of the report)
SCNOW_SHOW = dt.datetime(2026, 10, 26, 14, 0, tzinfo=dt.timezone.utc)
TRIP_WHY = 'tripwire: VERDICT      TRIP -- S5 G3 lid_unreach 1'


def _show_docs(last, bots=('show-Ada', 'show-Bo'), first='2026-10-25T12:00:00'):
    """Showcase skill rows every 5 min per bot from `first` to `last` (inclusive), ISO Z timestamps."""
    t, end, out = _ts(first), _ts(last), []
    while t <= end:
        out += [TE.doc(t.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'gather', bot=b, pool='showcase') for b in bots]
        t += dt.timedelta(minutes=5)
    return out


def _ts(s):
    return dt.datetime.fromisoformat(s.replace('Z', '')).replace(tzinfo=dt.timezone.utc)


def _deploy_log(*rows):
    p = os.path.join(tempfile.mkdtemp(), 'deploy.jsonl')
    with open(p, 'w') as fh:
        for t, ev, why in rows:
            fh.write(json.dumps({'t': t, 'event': ev, 'why': why}) + '\n')
        fh.write('not json\n')
    return p


def _show(docs, log='/nonexistent/deploy.jsonl', now=SCNOW_SHOW):
    fake = TE.FakeES(docs)
    real = FS.EsEvents.load

    def load(stream='skill', **kw):
        kw.setdefault('now', now)
        return real(stream, **kw)
    FS.EsEvents.load = load
    try:
        return FS.showcase_line(now, client=fake, deploy_log=log)
    finally:
        FS.EsEvents.load = real


def t_showcase_head_ok_names_denominator_and_age():
    # positive control for every DOWN test below: the same query, on rows up to 13:55, finds both bots
    line = _show(_show_docs('2026-10-26T13:55:00'))
    assert line == 'showcase OK: 2 of 2 bots, last row 5 min ago', line


def t_showcase_head_tripwire_stop_is_down_with_reason():
    log = _deploy_log(('2026-10-25T18:13:44Z', 'stop-bots', 'owner 10-25: restart for zones'),
                      ('2026-10-25T18:20:00Z', 'activated', ''),
                      ('2026-10-25T19:37:09Z', 'stop-bots', TRIP_WHY))
    line = _show(_show_docs('2026-10-25T19:35:00'), log=log)
    assert line == ('!! SHOWCASE DOWN 18.4 h: tripwire stop 10-25 19:37Z "S5 G3 lid_unreach 1" -- '
                    'read /srv/showcase/ops/trip.log on 10.0.0.40'), line


def t_showcase_head_deliberate_stop_is_named_deliberate():
    log = _deploy_log(('2026-10-25T19:37:09Z', 'stop-bots', 'owner 10-25: trial chambers to bedrock'))
    line = _show(_show_docs('2026-10-25T19:35:00'), log=log)
    assert line.startswith('!! SHOWCASE DOWN 18.4 h: deliberate stop 10-25 19:37Z "owner 10-25: trial chambers'), line
    assert 'stopped on purpose' in line and 'tripwire' not in line, line


def t_showcase_head_old_stop_is_not_this_outage():
    # the only stop predates the newest row by hours: it did not cause this gap
    log = _deploy_log(('2026-10-25T13:00:00Z', 'stop-bots', TRIP_WHY))
    line = _show(_show_docs('2026-10-25T19:35:00'), log=log)
    assert line.startswith('!! SHOWCASE DOWN 18.4 h: last skill row 10-25 19:35Z, NO stop recorded'), line


def t_showcase_head_first_stop_wins_and_future_rows_are_unseen():
    # Codex P2 10-26: a --now replay must not see a later stop, and a stop issued while already down is not the cause
    log = _deploy_log(('2026-10-25T19:37:09Z', 'stop-bots', TRIP_WHY),
                      ('2026-10-25T22:00:00Z', 'stop-bots', 'operator: belt and braces'),
                      ('2026-10-26T15:00:00Z', 'stop-bots', 'operator maintenance'))
    line = _show(_show_docs('2026-10-25T19:35:00'), log=log)
    assert line.startswith('!! SHOWCASE DOWN 18.4 h: tripwire stop 10-25 19:37Z'), line
    log = _deploy_log(('2026-10-26T15:00:00Z', 'stop-bots', 'operator maintenance'))
    line = _show(_show_docs('2026-10-25T19:35:00'), log=log)
    assert 'NO stop recorded' in line, line


def t_showcase_head_without_deploy_log_says_where_to_look():
    line = _show(_show_docs('2026-10-25T19:35:00'))
    assert line.startswith('!! SHOWCASE DOWN 18.4 h: last skill row 10-25 19:35Z -- check trip.log'), line
    assert '10.0.0.40' in line, line


def t_showcase_head_threshold_is_30_min():
    assert _show(_show_docs('2026-10-26T13:31:00', first='2026-10-25T12:01:00')).startswith('showcase OK'), 'a 29-min gap is not down'
    line = _show(_show_docs('2026-10-26T13:30:00'))
    assert line.startswith('!! SHOWCASE DOWN 0.5 h'), line


def t_showcase_head_partial_names_absent_bot():
    docs = _show_docs('2026-10-26T13:55:00', bots=('show-Ada',)) + _show_docs('2026-10-26T10:00:00', bots=('show-Bo',))
    line = _show(docs)
    assert line.startswith('!! showcase PARTIAL: 1 of 2 bots') and 'absent show-Bo' in line, line


def t_showcase_head_empty_week_and_dead_es_never_raise():
    line = _show([TE.doc('2026-10-01T00:00:00.000Z', 'gather', bot='show-Ada')])
    assert line.startswith('!! SHOWCASE DOWN >= 7 d'), line

    def dead(method, path, body=None, timeout=120):
        raise RuntimeError('refused')
    line = FS.showcase_line(SCNOW_SHOW, client=dead)
    assert line.startswith('!! showcase: UNREADABLE (RuntimeError'), line


def t_showcase_head_is_in_the_header():
    out = io.StringIO()
    rep = run(fleet_docs(), stdout=out)          # the fake answers every index, so the fleet docs read as the showcase
    head = out.getvalue().splitlines()[:8]
    assert rep.get('showcase_head', '').startswith('showcase OK: 2 of 2 bots'), rep.get('showcase_head')
    assert rep['showcase_head'] in head, head
    out = io.StringIO()
    rep = run(fleet_docs(stop_at_hour=12), stdout=out)   # Bravo's rows end 11:50; Alpha keeps one 19:53 row
    head = out.getvalue().splitlines()[:8]
    assert any(x.startswith('!! showcase PARTIAL: 1 of 2 bots') and 'absent self-isolated-a-Bravo' in x for x in head), head
LNOW = dt.datetime(2026, 10, 22, 12, 0, tzinfo=dt.timezone.utc)


def _llhb(**kw):
    """A heartbeat.json as scripts/learnloop/nightly.py --tick writes it (healthy at LNOW); kw overrides."""
    d = tempfile.mkdtemp(); p = os.path.join(d, 'heartbeat.json')
    if kw.get('_absent'):
        return p
    newest = {'triples': 151549, 'llm_rows': 160559, 'model_rows': 151549, 'bots': 80, 'roster': 80,
              'labels': {'good': 32726}, 'controls_ok': True, 'controls_failed': [], 'at': '2026-10-22T01:52:00Z'}
    hb = {'at': '2026-10-22T01:55:00Z', 'status': 'ok', 'error': None, 'newest_archived_day': '2026-10-21',
          'archived_days': 14, 'newest': newest, 'this_run': [{'day': '2026-10-21', 'archived': True, 'controls_ok': True}],
          'pending': [], 'at_risk': [], 'unresolved': [], 'nas': {'last_good': '2026-10-22T01:54:00Z 2026-10-21', 'sealed': 14,
                                               'newest': '2026-10-21'}}
    hb.update(kw)
    with open(p, 'w') as fh:
        fh.write(kw['_raw'] if '_raw' in kw else json.dumps(hb))
    return p


def t_learnloop_healthy_line_names_its_denominators():
    line = FS.learnloop_line(LNOW, path=_llhb())
    assert line.startswith('learning-loop archive (M1): ok, run 10 h ago, newest 2026-10-21: 151,549 triples of 160,559 '
                           'decision rows, 80/80 bots; 14 day(s) sealed on the NAS; pending none'), line


def t_learnloop_missing_heartbeat_is_an_alarm_not_silence():
    line = FS.learnloop_line(LNOW, path=_llhb(_absent=True))
    assert line.startswith('!! learning-loop archive (M1): NO HEARTBEAT (FileNotFoundError)'), line


def t_learnloop_stale_run_is_an_alarm():
    line = FS.learnloop_line(dt.datetime(2026, 10, 23, 4, 0, tzinfo=dt.timezone.utc), path=_llhb())
    assert line.startswith('!! learning-loop archive (M1): STALE: last run 26 h ago'), line
    assert FS.learnloop_line(dt.datetime(2026, 10, 23, 3, 0, tzinfo=dt.timezone.utc), path=_llhb()).startswith('learning-loop archive (M1): ok')


def t_learnloop_every_bad_status_is_an_alarm():
    for st, want in (('error', 'ERROR: boom'), ('archive_failed', 'ARCHIVE FAILED'), ('at_risk', 'RAW AT RISK'),
                     ('behind', 'BEHIND'), ('control_failed', 'CONTROL FAILED'), ('empty', 'NOTHING ARCHIVED'),
                     ('weird', "status 'weird'")):
        line = FS.learnloop_line(LNOW, path=_llhb(status=st, error='boom' if st == 'error' else None))
        assert line.startswith('!! learning-loop archive (M1): ') and want in line, (st, line)


def t_learnloop_behind_when_the_due_day_is_missing():
    """At 10-23 04:20Z day 10-22 is due (ready 10-23 01:15Z + 3 h grace); a heartbeat still on 10-21 is BEHIND even
    when its own status says ok."""
    line = FS.learnloop_line(dt.datetime(2026, 10, 23, 4, 20, tzinfo=dt.timezone.utc),
                             path=_llhb(at='2026-10-23T01:50:00Z'))
    assert line.startswith('!! ') and 'newest archived day 2026-10-21, 2026-10-22 is due' in line, line
    line = FS.learnloop_line(dt.datetime(2026, 10, 23, 4, 10, tzinfo=dt.timezone.utc),
                             path=_llhb(at='2026-10-23T01:50:00Z'))
    assert line.startswith('learning-loop archive (M1): ok'), line


def t_learnloop_failed_controls_and_unarchived_days_are_alarms():
    rec = {'triples': 1, 'llm_rows': 2, 'bots': 79, 'roster': 80, 'controls_ok': False, 'controls_failed': ['es']}
    line = FS.learnloop_line(LNOW, path=_llhb(newest=rec))
    assert line.startswith('!! ') and "failed controls ['es']" in line, line
    line = FS.learnloop_line(LNOW, path=_llhb(this_run=[{'day': '2026-10-21', 'archived': False, 'archive_error': 'put x: FAIL'}]))
    assert line.startswith('!! ') and '2026-10-21 not archived (put x: FAIL)' in line, line
    line = FS.learnloop_line(LNOW, path=_llhb(at_risk=[{'day': '2026-10-09', 'expires': '2026-10-24'}]))
    assert line.startswith('!! ') and 'raw rotates out before it is archived: 2026-10-09 (expires 2026-10-24)' in line, line


def t_learnloop_older_unresolved_days_are_alarms():
    """Codex r1 P2-7: a failed OLDER day stays in the header while the newest is healthy, until acknowledged."""
    u = [{'day': '2026-10-09', 'why': "controls failed ['es']"}, {'day': '2026-10-12', 'why': 'raw members not proven'}]
    line = FS.learnloop_line(LNOW, path=_llhb(unresolved=u))
    assert line.startswith('!! ') and "unresolved 2026-10-09: controls failed ['es']" in line and 'unresolved 2026-10-12' in line, line
    line = FS.learnloop_line(LNOW, path=_llhb(unresolved=[{'day': 'd%d' % i, 'why': 'x'} for i in range(7)]))
    assert '+3 more unresolved' in line, line


def t_learnloop_nas_disagreement_is_an_alarm():
    line = FS.learnloop_line(LNOW, path=_llhb(nas={'sealed': 13, 'newest': '2026-10-20'}))
    assert line.startswith('!! ') and 'NAS says newest 2026-10-20 (13 sealed)' in line, line
    line = FS.learnloop_line(LNOW, path=_llhb(nas={}))
    assert line.startswith('!! ') and 'NAS says newest None' in line, line


def t_learnloop_malformed_heartbeat_never_raises():
    for raw in ('{"at": "2026-10-22T01:55:00"}', '{"at": "2026-10-22T01:55:00Z", "newest": 5}', '[]', '{"at": 3}',
                '{"at": "2026-10-22T01:55:00Z", "this_run": [5]}', '{"at": "2026-10-22T01:55:00Z", "at_risk": [1]}'):
        line = FS.learnloop_line(LNOW, path=_llhb(_raw=raw))
        assert line.startswith('!! learning-loop archive (M1): '), (raw, line)


def t_learnloop_line_is_in_the_header():
    out = io.StringIO()
    rep = run(fleet_docs(), stdout=out)
    head = out.getvalue().splitlines()[:8]
    assert 'learnloop' in rep and any(x.startswith(('learning-loop archive (M1)', '!! learning-loop archive (M1)'))
                                      for x in head), head


def _lava_fixture(reader=False, retired=None, tool=True, modules=True):
    import tempfile
    d = tempfile.mkdtemp()
    home, tree = os.path.join(d, 'lavasight'), os.path.join(d, 'src')
    os.makedirs(os.path.join(home, 'app')); os.makedirs(tree)
    if tool:
        open(os.path.join(home, 'app', 'lavamap_publish.py'), 'w').write('print("lavamap OK: fixture")\n')
    if retired is not None:
        open(os.path.join(home, 'RETIRED'), 'w').write(retired)
    if modules:
        open(os.path.join(tree, 'index.mjs'), 'w').write('import x from "./skills.mjs"\n')
        if reader:
            open(os.path.join(tree, 'lavasight.mjs'), 'w').write("export const LAVAMAP_FILE = 'lava-map.json'\n")
    return home, tree


def t_lavamap_no_consumer_is_an_alarm_not_ok():
    """audit 10-31: the publisher ran hourly for a feed nothing on the fleet read, and the line said 'lavamap OK'."""
    home, tree = _lava_fixture()
    line = FS.lavamap_line(None, home=home, tree=tree)
    assert line.startswith('!! lavamap: the feed has NO CONSUMER') and '1 modules' in line, line


def t_lavamap_retired_says_so():
    home, tree = _lava_fixture(tool=False, retired='retired 10-31: lavasight-01 INCONCLUSIVE; data kept\n')
    line = FS.lavamap_line(None, home=home, tree=tree)
    assert line.startswith('lavamap RETIRED: no consumer') and 'INCONCLUSIVE' in line, line


def t_lavamap_with_a_reader_runs_the_check():
    home, tree = _lava_fixture(reader=True)
    line = FS.lavamap_line(None, home=home, tree=tree)
    assert line.startswith('lavamap OK: fixture') and 'lavasight.mjs' in line, line


def t_lavamap_unreadable_tree_is_no_verdict():
    home, tree = _lava_fixture(modules=False)
    line = FS.lavamap_line(None, home=home, tree=tree)
    assert line.startswith('!! lavamap: cannot tell'), line
    home, _ = _lava_fixture(tool=False)
    assert FS.lavamap_line(None, home=home, tree=tree) is None


TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]

if __name__ == '__main__':
    for n, f in TESTS:
        TE.check(n[2:], f)
    print(f'{TE.PASS} passed, {TE.FAIL} failed')
    sys.exit(1 if TE.FAIL else 0)
