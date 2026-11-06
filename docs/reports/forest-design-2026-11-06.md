# forest-01 — the managed forest outside the walls; the in-wall tree farm retired (2026-11-06)

**Owner, 11-06 ~13:40Z, verbatim:** "yes design and build, remove the tree farm from inside city walls, turn that area into
something useful or nice to look at. make sure the bots level the land, clean up holes and junk, then when they cut down a tree
outside the walls replant in an clean organized way."

The proposal the owner approved earlier: a managed forest beside each town, just outside the walls and inside the simulation
distance. Fell a strip, level it, replant it in neat rows with walk paths between them. Harvest the oldest strip in rotation so the
forest supplies its own saplings. Put bone meal on the newest strip. Make it part of the groundskeeper's outward work.

Ledger row: `forest-1106` (config/owner-commitments.json). Memory: `owner-managed-forest-1106.md`, `forest-1106.md`.

## 1. Measured: why the in-wall farm failed

Data: showcase logs 10-31 to 11-06, 1.44 M rows from 15 bots; the record
`/var/lib/mcai/_pool-showcase/project-0_70_0.treefarm.g3.json`. Rows are counted with `scripts/lib/telemetry.py`, full walks.

The farm: 4x4 single spruce plots at spacing 4, box -39,4..-23,20, inside the wall, floor at y 66. It was sited 10-31 14:40Z and
marked complete 10-31 20:23Z.

- **Not one grown tree was ever felled.** Of 245 grown-harvest rows, 0 succeeded: 215 `grown_failed why=no_safe_target` and 30
  `arrived_out_of_reach`. That covers 9 distinct plots, with the last attempt 11-02. The positive control: the same harvest
  felled 25 site trees in the same box.
  - The mechanism (code read, both engines): `farmFootprint` covers the plot plus 10 cells above it, which is every trunk cell.
    That set goes into `bot.shopFootprint`, and `shop.mjs footprintCost` prices it at 100 on the walk and gather profiles.
    mineflayer-pathfinder's `safeToBreak` refuses any cell priced at 100 or more. `collectManually` re-asks `isSafeToBreak` and
    throws `unsafe_now`, with failClass `no_safe_target`. In short, **the farm's own keep-out forbade felling its own trees.**
- **It starved.** The last treefarm `_build` row is from 11-02: a `stuck_on_cell` on segment L, the torches. A complete farm is
  only upkeep, and upkeep comes after every open project and every sink.
- **It blocked coal runs.** A record box becomes a zone from y -64 to 320. Of 5,556 `_coal_site` rows since 10-31, 389 refused a
  run on `project:treefarm` (15 of 665 so far on 11-06). Those are runs at y 42 to 59, about 20 blocks under the farm.
  - The task brief gave "664 refused today". That figure is the total of all `_coal_site` rows today, not the rows on the farm.
- **Saplings on hand:** the 14 bags live in the last 60 minutes hold 66 spruce saplings and no oak or birch. They also hold 204
  spruce logs and 0 bone meal. **It is a spruce world.**

## 2. Paper proof (sandbox4, lock `forest01`, 13:39–14:12Z)

The proofs are `sandbox/forest/forest-proof.cjs` and `forest-proof2.cjs` (on the branch). Their logs are in
`docs/reports/forest-2026-11-06/`. The server is the oracle: every block is read back with `execute if block`.

| what | result |
|---|---|
| growth, trunks 3 apart along the row and rows 3 apart | spruce flat 24/24, spruce sunk 24/24, birch 10/10, oak 10/10 |
| trunk heights from saplings | spruce 5–8 logs (8 logs: 2/24 flat, 2/24 sunk), birch 5–7, oak 4–7 |
| **side stand, never moving: highest log felled** | **dy +6 above the feet, every tree. dy +7 refused 2/2** |
| flat plots felled whole | spruce 22/24 (both 8-log trees left a floating top log); birch 10/10; oak 10/10 |
| **sunk plots** (soil one block below the floor, sapling level with the aisle) | **spruce 24/24 whole, including both 8-log trees** |
| 2x2 spruce cluster | 2/2 grew a MEGA spruce of 57 logs, which no stand reaches. **2x2 is rejected.** |
| stump stance on an 8-log flat tree (dy 1..6 from the side, pathfinder onto the stump, dy 7, then the stump under the feet) | 7/7 whole (two runs, excluding each run's first trial). The first dig after each spawn was refused by the server (2/2). **Not used** (Codex r2): a failure after the low logs leaves the top floating, so such trees are kept instead. |
| sunk plot, 8-log trunk: logs reaching the bag | 7–8/8 from the stand; 8/8 after stepping into the plot and back |
| pathfinder to a stand through a leaf-filled aisle | 3/3 arrived, about 3.2 s each |
| self-supply: 6 spruce, 340 leaves (57 per tree) | all decayed in 4 min at rtick 60. A bot walking the aisle picked up **9 saplings (1.5 per tree)**, against 2.8 expected if every drop were collected. One sapling per tree is needed. |

## 3. The design (Claude), and how it answers the three failures

**(1) A guaranteed felling stand for every planted cell.**
- **Geometry:** rows along x, trunks 3 apart; rows 3 apart in z. A **strip** is two rows sharing a 2-wide aisle (row z0, aisle
  z0+1..z0+2, row z0+3). Strips are 6 apart, with a 2-wide walk path between them, and a 1-wide margin runs round the box.
- Every trunk is at least 3 from every other. That is outside spruce's growth room (radius 2 from layer 2) and oak and birch's
  (radius 1).
- **Every plot is sunk one block**, and its stand is the aisle cell straight beside its trunk, fixed in the record. The harvest
  walks to the stand and digs the trunk **top down, stump last**. It uses the build effects' own `e.dig`, which no walk price
  touches.
- An interrupted felling leaves a shorter tree, never a floating log.
- A tree the stand cannot fell is **kept**, its plot waived, never half-felled: a branchy fancy oak, a trunk taller than 8 logs, or
  a tree that failed 3 times off the clock.
- The footprint prices only the trunk column for walks. The stands and aisles stay walkable.

**(2) Perpetual, and actually visited.**
- The record never completes into silence. `forestDue` is read from the world on every visit. It is due when:
  - the in-wall farm is not yet retired;
  - a ripe strip waits;
  - a plot is open and a sapling is to hand;
  - a dropped sapling lies in the box.
- An open plot with no sapling anywhere is not due, because the visit could only wait.
- **Rotation:** strip states are read from the plot census. A strip is ripe at 3/4 trees. The forest harvests one strip at a
  time: the one already being harvested, else the ripe strip planted longest ago. It starts a new strip at least 2 h after the
  last began, so the strips stagger.
- A felled plot is replanted at once. The sapling supply is the strip's own decaying leaves, swept up afterwards.
- **Bone meal** is the bag's only, at most 4 per visit, on the newest strip. The visit draws none, because the town's bone meal is
  the decorator nursery's.
- **The groundskeeper works it.** `keeperOrderPure` puts the forest first for the keeper while it wants work. The keeper lease is
  kept while the forest wants work. Every other bot never sees it: an unsited forest reads waiting, a sited one reads standing.
- A no-effect visit rests the forest for that keeper for 20 min, and the tidy goes on meanwhile.

**(3) The reservation is a y-band.**
- The record names its own zone: the box + 1, from the soil - 4 to the floor + 14. Siting keeps off it. A coal run 20 below does
  not.

**Siting.**
- Outside every wall ring, the wall and its extensions, by 4.
- Every column within 5 chunks of home's chunk, which keeps it in simulation distance 6.
- Every column within 72 (Chebyshev) of home, so the build's walk (`forestWalkR`) and the tidy's reach it.
- In the land plan's `treefarm` sector, or else `wild`. Never in homes, farms or industry, never in a protected zone or village,
  never on a road corridor.
- One level floor for the box: fill at most 3 and cut at most 3 per column, so the hills stay.
- Plantable soil under every sunk plot.
- **It prefers existing fellable trees** (-3 cost per tree). A tree no ground stand fells refuses the site.
- The biggest size that fits wins: 3 strips x 2 rows x 6 trees = 36 trees in an 18x18 box, else smaller.

**Outside trees replanted in an organized way.** `tidy.mjs replantCells` is the outbands' road and band trees and the plot prep's
trees. It now gives the forest's next open row plot first, in row order. It never uses the strip being harvested, and never a plot
beyond the tidy's own walk. Only the trees left over go where they went before.

## 4. The old farm's area: options and the choice

| option | for | against |
|---|---|---|
| **A. the town GARDEN, a second park on its ground** | Reuses the proven park machinery (terrace.mjs `parkTopUp` / `parkLayout`: a cross path, four seeded quadrants, a hedge with entrances, flowers / azalea / a tree / meadow as the town holds them). The ground is already level at y 66. The decorator's nursery feeds it flowers over time. | Thin at first: the town holds no flowers yet, and the decorator measured 0 on 11-04. |
| B. a market square (a paved plaza with stalls) | Useful and lively | A new blueprint (planks, fences, slabs), a new stand and Paper proof; no trading use yet |
| C. a building plot for a cottage (townstyle) | Useful; the cottage is waiting on `no_proven_site` | The cottage sites only on the wall extension's house plots (cottage.mjs `cottagePlotOf`): a code change in a project another agent owns, and the plot may still not prove |

**Chosen: A.** Both engines picked the park independently; Codex: "fewer dependencies than stalls or a building".

The retirement, worked by the forest's keeper:
- Fell every grown tree top down from a side stand, stump last. A tree the side stand cannot fell **whole** is never started: it is
  kept, standing, as one of the garden's trees. That covers an 8-log spruce on the old flat plots (its top is at dy +7), a branchy
  tree, and a tree that failed 3 times off the clock. The stump stance proven in Paper was dropped in r2.
- Dig its saplings (they go to the forest) and its torches.
- Scan each plot column whole, so an interrupted felling is resumed, never read as done.
- Keep any tree it cannot fell whole as a garden tree.
- Publish the farm retired: no cells, no zone, no box, and `retired` / `retiredClear` / `retiredAt` kept for the showcase read.
- Site `land.garden` (the old box less a 1-column margin, reserved like the park). The keeper's `gkPlanAdditions` tops the garden
  up with `parkTopUp`, segments `T-PUG<n>-*`.

The ground is left level: the old floor was graded at siting, the stumps come out top down, and the torch cells are dug. Dropped
items inside the walls are the keeper's sweep (gksweep).

**Not handled (named):** the old farm's waived floating site log at -28,74,4. It is 8 above the ground and the cavefall refused it
("drop 6 onto solid"); no side stand reaches it. It needs a temporary stand (tidy.mjs plotprep's stone stand) or an owner-directed
one-off. It is not in this piece.

## 5. Codex's independent design (given the measurements and the goal, not this design) and the reconciliation

Codex's full answer is in `docs/reports/forest-2026-11-06/codex-design.txt`. Where the two designs met:

| point | Codex | Claude | reconciled |
|---|---|---|---|
| felling stand | a temporary **3-rise stone staircase** per tree (6 blocks), trunks 4 apart, rows 9 apart, 18 trees in 27x27 | a **sunk plot** with a fixed aisle stand, trunks 3 apart, rows 3 apart, 36 trees in 18x18 | **Sunk.** Paper: 24/24 sunk spruce felled whole from a ground stand; no stair to build, take down or prove; twice the trees on a third of the ground. Codex's caution about reach was right: flat plots do fail (2/24). |
| 2x2 spruce | not initially; mega spruce needs its own access | rejected | agree; Paper: 57 logs |
| oak | needs branch enumeration (fancy oak) | branchy trees kept, plot waived | agree (kept, never half felled) |
| siting | outside wall + extensions with a 4 buffer; within 4 chunks of an occupied anchor; prefer the treefarm sector and existing trees | same, 5 chunks of home's chunk (sim 6 - 1), plus a 72 walk cap | wall gap 4 adopted; 5 chunks kept (the town's bots stand across it) |
| scheduling | the groundskeeper; a resumable visit, 120 s every 10 min while actionable | the keeper's order, forest first while due; idle rest 20 min | equivalent |
| outside replants | durable forest-cell claims before felling | the forest's open plots in row order, never the harvesting strip, within the tidy's walk | claims are implicit: a cell is open until planted; double credit cannot outlive one stage (B4: a stage fells only once its replants stand) |
| reservation | 3-D zones G-3..G+12; separate siting exclusion from action authorization | zone G-5..G+14; footprint prices the trunk column only; harvest by e.dig | agree |
| old farm | retirement record, keep reservations until transfer, zero floating logs, level 66 | the same (retired / retiredClear / retiredAt, the read's rec_pre, tidy_guard release at retiredAt) | agree |
| old farm area | **park** | **park (garden)** | agree |
| self-supply | sapling escrow before each harvest | the strip's own drops swept; rotation pauses only through `due` (no sapling, no replant visit) | the measured 1.5 per tree against 1 needed is enough; escrow is a follow-up if live reads show a deficit |
| Paper | three full rotations, restarts, competing bots | geometry, reach, growth, mega, stump stance, drops, aisle, self-supply | one rotation's mechanics proven; the long-run rotation is the showcase's to show (this is not a canary) |

## 6. Reviews (fun mode, not protected, but resting on mineflayer behaviour: two engines)

- **r1, both engines:** 5 blockers from Claude and 4 from Codex, overlapping. All are fixed in `2e0a9100`:
  - the crop farm and cane bed `after` the farm that left the order;
  - the build's `walkR`;
  - the retirement's column scan stopping at the first gap;
  - the retirement no longer due once the forest was quiet;
  - an aisle-leaves due the visit could not act on;
  - a failing tree stalling the strip.
- **r2:**
  - Codex: a failed stump stance left a floating top, which was then kept. Fixed: no stump stance; such trees are kept whole.
  - Claude: a waived site tree lost its held columns, so a levelling cut could float it. Fixed: `siteTreesHolding`.
  - Both fixes are in `f1b5e53a`.
- **r3, Codex:** NO BLOCKERS. It executed checks of the felling across trunk heights 1–15, top-down interruptions, and waived and
  unknown site-tree holds.
- **Fleet port** `forest-01-on-9e9284d7`: one Codex round, see the ledger row.

## 7. The showcase tripwire (main: docs/reports/shop-01-2026-10-25/shopread.py.txt)

**New rows:**
- forest: `_build project=forest op=sited|place|clear(kind foreign|cut|stand|aisle)|harvest(kind grown|site|*_failed)|use(kind bonemeal)|waived|rotate|sweep|garden_sited`;
- treefarm: `_build project=treefarm op=harvest kind=retire|retire_failed`, `op=clear kind=retire|stand`, `op=retired`, `op=waived kind=kept`;
- tidy: `_build project=tidy op=garden_topup` (the garden's cells are tidy record cells, judged by tidy_place_ok).

**Rules added:**
- **FR1:** a forest felling is a `*_log` in a plot column of a generation (kind grown), or a listed site-tree log (kind site).
  Anything else is H2 ` forest_fell`. A felling is a mutation, so G3 judges it. A `*_failed` row is not judged.
- **FR2:** stand and aisle leaves are a `*_leaves` block in a generation's box + 1, from level - 3 to level + 5. Anything else is
  H2 ` forest_leafrule`.
- **FR4:** bone meal must land on a plot cell, else H1 ` forest_meal`. It is a mutation (G3).
- **RF1:** the retirement's digs, checked against the farm's chain:
  - logs in the old plot columns;
  - saplings on its plot cells;
  - torches on its light cells;
  - stand leaves in the old box + 1, up to 3 above its plots.
  - Anything else is H2 ` farm_retire`.
- **RF1, the farm's earlier rows:** the retired head judges them with their retired cells and clears (`rec_pre`), as the wall's
  retirement does.
- **RF1, `tidy_guard`:** it releases the farm's cells at **its own** `retiredAt`, not at the wall demolition's completion.

The no-change rows (`op=waived|rotate|sweep|garden_sited|retired`) are not mutations. None of the refusal tags reads as tree
debris; the selftest checks them against showcase_trip.py's `TREE_DEBRIS`, which caught `forest_leaves` and led to the rename.

- Selftest: ok. The mutant runner: **202/202 killed** (192 before plus 10 new). The selftest also carries 5 inline text mutants.
- **Live replay** on the showcase host (a copy of /srv/showcase/trip with the new shopread; a copied ACK.json; `--no-crash
  --no-census`; 180 min, with the town history from TOWN_SINCE): the S6 defects are **identical** to the installed read (H5 27,
  all else 0, verdict REPORT both, pre-existing).
- It is **not installed.**

## 8. Pieces, tiers, queue

- **forest-01show** (showcase; tier 2, not protected): branch `forest-01show` on the live release `b1d5b17e` (fellfirst-01). It is
  ready to stage. The release agent folds it, with the shopread FR/RF rules installed alongside (the stage replay gate's R1: the new
  row shapes need this reader).
- **forest-01 fleet** (tier 2): branch `forest-01-on-9e9284d7`, on gkforever-01, the canary in the slot. It carries the forest and
  the replant routing. FOREST is on in every named pool by default, so the build reaches only the canary's pools until rollout. It has no in-wall farm retirement and no garden: the fleet has no project tree farm, and its land plan has
  no park machinery. It is a draft queue entry only, as a P lane piece after gkforever-01 is KEPT and promoted.
  - **It supersedes treefarm-05** (`946c8aaa` on 4f3b0f5c, queued, on hold). That is the tree farm in idle mode, sited outside
    the wall or small when the walled area is full. It keeps treefarm.mjs's harvest and its `farmFootprint`, which still prices
    every trunk cell plus 10, so its grown harvest would fail as the showcase's did (0/245). The recommendation is to cancel it.
