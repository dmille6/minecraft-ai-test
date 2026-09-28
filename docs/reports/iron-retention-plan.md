# Iron retention — the plan (14 Sep 2026, 21:40 UTC; for two-engine review before building)

## What the logs say (13–14 Sep, 60 bots, rows that carry an inventory)
- Iron pickaxes crafted: 7 in two days. Lost: 16. The fleet holds 0 tonight (5 yesterday morning, 2 this morning).
- Where they were lost: none at a death row, none at a deposit row (the deposit rebuild fixed that channel on the 13th).
  All 16 vanished DURING work: gather (6: "collected 6/16 dirt", coal), mine (3), explore/path rows (7). That is the
  signature of a tool breaking: an iron pickaxe has 250 uses and the bots dig dirt, stone, coal and cobble with it
  until it is gone. Program baseline: 41 made / 41 lost per day fleet-wide when deposits were still banking them;
  now the only loss left is wear.
- Ingots: 6 carried tonight; 22 this morning. Smelts today were copper and cooked stone, not iron; iron ore gathers
  fail "every candidate buried".

## The plan, in order
1. **Tool tiering (retention, biggest lever).** One pure function, `toolFor(block, items)`, returns the CHEAPEST
   tool that can harvest the block at an acceptable speed: hand or shovel for dirt/sand/gravel; wooden or stone
   pickaxe for stone, cobble, coal, andesite, deepslate; iron only for what needs it (iron, gold, redstone, lapis,
   diamond, emerald, and their deepslate forms). Every `equip(...pickaxe)` site (gather, mine, dig-approach, the
   escape digs, the pillar and stair rungs, the pocket rung) calls it. Tests: the table, and a mutant that equips
   the best tool. Corpus: the ore fixtures already score `picks_lost`; it must read 0 with the change and the
   candidate must still collect the ore.
2. **Durability floor.** A tool with 10 or fewer uses left is not used for anything but its own class of block, and
   the craft ladder asks for a replacement before it breaks (`item.durabilityUsed` and `maxDurability` are on the
   item). Tests on the predicate; a corpus line with a nearly-spent pickaxe given.
3. **The iron funnel.** Ore in, ingots out, pickaxes crafted: measure raw iron gathered per bot-hour and iron
   pickaxes crafted per day as two nightly lines; the buried-ore approach (approach-05, archived) is the supply
   lever and comes back once the movement owner's leg discipline exists. Not this week.
4. **Measure retention itself.** Iron-pickaxe bot-hours share is already in the five-number read (1.4% tonight, target
   8% at two weeks). Add pickaxes made vs broken per day to the nightly digest.

## What it costs and what it should show
Steps 1 and 2 are a day of work with two review passes and one two-pool canary. If wear is the channel, the
iron-pickaxe count stops falling within a day of promotion and the bot-hours share climbs toward the 8% number
without any new ore, because the seven pickaxes a day the fleet already makes stop dying the same day.

## Question for the reviewer
Is the diagnosis right (wear, not death or deposit), and is tiering plus a durability floor the right first cut?
Name at most three defects with a one-line remedy each.

## v2 — ChatGPT's first pass folded in (21:55 UTC)
1. **Wear is a hypothesis until durability is logged.** Inventory snapshots show a pickaxe vanishing during work, not why. The snapshot now carries `tools: { name: { used, max } }` for every tool (built, tested, on the recovery-ladder branch; it ships with the next promotion). Tomorrow's read reconciles each disappearance against the last recorded wear: a pickaxe seen at 248/250 and then gone is broken; anything else is investigated before the plan calls it wear.
2. **The tier table comes from the server's block data, not a hand-written list.** Iron ore is harvestable with a stone pickaxe; gold, redstone, emerald and diamond need iron. `toolFor` derives eligibility from the block's harvest-tool set in the registry (mineflayer exposes it) and picks the cheapest eligible tool; the hand-written table in v1 is withdrawn.
3. **The arithmetic was wrong.** Seven pickaxes were crafted in TWO days, not per day, and the fleet holds zero tonight. The forecast is corrected: tiering stops the wear channel; it does not create pickaxes. Recovery of the bot-hours share needs supply (the iron funnel, step 3), and the plan promises no timeline for that until raw iron per bot-hour is measured.

## v3 — ChatGPT's second pass folded in (15 Sep, 05:50 UTC); review closed at two passes, built as one patch
1. **Eligibility, cost and speed are all specified.** `toolFor(block, items)` (bots/src/toolfor.mjs, pure): eligible = the
   tools whose type id is a key of `block.harvestTools`; an absent table means hand-harvestable. Cost order = tier
   (wooden, golden, stone, iron, diamond, netherite), the hand cheapest of all. Speed cap = 2x the fastest eligible
   dig time (`block.digTime`): the cheapest tool within the cap wins; a cheaper tool outside it yields (wooden is 3x
   slower than iron on deepslate, stone is 1.5x and wins). "Use the hand" and "no eligible tool" are distinct results.
2. **The floor reserves, and the hard stop refuses.** `remaining = maxDurability - durabilityUsed`. At or below 10 uses
   a tool is RESERVED: used only when no open tool can harvest the block (the block needs its tier), and a slow open
   tool is preferred over spending it. At or below 1 use a tool is never swung: zero breaks on the next dig, one can.
   Tested at 0 / 1 / 10 / 11 and with no replacement carried. A replacement is not "requested": the existing craft
   ladder already crafts a pickaxe when none is usable, and the exit contract's reserve rule already discounts one
   swing per tool.
3. **Loss is logged as an event, per copy, not inferred from a name-keyed snapshot.** The snapshot's `tools` is now
   `{ name: [{ slot, used, max }, ...] }` (one entry per copy); and a debounced inventory diff logs `tool_broke`
   (the least-worn copy of that name had two or fewer uses left) or `tool_gone` (it did not: deposit, drop, death;
   the read reconciles against those rows). A hotbar swap is not a loss (name-and-count diff, 300 ms settle).
4. **The pathfinder's own travel digs were the third picker.** mineflayer-pathfinder assigns `bestHarvestTool` as a plain
   property and calls it before every dig it performs; it chose the fastest tool. Overridden with toolFor after the
   plugin loads (structural test with a mutant).
5. **The canary's own line is wear, not retention.** Iron-pickaxe uses consumed per bot-hour (from per-copy wear
   deltas) and `tool_broke` rows per bot-hour, canary vs control DiD; guard: gather and mine success one-sided not
   worse than -30% (the cheaper tool is slower). Retention (iron-pickaxe bot-hours share) is reported, not judged:
   the fleet holds zero iron pickaxes, so the share cannot rise until supply does.
