# Expeditions in stages until the bots can reach the whole map (showcase item 4), design 2026-11-01

## Owner direction, 11-01

| time | owner said | what it means here |
|---|---|---|
| ~22:15Z | "instead of 300 blocks from the town lets get to the point where bots have access to the whole map. we can do this in stages" | The goal is the whole map, reached in stages |
| ~22:25Z | "lets fit rails into our plan too" | Rails become stage S5 (owner X6/X7 had left them undecided) |
| ~22:40Z | "I have no problem with boats and bridges either" | **Supersedes owner-no-water-bridging-1027** for *designed* crossings |
| ~22:40Z | "do those things in the order you think is appropriate use claude and codex to find the best approach" | Recommended order in §10; both engines review |
| ~22:40Z | Water buckets allowed (relayed by the coordinator) | Used for lava on routes (§3.2) |

Two things stay unchanged:

- **Pathfinder scaffold-bridging over water stays off.** The `nobridge` walk profile stands. Bridges are build projects.
- **Item 4 comes after items 1, 2, 3 and 5** (storehouse labels, showcase mineshaft and deep miner, showcase chat, copper hall).
  The copper hall ([`copperhall-design-2026-11-01.md`](copperhall-design-2026-11-01.md)) is built to serve this plan: kit depot,
  and a floor map of coverage.

**This is a design.** No code, no showcase piece, no world change. Measurements are read-only, taken 11-01 21:50–22:15Z on the
showcase VM:

- region files, scanned by a ~100-line Python Anvil reader run there; scratch only, not committed
- the expedition trip and marker logs in the pool directory
- the bots' skill logs (`scripts/lib/telemetry.py`, full walks, 7–12 days)
- the server logs, and `tps` / `mspt` / `worldborder get` over the showcase's local RCON (read-only queries)

---

## 0. Answers first: the stage plan

| stage | what | exit criteria | needs |
|---|---|---|---|
| **S0** | Instruments: coverage metric, route/marker layer on BlueMap, expedition scoreboard line | metric and layer live 48 h; numbers match a hand spot-check | host scripts only (tier tooling / 1) |
| **S1** | **Reliable 300-block trips in all 8 directions** with marker roads: fix the bearing loop, y-aware zones, detours round villages, ice crossings, short **swims ≤ 24 blocks**, multi-call trips | 72 h on the showcase: each of the 8 bearings has ≥ 3 trips reaching ≥ 300 blocks, or a recorded impassable reason with its crossing site; ≥ 95% home without death; ≤ 1 expedition-linked death; markers standing ≥ 90%; project placement rate not down tier 2 for the zone, bearing, marker and multi-call pieces (`expedition.mjs`, the visit); **tier 3 for the swim leg** (r2, Codex: it rests on pathfinder water behaviour nobody here has seen work): two engines, a search, a Paper repro, then a fleet canary with expeditions on in the canary pool before showcase activation |
| **S2** | **Outposts every 300–500 blocks** (chest cache, beacon pillar, table) and **boats** for crossings longer than a swim | ring of ≥ 8 outposts at ~400; trips to 1,000 blocks in ≥ 6 bearings; boats: a Paper proof first, then ≥ 20 live crossings and 0 boat losses unrecovered | outposts tier 2; **boats tier 3** (own boat physics: mineflayer cannot drive a boat, §5) |
| **S3** | **Route network**: a persisted graph of nodes (town, outposts, markers, crossings) and edges; reuse and repair; **designed bridges** as build projects at the busiest crossings; night and lava policy; a return-home guarantee by graph | network ≥ 30 nodes; ≥ 80% of trips start on known edges; the first bridge complete and used ≥ 10 times; return-by-graph ≥ 98% | tier 2 for the graph; **bridges tier 3** (a moving-stand build over water, unproven): Paper + canary, then showcase |
| **S4** | **Frontier to the world border**: aim trips at unseen reachable chunks; chunk-generation guard; BlueMap render budget | *seen* ≥ 90% of reachable land inside the border (the headline metric); MSPT p95 < 30 ms throughout | tier 2 + tooling; owner question on pre-generation |
| **S5** | **Rails** on the corridors S3 proves are used | first line town ↔ outpost-1 complete and ridden ≥ 20 times; carts recovered; a speed win measured | tier 3 for riding (vehicle); the line itself is a build project; needs the deep miner's iron, gold and redstone |

The headline metric is **percent of the reachable map seen** (§8). Today it is **0.31%**: 1,066 of about 346,800 reachable
chunks. By raw border area it is 0.27% (1,069 of 391,876).

---

## 1. The showcase world, measured

### 1.1 Extent

- **World border:** "currently 10000 block(s) wide", centred on 0,0 (pregen log: `worldborder center 0 0`,
  `worldborder set 10000`). So x and z run −5,000..5,000. The **corner is 7,071 blocks** from home.
- **Chunks inside the border:** the border spans chunk coordinates −313..312 on each axis, so 626 x 626 = **391,876** (r2, Codex;
  r1 said 625 x 625).
- **Generated:** 17,176 full chunks, cx and cz −66..66. That is the pregen square of 81 tiles of 16 x 16 chunks, x and z
  ≈ −1,056..1,071, **4.4% of the border**. 36 region files, 171 MB.
- **Ungenerated:** **95.6% of the map does not exist yet.** Reaching it means generating it (§7).

### 1.2 Terrain in the generated square

**Biomes** (dominant surface section biome per chunk, 17,176 chunks):

| biome | chunks |
|---|---|
| snowy_plains | 3,807 |
| snowy_taiga | 2,944 |
| frozen_ocean | 2,423 |
| taiga | 2,204 |
| deep_frozen_ocean | 1,190 |
| frozen_river | 1,083 |
| deep_cold_ocean | 690 |
| cold_ocean | 667 |
| plains | 573 |
| snowy_beach | 479 |
| other | rest |

**It is a cold world.**

**The surface, by column:** 4.40 M columns in total. Each was classified from the two heightmaps and the block at the top.

| surface | share |
|---|---|
| land | **55.2%** |
| **ice** (ice / packed / blue on top) | **20.7%** |
| open water ≥ 3 deep | 22.3% |
| shallow water < 3 deep | 1.9% |
| lava | 17 columns |

**Reachability from the town on foot**, as a flood fill over columns from (0, 0). Each row adds one surface the bots may walk on:

| may walk on | land columns reached | of 2.42 M land |
|---|---|---|
| land only (today's expedition rule) | 1.88 M | **77.6%** |
| + ice (bots already walk on ice: `surfaceAt` reads ice as ground) | 2.29 M | **94.3%** |
| + shallow water (wading) | 2.39 M | **98.5%** |
| + swimming anything | 2.42 M | 100% |

**By radius, land only versus land + ice:** r 300: 75.6% / 99.9%. r 500: 68.9% / 99.9%. r 1,000: 78.1% / 97.7%.

**So the frozen water is the bots' road network.** Swimming short gaps covers almost all of the rest. Boats are needed for the
open oceans, and for sea-crossings beyond the generated square that we cannot see yet.

**Caveat:** the heightmaps come from the region files on disk, so the latest autosave. The "ice" class trusts the top block.
Thin river ice over a current is still ice to a walker.

### 1.3 What a straight spoke meets, per bearing

Bearings are the expedition's eight, 0 = +x, 2 = +z.

| bearing | first water | first long open water |
|---|---|---|
| 0 | 220 (1 block) | 595, 24 W |
| 1 | 270 | 310–330, several 4–7 |
| 2 | 158 (10 w + 34 W at 168) | 168 |
| 3 | ice from 92 (127 long) | none to 1,050 |
| 4 | none to 1,050 (ice runs) | none |
| 5 | ice at 104 / 114 | 143, 14 W |
| 6 | 89 (1), ice runs | 633, 13 W |
| 7 | 104 (8 w + 4 W) | 317–335, short runs |

### 1.4 Zones

There are **seven villages**, all `scenery`, which is keep-out (owner 10-20, option 1).

| village | box (x, z) |
|---|---|
| taiga 103,-7 | x 49..157, z −59..45, right outside the town to the east |
| taiga 374,-335 | |
| snowy -788,777 | |
| snowy -818,-774 | |
| snowy 15,862 | |
| snowy -925,-199 | |
| snowy 934,-472 | |

**The trial chambers under the town**, box x −20..88, z 65..164, **y −64..31**: protected (owner 10-21 #18 and 10-25).

### 1.5 Server headroom

- **TPS** 20.0 / 20.0 / 20.0 (1 m / 5 m / 15 m).
- **MSPT** avg **6.6 ms**, min 5.0, max 22.8 over 1 m, with 10 bots. That is **13% of the 50 ms tick budget on average**.
- **"Can't keep up"** warnings: 18, all on 10-20, the pregen day, up to 30.9 s behind. **0 on every day since**, across 14 log
  files. Positive control: the same grep finds the 10-20 lines.
- **Host:** 16 cores, Paper at ~20% of one core, 23 GB RAM available, 243 GB disk free.
- **Settings:** `view-distance=8`, `simulation-distance=6`.

### 1.6 Deaths on the showcase

- **0 player death messages in the server logs**, 10-20..11-01, 14 files. Peaceful, keepInventory.
- **Positive control:** the same files log "joined the game" 30–122 times a day, and the pattern does match "showcase-Iris was
  kicked for floating too long" (5 kicks in 12 days).
- **The floating kick matters for boats and swims:** `allow-flight=false`.

---

## 2. What blocks trips today (expedition-01)

**127 trips** in `expedition-0_70_0.trips.jsonl`, 10-31 17:20Z .. 11-01 21:46Z (28.5 h, 10 bots, 2 slots).

**Why trips turned:**

| reason | trips |
|---|---|
| zone | **51** |
| reached the ring | 30 |
| water | 25 |
| blocked | 7 |
| time | 6 |
| interrupted | 5 |
| unread | 3 |

**Return:** 108 came home in the trip's own call (crumbs). 17 were closed `later` by `home` following the trail. 2 came home by
`home_crumbs`.

**Per bearing:**

| bearing | trips | max dist | main reason |
|---|---|---|---|
| 0 | 2 | 12 | zone / blocked (taiga village) |
| 1 | 16 | 56 | **zone 12** (taiga village) |
| 2 | 40 | 55 | **zone 38** (the trial chambers, see below) |
| 3 | 7 | 271 | time 3, reached 2 |
| 4 | 14 | 233 | reached 11 |
| 5 | 21 | 150 | reached 12, **water 7** |
| 6 | 10 | 222 | reached 5, time 3 |
| 7 | 17 | 78 | **water 17** (the lake) |

### Three findings drive S1

1. **The bearing-2 loop is a bug: 38 trips were spent hitting the same zone at 54–55 blocks.**
   - `tripBearing` blocks a bearing for 24 h only when a trip turned *before 40 blocks*. The zone's edge, grown by its 8 margin,
     is at about 54, so the rule never fires and the least-travelled rotation keeps choosing bearing 2.
   - **Worse, the zone is underground.** The trial chambers stop at y 31; the surface there is about y 66. `zoneHit` tests
     x/z only, so a surface walk over the chambers is refused. The owner's protection is against tunnelling in, not walking
     over the grass.
2. **The east village closes bearings 0 and 1, and part of 7.** It is keep-out, so the walk must go *round* it. Today's bends
   of ±25° and ±50° from the bot cannot clear a 108 x 104 box that starts 49 blocks out.
3. **The lake closes bearings 5 and 7 at 50–80 blocks.** The crossings on those spokes are 8 + 4 (bearing 7, at 104) and
   ~17 (bearing 5, at 140). These are short. `lineClear` refuses *any* water column (no bridging, owner 10-27). A swim of 24
   blocks or less would open both.

**Distance:** the best trips reached 271 (bearing 3, over ice) and 233 / 222. One trip must fit the showcase's 180 s
`SKILL_TIMEOUT_MS`. The measured round-trip pace is **3.1 blocks/s median** (15 returned trips ≥ 150 blocks, including the 20 s
gather), so one call tops out near **270 blocks out**. 300 needs a trip that spans calls (S1).

**Coverage today:**

- **Chunks stood in:** bot positions over 12 days, 600,580 rows, cover **347 chunks**. 97.9% of rows are within 100 blocks of
  home; the furthest chunk is 285 blocks out.
- **Chunks seen:** `InhabitedTime > 0` in the region files (a chunk a bot loaded) covers **1,069 chunks**, all within 500
  blocks.

---

## 3. Policies (apply from S1 unless noted)

### 3.1 Water crossings

**Owner 11-01:** boats and bridges are fine. Pathfinder scaffold-bridging stays off.

| crossing | how | stage | why |
|---|---|---|---|
| **ice** (20.7% of the surface) | walk it (already happens) | S1 | **Never place a marker torch within 3 blocks of ice.** Block light above 11 melts ice next to it (wiki), so a marker beside a frozen lake would cut a hole in the road. `markerSpot` refuses those cells, or the marker is placed without its torch. Packed ice does not melt. |
| **water ≤ 24 blocks**, measured on the line | **swim / wade** | S1 | Owner standing rule: swimming is travel. Pathfinder already floats across the surface (`liquidCost`), but it will not plan underwater or step up out of water (pathfinder issues #391 and #344), so a swim leg ends on a **standable shore cell with a 1-block step**, chosen by `surfaceAt`. **Air is never short at the surface.** The drowning reflex (protected) is unchanged, and the leg is refused if the far shore is a cliff ≥ 2 up. |
| water > 24 blocks | turn, and record a **crossing site** (both shores, width, bearing) | S1 | It becomes a candidate for a boat dock (S2) or a bridge (S3). |
| **open water ≥ 25** | **boat** (S2, after a Paper proof) | S2 | §5 |
| **busy crossings** | **designed bridge** project | S3 | §6 |
| rails over water | on a bridge only | S5 | rails wait for bridges |

**Why the 24-block cap:** the measured lake crossings on bearings 5 and 7 are 12–17 blocks. The cap is a constant, so the
fast path is a setting change.

**The floating kick:** 5 kicks in 12 days, "floating too long". Any leg that is a swim logs `swim_leg` with its start, end,
width and outcome, so a kick shows up in the row stream. If kicks rise, the cap comes down.

### 3.2 Lava on routes (owner 11-01: buckets allowed)

- **Lava on the surface is rare:** 17 columns in 4.4 M.
- **The S1 rule:** a line with a lava column is refused, as now (`LIQUID` includes lava), and the trip bends.
- **S3:** a **route-repair** step may pour a water bucket on a surface lava pool in a known edge to make obsidian or cobble.
  It uses `bucket.mjs`, which is protected, so that piece is tier 3 and goes in only if a measured edge is blocked by lava.
- **Underground lava is the deep miner's problem (item 2), not the expedition's.**

### 3.3 Night and shelter

- **Peaceful: no hostile mobs.** Night is a camera problem (the frames go dark), not a survival one.
- **S1–S2:** keep today's rule (start by tick 9,500, turn at 12,000) for **frontier** legs. That is the owner's "reliability
  over speed", and it keeps the expeditions in the daytime frames.
- **S3:** travel on known edges is allowed at night (the route is walked, lit by markers), and frontier legs stay day-only.
- **No shelters needed.** Outposts are camps, not houses.

### 3.4 The return-home guarantee

Layered; each layer is a fallback for the one before.

1. **The trail.** Breadcrumbs and markers, as now. A trail survives the call, and `home` follows it. `TRAIL_TTL` (3 h) becomes
   *per trail leg since the last node*, so a multi-day trip is never orphaned.
2. **The graph (S3).** Every node stores its next hop home. `home` from anywhere goes to the nearest known node, then follows
   the graph.
3. **Direct walk** toward home in legs, as now.
4. **Stranded (r2, Claude):** there is no deliberate way home by dying (peaceful, no admin commands), so the last layer is a
   recorded `stranded` state: the bot's position, its last node, and why each layer failed. It goes to the showcase tripwire and
   reaches the owner within the 3 h stuck rule, with options. An accidental death still respawns the bot at town
   (keepInventory); that is logged `returned=false via=respawn` and counts against the deaths budget (§3.6).

### 3.5 Beds and spawn

- **No beds in S1–S4.** A bed sets the bot's spawn. A bot that respawns at an outpost would make "home" ambiguous and break the
  respawn fallback above.
- Beds need wool (shears, sheep), so they are not cheap anyway.
- If outposts ever host bots overnight, that is an owner question at S4.

### 3.6 Deaths budget

- **Baseline:** 0 showcase deaths in 12 days (§1.6).
- **Budget from S1:** **≤ 1 expedition-linked death per 50 trips**. A death is linked if the bot had an open trail, or died
  within 2 min of a swim leg.
- **The trip:** 2 linked deaths in 24 h trips `EXPEDITION=off` (the kill switch) through the showcase tripwire, then diagnose.
  This is the fleet's two-death floor, applied to expeditions.

### 3.7 Bot allocation

- **Today:** `EXPEDITION_SLOTS=2` of 10 bots, admitted only when the town's build order has nothing for the bot
  (`project_open` refuses).
- **Kept as the rule in every stage.** Expeditions never take a bot a project can use. Slots grow with stage:

| stage | slots |
|---|---|
| S1 | 2 |
| S2 | 3 |
| S3 | 3, + 2 builders for a bridge, as a project |
| S4 | 4 |

- **A slot is never filled while a project segment has material and an open lease.** That is the existing admission.

### 3.8 Performance

- **Each far bot adds chunks:** about 289 loaded (view distance 8 → 17 x 17) and 169 entity-ticking (simulation distance 6).
  Four bots out add about 1,150 loaded chunks.
- **MSPT** is 6.6 ms with 10 bots, ~44 ms under budget.
- **Guard (tooling, S1):** the showcase heartbeat already runs every 15 min. It records `mspt` (avg / max, 1 m) to the heartbeat
  row, and expedition admission refuses new trips while the last read is > 30 ms avg. The admission reads a small file the
  heartbeat writes; a missing or old file means "unknown", which admits at S1's 2 slots only.
- **Chunk generation** is the real cost. §7.

---

## 4. The stages in detail

### S0: instruments (start any time; host-only, no showcase piece)

- **`wholemap.py`** (host, showcase VM, nice 19, daily + on demand).
  - It is the region-file reader used for this doc, made into a script with tests.
  - **Writes `coverage.json`:**
    - **seen%**: chunks with InhabitedTime > 0, over reachable land chunks.
    - **stood%**: from bot positions in the skill logs.
    - **reach**: the walkable-surface flood fill (land / ice / shallow / swim tiers).
    - per 1,111-block tile, for the copper hall's floor map.
  - **Denominator rules:**
    - Inside the generated area: reachable land + ice chunks.
    - Ungenerated chunks count in the border denominator at the generated area's measured share of chunks with at least one
      land or ice column (15,199 of 17,176 = **88.5%**) **until generated**, then they are measured. The script prints both numbers, and the denominator, every time.
- **BlueMap layer.** A marker set generated from `expedition-*.markers.jsonl`, `trips.jsonl` and, at S3, the graph: points for
  markers, lines for walked edges, a polygon per village and zone. Written as a BlueMap marker file on the VM, so no plugin is
  needed. The owner's live map then shows the roads. The `expeditions` camera (330, ortho) already exists.
- **Scoreboard line** (fleetstatus showcase block):
  `expeditions: trips 24h N, home% , furthest, seen% X (Y chunks), stage S1 3/8 bearings`.

### S1: reliable 300 in all eight directions

All changes are in `expedition.mjs` (pure) and the `expeditionVisit` visit. `protected.py` decides the file tier, and nothing
here touches movement profiles. **But the swim leg (item 4) is tier 3 by fun mode's other rule** (r2, Codex blocker 5): it rests
on pathfinder water behaviour nobody here has seen work. So S1 ships as **two pieces**: S1a (items 1–3, 5–7: tier 2, showcase
first) and S1b (the swim leg: two engines, the search in §5, a Paper repro, a fleet canary with expeditions on in the canary pool,
then the showcase). S1a alone opens bearings 0, 1 and 2. Bearings 5 and 7 wait for S1b.

1. **Fix the bearing loop.** Block a bearing for 24 h after **two** turns on it for zone, water or blocked, at any distance below
   half the ring. With the detour (item 3) in place this mostly never fires.
2. **y-aware zones for surface legs.** `zoneHit(zones, x, z, margin, { surfaceY })` ignores a zone whose box top is ≥ 8 below
   the surface there. The trial chambers stay fully protected against digging (`protectzone.mjs`, protected, unchanged).
   Behaviour test: bearing 2 over the chambers' box at surface y 66 passes; a village box at the same x/z refuses.
3. **Detour round a zone.** When a leg's line meets a zone, `legTarget` tries the zone box's two near corners, grown by the
   margin, as waypoints. Pick the one whose detour toward the bearing's spoke is shorter, and whose line from here is clear. The
   leg after the corner rejoins the spoke. This opens bearings 0, 1 and 7 past the east village. Pure; tested on the village's
   real box.
4. **Water policy** (§3.1). `lineClear` returns `{ ok: true, swim: { from, to, width } }` for a water run ≤ 24 with a standable
   far shore; otherwise `why: 'water', crossing: {...}`. Crossings are appended to `expedition-*.crossings.jsonl` (both shores,
   width, depth class), which S2 docks and S3 bridges read.
5. **Ice-safe markers** (§3.1): `markerSpot` refuses a base within 3 of ice (`ice`, not `packed_ice`), or places the cobble
   without the torch.
6. **Multi-call trips.** A trip may end its call *out* (`phase: 'out'`), with the trail persisted. The next admission of that
   bot continues the trip, either out or turning home, instead of starting a new one. `ringOf` is allowed to 300 only for
   multi-call trips. `TRIP_COOLDOWN` applies between trips, not between calls of one trip. `RING_MAX` 300 stays; S2 lifts it.
7. **Kit:** unchanged (12 cobble, 6 torches). The S1 300-block spoke needs about 8 markers.

**Exit (72 h on the showcase):**

- every bearing has ≥ 3 trips reaching ≥ 300, or a written impassable reason with its crossing site
- home ≥ 95% (crumbs, later or graph) with no respawn
- ≤ 1 expedition-linked death
- ≥ 90% of markers still pillars on a re-read (`pillarIs`, sampled by the next trip passing)
- the build placement rate on any open project not below its previous 72 h

**S1b Paper repro:** one swim leg of about 20 blocks across a lake, ending on a 1-up shore, 20 times, in the sandbox harness.
No kick, no drowning reflex firing, the far shore reached each time. The lake trips so far turned before trying.

### S2: outposts and boats (300 → 1,000)

**Outposts** (build project `outpost@1`, tier 2):

- **What one is:** a 3 x 3 cobble pad and a chest (the cache), a crafting table, and a **beacon pillar** (5 cobble + torch, seen
  from about 100 blocks on the BlueMap and in the camera). Sited on dry, flat ground within 50 blocks of the 400-block ring on a
  walked bearing, outside every zone (+16), and never on ice.
- **The cache:** about 16 torches, 32 cobble, 8 logs, and a spare boat once boats exist. It is refilled by passing trips from
  the hall depot (copper hall §7). Valuables from far gathering (ore, ingots) are banked to the cache when the bag is full, and
  carried home by a later trip. That is the owner's X5 "outposts take valuables".
- **Owner question O1:** X5 said **one outpost per town**. Reaching the whole map needs **a chain**: about 8 at 400, 16 at
  1,000, and about 150 to the border (§4 S4). **Ask to lift X5 to "one per ~400-block route node".**
- **Trips become hops:** town → outpost → frontier, each hop one call (≤ 270 blocks at 3.1 b/s). The ring logic is per-hop,
  measured from the hop's start node.

**Boats** (tier 3, see §5): a Paper proof of the boat driver first, then docks at S1's recorded crossing sites wider than 24.

**Exit:**

- ≥ 8 outposts standing on the 400 ring
- trips to ≥ 1,000 on ≥ 6 bearings
- 0 outposts lost (`pillarIs` and the chest open)
- boats: ≥ 20 crossings, 0 unrecovered boats, 0 linked deaths
- deaths within budget

### S3: the route network and bridges

- **The graph** (`routes-<town>.json`, generational like the project records):
  - **Nodes:** town, outposts, markers, crossing sites, docks, bridges.
  - **Edges:** walked legs, with length, walks, failures, last walked and hazards (swim width, lava, zone detour).
  - **Writes:** a returned trip's walked legs; a failed hop adds a failure.
  - **Decay:** an edge with 3 failures and no success in 7 days is closed until a repair.
- **Reuse:** a trip plans town → the frontier node nearest its target over the graph (Dijkstra on length × failure penalty),
  then explores. Most bot-time is on known edges, which is the reliability the owner asked for.
- **Repair:** passing a marker that `pillarIs` reads as gone re-places it (2 cobble + torch). A closed edge gets one repair trip
  a day.
- **Bridges:** the busiest crossing site (walks/day × width) becomes a `bridge@1` project (§6).
- **Return home by graph** (§3.4, layer 2).
- **Exit:**
  - ≥ 30 nodes
  - ≥ 80% of trip legs on known edges
  - the first bridge complete and walked ≥ 10 times
  - home-by-graph ≥ 98% over 7 days

### S4: frontier to the border

- **Aim.** The target of a trip is the nearest cluster of **unseen reachable** chunks adjacent to the network (from
  `coverage.json`). Nodes extend outward, and an outpost is founded when a frontier is more than 400 from the nearest node.
- **The scale is feasible.** `InhabitedTime` grows only in chunks within simulation distance (6), so a bot walking a line
  *seen*-marks a swath about 13 chunks (208 blocks) wide (r2, Claude; r1 said 17). Seeing the remaining ~345,700 reachable
  chunks at that width takes about **425,000 blocks of new walking**.
  - At 3.1 b/s: **~38 bot-hours of frontier walking**, if routes were perfect. Plan for 5–10x, because of overlap, return legs
    and water.
  - That is **weeks at 2–4 slots**, not months.
  - It needs about 150 outposts. Cheap: each is about 25 cobble, a chest, 6 torches.
- **Generation.** §7. The owner decides between letting bots generate as they go, under the MSPT guard, and a rate-limited
  overnight pre-generation of the next ring. **Owner question O2.**
- **BlueMap render budget.** The timelapse service renders incrementally inside a 13-minute TimeoutStartSec. Newly generated
  chunks are all "changed", so a big generation day could push a slot past the timeout. S4 renders new chunks in a separate
  low-priority BlueMap job and keeps the timelapse's incremental pass bounded.
- **Exit:** seen ≥ 90% of reachable land inside the border; MSPT p95 < 30 ms over the stage; deaths within budget.

### S5: rails

§9.

---

## 5. Boats

What we found: a search of the mineflayer and pathfinder issues and PRs, and the installed `bots/node_modules`.

| | finding |
|---|---|
| installed | mineflayer **4.37.1**, mineflayer-pathfinder 2.4.5, minecraft-data 1.21.8 |
| **driving** | `bot.moveVehicle(left, forward)` sends `player_input` on 1.21.3+. **Nothing in mineflayer sends `vehicle_move` or `steer_boat`.** The vanilla client *simulates its own boat* and reports the position; the server does not move a boat for its rider. **So a mineflayer bot in a boat does not go anywhere.** Same family as horse steering, issue #2766 (open since 4.4), and #3726 (mounted bots cannot steer). |
| placing | `bot.placeEntity` on 1.21.2+ omits the new `rotation` field and throws a SizeOf error. Fix PR #4085 is merged but not released (latest release 4.39.0). It also waits for an entity named `boat`, but 1.21.8 has one entity type per wood (`spruce_boat`). **Workaround:** hold the boat, look at the water, call `bot.activateItem()`, then find the nearest `*_boat` entity. |
| dismount | `dismount()` on 1.21.3+ sends a jump input the server ignores; vanilla dismounts on sneak. PR #4093 is open. **Workaround:** hold sneak until the `dismount` event fires. |
| riding position | the bot's position is not updated while riding (#3615); attach/detach events broken (#2819, PR #3937 open) |
| pathfinder | no boat movement at all |
| recover | one hit breaks a boat and drops it as an item |
| recipe | 5 planks of one wood (spruce here) |
| speeds | 8 b/s on water, 40 on ice, ~72 on blue ice (wiki) |
| Paper | `moved-too-quickly-multiplier` 10 and the vehicle "moved too quickly" check. Vanilla's limit (squared distance > 100 per packet) is far above a boat's 0.4 b/tick on water. |

**So boats mean writing a boat driver.**

- **What it does:** each tick, compute the boat's next position along a straight segment toward the far dock (water speed
  ≈ 0.4 b/tick), with collision against the loaded blocks, then send `vehicle_move` and the matching yaw.
- **Where it lives:** a new `boatdrive.mjs`, pure stepping plus a thin packet sender.
- **Tier 3:** a movement writer, Paper behaviour nobody here has seen work.
- **Prior art:** one proxy project does exactly this, open water only.
- **Risks:**
  - "moved wrongly" corrections
  - the floating kick while seated (it should not apply to passengers; Paper check)
  - the rider position bug (#3615): read the boat's entity position, not `bot.entity`
  - chunk edges

**Plan:**

1. **B0, a Paper spike, sandbox only.**
   - **Steps:** craft a spruce boat. Place it from a shore with `activateItem`. Mount. Drive 40 blocks straight across open
     water with our `vehicle_move`. Dismount by sneak onto the far shore. Break and collect the boat. Repeat 20 times.
   - **Pass:** 20/20 crossings, no kick, no "moved wrongly" in the server log, no lost boat.
   - **Two engines, plus this research.** Then, being tier 3, a fleet canary with boats on in the canary pool before the showcase
     (fun mode's tier-3 path).
2. **B1, boat crossings live on the showcase.** Only at **docks**: a recorded crossing site > 24 wide, with a 1-block cobble
   quay on each shore built as a tiny project.
   - **The first crossing at a new site** (r2, Codex blocker 3: the far quay cannot be built before anyone has crossed). The bot
     launches from the near quay toward the crossing site's recorded far-shore cell, read from the loaded chunks (view distance 8
     covers 128 blocks). It lands only on a cell `standableAt` accepts. It places the far quay's one cobble and a marker, then
     records the dock. If no standable landing is found within the boat's budget, it **turns back to the near quay** (the return
     route is the water it crossed), and the site is marked `no_landing` for a week.
   - **B0 proves this procedure too:** 20 first-landings on unbuilt shores in the sandbox. The bot draws a boat from the hall depot or an outpost cache, crosses, and
   **carries the boat on** (breaks it on the far quay, 1 slot), so no dock depends on a parked boat. Parked boats at docks are a
   later option once the counts show boats are lost while carried.
3. **Ice boats (later, optional):** 40 b/s on ice would make the frozen-ocean roads very fast. Same driver, different friction.
   Only after B1 is boring.

**Why boats are S2, not S1.** S1's measured lake crossings are 12–17 blocks, which swimming covers. The dry-land, ice and swim
reach is already 100% of the generated square's land. Boats buy speed on open oceans and the far side of seas we have not
generated yet, and they cost a tier-3 movement driver. Doing S1 without them removes the 50–80 block cap now, without waiting
for a Paper spike.

---

## 6. Bridges

- **What:** a `bridge@1` blueprint family in the build system: segments, leases, camera.
- **Site:** a crossing site from S1/S3 chosen by use (walks/day × width) once the graph exists. The first candidate is the
  bearing-5 / bearing-7 lake.
- **Shape:**
  - **Deck:** 3 wide at water + 2, stone bricks with a cobble core. Width 3 so a later rail fits on the centre line.
  - **Railings:** cobble walls, or 1-high stone bricks.
  - **Lights:** a torch every 8; not near ice.
  - **Abutments:** a 3 x 3 stone-brick block on each shore.
- **Building over water** is the new behaviour.
  - Each deck cell is placed **from the deck already built** (the builder stands on the last placed cell). The deck
    advances from the shore one row at a time, so no placement is ever "over water from water". This is a building visit with
    a moving stand.
  - **Not the pathfinder scaffolding the owner turned off:** it is a designed structure placed by the build system, from a
    standable cell.
  - **Tier 3** (r2, Codex blocker 5): a moving stand over water is behaviour nobody here has seen work. Two engines, a Paper run
    (a 20-block deck built over the sandbox lake by 2 builders, `proveSite` showing every deck cell has a stand on the deck
    behind it), and a fleet canary with bridges on in the canary pool, then the showcase. The blueprint data itself is ordinary.
- **Cost per 20-block bridge:** about 60 deck cells, 40 railings and 12 abutment cells, so about **110 stone bricks + cobble,
  3 torches**. Bricks come from cobble (the town holds 1,000) via mats. The 80% rule applies as for any project.
- **Order:** S3, after the graph says which crossing is used. Rails over water need a bridge (S5).

---

## 7. Chunk generation and loading

- **Pregen cost (measured):** 81 tiles (20,736 chunks) in 1,043 s, **≈ 20 chunks/s** with every tick lagging (18 "Can't keep
  up", up to 31 s behind).
- **The whole border** is 391,876 chunks, ~374,700 ungenerated. **Disk:** 171 MB / 17,176 chunks ≈ 10 KB a chunk, so
  **~3.7 GB more**. 243 GB is free.
- **Walking generates slowly:** a bot walking into new terrain at 3 b/s crosses a chunk row every ~5 s and generates about 17
  chunks per row, so **~3.4 chunks/s per bot**. Two frontier bots are about a third of pregen's rate, spread out. The MSPT
  guard (§3.8) is the backstop.
- **Option O2a (no tool):** bots generate the world by walking. S4 caps **frontier legs** (legs into chunks with no region data)
  at **2 bots at once**.
- **Option O2b (tool, owner decides):** a rate-limited pre-generation of the *next* ring, e.g. 1,100 → 2,000, overnight, with
  `pregen.py`'s tile method throttled to MSPT < 25.
  - Generation is not an edit of built blocks, but it is a tool acting on the world, so it is the owner's call.
  - **Snapshot first**, as for any world-touching tool.
- **BlueMap:** 121 MB now; on the order of 2–3 GB at full coverage. Render new chunks in a separate nice'd job (S4).
- **Rails and loading:** an 8 b/s cart crosses a chunk every 2 s, about 8.5 chunks/s of loading. Fine inside generated terrain;
  rails never run into ungenerated chunks.

---

## 8. The metric: percent of the reachable map seen

**Seen%** = chunks a bot has loaded (`InhabitedTime > 0`), over **reachable land chunks** inside the border.

- **Reachable:** a chunk with ≥ 1 land or ice column connected to home by the walk tiers in force: land + ice + swim ≤ 24, and
  later boats and bridges.
- **Inside the generated square** it is measured exactly: 15,199 chunks with a land or ice column, all of them reachable once
  swims are allowed. Outside it, chunks count at that 88.5% share until they are generated, so the border denominator is
  about 15,199 + 0.885 x 374,700 ≈ **346,800**.

Reported numbers:

- **Seen% (border, reachable):** 1,066 / ~346,800 = **0.31%** today (1,069 / 391,876 = 0.27% by raw area).
- **Seen% (generated reachable):** 1,066 / 15,199 = **7.0%**.
- **Stood%:** a bot stood in the chunk. Stricter, for the camera story. **347 chunks today.**
- **Per stage:** the seen% inside each stage's radius (300, 1,000, border).
- **Per tile (1,111 blocks):** for the copper hall floor map.

**Why InhabitedTime:** it is the server's own counter of how long players have kept a chunk loaded. It is in every chunk, free to
read from the region files, and it cannot be fooled by a bot's log. Its limit: it says *loaded*, not *walked*. That is why
stood% is reported beside it.

---

## 9. Rails (stage S5)

**Where they fit:** after S3 has measured which corridors carry trips. A rail line is worth its iron only on an edge walked many
times a day. **Entry rule:** an S3 corridor with ≥ 10 walks a day for 7 days, ≥ 300 blocks long, fully dry or bridged.

### 9.1 Material economy

| part | recipe | per 1,000 blocks of line |
|---|---|---|
| rail | 6 iron + 1 stick → 16 | 1,000 rails = 63 crafts = **378 iron**, 63 sticks (970 plain rails + the 30 powered below) |
| powered rail | 6 gold + 1 stick + 1 redstone → 6 | 1 per 34 blocks holds 8 b/s with a rider (wiki) → 30 = 5 crafts = **30 gold, 5 redstone** |
| power | redstone torch (1 redstone + stick) beside each powered rail | **30 redstone** |
| minecart | 5 iron | 1 per rider; **5 iron** |
| stations | chest + 2 rails + a stop block, at each end | |

**Showcase income, measured** (pickups, 7 days, 10 bots):

- raw_iron: 268 (≈ 38/day)
- **raw_gold 0, redstone 0**
- raw_copper 478, coal 230, lapis 83

**Positive control:** the same parser finds the copper, iron and coal pickups.

**Iron already has a use:** pickaxes and the toolkit. The town holds 16 iron_ingot; bags hold 30 ingots and 27 iron pickaxes.

**So rails depend on item 2's deep miner.**

- **Gold:** ore is most common below y 32 (and at y −16 in standard generation).
- **Redstone:** below y 16, most at y −58.
- **Iron surplus:** only after the toolkit's pickaxes are covered.

**First line, town ↔ outpost-1 at ~400:** about 150 iron, 12 gold, 14 redstone, 2 carts. That is roughly 4 days of the whole
showcase's iron income, so it waits for the deep miner's numbers.

**A whole-map rail grid is out of reach:** 8 spokes of 4,500 is 13,500 iron. **Rails are trunk lines to the busiest outposts,
never the network itself.**

### 9.2 Routing

- **Along the surveyed marker roads,** on graph edges with the lowest grade.
- **Grade:** rails climb one block per block on a slope, but carts slow uphill. Keep slopes short and add a powered rail at each
  climb.
- **Cuts and tunnels:** through hills of ≤ 3 high, as a build project (dig), outside every zone.
- **Over water: only on a bridge** (§6, the 3-wide deck's centre line).
- **Never through a village or zone box.**
- **Never on ice next to torches.**

### 9.3 Stations

- **Each end:** a chest of minecarts, a stop block, a crafting table, and a short platform.
- **At outposts:** the outpost cache doubles as the station chest.
- **The town station sits outside the wall at the gate** (N sector), so carts never cross town paths.

### 9.4 Building, as a project

- **A `rail@1` line blueprint** whose segments are ~32-block stretches, with leases per stretch. These are the same mechanics as
  paths@1's legs: `paths` already lays long linear brushes on the showcase (300 cells, 13 active hours).
- **Placement order matters:** a rail shape auto-connects to its neighbours, and at junctions and slopes vanilla prefers
  W, E, S, N. Each stretch is laid **from one end, in order along the line**, with the powered rails and their torches as the
  stretch's last cells.
- **Its own camera:** `rails`, ortho, along the line.

### 9.5 Riding (tier 3)

- **Mount:** `bot.mount` works.
- **Carts are server-simulated,** unlike boats, so powered rails move the cart without client physics. `moveVehicle`'s forward
  push is a nicety; we rely on powered rails.
- **Placing the cart:** `placeEntity` refuses minecarts (issue #3284). `activateItem` will not work either (r2, Codex blocker 4):
  in 4.37.1 it sends `use_item` with no block target, and a cart is placed by using it **on the rail**. So hold the cart and
  `bot.activateBlock(railBlock)`, then confirm a `minecart` entity spawned on that rail before mounting. R0 proves it.
- **Dismount:** sneak (the same bug as boats).
- **The "minecart improvements" experiment must stay off.** Mineflayer cannot parse those packets (#3555).
- **Paper spike R0, as for boats:** 20 rides of 400 blocks, 0 stuck, 0 lost carts. The bot's position is read from the cart
  entity (#3615).

### 9.6 Maintenance

- **Carts:** a ride that ends without the cart in the end chest goes back to collect it; carts are counted per station.
- **Track:** a broken rail on a ridden stretch (the ride stops early) re-opens that stretch's segment for a builder. The
  ordinary project mutation, as the paths extensions.

### 9.7 Benefit, stated plainly

| | walking | rail |
|---|---|---|
| pace | 3.1 b/s round-trip median (measured) | 8 b/s cart max |
| 400-block hop | ~130 s | ~50 s plus boarding |
| 1,000 blocks | ~320 s | ~125 s |

- **About 2.5x faster.**
- **The bigger win is reliability.** A rail ride has no pathfinding, no water, no detours and no stalls, and makes a
  1,000-block hop one call.
- **Hauling:** chest minecarts later, for outposts' valuables.

**It is not a speed revolution.** Ice boats at 40 b/s would be faster on the frozen ocean, if B0 works. **We recommend rails for
the 1–2 busiest corridors after S3, not before.**

---

## 10. Recommended order across all of it

Owner: "do those things in the order you think is appropriate". The owner's order (1, 2, 3, 5, then 4) is kept. Inside it:

1. **Now, alongside items 1–3:**
   - **S0 instruments.** Host-only, tooling / tier 1. Not a showcase piece, nothing on a bot.
   - **Design the B0 boat spike.** Sandbox only.
   - Both feed every later step and stage nothing.
2. **Copper hall (item 5).** After items 1–3; copper accrues meanwhile (copper hall doc §5). Its depot chests are the S1/S2 kit
   source.
3. **S1a** (tier 2): zone fixes, ice-safe markers, multi-call trips. This is item 4's first build. It goes after the copper hall, or
   **while the hall waits for copper** (recommended: the wait is days, and the two share no material or code). It opens bearings
   0, 1 and 2. Then **S1b** (tier 3: the swim leg ≤ 24, Paper, then a canary), which opens bearings 5 and 7.
   **Together they remove today's 50–80 block cap without boats.**
4. **S2a outposts** (the 400 ring), **in parallel with the B0 → B1 boats** (tier 3, canary-style Paper spike, then docks).
5. **S3 route graph**, then the **first bridge** at the busiest crossing.
6. **S4 frontier**, with the owner's O2 answer on generation.
7. **S5 rails** on the 1–2 busiest S3 corridors, once the deep miner shows gold and redstone income.
8. **Optional:** `stonecutter-01` (cheaper copper, a copper roof for the hall); ice boats.

---

## 11. Owner questions

- **O1.** Lift X5 "one outpost per town" to **one per ~400-block route node** (a chain), for the whole map?
- **O2.** Chunk generation for S4:
  - **(a)** bots generate as they walk, ≤ 2 frontier bots, MSPT guard; or
  - **(b)** also allow a throttled overnight pre-generation of the next ring (a server tool, snapshot first)?
- **O3.** Night: allow travel on **known** edges at night from S3 (frontier legs stay daytime)?
- **O4.** Beds at outposts stay **off**, so spawn stays at town?

---

## 12. Reviews

**Two-engine design review, blockers only, on r1.** Both engines reviewed this doc and the copper hall doc together.

**Codex (`codex exec`, read-only): BLOCK.** Three blockers here, all fixed in r2:

- **B3, boats.** Docks on both shores cannot open a new sea route. **Fix:** a first-crossing procedure (§5, B1), which B0 also
  proves.
- **B4, minecarts.** `activateItem` cannot place a minecart. **Fix:** `activateBlock` on the rail, then confirm the entity
  (§9.5).
- **B5, tiers.** The swim leg and the moving-stand bridge rest on unproven behaviour, so they are tier 3. **Fix:** S1 is split
  into S1a and S1b; bridges are tier 3 (§0, §4 S1, §6).

Codex arithmetic corrections, applied: the border spans 626 x 626 chunks, and rails need 378 iron per 1,000 blocks.

**Claude (independent subagent): no blockers in this doc.** Notes applied:

- the seen swath is 13 chunks wide, because `InhabitedTime` follows simulation distance (§4 S4)
- return layer 4 is a recorded stranded state, not a respawn (§3.4)

**r2 re-check (blocker fixes only): Codex APPROVE, Claude APPROVE.** All seven blockers are fixed and no new blocker was found.
Both noted that the flat-world proof does not cover the live pad's earthwork (up to about 5 fill); that is the sandbox gate in
the copper hall doc §6.

---

## 13. Owner decisions (11-01 ~23:30Z, relayed by the control session)

The owner confirmed the control session's defaults for the four questions in section 11:

| | decision | applies from |
|---|---|---|
| **O1** | **Yes: a chain of outposts**, one per ~400-block route node (lifts X5 "one outpost per town") | S2 |
| **O2** | **Yes, both:** bots generate terrain as they walk (at most 2 frontier bots, the MSPT guard), **plus** a throttled overnight pre-generation of the next ring **only while TPS stays >= 19.5** (snapshot first) | S4 |
| **O3** | **Yes:** night travel on **known routes** only; frontier legs stay daytime | S3 |
| **O4** | **No beds at outposts**; respawn stays at town | S2-S4 |

## 14. Build log

- **S0, 11-01 23:08Z:** `infra/showcase/wholemap.py` live on the showcase VM (daily full scan + hourly trips; BlueMap layer; the
  fleetstatus `expeditions:` line). First run: seen 1,067 reachable chunks of ~346,729 (0.308%), 7.06% of 15,114 generated
  reachable; stood 347. Main `0e570478`.
- **S1a, 11-02:** dead bearings (two obstacle turns short of the ring), zones judged at the walk's height, detours round a zone
  (DETOUR_PAD 10), no torch within 3 of ice, multi-call trips (rings past 225: out share 0.6, the trail home may finish next call),
  a late close near town costs the ring nothing. **Offline on the showcase terrain** (region export |x|, |z| <= 420, the real
  zones, legTarget leg to leg, no pathfinder): bearing 0: 306 (detour round the east village; was 0), 1: 317 (was 56), 2: 157 water
  (was 57 zone), 3: 313, 4: 316, 5: 135 water, 6: 316 (was 236), 7: 318 (detour; was 95 water). Bearings 2 and 5 wait for S1b's swim.
  **Not in S1a:** a second call continuing OUTWARD (every order is issued at town; that needs `cognitive.mjs`, protected) -- it
  goes with S1b's canary.

