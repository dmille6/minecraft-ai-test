# pit-01show: the P1 North Pit (the town's dirt borrow pit)

Branch `pit-01show` on db59a7829 (wellfix-01show-rel). The owner picked the site on 11-19 from `docs/reports/sites-2026-11-19/`.
The finish (pond, dock, path, flowers, sugar cane) is planned in `finish-plan.md` and is not built.

## What it is

- **The plan** is `bots/src/pit.mjs` `pitPlan`. The bots run the same code on the live world, and `scripts/host/pitplan.mjs` runs
  it over a region copy.
  - **Outline:** a curved cove, an ellipse 15 x 21 at (-51, -99) whose radius swells gently, then smoothed.
  - **Keep-out rim:** an outline column within 3 of any water or ice is never dug.
  - **Target:** each column's finished top is `max(floor 60, max over the dry ground round it of (height - distance))`. That
    gives 1:1 banks and a flat floor, and no step into or inside the bowl is over 1 (`steps2` 0 on P1).
  - **Cells by layer:** dug top down. The plan also lists leaves lying on the ground, and runs of up to 4 leftover blocks hanging
    over air (`p`).
  - **Held columns:** a lid over a cave that goes below the bowl is held whole (`cave_under`).
- **The record** is `pit@1`. Its `clear` holds every dig cell as a `cut`. Its `zones` hold the outline and the rim.
- **The dig** is the normal clear-dig visit (`buildrun.mjs runVisit`). The view holds the TOP LAYER's cells of the builder's half.
  Two builders work the W and E halves under their own leases.
  - **Live check before every dig:** `pitClearOk`, the sea-breach guard, refuses any water, ice, water plant, waterlogged block
    or lava within 3 columns, from 2 below to 2 above. It also refuses an unread cell, a cave under the floor, and solid ground
    above the cell. A refused cell is SET ASIDE and the dig goes round it.
  - **Unreached cells:** a cell no stand reaches for 2 visits is set aside too (`aside`).
- **Demand:** the pit is offered (`pitWanted`) only while the town is short of dirt for a named consumer:
  - the tidy's earth and topsoil fills;
  - the storehouse level's fills;
  - the grade, when a grade plan exists (none on this base).

  It is also offered while this bag owes the chests dirt. The tidy's earth fills now draw the town's dirt first (`pitFillSplit`).
  Chest pruning never sends town dirt down the well while a consumer has open cells (`pitHoldsDirt`).
- **The bank goes to TOWN CHESTS the index knows**, the place where `matsWithdraw` (the tidy's and the storehouse's draws) searches:
  1. the storehouse's DIRT column, when the column layout is on (`WAREHOUSE=hall`). It is off on the showcase today.
  2. chests already holding dirt;
  3. any chest with a free slot.

  A bag holding 32 above its keep of 16 banks first, using the whole visit. The bank clicks whole stacks, then halves
  (`sortPut` verifies by a re-open and writes the index).
- **Rows:** `_pit op=mode|demand|sited|dig|bank|guard|walk|done`.
- **Switch:** `PIT_SITE=-51,-99,15,21/60`, or `town-site.json` `"pit": {"centre": [-51, -99], "size": [15, 21], "floor": 60}`.
  With neither, there is no project.

## Evidence

### The plan over the real site

- **Data:** ci2 `~/world18full/region`, the 11-18 showcase copy. Files: `plan.json`, `pit-top.png`, `pit-iso.png`.
- **Size:** 543 cells over 225 columns, 26 rim columns and 5 `cave_under` columns.
- **Yield:** **508 dirt** (and 35 other blocks: leaves and stone), 1.8x the town's 287.
- **Layers:** y70-61, with most of the dirt in y64, y63 and y62 (124, 157 and 107).
- **No new 2-high step.**

### Tests

`bots/test/pit.test.mjs` passes 24/24, through the COMPOSED chain on a fake server: the plan, the record, the layer gate, the guard, and
the real `runVisit`, visit after visit.

- **Small world with a sea:**
  - dug fully, with no cell opened beside water;
  - every stage walkable;
  - top down by layer.
- **Water appearing after the plan:** the cells near it are set aside, the rest is dug, and there is no breach.
- **The REPLAY over the real P1 blocks** (fixture `bots/test/fixtures/pit-p1-world18full-1118.json`):
  - 540/543 dug in 28 visits;
  - 3 high leaves set aside as unreached;
  - no breach, and no new 2-high step.
- **Mutants**, each anchored and unique, each killed:
  - the guard blind to water;
  - the rim distance;
  - the layer gate off;
  - the demand digging while stocked;
  - the miss set-aside;
  - the bank halves;
  - the bank leg of the wanted state.
- **Structural wiring** (comments stripped): the dispatch, the visit's view and guard, the waiting and due states, the prune hold,
  the fill split and the order's completion.

### Codex

Eight rounds, the last three NO BLOCKERS.

| Round | Blocker found | Fix |
|---|---|---|
| r1 | whole-stack bank | halves (`pitBankSteps`) |
| r3 | the carried surplus hid the pit | `pitWanted` / `chest` |
| r3 | unloaded chests read gone | walk first |
| r4 | a surplus under bankMin stayed stranded | the wanted bank leg takes any dirt above the keep |
| r6 | the order's completion ignored the owed bank | `recordDamaged` |

### The rig (sandbox2, 11-20 16:06-16:55Z)

**Setup:**
- The world was a copy of `world.t11rig-20261118` with its regions replaced by ci2 `~/world18full/region`, so P1 is as the showcase
  held it on 11-18.
- The pool was a copy of ci2 `~/pool-1119b`.
- Bots: showcase-Iris and showcase-Kite (Echo and Gale were saved stuck in the copy and never left their spots), running
  `sandbox/pit/pitrig.mjs`. This is the T11 recipe with the death row; there are no survival reflexes.
- The world was restored afterwards and the lock released.

**Results:**
- **Demand:** the tidy's open earth/topsoil fills were 459-548 against 0 dirt in the town's chests, so the town was short.
- **Siting:** 16:09Z. The live plan was the same 543 cells.
- **Digging:** 31 dig visits with 536 `_build op=clear` rows. The pit read DONE at 16:36:42Z with 4 cells left, all leaves no stand
  reached (set aside).
- **Before/after over the region file** (`scripts/host/pitcheck.mjs`, `rig/check.json`):
  - **539 of 543 listed cells dug, 508 of them dirt.** 57 of the dug cells now carry a snow layer: it is a snowy shore.
  - **Water: 9,591 water/ice cells in the box before and 9,591 after, with no new and no gone water cell.**
  - **0 dug cells within 3 of water.**
- **Banking:** 9 banks put dirt into town chests, 466 dirt in all, verified by the chest re-open. The chests used were (12,71,-57),
  (-13,71,-8) and others. The index's town dirt went 0 -> 373 by 16:35Z.
- **Deaths:** 0 (`done-*`: `{"deaths":0}` for both bots).
- **Rows:** `rig/rows.txt`. Picture: `rig/pit-iso.png` (before | after).

**Found by the rig and fixed (r2, r5, r7):**
- A dig visit's tail could not bank, because the walk to town is ~120 blocks. Now a bank's worth banks first.
- A dug pit left one bot's dirt unbanked. A dug pit is now DUE for that bag.
- A full chest with room on its dirt stacks is now a target.

**Not shown on the rig:**
- the guard refusing a real water cell (none came within the rim; the chain tests show it);
- the `WAREHOUSE=hall` dirt column (off);
- the tidy drawing the banked dirt (no tidy visits ran);
- the prune hold acting.

### Full suite

ci3, worktree at 8e5c7072: 552/555. The three that fail are known:
- `nothing-important-is-orphaned` (bagdiet.test.mjs is missing on the base too);
- `well` (fails alone on the base too, on ci4);
- `reccache` (passes alone on this branch on ci4; it fails under load).

The final tree (e92e4132a, ci3) gave 551/555. The four that fail are known or fail only under load:
- `nothing-important-is-orphaned` and `well` fail on the base as well;
- `craftsync` (7/7 alone on ci4) and `lavastep` (1/1 alone on ci4) pass when run alone; each also passed in the first full run.

`npm run check`: eslint is clean. The movement-writers lint fails on the base with the same five files; none of them is this change's.
