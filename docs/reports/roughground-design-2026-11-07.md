# Rough ground: what the groundskeeper misses, and the fix (roughground-01), 2026-11-07

**Owner, 11-07:** three screenshots from the showcase timelapse with rough areas circled: "will the greens keeper fill these
areas in and smooth them out?" ... "i'd like all areas like this to be smoothed out and made to look pretty", plus four
target pictures of the look wanted.

**Short answer.** For most of it, no, not with the code that is live now. The live inside-the-wall plan dates from
11-05 15:34Z. It has read "cuts 0/77, fills 0/1331" for 23 h, and its rules cannot see most of what was circled. The
new code (roughground-01) takes about a third of the circled defects in four keeper passes. The rest needs pieces 2 and 3 below.

## Before (the owner's shots, defects marked) and the target

Files are under `videos/roughground-1107/` in the checkout, which git does not track. Every marker is a mapped defect
column. Magenta: floating block or beam. Orange: one-column pillar. Yellow: raised clump. Cyan and blue: hole, one
column or wider. White: stray crafting table or furnace. The owner's red circles are kept.

- `before-shot7-marked.jpg`: the owner's first shot, a crop of `chunky/2026-11-06/project.png`.
- `before-shot8-marked.jpg`: the full `project` frame of the same day.
- `before-shot9-marked.jpg`: `chunky/2026-11-06/town.png`, with the walls, the ziggurat and the forest.
- `target-10.webp` (meadow valley), `target-11.png` (terraced island mound), `target-12.png` (cherry grove by a river),
  `target-13.webp` (flower-edged path, arch bridge, farm terraces). These show the look wanted. They are not our world.

**Which camera.** The shots come from the nightly Chunky beauty renders (`chunky_beauty.py`, `video/stills/chunky/<day>/`),
not from the BlueMap cameras. Shots 7 and 8 are the `project` view: the follow camera on the crop farm, target 14.5,69,-8.5,
distance 45, rotation 0.7854, angle 0.85, vertical fov 32, 1920x1080. Shot 9 is the `town` hero view: target -8,70,10,
distance 105, rotation 0.7854, angle 1.2, fov 32. Shot 7 is the 11-06 frame scaled by 0.835 and offset by (-85.5,-95.4).
I checked that against the trapdoors on both roofs and three crafting tables. Every circled pixel was ray-cast through
the camera model into the 11-07 07:00Z mirror copy (`timelapse/mirror/world/region`, read only), which gives each circle
a set of ground columns. The circles cover 29 areas and about 4,300 columns.

## What is there (unique columns over all circles, mirror copy 11-07 07:00Z)

| class | columns | current code takes it? |
|---|---|---|
| clump: 2 to 9 columns at least 1 over the 5x5 median | 739 | **no**. A stray must stand above ALL 8 neighbours (260 are clumps), not under leaves (63), all 8 neighbours must read as ground, and 40-50% sit in another project's box (only litter on record cells there) |
| one-column pillar | 94 | **partly**: 11 are found by a fresh survey but **not by the live record**, which dates from 11-05. The rest are under leaves (9), outside the walls (53, the band stages use the same rules), or in project boxes |
| floating block or beam (bot material with air or leaves under it, at least 2 over the ground) | 117 + 7 | **never**. The cut must be spoil all the way down to the neighbours, so the air under it reads `stray_natural` (46 skips in the live survey) |
| one-column hole | 27 | **partly**: 7 are in a fresh survey only. Holes inside paths' boxes are never filled |
| wide hole or trench (2 to 9 columns) | 120 | **never**: a hole must be below ALL 8 neighbours |
| stray crafting table or furnace | 21 on the ground + 5 on leaves or air | **never**: furniture columns are skipped, and so is every column next to one. The stations sweep (stations-01) is a fleet branch and is not on the showcase |
| ragged edge (a 4-neighbour step of 2 or more) | 969 | **no rule** (terrace stage only, once) |
| loose cobble tops in lawns | 194 | **no rule** |

The wall stroke on shot 9 (s3-WALL, 188 columns): 63 clump columns and 67 ragged-edge columns outside the wall. The
wall itself follows the ground, so its top steps, and 75 of its 280 ring columns are `gap` (the wall record's
`counts`). That is the wall project's shape, not ground the keeper can clean.

**Telemetry (showcase logs, full walk).**
- Last 24 h: 21 `_build_visit why=complete;_cuts_left_0/77,_fills_left_0/1323→1331`, 7 tidy `op=place` (all at
  11-06 08:33Z), 57 `keeper_take`, 20 `keeper_release why=no_work_visit`, **0** `stage_held` / `stage_close`.
- The positive control is the other tidy rows in the same files: park_gather 30+, sweep 6.
- Since the 06:41Z release (34 min, 8,168 rows, 13 bots): 0 tidy `_build` rows and 1 `keeper_release why=no_work_visit`.
  The only `_build` rows in that window are 12 cropfarm ones (the positive control).

**The source (`_place_town`, 24 h, town + margin).** About 2,500 placed blocks by the pathfinder (1,009 pillar, 803 step,
17 bridge), the reflex pillarOut (454 pillar, 111 step, 34 bridge), digStraightUp (60) and shaftAscend. Of the 1,418
ledgered climbs in the pool, 823 (58%) still stand. 32 of those are floating defects, 26 one-column pillars and 133
clump columns. **Under the town** the ground is a 1-block grass crust over the bots' 2-high tunnels at y 66-69 (home y 70).
From above they show as holes where the crust is gone.

## Per circled area

Area ids: s1-A..D are shot 7's four circles. s2-n and s3-n are shots 8 and 9, numbered top to bottom. s3-N, W, Z and E are
shot 9's open loops (north, west, ziggurat side, east edge). The last column is from the offline simulation below.

| area | cols | defects now (cols) | why the live code misses them (top 3) | after 4 simulated roughground passes |
|---|---|---|---|---|
| s1-A | 65 | float 2 pillar 1 clump 2 hole1 2 holeW 5 table 1 | 2+ col hole 5, in build box (project:paths): only litter on record cells 3, floating=natural 2 | pillar 2 clump 3 holeW 2 |
| s1-B | 172 | float 7 pillar 3 clump 17 holeW 5 tableF 1 | 2+ col clump 9, floating=natural 7, under leaves 5 | float 3 pillar 2 clump 9 holeW 4 tableF 1 |
| s1-C | 109 | pillar 5 clump 10 hole1 1 holeW 2 table 2 | in build box (plan_plot): only litter on record cells 8, reserved: project:dress 3, 2+ col clump 3 | pillar 2 clump 2 holeW 1 |
| s1-D | 214 | float 2 pillar 2 clump 26 hole1 1 holeW 11 | 2+ col clump 15, 2+ col hole 8, reserved: project:cropfarm 5 | pillar 2 clump 16 hole1 1 holeW 4 |
| s2-1 | 261 | float 11 pillar 5 clump 22 hole1 2 holeW 10 tableF 2 | floating=natural 11, reserved: project:shaft 10, 2+ col clump 10 | float 7 pillar 6 clump 11 hole1 1 holeW 6 tableF 2 |
| s2-2 | 18 | pillar 1 clump 3 hole1 1 | outside walls 4, stale record (fresh survey has it) 1 | pillar 2 clump 1 |
| s2-3 | 170 | float 2 clump 24 holeW 7 | 2+ col clump 14, 2+ col hole 6, outside walls 4 | pillar 1 clump 15 hole1 1 holeW 4 |
| s2-4 | 52 | float 3 clump 6 holeW 8 table 1 | 2+ col hole 8, floating=natural 3, under leaves 3 | pillar 1 clump 8 holeW 3 |
| s2-5 | 84 | float 1 clump 17 holeW 6 table 1 | reserved: project:storehouse 11, in build box (plan_plot): only litter on record cells 4, reserved: project:dress 2 | float 1 clump 13 holeW 3 table 1 |
| s2-6 | 21 | pillar 1 clump 3 | reserved: project:dress 3, in build box (plan_plot): only litter on record cells 1 | pillar 1 |
| s2-7 | 21 | clump 1 holeW 1 table 1 | avoid: well 1, 2+ col hole 1, furniture skipped 1 | clump 1 table 1 |
| s2-8 | 25 | clump 3 holeW 1 | 2+ col clump 2, in build box (plan_plot): only litter on record cells 1, 2+ col hole 1 | holeW 1 |
| s2-9 | 49 | pillar 1 clump 14 holeW 4 | in build box (project:paths): only litter on record cells 8, in build box (project): only litter on record cells 3, reserved: project:dress 2 | clump 5 holeW 5 |
| s2-10 | 12 | float 1 pillar 1 clump 1 holeW 1 table 1 | floating=natural 1, reserved: project:storehouse 1, in build box (plan_box): only litter on record cells 1 | pillar 1 clump 1 holeW 1 table 1 |
| s2-11 | 6 | float 1 table 1 | floating=natural 1, furniture skipped 1 |  |
| s2-13 | 3 | pillar 1 clump 1 | in build box (plan_plot): only litter on record cells 2 |  |
| s2-14 | 11 | clump 2 | in build box (plan_plot): only litter on record cells 2 | clump 1 |
| s3-1 | 493 | float 12 pillar 12 clump 206 hole1 3 holeW 17 | 2+ col clump 142, under leaves 33, reserved: project:monument 16 | float 7 pillar 6 clump 159 hole1 1 holeW 15 |
| s3-2 | 440 | float 9 pillar 14 clump 89 hole1 1 holeW 6 table 14 tableF 2 | 2+ col clump 22, reserved: project:hall 19, furniture skipped 16 | float 7 pillar 5 clump 47 hole1 1 holeW 10 table 4 tableF 1 |
| s3-3 | 162 | float 9 pillar 3 clump 32 holeW 3 tableF 1 | 2+ col clump 14, under leaves 11, floating=natural 9 | float 5 pillar 5 clump 16 hole1 1 holeW 6 tableF 1 |
| s3-4 | 57 | float 7 clump 14 holeW 3 | yard/treefarm box (no_litter) 11, floating=natural 7, reserved: project:treefarm 3 | float 5 clump 13 holeW 3 |
| s3-5 | 81 | float 4 pillar 2 clump 22 hole1 1 holeW 7 | outside walls 29, floating=natural (band) 3, reserved: project:hall 3 | pillar 5 clump 10 holeW 3 |
| s3-6 | 143 | float 6 pillar 4 clump 17 holeW 3 | outside walls 10, 2+ col clump 6, floating=natural 4 | float 2 pillar 3 clump 10 holeW 3 |
| s3-7 | 129 | float 4 pillar 1 clump 32 hole1 3 holeW 6 | outside walls 42, floating=natural (band) 4 | float 1 pillar 1 clump 24 hole1 1 holeW 7 |
| s3-N | 668 | float 32 pillar 27 clump 86 hole1 10 holeW 18 table 1 tableF 2 | outside walls 54, floating=natural 23, 2+ col clump 17 | float 20 pillar 20 clump 65 hole1 2 holeW 10 tableF 2 |
| s3-W | 265 | float 13 beam 5 pillar 14 clump 54 hole1 3 holeW 8 | outside walls 58, floating=natural 10, floating=natural (band) 8 | float 12 beam 6 pillar 16 clump 36 hole1 4 holeW 6 |
| s3-Z | 127 | float 12 beam 2 pillar 2 clump 22 holeW 4 | floating=natural 14, reserved: project:house1 10, reserved: project:treefarm 7 | float 13 beam 2 pillar 2 clump 17 holeW 8 |
| s3-E | 186 | float 7 pillar 8 clump 70 hole1 3 holeW 8 | outside walls 86, floating=natural (band) 7, reserved: project:shop 2 | float 4 pillar 5 clump 54 hole1 1 holeW 6 |
| s3-WALL | 188 | float 4 pillar 4 clump 63 hole1 4 holeW 3 | outside walls 74, floating=natural (band) 3, floating=natural 1 | float 1 pillar 5 clump 56 hole1 2 holeW 4 |

**When does the current code fix it?** Under the release now live (gkwork-01show), three empty keeper visits close the
stage. The ring order then moves on to the bands rim48, rim64 and rim80, and comes back inside the walls only after the
last band plus 30 min. At the 24-h rate of 17 grounds visits a day that is days away. Even then, the fresh survey takes
only 47 cuts and 110 fills inside the walls. Those are the one-column pillars and holes above.

## The fix: roughground-01 (piece 1, built, tier 2)

`bots/src/roughground.mjs` exports pure decision functions. `surveyRough` runs beside `surveyInwall` in the
inside-the-wall stage and in every outer band (`tidy.mjs roughIn`). Its cuts and fills go on the same tidy record and
are dug by the same visit code. The tripwire's `tidy_clear_ok` already admits any cell on the record chain, so no
shopread rule is needed.

What it takes:

- **Floating:** a column's spoil at least 2 over its 24-column median ground, with an open cell under it (air, leaves, a
  plant). It is cut while within 5 of the ground under it; anything higher is named `float_high`. A run that ends on a
  log or natural block is attached and kept.
- **Clumps** of up to 9 columns, cut to the highest ground round them. **Holes** of up to 9 columns in a 4x4 box, filled
  to the lowest ground round them, never with liquid in the rim. **Smooth:** a column above (or below) 6 of its 8
  neighbours and its median is taken to the median. That takes wide rough ground over repeated surveys. A hill's
  plateau and a terrace step are never taken.
- **A crust over a hollow is never cut open.** This was Codex r1's blocker: buildrun digs before it fills, and the dig's
  body check does not see a bot in the tunnel below.
- **Stations:** a loose crafting table and its spoil pillar. Never a record cell or a plan cell. Furnaces are left
  alone (contents, smelt leases).
- **Scaffold:** every ledgered climb that still stands above the ground round it is taken back, even beside a build.
  The ledger proves it is the bots' own.
- **Never:** record cells; the plan's cells and boxes; a standing build's ring (flat records such as paths, lights and
  crops protect only their own columns); zones, wells, the farm and the tree farm; the yard and tree-farm boxes;
  site-prep and marker reservations; any cell beside liquid.
- **Inside first:** before the keeper sites a band after the inside-the-wall stage, the inside is re-surveyed if it was
  last surveyed 60 min ago or more (`inwallFirst`, `stageTryOrder`). The clock rides on every record (`inwallAt`).
  This replaces the stale 11-05 plan at the next stage advance.
- **Prevention, outside movement code:** `placeaudit.mjs climbOf` now also ledgers bridges and the town's margin, and
  the keeper reads 7 days of climbs. The placing code (pathfinder, reflexes) is protected and is unchanged.
- **Rollback:** `ROUGH=off`.

**Offline proof.** This ran the bots' own `siteStage` on the mirror copy, with the live guard semantics (reserved =
site-prep + markers + the wall hold).

- Inside the walls: 47 cuts / 110 fills before, 702 / 891 after. The bands: rim48 164/334, rim64 340/379, rim80 151/230.
- Each stage takes 110-200 ms to survey.
- The independent check found 0 touches of a zone, a record cell, a well, an avoided column or a reserved column.
- Four simulated keeper passes over the circled areas (re-surveying the ground each pass left):

| class | now | after 4 passes |
|---|---|---|
| clump columns | 739 | 517 |
| one-column pillars | 94 | 75 |
| one-column holes | 27 | 13 |
| wide holes | 120 | 97 |
| floating blocks | 117 | 75 |
| stray tables | 26 | 11 |

The stage converges: the inside's work per pass goes 1593 → 564 → 211 → 99 cells.

**What it leaves, and why.**
- Blocks out of a ground stand's reach (`float_high`: 335 inside, about 600 in the bands). Most are beams in the canopy.
- Crusts over hollows (150 inside).
- Wide rough ground over 9 columns (terrace).
- Expedition markers: designed cobble posts that read as pillars (46 of the remaining pillar columns).
- Clumps in another project's ring.

**Tests and review.**
- `bots/test/roughground.test.mjs`: 16 tests. They cover behaviour through `siteStage`, the band, idempotence, the
  composed clock chain from a 40-h-old record, and the wiring, with 5 anchored mutants (floating open-cell end,
  hollow guard, plan cells, build ring, and the band and clock wiring).
- `access.test.mjs` is updated for the ledger's bridges and margin.
- Codex review: r1 found 1 blocker (the hollow, fixed in 80cf5d5c); r2 says "fixed, no new blocker".
- Full suites (ci2, git context): showcase 80cf5d5c 459/460 (the one failure is nothing-important-is-orphaned on
  bagdiet.test, an orphan already on the base); fleet 9aa9b1c1 408/410 (well.test also fails on the base 63d28320;
  craftsync is a known flake).

**Fleet.** The fleet (63d28320) has no inside-the-wall stage, terrace, outer-band cleanup or climbs ledger. Its
`surveyTidy` has the same gap: one column at least 2 above all 8, floating blocks read natural. The same module, byte
for byte, runs at the end of `surveyTidy` there, on the town square and every band. Every avoided column is refused
and the record cells' ring is kept. Branch `roughground-01-on-63d28320` @ 9aa9b1c1. Tests: 6 (3 mutants);
`tidy.test`/`gkforever.test` pin their old rules with ROUGH=off.

## Codex's independent design, and where we differ

Codex designed this without seeing mine. Its output is in the session, not committed. It agrees on: one shared
classifier for the inside and the bands; components of 1-9 columns off a 24-column median, with at least 16 samples;
cuts limited to spoil; floating detection separate from the terrain; tables recovered with their pillars; a placement
ledger as the source of cleanup work outside movement code; and an immediate re-survey of the 40-h record.

Where we differ:

1. **The rim.** Codex targets the rim median and wants a rim span of 1 or less. Mine cuts to the rim max and fills to the
   rim min, so no new step is ever made beside a neighbour. Wide, varied ground goes to smoothing and later passes.
   Codex's rule left more rough ground untouched on the measured copy.
2. **High floating blocks.** Codex builds a recorded bottom-up staircase with teardown. That is deferred to piece 1c and
   reuses plotprep's stand platforms. Piece 1 names them `float_high`.
3. **Honeycomb.** Codex has a separate stabilisation job. Agreed: piece 1b needs a fill-before-cut dependency in the record.
4. **Reservations.** Codex allows cleanup between the structures in completed wall, wallext and paths boxes. Mine
   allows it anywhere outside a standing build's footprint ring, and keeps flat records to their own column.
5. **Codex's 90 s / 32 digs / 48 places per visit.** Not adopted. The visit code's own bounds stay.

## Look target (the four pictures, as rules the bots can build)

- **Grass everywhere.** A fill's top layer is dirt next to grass (`coreFills`: cobble buried, dirt on top) so it greens
  by spreading. Loose cobble tops in lawns (194) become dirt (piece 2). Bone meal decorates grass but never turns dirt
  into grass. Large bare patches far from any grass stay a known gap until a silk-touch source exists.
- **Slopes as 1-block terrace steps with grass tops.** Never single pillars or dirt cliffs. This is the terrace stage
  (`terrace.mjs gradeTerraces`), re-run in the cycle after the inside (piece 2), on the 969 ragged-edge columns.
- **Flowers and tall grass** scattered on lawns and along path edges: decorator borders, park meadow, dress (piece 3).
- **Clean water edges.** No holes or dirt lumps within 2 of a bank: the hole and clump rules there, plus the 11-01 water
  rule's fill to the surface (piece 2).
- **Trees in clusters with clear ground under them.** The forest stands (forest-04) already do this. Roughground's
  scaffold and floating cuts clear the canopy junk.
- **An occasional landmark:** a terraced mound with one big tree (target 11), sited by the park (piece 3).
- **Kept as they are:** mountains, cliffs, waterfalls and the wall's own line. Those are worldgen or a project's
  design, not ours.

## Pieces and queue placement

- **Piece 1, roughground-01 (this):**
  - Showcase: `roughground-01show` @ 80cf5d5c on the live release d8dbd32a. Ready to stage; stage it after the
    gkwork-01show read.
  - Fleet: `roughground-01-on-63d28320` @ 9aa9b1c1. Registration and draft entry are in `~/mcai-analysis` on the canary
    host. Queue it in the P lane after gkwork-01 (both are tidy).
  - Read: `_build op=sited` kind counts, `record.inwall.rough.census` and `record.band.rough.census`, tidy placed and
    cut per keeper-hour (up), and the circled-area census re-run on a mirror copy (clump, floating and hole columns
    down).
- **Piece 1b, hollows:** fill before cut through a record dependency in buildrun's tidy visit (check its tier).
- **Piece 1c, high floating blocks:** a stand platform (plotprep `platforms`) under each high block, torn down after.
- **Piece 2, beauty:** cobble lawn tops to dirt; the terrace stage in the cycle; clean banks.
- **Piece 3, features:** flower-edged paths (decorator), a landmark mound (park), lanterns (dress). These reuse what
  exists rather than adding new systems.

Owner decisions: none needed for piece 1. Piece 1c builds temporary stone stands next to trees in the forest. That is
in line with "bots changing the world is fine".

## Pieces 1b, 1c, 2 and 3 (built 2026-11-07, coordinator's follow-up)

Each piece branches from roughground-01show 80cf5d5c, so each can ship alone. Two fleet pieces sit on
roughground-01-on-63d28320 9aa9b1c1. All are tier 2: `protected.py` says not protected for every branch.

### What each piece does and what proves it

**1b: tunnels under the crust** (`roughground-1b-show` @ 31c6d5eb)
- A crust over a hollow is now cut, and the hollow under it is filled after the cut.
- The cut carries the list of hollow cells (`hollow`). It is dug only while no body stands in them, including the
  digger's own (`hollowClear`).
- The hollow's fills name the cut that opens them (`opener`), so neither the keeper's waiver nor the stall waiver
  skips them.
- A cut held back because a body stood in the hollow does not count toward the keeper giving up on it.
- Each hollow is its own segment group.
- The old inside-the-wall stray rule used to cut such a crust open with no fill. It now hands the column to the rough
  survey (`stray_hollow`).
- **Paper (sandbox6, SCENE=hollow): PASS.** A: the crust was cut and both cells filled. B: with an armor stand in the
  hollow, the crust was kept for 4 visits; once the stand was removed, it was cut and filled.
- **Codex:** r1 found 3 blockers (fixed in 7c762349); r2 says "fixed, no new blocker".
- **Fleet:** not applicable. The fleet's tidy visit has no dig-time check (`tidyOk`), so its rough survey keeps leaving
  crusts alone, which is safe.

**1c: stands for high floating blocks** (`roughground-1c-show` @ f655a52b)
- A floating block out of reach from the ground gets a stand: a stone staircase of up to 3 steps beside its column.
  The stand is built like plotprep's (access fills, cobblestone first) and never stands on a reserved plot.
- The block is cut from the stand. `platformTeardown` takes the stand down once every target reads open.
- **Paper (SCENE=stand): PASS.** A dirt block 8 over the grass got a 6-cell cobblestone stand. The block was cut and the
  teardown visit cut all 6 cells: none left.
- **Codex:** r1 found 1 blocker (a stand on a wall-extension plot, fixed in f655a52b); r2 says "fixed, no new blocker".
- **Fleet:** not applicable. The fleet has no plotprep stands or teardown.

**2: lawns, banks and terraces** (`roughground-2-show` @ 28016120)
- A cobblestone or cobbled-deepslate top in a lawn (at least 4 grass neighbours, open ground only) is laid again as
  dirt (`topsoil`).
- A topsoil cell reads done while the bag has no dirt (`noSoil`), so the cobble is never dug out to a hole. The keeper
  bills its dirt from the town on its own.
- A dry hole beside water is filled to the bank's ground.
- After the last band, the cycle wraps to the TERRACE stage (`TERRACE_CYCLE=off` restores the old wrap).
- **Paper:** grass spread was measured. Bare dirt beside grass greened in a median of 1.1 min (24 of 24 within 7.4 min).
  The centres of 3x3 dirt patches greened within 5.9 min. SCENE=topsoil: 6 cobble lawn tops became dirt in one visit,
  and all 6 were green 4.8 min later. PASS.
- **Terrace re-run, offline:** 162 cuts, 229 fills and 119 seals. Rough pairs drop from 2024 to 1744, steep pairs from
  770 to 710, and walk traps from 251 to 176.
- **Codex:** r1 found 1 blocker (mossy cobble is not dug by the visit's foreign-block dig, so topsoil is now
  cobble/cobbled deepslate only); r2 says "fixed, no new blocker". It also takes the fleet blocker's fix (noSoil) and
  piece 3's (dirt billing).
- **Fleet:** `roughground-2-on-63d28320` @ 6819822c covers topsoil and banks only, since the fleet has no terrace stage.
  Codex r1 found 1 blocker (the cobble was dug out with no dirt held, fixed by noSoil); r2 says "fixed, no new blocker".

**3: the landmark** (`roughground-3-show` @ 6e71edd0)
- The keeper sites ONE round terraced mound, once, with 1-block steps, dirt tops, buried cobble and a sapling on the
  crown.
- It goes on open ground inside the wall. Rough ground is shaped by cut and fill (spread up to 3, cuts at most 3,
  never a hollow opened sideways).
- The land record is published first (the reservation). Every tidy rule, the terrace and other builds keep off the
  mound. A later record gets only its missing cells (`landmarkRepair`).
- Its tops take dirt only, billed from the town.
- Flower-edged paths and lantern posts already exist in the decorator, so they are reused unchanged. The live decor has
  61 border plants, all ferns, and 2 lantern posts. Their limit is the flower supply, not code.
- **Offline:** sited at 25,-3 (base 68), with 64 fills and the tree, in the owner's area D.
- **Codex:** r1 found 3 blockers, r2 found 1, all fixed; r3 says "fixed, no new blocker".

**Full suites (ci2, git context).** The only failure in the showcase suites is the base's known orphan, bagdiet.test.
- 1b 31c6d5eb: 458/460 (+ the lavastep flake)
- 1c f655a52b: 459/460
- 2 28016120: 459/460
- 3 6e71edd0: 460/461
- fleet 2 6819822c: 409/410 (well.test, which fails on 63d28320 too)

**Fleet registration.** The registration and draft entry are written in `~/mcai-analysis` on the canary host:
- `roughground-02.6819822c.json` (`effectwatch validate`: valid)
- `roughground-02.queue-entry.json` (P lane, after roughground-01; the control session queues it)

### Before and after, per piece stacked

Unique defect columns in the owner's 29 circled areas, after four simulated keeper passes. Each column adds one piece
to the ones before it.

| class | now | 01 | +1b | +1c | +2 | +3 |
|---|---|---|---|---|---|---|
| clump columns | 739 | 517 | 470 | 396 | 393 | 399 |
| one-column pillars | 94 | 75 | 56 | 57 | 56 | 56 |
| floating blocks | 117 | 75 | 81 | 81 | 78 | 79 |
| one-column holes | 27 | 13 | 12 | 12 | 12 | 12 |
| wide holes | 120 | 97 | 85 | 88 | 94 | 90 |
| stray tables | 26 | 11 | 11 | 11 | 11 | 11 |
| loose cobble lawn tops | 194 | 181 | 175 | 175 | 81 | 79 |
| ragged edges (step of 2 or more) | 969 | 708 | 705 | 681 | 657 | 681 |

How each piece's first pass changes the work, town-wide (inside the wall and bands rim48-80):
- **01:** 3,191 cuts and fills; 933 floating blocks out of reach; 299 crusts over hollows left.
- **+1b:** 4,101; 295 hollows filled under their cuts, and only 17 crusts left.
- **+1c:** 4,612; 158 stands, which cut 165 more floating blocks (out of reach: 933 to 745).
- **+2:** 4,949; 233 topsoil cells and 3 bank holes, plus the terrace re-run above.
- **+3:** the landmark's 65 cells.

0 zone, record-cell, well, avoided or reserved touches at every level.

**Reading the table.**
- 1c's stands reach blocks within 3 steps. The floating blocks in the circles are mostly 6-10 over the ground, in the
  canopy, or in reserved areas, so the circled floating count barely moves even though 165 more come down town-wide.
- With the mound in place, ragged edges rise by about 24 in area D, where its base meets the lower honeycomb ground.
- **Still left:** wide rough ground (more than 9 columns), the expedition markers, and blocks beyond any stand.

**Merging.** The pieces conflict with each other only on the `ROUGH` constant, the census line, `tidyRecord`'s cell
push and the test files. The resolutions are mechanical; the simulation's stack used them (local tags sim-1b to
sim-3, not pushed). That stack predates the visit-time fixes (noSoil, the dirt bill, the landmark's r1 shape fixes); the
survey rules it measures are the same.

## Piece 4: wide-area regrade (owner GO, 11-07 ~13:10Z)

Branches:
- Showcase: `roughground-4-show` @ d2dcb64f, built on roughground-2-show.
- Fleet: `roughground-4-on-63d28320` @ c643406e, built on roughground-02 6819822c. It is the survey only, because the
  fleet has no terrace stage and no inside-the-wall stage.

Both are tier 2 (not protected). Rollback is `REGRADE=off` or `ROUGH.regrade`.

### Why

Pieces 01-3 leave rough ground that is wider than any clump the per-column rules take. In the owner's circled areas,
after all those pieces: about 400 clump columns and about 630 ragged-edge columns.

### The design (`bots/src/regrade.mjs`, pure)

It runs last in the rough survey, over every open column no earlier rule took, with the same refusals. So it works
both inside the wall and in every band.

**Fitting the target surface**
- A column is **rough** if it has a step of 2 or more to a 4-neighbour, or sits 2 or more off the median of the 7x7
  ground around it. Rough columns start at that median.
- Every other column is an **anchor** at its own height. Gentle slopes, terrace steps and meadows therefore never move.
- The surface is relaxed until every solved pair of neighbours differs by at most 1 (a 1-block clamp).
- **Natural relief is kept as an anchor:** any column that would need more than 3 blocks of cut or fill, and both sides
  of a cliff (a step of 4 or more, which covers a hill's edge and its foot).

**When the ground refuses a cut** (not the town's own ground, water beside it, a crust over a hollow, a hollow beside
it, or an unsafe re-soil), that column becomes an anchor and the surface is fitted again. The ground around it is
filled up to meet it instead, which suits the showcase's tunnelled ground.

**The work**
- Cuts go top first. A new top that is not soil is laid again in dirt.
- Fills put topsoil on top (dirt only, so it greens; held back while no dirt is in the bag, and billed from the town),
  with earth or core underneath.
- Work is done in 8x8 tiles, nearest home first, at most 600 cells per survey. The rest waits for the next survey.

### Codex's independent design, reconciled

**Agreed and adopted:**
- one classifier shared by the inside and the bands;
- fixed anchors for kept ground;
- hills preserved together with their foot;
- unsafe cuts anchored, never relaxed;
- every exposed top re-soiled;
- topsoil billed from the town;
- the per-column rules run first.

**Not adopted:**
- **A 9x9 median plus a radius-4 weighted mean.** Mine anchors only the columns that are not rough, which changes less
  ground.
- **Hill detection by footprint of 256 columns or more and relief of 8 or more, against a radius-16 baseline.** Mine
  keeps cliffs and any change over 3 blocks. This is simpler, and it is tested on a 10x10 rise.
- **32x32 tiles with a persisted campaign solution and a cap of 4 blocks of change against the first snapshot.** Mine
  re-surveys each cycle, with the cap of 3 applying per survey. Codex's version would guard better against slow erosion
  over many passes; that is noted for a follow-up.
- **Material-balanced target choice.** The existing bill covers it.

### Codex review

- r1 found one blocker: a re-soiled top is dug by the visit as a foreign block and could open a hollow. Fixed: the
  re-soil is checked like a cut, otherwise the column is an anchor.
- r2: "fixed, no new blocker". The fleet composition review found no blockers.

**Full suites (ci2, git context).**
- Showcase d2dcb64f: 460/461. The one failure is the base's bagdiet orphan.
- Fleet c643406e: 409/411. well.test also fails on the base; lavastep is a known flake.

**Fleet registration.** `~/mcai-analysis/roughground-04.c643406e.json` (valid) and its draft entry, P lane after
roughground-02.

### Paper (sandbox6, `rough-proof.mjs SCENE=regrade`): PASS

The test used the bots' own siteStage, runVisit and botBuildEffects on a 14x14 patch of rough ground, with a 2-high
tunnel under its edge.

| measure | result |
|---|---|
| visits | 3 |
| steep (2+) pairs | 122 → 14 |
| holes left | 0 |
| tunnel cells opened to the sky | 0 |
| fill tops green | 36 of 36, 9.9 min after the work |

### Offline, all pieces stacked (the mirror copy, 4 passes)

Steep ground-to-ground pairs (a step of 2 or more):

| stage | inside the wall (of ~8,200 pairs) | band ±80 (of ~43,800 pairs) |
|---|---|---|
| now | 1904 | 9184 |
| piece 01 | 1145 | 5859 |
| pieces 01-3 | 1058 | 5219 |
| **+ piece 4** | **977** | **4897** |

The regrade works on 304 columns in the first pass, and 90 by the fourth.

Of the 977 steep pairs left inside the wall:
- 604 are beside a build, whose footprint ring is kept by design.
- 180 are natural cliffs of 4 or more, kept.
- 193 are open ground: tunnels, anchors, and work for later passes.

Circled-area census with piece 4 stacked (from the "now" column):

| class | now | all pieces with 4 |
|---|---|---|
| clump columns | 739 | 397 |
| ragged edges | 969 | 635 |
| one-column pillars | 94 | 58 |
| wide holes | 120 | 80 |
| one-column holes | 27 | 13 |
| loose cobble tops | 194 | 77 |

0 zone, record-cell, well, avoided or reserved touches.

### Renders (`videos/roughground-1107/`)

The heightmaps are shaded by height. Red marks a ground step of 2 or more; grey is a build.

| view | before | after piece 01 | after all pieces |
|---|---|---|---|
| the town | `heightmap-town-now.png` | `heightmap-town-piece01.png` | `heightmap-town-allpieces.png` |
| the band | `heightmap-band-now.png` | `heightmap-band-piece01.png` | `heightmap-band-allpieces.png` |
