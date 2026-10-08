#!/usr/bin/env python3
"""keep180_check.py  -- POSITIVE CONTROL for keep180_bins.stats + keep180_power.score: rebuild the per-bot statistics for
REAL canaries' read windows and compare the guard values with the immobiledid evidence the live read emitted at the time
(~/digest/reads/<run>-immobiledid-<M>.json, manifest fields sha/pools/declared_at in the object). Asserts agreement."""
import os, sys, json, glob, datetime as dt
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import keep180_bins as KB, keep180_power as KP
files = sorted(glob.glob(os.path.expanduser('~/digest/reads/*-immobiledid-180.json')) + glob.glob(os.path.expanduser('~/digest/reads/*-immobiledid-360.json')),
               key=os.path.getmtime)[-int(sys.argv[1]) if len(sys.argv) > 1 else -4:]
bad = 0; n = 0
for f in files:
    o = json.load(open(f))
    pools = {p.strip() for p in str(o.get('pools') or '').split(',') if p.strip()}
    if not pools or not o.get('declared_at'):
        continue
    cut = dt.datetime.fromisoformat(o['declared_at'].replace('Z', '+00:00')); W = int(o['window_min'])
    stats = {}
    for b in KB.BOTS:
        rows = KB.bot_rows(b, cut - dt.timedelta(minutes=KB.PRE + 61), cut + dt.timedelta(minutes=W))
        s = KB.stats(rows, cut, W)
        stats[b] = {'pre': s['pre'], 'post': s['post']}
    mine = KP.score(stats, pools, 'post')
    live = o['fields']['v15c']; v11 = o['fields']['v11']
    pairs = [('moved', live['moved']), ('work', live['work']), ('items', live['items']), ('imm_pp', live['imm_pp']), ('newly', live['newly_immobile']),
             ('climbs', v11['climbs']), ('livelock', v11['livelock']), ('p90', v11['ladders_p90'])]
    diffs = [(k, mine[k], v) for k, v in pairs if not (v is None or v != v or abs((mine[k] or 0) - v) <= 1e-6 + 0.005 * abs(v))]
    n += 1; bad += bool(diffs)
    print(os.path.basename(f), 'pools', sorted(pools), 'W', W, 'MATCH' if not diffs else 'DIFF %s' % diffs)
print('POSITIVE CONTROL: %d of %d real read windows reproduced' % (n - bad, n))
sys.exit(1 if bad or not n else 0)
