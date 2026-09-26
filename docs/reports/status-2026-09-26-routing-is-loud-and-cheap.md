# 2026-09-26 — routing is loud and cheap, the queue was ranked by the wrong number, and B2 has sat built for 15 days

All figures measured on the live fleet: 80 bots, one version `efa2853+c7b045`, no
canary, 1,919.9 measured bot-hours over 24 h.

---

## 1. The queue was ranked by event counts, and counts are nearly uncorrelated with cost

I have been ranking the next problem by how many failure rows it produces.
`unreachable` 8,612, `no_safe_target` 8,163, `no_path` 7,954. Here is the same
taxonomy priced in bot-time and yield instead:

    gather outcome     n      bot-min/bot-h  med_dur_s  med_moved  moved==0  items
    OK               6,869        2.13          35.7        4.0       7.6%   23,815
    no_path          7,957        1.08          15.7        2.0      40.4%    1,057
    interrupted      1,733        0.44          29.5        3.0      18.9%        0
    unreachable      8,603        0.29           3.9        0.0      72.9%      787
    no_safe_target   8,156        0.05           0.8        0.0      96.5%       28
    nothing_found    2,412        0.01           0.7        0.0      96.5%       13

`no_safe_target` and `nothing_found` are **30% of the failure count and 1.4% of
the cost**: 0.8 s and 0.7 s median, 96.5% of them move the bot exactly zero
blocks. They are the planner correctly declining, and they have been near the top
of my queue for days because I counted them instead of pricing them.

This is `say-the-denominator-before-you-say-the-number` one level up: the
denominator I needed was **bot-time**, not attempts.

## 2. Routing is loud and cheap. It is not the substantive next problem.

A* fails **51.9 times per bot-hour** across all 80 bots (median 319 shape-rows
per bot, so this is fleet-wide, not a few wedged bots):

    disconnected      50,217   50.4%   26.15/bot-h
    budget            30,392   30.5%   15.83/bot-h
    sealed_in_liquid  15,834   15.9%    8.25/bot-h
    no_legal_move      3,254    3.3%    1.69/bot-h

And here is what those failures cost, from `goto`'s own fail-class split:

    goto outcome           n    min/bot-h  med_moved  moved>=5
    OK                  8,689     1.29        52.0     96.7%
    no_measurable_change 1,753    0.01         0.0      0.0%
    no_path              1,280    0.01         0.0      4.8%
    path_interrupted     1,145    0.28        26.0     90.5%
    stranded               631    0.07         1.0     37.9%
    path_budget            557    0.13         0.0      6.3%
    wrong_elevation        394    0.05        21.0     79.4%

Total `goto` is **3.3% of bot-time**; its failures about **1.1%**. The genuine
"no route out of here" case — `stranded` — is **631 events in 24 hours across 80
bots, 0.33/bot-h**. And **30.9% of all goto failures still moved the bot 5+
blocks**, median 26 for `path_interrupted`.

Same shape as `phantom-drowning-is-loud-not-harmful`: a very large event count
attached to a very small cost.

**Why some `no_path` is not a failure at all.** `installPathBackoff`
(`bots/src/pathbackoff.mjs:140`) substitutes Baritone's best partial path on
timeout/noPath. mineflayer-pathfinder then does `path = results.path` and emits
`path_update` with the status still `noPath`
(`node_modules/mineflayer-pathfinder/index.js:446-447`), while `goto`'s listener
rejects any non-empty terminal failure (`lib/goto.js:22-28`). **So the bot walks
the partial path and the skill records a failure.** That is consistent with
`no_path` gather attempts yielding 1,057 items and moving 5+ blocks 34.1% of the
time.

## 3. 81.6% of bot-time is not inside any skill

    ALL SKILLS    11.04 min/bot-h   18.4%
    UNACCOUNTED   48.96 min/bot-h   81.6%

    gather  7.0% | explore 6.2% | goto 3.3% | surface 0.9% | everything else <0.5%

Median idle gap between one skill ending and the next starting is **43.1 s**
(mean 65.2, p90 134.6), and **43.8% of all idle time sits in gaps longer than two
minutes**. Of 7,494 such gaps, **zero were empty** — every one had non-skill
activity inside it, median 10 events, dominated by `_affordance_scan` (30.7%) and
path events (~35%). The bots are never idle-dead.

Split by how the previous skill ended:

    previous status    n       p10   MEDIAN   p90    mean   share of idle
    failed          22,878    23.2    54.9   150.0   75.0      59.9%
    success         15,380    22.2    42.2    98.1   54.9      29.4%

**What I will NOT claim.** `LLM_DECISION_COOLDOWN_MS=30000` in all 80 env files
and `FAILED_COOLDOWN_MS` is unset (so config.mjs's 45000 applies). My first
reading was that the 45 s failed-cooldown is the sink. The distribution refutes
it: p10 is 23.2 s, *below* the 30 s floor, and only 1.7–8.0% of gaps land in
45–50 s. The gaps are larger and far more diffuse than either constant, so my
gap measure is not a clean cooldown probe and I am not building on it. The
settled position stands: cooldown is ~33–42% of cycle time, three cooldown
canaries read REVERT, and `inference-is-not-the-constraint` (91.10 vs 91.85
decisions/bot-h across a 1.9× latency gap) closes the inference avenue.

## 4. Two engines killed my proposed change, and they were right

I found that `backoffStats.substituted` / `.kept` / `.byCoefficient`
(`pathbackoff.mjs:69`) are incremented in four places and **read only by tests** —
so whether the partial-path rescue fires has never reached a fleet log. I
proposed emitting it. Codex and an independent Claude pass both said do not build
it, for reasons I had missed:

- **`kept` does not mean "the bot got nothing."** The loop skips `cand === node`
  *before* the distance test (`pathbackoff.mjs:240-251`), so a library-chosen
  node 30 blocks away also increments `kept`.
- **The counters are shared and untagged.** `makeResult` is patched on the
  *prototype*, so every A* search in the process lands in them — including
  read-only probes: `reachprobe.mjs:219` (once per gather attempt, ≥18.67/bot-h),
  `digapproach.mjs:349`, `watchdog.mjs:409`, `reflex.mjs:4806`. A substitution
  inside a probe moves the bot zero blocks. The instrument would answer the same
  word in both worlds it was built to separate.
- **`disconnected` is not "disconnected under the movement permissions."**
  `astar.js:51,95` prune on `maxCost = h + searchRadius`, and
  `digapproach.mjs:251-257` sets `searchRadius = 400` process-wide for the whole
  of every gather walk. So an unknown and possibly large share of those 50,217
  rows means "costs more than h+400". I picked the more alarming of two available
  readings without a control.
- A new *field* would have been silently dropped: the index is `dynamic:strict`
  (`infra/elk/apply-mappings.sh:84,97`), which once cost eight days and ~1.4M
  absent decisions.

Both engines independently pointed at the same better answer: **`skill.distance_moved`
and the existing `goto` fail-class split, already on the deployed sha, no code
change.** That is section 2 above. The change was never needed.

## 5. Two queue items were wrong and are now closed

**"The explore heading-convention bug" — FALSE.** I had it as: the planner aims
`(cos, sin)` while the walk goes `(−sin, −cos)`, 90° apart. Every `(cos, sin)`
site takes either a random bearing or `atan2(dz, dx)`
(`skills.mjs:3275`, `cognitive.mjs:335`, `watchdog.mjs:375`, `reflex.mjs:4944`),
and the directed path is `heading = atan2(known.z − start.z, known.x − start.x)`
in degrees → `ang = heading·π/180` → `(cos, sin)` — self-consistent
(`skills.mjs:3234`, `:3256`, `:3275`). The single `(−sin, −cos)` site takes a real
yaw (`reflex.mjs:3614`), which is the correct convention for a yaw, and is the
positive control proving the grep would have found a mismatch if one existed.

**"Re-run drop5-01 with a corrected deadline" — moot.** `efa2853` *is* the bound-5
commit and it is the fleet baseline. It was promoted on its own numbers and the
fleet confirmed it (targeted refusals 2.34/bot-h → 0.0, boxed share −24.3pp).
There is nothing left to canary.

## 6. What is actually next: B2, built 2026-09-11, never deployed

`offLimits` is absent from `main` (positive control: the identical query finds
`pathFailureShape`). Fifteen days. It is the agreed next step after three cooldown
canaries read REVERT and established that the wait is not the bottleneck.

Measured tonight over 12 sampled bots / 18 bot-h / 536 veto lines — and vetoes
run at **29.8/bot-h**, which is a large, well-powered endpoint:

    repeat_loop          275   51.3%
    cooldown             124   23.1%
    learned_avoid         72   13.4%
    deposit_not_worth_it  37    6.9%
    bad_args              16    3.0%

B2's two halves map onto the two biggest classes — the OFF-LIMITS line attacks
`cooldown`, the rejection naming the vetoed proposal attacks `repeat_loop` —
**74.4% between them**.

Prepared as `veto-b2-01` = `efa2853` + cherry-pick `7d4f416 65c9090` + one
readability row. `npm test` 197/197; `veto-feedback.test.mjs` 12/12 including
four mutants. Registration passes `licencecheck` (class `kind`, earned) and
`v30check` at deadline 360, and v30check was proven to fire by refusing 240 and
180.

**Diffing the original branch would have reverted 15 days of work** — it is
*behind* main on `cognitive.mjs` by 187 lines. Hence a cherry-pick onto the
deployed baseline, not a merge.

## 7. The dry run moved the gate

A dry run with **both arms on identical code** produced `vetoes_did = −5.27` and
`decisions_did = −5.44`. Both should be ~0. My pre-registered rule said "KEEP if
the DiD is negative", which would have **kept on noise** — the `canary-gate-was-noise`
defect. The gate is being reset against a measured null distribution over
same-shape assignments before this deploys.

The dry run also confirmed the reader: 157,043 rows / 80 bots / 117 kinds, arms
20/40, journald scrape 812 canary and 1,440 control veto lines, and
`admitted decisions/bot-h` 92.61 vs 92.76 — which independently reproduces the
~91 decisions/bot-h measured on 2026-09-23.

It also showed why the pool must be drawn by `drawrec.sh` and not by hand: my
hand-picked dry-run pools put `learned_avoid` at 16.25/bot-h in the treatment arm
against 4.49 in control, a 3.6× imbalance, because hive pools are heavy
`learned_avoid` emitters (109–185 per 1k decisions against 3–16 elsewhere).

---

## 8. The deploy resets the very gate state the endpoint measures

Added after the +30 read. **This applies to every canary this project has run on a
gate-related endpoint, not just this one.**

The loop restarts only the canary pool; control is never restarted. For a veto-rate
endpoint that is not an activity dip, it is a state reset of the metric:

    admission.mjs:164   this.failedCooldowns = new Map()
    admission.mjs:165   this.recent = []
    admission.mjs:22    const REPEAT_WINDOW = 4
    admission.mjs:701-3 repeats >= REPEAT_WINDOW -> reason 'repeat_loop'

`repeat_loop` **cannot fire** until a bot has chosen four *identical admitted* actions,
and `cooldown` cannot fire until the map refills. A freshly restarted pool therefore
emits no repeat_loop vetoes and then an excess of cooldown vetoes, by construction —
which is exactly the +30 signature.

    read              vetoes_did  repeat_loop  cooldown  learned_avoid
    +30 raw             -20.06      -11.78      +9.39       -19.16
    warm (min 30-37)     -3.95      -13.71      +4.35        +8.87

**About 80% of the raw signal was warm-up.** The tell was `learned_avoid` at −19.16 —
a veto class B2 cannot touch at all, because it never goes near the lessons store. A
large DiD on an *untargeted* class is the cheapest check that an aggregate is not the
treatment, and it is now a standing field in this read.

So `vetoes_did_warm` (post-deploy minute 30 onward) is registered as the deciding
field, amended **before** any deciding read and before any deciding number existed.
The gate value is unchanged at −5.03 precisely because the null is unchanged: the null
was measured with both arms undisturbed, so it calibrates the uncontaminated
estimator, and the warm window makes the measurement match its calibration.

## 9. The gate cannot fail a canary on its effect

`verdict.py:906` — `_ADVISORY = {'primary', 'watch', 'mechanism_check', 'notes', ...}`.
Positive controls in the same file: `own_lines` 4 hits, `exposure` 25 hits, both
handled. The gate prints it in every verdict line; falls-02's +180 named `primary`
among "NOT evaluated by this gate".

So KEEP/REVERT rests on the exposure floor, the linkage presence tests, the death gate
and calibration. **A canary can earn KEEP with zero measured effect.**

This bears directly on the 23-REVERT / 15-KEEP ledger: the two halves are not
comparable. REVERTs come from tests that actually ran — a linkage defect, two deaths
above 1.25× control. KEEPs mean *nothing objected*. A KEEP must never be reported as
"it worked", and the effect call has to be made explicitly against a measured null and
stated separately.

## 10. Where vetob2-01 stands at +30 (reported only, not a verdict)

Linkage clean: `_veto_feedback` canary 260 / control 0, 10 of 10 bots settled on the
canary build, 0 rows over the 240-char cap. Exposure met. Gate returned `NOT_YET`
(5.0 bot-h). No deaths.

The mechanism signal worth watching: on the warm window `repeat_loop` in the canary was
**0.00/bot-h against control's 17.17**, while `cooldown` rose. That is the
`refusals-relocate-not-convert` shape, and at 1.1 warm canary bot-h it is far too small
a window to mean anything. +180 gives ~25 warm canary bot-h and is the first read with
power.

Also to check honestly at +180: whether the original exposure floor of 500 would in
fact have been met (260 rows at +30 extrapolates well past it), in which case my
amendment down to 150 was unnecessary and I should say so.

---

## 11. vetob2-01 CLOSED — gate KEEP, effect INCONCLUSIVE, mechanism CONFIRMED

Ran 3 h on `hive-a`+`hive-c`, 10 bots, **24.96 warm canary bot-hours**. Torn down
clean: 80 bots, exactly one version `efa2853+c7b045`, open-loop guard clear.

**`verdict.py` returned KEEP** on exposure (1,198 ≥ 150), linkage (0 control rows,
10/10 settled, 0 over-cap) and deaths (0 vs control 2). It never tested the effect —
see §9. **That KEEP is "nothing objected", not "it worked."**

**My effect call is INCONCLUSIVE.** The registered primary `vetoes_did_warm` is
**−3.50** against a gate of **−5.03**, the 5% one-sided bound of an exhaustive
same-shape null (C(12,2)=66, mean 0.00, sd 3.31).

**The mechanism is confirmed, on two measures, one of which never touches the gate:**

    repeat_loop vetoes/bot-h      canary  5.97  control 18.13   DiD  -8.71
      past the pooled p5 (-7.03), far outside the hive-only null range (+1.40..+4.63)

    repeat share of consecutive
    ADMITTED decisions            canary 0.083  control 0.100   DiD  -0.043
      past the pooled p5 (-0.0415), below every hive-only draw (min -0.0247),
      and stable: -0.042 at W=95, -0.043 at W=180

The repeat share comes from admitted decisions in the JSONL, with the gate nowhere in
the path. **The model does repeat itself less.** That was B2's claim and it holds.

**Why it does not reach the endpoint — refusals relocate.** Warm DiDs:

    repeat_loop  -8.71
    cooldown     +1.46
    learned_avoid +3.41
    -----------------
    all vetoes   -3.50     (~56% of the gain absorbed)

Confirms `refusals-relocate-not-convert` with a measured null instead of an assertion.
And diversity did **not** rise significantly (+3.06 distinct (skill,args) keys/bot-h,
inside the pooled band): the model repeats less **without ranging wider**. That is a
narrower claim than "it explores more" and the only one the data supports.

No throughput gain: decisions +1.70/bot-h on ~94 = **+1.8%** against a ~17% MDE.

**The draw landed on the worst available stratum for this endpoint.** `hive-a`+`hive-c`
run `learned_avoid` at 30.70/bot-h against control's 5.59. Hive pools are 109–185
learned_avoid per 1k decisions against 3–16 elsewhere, so the aggregate in hive is
dominated by a veto class B2 cannot touch. On non-hive pools the same −8.71
`repeat_loop` reduction would be a far larger share of total vetoes.

**Power.** sd 3.31 gives an MDE of ≈ −5.45 (1.645σ), roughly 11–15% of the veto rate.
A true effect of −3.50 sits below it. **The effect may be real and this design cannot
see it.** 10 bots × 3 h is under-powered; that is a design limit, not a result.

### A correction I owe my own record

I amended the exposure floor from 500 down to 150 at +25 min, on a measured 10.9
rows/bot-h. **Final exposure was 1,198 — 500 would have been met comfortably, and the
amendment was unnecessary.** The 10.9 came from a live-files-only walk that missed
rotated rows; the reader's rotation-aware, deduped count is the correct one. I was
right to distrust the 2.8 restart transient and wrong to trust the 10.9 that replaced
it — the same lesson twice in one night, and the fix both times is the rotation-aware
reader, not a second opinion from the same broken query.

### One benign teardown alarm, named so nobody chases it

Teardown reported `hive-a-Charlie: units not running before restart (still restarted) …
(restart-failed)`. `hive-a-Charlie` is **disabled and absent from `bot-manifest.json`**
— a stale unit with a leftover log directory. Teardown enumerates bot names from log
directories (deliberately, so a partial roster is not missed), which also picks up dead
units. hive-a's real roster is Alpha/Bravo/Comet/Delta/Echo, all five present, fleet
intact at 80.

### What this makes next

The wall is `learned_avoid`, not the prompt. It holds `gather:{block:oak_log}` at
`fails=2658` — the fleet's most common gather target — shared across all five hive-a
bots, accumulated across runs. It is 13.4% of vetoes fleet-wide and the dominant class
in hive. That is the next canary. Re-running B2 on non-hive pools with a bigger pool is
the cheaper second option, and the nulls, the warm-window instrument and the
direct repeat-share measure all now exist for it.
