# guardcal.py -- calibrate the v15 movement guards on PSEUDO-canaries: random two-pool draws (5080 half, not
# placebo-c/isolated) at random cutoffs over the last N days, pre 180 / post 360 min, DiD vs the other pools.
# Lines: immobile share (pp), blocks moved per bot-h, items gathered per bot-h (gather/mine/collect rows only),
# deposit successes per bot-h, working share (bot-minutes with a skill row). Prints the DiD distribution and the
# false-trip rate at candidate thresholds. Rotation-aware (live + .gz generations in the window).
import sys, json, glob, gzip, random, datetime as dt, collections, math
DAYS = float(sys.argv[1]) if len(sys.argv) > 1 else 3; N = int(sys.argv[2]) if len(sys.argv) > 2 else 300
now = dt.datetime.now(dt.timezone.utc); start = now - dt.timedelta(days=DAYS)
POOLS = ['board-a','board-b','board-c','hive-a','hive-b','hive-c','placebo-a','placebo-b']   # 5080 half minus placebo-c
files = glob.glob('/var/log/mcai/*/skill-*.jsonl') + [f for f in glob.glob('/var/log/mcai/*/skill-*.jsonl-*.gz') if f.rsplit('-',1)[1][:8] >= (start.date()).strftime('%Y%m%d')]
rows = collections.defaultdict(list)   # bot -> [(t, kind, status, pos, items_gathered, dep_ok)]
GATHERISH = {'gather', 'mine', 'collect', 'harvest'}
for f in files:
    op = gzip.open if f.endswith('.gz') else open
    with op(f, 'rt', errors='replace') as fh:
        for l in fh:
            if l[:60].find('"@timestamp"') < 0: pass
            try: r = json.loads(l)
            except Exception: continue
            ts = r.get('@timestamp', '');
            if ts[:10] < start.strftime('%Y-%m-%d'): continue
            b = r.get('bot', {}).get('name', ''); pool = b.rsplit('-', 1)[0]
            if pool not in POOLS and not pool.startswith(('hive-d','board-d','placebo-d')): continue
            sk = r.get('skill') or {}; n = sk.get('name') or ''; st = sk.get('status')
            p = r.get('bot', {}).get('pos'); pos = (p['x'], p['z']) if isinstance(p, dict) and 'x' in p else None
            got = sum(v for v in (sk.get('inventory_delta') or {}).values() if v > 0) if n in GATHERISH else 0
            dep = 1 if (n == 'deposit' and st == 'success') else 0
            try: t = dt.datetime.fromisoformat(ts.replace('Z', '+00:00'))
            except Exception: continue
            rows[b].append((t, n, pos, got, dep))
for b in rows: rows[b].sort()
bots_by_pool = collections.defaultdict(list)
for b in rows: bots_by_pool[b.rsplit('-', 1)[0]].append(b)
def measure(bots, t0, t1):
    """per bot-h over [t0,t1): immobile share, blocks moved, items gathered, deposits ok, working share"""
    H = (t1 - t0).total_seconds() / 3600; nb = len(bots); bh = nb * H
    imm = 0.0; moved = 0.0; items = 0; deps = 0; work = 0
    for b in bots:
        rs = [r for r in rows[b] if t0 <= r[0] < t1]
        last = None; minute_pos = {}; work_min = set()
        for t, n, pos, got, dep in rs:
            items += got; deps += dep
            if not n.startswith('_') and n != 'status': work_min.add(int((t - t0).total_seconds() // 60))
            if pos:
                if last: d = math.hypot(pos[0] - last[0], pos[1] - last[1]); moved += min(d, 20)
                last = pos; minute_pos[int((t - t0).total_seconds() // 60)] = pos
        work += len(work_min)
        # immobile: 60-min windows in which the bot's displacement over the window < 6 blocks
        mins = sorted(minute_pos); 
        for w0 in range(0, int(H * 60) - 59, 30):
            ps = [minute_pos[m] for m in mins if w0 <= m < w0 + 60]
            if len(ps) >= 2 and math.hypot(ps[-1][0] - ps[0][0], ps[-1][1] - ps[0][1]) < 6: imm += 0.5
    return dict(bh=bh, immobile=imm / H / nb if nb and H else 0, moved=moved / bh if bh else 0, items=items / bh if bh else 0, deps=deps / bh if bh else 0, work=work / (60 * bh) if bh else 0)
random.seed(7); out = collections.defaultdict(list)
for i in range(N):
    cut = start + dt.timedelta(seconds=random.uniform(3 * 3600, DAYS * 86400 - 6 * 3600))
    cans = random.sample([p for p in POOLS if bots_by_pool[p]], 2); ctrl = [p for p in bots_by_pool if p not in cans and not p.startswith('isolated')]
    cb = [b for p in cans for b in bots_by_pool[p]]; kb = [b for p in ctrl for b in bots_by_pool[p]]
    cp = measure(cb, cut - dt.timedelta(minutes=180), cut); cq = measure(cb, cut, cut + dt.timedelta(minutes=360))
    kp = measure(kb, cut - dt.timedelta(minutes=180), cut); kq = measure(kb, cut, cut + dt.timedelta(minutes=360))
    for k in ('moved', 'items', 'deps', 'work'):
        def rel(a, b): return (b - a) / a if a else float('nan')
        d = rel(cp[k], cq[k]) - rel(kp[k], kq[k]);
        if not math.isnan(d): out[k].append(d)
    out['immobile_pp'].append((cq['immobile'] - cp['immobile']) - (kq['immobile'] - kp['immobile']))
print(f"pseudo-canaries {N} over {DAYS} days, two pools of five vs the rest, pre 180 / post 360; positive control: bots {len(rows)}, rows {sum(len(v) for v in rows.values())}")
for k, v in out.items():
    v = sorted(v); n = len(v); q = lambda f: v[int(f * (n - 1))]
    if k == 'immobile_pp':
        print(f"  {k:12} n {n}  p5 {100*q(0.05):+.1f}pp p50 {100*q(0.5):+.1f}pp p95 {100*q(0.95):+.1f}pp  false-trip at +3pp {100*sum(1 for x in v if x > 0.03)/n:.0f}%  at +5pp {100*sum(1 for x in v if x > 0.05)/n:.0f}%  at +8pp {100*sum(1 for x in v if x > 0.08)/n:.0f}%")
    else:
        print(f"  {k:12} n {n}  p5 {100*q(0.05):+.0f}% p50 {100*q(0.5):+.0f}% p95 {100*q(0.95):+.0f}%  false-trip at -30% {100*sum(1 for x in v if x < -0.30)/n:.0f}%  at -40% {100*sum(1 for x in v if x < -0.40)/n:.0f}%  at -50% {100*sum(1 for x in v if x < -0.50)/n:.0f}%")
