# Resource management, long term: bags, chests, stockpiles (design, 2026-11-02)

**Owner (11-02):** "long term what is the best approach to managing resources like this and managing bags, chests and
stockpiles? use codex and claude for the best solution."

**Status:** this is a DESIGN only. Nothing is deployed, queued or scheduled. Codex and a Claude subagent each wrote a design
from the same brief, without seeing the other's. This file reconciles the two, and both engines then reviewed it once for
blockers (§14). Ledger row: `resource-model-1102`.

## 0. The answer in one paragraph

The problem is **flow**, not storage size.

- Stone comes in about five times faster than it is built with.
- Almost all of it is a byproduct of mining and travel, so a gathering cap cannot stop it.
- Moving it between bags, chests and piles does not change that balance.

The long-term model is a **town-local, demand-driven economy**:

1. **One policy table per item:** LOW, TARGET and HIGH marks, with a hysteresis latch.
2. **Bags carry a working set, not stock.**
3. **Bounded buffers:** chests, then the sorted storehouse, then the yard.
4. **A never-ending catalogue of building projects, picked by stock level,** so surplus becomes structures.

The well stays as the **metered overflow valve** above HIGH. A high well share is an alarm that says "the sinks are too
small". It is not the policy.

## 1. What the numbers say (fleet, 80 bots)

Source: `scripts/lib/telemetry.py` `Events.load`, live files, 11-02 00:05–15:30Z. That is 15.5 h, 1,142,691 rows, all 80
bots.

**Positive control:** 28,386 rows carry `skill.inventory_delta`. A first pass read the wrong key and returned 0 rows. The
control caught it, and the query was fixed.

| Flow (cobblestone + cobbled_deepslate, 15.5 h) | Items |
|---|---|
| **New from the world:** mine 17,033 · goto (pathfinder digs) 8,280 · gather 6,272 · surface 2,220 · home 1,314 | **≈ 35,100** (≈ 2,260/h fleet, ≈ 140/h a town) |
| Gather rows whose target was cobblestone or stone (out of gather's 6,272) | **687** (409 + 278). The rest came from digging toward dirt (3,016), iron_ore (1,736) and oak_log (632) |
| **Deliberate share of new stone** | **≈ 2 %**. About 98 % is a byproduct |
| Withdrawn from town by `build_shop` (ziggurat draws) | 21,305 (an internal transfer, not new stone) |
| Out to the well (`dispose_well`, 627 visits) | **17,679**, plus andesite 1,145, granite 1,059 and diorite 1,050 |
| Banked (`town_deposit` + `deposit`) | 26,009 |
| Placed or spent: build_shop 5,056 · gather 4,092 (scaffold) · goto 2,736 · explore 2,087 · craft 1,998 | ≈ 16,000 |
| Bags at 15:30Z (last row per bot, 80 bots) | cobblestone 19,458 · deepslate 1,564 · bamboo 3,392 · chests 501 · tables 84 · furnaces 67 |

What follows:

- **The well is the fleet's real equilibrium sink today.** It takes about half of the new stone, mostly through the full-bag
  (34-slot) order.
- **Builds place about 9 blocks a visit.** The 11-02 monument visits placed 4,172 in 473 visits, or 8.8 each. The limit on
  spending is **placement throughput**, not demand.
- **A 304-block yard is a buffer of a few hours.**
  - Gross: 16 yards hold about 2.2 h of fleet inflow.
  - Net of everything placed: about 3.5 h a town, at about 85/h a town.
  - This **corrects** the `stockyard-1102` ledger note, which said "about a day".
- **Bags are counted nowhere.** 19,458 cobble sits outside every town count. This is RimWorld's "Do until you have X" trap
  (§10): uncounted stock drives overproduction, and here it drives full bags too.

## 2. Three designs compared

| | Design | Verdict |
|---|---|---|
| A | **Hoard:** raise the caps, build more chests and barrels, make the yard 2× and then 4× | **Rejected.** Stock grows without limit. Every withdraw scans more containers, and the journal grows. It never answers "what is the stock for". Factorio's lesson: an unbounded buffer is an over-production engine. |
| B | **Delete-led:** keep caps low and send everything above the reserve down the well | **Kept only as the last valve.** It is stable and cheap, and it is mostly what runs today. But it throws away the owner's building material, and nothing visible grows. |
| C | **Demand-driven towns with bounded buffers** (both engines chose this) | **Chosen.** Each item has marks. The bag carries a working set. Chests, then the storehouse, then the yard are bounded tiers. A project catalogue driven by stock turns surplus into structures. The well is a metered valve above HIGH. |

## 3. One policy table: marks, latches, and who acts

`stocktarget.mjs` already holds the per-town groups (`STOCK_GROUPS`), the owner's `BUILD_RESERVE`, `PROTECTED` and
`roomUnder`. Extend it into the **single item policy**:

- Each group gets `{ low, target, high, bagKeep, destinations, disposable }`.
- Every layer reads that row: towndeposit, the well, the yard, mats, the picker, withdraw and the craft gate.
- No module keeps its own number. Today `yard.mjs` keeps 128 cobble in the bag, while bankable and the well keep 64.

**Hysteresis (Codex).** Below LOW, replenishment latches until TARGET. Above HIGH, disposal latches until HIGH − 1 stack. A
town does not flip state on every visit.

**Counting (Codex, plus the RimWorld lesson).** Each group is counted four ways:

- **observed:** chests and barrels from the `cobblecap.mjs` journal, yard piles from a bay read, and bags from each bot's
  latest row;
- **available:** shared stock minus the reserve and outstanding project commitments;
- **in transit:** a claimed transfer, counted once;
- **installed:** placed in a record, so no longer stock.

Bags count toward the town's **report**, not toward what the town can spend. Unknown stock triggers a count. It never reads as
zero and never permits disposal (the existing `provenAtTarget` rule).

**Proposed initial marks.** Owner numbers are kept where they exist.

| Group (per town) | LOW (refill / project floor) | TARGET (chest cap) | HIGH (chests + yard full) | Above HIGH |
|---|---|---|---|---|
| cobble family | 256 (`BUILD_RESERVE`, owner 10-23) | 1,000 (`TOWN_COBBLE_CAP`, owner 10-14) | 1,000 + the yard's bays | **the well, from bags, every town visit** (§8) |
| logs / planks / sticks, per type | 512 / 71 / 40 (`BUILD_RESERVE`) | 4,000 (logcap, owner 10-17) | = TARGET | prune, as today |
| sand | 16 | 64 | = TARGET | the well, as today |
| bamboo | 64 kept as bamboo | the yard's bamboo_block bay | yard full | **kept** (protected; not compostable in Java, `composter.mjs`). Its sink is bamboo_planks as `mats` fuel and scaffold; the bamboo alarm (§9) raises it with the owner if it piles up |
| copper ingots | 512 | no cap | — | never disposed |
| ores, ingots, coal, tools, saplings, parts, stations | — | no cap (`PROTECTED`) | — | **never disposed** |
| everything else (andesite, diorite, granite, deepslate, gravel, tuff, ...) | **today's rules unchanged** | | | **today's well rules, unchanged.** `NEVER_DISPOSE` keeps deepslate, gravel and tuff out of the well, and the stone guards stay |

**Kept as they are, and never "retired literals":** `STONE_GUARD`, `COBBLE_RESERVE` and `COBBLE_WELL_RESERVE` (each 64), the
`PATHFINDER_SCAFFOLD` set, and `scaffoldKeep`. These are the escape stone the exit contract relies on, so `bagKeep` can never
go below them.

The owner's 10-27 project rule is unchanged: an active, progressing project may draw down to 20 % of the reserve. Ordinary
work, logistics and disposal never go below the full reserve.

**Who acts at each mark:**

| Band | Deposit from bags | Clerk | Projects | Gathering | Well |
|---|---|---|---|---|---|
| below LOW | bank everything | refill the chests from the yard | stop drawing that item (except the 20 % project floor) | deliberate gather of it allowed | — |
| LOW..TARGET | bank (towndeposit, as today) | — | draw | no deliberate stone gathering | — |
| TARGET..HIGH | to the yard (`yard.mjs` stock) | move chest surplus to the yard | the picker raises that material's **sink pressure** | — | — |
| above HIGH | bag stacks above `bagKeep` go to the well | — | sink pressure is at its maximum | — | **metered `_overflow` rows** |

## 4. Bag policy: the bag is the most expensive storage

A bag slot is scarce and mobile, and it fills by force: server auto-pickup cannot be refused. A full bag loses ore pickups
and fails crafts. **The bag carries a working set, and nothing else:**

- **Tools:** the best usable copy of each, plus at most 2 spare picks (`bagallowance.mjs`, `toolhygiene.mjs`).
- **Scaffold:** the protected scaffold reserve (`bankable.mjs scaffoldKeep`, unchanged).
- **Wood:** the personal wood keep of 16 (`woodkeep.mjs`).
- **Stone:** one stack (64) of the cobble family, the `bagKeep`.
- **Consumables:** the food, fuel and torches the task needs.
- **Stations:** at most one crafting table and no furnace. A bot carries a chest only if it has no town (isolated, or on an
  expedition), for the full-town recovery.
- **Job cargo:** at most **one bounded job batch**, only while the bot holds that job's lease, counting what the bag already
  holds (`bagdiet-01`'s 64). It is returned when the visit ends.

**Targets:**

- Leaving town: the 75th-percentile bag uses at most 28 slots, so at least 8 are free. The median today is 28 used.
- No bag at 34 slots or more leaves town without a logged reason.
- At 34 slots, a bot starts no optional acquisition.

## 5. Storage tiers

| Tier | Density | Used for | Never for |
|---|---|---|---|
| Bag | 36 slots, mobile | the working set (§4) | stock |
| Workshop materials chest (`shopchest`) | 1,728 a chest | the next few jobs' inputs, beside the workbench (owner 10-28) | bulk |
| Town chests and the sorted storehouse, with barrels and signs (`storehouse`, `sortstore`) | 3,456 a double chest | working stock up to TARGET; valuables, ores, ingots, tools, parts and saplings, sorted | bulk stone above TARGET |
| Bulk yard (`yard.mjs`) | 1 item a block: 304 a yard at 1×, 608 at 2× | visible bulk stone, deepslate and bamboo blocks between TARGET and HIGH; the refill source; a burst buffer for projects | anything protected; permanent storage |
| The well | deletion | true junk at any level; stone above HIGH (§8) | anything `PROTECTED` |
| The composter | conversion | compostables | — |

Sorting improves access, not density. The yard also works as **a readable alarm**: a full yard on camera means "this town is
out of sinks".

## 6. Demand: a project catalogue driven by stock

`shop.mjs PROJECTS` is a fixed, finite list. When everything stands, `activeProject` returns the last entry and goes quiet.
From then on, **nothing spends stock**.

**Replace that terminal with a catalogue of persistent instances.** Reuse the `buildproj.mjs` records and leases. Each
instance has a fresh site, a bill, a completion condition and a land budget. The picker works in this order:

1. Repairs.
2. The owner's ordered finite projects.
3. A **sink instance**, picked by pressure: `(available − TARGET) / (HIGH − TARGET)` of its main material, and only while
   that pressure is above 0.

**Sink instances are repeatable and flat:**

- **road segments** extending the town paths outward along the expedition breadcrumbs (3 wide, lit posts, about 16 blocks a
  segment);
- **ziggurat growth** (another tier, or a seeded detail ring: the owner's variety options of 10-29);
- **wall towers** and a second course;
- **terraces** and plaza levelling;
- **more houses**.

**Rules for instances:**

- **Funded by PHASE, not by whole bill** (Codex review). A 48-wide ziggurat's bill is larger than a town's whole bounded
  stock. Each instance is split into phases with a bounded bill (for example ≤ 256 cobble, or one road segment). The next
  phase is admitted when *its* bill is coverable above LOW, and the town replenishes between phases.
- **A planned instance authorizes its own parts** (Codex review). Projects such as the workshop and the house need
  bricks and panes, and a town without them could never start the instance that allows `mats` to make them. So siting an
  instance (state `planned`) lets `mats` make the next phase's parts from raw stock above LOW. Construction admission then
  checks the parts.

- At most 2 open instances a town.
- The model may pick a theme among the feasible candidates. Deterministic code admits the bill.
- No build-then-demolish loops.
- **`mats.mjs` makes parts against an instance's bill only** (Codex). Turning cobble into stored stone bricks just renames
  the backlog and burns fuel. The "BUFFERS ONLY" mode retires.

**Throughput is the binding limit.** At 9 blocks a visit, sinks cannot absorb 85–140 blocks an hour in each town. Sink
blueprints should be repetitive enough that one visit places 40–60 blocks, with 3 builder slots. Expect the well's share of
new stone to fall from about 50 % to about 25–35 %, not to zero. Mining *is* the fleet's main activity.

## 7. Logistics roles and scale

- **Everyone is their own porter.** At town, the deposit routes the bag's surplus by band (§3). No hauler is needed inside a
  town.
- **The clerk is a duty, not a bot.**
  - The yard's single-builder lease already carries the clerk work (`yardVisit`: stock, clerk, refill, upkeep).
  - It is *offered* only when there is a backlog:
    - chests above TARGET + 128;
    - a town below LOW that has stock in the yard;
    - clutter in the aisles.
  - One bot a town, rotating by lease.
  - Budget: under 1 bot-hour a town a day. A full-time clerk would cost 16 of the 80 bots.
  - This follows MineColonies, where courier slots scale with the warehouse level (2 a level, up to 10): a ratio, not a
    headcount.
- **Hauler: deferred.** Add one only if transfers wait across two clerk cycles. There is no hauling between towns; each pool
  is its own world.
- **Scale.** Every piece is keyed by `home`; the journal, the yard, the leases and the records already are. Only the alarm
  roll-up is fleet-wide. Isolated bots do the same chores for themselves.

**Tier** (corrected by both blocker reviews):

- **The clerk is tier 2.** The yard rides the project chain (`shop.mjs` order → `skills.mjs yardVisit`), and neither is
  protected. No new leasable job in `roles.mjs` is needed.
- **The overflow is tier 3.** The every-visit well order gets its stacks from `cognitive.mjs` (around line 1033:
  `disposePlan(items, { keep })`, with no town stock passed in). Neither HIGH nor project commitments reach that decision,
  and `cognitive.mjs` is protected as a whole file.
- **The station craft gate is tier 3.** `toolhygiene.mjs redundantCraft` is called only from `admission.mjs` (around
  line 527), which is protected.

## 8. Settled: a full yard's surplus goes to the well, not the bags

**Recommendation: the well.** Both engines reached this independently.

This is a named **surplus-stone** route, separate from true junk. It runs only when all of these hold:

1. The town is **proven** at HIGH: chests at TARGET by the counted lower bound (`provenAtTarget`), and the yard's bays are
   full (or there is no yard yet).
2. Only whole bag stacks above `bagKeep` (64) go. Cobble is never pruned out of chests or piles.
3. No project instance in this town has an open cobble bill that a lease could serve now.
4. It happens on **every town visit**, not only at 34 slots. Today the visit order (`well.mjs wellVisitOrder`, fed by
   `cognitive.mjs` with `disposePlan(items, { keep })`) leaves cobble out, so the cobble rides out of town until the bag is
   full. Wiring the town's HIGH evidence into that caller is a **tier-3** change.
5. Every throw writes `_overflow item= n= town= pressure=`, and the share is alarmed (§9).

**Why not keep the surplus in bags:**

- Bags are the costliest tier: 7 are full, and 25 are at 30–35 slots.
- A full bag silently loses ore and fails crafts.
- A bag full of cobble turns every town visit into "the cobble stays" (19 deposits in 6 h).
- Keeping it only moves the overflow to the worst place, and the 34-slot order deletes it later anyway.

This keeps the substance of the 10-16 approval. It resolves the 11-02 "true junk only" wording by defining junk **by count,
not by name**: stone above HIGH that no sink is drawing is junk *for that town at that hour*.

## 9. Metrics and alarms

One host read, `flowledger.py` (tooling), runs per town per hour. It uses `Events`, loads the rotated logs, reads the journal
and the yard reads, and states its row and bot totals. It reports:

- **Stock by group** (observed, available, in transit) against the marks: **stock per town over time**.
- **Flow balance** (Codex review: every outflow, internal transfers out):
  - supply: world gains by skill (`inventory_delta` gains, excluding withdraw, `build_shop` draws and yard digs);
  - spend: **all** placements, meaning projects by project plus scaffold, pillar and travel placements (gather, goto,
    explore, surface), and recipe conversions (craft, smelt, mats);
  - well: `dispose_well`, with `_overflow` reported as a **subset** of it, never added twice;
  - other losses: deaths and tosses;
  - Δstock: bags + chests + yard; deposits, withdrawals and yard moves are internal and net to zero.
- **Positive control:** supply = spend + well + other + Δstock, within 10 %. If the balance does not close, the read is
  broken, not the fleet.
- **Bag fill at departure:** p50 and p75, and the number of bots leaving at 34 slots or more.
- **Deposit success** (slots freed > 0, out of attempts) and **withdraw success** (out of attempts), each with its denominator.
- **Stations:** tables and furnaces crafted per hour, and idle bot-placed stations per plaza.
- **Projects:** blocks placed per hour, per project and per visit.

**Alarms** go in the **fleetstatus header**, not a log nobody reads:

| Alarm | Fires when |
|---|---|
| sinks too small | the well + `_overflow` take more than 50 % of new stone over 24 h |
| starved | a town is below LOW for 6 h |
| bags | departure p75 is above 30 slots for 6 h |
| yard | a yard is full for 24 h |
| stations | a plaza has more than 10 idle stations |
| bamboo | bag + yard bamboo keeps growing for 48 h with the bay full (an owner decision then: a bamboo sink or the well) |
| read broken | the balance does not close in more than 3 towns |

## 10. Prior art borrowed

| Source | What it does | What we take |
|---|---|---|
| **MineColonies** ([request system](https://minecolonies.com/wiki/systems/request/), [warehouse](https://minecolonies.com/wiki/buildings/warehouse/)) | A citizen checks its own inventory and hut first, then raises a request. A courier fetches the item from the warehouse; if the item is missing, the request chains to a crafter for its ingredients. The warehouse has a **minimum stock** setting, and courier slots scale with its level (2 a level). | Bill-driven requests that chain to `mats` (§6); LOW as minimum stock; the clerk as a ratio, not a headcount (§7). |
| **Factorio** ([buffer chests, forum thread](https://forums.factorio.com/viewtopic.php?p=331237)) | Buffer chests count toward the network. Requests with limits are the standard control. Players warn that unbounded buffers make resources "disappear" and drive overproduction. | Every tier is bounded, and in-transit stock is counted once (§3). |
| **RimWorld** ([Bills](https://rimworldwiki.com/wiki/Bills), [Hauling](https://rimworldwiki.com/wiki/Hauling)) | "Do until you have X" counts only what is in stockpiles, so a worker over-produces when its output is left uncounted. Stockpile priority chooses the destination. | Bag stock counts in the town report (§3); the band chooses the destination tier (§3, §5). |
| **Dwarf Fortress** ([stockpile](https://dwarffortresswiki.org/stockpile), [wheelbarrow](https://dwarffortresswiki.org/Wheelbarrow)) | Zoned, visible bulk stockpiles. Hauling is a job any idle dwarf takes, and stone gets wheelbarrows. | The yard as visible bulk storage (§5); the clerk as a duty taken on backlog (§7). |
| **Voyager / mineflayer** ([Voyager issue 164](https://github.com/MineDojo/Voyager/issues/164), [mineflayer chest example](https://github.com/PrismarineJS/mineflayer/blob/master/examples/chest.js)) | Only "deposit when full" primitives. The search found no mineflayer project with a town-level stock policy. | Nothing beyond the primitives we already have. |

## 11. Staged plan, in fleet-queue order

Each stage is canary-sized, and each names what it reads to KEEP. Fun-mode tiers apply:

- **Tier 2:** 2 h on the showcase, then the fleet owner-direct, with a 60-min tripwire.
- **Tier 3:** the one canary slot.

| # | Piece | Tier | Builds on / retires | KEEP reads |
|---|---|---|---|---|
| 0 | **bagdiet-01** (queued, `bagdiet-on-c711879` @92a3d847) | canary (queued) | ziggurat draws | `_build_bag project=monument`: p90 of blocks taken ≤ 64, and back > 0 on visits that took any; fleet bag cobble (last row per bot) below 19,458, 24 h after promotion |
| 1 | **flowledger-01**: the host read and alarms of §9 | tooling (no slot; runs in parallel) | the `scoreboard.py` and `fleetstatus.py` header lines | First run: the balance closes within 10 % in ≥ 12 of 16 towns; row and bot totals printed; one alarm shown to fire on a fixture |
| 2 | **stationkeep-01**: craft and smelt retake the tables and furnaces they placed (furnaces once drained); tidy or yard upkeep sweeps idle bot-placed stations off the plaza into the storehouse | 2 | completes the "pick up self-placed stations" half of the owner's 11-02 request; retires the station row of the bag allowance (one table only) | Table retake share up (was 88/184); idle stations per plaza falling over 24 h; craft success share not lower |
| 3 | **marks-01**: the policy table of §3 in `stocktarget.mjs` (low, target, high, bagKeep, hysteresis), read by towndeposit, the yard, the well and mats; cobble and stone dropped from gather advice and rung wants above LOW, **but only while the bag holds at least `bagKeep`** (a bot with no cobble, on an expedition, still gets advice it can act on) | 1–2 | retires `YARD_BAG_KEEP_COBBLE` (128) and the other per-module literals, and the `BUILD_RESERVE` "nothing reads it" note | No change in deposit or withdraw success (denominators stated); `gather` rows targeting cobblestone or stone above LOW fall toward 0 (from 687 per 15.5 h); no town goes below LOW because of project draws |
| 4 | **towngate-01** (one tier-3 canary, two compatible changes that each touch the town decision in a protected file): (a) **overflow**, the surplus-stone route of §8 on every town visit, with `cognitive.mjs` passing the town's proven-HIGH evidence and open bills into `disposePlan`, metered by `_overflow`; (b) **station gate**, `admission.mjs` refusing a table, furnace or chest craft when one is in the bag or a usable one is within reach, where the refusal names the station ("use the table at x,y,z") and the craft walks there in the same decision (a composition test) | **3** (two engines, a search, the one slot) | supersedes the parked `cobbleoverflow-on-cc1000`; retires the full-bag-only cobble path and redundant station crafts | (a) bags at ≥ 34 slots leaving town fall by > 50 %; fleet bag cobble falls; **0 protected items** in `_overflow`; 0 `_overflow` rows from towns not proven at HIGH. (b) tables + furnaces crafted per 13 h < 40 (was 152 from 00–13Z), with the craft success share not lower. Generic death and tripper read |
| 5 | **stockyard on the fleet at 2×**, after the 1× showcase observation; the clerk offered on backlog only | 2 | `stockyard-01` | `_yard kind=stock/clerk` placed > 0 in exposed towns; "the cobble stays" deposit refusals fall to 0; clerk time under 1 bot-hour a town a day |
| 6 | **picker-01 + the first sink instance** (road segments from the paths, or ziggurat growth: owner Q3); `mats` bill-driven only | 2 | retires the quiet terminal of `activeProject` and mats "BUFFERS ONLY" | An instance starts after the finite list completes in ≥ 1 town; `build_shop` placements per hour ≥ 2× the 11-02 baseline (5,056 in 15.5 h ≈ 330/h; all placements of every kind ≈ 1,030/h) |
| 7 | **sinkrate-01**: blocks placed per visit (repetitive blueprints, 3 builder slots, a bounded batch) | 2 | the visit pacing of the ziggurat and houses | Blocks per sink visit ≥ 40 (from 8.8); the well's share of new stone < 35 % over 24 h |
| — | *Not proposed:* cutting the byproduct at its source (pathfinder dig cost while holding cobble, backfilling tunnels, dropping blocks at the face) | would be tier 3 | — | **Not recommended.** It changes movement and survival just to save inventory, and the owner has said never to impair escape. |

**Why this order:**

- **0** is already in the queue.
- **1** makes everything after it readable, and it needs no slot.
- **2** is approved, tier 2, and the cleanest win.
- **3** comes before 4–6 so that they all read one table.
- **4** clears bags fastest and does not need the yard. It is the plan's one tier-3 canary, so it bundles both protected-file
  changes.
- **5** adds the visible buffer.
- **6** and **7** turn the stone into structures.

**Retired:**

- per-module bag keeps (the yard's 128);
- pruning the cobble group out of chests;
- the full-bag-only cobble path to the well;
- speculative mats buffers;
- the quiet terminal of `activeProject`;
- redundant station crafts (towngate-01b);
- every station in the kit beyond one table.

**Kept:** the transfer primitives, the count journal and its claims, `PROTECTED`, the scaffold keep, the owner's reserve
numbers, and the 10-27 project floor.

## 12. Open owner questions (three)

1. **Yard full: the well (recommended), or the bags?** Surplus stone above HIGH (chests proven at 1,000 *and* the yard full)
   goes down the well on every town visit. It is metered, and it is taken only from bags, never from chests. Yes or no?
2. **Fleet yard size: 2× (recommended)**, after the 1× showcase observation, and not 4×. At any size a yard is a few hours of
   buffer; the sinks do the real work.
3. **First repeatable sink:**
   - road segments outward from the town paths (recommended: useful for return-home, flat, and a high placement rate);
   - ziggurat growth;
   - wall towers.

## 13. Where the engines disagreed, and how it was settled

| Point | Claude | Codex | Settled |
|---|---|---|---|
| Tier of the clerk, the overflow and the station gate | A tier-3 town-job "seam" in `cognitive.mjs` first | Role dispatch through `cognitive.mjs` is tier 3 | **Clerk tier 2** (it rides the yard's project visit, so no new role). **Overflow and station gate tier 3**, bundled as towngate-01: their inputs are wired in `cognitive.mjs` and `admission.mjs` (blocker reviews B1, B2). My first merge had called these tier 2, which was wrong. |
| Cobble LOW | 256 | 512 | **256**, the owner's `BUILD_RESERVE` number. Raise it only with the owner. |
| Free slots leaving town | ≥ 10 | ≥ 8 | **p75 ≤ 28 used (≥ 8 free)**, plus no unexplained bag at ≥ 34. |
| The owner's 80 % project rule | fold it into LOW | keep it unchanged | **Unchanged** (owner 10-27). |
| `mats` buffers | not addressed | retire speculative brick and pane production | **Adopted:** bill-driven only. |
| Clerk | a lease offered on backlog only | one leased responsibility per town, plus a temporary hauler | **Backlog only**, one per town; the hauler is deferred until transfers wait two cycles. |
| Accounting | a flow-balance positive control | observed / available / in-transit / installed, with bags reported | **Both.** |
| Sinks | ziggurat growth, causeways, towers and levelling; throughput is the limit | a catalogue of repeatable instances, ranked by purpose and surplus | **Codex's catalogue plus Claude's throughput stage** (sinkrate-01). |

The engines agreed independently on three points:

- **The design:** C.
- **Bag versus well:** the well, metered, above HIGH.
- **Gathering caps:** deliberate gathering only (about 2 % of new stone); the byproduct is left alone.

## 14. Blocker review of the merged design (one round)

Both engines reviewed this file once, blockers only. Neither saw the other's review. Both said **BLOCKERS**, and every one
is fixed above.

| From | Blocker | Fix |
|---|---|---|
| Claude B1, Codex 1 | Overflow is not tier 2: its inputs are built in `cognitive.mjs` | Tier 3, bundled in towngate-01 (§7, §8, §11) |
| Claude B2 | The station gate lives in `admission.mjs`, which is protected | Split: retaking is tier 2 (stage 2); the gate is tier 3 (towngate-01b) |
| Claude B3 | Bamboo above HIGH sent "to the composter" is a dead end: bamboo is not compostable and is protected | Bamboo is kept; its sink is planks and fuel; there is an alarm, and the owner decides if it piles up (§3, §9) |
| Claude B4 | The junk row misstated today's well rules, and a zero mark could strip the 64-block escape stone | Today's rules stand unchanged; `STONE_GUARD`, `COBBLE_RESERVE`, `COBBLE_WELL_RESERVE`, `PATHFINDER_SCAFFOLD` and `scaffoldKeep` are named as kept (§3) |
| Codex 2 | Whole-bill admission can never start a large ziggurat under bounded stock | Instances are funded by phase (§6) |
| Codex 3 | Parts made only against a bill, and a bill admitted only with its parts, is a deadlock | A planned instance authorizes its own parts (§6) |
| Codex 4 | The conservation check left out scaffold, travel placements and conversions | All outflows counted; internal transfers net out; `_overflow` is a subset of the well (§9) |

Non-blockers adopted: the stage 6 baseline is named (`build_shop` ≈ 330/h); gather advice stays for a bot below `bagKeep`.
