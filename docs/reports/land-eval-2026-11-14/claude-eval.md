# Land-cleanup evaluation: Claude (2026-11-14)

Code read at `.wt-roofclimb/` commit 46286e9e3. File:line references are relative to `.wt-roofclimb/bots/src/`. Numbers come
from `evidence.md`. Section 2 of that pack shows only the top six detail rows for each event, so any count I add up from those
rows is a lower bound.

## 1. How the present approach works

**Detection.** Every rule starts from `tidyColumn` (tidy.mjs:95-110). It treats "the ground" as the highest full solid block in
a column, reading down from home.y+14 and passing over air, plants, leaves and logs. It then calls a cell junk or a hole by
comparing that top with the tops of the neighbouring columns:
- **Inside the wall** (`surveyInwall`, tidy.mjs:1288-1395). A *stray* is a column higher than **all 8** of its neighbours, made
  only of SPOIL (tidy.mjs:1355-1366). A *hole* is a single column lower than **all 8** of its neighbours and at most 4 deep
  (tidy.mjs:1377-1385).
- **The rough survey** (`surveyRough`, roughground.mjs:133-530) runs alongside it. It adds floating spoil with air under it
  (roughground.mjs:98-119, 223-261), clumps of up to 9 columns (310), holes of up to 9 columns inside a 4×4 box and at most 4
  deep (45, 310-312, 358), loose crafting tables (262-284), cobblestone tops in a lawn (413-424), the bots' own logged scaffold
  (425-455), walk litter that was handed on (456-496), and a wide-area regrade (504-525; regrade.mjs:24).
- **What counts as "made by a bot"** is decided by material, using the regex
  `SPOIL = dirt|grass_block|cobblestone|…|planks` (tidy.mjs:45). Placement history is used in only two rules: the climb ledger
  (roughground.mjs:427-455) and the handed-litter list (roughground.mjs:460-496).

**Planning.** `siteStage` (tidy.mjs:1507-1743) merges the surveys into one tidy record (`tidyRecord`, tidy.mjs:312-349):
- Fills are grouped into layered segments of 24 cells, each layer waiting on the one below (tidy.mjs:320-340).
- Cuts are ordered top first.
- The rough survey adds at most 1,200 cells (roughground.mjs:45, 498-502).
- While the record is open, `tidyrefresh` adds whole new columns every hour (tidyrefresh.mjs:78-151), up to 1,200 entries. It
  never re-adds a cell the record already "knows" or has waived (tidyrefresh.mjs:83-84, 98).

**Execution.** Work goes through the general build visit, `runVisit` in buildrun.mjs:
- Cuts are dug from a reachable stand (buildrun.mjs:1387-1447).
- A cell that no stand reaches is deferred. After 3 visits it becomes `stuck_on_cell` (buildrun.mjs:130, 1478-1533). It may get
  a temporary pillar stand (tempstand.mjs:1-40).
- Who does the work is decided by `grounds2`: every 2nd or 4th build visit goes to the grounds, at most 4 bots
  (grounds2.mjs:35, 41-70). A visit is limited by the skill timeout, about 2 minutes (land-program note).

**Stopping.**
- A cut stops when it no longer stands (tidy.mjs:353).
- A fill stops when the cell is solid.
- A cut that one bot fails 3 times is given up (tidy.mjs:62, 369-375) and goes on the town's waived list
  (tidyrefresh.mjs:176-194).
- Fills that a keeper fails to place in 2 visits are waived, up to a tenth of the stage (tidy.mjs:1815-1824).
- A record is complete when nothing is left that is not waived. It is surveyed again 48 h later (tidy.mjs:59, 377), and inside
  the wall hourly (roughground.mjs:544-548).

**Prevention.**
- `cleanzone` removes from the pathfinder every move that places a block within 64 of home (cleanzone.mjs:1-45, 106-188). A
  "valve" lifts that ban for 2 minutes after two failed searches (cleanzone.mjs:46, 150-186).
- `takeback` digs up the scaffold that walks placed, for the walk profiles only (takeback.mjs:54-60, 91-125).
- Escape reflexes are exempt from both (cleanzone.mjs:14-15; takeback.mjs:43-45).

## 2. Assessment against the evidence

**What works.**
- *When a cell is on the plan, the plan is right about it.* The 11-09 admin pass laid 1,305 of the plan's own cells with 0
  failures, and a re-read of the world matched the bots' counts.
- *The executor places blocks.* In 30 h it placed at least 979 fills (718 cobblestone + 261 dirt) and recorded 1,100 cuts and
  1,622 fills planned for inside the wall.
- *Take-back digs something.* Outside town, receipts end `dug` 2,539 times against 2,862 `left:expired` (top rows).
- *The water, body-in-hollow and claim guards* show no harm in the evidence pack.

**Failure 1: the roofed hollow. This comes from the model itself.** The scorecard finds one hollow of 7,683 columns with 26,007
air blocks within 8 of the top. The tidy plans fills in 143 of those columns (1.9%). The cause is the detection rule: because
`tidyColumn` takes the highest solid as ground (tidy.mjs:95-107), a grass crust over a gap reads as level, solid ground.
- The only rule that ever fills a hollow is "fill under a cut I am making" (roughground.mjs:181-192, 338-347, 396-398). It also
  gives up past 4 deep (roughground.mjs:184), and the inside-the-wall rule passes such columns on as `stray_hollow`
  (tidy.mjs:1369; 18 in record g180).
- No change to the thresholds can reach a gap the detector cannot see.
- Worse, the medians that decide "pit" and "pillar" (tidy.mjs:243-247; roughground.mjs:161) are taken over the deck. So the
  reference surface itself is bot-made.

**Failure 2: pits too big for the rules. A limit, but one that cannot be raised safely under this model.** The scorecard counts
368 open pits: 234 of one column, 127 of 2-9 columns, 7 of 10-30 columns. The large ones plan 0-5 columns each; the 29-column
pit at x -48..-25 plans 1. The rules cap out at 9 columns, a 4×4 box and 4 deep (roughground.mjs:45). The inside-the-wall rule
needs a hole lower than all 8 neighbours (tidy.mjs:1378), so a 2-wide hole never qualifies. The caps could be raised, but they
exist because nothing in the model can tell a bot-dug pit from a natural dell (regrade.mjs:18 keeps "natural relief"
deliberately). Raising them trades holes left open for natural land flattened. The fault is in the model, not the numbers.

**Failure 3: stray dirt and cobblestone. Ownership is guessed from material, which is the model's flaw.** SPOIL includes
`grass_block` (tidy.mjs:45). So a one-block natural grass bump higher than all 8 neighbours is cut (tidy.mjs:1356-1364), while
bot dirt sitting on stone is kept as `stray_natural` (53 in g180). The 11-10 pass 2 shows the alternative works: it used
CoreProtect ("last row on the cell is a bot's") and found 569 cuts + 458 fills that the tidy's own plan did not contain. A
re-plan afterwards found 0 cuts left. The provenance rule found what the shape rule missed, in one pass.

**Failure 4: throughput. A bug or limit, fixable in place.**
- In 30 h there were 445 tidy build visits. 190 of them ended `deadline` and 207 ended `aborted` (top rows).
- 918 cells were deferred (780 + 138 blocked), set against 979 placed.
- 540 temporary-stand attempts were refused with `no_step`.
- 579 of 794 `grounds_quota` rows ended `no_effect`.
- The backlog still holds 2,181 open fills out of 5,790 planned.
- The 11-12 note measured the backlog growing by about 380 cells a day.

These causes are the visit budget, stands, and segment order. The grounds2 header (grounds2.mjs:5-12) lists eight earlier
patches to the lease rules that did not move the totals. That history is a warning against a ninth patch, but none of these
causes depends on how cells are detected.

**Failure 5: prevention leaks. Partly a limit, fixable in place.**
- The cleanzone valve opened about 835 times in 30 h (362 `timeouts` + 358 `no_path` + 68 + 17 + 15 `no_path` on other goal
  types, plus 33 well passes). Each opening lifts the ban for 2 minutes within 3 blocks (cleanzone.mjs:46).
- `scaffold_pick` logged 13,952 `pillar_out` / `dig_straight_up` choices. These come from escape reflexes, which nothing
  takes back (takeback.mjs:43-45).
- About half of the take-back receipts expire undug.

These are gaps in coverage (escapes, places with no stairs), not a wrong idea. The release rows already list the places where a
staircase is missing.

## 3. The design I would choose starting fresh

- **Data it reads (offline, on the host).**
  1. The live region files (`regiondump.py`).
  2. A **genesis** copy of the same chunks, regenerated from the seed with the same jar. The boardwalk-03 note records this
     already done for the showcase: 93.7-96.4% agreement on non-stone blocks, 4.4% with the wrong seed as the control.
  3. CoreProtect place and break rows.
  4. The town's project records.
- **The ground that should exist.** For each column: the record's cells where a build owns it. Elsewhere, the genesis surface,
  smoothed to 1-block steps where the town has graded it on purpose (plots, roads, terraces). A crust over a gap then shows up
  as "air where genesis had ground", or as "bot blocks above genesis". The deck is no longer invisible.
- **Natural or bot-made.** A block that differs from genesis, with a CoreProtect row naming a bot, is the bots'. A block that
  matches genesis is natural. A difference with no CoreProtect row is unknown and is left alone. Material is never evidence.
- **Cutting work into jobs.** The planner diffs live against target into cut and fill cells. It groups them into jobs of 8-24
  cells in a small area. Before publishing a job it proves a stand for every cell, using the same stand rule and the real A*
  over the saved blocks (the 11-14 well replay showed this takes milliseconds). A job with no stand gets its stair or temporary
  stand planned in, or is never issued. The bots do not discover unreachable cells on site.
- **Accepting a job.** The next save-file read shows every cell at target. Done is decided by the world as read from the host,
  never by a visit's own counters. The scorecard (pits, hollow air, bot blocks above target) is the acceptance test.
- **Preventing new mess.** Keep cleanzone and takeback. Extend take-back to the escape pillars. Turn each spot where the valve
  keeps opening into a planned staircase job.
- **What I would reuse.**
  - `runVisit` and its segments, layering, leases, temporary stand and dig guards (buildrun.mjs).
  - The water rule (tidy.mjs:112-187).
  - `hollowClear` for bodies (roughground.mjs:558).
  - The grounds2 share.
  - cleanzone and takeback.
  - The tidy record format, so the new planner publishes into it.

  I would retire `tidyColumn`-based detection, SPOIL-as-ownership, and the size caps.

## 4. Verdict: RESTRUCTURE AROUND A NEW CORE

Replace detection and planning with an offline core that works from provenance against a target surface. Keep execution and
prevention, and fix them in place. By sub-question:
- **Holes (including the hollow):** a new core is required. The present detector cannot see the largest defect.
- **Pillars and floating junk:** this is the part of the present code closest to right. Floating segments, the climb ledger and
  handed litter all work. Swapping in the new ownership test is mostly in-place work.
- **Stray dirt and cobblestone:** a new core is required. Telling bot-placed dirt from natural dirt cannot be done by material
  or shape.

**Reasons.**
1. The detector reads a crust as ground (tidy.mjs:95-107), so 98% of the 7,683 hollow columns are not on any plan. Raising
   thresholds cannot fix that.
2. Where provenance was used (pass 2, CoreProtect), it found 1,027 cells the shape rules missed and left 0 cuts on re-plan.
   The shape rules, after seven pieces (roughground 01, 1b, 1c, 2, 3, 4 and litter), still leave 791 pit columns, plus 234
   one-column pits the code is supposed to cover.
3. The execution layer is not the broken part. It places blocks correctly when given reachable cells (1,305 of 1,305 in the
   admin replay of its plan). Rewriting it would throw away the most-tested code for nothing.

**Strongest argument against.** Throughput, not detection, may be what really limits the work. The executor manages about
1,000 fills in 30 h. A detector that sees the hollow raises the backlog from about 2,400 to about 28,000 blocks, roughly a
month of work and some 26,000 blocks of material. A new core can produce a bigger list without producing a cleaner town. On
this view the right move is to fix stands and visits first and leave the deck alone. I answer this by putting the target
decision first: the target might well be "remove the deck down to genesis" rather than "fill the gap". Only the new core can
compare those two options at all.

## 5. The first three things to build

1. **The offline ground ledger (read only).** Live, genesis, CoreProtect and records go in; each column is classified as
   natural, bot-placed, bot-dug, deck-over-gap or record. *Proof on course A:* it reproduces the scorecard totals (791 pit
   columns, 7,683 hollow columns). It agrees with pass 2's 1,027 CoreProtect cells. With the wrong seed, the bot-made share
   collapses. *On course B (untouched terrain):* it calls less than 1% of columns bot-made.
2. **The planner and acceptance.** It sets the target surface, cuts it into bounded jobs with stands proven by the real A*, and
   publishes into the existing tidy record format. Acceptance is the scorecard re-read from the save files. *Proof:* on a fresh
   copy of course A, run 24 h. The scorecard's pits, hollow air and bot blocks above target should fall. Cells deferred per
   cell placed should drop well below today's ~0.94. Compare against the same 24 h on a copy running the current code.
3. **Closing prevention.**
   - Take-back for the escape pillars.
   - A staircase job at every spot where the cleanzone valve opens repeatedly.

   *Proof on course B with marked plots:* after 24 h of normal town work, count the bot-made blocks left standing per bot-hour,
   using CoreProtect from the ledger. Compare with the current code on a twin copy. The aim is near zero inside the town's
   margin.

## 6. What I could not establish

- **Why the 234 one-column pits are not planned.** Candidates are the build-ring refusal (roughground.mjs:142), country-record
  coverage, columns outside the wall box (tidy.mjs:1070-1074), or the waived and known list (tidyrefresh.mjs:83-84). I could
  not tell which without running the survey on the capsule.
- **Whether the deck is bot-made.** The note says unproven. That decides whether the target is "fill" or "remove", and only the
  genesis diff answers it.
- **How much of each event happened in town.** The 13,952 `scaffold_pick` rows and the take-back rows have no zone split in the
  pack, and the per-event totals beyond the top six detail rows are missing.
- **Material supply.** I could not establish whether the town can supply about 26,000 blocks.
- **Genesis and CoreProtect coverage of the showcase.** Whether CoreProtect covers the town's whole history since 10-20, and
  whether genesis regeneration still matches today's showcase jar.
- **Tests.** I did not run the tests, by the rules of this brief. Statements about what code does are from reading it.
