#!/usr/bin/env python3
"""roadtraffic.py -- ROADS-01 (OWNER 11-09 "stone-brick roads ... choose routes from the bots' real travel lines; measure the
most-walked corridors"): the TRAFFIC REPORT the bots' road siting reads (bots/src/roads.mjs). Read-only over the logs and the
pool's records; writes ONE json file (atomic rename), nothing else.

  roadtraffic.py --pool showcase --home 0_70_0 [--logs '/var/log/mcai/showcase-*/skill-*.jsonl*'] [--days 7]
                 [--pooldir /var/lib/mcai/_pool-showcase] [--out <pooldir>/roadtraffic-<home>.json] [--dry]

WHAT IT MEASURES (the method of docs/reports/roads-design-2026-11-09.md section 2):
  * TRAFFIC: every bot's consecutive rows (bot.pos) at most 20 s apart, both in the surface band (home.y - 14 .. home.y + 40), a
    step of 0.8 .. 7 blocks/s: the segment is rasterised over 1x1 columns and each column it crosses counts ONE traversal (a bot
    standing still counts nothing; a long stay counts nothing more). A FULL WALK of every file in the window (rotated .gz too).
  * DESTINATIONS: the pool's records outside the town ring (forest, farms, the stair well, shrines, towers, the mine collar...)
    and the VILLAGES the bots saw (`_merchant_seen` rows: the villagers' positions, clustered by zone).
  * TRIPS: a bot inside the ring that next enters a destination's box (+3) within 15 min = one trip; per destination the count
    and the median seconds (the walk-time baseline).
  * ROUTES: for each destination with >= --min-trips trips, the most-walked line from the ring to it: a least-cost path over the
    traffic grid (8-neighbour; a column costs 1 + 3 x (1 - its traffic's log share of the corridor's 90th percentile)), from the
    destination's box edge nearest home to the ring's edge, so the line follows where the bots already walk. Thinned to every 3rd
    column. The bots route the road itself over the terrain within a band of this line (roads.mjs).
Output: { v, at, pool, home, days, span_h, rows, pos_rows, bots, walk_bot_h, ring, dests: [...], routes: [{ id, to, kind, box,
trips, median_s, start, line, len }] }. Stdlib only.
"""
import argparse, collections, datetime, glob, gzip, heapq, json, math, os, re, statistics, sys

ap = argparse.ArgumentParser()
ap.add_argument('--pool', required=True)
ap.add_argument('--home', required=True)
ap.add_argument('--logs')
ap.add_argument('--days', type=float, default=7)
ap.add_argument('--pooldir')
ap.add_argument('--out')
ap.add_argument('--min-trips', type=int, default=40)
ap.add_argument('--dry', action='store_true')
a = ap.parse_args()
POOLDIR = a.pooldir or f'/var/lib/mcai/_pool-{a.pool}'
LOGS = a.logs or f'/var/log/mcai/{a.pool}-*/skill-*.jsonl*'
HX, HY, HZ = (int(v) for v in a.home.split('_'))
now = datetime.datetime.now(datetime.timezone.utc)
since = now - datetime.timedelta(days=a.days)
YLO, YHI = HY - 14, HY + 40

# ---- the records ---------------------------------------------------------------------------------------------------------------
def latest_records():
    best = {}
    for f in os.listdir(POOLDIR):
        m = re.match(rf'project-{re.escape(a.home)}\.([a-z0-9_]+)\.g(\d+)\.json$', f)
        if m and (m.group(1) not in best or best[m.group(1)][0] < int(m.group(2))): best[m.group(1)] = (int(m.group(2)), f)
    out = {}
    for p, (g, f) in best.items():
        try: out[p] = json.load(open(os.path.join(POOLDIR, f)))
        except Exception: pass
    return out
recs = latest_records()
def box_of(r):
    cs = [c['at'] for c in (r.get('cells') or []) if isinstance(c, dict) and isinstance(c.get('at'), list)]
    if cs: return [min(c[0] for c in cs), min(c[2] for c in cs), max(c[0] for c in cs), max(c[2] for c in cs)]
    b = r.get('box')
    return b if isinstance(b, list) and len(b) == 4 else None
wall = recs.get('wall')
ring = wall.get('ring') if wall and isinstance(wall.get('ring'), list) and len(wall['ring']) == 4 else [HX - 24, HZ - 24, HX + 24, HZ + 24]
# the wall extension's own ring (its cells' box is only the walls it added: the rect they close is `ring`)
ext = recs['wallext'].get('ring') if 'wallext' in recs and isinstance(recs['wallext'].get('ring'), list) and len(recs['wallext']['ring']) == 4 else None
# the town's WALL columns (wall + extension cells): a route never crosses the ring there -- it leaves the town through a gap, as the
# bots walk (the road's landing column must be walkable ground, roads.mjs routeStart)
WALLCOLS = {(c['at'][0], c['at'][2]) for p in ('wall', 'wallext') for c in (recs.get(p, {}).get('cells') or []) if isinstance(c, dict) and isinstance(c.get('at'), list)}
def inside(x, z, b, m=0): return b[0] - m <= x <= b[2] + m and b[1] - m <= z <= b[3] + m
def in_town(x, z): return inside(x, z, ring) or (ext is not None and inside(x, z, ext))
# the destinations a road may lead to: a record whose box lies OUTSIDE the town (ring and wall extension), never a sink chain that
# spans the town (dress, decor, paths, tidy, land, road), never the wall itself
SKIP = {'dress', 'decor', 'paths', 'tidy', 'land', 'road', 'wall', 'wallext', 'siteprep', 'walldemo', 'treefarm', 'shopchest'}
dests = []
for p, r in recs.items():
    if p in SKIP or r.get('state') == 'retired': continue
    b = box_of(r)
    if not b: continue
    cx, cz = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    if in_town(cx, cz): continue
    if p in ('tower', 'shrine'):   # a chain of instances: one destination per instance
        for i in r.get('instances') or []:
            ib = i.get('box')
            if isinstance(ib, list) and len(ib) == 4 and not in_town((ib[0] + ib[2]) / 2, (ib[1] + ib[3]) / 2):
                dests.append({'id': f'{p}:{i.get("id")}', 'to': p, 'kind': 'landmark', 'box': ib})
        continue
    dests.append({'id': p, 'to': p, 'kind': {'forest': 'forest', 'cropfarm': 'farm', 'canefarm': 'farm', 'shaft': 'mine', 'stepwell': 'landmark', 'monument': 'landmark', 'yard': 'yard'}.get(p, 'project'), 'box': b})

# ---- one full walk of the logs --------------------------------------------------------------------------------------------------
def opener(p): return gzip.open(p, 'rt', errors='replace') if p.endswith('.gz') else open(p, errors='replace')
rows = pos_rows = 0
by_bot = collections.defaultdict(list)
vill = collections.defaultdict(list)
VRE = re.compile(r'villager .*? at (-?\d+),(-?\d+),(-?\d+) .*?zone=(village-[A-Za-z0-9_-]+)')
tmin = tmax = None
files = sorted(f for f in glob.glob(LOGS) if 'FIXTURE' not in f)
for p in files:
    tag = p.rsplit('-', 1)[-1].replace('.gz', '')
    if tag.isdigit() and len(tag) == 8 and datetime.datetime.strptime(tag, '%Y%m%d').replace(tzinfo=datetime.timezone.utc) < since - datetime.timedelta(days=1): continue
    with opener(p) as fh:
        for line in fh:
            rows += 1
            if '"pos"' not in line: continue
            try: r = json.loads(line)
            except Exception: continue
            ts = r.get('@timestamp')
            if not ts: continue
            t = datetime.datetime.fromisoformat(ts.replace('Z', '+00:00'))
            if t < since: continue
            if ((r.get('exp') or {}).get('pool') or a.pool) != a.pool: continue
            if (r.get('game') or {}).get('dimension', 'overworld') != 'overworld': continue
            b = r.get('bot') or {}; pos = b.get('pos'); name = b.get('name')
            if not pos or not name: continue
            e = t.timestamp(); tmin = e if tmin is None else min(tmin, e); tmax = e if tmax is None else max(tmax, e)
            by_bot[name].append((e, pos['x'], pos['y'], pos['z'])); pos_rows += 1
            sk = r.get('skill') or {}
            if sk.get('name') == '_merchant_seen':
                m = VRE.search(str(sk.get('detail') or ''))
                if m: vill[m.group(4)].append((int(m.group(1)), int(m.group(3))))
for zone, ps in vill.items():
    xs, zs = sorted(p[0] for p in ps), sorted(p[1] for p in ps)
    mx, mz = xs[len(xs) // 2], zs[len(zs) // 2]
    if not in_town(mx, mz): dests.append({'id': zone, 'to': 'village', 'kind': 'village', 'box': [mx - 12, mz - 12, mx + 12, mz + 12], 'seen': len(ps)})

grid = collections.Counter()
walk_s = 0.0
trips = collections.defaultdict(list)
def dest_at(x, z):
    for d in dests:
        if inside(x, z, d['box'], 3): return d['id']
    return None
for bot, rs in by_bot.items():
    rs.sort()
    for (t0, x0, y0, z0), (t1, x1, y1, z1) in zip(rs, rs[1:]):
        dt = t1 - t0
        if dt <= 0 or dt > 20 or not (YLO <= y0 <= YHI and YLO <= y1 <= YHI): continue
        dx, dz = x1 - x0, z1 - z0; d = math.hypot(dx, dz)
        if d < 0.8 or d > dt * 7.0: continue
        walk_s += dt
        n = max(1, int(d * 2)); seen = set()
        for i in range(n + 1):
            c = (math.floor(x0 + dx * i / n), math.floor(z0 + dz * i / n))
            if c not in seen: seen.add(c); grid[c] += 1
    left = None
    for (t, x, y, z) in rs:
        if not (YLO <= y <= YHI): continue
        if in_town(x, z): left = t; continue
        dn = dest_at(x, z)
        if dn and left is not None:
            if t - left <= 900: trips[dn].append(t - left)
            left = None
for d in dests:
    v = trips.get(d['id'], [])
    d['trips'] = len(v); d['median_s'] = round(statistics.median(v), 1) if v else None

# ---- the routes -------------------------------------------------------------------------------------------------------------------
def route(d):
    b = d['box']
    # the destination's columns on its box edge nearest home; the ring's outline (+2) the goal
    sx = min(max(HX, b[0]), b[2]); sz = min(max(HZ, b[1]), b[3])
    lo = [min(ring[0], b[0]) - 12, min(ring[1], b[1]) - 12, max(ring[2], b[2]) + 12, max(ring[3], b[3]) + 12]
    vals = sorted(grid[(x, z)] for x in range(lo[0], lo[2] + 1) for z in range(lo[1], lo[3] + 1) if grid[(x, z)] > 0)
    p90 = vals[int(len(vals) * 0.9)] if vals else 1
    L90 = math.log1p(max(1, p90))
    def cost(x, z): return 1.0 + 3.0 * (1.0 - min(1.0, math.log1p(grid[(x, z)]) / L90))
    goal = lambda x, z: in_town(x, z)
    dist = {(sx, sz): 0.0}; prev = {}; pq = [(0.0, sx, sz)]
    end = None
    while pq:
        c, x, z = heapq.heappop(pq)
        if c > dist.get((x, z), 1e18): continue
        if goal(x, z): end = (x, z); break
        for ddx in (-1, 0, 1):
            for ddz in (-1, 0, 1):
                if not ddx and not ddz: continue
                nx, nz = x + ddx, z + ddz
                if not (lo[0] <= nx <= lo[2] and lo[1] <= nz <= lo[3]) or (nx, nz) in WALLCOLS: continue
                nc = c + cost(nx, nz) * (1.4142 if ddx and ddz else 1.0)
                if nc < dist.get((nx, nz), 1e18): dist[(nx, nz)] = nc; prev[(nx, nz)] = (x, z); heapq.heappush(pq, (nc, nx, nz))
    if not end: return None
    pts = [end]
    while pts[-1] in prev: pts.append(prev[pts[-1]])
    # pts runs town -> destination; the start is the first column outside the town
    k = 0
    while k < len(pts) and in_town(*pts[k]): k += 1
    pts = pts[k:]
    if len(pts) < 6: return None
    line = [list(p) for i, p in enumerate(pts) if i % 3 == 0 or i == len(pts) - 1]
    share = sum(grid[p] for p in pts) / len(pts)
    return {'start': list(pts[0]), 'line': line, 'len': len(pts), 'mean_traffic': round(share, 1)}
routes = []
for d in sorted(dests, key=lambda d: -d['trips']):
    if d['trips'] < a.min_trips: continue
    r = route(d)
    if r: routes.append({'id': d['id'], 'to': d['to'], 'kind': d['kind'], 'box': d['box'], 'trips': d['trips'], 'median_s': d['median_s'], **r})
out = {'v': 1, 'at': now.isoformat(), 'pool': a.pool, 'home': [HX, HY, HZ], 'days': a.days, 'span_h': round(((tmax or 0) - (tmin or 0)) / 3600, 1),
       'rows': rows, 'pos_rows': pos_rows, 'bots': sorted(by_bot), 'walk_bot_h': round(walk_s / 3600, 1), 'files': len(files), 'ring': ring, 'ext': ext,
       'dests': sorted(dests, key=lambda d: -d['trips']), 'routes': routes}
summary = {k: out[k] for k in ('pool', 'span_h', 'rows', 'pos_rows', 'walk_bot_h', 'files')}
summary['bots'] = len(out['bots'])
print(json.dumps(summary))
for d in out['dests']: print('dest', d['id'], d['kind'], d['box'], 'trips', d['trips'], 'median_s', d['median_s'])
for r in routes: print('route', r['id'], 'trips', r['trips'], 'len', r['len'], 'start', r['start'], 'mean_traffic', r['mean_traffic'])
# a zero is never written as an answer: no position row in the window is an instrument failure, not "no traffic"
if pos_rows == 0: sys.exit('ZERO pos rows in the window: the glob or the window is wrong -- nothing written')
if a.dry: sys.exit(0)
path = a.out or os.path.join(POOLDIR, f'roadtraffic-{a.home}.json')
tmp = f'{path}.{os.getpid()}.tmp'
with open(tmp, 'w') as fh: json.dump(out, fh)
os.replace(tmp, path)
print('wrote', path)
