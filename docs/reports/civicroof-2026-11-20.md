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
  bag + town hold the planks/logs its recipe takes, or the atlas knows a live find of its log within 320 of home, or an open refill
  job brings it or its log.
- The first candidate with a source is taken. The role's first name: nothing changes, no row. Another name: every open cell of the
  course is billed and placed in it and only it, and a `_palette_choice` row names what was taken and why. No source at all: nothing
  is constrained (the base), and the row says `none`.
- `PALCHOICE=off` restores the base.

For civicP: both stair courses take spruce (`first=dark_oak_stairs:none(held=0/5) took=spruce_stairs why=held:102`); the underside
and the cap keep dark oak (the town holds 4 planks and 5 slabs). The first course ends half dark oak (west and north-west), half
spruce (east and south-east): two runs, as it stood, never alternating; the upper course is all spruce; the cap dark oak.

## Rig

(filled after the run)
