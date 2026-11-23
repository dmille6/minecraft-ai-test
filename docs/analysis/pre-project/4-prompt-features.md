# 4. Prompt features vs sensible decisions (pre-project analysis)

Date 2026-11-22. Grades: Opus 5.5, rubric v3, outcome-blind (`decision_ok`, `failure_category`). Script:
`infra/analysis/pre-project/prompt_features.py` (pure Python; full output in the appendix). **Everything here is
correlation in logged data; no prompt was varied on purpose.** The rules in section 4 are hypotheses to test offline,
ranked by how strong and consistent the association is.

## 1. Data and weighting

- **slice0**: 933 simple-random decisions = population rates. Sensible **328/933 = 35.2% (95% CI 32-38)**; ignored
  task/hint 142 (15.2%); repeated rejected action 371 (39.8%).
- **slices 1-3**: 30,000 sqrt-allocated stratified decisions (cell = era|world|skill|status|trigger|yband|bag|hazard|gated).
  Used only for **within-stratum contrasts**: Mantel-Haenszel risk differences (RD) inside model x era x skill strata,
  and a logistic regression with model, era and skill fixed effects. Design-weighted (N_cell / n_cell from the
  15.5M-decision cell counts) they give 36.7% sensible, consistent with slice0, so the labels line up.
- Model mix (slice0): qwen2.5:7b 854/933 (92%). Results are essentially **about qwen2.5:7b**; other models are too
  thin to generalise.
- Logistic SEs ignore clustering by bot session, so CIs are too narrow. Treat only big, same-sign-in-both-samples
  effects as real.

### What cannot be measured
- **Number of skills offered / skill list**: not in the logged prompt (it lives in the system prompt / tool schema,
  which was not exported). Untestable here; see logging gaps (report 8).
- **Section order** barely varies: 45 orders, but all are the same template with optional sections dropped
  (TASK > PROGRESS > HINT > TRIGGER > STATE > INVENTORY > ... > LAST ACTION > LESSONS > RECENT EVENTS). TASK is at
  char 0 in >=90% of prompts; HINT median offset 89 chars. No order effect can be estimated.
- **Length** varies only 800-1,150 approx tokens (p10-p90; chars/4). Within that range length is nearly flat
  (MH RD for >=1,050 tok: +1.2 pp sensible). It says nothing about much longer or much shorter prompts.

## 2. The prompts as the bot saw them (slice0, population)

| feature | p10 / median / p90 |
|---|---|
| approx tokens | 802 / 980 / 1,133 |
| RECENT EVENTS lines | 10 / 12 / 12 |
| of which `rejected:` lines | 0 / 3 / 8 |
| of which `-> failed` lines | 0 / 2 / 7 |
| LESSONS lines | 9 / 13 / 15 (of which "has failed Nx": 0 / 3 / 6) |

| flag (slice0, n=933) | share |
|---|---|
| HINT present / HINT names a skill | 89.2% / 82.4% |
| a cooldown/learned_avoid rejection in RECENT EVENTS names **the skill the bot then chose** | 32.8% (306) |
| chosen skill appears as failing in LESSONS | 37.3% |
| **hint's own skill** is shown as rejected or failing elsewhere in the same prompt ("contradiction") | 53.3% (497) |
| CARRYING says "use deposit" while the task is not deposit/home | 32.0% |

So half the prompts tell the bot "do X" in HINT and "X keeps failing / is refused" lower down, and a third show a
refusal for the very action the bot then picks again.

## 3. Findings

### 3.1 Following a skill-naming hint is the strongest positive correlate
Population (slice0), hint names a skill (n=769):

| | n | sensible | ignored task/hint | repeated rejected |
|---|---|---|---|---|
| chose the hint skill | 290 | **46.9%** (41-53) | 5.5% | 44.1% |
| chose another skill | 479 | 31.1% (27-35) | 24.2% | 35.1% |
| hint names no skill | 63 | 22.2% | 4.8% | 57.1% |
| no hint | 101 | 28.7% | 6.9% | 38.6% |

Within model x era x skill (slices 1-3): following the hint **+21.6 pp** sensible (13,773 rows in informative strata).
Logistic: OR 1.74 (follow) vs 0.57 (hint names a skill, bot chose another). When the bot chose another skill, the
grader listed the hint skill as acceptable in **75.8%** (13,910/18,346): the hint was usually right and was ignored.
Only 38% of skill-naming hints are followed (290/769 population).

Caveat: this is partly definitional (a grader reading "HINT: gather dirt" marks gather sensible) and partly
confounded (hints are better in situations that are easier). It still says the hint content is mostly good and the
model's uptake is the weak link.

### 3.2 A refusal shown for the chosen skill goes with repeating it
| chosen skill shown in prompt as... (slices 1-3) | n | sensible | repeated rejected |
|---|---|---|---|
| neither refused nor failing | 20,916 | 35.0% | 16.6% |
| refused (cooldown / learned_avoid) in RECENT EVENTS | 2,847 | **18.2%** | **64.0%** |
| refused + failing in LESSONS | 2,760 | 28.2% | 57.1% |
| failing in LESSONS only | 3,477 | 45.7% | 26.3% |
| chose the same skill as a failed/rejected LAST ACTION | 2,136 | **12.2%** | **78.3%** |

MH within model x era x skill: refused-in-recent -21.3 pp sensible, +37.4 pp repeated-rejected; failed-in-recent
-21.0 / +37.9. Logistic OR for "repeated rejected": 3.72 (refusal names chosen skill). Population slice0 agrees
(19.3% vs 42.9% sensible). The dose also matters: sensible falls from 48.3% with no rejection lines to 22.7% with 6+
(slice0), MH -8.1 pp for >=3 lines.

Reading: showing the model a refusal as one more line in a 12-line event log **does not stop it** from choosing the
refused action; a 7B model appears to copy what is salient in the log. (Correlation: bots that are stuck accumulate
both refusals and bad choices, so part of this is the stuck state itself.) Note also: 1,102 of the population's
rejection lines are the generic `repeat_loop` ("chose the identical action 4x"), which never names what to do instead.

### 3.3 Cross-run LESSONS failures are weak
"Has failed Nx across runs" for the chosen skill: MH -7.2 pp, OR 0.87, and alone it even sits with 45.7% sensible.
Lesson count (9-15 lines) is flat (MH -1.7 pp). LESSONS mixes stale cross-run counts (e.g. `gather dirt failed 19x`
next to a HINT saying gather dirt) with "worked 2149x" lines; it is noise relative to the current situation.

### 3.4 "Contradiction" is not where the harm is
Hint skill shown as refused/failing elsewhere: MH +0.9 pp sensible (no effect). Following a contradicted hint is
still 52.0% sensible (vs 61.9% for an uncontradicted one) but 38.0% repeated-rejected vs 18.5%. So the grader
prefers the hint even when history argues against it, but the contradiction raises the chance of a loop. The fix is
to stop emitting a hint that the gate will refuse, not to drop hints.

### 3.5 Task "Nothing to do" and CARRYING nudges
TASK "Nothing to do" (10.8% of population) : no difference in sensible (-0.6 pp), fewer "ignored" by construction.
Off-task CARRYING/deposit nudge: +4.4 pp (small; probably the deposit option is often right).

## 4. Design rules for the new prompt (hypotheses, backed by the numbers above)

1. **Lead with one action-level directive and make the hint the default.** Keep TASK + PROGRESS + HINT first
   (as now) but phrase the hint as the recommended call with args (`RECOMMENDED: gather {block: dirt, count: 3}`).
   Basis: follow +21.6 pp; hint skill acceptable in 76% of ignored cases; only 38% uptake.
2. **Never recommend what the gate will refuse.** Compute the hint after cooldown / learned_avoid filters; if the
   preferred skill is blocked, the hint must name the fallback. Basis: 53% of prompts carry a hint contradicted by the
   same prompt; following those loops 38% vs 18.5%.
3. **Present refusals as a short BLOCKED list, not as event-log lines.** One line per blocked (skill, args) with
   expiry and the remedy: `BLOCKED NOW: gather dirt (unreachable, 3 tries; until 2 min) -> try explore 60 or gather
   grass_block`. Remove blocked options from the offered schema/enum if the runtime allows it (the only mechanical
   fix). Basis: refusal-of-chosen-skill OR 3.72 for repeat; 78% repeat when LAST ACTION already failed.
4. **Collapse `repeat_loop` floods.** Replace N identical `rejected: repeat_loop` lines with one line naming the
   repeated action and what to do instead. Basis: sensible 48% -> 23% across 0 -> 6+ rejection lines; the population
   holds 1,102 such lines in 933 prompts.
5. **Shrink LESSONS to current-situation facts.** Drop cross-run "failed Nx / worked Nx" counts unless they match the
   current position/target; cap at ~5 lines. Basis: lessons near-flat (MH -1.7 / -7.2 pp) and they contradict hints.
6. **Length budget: ~1,000 tokens is fine; spend it on the above, not on more history.** No length effect in the
   800-1,150 range (MH +1.2 pp); do not extrapolate. Recommend RECENT EVENTS <= 6 deduplicated lines, LESSONS <= 5.
7. **Log the system prompt / offered skill list** with each decision, so skill-count and order effects can be measured
   next time.

## 5. Variants worth testing offline (replay the same states, grade blind, qwen2.5:7b first)

Use stratified replay of slices 1-3 states (oversample `rej_chosen` and hint-ignored cells), grade with the v3 rubric,
compare per stratum; report sensible, repeated_rejected, ignored_task_or_hint with denominators.

| variant | change vs current | main metric expected to move |
|---|---|---|
| V0 control | current prompt verbatim | - |
| V1 BLOCKED block | rejections pulled out of RECENT EVENTS into a top BLOCKED list with remedies; repeat_loop collapsed | repeated_rejected down |
| V2 RECOMMENDED call | hint rewritten as a full recommended call with args, computed after gate filters | ignored_task_or_hint down, sensible up |
| V3 enum pruning | V1 + blocked (skill,args) removed from the tool schema/allowed list | repeated_rejected near 0 by construction; check for new dead ends |
| V4 lean | V2 + LESSONS <=5 situation-matched lines, RECENT EVENTS <=6 dedup lines (~650 tokens) | tests whether less history hurts; length effect outside current range |
| V5 (optional) | V2 with hint placed last (just before the answer) | position effect, untestable in logs |

## Appendix: full script output

### Results: prompt features vs Opus v3 grades

slice0 (SRS) rows with prompt+label: 933; slices 1-3 (stratified): 30000

Population (slice0): sensible 328/933 = 35.2% (CI 32-38); unclear 13; ignored task/hint 142; repeated rejected 371
Design-weighted slices 1-3 sensible: 36.7% (cross-check of slice0)

## A. What the prompts look like (slice0 = population)

| feature | p10 / median / p90 |
|---|---|
| chars | 3206 / 3919 / 4533 |
| tok | 802 / 980 / 1133 |
| task_pos | 0 / 0 / 67 |
| hint_pos | 59 / 89 / 202 |
| n_recent | 10 / 12 / 12 |
| n_rejected | 0 / 3 / 8 |
| n_failed | 0 / 2 / 7 |
| n_repeat_loop | 0 / 0 / 4 |
| n_lessons | 9 / 13 / 15 |
| n_lesson_fail | 0 / 3 / 6 |

| flag | share of slice0 |
|---|---|
| has_HINT | 89.2% (832) |
| hint_names_skill | 82.4% (769) |
| task_nothing | 10.8% (101) |
| has_CARRYING | 46.2% (431) |
| has_IN WATER | 12.8% (119) |
| any_rej_skill | 52.8% (493) |
| rej_chosen | 32.8% (306) |
| lesson_fail_chosen | 37.3% (348) |
| recent_fail_chosen | 46.1% (430) |
| last_same | 24.2% (226) |
| contra_hint_rej | 21.1% (197) |
| contra_hint_lesson | 40.0% (373) |
| contra_hint_recentfail | 39.3% (367) |
| contra_any | 53.3% (497) |
| carry_nudge_offtask | 32.0% (299) |

Section orders seen: 45; top: TASK>PROGR>HINT>TRIGG>STATE>INVEN>CAN>CAN>CARRY>NEARB>BLOCK>ELEVA>KNOWN>LAST>LESSO>RECEN (246); TASK>PROGR>HINT>TRIGG>STATE>INVEN>CAN>CAN>NEARB>BLOCK>ELEVA>KNOWN>LAST>LESSO>RECEN (245); TASK>PROGR>HINT>TRIGG>STATE>INVEN>CAN>NEARB>BLOCK>ELEVA>KNOWN>LAST>LESSO>RECEN (88)

Models in slice0: {'qwen2.5:7b-instruct': 854, 'qwen3.5:9b': 2, 'r3-qwen35-4b-q8': 49, 'gemma4:26b': 25, 'qwen2.5:14b-instruct': 3}

## B. Population rates by feature (slice0, raw, not adjusted)

#### approx tokens (chars/4)

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| <1050 | 275 | 33.5% | 28-39 | 16.7% | 39.3% |
| <1150 | 213 | 35.2% | 29-42 | 16.0% | 39.9% |
| <850 | 156 | 32.1% | 25-40 | 14.1% | 44.2% |
| <950 | 221 | 37.6% | 31-44 | 15.4% | 36.2% |
| >=1150 | 68 | 41.2% | 30-53 | 8.8% | 42.6% |

#### hint and whether bot followed it

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| chose hint skill | 290 | 46.9% | 41-53 | 5.5% | 44.1% |
| chose other | 479 | 31.1% | 27-35 | 24.2% | 35.1% |
| hint, no skill | 63 | 22.2% | 14-34 | 4.8% | 57.1% |
| no hint | 101 | 28.7% | 21-38 | 6.9% | 38.6% |

#### rejection lines in RECENT EVENTS

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| <1 | 120 | 48.3% | 40-57 | 25.0% | 19.2% |
| <3 | 298 | 43.6% | 38-49 | 17.8% | 29.5% |
| <6 | 308 | 30.2% | 25-36 | 13.3% | 46.4% |
| >=6 | 207 | 22.7% | 18-29 | 8.7% | 56.5% |

#### rejection names the chosen skill

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| chosen skill rejected (cooldown/avoid) in recent | 306 | 19.3% | 15-24 | 6.9% | 67.3% |
| not | 627 | 42.9% | 39-47 | 19.3% | 26.3% |

#### hint vs history contradiction

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| hint contradicted by history | 497 | 38.6% | 34-43 | 12.7% | 39.2% |
| no contradiction | 436 | 31.2% | 27-36 | 18.1% | 40.4% |

#### era

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| aug-sep | 421 | 32.5% | 28-37 | 11.2% | 43.9% |
| nov | 228 | 42.1% | 36-49 | 23.7% | 29.4% |
| oct | 284 | 33.5% | 28-39 | 14.4% | 41.9% |

#### model

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| gemma4:26b | 25 | 48.0% | 30-67 | 20.0% | 28.0% |
| qwen2.5:7b-instruct | 854 | 33.8% | 31-37 | 15.1% | 41.2% |
| r3-qwen35-4b-q8 | 49 | 51.0% | 37-64 | 16.3% | 22.4% |

## C. Stratified slices 1-3: raw rates (NOT population; for within-stratum contrasts)

#### approx tokens

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| <1050 | 9516 | 34.3% | 33-35 | 29.7% | 24.5% |
| <1150 | 6729 | 35.7% | 35-37 | 28.0% | 24.4% |
| <850 | 4650 | 31.9% | 31-33 | 26.0% | 28.0% |
| <950 | 6518 | 32.3% | 31-33 | 28.2% | 27.9% |
| >=1150 | 2587 | 36.6% | 35-38 | 22.9% | 26.8% |

#### hint followed

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| chose hint skill | 7010 | 55.4% | 54-57 | 8.2% | 31.4% |
| chose other | 18346 | 27.4% | 27-28 | 39.8% | 20.7% |
| hint, no skill | 1611 | 24.8% | 23-27 | 10.6% | 47.4% |
| no hint | 3033 | 29.5% | 28-31 | 9.8% | 33.9% |

#### rejection lines in recent events

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| <1 | 7452 | 38.3% | 37-39 | 38.7% | 13.8% |
| <3 | 10543 | 36.2% | 35-37 | 28.4% | 21.4% |
| <6 | 7853 | 30.4% | 29-31 | 21.7% | 35.1% |
| <9 | 2921 | 28.2% | 27-30 | 18.1% | 41.7% |
| >=9 | 1231 | 25.6% | 23-28 | 18.4% | 42.6% |

#### repeat_loop rejection lines

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| <1 | 21635 | 34.8% | 34-35 | 29.0% | 24.1% |
| <3 | 5777 | 32.1% | 31-33 | 24.7% | 30.8% |
| <6 | 1431 | 32.0% | 30-34 | 25.4% | 31.5% |
| >=6 | 1157 | 30.7% | 28-33 | 24.6% | 29.3% |

#### failed lines in recent events

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| <1 | 8742 | 34.6% | 34-36 | 39.2% | 17.6% |
| <2 | 5938 | 40.0% | 39-41 | 31.7% | 16.9% |
| <4 | 7655 | 36.4% | 35-38 | 25.7% | 24.3% |
| >=4 | 7665 | 26.2% | 25-27 | 13.8% | 44.0% |

#### lesson lines

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| <10 | 3003 | 36.9% | 35-39 | 18.2% | 31.1% |
| <14 | 14989 | 34.5% | 34-35 | 26.6% | 26.5% |
| >=14 | 12008 | 32.6% | 32-33 | 31.7% | 23.9% |

#### chosen skill shown as refused (recent) / failing (lessons)

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| +lesson | 3477 | 45.7% | 44-47 | 15.7% | 26.3% |
| neither | 20916 | 35.0% | 34-36 | 34.9% | 16.6% |
| rej | 2847 | 18.2% | 17-20 | 12.5% | 64.0% |
| rej+lesson | 2760 | 28.2% | 27-30 | 5.4% | 57.1% |

#### hint contradicted by rejection/failure of same skill

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| contra | 15142 | 37.8% | 37-39 | 24.6% | 24.7% |
| no skill hint | 4644 | 27.9% | 27-29 | 10.1% | 38.6% |
| none | 10214 | 31.1% | 30-32 | 40.7% | 22.0% |

#### contradiction x followed hint

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| None | 4644 | 27.9% | 27-29 | 10.1% | 38.6% |
| clean+chose hint | 2378 | 61.9% | 60-64 | 14.3% | 18.5% |
| clean+other | 7836 | 21.7% | 21-23 | 48.7% | 23.1% |
| contra+chose hint | 4632 | 52.0% | 51-53 | 5.0% | 38.0% |
| contra+other | 10510 | 31.6% | 31-32 | 33.2% | 18.9% |

#### chose same skill as a failed/rejected LAST ACTION

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| False | 27864 | 35.7% | 35-36 | 29.6% | 21.9% |
| True | 2136 | 12.2% | 11-14 | 4.8% | 78.3% |

#### HINT char offset

| group | n | sensible | 95% CI | ignored task/hint | repeated rejected |
|---|---|---|---|---|---|
| <100 | 11687 | 34.0% | 33-35 | 27.9% | 27.5% |
| <200 | 10974 | 35.7% | 35-37 | 28.4% | 25.3% |
| <300 | 4306 | 32.7% | 31-34 | 38.7% | 17.6% |
| none | 3033 | 29.5% | 28-31 | 9.8% | 33.9% |

## D. Mantel-Haenszel risk differences within model x era x skill (slices 1-3)

| feature (true vs false) | RD sensible (pp) | RD repeated-rejected (pp) | RD ignored (pp) | rows in informative strata | n true |
|---|---|---|---|---|---|
| long | +1.2 | +0.7 | -2.0 | 29741 | 9311 |
| has_HINT | +0.6 | -4.0 | +11.7 | 25161 | 22160 |
| hint_names_skill | +5.2 | -10.1 | +10.7 | 26636 | 22029 |
| follow | +21.6 | -5.7 | -2.5 | 13773 | 6961 |
| hint_late | +0.9 | -5.0 | +0.6 | 19066 | 6177 |
| many_rej | -8.1 | +14.4 | -4.8 | 29556 | 11996 |
| any_fail | -4.5 | +8.7 | -7.3 | 29848 | 21164 |
| many_lessons | -1.7 | +0.3 | +1.1 | 26533 | 23531 |
| rej_chosen | -21.3 | +37.4 | -8.4 | 24866 | 5605 |
| lesson_fail_chosen | -7.2 | +12.7 | -2.4 | 17642 | 6227 |
| recent_fail_chosen | -21.0 | +37.9 | -10.2 | 27922 | 9464 |
| contra_any | +0.9 | -1.8 | -3.6 | 29892 | 15106 |
| carry_nudge_offtask | +4.4 | -3.4 | -3.2 | 29719 | 9322 |
| task_nothing | -0.6 | +4.0 | -11.7 | 25161 | 3001 |
| has_CARRYING | +1.3 | -1.3 | +1.0 | 29754 | 13307 |

## E. Logistic regression, slices 1-3, sensible ~ features + FE(model, era, top skills)


outcome = ok; n = 30000; SEs ignore clustering by session (optimistic)

| term | odds ratio | 95% CI |
|---|---|---|
| tok_k | 2.45 | 1.98-3.02 |
| rej_n | 0.93 | 0.92-0.94 |
| fail_n | 0.88 | 0.87-0.90 |
| rej_chosen | 0.40 | 0.37-0.43 |
| lesson_fail_chosen | 0.87 | 0.79-0.96 |
| hint_skill_follow | 1.74 | 1.49-2.04 |
| hint_skill_other | 0.57 | 0.49-0.67 |
| contra_any | 1.18 | 1.10-1.27 |
| task_nothing | 1.06 | 0.91-1.24 |

outcome = rep; n = 30000; SEs ignore clustering by session (optimistic)

| term | odds ratio | 95% CI |
|---|---|---|
| tok_k | 0.51 | 0.41-0.65 |
| rej_n | 1.15 | 1.13-1.16 |
| fail_n | 1.31 | 1.28-1.33 |
| rej_chosen | 3.72 | 3.46-4.00 |
| lesson_fail_chosen | 1.25 | 1.14-1.38 |
| hint_skill_follow | 1.02 | 0.87-1.19 |
| hint_skill_other | 0.95 | 0.82-1.10 |
| contra_any | 0.77 | 0.71-0.83 |
| task_nothing | 0.92 | 0.79-1.07 |

## F. Same model on slice0 (population, small n) as a direction check

| term | odds ratio | 95% CI |
|---|---|---|
| tok_k | 2.28 | 0.72-7.19 |
| rej_n | 0.87 | 0.82-0.92 |
| fail_n | 0.82 | 0.74-0.90 |
| rej_chosen | 0.39 | 0.26-0.57 |
| lesson_fail_chosen | 0.87 | 0.61-1.25 |
| hint_skill_follow | 1.13 | 0.52-2.46 |
| hint_skill_other | 0.46 | 0.21-0.99 |
| contra_any | 1.42 | 0.98-2.06 |
| task_nothing | 0.71 | 0.32-1.56 |

## G. When the hint names a skill and the bot did not take it: was the hint skill acceptable to the grader?

slices1-3: 18346 rows; hint skill in grader's acceptable list 13910 (75.8%); of which hint was contradicted by history 7104
followed hint: 7010 rows, sensible 55.4%
followed a hint that history contradicts: 4632 rows, sensible 52.0%, repeated-rejected 38.0%

repeated_rejected rows 7780: chosen skill named in a rejection line 43.7%; in a failing lesson 32.0%; in a recent failure 64.2%; >=3 repeat_loop lines 10.2%; chose hint skill 28.3%
