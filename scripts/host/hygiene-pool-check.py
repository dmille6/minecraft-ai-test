#!/usr/bin/env python3
# hygiene-pool-check.py -- the hygiene-01 draw's MANUAL step, automated (registration draw_exposure.note): a pool may be
# drawn only if >= 2 of its bots sit at >= 34 estimated slots. drawexposure.py counts row kinds and cannot see slot
# pressure, so pools below it get a TEMPORARY draw exclusion (tagged hygiene-slot-pressure, 12 h) in draw-exclude.txt.
# Prints the per-pool table; --apply writes the exclusions. Positive control: rows/bots/inventory snapshots > 0.
import sys, re, datetime as dt
sys.path.insert(0, '/srv/mcb-analysis-lib'); sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events
from collections import defaultdict
ev = Events.load(since_minutes=60)
UN = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|bucket|shears|flint_and_steel|bow|fishing_rod)$')
occ = lambda inv: sum(c if UN.search(n) else -(-c // 64) for n, c in inv.items() if isinstance(c, (int, float)))
last = {}
for r in ev.rows:
    b = (r.get('bot') or {}).get('name'); inv = (r.get('bot') or {}).get('inventory')
    if b and isinstance(inv, dict) and inv: last[b] = inv
assert len(ev.rows) > 0 and len(last) >= 40, f'positive control failed: {len(ev.rows)} rows, {len(last)} bots with inventory'
pools = defaultdict(list)
for b, inv in last.items(): pools['-'.join(b.split('-')[:2])].append(occ(inv))
bad = []
for p in sorted(pools):
    n = sum(1 for o in pools[p] if o >= 34)
    print(f'{p:12} bots {len(pools[p])}  at >=34 slots: {n}  {"OK" if n >= 2 else "EXCLUDE"}')
    if n < 2: bad.append(p)
if '--apply' in sys.argv and bad:
    until = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=12)).strftime('%Y-%m-%dT%H:%M:%SZ')
    with open('/home/mike/mcai-analysis/draw-exclude.txt', 'a') as f:
        for p in bad: f.write(f'{p} {until} hygiene-slot-pressure\n')
    print('excluded until', until, ':', bad)
