#!/usr/bin/env python3
"""HOW FAR BACK DOES THE ARCHIVE GO, and what can it answer that the files cannot?

The JSONL readers see 15 rotated generations. The cluster holds 31M skill documents. If the
archive reaches further back than the files, every "30-day" claim this project has made was
actually computed over whatever the files still held -- and the real series was sitting in
an index nothing queried.

Live queries only. Run on the ELK host: sudo python3 eshistory.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import es  # noqa: E402

IDX = 'mcai-skill-agents'

oldest = es.request(IDX + '/_search', {'size': 1, 'sort': [{'@timestamp': 'asc'}],
                                       '_source': ['@timestamp']})
o = oldest['hits']['hits'][0]['_source']['@timestamp']
print(f"archive spans: {o}  ->  {es.newest(IDX)}")
print(f"total skill documents: {es.count(IDX):,}")

print("\n=== documents per day, whole archive ===")
a = es.agg(IDX, {'d': {'date_histogram': {'field': '@timestamp', 'calendar_interval': 'day'}}})
days = a['d']['buckets']
print(f"  {len(days)} days with data")
for b in days:
    if b['doc_count']:
        bar = '#' * min(60, b['doc_count'] // 20000)
        print(f"   {b['key_as_string'][:10]}  {b['doc_count']:8d}  {bar}")
