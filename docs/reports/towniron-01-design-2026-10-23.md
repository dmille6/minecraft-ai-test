# towniron-01 — the town iron reserve: the iron task stays open for the town, and the kit's shovel is stone while it is short (design, 2026-10-23)

OWNER 2026-10-23, answering the ironsmelt agent's report: **A "option 1"** (iron shovels only while the TOWN's iron is above its
reserve, otherwise stone shovels) and **B "build it now"** (the iron task stays open while the town's iron is below a reserve).
The operator made them ONE change: one setting, two consumers. ironshovel-01 is dropped as a separate change. Base: fleet
`6e1afb52`; variants on ironsmelt-01's canary shas `f4b3252f` (on 6e1afb52) and `fb8de72f` (on chatgate-01's 3cc5f14d).
Branch `towniron-on-6e1afb5`. The independent Claude review runs after the weekly limit resets (10-26 06:00 CDT), before
queueing (operator).

## 1. Rows first (measured 10-23, ES 24 h to ~16:40Z, 80 bots, 1,529,541 skill docs; the town index; the 00:15Z RCON census)

**The toolkit's iron.** 667 kit runs (`_toolkit phase=kit`): 372 crafted, 184 `no_iron`, 82 `more`, 13 `narrow`, 14 aborted,
1 craft_failed. Tools made: **iron_shovel 277**, iron_pickaxe 141, iron_axe 5 -- 710 ingots drawn. Raw iron reaching bags
(`_pickups` raw_iron): 543 in the same 24 h.

**Shovels wear out as fast as they are made** (this refutes the "over-make" premise; the owner then chose A, option 1):
`_tool_broke` iron_shovel **289** in 24 h (positive control: stone_pickaxe 186, iron_pickaxe 120 in the same rows). Of the 277
shovel-making runs, **209 had no shovel at all in the bag** (`before=`), 66 a spent one (<= 10 uses), 2 one with > 40 uses.
So iron shovels are not made early: each one costs an ingot because it is used up. Option 1 changes the TIER, not the rule.

**Town iron and the kit's no_iron** (per shared pool; index-known = each container's latest observation < 6 h old):

| pool | index-known ingots | raw | kit runs | ingots drawn | no_iron |
|---|---|---|---|---|---|
| placebo-a | 51 | 78 | 63 | 7 | **55** |
| placebo-c | 38 | 45 | 78 | 9 | **49** |
| board-a | 86 | 81 | 70 | 20 | **26** |
| isolated-c | 30 | 51 | 22 | 0 | **21** |
| hive-b | 36 | 26 | 37 | 39 | 13 |
| placebo-d | 38 | 52 | 38 | 45 | 11 |
| board-b, board-d, hive-a, hive-c, placebo-b, isolated-b | 67-184 | 42-94 | 26-55 | 49-74 | 0 |

All 184 no_iron runs are in towns at <= 86 index-known ingots; no town at >= 94 had any (hive-d, 37 ingots, had 0: the
threshold is not sharp). A kit draw takes 1-7 ingots and keeps 4 in every container it draws from (TOWN_IRON_KEEP).

## 2. The change

### 2.1 The reading (bots/src/towniron.mjs, one place)

`townIronStock(entries)`: over the bot's town index fold, each container's latest observation younger than 6 h counts its
iron_ingot + raw_iron (a later mutation mark does not drop it: the observation is still the best estimate). Unseen containers
count nothing, so the reading can only under-count -- both consumers then err toward keeping iron in town. Fewer than 3 fresh
observations, an unreadable index, or TOWNINDEX=off -> **unknown**: both consumers do exactly the base. `townIronLowNow()` is
true only when the switch is on and the town is KNOWN below `TOWN_IRON_RESERVE` (**default 64 units**, env setting; one
stack; below every no_iron-free town's reading, above the worst no_iron towns' ingots). The reader is memoised 30 s.
`TOWNIRON=off` is the one-setting rollback of both consumers.

### 2.2 Consumer 1: the iron task stays open for the town (milestones.mjs `gather_iron_ore_town`)

- **Ladder order.** A NEW rung, placed AFTER the bot's own iron rungs (`gather_iron_ore_3`, `smelt_iron_ingot_3`,
  `craft_bucket_1`, `craft_iron_pickaxe_1`), so it never holds a bot back from its own bucket or pickaxe. The base iron rung is
  unchanged (still done at 3 carried).
- **Done** when the bag carries `TOWN_IRON_SELF (3) + TOWN_IRON_CARRY (16)` iron units -- the cap on one round.
- **Means** (no means -> the ladder steps over it, never a fulfilment): the town KNOWN short (unknown or at/above the reserve
  -> none), iron ore in reach within 32 blocks and a pickaxe that can pay the trip (the base iron rung's own means).
- **The deposit chain.** The rung wants `iron_ore`, so the town deposit's `wanted` keep never covers raw_iron; its iron keep
  (`ironKeeps`) holds 3 units per iron craft not yet made (3 for a bot that has its bucket and pickaxe) and banks the rest.
  After the round the ladder moves on to `stockpile_stone`, `patrol`, `deposit_surplus`, `return`; at town the deposit banks
  the carried surplus (16 raw iron) and ironsmelt-01 (when kept) smelts it. Tested as a chain.
- **Release.** No ore in reach / no trip pickaxe / town not short: no means. Ore seen but not reachable: the ladder's own
  no-progress skip (45 min with no serving success, then the back-off) and the 25-attempt give-up, as for every gather rung;
  the residence cap. The carry cap ends every round. Tested as a chain through the real MilestoneController.

### 2.3 Consumer 2: the shovel tier (toolkit.mjs `kitNeeds`)

While the town is KNOWN short: a bag holding ANY usable shovel needs none; a bag with none and a cobblestone-family block
(cobblestone, cobbled_deepslate, blackstone) needs a `stone_shovel` (no ingot, 2 sticks: the craft makes them from wood as
for the iron kit); else nothing. Not short, or unknown: the base (an iron shovel when no usable iron one). The order passes
its reading in the args (`low: 1`), so a run keeps the order's tier. The pickaxe and the axe are unchanged.
`withdrawDefersToKit` (the iron pickaxe) is unaffected.

### 2.4 Rows

`_towniron_mode` once per spawn (the licence: a kind the base cannot write). `_town_iron` when a bot's view of its town flips
(state=low|ok|unknown units= ingots= raw= ctrs= reserve=): a change row the base cannot write. The rung shows in the decision
stream (`gather_iron_ore_town`) and `_work_order`; the stone shovel in `_toolkit` (`crafted=stone_shovel`).

## 3. Expected effect and the read

Towns below 64 today (index-known ingots + raw): of the 13 shared pools, by the table above hive-b (62) and, on ingots alone,
several more are near it; with ironsmelt-01 smelting raw iron the mix shifts between raw and ingots but the unit total is
what the reserve reads. The read (`townironread.py`): primary = raw iron banked into town by the canary (index xfers, verified
where the deposit re-opened) and the index-known town iron trend, canary vs control (DiD); iron shovels made per kit run;
correctness gates: an iron shovel made while the bot's own `_town_iron` said low (the tier broken), a town-rung decision while
the bot's `_town_iron` said ok/unknown, a stone shovel made with a usable shovel in the bag; no-harm: deaths (the gate's),
kit no_iron, gather ok per bot-h, the rung's no-progress skips.

## 4. Review round 1 (Codex, design + first-cut code) and what changed (r2)

Codex r1 **CHANGE** (1 P1, 5 P2). Changes:
- **P1, the delivery did not exist.** The town deposit keeps a whole name or none (19 raw iron in one stack: all kept, for a
  bag with no ingots) and fires on slot pressure; `deposit_surplus` skips with no chest near. Now a **town order
  `deliver_iron`** (towniron.mjs deliverOrder / deliverPlan; skills.mjs deliverIron; housekeeping, chatOnly, a keep-out C12 town
  job, refunded when the runner declines): at town, a bag carrying a round (TOWN_IRON_CARRY = 16) above its own keep (3 per iron
  craft not made yet, ingots first: the town deposit's ironUnitsNeeded, restated and tested equal) banks the rest with the
  deposit verb, the own count held back per name by `swapWithdrawHold` (ironsmelt-01's bank, Paper-proven). Placed just before
  the toolkit order (the delivery funds the kit). Tested in the fake world: one stack of 19 raw iron -> 16 in the town chests.
- **P2, over-count.** The reading counts only KNOWN containers (no mutation since the observation, < 6 h): a lower bound while
  only bots move town iron. A coverage denominator (`seen`) is in the row.
- **P2, the stone fallback blocked by an unfundable iron axe.** toolkitOrder tries the stone shovel ALONE (`args.only`) after
  every iron prefix failed.
- **P2, room for stone-only runs.** Such a run needs the bag's EXISTING empty slots: one for the shovel, one more if it takes
  sticks.
- **P2, the reserve evidence.** Corrected: the no_iron table's rows sum to 175 of the 184 (the other 9 are in the
  self-isolated per-bot towns). By UNITS (ingots + raw) the no_iron towns read 62-167 and the clean towns 73-263: the units do
  not separate them (placebo-a holds 129 units, 78 of them raw iron the kit cannot use until it is smelted -- ironsmelt-01).
  The default stays the owner's 64; on today's readings it marks ONE shared town (hive-b, 62). It is a setting; the read
  reports per town reading so it can be tuned. Draw exposure decides the tier (section 5).
- **P2, the read's gates** use the issuing order's `low` (the toolkit runner row's args), the delivery rows and exposure
  (section 3, the read).
