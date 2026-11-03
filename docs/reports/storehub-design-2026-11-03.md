# storehub: the town storage hub (intake hoppers, clerks, sorted hall, disposal well) (2026-11-03)

**Owner (11-03, verbatim):** "could we build a large storage area where stuff went into a hopper and was put into a set of 20
chests.. then a few bots pulled stuff from our hopper chests and sorted them into another storage area with chests. stuff was
sorted into groups and chests by the bots to keep things organized? other bots could pull from the sorted chests when they need
things." / "we'd also want a disposal well near this storage so sorting bots can throw away junk that gets thrown in the hopper." /
"use claude and codex to make the design and determine the best point in our queue to implement."

**Status:** DESIGN ONLY. No bot code, no deploy, no queue edit. Ledger row `storehub-1103`. Claude wrote one design and Codex
wrote another, independently, from the same measurements and request. Neither saw the other's design. Codex's design and its review
are in [`storehub-design-2026-11-03/`](storehub-design-2026-11-03/).

**In one paragraph:** the hub saves almost no bot-time, because storage is 0.47% of fleet bot-hours. What it does buy is three
things:

- a visible building the owner asked for;
- **clerk jobs**, which are the work the showcase needs before it goes from 10 to 15 bots;
- searches that go to the right chest. Today 86% of `withdraw_pick` chest visits and 78% of kit-search visits find nothing.

Build it in this order:

1. **Index-directed search, on the showcase alone, now.** After a 2 h watch, the fleet gets it as an owner-direct tier 2 rollout,
   once bundle-1103a closes.
2. **The sorted hall and the hub registry, on the showcase** (tier 2).
3. **One clerk, on the showcase** (tier 2). It migrates today's chests and throws listed junk at the town well through a
   cargo-only plan.
4. **The hopper bank** (D1) and then **bot tossing** (D2), last. These rest on Paper and mineflayer behaviour nobody here has seen
   work, which makes them tier 3. So they need, in order:
   - a Paper proof;
   - two engines;
   - **a fleet canary first**: one PROGRESS entry bundling hall + clerk + hopper bank, at the next valid P turn after an S;
   - only after that, the showcase.

---

## 1. Measured first (2026-11-03, 24 h windows, full walks)

All counts come from `scripts/lib/telemetry.py` `Events.load(since_minutes=1440)`, which reads every file in full, rotated `.gz`
generations included. Each line states its denominator.

**Positive controls:**

- The fleet walk returned 1,976,102 rows from 80 bots over 24.04 h (1,923 bot-h). `gather`, `goto` and `explore` dominate skill
  time, as they always have.
- `_sort_deposit` reads 0 on the fleet and 128 on the showcase. That is right, because sortstore runs only on the showcase.
- Showcase walk: 169,777 rows, 10 bots, 240 bot-h.

### 1.1 Bot-time at storage

| | Fleet (80 bots, 1,923 bot-h) | Showcase (10 bots, 240 bot-h) |
|---|---|---|
| All skill time (sum of `duration_ms`) | 586 h (30% of bot-h) | 84.5 h |
| deposit | 726 calls, 2.9 h | 49, 0.3 h |
| withdraw / withdraw_pick | 10 / 642 calls, 0.1 / 1.8 h | 0 / 48, 0.1 h |
| town_deposit | 1,414 calls, 0.4 h (median 0.0 s, p90 2.2 s) | 246, 0.1 h |
| toolkit | 1,743 calls, 1.2 h | 205, 0.1 h |
| dispose_well | 1,029 calls, 2.7 h | 121, 0.2 h |
| **Storage total** | **9.1 h = 0.47% of bot-h** (1.6% of skill time) | **0.7 h = 0.3%** |
| build_shop, for scale | 27.3 h | 6.6 h |

**So the hub is not a time lever.** Removing every storage second would return under 0.5% of fleet time. Clerks *add* bot-time,
because each item is handled twice. That is acceptable in fun mode. It is the owner's ask and it creates work. But the goal has to
be stated honestly. Codex reached the same conclusion on its own (§A, its §2).

### 1.2 Failure causes

- **deposit (fleet, 726 calls):**
  - 359 success, 258 failed, 91 aborted, 18 no_effect.
  - Fail classes: `no_path` 169, `interrupted` 91, `storage_full` 40, `path_interrupted` 33, `nothing_found` 8.
  - 216 of the 359 successes were "after walking home": the chest the bot aimed at was out of reach.
- **town_deposit (fleet, 1,414 calls):** 1,228 success; `town_storage_full` 44, `town_deposit_failed` 13.
- **New chests:** `_deposit_new_chest` deferred 40 requests. Town memory marked most nearby chests full.
- **Cobble:** `_stock_refused` logged 5,682 rows. Chests refuse cobble at the town cap, so it stays in bags. Bags hold 26,448 cobblestone
  and 6,872 cobbled_deepslate across 80 bots.
- **LLM proposals (`llm-*.jsonl`, 135,913 decisions in 24 h):**
  - `deposit` was proposed 16,381 times (12% of all decisions), and 15,831 of those were aborted at admission.
  - About 11,000 were "not a banking target … nothing to deposit": apples, the last pickaxe, chests, cooked beef, dirt.
  - 2,919 were "no storage in reach".
  - These aborts cost decisions, not bot-time. No building fixes them; that is an admission/prompt matter (§9, flagged).
- **Showcase:** deposit 40/49 success (7 interrupted), town_deposit 238/246, toolkit 203/205, dispose_well 109/121.

### 1.3 How many chests a search tries

| Search | Fleet | Showcase |
|---|---|---|
| `withdraw_pick` (pick and ingredients; visits every town chest, cap 16) | 316 searches: mean **7.9** chests, median 7.5, p90 16. 64 searches hit the cap. Per visit: none 207, success 29, unreachable 13, so **86% of visits miss**. Outcomes: `crafted_pick` 178 (no pick in town), short 66, took_pick 32 | 24 searches: mean 3.75, p90 9. Visits: none 42, success 3 (**93% miss**) |
| kit search (`_kit_search`, cap 12) | 451 searches: mean **4.1**, median 2, p90 11. Visits: none 1,437, success 404, unreachable 15 (**78% miss**) | 40 searches: mean 3.6, p90 7. Visits: none 97, success 46 (68% miss) |

The town index (`townindex.mjs`, townindex-01 / indexsearch-01) already knows what each chest held at its last open. It only
**orders** the search: it never lets a search **skip** a chest it knows is fresh and does not hold the need.

This is the cheapest real gain here, and it needs no building. Even so, it saves at most about 1.5 h/day fleet-wide.

### 1.4 What the town chests hold now (town index, latest observation per chest)

- **Fleet, 16 towns, 312 chests:**
  - 11 to 30 chests per town; 34% to 94% of slots used.
  - **67 chests (21%) are full.**
  - 20 to 41 item kinds per town. In every town most kinds sit in more than one chest (for example 29 of 41). That is the "not
    organised" the owner sees.
  - Biggest stocks per town: oak_log 1.1k to 2.8k, copper_ingot 0.4k to 2.7k, cobblestone up to 1.2k.
- **Showcase, 9 chests:**
  - 117/243 slots (48%), 0 full.
  - 2,016 items of 17 kinds; 8 kinds in more than one chest.
  - cobblestone 953, spruce_log 364, copper_ingot 240, lapis 98, **iron_ingot 96**, torch 65.
  - The sorted storehouse is live: six signed interior chests (STONE/METAL/WOOD/FUEL/TOOLS/OVERFLOW) plus the
    valuable/earth/build homes, and 128 `_sort_deposit` rows.
- **Bags:**
  - Fleet: mean 576 items and 23.5 kinds per bot. Totals include chest ×674 (8.4 per bot), bamboo 3,865, oak_sapling 666 and
    birch_sapling 435. Plants average 62.5 per bot.
  - Showcase: mean 707 items per bot. Cobblestone 4,457 across 10 bags, iron_pickaxe ×37 (3.7 per bot), plants 4.8 per bot.

**Funding fact:** 20 hoppers cost 100 iron ingots and 20 chests. The showcase holds 96 ingots in chests plus 24 in bags, and the
toolkit and iron picks draw on that same stock. **The full 20-hopper bank cannot be paid for at once on the showcase.** It has to
grow from surplus (§3.4).

---

## 2. Feasibility facts (searched; sources in [`storehub-design-2026-11-03/feasibility.md`](storehub-design-2026-11-03/feasibility.md))

**Hoppers and items**

| Fact | Confidence | What it means here |
|---|---|---|
| A hopper pulls item entities from the whole block space above it. A full solid block on top stops the pull (since 1.20.5 it does not even try); a partial block does not. Rate: one item per 8 game ticks, so **2.5 items/s per hopper** (spigot `ticks-per.hopper-transfer: 8`, `hopper-amount: 1`). | wiki + Paper docs | One 64-stack on one hopper drains in **25.6 s**. Ten stacks on one hopper take 256 s, which is close to despawn. **Toss at most one stack per hopper in flight.** |
| A hopper's output faces the block face it was placed against. | wiki | The facing is set at placement and stays when the target block is replaced. |
| mineflayer `placeBlock` against a chest does not sneak (`generic_place.js` TODO), so the click opens the chest. Our builder (`buildbot.mjs`) never uses `placeBlock`, and it **never clicks an `INTERACTABLE`**, which includes chests (line 38). | mineflayer 4.37.1 source | **Placeholder method:** place dirt where the chest will go, place the hopper against the dirt's face, dig the dirt, then place the chest from a non-interactable neighbour. No sneak packet and no new movement writer. **Must be proven.** |
| Item entities despawn after 6000 ticks (5 min). The timer pauses in non-entity-ticking chunks. Merge radius is 0.5 (spigot default, not 2.5). | spigot docs + wiki | The intake must sit within simulation distance of a bot to drain. Unloaded means paused, not lost. |
| A player-tossed item has a **40-tick (2 s) pickup delay**. Pickup reach is 1 block horizontally beyond the hitbox. | wiki | A bot standing beside a hopper re-collects its own toss after 2 s. **The toss lane sits 2 blocks from the hoppers, behind a fence.** |
| Hoppers and items tick only near a player. `entity-activation-range.misc: 16`. | Paper docs, forum | Items slow down more than 16 blocks from a bot. Whether a hopper still pulls a slowed item is unknown, so prove it. |

**Chests, signs, sorting**

| Fact | Confidence | What it means here |
|---|---|---|
| Two single chests placed side by side merge into a double chest. A chest will not open under a block that conducts redstone. **A chest opens under glass.** | wiki; glass **proven on Paper 10-19** (lidglass, `lidrule.mjs` `LID_OPENS`) | Intake chests sit **one cell apart** (Codex). The backstop over the chest row is glass. Single-chest spacing still needs its proof. |
| The builder's support order is **the block below first**, then the four sides (`buildsite.mjs` `SUPPORTS`, `stepFor`). The nearest support wins. | source (Claude review) | A hopper on a floor would be clicked onto the floor, face **down** and jam. Hopper cells need a **forced support** (a blueprint cell field `support: [dx,dy,dz]`): `stepFor` uses only that face. |
| Known chest-window failures: "Server rejected transaction" and windowOpen timeout (mineflayer #3249, #3360, #3459). | issues | Every move must be verified against the server, which the existing primitives already do. |
| Signs: a server only accepts an edit from the open editor (sign-proof.cjs, Paper 1.21.8, 11-01). | proven here | Reuse `sortLabelOne`. `bot.updateSign` alone is refused. |
| Comparators need Nether quartz. Every hopper item-sorter needs comparators. | wiki | **Hoppers cannot sort. Bots sort.** One hopper feeds one chest. Nothing distributes items between chests on its own (Codex's point). |

---

## 3. The reconciled design

### 3.1 Siting and layout

The hub is **one blueprint project, `storehub@1`**, sited like the yard. `buildsite.mjs siteBlueprint` places it in the town ring
(22 to 44 blocks from home), clear of every reservation. It prefers the cells next to the yard, so bulk stone and the hub share one
trip. The town's existing storehouse keeps working throughout.

Footprint is about **23 × 17** plus a well courtyard (Codex's sizing; Claude's strip layout fits inside it):

```
   N                                        (y = floor; the roof at +4; glass backstop at +1 over each chest row)
   +-----------------------------------------------------------------+
   | toss lane (2 wide, fenced)  F F F F F F F F F F F F F F F F F F |
   |  .  H  .  H  .  H  .  H  .  H  .  H  .  H  .  H  .  H  .  H  .  |   H = hopper, facing S into the chest below it on the plan
   |  .  C  .  C  .  C  .  C  .  C  .  C  .  C  .  C  .  C  .  C  .  |   C = intake chest I01..I10, one cell apart (never paired)
   |             clerk aisle (2 wide)                                |
   |  .  C  .  C  .  C  .  C  .  C  .  C  .  C  .  C  .  C  .  C  .  |   I11..I20
   |  .  H  .  H  .  H  .  H  .  H  .  H  .  H  .  H  .  H  .  H  .  |
   |  F F F F F F F F F F F F F F F F F F  toss lane (2 wide, fenced) |
   +=========== door ==========+=====================================+
   | SORTED HALL: wall chests by group, a sign above each; REVIEW chest; PLANTS chests (§3.6) | well courtyard (W) + composter |
   +-----------------------------------------------------------------+
```

- **Intake bank.**
  - Two strips of 10 hopper→chest pairs, back to back across a 2-wide clerk aisle: 20 hoppers feeding 20 single chests, which is
    the owner's literal shape.
  - Each hopper feeds **its own** chest sideways, so no hopper network is needed.
  - Bots toss over a fence from a lane 2 blocks out. They never stand within pickup reach of a hopper and cannot walk onto one.
  - Glass over the chest rows stops tosses landing on chest lids and leaves the lids free to open.
  - Each chest has a sign `INTAKE I04`.
- **Sorted hall.**
  - It starts with **one home per group** for the 10 town-plan groups (`townindex.mjs GROUP_ORDER`), **one home per top-stock item**
    (the top 6 by town stock, for example cobble working stock, oak_log, copper_ingot, iron_ingot, coal, torch), two overflow
    chests, and one REVIEW chest. That is about 20 chests.
  - The hall reserves wall cells for expansion: a group whose home stays above 80% of its slots gets the next free cell.
  - Signs use `sortstore.mjs LABELS` plus item labels (`OAK LOGS`) and come from `sortLabelOne`.
- **Hub registry.**
  - The hub sits 22 to 44 from home, outside the town box (16 horizontal, 12 vertical). Its containers are therefore **registered
    explicitly** in the hub record, by role: `intake`, `home`, `item`, `overflow`, `review`, `plants`.
  - **Every reader that scans the town box must read that list,** through one helper, `townContainerKeys(home)` = the box ∪ the
    registry. Each caller below gets a test that a hub chest counts:
    - `townContainers`;
    - the withdraw and toolkit candidates;
    - the town index observation (`townindex.mjs` and `skills.mjs` around 4036 / 4228);
    - the `townStock`, cobble-cap and stock-target scans (`skills.mjs` around 3703 / 3959–3968);
    - `composter.mjs` `STORAGE_NEAR`.
  - **Why every one:** otherwise moving stock into the hall empties the town's stock view. Stock-target rungs would reopen, the
    cobble cap would stop refusing, and the iron check that pays for hoppers would never fire (Claude review, blocker 3).
  - The town box itself is not enlarged. Raising it would change every deposit's scan (Codex's point).
- **Hopper cells** carry a **forced support** (`support: [dx,dy,dz]` → the placeholder's side face). Otherwise the builder clicks
  the floor and the hopper faces down (§2).
- **Glass chute.** Glass stands on three sides of each hopper's catch space and is open toward the toss lane, so a toss that
  drifts falls into the hopper rather than onto the floor (S0 measures it).
- **Siting** prefers the side of town where the **town junk well** stands (§3.5).

### 3.2 How items get in (depositors)

| Path | When | Verified by |
|---|---|---|
| **Window deposit into an intake chest** (the default) | Hub intake on, the bag holds bankable items above its keeps (`townKeeps`, allowance) | The existing server read-back (`fitToContainer`, `verifyTown`) |
| Humans toss into a hopper (piece D1) | Any time the bank stands | The hopper's chest (clerks read it) |
| **Bots toss onto a hopper** (the visible one, piece **D2**) | See the toss rules below | See the receipt rules below |
| Direct deposit into the sorted hall (today's sortstore deposit) | A depositor that already holds a single-group bag, or any bag when intake is off or full | sortstore's own checks, as today |

**Bot tossing (D2): when a toss is allowed.** All of these must hold:

- the Paper proof (§5) has passed;
- `STOREHUB_TOSS=on`;
- the bot holds the **strip lease**, so there is one tosser per strip and **no clerk withdraws from that strip's chests until the
  lease is released**;
- the bot tosses into at most 2 hoppers per visit, one stack each;
- each target chest has at most 22 of its 27 slots used, by a read taken **this visit**.

**Bot tossing (D2): how receipt is proven.** Entity disappearance is **not** receipt, because merging removes entities too (Codex
review, blocker 2). Instead:

1. Read each target chest's count of that item before the toss.
2. Toss.
3. Wait the drain time (26 s per stack).
4. Re-read the chest.
5. Receipt = the chest delta. Because the strip lease holds clerks off, the delta is unambiguous.

**Bot tossing (D2): a shortfall.** If the delta comes up short:

- the tosser **recovers** the missing items, picking up what lies within reach of the lane, before a 120 s deadline (despawn is
  300 s);
- tossing on that strip is **suspended** until the shortfall is received or recovered;
- anything it cannot recover closes the strip's fence gate and raises SH2.

The bot steps back out of the 1-block pickup reach while the items drain.

What goes into the intake:

- **The same set `town_deposit` banks today.** The `notForChest` filter is unchanged, the stone cap is unchanged, and **cobble and
  deepslate go to the yard**, never the intake. 26k bagged cobble would fill 20 chests in an hour.
- **Plus listed junk, if the owner allows it (O1).**
  - This is what the owner's "junk that gets thrown in the hopper" implies. Without it a hopper cannot enforce the 10-04 rule,
    because a human can toss anything.
  - Bots keep doing junkout at the well themselves (today's path, 1,861 `_junkout` rows/day, cheap). Junk reaches the intake mainly
    from humans and from mixed bags.

### 3.3 Clerks

| Point | Decision | Whose |
|---|---|---|
| **How many** | **1 clerk per hub to start.** A second only when backlog persists: intake at 50% of its slots or more for 30 staffed minutes. At 15 showcase bots, up to 2. | Codex (1) over Claude (2 to 3). The measured storage work is small, and the job assigner's `clerk` cap is 1 (`jobrules.py`). |
| **Lease** | `buildproj.mjs` lease files: `storehub.clerk1` / `clerk2`, 12-min life renewed each visit, 60-min term, 30-min rest. This is the gkhelpers pattern (`gkhelpers-01show`, keeper / helper1 / helper2). | Both |
| **Exclusions** | A bot never holds the yard clerk and the hub clerk at once. A second clerk takes a separate **source** lease (one intake chest at a time), so two clerks never open the same window. | Codex |
| **How it is offered** | A `shop.mjs` PROJECTS upkeep entry (the yard's pattern), installed through `features.mjs`. Hub deposits run through `town_deposit`'s execution in `skills.mjs`. Ruled out: a new `cognitive.mjs` order (`#townDepositOrder` is gated by `inTownZone`), a `roles.mjs` value (it knows BUILD/MAKE only), and any `admission.mjs` change. | Both |
| **Job assigner** | `jobrules.py`'s `clerk` is the **yard** clerk (it needs a yard plus a cobble backlog, line 113). The hub clerk gets its own `need()` row, `hubclerk`: cap 1, or 2 on backlog, needing intake or old-chest migration backlog. | Claude review, note 5 |

**A clerk visit** (bounded: 90 s and 6 stacks, which is `SORT_MOVE_STACKS`):

1. Take the lease. Re-check work.
2. Pick the source: the intake chest with the most used slots by the index. The index is a hint only: **open it and read**,
   because hopper-fed chests change without dirty marks (Codex).
   - **With no intake built yet (pieces A to B),** the sources are the town's **old chests** and the overflow. The clerk migrates
     today's scattered stock into the sorted hall, which is visible work from day one.
3. Withdraw at most 6 stacks, keeping 4 free slots and every keep. **Cargo never merges with the clerk's own stock** (Codex review,
   blocker 3: `sortPut` deposits whole stacks only, above the pre-withdraw floor, so 10 taken into a personal stack of 20 could
   never be returned):
   - a **stackable** stack is taken only if the bag holds **none** of that kind, and only into an empty slot;
   - non-stackables (tools) are always fine;
   - the cargo intent (`{name, count, src}`) is written to a **per-holder cargo file** (`<hub>.cargo.<holder>.json`, the pantry
     pattern) **before** the window click.
4. Classify **each stack before its group**, because a category is not permission to store (Codex):
   - Listed junk (`isWellJunk`, every reserve/project guard, and a final per-stack check at the throw) goes to the hub well.
   - Plants go to §3.6.
   - Cobble and deepslate above the working stock go to the yard.
   - **An unknown item** (group `misc` and not on a known list) goes to the **REVIEW** chest. It is never thrown.
   - **Swords stay** (hub cargo is entrusted; the peaceful sword rule does not apply to it, Codex).
   - Everything else goes to its item home, then its group home, then overflow (`sortstore.mjs depositOrder`).
5. **Cargo tracking** (Codex):
   - The visit delivers every cargo stack, or puts it back in its source. The cargo file is updated after each verified move.
   - A clerk never ends a visit holding intake cargo. Today's `sortTidyOne` would leave it in the bag.
   - **Interrupt or restart.** The cargo file survives. The holder's **next town action is cargo delivery**. Until then, its cargo
     kinds are **keeps** for junkout, the well and town_deposit (the existing `keep` options of `disposePlan` / `townKeeps`), so
     ordinary bag handling cannot throw them or scatter them. Only the holder can deliver its own cargo.
   - **Kinds that merged anyway.** If a cargo kind does merge (a pickup during the walk), the cargo count is still protected as a
     keep and delivered by count.
6. Release or renew the lease. Write one `_storehub_clerk` row: `src= took= sorted= item_home= group_home= overflow= review=
   junked= plants= yard= cargo_left= ms=`.

### 3.4 Funding and building

- The hub is built **in stages**, as one record:
  1. walls, floor and lights;
  2. the sorted hall's chests and signs;
  3. the intake bank, pair by pair.
- **Hoppers are paid for one at a time from surplus.**
  - A hopper is crafted only while town iron is at least `IRON_RESERVE + 5`.
  - `IRON_RESERVE` = 48 on the showcase: toolkit iron picks and shovels plus the deep miner's needs.
  - The bank starts at 4 pairs and grows to 20. A 4-pair intake drains 10 items/s, which is ample for 10 to 15 bots.
- Chests come from verified surplus first: chests already banked, then planks.
- Like the sinks (`sinkFundable`, picker-sinks-2026-11-03), a bot pledges only **its own bag** plus town stock above the reserve.

### 3.5 The disposal well

- **The disposal well is the town junk well** (`well.mjs`, the two-trapdoor pit).
  - Well state is **one record per home** (`junkwell-site-<home>`; `wellSiteRefusal` answers 'already a well'). A second well is
    therefore not "unchanged" code.
  - Also, `minewell.mjs`, which is protected, keeps mining out of the **recorded** well's shell. A second shell would be unprotected
    from digging until minewell knows it.
  - So the hub's **siting prefers the town-well side of town**: "near the storage" is met by the siting.
  - A second, hub-courtyard well is a **later tier 3 item** (well record + `minewell.mjs`). It rides with the fleet canary only if
    the walk from the clerk aisle to the town well measures over 24 blocks.
- The well's "nobody within 5" exclusion must not fight the clerks (Codex). Today `_well_refused` `player_near` shows up 11 times a
  day on the showcase.
- **The clerk's throw plan is its own** (Claude review, blocker 2). Today's dispose path also throws swords (`wellSwordsNow`),
  cobble at cap (`cobbleWellCap`) and stock surplus (`stockWellOpts`), and none of those may touch entrusted cargo. So the clerk:
  - judges **only the cargo stacks**, never its own bag;
  - calls `disposePlan(cargo, { swords: false, cobbleAtCap: false, stock: null, keep: <non-cargo> })`;
  - logs `_well_dispose ... via=clerk items=...`.
- **Thrown, only:** names in `OWNER_JUNK_1004` or `SCAFFOLD_DECORATIONS` that also pass `isWellJunk`. This is `HUB_THROWABLE`, an
  allowlist: eggs, flint, clay_ball, ink sacs, scutes, dead_bush, pointed_dripstone, rail; andesite, diorite, granite and
  mossy_cobblestone above `STONE_GUARD`.
- **`DECORATIONS` are not thrown from hub cargo.** That means stained glass, wool, buttons, pressure plates, fences, bricks and
  polished stone. `isWellJunk` would accept them, but in entrusted cargo they are building material, so they go to the BUILD home
  (or REVIEW).
- **Never thrown** (hub cargo, whatever a list says):
  - tools and swords, ores, `raw_*`, ingots, logs, planks, wood;
  - fuel, building stone and bricks, glass, copper;
  - food, saplings, bamboo, flowers;
  - unknown items, which go to REVIEW;
  - anything thrown only because a chest is full. A full destination is a backlog, not a reason to discard (Codex).

### 3.6 Plants (owner decision O2: a partial reversal of the 10-04 rule)

Today `notForChest` refuses saplings, bamboo and flowers (`bankable.mjs NEVER_BANKABLE`, the owner's 10-04 no-junk rule). So
park gatherers (gkhelpers park gather, live on the showcase since 11-03 18:38Z) keep plants in their bags, listed in per-holder
pantry files.

- **Claude's proposal (if the owner says yes):**
  - The hub gets a **PLANTS** group of signed chests: saplings by type, bamboo, flowers.
  - Each type has a cap: 64 per sapling type, 128 bamboo, 32 per flower.
  - Only the park / groundskeeper withdraws from them.
  - **Surplus above the cap goes to the composter, not the well.** Flowers are compostable, which `isWellJunk` already excludes.
    The bone meal it yields feeds the park.
  - **Stated plainly for the owner:** composting surplus saplings and bamboo **destroys kinds on `NEVER_DISPOSE`**. It is
    disposal by another route, bounded by the caps. If the owner wants no sapling or bamboo ever destroyed, the caps become
    "stop accepting" instead, and the excess waits in intake.
  - The reversal covers **park materials in hub PLANTS chests only**. Ordinary town chests keep refusing plants.
- **Codex's default (if the owner says no):** plants never enter stock. They go to planting needs or the composter. The excess
  waits in intake as a visible backlog, and **nothing deletes it**.

### 3.7 Withdrawals (other bots)

Search order:

1. chests the index shows holding the need, freshest first;
2. the item home, then the group home;
3. unknown or stale chests;
4. the intake bank, last, as an emergency source.

**A chest known fresh (no more than 6 h old) and not dirty that did not hold the need is skipped** (piece C). Intake chests are
**never** given that negative, because hoppers change them without a dirty mark. The 16-visit and 12-visit caps stay.

---

## 4. Where the designs differed, and what was chosen

| Point | Claude | Codex | Chosen, and why |
|---|---|---|---|
| Hoppers | 20 hoppers, one per intake chest | **One** hopper feeding I01; bots spread items over I02 to I20 | **Claude's shape, grown from Codex's start.** The owner asked for hoppers into 20 chests, and one hopper per chest needs no network. Codex is right about cost, so the bank starts at 4 pairs and is paid for from surplus. |
| Default depositor path | Toss onto hoppers (visible), with guards | Verified chest deposit; tossing mostly for humans | **Codex.** A toss has no server-verified receipt. Window deposit is the default; bot tossing is enabled only after the Paper proof, with the entity receipt check. |
| Clerks | 2 to 3 | 1, with a second on persistent backlog | **Codex.** 0.47% storage time does not justify more, and the job assigner's cap is 1. Up to 2 at 15 bots. |
| Junk in the intake | Implied by the owner's words | Needs an explicit owner exception | **Owner decision O1.** Recommend yes, intake chests only. |
| Index negatives | Skip chests known fresh without the need | Never a durable negative for hopper-fed chests; reopen before acting | **Both.** Skip only non-intake, fresh, clean chests. Intake chests are always re-read. |
| Clerk cargo | Deliver within the visit | Explicit cargo record; never let it become bag surplus | **Codex's**, added (§3.3 step 5). |
| Plants | PLANTS chests with caps, surplus to the **well** (control-session sketch) | Plants never in stock; backlog waits | **Owner decision O2.** Claude's proposal changed: surplus goes to the **composter**, because `NEVER_DISPOSE` protects saplings and bamboo. |
| Swords in hub cargo | Peaceful rule applies | Keep them | **Codex** (entrusted cargo). |
| Before the intake exists | The clerk sorts only the intake | Same | **New in reconciliation:** the clerk migrates the old town chests first. The work and the visible tidying start before any iron is spent. |
| Hopper placement | Sneak + `placeBlock` | Sneak placement, proven | **Neither.** `buildbot.mjs` never clicks an interactable and never uses `placeBlock`. Use the **placeholder method** (§2) with a **forced-support** blueprint cell, because the builder otherwise picks the floor below (Claude review, blocker 1). It keeps the builder's rules and adds no movement writer. Prove it through the real `stepFor`. |
| Toss lane | Beside the hoppers | (not specified) | **Two blocks out, fenced**, from the 40-tick pickup delay. |
| Hall size | Chest per item | One home per group plus overflow, expanded from pressure | **Both:** item homes for the top 6 stocks, group homes for the rest, expansion from slot pressure. |
| Queue | §6 | §A, its §5 | §6 |

---

## 5. What a Paper sandbox must prove before the intake (D1, D2) is released

These run on a free sandbox from `sandbox/sandboxes.json`, under `sbxlock.sh`. Proof script: `sandbox/storehub/intake-proof.cjs`.
Nothing was run for this design: the proofs need a driver written first, and the sandbox locks belong to the canary host.

1. **The placeholder method, through the real builder.** The step must run through `buildrun` / `stepFor` with a forced-support
   cell **on a floor**: dirt at the chest cell, the hopper clicked onto the dirt's side, the dirt dug, the chest placed. Read the
   hopper's `facing` (RCON `data get block`, read-only) and pass one item through.
   - **Negative control 1:** the same cell without the forced support must face down, which proves the field is what does the
     work.
   - **Negative control 2:** clicking a chest face must open the window and place nothing.
2. **Capture:**
   - tossed stacks from 2 blocks behind a fence: the share landing on the target hopper versus a neighbour, a chest lid or the floor;
   - glass over the chest row blocks lid landings and still lets the chest open;
   - chests one cell apart stay single.
3. **Rate and backlog:**
   - 1, 4 and 20 hoppers with one stack each;
   - 10 stacks on one hopper (expect about 256 s);
   - a full chest stalls its hopper, items sit on top, and the despawn timer runs.
4. **Re-pickup:** a bot at 1, 1.5 and 2 blocks; the 40-tick delay.
5. **Chunk activity:** the nearest bot at 8, 16, 24 and 32 blocks. Does a hopper pull a slowed item, and does an unloaded intake
   resume?
6. **Concurrency:**
   - a clerk withdraws while its hopper feeds the chest, with counts read before and after (no "rejected transaction", no
     duplicate, no loss);
   - two clerks with separate source leases;
   - a clerk interrupted mid-cargo resumes from the record.
7. **Receipt check, by the chest delta under the strip lease.** Tosses that **merge** (two stacks within 0.5 blocks) must not be
   counted as received. Forced misses must be recovered by the tosser before 120 s and must suspend the strip. The proof also checks
   that an entity-removal count would have been wrong, which is the reason the delta is used.
8. **End to end:** a pickaxe tossed in is sorted into TOOLS, and another bot's `withdraw_pick` takes it without crafting one.

Codex's list (§A, its §3) adds restart and disconnect cursor recovery and lease fencing for an expired holder resuming. Both are
included in 6.

---

## 6. Pieces, in order

Tiers are what `python3 scripts/lib/protected.py` would say for the files named. **None of the planned files is protected:**
sortstore, storehouse, townindex, towndeposit, withdrawpick, toolkit, well, yard, shop, features, buildproj, and the
deposit/withdraw/build_shop code in `skills.mjs`, and `buildsite.mjs` (forced support). Pieces D1 and D2 are still **tier 3 by
the fun-mode rule** ("rests on Paper/mineflayer
behaviour nobody here has seen work").

| # | Piece | Tier | Kill switch | Tests (focused; `npm test` on .30 under `flock ~/suite.lock nice -n 19`) | Read: success measures |
|---|---|---|---|---|---|
| **S0** | `storehub-proof`: the Paper intake proof (§5); a test driver only, nothing on a bot | 1 | none | The proof itself; its counts are the evidence | All 8 items pass; the receipt check matches the chest delta 100% |
| **C** | `indexsearch-02`: index-directed search. Skip fresh, clean, non-intake chests the index shows without the need; the hub registry joins the candidates. `withdrawpick.mjs`, `toolkit.mjs`, `sortstore.mjs searchPrefer` | 2 | `INDEXSEARCH2=off` | Pure decision tests: known/stale/dirty/unknown/intake cases, the cap kept, a mutant on the skip line (anchor asserted unique). A composition test: an index that is wrong (a stale negative) still finds the item on the second pass | Mean visits per search: fleet **7.9 to 2.5 or fewer**, showcase 3.75 to 2 or fewer. Per-visit miss: 86% to 40% or less. **took/took_pick no lower**; `crafted_pick` no higher |
| **A** | `storehub-hall`: the `storehub@1` record, siting, walls, sorted hall, item/group homes, REVIEW, signs, the registry | 2 | `STOREHUB=off` (never sited or offered); `SORT_SIGNS=off` | Blueprint/siting tests (clear of reservations, door faces home, chests one apart, lids clear); registry-to-reader composition; `sortHomes` with item homes | Hall cells placed within 3 h of release; signs read back; slot purity in item/group homes **at least 95%**; kinds in more than one chest **8/17 to 2 or fewer**; 0 deaths linked |
| **B** | `storehub-clerk`: 1 clerk lease (2 at backlog), clerk visit with cargo record, old-chest migration, REVIEW, yard hand-off, hub well throws | 2 | `STOREHUB_CLERKS=0`; `STOREHUB_WELL=off` | Classification table test (junk, plant, unknown, sword, tool, ore, cobble). Lease tests (fencing, expiry, rest). A cargo-recovery test (interrupted mid-cargo). **The refusal chain:** full home, then overflow, then REVIEW, never the well | At least 100 verified stack moves in 24 h; **kept-items thrown = 0**; `cargo_left` resolved within the next visit at least 95% of the time; backlog age median under 30 staffed min; clerk bot-time reported (expect 10–20% of one bot) |
| **D1** | `storehub-intake`: hopper/chest pairs (placeholder method, forced-support cells in `buildsite.mjs stepFor`), surplus-paid; depositor **window** path into intake chests; humans may toss; `_storehub_intake` rows | **3** (unseen Paper behaviour) | `STOREHUB_INTAKE=off` (depositors return to today's sorted deposit). A bot-placed fence gate closes the lane (a software switch cannot stop human tosses: Codex) | S0 green; `stepFor` unit test with a floor present (forced support wins; without it, below wins); pure tests for the intake guard; two engines plus a search at build time | Hoppers built **face their chests** (100%, read back); window deposits at least today's town_deposit success (1,228/1,414 fleet); intake never more than 70% for over 30 min |
| **D2** | `storehub-toss`: bot tossing behind `STOREHUB_TOSS`: strip lease, ≤ 2 hoppers/visit, receipt by **chest delta**, recovery before 120 s, strip suspension | **3** | `STOREHUB_TOSS=off` | S0 items 2–4 and 7; pure tests (lease, slot guard, the shortfall → recover → suspend chain; a mutant on the suspension) | Receipt **at least 99.5%** of tossed items by chest delta; **0 items unrecovered** at 120 s; 0 re-pickups |
| **E** | `storehub-plants` (only on owner O2 yes): PLANTS chests with caps, surplus to the composter; park withdraws | 2 | `STOREHUB_PLANTS=off` | Cap tests; plants never reach ordinary town chests (a composition test with `notForChest`) | Plants in showcase bags fall (4.8/bot now; park holders' pantry counts); 0 plants thrown |
| **F** | **The fleet canary (the first live run of D1 + D2):** one bundle A + B + D1 + D2, `STOREHUB` on in the canary pools only. It draws pools whose towns hold at least 68 iron (a 4-pair start plus the 48 reserve) | 3 | `STOREHUB=off` | The fleet suite on the tip that carries towngate-01 | The A/B/D1/D2 measures on canary towns; deaths flat; the generic +90/+180 read |

**Tripwire rules** (tooling tier: `infra/showcase` tripwire and `scripts/host` gate rules; two engines, one round):

- **SH1 kept-thrown:** any `_well_dispose via=clerk` whose `items=` names a kind **outside `HUB_THROWABLE`** (§3.5). Any
  `_well_dispose` at all that names a `NEVER_DISPOSE` kind. **TRIP at 1** (stops `STOREHUB_WELL`). The classification test checks
  the same `HUB_THROWABLE` list.
- **SH2 toss shortfall:** a `_storehub_toss` row with `short>0` and `recovered<short` at its 120 s deadline. Floor misses are counted,
  because the receipt is the chest delta, not entity removal. **TRIP at 1** (stops `STOREHUB_TOSS`, closes the strip gate).
- **SH3 clerk carry-off:** a clerk visit that ends with more non-kit items in the bag than it started with, after cargo returns. TRIP
  at 3 in 1 h.
- **SH4 intake jam:** every built intake chest at 24 of 27 slots or more for over 30 min. Alarm (the owner hears within 3 h, per the
  stuck-goal rule).
- **SH5 the generic rules:** deaths, crash loops, stuck-goal 3 h.

**Effect registrations** (OWNER 11-03 "every registration names its effect"):

- C: `withdraw.visits_mean`, down, at least 30%.
- A/B: kinds in more than one chest, down.
- D: `none_reason: visible feature; receipt measured by SH2`.

A metric missing from `scripts/lib/effectmetrics.py` gets added with the piece.

---

## 7. Queue placement

**State at 21:00Z.**

- **Fleet slot:** bagdiet-01 (P) is reading on board-c/board-d. Behind it: swimcentre-01 (S), bundle-1103a = stationkeep-01 +
  marks-01 (P), towngate-01 (P, tier 3), groundskeeper-01 (P, tier 2), llmoai-01 (serving ops, held).
- **Showcase:** release `cbd2f51b` (picker + sinks, gk helpers + park gather, water expeditions) has been live since 18:38Z. The
  owner's order next is the copper hall finish and signs, then 10 to 15 bots, then a second brain past 15.

| Piece | Claude | Codex | **Reconciled** |
|---|---|---|---|
| S0 proof | Any time a sandbox is free; before D | Before D | **Now-ish, in parallel.** It touches no bot and no lane. It waits only for a free sandbox lock. |
| C index search | Showcase with A; fleet owner-direct after bagdiet-01 closes | Fleet owner-direct after bagdiet, swimcentre **and** bundle-1103a | **Showcase: alone, as soon as it is built.** It needs no building and must not wait on the copper hall (Claude review, blocker 4). It gets a 2-h watch. **Then fleet: owner-direct tier 2 after bundle-1103a closes, between canaries, under the deploy lock, with a 60-min tripwire.** It takes no P/S slot. bagdiet-01 and marks-01 both touch deposit/withdraw, so waiting for both gives C a clean baseline (Codex). |
| A hall | Right after the copper hall finish | After the copper hall | **Showcase, right after the copper hall finish and signs** (the owner's order is kept). The hall is a project, so it is building work for the extra bots. |
| 10 to 15 bots | With A/B, because clerks are work | The hub alone does not justify it; show backlog first | **Raise after A is released and its 2-h watch passes**, per the owner's order. The hall build plus the migration clerk gives sustained work. Read build_shop turn-aways and clerk backlog at the 2-h watch. The hub is one source of work among the sinks and park, not the only gate. |
| B clerk | Showcase, after A | After A | **Showcase, after A**, with the hub well. Its migration of old chests needs no intake. |
| D1 / D2 intake | Showcase after S0 plus two engines | Tier 3: **fleet canary first**, then the showcase | **Codex (review, blocker 1).** Tier 3 goes to the fleet canary; a Paper proof and two reviews do not replace it. D1 + D2 run first in **F**. They reach the showcase (a restack onto the promoted tip) only after F is KEPT and promoted. |
| E plants | After B, if the owner agrees | (the backlog default) | **After B, only on owner O2 yes.** |
| F fleet canary | After the showcase 72 h read | D in the next eligible P slot | **One PROGRESS canary entry, the bundle A + B + D1 + D2, queued behind groundskeeper-01.** It launches **only at the next valid P turn after an intervening S entry.** If no S entry is queued, F **waits**: an absent S is not permission for P after P (Codex, review blocker 4). Before it is queued: S0 green, two-engine APPROVE plus the build-time search, and A and B each through their showcase 2-h watch. The canary draws pools whose towns hold at least 68 iron, so the pool contains the population it targets. |

C and E never use the canary lane: they are tier 2, which goes owner-direct after the showcase. A and B reach the fleet only inside
F, because D1 and D2 depend on them.

**Expected timing,** if nothing else moves:

- **C:** showcase as soon as it is built; the fleet after bundle-1103a closes.
- **A:** showcase once the copper hall closes (it waits on copper, now about 25/day).
- **B:** after A.
- **F (D1 + D2):** the first valid P turn after an S, once S0, the reviews and A/B's watches are done.
- **D on the showcase:** after F is promoted.

**No date is promised.** The copper hall gates A and B, and the P/S alternation gates F.

---

## 8. Owner decisions needed

| | Question | Recommendation |
|---|---|---|
| **O1** | May listed junk sit **temporarily in the intake chests**, until a clerk throws it? Without this, the hopper cannot keep the 10-04 rule, because a human can toss anything. | Yes, intake chests only. Sorted chests and ordinary deposits stay junk-free. |
| **O2** | Plants: a PLANTS group in the hub with per-type caps, surplus composted (a **partial reversal of the 10-04 rule, park materials in hub PLANTS chests only**)? Or plants never stored, with the backlog waiting? | Yes, with caps. The park needs a store, and bags currently hold its materials. |
| **O3** | Iron: grow the intake from 4 to 20 hopper pairs from surplus above a 48-ingot reserve, instead of 100 iron at once? | Yes. 100 at once would empty the showcase's iron. |
| **O4** | One clerk first, a second only on measured backlog (2 at most at 15 bots)? | Yes. |
| **O5** | After F is KEPT: hubs **fleet-wide** (`STOREHUB` on in every pool), or the code promoted with the switch **on only on the showcase**? | Fleet-wide in towns that can pay. Fleet towns hold 312 scattered chests and 21% are full; that is where sorting shows. |
| **O6** | Bot tossing (D2) at all? Bots could use only the verified window deposit, leaving the hoppers for humans: less fun to watch, but no item-entity risk. | Yes to D2, behind its switch and SH2. The tossing is the part of the owner's picture that can be seen. |

---

## 9. Risks, and things noticed in passing

- **Cargo loss in interrupted transfers** is the main risk. It is covered by the cargo record (B), SH3 and the verified primitives.
  Code rollback does not undo world edits, so take a world snapshot before D1's release (the showcase gate does this).
- **Index misuse:** hopper-fed chests are never trusted for negatives. The index is still never a disposal input
  (`townindex.mjs` header).
- **Composition:** towngate-01 (tier 3, `admission.mjs`/`cognitive.mjs`) changes town-job gating. F's deposit/clerk offers go
  through `shop.mjs` and do not touch it, but F's suite must run on a tip that carries towngate-01.
- **Not a hub problem, but measured here:** 15,831 of 16,381 LLM `deposit` proposals per day (12% of all decisions) are aborted at
  admission. Most are "nothing to deposit" for an apple, the last pickaxe or a chest. That is a prompt/admission fix (tier 3,
  `admission.mjs`), and possibly a cheap gain in decision capacity. It is out of scope here and flagged for its own task.

---

## Appendix

- [`storehub-design-2026-11-03/codex-design.md`](storehub-design-2026-11-03/codex-design.md): Codex's independent design, verbatim.
- [`storehub-design-2026-11-03/codex-review.md`](storehub-design-2026-11-03/codex-review.md): Codex's one-round review of this
  reconciled design (blockers only).
- [`storehub-design-2026-11-03/claude-review.md`](storehub-design-2026-11-03/claude-review.md): an independent Claude review. Piece D
  rests on unseen Paper behaviour, so it gets the second engine.
- [`storehub-design-2026-11-03/feasibility.md`](storehub-design-2026-11-03/feasibility.md): the feasibility facts with sources.
- [`storehub-design-2026-11-03/measure.md`](storehub-design-2026-11-03/measure.md): the measurement summary given to both designers.

---

## 10. Review round (one round, blockers only) and what was done

There were two engines. The intake rests on unseen Paper behaviour, so both reviewed. Both said **BLOCK** on the first draft. Every
blocker below is fixed in this version. Per fun mode, a second round would only re-check these fixes. Each piece's build-time review
(and the two-engine review of D1/D2) covers them.

| # | Engine | Blocker | Fix (where) |
|---|---|---|---|
| 1 | Claude | The builder clicks the floor first (`buildsite.mjs` `SUPPORTS`, below first), so a hopper faces down and jams | Forced-support cells (§2, §3.1). S0 item 1 runs through the real `stepFor` with a negative control (§5). D1 test (§6) |
| 2 | Claude | The dispose path throws swords, cobble at cap and stock surplus, and `isWellJunk` accepts bricks, stained glass and fences | The clerk's own cargo-only `disposePlan` with every extra off. The `HUB_THROWABLE` allowlist, which excludes `DECORATIONS`. SH1 on the same list (§3.5, §6) |
| 3 | Claude | Hub chests 22 to 44 out vanish from the stock, cap, index and iron views (the `inTown` scans) | `townContainerKeys(home)` feeds every town-box reader, with a test per caller (§3.1) |
| 4 | Claude | C reached the fleet before the showcase | C goes to the showcase alone first, with a 2-h watch (§7) |
| 5 | Codex | Tier 3 D was scheduled showcase-first | D1/D2 run first in the fleet canary F, and reach the showcase only after promotion (§6, §7) |
| 6 | Codex | Entity removal is not receipt (merging); a missed toss was never recovered | Receipt by chest delta under a strip lease. Recovery before 120 s, then strip suspension. SH2 trips at 1 (§3.2, §5, §6) |
| 7 | Codex | `sortPut` cannot return cargo that merged with the clerk's own partial stack | No-merge withdrawal. A per-holder cargo file written before the click. Holder-only recovery first. Cargo kinds kept as keeps (§3.3) |
| 8 | Codex | The P,S alternation was conditional | F waits for a valid P turn after an S; an absent S means waiting (§7) |

Notes taken from the reviews:
- Glass over chests is already proven (lidrule 10-19).
- A second well is a tier 3 item, because of `minewell.mjs`; the hub prefers the town-well side (§3.5).
- Composting saplings and bamboo is disposal of `NEVER_DISPOSE` kinds, and O2 now says so.
- The hub clerk gets its own `jobrules.py` `need()` row (§3.3).


---

## 11. Piece C as built (indexsearch-02, 2026-11-03 ~23:00Z)

**Branches.** Showcase `storehub-c-show` @ `1d2df12a` on the live release `cbd2f51b` (ready to stage, not staged). Fleet
variant `indexsearch2-on-53fd28e` @ `231981c0` on fleet `53fd28ee` (a hand port: that base has no sortstore `prefer`).
Code `bots/src/indexsearch2.mjs`; read `scripts/host/indexsearch2read.py` (`--selftest`); registration and owner-direct
fragment in [`storehub-design-2026-11-03/`](storehub-design-2026-11-03/) (`indexsearch-02.231981c0.json`,
`indexsearch-02.rollout-fragment.json`), drafts, not registered. Tier 2 (`protected.py`: not protected). Codex r1 BLOCK, r2
APPROVE.

**Replayed before building** (the index files on disk against every search's `tried=` list, the index state taken at the
search's start; a negative = known, clean, no deposit since, fails every need):

| | Fleet, 21.9 h, 80 bots (6 h life / **60 min life**) | Showcase, 24 h, 10 bots (6 h / **60 min**) |
|---|---|---|
| withdraw_pick visits to index negatives | 575 / **360** of 914 parsed visits (245 searches) | 58 / **41** of 70 (21 searches) |
| kit-search visits to index negatives | 1,239 / **818** of 1,676 (424 searches) | 84 / **81** of 141 (39 searches) |
| of those negatives, visits that found the item | **0** | **0** |
| positive control: hits in chests the index showed holding the need | kit 324 of 384, withdraw_pick 17 of 23 | kit 43 of 44 |

**Where the build differs from §3.7 / §6 row C, and why:**

1. **A negative lives the need's own miss life (60 min), not 6 h** (Codex code r1 BLOCK). At 6 h, one search could end (a
   craft, or the kit's `no_iron` and its backoff) while a *wrong* negative had hours left. A negative is the same look a
   visit would have written as a miss, so it now lives exactly as long. It is never stronger than the base's own evidence:
   the journal's count of none (`zeroLive`) is OUT for the miss life with no recheck at all. The replay shows the cost: at
   60 min it catches about 63% (withdraw_pick) and 66% (kit) of what the 6 h rule caught.
2. **The design's "second pass" is a recheck**: each pass may still open one index negative, the oldest observation first,
   after every other candidate. Its open writes a fresh observation, so a wrong index is corrected by the search itself.
   A recheck of *every* negative after a miss would have revisited the empty town and saved nothing for the searches that
   find nothing (178 of 316 withdraw_pick searches crafted).
3. **Index positives are tier 0.** §1.3 says the index "only orders" the search. It does not: indexsearch-01 closed
   INCONCLUSIVE (unexposed) on 10-23 and was never promoted, and nothing in `townSearchView` read the index. Piece C adds the
   ordering (§3.7 step 1) along with the skip.
4. **The hub registry has nothing to join yet.** No hub exists, so the never-negative intake set is empty; `townSearchIndex`
   takes it, and piece A fills it. Hub chests outside the town box are unknown to the index, so they are never negatives.
5. **The order's gates are unchanged** (`townSearchEmpty` does not read the index). An order is issued exactly when it is
   today; only where it looks changes.
6. **Needs the index cannot judge** (the smelt job's inputs, which have their own rule-out; mats' item names) get no index
   evidence at all.

**The 2-h showcase watch is a no-harm read, not an effect read.** In the 24 h before 11-03 20:00Z the showcase ran 27
withdraw_pick and 38 kit searches (3.67 and 3.61 chests per search; 96.5% and 67.9% of visits empty; withdraw_pick +
toolkit failed share 15.4% of 65 skill rows). A 2 h window holds about 2 and 4. The watch checks the licence, the defects
(D1 a container twice in a pass, D2 more than one recheck per pass, D3 visits over the caps) and the failed share; the
effect (visits per search, empty share, outcomes, `ix=` exposure) is read at +24 h on the showcase and on the fleet.
