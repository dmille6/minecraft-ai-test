#!/usr/bin/env python3
"""learning-loop: positive inventory gains by skill name over the 10-20 rotated skill files (read-only). Sizes the
transfer + conversion exclusion of the bench primary (gross gathered items/bot-h)."""
import sys, json, collections, glob, gzip
g = collections.Counter(); n = collections.Counter()
for f in glob.glob('/var/log/mcai/*/skill-*.jsonl-20261021.gz'):
    for l in gzip.open(f, 'rt', errors='replace'):
        if 'inventory_delta' not in l: continue
        try: r = json.loads(l)
        except ValueError: continue
        sk = r.get('skill') or {}; d = sk.get('inventory_delta') or {}
        p = sum(v for v in d.values() if isinstance(v, (int, float)) and v > 0)
        if p: g[sk.get('name')] += p; n[sk.get('name')] += 1
T = sum(g.values()); print('total positive gain', T)
for k, v in g.most_common(30): print(k, v, round(100 * v / T, 1), n[k])
