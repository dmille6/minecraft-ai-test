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
import argparse, json, re, secrets, socket, struct, sys, time
from pathlib import Path

ROOT = Path("/srv/block2")
ARMS = {"hive": 0, "board": 1, "isolated": 2, "placebo": 3}
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


def surface_y(rcon, x, z):
    """Find the real surface by dropping a marker and reading where it lands.

    Minecraft has no 'highest block at' command over RCON, and guessing is what
    buries the chest. An armor stand falls, so the world reports its own answer.
    """
    rcon.run(f"forceload add {x} {z}")           # it cannot fall in an unloaded chunk
    rcon.run("kill @e[type=armor_stand,tag=probe]")
    rcon.run(f'summon armor_stand {x}.5 250 {z}.5 {{Tags:["probe"],Invisible:1b,Marker:0b}}')
    last = None
    for _ in range(30):                          # ~250 blocks of falling
        time.sleep(0.5)
        pos = rcon.run("data get entity @e[tag=probe,limit=1] Pos")
        m = re.findall(r"(-?\d+\.\d+)d", pos)
        if len(m) != 3:
            break
        y = float(m[1])
        if last is not None and abs(y - last) < 0.01:   # came to rest
            rcon.run("kill @e[type=armor_stand,tag=probe]")
            return int(y)
        last = y
    rcon.run("kill @e[type=armor_stand,tag=probe]")
    raise SystemExit(f"could not find the surface at {x},{z} -- probe never settled "
                     f"(void, or deep water: pick a different town centre)")


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
    a = ap.parse_args()

    props = ROOT / a.arm / "server.properties"
    if not props.exists():
        raise SystemExit(f"{props} not found -- run provision-block2.sh first")
    conf = dict(l.split("=", 1) for l in props.read_text().splitlines()
                if "=" in l and not l.startswith("#"))
    port = int(conf.get("rcon.port", BASE_RCON + ARMS[a.arm]))

    rcon = Rcon("127.0.0.1", port, conf["rcon.password"].strip())
    y = surface_y(rcon, a.x, a.z)
    print(f"  surface at {a.x},{a.z} is y={y}")

    cmds, (bx, by, bz) = town_plan(a.x, y, a.z)
    for c in cmds:
        if a.dry_run:
            print("   would:", c)
            continue
        out = rcon.run(c)
        # Minecraft reports failure in prose with a 200 OK, so the only way to
        # know a block was not placed is to read what it said.
        if re.search(r"error|failed|Unknown|cannot|expected", out, re.I):
            print(f"   !! {c}\n      -> {out}", file=sys.stderr)

    print(json.dumps({"arm": a.arm, "home": [a.x, y + 1, a.z],
                      "board": [bx, by, bz], "rcon_port": port,
                      # the game port, so generate-roster.py needs no second
                      # source of truth for which world this arm is
                      "port": int(conf["server-port"])}, indent=2))
    print(f"\n  env for this arm:\n    HOME_X={a.x} HOME_Y={y+1} HOME_Z={a.z}"
          f"\n    BOARD_X={bx} BOARD_Y={by} BOARD_Z={bz} BOARD_RADIUS=8")


if __name__ == "__main__":
    main()
