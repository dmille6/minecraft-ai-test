# siteprep-01: the groundskeeper prepares a plot when a project finds no site (design, 2026-11-04)

**Owner (11-04, ledger `siteprep-1104`):** "can we use the groundskeeper bots to clear land and repurpose land so we can build on
it?" and "i have no problem with bots filling in water if it must, as a last resort". Implementation is under the owner's overnight
grant.

**Status:** designed (Claude subagent and Codex, each from the same brief without seeing the other's, reconciled here), then built
as a SHOWCASE piece on branch `siteprep-01` (code final cc3d148d, both engines APPROVE) on the live showcase release `4e559e0b` (cropfarm-02fix on sinkfix-02 `c39a1128`). The
branch was cut after `4e559e0b` was activated 11-04 08:13Z, so it stages onto the live release. Not released, not queued, nothing
deployed. Tier 2 (`protected.py`: no protected file touched).

## 0. What prep can fix, and what it cannot (both engines)

A prep changes terrain. It never changes a reservation. Each requester refusal is classed first (`prepClass`):

| class | requester refusals | prep? |
|---|---|---|
| `earth` | sinks `fill_deep`, `cut_deep`, `apron_low`, `apron_high`, `fill_share`, `cut_max`, `level`, `proof_no_step`; ziggurat `fill`, `cut`, `approach_too_deep`; buildsite `fill_too_deep`, `cut_too_high`, `earthwork`, `no_step`, `interior_unreachable` | yes: grade the plot |
| `water` | `liquid`, `base_liquid`, `apron_liquid`, `start_liquid` | only after every dry tier (the owner's last resort) |
| `reach` | `proof_unreachable` | yes, when the requester's own proof on the graded plot passes (offline: a sunken pad's approach is the common cause); ramps from afar: slice 3 |
| `hard` | `reserved:*`, `avoid:*`, `zone`, `plan_*`, `well`, `furniture`, `built`, `tree*`, `unknown`, `unread`, `bill`, `unfunded`, `too_high` | never: preserved; another candidate or another project |

Consequences named before building:

- **board-a's 190 corners refused for `furniture` are `hard`.** Prep never demolishes a chest or a station (Codex: "not permission to
  demolish"). If those blocks are bot litter, that is a separate litter-clear fix, read first.
- **Shrine `reserved:*` rejects** (marker, paths, monument) are `hard`.
- **Roads are linear**, not a plot: the land plan's roads stage and bridgepost-01 own them. The showcase road's `s2:start_liquid`
  and `s1:proof_unreachable` are slice 3 (water + access), not slice 1.
- **What slice 1 fixes on the showcase today** (live rows 07:20-08:30Z): tower T2's `fill_deep56`, `apron_low65`, the rejects
  that ended 30 of 30 sink `no_site` rows since 03:30Z together with the road's. 4 instances sited in that window, 361 picks.

## 1. The request

One town record chain, `project-<home>.siteprep` (plot `siteprep`, blueprint `siteprep@1`), written only by `publishRecord`
(compare-and-set on the generation: the serialised registry Codex asked for). It holds `requests[]`:

```
{ id: 'SP3', requester: { plot: 'tower', kind: 'tower', n: 2, by }, state, filedAt, expiresAt,
  rejects: { fill_deep: 56, apron_low: 65, ... },            // the requester's own tally (siteSink `rejects`)
  plot: null | { cx, cz, B, corner: [x, z], L, box: [x0, z0, x1, z1], tier, slot?, pair?, seed,
                 earth: { cut, fill, seal, dam, water }, approach: [[x, y, z]] },
  zone: null | { box: [x0, -64, z0, x1, 320, z1], why: 'siteprep:SP3:tower', for: 'tower', id: 'SP3' },
  verifyFails: 0, handFails: 0, why, at }
```

- **Footprint, floor, entrance, stands, route:** the requester's own design at the plot (`B`, the stair face toward home, the
  approach stands `approachOf`), the floor `L` (ground top; layer 0 at `L+1` -- never confused with buildsite's `s` or the
  monument's `baseY`), the stands = the requester's apron ring at feet `L+1`, the route = the requester's own proof (`proveBuild`
  stage 1: the town walk reaches an approach stand).
- **Max earthwork:** `PREP.colMax` 6 a column, `PREP.cutMax` 200, `PREP.fillMax` 400 a plot (fills + seals + dams), the blend 5.
  Measured, not guessed: on the showcase copy (11-04 08:58Z) blend 3 / column 4 graded no shrine slot (the ground beside the
  pinned square steps 6-7: `infeasible`), blend 5 / column 6 prepared Z2.
- **States:** `filed -> prepping -> prepared -> handed`; terminals `refused`, `expired`, `abandoned`. `prepStep(req, event, now)` is
  the whole table; every state has a terminal (tested).
- **Filing** (`prepFileDecision`): the requester's switch is on, its kind is a slice kind (tower, shrine), the picker WANTS it (the
  `no_site` happens only after `sinkNextGate` said want), `prepWorthy(rejects)` (at least one `earth`/`water` reject), and no live
  request of that kind, and none of that kind refused/abandoned within `PREP.refileMs` (24 h).
- **Lease:** one ACTIVE request a town (`PREP.activeMax` 1; Codex: "one active prep per town"), FIFO by `filedAt`. The keeper lease
  (30 min, 4 h term) is the worker; a replacement keeper resumes from the record.
- **Expiry:** `filed` or `prepping` past `expiresAt` (filed + 48 h) -> `expired`; `prepared` not handed within `PREP.readyMs` (6 h)
  -> `expired`. A revisit never extends either (Codex).

## 2. The candidates

`prepCandidates` enumerates the REQUESTER's own candidates (`towerCandidates`: corners, gates, sides, the sweep outside the wall;
`shrineSlots`: the free slots round the ziggurat), never a new domain, plus offsets within 2 and the design's base and the next two
smaller (5/7/9 for towers, 7..13 for shrines). Each is screened cheaply first (`prepEstimate`): the reservation guard over base +
apron + 1 (any reason: `hard`, skipped), then the column grounds and the least `fill + 2*cut` over the pinned square with every
column within `colMax`. The tiers, the first with an accepted plot winning:

1. **same**: the requester's first unrefused spot, its own B (rotation: a stepped sink is square and its stair faces home, so the
   one rotation it has is fixed -- rotation is a tier for the rectangular buildsite requesters, slice 2, whose own search already
   tries all four orientations before it files);
2. **smaller**: the same spot, a smaller B;
3. **other_dry**: every other spot, any B;
4. **water**: a candidate whose only extra refusal is water: every water cell a SOURCE (level 0: still), at most `PREP.waterDepth`
   2 deep, at most `PREP.waterCols` 24 columns, never within the farm guard (4 of farmland) or a well; the fewest wet columns, then
   the shallowest, then the earthwork. Off unless the reader carries the water level (planReader now reads it for water).

Inside a tier: the least `fill + 2*cut + 2*seal + dam`, then the requester's order. At most `PREP.proofs` (4) full gradings and
acceptances a call; the rest wait for the next visit with the cursor on the request (`search_pending`, never "no dry land": Codex).

**A candidate is accepted only when the requester's own screen and proof pass on the simulated after-world** (Claude and Codex
both): the work is applied as an overlay (`tidyOverlay`: cuts and leaves air, fills solid) and the requester's `siteSink`, pinned to
the candidate (`ctx.prep`), must site it. That closes "flat but inaccessible": `proveBuild` already requires the town walk to reach
an approach stand and every cell a stand and a sight line.

## 3. The prep: a recorded groundskeeper stage, the terrace's grading

`prepGrade` runs `gradeTerraces` (terrace.mjs) over the plot's box + `PREP.blend` (5) with one new option, **`pin`** (Map
`"x,z" -> L | [lo, hi]`): the base and its ground stair exactly `L`, the apron within `[L-1, L+1]` (what the requester takes), the
pad ring free. The 1-Lipschitz solve then ramps the blend ring onto the
untouched ground, and the terrace's own rules come with it: cave pockets <= 3 sealed (`opener`), the 11-01 water rule (dams before
a cut beside water, never a cut under water), `avoid` (every refusal), the farm guard, `step_worse`. A pinned column the solve
keeps (refused, infeasible, wet, `seal_deep`) fails the candidate (`pin_<why>`): never silently kept. The never-worse walk guard
is the terrace's: `terraceWalk` over the box + 8 from the town edge, before and after; walk-and-back must not fall, stuck-prone
must not rise.

`withPrep(tidyRec, req, work)` (the storehouse floor fix's pattern) appends the work to the HEAD tidy record as a new generation:
fills in layered segments `SP3-ll-k` (bottom first), buried fills `core` (cobblestone first, `coreFills`), the top `earth` (dirt
first), dams in `SP3-D` (first), seals in `SP3-S` (with `opener`), cuts with `prep: 'SP3'`, leaves in head room as clears. It never
replaces the stage generation (the stage's own cells stay; `stageCarry` carries the prep cells on later). While any prep cell or
cut is open, the keeper's visit works ONLY the prep (`prepOnly`, as `floorOnly` works only the floor): a plot is finished in a few
visits, never interleaved with a 900-cell terrace.

**Never on another stage's open work:** the tidy record's open cells and cuts are refusals of the grading (Claude's `stage_busy`).

## 4. The hand-over

- **Verify** (`prepVerifyDecision`): when no prep cell or cut of the request is open, the keeper runs the requester's acceptance on
  the REAL world (fresh reads) at the chosen candidate. Pass: `prepared`. Fail: once more `filed` with the world as it is
  (`verifyFails <= 1`, re-graded), then `abandoned:verify`. A waived prep cell is fine only if the requester's proof still passes:
  no waiver can satisfy a prep (Codex), the proof decides.
- **The requester** (`buildSink`): a `prepared` request of its kind bypasses this bot's 6-h no-site wait and is sited FIRST with
  `ctx.prep` (the candidate, B pinned via the design's `pinB`, the slot): one spot, no search. Success publishes the instance (its
  own zone, box + 3), then marks the request `handed` with the instance id, which drops the prep zone. Both zones hold between the
  two writes (harmless). Failure: `handFails++`; at 2, back to `filed` once (re-prep) or `abandoned`.
- **The reservation:** an active request's `zone` is in `projectHeads()` (the land plan's pattern: a reservation record with zones,
  no cells), so every other siting, the terrace and the rims keep off it. Only the matching requester kind ignores its own zone
  (`prepZonesFor`); the keeper's grading of its own request ignores it too.

## 5. A finished ziggurat's successor (board-b)

board-b's ziggurat is complete and nothing follows because the sinks run on the showcase only (`SINKS_POOLS` default `showcase`).
Both engines: the successor IS the sink tier (shrines first, they belong to the ziggurat), and prep follows a successor's failure
like any other. **Siteprep alone changes nothing on board-b**; it needs the sinks on there (a fleet canary of its own). The pure
`successorDue(states)` (a complete monument + a wanted, unsited stone sink -> that sink) is built and tested for that canary; on the
showcase the sink tier already orders it.

## 6. Bots' own digging and placing

Every change is a `runVisit` dig or place by the keeper (cuts, clears) and its helpers (fills) with the town's and the bags'
cobblestone, the stock that goes down the well today. No command, no teleport, no `/give`, no world edit. Water is filled only by
placing into a still source (Baritone's rule), only in tier 4.

## 7. Telemetry and the read

Rows, kind `siteprep` (`_siteprep`): `op=filed|chosen|refused|pending|prepared|verify_fail|handed|hand_fail|expired|abandoned`,
`id`, `kind`, `tier`, `B`, `cut`, `fill`, `seal`, `dam`, `water`, `why`, `gen`. Existing rows carry the rest:

| measure | rows | never counted as |
|---|---|---|
| requests | `_siteprep op=filed`, per sink `no_site` row (the denominator) | |
| plots prepared | `op=prepared` per `op=chosen` | |
| cobble placed as fill | `_build project=tidy op=place seg=SP*` with `block=cobblestone` | building done |
| requester sited after prep | `_sink op=sited` with `prep=SP3`, and `op=handed` | |
| building done | the instance's own `_build project=tower|shrine op=place` and its `_build_visit outcome=complete` | picks, pads |

Positive controls before any zero: total rows, bots and the time span; `_sink op=pick` and `op=no_site` in the same window (the
neighbouring kinds); the tidy's own `op=place` rows.

**Showcase (one town, no control):** a mechanism read at +60 min and +2 h: the chain request -> chosen -> prepared -> handed ->
the instance's placements, end to end, non-zero; H1-H6 0 for project=tidy (the prep placements are on the head record); deaths
(the showcase tripwire), `stuck_on_cell`, in-town walk failures against the 2 h before.

**Fleet (later, its own canary, together with SINKS on):** difference-in-differences, never canary-vs-fleet: 4-5 pools drawn
arbitrarily from the towns whose rejects are `earth`/`water` (the pool must contain the target: board-c, hive-c, placebo-d once
their ziggurat rejects are counted; board-a is `hard`), the rest control, equal 24-h windows before and after. Primary: non-tidy
build placements per bot-hour. Secondary: the well's share of new cobble. Tripwires: deaths (the two-death floor), walk failures.

## 8. Expected cobble absorbed

Measured: ~140 new cobble an hour a town (resource model, 11-02) = **~3,360 a day**; builds placed 10.5% (~350), the well 61%.

On the showcase a sited instance is built within about an hour (T1 211 cells 05:20-06:24Z, Z1 95 cells 06:18-07:19Z, the live rows),
so siting is the binding limit, not placement. One prepared plot unlocks one instance:

- **the prep fill:** a B5-B9 tower plot is 11-15 columns square pinned (121-225 columns) plus the blend; at the live rejects' depths
  (holes of 3+ under the base, an apron 3+ low) the offline grade below is the number; the design estimate is 60-160 fill cells, about
  two thirds buried `core` cobblestone;
- **the unlocked instance:** a tower 80-300 cells, a shrine 95-400 (`billMax` 512), mostly cobblestone and stone the bags carry.

At one prepared plot in flight a town (`activeMax` 1) and 2-4 plots a day (a keeper visit every ~2 min; the prep visits work only
the prep), **~300-1,400 cobble a day a town**: 9-40% of new cobble, against 10.5% today. Uncertain: the keeper's placement rate on
prep (unmeasured), and the sinks' own caps (`instancesMax` tower 8, shrine 6; `maxOpen` 2) bound the total: ~8 towers + 6 shrines
= ~3,000-4,000 cells a town, about 3-12 days of this rate, after which roads (slice 3) and new kinds must take over. Codex's
estimate, from a different model: ~460 net a town a day (2 plots x (96 fill + 160 building)), ~14%.

## 9. The engines' disagreements and how they were settled

| point | Claude | Codex | settled |
|---|---|---|---|
| Waivers on prep cells | the requester's tolerances absorb a waived cell; verify re-runs the proof | "no waiver may satisfy a required prep cell" | the waiver machinery stays (a stuck cell must not hold the keeper), but acceptance is ONLY the requester's own proof on the real world; a failed verify re-preps once, then abandons. No waiver can complete a prep |
| Reservation | the siteprep record's zones appended in `projectHeads` | a town reservation registry under a common lease with generation checks | the siteprep record IS that registry: one record chain, `publishRecord` CAS on its generation; its zones in `projectHeads` like the land plan's |
| Access proof | the requester's proof on the after-world + the never-worse walk | operation-by-operation access over intermediate terrain | not built: the requester's proof decides acceptance, the plot is never on a corridor or path (refused), and the prep visit's own runVisit finds a stand per cell (deferring a cell it cannot reach). Named as a residual risk |
| Limits | 320 tower / 1,500 ziggurat, 4 a column | slice: B5 only, cut <= 24, fill <= 48, column <= 2 | a column 4 (the terrace's proven limit; the live rejects ARE 3+ deep holes, so 2 fixes nothing), cut 160, fill 240 a plot, every B of the design down to 5 |
| Monument | prep inside the monument box (slice 2) | keep `monumentBox`; relocation needs an explicit generation-checked replacement; add a construction-proof adapter (siteZiggurat scores, it does not prove) | Codex's: slice 2 adds the proof adapter first; no relocation without an owner decision |
| Search exhaustion | refused when no candidate accepted | a CPU/proof allowance spent is `search_pending`, never "no dry land" | Codex's: the cursor on the request |
| Successor | `successorDue`; board-b needs the sinks on | `successorDemand`, startup reconcile | both: pure function built; fleet use rides the sinks' own fleet canary |
| Water stillness | `planReader` lacks the level: tier 4 stays off without it | `waterColumn` does not prove stillness | planReader reads the water `level`; a cell without it is not still (tier 4 refuses) |

## 10. Open-source search (verified by reading the code or page unless marked)

- **Baritone's builder treats terrain inside a schematic as work, never a veto.** `BuilderProcess.assemble` splits wrong cells into
  break and place, and places a throwaway block into a still water source; flowing water is "unreplaceable" until its source is
  filled ([BuilderProcess L723-779](https://github.com/cabaletta/baritone/blob/1.21.4/src/main/java/baritone/process/BuilderProcess.java#L723)).
  The only vetoes are named settings (`buildIgnoreBlocks`, `buildSkipBlocks`, `okIfWater`, `buildValidSubstitutes`:
  [Settings L267-321](https://github.com/cabaletta/baritone/blob/1.21.4/src/api/java/baritone/api/Settings.java#L267)). `#sel cleararea`
  is the builder with an all-air schematic ([L249-254](https://github.com/cabaletta/baritone/blob/1.21.4/src/main/java/baritone/process/BuilderProcess.java#L249)).
  Issues: a flatten command was asked for and never built ([#1408](https://github.com/cabaletta/baritone/issues/1408)); cleararea
  digs a hole to the bottom first ([#404](https://github.com/cabaletta/baritone/issues/404), [#728](https://github.com/cabaletta/baritone/issues/728)).
  **Taken:** fill water by placing into still sources only; cut top-down a column at a time (tidy `chainCuts`); the requester's
  proof is the acceptance, with named tolerances.
- **mineflayer-builder** diffs world against schematic but only acts on placements, needs creative mode and drops failed actions
  ([lib/Build.js](https://github.com/PrismarineJS/mineflayer-builder/blob/master/lib/Build.js), [index.js](https://github.com/PrismarineJS/mineflayer-builder/blob/master/index.js)).
  **Taken:** nothing reusable; outcomes are re-read (verify), never assumed.
- **Mindcraft:** `placeBlock` breaks what occupies the target ([skills.js](https://github.com/kolbytn/mindcraft/blob/main/src/agent/library/skills.js));
  `getNearestFreeSpace` has a check that is always false and retries smaller sizes until something matches
  ([world.js L5-35](https://github.com/mindcraft-bots/mindcraft/blob/develop/src/agent/library/world.js#L5)); builders retry one
  block forever ([#858](https://github.com/mindcraft-bots/mindcraft/issues/858)). **Taken:** the site proof checks the whole
  footprint with a positive control; bounded retries (`verifyFails`, `handFails`).
- **MineColonies** builds in fixed stages, CLEAR (top-down) -> BUILD_SOLID -> WEAK_SOLID -> CLEAR_WATER -> CLEAR_NON_SOLIDS -> DECORATE,
  solid placeholders filled with a configurable fill block ([AbstractEntityAIStructure L711-718, L1085](https://github.com/ldtteam/minecolonies/blob/version/main/src/main/java/com/minecolonies/core/entity/ai/workers/AbstractEntityAIStructure.java#L711)).
  **Taken:** dams first, then cuts, then layered solid fills, core cobblestone / dirt top.
- **GDMC settlement generators:** HSTEHSTEHSTE's GDMC 2022 sums a per-cell cost `|h - level| + 10000*occupied + 100*water` over every
  footprint by convolution and takes the cheapest ([utils.py pick_plot](https://github.com/HSTEHSTEHSTE/GDMC_2022/blob/main/utils.py)),
  but its `clear_plot` lays three cobble layers under the level and floats; the 2022 winner (van der Staaij et al.,
  [arXiv 2309.10871](https://arxiv.org/abs/2309.10871)) starts at the flattest spot with a per-plot slope limit and was criticised for
  floating platforms; Niels-NTG's GDMC 2023 prices support pillars into the build cost ([README](https://github.com/Niels-NTG/GDMC2023)).
  **Taken:** rank by cut + fill with water priced last; fill every column down to its own ground (never a fixed-depth slab).
- **MillMix** (a Millénaire fork) caps a site's terrain height difference before placing ([page](https://www.curseforge.com/minecraft/mc-mods/millmix-remixined)).
  **Taken:** `colMax` 4 a column.
- No open-source mineflayer, Baritone or Mindcraft bot has a separate site-prep job; MineColonies' builder and Dwarf Fortress's
  designated removal job ([wiki](https://www.dwarffortresswiki.org/index.php/Remove)) are the nearest prior art.

## 11. Pure decisions vs wiring

**Pure** (`bots/src/siteprep.mjs`): `siteprepOn`, `prepClass`, `prepWorthy`, `prepFileDecision`, `siteRequest`, `prepStep`,
`prepExpire`, `prepActive`, `prepEstimate`, `prepCandidates`, `prepGrade`, `prepChoose`, `withPrep`, `prepOpen`,
`prepVerifyDecision`, `prepZones`, `prepReservation`, `successorDue`, `prepRowDetail`. Edits to pure code: `gradeTerraces` `pin`;
`siteSink` `ctx.prep` + `rejects`; `towerDesign`/`shrineDesign` `pinB`.

**Wiring** (`skills.mjs`): `buildSink` files on `no_site` and sites a `prepared` request first; `buildTidy` (the keeper) chooses,
publishes, works `prepOnly`, verifies; `projectHeads` carries the reservation; `sinkGuardFor` lets the requester ignore its own
zone; `terraceGuardNow` ignores prep zones (the prep cells are the keeper's own); `planReader` reads the water level.

## 12. Failure modes

| mode | closed by |
|---|---|
| flat but inaccessible pad | the requester's proof on the after-world at choose, and on the real world at verify |
| endless grading | `colMax`/`cutMax`/`fillMax`, one active request, `verifyFails <= 1`, `handFails <= 2`, 48-h expiry |
| a prep never used | filed only while the picker wants the kind; `prepared` bypasses the no-site wait and is sited first; 6-h claim deadline |
| two requests for one plot | one active request a town; the zone is a reservation for everyone else; CAS publish |
| prep vs the terrace stage | the stage's open work is refused at choose; the prep is appended, never replacing; `prepOnly` |
| prep cuts the town off | never on a corridor, a path or a plan cell (`avoid`); the never-worse walk guard |
| water | tier 4 only; sources only, <= 2 deep, <= 24 columns; dams; never the farm or a well |
| the world changes before hand-over | verify on the real world; re-prep once |
| composed refusals | the chain test: `no_site` -> filed -> chosen -> keeper `runVisit` -> verify -> pinned siting -> sited; every dead end returns the requester to its existing retry (refused, expired, abandoned) |

## 13. Blocker reviews of this design (r1) and what changed

Both engines, blockers only, on the reconciled design: **both BLOCK** (Claude 3, Codex 5). All folded in before the build:

| blocker | engine | fix (built) |
|---|---|---|
| an ordinary search of the kind ignored the prep zone, so another builder could site on a half-graded plot | Claude 1, Codex 1 | only the ONE request id is exempt (`prepZones(rec, except)`, `sinkGuardFor` `prepExcept`): the pinned claim and the keeper's own grading/verify; every other search keeps off |
| a builder that screened before the zone appeared could publish after it | Codex 1 | the zone is published FIRST, then `prepOverlap` re-reads every other record and retires the request before any work; re-checked at every keeper visit while prepping (detection + retirement; a shared town siting lease is the stronger form, named, not built) |
| the zone had no margin: a project 1-3 columns off would block the hand-over | Claude 2 | the zone is the graded box + `PROJECT_GAP` |
| a dead request's work stayed open on the tidy record (the keeper works an unreserved plot, half-cut) | Claude 3, Codex 3 | `retirePrep` (before the reservation is released): standing cuts and unlaid fills leave the record; a seal under a dug cut and a dam beside one stay; `prepNow` holds only while prepping |
| the dress siting read only the land reservation | Codex 2 | `dressReservedFor` reads the siteprep reservation too |
| the walk box could exclude the town: zero before and after "passed" | Codex 4 | the walk box spans the town edge and the graded box; an empty baseline is refused (`walk_unproven`); the after-walk must keep every column of the before-walk's walked-and-back SET, and stuck-prone must not rise |
| cuts column-first can dig a shaft mid-way | Codex 5 | `prepCutOrder`: the highest layer across the plot first (Baritone #404/#728); per-operation escape proofs are not built (the terrace stage has the same exposure, live since 11-03) |

## 14. The build, its code reviews, tests and the offline proof

**Branch `siteprep-01`** on the live showcase release `4e559e0b`: f45ba8e9 (the build), then six blocker rounds, code final at
**cc3d148d** (both engines APPROVE). Code: `bots/src/siteprep.mjs` (new, pure), `terrace.mjs` (`pin`, `backSet`), `sinks.mjs`
(`ctx.prep`, `rejects`, `pinB`), `skills.mjs` (wiring), `bots/scripts/siteprep-offline.mjs`, `bots/test/siteprep.test.mjs`.

| round | Claude | Codex | fixed in |
|---|---|---|---|
| code r1 (f45ba8e9) | BLOCK: on a terrace-stage record the completion's `given` counted standing prep cuts as done (the prep's own zone) | BLOCK: the same; a failed retirement still released the zone; a re-prep could not install its work | 3cb7d815 (`!cutAt.get(k)?.prep`, `prepHold`, `retire()` result, `prepAttempt`) |
| r2 | BLOCK: `prepHold` pinned the keeper on cuts it had given up, to the 48-h expiry | APPROVE | 884e5a1a (`prepHoldOf`: 'stuck' -> retire) |
| r3 | BLOCK: a seal under a given-up cut kept it at 'work' | APPROVE | 59c5c6d9 |
| r4 | BLOCK: a seal whose opener greened (dirt -> grass) did too | APPROVE | 152cf986 (the stall backstop: 3 prep visits that moved nothing -> stuck) |
| r5 | BLOCK: the stall counted only the keeper's placements (helpers filling looked idle) | BLOCK: the selection used transient guards the tick did not | c9efb2d2 (`prepStallNext`; one open-work predicate) |
| r6 | APPROVE (note: a rising-and-falling count) | BLOCK: the count read the open work before the visit | cc3d148d (a fresh read after the visit, `prepStallsNow`, only a new low resets) |
| r7 | **APPROVE** | **APPROVE** | |

Residual, named (non-blocking, Claude r7): a visit's `moved` (placements + clears) still resets the stall count, and runVisit's
moves include access pillars and foreign clears; a visit that re-clears something that keeps returning (snow) would hold a stuck
prep to its 48-h expiry. Bounded by the expiry; the fix is to count only the prep's own open work falling.

**Tests** (`bots/test/siteprep.test.mjs`, 33/33): the switch, the classes, filing, the state table (every live state reaches a
terminal), expiry, the reservation (margin, the one exempt id), the pinned grading (exact at L, 1-Lipschitz, a pin in a refusal
fails), the walk guard (an empty baseline refused, a lost column refused), the tiers (water last, flowing and deep water never),
THE CHAIN on the fake world (the requester refuses; the keeper chooses tier `same`; the keeper's own `runVisit` lays the plot on the
fake server; the requester's pinned siting accepts the real world; the same pinned siting on the untouched world refuses: the
positive control), the tidy-record work and its retirement, the hold and the stall count, the hand-over helpers, `successorDue`,
the wiring (structural, comments stripped). 12 anchored mutants (each anchor asserted present and unique, imported with a
`?${Date.now()}_${Math.random()}` URL), all killed. Structural anchors in sinks / terrace / groundskeeper follow the changed lines
(35 / 47 / 40 pass). eslint clean.

**Full suite** (`scripts/host/suite-run.py` from origin/main, ci2, `--ref cc3d148d`): **406/409**, wall 719 s. The three failures are
the known no-`.git` set of every copied tree (`ceilescape`, `nothing-important-is-orphaned`, `protected-paths`), the same three the
base's own PIECES line (4e559e0b, 405/408) records.

**Offline on the showcase** (region copy + pool records, 11-04 08:58Z; `node bots/scripts/siteprep-offline.mjs <dump> <pool> --pool
showcase --kinds shrine,tower --count 2 --avail '{"stone_bricks":200}' --torch`):

| round | requester | prep | result |
|---|---|---|---|
| shrine n=2 | no_site (`apron_low` 376, `reserved:*`) | 297 candidates, 76 ranked, 10 calls of <= 4 gradings; tier `other_dry`, B7 at -69,68,-28: cut 50, fill 122, seal 18; **control: the pinned siting on the untouched ground refuses** | handed: **Z2 sited, 63 cells** |
| tower n=3, 4 | sited without prep (T3 281 cells, T4 84) | - | - |
| shrine n=3 | no_site | refused (`pin_kept` 48, `pin_not_free` 9, `cut_over` 1) | none: the remaining slots' ground steps more than a 6-column grading can ramp |

So on the showcase today prep unlocks one shrine (Z2) that nothing else would site; the towers do not need it (their live failure
since 07:20Z is `unfunded`). A choose costs 0.1-0.2 s a call on the Mac (1.7 s for 10 calls).

**No Paper sandbox run.** The sandboxes exist (`sandbox/sandboxes.json`, sbxlock), but a Paper driver for the chain (the keeper's
runVisit grading a carved plot with a real mineflayer bot, then the requester siting) is not written; the proof here is the fake
server + the region copy. The water tier is proven only on the pure estimate (no live still-water fill).

## 15. Slices

1. **This branch (showcase):** towers and shrines, tiers same/smaller/other_dry/water, the keeper's prep, the hand-over, rows.
2. Ziggurat (with Codex's construction-proof adapter, inside `monumentBox`), the buildsite requesters (workshop, house, yard, crop
   farm: rotation as a tier), then a fleet canary together with SINKS on for board-b's successor.
3. Access ramps (`reach`) and roads (`start_liquid`).
