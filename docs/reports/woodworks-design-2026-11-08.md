# Woodworks: fences, gates, wooden bridges, boardwalks and docks (2026-11-08)

Owner, 11-08: the towns hold about 60,000 surplus logs. The owner approved builds that use them to make the towns pretty:

- **fences and gates** around farms, pens, path edges where they fit, and the managed forest;
- **boardwalks, docks and wooden bridges** at water edges, instead of dirt bridges, with clean banks.

The target pictures show neat edges, a stone or wood bridge over a river, and clean banks. The bots do the work, and there are no
admin edits. The pathfinder still never scaffolds over water (owner 10-27). Bridges built as designed structures are allowed
(owner 11-01).

## 1. Measured (read-only, 11-08)

Sources:

- the showcase mirror copy (`timelapse/mirror/world`, 13:30Z);
- live fleet region files, read only;
- the bots' own record files and the town index (the newest observation per container).

Survey script: `wsurvey.py`. The map's offline siting: `bots/scripts/wood-offline.mjs` on `fences-01show`.

| | Showcase (1 town, home 0,70,0, R 112, 50,625 columns, 0 unread) | Fleet (16 worlds, R 96 round each town's home) |
|---|---|---|
| Logs in town chests | **635** (spruce 559) + 170 planks; above the 512 reserve + 64: **101** | **65,320** over 16 towns (860..5,180 a town, mostly oak); planks ~3,100 |
| Fences / gates in chests | 0 / 0 (27 containers) | 0 / 0 |
| Records a fence could go round | crop farm (complete, box 7x5), managed forest (standing, 18x9), yard; **no pen record** | **none**: no farm, forest or pen record in any town |
| Paths | 546 path columns, **0 within 2 of water**; 60 path sides with a drop of 2+ beside them | paths in **2 of 16 towns** (224 and 314 columns), `no_site` in 11; 145 drop sides |
| Water | 3,176 water columns, 958 shore columns; lakes 58-105 from home, outside the wall | lakes 34-91 from home in every town; 4 towns have big lakes 9-49 from home |
| Bot blocks in water (dirt, cobble, grass, planks standing at the surface with water on two opposite sides) | **51** (43 dirt, 8 grass) | **2,718** over 15 towns (placebo-b 663, hive-c 478, hive-d 433, placebo-a 281, placebo-d 202, the rest 8-90) |
| Bridges | 2 cobble expedition bridges built (10 and 13 wide); 3 sighted and not built (7, 28, 1); 1 failed 3 times `unreached:water` (2) | none (no expedition or bridge code at 1e593b9b) |

Positive controls:

- The same column walk found 958 shore columns and 546 path columns.
- The water-adjacency test found the water bodies at 58+.
- The bot-block count reads `dirt`/`grass` on the showcase, and `cobblestone` too on the fleet.

Fence perimeters at distance 1 (the survey's ring, before the trees and the walk proof):

- the farm ring: 28 columns (21 open, 5 record cells, 2 path);
- the forest ring: 58 columns, all "open". The trees were not counted. The map then showed the ring mostly under a spruce canopy.

## 2. Design (Claude)

**The sixth town sink `wood`** (plot `wood`, blueprint `wood@1`, letter W). It is in `bots/src/sinks.mjs` with the pure code in
`bots/src/woodworks.mjs`. Like dress and decor, it is an **ornament kind**: it spends its own supply, logs. It never holds the
stone sinks back under `SINK.maxOpen` and is never held back by them. Any bot the picker sends builds it with the ordinary sink
visit (`buildrun.mjs runVisit`). Each instance is one structure:

- **ring**: a fence round one record's box, in the order forest, crop farm, pen.
  - It stands at the record's own zone + 1 (the forest's zone is its box + 1, so the ring is at 2). It never takes a column the
    record reserved for its stands or aisles.
  - It follows the ground (one step). It may stand under a low bough (leaves at fence + 1).
  - It is open at every path crossing and at the record's ways in (the farm's `front`; the forest's aisle ends).
  - It has at least two openings, on different sides. If it has fewer, it opens at the column nearest home and at the one
    opposite.
- **gate**: one an opening, the fence just beside it, closed and in line with the fence. `townstyle.mjs orientAim` gives the
  facing's yaw. The bots walk the open gap beside it.
- **rail**: a fence on a path's shoulder (level with the path or one below) where the ground beyond drops 2 or more. It is never
  over the drop and never on the path.

**Never:**

- a fence on a path, a record's cell or column, a door front (cellGuard ±2), a reservation (the decor's: plan cells and soft
  keepouts, wells, the tree farm, the land plan, markers), a wet column, or an unread cell;
- a ring round a retired record, or round a record already fenced;
- a structure the wood cannot pay for. The bill is at most 32 logs and is checked against the wood pressure. A refused structure
  is `unfunded`, and nothing is sited.

**The proof** (`proveFences`):

1. The town walk (`buildsite.mjs walkFrom` from home and the stood cells, out to 128) is walked with every fence and gate SOLID. A
   fence is 1.5 tall, never a floor, and never jumped.
2. That walk must keep every node it held without them, except the fences' own columns. A walk only gains when an obstacle goes,
   so every prefix of the build holds too.
3. On a loss, the first fence standing between a lost node and a held one becomes a 2-wide gap, at most 24 times.
4. A ring round ground the walk cannot reach is refused (`unreached`). The proof is never seeded to pass.
5. Every kept cell has a step (`stepFor`) over the cells placed before it.

**Material and refusal chain:**

- The wood pressure is the town's log units above the owner's 512 reserve + 64, counted only when coverage is at least 0.8, plus
  the bag above 16.
- The visit's **wood kit** crafts every fence and gate the open structure still owes from the bag's wood. It draws logs from town
  only above the reserve. Waived cells are never owed.
- A kit that cannot cover everything stamps the town's 2-h `wood_kit` stall, and the open structure is not offered under it.
- A visit that still ends `no_material` with nothing placed stamps the stall too. There is never a stall loop.
- `WOODWORKS=off`: nothing is sited, and sited structures stay protected records.

**Wooden bridges (boardwalk-01).**

- bridgepost-01's plan is reused cell for cell and click for click. The deck and sides are planks, and the rails are fences.
- The walkway's centre reads done only as planks, so the bots' dirt never stands for a wooden deck. The sides and rails take any
  solid, as before (a bank's rock is kept).
- A site names its material before its first block (`op=state mat=`), and new sightings carry `woodv: 1`. An old site takes wood
  only when its deck is read and empty.
- Wood is chosen when the town's wood above its reserve pays the whole bill: 3 planks and 2 fences a row, so 12 wide = 25 logs.
  Otherwise cobble, as before.
- `BRIDGE_WOOD=off` makes every new bridge cobble. The two standing cobble bridges are never touched.

## 3. Codex's independent design and the reconciliation

Codex (read-only, given the measurements and the goal, not this design) proposed:

- fence rings round the forest first, then the farm;
- rails on the measured drop sides, on existing support only;
- pens to wait for a pen record, and the yard to wait until its access is explicit;
- at least two permanent 2-wide openings on different sides;
- a proof that blocks the fence voxel and the one above, checks every prefix, never seeds an isolated worksite, and extends to
  R 112 for the forest;
- gates as ornaments beside permanent gaps until a tier-3 movement change makes them passable, with a permanent bypass kept even
  then;
- wood funding (respect reserves, keep 256 more, open above 512, at most 32 logs an instance, coverage at least 0.8);
- wooden bridges reusing bridgeSpan/bridgePlan/buildBridge with role-specific completion ("dirt must not satisfy a wooden deck");
- spans of 16 or less first, docks of 3x4 or 3x6, and shore boardwalks;
- dirt-line removal as a separate piece needing strong artificial-line evidence;
- for the fleet: funding plus rails in the two towns with paths, and a bridge-planner port as an explicit prerequisite.

| Point | Built | Why |
|---|---|---|
| Forest first, then farm; pens wait; yard deferred | as Codex | the yard ring has 68 open columns but its working access is not a record field |
| Two 2-wide openings, different sides | as Codex, plus the record's own ways in and every path crossing | |
| Proof: fence solid, no jump, prefixes, no seeding, R up to 128 | as Codex (prefixes hold by monotonicity, stated in the code) | |
| Drop a whole run on a loss | **different**: open a 2-wide gap where the walk went | dropping runs left the farm ring with 5 fences; gaps keep 11 + 1 gate |
| Gates: tier-3 movement change before any walked gate | **ornament now, as Codex.** The Paper run below found that mineflayer-pathfinder 2.4.5 does route through an OPEN gate. So a walked gate (gates-01) may not need a protected change. It needs its own proof with the bots' real walk profile first. | |
| Funding: keep 256 beyond reserve, open above 512 | **keep 64** beyond the 512 reserve | the showcase has 635 logs: 256 would leave nothing to build; the fleet's 65k makes it moot there |
| Bridges ≤ 16 first; docks 3x4/3x6; boardwalks | **wooden bridges built** (any width bridgepost builds: Paper 12 and 24 wide); docks and shore boardwalks designed, not built (below) | the dock needs a span with no far shore; the actuator is proven, the siting is not written |
| Strict completion | deck centre planks-only; sides and rails any solid | a bank's natural rock in a side cell would otherwise block a wooden bridge forever |
| Dirt-line removal separate, evidence-led | as Codex (piece boardwalk-03) | 2,718 fleet candidates are a strong surface signal, not ownership |
| Fleet funding + rails first | **not built**: rails in 2 towns are too little to be worth the port; the fleet waits for its paths (pathsfix-01) and forest (forest-01) | 0 of 16 towns has a record to ring |

**Codex review rounds (blockers only), all fixed:**

- fences r1 had 2 blockers:
  - a partial kit (gates but no fences) gave visits with no progress;
  - a waived cell was still owed a kit.
- boardwalk r1 had 2 blockers:
  - an unloaded half-built cobble bridge could be named wood;
  - the bridge kit's cap counted the bag's surplus wood.
- r2 for each: **NO BLOCKERS**.

## 4. Paper (sandbox7, Paper 1.21.8, the bots' own code)

`sandbox/woodworks/fence-proof.cjs` (results in `fence-proof.jsonl`). The ring was sited by woodworks.mjs over the bot's view,
each cell stepped by `stepFor`, and each click made by `botBuildEffects` with `orientAim`'s yaw for a gate:

- **F1:** 38 of 38 fences and gates placed by the bots' click, and each was on the server. Every gate's `facing` was in line with
  its fence.
- **F2:** the walk over the built world lost **0** of 999 nodes, and 99 nodes stayed inside the ring.
- **F3:** 12 of 12 pathfinder crossings in and out went through the openings, never over a fence.
- **G1:**
  - A closed gate as the only gap: **no path**.
  - The gate opened by activate: **the pathfinder walks through it**, although prismarine reports the open gate's bounding box as
    'block'. The mechanism is not yet traced: it is an observation, and gates-01 must prove it with the bots' walk profile.
  - A body walked through the open gate by hand.
  - The gap with the gate dug: a path.
- **K1:** a spruce fence craft gives 3 and a gate craft gives 1. Bare mineflayer crafts done back to back race the inventory
  ("missing ingredient" on the first fence craft). The bots' `craft` has craftsync for exactly this, and decorator-03 already
  crafts spruce fences live.

`sandbox/woodworks/boardwalk-proof.cjs` (results in `boardwalk-proof.jsonl`) used bridge.mjs `bridgeSpan` / `bridgePlan(span,
{ wood })` / `buildBridge` over `bridgeio.mjs`, with bridgepost's walk profile and the bots' shore egress:

- **12 wide:** 62 placed, 60 of 60 cells planks or fence on the server, intact, 0 wet ticks while building, **16 of 16 dry
  crossings**, torches on the fence rails standing, and intact after 30 s at randomTickSpeed 300.
- **24 wide:** 123 placed, 120 of 120, intact, 16 of 16 crossings, and it survives.
  - An earlier 24-wide run had 0 of 16 crossings because the harness blocked its own event loop with 120 one-by-one RCON calls,
    and the bot's connection lapsed (EPIPE). The checks are batched now.

## 5. Offline on the showcase (11-08 mirror, `wood-offline.mjs`, avail 101 logs)

| Instance | Result |
|---|---|
| W1 ring round the forest | 26 fences + 4 gates, 6 openings (the aisle ends, 3 wide each), 12 columns no floor (trunks), 6 fences gapped by the proof; **16 logs** |
| W2 ring round the crop farm | 11 fences + 1 gate, openings at its front and the path, 5 record cells and 6 proof gaps left open; **6 logs** |
| W3 rails | 6 fences on path shoulders (**3 logs**); a 4th instance: `rails:walk_lost` (no other run proves) |

Pictures, top down (brown = fence, orange = gate, pale = opening):

- `woodworks-design-2026-11-08/farm-before.png` and `farm-after.png`
- `woodworks-design-2026-11-08/forest-before.png` and `forest-after.png`

## 6. Pieces, tiers, placement

| Piece | Lane | Tier (protected.py) | State |
|---|---|---|---|
| **fences-01show** | showcase | 2 (not protected) | branch `fences-01show` @ **f378fde2** on the live release ef40871b; Codex r1 2 blockers fixed, r2 none; READY TO STAGE |
| **boardwalk-01show** (wooden bridges) | showcase | 2 (not protected) | branch `boardwalk-01show` @ **1fde1536** on fences-01show; Codex r1 2 blockers fixed, r2 none; READY TO STAGE (with or after fences-01) |
| gates-01 (walked gates: an OPEN gate in each path opening, the plain gap kept beside it) | showcase then fleet | 2 if the bots' walk profile walks an open gate as the Paper run did; else 3 (watermoves getBlock) | design; needs its own Paper proof with the bots' Movements |
| boardwalk-02 docks / shore boardwalks (a dock = a bridge span with no far shore: 3 wide, 4-6 rows, fenced end; sited from a shore the town walk reaches through a wall gate) | showcase | 2 | design |
| boardwalk-03 replace the bots' dirt lines in water with plank walkways and clean the banks (evidence: placed rows or a straight 1-wide line of bot material; build the replacement, walk it both ways, then dig the old line from retained stands) | fleet first (2,718 candidates), showcase (51) | 2 (3 if it touches the walk) | design |
| fleet-wood-01 (the wood sink as a fleet project: rails, forest ring once forest-01 lands, docks) | fleet | 2 | design; after pathsfix-01 and forest-01 |

- **Showcase order:** stage fences-01 + boardwalk-01 together, as one batch. They are independent, but both are woodworks. The
  shopread `wood` rule below must be installed first.
- **Fleet:** nothing to queue today, and no registration was written.
  - No fleet town has a record to ring.
  - Paths exist in only 2 towns (rails: 145 drop sides).
  - The fleet has no expedition bridges.
  - The fleet's logs are better spent once pathsfix-01 and forest-01 land (fleet-wood-01). The other big log user is the logcap
    work (logs-1108).

**Full suites:**

- fences-01show a53ff322 on ci2: 471/474. The three failures:
  - lavastep, a known flake;
  - nothing-important-is-orphaned (bagdiet), which fails on the live base too;
  - showcase-on-fleet, the project-list expectation, fixed in test-only commit f378fde2 and passing alone.
- boardwalk-01show 3e94b323 on w30: 469/474. The same three, plus plinth-skill (a flake) and well (a known base failure).
- 1fde1536 is 3e94b323 rebased onto f378fde2.

## 7. Tripwire (showcase), on main, NOT installed

- `docs/reports/shop-01-2026-10-25/shopread.py.txt`: `SINK_PLOTS` gains `wood`.
  - Every `_build op=place project=wood` fence or gate is a cell of a generation in force (G1).
  - Its foreign digs are judged against its cells (G2).
  - Selftest: the fence and the gate on their cells pass. Three positive controls trip: before W1's siting, beside its cell, and
    above its cell.
  - Mutant: `SINK_PLOTS` without `wood` is killed by the before-siting control.
- The wooden bridges need no rule. Their cells are bridgepost's `bridge_cells` (the same geometry), and expedition placements are
  not `_build` rows.

## 8. Read (after activation, +2 h and +24 h)

- `_sink op=sited kind=wood` (W1 forest, W2 farm);
- `_build op=place project=wood` count against the record's cells;
- `_wood op=kit` rows (fences and gates crafted, and `why`);
- `build_visit project=wood outcome=no_material` (must be rare: the stall holds);
- the town index's logs (down by the bills: ~25 logs for the three instances);
- tripwire G1/G2 = 0 for project=wood;
- for bridges: `bridge_pick mat=wood`, `bridge_done ... mat=wood`, `bridge_build stop=` and `bridge_broken` = 0;
- the chunky project and town renders for the picture.
