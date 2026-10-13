# Town chest clear #2 (stock targets): what it would remove

**Status: PREPARED, NOT RUN. It waits for the owner's explicit go.** No world has been changed and no bot has been
stopped. Nothing runs until the owner has seen this list.

**Why now.** The owner allowed one more clear on 10-10, but only after the inflow fixes ship. stocktarget-01 is that
fix. It was KEPT at +180 and promoted fleet-wide (fleet `48b093c`, 10-13 19:40Z). The owner confirmed the caps on
10-12: "bamboo 0 and bucket 2 are fine". The caps are in `docs/reports/stocktarget-clear-caps-2026-10-10.json`.

**Source.** A read-only RCON census of all 16 towns, started 2026-10-13 19:55:05Z (`docs/reports/census/`).

- **Bank box.** Every container within 48 blocks of home on x/z and within 12 blocks on y. This is the same scope as the
  10-04 clear.
- **Count.** 353 containers.
- **Every slot was read**, one element at a time. 0 incomplete reads, 0 errors.
- **Container discovery was checked two independent ways.**
  - Every container position from the 10-04 and 10-10 censuses, plus every coordinate named in bot logs since 10-05.
  - A read of the world's saved region files.
  - Both found exactly the same container count in every town (35, 20, 32, 31, 24, 11, 31, 14, 21, 20, 17, 14, 17, 23,
    28, 15). The region read found 0 containers that the first list did not have.

The bots were live during this census, so the exact list is rebuilt from a fresh census at run time, after the bots
are stopped. Expect small changes.

## Per town

"Full" means all 27 slots of a chest or barrel are used. "Removed" means whole stacks are taken out. "Reduced" means a
stack is cut down to the cap and keeps its slot (668 items in 27 stacks).

| Town | Containers | Full before -> after | Used slots before -> after | Items before | Removed (slots freed) | Reduced | Items after |
|---|---|---|---|---|---|---|---|
| board-a | 35 | 33 -> 0 | 930 -> 157 | 25,132 | 22,683 (773) | 91 | 2,358 |
| board-b | 20 | 17 -> 0 | 477 -> 80 | 21,084 | 19,869 (397) | 0 | 1,215 |
| board-c | 32 | 25 -> 0 | 822 -> 158 | 23,091 | 21,042 (664) | 65 | 1,984 |
| board-d | 31 | 24 -> 0 | 796 -> 138 | 22,519 | 20,708 (658) | 76 | 1,735 |
| hive-a | 24 | 12 -> 0 | 500 -> 138 | 16,188 | 13,715 (362) | 87 | 2,386 |
| hive-b | 11 | 6 -> 0 | 242 -> 92 | 7,856 | 6,573 (150) | 0 | 1,283 |
| hive-c | 31 | 18 -> 0 | 602 -> 103 | 24,608 | 23,105 (499) | 0 | 1,503 |
| hive-d | 14 | 13 -> 0 | 366 -> 71 | 14,305 | 13,115 (295) | 0 | 1,190 |
| isolated-a | 21 | 17 -> 0 | 524 -> 138 | 16,327 | 14,124 (386) | 62 | 2,141 |
| isolated-b | 20 | 17 -> 0 | 509 -> 123 | 17,189 | 15,128 (386) | 76 | 1,985 |
| isolated-c | 17 | 16 -> 0 | 441 -> 124 | 16,076 | 13,814 (317) | 64 | 2,198 |
| isolated-d | 14 | 13 -> 0 | 376 -> 109 | 14,038 | 11,825 (267) | 65 | 2,148 |
| placebo-a | 17 | 8 -> 0 | 358 -> 77 | 12,296 | 11,145 (281) | 0 | 1,151 |
| placebo-b | 23 | 18 -> 0 | 569 -> 93 | 24,277 | 22,845 (476) | 0 | 1,432 |
| placebo-c | 28 | 7 -> 0 | 535 -> 126 | 14,694 | 12,916 (409) | 82 | 1,696 |
| placebo-d | 15 | 14 -> 0 | 383 -> 87 | 14,538 | 12,901 (296) | 0 | 1,637 |
| **Total** | **353** | **258 -> 0** | **8,430 -> 1,814** | **284,218** | **255,508 (6,616)** | **668** | **28,042** |

Free slots across the 9,531-slot bank would go from 1,101 to 7,717.

## Removed, by category (all 16 towns)

| Category (cap per town) | Items | Slots freed |
|---|---|---|
| Logs above 64 of each type (oak 99,296, birch 10,358) | 109,654 | 1,940 |
| Cobblestone + cobbled_deepslate above 256 combined | 109,445 | 1,980 |
| Sticks above 64 | 17,361 | 382 |
| Planks above 64 of each type | 6,465 | 213 |
| Bamboo (cap 0, owner-confirmed 10-12) | 6,058 | 120 |
| Saplings above 64 of each type (oak 3,325, birch 62) | 3,387 | 95 |
| Stations and utility above cap: torches 962 (cap 64), crafting tables 765 (cap 2), furnaces 272 (cap 4), chests 101 (cap 8), buckets 34 (cap 2). 652 of the 668 reduced items are here; the other 16 are a birch log and a birch sapling stack. | 2,134 | 214 |
| Usable stone and wooden tools above the keep: stone pickaxes 1,216 (keep 16), wooden pickaxes 227 (keep 4), swords 34 (keep 0), wooden axes 16 and shovels 2 (keep 0) | 1,495 | 1,495 |
| Spent tools (10 uses or fewer left; stone, wooden and golden only): stone pickaxes 150, wooden pickaxes 24, 3 others | 177 | 177 |
| Junk on the well's list (eggs, flint, clay, ink sacs, scutes, decorations) | **0** | 0 |
| Dirt, sand, gravel, deepslate, tuff, calcite, sandstone (cap 0) | **0** | 0 |
| Stone above 64 | **0** (7 stone in all) | 0 |
| **Total** | **256,176** (255,508 removed + 668 reduced) | **6,616** |

**The zeros are real, not a blind spot.** The same census reads 59 distinct item names and 284,218 items. Not one dirt,
sand, gravel, egg, flint or clay ball appears in any of the 353 containers.

- The 10-04 clear removed 9,719 ballast and 2,297 drops.
- Since then the bots stopped banking ballast, and the junk wells take the drops.

## Kept, and never touched

These are not capped, so nothing of them is removed:

| Kept | Items |
|---|---|
| Ores and raw metal (raw copper 9,499, raw iron 490, raw gold 1) | 9,990 |
| Coal, gems, lapis, redstone (coal 3,876, lapis 846, diamond 1) | 4,753 |
| Ingots (iron 1,653, copper 378) | 2,031 |
| Food (apples, melon, fish, meat, kelp and more) | about 460 |
| Iron tools (10 iron pickaxes, **spent or not**: iron/diamond/netherite tools are never touched) | 10 |
| Books, potions, enchanted items: any item whose data the server abbreviates is never acted on (1 potion today) | 1 |

These are kept up to their cap:

| Kept up to cap | Items |
|---|---|
| Wood within cap (64 of each log, plank type and sticks) | 4,185 |
| Stone/cobble within cap (256 cobble per town) | 4,103 |
| Stations, torches, ladders, buckets within cap | 1,194 |
| Saplings within cap | 975 |
| Usable stone/wooden tools within the keep | 339 |

## What this means for the bots

- Every town keeps its working base: 64 of each wood, 256 cobble, 16 stone pickaxes, a few tables and furnaces, 8 spare
  chests, and all metal, ore, coal and food.
- After the clear, stocktarget-01 (now live) only banks wood and cobble up to those same targets. The surplus goes down
  the well.
- So the chests should not fill up again in 48 hours. That was the owner's condition on 10-10.
- **What is lost.** About 110k logs and 1,216 usable stone pickaxes. The owner accepted this when setting the caps.
  - Measured town draw of these items was zero; design section 1.
  - The `census-before` file records every removed stack: id, count, damage, chest and slot. A restore is possible but
    would be a separate world edit.

## How it runs

The procedure is `docs/reports/chest-clear-procedure-2026-10-13.md`.

- **Stop and clear.** All 80 bots are stopped, a fresh census is taken, and then the per-slot clear runs.
- **Restart.** The bots' town journals are fenced (`stockreset.mjs`), then the bots restart 12 s apart.
- **Downtime.** Each bot is down about 5 to 25 minutes (about 15 on average).
- **Canary slot.** It is held for about 35 to 40 minutes.
