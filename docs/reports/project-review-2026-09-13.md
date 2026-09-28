# Project review — 13 September 2026

Requested by the owner: "evaluate our code, evaluate the project as a whole, how are we doing, is there a better approach, and a deep look at similar open-source projects." Three parts: Claude's assessment (this section), ChatGPT's independent assessment (Codex, with repository access), and the open-source survey. The two assessments were written without seeing each other.

## Part 1 — Claude's assessment

### The numbers that frame everything

| Measure | Value |
|---|---|
| Bots / worlds | 80 / 16 (Paper 1.21.11, Peaceful) |
| Source | 24,477 lines in 44 files; two files hold 45% (skills.mjs 6,009, reflex.mjs 4,921) |
| Tests | 167 files, 26,800 lines, all green on the recovery branch |
| Commits | 585 total, 108 in the last 7 days, 346 in 30 |
| Canary decisions recorded | 31: 8 KEEP, 9 REVERT, 14 INCONCLUSIVE |
| Output | ~70 items per bot-hour, flat over 48 h |
| Tool tier | 2 iron pickaxes of 80; 48 stone; 30 wooden or none |
| Deaths | 0.06–0.10 per bot-hour |
| Immobile bots | ~3 of 80 at any moment |

### Verdict

The project has built a rigorous validation machine around a bot that still cannot reliably survive its own world. That is the honest one-line summary. The rigour is real and hard-won: canaries with pre-registered rules, difference-in-differences, positive controls, mutants, and now a sandbox that replays traps captured from the live worlds. It has caught defects that would have shipped, and it has stopped the project from believing its own cheap negatives, which was its signature failure. But 31 canary decisions in a month with 8 KEEPs, and an endpoint that has not moved in 48 hours, says the loop is validating faster than it is improving.

### Where the product actually is

The bots are bounded by three mechanical facts, and none of them is about intelligence:

1. **The pathfinder is the weakest component we depend on most.** mineflayer-pathfinder says "no path" or times out for most failures. It does not dig, bridge, pillar, or swim well, and we have wrapped it in probes, back-offs, profiles, watchdogs, and classifications rather than replacing it. Roughly a third of skills.mjs and reflex.mjs exists to compensate for it.
2. **Survival is a set of reflexes that were added one trap at a time.** Drowning, entombment, marooning, stuck, livelock, and now the recovery ladder are each correct alone. The recurring bug is their composition: two correct guards meeting where the bot has no legal move. Every trap this week passed its own unit tests.
3. **Iron is produced but not kept.** In 24 hours the fleet made 14 iron pickaxes and 130 ingots; two bots hold an iron pickaxe. Deaths and escape activity spend the tools. Supply is not the bottleneck; retention is, which means survival is the iron problem too.

The 72B model trial settled a question cleanly: a ten-times larger decision model changed nothing measurable. The model is not what is holding the bots back.

### Code: what is wrong and what is right

Wrong, in order of cost:

- **Two files carry the system.** skills.mjs and reflex.mjs are each thousands of lines of interleaved decision logic, world probes, event logging, and long explanatory comments. Extracting pure decision functions (the pattern that fixed the grep-test problem) has started but is far from done; most behaviour is still reachable only by running a bot.
- **State machines are implicit.** Escaping, marooned, climbing, and stair claims serialise the reflexes through flags and body claims rather than one explicit recovery state with defined transitions. That is why composition bugs keep appearing and why a review of one guard cannot see the others.
- **Reachable-but-advisory remedies.** Many refusals print advice the model is meant to act on. Measured repeatedly: printed advice is not taken. Deterministic remedies work; advisory ones do not.

Right:

- **Instrumentation is excellent.** Every decision, reflex, and outcome is a typed telemetry row with position and inventory, and the analysis library refuses suspicious zeros. Most of what we know about the bots we know because of this.
- **Pure, exported decision functions with behaviour tests and mutants.** Where this pattern is applied (dig budgets, explore step probe, ground probe, climb height, livelock ladder) the code is testable without a bot and the tests have been seen to fail for the right reason.
- **The sandbox rig.** Capturing a live trap over RCON in twenty seconds and replaying it against control and candidate code is the single most valuable tool added this month. It found the buried-ore planner defect before its fourth canary and reproduced two of the three trapped-bot cases faithfully.

### Process: helping, or heavier than the product?

Both. The rules in CLAUDE.md exist because each was paid for, and the canary machinery is the only reason the endpoint has not been credited with world drift. But the cost is visible: 14 review passes to register one safety canary, three canaries reverted or lost to unrelated deaths on five bots, and a session that spent most of its turns on bookkeeping. The process is right for the fleet. It is too heavy for the sandbox, where a deterministic replay answers in five minutes what a canary answers in six hours with less certainty.

### Is there a better approach?

Yes, and it is a shift of where the certainty comes from, not a rewrite:

1. **Prove mechanisms in the sandbox; use the fleet only for harm and non-regression.** The recovery-ladder registration already took this shape after ChatGPT showed the fleet cannot read causation for three trapped bots. Make it the default: a change is eligible for the fleet when its captured fixture passes control-vs-candidate, and the fleet canary answers only "is it safe and did nothing regress."
2. **Replace the navigator for the cases that matter, not wrap it again.** A Baritone-style planner that treats digging, bridging, pillaring, and swimming as first-class moves would remove most of the compensation code. Whether to port, wrap, or write a small custom navigator for escape-class movement is the open-source survey's main question.
3. **One explicit recovery state machine.** Fold drowning-air, entombed, marooned, livelock, and the ladder into a single owner of the body with named states, one postcondition, one budget, and one terminal state. The pieces now exist; they are not yet one thing.
4. **Rules run the day, the model handles open questions** (the owner's goal 1). The 72B result and the cooldown canaries both point the same way: fewer, better-scoped model calls. A behaviour-tree core for gather-craft-smelt with the model choosing only among genuinely open options is the cheapest experiment with the largest expected effect on cost, and it makes the bot deterministic enough to test.
5. **More sandbox worlds before more fleet hours.** Four worlds on the idle i9 would run a scenario suite per commit.

### What I would do next week, in order

1. Read the guard canary, then run the recovery-ladder safety canary already registered; promote if clean. Iron retention gets its first help from bots that stop dying in pockets.
2. Build the flooded-pocket pillar rung in the sandbox against Bravo's capture; that fixture and the drowning channel are the same geometry.
3. Stand up four sandbox worlds and a per-commit scenario suite from the captured traps.
4. Draft the recovery state machine and the rules-first core, reviewed by both engines before code.

What I would stop: registering fleet canaries for mechanism questions the sandbox can answer, and iterating review passes past the point where objections stop naming a fleet-plausible mechanism.


## Part 2 — ChatGPT's assessment (Codex, with read-only access to the repository; written independently of Part 1)

**1. Verdict on the project**

A useful experimental platform; an unreliable autonomous colony. You are improving individual failure modes without improving the system’s output. Flat throughput, 30% gather success, and only two retained iron pickaxes say survival and execution are the bottlenecks.

The stair-claim improvement is real progress. But roughly $3,445 equivalent over 53 hours is poor economics for the measured outcome. Better models are not the next investment; the 72B result reinforces that, without proving models never help.

**2. Code quality**

I inspected the requested modules and representative tests, plus the runner. `explorestep.mjs` is absent; exploration lives in `skills.mjs:3106`. I did not run tests, as requested.

The three biggest structural problems:

- **Distributed control and policy.** Skills, reflexes, cognition, and admission jointly determine what happens, with implicit handoffs through bot fields (`cognitive.mjs:535`). The long asynchronous reflex loop (`reflex.mjs:1343`) and milestone exemptions (`admission.mjs:506`) make correctness depend on interactions across layers. Splitting files alone will not fix this.
- **Navigation lacks a consistently enforced safety boundary.** After path failure, exploration blindly holds forward and jump for 1.2 seconds (`skills.mjs:3205`). Meanwhile navigation patches private A* internals (`pathbackoff.mjs:140`). You have both unsafe escape hatches and fragile dependency coupling.
- **Tests prove more about decisions than execution.** The microworld explicitly excludes physics and time (`test/helpers/microworld.mjs:20`); escape totality proves an action is named (`test/escape-total.test.mjs:51`), not that it can finish safely. These are valuable tests, but insufficient evidence for survival.

Three things done well:

- **Extracted, testable planning:** reach/cost checks in `digapproach.mjs:290`, situational tool budgets in `digbudget.mjs:272`, and escape selection in `escape.mjs:84`.
- **Honest outcomes:** transient uncertainty is throttled without becoming permanent learned impossibility (`cognitive.mjs:715`); escape routines explicitly require postconditions (`reflex.mjs:3420`).
- **Serious regression discipline:** mutant anchors must be unique (`test/climb-escape.test.mjs:447`), and the canonical runner checks subprocess exits and enforces deadlines (`scripts/run-tests.mjs:42`).

**3. Process**

The rules address genuine mistakes. Keep positive controls, denominators, behavioral tests, selective mutants, sandbox replays, and recorded deployment decisions.

But yes: the process is now heavier than the product. Fourteen registration passes versus five implementation passes is the clearest signal. Pre-registration should be a short, machine-checked declaration, not another engineering project.

DiD helps with baseline differences; it does not manufacture statistical power or eliminate changing world conditions. Two deaths can justify a precautionary pause without establishing causation. Preserve the owner’s gate, but distinguish “safety rollback” from “fix disproven.” Revise the blanket no-analysis-during-canary rule: it unnecessarily serializes independent offline work.

**4. Is there a better approach?**

Yes: a deterministic behavior tree or state machine, one movement owner, explicit cancellation, shared preconditions, and verified completion. Existing deterministic work orders already point there (`cognitive.mjs:651`).

Remove per-decision LLM calls from the baseline. Use an LLM for open questions or high-level goals only if controlled comparisons demonstrate value.

Benchmark navigation alternatives before rewriting. Baritone’s segmented planning is relevant ([official features](https://github.com/cabaletta/baritone/blob/1.21.4/FEATURES.md)), but no planner fixes contradictory control policies. Introduce a navigator interface; compare current pathfinding against an alternative on identical traps. Build custom navigation only for demonstrated gaps.

Use fewer active development worlds, retaining diverse seeds and held-out worlds. Bigger worlds may provide resources, but cannot repair unsafe movement. Require sandbox survival before fleet canaries.

**5. Next week, in order**

1. Remove blind exploration movement; replay lava and flooded-mine failures through recovery **and resumed work**.
2. Implement one movement owner and a deterministic gather–craft–mine–return cycle. Measure retained tool-hours and useful deposited resources.
3. Benchmark navigators and the LLM-free baseline on matched scenarios; canary only the sandbox winner.

**Stop:** treating another review or registration pass as progress without new evidence.

### Where the two assessments agree and differ (Claude's note)

Agree: survival and execution are the bottleneck, not the model; the two big files hide a control-policy problem that file-splitting alone will not fix; the process is now heavier than the product and pre-registration should become a short machine-checked declaration; the next architecture step is one movement owner and a deterministic core with the model reserved for open questions; navigators should be benchmarked on identical captured traps before any rewrite.

Differ: ChatGPT would remove the per-decision model from the baseline outright and run an LLM-free comparison; I would keep it behind a rules-first core until that comparison is run, because the fleet's craft ladder is already rule-driven and the model's remaining job is small. ChatGPT would relax the no-analysis-during-canary rule for independent offline work; I agree for sandbox and design work, which is what today already did. Both of us would stop treating review passes as progress.

## Part 3 — Open-source survey (research agent with web access; every claim marked verified [V], inferred [I], or from our own notes [M])

# Open-source Minecraft agents vs. our fleet: what exists, what they cheat on, what we can take

Legend: **[V]** = verified from the cited page this session; **[I]** = my inference; **[M]** = from our own memory files, not re-checked.

## 1. LLM-agent projects

**Voyager (NVIDIA/MineDojo, 2023)** — mineflayer + Fabric mods on MC 1.19, survival mode, GPT-4 writes JS skills. [V] Cheats are everywhere in the server bridge: hard reset is `/clear @s` then `/kill @s` then `/give` the inventory back; spawn is `/tp @s` or `/spreadplayers`; every step sets `/gamerule keepInventory true` and `doDaylightCycle false`; after a task it `/setblock … air` the crafting table and `/give`s it back, plus furnace/chest/iron_pickaxe. **Stuck handling is a teleport**: after 100 pathfinding ticks without progress it `/tp`s to a random adjacent air block or `~ ~1.25 ~`. Bot leaves and rejoins the game after every task. Metrics: unique items, tech-tree milestone time, map distance. GPT-3.5 got 5.7x fewer unique items than GPT-4 — but in Voyager the LLM *writes the skill code*, so model size is load-bearing there. Failure modes named: curriculum proposes non-existent items ("copper sword"); agent "gets stuck and fails to generate the correct skill." ~$50 per 160 iterations. [V] Third-party trials on one seed: Claude 3.5 Sonnet reached diamonds by iteration 40; Mistral Large "doesn't go much farther than mining wood"; Command R+ "couldn't even mine wood." [V]
https://github.com/MineDojo/Voyager/blob/main/README.md · https://raw.githubusercontent.com/MineDojo/Voyager/main/voyager/env/mineflayer/index.js · https://arxiv.org/html/2305.16291 · https://github.com/JVP15/Voyager-LLM-Trials

**Odyssey (Jul 2024)** — Voyager's framework, mineflayer, text-only observation, 40 primitive + 183 compositional hand-written skills, fine-tuned LLaMA-3 (MineMA-8B/70B). [V] 8 trials per long-term task, 5 per dynamic task; MineMA-70B beat 8B on dynamic tasks; named failure mode is hallucination. [V] Resets/teleports not extractable from the paper text; the PDF summariser reported MC 1.20.1 (moderate confidence). [M] Our earlier read: its "100% wooden pickaxe" is the skill library with the LLM removed.
https://arxiv.org/html/2407.15325v2

**GITM (2023)** — MineDojo (MineRL-derived, MC 1.11.2), *hand-written scripts* for every structured action (equip, explore, approach, dig_down, go_up, craft). [V] Claimed 100% wooden/stone, 95% iron pickaxe, 67.5% diamond in 10-minute episodes — with **breaking speed and strength set to 100** to match baselines, i.e. instant mining. [V] Failure modes: biome distribution, LiDAR sparseness. Not a persistent-world result and not directly comparable to a survival fleet. [I]
https://arxiv.org/html/2305.17144v2

**DEPS / JARVIS-1 / STEVE-1 / Plan4MC / Optimus-1..3 / OmniJARVIS / MP5** — all keyboard-and-mouse policies (VPT/STEVE-1 descendants) on MineRL 1.16.5 or MineDojo 1.11.2, 20 Hz, pixels in. [V] Numbers: DEPS 0.59% diamond in 10 min; JARVIS-1 6.22% diamond-pickaxe in 20 min, 12.5% in 60 min over 300+ trials, bottleneck named as "the Controller's inability to perfectly execute short-horizon text instructions", plus pickaxe breakage; VPT ~80% iron pickaxe / 20% diamond / 2% diamond pickaxe; STEVE-1 12/13 early-game tasks. [V] Optimus-1 runs MineRL 1.16.5 at 20 fps with STEVE-1 as controller; Optimus-3 (Jun 2025) adds MoE task routing, claims 60% on open-ended tasks. [V] MP5 uses MineDojo ego-view images. [V] None of this transfers to a mineflayer fleet: the substrate, action space, and episode reset regime are all different. [I]
https://arxiv.org/html/2302.01560v3 · https://arxiv.org/html/2311.05997 · https://github.com/Shalev-Lifshitz/STEVE-1 · https://arxiv.org/html/2408.03615v2 · https://arxiv.org/abs/2506.10357 · https://arxiv.org/html/2312.07472v1

**Mindcraft (kolbytn, 5.7k stars, pushed Jun 2026)** — mineflayer, LLM invoked only on chat/self-prompt; a 300 ms `update()` loop runs deterministic **modes**. [V] This is the closest architecture to ours. Modes: `self_preservation` (water above head → jump, *only if no pathfinder goal*; lava/fire → place water bucket, else find water within 20, else `moveAway(5)`; falling block above → `moveAway(2)`; health <5 after damage → `moveAway(20)`), `unstuck` (same 2-block spot *and same dig target* for 20 s, 40 s on obsidian → `moveAway(5)` with a 10 s crash timeout), `cowardice`, `self_defense`, `hunting`, `item_collecting`, `torch_placing`, `elbow_room`, and `cheat` (OFF by default; when on, `goToPosition` is `/tp`). [V] `goToPosition` polls every 1 s and stops the pathfinder if the block being dug is unharvestable with the held item; a 200 ms interval opens doors/gates/trapdoors after 1.2 s without moving 0.1 blocks; `digDown` stops at lava/water or >2 air below; `goToSurface` scans y=360→−64; `collectBlock` sets `dontMineUnderFallingBlock=false`, `dontCreateFlow=true` and has no noPath handling. [V] Death handling is "log `last_death_position`, cancel actions." No pillar-out, no entombment escape, no flooded-pocket logic. [V] MineCollab benchmark (Apr 2025): Claude 3.5 Sonnet 0.49 overall, construction 0.36; failures are "useless chatter" and agents demolishing each other's work. [V]
https://raw.githubusercontent.com/kolbytn/mindcraft/main/src/agent/modes.js · https://raw.githubusercontent.com/kolbytn/mindcraft/main/src/agent/library/skills.js · https://mindcraft-minecollab.github.io/

**Project Sid (Altera, Oct 2024)** — paper only, no code. [V] The paper never names its substrate; the words mineflayer, death, health, teleport, pathfind, stuck do not appear in it. [V] Numbers: 25 agents spawned apart with empty inventories → mean 17 unique items in 30 min, top 30–40; 49 agents for 4 h saturated at ~320 unique items. Ten concurrent PIANO modules; social goals every 5–10 s. Stated limitation: "lack of vision and spatial reasoning, limiting their basic Minecraft skills, particularly in spatial navigation and … building." [V] Survival numbers: none published.
https://arxiv.org/html/2411.00114v1 · https://github.com/altera-al/project-sid

**MineLand (Mar 2024)** — mineflayer + Fabric server, survival mode, hunger/health/oxygen/sleep modelled, 32 agents with display / 128 headless, 100 in a combat stress test; Alex framework on gpt-4-vision. [V] Survival result is one sentence: a single agent "survived indefinitely" with food management; construction scored 1–3/5. [V]
https://arxiv.org/html/2403.19267

**Parallelized Planning-Acting (AAMAS 2026)** — mineflayer, MC 1.19.4, 3–20 agents, Qwen-Plus; a planning thread can interrupt the acting thread. [V] Combat scenarios teleport agents and hand them standardized kits; mining has a 6000-tick explore timeout. Diamond armour in 13.7 min with 3 agents vs 28.3 solo. [V]
https://arxiv.org/html/2503.03505v2

**2025–26 newcomers** — MineExplorer (EMNLP 2026): synthesised task graphs + *sandbox scenes* + *rule-based milestone evaluators*; finding: "larger models or thinking modes do not consistently translate into better performance," agents "degrade sharply when hidden prerequisites must be coordinated." [V] PSN (Jan 2026, MineDojo/Crafter): structured fault localisation and "rollback validation" for skill edits. [V] Echo (Apr 2026): 1.3–1.7x speed-up via experience transfer. [V] PillagerBench (Sep 2025): mineflayer, JS high-level actions, rule-based opponents. [V] minecraft-agent-swarm (JesseRWeigel, pushed today): 5 bots on Ollama `gpt-oss:20b`, event-driven ~10 s idle cadence, reflexes = auto-equip armour, escape burial, surface when underwater; **10–55 deaths/day** (≈0.08–0.46/bot-hour on 5 bots), turned `keepInventory` on 2026-09-07 because of it; pathfinder timeouts mitigated with 240 s/150 s watchdogs; tracks 122 vanilla advancements. [V]
https://arxiv.org/abs/2605.30931 · https://arxiv.org/abs/2601.03509 · https://arxiv.org/abs/2604.05533 · https://arxiv.org/abs/2509.06235 · https://github.com/JesseRWeigel/minecraft-agent-swarm

## 2. Movement and survival engineering

**Baritone (Java client mod)** — A* with breaking/placing as path steps, pillar, parkour ("very unreliable and falls off when cornering"), ladders, water-bucket falls (20–23 blocks), avoids fire/magma/lava corners and never breaks a block touching liquid. [V] The parts worth stealing are the *control-loop* settings, not the search: `movementTimeoutTicks=100` (cancel a movement that overruns its cost estimate), `maxCostIncrease=10x` (re-plan when the world changed the price), `costVerificationLookahead=5` (stop before anything that became COST_INF), `failureTimeoutMS=2000` / `primaryTimeoutMS=500` (a hard cap and a "good enough" cap), incremental cost backoff to accept a partial path on timeout, backtrack detection, `allowDownward=false` "to encourage staircase-building," `walkOnWaterOnePenalty=3`. [V] Water pathing still gets stuck (issue #2377, closed as duplicate). [V] Baritone's headless deployment story for 80 bots is unknown to me; treat as a research item, not a plan. [I]
https://github.com/cabaletta/baritone/blob/master/FEATURES.md · https://baritone.leijurv.com/baritone/api/Settings.html · https://github.com/cabaletta/baritone/issues/2377

**mineflayer-pathfinder (309 stars, 62 open issues, pushed 2026-09-07)** — stuck detection is one rule: 3.5 s without reaching the next node → `resetPath('stuck')`; no position-delta check. In water it holds jump and drops sprint. `thinkTimeout=5000`, `tickTimeout=40`. Defaults that matter for flooded pockets: `dontCreateFlow=true` (will not break blocks touching liquid — so it cannot dig out of a flooded pocket), `dontMineUnderFallingBlock=true`, `maxDropDown=4`, `infiniteLiquidDropdownDistance=true`, `allow1by1towers=true`. [V] Open since 2021–22: #222 hangs silently on an unbreakable block even with thinkTimeout; #229 NoPath for goals outside render distance; #296 bridging places nothing and walks off (sneak toggling). PR #90 (2021) fixed jump-place-in-water by forbidding it — a mineflayer physics limit. Swimming has been a feature request since 2017 (#545). [V]
https://github.com/PrismarineJS/mineflayer-pathfinder/blob/master/readme.md · …/issues/222 · …/issues/229 · …/issues/296 · …/pull/90 · https://github.com/PrismarineJS/mineflayer/issues/545

**Ports** — `baritone-ts` (WiegerWolf): created 2026-01-27, last push two days later, 0 stars, AGPL-3.0, claims 20 movements and tick-based costs. Not a base for anything. [V] `miner-org/mineflayer-baritone`: since Nov 2023, pushed 2026-08-29, 43 stars, no licence, "inspired by" not a port, README admits parkour gets stuck and water exits need multiple attempts. [V] `mineflayer-collectblock`: `ignoreNoPath` option, 25 open issues. [V] `mineflayer-statemachine`: FSM plugin, MIT, no survival logic shipped. [V]
https://api.github.com/repos/WiegerWolf/baritone-ts · https://github.com/miner-org/mineflayer-baritone · https://github.com/PrismarineJS/mineflayer-collectblock · https://github.com/PrismarineJS/mineflayer-statemachine

**Nobody solved "sealed pocket / flooded pocket / disconnected ledge" deterministically.** Voyager teleports. Mindcraft walks away 5 blocks. The swarm claims "escape burial / surface when underwater" without published mechanics. Baritone digs because breaking is a path cost, but forbids breaking next to liquid. [V/I]

## 3. Evaluation harnesses

MineDojo: 1,581 programmatic tasks in Survival/Harvest/Tech-Tree/Combat, survival = "survive N days"; MineRL-derived sim. [V] MCU (ICML 2025): 3,452 atomic tasks, GPT-4o judges *video* on six axes, 91.5% human agreement; runs on MineStudio (MineRL/Malmo). [V] BASALT: human TrueSkill judging of fuzzy tasks; FindCave/MakeWaterfall the easiest. [V] MineRL 2019: no team obtained a diamond. [V] Craftax: JAX, 250x faster, best agent at 18% of max reward. [V] MineExplorer is the only one that synthesises **sandbox scenes with rule-based milestone evaluators** — the same shape as our sandbox, but generated, not captured from live traps. [V] No project I found does capture-live-trap → setblock replay → scripted decisions, and none runs canaries against a live control population.
https://docs.minedojo.org/sections/core_api/sim.html · https://github.com/CraftJarvis/MCU · https://arxiv.org/pdf/2303.13512 · https://arxiv.org/abs/2003.05012 · https://github.com/michaeltmatthews/craftax

## 4. Rules-first vs LLM-per-decision

Verified pattern: every mineflayer project that runs unattended has already moved the LLM off the tick. Mindcraft: deterministic modes at 300 ms, LLM on events. [V] Swarm: event-driven, ~10 s idle. [V] Sid: 10 concurrent modules on different timescales. [V] Parallelized: planner thread interrupts an acting thread that runs a skill library. [V] Evidence on model size splits cleanly by what the LLM does: when it *writes code* (Voyager) GPT-4 vs 3.5 is 5.7x [V]; when it *selects skills* over a fixed library, MineExplorer finds bigger/thinking models not consistently better [V], and our 72B result matches. [I] Odyssey's 70B > 8B is on short dynamic tasks with 5 trials. [V] Cost: Voyager ~$50/160 iterations; nobody publishes decisions-per-hour or tokens-per-item. [V]

## 5. Fleets

Sid 25–49 agents (1000+ claimed, mechanics unpublished); MineLand 128 headless; Parallelized 20; swarm 5. [V] The only published survival number anywhere is the swarm's 10–55 deaths/day on 5 bots. [V] Our 0.06–0.10 deaths/bot-hour and ~3/80 immobile is already the best documented figure I can find, and the only one with a denominator. [I]

## What we should learn (prioritised)

1. **Recovery ladder — copy Baritone's control-loop discipline, not its search.** Add to our own skill runner: a per-movement overrun budget (`movementTimeoutTicks`-style: cancel when a leg exceeds its estimate), a re-plan trigger on cost inflation, and a "stop N steps before anything that became impossible." mineflayer-pathfinder's single 3.5 s stuck rule is why noPath/timeouts dominate our failures; issue #222 shows it can hang with no event at all, so our ladder must own its own deadline rather than trusting `thinkTimeout`. [V→I]
2. **Flooded pockets — check `dontCreateFlow`.** Default `true` forbids breaking any block touching liquid, so a bot in a flooded pocket can neither dig out through the pathfinder nor (PR #90) jump-place a block from inside water. Pillaring out must therefore be a raw `bot.dig`/`placeBlock` reflex that bypasses Movements, which is consistent with our `float dig` result. [V→I]
3. **Steal three small Mindcraft guards**: stop pathfinding when the dig target is unharvestable with the held tool (kills infinite-dig loops); the door/gate/trapdoor activation after 1.2 s stationary; `digDown`'s "stop at liquid or >2 air below." Do not borrow its `unstuck` (walk away 5 blocks after 20 s) — it is weaker than what we have. [V]
4. **Set `allowDownward=false` semantics for exploration.** Baritone exposes it explicitly to force staircases over shaft-digging; our "descent is a one-way trap" finding is the same lesson. [V/M]
5. **Sandbox worlds — we are ahead; make it a corpus.** MineExplorer proves synthesised scenes + rule-based milestone evaluators are publishable; ours are captured from real traps, which is strictly better. Add PSN-style "rollback validation" (a skill edit must pass the replay set before it can promote) as the gate in front of the canary. [V→I]
6. **Rules-first is the consensus, and model size is settled for our architecture.** Spend the bigger model on skill *authoring* (Voyager-shaped, offline, reviewed) and never on the tick. [I]
7. **Iron progression — stop comparing to GITM/JARVIS numbers.** They are 10–60-minute episodes with resets, instant breaking (GITM), or `/give`-restored pickaxes (Voyager). JARVIS-1's stated bottleneck — pickaxe breakage and controller failure on short-horizon steps — is the same materials problem we see. [V]
8. **Building later.** MineCollab construction 0.36, MineLand 1–3/5, Sid names building as a limitation. Nothing to copy; keep it after difficulty is raised. [V]

## What nobody has solved

- A **no-cheat, persistent, survival fleet** with published deaths/bot-hour and immobile fraction. Voyager `/tp`s out of stuck states; Parallelized teleports for combat; the swarm turned `keepInventory` on last week. [V]
- **Deterministic escape from sealed, flooded, or ledge-isolated positions.** Best published remedy is "walk away 5 blocks." [V]
- **Swimming physics in mineflayer** — open since 2017. [V]
- **Canary-vs-control validation** of agent changes on a live population; every paper reports N-trial success on fresh episodes. [V]
- **Capture-and-replay of live traps.** MineExplorer synthesises; nobody captures. [V]

**Baritone port/wrap verdict:** no. The Java mod needs a Minecraft client per bot; `baritone-ts` is two days old with 0 stars; `miner-org` admits water and parkour stuck-cases. Port the *settings semantics* listed in §2 into our runner instead. **Mindcraft verdict:** borrow the three guards in item 3 and its `modes` shape as validation of ours; nothing in it addresses the traps that actually cost us bots.

## Part 4 — What changes in our plan (Claude, after reading Parts 2 and 3)

1. **The recovery ladder adopts Baritone's control-loop discipline before its next canary:** a per-leg overrun budget that cancels a movement exceeding its cost estimate, a re-plan on cost inflation, and a hard stop before anything that became impossible. Our navigator wrapper has one stuck rule from the library; that is why "no path" and timeouts dominate.
2. **Flooded pockets are a raw-dig-and-place reflex, never a pathfinder job.** The library's default refuses to break any block touching liquid, and mineflayer cannot jump-place from inside water. Bravo's fixture is exactly this case. Build the pillar-from-the-floor rung as a reflex on raw `bot.dig` and `placeBlock`, prove it on Bravo's capture, then canary.
3. **Borrow three small guards from Mindcraft:** stop pathfinding when the dig target is unharvestable with the held tool; activate doors and gates after 1.2 s stationary; stop a descent at liquid or a void below. Skip its walk-away unstuck, which is weaker than ours.
4. **Sandbox first, fleet for safety: now the default.** No project captures live traps and replays them; the closest, MineExplorer, synthesises scenes. Add a rollback gate: a change must pass the replay set before it may be canaried. More sandbox worlds on the idle i9.
5. **Rules-first is the consensus of every unattended mineflayer project, and model size is settled for our architecture.** Spend a bigger model on offline skill authoring under review, never on the tick.
6. **Stop comparing our iron numbers to the papers.** They run 10 to 60 minute episodes with resets, instant breaking, or restored pickaxes. Our deaths per bot-hour and immobile fraction are the only such numbers with a denominator anywhere we could find, and the survey's independent judgement is that no one has solved deterministic escape from sealed, flooded, or ledge-isolated positions. That is the problem we are on.
7. **Do not port Baritone.** It needs a client per bot and its ports are dead or admit the same water and parkour stuck cases. Port its settings semantics into our runner.

Ordered for the week: guard read and teardown; recovery-ladder safety canary; flooded-pocket rung on Bravo's capture; the three Mindcraft guards and the Baritone loop discipline as one small branch with fixtures; four sandbox worlds and the replay gate; then the rules-first core design, reviewed by both engines before code.
