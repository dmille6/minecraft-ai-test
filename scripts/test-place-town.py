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

    def __init__(self, terrain):
        self.terrain = terrain
        self.forceloads = 0

    def run(self, cmd):
        p = cmd.split()
        if p[0] == "forceload":
            self.forceloads += 1
            return "ok"
        if p[:3] == ["execute", "if", "block"]:
            x, y, z, want = int(p[3]), int(p[4]), int(p[5]), p[6]
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

print(f"\n  {P} passed, {F} failed")
sys.exit(1 if F else 0)
