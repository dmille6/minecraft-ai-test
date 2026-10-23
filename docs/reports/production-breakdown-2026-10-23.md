# The two-week production decline, broken down; and when to start a fresh world (2026-10-23, r4)

_This is a read-only analysis, approved by the owner on 10-23 ("sure"). No fleet, queue, world, bot or RCON writes were made._

**Sources.** Every number comes from one of these, all read-only:
- Elasticsearch, through `scripts/lib/estelemetry.py` on 10.0.0.31 (`~/estel`, md5 identical to the repo, run with `nice -n 19`);
- `~/canary-journal.jsonl` and `~/digest/reads/`;
- each world's `TOWN-PLACED.json` and `world.pre-reseed-*` directory names on 10.0.0.30.

**Files.**
- The scripts are in `production-breakdown-2026-10-23/`, and their printed output is in its `measure.txt`.
- `out-aggregates/` holds the aggregate inputs, plus sufficient-statistic tables for the sample and row analyses (Files).
- Raw rows (77 MB) and the LLM sample (50 MB) stay on 10.0.0.31 in `~/prodbreak-1023/out/`.
- Facts quoted from earlier work rather than measured here are marked **[quoted]**.

**Periods.** BASE is 10-08..10-10 and END is 10-20..10-22: three whole UTC days each, with 80 bots and 1,920.0 bot-h a day (120.0
per world). Three-day means are used because single days swing by up to 10 %. The owner's single days are reproduced exactly in
§1. 10-07 is never touched.

**Round history** (§11):
- r1 drew CHANGE from both reviewers; r2 rebuilt the identity and the scenarios.
- r2 drew CHANGE from both, with Codex raising three P1s.
- r3 drew Claude APPROVE and Codex CHANGE (two P2s); r4 fixes those, the medians and the wording.
- r3 did four things:
  - it presents the attribution as an illustrative allocation under a stated convention, with its sensitivity;
  - it gives the depletion scenarios as conditional ranges;
  - it drops the selection "test" as causal evidence;
  - it computes the reseed trigger per world.

---

## 0. Answers first

### 0.1 What changed is what the bots were asked to do

About 160,000 LLM decisions a day were made, and the total held at 160,517 → 160,028. Which rung of the milestone ladder
(`bots/src/milestones.mjs`) each decision served did change (fleet, lap numbers and +prereq folded; `decompose.py`):

| rung group (decisions/day) | BASE | END | change |
|---|---:|---:|---:|
| wood (stockpile_wood, gather_oak_log_12) | 20,162 | 4,591 | −15,571 |
| stone (stockpile_stone, gather_cobblestone_8) | 15,306 | 3,140 | −12,166 |
| iron (gather_iron_ore_3) | 24,883 | 16,300 | −8,583 |
| tools and stations (craft_*) | 11,858 | 2,932 | −8,926 |
| dirt (gather_dirt_16) | 29,112 | 34,872 | +5,760 |
| lap (patrol, return, idle) | 37,911 | 76,504 | +38,593 |

**The production rungs stopped being asked for mainly because the bags pass their completion tests, not because the rungs were
bypassed or given up.**
- This applies seven of the ladder's own predicates to 74,794 / 73,979 sampled decisions (`rung_state.py`, 15 worlds).
- The 64-block stockpile target is assumed. It is the cap from lap 14 for wood and lap 6 for stone, and the lap number is not kept
  in the sample. So these are conservative threshold checks.

| rung | fulfilled BASE → END | bypassed | outstanding |
|---|---|---|---|
| stockpile_wood (64 or more wood) | 60.8 → 85.0 % | 0 → 0 | 39.2 → 15.0 % |
| stone_pickaxe (stone-or-better, 40 or more uses) | 50.1 → 81.5 % | 29.9 → 9.4 % | 20.0 → 9.1 % |
| gather_iron_ore_3 (3 or more raw iron plus ingots) | 18.1 → 64.7 % | 46.3 → 13.5 % | 35.6 → 21.9 % |
| stockpile_stone (64 or more stone-family) | 58.4 → 90.8 % | 0 → 0 | 41.6 → 9.2 % |

- **All seven checked predicates were closed at once on 14.3 % → 50.3 % of decisions.** The share closed with at least one bypass
  fell from 52.5 % to 8.9 %.
- **Give-up skips on these rungs fell** (`_milestone_skipped`/day): stockpile_wood 63 → 37, craft_stone_pickaxe 58 → 2,
  gather_iron_ore_3 42 → 31, stockpile_stone 45 → 15.
- **Success per decision held or rose on every rung group except wood** (15 worlds):
  - gather on the stone rungs 0.158 → 0.172, and on the dirt rung 0.225 → 0.303;
  - mine on the iron rung 0.2567 → 0.2574;
  - gather on the wood rungs 0.177 → 0.046.
- These are snapshots of state. They show which rungs were open, not why each bag filled (§4, §10).

### 0.2 The accounting identity

`decompose.py`. Events/day, BASE → END. The rung rows are the other 15 worlds × 16/15, and they add up exactly with T and R.

| row | gather ok | mine ok | craft ok |
|---|---:|---:|---:|
| change | **13,634 → 11,813 (−1,821)** | **8,114 → 5,832 (−2,282)** | **880 → 584 (−296)** |
| T: board-d's excess over the other 15 worlds | −564 | −129 | −22 |
| under wood rungs | −3,474 | −14 | −13 |
| under stone rungs | −2,009 | −613 | −228 |
| under the iron rung | −23 | −2,274 | −34 |
| under tool and station rungs | +5 | 0 | +10 |
| under the dirt rung | +4,110 | +718 | −16 |
| under sand, lap, deposit_surplus and smelt | +136 | +29 | +6 |
| R: successes not reached by an LLM decision | −1 | +1 | 0 |

### 0.3 An illustrative allocation to the owner's classes

`decompose.py`, ALLOCATION. **This is an allocation under a stated convention, not a causal identification.**
- **The convention**, per rung row:
  - demand = Δdecisions × BASE yield;
  - yield = END decisions × Δyield.
  - The two sum exactly to the row's change.
- **Sensitivity.** The opposite convention changes (a) a lot, and both values are printed.

| class | gather | mine | craft | what it holds |
|---|---:|---:|---:|---|
| (a) ladder demand: decisions that moved off the production rungs and onto dirt and the lap, at BASE yields | −3,756 (opposite convention −1,428) | −2,624 (−2,474) | −532 (−1,646) | Mechanism: those rungs read as fulfilled (§0.1). Timing: steps on 10-11/12, 10-14, 10-17/18 and 10-20..22, in all four world-age groups, on rollout dates (§4). The deliberate changes and any organic accumulation cannot be separated (§10). |
| (b) depletion, conditional scenarios | −145 (range −42 to −709) | −124 | 0 | Gather: the fall in log sight on wood-rung decisions (§5.3). Mine: the fall in iron sight among bots that need iron, all of it near the surface (§5.4). Each is "if sight were the only change". |
| (c) safety: the board-d water pit | −564 (± ≈ 255, a descriptive allowance) | −129 | −22 | A DiD with a pre-trend (§6.1). Separately, exclusive reflex time outside board-d rose by 14 h/day; its cost is not identified and sits in the yield rows (§6.2). |
| (d) model, GPU, restarts, churn | no loss found | no loss found | no loss found | Decisions per bot-hour held at 83.6 → 83.3, and every bot × 10-minute bin holds a decision (§7). |
| Yw: wood-rung yield beyond (b) | −411 | +1 | −2 | Unknown cause: chronic zero-success bots (55 % of END wood-rung decisions), depletion of reachable trees, or both (§5.3). |
| Yo: yield change on every other row (unexplained) | +3,057 | +594 | +260 | Mostly a higher success per dirt decision (0.225 → 0.303). The later step (10-18..21) coincides with toolkit iron shovels (toolkit-02, 10-18); the 10-11 step predates them. Neither is measured. |
| R | −1 | +1 | 0 | |

- **Plain reading:**
  - the biggest loss is that the ladder stopped asking for wood, stone, iron trips and tools while the bags held them;
  - a board-d trap cost about a third of the gather decline;
  - depletion, on these scenarios, is tens to hundreds of gather a day;
  - higher dirt yield masks part of the loss.
- **No net shares are given.** The offsets are larger than the net change.

### 0.4 What the counts hide

- **Ore gained per day ROSE:** raw iron 305 → 476 (+56 %), raw copper 456 → 645, lapis 39 → 84, cobbled deepslate 245 → 1,639.
- **Two things fell:** oak logs (12,212 → 1,755) and cobblestone (38,095 → 24,798).
- **Gather ok is mostly dirt:** 6,583 of 13,634 at BASE, 10,350 of 11,813 at END.
- **A mine success is one staircase step.**
- **Crafting moved to `toolkit`:** about 302 tools a day at END, none at BASE. `craft` plus `toolkit` went 880 → about 886.
- **town_deposit attempts went 773 → 281,** and −406 of that is the chest-full failure falling from 411 to 5, which is (a).
  Successes went 349 → 157 (§3.4).

### 0.5 Per world (§8)

- 12 of 16 worlds fell on gather, and 15 of 16 on mine and craft.
- All four world-age groups fell. Their production-rung shares stepped together, from 49.0/38.8/39.7/48.1 % on 10-08 to
  17.6/15.8/9.9/13.8 % on 10-22.
- **Younger worlds fell more,** but that is not significant (p = 0.32 and 0.20, 6 vs 9 worlds), and it is no evidence that age
  does not matter.
- **The clearest depletion signal is the 12-day worlds:** a log within 16 m fell 82.4 → 62.3 %.
- **No world went untreated.**

### 0.6 Side effects worth an owner decision

- **The iron rung emptied, but iron supply rose.**
  - Raw iron comes from `gather iron_ore` (229-290 → 390-427 a day), not from `mine` (29-54 → 51-74 a day).
  - The rung is fulfilled by carried iron: ingots per sampled decision went 0.67 → 2.13.
- **What plausibly drains town iron is the toolkit** (an inference; the town ledger was not read).
  - It made about 415 ingot-equivalents a day at END, and 727 on 10-22, against 476 raw iron mined a day. Shovels count 1 ingot,
    axes and pickaxes 3.
  - STATE 10-23 reports ingots −448/day **[quoted]**.
- **More iron shovels are made than dirt wears out.**
  - The toolkit made 194-286 a day at END. Dirt intake of about 39,000 blocks a day wears out at most about 156 shovels, at 250
    uses each.
  - So shovels are lost, banked or replaced early. Which one is unmeasured.
- **Dirt is the largest single activity:** 170 gather-hours a day, 35 % of skill time.
- **The scoreboard counts dirt and staircase steps.** A value-weighted metric would show ore up, and logs and cobble down.

### 0.7 When to start a fresh world (§9)

**Do not reseed the fleet now, and do not schedule a rotation. Expand instead:** expeditions to 1,200 blocks are approved and are
designed after the 10-24 census.
- **Keep one pre-registered single-world reseed** behind the resource-specific trigger in §9.4. It was evaluated for 10-16..10-22
  (`trigger_eval.py`): **no world fires.** The near miss is hive-d: on the wood arm it meets the sight and outcome conditions, and
  only the 5 %-share gate stops it (4.8 %).
- **Why not now:**
  - the observed availability changes are modest, and the conditional depletion scenarios are small next to the demand change;
  - a reseed buys about a week of easy wood **[quoted]**, while wood demand fell to a quarter;
  - it destroys a town and the long-period build;
  - it costs the measurements while the fresh pool booms and declines.

---

## 1. Data, denominators and positive controls

- **Skill stream.** 2.77 M compact rows over 10-08..10-23, of 36 kinds (`pull_rows.py`).
  - The streamed count equals the server's point-in-time count for every kind.
  - Server-side aggregations are in `daily_skill_aggs.py`.
- **LLM stream:**
  - per day × world × milestone × skill × outcome (`milestone_yield.py`). Every day reconciles: milestone buckets = decisions; skill
    cells = each milestone's decisions; 0 extra rows from multiple tool calls;
  - hourly rung groups (`rung_hourly.py`);
  - a systematic sample of 4 whole hours a day (00, 06, 12, 18Z; 19,411-27,529 decisions a day), carrying perception, inventory,
    tools and position (`llm_sample.py`). `perception.blocks` is not indexed in ES.
  - **Lap numbers are folded anywhere in the string** (`stockpile_wood#2356+prereq` → `stockpile_wood`). That was a bug in r1,
    found by Claude.
- **Reproduces the owner's table exactly** (`table_daily.py`):
  - gather ok/bot-h 7.15, 6.50, 6.37;
  - mine 8,243 / 7,322 / 5,508;
  - craft 885 / 742 / 478;
  - town_deposit 413/841, 249/350, 165/211.
- **Stream agreement.** LLM-outcome successes equal skill-stream successes: gather 13,633 vs 13,634, mine 8,114 vs 8,114, craft
  880 vs 880 (BASE).
- **Independent re-derivation** (Claude reviewer, own ES queries and code):
  - raw iron per day;
  - board-d float hours;
  - the share of decisions with 3 or more iron over 24 h (17.4 → 63.8 %, against the sample's 17.8 → 63.3 %);
  - the HOMES table;
  - the rung-state shares;
  - the per-rung identity rows;
  - the BASE iron-rung decision count;
  - scenario A's −3.43 pp;
  - exclusive reflex hours.
- **The bag features against the rungs' own tests** (`sample_checks.py`):
  - 64 or more wood on the wood rung is 0.0 %, and 64 or more stone on the stone rung is 0.0 %;
  - on the iron rung, 3 or more iron is 0.0 %, a trip pickaxe 100.0 %, and iron within 32 m 97.7-99.6 %.
  - These catch over-counting, not under-counting.
- **Perception** (`bots/src/state.mjs:87-96`):
  - It covers 15 kinds within 40 blocks, the nearest of each, rounded to a metre.
  - Its logs are oak, birch and spruce only. Those were all 7,626 BASE log-gather attempts a day (oak 7,178, birch 253, spruce 195).
  - 0 of 148,773 sampled decisions in the two periods lack perception.
- **Uptime proxy** (`skips_uptime.py`). All 11,520 bot × 10-minute bins hold a decision on all six days, so no bot went 20 minutes
  without one.
  - **Positive control:** the same aggregation over today's window, which runs into empty future bins, reads 9,280 of 11,520. The
    instrument does see empty bins.
- **Coverage.** Each day loses about 40-60 rows at each of two rotations. Completeness after 10-14 18:46Z is assumed, not
  reconciled, and no bound is claimed. Decisions per bot-hour are 82.3-85.9 on every day.

## 2. What the metrics count

| BASE → END, per day | value |
|---|---|
| gather ok | 13,634 → 11,813: dirt 6,583 → 10,350, logs 4,028 → 388, stone 2,476 → 431, ore 302 → 419 |
| gather hours | 268.8 → 195.6 (logs 82.7 → 7.1, stone 33.0 → 5.0, dirt 137.6 → 170.1) |
| successes per gather-hour | log 48.7 → 54.8, stone 75.0 → 86.8, dirt 47.8 → 60.9, ore 29.3 → 42.5 |
| items gained (gather + mine + explore) | raw iron 305 → 476, coal 189 → 206, raw copper 456 → 645, lapis 39 → 84, cobblestone 38,095 → 24,798, oak log 12,212 → 1,755, dirt 28,867 → 38,526 |
| mine ok | 8,114 → 5,832. Mine-hours 20.0 → 12.4. Decisions more than 8 blocks below home 52.1 → 65.4 % |
| craft ok | 880 → 584, plus `toolkit` tools 0 → about 302 |
| time in skills | 488.0 → 488.2 h/day: gather −73, explore +39, goto +23, smelt_town +14, furnace_drain +6. Skills plus LLM latency are about 30 % of bot-time; the gaps between decisions are not examined. |

## 3. The identity, row by row

### 3.1 Gather (−1,821/day)

- **T −564** (§6.1).
- **Wood rows −3,474.**
  - 64 or more wood is fulfilled on 60.8 → 85.0 % of decisions, and the mean carried oak_log went 47 → 62. Wood-rung decisions fell
    to a quarter.
  - Their success per decision fell 0.177 → 0.046.
  - The allocation splits the row into (a) demand, (b) −145 and Yw −411.
- **Stone rows −2,009.**
  - 64 or more stone is fulfilled on 58.4 → 90.8 %, and mean carried cobblestone went 78 → 202 (390 on 10-19, before cobblekeep-01).
  - Yield per decision held at 0.158 → 0.172. The row is (a).
- **Dirt row +4,110.**
  - Decisions rose +5,760. With the production rungs closed, the chain passes on to dirt, sand, patrol and return
    (`milestones.mjs:996-1042`). That demand part is (a).
  - Success per dirt decision rose 0.225 → 0.303, which is Yo: about 0.22 through 10-10, 0.26-0.28 from 10-11, and 0.28-0.31 from
    10-18.
- **What lets materials stay in bags.** Each mechanism is deliberate:
  - no redundant crafts (toolhygiene-01);
  - keep 64 cobble and bank only whole stacks (stocktarget-01);
  - town_deposit keeps "the stockpile, scaffold, iron and best tools" (towndeposit-02).
  - But iron accumulation began 10-11, before the toolkit changes, so part of the build-up may be organic (§10).

### 3.2 Mine (−2,282/day)

- **Iron row −2,274.**
  - Decisions fell 23,612 → 15,267 a day (15 worlds), while success per decision was level (0.2567 → 0.2574).
  - The rung reads as fulfilled 18.1 → 64.7 %, and bypass FELL 46.3 → 13.5 %, mostly through trip pickaxes: among bots that need
    iron, 44.3 → 65.1 % hold one.
  - (b) −124 is a conditional scenario inside this row (§5.4).
- **Stone row −613.**
- **Dirt row +718.**
- **T −129.**

### 3.3 Craft (−296/day)

- **Where the loss sits:** crafts made under the stone rungs (243 → 15 a day) and the iron rung (−34).
- **Under the tool and station rungs, crafts held** (450 → 460) on a quarter of the decisions: 0.037 → 0.168 per decision.
- **Failures:** craft `failed` fell 3,963 → 326 a day (10-09 vs 10-22). On 10-09, 2,535 of those were the bag-full redirect
  ("deposit X ... frees slots" / "home -- then deposit X: banking is refused out here").
- **Refusals:** toolhygiene-01 refused 191-374 redundant crafts a day from 10-10. orderroom-01's read shows refused rung craft orders
  falling 4.54 → 0.10/bot-h on the canary.
- **Toolkit:** about 302 tools a day are made by `toolkit`, outside this column.

### 3.4 town_deposit (attempts −492/day, successes −192/day)

| outcome per day | BASE | END |
|---|---:|---:|
| ok | 349 | 157 |
| town chests in reach are full | 411 | 5 |
| nothing to bank (everything carried is kept) | 0 | 120 |
| unreachable or unopenable | 11 | 0 |

- **Attempts.** −406 is the chest-full retry gone (cobblecap-1000, lidclear-01, stocktarget-01's pruning, the plinth wells). That is
  (a).
- **Successes −192.**
  - board-d's excess is −16 (c);
  - the remaining −176 is (a): bags of kept stock leave less to bank. STATE 10-19 **[quoted]**: 41 of 80 bots at 34 or more slots.
- **Deposit** went 460 → 171.

## 4. Which changes moved the ladder: timing, and why per-change DiDs cannot apportion it

**Bag shares and rung decisions step on the same dates in all four age groups** (`rung_series.py`, `sample_state.py`). No single
change's share is measured.

| step (fleet) | changes promoted fleet-wide in the window (`journal_events.py`) |
|---|---|
| 10-11 → 10-12: wood64 64 → 73 %, stone64 64 → 78 %, iron3 28 → 33 %; craft_stone_pickaxe rung 5.3k → 2.1k (10-10 → 10-11) | toolhygiene-01 10-10 11:31, peacefulkit-02 10-11 01:32, junkwell-02 10-11 19:31, gridfix-01 10-12 18:20 |
| 10-13 → 10-14: stone64 77 → 87 %; stockpile_stone 6.5k → 3.0k | stocktarget-01 10-13 19:50, orderroom-01 10-14 02:19 |
| 10-17 → 10-18: wood64 76 → 86 %, stone64 83 → 92 %, iron3 36 → 49 %; stockpile_wood 8.2k → 3.2k; patrol+return+idle +13.8k | plinth-02 10-17 12:34 (direct), smeltjob-01 19:53, plinth-02.1 20:03 (direct), logcap-01 22:46 (direct), toolkit-02 10-18 06:27 |
| 10-20 → 10-22: iron3 54 → 71 %, trip 76 → 89 %; gather_iron_ore_3 18.5k → 13.8k | cobblekeep-01 10-20 11:23, toolkit-03 10-21 13:37, homefix-02 10-22 00:28, ironpick-01 10-22 06:56 |

**Per-change DiDs** (`canary_did.py`, `rung_did.py`; whole bins only; 300 placebo draws):
- On the four production metrics, promoted canaries sit mostly within |z| < 2.
- **The summed band is illustrative only.** Summed over the 22 promoted by 10-22, and assuming independence, it gives gather
  +15,616 ± 29,558 a day and mine −5,816 ± 26,023. It is not a confidence interval.
- On rung shares, only three exceed |z| > 3:
  - toolkit-02, craft +2.3 pp (z +4.5);
  - protectzone-01, lap −26.2 pp (z −4.1);
  - townindex-01, wood −2.4 pp (z −5.4).
- **Why it cannot be done:** a bag fills over days, and a 3-12 h window cannot see that.

**The owner's examples, checked:**
- **No redundant crafts:** 191-374 refusals a day.
- **Longer-lasting iron pickaxes:** the stone_pickaxe rung is fulfilled 50 → 82 %, its decisions fell 5,228 → 821 a day, and
  stone_pickaxe craft attempts fell 2,645 → 330.
- **Cobble cap and cobble-in-bags:** stone-rung decisions 15,306 → 3,140; cobblestone gained 38,095 → 24,798.
- **Deposits succeed instead of retrying:** chest-full failures 411 → 5.
- **Bag hygiene:** the 64-stack floors are what fulfil the rungs.

## 5. Depletion: observed availability and conditional scenarios

### 5.1 What the bot can see at decision time

79,386 decisions at BASE and 79,749 at END. "Log" means oak, birch or spruce.

| share of decisions | fleet | original (6) | isolated (4) | reseeded 09-19 (2) | reseeded 09-27 (4) |
|---|---|---|---|---|---|
| a log within 16 m | 79.7 → 70.3 | 75.3 → 69.4 | 85.2 → 76.1 | 77.2 → 77.2 | **82.4 → 62.3** |
| a log within 32 m | 96.0 → 94.2 | 94.0 → 93.6 | 97.5 → 95.3 | 95.0 → 95.1 | 98.2 → 93.5 |
| iron ore within 32 m | 97.7 → 93.5 | 97.3 → 93.3 | 96.7 → 94.4 | 98.7 → 92.2 | 99.0 → 93.5 |
| sand within 32 m | 87.7 → 92.0 | 86.0 → 90.7 | 89.1 → 91.9 | 88.6 → 95.2 | 88.4 → 92.5 |
| more than 100 from home | 33.5 → 21.8 | 33.0 → 23.2 | 34.5 → 17.4 | 37.4 → 16.2 | 31.0 → 26.7 |
| more than 8 below home | 52.1 → 65.4 | 55.5 → 72.5 | 55.5 → 73.2 | 54.7 → 44.5 | 42.0 → 56.0 |

- **These shares are availability where the bots stand,** and that moves with behaviour (board-d's pit raised its log share from 81
  to 89 %).
- **A log within 16 m fell in 12 worlds:** placebo-d 72 → 46, hive-a 83 → 59, hive-c 89 → 62, hive-d 88 → 60.

### 5.2 Distance and outcomes

- **Distance of successful gathers from home** (median across world-days; successes only, so subject to selection):
  - logs 82 → 74, stone 62 → 58, ore 68 → 66, dirt 38 → 41.
  - No class shows an outward search, and the share of decisions made more than 100 blocks out fell.
- **Log attempts:**
  - ok 52.8 → 20.6 %, `no_safe_target` 7.9 → 35.5 %, nothing_found 5.2 → 1.7 %.
  - The no-safe-target failures are flat in absolute terms (602 → 667 a day) and come from chronic bots: the top 5 bots emitted
    49 → 81 % of them, with board-a-Comet at about 200 a day in both periods.
  - The share rose because other log attempts went away. It is not evidence about trees.
- **Ore:** ok 9.7 → 18.1 %.

### 5.3 Logs (`rung_state.py` scenario A, `wood_selection.py`)

- **Wood-rung decisions** (15 worlds, sample):

  | | BASE (n = 8,823) | END (n = 2,401) |
  |---|---|---|
  | a log within 16 m | 82.4 % | 59.8 % |
  | gather success, log visible | 19.9 % | 5.6 % |
  | gather success, not visible | 4.8 % | 1.2 % |

- **Scenario A** asks: if only sight had changed, how much of the −13.4 pp per-decision fall would it explain?
  - At the BASE gap it explains −3.43 pp; at the END gap, −0.99 pp.
  - The volume it is priced on changes the answer:

  | priced at | wood-rung decisions/day (15 worlds) | gather/day, BASE gap | gather/day, END gap |
  |---|---:|---:|---:|
  | END volume | 3,967 | **−145** (the allocation's value) | −42 |
  | mean volume | 11,681 | −427 | −124 |
  | BASE volume | 19,394 | −709 | −205 |

  - The END-volume value answers "what does lower sight cost at today's demand". The BASE-volume value answers "what would it cost
    at the old demand".
  - It also misses any depletion that leaves a log visible but less reachable.
- **Chronic bots** (15 worlds; at least 50 sampled wood-rung decisions in the period, and zero successes):
  - they made 13.7 % of BASE wood-rung decisions (5 bots) and **55.1 %** of END's (8 bots).
  - Without them, success per decision went 0.200 → 0.086, and log sight 86.6 → 63.6 %.
- **Part of the remaining fall may be depletion of reachable trees,** and part selection. That remainder is Yw (−411), cause unknown.
- **The r2 "selection test" is withdrawn as evidence.** It compared worlds where sight held with worlds where it fell, but its groups
  differ in baseline success and in chronic bots (Codex and Claude r2). `wood_selection.py` still prints it, labelled descriptive.

### 5.4 Iron (`rung_state.py` scenario B)

- **Population:** bots that need iron (fewer than 3 carried) and hold a trip pickaxe. Iron ore within 32 m went 98.1 % (n = 27,112)
  → 95.1 % (n = 17,024).
- **By depth:**
  - more than 8 blocks below home: 99.9 → 99.7 %;
  - near the surface: 95.8 → 83.0 %.
  - Depletion and location (bots on the lap near town) cannot be told apart.
- **Scenario B.** Holding the share at BASE adds 476 iron-rung decisions a day. At 0.257 mine each, net of the displaced decisions
  at 0.013, that is **−124 mine/day**.
- **It is conditional on two assumptions:** that rung decisions scale with sight, and that the restored decisions yield the average.
  It is not a bound.

### 5.5 Verdict

- **Observed availability fell,** most clearly for logs near where bots stand in the 12-day worlds (−20 pp). It is measured at
  locations that themselves changed, so it is not a pure depletion measure.
- **On the scenarios it is tens to hundreds of gather a day** (−42 to −709; −145 at today's demand), and about −124 mine. That is
  small next to the ladder demand.
- **Yields per decision on stone, iron and dirt did not fall,** and ore intake rose.
- **It is not "today's measured cost".** It is a conditional estimate.

## 6. Safety traps and reflexes

### 6.1 Board-d (T)

- **The trap.** Three of board-d's five bots were held in a walled water pit.
  - Float holds were about 1-2 h/day through 10-15, 22.2 h on 10-16 and 47.9 h on 10-17.
  - From 10-18 to 10-22 they were 66.3-66.6 h a day, out of its 120 bot-h.
- **Pre-trend** (`board_d_window.py`).
  - Through 10-15, board-d ran 0.83 gather ok/bot-h above the other 15 (daily SD 1.3). Trapped, it ran 3.75-4.30 below.
  - That daily SD implies about 1.07/bot-h for the difference of two independent 3-day means, so ±2 SD is about ±255 a day on
    T = −564. It is a descriptive variability allowance, not a confidence interval.
  - The DiD absorbs the level difference. Its BASE gap (+0.60) sits slightly below the pre-trap mean (+0.83), which is worth about
    −28 a day.
- **Escape** (02:00-08:00Z on 10-22 vs 10-23):
  - The comparison is with the 13 worlds that had not received poolescape-01; placebo-a and hive-b were also canary pools.
  - It ends before the 08:05Z promotion.
  - board-d gather went 2.33 → 3.97/bot-h against 5.45 → 5.85 (DiD +1.24); mine DiD +7.22; float 0.55 → 0.03 h/bot-h.
- **Classed (c):** a trap defect that a safety change fixed.

### 6.2 Reflex time outside board-d (`final_checks.py` (3))

- **Exclusive hours** are skill time of goto, home, surface and explore launched by a reflex or watchdog, or chosen right after a
  reflex interrupt. Skills do not overlap.
- **Exposure hours** are water holds, which overlap skills.

| h/day | BASE | END |
|---|---:|---:|
| exclusive, all worlds | 60.6 (3.2 %) | 73.1 (3.8 %) |
| **exclusive, without board-d** (1,800 bot-h) | **56.7 (3.1 %)** | **71.1 (3.9 %)** |
| exposure, all worlds | 93.0 | 127.6 (board-d 66.6) |
| exposure, without board-d | 90.4 | 60.9 |

- **Movers, all worlds:**
  - goto by watchdog_relocate 8.9 → 11.9;
  - explore after an entombment interrupt 6.0 → 10.6;
  - goto after a stuck interrupt 5.3 → 8.4;
  - goto after an entombment interrupt 6.5 → 8.1;
  - home by watchdog_home 1.2 → 2.0;
  - surface by watchdog_stranded* 0.5 → 2.1;
  - goto by livelock_escape fell 14.9 → 12.6.
- **Two causes are visible.**
  - The watchdog jump comes on 10-22 (goto by watchdog_relocate 7.8, 8.5 → 18.6 h; Claude r2). That is homefix-02 making rescues
    run.
  - Explore after an entombment interrupt had already risen by 10-18, so that part is not homefix.
- **Cost.** If each extra hour displaced an average skill-hour, the upper end is about −350 gather and −170 mine a day. That cost,
  if real, sits inside Yo and (a), not in (c).
- **Deaths:** 46 → 40 a day (0.024 → 0.021/bot-h).

## 7. Other: the decision engine, the GPU move, restarts, churn

| | BASE | END |
|---|---|---|
| decisions/bot-h | 83.6 | 83.3 |
| latency p50 | 1.69 s | 1.79 s |
| latency p90 | 3.44 s | 3.33 s |
| latency p99 | ≈ 7 s | 4.19 s on 10-22 |
| LLM share of bot-time | 4.4 % | 4.5 % |
| decisions on the .16 endpoint | ≈ 22 % | 23 % (10-20), 14 % (10-21), 0 % (10-22) |

- **Restarts:** `startup` triggers went 537-615 → 379-516 a day, and `liveness_restart` 2.5-2.8k → 1.8-2.0k.
- **Churn:** the journal has 19 deploy, promote, teardown or owner-direct events in END (6 of them promotions), against 9 in BASE (3).
- **Uptime:** every fixed 10-minute bin is occupied (§1), so no bot went 20 minutes without a decision.
- **What this shows:** no measurable loss. It is not a proven zero; shorter silences are not resolved.

## 8. Per world, and the natural experiments

**Gather ok per bot-h, BASE → END:**
- board-a 7.12 → 5.98; board-b 5.99 → 6.50; board-c 7.00 → 6.65; **board-d 7.66 → 2.31**
- hive-a 8.85 → 6.33; hive-b 14.38 → 17.55; hive-c 9.31 → 5.81; hive-d 7.20 → 5.71
- isolated-a 6.87 → 6.39; isolated-b 6.80 → 5.62; isolated-c 4.42 → 4.37; isolated-d 6.32 → 5.11
- placebo-a 5.74 → 6.83; placebo-b 6.14 → 3.23; placebo-c 3.13 → 4.65; placebo-d 6.66 → 5.42

**Across worlds:**
- Logs gathered ok per bot-h fell in every world.
- Ore items per bot-h rose in 14 of 16; board-b and board-d fell.
- Four worlds rose on gather, all on dirt: placebo-c +48 %, hive-b +22 %, placebo-a +19 %, board-b +8 %.
- Mine fell in 15 of 16; placebo-c rose +119 % from the lowest base.
- placebo-b (gather −47 %, mine −53 %) is not explained here. Its water exposure was 7.6 h/day in 10-16..10-22, above twice the
  fleet median of 2.5 (`trigger_eval.py`).
- Board-a's exposure of 24.3 h/day is about 23 h/day of "no air route" holds, level on every day from 10-08 to 10-22. That looks
  like one bot held almost continuously (Claude r3). It does not move the change, but given the survival goal it is worth a look.

**World age** (on 10-09: original worlds about 45-47 days of server time, the 09-19 reseeds about 20 days, the 09-27 reseeds about
11.5 days):

| group | gather | mine | craft |
|---|---:|---:|---:|
| original | −10 % | −19 % | −29 % |
| isolated (original age) | −12 % | −25 % | −36 % |
| reseeded 09-19 | −15 % | −46 % | −46 % |
| reseeded 09-27 | −20 % | −33 % | −31 % |

- **Without board-d,** young vs original worlds differ by −16.2 % vs −2.7 % on gather (permutation p = 0.32) and −35.4 % vs −8.2 %
  on mine (p = 0.20).
- **That test is underpowered,** and age is confounded with seed, siting and initial resources.
- **Every group fell, and they stepped together** (§0.5).
- **Gather ok is a poor age yardstick:** it is mostly dirt. Without hive-b and board-d, the original worlds run 5.90 at END against
  5.86 for the 12-day worlds.

**Isolated pools:**
- They kept private per-bot memory until 10-21 (isolated-b) and 10-23 15:26Z (a, c and d).
- They fell like the shared original worlds. Every change ran on them, so they are not a control.
- isolated-b's conversion falls inside END: **INCONCLUSIVE** (n = 1, two days).

## 9. When should we start a fresh world?

### 9.1 Conditional depletion scenarios

- Scenario values are −42 to −709 gather a day (−145 at today's demand) and −124 mine. They are conditional (§5).
- The loss is concentrated in logs, which the ladder now asks for a quarter as often. Ore intake is up.

### 9.2 What a reset costs

- **What a reseed buys** **[quoted: memory fresh-worlds-buy-one-week, measured 09-26]**:
  - log-gather success went 4.9 % → 57.6 % and items/bot-h 18 → 63 on identical code;
  - then it fell 63.4 → 20.8 in six days, so about a week of easy wood;
  - n = 2 pools, with the reseed and the bot-state reset done together.
- **What it destroys:**
  - the town: chests and their stock, including the scarce town iron;
  - the plinth and junk wells, the town index, the treefarm sites and the world-facts death sites;
  - the town plan's build;
  - the structures in the owner's goal ("build cool structures, survive, and work together for long periods").
- **Bot state** **[quoted: reseed memo 09-27]**: inventories are lost unless playerdata is carried over, and carrying it risks stale
  spawns.
- **Instruments:** the frontier census leaves out a town reseeded inside its 14-day window.

### 9.3 What mixed ages cost the measurements

- **Pools of different ages as they stand.** DiD absorbs level differences. The trend difference here is about −1 pp a day (not
  significant), or about 0.5 pp over a 6-12 h canary window. That is an estimate, not an equivalence result.
- **A fresh pool.** The 09-19 trajectory **[quoted]**, +13 items/bot-h DiD in two days and then −67 % in six, breaks parallel trends.
  - Keep a fresh pool out of draws, as canary and as control, for at least 14 days, and until its rung yields are within its age
    band. The 14 days rests on that single prior experiment.
  - A rotation would hold about one pool in that state permanently, and shrink every control. A smaller control is what widened the
    interval that flipped junkwell-01's death gate in the 10-08 replay (CLAUDE.md).

### 9.4 Recommended policy

1. **No fleet reseed now, and no scheduled rotation.**
   - Expand instead: expeditions to 1,200 blocks (approved, designed after the 10-24 census), then outposts.
2. **Demand before land.** These are owner decisions, not part of this read:
   - the town plan and building tier give wood, cobble and iron a use;
   - the iron rung counts carried iron as done;
   - the toolkit's iron spend and shovel count deserve a look.
3. **A pre-registered single-world reseed on a weekly, pooled trigger** (`trigger_eval.py`, documented in its header). It fires for
   a world when ALL of these hold:
   - **WOOD arm.** Chronic zero-success bots are excluded from both sight and outcome.
     - The wood rungs hold at least 5 % of the world's sampled decisions, with at least 100 non-chronic decisions.
     - A log is within 16 m on fewer than 50 % of them.
     - Their gather success per decision is under half the median of eligible worlds.
   - **or the IRON arm.** It is defined on bots that NEED iron, not on the rung, since the rung vanishes without iron in sight.
     - Bots with fewer than 3 iron, a trip pickaxe, and feet more than 8 blocks below home make up at least 5 % of the world's
       sampled decisions, with at least 100 decisions.
     - Iron ore is within 32 m on fewer than 85 % of them.
     - Their successful gather(iron_ore) per decision is under half the median. A mine success is a staircase step, so it is not
       counted.
   - **and the world is not trapped:** its exclusive reflex hours AND its water exposure are each under twice the fleet median.
   - **and the frontier census shows no way out:** no candidate region in the town's `frontier-<home>` file, or every candidate
     marked `unreached` by expedition turn-backs. The census publishes from 10-24 00:20Z; this script does not compute it.
   - **The experiment:**
     - Outcome: the arm's success per decision, and value-weighted items per bot-h.
     - 14 days of observation, with the same-age worlds as controls.
     - The pool stays out of canary draws for those 14 days.
     - The town is rebuilt by the plan's code, never by world edits.
   - **10-16..10-22 result: no world fires.** The thresholds use conventional medians: wood 0.144, iron 0.011.
     - Only 4 worlds are eligible on the wood arm (board-a, board-d, isolated-d, placebo-c), and none has non-chronic log sight under
       50 % (lowest 0.73).
     - **The near miss is hive-d.** It meets sight (0.36) and outcome (0.023), and fails only the 5 % share gate (4.8 %). Watch it.
     - On the iron arm all 16 are eligible. board-d and isolated-c meet the outcome condition, but iron sight among their deep,
       iron-needing bots is at least 99 %.
     - board-a, board-d and placebo-b are flagged trapped by water exposure.
4. **Record world age as a stratum in the canary draw record.**

## 10. Limits

- **The allocation is a convention.** Under the opposite convention (a) is −1,428 gather, not −3,756.
- **(a) mixes deliberate changes with organic accumulation.** Iron accumulation began 10-11, before the toolkit changes.
- **(b) are conditional scenarios.** Yw and Yo are not attributed.
- **The LLM sample is 1/6 of hours,** at fixed UTC hours.
- **Perception** sees three log species and rounds distances. The 64-block target is assumed (§0.1).
- **About 70 % of bot-time,** the time between decisions, is not examined.
- **ES completeness after 10-14 18:46Z is assumed.**

## 11. Reviews

### r1 (44ab4aca): Codex CHANGE (4 P1, 10 P2); Claude CHANGE (1 P1, 10 P2, 3 P3)

All addressed in r2.

### r2 (a9436519): Claude CHANGE (no P1, 5 P2, 5 P3); Codex CHANGE (3 P1 partly resolved, several P2)

The r3 responses:

- **Codex P1, causal attribution.** §0.3 is now an illustrative allocation under a stated convention, with its sensitivity. (a) is
  demand only; every yield change is in Yw or Yo.
- **Codex P1 and Claude P2, wood scenario pricing.** All six pricings are shown. The allocation uses END volume, and the
  scenario's other omissions are stated.
- **Codex P1, the iron "ceiling".** It is now a conditional scenario (−124), entered as (b).
- **Codex and Claude P2, the selection test.** Withdrawn as evidence; chronic counts are now on the same 15 worlds.
- **Codex and Claude P2, the trigger.** Pooled weekly, with chronic exclusion in sight and outcome, the iron arm on bots that need
  iron, a depth filter, a water-exposure trap guard and a computed per-world table.
- **Claude P2, uneven yield treatment.** Uniform convention.
- **Codex P2, board-d.** The escape comparison uses untreated controls before the promotion. The "understates" claim is replaced by
  the measured −28 a day.
- **Codex P2, uptime wording.** Changed to 20 minutes, with a positive control.
- **Codex P2, numbers.** Shares 49.0/38.8/39.7/48.1 → 17.6/15.8/9.9/13.8; species coverage 7,626/day; iron yield "level", not
  "exactly".
- **Codex P2, archive.** Sufficient-statistic tables (`extract_archive.py`).
- **Codex P2, census scope.** "Seven checked predicates", with the 64 cap stated as an assumption.
- **Codex P2, sand in GAINING.** The rule is removed.
- **Claude P3s.** Reflex cost placement stated; uptime positive control; the trigger's chronic exclusion in sight.

### r3 (53ae74ae): Claude APPROVE (5 P3); Codex CHANGE (2 P2, several P3)

The r4 responses:

- **Codex P2, the trigger medians.** Now conventional `statistics.median`. Iron outcome changed to gather(iron_ore) successes only
  (Claude P3). The week's outcome is unchanged: no world fires.
- **Codex P2, board-d's uncertainty.** The ±255 derivation is shown and labelled descriptive.
- **Codex P2 (wording).** "Did not move production", the §5 title and the §9.1 title are replaced by statements of observed
  availability and conditional scenarios.
- **Codex P3s.** Stale docstrings and printouts fixed (skips_uptime, rung_state, wood_selection).
- **Codex r3 item 13** listed seven r2 items it could not see: #4, #5, #6, #9, #11, #13 and #18. Its own r2 review marked all seven
  resolved; they are the age test, perception, the never-used wording, safety exposure, canary windows, canopy, and folding.
- **Claude P3s.**
  - hive-d is named as the near miss.
  - The 10-11 dirt step predates the shovels.
  - Board-a's exposure is explained.
  - The uptime control is acknowledged as weak.

### r4: pending

## Files

All under `docs/reports/production-breakdown-2026-10-23/`. Run on 10.0.0.31 as `cd ~/prodbreak-1023 && nice -n 19 python3 <x>`.

| file | reads | what it does |
|---|---|---|
| `pull_rows.py` | ES | compact rows |
| `daily_skill_aggs.py` | ES | daily server aggregations |
| `llm_daily.py` | ES | latency, endpoints, triggers |
| `milestones_daily.py`, `milestone_yield.py`, `rung_hourly.py` | ES | the ladder |
| `llm_sample.py` | ES | the sample |
| `skips_uptime.py` | ES | skips, uptime proxy and its control |
| `journal_events.py` | journal | churn |
| `analyze.py` | rows | per world-day measures |
| `table_daily.py` | | owner table |
| `decompose.py` | | identity and allocation |
| `mix_shift.py` | | the r1 symmetric split, kept for reference |
| `rung_state.py` | | rung census and scenarios; writes `scenarios.json` |
| `wood_selection.py` | | chronic bots; the descriptive world comparison |
| `board_d_window.py` | | board-d pre-trend and escape |
| `trigger_eval.py` | | the reseed trigger, per world |
| `rung_series.py`, `rung_did.py`, `canary_did.py` | | timing and DiDs |
| `sample_state.py`, `sample_checks.py` | | sight and bag shares, plus controls |
| `report_tables.py`, `side_checks.py`, `items_daily.py`, `final_checks.py` | | tables |
| `extract_archive.py` | | writes the sufficient-statistic tables |
| `explore_mix.py`, `peek*.py`, `fieldcaps.py` | | discovery |
| `out-aggregates/` | | the aggregate JSONs (gzipped); `sample_features.csv.gz` (one row per sampled decision with every derived flag); `hourly_world.csv.gz`; `log_nst_by_bot.csv`; `journal_subset.jsonl` |
