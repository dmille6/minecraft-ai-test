# Town projects: real uses for surplus, built by the bots (design r5, 2026-10-15)

OWNER 10-14: "instead of limiting resources like logs and copper can we find real useful uses for them? and put the bots to
real work using real resources" -> "yes do it". Roadmap 10-08: Foundation -> Last -> **Build** -> **Cooperate**.

Analysis and design only. No fleet code, no queue entry, no world touched. Reads were ES aggregations and one bounded
3 h row stream on 10.0.0.31 under `nice` (no canary file read touched).

**History:**
- r1: Codex CHANGE, Claude CHANGE.
- r2: Codex CHANGE (P2/P3 only; the geometry was confirmed by a probe), Claude APPROVE with P2s.
- r3: Codex CHANGE (P2 x3, P3 x3), Claude APPROVE with P2s.
- r4: Codex CHANGE (P2 x2), Claude APPROVE (P2 x1, the same bound as one of Codex's).
- r5: Codex APPROVE, Claude APPROVE. One P3 (units) was applied after the approvals.

Section 11 has the record.

## 0. Answers first

**Material is not the constraint; labour, logistics and construction geometry are.**
- An average world (16 physical worlds) holds about 650 raw copper, 640 logs, 250 coal, 110 iron ingots and 280
  cobblestone in its chests, plus ~1,100 cobble in its bags.
- The projects below need 100-700 of any one material.
- What is missing is a deterministic chain: stock -> parts -> placed blocks.

**The bots are near town, but how much of that time is free for project work is not yet measured.**
- 48.5% of bot-time is within 48 of home (section 1.3).
- That is an UPPER BOUND on project time. Stage 1's dry run measures the real budget: the share of at-town decisions
  that reach the empty slot after the room order.

**Five facts that shape the design:**
1. **Nothing above pad+2 can be started from the pad.**
   - A top-face click needs the eye above the face (plinth `standFor`). From the pad, the eye is at s+2.62.
   - Every roof and every third wall course therefore needs a raised stand.
   - Section 4.0 adopts TERRACED CONSTRUCTION. Each storey is 2 high and built from a 1-high step ring, and a storey
     above it is built from the roof below it, reached by the plan's own stair.
2. **Copper bulbs need a blaze rod (Nether only), so they cannot be made.** Copper lanterns, torches, chests and bars do
   not exist on 1.21.8 (they arrived in 1.21.9). Lighting is torches and iron lanterns.
3. **Code that already disagrees with "use the surplus":**
   - `stone_bricks` and `smooth_stone` are on the junk well's list (well.mjs `SCAFFOLD_DECORATIONS`).
   - Planks, logs and stone bricks are pathfinder scaffold (scaffold.mjs).
   - `raw_copper` and `copper_ingot` are DEPOSIT_ALWAYS.
   - Coal and charcoal are never town-banked (towndeposit IRON_LADDER).
   - Each stage below names which of these it changes.
4. **The blueprint builder has never run on the fleet.** treefarm-01 was registered on 10-06 and never launched. The
   newest placement planner is plinth-01's (queued). Stage 3 generalises plinth's planner and takes blueprint.mjs's
   record, lease and witness.
5. **Isolated pools.** Five bots share one physical town, but have five pool-keyed claim journals, wells and records
   (`townDir = poolStateDir(memory.pool)`). They are **excluded from v1**: D2.

**Recommended order (owner decision D7; changed from the original order after review):**
1. a composite smelt job, plus counts for copper and fuel;
2. a **structure dig guard** (it protects the plinth and well at once, and projects later). **Coordinate with
   minewell-01**, which the operator planned at 10-15 00:15Z after wellsite-02's false trip: a control bot's `mine`
   staircase dug a well's wall and floor, and mine's direct digs ignore the well keep-out. minewell-01 is the
   mine-side guard for the well and plinth shell. Stage 2 GENERALISES that guard (every reserved structure cell, at
   the `bot.dig` entry); it does not build a second one;
3. a **workshop yard** (a pad and a furnace line, nothing above pad+1: the simplest blueprint, and it serves copper at
   once);
4. load-and-leave furnaces;
5. the **storehouse** (the first roofed building);
6. the **landmark hall**;
7. demand-driven targets, only if stalls show they are needed.

## 1. What was measured (10-14)

### 1.1 Town stock (the operator's 22:12Z census, given)
- **Containers:** 352 town containers in 16 worlds (32 software towns: 12 shared and 20 isolated); 0 full; 2,199 of
  9,504 slots used.
- **Top items:** raw_copper 10,504; oak_log 9,135; cobblestone 4,448; coal 4,008; iron_ingot 1,815; stick 1,333;
  birch_log 1,020; torch 960; oak_planks 952; lapis 868; oak_sapling 640; raw_iron 498.
- **Bags:** median 34 of 36 slots; cobble is the biggest slot user (~17.6k).
- **Storage is not scarce: 23% of slots are used.**
- **The per-world split of copper is not in hand.** Stage 6's pre-check is a read-only per-world RCON census, and it
  picks the hall variant per world (4.3).

### 1.2 Production, last 24 h
ES, 1,400,226 skill docs from 80 bots. Caveats: one rotation crossed; the newest 4 min are unreconciled.

| | count/24 h | detail |
|---|---:|---|
| gather success | 13,763 | |
| craft success | 790 | stone_pickaxe 386, furnace 128, crafting_table 91, wooden_pickaxe 60, iron_pickaxe 44, stick 34, ... |
| smelt success | 318 | raw_iron 308, **raw_copper 5**, cobblestone 2, logs 2, sand 1 |
| town_deposit / deposit success | 183 / 289 | |
| deaths | 35 | |

- **Copper is banked (~449/day on 10-10) and almost never smelted.**
- **128 furnace crafts/day is a count of crafts, not placements.** How many end up abandoned in the world is NOT
  measured. Stage 4 measures furnace placements before treating "fewer scattered furnaces" as an outcome.
- **Positive control:** the same terms query that finds raw_copper=5 finds raw_iron=308, in a window of 1.4M docs from
  80 bots.

### 1.3 Time near town, last 3 h
Method: ES rows, time-weighted per bot, intervals capped at 300 s; homes from the harness env files.
Positive control: 80 of 80 bots carry `bot.pos`, and every pool totals 14.1-15.0 of 15 possible bot-hours.

| distance from home | <= 16 | 16-48 | 48-96 | > 96 |
|---|---:|---:|---:|---:|
| share of bot-time | 11.6% | 36.9% | 29.6% | 21.9% |

- **Time at town (<= 48) is 25% (board-b) to 70% (hive-c).**
- This is presence, not availability. Whether a furnace at the yard is TICKING (inside some player's simulation
  distance) is not established by distance-to-home. Stage 4 measures it directly as load-to-collect latency.

## 2. Uses for surplus

**Sources:**
- 1.21.8 recipes come from the fleet's own minecraft-data 3.112.0 (`require('minecraft-data')('1.21.8')`). Codex and
  Claude each re-checked them.
- Smelting and fuel come from minecraft.wiki: minecraft-data ships no smelting or fuel data (smelting.mjs header).

| from | to | recipe (1.21.8) | grid | useful for |
|---|---|---|---|---|
| any log | planks | 1 -> 4 | 2x2 | everything wooden |
| planks | stick | 2 -> 4 | 2x2 | torches, ladders, fences, rails |
| planks + slabs | **barrel** | 6 planks + 2 slabs -> 1 (≈ 7 planks) | table | storage that opens with a block on top (code: "barrels open under anything", skills.mjs:2757), so it stacks two high |
| planks | chest / door / trapdoor / stairs / slab | 8->1 / 6->3 / 6->2 / 6->4 / 3->6 | table | storage, trim (doors: v2, a block state) |
| planks + stick | fence / gate | 4+2 -> 3 / 2+4 -> 1 | table | pens, rails |
| stick | ladder | 7 -> 3 | table | mineshaft (roadmap) |
| log | charcoal (smelt) | 1 -> 1, 10 s | furnace | fuel and torches |
| raw_copper | copper_ingot (smelt) | 1 -> 1, 10 s; blast furnace 5 s | furnace | everything copper |
| copper_ingot | copper_block | 9 -> 1 (and 1 -> 9) | table | 9x compaction; roofs |
| copper_block | **cut_copper** | 4 -> 4 | **2x2** | roofs; cut stairs 6->4, slab 3->6, chiseled 2 slabs -> 1 |
| copper_block | copper_grate | 4 -> 4 | table | see-through walls and floors |
| copper_ingot | door / trapdoor / lightning_rod | 6->3 / 6->2 / 3->1 | table | the rod: landmark spire (no oxidation in 1.21.8) |
| copper_block + **blaze_rod** + redstone | copper_bulb | | | **NOT POSSIBLE: Nether only** |
| — | copper_lantern / copper_torch / copper_chest / copper_bars | | | **not items in 1.21.8** |
| cobblestone | stone (smelt) | 1 -> 1, 10 s | furnace | (furnace only, never a blast furnace) |
| stone | **stone_bricks** | 4 -> 4 | **2x2** | walls (D8: on the junk list today); stairs 6->4, slab 3->6, **wall 6->6**, chiseled 2 slabs -> 1 |
| stone | smooth_stone (smelt) | 1 -> 1 | furnace | blast furnace (junk list today) |
| cobblestone | wall / stairs / slab / furnace | 6->6 / 6->4 / 3->6 / 8->1 | table | pads, trim, furnaces |
| coal or charcoal + stick | torch | 1+1 -> 4 | 2x2 | light |
| iron_ingot | iron_nugget | 1 -> 9 | 2x2 | lanterns |
| 8 nuggets + torch | **lantern** | -> 1 | table | light; standing when placed on a top face |
| iron_ingot | iron_bars / hopper (+chest) / bucket / rail (+stick) / minecart | 6->16 / 5 / 3 / 6->16 / 5 | table | windows; later the auto-smelter and the mine rail |
| iron + furnace + smooth stone | blast_furnace | 5 + 1 + 3 | table | 2x ore speed |
| lapis_lazuli | lapis_block | 9 -> 1 | table | accent |

**Fuel** (minecraft.wiki, Java):
- Cook time per item: furnace 200 ticks (10 s); blast furnace and smoker 100 ticks (5 s), burning fuel twice as fast,
  so fuel per item is the same.
- Items smelted per fuel: coal or charcoal 8; coal block 80; log 1.5; planks 1.5; stick 0.5; lava bucket 100.
- Unloaded chunks: "Smelting is suspended if the chunk the furnace is in becomes unloaded."
- The blast furnace smelts raw metal, ores and metal tools only.

**Oxidation** (minecraft.wiki):
- Random-tick only. The chance of entering pre-oxidation is 64/1125 per random tick, about every 20 min on average;
  advancement then depends on nearby copper.
- Waxing needs honeycomb, which the fleet does not make, so roofs green.
- A lightning strike on the rod scrapes nearby copper back (cosmetic).
- **Nothing depends on the rate.** Correctness does depend on the oxidation FAMILY (3.2).

**What each surplus is for:**

| surplus (fleet) | per world | use, in priority order | sink per project (section 4) |
|---|---:|---|---|
| raw_copper 10,504 | ~656 | smelt -> ingots (stage 1) -> blocks -> cut-copper roof; lightning rod | hall S 327 / M 579 / L 903 |
| logs 10,155 | ~635 | planks -> barrels, roofs, tables; log pillars | yard 0, storehouse 52, hall 8 |
| cobblestone 4,448 (+~17.6k in bags) | ~280 (+~1,100) | pads (bring your own ground), furnaces, step rings; smelt to stone -> bricks (D8) | yard 111, storehouse 150, hall M 207 |
| coal 4,008 | ~250 | smelting fuel (the whole copper backlog needs 1,313, a third of the stock), torches | hall M ~88 |
| iron_ingot 1,815 | ~113 | lanterns, bars; v1b blast furnaces (5 each); later hoppers and rails | hall M 12; blast x2 10 |
| sticks, torches | | light | 1-6 per project |
| saplings | | the tree farm (treefarm-01, designed) | — |

**Charcoal is deferred (D4).** Coal covers the copper backlog three times over. Coal and charcoal are never town-banked
(IRON_LADDER), so a town fuel reserve cannot even be read today. And logs give 6 items of fuel each as planks with no
furnace time, against 7 net as charcoal. Charcoal returns as the renewable fuel when measured coal stock falls toward a
reserve: the "Last" track.

## 3. The TOWN PROJECTS model

### 3.1 The record and the switches
- **One record per town,** `townprojects-<home>.g<N>.json`, in the town's state directory:
  - generation files created with `link()` (one writer per N, never pruned; blueprint.mjs);
  - a record from another world (`sameWorld`) counts as absent.
- **v1 runs only where `MEMORY_SCOPE=shared`** (12 towns, one per world). Isolated worlds get no projects until town
  state is keyed by world (D2).
- **Contents:**
  `{ v, world, home, cursor, projects: [{ id, blueprint, version, variant, state, site, cells: [{x,y,z,want,family,role,seq}], route, sitedAt, completedAt, stalledAt, abandoned: [...] }] }`.
- **States:** `queued -> sited -> building -> complete`, or `building -> stalled -> abandoned -> (re-sited | skipped)`.
- **The list is fixed in code:** yard -> storehouse -> hall.
- **The furnace and project leases** have a TTL (4 min, renewed at each mutation), so a crash mid-session frees them.
  They are keyed by the town directory, so isolated bots get no cross-bot exclusion, the same as today.
- **`TOWNPROJECTS_BLUEPRINTS` enables blueprints per stage.** The cursor only advances into an enabled one; a
  disabled one stays `queued`. Readers accept unknown later versions as "not mine", so a reverted stage's record does
  not break the earlier stage.
- **WIP limit 1:** one active project per town.

### 3.2 Siting, progress, completion, giving up
- **Sited once, under the town lease** (3.4). The blueprint is fitted and the absolute cells are frozen, with the plan's
  placement sequence proven offline (4.0).
- **Admission by recipe-aware allocation**, `allocate(bom, route, stock)`:
  - finished parts are counted first, then intermediates, then raw inputs and fuel;
  - only SPENDABLE stock counts: town containers (counted, 3.3a), plus the bag minus its keeps (the exit-contract 64
    scaffold, STONE_GUARD, townKeeps, withdraw holds);
  - a project is sited only if the whole BOM allocates against 80% of that stock;
  - so a town that already compacted its copper into blocks qualifies;
  - the hall picks the largest variant that allocates;
  - **the average world (656 raw copper) qualifies for hall S, not M.** M needs >= 724 copper-equivalent; L >= 1,129.
- **Progress is the world**, never a saved index. A cell is DONE when its block is in the cell's family:
  - copper's four oxidation stages and their waxed forms;
  - barrel or furnace in any facing, lit or not;
  - a log of the wanted species in axis y;
  - lantern in either `hanging` state.
  - Without families a greening roof reads as foreign and stalls the project.
- **Complete** is recorded after one census visit reads every cell done. The cursor then advances.
- **Unknown cells** (unloaded) get a SURVEY order: walk to within 32, re-read. This is never a failure.
- **Blocked cells** (a foreign block, never demolished) and no confirmed placement for 72 h make the project `stalled`.
  After 24 h more stalled it becomes `abandoned`:
  - its unbuilt cells are released;
  - the blocking cells go on the town's avoid list;
  - the project is re-sited with the same cursor;
  - after two abandonments it is `skipped` and the cursor advances.
  - The read reports every stall, abandonment and skip. Nothing waits forever.
- **A complete project is not finished forever** (Codex r3).
  - A census visit that finds a cell missing (a furnace broken, a wall block dug) reopens it to `building` for those
    cells only; progress is the world.
  - A station project whose stations are marked `unreachable` (3.5) goes `abandoned` and is re-sited like any other.
- **Standalone jobs have a terminal state too.** `smelt_town` and `furnace_drain` belong to no project. Six
  consecutive skips or failures of one bot's job for the SAME reason pause that job in that town for 6 h
  (`paused:<reason>`, recorded and read).

### 3.3a Counting what the design reads (stage 1 deliverable)

**The problem** (both r2 reviews). The town count journal records only targeted groups (`stockCounts`). It does not
count raw_copper, ingots, coal or parts.

**Stage 1 extends the count record's `m`** with a named, closed set: `PROJECT_COUNTED`.
- Contents: raw_copper, copper_ingot, copper_block, cut_copper, coal, charcoal, iron_ingot, stone_bricks, and later
  each stage's parts.
- These are counted and NEVER targeted. They carry no bank cap and no prune.
- Every container open already counts. This adds names, not trips.
- `smelt_town` additionally decides from the chest it actually opens: no copper there is a skip, never a failure.
- Stage 4 counts yard furnace slots as their own container kind.
- **"Town storage" is the 16-block cylinder around home** (`STORAGE_NEAR`, chestfull `inTown`, the count scan, the
  town deposit). Claude r3 R1 found this, and it decides where the storehouse may sit (3.4).

### 3.3 Holds: never prune, dispose or scaffold away what the project needs
- **Parts are protected and untargeted.** The new part groups are cut_copper, copper_block, stone_bricks,
  stone_brick_wall, iron_bars, lantern and lightning_rod (barrel is already protected).
  - They join `PROTECTED` (never pruned) AND the well's `NEVER_DISPOSE` (well.mjs:117; PROTECTED alone does not reach
    the well).
  - They join a `PROJECT_PARTS` bank set (banked whenever carried, like DEPOSIT_ALWAYS), from the stage that first
    makes them. Barrel joins it in stage 5.
  - With D8, `stone_bricks` also leaves scaffold.mjs's list. Helpers carrying bricks outside a build visit then cannot
    spend them on pillars.
  - They are never targets. Target 0 would read as "at target" and send them down the well, as Claude r1 found.
  - **D8:** `stone_bricks` and `smooth_stone` leave `SCAFFOLD_DECORATIONS`, and so the well's junk list, from stage 4
    (smooth stone for the blast furnaces). Otherwise the hall walls are cobblestone.
- **Targeted raw is allocated, not netted** (Codex r1 P1), for cobble, logs, planks, stone and sticks:
  - **floor'(g) = base(g) + allocated(g)**, where allocated(g) is what the active project's open cells have reserved
    of g in any form along the route;
  - production cannot release the hold: 64 cut_copper held for 64 open roof cells keeps all 64 reserved;
  - **the hold raises ONLY the disposal floor** (`disposePlan` at-target, prune's available floor), **never the bank
    cap**. Otherwise it would stock the town up: that is procurement, stage 7, and it would confound the DiD (Claude r2
    N3);
  - it ships in **stage 5** (the storehouse), the first project that draws targeted raw from chests in quantity. The
    yard's 111 cobble comes from bags.
- **Allocation is a pure function, not a ledger** (Codex r2/r3).
  - `allocate(open cells, route, counted town stock)` is recomputed at every decision. There is no stored ownership
    to reconcile or leak.
  - Every project job is a single composite skill that withdraws only what it consumes in that skill, and deposits the
    remainder in a `finally`.
  - **When the `finally` cannot run** (a disconnect, a hard stop), the skill has already written a CARRY NOTE (bot,
    items, time) before its first withdraw.
    - At the bot's next decision at town, the town deposit banks the noted items FIRST, whatever the slot count.
    - Each return is capped at what the bot holds MINUS the town deposit's own keeps (stockpile 64, the active rung's
      wants), so a return never re-opens a gather rung (Claude r4 P3).
    - The note expires after 30 min.
    - Carried stock consumed meanwhile (the model's craft, a reflex pillar) is ordinary consumption. It shows up as
      less town stock at the next allocation, which means a wait, and at worst a stall (3.2).
  - The read reports carry notes opened, returned and expired.
- **Intermediates are just-in-time.** Stone is smelted only in batches the same job crafts straight into bricks (at most
  64 at a time), so stone never sits above its 64 target.
- **Scaffold.** During a build visit, the builder's Movements remove the visit's materials from `scaffoldingBlocks`,
  so the pathfinder cannot spend the roof on a pillar. The read reconciles the builder's bag delta against confirmed
  placements plus scaffold place events.
- **Demand-driven procurement targets** (raising targets to make the town STOCK UP for a project) are stage 7. They are
  built only if stalls show town stock running short, which admission makes rare.

### 3.4 Leases and reservations
- **The town siting lease** is world-keyed and covers every structure's siting: projects now; well, plinth and town
  floor when their owners adopt it. Reservations are published atomically as the next generation of
  `townsites-<home>.g<N>.json` (`link()`).
  - A siter re-reads after publishing, and the lower generation wins an overlap.
  - Built cells stay reserved for the life of the structure.
  - An unbuilt reservation expires only through its owner's abandon rule.
  - **Two siting domains** (Codex r3 P2: the r3 boundary of 16 overlapped plinth stairs):
    - **The OUTER domain** (yard, hall) needs no shared file. Every cell AND every stand satisfies both bounds:
      - Chebyshev >= 22 from home (the inner bound);
      - STRAIGHT-LINE (horizontal Euclidean) distance <= 44, the outer bound. A Chebyshev-44 corner would be ~62
        out, beyond the Euclidean TOWN_RADIUS 48 that job eligibility and `furnace_drain` measure (both r4 reviews).
      - The plinth/well search reaches a cap at Chebyshev 14. Its stair reaches cap ± 6 (plinth `stairOptions`,
        `2 + j`, j <= 4), so radius 20, plus a 1-cell ring.
      - The town-floor job's domain must be DECLARED inside 21 (a constant in its code or doc) before stage 3
        launches. That is a prerequisite, not a request. If it is wider, stage 3 waits for the shared file.
      - Plinth `plan` + `prev[]` and the floor plan are still read as occupied.
    - **The INNER domain** (the storehouse) is inside the 16-block town-storage cylinder, so its barrels are counted
      and reached by the town deposit like any town chest (Claude r3 R1).
      - Siting there REQUIRES the shared siting file. The plinth/well and the floor job must publish through it first.
      - That adoption is a prerequisite of stage 5, listed in section 9.
    - Stale unbuilt reservations retire through each owner's own abandon rule. For projects that is 3.2's.
- **The project lease:** one builder per town, 4 min, renewed at each mutation. Its generation is a fencing token checked
  before every placement (plinth / blueprint.mjs).
- **The furnace lease, from stage 1:** per furnace, for the whole session, recovery included.
  - **ONE owner acquires it: the `smelt` skill's furnace-session function.** `smelt_town` calls that same function and
    never takes a lease of its own, so there is no nesting.
  - Today `smelt` takes the furnace's output, pulls foreign input and empties the furnace on exit (skills.mjs
    9673-9676), so two smelters at one furnace interleave.
  - A leased furnace is skipped: `smelt` tries the next furnace within reach, or places a furnace it ALREADY carries.
    A busy lease is never a reason to CRAFT a new furnace (that would recreate the scatter, Claude r2 N4); with none
    carried it returns `furnace_busy`, an unknowable class that teaches no avoid.
  - **From stage 3, yard furnaces are excluded from ordinary `smelt`.** Only the town jobs use them.

### 3.5 The refusal chain: every refusal has a deterministic next step

| wants to | finds | next step (an order or a state, never printed advice) |
|---|---|---|
| smelt_town / build / make_part / furnace jobs | no room for the batch | **a skip, not a refusal.** The bot has other legal moves and no message points it anywhere. At 34+ the town deposit, compost, the well and prune already run first. A job is eligible only with >= 2 free slots after them, and sizes its batch to free − 1. It does NOT ask for more room: `roomOrder` only knows eat, deposit and home (workorder.mjs `ROOM_ORDER_OF`), and a deposit forced for a project would dig into the town deposit's keeps and fight the milestone ladder (Claude r3 R2). Bounded by the project's stall rule or the standalone job's pause (3.2). The stage-1 read reports bot-hours "eligible but for room" |
| smelt_town | no furnace and none carried | before stage 3: craft a furnace inside the same skill (8 cobble from the bag or a withdraw), as `smelt` does today, but only when NO furnace exists within reach (a leased one is `furnace_busy`, a skip). From stage 3: the yard |
| any job | the station (table, yard) is unreachable | that job is skipped for 30 min, then retried; three unreachable reads in 6 h mark the station `unreachable` in the record, and the project's stall rule (3.2) takes it from there (an unreachable yard means re-siting it) |
| build | parts in town | withdraw (draw claims, sized to free slots) inside the build visit |
| build | cheap parts missing (planks, slabs, barrels, torches, nuggets) | crafted INSIDE the build visit from allocated raw (withdrawn), at the town table or in the 2x2 grid |
| build | furnace parts missing (stone bricks, copper blocks, cut copper) | the make_part job (section 5) is eligible for any bot. The builder releases the lease, then backs off 10 min |
| any | raw short after siting (another job took it) | rare, not impossible: prune and the well now respect the allocation, but the model's own deposits, withdraws and crafts still move stock. The project waits; it goes stalled -> abandoned -> re-sited or skipped (3.2), never forever |
| any | unknown cell | SURVEY order |
| site | no site, or the BOM does not allocate | `no_site` (24 h backoff) / `town_short:<group>` (6 h recheck); the hall drops a variant |
| build | lease held | free skip |

The chain is tested as a CHAIN through the real CognitiveLoop with a full bag, full containers, no table, no furnace and a
pending milestone rung (CLAUDE.md "test the refusal chain").

## 4. The projects

### 4.0 Construction geometry (both r1 reviews, P1)

**The placement rule** (plinth `standFor`/`standOk`, kept unchanged):
- A block placed on a TOP face at height y needs the eye above y. Feet must be at y−1 or higher.
- A side face needs reach (4.5 to the face centre), a clear sight line, and the target cell open.
- A bottom face is never used. A container or station is never the clicked block (a click opens it).
- Every stand must walk back to town.

**From the pad (feet s+1, eye s+2.62)** a bot can therefore place layers s+1 and s+2 only.

**TERRACED CONSTRUCTION, the v1 pattern:**
- A storey is a 2-high wall on a pad, with a 1-high STEP RING outside it at s+1.
- From the ring (feet s+2, eye s+3.62) the bot clicks the wall tops (face s+3), so the roof at s+3 starts from the walls.
- The roof's inner cells go on side faces of placed roof cells, from stands inside on the pad.
- The interior is 2 high (the bot is 1.8).
- A second level (the hall's roof terrace) is the same pattern again, one level up. The bot reaches it by a 1-wide
  stair in the plan (pad -> ring -> one stair block -> roof: each step +1, as plinth's stair does).
- **Falls:** the roof is at s+3, so its top is s+4. Feet on the roof are 3 above the pad and 2 above the ring.
  - The planner computes the drop against the ACTUAL terrain outside the ring: dug-out ground can be lower than the
    pad.
  - A site whose drop from a roof edge exceeds 3 (the first damaging height) needs that edge guarded before any stand
    nears it.
- **Stand margin, defined:** an edge is UNGUARDED where the cell beside a stand at foot level is air and the drop below
  it exceeds 3.
  - A roof stand must not be adjacent to an unguarded edge.
  - Parapet stands, one cell in from the edge, are legal: the drop beside them is onto the roof itself.
  - The stage 6 read uses this definition (Claude r2 N6).

**The offline proof gates siting:**
- A blueprint is accepted only when the planner proves a complete sequence. Every cell needs a stand, face, sight
  line and walk-back in the world as it will be at that step.
- The check runs on flat ground AND on real dug-out town terrain from the 16 worlds' region files
  (`wellsite-replay.mjs` style).
- **Before stage 3 the yard predicate runs on the 12 shared worlds, and the result is reported as n/12** (isolated
  worlds are excluded, D2). A canary pool is drawn only from towns with a site.

**Block-state rule:** v1 uses only blocks whose state is irrelevant or set by a TOP-face click:
- logs are axis y;
- lanterns are standing;
- the lightning rod faces up;
- barrel and furnace facing is cosmetic (read-back by family);
- wall and bar connections are computed by the server.

**Common site rules:**
- **Distance:**
  - yard and hall: the OUTER domain (Chebyshev >= 22, straight-line <= 44);
  - storehouse: the INNER domain (inside 16, through the shared siting file).

  See 3.4. The zone refuses discretionary digs only inside its square, which is why the dig guard (stage 2) exists for
  the outer domain.
- **Trees:** the outer band is where trees grow and saplings get planted (Claude r3 R6), so the 3-cell tree keep-out
  may make sites scarce. The n/12 census measures it before stage 3.
- **Keep-outs:**
  - containers and stations at Chebyshev 1;
  - the composter;
  - tree-farm cells and walkways;
  - **any sapling or tree within 3** (a grown canopy must not push logs into the footprint);
  - liquid within 1;
  - the reservations in 3.4;
  - a 1-cell ring around the footprint that is never placed into.
- **Placement only:** the only digs allowed are leaves and the plinth's replaceable plants (class `structure` in
  `_dig_town`).
- **Doorway:** 1x2 and open, with 2 walkable cells outside. `wouldEnclose` is checked before each solid placement.
- **Deterministic:** every bot computes the same site, and any unknown cell means "no site yet".

### 4.1 Stage 3 — WORKSHOP YARD (`yard@1`): pad and furnace line, nothing above s+1
- **Pad:** 9x7 cobblestone at s (63, plus hole fill).
- **The line, on the back row:** 6 furnaces and 1 crafting table, with the 1-cell aisle in front kept open (reserved
  from scaffold and placement).
- **No roof, no barrels.** Barrels would receive general deposits (`CONTAINER_RE` includes barrel). The roof and
  pillars come back as `yard@2` once the storehouse proves terracing.
- **v1b** (D6): 2 blast furnaces replace 2 furnaces.
  - Each takes 5 iron + 1 furnace + 3 smooth stone. Each smooth stone is 1 cobble smelted twice (cobble -> stone ->
    smooth stone), so each blast furnace needs 3 cobble and 6 smelts, and the pair 6 cobble and 12 smelts (2
    furnace-minutes).
  - It also needs D8 for smooth stone.
  - Throughput: 4 x 360 + 2 x 720 = 2,880 ore/h, against 2,160 (1.33x).

| BOM yard@1 | count | raw |
|---|---:|---|
| cobblestone pad | 63 (+fill) | 63 |
| furnace | 6 | 48 cobble |
| crafting_table | 1 | 1 log |
| **placements** | **70** | **111 cobble, 1 log** |

### 4.2 Stage 5 — STOREHOUSE (`storehouse@1`): the first roofed building
- **Pad:** 9x9 cobblestone (81).
- **Step ring:** the pad's outer ring at s+1, 31 cobble (a gap at the door).
- **Walls:** 7x7, 2 high, minus the doorway: 46 blocks, of which 8 are oak-log corner pillars and 38 are cobblestone.
- **Roof:** 7x7 oak_planks at s+3 (49).
- **Barrels:** 18, two high against the back and side walls (486 slots). They are the town storage, so receiving
  deposits is intended here.
  - **Order (Claude r2 N6):** the roof goes in BEFORE the barrels, while every roof cell's sight line is clear.
  - Lower barrels go on the pad's top face. Upper barrels go against the WALL's side face, never a barrel's: clicking
    a barrel opens it.
- **Light:** 4 torches on the floor.

| BOM storehouse@1 | count | raw |
|---|---:|---|
| cobblestone (pad 81 + ring 31 + walls 38) | 150 | 150 |
| oak_log pillars | 8 | 8 |
| oak_planks roof | 49 | 12.25 logs |
| barrel (126 planks incl. 36 slabs) | 18 | 31.5 logs |
| torch | 4 | 1 coal + 1 stick |
| **placements** | **229** | **150 cobble, 52 logs, 1 coal, 1 stick** |

### 4.3 Stage 6 — LANDMARK (`hall@1`, recommended): a copper-roofed hall with a roof terrace
**Variant M.**
- **Pad:** 11x9 cobblestone (99).
- **Podium ring:** stone_bricks at s+1 (35).
- **Walls:** 9x7, 2 high, stone_bricks with oak-log corner pillars: 50 blocks, after 2 doorway cells and 4 iron-bar
  windows. Of the 50, 42 are bricks and 8 are logs.
- **Roof:** walkable cut-copper at s+3 (63). It greens over time.
- **Stair:** 1 stone_bricks step block on the ring (a full block, not a stairs item).
- **Parapet:** stone_brick_wall around the roof edge (27; the server sets the connections), placed from the roof.
- **Lightning rod:** 1, on the roof centre.
- **Lanterns:** 6, four on the parapet corners and two inside.
- **If D8 is refused:** the bricks become cobblestone and cobblestone_wall, and the shape is unchanged.

| BOM hall@1 M | count | raw | furnace work |
|---|---:|---|---|
| cobblestone pad | 99 | 99 cobble | |
| stone_bricks (ring 35, walls 42, stair 1, 30 for 27 walls) | 108 | 108 cobble | 108 smelts |
| oak_log | 8 | 8 | |
| iron_bars | 4 | 6 iron (16 bars) | |
| cut_copper | 63 | 64 copper blocks = 576 ingots (one cut spare) | 576 smelts |
| lightning_rod | 1 | 3 ingots | 3 smelts |
| lantern | 6 | 6 iron (54 nuggets) + 6 torches (2 coal, 2 sticks) | |
| **placements** | **286** | **207 cobble, 579 raw copper, 12 iron, 8 logs, 2 sticks** | **687 smelts ≈ 86 coal; ≈ 19 min on 6 furnaces, 14 on 4+2 blast** |

| variant | walls (outer) | copper roof | raw copper | needs in town (80% rule) |
|---|---|---:|---:|---:|
| S | 7x5 | 35 (36 blocks) | 327 | 409 |
| M | 9x7 | 63 (64 blocks) | 579 | 724 |
| L | 11x9 | 99 (100 blocks) | 903 | 1,129 |

**Alternatives for D1:** (b) a bell tower: several terraced storeys with inner stairs, more planner work; (c) a gate and
plaza: low, a small copper sink.

### 4.4 Estimates (assumptions stated; each stage's Paper run replaces them)
- **The placement rate is measured:** plinth on Paper placed 84 in 98 s (3 visits).
- **Production overhead is assumed 3-5x:** walks, interruptions, cooldowns, 40 placements per visit, one builder.
- **Elevated stands** (the ring, the roof) add walk time that is not modelled.

| project | placements | crafts | smelts | builder bot-hours (est.) | wall clock once sited (est.) |
|---|---:|---:|---:|---:|---|
| yard | 70 | 7 | 0 | ~0.3 | < 1 h |
| storehouse | 229 | ~30 | 0 | ~1-2 | 2-5 h |
| hall M | 286 | ~120 | 687 | ~3-4 | 6-12 h |

No fleet-wide completion time is claimed. Completion is measured per town (section 7).

## 5. Production jobs (deterministic; never the model's choice; never printed advice)

**Every job:**
- is a pure `xOrder(readings) -> { order | skip }`, issued as a HOUSEKEEPING proposal through admission;
- has its cooldown charged at issue, and interruptions and skips cost nothing;
- runs in `cognitive.mjs` after town deposit, wear_out, the town orders, the well, prune and the room order, and only
  `if (!order)`.

So the milestone's ready rung always wins. Reflexes are untouched.

**The budget is BODY time, not decisions** (Codex r1 P2). At most 10 min per bot-hour, measured from each job's own
start/end rows, while the read checks gather and rung completions per bot-h DiD.

| job (stage) | eligible when (at town) | does, inside ONE skill budget (like `withdraw_pick`) | bounds |
|---|---|---|---|
| **smelt_town (1)** | the count journal shows raw_copper in a town container within the floor's hour (3.3a); >= 2 free slots after the town deposit; fuel in bag or town | withdraw up to 8 raw_copper (+ fuel if needed) -> furnace session (`smelt`'s own, with its lease) -> smelt (8 = 80 s) -> in a `finally`, deposit the ingots, any unspent input, and any PRIOR furnace output that `smelt` collected. One skill, so town deposit cannot re-bank the input mid-job (Claude r1 P1: raw_copper is DEPOSIT_ALWAYS). The chest it opens decides: no copper there is a skip | 1 per 10 min per bot; 20 min backoff on failure; 180 s budget |
| **build (3+)** | an open cell placeable now; materials allocatable | withdraw, craft cheap parts, place up to 40, each witnessed by a server packet, then deposit what is left | project lease + fence; 5 min cooldown |
| **survey (3+)** | the active project has unknown cells | walk within 32, re-read | 30 min cooldown |
| **furnace_drain (1)** | any furnace within TOWN_RADIUS 48 of home (straight-line; the whole outer domain is inside it) that EITHER holds output >= 8, OR is ORPHANED: not burning, no live reservation, and unchanged for > 1 h, holding ANYTHING (any output count, input, or fuel only); or is MIXED | take every slot it is eligible for, deposit, and write the same O/C session records as the job sessions, so the between-session check stays continuous (Claude r4 P3). Prior stock is booked apart. It ships in STAGE 1, so every later rollback baseline keeps a deterministic drain (Codex r3) | furnace lease; >= 2 free slots; 1 per 10 min |
| **furnace_load (4)** | a yard furnace is EMPTY, or LOADED with the same recipe and input room, and no unexpired RESERVATION already covers the shortfall it would serve | withdraw <= min(64, input room) + fuel for exactly that many items (from the fuel's own items per unit), put in, write the load record and its reservation | furnace lease |
| **furnace_collect (4)** | a yard furnace's output >= 8, or its input is exhausted | take the output (and leftover input and fuel once DONE), deposit, close the reservation | >= 2 free slots; lease |
| **make_part (6)** | the active project allocates a furnace part that is short, net of outstanding reservations | smelt (stage-4 loads) and craft into bricks or copper blocks / cut copper, bank as PROJECT_PARTS | as smelt_town |

**Furnace accounting (Codex r2/r3, Claude r3 R3), per furnace:**
- **Per session.** The window is read on opening (O) and on closing (C), and every transfer is recorded:
  - **input:** O.input + loaded = C.input + cooked + input_taken;
  - **output:** O.output + cooked = C.output + taken;
  - **fuel:** O.fuel + fuel_loaded = C.fuel + fuel_burned + fuel_taken.
  - `cooked` must come out the same from the first two equations and be >= 0, normalised by recipe (raw copper ->
    ingot 1:1).
- **Between sessions (load-and-leave cooks while nobody is there):** each open is checked against the previous close.
  - Input fell by k and output rose by k.
  - k <= floor((elapsed + p x T) / T) + 1, where T is the furnace's cook time (10 s, or 5 s for a blast furnace) and p
    is the cook progress read at the previous close (mineflayer `furnace.progress`, a 0-1 fraction; 0 when unread). The +1 allows the item
    that was partly cooked at the close (Codex r4 P2).
  - k >= 0, and fuel fell by at most k / 8 coal-units (+1 for the item burning).
- **ONE boundary for the stage-1 conservation gate**, per order, in copper-family units:
  - IN = opening bag + opening furnace contents (O) + withdrawals;
  - OUT = deposits + closing bag + closing furnace contents (C).
  - Closing contents are counted, so there is no separate in-flight allowance.
  - A mismatch either way is a defect, a gain included: a gain is an accounting bug that could mask a loss. A gain is
    first checked against the order's own `_pickups` rows (server auto-pickup cannot be refused) and toss rows. Only an
    UNEXPLAINED gain is a defect (Claude r4 P3).
  - A session whose O or C read is uncertain (a window that did not open, a timeout) is UNRECONCILED. It is reported
    as exposure and is never counted as conserved.
- **Reservations:**
  - A load record names the shortfall it serves.
  - It is due at its expected-done time + 30 min. When due, the next visit RECONCILES the furnace before anything
    else: surviving input or output stays attributed, and only the uncovered remainder is released (Codex r3 P3).
  - Two loads can never both claim one shortfall.

**Per-furnace states (stage 4):** `EMPTY / LOADED(recipe, in, fuel) / DONE(out) / MIXED (foreign)`, from the window at
every open. A MIXED furnace (a non-job put something in) is drained by `furnace_drain`, then marked EMPTY.

**Throughput (the copper backlog, 10,504 raw):**

| route | furnace time | bot body time | fuel |
|---|---|---|---|
| stage 1 smelt_town (8 per order) | 29.2 furnace-h fleet | ~1,313 orders x ~100-120 s ≈ 36-44 bot-h if ALL copper were processed; a FLEET-AVERAGE world (656) needs ≈ 2.3-2.8 bot-h. The 12 shared worlds' own subtotal is not in hand: stage 1's pre-launch census measures it, and the isolated worlds' copper waits for D2 | 1,313 coal (33% of stock) |
| stage 4, 6 yard furnaces per world | ≈ 18 min ticking for an average world (656 / 2,160 per h) | ~22 load/collect visits ≈ 0.2 bot-h | same |
| stage 4 v1b (4 + 2 blast) | ≈ 14 min ticking for an average world | same | same |
| ongoing inflow | 449/day fleet ≈ 28/world/day | ~4 visits per world per day | ~56 coal/day |

## 6. Roles and cooperation

**Evidence first:**
- the deterministic shadow mayor's assignment equalled random on every duty (registered read, 10-06, 11,008 snapshots);
- C2 found no benefit from a big-model overseer (10-08).
- So there is **no central assigner in v1**.

**Roles emerge from leases.**
- Every bot at town evaluates the same job list. The project, furnace and siting leases make the jobs exclusive, and a
  held lease is a free skip.
- A fixed rotation of preferred first jobs by bot letter spreads the contention. It is **not claimed to improve
  output**; the mayor read says rules of this class equal random.
- Rotation: Alpha build; Bravo smelt or load; Comet collect; Delta make_part; Echo none.
- The read measures lease skips per job, so contention is visible.

**The gatherer is the default.** A bot with no eligible job, or with a ready rung, does exactly what it does today.

**The overseer later.** The record and the job list are the "town-stock record the overseer reads" from the roadmap.
An overseer reordering projects or choosing variants is a later shadow experiment against this baseline.

## 7. Measurement

Each stage is its own ordinary canary. One at a time. DiD against randomized control pools; never canary-vs-fleet.

**Promotion needs END-TO-END exposure, not just liveness** (Codex r1 P2). Every defect gate has a failing fixture in
the read's self-test. Every read has a deadline after which an unexposed canary closes INCONCLUSIVE.

| stage | liveness | end-to-end exposure (KEEP needs it) | deterministic gates (REVERT on defect) | positive controls | primary (reported) |
|---|---|---|---|---|---|
| 1 smelt_town | `_smelt_town`, `_furnace_drain` rows | >= 20 orders that withdrew copper and deposited ingots (server bag deltas and chest counts) | a copper-family mismatch EITHER way at the one boundary in 5 (unreconciled sessions reported, never counted as conserved); an order while a rung order was ready; two sessions in one furnace window; a drain of a furnace with a live reservation | control `smelt` successes (raw_iron ~300/day), and **the iron rung's own `smelt` successes as the named control row for the lease's effect on every bot** (Claude r3 R7); canary towns hold raw_copper (pre-launch RCON census) | ingots made per bot-h; town raw_copper fall (RCON census pre/post, canary vs control towns); gather and rung completions per bot-h DiD within the null; body time per bot-h; `furnace_busy` skips |
| 2 structure guard | `_dig_guard` refusals | >= 5 refused discretionary digs of reserved cells that townzone itself did NOT refuse (outside its square, or a class it passes), with the server cell intact after. The base rate comes from `_dig_town` before launch. If it cannot reach 5 by the deadline, the guard is not canaried alone: it ships with stage 3 as a separately flagged component (Claude r3 R4) | a reflex dig refused (`survival` or reflex-held body); a pathfinder retry loop on a refused cell (> 3 refusals of one cell in 60 s by one bot); a dig of a reserved cell that the guard passed without an exemption | control `_dig_town` digs of the same cell classes (the instrument sees them); the guard's fixture refusals in the read's self-test | immobile and stuck DiD (it must not trap bots); refused digs per bot-h |
| 3 yard | `_project_place` | >= 1 yard complete (RCON reads every cell in the family) | off-plan placement; two builders' mutating visits overlapping; a builder dig outside the plan's own clear list; two projects sited in one town; builder bag delta not = confirmed placements + scaffold, reflex-pillar and rescue placements; `smelt` (not a job) opening a yard furnace | RCON census of the record's cells; control towns no project rows | time to complete; builder body time; immobile DiD; deaths (two-death floor) |
| 4 furnace jobs | `_furnace_load` / `_furnace_collect` | >= 10 load -> transform -> collect cycles | the per-session equations (with input_taken and fuel_taken) inconsistent; a between-session continuity breach (k < 0, or k > floor((elapsed + p x T) / T) + 1, T per furnace type); fuel balance broken; a load into a non-yard furnace; two reservations on one shortfall | RCON `data get block` of yard furnaces | load-to-collect latency (ticking exposure); copper processed per day; furnace placements per bot-h DiD |
| 5 storehouse | as 3 | >= 1 storehouse complete, and >= 1 TOWN DEPOSIT into its barrels | as 3, plus a roof stand adjacent to an unguarded edge (4.0's definition); a prune or throw below floor' | as 3 | as 3; prune volume DiD; **full-bag bot-hours DiD**: a floor' hold can stop the well throwing bag cobble while a project runs, so bags stay fuller (Claude r3 R5) |
| 6 hall | as 3 | >= 1 hall complete | as 3, plus a placement into a cell already in its family (oxidised cells must not be re-placed) | as 3 | copper consumed |
| 7 demand | `_stock_demand` | >= 1 bank decision the raised cap admitted | demand above DEMAND_CAP; demand from a stalled or skipped project | stocktarget gates on control | stalls per town |

**Small n is stated, not hidden.**
- A 5-bot canary pool is one town, and completion is binary on 1-4 towns. It is a DEMONSTRATION, labelled as one.
  Causal claims come only from the DiD rows.
- Rare outcomes (deaths) stay tripwires (two-death floor).

**The roadmap's weekly long-run check** (`scripts/host/townweekly.py`, built alongside stage 3) is DESCRIPTIVE and never a
verdict. Per world:
1. Did it build something from its own materials? A complete record whose cells RCON reads in-family. There are no
   world edits, and the placement rows' bag deltas show every block came from a bag.
2. Did deaths and immobile bot-hours per bot-hour stay low?
3. Did items per bot-hour hold (`scoreboard.py` only)?

## 8. Composition: what else touches a project

| other code | hazard | guard |
|---|---|---|
| `gather` / pathfinder digs | chops the storehouse's log pillars, mines its walls | project cells in every profile's `exclusionAreasBreak` before the clones share the arrays; filtered from gather's `findBlocks` targets (treefarm pattern) |
| **direct `bot.dig` callers** (`mine` stair cells and their retries, make-room, the ore tunnel) | bypass pathfinder exclusions (Codex r1 P1) | **STAGE 2, its own canary: a structure guard in its OWN wrapper on `bot.dig`.** digtown.mjs stays telemetry-only, as its header requires (Claude r2 N2). The guard refuses a dig of a RESERVED cell (plinth shell, well ring; project cells from stage 3) with a typed `StructureDigRefused`, which the pathfinder and `mine` treat as a non-retryable cell (a cost, not a loop). **Exemptions are decided by authority, not by a telemetry label** (Codex r2/r3, Claude r3). The authority is named exactly, and checked BEFORE any pathfinder-mining label (digtown's `digPurpose` checks `pathfinderMining` first, which is why a reflex escaping through `goto` reads as `transit`):
(a) the dig's call chain runs inside the reflex tick's async scope (digtown's `{ survival, reflex }` AsyncLocalStorage scope, which follows the chain into `goto`);
(b) the body arbiter's grant is held by a reflex AND it is the CALLER's own operation grant, captured when that operation started (not a fresh sample of the current holder at dig time), so a stale skill unwinding after preemption does not inherit the exemption (Codex r4 P3);
(c) the builder's own clears, by cell, from its plan's clear list under its fenced lease.
Stage 2 enumerates every reflex path that digs WITHOUT a grant (reflex.mjs ~4373 yields without claiming; the escape and entombment paths) and gives each its own chain test. The integration review also covers stale-skill digs, reflex `goto` digs and legacy paths. Chain tests: a bot entombed against a project wall still gets out; `mine` through a reserved cell outside the townzone leaves the server cell intact |
| pathfinder scaffolding | spends parts; places into doorway or aisle | parts out of `scaffoldingBlocks` during build visits; doorway, aisle and ring in `exclusionAreasPlace` |
| chest-full recovery, `place`, the composter site, well and plinth site search, planting | puts things in the footprint | `projectReservedCells` through `reservationAwareRead`, as for the well and the farm |
| `smelt` (milestone) | interleaves with job furnaces; drains yard furnaces | the furnace lease (stage 1, one owner: `smelt`'s session); yard furnaces excluded from `smelt` (stage 3), tested with a competing iron rung |
| the junk well | throws stone bricks and smooth stone (junk today) | D8, else the cobble variants; parts in PROTECTED; a structural test: no enabled blueprint's material is in WELL_JUNK |
| stocktarget prune, the well, banking | takes allocated raw; re-banks a job's withdrawn input | floor' allocation holds (3.3, stage 5; the disposal floor only, never the bank cap); composite skills that deposit their remainder in a `finally` (5) |
| townzone-01 | none: it refuses discretionary digs; project clears are `structure` | — |
| town floor (parallel design; `townfloor-2026-10-14.md` not yet on main) | fills a doorway or interior; overlapping plans | the siting file (3.4), proposed to that author and not edited here. Until it is adopted: project siting avoids its plan's cells + 3, and the floor job is asked to treat `projectReservedCells` as occupied and a project pad as filled ground |
| saplings and trees | a canopy grows into the footprint | 3-cell keep-out from any sapling or tree at siting; a later foreign leaf in a cell is a `structure` clear |
| copper oxidation, lightning | a greening roof reads as foreign | cell families (3.2) |
| isolated pools | five journals over one set of chests | excluded in v1 (D2) |
| a REVERTED stage | the structure stays in the world, unprotected; furnace contents stay | **Structures:** a deliberate, stated loss. One world's structure may be dug (the stage-2 guard reads project records only from stage 3, so a stage-3+ revert leaves them unguarded); no item is lost. **Furnaces:** guaranteed recovery. `furnace_drain` ships in STAGE 1 and covers every furnace within 48 of home, so every later rollback baseline drains yard furnaces deterministically. Reservations due after a revert are simply abandoned records, and the drain empties what they covered. Leases expire by TTL |

## 9. Staging, effort, risks

Each stage is its own canary (ordinary class), after the current queue: stocktarget-02 -> wellsite-02 -> airpocket-03
-> townzone-01 -> plinth-01 -> bamboo-02.

| # | stage | needs | effort (agent-days, incl. both reviews + Paper) | main risks |
|---|---|---|---|---|
| 0 | prerequisites | plinth-01 (a placement planner proven on the fleet; blocked 10-15 until wellsite-03 is kept), townzone-01, minewell-01 | — | a plinth REVERT or a long block delays stage 3's planner base |
| 1 | **smeltjob-01**: composite `smelt_town` with its carry note; `furnace_drain`; the furnace lease (one owner: `smelt`'s session); `PROJECT_COUNTED` in the count record; the standalone pause state; dry-run measure of the free decision share and of "eligible but for room" | — | 4-6 | body time displacing gathering (budgeted, DiD); the lease changes the milestone `smelt` too (`furnace_busy`) |
| 2 | **structureguard-01**: the `bot.dig` guard over reserved cells (plinth shell and well ring now; project cells later), typed refusal, reflex exemption by authority (8). **Built on minewell-01** (operator plan 10-15 00:15Z: mine refuses to dig a known well/plinth shell, with an executable relocate remedy): generalise it, never duplicate it. If minewell-01 already covers every direct-dig caller, stage 2 shrinks to adding project cells to its reserved set in stage 3 | minewell-01; plinth-01 (now blocked until wellsite-03 is kept) | 2-5 | trapping a bot (the entombment chain test; immobile DiD); the hot path |
| 3 | **yard-01**: generic builder (`project.mjs`: plinth's planner over any frozen cell list + blueprint.mjs's record, lease and witness), the yard blueprint (outer domain), yard exclusion from `smelt`, the section 8 exclusions, the n/12 site census first; `townweekly.py` alongside (a read script, not canaried) | 1, 2, the floor job's declared domain (3.4) | 8-11 | siting on dug-out ground outside the zone (n/12 measured first); lease contention |
| 4 | **furnaceline-01**: furnace_load/collect, accounting and reservations, furnace slots counted; v1b blast furnaces (D6, D8) | 3 | 5-8 | ticking exposure (measured as latency) |
| 5 | **storehouse-01**: terraced construction (ring stands, roof before barrels), barrels in the INNER domain (town storage), floor' allocation holds | 3, **the shared siting file adopted by the plinth/well and the floor job** (a small change to each, by their owners) | 6-9 | roof sequencing (Paper on real terrain fixtures) |
| 6 | **hall-01**: roof terrace via the plan's stair, parapet, copper and brick chains, make_part, per-world variant | 4, 5, D1, D8 | 6-9 | the longest chain (687 smelts, ~120 crafts); stands on the roof |
| 7 | **projectdemand-01** (only if stalls show stock short) | 5 | 3-5 | demand pinning stock (cap and stall release) |

**Calendar:** stage 1 can be ready in about a week. With one canary lane and the current queue, stages 1-6 take ~9-13
weeks.

**Paper first, every stage** (sandbox4, the real bot, RCON as oracle), with fixtures cut from real dug-out town region
files.

## 10. Decisions for the owner

**OWNER DECIDED 10-15 (relayed by the coordinator, ~00:19Z), in the owner's words: "go with your recommendations".**
All eight are taken as recommended:
- **D1:** the copper-roofed hall;
- **D2:** isolated pools out of v1;
- **D3:** torches and iron lanterns;
- **D4:** no charcoal yet;
- **D5:** open doorways;
- **D6:** blast furnaces (10 iron per town);
- **D7:** yard -> storehouse -> hall;
- **D8:** stone_bricks and smooth_stone OFF the junk-well list.

Stage 1 (smeltjob-01) is being built next.

| # | decision | recommendation |
|---|---|---|
| D1 | Which landmark? | **the copper-roofed stone-brick hall** with a walkable roof terrace, lightning rod and lanterns, sized S/M/L to each town's copper (the average world gets S). Alternatives: a bell tower (more height work), a gate and plaza (small) |
| D2 | Isolated pools: projects or not? | **not in v1.** Their town state (claims, counts, wells) is per bot. Re-keying town state by world is its own change, which could come later |
| D3 | Copper bulbs are impossible (Nether). Torches and iron lanterns instead? | yes |
| D4 | Charcoal now? | **no.** Coal covers the copper three times over, and town fuel is not even banked today. Charcoal returns when coal runs low |
| D5 | Doors? | open doorways in v1 |
| D6 | Blast furnaces (10 iron per town, +33% ore throughput)? | yes, in stage 4 (needs D8 for smooth stone) |
| D7 | Order: smelt job -> structure dig guard -> yard -> furnace jobs -> storehouse -> hall -> (demand)? This changes the original five-stage order after review | **yes:** the yard is the only blueprint with nothing above pad+1 and serves the copper first; the guard is its own canary, so a REVERT can be attributed (Claude r2 N3), and it protects the plinth and well on its own |
| D8 | Take `stone_bricks` and `smooth_stone` off the junk-well list (they are there as scaffold pickups; owner 10-07 listed stone_bricks as junk)? | yes, from stage 4 (smooth stone for blast furnaces), and stone_bricks also leaves the pathfinder scaffold list. Otherwise the hall is cobblestone and v1b is skipped |

## 11. Reviews

### Round 1 (r1 doc): Codex CHANGE (15 findings), Claude CHANGE (10 findings)

Both reviewers independently found the same P1, the stand geometry, and several shared ones.
- **Codex:** P1 1-8 (geometry; netted demand unsafe; banking/counting are prerequisites; raw-BOM admission vs
  compaction and the stone cap; isolated accounting; direct digs bypass exclusions; furnace sharing; refusals without
  recovery states), P2 9-15 (integer copper BOM 579/327/903; blast-furnace arithmetic; furnace state model; exposure
  overstated; liveness too weak; reservation arbitration; staging and rollback).
- **Claude:** P1 1-3 (geometry; stone_bricks and smooth_stone are junk-well and scaffold items; town deposit re-banks
  the withdrawn copper, and coal/charcoal are never town-banked), P2 4-8 (target-0 groups go to the well; isolated
  journals; `smelt` drains shared furnaces and breaks per-order loss gates; overclaims: the average world gets S, 128
  furnaces are crafts not placements; siting rate unknown, free-decision share unmeasured, no abandon rule), P3 9-10
  (drop COMPACT; the yard-first order; drop the workshop barrels; canopy keep-out; lightning de-oxidation).

Every finding was checked against the code before it was taken: plinth.mjs:304/355, well.mjs:106/112,
bankable.mjs:424, towndeposit.mjs:71/118 and scaffold.mjs. All of them were TAKEN in r2:
- 4.0 terraced construction;
- 3.3 holds;
- the 5 composite skill;
- 3.4 leases and the siting file;
- 3.2 admission, survey, stall and abandon;
- 8 the dig guard;
- D2, D4, D7 and D8;
- the corrected arithmetic in 2, 4 and 5;
- the end-to-end gates in 7;
- the switches and rollback in 3.1 and 8;
- the re-estimated 9.

Nothing was rejected.

### Round 2 (r2 doc): Codex CHANGE (8 findings: P2 x6, P3 x2), Claude APPROVE (7 findings: P2 x3, P3 x4)

**Codex r2 on its own round-1 list:** RESOLVED 1, 5, 6, 7, 9, 12, 13; PARTIAL 2, 3, 4, 8, 10, 11, 14, 15.
- **Geometry, confirmed by a probe:** on flat ground, plinth's own geometry functions placed all 63 roof cells (28 from
  ring stands, 35 from pad stands) and reached the roof through the stair.
- **Claude r2** re-derived every BOM and throughput number, and agrees.

**r3 answers, finding by finding:**

| finding | r3 change |
|---|---|
| Codex 1 / Claude N1: the counts do not exist | 3.3a `PROJECT_COUNTED` in the count record (stage 1); `smelt_town` also decides from the chest it opens; barrel joins PROJECT_PARTS in stage 5 |
| Codex 2: carried allocation, bag reserves | admission counts SPENDABLE stock only (3.2); allocation lives in town containers or inside one composite skill, whose remainder is deposited in a `finally` (3.3) |
| Codex 3: room dead end | `roomOrder` generalised to any `{need, short}`; eligibility after the town deposit; unreachable station -> skip/mark -> stall rule (3.5) |
| Codex 4 / Claude N4: furnace balance | opening/closing window equations per recipe with `cooked` as the checked unknown; prior stock booked apart; ONE-SIDED loss gate counting carried copper; reservations with expiry (5) |
| Codex 5: interim siting race | projects are spatially disjoint from well, plinth and floor (outside the zone square, within 44) until they adopt the siting file; stale reservations retire through each owner's abandon rule (3.4, 4.0) |
| Codex 6: rollback recovery | `yard_drain` ships with the yard; a stage-3 revert removes the yard exclusion; leases and reservations have TTLs; structure loss stated as a deliberate policy (8) |
| Codex 7 / Claude N5: numbers | blast furnace: 3 cobble and 6 smelts each; per-world body time labelled fleet-average with the shared subtotal measured in stage 1; n/12 site census |
| Codex 8 / Claude N2: lease owner, dig authority | one lease owner (`smelt`'s session); the dig guard is its OWN wrapper (digtown stays telemetry), with exemptions by authority (reflex body claim; the builder's plan clear list under its fence), a typed non-retryable refusal, and an entombment chain test (8) |
| Claude N3: stage 2 overloaded; target' = bank cap | the guard is its own stage (2) and canary; holds move to the storehouse stage (5) and raise the DISPOSAL FLOOR only, never the bank cap; `townweekly.py` is not canaried (3.3, 9) |
| Claude N4: lease TTL and key; never craft a furnace because one is busy | 3.1, 3.4 |
| Claude N6: barrels block roof sight; edge definition; falls against terrain | roof before barrels, upper barrels against the wall's side face (4.2); unguarded edge defined; drops measured against the actual terrain (4.0) |
| Claude N7: PROTECTED does not reach the well; D8 timing; helpers' scaffold; reflex placements in the bag-delta gate | parts join NEVER_DISPOSE; D8 from stage 4 with stone_bricks off the scaffold list; the stage-3 gate counts reflex pillar and rescue placements |
| Codex P3: parapet gap, stand vs transit near edges, lantern clicks on wall shapes | left to stage 6's complete-sequence proof and Paper run, as Codex placed them |

Nothing was rejected.

### Round 3 (r3 doc): Codex CHANGE (P2 x3, P3 x3), Claude APPROVE (P2 x3, P3 x4)

**Codex r3:**
- RESOLVED r2 findings 1, 7, 8;
- PARTIAL 2, 3, 4, 6;
- NOT RESOLVED 5 (siting).

**Claude r3:** N1 and N3-N7 RESOLVED; N2 PARTIAL (the dig authority was named loosely).

**r4 answers:**

| finding | r4 change |
|---|---|
| Codex r3 1 (P2): plinth stairs reach radius 20 | two siting domains: OUTER (yard, hall) at Chebyshev 22-44 with no shared file needed; the floor job's domain DECLARED inside 21 is a stage-3 prerequisite (3.4) |
| Claude r3 R1 (P2): town storage is the 16 cylinder | the storehouse goes in the INNER domain; the shared siting file, adopted by the plinth/well and the floor job, is a stage-5 prerequisite (3.4, 9) |
| Codex r3 2-3, Claude r3 R3 (P2): furnace equations | per-session equations with input_taken and fuel_taken; a between-session continuity check (k <= elapsed / 10 s); ONE boundary for the conservation gate, opening and closing contents included, no in-flight allowance; a mismatch either way is a defect; uncertain reads UNRECONCILED (5, 7) |
| Codex r3 4 (P3): reservation expiry | reconcile on due, before release (5) |
| Claude r3 R2 (P2) vs Codex r2 3 / r3 5: room | **Claude's position was taken.** `roomOrder` is not generalised (it only knows eat/deposit/home, and a forced deposit would fight the ladder's keeps). "No room" is a SKIP, not a refusal: no dead end, no printed advice. It is bounded by the stall/pause states and measured as "eligible but for room". Codex's ask for an executable room-making order is answered by the stall/pause bound and that measurement instead; this is the one point where r4 chose one reviewer's position over the other's (3.5) |
| Codex r2/r3: interrupted allocation, standalone and completed lifecycles, rollback drain | allocation is a pure function (no ledger), plus a carry note the next town deposit banks first; `paused:<reason>` for standalone jobs; a complete project reopens on missing cells; `furnace_drain` in STAGE 1 covering every furnace within 48 (3.2, 3.3, 5, 8) |
| Codex r3 6 / Claude r3 N2: dig authority | named exactly: the reflex async scope; or the arbiter's reflex grant with a matching generation; or the builder's planned clear cell. Checked before the pathfinder label. Grant-less reflex dig paths enumerated with chain tests (8) |
| Claude r3 R4 / R5 / R6 / R7 (P3) | stage-2 exposure counts only digs townzone passes, with a fallback to ship with stage 3; full-bag DiD in stage 5; tree scarcity measured by the n/12 census; the iron rung's `smelt` is the named control row (7, 4.0) |

### Round 4 (r4 doc): Codex CHANGE (P2 x2), Claude APPROVE (P2 x1, P3 x2)

- **Codex r4:** RESOLVED all its round-3 findings, except 6 (dig authority), which is now a P3 integration check.
- **Codex on the room disagreement:** "The room choice does not establish a bot dead end"; it accepted the skip
  bounded by stall and pause states, with measurement.

**r5 answers:**

| finding | r5 change |
|---|---|
| Codex r4 1 / Claude r4 1 (P2): Chebyshev-44 corners lie ~62 out, beyond the Euclidean 48 that jobs and the drain use | the outer domain is Chebyshev >= 22 AND straight-line <= 44, for every cell and stand (3.4, 4.0) |
| Codex r4 1 (P2): the drain misses 1-7 output and fuel-only leftovers | the ORPHANED rule: not burning, no live reservation, unchanged > 1 h -> drain everything (5) |
| Codex r4 2 (P2): the continuity bound rejects a partly cooked item | k <= floor((elapsed + p) / T) + 1, with T per furnace type and p the progress read at the close (5, 7) |
| Claude r4 2 (P3): harmless gains | only an UNEXPLAINED gain (after `_pickups` and toss rows) is a defect; `furnace_drain` writes O/C records (5) |
| Claude r4 3 (P3): carry returns vs the ladder's keeps | each return is capped at holdings minus the town deposit's keeps (3.3) |
| Codex r4 P3: the dig-authority generation | the caller's own operation grant, captured at operation start (8) |

### Round 5 (r5 doc): Codex APPROVE, Claude APPROVE

Both reviewers RESOLVED every round-4 item and found nothing new that blocks.
- Codex's one P3: `furnace.progress` is a 0-1 fraction, so convert it as p x T. Applied after the approvals; units
  only.
- Claude confirmed:
  - the outer bound (22 still clears 14 + 6 + 1);
  - the ORPHANED drain never takes from a live load;
  - the continuity bound only ever over-allows, which is the safe direction for a REVERT gate.

**Final state: both engines APPROVE. No disagreement remains.** Codex's request in r2 and r3 for a project
room-making order was withdrawn in r4, after the evidence that a skip leaves the bot no dead end.

Raw review texts: `docs/reports/townprojects-reviews-2026-10-14.txt`.
