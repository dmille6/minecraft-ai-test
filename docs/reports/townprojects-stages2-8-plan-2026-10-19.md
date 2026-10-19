# Town projects, stages 2-8: the plan after stage 1 (2026-10-19, design only, r9.1: r9 approved by both engines; P3 polish applied after)

OWNER 10-19 ~13:00Z:
- copper ingots go into town builds: copper blocks and cut copper as trim and roofs, lightning rods, spyglass;
- town projects stages 2-8 are queued after this week's list;
- goal: "build cool structures, survive, and work together for long periods of time"; peaceful worlds;
- the diamond tier is held until the mineshaft and underground safety are done.
- Also on 10-19 (STATE COORDINATION 12:45Z): canaries are tiered. Tier 2 small fixes run on 20 bots, KEEP at +180, with
  ≈ 3 h cool-off. Tier 3 is unchanged. The owner's queue for this week is in §0.4.

This is a plan, not a build. No bot code, no queue entry, no world touched. Every number was read read-only:
- the chest census series on 10.0.0.30 (`~/chestclear3/census-status-*.json`, seven snapshots 10-14 22:12Z ..
  10-19 12:05Z);
- Elasticsearch through `scripts/lib/estelemetry.py` on 10.0.0.31 (`~/estel`), under `nice -n 19`.

It builds on these, and does not repeat them:
- `townprojects-design-2026-10-14.md` (r15, D1-D8 owner-approved; stage 1 smeltjob-01 built and KEPT 10-17);
- `ziggurat-mineshaft-2026-10-15.md` (r5.1; Z1 solid, Z2-Z8 operator defaults; structureguard-01 + builder.mjs built);
- `townfloor-2026-10-14.md` (r2; townfloor-01 built, never canaried).

r2-r9 take in rounds 1-8 of both reviews (§9).

---

## 0. Answers first

**1. Copper is not short today, and it will keep coming.**
- **Stock (shared towns):** 5,547 ingots and 3,430 raw copper, ≈ 9.0k copper-equivalent.
- **Isolated worlds:** 4,368 raw copper, which D2 keeps out.
- **What admission counts for copper parts:** ingots plus banked copper parts, NOT raw copper (r3). Raw becomes usable
  only when `smelt_town` smelts it, and its fuel search misses town coal (§1.2), so counting raw would admit builds that
  then wait on parts.
- **Income.** Smelting runs at ≈ 670 ingots a day. That is faster than bags bank raw copper (≈ 470-570 a day), so the
  shared raw stock runs out in about 11-34 days (§1.2), and ingot output then falls to the raw income (§1.2).
- **Income to the stock.** Over the long run the copper income is the raw banking rate, ≈ 500 a day. Smelting
  converts raw to ingots; it does not add copper.
- **What the plan uses.** Every copper build in this plan together needs ≈ 40k ingots, ≈ 70-85 days of fleet-wide income (≈ 92-114 at an assumed shared share; §3.3). The
  stock is ≈ 14-21k (≈ 16-25k at fleet income) by the time the first pavilion is built, so it keeps rising until the monument's copper rings are
  being placed (§3.3).
- **What follows.** The plan puts copper on every build, and puts a sink that keeps working (the crown's rings) on the
  one structure that keeps growing.

**2. The 10-14 order no longer fits. Three of its reasons have gone.**
- **Smelting throughput.**
  - The town smelt load at its steady rate is ≈ 670 items a day, about 9 furnace-minutes per town per day.
  - In 24 h, 0 of 1,714 `smelt_town` rows mention a busy furnace (114 success, 1,429 no_effect, 158 failed, 13
    aborted or unknown). Positive control: the same text scan finds 479 rows
    naming "no coal" and 950 naming "no raw copper" (§1.2).
  - The milestone `smelt`'s furnace scatter is underground. Of the 99 furnaces it placed in 24 h with a known position,
    98 were more than 16 from home, and the one within 16 was deep. None was at a town's surface (§1.5).
- **The yard as the builder's first client.** The monument took that role (Z3).
- **Iron as a surplus to sink.** Net iron inflow has fallen to ≈ +50 a day since toolkit-02 (§1.3), so the owner's
  10-15 case for blast furnaces and hoppers as iron sinks has weakened.
- **So yard-01 and workshop-01 (blast furnaces, H2 hoppers) are DEFERRED, provisionally (O1).** They reopen on any of
  these:
  - furnace-busy ≥ 5% of `smelt_town` orders in 24 h;
  - `smelt_town` body time > 5 min per bot-hour in a town;
  - the owner wanting them as decoration.

**3. The first new building should be the cheapest roofed one.**
- Every roof needs terraced construction (design 4.0), and no Paper run has proven it.
- **pavilion-01** is a 7x5 open-sided hall with log walls and a cut-copper roof. It proves terracing on the simplest
  plan and spends copper and logs straight away.
- It has no containers, no stations, no roof access and no lightning rod.

**4. ORDER** (one canary lane). The owner's list for this week runs first, unchanged. Stages 2-8 follow it.

| # | canary | tier | why here |
|---|---|---|---|
| 1 | treefarm-02 | 3 | owner's list (launching) |
| 2 | brain-01 | — | owner's list ("test now") |
| 3 | cobble-in-bags fix | — | owner's list |
| 4 | toolkit-03 | — | owner's list |
| 5 | bamboo-03 | 2 | owner's list |
| 6 | **townfloor-01** (rebuild on the tip) | 3 | owner's list; the biggest sink for bag cobble already built (Z4) |
| 7 | **monument-01 + structureguard-01** (= TP **stage 2**, folded in; rebuild on the tip) | 3 | owner's list; its prerequisite (minewell-02 KEPT) is met by wellcare-01's KEEP (§2) |
| 8 | **shaft-01** (rebase) | 3 | owner's list; underground safety; needs structureguard |
| 9 | stonewithdraw-01 (rebuild) | 2 | owner's list |
| 10 | **smeltfuel-01** (NEW, tier 2) | 2 | `smelt_town` finds town coal (§1.2); without it raw copper never reaches the parts job in the towns that hold most of it (O10) |
| 11 | **pavilion-01** (TP **stage 3**, NEW; replaces yard-01) | 3 | the first roof; the copper parts job; logs |
| 12 | **crown-01** (TP **stage 4**, NEW: the monument's copper crown) | 3 | the copper sink that keeps working; needs stage 3's parts job; it changes the frontier, and its exposure (a ring decided and completed) is slow, so tier 3 with an extension until exposed |
| 13 | **hall-01** (TP **stage 5**, D1) | 3 | the landmark |
| 14 | storehouse-01 (TP **stage 6**) | 3 | **conditional** (§4.5) |
| 15 | projectdemand-01 (TP **stage 7**) | 2 | **conditional** |
| 16 | rails (TP **stage 8**: R0 -> R0b -> R1) | 2 / 3 | **gated** after shaftuse-01 KEPT (§6) |

Outside the numbered order:
- **shaftuse-01** (not built; zig 4.4) takes the first free slot once it is built and approved. It never holds the
  head, because the scheduler never skips it. It is the change that turns the shaft into safety (O2).
- **yard-01 / workshop-01** are deferred (O1).

**5. The first two stages of 2-8:**
- **Stage 2**, structureguard-01, inside the monument-01 rebuild (§4.1).
- **Stage 3**, pavilion-01 (§4.2).

**6. Considered, and why each is or is not in the plan:**
- **Rails** between town and the mineshaft: not an iron sink, and not a safety fix today (§6).
- **Sorting hoppers:** still no (§7).
- **Blast furnaces:** deferred (point 2).
- **Logs:** chests have room; no log project yet, with a trigger to revisit (§5).

---

## 1. What was measured (denominators first)

### 1.1 Stock: the chest census series (10.0.0.30, read-only)

**What the census can and cannot see:**
- It reads **a fixed list of container positions taken 10-14 02:21Z** (`positions-run-20261014T0221Z.json`; 349 still
  standing at 10-19). **Chests placed since are NOT in it.**
- ES shows 22 `_deposit_new_chest` rows in the last 40 h, in 9 pools. So every figure here is the stock of an OBSERVED
  SUBSET (a floor on town stock), and a census trend is a trend of that subset only.
- "In town" means within 16 horizontally and 12 vertically of home (chestfull `inTown`).

| item (all census containers) | 10-14 22:12Z | 10-17 13:21Z | 10-17 20:21Z | **10-19 12:05Z** |
|---|---:|---:|---:|---:|
| copper_ingot | 384 | 392 | 2,118 | **5,695** |
| raw_copper | 10,504 | 12,011 | 10,445 | **8,020** |
| oak_log (all logs) | 9,135 (10,419) | 25,325 (26,847) | 11,687 (13,207) | **10,215 (11,836)** |
| cobblestone (+ deepslate) | 4,448 (69) | 14,382 (1,170) | 14,258 (1,179) | **14,627 (1,208)** |
| iron_ingot + raw_iron | 1,815 + 498 | 2,289 + 585 | 2,328 + 583 | **2,343 + 650** |
| coal | 4,008 | 4,445 | 4,181 | **4,019** |
| slots used / known capacity | 23% | 34% | 32% | **32% (2,981 / 9,423)** |

What happened between the snapshots:
- **Oak:** the spike and its fall are the 64-log wood target pruning 14,585 logs down the new wells, before logcap-01
  (STATE 10-17).
- **Copper:** smeltjob-01 (deployed 10-17 ~13:40Z, promoted 19:53Z).

**Per shared town, 10-19 12:05Z, in town:**

| town | ingots | raw Cu | cobble | iron + raw | coal | logs |
|---|---:|---:|---:|---:|---:|---:|
| board-a | 328 | 844 | 850 | 206 | 347 | 905 |
| board-b | 200 | 55 | 867 | 262 | 165 | 1,229 |
| board-c | 599 | 587 | 998 | 226 | 271 | 849 |
| board-d | 703 | 64 | 899 | 167 | 124 | 552 |
| hive-a | 675 | 809 | 830 | 254 | 353 | 414 |
| hive-b | 685 | 16 | 1,000 | 121 | 83 | 196 |
| hive-c | 384 | 305 | 832 | 304 | 126 | 256 |
| hive-d | 649 | 0 | 1,000 | 115 | 113 | 67 |
| placebo-a | 339 | 0 | 777 | 145 | 177 | 356 |
| placebo-b | 81 | 476 | 922 | 195 | 254 | 315 |
| placebo-c | 405 | 274 | 723 | 106 | 186 | 1,164 |
| placebo-d | 499 | 0 | 858 | 173 | 241 | 264 |
| **median** | **452** | **169** | **862** | **184** | **181.5** | **385** |

- Cobble sits at or near the 1,000 cap (cobblecap-1000) in every shared town.
- **Absent from the observed containers** (54 distinct item types read; positive control: the same walk reads
  amethyst_shard 22, raw_gold 15, redstone 45, diamond 5):
  - honeycomb 0, so copper is not waxed and roofs will green;
  - nether quartz 0, so there are no comparators;
  - gold_ingot 0.
  - These show absence in the observed containers only.

### 1.2 Copper flow (ES)

**`smelt_town`, 24 h to 10-19 ~13Z:**
- 114 successful orders smelted 673 raw copper (parsed from each success row's "smelted N").
- By pool: hive-b 186, hive-c 114, board-c 93, placebo-d 59, hive-a 58, hive-d 39, board-a 32, placebo-c 29, placebo-b
  24, board-b 19, board-d 17, placebo-a 3. **Per-town production varies 60-fold.** "56 per town" is an average, not a
  town's rate.

**The other rows of the same 24 h:**
- **1,429 `no_effect`:** 950 "no raw copper in the bag or in the town containers looked in", and **479 "no coal in the
  town containers looked in; the job does not burn the bag's own fuel"**.
  - The no-coal rows are board-c 155, board-b 155, board-a 63, hive-a 48, placebo-c 42 and 16 elsewhere.
  - The census shows coal in each of those towns: 271, 165, 347, 353 and 186.
  - So the job's fuel search misses coal that is in town. This is why 2,240 raw copper sits unsmelted in board-a,
    board-c and hive-a. The code says why (smeltjob `jobWithdraw`):
    - it opens at most 3 containers (WITHDRAW_CONTAINERS);
    - it skips containers remembered for 2 h as holding no copper, which are exactly the coal-only chests;
    - it takes coal only after copper is in hand.
  - **smeltfuel-01** (tier 2, ordered before pavilion-01; O10) is a bounded, independent fuel sweep. Once copper is in
    hand, it revisits up to N town containers for coal, ignoring the copper-miss memory, before it gives up.
- **158 failed:** 111 "the goal was changed", ~45 no path.
- **0 rows mention a busy furnace.**
- **Positive control:** the same window and instrument find 325 milestone `raw_iron` smelts and 1,495,577 skill docs
  from 80 bots.

**66 h in 6 h buckets:**
- 1,100 / 2,324 / 886 (10-17 12Z .. 10-18 06Z, the backlog burst);
- then 161 / 188 / 174 / 165 / 146. **The steady rate is ≈ 670 ingots a day.**

**Raw copper banked by bags** (town_deposit + deposit bag deltas, 36 h, FLEET-WIDE including the isolated pools; the
shared towns' share is not separated): 698, ≈ 465 a day. Before the job, the census
subset rose +1,507 raw in 63 h (≈ 570 a day).
- **Copper-equivalent income ≈ 470-570 a day**, and that is what admission sees.
- Smelting at 670 a day runs the shared raw stock (3,430) down in ≈ 11-34 days. At the fleet-wide 470-570 a day the net
  drain is 100-200 a day (17-34 days). The shared towns' own share is not measured: if banking is even per pool (an
  ASSUMPTION), it is ≈ 75%, ≈ 350-430 a day, and the run-out is ≈ 11-14 days. Ingot output then falls to the raw
  income.

### 1.3 Other flows (ES and census)

**Logs:**
- banked ≈ 900 a day (town_deposit + deposit bag deltas, 36 h: 1,347 logs);
- crafted away ≈ 140 a day (craft bag deltas: 209 oak in 36 h);
- **0 logs disposed since logcap-01.** `_stock_dispose` has no log row after 10-17 23:00Z. Positive control: the same
  query finds 141 oak logs before it, and 264 gravel, 35 sandstone, 29 dirt and 19 sand after it.
- The census subset's oak fell 1,472 in the 40 h after logcap. Neither banking nor disposal explains that. **The town
  log trend is UNKNOWN.** The observed stock is ≥ 11,836.

**Iron:**
- In the 39.7 h after 10-17 20:21Z (a window that contains toolkit-02's canary and its 10-18 06:27Z promotion), the
  observed ingots + raw rose +82, **≈ +50 a day**.
- In the 63 h before that window, ≈ +213 a day.
- Iron is a stock (median 184 per shared town in the observed containers) with a small inflow, not a growing surplus.
- Demand: STATE 11:07Z counts 24 iron pickaxes crafted in 24 h.

**Coal:** 4,019 in the subset, −162 over the 40 h of the smelt burst. The steady smelt job needs ≈ 84 a day.

**Cobble:**
- chests at the cap;
- bags worse: STATE 11:07Z has 41 of 80 bots at ≥ 34 slots, and cobble is the largest slot user.

### 1.4 Storage

- 32% of the known slots are used.
- 22 new chests in 40 h are outside the census.
- STATE 11:07Z: 0 chest-full town_deposit refusals in 12 h, so the cobbleoverflow trigger is not met.
- **Storage is not the constraint.**

### 1.5 Where furnaces and deaths are (ES, 24 h; homes from the census)

**Milestone `smelt`:** 580 rows. 127 "placed the furnace first" in this pass (an earlier pass of a slightly earlier
window counted 126). By band (horizontal distance from home / vertical, where "deep" is more than 8 below home.y):

| band | furnaces placed |
|---|---:|
| > 48 / deep | 45 |
| 16-48 / deep | 39 |
| > 48 / surface | 14 |
| ≤ 16 / deep | 1 |
| no position | 28 |

**Deaths:**
- **7 days:** 260 (drowning 98, fire 78, fall 46, other 24, suffocation 14).
- **All 78 fire deaths name lava, and 0 of 260 name lightning.** Positive control: the same rows name drowning 98 times.
- **24 h:** 26 of 31 deaths carry a position (denominator), and 0 of those 26 were at a town's surface (≤ 16, not deep).
- **The bots die underground**, which supports the owner's diamond hold until the shaft and underground safety are
  done.
- **This does not show that rods would make town safer.** Lightning deaths are not the measure of a rod's effect (§3.2).

---

## 2. What is built, and what each queued item needs

| item | built at | needed to run |
|---|---|---|
| townfloor-01 | `tf-x-tz` @ a2d6972f (townzone 5e663860 lineage) | a variant on the tip (townzone, plinth-first, wellcare, treefarm-02 if KEPT); re-run the floor Paper scene and the F1-F6 self-test. **Naming hazard:** `origin/tf-on-adbec4f` is a TREEFARM branch (tip 0b3a0d4c), not townfloor |
| structureguard-01 + builder.mjs | `structureguard-on-835ef3f` @ eb407fa0 | ships inside monument-01 (recorded departure, STATE 10-15 10:17Z) |
| monument-01 | `monument-on-*` (minewell-01 lineage) | hold "after minewell-02 KEPT": **minewell-02's code shipped inside wellcare-01, KEPT 10-18 and on the fleet**. Needs a variant on the tip merging structureguard into the fleet's planMineStart; re-run the Paper r8 scenes; release the hold (the queue owner's call) |
| shaft-01 | `shaft-on-1f066b0` @ 41dc9d66 (dev base) | rebase onto monument-01's KEPT tip; Paper build / idle / kill / cap |
| shaftuse-01 | designed (zig 4.4), **not built** | build, both engines, Paper T1 / T2 / T10 chains |
| stonewithdraw-01 | `stonewithdraw-on-5e66386` / `-b7cc60b` | a variant on the tip |

---

## 3. COPPER

### 3.1 The recipe chain (minecraft-data 3.112.0, `require('minecraft-data')('1.21.8')`, checked 10-19)

| part | recipe | grid | ingots per placed block |
|---|---|---|---:|
| copper_block | 9 copper_ingot -> 1 | 3x3 (table) | 9 |
| cut_copper | 4 copper_block -> 4 | **2x2 (bag grid)** | 9 |
| cut_copper_slab | 3 cut_copper -> 6 | 3-wide (table) | 4.5 |
| cut_copper_stairs | 6 cut_copper -> 4 | 3x3 (table) | 13.5 |
| chiseled_copper | 2 cut_copper_slab -> 1 | 1x2 (bag grid) | 9 |
| copper_grate | 4 copper_block -> 4 | 3x3 (table) | 9 |
| copper_door / copper_trapdoor | 6 ingots -> 3 / 6 -> 2 | table | 2 / 3 |
| lightning_rod | 3 ingots -> 1 | 3-tall (table) | 3 |
| spyglass | 2 ingots + 1 amethyst_shard -> 1 | 3-tall (table) | an item, not a block |
| copper_bulb | 3 blocks + **blaze_rod** + redstone | | **impossible (Nether)** |
| copper lantern / torch / chest / bars | | | **not items in 1.21.8** |

- **Cut copper costs the same 9 ingots per cell as a copper block.** Only the look differs.
- **v1 uses only full copper blocks.** A slab's half depends on where the click lands, so slabs are out. (A rod's
  facing would be `up` from a top face, minecraft.wiki, but v1 places no rods: §3.2.)
- **Oxidation.** Copper blocks and cut copper green over time, and they are not waxed. Every copper cell is read by its
  oxidation family (design 3.2), so a greening cell is still done. Rods do not oxidise until 1.21.9 (minecraft.wiki).

**The parts job, `make_copper` (ships in stage 3; stages 4 and 5 reuse it):**
- **What it does.** It is a deterministic town job (design §5 rules), one composite skill with a `finally` deposit and
  a carry note (design 3.3). It withdraws ≤ 36 ingots, crafts copper blocks at the town table, crafts 4 blocks -> 4 cut
  copper in the bag grid, and banks the result as PROJECT_PARTS. It withdraws from the containers the count journal
  shows holding ingots (not the nearest-3 sweep). That removes the nearest-3 omission. It does not prove a container is
  reachable now: an unreachable container keeps its existing backoff, and the 24 h roof fallback bounds the wait.
- **When it is eligible.** Only while an ALLOCATED claim (3.2, the town claim set) is short of that part, net of the
  parts already banked. So it is just-in-time and never stockpiles. Its cadence is 1 run per 10 min per bot, up to 4
  blocks per run (36 ingots). A 92-block ring is therefore ≈ 23 runs, ≈ 1-2 h with 2-3 bots at town.
- **The spyglass (the owner's ask, bounded).** The job crafts 1 spyglass per shared town, once, when the town holds an
  amethyst shard: 12 of the 22 shards, 2 ingots per town, 24 fleet-wide. It banks the spyglass as PROTECTED and NEVER_DISPOSE. **It is
  keepsake stock, not a copper sink, and the bots have no use for it** (O8).
- **Conservation gate (ingot units):** ingots withdrawn = 9 x blocks + 2 x spyglasses + ingots returned.
- **New part groups.** copper_block, cut_copper and spyglass join PROTECTED, NEVER_DISPOSE and
  PROJECT_PARTS (design 3.3). copper_ingot is already DEPOSIT_ALWAYS (bankable.mjs:443).

### 3.2 Where copper goes

| stage | build | copper cells | ingots per town | when |
|---|---|---|---:|---|
| 3 pavilion-01 | cut-copper roof, 7x5 (plank variant if copper does not allocate) | 35 (36 blocks, 1 spare) | **324** | at build |
| 4 crown-01 | grand-stair cells of tiers whose first layer is NOT yet open when crown-01 ships (3 per tier) | ≤ 24 | ≤ 216 net (each 3-cell claim rounds to 4 cut copper = 36 ingots, ≤ 288 claimed; the spare block is credited to the next claim) | as those layers open |
| 4 crown-01 | the top-course ring of each tier riser not yet opened, **per-layer rule** (below) | up to 812 | up to 7,308 | as each ring's layer opens; tiers 4-6 hold 204 blocks (1,836) if crown-01 ships before the frontier reaches layer 8 |
| 4 crown-01 | the apex: the whole top layer of tier 7 (6x6, including tier 7's own ring) | 36 | 324 | last |
| 5 hall-01 | cut-copper terrace roof (S / M / L) | 35 / 63 / 99 | 324 / 576 / 900 | at build |
| 5 hall-01 | copper_grate windows in place of iron bars (O5) | 4 | 36 | at build |
| 3 make_copper | spyglass, once per shared town | — | 2 (24 fleet) | once |

The tiers are 2 high, so **tier i's top course is layer 2i+1**: tier 4's ring is layer 9, and the apex is layer 15.
**Crown-01 decorates only layers not yet open.** The monument never digs, so a world whose frontier has already passed
a ring keeps that ring in cobble. **There is no deadline.** A fast world's lower rings are simply cobble: decoration
lost, never a dead end.

**THE TOWN CLAIM SET (copper ALLOCATION for both lanes; the monument record owns layer DECISIONS, §3.2 protocol).** One record per town,
`townclaims-<home>.g<N>.json`, written as generation files with `link()` (the blueprint.mjs protocol).

**What the record holds.**
- Every claim is `{owner, kind, cells, parts, decided_gen, deadline, state}`. The kinds are a project roof, a monument
  layer's copper cells, and the spyglass.
- **Allocation lives here. EVERY per-layer copper DECISION lives in the monument record (r8).** A monument cell is
  copper exactly when the monument record's `layer_copper[k]` is COPPER, names a claim that names the cell, and the cell
  was placed before any `shortfall_at`, or is still unplaced with no `shortfall_at`. Otherwise it is cobble. The claims
  record only FOLLOWS the monument's decisions (the commit protocol, below the per-layer rule).

**Units.** Claims are counted in PARTS, with recipe rounding: copper blocks come in 9-ingot units, cut copper in 4-block
crafts. A 35-cell roof claims 36 blocks = 324 ingots.

**Spendable copper** = counted ingots + banked copper parts + parts IN FLIGHT for a claim − every other live claim's
unplaced parts. **It is a pure function over BOTH records (r9).** A PENDING monument claim counts ZERO when the
monument's `layer_copper[k]` is COBBLE, or when the 24 h pre-open test holds for it; in that second case the admitting
reader first writes the COBBLE itself (first write wins). So a follower that has not yet caught up can never downgrade
a hall or a pavilion at siting, and every reader of the claims set (every admission, make_copper's eligibility) is a
follower. Fixture: a stalled releaser, then a hall siting, which must choose the variant the un-reserved stock allows.
- Raw copper is NOT spendable (§0.1).
- **In flight:** a withdraw made for a claim moves that backing from "banked" to "carried by bot B for claim C" under
  the same fence, recorded with the carry note (design 3.3). This covers parts carried to a build AND the ≤ 36 ingots
  make_copper carries to the table, counted in ingot units. Withdrawing therefore never makes a claim look short. When a
  carry note expires (30 min), the next town deposit banks the items and they count as banked again.

**Admission.**
- A claim is admitted only if 80% of spendable copper, read in the generation it is written in, covers its parts.
- **Claims extend at most one layer ahead.** A ring claim (odd layer) and the next tier's stair claim (even layer) can
  be live together.
- A writer re-reads after publishing; a lost race re-decides on the new generation. (r7: no claim ever voids itself
  after publishing. A monument-layer claim is resolved by the commit protocol below.)
- **Negative decisions:** only the monument's `layer_copper[k]` decides. A COBBLE entry in the claims record is a
  FOLLOWER COPY. A claim writer refuses when `layer_copper[k]` is already set, or when any claims entry for layer k
  exists in any state, so claim → VOID → re-claim cannot churn and a later rise in stock never re-decides a layer.
  Tested with repeated decisions and restarts after stock increases.
- Order: a recorded claim always holds; new claims go in fence order; project siting goes before a monument layer when
  both meet one generation.

**Released:** placed cells; an abandoned project; a decision for cobble; an expired deadline; `ring_shortfall` and
`roof_shortfall`, whose unplaced remainder is released. **A released claim keeps its record.** A shortfall or completed
claim still names the copper cells already placed, so those cells keep reading as copper-done, and only the unplaced
remainder becomes cobble. A restart fixture after a partial copper ring falls back checks both that the cells are still
recognised and that the backing was released.

**"Cannot be covered"** (rule 5 below) is computed exactly like the ledger: fresh, complete counts + banked parts +
in-flight items, minus the other live claims. A count that is stale (past the 6 h freshness window) or incomplete
(unknown containers) is UNKNOWN, and an unknown is never a shortfall. So a freshness lapse or a make_copper run in
progress cannot switch a ring to cobble.

**The read's gate is on the LEDGER**, not on live stock.
- A defect is a claim admitted when its own generation's numbers did not cover it.
- Live under-coverage (counted stock falls on its own: the 6 h freshness window, unknown containers) is REPORTED, never
  gated.

**Fixture:** a hall siting and a monument layer decision race on one generation; a withdraw then a shortfall check mid-way
(with an interruption); a carry-note expiry. No double claim, and no false shortfall.

**The per-layer copper rule for the monument** (pure; it covers rings, stair cells and the apex alike):
1. **When.** The copper cells of layer k are decided **when layer k−1 opens**. These are the ring of a tier's top course
   (k = 2i+1), the 3 stair cells at a tier's foot (k = 2i), and the apex (k = 15). Parts can then be made while layer
   k−1 is built. When crown-01 first records a world, it claims nothing. The claim is PENDING until the monument commits
   it (below).
2. **Copper or cobble.** The layer's copper cells are COPPER if the claim is admitted (above). Otherwise they are
   COBBLESTONE for the whole ring, stair or apex: nothing is claimed, and the non-admission writes a pre-open
   `layer_copper[k] = COBBLE` at once, so a later rise in stock never re-decides the layer.
3. **Hold, not idle.** Claimed cells without parts in hand are HELD (like the cover rule's), and drop out of
   `segmentChoice`'s free set. A builder skips them and its visit ends normally (`monument_nothing_open`). It never waits
   at the site, and held time never counts as a stuck bot (M3) or a stall (M1).
4. **Deadline, anchored at layer k's OWN opening (r5).** Before layer k opens, a claim has no deadline: it is released
   only by "cannot be covered" (above), or by the pre-open release below, never by its own clock. **`opened_at(k)` is
   written by the MONUMENT, in the same generation that advances `layer_open` to k** (a timestamp beside the layer
   index), so no crash can open a layer without it. The same generation STORES the deadline: `deadline_at = opened_at(k) +
   max(6 h, 30 min x make_copper runs still needed at opened_at(k))`. It is never recomputed, so a restarted bot and
   crownread read the same deadline. The deadline is
   always longer than the monument's 1 h nothing-open backoff, and it survives visits, bot changes and restarts. Why this
   matters: layer k−1 can take 4-69 h at the post-shaft funding (zig 2.4), so a clock started at decision time would
   expire most rings before their own layer opened.
   **Pre-open release:** when layer k−1 shows no confirmed placement for 24 h (the record's `last_confirmed_at`), or the
   PENDING claim cannot be covered, any reader writes `layer_copper[k] = COBBLE` **in the MONUMENT record** while
   `layer_open < k`. The claims record then releases the claim (it follows). An admitter that attempts this COBBLE
   re-reads the monument record afterwards: if the opener's COPPER won, that reservation still counts, and spendable is
   recomputed from the re-read before the admission decides. So a stalled monument never reserves a
   town's copper against the hall. (The record's only other state is `complete`, so in practice the 24 h test is the
   whole release.)
5. **On expiry, or when the claim can no longer be covered,** the shortfall writer FIRST acquires the monument's existing
   click lock (the server-ordered placement barrier: a use_item sequence acknowledgement) and SETTLES any outstanding
   click. That is the click lock's own pending-click settlement and world-sync of the layer's copper cells, including
   its recovery for a disconnected clicker. Only then does it write `layer_copper[k].shortfall_at` **in the MONUMENT
   record**, together with the settled set `placed_at_shortfall`. That is the one recorded `ring_shortfall` transition.
   - Because the lock is held, no copper click can cross the transition. The writer uses a lock mode that writes no
     cell record, and a hand the barrier accepts (as `settleMonumentClicks` arranges). If the layer's chunks are not
     loaded, the settled set is UNKNOWN; the writer retries and never writes a shortfall from an unloaded read.
   - The builders' per-click `fence()` re-reads the monument record, so no later click places copper.
   - **At the deadline itself (r9.1):** `fence()` also refuses any copper click once now ≥ `deadline_at` (stored and
     immutable, so every bot agrees), and spendable counts an expired claim's unplaced parts as ZERO. So copper stops,
     and no admission is distorted, exactly at the deadline, even though the `shortfall_at` record may be written later
     (after a 1 h nothing-open backoff, or after a slow but safe click settlement; the barrier is never weakened to meet
     the clock).
   - Cells in `placed_at_shortfall` stay copper; every other cell of the claim is PERMANENTLY cobble.
   - The claims record then releases exactly the unplaced remainder. **Copper never pauses the frontier past
     `deadline_at`**: the cells take cobble from the next visit after it.
6. **Visit source.** `monumentAdmit` gains one: withdraw the claim's cut copper (PROJECT_PARTS), recorded as in flight.
7. **Tests:** interruption and restart across a deadline; a competing project claim mid-layer; a layer whose parts arrive
   in time; the 1 h backoff against a deadline; **a slow layer k−1 that outlasts the old 6 h clock still ends in a copper
   ring**; a stale count during a hold (UNKNOWN, no shortfall); and the commit-protocol fixtures below.

**The commit protocol (r8: every per-layer decision is a monument-record write).** `layer_open` is stored as a world y
(`plan.ys`); layer k means `plan.ys[k]`.

1. **The decisions.** `layer_copper[k]` in the monument record, written under its own `link()` fence, takes these values:
   - unset;
   - `COBBLE`;
   - `COPPER {claim_id, claims_gen, opened_at, deadline_at}`, later possibly with `shortfall_at`.

   **First write wins**, and no writer overwrites an existing value. `shortfall_at` is the one permitted addition to
   COPPER, written once.
2. **Who writes what.**
   - **Pre-open COBBLE** (the 24 h release, or a pending claim that cannot be covered) is written by any reader while
     `layer_open < k`.
   - **At open,** the generation that advances `layer_open` to k writes COPPER if `layer_copper[k]` is unset and the
     claims generation the opener read holds a PENDING claim for layer k. It writes COBBLE if unset and there is none.
     If the value is already set, it keeps it. The COPPER write also records the open layer's census of copper cells
     that are ALREADY filled (reflex pillars, terrain); those cells are done-degraded as the monument rules allow and
     are excluded from crownread's mixed-ring gate.
   - **`shortfall_at`** (rule 5) is added by any reader, on an open layer only.
3. **PENDING.** A claim in `townclaims` is PENDING until the monument writes COPPER naming it.
   - It reserves copper and may drive `make_copper`, whose parts are banked, counted and reversible.
   - **It never authorizes a placement.**
4. **The claims record follows.**
   - Any reader that sees `COBBLE` for layer k VOIDs a pending claim for k and releases its backing.
   - Any reader that sees `shortfall_at` releases the unplaced remainder.
   - Until a reader does so, the claims record over-reserves, but spendable does not (it reads both records, above), so no
     admission is distorted and nothing is double-spent.
   - A claim named by COPPER is never voided.
5. **Builders read the decision fresh.**
   - Held and copper cells come only from `layer_copper[k]` read after the builder's own advance. When crown is enabled,
     the advance loop stops at the first layer it opens, so the next layer is decided when it opens rather than skipped.
     A layer that opens already closed (a backlog) gets a SHORT backoff (2 min), not the 1 h nothing-open backoff, so a
     backlog drains in a few visits and never trips M1.
   - **Decision writers are named:** the advance loop (skills.mjs ~7546 on the monument branch), the visit-end close
     (~7656) and the pre-open COBBLE writer. Each writes gen+1 of the record it read, spreading the latest record exactly
     as `mergeVisit` does.
   - `fence()` re-reads the monument record before every click, so a `shortfall_at` or a COBBLE stops copper at the next
     click.
6. **Pruning.**
   - The claims record is FULL-STATE like the monument record (each generation carries every live and terminal claim,
     including the placed cells of shortfall claims) and is pruned the same way (64 generations). A COPPER pointer
     resolves by `claim_id` in the newest generation; `claims_gen` is kept for audit only.
   - The monument record IS pruned (`KEEP_RECORD_GENS = 64`), but it is full-state: every generation carries all of
     `layer_copper`, so pruning old generations loses no decision.
   - A writer 64 or more generations stale can re-create a pruned number. Its `link()` succeeds, but `fence()` stops its
     placements, and its decisions are first-write-wins against the live record it re-reads.
7. **Fixtures:**
   - (a) a writer reads layer k−1, another bot opens k with COBBLE and places cobble, and then the writer publishes a
     PENDING claim and crashes. The claim is VOID; no mixed ring, no REVERT;
   - (b) a PENDING claim committed COPPER at open is never voided by a later read;
   - (c) an advance and a decision in the same second;
   - (d) a crash right after publishing, with a placement before the publisher resumes;
   - (e) a restart between opening and the first placement;
   - (f) **a pre-open COBBLE release racing the open, with a stalled releaser and an immediate competing hall
     admission.** First write wins in the monument record. Either outcome is consistent, and copper is never both
     committed and released;
   - (g) a `shortfall_at` landing mid-visit stops copper placements at the next click;
   - (h) a two-layer backlog drains within N visits, without M1;
   - (i) **a builder paused after sending a copper click and before its acknowledgement, while a shortfall and a
     competing hall admission run, then resumed.** The shortfall waits for the click lock; the settled cell is in
     `placed_at_shortfall` or is not placed. The same again with the clicker disconnected (the click lock's recovery
     settles first).

**Lightning rods: none in v1 (r3).** The owner's ask is kept as open decision O9.
- **The strike.** A Java rod that is the highest block in its column redirects strikes from a 128-block sphere
  (minecraft.wiki).
- **Entities.** The strike damages entities in a box ±3 horizontally (−3 / +9 vertically).
- **Fire.** On Normal and Hard a strike tries 4 extra fire placements around it. Vanilla `LightningBolt.tick` skips
  those on Peaceful and Easy, but each flash still calls `spawnFire(0)` at the strike cell (decompiled vanilla source,
  version unstated; Paper 1.21.8 to be verified).
- **The rule a rod must meet:**
  - no flammable block within 1;
  - **no stand, walkway or terrace cell within 3 horizontally and 3 below.**
- **Where that leaves no site:**
  - the pavilion (wood; its pad);
  - the hall terrace (a walkway);
  - **the monument apex.** Tier 7 is 6x6 on tier 6's 12x12, so every apex cell is within 3 of tier 6's terrace and the
    grand stair, whose feet (layer 14) lie within the box of a rod at 16.
- **What a rod needs.** A spire about 3 blocks high on the apex, so that rod_y − 3 clears every stand within 3. That
  needs placements above a stand's reach (a pillar-up primitive) which v1 does not have.
- **Copper cost:** 3 ingots a rod, so dropping rods changes nothing in the copper balance.
- **No safety benefit is claimed for a rod** (§1.5): an attracted strike is a hazard to anything within 3.

### 3.3 How fast the stock drains

**Today, shared towns:** ≈ 9.0k copper-equivalent. **The days below use the FLEET-WIDE income** (470-570 a day,
isolated pools included), so they are a lower bound. At an even-banking shared share (≈ 350-430 a day, an assumption;
§1.2), the total is ≈ 92-114 days.

| program (12 shared towns) | ingots | days of income at 470 / 570 |
|---|---:|---:|
| pavilion-01 everywhere | 3,888 | 8.3 / 6.8 |
| + crown apex and the stair cells still open | + ≤ 6,480 | + ≤ 13.8 / 11.4 |
| + hall M everywhere (+ grates) | + 7,344 | + 15.6 / 12.9 |
| + crown rings, tiers 4-6, everywhere | + 22,032 | + 46.9 / 38.7 |
| + spyglasses | + 24 | + 0.1 / 0.0 |
| **all of it** | **≈ 39.8k** | **≈ 85 / 70 days** |

The calendar, illustratively (none of these dates is a commitment):
- **Before the pavilion.** Ten canaries are ahead of pavilion-01. Tier 2 takes ≈ 6 h with the cool-off and tier 3
  takes 1-2 days. That puts pavilion-01 ≈ 2-4 weeks away, with shared copper-equivalent then ≈ 9k + (350-430) x 14-28
  days ≈ **14-21k** at the assumed shared share (≈ 16-25k is the fleet-income upper scenario: 9k + 470 x 14 to 9k + 570 x 28).
- **The rings.** The monument's tier 4 opens at layer 8 (its ring at layer 9). At the fast end of zig's 1-10 weeks,
  the frontier may pass layer 8 before crown-01 ships; those rings stay cobble. Tiers 0-3 hold 12,528 of the 14,688
  cells (85%), so that is 1-10 weeks per world (zig 2.4).
- **The forecast.** The pavilions, halls, stair cells and apex take ≈ 17.7k. Only the crown's rings use copper at about
  the income rate. The stock stops rising only while rings are being placed, and a finite bill of materials cannot
  promise when that ends.
- **What storing it costs.** 5,695 ingots fill 89 slots. Compaction is storage, not use, so it is not planned.

**If the owner wants copper used sooner** (O3), there are two floors on offer, neither planned:
- the pavilion's pad in copper blocks instead of cobble (+567 per town);
- a copper yard pad.

---

## 4. The stages

**Common to every stage:**
- **Canaries:** design §7 (DiD against randomized control pools; end-to-end exposure; deadline -> INCONCLUSIVE;
  two-death floor), and the owner's 10-19 tiers.
- **Holds:** design 3.3 (parts in PROTECTED and NEVER_DISPOSE).
- **Admission:** design 3.2 over ONE claim set (3.2 above). Copper and iron are UPGRADES with a fallback variant, never a
  precondition: no town waits for a metal.
- **Builder:** builder.mjs, one builder, never a second.
- **Siting:** the town siting lease and `townsites-<home>` (design 3.4).

**Composition: the neighbours every stage meets.** This is the CLAUDE.md "local policy composition creates a dead end"
class. Each stage says what it adds.

| neighbour | where it acts | the rule |
|---|---|---|
| **plinth wells** (plinth-02, plinth-first) | caps at Chebyshev ≤ 14, stairs to ≈ 20, record incl. `prev[]` | plinth plan and prev cells + 1 are occupied for siting. No structure is placed inside 21, which leaves room for a re-site |
| **the farm** (treefarm-02) | anchors on rings 9-22, plots ≤ 30 from home, 3-wide walkways, its shared record, mine's stair forbid | farm cells, walkways, and every sapling or tree + 3 are occupied. A structure is sited after the farm record exists, and re-reads it at every visit |
| **the town floor** (townfloor-01) | places only within Chebyshev 16 of home, at ≤ L | meets design 3.4's "floor domain declared inside 21". Outer-domain structures (≥ 22) never overlap it |
| **the town no-dig zone** (townzone-01) | Chebyshev 16; refuses discretionary digs of town ground | it protects the floor. Structures at ≥ 22 are protected by structureguard instead. Builder digs are vegetation (class `structure`) plus fenced YIELDS of its own placed cells (rule (c) under lidclear) |
| **lidclear** (lidclear-01) | digs a cobblestone lid off a town chest so it can be counted | **(a) prevention, from stage 2:** every container- and station-placement path (`place`, full-town recovery's new chest, station placement as in wellcare's `stationKeepOut`) refuses a reserved structure cell AND the cell directly below one, the lid-clearance volume. **(b) The storehouse (stage 6, inside the cylinder)** never places a cell directly above a container, re-checked at every placement. **At ≥ 22** (pavilion, hall, monument) a cell over a chest IS placed, the chest is capped and reported (`_capped_container`), exactly as the monument's rule (d) does, so a project there never waits on a chest. **(c) Which conflicts matter (r4).** Only a container inside the 16-block storage cylinder is a TOWN container: counted, a lid that lidclear clears, a key in cobblecap's completeness set. A chest under a structure at ≥ 22 (pavilion, hall, monument) is not a town container, and no count depends on it, so it is reported (`_capped_container`) and left alone. **Inside the cylinder** (only the storehouse, stage 6): `lidJudge` tests "is the lid a reserved structure cell?" FIRST, before LID_BREAKABLE (today a non-cobble lid returns a plain `refused`, skills.mjs lidJudge), and emits `_lid_reserved` without digging. lidclear's reserved test returns `refused`. That marks the chest `unavailable` in town memory, and full-town recovery takes its far branch: it skips the chest for 30 min (`FAR_SKIP_MS`) and never builds a chest (skills.mjs ~3803), so a builder whose deposit targets a capped chest at the monument just moves on. Only a `_lid_reserved` row whose cell belongs to the STOREHOUSE's own record is a YIELD order, eligible even for a complete storehouse (one yield visit); a monument cover cell is never yielded (the cover rule needs it). The yield rules: (i) its authority is a fenced YIELD LIST: cells with a live `_lid_reserved` order whose container still stands; (ii) **every storehouse cell that can have air below it is a non-walkway roof cell, which the planner proves YIELDABLE** (it refuses an inner-domain blueprint otherwise), re-validated against the world before the dig; (iii) the yielding bot holds a pickaxe, and the drop is booked in the bag-delta and conservation gates; (iv) a yielded cell is recorded and never re-placed, so the chest opens and nothing churns. No container is ever "retired" (r4 drops it: no change to cobblecap's completeness or stock semantics). **(d) The monument** (≥ 25 from home) follows its cover rule: a container on the open layer is a non-full cell, and its cover IS placed. It is outside the 16-block storage cylinder, so no count depends on it; it is reported `_monument_capped_container`. Full-town recovery places chests in rings 1-4 around a town chest (≤ 20 from home); (a) keeps them out of reserved cells |
| **the mine keep-out** (minewell's planMineStart: the well `cols` plus a composeKeepOut of town and farm; structureguard adds recorded structures) | every `mine` plan and per-dig stop; gather; the ore tunnel | every structure record joins composeKeepOut and the relocation's standable test. The relocation never stands in a structure cell, and the walk-off (`exitCell`) is the executable remedy |

### 4.1 Stage 2 — structureguard-01, inside the monument-01 rebuild (FIRST of 2-8)

**What it builds:**
- **No blocks.** It is the dig guard over RECORDED structures: the monument now; the shaft, pavilion and hall records as
  they ship. It acts at mine's plan and per-dig stop, gather's search and dig, room vetoes, and the ore tunnel's
  candidates, route price and dig boundary.
- **builder.mjs / buildbot.mjs** supply the fenced placement executor that every later stage reuses.
- **Both are built** (eb407fa0) and approved (Codex r4, Claude r5). The work is the REBASE, plus the four changes below,
  each reviewed by both engines.

**The four changes:**
1. **Compose with the fleet's planMineStart** (minewell's code, from wellcare-01). The guard becomes one more
   composeKeepOut part beside town and farm (treefarm-02 if KEPT first). Test: each part alone, and all together,
   refuse exactly their own cells, with the mutant where one part shadows another.
2. **lidclear** (new since eb407fa0). `clearChestLid` digs with `dig(…, 'ignore')` and is not covered by structureguard's
   pathfinder-dig hooks (eb407fa0 guards forceLook mining digs). The reserved-cell test therefore goes FIRST in
   `lidJudge`, which emits `_lid_reserved` and never digs (rule (c); the yield ships with stage 6, the only project inside
   the storage cylinder).
3. **Placement prevention:** rule (a) above.
4. **plinth-first** (new since eb407fa0). Its re-site search reads the monument record as occupied, as treefarm-02's
   variant (tf-on-adbec4f, 0b3a0d4c) does for the farm. That holds on the fleet only once treefarm-02 is KEPT.

**Reflex exemptions are unchanged.** Transit and survival digs may cut the monument (zig 3.6); damage is absorbed, never
reworked. The guard refuses TARGET digs only, and mine's walk-off is the executable remedy, so no refusal leaves a bot
without a legal move.

**Materials:**
- **The guard:** none.
- **monument-01:** ≈ 14.7k cobble and stone-family per world (Z0: 13.4-18.6k with foundation), at ≈ 100-440
  placements per world-hour of exposure, funded at ≈ 0.6-2.5k per world-day (zig 2.4).
- **Against:** 862 chest cobble (median shared town, at the cap) plus the bag surplus.
- **Order of limits:** funding binds before labour.

**Bot behaviour:**
- **Guard:** nothing new.
- **monument-01:** as approved (build_monument visits, the frontier with the cover rule, segment slots, and the well
  yield only on a monument lap).

**Paper** (sandbox4, under the lock, on the rebased sha):
- **monument r8:** build12, stand12, kill12, cost48;
- **structureguard:** mine, gather, offmon, tunnel;
- **COMPOSE (new):** a mine start next to a well shell, town ground, a farm plot and a monument record plans a bearing
  that avoids all four, or walks off once. 0 reserved cells are dug;
- **LIDRES-2 (new):** a chest whose lid is a reserved cell. lidclear reports and does not dig, and `place` refuses a
  chest under a reserved cell;
- **CAPPED (new):** a chest on the monument's open layer. The cover is placed, the frontier advances, and
  `_monument_capped_container` is written.

**Read:** monumentread, as registered, plus the guard rows.
- **REVERT:** M1 (stall), M2 (slow gate), M5 (a guard refusal outside the site).
- **Block KEEP:** M3 (stuck near the site), M4 (gather regression), M6 (waived cells), any control `_monument` row.
- **Added:** a lidclear dig of a reserved cell is a defect; `_lid_reserved` and capped containers are reported.

**Tier 3** (as monument-01).

### 4.2 Stage 3 — pavilion-01 (NEW; replaces yard-01 as the first project) (SECOND of 2-8)

**What it builds:** `pavilion@1`, an open-sided hall in the OUTER domain (Chebyshev ≥ 22 from home and straight-line
≤ 44, for every cell and stand; design 3.4), built by TERRACED construction (design 4.0).

| part | cells | material | how placed |
|---|---:|---|---|
| pad 9x7 at s | 63 | cobblestone | top faces on the ground (the layer fill) |
| step ring at s+1 (the pad's outer ring, 1 gap at each door) | 26 | cobblestone | top faces, from the pad |
| walls 7x5, 2 high, 2 opposite 1x2 doorways | 36 | **oak logs** (axis y: top-face clicks only) | from the pad (s+1, s+2) |
| roof 7x5 at s+3 | 35 | **cut copper** (or oak planks, 9 logs, if copper does not allocate) | (below) |
| light | 2 | torches on the pad inside | |
| **total** | **160 cells, 162 placements** | **89 cobble, 36 logs, 35 cut copper (36 blocks = 324 ingots), 1 coal + 1 stick** | |

**The roof sequence**, proven offline cell by cell before siting (design 4.0's gate):
1. **Edge cells over walls.** Each is placed on its wall top's face (s+3) from a RING stand (feet s+2, eye s+3.62).
2. **The two cells over the doorways.** There is no wall top under them. Each is BRIDGED: placed against the side face
   of an adjacent, already-placed roof edge cell, from the ring stand beside the doorway gap or from the pad inside. The
   proof checks reach (≤ 4.5 to the face centre), sight line and walk-back for both.
3. **Inner cells.** These go inward, each against the side face of a placed roof neighbour, from pad stands inside
   (eye s+2.62, looking up through the open target cell). This is the pattern the r2 probe proved on the hall's 9x7
   (28 + 35).

**Shape:**
- **Why this shape.** It is the smallest roofed building, so it proves ring stands, roof edges from the ring, the
  doorway bridge, and inner cells from below. It has no containers (nothing to count, deposit into or lid-block), no
  stations and no roof access.
- **Falls.**
  - The ring is a permanent terrace: feet s+2 on the ring, s on the ground outside, so the drop is 2.
  - The roof edge to the ring is also 2.
  - The planner measures drops against the actual terrain outside the ring. An edge whose drop exceeds 3 gets a guard
    cell, or the site is refused.
- **No lightning rod** (3.2).

**Materials per town** (built once, within about a day once sited):

| material | uses | stock (median shared town, observed) | income |
|---|---:|---:|---|
| cobble | 89 | 862 + bags | at the cap |
| logs | 36 | 385 | ≈ 75 a day fleet average |
| copper | 324 ingots | 452 ingots + 169 raw | ≈ 470-570 a day fleet; per town unmeasured |

Admission at 80% needs 405 SPENDABLE copper: ingots + banked parts, raw excluded (§3.2).
- **At today's stock, 7 of 12 shared towns qualify:** board-c, board-d, hive-a, hive-b, hive-d, placebo-c, placebo-d.
- **board-a (328), hive-c (384), placebo-a (339), board-b (200) and placebo-b (81) do not.** board-a (844 raw, a no-coal
  town) is the one smeltfuel-01 lifts toward it; hive-c is not a no-coal town (it smelted 114 in 24 h).
- No date is promised. A town that does not qualify at siting builds the **plank roof** (no town waits; O4).
- **The roof parts wait is bounded.** A sited copper roof whose parts are not made within 24 h of the walls completing
  switches its unplaced roof cells to planks, recorded `roof_shortfall` (the ring rule's pattern). So no shell stands
  roofless for the 72 h stall. Only the project's build-lease holder writes `roof_shortfall`, after settling its own
  outstanding click and under `fence()`; pavilionread treats cells confirmed before the transition as on-plan.

**Bot behaviour (new):**
1. **`make_copper`** (3.1).
2. **`build` for a roofed plan.** builder.mjs gains RING STANDS (feet s+2) with the walk-up from pad to ring (each step
   +1), the roof sequence above, and the roof-parts deadline. (The YIELD is a stage-6 behaviour, rule (c).)
3. **`survey`** (design §5).
4. **Siting against the plinth, farm, monument and shaft records** plus the pad's own keep-outs: trees and saplings + 3,
   liquid + 1, containers + 1, a 1-cell ring; 8 from the monument apron and the shaft collar (zig 3.2).
5. **`PROJECT_COUNTED`** (design 3.3a: raw_copper, copper_ingot, copper_block, cut_copper, coal, iron, raw iron, logs).
6. **The project record, leases and states** (design 3.1-3.2, WIP 1).

**Refusal chain** (design 3.5, unchanged; tested as a chain through the real CognitiveLoop):

| finds | next step |
|---|---|
| no room | skip |
| copper short at siting | plank variant |
| parts not yet made | checked at admission with no walk (like the monument hold): no visit is issued for roof cells without parts; make_copper is eligible; after 24 h, planks (`roof_shortfall`) |
| lease held | free skip |
| unknown cell | survey |
| blocked cell | stall 72 h -> abandon -> re-site (twice) -> skip |
| a chest under a cell | not a town container at ≥ 22: the cell is placed, the chest capped and reported `_capped_container` |

**Composition, beyond the neighbours:**
- **The monument's apron is the big one:** 52 x 52 at Chebyshev ≥ 25, in the same outer band. The pavilion is sited
  after the monument record exists.
- **The shaft collar** (17-21) and its surface terminus (v ≤ −2) are occupied.
- **A bot inside when the roof closes** leaves by a doorway: `wouldEnclose` is checked before every solid placement.
- **A bot in a wall cell:** the cell is skipped while any entity box touches it or the cell above (zig 3.3).
- **Entombment.** The walls are 2 high with 2 open doorways. Chain test: the entombment reflex, fired against a pavilion
  wall, exits by a doorway with 0 digs.

**Offline gate P0 (before any code).** The siting predicate runs on read-only region copies of the 12 shared worlds,
with the farm, monument (Z0 site) and shaft (M0 collar) reservations in place. It reports n/12 with a site. A canary
pool is drawn only from towns that have one.

**Paper** (sandbox, the real bot, RCON as oracle):
1. **FLAT:** the full build, every cell read in family.
2. **TOWN:** two fixtures cut from real dug-out region files (board-a, hive-c).
3. **INTERRUPT:** a stop at every placement, a SIGKILL and resume; rebuilt complete from the world.
4. **BYSTANDER:** one bot in a wall cell, one inside at roof close.
5. **DOORWAY:** both bridged doorway cells placed, with their sight lines asserted.
6. **OXIDISED:** a pre-placed `weathered_cut_copper` roof cell reads as done and is not re-placed.
7. **LIDRES-3:** a chest forced under an unplaced roof cell: the cell is placed, the chest is capped and reported
   `_capped_container`, and the project completes. The town count is unaffected (positive control: a town chest's count
   in the same scene). A deposit that targets the capped chest is `refused` and moves on.
8. **SHORTFALL:** a roof whose parts never come (a time-compressed 24 h) switches its unplaced cells to planks
   (`roof_shortfall`) and releases its claim.
9. **CRAFT:** make_copper's 9 -> 1 and 4 -> 4 and the spyglass, by server bag deltas, with exact conservation.
10. **ENTOMB:** the reflex against a wall exits by the doorway.

**Read (`pavilionread`):**
- **Exposure:** ≥ 1 pavilion complete (RCON reads all 160 cells in family, yielded cells excepted) in a canary town,
  plus ≥ 1 make_copper craft with exact conservation.
- **REVERT gates** (as design §7 row 3, plus):
  - an off-plan placement;
  - overlapping builders;
  - a builder dig outside the clear list and yields;
  - two projects in one town;
  - builder bag delta ≠ confirmed placements + scaffold, reflex-pillar and rescue placements;
  - a copper conservation mismatch;
  - a placement above a TOWN container (inside the storage cylinder);
  - a lidclear dig of a reserved cell;
  - a roof stand next to an unguarded edge.
- **Block KEEP:** any control `_project_place` row.
- **Primary (reported):** copper consumed per canary town; time to complete; builder body time per bot-h; gather and
  rung completions DiD; immobile DiD; deaths (two-death floor).

**Tier 3.**

### 4.3 Stage 4 — crown-01: the monument's copper crown (NEW)

- **What it builds:** a `trim` cell role (family copper | cobble) for the stair cells and ring cells of layers not yet
  open, and the apex layer. No rod (§3.2, O9). All of it follows the per-layer rule (3.2) and is placed by the monument's own visits
  with the proven top-face layer fill.
- **Materials per world:**

  | part | ingots | depends on |
  |---|---:|---|
  | stair cells | ≤ 216 | the frontier at ship time |
  | apex | 324 | — |
  | rings | 0-1,836 in practice (≤ 7,308) | the frontier at ship time |

  They are drawn as layers open, against ≈ 500 a day fleet income.
- **Behaviour:**
  - make_copper (stage 3) gains the monument as a client;
  - `monumentAdmit` gains the cut-copper withdraw source;
  - the per-layer decision, the hold, the deadline in the claim, and the `ring_shortfall` transition;
  - the town claim set (§3.2).
- **Safety:**
  - copper never blocks the frontier;
  - stair cells keep the place exclusion (zig 3.6).
- **Paper:**
  - a 12-wide S=3 ziggurat (the stage-3 zig scene): one ring decided copper and one cobble, by changing the counted
    stock between layer-opens;
  - a ring whose parts are late: visits skip the held cells and end; the parts arrive; the ring completes copper before
    its deadline;
  - a ring past its deadline, with a restart in between: it finishes in cobble, `ring_shortfall`, no stall;
  - a competing project claim mid-ring, and a simultaneous-admission race on one claim generation;
  - the waived-cell cover rule re-run with a copper ring.
- **Read (crownread).**
  - **Exposure:** ≥ 1 ring decided and complete.
  - **REVERT on:**
    - a copper confirm after `deadline_at` (a valid pre-deadline hold is NOT a stall, and M1 excludes held time);
    - a held cell on an open layer with no stored `deadline_at`;
    - a mixed ring or apex without its one recorded `ring_shortfall` transition;
    - any other change to a recorded decision (a reversal; a second transition);
    - a copper conservation mismatch;
    - a claim admitted when its own generation did not cover it (the ledger gate; live under-coverage is reported).
- **Draw.** Every layer is a stair or a ring layer, so "near a copper layer" filters nothing. **The copper test is
  the filter.**
  - A world is drawn only if its spendable copper is ≥ 1.25 x the next ring's parts, so the canary can be exposed
    rather than decide cobble everywhere.
  - Spendable needed to admit the next ring (parts ÷ 0.8):

    | tier | 0 | 1 | 2 | 3 | 4 | 5 | 6 |
    |---|---:|---:|---:|---:|---:|---:|---:|
    | spendable needed | 2,115 | 1,845 | 1,575 | 1,305 | 1,035 | 765 | 495 |

  - At today's stock, no town admits a ring below tier 6.
  - **If no world qualifies when crown-01 reaches the head,** it is PARKED: the queue owner cancels it and re-queues it
    later. Unparked, it WOULD block hall-01 until a human cancels it, because the scheduler never skips the head.
    Parking is likely: by the time crown ships, a town holds roughly 1.1k against the 1,035-2,115 a ring needs.
- **Tier 3**, with reads extended until exposed.

### 4.4 Stage 5 — hall-01 (D1, the landmark; design 4.3's shape)

- **What it builds:** an 11x9 pad; a stone-brick podium ring and walls; oak-log corner pillars; a walkable cut-copper
  roof terrace at s+3; a 1-block stair; a stone-brick-wall parapet; 6 lanterns; 4 copper-grate windows (O5).
- **Changed from D1: no lightning rod** (3.2; O9).
- **Materials (M):** 207 cobble (108 smelted to bricks), 576 copper roof + 36 grates, 8 logs, and **6 iron** (lanterns
  only, with grates in place of bars). With bars it would be 12. The pavilion leaves no iron spares.
  - Copper variants (roof + grates): S 360, M 612, L 936, so 450 / 765 / 1,170 at 80% of SPENDABLE copper (raw
    excluded).
- **Admission is re-read at siting**, weeks after today. The pavilion's copper is placed (consumed) by then, not
  claimed. The monument's claims extend at most one layer ahead: a ring (92 blocks for tier 4, up to 188 for tier 0)
  plus possibly the next tier's 3 stair cells. On 10-19's ingots,
  with no other claim live: 0 towns allocate L, 0 M, 6 S (≥ 450: board-c, board-d, hive-a, hive-b, hive-d, placebo-d),
  6 none. After a pavilion (−324), none of today's towns allocates S. This is illustrative, not a date.
  - **No town waits for a metal: the ZERO-COPPER hall (NEW in this plan;** the copper analogue of design 12.2's
    zero-iron hall). The roof terrace is 63 stone bricks, and the 4 window cells are filled with FULL `stone_bricks`
    blocks (as design 12.2's zero-iron hall fills them), not `stone_brick_wall` items. The parapet's 27 walls stay as in
    design 4.3 (30 bricks -> 30 walls, 3 spare). (Both r9 reviewers read the windows as wall items and got 177 -> 180
    bricks; with full blocks the count is 175 -> 176.)
  - Zero-copper BOM (M): bricks 108 + 63 + 4 = 175, made in 4-brick crafts, so **176 bricks (176 cobble smelted, 22
    coal, 1 spare brick)**, plus the 99-cobble pad: **275 cobble**; 8 logs; 6 iron (lanterns).
  - Its bricks come from `make_part` AFTER siting, as all the hall's bricks do in the design (§5: the active project's
    allocation makes `make_part` eligible), under the stage-1 furnace lease.
  - **Its roof wait is bounded the same way:** 24 h after the walls complete, any unplaced roof cell switches to
    COBBLESTONE, which needs no furnace (`roof_shortfall`). The ROOF never waits on a furnace. The walls' 108 bricks
    still need furnace time and coal; they are bounded by design 3.5's stall rule (72 h, then abandon, re-site twice,
    skip), and `make_part`'s fuel withdraw uses smeltfuel-01's coal sweep.
  - A town that later wants the copper roof gets it only with a new hall, never by a retrofit.
  - The hall picks the largest variant that allocates.
  - **The copper roof's parts wait is bounded** as the pavilion's is: after 24 h the unplaced roof cells switch to
    COBBLESTONE, which needs no furnace, recorded `roof_shortfall`, and the claim's remainder is released.
- **Behaviour (as designed):**
  - `make_part` for stone bricks (a furnace session under the stage-1 furnace lease) and copper;
  - the roof terrace reached by the plan's stair;
  - the parapet placed from the roof, the fleet's first placements made from a roof;
  - lanterns via nuggets.
- **Safety:** design 4.0's stand margin on the terrace, and the parapet first.
- **Paper:** design §9's, plus:
  - a ZERO-COPPER completion scene that starts from ZERO banked bricks and runs through the real job selector (`make_part`
    eligibility from the allocation), not a preloaded scene;
  - a `roof_shortfall` scene (time-compressed 24 h, cobble fallback).
- **Read:** design §7 row 6, plus stage 3's copper and lid gates.
- **Tier 3.**

### 4.5 Stage 6 — storehouse-01 (CONDITIONAL)

- **Shape:** design 4.2's. Log-and-cobble walls, 18 barrels, in the INNER domain. The roof is oak planks (a log sink;
  O6).
- **Needs:** the shared siting file, adopted by plinth and the floor job (design 3.4). Lid rule (b) and (c) matter most
  here.
- **Trigger:** observed slot fill > 60%, or ≥ 3 full-town deposit refusals in 12 h in ≥ 2 towns. Neither holds today
  (§1.4).
- **Tier 3.**

### 4.6 Stage 7 — projectdemand-01 (CONDITIONAL)

Only if stages 3-6 stall on `town_short:<group>` (design 3.3, §7 row 7). **Tier 2.**

### 4.7 Stage 8 — rails (GATED; design 12.7 unchanged)

- **R0:** a telemetry-only goto instrument and a measured saving. **Tier 2.**
- **R0b:** a Paper riding proof.
- **R1:** lanes on 2-wide stub continuations, with u=1 a reserved walking lane. **Tier 3.**
- **Timing:** after **shaftuse-01** is KEPT, because routing is what puts bots on landings.
- **Iron:** cap rails at 1 landing per town (29 iron) until R1 reads a saving. A full shaft takes 175-205 iron, the
  whole stock of a median town (184 observed).
- **Before R1, owner decision O11:** `rail` is on the owner's junk list (well.mjs `OWNER_JUNK_1004`), so any rail a bot
  carries goes down the well. Either it leaves the list, or R1 crafts rails only inside the placing skill.

---

## 5. Logs (logcap: chests bank up to 4,000 per type per town)

**Stock and flow:**
- ≥ 11,836 observed;
- median 385 per shared town in town, max 1,229 (board-b);
- ≈ 900 a day banked fleet-wide, ≈ 140 a day crafted;
- no shared town is near 4,000 of a type.

**Room:**
- ≈ 900 logs a day is ≈ 14 slots a day, ≈ 0.5 chest a day fleet-wide, inside the new-chest budget (4 a day, 12
  standing).
- If the logs are shared equally (≈ 75 a day per town), the fullest town (board-b) reaches 2,000 oak in ≈ 10 days and
  4,000 in ≈ 5 weeks. The trend is unknown (§1.3), so these times are a bound to watch, not a forecast.

**What this plan spends:**
- pavilion 36 (+ 9 for a plank roof);
- hall 8;
- shaft ladders ≈ 33 per shaft;
- storehouse 52.

That is under 150 per town.

**Recommendation: no log project now** (O7). Wood is renewable, logs are not junk, and chests have room. Revisit when
any town reaches 2,000 of a type, or observed slot fill passes 60%. The candidates then:
- **(a)** a log palisade on the outer domain's boundary, with gates: ≈ 350 logs per town, the layer fill again;
- **(b)** charcoal fuel for `smelt_town`, which revisits D4: ≈ 84 logs a day fleet;
- **(c)** more plank roofs.

---

## 6. Rails between town and the mineshaft (considered)

**Not an iron sink.**
- Net iron inflow is ≈ +50 a day.
- A median shared town holds 184 observed units.
- A full rail fit-out (175-205 per town) would take a whole town's iron, against the ladder's 30-unit reserve and the
  iron-pickaxe demand.

**Not a safety fix today.**
- The shaft's vertical travel is ladders (zig 4.1).
- The surface leg is 17-21 blocks.
- The deaths are underground: lava 78 and drowning 98 in 7 days. A rail lane changes neither.
- The safety gain is the shaft plus routing (shaftuse-01).

**Kept as stage 8, gated** (4.7).

## 7. Sorting hoppers and storage (considered)

- **No item sorter.** The vanilla self-emptying sorter needs a comparator, which needs nether quartz. There is none in
  the observed containers; that shows absence in those only.
- **The decisive reason is independent of quartz:** any hopper flow inside the 16-block town-storage cylinder makes the
  count journal disagree with the world (design 12.0).
- **Hoppers** remain only in the deferred workshop's H2 line.
- **Storage** is not short (§1.4).

---

## 8. Open owner decisions

| # | decision | recommendation |
|---|---|---|
| **O1** | Defer yard-01 and workshop-01 (blast furnaces, H2 hoppers), provisionally, with the reopening triggers in §0.2, and build pavilion-01 as the first project. This changes the timing of D6/D7 | **yes** |
| **O2** | shaftuse-01 (not built) takes the first free slot once approved; it never blocks the head | **yes** |
| **O3** | Copper used sooner as floors (copper pad +567 per town) | **no**: the owner said trim and roofs |
| **O4** | A town short of copper builds the pavilion with a plank roof rather than wait | **plank roof** |
| **O5** | Hall windows: copper grates (36 ingots) instead of iron bars (6 iron) | **copper grates** (iron is the scarcer metal now) |
| **O6** | Storehouse roof: planks or cut copper | **planks** (logs need sinks too) |
| **O7** | Logs: no project now; revisit at 2,000 of a type per town or 60% slot fill | **yes** |
| **O8** | Spyglass: 1 per shared town, once, banked as keepsake stock (24 ingots, 12 of 22 shards); the bots cannot use it | **yes, bounded**, as the owner asked; say "skip" to drop it |
| **O9** | Lightning rods: **none in v1** (no site meets "nothing burns within 1, nobody stands within 3": not the pavilion, the hall terrace or the monument apex); a rod waits for an apex spire primitive. This drops D1's hall rod | **yes**; say so if the owner prefers a rod with the strike risk named |
| **O10** | smeltfuel-01 (tier 2), ordered before pavilion-01: a bounded fuel sweep that ignores the copper-miss memory (479 "no coal" rows in 24 h in towns whose observed chests hold coal) | **yes**; raw copper is not spendable for parts until it is smelted |
| **O11** | `rail` on the owner's junk list: take it off before R1, or craft rails only inside the placing skill | decide at R0b |

---

## 9. Reviews

### Round 1 (r1): Codex CHANGE, Claude CHANGE. Both: FIRST TWO STAGES AGREE; ORDER DISAGREE.

**Codex r1:**
- P2 x6:
  - the crown promised stair cells already built, and its deadline could not jump pavilion's make_copper;
  - `_lid_reserved` was a refusal without recovery, and chest placement after siting was not covered;
  - the doorway roof cells have no wall tops;
  - the denominators: a census subset, per-town figures that were fleet averages, smelting not raising
    copper-equivalent, logs at 37 days not two months;
  - the yard deferral overclaimed;
  - lightning needed difficulty-specific evidence.
- P3 x2: arithmetic (raw median 169, coal 181.5, 162 placements, hall iron 12 without spares, ring double count);
  spyglass vs the owner's direction.
- Order: the r1 order without the crown queue-jump.

**Claude r1:**
- P2 x6:
  - the order must start from the owner's 10-19 list (brain-01, cobble-in-bags, toolkit-03, bamboo-03 were missing),
    with shaftuse-01 never blocking the head;
  - the crown deadline vs make_copper;
  - copper double-counted across the monument and project lanes;
  - the ring's "parts run short" trigger undefined, and monumentAdmit needed a new source;
  - the deferral evidence (`furnace_busy` lives inside no_effect detail; break the rows down; iron no longer a
    surplus);
  - the monument's cover rule vs "no cell above a container" (a permanent frontier stop).
- P3:
  - 162 placements; the ring drop is 2; 127 placements; the tier 4-6 ring count;
  - O5 iron; hall 3 L / 1 M;
  - the iron window straddles toolkit-02;
  - raw copper runs out in ≈ 17 days;
  - stair cells already built; logs in ≈ 10 days to 2,000;
  - Peaceful skips the 4 ignitions;
  - `rail` is in OWNER_JUNK_1004;
  - the townfloor row; LIDRES realism; the forbid wording; conservation with rods.
- Order: the owner's list, then pavilion -> crown -> hall -> conditional -> rails.

**All findings taken in r2. Nothing rejected.**

| finding | r2 |
|---|---|
| order | §0.4 copies the owner's list exactly, then stages 2-8; shaftuse-01 is a first-free-slot item (O2) |
| crown deadline and the stair cells | deadline removed; the crown decorates only unopened layers, tier 2 after stage 3 (§3.2, §4.3) |
| one allocation; shortfall; visit source | ONE claim set across lanes; shortfall on the allocation; ring last in its layer; a bounded 2 h wait; `ring_shortfall`; monumentAdmit's cut-copper source (§3.2) |
| lid | (a) placement prevention from stage 2, (b) projects never cap a container, (c) the yield restores access, (d) the monument's cover caps a non-town container and reports it (§4 table); LIDRES-2/3 and CAPPED scenes |
| doorway cells | bridged from adjacent roof edges, proven offline, DOORWAY scene (§4.2) |
| denominators | observed-subset labels; per-pool smelt figures; copper-equivalent income 470-570 a day; no qualification dates; the iron window's toolkit overlap stated; log timing ≈ 10 days / 5 weeks as a bound (§1, §3.3, §5) |
| deferral | the no_effect / failed breakdown (0 busy; 479 no coal); iron no longer a surplus; reopening triggers; provisional (§0.2, §1.2) |
| lightning | Peaceful / Easy skip the 4 ignitions (decompiled vanilla, version unstated), `spawnFire(0)` at the strike cell, the entity box; the rule "nothing burns within 1, nobody stands within 3"; no safety claim; a Paper storm scene; no rod on the hall (O9) |
| arithmetic | medians, 162 placements, 2-block drops, 127, hall variants, iron 6 / 12, 204-cell rings, conservation with rods and spyglasses |
| spyglass | a bounded craft, as the owner asked (O8) |
| rails junk | O11 |
| new finding (r2's breakdown) | smelt_town's fuel search misses town coal: O10 smeltfuel-01 |

### Round 2 (r2): Codex CHANGE, Claude CHANGE. Codex ORDER AGREE; Claude ORDER DISAGREE (smeltfuel-01 before pavilion-01). Both FIRST TWO STAGES AGREE.

**Codex r2:**
- Resolved: the crown timing, the doorway, the denominators, the deferral, the spyglass, the order and the owner list.
- Partial: lid recovery, lightning, the arithmetic.
- New P2 x4:
  - the shared claim model left out the apex, the stairs, the rod and recipe rounding, and had no single fence;
  - the 2 h wait was per visit, so it could reset forever;
  - YIELD had no geometry validation;
  - the apex violates the rod rule.
- P3: spyglass 24 fleet-wide (not 288); hall totals 360 / 612 / 936 (450 / 765 / 1,170 at 80%); tier 2 ≈ 6 h.

**Claude r2:**
- Resolved most of r1.
- New:
  - **N1 P2:** the yield is unreachable. lidJudge's LID_BREAKABLE check runs first, and structureguard does not cover
    clearChestLid. Authority (c) is the pre-placement list, not a yield list. Drops need a pickaxe. A complete project
    has no next visit.
  - **N2 P2:** the ring wait reads as idling (M3). It was unsized (23 runs). Quadrants are served independently, so the
    ring does not come last on its own.
  - **N3 P2:** the apex fails the rod rule.
  - **N4 P2:** the parts wait is unbounded, and smeltfuel-01 must come before pavilion-01 (jobWithdraw's 3-container,
    miss-memory and coal-after-copper causes).
  - **N5 P3:** spyglass.
  - **N6 P3:** 15-23k; the farm's plinth-first composition is on tf-on-adbec4f, not the fleet; an atomic claim writer;
    tiers 4-6 assume the frontier is below layer 8.

**All taken in r3. Nothing rejected.**

| finding | r3 |
|---|---|
| claim model and fence (Codex) / atomic writer (Claude N6) | THE TOWN CLAIM SET: one `link()` generation record per town, every claim-changing decision under it, parts with recipe rounding, apex + stairs claimed at crown's first record, fence-order priority (project siting before a ring), a simultaneous-admission fixture (§3.2) |
| the ring wait (Codex; Claude N2) | decided one layer ahead (when layer 2i opens); held cells skipped, visits end normally, no idling; a persisted `ring_deadline` = max(6 h, 30 min x runs); leases released; on expiry or shortfall the remainder switches permanently to cobble; restart tests (§3.2) |
| YIELD (Codex; Claude N1) | reserved test FIRST in lidJudge; its own fenced YIELD LIST; only YIELDABLE cells (no stand/walk/edge role), re-validated before the dig; pickaxe required, drop booked; a complete project gets one yield visit; non-yieldable conflicts RETIRE the container (`capped`, excluded from the every-container count) (§4 table, 4.1, 4.2) |
| rods (Codex; Claude N3) | none in v1: no site meets the rule (pavilion, hall terrace and apex all fail); a rod waits for a spire primitive (O9) |
| parts wait and smeltfuel (Claude N4) | copper admission counts ingots + banked parts only (raw excluded); a 24 h roof-parts bound, then planks (`roof_shortfall`); smeltfuel-01 numbered 10, before pavilion-01, with jobWithdraw's three causes named (§0.4, §1.2, §4.2, O10) |
| arithmetic | spyglass 2 per town / 24 fleet; total 39.8k; hall 360 / 612 / 936 at 450 / 765 / 1,170; pavilion 7 of 12 on ingots; tier 2 ≈ 6 h; raw run-out 17-34 days; 15-23k |
| farm composition, frontier timing (N6) | stated as treefarm-02's variant only; rings stay cobble wherever the frontier is past layer 8 at ship time |

### Round 3 (r3): Codex CHANGE, Claude CHANGE. **Both ORDER AGREE and FIRST TWO STAGES AGREE.**

**Codex r3:**
- Every round-2 finding RESOLVED except lid recovery (PARTIAL).
- New P2 x3:
  - a withdraw for a claim could manufacture a shortfall (parts in flight not counted);
  - `capped` retirement does not retire stock (cobblecap `townStock` sums fresh observations by key; dirty keys re-enter;
    double-chest halves);
  - crown gates rejected designed behaviour (a pre-deadline hold, the one recorded transition).
- P3: stale rod text in 3.1; "nine" canaries should be ten.

**Claude r3:**
- Every round-2 finding RESOLVED or PARTIAL.
- New:
  - **P2-1:** the crown's first-record apex + stair claim was never admitted and held 540 for months (it would trip its
    own gate in low-copper towns, and it starved the hall);
  - **P2-2:** leaks (no release on `roof_shortfall`), a two-record write (monument record + claims), and a double-claim
    gate on live stock that moves by itself.
- P3:
  - retirement wiring;
  - make_copper reaching the containers the count saw;
  - Paper scenes for roof_shortfall and the 1 h backoff;
  - "stalled on copper" must mean past the deadline, and M1 must exclude held time;
  - crown-01 as tier 3 or extended;
  - hive-c is not a no-coal town;
  - 1,701 of 1,714 rows named;
  - the 465 a day is fleet-wide.
- Arithmetic all re-derived correct (7/12, S 6/12, 39,768).

**All taken in r4. Nothing rejected.**

| finding | r4 |
|---|---|
| in-flight parts (Codex) | a withdraw for a claim moves backing to "carried for claim C" under the same fence; spendable counts it; carry-note expiry re-banks it; fixture (§3.2) |
| retirement (Codex; Claude P3-a) | **dropped.** Only containers inside the 16-block storage cylinder are town containers. A chest under a structure at ≥ 22 is reported (`_capped_container`) and nothing else. Inside the cylinder (storehouse only), every cell that can have air below is a planner-proven yieldable roof cell, so the yield always applies. cobblecap's completeness and stock semantics are unchanged (§4 table (c), 4.1, 4.2) |
| crown gates (Codex; Claude P3-d) | the REVERT list is now: hold past deadline; mixed ring without its one transition; any other change to a recorded decision; conservation; a claim admitted uncovered by its own generation. M1 / M3 exclude held time (§4.3) |
| first-record claim (Claude P2-1) | gone: ONE per-layer rule covers rings, stair cells and the apex, decided when the layer below opens, admitted at 80% or cobble, with a deadline; nothing is claimed more than one layer ahead (§3.2) |
| leaks, two-record write, live-stock gate (Claude P2-2) | the claims record is the ONLY authority (the monument record reads it); `roof_shortfall` and `ring_shortfall` release; the gate is on the ledger, and live under-coverage is reported (§3.2) |
| tier of crown-01 (Claude P3-e) | tier 3, extended until exposed (§0.4, §4.3) |
| make_copper's reach; scenes; hive-c; row counts; fleet-wide 465 (Claude P3) | targets the containers the count shows holding ingots; SHORTFALL scene and the backoff test; hive-c corrected; 13 aborted/unknown rows named; "fleet-wide" stated (§1.2, §3.1, §4.2) |
| stale text (Codex P3) | 3.1 rods removed from the job and conservation; "ten canaries" |
| hall admission after the pavilion | restated: the hall waits on income after a pavilion, or builds while no ring claim is live (§4.4) |

### Round 4 (r4): **Codex APPROVE**; Claude CHANGE. Both ORDER AGREE and FIRST TWO STAGES AGREE.

**Codex r4: APPROVE.** Every round-3 finding RESOLVED (make_copper's reach PARTIAL: an observation does not prove
reachability). Three P3s:
- make_copper's reachability wording;
- "claims extend at most one layer ahead" (a ring and the next stair can coexist);
- persistence semantics (placed copper keeps its record), with a restart fixture.

"No remaining P1/P2 established."

**Claude r4:** round-3 findings RESOLVED or PARTIAL.
- **N1 P2:** the ring deadline started at the decision (when layer k−1 opens), so a slow layer k−1 (4-69 h after the
  shaft) would expire most rings before their own layer opened. Crown would make mostly cobble and might never be
  exposed.
- P3s:
  - **N2:** "cannot be covered" must use fresh, complete counts plus in-flight items, including make_copper's ingots;
  - **N3:** a reserved lid outside the cylinder: return `refused`, and limit the yield list to the storehouse's record
    (a yielded monument cover would stop the frontier);
  - **N4:** a chest under an unplaced pavilion or hall roof cell had no route;
  - **N5:** a shortfall claim must keep naming placed copper, and the layer decision must be idempotent;
  - **N6:** the no-coal split (16 elsewhere), and hall claims up to 188 blocks with a stair concurrent;
  - **N7:** the pavilion parts wait should be checked at admission.

**All taken in r5. Nothing rejected.**

| finding | r5 |
|---|---|
| N1 deadline clock | the deadline is anchored at `opened_at(k)`, sized by the runs still needed then; before that, only "cannot be covered" releases; a slow-layer Paper case; crown pools drawn near a copper layer (§3.2 rule 4, rule 7; §4.3) |
| N2 / Codex in-flight | "cannot be covered" uses the ledger's basis; stale or incomplete counts are UNKNOWN, never a shortfall; make_copper's carried ingots count as in flight (§3.2) |
| N3 lid outside the cylinder | the reserved test returns `refused` (the 10-min skip); the YIELD LIST takes only storehouse-record cells; monument covers are never yielded (§4 table (c)) |
| N4 chest under an unplaced roof | at ≥ 22 the cell is placed and the chest capped and reported, as the monument does; the REVERT gate is narrowed to town containers; LIDRES-3 rewritten (§4 table (b), §4.2) |
| N5 / Codex persistence | a released claim keeps naming its placed copper cells; idempotent layer decision; restart fixture (§3.2) |
| N6 / Codex one-layer wording | 16 elsewhere; "claims extend at most one layer ahead" (a ring of up to 188 blocks plus a stair) (§1.2, §3.2, §4.4) |
| N7 | parts checked at admission, with no visit issued for roof cells without parts (§4.2) |
| Codex reachability | reworded: it removes the nearest-3 omission; backoff and the 24 h fallback remain (§3.1) |
| leftover | lightning_rod removed from the new part groups (§3.1) |

### Round 5 (r5): **Codex APPROVE**; Claude CHANGE (one P2). Both ORDER AGREE and FIRST TWO STAGES AGREE.

**Codex r5: APPROVE.** Every round-4 finding RESOLVED. "No remaining P1/P2 established." Three P3s:
- persist negative (cobble) decisions;
- a crash fixture between `layer_open` and the opening timestamp;
- the 17-day vs 17-34-day raw run-out.

**Claude r5:** every round-4 finding RESOLVED, with the arithmetic re-derived and the code paths checked (jobWithdraw,
segmentChoice's 1 h backoff, layerCensus pausing on held cells, lidFailMemory → the far branch).
- **N-a P2:** `opened_at` lived in the claims record while `layer_open` lived in the monument record. A lost write left
  a hold with no deadline, which no gate caught.
- P3s:
  - **N-b:** pre-open claims can hold copper on a stalled monument; the hall must not wait for a metal;
  - **N-c:** a claim written after its layer opened gives a false "mixed ring";
  - **N-d:** the `refused` mechanism wording and 17 vs 17-34 days;
  - **N-e:** stair claims round to 4 cut copper;
  - **N-f:** crown's draw should also check copper.

**All taken in r6. Nothing rejected.**

| finding | r6 |
|---|---|
| N-a / Codex crash fixture | `opened_at(k)` is written by the monument in the SAME generation that advances `layer_open`; the deadline is computed from it; crownread treats "a held cell on an open layer with no computable deadline" as a defect (§3.2 rule 4, §4.3) |
| Codex negative decisions | a zero-allocation COBBLE entry, immutable, tested after stock rises (§3.2) |
| N-b | pre-open release after 24 h without progress on layer k−1, or when the monument leaves `building`; the hall builds its stone-brick roof when no copper variant allocates (§3.2, §4.4) |
| N-c | the claim writer re-reads the monument record and voids its own claim if `layer_open ≥ k` (§3.2) |
| N-d / Codex raw run-out | wording corrected (unavailable → far branch, 30 min `FAR_SKIP_MS`, no chest built); 17-34 days in §1.2 |
| N-e | stair claims round to 36 ingots, ≤ 288 claimed, the spare credited to the next claim (§3.2 table) |
| N-f | crown draw requires spendable copper ≥ 1.25 x the next ring's parts (§4.3) |

### Round 6 (r6): Codex CHANGE (one P2); **Claude APPROVE**. Both ORDER AGREE and FIRST TWO STAGES AGREE.

**Codex r6:** every round-5 finding RESOLVED, except N-c (PARTIAL).
- **New P2:** publishing a claim and re-reading the monument still left two races across two records.
  - (1) A late COPPER claim published after another bot opened the layer with cobble, followed by a crash before the
    re-read, leaves an authoritative claim and a mixed ring.
  - (2) A valid claim whose layer then opened was voided by the writer's re-read.
  - The `link()` protocol orders writers to one record only. Fix: one recoverable commit point, with pending claims
    authorizing no placement.
- **P3:** fully specify the no-copper hall (windows, BOM, a completion scene).

**Claude r6: APPROVE.** It verified on origin:
- `mergeVisit` writes `layer_open` in one generation, so `opened_at` beside it is one field;
- `last_confirmed_at` exists;
- `FAR_SKIP_MS` is 30 min;
- `segmentChoice` drops held cells, and held cells are protected from waiving;
- all the arithmetic.

P3s:
- **P3-1:** a builder that advances and places in one visit must read the claims after its advance;
- **P3-2:** the pre-open release must write a COBBLE entry; `layer_open` is a world y; "leaves building" is really the
  24 h test; the no-copper bricks need a furnace;
- **P3-3:** the crown draw's real filter is copper (a threshold table), and crown must be parked if nothing qualifies;
- **P3-4:** the income is fleet-wide (shared ≈ 75% if banking is even), so the raw run-out is 11-14 days and the total
  is ≈ 95-115 days.

**All taken in r7. Nothing rejected.**

| finding | r7 |
|---|---|
| Codex P2 (cross-record race) / Claude P3-1 | THE COMMIT PROTOCOL: a monument-layer claim is PENDING (reserves copper, may drive make_copper, never authorizes placement) until the monument's own layer-advance generation writes `layer_copper[k]` = {claim_id, claims_gen} or COBBLE beside `opened_at(k)`; a pending claim committed COBBLE is VOID; a committed claim is never voided; builders read the commitment after their own advance; fixtures (a)-(e) cover both interleavings, same-second, crash-after-publish and restart (§3.2) |
| Codex P3 / Claude P3-2 (no-copper hall) | the ZERO-COPPER hall is fully specified: 63 stone-brick roof cells, 4 stone-brick windows, 175 bricks / 274 cobble / ≈ 22 coal, bricks admitted at siting; the copper roof's 24 h fallback is cobblestone (no furnace); completion and fallback scenes (§4.4) |
| Claude P3-2 (definitions) | the pre-open release writes an immutable COBBLE entry; `layer_open` = `plan.ys[k]`; the 24 h test is the effective release |
| Claude P3-3 | the draw threshold table; crown is PARKED (cancel, re-queue) when nothing qualifies (§4.3) |
| Claude P3-4 | the run-out is 11-34 days with the assumption named; §3.3 is labelled a fleet-income lower bound, ≈ 92-114 days at the assumed shared share (§0.1, §1.2, §3.3) |

### Round 7 (r7): Codex CHANGE, Claude CHANGE (one shared P2 + one Codex P2). Both ORDER AGREE and FIRST TWO STAGES AGREE.

**Codex r7:**
- **P2:** the pre-open release (in the claims record) raced the commit (in the monument record): immutable COBBLE, a
  historic COPPER commitment and released backing could all hold at once. Serialize cancellation and commitment through
  one durable per-layer decision in the monument record.
- **P2:** "bricks admitted at siting" needed a pre-siting `make_part` path that does not exist. Define one, or admit the
  cobble variant; test from zero bricks through the real job selector.
- **P3:** the 15-23k forecast used fleet income.

**Claude r7:** the round-6 findings RESOLVED or PARTIAL; code and arithmetic re-verified.
- **N1 P2:** the same race for the 24 h release and the pre-open cannot-cover release. Also `ring_shortfall` in the
  claims record could not stop the builders' per-click fence. Fix: every per-layer transition is a monument-record write
  (first write wins); `shortfall_at` goes in the monument record; the claims record follows; fixture (f).
- P3s:
  - **N2:** store `deadline_at`;
  - **N3:** a multi-layer advance skips a decision;
  - **N4:** the monument record IS pruned (`KEEP_RECORD_GENS = 64`);
  - **N5:** the forecast's income basis.

**All taken in r8. Nothing rejected.**

| finding | r8 |
|---|---|
| Codex P2 / Claude N1 (the release vs commit race; the shortfall fence) | every per-layer copper decision is a MONUMENT-record write under its `link()`: pre-open COBBLE by any reader, COPPER or COBBLE at open, `shortfall_at` once; first write wins, never overwritten; the claims record only follows (VOID or release), over-reserving in the gap (safe); `fence()` re-reads the monument record per click; fixtures (f) release-vs-open with a stalled releaser and competing admission, (g) shortfall mid-visit, (h) two-layer backlog (§3.2) |
| Codex P2 (the hall's bricks) | "admitted at siting" withdrawn: bricks via `make_part` after siting, as the design does, with the 24 h roof fallback to cobblestone (no furnace); the zero-copper scene starts from zero bricks through the real selector (§4.4) |
| Claude N2 | `deadline_at` stored in the commit generation, never recomputed (§3.2 rule 4) |
| Claude N3 | with crown enabled, the advance loop stops at the first layer it opens (§3.2 protocol 5) |
| Claude N4 | the claims record is never pruned; the monument record is pruned but full-state, so no decision is lost; a stale writer is stopped by `fence()` and loses first-write-wins (§3.2 protocol 6) |
| Codex P3 / Claude N5 | ≈ 14-21k at the assumed shared share; 15-23k is labelled the fleet-income upper scenario (§0.1, §3.3) |

### Round 8 (r8): Codex CHANGE, Claude CHANGE (one P2 each). Both ORDER AGREE and FIRST TWO STAGES AGREE.

**Codex r8:**
- every round-7 finding RESOLVED except Claude's N1 (PARTIAL);
- **P2:** a copper click already sent can cross the shortfall transition. The shortfall writer must take the click lock
  and settle the pending click before publishing, record the settled placed set, and release only the true remainder.
  Fixture: a builder paused between packet send and ack, plus disconnected-clicker recovery;
- **P3:** "the ONLY authority" wording, and COBBLE entries as a second authority;
- **P3:** zero-copper bricks round to 176 (275 cobble).

**Claude r8:** every round-7 finding RESOLVED. It verified the monument's generations behave as a compare-and-swap
(`createMonumentGen` + `link()`, `mergeVisit` carrying state forward), so first-write-wins is real.
- **P2-1:** a follower's lag can permanently downgrade a hall or pavilion at siting (variant chosen once, no retrofit).
  Spendable must be a pure function over both records.
- P3:
  - the fleet scenario is 16-25k;
  - COBBLE entries are follower copies, and re-claims must be refused;
  - the backlog costs a 1 h backoff per layer;
  - name the decision writers;
  - an in-flight click can still land one block after `shortfall_at`;
  - the claims record also needs pruning;
  - wall bricks still need a furnace;
  - crown parking wording;
  - the calendar label.

**All taken in r9. Nothing rejected.**

| finding | r9 |
|---|---|
| Codex P2 / Claude P3-5 (a click crossing the shortfall) | the shortfall writer takes the existing click lock, settles any outstanding click (with the lock's disconnected-clicker recovery), then writes `shortfall_at` with `placed_at_shortfall`; only the remainder is released; fixture (i) (§3.2 rule 5) |
| Claude P2-1 (follower lag at siting) | spendable is a pure function over BOTH records: a PENDING claim counts zero when the monument says COBBLE or the 24 h test holds (and the admitter writes the COBBLE first); every claims reader is a follower; fixture: stalled releaser, then hall siting (§3.2) |
| authority wording; negative decisions (both) | the claim set owns allocation, the monument owns decisions; COBBLE entries are follower copies; a claim writer refuses if a decision or any entry for k exists (§3.2) |
| backlog backoff; decision writers (Claude) | a 2 min backoff for a layer that opened already closed; fixture (h) drains within N visits without M1; the advance loop, visit-end close and pre-open writer named, each spreading the latest record as `mergeVisit` does (§3.2 protocol 5) |
| claims pruning (Claude) | full-state and pruned like the monument; pointer by `claim_id` (§3.2 protocol 6) |
| arithmetic and wording | 176 bricks / 275 cobble / 22 coal / 1 spare; the wall bricks' furnace bound named, with `make_part` on smeltfuel's coal sweep; crown parking ("would block until cancelled", parking likely); ≈ 16-25k fleet scenario (§0.1, §3.3, §4.3, §4.4) |

### Round 9 (r9): **Codex APPROVE, Claude APPROVE. Both ORDER AGREE and FIRST TWO STAGES AGREE.**

**Codex r9: APPROVE.** Every round-8 finding RESOLVED, except the hall brick rounding (PARTIAL). "No remaining P1/P2
established." P3s:
- the hall's wall-item rounding;
- the cancellation loser: the admitter re-reads the winning decision;
- qualify the deadline promise: settlement can finish after `deadline_at`; never weaken the barrier.

**Claude r9: APPROVE.** It checked the click lock in code (builder.mjs `runPlacements` takes `lock.acquire` first and
`fence()` last; monumentjob.mjs `clickLock` lets only the present author settle, via `settleOwn` at visit end and
`settleMonumentClicks` each minute), so "the shortfall waits for the click lock" is true and bounded. Arithmetic
re-derived. "None reaches P2." P3s for the stage-4 / stage-3 build reviews:
- **N1:** the gap between `deadline_at` and the shortfall write. Fix: `fence()` refuses copper at the deadline,
  spendable zeroes expired claims, and the gate is "a copper confirm after `deadline_at`".
- **N2:** the pavilion's `roof_shortfall` writer.
- **N3:** brick arithmetic.
- **N4:** the lock mode for the writer, and unloaded chunks.
- **N5:** the 24 h admitter re-read; non-admission must write COBBLE.
- **N6:** pre-filled copper cells at open.

**r9.1 (applied after both approvals, P3 only, no new mechanism):**
- N1 and Codex's deadline P3: copper is refused at `deadline_at` and expired remainders are zeroed in spendable; the
  gate becomes a copper confirm after the deadline;
- N2: only the build-lease holder writes `roof_shortfall`, after settling its click;
- N4: the lock mode and the UNKNOWN-on-unloaded retry;
- N5 and Codex's cancellation-loser P3: the admitter re-reads, and non-admission writes a pre-open COBBLE;
- N6: a pre-filled census in the COPPER write, excluded from the mixed-ring gate;
- N3 and Codex's brick P3: **clarified, not changed.** The zero-copper hall's window cells are FULL stone-brick blocks
  (design 12.2's zero-iron pattern), so 175 -> 176 bricks stands. The reviewers' 177 -> 180 assumed `stone_brick_wall`
  items. The hall's build review re-derives the BOM from recipes either way.

**FINAL: both engines APPROVE (r9). Both AGREE on the ORDER (§0.4) and on the FIRST TWO stages of 2-8: stage 2,
structureguard-01 inside the monument-01 rebuild (§4.1), and stage 3, pavilion-01 (§4.2). They have agreed on these
since round 3.** Raw review texts: `docs/reports/townprojects-stages2-8-reviews-2026-10-19.txt`.
