# The cooperation tier: a frontier overseer as job assigner, the town ledger, and the first shared build (design r8, 2026-10-23)

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
the `deep_miner` job). **r8 is reconciled with building-tier r4 (0514d3b1) and mineshaft-safety r10 (b1afc0a8)**, read on
origin; 3.3 and 5.1-5.4 say what each design owns, 5.2 lists every ask of the building tier (A1-A7) and 5.4 the asks of
mineshaft-safety (M-a, M-b). **Stages B0a-B3 are fully specified (B0b, the workshop adapter, waits on the building tier's A4, A7, A9); points that matter only to B6-B9 are recorded as open items
for that stage, decided before it is built (owner gate).**

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
  (rounds 4-5) supersede them where a review found a fault (named in place).
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
- **Jobs:** BUILD(segment), MAKE (the building tier's `make_material`), DEEP_MINER, SMELT, BANK, FREE. A SUPPLY job is
  out of v1: building-tier r3's build visit withdraws its own bill (B9 if ever needed). Soft preference (C13): a bot's recent successes at
  a job are a tie-break, never a role.
- **BUILD and MAKE are next-visit leases:** issued to a bot wherever it is (if safe), acted on only inside its town-job
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
since no decision reads them (placements, leases and lease outcomes are read from their own rows and files). Material quantities are the building tier's (its claim set and
`bom_open`), never this design's. Reachability is never shared.

**6. The first shared project (C14, section 5): 2 bots build their town's workshop together, by segment.**
- Partition by **region** (segments of the open layer, monument-01's protocol), not by material: MineCollab's agents undid
  each other's work when split by material.
- **Start at 2 builders.** The prior art does not establish an optimum (VillagerAgent's construction task completed at 1,
  2 and 4 agents, slower at 8), so 2 is a conservative starting choice. The build is asynchronous, so co-presence is not
  the reason; the reasons are that each extra builder is another concurrent lease on a small structure (fence and
  contention risk), and a small workshop's open layer has few segments. A third is a one-number change.
- **The workshop is the building tier's workshop@1 in the outer domain** (22-44 blocks out); parts flow from the maker to
  the builders through a reserved site chest inside town, which every other picker skips, under the building tier's single
  claim set and reserve.
- Cooperation is measured as **multi-builder project-days** and **parts made by one bot and placed by another**, from
  witnessed placements and the site chest's index records.

**7. Measurement (section 6).** Effects come from the world: server-witnessed placements, RCON re-reads at the end, index
observations and bag deltas. Intent rows never count. The live canary's registration carries an **effect line** that fails
to INCONCLUSIVE (verdict.py v25: a `REVERT` own line without `evidence` lands in `blocked`, never reverts and never falls
through to KEEP), so KEEP cannot mean "nothing objected".

**8. Build order (6.3):** B0a S0's capability fix -> B1 coopread -> B2 ledger-01 -> B3 furnaceseen-01 -> B4 shop-01 (the
building tier's canary, 2 builders, with this design's site-chest serialization and reads) -> B5 lease reader + Paper
arms -> B6 overseer shadow (3 towns, real time) -> B7 assign-01 live in 4 towns -> B8 DEEP_MINER through the assigner
(-> B9 SUPPLY, only if needed).

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
  that one pair carries both the 121 units removed and the 14 units added. Nothing is dropped from the accounting.
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

| job | runs | starts inside a townmate's run of the same job | expected by chance (approx.) | overlapped bot-time (r3) | no_effect+failed: starts inside another run v other starts |
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
  carries `code.version`): a bot is capable only if **its newest mode row for that module says `on` and carries the
  bot's current `code.version`**. A flag-off restart on the same version emits an `off` mode row (not capable); a rollback
  to a build that emits no mode row, or to an earlier sha, leaves the newest mode row on another version (not capable).
  - **Lookback (r7, Claude r6).** Mode rows are written once per process (`bot.once('spawn')`), and S0 looks back 24 h, so
    a bot up for more than a day would have no mode row in view and read incapable: a false zero. So S0 keeps **each bot's
    newest mode row per module (version, on/off) as persistent state across ticks**, seeded once by a walk back to each
    bot's newest spawn, **bounded** to the time since the last fleet-wide restart and never touching 10-07 (which
    `estelemetry` refuses); a bot whose spawn is not found in that bound reads VOID (never incapable), and the state is then
    updated by every new mode row; a bot whose newest row's version differs from its current version is not capable until
    a new mode row arrives.
  - **Positive control (an alarm line, not a census void):** the same reader run on `_townindex_mode`, over the bots whose
    build carries townindex, must find about 100% capable; a shortfall raises `StaffCensusCapability` in the fleetstatus
    header and marks the capability column suspect, without voiding the census.
  - **Town capability per minute:** at least one unflagged, capable bot inside 16 h / 12 v (staggered restarts never make
    a whole town flip).
  A capable project whose
  record is open but which places nothing is kept as **open and stalled** with zero production, so a starved project stays
  visible. A record without a capable mode row is `record_without_code`: reported, excluded from assignable time. Fixtures:
  capable-but-starved, disabled (mode row `off`), **`on`, then a restart on the same version with the flag off**, and
  **`on`, then a restart into a reverted build that emits no mode row** (each must read not capable), and **a bot whose only
  mode row is older than the lookback, still on that version** (must read capable).
- **Assignable time, redefined for next-visit leases (r4, Claude r3).** S0 counts a minute assignable at 48 blocks with
  the material in a bag. The workshop adapter (B0b) counts it when a project is open with an unclaimed, dependency-complete
  segment and a free slot (or a part short for MAKE), and **at least one unflagged bot is inside the town-job radius (16 h /
  12 v)**, with the segment's bill available under the claim set.
  - **Its inputs (r7, Claude r6), each named:** per segment, the newest `_build_seg` row (A4); failing that, the record's
    cells minus witnessed `_build` rows, labelled an **upper bound**; dependency completeness from the same; slot and segment
    liveness from the lease files (`project-<home>.<plot>.slot<k>.lease.g<N>`, `...seg<id>.lease.g<N>`) by their own
    liveness rule; claim-set availability by calling the building tier's exported spendable function through node (ask
    A9); "a part short" from `make_material`'s own exported predicate.
  - **A known-answer fixture:** a recorded town with one project, two dependency-complete segments, one slot held and the
    bill available, at minute marks with 0, 1 and 2 unflagged bots inside 16 / 12, gives exactly the expected assignable
    minutes; the same fixture with the claim store unavailable reads VOID, not zero. Its **upper bound from this window** (`data/r4b.out`; an open project with demand and
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
  request only while holding a **reservation id** that the host's guard wrote and fsynced for that one attempt (3.8 rule 2),
  **bound to the hash of the exact request the host built**: it asks the host for the id, the host reserves the worst case
  and returns the id and the request, the caller counts the exact request, refuses to send anything whose hash differs,
  sends, and settles by id with the response's usage. If the host is unreachable the caller does not send; a retry is a new id. Tests: a partition after the
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
    the caller is unreachable, or the guard refuses the call **for money** (3.8). A tick with no call due is not a failure,
    and neither is a call not made because the request is over the token ceiling or cannot be counted (3.4): those keep the
    re-validated leases, bounded by their TTL.
- The local gpt-oss foreman of r3 is not built: C11 replaces it. The validator, the arms and the guard are model-agnostic,
  so gpt-oss (no API cost) stays an owner option.

### 3.3 The job set

Reconciled with the sibling designs on origin (r6): **building-tier r3 (7689a028)** and **mineshaft-safety r5 (248be79e)**.

**What changed with building-tier r3.** Its build visit now **withdraws its own segment's bill** under the claim set, from the
reserved site chest first, else from any fresh, known town container, and `make_material` deposits claimed parts into the
site chest when it exists (its §4.6 P2, CHAIN-1). So shop-01 needs no supply job, and the start-up deadlock both round-5
reviews found in r5's SUPPLY (no `to_site` before a builder's first visit, and no BUILD before material is staged) cannot
arise. **SUPPLY is therefore out of v1** and is a later, optional stage (B9 below), decided before it is built.

| job | what the bot does | eligibility (pure, exported by the owning module; host part / bot part) | cap per town | released when |
|---|---|---|---|---|
| **BUILD:<seg>** | the building tier's build visit: take a slot and the segment lease, claim the segment's bill, withdraw it (site chest first, else town containers), place what the world shows open, return the rest | building tier `buildEligible`: host = the segment unleased and its `deps` complete, a free slot, the bill available under the claim set (site chest, town stock or bag), no flag, health > 10; bot = a stand reachable by the walk probe | `builders_max` 2 (shop-01, C14) | segment done, lease lost, TTL, refusal, maintenance pre-empts |
| **MAKE** | the building tier's `make_material` (parts from town stock at a workshop furnace, deposited into the site chest when it exists) | its own admission (a part short in the admitted bill, inputs above `BUILD_RESERVE`, the town's materials lease free, the bot's slot room) | 1 (the materials lease: one maker per town) | nothing short, lease taken, refusal |
| **DEEP_MINER** | mineshaft-safety M8's `deep_miner` job | mineshaft-safety's preconditions (5.4) and its acquire under the cap | 2 (theirs) | its own lease end |
| **SMELT** | smelt_town (copper, iron) | smeltjob's existing admission; the workshop's furnaces are reserved for `make_material` | 1 | nothing to smelt (releases at once) |
| **BANK** | town_deposit as today (the site chest is excluded, 5.3; parts are always bankable) | towndeposit's existing admission | — | nothing bankable |
| **FREE** | the bot's own plan | — | at least 1 per town | — |

- **One stock policy, the building tier's:** its claim set, `BUILD_RESERVE` (cobble 256, logs 512, planks 64, sticks 64,
  copper ingots 256, sand 16, torches 32) and the never-inputs set (the iron ladder, every tool, the kit's sticks). This
  design adds no reserve and no quantity of its own; the snapshot carries the building tier's `bom_open`, the parts it
  reports short, and the claim state.
- **Bag surplus (an ask of the building tier, 5.2):** a build visit should take from the bag only what it holds above the
  keep rules (the iron ladder, the scaffold reserve, the stockpile allowance, the tool kit, the bag allowance), so a
  builder never places its escape blocks. Composed test: a builder holding exactly its protected minimum places nothing
  from its bag, and its escape chain runs unchanged.
- **Not leasable:** general MINE (junkwell-01: more mining sent bots into sealed pockets and lava; only DEEP_MINER, under
  the mineshaft design's safety); RECALL (29% `home`); GATHER as a role; explore; SUPPLY (B9).
- **Maintenance always outranks a lease** (r3's starvation rule): bag-full, spent-tool and no-usable-pickaxe orders and
  every reflex rank above any leased job.

**B9, SUPPLY (deferred; decided before it is built, owner gate).** If the shop-01 read shows builders spending much of
their visits withdrawing, a SUPPLY job (a non-builder stages claimed parts and raw items into the site chest) is designed
then. The points the rounds already settled, recorded so they are not lost:
- it moves, never makes (`make_material` is the one maker);
- it needs **one project claim taken at admission** covering the remaining bill, with site-chest stock credited against it
  and segment claims as sub-claims, and "available to this project" = spendable + the project's own uncredited claim;
- with no fresh builder read of a segment, its demand is bounded by the frozen plan's bill for the unverified cells;
- it stages under the site-chest lease (5.5), with the room re-check before the withdraw and the deposit and a 30-min
  per-item cooldown after `no_room`;
- composed chain tests: a fresh project with an empty site chest and parts in town chests, and the same after 2 h with no
  builder visit.

### 3.4 The snapshot and the reply
- **The live snapshot** comes from the shipped index fold (`townindex.mjs` `readIndex(dir, hk, world)` with
  `indexStateOf` and `indexHolding`, via node on the host: known / stale / dirty / unknown per container, world-checked;
  `ok: false` means every container is unknown, so no stock is held and no claim can be met from town stock), the project record, and each bot's **completion-time** snapshot (a skill
  row's position and bag belong to its end; event rows to their emission). Unknown or dirty stock is never counted as held.
- **Per bot:** at_town, distance, dy, arrival rate in the last 24 h, health, carried kinds, key items, pickaxes, the last 3
  skills and outcomes, safety flags, successful runs per job in 24 h, and `eligible`: **the validator's filtered output** on
  host facts, so the model never sees an ineligible choice.
- **Project:** state, segments (holder, `deps` complete, open cells from the newest `_build_seg` row, A4), the building
  tier's `bom_open`, the parts it reports short, `stall_min`.
- **Input ceiling (r5).** Every request is counted **exactly as it will be sent** (system prompt, snapshot and request
  framing) with the selected model's own counter: Anthropic's token-counting endpoint for Claude, the model's published
  tokenizer for a GPT model. It must be at most **3,000 input tokens**, or the call is not made (logged; the tick keeps
  the re-validated leases). **If counting is unavailable, the call is not made** (fail closed); there is no heuristic
  fallback. That is what makes the guard's worst case a bound (3.8).
- **Size (synthetic, for costing only).** `tools/snapshot.py.txt` filled the fields from the window's real rows and the
  raw index at 10-23 10:00Z for all 13 towns, with a fixture workshop and invented `eligible` lists. It is not a faithful
  input: it ignores dirty marks, pools stale stock and pairs end-of-skill bags with start times. It sizes the call only:
  **3,497-3,820 characters, about 1.0-1.3k tokens** (r3 fields; r6 replaces the two SUPPLY quantities with the building
  tier's `bom_open` and short parts, of about the same size). The draft system prompt (`tools/system_prompt.txt`, r5: next-visit leases allowed, abstain with `gen`,
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
  `make_material`'s admission). Facts only the bot has (the walk probe, a fresh window) stay bot-side. A host fact that is unknown
  (a position older than 10 minutes, unknown stock) **fails** host eligibility. A parity test runs both halves on the same
  fixtures.

### 3.5 Claiming, next-visit leases and release
- **Delivery:** `/var/lib/mcai/_pool-<pool>/roles-<home>.json`, atomic rename; `gen` persisted and monotone; `issued_at`;
  per lease `expires_at`, `world`, `project`, `record_gen`, `segment`, `snapshot_gen`.
- **Binding:** the bot honours a lease only if world, project and segment match what it reads and the project's
  `record_gen` (the building tier's record generation; 5.2: it changes only on transitions) equals the lease's. Otherwise it is stale and ignored.
- **Next-visit (r2, Claude r1 P1).** BUILD and MAKE leases are issued to safe bots wherever they are. The lease does
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
| the job runs out mid-lease (copper gone, segment done, no part short) | the job's own `no_effect` releases it; 30-min no-re-lease | stops a loop | smelt with no copper -> released, not re-leased in 30 min |
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
cache-write price (up to 2x). **No server-side model fallbacks in v1** (a fallback would bill another model's price), and
effort is set to `low` explicitly on every request (Sonnet 5.5 defaults to `high`).

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
| `station` (a furnace's input, fuel, output at an open, with the writing job) | every furnace open: drain, smelt, smelt_town; **a load session also writes a post-load entry** (comms 4.4's transition), and any smelt-type open is contrary evidence to an earlier `empty` | **furnaceseen-01** (the drain) | the drain skips the walk to a furnace a townmate found empty < 60 min ago, unless newer contrary evidence exists (comms 4.5) | **B2** (consumer B3): 870 repeat empty drains a day |
| `claim` (snapshot mirror of furnace, segment and slot leases) | one reconciler per town per 30 min (comms 4.3) | stage-2 talk only (every gate reads the lease files directly) | none | **deferred to stage 2** (r3: it changes no decision) |
| `progress` (a mirror of witnessed placements) | the reconciler, from the builder's placement rows | stage-2 talk only | none: **placements are measured from the builder's positioned, server-witnessed placement rows**; what remains open is decided by the builder's world re-read (5.2) | **deferred to stage 2** (r4) |
| `lease` mirror (issued / honoured / released + reason) | the reconciler, from the `_role_*` rows (the single source, 3.5) | stage-2 talk only | none | **deferred to stage 2** (r4) |
| material quantities | **not this design's**: the building tier's claim set, `bom_open` and short parts | the snapshot | — | — |
| `death`, `fire_site`, `hazard` mirrors | — | stage-2 talk only | none | deferred to stage 2 |

**Not written, on purpose** (comms 2.4): a bot's failure to reach something, fruitless visits, "sighting gone".

### 4.3 Protocol and gates
- The comms design's file, appender, generations, checkpoint, fold (`ledgerView(entries, now)`), rate rules and dead-end
  table (comms 4.3-4.6) apply unchanged.
- **Gates (comms 4.7, scoped to `station`), written as acceptance criteria the code review and Paper must meet** (r8;
  the mapping mechanics are better proven in code than in prose).
  - **Evidence at every open, never coalesced or capped.** At every furnace open, ledger-01 writes a raw **window record**
    (an observation id, the furnace, the bot, the time, and the server's input, fuel and output slots exactly as received).
    A **load** writes its own window record at the load's verifying view (a separate id and time), so a post-load
    `station` entry has its own evidence.
  - **Every window record maps to exactly one outcome:** a `station` entry naming it; or `coalesced_into: <entry id>`, whose
    slots equal that entry's (comms 4.4's identical-repeat rule); or a `_ledger_drop` naming it (the observation cap).
  - **L1 (a non-nullable own line, `evidence: defect`):** every window record has exactly one valid outcome; every `station`
    entry equals its window record slot by slot; every coalesced reference matches; and for drains, every window record
    equals the opening row's own window fields (`out`, `in`, `fuel`). **Denominator:** opening rows that read a window
    (for the drain, `out != '-'`; a lease that never reached the furnace is not an open).
  - **The opener set** is every `openFurnace` call site in B2's base: drain, smelt, smelt_town today, and `make_material`
    when mats-01 is on the fleet (its opens and loads write window records too). A comment-stripped structural test asserts
    that each call site writes a window record, and a mutant (one call site's write removed) must fail it.
  - **L2 (`evidence: defect`):** 0 unparsed lines, 0 dropped transitions, `_ledger_drop` ≤ 1% of window records.
    **L3** (a blocking line, not a defect): append p95 < 5 ms, < 2 MB per town per day, fold p95 < 50 ms. **L4:** no harm by
    the default gate.
  - **Paper:** an RCON `data get block` of the furnace **before the bot's first click** after the open, on at least 30
    sampled opens (drain and smelt), must equal the window record for every one; one mismatch fails. For smelt and
    smelt_town the row fields and the entry come from the same in-memory read, so this RCON check is their independent
    evidence. Fixtures: a correct entry; a wrong slot; a missing entry; a coalesced repeat; a capped drop; an empty → loaded
    session with a correct and with a missing post-load record.

### 4.4 Candidate X1 (expansion lane, not cooperation)
Explore toward a sighting rarely ends with iron gained near it, co-targeted or not (10 of 16,958 runs by any route, r4;
1.2). That leaves nothing for a heading claim to improve. Why the sightings yield so little is not established
here; a host read by sighting age and kind (X1) goes to the expansion lane (E0).

---

## 5. The first shared project: 2 bots build their town's workshop (C14)

### 5.1 Shape (reconciled with building-tier r3, 7689a028)
- **workshop@1** is the building tier's: a 7x5 enclosed shell on a 9x7 pad (stone-brick pad and step ring, plank walls,
  glass-pane windows, plank roof, a door and a light), sited in the town plan's **outer domain** (Chebyshev ≥ 22 and
  straight-line ≤ 44, in the pavilion's sector). r1-r4's ring@1 plot at d ≤ 13 is withdrawn: a 9x7 pad is free inside 16 in
  only 4 of 16 bench towns (building tier §4.3).
- **The reserved site chest stays inside 16** (the town plan's `work` plot), because it must be a town container the index
  sees. `make_material` deposits claimed parts into it; a build visit withdraws its segment's bill from it first, else from
  any fresh, known town container, and carries it out to the workshop at 22-44.
- The building tier owns the blueprint, `make_material`, the claim set, `BUILD_RESERVE`, the record, the slots and segments,
  the build visit and the structure count. This design owns who tries which job first (the role leases), the site chest's
  reservation and serialization, and the cooperation reads.
- **Segments with dependencies** (building tier §4.1): `pad`, `ring`, `wall-N/E/S/W`, `roof-edge`, `roof-inner`, `fit-out`,
  `door`; a segment is claimable when its `deps` read complete in the world. The four walls are where two builders work at
  once.
- **Builders: 2 in shop-01** (C14 and building tier Q5); a third is a setting once the 2-builder run is read.
- **Cooperation here has two forms**, both measurable (5.5): two builders on one structure, and **a maker and a builder
  who are different bots** (parts made by one, placed by another).
- **Asynchronous by construction:** each bot works in its own spells at town; the world, the claim set and the lease files
  are the protocol.

### 5.2 The interface with the building tier: what is adopted, and what is asked

**Adopted from building-tier r3 as it stands:** the record (`project-<home>.<plot>.g<N>.json`, the town plan's acceptance
walk and `link()`); admission slots (`project-<home>.<plot>.slot<k>.lease.g<N>`, k = 1..`builders_max`) before any segment;
segment leases (`...seg<id>.lease.g<N>`, TTL 4 min, reclaim after TTL + 60 s); a fresh lease generation per acquisition and
the fencing token (the lease's own N, the record generation) checked before every click; the project-wide mutation barrier
and the closer token; `buildEligible` split into host and bot parts; `segmentDone`, `segmentBom`, `concurrentOk`; the build
visit that withdraws its own bill; `make_material` depositing claimed parts into the site chest; the rows (`_build` per
witnessed placement, slot and segment lease rows, `_structure_complete`, the `_mats_mode` licence row); the reserved site
chest in the `work` plot (its §4.5).

**Asked of the building tier** (each an open item for it to accept or refuse; none blocks B0a-B3; A4, A7 and A9 gate
**B0b**, the workshop adapter, which is therefore built with shop-01 once they are settled):

| # | ask | why | needed by |
|---|---|---|---|
| A1 | the record generation changes only on transitions (a dependency opening, a fallback transition, a state change), never per placement or renewal; counts are read from the world | one builder's work must never invalidate the other's fence; the role lease binds to it as `record_gen` (3.5) | shop-01 |
| A2 | the build visit and `buildEligible` take from the bag only its surplus above the keep rules | a builder must not place its escape blocks (3.3) | shop-01 |
| A3 | every site-chest mutation (a `make_material` deposit, a build visit's withdraw and its `finally` return) holds the site-chest lease (5.5), and the build visit's leftovers return **to the site chest** | clean attribution of who fed whom, and no bank-then-fetch churn | shop-01 |
| A4 | one `_build_seg` row per build visit: the segment's open cells and `material_open` as just read from the world, plus `found_done` (a cell already done with no `_build` row) and `found_open` (a placed cell found missing) | the host cannot read the world, and the overseer's snapshot needs per-segment state | **B0b (the workshop adapter) and shop-01**, and B6 |
| A5 | **answered by building-tier r3 §4.1**: a failed walk probe is a `no_step`; only non-structural cells are ever waived (3 visits on different days); a structural cell that stays unreachable follows its stall row (72 h, then abandon, then re-site) | a named stall, never a silent one | — |
| A6 | `builders_max` ≥ 2 declared for wall@1's segments | B7's primary counts multi-builder work, and the workshop alone will mostly finish before B7's horizon | B7 |
| A7 | a `_shop_mode` (or per-blueprint) licence row per spawn, like `_mats_mode` | B0b's capability check for shop-01 (1.6) | B0b |
| A9 | an exported spendable function (`spendableFor(project, item)` under the claim set) the host can call through node | B0b's workshop adapter (claim availability) | B0b |
| A8 | **answered by building-tier r4 §4.1**: `buildEligible`'s host part counts the bill allocatable from the bag, the site chest or any fresh, known town container under the claim set; its CHAIN-1 tests an empty bag and no site chest | — | — |

**What the cooperation tier writes into the project:** nothing. It reads the record, the leases, the rows and the index, and
writes role leases and `_role_*` rows.

**Glass, answered** by building-tier r3: matset-01 raises sand's stock target to 64 and takes glass off the junk list,
`make_material` makes panes, and an unplaced window becomes a plank wall cell after 24 h (`window_shortfall`).

### 5.3 The reserved site chest
- The site chest is a town container in the plan's `work` plot (16 h / 12 v), so townindex sees every move. It is also where
  every other picker would otherwise reach: town_deposit, withdraw (every-chest search), toolkit (every-chest search), the
  smelt jobs, `make_material`'s input draw, and the town plan's `allocateHomes` (which would class it as a home, overflow or
  drain and let tidy empty it).
- **The siting file declares it reserved** (`townplan` plot `work`, cell role `site_chest`, `reserved: true`; adopted by the
  building tier §4.5), and every container picker excludes reserved containers: deposit and town_deposit targets, withdraw,
  toolkit and smelt searches, `make_material`'s inputs, `allocateHomes`, tidy and dispose. **Only `make_material`'s parts
  deposit and the build visit's withdraw and return touch it**, each under the site-chest lease (5.5).
- **A composed test:** a baseline town_deposit, toolkit, withdraw_pick and smelt_town run beside a stocked site chest leave
  it byte-identical by server read; then `make_material` deposits and a build visit draws and returns.
- A reserved chest is released when its project completes, **and also when it is stalled past the building tier's stall
  limit or abandoned**, so its material is not stranded; its contents then drain into the town plan's homes as any drain
  container's do.
- **This overrides two owner decisions** ("withdraw checks every town chest", 10-16; "toolkit searches every chest",
  10-19) for one container per project. It is owner question C22.

### 5.4 Deep miners (reconciled with mineshaft-safety r5, 248be79e; the details belong to B8)
- **The job is `deep_miner`** (3.3), M8's record in world facts under the keepout pid lock: `{bot, gen, phase, work_expires,
  renewals}` with phase `descending | branch | ascending | out | uncertified` (r5: `uncertified` is a recovery that ended
  the credit and the confinement; it still counts in the cap). **At most 2 records per town with phase ≠ `out`**, enforced
  by the acquire. Rows: `_deepmine` per phase change.
- **Preconditions and budgets are the mineshaft module's own predicate** (M8: health 20; F1 and F4 KEPT from the licence
  rows; the pickaxe-use budget for a certified stair or for cutting, including the 50 spare per cutting lease; a dedicated
  ore pickaxe; seal blocks; ≥ 6 free slots). The validator calls that exported predicate's host part through node (3.4)
  and never restates it, so the two cannot drift.
- **A role lease never ends or shortens a held `deep_miner` record, a segment lease or a slot**; it affects only who
  acquires next.
- **Asked of mineshaft-safety (open items for B8, owner gate):** (M-a) until B8 the skill's own acquire is the assigner
  (first eligible bot, under the cap); (M-b) seal-block withdrawals draw plain spendable town stock before mats-01 ships,
  and under the building tier's claim set after it, so the deep miner and the workshop cannot spend the same cobble.

### 5.5 What "built together" means, measurably
- **Multi-builder project-days:** a project-day on which 2 or more different bots placed witnessed cells of the same
  structure.
- **Site-chest mutations are serialized, ownership-safe (r4, Codex r3; ask A3).** Every `make_material` deposit and every
  build visit's withdraw and return holds the site-chest lease from before its pre-open to after its verifying re-open.
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
    hung but living holder blocks the site chest until the operator restarts it; the others simply skip the site chest
    (a build visit then withdraws from town containers; a maker deposits to town chests) with no waiting, and the read reports any site-chest lease held over 30 min. A reused pid makes `kill -0`
    succeed and blocks the takeover: that fails safe and lands in the same report.
  - A mutation that finds the lease held simply does not start; the bot's next decision is its own (no waiting inside
    the skill).
  - **Tests:** (a) SIGSTOP a holder after its check with a click about to be sent, past `until` + 60 s: no successor takes
    over while the process lives; on SIGCONT it finishes or releases under its own lease. (b) Kill the holder mid-mutation:
    a successor takes over only after the pid is gone, and the killed holder's partial step reads unknown in the chain.
    (c) A reconnect in the same process (same incarnation) is not a takeover.
- **Maker-to-builder units:** parts that one bot deposited into the reserved site chest (`make_material`) and a
  **different** bot withdrew on a build visit, from the site chest's observation chain (1.1's bounds, per container).
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
| the site chest full, missing or its lease held | the maker deposits to ordinary town chests and the build visit withdraws from them (building tier §4.6 P2); the read names the town |
| a part nowhere in town | MAKE is eligible (a part short); a short raw input is refilled by ordinary gathering and the deposit flows; the overseer reports `unstaffed: {job: BUILD:<seg>, why: no_source}` |
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
       p > 0.05 (INCONCLUSIVE).
     - **For B3 only the non-nullable effect line carries over:** B3 is tier 2, so it may KEEP early (with its
       Bonferroni-adjusted interval), and it has no REVERT line on its upper bound; "interim reads cannot KEEP" is B7's
       tier-3 rule.
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
- **A wall@1 scene too (open item for B5/B7, owner gate):** B7's primary will mostly count wall@1's cells (the workshop
  finishes in a few bot-hours per town, building tier §6.2), so the go-live gate also runs the arms on a wall@1 segment
  scene once the building tier declares its `builders_max` (A6).
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
| **B0a** | S0 capability fix (build now) | capability from each project's mode row bound to the running `code.version` (1.6); persistent newest-mode-row state with a bounded seed walk; a capable open project with no placements stays open and stalled; `record_without_code` reported and excluded; the `_townindex_mode` positive control as an alarm; fixtures: starved, disabled, flag-off restart on the same version, reverted build, an old mode row still on its version | host tool, no slot; light two-engine review | — | ~0.5 day |
| **B0b** | the workshop adapter | next-visit assignable time with its named inputs (1.6); stale or unavailable inputs read VOID, never zero; the known-answer fixture | host tool, no slot | the building tier's answers to A4, A7, A9; built with shop-01 | ~0.5 day |
| **B1** | coopread | the daily cooperation census: per-container provenance bounds (1.1), the overlap sweep with its chance null (1.2), co-presence and arrivals (1.4), multi-builder project-days and site-chest supply (5.5). Positive controls built in (the verified-transfer attribution path; the overlap sweep). A fleetstatus line | host tool, no slot | — | ~1 day |
| **B2** | ledger-01 | `station` only; observe-only | **tier 2** (4 pools, ≥ 48 bot-h, licence not `rate`); exposure: the read emits one field, `station_exposure` = the pooled count of **window records** (every open, uncapped) if every drawn town has ≥ 10, else 0, registered as `exposure.min` 50 (r8: **opens**, not lease sessions: 2,115 a day, 111-245 per town-day, `tools/furnace_opens.py.txt`, `data/furnace_opens.txt`; coalescing removes only 18 a day; the slowest admissible 4-town draw expects about 58 by +180 and the slowest town about 14, so the +180 tier-2 KEEP is usually open; a draw that falls short reads NOT_YET and can KEEP at the final read); **licence `kind`** = `_ledger_station`, a row ledger-01 writes per entry that the base cannot write (not `rate`); L1 and L2 as `defect` lines, L3 blocking, L4 the default gate | townindex (on the fleet) | ~2 days + Paper |
| **B3** | furnaceseen-01 | the drain skips a walk to a furnace a townmate found empty < 60 min ago | **tier 2**; exposure ≥ 20 skipped walks; gate (r8, acceptance criterion): the drain **logs its decision inputs at pick time** (the ledger fold offset it read, the `station` entry it relied on, and its own bot-local lit-seen time); the defect line counts only walks where **those logged inputs** showed a valid cached empty (a code bug); ledger entries the fold had not yet read when it picked, and lit-seen evidence, are reported, not counted; fixtures: an append racing the pick (reported, not a defect) and a lit-seen furnace (a walk, not a defect); first observations and expired records legitimately need a walk; **the order path** (`drainOrder`) consults the same cache, so a skipped furnace is not ordered and then refused (the drain bot-time report line would show it); **effect line** (r4): the field is the **reduction** R = (control's change in repeat empty drains per bot-h) − (canary's change), positive = fewer repeats on the canary; registered as R's lower bound `>=` a bar of 0.25 × the canary pools' frozen pre-period repeat rate, `on_fail: REVERT` without `evidence` (6.1), fixture-tested for improvement, no change, worsening and undefined; so its KEEP is not "nothing objected". **Interval:** randomization over towns, as B7. **Early KEEP is allowed, as tier 2 permits** (r6, Codex r5: verdict.py's tier rule can KEEP at +180 when every line passes, so a "final-only" rule cannot hold for a tier-2 run): the effect line is evaluated at every registered read with a Bonferroni-adjusted interval over the reads that can KEEP (tier 2 KEEPs only at +180 or at the final read, so k = 2: confidence 1 − 0.025), so the false-KEEP rate over the schedule stays at 5%. **Power and reads:** about 67 repeats per town-day are expected (870 a day over 13 towns; about 33 across 4 canary towns in 3 h), against 2.36x between-pool noise, so the registration's reads (+180, +360, and a last read) are the shortest schedule a pre-launch simulation from the per-town pre-period rates gives 80% power for the bar; if no schedule ≤ 48 h reaches 80%, the plan records in advance that B3 closes INCONCLUSIVE: underpowered. A fixture: a passing effect at +180 with every tier-2 prerequisite met gives KEEP (intended). **Report line:** drain bot-time per bot-h, DiD, so the claimed saving (up to 2.51 bot-h/day) is measured, not inferred from R (which falls mechanically when the skip fires). **Licence:** `kind` = a canary-exclusive `_furnace_seen_skip` row (not `rate`, so its defect line can revert and the tier-2 KEEP is open); guards furnace output wait and smelt ingots. **Paper driver:** two bots, one empty furnace: A drains and finds it empty; B skips; a smelt then loads the furnace; B walks to it on its next drain | B2 promoted | ~1 day; worth up to 2.51 bot-h/day |
| **B4** | shop-01 | **the building tier's canary** (its registration, after its matset-01 and mats-01; townplan-01 and found-01 KEPT), with 2 builder slots, segment leases, the build visit and the 5.2 interface, and **this design's parts inside it**: the reserved site chest's exclusions (5.3, with its composed test) and the site-chest lease (5.5, ask A3, with its tests). Staffed by today's rotation: no leases yet | **tier 3** (the building tier's registration); this design adds **its own defect lines** (`evidence: defect`): **0 attributed ops on the site chest by any bot job other than `make_material` and the build visit, before its release** (unknown chain steps are reported, not counted); **0 site-chest mutations without the site-chest lease** (from the mutation rows); 0 picker hits on a reserved container; plus report lines: multi-builder project-days, maker-to-builder units. So a REVERT names which part failed | building tier (r4: not B2; `progress` is a stage-2 mirror and no decision needs the ledger) | building tier's estimate + ~2 days for the reservation and the site-chest lease |
| **B5** | S1 | the bot-side lease reader (one sort key, next-visit, binding checks), its composed chain and starvation tests (both engines), the host/bot eligibility parity test, the spend guard's fixtures, the Paper arms (6.2) | sandbox, no slot | B4 code | ~4 days; ~$1-3 of calls |
| **B6** | S2 shadow | real time, 3 towns with an open project for the whole 72 h (the building tier's queue), 3.9's gates | host + the operator's caller, no slot; a dedicated vendor workspace or key | B4 KEPT and promoted; B5's oracle gate passes; the next structures queued in the shadow towns | ~$2.70/day |
| **B7** | assign-01 live in 4 towns | leases delivered in 4 canary towns; **≥ 6 control towns with an open project**; ITT primary: witnessed project cells per randomized town-hour, **counting only projects with `builders_max` ≥ 2** (workshop@1; wall@1's segments; a single-builder house's cells are reported, not counted), with open multi-builder projects required across the **pre-period** as well as the horizon; **effect line: the lower bound of the town-level DiD of witnessed cells per town-hour `>=` an absolute bar** = 0.15 × the frozen pre-period reference rate (witnessed project cells per town-hour pooled over every eligible town's pre-period, frozen in the registration), which keeps r3's +15% while a single town's zero pre-period cannot make a ratio undefined; drawexposure's non-degenerate pre-period required at the draw; **REVERT line:** the upper bound `>= 0` with randomization support p ≤ 0.05 (6.1); **power** computed before launch by simulation from S0's pre-period null for the KEEP rule itself (the lower bound clearing the bar when the true effect is +30% of the reference rate), horizon the shortest giving 80%, refused beyond 7 days; the simulation includes the expected treatment downtime (empty generations from the caller or the Mac being unreachable, guard stops, the 36-h reconciliation stop) at the rate measured in the shadow; **exposure:** one emitted field (verdict.py reads one) = the count of honoured leases ending in a witnessed placement or a verified `make_material` deposit, set to 0 unless the canary also has ≥ 40 next-visit assignable town-hours (B0's definition; the window's upper bound is about 7 per town-day), registered with `exposure.min` 30; licence `kind` = the `_role_*` rows; harm gates: deaths (the owner's death gate, two-death floor, 1.25x control); **rung completions per bot-h** and gather completions per bot-h DiD no worse than -10%, and immobile and stuck DiD within the null, each with `support` (randomization p ≤ 0.05 at the final read, as the effect lines) so a measured harm can revert; **a lease issued to a bot flagged at issue time = `evidence: defect`**. **Open items for B7 (decided before it is built, owner gate):** wall@1's `builders_max` (A6); B7 depends on wall-01 KEPT and promoted; it closes INCONCLUSIVE if fewer than 10 eligible towns (4 canary + 6 control) hold an open multi-builder project | **tier 3**; **holds the one canary slot for up to 7 days**; a 4-pool non-bag-fix draw (needs canary-report support and owner approval, r3 decision 3) | B6 gates; **B0's next-visit assignable time ≥ 30 town-h/day across the eligible towns for 48 h** (r4: about a third of the 90.4 upper bound; if it fails for 7 consecutive days after the workshop's promotion, B7 closes **INCONCLUSIVE: no assignable time**); **the next structures (the building tier's queue) KEPT and promoted before launch**, so every eligible town has work for the whole horizon. **If the power simulation refuses** (no horizon ≤ 7 days reaches 80%), B7 closes **INCONCLUSIVE: underpowered**, recorded with the Paper result, and does not launch | ~$3.59/day; guard earmarks $68.3 worst case at launch |
| **B8** | DEEP_MINER through the assigner | the `deep_miner` job becomes leasable (5.4) | inside the mineshaft canary first (its own acquire and cap are the assigner until then, ask M-a), then in assign-01's next run; **open items M-a, M-b decided before it is built (owner gate)** | mineshaft-safety; B7 | — |
| open items | **B4 (shop-01):** the exclusion list and composed test also cover furnace_drain's deposit target and plain deposit and withdraw; `mats_return` gets its own `by` tag and a rule for the site chest, so B4's defect line cannot revert the building tier's own recovery; a build visit's `finally` return goes to ordinary town chests when the site-chest lease is held, never kept as ballast. **B6:** the prompt's `caps.leased_max` becomes a validator-defined cap, and the DEEP_MINER description covers stair-cutting leases. **B4 / mats-01:** `make_material`'s furnace opens and loads write window records and `station` entries (4.3), or B3 could skip a furnace it loaded. **B8:** re-reconcile §5.4 and the §3.6 DEEP_MINER row with mineshaft-safety r10 (b1afc0a8: r9 removed peer coordination and peer waits; an `uncertified` record leaves the cap on the surface with `exitDebt` 0) | decided before each stage is built, owner gate | — | — | — |
| **B9** | SUPPLY (optional) | a non-builder stages claimed parts into the site chest (3.3's B9 notes) | **only if** shop-01's read shows builders' visits dominated by withdrawals; designed then, owner gate | shop-01 KEPT | — |
| X1 | sighting-quality read | 4.4, for the expansion lane | host read, no slot | — | ~0.5 day |
| later | stage 2 talk on the showcase from the `progress` / `claim` / `lease` mirrors (comms 5); Contract Net requests (comms 6, if bag surpluses appear); a third builder (tier 1); a wider overseer (only with a cheaper model or a raised cap) | | | | |

**Timing.** B0a, B1 and X1 any time; B0b with shop-01 (host, read-only). B2-B3 in the lane after the current queue. B4 on the building tier's
timetable. B5-B6 overlap B4's canary. B7 is 2-3 weeks out at the earliest.

**The horizon problem, named.** A workshop may finish in a day. The ITT read then needs the next structure queued in every
eligible town, or the town-hours after completion carry no work and dilute the effect. B7 does not register until those
structures are on the fleet.

### 6.4 What closes each step (CLAUDE.md: done means read on the fleet)
- B0a, B0b, B1, X1: merged, installed from a copy outside `/opt`, the fleetstatus line seen, SHIPPED in memory.
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
| C22 | Reserve the workshop's site chest from every other picker, an exception to "withdraw checks every town chest" (10-16) and "toolkit searches every chest" (10-19) for one container per project | **yes** | without it other jobs drain or fill the site chest, so the maker's staged parts vanish before the build visit draws them and the maker-to-builder read is unattributable; the chest is released on completion, stall or abandonment |
| C23 | Where the model call runs: the caller on the operator's Mac (keys stay there), or a dedicated overseer-only key on 10.0.0.31 | **the Mac for Paper and shadow; decide before live** | the Mac keeps the keys with the operator; a key on the fleet host is more robust for a 7-day live run but moves a secret |
| C24 | SUPPLY in v1 | **no** (r6): building-tier r3's build visit withdraws its own bill and `make_material` stages parts into the site chest, so SUPPLY would only add a second path; B9 if the shop-01 read shows a need | removes a job, its claim accounting and its start-up deadlock |

---

## 8. Reviews

The prompts and full texts are in `cooperation-tier-reviews-2026-10-23.txt`.

**Round 7 (r7, 67277995): Codex CHANGE (3 P2, 1 P3); Claude CHANGE (3 P2, 7 P3).** Taken into r8 (the operator's final
convergence steer: B2/B3 mechanics written as acceptance criteria for the code review and Paper):
- **L1** (both P2): a window record at every open and every load, never coalesced or capped, each mapping to one outcome
  (entry, coalesced reference or capped drop); the denominator is opens that read a window; the opener set from every
  `openFurnace` call site with a structural test and a mutant; the Paper RCON read before the first click, ≥ 30 samples.
- **B2 exposure** (Claude P2, Codex P3): recounted as opens, not lease sessions (`tools/furnace_opens.py.txt`: 2,115 a day,
  111-245 per town); `exposure.min` 50 and ≥ 10 per town; a short draw KEEPs only at the final read.
- **B3's gate** (Claude P2): the drain logs its decision inputs at pick time and only logged-valid-cache walks are defects;
  race and lit-seen fixtures; the order path consults the cache; k = 2 for the Bonferroni interval.
- **B0** (Codex P2, Claude P3): split into B0a (the capability fix, build now) and B0b (the workshop adapter, gated on A4,
  A7 and A9); a bounded seed walk; the positive control as an alarm.
- **Siblings:** A8 answered by building-tier r4; mineshaft-safety r10 and `make_material`'s station entries recorded as
  open items for B8 and B4.

**Round 6 (r6, ec2e65b2): Codex CHANGE (1 P2, 2 P3); Claude CHANGE (0 P1, 3 P2, 13 P3).** Taken into r7:
- **B0** (Claude P2): persistent newest-mode-row state across ticks (mode rows are once per process), the `_townindex_mode`
  positive control, town capability per minute, the old-row fixture; the workshop adapter's inputs named (`_build_seg` with
  an upper-bound fallback, the lease files, the claim function through node, ask A9) with a known-answer fixture.
- **B2's L1** (Codex P2, Claude P2): against the opening skill row's own window fields and ledger-01's raw window record,
  with completeness, a Paper RCON spot check, wrong-slot fixtures; L1 and L2 as `defect` lines, L3 blocking; its licence
  row; exposure from the measured furnace-session rate (135-331 per town-day).
- **Cheap P3s:** load sessions write post-load `station` entries; B3's relation to B7's read pattern stated; the B0 fixture
  list complete; the unknown pair's units corrected; A5 answered by building-tier r3; C22's reason updated; B3's drain
  bot-time report line; ask A8 (claim-aware town stock in `buildEligible`); the overlap outcome column relabelled.
- **Open items with an owner gate:** B4's exclusion list, `mats_return` tag and return path; B6's prompt caps; B8's
  re-reconcile with mineshaft-safety r7.

**Round 5 (r5, 7f7a1188): Codex CHANGE (2 P1, 3 P2, 2 P3); Claude CHANGE (1 P1, 5 P2, 9 P3).** Taken into r6:
- **SUPPLY's start-up deadlock and its claim accounting** (both P1): dissolved by building-tier r3, whose build visit
  withdraws its own bill and whose maker stages parts into the site chest. SUPPLY is out of v1 (B9); the settled points are
  kept for B9. MAKE (the building tier's `make_material`) becomes the leasable supply-side job.
- **Every ask of the building tier listed as an ask** (A1-A7), not as adopted (Claude P2); mineshaft's as M-a and M-b, with
  r5's `uncertified` phase and its own budget predicate (both P2).
- **Capability:** the newest mode row must say `on` on the current version; the flag-off restart fixture (Claude P2).
- **B3:** early KEEP allowed as tier 2 permits, with a Bonferroni-adjusted interval over its reads; the rate corrected to
  67 per town-day; a canary-exclusive licence row (Codex P2/P3, Claude P3).
- **Missing-`pre` ops** open from −∞, as the shipped index; none in the window (Codex P2).
- **Cheap P3s:** the prompt's `no_source` enum, typo and builder count; token refusals keep leases (only a money refusal
  empties); the reservation bound to the request hash; no fallbacks and explicit `low` effort; B7's single exposure field
  and the harm gates' evidence classes; leftovers return to the site chest (A3); L1 restated for `station`.
- **Later-stage items recorded as open items with an owner gate** (operator steer): wall@1's `builders_max` and a Paper wall
  scene (B5/B7), the B7 close rule, M-a and M-b (B8), SUPPLY (B9).

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
