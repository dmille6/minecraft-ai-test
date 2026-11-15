# Where the bots keep climbing, pillaring and escaping: spots for permanent stairs and levelled ground

Read-only analysis, 2026-11-14. Owner's words of 2026-11-15: "lets build good ways to navigate around areas like building
stairs and leveling the land before building junk dirt piles". This page finds the places.

## What was read, and how

- **Bot logs.** The showcase skill logs, loaded with `lib.telemetry.Events` on the live host, window 2026-11-13 17:00Z to
  2026-11-15 04:00Z: **531,892 rows from 14 bots** (a second load a few minutes later returned 531,893; the logs were still
  being written). 393,288 of those rows carry the bot's own position (74 %). Every kind below was grouped with `canon(name)`.
  Positive control for the grouping: the same load gives 19,537 `scaffold_pick`, 12,541 `takeback`, 1,077 `cleanzone` rows,
  so none of the zero-looking kinds is a naming slip.
- **Model-dark stretch** (2026-11-14 08:31Z to 14:43Z, bots on reflexes). Counts with and without it are given where they
  differ. It barely matters here: 1,540 of the 40,669 positioned climb/escape events (3.8 %) fall in it, and the top-10 share
  moves from 6.5 % to 6.8 % when it is removed.
- **Saved world.** The region files saved 2026-11-14 15:50Z, read with `regiondump.dump`: 66 patches of 17 x 17 columns (the
  66 busiest cells' neighbourhoods) plus four larger boxes. "Ground" below means the highest solid, non-foliage block of a
  column (leaves, grass tufts, flowers excluded), so a tree trunk counts as a tall column.
- **Position of each event.** `takeback`, `entombed`, `surface`, `marooned` and the like carry the bot's position. `cleanzone`
  and `dig_town` carry it only inside the detail text (`pos=`), which I used. **`scaffold_pick` carries no position at all**
  (its bot field has name and role only). For it I used the position of the same bot's nearest earlier row of any kind, and
  kept it only if that row was at most 30 s earlier: 18,955 of 19,537 (97 %); median gap 4.2 s, 90th percentile 20.1 s. The
  same was done for `path_no_legal_move` (3,849 of 3,914). So scaffold_pick positions are where the bot was moments before, a
  few blocks off at worst.
- **Cells.** 4 x 4 blocks in x and z, named by the centre (e.g. -66,2 covers x -68..-65, z 0..3). A cell sums all heights, so
  a surface cell and a mine tunnel below it land together; the table says how deep each cell's events were.

## 1. Counts per event kind

"Climb/escape set" (the events that say a bot needed height, dug out of something, or was stuck) is: scaffold_pick,
takeback, cleanzone, dig_town, surface, ceilescape, entombed, entombed_unrecoverable, roof_climb, stranded_underground,
stranded_escape_try, stranded, stranded_unrecoverable, marooned (and its ramp_cut/underfoot), reflex_stuck,
unstick_oscillation, escape_guard_refused, climb_flood_refused, needs_rescue, zone_climb_refused, zone_walk,
trapped_in_canopy, canopy_drop_refused, poolescape, maroon_dig_refused. That is **41,285 events, 40,669 positioned (98.5 %)**;
the 616 without a position are 582 scaffold_picks with no row within 30 s and 34 `cleanzone op=pass` rows.

| kind | in window | with a position | own position / nearest earlier row (<= 30 s) / detail text | in the model-dark stretch |
|---|---|---|---|---|
| scaffold_pick | 19,537 | 18,955 | 0 / 18,955 / 0 | 731 |
| takeback | 12,541 | 12,541 | 12,541 / 0 / 0 | 619 |
| entombed | 3,455 | 3,455 | 3,455 / 0 / 0 | 95 |
| surface | 1,350 | 1,350 | 1,350 / 0 / 0 | 2 |
| reflex_stuck | 1,259 | 1,259 | 1,259 / 0 / 0 | 15 |
| marooned | 1,106 | 1,106 | 1,106 / 0 / 0 | 52 |
| cleanzone (valve) | 1,077 (1,043 `op=release`, 34 `op=pass`) | 1,043 | 0 / 0 / 1,043 | 26 |
| entombed_unrecoverable | 266 | 266 | 266 / 0 / 0 | 5 |
| dig_town | 181 (85 transit, 63 survival, 32 other, 1 takeback) | 181 | 0 / 0 / 181 | 0 |
| escape_guard_refused | 137 | 137 | 137 / 0 / 0 | 9 |
| climb_flood_refused | 128 | 128 | 128 / 0 / 0 | 4 |
| stranded_underground | 41 | 41 | 41 / 0 / 0 | 2 |
| ceilescape | 39 | 39 | 39 / 0 / 0 | 1 |
| roof_climb | 30 | 30 | 30 / 0 / 0 | 0 |
| stranded_escape_try | 29 | 29 | 29 / 0 / 0 | 20 |
| zone_climb_refused / zone_walk | 25 / 25 | 25 / 25 | own | 0 / 0 |
| unstick_oscillation | 22 | 22 | 22 / 0 / 0 | 0 |
| needs_rescue | 17 | 17 | 17 / 0 / 0 | 2 |
| canopy_drop_refused, trapped_in_canopy, stranded, poolescape, maroon_dig_refused, stranded_unrecoverable, marooned_ramp_cut, marooned_underfoot | 8, 5, 2, 1, 1, 1, 1, 1 | all | own | 0 to 1 |

Other kinds that mark a bot unable to reach or move, listed for section 3 and for context: path_noPath 16,288 and
path_timeout 9,146 (all positioned; generic walk failures, dominated by the mine and far trips, not binned here),
watchdog_rescue 4,084, path_no_legal_move 3,914, livelock_escape 1,680 (1,063 of them in the model-dark stretch, so mostly
a dark-stretch behaviour), pathfinder_wedged 148, and the well, shaft and stair kinds in section 3.

Two cautions on reading the counts. First, one dirt block placed and later removed shows up as a `scaffold_pick` and a
`takeback` (and a `takeback` is logged with `outcome=left` when the bot walks away from it), so these are events, not distinct
blocks. Takeback outcomes in the window: left 5,391, dug 4,359, adopted 1,882, kept 881, deferred 28 (12,541). Second, I binned
on the bot's position, not the block's, which can differ by a few blocks.

## 1b. The spots: 25 busiest cells

Binned: all 40,669 positioned climb/escape events, all depths, 2,379 cells with at least one event.

**Spread.** Top 10 cells hold **2,654 events = 6.5 %** (6.8 % without the dark stretch: 2,654 of 39,129). Top 25 hold 5,567 =
13.7 % (14.2 % without the dark stretch). If the events were spread evenly, 25 of 2,379 cells would hold 1.1 %, so there are
hot spots, but the single busiest cell holds only 0.8 % (331). The picture is a handful of broad areas, not a few single
cells: 12 of the 25 cells sit in one strip west of town (x -82..-62), see the spots below.

Last three columns: how many of the cell's events were within 2 blocks of the ground surface / 3 to 8 below it / more than 8
below it, using the saved world's ground height in that column (all 25 cells are inside the dumped patches).

| # | cell centre (x,z) | events | by kind (top five) | bots | different hours | at ground / 3-8 below / >8 below | valve: where the bot was trying to go (4x4 cell of the goal, goal y, count) |
|---|---|---|---|---|---|---|---|
| 1 | -74,2 | 331 | takeback 135, scaffold_pick 118, reflex_stuck 31, entombed 30, surface 9 | 14 | 21 | 8 / 22 / 301 | 3 valves: (-74,2) y64; (-70,-2) y44 |
| 2 | 26,-34 | 301 | takeback 96, reflex_stuck 78, surface 62, scaffold_pick 55, entombed 8 | 14 | 28 | 0 / 0 / 301 | none |
| 3 | -66,2 | 282 | takeback 170, scaffold_pick 64, reflex_stuck 20, surface 15, entombed 10 | 14 | 22 | 103 / 51 / 125 | 2 valves: (-70,2) y62; (-62,-2) y53 |
| 4 | -70,10 | 270 | scaffold_pick 123, takeback 113, entombed 21, marooned 8, surface 2 | 14 | 19 | 10 / 26 / 233 | 2 valves: (-74,6) y34; (-74,10) y26 |
| 5 | -78,2 | 265 | scaffold_pick 130, takeback 98, entombed 26, marooned 4, surface 3 | 13 | 17 | 6 / 30 / 228 | none |
| 6 | 38,66 | 258 | takeback 115, scaffold_pick 88, cleanzone 26, entombed 15, marooned 12 | 13 | 23 | 0 / 0 / 258 | 26 valves: (38,82) y42 x2; (38,66) y51 x1 |
| 7 | -66,6 | 249 | takeback 99, scaffold_pick 80, surface 45, entombed 21, marooned 2 | 14 | 20 | 17 / 141 / 83 | none |
| 8 | -70,6 | 237 | takeback 146, scaffold_pick 53, entombed 13, surface 12, marooned 6 | 14 | 22 | 26 / 50 / 160 | 6 valves: (-66,2) y62 x2; (-70,2) y43 |
| 9 | -66,-2 | 233 | takeback 134, scaffold_pick 66, reflex_stuck 12, entombed 10, surface 4 | 13 | 16 | 32 / 40 / 160 | 2 valves: (-70,-2) y54; (-70,-6) y64 |
| 10 | -70,2 | 228 | takeback 109, scaffold_pick 65, reflex_stuck 21, entombed 17, surface 6 | 14 | 24 | 55 / 40 / 132 | 1 valve: (-70,2) y61 |
| 11 | 26,-26 | 214 | entombed 112, escape_guard_refused 38, scaffold_pick 32, surface 10, takeback 10 | 14 | 24 | 3 / 18 / 193 | none |
| 12 | 38,62 | 214 | scaffold_pick 108, takeback 38, cleanzone 33, entombed 17, marooned 10 | 11 | 20 | 0 / 5 / 209 | 33 valves: (38,66) y56 x2; (38,66) y54 x2 |
| 13 | -2,-70 | 211 | scaffold_pick 144, entombed 22, reflex_stuck 15, takeback 10, cleanzone 9 | 13 | 12 | 38 / 3 / 170 | 9 valves: (-2,-70) y61 x4; (-2,-74) y60 x2 |
| 14 | -70,-10 | 210 | takeback 121, scaffold_pick 61, entombed 16, cleanzone 7, entombed_unrecoverable 4 | 14 | 19 | 15 / 17 / 178 | 7 valves: (-70,-10) y64 x2 |
| 15 | -70,22 | 210 | takeback 113, scaffold_pick 70, entombed 11, marooned 10, cleanzone 5 | 9 | 12 | 3 / 0 / 207 | 5 valves: (-70,18) y41; (-70,34) y33 |
| 16 | 26,-22 | 208 | surface 186, scaffold_pick 22 | 14 | 19 | 208 / 0 / 0 | none |
| 17 | -70,-2 | 208 | takeback 125, scaffold_pick 61, entombed 15, reflex_stuck 3, entombed_unrecoverable 2 | 14 | 18 | 5 / 10 / 193 | none |
| 18 | -38,-22 | 203 | scaffold_pick 110, entombed 35, escape_guard_refused 27, takeback 16, marooned 6 | 8 | 9 | 25 / 50 / 127 | 2 valves: (-38,-10) y63; (-30,-14) y72 |
| 19 | 38,70 | 196 | takeback 89, scaffold_pick 73, entombed 11, marooned 11, cleanzone 6 | 12 | 21 | 0 / 8 / 188 | 6 valves: (34,70) y64; (30,82) y69 |
| 20 | -2,6 | 184 | reflex_stuck 127, dig_town 23, scaffold_pick 11, takeback 10, surface 6 | 14 | 29 | 118 / 38 / 28 | 3 valves: (-14,14) y69; (10,14) y65 |
| 21 | -6,-70 | 183 | scaffold_pick 155, entombed 8, surface 6, marooned 6, takeback 5 | 5 | 4 | 8 / 1 / 174 | 1 valve: (-6,-70) y14 |
| 22 | -26,-22 | 171 | scaffold_pick 146, takeback 9, marooned 8, entombed 6, escape_guard_refused 1 | 3 | 3 | 0 / 1 / 170 | none |
| 23 | -70,14 | 168 | takeback 99, scaffold_pick 50, entombed 10, entombed_unrecoverable 5, marooned 2 | 13 | 18 | 0 / 9 / 159 | none |
| 24 | 2,-2 | 167 | scaffold_pick 116, reflex_stuck 17, takeback 11, marooned 10, cleanzone 5 | 11 | 11 | 55 / 13 / 96 | 5 valves: (2,2) y65 and y70 |
| 25 | -82,2 | 166 | takeback 76, scaffold_pick 65, entombed 12, reflex_stuck 8, entombed_unrecoverable 2 | 12 | 13 | 6 / 23 / 137 | 1 valve: (-82,-2) y54 |

(For the three-column split, "of N" is N = the cell's events; cell 2's 301 and cell 6's 258 are all deeper than 8 below
ground.)

**Most of the busiest cells are not on the surface.** Of the 40,669 positioned events, 21,938 (54 %) are below y 50. Over the
66 cells dumped, 19,320 positioned events had a known ground column and only 4,871 (25 %) were within 8 blocks of the ground.
Ranked by events at or near the ground (3 to 8 below counted), the cells that matter for surface stairs and levelling are:
26,-22 (208), -66,6 (166), -66,2 (157), -2,6 (156), 14,70 (103), -70,2 (96), 34,2 (82), 22,-78 (77), -70,6 (77),
-38,-22 (76), -66,-2 (73), 2,-2 (71). That ranking only covers cells I dumped (the 66 busiest by one measure or the other),
so a cell with a high surface share but low total could be missing from it.

**Valve openings alone** (1,043 releases: 562 `why=no_path`, 481 `why=timeouts`; 14 bots; 32 different hours): only 312
(30 %) happened within 64 blocks of home, so the valve is mostly firing far from the town. The top 10 cells hold 205 of 1,043
(19.7 %): (38,62) 33, (38,58) 33, (38,66) 26, (34,62) 25, (2,-6) 16, (34,58) 15, (30,66) 15, (-14,2) 15, (2,6) 14,
(42,62) 13. The first four, plus their neighbours, are one place: the east cave (spot B below), 178 valve openings in a
16 x 24 block box (17 % of all).

## 2. What the ground is, and what would remove the need to climb (the 10 busiest cells)

The cells fall into four places. Heights below are the saved world's ground-top y for the 9 x 9 block patch around the cell
centre (rows are z, columns are x; the north-west corner is x-4, z-4).

### Spot A: the west mine yard, x -84..-60, z -22..26 (cells 1, 3, 4, 5, 7, 8, 9, 10 and 14, 15, 17, 23, 25)

This box is 72 cells (3.0 % of the 2,379 cells that had any event) and holds **6,476 events, 15.9 % of all 40,669**: takeback
2,975, scaffold_pick 2,385, entombed 542, surface 191, reflex_stuck 112, valves 92; all 14 bots, 32 different hours. Only 1,511 of 6,324 events with a known ground (24 %) are within 8 blocks of the ground.

What the saved world shows there: a flat lawn at y 66 to 67 (1,035 columns read: 40 are pits 3 or more below it, 92 are
dirt or cobblestone columns 3 or more above it; 59 dirt, 33 cobblestone, 42 more are spruce trunks, which are trees), over
solid stone. The bots' own digging has turned the stone below into a maze of single-width tunnels: a plan view at y 54 over
x -84..-58, z -22..22 is solid stone with winding one-block corridors and scattered dirt and cobblestone blocks in them. At
z=2 a section shows an open shaft at x -67..-66 from y 64 down to y 59, and caves and tunnels at y 40 to 57. Takeback events
here sit at y 40 to 64 (2,522 of the strip's 3,241 takebacks are at y 40 to 63), so bots are placing dirt steps and
pillars inside these tunnels (2,843 of the strip's 3,241 takebacks are dirt, 396 cobblestone; 1,593 pillars, 1,552 steps, 96
bridges) to get back up.

Cell by cell:

1. **-74,2 (331).** 301 of 331 events are more than 8 below ground (median bot y 47; ground 66). Ground patch is flat, 66 to 67,
   with 4 pit columns (60 to 63) at the south-west and 9 tall columns (7 are spruce trunks, 1 dirt, 1 cobblestone):
   no drop, no water, no roof. *Need removed by:* one permanent two-wide stair shaft from the lawn down into the mine level
   (about 22 steps from y 66 to y 44), so the tunnels below it have a way out; nothing to level on top.
2. **-66,2 (282).** 103 at ground, 51 at 3 to 8 below, 125 deeper. Patch heights 60 to 76: **13 pit columns** (3 to 6 deep, a
   cluster at x -64..-60, z 0..4 with values 60 to 64 against 66 to 67) and **15 tall columns** (9 dirt, 6 spruce trunks), no
   water, no roof. *Need removed by:* fill the 13 pits to y 66 and take the 9 dirt columns down; and the same stair shaft
   (the open column at x -67..-66 is the natural place for its head).
3. **-70,10 (270).** 233 deeper than 8. Lawn 65 to 67, with a row of dirt columns at y 72 along z 12 (x -74..-69) and a block at
   x -69, z 11..14: 11 dirt columns standing 5 to 6 above the lawn (13 tall columns in the patch, 12 dirt). Valves from here aim at
   (-74,6) y34 and (-74,10) y26, i.e. 30 to 40 blocks straight down. *Need removed by:* remove the dirt row; the stair shaft
   again, with a landing in the y 26 to 34 range if bots really work there ("nothing obvious" on the surface itself).
4. **-78,2 (265).** 228 deeper than 8; lawn 66 to 67, 3 pit columns (62 to 65), 4 tall (3 spruce trunks). *Need removed by:* the
   shaft stair; the surface needs nothing.
5. **-66,6 (249).** 17 at ground, 141 at 3 to 8 below, 83 deeper. Heights 60 to 76: 8 pit columns, 21 tall columns (16 dirt, 3
   spruce, 2 cobblestone), several of them 5 to 10 above the lawn (70 to 76). 45 `surface` events here (a bot climbed out
   digging). *Need removed by:* take down the 16 dirt columns, fill the pits; the 3 to 8 below split points to bots climbing
   out of pits 3 to 6 deep: **a filled pit** is the direct fix.
6. **-70,6 (237).** 160 deeper than 8. 5 pits, 8 tall columns (5 trunks, 3 dirt); valves from here go to (-66,2) y62 (twice),
   (-70,2) y43. *Need removed by:* fill the pits, shaft stair as above.
7. **-66,-2 (233).** 160 deeper than 8, 32 at ground. 13 pits (62 to 64) at x -69..-62, z 2..4 (the same pit field as
   cell 2), 8 tall (6 trunks, 2 dirt). *Need removed by:* fill the pit field.
8. **-70,2 (228).** 55 at ground, 40 at 3 to 8, 132 deeper. 7 pits, 13 tall (9 trunks, 3 dirt, 1 cobblestone), tallest 77.
   *Need removed by:* take down the dirt and cobblestone columns, fill the pits.

I did not find a drop, water, or a roof anywhere in spot A (covered columns 0 of 81 in each of these patches). What it
needs is levelling of a pit field plus one real way in and out of the mine below.

### Spot B: the east cave, x 30..46, z 54..78 (cells 6, 12, 19 and neighbours)

1,573 events (3.9 %), 178 valve openings (17 % of all 1,043), 14 bots, 29 hours. **Only 39 of 1,573 are within 8 blocks of
the ground**: the bots are 20 to 26 blocks beneath a hillside. The ground above is a natural hill rising from y 71 at z 56
to y 98 at z 68 (grid at cell 6, rows z 62 to 70, columns x 34 to 42: 91 93 93 93 93 91 89 86 85 / 94 94 94 94 94 91 90 86 84 /
95 95 95 95 94 92 89 89 84 / 96 96 96 96 95 93 89 86 84 / 98 98 98 97 97 93 90 98 84), no water, no roof, no drops in the
ordinary sense (the 35 "pit" and 28 "tall" columns it reports are slope noise on a hill).

9. **38,66 (258).** Column (38,66) has walkable ledges at y 49, 56, 64, 67 and then the hilltop at 89: a stacked cave with
   ledges 3 to 8 apart. Valve goals from here: (38,82) at y 42 (26 valves with the neighbours) and (38,66) y 51 to 56 (the
   ledge 8 to 13 below the bot). *Need removed by:* a stair or ramp joining the ledges at (38,66): about 8 steps from y 56 to y
   64 and 3 more to 67. This is an inference from stand heights in four columns; I did not see the cave as a connected volume.
10. **38,62 (214)** is the same cave: stand heights 55, 61, 79, 83 at (38,62); 33 valves here, and the neighbouring cell (34,62) has 25 more, 10 of them heading to (43,63,69). *Need removed by:* the same ledge stair, from y 55 to 61 (6 steps).

I cannot tell from the saved blocks whether these caves connect to the surface and where; the bots probably enter by mining
(the events say entombed 124, marooned 70 in this box). **"Nothing obvious" for the surface; a cave-ledge stair underground.**

### Spot C: the shared mine shaft, x 22..30, z -38..-18 (cells 2, 11, 16)

988 events (2.4 %); `surface` 264 (the bot climbed out digging), takeback 235, scaffold_pick 195, entombed 141, reflex_stuck 85.
No valves at all here (0 of 1,043).

11. **26,-22 (208): 208 of 208 at ground, surface 186, scaffold_pick 22; 14 bots, 19 hours.** Ground patch is a flat lawn at
   y 68, with one 63 and one 74 column. Median bot y 69 and every event is on the surface: this is the head of the shaft,
   where `surface` ends (186 climbs out in 19 hours). A `shaft_use` at the top succeeded 162 times at this cell and 215 at
   (26,-30) (ok=1), so the stair works; the 186 `surface` events are bots that had come up by digging instead. *Need removed
   by:* nothing on the surface; the cause is below (see section 3).
12. **26,-34 (301) and 26,-26 (214): all deeper than 8** (median y 30 and 36): the mine stair's first run, at the cave y
   8 to 35 around x 18..32 (the saved world there is a natural cave with loose dirt and cobblestone, no stair blocks). 112 of
   the 214 events at (26,-26) are `entombed`, 38 `escape_guard_refused`. *Need removed by:* a real built stair along the shaft
   line with its treads placed in stone rather than in cave voids (section 3).

### Spot D: the town centre, x -6..6, z -6..10 (cells 20, 24)

738 events (1.8 %): scaffold_pick 268, reflex_stuck 190, takeback 98, dig_town 86, valves 35; 424 of 738 within 8 of the
ground (the only spot that is mostly surface). Ground is the lawn at y 70 (69 to 71 across the patch; a 79 column at x -6;
76 and 74 at x 0..1, z 0..1). *Cell -2,6:* 127 of its 184 events are `reflex_stuck` ("no movement for 35 s"), and 97 of those
are at one spot, x -2, y 70, z 4: this looks like a bot idling or waiting rather than a climb, **I could not establish why**.
The valves here aim at the town's own streets (e.g. (-14,14) y 69, (10,14) y 65, (-13,-6) y 71). *Need removed by:* "nothing
obvious" in the blocks; the lawn is level (69 to 71) with no drop, water or roof in the patch.

### What the ten busiest cells add up to

Cells 1 to 10 (the table's first ten rows) are 2,654 events. Eight of the ten are spot A. Cells 2 and 6 are the mine shaft
and the east cave, both underground. Only cells 3, 7 and 10 have a third or more of their events at the ground.

## 3. Places the town depends on that the bots could not reach

### The junk well (standing cell 12,74,6)

- **236 refusals** (`well_refused` order=dispose reason=unreachable; the same incident is also logged as a `dispose_well`
  row, so 472 rows are 236 incidents; 14 bots, 20 different hours, 2 of the 236 in the model-dark stretch). Against that, the
  well worked **195 times** (`well_dispose` 195; `dispose_well ... threw` 195), so **236 of 431 attempts (55 %) failed.**
- Where: **354 of the 472 rows have the bot at (12, 68, 6)**, 20 at (12,68,7), 14 at (13,68,6): bots stand on the lawn *under*
  the platform. `well_step op=climb why=unreachable` ran 34 times with `reached=0` every time. A further 171 `well_deep`
  rows (all `action=hold`, remedy "surface") are bots that were in the mine when the order came.
- What blocks the way in the saved world: the platform is a cobblestone slab 4 thick (y 70 to 73) with andesite at y 71; the
  top block at (12,6) is y 73, so the standing cell is y 74, six above the lawn. Heights along z 6, x 6..12: 67 67 67 71 72 73
  73; so the west face is a **4-block cliff from lawn (y 67) to y 71 at x 9**, then 1-block steps 72, 73. Under it the bot
  stands in a pocket two blocks high (y 68 to 69, grass at y 67, cobblestone ceiling at y 70). The 4-block rise is above a jump
  and there is no stair in the dump of x 6..18, z 0..12.
- *What would remove it:* **a stair of 4 steps up the west face, from the lawn at (5..8, 67, 7) to (9, 71, 7)**, after which
  the 1-block rises to (11, 73) and the standing cell (12, 74, 6) are walkable. (A ladder would also do; the stair is the
  thing the pathfinder understands.)

### The storage chests at x -11 and -9, z -2 and 2 (y 71), and -13,71,0

- The same five plan cells are listed `unreachable` in **all 950 of 950** `townplan_audit` rows (-11,71,2; -11,71,-2; -9,71,2;
  -9,71,-2; -13,71,0), so it is permanent, not intermittent.
- Bots hit it as: -11,71,-2 71 times (14 bots, 18 hours), -11,71,2 22 times (10 bots, 7 hours), -13,71,2 10, -9,71,-2 7, then
  smaller counts at 13 other chests, in `town_deposit` (99 rows), `withdraw_pick` (38), `storehub_clerk` (18), `kit_search` (7),
  `sort_tidy` (2), `deposit` (1). That is a minimum: I counted only rows whose text names the chest.
- Saved world: the chests are at y 71 on a y 70 dirt deck, in a stone-brick enclosure: bricks on the north (z -3) and south (z
  4) and east (x -8), a single-block aisle at x -10, torches and signs. The west side is outside the part I dumped
  (x < -12), so **I cannot say where the door is or what is in front of it.** Also the deck at y 70 sits over a gap (the
  "deck over a gap" noted elsewhere); I did not test whether the standing cell has a floor.
- Not climbing, so no stair is indicated; the finding is that two chest aisles are walled in and dead for every bot.

### The mine stair (shaft)

- `shaft_use`: 776 in window, 377 `ok=1`, 399 `ok=0` (so 51 % failed). Why for the 399: `no_plan` 311, `walk` 81, `stepN:blocked` 7.
  Successes: 215 at (26,-30) and 162 at (26,-22). 281 were `dir=down`, 495 `dir=up`.
- `mine_stair_step_failed`: **916** rows ("dug the tread ... but ended at ... moving N horizontally: the stair was cut and not
  taken"), 14 bots, 30 hours, **807 distinct treads**, so most are not the same step repeating. Treads span y -56 to 80, x -193
  to 373 and z -237 to 579 (these include other, far shafts). The repeated ones: **(25, 14, -33) 64 times**, (25,28,-35) 11,
  then four at 4 or fewer. Cells: (26,-30) 45, (26,-34) 37, (-2,-30) 17, (38,66) 10, (22,-34) 9, (38,58) 8.
- Saved world around (25,14,-33): open natural cave, no stair blocks; the tread cell and its neighbours at y 12 to 14 are
  mostly air with loose dirt. A stair cut through a void has nothing to stand the next tread on. *What would remove it:*
  build the stair as placed blocks along a fixed line (solid steps), not dig it into whatever is there.
- Not established: whether that cave region is the only cause.

## 4. What I could not establish

- **Whether bots dug the west yard's tunnels deliberately or by escape.** The events tell me a bot was in a tunnel placing and
  taking back dirt; they do not say which skill dug the tunnel. The tunnel maze is from one plan view at y 54.
- **The east cave as a connected volume, and where it opens to the surface.** I used four columns' stand heights.
- **Why 97 `reflex_stuck` events happen at (-2, 70, 4)** (idle spot or a real trap).
- **Where the storage-hall door is** (west of the dumped box) and why the chests are unreachable.
- **`scaffold_pick` positions are approximate** (nearest earlier row, median 4.2 s; 582 of 19,537 had none within 30 s).
  The block pos is not logged for it, only for `takeback`.
- **Surface ranking covers only the 66 dumped cells.** A cell outside them with a high surface share could be missing from
  the "near ground" list in section 1b.
- **Events are not distinct blocks.** A placed-then-removed dirt block is two events; the count overstates distinct dirt
  piles. Distinct `takeback` positions in the window: 8,779 for 12,541 events.
- **The valve's goals** are goals the walk was given, not necessarily places a stair would help (many are 30 to 40 blocks
  below the bot, in the mine).
- **The saved world is 2026-11-14 15:50Z**, and the window runs about 35 hours past it to 11-15 04:00Z; bots kept placing and
  removing blocks after the snapshot, so a pit or pillar listed here may be gone or new.
- **Path failures** (path_noPath 16,288, path_timeout 9,146) are not binned. They are the largest "could not reach" kinds
  and were not mapped here.
- **No distinction between dirt the bot placed and natural dirt** in the saved world: "pillar" counts use the column's
  topmost block name only.
