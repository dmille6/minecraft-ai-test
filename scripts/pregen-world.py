#!/usr/bin/env python3
"""Generate a world's operating radius BEFORE any bot connects.

    ./pregen-world.py <arm> --centre-from /srv/block2/town-<arm>.json [--radius 512]

WHY. Eight worlds from one seed are identical on disk but not identical in
COST. Generating a chunk is expensive and happens on the server thread; an arm
whose bots wander into fresh terrain under load pays tick time that an arm
sitting on already-generated ground never pays. The worlds stay identical while
the EXPERIENCE of them diverges -- an arm effect made of terrain caching, and one
that would never appear in the skill telemetry.

Every world is pregenerated over the same radius around its own town, so the
cost is paid once, off the clock, equally.

`forceload add` is the generator: it loads chunks, which creates them if they do
not exist. It caps at 256 chunks per command, so the area is walked in tiles and
each tile is released after it is written -- leaving thousands of chunks
forceloaded would keep the whole area ticking for the life of the server.
"""
import argparse, importlib.util, json, sys, time
from pathlib import Path

_spec = importlib.util.spec_from_file_location("pt", Path(__file__).parent / "place-town.py")
_pt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_pt)
Rcon, ARMS, ROOT, BASE_RCON = _pt.Rcon, _pt.ARMS, _pt.ROOT, _pt.BASE_RCON

TILE = 256          # blocks per side = 16x16 chunks = 256 chunks, the per-command cap


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("arm", choices=sorted(ARMS))
    ap.add_argument("--centre-from", help="town JSON from place-town.py")
    ap.add_argument("--x", type=int, default=0)
    ap.add_argument("--z", type=int, default=0)
    ap.add_argument("--radius", type=int, default=512,
                    help="blocks around the town. NOT the world border: this is the "
                         "distance bots plausibly reach in a shakedown, and it must be "
                         "the SAME for every arm")
    ap.add_argument("--settle", type=float, default=3.0,
                    help="seconds to let each tile finish generating")
    a = ap.parse_args()

    cx, cz = a.x, a.z
    if a.centre_from:
        d = json.loads(Path(a.centre_from).read_text())
        cx, cz = d["siting"]["chosen"]

    props = ROOT / a.arm / "server.properties"
    if not props.exists():
        raise SystemExit(f"{props} not found -- run provision-block2.sh first")
    conf = dict(l.split("=", 1) for l in props.read_text().splitlines()
                if "=" in l and not l.startswith("#"))
    rcon = Rcon("127.0.0.1", int(conf.get("rcon.port", BASE_RCON + ARMS[a.arm])),
                conf["rcon.password"].strip())

    tiles = []
    x = cx - a.radius
    while x < cx + a.radius:
        z = cz - a.radius
        while z < cz + a.radius:
            tiles.append((x, z))
            z += TILE
        x += TILE

    print(f"  {a.arm}: pregenerating {a.radius*2}x{a.radius*2} blocks around {cx},{cz} "
          f"-- {len(tiles)} tiles")
    t0 = time.time()
    for n, (x, z) in enumerate(tiles, 1):
        rcon.run(f"forceload add {x} {z} {x + TILE - 1} {z + TILE - 1}")
        time.sleep(a.settle)
        rcon.run(f"forceload remove {x} {z} {x + TILE - 1} {z + TILE - 1}")
        if n % 8 == 0 or n == len(tiles):
            print(f"    {n}/{len(tiles)} tiles  ({time.time()-t0:.0f}s)")
    # The town itself stays loaded for good: bots walk home to it, and a home
    # that unloads is a home the deposit walk cannot finish at.
    rcon.run(f"forceload add {cx-16} {cz-16} {cx+16} {cz+16}")
    print(f"  done in {time.time()-t0:.0f}s; town kept forceloaded")


if __name__ == "__main__":
    main()
