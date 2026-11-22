# Using our ELK data to build the AI mind

**2026-11-22** · Sources: a 7-day survey of Elasticsearch (Claude), a critique of the approach (Codex), and outside research.
Goes with [ADR-0004 (draft)](../decisions/ADR-0004-ai-mind-DRAFT.md).

## Bottom line

**Use ELK first to build an honest evaluation layer and a reliable action interface. Train models later.**
The data does not show that the model is too weak. It shows that the model's choices fail or get thrown away,
mostly for reasons outside the model: interrupted actions, bad arguments, skills offered when they cannot work,
and outcomes nobody checked. A bigger or fine-tuned model trained on today's logs would learn those defects.

## What the data says

Window: 7 days to 11-22 ~15:20Z. The fleet skill stream covers only 69.6 h of that window.

| | Fleet (80 bots) | Showcase (15 bots) |
|---|---|---|
| Skill/event rows | 7,426,361 | 2,734,614 |
| Distinct row kinds | 355, of which **319 are internal `_` events** | 400 (365 internal) |
| Model decisions | 678,248 (qwen2.5-7B 352k, Qwen3.5-4B 326k) | 163,775 (qwen2.5-7B) |
| Decision outcome | success 30% | **success 32%, aborted 35%, failed 17%, no_effect 11%, unknown 5%** |
| Latency (p50 / p90 / p99) | 2.6 s / 4.4 s / 6.3 s | 1.1 s / 4.1 s / 6.3 s |
| Prompt / answer size | ~2.5k / ~55 tokens | same |

**What wakes the model** (showcase): `idle` causes **88%** of calls. `entombed`, `stuck`, `stagnation` and restarts cause most of the rest.

**Gate rejections** (showcase, `llm.error`): repeat_loop 14,142 · **bad_args 10,540 (6.4%)** · deposit_nothing_to_bank 8,949 ·
cooldown 5,954 · unreachable_elevation 4,381 · learned_avoid 1,092. The fleet shows the same pattern at larger scale.

**Model-chosen skills and how they ended** (showcase):

| Skill | Chosen | Result |
|---|---|---|
| gather | 42,943 | success 24%, failed 39%, aborted 36% |
| goto | 25,390 | success 43%, aborted 43% |
| explore | 16,611 | success 52% |
| mine | 12,687 | success 32%. Its fleet `fail_class` is mostly **`unverified`** (13.7k): nothing measured the result |
| build_shop | 12,471 | success 24%, no_effect 55% |
| **deposit** | 11,077 | **aborted 90%** |
| craft | 5,387 | success 23%, failed 43% |
| withdraw | 2,020 | failed 55% |
| status | 6,457 | no_effect 92%. It is a read, so "world unchanged" is the wrong test |

**Top failure classes** (fleet): gather is *unreachable* 10.9k, *no_path* 10.8k, *interrupted* 7.5k, *no_safe_target* 7.2k.
goto is *no_measurable_change* 12.3k, *no_path* 9.5k, *interrupted* 8.7k, *goal_changed* 5.1k, *stranded* 4.1k.

### How to read these numbers (Codex and Claude agree)

- **"35% aborted" is not a 35% model error rate.** It mixes gate rejections, an order taking over, a reflex preempting,
  timeouts and cancellations. Today the logs cannot say **who** stopped an action.
- **6.4% bad_args is a fault in the interface.** The prompt, the output schema and the runtime validator must all be
  generated from one skill registry.
- **Deposit at 90% aborted is the first case to trace.** The model keeps picking deposit when nothing is bankable
  (8,949 such rejections). That suggests the model cannot see that the skill is unavailable, but it needs proof by joining the rows.
- **88% idle triggers means the model is mostly polled.** Wake it on meaningful changes, and let it choose "wait until X".
- **Rows are not experiences.** Millions of `_path_reset` and `_affordance_scan` rows are internal logging, not decisions.
  Fleet and showcase numbers come from different models, loads and worlds, so do not use them to rank models.

## The approach

### 1. Pipeline: raw → episodes → cases, lessons and training data
`immutable raw export (stable ES cursor, doc id kept) → normalised events → linked episodes → {eval cases, candidate lessons, curated training}`

Each episode records **observation → proposal → admission → executed action → how it ended → verified effect**, with
four separate labels:
- **admission:** accepted or rejected, and why
- **execution:** completed, failed, preempted, timed out or unknown
- **effect:** predicate met, partial, unchanged or unverified
- **attribution:** model, controller, reflex, executor, environment or unknown, with evidence

Fields we already log: the full prompt, response, `tool_calls`, milestone, admission, error, latency, tokens, and for each skill
args, duration, `fail_class`, detail, position, inventory, health and perception.
**Fields to add:** `decision_id`, `execution_id`, the goal or plan version, the session, the code/model/prompt/registry versions,
**who cancelled and why**, and observation ids before and after. Past rows can only be joined by timestamp, which is
provisional; ambiguous joins stay *unknown*. Store episodes in Parquet on the NAS or ci2. ES stays the search view.

### 2. Skill contracts, using the data
Start with the 10–15 skills that make up a full survive-and-recover loop. That means the high-volume ones above
(gather, goto, explore, mine, deposit, craft, withdraw, home, surface, place, smelt), plus inspect, inventory relief and recovery.
Each contract declares typed arguments, preconditions it can observe, expected effects, a timeout, how it cancels,
how it reports partial progress, and what evidence proves success. Examples: deposit proves it by items leaving the bag and arriving in the chest;
goto by arriving within tolerance; status by fresh observations. The existing `fail_class` values seed the typed outcomes.

### 3. An evaluation set mined from logs
Freeze about **300 decision-time cases**, stratified: deposit rejections, bad arguments, unreachable gathers, full bags,
interrupted moves, missing craft inputs, successful recoveries, and normal successes. Label the *acceptable* choices,
not a single right answer. Never let information from after the action leak into the inputs.
- **Offline:** replay decisions only. Historical prompts cannot replay physics.
- **Live:** seeded snapshots of the new test world, comparing the old controller and the new executive on the same model,
  with paired runs over repeated seeds. MCU's lesson applies: score progress, not only pass/fail.

### 4. Lessons (no training)
Cluster failures by **typed cause and context**, not by free-text similarity. A reflection step drafts conditional
lessons that cite episode ids, with scope, expiry and contradicting evidence. Lessons are promoted only after controlled trials and are never turned into hard vetoes.
Methods to borrow: **ExpeL** (compare successes with failures), **AutoGuide** (guidelines tied to a context, from offline logs),
**Agent Workflow Memory** (skill sequences that keep succeeding become macros for the planner), and **Synapse** (retrieve past trajectories
by the shape of the state as examples).

### 5. Training (later, and only with clean labels)
- **Train on verified corrective decisions and successful continuations, including recoveries.** Never train on raw logs.
  Plain behaviour cloning of a policy that succeeds 32% of the time copies its mistakes.
- Methods: filtered behaviour cloning or ReST, then **ETO-style DPO** on success/failure pairs from the *same state*,
  or **KTO** where only one labelled row exists. Mix in general instruction data, as AgentTuning does, to avoid losing general ability.
- Size: **1k–10k cleaned, deduplicated examples** is a sensible first LoRA (FireAct, LIMA).
  **QLoRA of Qwen3-8B fits the 5080**; 16-bit LoRA fits the 3090 (Unsloth's requirements page).
- Split by **time and world or bot**, never by random row, and keep unseen worlds for testing. Filter by code sha, because
  rows from old code describe skills that have since changed.
- No automatic nightly retraining. Iterate deliberately: deploy, log, retrain, re-test.

### 6. Model choice
Keep the deployed model first so the architecture's gain shows on its own. Then compare **Qwen3.5-4B and Qwen3-8B
(non-thinking)** under the same contracts. Add a bigger planner only if measured planning improves. Benchmark 1, 4 and 6 bots,
with queue delay measured separately from inference, under the 3090's real tenant load.

## Data-quality traps
- **Attribution:** an action interrupted by an order is not a model mistake. A dangerous proposal that gets cancelled is not innocent either.
- **Intent is not outcome**: the same lesson as "banked two pickaxes", which was logged but never happened.
- **The `detail` remedy text is advice, not ground truth.** It is also a text field, so ES cannot aggregate it.
- **ES:** it cannot tell null from absent; 10-07 is duplicated; about 50 rows a day are lost at log rotation. Gates and lessons use the files.
- **Survivorship:** easy states succeed whatever the model picks, so compare within similar states.

## Week 1
1. **Days 1–2:** trace deposit, bad_args and interruptions end to end, and add the attribution fields (who cancelled and why).
2. **Days 3–4:** build the skill registry for the first 10–15 skills, with prompt, schema and validator generated from it, and typed outcome and effect records.
3. **Days 5–7:** freeze the 300-case set, run the new executive in shadow, then a paired pilot in the fresh test world with
   orders turned off only in the experimental arm.

## Do not
Fine-tune on raw logs · count path-reset rows as experience · read missing values as false · trust remedy text as truth ·
train on failures the controller caused · rewrite every skill · generate code skills yet · buy a bigger model before fixing
attribution and contracts.

## Sources
Checked this session: ETO arxiv.org/abs/2403.02502 · MCU arxiv.org/abs/2310.08367 · Unsloth requirements unsloth.ai/docs ·
Project Sid 2411.00114 · MINDcraft 2504.17950. From the researchers' knowledge, not re-read: ExpeL 2308.10144 · Reflexion 2303.11366 · AutoGuide 2403.08978 ·
AWM 2409.07429 · Synapse 2306.07863 · AgentTuning 2310.12823 · FireAct 2310.05915 · Agent-FLAN 2403.12881 · ReST 2308.08998 ·
KTO 2402.01306 · QLoRA 2305.14314 · offline RL 2005.01643 · Qwen model cards on huggingface.co/Qwen.
Survey script and raw numbers: run read-only on 10.0.0.31 (`~/claude-survey`), using `scripts/lib/estelemetry.py`.
