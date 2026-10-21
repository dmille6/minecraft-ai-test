# townplan-01 and found-01: the build specification (2026-10-21, r2)

Pieces 3 and 4 of the town plan (`docs/reports/town-plan-2026-10-20.md`, both engines APPROVE r9; OWNER 10-20 "yes, lets do
this"; OWNER 10-21: first pieces next in the lane, signs as labels, the bench storehouse = the sorted chest cluster, no
stray-table pickup, "no rush, lets do it the right way"). This note CONFIRMS that design and REFINES it to the level the code
needs. The approved behaviour stands unless a row of section 6 says what changed and why. Section numbers `§x` are the
design's. r2 takes round 1 (Codex CHANGE: 6 P1, 10 P2; Claude CHANGE: 2 P1, 10 P2, 4 P3); section 6 has every disposition.

Base: the expected stack at their turn is indexsearch-01's tip (townindex-01 + indexsearch-01 re-varianted on the fleet's
34d3e5e9 / ironpick-01 2d410985). That re-variant was not on origin when this was built, so the build base is a LOCAL stack:
`2d410985` + townindex-01 (e05b7bec..e5ce173f) + indexsearch-01 (e96891a1..8f811303) cherry-picked, four conflicts resolved by
composition, plus one DEV-BASE-ONLY test commit (two re-anchored mutants). **A re-stack onto the real indexsearch-01 variant
is needed before either piece is registered for launch.** townplan-01 needs the index (the retrofit home allocation, §6.1, is
townindex.mjs `allocateHomes`); found-01 is stacked on townplan-01.

---

## 1. townplan-01 — the plan file and the planner

### 1.1 What it is

Bot code that writes ONE siting file per town (§4.1) and reads it back for its adopters. It places no block, opens no
container and moves no bot. Rollback: `TOWNPLAN=off` (nothing written or read: every adopter is the base's, byte for byte).
Isolated memory scope: off (O8).

- `bots/src/planstore.mjs` -- the generation files, the acceptance walk, the checkpoint, compare-and-swap publish. Pure over a
  directory.
- `bots/src/townplan.mjs` -- the ring@1 geometry, READY, joint access, the fits, sectors and zones, the keep-out predicates,
  the maintenance steps. Pure over `read(x, y, z)`.
- hooks: `index.mjs` (the planner tick, the licence row), `skills.mjs` (the reads and the adopters).

### 1.2 The file (§4.1, §4.3), exactly

- Directory: `poolStateDir(MEMORY_POOL)` (the showcase: `/var/lib/mcai/_pool-showcase/`).
- Generations `townplan-<hx>_<hy>_<hz>.g<N>.json`: the bytes are written to a private tmp file, fsync'd, then `link()`ed to
  gN (which fails if N exists), then the directory is fsync'd. Never rewritten, never pruned.
- Checkpoint `townplan-<hx>_<hy>_<hz>.head.json` = `{ v, world, gen, sha }`: tmp + fsync + rename + directory fsync, after an
  accepted write. `sha` = sha256 of the generation's exact bytes.

**The acceptance walk** (reads file contents only, never the clock):
1. List the generations ascending. Start from the checkpoint when its file exists, parses, is this world's, passes the schema
   and hashes to its sha; else from the lowest file.
2. A file of another `world` is ABSENT (skipped, not rejected).
3. The ROOT is the lowest file of this world with `prev: null` that parses and passes the schema (`planRefusal`).
4. Each later file K becomes the head only if it parses, passes the schema, `K.gen` equals its file number, `K.prev ===
   head.gen`, `K.prevSha === head.sha`, and `transitionRefusal(head, K)` is null. Otherwise REJECTED: skipped, never deleted.

**Transition rules** (`transitionRefusal(prev, next)`):
- `v`, `template`, `world`, `home`, `mode` never change; `s` and `orientation` change only while NO cell of the plan is
  committed (reserved or placed).
- No plot is dropped. A COMMITTED plot (any cell reserved or placed) keeps its geometry (kind, box, y, door, sector, keepout)
  and every existing cell's position, kind and stand; it may only APPEND new cells. Exception: an `annex`, `cluster` or
  `unplaced` store may also drop or move its FREE cells (a re-fit around what is committed). An uncommitted plot may change
  freely.
- No cell (new or moved) may stand on a committed cell or on a reserved cell's stand.
- `placed` is immutable (same kind); a `role`/`group`, once set on it, never changes.
- `reserved` (`by`, `visit`, `until`) leaves only as: the same reservation (same `by`+`visit`; a later `until` only by its
  holder); `placed` by its holder (`next.by` = `by`, same visit) or by anyone once `next.at > until + 60 s`; or `free` with a
  `transitions[]` entry for that cell: `{ at, why: 'released', by, visit }` written by the holder, or `{ at, why: 'expired' }`
  with `next.at > until + 60 s`.
- `free` -> `reserved` only by `next.by`, with `until > next.at`; `free` -> `placed` is an OBSERVATION (the block is there:
  a crashed founder's late placement, or a chest from a TOWNPLAN=off build), allowed to any writer.
- `transitions[]` is per generation: each names a cell reserved in `prev`.
- Retrofit groups: `status` never goes back from `allocated`; a container in `homes[g]` stays in it.
- `gen` = max on disk + 1; `at` is the writer's clock, stored.

**A writer's cycle** (`publishPlan`): head V -> `mutate(V)` (null: nothing to write) -> refuse to write anything
`transitionRefusal` would reject (`result=invalid`, logged) -> link `max+1` with `prev = V.gen`, `prevSha = sha(V)` -> re-walk
-> its number is IN THE ACCEPTED CHAIN (it may already have been extended by another writer): accepted, checkpoint if it is
still the head; else rebase and retry, at most 3 tries, then give up this tick (P4). A rejected file never blocks writes (P5).

Tests (`bots/test/planstore.test.mjs`, behaviour + anchored mutants): two writers from one head (the second at max+1 with the
old prev is rejected; it rebases), over a reserved cell AND over an unprotected field; a number taken between read and link;
accepted-then-immediately-extended (success, never re-applied); a corrupt highest file then a write; a stale writer; an
expiry re-walked before and after the reader's clock passes it (same head); release by a non-holder refused; placed by
another only after the margin; placed immutable; each transition rule by a minimal violation; another world absent; a forged
or stale checkpoint; an unreadable directory is `ok:false` (never "no plan"); mutants for the chain check, the expiry margin,
placed immutability, the checkpoint sha and the membership rule.

### 1.3 The plan's content (v1)

```
{ v: 1, template: 'ring@1', gen, prev, prevSha, world, home: {x,y,z}, s, mode: 'greenfield'|'retrofit', orientation, workSide,
  at, by, code, seed: null | { sha, why },
  plots: [
    { id: 'core', kind: 'plaza', box: [x0,z0,x1,z1], y, state: 'existing'|'planned', keepout },
    { id: 'store', kind: 'storehouse'|'annex'|'cluster'|'unplaced', box?, y?, door?, building?: 'clear'|'needs_terrain:<n>',
      state, keepout,
      cells: [ { at: [x,y,z], kind: 'chest', stand: [x,y,z], role: 'overflow'|'home'|null, group: null|'<g>',
                 state: 'free'|'reserved'|'placed', by?, visit?, until? } ] },
    { id: 'work', kind: 'workshop', box?, y?, size: '5x3'|'5x2'|'4x2'|'annex', state, keepout,
      stations: [ { at, kind: 'crafting_table'|'furnace', stand, state, by?, visit?, until? } ] },
    { id: 'well', kind: 'well', sector, ref, state },
    { id: 'farm', kind: 'farm', sector, composter: [x,y,z] | null, state },
    { id: 'gate'|'shaft'|'monument'|'pavilion'|'hall', kind, sector | null, state: 'planned'|'unsited' } ],
  paths: [ { id, to, width: 2, seg: [x0,z0,x1,z1], state: 'planned' } ],
  groups: { v: 1, status: 'greenfield'|'waiting'|'allocated', homes: {g: [key]}, overflow: [key], drain: [key], pending: [g],
            unknown?: n },
  foreign: [ { by: 'treefarm'|'plinth'|'well', ref, cells: n } ],
  zones: { n, avoid, why },
  transitions: [ ... ] }
```

Changes from §4.3 (each in section 6): cells listed per plot with their own `stand`; a greenfield cell's `role`/`group` is
written when it is placed, in fill order; paths are 2-wide SEGMENTS; `keepout` per plot; `foreign` names the records read as
occupied (the tree farm's, the wells').

### 1.4 The ring@1 geometry (§3), exactly, orientation E (dx east, dz south)

Rotations: E (u, v) -> (dx, dz) = (u, v); S -> (-v, u); W -> (-u, -v); N -> (v, -u). `u` = out toward the storehouse.

| plot | cells (orientation E) |
|---|---|
| core | box u -6..6, v -6..6 |
| store | pad u 7..15, v -4..4 (every pad cell within 15.9 straight-line); future 7x7 walls u 8..14, v -3..3; door (8, 0); interior u 9..13, v -2..2. Container cells along the three inner walls: (9..12,-2), (13,-2), (13,-1..1), (13,2), (12..9,2); CHESTS on the alternate ones (never sharing a side): 7 chests, 189 slots. Fill order (distance to the door, then the perimeter order): (9,-2) OVERFLOW, (9,2), (11,-2), (11,2), (13,0), (13,-2), (13,2). A chest's `stand` = the nearest cell of the interior's middle 3x3 (u 10..12, v -1..1) that the joint-access walk reaches (a bot opens a chest within reach; the corner chests' side neighbours are the future barrel gaps) |
| work | a 5x3 strip on one lateral side: stations at v = 7 x side, u 7..11; stands at v = 6 x side; outer row 8 x side. Kinds in order: table, furnace, furnace, table, furnace. found-01 fills stations 0 (table) and 1 (furnace) only |
| well | sector = the cardinal opposite the storehouse |
| farm | sector = the lateral cardinal not taken by the workshop; composter = the first cell on the farm's inner edge row (lateral 9; u 0, then +-1 .. +-6) that passes the composter's own `siteRefusal` and is off every path and keep-out, else null |
| outer | gate (cardinals only), shaft, monument, pavilion, hall: sectors in a fixed preference order, skipping taken sectors and any sector whose EXTENT meets a protected zone or seed `avoid` box; none free -> `unsited`. Retrofit: the Z0/M0 sites (`docs/reports/zig-z0m0-2026-10-15.json`, shipped as `bots/src/townsectors.json` for the 12 shared worlds, keyed by pool and checked against home) pin the monument and shaft sectors when they meet no zone |
| paths | 2-wide spokes from the core edge (d 7): to the well (d 9; retrofit: stopped 4 short of the well cap's Chebyshev distance, never inside its footprint + 1), to the farm's inner edge (d 9), to the gate (d 44) |

EXTENTS (3-D, so an underground zone counts only for a plot that digs): shaft = collar centre (d 19) +-26, y -64..s+3;
monument = apron centre (d 51) +-27, y s-4..s+40; pavilion/hall = (d 33) +-17, y s-4..s+16; gate = (d 44) +-3, y s-4..s+6.
Preferences: shaft NE, SE, SW, NW, E, S, W, N; monument NW, NE, SW, SE, W, N, E, S; gate the cardinal (not taken) with the
most open columns (dry, not a tree, loaded) at d 22-44, ties S, W, N, E; pavilion and hall the remaining cardinals then
diagonals.

### 1.5 READY, joint access, the fits (§4.5)

**The fit box:** every column within Chebyshev 20 of home, y home.y-12 .. home.y+12. An UNKNOWN read anywhere the fit needs
means NO PLAN YET (logged once per 10 min). **Ground** of a column: its top solid block that is not a log, leaves, wood, stem
or sapling, with a passable, plant, tree or liquid cell above.

**READY** (`readyCell`), for a container or station at (x, s+1, z):
- (x, s, z) a SOLID FULL block (one full-cube shape; not a container, station, leaves, ice, slab, stairs, path, farmland,
  door, trapdoor, fence, wall, pane, glass, bed, lectern, bell, scaffolding, shulker, hopper);
- (x, s+1, z) placeable-into (air, cave_air, short_grass, fern, dead_bush); (x, s+2, z) passable (nothing is dug);
- no liquid (incl. waterlogged) in the 3x3x3 around (x, s+1, z);
- not in a protected zone or seed `avoid` box (the cell or its floor); not the home column;
- no furniture (container, table, furnace, smoker, composter, bed, lectern, bell, anvil, hopper, brewing stand, station
  blocks) within 1 UNLESS that cell is one of THIS plan's own cells (stations stand side by side by design);
- no sapling within 1, no log/leaves within 1 at or below the cell; no well cap within 3 (Chebyshev: a plinth shell is cap
  +-2, so +1), no tree-farm record cell within 2.

**Joint access** (`jointAccess`): a breadth-first walk from home's feet cell (snapped to the nearest standable cell within 2
horizontally and +-2 vertically; floor solid, feet and head passable and dry; 4-neighbour steps of +-1, an up-step needing head
room; inside the fit box) with EVERY kept candidate cell solid. Each candidate needs a reachable stand from which its centre
is within 4 of the eyes; one with none is dropped and the walk repeats until stable. **Existing furniture** (retrofit, and any
container/table/furnace a greenfield fit finds): every one reachable BEFORE the candidates are filled must stay reachable AFTER;
a candidate set that cuts one off is refused whole.

**Greenfield fit** (no plan, no town container in `inTown`): for each orientation E, S, W, N and workshop side +1, -1: `s` = the
most common ground level of the 9x9 pad (ties lower; a seed's `s` for its orientation); READY; joint access. Qualifies when the
first 4 chests in fill order and stations 0 and 1 are kept. Best: most kept cells, then a clear pad (no TERRAIN cell at s+1..s+3
anywhere on the 9x9 pad: storehouse-01's walls would need no dig of town ground; otherwise the plan records
`building: needs_terrain:<n>` for storehouse-01 to judge), then E, S, W, N, +1, -1. A seed's `orientation` wins when that fit
qualifies. No qualifying fit -> the ANNEX: cells with Chebyshev >= 7 inside `inTown`, off every keep-out and path, ring by ring
then x then z; READY at the most common READY height; chests never sharing a side; joint access; roles jointly, the TABLE
first, then up to 4 store cells, then one furnace. >= 2: a (partial) annex; 1: the table's, `store: unplaced`; 0: `store:
unplaced`, no workshop (F5).

**Retrofit fit** (no plan, >= 1 town container):
- core = box d <= 6, `existing`, NOT a keep-out; store = `{ kind: 'cluster', state: 'existing', keepout: false }` (O3 (a)).
- groups (§6.1): `allocated` by townindex `allocateHomes` once NO town container is index-`unknown` (stale and dirty entries
  count with their last observation: they hold counts; Codex/Claude r1 P2); else `waiting` with the unknown count, and a
  later generation allocates. count_town already visits index-unknown containers (townindex-01). After allocation: a new
  container is appended to `drain`; a group with stock in the index and no home gets the emptiest drain container with an
  observation. Nothing else re-allocates.
- work = the NEAREST free strip: 5x3, else 5x2 (stations + the stand row toward home), else 4x2; station row along x or z;
  every station AND stand inside `inTown` (hypot <= 16, |dy| <= 12) and 7 <= Chebyshev <= 15; stations READY at one level;
  stand rows walkable now; joint access including every existing container, table and furnace. None: no `work` plot.
- well, farm: their records by reference (sector from the cap / the composter); `foreign` lists the tree-farm record
  (`treefarm-<home>.g<N>.json`, read as occupied +2), well caps and plinth caps (footprint +-2, +1).
- outer: Z0/M0 pins (1.4), else the preferences; paths as greenfield.

**The planner tick** (index.mjs, every 30 s while the bot is in `inTown` and its world id is known): read the head; no plan ->
fit and publish a root; a plan -> at most ONE maintenance publish when something changed: (a) retrofit `waiting` -> allocate;
(b) retrofit: a new container / a new homeless group; (c) a `reserved` cell past `until + 60 s` -> `placed` if the cell READS
its kind, `free` with `expired` if it reads anything else, NOTHING if it is unknown (unloaded: decided later); (d) a `free`
cell that reads its kind -> `placed` (observation); (e) an `unplaced`/`annex` store -> re-fit at the frozen `s`/orientation
around what is committed, at most once per 10 min per bot. Every 10 min the tick also AUDITS every plan cell (1.9).

### 1.6 The adopters (§4.6) -- keep-outs are HARD or SOFT

`keepouts(plan)`:
- HARD: a committed cell (reserved or placed) and a reserved cell's stand (feet and head). No adopter ever puts a block there.
- SOFT: inside a keep-out plot's box + 1, any annex cell or stand + 1, or on a path segment. An adopter tries EVERY candidate
  outside the soft area first, and takes a soft cell only when nothing outside is valid. So no adopter refuses where the base
  would have succeeded, except for a hard cell (Codex r1 P1); the plot is then re-fitted around it (uncommitted plots only).

| adopter | change | rollback |
|---|---|---|
| recovery chest siting (`fullChestRecovery` -> chestfull `pickChestSite` / `chestSiteRefusal`) | hard cells refused; soft cells tried last (two passes over the same rings); the base's wider search (other full containers, then home) now also runs when the rings' refusals were keep-outs, not only junk-well ones; the `deposit_new_chest` row says `keepout=<hard>/<soft>` | TOWNPLAN=off |
| well siting (`canonicalWellSite` in `townWellSite`'s COMPUTE only) | a NEW cap: footprint (cap +-2) on a hard cell refused, soft tried last, the plan's well sector first. Never in `refuse`, the re-check of a recorded or built site: an existing well is never re-judged by the plan (Claude r1 P1) | TOWNPLAN=off |
| composter siting (`canonicalComposterSite` compute) | `farm.composter` first when it passes the composter's own rules; hard refused, soft last | TOWNPLAN=off |
| sapling planting (`plantableSpotNear`) | never a hard or soft cell (planting is optional: the bot plants elsewhere or does other work) | TOWNPLAN=off |

The tree farm, the town floor and structureguard are not in the build; the plan reads the tree farm's record as occupied, and
their own adoption of the plan lands with them.

### 1.7 Protected zones and the no-dig zone

- Zones file `<poolStateDir>/protected-zones.json` (protectzone-01's format, `hashed_seed`-bound), read by townplan's own
  parser (protectzone-01 is not in this base; the two share the showcase file as a test fixture). Absent, or another world's:
  0 zones. Malformed or wrong version: the last good list read in this process is kept; with none, zones are UNKNOWN: no new
  root and no re-fit (fitting suspended), the accepted plan's keep-outs still serve, and found-01 places nothing until zones
  are known (logged, once per 10 min). A malformed zone is dropped and named; a box wider than 1,024 is refused.
- Seed `avoid` boxes are siting policy on top (the showcase's trial chambers: not in the zones file, an owner "ASK").
- The no-dig zone (townzone-01, kept) refuses TARGET digs of town terrain within Chebyshev 16 above home.y - 12; it does not
  stop every dig. READY cells need no dig at all, so founding never asks for one.

### 1.8 The showcase seed

`town-site.json` is both the showcase's site file and the plan's seed: the showcase reads `home`, `board`, `border_radius`,
`builds_core`; the plan reads `<poolStateDir>/town-site.json` (the showcase installs it there) and uses, when its `home` equals
the configured home and its `hashed_seed` (if any) is this world's: `town_plan.template` (must be ring@1),
`town_plan.orientation`, `town_plan.s`, `town_plan.avoid`. `footprint` is recorded only (ring@1 stays inside the 128x128
area by construction). The file is in section 4.

### 1.9 Rows and the read

- `_townplan_mode` (licence, once per spawn): `phase=mode plan=on|off v=1 template=ring@1 tick_s=30 seed=.. zones=..`.
- `_townplan` (the change row, every publish attempt; no-plan ticks once per 10 min per reason): `op=root|alloc|adopt|observe|
  expire|refit result=accepted|lost|invalid|error|no_plan gen prev mode orient store work ready access zones why`.
- `_townplan_audit` (every 10 min per bot in town): per plan, `placed=n present=m missing=k other=o unknown=u free=f
  occupied=q` (a FREE cell holding a block: what other code put on the plan) with the first names.
- `_deposit_new_chest`, `_well_site`, `_composter_site`: their existing rows gain `keepout=<hard>/<soft>` so the read counts
  EXPOSED attempts.
- The read (`scripts/host/townplanread.py`, `--selftest` with a seeded defect for every gate): per canary town, the plan
  files re-walked by a Python port of the acceptance rules. Exposure: an accepted plan in every canary town AND >= 1 accepted
  generation after a root across the arm. Defects (REVERT): an accepted generation the port rejects; a recovery claim or a new
  well-site record (after the deploy) on a HARD cell; a plan cell in a zone or avoid box; a found chest missing in the audit
  (found-01's read). No-harm (WATCH, DiD): deposit and town_deposit success, recovery `no_site`, well `no_site` and well
  re-sites, plinth lost; deaths by the default gate. Denominators printed for every line; an unexposed line says so (never
  `ok`).

### 1.10 Dead ends (§8; the rows this piece can create)

| # | meets | what happens | next legal move |
|---|---|---|---|
| P1 | a NEW well cap wants a plot cell | soft: tried last; hard: refused | another cap; `no site` only where the base would also have none outside hard cells |
| P2 | a mine or gather wants a plot cell inside 16 | townzone refuses target digs of town ground (kept) | mine's walk-off; gather's search reaches past |
| P3 | a plot cell would need a dig | never planned (READY needs none) | -- |
| P4 | link() of max+1 fails 3 times | give up this tick | the next tick (30 s) |
| P5 | the highest file is invalid | skipped; writers still use max+1 | no freeze |
| P6 | the recovery's rings meet only keep-outs | soft cells after every outside cell; the wider search also on keep-out refusals | a cell (soft if need be), or the base's own `no_site` refusal |
| P7 | the zones file is broken at spawn | fitting and founding suspended; the accepted plan's keep-outs serve | every other order as today; the next good read resumes |
| P8 | a bench town with an unknown container | `groups: waiting` | count_town visits it; the next tick allocates |

---

## 2. found-01 — first containers and stations go into their plots

### 2.1 Orders (deterministic town orders; `bots/src/found.mjs` decides, pure)

**Materials** (`foundMeans`): a FOUNDING floor, not the 64-unit stockpile cap (Claude r1 P1, Codex r1 P2: a fresh bot holding
64 wood units never drives the bag past the stockpile target, so "8 planks above townKeeps" would never found a town). A found
craft may use wood above 8 wood units (the stockpile's lap-0 target, `stockpileTarget(8, 4, 0)`) + PLANKS_MEANS (4 planks) +
the scaffold reserve, and stone above 8 cobblestone + the scaffold reserve. Spending below the stockpile re-opens the
stockpile rung, whose gather is the deterministic remedy. A found craft never runs at 36/36 (the craft's room rule decides).

**The table rule** (Claude r1 P2): found_work takes a bot's crafting table only if, after placing it, the bot still holds a
table OR >= 1 log OR >= 4 planks -- the ladder's own `crafting_table` rung re-crafts one from them at once (its means:
planks >= 4 || logs >= 1). The same rule for a furnace: after placing, a furnace OR >= 8 cobblestone.

| order | eligible when (always: inTown, a plan of this world, zones known, the found lease free, this bot's 10-min cooldown passed, not yet one found order this visit) | does |
|---|---|---|
| `found_work` F1 | station 0 (table) free and READY now; the bot carries a table (table rule) or can craft one (4 planks above the floor) | craft (if needed) -> reserve station 0 -> walk to its stand -> re-check the lease, the head (the reservation still ours), READY and bodies IMMEDIATELY before the click -> place -> read back -> publish `placed` |
| `found_store` F2 | NO town container in `inTown`; store cells exist; the overflow cell (else the next free READY cell) READY; the bot carries a chest or can craft one (8 planks above the floor; at station 0 when it is placed and in reach, else where the bot stands, as craft does today) | craft FIRST (away from plan cells: walk to station 0's stand when it is placed) -> reserve -> walk -> re-check immediately before the click -> place -> read back -> open once (the index observes it) -> publish `placed`, `role: 'overflow'` |
| `found_work` F3b | station 0 placed; station 1 (furnace) free and READY; the bot carries a furnace (furnace rule) or 8 cobble above the floor (crafted at station 0) | as F1, for the furnace |
| `found_store` F3 | greenfield: a free READY store cell; the bag holds a stack EITHER deposit path would bank (`townDepositPlan`'s banked stacks or `depositPlan`'s, each with its own keeps) whose group has no home; the plan has no free (unassigned) placed container. Retrofit: groups `allocated`, the same bag test, NO drain container and no overflow | greenfield: the next free cell in fill order, `role: 'home', group: g`. Retrofit (cluster): the recovery's own siting (`pickChestSite` anchored at the cluster's nearest home container, the plan's keep-outs, the recovery's claim ledger and budget: 4 a day, 12 standing), appended to the store cluster's cells as `role: 'home', group: g` |

Order of precedence inside found: F1, F2, F3b, F3. Bounds: at most one found order per visit (a visit = continuous presence
in `inTown`); a 10-min cooldown per bot after any found order; ONE town-wide found lease (the furnace-lease file shape:
`townplan-<home>.found-lease.g<N>.json`, `wx`, 4 min TTL, renewed during walks and crafts, recording the plan generation it
was taken under; its generation re-checked immediately before the click); the reservation's `until` = now + 4 min, renewed in
the plan only once more than half has passed. Section cells have their own cap (the 7 cells); the recovery's budget stays for
chests outside the plan.

**Position in the decision loop:** F2 runs BEFORE the town deposit (with no container in town the deposit can bank nothing);
F1, F3b and F3 run AFTER the town deposit and the recount (a full bag banks first: cognitive.mjs gives the deposit priority on
purpose), and before the milestone work order (which would otherwise starve them). The recount's displacement exemption
(cognitive.mjs ~920) includes `found_*`.

### 2.2 Placements that already happen, redirected (§7.1)

- **The full-town recovery, greenfield:** when the town's containers are full, its new chest goes to the next free READY store
  cell (the section cap, not the recovery budget), through the reservation protocol; with none free, the base's rings (hard
  refused, soft last), then the wider search. Retrofit: the base's rings with the keep-outs (the cluster is not one).
- **The composter (F5):** `farm.composter` first (1.6).
- **The well (F6):** townplan-01's adoption (1.6).
- **craft:** unchanged. It walks to the nearest table in reach and takes back only tables IT placed (`retakeTables` reads
  `placedHere`), so a workshop table is used while in reach and never retaken (proven in Paper, not assumed).

### 2.3 Dead ends (§8 F1-F6, W1, refined)

| # | meets | what happens | next legal move |
|---|---|---|---|
| F1 | no chest and no 8 planks above the founding floor | not eligible | gather (the stockpile rung's own work), then the next eligible visit founds it; the deposit skips `nothing_found` meanwhile, as today |
| F2 | the cell is occupied, unready or has a body on arrival | released (an explicit transition) | the next free READY cell on the next order; none: the annex rule |
| F3 | every store cell placed and every home full | not eligible | the overflow; then the recovery (outside the plan, then soft cells, then the wider search); then the base's refuse_cap / no_site ("keep working and deposit later") |
| F4 | no qualifying orientation | the annex | found_store places into annex cells |
| F5 | no READY cell | `store: unplaced`, `found:no_site` | the bot keeps working (named work rows succeed); bags fill; the well and prune run as today; re-fit every 10 min |
| F6 | a crash between `reserved` and `placed` | the reservation lapses; after `until + 60 s` a tick writes `placed` (the block is there) or `expired` (another block); an unloaded cell waits | the next eligible order |
| F7 | another bot holds the found lease | not eligible (a free skip) | the lease ends within 4 min |
| F8 | the craft fails (no room, no table placeable) | nothing reserved yet (craft first); the order backs off 10 min | the craft's own remedy, as today |
| F9 | the table rule refuses (the bot's only table, no wood) | not eligible for this bot | another bot, or this bot once it holds wood |
| W1 | the workshop furnace is leased by a smelt | found_work never opens furnaces | -- |

### 2.4 Rows and the read

- `_found_mode` (licence): `phase=mode found=on|off v=1 cooldown_min=10 lease_s=240 floor_wood=8 floor_stone=8`.
- `_found` (the change row, every run, every exit): `order kind step outcome at source gen role group lease ms why`, outcome
  in placed / released / refused / lost_lease / lost_reservation / craft_failed / place_failed / unready / zones_unknown.
- `_found_recovery` (the recovery's redirected placement): `cell=section|ring|soft|wider at=..`.
- The read (`scripts/host/foundread.py`, `--selftest` with seeded defects): exposure = found placements on the canary
  (INCONCLUSIVE on exposure is expected on the bench, §9 row 4; F1 and F3b DO fire there -- bench bots carry tables and
  furnaces -- and are read as real exposure); defects (REVERT): a found chest missing in a later audit, a found placement
  outside a plan cell, a lid-blocked found container, two found chests sharing a side, a found placement in a zone; no-harm
  (WATCH, DiD): craft success, tool-rung progress (wooden/stone/iron pickaxe crafts), deposit / town_deposit success, deaths.

---

## 3. Paper scenes (the sandbox, the real bot, RCON as the oracle)

`sandbox/townplan/townplan-e2e.cjs` (derived from stock-e2e.cjs; RCON only on 10.0.0.30 ports 25599-25602; the global
`mkdir /tmp/mcai-sandbox.lock` on 10.0.0.31 held only while scenes run; a CONTROL run of the base where it discriminates).
Every "keeps working" claim names a productive row that must succeed; every "usable" claim is an actual open by the bot.

| scene | piece | setup | must show (server read-back) |
|---|---|---|---|
| TP-GREEN | townplan | the SHOWCASE ground (the 97x97 block dump, rebuilt in an arena, home offset) | a root plan equal to the offline plan for the same ground (offset-adjusted); no cell in a zone or avoid box |
| TP-RETRO | townplan | a bench-like town: a 13x13 platform, 12 chests (one double), tables and furnaces around it, a raised-well cap beside the free strip | `waiting` then `allocated` after the bot's own counts; a workshop strip off every container's stand and >= 4 from the cap; every container still opened by the bot afterwards |
| TP-CAS | townplan | two bots arriving together; then a stale writer (restart with an old head) | one root; later generations in order; the stale write rejected, rebased |
| TP-ZONES | townplan | a zones file covering one orientation's pad, then a malformed file mid-run | that orientation never chosen; after the malformed write, no re-fit and no founding until the file is good again |
| FOUND-FLAT | found | flat arena; 3 bots with chests, a spare table, a spare furnace | the first container in the overflow cell; group homes in cells as their stacks arrive; table and furnace in stations 0/1; 0 containers outside plots; 0 lid-blocked; bag deltas = placements |
| FOUND-BARE | found | the same arena with a few trees; bags EMPTY | the bots gather; table -> station 0; a chest crafted and placed in the overflow cell; a furnace crafted at station 0 into station 1 (cobble from a stone patch) |
| FOUND-HOUR1 | found | bags as at hour 1 of a fresh world: 16 logs, 20 cobblestone, 1 crafting table (stated) | founding happens from these (the founding floor), not after 64 |
| FOUND-ROUGH | found | holes, a slope, a pond around home | a qualifying orientation; no placement on an unready cell |
| FOUND-NOFIT | found | arenas with exactly 1, 2, 3, 4, 5 READY cells; bare bags | the annex, the table first; 1: a table and `store: unplaced`; 2-5: a table and containers |
| FOUND-NONE | found | home on a water-surrounded pillar | `found:no_site`, no placement, a named work row succeeds |
| FOUND-KILL | found | SIGKILL between `reserved` and `placed`; between the placement and the observe; during the craft before any reservation | resumes after `until + 60 s`; no duplicate container; no stuck reservation |
| FOUND-RETRO | found | TP-RETRO's town; bots carrying tables and furnaces | nothing removed (every pre-existing block still there); table and furnace in the strip's stations; the bot that gave its table still crafts a stone pickaxe afterwards |
| FOUND-SOFT | found | greenfield, all 7 store cells placed and full, the rings around them all keep-outs | the recovery's chest lands outside the plan, or on a soft cell, never on a hard one; no new `no_site` |

## 4. The showcase start-gate inputs

`infra/showcase/town-site.json` (written on the branch with the code, from the offline planner run; NOT installed). Evidence (the block dump of the showcase region files, copied
read-only 10-21 20:3xZ): the column at (0, 0) is grass at y 69 with air above, so the standing cell is y 70 -- the showcase
design's own record (home 0, 70, 0 = world spawn); the site note's `[0, 69, 0]` came from the core's MEDIAN ground (68). The
offline plan from the same dump (`bots/scripts/townplan-offline.mjs` over the dump: the bots' own planner) goes in
`infra/showcase/town-plan-preview.json` with the code.

`builds_core: true` is recommended (no place-town stamp): the stamp's two deposit chests and torch chest would make the town a
RETROFIT town at frame 0 (design §4.7 says "with the stamp ... the plots are greenfield"; that is not what the founding rule
does, and the conflict is named here), so no storehouse cell would ever be founded. It costs the stamp's beds and torch chest.
A third option is not built: a seed field forcing greenfield with the stamp's chests as drain.

`REQUIRED_KEPT` (per O9): without the waiver, six lines (§4.7): toolkit-03 34d3e5e9 (KEPT 10-21), townindex-01, indexsearch-01,
townplan-01, found-01, sortdeposit-01 (shas when they are kept). With the waiver, the gate needs a record type for "Paper proof +
no-harm read" for townplan-01, found-01 and sortdeposit-01: an owner decision, not built.

## 5. Owner decisions this build needs

- **D-STAMP:** no stamp (`builds_core: true`, recommended) or the stamp (a retrofit town from frame 0).
- **O9 (pending):** the showcase gate as designed waits for bench KEEPs of townplan-01 and found-01; the waiver needs its own
  record type.
- **Trial chambers / mineshaft under the showcase town:** protectzone-01 left them "ASK"; the plan keeps its digging plots off
  the trial chambers through a seed `avoid` box either way.
- **The founding floor** (2.1): founding may spend below the 64-unit wood stockpile (to 8 units + 4 planks + scaffold). It is
  the only way a fresh town founds itself in its first hour; it is bounded (7 chests, 2 stations per town).

## 6. Round 1 dispositions

| finding | disposition |
|---|---|
| Codex P1 READY rejects the workshop's own next station | the furniture clearance ignores this plan's own cells (1.5); test: sequential placement, restart with station 0 placed |
| Codex P1 freezing geometry blocks growth | append-only for committed plots; annex/cluster/unplaced may move FREE cells; no cell on a committed cell or a reserved stand (1.2) |
| Codex P1 / Claude P2 reservation checked before an async craft | craft first, then reserve, walk, and re-check lease + head + READY + bodies immediately before the click (2.1) |
| Codex P1 / Claude P2 recovery remedy not wired, not guaranteed | HARD vs SOFT keep-outs; soft cells last; the wider search also on keep-out refusals; FOUND-SOFT scene (1.6, 1.10 P6) |
| Codex P1 / Claude P2 existing furniture access jointly | every existing reachable container, table and furnace must stay reachable with all candidates filled (1.5) |
| Codex P1 / Claude P2 vacuous defect gates | `_townplan_audit` every 10 min (placed and free cells), `keepout=` on the adopters' rows as denominators, seeded defects in both reads' self-tests, the whole well footprint (1.9, 2.4) |
| Claude P1 the well keep-out re-judges existing wells | the plan is applied only when computing a NEW cap, never in the re-check of a recorded/built site; plots and paths keep 3 from caps, the retrofit well path stops short (1.4, 1.5, 1.6) |
| Claude P1 / Codex P2 founding materials unreachable at 64 | a founding floor (8 wood units + 4 planks + scaffold; 8 cobble + scaffold); FOUND-BARE with empty bags restored; FOUND-HOUR1 added (2.1, 3) |
| Codex P2 membership, not "still the head" | publish succeeds when its number is in the accepted chain (1.2; test + mutant) |
| Codex P2 the future pad | a clear-pad tie-break and `building: needs_terrain:n` for storehouse-01 (1.5); the townzone wording corrected (1.7) |
| Codex P2 siting requirements changed | well sector = a preference (a confinement would add no-sites the base lacks; stated); retrofit Z0/M0 sectors restored from the shipped data; the tree farm's record read as occupied; its own adoption lands with it (1.4, 1.6) |
| Codex P2 / Claude P2 taking the only table | the table rule (2.1); FOUND-RETRO checks the giver still crafts a stone pickaxe |
| Codex P2 F3 drops the deposit verb, retrofit ambiguous, priority | F3's bag test is either deposit path's; separate greenfield/retrofit eligibility; F2 before the deposit, F1/F3b/F3 after it and the recount (2.1) |
| Codex P2 / Claude P2 allocation waits on dirty/stale | allocate once no container is `unknown`; last observations count (1.5) |
| Codex P2 / Claude P2 zones semantics | absent / other world / malformed / reload stated; fitting and founding suspended while unknown; a shared fixture (1.7) |
| Codex P2 scenes omit compositions | TP-ZONES, FOUND-HOUR1, FOUND-SOFT, FOUND-KILL during the craft, expired-with-unknown (planstore + tick tests), named productive work (3) |
| Codex P2 / Claude P3 showcase inputs | the file written, the y cited from the block dump, the BFS start snaps within 2, D-STAMP's conflict with §4.7 named, REQUIRED_KEPT per O9 (4) |
| Claude P2 transitions under-specified, no fsync | free -> placed by observation; per-generation, per-cell transitions; schema on every generation; fsync before link and rename (1.2) |
| Claude P2 a re-fit could change orientation | re-fit only at the frozen s/orientation, around committed cells, once per 10 min (1.5) |
| Claude P2 strip may leave inTown | stations AND stands inside inTown (1.5) |
| Claude P2 keep-outs missing annex cells and planting | annex cells and stands are soft keep-outs; planting is an adopter (1.6) |
| Claude P3 recount displaces found | found_* in the recount's exemption (2.1) |
| Claude P3 composter cell on a path; ground and fit-box definitions | off paths and keep-outs; definitions in 1.5 |
| Claude P3 F3 retrofit pickChestSite; seed footprint / foreign; lease generation | pickChestSite is the reviewed cluster rule (no second one); footprint recorded, `foreign` restored; the lease records its generation (1.3, 1.8, 2.1) |
