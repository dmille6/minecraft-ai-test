#!/usr/bin/env python3
"""fleetversion.py <since ISO-8601 Z> [units.txt] -- READ-ONLY (10.0.0.31): which build is each bot running SINCE the
restart? For every bot (from units.txt, one `mcbot@<bot>.service` per line, or every /var/log/mcai/<bot>/ dir) it reads
the tail of its skill log and takes the newest row stamped at or after <since>. Prints the version counts and every bot
with no row since (not yet logged -- UNKNOWN, never counted as agreement). Exit 0 only if every bot logged since and
exactly one version is live."""
import json, os, sys
from collections import Counter
since = sys.argv[1]
if len(sys.argv) > 2:
    bots = [l.strip().replace('mcbot@', '').replace('.service', '') for l in open(sys.argv[2]) if l.strip()]
else:
    bots = sorted(b for b in os.listdir('/var/log/mcai') if not b.startswith('_'))
ver = Counter(); silent = []
for b in bots:
    f = '/var/log/mcai/%s/skill-%s.jsonl' % (b, b); v = None
    try:
        with open(f, 'rb') as fh:
            fh.seek(0, 2); fh.seek(max(0, fh.tell() - 400000))
            for ln in reversed(fh.read().decode('utf-8', 'replace').splitlines()):
                try: r = json.loads(ln)
                except Exception: continue
                if (r.get('@timestamp') or '') < since: break
                v = (r.get('code') or {}).get('version'); break
    except FileNotFoundError:
        pass
    if v: ver[v] += 1
    else: silent.append(b)
print('bots', len(bots), 'versions since', since, dict(ver), 'no row since:', len(silent), silent[:10])
sys.exit(0 if not silent and len(ver) == 1 else 1)
