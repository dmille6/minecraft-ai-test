# Ground plan: first runs (2026-11-15)

The offline half of step N3 of [RECOMMENDATION.md](RECOMMENDATION.md). The tool is `scripts/host/groundplan.py` (tests:
`scripts/host/test_groundplan.py`, 12 behaviour tests and 15 anchored mutants, run from `npm test` through
`bots/test/groundplan.test.mjs`). It reads two saves of the same ground, the untouched world and the world now, classes
every column with the ground ledger ([ledger-first-run.md](ledger-first-run.md); the ledger's functions are imported,
not copied), and writes a plan: the exact cells to change so the ground is put back, cut into jobs. It reads save files
only and changes nothing in any world. The runs below were made on the test host ci2, one process at a time, at the
lowest priority.

    python3 groundplan.py --base <untouched>/region --live <now>/region --center 0 0 --radius 48 --ground-y 70 \
        --pool <dir of project records> --json plan.json

## The rules it applies

These are the owner's rules of 2026-11-15 ([consolidation-2026-11-14.md](../../decisions/consolidation-2026-11-14.md),
"the fill rule: Yes, dirt cap").

- **Fill, with the dirt cap.** Ground that is put back is cobblestone below and one layer of dirt directly under the
  surface block, because grass spreads only onto dirt. In an undermined column (the frame-zero surface block is still
  there, cells under it are dug out) every dug cell gets cobblestone, except the dug cell directly under the surface
  block, which gets dirt. A hollow that does not reach up to the surface block gets cobblestone only. In an open pit (dug
  from the top) the dug cells get cobblestone up to one below the frame-zero surface height, and dirt at that height,
  which grass will cover.
- **Wet cells are left out.** A dug cell that now holds water or lava is not in the plan; it is counted apart.
- **Owned ground is never touched.** A column in which a town project record owns any changed cell is of class `build`
  and gets no fill, no cut and no pick-up.
- **Cut.** Bot-placed blocks that no record owns and that stand above the frame-zero surface, in columns of class
  pillar, raised or over_gap, are cut, top first. A placed block at or under the frame-zero surface (class `filled`) is
  left alone.
- **Pick up.** The ledger's loose things that no record owns (crafting tables, furnaces, chests, torches, trapdoors and
  the like) go in a separate list with their block names. Anything with an inventory (chest, barrel, furnace, smoker,
  hopper and similar) is flagged `has_inventory`: it must be emptied first, not just broken. A thing standing in a cell
  that is to be filled (a crafting table in a hollow) is listed as well and flagged `in_fill_cell`.
- **Mining is not repaired.** Dug cells deeper than the ledger's mine depth (8 blocks under the frame-zero surface) are
  counted, never planned.

**Jobs.** The cells of one 6 x 6 block of columns make a job, at most 24 cells each. A tile with more is split by depth:
lowest first for fills, highest first for cuts. Within a fill job the order is bottom-up, so no cell is listed before
the cell under it when that cell is in the plan too; the tool checks this on its own output and stops if it does not
hold. Each job carries an id, its kind (fill, cut or pickup), the tile, the ordered cells as [x, y, z, block to place or
remove], counts by material, and its distance from the centre. Jobs are ordered: cuts of pillars first, then the other
cuts, then pick-ups (a pick-up can stand in a fill cell, so it goes before the fills), then fills, each group nearest the
centre first.

## Tests and controls

- `python3 scripts/host/test_groundplan.py`: 13 of 13 checks pass (12 behaviour tests and the mutant run). The behaviour
  tests cover the dirt cap in undermined columns of depth 1, 2 and 3 and in a hollow that does not reach the surface; an
  open pit; a pit with water at the bottom; a pillar cut top-down, a raised block and a deck; an owned cell, with an
  unowned twin beside it as the positive control; a build column; a filled column; a chest flagged and a crafting table
  not; deep mining, and the same cells planned when the mine depth is raised; the 24-cell limit and bottom-up order
  across a split tile; the order of jobs; and an untouched world giving an empty plan, with one pit making it non-empty.
- Each of the 15 mutants asserts that its anchor is present exactly once in the source, and each is killed, every one
  by a failed assertion of the rule it breaks (checked one by one): the dirt cap, the surface-gone dirt height, the wet
  exclusion, the owned-cell exclusion, the bottom-up sort, the job size limit, the cut order (twice), the filled class,
  the build class, the inventory flag, the mine depth, the order of job kinds, the nearest-first order, and the empty-plan
  check.
- **Positive control on real data:** the showcase's untouched world given as both inputs, radius 64: 16,641 of 16,641
  columns natural, 0 cells to fill, 0 to cut, 0 things to pick up, 0 jobs. (The radius-48 box lies inside it.)
- **Chunks:** 49 of 49 read, none missing, in both saves for radius 48; 81 of 81 for radius 64. A box with a missing
  chunk is refused.
- **Agreement with the ledger:** the column classes below are the same numbers, class for class, as the ledger's first
  run on the same saves.

## The showcase town

Untouched world: regenerated from the showcase's seed on 11-08. Now: the time capsule, saved 2026-11-14 15:50:17Z. Project
records: the capsule's pool. Centre 0, 0; box y 46 to 110; squares of radius 48 and 64.

| | Within 48 | Within 64 |
|---|---|---|
| Columns read | 9,409 | 16,641 |
| of which build / undermined / pit | 2,180 / 5,733 / 588 | 3,260 / 9,023 / 1,049 |
| of which pillar / raised / over a gap / filled | 27 / 119 / 85 / 13 | 44 / 174 / 211 / 46 |
| of which changed only / natural | 145 / 519 | 255 / 2,579 |
| **Cells to fill** | **20,878** in 6,321 columns | **32,091** in 10,070 columns |
| of which cobblestone | 15,248 | 23,204 |
| of which dirt | 5,630 | 8,887 |
| **Cells to cut** | **295** | **563** |
| by column class: pillar / raised / over a gap | 73 / 119 / 103 | 124 / 174 / 265 |
| by block | grass 120, cobblestone 91, dirt 54, other 30 | grass 247, dirt 165, cobblestone 109, other 42 |
| **Things to pick up** | **76** | **116** |
| by name | crafting table 36, furnace 15, spruce trapdoor 10, torch 7, chest 5, wall torch 2, composter 1 | crafting table 49, furnace 26, torch 11, spruce trapdoor 10, spruce fence 8, chest 5, lantern 2, spruce stairs 2, wall torch 2, composter 1 |
| with an inventory, to empty first | 20 (15 furnaces, 5 chests) | 31 (26 furnaces, 5 chests) |
| standing in a cell to be filled | 23 | 41 |
| **Jobs** | **1,127** | **1,760** |
| cut (of which pillars) | 69 (15) | 141 (23) |
| pickup | 54 | 77 |
| fill | 1,004 | 1,542 |
| Wet cells left out | 0 | 11 (water) |
| Dug cells deeper than the mine depth, not repaired | 20,828 | 31,285 |

Fill jobs average 20.8 cells; 747 of the 1,004 fill jobs within 48 are full at 24 cells. 223 of the 273 tiles with fills
within 48 had to be split by depth, into up to 8 jobs. The first job in the plan is a three-block pillar 3.5 blocks from
the centre.

**What that many fills would take.** The bots placed about 1,000 tidy fills in 30 hours of logs. At that pace, and this
is arithmetic, not a measurement: 20,878 fill cells within 48 would take about 626 hours, or 26 days of the whole town's
fill work; 32,091 within 64 about 963 hours, or 40 days. The cuts and pick-ups are small beside it (295 and 76 within 48).
The dirt needed within 48, 5,630 blocks, is about a third of the 15,248 cobblestone.

## What the rules do not yet cover, found in the data

- **Placed blocks above the surface in undermined columns are not cut.** A column has one class, first match wins, and
  `undermined` comes before pillar, raised and over a gap. Within 48 there are 1,327 such placed cells in 1,062
  undermined columns (2,380 cells in 1,819 columns within 64). Their top block is grass in 580 of the 1,062 columns,
  dirt in 285, cobblestone in 167. In 601 of them the frame-zero surface block is gone and a block was placed one higher:
  the lawn has been moved up a block over the hollow (for example column -48,23: grass was at 66, now 65 and 66 are air
  and a grass block sits at 67). The plan fills the hollow and leaves that raised lawn, which will then stand one block
  proud. In the other 461 the surface still stands and the placed blocks float above it. The owner should say whether
  these are cut too, and the lawn one block up is the case to decide.
- **The lowest fill often has air under it.** In 1,040 of 6,321 fill columns within 48 (1,578 of 10,070 within 64) the
  lowest planned cell has air under it: in 907 the cells under were dug deeper than the mine depth (mining is not
  repaired, so the fill sits over a mined void), in 133 the air was there at frame zero (a natural cave). A bot can place
  such a block only against a side neighbour, and the void stays.
- **Hollows in columns of other classes are not filled.** 57 dug cells in over-a-gap columns and 10 in filled columns
  within 48 are left (61 and 25 within 64).
- **Placed blocks under the surface** in undermined columns (434 cells within 48) and in filled columns (15) are left,
  as the rule says.
- **The dirt cap where frame zero had no soil:** 10 of the 5,630 dirt cells within 48 (43 of 8,887 within 64) go where
  the untouched world had sand, stone or similar at the surface. The rule puts dirt there all the same.
- **Replaced blocks** (stone that is now cobblestone, and the like) are not in the plan: 9,745 cells within 48.
- **Inside build columns** 12,032 changed cells within 48 are left untouched, as the rule says, with 18 loose things.

## What the plan does not do yet: next steps

1. **It does not check that a bot can stand and reach each cell.** A job is a tile of cells, not a proven standing spot
   and way in. The next step reads the saved blocks around each job and proves a standing spot, the way in and the way
   out, as the recommendation asks.
2. **It does not read the block history.** Ownership comes from the project records and from the difference with the
   untouched world only. The server's block history (from 11-07 for the showcase) would say which bot placed or dug each
   cell, and would separate what a project dug on purpose (a cellar, the mine stair), which the records do not list.
3. **It does not publish into the bots' own record format.** The plan is a JSON file on the host. Handing jobs to the
   existing worker code needs it written as the bots' project records, and an acceptance test that takes a job as done
   only when the world's files show every cell at target.
4. The owner's call on the gaps above, first the lawn moved one block up over a hollow.
