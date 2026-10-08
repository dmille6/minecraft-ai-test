#!/usr/bin/env python3
# withdraw2power.py [hours] -- exposure power for withdraw2-01 at today's rates (dry-run helper, no emits).
# Per pool on the fleet build (c6e91a8 rows only): bot-hours, withdraw_pick orders (withdraw-01, pickNeeded), and the
# UPGRADE opportunities withdraw2 adds: distinct (bot, 30-min bin) with a snapshot AT TOWN (<= 48 of home) whose best
# usable pickaxe is below iron (UPGRADE_COOLDOWN_MS = 30 min: at most one upgrade order per bot per bin).
# Positive control: rows, bots, and the withdraw-01 orders are printed with the same filters.
import sys, glob, os, math
import datetime as dt
from collections import defaultdict, Counter
sys.path.insert(0, '/srv/mcb-analysis-lib'); sys.path.insert(0, '/opt/minecraft-ai/scripts'); sys.path.insert(0, '/home/mike/mcai-analysis')
from lib.telemetry import Events
H = float(sys.argv[1]) if len(sys.argv) > 1 else 6
BUILD = os.environ.get('BUILD', 'c6e91a8')
now = dt.datetime.now(dt.timezone.utc); since = now - dt.timedelta(hours=H)
ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=now)
rows = list(ev.rows)
for k in range(0, (now.date() - since.date()).days + 1):
    tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
    for g in glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
        try: rows += list(Events.load(paths=g, since=since, until=now, allow_zero=True).rows)
        except TypeError: rows += list(Events.load(paths=g, since=since, until=now).rows)
HOME = {}
for f in glob.glob('/srv/mcbots/harness/env/*.env'):
    x = z = None
    for line in open(f):
        if line.startswith('HOME_X='): x = float(line.split('=', 1)[1])
        elif line.startswith('HOME_Z='): z = float(line.split('=', 1)[1])
    if x is not None and z is not None: HOME[os.path.basename(f)[:-4]] = (x, z)
TIERS = ['wooden', 'golden', 'stone', 'iron', 'diamond', 'netherite']
tier = lambda n: next((i for i, t in enumerate(TIERS) if n.startswith(t + '_')), -1)
pool = lambda b: '-'.join(b.split('-')[:2])
seen = Counter(); first = {}; last = {}; orders = Counter(); upgrades_seen = Counter(); opp = defaultdict(set); bots = defaultdict(set)
for r in rows:
    b = (r.get('bot') or {}).get('name'); t = r['t']
    ver = (((r.get('raw') or {}).get('code') or {}).get('version') or '')
    if not b or not ver.startswith(BUILD): continue
    p = pool(b); seen[p] += 1; bots[p].add(b)
    first[b] = min(first.get(b, t), t); last[b] = max(last.get(b, t), t)
    if r.get('name') == '_withdraw_pick': orders[p] += 1
    bt = r.get('bot') or {}; tools = bt.get('tools') or {}; pos = bt.get('pos'); h = HOME.get(b)
    if not pos or not h: continue
    if ((pos.get('x', 0) - h[0]) ** 2 + (pos.get('z', 0) - h[1]) ** 2) ** 0.5 > 48: continue
    best = max([tier(k) for k, v in tools.items() if k.endswith('_pickaxe') for e in v if e.get('max', 0) - e.get('used', 0) > 10] or [-1])
    if 0 <= best < TIERS.index('iron'):
        opp[p].add((b, int(t.timestamp() // 1800)))
print('window %.1f h to %s  build %s  rows %d  bots %d  (positive control: withdraw_pick rows %d)' % (H, now.strftime('%H:%MZ'), BUILD, sum(seen.values()), sum(len(v) for v in bots.values()), sum(orders.values())))
tot_bh = tot_o = tot_u = 0
for p in sorted(seen):
    bh = sum((last[b] - first[b]).total_seconds() for b in bots[p]) / 3600
    tot_bh += bh; tot_o += orders[p]; tot_u += len(opp[p])
    print('  %-9s bots %2d bot-h %5.1f  withdraw_pick orders %3d  upgrade opportunities (bot x 30-min at town below iron) %3d' % (p, len(bots[p]), bh, orders[p], len(opp[p])))
o_rate = tot_o / tot_bh; u_rate = tot_u / tot_bh
print('fleet rates per bot-h: withdraw-01 orders %.3f  upgrade opportunities %.3f' % (o_rate, u_rate))
pois = lambda lam, k: 1 - sum(math.exp(-lam) * lam ** i / math.factorial(i) for i in range(k))
for bots_n, hrs in [(10, 3), (10, 6), (10, 9), (10, 12)]:
    lo = o_rate * bots_n * hrs; hi = (o_rate + u_rate) * bots_n * hrs
    print('  %d bots x %d h: expected orders %.1f (withdraw-01 alone) .. %.1f (+ every upgrade opportunity); P(>= 5) %.2f .. %.2f' % (bots_n, hrs, lo, hi, pois(lo, 5), pois(hi, 5)))
