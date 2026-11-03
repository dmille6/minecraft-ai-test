# Measurements 2026-11-03 (~20:50Z), 24 h windows, full walks via scripts/lib/telemetry.py (rotated files included)

FLEET (canary host): 1,976,102 skill/event rows, 80 bots, span 24.04 h = 1,923 bot-h. Sum of skill durations = 586 h (30% of bot-h; the rest is between skills).
Top skill time: gather 254.7 h, goto 106.5, explore 94.1, build_shop 27.3, mine 22.0, deep_mine 20.8 ...
Storage skills (n, hours, share of bot-h):
  deposit 726 calls, 2.9 h (0.15%); withdraw 10, 0.1 h; withdraw_pick 642, 1.8 h; town_deposit 1,414, 0.4 h;
  toolkit 1,743, 1.2 h; dispose_well 1,029, 2.7 h.  Together 9.1 h of 1,923 bot-h = 0.47% (1.6% of skill time).
deposit outcomes: 359 success / 258 failed / 91 aborted / 18 no_effect. Fail classes: no_path 169, interrupted 91, storage_full 40,
  path_interrupted 33, nothing_found 8. 216 of 359 successes were "after walking home" (the target chest was out of reach).
town_deposit: 1,228 success / 138 failed / 48 no_effect; town_storage_full 44, town_deposit_failed 13.
withdraw_pick (pick + ingredient search, visits every town chest, cap 16): 316 searches with a visit count: mean 7.9 chests visited,
  median 7.5, p90 16 (= the cap; 64 searches hit 16). Per-chest results: none 207, success 29, chest_unreachable 13 -> 86% of chest
  visits find nothing. Outcomes: crafted_pick 178 (no pick in town, crafted from bag), short 66, took_pick 32.
toolkit kit search (_kit_search, 451 searches, cap 12): mean 4.1 chests, median 2, p90 11; per-chest results none 1,437 / success 404
  / unreachable 15 -> 78% of chest visits are misses. Outcomes took 366, no_iron 65.
New-chest requests deferred (_deposit_new_chest) 40, the town memory marking most nearby chests full.
_stock_refused (cobble cap) 5,682 rows: cobble is refused at the chest, so it stays in bags.
LLM decision stream (llm-*.jsonl, 135,913 decisions/24 h): 'deposit' proposed 16,381 times (12% of all decisions), 15,831 aborted
  at admission ("not a banking target ... nothing to deposit" ~11k: apple, last pickaxe, chest, cooked beef, dirt; "no storage in reach" 2,919).
Town chests (town index, latest observation per chest, 16 fleet towns): 312 chests, 11-30 per town, fill 34%-94% of slots,
  67 chests (21%) full; 20-41 distinct items per town; in every town most item kinds sit in more than one chest (e.g. 29 of 41).
  Biggest stocks: oak_log ~1.1-2.8k per town, copper_ingot 0.4-2.7k, cobblestone up to 1.2k.
Bags (last row per bot, 80 bots): mean 576 items and 23.5 kinds per bot. Totals: cobblestone 26,448, cobbled_deepslate 6,872,
  bamboo 3,865, oak_log 1,366, chest 674 (8.4 per bot), oak_sapling 666, birch_sapling 435. Plants 62.5 per bot.

SHOWCASE (10 bots, 24 h, 169,777 rows, 240 bot-h; 84.5 h of skill time): explore 24.2, gather 15.8, home 14.3, build_shop 6.6 h.
Storage skills 0.7 h of 240 bot-h (0.3%). deposit 49 (40 success, 7 interrupted), town_deposit 246 (238 success),
toolkit 205 (203 success), withdraw_pick 48 (22 success, 12 no_effect), dispose_well 121 (109 success).
_sort_deposit 128 (the sorted storehouse is live: groups stone/metal/wood/fuel/tools/overflow inside + valuable/earth/build).
withdraw_pick visits mean 3.75, median 2, p90 9; chest results none 42 / success 3 (93% misses). kit search mean 3.6, p90 7; none 97 / success 46.
Showcase town index: 9 chests, 117/243 slots (48%), 0 full, 2,016 items, 17 kinds, 8 kinds in more than one chest. cobblestone 953,
  spruce_log 364, copper_ingot 240, lapis 98, iron_ingot 96, torch 65.
Showcase bags: 707 items/bot mean, cobblestone 4,457 total (10 bots), spruce_planks 917, stone_bricks 488; iron_pickaxe 37 (3.7/bot);
  plants 4.8/bot (spruce_sapling 43). Iron in town 96 ingots + 24 in bags (20 hoppers = 100 ingots + 20 chests).
