# stoneworks: surplus cobble into a stone stock for trading and stone bricks for building (2026-11-05)

**OWNER 2026-11-05:** "with our ridiculous amount of cobblestone can we: smelt cobblestone into stone for trading (apprentice
mason villagers normally buy 20 stone for 1 emerald, before price adjustments; trades have stock limits); produce stone bricks
for construction". **Control session, same night:** smelt to TARGETS only (never "convert all cobble"; coal would then be the
bottleneck); a fuel ladder bamboo -> sticks/saplings -> wood above the reserve -> coal only above the town keep + the coal-sale
keep; lava buckets later (design the hook only). Selling stone to masons is the trading agent's (coalsale-02, on coalsale-01);
this item only produces and stocks it. Ledger row `stoneworks-1105`.

## 1. Measured (2026-11-05 ~01:00Z)

Town stock = the latest observation of every container in the town index (`townindex.mjs` fold, read-only node script on each
host; 16 live fleet towns, the showcase's one). Flow = 24 h of skill rows per bot, streamed one bot at a time with
`telemetry.stream_rows` (rotation-aware, full walk; fleet 80 bots, 2,169,524 rows, 1,454,647 with an inventory; showcase 15 bots).
Bag gains = the sum of positive inventory deltas between consecutive rows (gross: withdrawals and crafts count too).

| | Fleet (16 towns, 80 bots) | Showcase (1 town, 15 bots) |
|---|---|---|
| Town cobblestone / cobbled_deepslate | 7,564 / 8,129 (52-1,119 a town) | 52 / 870 (+ the stock yard's piles) |
| Bags cobblestone / cobbled_deepslate | 15,622 / 6,316 | 6,056 / 462 |
| Bag cobble gains / 24 h | 191,355 | 28,961 |
| Town stone / stone_bricks | 36 / 2,456 (121-202 a town: at the 128 buffer) | 12 / 362 |
| make_material 24 h | 2,606 rows, 2,566 `count`; bricks 26 orders, 196 made | 552 rows; bricks 25 orders, 132 made |
| Town coal | 2,700 (34-309 a town) | 67 |
| Town logs (reserve 512 a town) | 34,101 (253-3,283; 25,909 above the reserve) | 103 (none above it) |
| Bags bamboo / saplings / sticks | 2,931 / 1,156 / 214 | 0 / 87 / 20 |
| Bag gains/24 h bamboo / saplings / sticks | 4,333 / 1,399 / 4,324 (mostly crafted) | 0 / 146 / 497 (crafted) |
| Town sticks / saplings / bamboo | 88 / 963 / 0 | 0 / 0 / 0 |
| Distinct furnaces used / 24 h | 43-81 a town | 92 |
| Smelt skills' body time / town / day | 0.7-2.5 bot-hours | 4.0 bot-hours |

Denominators: every number above is out of the stated towns/bots; the zeros (showcase bamboo, town sticks) have positive
controls in the same reads (bamboo 2,931 on the fleet by the same script; logs, coal and saplings non-zero in the same towns).

**Reading.** The furnaces are idle and plentiful; the fleet's wood is plentiful (25,909 logs above the reserve); bricks already
stop at their 128 buffer ("stocked"); stone is never stocked (its town target was 64: stone above it was pruned). The showcase is
wood-poor (103 logs, below the 512 reserve) and coal-poor (67, below the 64 sale keep + the smelt job's need).

**Bills.** hall@1 306 stone_bricks, workshop@1 89, house@1 72 (`bots/src/blueprints`); the showcase also builds a storehub (97) and
an enchantshop (89). Codex: the showcase's listed bills total 653; with 362 in town the outstanding deficit is ~291.

## 2. Design (reconciled)

Both engines independently put it **inside `make_material`** (mats.mjs decides, skills.mjs does), with **planks, not charcoal**,
**no unattended multi-furnace loading**, ore first enforced by the job itself, and the stone target raised.

- **Kind `stone`**: 12 cobblestone -> 12 stone, BANKED. Ordered after bricks (construction first). Buffer **320** per town = one
  apprentice mason's restock (16 uses x 20 stone); a setting (`MATS_BUFFERS`).
- **Bricks**: buffer 128 -> **256**, **512 while a building project is active** (the project reserve's own state; the order and
  the skill's re-check use one function, `effectiveBuffer`).
- **Town stone target 64 -> 384** (`stocktarget.mjs`), NOT under the switch (Codex): turning the producer off must not prune the
  stock it made.
- **Ore first**: no stone or bricks order while the town index shows raw iron or raw copper (`oreWaiting`). The chain asks the
  smelt job first, but a MAKE role lease (cognitive.mjs B5) asks the materials job BEFORE it (Codex), so the rule is in the job.
- **Cobble**: the bag's spare first (the owner's cobble-in-bags concern; bags hold 15,622 + 6,056), then town chests above the
  256 reserve. Cobbled deepslate is never the input (it smelts to deepslate; no mason buys it).
- **THE FUEL LADDER** (`fuelPlan`; the cobble kinds only; the first rung that funds a whole batch EXACTLY):

| Rung | Ticks (smelts) | Source | Batch | Why |
|---|---|---|---|---|
| bamboo | 50 (0.25) | bag only | 48 for 12 | never bankable; composted or welled today |
| sapling | 100 (0.5) | bag only, one species, above the composter's 16/species keep | 24 for 12 | the share the composter takes anyway; town saplings stay the tree farm's |
| planks | 300 (1.5) | 2 logs above the 512 reserve -> 8 planks | 8 for 12 | the base path exactly |
| coal | 1600 (8) | town only, above **COAL_FUEL_KEEP 128** (sale keep 64 + the smelt job's 64), never lowered by a project | 1 for 8 | last |
| lava | 20000 (100) | **hook only** (`on: false`) | - | after bucketfix-01; deep-miner lava only; the bucket returns |

  - **Sticks are not a rung** (measured: towns 88 fleet-wide and 0 on the showcase; the bags' 214 are the kit's; Codex too said
    never craft sticks for fuel). Codex would admit town sticks above 40; at 88 across 16 towns it is not worth a rung.
  - **Planks, not charcoal** (both engines): a log is 4 planks = 6 smelts; charcoaled it is 8 - 1 = 7, but needs a second furnace
    pass and makes charcoal, a gated name (the iron ladder's fuel).
- **Accounting**: a ladder fuel is its own family (`fuelToLoad` is the expected burn; overburn / loss as for planks); the coal
  rung's unburned town coal is banked back (above the bag's opening count only, so the bot's own coal never leaves); the stone
  kind's recovery counts part = intermediate once (Codex found the double count; fixed before the build).
- **Scaffold (Codex code r1 BLOCKER, fixed)**: stone is pathfinder scaffold and every deposit keeps the bag's cheapest 8; the stone
  kind runs only when the bag after the order holds 8 cheaper scaffold (`stoneScaffoldHeld`, the deposit's own rule).
- **Kill switch** `STONEWORKS=off`: the base exactly (no stone kind ordered, bricks 128, planks only); mats_return still
  reconciles any open stone note (the recovery is kind-generic, never off with the switch).

### What the ladder sustains without coal (the control session's question)

Fuel capacity = 6 L + B/4 + A/2 stone-equivalents a day (L logs above the reserve, B bamboo, A spare saplings); one equivalent is
ONE stone or ONE brick.

- **Fleet, per town per day**: bamboo 4,333/16 = 271 -> **~68**; spare saplings (at most 1,399/16 = 87) -> **<= 44**; wood above the
  reserve 701 logs/day gross (11,225/16) on a 1,619-log surplus -> **thousands** (Codex: 4,321 gross equivalents/town/day, an
  envelope, not a proven net rate). The binding limit is body time and the one-maker lease, not fuel: a 12-item order holds the
  maker ~2-3 min, with a 10-min cooldown per bot; at today's order rate (~25/day/town when not stocked) that is **~300 stone or
  bricks a town a day**. The targets (320 stone + 128 more bricks a town) fill in **about two days**; after that production equals
  what the masons buy and the builders place.
- **Showcase**: no bamboo, no wood above the reserve, coal below the keep -> **only saplings: at most ~73/day before replanting
  (146 gained/2)**, i.e. one or two stone orders a day. Its bricks today (132/day) already burn its spare wood under the lowered
  project reserve. **Coal is the showcase's bottleneck the moment it converts more than ~70 a day**; the fleet's is nowhere near.
- With coal (fleet only, above 128): 2,700 - 16 x 128 = ~650 spare coal = ~5,200 smelts, used only after the other rungs.

## 3. Codex's independent design (summary) and the reconciliation

Codex (`codex exec`, read-only, given the measurements and the goal, not this design): a target-driven producer inside
`make_material` with separate destinations (trading stone, construction bricks); pure functions `stoneDemand`, `fuelPlan`,
`productionPlan`; targets 320 stone, bricks = max(128, outstanding bills in stone_bricks); priority construction deficit >
trading stone > brick buffer; ladder bamboo -> town sticks above 40 -> saplings above keeps -> planks from surplus logs -> coal
above (town reserve + 64 sale keep + outstanding claims, at least 96); planks over charcoal; cobble bag -> yard -> chests above 256;
cobbled deepslate never; no unattended furnace loading; ore first enforced independently (the MAKE lease precedes smelt_town);
shared coal claims with the seller; a stone target that survives switch-off; recovery counts each item once; ship in five
pieces (planner + rows; stock protection + recovery; bamboo/sticks/saplings; planks + bill-driven bricks; coal + yard), each
enabled only after a Paper proof and a showcase read.

| Point | Codex | Claude | Built |
|---|---|---|---|
| Where | make_material + new stoneproduction.mjs | make_material, in mats.mjs | mats.mjs (the job's decisions already live there; one module, one test file) |
| Bricks target | max(128, outstanding bills) | 256, 512 while a project is active | Claude for piece 1 (the project state exists today; the bill read needs every open record's world read) -- **bill-driven is piece 2** |
| Sticks | town sticks above 40 | not a rung | not a rung (88 fleet-wide, 0 showcase) |
| Coal keep | >= 96 + outstanding sale claims | 128 flat | 128 (no sale claim journal exists yet; 128 covers one 64-coal sale trip above the 64 keep) |
| Batch | <= 8 smelts to start | 12 (the bricks kind's proven batch) | 12 (coal 8); the bricks kind has run 12 in 180 s since 10-25 |
| Yard draw | bag -> yard -> chests | bag -> chests | bag -> chests; **yard draw is piece 2** (bags hold 6,056 on the showcase; a yard dig costs body time the bag does not) |
| Ore first | independent of the chain | stone only | both cobble kinds (Codex) |
| Stone target and switch-off | must not prune | under the switch | not under the switch (Codex) |
| Pieces | five, each Paper-proven | one piece + follow-ups | one piece (fun mode: tier 2, one review); the Paper fuel facts are proven (section 4) |
| Recovery double count | found | -- | fixed |

## 4. What rests on Paper / mineflayer, and the proof

Proven on **sandbox3, 2026-11-05 01:24-01:33Z** (`sandbox/stoneworks/fuel-proof.cjs`, rows in `fuel-proof.jsonl`; RCON builds the pad
and hands the inputs, the bot loads the furnace with matsSession's own calls, the results are read from the SERVER): 12
cobblestone on **48 bamboo -> 12 stone**, on **24 oak_sapling -> 12**, 8 on **1 coal -> 8**, 12 on 8 planks -> 12 (control); in every
case the fuel slot was empty after (no extra item consumed) and the input slot empty; 12 stone -> 12 stone_bricks by the 2x2
recipe. **5/5 PASS.** Not proven (and not relied on): lava buckets.

## 5. Pieces, tiers, queue placement

| Piece | Tier | Where | State |
|---|---|---|---|
| **stoneworks-01** (stone kind, ladder, buffers, ore first, target 384) | 2 (not protected) | **showcase** first (`stoneworks-01show`), then the **fleet** variant (`stoneworks-01`) | built, reviewed, ready to stage |
| stoneworks-02: bill-driven bricks (outstanding open-record bills) + the yard draw on the showcase | 2 | showcase | design here; build after 01's read |
| stoneworks-03: a stonecutter (1 iron + 3 stone) for stairs/slabs/walls 1:1 (townstyle trim) | 2 | showcase | when townstyle-02 names stairs/slabs |
| lava rung | 3 (bucket, deep miner) | fleet canary | after bucketfix-01 and the deep miner's lava |

Queue (Claude; Codex agrees on showcase-first for building work): the showcase piece folds into the next showcase release
(it touches no block placement: no tripwire rule). The fleet variant is a **P** (progress) item: tier 2 means owner-direct with
a 60-min tripwire under fun mode; if the control session prefers the canary slot, it fits **after coalsale-01/02** (the seller
needs the stock; stone is useless to masons before coalsale-02 sells it) -- or bundle with coalsale-02 (different files:
mats/skills makeMaterial/stocktarget vs trade.mjs; they compose because coalsale-02 only READS town stone above its own keep).

**Coordination with the trading agent (coalsale-02, origin/coalsale-02 trade.mjs):** it sells stone above `stoneKeep` 192, in
whole trades of 20, at most 128 a trip. This item stocks up to 320 (town target 384), so each refill gives the seller 128 (six
trades, ~6 emeralds before price changes); as the seller draws below 320 the job refills. Coal: this item never burns town coal
below 128, so a coal-sale trip (above its keep 64) always finds 64. Neither side needs the other's code.

## 6. Reads (fun mode: the generic read plus these lines)

- `_make_material kind=stone|bricks`: verdict (ok / loss / overburn / forbidden / unreconciled), `fuel=<rung>:<name>`, `made=`,
  `stop=` (ore_first, no_fuel, scaffold, stocked). Defect lines: any `verdict=forbidden`; loss/overburn above 5% of moved rows;
  an abandoned stone note.
- Town stone and stone_bricks in the index at +2 h / +24 h (the goal: stone rising toward 320, bricks toward 256).
- smelt_town success count before/after (ore first: must not fall).
- Coal in town: never below 128 by this job (`took=coal:` rows only where the town held > 128).
- Effect (registration): `kind.rate.v1 make_material status=success`, increase, +10% relative (count rows dominate).

## 7. Owner decisions

None needed to ship. Options for later: (a) **deepslate bricks need NO fuel** (4 cobbled_deepslate -> 4 polished_deepslate -> 4
deepslate_bricks, crafting only) and the towns hold 14,445 cobbled deepslate: a palette option for builds; (b) the stone buffer
(320) is a setting -- raise it once coalsale-02 shows how much the masons actually take.

## 8. stoneworks-02 and stoneworks-03 (control session 11-05, after stoneworks-01 was queued)

**Asked:** "Build stoneworks-02 now: bricks driven by the open build bills + the yard draw + DEEPSLATE BRICKS ... with a
deepslate-brick stock target and a palette hook so townstyle/decorator/wall trims can use it; then stoneworks-03 (stonecutter:
stairs, slabs, walls; coordinate with townstyle-1104 which needs stairs/slabs for roofs)."

**stoneworks-02** (tier 2, same switch):
- **Bills**: `stoneBillNow` (skills.mjs) runs `billOf` over every sited, unfinished project record (`projectHeads`), counting
  stone_bricks and deepslate_bricks (and, with 03, the six cut parts); cached 10 min; read only by the materials order (a
  non-enumerable lazy field of the town reading). `effectiveBuffer`: bill + 64 (cap 1024) for bricks, the exact bill for cut parts,
  never below the table; a read bill wins over the 512 project rule, an unreadable one falls back to it. Codex's design asked for
  exactly this (count remaining cells, not whole blueprints).
- **Yard**: the cobble kinds take bag spare -> the yard's piles (`yardDrawFor`, the yarduse-01 bounded draw, before the chests) ->
  the chests above 256. The yard's cobble is booked as the order's take. Showcase only (the fleet variant stubs it: no yard there).
- **Deepslate bricks**: kind `deepslate_bricks`, 16 cobbled deepslate (bag spare first, then the town above 64) -> 16 polished ->
  16 deepslate bricks, both 2x2, no table, furnace or fuel; buffer 256 + bills. polished_deepslate and deepslate_brick(s, _slab,
  _stairs, _wall) join PROJECT_PARTS (always banked, never disposed). The towns hold ~14,445 cobbled deepslate (fleet bags 6,316 +
  chests 8,129; showcase 870 + 462).
- **Palette hook**: `TRIM_STONES` / `trimStone(stock, need)` in mats.mjs -- deepslate bricks, then stone bricks, then cobblestone, by
  what the town stocks. A blueprint palette listing `['deepslate_bricks', 'stone_bricks']` gets the same through billOf's
  first-stocked rule. townstyle's `STONES` (foundations, courses) and `styleOf` can call it at siting.

**stoneworks-03** (tier 2):
- **Cut kinds** stone_brick_{stairs, slab, wall} and deepslate_brick_{stairs, slab, wall}: 8 bricks a cut, stairs/walls 1:1, slabs
  1:2 (the table: 6 -> 4 stairs). Bricks from town above 64. Standing stock 32 stairs / 48 slabs / 16 walls of the stone-brick
  family (a style can site with them), none of the deepslate family; bills raise either.
- **Station**: with a cut wanted and no stonecutter within 32 (or carried), the order makes one: 1 town iron ingot above 32 + 3
  stone at a table, placed beside the bot; the next cut uses it. The window: the input moved in exactly, the recipe button index
  PROBED by reading the result slot, the result shift-clicked, the window closed on every exit.
- **townstyle-1104 coordination**: its roofs are WOOD stairs and slabs (`woodPartsPlan`, crafted at a table from planks); a
  stonecutter cannot cut wood. What stoneworks gives it is stone trims and foundations (stone/deepslate brick stairs, slabs, walls)
  and `trimStone`; townstyle-02's halls could take stone-brick slab roofs from this stock instead of wood.

**Paper sandbox3, 2026-11-05 02:34Z** (`sandbox/stoneworks/parts-proof.cjs`, `parts-proof.jsonl`, server-read): **11/11 PASS** --
16 cobbled deepslate -> 16 polished -> 16 deepslate bricks (2x2); the stonecutter crafted at a table and placed by the bot;
stone_bricks -> 8 stairs (button 2), 16 slabs (1), 8 walls (3); deepslate_bricks -> 8 stairs (1); stone -> 8 stone_bricks (4);
table controls 6 -> 4 stairs, 3 -> 6 slabs, 6 -> 6 walls. The button order differs per input, so the bot probes, never assumes.
Not proven (named): vanilla returning an uncut input to the bag at the window's close (the cut always moves exactly n and cuts all
of it; the balance books whatever stays).
