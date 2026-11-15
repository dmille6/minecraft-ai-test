# Ground ledger: first runs (2026-11-15)

Step N1 of [RECOMMENDATION.md](RECOMMENDATION.md). The tool is `scripts/host/groundledger.py` (tests:
`scripts/host/test_groundledger.py`, 12 behaviour tests and 11 mutants, run from `npm test` through
`bots/test/groundledger.test.mjs`). It compares an untouched copy of a world with the world now and gives every column a
class. It reads save files only; nothing was run on any world's server. Both runs below were made on the idle test host
ci2 from copies.

## Controls

- An untouched world against itself: every column natural (both worlds).
- The showcase capsule against the WRONG untouched world (the rehearsal's seed): 9,409 of 9,409 columns not natural.
  So the tool does not call things natural by default, and a wrong baseline is loud.
- No chunk missing in any save read (81 of 81 under each box).

## 1. The showcase time capsule against its untouched world

Untouched world: regenerated from the showcase's seed on 11-08 (`~/bw3-genesis/showcase` on ci2). Now: the capsule,
saved 2026-11-14T15:50:17Z. Box: y 46 to 110. Columns by class:

| Within | Columns | Build | Undermined | Over a gap | Pillar | Raised | Filled | Pit | Changed | Natural |
|---|---|---|---|---|---|---|---|---|---|---|
| 32 | 4,225 | 670 | 2,392 | 58 | 26 | 110 | 9 | 381 | 121 | 458 |
| 48 | 9,409 | 2,180 | 5,733 | 85 | 27 | 119 | 13 | 588 | 145 | 519 |
| 64 | 16,641 | 3,260 | 9,023 | 211 | 44 | 174 | 46 | 1,049 | 255 | 2,579 |

Cells within 64: 12,172 placed, 41,005 dug within 8 of the original surface, 31,285 dug deeper (mining), 14,487
replaced. Dug at the surface, by what was there: dirt 24,673, stone 9,880, grass 4,743. Things no build record owns:
38 crafting tables, 25 signs, 11 torches, 11 furnaces, 11 chests, 10 trapdoors, 8 fences.

### The lawn is not a deck. The ground under it was dug out.

Before this run the working guess (11-14 morning) was old bridges and scaffold at plaza height that grass spread over.
The ledger says otherwise, and the sample columns agree:

- Of the 5,733 undermined columns within 48, the top is still at its original height in 3,612, and in 3,103 the top
  block is the very block the untouched world has there. 5,591 had a natural grass top.
- A typical column: grass on top, untouched; the two or three dirt blocks under it gone; the stone under that untouched.

```
col 4,22      y=70 grass_block (original)   y=69 dirt -> air   y=68 dirt -> air   y=67 dirt -> air   y=66 stone (original)
col -40,10    y=67 grass_block (original)   y=66 dirt -> air   y=65 dirt -> air   y=64 stone (original)
```

- Only 85 columns within 48 are a placed block over a gap.

The server's block history (which starts 11-07) names who did it. Dirt and grass blocks broken and placed within 48 of
home, y 58 to 72 (37,210 rows matched of 523,533):

| Day | Broken | Placed |
|---|---|---|
| 11-07 | 2,715 | 1,695 |
| 11-08 | 2,618 | 1,580 |
| 11-09 | 2,171 | 1,445 |
| 11-10 | 3,580 | 2,715 |
| 11-11 | 3,637 | 2,623 |
| 11-12 | 3,298 | 2,409 |
| 11-13 | 3,730 | 2,703 |
| 11-14 (to 15:50Z) | 131 | 160 |

Every one of the 14 bots broke between 1,339 and 1,651 of them: it is ordinary behaviour of every bot, not one job. It
all but stopped on 11-14. A rule that keeps terrain gathering out of the 64-block town square went live on 11-13 at
16:29Z (cleanzone-02), which fits; the model was also unreachable for six hours of 11-14, so the cause is not proven
here.

What follows for the plan: the target for the lawn is to **put the dirt back** under a surface that is natural and
should stay, not to remove a deck. And the first prevention rule is that bots do not take dirt from under a town.

## 2. The rehearsal world against its day-0 save

Untouched world: the day-0 snapshot (sha256 ccb0b10d..., taken before any bot joined). Now: the recorder's copies. Centre
366,-34, within 64 blocks, y 48 to 112. Bots started 14:46Z.

| Hours in | Not natural | of which build | Undermined | Pit | Over a gap | Pillar | Raised | Dug at surface | Placed |
|---|---|---|---|---|---|---|---|---|---|
| 3.0 | 380 (2.3%) | 39 | 174 | 102 | 8 | 10 | 14 | 646 | 89 |
| 5.7 | 589 (3.5%) | 92 | 251 | 155 | 12 | 11 | 23 | 985 | 144 |
| 9.7 | 857 (5.1%) | 263 | 267 | 189 | 26 | 14 | 28 | 1,261 | 501 |

In under ten hours, 12 bots left 594 columns changed that no build owns, most of it in the first three hours, and
already 267 undermined columns and 189 open pits. Loose things at 9.7 h: 8 chests, 5 crafting tables, 2 furnaces.

## 3. The whole map (rehearsal world), 11-15

Owner: "is this list of things to fix only within town or over the whole map?" The runs above were near the town only.
`groundledger.py --whole-map` reads every chunk the two saves share and, when the untouched save is a true copy, skips
the chunks whose save stamp never changed. Rehearsal world, 9.7 hours in, all heights (y -64 to 255):

- The map is 23,828 chunks. The bots caused 1,893 of them (8%) to be saved again; all 1,893 were read, none unreadable.
  330 chunks hold anything that is not natural.

| Blocks from home | Columns read | Undermined | Pits | Over a gap | Pillar or raised | Filled | Changed | Build |
|---|---|---|---|---|---|---|---|---|
| up to 64 | 16,641 | 267 | 188 | 76 | 42 | 89 | 295 | 263 |
| 65 to 128 | 49,408 | 1,465 | 283 | 121 | 69 | 94 | 228 | 0 |
| 129 to 256 | 197,120 | 114 | 38 | 247 | 33 | 213 | 124 | 0 |
| 257 to 512 | 221,439 | 0 | 0 | 52 | 0 | 64 | 11 | 0 |

Nothing was touched beyond 512 blocks. Of the 4,113 changed columns that no build owns, 3,217 (78%) are within 128
blocks of home, and the twelve most changed chunks are all 26 to 90 blocks out. Far from town the marks are mostly single
placed blocks (over a gap, filled): crossings and climbs, not digging. (This run reads all heights, so its inner band
counts more than the first table, which read y 48 to 112.)

**The showcase cannot be listed map-wide yet.** Its world is 23,956 chunks; the regenerated untouched copy covers 1,849
(about 340 blocks around home). A map-wide list needs the untouched world regenerated for every chunk the bots reached.

## Limits of this first version

- "Build" means a cell listed in a project record. Ground a project digs on purpose (the mine stair, a cellar) is not
  listed there, so some undermined columns are meant. The planner step (N3) needs the projects' dug cells too.
- A column gets one class, first match wins: an undermined column can also carry a pillar.
- The block history is not yet read by the tool itself (the table above is a separate query). The showcase's history
  starts 11-07, 17 days after the town began.
- Tree stumps, floating leaves and water changes are counted but not classed.
- The showcase's untouched world is a regeneration, not a copy. The 11-08 work measured 94 to 96% agreement on non-stone
  blocks for the right seed.
