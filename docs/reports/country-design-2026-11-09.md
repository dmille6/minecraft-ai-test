# Countryside landscaping + the upkeep crew: design, build and proof (2026-11-09)

OWNER 11-07: "i'd like all areas like this to be smoothed out and made to look pretty" (inside the walls and the countryside).
OWNER 11-09 (~12:45Z, "i want all of those things done"): (1) countryside landscaping outside the walls, in rings out from the wall,
in parallel with the inside stage, by the groundskeeper and its helpers, then meadows, flower drifts and tree groves; (2) an upkeep
crew: repair, replant felled trees, re-light, sweep strays and drops, re-till; the lowest-priority always-available work, on the town
work board. Showcase first, then the fleet. Ledger rows `country-1109`, `upkeep-1109`.

**Status (11-09):** built, reviewed, Paper-proven; NOT released, NOT queued. Full suites at the final shas: showcase a4c08e0e ci2
484/487 (craftsync-mutants and showdrop pass alone; orphan = bagdiet base); fleet 35215b53 ci2 425/426 (well.test, known base).

| Piece | Branch @ sha | Base | Tier | State |
|---|---|---|---|---|
| Showcase: country lane + upkeep | `countryside-01show` @ `a4c08e0e` | live release `b9fa002e` (glass-01show) | 2 | ready to stage |
| Tripwire CO1 + UK1 | `shopread-country-upkeep` (merged to main) | main | tooling | install with the release |
| Fleet: upkeep | `upkeep-01-on-bcdba35f` @ `35215b53` | live fleet `bcdba35f` | 2 | registration valid, draft entry, not queued |
| Fleet: country lane | not built (see section 7) | | | |

## 1. Measured

Showcase, 12 h to 11-09 12:35Z (139,710 skill rows, 15 bots, 167.9 observed bot-h; `m1.py`, `m2.py` here):
- Build visits 526 = **10.6 visit-h, 6.3% of bot time**. Skill time ~67 h (explore 14.9, build_shop 12.9, home 10.4, gather 8.9,
  goto 6.2); ~100 bot-h (60%) is between skills. The 11-08 workboard measure: patrol rung 51.8% of all time.
- The inside stage (tidy g101, `inwall`, sited 11-08 04:47Z): 2,601 cells (1,130 carried), 1,098 cuts; 15.5 fills/h + 37 cuts/h
  (roughfill-01's read). The bands rim48..rim80 are sited only after it closes (`landplan.mjs nextStageCycle`): one record chain.

World, a region copy of the 11-09 12:10Z snapshot (box +-144, y 45..110; `measure.mjs`, `country-run.mjs`, `upkeep-run.mjs`):
- **Damage on 17 finished records (~9,800 cells): 19 cells on 3 records** (decor 7 ferns, monument 8 core, storehub 4); **light
  cells dark: 0 of 60; crop-farm farmland: 10 of 10.** Repair, relight and retill are already served (repairs come first in
  `shop.mjs activeProject`; a lost torch on a record is damage; `cropfarm.mjs cropDue` + prodserve) -- the upkeep counts them, never
  duplicates them.
- Outside the wall, ~38 flowers in ~63,000 columns; short grass and ferns 2-3%.
- **The bots' own band siting** (tidy.mjs siteStage, offline): rim48 633 fills / 224 cuts / 24 clears; rim64 986 / 498 / 72; rim80
  964 / 420 / 64; past the land plan's reach c96 789 / 286, c112 581 / 196, c128 386 / 122. About the inside stage's size again.
- **Upkeep jobs (final rules, whole reach 128):** showcase 21 strays, 66 remains groups (170 logs), 57 replants. Fleet region copies
  (`upkeep-fleet.mjs`): hive-a 79 strays / 148 remains / 89 replants; board-b 38 / 156 / 99; placebo-a 26 / 163 / 114; hive-c
  33 / 223 / 134.
- Positive controls: every zero above is next to a count the same read found (strays 21, remains 66, flowers 38, the bands' fills).

## 2. The design, reconciled (two engines, independent)

| Question | Claude engine | Codex engine | Chosen |
|---|---|---|---|
| Country architecture | a second chain `country`, sited by the existing siteStage over the bands | a separate `country` chain; pay the tripwire cost | **separate chain** `project-<home>.country` (blueprint country@1, the tidy record's shape); option "add segments to the tidy record" rejected by both: every inside reader (completion, strikes, waivers, gkOpenNow) would need a filter, stageCarry turns open work into PREV, and it contends with the inside-pace agent |
| Cursor | the head's `stageId` | ring/phase fields | the head's `stageId` (country.mjs countryNext); after the last band, the first again after 2 h |
| Inside chain | ends at `inwall` with COUNTRY on | bands become delegation checkpoints | `nextStageCycle` `inner` (setLandInner): the inside ends at the wall; COUNTRY=off is the old ring order |
| Crew | a ranger + 2 country helpers on their own leases | one crew, two lanes: helper3/4 country, helper1/2 inside, the keeper alternates | **one crew, two lanes** (the owner's cap unchanged): the upper half of the helper leases works the country, borrowing the other lane's open work; the keeper sites the next band at once and visits an open band at most hourly while the inside has work |
| Plantings | drifts ~2% of grass, groves 3-5 at gap 3 | targets not dependencies; distinguish skipped supply | park roles (terraceSkip: no material -> passed, never a blocker); groves 3-5 saplings gap 3 where no tree stands, at most half a band's plantings; drifts 5-9 flowers of one role; bone meal not spent here |
| Upkeep | a dispatcher computed on read | a bounded task journal | **a job list** per survey (8 tiles of the 128 reach, 30 min), judged as a sink chain by the tripwire |
| Tier | after due and sinks, before the fallback | after all executable work, before the nonwork fallback; fix the held `open[0]` | the last tier; in place of an open project this bot cannot work and of a due record it found empty; a due record first |
| Board | `{exists, complete, due}` | same, due only when executable | same (townwork.mjs jobBlocked: a due upkeep is a job, a quiet one `complete`) |

Prior art (the Claude engine's search; landscape survey 11-09 ideas 5, 6, 8): RimWorld (lowest-priority cleaning starves unless it is
a guaranteed tier with reachable jobs), MineColonies forester (replant supply is a by-product of felling) and request system,
Dwarf Fortress (skip one instance, never the whole order; judge by the stand), Baritone (skip-after-N, tolerance), MineCollab
(2-3 bots a task).

## 3. What was built (showcase)

- `bots/src/country.mjs` (pure): countryStages (c48 = everything outside the wall boxes to 48, then 16-wide rings to 128; spokes
  graded inside the land plan's reach), countryNext / countryDemand, countrySide / groundsLane, groundsState, groundAt, countryPlantings,
  countryRecord / countryNothing. COUNTRY=off|on (unset: named pools), COUNTRY_PLANT=off.
- `tidy.mjs siteStage` `classic: false` (the band survey alone; never inside the wall boxes); `landplan.mjs` `inner` / setLandInner;
  `park.mjs` sapling3 (spruce first).
- `skills.mjs`: buildTidyVisit picks the lane after the crew decision (`_grounds_lane` row; `lane=` on `_build_visit`); siteCountry
  (the keeper's); every row names the lane's plot (`project=country`); gkPlanAdditions takes the retirements and the stands' teardown
  on the country key; helpersCap reads both lanes' open cells; the park gather and five decor gathers read the country record.
- `bots/src/upkeep.mjs` (pure): straysIn (tables/furnaces on the ground, never a record cell, a record box + 3 or a zone), remainsIn
  (26-connected log groups no member of which rests on the ground, top <= ground+6, no other log within 2: a living crown never),
  upkeepSurvey, replantGate (**the replant first**: a group owing a sapling comes down only after its own sapling stands; a grown
  replant retires its group), upkeepVisitJobs, upkeepLeft, upkeepClearOk (re-read at the dig; a furnace-kind stray only with a
  pickaxe), the record, upkeepStale, upkeepState. UPKEEP=off|on (unset: named pools).
- `shop.mjs`: PROJECTS `upkeep` (before the tidy, which stays last), the upkeep tier in activeProject, projectsGuarded leaves it out.
  `buildrun.mjs runVisit` `p.clearOk` (non-tidy clears; before the walk and after it). `skills.mjs buildUpkeep`: survey a tile; a town
  sapling draw; two runVisit passes (replants, then the gated clears); complete when nothing is left; the sweep over the reach
  (gksweep.mjs sweepPick: the one selection the due also reads).
- `bots/scripts/country-render.mjs`: the pictures below, from the bots' own code.

## 4. Reviews

Codex, blockers only (tier 2), on the showcase branch: r1 4 blockers (all upkeep: a grown replant felled, a missing sapling erasing
the replant, drops-only upkeep never sweeping, upkeep ahead of due work), r2 3 (a grown tree via the clear list, one sapling for two
groups, drops the sweep would refuse), r3 3 (the gate read once per pass, the second pass's slot generation, unreadable sweep
inputs), r4 1 (a furnace dug without a pickaxe), **r5 NO BLOCKERS**. Then r6 (the crown rule: a big oak's diagonal branch, a log
within 2 of another tree, never remains -- the fleet copies read 150 of 206 groups as single crown logs before it). Fleet port r1:
1 blocker -- the ORDER's completion check (cognitive.mjs refuses build_shop for a complete record unless shopDamaged reads it as
wanting a visit), the showcase's too, missed in five rounds: a stale upkeep list was never surveyed again, and a quiet inside with a
country band was refused. Fixed on both; r7 1 blocker (the country case in recordDamaged made shopActive's tidy state `due`, demoting
a helper's band behind the sinks) -> moved to shopDamaged alone; **r8 NO BLOCKERS**.

## 5. Paper proof (sandbox6, `sandbox/country/country-proof.cjs`, the bots' own runVisit + botBuildEffects)

| Step | Result |
|---|---|
| U1 a table and a furnace on the grass | listed `stray`, dug (the furnace with the pickaxe in hand), swept into the bag: table 1, furnace 1 |
| U2 two trunks felled at the base (tops ground+5, ground+6) | 8 logs listed `remains`, all dug from the ground (0 towers), each group replanted at its own soil, replant first |
| U2b one sapling for the two groups | one planted and taken down, the other HELD with all 5 logs standing; with saplings given, done |
| U3 a living tree, a beam ten up | both kept (8 of 8 logs) |
| C1 a band's plantings, saplings only | 30 of 30 grove saplings on the server; 30 drift cells passed (no flower), the visit `complete` |
| C2 flowers given | 30 of 30 drift flowers; 7 on one-layer snow; none on a worked column |

Two findings fixed from the proof: a furnace dug by hand is lost (pickaxe rule), groves never sited on snow (room above).

## 6. Pictures (`country-design-2026-11-09/`)

- `country-before.png` / `country-after.png`: the GROUND view (leaves and trunks see-through, hillshade from the north-west) out to
  128, before and after all six bands' earthwork and plantings; `country-work.png`: red cuts, blue fills, green saplings, pink flowers;
  `country-zoom.png`: -75..-20, 20..75 at 8x; `country-sheet.png`: all four.
- `country-upkeep.png` (showcase) and `fleet-hive-a-upkeep.png`: the upkeep's jobs -- red strays, orange remains, green replants.

## 7. Fleet

- **upkeep-01** on bcdba35f @ 35215b53: the same module and visit; the fleet's own activeProject tier (after repairs, open projects with a slot,
  buildnext's due records; in place of a held open project), the fleet's runVisit `clearOk`, its own sweep (gksweep.mjs sweepPick).
  With the work board (cherry-picked onto workboard-01's 3d8ef9de: clean; townwork/stuckproj/buildnext/gkforever/idlework pass) a due
  upkeep is a board job (`jobBlocked` null) and a quiet one is not.
- **country lane: not ported.** The fleet's ring order is town -> roads -> rim48..80 (no inside-the-wall or terrace stage), so its
  bands already run without waiting; plantings need the park machinery the fleet lacks; the fleet's rough-ground pieces are
  roughground-02/04 (drafts). A fleet country lane is a separate piece once those land.

Registration `~/mcai-analysis/upkeep-01.35215b53.json` (copy in `country-design-2026-11-09/upkeep-01/`): `effectwatch validate` valid
(primary `_build:upkeep:clear` absolute +0.05/bot-h from a zero base; `_build:upkeep:place` +0.01; `_build_visit` rate +5%; guardrails
items/bot-h, drowning deaths, productive share). Draft entry `upkeep-01.queue-entry.draft.json`; drawrec with the registration: DRAW
['board-d', 'board-c'] (never isolated-* or placebo-c). NOT queued.

## 8. Effect metrics, reads, rollback

- country-01show: per-band rough census before/after from region copies (floating, float_high, clumps, holes, stations: rim48 103 /
  133 / 53 / 21 / 4), country cells closed per crew-bot-h (`_build project=country op=place|clear`), plantings standing (flowers
  outside the walls from ~38; grove saplings), and the inside's pace not starved (fills/h, cuts/h >= 90% of the 6 h before).
- upkeep-01show / upkeep-01: `_build project=upkeep op=clear kind=stray|remains`, `op=place` (replants), `op=sweep n=`, `_upkeep
  op=survey|done`; build-visit share of bot time up from 6.3% (showcase) and the patrol / idle_work share down; jobs left per tile.
- Reads after staging: `_grounds_lane lane=country` rows > 0 and `_build project=country op=sited` (the keeper sites c48);
  tripwire CO1/UK1 clean with tidy placements judged in the same window (positive control); `_upkeep op=survey` every ~30 min;
  `_build_visit project=upkeep` outcomes; deaths by the gate.
- Rollback: COUNTRY=off (the old ring order; a sited country record is never visited again), COUNTRY_PLANT=off, UPKEEP=off.

## 9. Owner-visible choices (flagged, not blocking)

- The crew cap reads both lanes' open cells (the bands were the tidy's own stages): four helpers while the grounds have > 500 open.
- Country rings to 128 on the showcase (the land plan's roads end at 80); the village zone and every record box are kept off.
- The upkeep takes strays and the remains of felled trees anywhere in the 128 reach outside records and zones (never inside a
  building's box + 3).
