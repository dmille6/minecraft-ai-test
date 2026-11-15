# Showcase world, whole map: what the bots did to the ground (ground ledger, 2026-11-15)

Question (owner): is the list of ground to fix only within town, or over the whole map? The first ledger run could
not answer it for the showcase world, because the untouched copy of that world covered only about 340 blocks around
home. This run regenerates the untouched world for the whole area the saved showcase world covers and runs the ledger
over every chunk. (The ci3 clock reads 2026-11-15 UTC; the times below are ci3's.)

## 1. The untouched world, regenerated

- **What.** The same throwaway Paper 1.21.8 build 60 server as the 11-08 regeneration (`~/bw3-genesis/base` on ci2,
  copied through the controller to ci3), the showcase seed 1020202620, view and simulation distance 3, peaceful,
  listening on 127.0.0.1 only, Java 21 (`openjdk-21-jre-headless` 21.0.13, installed on ci3 with apt, the same package
  ci2 uses), `-XX:ActiveProcessorCount=8 -Xms6G -Xmx6G`. The adapted `gen.py` is `genfull.py`: it force-loads one strip of
  8 chunk rows at a time (8x8-chunk batches), waits until every chunk of the strip is in a region file, flushes, and
  releases the strip.
- **How far.** The saved showcase world (the capsule) holds 23,956 chunks. Read from its region headers (a chunk is
  present when its location entry is non-zero), they lie in chunk x -77..77 and z -77..77 (blocks -1232..1247 on both
  axes; the 11-14 note of x -1536..1535 was the region-file span, not the chunk span). The full rectangle is 155 x 155 =
  24,025 chunks; the 69 corner chunks the capsule lacks were generated too and are simply not shared.
- **Result and time.** 24,025 chunks generated, all with Status `minecraft:full`, in 36 region files (236 MB), in
  17.4 minutes (server up 03:54:45, done 04:11:46). The server was stopped with RCON `stop`; no Java process was left.
- **Where.** `~/ledger/regen-showcase/showcase/world/region` on ci3 (the log is `genfull.log` beside it).

## 2. Is the regeneration right? Checked against the existing copy

The existing 1,849-chunk copy (chunks -21..21) is the reference, but **only 441 of its 1,849 chunks are finished
ground**. Its Status counts: 441 `full` (all 289 chunks within 8 of home, plus 152 more), 1,120 `structure_starts`, 104
`biomes`, 96 `carvers`, 88 `initialize_light`. The 1,408 others are half-made edge chunks with no real blocks. The first
comparison I ran took 225 chunks spread over the whole 43 x 43 square and got 33.4% of non-air cells identical, 73.7%
of all cells; that is the half-made chunks, not a wrong regeneration (typical difference: `air` in the reference,
`stone` or `deepslate` in the regeneration). I therefore compared every chunk that is finished in the reference.

Block by block, y -64..255, with `regiondump.dump` on each chunk, air counted as absent:

| Chunks | Chunks compared | Non-air cells in either copy | Differ | Identical |
|---|---|---|---|---|
| Within 8 chunks of home | 289 | 9,520,671 | 20,908 | **99.78%** |
| Finished, further out (9 to 10 chunks) | 152 | 4,952,435 | 39,478 | **99.20%** |
| All finished chunks | 441 | 14,473,106 | 60,386 | **99.58%** |

Counting every cell of the boxes (16 x 16 x 320 per chunk, 36,126,720 cells, air included), 99.83% are identical.
302 of the 441 chunks differ in at least one cell. What differs is the scattering you expect from the same jar and seed
generated in a different order: granite, diorite and andesite swapping, moss, clay and deepslate patches, ore, a few
leaves and cave vines. It is not one systematic shift. **So: very close, not exact.** The identical share is
99.2 to 99.8%, not 100%; I proceeded because the differences are patchy feature noise and I measured what they do to the
ledger (next).

What the noise does to the ledger. Running the ledger itself with the reference as "untouched" and the regeneration as
"now" over the same 441 chunks (nothing was built there, so every column should be natural):
11,196 of 112,896 columns (9.9%) are not natural, almost all in the class `changed`. By distance of the chunk from home
(Chebyshev, in chunks; columns read, columns not natural): ring 0 to 1, 2,304, none; ring 2, 4,096, 15 (0.4%); rings 3
and 4, 14,336, 241 (1.7%); ring 5, 10,240, 357 (3.5%); rings 6 and 7, 26,624, 1,925 (7.2%); ring 8, 16,384, 1,865
(11.4%); rings 9 and 10, 38,912, 6,793 (17.5%). The rise with distance partly comes from the reference's own edge
(its chunks beyond ring 8 were generated beside half-made neighbours), so it is a worst case for the regeneration, not
its typical rate; the better estimate is section 4. **Of the cells the ledger calls `replaced` in this control, 24,193
of 24,784 (98%) lie more than 8 blocks under the surface**: this is stone-variant and cave-feature noise underground,
not ground on the surface. The positive control for the ledger's own logic: `--self-check` on the regeneration against
itself, 129 x 129 = 16,641 columns around home (`--ground-y 70 --radius 64`): every column natural, 0 not natural.

## 3. The whole map

Method. `groundledger.py --whole-map --regenerated-base` is one process over about 24,000 chunks. I split it over 6
processes with `wholepar.py` (`~/ledger/tools/wholepar.py`), which calls the real `groundledger.whole_map` on disjoint
chunk sets and adds the per-band counters. **Checked first on a sample of 121 chunks: the split over 6 processes and the
single call returned exactly the same summary and exactly the same 59 changed-chunk rows.** The full run took 9 min 39 s.

**A correction the first full run forced.** The capsule world holds 6,780 chunks that are not fully generated (17,176
`full`, 4,910 `structure_starts`, 612 `biomes`, 588 `carvers`, 581 `initialize_light`, and 89 others), all of them
more than about 960 blocks out. The tool reads such a chunk as empty ground, so the first run (kept in
`~/ledger/tools/run1-unfiltered/`) showed 1,441,136 `pit` columns beyond 1,024 blocks, whole chunks of 256 "pits" at
the map's corners. Those are chunks nobody finished, not holes. **The numbers below leave them out: 17,176 chunks
(4,397,056 columns) of the 23,956 shared.** The tool should refuse or skip a live chunk that is not `full`; it does not yet.

Columns by class, by distance of the column from home (the larger of the two axis distances); every chunk read, none
unreadable (17,176 of 17,176):

| Blocks from home | Columns read | Build | Undermined | Over a gap | Pillar | Raised | Filled | Pit | Changed | Natural | Not natural |
|---|---|---|---|---|---|---|---|---|---|---|---|
| up to 64 | 16,641 | 3,272 | 9,014 | 321 | 39 | 161 | 212 | 991 | 490 | 2,141 | 14,500 (87.1%) |
| 65 to 128 | 49,408 | 783 | 6,577 | 1,649 | 236 | 351 | 575 | 1,265 | 2,969 | 35,003 | 14,405 (29.2%) |
| 129 to 256 | 197,120 | 0 | 1,103 | 793 | 202 | 244 | 2,604 | 416 | 12,141 | 179,617 | 17,503 (8.9%) |
| 257 to 512 | 787,456 | 0 | 145 | 2,853 | 47 | 100 | 6,085 | 98 | 46,112 | 732,016 | 55,440 (7.0%) |
| 513 to 1,024 | 3,147,776 | 0 | 397 | 1,455 | 11 | 59 | 4,382 | 233 | 61,139 | 3,080,100 | 67,676 (2.1%) |
| beyond 1,024 | 198,655 | 0 | 56 | 42 | 1 | 10 | 37 | 16 | 11,144 | 187,349 | 11,306 (5.7%) |
| all | 4,397,056 | 4,055 | 17,292 | 7,113 | 536 | 925 | 13,895 | 3,019 | 133,995 | 4,216,226 | 180,830 (4.1%) |

Cells, over those 4,397,056 columns: **48,035 placed, 67,716 dug at the surface (within 8 blocks of the old surface),
163,668 mined below that (wanted: counted apart), 616 loose things** (torches, chests, tables and the like that no build
record owns).

**5,149 of the 17,176 chunks (30.0%) hold something that is not natural.** The twelve most changed, all inside the
town (blocks from home = the chunk centre, the larger axis distance):

| Chunk x, z | Blocks from home | Columns by class (of 256) |
|---|---|---|
| -5, 0 | 72 | undermined 242, pit 12, build 2 |
| -4, -5 | 72 | pit 174, build 80, undermined 2 |
| -4, -2 | 56 | build 112, undermined 130, pit 12, over a gap 1, raised 1 |
| -4, 0 | 56 | build 169, undermined 62, pit 22, filled 1, over a gap 2 |
| -3, -2 | 40 | build 256 |
| -3, -1 | 40 | build 123, undermined 121, pit 12 |
| -3, 0 | 40 | build 47, undermined 182, pit 20, changed 4, filled 1, over a gap 2 |
| -3, 1 | 40 | undermined 209, build 37, pit 3, changed 5, filled 1, over a gap 1 |
| -2, -2 | 24 | build 138, undermined 111, pit 5, over a gap 1, raised 1 |
| -2, -1 | 24 | build 44, undermined 138, pit 54, changed 13, raised 3, over a gap 3, filled 1 |
| -2, 0 | 24 | undermined 138, pit 70, changed 7, filled 10, over a gap 3 |
| -2, 1 | 24 | pit 94, undermined 102, build 28, changed 1, filled 4, over a gap 3 |

Within 128 blocks of home (66,049 columns), 28,905 columns (43.8%) are not natural and 17,847 of them are
`undermined` or `pit`: the town's ground problem is concentrated and real. Of the 4,055 `build` columns, all lie
within 128 blocks.

## 4. How much of the far-from-home marking could just be the regeneration?

Natural processes (trees growing, water flowing, grass spreading) are mostly not counted by the tool (soil, plants,
trees and fluid never set a column's class), and the regeneration noise from section 2 is underground and in cave
features. To tell real marks from noise I used a second fact the save holds: each chunk records `InhabitedTime`, the
ticks a player (a bot counts) was near it. **A chunk with 0 was never near any bot, so any mark in it cannot be the
bots' doing and must be noise or natural change.** Beyond 128 blocks of home, of 16,920 full chunks, 3,391 were ever
near a bot and 13,529 never were (chunk bands by chunk centre, so counts differ slightly from the column bands above).

| Beyond 128 blocks | Chunks | Marked chunks | Columns not natural | Of them `changed` | Of them every other class |
|---|---|---|---|---|---|
| a bot was near | 3,391 | 1,832 | 71,856 (8.3% of 868,096) | 56,912 | 14,944 (1.7%) |
| no bot ever near | 13,529 | 3,065 | 80,126 (2.3% of 3,463,424) | 73,639 | 6,487 (0.19%) |

The "no bot ever near" row is the measured noise floor of the regeneration: 2.3% of columns, 92% of it `changed`
(stone-variant swaps under the ground). Beyond 1,024 blocks, 792 chunks hold no bot trace at all and 401 of them are
marked (11,335 of 202,752 columns, 5.6%). **At that noise rate, about 20,000 of the 56,912 `changed` columns in the
bot-visited far chunks (a third) could be noise, and about 1,600 of the 14,944 columns of the other classes (11%).** So
roughly **13,000 columns of over a gap, filled, undermined, pit, pillar and raised, in 1,800 chunks, are probably the
bots' work beyond 128 blocks**; the `changed` column is not usable far out (see limits). Far from home the marks are
mostly `filled` (9,072) and `over a gap` (3,412), as in the rehearsal world: crossings and climbs, not digging. The
most changed far chunks that a bot visited are at 376 to 504 blocks, for instance chunk -31, 29 (488 blocks: changed
161, filled 41, over a gap 45) and chunks 16..18, -26 (408 blocks).

## 5. Limits

- **A regeneration is not a copy.** 99.58% of non-air cells match the reference; the other 0.42% (60,386 cells) is
  noise, and where the reference is itself half-made it was not tested at all. Nothing here proves the regeneration
  matches the real day-zero world: that world is gone.
- **`changed` is mostly underground noise, not surface ground.** The class is "a replaced solid cell anywhere in the
  column" (the tool's docstring says "at the surface", the code does not limit it). In the control 98% of replaced cells
  were deeper than 8 blocks. Do not list `changed` columns as things to fix. The other classes are far cleaner (0.19%
  noise floor).
- **Time.** Between day zero and the capsule, trees grew, fell and burned, water moved and grass spread. The tool
  does not class those, so they do not show, but a regeneration cannot separate them from the bots' work in the cells
  it does class (e.g. `filled` where water or lava settled). The "no bot ever near" chunks carry that too, so the noise
  floor above includes it.
- **Not every chunk was read:** 6,780 of 23,956 shared chunks (28%) are not fully generated in the capsule and were
  left out; all are beyond 960 blocks and none was ever visited. `InhabitedTime` shows where a player was near, not
  that a bot did anything there; and a chunk with 0 could still have been changed by something other than a bot.
- **Build ownership** comes from the 9,930 project records in `_pool-showcase`; cells the town digs on purpose and no
  record lists show up as `undermined` or `pit`, as noted in the first run.
- The regeneration used `view-distance 3`, forced strips of 8 chunk rows, and the overworld only; the
  nether and the end were not generated. No seed or jar other than the 11-08 pair was used.

## Where it is (ci3, `mike@10.0.0.35`)

`~/ledger/regen-showcase/showcase/world/region` (the untouched world; `genfull.py`, `genfull.log`, `DONE`);
`~/ledger/capsule/showcase/world/region` and `~/ledger/capsule/showcase/state/_pool-showcase` (copies of the capsule
world and the pool, sizes identical to ci2); `~/ledger/ref-showcase/world/region` (the 1,849-chunk reference);
`~/ledger/tools/` (`groundledger.py`, `regiondump.py`, `wholepar.py`, `refcheck.py`, `refcheck-441.txt`,
`control-ref-vs-regen.txt`, `selfcheck.txt`, `showcase-whole.txt`, `showcase-whole.json`, `capsule-status.json`,
`inhabited-split.py`, `run1-unfiltered/`).
