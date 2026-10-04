# No junk in town chests — design (10-04, NOT BUILT)

Code read at `origin/wd-on-6c9a8fb` = 515d99c (withdraw, round 2). Telemetry: host 10.0.0.31, rotation-aware
(gz for 10-04 + live), window 2026-10-03 06:21Z → 10-04 06:21Z, **1,181,165 rows, 80 bots, 80 gz files + live**.
Versions in the window: 8453c09, 3edf1d6, ba84fa6, ffa0f57 — all pre-withdraw. Scripts and raw outputs are in this
scratchpad: `depjunk.py/.out`, `sinks.py/.out`, `bags.py/.out`, `cobband.py/.out`. Independent Codex design:
`codex-last.txt` (read-only sandbox, launched before my own analysis; its prompt is in `codex-prompt.txt`).

## TL;DR

1. **The deposit path already refuses almost everything on the manifest.** Of the 7,051 items banked in clean deposit
   runs, the share that was ballast, plant litter or unused drops was **0**. Junk still flows in through two routes:
   **cobblestone, about 7.2k/day (53–62% of everything banked)**, and **spent tools, about 100/day**. The withdraw
   branch already stops the spent tools. The census's dirt, seeds, eggs and so on are history, from the old loop that
   handed over every stack (`bankable.mjs:240-247`; that loop was replaced around 2026-09-13).
2. **Cobblestone is the only real decision left, and refusing it outright creates a dead end.** At least **64.6% of
   banked cobble (4,647 of 7,192 a day) comes from bots already at 34 or more slots.** For those bots the deposit is
   what frees bag space. A refused stack stays in the bag. No sink drains it on demand, and the existing sinks are not
   enough on their own.
3. **The logs 256 / planks+sticks 128 caps are rejected.** Both engines reject them, and the data is below.
4. **Minimal canary: a cobblestone town cap of 256.** Refusals use only evidence: the town total is a *lower bound*
   from containers the bots actually opened. A capped bag-full bot gets a bounded relief stack. The canary has a
   bag-fullness tripwire, and DiD measures cobble banked per bot-hour.

## 1. Evidence

### 1a. How deposit decides today (wd-on-6c9a8fb)

- `bankable.mjs:143-204` `bankableInventory` is the **one definition**. Everything goes through it:
  - deposit: `depositPlan`, `skills.mjs:2629`
  - the no-op sentence: `depositNoopReason`, `skills.mjs:2716`
  - admission: `admission.mjs:356`, through `depositDue`
  - the prompt line: `prompt.mjs:604`
  - the `deposit_surplus` milestone: `milestones.mjs:792/806/815`
  - withdraw room: `withdrawpick.mjs:120` `roomCandidates`
  - craftroom advice: `skills.mjs:4218` `depositTarget`
  - chest-full recovery eligibility: `skills.mjs:2522,2529`
- It banks an item only when one of these holds:
  - The item is in `wants`. Admission sets this at `admission.mjs:354-355` from the rung's wanted set
    (`cognitive.mjs:655-694`: target, family, up to 8 recipes' ingredients, smelt inputs), plus `DEPOSIT_ALWAYS`
    (ores and gems, `bankable.mjs:251`).
  - The item is in `STANDING_TARGETS` (`bankable.mjs:35-38`): logs, oak_planks, stick, **cobblestone, cobbled_deepslate**,
    stone, coal, raw_iron, iron_ingot, diamond.
  - The item is a spare **usable** tool (`:194-198`).
- Never banked:
  - `NEVER_BANKABLE` (`:29-32`), plus anything not wanted. The not-wanted case gives `excluded = not_wanted`, `:198`.
  - Withheld amounts: the scaffold reserve of 8 in total (`:81-100`), 2 sticks, one of each station or bucket (`:130,180`),
    and withdraw holds (`:184`).
- At most **64 of each name per run** (`creditCap`, `:199`).
- **Spent tools on the withdraw branch:** `:179` sets `avail = min(n-1, usable-1)`, so with no usable copy nothing is
  bankable. The transfer `skills.mjs:2632-2648` moves usable copies only, worst-usable first, by slot.
- **What happens to a refused item:** it stays in its bag slot. Nothing sheds it. Two status cases:
  - Nothing eligible: deposit returns `no_effect` with the named rule (`skills.mjs:2698-2717`).
  - Eligible items but full chests: chest-full recovery runs (`viaRecovery`).

  Codex reached the same reading independently (`codex-last.txt` §1).
- **Junk that can reach a chest outside `depositPlan`:** withdraw's `settleCursor` puts a cursor stack into the
  *container* only when the bag has no room (`skills.mjs:5843-5880`). The test `withdraw-pick.test.mjs:256` puts dirt
  in the chest this way. Deposit's `returnCursor` returns stacks to the bag only (`chestfull.mjs:527-545`).

### 1b. What deposits actually put in, last 24 h (`depjunk.out`)

Deposit runs: 2,046 total.

| Status | Runs |
|---|---|
| failed | 976 |
| no_effect | 691 |
| success | 352 |
| aborted | 27 |

- 77 bots ran deposit. 575 runs moved items out of the bag (68 bots).
- Each row's `skill.inventory_delta` counts negative entries as items leaving the bag.
- Those entries also catch scaffold placed on the walk home and planks spent on a recovery chest. So the **clean**
  subset is the runs where the negatives exactly equal the N in "deposited N items": **193 runs, 7,051 items**.

| category | all runs (denominator 13,643 items) | clean runs (denominator 7,051 items) |
|---|---|---|
| cobblestone + cobbled_deepslate | 7,238 (53.1%) | 4,389 (62.2%) |
| wood: logs, planks, sticks | 5,481 (40.2%) | 2,379 (33.7%) |
| ores, ingots, fuel | 498 (3.7%) | 176 (2.5%) |
| ballast (dirt, sand, stone variants) | 213 (1.6%), of which dirt is 198 | **0** |
| spent tools (10 uses or fewer) | 101 (0.7%): stone_pickaxe 56, wooden_pickaxe 35, stone_shovel 10 | 52 (0.7%) |
| usable tools | 83 (0.6%) | 51 |
| plant litter, seeds, flowers, kelp | **0** | 0 |
| unused drops (eggs, flint, ink, scutes, clay) | **0** | 0 |

**Positive controls:**
- The same query finds 5,481 wood and 498 ores banked.
- It *does* see dirt leaving bags during deposit runs (198), but only in runs where the item count does not add up.
  That pattern fits pathfinder scaffold. Dirt is a mineflayer-pathfinder default scaffold block (`movements.js:76-77`).
- The refusal rows name the junk: `no goal wants it: apple 302, dirt 90, sand 19, wheat_seeds 15, gravel 9`;
  `ballast: leaf_litter 37, oak_sapling 16`; `scaffold reserve: cobblestone 101`.

So the "0" is the code doing what it says, and the instrument could have seen otherwise. One leak remains possible:
`wants` (sand for glass, for example). It came to about 1 item a day.

### 1c. Where junk goes when it is not banked (`sinks.out`, `bags.out`)

Flows below are per-row inventory deltas across all skills over 24 h. They are net per row, and pickups or losses
outside skill rows (deaths, reflexes) are not counted, so read them as flows, not a conservation account.

- **Cobblestone:** gained 28,061 (gather 12.7k, mine 12.3k, goto 2.4k). Lost 24,500:
  - movement scaffold: gather 7.6k, explore 2.7k, goto 1.8k
  - **deposit 7.2k**
  - craft 4.7k

  **Net +3.6k/day into bags even with deposits. Without them, about +10.8k/day.**
- **Dirt:** gained 16.7k, lost 11.9k, almost all as movement scaffold. Craft 543, deposit 198.
- **Sand, andesite, granite, diorite, gravel:** gained 3.5k, lost about 0.5k. Sand and gravel are not scaffold
  (`scaffold.mjs:109` FALLING).
- **Plant litter:** +947 gained, 20 lost. **Unused drops:** +170 gained, 0 lost. Neither category has any sink today.
  The composter is queued but not live.
- **Wood:** gained 31.1k, lost 33.4k (net −2.3k). Crafting consumes 20.6k a day. **Wood is a working input.**

**Full bags now** (last 30 min; 64 of 80 bots at ≥34 slots on the min-stack estimate, a lower bound; denominator
2,264 slots):

| What fills the bags | Slots |
|---|---|
| leaf_litter | 219 |
| eggs (egg 71 + brown_egg 79) | 150 |
| tools (stone_pickaxe 121, stone_shovel 62, wooden_pickaxe 55, swords 100, axes 82) | about 420 |
| oak and birch saplings | 143 |
| bamboo | 85 |
| flint | 64 |
| wheat_seeds | 64 |
| ink sacs | 72 |
| one-each stations (chest, furnace, bucket, crafting_table, ladder) | about 260 |
| **cobblestone** | **35 (1.5%)** |
| **dirt** | **21** |

**Bags are not full of cobble today, because deposit and scaffold drain it.**

**Cobble banked, by the bag occupancy just before the run** (`cobband.out`; denominator 7,192):

| Bag occupancy | Cobble banked | Share |
|---|---|---|
| <30 slots | 546 | 7.6% |
| 30–33 | 1,999 | 27.8% |
| **≥34** | **4,647** | **64.6%** |

427 of the 571 runs that moved items started at ≥34 slots. **Most cobble banking is bag relief.**

### 1d. What a bot with a full bag of junk can legally do from where it stands, today (fleet ba84fa6)

| Junk | What the bot can do |
|---|---|
| Spent tools | Wear-out (`hygiene.mjs:47`), only 1-use axes, shovels and hoes, and picks beyond 3. Copies with 2 to 10 uses have no path. |
| Litter, seeds, flowers | Nothing yet. The composter (`composter.mjs:67` isCompostJunk; town order `composter.mjs:556`) is chained, not live. Codex adds a caveat: 64-stacks at 36/36 cannot start. |
| Dirt, cobble, stone variants | Passive pathfinder scaffold only. One-block "place" advice applies only to a single-block stack (`craftroom.mjs:354-371`). |
| Cobble | Crafting, as stone tools or furnaces. Makes more junk. |
| Eggs, flint, ink, scutes, clay | **Nothing**: not bankable, not compostable, never chased (`hygiene.mjs:21`), still auto-collected. |
| Bankable surplus | Deposit, at town. |

## 2. Design

### 2a. Never banked (a hard list `wants` cannot override)

`BANK_NEVER` is the manifest's "firm junk" categories:
- ballast blocks: dirt, coarse_dirt, sand, red_sand, gravel, andesite, granite, diorite, tuff, calcite, pointed_dripstone,
  dripstone_block, moss_block, sandstone
- plant litter and seeds: `NEVER_KEEP` ∪ compostables ∪ kelp ∪ flowers
- the spent-tool rule that is already on the withdraw branch

Saplings and bamboo stay as they are today (bamboo is never banked; it folds to sticks in the bamboo canary).

- **Why this is safe for bags:** measured, 0 of 7,051 clean-banked items are in these categories. The list only closes
  the `wants` leak (about 1 a day) and turns de facto behaviour into a tested invariant. It adds essentially no bag
  pressure.
- **Codex disagrees on reading grounds.** It says to add no exclusions until disposal exists, and that `NEVER_KEEP` is
  not a disposal list. The executed measurement settles the bag side: the refusal already happens, so the list moves
  nothing new into bags. Codex is right that it is **not a remedy**, and the design does not claim one.
- **Composition:** it lives inside `bankableInventory`, so prompt, admission, milestone, withdraw room, craftroom
  advice and recovery all agree. The test is behavioural: `depositPlan` with `wants` containing sand or dirt banks none.
  The mutant drops the list and is killed.
- **Unused drops (eggs, flint, ink, scutes, clay):** these go on the list only if the owner classifies them as junk.
  Either way they have **no sink** and are 13% of full-bag slots (owner decision 3).

### 2b. Logs, planks, sticks: no cap

The bank holds 44,701 logs and 21,210 planks plus sticks. A 256 / 128-per-town cap is 4,096 and 2,048 fleet-wide. The
admin clear would delete about 90% of a usable stock, and banking would stop for a material that bags consume
(wood net −2.3k/day; crafting uses 20.6k/day). Withdraw draws planks and logs (`withdrawpick.mjs:50-73`). The only
reason to propose the cap was slot pressure in chests. Logs at 64 per stack occupy about 700 slots of 375 containers,
and the clear frees 3,125. **Claude's earlier suggestion is withdrawn. Both engines agree.**

### 2c. Cobblestone + cobbled_deepslate: a town cap, enforced only on evidence, with a bounded relief

- **Cap:** `TOWN_STONE_CAP = 256` (the manifest reserve, about 85 stone pickaxes' worth of withdraw ingredients).
- **How a bot learns the town's count.** No code keeps a contents ledger today. Town memory holds outcomes only:
  full, unavailable or took (`chestfull.mjs:204-281`). Every open already sees contents (`skills.mjs:2759` inChest;
  withdraw `:6045`).
  - Add a `stock` field to the existing town-memory entry: `{ stone: n, at }`, written on every open (deposit's first
    chest, every recovery-sweep chest, withdraw), and again after the transfer.
  - A double chest is recorded at its canonical half (`chestPartner`, `skills.mjs:2762`).
  - The **observed sum** counts only containers within `STORAGE_NEAR` whose `at` falls within `STOCK_TTL` (6 h).
  - It is a **lower bound**: an unopened or stale container counts as unknown, never zero. A refusal therefore needs
    proof that the town holds at least 256. Ignorance always fails toward banking, which is today's behaviour.
  - The one-file read-modify-write (`chestfull.mjs:241`) can lose a concurrent write. The next open re-observes, and a
    lost write only lowers the bound.
- **Where it is enforced.**
  - `bankableInventory` reads `townStoneRoom()` through an injected reader, the same pattern as `withdrawHolds()` and
    `setTownRoomReader`. Stone allowance is `max(0, CAP − observedSum)`.
  - The new exclusion is `town_stocked: 'the town has enough'`, with no digits (`deposit-truth.test.mjs` rule).
  - Because `skills.mjs:2629` computes the plan *after* the open and the open writes the observation first, the chest
    in front of the bot is always fresh.
- **Relief valve (owner decision 2).** Without one, this refusal creates the dead end CLAUDE.md warns about: 64.6% of
  banked cobble relieves full bags, and nothing else drains it on demand.
  - If the bag is at ≥34 slots and no other `depositPlan` entry frees a slot (`craftroom.mjs:290` depositFreesSlot),
    the cap admits **one whole stack** beyond the scaffold reserve.
  - It logs a `town_cap_relief` row.
  - Relief is bounded at one stack per deposit. It counts toward the read, so "junk in" stays measurable.
- **Where refused cobble goes.** It stays in the bag, where three things drain it:
  - movement scaffold, about 12k/day fleet-wide
  - craft
  - relief at the bag's limit
- **Remedy check (CLAUDE.md).**
  - *Executable:* a relief deposit is the existing transfer.
  - *Reachable:* deterministic, inside the plan. It is not advice.
  - *Composed:*
    - Admission (`depositDue`) counts the same allowance.
    - The prompt's "CARRYING" line counts the same allowance.
    - `deposit_surplus` cannot be stuck: `done` is `count < 4` under the same policy.
    - `roomCandidates` already keeps cobble (`INGREDIENT_KEEP`).
    - Craftroom's `depositTarget` stops naming cobble except for relief.
    - Chest-full recovery is never entered for a cap refusal, because eligibility is the plan. **Policy exclusion must
      never become `storage_full`, chest expansion or a bank close.** Codex raised this; it is tested.
- **Composition with the other pieces.**
  - Composter: independent (litter only).
  - Withdraw: draws the reserve the cap protects. A withdraw lowers the stock it observes.
  - Craftroom: as above.
  - Hygiene: no interaction (cobble is not in `NEVER_KEEP`).
  - Chest-full (`chest-on-1918bb5`): fewer cobble deposits means fewer full chests and less pull on the new-chest
    budget (4/day/town).
- **Not built here:** a deliberate cobble sink, such as placing surplus to backfill the bot's own tunnel. It is new
  behaviour, it changes the world through gameplay, and it needs owner approval (owner decision 4).

### 2d. The cursor-rescue exception

Withdraw's `settleCursor` may put a cursor stack into the container when the bag has no room
(`skills.mjs:5843`). This is the never-drop safety valve, and in the test case the stack came from that same chest.
Keep it, log the item name in the rescue row, and count junk-by-rescue in the read. Expected value: about 0.

## 3. Codex's independent design (`codex-last.txt`), compared

**Agree:**
- Excluded items stay in the bag.
- Logs and planks/sticks caps are rejected.
- 256 is reasonable as a stone reserve or soft target.
- Hard caps need a ledger where unknown is not zero, with double-chest dedupe and timestamps.
- One policy for every consumer.
- A cap refusal must never become `storage_full`, chest expansion or a bank close.
- The cursor-rescue exception is real.
- Eggs, flint, ink, scutes and clay need an owner classification **and** a consumption path.
- Wear-out covers only 1-use tools, not the ≤10-use census category.

**Differ, and which wins:**
1. *Codex: no new exclusions until disposal exists.* The measurement wins on the ballast and litter list: those items
   are already never banked (0 of 7,051), so the hard list moves nothing into bags. On cobble, **Codex's caution is
   confirmed by data**: 64.6% of cobble banking is bag relief. That is why this design adds the evidence-only lower
   bound and the relief valve rather than a flat refusal.
2. *Codex: run the composter canary first as the prerequisite.* Agreed on order. Composter-01 is already chained and
   tests the litter sink. It is not the no-junk change itself, because the live junk inflow it addresses is 0. The
   no-junk effect canary is the stone cap.
3. *Codex: no hard caps yet.* The canary is how a run settles this instead of a reading. The cap is bounded (evidence
   only, plus relief) and protected by a bag tripwire. If bags fill, REVERT and build the sink.

## 4. The minimal one-variable canary: `stonecap-01`

**Prerequisites:**
- Withdraw promoted. It carries the spent-tool rule; the read verifies 0 spent tools banked as its own gate.
- Composter-01 and toolclean-01 read and closed (only one canary pool).
- The `BANK_NEVER` list is a correctness-only invariant with about 0 measured flow. It either rides on the stone-cap
  build as a deterministic gate or ships on its own as a fix (owner rule: a short canary, deterministic gate only).
  **Owner picks.**
- **The admin clear runs after the canary is KEPT and promoted.** The manifest's precondition is that the chests cannot
  refill. With only the canary town capped, the rest would refill.

**The one variable:** stone allowance = `max(0, 256 − observed town lower bound)`, plus one relief stack at ≥34 slots.
That means the ledger write and the plan read. Nothing else changes.

**Pool:** 5 bots chosen at random, which is one town, against the other 75 (15 towns) as controls. Every pool
tunnels, so the target population (cobble-depositing bots) is present: about 450 cobble per town-day.

**Deterministic correctness gates (canary rows):**
- G1: every `town_stocked` refusal row carries `observed ≥ 256` from containers whose `at` is within the TTL. Zero
  refusals without evidence.
- G2: canary cobble banked after the first refusal is no more than `relief rows × 64`, and **every relief row is at ≥34
  slots**.
- G3: zero `BANK_NEVER` items in canary clean deposit runs. Zero spent tools banked.
- G4: zero cap refusals ending as `storage_full`, `bank_closed` or `deposit_new_chest`.
- G5: the ledger is wired. At least one `stock` observation per canary deposit open. Assert the wiring as a row count;
  a checker nobody calls is not a gate.

**Positive control:** the read's query must find cobble deposits on control pools at the measured rate (about 450 per
town-day; 7.2k fleet-wide), and must find `stock` rows. It is run first on control data in a dry run. The refusal
counter is proven against a synthetic row before launch.

**Effect metric (DiD, never canary-vs-fleet):** cobble items banked per bot-hour,
(canary post − canary pre) − (control post − control pre), with equal windows and bot-hours stated. Expected: a drop
once the town crosses 256 (the canary town holds 1.4k–8.2k today). Secondary: town observed stone, from the ledger.

**Tripwires (not verdicts):**
- Full-bag time share (≥34 slots), DiD. A material rise means REVERT and build the sink.
- Cobble slots per canary bag.
- Gather success.
- Deposit `no_effect` re-proposal loops on cobble.
- The two-death floor applies.

**Reads:** +180 and +360. KEEP is possible from +360. INCONCLUSIVE is a legitimate close if the canary town never
reaches the cap.

## 5. Open owner decisions

1. **Is cobble above 256 per town junk?** The manifest category is pending. If not, the no-junk change is the
   `BANK_NEVER` invariant alone, and the cobble cap is dropped.
2. **Relief valve:** a bounded one-stack relief at ≥34 slots (recommended; it avoids a dead end) or a strict cap
   (more junk kept out, bags fill).
3. **Eggs 1,262, scutes 304, flint 286, clay 276, ink 156 (in chests), and 13% of full-bag slots.** These are not
   banked and have no sink. Options:
   - classify as junk and approve a consumption path; throwing eggs consumes them without an item entity, with a 1/8
     chick
   - or allow banking (contradicts "no junk")
   - or accept them in bags
4. **A deliberate cobble sink** (placing surplus to backfill the bot's own tunnel). It is gameplay rather than an admin
   edit, but it changes the world. Needed if the stone-cap canary trips the bag tripwire.
5. **The cursor-rescue exception** (a never-drop valve that can put a stack in a chest): accept it as logged?
6. **`BANK_NEVER` delivery:** ride with stone-cap, or ship on its own as a deterministic fix.

Review status: Codex design done, independently. CLAUDE.md asks for a separate Claude review before build, and that
review has not happened. Nothing was built, committed or deployed. No RCON was used and no world was touched.
