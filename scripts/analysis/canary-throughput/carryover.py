#!/usr/bin/env python3
"""carryover.py -- do a canary's effects on its pools outlast the teardown restart?

Question (option D): drawrec.sh excludes a pool for 12 h after its last canary decision. The pools are restarted at
teardown (and every bot every 6 h by fleet-recycle). A restart does not reset bags, world state or pool memory, so the
question is empirical: after the canary ends, how long do the treated pools stay different from the rest on the
metrics a NEXT canary would be read on?

Metrics (per bot, sampled):
  occ   bag occupancy in slots (tools count 1 each, other items ceil(n/64)), sampled at most once per 5 min per bot
  items positive inventory_delta summed (the poolrank2/items-per-bot-hour numerator)
Statistic per event and bin: (treated - control) minus the same difference in the 6 h before the deploy (DiD).
Null: the same statistic for every UNTREATED pool pair, against the same control, same bins (placebo pairs).

Full walk of every rotated + live skill log from 10-03 on, streamed (no Events.load: memory-safe), nice'd.
Positive controls printed: rows walked, bots seen, ts range, and the DURING bin (where an effect should exist).
"""
import glob, gzip, json, math, os, re, sys, itertools, random
import datetime as dt
from collections import defaultdict

UTC = dt.timezone.utc
def T(s): return dt.datetime.fromisoformat(s.replace('Z', '+00:00')).replace(tzinfo=UTC) if 'T' in s else None

# (run, pools, deploy declared_at, end, how-ended) -- from ~/canary-journal.jsonl (drawn/deployed and torn-down/promoted)
EVENTS = [
    ('craftroom-01',   'board-a,hive-b',                         '2026-10-04T05:12:59', '2026-10-04T11:32:00', 'promoted'),
    ('composter-01',   'hive-a,board-b',                         '2026-10-04T11:37:15', '2026-10-04T17:50:00', 'promoted'),
    ('toolclean-01',   'board-d,placebo-b,hive-d,hive-c',        '2026-10-04T17:55:31', '2026-10-05T00:14:00', 'promoted'),
    ('junkwell-01',    'placebo-a,board-b',                      '2026-10-05T10:05:20', '2026-10-05T15:17:00', 'torn-down'),
    ('chestfull-02',   'board-a,board-c,board-d,placebo-d',      '2026-10-05T15:24:10', '2026-10-05T21:43:00', 'promoted'),
    ('climbflood-01',  'hive-d,hive-b',                          '2026-10-05T23:01:19', '2026-10-06T05:15:00', 'torn-down'),
    ('withdraw-01',    'board-b,placebo-a',                      '2026-10-06T05:22:41', '2026-10-06T14:39:00', 'promoted'),
    ('climbflood-02',  'board-a,board-c,hive-a',                 '2026-10-06T14:44:21', '2026-10-06T21:01:00', 'promoted'),
    ('foodskip-01',    'board-d,hive-c,placebo-b',               '2026-10-07T01:10:52', '2026-10-07T12:12:00', 'promoted'),
    ('towndeposit-01', 'board-b,placebo-a',                      '2026-10-07T13:06:18', '2026-10-07T16:15:00', 'torn-down'),
]
EVENTS = [(r, p.split(','), T(a + 'Z'), T(b + 'Z'), how) for r, p, a, b, how in EVENTS]
# bins relative to the END (teardown/promotion), hours; plus PRE (6 h before deploy) and DURING
POST = [(0, 3), (3, 6), (6, 9), (9, 12)]
UN = re.compile(r'(_pickaxe|_axe|_shovel|_sword|_hoe|_helmet|_chestplate|_leggings|_boots|bucket|shears|flint_and_steel|bow|fishing_rod)$')
def occupancy(inv):
    return sum(c if UN.search(n) else -(-c // 64) for n, c in (inv or {}).items() if isinstance(c, (int, float)) and c > 0)
def pool_of(b): return b.rsplit('-', 1)[0]

lo = min(e[2] for e in EVENTS) - dt.timedelta(hours=7)
hi = max(e[3] for e in EVENTS) + dt.timedelta(hours=13)
# per bot: list of (t, occ) samples (5 min), list of (t, items) delta rows
occ = defaultdict(list); items = defaultdict(list); last = {}
rows = 0; tmin = tmax = None
files = sorted(glob.glob('/var/log/mcai/*/skill-*.jsonl-2026100[4-9].gz')) + sorted(glob.glob('/var/log/mcai/*/skill-*.jsonl'))
for f in files:
    op = gzip.open if f.endswith('.gz') else open
    try:
        fh = op(f, 'rt', errors='replace')
    except Exception:
        continue
    with fh:
        for line in fh:
            i = line.find('"@timestamp":"')
            if i < 0: continue
            ts = line[i + 14:i + 38]
            try: t = dt.datetime.fromisoformat(ts.replace('Z', '+00:00'))
            except Exception: continue
            if t < lo or t > hi: continue
            rows += 1
            tmin = t if tmin is None or t < tmin else tmin; tmax = t if tmax is None or t > tmax else tmax
            j = line.find('"name":"', line.find('"bot":'))
            b = line[j + 8:line.find('"', j + 8)] if j >= 0 else ''
            if not b: continue
            hasd = '"inventory_delta"' in line
            need_occ = b not in last or (t - last[b]).total_seconds() >= 300
            if not (hasd or need_occ): continue
            try: d = json.loads(line)
            except Exception: continue
            bot = (d.get('bot') or {})
            if need_occ and isinstance(bot.get('inventory'), dict):
                occ[b].append((t, occupancy(bot['inventory']))); last[b] = t
            if hasd:
                v = sum(x for x in ((d.get('skill') or {}).get('inventory_delta') or {}).values() if isinstance(x, (int, float)) and x > 0)
                if v: items[b].append((t, v))

bots = sorted(set(occ) | set(items))
print('POSITIVE CONTROL rows in window %d | bots %d | ts %s .. %s | files %d' % (rows, len(bots), tmin, tmax, len(files)))
allpools = sorted({pool_of(b) for b in bots})
def live_or_recent(p, a, b):
    """pool p carried ANY canary, or was within 12 h after one, somewhere in [a, b]"""
    for _, ps, t0, t1, _ in EVENTS:
        if p in ps and t0 < b and t1 + dt.timedelta(hours=12) > a: return True
    return False

def poolstat(pools, a, b):
    """(mean occupancy over samples, items per bot-hour) for the bots of `pools` in [a, b]"""
    os_ = [o for bb in bots if pool_of(bb) in pools for (t, o) in occ[bb] if a <= t < b]
    it = sum(v for bb in bots if pool_of(bb) in pools for (t, v) in items[bb] if a <= t < b)
    bh = len(os_) * 5 / 60.0
    return (sum(os_) / len(os_) if os_ else float('nan'), it / bh if bh else float('nan'), len(os_))

def did(treated, control, e):
    _, _, t0, t1, _ = e
    pre = (t0 - dt.timedelta(hours=6), t0)
    bins = [('during', t0, t1)] + [('end+%d-%dh' % (x, y), t1 + dt.timedelta(hours=x), t1 + dt.timedelta(hours=y)) for x, y in POST]
    tp, cp = poolstat(treated, *pre), poolstat(control, *pre)
    out = {}
    for name, a, b in bins:
        tb, cb = poolstat(treated, a, b), poolstat(control, a, b)
        out[name] = ((tb[0] - cb[0]) - (tp[0] - cp[0]),
                     ((tb[1] / cb[1]) / (tp[1] / cp[1]) - 1) if cp[1] and tp[1] and cb[1] and tp[1] == tp[1] else float('nan'),
                     tb[2], cb[2])
    return out

res = {}
for e in EVENTS:
    run, ps, t0, t1, how = e
    a, b = t0 - dt.timedelta(hours=6), t1 + dt.timedelta(hours=12)
    others = [p for p in allpools if p not in ps and not p.startswith('isolated') and not live_or_recent(p, a, b)]
    control = [p for p in allpools if p not in ps and not live_or_recent(p, a, b)]  # isolated included, as in every read
    print('\n%s (%s, %d pools, %s) control %d pools: %s' % (run, how, len(ps), ','.join(ps), len(control), ','.join(control)))
    d = did(ps, control, e)
    for k, (docc, ditems, nt, nc) in d.items():
        print('   %-12s occ DiD %+6.2f slots | items/bh ratio-DiD %+6.1f%% | samples treated %5d control %6d' % (k, docc, 100 * ditems if ditems == ditems else float('nan'), nt, nc))
    # null: every pair of untreated, non-isolated pools in the same windows, against the same control minus that pair
    null = defaultdict(list)
    for pair in itertools.combinations(others, min(len(ps), 2)):
        dn = did(list(pair), [p for p in control if p not in pair], e)
        for k, (docc, ditems, _, _) in dn.items():
            null[k].append((docc, ditems))
    for k in d:
        oc = sorted(x[0] for x in null[k] if x[0] == x[0]); it = sorted(x[1] for x in null[k] if x[1] == x[1])
        if oc:
            q = lambda s, p: s[min(len(s) - 1, max(0, int(round(p * (len(s) - 1)))))]
            print('   null %-7s n=%3d occ DiD [p2.5 %+5.2f, p97.5 %+5.2f] | items [p2.5 %+5.1f%%, p97.5 %+5.1f%%]' % (
                k, len(oc), q(oc, .025), q(oc, .975), 100 * q(it, .025) if it else float('nan'), 100 * q(it, .975) if it else float('nan')))
    res[run] = {k: list(v) for k, v in d.items()}
json.dump(res, open(os.path.expanduser('~/lanes-work/carryover.json'), 'w'), default=str, indent=1)
