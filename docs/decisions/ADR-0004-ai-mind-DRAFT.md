# ADR-0004 (DRAFT): An AI mind instead of a decision tree

**Date:** 2026-11-22 · **Status:** Draft for the owner · **Supersedes in part:** ADR-0002
**Reviewed by:** Claude (draft), Codex (critique), outside research (papers and projects below)

## The diagnosis

ADR-0002 already lets a model pick one skill per event. It turned into a tree because **deterministic code
owned the decisions**: about 47 orders in `cognitive.mjs` run before `llm.decide`, admission vetoes on
"relevance", and the controller decides the task order. Every bad choice by the model added another exception.
Codex also found **interface defects that look like bad reasoning**: arguments missing from the schema,
resources missing from the observation, and failures blamed on the world when the controller had interrupted
the skill. A bigger model fixes none of that.

> **The problem is who has authority, and whether the action contracts hold. It is not how smart the model is.**

## Architecture: one owner per decision

| Layer | Owns | Notes |
|---|---|---|
| **Execution kernel** (code) | movement, safe interaction, cancel, deadlines, emergency preemption (air, lava, falls, flee) | Pathfinder is part of execution, not a reflex. Measure preemption latency rather than assuming it. |
| **Skill registry** (code) | each skill's args schema, preconditions, effects, timeout, cancellation, **typed outcomes** (`inventory_full`, `target_unreachable`, `missing_tool`, `preempted`, `unknown`) with evidence and partial progress | The model's schema and the skill descriptions in its prompt are **generated** from the registry. A skill dependency graph (as in Plan4MC) shows which skills can run now and why the others are blocked. |
| **Executive** (model, fast) | the current subgoal and the next skill; recovery; asks for a new plan | Sees which skills are feasible and the reasons the others are blocked. "Unknown" stays distinct from "impossible". |
| **Planner** (model, slow) | breaking goals into a short subgoal graph with budgets and completion predicates; assigning work across bots | Code stores and checks the plan. It runs on start, when a subgoal completes, on a discovery, or after repeated lack of progress, **not on a timer**. Plans carry a version, and stale answers are discarded. |

**Rules against drifting back into a tree:**
1. Only one component commands a bot.
2. Admission enforces safety and real execution limits only. Strategic relevance is **advisory**.
3. A new deterministic branch must be safety, a skill contract, or scheduling. Anything else becomes planner or executive behaviour plus an evaluation case.

This matches PIANO (Project Sid), where a single controller is the only place decisions are made.

## Models: measure the split, don't assume it

- **Step 1:** one mid-sized model serving both roles through separate prompts and queues. This isolates the gain from fixing authority and interfaces.
- **Step 2:** a small executive (Qwen3-8B, xLAM-2-8B or Granite-class at Q4/Q5, thinking off, grammar-constrained) plus a bigger planner (Qwen3-14B at Q4). Choose which card runs which from measured VRAM and latency **under the 3090 tenant's load**.
- Benchmark with 1, 4 and 6 bots. **Measure queue delay separately from inference time.** One finding: Qwen3-8B's tool-calling results changed between identical runs in up to 147 of 800 conversations, so a run-to-run noise test is part of choosing the model.
- The fast/slow split is standard practice (Figure Helix, NVIDIA GR00T): the slow model sets intent and never blocks the fast loop.

## Learning: evidence first, reflection second

Three stores:
1. **World facts:** locations, stock and hazards, each scoped to a world and timestamped, and invalidated when stale.
2. **Episodes:** observation → proposal → admitted action → what actually executed → outcome → measured change.
3. **Lessons:** conditional hypotheses that cite the episode IDs behind them, with scope, expiry, confidence and contradicting evidence.

A reflection only *proposes* a lesson. A lesson is promoted after it beats a baseline without it in later trials,
and it is retired when contradicted. **A model-written lesson never becomes a hard veto.** Store only verified
outcomes ("intent rows are not outcomes"). Good: "gather failed at X: no standable adjacent cell." Bad: "never gather oak."

Skill learning starts with **compositions of existing skills**. Code generated in the Voyager style comes later,
with a test sandbox, versioning, a critic check before a skill is stored, and retirement by success rate.
Distillation into the small model uses **verified successful trajectories only**.

## Multiple bots (last)

Keep chatter to a minimum. MINDcraft measured up to a 15% drop when agents must explain detailed plans to each other.
Shared state lives on the work board. The planner assigns work. Expiring reservations on tasks, resources and
areas prevent collisions. A bot raises a problem with the others only through a gate.

## Migration (no rewrite)

1. Add a feature-flagged executive beside the current controller. Keep the runner, reflexes, telemetry and rollback.
2. Write contracts for 10–15 skills that make a complete repertoire, including inspection, inventory relief, navigation and recovery. Test interrupted and partial runs.
3. Run the executive in **shadow mode** to surface schema and observation defects. Agreement with the tree is not the goal.
4. Turn the orders off **in the experimental arm only**. Turn their knowledge into observations, preconditions and plan templates.
5. Delete the old selection code only after the new path covers the same capabilities.

## First experiment

Twelve cloned starting snapshots across seeds, covering fresh survival, a full or constrained inventory, and an
obstructed resource. Compare the **legacy controller and the new executive with the same model, skills, reflexes,
compute and memory off**. Each run gets 60 minutes to make stone tools, secure food, and complete a shelter that can be checked.

- **Primary:** completion rate and time to completion, with unfinished runs reported.
- **Secondary:** deaths per bot-hour, time without progress, recovery time, repeated failures, admission rejection rate, human interventions, queue latency, stale-response rate.
- **Advance if:** at least 20% less time without progress, no lower completion rate, and no extra deaths. Then test the model split and memory, one at a time.

## Top risks → containment

broken skills that look like bad reasoning → contract tests · safety gates rebuilding the tree → the authority rules ·
stale plans → plan versions · polluted memory → promotion only on evidence · GPU saturation → bounded queues and fewer bots ·
coordination deadlock → expiring reservations · local 8–14B models weaker than the GPT-4-class models most papers used → expect a gap and measure it.

## Fit with standing constraints

The consolidation rule (the fleet queue takes fixes only) and the 11-20 order of work both apply. This runs in the
**test world only**, needs no new hosts, and uses the 5080 and 3090. It needs the owner's yes to start, as new work during consolidation.

## Sources
Voyager arxiv.org/abs/2305.16291 · Project Sid/PIANO arxiv.org/abs/2411.00114 · GITM 2305.17144 · DEPS 2302.01560 ·
Plan4MC 2303.16563 · JARVIS-1 2311.05997 · Optimus-1 2408.03615 · Odyssey 2407.15325 · Generative Agents 2304.03442 ·
MemGPT 2310.08560 · MINDcraft/MineCollab 2504.17950 · gated coordination 2604.18975 · Figure Helix figure.ai/news/helix ·
GR00T N1 2503.14734 · Qwen3-8B tool-call noise arxiv.org/pdf/2611.02978 · BFCL gorilla.cs.berkeley.edu/leaderboard.
(Checked this session: Sid, MINDcraft, gated coordination, Qwen3 noise. The others were summarised from knowledge and not re-read.)
