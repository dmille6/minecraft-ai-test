# Progress evaluation — 16 September 2026 (two engines, independent; brief in progress-brief-2026-09-16.md)

## Part 1 — ChatGPT (Codex, repository access + web search)

**PROGRESS: B−.** Meaningful execution fixes and better experiments in six weeks, but improvement across the full production cycle remains unproven.

**STATE: C.** A credible reliability testbed whose workers still cannot consistently preserve tools and return useful stock.

I read the brief in full, supporting reports, selected source code, and external papers. Fleet measurements below are repository-reported; I did not independently query telemetry.

Your distinctive contribution is persistent operation with consequences: whether autonomous workers remain productive after repeated hazards, resource depletion, and equipment loss. That is a useful research problem. It differs from learning visual control, generating reusable skills, completing diverse instructions, or coordinating construction. Your current program demonstrates little of those capabilities; shared hazard memory is adaptation, but not evidence of general skill learning. One seed also leaves “any Minecraft world” untested. Peaceful mode and structured Mineflayer observations make some challenges easier, while persistence makes others harder. Neither difficulty cancels the other. [Brief](/Users/darrellmiller/Documents/mcai-deathsites/docs/reports/progress-brief-2026-09-16.md)

The claim that nobody else studies persistent societies is too broad. Project Sid reports 49 agents collecting approximately 320 distinct items over four hours, with diamonds appearing around 30 minutes. That does not establish comparable no-cheat survival reliability, but it rules out treating fleet size or open-ended social operation as your novelty. “First multi-day, no-cheat fleet evaluated on deaths and retained tools” remains **UNVERIFIED**, not established by failing to find a counterpart. [Project Sid](https://arxiv.org/html/2411.00114v1)

Recent comparisons strengthen that distinction. MineCollab’s 2025 results include Claude 3.5 Sonnet scoring 0.47 on crafting, 0.64 on cooking, and 0.36 on construction; construction uses an edit-distance score, not binary success. These are supplied-resource collaboration tasks, not autonomous subsistence. The June 2026 TickingCollabBench paper tests time-critical cooperation: GPT-5.1’s centralized crisis-preparation success falls from 0.42 with synchronous execution to 0.15 asynchronously. That makes control latency relevant, but supplies no death-rate comparator. [MineCollab](https://arxiv.org/html/2504.17950v1), [TickingCollabBench](https://arxiv.org/html/2606.15684v1)

On survival, your position is **unranked**, not ahead: the sources inspected lack matched deaths/bot-hour. Your 0.026 rate represents roughly one death per 38 bot-hours; at 80 bots, that would mean about 50 deaths daily if sustained. The post-promotion window is encouraging, not proof of a durable treatment effect. Iron-tool occupancy is only one-quarter of the two-week target; gross gathering cannot substitute for returned stock, and an immobility snapshot cannot establish bot-minute occupancy. Three days into the revised program, these are gaps rather than missed deadlines. [Brief](/Users/darrellmiller/Documents/mcai-deathsites/docs/reports/progress-brief-2026-09-16.md)

On demonstrated technical depth, you are **behind**. Optimus-3 reports 80% iron-pickaxe success over 30 evaluations and 13.95% diamond-pickaxe success over 43—already above the brief’s quoted diamond range. Those episodic results cannot establish superiority under your no-cheat persistence constraints; that ranking is **UNVERIFIED**. They nevertheless demonstrate capabilities your fleet has not. [Optimus-3](https://arxiv.org/html/2506.10357v1)

Execution reliability shows real progress: the daily report records an 89% DiD reduction in entombment firings within mining runs, and later zero iron-pickaxe losses through 91 canary uses. But it also explicitly says a lava-guard refusal “fed explore’s blind fallback walk into the pool it had named.” Calling those reversions merely instrument failures understates actual integration defects. This is why I credit validated mechanisms more than promotion counts. [Daily report](/Users/darrellmiller/Documents/mcai-deathsites/docs/reports/status-report-2026-09-12-to-14.md)

Measurement discipline is your strongest axis: ahead in operational auditability, behind in demonstrated generalization. Captured replays, denominators, and explicit inconclusive outcomes deserve credit. Historical pseudo-canaries do not guarantee future calibration, and pools sharing one seed do not establish environmental breadth. Pace is improving against your earlier record of eight KEEPs among 31 decisions. Comparative cost efficiency is **UNVERIFIED**: the earlier review’s approximately $3,445 equivalent over 53 hours is neither a current cost-per-improvement estimate nor comparable to published inference budgets. [Earlier review](/Users/darrellmiller/Documents/mcai-deathsites/docs/reports/project-review-2026-09-13.md)

Three results would most improve my grades next month. First, sustain the registered survival, retained-tool, gather-success, and returned-stock targets together across held-out seeds. Second, demonstrate one movement owner and a deterministic gather–craft–mine–return cycle, including successful resumed work after escape; the arbiter currently defaults off. Third, compare that system against an LLM-free baseline and a matched Mindcraft baseline, reporting engineer-hours and compute cost per validated improvement. [Configuration](/Users/darrellmiller/Documents/mcai-deathsites/bots/src/config.mjs:153)

My principal stall risk—**UNVERIFIED forecast**—is continued trap-specific patching without resolving control ownership. Avoid making a navigator rewrite the presumed cure: upstream pathfinder already supports digging, scaffolding, and pillaring, contrary to the brief’s blanket characterization. Establish which failures belong to navigation, configuration, or competing controllers before replacing it. [Pathfinder documentation](https://github.com/PrismarineJS/mineflayer-pathfinder)

## Part 2 — Claude (independent subagent, repository access + web search; written without seeing Part 1)

**Independent progress review — 16 Sep 2026** (read-only on `mcai-deathsites` at b1659c0; sources fetched today)

**1. What this project attempts that the field does not, and vice versa**

Attempted here and nowhere I could find: a persistent, no-cheat, multi-day fleet with survival and tool retention as the endpoint, validated by canary-vs-control. I verified the no-cheat claim myself: `grep` for `/tp|/give|/kill|setblock` in `bots/src` hits only comments ("No setblock, no give, no teleport", reflex.mjs:3473). By contrast Voyager's bridge, read from source, does `bot.chat("/kill @s")`, `/give @s`, `/tp @s`, `/gamerule keepInventory true`, and its stuck handler is `/tp @s ~ ~1.25 ~` ([index.js](https://raw.githubusercontent.com/MineDojo/Voyager/main/voyager/env/mineflayer/index.js)). Mindcraft's survival is `moveAway(bot, 5)` after 20 s stationary and `moveAway(bot, 20)` at health <5 — "cannot excavate burial or create passages" ([modes.js](https://raw.githubusercontent.com/kolbytn/mindcraft/main/src/agent/modes.js)). The nearest peer, minecraft-agent-swarm, records "10-55/day" deaths on 5 bots and turned keepInventory on "approved by Jesse on 2026-09-07" ([repo](https://github.com/JesseRWeigel/minecraft-agent-swarm)). Newer 2026 work (Gated Coordination, MineNPC-Task, Echo, MineExplorer) is episodic construction/exploration benchmarking; none publishes deaths ([2604.18975](https://arxiv.org/abs/2604.18975), [2605.30931](https://arxiv.org/abs/2605.30931)).

Not attempted here: task diversity (Odyssey 183 compositional skills; Optimus-3 seven task groups, "60% success rate on open-ended tasks" [2506.10357](https://arxiv.org/abs/2506.10357)); learning (Voyager writes skills; your lessons/arms are retired); building and combat (Peaceful, nothing built); coordination (Sid, MineCollab — your 80 bots share pool facts but do not cooperate, so "colony" overstates it); and generality — every one of the 16 worlds runs `level-seed=1239381899`. "Code that works in any world" is a rule, not yet a measurement; the seed canary on 17 Sep is the first test.

Apples-to-oranges claims of yours: (a) "best documented deaths/bot-h" — on Peaceful, against a swarm that fields a combat bot (normal difficulty UNVERIFIED); (b) "reaches iron" set against per-episode diamond rates — the fair correction cuts both ways: JARVIS-1 gets a diamond pickaxe in "12.5%" of 60-minute episodes over "300 times on different seeds" ([2311.05997](https://arxiv.org/html/2311.05997)); you have 7,680 bot-hours in 96 h and zero diamonds. Persistence should compound, not excuse.

**2. Fair axes**

- *Survival/bot-h*: 0.054 (96 h), 0.026 post-promotion (before/after, not DiD). Swarm: 0.08–0.46/bot-h with keepInventory. **Ahead**, with the Peaceful caveat.
- *Tech tier, no cheats*: iron fleet-wide, "iron-pickaxe bot-hour share 2.0%", no diamond in 42 days. Parallelized Planning-Acting gets diamond armour in "13.7±4.1 minutes" with 3 mineflayer agents but pre-equipped kits ([2503.03505](https://arxiv.org/html/2503.03505v2)). **Behind** on depth, even discounting cheats.
- *Execution reliability*: gather 30% (13 Sep). JARVIS-1 names the same bottleneck: "the Controller's inability to perfectly execute short-horizon text instructions." **Level**; nobody has solved it.
- *Measurement rigour*: DiD, calibrated gates (2% false-revert), positive controls, live-trap capture/replay, an autonomous canary loop. **Ahead of everyone**, including the papers.
- *Cost per validated improvement*: 31 decisions/8 KEEPs in a month to 13 Sep; ~1 promotion/day since, six hours on ten bots each. Papers do not validate at all in this sense; in absolute terms it is expensive. **Behind on throughput.**
- *Pace*: 106 commits since 9 Sep, five promotions in three days. **Accelerating.**

**3. Grades**

PROGRESS: **B.** The last week is the first in which validated fixes shipped faster than analyses accrued (five promotions, likely 2x fewer deaths, the loop deploying unattended), but the program's two product numbers — iron retention 2% vs ≥8%, gather success — have not moved and the death gain is not yet DiD-proven.

STATE: **C+.** A field-leading instrument around a colony that reaches iron and loses it. Code maturity matches the brief: new modules (`floodpocket.mjs` 122 lines, `deathsites.mjs` 86, `lavaguard.mjs` 142) are pure, tested (18 test files), and cite measured evidence in comments; but `startReflexes` is a single 1,878-line function, `gather`/`mine`/`goto` run 460–530 lines, 40% of skills.mjs is comment, and the movement owner is still `ARBITER=0` behind a ratchet lint.

**4. Next month**

Would raise the grade most:
1. A DiD-read death rate ≤0.03 *and* iron-pickaxe bot-hours ≥8% — retention is the number the field cannot match and you have not hit.
2. Arbiter ON fleet-wide with the reflexes folded into one recovery state machine; the composition bug class (five "correct alone" guards) is what every review named.
3. The seed canary passing — the first evidence for "any world." A first diamond would be a tripwire, not proof.

Most likely to stall it: the serial pipeline. One canary at a time, six to twelve hours, five bots, on gates measured at "46% false revert" for the two-death rule over 6 h — a ceiling of roughly one validated change per day against a queue (falls, pooling, iron supply, navigator) that grows faster. The sandbox-first gate is designed but not yet the default.

UNVERIFIED: swarm difficulty; Optimus-3 "15% Diamond Group" (secondary source); Craftax numbers omitted as not comparable.

## Part 3 — Where they agree and differ (operator's note, 22:20 UTC)
Agree: the persistent, no-cheat, deaths-and-retention framing is genuinely distinctive and nobody publishes a comparator for it; measurement rigour is ahead of the field; technical depth (tech tier, task diversity, learning, cooperation, generality across seeds) is behind; the product numbers that matter (iron-pickaxe bot-hours 2% vs ≥8%, gather success, returned stock) have not moved; the stall risk is control ownership (the movement owner/arbiter is still off) and the serial one-canary-a-day pipeline. Grades: ChatGPT B−/C, Claude B/C+.
Differ: ChatGPT rules out "novelty by fleet size or open-ended social operation" (Project Sid, 49 agents, diamonds in ~30 min) and warns against treating a navigator rewrite as the cure (upstream pathfinder does dig/scaffold/pillar); Claude credits the pace (five promotions in three days, the loop deploying unattended) more and puts the seed canary and a DiD-read death rate at the top of what would move the grade.
Both: the seed canary (17 Sep) is the first test of "any world"; the 72-h read (17 Sep 09:34Z) is the instrument for the death claim.

## Part 4 — Correction (operator, 17 Sep 12:30 UTC): the fleet is NOT no-cheat on death
While preparing the seed canary I read the live gamerules over RCON: every Block 2 world runs **`keepInventory=true`** and `doImmediateRespawn=true`, set deliberately at provisioning by `scripts/place-town.py` ("without it a death destroys the carried inventory, which is the very quantity the retained-items endpoint measures, and death rates are not guaranteed equal across arms" — a Block 2 memory-experiment decision that outlived the experiment). Consequences for everything above:
- The brief's "NO cheats" line was wrong on this point, and Claude's Part 2 credited us with a survival lead over a swarm "with keepInventory" that we also have. Both reviewers' technical-depth and generality judgements stand; the survival comparison is level at best.
- Deaths do not spend tools. The iron-retention story ("deaths and escape activity spend the tools") is therefore only the second half: the funnel's "22 iron pickaxes gone during work" are wear and escape digging, never drops. The pooling and retention work should be read with that.
- The death handler's "dropped: ..." text lists what was carried, not what was lost.
Whether to turn keepInventory off is the owner's call and a program-level change (it makes every death cost the endpoint; it also makes the comparison honest). Recorded here, in the memo's brief, and in memory; not changed.
