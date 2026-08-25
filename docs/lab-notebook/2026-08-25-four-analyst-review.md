# Four analysts, one brief, then the same four in a room

**2026-08-25.** ChatGPT, `gpt-oss:120b`, `llama3.3:70b` and Claude were each
given an **identical** 124-line brief — architecture, codebase metrics, measured
fleet behaviour, known defects, and the open-source landscape — and answered
**independently**. Then all four answers were put in front of two adjudicators
(ChatGPT and `gpt-oss:120b`) for a joint conclusion.

The point was partly the analysis and partly the method: do they converge?

## What all four agreed on, unprompted

1. **The agent is weak in a way the research framing does not excuse.** 0 of 80
   bots past `stone_pickaxe` in 20 days; gather and craft both ~29%; 18 of 80
   with no tool tier at all.
2. **The memory experiment is currently confounded by base-agent dysfunction.**
   ChatGPT put it best: *"You are mostly measuring how memory treatments
   interact with broken mobility, rescue, and curriculum plumbing."*
3. **The 79% overhead figure is not 79% of time.** Event counts overweight a
   500ms reflex that logs per firing against a gather that logs once.
4. **`path_reset` at 19.3% is an ownership problem, not a pathfinder-quality
   problem.** Three layers can move the body.
5. **The ceiling is skills/goals, not the 7B model.**

## Where they disagreed, and who won

| Question | Positions | Adjudicated |
|---|---|---|
| Is the 30s cadence the bottleneck? | `gpt-oss` yes (recommended a 20B for "30× speedup"); Claude no | **Claude.** Block 1 measured actions/hour FLAT at 46–65 across a 44× productivity range — the difference was allocation and execution, not throughput. |
| Pathfinder library or ownership? | `gpt-oss`/`llama` said swap to Baritone; ChatGPT/Claude said arbitration | **Ownership.** Replacing the planner while goals churn every 33s just gives a better planner the same contradictory instructions. |
| Curriculum or healthy baseline first? | `gpt-oss`/`llama` curriculum; ChatGPT/Claude baseline | **Baseline.** A curriculum on broken movement drives bots into failure faster. |
| Is 44% comments bloat? | Three said suspicious; Claude said incident records | **Claude**, per ChatGPT: *"Comment density alone is not a defect."* Six silently-broken instruments were found this week by reading them. |

## The local model audited itself

Given its own analysis anonymised among the others, `gpt-oss:120b` identified
**its own** unit error — *"0.5s → 40 events/s for 80 bots, whereas the actual
tick frequency is 2 Hz → 160 events/s"* — flagged its own unsourced statistics,
and adjudicated **against its own headline recommendation**. That is a genuinely
useful property and an argument for the joint pass as a technique.

It also produced a false positive: it accused ChatGPT of citing unverifiable
figures that were in fact supplied in the brief.

## The thing only the joint pass found

Independent passes produced overlapping advice. The **joint** pass produced one
finding nobody reached alone, from ChatGPT:

> *"Exposure-weighted bot-hour is not automatically valid when bots become
> inactive, stranded, trapped at y=320, or repeatedly rescued into the same
> hazard. If one memory arm changes hazard exposure, walking distance, lectern
> interaction, rescue frequency, or stuck probability, the endpoint can be
> biased even if the numerator is correct."*

The board arm **must walk to a lectern**. Walking changes water exposure. So the
treatment can move the denominator through a path that has nothing to do with
learning.

**Measured, 3h, per arm:**

| arm | water % of events | exposure-hours | buckets EXCLUDED | stuck events |
|---|---|---|---|---|
| board | 30.7% | 39.8 | **34%** | 396 |
| hive | 34.3% | 44.2 | **26%** | 271 |
| isolated | 39.1% | 30.5 | **49%** | 661 |
| placebo | 47.0% | 45.9 | **23%** | 196 |

**Exclusion rates differ by more than 2× across arms, and stuck events by 3.4×.**
Half of `isolated`'s time fails the ≥8-block exposure rule and is dropped from
the denominator; less than a quarter of `placebo`'s is.

The current endpoint reads hive 9.87, isolated 8.33, board 7.78, placebo 4.64
gathers per exposure-hour — but those are computed over denominators that have
been censored at very different rates.

**Caveat, stated plainly:** this is 3 hours of shakedown data, arms are not
supposed to be compared yet, and same-treatment pools already differ 1.8–2.0×.
Nothing here is significant. What is demonstrated is the **mechanism**: the
exclusion rule is differentially applied by arm, and nothing in the analysis
plan would surface it.

## Ranked actions, merged from both adjudicators

1. **Audit the milestone chain for unreachable rungs.** `deposit_surplus`
   required being 15 blocks from home when the median bot is 804 away — zero
   deposits in six hours. Nobody checked the other rungs. ~1 day, highest value.
2. **Single movement arbiter.** One owner of the body; goals queue rather than
   contest. Cuts `path_reset` churn and makes attribution possible.
3. **Wall-clock state telemetry**, not event counts: seconds under reflex
   ownership, pathing, skill-active, LLM-wait, stuck. The `seizedAt`/release
   pairs already exist and have never been aggregated.
4. **A competence gate before the memory experiment resumes.** Water escape,
   abort honoured, stone pickaxe within 30 minutes. If the base agent fails
   these, the memory result means nothing.
5. **Skill contracts**: timeout, abort polling, heartbeat, cleanup, evidence.
   Partly landed today as the runner hard-stop.
6. **Deterministic tech-tree curriculum in the prompt.** `CAN CRAFT NOW` already
   proved the mechanism moved a ten-hour-stuck bot within minutes.
7. **Split `skills.mjs`** (3,310 lines) by domain.
8. **Treat stuck/inactive/dead as endpoints, not exclusions** — the censoring
   finding above.
9. Regression tests for every incident already observed.
10. Model/cadence A/B **only after** 1–6, since model impact is currently
    confounded.

## Method verdict

Independent passes agreed on the obvious and split on the arguable. The joint
pass **resolved every split in the same direction as the two analysts with
access to the actual measurements**, caught fabricated precision that no
independent pass would have flagged, and produced one finding of real
experimental consequence that none of the four reached alone.

Worth repeating. The cost was about 20 minutes of wall clock and one idle GPU.
