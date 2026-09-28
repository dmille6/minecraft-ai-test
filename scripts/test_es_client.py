#!/usr/bin/env python3
"""Qualification tests for lib/es.py, written after an independent review MOCKED this client
and showed it accepted partial answers as whole.

Every test is a known-answer case. No network, no credentials: subprocess is stubbed.
Run: python3 scripts/test_es_client.py
"""
import json, os, sys, types, traceback

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import es

PASS = FAIL = 0

class FakeRun:
    def __init__(self, payload, rc=0):
        self.returncode = rc; self.stdout = json.dumps(payload); self.stderr = ''

def with_reply(payload, rc=0):
    es.subprocess = types.SimpleNamespace(run=lambda *a, **k: FakeRun(payload, rc))
    es._password = lambda: 'x'

def check(name, fn):
    global PASS, FAIL
    try:
        fn(); print(f'  PASS  {name}'); PASS += 1
    except Exception as e:
        print(f'  FAIL  {name}: {e}'); traceback.print_exc(); FAIL += 1

def t_ok():
    with_reply({'count': 5, '_shards': {'total': 1, 'successful': 1, 'failed': 0}})
    assert es.count('i') == 5

def t_timeout_raises():
    """THE BUG: a timed-out search was accepted and its aggregation used as complete."""
    with_reply({'timed_out': True, 'aggregations': {'a': {'value': 1}},
                '_shards': {'total': 2, 'successful': 2, 'failed': 0}})
    try: es.agg('i', {'a': {'value_count': {'field': 'x'}}})
    except es.EsError as e:
        assert 'TIMED OUT' in str(e); return
    raise AssertionError('a timed_out search must RAISE, not return an aggregation')

def t_failed_shards_raises():
    with_reply({'count': 999, '_shards': {'total': 5, 'successful': 3, 'failed': 2}})
    try: es.count('i')
    except es.EsError as e:
        assert 'shards FAILED' in str(e); return
    raise AssertionError('failed shards must RAISE; partial coverage is not a measurement')

def t_terminated_early_raises():
    with_reply({'terminated_early': True, 'hits': {}, '_shards': {'failed': 0}})
    try: es.request('i/_search')
    except es.EsError as e:
        assert 'terminated_early' in str(e); return
    raise AssertionError('terminated_early must RAISE')

def t_error_object_raises():
    with_reply({'error': {'reason': 'no such index'}})
    try: es.count('nope')
    except es.EsError as e:
        assert 'no such index' in str(e); return
    raise AssertionError('an ES error object must RAISE')

def t_multifields_seen():
    """THE OTHER BUG: fields() never walked `fields`, so it could not tell text from
    text + .keyword -- and was used to claim skill.detail HAS no keyword subfield."""
    with_reply({'idx-a': {'mappings': {'properties': {
        'skill': {'properties': {
            'detail': {'type': 'text', 'fields': {'keyword': {'type': 'keyword'}}},
            'name': {'type': 'keyword'}}}}}}})
    f = es.fields('i')
    assert f.get('skill.detail') == 'text', f
    assert f.get('skill.detail.keyword') == 'keyword', f'multifield missed: {f}'

def t_all_backing_indices():
    """It read only the lexicographically last index, so a field present only in an older
    backing index was invisible."""
    with_reply({
        'idx-a': {'mappings': {'properties': {'old_field': {'type': 'long'}}}},
        'idx-z': {'mappings': {'properties': {'new_field': {'type': 'long'}}}}})
    f = es.fields('i')
    assert 'old_field' in f and 'new_field' in f, f

def t_mapping_differs_detects():
    with_reply({
        'idx-a': {'mappings': {'properties': {'x': {'type': 'long'}}}},
        'idx-z': {'mappings': {'properties': {'x': {'type': 'keyword'}}}}})
    n, diffs = es.mapping_differs('i')
    assert n == 2 and 'x' in diffs, (n, diffs)

def t_window_is_closed():
    q = es.last24h()
    assert 'lte' in q['range']['@timestamp'], q

def t_nonjson_raises():
    es.subprocess = types.SimpleNamespace(
        run=lambda *a, **k: types.SimpleNamespace(returncode=0, stdout='<html>502', stderr=''))
    es._password = lambda: 'x'
    try: es.count('i')
    except es.EsError as e:
        assert 'non-JSON' in str(e); return
    raise AssertionError('a non-JSON reply must RAISE')

if __name__ == '__main__':
    print('es.py qualification (subprocess stubbed; no network):')
    for nm, fn in [
        ('a clean reply returns its count (positive control)', t_ok),
        ('THE BUG: timed_out RAISES instead of returning an aggregation', t_timeout_raises),
        ('failed shards RAISE -- partial coverage is not a measurement', t_failed_shards_raises),
        ('terminated_early RAISES', t_terminated_early_raises),
        ('an ES error object RAISES', t_error_object_raises),
        ('THE OTHER BUG: multifields (.keyword) are now visible', t_multifields_seen),
        ('every backing index is walked, not just the last', t_all_backing_indices),
        ('mapping_differs() detects a type change across indices', t_mapping_differs_detects),
        ('last24h() is a CLOSED window', t_window_is_closed),
        ('a non-JSON reply RAISES', t_nonjson_raises),
    ]:
        check(nm, fn)
    print(f'\n{PASS} passed, {FAIL} failed')
    sys.exit(1 if FAIL else 0)
