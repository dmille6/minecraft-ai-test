# towniron-01 — the town iron reserve: the iron task stays open for the town, and the kit's shovel is stone while it is short (design, 2026-10-23)

OWNER 2026-10-23, answering the ironsmelt agent's report: **A "option 1"** (iron shovels only while the TOWN's iron is above its
reserve, otherwise stone shovels) and **B "build it now"** (the iron task stays open while the town's iron is below a reserve).
The operator made them ONE change: one setting, two consumers. ironshovel-01 is dropped as a separate change. Base: fleet
`6e1afb52`; variants on ironsmelt-01's canary shas `f4b3252f` (on 6e1afb52) and `fb8de72f` (on chatgate-01's 3cc5f14d).
Branch `towniron-on-6e1afb5`. The independent Claude review runs after the weekly limit resets (10-26 06:00 CDT), before
queueing (operator).

## 1. Rows first (measured 10-23, ES 24 h to ~16:40Z, 80 bots, 1,529,541 skill docs; the town index; the 00:15Z RCON census)

**The toolkit's iron.** 667 kit runs (`_toolkit phase=kit`): 372 crafted, 184 `no_iron`, 82 `more`, 13 `narrow`, 14 aborted,
1 craft_failed. Tools made: **iron_shovel 277**, iron_pickaxe 141, iron_axe 5 -- 710 ingots drawn. Raw iron reaching bags
(`_pickups` raw_iron): 543 in the same 24 h.

**Shovels wear out as fast as they are made** (this refutes the "over-make" premise; the owner then chose A, option 1):
`_tool_broke` iron_shovel **289** in 24 h (positive control: stone_pickaxe 186, iron_pickaxe 120 in the same rows). Of the 277
shovel-making runs, **209 had no shovel at all in the bag** (`before=`), 66 a spent one (<= 10 uses), 2 one with > 40 uses.
So iron shovels are not made early: each one costs an ingot because it is used up. Option 1 changes the TIER, not the rule.

**Town iron and the kit's no_iron** (per shared pool; index-known = each container's latest observation < 6 h old):

| pool | index-known ingots | raw | kit runs | ingots drawn | no_iron |
|---|---|---|---|---|---|
| placebo-a | 51 | 78 | 63 | 7 | **55** |
| placebo-c | 38 | 45 | 78 | 9 | **49** |
| board-a | 86 | 81 | 70 | 20 | **26** |
| isolated-c | 30 | 51 | 22 | 0 | **21** |
| hive-b | 36 | 26 | 37 | 39 | 13 |
| placebo-d | 38 | 52 | 38 | 45 | 11 |
| board-b, board-d, hive-a, hive-c, placebo-b, isolated-b | 67-184 | 42-94 | 26-55 | 49-74 | 0 |

All 184 no_iron runs are in towns at <= 86 index-known ingots; no town at >= 94 had any (hive-d, 37 ingots, had 0: the
threshold is not sharp). A kit draw takes 1-7 ingots and keeps 4 in every container it draws from (TOWN_IRON_KEEP).

## 2. The change

### 2.1 The reading (bots/src/towniron.mjs, one place)

`townIronStock(entries)`: over the bot's town index fold, each container's latest observation younger than 6 h counts its
iron_ingot + raw_iron (a later mutation mark does not drop it: the observation is still the best estimate). Unseen containers
count nothing, so the reading can only under-count -- both consumers then err toward keeping iron in town. Fewer than 3 fresh
observations, an unreadable index, or TOWNINDEX=off -> **unknown**: both consumers do exactly the base. `townIronLowNow()` is
true only when the switch is on and the town is KNOWN below `TOWN_IRON_RESERVE` (**default 64 units**, env setting; one
stack; below every no_iron-free town's reading, above the worst no_iron towns' ingots). The reader is memoised 30 s.
`TOWNIRON=off` is the one-setting rollback of both consumers.

### 2.2 Consumer 1: the iron task stays open for the town (milestones.mjs `gather_iron_ore_town`)

- **Ladder order.** A NEW rung, placed AFTER the bot's own iron rungs (`gather_iron_ore_3`, `smelt_iron_ingot_3`,
  `craft_bucket_1`, `craft_iron_pickaxe_1`), so it never holds a bot back from its own bucket or pickaxe. The base iron rung is
  unchanged (still done at 3 carried).
- **Done** when the bag carries `TOWN_IRON_SELF (3) + TOWN_IRON_CARRY (16)` iron units -- the cap on one round.
- **Means** (no means -> the ladder steps over it, never a fulfilment): the town KNOWN short (unknown or at/above the reserve
  -> none), iron ore in reach within 32 blocks and a pickaxe that can pay the trip (the base iron rung's own means).
- **The deposit chain.** The rung wants `iron_ore`, so the town deposit's `wanted` keep never covers raw_iron; its iron keep
  (`ironKeeps`) holds 3 units per iron craft not yet made (3 for a bot that has its bucket and pickaxe) and banks the rest.
  After the round the ladder moves on to `stockpile_stone`, `patrol`, `deposit_surplus`, `return`; at town the deposit banks
  the carried surplus (16 raw iron) and ironsmelt-01 (when kept) smelts it. Tested as a chain.
- **Release.** No ore in reach / no trip pickaxe / town not short: no means. Ore seen but not reachable: the ladder's own
  no-progress skip (45 min with no serving success, then the back-off) and the 25-attempt give-up, as for every gather rung;
  the residence cap. The carry cap ends every round. Tested as a chain through the real MilestoneController.

### 2.3 Consumer 2: the shovel tier (toolkit.mjs `kitNeeds`)

While the town is KNOWN short: a bag holding ANY usable shovel needs none; a bag with none and a cobblestone-family block
(cobblestone, cobbled_deepslate, blackstone) needs a `stone_shovel` (no ingot, 2 sticks: the craft makes them from wood as
for the iron kit); else nothing. Not short, or unknown: the base (an iron shovel when no usable iron one). The order passes
its reading in the args (`low: 1`), so a run keeps the order's tier. The pickaxe and the axe are unchanged.
`withdrawDefersToKit` (the iron pickaxe) is unaffected.

### 2.4 Rows

`_towniron_mode` once per spawn (the licence: a kind the base cannot write). `_town_iron` when a bot's view of its town flips
(state=low|ok|unknown units= ingots= raw= ctrs= reserve=): a change row the base cannot write. The rung shows in the decision
stream (`gather_iron_ore_town`) and `_work_order`; the stone shovel in `_toolkit` (`crafted=stone_shovel`).

## 3. Expected effect and the read

Towns below 64 today (index-known ingots + raw): of the 13 shared pools, by the table above hive-b (62) and, on ingots alone,
several more are near it; with ironsmelt-01 smelting raw iron the mix shifts between raw and ingots but the unit total is
what the reserve reads. The read (`townironread.py`): primary = raw iron banked into town by the canary (index xfers, verified
where the deposit re-opened) and the index-known town iron trend, canary vs control (DiD); iron shovels made per kit run;
correctness gates: an iron shovel made while the bot's own `_town_iron` said low (the tier broken), a town-rung decision while
the bot's `_town_iron` said ok/unknown, a stone shovel made with a usable shovel in the bag; no-harm: deaths (the gate's),
kit no_iron, gather ok per bot-h, the rung's no-progress skips.

## 4. Review round 1 (Codex, design + first-cut code) and what changed (r2)

Codex r1 **CHANGE** (1 P1, 5 P2). Changes:
- **P1, the delivery did not exist.** The town deposit keeps a whole name or none (19 raw iron in one stack: all kept, for a
  bag with no ingots) and fires on slot pressure; `deposit_surplus` skips with no chest near. Now a **town order
  `deliver_iron`** (towniron.mjs deliverOrder / deliverPlan; skills.mjs deliverIron; housekeeping, chatOnly, a keep-out C12 town
  job, refunded when the runner declines): at town, a bag carrying a round (TOWN_IRON_CARRY = 16) above its own keep (3 per iron
  craft not made yet, ingots first: the town deposit's ironUnitsNeeded, restated and tested equal) banks the rest with the
  deposit verb, the own count held back per name by `swapWithdrawHold` (ironsmelt-01's bank, Paper-proven). Placed just before
  the toolkit order (the delivery funds the kit). Tested in the fake world: one stack of 19 raw iron -> 16 in the town chests.
- **P2, over-count.** The reading counts only KNOWN containers (no mutation since the observation, < 6 h): a lower bound while
  only bots move town iron. A coverage denominator (`seen`) is in the row.
- **P2, the stone fallback blocked by an unfundable iron axe.** toolkitOrder tries the stone shovel ALONE (`args.only`) after
  every iron prefix failed.
- **P2, room for stone-only runs.** Such a run needs the bag's EXISTING empty slots: one for the shovel, one more if it takes
  sticks.
- **P2, the reserve evidence.** Corrected: the no_iron table's rows sum to 175 of the 184 (the other 9 are in the
  self-isolated per-bot towns). By UNITS (ingots + raw) the no_iron towns read 62-167 and the clean towns 73-263: the units do
  not separate them (placebo-a holds 129 units, 78 of them raw iron the kit cannot use until it is smelted -- ironsmelt-01).
  The default stays the owner's 64; on today's readings it marks ONE shared town (hive-b, 62). It is a setting; the read
  reports per town reading so it can be tuned. Draw exposure decides the tier (section 9).
- **P2, the read's gates** use the issuing order's `low` (the toolkit runner row's args), the delivery rows and exposure
  (section 3, the read).

## 5. Review round 2 (Codex) and what changed (r3)

Codex r2 **CHANGE** (1 P1, 3 P2). Changes:
- **P1, a partial delivery stranded the remainder.** A town ROUND is now recorded (`noteTownRound`, cognitive.mjs: while the town
  task is the active task); the delivery order fires at town for a recorded round with ANY iron above the own keep, and the
  round ends only when a delivery leaves none (`deliverOutcome` with the run's `surplusLeft`). Tested: the raw iron's deposit
  failing after the ingots' -> the round survives -> the remainder is retried and banked.
- **P2, the rung and the delivery disagreed.** The rung is done at TOWN_IRON_CARRY above the OWN keep (`ironOwnKeep`, the same
  calculation the delivery uses), not at a fixed 19.
- **P2, unrelated surplus delivered.** Only a recorded round is town cargo: a bag's own surplus on a town it never mined for is
  never delivered (deliverOrder skip `no_round`). The round is in-memory: a restart drops it, and the iron then stays the bot's
  (the base).
- **P2, the chain untested.** A continuous test: the real controller makes the town task current, the round is recorded, the
  bag fills (19 raw iron in one stack), the controller moves on, the bot is home, the delivery order fires, the real
  deliver_iron banks 16 and keeps 3, the round ends. The ordering mutant now really moves the rung ahead of the bot's own
  crafts (TOWN_IRON_RUNG is one constant at the end of TECH_LADDER; the mutant puts it first) and the chain fails for it.
- The read: scripts/host/townironread.py (gates G1 tier broken, G2 stone over a usable shovel, G3 own iron delivered, G4
  delivery loop, ARMS, LIVENESS, INSTRUMENT, EXPOSURE; primary iron delivered + the index-known town iron DiD).

## 6. Review rounds 3-6 (Codex) and what changed

- **r3 CHANGE (1 P1 + read P2s).** P1: `deliverOrder` cleared the round when the bag held no surplus, so the round recorded
  while the town task was current was gone before the bot had mined anything (it records at the START of the task). Now a
  surplus of 0 skips with `none` and KEEPS the round; only `deliverOutcome` with the run's `surplusLeft === 0` ends it
  (mutant `roundErasedEarly`). The read: G2 is judged from the order's structured args (before=, `@full` counted usable), not
  from prose; EXPOSURE needs BOTH consumers (>= 2 low-reading bots, >= 2 stone shovels, >= 2 deliveries that banked); the world
  fold replays ops (pre/post/held marks) as the bot's index does.
- **r4 CHANGE (the read).** Only the oldest index file's checkpoint is the base (an endpoint before its `at` is unavailable;
  newer checkpoints are covered by the raw records of the files they folded); the tie-break is (at, dirty over obs, larger id),
  ids kept through checkpoint expansion; `before='-'` is -1 (judged).
- **r5 CHANGE (1 P3).** The `noCarryCap` probe also failed on the ORIGINAL (its bag lacked a bucket and an iron pickaxe, so the
  own keep was 9, not 3): a probe that fails on both reads as a kill. `probeKill` now runs every probe against the real module
  first; the probe carries the bucket and the iron pickaxe.
- **r6 APPROVE, all three items.** A: every probe passes on the original and fails on its mutant for the intended reason.
  B: the stacked variants' +/- lines match the primary's apart from the two resolved conflict sites (index.mjs: both licence
  rows and imports; fakeworld NAMES: ironsmelt's `raw_iron`, then `stone_shovel`, `bucket`), and the composition with
  ironsmelt-01 is sound: the delivery banks raw iron the smelt job then withdraws and smelts; `ironSmeltCount` caps the
  furnace input at the verified withdrawal and `ironBankPlan` preserves the bag's opening raw iron and ingots, even when they
  include an undelivered town round (`fed`, `fe=`); stone shovels draw no iron or coal; the order sequence stays earlier orders
  -> delivery -> toolkit -> smelt/drain. C: the whole change APPROVE, with one observation: on the 6e1afb52 primary ALONE the
  banked raw iron is not smelted automatically (that is ironsmelt-01), and raw iron counts toward the reserve, so there the
  reserve can read met on iron the toolkit cannot yet draw. No P1/P2/P3. (Codex judged the probes by inspection; the suite
  runs them.)

The **independent Claude review has NOT run**: the weekly limit (resets 10-26 06:00 CDT). OWNER 10-23 B: it runs before the
operator queues the change; the entry fragment carries the hold `CLAUDE REVIEW PENDING (owner 10-23 B)`.

## 7. Tests

`npm test` (node scripts/run-tests.mjs): 295/295 at f41c8ba4 (primary), 291/291 at 8fa28100 (on f4b3252f), 295/295 at
8f3c16d4 (on fb8de72f). `bots/test/towniron.test.mjs`: 19 tests; 14 anchored mutants, each probe passing on the original first
(noTierSwap, anyShovelIgnored, skillIgnoresLow, rungIgnoresTown, noCarryCap, noMinContainers, unknownIsLow, deliverNoHold,
noStoneOnly, dirtyCounts, townRungFirst, noRoundGate, roundErasedEarly, retryOnlyRound). Refusal chains, both consumers:
the real MilestoneController (a short town opens the town task, never ahead of the bot's own bucket; town ok / unknown / no ore
-> no means, stepped over; released by the no-progress skip; the carry cap ends it), and the real toolkit order (town short
with no kit iron -> a stone-shovel order; an unfundable iron axe ahead of it -> the stone shovel alone; a full bag -> no order;
the control: town not short -> no order). The continuous chain: the controller's town task -> the round -> 19 raw iron -> the
real deliver_iron banks 16 and keeps 3 -> the round ends; a failed second deposit is retried. eslint no-undef: the base's one pre-existing hit (reflex.mjs:2506) on every tip.

## 8. Paper (sandbox, the base as positive control)

Driver `sandbox/craft/towniron-e2e.cjs` (branch towniron-sandbox-on-ab00709; requireSandboxLock, tag `towniron`), sandbox6,
10-24 00:22-01:35Z. One fresh real bot per scene, a scripted brain (status / short walks only), the server's slots read before and
after (every bag slot, three town chests, the ground). The town index is seeded from the server under the bot's own world id: 3
known containers, below the 64 reserve. Base = 6e1afb52 (the positive control), candidate = f41c8ba4.

| driver | build | shovel | deliver |
|---|---|---|---|
| r1 (e2ff5c72), index seeded before chest A | base | BASE_SHAPE | BASE_SHAPE |
| r1 | candidate | FAIL (the scene, below) | CANDIDATE_PASS |
| r1, seeded after chest A | base x3 | BASE_SHAPE x3 | BASE_SHAPE x3 |
| r1, seeded after chest A | candidate x3 | CANDIDATE_PASS x3 | CANDIDATE_PASS x3 |
| r2 (648e56c3, Codex driver r1 P2s) | base x3 | BASE_SHAPE x3: `_toolkit crafted=iron_shovel`, bag iron_shovel +1, chest A iron_ingot -1 | BASE_SHAPE x3: the 19 raw iron stay in the bag, town raw_iron +0 |
| r2 | candidate x3 | CANDIDATE_PASS x3: `_town_iron state=low units=20`, `_toolkit crafted=stone_shovel`, bag stone_shovel +1 cobblestone -1, no ingot moved | CANDIDATE_PASS x3: `_deliver_iron stop=done bag=3/19>3/0 dep=0/19 keep=3/0`, bag raw_iron -19, town raw_iron +19, the bag's 3 ingots kept |

Driver r2 (Codex driver r1 CHANGE, 3 P2): the oracle fails closed (one strict slot reader for the snapshot and the seed; the
ground '' or one parseable item per entity); the scene is checked exactly before it is measured (bag, three chests, ground; the
deliver cargo) and verdicts read deltas plus the run's own row; cleanup is confirmed (a signal aborts the scene at the next await,
the child's exit is awaited with SIGKILL escalation, every cleanup reply checked, exit 3 otherwise; SIGTERM mid-scene -> exit 1,
no player, the forceload removed). The new precondition caught the setup's own mob kill dropping 3 porkchops on the ground (now
killed when the measured bag is set).
Driver review: Codex r1 CHANGE (the 3 P2s above, plus the stick-only admission as a P3, "a bounded inherited limitation"; it
confirmed the r1 diagnosis), r2 APPROVE (648e56c3), no findings.

**r1's shovel FAIL was the scene.** The index was seeded before chest A's sticks went in by RCON. Sticks are a need the journal
counts completely (withdrawpick `NEED_COUNT_COMPLETE`), so the seeded zero-stick observation marked all three chests OUT and the
stick search found no candidate (`_toolkit outcome=short sticks=0 cand=0 visits=0`); the base's iron search is not subject to
that rule (cand=3). Fixed in the driver by seeding AFTER chest A is filled (20 units, still short); the bot is unchanged.

**What it exposed for the fleet (P3, not changed):** the stone-only order (0 ingots, 2 sticks) does not ask the town search for
sticks (`missFor` runs only when ingots > 0), so in a town the index knows holds no sticks, with no wood in the bag, the run
fails `short` without a visit and backs off 30 min (TOOLKIT_BACKOFF_MS): at most ~2 cheap failed runs per bot-h, the same
bound as the base's zero-ingot credit runs. The `toolkit` result prose says "from the town's iron (0 ingot(s) drawn)" for a
stone shovel (wording only; the `_toolkit` row says crafted=stone_shovel).

## 9. Draw exposure and the tier

`drawexposure.py` on the proxy (6 h: `toolkit` outcome=no_iron >= 3 and phase=kit >= 6 per pool), 10-23 23:50Z: eligible
hive-b (7 / 14), placebo-a (9 / 13), placebo-d (12 / 16); every other shared pool 0-2 no_iron. Three pools, not four: by the
owner's 10-23 policy the change registers **TIER 3** (the old behaviour: reads 180/360, KEEP from +360 when exposed, extend
for exposure). `draw_require_pools: ["hive-b"]`: the one drawable town the index reads below 64 (58 units 10-23).
