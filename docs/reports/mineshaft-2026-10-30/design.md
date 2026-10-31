# The town stair: a common mineshaft per town (shaft-02), design r2 (2026-10-30)

OWNER 10-30: "A common mineshaft seems like a good idea let's find the best approach and add it to the queue use both
Claude and codex for the best solution." Fun mode (docs/PROCESS-fun-mode.md). Tier 3 (mine, surface, protected files).

Both engines designed independently from one brief (`brief.md`, the same facts) and then converged. Codex's independent
answer is `codex-design.txt`; the review rounds are `reviews.txt`. This file is the converged design.

## 0. Answer

**Build a lined spiral staircase per town, down to feet y=16, as a project in the trunk's project framework, and ship its
use in the same canary.**

- **Shape:** a 3x3 spiral round a solid central pillar (5x5 with its shell). One full block down per step, eight steps a
  turn, three clear blocks over every tread, so the walk is the pathfinder's ordinary jump-up and drop-down. No ladders,
  no cap, no water.
- **Depth:** feet y=16, the peak of 1.21's iron band, with landings (a 4-long mining stub) at feet 48, 32 and 16. Nothing
  below y=16: the deep stair (F6, y=-53) stays its own design.
- **Use:** `mine` with a real descent target walks down the stair to the landing and mines on from the stub's end;
  `surface` walks up it. Both fall back to today's code on any failure. One static prompt line says the stair exists.
- **Built** by one bot per town at a time: a `PROJECTS` entry (`shaft@2`, one slot) with its own excavation visit, top
  down, a step at a time, lining before digging.

What it should move, in order of what a 2-pool, 3-hour canary can see: a visible structure (steps built, landings
published); shared mining trips (descents and ascents through the stair, their time, digs avoided); then raw iron per
bot-hour (today 3.2 per skill-hour at y 16-31 against 0.64 at 48-63 and 0.09 at 64+; an observational band ratio, not
a promised effect).

## 1. What was measured (24 h to 2026-10-30 ~18:30Z, 80 bots, full walk, 1.81M rows)

| y band | skill bot-h | iron gathers (ok) | raw iron | per skill-h | deaths |
|---|---:|---:|---:|---:|---:|
| >= 64 | 212 | 216 (16, 7%) | 20 | 0.09 | (in 48) |
| 48-63 | 140 | 609 (93, 15%) | 90 | 0.64 | 9 (6 drowned) |
| 32-47 | 82 | 664 (131, 20%) | 145 | 1.8 | 4 |
| 16-31 | 47 | 418 (121, 29%) | 152 | 3.2 | 3 |
| 0-15 | 23 | 122 (48, 39%) | 71 | 3.1 | 5 |
| < 0 | 23 | 62 (17) | 40 | 1.7 | 11 |

- `mine`: 7,895 calls a day (12.1 bot-h); 19,408 cobble/deepslate collected while it ran. Targets: 2,380 in the 48s,
  2,196 in the 32s, 1,456 in the 16s.
- Positive controls: 32 `_death` rows, 1.81M rows, 80 bots. Exposure is skill time only (idle time has no duration),
  so the per-hour columns are a proxy.
- Reading: iron success and yield rise with depth down to y~0; deaths per skill-hour are flat from 48 down to 16 and
  rise sharply below 0. So y=16 is the target, and below 0 is not.

## 2. Alternatives (both engines)

| Option | Verdict |
|---|---|
| shaft-01 as built (two 1x1 ladder columns, landings every 8, cap) | Dead lineage (structures/monumentjob/structureguard are gone from the fleet). Ladders need ~110 ladders (~33 logs), a cap between visits, a fall hazard of the whole depth guarded only by step exclusions (T10), the entombed reflex reading a ladder as a ceiling (T1), and Paper-fragile ladder and cap placement (two Paper fixes already). Rejected. |
| One ladder column | All of the above, no redundancy. Rejected. |
| Straight stair | ~55 blocks of horizontal run: crosses town features and chunk edges. Rejected. |
| 2x2 spiral (4 steps a turn) | Claude's first pick (smallest, 4x4). Codex: a turn on every step and a 3-block ceiling over every jump. **Converged on 3x3**: half the turns, the same digs per step. |
| **3x3 spiral round a pillar** | **Chosen.** 3 digs per step (only the 3 cells over each tread; the rest of the 3x3 stays rock), max drop 1 inside, self-rescuing (a bot that steps in from the surface falls at most 3 and walks out), walkable by the ordinary walk profile. |
| Water elevator / bucket | Owner rule (no water buckets underground, no bridging). Rejected. |

**Build only vs build and use.** Both engines: **together**. A build-only canary can only close "KEEP, goal unverified":
the value is the use, and the generic read judges harm the same way. The use is gated on verified landings, so before
the first landing nothing changes for a miner.

## 3. Geometry (`shaftgeom.mjs`, pure)

- Local frame (u, v), +v pointing away from home; `toWorld(origin, away, u, v)` from shaft-01. The 3x3 core is
  u, v in 0..2; the pillar is (1,1). Perimeter order, a full turn: P = (0,0) (1,0) (2,0) (2,1) (2,2) (1,2) (0,2) (0,1).
- `g` is the ground level (the top solid block) at the site. Step k (k = 0..K) is cell P[(s0 + k) mod 8]: its tread is
  at y = g - k, its air cells are g-k+1 .. g-k+3. Step 0's tread is the ground itself (the entry).
- **Bottom:** K = g - 15 (feet 16). **Landings:** steps K, K-16, K-32 (feet 16, 32, 48), kept when the feet are at least
  8 below g. Because 16 is a multiple of 8, every landing is on the same perimeter cell; s0 is chosen so that cell is
  (1,2), the middle of the away side, whose one outer face is +v.
- **Stub** at a landing with feet f: cells (1, f..f+1, 3..6), the doorway through the ring at v=3 plus three more, 2 high.
  Its end face (v=7) is NOT reserved: `mine`, the iron gather and the ore tunnel dig on from there.
- **Cells:** `air` = every step's three air cells + stub cells; `tread` = every step's tread; `lining` = every face
  neighbour of an air cell that is neither air nor tread, at y <= g, except the stub end faces. Above g nothing is lining
  (open air by design).
- Size for g = 70: K = 55, 165 step digs + 24 stub digs, ~190 cobble out; lining placements are whatever the rock lacks
  (caves); no ladders, no sticks.

## 4. Siting (once, by the first builder, from the live world)

- Candidates: centre (1,1) at Chebyshev 19-26 from home inside the town plan's `shaft` outer-plot sector (townplan.mjs
  OUTER.shaft), every cell of the 5x5 and the stub columns at Chebyshev >= 17 from home (outside the town's 16 square and
  mine's 12 home refusal), clear of every project record's zone (shop.mjs recordZones), protected zones, plan cells,
  wells and the farm, by 2.
- The 5x5 ground within g-2..g+1; nothing above ground to g+4 but air and plants; no water or lava in any column from
  g+4 down.
- **Survey down** (the bot's loaded chunks hold the whole column): for each candidate, walk the steps top down; the first
  air or tread cell that is liquid, or an unknown read, sets the stop. Landings below the stop are dropped. Score: depth
  reached, then fewest lining placements, then nearest home. A site with no landing is refused (`no_site`: ordinary
  mining is unchanged).
- The record (buildproj `publishRecord`, plot `shaft`, blueprint `shaft@2`): site {origin, away, g, s0}, K, planned
  landings, cells [{at, role}], `box`, `landings_built: []`, state `open`. Generations only on transitions (a landing
  built, a stop, completion).
- **No site** (r2, Claude B1): a `no_site` record (structure_complete, no cells, `retry_at` = +24 h) is published, so the
  order moves straight on to the next project; after `retry_at` the record is only `due` (after every open project) and
  the next visit re-sites. The visit's stop is `shaft_no_site`, never the generic `no_site` (which would hold the bot's
  whole build order for 24 h).

## 5. Building (one visit = `build_shop` when the active project is the shaft)

`PROJECTS` gains `{ plot: 'shaft', blueprint: 'shaft@2', after: SHOP_PLOT, builders: 1 }`, placed right after the
workshop (r2: before the house, or only the third free bot reaches it): one bot takes the slot, the rest go on to the next
open project (activeProject's `free`). Its own branches: buildShop's dispatch (the generic visit would fill `air` cells),
the footprint (exact cells), the damage test, paths' destination (the collar exit). Switch: `SHAFT=on|off`,
`SHAFT_POOLS` (default every pool, like zigfleet's `MONUMENT_POOLS`).

The visit (pure planner `shaftNext(read, rec)` + effects from `buildbot.mjs`):
1. **Resume from the world.** Scan steps from 0: the first step that is not done (air open, tread good, its lining good)
   is the work point. A finished step above it that reads damaged is the work point first (repairs are the same code).
2. **Walk** to the stand of step k-1 with the walk profile (no digs, no scaffold). Every step above it is verified, so
   the route exists.
3. **Survey step k:** its 3 air cells, its tread, their lining. A liquid in an air or tread cell STOPS the shaft above
   it: the stop's generation truncates the record's cells and landings to the steps above (r2, Claude B2: otherwise the
   planned rock below reads as damage forever), and the stair is complete. An unknown read ends the visit (retry). A
   liquid in a lining cell is sealed first.
4. **Line first:** every lining cell that is not a good solid (shaft-01's `goodSolid`: a full cube, not liquid, a falling
   block only on solid support) gets cobblestone (or cobbled deepslate, stone, any full solid in the bag but dirt and
   gravel), placed by the server-acknowledged click (`botBuildEffects.send/waitAck`) and read back. An unsupported
   falling block is dug first. A placement with no support face stops the visit (`no_support`).
5. **Tread:** not a good non-falling solid -> dug if solid, then cobble placed.
6. **Dig the three air cells top down**, each dig server-witnessed (`botBuildEffects.dig`). Never the cell the bot stands
   on, never its tread.
7. **Step down** onto step k (walk). Every 8 steps, a wall torch on the pillar if the bag has one (never required).
8. At a landing, the stub v=3..6 the same way (line, floor, dig), then publish `landings_built` (a record generation).
9. **Bounds:** at most 12 steps or 6 minutes a visit; stop early when the pickaxe has fewer than 20 uses, the bag fewer
   than 8 lining blocks, or the slot lease is lost. **Every visit ends with the walk back up to the surface** (the stair
   it just verified), so the builder never stays underground.
10. Complete (all steps and landings, or a stop) -> `structure_complete`. A complete stair that reads damaged is repaired
   by the next visit (repairs first, as for every project).

Refusals name what to do: `no_pickaxe` (toolkit / withdraw_pick), `no_material` (deposit/withdraw cobblestone; the
visit's own digs refill it), `no_support`, `stopped:liquid at y` (final; the stair ends above it).

## 6. Use

**Verified landings only.** `shaftUsable(rec, read)` re-reads every step from 0 to a landing (air open, tread good) before
each use: ~4 reads a step, ~200 per call. A published landing that reads broken is not used, and the repair visit is
due.

**Descent, in `mine` before the home refusal** (a walk from home to the collar digs nothing at home):
- when the bot holds a pickaxe, has not failed this landing's walk in the last 10 min, `goalY <= y - 8` (a real descent, not the 74% step-sized calls from the surface), the bot is within 64
  (Chebyshev, horizontal) of the stair, and a usable landing lies at least 4 below it;
- the landing L = the deepest usable landing with y_L >= goalY, else the deepest usable landing;
- walk to the stub's end stand (walk profile, GoalBlock, 90 s); on arrival: `goalY >= y_L - 1` -> success ("reached the
  town stair's landing at y=..."), else mine on from there with today's code (the stair's own cells are mine's keep-out,
  so the new stair bears outward from the stub end);
- any failure (no path, timeout, off-route arrival) -> today's `mine`, unchanged (home refusal included). No new
  refusal.

**Ascent, in `surface`, before its `already_surfaced` return** (r2: Codex, so a stair whose collar is above sea level
serves bots at 63-70; Claude, so a bot on a hill is never walked over): when the bot is ROOFED (a solid block in its
column between its head and g+2), below g - 6, within 64 of the stair, and the walk planner (walk profile; the search's
slices iterated within 4 s) finds a path to the collar exit (a standable surface cell beside the 5x5, chosen at siting),
walk it (120 s). Any failure -> today's climb.

**Exit contract unchanged** (no credit for the stair in this slice; both engines). **Prompt:** one static line in the
system prompt's shared prefix: iron is most common near y=16; when the town has a mineshaft, `mine 16` walks down its
stairs (no digging).

Rows: `_shaft_use` (dir, landing, ok/why, ms, digs avoided estimate), `_shaft` (sited, step, landing, stop, repair,
damaged, visit end with reason).

## 7. Protection

- **Target digs** (mine, gather): the record's cells join gather's target exclusion (`shopCellsNow().cells`), and mine's
  composed keep-out gets the stair as ITS OWN part (kind `stair`, a bounding-box early-out, numeric keys; r2: folding it
  into shopKeepOut would lower that part's `bottom` to ~15 for the whole town and make every stair simulation run deep).
- **Transit digs and placements** (walk, gather profiles): the footprint price on the exact cells, no halo (like the
  wall): never broken by a walk, never a walk's scaffold inside the stair.
- **Survival digs** (escape profiles) are NOT refused. Survival comes first; a bot inside the stair has a walking way out
  and rarely trips an escape (a 3-high stair is not entombed by the probe in mineshaft-safety 4.1). Damage is repaired by
  the next visit (repairs come first), and the use re-verifies the route before every descent, so a broken stair is never
  walked from a verified start (the guarantee is admission to a route verified when the walk starts, not that nothing
  breaks it mid-walk: Codex r1). No new refusal, so no new dead end. `surface`'s own ascent profile also drops the
  footprint, so a climb from a tunnel near a stub may break lining; the `_shaft` damaged rows name the cells so the read
  can tell the two apart.
  - Codex's design asked for final mutation checks and a `use_stair` rung (mineshaft-safety F6 style). Converged: not in
    this slice, because the refusal chain is the part four review rounds of F6 kept finding dead ends in; the repair plus
    route verification bounds the harm to "the stair is shut until mended". The canary measures it (`_shaft` damaged
    rows: how often, which cells). If it is common, `use_stair` is the next piece.
- **Switch off:** `SHAFT=off` stops building and the use; the record stays a project record, so its cells stay protected.

## 8. Traffic

Bots do not collide with each other (prismarine-physics has no entity collision; Paper does not push players), so two
bots pass on the stair. No reservations or passing bays. The Paper scene runs two bots in opposite directions to prove it.

## 9. Canary

- Entry `shaft-02` right after `zigfleet-01`; variants on both zigfleet outcomes (and on its bases if feasible). shaft-01
  stays queued (cancelling needs the owner); it is HELD behind the cancelled monument-01 and cannot launch.
- Generic read at +90 / +180, plus this change's defect lines: deaths inside the stair's box, `_shaft` stuck/no_support
  loops, a hop that keeps failing on one landing, damage rows.
- Exposure: every shared pool sites a stair at its first build visit; one builder, ~3-6 min a visit for 12 steps, so the
  y=48 landing (step ~K-32 = ~23) needs ~2 visits and y=16 ~5-6 visits plus stubs. Use exposure needs the first landing
  by about +90. At today's rates 10 bots make ~62 mine calls by +90 and ~123 by +180; the eligible share is the read's
  number. Iron within 3 h (~8 items for 10 bots) is too few to judge: likely "KEEP, goal unverified" on iron, with the
  structure and the trips visible.
- Snapshot before deploy (the stair is a world change that a rollback does not undo; an unfinished stair is safe as it
  stands: every finished step is walkable and lined).

## 10. Reuse from shaft-01

Kept (ported): `toWorld`/`toLocal`, `goodSolid`/wet/falling predicates, survey-before-open and line-before-dig, the
witnessed dig, the "stop above liquid" rule, collar-on-the-surface rule, the M0 survey idea. Dropped: ladders, facings,
the cap, the room, the reflex hold, the bot.dig chokepoint, the structures/monumentjob records, the 12 M0 fixed sites
(the town plan's sector replaces them).
