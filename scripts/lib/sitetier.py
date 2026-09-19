"""
HOW BAD A TOWN SITE IS, on a scale, instead of whether it is allowed.

WHY THIS EXISTS. The seed canary asks whether the fleet's code works in any
Minecraft world. Its treatment is a random seed -- but `place-town.py` accepts a
seed only if it can find a flat, dry, low-relief, tree-adjacent site, and on
2026-09-19 **one of the two seeds drawn rejected every candidate on its spiral**
and had to be thrown away. pool one's own log records 47 rejections before an
acceptance.

That is not merely a smaller sample. On an ACCEPTED seed the search places the
town on the one site it could find that is unlike the world around it, so the
terrain whose effect is under test never reaches the bots standing in it. The
filter does not shrink the experiment; it neutralises the treatment.

THE REFRAMING THAT MAKES TIERING SAFE. The filter was read as protecting
placeability -- "a chest half in a lake". It does not. `place-town.py` stamps
its own platform:

    fill x-6 y-1 z-6  x+6 y-1 z+6  minecraft:stone_bricks   # a flat floor
    fill x-6 y   z-6  x+6 y+3 z+6  minecraft:air            # cleared above

Relief, and water inside the footprint, are overwritten by that fill. The only
state a town genuinely cannot be stamped onto is VOID. Everything else the
search rejects is a HARD START, not an impossibility -- and "code that works in
any Minecraft world" is precisely the bots coping with a hard start.

SO: score the site, do not gate it. Record the tier and the raw numbers as
covariates, and let the analysis condition on them instead of pretending site
quality is constant because the filter held it constant.

NOT APPLIED MID-EXPERIMENT. The seed canary's two pools were placed under the
TIER 0 rules on 2026-09-19 and changing the criteria between pools would put a
second variable in a two-pool trial. This is for the next round.
"""

#: Tier 0 is exactly today's rule. Each later tier relaxes only what the stamp
#: can survive, and the floor is the one thing it cannot.
TIERS = (
    ("standard", dict(wet_frac=0.05, canopy_frac=0.35, relief=3, route_drop=6,
                      spread=10, wood_hits=3, platform_water=False)),
    ("workable", dict(wet_frac=0.25, canopy_frac=0.50, relief=6, route_drop=10,
                      spread=16, wood_hits=1, platform_water=False)),
    ("hard",     dict(wet_frac=0.50, canopy_frac=0.80, relief=12, route_drop=16,
                      spread=28, wood_hits=0, platform_water=True)),
    ("floor",    dict(wet_frac=1.0,  canopy_frac=1.0,  relief=999, route_drop=999,
                      spread=999, wood_hits=0, platform_water=True)),
)

#: The stamp needs somewhere to stand. Nothing else is unplaceable.
UNPLACEABLE = "void column in the platform footprint"


def site_tier(stats):
    """
    The strictest tier that accepts this site, or None if it is unplaceable.

    `stats` is what `place-town.py`'s probe already gathers:
    `wet_fraction`, `canopy_fraction`, `platform_relief`, `terrain_spread`,
    `max_route_drop`, `wood_hits`, `platform_water` (bool), `void_in_platform`
    (bool). Missing keys are treated as their worst value, because a site whose
    numbers were not measured has not earned a good tier -- the same fail-closed
    convention the openloop guard uses.

    Returns `(index, name, failed)`: `failed` names the criteria that pushed it
    past tier 0, so a site at tier 2 still says WHY it is not a tier 0 site.
    """
    if stats.get("void_in_platform"):
        return (None, None, [UNPLACEABLE])
    worst = dict(wet_frac=1.0, canopy_frac=1.0, relief=999, route_drop=999,
                 spread=999, wood_hits=0)
    got = dict(
        wet_frac=stats.get("wet_fraction", worst["wet_frac"]),
        canopy_frac=stats.get("canopy_fraction", worst["canopy_frac"]),
        relief=stats.get("platform_relief", worst["relief"]),
        route_drop=stats.get("max_route_drop", worst["route_drop"]),
        spread=stats.get("terrain_spread", worst["spread"]),
        wood_hits=stats.get("wood_hits", worst["wood_hits"]),
        platform_water=bool(stats.get("platform_water", True)),
    )
    failed = _fails(got, TIERS[0][1])
    for i, (name, lim) in enumerate(TIERS):
        if not _fails(got, lim):
            return (i, name, failed)
    return (len(TIERS) - 1, TIERS[-1][0], failed)   # the floor accepts anything placeable


def _fails(got, lim):
    out = []
    if got["wet_frac"] > lim["wet_frac"]: out.append("wet")
    if got["canopy_frac"] > lim["canopy_frac"]: out.append("canopy")
    if got["relief"] > lim["relief"]: out.append("relief")
    if got["route_drop"] > lim["route_drop"]: out.append("route_drop")
    if got["spread"] > lim["spread"]: out.append("spread")
    if got["wood_hits"] < lim["wood_hits"]: out.append("wood")
    if got["platform_water"] and not lim["platform_water"]: out.append("platform_water")
    return out
