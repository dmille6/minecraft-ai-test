# Wasted attempts: craft and gather, ranked by bot-time (2026-11-07)

The owner asked on 11-07: "crafting: why aren't we checking for ingredients before crafting attempts? gathering: this
sounds like a multi-stage and test solution, where do we begin? what can we do about this issue?"

**Short answer.** The craft skill does check ingredients, in about half a second. The check runs after the model has
chosen the craft, so what is lost is the decision, not the craft. All craft failures together cost **0.57% of fleet
bot-time**, so crafting is not where the time goes. Gather failures cost **13.7%**, and about a third of that is one
bot failing the same way from the same spot within ten minutes. The largest single cause is one milestone rung: the
gatherer chain's "Collect 8 sand" took **7.5% of all fleet bot-time**, and the gather skill refused most of its sand
as unsafe. The first fix retires that rung (`sandrung-01`, built). Next comes a per-bot memory of failed gather targets
(tier 3), then two small craft pieces.

## Stage 1: measurement

**Window.** Fleet 10.0.0.31: 80 bots, 24 h ending 2026-11-07 13:25Z, 1,920 bot-h. Rotated logs were loaded through
`lib.telemetry.stream_rows`, with nothing seeked. The walk read **2,227,473 skill-stream rows (155,944 real skill
runs) and 211,218 decision rows**. Showcase 10.0.0.40: 15 bots, 360 bot-h, 255,562 rows (the FIXTURE bot excluded).
The scripts are in this report's appendix (`wasted.py` and `analyze.py`, run from a mktemp copy of main's `scripts/lib`).

**Pricing.** An attempt costs its `duration_ms` plus its **lead**: the gap since the bot's previous real skill ended,
capped at 60 s. The lead is the decision cycle that produced the attempt. In the decision stream (10 bots, 26,245
decisions), the median time to the next decision is **17.8 s after a veto, 23.4 s after a failed gather and 28.3 s
after a successful one**. So vetoing an attempt instead of running it saves only about 5 s. Time comes back only when
the cycle produces something.

### All skills, failed bot-time (duration + lead), fleet 24 h

| skill | runs | ok% | failed bot-h |
|---|---:|---:|---:|
| gather | 39,349 | 38.4 | **263.5** (of 463.8 gather bot-h) |
| goto | 19,214 | 40.5 | 107.0 |
| build_shop | 6,239 | 28.4 | 97.6 |
| mine | 26,494 | 65.9 | 75.3 |
| home | 7,439 | 38.6 | 54.1 |
| explore | 12,560 | 62.3 | 52.9 |
| craft | 2,324 | 50.9 | **10.9** (of 20.5 craft bot-h) |

### Craft: 1,141 failures, 10.9 bot-h, 0.57% of fleet time

| cause | rows | bots | bot-h | repeat (same bot, item, cause) |
|---|---:|---:|---:|---:|
| bag full, "home -- then deposit X: banking is refused out here" | 243 | 21 | 2.67 | 87% |
| "short Nx iron_ingot for the whole tree" (iron_pickaxe 213 of 223) | 223 | 49 | 2.08 | 76% |
| interrupted by the entombed reflex | 210 | 70 | 1.98 | 46% |
| aborted | 156 | 58 | 1.14 | 43% |
| bag full, "no slot can be freed from here" (stick 50) | 92 | **4** | 0.73 | 88% |
| crafting_table N blocks away, not reached (stone_pickaxe 43) | 48 | 34 | 0.47 | 25% |
| "cobblestone / oak_sapling cannot be crafted" | 25 | 23 | 0.19 | |

- **Which decision path offered them.** 823 of 1,141 failures had trigger `llm:idle`: the model proposed them. The
  decision stream had 4,116 craft proposals. Admission let 2,332 through and vetoed 1,755, including 887 as
  `redundant_craft` (626 of those for stone_pickaxe), 624 as `repeat_loop` and 158 on cooldown.
- **Redundancy.** 903 of 915 `stone_pickaxe` runs came from bots holding an iron or diamond pickaxe, and 485 of those
  succeeded. That is by design: `toolhygiene.mjs` keeps iron for iron work, and only a stone copy with enough uses
  covers a stone craft. All 213 `iron_pickaxe` whole-tree failures came from bots that already held an iron-or-better
  pickaxe. Many were worn, for example three iron picks with 1, 3 and 63 uses left. So these are real requests that
  the bot cannot complete, not demand fiction.
- **Answer to the owner.** Moving the check in front of the decision saves the decision cycle only if the cycle then
  does something useful. The ingredient and room classes total about 5.5 bot-h a day. The repeats (76-88%) show the
  problem: the remedy is printed ("home, then deposit"), and the bot does not act on it.

### Gather: 24,220 failures, 263.5 bot-h, 13.7% of fleet time

| class | rows | dur bot-h | lead bot-h | median s | did not move | top detail (bot-h) |
|---|---:|---:|---:|---:|---:|---|
| no_path | 6,258 | 42.3 | 37.2 | 20.3 | 17% | "dirt found but unreachable after N attempts" 1,116 (14.3) |
| no_safe_target | 6,879 | 2.2 | 57.9 | 0.4 | 96% | "sand ... all N candidates beside water or under falling blocks" 3,117 (26.1) |
| unreachable | 5,362 | 14.6 | 39.4 | 1.5 | 44% | "iron_ore ... could not stand within reach" 1,879 (20.3) |
| interrupted | 4,069 | 20.5 | 27.4 | 12.8 | 7% | entombed reflex 3,315, stagnation 529, stuck 195 |
| nothing_found | 878 | 0.3 | 6.2 | 0.4 | 96% | "no iron_ore within N blocks" 399 |
| collect_budget | 237 | 3.6 | 1.6 | 49.3 | 1% | "ran out of time reaching iron_ore" 150 |
| no_measurable_change | 54 | 0.3 | 0.5 | 0.5 | 74% | only 54 rows: gather's own nmc is small |

Each class answers a different question:

- **Pathfinding** (no_path, plus unreachable "could not stand within reach"): the walk to a candidate fails. no_path
  moves a median of 4 blocks over 20 s and spends real duration (42.3 bot-h). The code here is protected.
- **Target choice** (no_safe_target, unreachable "buried, use mine", nothing_found): the planner correctly declines in
  under 2 s without moving. All of the cost is the decision cycle (lead 57.9 + 39.4 bot-h).
- **Interruptions**: the entombed reflex accounts for 81%, stagnation for 13% and stuck for 5%. 405 are followed by
  `watchdog_relocate`. This is escape and reflex work (protected), not gather.
- **no_measurable_change**: 54 gather rows (0.8 bot-h), so it is not a gather problem. The large nmc counts are in
  other skills: `goto` 2,617 (17.7 bot-h, a goto to the bot's own position, median 0.3 s), `home` 2,079 (17.7 bot-h,
  home while already home) and `mine` 1,713 (12.4 bot-h, "reached y=N but nothing changed").

**Repeats.** A repeat here means the same bot gathering the same block and failing with the same target-choice or path
class, **within 16 blocks and 10 minutes** of its last try, with no success in between. There were **8,411 such
repeats, costing 93.7 bot-h (4.9% of fleet time)**. By block: iron_ore 43.2, sand 23.5, oak_log 9.7, coal_ore 7.7,
deepslate_iron_ore 3.7, dirt 3.6. Failed bot-time by block: iron_ore 122.2 (13,579 runs, 18.0% ok), sand 36.1
(4,758 runs, **11.7% ok**), oak_log 32.6 (59.3% ok), dirt 26.2, coal_ore 24.2.

**Positive controls.** The same walk found 15,129 successful gathers, 1,183 successful crafts, every skill on all 80
bots, and decision rows on all 80 bots. Each zero above has a non-zero neighbour in the same query.

### The decision path: time by milestone task (decision stream, 1,875 bot-h of decision gaps)

| task | bot-h | share | failed or vetoed bot-h |
|---|---:|---:|---:|
| Mine N iron ore for tools | 362.6 | 19.3% | 173.1 |
| Keep the town grounds | 355.4 | 19.0% | 129.1 |
| Mine iron ore (drops raw_iron) | 293.7 | 15.7% | 114.4 |
| Return home | 148.0 | 7.9% | 63.9 |
| **Collect 8 sand. Found near water.** | **140.9** | **7.5%** | **78.4 (56%, the highest share)** |
| Mine 8 coal | 99.1 | 5.3% | 39.2 |

**The sand rung is a dead end built from two correct parts.** The gatherer chain (role `gatherer`, all 80 bots) asks
for 8 sand. Its HINT "gather with block=sand." wrote **4,086 of the 4,281** `gather sand` proposals. The gather skill
then refuses sand beside water or under falling blocks, which describes most sand: it falls, and it lies on beaches.
The result was 3,132 no_safe_target out of 4,758 runs.

The sand the bots did collect did not stay in a town: **11 of 16 town indexes hold 0 sand** (max 126) and glass is 0-2.
The rung also re-opens every lap: 16 of 20 persisted progress slots show 50+ completions of `gather_sand_8`.
Retiring it cannot cost a build anything, because builds that use sand keep their own demand (`mats.mjs` glass
inputs, `stocktarget.mjs` sand 64).

**What-if, measured on the same stream** (yield the rung after K same-area target-choice failures, with no success in
between). For sand, K=3 moves 63.7 bot-h and gives up 164 later successes. For logs, K=3 would give up 509 successes
in 25.9 bot-h, and for dirt 206. So a general fast-skip rule would hurt the productive rungs. The sand rung is the
outlier, and the fix is specific to it.

**Showcase** (15 bots, 360 bot-h). Craft is trivial: 55 runs, 24 of them one bot that could not put down a table.
Gather failures cost 21 bot-h: no_path 8.4 ("dirt found but unreachable" 332 rows), interrupted 6.5, unreachable 3.5,
no_safe 1.6. The sand rung held only 87 showcase decisions, so sandrung-01 has no showcase variant.

## Stage 2: design (Claude and Codex, independent)

Codex was given the measurements and the goal, not a design (`codex exec`, read-only). Its ranking:

1. **Location-sensitive gather failure memory** (new module, consumed by `skills.mjs::gatherRun`, then by prompt and
   decision selection; tier 3). Estimated 30-50 bot-h a day of the ~95 bot-h of repeats. Entries are keyed by
   dimension, block and exact target cell, and record the approach position, class and time. Path failures expire
   after 2 min or 8 blocks of movement; unsafe and buried targets after at most 10 min, or when their geometry changes.
   Interruptions, bag-full and timeouts are never learned. A success clears the entry. When every candidate is
   remembered, one bounded retry is kept. First shipment: candidate ordering only (`recordTargetFailure`,
   `targetPenalty`, `rankGatherCandidates`).
2. **Craft-room remedies for model-proposed crafts** (reuse `craftRoomCheck` / `roomRemedy` / `roomOrder`).
   1.5-2.5 bot-h a day.
3. **Whole-tree feasibility before selection** (`craftplan.mjs::planCraft` shared with `prompt.mjs::craftableNow` and
   `workorder.mjs::readyFor`). 1-1.5 bot-h a day. Codex's view: "ingredients represent only 0.11% of fleet bot-time".
   An admission veto saves only the half-second attempt, so the check pays off only when replacement work comes in
   the same cycle.

**Reconciliation.** Claude agrees with the order and the dead-end cautions: never learn from interruptions, keep one
bounded retry, and keep the stone/iron tool split. Claude's decision-path read, which Codex did not have, adds one
item above all three: the **sand rung**. It accounts for 23.5 of the 93.7 repeat bot-h, and for 140.9 bot-h of rung
time. It is a milestone change (tier 1/2), it is deterministic, and a memory of failed targets cannot fix it: every
sand candidate is unsafe, not merely unreached, so there is no other candidate to remember. Codex's #1 then addresses
the iron_ore, log and coal repeats that remain (about 65 bot-h).

### The staged plan (each shippable alone)

| # | piece | tier | bot-h at stake (24 h) | status |
|---|---|---|---:|---|
| 1 | **sandrung-01**: retire the gatherer chain's sand rung (`SANDRUNG=1` restores it) | 1/2 (milestones.mjs, not protected) | up to 140.9 rung / 78.4 failing | **built**, branch `sandrung-01-on-e6a1ea2b` |
| 2 | **gathermem-01**: per-bot failed-target memory in gatherRun (Codex design above), then a same-area admission cooldown for target-choice refusals that hands over real work | 3 (gather, admission) | ~65 of the 93.7 repeat bot-h (iron_ore 43) | design only |
| 3 | **craftroom-02**: a bag-full craft refusal with "home, then deposit" becomes the deterministic room order (the existing roomOrder) for model crafts; the 4 "no slot can be freed" bots are named | 2/3 | 3.4 | design only |
| 4 | **craftplan-offer**: `craftableNow` and the iron hint use `planCraft` (the whole tree): no `iron_pickaxe` offer without ingots or raw iron plus fuel; ingots are named as the gap | 2 | 2.1 | design only |
| - | not here: entombed interrupts (48 bot-h, escape work), goto/home no_measurable_change (35 bot-h, a separate item), the iron rung's `mine` bad_args (idlework-02 follow-up) | | | |

## Stage 3: built (sandrung-01)

- **Branch** `sandrung-01-on-e6a1ea2b` on the live fleet sha e6a1ea2b042ee9c776670868457ece91fd8789fc. Commit `b7b2a530`
  (b7b2a530a60c5aef26576df9bc22f6c1d96bd456). Review: Codex (read-only, blockers-only, one round): **no blockers**.
  Full suite (`suite-run.py --ref`, ci2): 412/413. The one failure is `well.test`, which fails on the base too.
- **Change.** `bots/src/sandrung.mjs` holds the one switch (`SANDRUNG`, default retired). `milestones.mjs`
  `gathererChain()` builds the chain dirt -> wood -> cobblestone. `SANDRUNG=1` puts the old rung back, word for word,
  between wood and cobblestone. The controller builds its chain from `gathererChain()`. `towndeposit.mjs`
  `HELD_TARGETS` holds the rung's 8 sand only while the rung exists.
- **Tests.** `sandrung.test.mjs` covers the switch; the chain in both shapes; the real controller on a fake bag (by
  default the bot is never asked for sand, and with the switch on the control lands on the sand rung); the composed
  case (the next rung is cobblestone, never an empty task); and the held sand in both shapes. It has 5 anchored
  mutants. `tech-ladder.test.mjs` pins both chain shapes. `towndeposit.test.mjs` pins `SANDRUNG=1`, because its
  fixtures carry the rung's 8 sand.
- **Read** (registration `~/mcai-analysis/sandrung-01.<sha8>.json` on the canary host). The primary effect target is
  `failclass.rate.v1` gather|no_safe_target per bot-h, which should **decrease by at least 30%**: sand was 3,132 of the
  6,879. The second target is `skill.share.v1` gather|success, which should **increase by at least 5% relative**. The
  arithmetic: removing the sand runs moves 38.4% to 42.1%. Guardrails: items per bot-h, and deaths. The own line is the
  canary's decision share on "Collect 8 sand", which should be 0. Rollback: `SANDRUNG=1` in the env files, or the base
  sha.

## Appendix: scripts

The reads ran from a mktemp copy of `git archive origin/main scripts/lib` on each host, which was removed afterwards.
`wasted.py` streams both streams per bot (`stream_rows`), keeps reduced rows, and prices each run as duration plus
lead. `analyze.py` ranks causes per skill, and also measures target redundancy, triggers, interrupters, and repeats
within 10 min and 16 blocks. `task2.py` and `sim2.py` measure decision-stream time per TASK and the what-if for a rung
yield. They are kept in the control session scratchpad, not committed (read-once reads).
