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


def load_window(since, until):
    """Rotation-aware (oretunnelread's pattern): skill logs rotate daily at ~23:59Z (copytruncate), so day D's rows live
    in skill-*.jsonl-<D+1>.gz and the live file starts at ~23:59Z. Reading only the live files silently drops every row
    before the last rotation -- found 10-04 01:08Z when a 6 h window walked 58k rows instead of ~290k."""
    ev = Events.load(paths='/var/log/mcai/*/skill-*.jsonl', since=since, until=until)
    key = lambda r: (str(r.get('t')), ((r.get('bot') or {}).get('name')), r.get('name'), r.get('detail'))
    out, seen = [], set()
    for r in ev.rows:
        if key(r) not in seen:
            out.append(r); seen.add(key(r))
    import glob as _glob
    for k in range(0, (until.date() - since.date()).days + 1):
        tag = (since.date() + dt.timedelta(days=k + 1)).strftime('%Y%m%d')
        for g in _glob.glob('/var/log/mcai/*/skill-*.jsonl-%s.gz' % tag):
            try:
                e2 = Events.load(paths=g, since=since, until=until, allow_zero=True)
            except TypeError:
                e2 = Events.load(paths=g, since=since, until=until)
            for r in e2.rows:
                if key(r) not in seen:
                    out.append(r); seen.add(key(r))
    return out


class _EV: pass
ev = _EV(); ev.rows = load_window(START, END)   # rotation-aware (logs rotate ~23:59Z)
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

# BLOCKER CENSUS (OWNER 10-03): from the shadow mayor's records, every 5 min, each need no bot could take and WHY.
# Scope is fixed by the mayor plan's ADDENDUM 2: only `t`, `mayor_rev` and the `unstaffed` entries are used -- never
# `assignments`, leases, outcomes or any comparison (the 10-06 trial read must stay blind). Unit: need-checks (one
# unmet need seen at one 5-minute check); one bot can be counted under several duties. Split by mayor revision:
# GET_WOOD changed meaning at 18:02:46Z 10-03 (world-pooled -> per bot), so revisions are never added together.
import glob, json
from collections import defaultdict
need = defaultdict(Counter); why = defaultdict(Counter); recs = Counter()
for f in glob.glob('/var/lib/mcai-mayor/assign-*.jsonl'):
    with open(f) as fh:
        for line in fh:
            try:
                o = json.loads(line)
                t = dt.datetime.fromisoformat(str(o['t']).replace('Z', '+00:00'))
            except (ValueError, KeyError, TypeError):
                continue
            if not (START <= t < END):
                continue
            rev = o.get('mayor_rev') or 'unstamped'
            recs[rev] += 1
            for u in o.get('unstaffed') or []:
                need[rev][u.get('duty', '?')] += 1
                for b in (u.get('blockers') or {}):
                    why[rev][(u.get('duty', '?'), b)] += 1
if not recs:
    print('\nblocker census: no mayor records in this window (mayor stopped, or files moved)')
for rev in sorted(recs, key=lambda r: (r != 'unstamped', r)):
    hrs = recs[rev] / 16 * 5 / 60                       # 16 worlds, one record per world per 5-min tick
    print(f'\nblocker census, mayor rev {rev}: {recs[rev]} world-checks (~{hrs:.1f} h); unmet need-checks per hour by duty, then why')
    for duty, n in need[rev].most_common():
        top = ', '.join(f'{b} {v / hrs:.0f}' for (d, b), v in why[rev].most_common() if d == duty)
        print(f'  {duty:13} {n / hrs:7.0f}/h   {top}')
