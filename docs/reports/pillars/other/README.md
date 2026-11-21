# pillars-01show follow-up: the wider set (owner 11-20, "remove all the pillars natural and unnatural")

Source: the same 11-20 04:15Z showcase copy and the same column scan (`bots/scripts/pillar-colscan.mjs`). Every candidate is a
column 3+ over the median of its 5x5 neighbourhood, outside the walls and every project box. The ones already on the proven list
are left out. Each remaining column is judged by `pillarclean.mjs columnGuard` (the control session's guards) and by the survey's
zone and pit guards (`scripts/host/pillar_survey.py --other-out`).

## What each guard drops, out of the 5,331 unproven columns

| guard (first that holds, in this order) | dropped |
|---|---|
| touching a protected zone (the villages, the trial chambers; padded by 1) | 912 |
| the North Pit's site (P1 + 2) | 1 |
| unread (the copy does not hold a neighbour) | 30 |
| tree: a log, wood or leaves in the column, on its sides or just over it | 178 |
| plant: cane, bamboo, cactus, kelp, vines, dripstone... in or beside it | 0 |
| ice: ice, packed or blue ice, a snow block in the column (ice spikes, icebergs) | 0 |
| material: not the ground's own block (planks, bricks, walls, glass: a structure's) | 131 |
| holds: something on its top (grass tufts, flowers and snow layers go with it) | 11 |
| **not lone: a block on one of its 4 sides at any height of it, i.e. a slope or cliff edge, a hillside, a wall** | **3,963** |
| passes every guard, but over 160 from home (the visit's walk radius) | 27 |
| **passes: the wider list** (`bots/src/pillarclean/showcase-other.json`) | **78** |

So **3,963 of the 5,331 are slope and cliff edges**: under the vision's rule they stand 3+ over the median, but they are not
open on all four sides. Only 78 + 27 are real lone columns.

## The 78, by place and block

| where | columns | top blocks |
|---|---|---|
| land | 54 | dirt 29, grass 23, cobblestone 2 |
| sea (ice or water at the median) | 23 | dirt 20, grass 2, cobblestone 1 |
| beach (sand at the median) | 1 | sand 1 |

- **Every block in them** (118): dirt 85, grass 26, sand 4, cobblestone 3. No natural stone survived the guards.
- **Heights:** one block 56, two blocks 10, three 6, four 6. Most are a single dirt block left hanging 3+ over the ground: what a
  bot's pillar leaves when its lower blocks were taken. They come from before CoreProtect's 11-07 start, so they cannot be proven.

## Files

- [map.png](map.png): the 78 on the town map, home ±160. The legend's "CoreProtect" line is the renderer's own; this list is not proven.
- [columns.csv](columns.csv): x, z, where, median, top, blocks.
- 10 sampled columns, spread over the list, each with a west-east and a north-south slice through it from the 11-20 copy (listed
  cells outlined magenta): [01](sample-01.png) [02](sample-02.png) [03](sample-03.png) [04](sample-04.png) [05](sample-05.png)
  [06](sample-06.png) [07](sample-07.png) [08](sample-08.png) [09](sample-09.png) [10](sample-10.png) ([samples.json](samples.json)).

## How the bots treat them

- They are the same lap and the same rules as the proven list: top down, to the median, from a ground stand, the sea guard, and no stand on
  a listed block.
- Two more checks run at the dig (`lone`):
  - the block is still one of the ground's own;
  - all 4 sides are still open (air, water or ground cover).
- A block that has gained a neighbour since the survey is held as `not_lone` and never dug.
- Progress is counted apart: `proven=n/1440 other=n/78` on every `_pillarclean` survey and pass row.
- The host can refresh the list by dropping `pillarclean-other.json` in the pool directory.

## Rig on the final code commit a505fcde (sandbox3, 20 min, lock taken and released, world restored)

- **Setup:**
  - The same backup copy and the same pool copy, from `git archive a505fcde3`.
  - Delta started from its own position. Juno walked to the south side (-20,50) and Kite to the north beach (0,-118), with the pathfinder's own walk. No command moved a bot.
- **The bots:** 69 laps, 225 blocks dug (23 of them sea pillars' blocks).
  - **Deaths: 0.**
  - **Digs with water under the bot's feet: 0.**
- **Pillars taken down, the two lists apart:**
  - proven: 171 of the 1,440 (21 of them sea pillars);
  - other: **14 of the 78**, all of them on land.
- **Off-list solid blocks removed** (whole-world diff against both lists): **0.** The other changes are growth: leaves 76, logs 12, grass 17.
- **No wider-set column was dug from the sea.**
  - The 23 sea columns of the 78 are hanging blocks over the frozen sea, away from the shore. No stand off the ice reaches them, so the sea guard leaves them.
  - Kite set them aside after two laps and worked the proven ones.
- **Pictures:**
  - [rig/map-after.png](rig/map-after.png): the 78 after the rig (green: taken down).
  - Ten of the 14 taken down, as before/after pairs: `rig/taken-NN-before.png` / `rig/taken-NN-after.png`, NN = 01..10 ([taken.json](rig/taken.json)).
- **Codex r3** (the follow-up commit only): BLOCKERS none.
- **Full suite at a505fcde on ci3: 555/558.** The 3 failures (`lavastep`, `nothing-important-is-orphaned` (bagdiet), `well`) are the base's own (b27f5218 on ci3: the same 3).
