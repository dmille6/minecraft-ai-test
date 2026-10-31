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
    out, errs = C.es_metrics(d(0), d(1), [])
    t('es: an empty pool selection is UNREADABLE (never the whole fleet)', out == {} and errs and 'no pools' in errs[0])
    try:
        C.file_metrics(d(0), d(1), [], 'm'); ok = False
    except RuntimeError:
        ok = True
    t('files: an empty pool selection raises', ok)
    print('\n%d/%d pass' % (sum(T), len(T)))
    return 0 if all(T) else 1


if __name__ == '__main__':
    sys.exit(main())
