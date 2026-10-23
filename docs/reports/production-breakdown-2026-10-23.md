# The two-week production decline, broken down; and when to start a fresh world (2026-10-23)

_Read-only analysis, approved by the owner on 10-23 ("sure"). No fleet, queue, world, bot or RCON writes were made. Every
number comes from Elasticsearch through `scripts/lib/estelemetry.py` on 10.0.0.31 (`~/estel`, md5 identical to the repo,
`nice -n 19`), from `~/canary-journal.jsonl`, from `~/digest/reads/`, and from each world's `TOWN-PLACED.json` and
`world.pre-reseed-*` directory names on 10.0.0.30, all read-only. The scripts are in `production-breakdown-2026-10-23/`. Their
printed output is in `production-breakdown-2026-10-23/measure.txt`, and every table below is quoted from it._

**Periods.** BASE is 10-08..10-10 and END is 10-20..10-22, each three whole UTC days. Each day has 80 bots and 1,920.0 bot-h
(`coverage()`), with no empty 10-minute bin, and every world has 120.0 bot-h per day. Three-day means are used because single
days swing by up to 10 % (gather ok/bot-h ran 7.70 on 10-11 and 5.31 on 10-19). The owner's single days (10-09, 10-16, 10-22) are
reproduced exactly in §1. 10-07 is never touched; estelemetry refuses it.

---

## 0. Answers first

**1. Most of the decline comes from what the bots are asked to do, not from the world.** About 160,000 LLM decisions a day are
made, and the total did not change (160,517 to 160,028 a day). Which rung of the milestone ladder those decisions served did change:

| rung (decisions/day) | BASE | END | change |
|---|---:|---:|---:|
| stockpile_wood | 15,879 | 3,648 | −12,231 |
| stockpile_stone | 10,994 | 1,768 | −9,226 |
| gather_iron_ore_3 | 22,416 | 15,171 | −7,246 |
| craft_stone_pickaxe / crafting_table / furnace | 11,238 | 2,607 | −8,631 |
| gather_oak_log_12 and gather_cobblestone_8 (with +prereq) | 5,823 | 1,471 | −4,352 |
| patrol + return + idle (and idle+prereq) | 35,951 | 75,626 | +39,675 |
| gather_dirt_16 | 27,084 | 34,180 | +7,096 |

Those rungs are scored on what the bag holds, and the bags filled up. Shares of sampled decisions (about 26,000 a day):
- 64 or more wood: 61.6 % → 82.7 %
- 64 or more stone-family blocks: 58.6 % → 88.3 %
- 3 or more raw iron plus ingots: 17.8 % → 63.3 %
- a stone-or-better pickaxe with at least 40 uses: 49.3 % → 82.6 %

A rung whose bag test passes is stepped over in the same pass (`milestones.mjs:1012-1042`). The pass then runs down to dirt, sand,
patrol and return, or reaches the end of the chain with nothing outstanding (`idle`, "Nothing to do."). What each decision yielded
did not fall. Splitting each metric's change into demand (decisions on a rung) and yield (successes per decision):
- gather: −1,820 = demand −2,104 + yield +283
- mine: −2,283 = demand −2,434 + yield +151
- craft: −296 = demand −1,200 + yield +904

**2. The decomposition** (events/day, BASE → END; each column adds up exactly; method in §3):

| row | gather ok | mine ok | craft ok | class |
|---|---:|---:|---:|---|
| change | **13,634 → 11,813 (−1,821)** | **8,114 → 5,832 (−2,282)** | **880 → 584 (−296)** | |
| T: board-d water-pit trap (excess over the other 15 worlds) | −564 | −129 | −22 | (c) |
| D1: demand, production rungs satisfied by the bag | −4,718 | −2,742 | −1,154 | (a) |
| … of which: iron rung stepped over because no iron ore is within 32 m (an estimate inside D1) | ≈ −23 | ≈ −189 | ≈ 0 | (b) |
| D2: demand, the rest of the shortened lap (dirt, sand, patrol, return, idle) | +2,039 | +38 | −134 | (a) |
| Y1: yield on the wood rungs | −1,545 | +4 | −4 | (b) upper bound; lower bound ≈ −300 (§5) |
| Y2: yield on every other rung | +2,968 | +547 | +1,018 | other / unexplained (an offset) |
| R: successes not reached by an LLM decision | −1 | +1 | 0 | other |
| model latency, GPU move, restarts | ≈ 0 | ≈ 0 | ≈ 0 | (d) (§7) |

- **town_deposit.** Attempts went 773 → 281 a day (−492). Of that, −406 is the "town chests in reach are full" failure, which
  fell from 411 to 5 a day: the chest-full fixes, class (a). Successes went 349 → 157 (−192): board-d's excess is −16 (c); the
  rest is bags whose contents are all "kept" stock, with a new "nothing to bank" outcome at 120 a day (a). See §3.4.
- **What the counts hide.** Ore gained per day ROSE: raw iron 305 → 476 (+56 %), raw copper 456 → 645, lapis 39 → 84, cobbled
  deepslate 245 → 1,639. What fell is logs (12,212 → 1,755) and cobblestone (38,095 → 24,798).
- **Gather successes are mostly dirt:** 6,583 of 13,634 at BASE and 10,350 of 11,813 at END.
- **A mine success is one staircase step** ("reached y=N").
- **Crafting moved.** The `toolkit` skill made about 302 tools a day at END, none at BASE: 433 on 10-22, of which 286 were iron
  shovels and 144 iron pickaxes. The `craft` skill does not count them. `craft` successes plus `toolkit` tools went 880 → about 886 a day.

**3. Shares, as asked:**
- **(a) Deliberate: all of the decline and more** (net demand D1+D2 = −2,679 gather, −2,704 mine, −1,288 craft). Part of it is a
  side effect, not a planned cut (point 5).
- **(b) Depletion: real, but a small part.**
  - Gather: between −300 and −1,545 a day, all of it on logs, which bots now barely need.
  - Mine: about −190 a day (8 % of its decline). Iron ore within 32 m fell from 97.6 % to 93.3 % of decisions, and the iron rung is
    skipped without it.
  - Craft: about 0.
- **(c) Safety reflexes: one trap.** Board-d, where 3 of 5 bots were held in a walled water pit from 10-16 until poolescape-01 on
  10-23, accounts for −564 gather/day, 31 % of the fleet's gather decline. Outside board-d, reflex and safety bot-time FELL, from
  8.2 % to 7.3 % (§6).
- **(d) Other: none measurable** (§7).
- **Unexplained:** a positive offset, chiefly a higher success per dirt decision (§3.1).

**4. Per world (§8).**
- 12 of 16 worlds fell on gather, and 15 of 16 on mine and on craft.
- All four age groups fell, at the same dates (10-11/12, 10-14, 10-18, 10-20..22), which are rollout dates. Depletion would be
  gradual and would depend on age.
- Younger worlds fell more (gather −16 % vs −3 % without board-d, mine −35 % vs −8 %), but that is not significant (permutation
  p = 0.32 and 0.20, n = 6 vs 9).
- The one clean depletion signal is in the 12-day worlds (reseeded 09-27): the share of decisions with a log in sight within 16 m
  fell from 82.4 % to 62.3 %, against 75.3 % to 69.4 % in the original worlds.
- **There is no "untreated" world.** Every promoted change reached every world. The natural experiments available are world age,
  the synchronised timing, and board-d.

**5. Side effects the owner should know about** (findings, not decisions):
- **Iron mining demand fell while town iron runs out.** `gather_iron_ore_3` is "done" when the bag holds 3 or more raw iron or
  ingots (`milestones.mjs:554-559`). Carried ingots went 0.67 → 2.13 per decision, the share of bots holding 3 or more iron went
  18 % → 63 %, and iron-rung decisions fell by 7,246 a day. That rung drives about 3/4 of all mine successes (6,144 of 8,114 at
  BASE). The bags carry iron that satisfies the ladder and is never used. STATE 10-23 has town iron running out (ingots −448/day).
- **Dirt is the fleet's largest activity.** It took 170 gather-hours a day at END, 35 % of all skill time and 9 % of all bot-time,
  up from 138. It now wears out iron shovels: the toolkit made 286 on 10-22, about one ingot each. That is an inference from wear:
  about 39,000 dirt a day against 250 uses per shovel.
- **The scoreboard counts the wrong things** for "build, survive, cooperate". A value-weighted items metric would have shown
  output rising on ore and falling on logs and cobble, not a uniform decline.

**6. When to start a fresh world (§9).** Do not reseed the fleet, and do not schedule a rotation. Expand instead: expeditions to
1,200 blocks are approved and are designed after the 10-24 census.
- **What a reseed buys:** about one week of easy wood (the 09-19 experiment). Wood demand is now about 10 % of what it was
  (log-gather attempts 7,626 → 1,879 a day).
- **What it destroys:** a town, its stock, plinth and junk wells, the town index, and the long-period build. Those are the owner's
  stated goal.
- **What it costs the measurements:** a reseeded pool breaks parallel trends for about two weeks (a fresh-world boom, then −67 % in
  six days), so it has to leave the canary draws for that time. Pools of mixed ages as they stand are harmless to DiD.
- **One exception, pre-registered:** reseed a single world, as an experiment, only if it crosses the depletion trigger in §9.3 and
  expeditions cannot reach fresh land from it.
- **The binding constraint today is demand, not land.** Production will follow the town plan and building tier, which create real
  demand for wood, cobble and iron, not a reseed.

---

## 1. Data, denominators and positive controls

- **Skill stream:** 2.77 M compact rows over 10-08..10-23. They cover 36 kinds: the production, travel and home skills, the
  water-hold endings, and the reflex events (`pull_rows.py`; per-day counts in `out/rows/<day>.counts.json`). Every kind's
  streamed count equals the server's count for the same point-in-time snapshot (`rows()` raises otherwise).
- **Daily server-side aggregations:** per world × skill × status, with count and summed `duration_ms`
  (`daily_skill_aggs.py`, 1.37-1.54 M docs a day).
- **LLM stream:**
  - per day × world × milestone × chosen skill × outcome (`milestone_yield.py`). The buckets sum to the day's decision count on
    every day: 158,591 = 158,591 ... 159,142 = 159,142;
  - hourly per world × rung group (`rung_hourly.py`; binned = total every day);
  - a systematic sample of 4 whole hours a day (00, 06, 12 and 18Z; 1/6 of all decisions; 19,411-27,529 a day), carrying the
    bot's perception, inventory, tools and position (`llm_sample.py`). `perception.blocks` is not indexed in ES (`_field_caps`
    returns nothing for it), so it can be read only from rows.
- **Reproduces the owner's table exactly** (`table_daily.py`):
  - gather ok/bot-h 7.15 (10-09), 6.50 (10-16), 6.37 (10-22);
  - mine 8,243 / 7,322 / 5,508;
  - craft 885 / 742 / 478;
  - town_deposit 413/841, 249/350, 165/211.
- **The two streams agree.** The LLM stream's outcome successes equal the skill stream's successes: gather 13,633 vs 13,634, mine
  8,114 vs 8,114, craft 880 vs 880 (BASE means). Production is therefore entirely LLM-chosen, and "R" is ≈ 0 in every column.
- **The bag features are validated against the rungs' own definitions** (`sample_checks.py`, every day):
  - on `stockpile_wood` decisions, the share holding 64 or more wood is 0.0 %; on `stockpile_stone`, the share holding 64 or more
    stone is 0.0 %;
  - on `gather_iron_ore_3`, the share holding 3 or more iron is 0.0 %, the share with a trip pickaxe is 100.0 %, and the share
    with iron within 32 m is 97.7-99.6 %. That last gate is the rung's `hasMeans`; the gap from 100 % is one-decision label lag.
- **Coverage caveats** (carried by estelemetry):
  - each day crosses two log rotations, losing about 40-60 skill rows each;
  - after 10-14 18:46Z, completeness is assumed rather than reconciled;
  - 10-19 23:16Z-00:00Z was backfilled and reconciled row-exact.
  - None of these can move a daily count by more than about 0.1 %.

## 2. What the metrics count

| BASE → END, per day | value |
|---|---|
| gather ok | 13,634 → 11,813, of which dirt 6,583 → 10,350, logs 4,028 → 388, stone 2,476 → 431, ore 302 → 419 |
| gather hours | 268.8 → 195.6. Logs 82.7 → 7.1 h, stone 33.0 → 5.0 h, dirt 137.6 → 170.1 h |
| successes per gather-hour | rose in every class: log 48.7 → 54.8, stone 75.0 → 86.8, dirt 47.8 → 60.9, ore 29.3 → 42.5 |
| items gained by gather + mine + explore | raw iron 305 → 476, coal 189 → 206, raw copper 456 → 645, lapis 39 → 84, cobblestone 38,095 → 24,798, oak log 12,212 → 1,755, dirt 28,867 → 38,526 |
| mine ok | 8,114 → 5,832, while mine-hours went 20.0 → 12.4 and raw iron intake rose. Bots are deeper: 52.1 % → 65.4 % of decisions are more than 8 blocks below home |
| craft ok | 880 → 584, plus `toolkit` tools 0 → about 302 |
| skill time in all | 488.0 → 488.2 h/day. Gather −73 h, explore +39 h, goto +23 h, smelt_town +14 h, furnace_drain +6 h |

## 3. Decomposition, metric by metric

**Method** (`decompose.py`). Each column adds up exactly to the metric's change; the check line in `measure.txt` reads −0.0.
- **T, the trap.** Board-d's change minus the mean change of the other 15 worlds.
- **The common change.** 16 × the mean change of the other 15 worlds. It is split on those 15 worlds' LLM decisions by a
  symmetric (Shapley) demand/yield split on each milestone string:
  - demand = Δdecisions × mean yield;
  - yield = mean decisions × Δyield.
  The result is scaled by 16/15.
- **D1** is the demand on the production rungs: `stockpile_wood`, `stockpile_stone`, `gather_iron_ore_3`, `craft_*`, `smelt_*`,
  `gather_oak_log_12` and `gather_cobblestone_8`, each with +prereq.
- **D2** is the demand on everything else.
- **Y1** is the yield on the two wood rungs.
- **Y2** is the yield on everything else.
- **R** is skill-stream successes minus LLM-outcome successes.

### 3.1 Gather (−1,821/day)

- **T −564: the board-d pit.** Its float holds rose from about 1 h/day to 66.6 h/day of its 120 bot-h from 10-18, after 22.2 h on
  10-16 and 47.9 h on 10-17 (`side_checks.py`). They fell to 6.5 h on 10-23 after poolescape-01. Board-d gather went 7.66 →
  2.31/bot-h.
- **D1 −4,718: the wood and stone rungs empty out.**
  - The bags hold the stockpile: 64 or more wood 61.6 % → 82.7 %, 64 or more stone 58.6 % → 88.3 %. The mean carried is oak_log
    47 → 62 and cobblestone 78 → 202 (390 on 10-19, before cobblekeep-01).
  - The gatherer chain's own log and cobble rungs are satisfied the same way.
  - These are the deliberate bag-keeping changes (§4): no redundant crafts eating wood and cobble (toolhygiene-01); the bot keeps
    64 cobble and banks only whole stacks (stocktarget-01); town_deposit keeps "the stockpile, scaffold, iron and best tools"
    (towndeposit-02, and its detail text).
- **D2 +2,039: the lap gets shorter.** The chain re-enters at index 0 whenever anything is outstanding (`milestones.mjs:996-1009`).
  With the production rungs vacuous, each pass is dirt → sand → patrol → return, so `gather_dirt_16` decisions rose by 7,096 a day (+5,760 with its +prereq form) and
  patrol/return/idle by 39,675 a day (idle+prereq included). Sand is 5.9 % → 5.6 % successful: 52.8 % → 61.4 % of its attempts end `no_safe_target`
  (a target "beside water or under falling blocks"), so it adds decisions and almost no successes.
- **Y1 −1,545: success per decision on the wood rungs fell.** On `stockpile_wood` it went 0.20 → 0.05. This is the only negative
  yield, and §5 bounds how much of it is depletion.
- **Y2 +2,968: an offset.** It is mostly `gather_dirt_16` (+1,974; success per dirt decision 0.225 → 0.293) and `stockpile_stone`
  (+636). It is not attributed to any one change.

### 3.2 Mine (−2,282/day)

- **D1 −2,742.** −2,063 of it is the iron rung and −623 the stone rung (15-world split, scaled). Three quarters of mine successes
  serve `gather_iron_ore_3` (6,144 of 8,114 at BASE): the model answers "Mine iron ore" with `mine` descents.
- **What emptied the iron rung.**
  - Bots holding 3 or more raw iron plus ingots went 17.8 % → 63.3 %, almost all of it carried ingots (0.67 → 2.13 per decision).
  - Iron in reach (the rung's other gate) moved only from 97.7 % to 93.5 %.
  - The rung's gate passes, so a bot that carries 3 ingots and owns an iron pickaxe from the toolkit is never asked to mine iron
    again. That is the side effect in §0.5.
- **Y1 +4 and Y2 +547.** Success per mine decision rose.
- **T −129.**
- **Depletion inside D1, about −189** (`decompose.py`, last lines). The iron rung is stepped over when no iron ore is within 32 m
  (`ironInReach`, `milestones.mjs:505-513`). That share fell from 97.6 % to 93.3 % of decisions in the 15 worlds.
  - Had it held, END would have had about 651 more iron-rung decisions a day. At END's 0.272 mine successes per iron decision,
    that is −189 a day, 8 % of the mine decline.
  - Ore intake per day still rose (§2).

### 3.3 Craft (−296/day)

- **D1 −1,154: fewer craft-rung decisions.**
  - The stone-pickaxe rung (5,196 → 813 a day): a trip-worthy pickaxe is held by 49 % → 83 % of bots, with iron pickaxes from the
    kit and worn-first use.
  - The table and furnace rungs (6,042 → 1,794 a day).
- **Y2 +1,018: success per craft decision rose.**
  - `craft_stone_pickaxe_1` successes stayed level at 208 → 205 on far fewer decisions.
  - Fewer refused or redundant crafts, consistent with toolhygiene-01 (redundant crafts refused: 191-374 `_redundant_craft` rows
    a day from 10-10), orderroom-01 (its read: refused rung craft orders 4.54 → 0.10/bot-h on the canary) and gridfix-01.
  - Craft failures fell from 3,963 to 326 a day (10-09 vs 10-22; `failed` status). On 10-09 the leading failures were the bag-full redirects
    ("home -- then deposit iron_ingot: banking is refused out here"), 849 rows alone.
- **About 302 tools a day were made by `toolkit` at END**, and are not in this column (§0.2).

### 3.4 town_deposit (attempts −492/day, successes −192/day)

| outcome per day | BASE | END |
|---|---:|---:|
| ok | 349 | 157 |
| town chests in reach are full | 411 | 5 |
| nothing to bank (all carried items are kept) | 0 | 120 |
| unreachable or unopenable | 11 | 0 |

- **Attempts.** −406 of the −492 is the chest-full failure disappearing: the deposits now succeed or are not tried, instead of
  being retried. That is cobblecap-1000, lidclear-01, stocktarget-01's pruning and the plinth wells: class (a).
- **Successes.**
  - The LLM split is demand +49 and yield −242. The bot reaches the town as often, but there is less it is allowed to bank: the
    stockpile, scaffold, iron and best tools are kept, and the bag is full of them (STATE 10-19: 41 of 80 bots at 34 or more
    slots).
  - Board-d's excess is −16 (c).
- **Deposit.** The other banking skill fell the same way, 460 → 171 successes.

## 4. Which changes moved the ladder

**Timing.** The bag-state shares and rung decisions step on the same dates in all four age groups (`rung_series.py`,
`sample_state.py`). The candidate changes are named by timing and mechanism; **none of these attributions is measured per change.**

| step (fleet, sample) | changes promoted fleet-wide in the window (journal) |
|---|---|
| 10-11 → 10-12: wood64 64 → 73 %, stone64 64 → 78 %, iron3 28 → 33 %; craft_stone_pickaxe rung 5.2k → 2.1k (10-11) | toolhygiene-01 10-10 11:31 (no redundant crafts, worn-first), peacefulkit-02 10-11 01:32, junkwell-02 10-11 19:31, gridfix-01 10-12 18:20 |
| 10-13 → 10-14: stone64 77 → 87 %; stockpile_stone 5.6k → 2.0k decisions | stocktarget-01 10-13 19:50 (keep 64 cobble, bank whole stacks, cap 256), orderroom-01 10-14 02:19 |
| 10-17 → 10-18: wood64 76 → 86 %, stone64 83 → 92 %, iron3 36 → 49 %; stockpile_wood 7.8k → 2.8k; patrol+return+idle +13.8k | plinth-02 10-17 12:34 (direct), smeltjob-01 19:53, plinth-02.1 20:03 (direct), logcap-01 22:46 (direct), toolkit-02 10-18 06:27 (iron axe and shovel from town iron) |
| 10-20 → 10-22: iron3 54 → 71 %, trip 76 → 89 %; gather_iron_ore_3 17.3k → 12.9k | cobblekeep-01 10-20 11:23, toolkit-03 10-21 13:37, homefix-02 10-22 00:28, ironpick-01 10-22 06:56 |

**Per-change DiDs cannot apportion it** (`canary_did.py`, `rung_did.py`):
- Each promoted canary's DiD on the four metrics, against 300 placebo draws in the same window, is mostly inside |z| < 2.
- Summed over the 24 promoted canaries and scaled to the fleet, the band is ±29,700 gather/day and ±26,300 mine/day, against
  declines of 1,821 and 2,282. The point estimate for gather has the wrong sign (+18,700).
- On rung shares, a few canaries reach |z| > 3: cobblekeep-01 craft −7.5 pp, z −5.2; homefix-02 lap +16.1 pp, z +3.7;
  protectzone-01 lap −17.8 pp, z −3.4; townindex-01 wood −3.6 pp, z −6.6. Their signs do not line up with the fleet trend.
- **Why they fail.** The mechanism is slow: a bag takes days to reach 64 wood or 3 ingots. A 3-12 h canary window cannot see it.
  The isolated pools are no control either, because every change ran there too.
- Attribution to the class "(a) deliberate bag-keeping and tool-supply changes, 10-10..10-22" is therefore solid. Attribution to
  any single change is not.

**The owner's examples, checked:**
- **No redundant crafts:** 191-374 refusals a day from 10-10, and craft yield up.
- **Longer-lasting iron pickaxes, so fewer crafts:** a trip pickaxe is held by 49 → 83 %; the stone-pickaxe rung 5,196 → 813
  decisions a day; stone_pickaxe craft attempts 2,645 (10-09) → 330 (10-22).
- **Cobble cap and cobble-in-bags:** the stone rung 10,994 → 1,768 decisions a day; cobblestone gained 38,095 → 24,798 a day.
- **Deposits that succeed instead of retrying:** chest-full failures 411 → 5 a day.
- **Bag hygiene:** the 64-stack floors are what satisfy the rungs.

## 5. Depletion, measured directly

**What the bot can see at decision time** (sample: 79,386 decisions BASE, 79,749 END):

| share of decisions | fleet | original (6) | isolated (4) | reseeded 09-19 (2) | reseeded 09-27 (4) |
|---|---|---|---|---|---|
| a log within 16 m | 79.7 → 70.3 | 75.3 → 69.4 | 85.2 → 76.1 | 77.2 → 77.2 | **82.4 → 62.3** |
| a log within 32 m | 96.0 → 94.2 | 94.0 → 93.6 | 97.5 → 95.3 | 95.0 → 95.1 | 98.2 → 93.5 |
| iron ore within 32 m | 97.7 → 93.5 | 97.3 → 93.3 | 96.7 → 94.4 | 98.7 → 92.2 | 99.0 → 93.5 |
| sand within 32 m | 87.7 → 92.0 | 86.0 → 90.7 | 89.1 → 91.9 | 88.6 → 95.2 | 88.4 → 92.5 |
| more than 100 from home | 33.5 → 21.8 | 33.0 → 23.2 | 34.5 → 17.4 | 37.4 → 16.2 | 31.0 → 26.7 |
| more than 8 below home | 52.1 → 65.4 | 55.5 → 72.5 | 55.5 → 73.2 | 54.7 → 44.5 | 42.0 → 56.0 |

- **Per world, a log within 16 m:**
  - fell in 12 worlds, most in placebo-d 72 → 46, hive-a 83 → 59, hive-c 89 → 62, hive-d 88 → 60 and isolated-b 84 → 68;
  - rose in 4: board-d, whose bots sat in the pit, board-b, placebo-a and placebo-c.
- **Bots are not walking farther for anything.** For every class, the median and upper quantiles of successful-gather distance
  from home fell or held (median across world-days):
  - logs: median 82 → 74, p90 193 → 158;
  - all classes: median 57 → 42, p75 102 → 76, p90 172 → 116.
  - The share of decisions made more than 100 blocks out fell. The frontier census (expansion plan §1.1) reports the same: no
    outward drift.
- **Outcome shares by class (attempts):**
  - Log attempts are 52.8 % → 20.6 % successful. No-safe-target rose 8.6 → 35.6 % (logs beside water or under falling blocks)
    and no_path 15.6 → 27.6 %; nothing-found FELL 5.2 → 1.7 %.
  - Ore success rose 9.7 → 18.1 %.
  - Sand is level at 5.9 → 5.6 %.
- **Travel.** Explore plus LLM goto hours per 100 production successes went 0.61 → 1.08. That is the patrol and return lap
  (patrol explore successes 4,547 → 8,979 a day), not search: the explore successes made under the production rungs fell.
- **Log depletion, bounded** (`final_checks.py`). Of the sampled LLM "gather <log>" decisions, 20.1 % succeeded at BASE
  (n = 9,130) and 6.5 % at END (n = 3,059).
  - Splitting by "a log was visible within 16 m": visible decisions went 23.2 % → 8.8 % successful, not-visible 6.0 % → 2.0 %, and
    the visible share went 81.6 % → 66.7 %.
  - The fall in visibility, the depletion of trees where the bots stand, explains −2.6 pp of the −13.5 pp. The other −11.0 pp is
    success given visibility.
  - That −11.0 pp is selection (the bots still on the wood rung are the ones that could not finish it: deep, or among trees
    beside water) and depletion of the EASY trees (no-safe-target rose). The two cannot be separated with this data.
  - So the depletion share of Y1 is between 19 % (≈ −300 gather/day) and 100 % (−1,545).
- **Verdict on depletion.**
  - Trees near where bots stand are thinning, about −9 pp of decisions in sight fleet-wide and −20 pp in the 12-day worlds, and the
    easy trees go first.
  - Iron within 32 m is −4 pp, which costs about −190 mine successes a day (8 % of that decline) through the iron rung's gate.
    Stone, dirt and sand show no sign.
  - It costs between 2 % and 11 % of BASE gather successes. It barely matters for wood today, because wood demand fell 75-90 %.

## 6. Safety and reflex time (ranked by bot-time, `report_tables.py` §4)

| h/day | BASE | END |
|---|---:|---:|
| water float held | 35.3 | 87.6 (board-d 66.6) |
| water, no air route | 25.5 | 23.8 |
| water, surfacing | 32.3 | 16.1 |
| goto by livelock_escape | 14.9 | 12.6 |
| goto by watchdog_relocate | 8.9 | 11.9 |
| explore after an entombment interrupt | 6.0 | 10.6 |
| goto after a stuck interrupt | 5.3 | 8.4 |
| goto after an entombment interrupt | 6.5 | 8.1 |
| surface and home, all reflex or interrupt triggers | 9.3 | 12.4 |
| everything else: explore after stuck or stagnation, livelock dig, goto after stagnation or timeout, rows under 0.3 h | 9.6 | 9.2 |
| **total** | **153.6 (8.0 %)** | **200.7 (10.5 %)** |
| **total without board-d** | **147.0 of 1,800 (8.2 %)** | **132.0 (7.3 %)** |

- **The whole rise is board-d's pit.** Elsewhere, safety time fell.
- **Event counts move, but rank low by time:**
  - `_watchdog_rescue` 0 → 6,329 a day (new logging);
  - `_protect_zone` 0 → 2,935;
  - `_stranded_escape_try` 933 → 4,278;
  - `_marooned` 5,785 → 7,654.
- **Water holds overlap skill time** (a bot swims while it gathers or explores). They measure exposure, not lost time, and
  "swimming is travel". The totals above are therefore a sum of exposures, not exclusive bot-time.
- **Deaths:** 46 → 40 a day (0.024 → 0.021/bot-h).

## 7. Other: the decision engine, the GPU move, restarts

| | BASE | END |
|---|---|---|
| decisions/bot-h | 83.6 | 83.3 |
| latency p50 | 1.69 s | 1.79 s |
| latency p90 | 3.44 s | 3.33 s |
| LLM share of bot-time | 4.4 % | 4.5 % |
| endpoints | .72 ≈ 71 %, .16 ≈ 22 %, no endpoint ≈ 7 % | .16 at 23 % (10-20), 14 % (10-21), 0 % (10-22; and 10-23 after drop16) |

- **The GPU move did not slow decisions.** p50 rose by 0.1 s while p99 fell from about 7 s to 4.2 s on 10-22. Decisions per bot-hour
  did not change.
- **Restarts fell:** `startup`-triggered decisions 537-615 a day → 379-516, and `liveness_restart` 2.5-2.8k → 1.8-2.0k.
- **Deploy churn doubled and did not show.** The journal has 18 deploy, promote or teardown events in END (6 of them fleet-wide
  promotions) against 8 in BASE (3 promotions), yet startup-triggered decisions fell, and every world still logged 120.0 bot-h a day.
- **(d) has no measurable negative.** The 0.4 % fewer decisions are already inside the demand rows.

## 8. Per world, and the natural experiments

**Gather ok per bot-h, BASE → END:**
- board-a 7.12 → 5.98; board-b 5.99 → 6.50; board-c 7.00 → 6.65; **board-d 7.66 → 2.31**
- hive-a 8.85 → 6.33; hive-b 14.38 → 17.55; hive-c 9.31 → 5.81; hive-d 7.20 → 5.71
- isolated-a 6.87 → 6.39; isolated-b 6.80 → 5.62; isolated-c 4.42 → 4.37; isolated-d 6.32 → 5.11
- placebo-a 5.74 → 6.83; placebo-b 6.14 → 3.23; placebo-c 3.13 → 4.65; placebo-d 6.66 → 5.42

**Logs gathered ok per bot-h fell in every world** (from 0.62-4.12 to 0.07-0.44). **Ore items per bot-h rose in 14 of 16** (board-b and board-d fell). Each
world's share of the fleet change is in `measure.txt` §1b (gather: board-d −643, hive-c −421, placebo-b −349 ... hive-b +380).

- **Not every world declines on gather.**
  - Four worlds rose: placebo-c +48 %, hive-b +22 %, placebo-a +19 % and board-b +8 %. All four did it on more dirt (dirt ok
    per bot-h roughly doubled in each).
  - On mine, 15 of 16 fell; placebo-c is the exception (+119 %, from the fleet's lowest base).
  - placebo-b is the second-worst world (gather −47 %, mine −53 %). It is not a trap on the board-d scale: its float holds were at most
    7.0 h/day.
- **World age** (ticks on 10-09: original ≈ 45-47 d, reseeded 09-19 ≈ 20 d, reseeded 09-27 ≈ 11.5 d):

  | group | gather | mine | craft |
  |---|---:|---:|---:|
  | original | −10 % | −19 % | −29 % |
  | isolated (original age) | −12 % | −25 % | −36 % |
  | reseeded 09-19 | −15 % | −46 % | −46 % |
  | reseeded 09-27 | −20 % | −33 % | −31 % |

  - Younger worlds decline somewhat more, as "fresh worlds buy one week" predicts for worlds still settling. With board-d
    excluded, young vs original is −16.2 % vs −2.7 % (p = 0.32), and on mine −35.4 % vs −8.2 % (p = 0.20). Neither is
    significant; this is a two-sided permutation test, 20,000 relabelings.
  - Every group falls, and the drop in production-rung share is synchronous: 44/37/37/46 % on 10-08 → 16/15/9/13 % on 10-22, stepping
    10-12, 10-14 and 10-18 in all four. **Depletion does not drive the common decline.**
- **The isolated pools** (original seed and age; private per-bot memory until 10-21, isolated-b, and 10-23 15:26Z, a, c and d) fell
  like the shared original worlds. They are not an untreated control: every promoted change ran on them. What they contrast is
  memory and town sharing, and that does not change the picture.
  - isolated-b's conversion at 10-21 13:53Z sits inside END. It moved with its siblings (gather −17 % vs −1 % to −19 %, mine
    −24 % vs −1 % to −40 %).
  - n = 1 over two days: **INCONCLUSIVE** on any conversion effect.
- **Board-d** is the natural experiment for (c). 3 bots in one pit cost its world 70 % of gather; poolescape-01 (KEPT 10-23) ended
  it, and float holds fell 66.6 → 6.5 h on 10-23.

## 9. When should we start a fresh world?

### 9.1 What depletion costs, measured

- **Logs in sight are thinning,** −9 pp fleet-wide, −20 pp in the 12-day worlds, with easy trees first. It costs between 2 % and
  11 % of BASE gather successes.
- **Iron in reach is −4 pp,** and iron intake per day is up 56 %.
- **No sign in stone, sand or dirt.**
- **Bots work closer to home and deeper,** not farther out.
- **Old worlds are not worse than young ones.** The original worlds produced 7.24 gather ok/bot-h at END against 5.86 in the
  12-day worlds. After two to three weeks, a world's output at today's demand looks like a steady state. It is set by the ladder,
  not by the world's age.

### 9.2 What a reset costs

- **What a reseed buys.** The 09-19 reseed (memory fresh-worlds-buy-one-week) took log-gather from 4.9 % to 57.6 % and
  items/bot-h from 18 to 63, on identical code. The fresh pools fell back 63.4 → 20.8 in six days. A reseed buys about a week of
  easy wood. Today's ladder asks for about a tenth of the wood it asked for on 10-09, so that week is worth little.
- **What it destroys:**
  - the town: chests and their stock, including the town iron that is already short;
  - the plinth and junk wells, the town index, the treefarm sites and the world-facts death sites;
  - the town plan's build;
  - every structure the owner's goal names ("build cool structures, survive, and work together for long periods").
- **What it costs in bot state:** a reseed empties the bots unless playerdata is carried over, and carrying it risks stale spawns
  inside new terrain (reseed memo 09-27).
- **What it costs the instruments:** the frontier census leaves out a town that was reseeded inside its 14-day window.

### 9.3 What mixed ages cost the measurements

- **Pools of different ages are fine for DiD as they stand.** DiD absorbs level differences. The trend difference between young
  and original worlds is about −1 pp a day, and not significant. Over a 6-12 h canary window that is about 0.5 pp, far inside the
  placebo noise band (§4).
- **A freshly reseeded pool is not fine.** For about two weeks it breaks parallel trends: +13 items/bot-h DiD in two days, then
  −67 % in six days, against flat controls. A canary drawn onto it, or a control containing it, inherits that slope.
  - **Cost of one reseed:** exclude that pool, as canary and as control, for 14 days. That is 5 of 80 bots out of the draws.
  - A scheduled rotation would keep about one pool in that state permanently and widen every gate's interval. That is the same
    mechanism that flipped junkwell-01's death gate in the multi-lane replay of 10-08.

### 9.4 Recommended policy

1. **Never reseed the fleet, and no scheduled rotation.** Expand instead:
   - expeditions to 1,200 blocks (approved, designed after the 10-24 frontier census);
   - then outposts. The census already ranks fresh regions 300-800 blocks out.
2. **Fix demand before land.** Production follows what the ladder asks for. Owner decisions, not part of this read:
   - The town plan and building tier are what give wood, cobble and iron a real use.
   - The iron rung should not count idle carried ingots.
   - Dirt-gathering's share of time, and its iron-shovel wear, deserve a look.
3. **Reseed one world, and only as a pre-registered experiment,** when ALL of the following hold for 7 consecutive days in that
   world. Each is read by `sample_state.py`.
   - **Trigger:**
     - a log within 16 m in < 50 % of decisions (today: worst placebo-d 46 %, fleet 70 %);
     - iron ore within 32 m in < 85 % (today: 93 %);
     - the frontier census shows no reachable fresh region (no ranked candidate, or expedition turn-backs mark them
       `unreached`).
   - **Design:**
     - DiD against the same-age worlds;
     - the pool stays out of canary draws for 14 days;
     - the town is rebuilt by the plan's own code, not by world edits.
   - placebo-d already meets the log condition on its END days (46 %) but not the iron one (≈ 93 %), and has fresh land within
     the census.
4. **Record world age as a stratum in the canary draw record.** It is cheap, and it lets a later read test age interactions
   without new logging.

## 10. Limits

- **Attribution inside (a) is by timing and mechanism, not per-change measurement** (§4). A share of the bag build-up could be
  organic accumulation that would have happened anyway, on code that stopped consuming. Every change reached every world, so no
  data in this window separates the two. The class "(a) deliberate" includes it.
- **The LLM sample is 1/6 of hours,** fixed at 00, 06, 12 and 18Z. Day/night is per world, and world clocks differ, so the hours
  do not align with game time.
- **Y2 is an unattributed offset.** It is positive, chiefly dirt success per decision, and it is not explained here.
- **"Log within 16 m" is the nearest-of-kind distance the bot perceives.** It measures availability where the bot stands, which
  also moves with where the bot works (deeper, closer to home). It is not a census of the world's trees.
- **ES completeness after 10-14 18:46Z is assumed, not reconciled** (estelemetry caveat). The per-day decision counts are flat,
  83-86 per bot-hour.

## 11. Reviews

(Filled in after the review rounds; see the end of this file.)

## Files

All under `docs/reports/production-breakdown-2026-10-23/`. Run on 10.0.0.31 as `cd ~/prodbreak-1023 && nice -n 19 python3 <x>`.

| file | what it does | reads | writes |
|---|---|---|---|
| `pull_rows.py` | compact skill rows | ES | `out/rows/` |
| `daily_skill_aggs.py` | daily server aggregations | ES | |
| `llm_daily.py` | latency, endpoints, triggers | ES | |
| `milestones_daily.py`, `milestone_yield.py`, `rung_hourly.py` | the LLM ladder | ES | |
| `llm_sample.py` | the 4 h/day state sample | ES | |
| `analyze.py` | per world-day measures | rows | |
| `table_daily.py` | owner table reproduction | | |
| `mix_shift.py`, `decompose.py` | demand/yield split | | |
| `rung_series.py`, `rung_did.py`, `canary_did.py` | timing and DiDs | | |
| `sample_state.py`, `sample_checks.py` | bag and sight shares, plus controls | | |
| `report_tables.py`, `side_checks.py`, `items_daily.py`, `final_checks.py` | report tables | | |
| `peek*.py`, `fieldcaps.py`, `explore_mix.py` | field discovery | | |
| `measure.txt` | every printed table | | |
