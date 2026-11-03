# shafttrap: bots trapped in the town stair (design, 2026-11-03)

Control session item **shafttrap** (owner 11-03: "yes design all using both claude and codex, put them in the queue and
implement and deploy where you feel is right"). Source: the requests agent's finding
(`docs/reports/requests-design-2026-11-03.md` section 1) that most showcase "I'm stuck" episodes were bots in the mineshaft's
stair column with the escape guard holding on the shaft record.

## 1. Measured

Showcase, 11-03 07:50Z (the stair was sited 07:51Z, complete 08:24Z) to 21:56Z: 10 bots, 158,154 skill rows from the live
files on 10.0.0.40. Fleet: 11-03 live files on 10.0.0.31 (00:00Z to about 22:00Z), 80 bots. The stair box on the showcase is
x 23..27, z -31..-24 (record `project-0_70_0.shaft.g5.json`: origin 26,-25, away n, g 68, K 53, landings 48/32/16, exit 25,69,-23).

| what | showcase | fleet |
|---|---|---|
| `_needs_rescue` with `guard=record record=shaft`, of all `_needs_rescue` | **11 of 16** (7 bots, all on 11-03) | **74 of 87** (40 bots) |
| the skill that ended just before the trap's first `_marooned`/`_entombed` | **8 of 11**: `build_shop` (the stair visit); 2 gather, 1 surface | 14 of 74 build_shop; 12 explore, 11 mine, 13 gather, 10 goto, rest scattered |
| `_marooned` inside the stair box (y <= 66), of all `_marooned` | 153 of 296 | (per-town boxes, not read) |
| `_entombed` inside the box, of all | 150 of 751 | |
| in-box `_marooned`+`_entombed` straight after a stair visit ended | 144 of 303 | |
| `_escape_guard_ramp` in the box, of all | 275 of 321 | |
| `_escape_guard_refused` in the box, of all | 70 of 104 | |
| `_inventory_mutation` in the box (the escapes' pillar placements) | 124 of 747 | |
| `_shaft_use dir=up` (surface's stair ascent), all bots | 167 arrived, 209 no_plan, 31 walk | |
| ... of those inside the box | 23 success, 33 no_effect (no_plan in 2-400 ms; walks stopping part-way) | |
| stair visits on a COMPLETE stair; their `_shaft op=dig why=air` | 135 visits; 296 digs | |

Positive controls: the same walks found 16 `_needs_rescue` rows of other kinds (monument, workshop, house1), 296 `_marooned` and
751 `_entombed` rows outside and inside the box, and 1,361 `_shaft` rows on the fleet.

## 2. Cause: two correct guards composing into a dead end, and the visit that feeds it

1. **The visit hands the body back deep in the stair.** `runStairVisit` (shaftvisit.mjs) ends "where the work stopped"; on a
   complete stair every visit is a repair (dirt in an air cell, `why=air`), so the bot walks down to step k, digs, and the
   skill returns with the bot at step k. The stair claim (shaft-03) is released with it.
2. **The maroon probe is the wrong question in a spiral.** The idle reflex's `canStartAPath` (reflex.mjs) asks for a route to
   `GoalNear(x+8, y, z+8, 3)` at the bot's own height. In a 3x3 spiral nothing at that height is reachable. **Paper 11-03
   (sandbox3): the probe is false on a CLEAN stair at step 40** (`partial`, no path) and on one with a dirt block above
   (`noPath`), while the ascent plan to the exit succeeds on the clean one. So every idle bot in the stair is "marooned".
3. **The escape cuts into the stair; the guard refuses it.** The marooned arm pillars (dirt into the stair's own air cells: 124
   placements) and ramps; its digs over the head are the stair record's rock (lining, the pillar, the next turn's treads), which
   escapeguard-01 correctly refuses as `record=shaft` -> hold, `_needs_rescue`, "I'm stuck", last resort after 10 min.
4. **The pillared dirt closes the stair for the next bot and makes the next repair visit.** The real mineflayer-pathfinder A* from
   a stand finds the exit on a finished stair and returns `noPath` in 31 nodes with ONE dirt block in an air cell (that is the
   fast `no_plan`); the next visit digs it out (296 digs) and ends deep in the stair again: a loop.

The stance theory (a centre over the next step down seeds the planner in the wrong cell) was checked and is NOT a cause: the
real A* plans the exit from that seed cell (unit test), and on Paper the egress starts from it and arrives (scene `edge`).

## 3. The design (Claude)

**Piece 1 -- shafttrap-01 (showcase, tier 2, BUILT): a stair visit ends at the collar.**
- `shaftgeom.mjs` (pure): `stairStepAt(plan, feet)` (the step whose stand is within Chebyshev 1; a stub walks back to its
  landing step first), `egressNext(read, plan, i, body)` (the next move: a hop of up to 3 stands; a foreign solid in one of the
  stair's planned AIR cells within one step is dug; one farther is approached; a liquid or a missing tread next to the bot stops
  it; a dig is refused when any face of the block is a liquid or unread -- it may be a barrier), `egressReserveMs(k)` (8 s +
  0.8 s a step).
- `shaftvisit.mjs` `runStairEgress(plan, e, { exit, deadline })`: injected effects, bounded (deadline, 8 clears, two refusals
  of a cell, a step guard), refuses a dig while a body stands on the block (`e.occupied`), ends at the exit.
  `runStairVisit` takes `reserve`: no unit is started unless the way out from its step still fits the budget.
- `skills.mjs` `buildStair`: the visit and the egress run inside ONE stair claim; the egress also runs on the
  finished-stair early return (a bot asked to build while standing in it); `visitEgress` builds the effects: the hop is
  `stairWalk` (deepminer-01's hop walk, the town-deposit profile: no digs, towers or scaffold), the dig is the visit's own
  server-witnessed dig (`withDigScope` target/build_stair), `bodyOnCell` is the live occupancy. Rows: `_shaft op=egress ok= why=
  from= to= hops= cleared= ms=`, `_shaft op=egress_dig k= at= why=foreign_in_air`.
- What it fixes: the build_shop entries (8 of 11 showcase rescues, 14 of 74 fleet, 144 of 303 in-box maroon/entomb rows), and
  with them the pillar dirt that feeds the repair loop.

**Piece 2 -- shafttrap-02 (fleet canary, tier 3: reflex.mjs and skills.mjs::stair* are protected): the reflexes hand a bot in the
stair to the same egress.** Before the marooned arm's lattice and before the entombed arm's pillar, when the bot's feet are on
the town stair (`stairStepAt` against the town's stair record, a record present and complete) and no air/drowning/fire reflex
owns the body: take the body (the runner's 'stair' claim), run `runStairEgress`, and only if it ends `wet`, `tread`, `unknown`,
`occupied` or `hop` fall through to today's lattice (so the escape that existed is never taken away, and the guard's last resort
still applies). `stairAscend` (surface) uses the egress instead of plan-or-null, so a surface from inside the stair clears the
dirt instead of answering `no_plan`. Never a pillar placed into a planned air cell of the stair (the place guard: a scaffold
placement there is refused with the egress named as the remedy). This is the fleet's 74/day.

**Piece 3 -- shafttrap-01 on the fleet** (tier 2 owner-direct, 60-min tripwire), or folded into piece 2's canary as one bundle.

## 4. Codex's independent design (codex exec, read-only, 11-03) and the reconciliation

Codex, given the measurements and not this design: "a missing stair-egress contract, compounded by an inaccurate pathfinder
start node". Points, and what was done with each:

| Codex | reconciliation |
|---|---|
| visits abandon the body underground; the "next visit repairs it" remedy is not executable by the stranded bot | **agreed**: piece 1 |
| the maroon probe tests the wrong capability (same-height offset goal; and it accepts any non-empty partial path) | **agreed**, and proven on Paper (false on a clean stair); piece 2 bypasses it inside the stair rather than changing the fleet-wide probe |
| the ascent can start from a fictitious stance (the floored centre over the lower column) | **checked and refuted** as a cause: the real A* plans from that cell (unit test) and Paper scene `edge` arrives from it; the fast `no_plan` is the pillared dirt (A*: noPath in 31 nodes with one dirt block) |
| `skills.mjs::stair*` is protected, so stairAscend/stairWalk are fleet work | **agreed**: piece 1 only CALLS stairWalk; protected.py on the branch: `not protected`; changing stairAscend is piece 2 |
| explicit cardinal waypoints, recentre, verify support at each step; reserve return time | hops of 3 stands then 1 on the pathfinder (deepminer-01's Paper-proven hop walk) instead of a hand waypoint walker; arrival re-read from the feet each hop; the reserve kept |
| scoped maintenance: clear dirt only in planned air cells, liquid/falling/support checks, by hand without a pickaxe, preserve every tread/lining/pillar | **agreed**; Paper scene `pillared` digs 4 dirt blocks by hand with an empty bag and leaves all 192 air / 464 solid planned cells as planned; liquid barrier and body-on-block refusals added at Codex's review |
| fleet: a stair-recovery dispatcher before maroon/entombed, bounded ownership, drowning/fire stay authoritative | **agreed**: piece 2 |
| Paper: every orientation, shallow positions, interruptions, concurrent occupants, unloaded chunks | done on Paper: clean, pillared, lava barrier, edge stance, stub, the before chain; orientations and pillared/liquid/stub/edge cases on the real A* in the unit tests; **not yet on Paper: two bots at once, an interruption mid-egress, unloaded chunks** (the egress stops `unknown` on an unread cell by construction) |
| read: zero shaft rescues vs 11/74, zero false in-stair maroon/entomb vs 153/150, zero pillar placements vs 124, ascents vs 23/33, repairs vs 135/296, with occupancy denominators | adopted for section 6, with piece 1's expectation scaled to the entries it covers |

**Codex review of the build** (one engine, blockers only; tier 2): r1 two blockers -- (1) a dig could open a liquid's barrier,
(2) a dig could remove the block another bot stands on -- both fixed (`egressNext` refuses a dig with a liquid or unread cell at
any face; `runStairEgress` asks `bodyOnCell` right before the dig); r2 one more -- the liquid check skipped the bot's own
feet/head cells -- fixed (ad9a819f). Each fix has its test; Paper scene `lava` covers (1).

## 5. Proven, and what each rests on

- Unit (bots/test/stair-egress.test.mjs, 23 tests, the REAL mineflayer-pathfinder A* on the showcase stair's geometry): the
  dead end before (probe false at step 40, the over-head cell is `record=shaft` and refused, the walk out exists), the
  positive control (probe true at the exit), the pillared stair (4 blocks dug, only planned air cells), the stub, water and lava
  barriers, a body on the block, the bounds, the composition (a repair visit at step 41 then the egress -> exit, probe true),
  the reserve (and its positive control), three mutants with unique anchors, the wiring.
- Paper 1.21.8, sandbox3, 11-03 22:15-23:10Z (last run at ad9a819f, all 7 scenes) (driver `sandbox/shafttrap/egress-e2e.mjs`, the build's real runStairEgress,
  stairBotEffects, botBuildEffects; a stair carved from shaftgeom's plan, K 55): `before` probe false + ascent noPath; `before_clean`
  probe false, ascent success; `clean` step 44 -> exit 35 s, 15 hops; `pillared` 4 dirt dug by hand, exit in 34-38 s, every planned
  cell as planned; `lava` stops `wet`, nothing dug, no lava in the stair; `edge` (start floor in the lower column) -> exit 30 s;
  `stub` (y=32 landing) -> exit 32 s.
- Rests on, already seen working: stairWalk's GoalBlock hops on the town-deposit profile (deepminer-01 Paper 11-01 climbs);
  the visit's witnessed dig (shaft-02/03 live).

## 6. The read

Showcase (generic 2-h read, plus): `_shaft op=egress` rows (ok share, why), in-box `_marooned`/`_entombed` within 60 s after a
stair visit (baseline 144 in 14 h: expect about 0), shaft `_needs_rescue` (baseline 11 in 14 h; piece 1 covers 8 of them),
in-box `_inventory_mutation` (124), stair repair digs `_shaft op=dig why=air` (296 in 14 h, should fall as the pillars stop),
denominators: stair visits and bot-minutes in the box. Deaths 0 linked.

## 7. Tripwire

No new rule. The egress logs `_shaft` rows, which neither shopread (judges `_build` rows) nor showcase_trip.py judges, exactly
like the visit's own repairs today (296 `op=dig why=air`). It digs only foreign blocks in planned AIR cells of the stair's own
record (never a tread, lining, pillar, another record or a zone), which the Paper truth checks confirm.

## 8. Queue placement

- **Showcase lane**: shafttrap-01 folds with the next showcase release (it touches only shaftgeom.mjs, shaftvisit.mjs and
  buildStair in skills.mjs; no protected file). It is a survival fix for 7 of 10 showcase bots on the day it was measured, so
  ahead of the 10 -> 15 bot step (more bots in the same stair make it worse). Codex: the same.
- **Fleet lane (S)**: shafttrap-02 (with shafttrap-01 folded in) as a SURVIVAL canary after swimcentre-01, alternating with a P
  entry; it needs its build on the fleet sha, two engines, and a Paper proof of the reflex composition (the whole bot, idle in
  the stair) first. Codex: the same, "canary protected changes first; showcase then inherits the identical protected tree".

## 9. Owner decisions

None needed for piece 1. For piece 2, none either: it keeps every existing escape as the fall-through.
