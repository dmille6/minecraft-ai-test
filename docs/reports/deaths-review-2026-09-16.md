# Where the bots die now, and what to build next — evidence for two-engine review (16 Sep 2026, 21:50 UTC)

Read as the operator's evening pass after the -10+-11 promotion (1d6c97d fleet-wide 18:13Z). Every number below names its
denominator. Telemetry: full walks of /var/log/mcai (live + rotated .gz), `_death` rows carry cause, position, the running
skill and the lead-up; classes are lava / drown / fall by the server's death message.

## 1. The fleet
80 bots, 16 worlds, one version (1d6c97d), 80/80 online by RCON on all sixteen servers, TPS 20.0 everywhere. All twenty
world directories on 10.0.0.30 (16 live + 4 sandbox) carry the SAME `level-seed=1239381899`: the terrain is identical in
every pool. That fact matters for everything below.

## 2. Deaths, 96 h (7,680 bot-h): 416 = 0.054/bot-h. lava 198 · drown 120 · fall 96 · other 2
Split at the 08a3da2 promotion (lava guards v2 + iron retention, 05:35Z 16 Sep; the fleet then moved to 1d6c97d at 18:13Z):

| era | bot-h | all | lava | drown | fall |
|---|---|---|---|---|---|
| before 05:35Z | 6,463 | 385 = 0.060/bh | 193 = 0.030 | 105 = 0.016 | 85 = 0.013 |
| after 05:35Z | 1,216 | 31 = 0.026/bh | 5 = 0.004 | 15 = 0.012 | 11 = 0.009 |

Caveat, stated as the rules require: this is a before/after on the whole fleet, not a difference-in-differences, and
pools have moved 2x on a metric in six hours with no code change. The 0809 canary's own DiD said 0 lava deaths on the
canary vs 9 on control (0.030/bh) over 60 canary bot-h, which points the same way. Treat "lava down 7x" as likely, not
proven; the 72-h program read (17 Sep 09:34Z) is the instrument for it.

**Consequence: the residue is drowning first (15 of 31 = 48%), falls second (11 = 35%), lava third (5 = 16%).**

## 3. Lava: the same four pools kill, in every world
- 48 h, 66 lava deaths: 58 at a site (8-block cell) that killed at least twice; four sites account for 46 (70%): (336,208)
  19 deaths in 11 pools, (384,104)+(392,104) 20 deaths in 9 pools, (296,296) 7 deaths in 6 pools.
- 43 of 66 came within 60 s of `explore_toward_known` steering the bot at a shared iron-ore sighting whose straight line
  crosses the pool (`iron_ore at 362,58,122` -> deaths at 386,70,100; `iron_ore at 363,71,215` -> deaths at 336,35,205).
  Positive control: 41,488 explore_toward_known rows in the window.
- The timelines (24 h, every lava death): a `lava_corridor` refusal 3-10 s before death in 5 of 5 deaths after the
  promotion (the guard sees the pool and refuses the leg), then the bot is moved anyway by something that is not the
  refused leg — `path_reset stuck/goal_updated` jitter, explore's fallback (blind-step refusals with the position still
  changing), a maroon escape, a livelock relocation — and it is in lava within seconds. "idle at the moment of death" in
  most: the skill had already been interrupted by `danger_block`.
- **Repeat deaths** (a same-class death within 8 blocks and 8 y earlier in the SAME POOL): lava 101 of 198 over 96 h
  (65 with a 12-h memory); fleet-wide, i.e. if every pool knew every other pool's deaths, 164 of 198. Falls 12/96 and
  drownings 15/120 repeat by site; those classes are not site-bound.
- What exists: `worldFacts.reportHazard` / `hazardsNear` (pool-scoped, shared file per pool; per-bot for isolated) and
  `lessons.recordHazard`; hazards are consumed ONLY as prompt lines ("X hit lava 3x near ... — avoid it"), i.e. advice,
  which the CLAUDE.md rule says is not a remedy. `mineflayer-pathfinder` 2.4.5 has `Movements.exclusionAreasStep`
  (per-destination-block cost, `>100` deletes the neighbour), and index.mjs already uses it for the water entry price.
  No death is ever published as a hazard: `shareHazard` needs two personal hits of `air.kind`/`entombed`.

## 4. Drowning: sealed pockets, ~100 s of life, one attempt per ten minutes
- 48 h, 50 drownings: 47 idle at death. Median 103 s (p10 94, p90 458) from the first drowning-rescue row to death; death
  y median 56 (p10 11, p90 61; sea level 63): flooded caves and aquifers a few blocks under the surface, entered while
  running gather 16, explore 12, goto 7, mine 6, surface 6.
- The rescue's chain at every death: `drowning_route sealed` (or `unscanned`) -> `drowning_up` -> 20-s ceiling
  `drowning_ceiling_no_air` -> yield -> repeat, health falling 0.33/s, until dead. Two to four ceilings per death.
- The flooded-pocket rung (fleet-wide since 18:13Z, 2.5 h): 17 rows. Refused: "no pickaxe in hand" 5 (one bot, hive-a-Bravo,
  every 10 min, still sealed), "cell y=59 would let liquid in" 1 (hive-a-Alpha, died 19:14), "no floor within reach" 1;
  ran and "finished the column but not out" 4; side exits 7. Earlier on the canary: "need 8 placeable blocks, have 5"
  (hive-b-Echo, real sealed pocket, survived to the promotion restart).
- Composition defects in `pocketPlan` (floodpocket.mjs): (a) `!toolInHand` refuses BEFORE `digs` is computed, so a bare
  hand is refused even when no ceiling cell needs digging (pillar-only pockets); (b) `blocks = need + 4` is a hard floor
  with no reduced-margin or dig-first plan; (c) the rung runs once per `POCKET_RUNG_COOLDOWN_MS = 600_000` and a refusal
  spends the slot, while the bot has ~100 s; a re-plan every 20 s while still sealed costs nothing (the plan is pure).
- Sandbox: `sandbox/fixtures/hive-b-echo-sealed-pocket.json` is captured; `sandbox/corpus-pocket.tsv` is the corpus.

## 5. Falls: explore, 35 blocks, not site-bound
48 h, 35 falls: running explore 21, gather 8, goto 3, idle 2, surface 1; median 35 blocks (p90 58; 30 of 35 >= 20).
In the 20 s before: `path_reset goal_updated` 22/35, `block_updated` 19/35, explore_toward_known 10/35, path_timeout
9/35, `stuck` 8/35, water_surface rows 4/35. Hypothesis to test, not a finding: `Movements.infiniteLiquidDropdownDistance
= true` (pathfinder default, inherited by every profile) lets a route drop any height onto water, and a one-block-deep
pool or a missed landing is a 35-block fall. Needs the route that was being executed at the fall (path_update r.path
is not logged). Analysis item, not a build item tonight.

## 6. Candidates, ordered by the post-promotion death histogram (rule v16.3)
**A. Pocket-rung remedies (drowning, 48% of the residue; a LADDER change, v12 linkage applies).** In floodpocket.mjs and
the rung wiring in reflex.mjs: (a) refuse bare hands only when a dig is planned; (b) when `blocksHeld < need + 4`, plan
with the blocks held if `blocksHeld >= need + 1` (one seal, no spare) and say so in the row; (c) while `pocketWanted`
is fresh and the bot is still sealed, re-plan every 20 s instead of once per 10 min, with the same one-attempt-per-plan
body. Instrument: rung rows by outcome (exists, pocketread.py), drownings/bh DiD, time-from-sealed-to-first-rung-attempt.
**B. Death-site exclusion (lava residue + a generic mechanism; NOT a ladder change).** (1) In index.mjs `bot.on('death')`:
publish the death position as a hazard `death:<class>` to the pool's world facts with count 4 (survives two 12-h
prunes); (2) `moves.exclusionAreasStep` gets `deathSitePenalty(block)`: +60 for a destination within 6 blocks
horizontally and 6 vertically of a death site (cached list, refreshed every 20 s from `worldFacts.read()`); 60 not 100
so a bot inside the disc can still walk out and the region is a wall of cost, not a hole in the graph; applied to every
profile including `waterMoves`; (3) `knownTarget` in skills.mjs skips a sighting within 12 blocks of a death site;
(4) rows `death_site_recorded`, `death_site_target_skipped`, and `death_site_route_crossed` (a planned path that still
passes within the disc — the positive control that the exclusion is live). Own line: repeat deaths (same class within 8
blocks of a prior pool death) per bot-h, DiD; report line: explore_toward_known/bh, noPath/bh. Pool-scoped, so the FIRST
death at each site in each pool is not prevented; the 96-h number says that is 101 of 198 lava deaths, 12/96 falls,
15/120 drownings. Same seed in every world is why the fleet-wide number (164/198) is larger, and sharing across worlds is
not code that works in any world, so it is not proposed.
**C. Falls: an analysis item** — log the executed path's drop at every fall, test the liquid-dropdown hypothesis, then
decide. Not tonight.
**Bundle:** A and B touch disjoint files (floodpocket.mjs + the rung block in reflex.mjs vs index.mjs death handler and
Movements, worldfacts.mjs, skills.mjs knownTarget) and carry separate lines, so v16 rule 4 allows one canary carrying
both; a REVERT on a shared line reverts both. Iron pooling (-12) covers no deaths and moves behind them.

## 7. Questions for the reviewer
1. Rank A, B, C by expected deaths prevented per bot-hour on the post-promotion fleet, and say what would change the rank.
2. For A: does any of (a)(b)(c) create a new dead end or a new way to drown (a bare-hand pillar with no dig; a one-seal
   plan; re-planning every 20 s while the drowning handlers hold the body)? Name the fallback each refusal lands in.
3. For B: the cost 60 vs 100 trade-off; the 6-block disc; isolated pools (per-bot facts); a bot that respawns and whose
   home or the only corridor sits inside a disc; the immobility/noPath risk against the v15c guards; and whether the
   pathfinder's `exclusionAreasStep` is the right hook (it prices the destination block on every neighbour evaluation).
4. Prior art: does mineflayer-pathfinder, Baritone, Voyager/Odyssey/MineDojo or any published survival agent keep a
   death-site or hazard-site memory and feed it to planning? Cite what you know; mark guesses.
Name at most three defects per candidate with one-line remedies, then ACCEPTABLE or NOT ACCEPTABLE for the bundle.
