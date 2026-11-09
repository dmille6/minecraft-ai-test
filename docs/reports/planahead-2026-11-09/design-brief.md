# planahead-01 design brief (for Codex and an independent Claude reviewer; 2026-11-09)

OWNER 11-09: "do 1,2,3" from docs/reports/minecraft-ai-landscape-2026-11-09.md section 3. This is idea #4 (+ #5):
**plan the whole town ahead**, the way the GDMC 2022 winner (arXiv 2309.10871) does: a shared land-claim map of every
record and plot, roads first, every cell of every planned build checked at PLAN time for reachability from a planned stand
with the town's own walk model, builds whose cells cannot be reached moved or reshaped before anything is placed, and
Baritone-style tolerance (buildSubstitutes / buildSkipBlocks / okIfAir) for cells that become unreachable later.
Goal: PREVENT stuck projects instead of patching them afterwards (today: stuckclose-01, stuckfleet-01/02, gkclear, gkleft,
stallWaive, wallWaiveDue, pathWaiveDue, tidydead -- every one a retroactive waiver).
Scope given by the coordinator: plan-time reachability and SUPPLY (reachable work for the crew). NOT the current slow-fill /
full-bag bug (another agent has it).

Repo: worktree /Users/darrellmiller/Documents/.wt-planahead (branch planahead-01show on the live showcase release b9fa002e).
Read first: CLAUDE.md, bots/src/buildsite.mjs (walkFrom, stepFor, proveSite, siteBlueprint -- the building tier already
PROVES a candidate's cells reachable at siting, but against the world AS IT IS NOW, alone), bots/src/buildrun.mjs (digStand,
runVisit), bots/src/landplan.mjs (planLand: ring road + spokes routed FIRST at stage 0, walkReach), bots/src/tidy.mjs +
roughground.mjs + terrace.mjs (the tidy stages: 2,601 fills + 1,098 cuts on the showcase's inwall stage, no reach check at
siting), bots/src/wall.mjs wallExtPlots (the extension plots X2-X5 the cottage/town hall/enchantshop are sited on, each at its
own turn), skills.mjs townhallSiteFor / cottageSiteFor / recordOwned (claim-01: a sited building owns its volume; the tidy
yields), buildTidyVisit (the tidy's publish of a new stage, its `waived` map read as done everywhere).
Prior designs: docs/reports/town-plan-2026-10-20.md, docs/reports/freshworld-playbook-design-2026-11-06.md (fresh-world
day 0: block out, prep 2 plots ahead), docs/reports/stuckproj-design-2026-11-05.md.

## Measured (read-only, 11-09)

Showcase, 7 d (11-02 00:03Z .. 11-09 12:28Z, 14-15 bots, 7,004 project build visits):
- no_site visits: town hall 176 (ALL its visits; 7 days unsited: "no proven site [domain, door_not_toward_home]" on plot X2),
  cottage1 88 (same reasons), reroof 69 (roof not proven: leaves/logs/lanterns in cells), road 60 (proof_unreachable,
  start_liquid), cropfarm 57, storehub 44, shrine 30, dress 24, enchantshop 14, tower 12.
- stuck_on_cell visits ("N cell(s) no stand has reached in K+ visits"): tidy 130 op rows / ~30 visits, hall 25, house1 16,
  monument 12, enchantshop 8, tower 7 -- buildings that were PROVEN at siting and lost their stands later.
- OFFLINE REPLAY of the current world (region copy 13:10Z, the bots' own walkFrom/stepFor/digStand, seeds = 35,016 stood
  cells, walk radius 104, every open cell worked in any order to a fixed point, the world overlaid as it goes):
  | record | open fills | open cuts | no order reaches: fills | cuts |
  | tidy inwall stage | 1,327 | 544 | 88 (48 core, 31 earth, 4 topsoil, 2 light) | 7 |
  | tower | 6 | 144 | 4 (lights) | 15 |
  | cottage1 | 2 | 50 | 2 posts | 0 |
  | stepwell | 96 | 1,483 | 10 (5 under, 5 stand) | 0 |
  So ~5% of the tidy stage can never close (it will wait on waivers), but 95% IS reachable.
- Crew (part A of this task, 11-08 13:49Z..11-09 13:05Z, 1,396 min): the tidy stage had nobody in a visit 74% of minutes;
  helpers' visit time with 0 ops 54% (53 of 133 helper visits end "nothing of the grounds is this helper's now (deadline)").
  Since 95% of open cells are reachable, the idle time is mostly NOT unreachable cells (walk/draw time -- the other agent's
  fill bug); plan-time reach removes the dead 5% (stage closes, no waiver lag) and lets a helper's supply be counted honestly.

Fleet, 7 d ES (29,034 _build_visit rows, 80 bots, 16 towns): stuck_on_cell 780 (tidy 558 in 13 towns, monument 162 in 12),
attempts_spent 1,358 (tidy 1,148), cell_deferred 266 (tidy 191 in 16 towns), no_site 806 (monument 439 in 3 towns, shop 174,
wall 126, house1 67). The fleet has no cottage/town hall/wall extension; a fresh world (finish-line M2 test) runs land plan,
tidy stages, monument, shop, house1, wall, paths, shaft from day 0.

## Constraints
- Fun mode tiers (`python3 scripts/lib/protected.py`); showcase piece first on b9fa002e, fleet piece on the live fleet sha
  bcdba35f. One-setting rollback per piece (PLANAHEAD=off). New project kinds declare an effect metric.
- Never assert decision logic by text; pure exported functions tested; anchored mutants.
- The tidy's `waived` map, the claim-01 rule and the tripwire (shopread H/G rules) already exist: re-use, do not fork.
- Cost: siting runs inside a bot's 180 s skill budget (siteBlueprintAsync slices 40 ms); a whole-town proof must be sliced
  or cached, never block the event loop.

## What I want from you (one design, <= 1,500 words, concrete)
1. The data model: the claim map (what cells/columns, which kinds hard vs soft, where stored, how kept fresh).
2. The plan-time check: "reachable in the PLANNED world" -- what overlay (other open records' cells as placed/dug?), what seeds,
   what order; how a candidate is moved or reshaped; which projects first (showcase: cottage2/3, town hall, landmarks, roads,
   tidy stages; fleet: fresh-world day 0).
3. Stand claims: should a proven building's stands be claimed so later projects cannot occlude them? How hard?
4. Tolerance (Baritone): which roles may substitute / skip / okIfAir, and when; how it composes with existing waivers.
5. Supply: how the crew gets only reachable cells, and a supply number the effect metric can read.
6. The smallest first piece for the showcase and for the fleet, the effect metric, the rollback, the top 3 risks
   (especially "two correct guards composing into a dead end" -- CLAUDE.md).
Blockers-first: say what would make this design wrong.
