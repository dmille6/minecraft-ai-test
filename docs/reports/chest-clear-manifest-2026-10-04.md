# Town chest clear — proposed manifest (for the owner's approval)

**Status: RUN 2026-10-04 18:07Z (owner approved ~18:10Z local thread: "lets run it now"; eggs/scutes/flint/clay/ink and
decorations "yes").** Fresh census 18:06:41Z -> plan -> read-only predicate validation (96/96 planned slots matched;
32/32 spent tools matched the spent predicate; 20/20 usable tools did NOT and did match by id) -> one trial slot ->
scripts/host/cc_clear.py run: one `execute if items ... run item replace ... with air` per slot (a slot a bot changed
since the census is left alone). **Removed 105,053 items / 3,473 slots** (stone above 256/town 83,557 in 1,368 slots;
spent tools 1,175; ballast 9,719; plant litter 8,180; unused drops 2,297; decorations 124; spoiled food 1). 0 errors,
1 slot skipped (the trial). Re-census 18:07:50Z: kept items 92,846 -> 92,846 (usable tools 1,422, ingots 806, wood
67,854, saplings 4,362, chests 168, ores/coal 7,963 -- all unchanged); stone 4,096 = 256 x 16 towns; full bank
containers 233 -> 0; free bank slots 2,669 -> 6,142. Files: docs/reports/census/{census-before-clear,census-after-clear,
clear-plan,clear-result}-2026-10-04*. Not touched: deep containers, beyond 48 blocks, region-file-only chests.

~~Status: PROPOSED, NOT RUN.~~ One-time admin clear under the owner's 09-28 permission. Junk only; tools that work, ingots, ores, wood, food and stations are kept. It runs only after the "no junk in chests" fix is live, so the chests cannot refill. The exact list is regenerated from a fresh census right before the run, and checked again afterwards.

Source: read-only census, 2026-10-04 02:52Z. 448 containers within 48 blocks of the 16 town homes; every slot was answered (`docs/reports/census/`).

The **bank** is 375 containers near home, holding 197,863 items. 228 of the 375 containers are full, and 73% of slots are used.

## Proposed for removal (bank only; "firm junk")

| Category | Items | Slots freed |
|---|---|---|
| Cobblestone + cobbled_deepslate **above 256 per town** (4 stacks kept per town) | 81,535 | 1,337 |
| **Spent tools** (10 uses or fewer left): 664 stone pickaxes, 424 wooden pickaxes, axes, shovels and others | 1,156 | 1,156 |
| Ballast blocks: dirt 5,680, sand 1,748, andesite 857, granite 469, diorite 422, gravel 179, dripstone 208, other | 9,721 | 339 |
| Seeds, flowers, leaf litter, kelp | 8,180 | 292 |
| Spoiled food (one pufferfish) | 1 | 1 |
| **Total** | **100,593** | **3,125 (42% of used slots)** |

Free bank slots would go from 2,740 to 5,865.

## The owner decides each of these

| Category | Items | Slots |
|---|---|---|
| Drops the bots never use: eggs 1,262, armadillo scutes 304, flint 286, clay balls 276, ink sacs 156, other | 2,297 | 235 |
| Decorations and odd pickups: glass, buttons, stone bricks, wool, terracotta, rail, 2 TNT | 125 | 66 |

## Kept (what withdrawals will draw on)

- **Usable tools: 1,402.** This includes 897 stone pickaxes (640 of them more than half left), 438 wooden pickaxes and 8 iron pickaxes.
- **Ingots, ores, gems, fuel:** iron ingots 430, copper ingots 354, raw copper 5,191, raw iron 169, coal 2,483, lapis 465, diamond 1.
- **Wood:** logs 44,701, planks 6,995, sticks 14,215, bamboo 6,058.
- **Saplings:** 4,362.
- **Food:** 455.
- **Utility:** torches 2,050, crafting tables 783, furnaces 312, **chests 168**, ladders 89, buckets 54.

## Not touched

- **Deep containers** (73 of them, more than 12 blocks above or below home). They mix natural loot chests with bot deposits.
- **Anything beyond 48 blocks from home.**
