#!/usr/bin/env python3
"""Score candidate town sites in the showcase world for the TOWN PLAN's footprint (128 x 128 blocks).

    site_search.py --server /srv/showcase/server [--radius 288] [--step 96] --out site-<seed>.json

Runs ON THE SHOWCASE VM against its own Paper server (RCON on localhost). It reuses scripts/place-town.py's probes
unchanged -- column(), surface_y(), matches() with the tri-state Probe (an unloaded chunk RAISES, it never reads as
"dry flat ground"), _ring() -- and adds the larger footprint the town plan needs:

  AREA      a 17 x 17 grid every 8 blocks over the 128 x 128 plot area centred on the candidate
  CORE      the central 64 x 64 (the core storehouse, workshop and first plots): no water, relief <= 4
  AREA      wet fraction <= 3 %, relief p90-p10 of solid ground <= 8, canopy <= 30 %
  WOOD      ring 80..128 blocks out (outside the plots): >= 6 of 48 columns are logs/leaves (the bench's 12.5 %)
  WATER     a river or lake 96..256 blocks out (for the well at the edge / farm water): water columns on 3 rings
  SPAWN     distance from world spawn (the bots spawn at the town once it is stamped; this is only a tie-break)

It writes NOTHING to the world except what probing needs: forceloads (removed after each candidate) -- which
generate chunks -- and no blocks. A positive control per candidate: the sky 40 blocks above the centre must read
not-air=no, and a column the run counted as solid must read solid again.
"""
import argparse, importlib.util, json, math, os, re, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'scripts' / 'lib'))
_spec = importlib.util.spec_from_file_location('pt', REPO / 'scripts' / 'place-town.py')
pt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(pt)
from probe import UnknownWorldState  # noqa: E402

HALF = 64          # the 128 x 128 plot area
CORE = 32          # the central 64 x 64
GRID = 8
WOOD_R = (80, 104, 128)
WATER_R = (96, 160, 256)
LIMITS = {'core_relief': 5, 'area_relief': 10, 'cave_probes': 8, 'area_wet': 0.03, 'area_canopy': 0.30, 'wood_hits': 6}   # wood: the bench's ratio (place-town 3 of 24 = 6 of 48)


def load_tiles(rcon, x0, z0, x1, z1, on=True):
    """forceload add/remove in CHUNK-ALIGNED tiles of 16 x 16 = 256 chunks (the command's cap). An unaligned 256-block
    tile spans 17 chunks per axis (289) and is REFUSED -- the 10-20 trial forceloaded only the edge strips that way,
    and every probe in between read 'not loaded'. A refusal now raises instead of being ignored."""
    verb = 'add' if on else 'remove'
    c0x, c1x, c0z, c1z = x0 // 16, x1 // 16, z0 // 16, z1 // 16
    for cx in range(c0x, c1x + 1, 16):
        for cz in range(c0z, c1z + 1, 16):
            bx0, bz0 = cx * 16, cz * 16
            bx1, bz1 = min(cx + 15, c1x) * 16 + 15, min(cz + 15, c1z) * 16 + 15
            out = rcon.run(f'forceload {verb} {bx0} {bz0} {bx1} {bz1}')
            if on and not re.search(r'Marked|already|force loaded', out or '', re.I):
                raise RuntimeError(f'forceload {verb} {bx0} {bz0} {bx1} {bz1} refused: {out!r}')


def surface_top(rcon, x, z, hi=200, lo=-64, step=8):
    """The FIRST non-air block scanning DOWN from the sky (coarse steps, then a binary search inside the last step).
    place-town's surface_y() binary-searches the whole column, which assumes air above / solid below; in 1.21 terrain
    with large caves it converges inside a cave a fifth to a third of the time (seed trial 10-20: 0,16 read y=-2 beside
    y=78, 20-90 of 289 columns per candidate). Scanning from above cannot enter a cave before it meets the surface.
    Unknown (unloaded) still RAISES through Probe.require."""
    air = lambda y: pt.matches(rcon, x, y, z, 'minecraft:air').require(f'air at {x},{y},{z}')
    if not air(hi):
        return hi
    y = hi
    while y - step > lo and air(y - step):
        y -= step
    top_air, below = y, max(lo, y - step)          # air at top_air; the first non-air is in (below, top_air)
    if air(below):
        return lo
    a, b = below, top_air                          # non-air at a, air at b
    while b - a > 1:
        m = (a + b) // 2
        if air(m):
            b = m
        else:
            a = m
    return a


def column_top(rcon, x, z):
    """(y, kind) at the sky-facing surface: solid | water | canopy | void (place-town's kinds)."""
    y = surface_top(rcon, x, z)
    if y <= -63:
        return y, 'void'
    is_ = lambda spec: pt.matches(rcon, x, y, z, spec).require(f'{spec} at {x},{y},{z}')
    if is_('minecraft:water') or is_('minecraft:ice'):
        return y, 'water'
    if is_('#minecraft:leaves') or is_('#minecraft:logs'):
        return y, 'canopy'
    return y, 'solid'


def retry(fn, tries=360, wait=1.0):
    """Probe until the chunk answers (generation is asynchronous; `forceload add` returns when QUEUED)."""
    for i in range(tries):
        try:
            return fn()
        except UnknownWorldState:
            time.sleep(wait)
    return fn()


def pct(vals, q):
    s = sorted(vals)
    return s[min(len(s) - 1, max(0, int(round(q * (len(s) - 1)))))]


def score(rcon, cx, cz):
    pad = max(WATER_R) + 8
    load_tiles(rcon, cx - pad, cz - pad, cx + pad, cz + pad, on=True)
    try:
        st = {'x': cx, 'z': cz}
        cols = []
        for dx in range(-HALF, HALF + 1, GRID):
            for dz in range(-HALF, HALF + 1, GRID):
                y, kind = retry(lambda: column_top(rcon, cx + dx, cz + dz))
                cols.append((dx, dz, y, kind))
        core = [c for c in cols if abs(c[0]) <= CORE and abs(c[1]) <= CORE]
        # place-town's surface_y is a binary search that assumes air above / solid below; a column over a CAVE can
        # converge inside the cave (seed trial 10-20: 0,16 read y=-2 beside y=78). Such reads are counted, not used.
        allsolid = [c[2] for c in cols if c[3] == 'solid']
        med = sorted(allsolid)[len(allsolid) // 2] if allsolid else 0
        cave = lambda y: y < med - 16
        st['cave_probes'] = sum(1 for y in allsolid if cave(y))
        solid = [y for y in allsolid if not cave(y)]
        csolid = [c[2] for c in core if c[3] == 'solid' and not cave(c[2])]
        st['core_water'] = sum(1 for c in core if c[3] == 'water')
        st['area_wet'] = round(sum(1 for c in cols if c[3] == 'water') / len(cols), 3)
        st['area_canopy'] = round(sum(1 for c in cols if c[3] == 'canopy') / len(cols), 3)
        st['area_void'] = sum(1 for c in cols if c[3] == 'void')
        st['core_relief'] = (pct(csolid, 0.9) - pct(csolid, 0.1)) if csolid else 99
        st['area_relief'] = (pct(solid, 0.9) - pct(solid, 0.1)) if solid else 99
        st['base_y'] = int(round(sorted(csolid)[len(csolid) // 2])) if csolid else None
        wood = 0
        for r in WOOD_R:
            for ox, oz in pt._ring(r, n=16):
                y = retry(lambda: surface_top(rcon, cx + ox, cz + oz))
                if any(retry(lambda: pt.matches(rcon, cx + ox, y, cz + oz, s).require('wood'))
                       for s in ('#minecraft:logs', '#minecraft:leaves')):
                    wood += 1
        st['wood_hits'] = wood
        water = []
        for r in WATER_R:
            for ox, oz in pt._ring(r, n=32):
                y, kind = retry(lambda: column_top(rcon, cx + ox, cz + oz))
                if kind == 'water':
                    water.append([cx + ox, cz + oz, r])
        st['water_hits'] = len(water)
        st['nearest_water'] = min((w[2] for w in water), default=None)
        st['water_example'] = water[0][:2] if water else None
        # controls: a known-no (sky) and a known-yes (re-read a counted solid column)
        sky = retry(lambda: pt.matches(rcon, cx, (st['base_y'] or 64) + 60, cz, 'minecraft:air').require('sky'))
        ref = next((c for c in cols if c[3] == 'solid'), None)
        again = retry(lambda: column_top(rcon, cx + ref[0], cz + ref[1])) if ref else None
        st['controls_ok'] = bool(sky) and (again is None or again[1] == 'solid')
        why = []
        if st['area_void']:
            why.append('void columns')
        if st['core_water']:
            why.append(f"{st['core_water']} water columns in the core")
        for k in ('core_relief', 'area_relief', 'cave_probes'):
            if st[k] > LIMITS[k]:
                why.append(f'{k} {st[k]} > {LIMITS[k]}')
        for k in ('area_wet', 'area_canopy'):
            if st[k] > LIMITS[k]:
                why.append(f'{k} {st[k]} > {LIMITS[k]}')
        if wood < LIMITS['wood_hits']:
            why.append(f'wood {wood} < {LIMITS["wood_hits"]}')
        if not st['controls_ok']:
            why.append('a control failed (probe results not trusted)')
        st['ok'] = not why
        st['why'] = why
        # rank: flatter + wood + water close + near spawn
        st['score'] = round(
            - 3 * st['core_relief'] - st['area_relief'] - 40 * st['area_wet'] - 10 * st['area_canopy']
            + min(wood, 24) * 0.5 + (6 if st['nearest_water'] and st['nearest_water'] <= 160 else
                                     3 if st['nearest_water'] else 0)
            - math.hypot(cx, cz) / 200, 2)
        return st
    finally:
        load_tiles(rcon, cx - pad, cz - pad, cx + pad, cz + pad, on=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--server', default='/srv/showcase/server')
    ap.add_argument('--x', type=int, default=0)
    ap.add_argument('--z', type=int, default=0)
    ap.add_argument('--rings', type=int, default=3)
    ap.add_argument('--step', type=int, default=96)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    conf = dict(l.split('=', 1) for l in Path(a.server, 'server.properties').read_text().splitlines()
                if '=' in l and not l.startswith('#'))
    rcon = pt.Rcon('127.0.0.1', int(conf['rcon.port']), conf['rcon.password'].strip())
    seed = conf.get('level-seed')
    res = []
    for ring in range(a.rings + 1):
        pts = [(0, 0)] if ring == 0 else pt._ring(ring * a.step, n=8 * ring)
        for dx, dz in pts:
            t0 = time.time()
            st = score(rcon, a.x + dx, a.z + dz)
            st['secs'] = round(time.time() - t0, 1)
            res.append(st)
            print(f"  {'OK ' if st['ok'] else '   '} {st['x']:>5},{st['z']:>5} score {st['score']:>7} "
                  f"core {st['core_relief']} area {st['area_relief']} wet {st['area_wet']} canopy {st['area_canopy']} "
                  f"wood {st['wood_hits']} water@{st['nearest_water']} {'; '.join(st['why'])} ({st['secs']}s)",
                  flush=True)
    ok = sorted((r for r in res if r['ok']), key=lambda r: -r['score'])
    out = {'seed': seed, 'searched_from': [a.x, a.z], 'step': a.step, 'rings': a.rings, 'limits': LIMITS,
           'footprint': {'half': HALF, 'core_half': CORE, 'grid': GRID}, 'candidates': res,
           'best': ok[0] if ok else None, 'n_ok': len(ok)}
    Path(a.out).write_text(json.dumps(out, indent=1))
    print(json.dumps({'seed': seed, 'n_ok': len(ok), 'best': ok[0] if ok else None}))


if __name__ == '__main__':
    main()
