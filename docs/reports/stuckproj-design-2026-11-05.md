# stuckproj-01: why 8 fleet town projects are stuck, and the fix (2026-11-05)

Fleet `aea83708` (+ canary leasegen-01 on placebo-d, board-a, hive-c, board-c). Branch **`stuckproj-01`** on aea83708
(tidydead-01's two commits, then canopy-01 + starve-01, then r1). Tier 2 by `scripts/lib/protected.py`.

## 1. Measured

Files on .31, `scripts/lib/telemetry.py` full walk, 24 h to 11-05 19:17Z: 1,574,042 skill rows, 80 bots, 3,752
`_build_visit` rows. World: region files on .30 read read-only (no world writes). Stands: an offline replay of
`buildsite.mjs walkFrom` / `stepFor` over a dump of each town (home +-64, y 55-95) with the pool's stood cells.

| project | visits 24 h (6 h) | placed 24 h (6 h) | blocker | cause |
|---|---|---|---|---|
| board-d wall | 1 | 0 | published 13:27Z; the monument took 475 visits | (a) starvation |
| isolated-b wall | 1 (0) | 9 | none since 11-04 23:48Z; monument 425 visits, 280 aborted, 0 placed in 6 h | (a) starvation |
| hive-d monument | 4 | 6 | L01-W 13,65,84 no stand; 3,625 cells wait; spruce grew in the layer | (b) tree |
| placebo-c monument | 54 (1) | 576 (0) | L00-W 294,70,107 no stand; 5,311 wait; oak canopy | (b) tree |
| isolated-a monument | 77 (2) | 616 (6) | L00-S 296,70,121 + 3; oak canopy | (b) tree |
| isolated-a wall | 5 | 0 | W-02 383,80,191 + 2; oak against the wall; waiver 12/12 SPENT (all on this tree's side); 251/255 | (b) tree |
| isolated-c monument | 499 (304) | 966 (173) | L02-N: 5 oak_leaves IN cells, `clear_failed no_stand` x370 each since 16Z | (b) tree |
| placebo-b tidy | 570 | 0 | T-05-5 `blocked` x549: one oak_leaves fill no stand reaches, 1/245 left | (c) tidy |
| hive-d tidy | 414 | 110 | `attempts_spent` x405: one fill no click lands on | (c) tidy |

Positive controls: the same walk finds `_build op=clear` 4,000+ rows (kind leaves 2,298, tree 423, foreign 398), `op=waived`
66, `op=deferred` 152, `op=stuck_on_cell` 79; `_shop_skip why=stuck_on_cell` 510 (isolated-a 173, placebo-c 176).

Replay (no stand BEFORE for all four; the natural leaves cut outside-in, each from a dig stand):

| cell | canopy cut | stand AFTER |
|---|---|---|
| hive-d 13,65,84 | 24 | 14,65,84 |
| placebo-c 294,70,107 | 77 | 294,68,108 |
| isolated-a 296,70,121 | 121 | 296,69,122 |
| isolated-a wall 383,80,191 | 47 | 382,79,191 |

Leaves in record cells had to be included (hive-d: L02 cells over L01-W hold the leaves, and L02 waits on L01-W).

## 2. Causes

- **(a) Starvation.** `shop.mjs activeProject` takes the first open project with a free slot; the monument (3 slots) almost
  always has one, so a later open project waits until an 8,000-cell ziggurat is complete.
- **(b) Trees.** Natural leaves of a tree grown on/against the build occlude every stand. Each remedy refuses correctly: sight
  needs clear cells, the void access digs only done record cells (`dig_not_record`), the waiver never hides skin, the wall's
  waiver is bounded (spent).
- **(c) Tidy dead cells.** Neither `blocked` nor `attempts_spent` defers, and the tidy waives only deferred cells.
- Not fixed here: isolated-b's monument visits cut by the stuck reflex (`aborted: stuck` x183) -- Codex: the reflex measures
  movement, not placement; a bounded stationary window for placement/ack phases is a separate piece.

## 3. Codex (independent, read-only) and reconciliation

Codex found the same three classes. Differences: for (a) it proposed every-4th-admission fairness with a town-shared counter;
adopted instead a starvation stamp read from the existing slot leases (shared, no new file), with the same stabilise-the-pick
rule it asked for. For (b) it proposed a bounded vegetation-clearance planner before access/deferral and on tree `no_stand` --
built as that. For (c) tidydead-01 (reviewed 11-05).

## 4. The fix (three switches)

- **canopy-01** (`CANOPY=off`): runVisit `p.canopy`. A foreign dig or placeable cell with no stand: natural leaves
  (`persistent=false`) and vines in a 7x7 box from one below to three above, highest first, each from a dig stand, passes while
  one dug; the cell is tried again. Never a done record cell, an independent segment's cell (Codex r1 BLOCK, fixed), another
  project's cell or a protected zone. 48 digs/visit; each cell once/visit. Monument, wall, workshop/house and tidy visits.
- **starve-01** (`STARVE=off`, `STARVE_MS` 30 min): an open, sited, incomplete, non-tidy project whose newest slot lease (else
  record publish) is STARVE_MS old is offered first, longest-starved first; one bot taking it refreshes the stamp; a bot is
  sent to a given starved project once per STARVE_MS; its starved pick holds for that visit only.
- **tidydead-01** (`TIDYDEAD=off`): the tidy's hard cells are deferred, so its waiver names them.

Tests: `bots/test/stuckproj.test.mjs` (19, fake server + pure, anchored mutants), `bots/test/tidydead.test.mjs`.

## 5. Queue

P lane, after dropdig-01 (S), before pause30-01. Draw preferably hive-d, board-d, placebo-b (isolated-* and placebo-c are
never drawn). If leasegen-01 promotes first, rebase (it touches buildproj.mjs leases).
