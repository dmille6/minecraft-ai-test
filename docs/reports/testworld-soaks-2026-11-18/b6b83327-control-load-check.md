# Load-step check `b6b83327-control-1119`: **FAIL**

Release `b6b83327d5d7a71d773aa350f8eed74515937996+7b4efa`, 14 bots. Untouched 00:44-01:04Z (0.34 h = 4.8 bot-hours), load step to 02:07Z.

**FAILED:**
- memory kept per forced reconnect: median 10.6 MB of chunk buffers over 14 bots (limit 8): connections are not being let go

**Named, not failed:**
- LOAD-STEP CHECK ONLY (20 quiet minutes, then the load step): this says nothing about the untouched hours
- plant spots chosen inside a protected zone: 8; within 8 blocks of one: 6 (of 45 chosen)
- inside a protected zone at the end: Comet at 146,54,-50

## What the read could see
- 44,835 skill rows from 14 of 14 bots; versions: `b6b83327…+7b4efa` 44,835
- memory samples: 4-4 a bot of 4 expected; 5,078 of the bots' own memory lines; 1,484 Paper log lines
- showcase model p95 beside it: 2.28 s in the 30 min before the test bots started; highest 30-min value during 2.28 s over 8 checks (0 past 6 s, 0 blind)
- test bots' model calls: 1,082 answered (13.0/min), p50 0.79 s, p95 2.22 s, 0 failed

## Memory against reconnects, per bot

| bot | MB min / median / max (3 h) | of cap | slope last 90 min | restarts | reconnects 3 h | forced reconnects | buffers before -> after | MB kept each |
|---|---|---|---|---|---|---|---|---|
| Alpha | 270 / 285 / 302 | 20% | n/a | 0 | 0 | 17 | 24 -> 205 MB | 10.6 |
| Bravo | 244 / 262 / 270 | 18% | n/a | 0 | 0 | 17 | 25 -> 203 MB | 10.5 |
| Comet | 235 / 266 / 277 | 18% | n/a | 0 | 0 | 17 | 25 -> 201 MB | 10.4 |
| Delta | 280 / 376 / 421 | 27% | n/a | 0 | 0 | 17 | 24 -> 205 MB | 10.6 |
| Echo | 258 / 303 / 389 | 25% | n/a | 0 | 0 | 16 | 25 -> 188 MB | 10.2 |
| Frost | 252 / 380 / 437 | 28% | n/a | 0 | 0 | 11 | 26 -> 187 MB | 14.7 |
| Gale | 275 / 326 / 384 | 25% | n/a | 0 | 0 | 15 | 25 -> 209 MB | 12.3 |
| Haven | 265 / 267 / 346 | 23% | n/a | 0 | 0 | 15 | 26 -> 190 MB | 10.9 |
| Iris | 250 / 323 / 385 | 25% | n/a | 0 | 0 | 17 | 25 -> 210 MB | 10.9 |
| Juno | 231 / 255 / 270 | 18% | n/a | 0 | 0 | 16 | 24 -> 182 MB | 9.9 |
| Kite | 246 / 303 / 340 | 22% | n/a | 0 | 0 | 17 | 25 -> 188 MB | 9.6 |
| Lumen | 202 / 269 / 380 | 25% | n/a | 0 | 0 | 16 | 24 -> 188 MB | 10.2 |
| Maple | 249 / 305 / 364 | 24% | n/a | 0 | 0 | 16 | 24 -> 184 MB | 10.0 |
| Onyx | 251 / 268 / 352 | 23% | n/a | 0 | 0 | 15 | 24 -> 211 MB | 12.5 |

Median kept per forced reconnect: **10.6 MB** over 14 bots (limit 8; the 11-18 leak kept 14-22). All bots back in the world 0.2 min after the last pause.

## Deaths, kills, building
- deaths: 0 by the server's statistics, 0 by the bots' rows, in 19.4 bot-hours; kernel memory-kill lines: 0
- connections lost over the whole run, by the server's reason: {'Timed out': 218, 'Disconnected': 4}
- blocks by hour (block-history database, the bots only): 00:00Z 235 placed / 398 cleared; 01:00Z 838 placed / 765 cleared; 02:00Z 272 placed / 115 cleared

## Protected zones (8 boxes from the pool's protected-zones.json)
- plant spots chosen (`_plant_spot found`): 45; **8 inside a zone** (01:40Z Delta at 65,70,-2; 01:24Z Frost at 67,72,4; 01:29Z Frost at 67,72,4; 01:34Z Frost at 67,72,4; 02:02Z Frost at 83,66,-19; 01:02Z Haven at 65,70,-2; 01:17Z Haven at 65,70,-2; 01:20Z Haven at 65,70,-2); **6 within 8 blocks of one** (01:18Z Delta at -6,66,66; 01:20Z Delta at -6,66,66; 01:20Z Echo at -9,66,57; 01:40Z Frost at 46,80,63; 01:45Z Frost at 41,82,63; 01:51Z Frost at 52,82,70)
- orders to plant (`_work_order place` of something that grows): 26; **0 inside a zone**
- planted, by the bots' `place` rows: 24; **0 inside a zone**
- block history inside the zone boxes: placed by the bots 0; **things that grow: 0**; **tree growth: 0 blocks of logs and leaves**; broken by the bots: 0
- refusals (`_protect_zone_refused`): 0
- zone walks (`_zone_walk`): 0; "out" that ended inside a zone box: 0; `_needs_rescue arm=zone_walk`: 0
- deaths: 0 by the bots' rows; **0 inside a zone**
- inside a zone box at the end: Comet at 146,54,-50 (village-taiga-6_1)
- **Comet began inside village-taiga-6_1** at 146,54,-50 and ended at 146,54,-50: **STAYED inside**; zone walks none; it broke 0 and placed 0 blocks inside the zone (block history)
