#!/usr/bin/env python3
"""Behaviour tests for hazardmap.py and serve.py, with BLIND-INPUT MUTANTS and CODE MUTANTS.

    python3 -B scripts/host/hazardmap/test_hazardmap.py        (exit 1 on any failure)

THE FIXTURE FLEET. A fake Elasticsearch (FakeEs: the EsEvents surface fetch_day() uses -- load, total, count with a token
detail filter, rows, histogram) holds ES-shaped rows for three worlds: hive-a and board-a on seed S1, and hive-c, which was on
S1 until a reseed and is on S2 after it. The rows plant a hand-worked answer: a lava cave two worlds died in, guard rows that
named its lava cells, a drowning, a stalagmite death, a fall, a suffocation, a 40-min wet maroon spell (a water pit), a 40-min
DRY one (excluded), a 50-min no-air-route spell (a ceiling trap), an entombed spell and give-ups, and a hive-c death on each
side of its reseed. fetch_day() -> build() -> value() must read it back exactly.

THE FIXTURE WORLDS. Real Anvil region files are WRITTEN here (an NBT + region writer below) with a lava pool, a board-d water
pit, a board-a ceiling trap under copper, an open drop, dripstone and a seeded bedrock floor; verify() must answer every probe
and the bedrock fingerprint must agree within a seed and not across seeds.

BLIND-INPUT MUTANTS. Each changes the INPUT the way a code change on the bots would -- a renamed death kind, a renamed
fail_class, a reworded death message, a reformatted guard row, a dropped position, a new world, a renamed danger block, no
validated day, a wrong verify file -- and the build must RAISE Blind for its named reason. A smaller map is a failure.

CODE MUTANTS. Each breaks one decision and must fail the case written against it. Every anchor must occur exactly once in the
source AND outside comments (tokenize), so an anchor never matches the comment that explains it, and a mutant that does not
apply is a FAILURE, never a kill (CLAUDE.md).
"""
import contextlib
import datetime as dt
import gzip
import io
import json
import os
import random
import re
import shutil
import struct
import sys
import tempfile
import tokenize
import types
import zlib

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = {'hm': os.path.join(HERE, 'hazardmap.py'), 'sv': os.path.join(HERE, 'serve.py')}


def load(name, text=None):
    path = SRC[name]
    mod = types.ModuleType('mut_' + name)
    mod.__file__ = path
    exec(compile(text if text is not None else open(path).read(), path, 'exec'), mod.__dict__)
    if name == 'hm':
        mod.VALIDATED_SINCE = '2026-10-14T00:00:00Z'      # the fixture fleet's validated window: its four contiguous days
    return mod


# ------------------------------------------------------------------ the fake Elasticsearch
def T(s):
    return int(dt.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)


def isoz(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')


class _Docs:
    """The fake index: rows sorted by time, per kind, so a window is a bisect (the fixture holds ~6k rows)."""
    def __set_name__(self, owner, name):
        self.name = name

    def __get__(self, obj, owner):
        return owner.__dict__.get('_docs', [])

    def __set__(self, obj, v):
        raise AttributeError


class _FakeMeta(type):
    def __setattr__(cls, name, value):
        if name == 'DOCS':
            import bisect  # noqa: F401
            rows = sorted(value, key=lambda r: T(r['@timestamp']))
            type.__setattr__(cls, '_docs', rows)
            by = {}
            for r in rows:
                by.setdefault(r['skill']['name'], []).append(r)
            type.__setattr__(cls, '_by_kind', {k: ([T(r['@timestamp']) for r in v], v) for k, v in by.items()})
            type.__setattr__(cls, '_all', ([T(r['@timestamp']) for r in rows], rows))
            return
        type.__setattr__(cls, name, value)


class FakeEs(metaclass=_FakeMeta):
    """Just the EsEvents surface fetch_day() and recount() use, over a list of ES-shaped rows."""
    _docs, _by_kind, _all = [], {}, ([], [])

    def __init__(self, since, until):
        self.since, self.until = since, until
        self.caveats = []

    @classmethod
    def load(cls, stream, since=None, until=None, **kw):
        return cls(T(since), T(until))

    def _slice(self, kind):
        import bisect
        ts, rows = self._all if kind is None else self._by_kind.get(kind, ([], []))
        return rows[bisect.bisect_left(ts, self.since):bisect.bisect_left(ts, self.until)]

    def total(self):
        return len(self._slice(None))

    def _match(self, kind, detail_contains=None):
        out = self._slice(kind)
        if detail_contains:
            out = [r for r in out if re.search(r'\b%s\b' % re.escape(detail_contains), r['skill'].get('detail') or '')]
        return out

    def count(self, kind, allow_zero=False, detail_contains=None):
        return len(self._match(kind, detail_contains))

    def rows(self, kind, fields=None, max_rows=0, detail_contains=None, allow_zero=False):
        return iter(self._match(kind, detail_contains))

    def histogram(self, kind=None, interval='1h', split=None, allow_zero=False):
        step = {'10m': 600_000, '1h': 3_600_000}[interval]
        out = {}
        for r in self._match(kind):
            k = isoz(T(r['@timestamp']) // step * step)
            out.setdefault(k, {}).setdefault(r['bot']['name'], 0)
            out[k][r['bot']['name']] += 1
        return out


def site_rows(docs):
    """The `_death_site_recorded` row each death writes in the same millisecond (the death-position control's input)."""
    out = []
    for r in docs:
        if r['skill']['name'] == '_death' and r['bot'].get('pos'):
            p = r['bot']['pos']
            out.append(row(r['@timestamp'], r['bot']['name'], '_death_site_recorded', 'death:%s x1 at %d,%d,%d (2 sites on file)'
                           % (r['skill'].get('fail_class'), round(p['x']), round(p['y']), round(p['z'])), (p['x'], p['y'], p['z'])))
    return docs + out


def row(t, bot, kind, detail='', pos=(0.5, 64, 0.5), fail_class=None):
    t = int(t) if isinstance(t, float) else t
    r = {'@timestamp': isoz(t) if isinstance(t, int) else t, 'bot': {'name': bot}, 'skill': {'name': kind, 'detail': detail}}
    if pos is not None:
        r['bot']['pos'] = {'x': pos[0], 'y': pos[1], 'z': pos[2]}
    if fail_class is not None:
        r['skill']['fail_class'] = fail_class
    return r


D0 = T('2026-10-14T00:00:00Z')          # fixture days 10-14 .. 10-17 (validated); history day 2026-09-10
NOW = T('2026-10-18T00:00:00Z') + 2 * 3_600_000
M = 60_000


def fleet_docs():
    """The planted answer. Times are minutes after D0 unless stated."""
    d = []
    L = lambda m: D0 + m * M
    # background: every bot speaks every 10 min for 4 days (positive control rows; bot-hours)
    for bot in ('hive-a-Alpha', 'board-a-Bravo', 'hive-c-Comet'):
        for m in range(0, 4 * 1440 + 110, 10):          # through 10-18 01:50Z: today's partial day is not void
            d.append(row(L(m), bot, 'goto', 'moved', (300.5, 70, 300.5)))
    # A lava cave at ~(336,36,204): board-a dies there on day 1, hive-a on day 3 (the value match), hive-a's guard named it
    d.append(row(L(100), 'board-a-Bravo', '_death', 'tried to swim in lava; idle at the moment of death | x', (336.4, 36, 204.2), 'fire'))
    for k in range(6):
        d.append(row(L(2000 + 15 * k), 'hive-a-Alpha', '_lava_corridor',
                     'lava_corridor: lava beside at %d,36,%d after 4 samples; the leg is refused' % (337 + k % 2, 205), (334.5, 37, 203.5)))
    d.append(row(L(2100), 'hive-a-Alpha', '_explore_blind_step_refused', 'blind_step: lava below at 338,35,206: the fallback walk is refused', (336.5, 37, 206.5)))
    d.append(row(L(2101), 'hive-a-Alpha', '_explore_blind_step_refused', 'blind_step: drop of 6 ahead (limit 5) at 1,2,3: the fallback walk is refused', (336.5, 37, 206.5)))
    d.append(row(L(2102), 'hive-a-Alpha', '_reflex_danger_block', 'lava', (336.3, 36.2, 204.6)))
    d.append(row(L(2103), 'hive-a-Alpha', '_reflex_danger_block', 'cave_air', (336.3, 37.0, 204.6)))
    d.append(row(L(3000), 'hive-a-Alpha', '_death', 'tried to swim in lava after falling 6 blocks; idle | y', (336.7, 36, 205.1), 'fire'))
    # board-a dies there AGAIN: known from its own world (board-a@100) AND from another (hive-a@3000)
    d.append(row(L(4500), 'board-a-Bravo', '_death', 'tried to swim in lava; idle', (336.7, 36, 205.5), 'fire'))
    # a DIFFERENT-KIND death in another world at the lava cave, > 24 h after board-a's lava death: never a same-kind match
    d.append(row(L(3100), 'hive-a-Alpha', '_death', 'drowned; idle', (336.5, 36, 204.5), 'drowning'))
    # the own-world lag pair at a dripstone site: board-a dies, then hive-a twice (25 h and 26 h later); hive-a's second
    # death has an OWN-world prior 1 h old, so it is known from another world but NOT beyond per-world memory
    d.append(row(L(110), 'board-a-Bravo', '_death', 'was impaled on a stalagmite after falling 4 blocks', (600.5, 10, 600.5), 'other'))
    d.append(row(L(1600), 'hive-a-Alpha', '_death', 'was impaled on a stalagmite after falling 4 blocks', (600.5, 10, 600.5), 'other'))
    d.append(row(L(1660), 'hive-a-Alpha', '_death', 'was impaled on a stalagmite after falling 4 blocks', (600.5, 10, 600.5), 'other'))
    # 4,000 good corridor rows of history (10-14) and 60 on the newest closed day (10-17): the recent-parse dilution test
    for k in range(4000):
        d.append(row(L(10 + k * 0.3), 'board-a-Bravo', '_lava_corridor', 'lava_corridor: lava below at 7000,60,7000 after 3 samples; the leg is refused', (7000.5, 61, 7000.5)))
    for k in range(60):
        d.append(row(L(4400 + k), 'board-a-Bravo', '_lava_corridor', 'lava_corridor: lava below at 7100,60,7100 after 3 samples; the leg is refused', (7100.5, 61, 7100.5)))
    # a same-cell pair on DIFFERENT SEEDS, 32 h apart: board-a (S1) then hive-c (S2, after its reseed): never a match
    d.append(row(L(50), 'board-a-Bravo', '_death', 'drowned; idle', (120.5, 60, 120.5), 'drowning'))
    d.append(row(L(2000), 'hive-c-Comet', '_death', 'drowned; idle', (120.5, 60, 120.5), 'drowning'))
    # a lava pool seen only (one episode -> not a hazard) and one seen twice by two bots (a hazard)
    d.append(row(L(500), 'hive-a-Alpha', '_lava_corridor', 'lava_corridor: lava below at 900,60,900 after 2 samples; the leg is refused', (900.5, 61, 900.5)))
    d.append(row(L(500), 'hive-a-Alpha', '_lava_corridor', 'lava_corridor: lava below at 396,72,108 after 2 samples; the leg is refused', (396.5, 73, 108.5)))
    d.append(row(L(900), 'board-a-Bravo', '_lava_corridor', 'lava_corridor: lava below at 397,72,108 after 2 samples; the leg is refused', (397.5, 73, 108.5)))
    # drowning, stalagmite, fall, suffocation (all board-a, day 2)
    d.append(row(L(1500), 'board-a-Bravo', '_death', 'drowned; was running gather | z', (362.7, 58.2, 175.7), 'drowning'))
    d.append(row(L(3000), 'board-a-Bravo', '_death', 'drowned; idle', (362.5, 58, 175.5), 'drowning'))   # own-world prior only
    # hive-a dies on the stalagmite 5 h after board-a did: another world, but too recent for a daily map (lag 24 h)
    d.append(row(L(1900), 'hive-a-Alpha', '_death', 'was impaled on a stalagmite after falling 9 blocks', (372.5, 2, 146.5), 'other'))
    d.append(row(L(1600), 'board-a-Bravo', '_death', 'was impaled on a stalagmite after falling 9 blocks; was running gather', (372.5, 2, 146.5), 'other'))
    d.append(row(L(1700), 'board-a-Bravo', '_death', 'fell from a high place; was running goto', (380.5, 20, 150.5), 'fall'))
    d.append(row(L(3200), 'hive-a-Alpha', '_death', 'hit the ground too hard; was running goto', (381.5, 20, 151.5), 'fall'))
    d.append(row(L(1800), 'board-a-Bravo', '_death', 'suffocated in a wall; idle', (344.5, 55, 168.5), 'suffocation'))
    # hive-a wet maroon spell 40 min at (329,61,213): _marooned every 2 min + _water_float every 2 min
    for m in range(4000, 4041, 2):
        d.append(row(L(m), 'hive-a-Alpha', '_marooned', 'no path can start from y=61 with an open column above -- climbing out', (329.3, 61.4, 213.3)))
        d.append(row(L(m), 'hive-a-Alpha', '_water_float', 'afloat and unowned -- float', (329.3, 61.4, 213.3)))
    # board-a DRY maroon spell 40 min at (500,70,500): no water_float -> excluded
    for m in range(4000, 4041, 2):
        d.append(row(L(m), 'board-a-Bravo', '_marooned', 'no path can start from y=70 with an open column above -- climbing out', (500.5, 70, 500.5)))
    # board-a no-air-route spell 50 min under copper at (359,40,187)
    for m in range(5000, 5051, 2):
        d.append(row(L(m), 'board-a-Bravo', '_water_no_air_route', 'afloat and unowned -- no_air_route (head water, health 20)', (359.6, 40.2, 186.5)))
        d.append(row(L(m) + 30_000, 'board-a-Bravo', '_entombed', 'walled in at y=40', (359.6, 40.2, 186.5)))   # one stream, one trap
    # hive-a entombed spell 35 min at (198,34,188) and three give-ups at (364,19,128)
    for m in range(5500, 5536, 5):
        d.append(row(L(m), 'hive-a-Alpha', '_entombed', 'walled in at y=34', (198.5, 34, 188.5)))
    for m in (5300, 5400, 5500):
        d.append(row(L(m), 'board-a-Bravo', '_entombed_unrecoverable', 'gave up after 4 escape attempts at y=19 (give-up #9)', (364.5, 19.2, 128.8)))
    # hive-c: a drowning at (100,60,100) BEFORE its reseed (S1) and one AFTER at the same cell (S2): never merged
    d.append(row(T('2026-09-10T12:00:00Z'), 'hive-c-Comet', '_death', 'drowned; idle', (100.5, 60, 100.5), 'drowning'))
    d.append(row(L(200), 'hive-c-Comet', '_death', 'drowned; idle', (100.5, 60, 100.5), 'drowning'))
    # a row inside hive-c's post-reseed quarantine (dropped and counted)
    d.append(row(T('2026-09-27T12:40:00Z'), 'hive-c-Comet', '_death', 'drowned; idle', (5.5, 60, 5.5), 'drowning'))
    # a corridor refused for UNKNOWN cells names no lava: skipped, not unparsed, not a sighting
    d.append(row(L(600), 'hive-a-Alpha', '_lava_corridor', 'lava_corridor: unknown at 15,64,97 after 23 samples; the leg is refused', (15.5, 64, 97.5)))
    # a danger row whose feet are in a vine: the DANGER block is below
    d.append(row(L(601), 'hive-a-Alpha', '_reflex_danger_block', 'vine', (700.5, 70, 700.5)))
    # 20 more deaths far away, spread over the 4 days, so the death-position control applies (>= 20 validated deaths)
    for k in range(20):
        d.append(row(L(720 + (k % 4) * 1440 + k), 'hive-a-Alpha', '_death', 'drowned; idle', (2000.5 + 40 * k, 60, 2000.5), 'drowning'))
    # 100 more deaths on 10-14, far apart: enough history that a fault on the newest day alone stays above the whole-window
    # floor (the recent death-position check must be what stops it)
    for k in range(100):
        d.append(row(L(400 + k), 'hive-a-Alpha', '_death', 'drowned; idle', (10000.5 + 40 * k, 60, 10000.5), 'drowning'))
    # every source speaks once a day, far from everything (single rows: no hazard, no spell)
    for day in range(4):
        m = 700 + day * 1440; x = 5000 + 50 * day
        d.append(row(L(m), 'hive-a-Alpha', '_lava_corridor', 'lava_corridor: lava below at %d,60,5000 after 2 samples; the leg is refused' % x, (x + .5, 61, 5000.5)))
        d.append(row(L(m), 'hive-a-Alpha', '_explore_blind_step_refused', 'blind_step: lava beside at %d,60,5003: the fallback walk is refused' % x, (x + .5, 61, 5003.5)))
        d.append(row(L(m), 'hive-a-Alpha', '_reflex_danger_block', 'lava', (x + .5, 60, 5006.5)))
        d.append(row(L(m), 'hive-a-Alpha', '_lava_adjacent_no_retreat', 'lava within a block and no verified retreat cell: holding still', (x + .5, 61, 5009.5)))
        d.append(row(L(m), 'hive-a-Alpha', '_lava_adjacent_stand_off', 'lava within a block; stepping 0,1 onto verified ground', (x + .5, 61, 5012.5)))
        d.append(row(L(m + 100), 'board-a-Bravo', '_marooned', 'no path can start from y=61 with an open column above -- climbing out', (x + .5, 61, 6000.5)))
        d.append(row(L(m + 100), 'board-a-Bravo', '_water_float', 'afloat and unowned -- float', (x + .5, 61, 6000.5)))
        d.append(row(L(m + 200), 'board-a-Bravo', '_water_no_air_route', 'afloat and unowned -- no_air_route (head water, health 20)', (x + .5, 40, 6100.5)))
        d.append(row(L(m + 300), 'board-a-Bravo', '_entombed', 'walled in at y=30', (x + .5, 30, 6200.5)))
        d.append(row(L(m + 400), 'board-a-Bravo', '_entombed_unrecoverable', 'gave up after 4 escape attempts at y=30 (give-up #1)', (x + .5, 30, 6300.5)))
    return site_rows(d)


def verify_doc(**over):
    v = {'schema': 'mcai.hazardmap.verify', 'schema_version': 1, 'backup_day': '2026-10-18', 'made_at': isoz(NOW),
         'request_made_at': isoz(NOW),
         'worlds': {'hive-a': {'seed': 'S1', 'home': [355, 73, 147], 'created': '2026-08-22T14:31:27Z', 'previous': []},
                    'board-a': {'seed': 'S1', 'home': [355, 73, 147], 'created': '2026-08-22T14:16:49Z', 'previous': []},
                    'hive-c': {'seed': 'S2', 'home': [-68, 68, -68], 'created': '2026-09-27T12:35:42Z',
                               'previous': [{'seed': 'S1', 'created': '2026-08-25T01:51:35Z', 'retired': '2026-09-27T12:35:23Z'}]}},
         'results': {}, 'terrain_control': {'within_seed': {'S1': {'min_agreement': 1.0, 'min_cells': 867}}}}
    v.update(over)
    return v


def fetch_all(hm, docs):
    FakeEs.DOCS = docs
    days = []
    for day in ['2026-09-10', '2026-09-27', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18']:
        days.append(hm.fetch_day(day, FakeEs, NOW))
    return days


def built(hm, docs=None, verify=None):
    days = fetch_all(hm, docs if docs is not None else fleet_docs())
    seeds = hm.Seeds.from_verify(verify or verify_doc())
    doc, deaths = hm.build(days, seeds, verify=verify, now_ms=NOW)
    return doc, deaths, seeds, days


def find(doc, seed, kind, near):
    for h in doc['seeds'].get(seed, {}).get('hazards', []):
        if h['kind'] == kind and all(abs(a - b) <= 4 for a, b in zip(h['center'], near)):
            return h
    return None


def fold_cases(hm):
    cases = []
    doc, deaths, seeds, days = built(hm)
    lava = find(doc, 'S1', 'lava', (336, 36, 204))
    cases.append(('fold: the lava cave is one S1 hazard with 3 deaths from 2 worlds',
                  (lava or {}).get('deaths', {}).get('total'), 3))
    cases.append(('fold: ... its death worlds', sorted((lava or {}).get('death_worlds', [])), ['board-a', 'hive-a']))
    cases.append(('fold: ... guard rows that named its cells are its sightings (6 corridor, 1 blind, 2 danger)',
                  (lava or {}).get('sightings', {}).get('by_source'), {'corridor': 6, 'blind_lava': 1, 'danger': 2}))
    cases.append(('fold: ... confidence high (3 deaths)', (lava or {}).get('confidence'), 'high'))
    fall = find(doc, 'S1', 'cave_fall', (380, 20, 150))
    cases.append(('fold: two deaths in two worlds -> confidence high', ((fall or {}).get('deaths', {}).get('total'), (fall or {}).get('confidence')),
                  (2, 'high')))
    cases.append(('fold: ... id anchors on its earliest evidence cell', (lava or {}).get('id'), 'S1/lava/336,36,204'))
    cases.append(('fold: death cells most-deaths first (not coordinate order)', ((lava or {}).get('deaths', {}).get('cells', [None])[0],
                  (lava or {}).get('deaths', {}).get('cells_total')), ([336, 36, 205], 2)))
    cases.append(('fold: a lava pool seen by two bots is a hazard (2 episodes)', bool(find(doc, 'S1', 'lava', (396, 72, 108))), True))
    cases.append(('fold: a lava cell seen once is not', find(doc, 'S1', 'lava', (900, 60, 900)), None))
    cases.append(('fold: drowning site', (find(doc, 'S1', 'drowning', (362, 58, 175)) or {}).get('deaths', {}).get('total'), 2))
    cases.append(('fold: stalagmite -> dripstone', bool(find(doc, 'S1', 'dripstone', (372, 2, 146))), True))
    cases.append(('fold: fell -> cave_fall', bool(find(doc, 'S1', 'cave_fall', (380, 20, 150))), True))
    ent = find(doc, 'S1', 'entombment', (344, 55, 168))
    cases.append(('fold: suffocation -> entombment, not block-checkable', (ent or {}).get('exists', {}).get('summary'), 'not_applicable'))
    pit = find(doc, 'S1', 'water_pit', (329, 61, 213))
    cases.append(('fold: a 40-min wet maroon spell is a water pit', round((pit or {}).get('spells', {}).get('bot_hours', 0), 2), 0.67))
    cases.append(('fold: a 40-min DRY maroon spell is not', find(doc, 'S1', 'water_pit', (500, 70, 500)), None))
    cases.append(('fold: the dry spell is counted as excluded', doc['controls']['excluded'].get('spell:marooned_dry'), 1))
    trap = find(doc, 'S1', 'water_ceiling_trap', (359, 40, 186))
    cases.append(('fold: a 50-min no-air + entombed stream is ONE ceiling-trap spell', ((trap or {}).get('spells', {}).get('n'),
                  round((trap or {}).get('spells', {}).get('bot_hours', 0), 2)), (1, 0.84)))
    cases.append(('fold: ... and not an entombment', find(doc, 'S1', 'entombment', (359, 40, 186)), None))
    cases.append(('fold: an entombed spell of 35 min', bool(find(doc, 'S1', 'entombment', (198, 34, 188))), True))
    cases.append(('fold: three give-ups make an entombment hotspot', (find(doc, 'S1', 'entombment', (364, 19, 128)) or {}).get('gave_ups'), 3))
    cases.append(('fold: hive-c before its reseed folds into S1', bool(find(doc, 'S1', 'drowning', (100, 60, 100))), True))
    cases.append(('fold: hive-c after its reseed folds into S2', bool(find(doc, 'S2', 'drowning', (100, 60, 100))), True))
    cases.append(('fold: ... and the two are never merged', (find(doc, 'S2', 'drowning', (100, 60, 100)) or {}).get('deaths', {}).get('total'), 1))
    cases.append(('fold: the quarantine row is dropped and counted', doc['controls']['excluded'].get('death:quarantine'), 1))
    cases.append(('fold: S1 lists its current worlds and hive-c as a past world',
                  (sorted(doc['seeds']['S1']['worlds']), [p['world'] for p in doc['seeds']['S1']['past_worlds']]),
                  (['board-a', 'hive-a'], ['hive-c'])))
    cases.append(('fold: seeds are strings in the document', all(isinstance(k, str) for k in doc['seeds']), True))
    cases.append(('fold: an unchecked hazard says so', (lava or {}).get('exists', {}).get('summary'), 'unchecked'))
    cases.append(('fold: the death-position control pairs every validated death', (doc['controls']['death_site_recorded']['paired_with_site_row'],
                  doc['controls']['death_site_recorded']['site_within_1_block']), (137, 137)))
    cases.append(('fold: the UNKNOWN-cell corridor row is skipped', sum(d['skipped'].get('corridor', 0) for d in days), 1))
    cases.append(('fold: one vine danger row alone is not a hazard (one episode)', bool(find(doc, 'S1', 'lava', (700, 69, 700))), False))
    try:
        hm.check_fresh({'made_at': '2026-10-14T00:00:00Z'}, NOW)
        got = 'used a 4-day-old seeds table'
    except hm.Blind:
        got = 'refused'
    cases.append(('fold: a verify file older than 72 h is refused (the seeds may predate a reseed)', got, 'refused'))
    # value: hive-a's lava death (t=3000) follows board-a's (t=100) in ANOTHER world; board-a's second (t=3500) has both an
    # own-world prior and another-world prior; board-a's second drowning has only an own-world prior
    val = hm.value_report(deaths, seeds, NOW, days=7)
    cases.append(('value: five deaths were known from another world', val['headline'].get('known_from_another_world'), 5))
    cases.append(('value: ... three of them ONLY from another world', val['headline'].get('known_only_from_another_world'), 3))
    cases.append(('value: an own-world prior 1 h old counts (no lag for per-world memory)', val['headline'].get('known_from_own_world'), 3))
    cases.append(('value: the matched deaths', [(m['bot'], m['kind']) for m in val['matched']],
                  [('hive-a-Alpha', 'dripstone'), ('hive-a-Alpha', 'dripstone'), ('hive-a-Alpha', 'lava'), ('hive-a-Alpha', 'cave_fall'),
                   ('board-a-Bravo', 'lava')]))
    cases.append(('value: denominator = deaths in the window', val['headline'].get('deaths'), 137))
    cases.append(('value: rotated about home, the priors match nothing (the town-density null)', val['rotation_null']['max'], 0))
    cases.append(('value: per-kind could-match denominators', val['could_match_by_kind'].get('lava'), 3))
    cases.append(('value: without the 24 h lag the stalagmite death also matches', val['variants']['no_lag'].get('known_from_another_world'), 6))
    cases.append(('value: shifted priors match nothing (chance null)', val['chance_null']['max'], 0))
    cases.append(('value: hive-c S2 death has no S1 prior match', any(m['bot'].startswith('hive-c') for m in val['matched']), False))
    # request: probes for every current world of the seed, never for entombment
    req = hm.make_request(doc, NOW)
    cases.append(('request: valid', bool(hm.validate_request(req)), True))
    cases.append(('request: lava probed in both S1 worlds', sorted({p['world'] for p in req['probes'] if p['id'] == 'S1/lava/336,36,204'}),
                  ['board-a', 'hive-a']))
    cases.append(('request: entombment is never probed', any(p['kind'] == 'entombment' for p in req['probes']), False))
    # verify results flow back (results carry the probed cells: the fingerprint an answer is valid for)
    cells = sorted(list(c) for c in hm.probe_cells(lava)) if lava else []
    A = {'state': 'absent', 'found': {}}
    fp = (lava or {}).get('evidence_fp')
    v = verify_doc(results={'S1/lava/336,36,204': {'cells': cells, 'fp': fp, 'by_world': {'hive-a': A, 'board-a': A}}})
    doc2, _, _, _ = built(hm, verify=v)
    lava2 = find(doc2, 'S1', 'lava', (336, 36, 204))
    cases.append(('verify flow: absent in every world -> summary absent', (lava2 or {}).get('exists', {}).get('summary'), 'absent'))
    cases.append(('verify flow: absent everywhere lowers confidence one step', (lava2 or {}).get('confidence'), 'medium'))
    v = verify_doc(results={'S1/lava/336,36,204': {'cells': cells, 'fp': fp, 'by_world': {'hive-a': A, 'board-a': {'state': 'present', 'found': {'lava': 3}}}}})
    lava3 = find(built(hm, verify=v)[0], 'S1', 'lava', (336, 36, 204))
    cases.append(('verify flow: present in one world -> present, named', ((lava3 or {}).get('exists', {}).get('summary'),
                                                                          (lava3 or {}).get('exists', {}).get('present_in')), ('present', ['board-a'])))
    v = verify_doc(results={'S1/lava/336,36,204': {'cells': [[1, 2, 3]], 'fp': fp, 'by_world': {'hive-a': A, 'board-a': A}}})
    lava4 = find(built(hm, verify=v)[0], 'S1', 'lava', (336, 36, 204))
    cases.append(('verify flow: an absence for OTHER probe cells no longer covers the hazard', (lava4 or {}).get('exists', {}).get('summary'), 'unchecked'))
    v = verify_doc(request_made_at='2026-10-15T00:00:00Z', results={'S1/lava/336,36,204': {'cells': cells, 'fp': fp, 'by_world': {'hive-a': A, 'board-a': A}}})
    lava5 = find(built(hm, verify=v)[0], 'S1', 'lava', (336, 36, 204))
    cases.append(('verify flow: evidence newer than the request voids an absence', (lava5 or {}).get('exists', {}).get('summary'), 'unchecked'))
    v = verify_doc(results={'S1/lava/336,36,204': {'cells': cells, 'fp': '0' * 16, 'by_world': {'hive-a': A, 'board-a': A}}})
    lava6 = find(built(hm, verify=v)[0], 'S1', 'lava', (336, 36, 204))
    cases.append(('verify flow: late-ingested evidence (another fingerprint) voids an absence', (lava6 or {}).get('exists', {}).get('summary'), 'unchecked'))
    for agree, cells_n, label in ((0.8, 867, 'terrain gate: a seed whose worlds disagree (0.8) is not merged'),
                                  (1.0, 100, 'terrain gate: too few compared cells (100) is not merged either')):
        d8, _, _, _ = built(hm, verify=verify_doc(terrain_control={'within_seed': {'S1': {'min_agreement': agree, 'min_cells': cells_n}}}))
        cases.append((label, (sorted(k for k in d8['seeds'] if k.startswith('S1')), sorted(d8['controls']['unmerged_seeds']),
                              hm.heartbeat_status(d8)[0]),
                      (['S1@board-a', 'S1@hive-a', 'S1@hive-c'], ['S1'], 'incomplete')))
    sd = hm.Seeds.from_verify(verify_doc(made_at='2026-10-16T00:00:00Z'))
    cases.append(('seeds: a row after the observation horizon is not resolved', sd.seed_at('hive-a', T('2026-10-16T01:30:00Z')), (None, 'after_seed_observation')))
    cases.append(('seeds: a row inside it is', sd.seed_at('hive-a', T('2026-10-15T23:00:00Z'))[0], 'S1'))
    return cases


# ------------------------------------------------------------------ blind-input mutants: the build must RAISE for the reason
def guard_cases(hm):
    """The guards r2's reviewers found untested: each raises for its reason, and a legitimate case still builds."""
    c = []
    days = fetch_all(hm, fleet_docs())
    seeds = lambda **kw: hm.Seeds.from_verify(verify_doc(**kw))

    def outcome(fn):
        try:
            fn()
            return 'built'
        except hm.Blind as e:
            return 'Blind: ' + str(e)[:60]
    got = outcome(lambda: hm.build([d for d in days if d['day'] != '2026-10-15'], seeds(), now_ms=NOW))
    c.append(('coverage: a missing validated day raises', got.startswith('Blind: validated day(s) missing'), True))
    got = outcome(lambda: hm.build([d for d in days if d['day'] != '2026-10-18'], seeds(), now_ms=NOW))
    c.append(('coverage: a missing tail (today absent) raises', got.startswith('Blind: validated day(s) missing'), True))
    stale = [dict(d, closed=False) if d['day'] == '2026-10-17' else d for d in days]
    got = outcome(lambda: hm.build(stale, seeds(), now_ms=NOW))
    c.append(('coverage: a day that ended > 1 h ago but is cached open raises', got.startswith('Blind: day(s)'), True))
    # 60 validated board-a rows before board-a existed (created 10-15 12:00 in this table): the table does not describe it
    late = verify_doc()
    late['worlds'] = dict(late['worlds'], **{'board-a': dict(late['worlds']['board-a'], created='2026-10-14T20:00:00Z')})
    extra = [row(D0 + (300 + k) * M, 'board-a-Bravo', '_reflex_danger_block', 'lava', (8000.5, 60, 8000.5)) for k in range(60)]
    got = outcome(lambda: hm.build(fetch_all(hm, fleet_docs() + extra), hm.Seeds.from_verify(late), now_ms=NOW))
    c.append(('lifetime: > 50 validated rows outside every world segment raise', 'outside every world' in got, True))
    # a reseed INSIDE the window (same seed): 60 rows in its quarantine are dropped by design and the build goes on
    rs = verify_doc()
    rs['worlds'] = dict(rs['worlds'], **{'board-a': {'seed': 'S1', 'home': [355, 73, 147], 'created': '2026-10-15T12:05:00Z',
                                                    'previous': [{'seed': 'S1', 'created': '2026-08-22T14:16:49Z', 'retired': '2026-10-15T12:00:00Z'}]}})
    q = [row(T('2026-10-15T12:06:00Z') + k * 5000, 'board-a-Bravo', '_reflex_danger_block', 'lava', (8000.5, 60, 8000.5)) for k in range(60)]
    got = outcome(lambda: hm.build(fetch_all(hm, fleet_docs() + q), hm.Seeds.from_verify(rs), now_ms=NOW))
    c.append(('lifetime: a reseed in the window (60 quarantine rows) still builds', got, 'built'))
    # the rare source (no-air) may be quiet on the newest closed days if it spoke within its 7-day window ...
    quiet = [r for r in fleet_docs() if not (r['skill']['name'] == '_water_no_air_route' and T(r['@timestamp']) >= D0 + 2 * 1440 * M)]
    qdays = fetch_all(hm, quiet)
    c.append(('rare source: no-air quiet on the newest two days still builds', outcome(lambda: hm.build(qdays, seeds(), now_ms=NOW)), 'built'))
    # ... but not beyond it (the window is 2 days here, so the fixture's 4 days can exceed it)
    keep = hm.RECENT_DAYS_RARE
    hm.RECENT_DAYS_RARE = 2
    try:
        got = outcome(lambda: hm.build(qdays, seeds(), now_ms=NOW))
    finally:
        hm.RECENT_DAYS_RARE = keep
    c.append(('rare source: no-air quiet for its whole window raises', 'SILENT on' in got, True))
    # a reseed's downtime gap: 60 rows OUTSIDE every segment but within 30 min of the retire / create edges still builds
    gap = verify_doc()
    gap['worlds'] = dict(gap['worlds'], **{'board-a': {'seed': 'S1', 'home': [355, 73, 147], 'created': '2026-10-15T12:20:00Z',
                                                      'previous': [{'seed': 'S1', 'created': '2026-08-22T14:16:49Z', 'retired': '2026-10-15T12:00:00Z'}]}})
    g = [row(T('2026-10-15T12:02:00Z') + k * 16000, 'board-a-Bravo', '_reflex_danger_block', 'lava', (8000.5, 60, 8000.5)) for k in range(60)]
    got = outcome(lambda: hm.build(fetch_all(hm, fleet_docs() + g), hm.Seeds.from_verify(gap), now_ms=NOW))
    c.append(('lifetime: 60 rows in a reseed downtime gap (near its edges) still build', got, 'built'))
    # a stale partial day: today's record fetched at 00:01 but the build runs at 02:00 (Codex r3)
    st = [dict(d, until='2026-10-18T00:01:00Z') if d['day'] == '2026-10-18' else d for d in days]
    got = outcome(lambda: hm.build(st, seeds(), now_ms=NOW + 2 * 3_600_000))
    c.append(('coverage: a partial day fetched long before the build raises', got.startswith('Blind: cached day(s) stop short'), True))
    # campfire danger rows are recognised and skipped, never a lava sighting
    r = row('2026-10-22T00:00:00.000Z', 'hive-a-Alpha', '_reflex_danger_block', 'campfire', (1.5, 70, 3.5))
    c.append(('compact: a campfire danger row is skipped, not lava', hm.compact('danger', r)[0], 'skip'))
    # heartbeat: a failed push and an incomplete fold are never `ok`
    hb = os.path.join(tempfile.mkdtemp(prefix='hb-'), 'heartbeat.json')
    hm.atomic_json(hb, {'status': 'ok'})
    with contextlib.redirect_stdout(io.StringIO()):
        rc = hm.record_push(hb, 255)
    c.append(('heartbeat: a failed request push -> push_failed', (rc, hm.load_json(hb)['status']), (1, 'push_failed')))
    c.append(('heartbeat: rows after the seed horizon -> incomplete', hm.heartbeat_status(
        {'controls': {'excluded': {'death:after_seed_observation': 4}, 'verify_made_at': 'x'}})[0], 'incomplete'))
    return c


class FakeWorld:
    """status() ok everywhere; block() answers from a dict, stone elsewhere, and None (a failed read, counted) at `blind`."""
    def __init__(self, cells, blind=()):
        import collections as _c
        self.cells, self.blind, self.stats = cells, set(blind), _c.Counter()

    def status(self, x, z):
        return 'ok'

    def block(self, x, y, z, props=False):
        if (x, y, z) in self.blind:
            self.stats['blind_reads'] += 1
            return (None, {}) if props else None
        n = self.cells.get((x, y, z), 'minecraft:stone')
        return (n, {}) if props else n


def probe_cases(hm):
    """A pit wall OUTSIDE the probe footprint (r + 1) that cannot be read must make a negative `unknown` (Codex r2 P1-2)."""
    # the pit cell sits at the EDGE of the footprint (x=11 for a probe at x=10, r=1): its east wall (12, 61, 10) is at r + 1
    cells = {(11, 60, 10): 'minecraft:water', (11, 61, 10): 'minecraft:air'}
    p = {'id': 'x', 'world': 'hive-a', 'kind': 'water_pit', 'x': 10, 'y': 60, 'z': 10, 'r': 1}
    c = [('probe: a pit with all walls read is present', hm.probe(FakeWorld(cells), p)['state'], 'present')]
    c.append(('probe: an opened pit is absent', hm.probe(FakeWorld({**cells, (10, 61, 10): 'minecraft:air'}), p)['state'], 'absent'))
    c.append(('probe: an unread wall beyond the footprint makes a negative unknown',
              hm.probe(FakeWorld(cells, blind={(12, 61, 10)}), p)['state'], 'unknown'))
    return c


def value_cases(hm):
    """value() called directly on the folded deaths (no value_report, so its subset guard cannot mask a broken fold)."""
    days = fetch_all(hm, fleet_docs())
    seeds = hm.Seeds.from_verify(verify_doc())
    _, deaths, _, _ = hm.evidence_points(days, seeds, hm.parse_ms(hm.VALIDATED_SINCE))
    direct = hm.value(deaths, NOW)[0].get('known_from_another_world')
    c = [('value(): a same-cell death on ANOTHER SEED never matches', direct, 5),
         ('value(): a different-kind prior is not a same-kind match',
          (direct, hm.value(deaths, NOW, same_kind=False)[0].get('known_from_another_world')), (5, 6))]
    # Codex r2 P2-5 / Claude r2 P2-3: a world reseeded AWAY from a seed still warned the seed's later deaths
    sd = hm.Seeds({'board-a': {'seed': 'S1', 'home': [355, 73, 147], 'segments': [{'seed': 'S1', 'from_ms': 0, 'until_ms': None}]},
                   'hive-c': {'seed': 'S2', 'home': [-68, 68, -68], 'segments': [
                       {'seed': 'S1', 'from_ms': 0, 'until_ms': NOW - 20 * hm.DAY_MS}, {'seed': 'S2', 'from_ms': NOW - 20 * hm.DAY_MS, 'until_ms': None}]}})
    hist = [{'t': NOW - 25 * hm.DAY_MS, 'bot': 'hive-c-X', 'world': 'hive-c', 'cell': (9, 60, 9), 'kind': 'drowning', 'seed': 'S1', 'category': 'drowned'},
            {'t': NOW - 1 * hm.DAY_MS, 'bot': 'board-a-X', 'world': 'board-a', 'cell': (9, 60, 9), 'kind': 'drowning', 'seed': 'S1', 'category': 'drowned'}]
    try:
        vr = hm.value_report(hist, sd, NOW)
        got = (vr['headline'].get('known_from_another_world'), vr['shared_seed_deaths'])
    except hm.Blind as e:
        got = 'refused: %s' % str(e)[:50]
    c.append(('value_report: a match from a world since reseeded away is a legitimate match', got, (1, 1)))
    # the reseeded world must come FIRST in any order the code might use: name it so it sorts first too
    homes = hm.seed_homes(hm.Seeds({'aaa-reseeded': sd.worlds['hive-c'], 'board-a': sd.worlds['board-a']}))
    c.append(('seed_homes: the shared home survives a reseeded world listed first', homes.get('S1'), (355, 147)))
    # the subset guard: a "match" on a seed that held ONE world at the time is a broken fold, and value_report refuses it
    bad = [{'t': NOW - 3 * hm.DAY_MS, 'bot': 'board-a-X', 'world': 'board-a', 'cell': (9, 60, 9), 'kind': 'drowning', 'seed': 'S2', 'category': 'drowned'},
           {'t': NOW - 1 * hm.DAY_MS, 'bot': 'hive-c-X', 'world': 'hive-c', 'cell': (9, 60, 9), 'kind': 'drowning', 'seed': 'S2', 'category': 'drowned'}]
    try:
        hm.value_report(bad, seeds, NOW)
        got = 'reported a match no other world could have made'
    except hm.Blind:
        got = 'refused'
    c.append(('value_report: a match on a one-world seed is refused (the subset guard)', got, 'refused'))
    return c


def blind_inputs():
    def ren_kind(d):
        return [dict(r, skill=dict(r['skill'], name='_died')) if r['skill']['name'] == '_death' else r for r in d]

    def ren_fc(d):
        return [dict(r, skill=dict(r['skill'], fail_class='burning')) if r['skill'].get('fail_class') == 'fire' else r for r in d]

    def reword(d):
        return [dict(r, skill=dict(r['skill'], detail=r['skill']['detail'].replace('tried to swim in lava', 'swam in lava')))
                if r['skill']['name'] == '_death' else r for r in d]

    def refmt(d):
        out, k = [], 0
        for r in d:                           # every other 10-14 corridor row: recent days are clean, the pooled share is not
            if r['skill']['name'] == '_lava_corridor' and T(r['@timestamp']) < D0 + 1440 * M:
                k += 1
                if k % 2:
                    r = dict(r, skill=dict(r['skill'], detail=re.sub(r'at (-?\d+),(-?\d+),(-?\d+)', r'@\1/\2/\3', r['skill']['detail'])))
            out.append(r)
        return out

    def nopos(d):
        out = []
        for r in d:
            if r['skill']['name'] == '_marooned':
                r = dict(r, bot={'name': r['bot']['name']})
            out.append(r)
        return out

    def newworld(d):
        return d + [row(D0 + 3000 * M, 'hive-e-Alpha', '_death', 'drowned; idle', (1.5, 60, 1.5), 'drowning')]

    def danger(d):
        return [dict(r, skill=dict(r['skill'], detail=r['skill']['detail'].upper())) if r['skill']['name'] == '_reflex_danger_block' else r for r in d]

    def silent_entombed(d):
        return [r for r in d if r['skill']['name'] != '_entombed']

    def late_rename(d):                     # the death kind renamed only for the newest two days: history must not hide it
        return [dict(r, skill=dict(r['skill'], name='_died')) if r['skill']['name'] == '_death' and T(r['@timestamp']) >= D0 + 2 * 1440 * M
                else r for r in d]

    def late_gaveup(d):                     # a kind with no second writer, renamed for the newest two days
        return [dict(r, skill=dict(r['skill'], name='_entombed_gave_up')) if r['skill']['name'] == '_entombed_unrecoverable'
                and T(r['@timestamp']) >= D0 + 2 * 1440 * M else r for r in d]

    def three_renamed(d):                   # three of one day's deaths renamed: the day still has deaths, the count is short
        xs = {2000.5 + 40 * k for k in (3, 7, 11)}
        return [dict(r, skill=dict(r['skill'], name='_died')) if r['skill']['name'] == '_death' and r['bot']['pos']['x'] in xs
                else r for r in d]

    def no_wet(d):
        return [dict(r, skill=dict(r['skill'], name='_water_floating')) if r['skill']['name'] == '_water_float' else r for r in d]

    def recent_reformat(d):                 # only the newest closed day's corridor rows, behind 4,000 good rows of history
        lo, hi = D0 + 3 * 1440 * M, D0 + 4 * 1440 * M
        return [dict(r, skill=dict(r['skill'], detail=r['skill']['detail'].replace(' at ', ' @ ')))
                if r['skill']['name'] == '_lava_corridor' and lo <= T(r['@timestamp']) < hi else r for r in d]

    def recent_moved_sites(d):              # the death-site rows wrong on the newest closed day only
        lo, hi = D0 + 3 * 1440 * M, D0 + 4 * 1440 * M
        return [dict(r, skill=dict(r['skill'], detail=re.sub(r'at (-?\d+),', lambda m: 'at %d,' % (int(m.group(1)) + 5), r['skill']['detail'])))
                if r['skill']['name'] == '_death_site_recorded' and lo <= T(r['@timestamp']) < hi else r for r in d]

    def moved_sites(d):
        return [dict(r, skill=dict(r['skill'], detail=re.sub(r'at (-?\d+),', lambda m: 'at %d,' % (int(m.group(1)) + 5), r['skill']['detail'])))
                if r['skill']['name'] == '_death_site_recorded' else r for r in d]
    return [
        ('blind: the death kind renamed _death -> _died', ren_kind, "source 'death'"),
        ('blind: fail_class renamed fire -> burning', ren_fc, 'unknown fail_class'),
        ('blind: the lava death message reworded', reword, 'no category'),
        ('blind: the corridor row cell reformatted', refmt, "did not parse"),
        ('blind: _marooned rows lose bot.pos', nopos, "source 'marooned'"),
        ('blind: a world the seeds table does not know', newworld, "world 'hive-e'"),
        ('blind: the danger block name changes case', danger, "source 'danger'"),
        ('blind: the entombed kind goes silent', silent_entombed, "source 'entombed'"),
        ('blind: the death position is not the recorded death site', moved_sites, 'death-position control'),
        ('blind: the death kind renamed for the newest two days only', late_rename, 'is SILENT on'),
        ('blind: death sites wrong on the newest day only (history dilutes the pooled agreement)', recent_moved_sites, 'death-position control'),
        ('blind: give-ups renamed for the newest two days only', late_gaveup, "source 'gave_up'"),
        ('blind: three of one day\'s deaths renamed', three_renamed, '_death_site_recorded rows'),
        ('blind: the wet kind renamed (every pit would read dry)', no_wet, '_water_float is SILENT'),
        ('blind: corridor rows reformatted on the newest day only (history dilutes the pooled share)', recent_reformat, 'newest 3 closed days did not parse'),
    ]


def blind_cases(hm):
    out = []
    for name, f, why in blind_inputs():
        try:
            built(hm, f(fleet_docs()))
            got = 'SURVIVED (built a map)'
        except hm.Blind as e:
            got = 'STOPPED' if why in str(e) else 'STOPPED FOR ANOTHER REASON: %s' % str(e)[:120]
        except Exception as e:
            got = 'CRASHED: %s: %s' % (type(e).__name__, e)
        out.append((name, got, 'STOPPED'))
    for name, fn, why in (
            ('blind: no validated day in the cache', lambda: hm.build([d for d in fetch_all(hm, fleet_docs()) if d['day'] < '2026-10-08'],
                                                                     hm.Seeds.from_verify(verify_doc()), now_ms=NOW), 'no validated day'),
            ('blind: a verify file of another schema', lambda: hm.Seeds.from_verify(dict(verify_doc(), schema='x')), 'not mcai.hazardmap.verify'),
            ('blind: overlapping world segments', lambda: hm.Seeds.from_verify(verify_doc(worlds={'hive-c': {
                'seed': 'S2', 'created': '2026-09-01T00:00:00Z', 'previous': [{'seed': 'S1', 'created': '2026-08-25T00:00:00Z',
                                                                              'retired': '2026-09-27T00:00:00Z'}]}})), 'overlap')):
        try:
            fn()
            got = 'SURVIVED'
        except hm.Blind as e:
            got = 'STOPPED' if why in str(e) else 'STOPPED FOR ANOTHER REASON: %s' % str(e)[:120]
        except Exception as e:
            got = 'CRASHED: %s: %s' % (type(e).__name__, e)
        out.append((name, got, 'STOPPED'))
    return out


def cache_cases(hm, tmp):
    """refresh_cache: 10-07 never fetched; a closed day is kept while ES agrees and refetched when its counts change."""
    cases = []
    FakeEs.DOCS = fleet_docs()
    calls = []

    class Spy(FakeEs):
        @classmethod
        def load(cls, stream, since=None, until=None, **kw):
            calls.append(since[:10])
            return cls(T(since), T(until))
    d = os.path.join(tmp, 'cache')
    now = T('2026-10-09T03:00:00Z')
    with contextlib.redirect_stdout(io.StringIO()):
        st = hm.refresh_cache(d, Spy, now, since='2026-10-06T00:00:00Z', log=lambda *a: None)
    cases.append(('cache: 10-07 is refused, never loaded', ('2026-10-07' in calls, st.get('refused')), (False, 1)))
    calls.clear()
    st = hm.refresh_cache(d, Spy, now, since='2026-10-06T00:00:00Z', log=lambda *a: None)
    cases.append(('cache: closed days are kept; the open day refetched', (st.get('kept'), st.get('fetched')), (2, 1)))
    FakeEs.DOCS = fleet_docs() + [row(T('2026-10-06T05:00:00Z'), 'hive-a-Alpha', '_death', 'drowned; idle', (1.5, 60, 1.5), 'drowning')]
    st = hm.refresh_cache(d, Spy, now, since='2026-10-06T00:00:00Z', log=lambda *a: None)
    cases.append(('cache: a late death changes the count -> that day is refetched', st.get('recount_changed'), 1))
    return cases


# ------------------------------------------------------------------ an NBT + Anvil writer (just enough for fixtures)
def _str(s):
    b = s.encode()
    return struct.pack('>H', len(b)) + b


def _payload(tag, v):
    if tag == 1: return struct.pack('>b', v)
    if tag == 3: return struct.pack('>i', v)
    if tag == 4: return struct.pack('>q', v)
    if tag == 8: return _str(v)
    if tag == 9:
        et, items = v
        return struct.pack('>bi', et, len(items)) + b''.join(_payload(et, i) for i in items)
    if tag == 10:
        return b''.join(struct.pack('>b', t) + _str(k) + _payload(t, x) for k, (t, x) in v.items()) + b'\x00'
    if tag == 12: return struct.pack('>i', len(v)) + b''.join(struct.pack('>q', i) for i in v)
    raise ValueError(tag)


def nbt(root):
    return b'\x0a' + _str('') + _payload(10, root)


def pack(values, bits):
    per = 64 // bits
    out = []
    for i in range(0, len(values), per):
        v = 0
        for k, x in enumerate(values[i:i + per]):
            v |= x << (k * bits)
        out.append(v - (1 << 64) if v >= 1 << 63 else v)
    return out


def section(Y, get):
    """get(lx, ly, lz) -> (name, props|None) -> a section compound."""
    cells = [get(k & 15, k >> 8, (k >> 4) & 15) for k in range(4096)]
    keys = sorted(set((n, json.dumps(p, sort_keys=True) if p else '') for n, p in cells))
    def entry(k):
        e = {'Name': (8, k[0])}
        if k[1]:
            e['Properties'] = (10, {a: (8, b) for a, b in json.loads(k[1]).items()})
        return e
    if len(keys) == 1:
        return {'Y': (1, Y), 'block_states': (10, {'palette': (9, (10, [entry(keys[0])]))})}
    idx = {k: i for i, k in enumerate(keys)}
    vals = [idx[(n, json.dumps(p, sort_keys=True) if p else '')] for n, p in cells]
    bits = max(4, (len(keys) - 1).bit_length())
    return {'Y': (1, Y), 'block_states': (10, {'palette': (9, (10, [entry(k) for k in keys])), 'data': (12, pack(vals, bits))})}


def chunk_bytes(cx, cz, at, status='minecraft:full'):
    secs = []
    for Y in range(-4, 6):
        secs.append(section(Y, lambda lx, ly, lz: at(cx * 16 + lx, Y * 16 + ly, cz * 16 + lz)))
    root = {'DataVersion': (3, 4440), 'xPos': (3, cx), 'zPos': (3, cz), 'Status': (8, status), 'sections': (9, (10, secs))}
    return nbt(root)


def write_region(path, chunks):
    loc = bytearray(4096); ts = bytearray(4096); body = bytearray(); sector = 2
    for (lx, lz), raw in sorted(chunks.items()):
        data = zlib.compress(raw)
        blob = struct.pack('>IB', len(data) + 1, 2) + data
        n = (len(blob) + 4095) // 4096
        blob += b'\x00' * (n * 4096 - len(blob))
        i = 4 * (lx + lz * 32)
        loc[i:i + 4] = struct.pack('>I', (sector << 8) | n)
        body += blob; sector += n
    with open(path, 'wb') as f:
        f.write(bytes(loc) + bytes(ts) + bytes(body))


def world_fixture(root, wname, seed_int, edits):
    """Stone to y=59, grass at 60, air above; bedrock floor from a seeded random; `edits` {(x,y,z): (name, props)}."""
    rnd = random.Random(seed_int)
    bedrock = {(x, y, z) for x in range(320, 384) for z in range(112, 176) for y in (-63, -62, -61) if rnd.random() < (-60 - y) / 4}

    def at(x, y, z):
        if (x, y, z) in edits:
            return edits[(x, y, z)]
        if y == -64 or (x, y, z) in bedrock:
            return ('minecraft:bedrock', None)
        if y < 60:
            return ('minecraft:stone', None)
        if y == 60:
            return ('minecraft:grass_block', None)
        return ('minecraft:air', None)
    d = os.path.join(root, wname, 'world', 'region')
    os.makedirs(d, exist_ok=True)
    chunks = {(cx, cz): chunk_bytes(cx, cz, at) for cx in range(20, 24) for cz in range(7, 11)}
    write_region(os.path.join(d, 'r.0.0.mca'), chunks)
    lvl = nbt({'Data': (10, {'WorldGenSettings': (10, {'seed': (4, seed_int)})})})
    with open(os.path.join(root, wname, 'world', 'level.dat'), 'wb') as f:
        f.write(gzip.compress(lvl))
    with open(os.path.join(root, wname, 'TOWN-PLACED.json'), 'w') as f:
        json.dump({'home': [355, 73, 147]}, f)


W = ('minecraft:water', {'level': '0'})
AIR = ('minecraft:air', None)
STONE = ('minecraft:stone', None)


def hazards_edits(full=True):
    e = {}
    if full:
        e[(340, 59, 140)] = ('minecraft:lava', {'level': '0'})                       # a lava pool cell under the grass
        # a board-d water pit at (350,55,150): floor stone at 54, water feet 55, air head 56 with stone walls, open above
        for y in range(55, 61):
            e[(350, y, 150)] = AIR
        e[(350, 55, 150)] = W
        # a board-a ceiling trap at (360,40,160): water at 40-41, copper ore at 42
        e[(360, 40, 160)] = W; e[(360, 41, 160)] = W; e[(360, 42, 160)] = ('minecraft:copper_ore', None)
        # an open drop: a 10-high air column at (370,30..39,140)
        for y in range(30, 40):
            e[(370, y, 140)] = AIR
        e[(365, 31, 165)] = ('minecraft:pointed_dripstone', {'vertical_direction': 'up'})
        e[(345, 50, 165)] = ('minecraft:oak_stairs', {'waterlogged': 'true'})         # a waterlogged block counts as water
        e[(345, 51, 165)] = ('minecraft:seagrass', None)                             # ... under a water plant: head-deep
    else:
        # near-misses: an UNWALLED water cell on a floor (a lake edge, not a pit) and water with stone above (not a trap)
        for y in range(55, 61):
            e[(350, y, 150)] = AIR
        e[(350, 55, 150)] = W
        for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            e[(350 + dx, 56, 150 + dz)] = AIR
        e[(360, 40, 160)] = W
        e[(345, 50, 165)] = W                                                        # one water cell, stone above: not head-deep
    return e


PROBES = [
    ('P-lava', 'lava', (340, 59, 140), 2), ('P-pit', 'water_pit', (350, 55, 150), 1), ('P-trap', 'water_ceiling_trap', (360, 40, 160), 1),
    ('P-drop', 'cave_fall', (370, 30, 140), 1), ('P-drip', 'dripstone', (365, 30, 165), 2), ('P-wlog', 'drowning', (345, 50, 165), 1),
    ('P-far', 'lava', (5000, 60, 5000), 2), ('P-edge', 'lava', (383, 59, 140), 2),
]


def verify_cases(hm, tmp):
    cases = []
    st = os.path.join(tmp, 'staging'); live = os.path.join(tmp, 'live')
    world_fixture(st, 'hive-a', 111, hazards_edits(True))
    world_fixture(st, 'board-a', 111, hazards_edits(False))       # same seed, every hazard dug out / never there
    world_fixture(st, 'hive-c', 999, {})
    os.makedirs(os.path.join(live, 'hive-c', 'world.pre-reseed-20260927T123523Z'), exist_ok=True)
    shutil.copy(os.path.join(st, 'hive-a', 'world', 'level.dat'), os.path.join(live, 'hive-c', 'world.pre-reseed-20260927T123523Z', 'level.dat'))
    for w in ('hive-a', 'board-a', 'hive-c'):
        os.makedirs(os.path.join(live, w, 'world'), exist_ok=True)
        shutil.copy(os.path.join(st, w, 'world', 'level.dat'), os.path.join(live, w, 'world', 'level.dat'))
    log = os.path.join(tmp, 'backup.log')
    with open(log, 'w') as f:
        f.write('2026-10-18T03:16:17Z good 2026-10-18: 16/16 worlds\n')

    def cat(p):
        return open(p, 'rb').read() if os.path.exists(p) else b''
    birth = lambda p: '2026-09-27T12:35:42Z' if 'hive-c' in p and 'pre-reseed' not in p else '2026-08-22T14:00:00Z'
    ls = lambda d: sorted(os.listdir(d)) if os.path.isdir(d) else []
    req = {'schema': 'mcai.hazardmap.request', 'schema_version': 1, 'made_at': 'x',
           'probes': [{'id': i, 'world': w, 'kind': k, 'x': c[0], 'y': c[1], 'z': c[2], 'r': r}
                      for i, k, c, r in PROBES for w in ('hive-a', 'board-a')]}
    hm.validate_request(req)
    v = hm.verify(req, st, live, log, day='2026-10-18', cat=cat, birth=birth, ls=ls, now_ms=T('2026-10-18T04:00:00Z'))
    R = {k: x['by_world'] for k, x in v['results'].items()}
    for pid, _, _, _ in PROBES[:-2]:
        cases.append(('verify: %s present in hive-a' % pid, R[pid]['hive-a']['state'], 'present'))
        cases.append(('verify: %s absent in board-a' % pid, R[pid]['board-a']['state'], 'absent'))
    cases.append(('verify: a probe in an ungenerated region -> not_generated', R['P-far']['hive-a']['state'], 'not_generated'))
    cases.append(('verify: a negative that straddles an ungenerated chunk is unknown, not absent', R['P-edge']['board-a']['state'], 'unknown'))
    cases.append(('verify: the probed cells come back as the fingerprint', v['results']['P-lava']['cells'], [[340, 59, 140]]))
    cases.append(('verify: the pit count', R['P-pit']['hive-a']['found'].get('pit_cells'), 1))
    cases.append(('verify: the trap ceiling is named', R['P-trap']['hive-a']['found'].get('ceiling:copper_ore'), 1))
    cases.append(('reduce: absent + unknown -> unknown', hm.reduce_states([{'state': 'absent'}, {'state': 'unknown'}])['state'], 'unknown'))
    cases.append(('reduce: absent + present -> present', hm.reduce_states([{'state': 'absent'}, {'state': 'present', 'found': {}}])['state'], 'present'))
    world_fixture(os.path.join(tmp, 'other'), 'hive-a', 222, {})
    shutil.copy(os.path.join(tmp, 'other', 'hive-a', 'world', 'level.dat'), os.path.join(live, 'hive-a', 'world', 'level.dat'))
    try:
        hm.verify(req, st, live, log, day='2026-10-18', cat=cat, birth=birth, ls=ls)
        got = 'paired a staged seed with a reseeded live world'
    except hm.Blind as e:
        got = 'refused' if 'differ' in str(e) else str(e)
    cases.append(('verify: a reseed since the backup (staged and live seeds differ) is refused', got, 'refused'))
    try:
        hm.verify(req, st, live, log, day='2026-10-18', cat=cat, birth=lambda p: '2026-10-18T05:00:00Z', ls=ls)
        got = 'paired the staged copy with a world created after it'
    except hm.Blind as e:
        got = 'refused' if 'after the backup' in str(e) else str(e)[:80]
    except Exception as e:
        got = 'crashed: %s' % type(e).__name__
    cases.append(('verify: a live world created after the backup is refused', got, 'refused'))
    shutil.copy(os.path.join(st, 'hive-a', 'world', 'level.dat'), os.path.join(live, 'hive-a', 'world', 'level.dat'))
    cases.append(('verify: seeds read from level.dat', (v['worlds']['hive-a']['seed'], v['worlds']['hive-c']['seed']), ('111', '999')))
    cases.append(('verify: the pre-reseed copy is hive-c\'s previous seed',
                  [(p['seed'], p['retired']) for p in v['worlds']['hive-c']['previous']], [('111', '2026-09-27T12:35:23Z')]))
    tc = v['terrain_control']
    cases.append(('verify: bedrock agrees within a seed', tc['within_seed'].get('111', {}).get('min_agreement'), 1.0))
    across = list(tc['across_seeds'].values())
    cases.append(('verify: bedrock does not agree across seeds (< 0.9)', bool(across) and max(across) < 0.9, True))
    try:
        hm.verify(req, st, live, log, day='2026-10-19', cat=cat, birth=birth, ls=ls)
        got = 'read a staging copy with no good backup line'
    except hm.Blind as e:
        got = 'refused' if 'good 2026-10-19' in str(e) else str(e)
    except Exception as e:                        # any other failure is not the refusal this case is about
        got = 'crashed: %s' % type(e).__name__
    cases.append(('verify: refuses without that day\'s "good" backup line', got, 'refused'))
    seeds = hm.Seeds.from_verify(dict(v, schema='mcai.hazardmap.verify'))
    cases.append(('verify -> Seeds: hive-c before the reseed is 111', seeds.seed_at('hive-c', T('2026-09-01T00:00:00Z'))[0], '111'))
    cases.append(('verify -> Seeds: hive-c after the quarantine is 999', seeds.seed_at('hive-c', T('2026-09-27T13:00:00Z'))[0], '999'))
    return cases


def request_cases(hm):
    good = {'schema': 'mcai.hazardmap.request', 'schema_version': 1, 'made_at': 'x',
            'probes': [{'id': 'a', 'world': 'hive-a', 'kind': 'lava', 'x': 1, 'y': 2, 'z': 3, 'r': 2}]}
    cases = [('request: a good one validates', bool(hm.validate_request(json.loads(json.dumps(good)))), True)]
    bad = {
        'world outside the pattern': dict(good['probes'][0], world='../etc'),
        'y out of range': dict(good['probes'][0], y=400),
        'radius 9': dict(good['probes'][0], r=9),
        'an extra field': dict(good['probes'][0], path='/etc/passwd'),
        'kind entombment': dict(good['probes'][0], kind='entombment'),
        'bool coordinate': dict(good['probes'][0], x=True),
    }
    for name, p in bad.items():
        try:
            hm.validate_request(dict(good, probes=[p]))
            got = 'accepted'
        except ValueError:
            got = 'refused'
        cases.append(('request: refused: ' + name, got, 'refused'))
    return cases


def serve_cases(sv, hm, tmp):
    cases = []
    out = os.path.join(tmp, 'sv', 'out', 'verify.json'); reqp = os.path.join(tmp, 'sv', 'in', 'request.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, 'w') as f:
        f.write('{"schema":"mcai.hazardmap.verify"}')

    def ask(req, stdin=b''):
        o = io.BytesIO()
        code = sv.serve(req, io.BytesIO(stdin), o, out=out, reqp=reqp, validate=hm.validate_request)
        return code, o.getvalue()
    cases.append(('serve: verify returns the file', ask('verify'), (0, b'{"schema":"mcai.hazardmap.verify"}')))
    good = json.dumps({'schema': 'mcai.hazardmap.request', 'schema_version': 1, 'made_at': 'x',
                       'probes': [{'id': 'a', 'world': 'hive-a', 'kind': 'lava', 'x': 1, 'y': 2, 'z': 3, 'r': 2}]}).encode()
    cases.append(('serve: a valid request is written', (ask('request', good)[0], os.path.exists(reqp)), (0, True)))
    os.remove(reqp)
    for bad in ('cat /etc/passwd', 'verify; id', 'verify x', 'request ../x', '', 'status x'):
        cases.append(('serve: refused [%s]' % bad, ask(bad, good), (2, b'')))
    cases.append(('serve: a bad request writes nothing', (ask('request', b'{"schema":"x"}'), os.path.exists(reqp)), ((2, b''), False)))
    cases.append(('serve: an oversize request writes nothing', (ask('request', good + b' ' * sv.MAX_BYTES)[0], os.path.exists(reqp)), (2, False)))
    code, body = ask('status')
    cases.append(('serve: status says request absent', (code, json.loads(body)['request']), (0, None)))
    return cases


def check_cases(hm, tmp):
    """check_line(): OK only when a fresh map, an ok heartbeat and a recent verify are all there; every gap is an ALARM."""
    cases = []
    home = os.path.join(tmp, 'chk'); out = os.path.join(home, 'out')
    os.makedirs(out, exist_ok=True)
    cases.append(('check: no map -> ALARM', hm.check_line(home, NOW)[1], 1))
    doc = {'generated_at': '2026-10-18T01:00:00Z', 'stale_after': '2026-10-19T13:00:00Z', 'seeds': {'S1': {'hazards': [{}]}},
           'controls': {'verify_backup_day': '2026-10-18', 'verify_made_at': '2026-10-18T01:30:00Z'},
           'value': {'headline': {'deaths': 9, 'known_from_another_world': 3}}}
    hm.atomic_json(os.path.join(out, 'hazardmap.json'), doc)
    hm.atomic_json(os.path.join(out, 'heartbeat.json'), {'status': 'ok', 'at': 'x'})
    cases.append(('check: a fresh map -> OK', hm.check_line(home, NOW)[1], 0))
    hm.atomic_json(os.path.join(out, 'hazardmap.json'), dict(doc, stale_after='2026-10-18T01:59:00Z'))
    cases.append(('check: past stale_after -> ALARM', hm.check_line(home, NOW)[1], 1))
    hm.atomic_json(os.path.join(out, 'hazardmap.json'), doc)
    hm.atomic_json(os.path.join(out, 'hazardmap.json'), dict(doc, controls={'verify_backup_day': '2026-10-16', 'verify_made_at': '2026-10-16T04:30:00Z'}))
    cases.append(('check: a verify 45 h old -> ALARM (rows after it are not folding)', hm.check_line(home, NOW)[1], 1))
    hm.atomic_json(os.path.join(out, 'hazardmap.json'), doc)
    hm.atomic_json(os.path.join(out, 'heartbeat.json'), {'status': 'gate_failed', 'at': 'x', 'error': 'e'})
    cases.append(('check: a failed gate -> ALARM', hm.check_line(home, NOW)[1], 1))
    return cases


def patch_cases(tmp):
    """patch_fleetstatus: the three anchored edits, idempotent, refuses a copy without the anchors; and the line it adds is
    None when the tool is not installed, the check's own line when it is, and an ALARM when the check prints nothing."""
    import importlib.util
    spec = importlib.util.spec_from_file_location('pf', os.path.join(HERE, 'patch_fleetstatus.py'))
    pf = importlib.util.module_from_spec(spec); spec.loader.exec_module(pf)
    base = ("import os\nimport sys\nimport datetime as dt\n\n\ndef _ts(s):\n    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))\n\n\n"
            "def frontier_line(now):\n    return 'f'\n\n\ndef main(now):\n    rep = {'frontier': frontier_line(now), 'x': 1}\n"
            "    if rep.get('frontier'):\n        print(rep['frontier'])\n    return rep\n")
    t1, why1 = pf.patch(base)
    t2, why2 = pf.patch(t1) if t1 else (None, None)
    c = [('patch: applies once, then already patched', (why1, why2), ('patched', 'already patched')),
         ('patch: refuses a copy without the anchors', pf.patch(base.replace('frontier_line(now), ', ''))[1][:12], 'anchor found'),
         ('patch: --revert restores the original exactly, keeping a later edit', pf.revert(t1 + '# later edit\n')[0], base + '# later edit\n'),
         ('patch: --revert of an unpatched copy is a no-op', pf.revert(base)[1], 'not patched')]
    # a structcount-like patch applied AFTER ours at the same _ts anchor: --revert leaves exactly the structcount-only file
    ts = "def _ts(s):\n    return dt.datetime.fromisoformat(str(s).replace('Z', '+00:00'))\n"
    sc = lambda t: t.replace(ts, ts + "\n\n# SC block\ndef sc_line(now):\n    return 'sc'\n\n", 1)
    c.append(('patch: --revert after a later structcount patch keeps the structcount patch', pf.revert(sc(t1))[0], sc(base)))
    ns = {}
    exec(compile(t1, 'patched', 'exec'), ns)
    home = os.path.join(tmp, 'hmhome')
    c.append(('fleetstatus line: no line when the tool is not installed', ns['hazardmap_line'](None, home=home), None))
    tool = os.path.join(home, 'app', 'scripts', 'host', 'hazardmap', 'hazardmap.py')
    os.makedirs(os.path.dirname(tool), exist_ok=True)
    with open(tool, 'w') as f:
        f.write("print('hazard map OK fixture')\n")
    c.append(('fleetstatus line: the check\'s own line', ns['hazardmap_line'](None, home=home), 'hazard map OK fixture'))
    with open(tool, 'w') as f:
        f.write("import sys\nsys.exit(1)\n")
    c.append(('fleetstatus line: a silent check is an ALARM', (ns['hazardmap_line'](None, home=home) or '')[:15], 'HAZARDMAP ALARM'))
    return c


def compact_cases(hm):
    c = []
    r = row('2026-10-22T00:01:43.889Z', 'placebo-a-Delta', '_lava_corridor', 'lava_corridor: lava beside the drop at 299,60,-97 after 7 samples; the leg is refused', (302.3, 63.4, -97.7))
    c.append(('compact: the corridor cell is the NAMED lava cell', hm.compact('corridor', r)[2:], [299, 60, -97, 'beside the drop']))
    r = row('2026-10-22T00:21:22.406Z', 'isolated-b-Echo', '_reflex_danger_block', 'cave_air', (388.7, 71, 102.1))
    c.append(('compact: danger with clear feet is the cell BELOW', hm.compact('danger', r)[2:], [388, 70, 102, 'below:cave_air']))
    r = row('2026-10-22T00:21:17.393Z', 'isolated-b-Echo', '_reflex_danger_block', 'lava', (386.3, 70.8, 102.6))
    c.append(('compact: danger with lava feet is the feet cell', hm.compact('danger', r)[2:], [386, 70, 102, 'feet:lava']))
    r = row('2026-10-22T00:30:21.603Z', 'isolated-d-Echo', '_death', 'drowned; was running gather | leading up: x', (324.3, 60.2, -218.3), 'drowning')
    c.append(('compact: a death keeps class and message head; negative z floors down', hm.compact('death', r)[2:],
              [324, 60, -219, 'drowning|drowned; was running gather']))
    c.append(('world_of: isolated bots log exp.pool self-*, the bot name is the world', hm.world_of('isolated-d-Echo'), 'isolated-d'))
    r = row('2026-10-22T00:00:00.000Z', 'hive-a-Alpha', '_lava_corridor', 'lava_corridor: unknown at 15,64,97 after 23 samples; the leg is refused', (1.5, 2, 3.5))
    c.append(('compact: a corridor refused for UNKNOWN cells is skipped, not unparsed', hm.compact('corridor', r)[0], 'skip'))
    r = row('2026-10-22T00:00:00.000Z', 'hive-a-Alpha', '_reflex_danger_block', 'vine', (1.5, 70, 3.5))
    c.append(('compact: danger with the feet in a vine is the cell BELOW', hm.compact('danger', r)[2:], [1, 69, 3, 'below:vine']))
    r = row('2026-10-22T00:00:00.000Z', 'hive-a-Alpha', '_death_site_recorded', 'death:other x1 at 373,2,147 (after a 29-block fall; 4 sites on file)', (1.5, 2, 3.5))
    c.append(('compact: the death site row names its cell', hm.compact('site', r)[2:], [373, 2, 147, 'other']))
    c.append(('categorize: vines are a fall', hm.categorize('fell off some vines after falling 26 blocks')[1], 'cave_fall'))
    c.append(('categorize: a stalactite after a fall is dripstone', hm.categorize('was skewered by a falling stalactite after falling 29 blocks; x')[1], 'dripstone'))
    c.append(('categorize: lava after a fall is lava', hm.categorize('tried to swim in lava after falling 6 blocks')[0], 'lava after a fall'))
    pts = [{'x': i, 'y': 0, 'z': 0} for i in range(0, 60, 2)]
    c.append(('cluster: a 60-block chain is split into 16-block tiles', len(hm.cluster(pts, (3, 4))), 4))
    c.append(('cluster: two cells 4 apart stay apart at link 3', len(hm.cluster([{'x': 0, 'y': 0, 'z': 0}, {'x': 4, 'y': 0, 'z': 0}], (3, 4))), 2))
    return c


# ------------------------------------------------------------------ code mutants
BEHAVIOUR = [
    ('value: five deaths were known from another world', "                        if p['world'] != d['world']:\n", "                        if True:\n"),
    ('value: ... three of them ONLY from another world', "            if not hit_same:\n", "            if True:\n"),
    ('value: ... three of them ONLY from another world', "                        else:\n                            hit_same = True",
     "                        elif p['t'] <= d['t'] - lag_ms:\n                            hit_same = True"),
    ('fold: hive-c after its reseed folds into S2', "            if s['from_ms'] <= t and (s['until_ms'] is None or t < s['until_ms']):",
     "            if s['from_ms'] <= t:"),
    ('fold: the quarantine row is dropped and counted', "                if t < s['from_ms'] + QUARANTINE_MS:", "                if False:"),
    ('fold: a 40-min DRY maroon spell is not', "        return 'water_pit' if wet >= 0.5 else 'excluded:marooned_dry'", "        return 'water_pit'"),
    ('fold: ... and not an entombment', "    if c.get('no_air', 0) / n >= 0.2:", "    if c.get('no_air', 0) / n >= 0.9:"),
    ('value: five deaths were known from another world', "                            if p['t'] <= d['t'] - lag_ms:", "                            if True:"),
    ('value_report: a match from a world since reseeded away is a legitimate match',
     "            if any(s['seed'] == d['seed'] and s['from_ms'] <= d['t'] - lag_ms\n                   for w, info in seeds.worlds.items() if w != d['world'] for s in info['segments']):",
     "            if sum(1 for w, info in seeds.worlds.items() for s in info['segments'] if s['seed'] == d['seed'] and s['until_ms'] is None) >= 2:"),
    ('fold: a lava cell seen once is not', "        return h['sightings']['episodes'] >= 2", "        return h['sightings']['episodes'] >= 1"),
    ('fold: two deaths in two worlds -> confidence high', "    if len(h['death_worlds']) >= 2 or d >= 3 or sh >= 6:", "    if d >= 3 or sh >= 6:"),
    ('verify flow: absent everywhere lowers confidence one step', "    if (h.get('exists') or {}).get('summary') == 'absent':",
     "    if False:"),
    ('verify flow: present in one world -> present, named', "    if 'present' in states:", "    if all(x == 'present' for x in states):"),
    ('fold: ... id anchors on its earliest evidence cell', "    first = min(P, key=lambda p: (p['t'], p['x'], p['y'], p['z']))",
     "    first = max(P, key=lambda p: (p['t'], p['x'], p['y'], p['z']))"),
    ('cluster: two cells 4 apart stay apart at link 3', "                    if abs(pi[0] - pj[0]) <= lxz and",
     "                    if abs(pi[0] - pj[0]) <= lxz + 1 and"),
    ('cluster: a 60-block chain is split into 16-block tiles', "        if max(xs) - min(xs) > max_extent or max(zs) - min(zs) > max_extent:",
     "        if False:"),
    ('compact: danger with clear feet is the cell BELOW', "            return [t, bot, x, y - 1, z, 'below:' + det]", "            return [t, bot, x, y, z, 'below:' + det]"),
    ('verify: P-pit absent in board-a', "            if all(is_solid(*b) for b in walls):", "            if True:"),
    ('verify: P-trap absent in board-a', "            if feet[0] is not None and is_water(*feet) and is_water(*head) and is_solid(*cap):",
     "            if feet[0] is not None and is_water(*feet):"),
    ('verify: P-drop absent in board-a', "        return {'state': 'present' if best >= 4 else 'absent', 'found': dict(found)}",
     "        return {'state': 'present' if best >= 0 else 'absent', 'found': dict(found)}"),
    ('verify: P-wlog present in hive-a', "    return name in WATER_NAMES or str((props or {}).get('waterlogged', 'false')) == 'true'",
     "    return name in WATER_NAMES"),
    ('verify: a probe in an ungenerated region -> not_generated', "    if sts == {'not_generated'}:", "    if False:"),
    ('verify: refuses without that day\'s "good" backup line', "    if not good:\n        raise Blind(", "    if False:\n        raise Blind("),
    ('request: refused: world outside the pattern', "        if not (isinstance(p['world'], str) and WORLD_RE.fullmatch(p['world'])):",
     "        if not isinstance(p['world'], str):"),
    ('request: refused: an extra field', "        if not isinstance(p, dict) or set(p) != {'id', 'world', 'kind', 'x', 'y', 'z', 'r'}:",
     "        if not isinstance(p, dict):"),
    ('cache: a late death changes the count -> that day is refetched',
     "            if recount(day, EsEvents, now_ms) == (rec['total'], rec['counts']):", "            if True:"),
    ('fold: a verify file older than 72 h is refused (the seeds may predate a reseed)', "    if age > VERIFY_MAX_AGE_H:", "    if False:"),
    ('terrain gate: a seed whose worlds disagree (0.8) is not merged', "        if (t.get('min_agreement') or 0) < TERRAIN_MIN_AGREE or",
     "        if False or"),
    ('terrain gate: too few compared cells (100) is not merged either', "or (t.get('min_cells') or 0) < TERRAIN_MIN_CELLS:", ":"),
    ('verify flow: late-ingested evidence (another fingerprint) voids an absence',
     "    changed = sorted(list(c) for c in probe_cells(h)) != res.get('cells') or res.get('fp') != h.get('evidence_fp')",
     "    changed = sorted(list(c) for c in probe_cells(h)) != res.get('cells')"),
    ('value(): a same-cell death on ANOTHER SEED never matches', "    return (seed, x // 8, z // 8)", "    return (None, x // 8, z // 8)"),
    ('value(): a different-kind prior is not a same-kind match', "                    if p['t'] >= d['t'] or (same_kind and p['kind'] != d['kind']):",
     "                    if p['t'] >= d['t']:"),
    ('value_report: a match on a one-world seed is refused (the subset guard)', "    if any(id(d) not in ids for d in matched):", "    if False:"),
    ('value: rotated about home, the priors match nothing (the town-density null)', "            dx, dz = -dz, dx", "            pass"),
    ('fold: death cells most-deaths first (not coordinate order)', "    return [list(k) for k, v in sorted(c.items(), key=lambda kv: (-kv[1][0], -kv[1][1], kv[0]))]",
     "    return [list(k) for k, v in sorted(c.items(), key=lambda kv: kv[0])]"),
    ('verify: a live world created after the backup is refused', "        if backup_ms is not None and parse_ms(info['created']) > backup_ms:",
     "        if False:"),
    ('coverage: a missing validated day raises', "    missing = [d for d in want if d not in by_day or by_day[d].get('void')]",
     "    missing = []"),
    ('coverage: a missing tail (today absent) raises', "    last = iso(now_ms)[:10] if now_ms - today0 > 3_600_000 else iso(today0 - DAY_MS)[:10]",
     "    last = max(by_day)"),
    ('coverage: a day that ended > 1 h ago but is cached open raises', "    if unclosed:\n", "    if False:\n"),
    ('lifetime: > 50 validated rows outside every world segment raise', "    if sum(lost_validated.values()) > VALIDATED_LOSS_OK:", "    if False:"),
    ('lifetime: a reseed in the window (60 quarantine rows) still builds',
     "            if t >= validated_ms and why == 'outside_world_lifetime' and not seeds.near_boundary(world, t):",
     "            if t >= validated_ms and why in ('outside_world_lifetime', 'quarantine'):"),
    ('compact: a campfire danger row is skipped, not lava', "        if det in DANGER_NOT_LAVA:\n            return ('skip', 'campfire')",
     "        if False:\n            return ('skip', 'campfire')"),
    ('heartbeat: a failed request push -> push_failed', "        if hbv.get('status') == 'ok':", "        if False:"),
    ('rare source: no-air quiet on the newest two days still builds', "        need_each = src not in RARE_SOURCES", "        need_each = True"),
    ('lifetime: 60 rows in a reseed downtime gap (near its edges) still build',
     "            if t >= validated_ms and why == 'outside_world_lifetime' and not seeds.near_boundary(world, t):",
     "            if t >= validated_ms and why == 'outside_world_lifetime':"),
    ('coverage: a partial day fetched long before the build raises', "        if reach < expect:", "        if False:"),
    ('heartbeat: rows after the seed horizon -> incomplete', "    if late:\n        return 'incomplete'", "    if False:\n        return 'incomplete'"),
    ('probe: an unread wall beyond the footprint makes a negative unknown', "    if res['state'] == 'absent' and (sts != {'ok'} or blind):",
     "    if res['state'] == 'absent' and sts != {'ok'}:"),
    ('seeds: a row after the observation horizon is not resolved', "        if self.horizon_ms is not None and t > self.horizon_ms:", "        if False:"),
    ('verify flow: an absence for OTHER probe cells no longer covers the hazard', "        elif r['state'] != 'present' and (changed or newer):",
     "        elif r['state'] != 'present' and newer:"),
    ('verify flow: evidence newer than the request voids an absence', "        elif r['state'] != 'present' and (changed or newer):",
     "        elif r['state'] != 'present' and changed:"),
    ('reduce: absent + unknown -> unknown', "    if st and all(x == 'absent' for x in st):", "    if st and 'absent' in st:"),
    ('verify: a reseed since the backup (staged and live seeds differ) is refused', "        if not live_raw or live_seed != seed:",
     "        if not live_raw:"),
    ('compact: a corridor refused for UNKNOWN cells is skipped, not unparsed', "                return ('skip', 'names no lava cell')",
     "                return ('unparsed', 'names no lava cell')"),
    ('check: past stale_after -> ALARM', "    if now_ms > parse_ms(doc['stale_after']):", "    if False:"),
    ('check: a failed gate -> ALARM', "    if hb.get('status') != 'ok':", "    if False:"),
    ('check: a verify 45 h old -> ALARM (rows after it are not folding)', "    if not vday or not vmade or now_ms - parse_ms(vmade) > VERIFY_ALARM_H * 3_600_000:",
     "    if not vday or not vmade:"),
    ('cache: 10-07 is refused, never loaded', "        if day in REFUSED_DAYS:\n            stats['refused'] += 1", "        if False:\n            stats['refused'] += 1"),
]
BLIND_CODE = [   # code mutants that blind the guards: the named blind-input case must then SURVIVE (the guard is what stops it)
    ('blind: give-ups renamed for the newest two days only', "        if (need_each and len(days_spoken) < len(window)) or not days_spoken:", "        if False:"),
    ('blind: fail_class renamed fire -> burning', "            if fc not in (FAIL_CLASSES if validated else HISTORY_FAIL_CLASSES) or cat is None:",
     "            if cat is None:"),
    ('blind: the corridor row cell reformatted', "        if seen and unp[src] / seen > UNPARSED_OK:", "        if False:"),
    ('blind: a world the seeds table does not know', "            if why == 'unknown_world' and t >= validated_ms:", "            if False:"),
    ('blind: the death position is not the recorded death site', "        if n >= 20 and (p < 0.9 * n or a < agree_floor * p):",
     "        if False:"),
    ('blind: three of one day\'s deaths renamed', "        if abs(nd - ns) > DEATH_SITE_SLACK:", "        if False:"),
    ('blind: death sites wrong on the newest day only (history dilutes the pooled agreement)',
     "    for n, p, a, agree_floor in ((len(deaths), paired, agree, 0.95), (len(recent), rp, ra, 0.85)):",
     "    for n, p, a, agree_floor in ((len(deaths), paired, agree, 0.95), (len(recent), rp, ra, 0.0)):"),
    ('blind: corridor rows reformatted on the newest day only (history dilutes the pooled share)',
     "        if r_ok + r_bad >= RECENT_PARSE_FLOOR and r_bad / (r_ok + r_bad) > UNPARSED_OK:", "        if False:"),
    ('blind: the wet kind renamed (every pit would read dry)', "        if not rec['counts'].get(WET_KIND):", "        if False:"),
]
SERVE = [
    ('serve: refused [verify x]', "    if parts == ['verify']:", "    if parts[:1] == ['verify']:"),
    ('serve: a bad request writes nothing', "            validate(doc)\n", "            pass\n"),
    ('serve: an oversize request writes nothing', "        if len(data) > MAX_BYTES:\n            return 2", "        if False:\n            return 2"),
]


def strip_comments(text):
    out = []
    for tok in tokenize.generate_tokens(io.StringIO(text).readline):
        if tok.type != tokenize.COMMENT:
            out.append(tok)
    return tokenize.untokenize(out)


def mutate(name, anchor, repl):
    src = open(SRC[name]).read()
    if src.count(anchor) != 1:
        return None, 'anchor occurs %d times in the source' % src.count(anchor)
    if strip_comments(src).count(anchor.strip().splitlines()[0].strip()) < 1:
        return None, 'anchor is only in a comment'
    return src.replace(anchor, repl, 1), None


def all_cases(hm, sv, tmp):
    """Every case group runs on its own: a group that crashes is ONE failing entry and the other groups still run, so a
    mutant is credited only through its own named case (Codex r1 P2: an unrelated crash is never a kill)."""
    c = []
    groups = [('compact', lambda: compact_cases(hm)), ('fold', lambda: fold_cases(hm)), ('blind', lambda: blind_cases(hm)),
              ('cache', lambda: cache_cases(hm, os.path.join(tmp, 'c1'))), ('request', lambda: request_cases(hm)),
              ('verify', lambda: verify_cases(hm, os.path.join(tmp, 'v1'))), ('serve', lambda: serve_cases(sv, hm, tmp)),
              ('check', lambda: check_cases(hm, tmp)), ('patch', lambda: patch_cases(tmp)), ('value', lambda: value_cases(hm)),
              ('guards', lambda: guard_cases(hm)), ('probe', lambda: probe_cases(hm))]
    for name, fn in groups:
        try:
            c += fn()
        except Exception as e:
            c.append(('group %s CRASHED' % name, '%s: %s' % (type(e).__name__, str(e)[:160]), 'no crash'))
    return c


def main(argv=None):
    tmp = tempfile.mkdtemp(prefix='hazardmap-test-')
    hm = load('hm'); sv = load('sv')
    results = all_cases(hm, sv, tmp)
    k = 0
    for case, anchor, repl in BEHAVIOUR:
        text, err = mutate('hm', anchor, repl)
        if err:
            results.append(('mutant ' + case, err, 'applies')); continue
        k += 1
        got = {c[0]: c for c in all_cases(load('hm', text), sv, os.path.join(tmp, 'm%d' % k))}
        if case not in got:
            results.append(('mutant ' + case, 'its case did not run (its group crashed)', 'KILLED')); continue
        results.append(('mutant ' + case, 'KILLED' if got[case][1] != got[case][2] else 'SURVIVED', 'KILLED'))
    for case, anchor, repl in BLIND_CODE:
        text, err = mutate('hm', anchor, repl)
        if err:
            results.append(('blind-guard mutant ' + case, err, 'applies')); continue
        got = {c[0]: c for c in blind_cases(load('hm', text))}
        # the guard was what stopped it: with the guard removed the blind input must BUILD A MAP (a crash proves nothing)
        results.append(('blind-guard mutant ' + case, 'KILLED' if got[case][1].startswith('SURVIVED') else 'NOT PROVEN: %s' % got[case][1][:80], 'KILLED'))
    for case, anchor, repl in SERVE:
        text, err = mutate('sv', anchor, repl)
        if err:
            results.append(('mutant ' + case, err, 'applies')); continue
        k += 1
        got = {c[0]: c for c in serve_cases(load('sv', text), hm, os.path.join(tmp, 's%d' % k))}
        results.append(('mutant ' + case, 'KILLED' if got[case][1] != got[case][2] else 'SURVIVED', 'KILLED'))
    shutil.rmtree(tmp, ignore_errors=True)
    bad = [c for c in results if c[1] != c[2]]
    for c in results:
        print('%-78s %s' % (c[0][:78], 'ok' if c[1] == c[2] else 'FAIL: got %r want %r' % (c[1], c[2])))
    print('%d cases, %d failed' % (len(results), len(bad)))
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
