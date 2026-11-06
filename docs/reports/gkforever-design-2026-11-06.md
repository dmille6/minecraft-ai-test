# gkforever: the grounds never run out (design, 2026-11-06)

## Owner, verbatim

- 11-06 ~04:00Z: "there should always be projects the bots can work on, at the very least they can be greens keepers and clean
  up the town then branch out and clean up the area outside the town, leveling the ground, filling in holes, cutting down trees
  that make it difficult for travel."
- 11-06 ~04:30Z: "for the grounds keepers, i really want the area inside the town walls beautiful, clean, no holes, pits or
  unlevel ground, it can clean up and add hills, etc, they can always decorate paths with flowers etc. outside the town walls
  when the town is clean they can clean up the country side the same way making it beautiful accessable, and easy to travel.
  beautiful and level ground with hills mountains etc."
- Earlier specs (memory owner-groundskeeper-1102, owner-gk-town-clean-1104, owner-townterrace-1103, owner-siteprep-1104):
  inside the walls first; terraces (steps <= 1); no holes; no bot dirt steps or pillars; pick up drops; then outward ring by ring;
  trees kept, or felled and replanted; "I want them to stay busy". No admin edits.

## Measured (fleet 4f3b0f5c)

24 h full walk, 11-05 04:10Z to 11-06 04:10Z (`lib.telemetry`, 1,514,167 rows, 80 of 80 bots, 1,920 bot-h). Script:
`scratchpad/gkf/tidyread.py`; records `scratchpad/gkf/recs.py` (latest record file per town under `/var/lib/mcai`).

| | value | out of |
|---|---|---|
| all build visits | 3,980 visits, 54.9 bot-h | 1,920 bot-h |
| monument (positive control) | 2,558 visits, 48.5 bot-h, 5,048 placed | |
| **tidy** | **1,099 visits, 3.0 bot-h, 363 placed, 89 cleared** | 16 towns: only 4 had a tidy visit |
| tidy visits on two dead cells | 969 (hive-d 418 `attempts_spent` on one fill, placebo-b 516 `blocked` on one oak_leaves clear) | 1,099 |
| tidy record COMPLETE | 9 towns (completed 1-82 h ago) | 16 |
| tidy record open | 2 towns (board-d, hive-d: both on dead cells) | 16 |
| no tidy record at all | 5 towns (board-a, board-c, hive-c, placebo-d, isolated-d) | 16 |
| hourwatch 03:57Z | lap 81% of bot time (64.9 of 80.0 bot-h); 10 of 16 towns with no workable project | |

**Why it runs out.** `tidy.mjs` surveys a 65 x 65 square once (bot spoil pillars >= 2 high, pits >= 2 deep and <= 3 x 3, the
paths' corridors graded), then the record COMPLETES and is surveyed again only after `TIDY_RESURVEY_MS` = 48 h. Most candidate
pits are skipped (`pit_tree`, `pit_shallow`, `pit_wide`, `pit_guarded`); one-deep holes and one-high steps are never work. It is
LAST in `PROJECTS`, so only a bot at town with nothing else open is ever ordered to it. Five towns never reach it because the
first open project cannot be sited (idlework-01 piece B fixes that). groundskeeper-01 (queued) adds the outward stages (town ->
ring road + spokes -> bands to 80) and one keeper a town, but its last stage completes too (48 h wait) and the keeper is the
tidy's only builder.

## Codex's independent design (codex exec, read-only; given the measurements and the goal, not this design)

Full text: `scratchpad/gkf/codex-design-out.txt`. In short:
1. A permanent per-town service record (`groundswork.mjs`), separate from the tidy: 8 x 8 survey tiles, a cursor, dirty tiles,
   a task queue, deferred defects; states ready / survey_due / clean_until / blocked; never complete. The interior first, then
   16-block bands from the wall to 128. Cadence: dirty tiles at once, interior audit 30 min, exterior 4 h, decoration 24 h.
2. Crew: `min(2, ceil(idle/3))` grounds workers a town; a `grounds` batch in idle_work (<= 8 min), 2-min task leases, a 2-column
   margin, fairness by least grounds time; no 10-min shop cooldown, no workshop prerequisite, no 48-block rule.
3. Tasks in order: travel traps and holes (add one-deep defects), bot spoil, smoothing (5 x 5 terrace target, +-2 per column, 64
   ops a task, persisted targets so hills are never flattened), vegetation (leaves first), decoration (one flower per 4 path
   blocks). Drops opportunistically within 8 blocks.
4. Dead cells: two failed visits defer the task (not the town); failure evidence survives re-surveys; one retry after 24 h.
5. Measures: hole count/volume, spoil columns, adjacent steps >= 2, route cells with steps <= 1, decorated cells; lap share, towns
   without work, value per bot-h. Keep construction availability visible so a permanent record cannot clear goalwatch falsely.
6. First shipment: interior only, one worker, default off. Supersede groundskeeper-01's scheduling; defer its road network.

## Reconciliation (what we build and why)

| question | Codex | Claude | chosen |
|---|---|---|---|
| engine | a new service record | the tidy record + groundskeeper-01's stages (brief: no third engine) | **tidy record**: a stage is a generation; the visit, leases, waiver, layered fills and stand checks are reused unchanged |
| never complete | service state, tile cursor | a clock on the record | **clock** (`gkfDue`): next band at once; interior audit first every 30 min (Codex's number); the ring order again 30 min after the last band (was 48 h) |
| radius | 16-block bands to 128 | groundskeeper-01's to 80 | **128** (`gkfLand`: three more bands) |
| dead cells | evidence survives re-surveys, retry after 24 h | | **adopted**: waived cells carried into every later generation for 24 h (`gkfDeadCarry`, `dropDeadSurvey`) |
| one-deep defects | add them | add them, inside the walls | **LEVEL** (stage 0): a lone one-high step of bot material cut; a one-column hole below all 8 neighbours filled. Terrace edges and slopes are not defects (tested) |
| crew size | min(2, ceil(idle/3)) | | **2 builders a town** (keeper + 1 helper): Codex's number for a 5-bot town; the slot is the admission |
| idle mix | alternate with gathers | grounds before gathers | **alternate** (`IDLE_ROTATION_GK`: grounds, iron, grounds, logs, grounds, coal, grounds, scout). Grounds has no item value; the slots cap it at 2 a town, so 3 of 5 bots still gather; no grounds work -> the next gather |
| batch | <= 8 min | | **3 visits that changed the ground, or 8 min, or one no-work visit** (then the kind is barred 30 min) |
| order path | own admission, no 48-block rule | keep the build order (at town) | **build order**, at the keeper's 2-min cooldown while the lap is open; travel home is the lap's hint (`home`) |
| workshop prerequisite | drop it | | **dropped only when the workshop is unsited** (board-c); a town still builds its first workshop with every bot |
| roads | defer groundskeeper-01's network | keep (offline: road columns walkable 17.6% -> 40.6%) | **keep**, behind its own `LANDPLAN=off` |
| goalwatch | keep availability honest | | an open tidy record lists real cells; between audits it reads complete (honest "nothing to do") |
| decoration, smoothing to terraces, ravines, drops | later pieces | later pieces | **deferred** (pieces 2-4 below) |

## Pieces

1. **gkforever-01 (fleet, tier 2: `protected.py --base 3690e867` = not protected)**, built on **decbundle-01 3690e867** (it
   composes with idlework-01's rung and its unsited yield) with **groundskeeper-01 ported under it** (47d89af2 + dc934b06;
   stationkeep-01's sweep left out: it is its own queue entry). Each part its own switch; `GKFOREVER=0` = groundskeeper-01:
   `GKF_CLOCK`, `GKF_DEAD`, `GKF_LEVEL`, `GKF_CREW`, `GKF_IDLE`. A `_grounds_census` row on every new generation (holes, dips,
   pillars, listed fills and cuts, dead carried, the interior's roughness).
2. **decorate (fleet + showcase)**: a stage after the bands for path-edge flowers, reusing decorator-01..03's flower sourcing
   (the bone-meal nursery, kept flowers, ferns with shears) and its tripwire rules DC1-DC5; one flower per 4 path blocks (Codex),
   never re-placed while healthy. This is what makes the interior's upkeep never empty.
3. **smooth (terraces and walkable slopes)**: Codex's 5 x 5 terrace target, +-2 a column, 64 ops a task, targets persisted so a
   hill is never flattened; outside the walls only on travel lines (ramps instead of cliffs); "never worse" walk check.
4. **countryside traps**: dry ravines and holes on travel lines filled bottom-up within a material budget; travel-blocking
   trees felled and replanted (groundskeeper-01's replant already does roads).

## Effect (registration)

Primary: tidy placements per bot-h up (`detail.rate.v1` `_build:tidy:place`, baseline 391 in 24 h fleet-wide = 0.20 per bot-h).
Also: tidy clears up; productive share of bot time up. Guardrails: items per bot-h (value not worse), deaths, the tidy's
`blocked` visits not up. Own lines: the lap share on the canary pools (hourwatch's charging), canary towns with no workable
project (target 0), the census holes + dips and the interior's rough share (d2/pairs) falling across audits.

## Paper / mineflayer facts this rests on

Nothing new: digs and placements go through `runVisit` exactly as tidy-01 and groundskeeper-01 (KEEP / reviewed) do; the
one-deep fill and the one-high cut are the same operations at depth 1. No sandbox proof is needed for piece 1. Piece 2 rests on
the decorator's Paper proofs (proof2 6/6, proof3 4/4).

## Built (piece 1)

Branch `gkforever-01` @ `f428e5dc` on decbundle-01 `3690e867`. Codex r1 (blockers only): 2 BLOCKERS -- an old crew visit could
complete or waive a newer stage (now fenced by `tidySameGen`; a visit is complete only when its own generation is) and a road light
given up on was listed again (now filtered by the dead carry); r2 BLOCKERS none. Tier 2 (not protected). `bots/test/gkforever.test.mjs`
30/30 (behaviour, the composed refusal chain, 8 anchored mutants, wiring). Full suite ci2 (git context) **403/403 files passed**.
Registration and draft queue entry: `docs/reports/gkforever-2026-11-06/`.
