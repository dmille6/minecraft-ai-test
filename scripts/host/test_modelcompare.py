#!/usr/bin/env python3
"""test_modelcompare.py -- modelcompare.py's pure parts: the windows (the ramp is in none), canary exclusion by overlap,
confounds (canaries and promotions), the decision-stream metrics (work orders excluded, None without a denominator),
the 7-day median (>= 3 readable days), and render (UNREADABLE, never 0)."""
import datetime as dt
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import modelcompare as C  # noqa: E402

T = []
U = dt.timezone.utc


def t(name, ok, detail=''):
    T.append(bool(ok))
    print('%s  %s' % ('PASS' if ok else 'FAIL', name) + ('' if ok else '\n        -> %r' % (detail,)))


def d(h):
    return dt.datetime(2026, 10, 31, 0, tzinfo=U) + dt.timedelta(hours=h)


def main():
    w = C.windows(d(17), d(18))
    t('windows: EXP starts at completion, PRE ends at the start, 7 days before PRE; the ramp is in none',
      w[0] == ('EXP', d(18), d(42)) and w[1] == ('PRE', d(-7), d(17)) and w[2] == ('D1', d(-31), d(-7)) and len(w) == 9
      and not any(a < d(18) and b > d(17) for _, a, b in w))
    J = [{'run': 'c1', 'phase': 'deployed', 'note': 'board-a,hive-a 2026', 'ts': '2026-10-31T10:00:00Z'},
         {'run': 'c1', 'phase': 'recorded', 'note': 'KEEP', 'ts': '2026-10-31T13:00:00Z'},
         {'run': 'c1', 'phase': 'promoted', 'note': 'x', 'ts': '2026-10-31T13:10:00Z'},
         {'run': 'c2', 'phase': 'deployed', 'note': 'placebo-d 2026', 'ts': '2026-10-31T20:00:00Z'},
         {'run': 'c3', 'phase': 'drawn', 'note': 'board-b :: x', 'ts': '2026-10-31T20:00:00Z'}]
    sp = C.canary_spans(J)
    t('spans: deployed -> promoted/torn-down; a drawn-only run is not a canary span',
      sorted(s[0] for s in sp) == ['c1', 'c2'] and [s for s in sp if s[0] == 'c1'][0][3] == d(13) + dt.timedelta(minutes=10))
    ex, runs = C.excluded_pools(sp, d(12), d(14))
    t('exclusion: a canary overlapping the window excludes its pools for the whole window', ex == {'board-a', 'hive-a'} and runs == ['c1'])
    ex, runs = C.excluded_pools(sp, d(14), d(19))
    t('exclusion: a canary closed before the window does not', ex == set())
    ex, _ = C.excluded_pools(sp, d(21), d(30))
    t('exclusion: an open canary (no close) excludes to the window end', ex == {'placebo-d'})
    cf = C.confounds(sp, d(12), d(14))
    t('confounds: the canary and the PROMOTION inside the window are named', len(cf) == 2 and any('PROMOTION' in c for c in cf), cf)
    rows = {'a': [{'llm': {'model': 'm', 'endpoint': 'u', 'schema_valid': True, 'latency_ms': 900},
                   'tool_calls': [{'skill': 'gather', 'args': {'block': 'oak_log'}}], 'outcome': {'status': 'failed', 'detail': 'no block'}},
                  {'llm': {'model': 'm', 'endpoint': 'u', 'schema_valid': True, 'latency_ms': 1100},
                   'tool_calls': [{'skill': 'gather', 'args': {'block': 'oak_log'}}], 'outcome': {'status': 'success'}},
                  {'llm': {'model': 'm', 'endpoint': None, 'schema_valid': True, 'latency_ms': 0},
                   'tool_calls': [{'skill': 'deposit', 'args': {}}], 'outcome': {'status': 'success'}}]}
    m = C.decision_metrics(rows, 'm', {'a': 2.0})
    t('decisions: work order excluded, rep_fail 1/1, per bot-h over the bot-h given',
      m['decisions'] == 2 and m['rep_fail'] == 1.0 and m['rep_fail_n'] == 1 and m['decisions_per_bot_h'] == 1.0 and m['model_share'] == 1.0, m)
    m0 = C.decision_metrics({}, 'm', {})
    t('decisions: an empty window gives None shares, never 0', m0['invalid_share'] is None and m0['rep_fail'] is None)
    t('median: needs >= 3 readable days', C.median_of([{'x': 1}, {'x': 3}], 'x')[0] is None
      and C.median_of([{'x': 1}, {'x': 3}, {'x': None}, {'x': 2}], 'x') == (2, 3))
    res = {'generated': 'g', 'model': 'm', 'url': 'u', 'started': 's', 'completed': 'c',
           'win': {'EXP0': 'a', 'EXP1': 'b', 'PRE0': 'c', 'PRE1': 'd'}, 'days': ['D1', 'D2', 'D3'],
           'EXP': {'items_per_bot_h': 60.0, 'bot_hours': 1900}, 'PRE': {'items_per_bot_h': 50.0, 'bot_hours': 1900},
           'D1': {'items_per_bot_h': 40.0}, 'D2': {'items_per_bot_h': 50.0}, 'D3': {'items_per_bot_h': 60.0},
           'es_keys': ['items_per_bot_h', 'value_per_bot_h'], 'dec_keys': ['rep_fail'], 'hourly': []}
    md = C.render(res)
    t('render: deltas vs PRE and the median, UNREADABLE for a missing value',
      '| items_per_bot_h | 60 | 50 | +20% | 50 (3) | +20% |' in md and '| value_per_bot_h | UNREADABLE |' in md, md[:600])
    J2 = [{'run': 'old', 'phase': 'deployed', 'note': 'board-c 2026', 'ts': '2026-10-31T01:00:00Z'},
          {'run': 'new', 'phase': 'deployed', 'note': 'hive-d 2026', 'ts': '2026-10-31T05:00:00Z'},
          {'run': 'new', 'phase': 'torn-down', 'note': '', 'ts': '2026-10-31T08:00:00Z'}]
    sp2 = C.canary_spans(J2)
    t('spans: a run with no close row ends at the next run\'s deploy (one slot), not never',
      [s for s in sp2 if s[0] == 'old'][0][3] == d(5), sp2)
    sg = C.segments(sp2, d(0), d(10))
    t('segments: cut at every boundary, each with only the canary pools active then',
      [(a.hour, b.hour, sorted(e)) for a, b, e in sg] == [(0, 1, []), (1, 5, ['board-c']), (5, 8, ['hive-d']), (8, 10, [])], sg)
    t('excluded_at: by pool AND time', C.excluded_at(sg, 'hive-d', d(6)) and not C.excluded_at(sg, 'hive-d', d(9))
      and not C.excluded_at(sg, 'board-c', d(6)))
    try:
        C.file_metrics(d(0), d(1), [], sg, 'm'); ok = False
    except RuntimeError:
        ok = True
    t('files: an empty roster raises', ok)
    # r2 Codex: missing deltas / missing statuses are UNREADABLE, not 0 (a fake ES with the shapes es_metrics reads)
    import types
    class FakeEv:
        DOCS = []
        def __init__(self, a, b, pools): self.a, self.b, self.pools = a, b, pools
        @classmethod
        def load(cls, stream, since=None, until=None, pools=None, gaps=None): return cls(since, until, pools)
        def total(self): return len(self.DOCS)
        def coverage(self): return {'bot_hours': 10.0}
        def names(self):
            from collections import Counter
            return dict(Counter(x['skill']['name'] for x in self.DOCS))
        def rows(self, k, fields=None, max_rows=0, allow_zero=False): return [x for x in self.DOCS if x['skill']['name'] == k]
        def _query(self): return {'bool': {'filter': []}}
        def _complete(self, agg, what): return agg
        def _search(self, body):
            from collections import Counter, defaultdict
            exists = any('exists' in f for f in body['query']['bool']['filter'])
            docs = [x for x in self.DOCS if not exists or 'inventory_delta' in x['skill']]
            by = defaultdict(list)
            for x in docs:
                by[x['skill']['name']].append(x)
            bk = []
            for k, xs in by.items():
                st = Counter(x['skill'].get('status', '<missing>') for x in xs)
                bk.append({'key': k, 'doc_count': len(xs), 'd': {'value': sum(x['skill'].get('duration_ms', 0) for x in xs)},
                           'c': {'value': sum(1 for x in xs if 'duration_ms' in x['skill'])},
                           's': {'buckets': [{'key': kk, 'doc_count': n} for kk, n in st.items()]}})
            return {'aggregations': {'k': {'buckets': bk}}}
    fake = types.ModuleType('lib.estelemetry'); fake.EsEvents = FakeEv
    sys.modules['lib.estelemetry'] = fake
    seg = [(d(0), d(1), set())]
    FakeEv.DOCS = [{'skill': {'name': 'gather', 'status': 'success', 'duration_ms': 1000}} for _ in range(10)]
    out, errs = C.es_metrics(d(0), d(1), ['board-a'], seg)
    t('r2: gather rows without inventory_delta -> items/value UNREADABLE, named (not 0)',
      out['items_per_bot_h'] is None and out['value_per_bot_h'] is None and any('inventory_delta' in e for e in errs), (out, errs))
    FakeEv.DOCS = [{'skill': {'name': 'gather', 'duration_ms': 1000, 'inventory_delta': {'oak_log': 1}}} for _ in range(10)]
    out, errs = C.es_metrics(d(0), d(1), ['board-a'], seg)
    t('r2: gather rows without skill.status -> gather success UNREADABLE (not 0 %)',
      out['gather_success'] is None and any('status missing' in e for e in errs), (out.get('gather_success'), errs))
    print('\n%d/%d pass' % (sum(T), len(T)))
    return 0 if all(T) else 1


if __name__ == '__main__':
    sys.exit(main())
