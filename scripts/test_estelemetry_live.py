#!/usr/bin/env python3
"""OPT-IN live smoke test of lib/estelemetry.py against the real cluster (run on 10.0.0.31).

    MCAI_ES_LIVE=1 python3 scripts/test_estelemetry_live.py

Without MCAI_ES_LIVE=1 it prints SKIP and exits 0 (it needs the owner's read-only key file).
Reproduces numbers from docs/reports/es-completeness-2026-10-14.md, so a library that drifted
from the reconciled answer fails here:
  10-13 skill = 1,306,930 docs; 10-13 llm = 162,828 docs (ES side of the reconciliation).
Plus positive and negative controls on the live data.
"""
import datetime as dt
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

if os.environ.get('MCAI_ES_LIVE') != '1':
    print('SKIP  live ES smoke test (set MCAI_ES_LIVE=1 on 10.0.0.31)')
    sys.exit(0)

from lib.estelemetry import EsEvents, ReplayWindow, ZeroLooksWrong  # noqa: E402

PASS = FAIL = 0
D13 = dict(since='2026-10-13T00:00:00Z', until='2026-10-14T00:00:00Z')


def check(name, fn):
    global PASS, FAIL
    try:
        fn()
        print(f'  PASS  {name}')
        PASS += 1
    except Exception as e:
        print(f'  FAIL  {name}: {type(e).__name__}: {e}')
        traceback.print_exc(limit=2)
        FAIL += 1


def t_reproduces_completeness_numbers():
    assert EsEvents.load('skill', **D13).total() == 1_306_930
    assert EsEvents.load('llm', **D13).total() == 162_828


def t_by_bot_sums_to_total():
    ev = EsEvents.load('skill', **D13)
    bb = ev.by_bot()
    assert sum(bb.values()) == ev.total() and len(bb) == 80, (len(bb), sum(bb.values()))


def t_negative_controls():
    try:
        EsEvents.load('skill', bots=['no-such-bot-zz'], **D13).count('gather')
    except ZeroLooksWrong:
        pass
    else:
        raise AssertionError('nonexistent bot did not raise')
    try:
        EsEvents.load('skill', **D13).count('gahter')
    except ZeroLooksWrong as e:
        assert 'gather' in str(e)
    else:
        raise AssertionError('typo did not raise')
    try:
        EsEvents.load('skill', since='2026-10-06T00:00:00Z', until='2026-10-09T00:00:00Z')
    except ReplayWindow:
        pass
    else:
        raise AssertionError('10-07 window was not refused')


def t_positive_controls():
    ev = EsEvents.load('skill', **D13)
    deaths = ev.count('_death')
    assert deaths > 0
    assert sum(ev.terms('skill.fail_class', '_death').values()) == deaths
    assert ev.count('gather', status='success') > 0
    # one UTC day holds the 00:00:0x losses of the night before AND the 23:57-23:59 of its own
    assert any('crosses 2 log rotation' in c for c in deaths.caveats), deaths.caveats
    noon = EsEvents.load('skill', since='2026-10-13T01:00:00Z', until='2026-10-13T23:00:00Z')
    assert not any('log rotation' in c for c in noon.caveats), noon.caveats


def t_detail_and_coverage_live():
    ev = EsEvents.load('skill', **D13)
    deaths = ev.count('_death')
    drowned = ev.count('_death', detail_contains='drowned')
    assert 0 < drowned <= deaths, (drowned, deaths)
    assert any('TOKEN phrase' in c for c in drowned.caveats)
    cov = ev.coverage()
    assert cov['empty_hours'] == [] and 1900 <= cov['bot_hours'] <= 1920, cov
    three = EsEvents.load('skill', since='2026-10-13T10:20:00Z', until='2026-10-13T13:20:00Z').coverage()
    assert 230 <= three['bot_hours'] <= 240, three        # 80 bots x 3 h, not 80 x 4 hour buckets
    try:
        ev.terms('exp.poool', '_death')
    except ZeroLooksWrong:
        pass
    else:
        raise AssertionError('misspelt grouping field did not raise')


def t_rows_match_count():
    ev = EsEvents.load('skill', since='2026-10-13T10:00:00Z', until='2026-10-13T11:00:00Z', bots=['board-a-Alpha'])
    rows = list(ev.rows(fields=['@timestamp', 'skill.name']))
    assert len(rows) == ev.total() > 0
    assert rows == sorted(rows, key=lambda r: r['@timestamp'])


def t_latest_inventory_live():
    now = dt.datetime.now(dt.timezone.utc)
    ev = EsEvents.load('skill', since=now - dt.timedelta(hours=3), until=now - dt.timedelta(minutes=5))
    lat = ev.latest(require='bot.pos.x', fields=['bot.inventory', 'exp.pool'])   # the marker fleetstatus uses
    assert len(lat) >= 60, len(lat)
    assert all(isinstance(v['bot']['inventory'], dict) for v in lat.values())


def t_llm_stream():
    ev = EsEvents.load('llm', **D13)
    assert ev.count('idle') > 0
    try:
        ev.count('idel')
    except ZeroLooksWrong as e:
        assert 'idle' in str(e)
    else:
        raise AssertionError('llm typo did not raise')


if __name__ == '__main__':
    for n, f in sorted(globals().items()):
        if n.startswith('t_') and callable(f):
            check(n[2:], f)
    print(f'{PASS} passed, {FAIL} failed')
    sys.exit(1 if FAIL else 0)
