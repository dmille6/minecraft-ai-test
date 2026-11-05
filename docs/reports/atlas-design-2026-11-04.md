# atlas-01: the bots' shared map, and the bots use it (2026-11-04)

## Owner direction, 11-04

> "it seems like they are going out in straight directions straight out and then back, is there any value in them branching
> out and wandering some.. is there some kind of group shared map where they could identify areas that havent been explored
> by other bots and explore those areas? mark anything important or interesting."
>
> "i want you to write the map layer, but i dont want a really good map that no bot uses. how can we incorporate the use of
> this map and data into how the bots think and work"

## Why the trails were spokes

`expedition.mjs` walked **8 fixed bearings**, 45° apart. A trip went out to a ring of 100–300 blocks and came home over its
own breadcrumbs. On every odd trip, `tripBearing` re-walked the last spoke that brought something home. `wholemap.py` drew
coverage on BlueMap, but no bot read it. The shared per-pool world facts (`worldfacts.mjs`) held 8 resource kinds and the
hazards, but not where anyone had been.

## The design: one set of files, written by the bots, read by the bots, drawn from the same bytes

| piece | where | what |
|---|---|---|
| record | `bots/src/atlas.mjs` (installed by `features.mjs`) | one `atlas-<bot>.json` per bot in the pool dir. **cells** (32×32): `seen` when the bot stood under the sky within 40 blocks (the reflex survey radius), `stood` always. **finds**: wood, ore, plants, materials, landmarks, hazards, scanned every 30 s or every 24 blocks walked. **gone**: a find read absent from 10 blocks away. **aims**: every expedition's pick and the reason for it. One file per bot, atomic writes, no lock. |
| use 1: frontier trips | `expedition.mjs` `planTrip` | Even trips go to the bearing+offset (k + −18…18°, inside its wedge) whose swath crosses the most cells nobody saw in 72 h. The spokes become a fan, and the fan follows the gaps. |
| use 2: harvest trips | `expedition.mjs` `planTrip` | Odd trips aim at the densest fresh wood the map knows: 64–300 blocks out, never in a protected zone, on an open bearing. The ring is set to the wood's distance + 8, so the turn's gather fells at the trees instead of wherever the spoke ended. |
| use 3: the brain | `prompt.mjs` `atlasLine` | A `MAP (shared by every bot in this town): …` line. Finds that serve the task come first, wood is listed only when wanted, hazards within 48 are marked AVOID, villages and the town are never offered, and the line names the nearest unexplored side. The brain can `goto` any of it. |
| the picture | `infra/showcase/wholemap.py` (hourly) | BlueMap sets: explored ground by age, finds, wood, hazards, and **every trip's aim with its reason**. The map shows what the bots decided, from the files they decided it with. |

**Unchanged:** the bearing index 0..7 is still the day's bookkeeping (dead bearings, the reuse rule, bridge sites,
per-bearing reads). The fractional **aim** is what the legs walk, through `bearingVec` (`legTarget`, `zoneDetour`,
`beyondGain`, marker facing). With no map, nothing unseen and no wood, `planTrip` returns `tripBearing`'s old answer exactly.
`ATLAS=off` removes the install, so nothing reads it.

**Tier 2** (`protected.py`: not protected). Showcase first: `atlas-01-show-on-9295590e`. It needs no fleet canary.
`ATLAS` defaults on only in the showcase pool.

## How it is read (done = observed, not merged)

On the showcase, 2 h after activation, then 24 h, every number with its denominator:

- **Coverage:** `wholemap.py`'s seen% (InhabitedTime, the server's own counter, independent of the bots' files) and atlas
  `cells seen within 72 h`, both against the 24 h before.
- **Shape:** the per-trip `aim` and `mode` in `expedition-0_70_0.trips.jsonl`. Distinct aims per day, against the 8 before.
- **Harvest works:** haul per harvest trip vs per frontier trip vs the pre-atlas reuse trips (the 11-03 read had 35 trips
  with 0 hauled).
- **No harm:** trips home %, expedition-linked deaths, `expedition_no_bearing` count.
- **The brain uses the MAP line:** decisions whose `goto` target is within 8 blocks of a find offered in that prompt, over
  decisions with a MAP line shown.

Rollback: `ATLAS=off` on the showcase units, or the previous release.

## Not in v1

- `explore` (protected) still picks its own heading. Steering it by the frontier is tier 3.
- Harvest trips gather only wood (`exGather`). Ore, cane or pumpkin fetches from finds would be a separate piece.
- The fleet: `ATLAS_POOLS` can switch it on per pool once the showcase read is in.
