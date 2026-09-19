#!/usr/bin/env python3
"""Site quality is a score with a recorded tier, not a gate that silently drops seeds."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'lib'))
from sitetier import site_tier, TIERS, UNPLACEABLE

# The real numbers place-town.py recorded for placebo-a on 2026-09-19, the site
# it accepted after rejecting 47 candidates.
PLACEBO_A = dict(wet_fraction=0.0, canopy_fraction=0.2, platform_relief=3,
                 terrain_spread=9, max_route_drop=0, wood_hits=3,
                 platform_water=False, void_in_platform=False)
T = []
def t(name, got, want):
    ok = got == want; T.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {name}")
    if not ok: print(f"        got {got!r}  want {want!r}")

i, name, failed = site_tier(PLACEBO_A)
t("the real placebo-a site is tier 0", (i, name), (0, "standard"))
t("...and nothing is listed as failing", failed, [])

# Every rejection reason from the two live searches must now yield a TIER,
# not a refusal. These are the reasons the logs actually printed.
for label, patch, least in [
    ("36% canopy ('surface readings are treetops')", dict(canopy_fraction=0.36), 1),
    ("40% canopy",                                   dict(canopy_fraction=0.40), 1),
    ("8% wet within 32",                             dict(wet_fraction=0.08), 1),
    ("20% wet within 32",                            dict(wet_fraction=0.20), 1),
    ("24% wet within 32",                            dict(wet_fraction=0.24), 1),
    ("platform relief 5",                            dict(platform_relief=5), 1),
    ("platform relief 7",                            dict(platform_relief=7), 2),
    ("platform relief 33",                           dict(platform_relief=33), 3),
    ("platform relief 43",                           dict(platform_relief=43), 3),
    ("route drops 12",                               dict(max_route_drop=12), 2),
    ("only 1/24 columns are tree",                   dict(wood_hits=1), 1),
    ("zero trees",                                   dict(wood_hits=0), 2),
    ("water inside the platform (the fill overwrites it)", dict(platform_water=True), 2),
]:
    i, nm, failed = site_tier({**PLACEBO_A, **patch})
    t(f"{label} -> tier {least} ({TIERS[least][0]}), not a rejection", i, least)
    T.append(bool(failed)); print(f"{'PASS' if failed else 'FAIL'}  ...and it still says why: {failed}")

# The one thing that IS unplaceable
i, nm, failed = site_tier({**PLACEBO_A, "void_in_platform": True})
t("a void footprint is the ONLY unplaceable case", (i, nm), (None, None))
t("...and it names itself", failed, [UNPLACEABLE])

# Fail closed on missing measurements
i, nm, failed = site_tier({})
t("a site with no measurements at all lands on the floor, not tier 0", i, len(TIERS) - 1)
t("...and says everything failed", sorted(failed), sorted(
    ["wet", "canopy", "relief", "route_drop", "spread", "wood", "platform_water"]))

# A terrible-but-placeable site must still get a town
awful = dict(wet_fraction=0.9, canopy_fraction=0.95, platform_relief=60,
             terrain_spread=80, max_route_drop=40, wood_hits=0,
             platform_water=True, void_in_platform=False)
i, nm, failed = site_tier(awful)
t("the worst placeable site still yields a town, at the floor", nm, "floor")

# The fallback past the floor. Unreachable with real terrain, which is exactly
# why it needs a case: a surviving mutant turned it into a REJECTION, and a
# site that exceeds even the floor is still placeable -- the stamp fills a flat
# platform whatever the ground did before.
absurd = dict(wet_fraction=0.5, canopy_fraction=0.5, platform_relief=10_000,
              terrain_spread=10_000, max_route_drop=10_000, wood_hits=0,
              platform_water=True, void_in_platform=False)
i, nm, failed = site_tier(absurd)
t("a site past every tier bound still gets a town at the floor", nm, "floor")
t("...and is not reported unplaceable", i is None, False)

# monotonicity: relaxing an input can never make the tier stricter
prev = 0
for relief in (3, 4, 6, 7, 12, 13, 99):
    i, _, _ = site_tier({**PLACEBO_A, "platform_relief": relief})
    T.append(i >= prev); prev = i
print(f"{'PASS' if prev >= 0 else 'FAIL'}  tiers are monotonic in relief")

print(f"\n{sum(T)}/{len(T)} passed")
sys.exit(0 if all(T) else 1)
