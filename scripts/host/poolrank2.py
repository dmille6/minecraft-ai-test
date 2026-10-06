#!/usr/bin/env python3
# poolrank2.py -- per-pool items per bot-hour over the last 120 min, for drawrec.sh's rule-v5 band.
#
# RECONSTRUCTED 2026-10-06 ~23:00Z. The original lived ONLY in /tmp on 10.0.0.31 (never committed) and was wiped by
# the 10-06 power-outage reboot; drawrec.sh then crashed on its missing "5080-half median" line and the canary loop
# re-drew every 20 min for ever. Rebuilt from scripts/analysis/halfdid.py:control_matches_poolrank2, which documents
# reproducing poolrank2 EXACTLY: same paths (live skill logs), since_minutes=120 on an unrounded now, the manifest's
# declared_code_version as the version filter, isolated-*/self-* excluded, items = positive inventory_delta summed,
# bot-hours = (last row - first row) per pool x bots present, half = 3090 for *-d pools (their primary
# OLLAMA_BASE_URL is 10.0.0.16) else 5080. Output lines are exactly what drawrec.sh parses:
#   <pool> <5080|3090> bots N items/bh X
#   5080-half median items/bh: X
import sys, json, statistics, datetime as dt
from collections import defaultdict
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events

until = dt.datetime.now(dt.timezone.utc)
since = until - dt.timedelta(minutes=120)
BV = json.load(open('/srv/mcbots/trial-manifest.json')).get('declared_code_version')
try:
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until, version=BV, allow_zero=True)
except TypeError:
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until, version=BV)
items = defaultdict(int); bots = defaultdict(set); span = defaultdict(lambda: [None, None])
for r in ev.rows:
    b = (r.get('bot') or {}).get('name', '') or ''
    if not b or b.startswith('isolated') or b.startswith('self-'):
        continue
    p = b.rsplit('-', 1)[0]
    bots[p].add(b)
    s = span[p]; t = r['t']
    s[0] = t if s[0] is None else min(s[0], t)
    s[1] = t if s[1] is None else max(s[1], t)
    for _it, v in (((r.get('raw') or {}).get('skill') or {}).get('inventory_delta') or {}).items():
        if isinstance(v, (int, float)) and v > 0:
            items[p] += v
half = lambda p: '3090' if p.endswith('-d') else '5080'
rates = {}
print('poolrank2 (reconstructed 10-06): window %s -> %s  version %s  rows %d'
      % (since.strftime('%H:%MZ'), until.strftime('%H:%MZ'), BV, len(ev.rows)))
for p in sorted(bots):
    h = (span[p][1] - span[p][0]).total_seconds() / 3600 * len(bots[p])
    rates[p] = items[p] / h if h else 0.0
    print('%s %s bots %d items/bh %.1f' % (p, half(p), len(bots[p]), rates[p]))
m5080 = [v for p, v in rates.items() if half(p) == '5080']
print('5080-half median items/bh: %.1f' % (statistics.median(m5080) if m5080 else 0.0))
