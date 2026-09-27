# Minecraft AI Repository Review and Recommendations

Prepared for Darrell Miller  
Review date: September 27, 2026  
Repository: [dmille6/minecraft-ai-test](https://github.com/dmille6/minecraft-ai-test)  
Reviewed commit: [`268c0742d47ead76b3ec31a2f872f86a57d8ad2a`](https://github.com/dmille6/minecraft-ai-test/commit/268c0742d47ead76b3ec31a2f872f86a57d8ad2a)

## Main Recommendation

**Keep your project and selectively borrow from other projects. Do not replace it with Mindcraft.**

The earlier recommendation to start with Mindcraft assumed a new project. Your repository already contains much of the recommended architecture, including protections that should survive any redesign.

The greatest opportunities are simplifying execution, improving task planning, and making evaluations more representative of actual gameplay. A different model or framework will not automatically solve those problems.

## Review Scope and Limits

The review covered the cognitive loop, skills, reflexes, admission controls, lessons, milestones, arbiter, model evaluator, task work orders, and selected operational and design reports. External comparisons included source inspection of Mindcraft's action manager, item-goal planner, and task harness, plus Voyager's skill manager and the previously researched project documentation.

One targeted local probe reproduced a missing-method failure in the checked-in arbiter interface. The running Minecraft fleet was not accessed, the complete test suite was not run, and no repository or deployment changes were made.

Repository observations below refer to the reviewed commit. Operational numbers in repository reports are historical claims from those reports, not independently remeasured results. Project comparisons concern design and functionality, not a shared benchmark proving one bot plays better.

## What You Are Building

Your project is primarily an **instrumented agent platform**. Its layers divide responsibility among:

1. Deterministic milestones that define objectives and completion.
2. An LLM that proposes a skill and arguments.
3. Admission controls that accept or reject proposals.
4. Skills that perform work and supply outcome evidence.
5. Reflexes that handle immediate survival.
6. Telemetry and deployment controls that help attribute failures.

This division is sensible. The central engineering question is whether these components cooperate reliably.

The September standing instructions in [CLAUDE.md](https://github.com/dmille6/minecraft-ai-test/blob/268c0742d47ead76b3ec31a2f872f86a57d8ad2a/CLAUDE.md) explicitly retire the earlier memory experiment in favor of a reliable foundation and test harness. The recommendations here respect that direction rather than immediately introducing another memory system.

## Comparison With Other Projects

| Project | What it offers beyond your approach | Recommended use |
| --- | --- | --- |
| [Mindcraft](https://github.com/mindcraft-bots/mindcraft) | Broader ready-made agent functionality, provider integrations, item-goal planning, and task definitions. | Borrow item dependency planning and benchmark tasks. Keep your execution and evidence checks. |
| [Mindcraft Community Edition](https://github.com/mindcraft-ce/mindcraft-ce) | Experimental structured tool calling and retrieval-based memory. | Consider provider adapters and selected interface ideas. Retrieval-based memory is not the immediate bottleneck. |
| [Voyager](https://github.com/MineDojo/Voyager) | Acquires and retrieves reusable behaviors rather than selecting only from a fixed skill catalog. | If learning research resumes, borrow verified, reusable sequences of your existing skills. |
| [MineStudio](https://github.com/CraftJarvis/MineStudio) / [ROCKET-3](https://github.com/CraftJarvis/ROCKET-3) | Infrastructure for visual policies and actual model training. | Treat as a separate future research track. They would substantially change the environment and control stack. |
| [XENON](https://github.com/ml-postech/XENON) | Studies correcting task knowledge from experience. | Study representations for revising dependencies, rather than simply accumulating avoid counts. |
| [mc-agents](https://github.com/jblemee/mc-agents) | Simple separation of reflexes, strategy, and persistent memory. | Limited architectural benefit at this stage; your project already has a more elaborate version of this separation. |

There is no evidence from this review that replacing your stack wholesale would improve gameplay. The strongest candidates for reuse are individual planning and evaluation components.

## Strengths to Preserve

### Evidence-Based Outcomes

Your [runner.mjs](https://github.com/dmille6/minecraft-ai-test/blob/268c0742d47ead76b3ec31a2f872f86a57d8ad2a/bots/src/runner.mjs) distinguishes an action returning from an action producing evidence. The implementation distinguishes `unknown`, `failed`, `aborted`, and `no_effect`.

This matters because a timeout should not teach the bot that a destination is impossible, and an interrupted action should not automatically count against the skill.

Compared with Mindcraft's [action manager](https://github.com/mindcraft-bots/mindcraft/blob/develop/src/agent/action_manager.js), your runner has a more explicit evidence requirement at this layer. Mindcraft does have separate task validation, so this is not a claim that it never verifies outcomes.

### Deterministic Survival and Execution

Keeping immediate survival responses outside the LLM is appropriate. Your deterministic skills, cancellation mechanisms, and watchdogs provide useful boundaries for investigating whether a failure came from planning or execution.

### Measurement and Operational Discipline

Failure fixtures, independent observation, concurrent controls, and version attribution are valuable assets. Reuse them to evaluate outside components rather than discarding them during a migration.

Your own [harness design note](https://github.com/dmille6/minecraft-ai-test/blob/268c0742d47ead76b3ec31a2f872f86a57d8ad2a/docs/playbook/harness-is-the-contribution.md) identifies the instrument as a durable part of the project. That is consistent with the recommendation to retain the foundation.

## Priority 1: Finish Movement Ownership

### Confirmed Code Finding

- [index.mjs](https://github.com/dmille6/minecraft-ai-test/blob/268c0742d47ead76b3ec31a2f872f86a57d8ad2a/bots/src/index.mjs) calls `runner.arb.installActuatorGate(...)` when the arbiter is enabled.
- The checked-in [Arbiter class](https://github.com/dmille6/minecraft-ai-test/blob/268c0742d47ead76b3ec31a2f872f86a57d8ad2a/bots/src/arbiter.mjs) does not define that method.
- [config.mjs](https://github.com/dmille6/minecraft-ai-test/blob/268c0742d47ead76b3ec31a2f872f86a57d8ad2a/bots/src/config.mjs) defaults `ARBITER` to `0`.

A local probe importing that class returned:

```text
acquire: function
act: function
installActuatorGate: undefined
TypeError: a.installActuatorGate is not a function
```

**This is a latent integration failure in the enabled configuration. It does not establish that the currently deployed fleet is failing.**

### Recommendation

Resolve the mismatch between the caller and the class before expanding behavior. Then verify that revoked work cannot subsequently move, dig, or place through a late asynchronous callback.

Acquiring a grant alone does not enforce ownership unless actuator calls respect it. The required behavior is that only the current owner can issue effective commands, and interrupted work cannot reclaim control accidentally.

### Useful External Reference

[Nav2's recovery behavior trees](https://docs.nav2.org/rolling/getting_started/nav2_behavior_trees/detailed_behavior_tree_walkthrough/detailed_behavior_tree_walkthrough/) provide examples of bounded retries, contextual recovery, and replanning. Borrow those semantics rather than introducing ROS into the project.

Your own [August design review](https://github.com/dmille6/minecraft-ai-test/blob/268c0742d47ead76b3ec31a2f872f86a57d8ad2a/docs/design/2026-08-25-what-the-field-already-solved.md) already identified movement ownership and a tactical execution layer as structural concerns. The next step is completing and verifying that direction, not commissioning another broad redesign.

## Priority 2: Unify Prerequisite Planning Across Skills

### Existing Capability

You already have recursive crafting, prerequisite overrides, and deterministic work orders. Adding a planner from scratch would overlook this work.

Relevant code:

- [skills.mjs](https://github.com/dmille6/minecraft-ai-test/blob/268c0742d47ead76b3ec31a2f872f86a57d8ad2a/bots/src/skills.mjs)
- [cognitive.mjs](https://github.com/dmille6/minecraft-ai-test/blob/268c0742d47ead76b3ec31a2f872f86a57d8ad2a/bots/src/cognitive.mjs)
- [workorder.mjs](https://github.com/dmille6/minecraft-ai-test/blob/268c0742d47ead76b3ec31a2f872f86a57d8ad2a/bots/src/workorder.mjs)
- [milestones.mjs](https://github.com/dmille6/minecraft-ai-test/blob/268c0742d47ead76b3ec31a2f872f86a57d8ad2a/bots/src/milestones.mjs)

### Remaining Opportunity

Connect these mechanisms across skills. For example, an iron-pickaxe objective requires a sequence spanning tools, reachable ore, fuel, a furnace, smelting, and crafting.

The planner should:

- Share prerequisites and effects with admission and execution.
- Use actual skill feasibility predicates rather than duplicate approximations.
- Distinguish missing ingredients, unreachable stations, and unobserved resources.
- Replan when a prerequisite becomes unavailable.
- Leave the LLM useful choices among plausible alternatives and exploration goals.

### What to Borrow

Mindcraft's [item_goal.js](https://github.com/mindcraft-bots/mindcraft/blob/develop/src/agent/npc/item_goal.js) represents alternative acquisition methods and traverses dependencies to select the next action.

Adapt that concept into your existing system. Do not copy the implementation wholesale: it contains simplifying assumptions. Your existing fuel, tool, reachability, and evidence checks should remain authoritative.

## Priority 3: Correct the Scope of Learned Refusals

### Findings

[lessons.mjs](https://github.com/dmille6/minecraft-ai-test/blob/268c0742d47ead76b3ec31a2f872f86a57d8ad2a/bots/src/lessons.mjs) already persists experience. The README's statement that no lesson persists is stale relative to the reviewed implementation.

The larger issue is what a remembered failure is allowed to mean.

The latest reviewed commit explicitly records an unresolved example: `place` declares only `item` in its action-key arguments, so failed oak-sapling placements at different locations can collapse into the same avoid key. This was already recognized in your commit message; it is not presented here as a newly discovered defect.

Failure to plant at one location should not become evidence against planting that species everywhere.

### Recommendation

Separate these kinds of evidence:

| Failure category | Appropriate interpretation |
| --- | --- |
| Invalid action or recipe | Potentially general evidence about the operation or recipe. |
| Missing prerequisite | A temporary condition to resolve, not an intrinsic defect in the action. |
| Location- or target-specific failure | Evidence scoped to relevant terrain, target, or local conditions. |
| Infrastructure error or interruption | Evidence about execution or availability, not necessarily about the world. |

You already implement parts of this distinction. Extend those rules rather than adding a second memory subsystem. Use context and expiry where justified; adding every exact coordinate to every key would create fragmentation rather than useful generalization.

## Priority 4: Make Model Evaluation Production-Representative

### Findings

[model-eval.py](https://github.com/dmille6/minecraft-ai-test/blob/268c0742d47ead76b3ec31a2f872f86a57d8ad2a/scripts/model-eval.py) is useful for screening, but its historical success score is not an estimate of what a new model would actually achieve.

The implementation groups situations using coarse features such as altitude band, pickaxe possession, scaffold stock, water, and health. With insufficient matches, it falls back to the skill while ignoring the argument.

That can associate a proposal with outcomes from substantially different terrain, targets, inventories, and objectives. A historical association is not a controlled execution of the proposed action in the current state.

The fixation probe also explicitly documents that it gives models a conversation history that production does not provide. That can be useful diagnostically, but it tests a different information environment.

### Recommendation

Keep both tools, with clearer roles:

1. Label historical outcome scoring as a **diagnostic proxy**.
2. Make production-faithful replay use the actual prompt, schema, and memory presentation.
3. Advance shortlisted models to matched, bounded gameplay trials.
4. Measure task completion, recovery, useful output, and elapsed time.

Do not select a model primarily because it produces valid JSON, receives fewer vetoes, or has lower latency. Those properties matter, but none alone establishes useful gameplay.

### What to Borrow

Mindcraft's [task definitions and validators](https://github.com/mindcraft-bots/mindcraft/tree/develop/src/agent/tasks) provide useful starting material.

Its task harness also uses inventory grants and teleportation during setup. Adapt the task goals and validators to your rules rather than importing those setup behaviors into the fleet.

## Priority 5: Separate Endurance From Generalization

### Findings

Your [September 16 report](https://github.com/dmille6/minecraft-ai-test/blob/268c0742d47ead76b3ec31a2f872f86a57d8ad2a/docs/reports/deaths-review-2026-09-16.md) describes 80 bots across 16 worlds sharing one seed. Recent planting work also documents resource depletion affecting output.

Those environments are useful for endurance and concurrent comparisons. They do not, by themselves, establish performance in unfamiliar worlds.

### Recommendation

Maintain two distinct evaluations:

| Evaluation | Purpose |
| --- | --- |
| Persistent fleet worlds | Detect long-running failures, resource depletion, coordination problems, and regressions. |
| Reserved, varied world seeds | Measure whether navigation, gathering, crafting, and recovery generalize. |

Use separate untouched test worlds rather than repairing fleet terrain. Report results by world or pool as well as by bot; bots sharing a world do not supply fully independent evidence.

Resource renewal is a gameplay capability. It should be evaluated separately from changes in model quality, because a depleted world can reduce output without the policy becoming worse.

## Maintainability and Documentation

At the reviewed commit, `skills.mjs` contains approximately 7,000 lines and `reflex.mjs` approximately 5,200 lines, including substantial comments.

File size alone is not the defect. The concern is the difficulty of checking interactions among navigation, recovery, crafting, gathering, and control ownership.

Gradually split these modules along execution boundaries as those boundaries become explicit. Avoid a large cosmetic rewrite that changes many behaviors at once.

Also distinguish historical documentation from current state. The README's persistence description and older fleet summaries can mislead a reviewer who has not inspected newer code and reports. A concise current-state page with a date and version would make the repository easier to assess without deleting the historical record.

## Work to Defer

- A wholesale migration to Mindcraft.
- Vision-only control.
- Reinforcement learning or training from scratch.
- A larger memory database before resolving what stored evidence means.
- Fleet-wide model changes before production-representative evaluation.

Voyager's [skill manager](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/skill.py) becomes interesting if learning research resumes. Initially, represent learned skills as validated sequences of existing actions, with prerequisites and completion checks. This preserves attribution without letting generated JavaScript become another uncontrolled movement writer.

MineStudio and ROCKET-3 remain relevant for a later visual-policy or training project, but they address a substantially different research direction from stabilizing the current Mineflayer harness.

## Suggested Next Experiment

**Compare your current agent with a version using unified prerequisite planning, while keeping the model and execution layer fixed.**

Use “obtain an iron pickaxe” as the endpoint and include unfamiliar seeds.

| Element | Proposed design |
| --- | --- |
| Baseline | Current agent behavior at a recorded commit and configuration. |
| Candidate | Unified prerequisite planning using the existing skill implementations. |
| Fixed components | Model, prompt differences unrelated to planning, execution layer, and evaluation rules. |
| Worlds | Matched starting conditions across separate test worlds, including reserved unfamiliar seeds. |
| Primary endpoint | Verified acquisition of an iron pickaxe within a declared time budget. |
| Supporting measurements | Time, deaths, recovery attempts, useful inventory changes, rejected proposals, and inference usage. |
| Failure attribution | Separate bad action selection or sequencing from failed execution of a reasonable action. |

This experiment addresses the most useful unresolved question: **how much of the remaining failure comes from choosing and sequencing actions, versus executing them?**

Before that experiment, reconcile the arbiter interface mismatch and establish which movement-ownership configuration is actually under test.

## Suggested Order of Work

1. Reconcile the arbiter interface and verify cancellation and ownership behavior.
2. Correct documentation that conflicts with current code and distinguish source state from deployed state.
3. Extend existing prerequisite handling across skill boundaries.
4. Fix context scope for learned refusals, beginning with the acknowledged placement case.
5. Make the model screening harness faithful to production and add matched gameplay evaluation.
6. Run the bounded iron-pickaxe comparison on varied seeds.
7. Consider reusable learned action sequences only after the execution and evaluation foundation is reliable.

## External References

- [Mindcraft](https://github.com/mindcraft-bots/mindcraft)
- [Mindcraft action manager](https://github.com/mindcraft-bots/mindcraft/blob/develop/src/agent/action_manager.js)
- [Mindcraft item-goal planner](https://github.com/mindcraft-bots/mindcraft/blob/develop/src/agent/npc/item_goal.js)
- [Mindcraft task harness](https://github.com/mindcraft-bots/mindcraft/tree/develop/src/agent/tasks)
- [Mindcraft Community Edition](https://github.com/mindcraft-ce/mindcraft-ce)
- [Voyager](https://github.com/MineDojo/Voyager)
- [Voyager skill manager](https://github.com/MineDojo/Voyager/blob/main/voyager/agents/skill.py)
- [MineStudio](https://github.com/CraftJarvis/MineStudio)
- [ROCKET-3](https://github.com/CraftJarvis/ROCKET-3)
- [XENON](https://github.com/ml-postech/XENON)
- [mc-agents](https://github.com/jblemee/mc-agents)
- [Nav2 behavior-tree walkthrough](https://docs.nav2.org/rolling/getting_started/nav2_behavior_trees/detailed_behavior_tree_walkthrough/detailed_behavior_tree_walkthrough/)
- [Mineflayer state-machine plugin](https://github.com/PrismarineJS/mineflayer-statemachine)
- [Mineflayer pathfinder](https://github.com/PrismarineJS/mineflayer-pathfinder)

External branch links may change after this review. Links to your repository's reviewed files are pinned to the reviewed commit.
