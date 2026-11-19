# Soak read `f7cc2a19-stack-1118`: **FAIL**

Release `f7cc2a19cd92ff0fc50d8be86da2e1396b824a91+4b9e7f`, 14 bots. Untouched 20:33-23:33Z (3.0 h = 42.0 bot-hours), load step to 00:35Z.

**FAILED:**
- the last bot was back 14 min after the last pause ended (limit 10)

**Named, not failed:**
- 7 reconnect(s) in the untouched hours (0.17 per bot-hour); lost: {'Disconnected': 7}
- inside a protected zone at the end: Comet at 146,54,-50

## What the read could see
- 94,699 skill rows from 14 of 14 bots; versions: `f7cc2a19…+4b9e7f` 94,699
- memory samples: 37-37 a bot of 36 expected; 1,444 of the bots' own memory lines; 1,678 Paper log lines
- showcase model p95 beside it: 1.88 s in the 30 min before the test bots started; highest 30-min value during 2.35 s over 24 checks (0 past 6 s, 0 blind)
- test bots' model calls: 4,223 answered (17.4/min), p50 0.72 s, p95 1.86 s, 0 failed

## Memory against reconnects, per bot

| bot | MB min / median / max (3 h) | of cap | slope last 90 min | restarts | reconnects 3 h | forced reconnects | buffers before -> after | MB kept each |
|---|---|---|---|---|---|---|---|---|
| Alpha | 199 / 325 / 510 | 33% | +94 MB/h | 0 | 1 | 18 | 47 -> 46 MB | -0.1 |
| Bravo | 255 / 371 / 513 | 33% | +78 MB/h | 0 | 2 | 18 | 47 -> 46 MB | -0.0 |
| Comet | 182 / 252 / 292 | 19% | -23 MB/h | 0 | 0 | 20 | 25 -> 25 MB | 0.0 |
| Delta | 270 / 332 / 456 | 30% | +43 MB/h | 0 | 3 | 17 | 25 -> 25 MB | 0.0 |
| Echo | 254 / 391 / 458 | 30% | -38 MB/h | 0 | 0 | 17 | 25 -> 46 MB | 1.2 |
| Frost | 257 / 311 / 407 | 26% | +42 MB/h | 0 | 0 | 14 | 25 -> 25 MB | 0.0 |
| Gale | 236 / 336 / 444 | 29% | +28 MB/h | 0 | 0 | 14 | 26 -> 25 MB | -0.0 |
| Haven | 211 / 310 / 397 | 26% | +1 MB/h | 0 | 0 | 17 | 25 -> 25 MB | 0.0 |
| Iris | 209 / 339 / 430 | 28% | +37 MB/h | 0 | 0 | 18 | 24 -> 48 MB | 1.3 |
| Juno | 210 / 407 / 456 | 30% | +23 MB/h | 0 | 0 | 14 | 24 -> 46 MB | 1.6 |
| Kite | 217 / 303 / 407 | 26% | +37 MB/h | 0 | 0 | 20 | 25 -> 25 MB | 0.0 |
| Lumen | 216 / 327 / 427 | 28% | -12 MB/h | 0 | 0 | 16 | 25 -> 25 MB | 0.0 |
| Maple | 252 / 359 / 543 | 35% | +82 MB/h | 0 | 1 | 12 | 26 -> 24 MB | -0.1 |
| Onyx | 211 / 342 / 423 | 28% | +68 MB/h | 0 | 0 | 16 | 24 -> 47 MB | 1.4 |

Median kept per forced reconnect: **0.0 MB** over 14 bots (limit 8; the 11-18 leak kept 14-22). Last bot back 14.3 min after the last pause.

## Deaths, kills, building
- deaths: 0 by the server's statistics, 0 by the bots' rows, in 56.6 bot-hours; kernel memory-kill lines: 0
- connections lost over the whole run, by the server's reason: {'Disconnected': 9, 'Timed out': 229}
- blocks by hour (block-history database, the bots only): 20:00Z 789 placed / 951 cleared; 21:00Z 1,266 placed / 1,268 cleared; 22:00Z 1,294 placed / 1,179 cleared; 23:00Z 1,963 placed / 805 cleared; 00:00Z 792 placed / 719 cleared

## Protected zones (8 boxes from the pool's protected-zones.json)
- plant spots chosen (`_plant_spot found`): 97; **0 inside a zone**; **0 within 8 blocks of one**
- orders to plant (`_work_order place` of something that grows): 78; **0 inside a zone**
- planted, by the bots' `place` rows: 71; **0 inside a zone**
- block history inside the zone boxes: placed by the bots 14 {'cobblestone': 12, 'gravel': 2}; **things that grow: 0**; **tree growth: 0 blocks of logs and leaves**; broken by the bots: 25 {'Delta': 2, 'Frost': 7, 'Lumen': 16}
- refusals (`_protect_zone_refused`): 0
- zone walks (`_zone_walk`): 2 by outcome {'no_exit': 2}; "out" that ended inside a zone box: 0; `_needs_rescue arm=zone_walk`: 2 {'Haven': 2}
- deaths: 0 by the bots' rows; **0 inside a zone**
- inside a zone box at the end: Comet at 146,54,-50 (village-taiga-6_1)
- **Comet began inside village-taiga-6_1** at 146,54,-50 and ended at 146,54,-50: **STAYED inside**; zone walks none; it broke 0 and placed 0 blocks inside the zone (block history)
