#!/usr/bin/env python3
"""Siting is load-bearing, so it gets tested against simulated terrain.

Drowning was a THIRD of every event the fleet logged over 24 hours -- 21,442 of
them. The siting test at the time was "is the centre block void or deep water":
one column, no radius, no walkability. A town on a dry spit in the middle of a
lake passes that test and then drowns the arm.

The world here is just a function, so a terrain shape can be asserted without a
Minecraft server.

    ./test-place-town.py
"""
import sys, importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("pt", Path(__file__).parent / "place-town.py")
pt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pt)

P = F = 0


def t(name, fn):
    global P, F
    try:
        fn()
        P += 1
        print(f"  PASS  {name}")
    except AssertionError as e:
        F += 1
        print(f"  FAIL  {name}\n        {e}")


class FakeRcon:
    """terrain(x, z) -> (surface_y, kind); kind in solid|water|canopy."""

    def __init__(self, terrain, loaded=None):
        self.terrain = terrain
        self.forceloads = 0
        self.forceloaded = None      # (x0, z0, x1, z1) of the live forceload
        # AN UNLOADED CHUNK IS A THIRD ANSWER, and until this fixture existed
        # the fake could not produce it -- so the suite could not have caught
        # the bug it was written to guard. `loaded(x, z)` returning False makes
        # the server answer the sentence it really answers.
        self.loaded = loaded

    def _is_loaded(self, x, z):
        if self.forceloaded:
            x0, z0, x1, z1 = self.forceloaded
            if x0 <= x <= x1 and z0 <= z <= z1:
                return True
        return True if self.loaded is None else self.loaded(x, z)

    def run(self, cmd):
        p = cmd.split()
        if p[0] == "forceload":
            self.forceloads += 1
            if p[1] == "add":
                self.forceloaded = (int(p[2]), int(p[3]), int(p[4]), int(p[5]))
            else:
                self.forceloaded = None
            return "ok"
        if p[:3] == ["execute", "if", "block"]:
            x, y, z, want = int(p[3]), int(p[4]), int(p[5]), p[6]
            if not self._is_loaded(x, z):
                return "That position is not loaded"
            sy, kind = self.terrain(x, z)
            if want == "minecraft:air":
                return "Test passed" if y > sy else "Test failed"
            if y != sy:
                return "Test failed"
            m = {"minecraft:water": "water", "minecraft:ice": "water",
                 "#minecraft:leaves": "canopy", "#minecraft:logs": "canopy"}.get(want)
            return "Test passed" if m and m == kind else "Test failed"
        return ""


def ok(r):
    assert r["ok"], f"expected acceptance, rejected for: {r['reason']}"


def bad(r, frag):
    assert not r["ok"], "expected rejection, but the site was accepted"
    assert frag in r["reason"], f"rejected for {r['reason']!r}, expected {frag!r}"


# ------------------------------------------------------------- terrains ----
def _wooded(base, cx=0, cz=0):
    """Ring the candidate with trees so fixtures satisfy the oak_log criterion.

    Parameterised by the candidate because wood_nearby() samples rings around it:
    a pattern keyed to the origin passes or fails depending on where the spiral
    happened to look. Trees sit BETWEEN the town checks (radius <= 32) and the
    outer wood rings (48 and 80), so the site stays clear and the wood is
    reachable -- which is exactly the band the real criterion encodes.
    """
    import math

    def f(x, z):
        d = math.hypot(x - cx, z - cz)
        if 40 < d < 95:
            return (base(x, z)[0] + 6, "canopy")
        return base(x, z)
    return f

_flat   = lambda x, z: (64, "solid")
flat    = _wooded(_flat)
ocean   = lambda x, z: (62, "water")
# A dry 20-block island in open water -- the exact shape the old test passed.
spit    = _wooded(lambda x, z: (64, "solid") if abs(x) <= 10 and abs(z) <= 10 else (62, "water"))
# Dry everywhere, but the ground falls away past the platform.
cliffed = _wooded(lambda x, z: (64, "solid") if max(abs(x), abs(z)) <= 10 else (40, "solid"))
lumpy   = _wooded(lambda x, z: (64 + (abs(x) % 9), "solid"))
# Clear platform, dense forest beyond it: the probe reads treetops out there.
forest  = lambda x, z: (64, "solid") if max(abs(x), abs(z)) <= 6 else (78, "canopy")
# A few scattered trees -- counted, but not enough to distrust the terrain.
sparse  = _wooded(lambda x, z: (78, "canopy") if (x == 16 and z == 0) else (64, "solid"))
# the spiral lands at 96,0 on this fixture, so its wood ring is centred there
sea_then_land = _wooded(lambda x, z: (64, "solid") if x >= 90 else (62, "water"), cx=96, cz=0)

# ---------------------------------------------------------------- tests ----
t("flat dry ground is accepted",
  lambda: ok(pt.score_site(FakeRcon(flat), 0, 0)))

t("open ocean is rejected at the centre",
  lambda: bad(pt.score_site(FakeRcon(ocean), 0, 0), "centre is water"))

t("A DRY SPIT IN A LAKE IS REJECTED -- the case one column could never catch",
  lambda: bad(pt.score_site(FakeRcon(spit), 0, 0), "water"))

t("dry ground ringed by cliffs is rejected -- dryness is not walkability",
  lambda: bad(pt.score_site(FakeRcon(cliffed), 0, 0), "drops"))

t("ground too uneven for the platform is rejected",
  lambda: bad(pt.score_site(FakeRcon(lumpy), 0, 0), "relief"))


def canopy_rejected():
    r = pt.score_site(FakeRcon(forest), 0, 0)
    bad(r, "canopy")
    assert r["stats"]["canopy"] > 0, "canopy columns must be counted, not read as ground"


def sparse_canopy_ok():
    r = pt.score_site(FakeRcon(sparse), 0, 0)
    ok(r)
    assert r["stats"]["canopy"] == 1, "a lone tree must be recorded but not disqualifying"


t("dense canopy is rejected -- the probe would be reading treetops", canopy_rejected)
t("a few scattered trees are counted but accepted", sparse_canopy_ok)


def forceload_released():
    r = FakeRcon(flat)   # FakeRcon answers instantly, so the settle loop exits at once
    pt.score_site(r, 0, 0)
    assert r.forceloads >= 2, f"expected an add and a remove, saw {r.forceloads}"


t("candidate chunks are forceloaded, then released", forceload_released)


def spiral_finds_land():
    cx, cz, site, tried = pt.find_site(FakeRcon(sea_then_land), 0, 0, step=96, rings=2, verbose=False)
    assert site["ok"]
    assert cx >= 90, f"landed at {cx},{cz} -- still in the sea"
    assert any(not c["ok"] for c in tried), "must record what it rejected"


t("the spiral finds dry land when the origin is under water", spiral_finds_land)


def deterministic():
    a = pt.find_site(FakeRcon(sea_then_land), 0, 0, step=96, rings=2, verbose=False)[:2]
    b = pt.find_site(FakeRcon(sea_then_land), 0, 0, step=96, rings=2, verbose=False)[:2]
    assert a == b, f"two runs chose {a} and {b}; terrain would become an arm effect"


t("the search is DETERMINISTIC -- one seed must give all eight worlds one town", deterministic)


def refuses_to_site_in_the_sea():
    try:
        pt.find_site(FakeRcon(ocean), 0, 0, step=96, rings=1, verbose=False)
    except SystemExit:
        return
    raise AssertionError("sited a town in the middle of an ocean instead of failing")


t("all-water within the radius fails loudly rather than siting anyway", refuses_to_site_in_the_sea)

def treeless_rejected():
    bad(pt.score_site(FakeRcon(_flat), 0, 0), "oak_log")


t("PERFECT FLAT DRY GROUND WITH NO TREES IS REJECTED -- the tech tree starts at wood",
  treeless_rejected)

def rough_terrain_rejected():
    # a flat 13x13 shelf on a mountainside: platform_relief passes, the ground
    # the bots must WALK does not
    import math
    def shelf(x, z):
        if max(abs(x), abs(z)) <= 8:
            return (100, "solid")
        return (100 - min(40, int(math.hypot(x, z))), "solid")
    r = pt.score_site(FakeRcon(_wooded(shelf)), 0, 0)
    assert not r["ok"], "a flat shelf on a mountainside must not pass"


t("A FLAT SHELF ON A MOUNTAINSIDE IS REJECTED -- planning a route is not walking it",
  rough_terrain_rejected)

# ------------------------------------------- the unloaded-chunk answer ----
#
# THE BUG THIS FILE COULD NOT HAVE CAUGHT. `matches()` was
# `"Test passed" in rcon.run(...)`, and "That position is not loaded" contains
# neither sentence, so it read as "no" -- meaning "not water", "not a log",
# "not air". A probe outside the loaded region did not fail; it answered
# confidently and wrongly, and nothing downstream could tell.
#
# Two things had to be true for that to bite, and both were: the answer had to
# be collapsible into a boolean, and something had to actually be probed out
# there. WOOD_RINGS reach 80 blocks while _forceload's pad was 40.

def unloaded_reads_as_unknown_not_no():
    r = pt.classify_execute_if("That position is not loaded")
    assert r.is_unknown, f"unloaded chunk classified as {r.status}, not unknown"
    assert not r.is_no, "the sentence must never be read as a negative result"
    try:
        bool(r)
    except Exception as e:
        assert "boolean" in str(e), e
        return
    raise AssertionError("a tri-state probe was usable as a bool")


t("'not loaded' is UNKNOWN, and cannot be used as a bool at all",
  unloaded_reads_as_unknown_not_no)


def wood_rings_are_inside_the_pad():
    # The derived pad, not a number someone remembered to update.
    assert pt._PAD > max(pt.WOOD_RINGS), (
        f"pad {pt._PAD} does not cover wood ring {max(pt.WOOD_RINGS)} — "
        f"every wood sample would probe an unloaded chunk")
    assert pt._PAD > max(abs(d) for o in pt.SAMPLE_OFFSETS for d in o), (
        "pad does not cover the terrain samples")


t("the forceload pad covers EVERYTHING that gets probed", wood_rings_are_inside_the_pad)


def unloaded_terrain_fails_loudly():
    # A world that only exists within 40 blocks of the origin: exactly the shape
    # the old pad produced. Siting must refuse, not score.
    near_only = FakeRcon(flat, loaded=lambda x, z: max(abs(x), abs(z)) <= 40)
    near_only.forceloaded = None
    try:
        pt._score_loaded(near_only, 0, 0,
                         {"wet": 0, "canopy": 0, "sampled": 0, "ys": [], "kinds": []})
    except pt.UnknownWorldState:
        return
    raise AssertionError(
        "scored a site using terrain the server had not loaded — the exact "
        "silent-false this whole change exists to remove")


t("terrain that cannot be read STOPS the siting instead of scoring it",
  unloaded_terrain_fails_loudly)


print(f"\n  {P} passed, {F} failed")
sys.exit(1 if F else 0)
