# picker-01 + the first town sinks: roads, wall towers, ziggurat growth (2026-11-03)

**Owner:** 11-02, resource model §12 Q3: roads, wall towers **and** ziggurat growth, with towers and ziggurats
showing design creativity (seeded variety, never one template). 11-03: "i agree to all those things, do it".
**Source:** [`resource-management-2026-11-02.md`](resource-management-2026-11-02.md), rows 6 (picker-01) and
7 (sinkrate-01), §6 and the sinks catalogue.
**Status:** built as a showcase piece on branch `picker-01show`, on the live showcase release `adbf9e41`. Tier 2.
It is not released. The tripwire rule it needs is on main (this commit). Ledger row: `picker-sinks-1103`.

## 1. Why now

On the showcase, 11-03 09:40–15:38Z (45,747 rows, 10 bots), the finite build list is nearly exhausted:

| What | Measured |
|---|---|
| Tidy visits | 101, of which 67 ended `keeper_held` (the groundskeeper's lease) |
| House1 | stuck |
| Copper hall | waiting on copper |
| Paths and the stair | complete |
| Bot time in `build_shop` | 9.7% |
| Cobblestone in bags | 5,551 in 10 bags (383–811 each) |
| Town chests | cobblestone 948 + deepslate 45 (TARGET is 1,000); stone_bricks 163; torches 49 |

Placing visits since 10-30 (`build_visit` rows):

| Project | Placed per placing visit | Rate | Typical stop |
|---|---|---|---|
| Ziggurat | mean 41 | about 28 blocks/min | `deadline` |
| Wall | mean 24 | | `attempts_spent` |
| Paths | mean 9.3 | | |

## 2. Two designs, reconciled

Claude wrote a design first. Codex then wrote one independently from the same brief, without seeing Claude's.

| Point | Claude | Codex | Built |
|---|---|---|---|
| Instance model | Three static plots, each a **growing record** of instances | The same, and noted that `escapeRecordSnapshot` iterates `PROJECTS`, so static plots keep the escape guard | Growing records. Nothing is removed, so finished instances stay protected and get repaired. `projectsGuarded` keeps every sink plot even with SINKS off (Codex) |
| Picker position | Repairs, then finite projects, then `dueFirst` upkeep, then sinks, then `due` upkeep | The same, plus: a keeper-held tidy must not be every other bot's fallback, and an upkeep should be interleaved | Both. A sink is offered only when no finite project has a slot for this bot. After 3 sink visits, one ordinary upkeep goes first |
| Pressure | Town cobble + this bot's bag above 64, against TARGET 1,000 | Bags are not communal; a bot pledges only its own | The bot's own bag only. An unread town counts as exactly TARGET |
| Funding | Bounded instance bills (≤ 512) | The whole bill must be coverable | Both: `sinkFundable` = town above LOW (256) + own bag ≥ bill |
| Towers | Slim stepped towers, step-in 1, spiral stair, up to 16 high | Low and broad, drops ≤ 3 | Slim towers with tiers ≤ 3 high (Codex's drop rule): 4–12 high, never a drop over 3 |
| Ziggurat growth | Satellite shrines around the ziggurat | An attached forecourt or terrace detail, needing explicit cell interfaces | Satellites in **mirrored pairs**, 7 columns of open ground from the ziggurat, never in front of a stair. Attachments wait for an interface rule |
| Roads | A raised causeway along each land-plan spoke's expedition rail, from r = 80 | Pave the land-plan corridors within workR | The causeway beyond r = 80. The corridors are the groundskeeper's: its roads stage, not run yet, would cut a pavement laid before it. Paving graded corridors is the next road stage |
| `mats` bill-driven | Not needed if palettes use only stocked stone | Feed phase demand to `materialOrder` | Not changed. Palettes use stone already in stock (no parts), so nothing waits on `mats`. Retiring the buffers would need `cognitive.mjs` (tier 3) |
| Tripwire | Head-only judging already passes a growing record | Judge against the generation authorizing the row | Codex's rule (§6) |
| Water | No cell in or beside water | No water-adjacent work | Liquid within one column refuses. Roads stop a column short of water. A bridge is a later stage |

## 3. The sinks and their seeded variety

Each design is a pure function of a seed (kind, pool, home, instance number) and the stone the town can pay for at
siting. It is fixed once and written into the record. A restart never re-rolls it.

**Towers** sit just outside the wall: its corners first, then flanking the gates, the side midpoints, and a sweep
every 7 columns.

- **Shape:** base 5, 7 or 9; step-in 1; tier height 2 or 3; a spiral stair that turns clockwise or anticlockwise
  from the face toward home. On 1-wide terraces the stair runs *along* the terrace.
- **Crown:** merlons, a brazier (a campfire only if one is stocked), a spire, or corner beacons.
- **Palette:** solid, alternate, gradient or base-band, with quoins, a trim course and moss weathering, each drawn
  only from stones the town and the siting bot hold. Every role list ends in cobblestone, so a cell never waits on a
  stone.

**Shrines** (ziggurat growth) are step pyramids in slots around the ziggurat. There are eight slots per ring and two
rings. The slots come in mirrored pairs, and a pair shares one design (twins).

- **Shape:** base 7–13; (step-in, tier height) of (1,1), (2,1), (2,2) or (1,2); one grand stair or four, 1 or 3 wide;
  an optional broad dais.
- **Summit:** a temple (posts and a brazier), a brazier, a spire or a beacon.
- **Palette:** as for towers.

**Roads** are 16-column segments of a raised, 3-wide causeway along each spoke's rail. Every step is ±1, fills are at
most 3 deep, and lamp posts stand on alternating edges. The surface pattern is fixed per road: edged, centre line,
checker, bands or plain.

**Tests over 40 seeds:**

- 12 or more distinct tower designs: 3 or more bases, 2 tier heights, both spirals, 4 crowns, 4 patterns.
- 12 or more distinct shrine designs.
- Every design's summit is walkable from the ground by ±1 steps.

## 4. Throughput (sinkrate-01)

- **Builders:** 3 slots per plot, and 2 instances may be open per town.
- **Segments:** one per layer and quadrant, with the ziggurat's layer barrier.
- **Bill:** drawn from the builder's bag first.
- **Bag rule:** a light plot, so a bag needs only 2 free slots.
- **Order cooldown:** 3 minutes for a sink, against 10 for other projects.

The bodies are solid and repetitive, filled from the layer below. That is the ziggurat's pattern, which placed 41 a
visit. The offline proof and the fake-server runs show the work is buildable; 40 or more per visit is a live read.

## 5. Offline on the showcase

Source: a copy of the world (±112, y 54–106) and the pool state, 11-03 ~15:36Z. The run used the bot's own
`siteSink` (`bots/scripts/sinks-offline.mjs`), with Echo's bag and the town's stock as the stone available.

**Sited and proven:** 9 instances in 6 rounds, 1,460 blocks.

| Instance | Where | Design | Blocks |
|---|---|---|---|
| Tower T1 | Wall corner | B5 H2, brazier, stone_bricks/deepslate base band, quoins | 83 |
| Tower T2 | South side | B7 H3, along-stair, brazier | 302 |
| Tower T3 | Sweep | B7 H3, merlons | 300 |
| Tower T4 | Corner | B5 H3, merlons, trim | 122 |
| Tower T5 | Sweep | B7 H3, spire | 279 |
| Tower T6 | Sweep | B5 H3, beacons, quoins | 120 |
| Shrine Z1 | West of the ziggurat | B7 S2 H2, 3-wide stair, temple | 152 |
| Shrine Z2 | Outer ring, SW | B7, four faces, temple, base band | 79 |
| Road R1 | North spoke, z −81..−86 | Edged deepslate, lamps | 23 |

**What limits it:**

- **The north road** ends at the river at z −88 (water under ice).
- **The other spokes:**
  - s1's rail start is not reachable by the town walk.
  - s2 starts in water.
- **Stone:** bags carry almost no accent stone (it goes down the well), so palettes are mostly cobblestone with
  stone_bricks and deepslate. The variety on the showcase today is mostly shape and crown.

The rejects are logged per candidate. The most common are expedition markers, land-plan corridors, the ziggurat's
+8 apron, a low apron and a deep fill.

## 6. The tripwire (tooling, main)

Rows for `project=road|tower|shrine` are judged against the generations of the plot's chain that were in force when
the row was written: a generation counts once its `at` is no more than 60 s after the row. This applies to H1
(`sink_place_ok`) and to H2 (`sink_clear_ok`, where `kind=foreign` is checked against cells).

A placement or a dig ahead of its instance's siting trips. Rows from earlier instances never trip, because cells are
never removed. Fixtures cover:

- a placement ahead of its instance's siting, and the same placement after it;
- a placement off every generation;
- listed canopy and trunk clears, a foreign dig in an open cell, and an instance's cut before and after its siting;
- an unlisted clear;
- a fourth slot.

Selftest: ok. Mutants: 62 of 62 killed (5 new). Reviews, one round, blockers only: **Codex APPROVE, Claude APPROVE**.
Claude's note: a tree that grows into an open sink cell after siting would be dug through the foreign path as
`kind=tree` and trip H2 and G5. That is pre-existing behaviour for every project, and unlikely here because saplings
are kept off the box + 2.

## 7. Review of the bot change (tier 2: one engine, blockers only)

Codex r1 found two blockers, both reproduced and fixed in `97487220`:

1. **A cut beside water.** The liquid scan stopped at L+2, but a column may be cut from L+3. The scan now reaches one above the
   highest ground on the site. A fixture plus an anchored mutant cover it.
2. **Roads stopped after one segment.** A road's own last segment reserved the next segment's first column. A road is now sited
   clear of every record except its own. The bug is reproduced in a test, with a control.

Codex r2, re-checking only those two fixes: **APPROVE**.

Tests: `sinks.test.mjs` 35/35. They include the real `runVisit` building a tower with 1 builder and with 3, and a shrine. The
suite also climb-checks 40 seeds and runs 9 anchored mutants.

**Full suite** (on 10.0.0.30, `flock ~/suite.lock nice -n 19`, 6 jobs), at the tip `f7455f3b`: **394 of 397 files pass**. The
three that fail also fail without this change:

- `nothing-important-is-orphaned` and `well` fail on the base `adbf9e41` too.
- `ceilescape` fails because the staging snapshot has no git history (`git show 3cc5f14d`).

The first run, at `97487220`, gave 389 of 397. It found five failures this change caused, all fixed in `f7455f3b`:

- one reserve-reader rule;
- three anchor-uniqueness or anchor checks;
- one project list.

## 8. Rollback and the read

- **Rollback:** `SINKS=off`, or reactivate the previous release. A sited instance's cells stay guarded.
- **2-h read on the showcase:**
  - At least 1 `_sink op=sited`.
  - `_build_visit project=tower|shrine|road` placed per placing visit, with the denominator stated.
  - H1–H6 at 0.
  - No new deaths.
  - Tidy `keeper_held` visits falling (from 67 of 101).
  - `_sink op=pick` rows show the pressure and the order.
