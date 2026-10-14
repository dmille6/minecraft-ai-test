#!/usr/bin/env python3
"""Behaviour tests for lib/estelemetry.py against a small in-memory Elasticsearch.

No network, no credentials. `FakeES` evaluates the subset of the query DSL the library sends
(bool/filter/should, range, term, terms, prefix, exists, match_phrase; terms, date_histogram,
stats, max and top_hits aggregations; _count; point-in-time + search_after), so the tests check
what the library ANSWERS, not the text of what it sends. A few builder tests also pin the
request body where the shape itself is the contract (fixed_interval, min_doc_count).

Run: python3 scripts/test_estelemetry.py        (exit 1 on any failure)
ESTELEMETRY_SRC=<dir> points the import at a mutated copy (scripts/test_estelemetry_mutants.py).
"""
import datetime as dt
import importlib.util
import io
import json
import os
import re
import stat
import sys
import tempfile
import traceback
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
SRC = os.environ.get('ESTELEMETRY_SRC') or os.path.join(HERE, 'lib')
spec = importlib.util.spec_from_file_location('estelemetry', os.path.join(SRC, 'estelemetry.py'))
T = importlib.util.module_from_spec(spec)
spec.loader.exec_module(T)
from lib.telemetry import ZeroLooksWrong as FileZeroLooksWrong  # noqa: E402

PASS = FAIL = 0
NOW = '2026-10-14T20:00:00Z'


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


def raises(exc, fn, contains=None):
    try:
        fn()
    except exc as e:
        if contains and contains not in str(e):
            raise AssertionError(f'{exc.__name__} raised but without {contains!r}: {e}')
        return e
    raise AssertionError(f'expected {exc.__name__}, nothing raised')


# ------------------------------------------------------------------------------ fake ES
def ms(ts):
    return int(dt.datetime.fromisoformat(ts.replace('Z', '+00:00')).timestamp() * 1000)


def leafy(v):
    if isinstance(v, dict):
        return any(leafy(x) for x in v.values())
    if isinstance(v, list):
        return any(leafy(x) for x in v)
    return v is not None


def tokens(text):
    return [t for t in re.split(r'[^0-9a-z_]+', str(text).lower()) if t]


def get(d, path):
    for p in path.split('.'):
        if not isinstance(d, dict) or p not in d:
            return None
        d = d[p]
    return d


class FakeES:
    def __init__(self, docs, other=0, timed_out=False, err=0, err_nested=0):
        self.docs = docs
        self.err_nested = err_nested  # an error bound ONLY on nested terms (sub-aggregations)
        self.other = other          # inject a truncated terms answer
        self.err = err              # inject a doc_count_error_upper_bound
        self.timed_out = timed_out
        self.calls = []
        self.pits = {}

    def match(self, q, d):
        if not q:
            return True
        (k, v), = q.items()
        if k == 'bool':
            ok = all(self.match(x, d) for x in v.get('filter', []))
            if 'should' in v:
                ok = ok and sum(self.match(x, d) for x in v['should']) >= v.get('minimum_should_match', 1)
            return ok
        if k == 'range':
            (f, r), = v.items()
            t = ms(get(d, f))
            return (('gte' not in r or t >= ms(r['gte'])) and ('lt' not in r or t < ms(r['lt'])))
        if k == 'term':
            (f, x), = v.items()
            return get(d, f) == x
        if k == 'terms':
            (f, xs), = v.items()
            return get(d, f) in xs
        if k == 'prefix':
            (f, x), = v.items()
            return isinstance(get(d, f), str) and get(d, f).startswith(x)
        if k == 'exists':
            # real ES: true only if a LEAF is indexed -- null, {} and [] are not
            return leafy(get(d, v['field']))
        if k == 'match_phrase':
            # standard-analyzer approximation: lowercase, split on non-alphanumerics, adjacent tokens
            (f, x), = v.items()
            hay, needle = tokens(get(d, f) or ''), tokens(x)
            return any(hay[i:i + len(needle)] == needle for i in range(len(hay) - len(needle) + 1))
        raise NotImplementedError(k)

    def agg(self, spec, docs, nested=False):
        (k, v), = ((k, v) for k, v in spec.items() if k != 'aggs')
        sub = spec.get('aggs')
        if k == 'terms':
            groups = {}
            for d in docs:
                x = get(d, v['field'])
                if x is None and 'missing' in v:
                    x = v['missing']
                if x is not None:
                    groups.setdefault(x, []).append(d)
            keys = sorted(groups, key=lambda x: (-len(groups[x]), str(x)))
            out = {'buckets': [], 'sum_other_doc_count': self.other,
                   'doc_count_error_upper_bound': self.err_nested if nested else self.err}
            for x in keys[:v.get('size', 10)]:
                b = {'key': x, 'doc_count': len(groups[x])}
                if sub:
                    b.update({n: self.agg(s, groups[x], True) for n, s in sub.items()})
                out['buckets'].append(b)
            return out
        if k == 'date_histogram':
            step = {'1h': 3_600_000, '1d': 86_400_000, '10m': 600_000, '1m': 60_000}[v['fixed_interval']]
            groups = {}
            for d in docs:
                groups.setdefault(ms(d['@timestamp']) // step * step, []).append(d)
            if v.get('min_doc_count') == 0 and 'extended_bounds' in v:
                lo = ms(v['extended_bounds']['min']) // step * step
                hi = ms(v['extended_bounds']['max'])
                for t in range(lo, hi, step):
                    groups.setdefault(t, [])
            out = {'buckets': []}
            for t in sorted(groups):
                b = {'key': t, 'doc_count': len(groups[t]),
                     'key_as_string': dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc)
                     .strftime('%Y-%m-%dT%H:%M:%S.000Z')}
                if sub:
                    b.update({n: self.agg(s, groups[t], True) for n, s in sub.items()})
                out['buckets'].append(b)
            return out
        if k == 'stats':
            xs = [ms(d['@timestamp']) for d in docs]
            return {'count': len(xs), 'min': min(xs) if xs else None, 'max': max(xs) if xs else None}
        if k == 'max':
            xs = [d['@timestamp'] for d in docs]
            return {'value': max(map(ms, xs)) if xs else None, 'value_as_string': max(xs) if xs else None}
        if k == 'top_hits':
            ds = sorted(docs, key=lambda d: ms(d['@timestamp']), reverse=True)[:v['size']]
            return {'hits': {'hits': [{'_source': d} for d in ds]}}
        raise NotImplementedError(k)

    def paths(self):
        out = set()

        def walk(o, pre):
            for k, v in o.items():
                out.add(pre + k)
                if isinstance(v, dict):
                    walk(v, pre + k + '.')
        for d in self.docs:
            walk(d, '')
        return out

    def __call__(self, method, path, body):
        self.calls.append((method, path, body))
        if '/_field_caps?fields=' in path:
            f = path.split('fields=')[1]
            return {'fields': {f: {'keyword': {}}} if f in self.paths() else {}}
        if path.endswith('_pit?keep_alive=2m'):
            pid = f'pit{len(self.pits)}'
            self.pits[pid] = list(self.docs)
            return {'id': pid}
        if method == 'DELETE':
            self.closed = getattr(self, 'closed', []) + [body['id']]
            return {'succeeded': True}
        if path == '_search' and body and 'pit' in body:
            docs = [d for d in self.pits[body['pit']['id']] if self.match(body['query'], d)]
            if body.get('size') == 0:
                return {'hits': {'total': {'value': len(docs)}, 'hits': []}, 'pit_id': body['pit']['id']}
            docs.sort(key=lambda d: ms(d['@timestamp']))
            start = body['search_after'][1] + 1 if body.get('search_after') else 0
            hits = [{'_source': d, 'sort': [ms(d['@timestamp']), i]}
                    for i, d in enumerate(docs)][start:start + body['size']]
            return {'hits': {'hits': hits}, 'pit_id': body['pit']['id']}
        docs = [d for d in self.docs if self.match((body or {}).get('query'), d)]
        if path.endswith('/_count'):
            return {'count': len(docs)}
        r = {'hits': {'total': {'value': len(docs)}, 'hits': []}, 'timed_out': self.timed_out,
             '_shards': {'total': 1, 'successful': 1, 'failed': 0}}
        if 'aggs' in body:
            r['aggregations'] = {n: self.agg(s, docs) for n, s in body['aggs'].items()}
        return T.check_reply(path, r)


def doc(ts, name, bot='board-a-Alpha', pool='board-a', status='success', fail=None, version='2ec1938+f21576',
        inv=None, detail=''):
    d = {'@timestamp': ts, 'skill': {'name': name, 'status': status},
         'bot': {'name': bot}, 'exp': {'pool': pool}, 'code': {'version': version}}
    if detail:
        d['skill']['detail'] = detail
    if pool is None:
        del d['exp']
    if fail:
        d['skill']['fail_class'] = fail
    if inv is not None:                       # a state snapshot: inventory always comes with pos
        d['bot']['inventory'] = inv
        d['bot']['pos'] = {'x': 1.5, 'y': 64.0, 'z': 2.5}
    return d


DOCS = [
    doc('2026-10-14T10:00:00.000Z', 'gather', status='success'),
    doc('2026-10-14T10:05:00.000Z', 'gather', status='failed', bot='hive-a-Bravo', pool='hive-a'),
    doc('2026-10-14T10:10:00.000Z', 'gather', status='success', bot='hive-a-Bravo', pool='hive-a'),
    doc('2026-10-14T11:00:00.000Z', '_death', status='failed', fail='drowning', bot='hive-a-Bravo', pool='hive-a'),
    doc('2026-10-14T11:30:00.000Z', '_death', status='failed', fail='fire'),
    doc('2026-10-14T12:00:00.000Z', 'town_deposit', status='success'),
    doc('2026-10-14T12:00:01.000Z', '_town_deposit', status='success'),
    doc('2026-10-14T12:00:02.000Z', '_town_deposit', status='success'),
    doc('2026-10-14T13:00:00.000Z', 'craft', status='failed', version='2ec19385+aaaa'),
    doc('2026-10-14T13:30:00.000Z', '_affordance_scan', inv={'cobblestone': 64}),
    doc('2026-10-14T14:00:00.000Z', '_affordance_scan', inv={'cobblestone': 128}, detail='visible=51 usable=19'),
]
DEATH_NO_POOL = doc('2026-10-14T11:45:00.000Z', '_death', status='failed', fail='fall', bot='hive-c-Echo', pool=None)


def ev(docs=DOCS, since='2026-10-14T00:00:00Z', until='2026-10-14T18:00:00Z', **kw):
    fake = kw.pop('fake', None) or FakeES(docs)
    return T.EsEvents.load('skill', since=since, until=until, client=fake, now=NOW, **kw)


# ------------------------------------------------------------------------------ tests
def t_count_exact():
    e = ev()
    assert e.count('gather') == 3
    assert e.count('gather', status='success') == 2
    assert e.count('_death', fail_class='drowning') == 1


def t_count_does_not_fold_underscore():
    """town_deposit (skill) and _town_deposit (event) are different kinds; folding double-counts."""
    e = ev()
    assert e.count('town_deposit') == 1
    assert e.count('_town_deposit') == 2


def t_zero_typo_kind_raises():
    raises(T.ZeroLooksWrong, lambda: ev().count('gahter'), contains='gather')


def t_zero_underscore_variant_raises():
    raises(T.ZeroLooksWrong, lambda: ev().count('death'), contains='_death')


def t_zero_underscore_variant_named_even_when_crowded():
    """difflib returns at most 4 names; with 4 equally close look-alikes the `_kind` variant --
    the most likely intended name -- would be crowded out of the message. It is named first."""
    docs = DOCS + [doc('2026-10-14T15:00:00.000Z', n) for n in ('deatha', 'deathb', 'deathc', 'deathd')]
    e = raises(T.ZeroLooksWrong, lambda: ev(docs).count('death'))
    assert str(e).split('these exist: ')[1].startswith('_death'), str(e)


def t_zero_same_class_as_file_reader():
    assert T.ZeroLooksWrong is FileZeroLooksWrong


def t_zero_empty_window_raises():
    raises(T.ZeroLooksWrong, lambda: ev(bots=['no-such-bot-zz']).count('gather'), contains='matched no documents')


def t_zero_future_window_raises():
    e = ev(since='2026-10-14T19:00:00Z', until='2026-10-14T19:30:00Z')
    raises(T.ZeroLooksWrong, lambda: e.count('gather'), contains='future')


def t_zero_typo_value_raises():
    raises(T.ZeroLooksWrong, lambda: ev().count('gather', status='sucess'), contains='success')


def t_zero_field_absent_for_kind_raises():
    """fail_class is never set on gather rows: 'gather fail_class=drowning: 0' is no finding."""
    raises(T.ZeroLooksWrong, lambda: ev().count('gather', fail_class='drowning'), contains='NO values')


def t_genuine_zero_returns_with_control():
    e = ev()
    n = e.count('smelt')                        # absent, no near-miss, window has documents
    assert n == 0 and n.control['window_docs'] == len(DOCS)
    n2 = e.count('_death', fail_class='fall')   # field present for the kind, value absent, no near-miss
    assert n2 == 0 and n2.control['skill.fail_class values'] == 2


def t_allow_zero_bypasses():
    assert ev().count('gahter', allow_zero=True) == 0


def t_null_match_refused():
    raises(ValueError, lambda: ev().count('gather', match={'skill.fail_class': None}), contains='null from absent')


def t_rate_requires_bots():
    raises(TypeError, lambda: ev().rate('gather'))


def t_rate_auto():
    e = ev()
    span = (ms('2026-10-14T14:00:00.000Z') - ms('2026-10-14T10:00:00.000Z')) / 3_600_000
    assert abs(e.rate('gather', bots='auto') - 3 / (2 * span)) < 1e-9
    assert abs(e.rate('gather', bots=4) - 3 / (4 * span)) < 1e-9


def t_replay_refused():
    raises(T.ReplayWindow, lambda: ev(since='2026-10-06T12:00:00Z', until='2026-10-08T12:00:00Z'), contains='re-sends')


def t_replay_clip_start():
    e = ev(since='2026-10-07T19:00:00Z', until='2026-10-14T19:00:00Z', gaps='clip')
    assert e.since == dt.datetime(2026, 10, 8, tzinfo=dt.timezone.utc)
    assert any('window start moved' in c for c in e.caveats)


def t_replay_clip_inside_raises():
    raises(T.ReplayWindow, lambda: ev(since='2026-10-07T01:00:00Z', until='2026-10-07T02:00:00Z', gaps='clip'))


def t_replay_allow_caveat():
    e = ev(since='2026-10-06T12:00:00Z', until='2026-10-08T12:00:00Z', gaps='allow')
    assert any(c.startswith('INCLUDES A REPLAY DAY') for c in e.caveats)


def t_rotation_caveat():
    assert T.rotations_crossed(T._parse('2026-10-13T12:00:00Z'), T._parse('2026-10-14T12:00:00Z')) == 1
    assert T.rotations_crossed(T._parse('2026-10-14T00:01:00Z'), T._parse('2026-10-14T23:56:00Z')) == 0
    # a window starting AT 00:00 still holds that night's 00:00:0x losses: 7 nights + the first
    assert T.rotations_crossed(T._parse('2026-10-08T00:00:00Z'), T._parse('2026-10-15T00:00:00Z')) == 8
    assert T.rotations_crossed(T._parse('2026-10-08T00:01:00Z'), T._parse('2026-10-14T23:57:00Z')) == 6
    assert any('log rotation' in c for c in ev(since='2026-10-13T12:00:00Z').caveats)
    assert not any('log rotation' in c for c in ev(since='2026-10-14T01:00:00Z').caveats)
    n = ev(since='2026-10-13T12:00:00Z').count('gather')
    assert any('log rotation' in c for c in n.caveats)


def t_lag_caveat():
    assert any('ingest lag' in c for c in ev(until='2026-10-14T19:59:00Z').caveats)
    assert not any('ingest lag' in c for c in ev(until='2026-10-14T18:00:00Z').caveats)


def t_before_validation_caveat():
    assert any('NOT validated' in c for c in ev(since='2026-10-05T00:00:00Z', until='2026-10-06T00:00:00Z').caveats)


def t_by_pool_by_bot():
    e = ev()
    assert dict(e.by_pool('_death')) == {'hive-a': 1, 'board-a': 1}
    assert dict(e.by_bot('gather', status='success')) == {'board-a-Alpha': 1, 'hive-a-Bravo': 1}
    raises(T.ZeroLooksWrong, lambda: e.by_pool('_deaht'), contains='_death')


def t_terms_truncation_raises():
    e = ev(fake=FakeES(DOCS, other=5))
    raises(T.EsError, lambda: e.by_pool('_death'), contains='truncated')


def t_histogram_split_and_body():
    fake = FakeES(DOCS)
    e = ev(fake=fake)
    h = e.histogram('_death', interval='1h', split='exp.pool')
    assert dict(h) == {'2026-10-14T11:00:00.000Z': {'hive-a': 1, 'board-a': 1}}
    body = fake.calls[-1][2]
    assert body['aggs']['h']['date_histogram'] == {'field': '@timestamp', 'fixed_interval': '1h', 'min_doc_count': 1}
    assert body['aggs']['h']['aggs']['s']['terms']['field'] == 'exp.pool'


def t_partial_reply_raises():
    raises(T.EsError, lambda: T.check_reply('x', {'timed_out': True}), contains='TIMED OUT')
    raises(T.EsError, lambda: T.check_reply('x', {'_shards': {'total': 3, 'failed': 1}}), contains='FAILED')
    raises(T.EsError, lambda: ev(fake=FakeES(DOCS, timed_out=True)).by_pool('_death'))


def t_rows_refuse_eagerly():
    fake = FakeES(DOCS)
    e = ev(fake=fake)
    raises(T.TooManyRows, lambda: e.rows(max_rows=3))      # raised by the CALL, before iterating
    fetched = [c for c in fake.calls if c[1] == '_search' and (c[2] or {}).get('size')]
    assert not fetched, 'fetched rows before refusing'
    assert getattr(fake, 'closed', []), 'the PIT was left open after refusing'


def t_rows_cap_holds_against_late_docs():
    """The count is taken inside the PIT, so documents arriving afterwards cannot slip past it."""
    fake = FakeES(list(DOCS))
    e = ev(fake=fake)
    it = e.rows(max_rows=len(DOCS))
    fake.docs.extend(doc('2026-10-14T15:%02d:00.000Z' % i, 'gather') for i in range(5))
    assert len(list(it)) == len(DOCS)


def t_rows_short_read_raises():
    class ShortCount(FakeES):
        def __call__(self, method, path, body):
            r = super().__call__(method, path, body)
            if path == '_search' and body and body.get('size') == 0 and 'pit' in body:
                r['hits']['total']['value'] += 2
            return r
    raises(T.EsError, lambda: list(ev(fake=ShortCount(DOCS)).rows()), contains='not a complete read')


def t_rows_stream_never_exceeds_its_count():
    """If the snapshot ever streams more than it counted, stop BEFORE yielding the excess."""
    class LyingCount(FakeES):
        def __call__(self, method, path, body):
            r = super().__call__(method, path, body)
            if path == '_search' and body and body.get('size') == 0 and 'pit' in body:
                r['hits']['total']['value'] = 3
            return r
    got = []
    try:
        for row in ev(fake=LyingCount(DOCS)).rows(max_rows=100):
            got.append(row)
    except T.EsError as e:
        assert 'more than' in str(e), e
    else:
        raise AssertionError('streamed past its own count without raising')
    assert len(got) == 3, len(got)


def t_rows_paginate_all():
    e = ev()
    got = list(e.rows(page=2))
    assert [d['@timestamp'] for d in got] == sorted(d['@timestamp'] for d in DOCS)
    assert len(e.where('gather', lambda r: r['skill']['status'] == 'success')) == 2


def t_latest_inventory():
    e = ev()
    lat = e.latest(require='bot.pos.x', fields=['bot.inventory'])
    assert lat['board-a-Alpha']['bot']['inventory'] == {'cobblestone': 128}
    raises(T.ZeroLooksWrong, lambda: e.latest(require='bot.inventroy'), contains='none carries')
    raises(T.ZeroLooksWrong, lambda: e.latest(per='bot.nmae'), contains='NO document')


def t_latest_sees_an_emptied_bag():
    """exists on a flattened field is false for {}: requiring bot.inventory would show the OLD,
    full bag of a bot that just emptied it. The pos marker sees the empty snapshot."""
    docs = DOCS + [doc('2026-10-14T15:00:00.000Z', '_affordance_scan', inv={})]
    e = ev(docs)
    assert e.latest(require='bot.pos.x')['board-a-Alpha']['bot']['inventory'] == {}
    assert e.latest(require='bot.inventory')['board-a-Alpha']['bot']['inventory'] == {'cobblestone': 128}


def t_version_filter():
    e = ev(version='2ec1938')
    assert e.total() == len(DOCS) - 1            # 2ec19385+aaaa is a different sha


def t_detail_contains_is_a_token_phrase():
    e = ev()
    assert e.count('_affordance_scan', detail_contains='usable=19') == 1
    assert e.count('_affordance_scan', detail_contains='USABLE=19') == 1       # case-insensitive
    # not a substring search -- and a zero from it is never trusted silently
    raises(T.ZeroLooksWrong, lambda: e.count('_affordance_scan', detail_contains='sable=19'), contains='TOKEN')
    assert e.count('_affordance_scan', detail_contains='sable=19', allow_zero=True) == 0
    assert any('TOKEN phrase' in c for c in e.count('_affordance_scan', detail_contains='usable=19').caveats)


def t_detail_field_absent_raises():
    """gather rows here carry no skill.detail at all: 'no gather mentions diamond' is no finding."""
    raises(T.ZeroLooksWrong, lambda: ev().count('gather', detail_contains='diamond'), contains='skill.detail')


def t_terms_unknown_field_raises():
    raises(T.ZeroLooksWrong, lambda: ev().terms('exp.poool', '_death'), contains='exp.poool')
    raises(T.ZeroLooksWrong, lambda: ev().histogram('_death', split='exp.poool'), contains='exp.poool')


def t_detail_zero_rule_in_every_api():
    e = ev()
    raises(T.ZeroLooksWrong, lambda: e.terms('exp.pool', '_affordance_scan', detail_contains='sable=19'), contains='TOKEN')
    raises(T.ZeroLooksWrong, lambda: e.by_pool('_affordance_scan', detail_contains='sable=19'), contains='TOKEN')
    raises(T.ZeroLooksWrong, lambda: e.histogram('_affordance_scan', detail_contains='sable=19'), contains='TOKEN')
    raises(T.ZeroLooksWrong, lambda: e.rows('_affordance_scan', detail_contains='sable=19'), contains='TOKEN')
    assert list(e.rows('_affordance_scan', detail_contains='sable=19', allow_zero=True)) == []
    z = e.by_pool('_affordance_scan', detail_contains='sable=19', allow_zero=True)
    assert z == {} and any('TOKEN phrase' in c for c in z.caveats)
    hit = e.by_pool('_affordance_scan', detail_contains='usable=19')
    assert hit == {'board-a': 1} and any('TOKEN phrase' in c for c in hit.caveats)


def t_field_check_survives_allow_zero():
    """allow_zero says absence of EVENTS is the question; a misspelt field is never an answer."""
    raises(T.ZeroLooksWrong, lambda: ev().terms('exp.poool', '_death', allow_zero=True), contains='exp.poool')
    raises(T.ZeroLooksWrong, lambda: ev().histogram('_death', split='exp.poool', allow_zero=True))
    assert ev(bots=['no-such-bot-zz']).terms('exp.pool', '_death', allow_zero=True) == {}


def t_quiet_window_field_check():
    """A window where the kind is absent: a real field gives an honest empty answer, a misspelt
    one is still caught -- by the mapping, not by other kinds' documents."""
    e = ev(since='2026-10-14T13:00:00Z', until='2026-10-14T18:00:00Z')      # no _death in here
    assert e.terms('skill.fail_class', '_death', allow_zero=True) == {}
    assert e.by_pool('_death', allow_zero=True) == {}
    raises(T.ZeroLooksWrong, lambda: e.terms('exp.poool', '_death', allow_zero=True), contains='not mapped')


def t_coverage_short_gaps():
    assert ev(since='2026-10-14T10:00:00Z', until='2026-10-14T10:20:00Z').coverage()['empty_10min'] == []
    c = ev(since='2026-10-14T10:00:00Z', until='2026-10-14T11:00:00Z').coverage()
    assert c['empty_10min'] == ['2026-10-14T10:20', '2026-10-14T10:30', '2026-10-14T10:40', '2026-10-14T10:50'], c
    assert c['empty_hours'] == []          # the hour itself is not empty: only the 10-minute view sees it


def t_terms_error_bound_raises():
    raises(T.EsError, lambda: ev(fake=FakeES(DOCS, err=2)).by_pool('_death'), contains='error bound')
    raises(T.EsError, lambda: ev(fake=FakeES(DOCS, err=2)).latest(require='bot.pos.x'), contains='latest()')


def t_nested_error_bound_raises():
    """Nested terms (coverage's bots per hour, a histogram split) must be held to the same rule."""
    e = ev(fake=FakeES(DOCS, err_nested=2))
    raises(T.EsError, lambda: e.coverage(), contains='coverage()')
    raises(T.EsError, lambda: e.histogram('_death', split='exp.pool'), contains='histogram split')
    assert ev().histogram('_death', split='exp.pool')     # the same calls pass without the bound


def t_coverage():
    e = ev(since='2026-10-14T09:30:00Z', until='2026-10-14T15:00:00Z')
    c = e.coverage()
    # hours 10..14 hold docs; 09:00 is a partial hour (not judged); none empty
    assert c['empty_hours'] == [], c
    assert c['bot_hours'] == 7, c         # 10:a,h 11:a,h 12:a 13:a 14:a
    assert c['newest'] == T._parse('2026-10-14T14:00:00Z')
    c2 = ev(since='2026-10-14T10:00:00Z', until='2026-10-14T18:00:00Z').coverage()
    assert c2['empty_hours'] == ['2026-10-14T15', '2026-10-14T16', '2026-10-14T17'], c2
    # edge hours count only their overlap: 10:30..13:15 -> 10h none in window (its docs are at
    # 10:00-10:10), 11h a,h, 12h a, 13h a for 0.25 h
    c3 = ev(since='2026-10-14T10:30:00Z', until='2026-10-14T13:15:00Z').coverage()
    assert c3['bot_hours'] == 2 + 1 + 0.25, c3
    c4 = ev(since='2026-10-14T09:45:00Z', until='2026-10-14T13:15:00Z').coverage()
    assert c4['bot_hours'] == 2 + 2 + 1 + 0.25, c4      # 10h a,h are full hours here


def t_terms_missing_bucket_reconciles():
    e = ev(DOCS + [DEATH_NO_POOL])
    bp = e.by_pool('_death')
    assert bp[T.MISSING] == 1 and sum(bp.values()) == e.count('_death') == 3


def t_key_mode_refused_and_never_echoed():
    """A server that ECHOES the Authorization header into its error body must not get the key
    into our exception text (the first version of this test could not fail: its fake body never
    contained the key)."""
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'k')
        secret = 'abc123id:SECRETVALUE99'
        with open(p, 'w') as fh:
            fh.write(secret)
        old = T.KEY_FILE
        T.KEY_FILE = p
        try:
            os.chmod(p, 0o644)
            raises(T.EsError, T._auth_header, contains='group/other')
            os.chmod(p, stat.S_IRUSR | stat.S_IWUSR)
            auth = T._auth_header()
            assert auth.startswith('ApiKey ') and 'SECRET' not in auth

            def echo(req, timeout=0):
                body = json.dumps({'error': 'denied for ' + req.get_header('Authorization') + ' / ' + secret})
                raise urllib.error.HTTPError(req.full_url, 401, 'no', {}, io.BytesIO(body.encode()))
            real = T._OPENER.open
            T._OPENER.open = echo
            try:
                e = raises(T.EsError, lambda: T.http('POST', 'x/_count', {}))
                msg = str(e)
                assert '<redacted>' in msg, msg
                for leak in (secret, 'SECRETVALUE99', 'abc123id', auth.split(' ')[1]):
                    assert leak not in msg, (leak, msg)
            finally:
                T._OPENER.open = real
        finally:
            T.KEY_FILE = old


def _with_key(fn):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'k')
        with open(p, 'w') as fh:
            fh.write('abc123id:SECRETVALUE99')
        os.chmod(p, stat.S_IRUSR | stat.S_IWUSR)
        old = T.KEY_FILE
        T.KEY_FILE = p
        try:
            return fn(T._auth_header().split(' ')[1])
        finally:
            T.KEY_FILE = old


def _no_fragment(tok, msg, n=8):
    for i in range(len(tok) - n + 1):
        assert tok[i:i + n] not in msg, (tok[i:i + n], msg)
    for part in ('SECRETVALUE99', 'abc123id'):
        assert part not in msg, (part, msg)


def t_scrub_before_truncate():
    """A key straddling the truncation point must not leave a fragment behind."""
    def go(tok):
        for pad in (280, 290, 295, 390, 395):
            def boom(req, timeout=0):
                body = 'x' * pad + req.get_header('Authorization') + ' tail'
                raise urllib.error.HTTPError(req.full_url, 500, 'no', {}, io.BytesIO(body.encode()))
            real = T._OPENER.open
            T._OPENER.open = boom
            try:
                e = raises(T.EsError, lambda: T.http('POST', 'x/_count', {}))
            finally:
                T._OPENER.open = real
            _no_fragment(tok, str(e))
    _with_key(go)


def t_redirect_refused_without_echo():
    assert any(isinstance(h, T._NoRedirect) for h in T._OPENER.handlers), 'http() opener lacks the refusal'
    h = T._NoRedirect()
    e = raises(T.EsError, lambda: h.redirect_request(None, None, 302, 'Found', {}, 'http://elsewhere/?k=SECRET'),
               contains='redirect')
    assert 'SECRET' not in str(e) and 'elsewhere' not in str(e)

    def go(tok):
        def boom(req, timeout=0):          # any exception text from the opener is scrubbed too
            raise T.EsError('refused ' + req.get_header('Authorization'))
        real = T._OPENER.open
        T._OPENER.open = boom
        try:
            e2 = raises(T.EsError, lambda: T.http('POST', 'x/_count', {}))
        finally:
            T._OPENER.open = real
        _no_fragment(tok, str(e2))
    _with_key(go)


TESTS = [(n, f) for n, f in sorted(globals().items()) if n.startswith('t_') and callable(f)]

if __name__ == '__main__':
    for n, f in TESTS:
        check(n[2:], f)
    print(f'{PASS} passed, {FAIL} failed')
    sys.exit(1 if FAIL else 0)
