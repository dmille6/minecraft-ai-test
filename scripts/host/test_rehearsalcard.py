#!/usr/bin/env python3
"""Tests for rehearsalcard.py: python3 -B scripts/host/test_rehearsalcard.py

Behaviour on rows shaped like the bots' own (skill rows stamped at their start with duration_ms, `_` rows at their end,
llm rows with latency_ms). Every zero is tested beside its positive control. Each MUTANT (one changed line, its anchor
asserted present and unique) re-runs the check it should break against the mutated module and must FAIL there."""
import datetime as dt
import importlib.util
import json
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, 'rehearsalcard.py')
UTC = dt.timezone.utc
FAILS = []
T0 = dt.datetime(2026, 11, 10, 0, 0, 0, tzinfo=UTC)   # in the past: stream_rows skips a file older than the window
HOME = (366, -34)


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


R = load(SRC, 'rehearsalcard_under_test')


def check(name, ok):
    print(('  PASS  ' if ok else '  FAIL  ') + name)
    if not ok:
        FAILS.append(name)


def at(h):
    return T0 + dt.timedelta(hours=h)


def srow(t, name, bot, dur=0, detail='', pos=None):
    x, z = pos if pos else (HOME[0] + 3, HOME[1] + 2)
    return (t, {'@timestamp': t.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'skill': {'name': name, 'duration_ms': dur, 'detail': detail},
                'bot': {'name': bot, 'pos': {'x': x, 'y': 72, 'z': z}}})


def lrow(t, bot, lat=2000):
    return (t, {'@timestamp': t.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'llm': {'latency_ms': lat, 'completion_tokens': 40}, 'bot': {'name': bot}})


def manifest(started=True, assist=(), count=2):
    return {'run': 'rehearsal-0', 'started_at': T0.strftime('%Y-%m-%dT%H:%M:%SZ') if started else None,
            'world': {'site': {'home_xz': list(HOME)}}, 'bots': {'count': count, 'roster': [f'rh0-{n}' for n in ('Alpha', 'Bravo')[:count]]},
            'assistance_log': list(assist)}


def working_day(hours, bots=('rh0-Alpha', 'rh0-Bravo'), move=True, extra=()):
    """Each bot gathers 40 of every 60 minutes (productive), asks the model once an hour, and logs a position every
    2 minutes that moves (or does not)."""
    sk, ll = {b: [] for b in bots}, {b: [] for b in bots}
    for b in bots:
        for h in range(hours):
            sk[b].append(srow(at(h) + dt.timedelta(minutes=1), 'gather', b, dur=40 * 60 * 1000))
            ll[b].append(lrow(at(h) + dt.timedelta(minutes=50), b))
            for m in range(0, 60, 2):
                p = (HOME[0] + (h * 7 + m) % 40, HOME[1] + (m % 20)) if move else (HOME[0] + 1, HOME[1] + 1)
                sk[b].append(srow(at(h) + dt.timedelta(minutes=m, seconds=30), '_tick', b, pos=p))
    for b, row in extra:
        sk[b].append(row)
    return sk, ll


def state(c, name):
    return next(x for x in c['criteria'] if x['name'] == name)


def run_checks(M, prefix=''):
    """-> {check name: bool}. The mutant runner calls this against a mutated module."""
    out = {}
    # not started: everything that needs rows is unread; the assistance log is still judged
    c = M.card(manifest(started=False), {}, {}, at(1))
    out['not started: 8 criteria unread, admin_edits pass'] = (sum(x['state'] == 'unread' for x in c['criteria']) == 8
                                                             and state(c, 'admin_edits')['state'] == 'pass')
    c = M.card(manifest(started=False, assist=[{'what': 'cleared a block'}]), {}, {}, at(1))
    out['one assistance entry fails admin_edits'] = state(c, 'admin_edits')['state'] == 'fail'

    # started, NO rows: a zero is not a pass (the positive control is missing)
    c = M.card(manifest(), {}, {}, at(6))
    out['no rows: deaths is unread, not "0 deaths"'] = state(c, 'deaths')['state'] == 'unread'
    out['no rows: working_share, reached_site, stuck_bots unread'] = all(
        state(c, n)['state'] == 'unread' for n in ('working_share', 'reached_site', 'stuck_bots', 'town_core', 'storage'))

    # a healthy 30 hours: the shop at 5 h, a house at 20 h, a storehouse at 22 h
    extra = [('rh0-Alpha', srow(at(5), '_structure_complete', 'rh0-Alpha', detail='project=shop cells=120')),
             ('rh0-Bravo', srow(at(20), '_structure_complete', 'rh0-Bravo', detail='project=house1 cells=90')),
             ('rh0-Bravo', srow(at(22), '_structure_complete', 'rh0-Bravo', detail='project=storehouse cells=200'))]
    sk, ll = working_day(30, extra=extra)
    c = M.card(manifest(), sk, ll, at(30))
    st = {x['name']: x['state'] for x in c['criteria']}
    out['healthy run: site, core, houses, storage, working share, deaths, stuck bots, admin all pass'] = all(
        st[n] == 'pass' for n in ('reached_site', 'town_core', 'roofed_houses', 'storage', 'working_share', 'deaths', 'stuck_bots', 'admin_edits'))
    out['healthy run: the stuck goal has no reader and says so'] = st['longest_stuck_goal'] == 'unread'
    out['healthy run: the control line carries rows, bots and hours'] = ('2 of 2 bots' in c['control'] and 'bot-hours observed' in c['control'])
    out['healthy run: 0 deaths is printed with its denominator'] = '0 deaths in' in state(c, 'deaths')['measured'] and 'rows' in state(c, 'deaths')['measured']
    ws = state(c, 'working_share')['measured']
    out['working share is about two thirds (40 of 60 minutes gathering)'] = ws.startswith('66.') or ws.startswith('67.')

    # the same run with an unread log file is blind
    c = M.card(manifest(), sk, ll, at(30), errors=['skill-rh0-Alpha.jsonl (OSError)'])
    out['an unread log file makes deaths unread'] = state(c, 'deaths')['state'] == 'unread' and 'UNREAD FILES' in c['control']

    # deaths over the rate
    sk2, ll2 = working_day(10, extra=[('rh0-Alpha', srow(at(3), '_death', 'rh0-Alpha'))])
    c = M.card(manifest(), sk2, ll2, at(10))
    out['1 death in about 20 bot-hours fails (5 per 100)'] = state(c, 'deaths')['state'] == 'fail'

    # a bot that never reaches the site
    sk3, ll3 = working_day(4)
    sk3['rh0-Bravo'] = [srow(t, r['skill']['name'], 'rh0-Bravo', dur=r['skill']['duration_ms'], pos=(HOME[0] + 300, HOME[1])) for t, r in sk3['rh0-Bravo']]
    c = M.card(manifest(), sk3, ll3, at(4))
    out['one bot 300 blocks away fails reached_site (1 of 2)'] = state(c, 'reached_site')['state'] == 'fail' and '1 of 2' in state(c, 'reached_site')['measured']

    # a bot standing in one box for whole hours
    sk4, ll4 = working_day(5, move=False)
    c = M.card(manifest(), sk4, ll4, at(5))
    out['bots inside a 2-block box for whole hours fail stuck_bots'] = state(c, 'stuck_bots')['state'] == 'fail'

    # the core late, one house at 50 h
    late = [('rh0-Alpha', srow(at(13), '_structure_complete', 'rh0-Alpha', detail='project=shop')),
            ('rh0-Alpha', srow(at(30), '_structure_complete', 'rh0-Alpha', detail='project=cottage1'))]
    sk5, ll5 = working_day(50, extra=late)
    c = M.card(manifest(), sk5, ll5, at(50))
    out['the shop at 13 h fails town_core (12 h)'] = state(c, 'town_core')['state'] == 'fail'
    out['one house at 50 h fails roofed_houses (needs 2)'] = state(c, 'roofed_houses')['state'] == 'fail'
    out['no storehouse fails storage'] = state(c, 'storage')['state'] == 'fail'

    # mostly idle: the working share fails
    sk6 = {'rh0-Alpha': [srow(at(h) + dt.timedelta(minutes=m), '_tick', 'rh0-Alpha', pos=(HOME[0] + m, HOME[1] + h)) for h in range(6) for m in range(0, 60, 3)]}
    c = M.card(manifest(count=1), sk6, {}, at(6))
    out['a bot that only ticks fails working_share'] = state(c, 'working_share')['state'] == 'fail'
    return {prefix + k: v for k, v in out.items()}


def mutant(name, old, new, must_break):
    src = open(SRC).read()
    assert src.count(old) == 1, f'ANCHOR MISSING OR NOT UNIQUE: {old!r}'
    with tempfile.NamedTemporaryFile('w', suffix='.py', dir=HERE, prefix='_mutant_rehearsalcard_', delete=False) as f:
        f.write(src.replace(old, new))
        p = f.name
    try:
        M = load(p, 'rehearsalcard_mutant')
        res = run_checks(M)
    finally:
        os.unlink(p)
    broke = [k for k in must_break if res.get(k) is False]
    ok = len(broke) == len(must_break)
    print(('  PASS  MUTANT KILLED: ' if ok else '  FAIL  MUTANT SURVIVED: ') + name)
    if not ok:
        FAILS.append('mutant ' + name)


def reader_check():
    """the file reader: rows written the way the bots write them come back through lib/telemetry.stream_rows"""
    with tempfile.TemporaryDirectory() as d:
        bot = 'rh0-Alpha'
        os.makedirs(os.path.join(d, bot))
        os.makedirs(os.path.join(d, '_pool-showcase'))          # a pool state directory is not a bot
        with open(os.path.join(d, bot, f'skill-{bot}.jsonl'), 'w') as f:
            for h in range(3):
                t = at(h) + dt.timedelta(minutes=5)
                f.write(json.dumps({'@timestamp': t.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'skill': {'name': 'gather', 'duration_ms': 600000},
                                    'bot': {'name': bot, 'pos': {'x': HOME[0], 'y': 72, 'z': HOME[1]}}}, separators=(',', ':')) + '\n')
        with open(os.path.join(d, bot, f'llm-{bot}.jsonl'), 'w') as f:
            t = at(1)
            f.write(json.dumps({'@timestamp': t.strftime('%Y-%m-%dT%H:%M:%S.000Z'), 'llm': {'latency_ms': 1500, 'completion_tokens': 12}}, separators=(',', ':')) + '\n')
        sk, ll, errors = R.read(d, T0, at(3))
        check('reader: 3 skill rows and 1 llm row for the one bot, no pool directory, no errors',
              list(sk) == [bot] and len(sk[bot]) == 3 and len(ll[bot]) == 1 and errors == [])
        c = R.card(manifest(count=1), sk, ll, at(3))
        check('reader -> card: the control line counts those 3 rows', '3 skill rows from 1 of 1 bots' in c['control'])
        sk, ll, errors = R.read(os.path.join(d, 'missing'), T0, at(3))
        check('reader: a missing log root is an unread file, not an empty result', errors and 'missing' in errors[0])
        txt = R.render(c)
        check('render: the header, the control line and the totals line', txt.startswith('REHEARSAL CARD rehearsal-0') and 'control:' in txt and 'unread never counts as a pass' in txt)


def main():
    for k, v in run_checks(R).items():
        check(k, v)
    reader_check()
    mutant('a zero with no rows passes (the positive control dropped)',
           "blind = None if nrows and not errors else ('a log file could not be read' if errors else 'no rows in the window')",
           "blind = None",
           ['an unread log file makes deaths unread'])
    mutant('the death rate is never over the line',
           "rate < 1.0))", "rate < 1000.0))", ['1 death in about 20 bot-hours fails (5 per 100)'])
    mutant('the core has no deadline',
           "(core_t - start).total_seconds() <= 12 * 3600))", "(core_t - start).total_seconds() <= 1200 * 3600))",
           ['the shop at 13 h fails town_core (12 h)'])
    mutant('any working share passes',
           "sh['productive'] > 0.5))", "sh['productive'] > -1))", ['a bot that only ticks fails working_share'])
    mutant('a far bot counts as at the site',
           "<= SITE_R)", "<= SITE_R * 100)", ['one bot 300 blocks away fails reached_site (1 of 2)'])
    mutant('one house is always enough',
           "need = 2 if hours >= 48 else 1", "need = 1", ['one house at 50 h fails roofed_houses (needs 2)'])
    mutant('assistance never fails the run',
           "add(FL.crit('admin_edits', f'{len(assist)} entries in the assistance log', len(assist) == 0))\n        return out",
           "add(FL.crit('admin_edits', f'{len(assist)} entries in the assistance log', True))\n        return out",
           ['one assistance entry fails admin_edits'])
    n = 'FAIL (%d failure(s)): %s' % (len(FAILS), '; '.join(FAILS)) if FAILS else 'PASS (0 failure(s))'
    print('rehearsalcard tests: ' + n)
    return 1 if FAILS else 0


if __name__ == '__main__':
    sys.exit(main())
