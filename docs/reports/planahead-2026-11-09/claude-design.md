# planahead-01: independent Claude design (2026-11-09; reply to design-brief.md -- blockers verbatim, sections 1-6 condensed)

## Blockers first: what would make plan-time reach wrong or harmful here

**B1. An optimistic planned world.** If the overlay treats other records' open cuts and clears as already dug, or their fills as already laid, the check invents stands that do not exist yet. The building then proves against ground that is never made, and you get today's `stuck_on_cell` again, but certified. Rule: other records' unfinished work may only take stands away, never add them.

**B2. A pessimistic overlay that hides stands that exist now.** If the tidy's 1,327 fills and 544 cuts count as hard obstacles when siting a building, the dense inwall stage removes most stands near X2-X5. `no_site` would rise on projects that already fail siting for other reasons. Hall and cottage1 fail on `domain` and `door_not_toward_home`, not on reach; this design does not fix those, and it must not add a third reason. So the tidy and land plan stay soft. They are kept out of the building overlay, and they yield to building stand claims, which is claim-01's split.

**B3. A plan negative believed on its own.** The replay's fixed point is not monotone: a fill adds a floor and also removes a node. So "unreachable at the fixed point" is a cheap negative. If it pre-waives cells, a wrong seed set, or a bot's pillar the walk doesn't model, silently deletes real work. A plan tag may only shorten the existing waiver's evidence. It must never replace it.

**B4. Three done-predicates that disagree.** "Done" for a tidy cell is decided in at least four places (`waivedK`, `progOpts.fillDone`, `prepDoneIn`, `recordCellDone`/`stuckStale`). Any new tolerance added to only some of them means the stage never completes, or completes with cells still open.

**B5. Claim plus waiver into a dead end.** A stand claim makes the tidy refuse a cell, and the tidy then waits on that refused cell. That is the CLAUDE.md trap: two correct guards that together leave no way out.

**B6. Cost.** A walk with radius 104 plus up to 4 fixed-point re-walks over about 1,900 cells runs inside the keeper's 180 s visit. It must yield to the event loop, have a budget, and fail open: publish as today and log `reach_unchecked`. It must never fail closed by refusing to publish.

## 1. Data model: the claim map
No new store. The claim map is derived on read from `projectHeads()`, the way `recordOwned()` and `buildingClaims()` already work, so it cannot go stale. Hard cells: every open record's cells, fill and clear for the building, wall, paths/road, monument, stepwell and sink kinds. Soft: the tidy and the land plan (they yield, as in claim-01). Stand claims: for every open record, each proof cell's `stand` (feet and head must stay passable; floor must stay). Release when the record completes or the cell is waived.

## 2. The plan-time check
Overlay (worst case): other hard records' open block-role cells are obstacles, never floors; their open cuts and clears keep their read and are never floors; soft records left out of a building's overlay. Buildings: `planned` options to `proveSite`, hooked in `siteBlueprintSteps`; a candidate on another record's claimed stand is rejected `stand_claimed` (the search moves on). Tidy stages: `planReach` before publish, yielding, budget 20 s, at most 4 re-walks; unreached cells tagged `pu`; more than 15% tagged or nothing checked -> drop the tags (`reach_suspect`).

## 3. Stand claims
Claim them, hard only against soft records, with an expiry: the tidy's entries on a claimed stand are `held`/given, never waited on (B5); building versus building at siting only.

## 4. Tolerance (Baritone)
One function for every done predicate (B4). okIfAir for sealed core/earth fills; skip for topsoil/lights/decor after one confirmed deferral; substitute unchanged; never structural roles. A `pu` tag only lowers the existing waiver's threshold to one live deferral (two independent negatives), why `plan_unreach_confirmed`.

## 5. Supply
Per-segment supply {open, reach, pu, held}; helpers take only segments with reach > 0; `pu`-only segments go to the keeper; `supply` on the visit row; `rec.reach = { at, open, pu, passes, checked }`.

## 6. First pieces, metric, rollback, risks
Showcase: planReach + pu tags on tidy stages, the fast waive, the helper supply filter (stand claims and the building overlay as piece 2). Fleet: the same tidy piece; the fresh-world day-0 land plan next. Metric: tidy stuck_on_cell + attempts_spent per 24 h, stage publish -> complete hours, helper_idle with supply > 0, false-negative rate of plan waivers. Rollback PLANAHEAD=off. Risks: the claim/held/completion chain (test the chain, mutant on `held`), plan false negatives (one live confirmation, the 15% raise), cost (budget, yield, fail open).
