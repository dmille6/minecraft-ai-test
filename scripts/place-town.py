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

# A PROBE THAT CAN ANSWER "I DON'T KNOW" MAY NOT BE TYPED AS A BOOLEAN.
#
# `matches()` below used to be `"Test passed" in rcon.run(...)`. An unloaded
# chunk answers neither sentence -- it answers "That position is not loaded" --
# so it collapsed to False, which reads as "this block is not water". See
# lib/probe.py for the six-in-one-day version of this mistake. The import is
# safe here despite the vendored Rcon above: deploy-harness.sh clones the whole
# repository, so scripts/lib travels with scripts/.
sys.path.insert(0, str(Path(__file__).resolve().parent / "lib"))
from probe import Survey, classify_execute_if, UnknownWorldState   # noqa: E402

ROOT = Path("/srv/block2")
# EIGHT WORLDS, in provision-block2.sh's order -- the index is what maps an arm
# to its port, so the two files must agree or a town is stamped into the wrong
# world. This map was still the pre-amendment four when the build moved to two
# pools per arm.
# SAME ORDER AS provision-block2.sh, and the first eight indices are frozen.
# The index IS the port offset, so appending is safe and reordering silently
# repoints every probe at a different world.
ARMS = {w: i for i, w in enumerate([
    "hive-a", "hive-b", "board-a", "board-b",
    "isolated-a", "isolated-b", "placebo-a", "placebo-b",
    "hive-c", "hive-d", "board-c", "board-d",
    "isolated-c", "isolated-d", "placebo-c", "placebo-d",
])}
BASE_RCON = 25670


class Rcon:
    """Minimal RCON client. Vendored deliberately: the shared helper has lived
    in /tmp on at least one host, and /tmp does not survive a reboot."""

    # 120s, NOT 10. Siting forceloads a region derived from the probe radii --
    # 104 blocks now that the pad covers the wood rings at 80 -- which is about
    # 169 chunks generated on the SERVER THREAD. Paper cannot answer RCON while
    # it does that, so a ten-second timeout gave a socket timeout on eight
    # freshly-created worlds in a row, which reads exactly like RCON being
    # misconfigured and is nothing of the sort. The generation is the work; the
    # client just has to be willing to wait for it.
    def __init__(self, host, port, password, timeout=120):
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
# WIDE-AREA ROUGHNESS, which is the criterion whose absence cost the third
# rebuild. platform_relief only measures the 13x13 footprint the town is stamped
# on, so a flat shelf on a mountainside scores 2 and passes. The town that did
# exactly that sat at y=119 with the surrounding terrain spread over 14 blocks,
# and 86% of 15,175 path events in one hour were the pathfinder's own stuck
# detector: the bots planned routes they could not walk.
#
# Gate the ground the bots actually travel over, not just the ground the chest
# stands on.
MAX_TERRAIN_SPREAD = 10
# Canopy is not merely inconvenient: the surface probe returns the TREETOP, so
# every slope and route reading taken through a forest is measuring the wrong
# surface. Past this fraction the site's terrain numbers cannot be trusted.
MAX_CANOPY_FRACTION = 0.35

# WOOD MUST BE REACHABLE, and this is the criterion whose absence made the first
# eight worlds unusable.
#
# Rejecting water, rejecting canopy and rejecting relief all push the search
# toward flat dry treeless ground -- and the entire tech tree starts at oak_log.
# The first site scored perfectly (0% wet, relief 2) and had ZERO trees within
# 288 blocks. Forty bots produced 57 craft attempts, every one of them
# `missing_ingredients: gather oak_log first`, and not one bot ever held wood.
#
# So canopy is a BAND, not a ceiling: too much and the terrain probe is reading
# treetops, too little and the fleet cannot bootstrap. The town stays clear; the
# surroundings must not be.
WOOD_RINGS = (48, 80)      # far enough to be outside the platform, near enough to walk
WOOD_SAMPLES = 12          # per ring
MIN_WOOD_HITS = 3          # of 24 sampled columns, at least this many must be tree


def wood_nearby(rcon, cx, cz):
    """How many sampled columns within walking distance are trees.

    THIS PROBES OUTSIDE THE FORCELOADED PAD, which is why it now carries a
    survey with controls. score_site() forceloads `pad` blocks around the
    candidate; the wood rings are at 48 and 80. Before the tri-state, every
    probe out there against an unloaded chunk answered "not loaded", collapsed
    to False, and the criterion that exists specifically because a site with
    ZERO trees within 288 blocks passed siting once already would have counted
    zero hits and blamed the terrain. _forceload's pad is derived from
    WOOD_RINGS now (see score_site) so the reads are real, and the survey is
    what proves they were: it refuses to report unless a column known to be
    tree came back tree and one known to be sky came back not-tree.
    """
    survey = Survey(f"wood within {WOOD_RINGS[-1]}b of {cx},{cz}")
    hits, sampled, confirmed = 0, 0, None
    for r in WOOD_RINGS:
        for dx, dz in _ring(r, n=WOOD_SAMPLES):
            sampled += 1
            y = surface_y(rcon, cx + dx, cz + dz)
            wood = None
            for spec in ("#minecraft:logs", "#minecraft:leaves"):
                pr = survey.record(matches(rcon, cx + dx, y, cz + dz, spec))
                if pr.require(f"{spec} at {cx + dx},{y},{cz + dz}"):
                    wood = pr
                    break
            if wood is not None:
                hits += 1
                if confirmed is None:
                    confirmed = wood

    # CONTROLS, so that a zero is a finding rather than a shrug. Air forty
    # blocks above the surface is not a log in any world; an instrument that
    # cannot say so has not earned the right to report "no trees here", which is
    # the criterion that eight unusable worlds turned on. The positive control
    # is a column this run already read as wood -- a real read, not a second
    # round trip -- so it can only be offered when something was found. A run
    # that found nothing prints its denominators and says the positive control
    # is missing, which is the honest shape of that result.
    sky_y = surface_y(rcon, cx, cz) + 40
    survey.control("sky above the centre is not a log",
                   matches(rcon, cx, sky_y, cz, "#minecraft:logs"), "no")
    if confirmed is not None:
        survey.control("a column counted as wood reads as wood", confirmed, "yes")
    print(survey.report(strict=confirmed is not None), file=sys.stderr)
    return hits, sampled


def matches(rcon, x, y, z, spec):
    """yes | no | unknown for "the block at x,y,z matches this id or #tag".

    `execute if block` reports "Test passed"/"Test failed" without needing a
    player online, which is what makes hundreds of cheap probes possible. It
    reports NEITHER for a position in an unloaded chunk, and that third answer
    is the one that matters: this function used to fold it into False and hand
    back a confident "not water" about terrain it had never seen.

    The returned Probe raises if used as a boolean, so every caller has to say
    what it wants unknown to mean. That is the entire mechanism.
    """
    return classify_execute_if(rcon.run(f"execute if block {x} {y} {z} {spec}"))


def biome_at(rcon, x, y, z, candidates):
    """The first candidate biome that matches, or None if none of them do.

    An unknown here is fatal rather than "none of the above": returning None
    from an unloaded column would record the site as having no biome, which is
    not a thing any position in the overworld actually is.
    """
    for b in candidates:
        if classify_execute_if(
                rcon.run(f"execute if biome {x} {y} {z} {b}")).require(f"biome {b} at {x},{y},{z}"):
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
    # UNKNOWN IS FATAL IN HERE, and this is the call site that proves why the
    # tri-state is worth the noise. A binary search does not return "I could not
    # tell"; it returns a NUMBER, and every caller believes numbers. Against an
    # unloaded column the old boolean read every probe as "not air", took the
    # early return, and reported a ground level of 200 -- which then scored the
    # candidate, chose the town site, and left no trace of having guessed.
    def air(y):
        return matches(rcon, x, y, z, "minecraft:air").require(f"air at {x},{y},{z}")

    if not air(hi):
        return hi                                   # column is full to the ceiling
    while hi - lo > 1:
        mid = (hi + lo) // 2
        if air(mid):
            hi = mid
        else:
            lo = mid
    return lo


def column(rcon, x, z):
    """(y, kind) for the top of a column: solid | water | canopy | void."""
    y = surface_y(rcon, x, z)
    if y <= -63:
        return y, "void"
    # `solid` is this function's fallthrough, so an unknown that folded into
    # "no" would silently become "solid ground" -- the single most permissive
    # answer available, handed out about a column nobody looked at.
    def is_(spec):
        return matches(rcon, x, y, z, spec).require(f"{spec} at {x},{y},{z}")

    if is_("minecraft:water") or is_("minecraft:ice"):
        return y, "water"
    if is_("#minecraft:leaves") or is_("#minecraft:logs"):
        return y, "canopy"
    return y, "solid"


# THE PAD MUST COVER EVERYTHING THAT GETS PROBED, and for a long time it did
# not: it was 40 while WOOD_RINGS reach 80, so all 24 wood samples read chunks
# the server had not loaded. The old boolean probe turned every one of those
# into "not a tree" without a word, so the wood criterion -- added precisely
# because a treeless site had already passed siting once -- was scoring terrain
# it had never seen. Derived from the constants now, so moving a ring moves the
# pad with it, and the tri-state above makes a shortfall raise instead of
# quietly answering no.
_PAD = max(32, max(WOOD_RINGS), max(abs(d) for o in SAMPLE_OFFSETS for d in o)) + 24


def _forceload(rcon, cx, cz, pad=_PAD, on=True, settle=True):
    """Load (and if necessary GENERATE) the chunks a candidate will be probed in.

    Probes read air in an unloaded chunk, which would score every distant
    candidate as a perfect flat plain.

    THE WAIT IS NOT OPTIONAL. `forceload add` returns as soon as the request is
    queued; generation happens asynchronously on the server thread. Probing
    immediately reads terrain that does not exist yet, and the answer depends on
    how busy that world happened to be -- which is how eight worlds built from
    ONE seed produced two different town sites, one of them on a mountain at
    y=119. A deterministic search over non-deterministic reads is not
    deterministic.
    """
    verb = "add" if on else "remove"
    rcon.run(f"forceload {verb} {cx - pad} {cz - pad} {cx + pad} {cz + pad}")
    if not on or not settle:
        return
    # Wait until the centre column reads the same surface twice running. Two
    # agreeing reads mean generation has finished and settled; a timeout means
    # the caller gets whatever it gets, but at least it waited.
    prev, stable = None, 0
    for _ in range(40):                     # up to ~10s per candidate
        time.sleep(0.25)
        y = surface_y(rcon, cx, cz)
        if y == prev:
            stable += 1
            if stable >= 2:
                return
        else:
            stable = 0
        prev = y


def score_site(rcon, cx, cz):
    """Score a candidate centre, or say why it is unusable.

    Returns {ok, reason, y, stats}. Every rejection names itself so the manifest
    can record what the search rejected and why -- a siting decision that cannot
    be audited is one nobody can reproduce.
    """
    stats = {"wet": 0, "canopy": 0, "sampled": 0, "ys": [], "kinds": []}
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
        stats["kinds"].append(kind)
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

    near = [y for (dx, dz), y, k in zip(SAMPLE_OFFSETS, stats["ys"], stats["kinds"])
            if abs(dx) <= PLATFORM_HALF and abs(dz) <= PLATFORM_HALF and k == "solid"]
    near = near or [centre_y]
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

    # LAST, because it is the most expensive check and the cheap rejections above
    # eliminate most candidates before it runs.
    wood, wood_n = wood_nearby(rcon, cx, cz)
    stats["wood_hits"], stats["wood_sampled"] = wood, wood_n
    if wood < MIN_WOOD_HITS:
        return {"ok": False,
                "reason": f"only {wood}/{wood_n} columns within {WOOD_RINGS[-1]} blocks are "
                          f"tree; the tech tree starts at oak_log",
                "y": centre_y, "stats": stats}

    # A TREE IS NOT A HILL -- the same mistake the route check already makes once.
    # The probe returns the TREETOP, so a flat wooded plain would show a spread
    # made entirely of canopy and be rejected as unwalkable ground.
    ground = [y for y, k in zip(stats["ys"], stats["kinds"]) if k == "solid"]
    stats["y_spread"] = (max(ground) - min(ground)) if ground else 0
    if stats["y_spread"] > MAX_TERRAIN_SPREAD:
        return {"ok": False,
                "reason": f"terrain spread {stats['y_spread']} over the sampled radius "
                          f"> {MAX_TERRAIN_SPREAD}; bots cannot walk what they can plan",
                "y": centre_y, "stats": stats}
    stats.pop("kinds", None)
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


# PINNED, NOT DEFAULTED. Every one of these is identical in all eight worlds.
# A gamerule left at its default is a value that can differ between two worlds
# created minutes apart under different server states, and nothing would report
# it. `keepInventory` is the one with teeth: without it a death destroys the
# carried inventory, which is the very quantity the retained-items endpoint
# measures, and death rates are not guaranteed equal across arms.
GAMERULES = {
    "keepInventory": "true",
    "doDaylightCycle": "true",
    "doWeatherCycle": "false",     # weather is unmodelled noise the bots cannot see
    "doImmediateRespawn": "true",  # a respawn screen is a bot frozen for no reason
    "mobGriefing": "false",
    "doFireTick": "false",
    "randomTickSpeed": "3",        # vanilla default, stated so it cannot drift
    "doInsomnia": "false",
    "announceAdvancements": "false",
    "sendCommandFeedback": "false",
    "logAdminCommands": "false",
}


def world_rules(rcon, cx, cz, radius, cy=64):
    """Gamerules and the world border, applied identically to every world.

    THE BORDER IS CENTRED ON THE TOWN, not on the origin. Siting now searches
    outward for dry, walkable ground, so the town is no longer guaranteed to sit
    at 0,0 -- and a border centred elsewhere would hand each arm a differently
    shaped world with the town off to one side of it.
    """
    out = []
    for rule, value in sorted(GAMERULES.items()):
        out.append(f"gamerule {rule} {value}")
    # BOTS SPAWN AT WORLD SPAWN, NOT AT THE TOWN. With siting free to search
    # outward for wood, the town can land hundreds of blocks from the seed's
    # spawn point -- and every bot would begin its life that far from its chest,
    # its bed and its lectern, walking through unknown terrain to reach the
    # experiment. Move spawn to the town instead.
    out.append(f"setworldspawn {cx} {cy + 1} {cz}")
    out.append(f"worldborder center {cx} {cz}")
    out.append(f"worldborder set {radius * 2}")     # the command takes DIAMETER
    out.append("worldborder warning distance 0")
    out.append("worldborder damage amount 0")       # the border stops bots; it must not kill them
    out.append("time set day")
    out.append("weather clear")
    return out


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
    ap.add_argument("--at", metavar="X,Z",
                    help="stamp at these coordinates instead of searching. Used for worlds "
                         "2..N so all eight get the site the first search found -- and it is "
                         "re-scored here, so a world that disagrees refuses rather than drifts")
    ap.add_argument("--force", action="store_true",
                    help="re-site a world that already has a town (only after wiping it)")
    ap.add_argument("--border", type=int, default=1950,
                    help="world border RADIUS in blocks, centred on the chosen town")
    ap.add_argument("--rings", type=int, default=5,
                    help="how far out to search before giving up")
    a = ap.parse_args()

    props = ROOT / a.arm / "server.properties"
    if not props.exists():
        raise SystemExit(f"{props} not found -- run provision-block2.sh first")
    conf = dict(l.split("=", 1) for l in props.read_text().splitlines()
                if "=" in l and not l.startswith("#"))
    port = int(conf.get("rcon.port", BASE_RCON + ARMS[a.arm]))

    # SITING IS NOT IDEMPOTENT, so it must not be repeatable by accident.
    #
    # Every run STAMPS a town, and a stamped town changes the terrain the scorer
    # reads. Running this three times on one world produced three towns in three
    # different places -- the second search rejected the site the first had built
    # on, and the third rejected both. The worlds stayed identical to each other
    # only because the mistake was made uniformly, which is luck, not design.
    marker = ROOT / a.arm / "TOWN-PLACED.json"
    if marker.exists() and not a.force:
        print(f"  {a.arm} already has a town (see {marker}). Re-running would stamp a\n"
              f"  SECOND one and move the site. Use --force only if the world was wiped.")
        print(marker.read_text())
        return

    rcon = Rcon("127.0.0.1", port, conf["rcon.password"].strip())
    if a.at:
        # SEARCH ONCE, STAMP EIGHT TIMES.
        #
        # All eight worlds share one seed, so they are the same terrain and the
        # answer cannot legitimately differ between them. Searching each one
        # independently ran the race eight times and lost it: two worlds landed
        # on a mountain at y=119 while six took a plain at y=72, because chunk
        # generation is asynchronous and the probes did not always wait.
        # Reusing the coordinates makes identical worlds identical BY
        # CONSTRUCTION rather than by hoping eight searches agree.
        cx, cz = (int(v) for v in a.at.split(","))
        _forceload(rcon, cx, cz, pad=48, on=True)
        site = score_site(rcon, cx, cz)
        tried = [{"x": cx, "z": cz, "ok": site["ok"], "reason": site["reason"]}]
        if not site["ok"]:
            raise SystemExit(f"{a.arm}: the site given by --at scores {site['reason']!r}. "
                             f"Identical seeds must score identically -- refusing to stamp a "
                             f"town somewhere this world says is unusable.")
        print(f"  using the site found for the first world: {cx},{cz}")
        y = site["y"]
    else:
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

    cmds = world_rules(rcon, cx, cz, a.border, cy=y)
    plan, (bx, by, bz) = town_plan(cx, y, cz)
    cmds += plan
    for c in cmds:
        if a.dry_run:
            print("   would:", c)
            continue
        out = rcon.run(c)
        # Minecraft reports failure in prose with a 200 OK, so the only way to
        # know a block was not placed is to read what it said.
        if re.search(r"error|failed|Unknown|cannot|expected", out, re.I):
            print(f"   !! {c}\n      -> {out}", file=sys.stderr)

    payload = json.dumps({"arm": a.arm, "home": [cx, y + 1, cz],
                      "board": [bx, by, bz], "rcon_port": port,
                      # The siting decision, recorded so it can be audited and
                      # reproduced. Terrain differences between arms would be a
                      # confound; this is the evidence that there are none.
                      "gamerules": GAMERULES, "border_radius": a.border,
                      "siting": {"requested": [a.x, a.z], "chosen": [cx, cz],
                                 "stats": site["stats"],
                                 "rejected": [c for c in tried if not c["ok"]]},
                      # the game port, so generate-roster.py needs no second
                      # source of truth for which world this arm is
                      "port": int(conf["server-port"])}, indent=2)
    print(payload)
    # The marker IS the town record: written only after the stamp succeeded, and
    # read on the next run to refuse a second stamp.
    marker.write_text(payload)
    print(f"\n  env for this arm:\n    HOME_X={cx} HOME_Y={y+1} HOME_Z={cz}"
          f"\n    BOARD_X={bx} BOARD_Y={by} BOARD_Z={bz} BOARD_RADIUS=8")


if __name__ == "__main__":
    main()
