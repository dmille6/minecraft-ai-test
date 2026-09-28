# Tech tree and open-source review — 2026-09-28

Owner question: evaluate our tech tree and bots; can other open-source projects help? Two engines, independently, from ~22 h of fleet data (80 bots) and the deployed code (80b3bbd). Brief: `review-techtree.md`. Data: tech-snapshot.json + two raw exports (not committed; regenerate with the export scripts named in STATE).

## Codex (ChatGPT) report, verbatim

**Inference: borrow deterministic dependency planning selectively. The remaining measured problem is obtaining enough accessible iron, not discovering crafting recipes.**

**Verified scope:** inspected deployed `80b3bbd`, prior reviews, and supplied data; changed nothing. Deduplicated exports contain 61,292 rows spanning roughly 22 hours and three versions. Only 33 latest snapshot inventories are non-null. Therefore exact 24-hour hold-or-gain unions are unavailable.

“Reached” below means observed holding or gaining an item; these are lower bounds. “Next” is same-bot overlap with the next row, **not chronological conversion**. Failures concern actions targeting that material.

| Step | Reached/80 | Next | Dominant failure class/count; detail/count |
|---|---:|---:|---|
| Logs, any species | 74 | 97% | `no_path` 2,971; collect returned empty 1,305 |
| Planks | 73 | 100% | `missing_ingredients` 8; gather oak first 8 |
| Sticks | 80 | 100% | `missing_ingredients` 81; gather oak first 62 |
| Table | 80 | 96% | `missing_ingredients` 130; gather oak first 87 |
| Wooden pick | 77 | 74% | `missing_ingredients` 225; gather oak first 135 |
| Cobblestone | 57 | 98% | `no_path` 2,949; stone digging aborted 1,170 |
| Stone pick | 77 | 84% | `missing_ingredients` 1,725; deepslate advice 1,589 |
| Furnace | 66 | 44% | `missing_ingredients` 53; deepslate advice 28 |
| Coal | 29 | 59% | `no_path` 155; digging aborted 137 |
| Raw iron | 22 | 86% | `unreachable` 1,447; cannot stand within reach 396 |
| Iron ingot | 22 | 23% | Unavailable: exports omit smelt rows |
| Iron pick | 11 | 0% | `missing_ingredients` 36; needs three ingots 32 |
| Diamond | 0 | — | No targeted gather/craft attempts observed |

**Verified:** the longer snapshot reports cobblestone gains on 58 bots, ingot gains on 18, and iron-pick gains on three. Its 247 smelt failures lack subtype/detail data.

**Inference:** excluding the unimplemented diamond goal, the sharpest adjacent overlap drop is ingot→pick. Upstream, only 22/77 stone-pick holders reached raw iron; only two bots were observed holding three ingots simultaneously. Known fixes address tool starvation, but do not establish solutions for the **396 stance failures and 310 liquid-related iron refusals**.

**Verified code findings:**

- `idle` means the controller exhausted its chain—not achieved every technology. [milestones.mjs:404](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/milestones.mjs:404) treats missing means as completion; refresh skips cooling-down goals, rescans outstanding work, and otherwise returns `idle` at line 921. Data show **21 exact `idle`, plus one `idle+prereq`**. Individual skip histories are absent; their precise causes remain unresolved.
- [milestones.mjs:197](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/milestones.mjs:197) counts worn tools; `toolfor.mjs:51` excludes one-use tools. Known-fix territory.
- [milestones.mjs:376](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/milestones.mjs:376) incorrectly includes stone/andesite/diorite/granite/tuff as crafting cobble. Installed recipe APIs exclude them. **86 failed crafts across 18 bots** had enough of this broad category but insufficient valid cobble; causation remains inference.
- [milestones.mjs:422](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/milestones.mjs:422) tests ore proximity, not reachability. [skills.mjs:1736](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:1736) passes only ore elevation into descent, losing its horizontal target.
- Carried-only station predicates at `milestones.mjs:438,508` disagree with `workorder.mjs:210,223`, which accept nearby stations.
- Coal is **optional**: `smelting.mjs:297` selects fuel and `skills.mjs:4055` inserts it. Work orders request one smelt per call (`workorder.mjs:105`). Exit reserves are conditional, not an iron-depth prohibition (`exit-contract.mjs:145`); ladders deliberately receive no speculative exit credit.

**External assessment:** S = source read; P = paper sections read; D = documentation read. Adaptations, costs and risks below are **inferences**, not demonstrated fleet improvements. Costs exclude canaries.

| Candidate and verified mechanism | Concrete application, cost, risk |
|---|---|
| **Mindcraft S:** [`craftRecipe`, `collectBlock`, `smeltItem`](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/src/agent/library/skills.js); [`getItemCraftingRecipes`](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/src/utils/mcdata.js); [`ItemNode`](https://raw.githubusercontent.com/mindcraft-bots/mindcraft/develop/src/agent/npc/item_goal.js) acquisition alternatives | Extend `workorder.mjs:90` across missing inputs: 3–5 days. Targets 36 iron-pick ingredient failures. Do not copy its forced-coal planner or oak-biased recipe ranking; collection still uses the same pathfinder. |
| **GITM P [§3.1](https://arxiv.org/html/2305.17144v2)** quantity-bearing prerequisite trees; **Odyssey P [§2.1](https://arxiv.org/html/2407.15325v1)** recursive skills; **Optimus-1 P [§2.1.2](https://arxiv.org/html/2408.03615v2)** dependency graph | Alternative designs for that same extension, not three additions. Same cost/stall; compile from registry data. Small-model decomposition and inaccessible resources remain risks. Odyssey’s library benchmark is not fleet evidence. |
| **Plan4MC P [§4](https://arxiv.org/html/2303.16563v2)** separates consumed inputs, required capabilities and outputs; replans after execution | Replace duplicated `milestones.mjs:432` predicates: 1–2 days. Targets 86 category-mismatch failures; risk: inaccurate capability definitions. |
| **MP5 P [§3.2–3.3](https://arxiv.org/html/2312.07472v3)** perception checks; **DEPS P [§3.2–3.3](https://arxiv.org/html/2302.01560v3)** feedback-driven replanning | Add deterministic target/stance revalidation at `skills.mjs:1736`: 3–5 days. Targets 396 stance failures; neither supplies proven survival-safe excavation here. |
| **Voyager S:** [`skill.py`](https://raw.githubusercontent.com/MineDojo/Voyager/main/voyager/agents/skill.py) retrieval, [`curriculum.py`](https://raw.githubusercontent.com/MineDojo/Voyager/main/voyager/agents/curriculum.py) goal selection, [`critic.py`](https://raw.githubusercontent.com/MineDojo/Voyager/main/voyager/agents/critic.py) LLM verification | Verified existing-skill templates at `workorder.mjs:90`: 3–5 days, later. Targets repeated sequencing failures; generated code and small-model self-certification are risks. |
| **JARVIS-1 P [§3.3](https://arxiv.org/html/2311.05997v2)** situated successful-plan memory; **Adam P [§3.4](https://arxiv.org/html/2410.22194v1)** intervention-verified causal graphs | Defer additions to `workorder.mjs:90`/`skills.mjs:2615`: weeks. No demonstrated incremental remedy for measured access failures; depleted-world memories stale, Adam’s inventory interventions conflict with fleet rules. |

**Ecosystem:** [prismarine-recipe](https://github.com/PrismarineJS/prismarine-recipe) S/D `delta`, `requiresTable`, and existing minecraft-data APIs support the predicate fix. [mineflayer-tool](https://github.com/PrismarineJS/mineflayer-tool) S, [auto-eat](https://github.com/linkle69/mineflayer-auto-eat) D, [armor-manager](https://github.com/PrismarineJS/MineflayerArmorManager) D and [statemachine](https://github.com/PrismarineJS/mineflayer-statemachine) D provide selection/eating/equipment/transitions, but no verified solution to these stalls. Recommend zero integration now; additional actuator ownership is a risk.

**Ranked proposals—expected effects are hypotheses:**

1. **Shared recipe/capability predicates:** reduce the 86 mismatch failures; measure false-ready orders and completed conversions.
2. **Bounded ore-target approach:** increase raw iron per attempt; measure stance failures, gains and safe returns.
3. **Deterministic missing-input orders:** assemble three ingots; measure three-ingot attainment and new usable iron picks.
4. **Separate blocked/skipped/completed states:** expose the 21 idle cases; measure useful re-entry and idle duration.
5. **Deficit-sized smelting batches:** improve ingot accumulation; measure ingots per furnace visit and interruption losses.

Each gets a **separate 20-bot/26-hour canary**, matched concurrent controls, version/world stratification, and death/immobility/output safeguards. Run after relevant known fixes settle. No world edits or inventory grants; swimming remains travel; one canary at a time.


## Claude report

See the synthesis section below; the Claude agent read the upstream source and papers directly (URLs listed there).

### Claude report (condensed; every number re-derived by the agent from the exports)
- Funnel: logs 74 bots → wooden pick 77 → cobble 57 → stone pick 77 held but only **45 ever held one with >1 use** → furnace 66 → coal/charcoal 41 → raw_iron **22** → ingot 22 (max ever held: 1 on 12 bots, 2 on 8, **3 on 2**) → iron pick 11 held / 3 gained (82 of 84 attempts held 0 ingots) → diamond 0.
- **Steepest unaddressed drop: usable stone pick → raw_iron (45 → 25).** gather iron_ore with a usable pick succeeds 66/1,037 (6.4%): 555 "every candidate is buried", 160 refused, 111 water/falling. Escalation to `mine` 1,059 times, ≤18 non-failures.
- **Iron is banked:** deposits took 43 iron_ingot, 19 raw_iron, 140 coal in the window vs 57 ingots smelted — `raw_iron`/`iron_ingot`/`coal` are STANDING_TARGETS (bankable.mjs:34-36); the ladder needs 3 in hand.
- **`idle` (21 bots) is a ladder gap:** skips come from 25 consecutive failures of ANY skill (cognitive.mjs:1002, milestones.mjs:834-858), `skipCount` never resets (milestones.mjs:850) so backoff reaches 6 h; 19/22 idle bots hold only ≤1-use pickaxes.
- Ladder defects: durability-blind capability (milestones.mjs:197-198, 494); "iron in reach" = within 32 blocks even if buried (422-430) while gather needs an exposed face (skills.mjs:5137); escalation calls `mine({y})` with no x/z (skills.mjs:1734-1741), digging on a safety bearing, not toward the ore; the bucket rung precedes the iron pick (534-538); coal is NOT a hidden prerequisite (planks/logs are fuel); the exit contract is not the iron wall (3,332 of 4,384 refusals had 0 usable uses).
- Open source (source/paper read, URLs in the agent report): **nobody upstream tunnels to buried ore** — collectblock/pathfinder GoalLookAtBlock raycasts, so enclosed ore is never a goal; Voyager mineBlock and mindcraft collectBlock inherit that. **GITM**'s underground explore (1x2 tunnel DFS until ore is visible, dig_down/go_up) is the design to borrow (no licence file — design only). mindcraft item_goal.js (choose acquisition by depth+fails), Plan4MC (consume/require/obtain skill graph), JARVIS-1 (re-plan when the pick breaks) are shapes to borrow. Not useful: Voyager library/critic (generated code, rejected before), Adam (inventory interventions = world edits), mineflayer-tool (fastest tool, durability-blind — worse than toolfor.mjs), DEPS, MP5, Optimus-1.

## Synthesis — where the two engines agree (both independently)
1. After last-swing, the wall is **getting iron**: buried/unstandable ore and an escalation that loses the ore's position (skills.mjs:1734-1741; Codex: 396 stance + 310 liquid refusals; Claude: 555 buried, 1,059 escalations ≤18 useful).
2. `idle` is a **ladder gap**, not completion (milestones.mjs:404/921; skip mechanics).
3. The ladder is **durability-blind** (milestones.mjs:197).
4. From open source: **dependency/capability predicates** (Plan4MC / mindcraft) and **GITM's tunnel-to-ore**; no plugin integration. Nothing upstream solves buried ore — it is ours to build.
Codex-only: milestones.mjs:376 counts stone/andesite/diorite/granite/tuff as crafting cobble (86 failures); station predicates disagree between milestones and workorder. Claude-only: iron is banked (fold a 3-ingot hold into the bank fix); bucket before iron pick; skipCount never resets.

## Proposed queue additions (each its own canary, after the current queue)
1. Directed 1x2 tunnel to buried iron ore (GITM design) replacing the y-only escalation — sandbox first.
2. Hold raw_iron/iron_ingot until 3 (folded into the bank fix — no extra canary).
3. Durability-aware ladder capability (after last-swing).
4. End the idle gap: skips counted only for rung-serving skills, skipCount reset on completion.
5. Shared recipe/capability predicates (fix the cobble category at milestones.mjs:376).
