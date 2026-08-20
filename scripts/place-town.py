#!/usr/bin/env python3
"""place-town.py -- build the identical town in one Block 2 world.

    ./place-town.py <arm> [--x 0] [--z 0] [--dry-run]

IDENTICAL FURNITURE IN ALL FOUR WORLDS, LECTERN INCLUDED. The hive and isolated
bots never walk to the lectern, but it exists in their world all the same.
Placing it in only the board and placebo worlds would make the WORLDS differ
between arms -- precisely the confound the shared seed exists to prevent. The
arms differ in what bots may remember, and in nothing else.

THE COORDINATES ARE DERIVED, NOT HARDCODED. Block 1's town sat at a y that was
true for Block 1's seed. Block 2 uses a new fixed seed, so the same numbers
could land inside a mountain or under a lake -- and a chest sealed in stone
fails silently, looking exactly like bots that never learned to deposit. So
this probes the actual terrain: it drops an armor stand and reads back where it
came to rest. Everything else is placed relative to that surface, and the
resulting coordinates are printed for the env files.
"""
import argparse, json, math, re, secrets, socket, struct, sys, time
from pathlib import Path

ROOT = Path("/srv/block2")
# EIGHT WORLDS, in provision-block2.sh's order -- the index is what maps an arm
# to its port, so the two files must agree or a town is stamped into the wrong
# world. This map was still the pre-amendment four when the build moved to two
# pools per arm.
ARMS = {w: i for i, w in enumerate([
    "hive-a", "hive-b", "board-a", "board-b",
    "isolated-a", "isolated-b", "placebo-a", "placebo-b",
])}
BASE_RCON = 25670


class Rcon:
    """Minimal RCON client. Vendored deliberately: the shared helper has lived
    in /tmp on at least one host, and /tmp does not survive a reboot."""

    def __init__(self, host, port, password, timeout=10):
        self.sock = socket.create_connection((host, port), timeout)
        self.rid = 0
        if self._cmd(3, password) is None:
            raise SystemExit(f"rcon auth failed on {host}:{port}")

    def _cmd(self, kind, body):
        self.rid += 1
        rid = self.rid
        payload = struct.pack("<ii", rid, kind) + body.encode() + b"\x00\x00"
        self.sock.sendall(struct.pack("<i", len(payload)) + payload)
        size = struct.unpack("<i", self._read(4))[0]
        resp_id, _ = struct.unpack("<ii", self._read(8))
        data = self._read(size - 8)[:-2].decode(errors="replace")
        return None if resp_id == -1 else data

    def _read(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise SystemExit("rcon connection closed mid-read")
            buf += chunk
        return buf

    def run(self, cmd):
        return self._cmd(2, cmd) or ""


# Biomes whose terrain is mostly or partly water. Rejected outright: a town in
# one of these puts every outbound journey in the sea no matter how dry the
# centre block happens to be.
WET_BIOME = re.compile(r"ocean|river|swamp|beach|shore", re.I)

# Sampling geometry. The centre, the platform footprint, then rings out to 32.
# The old test looked at ONE column and asked only whether it was void or deep
# water. Drowning was a third of every event the fleet logged, so one column was
# never going to be enough.
def _ring(r, n=8):
    return [(round(r * math.cos(a * 2 * math.pi / n)),
             round(r * math.sin(a * 2 * math.pi / n))) for a in range(n)]

SAMPLE_OFFSETS = [(0, 0)] + _ring(6) + _ring(16) + _ring(32)
PLATFORM_HALF = 6          # town_plan fills a 13x13 platform
MAX_PLATFORM_SLOPE = 3     # blocks of relief across the footprint
MAX_WET_FRACTION = 0.05    # of sampled columns within 32 blocks
MAX_ROUTE_DROP = 6         # a cardinal route that falls further is a trap
# Canopy is not merely inconvenient: the surface probe returns the TREETOP, so
# every slope and route reading taken through a forest is measuring the wrong
# surface. Past this fraction the site's terrain numbers cannot be trusted.
MAX_CANOPY_FRACTION = 0.35


def matches(rcon, x, y, z, spec):
    """True when the block at x,y,z matches a block id or #tag.

    `execute if block` reports "Test passed"/"Test failed" without needing a
    player online, which is what makes hundreds of cheap probes possible.
    """
    return "Test passed" in rcon.run(f"execute if block {x} {y} {z} {spec}")


def biome_at(rcon, x, y, z, candidates):
    for b in candidates:
        if "Test passed" in rcon.run(f"execute if biome {x} {y} {z} {b}"):
            return b
    return None


def surface_y(rcon, x, z, hi=200, lo=-64):
    """Highest non-air block in a column, by binary search.

    THIS REPLACES A FALLING ARMOR STAND that cost up to fifteen SECONDS per
    column. Siting now scores 25 columns per candidate across many candidates;
    at 15s each that is hours per world and eight worlds to do. Binary search is
    ~9 RCON round trips, a few milliseconds.

    It assumes air above and solid below. That is false inside caves and under
    overhangs -- which are exactly the sites this search exists to reject, and
    they are caught by the slope and canopy tests below.
    """
    if not matches(rcon, x, hi, z, "minecraft:air"):
        return hi                                   # column is full to the ceiling
    while hi - lo > 1:
        mid = (hi + lo) // 2
        if matches(rcon, x, mid, z, "minecraft:air"):
            hi = mid
        else:
            lo = mid
    return lo


def column(rcon, x, z):
    """(y, kind) for the top of a column: solid | water | canopy | void."""
    y = surface_y(rcon, x, z)
    if y <= -63:
        return y, "void"
    if matches(rcon, x, y, z, "minecraft:water") or matches(rcon, x, y, z, "minecraft:ice"):
        return y, "water"
    if matches(rcon, x, y, z, "#minecraft:leaves") or matches(rcon, x, y, z, "#minecraft:logs"):
        return y, "canopy"
    return y, "solid"


def _forceload(rcon, cx, cz, pad=40, on=True):
    """Probes read air in an unloaded chunk, which would score every distant
    candidate as a perfect flat plain. The old single-column probe forceloaded
    for the same reason."""
    verb = "add" if on else "remove"
    rcon.run(f"forceload {verb} {cx - pad} {cz - pad} {cx + pad} {cz + pad}")


def score_site(rcon, cx, cz):
    """Score a candidate centre, or say why it is unusable.

    Returns {ok, reason, y, stats}. Every rejection names itself so the manifest
    can record what the search rejected and why -- a siting decision that cannot
    be audited is one nobody can reproduce.
    """
    stats = {"wet": 0, "canopy": 0, "sampled": 0, "ys": []}
    _forceload(rcon, cx, cz, on=True)
    try:
        return _score_loaded(rcon, cx, cz, stats)
    finally:
        # Leaving hundreds of chunks forceloaded would keep every rejected
        # candidate ticking for the life of the server.
        _forceload(rcon, cx, cz, on=False)


def _score_loaded(rcon, cx, cz, stats):
    centre_y, centre_kind = column(rcon, cx, cz)
    if centre_kind != "solid":
        return {"ok": False, "reason": f"centre is {centre_kind}", "y": centre_y, "stats": stats}

    for dx, dz in SAMPLE_OFFSETS:
        y, kind = column(rcon, cx + dx, cz + dz)
        stats["sampled"] += 1
        stats["ys"].append(y)
        if kind == "water":
            stats["wet"] += 1
            # Water anywhere inside the platform footprint is disqualifying: the
            # town is stamped there and a chest half in a lake is the failure the
            # original probe was written to catch.
            if abs(dx) <= PLATFORM_HALF and abs(dz) <= PLATFORM_HALF:
                return {"ok": False, "reason": f"water inside the platform at {dx},{dz}",
                        "y": centre_y, "stats": stats}
        elif kind == "canopy":
            stats["canopy"] += 1
        elif kind == "void":
            return {"ok": False, "reason": f"void column at {dx},{dz}", "y": centre_y, "stats": stats}

    canopy_frac = stats["canopy"] / max(1, stats["sampled"])
    stats["canopy_fraction"] = round(canopy_frac, 3)
    if canopy_frac > MAX_CANOPY_FRACTION:
        return {"ok": False,
                "reason": f"{canopy_frac:.0%} of columns are canopy, so the surface "
                          f"readings are treetops",
                "y": centre_y, "stats": stats}

    wet_frac = stats["wet"] / max(1, stats["sampled"])
    stats["wet_fraction"] = round(wet_frac, 3)
    if wet_frac > MAX_WET_FRACTION:
        return {"ok": False, "reason": f"{wet_frac:.0%} of columns within 32 are water",
                "y": centre_y, "stats": stats}

    near = [y for (dx, dz), y in zip(SAMPLE_OFFSETS, stats["ys"])
            if abs(dx) <= PLATFORM_HALF and abs(dz) <= PLATFORM_HALF]
    relief = max(near) - min(near)
    stats["platform_relief"] = relief
    if relief > MAX_PLATFORM_SLOPE:
        return {"ok": False, "reason": f"platform relief {relief} > {MAX_PLATFORM_SLOPE}",
                "y": centre_y, "stats": stats}

    # WALKABILITY, not just dryness. A dry knoll ringed by cliffs or sea strands
    # every bot that leaves it, which is the entrapment this whole search is for.
    for dx, dz in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        prev = centre_y
        for step in range(8, 33, 8):
            y, kind = column(rcon, cx + dx * step, cz + dz * step)
            if kind == "water":
                return {"ok": False, "reason": f"route {dx},{dz} hits water at {step} blocks",
                        "y": centre_y, "stats": stats}
            # A TREE IS NOT A CLIFF. The probe returns the treetop, so comparing
            # a canopy column against ground reads every forest edge as a
            # fourteen-block drop and rejects perfectly walkable land.
            if kind == "canopy":
                continue
            if prev - y > MAX_ROUTE_DROP:
                return {"ok": False, "reason": f"route {dx},{dz} drops {prev - y} at {step} blocks",
                        "y": centre_y, "stats": stats}
            prev = y

    stats["y_spread"] = max(stats["ys"]) - min(stats["ys"])
    return {"ok": True, "reason": "ok", "y": centre_y, "stats": stats}


def find_site(rcon, x0, z0, step=96, rings=5, verbose=True):
    """Deterministic outward spiral from (x0,z0) until a site scores.

    DETERMINISTIC IS THE POINT. All eight worlds share one seed, so the same
    search from the same origin lands on the same town in every world -- which is
    what makes the arms comparable. A search that depended on chance or on probe
    ordering would put a different town in each world and quietly make terrain an
    arm effect.
    """
    tried = []
    for ring in range(rings + 1):
        pts = [(0, 0)] if ring == 0 else _ring(ring * step, n=8 * ring)
        for dx, dz in pts:
            cx, cz = x0 + dx, z0 + dz
            r = score_site(rcon, cx, cz)
            tried.append({"x": cx, "z": cz, "ok": r["ok"], "reason": r["reason"]})
            if verbose:
                print(f"   {'OK ' if r['ok'] else '   '} {cx:>6},{cz:>6}  {r['reason']}")
            if r["ok"]:
                return cx, cz, r, tried
    raise SystemExit(f"no usable town site within {rings * step} blocks of {x0},{z0} -- "
                     f"tried {len(tried)} candidates; widen --rings or move --x/--z")


def town_plan(x, y, z):
    """The town, relative to the probed surface. One list, four worlds."""
    cmds = []
    # A flat stone platform. Terrain-independent footing means the bots' walk
    # home ends the same way in every world even where the ground differs.
    cmds.append(f"fill {x-6} {y-1} {z-6} {x+6} {y-1} {z+6} minecraft:stone_bricks")
    cmds.append(f"fill {x-6} {y} {z-6} {x+6} {y+3} {z+6} minecraft:air")

    # Deposit chests, at home centre.
    cmds.append(f"setblock {x} {y} {z} minecraft:chest")
    cmds.append(f"setblock {x+1} {y} {z} minecraft:chest")

    # Beds. Five per arm, one per bot, spaced so two bots never contend.
    for i in range(5):
        cmds.append(f"setblock {x-4+i*2} {y} {z+4} minecraft:red_bed[part=foot,facing=north]")
        cmds.append(f"setblock {x-4+i*2} {y} {z+3} minecraft:red_bed[part=head,facing=north]")

    # Torch perimeter. Mob spawning inside the town is a death source that has
    # nothing to do with memory, and it would land unevenly across arms.
    for d in range(-6, 7, 2):
        for cx, cz in ((x+d, z-6), (x+d, z+6), (x-6, z+d), (x+6, z+d)):
            cmds.append(f"setblock {cx} {y} {cz} minecraft:torch")

    # THE LECTERN -- the board. Its position becomes BOARD_X/Y/Z, and the
    # proximity gate in board-visit.mjs measures from exactly here.
    bx, by, bz = x + 3, y, z
    cmds.append(f"setblock {bx} {by} {bz} minecraft:lectern")

    # A stocked torch chest, so "no torches" is never the reason an arm's bots
    # die more than another's.
    cmds.append(f"setblock {x-1} {y} {z} minecraft:chest")
    cmds.append(f'item replace block {x-1} {y} {z} container.0 with minecraft:torch 64')
    cmds.append(f'item replace block {x-1} {y} {z} container.1 with minecraft:torch 64')

    cmds.append(f"setworldspawn {x} {y+1} {z}")
    cmds.append(f"forceload add {x} {z}")        # town stays loaded; bots respawn into it
    return cmds, (bx, by, bz)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("arm", choices=sorted(ARMS))
    ap.add_argument("--x", type=int, default=0)
    ap.add_argument("--z", type=int, default=0)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--step", type=int, default=96,
                    help="blocks between candidate centres in the spiral")
    ap.add_argument("--rings", type=int, default=5,
                    help="how far out to search before giving up")
    a = ap.parse_args()

    props = ROOT / a.arm / "server.properties"
    if not props.exists():
        raise SystemExit(f"{props} not found -- run provision-block2.sh first")
    conf = dict(l.split("=", 1) for l in props.read_text().splitlines()
                if "=" in l and not l.startswith("#"))
    port = int(conf.get("rcon.port", BASE_RCON + ARMS[a.arm]))

    rcon = Rcon("127.0.0.1", port, conf["rcon.password"].strip())
    print(f"  searching outward from {a.x},{a.z} for a dry, walkable, level site")
    cx, cz, site, tried = find_site(rcon, a.x, a.z, step=a.step, rings=a.rings)
    y = site["y"]
    st = site["stats"]
    print(f"  chose {cx},{cz} at y={y}: relief {st.get('platform_relief')}, "
          f"{st.get('wet_fraction', 0):.0%} wet within 32, "
          f"rejected {sum(1 for c in tried if not c['ok'])} candidate(s)")
    # The town is forceloaded for good: bots walk home to it, and a home that
    # unloads is a home the deposit walk cannot finish at.
    _forceload(rcon, cx, cz, pad=16, on=True)

    cmds, (bx, by, bz) = town_plan(cx, y, cz)
    for c in cmds:
        if a.dry_run:
            print("   would:", c)
            continue
        out = rcon.run(c)
        # Minecraft reports failure in prose with a 200 OK, so the only way to
        # know a block was not placed is to read what it said.
        if re.search(r"error|failed|Unknown|cannot|expected", out, re.I):
            print(f"   !! {c}\n      -> {out}", file=sys.stderr)

    print(json.dumps({"arm": a.arm, "home": [cx, y + 1, cz],
                      "board": [bx, by, bz], "rcon_port": port,
                      # The siting decision, recorded so it can be audited and
                      # reproduced. Terrain differences between arms would be a
                      # confound; this is the evidence that there are none.
                      "siting": {"requested": [a.x, a.z], "chosen": [cx, cz],
                                 "stats": site["stats"],
                                 "rejected": [c for c in tried if not c["ok"]]},
                      # the game port, so generate-roster.py needs no second
                      # source of truth for which world this arm is
                      "port": int(conf["server-port"])}, indent=2))
    print(f"\n  env for this arm:\n    HOME_X={cx} HOME_Y={y+1} HOME_Z={cz}"
          f"\n    BOARD_X={bx} BOARD_Y={by} BOARD_Z={bz} BOARD_RADIUS=8")


if __name__ == "__main__":
    main()
