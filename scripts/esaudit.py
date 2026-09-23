#!/usr/bin/env python3
"""AUDIT the archive: is it complete, is it fresh, and is anything using it?

No assumptions -- every number here is a live query against the cluster.
Run on the ELK host: sudo python3 esaudit.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lib'))
import es  # noqa: E402

# The FULL set, discovered by listing the cluster rather than assuming. The first version
# of this audit hardcoded 'mcai-mc-server' -- a name that does not exist -- and concluded
# the Paper logs had "never been shipped". The real stream is `mcai-mc-paper`, and two
# others (gpu-metrics, supervisor-lab) were missed entirely. Enumerate, never assume.
STREAMS = ['mcai-skill-agents', 'mcai-llm-agents', 'mcai-sys-journal',
           'mcai-mc-paper', 'mcai-gpu-metrics', 'mcai-supervisor-lab']

print(f"cluster: {es.ES_URL}  as {es.ES_USER}")
info = es.request('')
print(f"  Elasticsearch {info['version']['number']}  cluster {info['cluster_name']}")

print("\n=== FRESHNESS AND VOLUME (live queries) ===")
print(f"  {'stream':22s} {'newest doc':26s} {'24h docs':>10s} {'total':>12s}")
for s in STREAMS:
    try:
        n = es.newest(s)
    except es.EsError as e:
        print(f"  {s:22s} UNREADABLE: {str(e)[:50]}")
        continue
    try:
        c24 = es.count(s, es.last24h())
        tot = es.count(s)
    except es.EsError as e:
        c24 = tot = f'err {str(e)[:20]}'
    print(f"  {s:22s} {str(n):26s} {c24:>10} {tot:>12}")

print("\n=== ARE WE INDEXING FIELDS WE NEVER QUERY? (skill stream) ===")
f = es.fields('mcai-skill-agents')
print(f"  mcai-skill-agents declares {len(f)} mapped fields")
for k in sorted(f):
    print(f"    {k}: {f[k]}")
