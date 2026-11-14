#!/usr/bin/env python3
# Read-only: the open pits and the roofed hollows of the showcase town, from the server save, against the tidy record fills.
import sys, json, glob, os, statistics
from collections import Counter, defaultdict, deque
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "scripts", "host"))   # regiondump.py in the repo; the capsule carries its own copy beside this file
import regiondump as RD
R = int(sys.argv[1]) if len(sys.argv) > 1 else 48
d = RD.dump(os.environ.get("CAPSULE_REGION", "/srv/showcase/server/world/region"), -R - 4, R + 4, -R - 4, R + 4, 50, 110)
pal = [p["name"].replace("minecraft:", "") for p in d["palette"]]
blk = {}
for x, y, z, i in d["cells"]: blk[(x, y, z)] = pal[i]
print("CONTROL saved", d["saved"], "newest", d.get("saved_newest"), "cells", len(blk), "chunks", d["chunks"], "missing", d["missing_chunks"])
SOFT = lambda n: n is None or n.endswith("_leaves") or n.endswith("_log") or n in ("short_grass", "tall_grass", "fern", "large_fern", "snow", "torch", "wall_torch", "vine", "dandelion", "poppy") or "flower" in n or n.endswith("_sapling") or n.endswith("tulip") or n.endswith("_sign")
LIQ = lambda n: n in ("water", "lava", "bubble_column", "seagrass", "tall_seagrass", "kelp", "kelp_plant")
top = {}
for x in range(-R - 4, R + 5):
    for z in range(-R - 4, R + 5):
        for y in range(110, 49, -1):
            n = blk.get((x, y, z))
            if n is not None and not SOFT(n): top[(x, z)] = (y, n); break
print("columns", len(top), "top kinds", Counter(n for _, n in top.values()).most_common(12))
# records: every cell any record owns, and the tidy fills still open
own, fills = {}, {}
import re as _re
best = {}
for f in glob.glob(os.environ.get("CAPSULE_POOL", "/var/lib/mcai/_pool-showcase") + "/project-0_70_0.*.json"):
    m = _re.match(r"project-0_70_0\.([A-Za-z0-9_]+)\.g(\d+)\.json$", os.path.basename(f))
    if m and int(m.group(2)) >= best.get(m.group(1), (-1, ""))[0]: best[m.group(1)] = (int(m.group(2)), f)
TIDY = None
for plot, (g, f) in best.items():
    r = json.load(open(f))
    if plot == "tidy": TIDY = r
    for c in r.get("cells") or []:
        a = c.get("at") if isinstance(c, dict) else None
        if not isinstance(a, list): continue
        if plot == "tidy": fills[tuple(a)] = c.get("role")
        else: own.setdefault(tuple(a), plot)
print("tidy record g%s: skipped %s | waived %d | inwall keys %s" % (TIDY.get("gen"), json.dumps(TIDY.get("skipped"))[:600], len(TIDY.get("waived") or {}), list((TIDY.get("inwall") or {}).keys())))
print("inwall", json.dumps({k: (v if not isinstance(v, (list, dict)) else len(v)) for k, v in (TIDY.get("inwall") or {}).items()})[:500])
print("record cells", len(own), "by plot", Counter(own.values()).most_common(14))
print("tidy fill cells", len(fills), "still open", sum(1 for a in fills if blk.get(a) is None or SOFT(blk.get(a))))
# open pits: a column whose top is >= 2 under the median of the tops within 3
def med(x, z, r=3):
    v = [top[(x + dx, z + dz)][0] for dx in range(-r, r + 1) for dz in range(-r, r + 1) if (dx or dz) and (x + dx, z + dz) in top]
    return statistics.median(v) if v else None
pit = {}
for (x, z), (y, n) in top.items():
    if max(abs(x), abs(z)) > R or LIQ(n): continue
    m = med(x, z)
    if m is not None and y <= m - 2: pit[(x, z)] = (y, m)
def comps(cells):
    seen, out = set(), []
    for c in cells:
        if c in seen: continue
        q, comp = deque([c]), []
        seen.add(c)
        while q:
            a = q.popleft(); comp.append(a)
            for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                b = (a[0] + dx, a[1] + dz)
                if b in cells and b not in seen: seen.add(b); q.append(b)
        out.append(comp)
    return sorted(out, key=len, reverse=True)
pc = comps(set(pit))
vol = lambda comp: sum(int(pit[c][1] - pit[c][0]) for c in comp)
print("\nOPEN PITS (top >= 2 under the median within 3): %d columns in %d pits; blocks to fill %d" % (len(pit), len(pc), sum(vol(c) for c in pc)))
print("  by size: 1 col %d | 2-9 %d | 10-30 %d | >30 %d" % (sum(1 for c in pc if len(c) == 1), sum(1 for c in pc if 2 <= len(c) <= 9), sum(1 for c in pc if 10 <= len(c) <= 30), sum(1 for c in pc if len(c) > 30)))
for comp in pc[:14]:
    xs, zs = [c[0] for c in comp], [c[1] for c in comp]
    deep = max(int(pit[c][1] - pit[c][0]) for c in comp)
    planned = sum(1 for c in comp if any((c[0], y, c[1]) in fills for y in range(pit[c][0] + 1, int(pit[c][1]) + 1)))
    owned = Counter(own.get((c[0], y, c[1])) for c in comp for y in range(pit[c][0] - 1, int(pit[c][1]) + 2) if (c[0], y, c[1]) in own and own[(c[0], y, c[1])] != "tidy")
    wet = sum(1 for c in comp if any(LIQ(blk.get((c[0], y, c[1])) or "") for y in range(pit[c][0], pit[c][0] + 3)))
    print("  %3d cols x %d..%d z %d..%d  floor y %d..%d  deepest %d  blocks %d | tidy plans a fill in %d cols | other records %s | wet cols %d" % (len(comp), min(xs), max(xs), min(zs), max(zs), min(pit[c][0] for c in comp), max(pit[c][0] for c in comp), deep, vol(comp), planned, dict(owned.most_common(3)), wet))
# roofed hollows: air cells with a solid block over them within 6 under the column top (not liquid), walkable height
hol = defaultdict(list)
for (x, z), (y, n) in top.items():
    if max(abs(x), abs(z)) > R: continue
    for yy in range(y - 1, max(51, y - 9), -1):
        if blk.get((x, yy, z)) is None: hol[(x, z)].append(yy)
hc = comps(set(hol))
hv = lambda comp: sum(len(hol[c]) for c in comp)
print("\nROOFED HOLLOWS (air within 8 under the ground top): %d columns in %d hollows; air blocks %d" % (len(hol), len(hc), sum(hv(c) for c in hc)))
print("  by size: 1 col %d | 2-9 %d | 10-30 %d | >30 %d" % (sum(1 for c in hc if len(c) == 1), sum(1 for c in hc if 2 <= len(c) <= 9), sum(1 for c in hc if 10 <= len(c) <= 30), sum(1 for c in hc if len(c) > 30)))
for comp in hc[:12]:
    xs, zs = [c[0] for c in comp], [c[1] for c in comp]
    planned = sum(1 for c in comp if any((c[0], y, c[1]) in fills for y in hol[c]))
    owned = Counter(own.get((c[0], y, c[1])) for c in comp for y in hol[c] + [top[c][0]] if (c[0], y, c[1]) in own and own[(c[0], y, c[1])] != "tidy")
    roofk = Counter(top[c][1] for c in comp)
    print("  %3d cols x %d..%d z %d..%d  air y %d..%d  air blocks %d | tidy plans a fill in %d cols | other records %s | roof %s" % (len(comp), min(xs), max(xs), min(zs), max(zs), min(min(hol[c]) for c in comp), max(max(hol[c]) for c in comp), hv(comp), planned, dict(owned.most_common(3)), dict(roofk.most_common(3))))
