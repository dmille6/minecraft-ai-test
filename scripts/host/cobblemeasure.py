#!/usr/bin/env python3
# cobblemeasure.py [hours] -- how the fleet banks cobblestone today (design input for the cobble rule).
# Every deposit / town_deposit row: the bot's previous snapshot (c0) vs the row's END snapshot (c1) of cobblestone +
# cobbled_deepslate. b = c0 - c1 when > 0. Positive control: total rows, bots, deposit rows.
import sys, glob, json, gzip, datetime as dt
from collections import Counter, defaultdict
H = float(sys.argv[1]) if len(sys.argv) > 1 else 24
now = dt.datetime.now(dt.timezone.utc)
since = (now - dt.timedelta(hours=H)).strftime('%Y-%m-%dT%H:%M')
files = glob.glob('/var/log/mcai/*/skill-*.jsonl') + glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % now.strftime('%Y%m%d'))
CB = ('cobblestone', 'cobbled_deepslate')
rows = 0; bots = set(); dep = Counter(); banked = Counter(); runs = Counter(); below = Counter(); below_items = Counter()
partial_guess = Counter(); full_at = Counter(); hist = Counter(); poolrate = defaultdict(Counter)
for f in files:
    op = gzip.open if f.endswith('.gz') else open
    prev = {}
    try:
        lines = op(f, 'rt', errors='ignore')
        for line in lines:
            if '"inventory"' not in line:
                continue
            try:
                r = json.loads(line)
            except Exception:
                continue
            t = r.get('@timestamp', '')
            b = (r.get('bot') or {}); name = b.get('name'); inv = b.get('inventory')
            if not name or not isinstance(inv, dict):
                continue
            c1 = sum(inv.get(n, 0) for n in CB)
            sk = r.get('skill') or {}
            k = sk.get('name')
            if t >= since:
                rows += 1; bots.add(name)
                if k in ('deposit', 'town_deposit', '_town_deposit') and name in prev:
                    dep[k] += 1
                    c0 = prev[name]
                    d = c0 - c1
                    if d > 0:
                        runs[k] += 1; banked[k] += d
                        poolrate['-'.join(name.split('-')[:2])][k] += d
                        hist[min(d, 200) // 16 * 16] += 1
                        if c1 < 64:
                            below[k] += 1; below_items[k] += min(d, 64 - c1)
                        if d % 64:
                            partial_guess[k] += 1
                        slots = len([1 for v in inv.values() if v > 0])
                        if slots >= 34:
                            full_at[k] += 1
            prev[name] = c1
    except (OSError, EOFError):
        continue
print('window %.0f h since %s | rows %d bots %d | deposit-like rows %s' % (H, since, rows, len(bots), dict(dep)))
print('runs that lowered cobble %s | cobble banked %s' % (dict(runs), dict(banked)))
print('runs ending under 64 cobble+deepslate %s (items the 64 reserve would have kept %s)' % (dict(below), dict(below_items)))
print('runs whose banked amount is not a multiple of 64 (a partial stack likely) %s' % dict(partial_guess))
print('runs at >= 34 distinct names (a lower bound on full bags) %s' % dict(full_at))
print('banked per run histogram (16-item buckets) %s' % sorted(hist.items()))
print('per pool banked %s' % {p: dict(c) for p, c in sorted(poolrate.items())})
