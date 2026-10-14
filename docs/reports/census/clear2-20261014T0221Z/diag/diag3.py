# READ-ONLY: estimated bag slots (sum of ceil(count/64), tools 1 each) per bot since the restart, from raw rows' inventory
import json, glob, math, collections
TOOLS = ('_pickaxe', '_axe', '_shovel', '_hoe', '_sword')
for w in ('hive-a', 'placebo-a', 'hive-c', 'placebo-b', 'board-c', 'placebo-d'):
    out = []
    for f in sorted(glob.glob('/var/log/mcai/%s-*/skill-%s-*.jsonl' % (w, w))):
        mx = 0; last = None; n = 0; t34 = 0
        for ln in open(f, errors='replace'):
            if '"2026-10-14T0' not in ln[:40]: continue
            try: r = json.loads(ln)
            except Exception: continue
            if r.get('@timestamp', '') < '2026-10-14T02:22:44Z': continue
            inv = (r.get('bot') or {}).get('inventory')
            if not isinstance(inv, dict): continue
            s = sum((v if k.endswith(TOOLS) or k in ('bucket', 'water_bucket') else math.ceil(v / 64)) for k, v in inv.items() if isinstance(v, int))
            mx = max(mx, s); last = s; n += 1; t34 += s >= 34
        out.append('%s max %s last %s rows>=34 %d/%d' % (f.split('/')[-2].split('-')[-1], mx, last, t34, n))
    print(w, ' | '.join(out))
