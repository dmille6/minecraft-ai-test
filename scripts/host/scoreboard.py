#!/usr/bin/env python3
# scoreboard.py [hours] [end_iso] -- the owner's daily scoreboard (OWNER 10-03: "we should see a little progress each
# day"). ONE definition, so every report compares like with like (the 10-03 morning numbers were computed ad hoc and
# could not be reproduced; re-run this over that window instead of quoting them).
#
# Denominators: bots = distinct bots with a tools snapshot in the window (last snapshot per bot); gathers = log gather rows.
#   TRIP PICKAXE   holds a stone/iron/diamond/netherite pickaxe with >= 40 uses left (MIN_TRIP_USES, oretunnel.mjs)
#   NO PICKAXE     holds no *_pickaxe at all; NO USABLE: none with > 10 uses left (237 of 295 held were <= 10% on 09-28)
#   LOG GATHERS    gather rows whose block ends _log: success / all
#   FULL BAGS      bots at >= 34 estimated slots (hygiene-pool-check.py's estimator; it UNDER-reads split stacks)
#   RAW IRON       sum of positive raw_iron + iron_ore + deepslate_iron_ore in skill inventory_delta (flow, not stock)
#   PICKAXES MADE  craft rows for *_pickaxe with status success
import sys, re, statistics
import datetime as dt
from collections import Counter
sys.path.insert(0, '/srv/mcb-analysis-lib')
sys.path.insert(0, '/opt/minecraft-ai/scripts')
from lib.telemetry import Events

H = float(sys.argv[1]) if len(sys.argv) > 1 else 10
END = dt.datetime.fromisoformat(sys.argv[2].replace('Z', '+00:00')) if len(sys.argv) > 2 else dt.datetime.now(dt.timezone.utc)
START = END - dt.timedelta(hours=H)
UN = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|bucket|shears|flint_and_steel|bow|fishing_rod)$')
TRIP = re.compile(r'^(stone|iron|diamond|netherite)_pickaxe$')
IRON = ('raw_iron', 'iron_ore', 'deepslate_iron_ore')


def occupancy(inv):
    return sum(c if UN.search(n) else -(-c // 64) for n, c in (inv or {}).items() if isinstance(c, (int, float)))


ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=START, until=END)
last = {}; logs = Counter(); iron = 0; picks = 0
for r in ev.rows:
    raw = r.get('raw') or {}; sk = raw.get('skill') or {}; bot = raw.get('bot') or {}
    b = (r.get('bot') or {}).get('name')
    if b and bot.get('tools') is not None and isinstance(bot.get('inventory'), dict):
        last[b] = bot
    if r.get('name') == 'gather' and str((sk.get('args') or {}).get('block', '')).endswith('_log'):
        logs['all'] += 1
        logs['ok'] += sk.get('status') == 'success'
    for k, v in (sk.get('inventory_delta') or {}).items():
        if k in IRON and isinstance(v, (int, float)) and v > 0:
            iron += v
    if r.get('name') == 'craft' and str((sk.get('args') or {}).get('item', '')).endswith('_pickaxe') and sk.get('status') == 'success':
        picks += 1

n = len(last)
assert len(ev.rows) > 1000 and n >= 40, f'positive control failed: {len(ev.rows)} rows, {n} bots with snapshots'
trip = sum(any(TRIP.match(k) and e.get('max', 0) - e.get('used', 0) >= 40 for k, v in bot['tools'].items() for e in v) for bot in last.values())
nopick = sum(not any(k.endswith('_pickaxe') for k in bot['tools']) for bot in last.values())
nousable = sum(not any(k.endswith('_pickaxe') and e.get('max', 0) - e.get('used', 0) > 10 for k, v in bot['tools'].items() for e in v) for bot in last.values())
occ = [occupancy(bot['inventory']) for bot in last.values()]
print(f'window {START:%m-%d %H:%MZ} -> {END:%m-%d %H:%MZ} ({H:g} h)  rows {len(ev.rows)}  bots {n}')
print(f'trip pickaxe (>= 40 uses, stone+)   {trip}/{n}')
print(f'no pickaxe at all                   {nopick}/{n}')
print(f'no USABLE pickaxe (> 10 uses left)  {nousable}/{n}')
print(f'log gathers that succeed            {logs["ok"]}/{logs["all"]} = {100 * logs["ok"] / max(logs["all"], 1):.1f}%')
print(f'bags at >= 34 est. slots            {sum(o >= 34 for o in occ)}/{n} (median {statistics.median(occ):g})')
print(f'raw iron gained (flow)              {iron:g}')
print(f'pickaxe crafts reported success     {picks}')
