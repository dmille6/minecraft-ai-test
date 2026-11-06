# shaftpath-1106: the common mineshaft and the town paths (projectaudit 11-06)

The daily project audit (projectaudit-01, main 6fc0301c; report `~/digest/projectaudit/fleet-2026-11-06.md` on the canary host)
found two fleet-wide failures over 7 days. The town stair is **UNDERUSED** in 13 of the 14 towns with a finished stair, because
most attempts fail. The town paths are **unsited** in 13 of 14 towns: `state=no_site`, `structure_complete=true`, 0 cells. They
look finished but nothing was laid. Only board-b has a path, about 282 bot-minutes a day walked.

There are two fleet pieces, both built on the live fleet sha 47b8342d (decbundle-01):

| piece | tier | branch / sha | rollback |
|---|---|---|---|
| **stairuse-01**: the stair's way down | **3** (protected: `skills.mjs::stairDescend`, `stairDescendSteps`) | `stairuse-01-on-47b8342` 48b40493 | `STAIRUSE=off` |
| **pathsfix-01**: paths in sections, with their own earthwork | 2 (not protected) | `pathsfix-01-on-47b8342` f733b368 | `PATHSFIX=off` |
| goalwatch: an unsited record is no open goal | tooling (main) | this commit | revert |

Measurement scripts, Codex's design and reviews, the Paper results, the registrations and the draft queue entries are in
[`shaftpath-2026-11-06/`](shaftpath-2026-11-06/).

## 1. The stair: measured

**Fleet, 7 days.** This is a full rotation-aware walk on the canary host (`shaftmeas.py.txt`): 14,034,495 lines, 80 bots,
10-30 14:19Z to 11-06 14:21Z, 13,827 `_shaft_use` rows.

| row | n |
|---|---|
| down ok=1 arrived | 2,333 |
| down why=walk | 2,170 |
| down why=stepN:blocked | 2,373 |
| down stepN:tread / stub / unknown | 279 / 8 / 1 |
| up no_plan (the audit excludes it) | 6,282 |
| up arrived / egress / walk | 233 / 111 / 27 |

**Where each descent started.** The start comes from the row's `from` y against the stair's ground g. For a failure that did
not move, the row's `bot.pos` is the start.

- **From a mine away from the stair:** 3,702 of 7,164 descents (from < g-6, outside the stair's box + 1). `mine` calls
  `stairDescend` whenever the bot is within 64 blocks (`NEAR_STAIR`) of the pillar, at any depth. `landingUsable` checks the steps
  from the top. The walk, which may not dig, cannot leave a tunnel. In the 52 h after shafttrap-02 (11-04 10Z to 11-06 14Z) these
  starts gave **1,011 failures** (walk 859 at a median of 30 ms, blocked 107, tread 45) and next to no arrivals. Each walk failure
  also backed that landing off for 10 minutes for that bot.
- **From the surface:**

| window | attempts | arrived | blocked | walk | tread |
|---|---|---|---|---|---|
| before shafttrap-02 (10-31 14Z to 11-04 10Z) | 806 | **41.9%** | 43.9% | 10.9% | 2.7% |
| after it (11-04 10Z to 11-06 14Z) | 1,243 | **78.0%** | 7.9% | 11.6% | 2.6% |

  After shafttrap-02, the success rate by town was: board-c 24% (its stair is not complete), isolated-d 55%, board-d 66%, and
  70-94% elsewhere. Of the 144 surface `walk` failures, 115 failed in under 100 ms with no movement. In one example, a marooned
  reflex's egress (`_stair_handoff then=retry`) was moving the same bot in the same second.

So the audit's "most attempts fail" is mostly attempts that could never succeed. shafttrap-02 had already roughly doubled the
real success rate.

**The world (11-06 14:25Z).** Read-only region copies were dumped with `townplan_blockdump.py` and the bots' own plan code was
run on them (`stairscan.mjs.txt`). 11 of the 14 complete stairs read clear from top to bottom. Three have one blocked air cell at
the very bottom: hive-a step 53 (andesite), isolated-d step 54 (diorite), placebo-c step 55 (cobbled deepslate). board-c's open
stair has dripstone and stone in steps 51-52 and stub 16.

**Upkeep.** There were 2,921 shaft visits in 7 days: complete 1,633, `walk_failed` 1,001 ("did not reach the stand ... the
stair is blocked above the work"), no_support 137. `_shaft op=dig why=air` (a foreign block dug out of an air cell) counted
5,474. Of those, 2,768 were on 10-31, the build phase. After that the daily counts were 1,000, 681, 652, 156, 42 and 190: the
contamination shafttrap-02 targeted, now mostly gone.

**Causes, ranked:**

1. Descents are offered from a mine that is not connected to the stair. This is 73% of the post-shafttrap-02 failures.
2. A descent is refused outright for one foreign block in one air cell, when a descending bot could dig it from the step above.
3. Both the descent and the upkeep visit make one long walk (up to 55 steps in a single GoalBlock goto). When it fails it fails
   whole, sometimes at once. This is the 115 fast failures and the 1,001 `walk_failed`.
4. A failed approach backs the landing off for 10 minutes.

## 2. The paths: measured

- **Visits, 7 days.** There was one `_build_visit project=paths` per town, the original `paths_no_site`, in 11 towns.
  Exceptions: hive-b 4, placebo-a 3, and board-b (sited). `_build project=paths op=retry_now` appears 5 times: only a tidy
  completion ever re-sited a town.
- **Records.** placebo-b has every project complete, yet its no-site `retryAt` of 11-02 23:45Z went unused for 4 days. A due
  no-site record is only `due`, so `shop.mjs activeProject` takes it after every open project, and the tidy's 48 h re-survey or a
  monument is always open.
- **Offline, the bots' own `sitePaths` on the 11-06 region copies of all 16 towns** (`legdiag.mjs.txt`, a flood over the
  router's brush graph): 57 required legs are unrouted.
  - **30 of the 57 have no usable source brush at the destination itself.** The destination is one column: a blueprint's doorway
    approach (`frontApproach`) or the stair's collar exit (`rec.exit`). Every 2x2 brush over that column covers a column of the
    project's own record, or one that cannot be levelled. By leg: shaft 11 of 14, shop 10 of 15, house1 8 of 14, monument 1 of 5.
    These legs cannot route on any ground.
  - **The hub component is tiny.** In 8 towns the plaza edge connects to only 6-40 brushes. The core plaza is a platform with
    drops of more than 4 around it.
  - **What bounds the failed components:** cut through non-natural ground (cobblestone spoil) 8,112; brush spread over 4 (fill
    + cut) 4,999; step of 2 between brushes 2,176; `project` column 1,824; built 1,188.
  - **Required legs routed under each router variant** (out of 80):

| variant | routed |
|---|---|
| strict (fill 2, cut 2, natural ground only) | 25 |
| + the bots' spoil cuttable | 27 |
| fill / cut 4 | 35 |
| 6 | 48 |
| 8 | 67 |
| **the approach + graded rounds 4/6/8** (r0) | **70; 15 of 16 towns sited, 11 with every leg** |

  The tidy-01 grading's records left 1-4 required legs unrouted in every town except board-b, which had 0 left. That is exactly
  the one town whose paths sited (tidy complete, then retry_now, then sited, then built).

**Causes, ranked:**

1. All-or-nothing siting: one impossible leg leaves the whole town with no path.
2. A one-column front is geometrically impossible for a 2-wide brush beside its own record.
3. The plaza platforms are 5-8 high, beyond the strict router's fill/cut of 2.
4. The retry starves behind open projects.
5. The record is marked complete, so nothing flags it.

## 3. Designs

### Claude

- **Stair.**
  - Class the start (`stairEntryClass`: stair, surface or away). `away` is no attempt.
  - Check the route from the bot's own step, and do not refuse it for a blocked air cell (`landingRoute`).
  - Walk down a few stands at a time (`runStairDescent`, the mirror of the shafttrap-01 egress). Dig a foreign block in the next
    step's air, but never one holding back a liquid. Stop at a bad tread, a liquid or an unread cell.
  - The upkeep visit's long walk falls back to the same way down.
  - Hop on the reflex-safe walk (`stairWalkOwned`).
  - An approach failure backs no landing off.
- **Paths.**
  - A front's **approach**: the free columns within 2, within one of the front's ground.
  - The paths' own **graded rounds** for a leg the strict router misses: fill and cut 4, then 6, then 8, the bots' spoil
    cuttable, never beside water, joined to what is laid.
  - Siting **in sections**: the legs that route are laid, the rest are `pending` and asked again by `extendPaths`.
  - **Unsited is not complete**, but it settles the order, and its due retry is a repair.

### Codex (independent; `codex-design.txt`)

The same ranking for both. The details:

- **Stair.**
  - `stairEntryClass` with a bounded connector plan for underground starts.
  - Stop poisoning `stairFails` for approach failures.
  - Bounded freshly verified hops for repair access, which `stairDescend` requests when obstructed.
  - Ownership-aware stair walking.
  - A target-level shaft-air placement exclusion for ordinary travel, behind its own switch.
- **Paths.**
  - Portals: a short, height-checked connector to the doorway or exit.
  - Sections with persisted pending destinations and a bounded, revision-sensitive backoff.
  - **Hub joins validated in 3-D**: a path below a plaza cliff is no plaza access.
  - Bounded dry-land connectors proposed by the tidy's grading.
  - `structure_complete:false` for unsited, with dependency release separated from completion.
  - Retry **fairness**: one in four eligible visits for the oldest retry.

### Reconciliation

| point | taken | why |
|---|---|---|
| underground starts | **no attempt** (Codex: a bounded connector plan) | 3,702 starts, about 0 successes; a connector plan from a tunnel costs a search each mine call for nothing measured. Mine's own digging goes on as before |
| hops + dig on the way down | **both** | the same as the egress (Paper-proven 11-03), now down |
| visit repair access | **both**: `runStairVisit` falls back to the way down | 1,001 `walk_failed` |
| ownership-aware walks | **both**: `stairWalkOwned` for the descent's hops | the egress's Codex r1 blocker-1 walk |
| shaft-air placement exclusion | **deferred** | contamination fell to 42-190 digs a day after shafttrap-02; it needs a mineflayer-pathfinder Paper proof. The next piece if `descent_dig` rows stay high |
| approach (Claude) vs portals (Codex) | **approach, height-checked**, with the approach brush at the front's ground or one below (Codex r1 blocker 2) | the same idea, on the router's own columns; the bot steps 1-2 blocks |
| hub at plaza height | **Codex's, adopted** (`hubLevelOf`) | a leg that "joins" at the foot of a 5 m drop is no path |
| earthwork | **the paths' own graded rounds** (Codex: the tidy's grading) | the tidy runs rarely (61 `blocked` placebo-b visits in a day) and its candidates left 1-4 legs. The tidy still grades for the strict router, and for pending legs |
| retry fairness | **a due unsited retry is a repair** (Codex: 1 in 4 visits) | one cheap siting per 6 h retry window: every visit re-stamps `retryAt` (paths_no_site +6 h, site_unread +1 h), so it cannot monopolise |
| unsited = not complete, settled | **both** | Codex r1 blocker 1: PATHSFIX=off also reads any no-site record settled |

## 4. Facts the design rests on (Paper / mineflayer)

**Paper sandbox3, 11-06 15:36Z.** The driver is `sandbox/stairuse/descent-e2e.mjs` on the stairuse branch, run with a real
mineflayer bot, the real `runStairDescent`, the real `stairBotEffects` dig, and the town-deposit walk. Results are in
`paper-descent-sandbox3.jsonl`. **6 of 6 scenes pass:**

| scene | result |
|---|---|
| before | the base's one walk arrives on a clean stair in 23 s; `landingUsable` refuses the route for one dirt block, `landingRoute` allows it |
| clean | 19 hops, 26 s, at the stand |
| pillared | 5 dirt blocks in air and stub cells dug by hand, at the stand, the stair as planned |
| lava | dirt with lava behind it: stops `wet`, nothing dug, no lava in the stair |
| tread | a missing tread: stops on step 19's stand |
| stair48 | from the 48 landing, 11 hops |

The single long walk works on a clean Paper stair. The fast live `walk` failures are therefore contention or obstruction, not
the walk itself. The hop descent removes the obstruction case and the halting conflict.

**Paths.** No new Paper behaviour is involved: dirt_path by shovel use, cobblestone placement and digging are what the showcase
paths-01 already builds. **Offline builds** used the bots' own `runVisit` with fake builders seeded with each town's stood cells
(`pbdbg`, a scratch copy of `pathsbuild-offline.mjs` with `--pool`). See §6.

## 5. The pieces

### stairuse-01 (tier 3), 48b40493 on 47b8342d

- **`shaftgeom.mjs`:** `stairEntryClass`, `landingRoute`, `descentNext` (never a container: `STAIR_KEEP`; the barrier rule),
  `descentDetail`, `stairUseOn`. `shaftUseDetail` adds `entry=` and `cleared=` after the old fields.
- **`shaftvisit.mjs`:** `runStairDescent`. `runStairVisit` falls back to `e.descend` and re-checks the egress reserve after it.
- **`skills.mjs`** (protected):
  - `stairDescend` calls `stairDescendSteps` when STAIRUSE is on.
  - `away` writes a `_shaft_skip` row: not an attempt, and no landing is backed off.
  - A failed approach waits 2 minutes for that bot.
  - `buildStair`'s visit gets `e.descend` (`visitDescend`, deadline minus `egressReserveMs(k)`).
- **Rows:** `_shaft op=descent`, `op=descent_dig`, `_shaft_skip`.

### pathsfix-01 (tier 2), f733b368 on 47b8342d

- **`paths.mjs`:**
  - `approachCols` and the height-checked approach with `srcLevelOk`; the well ring 4-5.
  - `routeGraded` (`PATH_GRADES` 4/6/8, `pathGradeLim`, 3 s budget); sections with `pending`.
  - `hubLevelOf`; `newDests` and `extendPaths` handle pending (`skipTo`); `pathsUnroutedDue` (6 h).
  - `pathsNoSite` writes unsited records not complete, with a 6 h retry. `pathsSettled`.
  - No clear for a replaceable plant in a record cell.
  - `routeLeg` uses numeric state keys: about 40% of a graded siting's time, and an equivalence test against the old version.
- **`skills.mjs`:**
  - `shopActive`: any no-site record is settled; a due one, with the fix on, is a repair.
  - `buildPaths`: a site_unread retry is re-stamped at 1 h; the sited row names the pending legs.
  - The extension memo is timed. The tidy pins a network that has pending legs.
- **`tidy.mjs`:** the grading's check is the paths' strict router (`grade:false`) and counts the missed legs.
- **Earthwork:** fill is cobblestone, which the towns hold in surplus. Raised paths up to 7 high are 2 wide; a fall from one
  costs about 2 hearts in a peaceful world.

### goalwatch (main)

An unsited record (`state no_site`) is no open goal. Without this, every town with unsited paths would page as a stuck goal. It
ships with pathsfix-01. The test is `scripts/host/test_goalwatch_unsited.py`, and it fails on the old code.

## 6. Tests, reviews, suites, offline

**Tests.**
- stairuse:
  - `stair-descent.test.mjs`: 24 tests on the real mineflayer-pathfinder A*, 5 anchored mutants.
  - `town-stair-wiring.test.mjs`: 25, of which 7 are new: surface, stair, away-then-surface composed, tread, approach, approach
    wait, 2 mutants.
  - `stair-egress` and `town-stair-stuck` mutant anchors were kept unique.
  - Also pass: town-stair, stair-entry, stair-handoff, stair-claim, mine-staircase, deepmine, escape-stair.
- pathsfix:
  - `pathsfix.test.mjs`: 30 tests (approach, height, graded ramp, plaza height, water, the budget, sections, pending, drained
    moat, skipTo, PATHSFIX=off, tidy, unsited, the order, the memo, equivalence, plant clears) with 6 mutants.
  - `pathsfix-runtime.test.mjs`: `shopActive` over real record files, including the rollback case, which fails on r0.
  - Updated: fleetpaths, tidy, paths-wiring, wall-wiring.
  - Also pass: paths, pathsclose, paths-build, treefarm, wall, wallstuck, shop, house, stuckproj, stuckwait, stuckcells.
- eslint is clean on both. `lint:movement` fails identically on the base (buildbot.mjs and others, pre-existing).

**Reviews.**
- stairuse:
  - Codex blockers-only: none.
  - Claude subagent: none. Its 5 notes were all taken in 48b40493 (`claude-review-stair.txt`).
- pathsfix:
  - Codex r1: 2 blockers, both fixed in f733b368: the rollback stranded an unsited record, and the approach height was measured
    against the original ground.
  - Codex r2: both fixed, none new.

**Suites.** One per piece on ci2: `pathsfix-01-f733b368`, `stairuse-01-48b40493`. Results are under §6a.

**Offline paths builds** (r1 code, 16 towns): under §6b.

## 7. Effects registered (what projectaudit measures)

- **stairuse-01:**
  - Primary: `detail.share.v1 _shaft_use:1 of _shaft_use` up at least 15% relative.
  - `detail.rate.v1 _shaft_use:1` up 10%; `_shaft_use:0` down 30%.
  - Guardrails: items per bot-hour, `_needs_rescue`, shaft upkeep visits completed.
  - In projectaudit, the `shaft` row's attempts ok/failed. `_shaft_skip` rows are the positive control that away starts are
    classified.
- **pathsfix-01:**
  - Primary: `detail.rate.v1 _build:paths:place`, absolute +0.2 per bot-hour from about 0.
  - `_build:paths:sited` up.
  - Guardrails: items per bot-hour, monument and wall placements.
  - In projectaudit, the `paths` row turns from `unsited` to cells built and bot-minutes on the path.

## 8. Queue placement (reconciled)

The current fleet order is: gkforever-01 (running) -> stations-01 -> buildfix-01 -> escdead-01 (held) -> stoneworks-01 ->
pause30-01 -> ...

- **Do not bundle the two pieces.** Claude and Codex agree. One is tier 3 and protected traversal, the other tier 2 and
  construction demand. Their populations differ (14 stairs, 13 unsited towns), as do their rollbacks.
- **stairuse-01:** P, **after buildfix-01**. This is Codex's placement, adopted. My first choice was straight after
  gkforever-01. Codex's argument is that the visit fallback should be judged on buildfix's retry, hold and wait policy, and that
  overlapping `skills.mjs` edits are rebased once. That holds, and the stair is not a survival experiment.
- **pathsfix-01:** P, **after stairuse-01**. Claude and Codex agree: reliable traversal first, then the construction demand. It
  needs buildfix's stuck and hold policy in place, since the paths' visit is a build visit.
- If an eligible S entry exists, put it between the two P slots. None is ready: escdead-01 is held.
- Both variants are keyed on 47b8342d. The control session rebases or sets the patch blocks against the predecessor that
  actually promotes. The draft queue entries carry no patch block.

## 9. Not done / next

- The shaft-air placement exclusion for ordinary travel walks, Codex's #3. It needs a Paper proof of the pathfinder's placement
  callbacks. Build it if `op=descent_dig` and `_shaft op=dig why=air` stay above about 100 a day after stairuse.
- Pending path legs that no grade routes. A shaped pedestrian connector (Codex's portal) for a doorway inside a pit, and the
  tidy's grading proposing corridors for exactly the pending legs.
- The 115 sub-100 ms surface walk failures. If they persist after stairuse, read `_shaft op=descent why=approach|hop` with the
  movement-owner rows of the same second.
