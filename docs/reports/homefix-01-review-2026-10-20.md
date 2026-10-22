# homefix-01 — code reviews, Paper, read (2026-10-20)

Spec: `docs/reports/expansion-plan-2026-10-19.md` §2 (H1, H2a, H2b, the H2 contract, H3, H4) and §5 (E1), design approved by both
engines at r7; OWNER approved 10-19 (X1/X9), restart 10-20 ~12:00Z. Branch `homefix-on-9e7d998` (base = fleet 9e7d9980,
cobblekeep-01 KEPT + promoted). The previous agent's draft (3fe8cbbe, on adbec4f4) was cherry-picked clean onto 9e7d9980 and
treated as a draft: four other suites' stale anchors, the read, the registration, and every review finding below were done here.

## Reviews (Codex `codex exec`; independent Claude subagent). Final: BOTH APPROVE at 89818189 (code); the head adds records only

| round | sha | Codex | Claude |
|---|---|---|---|
| r1 | a149868f | CHANGE: P1 reservation expiry/replacement after acquire; P2 issue-time cooldowns not refunded; P2 home's deadline not through goto's rungs; P1 missing evidence could KEEP (unjoined G3, `readable` ungated); P2 respawn-censored G4 attempts filled D | CHANGE: P2-1 bot.pos rounding fakes G1/G1b defects; P2-2 owner loses the body to the in-flight run it turns away (rescue body_held); P2-3 coverage ungated; P3-1..9 |
| r2 | 85d2931b | CHANGE: P1 the r2 memory stubs defeat coverage (old-build bot counted); P2 ride-down inner timeouts | CHANGE: P2-1 same stub hole; P3 wrong_elevation climb direction; P3 roster message |
| r3 | ec3d88c0 | CHANGE: P2 ride-down dig budget checked before the equip | **APPROVE** |
| r4 | 89818189 | **APPROVE** (no remaining findings) | **APPROVE** (no new findings; residual: `bot.equip` has no timeout of its own, as on the base -- the budget check after it and the runner's hard stop bound it) |

What was done (commit messages carry the detail):
- **r2 (85d2931b)** runner: after the arbiter await a NEWER reservation makes the owner's attempt stale (grant released,
  `runner_reserved`), a run that set `current` meanwhile wins (`runner_busy`); a reservation that merely EXPIRED during the
  owner's acquire still starts the rescue — argued and accepted by both engines (no other run passes entry while it is live;
  once it lapses the arbiter refuses an equal-priority asker while the owner holds the body). One acquire retry after a
  macrotask for the shared-preemption race. H3 keeps the thrown message. cognitive: `refundDeclined` (prune, smelt_town,
  furnace_drain, build_plinth). skills: no goto recovery rung starts after `until`; `wrong_elevation` below sea level (and below
  home, r3) climbs; a climb that lands home is an arrival. watchdog: reserve_expired streak TTL (2 windows + pending bound).
  read: G3 terminal stand-in, `g3_unjoined` and `readable` (roster coverage) blocking, G4 censoring out of the denominator, EPS
  0.08 rounding dead zone, bound 260 s, Wilson lower bound REVERT + point-estimate block for reserve_expired, 20 s-handoff
  fixture, memory. Tests: `bots/test/homefix-r2.test.mjs` (21, each with an anchored mutant).
- **r3 (ec3d88c0)** read: `classify()` applies restart lag to every kept row; `silent` = no post row on the canary build.
  rideFloorDown: no placement / floor dig starts that `until` cannot cover.
- **r4 (89818189)** rideFloorDown: equip, then the budget check, then the dig.

Deviations from §5 as written (both engines accepted them):
1. The brain's outcome block skips per handler, not with one wrapper: the five decline-aware handlers (town order, town
   deposit, well, toolkit, recount) keep running because they REFUND the issue-time cooldown; the four others are refunded by
   `refundDeclined`.
2. G4's "`declined:reserve_expired` > 8%" is two lines: the one-sided 95% Wilson lower bound > 8% REVERTS (needs >= 4 of 20; a
   true 4.1% reaches that 0.8% of the time), the point estimate > 8% only BLOCKS KEEP. As written (point > 8% REVERTs at n = 20)
   a correct fix would revert ~20% of the time.
3. G3's old-code proxy uses < 150 s (the r6 table), not the < 165 s of the older paragraph.
4. `change_rows: ["watchdog_rescue"]` WITHOUT the underscore: verdict.py (:531, :546, :593) and changerowcheck.py compare
   `skill.name.lstrip('_')` with the raw set. **Finding for the coordinator:** registrations that declare underscored names
   (`cobblekeep-01`: `_lid_clear`, `_well_dispose`; `bagbudget-01`: `_bagbudget`, `_town_deposit`) never match a death window, so
   their single-death linkage is dead, and changerowcheck prints "ok — baseline silent" for them vacuously.
5. G4 censors (excludes) an attempt with no terminal when the bot respawned (`_cobblecap_mode`) inside the bound.
6. The S0 filter in the read is an approximation, reported only.
7. Added beyond §5 by the reviews: `readable` (every enabled canary bot has a post row on the canary build), `g3_unjoined`,
   the rounding dead zone, the rideFloorDown / recovery-rung budget, `wrong_elevation` climbing.

## Paper (sandbox only, 10.0.0.30; base 9e7d9980 on sandbox3, candidate on sandbox4; lock taken per batch, released)

Results: `docs/reports/homefix-01-paper-results-2026-10-20.jsonl` (21 rows; outcomes from the world via RCON `data get
entity` and from the runner's own rows). Driver: `sandbox/home/homefix-e2e.mjs`.

| scene | base 9e7d9980 | candidate (a149868f-equivalent r1; 85d2931b r2) |
|---|---|---|
| P1 home 24 out, chests on the home cell | failed/travel_incomplete "closed 22 blocks toward home, 3 still to go" at 2.72 | success at 2.72 (both runs) |
| P1 home 5 out | success via goto's own result ("arrived", the `return last` path) | success |
| P1 start inside the radius | unknown/no_measurable_change | unknown/no_measurable_change (correct: the evidence gate) |
| P3 entombment reflex during home -> surface at y 40 | failed/skill_error "The goal was changed before it could be completed!", consecutiveFailures 1 | aborted/interrupted (detail keeps the throw), consecutiveFailures 0 |
| P0 2 s unwind + livelock rung | rung runner_busy; rescue runner_busy, never ran (no rows) | rung runner_reserved; requested -> started -> completed:success; relocated 56 / 60 blocks |
| P0 25 s unwind | runner_busy, never ran | declined:reserve_expired; level held (escalation 0), 180 s backoff |
| P2 creeping rescue in a barrier corridor | the rescue never starts (H2a) | creep ran its full 180 s uncut (tick_seen), level 2 home on the rescue's own window (window_from after the reset), r2: level 3 -> `reconnected` row |

r1b's P2 candidate went 1 -> 2 -> 1: the level-2 home rescue's dig retry dug the corridor's stone floor and the watchdog read
the picked-up blocks as progress (correct watchdog behaviour); r2 gave the corridor a barrier floor and reached level 3. The
r3/r4 changes (read script, ride-down budget, wrong_elevation from below) do not touch the paths P0-P3 exercise.

## Read (`scripts/host/homefixread.py`, installed `~/mcai-analysis/homefixread.py`)

`--selftest` passes (D: G1 2, G2 5 or the mix's own (home-only 15), G3 8, G4 20; fixtures G1b / G3 (4 defective incl. a full
20 s handoff, 3 good) / G4; rounding; Wilson; coverage classification). Dry run on the fleet host (pretend canary hive-c,
placebo-b on base code, +180, 1.66 M rows walked, 97-105 s, 427 MB RSS): positive controls G1 pre-period 7-9 defects in as many
opportunities, G2 pre 44-45, G3 historical proxy 28-29 of 226-228 (12-13%; §5's 34% was on the old 1,565-row denominator),
fixtures pass; G2 finds 11-12 of 12-13 post defects on the old code; coverage: 0 silent with the build the pools run, 10 of 10
silent (readable 0) with a build they do not. Pre-deploy guards on the host: changerowcheck `watchdog_rescue` baseline silent;
licencecheck `_watchdog_rescue` 0 baseline rows / 6 h; drawexposure 11 pools eligible (stagnation >= 20, home >= 5 per 12 h).

## Tests and lint

`node scripts/run-tests.mjs` (bots/): **271/271 files passed, exit 0 at 89818189** (also at ec3d88c0). eslint no-undef on bots/src:
exactly one hit, the pre-existing `reflex.mjs:2384 withinBody`. New suites: `homefix.test.mjs` (33), `homefix-declined.test.mjs`,
`homefix-r2.test.mjs` (21), plus H4 cases in `ride-floor-down.test.mjs` (29 in all); every mechanism has an anchored mutant seen to
fail (helpers/mutant.mjs or the suite's own withMutant: present AND unique).
