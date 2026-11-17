# Rehearsal-0 close: what broke, in what order

Run `rehearsal-0`: 12 bots on a fresh world (`fw-s12`, site "D Birch Loop", home 366,72,-34), code `46286e9e`
(the showcase release roofclimb-01show), model `qwen2.5:7b-instruct` on the 3090.
Started 2026-11-14T14:46:09Z. Planned 48 h. Stopped 2026-11-16T19:37:16Z on the owner's word, 52.85 h in
(the card's last read was at 52.82 h). Nobody helped the bots: the assistance log is empty.

Final card: 1 pass (admin_edits), 7 fail, 1 unread.

## The short version

1. **The bots spent most of their time waiting for their next turn, not waiting for the model.** The model answered
   in 2.0 s (median). But 27,913 of 48,465 answers (57.6%) were refused before any skill ran, and after a refusal
   the bot waits out its 30-second turn. Those refused turns are 307 of 634 bot-hours (48%).
2. **The workshop was built in 11.1 h and then waited 17.5 h for two torches.** Every other building waits for the
   workshop, so the town core "took" 28.6 h. The town chests held 71 to 95 coal the whole time.
3. **Storage and a second house were never started.** Not one row names a storehouse, storage hall, workshop chest,
   hall or cottage. After the workshop, 59% of build visits went to the monument and the wall.
4. **Nine deaths, six of them underground.** Five were falls of 10 to 27 blocks in the caves directly under the
   town. Three were lava. One was a drowning two blocks under the surface.
5. **Two bots sat in sealed pockets under water for hours** (Iris 16.6 h, Bravo 8.8 h in two places each). Every
   way up was refused because water was overhead, and no path led sideways.
6. **"Away from the site" is mostly a rule, not wandering.** The gather rule walks bots 70 blocks out before they
   may dig dirt or sand; the card counts anything past 64 blocks as away. The long absences are real, though:
   "return home" was the task for 129 bot-hours and a walk succeeded in 877 of its 11,403 turns.

## What was read, and the controls

| What | Count |
|---|---|
| Bot log files | 24 (12 skill, 12 llm). No rotated files exist on this host; each file covers the whole run |
| Lines read | 667,598 = 611,300 skill rows + 56,298 llm rows. 0 unparsable lines, 0 unreadable files |
| Rows inside the run window | 611,288 skill rows from 12 of 12 bots |
| Observed bot time | 634.0 bot-hours (0.25 h unobserved; 10 gaps over 120 s, the longest 131 s) |
| Code versions in the rows | 1 (`46286e9e...+4dc0b6`) |
| Paper server log | 1,799 lines, read as a second source for deaths, joins and lag |

Rows were read with `scripts/lib/telemetry.py` (`stream_rows`, the reader the card uses), full walks, on the
rehearsal VM. The card's working share was rebuilt from `lib/busytime` and matches the card to the decimal
(16.4 / 8.7 / 68.3 / 6.6 % of 633.6 bot-hours), so the numbers below are on the same footing as the card.

"Hours in" always means hours since 14:46:09Z on 11-14.

## 1. Timeline

| Hours in | What happened |
|---|---|
| 0.0 | Start. First task for most bots is "gather 16 dirt". The gather rule walks them 70 blocks out of town first |
| 0.1 | 10 of 12 bots are 65 to 86 blocks from home, all on the surface, all gathering |
| 0.0 to 1.6 | Workshop waits for fill (59 visits stop on "fill for earth") |
| 0.6 to 7.9 | Founding: crafting table, furnace and 8 chests placed (10 of 11 placements; 1 failed at 6.9 h and was redone) |
| 0.8 | **Death 1** (Iris): magma under a bubble column, 128 blocks out, while after sand |
| 1.6 to 8.5 | Workshop waits for stone bricks for its pad (190 visits). First stone brick placed at 6.2 h |
| 5.1 | Tower started (it is allowed before the workshop) |
| about 8 | Iris is sealed in a pocket under water 220 blocks east of home. She is not free until 26.2 h |
| 10.9 to 11.1 | Workshop walls, windows, copper trim and roof all placed. Only the fit-out is left |
| 10.2 | **Death 2** (Frost): 10-block fall onto dripstone, under the town, gathering dirt at y=14 |
| 11.1 to 28.6 | **Workshop waits for 2 torches** (216 visits stop on "light for fit-out") |
| 13.2 | Tower (first tower) complete: the first completed project |
| 13.5 | **Death 3** (Lumen): 15-block fall onto dripstone, under the town |
| 20.5 | **Death 4** (Haven): 15-block fall onto dripstone, under the town, gathering dirt |
| 24.9 | Town stair (shaft) complete |
| 25.5 | First torch of the run: Alpha crafts 4 from coal, by the model's own choice, and banks them |
| 26.2 | Iris surfaces and walks home in 55 seconds |
| 28.1 to 28.6 | Torches, furnaces and table placed. **Workshop complete at 28.6 h** |
| 28.2 to 31.5 | Bravo held at 333,56,-134 (worn pickaxe, water overhead) |
| 28.7 | Monument, shrine and house1 open at once |
| 28.8 | **Death 5** (Alpha): 8-block fall into lava, 175 blocks out, gathering dirt |
| 29.6 | **house1 complete**, one hour after it opened |
| 29.6 | Paths cannot be sited ("no path network: shaft unreachable"). Never built. The wall starts anyway |
| 30.7 | **Death 6** (Echo): lava at y=23, 96 blocks out, on the task "return" |
| 31.0 | **Death 7** (Alpha): drowned at y=61, 70 blocks out |
| 31.8 / 33.0 / 33.2 | Crop farm, cane farm, first shrine complete |
| about 33 | Monument stops growing at 595 of 3,181 blocks (3 open cells, none placeable). 2 more blocks by 45.1 h |
| 33.2 | **Death 8** (Frost): 27-block fall, under the town |
| 33.4 to 38.9 | Bravo sealed at 556,48,66, 215 blocks out: full bag, cannot craft, water overhead |
| 35.7 | Wood pile (sink) complete |
| 40 to 51.4 | The wall goes from 448 to 1,431 of 1,656 blocks |
| 48.2 / 51.1 | Second shrine, dressing (lamps) complete |
| 52.7 | **Death 9** (Kite): 24-block fall, under the town |
| 52.85 | Stopped |

## 2. The nine deaths

9 `_death` rows out of 611,288 skill rows, in 634.0 bot-hours = 1.42 per 100 bot-hours (pass is under 1.0).
The Paper log shows the same 9 death messages at the same seconds.

| # | Hours in | Bot | Server message | Where (x, y, z) | From home | Task, and what it was doing |
|---|---|---|---|---|---|---|
| 1 | 0.8 | Iris | discovered the floor was lava | 431, 60, 76 | 128 | gather sand. Stood in a bubble column on magma; the lava-retreat reflex ran 24 times in that one episode and the last six all ended "plan missed aim" |
| 2 | 10.2 | Frost | skewered by a falling stalactite, after a 10-block fall | 372, 4, -19 | 16 | gather dirt at y=14, in a cave under the town |
| 3 | 13.5 | Lumen | skewered by a falling stalactite, after a 15-block fall | 349, -11, -25 | 19 | patrol. Fell 12 blocks, then 15, during a watchdog relocation |
| 4 | 20.5 | Haven | skewered by a falling stalactite, after a 15-block fall | 325, 6, -32 | 41 | gather dirt at y=17 to 20, in a cave under the town |
| 5 | 28.8 | Alpha | tried to swim in lava, after an 8-block fall | 382, 57, 140 | 175 | gather dirt. The gather had just skipped 8 candidates as "floors over lava" |
| 6 | 30.7 | Echo | tried to swim in lava | 430, 23, 37 | 96 | return. Row 4 s before: "lava within a block and no verified retreat cell: holding still" |
| 7 | 31.0 | Alpha | drowned | 390, 61, 32 | 70 | gather dirt. "held 20 s and never reached air: sealed, no route up or out", while its own route row said "up, distance 1" |
| 8 | 33.2 | Frost | fell from a high place (27 blocks) | 305, -1, -17 | 63 | gather iron ore, walking |
| 9 | 52.7 | Kite | fell from a high place (24 blocks) | 359, 0, -18 | 17 | smelt iron, just after an entombed escape |

What the table says:

- **Six of nine deaths were at y=23 or lower.** All five fall deaths were within 63 blocks of home: there is a
  deep dripstone cave under the town. The gather rule keeps bots off the town's surface, not out of the ground
  under it (its setting is `deep_y=48`; Frost was gathering dirt at y=14, 16 blocks from home).
- Four of nine had the task "gather dirt". Dirt is being fetched from caves.
- In three of the five fall deaths (2, 4, 8) the take-back reflex dug up the bot's own temporary pillar or step
  blocks 1 to 13 seconds before the fall, in the same spot. That is a pattern in the rows, not a proven cause.
- No bot was down long: each respawned at once (the "dead" time class is 0.0 h).

## 3. Projects

### Completed (10 completion rows, 9 different projects)

| Hours in | Project | Note |
|---|---|---|
| 13.2 | tower (first) | 313 of 313 blocks. The second tower stood at 479 of 593 at the end |
| 24.9 | shaft (town stair) | |
| 28.6 | **shop (workshop)** | pass was 12 h |
| 29.6 | **house1** | 136 blocks in one hour |
| 31.8 | cropfarm | |
| 33.0 | canefarm | |
| 33.2 | shrine (first) | 211 of 211 |
| 35.7 | wood | |
| 48.2 | shrine (second) | 294 of 294 |
| 51.1 | dress | |

### Why the workshop took 28.6 h

527 workshop visits; 495 of them (94%) stopped because a material was missing.

| Wait | Hours in | Visits stopped | What was missing |
|---|---|---|---|
| fill for earth | 0.0 to 1.6 | 59 | fill blocks |
| base for pad | 1.6 to 8.5 | 190 | 63 stone bricks (needs smelting: cobblestone to stone to bricks) |
| step for ring | 8.6 to 10.7 | 28 | 26 stone bricks |
| roof | 10.9 to 11.0 | 2 | planks |
| **light for fit-out** | **11.1 to 28.6** | **216** | **2 torches** |

The whole building stood at 11.1 h. The last 17.5 h were two torches. During that wait:

- the town chests held coal the whole time (315 coal readings in the wait, all between 71 and 95, median 80;
  82 more readings could not see the chests), and sticks were in bags;
- the town's materials job tried torches 4 times; 3 ended "the town containers did not hold the order's inputs
  above the reserve (oak_log)". It makes torches from charcoal burned from spare logs, not from the coal;
- the model chose "craft torch" 4 times in 16,485 calls;
- the first torch of the whole run appeared at 25.5 h.

### Never completed, and what each was waiting on

| Project | State at the end | Waiting on |
|---|---|---|
| **storage** (storehouse, storage hall, workshop chest) | **0 rows name any of them** (control: the same search finds 1,805 workshop rows and 3,074 wall rows) | Never sited, never visited. They open after the workshop but stand behind the monument and the wall in the order. In the 24.2 h after the workshop finished there were 484 build visits: monument 156, wall 130, country 53, tower 39, shrine 26, crop farm 22, others 58, storage 0 |
| **second roofed house** (hall or cottage) | 0 rows | By the order in the code, the hall opens after the storehouse and the cottages after the enchant shop, which is after the storage hall. Neither could start before storage |
| monument | 597 of 3,181 (19%); last block at 45.1 h | 77 visits ended "3 open, 0 placeable now" (cells no stand reaches). It still drew 156 visits |
| wall | 1,431 of 1,656 (86%) | Was progressing: 106 visits ended on their time limit with blocks placed |
| second tower | 479 of 593 | 80 visits ended "N open, 0 placeable now" |
| paths | not sited | 1 row: "no path network (unrouted: shaft unreachable)" |
| stepwell | not sited | 16 visits: "no stepwell site" |
| country (land outside the wall) | not sited | 54 visits: "no country band (no land)" |

Why storage was never picked is read from the code and the visit counts, not traced row by row: the order hands
a bot the first open project with a free place, and the monument and wall stayed open.

## 4. The two stuck bots

The card says Iris 10 h and Bravo 6 h. Its rule counts only whole clock hours spent inside a 2-block box
(16 of 624 bot-hours judged). Counting rows within 4 blocks of each spot gives longer stays:

| Bot | Where | From | To | Stay | From home |
|---|---|---|---|---|---|
| Iris | 576, 59, -100 | 9.2 h | 16.3 h | 7.2 h | 220 |
| Iris | 596, 58, -86 | 16.7 h | 26.1 h | 9.4 h | 235 |
| Bravo | 333, 56, -134 | 28.2 h | 31.5 h | 3.3 h | 105 |
| Bravo | 556, 48, 66 | 33.4 h | 38.9 h | 5.5 h | 215 |

**Iris.** Both spots are pockets a few blocks under a body of water. The rows that repeat every hour:

- `_climb_flood_guard` refused: "liquid above the block overhead (water)" for the pillar, the ramp and the shaft
  climb (14 to 58 every two hours);
- `_path_noPath` and "pathfinder returned an empty path: no route out of here even with digging allowed";
- `_entombed` "walled in";
- the model asking for the same goto or gather and being refused as a repeat (up to 117 times in 2 h).

Two correct guards (do not dig up into water; do not repeat a failed action) made a dead end. She got out at
26.16 h when a climb finally reached the surface, and the walk home took 55 seconds.

**Bravo, first spot.** "stopped to keep an exit": too few pickaxe swings left for the climb out (19 times in the
first hour), goto home refused from memory of earlier failures, and the same water guard.

**Bravo, second spot.** Bag 36 of 36. It needed a new pickaxe and could not craft one: "No room for stick",
"banking is refused out here (no usable chest in reach)", "the last digging pickaxe is kept". The place and craft
answers were refused as repeats, the shaft climb was refused for water, and "no oak log under a roof".

Across all 12 bots the same family of rows is common, so these two are the worst cases, not the only ones:
`_entombed` 4,587 rows, `_marooned` 2,804, `_climb_flood_guard` 1,072, `_entombed_unrecoverable` 421,
`_stranded_underground` 198, `_recovery_exhausted` 142. All 12 bots wrote each of these.

## 5. Why 68% of bot time is "decision"

**It is not time spent waiting on the model.** The card's number is computed correctly, but the name is wrong.

How the card builds it (`scripts/lib/busytime.py`): every second gets one class. "Decision" is the sum of three:

| Part of "decision" | Bot-hours | Share of 634.0 | What it really is |
|---|---|---|---|
| model call in flight | 28.6 | 4.5% | waiting on the model |
| runner pause | 64.9 | 10.2% | the runner's 60-second pause after 3 failed skills in a row (2,646 pauses) |
| no skill running in the 45 s before the next model call | 339.3 | 53.5% | the bot's 30-second turn timer running with nothing to do |
| **"decision" on the card** | **432.8** | **68.3%** | |

For comparison: productive 103.9 h (16.4%), walking 55.0 h (8.7%), idle 42.2 h (6.7%).

**The model itself** (48,465 calls, 76 per bot-hour, one about every 34 s per bot):

| Measure | Value |
|---|---|
| Latency | median 2.0 s, p95 4.0 s, p99 5.7 s, max 16.1 s |
| Calls over 10 s | 31 |
| Calls over 30 s | 0 (the limit is 45 s). Control: the same query finds the 31 over 10 s |
| Failed or timed-out calls | none recorded: 0 of 48,465 rows carry a timeout or connection error. Control: the error field is filled on 26,102 rows, all of them refusal reasons except 23 malformed answers |
| Valid answers (schema) | 48,442 of 48,465; 69 needed a retry |
| By 6-hour block | median between 1.7 and 2.6 s in all nine blocks; no slow period |

**Where the time really went.** Each model call opens a turn that lasts until the bot's next call:

| How the turn ended | Turns | Bot-hours | Share |
|---|---|---|---|
| **Answer refused before any skill ran** | 27,913 (57.6% of calls) | 307.1 | 48.4% |
| Skill ran and failed | 8,775 (18.1%) | 149.0 | 23.5% |
| Skill ran and succeeded | 10,238 (21.1%) | 72.8 | 11.5% |
| Skill ran, result unknown or no effect | 1,539 (3.2%) | 22.9 | 3.6% |
| Work orders (no model call; 7,833 turns) | | 82.3 | 13.0% |

A refused answer costs a whole turn: mean 39.6 s, of which the bot is inside a skill for 3 s.

So is the 68% an artefact? **The time is real; the label is the artefact.** The bots really were outside any
skill for 75% of the run. But it reads as "the model is slow" when the model took 4.5%. Two more cautions:

- The split between "decision" and "idle" is only the 45-second cap. With a 30-second turn, nearly all waiting
  falls under the cap and is named "decision".
- "Productive" counts any non-travel skill that is running, whether it worked or not. Of the summed work-skill
  time, 60.4 h succeeded and 43.6 h failed, was cut short, or changed nothing.

The bots were not frozen while waiting: they moved 741 blocks an hour outside skills (escapes, relocations,
take-backs) against 7,042 inside.

## 6. Why bots were away from the site

By position rows, time-weighted (631.0 bot-hours carry a position):

| Distance from home | Share of time | Bot-hours |
|---|---|---|
| 0 to 32 | 21.9% | 138.4 |
| 32 to 64 | 17.3% | 109.4 |
| 64 to 80 | 16.5% | 104.0 |
| 80 to 128 | 28.1% | 177.0 |
| 128 to 256 | 15.9% | 100.6 |
| over 256 | 0.3% | 1.6 |

**60.7% of bot time was beyond 64 blocks. 49.2% was below y=55.** Across the 53 hourly cards the count inside
64 blocks was between 1 and 8 of 12, never 12.

What took them out:

1. **The gather rule, by design.** `_gather_zone` runs with `r=64 out=6`: nothing may be gathered within 64
   blocks of home on the surface, and a bot is walked 70 blocks out first (401 walk-outs: dirt 336, sand 60,
   cobblestone 5). All 43 successful gathers in the first 10 minutes ended 65 to 130 blocks out. Over the run,
   gathers ended a median 79 blocks from home; 76% of 7,872 ended beyond 64. The card's "reached site" line is
   64. The two rules use the same number from opposite sides, so the criterion cannot pass while anyone is
   gathering.
2. **Not expeditions.** 109 expedition trips, 14.9 h in all (2.4% of bot time), 78 of the 114 trip rows in the
   first 12 hours. 79 trips have a "returned" row; 30 do not.
3. **Failing to get home.** Away time by the bot's task at the time: return 95.7 h (25%), gather iron ore 78.2 h,
   gather dirt 77.7 h, gather sand 37.6 h, deposit surplus 29.9 h. For 263.6 of the 383.2 away hours (69%) no
   skill was running at all.

Did they come back? Mostly, and quickly: 4,826 trips past 64 blocks, 4,819 ended back inside before the stop;
the median trip is 0.3 minutes (bots working on the line at 64 to 70). But 86 trips lasted over an hour and 19
over three hours. The longest were Iris (19.1 h) and Bravo (12.7 h), both sealed underground as above.

**The task "return" is the real problem**: 129.0 bot-hours in 11,403 turns, and a walk succeeded in 877 of them
(7.7%). The six largest outcomes (10,349 of the 11,403 turns):

| What happened on a "return" turn | Turns | Bot-hours |
|---|---|---|
| deposit refused: nothing to bank, not worth it, or item missing | 2,854 | 29.0 |
| goto home refused: "y=72 is N blocks above you, you cannot climb that in one move" | 2,622 | 27.8 |
| goto home refused: same action again | 2,114 | 26.9 |
| goto ran and failed (443 of them "no route exists") | 770 | 13.0 |
| goto home refused: failed before, remembered | 1,112 | 11.3 |
| goto ran and succeeded | 877 | 7.4 |

A bot underground is told to return, asks to walk home, and is refused because home is above it.

## 7. Top failure classes

Denominators: 634.0 bot-hours; 56,298 turns (48,465 model calls and 7,833 work orders). Hours are whole turns,
so they include the wait that follows. The classes do not overlap.

| # | Class | Turns | Bot-hours | Share | Fix on the showcase line? |
|---|---|---|---|---|---|
| **1** | **Same action again** (the model repeats the action just refused or failed; `repeat_loop`) | 6,973 | 89.8 | 14.2% | None found |
| **2** | **Deposit with nothing to bank** ("you are carrying birch_log: nothing to deposit", no chest in reach) | 8,446 | 84.2 | 13.3% | None found |
| **3** | **Gather ran and failed** (dirt "found but unreachable" 16.3 h; sand "beside water" or "none within range" 16.8 h; iron ore unreachable or buried) | 4,040 | 69.5 | 11.0% | Partly: landprev-01show (`9977060bd`, "take ground from the top; cobblestone before dirt") exists on its branch, not on main. Nothing found for sand |
| **4** | **Mine stopped** ("stopped to keep an exit: N pickaxe swings left" 19.2 h; "cut a step but could not stand in it" 8.6 h; "will not dig within 11 blocks of home" 7.4 h) | 2,642 | 43.2 | 6.8% | Partly: spentpick-01show (`8f6819910`, `0fd594ebd`: a bot whose pickaxes are all on their last use can craft the next) exists on `origin/spentpick-01show`, not on main |
| **5** | **Mine asked the wrong way** ("mine only digs downward", 4,046 of the 4,365 bad-argument refusals) | 4,365 | 42.7 | 6.7% | Partly: minecrew-01show (`c6623cdba`, "one line for mine and the way up") exists on a local branch only, still in review |
| 6 | Own memory says no (failed recently, or failed before) | 3,368 | 32.6 | 5.1% | A result of the classes above |
| 7 | Goto home refused for height | 2,837 | 29.8 | 4.7% | Partly: minecrew-01show r1 (`8234fd34c`, "a way up for every refused bot"), same branch |
| 8 | Explore failed / goto failed | 1,168 / 1,179 | 19.7 / 19.5 | 3.1% / 3.1% | None found |

Other fixes named on the showcase line, checked against this run:

| Name | Commit found | Bears on |
|---|---|---|
| tempstand-01show | `e7bf89c25`. **Already in this run's code** (26 temporary stands were used on the wall) | cells no stand reaches. Still 172 "0 placeable now" visits here (tower 80, monument 77, wall 7, others 8) |
| projturn-01show | `24cc654f6`, on `origin/projturn-01show-on-obsolete`, not on main | projects taking turns: the storage starvation in section 3 |
| civicvisit-01show | `8cfe28298`, on `origin/civicvisit-01show`, not on main | where a landmark's visit stands |
| planvalid-01show | `0c142ae69`, on `origin/planvalid-01show-on-projturn`, not on main | tidy fills planned in mid-air. Not measured here |
| airroute-01show | `c51772761`, local branch only. Its own Paper proof (`779559ef1`) says 0 of 5 swam out of a bent pocket | drowning (death 7) |

None of these is on main: the run's code is not an ancestor of main, and main has no commit named spentpick,
projturn, planvalid, civicvisit, tempstand, airroute or minecrew. "Exists" here means the commit was found;
nobody has shown that it removes the failure measured in this run.

No fix was found for the torch wait. The same wait was noted on the showcase on 11-10 (`6361af35a` on main, a
design note: "tower T3 open on two unwaivable torches").

## 8. What the land world should fix first

Drawn only from the numbers above, largest first.

1. **Stop paying a full turn for a refused answer** (307 bot-hours, 48%). Either do not offer what will be
   refused (deposit when nothing is bankable: 8,446 turns; mine with the wrong arguments: 4,046; goto home from
   below: 2,837), or ask again at once after a refusal. Nothing else on this list is as large.
2. **Make "return home" something the bot can do from where it is** (129 bot-hours, 7.7% success). From
   underground the remedy has to be a climb, not a refused goto.
3. **Keep gathering out of the caves under the town** (6 of 9 deaths at y=23 or lower; 5 falls within 63 blocks
   of home; 49% of bot time below y=55; dirt fetched at y=14). Check the take-back reflex before a fall.
4. **Give a bot under water a way out** (Iris 16.6 h, Bravo 8.8 h; 1,072 flood-guard refusals from all 12 bots).
   The guard names no remedy the bot can perform there.
5. **Torches from coal, and storage before the monument** (17.5 h of the town core's 28.6 h; storage never
   started). Either would have changed two card lines.
6. **Fix three card lines before the next run.** "Decision" should be shown as its three parts. "Reached site"
   at 64 blocks contradicts the gather rule at 70. "Stuck bots" counts 10 h where the stay was 16.6 h.

## 9. Where these numbers differ from the card

| Line | Card | This read | Which to trust |
|---|---|---|---|
| working share | 16.4 / 8.7 / 68.3 / 6.6 % | identical | Same number. Read it as section 5 splits it |
| deaths | 9, 1.42 per 100 | 9 (also 9 in the Paper log) | Same |
| stuck bots | Iris 10 h, Bravo 6 h | Iris 16.6 h, Bravo 8.8 h | This read for how long. The card's rule needs a whole clock hour inside 2 blocks and misses a bot that shifts a few blocks |
| reached site | 7 of 12 inside at 19:35:30Z | 5 of 12 inside by the last row before the stop at 19:37:16Z | Both. The count moves by the minute because gathering sits at 70 blocks |
| away at +6 min | 9 of 12 (main session) | 10 of 12 at exactly +6.0 min | Either; same reason |
| town core | 28.6 h | 28.6 h; the structure stood at 11.1 h | Same; section 3 says what the gap was |

## 10. Not read, or not verified

- **Why storage was never picked**: read from the project order in the code and the visit counts. The picker's
  own states were not traced.
- **Whether finished buildings still stand**: the world was not re-read.
- **Longest stuck goal**: still no reader on that host.
- **Take-back before falls**: a pattern in 3 of 5 fall deaths, not a proven cause.
- **The 3090 host**: not contacted. Latency is what the bots logged.
- **A model call that never returns**: not checked in the code whether it writes a row. The slowest logged call
  was 16.1 s against a 45 s limit. 341 `_loop_restart` rows ("no decision for 139 s") are not explained.
- **Reconnects**: the Paper log shows 50 joins for 12 bots, so 38 reconnects (15 server-side "Timed out"); the
  bots logged 23 stagnation reconnects. Not investigated. The bot units each started once and never exited or
  were killed (12 "Started" lines, 0 exit lines in the journal).
- **Server lag**: 0 "Can't keep up" lines in the Paper log (control: the same read finds 9 deaths and 50 joins).
- **Admin edits**: the card's 0 is the manual assistance log. The Paper log shows no command line, but a quiet
  RCON command would not appear there.
- **Refusal rate against the showcase's**: not compared; no analysis was run on the showcase VM.
- **Fixes**: matched by commit subject and branch only.
- **Positions**: a skill row carries its end position under its start time, so shares by distance are slightly
  blurred. Event rows are exact.
- **No tests were run** beyond the tracked-files check; this change is a report, one manifest field and one
  list entry.

## 11. How to repeat this

The analysis scripts are on the rehearsal VM in `~/close-scratch/` (`build_cache.py`, then `survey.py`, `a1.py`
to `a9.py`, `shapes.py`). They are not in the repo. They read the bot logs through
`/srv/rehearsal/tools/scripts/lib/telemetry.py` and write only to that folder. Nothing on the VM was started,
changed or deleted.
