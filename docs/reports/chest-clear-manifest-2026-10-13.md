# Town chest clear #2 (stock targets): what it would remove

**Status: PREPARED, NOT RUN. It waits for the owner's explicit go.** No world has been changed and no bot has been
stopped. Nothing runs until the owner has seen this list.

**Why now.**
- The owner allowed one more clear on 10-10, but only after the inflow fixes ship.
- stocktarget-01 is that fix. It was KEPT at +180 and promoted fleet-wide (fleet `48b093c`, 10-13 19:40Z).
- The owner confirmed the caps on 10-12: "bamboo 0 and bucket 2 are fine". They are in
  `docs/reports/stocktarget-clear-caps-2026-10-10.json`.

## Source

A read-only RCON census of all 16 towns, started 2026-10-13 20:13:54Z (`docs/reports/census/`).

- **Scope.** The bank box: every container within 48 blocks of home on x/z and within 12 blocks on y. This is the same
  scope as the 10-04 clear. It holds 353 containers.
- **Every slot was read**, one element at a time. 0 errors and 0 unreadable positions.
- **Container discovery was checked two independent ways.** The first list is every container position from the 10-04
  and 10-10 censuses, plus every coordinate named in bot logs since 10-05. The second is a read of every saved
  region-file chunk of every bank box.
  - The two lists gave the same container count in all 16 towns.
  - The region read found 0 containers that the first list did not have.
  - Every chunk was read.

The bots were live during this census, so the exact list is rebuilt from a fresh census at run time, after the bots
are stopped. Expect small changes.

## Per town

"Full" means all 27 slots of a chest or barrel are used. "Removed" means whole stacks are taken out. "Reduced" means a
stack is cut down to the cap and keeps its slot: 668 items in 27 stacks.

| Town | Containers | Full before -> after | Used slots before -> after | Items before | Removed (slots freed) | Reduced | Items after |
|---|---|---|---|---|---|---|---|
| board-a | 35 | 33 -> 0 | 930 -> 157 | 25,167 | 22,716 (773) | 91 | 2,360 |
| board-b | 20 | 17 -> 0 | 477 -> 80 | 21,084 | 19,869 (397) | 0 | 1,215 |
| board-c | 32 | 25 -> 0 | 822 -> 158 | 23,091 | 21,042 (664) | 65 | 1,984 |
| board-d | 31 | 24 -> 0 | 796 -> 138 | 22,519 | 20,708 (658) | 76 | 1,735 |
| hive-a | 24 | 12 -> 0 | 499 -> 141 | 15,939 | 13,459 (358) | 87 | 2,393 |
| hive-b | 11 | 6 -> 0 | 236 -> 92 | 7,472 | 6,189 (144) | 0 | 1,283 |
| hive-c | 31 | 18 -> 0 | 602 -> 103 | 24,611 | 23,105 (499) | 0 | 1,506 |
| hive-d | 14 | 13 -> 0 | 366 -> 71 | 14,305 | 13,115 (295) | 0 | 1,190 |
| isolated-a | 21 | 17 -> 0 | 524 -> 138 | 16,327 | 14,124 (386) | 62 | 2,141 |
| isolated-b | 20 | 17 -> 0 | 509 -> 123 | 17,189 | 15,128 (386) | 76 | 1,985 |
| isolated-c | 17 | 16 -> 0 | 441 -> 124 | 16,077 | 13,815 (317) | 64 | 2,198 |
| isolated-d | 14 | 13 -> 0 | 376 -> 109 | 14,114 | 11,890 (267) | 65 | 2,159 |
| placebo-a | 17 | 8 -> 0 | 358 -> 77 | 12,296 | 11,145 (281) | 0 | 1,151 |
| placebo-b | 23 | 17 -> 0 | 568 -> 93 | 24,276 | 22,844 (475) | 0 | 1,432 |
| placebo-c | 28 | 7 -> 0 | 535 -> 126 | 14,694 | 12,916 (409) | 82 | 1,696 |
| placebo-d | 15 | 12 -> 0 | 374 -> 87 | 13,962 | 12,325 (287) | 0 | 1,637 |
| **Total** | **353** | **255 -> 0** | **8,413 -> 1,817** | **283,123** | **254,390 (6,596)** | **668** | **28,065** |

The 16 banks have 9,531 slots in all. Free slots would go from 1,118 to 7,714.

## Removed, by category (all 16 towns)

| Category (cap per town) | Items | Slots freed |
|---|---|---|
| Logs above 64 of each type (oak 99,135, birch 10,294) | 109,429 | 1,935 |
| Cobblestone + cobbled_deepslate above 256 combined | 108,549 | 1,966 |
| Sticks above 64 | 17,364 | 382 |
| Planks above 64 of each type | 6,466 | 213 |
| Bamboo (cap 0, owner-confirmed 10-12) | 6,058 | 120 |
| Saplings above 64 of each type (oak 3,325, birch 62) | 3,387 | 95 |
| Stations and utility above cap (see note 1) | 2,134 | 214 |
| Usable stone and wooden tools above the keep (see note 2) | 1,494 | 1,494 |
| Spent tools, 10 uses or fewer left; stone, wooden and golden only. Stone pickaxes 150, wooden pickaxes 24, 3 others | 177 | 177 |
| Junk on the well's list (eggs, flint, clay, ink sacs, scutes, decorations) | **0** | 0 |
| Dirt, sand, gravel, deepslate, tuff, calcite, sandstone (cap 0) | **0** | 0 |
| Stone above 64 | **0** (there are only 7 stone in all) | 0 |
| **Total** | **255,058** (254,390 removed + 668 reduced) | **6,596** |

1. **Stations and utility:**
   - torches 962 (cap 64)
   - crafting tables 765 (cap 2)
   - furnaces 272 (cap 4)
   - chests 101 (cap 8)
   - buckets 34 (cap 2)

   652 of the 668 reduced items are in this row. The other 16 are one birch log stack and one birch sapling stack.
2. **Usable tools above the keep:**
   - stone pickaxes 1,215 (keep 16 per town)
   - wooden pickaxes 227 (keep 4)
   - swords 34 (keep 0)
   - wooden axes 16 and shovels 2 (keep 0)

   **The keep holds the best copies.** The 256 kept stone pickaxes have a median of 125 uses left; the 1,215 removed
   have a median of 38.

**The zeros are real, not a blind spot.** The same census reads 59 distinct item names and 283,123 items, including the
7 stone. No dirt, sand, gravel, egg, flint or clay ball appears in any of the 353 containers. The 10-04 clear removed
9,719 ballast and 2,297 drops. Since then the bots have stopped banking ballast, and the junk wells take the drops.

## Kept, and never touched

These are not capped, so nothing of them is removed:

| Kept | Items |
|---|---|
| Ores and raw metal (raw copper 9,509, raw iron 491, raw gold 1) | 10,001 |
| Coal, gems, lapis, redstone (coal 3,881, lapis 846, redstone 17, diamond 1) | 4,758 |
| Ingots (iron 1,660, copper 378) | 2,038 |
| Food (apples 314, melon, fish, meat, kelp and more) | 455 |
| Iron tools: 10 iron pickaxes. Iron, diamond and netherite tools are never touched, spent or not. | 10 |

**Items the clear never acts on, whatever the caps say:**
- any item with a name, enchantment or other special data;
- any item whose data the server shortens (books, potions; 1 potion today).

These are kept up to their cap:

| Kept up to cap | Items |
|---|---|
| Wood (64 of each log and plank type, and 64 sticks) | 4,185 |
| Stone and cobble (256 cobble per town) | 4,103 |
| Stations, torches, ladders, buckets | 1,194 |
| Saplings | 975 |
| Usable stone and wooden tools within the keep | 339 |

## What this means for the bots

- **Every town keeps its working base:**
  - 64 of each wood
  - 256 cobble
  - the 16 best stone pickaxes
  - 2 crafting tables and 4 furnaces
  - 8 spare chests
  - all metal, ore, coal and food
- **The chests should not fill up again in 48 hours.** That was the owner's condition on 10-10. After the clear,
  stocktarget-01 (now live) only banks wood and cobble up to those same targets, and the surplus goes down the well.
- **What is lost.** About 109k logs and 1,215 usable stone pickaxes.
  - The owner accepted this when setting the caps. The measured town draw of these items was zero (design section 1).
  - The run's `census-before` file records every removed stack: its id, count, damage, chest and slot. A restore is
    possible, but it would be a separate world edit.

## How it runs

The procedure is in `docs/reports/chest-clear-procedure-2026-10-13.md`.

1. **Keep the chunks loaded.** Each world keeps every bank-box chunk loaded while its bots are offline, using chunk
   tickets (`forceload`). The tickets change no blocks, and they are removed afterwards.
2. **Stop and clear.** All 80 bots are stopped. A fresh census is taken, then the clear runs one slot at a time.
3. **Fence and restart.** The bots' town journals are fenced (`stockreset.mjs`), so every count from before the clear is
   dropped. Then the bots restart 12 s apart.

**Downtime:**
- Each bot is down about 5 to 25 minutes, about 15 on average.
- The canary slot is held for about 35 to 45 minutes.
