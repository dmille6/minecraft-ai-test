# 2. Rejection-loop anatomy (pre-project analysis)

Date: 2026-11-22. Data: the analysis VM (10.0.0.45), read-only.
Scripts: `infra/analysis/pre-project/rl_loops.py` (all decisions, feature parquet),
`rl_raw_extract.py` + `rl_args_prompt.py` (raw sample: args identity and prompt contents).

## Bottom line

- A rejected decision is followed by the **same skill 67.4%** of the time. After a success the figure is
  39.6%, so the excess comes from the rejection. The same skill **with the same args** follows 35.3% of
  rejections, against 13.5% after a success.
- The model is told why it was rejected: **99.2%** of prompts after a rejection carry
  `LAST ACTION: rejected: <gate> (<detail>)`. The menu still offers the rejected skill, because the
  skill enum is fixed and only `deposit` is ever removed (`depositoffer`). Telling the model does not
  work. Taking the choice away is the lever.
- Rejections take **36.6% of all decisions** (5.69 M of 15.56 M). The streaks they form take about
  **29% of active bot-time**: on average **469 of 1,609 bot-hours per day** across the fleet, over 108
  days and a mean of 69 bots per day.
- The loop is a long-tail problem. 66% of rejection runs have length 1, but **57% of rejected decisions
  sit in runs of 3 or more** and 41% in runs of 5 or more. The longest run was 639.
- Retrying is a bad bet. After one failed execution, retrying the same skill succeeds **6.2%** of the
  time and switching skill succeeds **22.6%**. After the 2nd consecutive same-skill rejection, the next
  decision is the same rejection again **55%** of the time. By the 7th it is **81%**, and by the 12th
  or later **94%**.
- The answer-key check reproduces the headline. In the SRS slice0 (933 items), 371 of the 592 decisions
  graded `decision_ok=no` are `repeated_rejected_action`, which is 62.7%. The 57% figure was over the
  full set.

## Definitions and denominators

Each bot's decisions are ordered by (ts, id). A **session break** is a run change or a gap of more than
10 minutes, and every sequence is cut there. Decisions fall into six classes:

| class | meaning | n | % |
|---|---|---|---|
| rej | the admission gate refused the model's choice (`gate_error`, not counting LLM-endpoint errors) | 5,690,137 | 36.6 |
| fail | admitted; outcome failed or no_effect | 4,716,123 | 30.3 |
| ok | admitted; success | 3,879,581 | 24.9 |
| cab | admitted, then aborted by a controller reflex (entombed, stagnation, drowning, stuck...). **Caused by the controller, not chosen by the model.** | 696,268 | 4.5 |
| unk | outcome unknown | 527,207 | 3.4 |
| infra | LLM endpoint failed | 54,779 | 0.4 |

Coverage: 110 bots, 79,717 sessions, 108 days (08-05 to 11-22). Every class is present, which is the
positive control for the counts below.

A **rejection run** is a maximal stretch of consecutive `rej` decisions within one session. A
**same-skill run** is the same, with the extra condition that the skill does not change. The cost of a
run is its decision count, plus wall time from its first decision to the decision that breaks it.

## 1. What follows one rejection

Each row is the class of a decision; the columns describe the next decision in the same session.

| current class | n | P(next same skill) | P(next rej) | P(next rej, same skill) | P(next ok) |
|---|---|---|---|---|---|
| rej | 5.66 M | **0.674** | 0.556 | **0.463** | 0.130 |
| fail | 4.68 M | 0.386 | 0.354 | 0.218 | 0.160 |
| ok (control) | 3.87 M | 0.396 | 0.153 | 0.060 | 0.527 |
| cab | 0.69 M | 0.421 | 0.171 | 0.063 | 0.303 |

Same args (raw sample: every 4th fleet day plus every showcase day; 4.42 M decisions, 1.55 M of them
rejections). After a rejection the next decision repeats the same skill and args **35.3%** of the
time. The baselines are 13.5% after a success and 13.8% after a failure.

By gate:

| gate | rejections (all) | P(same skill) | P(same gate again) | P(exact repeat, raw sample) | P(next ok) |
|---|---|---|---|---|---|
| repeat_loop | 1,876,876 | 0.847 | **0.928** | 0.570 | 0.120 |
| learned_avoid | 1,110,290 | 0.604 | 0.813 | 0.254 | 0.126 |
| cooldown | 1,058,156 | 0.700 | 0.276 | 0.327 | 0.116 |
| bad_args | 545,109 | 0.463 | 0.694 | 0.096 | 0.184 |
| deposit_nothing_to_bank | 315,180 | 0.626 | 0.665 | 0.297 | 0.133 |
| unreachable_elevation | 277,064 | 0.751 | 0.853 | 0.319 | **0.028** |
| deposit_not_worth_it | 266,372 | 0.167 | 0.279 | 0.038 | 0.252 |
| water_blocks_land_travel | 79,198 | 0.765 | 0.923 | 0.317 | 0.115 |

`repeat_loop` sustains itself. The gate (`admission.mjs`, REPEAT_WINDOW=4) does not push refused
proposals into `recent`, so the count that triggered the refusal never decays while the model keeps
proposing the same thing. After an `unreachable_elevation` refusal, the next decision succeeds only
2.8% of the time. That is the gate refusing a goal while giving the bot no way to reach it.

## 2. Run lengths and cost

| | runs | decisions | mean | p50 | p90 | p99 | max | ≥5 | share of decisions in runs ≥5 | p50 / p90 duration |
|---|---|---|---|---|---|---|---|---|---|---|
| rejection runs (any skill) | 2,545,254 | 5,690,137 | 2.24 | 1 | 4 | 17 | 639 | 8.6% | 40.6% | 33 s / 136 s |
| same-skill rejection runs | 3,072,547 | 5,690,137 | 1.85 | 1 | 3 | 12 | 500 | 5.7% | 31.8% | 33 s / 116 s |
| same-skill rej-or-fail runs | 5,395,931 | 10,406,260 | 1.93 | 1 | 3 | 14 | 500 | 6.5% | 34.6% | 34 s / 130 s |

Rejection runs (any skill) by length:

| length | runs | decisions | bot-hours | mean duration |
|---|---|---|---|---|
| 1 | 1,671,467 | 1,671,467 | 14,810 | 32 s |
| 2 | 376,318 | 752,636 | 6,173 | 59 s |
| 3-4 | 278,123 | 955,188 | 8,794 | 114 s |
| 5-9 | 170,695 | 1,030,309 | 9,470 | 200 s |
| 10-19 | 27,352 | 363,258 | 3,243 | 7 min |
| 20-49 | 15,277 | 443,151 | 3,991 | 16 min |
| 50-199 | 5,895 | 438,909 | 3,832 | 39 min |
| 200+ | 127 | 35,219 | 316 | 2.5 h |

A rejected decision costs a median of **32 s** (time to the next decision), close to a whole decision
cycle. Admitted decisions cost 33 to 47 s.

Fleet-wide over 108 days, each day had on average 1,609 active bot-hours and 469 bot-hours inside
rejection runs (29.1%). Runs of 3 or more took 227 bot-hours per day.

| month | active bot-h/day | in rejection runs, bot-h/day | fraction |
|---|---|---|---|
| 2026-08 | 727 | 230 | 0.316 |
| 2026-09 | 1,914 | 556 | 0.290 |
| 2026-10 | 1,949 | 647 | **0.332** |
| 2026-11 | 1,825 | 405 | 0.222 |

Caveat: these hours are time spent producing refused decisions. They are not an estimate of what a
perfect policy would have done with that time. They are an upper bound on recoverable time.

## 3. What breaks a loop

Rejection runs of length 5 or more (n = 219,301):

| breaker | % |
|---|---|
| same skill admitted, then success | 24.5 |
| same skill admitted, then fail | 26.3 |
| different skill, then fail | 22.1 |
| different skill, then success | 14.4 |
| controller abort right after admission (cab) | 7.7 |
| unknown outcome | 2.8 |
| session break or restart trigger | 1.5 |
| reflex trigger | ~0 |

- Restarts and reflexes almost never end a loop (1.5%). Loops end from inside the decision loop.
- Half of the long loops end with the **same skill being admitted**. That happens through changed args,
  an expired cooldown, or the forced admission in `learned_avoid` (every 5th proposal, or after
  MAX_VETO_STREAK=4). The bump in the hazard table at i=4 and i=6 is that forced admission. When the
  forced or eventual admission is executed, it succeeds about half the time (24.5% against 26.3%), so
  many of these vetoes were blocking actions that would have worked.
- Across all runs, a different skill ends 47% of them, but that skill is often a failure (29% of runs)
  or a fresh rejection on another skill (17% of same-skill runs end that way).

## 4. Where the long loops are

| skill × first gate | runs | decisions | mean len | max |
|---|---|---|---|---|
| explore × repeat_loop | 232,037 | 690,876 | 2.98 | 500 |
| gather × cooldown | 459,061 | 641,241 | 1.40 | 100 |
| gather × learned_avoid | 299,510 | 524,164 | 1.75 | 40 |
| gather × repeat_loop | 114,481 | 366,936 | 3.21 | 168 |
| mine × bad_args | 242,965 | 335,903 | 1.38 | 92 |
| deposit × deposit_nothing_to_bank | 143,169 | 318,313 | 2.22 | 153 |
| goto × unreachable_elevation | 75,868 | 277,807 | **3.66** | 142 |
| goto × repeat_loop | 76,628 | 253,492 | 3.31 | 89 |

Share of same-skill runs reaching 5 or more, by first gate: repeat_loop 17.7%, unreachable_elevation
15.9%, deposit_nothing_to_bank 8.1%, deposit_item_missing 5.5%, cooldown 3.9%, learned_avoid 1.4%. By
skill: explore 11.5% and goto 11.4%, against 4.3% for gather.

Correlates (same-skill runs; the share reaching length 5 or more is "≥5"):
- **Model.** For qwen2.5:7b (2.90 M runs) the rejection rate is 38.3% of decisions, P(same skill after
  a rejection) is 0.678, and ≥5 is 5.7%. For r3-qwen35-4b: 22.9%, 0.589, 4.8%. gemma4:26b is rejected
  least (11.3%) but loops longest when it is (mean 2.72, ≥5 13.9%, P(same) 0.77). The qwen2.5:14b, 32b
  and 72b samples are small (38 k, 13 k and 2 k decisions), and their ≥5 share is at most 1.9%. Bigger
  models are not reliably less stubborn.
- **Era.** Loops were worst in October: P(same skill after a rejection) 0.764, mean run 2.42, ≥5 10.3%,
  against 1.4% in August. November is down to 6.3%. Lessons, gates and prompt text all grew over this
  period.
- **Trigger.** Runs that start on stuck (≥5: 10.6%), entombed (8.6%) and stagnation (8.4%) loop more
  than idle runs (5.6%). drowning is 0.4%.
- **Situation.** Underground decisions (y<50) are rejected 40.9% of the time, against 35.1% on the
  surface. With a pickaxe, ≥5 is 6.2 to 6.9%; without one, 1.6 to 2.7%. The fleet's ≥5 share is
  5.7%; the showcase's is 9.5% (44.5 k runs).

## 5. Did the prompt carry the rejection? Was the skill still offered?

From the raw sample:
- **99.2%** of prompts after a rejection have `LAST ACTION: rejected: ...`, and 99.1% name the gate.
  As a control, the line appears after only 0.1% of successes. The most common text is
  `rejected: repeat_loop (chose the identical action 4x in a row)` (519 k).
- `RECENT EVENTS` also stacks earlier rejections, with a mean of 5.2 `- rejected:` lines after a
  rejection. **More rejection lines in the prompt go with more repetition**:

  | rejected lines in the prompt | P(exact repeat) |
  |---|---|
  | 0 | 0.26 |
  | 3 | 0.29 |
  | 6 | 0.34 |
  | 9 | 0.42 |
  | 12 or more | 0.66 |

  This is partly selection: stuck states produce both the extra lines and the repetition. The
  rejection text still has no visible corrective effect.
- **The menu.** `cognitive.mjs` builds the schema enum from `SKILL_NAMES` once. The only per-call
  removal is `deposit`, under depositoffer, when the gate would refuse it. Every other rejected skill
  stays both selectable and documented in the system prompt. No per-call args exclusion exists either.
  Bounding by grammar has precedent here: depositoffer and the string-length caps. It was simply never
  applied to rejections.

## 6. Controller-caused aborts versus model choices

The 696 k `cab` outcomes are the controller interrupting admitted actions: entombed 325 k, stagnation
148 k, drowning 104 k, stuck 90 k, timeout 9 k. After a cab, the model picks the same skill 40 to 57%
of the time, about the same as after a success, so these are not model-driven loops. Separately, 7.7%
of long rejection runs end in an admitted action that the controller then aborted. The model-choice
loops are the rej runs. The gates compose them: in a repeat_loop refusal the gate's own memory keeps
the refusal alive.

## 7. Recovery ladder for the new platform

The numbers come from the hazard tables. Same-skill rejections:

| i-th consecutive | P(next same rej) | P(next ok) |
|---|---|---|
| 1st | 0.26 | 0.17 |
| 2nd | 0.55 | 0.10 |
| 7th | 0.81 | 0.06 |
| 12th or later | 0.94 | 0.01 |

Same-skill retry after a failed execution:

| failure | P(retry succeeds) | P(switch succeeds) |
|---|---|---|
| 1st | 0.06 | 0.23 |
| 3rd | 0.06 | 0.13 |

1. **Exact (skill, args) after a rejection: retry budget 0.** Remove that pair from the next call's
   grammar for the gate's own window: the cooldown time, or at least 2 decisions. A text explanation
   alone has been tried on 99% of prompts and fails.
2. **Same skill, 2nd consecutive rejection: drop the skill from the per-call enum** for 3 decisions or
   about 90 s. This step is warranted because P(repeat) more than doubles from the 1st to the 2nd
   rejection (0.26 to 0.55).
3. **Executed failures: retry budget 1 with changed args, then switch.** A same-skill retry succeeds
   6%; a switch succeeds 23%.
4. **Replan at 3 consecutive rejections of any skill, or about 2 minutes.** A run of 3 or more is
   where 57% of rejected decisions sit, and p90 run duration is 136 s. Replanning here means the
   controller hands the model a short plan with a feasibility check, or picks a deterministic fallback
   from the remedy the gate names. That remedy must be executable from where the bot is
   (unreachable_elevation leads to success only 2.8% of the time).
5. **Defer the task at 5 consecutive rejections or about 4 minutes.** Park the goal with a back-off of
   10 minutes or more and take other work. Runs of 5 or more are 8.6% of runs but 41% of rejected
   decisions. The forced-admission data shows a vetoed action succeeds about half the time when
   finally executed, so a deferred goal should retry later, not be dropped.
6. **Hard stop at 10 decisions or 8 minutes in any loop.** Escalate: different task family, overseer
   reassignment, alarm. Runs of 10 or more (1.9% of runs) take 1.28 M decisions and 11.4 k bot-hours.
7. **Do not feed the history back.** Cap rejected lines in the prompt at 1, the latest one; P(exact
   repeat) rises from 0.26 to 0.66 as these lines accumulate. Make gate memories count refused
   proposals or decay with time, so no gate keeps itself alive the way repeat_loop does.

A ladder like this could recover a large part of the ~470 bot-hours per day (29% of fleet time) now
spent in rejection runs. Runs of 3 or more alone take ~227 bot-hours per day.
