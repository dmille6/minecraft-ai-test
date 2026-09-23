#!/usr/bin/env python3
"""The failure-class series over the WHOLE archive -- impossible from the files.

`skill.fail_class` has been a mapped keyword in Elasticsearch since the mappings were
applied. Nothing ever aggregated it: the Python readers index only skill.name, so 42 of 65
analysis scripts regexed the prose `detail` string, and every "30-day" claim was computed
over the 15 rotated generations the files still held -- with a gap between 09-02 and 09-10.

The archive spans 50 unbroken days. This is that series.

Run on the ELK host: sudo python3 esfailtrend.py [days]
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import es  # noqa: E402

IDX = 'mcai-skill-agents'
days = int(sys.argv[1]) if len(sys.argv) > 1 else 50
LOGQ = {'bool': {'must': [{'term': {'skill.name': 'gather'}}],
                 'filter': [{'range': {'@timestamp': {'gte': f'now-{days}d'}}}]}}

a = es.agg(IDX, {
    'd': {'date_histogram': {'field': '@timestamp', 'calendar_interval': 'day'},
          'aggs': {'fc': {'terms': {'field': 'skill.fail_class', 'size': 6}},
                   'ok': {'filter': {'term': {'skill.status': 'success'}}}}}
}, LOGQ)

print(f"gather runs by day over {days} days, with the top failure classes")
print(f"{'day':12s} {'runs':>8s} {'ok%':>6s}   top fail classes (share of runs)")
for b in a['d']['buckets']:
    n = b['doc_count']
    if not n:
        continue
    ok = 100.0 * b['ok']['doc_count'] / n
    top = '  '.join(f"{t['key']} {100.0*t['doc_count']/n:.0f}%"
                    for t in b['fc']['buckets'][:4])
    print(f"{b['key_as_string'][:10]:12s} {n:8d} {ok:5.1f}%   {top}")
