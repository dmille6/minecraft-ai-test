#!/usr/bin/env python3
"""ON THE SHOWCASE VM, as root: world rules + pregeneration for the chosen site (before frame 0).
    pregen.py --home X,Z --radius 1024 --border 5000
1. The bench's gamerules (place-town.GAMERULES: keepInventory, no weather cycle, immediate respawn, no fire tick, no mob
   griefing, ...), world spawn at home, the world border centred on home (radius --border; the command takes the
   DIAMETER), time day, weather clear -- place-town.world_rules(), unchanged.
2. Pregenerate every chunk within --radius of home in CHUNK-ALIGNED 16x16-chunk tiles (forceload add, wait until a
   probe inside the tile answers, forceload remove), so bots exploring later pay no generation tick time (the bench's
   pregen-world.py rationale). Writes nothing else. Design: docs/reports/showcase-2026-10-20.md section 7.
"""
import argparse, importlib.util, json, os, sys, time
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'scripts' / 'lib'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
spec = importlib.util.spec_from_file_location('pt', REPO / 'scripts' / 'place-town.py')
pt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pt)
import site_search as SS  # noqa: E402  (load_tiles, retry, surface_top)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--server', default='/srv/showcase/server')
    ap.add_argument('--home', required=True, help='X,Z')
    ap.add_argument('--radius', type=int, default=1024)
    ap.add_argument('--border', type=int, default=5000)
    a = ap.parse_args()
    hx, hz = (int(v) for v in a.home.split(','))
    conf = dict(l.split('=', 1) for l in Path(a.server, 'server.properties').read_text().splitlines()
                if '=' in l and not l.startswith('#'))
    rcon = pt.Rcon('127.0.0.1', int(conf['rcon.port']), conf['rcon.password'].strip())
    SS.load_tiles(rcon, hx - 16, hz - 16, hx + 16, hz + 16, on=True)
    y = SS.retry(lambda: SS.surface_top(rcon, hx, hz))
    for c in pt.world_rules(rcon, hx, hz, a.border, cy=y):
        out = rcon.run(c)
        print(f'  {c}  -> {out.strip()[:80]}')
    SS.load_tiles(rcon, hx - 16, hz - 16, hx + 16, hz + 16, on=False)
    t0 = time.time()
    c0x, c1x = (hx - a.radius) // 16, (hx + a.radius) // 16
    c0z, c1z = (hz - a.radius) // 16, (hz + a.radius) // 16
    tiles = [(cx, cz) for cx in range(c0x, c1x + 1, 16) for cz in range(c0z, c1z + 1, 16)]
    for i, (cx, cz) in enumerate(tiles, 1):
        bx0, bz0 = cx * 16, cz * 16
        bx1, bz1 = min(cx + 15, c1x) * 16 + 15, min(cz + 15, c1z) * 16 + 15
        SS.load_tiles(rcon, bx0, bz0, bx1, bz1, on=True)
        for px, pz in ((bx0, bz0), (bx1, bz1), ((bx0 + bx1) // 2, (bz0 + bz1) // 2)):
            SS.retry(lambda: SS.surface_top(rcon, px, pz))
        SS.load_tiles(rcon, bx0, bz0, bx1, bz1, on=False)
        if i % 8 == 0 or i == len(tiles):
            print(f'  {i}/{len(tiles)} tiles, {time.time() - t0:.0f}s', flush=True)
    rcon.run('save-all flush')
    print(json.dumps({'home': [hx, y + 1, hz], 'surface_y': y, 'radius': a.radius, 'border_radius': a.border,
                      'tiles': len(tiles), 'secs': round(time.time() - t0)}))


if __name__ == '__main__':
    main()
