# Idle towns: the tree farm and the storage hub on the fleet (2026-11-06)

**Owner, 11-06 ~02:30Z.** board-b, hive-b and placebo-a have built every project they have, so their bots idle and patrol.
The owner chose all four of: tree farm, stoneworks, town gate, storage hub. towngate-01 and stoneworks-01 are already queued.
This note covers the **tree farm** (built: `treefarm-05`) and the **storage hub** (designed; not buildable as one small piece).
Ledger row `idletowns-1106`.

## 1. Measured (11-06 ~02:00Z)

**The three towns are complete.** Pool records on .31 (`/var/lib/mcai/_pool-<pool>/`, the head generation of every
`project-<home>.<plot>`):

| pool | home | workshop | stair | house | ziggurat | paths | wall | tidy |
|---|---|---|---|---|---|---|---|---|
| board-b | -249,65,144 | done | done | done | done (4,066 cells) | done (320) | done (414) | done |
| hive-b | 355,73,147 | done | done | done | done (4,498) | done (no-site record) | done (261) | done |
| placebo-a | 249,75,-144 | done | done | done | done (2,352) | done (no-site record) | done (380) | done |

Positive control: the same script over all 16 shared pools finds open or missing projects in the other 13 (for example
board-a has no ziggurat record, hive-a's ziggurat is open, board-d/hive-d/placebo-b have an open tidy). **Only these
three towns have nothing open.**

**What their bots do.** `lib.telemetry` full walk, 3 h, 5 bots each (900 bot-min per pool): explore + goto = 362 / 346 /
341 bot-min; build_shop rows 1 / 2 / 0. Positive control: board-a, same window, 14 build_shop rows (all `no_site` for
its ziggurat).

**What they hold.** The town index, last observation per chest:

| pool | chests (full) | logs | cobble + deepslate | stone bricks | planks | torches | saplings in chests | sand / glass |
|---|---|---|---|---|---|---|---|---|
| board-b | 19 (9) | 2,991 | 706 + 416 | 182 | 428 | 61 | 0 | 0 / 0 |
| hive-b | 11 (8) | 1,014 | 235 + 763 | 135 | 47 | 49 | 66 | 0 / 0 |
| placebo-a | 15 (12) | 1,850 | 57 + 943 | 202 | 69 | 95 | 24 | 0 / 0 |

Every bag (5 per town, last hour's inventory) holds about 8 oak and 8 birch saplings. `townKeeps` keeps no saplings, so a
farm visit's spare includes them: 61 to 81 saplings per town against a farm's 6 to 12 plots.

**Models.** board-b and placebo-a moved from the 4B to qwen2.5:7b at 01:33Z (llm rows: `qwen2.5:7b-instruct`). hive-b is
on `r3-qwen35-4b-q8`. hive-b is also in the live stuckproj-01 canary (601fe6a3, on hive-c, board-d, hive-b, placebo-b).

## 2. The tree farm (`treefarm-05`, built)

**What is already on the fleet.** The showcase tree farm (treefarm-04: a levelled grid of saplings with growth torches,
harvested from the stump up and replanted as upkeep) reached the fleet in zigfleet-02 with its switch off:
`treefarmOn` is true only in `TREEFARM_POOLS`, which defaults to `showcase`. treefarm-01 was cancelled; treefarm-02 ran in
October (the old farm order, `tend_farm`); treefarm-03 is parked on dead variants and superseded by treefarm-04 on main.

**Why a flag is not enough.** The bots' own siting (`bots/scripts/treefarm-offline.mjs`) on copies of the three towns'
region files (from .30) and pool state finds **no farm inside any of the three walls**:

| pool | inside the wall (4x4..3x3) | outside the wall, rMax 48 |
|---|---|---|
| board-b | no fit (7,252 tried: box 6,830, level 422) | 3x3, 9 plots, 39 from home, 6 site trees |
| hive-b | no fit (6,792 tried: box 6,784) | none at 4x4..3x3 (even at rMax 80); **3x2**, 6 plots, 47 from home |
| placebo-a | no fit (5,204 tried: box 5,204) | 3x4, 12 plots, 42 from home |

The 48-wide ziggurat and the other records fill the walled area.

**The change** (branch `treefarm05-on-4f3b0f5`, 946c8aaa on the live fleet 4f3b0f5c; tier 2, not protected):

1. **Mode.** `treefarmMode`: `on` in TREEFARM_POOLS (the showcase, unchanged); `idle` in every other pool; `off` with
   `TREEFARM_IDLE=off`, which is the fleet rollback.
2. **The idle gate.** In `shop.mjs`, `idleOnlyOpen` and `activeProject`'s `idle` option open an idle-only project only
   while every other project that is on has a complete record. That includes the tidy and the stair. A project with no
   record, an open one or a stuck one keeps the farm closed. So the farm never takes a bot from real work, and today it
   opens in exactly these three towns. When a project reopens (a re-sited tidy, a paths extension, a new project) after
   the farm is sited, the farm waits. A standing farm's harvest and replant remain `due` after every open project, as on
   the showcase.
3. **The guard.** `projectsGuarded` keeps the farm's record protected always, as it does the stair's, so a rollback
   never drops a sited farm's reservation.
4. **Siting.** `farmSiteTries` / `siteFarmTiered` try, in order: inside the wall at the big grids, outside it, then the
   small grids (3x2, 2x3) inside, then outside. Outside the wall every reservation is still kept off, the wall's own
   columns + 1 included. `TREEFARM_FALLBACK=off` keeps the idle farm inside the wall and on the big grids. The
   showcase's tries are treefarm-04's single try.
5. **Composter.** `farmKeepsOn` follows the `on` mode only, so the fleet's peaceful kit composts as before. The idle farm
   plants the oak and birch every bag already keeps.
6. **Offline tool.** `treefarm-offline.mjs --fallback` runs the idle farm's tries. With the real code it gives the three
   sites in the table above.

**Tests.** `treefarm-idle.test.mjs` passes 8 of 8: the mode; the gate (the measured state; ziggurat open with full slots;
tidy open; stair open; unsited; a sited farm when a project reopens; due upkeep); the guard; the tries; the tiered siting
on ground whose walled area is full; the small grids; the wiring. Each test has anchored mutants (anchor present and
unique), all killed. The structural wiring test was proven to fail on a mutant of the call. `treefarm.test.mjs` passes 21
of 21 (the switch and the composter agreement were updated). The touched suites pass: house, paths, shop, tidy,
stuckwait, wall, ziggurat-project, zigtidy2, town-stair, fleetpaths, composter, buildsite, lid. eslint is clean.

**Review.** Codex (`codex exec`, blockers-only, one round): `BLOCKERS: none`.

**Full suite.** On ci2 (`suite-run.py --ref 946c8aaa`), 394 of 397 files passed. The 3 failures are the known base set on a
copied tree: ceilescape, nothing-important-is-orphaned and protected-paths.

**Registration and draft queue entry.** `docs/reports/treefarm-05/` holds both (no patch block). Copies are at
`~/mcai-analysis/treefarm-05.946c8aaa.json` and `.queue-entry.json` on .31. The queue was not touched.

### Codex's independent design and the reconciliation

Codex was given the measurements and the goal, not this design. It agreed on the shape: a scheduling and siting change,
not a new skill; the gate evaluated from complete records; fall back outside the wall, then to 3x2 and 2x3, at rMax 48;
the farm's `after: paths` kept.

| point | Codex | built | why |
|---|---|---|---|
| scope | `TREEFARM_POOLS=showcase,board-b,hive-b,placebo-a` plus idle-only and outside-wall flags | idle mode in every non-showcase pool by default; the gate decides | a canary deploys code, not env; the gate already confines it to towns with nothing open (3 today), and a town that finishes later gets a farm with no new rollout |
| tidy | counts as open | **adopted**: counts | "no open project" means none; an open tidy is the town's work |
| guard when off | keep the farm protected, like the stair | **adopted** (`projectsGuarded`) | a rollback must not drop protection |
| composter | must not follow scheduling eligibility | follows the `on` mode only | static; fleet compost unchanged |
| recheck at the visit | re-check eligibility inside `buildTreeFarm` | not added | `shopActive`'s state cache refreshes on any record generation change (a project opening changes one); a visit already running ends within its 180 s |
| `farmFront` blocked fallback, route proof | reject a candidate whose front is blocked; prove a wall gateway reaches it | not added | the paths extension (`extendPaths`) adds a leg only when it routes; an unrouted front leaves the paths complete, and the farm is reachable by ordinary pathing |
| goalwatch | report a policy-paused farm separately | not added | a paused, sited farm can trip the 3 h stuck-goal alarm; rare (a project must reopen mid-build); named here |
| rMax circular | the scan is square | n/a | `fitAt` refuses `far` past rMax at the centre, so the limit is circular |

### What to watch (read)

- `_build project=treefarm op=sited` with kind `.../outside` in each drawn town, then `op=place` and `op=harvest`.
- The `structure_complete` row.
- The stuck-goal alarm: a `treefarm@<home>` row means the gate held a sited farm or the build stalled.
- Paths: board-b's paths record may reopen once (a leg to the farm's front) and close again.
- Generic gates: the tripper and the death gate.

The earthwork is up to 61 fills and 109 cuts, the showcase's bounded floor rule.

## 3. The storage hub (designed; the smallest piece is not small)

**On the showcase.** The hall (`storehub@1`: 19x11 pad, 18 single chests with wall signs) was sited at 57 from home
after storehubsite-01, built (604 place rows), and completed 11-05 09:05Z. **Since then the showcase logs hold 0
`_storehub_clerk` rows and 0 hub sign rows.** Positive control: 708 `_sort_deposit`, 225 `_sort_tidy` and 2,726
`_storehub_mode` rows in the same files; the mode row says `on=1 clerk=1 signs=1`. The hall's upkeep (signs plus the
clerk) is `due`, which `activeProject` serves only after every open project, and the showcase always has one open
(the town hall, the tower, the stepwell, the enchanting workshop, the tidy). **The clerk and the hub signs have never
run live.**

**Offline siting on the fleet towns.** The showcase's own hall siting (`storehub-offline.mjs`, d4dc532c) on the same
region and pool copies:

- board-b: a site at x -286..-276, z 138..156.
- hive-b: a site at x 300..310, z 127..145.
- placebo-a: `no_proven_site` (40 `no_step` proof failures; the ziggurat apron covers 769 candidates).

The bill per hall is 410 cobblestone, 97 stone bricks, 123 planks, 23 glass panes, 18 chests and 4 torches.

**What the fleet lacks.** Checked by name on 4f3b0f5c against d4dc532c:

| needed | fleet 4f3b0f5c |
|---|---|
| `storehub.mjs` and the blueprint | no |
| the hall chests as town containers (`chestfull.mjs setTownExtra`, the `townCobbleScan` extras) | no |
| siting with the ring, stand domain and walk radius (`siteBlueprintAsync`; storehubsite-01, storehubstand-01) | no; `siteBlueprint` has fixed bounds and radii |
| chests crafted for a bill (shopchest-01's `visitNeeds` chest rule) | no; build visits craft only the furnace and the table |
| glass panes | the mats pipeline can make panes from sand, but the three towns hold 0 sand, 0 glass and 0 panes |
| cobblestone for hive-b and placebo-a | 235 and 57 in town; they would need cobbled deepslate accepted |
| the label writer and the verified put (`sortLabelOne`, `sortGetSigns`, `sortSpotNeed`, `sortPut`, `sortKnownEntries`) | no (sortstore is showcase-only) |
| the clerk's cargo file (`pantryRead/Write`) and the withdraw preference (`withdrawSweep.preferFirst`) | no |

**Codex's independent design** (read-only, same measurements). Ship a hall, its registry, its labels and a small clerk,
with clerk activation staged behind its own flag. Port only the pure layout and these helpers: `sortKnownEntries`,
`sortSpotNeed`, `sortGetSigns`, `sortLabelOne`, `sortPut`. Rewrite the clerk around the fleet's `withdrawVisit` and
`decideTakes`, one stack a visit, and persist source, destination and intent. A fleet blueprint variant replaces the
panes with planks and accepts cobbled deepslate. Bounded chest crafting goes into `visitNeeds`. Port the siting domain
plumbing. The gate is as strict as the farm's, and the farm counts as open. Before any rollout, Paper scenes must prove
construction from fleet-like stock, label readback, mixed-chest sorting, ordinary withdrawal, a full or vanished
destination, abort and restart around every transfer, and death. Codex reads the clerk as **tier 3** under fun mode,
because it rests on behaviour nobody has seen work. Zero clerk executions cannot establish rollout readiness.

**Claude's reconciliation.** I agree with Codex on every gap; each one above was checked by name.

There is one difference of approach. The **smaller sorting mechanism is the showcase's sorted deposit, not the clerk.**
sortstore-01's `depositOrder`, `sortDepositTarget` and `withdrawPrefer` route each deposited stack to its section's home.
That is proven live (708 `_sort_deposit` rows), and it uses the deposit verb every fleet bot already runs. A hall whose
chests are registered town containers and preferred by section at deposit fills in sorted order with no clerk, no
cargo and no new transfer kind. The clerk (moving the old unsorted chests) is then a later piece.

So the pieces are:

| piece | what | tier | needs first |
|---|---|---|---|
| **H0** (showcase, small) | give the standing hall's upkeep a turn on the showcase (signs + one clerk move-set), so B runs live once | 2 | owner yes; the showcase lane |
| **H1** (fleet) | the hall on idle towns: blueprint variant (planks for panes, deepslate accepted), siting with the ring/stand domain, chest crafting in `visitNeeds`, the registry (`setTownExtra`), idle gate (the farm counts as open) | 2 (no protected file expected; confirm with `protected.py`) | the Paper construction scene from fleet-like stock |
| **H2** (fleet) | the sorted deposit + withdraw preference into the hall (sortstore's deposit routing), the labels | 2 | H1 kept |
| **H3** (fleet) | the clerk for the old chests | 3 (two engines) | H0's live rows, the Paper transfer scenes |

**Size.** H1 alone ports about 600 to 900 lines of showcase code from several pieces: storehub, storehubsite,
storehubstand, shopchest and the sortstore helpers, plus the blueprint. It is not a one-session piece with an honest
review and a Paper proof, so it was **not built in this session**. placebo-a has no proven site even with the showcase's
siting, so H1 would reach two of the three towns.

## 4. Queue placement

**treefarm-05: P lane.** It goes at the next P turn after idlework-01, ahead of pause30-01 and bamboowalk-01. It is the
only queued change that gives these three towns work. towngate-01 and stoneworks-01 are further back.

- **Claude's view:** this placement.
- **Codex's view** (the design round): run it as a normal canary in the three towns, not fleet-wide by env.

It is tier 2, so fun mode also allows owner-direct with a 60-min tripwire instead of the slot. Its default changes code
paths only where the gate opens.

**Draw.** board-b, hive-b and placebo-a: all 15 of the bots it can affect. **Every other pool cannot expose it** (the
gate is closed there), so a draw without them reads as unexposed. Fun-mode registrations do not apply
`draw_require_pools`, so the control session must pin the draw.

Notes for the read:

- The 01:33Z model switch (board-b and placebo-a to 7B; hive-b stays 4B) confounds rate DiDs such as explore and items
  per bot-hour.
- The primary line, treefarm `_build` rows, is 0 on control by construction.
- hive-b is in stuckproj-01 now. Its exclusion after that close may delay the draw. Two of the three pools (board-b,
  placebo-a) are enough for a first read.

**Storage hub:** H0 is a showcase decision for the owner. H1 goes on the fleet after a Paper construction proof, at the
P turn after treefarm-05's read.
