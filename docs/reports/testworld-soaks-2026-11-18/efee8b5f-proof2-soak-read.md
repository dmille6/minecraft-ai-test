exit 0
# Soak read `efee8b5f-proof2-1118`: **PASS**

Release `efee8b5fa4f836349afd9d4bde8d13e1afdf5e57+01febf`, 14 bots. Untouched 16:22-19:22Z (3.0 h = 42.0 bot-hours), load step to 20:25Z.

**Named, not failed:**
- showcase-Bravo memory rose 110 MB/h over the last 90 untouched minutes
- 10 reconnect(s) in the untouched hours (0.24 per bot-hour); lost: {'Disconnected': 10}
- THE SHOWCASE GUARD WAS OFF for this run (the showcase was stopped: tripwire S4 stopped all 13 showcase bots at 15:13:54Z; control session 11-18 ~16:20Z: run with the guard off); it re-armed at 17:22Z when the showcase's rows came back
- plant spots chosen inside a protected zone: 37; within 8 blocks of one: 21 (of 112 chosen)
- PLANTED INSIDE A PROTECTED ZONE: 3 by the bots' rows, 3 by the block history
- A TREE GREW INSIDE A PROTECTED ZONE: 209 blocks of logs and leaves by the block history, 2 trunk(s) at 65,-2, 75,31
- inside a protected zone at the end: Comet at 146,54,-50, Echo at 68,70,0

## What the read could see
- 99,377 skill rows from 14 of 14 bots; versions: `efee8b5f…+01febf` 99,377
- memory samples: 37-37 a bot of 36 expected; 1,538 of the bots' own memory lines; 2,712 Paper log lines
- showcase model p95 beside it: not read in the 30 min before the test bots started; highest 30-min value during 2.20 s over 24 checks (0 past 6 s, 5 blind)
- test bots' model calls: 3,989 answered (16.4/min), p50 0.78 s, p95 1.95 s, 0 failed

## Memory against reconnects, per bot

| bot | MB min / median / max (3 h) | of cap | slope last 90 min | restarts | reconnects 3 h | forced reconnects | buffers before -> after | MB kept each |
|---|---|---|---|---|---|---|---|---|
| Alpha | 228 / 302 / 452 | 29% | -29 MB/h | 0 | 0 | 18 | 25 -> 26 MB | 0.0 |
| Bravo | 233 / 395 / 448 | 29% | +110 MB/h | 0 | 0 | 18 | 26 -> 48 MB | 1.2 |
| Comet | 176 / 251 / 288 | 19% | -9 MB/h | 0 | 0 | 19 | 25 -> 25 MB | 0.0 |
| Delta | 221 / 303 / 446 | 29% | +42 MB/h | 0 | 0 | 17 | 26 -> 24 MB | -0.1 |
| Echo | 226 / 325 / 437 | 28% | +14 MB/h | 0 | 1 | 18 | 25 -> 24 MB | -0.0 |
| Frost | 262 / 316 / 434 | 28% | +10 MB/h | 0 | 0 | 17 | 26 -> 52 MB | 1.5 |
| Gale | 251 / 352 / 442 | 29% | -29 MB/h | 0 | 1 | 19 | 26 -> 25 MB | -0.0 |
| Haven | 224 / 323 / 434 | 28% | -45 MB/h | 0 | 0 | 20 | 24 -> 24 MB | 0.0 |
| Iris | 216 / 311 / 458 | 30% | +42 MB/h | 0 | 2 | 18 | 25 -> 24 MB | -0.1 |
| Juno | 225 / 387 / 460 | 30% | +23 MB/h | 0 | 1 | 19 | 25 -> 24 MB | -0.1 |
| Kite | 245 / 326 / 452 | 29% | -24 MB/h | 0 | 4 | 20 | 25 -> 46 MB | 1.1 |
| Lumen | 221 / 304 / 448 | 29% | +24 MB/h | 0 | 0 | 19 | 25 -> 25 MB | 0.0 |
| Maple | 263 / 315 / 409 | 27% | -18 MB/h | 0 | 0 | 17 | 24 -> 24 MB | 0.0 |
| Onyx | 250 / 348 / 446 | 29% | +40 MB/h | 0 | 1 | 19 | 26 -> 25 MB | -0.1 |

Median kept per forced reconnect: **-0.0 MB** over 14 bots (limit 8; the 11-18 leak kept 14-22). Last bot back 0.3 min after the last pause.

## Deaths, kills, building
- deaths: 0 by the server's statistics, 0 by the bots' rows, in 56.6 bot-hours; kernel memory-kill lines: 0
- connections lost over the whole run, by the server's reason: {'Disconnected': 12, 'Timed out': 258}
- blocks by hour (block-history database, the bots only): 16:00Z 388 placed / 564 cleared; 17:00Z 1,201 placed / 954 cleared; 18:00Z 1,000 placed / 1,029 cleared; 19:00Z 1,300 placed / 835 cleared; 20:00Z 839 placed / 566 cleared

## Protected zones (8 boxes from the pool's protected-zones.json)
- plant spots chosen (`_plant_spot found`): 112; **37 inside a zone** (19:18Z Alpha at 60,71,38; 19:37Z Alpha at 79,73,1; 19:38Z Alpha at 79,73,1; 18:22Z Bravo at 65,70,0; 19:13Z Bravo at 75,76,30; 19:28Z Delta at 65,70,0; 19:34Z Delta at 65,70,0; 19:38Z Delta at 65,70,0; 19:13Z Echo at 75,76,30; 18:54Z Frost at 65,70,-2); **21 within 8 blocks of one** (18:42Z Bravo at -16,68,89; 19:24Z Bravo at 4,70,57; 19:30Z Bravo at 4,70,58; 19:33Z Bravo at 4,70,58; 19:34Z Bravo at 4,70,58; 19:37Z Bravo at 5,70,57; 19:38Z Bravo at 5,70,57; 18:21Z Echo at 26,64,69; 17:30Z Frost at -13,64,74; 19:08Z Gale at 9,76,94)
- orders to plant (`_work_order place` of something that grows): 102; **37 inside a zone** (19:18Z Alpha at 60,71,38; 19:37Z Alpha at 79,73,1; 19:38Z Alpha at 79,73,1; 18:22Z Bravo at 65,70,0; 19:13Z Bravo at 75,76,30; 19:28Z Delta at 65,70,0; 19:34Z Delta at 65,70,0; 19:38Z Delta at 65,70,0; 19:13Z Echo at 75,76,30; 18:54Z Frost at 65,70,-2)
- planted, by the bots' `place` rows: 62; **3 inside a zone** (19:37Z Juno at 75,76,31; 20:04Z Juno at 58,70,21; 19:38Z Lumen at 65,70,-2)
- block history inside the zone boxes: placed by the bots 14 {'dirt': 11, 'spruce_sapling': 3}; **things that grow: 3** (19:37Z Juno spruce_sapling at 75,76,31; 19:38Z Lumen spruce_sapling at 65,70,-2; 20:04Z Juno spruce_sapling at 58,70,21); **tree growth: 209 blocks of logs and leaves** (first log of each trunk: 20:05Z Juno at 75,76,31; 20:02Z Lumen at 65,70,-2); broken by the bots: 79 {'Echo': 51, 'Onyx': 6, 'Lumen': 4, 'Juno': 18}
- refusals (`_protect_zone_refused`): 27, 27 naming the walk-out remedy; by kind: op=place purpose=other struct=0: 27
- zone walks (`_zone_walk`): 2 by outcome {'no_exit': 2}; "out" that ended inside a zone box: 0; `_needs_rescue arm=zone_walk`: 2 {'Juno': 1, 'Lumen': 1}
- deaths: 0 by the bots' rows; **0 inside a zone**
- inside a zone box at the end: Comet at 146,54,-50 (village-taiga-6_1), Echo at 68,70,0 (village-taiga-6_1)
- **Comet began inside village-taiga-6_1** at 146,54,-50 and ended at 146,54,-50: **STAYED inside**; zone walks none; it broke 0 and placed 0 blocks inside the zone (block history)
