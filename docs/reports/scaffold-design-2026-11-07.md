# Scaffold at the source (scaftown-01), 2026-11-07

**Owner, 11-07 evening, after the timelapses:** "it seems like we're still using dirt as a cheap way to get around and get
over obstacles, and that leaves junk and dirt piles and pillars everywhere. is that just a cheap poor man's path finding
solution?"

**Answer: yes.** The walk profile prices a tower step at 6 (1 for the move plus `placeCost` 5) against 1 for a walk step.
So a two-block climb with dirt beats any staircase more than about 12 blocks away. Most of what the bots leave is the
pathfinder's, not the escape reflexes'. The fix makes building expensive where the town already offers a way up or through.
It is never a veto.

## 1. Who places the scaffold (measured)

**Showcase, 24 h to 11-08 00:43Z.** 15 bots, 322.6 bot-h, 261,831 rows, full walk with `scripts/lib/telemetry.py`.
The per-cell ground truth comes from a copy of the CoreProtect database (read-only). It matched 2,609 of the 2,615
instrumented placements, which is the positive control for the instrument. "Standing" means the block was still there in
the 00:30Z mirror copy. "Removed" means a later CoreProtect break at the same cell.

| who (town + margin = Chebyshev <= 64 of home, y >= home.y-12) | placed | removed later (by the placer) | still standing (cells) | standing on top of its column |
|---|---|---|---|---|
| pathfinder: pillar (1x1 tower) | 1,048 | 553 (222) | | |
| pathfinder: step (jump-up block) | 877 | 468 (241) | | |
| pathfinder: bridge | 20 | 10 (7) | | |
| **pathfinder, all** | **1,945** | **1,031 (470)** | **409** | **137** (114 stand above the median of their 8 neighbours) |
| reflex `pillarOut` | 576 | 222 (88) | 262 (with digStraightUp) | 9 |
| reflex `digStraightUp` | 56 | 22 (14) | | |
| skills (shaftAscend, place) | 31 | 7 | | |

Notes on the table:

- **Where:** 1,685 of the placements are inside the wall boxes and 899 are outside the walls within 80 blocks.
- **What:** dirt 2,389 of 2,584 movement blocks, cobblestone 86, sand 43, the rest stone variants.
- **When removed:** the minutes to removal run p10 0.0, p25 0.3, p50 5.4, p75 127 and p90 412. About half is the bots' own
  churn (they dig the block back up), the rest is the groundskeeper much later.
- **The visible litter is the pathfinder's.** 137 of its standing cells are the top of their column. The escape pillars sit
  in holes and tunnels: 9 of 262 are on top.
- **Height:** 1,429 of 2,591 town placements are at y <= 64 (home y 70). These are bots climbing out of holes and tunnels
  in the town's crust.
- **Hot spots:** there are 636 distinct 3x3 spots, 196 of them with 5 or more placements. The top 20 hold 433 placements.
- **What the bot was doing:** most placements happen outside any long skill, on build-visit and sink legs (1,449). The
  rest: gather 287, build_shop 50, goto 42, explore 24.

**The whole world (`_place_town_sum`, all zones).** Beyond 64 blocks, or deep, the pathfinder placed 4,632 blocks and
failed 4,355 more placements. The reflexes placed 2,739. CoreProtect shows about 6,900 uninstrumented scaffold-material
placements deeper than home.y-12, which are mines under and near the town and out of sight. Only 23 surface placements
are more than 160 blocks out. **On the showcase, far-surface scaffold is small**, so lever (b) has no data behind it yet.

**Fleet.** The fleet has no placement instrument and no CoreProtect. `_place_town` and `_place_town_sum` raise
ZeroLooksWrong on the 24-h walk (2,250,370 rows, 80 bots); the positive control is `_dig_town_sum` at 54,046. The only
signal is `_scaffold_pick`: 94,966 rows (pillar_out 72,037, dig_straight_up 22,893). That counts escape scaffold
choices, and it is a lower bound. The movement settings are the same lines in index.mjs. **So the fleet needs the
instrument first:** placeaudit-fleet-01, below.

**Movement settings** (bots/src/index.mjs; showcase 01c6debf line / fleet de9fe23d line):

- **walk `moves`:**
  - `canDig=false` (:432 / :435, load-bearing: digging on a walk tunnelled bots into pits)
  - `allow1by1towers=true` (:439 / :442)
  - `extendScaffolding` (:457 / :460): every non-falling full block the bot holds
  - `allowParkour=false` (:458 / :461), `maxDropDown=6` (:473 / :476), `placeCost=5` (:490 / :493),
    `liquidCost=2` (:522 / :525)
  - exclusionAreasStep: water entry, death sites, well (:631 / :634)
  - exclusionAreasPlace: protect zones + shop footprint (:645, :653 / :648, :656)
  - nobridge (:657 / :660), cornermoves (:661 / :664), lidplace +20 after legality (:671 / :674)
- **gather:** canDig true, towers on (:722 / :725)
- **ascend:** an escape; canDig true, towers on (:805 / :819)
- **descend / deck / water:** no towers
- **tunnel:** oretunnel.mjs; places nothing
- **town_deposit_walk:** scafoldingBlocks empty, so it places nothing
- **thinkTimeout:** 5000 ms (:1022)

## 2. Design (Claude + Codex, reconciled)

Codex designed it independently from the measurements and the goal (`codex exec`, read-only). Its first piece matched
ours almost line for line: price the walk's surface scaffold after legality, with a bounded fallback. Where we differed:

| point | Claude's draft | Codex | taken |
|---|---|---|---|
| profiles | walk, composter_walk, gather | walk, composter_walk; gather exempt (its admission is a capped digapproach search) | **Codex**. Gather is piece 2, with admission and execution changed together |
| depth | y >= home.y-12 | y >= home.y-4 (pits and tunnels under the town unchanged) | **Codex**. Climbs out of holes have no alternative anyway |
| price | 30 | 20 (lidplace's number, a known search behaviour) | **Codex** |
| fallback | latch only | 1 s preference budget, base-cost search after it, capped probes unpriced, never cycle | **Codex**. Built as restart-in-place, after Codex's r1 blocker |
| take-back by the placer | piece 2 | later; self-cleanup can destroy the return route | both: **not in piece 1** |
| access at hot spots | groundskeeper staircases (climbSpots) | the same, top-20 spots first, verified both ways | piece 3 |

**Piece 1, scaftown-01: built.** Each placement a walk or composter_walk plans into the town's area costs 20 more.

- **The area:** every wall@1 / wallext@1 ring grown by 2, plus Chebyshev <= 80 of home (LAND.workR), at y >= home.y-4.
  The showcase's wall extension reaches z -89, so radius alone would miss it.
- **After legality:** the price is added in a getNeighbors wrapper (lidplace.mjs's mechanism). No move is ever removed;
  the A* only reorders them. A tower step now costs 26 and a two-high step-up 46, so a walk of up to about 20 blocks per
  placed block wins.
- **The searched profile decides** (`this.scafTown`). The gather, ascend, descend, deck and water clones set it false. The
  reflexes' own pillars (pillarOut, digStraightUp, surface, shaftAscend) never consult the pathfinder and are untouched.
  That is lever (d): escapes keep the right to pillar.
- **Search scope:** a wrapper on `getPathFromTo` and on each continuation's `compute`.
  1. A capped search (searchRadius >= 0: digapproach, reachprobe, the tunnel) is never priced.
  2. A priced search past its 1 s budget that has not found the path restarts in place from its start node, at base costs,
     with the full timeout. It then IS the base's search.
  3. A priced search that ends timeout latches its goal to base costs for 120 s. So does a goal whose walk resets 'stuck'
     twice.
- **Rollback:** SCAFTOWN=off installs nothing.
- **Rows:**
  - `_scaftown_mode`, the licence row
  - `_scaftown_hits` every 10 min: hits, chosen, searches, priced, cuts, restarts, latches, latched, capped, stuck_latches.
    This is the positive control for a zero.
  - `_place_town` rows now carry `profile=`

**Every refusal is a remedy.** No refusal is added. A pit in town with nothing to climb still towers out: the unit chain
and Paper both show it. A wall with no gate is still crossed by the tower. A search the price slows past 1 s becomes the
base's search.

**Piece 2 (designed, not built): take-back and gather.**

- The placer takes back its own movement blocks in the area, only when it is safe:
  - the block is still the placed block and has no body on or over it
  - the stance is reachable
  - removing it opens no fall or hollow
  - it is not a record or plan cell
- Otherwise the block is left to the groundskeeper's ledger. roughground's climbs ledger already takes back what still
  stands in town + margin. Piece 2 widens the ledger to the whole area (wall rings + 80).
- Gather joins the price together with digapproach's admission fallback.

**Piece 3 (designed): access.** The groundskeeper builds stairs where climbs cluster (climbSpots), starting with the
top-20 3x3 spots, which hold 433 placements a day. Each one is verified both ways, and wall crossings get connected to the
gates.

**Lever (b), far from towns: deferred.** The data says there is little of it: 23 surface placements beyond 160 blocks in
24 h on the showcase. The fleet will say more once placeaudit-fleet-01 is live.

## 3. Proof

**Unit tests** (`bots/test/scaftown.test.mjs`, 18 tests; the real mineflayer-pathfinder 2.4.5 Movements and A*):

- the area, the surcharge, the search modes
- the ledge in town: the base towers, the candidate takes the stairs and places 0
- the same ledge far from town: candidate == base
- a pit in town with nothing to climb: still out
- an escape profile: identical to the base
- a property test: identical neighbour sets at >= cost over every node of the scenes, and a near-100 move kept, priced 102
- capped searches unpriced
- the budget and the restart: deterministic, the same cost as the base. Codex's column repro also passes on the real clock.
- the first-slice re-run, the latch and the stall latch
- 6 behaviour mutants with anchors that are checked unique, plus a wiring check with its own mutants

**Paper, sandbox6** (`sandbox/scaftown/scaf-proof.cjs`). The walk profile is built as index.mjs builds it. Each arm ran 3
trials; the counts are the server's (`clear` and `fill replace`). It was re-run on the final code with the same result.

| scene | base: arrived / dirt left / time | scaftown: arrived / dirt left / time |
|---|---|---|
| ledge 3 high, stairs 14 along | 3/3, **6**, 18.4 s | 3/3, **0**, 7.6 s |
| wall 4 high, gate 18 along | 3/3, **9**, 21.6-25.8 s | 3/3, **0**, 8.5 s |
| pit 3 deep inside town, nothing to climb | 3/3, 6, 7.8-19.0 s | **3/3**, 6, 13.1-17.9 s (no dead end) |
| the ledge, home 500 away | 3/3, 6 | 3/3, 6 (unchanged far from town) |

The towers were also slower: each placed block costs a jump and a click.

**Full suites** (`suite-run.py --ref`):

- showcase c523bc53 on ci2: 467/469. The two failures are craftsync (a known flake; it passes alone) and
  nothing-important-is-orphaned (bagdiet, which fails on the live base too).
- fleet 2366d466 on .30: 417/419. The two failures are plinth-skill (a known flake; it passes alone) and well (a known base
  failure).

**Reviews** (protected scope, two engines, blockers only):

- **Codex r1: 1 BLOCKER**, reproduced with the real A*. The budget only zeroed new edges, so closed nodes kept their
  inflated g. On a goal at the top of a 20-high column the base succeeded in 1,565 ms and the candidate timed out at
  5,000 ms. Fixed with restart-in-place.
- **Codex r2: NO BLOCKERS.** The column repro: base success in 2,757 ms; candidate success in 3,397 ms with one restart,
  the same cost of 126 and the same 59,862 nodes.
- **Independent Claude r1 and r2: NO BLOCKERS.** Its notes were adopted: `pos` goals latch; a walk that keeps getting
  stuck latches; no restart on noPath; the stall counter counts priced profiles only.

## 4. Pieces and where they go

- **Showcase:** `scaftown-01show` @ c523bc53 on the live release 01c6debf (gkclear-01show). Ready to stage. No shopread
  rule is needed: it adds no new place or dig kind, only fewer movement placements.
  - Read: `_scaftown_hits` (hits and chosen > 0, restarts and latches small)
  - Read: `_place_town reason=pathfinder outcome=placed` per bot-h down; it was 6.0/bot-h in town+margin
  - Read: `_path_timeout` and `_reflex_stuck` not up
  - Read: the mirror's standing-on-top count of new pathfinder cells down
- **Fleet:**
  - `placeaudit-fleet-01` @ 3b85ebd9 on de9fe23d (tier 2, telemetry only). It comes first because the effect metric does
    not exist in fleet logs.
  - `scaftown-01` @ 2366d466 on top of it (tier 3, P lane). Its scaftown code is byte-identical to the showcase's.
  - The registrations and draft entries are in `~/mcai-analysis/{placeaudit-fleet-01,scaftown-01}.*` on the canary host.
  - Effect: `detail.rate.v1 _place_town:reason:pathfinder:outcome:placed` down >= 30%. Guardrails: `_path_timeout`
    (18.55/bot-h), `_reflex_stuck`, `_death`, items.
