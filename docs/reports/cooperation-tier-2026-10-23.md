# The cooperation tier: a frontier overseer as job assigner, the town ledger, and the first shared build (design r5, 2026-10-23)

OWNER 2026-10-23 ~12:40Z approved designing the cooperation tier: "build cool structures, survive, and work together for
long periods of time". OWNER ~13:30Z answered C11-C14 (section 7). This is a design. No bot code was written, nothing was
deployed, and no queue, scheduler, manifest, world, bot or host service was touched. No frontier API was called.

It builds on, and does not redo:
- `overseer-assigner-design-2026-10-19.md` (r3: S0 census first, leases that only reorder, the validator, the ITT primary,
  the Paper oracle);
- `comms-design-2026-10-21.md` (r7.1: the typed town ledger, stage 2 chat, Contract Net later; owner C1-C10 yes);
- `jobs-mayor-spec-2026-09-29.md` and `shadow-mayor-plan-2026-10-03.md` (temporary duties, never fixed roles);
- the shadow-mayor STOP (10-06): the deterministic assigner tied leased-random on all four duties;
- `town-plan-2026-10-20.md` (ring@1, the siting file, townindex, the workshop plot);
- `ziggurat-mineshaft-2026-10-15.md` 3.3 (monument-01's slot and segment leases: the multi-builder protocol on paper).

**Parallel designs this one meets only through interfaces (section 5):** the building tier (`building-tier-1023`: the
workshop blueprint, `make_material`, the claim set and the structure count) and mineshaft safety (`mineshaft-safety-1023`:
the `deep_miner` job). **r5 is reconciled with building-tier r2 (27980d4e) and mineshaft-safety r4 (89aa22e9)**, read on
origin; 3.3, 5.1-5.4 say what each design owns, and the two points this one asks of the building tier are named in 5.2.

**Sources (all read-only):**
- **Rows:** a fixed 24 h window, **10-22 12:14Z to 10-23 12:14Z**, ending at indexsearch-01's deploy (12:14:44Z), so no
  indexsearch canary row is in it. 13 shared towns (12 board/hive/placebo + isolated-b), 65 bots, 1,560 bot-h, 1,279,223
  rows, read with `scripts/lib/telemetry.Events` on 10.0.0.31 (full walk of the window, `nice -n 19`).
  - **Positive control, files v Elasticsearch** (`estelemetry.EsEvents`, same window and pools): 1,279,199 ES docs (24
    fewer: the 23:59Z rotation race). Per kind: smelt_town 1,646 = 1,646, furnace_drain 2,237 = 2,237, toolkit 514 = 514,
    deposit 400 = 400, town_deposit 153 = 153, explore 17,070 = 17,070, `_explore_toward_known` 17,112 v 17,113, gather
    23,566 = 23,566 (r2 sweep). `data/es_crosscheck.txt`.
  - **Builds in the window** (`data/extract.json`): 1f5b4b4e (protectzone-01 promoted 16:54Z 10-22), c0fec812 (townindex-01,
    promoted 01:17Z), 6e1afb52 (poolescape-01, promoted 08:05Z), plus canary and restart-lag rows of f39471bb (keepout-01)
    and 2719ee0e (ironpick-01). poolescape-01's canary ran on board-d, placebo-a and hive-b 01:48-08:05Z; drop16's restarts
    08:07-08:23Z. **Every count is descriptive, not an arm comparison.**
- **Town index journals** (`town-index-<home>.g1.jsonl`, all 13 towns): from each town's first record (01:09-01:36Z; 19:00Z
  10-22 in the three townindex canary towns) to 12:14Z. 158 town-hours.
- **S0, the staffing census** (`staffcensus.py`, installed and ticking since 10-19; 0 of 13 rows void at every recent tick):
  its `--report 72` run on a **copy** of its output, so the live census was not written to. `data/s0_report72.txt`.
- **Scripts and outputs:** `docs/reports/cooperation-2026-10-23/tools/*.py.txt`, `data/`. r1's scripts are kept;
  `r2fix.py.txt` and `r2b.py.txt` (round 1), `r3fix.py.txt` and `r3b.py.txt` (round 2), and `r4fix.py.txt` and
  `r4b.py.txt` (round 3, on `extract2`, which keeps empty bags; there were none in the window), and `r5fix.py.txt`
  (round 4) supersede them where a review found a fault (named in place).
- **Open loop at the time.** `canary-sched.py status` at 14:20Z: "S6 open loop: canary d4a0f42 is deployed on
  board-a,placebo-a with no KEEP/REVERT/INCONCLUSIVE recorded". The owner directed this parallel design work on 10-23 and
  the host loop reads indexsearch-01 on its own schedule. This work read no canary row, ran no read and touched nothing of
  the canary.

---

## 0. Answers first

**1. Cooperation today is real but thin, and it happens through shared state, not through meeting (section 1).**
- **The town chests are a shared pool.** In 158 town-hours, 398 of the 399 changes between consecutive observations of a
  container are attributable to exactly one bot. Of 629 attributed units withdrawn, **between 78 and 161 (12.4-25.6%)
  came from another bot's deposit into that same container** (per-container bounds, r3); most of the rest is stock older
  than the index. The flow is small: 1,191 units in and 629 out, about 4 out per town-hour, 75% of it metal.
- **Duplicated effort is small.** Leased town jobs start inside a townmate's run of the same job at or below chance
  (deposit 0.25% v about 0.54%; the drain on the same furnace 0.2%). smelt_town is above (6.5% v about 1.95%): copper
  arrives for everyone at once. The largest repeat is a furnace found empty again by a townmate (870 of 1,435 empty
  drains, 2.51 bot-h a day). Explore **co-targets** shared sightings (9,210 of 16,958 explore runs headed for one a townmate
  headed for in the 30 min before; every heading names iron_ore), but explore toward a sighting rarely ends with iron
  gained near it, shared or not: **10 of 16,958 runs** by any route (r4: 336 distinct raw_iron rise events, each assigned
  to at most one explore, the explore "near" if any assigned rise's snapshot is within 24 blocks of the sighting).
  Co-targeting is not a cooperation lever here.
- **The census cannot find idle labour.** 28.4% of bot-time is inside a skill row. S0 counts 612 of 977 at-town bot-h
  (63%) as free, but the out-of-skill time is mostly short gaps around reflex, trap and path activity (1.3).
- **Bots are rarely together for long, and rarely at town.** Inside the radius where town jobs run (16 horizontal, 12
  vertical), a bot is present **9.3%** of the time, for a median of 1 minute. Two or more bots are there together about
  **110 minutes per town-day**, three or more about **16**, and the longest unbroken stretch with three was 1-4 minutes (r3).
  In the wider 48-block circle the figures are 20.3%, about 394 and about 102 minutes. A bot is more than 12 blocks below
  home's level 48.6% of the time. An away, unflagged bot enters the town-job radius within 30 minutes **42.8%** of the time.

**2. What is different from the shadow mayor (3.1).** The mayor's rule tied random, even on GET_WOOD, the one duty with
selection content; and its score was prediction (did the bot do it anyway), with no actuator. The cooperation tier
assigns **a task graph with joint work** (the workshop's segments and materials, the town's deep-miner slots), gives the
overseer the utilities the prior art says it needs (positions, bags, shortfalls, yesterday's jobs), uses the r3 lease that
only reorders, and decides on an **effect** measured from the world. Greedy and random choices are computed on the same
snapshots and **compared for divergence**; they are **scored** only in the Paper arms, where all of them run.

**3. The job assigner (section 3).** Three layers:
- **the bot** keeps every eligibility rule, admission and remedy chain, and re-checks each lease when it acts on it;
- **a host-side validator and lease writer** (deterministic, every 5 minutes, r3's fencing) issues only leases that pass
  the host-computable part of the job's own exported eligibility, and binds each lease to its world, project, record
  generation and segment;
- **the overseer** (Claude or GPT, owner C11) picks who does which open job, once per town per 30 minutes, from a snapshot
  of about 1.0-1.3k tokens.
- **Jobs:** BUILD(segment), SUPPLY(item: moves parts and raw items, never makes them), DEEP_MINER, SMELT, BANK, FREE. Soft preference (C13): a bot's recent successes at
  a job are a tie-break, never a role.
- **BUILD and SUPPLY are next-visit leases:** issued to a bot wherever it is (if safe), acted on only inside its town-job
  chain when it next reaches town. A lease never causes travel.
- **No dead ends:** a lease is never a precondition. No bot waits for one; a refused, ineligible or expired lease returns
  the bot to exactly today's decision path in the same decision.

**4. Spend (C12, section 3.8).** Claude Sonnet 5.5 at low effort: about $0.017 a call (2.5k tokens in, about 1.2k out with
thinking), list prices re-checked 10-23. **Calls are hard-capped at 48 per town-day** (an event pulls the next call forward,
it never adds one), plus re-asks hard-capped at 5 per town-day. Shadow in real time in 3 towns: about $2.70/day ($81/month). Live in 4 towns: about
$3.59/day ($108/month). **Fleet-wide live (13 towns) would be about $350/month on Sonnet 5.5 and $175 on Haiku 4.5: neither
fits the cap.** The guard reserves each call's worst case before it is sent, keeps the reservation until billed usage
arrives, and stops the overseer (empty generations, every lease lapses within 5 minutes) at the cap. **The bots carry on.**

**5. The ledger, stage 1 (section 4).** townindex-01 shipped as the stock store **without** the ledger (no ledger code or
file is on the fleet). ledger-01 is now a small journal beside it with only what has a consumer now: `station` (for
furnaceseen-01: the 870 repeat empty drains). The `progress`, `claim` and `lease` mirrors are deferred to stage 2,
since no decision reads them (placements, leases and lease outcomes are read from their own rows and files). The derived quantities (`to_site`, `short_town`) are computed by readers from
the index and the project record, never stored. Reachability is never shared.

**6. The first shared project (C14, section 5): 2 bots build their town's workshop together, by segment.**
- Partition by **region** (segments of the open layer, monument-01's protocol), not by material: MineCollab's agents undid
  each other's work when split by material.
- **Start at 2 builders.** The prior art does not establish an optimum (VillagerAgent's construction task completed at 1,
  2 and 4 agents, slower at 8), so 2 is a conservative starting choice. The build is asynchronous, so co-presence is not
  the reason; the reasons are that each extra builder is another concurrent lease on a small structure (fence and
  contention risk), and a small workshop's open layer has few segments. A third is a one-number change.
- **The workshop is the building tier's workshop@1 in the outer domain** (22-44 blocks out); material flows through a
  reserved site chest inside town, which every other picker skips, under the building tier's single claim set and reserve.
- Cooperation is measured as **multi-builder project-days** and **units that non-builders delivered to the site chest and
  builders then drew**, from witnessed placements and the site chest's index records.

**7. Measurement (section 6).** Effects come from the world: server-witnessed placements, RCON re-reads at the end, index
observations and bag deltas. Intent rows never count. The live canary's registration carries an **effect line** that fails
to INCONCLUSIVE (verdict.py v25: a `REVERT` own line without `evidence` lands in `blocked`, never reverts and never falls
through to KEEP), so KEEP cannot mean "nothing objected".

**8. Build order (6.3):** B0 S0's capability fix -> B1 coopread -> B2 ledger-01 -> B3 furnaceseen-01 -> B4 shop-01 (the
building tier's canary, 2 builders, with this design's reserved site chest and SUPPLY inside it) -> B5 lease reader + Paper
arms -> B6 overseer shadow (3 towns, real time) -> B7 assign-01 live in 4 towns -> B8 DEEP_MINER through the assigner.

**Where the evidence argues against an owner answer (section 7):**
- **C11:** "compare the shadow's decisions with what the bots actually did" measures **prediction**, the instrument that
  could not show the mayor a benefit. It is kept as a sanity report, but going live rests on the Paper arms, and the
  decision on the live effect line.
- **C14:** start at 2 builders, not 3; "together" will mostly mean the same structure on the same day, in turns (three
  bots share the town-job radius about 16 minutes per town-day).

---

## 1. What cooperation looks like today, measured

Every count gives its denominator. Every zero sits beside a positive control from the same pass.

### 1.1 Shared chests: who feeds whom (`tools/indexflow.py.txt`; per-container provenance in `tools/r2fix.py.txt` [P])

**Method.** A container's contents are known only from **server windows** (`obs` records at each open). A mutation writes
a `dirty` mark before the bot's first click and after its last, with one `op` id. An op's effect is the difference
between the last observation before its first mark and the first observation after its last, attributed to that bot when
no other op on that container falls between them.

**Positive controls and integrity.**
- **Attribution path:** all 88 verified town_deposit transfers (`xfer ok=1`) are bracketed by exactly their own `pre` and
  `ver` observations, with the transfer's bot as the attributed bot (`data/r2b.out` [V]), and the difference holds the item
  (`data/indexflow.out`). **Through r3's chain predicate** (r4, `data/r4fix.out` [V4]): for all 88, the chain pair starting at
  `pre` ends at `ver` and is attributed, under the ambiguity rule, to the transfer's bot.
- **The observation chain (r3, `data/r3fix.out` [P3]):** of 399 consecutive observation pairs of a container that differ,
  398 have exactly one bot's op between them, 0 have ops of two bots, and **1** has none. That one is kept as **unknown**:
  it removed 121 units (unknown additions elsewhere: 14). Nothing is dropped from the accounting.
- **With the shipped op lifecycle (r5, `data/r5fix.out`):** an op without a `post` mark stays open until 10 min past its
  latest `pre` or `held` mark (townindex's `OP_TTL_MS`), and a chain pair overlapping an unfinished op is unknown. In this
  window **0 of 412 ops were unfinished and 0 had `held` marks**, so every figure above is unchanged (398 attributed, 1
  unknown, 78-161, and 88 of 88 transfers through the predicate). coopread (B1) carries fixtures for an unfinished op, a
  held op and two overlapping ops, each of which must read unknown.
- r1's op-bracket count: 412 ops = 398 attributed + 14 unresolved (no later open in the window) + 0 ambiguous.

| | units deposited | units withdrawn |
|---|---:|---:|
| metal (iron, copper, gold) | 575 | 474 |
| wood | 417 | 103 |
| fuel | 73 | 48 |
| stone | 64 | 0 |
| tools | 6 | 4 |
| other | 56 | 0 |
| **all, 158 town-h** | **1,191** | **629** |

**Provenance, per container (r2 stopped r1's pooling across containers; r3 keeps unknown changes as unknown).**
- **Bounds** on units withdrawn by bot B from container K that came from **another** bot's deposit into K, over the
  observation chain:
  - lower: the most B withdrew from K at any point, beyond K's stock at its first index open, plus unknown additions, plus
    B's own deposits into K so far;
  - upper: what B withdrew, capped by other bots' deposits plus unknown additions into K before B's last withdrawal.
  - Summed: **78 to 161 of 629 attributed withdrawn units (12.4-25.6%).** The 121 units of unknown removal are no one's.
- r1-r3 also printed two allocation scenarios. They are **withdrawn** (r4, Codex r3): they did not consume unknown removals,
  so they could break conservation. Only the bounds are claimed.
- **Pooled at town level** (descriptive): 46 town-by-item pairs were withdrawn, and in 39 a different bot deposited that
  item somewhere in town in the window (metal 23, fuel 11, tools 3, wood 2). Every town has 2-5 depositing and 3-5
  withdrawing bots.
- **Reading:** the containers already pass material between bots without anyone meeting. That is why stage 3's
  REQUEST/OFFER stays deferred (comms C9), and why the project's supply goes through a site chest (5.3).

### 1.2 Duplicated effort (`tools/r2fix.py.txt` [O] [X], chance null `tools/r2b.py.txt` [N])

r1's overlap used fixed neighbour windows; r2 uses a complete interval sweep for run incidence, and r3 reports overlapped
**bot-time** as the union, per run, of its overlaps with townmates (r2 reported pair-time). The chance column is an
approximation: it sums townmates' busy time in the job without taking its union.

| job | runs | starts inside a townmate's run of the same job | expected by chance (approx.) | overlapped bot-time (r3) | no_effect+failed: overlapping v solo |
|---|---:|---:|---:|---:|---|
| smelt_town | 1,646 | 107 (6.5%) | 1.95% | 0.47 of 7.31 bot-h (6.4%) | 93% v 87% |
| furnace_drain (same furnace) | 2,237 | 5 (0.2%) | 2.13% (any furnace) | 0.00 of 7.17 | — |
| toolkit | 514 | 2 (0.4%) | 0.42% | 0.01 of 1.33 | — |
| deposit | 400 | 1 (0.25%) | 0.54% | 0.00 of 1.31 | — |
| town_deposit | 153 | 1 (0.7%) | 0.02% | 0.00 of 0.08 | — |
| withdraw_pick / compost / dispose_well | 78 / 76 / 159 | 0 / 0 / 0 | 0.28% / 0.04% / 0.15% | 0 | — |

- The positive control is the same sweep finding the smelt_town overlaps.
- **Reading:** overlaps are rare. deposit and toolkit sit at or below the approximate chance rate; town_deposit's single
  overlap is above its tiny expectation (about 0.03 events); the drain's 0.2% is per furnace while its chance figure is for
  any furnace, so the two are not comparable. None of this shows the leases cause it. smelt_town overlaps above chance
  because the same copper arrival triggers every bot.

| other duplicate | measured | control / denominator | reading |
|---|---|---|---|
| **furnace found empty again by a townmate** (60 min, no non-drain session whose recorded [t0, t1] overlaps the gap; r3) | **870 of 1,435** "is empty" drains (60.6%); after the same bot 38; invalidated by a session 36 | 678 non-drain sessions with t0/t1 parsed; comms 10-21: 391 of 922 | **2.51 bot-h a day**, the summed duration of those 870 repeat drains: **furnaceseen-01's target** |
| smelt_town with nothing to smelt | 1,399 of 1,646 "no raw copper" (85.0%), 4.6 bot-h | 115 successes; "no coal" 10 | a job that ran out: the owner's C13 example |
| gathers of the same block by a townmate at the same time (end positions within 16 / dy 8) | 293 of 23,566 starts (1.2%); overlapped bot-time (r4, union per run) **3.44 of 171.0 gather bot-h** | — | not a problem |
| mine runs with a townmate mining within 16 at the same time | 1 of 6,494 | — | none |
| the same item crafted by two townmates within 10 min | 14 of 340 successful crafts (stone_pickaxe 10, furnace 4) | — | small |
| **explore co-targeting** (a heading at a sighting a townmate headed for in the 30 min before) | 9,210 of 16,958 explore runs with a heading (68.8 of 121.4 explore bot-h); censored at the window end 112 | — | **co-targeting, not duplicated effort:** explore re-aims every leg, and a claim would only send the bot elsewhere |
| explore -> iron gained (every heading names iron_ore). **Any route** (r4, `tools/r4fix.py.txt` [X4]): each positive raw_iron change between consecutive snapshots of a bot is one rise event; each rise is assigned to at most one explore (the latest of that bot ending within 600 s before it); an explore is "near" if any assigned rise's snapshot is within 24 / dy 16 of the sighting. **Gather only** (r3fix [X3]): near by the gather's end position | **any route: fresh 7 of 7,748 (0.09%) near, 50 only elsewhere; co-targeted 3 of 9,210 (0.03%) near, 30 only elsewhere.** Gather only: 8 v 3 near | 336 distinct rise events (428 units) in the window, 123 of them assigned to an explore | explore toward a sighting rarely ends with iron gained near it, co-targeted or not. This does not establish why; it leaves no cooperation lever worth building here. Sighting quality is a question for the expansion lane (X1) |

### 1.3 Idle time (`tools/coop.py.txt`, `tools/gaps.py.txt`, S0)

| bot-time, 1,560 bot-h | bot-h | share |
|---|---:|---:|
| inside any skill row | 443 | 28.4% |
| of it: gather 171.0, explore 122.3, goto 96.5, surface 15.4, mine 9.5 | | |
| of it: all town jobs (smelt_town, drain, toolkit, deposits, withdraws, compost, well) | 18.4 | 1.18% |
| **outside any skill row** | **1,117** | **71.6%** |
| of it, gaps containing a trap, escape, watchdog or stagnation row (first matching class) | 521 | 33.4% |
| of it, gaps containing path-failure rows | 195 | 12.5% |
| of it, gaps containing town or order rows | 173 | 11.1% |
| of it, gaps with other event rows | 216 | 13.9% |
| model latency (the decision stream: 118,283 model calls) | 66 | 4.2% |

- Gap classes are **upper bounds**: a 2-minute gap with one watchdog row counts as trap time. They say what was going on
  around the gap, not what the time was used for.
- By length the gaps are short: 10-60 s 444 bot-h, 1-5 min 532 bot-h, 5-30 min 110 bot-h, 30 min or more 27 bot-h.
- **S0 at town, 72 h:** 976.9 at-town bot-h = 612.0 free (63%) + 24.6 in a town job + 340.3 **flagged** (trap 335.3,
  drowning 2.5, death 1.8, low health 0.7). Away from town it is worse: 46,193 of 83,115 away bot-minutes (56%) had a trap
  or drowning row in the 5 minutes before (`data/r2b.out` [A]).
- **Reading:** the census cannot locate a pool of idle bots. A job assigner reorders what bots do next when they are
  already at town; r3's rule stands (a lease changes order, not capacity).

### 1.4 Travel and being together (`tools/coop.py.txt`, `tools/r2fix.py.txt` [C], `tools/r2b.py.txt` [A], S0)

- **Where bots are** (newest positioned event row per bot-minute; 93,557 of 93,600 minutes covered): at town (48 h / 12 v)
  **20.3%**; more than 12 blocks below home's level **48.6%**; distance from home median 55, p75 92, p90 141, p99 246.
- **Movement:** goto + explore 218.8 bot-h (14.0%); minute-to-minute horizontal displacement at least 949 blocks per bot-h.
- **Edge-crossings:** a bot crosses into the 48-block town circle a median 105 times a day and stays a median 2 minutes.
  That is mostly passing the edge.
- **Arrivals** (r2, the town-job radius 16 h / 12 v, at least 2 consecutive minutes inside): from an away, unflagged
  bot-minute, the bot arrives within 15 minutes **27.2%** and within 30 minutes **42.8%** of the time (36,922 bot-minutes).
- **At the town-job radius** (r3, 16 h / 12 v, where the town jobs and the site chest are; workshop@1 itself is in the
  outer domain at 22-44): occupancy
  **9.3%** of bot-minutes; stays 5,423, median 1 minute, p75 2, p90 3; two or more together **1,425 town-minutes (about 110
  per town-day)**, three or more **209 (about 16)**; longest stretch with three 1-4 minutes per town (`data/r3fix.out` [R3]).
  These are the distributions the Paper scene reproduces (6.2).
- **In the 48-block circle** (r2; r1 quoted the longest stretch as if it were the total):

| | town-minutes, 13 towns, 24 h | per town-day | longest unbroken stretch per town |
|---|---:|---:|---|
| 2 or more bots at town | 5,121 | about 394 min | 8-29 min |
| 3 or more bots at town | 1,323 | about 102 min | 3-9 min |

- A townmate within 16 blocks (dy 8): 9.2% of bot-minutes.
- **Recall:** `home` succeeded 343 of 1,165 times (29%); under the validator's filter 84 of 177 (47%). RECALL's r3 gate is
  70%, so it stays out of v1.
- **Reading:** "work together" here means **contributing to one structure through its record and its site chest**, in
  the short spells each bot is at town (stigmergy, as TERMES did). Leases must survive a bot being away (3.5).

### 1.5 What has already been taken (descriptive before/after)

| town supply refusal | 10-20 (town plan, 24 h) | this window | changes in between |
|---|---|---|---|
| toolkit "no town container holds N iron ingots" | 428 of 660 (64.8%) | **101 of 514 (19.6%)** | toolkit-03, townindex-01 (indexsearch-01 was not yet live) |
| smelt_town "no coal" | 441 of 1,582 (27.9%) | **10 of 1,646 (0.6%)** | smeltfuel and the banking decisions |
| withdraw_pick "no usable pickaxe" | — | 38 of 78 (48.7%) | (small volume) |

The overseer census (10-19) found its distribution headroom in fuel (C4) and iron (C7). Both refusals have fallen a lot,
which fits deterministic rules having taken most of it, as r3 recommended. That does not show every self-maintenance
allocation is worthless; it shows the measured headroom there is small. The assigner's job here is the joint work.

### 1.6 S0 today: nothing to assign, and one instrument bug
- 72 h, 13 towns, 911 valid town-hours (296 of 11,232 town-slots void: isolated-b's census history starts later).
- **Assignable town-hours: 0.** No multi-bot project is on the fleet.
- **Instrument bug:** treefarm shows as **open** in board-a and hive-c for 71.9 h with 0 builder visits. treefarm-02 was
  REVERTED on 10-19; its record files remain, its code is not in the fleet build. S0 calls a project open from its record
  alone.
- **Fix (B0), r3:** S0 decides **capability** from what the running bots say about themselves, not from activity and not
  from git ancestry (a later revert or a disabled flag keeps the ancestry). Every project module emits a `_<project>_mode`
  row once per spawn, as townindex does (`_townindex_mode`: `phase=mode index=on ...`), naming the module, its flag state
  and its version. **Capability is bound to the running build** (r5, Claude r4: no generic spawn row exists; every row
  carries `code.version`): a bot counts as capable only while its newest rows carry the same `code.version` as a mode row
  saying `on` that was emitted at or after the first row of that version. A rollback to a build that emits no mode row
  changes the version, so it reads not capable, whatever the older build said. A project is capable in a town when its
  bots are. A capable project whose
  record is open but which places nothing is kept as **open and stalled** with zero production, so a starved project stays
  visible. A record without a capable mode row is `record_without_code`: reported, excluded from assignable time. Fixtures:
  capable-but-starved, disabled (mode row `off`), and **`on`, then a restart into a reverted build that emits no mode row**
  (must read not capable).
- **Assignable time, redefined for next-visit leases (r4, Claude r3).** S0 counts a minute assignable at 48 blocks with
  the material in a bag. The workshop adapter (B0) counts it when a project is open with pending demand, a builder slot or
  a short item is free, and **at least one unflagged bot is inside the town-job radius (16 h / 12 v)**, with the material in
  bag surplus or the site chest. Its **upper bound from this window** (`data/r4b.out`; an open project with demand and
  material assumed everywhere, other town jobs ignored) is **90.4 town-hours a day across the 13 towns** (3.1-13.8 per
  town), and 14.7 with two or more unflagged bots there. The B7 gates (6.3) are set from this.

---

## 2. Prior art (searched 10-23; papers, repositories and their issue trackers)

Read through fetch-and-summarise tools, so some figures are second-hand; "approx." marks figures read off plots. The search
record is round 0 of the reviews file.

| work | mechanism | what was measured | real v claimed | lesson taken |
|---|---|---|---|---|
| **Project Sid / PIANO** (arXiv 2411.00114; repo altera-al/project-sid) | ~10 concurrent modules; a bottlenecked controller so speech matches action | specialisation: 30 agents × 3 runs, roles labelled from the agents' *stated* goals and cross-checked with actions; **tax: 29 agents × 4 repeats, from real chest deposits** (about 20% of inventory down to 5-10% after an amendment); religion and memes: 500 agents, one run, keyword counts in speech | the tax result is action-measured but small-n; the 1,000+ agent run was not analysed; **no code released** (the repo holds a PDF and a video); the paper says its agents lacked the spatial reasoning for collaborative building | judge on actions; measure deposits as Sid did; no evidence on building |
| **Voyager** (arXiv 2305.16291; MineDojo/Voyager) | one GPT-4 agent; skill library, curriculum, self-verification | removing self-verification: -73% items | code public; a third-party trial (JVP15/Voyager-LLM-Trials) found only GPT-4-class models got far; issues #185/#186 mineflayer crashes, #194 pickle RCE in shared checkpoints | the world check matters more than the planner: ledger facts are world reads |
| **Mindcraft / MineCollab** (mindcraft-bots/mindcraft; arXiv 2504.17950) | pairwise chat (`!startConversation`) | success "from up to 90% down to less than 30%" from 2 to 5 agents; detailed plans in chat cost >15%; construction score Claude 3.5 0.36, Llama-8B 0.00; split by material and tool; agents destroying another's stone layer | code public; issues: #30 two bots echoing "What should I do now?", #786 a stuck conversation makes an agent look dead, #790 self-silencing, #780 cost and "nonsense" | no job negotiation in chat; one owner per cell; do not split by material |
| **MineLand** (arXiv 2403.19267) | limited senses, physical needs | 64-128 agents is simulator throughput; cooperation shown on one 2-agent task (about 20% fewer iterations) | the scale claim is not a cooperation result | — |
| **TeamCraft** (arXiv 2412.05255) | imitation-trained VLA policies, 2-4 agents | building: centralised 7B 0.42 success, decentralised 0.00; 4 agents 0.02-0.04; "frequently ignoring the fourth agent" | learned policies with full observation, not an LLM over skills | an assigner must cover every bot explicitly |
| **VillagerAgent / VillagerBench** (arXiv 2406.05720) | an LLM task DAG + controller + a shared State Manager | cooking 73.75% v AgentVerse 29.75%; one construction task at 1 / 2 / 4 / 8 agents: completion 100 / 100 / 100 / 66.6%, efficiency 12.96 / 17.75 / 17.41 / 12.45 %/min; **another task in its Table 6 improves from 2 to 4 agents** | code public; issue #10: a subtask split across two agents lost its dependency links (fix unmerged) | the State Manager is the ledger; test the graph split itself; **no general optimum agent count** |
| **MindAgent** (arXiv 2309.09971) | one central LLM dispatcher | CuisineWorld coordination 0.67-0.69 for 2-4 agents; level 3: GPT-4 0.686, Claude-2 0.31, LLaMA-2 0, GPT-3.5 0 | — | central dispatch worked only at frontier scale |
| **Centralised v decentralised LLM planners** (Chen et al., arXiv 2309.15943) | four multi-robot tasks | dialogue 0-52.5%, central 15-90%, central + local check 57.5-100% (at ~21x tokens on one task); dialogue agents "repeat what previous agents said" | — | a central plan plus a local executability check: the validator and the bot's re-check |
| **LLM v heuristic assignment** (arXiv 2510.23824, grid, 2-6 agents) | each agent ranks tasks; deterministic conflict resolution | makespan: optimal 13.93; GPT-4.1 given distances 15.12; without 17.67; greedy 17.93; random 20.54; LLaVA 27.98 | a different setting (decentralised rankings), not a central overseer | the model is only as good as the utilities in its input; a small model can be worse than random |
| **Gerkey & Matarić 2004** (IJRR 23(9), the MRTA taxonomy) | ST-SR-IA is optimal assignment; greedy is within half of optimal | — | classic | an assigner tying random usually means its utilities carried no signal |
| **Contract Net** (Smith 1980); **blackboards** (Nii 1986) | announce / bid / award; typed shared entries | — | classic | already in the comms design |
| **Generative Agents** (arXiv 2304.03442) | word of mouth | the party spread to 13 of 25; 5 of 12 invited came; 1.3% hallucinated answers | — | intending is not arriving: measure arrival |
| **TERMES** (Werfel et al., Science 2014) | construction coordinated only through the structure (stigmergy) | — | — | matches 1.4: coordinate through the record |
| HAS (arXiv 2403.08282), S-Agents (arXiv 2402.04578) | multi-agent Minecraft | HAS 0.76 v Voyager 0.21; S-Agents' tree beat chain and graph | **claimed** (HAS: no code, single-agent baselines); S-Agents a workshop paper | not relied on |

**Cross-cutting, narrowed to what was tested:**
1. In MineCollab's chat-coordinated tasks and TeamCraft's learned policies, success fell as agents were added past 2.
   VillagerAgent's central controller was flat or better from 2 to 4 on its construction tasks. Agent count is a setting to
   measure, not a known optimum.
2. Central assignment beat chat negotiation wherever both were measured.
3. Central LLM dispatch worked at frontier scale (MindAgent); smaller models scored 0 or below random.
4. Chat coordination fails in repeated, known ways (echo loops, stuck conversations, self-silencing, cost). A typed ledger
   removes the class.
5. No Minecraft LLM paper found measured a split **by region or layer**. Monument-01's segments are this project's own
   claim, tested in Paper before any canary.

---

## 3. The job assigner (the overseer's first real job)

### 3.1 What is different this time

| | the shadow mayor (10-03..10-06) | the cooperation tier |
|---|---|---|
| work | self-maintenance duties (free a bag, restore a pick, get wood, get iron) | a **task graph with joint work**: segments of one structure, its materials, the town's deep-miner slots |
| what was shown | the rule tied leased-random on all four duties, **including GET_WOOD, which had selection content** (nearest bot to a live log sighting); FREE_BAG and RESTORE_PICK could not exceed random by construction | — |
| headroom | ~180 bot-h/day unforced FREE_BAG gap, since taken by per-bot fixes | the project's cells and supply; 0 today (S0), so nothing is built before the project exists |
| who decides | a deterministic rule | the owner's frontier overseer (C11); greedy and random computed on the same snapshots for divergence; all three **scored** in Paper |
| actuator | none | the r3 lease: reorders the bot's own job list, re-checked by the bot |
| score | concordance (prediction) | an ITT **effect** from the world, with an effect line that blocks KEEP |
| inputs | world facts with unknown banks | townindex stock (known / stale / dirty / unknown), the project record, completion-time bag snapshots |

**On C11.** The mayor's tie shows that *that rule* found no value, even on GET_WOOD. It does not show a frontier model will
do better. The prior art is consistent with the owner's choice under one condition: frontier assigners beat greedy when the
input carries the utilities (GPT-4.1 with distances 15.1 v greedy 17.9 makespan; MindAgent's dispatch at GPT-4 scale). So
the snapshot carries them (distance, arrival rate, bag contents, BOM shortfall, recent jobs), and "frontier beats greedy
beats random" is a measured claim in Paper (6.2), not an assumption.

### 3.2 Architecture

```
  bot (every decision)              host, every 5 min per town                  overseer, once per town per 30 min
  ──────────────────────            ───────────────────────────────             ──────────────────────────────────
  job list, eligibility,     <───   roles-<home>.json (gen, leases bound   <───  Claude / GPT (C11): one JSON reply to
  admission, remedies               to world, project, record gen, seg)          one snapshot; abstain allowed
  re-checks a lease when it         validator: schema, caps, the job's
  reaches the job in its chain      exported eligibility on host facts,
  release -> baseline path          safety at issue time; spend guard;
  writes `_role_*` rows             greedy + random logged
```

- **Host service `mcai-overseer`** on 10.0.0.31, as r3's foreman: Nice 10, MemoryMax 512M, output rotation (never a hard
  stop), a heartbeat per tick that every read checks. A stale census voids measurement in both arms; a stale overseer is
  treatment downtime in the treated arm (r3 5).
- **Keys stay with the operator** (owner, 10-23). The model call is made by a small **caller** where the keys are (today
  the operator's Mac, as the learning loop's teacher calls are; keys in 600 files, never printed, never logged, never in a
  snapshot or ES). The caller pulls the newest snapshot from 10.0.0.31, calls, and writes the reply back; everything else
  (snapshots, validator, guard ledger, lease files) runs on 10.0.0.31. If the caller or the Mac is unreachable, no reply
  arrives and the tick writes an empty generation: treatment downtime, never a bot change. Moving the caller to 10.0.0.31
  with a dedicated key is owner question C23.
- **The guard sits where the call is sent** (r5, Claude r4). The caller is single-instance (its own lock file) and sends a
  request only while holding a **reservation id** that the host's guard wrote and fsynced for that one attempt (3.8 rule 2):
  it asks the host for the id, the host reserves the worst case and returns it, the caller sends, and settles by id with the
  response's usage. If the host is unreachable the caller does not send; a retry is a new id. Tests: a partition after the
  reservation (no send; the reservation stays open until reconciliation), a partition after the send (the reservation stays
  open; settled from the vendor export), two callers (the second refuses to start).
- The operator creates a **dedicated vendor workspace or key with its own vendor-side spend limit set at the cap** before
  the first call (required, 3.8).
- **The deterministic tick runs every 5 minutes, always** (r4, Claude r3: the generation rules made precise).
  - **Two counters.** The *snapshot generation* S rises every tick. The *lease generation* L rises every time the lease
    file is written.
  - **Every tick** re-validates the leases of the newest accepted reply on the fresh facts, re-issues those that still pass
    **with their original `expires_at`** (a re-issue never extends a lease past what the overseer granted), drops the rest,
    and writes generation L+1.
  - **A reply** for snapshot S is accepted if S is at most 2 ticks old, no empty generation was written after S, and no
    `record_gen` changed after S; each of its leases is then validated on the **newest** facts, not on S. A reply older than
    that is discarded and logged.
  - **Abstain** (`{"gen": S, "abstain": true, "why": <enum>}`) keeps the re-validated leases unchanged.
  - **Empty generation** (all leases revoked) only when a **due** call fails: the overseer returns invalid JSON or times out,
    the caller is unreachable, or the guard refuses the call. A tick with no call due is not a failure.
- The local gpt-oss foreman of r3 is not built: C11 replaces it. The validator, the arms and the guard are model-agnostic,
  so gpt-oss (no API cost) stays an owner option.

### 3.3 The job set

Reconciled with the sibling designs now on origin (r5): building-tier r2 (27980d4e) and mineshaft-safety r4 (89aa22e9).

| job | what the bot does | eligibility (pure, exported by the owning module; host part / bot part) | cap per town | released when |
|---|---|---|---|---|
| **BUILD:<seg>** | the building tier's builder places the open cells of one segment, holding a slot and the segment lease, drawing its segment's bill from the town's **claim set** (building tier §5), from the site chest or the bag's deliverable surplus only | building tier `buildEligible`: host = the segment's material in the site chest or **bag surplus** (above the keep rules), a free slot, the segment unleased and its `deps` complete, no flag, health > 10; bot = a stand reachable by the walk probe | `builders_max` 2 (shop-01, C14) | segment done, lease lost, TTL, refusal, maintenance pre-empts |
| **SUPPLY:<item>** | **moves, never makes** (r5): carries a **finished part or raw item** the open segments claim from a town chest or the bag's surplus into the reserved site chest (withdraw, then a verified deposit). Parts are made only by the building tier's single maker, `make_material` | this design: host = `to_site(item) > 0` and the bag's surplus holds it, or a known, fresh town container other than the site chest holds it **as spendable stock under the building tier's claim set** (above `BUILD_RESERVE`, outside other live claims); bot = site-chest room, **re-checked immediately before the deposit** | 2 per item | `to_site` met, no room, refusal, TTL |
| **DEEP_MINER** | mineshaft-safety M8's `deep_miner` job: the town's certified deep stair, branch tunnels at diamond depth | mineshaft-safety's preconditions (5.4); the cap of 2 records per town with phase ≠ `out`, enforced by its own acquire | 2 (theirs) | its own lease ends (full bag, uses at the floor, F4 stop, F1 firing, health ≤ 14, work expiry) |
| **SMELT** | smelt_town (copper, iron) | smeltjob's existing admission; the workshop's furnaces are reserved for `make_material` (building tier §3.2) | 1 | nothing to smelt (releases at once) |
| **BANK** | town_deposit as today (the site chest is excluded, 5.3; parts are always bankable, building tier §3.4) | towndeposit's existing admission | — | nothing bankable |
| **FREE** | the bot's own plan | — | at least 1 per town | — |

`make_material` (the parts) and `mats_return` are the building tier's jobs with their own admission and lease; the
overseer does not lease them in v1. Their output goes to town chests as `PROJECT_PARTS`, from where SUPPLY carries what the
open segments claim.

**Quantities (one stock policy: the building tier's).**
- **The claim set and `BUILD_RESERVE` are the building tier's** (§3.3 there): spendable = indexed town stock (known and
  fresh) − `BUILD_RESERVE` (cobble 256, logs 512, planks 64, sticks 64, copper ingots 256, sand 16, torches 32) −
  outstanding claims, with the iron ladder, every tool and the kit's sticks never inputs. This design adds **no second
  reserve** (r4's per-item SUPPLY reserve is withdrawn).
- **The site chest satisfies claims** (r5, Claude r4; asked of the building tier): units in the reserved site chest count as
  **delivered** against the segment claims they were moved for, not as missing town stock. Otherwise moving a claimed unit
  into the site chest (which other index consumers skip) would count it short twice and push `make_material` to over-make.
- `to_site(item)` = the open segments' claimed bill (the building tier's `material_open`, from the builder's newest world
  read of each segment, 3.5) − what the site chest holds. It drives SUPPLY.
- `short_town(item)` = `to_site(item)` − spendable town stock of that item. It is the building tier's signal: when a part is
  short, `make_material` is eligible; when a raw item is short, ordinary gathering and the deposit flows refill it. The
  overseer reports it as `unstaffed: {job: SUPPLY:<item>, why: no_source}`.
- **The bag:** only its deliverable surplus may go (what it holds above the keep rules: the iron ladder, the scaffold
  reserve, the stockpile allowance, the tool kit, the bag allowance). Escape blocks and tool materials are never delivered.
- **Composed tests:** SUPPLY and BUILD each on a bot holding exactly its protected minimum: nothing leaves the bag, and the
  escape, toolkit and maintenance chains run unchanged. A fixture town with 831 cobble (575 spendable above the 256
  reserve) makes the chest path eligible.

**Not leasable:** general MINE (junkwell-01: more mining sent bots into sealed pockets and lava; only DEEP_MINER, under the
mineshaft design's safety); RECALL (29% `home`); GATHER as a role; explore; `make_material` (v1).

**Maintenance always outranks a lease** (r3's starvation rule): bag-full, spent-tool and no-usable-pickaxe orders and every
reflex rank above any leased job.

**SUPPLY without leases (inside shop-01, before any overseer).** SUPPLY sits in the town-job chain after the maintenance
orders, the existing town jobs and `make_material`, and before FREE time: an unleased bot at town takes it when
`to_site > 0` for an item it can source, at most once per 10 min per bot, and not when the bag is at 34 slots or more.
SUPPLY is the builder's **only** route from town chests to the site chest (the builder draws from the site chest or its
bag), so it ships with shop-01, not after it.

**The SUPPLY loop guard.** Withdraw from chest A, find the site chest full, and a baseline town_deposit could put the items
back into A; SUPPLY would run again. So SUPPLY checks site-chest room **before** the withdraw and again before the deposit;
a `no_room` outcome releases the lease **and** sets a 30-min per-bot SUPPLY cooldown for that item (a deterministic
cooldown, not a lease rule). A composed chain test runs exactly that loop and asserts no withdraw in the 30 minutes after a
`no_room`; a second test makes two successful deliveries 10 minutes apart and asserts both run.

### 3.4 The snapshot and the reply
- **The live snapshot** comes from the shipped index fold (`townindex.mjs` `readIndex(dir, hk, world)` with
  `indexStateOf` and `indexHolding`, via node on the host: known / stale / dirty / unknown per container, world-checked;
  `ok: false` means every container is unknown, so no stock is held and SUPPLY's town path is not eligible), the project record, and each bot's **completion-time** snapshot (a skill
  row's position and bag belong to its end; event rows to their emission). Unknown or dirty stock is never counted as held.
- **Per bot:** at_town, distance, dy, arrival rate in the last 24 h, health, carried kinds, key items, pickaxes, the last 3
  skills and outcomes, safety flags, successful runs per job in 24 h, and `eligible`: **the validator's filtered output** on
  host facts, so the model never sees an ineligible choice.
- **Project:** state, layer, cells done / open / waived, segments (holder, open cells), per item `to_site` and
  `short_town`, `stall_min`.
- **Input ceiling (r5).** Every request is counted **exactly as it will be sent** (system prompt, snapshot and request
  framing) with the selected model's own counter: Anthropic's token-counting endpoint for Claude, the model's published
  tokenizer for a GPT model. It must be at most **3,000 input tokens**, or the call is not made (logged; the tick keeps
  the re-validated leases). **If counting is unavailable, the call is not made** (fail closed); there is no heuristic
  fallback. That is what makes the guard's worst case a bound (3.8).
- **Size (synthetic, for costing only).** `tools/snapshot.py.txt` filled the fields from the window's real rows and the
  raw index at 10-23 10:00Z for all 13 towns, with a fixture workshop and invented `eligible` lists. It is not a faithful
  input: it ignores dirty marks, pools stale stock and pairs end-of-skill bags with start times. It sizes the call only:
  **3,497-3,820 characters, about 1.0-1.3k tokens** (r3 fields: `to_site`, `short_town`, arrivals, affinity, next-visit
  eligibility). The draft system prompt (`tools/system_prompt.txt`, r5: next-visit leases allowed, abstain with `gen`,
  `deep_miner`) is about 3.5k characters, about 0.8-1.0k tokens. So about 2.0-2.2k tokens in; the costs assume 2.5k. The operator re-measures both with the
  vendor's token counter before any call.
- Every value is an enum, a registry name, a fleet bot name or a number (comms principle 6).
- **Reply** (strict JSON): `{gen, leases: [{bot, job, ttl_min 5..30, reason (enum), evidence: [snapshot paths]}],
  unstaffed: [{job, why (enum)}], abstain}`.
- **The validator:** schema; the reply's `gen` names an acceptable snapshot (3.2: at most 2 ticks old, no empty generation
  and no `record_gen` change since); every bot and job exists; the job
  is in the validator's own `eligible` for that bot; caps; at least one FREE; no lease to a bot **flagged at issue time**
  (r3 4.4's set: a trap or drowning row in the last 5 min, health ≤ 10, a ready milestone rung, or a reflex holding the
  body; the ready rung also outranks any lease bot-side, r3 4.3);
  no re-lease of a job a bot refused in the last 30 min. A dropped lease counts against the overseer (invalid rate is a
  metric).
- **Host and bot eligibility agree by construction:** the validator calls the owning module's exported JavaScript
  eligibility through node on the host-computable inputs (`buildEligible`'s host part, `deepMinerEligible`'s host part,
  SUPPLY's quantities). Facts only the bot has (the walk probe, a fresh window) stay bot-side. A host fact that is unknown
  (a position older than 10 minutes, unknown stock) **fails** host eligibility. A parity test runs both halves on the same
  fixtures.

### 3.5 Claiming, next-visit leases and release
- **Delivery:** `/var/lib/mcai/_pool-<pool>/roles-<home>.json`, atomic rename; `gen` persisted and monotone; `issued_at`;
  per lease `expires_at`, `world`, `project`, `record_gen`, `segment`, `snapshot_gen`.
- **Binding:** the bot honours a lease only if world, project and segment match what it reads and the project's
  `record_gen` (the building tier's record generation; 5.2: it changes only on transitions) equals the lease's. Otherwise it is stale and ignored.
- **Next-visit (r2, Claude r1 P1).** BUILD and SUPPLY leases are issued to safe bots wherever they are. The lease does
  nothing until the bot is inside its town-job chain at town; then it puts the leased job first among the discretionary town
  jobs. **It never causes travel**, so it is not RECALL. Each 5-minute tick re-issues still-valid leases, so a lease lives
  while the overseer keeps choosing it; an away, unflagged bot is inside the town-job radius within 30 min 42.8% of the time
  (1.4). The share of leases that meet an arrival before expiry is a shadow gate (3.9).
- **A lease is a sort key, not a command.** The job's own admission still decides. For BUILD and DEEP_MINER the bot must still
  win the building tier's slot and segment lease or the mineshaft's `deep_miner` record: the overseer cannot grant either.
- **Claims belong to their protocols** (monument-01, kept explicitly): admission slot and segment lease files created with
  `link()`, TTL 4 min **renewed before each placement step**, a **fence check of the record generation before every
  mutation**, reclaim only after TTL plus 60 s of clock slack.
- **Release** writes `_role_released {reason}`: done, refused (the job's own reason), ineligible on the bot's check, stale
  binding, expired, revoked (an empty generation), maintenance pre-empted, flagged. The bot's next decision is today's.
- **One source of truth for lease outcomes:** the `_role_issued` (host), `_role_honoured` and `_role_released` (bot) rows. The
  ledger mirrors them for talk (4.2); nothing decides from the mirror.

### 3.6 Failure handling: no dead ends

| situation | what happens | why it is not a dead end | composed test |
|---|---|---|---|
| no lease, or the file is missing, corrupt or of another world | today's behaviour | every consumer's default is today's path | a corrupt file, then a valid one |
| a lease the bot cannot perform when it reaches the job (no stand, no material, segment taken, slot full) | released in the same decision, baseline path | the bot never waits; the next snapshot sees the release | each job's refusal -> the next decision equals control's |
| the job runs out mid-lease (copper gone, segment done, `to_site` met) | the job's own `no_effect` releases it; 30-min no-re-lease | stops a loop | smelt with no copper -> released, not re-leased in 30 min |
| SUPPLY's withdraw / deposit loop | room checked before withdraw and before deposit; per-item 30-min cooldown on "no room" | 3.3 | the loop test (3.3) |
| the overseer is slow, down, over budget, or invalid | empty generation within 5 min; TTL ≤ 30 min bounds a dead service | bots run today's code | kill the service; leases lapse; decisions match control |
| a late reply after a revoke or a layer change | discarded by the validator (`gen`) and by the bot (`record_gen`) | — | a delayed reply fixture |
| a builder dies or disconnects | the segment lease's TTL frees the segment | as monument-01 | kill a builder mid-segment |
| a leased bot's maintenance comes due | the maintenance order runs first | r3 starvation rule | lease + bag reaching 34 -> deposit within the TTL |
| **no open cell is reachable** (every stand fails the walk probe) | the host cannot see reachability, so BUILD may be issued; the bot's probe fails and it refuses `no_stand` and releases; a **per-bot BUILD `no_stand` cooldown of 30 min** applies on the rotation path too (B4), so arriving bots do not re-probe on every visit; after 2 such stalls the validator stops re-issuing; the project is **stalled: unreachable**, named in the read; the building tier's stall and waiver rules decide the project's fate (**question to the building tier: does a failed probe count as a visit toward a waiver?** If not, an unreachable cell can neither progress nor be waived, and the project must say so) | **the bots are never stuck** (they never wait on the project); **the project can be** — the building tier's honest outcome, not hidden | a fixture with an unreachable cell: the refusal, the cooldown, no bot stalls, the project reports `stalled: unreachable` |
| a project stalls (no witnessed placement for 30 min while open and staffed) | the validator stops re-issuing that job after 2 stalls; **the counter resets** on a witnessed placement in that project or a new record generation | — | stall, then a placement -> leases resume |
| DEEP_MINER declined by the mineshaft preconditions or guards | released; the mineshaft design's remedy | their contract: every refusal names an executable remedy | their chain tests, plus a lease into each refusal |

### 3.7 Soft preference, not roles (C13)
- **Affinity** = a bot's successful runs of that job in the last 24 h (from rows), decayed with a 12 h half-life, capped.
- It is in the snapshot and is the **first tie-break** of the greedy baseline and of the validator's re-issue order. It
  never overrides eligibility, caps or safety.
- **Why not roles:** smelt_town shows the stranding the owner described (1,399 of 1,646 runs found no copper; 1.2).

### 3.8 Cadence, cost and the hard spend guard (C12)

**Per call (3.4):** in ~2.0-2.2k tokens, assumed **2.5k**; out ~150-300 tokens of JSON plus thinking, assumed **1.2k** at
low effort; worst case `max_tokens` 4,000.

**Prices** (Anthropic first-party list, per million tokens in / out; re-checked on claude.com/pricing 10-23): Claude Sonnet
5.5 $2 / $10; Claude Haiku 4.5 $1 / $5; Claude Opus 5.5 $4 / $20. **GPT prices were not looked up**: the guard reads a
price table the operator fills from the vendor's page before a GPT model is enabled.

| per call | expected (2.5k in, 1.2k out) | worst case (3k in ceiling, 4k out) |
|---|---:|---:|
| Sonnet 5.5 | **$0.017** | $0.046 |
| Haiku 4.5 | $0.0085 | $0.023 |
| Opus 5.5 | $0.034 | $0.092 |

No prompt caching in v1, so no cache-write premium. If caching is enabled later, the reservation counts input at the
cache-write price (up to 2x).

**Cadence, hard:** a **token bucket per town**: one token per 30 min, at most 2 held, at least 10 min between calls, and
at most **48 calls per town-day**. An event (a segment freed, a refusal, a stall past 30 min) may spend a held token early;
it never creates one. So a burst cannot use up a day's calls and leave hours of empty generations; downtime is reported by
hour of day. Re-asks (to measure the overseer's own run-to-run disagreement) are
**hard-capped at 5 per town-day** and budgeted on top: at most 53 calls per town-day (the tables use 52.8).

| plan (Sonnet 5.5; expected at 52.8, worst case at the 53 allowed calls per town-day) | $/day expected | $/month (30 d) | worst case $/day |
|---|---:|---:|---:|
| **S1 Paper arms** (6 pairs, ~2 h each, frontier arm only) | ~$1-3 once | — | — |
| **S2 shadow, 3 towns, real time** (72 h) | **2.70** | (81) | 7.31 |
| **S3 live, 4 canary towns** (≤ 7 days) | **3.59** | (108) | 9.75 |
| live, all 13 towns | 11.7 | 350 | 31.7 |
| live, all 13 towns on Haiku 4.5 | 5.8 | 175 | 15.8 |

- The owner's estimate (about $5/day at one call per town per 30 min on a mid-size model) matches about 5-6 towns on
  Sonnet 5.5, not all 13.
- **A month of this plan** (Paper, 72 h shadow, a 7-day live canary) is about $36 expected and $93 worst case: inside the
  cap. Running shadow and live together is not planned.

**The hard spend guard** (host-side, deterministic, in the service, fixture-tested before any key is read):
1. **One process, one lock.** All calls go through one service holding `flock ~/overseer/spend.lock` for every ledger
   write. A second instance refuses to start.
2. **Reserve before sending.** Before a request is sent, the guard appends a **reservation** of its worst case (counted input
   tokens of the exact request by the model's own counter, failing closed, + the `max_tokens` cap, at the table price) to
   `~/overseer/spend.jsonl` and fsyncs it. The send happens only if
   month-to-date **billed + all open per-call reservations + all earmarks (rule 8)** + this reservation stays under the
   monthly cap ($150). A call that is **not** part of an earmarked run must also fit the daily allowance (cap ÷ days in
   month, unspent allowance carried at most 2 days), counting only unearmarked spend.
3. **Settle from billed usage.** A reservation is replaced by the billed amount (input, cached, output tokens from the
   response's usage fields, with the vendor request id). A timeout, crash or a response with no usage **keeps the
   reservation open** until reconciliation settles it.
4. **No hidden retries.** The SDK client runs with `max_retries=0`; each retry the service makes is its own reservation.
5. **Settlement and reconciliation.** Each call settles from the response's own `usage` fields (per request). Open
   reservations without usage (timeouts, crashes) stay open. Once a day the operator's machine, which alone holds any
   admin-level vendor key (none is placed on the fleet host), exports the vendor's usage for **complete days** in
   aggregate; the guard compares the day's totals (ledger v vendor) and settles leftover open reservations against the
   difference. A difference over 5%, or **no recorded reconciliation in 36 h**, stops the overseer until the operator
   looks. The 36 h stop therefore depends on the operator's daily export; that is stated, not hidden.
6. **Order when short:** live towns first, then shadow; shadow stops first.
7. **At 80% of the month:** shadow stops; a fleetstatus header line and an alarm row (alarms surface in the header). **At
   100%** (or any guard failure: missing ledger, corrupt price table, failed write): **the overseer stops, and stopping
   means it keeps writing empty generations every tick**, so every lease lapses within 5 minutes and stays lapsed; **the
   bots run on** with today's behaviour. It restarts next month or when the owner raises the cap.
8. **Earmarks.** At B7's launch the guard writes a **month-only earmark** of the whole horizon's worst case: 7 days × 4
   towns × 53 calls × $0.046 = **$68.3**; if billed + reservations + earmarks would pass the cap, B7 does not launch. A
   census-voided extension of the deadline (6.1) first extends the earmark by the extension's worst case; if that does
   not fit, the run closes at its original deadline and is read there. Each of the run's calls then
   moves its reservation **out of** the earmark (so nothing is counted twice) and settles as usual; the earmark shrinks to
   the remaining horizon. Earmarked calls are excluded from the daily test, so the reserved schedule is never cut by the
   daily rule, and the monthly cap still holds. A horizon that crosses a month boundary is earmarked in both months.
   **The 72-h shadow is earmarked the same way** (3 towns × 3 days × 53 × $0.046 = $21.9), since its worst case ($7.31 a
   day) is above the daily allowance (about $4.84); its downtime by hour is reported.
9. **Backstop:** the dedicated vendor workspace or key with its own limit at the cap (3.2).
10. **Tests:** concurrent submissions, a restart with open reservations, a timeout with no usage, month rollover, a month at
    99.9% refusing a call whose worst case would cross, a missing ledger, a corrupt price table.

### 3.9 Shadow first (C11), and what it can and cannot show

**Shadow (S2):** the service runs **in real time** in 3 towns with an open project **for the whole 72 h** (from the building
tier's queue, as for B7; a town whose project completes takes its next queued structure, or the shadow extends). Real
time, not Batch: delayed replies would make `last_gen`, event calls and the 30-min no-re-lease unreproducible. It builds snapshots, calls, validates, and logs the leases it **would**
have issued, plus the greedy and random assignments for the same snapshot. It delivers nothing. At least 72 h.

| shadow gate | why |
|---|---|
| validator-clean ≥ 98% of leases; abstain rate reported | the model follows the contract |
| executable on the next snapshot ≥ 80% (host part) | leases would not be refused at once |
| **per lease issue** (the first issue of each chain: a bot-job pair that was not leased at the previous tick; re-issues ignored), the share whose bot arrives (≥ 2 consecutive minutes inside 16 / 12) **within 30 minutes of that issue**, frontier v random on the same snapshots, the same window for both: the frontier's share at least random's (r4: a chain-length measure favoured an assigner that keeps re-choosing one bot) | next-visit leases go to bots that come |
| no lease to a bot flagged at issue time (0) | safety |
| stall recall ≥ 0.6 against S0's stalls | it sees what matters |
| concordance with what the bots did: **reported, never a gate** | prediction: the mayor's measure. High means redundant; low is not value |
| frontier v greedy v random: divergence and the features where they differ, reported | the first look at whether the choices differ in a way an outcome could reward |
| spend inside the guard; ledger reconciles with the vendor within 5% | the guard works on real billing |

**What decides going live is not the shadow** but the Paper arms (6.2). If the oracle cannot beat rotation, the live
canary does not launch (r3's rule).

---

## 4. The comms ledger, stage 1, on the townindex records

### 4.1 Where things stand
- **townindex-01 is on the fleet** (KEPT +360 10-23 01:07Z, promoted 01:17Z): the stock store, `obs` / `dirty` / `xfer`
  records per container (1.1). It shipped **without** the ledger the comms design proposed to ride with it (owner C2).
- **indexsearch-01** (the index's first reader) is a live canary.
- So ledger-01 is now its own small change. Consumers read the index directly (comms principle 8); the ledger never
  mirrors stock for a decision.

### 4.2 What gets written, who reads it, what decision it changes

| type | written by (automatically) | read by | the decision it changes | ships in |
|---|---|---|---|---|
| `station` (a furnace's input, fuel, output at an open) | every furnace open: drain, smelt, smelt_town | **furnaceseen-01** (the drain) | the drain skips the walk to a furnace a townmate found empty < 60 min ago, unless newer contrary evidence exists (comms 4.5) | **B2** (consumer B3): 870 repeat empty drains a day |
| `claim` (snapshot mirror of furnace, segment and slot leases) | one reconciler per town per 30 min (comms 4.3) | stage-2 talk only (every gate reads the lease files directly) | none | **deferred to stage 2** (r3: it changes no decision) |
| `progress` (a mirror of witnessed placements) | the reconciler, from the builder's placement rows | stage-2 talk only | none: **placements are measured from the builder's positioned, server-witnessed placement rows**; what remains open is decided by the builder's world re-read (5.2) | **deferred to stage 2** (r4) |
| `lease` mirror (issued / honoured / released + reason) | the reconciler, from the `_role_*` rows (the single source, 3.5) | stage-2 talk only | none | **deferred to stage 2** (r4) |
| `to_site`, `short_town` | **not stored**: derived by readers from the project record and the index (as comms 4.2 derives `need`) | SUPPLY eligibility, the snapshot | which item is short and from where | — |
| `death`, `fire_site`, `hazard` mirrors | — | stage-2 talk only | none | deferred to stage 2 |

**Not written, on purpose** (comms 2.4): a bot's failure to reach something, fruitless visits, "sighting gone".

### 4.3 Protocol and gates
- The comms design's file, appender, generations, checkpoint, fold (`ledgerView(entries, now)`), rate rules and dead-end
  table (comms 4.3-4.6) apply unchanged.
- **Gates (comms 4.7):** L1 parity of every complete mirror snapshot with an independent parse of the retained source bytes;
  L2 integrity (0 unparsed lines, 0 dropped transitions, `_ledger_drop` ≤ 1% of observations); L3 cost (append p95 < 5 ms,
  < 2 MB per town per day, fold p95 < 50 ms); L4 no harm by the default gate.

### 4.4 Candidate X1 (expansion lane, not cooperation)
Explore toward a sighting rarely ends with iron gained near it, co-targeted or not (10 of 16,958 runs by any route, r4;
1.2). That leaves nothing for a heading claim to improve. Why the sightings yield so little is not established
here; a host read by sighting age and kind (X1) goes to the expansion lane (E0).

---

## 5. The first shared project: 2 bots build their town's workshop (C14)

### 5.1 Shape (reconciled with building-tier r2, 27980d4e)
- **workshop@1** is the building tier's: a 7x5 enclosed shell on a 9x7 pad (stone-brick pad and step ring, plank walls,
  glass-pane windows, plank roof, a door and a light), sited in the town plan's **outer domain** (Chebyshev ≥ 22 and
  straight-line ≤ 44, in the pavilion's sector). r1-r4's ring@1 plot at d ≤ 13 is withdrawn: a 9x7 pad is free inside 16 in
  only 4 of 16 bench towns (building tier §4.3).
- **The reserved site chest stays inside 16** (the town plan's `work` plot), because it must be a town container the index
  sees. So material moves through the site chest inside town, and the builders carry their segment's draw out to the
  workshop at 22-44.
- The building tier owns the blueprint, `make_material`, the claim set, `BUILD_RESERVE`, the record, the slots and segments,
  and the structure count. This design owns how bots share the work: who tries which segment first, and SUPPLY.
- **Segments with dependencies** (building tier §4.1): `pad`, `ring`, `wall-N/E/S/W`, `roof-edge`, `roof-inner`, `fit-out`,
  `door`; a segment is claimable when its `deps` read complete in the world. The four walls are where two builders work at
  once.
- **Builders: 2 in shop-01** (C14 and building tier Q5); a third is a setting once the 2-builder run is read.
- **Asynchronous by construction:** each builder works its own segment in its spells at town; the world and the lease files
  are the protocol.

### 5.2 The claimable sub-task interface (agreed with building-tier r2 §4.1 and §5)

**Adopted from the building tier as it stands:** the record (`project-<home>.<plot>.g<N>.json`, the town plan's
acceptance walk and `link()`); admission slots (`project-<home>.<plot>.slot<k>.lease.g<N>`, k = 1..`builders_max`) before any
segment; segment leases (`project-<home>.<plot>.seg<id>.lease.g<N>`, TTL 4 min, reclaim after TTL + 60 s); **a fresh lease
generation per acquisition, and the fencing token (the lease's own N, the record generation) checked before every click**;
the closer token; `buildEligible` split into host and bot parts; `segmentDone`, `segmentBom`, `concurrentOk`.

**Two points this design depends on, stated so both designs say the same thing:**
- **The record generation changes only on transitions** (a layer or dependency opening, a fallback transition such as
  `window_shortfall`, a state change), never per placement or per lease renewal, so one builder's work never invalidates
  the other's fence. Counts (`cells_open/done/waived`, `material_open`, `bom_open`) are read from the world at every read,
  as the building tier says, not written per placement. The role lease binds to this generation as `record_gen` (3.5).
- **What is open is decided by the world.** The builder re-reads the loaded cells of its segment at every visit; a cell
  already holding a valid block is done whether or not a placement row exists. Placement rows (`_build`) measure
  **production** only. Because the host cannot read the world, the builder writes one `_build_seg` row per visit with the
  segment's open cells and `material_open` as it just read them; the host's `to_site` uses the newest such row per segment
  (older than 2 h: unknown, so SUPPLY is not host-eligible for it). A cell the world shows done without a `_build` row is
  logged once as `found_done`, and a placed cell later found missing as `found_open`, both in that row. Test: a builder
  killed after the server confirms a placement but before its `_build` row; the next visit reads the cell done, logs
  `found_done`, and the cell is not placed twice.

| sub-task | claimed through | eligibility | done when (world-read) |
|---|---|---|---|
| **build a segment** | a slot + the segment lease (building tier) | `buildEligible` (host part on the validator, bot part on the bot) | `segmentDone` from the world |
| **supply an item** | no lease: a verified deposit into the site chest under the site-chest lease (5.5) | `to_site(item) > 0` and spendable stock or bag surplus (3.3) | the site chest's next observation holds it; the units count as delivered against the claim |
| **make a part** | the building tier's materials lease | `make_material`'s own admission | parts banked as `PROJECT_PARTS` |
| **open the next segment** | the record's CAS (building tier) | `deps` complete in the world | the dependent segment becomes claimable |

**What the cooperation tier writes into the project:** nothing. It reads the record, the leases, the rows and the index, and
writes role leases and `_role_*` rows.

**What the building tier emits (its §4.1, adopted):** a positioned `_build` row per witnessed placement; a row per slot and
segment lease taken and lost; `_structure_complete`; its licence rows (`_mats_mode`, and shop-01's own mode row, used by B0).
**Asked in addition:** the per-visit `_build_seg` row above, and counting site-chest units as delivered against claims
(3.3).

**Glass, answered:** matset-01 raises sand's stock target to 64 and takes glass off the junk list, and `make_material`
makes panes; an unplaced window becomes a plank wall cell after 24 h (`window_shortfall`). So no BOM item is left without a
producer.

### 5.3 The reserved site chest
- The site chest is a town container in the plan's `work` plot (16 h / 12 v), so townindex sees every move. It is also where
  every other picker would otherwise reach: town_deposit, withdraw (every-chest search), toolkit (every-chest search), the
  smelt jobs, `make_material`'s input draw, and the town plan's `allocateHomes` (which would class it as a home, overflow or
  drain and let tidy empty it).
- **The siting file declares it reserved** (`townplan` plot `work`, cell role `site_chest`, `reserved: true`; adopted by the
  building tier §4.5), and every container picker excludes reserved containers: deposit and town_deposit targets, withdraw,
  toolkit and smelt searches, `make_material`'s inputs, `allocateHomes`, tidy and dispose. Only SUPPLY (deposit) and the
  builders (withdraw) touch it, each under the site-chest lease (5.5).
- **A composed test:** a baseline town_deposit, toolkit, withdraw_pick, smelt_town and `make_material` run beside a stocked
  site chest leave it byte-identical by server read; then SUPPLY deposits and a builder draws.
- A reserved chest is released when its project completes, **and also when it is stalled past the building tier's stall
  limit or abandoned**, so its material is not stranded; its contents then drain into the town plan's homes as any drain
  container's do, and the claims they satisfied are released with the project.
- **This overrides two owner decisions** ("withdraw checks every town chest", 10-16; "toolkit searches every chest",
  10-19) for one container per project. It is owner question C22.

### 5.4 Deep miners (reconciled with mineshaft-safety r4 M8, 89aa22e9)
- **The job is `deep_miner`** (3.3): the town's certified deep stair (F6) and branch tunnels at diamond depth. Its record
  lives in world facts under the keepout pid lock, `{bot, gen, phase: descending | branch | ascending | out,
  work_expires, renewals}`, with a fencing `gen` per acquire. **At most 2 records per town with phase ≠ `out`**, enforced by
  the acquire itself. Rows: `_deepmine` per phase change.
- **Preconditions** (mineshaft-safety M8; the assigner's validator checks the host-computable ones, the skill re-checks all
  at its start; a failure is a decline, not a counted failure): health 20; F1 and F4 KEPT, read from the build's licence
  rows; priced pickaxe uses (certified stair: branch 200 + floor 30 + 20 for ore, plus 50 spare; while the stair is being
  cut, 6 uses per remaining step); a dedicated iron-or-better pickaxe with ≥ 20 uses for ore; ≥ 64 seal blocks beyond the
  32-block floor, withdrawn from town stock before admission if the bag is short; ≥ 6 free slots.
- **Seal-block withdrawals draw from spendable stock under the building tier's claim set** (above `BUILD_RESERVE`, outside
  live claims), so the deep miner and the workshop cannot spend the same cobble.
- **Until B8, the skill's own admission is the assigner** (both designs say so): an eligible bot acquires a free record
  first-come. The overseer's lease later only reorders who tries first, with the soft preference ("yesterday's deep miner
  tends to mine").
- **A role lease never ends or shortens a held `deep_miner` record, a segment lease or a slot.** An expired or revoked role
  lease affects only who acquires next; a held record runs to its own end (full bag, uses at the floor, F4 stop, F1 firing,
  health ≤ 14, work expiry 60 min renewable once) and confinement below the stair top is the mineshaft design's.

### 5.5 What "built together" means, measurably
- **Multi-builder project-days:** a project-day on which 2 or more different bots placed witnessed cells of the same
  structure.
- **Site-chest mutations are serialized, ownership-safe (r4, Codex r3).** Every SUPPLY deposit and every builder draw holds
  the site-chest lease from before its pre-open to after its verifying re-open.
  - The lease is a generation file `sitechest-<home>.lease.g<N>` created with `link()` (one winner per N), holding the
    owner bot, its process incarnation, N and `until` (now + 60 s).
  - The holder **checks before every click** that the newest generation is still its own N and `until` has not passed,
    and renews (a new N+1 by the same owner) before `until`; a check that fails stops the mutation at once.
  - **Release** is a `released` marker on the holder's own N only; it can never remove a successor's lease.
  - **Takeover needs the old holder's process to be gone, not just late** (r5, Codex r4: a holder can pause after its
    check and before its click, and the server does not see the file fence). As in the comms design's courier takeover,
    the lease records the holder's process incarnation and pid; another bot may link N+1 only when `until` + 60 s has
    passed **and** the holder's incarnation file names a different incarnation **and** the recorded pid is not running
    (`kill -0`; all bots run on one host as one user). Time alone never permits a takeover.
  - So no two live processes ever mutate the site chest at once: while the holder lives, only it can end its lease. A
    hung but living holder blocks the site chest until the operator restarts it; the others simply skip SUPPLY and the
    builder's draw (no waiting), and the read reports any site-chest lease held over 30 min. A reused pid makes `kill -0`
    succeed and blocks the takeover: that fails safe and lands in the same report.
  - A mutation that finds the lease held simply does not start; the bot's next decision is its own (no waiting inside
    the skill).
  - **Tests:** (a) SIGSTOP a holder after its check with a click about to be sent, past `until` + 60 s: no successor takes
    over while the process lives; on SIGCONT it finishes or releases under its own lease. (b) Kill the holder mid-mutation:
    a successor takes over only after the pid is gone, and the killed holder's partial step reads unknown in the chain.
    (c) A reconnect in the same process (same incarnation) is not a takeover.
- **Site-chest supply by non-builders:** units that bots other than the builders deposited into the reserved site chest and
  builders then withdrew, from its observation chain.
- **Cells placed from delivered material**, conservatively. Over one segment lease, for one item: placements attributable
  to the site chest = min(placements − bag stock at the lease's start − other logged inflows during the lease (pickups,
  crafts, other chests: `_inventory_mutation`, pickup and withdraw rows), site-chest draws in the lease), floored at 0.
  If any inflow during the lease is unlogged, the lease's material is **unknown**. Unknown provenance is reported, never
  assigned.
- **Completion:** the building tier's structure count (enclosed, roof, door, light), verified by an RCON re-read.

### 5.6 Dead ends specific to the project

| situation | result |
|---|---|
| no stand reachable for any open cell | 3.6: bots never wait; the project stalls under the building tier's rules and is named |
| the site chest full or missing | SUPPLY refuses before the withdraw (`no_room` / `no_target`); per-item cooldown; the read names the town |
| an item nowhere in town (`short_town` > 0) | SUPPLY not eligible; `unstaffed: no_source`; a short part makes the building tier's `make_material` eligible; a short raw item is refilled by ordinary gathering and the deposit flows |
| a builder inside its own segment as a cell would close over it | the building tier's entity rule |
| both builders hold segments and leave town | segment TTL (4 min) frees them |

---

## 6. Measurement and canary plan

### 6.1 Rules for every read in this tier
1. **Effects from the world:** server-witnessed placements and an RCON re-read at the end; index observations; bag deltas
   at verified opens. Intent rows (a lease issued, a row before an action) never count as an effect.
2. **The unit is the town.** Difference-in-differences against control towns, never canary against fleet. Randomization
   inference over towns; the null from S0's pre-period of the same towns.
3. **ITT over a fixed horizon** (r3 5): every randomized town-hour stays in, including stalls, completions and overseer
   outages. A census outage voids hours in both arms **and extends the deadline by that span**.
4. **KEEP needs the effect.** verdict.py treats `primary` as advisory, so a KEEP alone means "nothing objected". The
   registration carries an **effect line**: an `own_lines` entry on the read's lower bound, `on_fail: REVERT` **without**
   `evidence`, not nullable. Under v25 such a line cannot revert; failing, it lands in `blocked` and the verdict is
   INCONCLUSIVE; undefined, the verdict is UNREADABLE. (The Claude r1 reviewer checked this path in verdict.py, including
   under a `rate` licence.) verdict.py's own lines support only `<=`, `>=` and `==`, so a lower bound **equal** to the bar
   passes; the bar is registered with that meaning (a strict "clears" would be registered as the bar plus 1e-9). The registration is fixture-tested against verdict.py before launch: a lower bound above,
   equal to, below, and undefined give KEEP-eligible, KEEP-eligible, INCONCLUSIVE and UNREADABLE. The analyst's effect call
   is still written separately.
   - **The REVERT rule of r3 is kept:** a second own line on the DiD's **upper bound** `>= 0`, `on_fail: REVERT`, with
     `support: {read, field: <randomization p>, max}` (v25), so a measured loss can revert while chance cannot.
   - **Read schedule and the family-wise rate.** The registration fixes the reads (for a 7-day horizon: +24 h, +72 h,
     +120 h, final). The effect and REVERT lines decide **only at the final read**, implemented with verdict.py as it is
     (r5, Codex r4: a `nullable` own line is skipped at every read, including the final one, so it could let tier 3 KEEP
     without an effect; a non-nullable undefined line is UNREADABLE at every interim read). Both lines are therefore
     **non-nullable and defined at every read** (r5, Claude r4):
     - the read writes the **real** effect lower bound and the REVERT line's upper bound at every read; before the final
       read it **withholds only the REVERT line's support p**, so verdict.py cannot revert on it ("the randomization p is
       unavailable") and the line goes to `blocked`; a failing effect line goes to `blocked` too; at an interim read both
       give NOT_YET (verdict.py's NOT_YET exit comes before the `blocked` exit), and interim reads cannot KEEP;
     - at the **final** read it also writes the support p; if it cannot compute the effect it writes nothing, and the
       non-nullable line makes the verdict UNREADABLE (never KEEP).
     - So the support line is one test, at `max` 0.05. The pre-launch simulation reports the family-wise false-revert rate
       of all deciding lines over the schedule.
     - **Fixtures through the complete verdict path** (verdict.py on the real registration and evidence files): interim
       with the effect passing (NOT_YET), interim with the effect failing (NOT_YET), interim with a regression and the p
       withheld (NOT_YET, no revert), final with the effect missing (UNREADABLE), final improvement above the bar (KEEP-eligible), final at the
       bar (KEEP-eligible), final no change (INCONCLUSIVE), final regression with p ≤ 0.05 (REVERT), final regression with
       p > 0.05 (INCONCLUSIVE). The same pattern applies to B3's effect line.
5. **Positive controls in every read:** the read sees its own arm's leases, placements and site-chest deposits, and a
   fixture with a known answer passes before the first live reading.
6. **Exposure before verdict:** unexposed means INCONCLUSIVE early (owner 10-15).

### 6.2 The Paper arms (S1): does assignment have headroom on the workshop at all?
- **Scene:** a sandbox town cut from a real town's index snapshot (real stock and shortages), 5 bots, workshop@1 sited in
  the outer domain as the building tier sites it, 2 builder slots, the reserved site chest inside 16. **The bots come and go as on the fleet, at the town-job radius:** each bot is
  released to its own plan away from town and returns on a schedule drawn from the measured process (r3: 9.3% of time
  inside 16 / 12, stays median 1 min, p90 3; 42.8% of away, unflagged minutes followed by an arrival within 30 min; two
  together about 110 minutes per town-day), so no arm gets a world where everyone is present.
- **Arms, same scene, order randomized within pairs:** rotation (today's order, no leases); random leases (the placebo);
  greedy (deterministic: eligible bot nearest the segment, then most material, then affinity); oracle (a scripted lease
  writer with full information including the arrival schedule, on the v1 lease API only); frontier (real calls, costs
  through the guard); Haiku 4.5 as an optional sixth (C15).
- **Pairs:** pre-registered from the run-to-run SD of rotation runs, at least 6 (r3).
- **Measure:** witnessed cells per hour; time to the building tier's structure count; site-chest stall minutes.
- **r3's instrument check is kept:** a **starved** arm (no BUILD lease and no builder admitted for 30 min of each run) must
  lower cells per hour against rotation, and the census and the read must count the scene's known assignable minutes
  exactly. This proves the metric can see staffing; it does not prove allocation binds.
- **Gate to live:** the oracle beats rotation by at least the live canary's minimum detectable effect (paired permutation,
  p < 0.05). Otherwise the live canary does not launch and the line closes INCONCLUSIVE (headroom not demonstrated).
- **Which arm goes live, pre-registered:** the frontier goes live if its paired mean is at least greedy's minus one
  pre-registered margin (the rotation SD ÷ 2) and it beats random (p < 0.05). If the frontier is below that and greedy
  beats rotation, the owner is asked to choose greedy live (no API spend; C19). If neither beats rotation, nothing goes
  live.

### 6.3 The ordered build list

| # | step | what | tier / read | depends on | cost |
|---|---|---|---|---|---|
| **B0** | S0 capability fix | capability from each project's mode row bound to the running `code.version` (1.6); a capable open project with no placements stays open and stalled; `record_without_code` reported and excluded; the workshop adapter with next-visit assignable time (1.6); three fixtures (starved, reverted, disabled) | host tool, no slot; light two-engine review | — | ~0.5 day |
| **B1** | coopread | the daily cooperation census: per-container provenance bounds (1.1), the overlap sweep with its chance null (1.2), co-presence and arrivals (1.4), multi-builder project-days and site-chest supply (5.5). Positive controls built in (the verified-transfer attribution path; the overlap sweep). A fleetstatus line | host tool, no slot | — | ~1 day |
| **B2** | ledger-01 | `station` only; observe-only | **tier 2** (4 pools, ≥ 48 bot-h, licence not `rate`); exposure: the read emits one field, `station_exposure` = the pooled count of `station` entries if every drawn town has ≥ 20, else 0, registered as `exposure.min` 120 (r5: verdict.py reads one exposure field) (r4: furnace opens run 243-453 a day per town, about 10-19 an hour, so the slowest town reaches about 30 at best; comms' 200 per town would close unexposed by construction); L1-L4 | townindex (on the fleet) | ~2 days + Paper |
| **B3** | furnaceseen-01 | the drain skips a walk to a furnace a townmate found empty < 60 min ago | **tier 2**; exposure ≥ 20 skipped walks; gate: 0 drain walks to a furnace with a **valid cached empty** (a live `station` empty < 60 min old, no newer contrary evidence); first observations and expired records legitimately need a walk and are excluded; **effect line** (r4): the field is the **reduction** R = (control's change in repeat empty drains per bot-h) − (canary's change), positive = fewer repeats on the canary; registered as R's lower bound `>=` a bar of 0.25 × the canary pools' frozen pre-period repeat rate, `on_fail: REVERT` without `evidence` (6.1), fixture-tested for improvement, no change, worsening and undefined; so its KEEP is not "nothing objected". **Interval:** randomization over towns, as B7. **Power and reads** (r5, Claude r4): about 30 repeats per canary town-day are expected (870 a day over 13 towns), against 2.36x between-pool noise, so the registration's horizon is the shortest that a pre-launch simulation from the pre-period null gives 80% power for the bar, with reads at +180, +360 and that horizon; if no horizon ≤ 48 h reaches 80%, the plan records in advance that B3 closes INCONCLUSIVE: underpowered, and the change stays a no-harm candidate for a bundle; guards furnace output wait and smelt ingots. **Paper driver:** two bots, one empty furnace: A drains and finds it empty; B skips; a smelt then loads the furnace; B walks to it on its next drain | B2 promoted | ~1 day; worth up to 2.51 bot-h/day |
| **B4** | shop-01 | **the building tier's canary** (its registration, after its matset-01 and mats-01; townplan-01 and found-01 KEPT), with 2 builder slots, segment leases, the 5.2 interface and its `_build_seg` rows, and **this design's parts inside it**: the reserved site chest (5.3: every picker's exclusion and its composed test) and the **SUPPLY job (new code, owned here: withdraw a claimed part or raw item -> verified deposit into the site chest under the site-chest lease; never crafts; room re-checks; the loop guard and its chain test)**. Staffed by today's rotation: no leases yet | **tier 3** (the building tier's registration); this design adds **its own defect lines** (`evidence: defect`): **0 attributed ops on the site chest by any bot job other than SUPPLY and the builders, before its release** (unknown chain steps are reported, not counted); **the refusal loop**: 0 SUPPLY withdraws by a bot for an item in the 30 min after that bot's `no_room` for it (successful deliveries every 10 min are allowed and tested separately); 0 picker hits on a reserved container; plus report lines: multi-builder project-days, site-chest supply by non-builders, SUPPLY refusals by reason. So a REVERT names which part failed. They ship together: SUPPLY is the builder's only route from town chests to the site chest | building tier (r4: not B2; `progress` is a stage-2 mirror and no decision needs the ledger) | building tier's estimate + ~3 days for SUPPLY and the reservation |
| **B5** | S1 | the bot-side lease reader (one sort key, next-visit, binding checks), its composed chain and starvation tests (both engines), the host/bot eligibility parity test, the spend guard's fixtures, the Paper arms (6.2) | sandbox, no slot | B4 code | ~4 days; ~$1-3 of calls |
| **B6** | S2 shadow | real time, 3 towns with an open project for the whole 72 h (the building tier's queue), 3.9's gates | host + the operator's caller, no slot; a dedicated vendor workspace or key | B4 KEPT and promoted; B5's oracle gate passes; the next structures queued in the shadow towns | ~$2.70/day |
| **B7** | assign-01 live in 4 towns | leases delivered in 4 canary towns; **≥ 6 control towns with an open project**; ITT primary: witnessed project cells per randomized town-hour, **counting only projects with `builders_max` ≥ 2** (workshop@1; wall@1's segments; a single-builder house's cells are reported, not counted), with open multi-builder projects required across the **pre-period** as well as the horizon; **effect line: the lower bound of the town-level DiD of witnessed cells per town-hour `>=` an absolute bar** = 0.15 × the frozen pre-period reference rate (witnessed project cells per town-hour pooled over every eligible town's pre-period, frozen in the registration), which keeps r3's +15% while a single town's zero pre-period cannot make a ratio undefined; drawexposure's non-degenerate pre-period required at the draw; **REVERT line:** the upper bound `>= 0` with randomization support p ≤ 0.05 (6.1); **power** computed before launch by simulation from S0's pre-period null for the KEEP rule itself (the lower bound clearing the bar when the true effect is +30% of the reference rate), horizon the shortest giving 80%, refused beyond 7 days; the simulation includes the expected treatment downtime (empty generations from the caller or the Mac being unreachable, guard stops, the 36-h reconciliation stop) at the rate measured in the shadow; **exposure ≥ 40 next-visit assignable canary town-hours** (r4: B0's definition; the window's upper bound is about 7 per town-day, so 4 towns × 7 days ≤ about 195, and demand, material and other town jobs cut that further) and **≥ 30 leases honoured within TTL that end in a witnessed placement or a verified site-chest deposit**; licence `kind` = the `_role_*` rows; harm gates: deaths (two-death floor, 1.25x control), **rung completions per bot-h** and gather completions per bot-h DiD no worse than -10%, immobile and stuck DiD within the null, **a lease issued to a bot flagged at issue time = a defect REVERT** | **tier 3**; **holds the one canary slot for up to 7 days**; a 4-pool non-bag-fix draw (needs canary-report support and owner approval, r3 decision 3) | B6 gates; **B0's next-visit assignable time ≥ 30 town-h/day across the eligible towns for 48 h** (r4: about a third of the 90.4 upper bound; if it fails for 7 consecutive days after the workshop's promotion, B7 closes **INCONCLUSIVE: no assignable time**); **the next structures (the building tier's queue) KEPT and promoted before launch**, so every eligible town has work for the whole horizon. **If the power simulation refuses** (no horizon ≤ 7 days reaches 80%), B7 closes **INCONCLUSIVE: underpowered**, recorded with the Paper result, and does not launch | ~$3.59/day; guard earmarks $68.3 worst case at launch |
| **B8** | DEEP_MINER through the assigner | the `deep_miner` job becomes leasable (5.4) | inside the mineshaft canary first (its own acquire and cap are the assigner until then), then in assign-01's next run | mineshaft-safety; B7 | — |
| X1 | sighting-quality read | 4.4, for the expansion lane | host read, no slot | — | ~0.5 day |
| later | stage 2 talk on the showcase from the `progress` / `claim` / `lease` mirrors (comms 5); Contract Net requests (comms 6, if bag surpluses appear); a third builder (tier 1); a wider overseer (only with a cheaper model or a raised cap) | | | | |

**Timing.** B0, B1 and X1 any time (host, read-only). B2-B3 in the lane after the current queue. B4 on the building tier's
timetable. B5-B6 overlap B4's canary. B7 is 2-3 weeks out at the earliest.

**The horizon problem, named.** A workshop may finish in a day. The ITT read then needs the next structure queued in every
eligible town, or the town-hours after completion carry no work and dilute the effect. B7 does not register until those
structures are on the fleet.

### 6.4 What closes each step (CLAUDE.md: done means read on the fleet)
- B0, B1, X1: merged, installed from a copy outside `/opt`, the fleetstatus line seen, SHIPPED in memory.
- B2, B3, B4, B7: KEEP / REVERT / INCONCLUSIVE recorded against the sha; teardown in three steps; memory says SHIPPED.
- B5, B6: their gate tables recorded as PASS or FAIL in STATE with the decision they lead to.

---

## 7. Owner questions

**Answered 10-23 ~13:30Z, designed to:**

| # | owner answer | what this design does | where the evidence pushes back |
|---|---|---|---|
| C11 | a frontier model (Claude or GPT) is the overseer; shadow first, compared against what the bots did; then live in a few towns | 3.2, 3.9, B6, B7 | the comparison with what the bots did is prediction (the mayor's measure); reported, not a gate. Live rests on the Paper arms and the effect line |
| C12 | $150/month to start; design the cadence and a hard guard | 3.8: ≤ 48 calls per town-day, reservations before sending, the overseer stops (empty generations), never the bots | the cap fits shadow in 3 towns and live in 4; fleet-wide live (~$350/month on Sonnet 5.5, ~$175 on Haiku) does not |
| C13 | flexible jobs with a soft preference | 3.7 | agrees: smelt_town's 85% "no copper" |
| C14 | 2-3 bots build their town's workshop; the building tier owns the blueprint and the count | 5 | **start at 2**, a conservative choice: the build is asynchronous (three bots share the town-job radius about 16 min per town-day), so the reasons are fence and contention risk on a small structure with few segments, not co-presence |
| C14b | 1-2 deep miners per town, assigned by the job assigner | 5.4, B8 | none, provided the mineshaft design owns eligibility and safety |

**New, with recommendations:**

| # | question | recommendation | why |
|---|---|---|---|
| C15 | Which model: Claude Sonnet 5.5, Claude Haiku 4.5, or a GPT mid-tier | **Sonnet 5.5 at low effort for shadow and live; Haiku 4.5 as a Paper arm** | Haiku fleet-wide (~$175/month) is still over the cap; if it holds up in Paper it is the route to more towns with a modest raise |
| C16 | The 4-town live draw needs a 4-pool non-bag-fix draw and holds the slot up to 7 days | **yes, when B7 is ready** | the town is the unit; 4 canary + 6 control eligible towns |
| C17 | Build B0, B1 and X1 now (host, read-only, no slot) | **yes** | S0 must stop calling a reverted project open; the cooperation numbers become a daily line |
| C18 | ledger-01 (B2) and furnaceseen-01 (B3) in the lane after the current queue | **yes, B2 first** | the substrate, and the cheapest measured consumer |
| C19 | If Paper shows the frontier no better than greedy, run greedy live (no API spend) | **yes, greedy live, frontier stays in shadow** | a cheaper arm that works is still a cooperation result; the owner keeps the decision |
| C20 | Shadow also in towns without an open project (self-maintenance) | **no** | 1.5: the measured headroom there is small; it would repeat the mayor at a cost |
| C21 | A dedicated vendor workspace or key with its own spend limit at the cap | **required before the first call** | the vendor limit is the backstop if the guard has a bug |
| C22 | Reserve the workshop's site chest from every other picker, an exception to "withdraw checks every town chest" (10-16) and "toolkit searches every chest" (10-19) for one container per project | **yes** | without it other jobs drain or fill the site chest and SUPPLY stalls; the chest is released on completion, stall or abandonment |
| C23 | Where the model call runs: the caller on the operator's Mac (keys stay there), or a dedicated overseer-only key on 10.0.0.31 | **the Mac for Paper and shadow; decide before live** | the Mac keeps the keys with the operator; a key on the fleet host is more robust for a 7-day live run but moves a secret |
| C24 | (r5: no longer a choice) SUPPLY and the reserved site chest ship inside shop-01 with this design's own defect lines | **inside** | building-tier r2's builder draws only from the site chest or its bag, so a split would starve it |

---

## 8. Reviews

The prompts and full texts are in `cooperation-tier-reviews-2026-10-23.txt`.

**Round 4 (r4, 9f989d56): Codex CHANGE (3 P1, 2 P2); Claude CHANGE (2 P1, 6 P2, 7 P3).** All of it is taken into r5:
- **Reconciled with the sibling designs on origin** (Claude P1): workshop@1 in the outer domain; one maker
  (`make_material`), so SUPPLY moves and never crafts; one reserve (`BUILD_RESERVE`) under the building tier's claim set;
  site-chest units count as delivered against claims; SUPPLY ships inside shop-01 (C24 is no longer a choice); glass
  answered by matset-01; the `deep_miner` job with mineshaft-safety M8's record, cap, preconditions and rows; seal blocks
  drawn under the claim set; a role lease never ends a held record or lease.
- **Site-chest takeover** only when the holder's process is gone (Codex P1).
- **B7's lines** non-nullable and defined at every read, the support p withheld until the final read; fixtures through
  verdict.py (both P1).
- **Token counting** by the model's own counter on the exact request, failing closed (Codex P1, Claude P2).
- **Unfinished and held ops** under the shipped lifecycle: none in the window, figures unchanged, fixtures added (Codex P2).
- **B4's loop line** scoped to the 30 min after a `no_room` (both P2); its site-chest line counts attributed ops only.
- **Capability** bound to the running `code.version` (Claude P2); **the caller's reservation handshake** (Claude P2);
  **B3's interval, power and reads** (Claude P2).
- **Also:** the chain-start definition for the arrival gate; one world-read formula for open cells with `_build_seg`,
  `found_done` and `found_open`; B2's single exposure field; B7 counts multi-builder projects and needs them in the
  pre-period; the shadow earmarked; the prompt re-sized.

**Round 3 (r3, b41fc2f1): Codex CHANGE (3 P1, 5 P2, 1 P3); Claude CHANGE (0 P1, 6 P2, 7 P3).** All of it is taken into r4:
- **Site-chest lease** (Codex P1): ownership-safe generations, check-before-click, owner-only release, takeover after
  slack, a paused-holder test.
- **Capability** (Codex P1): bound to the bot's current incarnation; the on-then-reverted-restart fixture.
- **Completion** (Codex P1): decided by the builder's world re-read; placement rows measure production; a found-done row
  and the placement-before-log crash test.
- **Provenance scenarios withdrawn** (Codex P2); the verified-transfer control re-run through the chain predicate: 88 of 88.
- **Explore, events first** (Codex P2): 336 distinct rise events, each assigned once; 10 of 16,958 near the sighting.
- **Gather overlap** as bot-time union: 3.44 of 171.0 bot-h (Codex P2).
- **B3's effect line** with a direction, a bar and fixtures, and a Paper driver (both P2).
- **Spend:** a 3,000-token input ceiling; earmark $68.3 at 53 calls; extension funding; downtime in the power simulation
  (Codex P2, Claude P3).
- **S0's assignable time for next-visit leases** at 16 / 12 (upper bound 90.4 town-h/day); B7's gates reset from it, with
  a close rule (Claude P2).
- **Generation rules:** snapshot and lease generations, replies accepted up to 2 ticks late, abstain keeps leases,
  re-issue never extends, empty only on a failed due call (Claude P2).
- **BUILD** uses bag surplus only (Claude P2).
- **The arrival gate** per lease issue, 30 min, frontier v random (Claude P2).
- **B7's read schedule:** deciding lines only at the final read (Claude P2).
- **Also:** B4 no longer depends on B2; the `progress` and `lease` mirrors deferred consistently; B2's exposure pooled;
  explore figures aligned; C14's rationale corrected.

**Round 2 (r2, c324f097): Codex CHANGE (3 P1, 8 P2, 1 P3); Claude CHANGE (3 P1, 9 P2, 11 P3).** All of it is taken into r3:
- **The system prompt and snapshot** still forbade next-visit leases (both P1): rewritten and re-sized (3,497-3,820
  characters per town; prompt 3,408).
- **SUPPLY reserves** (both P1): bags give only deliverable surplus above their keep rules; town draws keep per-item
  reserves separate from the stock targets (which are bank caps); recipe inputs likewise; re-checked before consumption;
  composed tests.
- **The record fence** (Claude P1): the record holds transitions only (`record_gen`); counts are derived.
- **Provenance** (Codex P1): the observation chain with unknown changes kept as unknown: 78-161 of 629.
- **Site-chest serialization** (Codex P2): a 60-s site-chest lease per mutation.
- **Overlapped bot-time as a union**, the chance null labelled approximate; the drain's comparison caveated (Codex P2,
  Claude P3).
- **Explore** (both P2): attribution first, then classification; any route by bag delta; 12 of 16,958 near the sighting.
- **Furnace repeats** with session intervals and summed durations: 870, 2.51 bot-h; B3's gate scoped to valid cached
  empties, plus an effect line (both P2).
- **Presence at the town-job radius:** 9.3%, median stay 1 min, about 110 / 16 minutes per town-day together; used in
  Paper (Codex P2).
- **The guard:** month-only earmarks drawn down by settled calls; per-request settlement; complete-day reconciliation from
  the operator's export (no admin key on the fleet host); a token bucket instead of a bare daily cap (both P2).
- **Capability by `_<project>_mode` spawn rows**, not git ancestry (Codex P2, Claude P3).
- **B7:** the +15% kept as 0.15 × a frozen pre-period reference rate; r3's REVERT on an upper bound below 0 restored with
  randomization support; the `>=` encoding stated; the starved-arm control kept; an INCONCLUSIVE close if underpowered
  (Codex P2, Claude P2).
- **Also:** the unreachable-cell row now matches the host/bot split (a `no_stand` cooldown; a question to the building
  tier); SUPPLY's admission without leases; B4's own defect lines; B2's exposure from the measured rate; B6 needs open
  projects for 72 h; glass panes have no producer (the building tier decides); flagged-at-issue defined; the arrival gate
  against random; the reserved chest is an owner question (C22) and is released on stall; the `claim` mirror deferred and
  one authority for placements; the townindex API names; keys stay with the operator (C23).

**Round 1 (r1, 1a4c7139): Codex CHANGE (5 P1, 9 P2, 1 P3); Claude CHANGE (4 P1, 12 P2, 14 P3).** All of it is taken into
r2. The main changes:
- **Next-visit leases** (Claude P1): BUILD and SUPPLY issued to safe bots wherever they are, acted on at town, never causing
  travel; an arrival gate in the shadow, from the new measured arrival rate (42.8% within 30 min).
- **SUPPLY quantities** (both P1): `to_site` and `short_town`, net of placed cells, excluding the site chest, with reserves.
- **The reserved site chest** (Claude P1): every other picker excludes it; a composed test.
- **The spend guard** (Codex P1, Claude P2): reservations before sending, settled from billed usage, kept on timeouts;
  `max_retries=0`; automated reconciliation or stop at 36 h; a hard 48 calls per town-day with events pulling forward;
  re-asks budgeted; B7's horizon reserved at launch; a dedicated vendor key required.
- **Unreachable cells** (Codex P1): the bots never wait; the project can stall, and that is the building tier's named outcome.
- **Provenance** (Codex P1, Claude P2): per container, with valid bounds (79-150 of 629) and labelled scenarios.
- **Cross-funded cells** (Codex P1, Claude P2): replaced by site-chest supply by non-builders, plus a conservative bag-interval
  attribution.
- **Co-presence** (Claude P1, Codex P3): totals (about 394 and 102 min per town-day) beside the longest stretches.
- **Explore** (Codex P2, Claude P2): completion-aware, location-verified, one credit per gather: 13 harvests at the sighting
  in 16,958 runs; reframed as co-targeting and a sighting-quality question (X1).
- **Overlaps** (Codex P2, Claude P3): a complete sweep, incidence and time, and a chance null.
- **Also:** the GET_WOOD distinction restored; "every snapshot scored" became "compared for divergence"; a real-time shadow;
  lease binding and late-reply rejection; host/bot eligibility through the exported JS with a parity test; r3's exposure,
  power, census-extension and rung guards carried into B7; the effect line's registration fixture-tested and set against an
  absolute bar; the Paper scene reproduces arrivals; a pre-registered rule for which arm goes live; prior-art claims narrowed;
  S0 capability by build ancestry; ledger-01 scoped to `station` and the claim mirror; the stall-counter reset; the
  footprint question to the building tier; prices re-checked; the open-loop status in the header.
