# bagbudget-01 — one bag allowance every keep layer reads (design, evidence, reviews) — 2026-10-20 (r4)

OWNER 2026-10-20 ~03:20Z: "fix allowance ... yes i agree with your assessment and make those changes". Base:
`origin/cobblekeep-on-adbec4f` 9e7d9980 (the expected baseline once cobblekeep-01 KEEPs); branch `bagbudget-on-9e7d998`.
r2 took in the r1 reviews of both engines, r3 the r2 reviews (section 10).

## 1. Measurement (files on 10.0.0.31, streamed, read-only; NOT ES -- ES was read-only 23:16Z 10-19 to 02:42Z 10-20)

| window | rows walked | bots | first / last row |
|---|---|---|---|
| W3  10-20 00:00Z -> 02:55Z | 172,124 | 80 | 00:00:00Z / 02:55:00Z |
| W24 10-19 03:00Z -> 10-20 03:00Z | 1,447,514 | 80 | 03:00:00Z / 02:56:16Z |

Fleet: adbec4f4 on 70 bots, brain-01 (78fa19d9, a brain change; same bag code) on board-c and hive-d. Slots are estimated
from each bot's newest `bot.inventory` (name -> count) as ceil(count / stack size) (~/stack.json): a LOWER bound. Checked
against the bot's own `items().length` in the 784 W24 `_town_deposit` rows (`slots a->b`): real - estimate = 0 in 583,
+1 in 165, +2 in 31, +3 in 5, never negative.

**Bags (W3, newest snapshot per bot; denominator 80 bots):** 38 at >= 34 slots, 24 at 36; median 33. The 38 full bags
hold 1,349 slots:

| class | slots | share | the biggest names (slots / bots / items) |
|---|---|---|---|
| stone | 370 | 27.4% | cobblestone 314 / 35 / 19,005 (median 578 per full bag, p25 255, p75 808); cobbled_deepslate 32 / 19 |
| kit | 206 | 15.3% | bucket 37, furnace 36, ladder 35, torch 34 (363 items), chest 34 (432 items), crafting_table 30 |
| tools | 194 | 14.4% | stone_pickaxe 95 / 37, iron_pickaxe 23, iron_axe 21, wooden_pickaxe 19, stone_axe 12 |
| misc | 139 | 10.3% | dirt 25, eggs 16, flint 7, granite/andesite/diorite 22, amethyst_block 6, leaf_litter 7, glass 4 ... |
| wood | 131 | 9.7% | oak_log 67 / 37 / 3,402, stick 24, oak_planks 21 |
| saplings / seeds / bone meal | 116 | 8.6% | bone_meal 40 / 37 / 1,199; oak_sapling 38; birch_sapling 33 |
| bamboo | 99 | 7.3% | 25 bots, 5,527 items |
| food | 65 | 4.8% | apple 38, salmon 12, cooked meats 11 |
| ore / ingots | 29 | 2.1% | iron_ingot 15, coal 9 |

THE KIT IS ONE SLOT PER KIND, NOT DUPLICATES. Every kit item stacks (bucket 16, the rest 64), so "three crafting tables"
is one slot, and banking two of them frees nothing. A whole kind leaves or nothing does; that shapes the table.

**Pickaxes (newest snapshot with `bot.tools`, 40 full bags, 141 copies):** spent (<= 1 use) 51, worn (2-10) 41, mid
(11-39) 16, good (40+) 33. Usable (> 10) per full bag: 0 in 5, 1 in 23, 2 in 10, 3 in 2. The "3-4 stone pickaxes" are
SPENT and WORN copies: no full bag holds a usable pickaxe beyond the best + 2.

**Inflow of the chest rows' names (W24, 80 bots, the positive step changes between consecutive snapshots):** torch 63
(0.79 per bot-day), bone_meal 45 (0.56), apple 46, ladder 0, stone_bricks 5, smooth_stone 2. Positive control: the held
totals move between the first and last snapshot (bone_meal 2,216 -> 2,239, torch 680 -> 676, stone_bricks 10 -> 13).

**Town deposits (the skill row `town_deposit`; its event `_town_deposit` is counted apart):**

| | W3 | W24 |
|---|---|---|
| runs | 100 | 784 |
| no_effect | 85 | 646 |
| ... of which the order's count step (args `recount: true`) | **85 of 85** | **646 of 646** |
| ... whose `_town_deposit` row says `stock 0/0 counted 0` | 85 | (all no_effect rows read `stock 0`) |
| ... detail "nothing to bank: everything carried is kept (stockpile, scaffold, tools, iron, the goal)" | 85 | 646 |
| success | 15 (14 x one stack, mostly a stone pickaxe) | 137 |

POSITIVE CONTROL: the same walk finds the 137 successes and 5,737 `_stock_refused` rows (W24 name-rows: cobble_cap 3,531,
cobble_unknown 4,451, oak_log stock_unknown 2,133, stick 932 ...). The separate recount skill (`count_town`, recount.mjs)
ran 832 times in W24, most `counted=0 ... fails=lid_blocked` -- the same lids, seen by a second instrument.

## 2. Root causes

### 2.1 The no_effect deposits (85 of 85 in W3, 646 of 646 in W24)

A chain of three individually-correct rules:

1. **The plan banks almost nothing from a full bag.** `bankable.mjs bankableInventory` banks only standing targets,
   `DEPOSIT_ALWAYS` ores and spare tools. Everything else is `not_wanted` (never banked: torch, ladder, bone meal, food,
   strays) or `ballast` or KEEP_ONE, and the junk well and composter take only their own lists. What it CAN bank is
   stock-targeted (cobble, logs, sticks, tools) and the town count refuses it: at the cap, or `unknown` (a container never
   counted).
2. **So the order takes its count step** (`townDepositOrder`: plan empty, `stockCountKeys` non-empty -> `town_deposit
   {recount: true}`), and the count comes back 0: on the `_town_deposit` rows `counted 0`. A 0 is a failed count (the
   lids) OR no key left to count at skill time (skills.mjs townDeposit: `keys.length ? ... : counted = 0`); the rows do
   not separate the two, and the `count_town` rows say lid_blocked for most.
3. **The skill then reports the wrong reason.** `counted ? "counted N..." : "nothing to bank: everything carried is
   kept"` -- 0 is falsy, so every count of 0 read as "everything is kept".

cobblekeep-01 (the base) clears the measured lids (99% of `_lid_clear` refusals were dirt/grass/leaves). It does not touch
(1): even with every container counted, a full bag at town keeps its torches, ladders, bone meal and building stone for good.

### 2.2 The full bots that never attempted

W3 named 16 full bags with no `town_deposit` row (the brief said 15). That is mostly the WINDOW: in W24, 10 of the 16
attempted (positive control: the same walk sees their runs). The six that never did in 24 h:

| bot | rows (24 h), first .. last row, largest gap between rows | distinct block positions in 24 h | where | dy from home |
|---|---|---|---|---|
| board-d-Alpha | 39,497, 10-19 03:00 .. 10-20 03:13, 28 s | **1** (555,61,116) | 203 h | -12 |
| board-d-Comet | 54,628, 10-19 03:00 .. 10-20 03:13, 16 s | **1** (329,61,213) | 71 h | -12 |
| isolated-c-Alpha | 14,762, 10-19 03:00 .. 10-20 03:13, 34 s | **1** (356,47,176) | 29 h | -26 |
| isolated-d-Bravo | 12,962, 10-19 03:00 .. 10-20 03:13, 42 s | **1** (340,60,200) | 56 h | -13 |
| placebo-c-Bravo | 20,741, 10-19 03:00 .. 10-20 03:13, 116 s | **2** (559,36-37,219) | 217 h | -36 |
| placebo-d-Delta | 17,128, 10-19 03:00 .. 10-20 03:13, 43 s | **1** (198,34,187) | 117 h | -41 |

POSITIVE CONTROL: the same script on hive-c-Bravo finds 3,417 distinct blocks in the same 24 h. These six were sealed in
one block for a whole day (`home` "pathfinder returned an empty path ... no route out", gather/explore/mine failing). The
town deposit is an at-town order by design (owner 10-05: no trips), so this is immobility, which the owner's 09-30 rule
keeps out of every change but homefix-01 (expansion X1). **Out of scope; named for homefix-01.**

The W3-only bots were away (explore 97-210 blocks out), underground near town (dy -13..-28: outside TOWN_V 12; STORAGE_REACH
16 is 3-D), or failing the deposit verb's walk "No path to the goal!" (isolated-a-Bravo). Two were in the town zone while
full with no order (hive-c-Bravo, isolated-d-Delta); both ran `count_town` there, so a container was in reach, and their
plans were empty (the case 2.1 fixes). `bankClosed` and TOWN_V for individual decisions are not ruled out row by row.

## 3. The allowance table

ONE TABLE, `bots/src/bagallowance.mjs` (a leaf: imports only `ladder.mjs`, which imports nothing). Every keep layer that
had its own constant imports it, and a test holds each equal:

| layer | constant | value |
|---|---|---|
| bankable.mjs | COBBLE_RESERVE, RESERVE_RECIPE, KEEP_ONE | 64, 2, the original seven names (KEEP_ONE_NAMES) |
| towndeposit.mjs townKeeps (the goal keeps) | STOCKPILE_KEEP, WANTED_KEEP, HELD_TARGETS, PLANKS_MEANS | 64, 64, dirt 16 / sand 8, 4 |
| stocktarget.mjs | STOCK_RESERVE | 64 |
| well.mjs | STONE_GUARD, COBBLE_WELL_RESERVE | 64 |
| hygiene.mjs | SPENT_PICKAXES_KEPT (last-swing) | 3 (and row P) |
| composter.mjs | SAPLING_RESERVE, APPLE_RESERVE | 16, 4 |
| deposit's planner (depositPlan) | through bankableInventory | -- |

Those values are UNCHANGED: the consolidation changes no behaviour (`BAG_ALLOWANCE=off` runs today's plan exactly; a
property test compares off with on-minus-the-allowance's-steps over random bags, and the whole suite stays green).

**THE ROWS.** Applied by the town deposit to a bag that was >= 34 slots when the visit began, AT TOWN only. Surplus leaves
as WHOLE STACKS, smallest first, only while what remains is >= the kept amount. The goal always wins: the kept amount is
`max(row, every townKeeps floor)` (the active rung's wants and ingredients 64, stockpile, iron ladder, gather rung, scaffold).

| # | row | kept | surplus goes to | why |
|---|---|---|---|---|
| C | cobble (cobblestone + cobbled_deepslate) | 64 together | chest under the cap 1000; the well at the cap (cobblekeep-01); counted first when unknown | the exit contract's iron-depth descent needs 59. UNCHANGED |
| S | other stone (stone 64; andesite/diorite/granite above STONE_GUARD to the well; tuff/calcite/deepslate target 0) | as today | chest / well | UNCHANGED |
| W | wood: logs + planks/4 | 64 units (planks 4, sticks 2 for the pickaxe rung) | chest under TOWN_WOOD_TARGET 4000; counted first | UNCHANGED |
| D | dirt 16, sand 8 | as today | the well (target 0) | UNCHANGED |
| I | iron ladder (ingots, raw iron, ore, coal) | cobblekeep-01 ironKeeps | chest | UNCHANGED |
| P | pickaxes | today's deposit rule (the best usable copy of each name stays; worn and spent copies never move to a chest); **last-swing's spent (1-use) copies: 0 while the bag holds >= 3 of a stone pickaxe's stone** (cobblestone, cobbled_deepslate, blackstone; was 3) | spent: wear_out (destroyed by use, never banked or dropped); worn 2-10: spent first in mining (toolhygiene part 2); usable spare: chest under the tool target | last-swing exists to mine the stone for the next stone pickaxe; a bag holding it has nothing to gain. 1-use copies never count toward the escape reserve (toolfor depositSurvivors counts copies above HARD_STOP) nor the exit contract (pickaxeUses counts max(0, uses-1)). wear_out fires at >= 34 WHEREVER the bot is, so this row is not town-only |
| A | axes, shovels, hoes, swords | UNCHANGED (swords: the well in a peaceful world) | -- | consumable tools are used cheapest tier first and break in use |
| K | stations: crafting_table, furnace, blast_furnace, smoker, chest, barrel, **composter**, bucket, water/lava/milk bucket | 1 each (a second WHOLE stack only would leave) | chest | kitshrink-01: the tech ladder is satisfied by HOLDING them, the carried chest is the full-town recovery's, a carried composter is composterBuildPlan's zero-craft route (Codex r1 P1-1). bankable KEEP_ONE itself stays the original seven |
| T | **torch** | 0 | chest | no consumer on this base (kitshrink-01: 0 crafts, 1 placed in 24 h; peaceful worlds). 34 slots / 38 full bags |
| L | **ladder** | 0 below 26; at 26+ every ladder | chest | the stranded-escape rung needs ladderPlan(25-block climb) = 26 (asked of ladder.mjs; reflex.mjs ladderReady `PILLAR_MAX_BLOCKS + 1`, a structural test holds it). 0 bots hold 26. 35 slots |
| B | **bone_meal** | 0 | chest | no consumer in bots/src (only the composter MAKES it); the town's, for tree farms. 40 slots |
| F | **eaten food** (reflex.mjs FOOD_PRIORITY) | the held food highest in FOOD_PRIORITY holding >= 4 (else the highest held), whole | chest (another eaten food's stacks) | the eating reflex takes only FOOD_PRIORITY, best first (Claude r1 P2-7). Apples, melon and berries under the peaceful switch are the composter's (row J), so in today's peaceful worlds this row moves ~0 |
| M | **building stone**: stone_bricks, smooth_stone (well.mjs BUILDING_STONES, OWNER D8 10-15) | 0 above the scaffold reserve (bankable scaffoldKeep keeps 8 of the cheapest pathfinder blocks, and these two rank cheapest) | chest | the town's hall walls and blast furnaces; a NAMED list (Claude r1 P1-2: allowlist polarity). In practice only a second stack moves |
| R | kept whole: beds, slabs (the composter), trapdoors (the well), doors, armour, boats, shears, flint_and_steel, bow, crossbow, shield, fishing_rod, compass/clock/map, name tag, saddle, golden apples, ... | all | -- | each has a consumer or is a player's kit |
| J | junk: NEVER_BANKABLE ballast, WELL_JUNK, NEVER_KEEP, isCompostJunk, and under the peaceful switch PEACEFUL_COMPOST and apples; **every sapling** (the composter's reserve rule decides them); bamboo | -- | the well / the composter, exactly as today; **NEVER a chest** (owner 10-04; Codex r1 P1-2/P1-3, Claude r1 P1-1) | bamboo is bamboo-03's |
| U | **unlisted** (everything no row names: amethyst_block, magma_block, string, sugar_cane, raw salmon ...) | all | -- (stays) | allowlist polarity: never a chest by default. The read REPORTS the unlisted names full bags hold, for the owner's junk-list call |

A pillar-capable name never leaves below the bag's STOCK_SCAFFOLD_MIN (64) pillar blocks (the well's own guard).

**DELETION FIRST, BOUNDED TWICE (Claude r1 P2-2; Codex r2 P2-1/P2-2, Claude r2 P2-1).** The well and the composter run
only at >= 34 slots, and the town deposit goes before them in the decision (cognitive.mjs). Banking the chest rows first
would drop the bag under 34 and stop the deletion of genuine junk, and fill chests with what deletion would have freed. So
while the well or the composter can still free a slot HERE (`deletionPending`: a usable well not backing off, the bot not
inside it and within the walk's vertical reach of its stand -- the dispose order's own gates -- whose plan has a stack; or
a town composter not backing off whose fill can start), the chest rows wait:
- for TD_DELETION_GRACE_MS (60 s, two order scans) only, unless a `dispose_well` or `compost` order was actually ISSUED in
  the last TD_DELETION_RECENT_MS (3 min, their own cooldowns) -- an exit that exists but whose order never issues
  (starved behind a ready work order, held by the depth rule) does not hold the bag;
- and never for more than TD_DELETION_WAIT_MS (5 min) of time FULL AT TOWN, summed over visits: the clock runs on EVERY
  decision made full at town, before any scan, cooldown or latch gate (Codex r3 P2-1); leaving town stops it and keeps the
  total; it resets only when a scan finds nothing left to delete, or the bag drops under 34. (When an issue lands on the
  first scan that sees deletion pending, the next scan waits for the 5-min issue cooldown, so the 60 s grace can become
  up to 5 min -- still the cap: Claude r3 P3-3.)
- a town-deposit visit made while the chest rows are withheld (a base-plan or count-only visit) does NOT latch the stay,
  so the 15-min stay latch cannot hold the bound's expiry (the 5-min issue cooldown still binds).
Unlike `valveProof` this asks whether the exit EXISTS: a town with no well does not wait for one.

**THE ORDER WITHIN A VISIT (Claude r1 P2-3).** The base plan's stacks go first (fitToContainer fills free container slots in
step order), then the chest rows: a short chest takes the coal, iron and cobble before a torch.

**THE VISIT LATCH (Codex r1 P2-5, Claude r1 P2-4).** "Full" is decided once, at the start of the skill, and passed to every
plan of the visit (bankInto's per-window plan, the per-container re-plan): a first container that takes 34 -> 33 does not
switch the allowance off for the second.

**THE COUNT STEP STAYS (Claude r1 P2-6).** A plan of only chest-row stacks makes `freed >= 1`, which used to mean "nothing
to count first". The order then still sets `recount: true` when the count step would have fired, so uncounted cobble or
wood is counted in the same run (args `count: 'allowance_only'`, against `count: 'empty'` for the base count step, so
reads can tell them apart; the allowance-only count gets a third of the 45 s budget so count + deposit stays near the
skill's 60 s contract).

**THE GUARANTEE, PLANNING vs EXECUTION (Codex r1 P1-4).** At a full bag, the PLAN lists every chest-row surplus stack unless
deletion is pending (then `rows=0`, and the row says `chest_after_deletion`). A no_effect with `stop nothing to bank above
the keeps` (planned 0) therefore never leaves chest-row surplus with `rows=1`; the execution waits (a counting open in
flight, sneaking, no container in reach) are other stop reasons and are not this guarantee. The no_effect detail names
what is over the keeps and where it goes: `cobble_at_cap`, `uncounted`, `at_target`, `withdraw_hold`, `spent_tools`,
`worn_pickaxes`, `tool_target`, `junk`, `saplings`, `bamboo`, `chest_after_deletion`; a count of 0 says "could not
count the town" (or "nothing left to count" when no key was left at skill time), never "everything is kept".

**EXPECTED (the rows applied to the measured W3 bags):** 38 full bags, 1,349 -> 1,235 slots (3.0 per bag: bone_meal 40,
ladder 35, torch 34, building stone 5); 33 of 38 under 34 on the chest rows alone. On the 32 full bags that reached town in
W24 (the six immobile excluded): 1,135 -> 1,038 (3.0 per bag), 28 of 32 under 34. Plus up to 51 spent pickaxe copies in
40 full bags for the wear-out (row P; an upper bound: today's rule already wears some). The existing exits (cobble 8.2
slots per bag, wood 1.2, junk 2.1) are not counted here: whether they run is cobblekeep-01's and the well's.

**THE TOWN CHESTS.** The backlog moves once: ~114 slots fleet-wide over the first visits (2,239 bone meal = 35 slots, 676
torches = ~11 slots by count but one per bag, 283 ladders). Steady inflow afterwards: torch 0.79 + bone_meal 0.56 +
building stone 0.09 items per bot-day -- under 2 slots a day for the whole fleet. Nothing withdraws or prunes these names;
at that rate a single double chest lasts years. If chests fill anyway, the town deposit fails `town_storage_full` (15 min
backoff) and the allowance-only plan says "waits for a town chest with room"; it never builds or places a chest and the
deposit verb never counts the surplus. The read gates on it (section 6, D5).

## 4. Composition: where each layer meets a full bag (the dead-end table)

| keep layer | full bag at town, today | with the allowance | the remedy the bot can perform from where it stands |
|---|---|---|---|
| bankable `not_wanted`: torch, ladder < 26, bone meal, eaten food beyond the best, building stone | kept forever: NO exit | the chest at the town deposit | the town deposit (at town, a container within STORAGE_REACH 16; no walk across town) |
| bankable `not_wanted`: unlisted names | kept forever | kept (reported for the owner) | none: named, owner's call |
| ballast / well junk / compost junk / saplings | the well / the composter where they stand | unchanged, and FIRST (deletion first) | the well order, the compost order; plinth-first builds the well |
| bankable KEEP_ONE stations | 1 kept | 1 kept | none needed (one slot) |
| last-swing's spent pickaxes | 3 kept | 0 kept while the stone is held | wear_out (an at-34 order, anywhere) |
| worn pickaxes (2-10) | kept | kept | worn-first mining (toolhygiene part 2) |
| stocktarget tool cap | at target -> stays | unchanged | the valve (one per visit) |
| stocktarget bulk / cobble cap at target | the well | unchanged | the well |
| stocktarget unknown count | stays; count step; count fails on a lid | unchanged rule; the count step kept for allowance-only plans; honest row | count_town / the lid clear (cobblekeep-01) |
| cobble reserve / STONE_GUARD / exit contract | 64 kept | 64 kept (1 slot) | none needed |
| townKeeps (stockpile, gather rung, iron ladder, wanted) | kept | kept; the goal wins over every row | none needed |
| deposit verb (walks home) | unchanged | unchanged: allowance surplus is NEVER the reason for a deposit, a walk, a trip, a new chest, the deposit rung or the prompt's CARRYING line (depositPlan never sees it; kitshrink-01's rule, both engines) | the next town visit |
| withdraw verb (the model asks for an item) | 10 min hold | a deliberate withdraw overrides the allowance for its hold; the next full town visit after the hold re-banks it (Codex r1 P2-7; a chain test) | -- |
| town chests full | town_storage_full, 15 min backoff | unchanged; the allowance-only plan waits, says so, never opens a new chest | none (described, gated: D5) |

THE REFUSAL CHAIN (CLAUDE.md "test the chain, not the guard"), driven through the REAL CognitiveLoop as the town deposit's
CHAIN tests do: a full bag of allowance surplus at town -> order -> skill -> fake chest -> the next decision does not
re-order; with junk and a usable well -> the chest rows wait for the well, then go; with deletion pending past
TD_DELETION_WAIT_MS -> they go anyway.

AWAY FROM TOWN: no town-deposit change (the six immobile bots are homefix-01's). Row P's wear-out applies wherever the bag
is at 34+.

## 5. The change

- `bots/src/bagallowance.mjs` (new, leaf): `ALLOWANCE`, the rows (`allowanceRow`, `rowKeep`, `allowanceSteps`),
  `BAG_ALLOWANCE=on|off` (default on; anything else reads on and says so), `LADDER_ESCAPE_MIN` (asked of ladderPlan),
  FOOD_PRIORITY and BUILDING_CHEST (tests hold them equal to reflex.mjs and well.mjs), the rows' detail builders.
- `towndeposit.mjs`: `townDepositPlan` appends the chest rows' steps (options `fullBag` latch, `rows`) after its own;
  `bankOwned`, `notForChest`, `fullBagLeft`; base steps sort first; `townDepositOrder` takes `deletion` (the wait, bounded)
  and passes `rows` and, for an allowance-only plan, `recount` in the order's args.
- `skills.mjs`: `deletionPending`; townDeposit latches `fullBag`, takes the order's `rows`, writes `_bagbudget phase=bank`
  (the allowance's start counts and server-verified banked, and EVERY banked name) and `phase=none` (full-bag no_effect),
  the honest no_effect detail, the allowance-only failure texts; wearOut writes `_bagbudget phase=wear` when row P listed
  a copy.
- `hygiene.mjs wearOutPlan`: row P -- and `craftroom.mjs craftRoomRemedy`, the craft's make-room step, reads the same hygiene
  plan (so under row P the craft may wear any spent pickaxe the plan lists, the survivor rule unchanged). `cognitive.mjs`:
  passes `deletion` and the plan's `rows`. `index.mjs`: the licence row `_bagbudget_mode`. The section-3 constants import
  the table.

## 6. Read plan and registration

Read `scripts/host/bagbudgetread.py` (files; DiD canary vs control; denominators and positive controls first):
- LICENCE `_bagbudget_mode` (only this build writes it).
- DEFECTS (each REVERTS, evidence=defect, each with a failing fixture in --selftest):
  D1 `breach_junk_chest`: a canary `_bagbudget phase=bank` row banked a junk name. The rows are COMPLETE: every banked
     name is on some `part=i/n` (each under the 300-char cut; Codex r2 P2-3), and a run whose parts are not all present
     is counted `d1_incomplete`, which BLOCKS KEEP. Junk = the read's copy of row J's lists (the owner's well list +
     decorations, NEVER_BANKABLE, NEVER_KEEP, saplings, bamboo, swords) and, ONLY on rows saying `peaceful=1`,
     PEACEFUL_COMPOST and apple (Claude r2 P3-5: outside a peaceful world row F banks them legitimately).
  D2 `breach_below_allowance`: a `phase=bank` row whose `allow=name=start:banked` leaves a station below 1, or 26+
     ladders below 26 (the rows the read can judge from the row alone).
  D3 `breach_full_noeffect_chest`: a canary `phase=none` row with `rows=1` and `chest=1` -- a CONSISTENCY tripwire (the
     class comes from the same plan, so it trips only if the two disagree: Claude code r1 P3-1).
  CROSS-CHECK (REPORTED, never a verdict; Codex code r2 P2-2): canary full-bag no_effect rows whose own snapshot holds a
     torch, bone_meal or < 26 ladders while the `phase=none` row says `rows=1` -- the read's independent look at the
     planner, printed with names; a wanted floor or a withdraw hold keeps them legitimately and the read sees neither.
  D4 `breach_ingot_banked` (cobblekeep-01's, carried).
  D5 `harm_storage_full`: canary `town_storage_full` failures >= 3 AND above 2x the control's rate per bot-h.
- (The cross-check of Codex design r1 P1-4 is above.)
- PRIMARY (DiD, reported): share of bots at >= 34 slots, slots per bot, full-bag town deposits that banked > 0 (share), craft
  "no slot can be freed" per bot-h, gather success; spent pickaxes per full bag. UNLISTED names in full bags (for the owner).
- EXPOSURE (declared, tier 2): >= 3 canary `_bagbudget phase=bank` rows that banked an allowance stack AND >= 1 canary
  `phase=wear` row by the read (both mechanisms, Codex r1 P2-9).
- POSITIVE CONTROLS: control `_town_deposit` rows >= 1, control full bags >= 1, control `wear_out` rows >= 1.
- VERDICTS: any D1-D5 -> REVERT. Licence 0, exposure unmet, or a positive control 0 -> NOT_YET (INCONCLUSIVE at the
  deadline). Otherwise KEEP (tier 2 at +180 only with every tier-2 condition; else the tier-3 reads).

TIER: **tier 2** (`"tier": 2`, no class). CLAUDE.md Deploys (OWNER DECISION 2026-10-19, gate v36 installed 16:20Z): tier
2 is "a small fix with strong Paper evidence", KEEP at +180 only with exactly 4 pools, >= 48 bot-h, a declared exposure
met, no WATCH/HOLD, a licence that is not `rate`, a death rate no higher than control's, and a clean baseline; otherwise
"it reads on as usual". Why it fits: the operator registered cobblekeep-01 -- the same family, a bag fix of similar size --
as tier 2 on 10-19 16:40Z ("tier 2 (owner 10-19 tiers: small fix, strong Paper evidence)", replacing `class: bag-fix`
which v33 refuses without a `bag_fix` block); every gate here reads rows the change itself writes; the Paper scenes are a
launch precondition. FALLBACK, stated: a tier-2 run that misses any early-KEEP condition -- the death rate above control's
included, which more mining from freed slots could cause -- reads on as TIER 3 (the default death gate: two canary deaths
and > 1.25x control). The bag-fix class (gate v33, installed 10-07) is the alternative if the coordinator expects
exposure deaths; it needs a `bag_fix` block with a null-banded primary (bagnull.py), which this registration does not carry.
LAUNCH CONDITIONS: only once cobblekeep-01 is KEPT and promoted (this build is on its tip); `~/digest/gate-installs.log`
shows gate v36 (installed 10-19 16:20Z, bundle 19951735); the draw excludes brain-01's pools (board-c, hive-d) while it
runs, or tier 2's clean-baseline rule blocks the KEEP; and tier 2 draws only pools whose tier-2 predecessor closed >= 240
min ago (cobblekeep-01 itself is tier 2).

## 7. Prior art (searched 2026-10-20)

- Voyager (MineDojo, mineflayer; voyager/agents/curriculum.py): at `inventoryUsed >= 33` the curriculum proposes
  "Deposit useless items into the chest", naming andesite, dirt, cobblestone and LOWER-TIER TOOLS superseded by a better
  one. The same trigger and the same idea of a kept set, chosen by the LLM -- which this fleet measured fails ("advice
  printed is not advice taken"), so here the choice is a table and the transfer deterministic.
- Mosfet (git.tannercollin.com tanner/minecraft-bot, docs/cache_items.md): at >= 27 used slots caches everything except
  a NEEDED list (tools, food, bed) and keeps ONE STACK of each WANTED item -- the closest design; it places a chest from the
  bag when none is near (this fleet never does that for allowance surplus).
- mineflayer-collectblock: deposits to configured chests when the inventory is full (no keep table).
- GITM (arXiv 2305.17144), already cited by toolhygiene: inventory items are used directly, never obtained again -- why the
  stations stay one each.
None handles the slot arithmetic this fleet hits (one kind = one slot, so a count allowance inside one stack frees
nothing), the deletion-first ordering, or allowlist polarity against an owner's junk rule.

## 8. Interaction with queued work

- cobblekeep-01 (the base): lids, the well's at-cap cobble, ironKeeps -- built on, not duplicated.
- toolkit-03 (`tk3-on-9e7d998`): the iron axe/shovel/pickaxe stay (rows P, A untouched for usable copies).
- bamboo-03: bamboo stays junk here (row J); its fold is bamboo-03's.
- kitshrink-01 (closed INCONCLUSIVE 10-17): its torch/ladder rule and "never the reason for a trip" reused; its
  depositDue/admission plumbing is not needed because the allowance never enters depositPlan.
- homefix-01: the six immobile full bots (section 2.2).

## 9. What it does not do

No change to the deposit verb, withdraw, prune, the well's or composter's lists, the cobble cap or any stock target.
Saplings stay the composter's. Unlisted names stay in the bag. No trip, no new chest, no world edit.

## 10. Reviews

**Design r1 (2026-10-20 ~04Z).** Codex CHANGE: P1 composter carried by row M; P1 junk precedence must include the
peaceful compost policy; P1 sapling keep vs composting; P1 guarantee/D3 confuse planning with execution, D1 truncation;
P2 threshold latch and later disposal orders; P2 narrower evidence (63/85, 15 vs 16, displacement); P2 withdraw refill
and full storage; P3 row P wording; P2 tier justification. Claude CHANGE: P1 junk into chests via F/G (peaceful compost,
saplings); P1 row M default -> a named list; P2 chest inflow unbounded; P2 exit order inverted (deletion first); P2
base-plan first in the container; P2 the latch; P2 failure text names an impossible remedy; P2 the count step skipped;
P2 food rank and pillar blocks; P2 away-from-town wear-out; P2 tier fallback/baseline; P3 evidence and wording fixes.
ALL TAKEN in r2 (sections 1-6): saplings out, junk = row J incl. the peaceful policy, row M a named list, unlisted stay,
composter a station, FOOD_PRIORITY, the pillar guard, deletion first (bounded), base first, the latch, the count step,
the failure texts, the inflow measured, the displacement evidence, the planning/execution split, every banked name in the
bank row, tier 2 with its fallback and launch conditions.

**Design r2 (2026-10-20 ~05Z).** Codex CHANGE: P2 deletionPending ignored the dispose order's inside/depth gates and
leaving town restarted the wait; P2 a count-only visit's 15-min stay latch hid the wait's expiry; P2 D1 truncation only
reported. Claude CHANGE (every r1 finding confirmed resolved): P2 the wait outlasts a 9-min median stay, a latched issue
stretches it, "pending" counted exits whose orders never issue (depth hold, starved behind a ready work order); P3 name the
count reason in the args, the count + deposit budget vs the 60 s contract, "could not count" when no key was left, D1 on
non-peaceful pools, a lone golden carrot keeping itself, the 2.2 dates, the tier-2 240-min cool-off and v36. ALL TAKEN in
r3: the depth/inside gates in deletionPending; the wait summed over time full at town; a 60 s grace unless a deletion order
issued in the last 3 min; 5 min cap; no stay latch while withheld; complete bank rows in parts with `d1_incomplete` blocking
KEEP; `peaceful=` on the bank row; `count: 'empty'|'allowance_only'`; the allowance-only count at a third of the budget;
"nothing left to count"; FOOD_MIN 4; dates; launch conditions.

**Design r3 (2026-10-20 ~06Z).** Claude **APPROVE** (every round-2 finding of both engines resolved; P3 notes: `recent`
also counts a compost harvest order, bounded by the cap; an unlatched withheld stay can re-issue the count step once or
twice within the wait; the grace can stretch to the 5-min cooldown; a 15 s count may count fewer containers -- the recount
order picks the rest up; the second plan per withheld scan is cheap). Codex CHANGE: P2 the wait accumulated only on scans,
so thirty 10-second visits (300 s full at town) never reached the cap (reproduced: deletionWaited 0, nothing issued; one
continuous 60 s stay issued -- the positive control). TAKEN in r4: the clock runs on every call full at town, before the
scan/cooldown/latch gates; a scan only resets it when nothing is left to delete; Codex's repro is now a test (300,000 ms
counted, the order issued).

**Code r1 (2026-10-20 ~07Z, on 7e9fd2b3).** Codex CHANGE: P2 a later run's stray part could complete an earlier bank run in
the read (D1 coverage); P2 D4 read only the 300-char town_deposit row; P2 `bagwell` could pass on a failed dispose; P3
`bagfar` did not require the good pickaxe to survive. Claude APPROVE with P2-1 (no behaviour test of the deletion-first
wiring through the real loop) and P3s (D3 cannot fire by construction -- promote the cross-check; the clock comment; bagmix
assumes a peaceful world; RCON_LOCAL trusts the launcher's lock word; row F could keep the composter's apple). The full
suite also caught craft-room.test.mjs: the craft's make-room remedy reads the same hygiene plan, so row P reaches it. ALL
TAKEN: runs close at 1..n (a stray part opens an incomplete run); D4 also reads the bank parts; bagwell needs a successful
dispose_well and the egg/flint gone; bagfar needs four spent copies before and the good one after; a real-loop chain test in
well.test.mjs (deletion pending -> every town_deposit order rows=false and dispose_well given; no well -> rows=true;
an anchored mutant of the cognitive reader); D6 (>= 2 independent omissions REVERT); the clock comment; bagmix reads the
difficulty; bestFood skips names another exit owns; craftRoomRemedy takes the switch and its tests pin both rules.

**Code r2 (on 7af10484).** Claude APPROVE (every round-1 finding resolved; the craftroom change right; P3: D6 counts rows,
not bots; `"class": ""` beside `"tier": 2` -- tierrule.py `not reg.get('class')` reads '' as absent, the operator's
cobblekeep-01 registration has the same pair; the well.test chain's runner moves nothing, so Paper bagwell stays a launch
precondition). Codex CHANGE: P2 two incomplete visits could still stitch (A's 1/2 + B's 2/2); P2 D6 can false-REVERT on
legitimate keeps (wanted floors, withdraw holds); P3 RCON_LOCAL trusts the launcher's lock word. TAKEN: every bank part
carries the visit's id `v=` and the read never joins parts of two visits (fixture: 2 incomplete); D6 removed -- the
cross-check is reported only. NOT CHANGED (P3, documented): under RCON_LOCAL the driver runs ON the sandbox host, which
cannot reach 10.0.0.31; the launcher (bbpaper.sh) takes the lock atomically with mkdir on 10.0.0.31 before it starts the
driver and releases it after, and the driver still refuses a non-empty sandbox.
