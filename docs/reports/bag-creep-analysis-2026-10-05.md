# Why bags are filling up again — 2026-10-05

Owner question (10-05 ~17:10Z): "Why are bag inventories creeping back up? What is filling our bags, and why are we
not using or depositing what's in them?"

This was a **read-only** analysis. No code was changed, nothing was deployed, nothing was written over RCON and
nothing was committed.

- **Fleet:** `1918bb5` on 60 bots.
- **Canary pools, reported separately:**
  - chestfull-02 (`47110e8`) on board-a, board-c, board-d and placebo-d since 15:24Z. Called **cf2** below (20 bots).
  - junkwell-01 (`911d792`) ran on placebo-a and board-b from 10:05Z to 15:13Z, then was reverted. Called **jw**
    (10 bots).
  - The other 50 bots, which ran no canary today, are called **rest**.
- **Telemetry:**
  - Source: 10.0.0.31, read bot by bot through `lib.telemetry.Events.load`, covering the live logs and the rotated
    `.gz` files, deduplicated and sorted by time.
  - 36 h window (10-04 04:00Z to 10-05 17:20Z): **1,919,841 rows from 80 bots**, about 51k rows an hour, which matches
    the normal rate.
  - 24 h window used for town visits and decisions: 1,263,122 skill rows, plus **159,500 model decisions**.
- **Positive control:** `scoreboard.py`, re-run on the owner's two windows, reproduces **39/80** (owner quoted 38)
  and **45/80**.
- **Independent review:** Codex reviewed the method and the headline numbers and re-ran the summaries. Its
  corrections are applied throughout, and section 6 lists them.

---

## The short answers

1. **The creep is small and mostly local.**
   - Bags are far emptier than 24 h ago: 71 of 80 bots were at 34 or more slots then, against 49 now.
   - Since the low point this morning (about 10:00 to 12:00Z), bags at 34+ went from about 43–44 up to 49.
   - But the **average bag did not grow**: about 33.2 slots fleet-wide, flat since 08:00Z.
   - The share of bot-time spent at 34+ moved only 0.56 → 0.61.
   - **The 50 bots with no canary did not creep at all** (29–31 of 50 at 34+; time share 0.61 → 0.57).
   - The rise is mostly the 10 junk-well bots (3–4 → 8 of 10). Those bots had been emptied, then filled their free
     slots with working material. Some is also bots near 33–34 crossing the line.
2. **What fills bags is a fixed layer that never moves, with working material on top.** A typical bag holds:
   - **About 11–12 slots of things that have no exit at all today:**
     - eggs, flint, ink sacs, scutes, clay and dripstone: 5.3
     - food, mostly apples: 2.1 (hunger read 20 in every one of 778,498 snapshots, so no bot has needed to eat)
     - bone meal: 0.9 (made by the composter, used by nothing)
     - glass, buttons, slabs and bricks: 1.8
     - plants the composter will not take, such as wildflowers, mushrooms and kelp: about 1.4
   - **About 5 slots of equipment:** a table, a furnace, a bucket, torches, ladders and spare chests.
   - **About 2 slots of saplings** kept for planting.
   - **About 3 slots of tools:** duplicate usable pickaxes and spent ones.
   - **What changed in 24 h:**
     - The composter removed about 4.3 slots per bot of leaf litter and seeds.
     - Tool cleanup removed about 1.8 slots of spent axes and shovels.
     - Those slots refilled with cobblestone (+1.1), ores and ingots (+0.6), wood (+0.55), stone pickaxes (+0.5),
       dirt and ballast (+0.4), and **bone meal from the composter itself (+0.8)**.
3. **Bags do not empty because deposit only happens when the model happens to pick it, and it rarely works.**
   - **The bots do go home.** Bots at 34+ slots made **829 town stays in 24 h** (77 different bots, median stay
     9 minutes).
   - In **715** of those stays, a deposit would have freed at least one slot (median 4).
   - Only **231** stays included any deposit attempt, and only **130** included a success.
   - Over the median stay, the bag did not change at all.
   - Nothing makes a full bot deposit at town. The composter and the withdraw step both have automatic town orders;
     deposit does not.
   - **The model proposed deposit 9,582 times in 24 h:**
     - 527 succeeded.
     - 3,338 (35%) asked to deposit **apples**, which the bank refuses.
   - **Craftroom refusals form a stall loop, not a fill loop.** About 3,500 pickaxe, table and furnace crafts a day
     are refused because the bag is full, and most of the pickaxe refusals come from bots that already hold a usable
     pickaxe.
     - 2,658 refusals told the bot to "deposit X".
     - Only 7% of those were followed by any deposit within 10 minutes, and 3.5% by a successful one.
4. **What would free the most slots** (section 4 has the ranking and the caveats):
   1. Re-run the junk well: it drains the 5.3-slot list, and the canary measured −2.0 slots per bot.
   2. Add a deterministic deposit at town for bags at 34+: about 4 slots per full stay in theory, but half of that is
      spare pickaxes.
   3. Stop making duplicate pickaxes.
   4. Give apples, other food, bone meal and the leftover plants an exit.

   **None of the queued changes adds a deposit order.** Withdraw slightly *adds* to bags, chest-full and grid fix are
   about neutral for bags, bamboo is small, and the cobble rule can only make bags fuller.

---

## 1. Is the creep real?

### How bags are counted, and how wrong that count is

`scoreboard.py` counts a bag like this:
- tools and buckets take one slot each;
- every other item takes ⌈count/64⌉ slots.

I checked this against the bots' own slot counts. Each `_craft_room`, `compost` and `wear_out` row reports N/36 from
`bot.inventory.items()`, which is a client count, not a server measurement. There were 12,566 rows from 78 bots, and
82% of them were full bags.

| estimator | mean error (slots) | exact | within 1 | over-reads | at 34+: misses |
|---|---|---|---|---|---|
| scoreboard (owner's numbers) | **−0.77** | 37% | 78% | 5% | 758 of 11,358 |
| corrected stack sizes (used below) | **−0.25** | 77% | 98% | 0% | 89 of 11,358 |

The scoreboard errs in three ways:
- **Eggs stack to 16, not 64.** Brown egg and egg together are worth +0.56 slots per bot.
- **It counts every empty bucket as one slot**, but they stack to 16: −0.10.
- **It cannot see split stacks.** Telemetry adds up the inventory by item name. This is the remaining error of about
  0.25, and it affects both estimators.

So the scoreboard **under-counts full bags by about 5–6 bots**; its "45" is about 49–50 on the corrected count.
- The owner's trend direction still holds.
- I did not change `scoreboard.py`. Read-only.
- Codex found that my parser took the "before" number on 35 refusal rows. Fixing it changes nothing: −0.77 and
  −0.25.

### Bags at 34+ slots, by 2-hour bin

The count uses each bot's last snapshot in the bin, on the corrected estimator. The time share is the share of
bot-time spent at 34+ slots.

| bin start (Z) | fleet ≥34 (scoreboard) | fleet ≥34 (corrected) | fleet mean slots | fleet time share | rest (50): ≥34 / mean / time share | cf2 (20): ≥34 / time share | jw (10): ≥34 / time share | what happened |
|---|---|---|---|---|---|---|---|---|
| 10-04 04 | 54 | 61 | 34.3 | 0.77 | 41 / 34.5 / 0.79 | 11 / 0.63 | 9 / 0.97 | craftroom canary 05:13 |
| 10-04 10 | 61 | 65 | 34.7 | 0.81 | 42 / 34.9 / 0.85 | 14 / 0.70 | 9 / 0.85 | composter canary 11:37 |
| 10-04 16 | 63 | **71** | 34.9 | **0.82** | 48 / 35.2 / 0.87 | 16 / 0.79 | 7 / 0.65 | composter promoted 17:50; toolclean canary 17:55; **chest clear 18:07** |
| 10-04 18 | 50 | 61 | 34.3 | 0.75 | 41 / 34.6 / 0.82 | 13 / 0.64 | 7 / 0.61 | |
| 10-04 20 | 42 | 49 | 33.8 | 0.68 | 30 / 33.8 / 0.73 | 11 / 0.60 | 8 / 0.61 | |
| 10-05 00 | 47 | 51 | 33.5 | 0.64 | 36 / 34.0 / 0.72 | 8 / 0.44 | 7 / 0.61 | toolclean KEEP 00:05, promoted |
| 10-05 02 | 40 | 44 | 33.0 | 0.56 | 33 / 33.7 / 0.66 | 7 / 0.37 | 4 / 0.46 | chestfull-01 02:47–03:22 (reverted) |
| 10-05 06 | 39 | 47 | 32.9 | 0.58 | 33 / 33.4 / 0.67 | 10 / 0.48 | 4 / 0.28 | |
| 10-05 08 | 37 | 44 | 33.3 | 0.58 | 31 / 33.7 / 0.65 | 10 / 0.56 | 3 / 0.29 | |
| 10-05 10 | 38 | **43** | 33.2 | **0.56** | 29 / 33.4 / 0.61 | 10 / 0.52 | 4 / 0.38 | **junk well canary 10:05** (jw) |
| 10-05 12 | 38 | 46 | 33.2 | 0.57 | 30 / 33.3 / 0.62 | 12 / 0.58 | 4 / 0.34 | |
| 10-05 14 | 46 | 50 | 33.3 | 0.61 | 31 / 33.6 / 0.62 | 12 / 0.62 | 7 / 0.54 | junk well **reverted 15:13**; chestfull-02 15:24 (cf2) |
| 10-05 16 (to 17:20) | 44 | **49** | **33.2** | **0.61** | 29 / 33.1 / 0.57 | 12 / 0.65 | 8 / 0.71 | now |

(Some bins are left out of this table for space. All 19 bins are in `results.txt`.)

Notes:
- The 10-04 16 bin's last snapshots fall at 17:54–17:59Z, so "24 h ago" really means about 23 h 20 min ago. That
  snapshot comes just after the composter was promoted and just before the chest clear.

Reading it:
- **The large drop overnight is real, and it matches its causes in time:**
  - The composter was promoted fleet-wide at 17:50. Leaf litter and seeds fell from 6.1 slots per bot to 1.5 in the
    rest pools.
  - The chest clear came at 18:07.
  - Toolclean was promoted after 00:05. Spent tools fell from 2.6 to 1.3 slots per bot in the rest pools, and from
    3.0 to 0.5 in jw.
- **The "creep" since 10:00Z has three parts:**
  - In the 50 untouched bots it did not happen: 29 → 29 at 34+, mean 33.4 → 33.1, time share 0.61 → 0.57.
  - In cf2, 10 → 12 of 20 at 34+, time share 0.52 → 0.65. This started before the 15:24 deploy (0.58 at 12:00,
    0.62 at 14:00), so it is not the deploy.
  - **In jw it is real: mean 31.9 → 34.4, time share 0.38 → 0.71.**
- **Overall:**
  - The fleet mean went 33.24 → 33.20.
  - Five more bots sit at 34–36, but the fleet as a whole holds no more items than this morning. Codex: "more bots
    cross 34 without an increase in total estimated occupied slots".

**Why jw rose (difference-in-differences against rest):**
- The junk well worked on its own list. Eggs, flint, ink and scutes fell from 3.7 to 1.7 slots per bot in jw, while
  in rest they were unchanged (5.4 → 5.5).
- But everything else in jw grew by about 4.7 slots per bot:
  - cobble 0.8 → 2.8
  - ores 0.2 → 1.6
  - wood 1.8 → 2.9
  - spent tools 0.2 → 2.1
  - dirt +0.6
- In those same hours (12–17Z), jw's decisions were **27–34% on `gather_iron_ore`**, against 7–16% in rest. Mining
  is where cobble, ore and worn pickaxes come from.
- So jw had been emptied first, by the composter canary on board-b (10-04), then toolclean, then the well. The freed
  slots then filled with working material. **That is refill, not a harmful canary effect.** It cannot be one: no
  code path in the well adds items to a bag.
- The lesson: **freeing slots does not keep a bag below 34. It sets a new level that working material fills up
  again within about half a day**, unless something takes that material back out.

---

## 2. What fills the bags

### Composition: full bags (≥34) now vs. about 23 h ago (corrected estimator, slots per bot)

| category | 10-04 ~17:55Z (n=71) | now ~17:15Z (n=49) | change |
|---|---|---|---|
| eggs / flint / ink / scutes / clay / wool | 5.15 | 4.94 | −0.2 |
| equipment: bucket, table, furnace, torch, ladder, lead | 4.24 | 4.65 | +0.4 |
| chests carried (median 7 per holder) | 0.86 | 0.86 | 0 |
| wood (logs, planks, sticks) | 2.07 | 2.94 | **+0.9** |
| dirt and ballast (incl. pointed dripstone, sand, andesite…) | 2.07 | 2.92 | +0.85 |
| cobblestone / stone | 0.77 | 2.14 | **+1.4** |
| decorations (glass, buttons, slabs, rail, bricks) | 1.63 | 2.16 | +0.5 |
| food (apple 1.1, melon, mutton…) | 2.01 | 2.14 | +0.1 |
| saplings | 2.34 | 2.02 | −0.3 |
| leaf litter, seeds, flowers, mushrooms, kelp | **6.35** | **1.88** | **−4.5** |
| tools: best usable per family | 1.44 | 1.84 | +0.4 |
| tools: duplicate usable copies | 1.41 | 1.80 | +0.4 |
| tools: spent (≤ 10 uses) | **3.34** | **1.73** | **−1.6** |
| bamboo | 1.31 | 1.41 | +0.1 |
| ores / ingots / coal | 0.34 | 1.12 | +0.8 |
| **bone meal** | 0.06 | **0.90** | **+0.8** |

Across all 80 bots, the 24 h change is about the same:
- litter −4.25; spent tools −1.76
- cobble +1.06; bone meal +0.80; ores +0.62; wood +0.55
- stone pickaxes +0.51; dirt and ballast +0.40; equipment +0.31; decorations +0.21

### Flows: what goes in and out (items per bot per day, 10-04 17Z to 10-05 17Z, 1,919 bot-hours)

"Net" is the sum of consecutive inventory snapshots, so it matches the actual change in what bots hold. Codex
confirmed that the gross in and out from snapshots are inflated by back-and-forth: the pathfinder places scaffold
blocks and picks them up again. So the sources and sinks below come from the skills' own `inventory_delta`.

| item | net / bot-day | main sources | main sinks |
|---|---|---|---|
| cobblestone | **+61** (~1 slot/day) | mine 288, gather 190, goto 63 | **deposit 165**, gather/explore scaffold 164, craft 39 |
| oak_log | **+27** | gather 211 | **deposit 128**, scaffold 42, craft 9 |
| bone_meal | **+10.5** | compost 10.3 | **nothing** |
| apple | +3.1 | gather (leaf drops) 2.6 | **nothing** |
| pointed_dripstone | +0.7 | mine | **nothing** (never banked, never picked up on purpose, but auto-collected) |
| stone_pickaxe | +0.6 | craft 6.9 | deposit 4.0, wear 2.2 |
| eggs, flint, ink | about +0.3 each fleet-wide | mine, passive pickup | junk well only (now reverted) |
| leaf_litter | **−157** | mine/gather 11 | **compost 171** |
| oak_sapling | **−31** | gather 25 | compost 30, plant 1 |

**In much greater than out, and still growing:**
- cobblestone and logs, the working materials; they leave only through deposit;
- bone meal;
- apples;
- slowly, eggs, flint, ink and dripstone.

Glass is a stock left over from earlier, with no inflow (0.2 a day).

---

## 3. Why the bags are not used or deposited

### 3a. Deposit is the only way out for working materials, and nothing makes it happen

On `1918bb5`, a deposit happens **only when the model proposes it**. The prompt has a CARRYING line, and the
`deposit_surplus` rung comes late in the repeating chain. There is **no automatic town order for deposit**; the
composter has one (`composter.mjs townOrder`), and withdraw adds one.

**Bots at 34+ slots, last 24 h:**
- 1,140 of 1,839 bot-hours were spent at 34+ slots (62%).
- Of those 1,140 hours, 86 were at town (within 16 blocks of home horizontally and 12 vertically) and 392 within 48.
- Town stays that began at 34+, counting re-entries within 10 minutes as one stay: **829 stays by 77 bots**, median
  9 minutes.
  - The count depends on how stays are joined: 641 if re-entries within 20 minutes count as one stay, 1,053 within
    5 minutes, and 3,802 if every arrival counts.
- **715 of those 829 stays (86%)** carried at least one slot that the fleet's own deposit rules would bank (median
  4 slots).
  - Those rules are `bankableInventory` with `creditCap` 64, the 8-block scaffold reserve, and one tool kept per name.
- **231 stays included any deposit attempt, and 130 a success.**
- The median bag left town exactly as full as it arrived.
- So the bots **do come home**. For 47 of the 49 bots at 34+ now (the other 2 never reached town in the window), their last time within 16 blocks of home was a median
  38 minutes before their last snapshot (p25 9 minutes, p75 78). It is the deposit that does not happen.

**Deposit runs, last 24 h** (2,393 runs, 79 bots):

| outcome | runs | what it was |
|---|---|---|
| success | 526 | 353 runs with clean counts banked 19,362 items: cobble 9.4k, wood 9.0k, ores 0.7k, tools 0.3k. 33 more "successes" are really scaffold lost during a stagnation, credited as deposit. |
| no_effect | 1,057 | **660 "you are carrying apple"**, 133 dirt, 71 "cobblestone is the scaffold reserve", 40 cooked mutton, 34 chest |
| failed | 785 | 263 "No path" (median 41 blocks from home), 162 "goal changed", 151 "took too long" (median 98 blocks out), **172 "could not open the chest"** |
| aborted | 25 | stagnation, stuck, entombed |

Three of these failure types are worth a closer look:
- **Most "could not open the chest" failures are at deep or distant containers, not at the town bank.**
  - 106 were at chests more than 12 blocks above or below home.
  - 25 were more than 16 blocks away horizontally.
  - 41 were at a town chest.
  - chestfull-02, live on cf2, stops targeting deep containers.
- **Success depends on how full the bag is.**
  - Bags under 30 slots: 151 of 397 runs succeeded (38%).
  - Bags at 34+: **119 of 1,122 (11%)**. Full bags fail more on paths, and they spend more of their runs naming
    junk.
- **The model's deposit proposals** (decision stream, 159,500 decisions):
  - 9,582 proposals in total. 6,902 never ran. The reasons, counted since 00:00Z only:
    - 2,012 were refused as "no storage in reach";
    - 1,555 were the repeat-loop guard;
    - about 1,170 named an item the bot does not hold, such as "any_item_id".
  - 3,338 (35%) named **apple**.
  - When a bag is full *and* the bot is within 48 blocks of home, deposit is only 6% of decisions. Gather (37%) and
    explore (20%) dominate.

### 3b. Junk with no exit at all

| item | slots/bot (all 80) | why it stays |
|---|---|---|
| eggs (brown, white, blue) | 2.16 | Never banked. The bot does not walk to pick them up, but the server gives them anyway when it walks near. Only exit: the junk well (reverted 15:13). |
| flint, ink sac, glow ink sac, scute, clay | 2.29 | Same: the well list only. |
| pointed dripstone, rail | 0.81 | Same: the well list only. |
| **apple** | **1.09** (73 bots, median 45 apples) | Not bankable, and the composter's NEVER_COMPOST list excludes it as food. No bot has needed to eat. It also drives about 3,300 failed deposit proposals a day. |
| other food | ~1.0 | Same. |
| **bone meal** | **0.89** (71 bots, median 9) | **The composter's own product.** Nothing in `bots/src` uses it (it is not used for planting), and it is not bankable. About 1 slot per bot until a stack reaches 64. |
| glass, buttons, slabs, bricks, fences | ~1.8 | Old stock. No bankable rule, no well, no compost. |
| wildflowers, mushrooms, kelp, rose bush, peony, sugar cane | ~1.4 | Vanilla can compost most of these, but `isCompostJunk` takes only items that are also in NEVER_KEEP. |
| sand, gravel, andesite/diorite/granite | ~0.6 | Sand and gravel cannot be scaffold. The `gather_sand` rung (below) keeps refilling sand. |

### 3c. The goal ladder asks bots to carry things

All 80 bots have the `gatherer` role. Its chain is:
- **hold 16 dirt**
- hold 12 logs
- **hold 8 sand**
- hold 8 cobblestone

The repeating rungs after it ask the bot to hold up to **64 logs** (`stockpile_wood`) and **64 cobblestone**
(`stockpile_stone`).
- Each of these is a "count held ≥ N" check, and the chain starts again from the top every cycle
  (`milestones.mjs` `refresh`).
- So a bot that spends its dirt as scaffold is sent back to gather more. Today, **13–26% of all decisions were on
  `gather_dirt` and 8–14% on `gather_sand`.**
- The bot holds those 64 logs and 64 cobble on purpose. That is why the median holder carries 64 logs and 84
  cobblestone.
- A deposit of logs or cobble re-opens the stockpile rungs. Any deterministic deposit order must keep the stockpile
  target, or the two rules will fight each other.

### 3d. Tools: duplicates come from the model's own crafts

At the last snapshot:
- **39 of 80 bots hold 2 or more usable pickaxes**: 20 hold 2, 6 hold 3, 13 hold 4 or more.
- **50 bots hold 1 or more spent pickaxes.** Last-swing keeps up to 3 on purpose, and toolclean destroys only
  1-use axes, shovels and hoes.

Pickaxe crafts in 24 h:
- **471 of the 762 successful pickaxe crafts (62%) were made by a bot already holding a usable pickaxe**, so each
  one adds a slot.
- Pickaxe crafts that failed or were refused:
  - 1,775 by bots that held a usable pickaxe;
  - 1,860 by bots that did not.

This is the known "craft failures are mostly redundant" problem. It is the model proposing `stone_pickaxe` while
idle, and it is still unbuilt.

### 3e. The craftroom refusal loop

**`_craft_room`, 24 h:** 6,935 refusal rows, about 3,470 refused crafts, since each refusal writes two rows.
- 2,589 of the refusal rows were `stone_pickaxe` refused by a bot **holding a usable pickaxe**.
- The usual reason: "no spent tool that can be spared (the last digging pickaxe is kept)", at 36/36 slots.

**The refusal names a remedy, but the remedy is not taken.**
- 2,658 craft failures led with "deposit X — it walks home to the town chest".
- Only **186 (7%)** were followed by any deposit within 10 minutes, and **93 (3.5%)** by a successful one.
- This is CLAUDE.md's "advice printed is not advice taken". It does not fill bags. It burns decisions, and the bag
  stays full.

**Example: placebo-a-Comet, 10-05.**

| time (Z) | distance from home (blocks) | slots | what happened |
|---|---|---|---|
| 10:45 | 5 | 36 → 33 | composted 154 items; gained 9 bone meal |
| 10:47 | 13 | 34 → 32 | threw 17 junk items down the well |
| 15:18–15:37 | 13–20 | 32 → 36 | **on `gather_dirt`**: about 15 small dirt gathers, some ending entombed or stagnated |
| 15:39–15:42 | 16–20 | 36 | stone_pickaxe refused 3× at 36/36. The advice "deposit coal — it walks home to the town chest" was given while the bot was already 16 blocks from home, and was not taken |
| 15:43–15:54 | 16 | 36 | four `goto`s fail with "no route" |
| 16:36 | 5 | 36 → 33 | a deposit finally happens (83 items) |

### 3f. The other questions

- **Iron and raw ore are not piling up.**
  - The fleet holds 15 raw iron and 54 ingots.
  - Smelt runs in 24 h: 287 succeeded.
  - 125 failed on "no raw_iron".
  - Ores and ingots are 1.0 slot per bot. They grew 0.6 in 24 h, which is the iron milestone working.
- **Wood is "hoarded" only up to the stockpile target.**
  - Logs are 1.2 slots per bot, and wood in total 2.5.
  - The bank takes 128 logs per bot-day.
  - The net gain of about 27 logs per bot-day comes from bots too seldom at a chest, not from a refusal.
- **The composter is town-only, by design.** It cleared 6 → 2 slots per bot of litter in 24 h. The litter that
  remains, about 0.5 slot per bot, belongs to bots that do not reach town while at 34+.

---

## 4. What would reduce bag pressure most, ranked

The ranking is by measured or directly computed slots per bot. Every number is either a standing stock (the most a
change could recover) or a measured canary effect; each row says which. Codex's caution applies: these are
opportunities, not measured clearances, except where a canary measured them.

| # | lever | slots/bot | evidence | queued? |
|---|---|---|---|---|
| 1 | **Junk well, re-run** after the underground-safety fix | stock **5.26** (all 80 bots); **measured −2.0 slots/bot in ~5 h** on the 10 canary bots vs. rest flat (5.4 → 5.5) | junkwell-01 rows; list = 3 eggs, flint, clay, 2 inks, scute, dead bush, dripstone, rail | yes (re-run pending) |
| 2 | **Deterministic town deposit at 34+** (like the composter's town order) | **~4.2 per full town stay** (port of `depositPlan`, no wants); 5.1 per full bot now | 715 of 829 full stays carried freeable slots; 130 deposited | **no — not in the queue** |
| 3 | **Stop duplicate pickaxe crafts**, and bank spare *usable* pickaxes only | ~2.0 per full bot of pickaxe slots now; +0.5/bot/day new | 62% of successful pickaxe crafts duplicate | partly: withdraw stops banking spent tools; the redundant-craft fix is unbuilt |
| 4 | **Give food an exit** (apples are compostable in vanilla; or a well entry with a kept reserve) | ~1.1 (apples) to 2.1 (all food) | hunger 20 in every snapshot; 3,338 apple deposit proposals/day | no |
| 5 | **Widen the composter list** to the plants it refuses (wildflowers, mushrooms, kelp, flowers, sugar cane) | ~1.2–1.4 | same composter, more inputs | no |
| 6 | **Give bone meal a use or an exit** (bonemeal saplings, bank, or well) | 0.9, growing ~10 items/bot/day | composter output, no consumer | no |
| 7 | Decorations (glass, buttons, slabs, bricks) to the well list | ~1.8, one-time (no inflow) | old stock | no (owner list) |
| 8 | Bamboo → sticks fold | ~0.2–0.3 fleet-wide (1 slot each for ~9–19 eligible bots, earlier census) | bamboo 1.23 slots/bot but burned as fuel too | yes (after grid fix) |

**About lever 2.** Of the 5.1 slots a deposit would free for a full bot today:
- **2.0 are pickaxes**: 1.76 stone and 0.27 wooden. On `1918bb5` this would also bank *spent* pickaxes. The withdraw
  branch fixes that. It also overlaps lever 3.
- **1.6 are logs and cobblestone** that the stockpile rungs ask the bot to hold.
- **Only about 1.4 are plain surplus** (ores, ingots, coal, planks).

So a deposit order should be built on the withdraw branch's spent-tool rule, and it should keep the stockpile
target. Depending on how it is built, a realistic clearance is **about 2–4 slots per full town stay**. It is still
the only lever that touches the working material that refills every freed slot.

**Where the queued changes stand:**
- **Withdraw** (`wd-on-6c9a8fb`): adds a pickaxe or ingredients to the bag at town, with a room check.
  - It is slightly *bag-positive* (fuller bags).
  - It stops spent tools going to the bank, which is a chest fix, not a bag fix.
  - It adds a `withdraw_pick` town order, which is the right template for a deposit order.
- **Chest-full** (chestfull-02, live): chest-full refusals are now about 0 after the clear, so it barely touches
  bags.
  - It does stop the 106 a day "could not open" deposit attempts at deep containers, which turns some failed
    deposits into walks to the town chest.
  - It is mildly helpful.
- **Grid fix:** about 0 for bags. It stops items stranded in the crafting grid from dropping at logout.
- **Bamboo:** small (lever 8).
- **Cobble rule** (`stonecap`): refuses cobble deposits once a town holds 256.
  - It can only keep cobble in bags. It is neutral at best, thanks to its relief valve at 34+.
  - It should come **after** a deposit order exists, or it will slow the one outflow that works.
- **Junk well re-run:** lever 1, the largest measured effect.

**The pattern to expect.** Every cleanup so far freed slots that working material then refilled:
- composter −4.3 litter
- toolclean −1.8 spent tools
- the well −2.0 junk

The fleet's mean bag is flat at about 33 because the inflow of cobble, logs, dirt, ore and pickaxes is never
matched by a deposit that happens on its own. **Without lever 2, each further cleanup will look like a win for about
12 hours and then "creep" again.**

---

## 5. Method and limits

- **Occupancy:**
  - Last snapshot per bot per 2 h bin (`bot.inventory`, `bot.tools`). The tool split uses each copy's durability:
    usable means more than 10 uses left.
  - The time-weighted share caps gaps at 120 s.
  - The last bin is partial (16:00–17:20Z).
- **Town:** within 16 blocks horizontally and 12 vertically of `HOME_X/Y/Z` from the harness env files. Only the
  `HOME_` lines were read.
  - A visit ends once the bot is more than 24 blocks away horizontally, so a vertical exit does not end one.
  - HOME distance shows that a bot is at town. It does not show that a chest was reachable or had room.
- **Flows:**
  - Net comes from consecutive snapshots. Gaps over 15 minutes and deaths are tagged separately.
  - Sources and sinks come from the `inventory_delta` of skill rows.
  - The 6-hour flow blocks run 17:00–17:00, not 17:20.
- **"No-exit" means no exit in today's code.** Codex is right that this is a hand classification, not a measured
  invariant.
  - Equipment, such as a table or a torch, is used, not junk.
  - Saplings above 8 are planted.
  - Hunger at 20 shows only that no bot has needed to eat *in these worlds*, so a food reserve is still right for
    "any world".
- **Decision counts** use the first tool call of each `llm-*.jsonl` row, with no deduplication.
- **Scripts and raw outputs** are in the session scratchpad,
  `/private/tmp/claude-501/-Users-darrellmiller-Documents-code-minecraft-ai--claude-worktrees-heuristic-nightingale-49eee9/2a199c24-8dc2-4c02-9509-8499787c3dd1/scratchpad/bagc/`:
  - extractors: `bagcreep.py`, `bagcreep2.py` (also on the host in `~/bagcreep/`)
  - helpers: `cats.py`, `bankport.py`
  - summaries: `s1.py`–`s17_*.py`
  - data and outputs: `out.json`, `out2.json`, `results.txt`
  - the Codex prompt and output: `codex-prompt.txt`, `codex.out`
- **Run times:** each host job ran in under 8 minutes and under 600 MB of RAM.

## 6. Independent review (Codex) and reconciliation

Codex reproduced the headline counts from the same data:
- the estimator errors: −0.774 and −0.250;
- 71 → 49;
- 9,582, 3,338 and 527 for the deposit proposals;
- 829, 715, 231 and 130 for the town stays.

It also corrected six points, all applied above:
1. The "24 h ago" snapshot is really about 23 h 20 min ago, and it falls just after the composter was promoted.
2. **The fleet's mean occupancy is flat (33.24 → 33.20). The count at 34+ rose because bots crossed the threshold,
   not because bags grew overall.** This is now the headline.
3. Stone pickaxes grew by +0.51 slots per bot, not +0.7.
4. The town-stay count depends on how re-entries are joined (641 to 3,802).
5. 33 of the deposit "successes" are scaffold lost during a stagnation, not a chest transfer.
6. In the deposit lever, pickaxes plus logs and cobble make up 3.65 of 5.08 slots, not "about 2". The lever was cut
   to about 2–4 slots.

**Codex also confirmed:**
- there is no deterministic deposit order on `1918bb5`;
- the port of `depositPlan` matches the real one (no item named, no wants), including DEPOSIT_ALWAYS, the 64 cap,
  the scaffold total of 8 and one tool per name;
- the jw rise is refill alongside junk removal: −2.0 junk and +4.7 other.

**Where we still differ:** none on the facts. Codex would not rank the levers without a measured clearance for
lever 2. I rank it second on its standing opportunity, with that caveat stated, because it is the only lever aimed
at the material that refills the slots.
