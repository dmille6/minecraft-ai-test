# The two-week production decline, broken down; and when to start a fresh world (2026-10-23, r2)

_Read-only analysis, approved by the owner on 10-23 ("sure"). No fleet, queue, world, bot or RCON writes were made. Every number
comes from one of these read-only sources:_
- _Elasticsearch, through `scripts/lib/estelemetry.py` on 10.0.0.31 (`~/estel`, md5 identical to the repo, `nice -n 19`);_
- _`~/canary-journal.jsonl` and `~/digest/reads/`;_
- _each world's `TOWN-PLACED.json` and `world.pre-reseed-*` directory names on 10.0.0.30._

_The scripts are in `production-breakdown-2026-10-23/`, with their printed output in its `measure.txt` and the aggregate inputs
they read in its `out-aggregates/`. Raw compact rows (77 MB) and the LLM sample (50 MB) stay on 10.0.0.31 in
`~/prodbreak-1023/out/`. Facts quoted from earlier work rather than from `measure.txt` are marked **[quoted]**._

**Periods.**
- **BASE** is 10-08..10-10 and **END** is 10-20..10-22, each three whole UTC days.
- Every day has 80 bots and 1,920.0 bot-h, and every world 120.0 bot-h. `coverage()` credits a whole bot-hour for one document,
  so a stronger check was also run: every bot × 10-minute bin on all six days holds at least one LLM decision (11,520 of 11,520 a
  day, `skips_uptime.py`).
- Three-day means are used because single days swing by up to 10 %. The owner's single days (10-09, 10-16, 10-22) are reproduced
  exactly in §1. 10-07 is never touched.

**r2 changes** (Codex r1 and Claude r1, both CHANGE; §11):
- The accounting identity is now per rung and gross, with no order-dependent demand/yield split.
- The attribution follows a stated rule and is kept apart from the identity.
- A lap-number folding bug was fixed: `stockpile_wood#2356+prereq` was not folded into `stockpile_wood`.
- The depletion scenarios now use matched populations; a selection test, chronic-bot counts, a rung-state census, skip counts, an
  uptime proxy and board-d's pre-trend were added.
- Safety time is split into exclusive hours and overlapping exposure.
- The iron side effect is restated; overclaims are removed.

---

## 0. Answers first

**1. What changed is what the bots were asked to do.** About 160,000 LLM decisions a day were made, and the total did not change
(160,517 → 160,028). Which rung of the milestone ladder (`bots/src/milestones.mjs`) each decision served did change. Fleet
figures, +prereq and lap numbers folded (`decompose.py`):

| rung group (decisions/day) | BASE | END | change |
|---|---:|---:|---:|
| wood (stockpile_wood, gather_oak_log_12) | 20,162 | 4,591 | −15,571 |
| stone (stockpile_stone, gather_cobblestone_8) | 15,306 | 3,140 | −12,166 |
| iron (gather_iron_ore_3) | 24,883 | 16,300 | −8,583 |
| tools and stations (craft_*) | 11,858 | 2,932 | −8,926 |
| dirt (gather_dirt_16) | 29,112 | 34,872 | +5,760 |
| lap (patrol, return, idle) | 37,911 | 76,504 | +38,593 |

**The production rungs closed because the bags pass their completion tests, not because they were bypassed or given up.** This
applies the ladder's own tests to 74,794 / 73,979 sampled decisions (`rung_state.py`, 15 worlds):

| rung | fulfilled, BASE → END | bypassed (no means) | outstanding |
|---|---|---|---|
| stockpile_wood (64 or more wood) | 60.8 → 85.0 % | 0 → 0 | 39.2 → 15.0 % |
| stone_pickaxe (stone-or-better, 40 or more uses) | 50.1 → 81.5 % | 29.9 → 9.4 % | 20.0 → 9.1 % |
| gather_iron_ore_3 (3 or more raw iron plus ingots) | 18.1 → 64.7 % | 46.3 → 13.5 % | 35.6 → 21.9 % |
| stockpile_stone (64 or more stone-family) | 58.4 → 90.8 % | 0 → 0 | 41.6 → 9.2 % |

- **Every production rung was closed at once on 14.3 % → 50.3 % of decisions.** The share closed with at least one bypass fell
  from 52.5 % to 8.9 %.
- **Give-up skips on production rungs fell:** stockpile_wood 63 → 37 a day, craft_stone_pickaxe_1 58 → 2, gather_iron_ore_3 42 →
  31, stockpile_stone 45 → 15.
- **Success per decision held or rose on every rung group except wood** (15 worlds):
  - gather: wood 0.177 → 0.046, stone 0.158 → 0.172, dirt 0.225 → 0.303;
  - mine on the iron rung: 0.257 → 0.257.

**2. The accounting identity** (`decompose.py`). Events/day, BASE → END. Rung rows are the other 15 worlds × 16/15 and add up
exactly with T and R.

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

**3. Attribution, and the rule used** (`decompose.py`, ATTRIBUTION). This is an argued assignment, not a measured causal split.

| class | gather | mine | craft | rule and evidence |
|---|---:|---:|---:|---|
| (a) deliberate changes, and the bag build-up they allowed | −3,399 | −2,707 | −220 | The production-rung rows, plus the DEMAND part of the rows that gained decisions. Mechanism: the rungs closed by fulfilment (point 1). Timing: steps on 10-11/12, 10-14, 10-17/18 and 10-20..22 in all four world-age groups (§4). The organic part of the build-up cannot be separated (§10). |
| (b) depletion | −427 (scenario) | 0 (ceiling −124) | 0 | Gather: the fall in log sight on wood-rung decisions, priced at the BASE sight gap (§5.3). Mine: the iron-sight fall happens only near the surface, so it is location, and the −124 scenario is a ceiling (§5.4). |
| (c) safety traps and reflexes | −564 (±≈ 250) | −129 | −22 | The board-d water pit, as a conditional DiD with pre-trend (§6.1). Exclusive reflex time outside board-d also rose +14 h/day; its cost is not identified (§6.2). |
| (d) model, GPU, restarts, churn | no loss found | no loss found | no loss found | Decisions per bot-hour held (83.6 → 83.3); no bot was silent for 10 minutes; churn doubled (§7). |
| unexplained (an offset) | +2,570 | +553 | −53 | The YIELD part of the rows that gained decisions. Mostly dirt: 0.225 → 0.303 successes per dirt decision, stepping 10-11 and 10-18/21; nothing here ties that to a change. |
| R | −1 | +1 | 0 | |

- **The figures are gross.** The (a) losses are larger than the net decline, and the dirt yield offsets them. Shares of the net
  change are therefore not given.
- **In plain words:**
  - Most of the loss is the ladder no longer asking for wood, stone, iron trips and tools, because the bags hold them.
  - A board-d trap cost about a third of the gather decline.
  - Depletion is a few hundred gather a day.
  - Better dirt yield hides part of the loss.

**4. What the counts hide.**
- **Ore gained per day ROSE:** raw iron 305 → 476 (+56 %), raw copper 456 → 645, lapis 39 → 84, cobbled deepslate 245 → 1,639.
  Oak logs (12,212 → 1,755) and cobblestone (38,095 → 24,798) fell.
- **Gather ok is mostly dirt:** 6,583 of 13,634 at BASE, 10,350 of 11,813 at END. A mine success is one staircase step.
- **Crafting moved to `toolkit`:** about 302 tools a day at END, none at BASE (433 on 10-22: 286 iron shovels, 144 iron pickaxes).
  `craft` plus `toolkit` went 880 → about 886.
- **town_deposit attempts went 773 → 281,** −406 of it being the chest-full failure falling from 411 to 5, which is (a).
  Successes went 349 → 157 (§3.4).

**5. Per world (§8).**
- 12 of 16 worlds fell on gather, and 15 of 16 on mine and on craft.
- Every world-age group fell, and the production-rung share stepped on the same dates in all four.
- Younger worlds fell somewhat more. The test is underpowered and not significant (p = 0.32, 0.20; 6 vs 9 worlds), and it is not
  evidence that age does not matter.
- The clearest depletion signal is in the 12-day worlds (reseeded 09-27): a log in sight within 16 m fell from 82.4 % to 62.3 % of
  decisions.
- No world went untreated.

**6. Side effects worth an owner decision.**
- **The iron rung emptied, but iron supply did not fall.**
  - Raw iron comes from `gather iron_ore` (BASE 229-290 a day → END 390-427), not from `mine` (29-54 → 51-74).
  - The rung is fulfilled by carried iron: ingots per sampled decision went 0.67 → 2.13.
- **What is plausibly draining town iron** (an inference; town ledgers were not read) is the toolkit's output: about 415
  ingot-equivalents a day at END (iron shovel 1, iron axe 3, iron pickaxe 3), and 727 on 10-22, against 476 raw iron mined. STATE
  10-23 reports ingots −448/day **[quoted]**.
- **More iron shovels are made than dirt wears out.**
  - The toolkit made 194-286 a day at END. Dirt intake is about 39,000 blocks a day, which wears out at most about 156 shovels at
    250 uses each.
  - So shovels are being lost, banked or replaced early. Which one was not measured; it is worth a look.
- **Dirt is the largest single activity:** 170 gather-hours a day, 35 % of skill time, up from 138.
- **The scoreboard counts dirt and staircase steps.** A value-weighted items metric would have shown ore up and logs and cobble
  down.

**7. When to start a fresh world (§9).** Do not reseed the fleet now, and do not schedule a rotation. Expand instead: expeditions
to 1,200 blocks are approved and are designed after the 10-24 census. Keep one single-world reseed as a pre-registered experiment
behind a resource-specific trigger that today no world meets (placebo-d is closest).
- Depletion is measurable but is not what moved production.
- A reseed buys about a week of easy wood **[quoted]**, while wood demand fell to a quarter.
- It destroys a town and the long-period build.
- It costs the measurements while the fresh pool booms and declines.

---

## 1. Data, denominators and positive controls

- **Skill stream:** 2.77 M compact rows over 10-08..10-23, covering 36 kinds (`pull_rows.py`). The streamed count equals the
  server's point-in-time count for every kind. Server-side aggregations per world × skill × status are in `daily_skill_aggs.py`.
- **LLM stream:**
  - per day × world × milestone × chosen skill × outcome (`milestone_yield.py`). The milestone buckets sum to the day's decisions,
    the skill × status cells sum to each milestone's decisions, and multi-call extras are 0 on every day;
  - hourly per world × rung group (`rung_hourly.py`);
  - a systematic sample of 4 whole hours a day (00, 06, 12 and 18Z; 19,411-27,529 decisions a day) with perception, inventory,
    tools and position (`llm_sample.py`). `perception.blocks` is not indexed in ES, so it is read from rows.
  - **Lap numbers:** the milestone string carries a lap number, sometimes before `+prereq` (`stockpile_wood#2356+prereq`). r1
    stripped it only at the end, which left about 7,400 BASE decisions a day unfolded (Claude r1). Every reader now strips `#N`
    anywhere.
- **Reproduces the owner's table exactly** (`table_daily.py`):
  - gather ok/bot-h 7.15, 6.50, 6.37;
  - mine 8,243 / 7,322 / 5,508;
  - craft 885 / 742 / 478;
  - town_deposit 413/841, 249/350, 165/211.
- **The two streams agree.** LLM-outcome successes equal skill-stream successes: gather 13,633 vs 13,634, mine 8,114 vs 8,114,
  craft 880 vs 880 (BASE).
- **Independent re-derivation** (Claude r1, own ES queries):
  - raw iron per day 333/323/258 → 472/455/502;
  - board-d float hours;
  - share of decisions with 3 or more iron over all 24 h: 17.4 → 63.8 %, against the sample's 17.8 → 63.3 %;
  - the HOMES table: every pool's median town_deposit position is within 2 blocks.
- **The bag features against the rungs' own tests** (`sample_checks.py`):
  - on stockpile_wood, 64 or more wood is 0.0 %; on stockpile_stone, 64 or more stone is 0.0 %;
  - on the iron rung, 3 or more iron is 0.0 %, a trip pickaxe 100.0 %, and iron within 32 m 97.7-99.6 %.
  - These controls catch over-counting, not under-counting.
- **What perception can and cannot see** (`bots/src/state.mjs:87-96`):
  - It covers 15 kinds within 40 blocks, the nearest of each, rounded to a metre, so "within 32" is a proxy for the ladder's
    32-block search.
  - Its logs are oak, birch and spruce only. Those were 98 % of BASE log-gather attempts (7,327 of 7,449).
  - 0 of 148,773 sampled decisions in the two periods lack perception.
- **Coverage caveats:**
  - two rotations a day lose about 40-60 rows each, against 1.37-1.54 M docs;
  - completeness after 10-14 18:46Z is assumed, not reconciled, and no bound on it is claimed;
  - decisions per bot-hour are 82.3-85.9 on every day.

## 2. What the metrics count

| BASE → END, per day | value |
|---|---|
| gather ok | 13,634 → 11,813: dirt 6,583 → 10,350, logs 4,028 → 388, stone 2,476 → 431, ore 302 → 419 |
| gather hours | 268.8 → 195.6 (logs 82.7 → 7.1, stone 33.0 → 5.0, dirt 137.6 → 170.1) |
| successes per gather-hour | log 48.7 → 54.8, stone 75.0 → 86.8, dirt 47.8 → 60.9, ore 29.3 → 42.5 |
| items gained (gather + mine + explore) | raw iron 305 → 476, coal 189 → 206, raw copper 456 → 645, lapis 39 → 84, cobblestone 38,095 → 24,798, oak log 12,212 → 1,755, dirt 28,867 → 38,526 |
| mine ok | 8,114 → 5,832. Mine-hours 20.0 → 12.4. Decisions more than 8 blocks below home 52.1 → 65.4 % |
| craft ok | 880 → 584, plus `toolkit` tools 0 → about 302 |
| time in skills | 488.0 → 488.2 h/day: gather −73 h, explore +39 h, goto +23 h, smelt_town +14 h, furnace_drain +6 h. Skills plus LLM latency cover about 30 % of bot-time; the gaps between decisions are not examined here. |

## 3. The identity, row by row, and why each row is assigned where it is

### 3.1 Gather (−1,821/day)

- **T −564** (§6.1).
- **Wood rows −3,474.** 64 or more wood is fulfilled on 60.8 → 85.0 % of decisions, and the mean carried oak_log went 47 → 62.
  Wood-rung decisions fell to a quarter, and their success per decision fell 0.177 → 0.046.
- **The yield fall is mostly selection** (§5.3). At END, 59.9 % of sampled wood-rung decisions came from 10 bots with 50 or more of
  them and zero successes, against 13.1 % from 5 bots at BASE.
- −427 of the wood row is carved out as (b); the rest is (a).
- **Stone rows −2,009.** 64 or more stone is fulfilled on 58.4 → 90.8 %; mean carried cobblestone 78 → 202 (390 on 10-19, before
  cobblekeep-01). Yield per decision held (0.158 → 0.172). This is (a).
- **Dirt row +4,110.**
  - Decisions +5,760 a day: with the production rungs closed, the chain passes on to dirt, sand, patrol and return
    (`milestones.mjs:996-1042`). That demand part is (a).
  - Success per dirt decision 0.225 → 0.303 is the unexplained offset. It steps up around 10-11 (0.22 → 0.26-0.28) and again
    10-18 to 10-21 (0.29-0.31), when toolkit iron shovels arrive. The timing fits, but no measurement ties it to a change.
- **The mechanisms that let materials stay in bags are deliberate:**
  - no redundant crafts (toolhygiene-01);
  - keep 64 cobble and bank only whole stacks (stocktarget-01);
  - town_deposit keeps "the stockpile, scaffold, iron and best tools" (towndeposit-02, and its detail text).
  - Iron accumulation already began 10-11, before the toolkit changes, so part of the build-up is organic (§10).

### 3.2 Mine (−2,282/day)

- **Iron row −2,274.** Decisions fell 23,612 → 15,267 a day (15 worlds), and success per decision was EXACTLY level (0.257 →
  0.257).
  - The rung closed by fulfilment: fulfilled 18.1 → 64.7 %, with bypass falling 46.3 → 13.5 %, mostly through trip pickaxes (among
    bots that need iron, 44.3 → 65.1 % hold one).
  - This is (a), with the (b) ceiling of −124 inside it (§5.4).
- **Stone row −613** is (a).
- **Dirt row +718:** +5,760 decisions, and success per decision 0.020 → 0.037. The demand part is (a); the yield part is unexplained.
- **T −129.**

### 3.3 Craft (−296/day)

- **The loss sits under the stone rungs (−228) and the iron rung (−34),** that is, crafts made while on those rungs: 243 → 15 a day
  under stone.
- **Under the tool and station rungs, crafts held level** (450 → 460) on a quarter of the decisions: success per decision 0.037 →
  0.168.
  - Craft failures (status `failed`) fell 3,963 → 326 a day (10-09 vs 10-22).
  - On 10-09, 2,535 of the 3,963 failures were the bag-full redirect class ("deposit X ... frees slots"; "home -- then deposit X:
    banking is refused out here").
  - toolhygiene-01 refused 191-374 redundant crafts a day from 10-10; orderroom-01's read shows refused rung craft orders 4.54 →
    0.10/bot-h on the canary.
- **About 302 tools a day were made by `toolkit` at END,** outside this column. Craft is (a) −220, (c) −22, unexplained −53.

### 3.4 town_deposit (attempts −492/day, successes −192/day)

| outcome per day | BASE | END |
|---|---:|---:|
| ok | 349 | 157 |
| town chests in reach are full | 411 | 5 |
| nothing to bank (everything carried is kept) | 0 | 120 |
| unreachable or unopenable | 11 | 0 |

- **Attempts.** −406 of the −492 is the chest-full retry gone: cobblecap-1000, lidclear-01, stocktarget-01's pruning and the plinth
  wells. That is (a).
- **Successes −192.**
  - Board-d's excess is −16 (c).
  - The rest, −176, is (a): bags full of kept stock leave less that may be banked (STATE 10-19 **[quoted]**: 41 of 80 bots at 34
    or more slots).
- **Deposit,** the other banking skill, went 460 → 171.

## 4. Which changes moved the ladder: timing, and why per-change DiDs cannot apportion it

Bag shares and rung decisions step on the same dates in all four age groups (`rung_series.py`, `sample_state.py`). The
candidates are named by timing and mechanism; **no single change's share is measured.**

| step (fleet) | changes promoted fleet-wide in the window (`journal_events.py`) |
|---|---|
| 10-11 → 10-12: wood64 64 → 73 %, stone64 64 → 78 %, iron3 28 → 33 %; craft_stone_pickaxe rung 5.3k → 2.1k (10-10 → 10-11) | toolhygiene-01 10-10 11:31, peacefulkit-02 10-11 01:32, junkwell-02 10-11 19:31, gridfix-01 10-12 18:20 |
| 10-13 → 10-14: stone64 77 → 87 %; stockpile_stone 6.5k → 3.0k decisions | stocktarget-01 10-13 19:50, orderroom-01 10-14 02:19 |
| 10-17 → 10-18: wood64 76 → 86 %, stone64 83 → 92 %, iron3 36 → 49 %; stockpile_wood 8.2k → 3.2k; patrol+return+idle +13.8k | plinth-02 10-17 12:34 (direct), smeltjob-01 19:53, plinth-02.1 20:03 (direct), logcap-01 22:46 (direct), toolkit-02 10-18 06:27 |
| 10-20 → 10-22: iron3 54 → 71 %, trip 76 → 89 %; gather_iron_ore_3 18.5k → 13.8k | cobblekeep-01 10-20 11:23, toolkit-03 10-21 13:37, homefix-02 10-22 00:28, ironpick-01 10-22 06:56 |

**Per-change DiDs** (`canary_did.py`, `rung_did.py`; whole 10-minute bins or hours inside the stated bounds; 300 placebo draws per
window):
- On the four production metrics, the promoted canaries' DiDs are mostly within |z| < 2.
- **The summed band is an illustration only.** Summing the 22 canaries promoted by 10-22, assuming independence (their windows
  overlap in worlds), gives gather +15,616 ± 29,558 a day and mine −5,816 ± 26,023, against declines of 1,821 and 2,282. It is not
  a confidence interval for this decline.
- On rung shares, |z| > 3 appears only for three:
  - toolkit-02, craft +2.3 pp (z +4.5), against the trend;
  - protectzone-01, lap −26.2 pp (z −4.1), against the trend;
  - townindex-01, wood −2.4 pp (z −5.4), with the trend.
- **Why they fail.** A bag takes days to fill, and a 3-12 h window cannot see it.

**The owner's examples, checked:**
- **No redundant crafts:** 191-374 refusals a day.
- **Longer-lasting iron pickaxes:** stone_pickaxe rung fulfilled 50 → 82 %, its decisions 5,228 → 821 a day, and stone_pickaxe
  craft attempts 2,645 → 330 (10-09 → 10-22).
- **Cobble cap and cobble-in-bags:** stone-rung decisions 15,306 → 3,140; cobblestone gained 38,095 → 24,798.
- **Deposits that succeed instead of retrying:** chest-full failures 411 → 5.
- **Bag hygiene:** the 64-stack floors are what fulfil the rungs.

## 5. Depletion, measured directly

### 5.1 What the bot can see at decision time

Sample sizes are 79,386 decisions at BASE and 79,749 at END. "Log" means oak, birch or spruce.

| share of decisions | fleet | original (6) | isolated (4) | reseeded 09-19 (2) | reseeded 09-27 (4) |
|---|---|---|---|---|---|
| a log within 16 m | 79.7 → 70.3 | 75.3 → 69.4 | 85.2 → 76.1 | 77.2 → 77.2 | **82.4 → 62.3** |
| a log within 32 m | 96.0 → 94.2 | 94.0 → 93.6 | 97.5 → 95.3 | 95.0 → 95.1 | 98.2 → 93.5 |
| iron ore within 32 m | 97.7 → 93.5 | 97.3 → 93.3 | 96.7 → 94.4 | 98.7 → 92.2 | 99.0 → 93.5 |
| sand within 32 m | 87.7 → 92.0 | 86.0 → 90.7 | 89.1 → 91.9 | 88.6 → 95.2 | 88.4 → 92.5 |
| more than 100 from home | 33.5 → 21.8 | 33.0 → 23.2 | 34.5 → 17.4 | 37.4 → 16.2 | 31.0 → 26.7 |
| more than 8 below home | 52.1 → 65.4 | 55.5 → 72.5 | 55.5 → 73.2 | 54.7 → 44.5 | 42.0 → 56.0 |

- **These shares measure availability where the bots stand,** and that moves with behaviour: deeper, closer to home, or trapped.
  Board-d's pit raised its log share from 81 % to 89 %.
- **A log within 16 m fell in 12 worlds** (placebo-d 72 → 46, hive-a 83 → 59, hive-c 89 → 62, hive-d 88 → 60) and rose in 4.

### 5.2 Distance and outcomes

- **Successful-gather distance from home** (median across world-days):
  - logs 82 → 74, stone 62 → 58, ore 68 → 66;
  - dirt 38 → 41, which rose;
  - all classes 57 → 42.
  - These are distances of successes only, so selection applies. No class shows an outward search.
- **Log attempts:** ok 52.8 → 20.6 %; `no_safe_target` 7.9 → 35.5 %; nothing_found 5.2 → 1.7 %.
  - **In absolute terms the no-safe-target failures are flat** (602 → 667 a day), and chronic: the top 5 bots emitted 49 % → 81 %
    of them. board-a-Comet alone was about 200 a day in both periods (`final_checks.py` (5)).
  - **The share rose because the other log attempts went away.** This is not evidence that the easy trees are gone.
- **Ore:** ok 9.7 → 18.1 %. **Sand:** 5.9 → 5.6 %.

### 5.3 Logs: depletion or selection? (`rung_state.py` scenario A, `wood_selection.py`)

- **Wood-rung decisions** (stockpile_wood and gather_oak_log_12, 15 worlds, sample):
  - BASE n = 8,823: a log within 16 m on 82.4 %; success 19.9 % with a log visible and 4.8 % without.
  - END n = 2,401: a log within 16 m on 59.8 %; success 5.6 % visible and 1.2 % not.
- **Scenario A.** Held at the BASE sight gap (15.2 pp), the fall in sight explains −3.4 pp of the −13.4 pp per-decision fall. Priced
  on the wood-rung decisions, that is **−427 gather/day**. Using BASE rates is the generous choice.
- **The selection test** (worlds with at least 50 END wood-rung decisions, board-d out, weighted by END decisions):
  - where log sight HELD (board-a, isolated-c, isolated-d: +1.8 pp), success per decision fell −23.9 pp;
  - where sight FELL by more than 15 pp (six worlds: −33.6 pp), it fell only −8.2 pp.
  - Depletion predicts the reverse ordering. The remainder of the wood row is mostly selection: the bots still on the rung are the
    ones that could not finish it.
- **Without the chronic zero-success bots,** success per decision still went 0.207 → 0.087. Some of that may be depletion; it is
  not separated, and it stays in (a).

### 5.4 Iron (`rung_state.py` scenario B)

- **Population:** bots that need iron (fewer than 3 carried) and hold a trip pickaxe, the decisions on which the rung's own gate
  decides. Among them, iron ore within 32 m went 98.1 % (n = 27,112) → 95.1 % (n = 17,024).
- **Split by depth:**
  - more than 8 blocks below home: 99.9 → 99.7 %;
  - near the surface: 95.8 → 83.0 %.
  - The whole fall is near the surface, where the lap now keeps bots (§0.1), so it is location as much as depletion.
- **Scenario B.** Holding the share at BASE adds 476 iron-rung decisions a day. At 0.257 mine each, net of the displaced
  decisions at 0.013, that is −124 mine/day. It is a ceiling, and (b) for mine is entered as 0.

### 5.5 Verdict

- **Depletion is measurable,** clearest in logs near where the bots stand in the 12-day worlds (−20 pp).
- **It explains little of the decline:** about −430 gather a day (scenario A) and at most −124 mine.
- **Yields per decision on stone, iron and dirt did not fall,** and ore intake rose.

## 6. Safety traps and reflexes

### 6.1 Board-d (T)

- **The trap.** Three of board-d's five bots were held in a walled water pit. Its float holds:
  - about 1-2 h/day through 10-15;
  - 22.2 h on 10-16 and 47.9 h on 10-17;
  - 66.3-66.6 h of its 120 bot-h a day from 10-18 to 10-22.
- **Pre-trend** (`board_d_window.py`). Through 10-15, board-d ran 0.83 gather/bot-h ABOVE the mean of the other 15 (daily SD
  1.3). Trapped, it ran 3.75-4.30 below.
- **Uncertainty.** That SD puts about ±250 a day (2 SD) on the 3-day vs 3-day excess. Since board-d started above the others, T
  probably understates its loss.
- **Escape, matched hours** (02:00-17:00Z on 10-22 vs 10-23; poolescape-01 on board-d from 01:48:44Z):
  - gather 2.60 → 5.03/bot-h against the others' 6.58 → 6.62 (DiD +2.39);
  - mine DiD +4.95;
  - float 0.56 → 0.02 h/bot-h.
- **Classed (c).** It is a trap defect that a safety change fixed.

### 6.2 Reflex time outside board-d (`final_checks.py` (3))

- **Exclusive hours** are the skill time of goto, home, surface and explore when launched by a reflex or watchdog trigger, or
  chosen right after a reflex interrupt. Skills do not overlap.
- **Exposure hours** are water-hold seconds. Those reflexes run while a skill runs, so they overlap it.

| h/day | BASE | END |
|---|---:|---:|
| exclusive, all worlds | 60.6 (3.2 %) | 73.1 (3.8 %) |
| **exclusive, without board-d** (1,800 bot-h) | **56.7 (3.1 %)** | **71.1 (3.9 %)** |
| exposure, all worlds | 93.0 | 127.6 (board-d 66.6) |
| exposure, without board-d | 90.4 | 60.9 |

**Exclusive reflex time outside board-d rose by +14.4 h/day** (+0.8 pp of bot-time). The largest movers, all worlds:

| skill and trigger | BASE | END |
|---|---:|---:|
| goto by watchdog_relocate | 8.9 | 11.9 |
| explore after an entombment interrupt | 6.0 | 10.6 |
| goto after a stuck interrupt | 5.3 | 8.4 |
| goto after an entombment interrupt | 6.5 | 8.1 |
| home by watchdog_home | 1.2 | 2.0 |
| surface by watchdog_stranded* | 0.5 | 2.1 |
| goto by livelock_escape (fell) | 14.9 | 12.6 |

- **The watchdog part is expected from homefix-02** (10-22), which makes rescues start and run (expansion plan §2).
- **Its production cost is not identified.** Decisions per bot-hour did not fall. If each extra hour displaced an average
  skill-hour (24 gather and 12 mine at END), the cost would be about −350 gather and −170 mine a day. That is an upper-end scenario,
  not added to the table.
- **Deaths:** 46 → 40 a day (0.024 → 0.021/bot-h).

## 7. Other: the decision engine, the GPU move, restarts, churn

| | BASE | END |
|---|---|---|
| decisions/bot-h | 83.6 | 83.3 |
| latency p50 | 1.69 s | 1.79 s |
| latency p90 | 3.44 s | 3.33 s |
| latency p99 (10-22) | ≈ 7 s | 4.19 s |
| LLM share of bot-time | 4.4 % | 4.5 % |
| endpoint .16 share of decisions | ≈ 22 % | 23 % (10-20), 14 % (10-21), 0 % (10-22) |

- **Restarts:** `startup`-triggered decisions 537-615 a day → 379-516; `liveness_restart` 2.5-2.8k → 1.8-2.0k.
- **Uptime proxy:** 100 % of bot × 10-minute bins hold a decision on all six days.
- **Deploy churn:** 19 deploy, promote, teardown or owner-direct events in END (6 promotions) against 9 in BASE (3).
- **What this shows:** no measurable loss. It is not a proven zero; restarts shorter than 10 minutes are not resolved.

## 8. Per world, and the natural experiments

**Gather ok per bot-h, BASE → END:**
- board-a 7.12 → 5.98; board-b 5.99 → 6.50; board-c 7.00 → 6.65; **board-d 7.66 → 2.31**
- hive-a 8.85 → 6.33; hive-b 14.38 → 17.55; hive-c 9.31 → 5.81; hive-d 7.20 → 5.71
- isolated-a 6.87 → 6.39; isolated-b 6.80 → 5.62; isolated-c 4.42 → 4.37; isolated-d 6.32 → 5.11
- placebo-a 5.74 → 6.83; placebo-b 6.14 → 3.23; placebo-c 3.13 → 4.65; placebo-d 6.66 → 5.42

**Other metrics, per world:**
- Logs gathered ok per bot-h fell in every world.
- Ore items per bot-h rose in 14 of 16; board-b and board-d fell.
- Four worlds rose on gather (placebo-c +48 %, hive-b +22 %, placebo-a +19 %, board-b +8 %), all on more dirt.
- On mine, 15 of 16 fell; placebo-c rose +119 % from the lowest base.
- placebo-b is second-worst (gather −47 %, mine −53 %). Its float holds were at most 7.0 h/day, and it is not explained here.

**World age** (ticks on 10-09: original ≈ 45-47 d of server time, 09-19 reseeds ≈ 20 d, 09-27 reseeds ≈ 11.5 d):

| group | gather | mine | craft |
|---|---:|---:|---:|
| original | −10 % | −19 % | −29 % |
| isolated (original age) | −12 % | −25 % | −36 % |
| reseeded 09-19 | −15 % | −46 % | −46 % |
| reseeded 09-27 | −20 % | −33 % | −31 % |

- **Without board-d,** young vs original is gather −16.2 % vs −2.7 % (permutation p = 0.32) and mine −35.4 % vs −8.2 % (p = 0.20).
- **The test is weak.** It is underpowered, and age is confounded with seed, siting and initial resources.
- **What does hold:** every group fell, and the production-rung share stepped together, 44/37/37/46 % on 10-08 → 16/15/9/13 % on
  10-22.
- **Gather ok is the wrong yardstick for an age comparison.** It is mostly dirt, and hive-b's 17.55 drives the original group's
  level: without hive-b and board-d the original worlds run 5.90 at END, against the 12-day worlds' 5.86.

**Isolated pools** (private per-bot memory until 10-21 for b, and 10-23 15:26Z for a, c and d):
- They fell like the shared original worlds. Every change ran on them, so they are not an untreated control.
- isolated-b's conversion inside END moved with its siblings: **INCONCLUSIVE** (n = 1, two days).

## 9. When should we start a fresh world?

### 9.1 What depletion costs today

- About −430 gather a day and at most −124 mine (§5).
- It is concentrated in logs near where bots stand. The ladder now asks for logs a quarter as often, and ore intake is up.

### 9.2 What a reset costs

- **What a reseed buys** **[quoted: memory fresh-worlds-buy-one-week, measured 09-26]**:
  - log-gather success went 4.9 % → 57.6 % and items/bot-h 18 → 63 on identical code, then fell back 63.4 → 20.8 in six days;
  - that is about a week of easy wood;
  - n = 2 pools, and the reseed and the bot-state reset happened together.
- **What it destroys:**
  - the town: chests and their stock, including the scarce town iron;
  - the plinth and junk wells, the town index, the treefarm sites and the world-facts death sites;
  - the town plan's build;
  - the structures named in the owner's goal ("build cool structures, survive, and work together for long periods").
- **Bot state** **[quoted: reseed memo 09-27]**: inventories are lost unless playerdata is carried over, and carrying it risks stale
  spawns inside new terrain.
- **Instruments:** the frontier census leaves out a town reseeded inside its 14-day window.

### 9.3 What mixed ages cost the measurements

- **Pools of different ages as they stand.**
  - DiD absorbs level differences.
  - Young vs original trends here differ by about −1 pp a day (not significant), which is about 0.5 pp over a 6-12 h canary
    window: small against the placebo band.
  - That is an estimate, not an equivalence result.
- **A freshly reseeded pool.** The +13 items/bot-h DiD in two days, then −67 % in six days **[quoted]**, breaks parallel trends.
  - Keep such a pool out of draws, as canary and as control, for at least 14 days, and until its rung yields are back within its
    age band. The 14 days rests on that one prior experiment.
  - A scheduled rotation would hold about one pool in that state permanently, and shrink every control. A smaller control is what
    widened the interval that flipped junkwell-01's death gate in the 10-08 replay (CLAUDE.md).

### 9.4 Recommended policy

1. **No fleet reseed now, and no scheduled rotation.** Expand instead:
   - expeditions to 1,200 blocks (approved, designed after the 10-24 frontier census);
   - then outposts. The census ranks fresh regions 300-800 blocks out.
2. **Demand comes before land** (owner decisions, not part of this read). Production follows what the ladder asks for.
   - The town plan and building tier give wood, cobble and iron a use.
   - The iron rung counts carried iron as done.
   - The toolkit's iron spend and the shovel count above deserve a look.
3. **A pre-registered single-world reseed, on this trigger,** evaluated weekly per world.
   - **Valid days.** A day counts only with at least 1,000 sampled decisions in that world; about 1,650 is normal.
   - **For a resource the ladder is asking for** (its rung holds at least 5 % of the world's decisions that week), ALL of these must
     hold on at least 5 of 7 valid days:
     - **sight:** on that rung's decisions, the resource is in sight in under 50 %. That is a log within 16 m, or iron ore within
       32 m among bots that need iron and stand more than 8 blocks deep. The depth condition keeps lap time near town from
       triggering it.
     - **outcome:** success per decision on that rung, counting only bots that are not chronic (50 or more sampled decisions with
       zero successes), is below half the fleet median for that rung that week;
     - **no trap:** the world's exclusive reflex hours are under 2× the fleet median.
   - **And the frontier census shows no way out.** The town's `frontier-<home>` file lists no candidate region, or expedition-01's
     `no_route` turn-backs mark every candidate `unreached`. That census publishes from 10-24 00:20Z; the scripts here do not
     compute it.
   - **The experiment:**
     - outcome: that rung's success per decision, and value-weighted items per bot-h of that resource;
     - 14 days of observation;
     - controls: the same-age-group worlds;
     - the pool is out of canary draws for those 14 days;
     - the town is rebuilt by the plan's own code, never by world edits.
   - **Today no world meets it.** placebo-d is closest:
     - a log within 16 m on all decisions was 39.2 / 52.9 / 46.3 % on 10-20, 10-21 and 10-22;
     - its wood-rung decisions have a chronic bot (placebo-d-Delta);
     - the census lists candidates for it.
     - **Watch placebo-d.**
4. **Record world age as a stratum in the canary draw record.**

## 10. Limits

- **(a) rests on mechanism and timing.** The mechanism is that the rungs closed by fulfilment; the timing is the synchronous steps.
  Part of the build-up is organic accumulation on code that stopped consuming: iron accumulation began 10-11, before the toolkit
  changes. No data in this window separates the two, so (a) includes both.
- **(b) are scenarios.** The selection test is world-level, with 3 and 6 worlds in its two groups.
- **The unexplained dirt-yield offset is large.** Gather's (a) and its offsets are both bigger than the net change.
- **The LLM sample is 1/6 of hours,** at fixed UTC hours, so it does not align with world clocks. Perception sees three log
  species, with rounded distances.
- **About 70 % of bot-time** (between decisions) is not examined.
- **ES completeness after 10-14 18:46Z is assumed.**

## 11. Reviews

- **r1** (44ab4aca): **Codex CHANGE** (4 P1, 10 P2) and **Claude CHANGE** (1 P1, 10 P2, 3 P3). All findings are addressed in r2:
  - **The causal split.** The identity is per rung and gross; the attribution is a stated rule.
  - **The Shapley artifact** in craft is gone.
  - **The `+prereq` folding bug** (Claude) is fixed.
  - **Depletion "bounds"** are now matched-population scenarios, plus a selection test and chronic-bot counts.
  - **The iron estimate** is on the gate's own population, split by depth, as a ceiling.
  - **The iron side effect:** supply did not fall. The toolkit's iron spend and the shovel count are flagged instead.
  - **Safety time:** exclusive vs exposure. This REVERSES r1's "safety time fell outside board-d".
  - **Board-d** has a pre-trend and an escape DiD.
  - **World-age wording** is softened, with the hive-b caveat.
  - **The trigger** has outcome, depth and chronic-bot conditions, plus valid-day minima.
  - **The canary windows** are fixed.
  - **Coverage and 0.1 % claims** are replaced by the uptime proxy.
  - **Canopy** is its own class.
  - **The no-safe-target concentration** is shown.
  - **Number fixes:** wood demand is "a quarter"; 219 → 208; dirt distance rose; "decisions" not "bots"; "oak logs"; the
    bag-full class is 2,535.
  - **The archive:** `out-aggregates/`, untruncated outputs, reconciliation.
- **r2:** pending.

## Files

All under `docs/reports/production-breakdown-2026-10-23/`. Run on 10.0.0.31 as `cd ~/prodbreak-1023 && nice -n 19 python3 <x>`.
To rerun the no-ES scripts, gunzip `out-aggregates/*.json.gz` into `out/`.

| file | reads | what it does |
|---|---|---|
| `pull_rows.py` | ES | compact skill rows |
| `daily_skill_aggs.py` | ES | daily server aggregations |
| `llm_daily.py` | ES | latency, endpoints, triggers |
| `milestones_daily.py`, `milestone_yield.py`, `rung_hourly.py` | ES | the LLM ladder |
| `llm_sample.py` | ES | the 4 h/day sample |
| `skips_uptime.py` | ES | give-up skips, uptime proxy |
| `journal_events.py` | journal | deploy churn |
| `analyze.py` | rows | per world-day measures |
| `table_daily.py` | | owner table reproduction |
| `decompose.py` | | the identity and the attribution |
| `mix_shift.py` | | the order-dependent demand/yield split, kept for reference |
| `rung_state.py` | | rung fulfilment and both depletion scenarios |
| `wood_selection.py` | | the selection test and chronic bots |
| `board_d_window.py` | | board-d pre-trend and escape DiD |
| `rung_series.py`, `rung_did.py`, `canary_did.py` | | timing and DiDs |
| `sample_state.py`, `sample_checks.py` | | sight and bag shares, plus controls |
| `report_tables.py`, `side_checks.py`, `items_daily.py`, `final_checks.py` | | report tables |
| `explore_mix.py`, `peek*.py`, `fieldcaps.py` | | field discovery and mixes |
| `measure.txt` | | every printed table |
