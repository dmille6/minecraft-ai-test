# townplan-01 and found-01: the build specification (2026-10-21, r7)

Pieces 3 and 4 of the town plan (`docs/reports/town-plan-2026-10-20.md`, both engines APPROVE r9; OWNER 10-20 "yes, lets do
this"; OWNER 10-21: first pieces next in the lane, signs as labels, the bench storehouse = the sorted chest cluster, no
stray-table pickup, "no rush, lets do it the right way"). This note CONFIRMS that design and REFINES it to the level the code
needs. The approved behaviour stands unless a row of section 6 says what changed and why. Section numbers `§x` are the
design's. r2 took round 1 (Codex CHANGE 6 P1 / 10 P2; Claude CHANGE 2 P1 / 10 P2 / 4 P3); r3 took round 2 (Codex CHANGE
5 P1 / 7 P2; Claude CHANGE 1 P1 / 4 P2 / 6 P3); r4 took round 3 (Codex CHANGE 3 P1 / 2 P2; Claude CHANGE 3 P2 / 2 P3);
r5 took round 4 (Codex CHANGE 4 P2; Claude APPROVE with 5 P3); r6 takes round 5 (Codex CHANGE 1 P2 / 2 P3; Claude APPROVE with
5 P3) and four READY refinements found by running the planner offline on the SHOWCASE ground (section 6, "The showcase
ground"); r7 takes round 6 (Codex CHANGE 2 P2; Claude CHANGE 1 P2 / 2 P3). Section 6 has every disposition.

Base: the expected stack at their turn is indexsearch-01's tip (townindex-01 + indexsearch-01 re-varianted on the fleet's
34d3e5e9 / ironpick-01 2d410985). That re-variant was not on origin when this was built, so the build base is a LOCAL stack:
`2d410985` + townindex-01 (e05b7bec..e5ce173f) + indexsearch-01 (e96891a1..8f811303) cherry-picked, four conflicts resolved by
composition, plus one DEV-BASE-ONLY test commit (two re-anchored mutants). **A re-stack onto the real indexsearch-01 variant
is needed before either piece is registered for launch.** townplan-01 needs the index (§6.1's allocator is townindex.mjs
`allocateHomes`); found-01 is stacked on townplan-01.

---

## 1. townplan-01 — the plan file and the planner

### 1.1 What it is

Bot code that writes ONE siting file per town (§4.1) and reads it back for its adopters. It places no block, opens no
container and moves no bot. Rollback: `TOWNPLAN=off` (nothing written or read: every adopter is the base's, byte for byte).
Isolated memory scope: off (O8).

- `bots/src/planstore.mjs` -- the generation files, the acceptance walk, compare-and-swap publish. Pure over a directory.
- `bots/src/townplan.mjs` -- the ring@1 geometry, READY, joint access, the fits, sectors and zones, the keep-out predicates,
  the maintenance and audit steps. Pure over `read(x, y, z)`.
- hooks: `index.mjs` (the planner tick, the licence row), `skills.mjs` (the reads and the adopters), `cognitive.mjs` (found's
  slot).

### 1.2 The file (§4.1, §4.3), exactly

- Directory: `poolStateDir(MEMORY_POOL)` (the showcase: `/var/lib/mcai/_pool-showcase/`).
- Generations `townplan-<hx>_<hy>_<hz>.g<N>.json`: the bytes go to a private tmp file, fsync'd, then `link()`ed to gN (fails if
  N exists), then the directory is fsync'd. Never rewritten, never pruned.
- **No on-disk checkpoint** (Codex r2 P2: a hash proves a file's bytes, not its membership in the accepted chain). Instead each
  process keeps the result of its OWN last full walk (head, accepted set, the file list it walked) and continues from it while
  the listing only grew above its last number; anything else -- a number at or below it that it had not seen, or ANY number it
  walked that is gone from the listing (a hand cleanup, a reseed: Claude r3 P2) -- re-walks from the root. A fresh process
  walks once from the root.
- **Growth and the cap** (Claude r3 P2): a generation is 3-8 KB. Writes happen only on change: a found order writes about 3
  (reserve, place; a renewal only past half the TTL), an observation 2 (the mark, the adoption), an allocation or adoption 1;
  audits and ticks without a change write nothing. Expected: a bench town 2-10 a day (its two stations, allocations, drain
  adoptions), a greenfield town 20-60 a day in its first week then a few. The walk is bounded at 64 MB (fails closed: no plan,
  adopters as the base): ~8,000+ generations, i.e. years on the bench and many months for a greenfield town. The read alarms
  at 25% (16 MB) per town. Compaction is a named follow-up (an epoch successor key whose root copies the head, with a cut
  protocol that rejects a cut a later epoch-N write overtook), not built in v1.

**The acceptance walk** (file contents only, never the clock):
1. List the generations ascending; a file of another `world` is ABSENT (skipped, not rejected).
2. The ROOT is the lowest file of this world with `prev: null` that parses and passes the schema (`planRefusal`).
3. Each later file K becomes the head only if it parses, passes the schema, `K.gen` equals its file number, `K.prev ===
   head.gen`, `K.prevSha === head.sha`, and `transitionRefusal(head, K)` is null. Otherwise REJECTED: skipped, never deleted.

**Transition rules** (`transitionRefusal(prev, next)`):
- `v`, `template`, `world`, `home`, `mode` never change; `s` and `orientation` change only while NO cell of the plan is
  committed (reserved or placed).
- No plot is dropped. A COMMITTED plot (any cell reserved or placed) keeps its geometry (kind, box, y, door, sector, keepout)
  and every existing cell's position, kind and stand; it may only APPEND cells. An `annex`, `cluster` or `unplaced` store may
  also drop or move its FREE cells. An uncommitted plot may change freely.
- No cell may stand on another committed (reserved or placed) cell's stand.
- `reserved` (`by`, `visit`, `until`, and the INTENT `role`/`group`) leaves only as: the same reservation (same `by`+`visit`; a
  later `until` only by its holder); `placed` by its holder (`next.by` = `by`, same visit), or by anyone after an observation
  (below); or `free` with a `transitions[]` entry for that cell: `{ at, why: 'released', by, visit }` by the holder, or
  `{ at, why: 'expired' }` with `next.at > until + 60 s`. A placement keeps the reservation's intent (role, group).
- **Observations take two reads 10 min apart** (Codex/Claude r2 P1: craft puts its own table down for seconds and takes it
  back; a one-read adoption made a station `placed` for ever with nothing there). The marks are validator rules (Claude r3 P2):
  - a cell's KIND is a family (Claude r5 P3): chest = chest or trapped_chest; furnace = furnace in any lit state; table =
    crafting_table.
  - each mark has its own states (Codex r4 P2): `seenSince` lives on a free cell, or a reserved one past `until + 60 s`: SET
    when the cell reads its kind and has no mark; CONSUMED by the adoption (`placed` removes it); CLEARED when the cell reads
    anything that is not its kind. `missingSince` lives on a placed cell: SET when the cell reads anything that is not its kind
    and has no mark; CONSUMED by `gone` (`free` removes it); CLEARED when the cell reads its kind. A repeated read that agrees
    with the mark leaves it alone (it is what matures it); an UNKNOWN read never sets, clears or consumes; after a clear, the
    next agreeing read starts a new cycle. A mark is set only to the writing generation's own `at` (never backdated) and never
    changed while set; on a reserved cell before `until + 60 s` only its holder may touch either mark;
  - `free` -> `placed`, or `reserved` -> `placed` by a non-holder after `until + 60 s`, only when the PREVIOUS generation already
    carries `seenSince` and `next.at >= prev.seenSince + 10 min`; `placed` -> `free` (`{ at, why: 'gone' }`) only from a previous
    `missingSince` the same way;
  - a cell carrying `seenSince` is PINNED like a committed one (Codex r3 P1): no re-fit, flex drop or move may remove or shift
    it while the observation is pending;
  - an adoption keeps the cell's intent (role/group, e.g. a gone overflow cell's); a cell with none stays `role: null` (Codex
    r3 P2). A gone cell keeps its intent for the next placement.
- `free` -> `reserved` only by `next.by`, with `until > next.at`. `transitions[]` is per generation, one per cell.
- A `role`/`group` set on a placed cell changes only from null (an unassigned container may be given a home later).
- Retrofit groups: `status` never goes back from `allocated`; a container in `homes[g]` stays in it.
- `gen` = max on disk + 1; `at` is the writer's clock, stored.

**A writer's cycle** (`publishPlan`): head V -> `mutate(V)` (null: nothing to write) -> never write anything
`transitionRefusal` would reject (`result=invalid`, logged: a writer-bug tripwire) -> link `max+1` with `prev = V.gen`,
`prevSha = sha(V)` -> re-walk -> its number is IN THE ACCEPTED CHAIN (another writer may already have extended it): accepted;
else rebase and retry, at most 3 tries, then give up this tick (P4).

Tests (`bots/test/planstore.test.mjs`): the races (two writers from one head over a reserved cell and over an unprotected
field; a number taken between read and link; accepted-then-immediately-extended), a corrupt highest file then a write, a stale
writer, an expiry re-walked before and after the reader's clock passes it, release by a non-holder, placement by another only
after an observation, placed immutable, the two-read observation and gone rules, append-only, each rule by a minimal violation,
another world absent, an unreadable directory `ok:false`, the in-process continuation (a late lower number forces a full
re-walk); anchored mutants for the chain check, the expiry margin, placed immutability, the observation delay and the
membership rule.

### 1.3 The plan's content (v1)

```
{ v: 1, template: 'ring@1', gen, prev, prevSha, world, home: {x,y,z}, s, mode: 'greenfield'|'retrofit', orientation, workSide,
  at, by, code, seed: null | { sha, why },
  plots: [
    { id: 'core', kind: 'plaza', box: [x0,z0,x1,z1], y, state, keepout },
    { id: 'store', kind: 'storehouse'|'annex'|'cluster'|'unplaced', box?, y?, door?, building?, state, keepout,
      cells: [ { at, kind: 'chest', stand, role: 'overflow'|'home'|null, group, state, by?, visit?, until?,
                 seenSince?, missingSince?, extra?: true } ] },
    { id: 'work', kind: 'workshop', box?, y?, size, state, keepout, stations: [ { at, kind, stand, state, ... } ] },
    { id: 'well', kind: 'well', sector, ref, state },
    { id: 'farm', kind: 'farm', sector, composter, state },
    { id: 'gate'|'shaft'|'monument'|'pavilion'|'hall', kind, sector | null, state: 'planned'|'unsited' } ],
  paths: [ { id, to, width: 2, seg: [x0,z0,x1,z1], state } ],
  groups: { v: 1, status: 'greenfield'|'waiting'|'allocated', homes, overflow, drain, pending, unknown? },
  foreign: [ { by: 'treefarm'|'plinth'|'well', ref, cells } ],
  zones: { n, avoid, why }, transitions: [ ... ] }
```

Changes from §4.3 (section 6): cells per plot with their own `stand`; a greenfield cell's `role`/`group` is the reservation's
intent; paths are 2-wide SEGMENTS; `keepout` per plot; `foreign` lists the records read as occupied.

### 1.4 The ring@1 geometry (§3), exactly, orientation E (dx east, dz south)

Rotations: E (u, v) -> (dx, dz) = (u, v); S -> (-v, u); W -> (-u, -v); N -> (v, -u). `u` = out toward the storehouse.

| plot | cells (orientation E) |
|---|---|
| core | box u -6..6, v -6..6 |
| store | pad u 7..15, v -4..4; future 7x7 walls u 8..14, v -3..3; door (8, 0); interior u 9..13, v -2..2. Container cells along the three inner walls; CHESTS on the alternate ones (never sharing a side): 7 chests, 189 slots. Fill order: (9,-2) OVERFLOW, (9,2), (11,-2), (11,2), (13,0), (13,-2), (13,2). Stand = the nearest reachable cell of the interior's middle 3x3. When every section cell is placed or unready, up to 4 `extra` ANNEX cells may be appended (1.5 tick (e)) |
| work | a 5x3 strip on one lateral side: stations at v = 7 x side, u 7..11 (table, furnace, furnace, table, furnace); stands at v = 6 x side; outer row 8 x side. found-01 fills stations 0 (table) and 1 (furnace) only |
| well | sector = the cardinal opposite the storehouse |
| farm | sector = the lateral cardinal not taken by the workshop; composter = the first cell on the farm's inner edge row (lateral 9; u 0, then +-1 .. +-6) that passes the composter's own `siteRefusal` and is off every path and keep-out, else null |
| outer | gate (cardinals), shaft, monument, pavilion, hall: sectors in a fixed preference order, skipping taken sectors and any sector whose EXTENT meets a protected zone or seed `avoid` box; none free -> `unsited`. Retrofit: the Z0/M0 sites (`docs/reports/zig-z0m0-2026-10-15.json`, shipped as `bots/src/townsectors.json`, keyed by pool, checked against home) pin the monument and shaft sectors when they meet no zone |
| paths | 2-wide spokes from the core edge (d 7): to the well (d 9; retrofit: ending 4 short of the cap's Chebyshev distance, OMITTED when that end is <= 7 or the segment comes within 3 of a cap), to the farm's inner edge (d 9), to the gate (d 44) |

EXTENTS (3-D): shaft = collar centre (d 19) +-26, y -64..s+3; monument = (d 51) +-27, y s-4..s+40; pavilion/hall = (d 33)
+-17, y s-4..s+16; gate = (d 44) +-3, y s-4..s+6. Preferences: shaft NE, SE, SW, NW, E, S, W, N; monument NW, NE, SW, SE, W,
N, E, S; gate the free cardinal with the most open columns (dry, not a tree, loaded) at d 22-44, ties S, W, N, E; pavilion and
hall the remaining cardinals then diagonals.

### 1.5 READY, joint access, the fits, the tick (§4.5)

**The fit box:** every column within Chebyshev 20 of home, y home.y-12 .. home.y+12. An unknown read the fit needs means NO
PLAN YET (logged once per 10 min). **Ground** of a column: its top solid block that is not a log, leaves, wood, stem or
sapling, with a passable, plant, tree or liquid cell above.

**READY** (`readyCell`), for a container or station at (x, s+1, z):
- (x, s, z) a SOLID FULL block (one full-cube shape; not a container, station, leaves, ice, slab, stairs, path, farmland,
  door, trapdoor, fence, wall, pane, glass, bed, lectern, bell, scaffolding, shulker, hopper);
- (x, s+1, z) REPLACEABLE: vanilla's replaceable plants -- air, cave_air, short_grass, tall_grass, fern, large_fern,
  dead_bush, vine, glow_lichen, and snow ONLY at `layers == 1` (a deeper snow layer is not replaced by a placement; a snow
  cell whose depth cannot be read is not READY: Codex/Claude r6);
- (x, s+2, z) not liquid and never a LID: refused when lidrule's `chestLidBlocked` OR its `serverLidBlocks` says so (leaves
  and glass open a chest; a full solid block, mud and soul sand do not: Codex r6 P2). The SAME rule is the audit's `lid`
  (1.9, Claude r6 P2);
- no liquid (incl. waterlogged) in the 3x3x3 around (x, s+1, z);
- not in a protected zone or seed `avoid` box (the cell or its floor); not the home column;
- no furniture within 1 UNLESS that cell is one of THIS plan's own cells; no SAPLING within 1 (it grows into the cell; a
  standing trunk or leaves do not);
- WELLS (Codex/Claude r2): every well cap, recorded well site and plinth cap: no cell AND no stand within Chebyshev 3 (the
  plinth shell is cap +-2); chest cells also pass chestfull's `wellKeepout` (WELL_HOME_CLEARANCE 7 horizontally, the well's
  reserved cells): a chest there would refuse the recorded well site; station cells and their stands also pass skills'
  `stationRefusalAt` (the well's shell, shaft, stands and a plinth's stair headroom); no cell or stand on a plinth stair cell;
- no tree-farm record cell within 2.

**Joint access** (`jointAccess`): a breadth-first walk from home's feet cell (snapped within 2 horizontally and +-2
vertically; floor solid, feet and head passable and dry; 4-neighbour steps of +-1, an up-step needing head room; inside the fit
box) with EVERY kept candidate cell, every recorded plinth shell cell and stair cell solid. Each candidate needs a reachable
stand from which its centre is within 4 of the eyes; one with none is dropped and the walk repeats until stable. Every
container, table and furnace reachable BEFORE the candidates are filled must stay reachable AFTER; a set that cuts one off is
refused whole.

**Greenfield fit** (no plan, no town container in `inTown`): each orientation E, S, W, N and workshop side +1, -1: `s` = the
most common ground level of the 9x9 pad (ties lower; a seed's `s` for its orientation); READY; joint access. Qualifies when the
ANY 4 chest cells and stations 0 and 1 are kept (found fills the next READY cell in fill order, so an unready overflow cell
costs nothing). Best: most kept cells, then a clear pad (no TERRAIN at s+1..s+3 on
the 9x9: else `building: needs_terrain:<n>` for storehouse-01), then E, S, W, N, +1, -1. A seed's `orientation` wins when that
fit qualifies. None qualifies -> the ANNEX (cells with Chebyshev >= 7 inside `inTown`, off keep-outs and paths, ring by ring
then x then z; READY at the most common READY height; chests never sharing a side; joint access; the TABLE first, then up to 4
store cells, then one furnace; >= 2 a (partial) annex, 1 the table's with `store: unplaced`, 0 `store: unplaced` and no
workshop: F5).

**Retrofit fit** (no plan, >= 1 town container): core = box d <= 6, `existing`, NOT a keep-out; store = `cluster`, `existing`,
not a keep-out (O3 (a)). Groups (§6.1): `allocated` by `allocateHomes` once NO town container is index-`unknown` (stale and
dirty entries count with their last observation); else `waiting` (count_town visits unknowns). Work = the NEAREST free strip
(5x3, else 5x2, else 4x2; along x or z; every station and stand inside `inTown` and 7 <= Chebyshev <= 15; stations READY at one
level; stand rows walkable; joint access with every existing container, table and furnace). Well, farm: records by reference;
`foreign`: the tree farm's record (occupied +2), every cap (footprint +-2, +1), plinth stairs. Outer: Z0/M0 pins, else the
preferences.

**The planner tick** (index.mjs, every 30 s while the bot is in `inTown` and its world id is known; one publish at most; a walk
that is not `ok` -- an unreadable directory, the 64 MB cap -- writes NOTHING, never a root: Claude r4 P3):
- no plan -> fit and publish a root (fitting is SUSPENDED while zones are unknown, 1.7);
- a plan -> the first maintenance step that applies, in order: (c) a reservation past `until + 60 s`: its cell reads its kind
  -> `seenSince` (then `placed`, with the reservation's intent, 10 min later on a second read), reads anything else -> `free` +
  `expired`, unknown -> nothing; (d) the marks, per 1.2: a free cell that reads its kind -> `seenSince` (then `placed`,
  keeping its intent, 10 min later on an agreeing read); a free marked cell that reads otherwise -> cleared; a placed cell that
  reads otherwise -> `missingSince` (then `gone` 10 min later on an agreeing read); a placed marked cell that reads its kind ->
  cleared; unknown reads change nothing; a pending mark never blocks the other steps; (a) retrofit `waiting` -> allocate; (b) retrofit: a new container -> drain; an
  unassigned placed container (`role` null) or the emptiest observed drain container -> the home of a pending group; (e)
  greenfield: every section cell placed or unready and fewer than 4 `extra` cells -> append annex cells (READY, off keep-outs,
  joint access) as `extra`; an `unplaced` store -> re-fit at the frozen `s`/orientation around what is committed; at most once
  per 10 min per bot; (f) nothing committed anywhere and the root's fit no longer qualifies (a cell blocked) -> a whole re-fit.
- every 10 min: the AUDIT (1.9).

### 1.6 The adopters (§4.6) -- keep-outs are HARD or SOFT

`keepouts(plan)` -- THREE TIERS, searched in order by EVERY permanent adopter (recovery, natural well, raised well, composter)
across ALL its anchors and fallbacks, three passes each (Codex r2 P1, Claude r2 P2: SOFT-last protected only the next
placement; Codex r3 P1: a hard committed box must not remove the base's only remedy; Codex r4 P2: the same three passes for
every adopter):
- OUTSIDE: every cell not in the two tiers below. Searched first.
- SOFT (second): the box + 1 of an UNCOMMITTED keep-out plot, annex surroundings + 1, path segments. A soft cell taken makes
  that plot's fit fail its next check; tick (f) re-fits it while nothing is committed.
- BOX (third, last): the box + 1 of a COMMITTED plot, except its plan cells and stands. Taken only when nothing outside or soft
  is valid; the plot then records `building: obstructed:<n>` for storehouse-01. The base's availability is kept everywhere
  except:
- ACCESS (Codex r4 P2): a SOFT or BOX candidate is taken only if, with it filled, every committed plan cell and every existing
  container, table and furnace that was reachable from home before still has a reachable stand (the same walk as 1.5); a
  candidate that would cut one off is skipped like a NEVER cell. Cost (Claude r5 P3): the walk runs only on candidates that
  already pass the base rule, in search order, stopping at the first that passes; the row logs `access_ms`.
- NEVER (hard): every plan cell (container or station, any state) and every reserved or placed cell's stand (feet and head):
  at most ~25 cells + their heads per town.
- ACCOUNTING (Codex r4 P2): each adopter's search also runs its BASE rule on the candidates the plan refused (NEVER, or cut
  off by ACCESS), so its row says `plan_refused=<n base-valid candidates the plan refused>`, `tier=outside|soft|box|none` and
  `gen=<plan gen>` -- ONE field set on every adopter row (Claude r5 P3), and the read's HARD-cell defect keys on it.
- The natural well's `exhausted` (wellsite-01: it backs the build order off) means ALL THREE passes read and refused every
  column; a pass that stopped on an unknown read is not exhausted (Claude r5 P3; a fixture with pass 1 exhausted and pass 2
  unknown).
  A `no_site` with `plan_refused >= 1` is a PLAN-INDUCED refusal (`keepout=plan_only`, P10), counted in the read's no_site DiD
  whatever the terrain refused alongside; the temporary-station adopter counts its plan skips the same way.

| adopter | change | rollback |
|---|---|---|
| recovery chest siting (`fullChestRecovery` -> `pickChestSite`) | greenfield: the next free READY store cell first (2.2). Then three passes over every anchor (the full containers, home) and the plan's ANNEX scan (cells Chebyshev 7..16 in `inTown`, `chestSiteRefusal`): OUTSIDE, then SOFT, then BOX, NEVER always refused, ACCESS on soft and box; the wider search runs on keep-out refusals too, not only junk-well ones. The `deposit_new_chest` row adds `tier= plan_refused= gen=` | TOWNPLAN=off |
| well siting, natural (`canonicalWellSite` in `townWellSite`'s COMPUTE only) | three passes: a NEW cap whose footprint (cap +-2) meets NEVER is refused; OUTSIDE, SOFT, BOX; the plan's well sector first in each. Never in `refuse` (the re-check of a recorded or built site). Its site row adds `tier= plan_refused=` | TOWNPLAN=off |
| well siting, RAISED (`planPlinthSteps` for a NEW plinth plan) | three passes through `keepOut` (shell, opens and stair cells): pass 1 NEVER + BOX + SOFT, pass 2 NEVER + BOX, pass 3 NEVER only; the planned chest cells join `avoid` (WELL_HOME_CLEARANCE) for those calls only. An existing plinth record is never re-judged. The `plinth` plan row adds `tier= plan_refused=` | TOWNPLAN=off |
| composter siting (`canonicalComposterSite` compute) | `farm.composter` first when it passes the composter's own rules; then OUTSIDE, SOFT, BOX; NEVER refused | TOWNPLAN=off |
| TEMPORARY station placements: craft's table (`place(ctx, { item: 'crafting_table' })` with no cell: `placeSites`, 24 cells around the bot), the composter builder's table (`tableCellFor`), build_well's table (`wellTableCell`) | two tiers (Codex r3 P1, Claude r3 P2: a refusal must not become `needs_station`): non-plan cells first; then a FREE, unreserved, unmarked plan cell (the table is retaken; the two-read rule keeps it from being adopted, and a stray one is either the right station kind -- adopted legitimately -- or makes that cell unready). NEVER a reserved cell, a placed cell, a marked (seenSince) cell or a reserved/placed stand. Plan skips are counted like `wellSkip`, which also turns off place()'s make-room dig of a town cell; `needs_station` then arises only where the base's would, or where every spot is a NEVER cell (P9) | TOWNPLAN=off |
| sapling planting (`plantableSpotNear`) | never a hard or soft cell (planting is optional; in greenfield the core box + 1 is soft, so bots plant away from the plaza: an intended change, counted in the read) | TOWNPLAN=off |

The tree farm, the town floor and structureguard are not in the build; the plan reads the tree farm's record as occupied, and
their own adoption lands with them.

### 1.7 Protected zones and the no-dig zone

- Zones file `<poolStateDir>/protected-zones.json` (protectzone-01's format, `hashed_seed`-bound), read by townplan's own
  parser; the two parsers share the showcase file as a test fixture. Absent, or another world's: 0 zones. The LAST GOOD list
  read in this process is authoritative: a later malformed, wrong-version or partly-malformed file keeps it (logged). With no
  good read in this process (malformed at spawn, or any malformed zone at the first read: Claude r2 P3 -- for siting, a zone it
  cannot parse is a zone it cannot avoid), zones are UNKNOWN: no root, no re-fit, and found places nothing; the accepted plan's
  keep-outs still serve. Re-read every 30 s.
- Seed `avoid` boxes are siting policy on top. The showcase's trial chambers are now BOTH (owner 10-21 #18: protected): the zones
  file's `trial-chambers-home-se` and the seed's avoid box, the same id and box (a test asserts they agree).
- The no-dig zone (townzone-01, kept) refuses TARGET digs of town terrain within Chebyshev 16 above home.y - 12; READY cells need
  no dig at all.

### 1.8 The showcase seed

`town-site.json` is both the showcase's site file and the plan's seed: the showcase reads `home`, `board`, `border_radius`,
`builds_core`; the plan reads `<poolStateDir>/town-site.json` and uses, when its `home` equals the configured home and its
`hashed_seed` (if any) is this world's: `town_plan.template` (ring@1), `town_plan.orientation`, `town_plan.s`,
`town_plan.avoid`; `footprint` is recorded only. The file is in section 4.

### 1.9 Rows and the read

- `_townplan_mode` (licence, once per spawn): `phase=mode plan=on|off v=1 template=ring@1 tick_s=30 seed=.. zones=..`.
- `_townplan` (the change row, every publish attempt; no-plan ticks once per 10 min per reason): `op=root|alloc|adopt|seen|
  observe|missing|gone|expire|extend|refit result=accepted|lost|invalid|error|no_plan gen prev mode orient store work ready
  access zones why`.
- `_townplan_audit` (every 10 min per bot in town): `gen placed present missing other unknown free occupied lid unreachable
  gens bytes walk_ms` (a placed container whose lid cell blocks it by READY's own lid rule -- leaves and glass never do; a placed cell no stand of which the walk reaches; the files
  and the walk's cost, so the read sees growth: Claude r4 P3) with the first names (an `occupied` free store cell is named:
  Claude r4 P3).
- The adopters' rows (`_deposit_new_chest`, well and plinth site rows, `_composter_site`) add `tier= plan_refused= gen=`
  (1.6): the class at decision time under the generation in force, so a claim is judged against that generation.
- The read (`scripts/host/townplanread.py`, `--selftest` seeding a defect for every gate, including a backdated mark and an
  early mark on a reserved cell): per canary town the plan files re-walked by a Python port of the acceptance rules (the mark
  rules included); plan bytes per town printed and alarmed at 16 MB. Exposure: an accepted plan in every canary town AND >= 1 accepted
  generation after a root. Defects (REVERT): an accepted generation the port rejects; any `result=invalid` row; a recovery
  claim, a new well or plinth site, or a composter site on a HARD cell of the generation recorded in its row; a plan cell in a
  zone or avoid box; a root's cells `occupied` in its first audit (the design's "0 plan cells on structure or furniture").
  No-harm (WATCH, DiD): deposit and town_deposit success, recovery `no_site`, well `no_site` and re-sites, plinth lost,
  planting in town, `keepout=plan_only` no_site; deaths by the default gate. Every line prints its denominator; an unexposed line
  says so (never `ok`).

### 1.10 Dead ends (§8; the rows this piece can create)

| # | meets | what happens | next legal move |
|---|---|---|---|
| P1 | a NEW well or plinth cap wants a plot cell | three passes: outside, soft, box; NEVER refused; ACCESS on soft and box | another cap; `no site` where all three passes fail (P10 counts a plan-induced one) |
| P2 | a mine or gather wants a plot cell inside 16 | townzone refuses target digs of town ground (kept) | mine's walk-off; gather's search reaches past |
| P3 | a plot cell would need a dig | never planned | -- |
| P4 | link() of max+1 fails 3 times | give up this tick | the next tick (30 s) |
| P5 | the highest file is invalid | skipped; writers still use max+1 | no freeze |
| P6 | the recovery's rings meet keep-outs | the next free store cell first (greenfield); then three passes (outside, soft, box) over every anchor and the annex scan; NEVER refused; ACCESS on soft and box | a cell, or the base's own `no_site` refusal ("keep working and deposit later"); a plan-induced one is P10 |
| P7 | zones unknown at spawn | fitting and founding suspended; the accepted plan's keep-outs serve | every other order as today; the next good read resumes |
| P8 | a bench town with an unknown container | `groups: waiting` | count_town visits it; the next tick allocates |
| P9 | a temporary table's spot search meets plan cells | non-plan cells, then free unmarked plan cells; NEVER refused; plan skips counted | craft as today; a `needs_station` with plan skips is counted plan-induced (P10's accounting) |
| P10 | (named, measured) a recovery, well or plinth search ends `no_site` with `plan_refused >= 1` (a base-valid candidate the plan refused: NEVER, or cut off by ACCESS) | the base's own `no_site` refusal ("keep working and deposit later" / the well's hold) | as the base; counted `keepout=plan_only` in the read's no_site DiD |

---

## 2. found-01 — first containers and stations go into their plots

### 2.1 Orders (deterministic town orders; `bots/src/found.mjs` decides, pure)

**Materials** (`foundMeans`): a FOUNDING floor, not the 64-unit stockpile cap (a fresh bot holding 64 wood units never drives
the bag past the stockpile target). A found craft may use wood above max(8 wood units -- the stockpile's lap-0 target --,
the active rung's wants) + PLANKS_MEANS (4 planks) + the scaffold reserve, and stone above max(8 cobblestone, the active
rung's wants) + the scaffold reserve (Claude r2 P3). Spending is bounded: 7 store cells + 4 extra + 2 stations per town, one
found order per bot per visit, a 10-min cooldown.

**The station rule** (Codex r2 P1: the ladder rescans earlier rungs only after the chain, so a bot that gives away its only
table can skip its pickaxe rungs for want of means): found_work never leaves a bot without the station kind it places. A bot
holding >= 2 tables gives one; a bot holding exactly 1 first CRAFTS A SECOND (4 planks above the floor) and then gives one; a
bot that can do neither is not eligible. The same for a furnace (8 cobble above the floor, crafted at station 0).

**F3 and the unassigned container** (Codex r2 P2): a placed store container with `role: null` (observed, recovery-placed, or a
home that went unused) is a FREE container; a homeless group takes it (tick (b)) before F3 places a new chest.

| order | eligible when (always: inTown; a plan of this world; zones known; the found lease free; this bot's 10-min cooldown passed; no found order yet this visit) | does |
|---|---|---|
| `found_work` F1 | station 0 (table) free and READY; the station rule can be met | craft the spare (if needed) -> reserve station 0 -> walk to its stand -> re-check lease, head (the reservation ours), READY and bodies IMMEDIATELY before the click -> place -> read back -> publish `placed` |
| `found_store` F2 | NO town container in `inTown`; a free READY store cell (the overflow cell first); the bot carries a chest or can craft one (8 planks above the floor) | craft FIRST (at station 0 when it is placed: walk to its stand; else where the bot stands, as craft does today -- its temporary table by 1.6's two tiers, never a NEVER cell) -> reserve (intent `role: 'overflow'`) -> walk -> re-check immediately before the click -> place -> read back -> open once (the index observes it) -> publish `placed` |
| `found_work` F3b | station 0 placed; station 1 (furnace) free and READY; the station rule can be met (for a furnace) | as F1, for the furnace |
| `found_store` F3 | greenfield: a free READY store cell; no free (unassigned placed) container; the bag holds a stack EITHER deposit path would bank (`townDepositPlan`'s banked stacks or `depositPlan`'s, each with its own keeps) whose group has no home; a chest carried, or the craft fits. Retrofit: groups `allocated`; the same bag test; NO free container, no drain container, no overflow | greenfield: the next free cell in fill order, intent `role: 'home', group: g`. Retrofit (cluster): the recovery's own siting (`pickChestSite` anchored at the cluster's nearest home container, the keep-outs, the recovery's claim ledger and budget: 4 a day, 12 standing), appended to the cluster as `role: 'home', group: g` |

**The found slot -- one decision** (Codex/Claude r2 P2, Codex/Claude r3), evaluated once per decision in this order in
cognitive.mjs:
1. the raised-well order (unchanged, first);
2. **the found slot**: the first eligible of F1, F2, F3b, F3 -- EXCEPT when the town deposit WOULD ISSUE NOW (its own
   `townDepositOrder`, asked dry on a copy of its state with its 30 s scan throttle ignored -- Claude r4 P3 -- so bag at 34+,
   cooldown, latch, backoff and a bankable plan as it decides them), when only an F3 that places a
   CARRIED chest may go ahead of it (the deposit then banks into the new home); F1/F2/F3b and a crafting F3 wait for the next
   decision. When the deposit would NOT issue (keeps, cooldown, backoff), founding runs ROOM-SAFE: a craft only when it fits
   the bag's room plan (craftroom's own rule), a carried station or chest always;
3. the town deposit; 4. the recount (its displacement exemption includes `found_*`); 5. everything else as today.

The found lease: ONE per town (the furnace-lease file shape: `townplan-<home>.found-lease.g<N>.json`, `wx`, 4 min TTL, renewed
during walks and crafts, recording the plan generation it was taken under; re-checked immediately before the click). The
reservation's `until` = now + 4 min, renewed in the plan only once more than half has passed.

### 2.2 Placements that already happen, redirected (§7.1)

- **The full-town recovery, greenfield:** when the town's containers are full, its new chest goes to the next free READY store
  cell (then `extra` cells), through the reservation protocol (the section cap, not the recovery budget); with none, 1.6's
  search. Retrofit: 1.6's search (the cluster is not a keep-out).
- **The composter (F5)**, **the well (F6)**: 1.6.
- **craft:** it walks to the nearest table in reach and takes back only tables IT placed (`retakeTables` reads `placedHere`),
  so the workshop table is used while in reach and never retaken; its own temporary table follows 1.6's two tiers (never a
  NEVER cell).

### 2.3 Dead ends (§8 F1-F6, W1, refined)

| # | meets | what happens | next legal move |
|---|---|---|---|
| F1 | no chest and no 8 planks above the founding floor | not eligible | gather (the stockpile rung's own work), then the next eligible visit founds it; the deposit skips `nothing_found` meanwhile, as today |
| F2 | the cell is occupied, unready or has a body on arrival | released (an explicit transition) | the next free READY cell on the next order; none: the `extra` annex cells (tick (e)) |
| F3 | every store and extra cell placed and every home full | not eligible | the overflow; then the recovery (1.6: outside first, soft last, hard never); then the base's refuse_cap / no_site ("keep working and deposit later") |
| F4 | no qualifying orientation | the annex | found_store places into annex cells |
| F5 | no READY cell | `store: unplaced`, `found:no_site` | the bot keeps working (named work rows succeed); bags fill; the well and prune run as today; re-fit every 10 min |
| F6 | a crash between `reserved` and `placed` (or after the placement, before its publication) | the reservation lapses; after `until + 60 s` two reads 10 min apart write `placed` with the reservation's intent, or `expired` | the next eligible order |
| F7 | another bot holds the found lease | not eligible (a free skip) | the lease ends within 4 min |
| F8 | the craft fails (no room, no table placeable) | nothing reserved yet (craft first); the order backs off 10 min | the craft's own remedy, as today |
| F9 | the station rule cannot be met | not eligible for this bot | another bot, or this bot once it holds the materials |
| W1 | the workshop furnace is leased by a smelt | found_work never opens furnaces | -- |

### 2.4 Rows and the read

- `_found_mode` (licence): `phase=mode found=on|off v=1 cooldown_min=10 lease_s=240 floor_wood=8 floor_stone=8`.
- `_found` (the change row, every run, every exit): `order kind step outcome at source gen role group lease spare ms why`,
  outcome in placed / released / refused / lost_lease / lost_reservation / craft_failed / place_failed / unready /
  zones_unknown.
- `_found_recovery` (the recovery's redirected placement): `cell=section|extra|outside|soft|wider at gen`.
- The read (`scripts/host/foundread.py`, `--selftest` seeding every defect): exposure = found placements on the canary (F1 and
  F3b fire on the bench -- bench bots carry tables and furnaces -- and are read as real exposure; store placements are rare there,
  §9 row 4: INCONCLUSIVE on them is expected and the FOUND scenes are their gate). Defects (REVERT): a found chest `missing` or
  `other` in a later audit; a found placement outside a plan cell; a lid-blocked or unreachable found container -- the
  REVERT stands whatever caused it (Codex r5 P2); the read ALSO names the responsible adopter when a SOFT/BOX placement in the
  same box preceded it (that placement broke ACCESS: its own defect), and reports an unrelated later one as unrelated; two
  found chests sharing a side; a found placement in a zone. No-harm (WATCH, DiD): craft success, tool-rung crafts (wooden/stone/iron
  pickaxe), deposit / town_deposit success, deaths.

---

## 3. Paper scenes (the sandbox, the real bot, RCON as the oracle)

`sandbox/townplan/townplan-e2e.cjs` (derived from stock-e2e.cjs; RCON only on 10.0.0.30 ports 25599-25602; the global
`mkdir /tmp/mcai-sandbox.lock` on 10.0.0.31 held only while scenes run; a CONTROL run of the base where it discriminates).
Every "keeps working" claim names a productive row that must succeed; every "usable" claim is an actual open by the bot.

| scene | piece | setup | must show (server read-back) |
|---|---|---|---|
| TP-GREEN | townplan | the SHOWCASE ground (the 97x97 block dump, rebuilt in an arena, home offset) | a root plan equal to the offline plan for the same ground (offset-adjusted); no cell in a zone or avoid box |
| TP-RETRO | townplan | a bench-like town: a platform, 12 chests (one double), tables and furnaces, a raised well beside the free strip | `waiting` then `allocated` after the bot's counts; a strip off every container's stand and >= 3 from the cap; every container still opened by the bot; a `dispose_well` afterwards succeeds (the stand and stair still usable) |
| TP-CAS | townplan | two bots arriving together; a stale writer (restart with an old head) | one root; later generations in order; the stale write rejected and rebased |
| TP-ZONES | townplan | a zones file covering one orientation's pad; mid-run a malformed file; a restart with the malformed file | that orientation never chosen; mid-run: the last good list kept; after the restart: no fitting and no founding until the file is good |
| TP-TEMP | townplan | a bot crafting beside a free station 0 while another bot's tick runs; a bot standing in the storehouse interior with every middle cell a placed chest's stand | craft's temporary table on a non-plan cell (or a free plan cell when nothing else), never on a NEVER cell; the craft succeeds; no station `placed` without a table there |
| FOUND-FLAT | found | flat arena; 3 bots with chests, a spare table, a spare furnace | the first container in the overflow cell; group homes in cells as their stacks arrive; table and furnace in stations 0/1; 0 containers outside plots; 0 lid-blocked; bag deltas = placements |
| FOUND-BARE | found | the same arena with a few trees and a stone patch; bags EMPTY | the bots gather; a table in station 0 (the giver keeps one); a chest crafted and placed in the overflow cell; a furnace crafted at station 0 into station 1 |
| FOUND-HOUR1 | found | bags as at hour 1 of a fresh world: 16 logs, 20 cobblestone, 1 crafting table | founding from these (the founding floor), not after 64; the giver still crafts a wooden and a stone pickaxe afterwards |
| FOUND-ROUGH | found | holes, a slope, a pond around home | a qualifying orientation; no placement on an unready cell |
| FOUND-CANOPY | found | store cells under spruce leaves, in large_fern and tall_grass, beside a trunk; one cell with 2 snow layers and one with mud above (base control: the same arena) | chests placed into the fern/grass cells and under the leaves, read back over RCON and OPENED by the bot; the 2-layer snow cell and the mud-lid cell never chosen |
| FOUND-NOFIT | found | arenas with exactly 1, 2, 3, 4, 5 READY cells; bare bags | the annex, the table first; 1: a table and `store: unplaced`; 2-5: a table and containers |
| FOUND-NONE | found | home on a water-surrounded pillar | `found:no_site`, no placement, a named work row succeeds |
| FOUND-KILL | found | SIGKILL during the craft; between `reserved` and `placed`; between the placement and its publication | no duplicate container; no stuck reservation; the placement observed with its intent (role) after `until + 60 s` and 10 min |
| FOUND-RETRO | found | TP-RETRO's town; bots carrying tables and furnaces | nothing removed (every pre-existing block still there); table and furnace in the strip's stations; the giver still holds a table and crafts a stone pickaxe afterwards |
| FOUND-SOFT | found | greenfield, every store cell placed and full, the rings around them hard | the recovery's chest lands outside the plan (or soft, or the committed box), never on a NEVER cell; every placed cell still reachable afterwards; no new `no_site` |
| FOUND-BOX | found | (base control and candidate) a town where the ONLY valid recovery cell is inside the committed storehouse box | the base places there; the candidate places there too (BOX tier), records `building: obstructed`, never a NEVER cell |
| FOUND-PLINTH | found | greenfield, a plinth-first well whose cheapest candidate meets the committed storehouse; and (ONLY-BOX, base control and candidate) a town where the only feasible plinth lies in the committed box | the plinth planned elsewhere, the storehouse box untouched; ONLY-BOX: the base plans it there, the candidate too (pass 3, `tier=box`), never on a NEVER cell, every committed cell still reachable |
| FOUND-ACCESS | found | a committed storehouse whose only approach is one cell wide, and a recovery whose cheapest BOX candidate is that cell (base control and candidate) | the candidate skips it (ACCESS), places elsewhere; every container is then opened by the bot |

Unit and behaviour tests (anchored mutants on every guard): `bots/test/townplan.test.mjs` (READY, the furniture and well rules,
jointAccess including a cut-off existing container and recorded plinth shells, the fits on fixtures and on the showcase dump,
the annex, the retrofit strip, sectors around zones, parseZones on the shared fixture, keepouts, maintenance and audit, the
re-fit at a frozen s/orientation), `bots/test/found.test.mjs` (foundMeans, the station rule, the eligibility matrix greenfield
and retrofit, the found lease, the found orders through the real skills in a fake world, the recovery's search order with hard
and soft cells, the wider search on keep-out refusals, the temporary-table refusal, a CHAIN through the real CognitiveLoop: the
found slot's decision table at 20 and 35 slots, the recount exemption, F2 with no container, F3 before the deposit, a donation
followed by tool-rung progress).

## 4. The showcase start-gate inputs

`infra/showcase/town-site.json` (written on the branch with the code, from the offline planner run; NOT installed). Evidence
(the showcase region files copied read-only 10-21 20:3xZ): the column at (0, 0) is grass at y 69 with air above, so the
standing cell is y 70 -- the showcase design's own record (home 0, 70, 0 = world spawn); the site note's `[0, 69, 0]` came
from the core's MEDIAN ground (68). The offline plan (`bots/scripts/townplan-offline.mjs` over the dump: the bots' own
planner) goes in `infra/showcase/town-plan-preview.json` with the code.

`builds_core: true` is recommended (no place-town stamp): the stamp's two deposit chests and torch chest would make the town a
RETROFIT town at frame 0 (design §4.7 says "with the stamp ... the plots are greenfield"; the founding rule says otherwise, and
the conflict is named here), so no storehouse cell would ever be founded. It costs the stamp's beds and torch chest. A third
option is not built: a seed field forcing greenfield with the stamp's chests as drain.

`REQUIRED_KEPT` (`infra/showcase/REQUIRED_KEPT.draft`): six lines (§4.7): toolkit-03 34d3e5e9 (KEPT 10-21), townindex-01,
indexsearch-01, townplan-01, found-01, sortdeposit-01. O9 is decided (§5: Paper + a no-harm bench read, not bench KEEPs), but
the start gate (showcase_ops.py `pieces_in`, followrule.py `kept_runs`) counts only a KEEP + promoted or owner-direct row: it
has no record type for "Paper proof + no-harm read". That gate change is NOT built here. Until it is, the draft's last three
lines read `FILL-WHEN-KEPT`, which never resolves, so the gate FAILS CLOSED (refuses the start) rather than starting without
them.

## 5. Owner decisions (all DECIDED)

- **D-STAMP -- DECIDED 2026-10-22 ~13:00Z: bare ground.** No stamped core; `infra/showcase/town-site.json` `builds_core: true`.
- **O9 -- DECIDED 2026-10-21 (#11):** the showcase starts after Paper + a no-harm bench read, not after bench KEEPs.
- **Trial chambers -- DECIDED 2026-10-21 (#18): PROTECTED.** The showcase zones file carries `trial-chambers-home-se`
  [-20,-47,65,88,31,164]; the seed's `avoid` box is the same id and box (a test asserts they agree).
  **Mineshaft under home -- DECIDED 2026-10-21 (#19): NOT protected.**
- **The founding floor -- DECIDED 2026-10-22 ~13:00Z: YES, for founding only.** Founding may spend below the 64-unit wood/cobble
  stockpile (to 8 units + 4 planks + scaffold, or the rung's wants) to craft the first table, chest and furnace; bounded per town.
  The switch is `FOUND_BELOW_STOCKPILE` (bots/src/found.mjs), true.

## 6. Dispositions

### Round 1

| finding | disposition |
|---|---|
| Codex P1 READY rejects the workshop's own next station | the furniture clearance ignores this plan's own cells |
| Codex P1 freezing geometry blocks growth | append-only for committed plots; flex stores; no cell on a committed stand (1.2) |
| Codex P1 / Claude P2 reservation checked before an async craft | craft first, then reserve, walk, re-check immediately before the click (2.1) |
| Codex P1 / Claude P2 recovery remedy | the 1.6 search order and the wider search on keep-out refusals; FOUND-SOFT |
| Codex P1 / Claude P2 existing furniture access | every existing reachable container, table and furnace stays reachable (1.5) |
| Codex P1 / Claude P2 vacuous gates | the audit, generation-pinned keep-out classes on the adopters' rows, seeded self-tests (1.9, 2.4) |
| Claude P1 the plan re-judges existing wells | only NEW caps; never the re-check (1.6) |
| Claude P1 / Codex P2 founding materials at 64 | the founding floor; FOUND-BARE with empty bags; FOUND-HOUR1 (2.1, 3) |
| Codex P2 membership | accepted = in the accepted chain (1.2) |
| Codex P2 the future pad | clear-pad tie-break, `building: needs_terrain:n` (1.5); townzone wording (1.7) |
| Codex P2 siting requirements | well sector a preference (stated); Z0/M0 pins restored; tree farm read as occupied (1.4, 1.6) |
| Codex P2 / Claude P2 the only table | the station rule (2.1, r3) |
| Codex P2 F3 / priority | either deposit path; one found slot (2.1, r3) |
| Codex P2 / Claude P2 allocation waiting | once nothing is index-unknown (1.5) |
| Codex P2 / Claude P2 zones | 1.7 (r3) |
| Codex P2 scenes | TP-ZONES, FOUND-HOUR1, FOUND-SOFT, FOUND-KILL variants, named productive work (3) |
| Codex P2 / Claude P3 showcase inputs | 4 |
| Claude P2 transitions, fsync | 1.2 |
| Claude P2 re-fit orientation | frozen s/orientation (1.5) |
| Claude P2 strip inTown | stations and stands inside inTown (1.5) |
| Claude P2 annex cells, planting | 1.6 |
| Claude P3s | recount exemption; composter off paths; definitions; pickChestSite is the reviewed cluster rule; footprint recorded, `foreign` restored; the lease records its generation |

### Round 2

| finding | disposition |
|---|---|
| Codex P1 / Claude P2 SOFT-last could wreck a committed storehouse; placed stands not hard | HARD = every plan cell, every reserved/placed stand and the whole box + 1 of a committed plot; SOFT only for uncommitted plots, annex surroundings and paths; outside-soft searched across all anchors first (1.6) |
| Codex P1 / Claude P1 a temporary table adopted as `placed` | temporary station placements are adopters (never on a plan cell or stand); observations take two reads 10 min apart (`seenSince`); `missingSince` / `gone` for a placed cell that is no longer there; TP-TEMP (1.2, 1.5, 1.6, 3) |
| Codex P1 / Claude P2 existing wells, stairs, clearance | chest cells pass `wellKeepout` (7 horizontally); stations and stands pass `stationRefusalAt`; cap-3 on stands; plinth shells and stairs solid in the walk; TP-RETRO proves a disposal afterwards (1.5, 3) |
| Codex P1 the raised-well adopter | `planPlinthSteps` gets the plan's keep-outs for a NEW plinth (keepOut / avoid, two passes); FOUND-PLINTH (1.6, 3) |
| Codex P1 the ladder after giving the only table | the station rule: a bot never ends without the station kind it gives (crafts a spare first) (2.1) |
| Codex P2 F3 starvation | F3 is decided at the found slot BEFORE the deposit banks the stack; unassigned placed containers are used first (2.1) |
| Codex P2 / Claude P2 precedence | one found-slot decision table (2.1) |
| Codex P2 / Claude P3 repair and "none: the annex" | tick (e): `extra` annex cells appended to a committed storehouse; (f): a whole re-fit while nothing is committed (1.5) |
| Codex P2 checkpoint membership | no on-disk checkpoint; an in-process continuation of the reader's own walk (1.2) |
| Codex P2 recovery metadata | the reservation carries the intent; an observation keeps it (1.2, F6) |
| Codex P2 / Claude P3 zones contradiction; malformed zones | the last good list is authoritative; unknown only with no good read (any malformed zone at the first read counts) (1.7); TP-ZONES aligned |
| Codex P2 proof needs pinned generations, lid and access | `keepout=<class> gen=<N>` on the adopters' rows; the audit's `lid` and `unreachable` (1.9) |
| Claude P2 tests not named | section 3's test list |
| Claude P3 first-audit occupied, invalid count | both REVERT defects (1.9) |
| Claude P3 planting near home | stated as intended; counted (1.6, 1.9) |
| Claude P3 the floor and the rung's wants | floor = max(founding floor, the rung's wants) (2.1) |
| Claude P3 the retrofit well path end | omitted when its end is <= 7 (1.4) |

### Round 3

| finding | disposition |
|---|---|
| Codex P1 / Claude P3 HARD can add dead ends | three tiers: outside, SOFT, BOX (a committed box, except cells and stands); NEVER only plan cells and stands; P10 named and measured (`keepout=hard_only`); FOUND-BOX with a base control (1.6, 1.10, 3) |
| Codex P1 / Claude P2 a temporary-table refusal can become needs_station | two tiers (non-plan, then free unmarked plan cells); plan skips counted like wellSkip (no make-room dig); NEVER only reserved/placed/marked cells and stands; TP-TEMP's interior case (1.6) |
| Codex P1 a pending observation can be re-fitted away | a `seenSince` cell is pinned like a committed one (1.2) |
| Claude P2 how the marks may be written | set only to the writer's own `at`, never changed while set, cleared only by a definite contrary read, the holder's alone on a live reservation; mutants for a backdated and an early mark (1.2, 1.9) |
| Codex P2 re-adoption loses intent | an adoption keeps the cell's intent (1.2, 1.5) |
| Codex P2 / Claude P3 "a container has room" | the deposit's own dry decision; room-safe founding when it would not issue; CHAIN tests at 34/35/36 slots (2.1, 3) |
| Claude P2 a deleted file; the 32 MB cliff | any walked number gone -> a full re-walk; growth stated, the cap 64 MB, the read's 16 MB alarm, compaction a named follow-up (1.2) |

### Round 4

| finding | disposition |
|---|---|
| Codex P2 the BOX tier inconsistent across adopters | three passes for every permanent adopter, each row's `tier=` (1.6); ONLY-BOX plinth scene (3) |
| Codex P2 BOX admission can sever access | the ACCESS check on SOFT and BOX candidates (1.6); FOUND-ACCESS with a base control and real opens (3) |
| Codex P2 mark clearing ambiguous | each mark's own set / consume / clear, agreeing reads mature it, unknown reads change nothing (1.2, 1.5); tests for repeated, contrary and unknown reads and a second cycle |
| Codex P2 hard_only misses mixed refusals | `plan_refused` counts base-valid candidates the plan refused, whatever else refused; `keepout=plan_only` (1.6, 1.10 P10) with a mixed fixture |
| Claude P3 the dry deposit decision and its scan throttle | asked on a copy of its state with the throttle ignored (2.1); a 34-slot throttled CHAIN case |
| Claude P3 stray tables on store cells | the audit names occupied store cells (1.9) |
| Claude P3 BOX placements and found's unreachable | attributed before a REVERT (2.4) |
| Claude P3 a failed walk must write nothing | stated in the tick (1.5) |
| Claude P3 the walk's cost | `gens bytes walk_ms` on the audit row (1.9) |

### Round 5

| finding | disposition |
|---|---|
| Codex P2 a later BOX placement suppressed the unreachable REVERT | the REVERT stands; the read names a preceding SOFT/BOX placement as the responsible adopter (its own defect), and an unrelated later one as unrelated; self-tests for both (2.4) |
| Codex P3 ONLY-BOX "pass 2" | pass 3, `tier=box` (3) |
| Codex P3 stale summaries (P1, P6, P9, F2, 2.2) | aligned with 1.6 |
| Claude P3 ACCESS cost | only base-valid candidates, stop at the first pass, `access_ms` (1.6) |
| Claude P3 a cell's kind | a family: chest/trapped_chest, furnace lit or not (1.2) |
| Claude P3 two field sets | one: `tier plan_refused gen` (1.6, 1.9) |
| Claude P3 P6 stale | aligned (1.10) |
| Claude P3 the natural well's exhausted across passes | all three passes read and refused (1.6) |

### The showcase ground (found by the offline planner, 10-21; not a review finding)

`bots/scripts/townplan-offline.mjs` over the showcase's block dump (read-only region copies) first found NO qualifying ring@1
fit: the planner fell back to a 4-cell annex. The diagnosis per orientation named four rules stricter than the design needs:

| rule (r5) | what it refused on the showcase ground | r6 |
|---|---|---|
| the cell must be air, short grass, fern or dead bush | large ferns and tall grass under the spruce | vanilla's replaceable plants (a placement replaces them) |
| the cell above must be passable | spruce leaves over a cell | never a LID (lidrule's own test): leaves and glass open a chest |
| no log or leaves within 1 | a spruce trunk beside a cell | only SAPLINGS within 1 (they grow; a trunk does not) |
| the FIRST 4 chests in fill order must be ready | the S fit's overflow cell was one block low | ANY 4 chest cells (found takes the next READY cell anyway) |

With r6 the planner fits ring@1 on the showcase ground: orientation W, s 70, 12 of 12 cells READY and reachable, a clear pad
(4).

### Round 6

| finding | disposition |
|---|---|
| Codex P2 / Claude P3 snow at any depth | snow only at `layers == 1`; an unreadable depth is not READY; READY tests for layers 1 and 2 (1.5) |
| Codex P2 mud and soul sand pass chestLidBlocked | the lid is refused by chestLidBlocked OR serverLidBlocks (1.5); negative fixtures beside the leaves/glass positives |
| Claude P2 the audit's lid would REVERT chests under leaves | the audit's `lid` is READY's own lid rule (1.9); a self-test with a chest under spruce leaves (not lid) and under stone (lid) |
| Claude P3 no Paper placement in the new READY cases | FOUND-CANOPY (3) |

## 7. Build notes (the code against this spec; not a design change)

- **The adopters' fields (1.6/1.9).** `_deposit_new_chest` carries `tier= plan_refused= gen=` as specified. The well, plinth and
  composter rows are owned by older reads (wellsiteread, plinthread, composter reads) and are cut at 300 characters with their
  parsed fields first, so a NEW site decided under a plan writes its own row instead: `_townplan_adopt what=well|plinth|composter
  at= tier= plan_refused= gen= never=` (one per decision, deduped per process; `never=` the decision's own cells on a NEVER cell
  of that generation). The natural well's `_well_refused reason=no_site` row gains ` plan_refused= gen=` after `rec=` (tally
  stays first); the plinth's `stage=none` refusal gains ` gen=`. townplanread.py's D3 judges `_deposit_new_chest` and
  `_townplan_adopt` against the plan files' own generation; P10 counts `plan_refused >= 1` on the recovery's and the well's
  no_site rows.
- **D1 in the read** is "the writer logged a generation `result=accepted` that the port's walk of the same files rejects" -- a
  writer/port disagreement. (The walk cannot accept a step its own rules reject, so re-judging accepted steps would be a
  tautology.)
- **The planner tick** is a 30 s interval installed once per spawn after craftsync's install (craftsync's wiring test reads
  the nearest open handler before `installCraftSync`), cleared on `end`.
- **Re-anchored tests of other suites** (the order chain gained the found slot between the raised well and the deposit; the
  well's compute calls `planWellSearch`): plinth-skill (chain needle + its mutant), lidclear (chain regex), towndeposit
  (the recount guard's anchor and mutant), well (the plinth-first compute mutant). Each still guards the invariant it named.
