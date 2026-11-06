# Code evaluation, 2026-11-06: why the bots stall and what to change

Owner, 11-06 ~02:45Z: "what can we do to stop all these long delays and stalls and keep bots working? ... is this time for a
full code evaluation and refactor?" Owner chose: **full code evaluation first**.

The evaluation was read-only and covered six areas. Each area had one Claude agent with measurements and one independent Codex
evaluation (Codex was given the area and the evidence, not the conclusions). The area reports in this folder hold the evidence:
- [decision.md](decision.md): how a bot picks what to do next.
- [skills.md](skills.md): the build engine and project modules.
- [survival.md](survival.md): reflexes, movement and pins.
- [pipeline.md](pipeline.md): the canary pipeline and the watchers.
- [showcase.md](showcase.md): showcase releases and the tripwire.
- [tests-process.md](tests-process.md): tests and the development process.

Code was read at origin/main `bd2c308f`; the fleet was at `4f3b0f5c`.

## Verdict: no rewrite. A partial refactor in four places, after a week of targeted fixes.

**All six areas, on both engines, said "partial refactor".** No area recommends a rewrite. The engines that work stay:
- the build engine and its record and lease layer;
- the movement primitives and the escape planners;
- the scheduler's decision core;
- deploys and the death tripper;
- the canary reads (55 runs: 50 KEEP, 3 INCONCLUSIVE, 1 REVERT, 1 not yet decided);
- release gates and snapshots;
- the test runner and the anchored mutants.

The stalls come from **policy and ownership**, not from those engines.

## The five root causes (across areas)

| # | Root cause | Evidence (denominators in the area reports) | Areas |
|---|---|---|---|
| 1 | **Alarms with no owner and no action.** Detection mostly exists; nothing acts on it, and some pages are never sent | The canary slot was idle 101 of 338 h (30%); 7 of the 8 long gaps ended only when a human typed a command, and 6 of the 8 began overnight. 71 scheduler pages sat in `page.jsonl` and were never pushed. Pins of 4 h or more on the fleet came to about 700 bot-h in 14 days and were listed every 30 min, never pushed. goalwatch has flagged isolated-c stuck since 11-02. The showcase restack alarm repeated for 45 h. The value drop was caught a day late. `alarm.py` marks a failed push as sent | pipeline, survival, skills, showcase, decision |
| 2 | **Work selection idles instead of choosing other work.** The ladder plus "first open project", with 24 h / 6 h holds per bot | Over 3 h, the idle lap took 83% of bot time and productive work was 8.4%. 7 of 16 towns had no workable project. A project that fails to site holds the bot for 24 h and the picker never tries the town's next project. Only 35% of town needs get a bot within 60 min. Value fell from 16.14 to 9.90 per bot-h on 11-05 | decision, skills |
| 3 | **Retry holes and dead ends: "two correct guards compose into a dead end", over and over** | Seven oak-leaf cells took 7,750 of 7,775 failed clears in 24 h: the failure never reaches the stuck count, so the cell is never skipped. Pins took 3.8% of fleet bot-h, and 57% of that is one dead end (the flood guard plus every other exit refusing). Five modules define "usable pickaxe" differently (Gale 22 h, hive-c-Bravo). The stuck reflex kills 75% of aborted build visits, because the build engine doesn't mark its waits as intended | skills, survival |
| 4 | **The pipeline waits on humans and on itself** | A change takes a median 21.8 h from first commit to fleet promotion; the canary itself is 3 h. Promotion to main takes a median 18.4 h. Autorebase refused 11 of 19 jobs, 6 of them mechanical. One orphan-list file causes 10 of 12 merge conflicts. 121 of 152 ci2 runs show red on the same 3 copied-tree tests. 46% of canary runs were unprotected changes that could go owner-direct. Built fixes wait: vetoremedy/repeatwork/depositoffer since 11-03 (about 47% of decision time); showcase gksweep/gkunblock/outbands unstaged for 1–2 days | pipeline, tests-process, decision, showcase |
| 5 | **The showcase stops the world for everything, and it is a fork** | 12 tripwire stops in 14 days, 8 of them false; 9.7% downtime (about 352 bot-h), 85% of it two overnight waits for a human. The per-project rules grew from 58 KB to 217 KB in 10 days. 98 of 117 showcase commits are not on main. The showcase is 8 fleet KEEPs behind, and its restack has been in conflict for 45 h | showcase |

## The plan

Each phase is gated on the previous one reading KEEP. Gains come from the area reports' measurements: they are estimates, not
promises, and every piece carries its own effect target.

### Phase 0: ship what is already built (now to 1 day)

1. **idlework-01** is queued behind stuckproj-01. It replaces the patrol lap and moves return ahead of deposit. Target: a large
   share of the ~1,600 lap bot-h a day.
2. **Pull the decision bundle forward**: vetoremedy-01, repeatwork-01 and depositoffer-01, with the `#N` id fix
   (`admission.mjs:432`). Together they target about 47% of decision time.
3. **Release the stale showcase pieces**: gksweep-01, gkunblock-01, outbands-01.

### Phase 1: an autopilot and a pager (2–4 days; host tooling, no bot risk)

1. **The scheduler recovers on its own:**
   - skip a blocked head, but never past one that something waits on;
   - release a dead install-hold only after checking that the bots are back on the baseline;
   - recompute patch hashes, and never hand-set them;
   - page only when nothing in the queue can run.

   Worth about 46–60 of the 101 idle hours.
2. **One pager with tiers and acknowledgements:**
   - scheduler and rollout pages go through `alarm.py`, with delivery checked;
   - slotwatch fires on "no canary for 60 min", keyed by cause;
   - pins of 4 h or more are pushed;
   - goal and flow alarms go to a daily digest unless a whole town is blocked;
   - add hourly checks for value per bot-h, the lap share and the count of towns with no workable project.

   The 11-05 drop would then show in about 2 h rather than a day.
3. **Pipeline throughput:**
   - Build the next variant during the current canary's read, on ci2 or .30.
   - Open the owner-direct lane for tier 1/2 changes, with the existing 60-min check.
   - Stop the orphan-list conflicts: `merge=union` now, then one required-paths file per change.
   - Make green mean green: ship git context to ci2 or report those 3 tests as SKIP, keep a flake list with owners, and fix the
     suite-run tar deadlock and add deadlines.
4. **Showcase:**
   - A trip within 3 h of a new release rolls back automatically.
   - Mismatches with the plan are reported, not stopped on; deaths, breaches and trapped bots still stop.
   - A planned restart clears a stop.
   - Each release replays its own rows through the tripwire before activation; that alone would have caught both 11-05 trips.
   - Remove the follower's ROLLBACK output and the always-on WATCH noise.

### Phase 2: close the retry holes and dead ends (about 1 week; behaviour, protected scope = two engines + a Paper proof)

1. **Close the build retry hole.** Every cell that keeps failing feeds the stuck count, then is deferred, skipped or backed off,
   for every project by default. Worth about 22 bot-h a day, and isolated-c, placebo-b tidy and others move. This replaces
   tidydead-01.
2. **Never idle on a blocked project.** Take the town's next eligible project in the same order call, and break on K identical
   empty visits. stuckproj-01 (canary now) and idlework-01 part B start this.
3. **Break the escape dead ends:**
   - a flood-in breach after 30 min pinned with full air and health of 18 or more;
   - one "usable pickaxe" rule, so a pinned escape may spend the last swing;
   - protected-zone depth from the terrain surface.

   Worth about 35–45 fleet bot-h a day.
4. **Mark the build engine's intended waits,** so the stuck reflex stops killing visits. Worth about 8–9 fleet and 7 showcase
   bot-h a day; confirm the cause case by case first.

### Phase 3: the four structural refactors (2–4 weeks, staged behind flags, one piece per canary)

1. **A town work board.** It replaces the sustaining ladder, the first-open picker and the at-town order step. Towns publish
   concrete tasks with per-project back-offs and fairness by waiting time, and bots claim them. Start by turning the
   job-assigner shadow (jobshadow-01) into a writer.
2. **A shared project registry.** Each project kind supplies only its geometry; one module owns ordering, visit rows, the stuck
   fixes and completion. Move the ~4,000 build-visit lines out of `skills.mjs` one kind at a time. Drive the showcase tripwire's
   generic area rule from the same registry.
3. **A body lease and escape controller.** One owner of the bot's body replaces 4 mechanisms and about 68 flags in `reflex.mjs`.
   One "pinned for N min" clock drives escalation, and the trap planners become its moves.
4. **The showcase onto main behind per-pool flags,** after a one-time hand restack of the 8 pending KEEPs, so the fork and its
   restack conflicts go away.

**Not recommended:**
- a mechanical split of `skills.mjs` (22,286 lines), which is risky and wins no bot time on its own;
- a rewrite of the scheduler, the build engine or the movement primitives.

Do delete dead code: about 225 of the 343 `scripts/host` files are unreferenced; the generic `build` skill (0 runs in 24 h);
the dead arbiter in `reflex.mjs`; and lab-mode branches that fun mode no longer uses. Commit or retire the uncommitted
`~/fleetstatus.py` on .31, which differs from main by 1,016 lines.

## Where the engines differed (and what we chose)

- **Decision.** Codex rated patrol removal as large and high-risk; it did not know idlework-01 exists. Phase 0 ships that.
- **Survival.** Codex would do the body-lease refactor first. We fix the three measured dead ends first: three pins hold 44% of
  pinned time.
- **Pipeline.**
  - Codex rates skipping the head as riskier; we narrowed it to listed blocker types.
  - Codex wants one shared test-job service first; we move the autorebase suite to ci2 first.
- **Showcase.** Codex would keep per-release rules bound by a replay. We do both: the replay, and stopping only for harm.
- **Tests-process.** Codex missed the unused owner-direct lane: it read the tier table rather than the journal.
