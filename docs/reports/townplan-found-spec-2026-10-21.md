# townplan-01 and found-01: the build specification (2026-10-21, r1)

Pieces 3 and 4 of the town plan (`docs/reports/town-plan-2026-10-20.md`, both engines APPROVE r9; OWNER 10-20 "yes, lets do
this"; OWNER 10-21: first pieces next in the lane, signs as labels, the bench storehouse = the sorted chest cluster, no
stray-table pickup, "no rush, lets do it the right way"). This note CONFIRMS that design and REFINES it to the level the code
needs. Where the two disagree, the design's approved behaviour stands unless a row below says why it changed. Section
numbers `§x` are the design's.

Base: the expected stack at their turn is indexsearch-01's tip (townindex-01 + indexsearch-01 re-varianted on the fleet's
34d3e5e9 / ironpick-01 2d410985). That re-variant was not on origin when this was built, so the build base is a LOCAL stack:
`2d410985` (ironpick-01 on 34d3e5e9) + townindex-01 (e05b7bec..e5ce173f) + indexsearch-01 (e96891a1..8f811303), cherry-picked
with four conflicts resolved by composition (named in the review record). **A re-stack onto the real indexsearch-01 variant
is needed before either piece is registered for launch.** townplan-01 needs the index (the retrofit home allocation, §6.1,
lives in townindex.mjs `allocateHomes`); found-01 is stacked on townplan-01.

---

## 1. townplan-01 — the plan file and the planner

### 1.1 What it is

Pure bot code that writes ONE siting file per town (§4.1) and reads it back for three adopters. It places no block, opens no
container and moves no bot. Rollback: `TOWNPLAN=off` (nothing written, nothing read: today's behaviour, byte for byte at
every adopter). Isolated memory scope: off (no plan in v1, O8).

Modules:
- `bots/src/planstore.mjs` -- the generation files, the acceptance walk, the head checkpoint, compare-and-swap publish. Pure
  over a directory; no bot.
- `bots/src/townplan.mjs` -- the ring@1 geometry, READY cells, joint access, orientation fit, the annex, the retrofit fit,
  sectors and zones, the keep-out predicates the adopters call. Pure over a `read(x, y, z)`.
- hooks: `index.mjs` (a 30 s planner tick at town; the licence row), `skills.mjs` (the three adopters), `cognitive.mjs` none.

### 1.2 The file (§4.1, §4.3), exactly

- Directory: `poolStateDir(MEMORY_POOL)` (the town's own; the showcase: `/var/lib/mcai/_pool-showcase/`).
- Generation files `townplan-<hx>_<hy>_<hz>.g<N>.json`, created ONLY by `link(tmp, gN)` (fails if N exists). Never pruned,
  never rewritten.
- Head checkpoint `townplan-<hx>_<hy>_<hz>.head.json` = `{ v, world, gen, sha }`, replaced by atomic rename after an accepted
  write.
- `sha` = sha256 of the generation file's exact bytes.

**The acceptance walk** (`planHead(dir, key, world)`), reading only file contents, never the reader's clock:
1. List the generations on disk, ascending. Start from the checkpoint when its file exists, parses, is of this world and its
   bytes hash to its `sha`; else from the lowest file.
2. Files whose `world` is not the reader's world are ABSENT (skipped, not rejected): a reseeded world gets a fresh root.
3. The ROOT is the lowest file of this world with `prev: null` that parses and passes `planRefusal` (the schema).
4. Each later file K of this world becomes the head only if it parses, `K.prev === head.gen`, `K.prevSha === head.sha`, and
   `transitionRefusal(head, K)` is null. Anything else is REJECTED: skipped, never deleted.

**Transition rules** (`transitionRefusal(prev, next)`; one exported pure function, tested by behaviour):
- `v`, `template`, `world`, `home`, `mode` unchanged.
- GEOMETRY of a plot (its box, its cell positions and kinds, `s`, orientation) may change only while the PREVIOUS
  generation has NO cell of that plot `reserved` or `placed` (an `unplaced` store may be re-fitted; a committed one may not).
- A `placed` cell stays `placed`, same kind (immutable: §4.1 "placed and built cells are immutable").
- A `reserved` cell (`by`, `visit`, `until`) leaves only as:
  - the same reservation (same `by` and `visit`), `until` unchanged or later (a renewal);
  - `placed` (same kind), written by the same `by`+`visit`, OR by anyone once `next.at > until + 60 s` (an observed block);
  - `free`, with a `transitions[]` entry `{ at, why: 'released', by, visit }` matching the reservation, or
    `{ at, why: 'expired' }` with `next.at > until + 60 s`.
- A cell may become `reserved` only from `free`.
- A plot in state `building`/`complete` keeps every cell (none in v1; storehouse-01 adds them).
- A home assignment on a `placed` cell (`role: 'home'`, `group`) never changes; the retrofit `groups.homes` lists never lose a
  container once written (`groups.v` unchanged).
- `gen` = max on disk + 1 at the writer's cycle (not `prev + 1`: §4.1's max+1 rule); `at` is the writer's clock, stored.

**A writer's cycle** (`publishPlan`): head V -> `mutate(V)` (may return null: nothing to write) -> link `max+1` with
`prev = V.gen`, `prevSha = sha(V)` -> re-walk -> own file is the head: write the checkpoint, done; else rebase on the new head
and retry, at most 3 tries, then give up this visit (P4). A rejected file never blocks later writes (P5).

Tests (behaviour, `bots/test/planstore.test.mjs`): two writers from one V (the second links max+1 = V+2 with prev V: rejected,
it rebases onto V+1 and links V+3); a corrupt highest file followed by a write; a stale writer after a restart (its V is
behind: rejected, rebases); an expiry: the same files re-walked before and after the reader's clock passes `until + 60 s` give
the same head; a checkpoint whose sha does not match is ignored; a file of another world is absent; a generation that drops a
placed cell, moves a reserved cell, or steals a live reservation is rejected; each with an anchored mutant.

### 1.3 The plan's content (§4.3, v1)

```
{ v: 1, template: 'ring@1', gen, prev, prevSha, world, home: {x,y,z}, s, mode: 'greenfield'|'retrofit', orientation,
  at, by, code, seed: null | { file, sha },
  plots: [
    { id: 'core', kind: 'plaza', box: [x0,z0,x1,z1], y, state: 'existing'|'planned', keepout: <bool> },
    { id: 'store', kind: 'storehouse'|'annex'|'cluster'|'unplaced', box?, y?, door?, state, keepout,
      cells: [ { at: [x,y,z], kind: 'chest', stand: [x,y,z], role: 'overflow'|'home'|null, group: null|'<g>',
                 state: 'free'|'reserved'|'placed', by?, visit?, until? } ] },
    { id: 'work', kind: 'workshop', box, y, state, keepout,
      stations: [ { at, kind: 'crafting_table'|'furnace', stand, state, by?, visit?, until? } ] },
    { id: 'well', kind: 'well', sector, ref: <well/plinth record key or null>, state },
    { id: 'farm', kind: 'farm', sector, composter: [x,y,z] | null, state },
    { id: 'shaft'|'monument'|'pavilion'|'hall'|'gate', kind, sector | null, state: 'planned'|'unsited' } ],
  paths: [ { id, to, width: 2, seg: [x0,z0,x1,z1], state: 'planned' } ],
  groups: { v: 1, status: 'greenfield'|'waiting'|'allocated', homes: {g: [key]}, overflow: [key], drain: [key],
            pending: [g], unknown?: n },
  zones: { file: 'protected-zones.json'|null, n, avoid: n },
  transitions: [ ... ] }
```

Changes from §4.3, each for a reason:
- Cells are listed per plot (`store.cells`, `work.stations`) with their own `stand`, rather than `sections[]` by group: in a
  greenfield town no group has a section until its first stack arrives (§5 F3: "a group's home container, placed when that
  group's first stack is about to be deposited"), so a cell's `role`/`group` is written when it is placed, in fill order.
  `groups.homes` is derived from those cells (greenfield) or written by the allocator (retrofit).
- Paths are axis-aligned 2-wide SEGMENTS (`seg`), not cell lists: a segment is a keep-out predicate for every adopter and
  paths-01 lays the cells. It is also the showcase site note's own `paths: [[x1, z1, x2, z2]]` shape.
- `keepout` on a plot says whether adopters must keep out of its box + 1. The bench's core and its chest cluster are NOT
  keep-outs (the cluster IS the storehouse, O3 (a); the recovery keeps placing beside the full chest as today); the
  greenfield core, store, workshop and every retrofit workshop are.
- `zones` records how many protected zones and seed `avoid` boxes the fit honoured (the read checks it).

### 1.4 The ring@1 geometry (§3), exactly, orientation E (offsets from home: dx east, dz south)

Rotations: E (u, v) -> (dx, dz) = (u, v); S -> (-v, u); W -> (-u, -v); N -> (v, -u). `u` = out from home toward the
storehouse, `v` = lateral.

| plot | cells (orientation E) |
|---|---|
| core | box u -6..6, v -6..6 (13x13) |
| store | pad box u 7..15, v -4..4 (9x9; every pad cell within 15.9 straight-line); future walls the 7x7 ring u 8..14, v -3..3; door (u 8, v 0); interior u 9..13, v -2..2. The 13 container cells run along the three inner walls: (9..12, -2), (13, -2), (13, -1..1), (13, 2), (12..9, 2). CHESTS on the alternate ones (they never share a side): (9,-2) (11,-2) (13,-2) (13,0) (13,2) (11,2) (9,2) = 7 chests, 189 slots (§3). The 6 gap cells are not listed (no barrel in v1). Fill order = distance to the door, then the perimeter order: (9,-2) OVERFLOW, (9,2), (11,-2), (11,2), (13,0), (13,-2), (13,2). Each chest's `stand` is the nearest cell of the interior's middle 3x3 (u 10..12, v -1..1; ties lower u, then lower v): a bot opens a chest within reach, not only from a side, and the corner chests' side neighbours are the gap cells a later barrel fills |
| work | a 5x3 strip on one lateral side: station row v = +7 (or -7), u 7..11; stand row v = +6 (or -6, the core side), outer row v = +8 (or -8). Stations in order: u 7 crafting_table, u 8 furnace, u 9 furnace, u 10 crafting_table, u 11 furnace. found-01 fills station 0 (table) and station 1 (furnace) only; workshop-01 the rest. Each station's `stand` is its core-side neighbour |
| well | sector = the cardinal opposite the storehouse (W for E) |
| farm | sector = the lateral cardinal NOT taken by the workshop; composter = the first cell on the farm's inner edge row (lateral 9; u 0, then +-1 .. +-6) that passes the composter's own `siteRefusal` and the READY floor rule, else null (the composter's own siting, as today) |
| outer | shaft (collar d 17-21), monument (apron 52x52 at d >= 25), pavilion (9x7, d 22-44), hall (11x9, d 22-44), gate (2-wide stub at 44, cardinal sectors only): sectors chosen in a fixed preference order, skipping a sector taken by another outer plot and any sector whose plot EXTENT (below) meets a protected zone or a seed `avoid` box; none free -> `state: 'unsited'` |
| paths | 2-wide segments from the core's edge (d 7) out to: the well (d 9), the farm's inner edge (d 9), the gate (d 44); the store and workshop adjoin the core and need none |

Outer-plot EXTENTS for the zone test (3-D boxes, so an underground zone such as the showcase's trial chambers counts only for a
plot that digs): shaft = its collar centre (d 19) +-26 horizontally (the collar and a 24-block tunnel reach), y -64..s+3;
monument = apron centre (d 51) +-27, y s-4..s+40; pavilion / hall = band centre (d 33) +-17, y s-4..s+16; gate = (d 44) +-3,
y s-4..s+6; inner plots = their box, y s-3..s+6. Preference orders: shaft NE, SE, SW, NW, then the free cardinals; monument
NW, NE, SW, SE, W, N, E, S; pavilion and hall the cardinals not taken (gate first), then the diagonals; gate: the cardinal,
not the storehouse's, with the most OPEN columns (dry, not a tree, loaded) at d 22-44 among those the reader has loaded,
ties in the order S, W, N, E. (The bench's Z0/M0 sites are offline data, not in the build: the sectors here are the plan's
only claim, and monument-01 / shaft-01 site inside them later.)

### 1.5 READY, joint access, and the fit (§4.5)

**READY cell** (`readyCell(read, c, ctx)`), for a container or station at (x, s+1, z):
- (x, s, z) is a SOLID FULL block: `boundingBox === 'block'`, one full-cube shape when shapes are given, and not a container,
  table, furnace, leaves, ice, slab, stairs, path, farmland, door, trapdoor, scaffolding, shulker, hopper (the composter's
  FLOOR_NO list);
- (x, s+1, z) is placeable-into (air, cave_air, short_grass, fern, dead_bush: the composter's PLACEABLE_INTO) and (x, s+2, z)
  is empty and not liquid (the lid stays free; nothing is dug: townzone refuses digs of town ground above home.y - 12);
- no liquid (water, lava, flowing, bubble column, or a waterlogged block) in the 3x3 columns at y s..s+2;
- not inside a protected zone (`protected-zones.json`, this world) or a seed `avoid` box; not the home column;
- keep-outs (§1.6): no town furniture (container, table, furnace, bed, lectern, composter, bell) within 1, no well cell
  (`knownWellCells`, plinth caps) within 2, no tree or sapling (log, leaves at or below s+3, `_sapling`) within 1;
- every cell read (unknown = not ready, and an unknown cell anywhere in the fit box means NO PLAN YET).

**Joint access**: with EVERY candidate container and station cell treated as solid, a breadth-first walk from home's standing
cell (feet at home.y; floor solid, feet and head passable and dry; steps of +-1; inside Chebyshev 20 of home; never through a
candidate cell) must reach at least one `stand` of each cell (the stand itself must stay walkable and must not be a candidate
cell; a stand's feet may be at s, s+1 or s+2 with the container's centre within 4 of its eyes). A cell no walk reaches is dropped and the walk repeats until no cell is dropped (bounded by the candidate count).
Deterministic.

**Greenfield fit** (no plan, no town container in `inTown`):
1. For each orientation in E, S, W, N and each workshop side (+v first): `s` = the most common ground level (top solid block)
   of the 9x9 store pad's columns (ties: lower); the chest and station cells are judged READY at that `s`; then joint access.
2. Qualifies: the first 4 chest cells (fill order) and stations 0 and 1 are READY and accessible.
3. Choose the qualifying fit with the most READY cells; ties in the order E, S, W, N, +v, -v.
4. A seed (`town-site.json`, §1.8) may name `orientation` and `s`: honoured when that fit qualifies, else ignored (logged).
5. **No qualifying fit -> the ANNEX** (§4.5 step 2): cells with Chebyshev >= 7 inside `inTown` (straight-line 16, 12 vertical),
   off every path and plot keep-out, scanned ring by ring (Chebyshev), then x, then z; READY at the most common READY height;
   no two chest cells sharing a side; joint access as above. Roles jointly, the TABLE FIRST: the first cell is the workshop
   table's, then up to 4 store cells (`store.kind: 'annex'`), then one furnace cell. >= 2 cells: a (partial) annex. Exactly
   1: the table's, and `store.kind: 'unplaced'`. 0: `store.kind: 'unplaced'`, no work plot (`found:no_site`, F5). An
   unplaced store is re-fitted on later visits (its geometry is free to change: nothing is reserved or placed).

**Retrofit fit** (no plan, >= 1 town container):
- core = box d <= 6, `existing`, not a keep-out; store = `{ kind: 'cluster', state: 'existing', keepout: false }` (O3 (a)).
- groups (§6.1): when EVERY container in `inTown` has a KNOWN index entry (townindex `indexStateOf === 'known'`), `status:
  'allocated'` with townindex.mjs `allocateHomes` (the unit-tested allocator that reproduces data/homes.json); else
  `status: 'waiting', unknown: n` (a home is never chosen from an unknown entry; count_town covers unknowns, 3 per visit), and a
  later generation allocates. After allocation: a container that appears later is appended to `drain`; a group that has stock
  in the index and no home gets the emptiest KNOWN drain container in a later generation (moved from `drain` to
  `homes[g]`). Nothing else re-allocates.
- work = the NEAREST free strip (§6.1.4): 5x3, else 5x2 (station row + the stand row toward home), else 4x2; station row
  along x or along z; every station cell READY at its own row's level and 7 <= Chebyshev <= 15; the stand row walkable;
  joint access; never the LAST standing cell of an existing container or table (chestfull `standingCells`); nearest = the
  station row's centre to home, ties x, then z, then along-x first. None: `work` is absent (found_work never fires).
- well = the town's well record (`junkwell-site` / plinth record) by reference, sector from its cap; farm = the composter's
  position if there is one (sector from it), else the preference order; outer and paths as greenfield.

**The planner tick** (index.mjs, every 30 s, only while the bot is inside `inTown` and its world id is known): read the head;
no plan -> fit and publish (a root); a plan -> maintenance only when something changed: (a) retrofit `waiting` -> allocate;
(b) retrofit new container / new homeless group; (c) a `reserved` cell past `until + 60 s` -> `placed` if the cell holds its
kind (observed), else `free` with an `expired` transition; (d) an `unplaced` store -> re-fit. At most ONE publish per tick
per bot, each through the CAS cycle. Every bot computes the same fit from the same reads; the first to link the root wins
and the others read it.

### 1.6 The adopters (§4.6; "reads as occupied")

| adopter | change | rollback |
|---|---|---|
| recovery chest siting (chestfull `chestSiteRefusal` via skills `fullChestRecovery`) | a new cell refused if it is in a keep-out plot's box + 1 or on a path segment (+0) | TOWNPLAN=off |
| well siting (`wellAvoid` -> well.mjs `canonicalWellSite` / `wellSiteRefusal`; plinth-first uses the same search) | a cap refused when the well's footprint (cap +-2, the plinth shell) meets a keep-out plot's box + 1 or a path; the spiral tries the plan's well SECTOR first, then the rest (a preference, never a restriction: a full sector does not create a no-site the base would not have) | TOWNPLAN=off |
| composter siting (`canonicalComposterSite` compute) | a site refused in a keep-out plot box + 1 or on a path | TOWNPLAN=off |

No adopter is changed for a town without a plan. The tree farm, the town floor and structureguard are not in the build
(their adoption lands with them).

### 1.7 Protected zones and the no-dig zone

- Zones: `<poolStateDir>/protected-zones.json` (protectzone-01's file, version 1, bound by `hashed_seed` to this world).
  townplan reads it itself with a small parser of the same format (protectzone-01 is not in this base); a broken file means
  NO PLAN (fail closed: never plan around a zone it could not read). When protectzone-01 lands first, both read one parser
  (a follow-up, named in the review record).
- Seed `avoid` boxes (§1.8) are the same test: the showcase's trial chambers (not in the zones file: an owner "ASK") are an
  avoid box, so no digging plot (the shaft) is sited over them.
- The no-dig zone (townzone-01, kept): every READY cell needs NO dig (air above s, the floor already solid), so the founding
  never asks townzone for a refused dig, and townzone keeps every pad's ground.

### 1.8 The showcase seed (`town-site.json`, §4.7)

The site note's file IS the seed: the showcase reads `home`, `board`, `border_radius`, `builds_core`; townplan reads the
same file from the town's directory (`<poolStateDir>/town-site.json`; the showcase installs `/srv/showcase/town-site.json`
there) and uses, when present and bound to this world (`hashed_seed`): `town_plan.template` (must be ring@1),
`town_plan.orientation`, `town_plan.s`, `town_plan.avoid` (3-D boxes). `home` must equal the configured home, else the seed
is ignored (logged). A seed is optional; without it the planner fits from the configured home. The exact file for the
showcase is §4 below.

### 1.9 Rows and the read

- `_townplan_mode` (licence, once per spawn): `phase=mode plan=on|off v=1 template=ring@1 tick_s=30 seed=<ok|absent|bad:..>
  zones=<n|bad>`.
- `_townplan` (the change row; one per publish attempt, and one per 10 min per reason for a no-plan tick): `op=root|alloc|
  adopt|expire|observe|refit result=accepted|lost|rejected|gave_up|no_plan gen=N prev=M mode=.. orient=.. store=sections:7|
  annex:k|unplaced|cluster work=5x3|5x2|4x2|annex|none ready=a/b access=a/b zones=n why=..`.
- The read (`scripts/host/townplanread.py`, `--selftest`): per canary town, the plan files from the pool directory, re-walked
  by a Python port of the acceptance rules (exposure: an accepted plan in each canary town and >= 1 accepted generation after
  the root across the arm; gates: 0 accepted generations that the port rejects (a writer bug), 0 recovery-chest claims and 0
  well-site records written after the deploy inside a keep-out plot + 1 or a path, 0 plan cells (free/reserved) on a
  protected-zone or avoid cell; no-harm: deposit and town_deposit success DiD, recovery `no_site` DiD, well `no_site` DiD,
  deaths by the default gate; arms: no control `_townplan*` rows).

### 1.10 Dead ends (§8, the rows this piece can create)

| # | meets | what happens | next legal move |
|---|---|---|---|
| P1 | a well re-site wants a plot cell | refused there; the spiral continues (sector first, then the rest) | its own search: another cap, or `no site` exactly where the base would also have none outside the plots |
| P2 | a mine or gather wants a plot cell inside 16 | townzone already refuses target digs of town ground (kept) | mine's walk-off; gather's search reaches past |
| P3 | a plot cell would need a dig | never planned (READY needs none) | re-fit |
| P4 | link() of max+1 fails 3 times | give up this tick | the next tick (30 s) |
| P5 | the highest file is invalid | skipped by readers; writers still use max+1 | no freeze |
| P6 | (new) the recovery's rings meet only keep-outs | the base's wider search (other full containers, home) and then the plan's ANNEX scan of cells outside the plots | a cell, or the base's `no_site` refusal ("keep working and deposit later"), never a new one |
| P7 | (new) the zones file is broken | NO PLAN (fail closed), logged once per 10 min | every adopter behaves as today |
| P8 | (new) a bench town with unknown containers | `groups.status: waiting`; count_town covers unknowns | allocation at the visit after the last unknown is counted |

---

## 2. found-01 — first containers and stations go into their plots

### 2.1 Orders (deterministic town orders, never the model's; `bots/src/found.mjs` decides, pure)

| order | eligible when | does |
|---|---|---|
| `found_store` F2 | inTown; a plan with store cells (sections or annex); NO town container in `inTown`; the bot carries a chest, or has >= 8 planks above `townKeeps` (planks + 4 x logs, the stockpile and ladder keeps honoured) and room | the overflow cell (fill order 0), else the next free READY cell: reserve -> walk -> re-read the head (the reservation must still be in it) -> re-check READY -> craft a chest if none carried (`craft`, which uses any table in reach or places and takes back its own, as today) -> place -> read back -> open it once (the index observes it) -> publish `placed`, `role: 'overflow'` |
| `found_store` F3 | inTown; a plan; the bag holds a stack the town deposit WOULD bank (towndeposit `townDepositPlan`, same keeps) whose group has no home; no free container (greenfield: none unassigned; retrofit: no drain container); a free store cell (greenfield) | greenfield: the next free cell in fill order, `role: 'home', group: g`; retrofit (cluster): the recovery's own siting (`pickChestSite` around the cluster) with the plan's keep-outs and the recovery's budget (4 a day, 12 standing, its claim ledger), `role` recorded in the plan as a retrofit home |
| `found_work` F1 | inTown; a plan with a work plot whose station 0 (crafting_table) is free; the bot carries a crafting table (its only one is enough), or >= 4 planks above the keeps and room | reserve station 0 -> walk to its stand -> re-read -> place the carried table (crafting one first if needed) -> read back -> publish `placed` |
| `found_work` F3b | inTown; station 1 (furnace) free; station 0 PLACED; the bot carries a furnace, or >= 8 cobblestone above the stockpile keep and the workshop table in reach | the same, for the furnace (crafted at the workshop table) |

Bounds: at most one found order per visit (a visit = continuous presence inside `inTown`; a bot that leaves and returns
starts a new one) and a 10 min cooldown per bot after any found order; one TOWN-WIDE found lease (the furnace-lease file
shape: `townplan-<home>.found-lease.g<N>.json`, `wx`, 4 min TTL, renewed during the walk and craft, its generation re-checked
immediately before the click); the reservation's `until` = now + 4 min, renewed in the plan only when more than half has
passed (§4.6). Section cells have their own cap (the 7 cells); the recovery's 4-a-day / 12-standing budget stays for chests
outside the plan (F3 retrofit and the recovery). Order position: after the raised well and BEFORE the town deposit (a
first chest is what lets the deposit bank at all), ahead of the milestone work order (which would starve it otherwise),
only when the bag is under 36/36 for a crafted chest.

### 2.2 Placements that already happen, redirected (§7.1)

- **The full-town recovery, greenfield:** when the town's containers are full, its new chest goes to the next free READY
  store cell (the section cap, not the recovery budget), through the same reservation protocol; with none free, the base's
  rings with the plan's keep-outs, then the annex scan (P6). Retrofit: the base's rings with the keep-outs (the cluster is
  not a keep-out), then the annex scan.
- **The composter (F5):** the composter's site compute takes `farm.composter` first when it passes its own `siteRefusal`.
- **The well (F6):** townplan-01's adoption (sector first).
- **craft:** nothing to change: it already walks to the nearest table in reach and takes back only tables it placed
  (`retakeTables` reads `placedHere`), so a workshop table is never retaken and is used while in reach. Proven in Paper, not
  assumed.

### 2.3 Dead ends (§8 F1-F6, W1, with the refined remedies)

| # | meets | what happens | next legal move |
|---|---|---|---|
| F1 | no chest and no 8 planks above the keeps | not eligible | gather and craft as today; the deposit skips `nothing_found` as today; the next eligible visit founds it |
| F2 | the cell is occupied, unready, or a body stands in it on arrival | released (an explicit transition); the next free READY cell on the next order | if none: the annex rule |
| F3 | every store cell placed and every home full | not eligible | the overflow; then the recovery as today (outside the plots) and the annex scan; then the base's refuse_cap / no_site ("keep working and deposit later") |
| F4 | no qualifying orientation | the annex | found_store places into annex cells |
| F5 | no READY cell | `store: unplaced`, `found:no_site` | bots keep working; bags fill; the well and prune run as today; re-fit each visit |
| F6 | a crash between `reserved` and `placed` | the reservation lapses at `until`; after `until + 60 s` any planner tick writes `expired` (no block) or `placed` (the block is there) | the next eligible order |
| F7 | (new) another bot holds the found lease | not eligible this decision (a free skip) | the lease ends within 4 min |
| F8 | (new) the craft fails (no room, no table placeable) | released; the order backs off 10 min | the craft's own remedy, as today |
| W1 | the workshop furnace is leased (a smelt at it) | found_work does not use furnaces; no conflict | -- |

### 2.4 Rows and the read

- `_found_mode` (licence, once per spawn): `phase=mode found=on|off v=1 cooldown_min=10 lease_s=240`.
- `_found` (the change row, one per order run, every exit): `order=store|work kind=chest|crafting_table|furnace step=F2|F3|F1|
  F3b outcome=placed|released|refused|lost_lease|lost_reservation|craft_failed|place_failed at=x,y,z source=carried|crafted
  gen=N role=overflow|home|- group=g|- ms=..`.
- `_found_recovery` (the recovery's redirected placement): `cell=section|ring|annex at=..`.
- The read (`scripts/host/foundread.py`): exposure = found rows on the canary (INCONCLUSIVE on exposure is expected on the
  bench, §9 row 4: the FOUND scenes are the gate); defects (REVERT): a `placed` plan cell whose block is absent in the same
  bot's later rows (`_townplan observe` reads it), a found placement outside a plan cell, a lid-blocked found container, two
  chests sharing a side among found placements; no-harm (WATCH): craft success, deposit / town_deposit success DiD, deaths.

---

## 3. Paper scenes (the sandbox, the real bot, RCON as the oracle)

`sandbox/townplan/townplan-e2e.cjs` (derived from stock-e2e.cjs; RCON only on 10.0.0.30 sandbox ports 25599-25602; the
global `mkdir /tmp/mcai-sandbox.lock` on 10.0.0.31 held only while scenes run; a CONTROL run of the base for each scene):

| scene | piece | setup | must show (server read-back) |
|---|---|---|---|
| TP-GREEN | townplan | the SHOWCASE ground (its 97x97 block dump, rebuilt cell for cell in an arena, home offset) | a root plan; the plan equals the offline plan for the same ground (offset-adjusted); no plot cell in a zone / avoid box |
| TP-RETRO | townplan | a bench-like town: a 13x13 platform, 12 chests (one double), tables and furnaces around it, a well cap | a retrofit plan; groups `waiting` then `allocated` once counted; a workshop strip off every container's last standing cell; every container still opens (the bot's own count_town / deposit) |
| TP-CAS | townplan | two bots reach the town together, then a stale writer (restart with an old head) | exactly one root; later generations accepted in order; the stale write rejected and rebased |
| FOUND-FLAT | found | flat arena; 3 bots with chests, a spare table and a spare furnace | first container in the overflow cell; each group home in its cell when its stack arrives; table and furnace in station cells; 0 containers outside plots; 0 lid-blocked; bag deltas = placements |
| FOUND-BARE | found | the same; bags with logs and cobble only (no chest, table, furnace, planks) | a table in station 0, a chest crafted and placed in the overflow cell, a furnace crafted at the workshop table into station 1 |
| FOUND-ROUGH | found | holes, a slope and a pond around home | a qualifying orientation chosen; no placement on an unready cell |
| FOUND-NOFIT | found | separate arenas with exactly 1, 2, 3, 4, 5 READY cells; bare bags | the annex, the table first; 1 cell: a table and `store: unplaced`; 2-5: a table and containers |
| FOUND-NONE | found | home on a water-surrounded pillar | `found:no_site`, no placement, the bot keeps working |
| FOUND-KILL | found | SIGKILL between `reserved` and `placed`, and between the placement and the observe | resumes after `until + 60 s`; no duplicate container; no stuck reservation |
| FOUND-RETRO | found | TP-RETRO's town, bots carrying tables and furnaces | nothing removed (every pre-existing block still there); the table and furnace in the workshop strip's station cells |

## 4. The showcase start-gate inputs

`town-site.json` (written on the branch as `infra/showcase/town-site.json`, NOT installed): the site note's required fields
(`version`, `world`, `seed`, `home` [0, 70, 0] = the standing cell over the grass at y 69, `board`, `border_radius` 5000,
`builds_core`), `hashed_seed`, and `town_plan` (the seed). `builds_core: true` is RECOMMENDED (no place-town stamp: its two
deposit chests and torch chest would make the town a retrofit and no storehouse cell would ever be founded); that costs the
stamp's beds and torch chest -- an owner decision (§5 below). `REQUIRED_KEPT` lines: the run ids of §4.7 / O9.

## 5. Owner decisions this build needs

- **D-STAMP:** the showcase without place-town's stamp (`builds_core: true`, recommended: greenfield founding) or with it
  (a retrofit town from frame 0).
- **O9 (pending):** the showcase gate as designed waits for bench KEEPs of townplan-01 and found-01; the design recommends
  Paper + a bench no-harm read instead.
- **Trial chambers / mineshaft under the showcase town:** protectzone-01 left them "ASK"; this plan keeps its digging plots
  off the trial chambers through a seed `avoid` box either way.
