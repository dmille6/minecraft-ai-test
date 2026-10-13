# Town ground: fresh-terrain check, no-dig zone, self-building well, sapling growth (2026-10-13, research + design, r4)

OWNER REQUEST 10-13: "lets research 1-3 with both engines". Item 4, saplings, was added the same day.

Nothing in this document changed fleet code, queued a canary or touched a fleet world. The only server started was a throwaway Paper instance for world generation (section 1).

This is r4 (final). It follows four rounds of Codex and Claude reviews; the review record is in section 7.

## 0. Answers first

**On fresh worlds, would the bots have trouble building a junk well?**
Not on day one. Regenerated seed terrain was tested with the town stamp applied. The fleet's own site search, run offline, finds a site in **16 of 16 towns** with both `well.mjs` versions. That is 7 independent terrains, because 10 towns share one seed. Each town has 95-340 valid caps.

**Then why do 12-13 towns have no site now?**
The bots dig out the town ground. We have six re-seeded worlds observed twice (day 0 and day 16-24). In those, valid caps fell from 95-340 to 0-7. Every world we observed at 16 days or older had lost 91-100% of its day-0 sites. The shape of the decline between those observations is not measured.

**Does a fresh world fix it?**
On its own, no. Nothing in the data says a fresh world without a change keeps its sites. Whether a zone (item 1) would preserve them is a hypothesis, for that canary to test.

**Who digs near home?**
- Region diffs measure the removal itself. Within 15 blocks of home, 9.0 cells per column have been removed since each world began. That is 3.4x the 35-48 ring.
- 64% of the top four layers are gone.
- Now, about 85 cells per town-day are still being removed in the shallow band (above home.y-12). About 230 per town-day are removed below it.
- Pickup rows record the activity that was collecting, which is not necessarily the actor that dug. Within 15 blocks, gather collects 6,783 of 8,438 ground items a day; about 5,750 of those are dirt.

**What to build?**
1. A behaviour-neutral `_dig_town` instrument, so that the breaker is finally recorded.
2. The **town-ground zone v1**. Discretionary dig targets are refused in a 33x33 square around home, above home.y-12: gather, mine steps and the ore tunnel. Transit digs are priced, never refused. Survival and maintenance digs are untouched.
3. The **self-building raised well**, placements only. The r2 prototype is limited to the production envelope and requires a stand for every placement. On today's dug-out ground it finds a plan in **15 of 16 towns** without leaf clearing, and in **16 of 16** when leaves in shell cells may be broken first (section 3.2).
4. **wellsite-01 stays queued as built.**

**Saplings (item 4)**
- **They grow, fast.** 55% of saplings planted in the last 6 h are already trees, against a 0.26% ambient log rate.
- **Over the same cells, the trees are cut.** Two snapshots 4.9 h apart cover the same planted cells. 196 of the 1,865 planted trees standing at 07:58Z were gone by 12:51Z. Over the same window, 64 of 731 saplings became trees.
- **Saplings that remain saplings are mostly roofed.** At the snapshot, 52% of all still-saplings (418/807, every age) have a roof feature: a full block other than leaves or logs within 20 above. Only 4% of grown trees do (93/2,288). This is an association, not a diagnosed cause.
- **Little planting happens near home.** Only 3.5% of planted cells are within a 16-block circle of home.

## 1. Item 0 — the offline fresh-terrain check

### 1.1 Method

**Seeds and towns**
- 10 towns share seed 1239381899 and home 355,73,147. They were stamped 08-22: board-a/c/d, hive-a/b, placebo-c and isolated-a..d.
- Six towns were re-seeded:
  - on 09-19: placebo-a 8948499624371160708 and placebo-b 7843072457371465157;
  - on 09-27: hive-c 4394143238757369828, board-b 6443945553241215903, hive-d 4534598234323719516 and placebo-d 2021899648305791853.

**Generation**
- A throwaway Paper 1.21.8-60 instance generated the terrain. Its paper.jar has the same md5 as every fleet world's (052b8c9b), and hive-d's config was copied.
- It ran in `/var/tmp/tg-gen` on 10.0.0.30, bound to 127.0.0.1, as the sandbox user under systemd-run (CPUQuota 200%, MemoryMax 3G).
- Each seed got a `forceload add` of 7x7 chunks around home, then `save-all flush`, then `stop`.
- RCON `seed` echoed the requested seed every time.
- `/tmp/mcai-sandbox.lock` on .31 was held 12:15-12:30Z and released. No fleet or sandbox world was touched.

**Town stamp and search**
- The `place-town.py town_plan` stamp is overlaid in the reader. Codex checked it.
- The search is the fleet's own `canonicalWellSite` and `wellSiteRefusal`, from both 82aef34 and wellsite-01 (baa94879).
- Every snapshot uses one metric (`an/sites.mjs`):
  - the canonical answer, with the bot's bank-container avoid list built as `wellsite-replay.mjs` builds it;
  - "valid": the number of columns whose canonical cap passes `wellSiteRefusal` with avoid=[].

### 1.2 Results (`out-sites.txt`, `out-dayone.txt`)

**Valid caps over time** (`out-sites.txt`, wellsite-01). Each world's valid caps / candidates, followed by later observations of the same seed.

| Seed | Day 0 | Later observations |
|---|---|---|
| shared (10 towns) | 244/557, site | 6 archived worlds (`world.pre-reseed-*`, same home): day 27-28: 0, 0; day 36: 4, 0, 21, 0. 10 live worlds, day 52: 0,0,0,2,1,0,0,0,0,0 |
| hive-d | 95/580, site | day 16 (same world): **0** |
| placebo-d | 165/545, site | day 16 (same world): **0** |
| board-b | 340/556, site | day 16 (same world): **0** |
| hive-c | 207/561, site | day 16 (same world): 6 |
| placebo-a | 267/570, site | day 24 (same world): 1 |
| placebo-b | 192/536, site | day 24 (same world): 7 |

**Day-0 refusals** are tallied in a separate run with the avoid list (`out-dayone.txt`), so they do not add up to the counts above. They are mostly natural:
- tree canopy in the column (oak, birch and jungle leaves);
- sand (hive-d: `sand/sand` 435);
- slope or plants in a wall cell;
- a few liquid cells;
- a few of the town's own chests (avoid).

### 1.3 Controls

**Positive control: generation fidelity** (`out-ctrl2.txt`, `out-ctrl3.txt`)
- The least-inhabited chunks present in both files are identical cell for cell, block state included:
  - shared seed, InhabitedTime 5,552 / 7,208 / 23,538 → 0 differing cells;
  - board-b, 4,902 / 4,902 → 0.
- Differences grow with InhabitedTime.
- y<0 at ≥ 35 from home is 99.68-99.94% identical in all 7 seeds.
- The mismatches are bot-shaped: stone→air, air→oak_leaves, stone→cobblestone.
- Limit: the surface was never compared where no bot has been, because every chunk near a town is inhabited.

**Negative control**
The same metric on live terrain finds no site in 13 of 16 towns. That matches the wellsite-01 diagnosis.

**Caveats**
- These are offline searches, not a bot building a well.
- A town that already has a well needs no new site.

## 2. Item 1 — measurements, then the no-dig zone

### 2.1 Where and how much the bots dig near home

**Instrument A: region diff** (`out-stock.txt`, `out-flow.txt`; `an/flow.mjs`)
- "Removed" means a non-vegetation, non-water block that became air or water.
- Columns are binned by horizontal distance from home, across 16 towns.
- Endpoint differences also catch re-digs of bot-placed blocks, and they miss anything removed and then replaced.

| Distance from home | r0-6 | r7-14 | r15-24 | r25-34 | r35-48 |
|---|---|---|---|---|---|
| Columns (16 towns) | 2,320 | 8,832 | 19,904 | 30,400 | 58,880 |
| **STOCK**, fresh → 10-13 12:35Z: removed per column | 9.49 | 8.92 | 6.39 | 4.63 | 2.68 |
| …of which in the top 4 layers | 2.43 | 2.61 | 2.22 | 1.81 | 1.07 |
| **FLOW**, 07:58Z → 12:35Z (4.62 h): removed cells | 212 | 763 | 1,528 | 2,340 | 2,297 |

**Stock within 15 of home**
- 100,811 cells removed: 9.04 per column, **3.4x** the 35-48 ring.
- 60,095 of them are in the band y ≥ home.y-12: dirt 34,874, stone 24,125, sand/gravel 1,091.
- 2.57 of the top 4 layers per column are gone.
- The town platform floats: 139-163 of its 169 stone_bricks remain, but the cell under it is air in 110-169 (`out-platform.txt`).

**Flow within 15 of home**
- 975 cells, a short-window daily equivalent of about 317 per town-day.
- 263 are in the band, about 85 per town-day: dirt 183, stone 79.
- 711 are deeper: stone 503 and re-dug dirt 198.

**Instrument B: who was collecting** (`out-digsrc.txt`)
- Source: `_pickups` 60 s summaries over 24 h. Events.load read 1,269,368 rows from 80 bots, 32,330 summaries, all 16 pools.
- Coverage: 127,575 items were summarised and 0 were hidden by the 300-char cap. 111,647 were ground items.
- These rows attribute the **collecting activity**, at the bot's position when the summary was written. They do not identify the breaker (Codex r1 P1).

| Source | 0-7 | 7-15 | 15-25 | 25-35 | 35-48 | >48 |
|---|---|---|---|---|---|---|
| gather | 1,092 | 5,691 | 11,017 | 10,412 | 7,436 | 22,627 |
| mine | 29 | 571 | 2,333 | 3,711 | 3,572 | 22,975 |
| goto | 173 | 247 | 782 | 845 | 1,086 | 6,410 |
| reflex | 71 | 223 | 615 | 913 | 867 | 4,130 |
| all | 1,496 | 6,942 | 15,297 | 16,176 | 13,334 | 58,402 |

**Within 15 of home**
- 8,438 items a day: 7.6% of the fleet's ground pickups, about 527 per town-day. Per pool the range is 107 (placebo-c) to 1,068 (placebo-b).
- `gather dirt` collected 5,747 of them. The gatherer ladder's first rung is `M.gather('dirt', 16)`.

**The two instruments disagree on material and volume.**
- About 5,750 dirt items were collected near home, against about 950 dirt cells a day removed in the band.
- Most of the difference is probably re-digs of bot-placed dirt, or pickup positions that are off.
- Neither instrument can tell which. That is why the first build step is a breaker-level instrument (2.3).

### 2.2 What the dig code does today
From an Explore survey of `bots/src` at 3b094adc: 33 direct dig sites and 6 dig-capable pathfinder profiles. The reviews confirmed the details.

**The pathfinder veto**
- Pathfinder breaks are vetoed through `Movements.safeToBreak`, which returns false when `exclusionBreak >= 100`.
- The well's `wellBreakCost` (which skips the bot's own well, `selfWell`) is the only entry. It sits in one array (index.mjs:541) that every clone shares by reference.
- The ore-tunnel profile is the exception. It copies gatherMoves' array when built (oretunnel.mjs:191) and adds `nearHome` (HOME_RADIUS 12, full depth).

**Gather targets**
- Gather targets pass `safeTarget = isSafeToBreak || shorelineExemptAt` (skills.mjs:1839).
- `isSafeToBreak` fails **open** on missing movements, a missing block, or an exception (skills.mjs:10504-10509).
- `findBlocks` is asked for 32 matches before filtering (skills.mjs:1753-1757, 1946-1950).

**mine**
- `mine` refuses `dHome <= 12 && goalY < y-1` once, at entry (skills.mjs:8826). This uses the bot's position only.
- `chooseStairBearing` (skills.mjs:9426) picks a bearing by dry runway, with no reference to home. Each step digs directly (skills.mjs:8992-9007).

**Unguarded digs**
None of these consults any exclusion, including the well's:
- wear_out (adjacent cells only, skills.mjs:5373-5420);
- craft's `makeCraftRoom`;
- place's make-room;
- lid clears;
- canopy descent;
- float dig;
- ride-floor-down;
- every reflex/survival dig.

### 2.3 Step 1: the `_dig_town` instrument (behaviour-neutral)

**What it records** (r3; Codex r2 P1 x2, Claude r2 P2-c)
- **Capture before the dig, not from `diggingCompleted`.** mineflayer emits `diggingCompleted` with the block **after** it is already air. It also clears `targetDigBlock` first and drops completion listeners on death (mineflayer digging.js:196-215).
  - So the instrument wraps `bot.dig`, the one entry that both the pathfinder and the skills use.
  - Before the dig it captures the block's name, its position, its class (shell/ground/free) and the invocation's purpose.
  - **Outcomes.** Each dig is counted once, as one of:
    - `client_complete`: mineflayer's promise resolved. Its local world predicts air (digging.js:150-167), and it also resolves when ANOTHER actor removed the target (:196-208). It is never treated as proof of removal.
    - `confirmed`: the server's block update shows the cell as air or as the block's drop state within 2 s of completion, and this bot's own dig sequence was the one in flight.
    - `rejected`: the server restored the block (the known ghost-block path).
    - `aborted`, `preempted`, `death`.
  - Only `confirmed` digs enter the primary metric, so attribution is to "this bot's completed and server-confirmed dig". That is still not proof that no other actor broke the same cell in the same tick, and the read says so (Codex r3 P1).
  - The wrapper lives on the bot object, so it survives respawn without re-adding listeners.
- **Purpose.**
  - **An explicit invocation scope comes first.** A caller that digs as a target sets `bot.digScope = {purpose: 'target', by: 'ore_tunnel' | 'mine' | 'gather'}` around its own dig calls, the ore tunnel's pathfinder walk included. pathfinder sets `digging=true` before it calls `bot.dig` (mineflayer-pathfinder index.js:485-492), so without the scope the tunnel's excavation would read as transit (Codex r3 P1).
  - Otherwise `transit` whenever `bot.pathfinder.isMining()` is true at capture.
  - Otherwise the running skill or reflex label.
  - Pathfinder digs during gather's approach or mine's walk-out are transit.
  - Direct digs that are really transit but not pathfinder digs (goto's float-dig retry, reflex digs) carry their skill or reflex label. The primary metric's target purposes are only gather, mine and the ore tunnel, so the read must not count goto or reflex rows as targets (Claude r3 P3).
- **Behaviour-neutral wrapper** (Claude r3 P3).
  - It passes every argument through (block, forceLook, digFace).
  - It returns or rejects the original promise unchanged, so `e.aborted` and the `withTimeout` cancels keep working.
  - It captures synchronously, with no await before the original call.
  - Each of these has a test.
- **Exact counters, not rate-limited rows.** Per bot, per window: counts by (class, purpose, outcome), flushed as one summary row a minute, with an overflow counter.
  - A capped sample of individual rows (pos, block, purpose) rides alongside, for audit only.
  - Expected volume: about 300 zone cells per town-day.

**Why it comes first**
- It is the only instrument that attributes **dig attempts** to a bot and a purpose. It is not authoritative actor attribution: two bots on one cell can both see the same server update.
- It turns the zone's canary into a DiD on actual target digs.
- It must be live on both arms before the zone canary. It can ride on the next promoted build, or run as its own null canary.

**Its validation**
- **Before the fleet: a Paper sandbox fixture.** Known digs are made by gather, mine, an ore tunnel, a pathfinder transit and a reflex. Without competing breakers, the `confirmed` counters must equal the world-read count of removed cells, class and purpose included.
- **Fixtures for every non-happy path**, each with its expected outcome class:
  - a server-rejected dig (a dig in the first 3 s after join: the ghost-block cause);
  - a competing breaker (two bots on one cell). Expected: both may report `confirmed` for one removed cell. The read dedupes `confirmed` rows on (cell, ±2 s) across the pool's bots, counts each duplicate once as `ambiguous`, and reports the ambiguous share. The fixture asserts removed cells = deduped confirmed + 0, with ambiguous = 1;
  - preemption by a reflex;
  - death and respawn mid-dig.
  - This replaces "agrees with a region diff", because endpoint diffs miss remove-and-replace cycles (Codex r2).
- **On the fleet:** nothing else changes. Digs-per-bot-hour and the gather/mine outcome rates stay the same.

### 2.4 Step 2: the zone, `townground.mjs` (pure, behaviour-tested)

```
TOWN_GROUND_HALF  = 16   // SQUARE (Chebyshev) half-width: candidate caps reach Chebyshev 14, their shell +2
TOWN_GROUND_DEPTH = 12   // protect y >= home.y - 12: candidate caps >= home.y-8, the ring reaches g-3
TRANSIT_COST      = 30   // < 100 everywhere: a path may still dig through town ground

townDigClass(cell, blockName, zone) -> 'free' | 'ground'
  ground: |dx| <= 16 and |dz| <= 16 from home, y >= home.y - 12, and the block is terrain
          (stone family, dirt family, sand/gravel, deepslate, tuff, calcite, clay, ores, cobble).
          NOT vegetation (logs, leaves, saplings, plants, crops: planted trees must be harvestable)
          and NOT town furniture (containers, tables, furnaces, beds, lectern, torches, trapdoors,
          composter: those keep their own rules).
  zone off (free everywhere) when home is unknown. This FAILS OPEN, named as such.
townTargetPermit(cls) -> { ok, reason, remedy }        // the decision, extracted
townTransitCost(cls)  -> 0 | TRANSIT_COST              // never >= 100 on a TRANSIT profile
```

**The existing full-depth home rules are KEPT alongside the zone** (Claude r2 P2-a).
- `mine`'s `dHome <= 12` entry refusal stays, and so does the ore tunnel's `nearHome` cylinder of 12.
- Both were added after lethal shafts through the base (skills.mjs:8816-8824).
- The zone adds the band out to the 33-wide square. It removes nothing.

**The well's shell keeps `wellBreakCost`, unchanged.** That includes `selfWell`, which skips the bot's own well when its body is in the shaft. The zone does not merge with the shell (Codex r1 P1: merging lost the self-well escape).

### 2.5 Wiring of v1, and what v1 deliberately does NOT touch

| Site | v1 change | Why it cannot strand the bot |
|---|---|---|
| Every TRANSIT dig-capable profile (the shared array: walk, gather, ascend) | + `townTransitCost` | Priced, never refused. A bot in a town pit can still dig out on any of them, gatherMoves included (Claude r1 P1-1: a hard veto there was the pit trap). |
| gather candidates | Filter **at enumeration**: the `findBlocks` matcher skips `ground` cells, so the 32 candidates are all eligible (Codex r1 P1). `safeTarget` becomes `(isSafeToBreak \|\| shorelineExemptAt) && townTargetPermit` (an independent conjunction outside the fail-open path). | Dirt and stone are everywhere beyond a 33-wide square. If nothing is found, gather fails exactly as it does today when nothing is nearby. Chain test: the nearest 32 dirt cells are inside the zone, plus a reachable positive-control dirt cell outside → it is gathered. |
| mine | (a) Entry: the existing `dHome <= 12` refusal is kept, and the first tread cell's class is checked as well (Claude r1 P2-3, r2 P2-a). (b) `chooseStairBearing` gets a pure bearing filter: no bearing whose planned runway cells are `ground`. (c) Every step re-checks its cells; the remedy is "turn" (the existing bearing-turn path). (d) If every bearing refuses: walk on the ascend profile to the square's edge + 2, along the outward bearing, then retry once. Fallback `surface`. A zone-caused terminal refusal carries `reason=town_ground` and names the walk-out it performed. | Tests: no cell dug by `mine` is `ground`, for all 8 starting positions × inward and outward bearings, a bot exactly at home, an obstructed outward ray, a bot below the band (its cells are `free`), and the water case: the only dry bearing points inward and the outward one is wet (Claude r2 P2-e). The mine row carries the entry class and per-step classes, so the read can link one invocation (Codex r1). |
| Ore tunnel | Its own copy of the array (oretunnel.mjs:191) keeps `nearHome` and adds **100** for `ground`. A tunnel dig is a target dig (Claude r2 P2-b, Codex r2 P2). | The tunnel already re-plans around refused cells, and its candidates are already filtered by `nearHome` (skills.mjs:1576). |
| wear_out, makeCraftRoom, place make-room, lid clears | **untouched** | These are their own remedies in town (Claude r1 P2-4). Together they are about 9 items a day within 15. |
| Every reflex/survival dig, canopy descent, float dig, ride-floor-down, buildWell | **untouched** | CLAUDE.md's trap class is two correct guards meeting where the bot has no legal move. These digs are 294 of the 8,438 near-home items (3.5%), and they do not consult the well veto today either. |

**What v1 covers.** Gather and mine collect about 7,400 of the 8,438 near-home ground items. Pickup attribution is the caveat on that number, which is why the instrument comes first.

**What v1 does not cover.** Transit and survival digs continue. v1 therefore does **not** promise that ground stops being lost.

### 2.6 Tests
- **Pure tables.** `townDigClass` and `townTargetPermit` are tested on edges: the square ± 1, depth ± 1, vegetation, furniture, and a missing home.
- **Profiles built for real** (Claude r1 P2-6). Assert `exclusionBreak(ground cell) == TRANSIT_COST` on the walk, gather and ascend profiles, and `== 100` on the tunnel profile. Test `isSafeToBreak`'s fail-open cases with the town conjunction (missing movements, missing block, an exception, collectBlock on and off). Assert that a shell cell is still 100, except from inside the bot's own shaft. A mutant that pushes a hard veto onto the shared array must be caught.
- **Refusal chains with the real skill functions:**
  - gather dirt from inside a 3-deep town pit with an empty bag and no pickaxe (it digs out on transit cost);
  - gather with the 32 nearest candidates in the zone;
  - mine from 8 positions;
  - craft at a town table with a 36/36 bag (unchanged).
- **Wiring.** Source assertions with comments stripped, each proven on a mutant with its anchor asserted present and unique.

### 2.7 Canary read (zone)

**Population.** **One** pool, against frozen controls. The zone is a property of the town, so the unit is a pool, not bots. CLAUDE.md allows one canary pool, ever (Codex r2 P1).

**Exposure.** Every pool collects 107 or more ground items a day within 15.

**Liveness.** Both must be > 0 on the canary and absent on control:
- `_town_ground` rows, at most one per bot-minute, carrying counts of candidates skipped and mine bearings refused;
- mine walk-outs.

**Primary (DiD), from the instrument.** The `_dig_town` counters for class `ground`, purpose target (gather/mine/ore tunnel, not transit), outcome `confirmed`, deduped across bots. Per bot-hour, canary vs control, pre vs post.
- Expected size: today these purposes collect about 88% of near-home ground items, so the target digs should fall close to 0 on the canary.
- Positive control: the control keeps its pre-period rate.
- Transit digs are reported separately. They are allowed to rise; a bot that walks around instead may dig through.

**The selector is behaviour-tested** (Codex r4 P1). A unit test feeds the read synthetic counter rows of every outcome class and asserts that only deduped `confirmed` target rows are counted. A positive-control fixture row must be counted, so a misspelled outcome cannot report a false zero.

**Secondary: net ground preservation.** Region copies of every pool at declaration-3h, at declaration and at each read. The DiD uses equal intervals, with column and bot-hour denominators. Per-pool flow varies about 14x, so this is expected to be INCONCLUSIVE at canary length (Claude r1 P2-7). It is reported, not gated.

**Defect gates.** Each comes with its positive control on the control arm. Any of them can revert:
1. Deaths, with the two-death floor.
2. Trapped in or near town: `_entombed`, `_stranded_escape*` and `_livelock_escape` within the square + 4, DiD.
3. Gather failures for dirt/cobblestone/stone, DiD.
4. goto no-path within the square, DiD.
5. A `mine` invocation that dug any `ground` cell as a target. This is a defect by construction.
6. Zone-caused mine refusals (`reason=town_ground`) per mine order, DiD. Mine's existing refusals are excluded: water, no pickaxe, already below (both reviews r2).

## 3. Item 2 — the self-building (raised) well

### 3.1 Geometry

**The oracle.** The verified geometry is kept. The oracle is `containmentRefusal` / `wellSiteRefusal`. Placed cobblestone counts as `ground`.

**The shell.** For a cap at g, raised k above the column's surface t (g = t + k):
- layer g: 3x3 minus the cap (8);
- g-1: 5x5 minus the shaft (24);
- g-2: 5x5 including the floor (25);
- g-3: 5x5 minus the centre (24).

A full raise is **81 blocks**. Codex rebuilt it against the real oracle and got null / null / `dug`. Removing one g-3 cell gives "underground air beside the shaft", so the deepest ring layer is required.

**Stand and ledge**
- The throwing stand is unchanged: feet g+1 on the 3x3 top, one cardinal cell from the cap (`wellStand`).
- The 5x5 ledge, with feet at g two cells out, is transit only.
- Claude checked that a body on the ledge cannot reach an item in the shaft. The pickup box stays at least 0.2 outside the shaft cell, and above an item on the floor trapdoor. This is the same as the natural case.
- Paper confirms it in S2.

### 3.2 Planner, a pure function (prototype r2: `an/plinth2.mjs`)

**The rules** (each column of the existing spiral, k = 0..4):
1. **The production envelope:** `townDistance(home, cap+1) <= ADOPT_RADIUS`, and the bot's avoid list in the oracle (Codex r1 P1).
2. Required-solid cells may be `ground` (kept) or replaceable (placed). Anything else refuses that k: leaves, logs, sand, a chest or a liquid.
3. Required-open cells must be open. The exception is the cap/shaft dig at k = 0-1, which today's build already does.
4. **Reachable from above:** every cell over a fill, up to g+2, is open or a later fill. A sealed void refuses that k.
5. **Support** comes only from below or a side face (Codex r1 P1: the r1 prototype also allowed the face above).
6. **A stand for every placement, in the intermediate world:**
   - feet and head open, floor solid;
   - not in the well column, not in a cell that a later placement fills;
   - eye within 4.5 of the clicked face's centre, and above a top face.
7. **The oracle** on world + plan.
8. **Stair (an OPTIMISTIC estimate):** the prototype takes the HIGHEST standable footing in the Chebyshev-3 ring (diagonals included, headroom not checked) against the ledge. It counts a column stair of n(n+1)/2 blocks and generates no stair cells (Codex/Claude r2). The production planner must emit the stair cells with supports, include them in the placement order and the oracle, and probe a walk path from town to the stand.

The cheapest k per column wins, then spiral order.

**Results on today's live terrain (12:35Z), raised only.**
These are shell candidates plus optimistic stair estimates, in cobble (`out-plinth2-live.txt`).

| Town | Feasible of 672 | Min | Median | Town | Feasible | Min | Median |
|---|---|---|---|---|---|---|---|
| board-a | 29 | 67+0 | 80+0 | isolated-c | 32 | 67+0 | 80+0 |
| board-c | 33 | 60+0 | 79+1 | isolated-d | 39 | 61+0 | 75+1 |
| board-d | 23 | 61+0 | 79+0 | hive-d | 100 | 61+0 | 80+1 |
| hive-a | 51 | 62+1 | 79+0 | placebo-d | 84 | 15+0 | 76+1 |
| hive-b | 34 | 64+0 | 78+1 | placebo-a | 48 | 63+0 | 79+0 |
| placebo-c | **0** | — | — | placebo-b | 91 | 24+0 | 68+1 |
| isolated-a | 15 | 61+0 | 75+0 | board-b | 48 | 60+0 | 76+0 |
| isolated-b | 15 | 74+0 | 81+0 | hive-c | 29 | 39+0 | 77+0 |

**15 of 16 towns have a plan without leaf clearing.** The leading refusals:
- `solid`: leaves, sand, or bot-placed planks/chests in a shell cell;
- `enclosed`: sealed voids;
- `envelope`.

**placebo-c.** It has no plan because oak leaves fill its shell cells. They were the first blocker 1,873 times, from the planted canopy over the town.
- Breaking leaves needs no tool, and the zone leaves vegetation alone. With leaf clearing allowed (break the leaves in a shell cell, then fill it), placebo-c has 19 plans at 78-81 cobble (`out-plinth2-leaves.txt`).
- Leaf clearing also raises board-a from 29 to 114 plans, and isolated-b from 15 to 80.
- The planner therefore includes leaf clearing as a per-cell pre-step. With it, **16 of 16 towns** have a plan.
- P3: no sapling may be planted within 3 of a plinth or its stand, or a growing tree could put leaves into the stand or rim cells.

**Other runs**
- On fresh terrain the median plan costs 32-38 for most seeds (`out-plinth2-fresh.txt`).
- Allowing the cap/shaft dig adds a few k = 0-1 plans (`out-plinth2-live-digcol.txt`).

**What the prototype does not prove.** It proves a supported, standable final shape and order. It does **not** prove an executable build: it stores no stand/face sequence, plans no routes or stair, and applies no Paper placement rules.

**The production planner** emits and stores the full ordered (cell, face, stand) sequence, the stair, and a route probe for every stand. It must exist and pass on the 16 real towns offline **before** S1/S3 run.

**The town record stores the full geometry**: cap, g, the ordered (cell, face, stand) list and the stair cells. It is never a hash (Codex r1 P2). Every visit re-derives its work from the record, never by re-searching.

### 3.3 Records, stages and the junk well code

**A separate record key**
- A plinth uses `junkwell-plinth-<home>.json`.
- `resolveTownSite` must not re-check a plinth record with `wellSiteRefusal` while it is incomplete, or `townWellSite` would report no site for the whole build (Claude r1 P2-2).
- The check becomes plan-aware: each plan cell is either placed or still replaceable.

**A plinth stage in front of `wellStage`**
- An empty or partial raised site reads `dug` to `wellStage`, because its cap and shaft are natural air (Claude r1 P2-1).
- So every consumer gets a gate first: `townPitState`, `coverOpenPit`, `close_well` and the order reading. A recorded, incomplete plinth is stage `plinth k/N`.
- **Hazard is judged from the world, not from plan completion** (Codex r2 P1).
  - A pure `plinthHazard(read, record)` says whether the open column can trap or hide a body: the cap cell is open over a floor ≥ 2 below, and ≥ 3 sides are walled.
  - Any visitor may cover a hazard, even on an incomplete plinth. The cover goes in the cap cell, and the builder digs it out on resume, which is a construction dig in its own column.
  - A non-hazardous partial plinth (the low layers) is never covered.

**Pit ownership**
- Ownership is recorded **before** the first placement that makes `plinthHazard` true, as `digShaft` does for a dug pit (skills.mjs:7163-7178).
- Tests: a crash immediately before and immediately after that placement, and an unfinished stair.
- The visit's budget is cobble − 64 − 1. The extra 1 is a reserved cover block (Codex r1 P1: spending to exactly 64 left no cover).
- After a crash, a complete plinth with an open column reads `dug`, and the existing visitors cover it.

**After completion.** The existing `buildWell` finishes the well (floor trapdoor, then cap), unchanged.

### 3.4 Funding and composition

**Funding (Codex r1 P1, Claude r1 P2-4)**
- Census 10-13 12:30Z: 37 of 80 bags hold ≥ 164 cobble. hive-d's five bags hold 73 in total, and board-d's 145.
- The build is per town and resumable. Any bot with surplus above 64 + 1 contributes on its visit. The builder choice prefers a funded bot over the lowest name.
- **Deterministic replenishment** (Codex r2): at a full bag, a funded bot's surplus goes to the plinth before stocktarget's `nowell` banking.
- A town whose bags still cannot fund it withdraws cobble from its own chests. The cobble there was banked as `nowell`, so it is in town by construction.
- The withdraw path is new code, part of the plinth change, and reviewed with it.
- `plinth_unfunded` with a backoff is only for a town with no cobble in bags or chests.

**stocktarget-01**
- Without a usable well, stocktarget banks surplus as `nowell` (ST skills.mjs:3270, cobblecap.mjs:448). The plinth is therefore not the only sink (r1 was wrong here).
- The build draws only bag surplus above STONE_GUARD.

**The zone**
- Plinth and stair cells are added to `wellBreakCost`'s box through the record.
- Pathfinder/gather protection starts at record time.
- Survival and mine-step protection does not; this is a known gap.

### 3.5 Paper sandbox measurements required BEFORE any fleet code
All run under the sandbox lock, on fixtures copied from these region files.

**S1 build**
- Flat ground, and a board-a dug-out fixture: 3 repetitions each.
- Read the world after every placement. Count dropped and ghost placements, and time each.
- Kill the bot mid-build and resume, twice.

**S2 disposal.** The 528-throw dispose run and the 60-pass walker isolation run, at k = 2 and k = 4, including a body on the ledge.

**S3 pathing**
- 50 visits to the stand via the planned stair, plus a route probe to every planned stand.
- The cap must never be a path node.

**S4 the zone composition.** An entombed bot next to a plinth, and a bot in a town pit.

S1-S4 do not use the canary slot, so they can run **alongside** the zone canary (Claude r1 P3).

### 3.6 Canary read (self-build)

**Population.** Pools without a well: 12-13 of 16 today.

**Liveness.** Plinth placement rows; at least one canary town completes.

**Effect.** `dispose_well` successes in canary towns, DiD against control towns without a well. Towns with wells are an instrument control, not a substitute.

**Safety gates.** These are the existing junk-well read's gates, carried forward with their positive controls (Codex r1 P1):
- `_well_recollected`, `_well_inside`, misses retaken, cap left open;
- plus deaths with the two-death floor;
- a bag below 64 after a build visit;
- a placement outside the recorded plan (a world read);
- `_well_retired` on a plinth;
- bots stuck within 3 of a plinth;
- an **uncovered** hazard (`plinthHazard` true with no cover) older than 10 minutes, or a cover that was never removed and resumed within 24 h (a stalled recovery).
  - A covered incomplete plinth is the intended recovery and is not a defect (Codex r3).
  - Acceptance test: cover → resume (dig the cover out) → complete.

## 4. Item 3 — wellsite-01 (`baa94879`, queued after bamboo-02)

**Verdict: keep it as built.** Codex: APPROVE-WITH-CHANGES; Claude: APPROVE.

**What it is expected to do.** Its registration measured 3,197 exhausted searches a day across 12 towns and 55 bots. Stopping them is its expected effect, to be read; it is not observed yet.

**It is also the plinth's trigger.** The exhausted town record is exactly what starts the plinth (3.3). The 2 h hold then has to mean "no natural site and no plinth plan". That amendment belongs to the plinth build.

**The steady sand wall** is independent of items 1 and 2.

**Correction from r1.** board-b's breach is **not** claimed for the zone. Its ring cells were already in `wellBreakCost` for pathfinder and gather digs. The breaker is not identified (both reviews). The `_dig_town` instrument would identify the next one.

## 5. Item 4 — do the saplings the bots plant grow?

### Supply and method
- Seven days of `place` rows, read per pool. Events.load ran with per-pool paths, so each walk stays under the RAM cap. 8.5M rows in total.
- 10,661 sapling placements: oak 10,054, birch 478 and spruce 129. They cover 10,530 distinct cells.
- The row's coordinate is the sapling's own cell (`ref + face`, skills.mjs:4974).
- State comes from 56 read-only region copies taken 10-13 12:51Z (`out-saplings.txt`).

### Snapshot by age

| Age (h) | Cells | Tree (log at the cell) | Still sapling | Air | Other block |
|---|---|---|---|---|---|
| 0-6 | 356 | **196 (55%)** | 113 (32%) | 32 (9%) | 15 (4%) |
| 6-24 | 922 | 449 (49%) | 76 (8%) | 275 (30%) | 122 (13%) |
| 24-48 | 1,577 | 492 (31%) | 105 (7%) | 616 (39%) | 364 (23%) |
| 48-96 | 3,251 | 552 (17%) | 194 (6%) | 1,663 (51%) | 842 (26%) |
| 96-168 | 4,424 | 599 (14%) | 319 (7%) | 2,380 (54%) | 1,126 (25%) |
| all | 10,530 | 2,288 (22%) | 807 (8%) | 4,966 (47%) | 2,469 (23%) |

### Controls and the same cells over time
- **Ambient control.** Random soil cells 4-10 blocks from a planting, at the same y: 24 of 9,345 accepted samples are logs (0.26%).
  - There are 9,268 distinct cells among them.
  - The control is not stratified by town or soil state. It also requires soil **now**, whereas planted cells stay in the denominator after losing their soil.
  - 168 control attempts crossed the opened region and were skipped.
- **The same cells, 07:58Z → 12:51Z** (`out-sap2.txt`: 9,348 planted cells in the 16 home regions, all planted before 07:58Z):
  - Of 1,865 trees standing at 07:58, 196 were gone 4.9 h later: 138 to air, 58 to another non-log block.
  - Of 731 saplings, 64 became trees.
  - So the trees are cut, observed on the same cells. It is not inferred from age cohorts, which also differ in place and practice (Codex/Claude r1 P1/P2).
- **Harvest pillars.** A cobble/dirt column ≥ 3 high standing on the planted cell:
  - 9.8% of planted cells against 2.2% of control cells (207 / 9,345);
  - by age: 2.0%, 5.0%, 10.1%, 10.9%, 10.4%.
  - This is consistent with harvesting. The detector sees material, not purpose.
- **Leaves are not evidence.** Of the control cells that are air, 58% have leaves above them.

### Saplings still saplings after ≥ 24 h: 618 of 9,252 (6.7%)
- The roof feature is a full block other than leaves or logs within 20 above.
  - It is on **52% of still-saplings** (418 / 807 of all ages), against **4% of grown trees** (93 / 2,288).
  - It is strongly associated with not growing.
  - It is a feature, not a diagnosed cause: light and chunk ticking were not measured (Codex r1 P1).
- Of the 618, 136 have < 5 air above.
- Saplings in chunks that were never ticked are not separated here. Chunk LastUpdate is a next step.

### Near home (item 1)
- 370 of 10,530 planted cells (3.5%) lie within a 16-block circle of home (not r2's square). 5 of them are trees now.
- Soil remains under only 86 of those 370, and 57 of the 86 are floating.
- That is a small spatial overlap with the zone. The zone's effect on planting access is not measured (Codex r1 P2).

## 6. Recommended build order
1. **wellsite-01 as queued.** No change.
2. **The `_dig_town` instrument** (2.3). Behaviour-neutral. It rides the next promoted build, or runs as its own null canary.
3. **Zone v1** (2.4-2.7). Targets only; transit priced; survival and maintenance untouched.
   - Only a **KEEP** lets anything rely on its protection (Codex r1/r2). REVERT or INCONCLUSIVE does not.
   - Before the zone canary: the instrument must pass its sandbox fixtures (2.3), including the rejected, competing, preempted and death cases, and the tunnel scope (Codex r3).
4. **The self-building well.**
   - The production planner and record protocol (3.2-3.3) run in parallel with step 3, and must pass offline on all 16 towns before sandbox S1/S3.
   - Then S1-S4.
   - Then both-engine review, then its canary on towns without a well.
5. **Re-seeding is not a fix by itself.** Sites were 91-100% gone at the first later observation, day 16-24. Whether zone v1 makes a fresh world's sites last is a hypothesis for its canary.

## 7. Review record
Review files are kept in the townground scratch: `review-diag-codex.txt` and `review-design-codex{,-r2,-r3,-r4}.txt`. The Claude passes came from a separate reviewing subagent with a fresh, skeptical read.

**Diagnosis (sections 1-2.1)**

Codex r1:
- C1, C2 and C5: AGREE-WITH-CHANGES.
- C3 and C4: DISAGREE.

Every finding was taken:
- The "2-4 week lifetime" claim was withdrawn. Only paired observations are reported now.
- Pickups are described as collection, not breaking.
- Transcription errors were fixed.
- The isolated pools were re-keyed. The first pickup pass had left them out.
- One site metric is used throughout.
- Generation fidelity was checked on all 7 seeds, plus untouched-chunk identity.

Claude spot-checked the measurement numbers in r1-r3. They are approved, apart from P3 wording (now fixed).

**Verdicts by round**

| Part | Codex r1 | Codex r2 | Codex r3 | **Codex r4** | Claude r1 | Claude r2 | **Claude r3** |
|---|---|---|---|---|---|---|---|
| A: `_dig_town` + zone v1 | REJECT | REJECT | REJECT | **APPROVE-WITH-CHANGES** | APPR-W-C | APPR-W-C | **APPROVE** |
| B: raised well (design) | REJECT | REJECT | APPR-W-C | **APPROVE** | APPR-W-C | APPROVE | **APPROVE** |
| C: wellsite-01 verdict | APPR-W-C | APPR-W-C | APPROVE | **APPROVE** | APPROVE | APPROVE | **APPROVE** |
| D: saplings | APPR-W-C | APPR-W-C | APPROVE | **APPROVE** | APPR-W-C | APPROVE | **APPROVE** |
| E/F: build order | APPR-W-C | APPR-W-C | APPR-W-C | **APPROVE** | APPR-W-C | APPROVE | **APPROVE** |

Codex r4's two remaining changes to A were applied after r4. They were wording and test changes, with no design change:
- The primary selector reads outcome `confirmed`, deduped across bots, and the selector is behaviour-tested with a positive-control row.
- The instrument is described as attributing dig attempts, not as authoritative actor attribution. The competing-breaker fixture now has its expected counts.

**Disagreement left open: none on the design.**
- Both engines treat B as approved as a design only. The production planner, the record protocol and sandbox S1-S4 gate any fleet code.
- Both engines treat A as approved for implementation, with the instrument's sandbox fixtures gating the zone canary.

**Findings that changed the design**, in order:
1. A hard veto in gatherMoves trapped a bot in a town pit (Claude r1 P1). Transit is now priced everywhere.
2. 32-candidate starvation (Codex r1 P1). Gather now filters at enumeration.
3. mine's bearing was not constrained (both r1). Added a bearing filter, a per-step check, a walk-out and a fallback.
4. The self-well escape was lost by merging the shell (Codex r1). The shell is no longer merged.
5. The prototype ran outside the production envelope, with support from above and no stands (Codex r1).
6. The plinth needed a stage gate and a separate record (Claude r1).
7. The full-depth 12-block home rules must stay (Claude r2).
8. The tunnel's ground cost must be 100 (both r2).
9. One canary pool (Codex r2).
10. Capture before the dig, exact counters, and transit purpose from `isMining()` (both r2).
11. Hazard is judged from the world, with ownership taken before the hazard-making placement (Codex r2).
12. An explicit target scope for the tunnel (Codex r3).
13. Server-confirmed outcomes (Codex r3).
14. The selector test and dedupe (Codex r4).

## 8. Implementation amendment (steps 2-3 built, 10-13 evening; owner GO "yes do 2-4")

Built as digtown-01 (branch `dt-on-82aef34`) and townzone-01 (`tz-on-82aef34`); review record
`docs/reports/townground-steps23-review-2026-10-13.txt`. Where the build departs from sections 2.3-2.7:

- **Transit is UNTOUCHED, not priced.** mineflayer-pathfinder 2.4.5 adds the break exclusion to a move's cost only in a
  few scaffold branches (`safeOrBreak` uses it as the < 100 permission), and it discards any move whose cost passes 100.
  A surcharge therefore removes moves the base allows (a 2-high stone wall dug by hand costs 48; with +30 per broken cell
  the move vanished -- Codex code r2, reproduced on real `Movements.getNeighbors`). The zone refuses TARGET digs only
  (gather, mine, the ore tunnel's own profile); paths dig exactly as before.
- **The instrument's purpose comes from an async scope**, not a field on the bot (`AsyncLocalStorage`: an abandoned or
  overlapping goto cannot leak its scope). goto and surface run their own digs as transit, the reflex tick as survival.
- **The instrument's outcome is the server's word** (raw `block_change` / `multi_block_change`): confirmed / foreign /
  rejected / unconfirmed (10 s) / aborted / death / hung. Paper sandbox4: 7/7 fixtures, including two bots on one cell
  (both read confirmed; the read dedupes per world, cell and +-2 s) and a dig 300 ms after join, which Paper ignores
  (unconfirmed, and the world still holds the block: a real ghost).
- **mine's walk-out**: exits nearest first, accepted only where a clear stair with a dry first tread starts; a bot under
  a roof climbs first (surface below sea level, then a goto to the column's open top) and never tunnels to an exit at
  depth; a bot outside the square never walks across town. The 12-block full-depth rule stays.
- **Canary order (both engines)**: digtown-01 on its own instrument-only canary -> KEEP + fleet-wide promotion -> the
  restart lag and a 180-min instrumented pre-window -> townzone-01 (one pool). townzoneread refuses exposure until every
  arm x period carries `_dig_town_sum`. Z4/Z5/Z6 thresholds calibrated on 44 null samples (24 h, W 180).

## Files (scratch, not committed)
The townground agent's scratch, under `.../scratchpad/tg/`:
- `an/*.mjs`: dayone, sites, ctrl2, ctrl3, flow, plinth (r1), plinth2 (r2), saplings, sap2, plat.
- Host scripts: `digsrc.py`, `plants.py`, `cobble.py`.
- Outputs: `out-*.txt`.
- `gen.sh`.
- `review-*-codex.txt`.

The throwaway generation dirs are `/var/tmp/tg-gen/*` on 10.0.0.30: world data only, 296 MB.
