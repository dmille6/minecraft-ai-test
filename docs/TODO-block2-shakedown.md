# Block 2 shakedown — the queue

Items 1 and 2 (deploy the fix backlog; entrapment) are under active analysis and
are NOT in this file. This is the parked work: real, specified, and deliberately
not started, so it does not get rediscovered from scratch a third time.

Nothing here should begin before the measurement instruments are honest, and
nothing at all should begin the measurement clock. See
`docs/design/2026-08-28-board-arm-noncompliant.md` and
`docs/design/2026-08-28-board-repair-proposal.md` for the two board documents.

---

## 3. Resolve the hive direction — BLOCKING, and it blocks by waiting

**The question.** Hive pools freeze at 55% against 20–30% elsewhere; exact
permutation over all 1,820 assignments of 4 of 16 pools, **p = 0.0137**. Hive has
the *smallest* within-arm spread (20%) and its worst pool beats ten of the twelve
non-hive pools, which is what an arm effect looks like rather than one bad world.
Hive avoid-rules carry **45.6 failures each** against 7–16 elsewhere, because five
bots hammer one pooled entry and the admission gate weights by `fails`.

**What is not known.** Direction. A frozen bot emits ~2,000 failures per two
hours into a shared store, so freezing may PRODUCE the weight rather than follow
it. Rule ages hint rules-first (hive median 5.1h vs 2.9–3.1h; 13% predate the
freeze window vs 2–4%) but 87% of hive rules are younger than the freezes they
would have to explain. That is not evidence.

**Why it blocks.** If shared memory causes the paralysis, that is the Zollman
effect showing up in shakedown and it is the headline result — "fixing" it
destroys the finding. If freezing causes the accumulation, it is a confound that
must be removed before any block runs. **The same observation demands opposite
actions depending on an answer we do not have.**

**Status.** `scripts/store-sampler.py` installed 2026-08-29, systemd timer every
5 minutes, snapshotting all 97 stores with per-rule identity so "a new
prohibition appeared" is distinguishable from "an existing one was hit again".
Needs days, not hours.

**Analysis when the data exists.** Discrete-time survival model, unit = bot
interval, outcome = first transition into immobility, predictors = lagged pooled
and private avoid-rule counts and weights at t−15m/30m/60m/120m, conditioned on
recent failures and recent movement, with pool as a random effect. n=4 pools per
arm will not grow, so pool-level permutation remains the primary test and the
model is for effect estimates, not p-values.

**Falsifiers, pre-registered.** Hive excess concentrated in one or two pools;
within-arm spread as large as between-arm; prior rule exposure failing to predict
freeze onset once current failure state is controlled; immobility beginning
before the memory differences emerge.

**Do not:** intervene on entrapment in hive pools while this is open. That is
the natural experiment.

---

## 4. The board arm is not administering its dose

**Measured.** The `board` skill ran **10 times in 8 days across 20 bots**;
`board-d` zero. 48 claims exist, all in one pool, from two reporters, three at
quorum, **8 expired against 3 adopted**. Because `lessons.mjs` pools only for
`scope === 'shared'`, a board bot's lessons are private and the walk is the only
sharing path — so board is behaviourally **identical to placebo**, and two of
four rungs of the dose ladder are one rung.

**Three causes, ranked by measurement.**
1. **Price.** Median distance to the board is **881–1,195 blocks** — a ~40 minute
   round trip against a 30-second decision cadence. A bot declining that for 48
   prohibitions it cannot see is behaving correctly. p10 distance is 57–85
   blocks, so bots are near town a tenth of the time: the price does not need
   abolishing, only to be payable when it is already cheap.
2. **The board holds only prohibitions.** `pendingReports()` iterates
   `lessons.data.avoid` and nothing else. All 48 claims are `kind: "avoid"`. The
   designed `worked` / `sighting` / `hazard` tiers were never built.
3. **No scent.** The model's entire view is one static usage line. Stigmergy
   works because the mark is perceptible from where the agent already stands;
   this lectern can only be perceived after paying the full price of reaching it.

**Repair** is specified in `docs/design/2026-08-28-board-repair-proposal.md`:
R1 endogenous board count, R2 one arm-symmetric `MEMORY STATE` line, R3 three
more claim kinds with quorum and TTL. **R2 without R1 buys legibility, not use** —
an honest agent shown `sync_distance=1194` still declines, correctly.

**Also broken, found later and not yet in the proposal:**
- The **placebo arm's board visits emit no telemetry at all**. Placebo ran the
  skill **26 times to board's 10** — the control has *more* activity — and
  produced zero events, because the checkpoint branch never reaches the logging
  call in `board-visit.mjs`. The arm that isolates travel-and-ritual from sharing
  is unobservable.
- **`board.carried_ms`**, whose own comment says "this IS the treatment", exists
  on 83 records and is read by nothing anywhere.

**Constraint.** R2 touches all four arms' prompts, so it is a fleet-wide
treatment change, not a one-pool canary, and it needs its own shakedown. If any
arm gets a feedback line, all arms get structurally equivalent ones — otherwise
it becomes an allocation-of-cognition treatment and contaminates the comparison
it exists to enable.

---

## 5. One bot-hour definition

Four scripts compute exposure four incompatible ways, none convertible to
another, so **no two reports have ever been comparable**:

| script | definition |
|---|---|
| `canary-baseline.py` | `(last_ts − first_ts) × bots_seen` |
| `freeze-verdict.py` | wall window × bots that died *(fixed 2026-08-29)* |
| `water-report.py` | hardcoded **40** × span of the measured events only |
| `canary-report.py` | 5-minute buckets in which the bot moved ≥8 blocks |

Two are outcome-contaminated by construction: `freeze-verdict`'s divisor was
casualties, and `canary-report`'s movement gate is moved by any mobility change
under test. Two are stale for an 80-bot fleet: `water-report` printed **every
rate 2× too high**, and `shakedown-gate.py` still expects 40 bots, so it is blind
to 50% mortality.

**The fix** is one shared exposure function: a bot contributes time whenever it
logged anything, derived from a roster, never from the outcome. Then a
death-rate query with zero deaths still has non-zero bot-hours.

Also: `canary-baseline.py` aggregates on `exp.pool`, which is per-pool for
board/hive/placebo but **per-bot for isolated** (`self-isolated-a-Alpha`), so its
rows mix 5-bot and 1-bot units in one table.

---

## 6. Water and mining — direction confirmed, nothing shipped

**Water.** Net production change to date: **zero**. Two canaries, two rollbacks.

What is established: mineflayer-pathfinder **already swims** — it aims at the
next node, holds `forward`, and holds `jump` while `isInWater` (index.js:607‑613).
We disabled it twice over, by pricing a wet step at ~86 against a 100-cost
deletion threshold, and by `seizeBody()` calling `setGoal(null)` whenever a bot
is wet. Then we built `swim_to` and a rescue reflex to replace the feature we had
switched off. `swim_to` succeeds 4%.

Canary `4a1dfcb` on placebo-c improved every travel measure — swim success
6.7 → 16.3%, reentry/escape 8.56 → 3.25, travel completion 70.5 → 83.3%,
interrupts 13.1 → 8.3% — and drowned bots at 7.5× (p = 0.0079) because the
reflex demotion applied to unowned bots, not just travelling ones. The event mix
said why: 193 `_water_float` + 156 `_water_surface` (nobody steering) against 17
`_water_travel_uninterrupted` (someone steering). Fixed to gate on
`bot.pathfinder.goal`, mutation-tested, **not deployed**.

**Before re-canarying:** require `_water_float`/`_water_surface` counts to FALL as
travel takes ownership. If they hold near 350 per 6 bot-hours, travel does not
own water and the swim mode is decorative.

**Still unwired, and it may make much of the above unnecessary:**
`index.mjs:471` builds `waterMoves` (`liquidCost = 2`, `exclusionAreasStep = []`)
and exposes `bot.waterMovements` and `bot.withWaterMovements` — **neither is ever
called**. Its siblings `withAscentMovements` (4 call sites) and
`withDescentMovements` (2) are wired. The only test asserts the assignment
against the *source text*, which is the anti-pattern this codebase names in three
separate comments.

**Mining.** The staircase has **never completed a descent in production**: first
run, my arrival check rejected its own successes (raw height read mid-fall);
second run, 8 of 9 `mine` calls were refused with *"will not dig down within 4
blocks of home"* and never reached the staircase. Its motivating finding — "zero
iron in 23 days" — was an artifact of the `gather` scoring bug; 33 bots have held
`raw_iron` and one crafted an iron pickaxe.

**Related, unfixed:** the exit contract charges `debt + max(8, debt/4)` scaffold,
so a bot **one block** below sea level must carry 9 blocks for a 1-block climb.
982 of 1,538 refusals are at y=60–69 with a median debt of 1. The fix is
`max(min(FLOOR, debt), ceil(debt/4))` — no cliff at the top, byte-identical at
depth. Written up, not built.

---

## 7. Position-delta watchdog — entrapment is now the largest term in the endpoint

**Why this is first among the unstarted work.** The gather collapse decomposes
into two unrelated things, and only one of them is about gathering:

```
             immobile   gather%      gather% among
day            bots     ALL bots     bots that MOVED >100 blocks
2026-08-22        0      27.8%          27.8%
2026-08-25        3      23.5%          24.7%      <- fleet doubled 40 -> 80
2026-08-26        6      15.9%          17.3%      <- a real one-day STEP
2026-08-29       23      12.1%          16.6%
2026-08-31       23      13.0%          19.3%
2026-09-01       19      10.5%          16.3%
```

Among bots that still move, the rate has been **flat at 16–19% since 08-26**.
The headline kept falling only because the immobile fraction grew from 6 to 28.
The "steady −0.20 pp/day decline" was an artifact of averaging a step change
against growing dead weight. `bots.distance_moved > 100/day` is an *independent*
criterion — it does not condition on the gather outcome, so this is not the
selection effect that the same cut on "zero gather successes" would produce.

**So entrapment is not a side issue competing with the endpoint. Right now it IS
most of the endpoint's movement.** This restates [[entrapment-dominates]] with a
number.

**Build.** `fleet-watchdog.sh` already exists and has **no committed timer**.
It must watch **position deltas**, not events. `mineflayer-pathfinder#222`
documents hangs where `thinkTimeout` never fires and *no event is emitted at
all* — which is what the 922/day `cognitive loop went silent` restarts are.
A stuck bot cannot be detected by listening for its complaints. Liveness is not
health: all 15 frozen bots emit ~900 decisions/day and pass every liveness check.

**Detect, then classify, then act — in that order, and do not skip to acting.**
Two trap classes are already named: drowning-reflex livelock (~3,000
`_drowning_ceiling_no_air` per bot per day at a flat 125/hour) and marooned-high
(~1,390 `_maroon_climb_refused` per day). A restart does NOT free either.

**Do not** auto-restart on detection as the first move. That converts a
measurable trap into an invisible one, and restarts destroy WorkingMemory
**arm-asymmetrically** — the exact confound `fleet-recycle.sh` exists to prevent.
Detect and record first; intervene only with a named remedy per trap class.

**Blocked on nothing.** This is pure instrumentation and can start immediately.

---

## 8. `smelt` — the tech ceiling is a missing verb, not a capability limit

**Measured 2026-09-01, 7 days, positive control on every zero** (the identical
`exists`+`cardinality` query returns 1,032,353 docs / 35 bots for `raw_iron` and
3,711,216 docs / 73 bots for `furnace`, so the instrument sees presence):

```
furnace        73 / 80 bots        raw_iron      35 / 80 bots
coal           72 / 80 bots        raw_copper    61 / 80 bots
iron_ingot      0 / 80  ever       copper_ingot   0 / 80  ever
```

`grep -rn smelt bots/src` returns **nothing**. A bot can craft a furnace
(`milestones.mjs:304-306`), place it (`skills.mjs:1872`), and then has no action
that can put anything into it. Every hour spent gathering ore is discarded.

Two upstream blockages compound it, and a `smelt` verb alone will not clear them:
- `TECH_LADDER` (`milestones.mjs:292-307`) **terminates at `furnace ×1`**.
- Every Block-2 bot runs `BOT_ROLE=gatherer`, whose chain
  (`milestones.mjs:210-215`) is four `gather` rungs with **no craft rung at all**.
  The miner chain that has the real ladder (`:196-206`) is assigned to nobody.

**Fleet lifetime high-water mark:** `isolated-b-Bravo` held 6 `iron_ingot` for
five hours on 2026-08-25 and an `iron_pickaxe` until the 26th. One bot, one
window, never repeated. All 3,937 `iron_ingot` docs in history are that bot.

**Sequence after #7 and after the 08-26 step is explained.** A new rung landing
on a moving baseline cannot be evaluated. This is a straightforward feature, not
a research problem — the research problem is why the baseline moves.

**Context, so nobody reads the ceiling as a result:** iron is where every
published system falls over — Optimus-3 0.55, JARVIS-1 0.36, Plan4MC 0.17,
DEPS 0.126, GPT-4V 0.00, human 0.86. Being below iron is the field norm. Being
below iron with no smelt verb is not a capability finding. And do not compare
against Voyager's 21±7 iterations-to-iron: its own install docs require a
*Multi Server Pause* mod that freezes the world during inference, n=3.
