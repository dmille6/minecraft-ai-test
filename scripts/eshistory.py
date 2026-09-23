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
# A date_histogram returns EMPTY buckets between the first and last. The first version
# printed len(buckets) as "days with data" and then printed only the non-empty ones, so it
# could announce 50 days while concealing gaps -- and "we have 50 days" became a headline.
nonempty = [b for b in days if b['doc_count']]
gaps = [b['key_as_string'][:10] for b in days if not b['doc_count']]
print(f"  {len(days)} calendar days spanned, {len(nonempty)} WITH DATA, {len(gaps)} EMPTY")
if gaps:
    print(f"  EMPTY DAYS (no documents at all): {', '.join(gaps)}")
for b in nonempty:
    bar = '#' * min(60, b['doc_count'] // 20000)
    print(f"   {b['key_as_string'][:10]}  {b['doc_count']:8d}  {bar}")
