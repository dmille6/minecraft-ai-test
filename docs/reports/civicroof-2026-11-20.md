# civicroof-01show (2026-11-20): civicP's roof, finished in the palette's next choice

Branch `civicroof-01show` on the live release db59a782 (wellfix-01show-rel). Not protected (`scripts/lib/protected.py`, diff mode).

## Is there dark oak within a trip? No.

| Source | What was read | Dark oak | Positive control (same read) |
|---|---|---|---|
| Bots' map (atlas) | 15 `atlas-showcase-*.json`, pool copy 11-19 18:18Z | 0 `dark_oak_log` finds, 0 gone | 6,000+ finds: copper_ore 1,492, coal_ore 1,439, spruce_log 484 |
| Town index | `town-index-0_70_0.g16/g17`, newest observation per container (35) | dark_oak_log 0, dark_oak_stairs 0 | spruce_stairs 102, dark_oak_planks 4, dark_oak_slab 5 |
| Pool files | every file naming `dark_oak_log` | 9: road palettes, the use ledger, older index lines (4 logs, since withdrawn) | 405 files name spruce_log |
| Gather rows, 7 d | shortage report (ES) | 0 dark_oak_log gathered | gather x948 dirt in 24 h |

So the faithful route (a sized job: 6 logs -> 16 stairs) has nothing to fetch. The fallback applies.

## What the roof holds (the project's own intents, 11-19 12:45Z)

The brief said "8 dark oak stairs placed". There are **8 dark oak AND 3 spruce stairs** on the first course already: a bot that
carried spruce stairs placed them, because `blockFor` takes any name of the role the bag holds. Box-relative (x east, z south):

```
first course (y71)        D D D S S      D dark oak stair, S spruce stair, . open
                          D       S      underside (y71): 1 dark oak + 7 spruce planks, 1 open
                          D       .
                          D       .      upper course (y72): 8 open; its underside 1 open; cap slab open
                          D D . . .
```

16 of 35 cells open: 13 stairs (5 on the first course, 8 on the upper), 2 underside planks, 1 cap slab.

## The rule (bots/src/palchoice.mjs, every build through the building visit)

- Open cells are grouped by **course**: one segment, one role, one height.
- A course's candidates are its role's names in palette order; a course whose placed cells are all ONE later name continues it first.
- A name **has a source** when the bag + town hold enough for the course's open cells (counted across the visit's courses), or the
  bag + town hold the planks/logs its recipe takes (booked, so two courses never count the same logs; a whole log's leftover planks
  are booked back), or the atlas knows a live find of its log within 320 of home, or an open refill job brings it or its log.
- The town's zero is believed only when the index knows at least 0.8 of the town's containers (`matsTownStock` coverage); below
  that nothing is chosen and the rows say `town_unread(cov=..)`.
- The first candidate with a source is taken. The role's first name: nothing changes, no row. Another name: every open cell of the
  course is billed and placed in it and only it, and a `_palette_choice` row names what was taken and why. No source at all: nothing
  is constrained (the base), and the row says `none`.
- `PALCHOICE=off` restores the base.

For civicP: both stair courses take spruce (`first=dark_oak_stairs:none(held=0/5) took=spruce_stairs why=held:102`); the underside
and the cap keep dark oak (the town holds 4 planks and 5 slabs). The first course ends half dark oak (west and north-west), half
spruce (east and south-east): two runs, as it stood, never alternating; the upper course is all spruce; the cap dark oak.

## Rig (sandbox2, 11-20 13:26-13:46Z; lock taken and released; world restored)

Recipe: the T11 rig world copy (`world.drawshort-rig3-20261118`) loaded on sandbox2 (`sandbox/civicroof/rigworld.sh load`), civicP set
cell for cell from the showcase pool's own intents (`fixture.py`: 63 placed cells, 17 open, with their stair/log states; verified by
reading the saved region back: 63 blocks, exactly the fixture), the pool copy of 11-19 18:18Z, two bots (Haven, Iris) on the rig
harness `sandbox/civicroof/crrig.mjs` (the T11 rig's world id and death rows; the real idle steer and `build_shop`; every other
project held). The rig world (11-18) held 4 dark oak logs the showcase no longer has; they were taken out of the rig chest so the
rig's town matches the showcase's (0 logs).

| Run | What happened | Outcome |
|---|---|---|
| 1 (13:27Z) | The copied index (19 h old) knew no container: every name read 0, so the choice took spruce planks and a spruce slab though the town holds dark oak | stopped before any placement; **fixed**: the 0.8 coverage floor (`town_unread`) |
| 2 (13:31Z) | Recount fixed the index (34/35 known). The 11-18 world's 4 dark oak logs + 6 planks were counted by both stair courses | stopped before any civicP placement; **fixed**: craft inputs are booked |
| 3 (13:39Z) | Haven: `_palette_choice` y71 open=5 `took=spruce_stairs why=held:84`, y72 open=8 `held:79`; under and cap keep dark oak (no row). Drew `spruce_stairs:13, dark_oak_planks:2, dark_oak_slab:1, lantern:1`, `short=-`. Placed 15 (13:43:48-13:44:03), one cell attempts_spent; next visit placed it and the lantern | **13:44:36Z `_structure_complete project=civicP`**, roof `open=0 done=35`, deaths 0 (both bots `done` rows) |

The region read back after run 3: 80 blocks in the box above the ground, every record cell, nothing else: dark_oak_stairs 8,
spruce_stairs 23 (16 roof + 7 benches), dark_oak_planks 3, dark_oak_slab 1, lantern 1, spruce_log 12, spruce_planks 16, stone_bricks 16.

## Pictures (rendered from the rig world's region after run 3; `sandbox/civicroof/render.py`)

- `docs/reports/civicroof/civicP-roof-rig.png` (from the south-east) and `civicP-roof-rig-nw.png` (from the north-west), SVG beside them
- `docs/reports/civicroof/civicP-roof-before*.png`: the same box as the showcase holds it now
- `*-top.png` top-down (the stair's raised half lighter), `*-blocks.json` every block with its state

## Tests and reviews

- `bots/test/civicroof.test.mjs`: the pavilion sited by the bots' own siting with the live roof state; the choice, the bill and the
  REAL visit (the small vanilla judging each stair's state): the roof completes, all 13 new stairs spruce, the bag's 2 dark oak stairs
  never placed into a spruce course; the base (no choice) mixes (positive control). Mutants: first-name gate, continuation, coverage
  floor, craft booking, the bill's choice, the visit's choice, the skills wiring (structural).
- Codex r1 (the change): NO BLOCKERS. Codex r2 (the two rig fixes): NO BLOCKERS.
- Not protected (`scripts/lib/protected.py --base db59a782`).
