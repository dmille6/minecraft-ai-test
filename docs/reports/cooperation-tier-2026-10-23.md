# The cooperation tier: a frontier overseer as job assigner, the town ledger, and the first shared build (design r1, 2026-10-23)

OWNER 2026-10-23 ~12:40Z approved designing the cooperation tier: "build cool structures, survive, and work together for
long periods of time". OWNER ~13:30Z answered C11-C14 (section 7). This is a design. No bot code was written, nothing was
deployed, and no queue, scheduler, manifest, world, bot or host service was touched. No frontier API was called.

It builds on, and does not redo:
- `overseer-assigner-design-2026-10-19.md` (r3: S0 census first, leases that only reorder, the validator, the ITT primary);
- `comms-design-2026-10-21.md` (r7.1: the typed town ledger, stage 2 chat, Contract Net later; owner C1-C10 yes);
- `jobs-mayor-spec-2026-09-29.md` and `shadow-mayor-plan-2026-10-03.md` (temporary duties, never fixed roles);
- the shadow-mayor STOP (10-06): the deterministic assigner tied leased-random on all four duties;
- `town-plan-2026-10-20.md` (ring@1, the siting file, townindex, the workshop plot);
- `ziggurat-mineshaft-2026-10-15.md` (monument-01's slot and segment leases, the first multi-builder protocol on paper).

**Parallel designs this one meets only through interfaces (section 5):** the building tier (`building-tier-1023`: the
workshop blueprint and the structure count) and mineshaft safety (`mineshaft-safety-1023`: the deep-miner job). Neither
branch existed on origin when this was written (14:40Z). Every field this document needs from them is named in 5.2 and
5.6 as a contract proposal, to be reconciled when they land.

**Sources (all read-only):**
- **Rows:** a fixed 24 h window, **10-22 12:14Z to 10-23 12:14Z**, ending at indexsearch-01's deploy (12:14:44Z), so no
  indexsearch canary row is in it. 13 shared towns (12 board/hive/placebo + isolated-b), 65 bots, 1,560 bot-h, 1,279,223
  rows, read with `scripts/lib/telemetry.Events` on 10.0.0.31 (full walk of the window, `nice -n 19`).
  - **Positive control, files vs Elasticsearch** (`estelemetry.EsEvents`, same window and pools): 1,279,199 ES docs
    (24 short: the 23:59Z rotation race) and every per-kind count used below identical (smelt_town 1,646 = 1,646,
    furnace_drain 2,237, toolkit 514, deposit 400, town_deposit 153, `_explore_toward_known` 17,112 v 17,113 parsed).
    `data/es_crosscheck.txt`.
  - **Builds in the window:** 1f5b4b4e, then c0fec812 (townindex-01 promoted 01:17Z), then 6e1afb52 (poolescape-01
    promoted 08:05Z); poolescape-01's canary ran on board-d, placebo-a and hive-b 01:48-08:05Z; drop16's restarts
    08:07-08:23Z. The counts are descriptive, not an arm comparison. Per-pool versions: `data/extract.json`.
- **Town index journals** (`town-index-<home>.g1.jsonl`, all 13 towns): from each town's first record (01:09-01:36Z;
  19:00Z 10-22 for the three townindex canary towns) to 12:14Z. 158 town-hours.
- **S0, the staffing census** (`staffcensus.py`, installed and ticking since 10-19; 0 of 13 rows void at every tick):
  its `--report 72` run on a **copy** of its output, so the live census was not written to. `data/s0_report72.txt`.
- **Scripts and outputs:** `docs/reports/cooperation-2026-10-23/tools/*.py.txt` and `data/`.
- **Open loop at the time:** indexsearch-01 was deployed 12:14:44Z on board-a and placebo-a and unread (its +180 is the host
  loop's). This analysis read no canary row, made no read and touched nothing of the canary; it is named because CLAUDE.md
  says no new analysis starts while a canary is unread. The coordinator, who launched this work, owns that loop.

---

## 0. Answers first

**1. Cooperation today is real but thin, and it happens through shared state, not through meeting (section 1).**
- **The town store is a real shared pool.** In 158 town-hours the index saw 412 container mutations, 398 attributable to
  one bot. Of the units withdrawn that had been deposited inside the window, **51-62% had been deposited by a different
  bot** (FIFO-LIFO bounds); 39 of the 46 town-by-item pairs that were withdrawn had another bot as a depositor. But the
  flow is small: 1,191 units in and 629 out, about 4 units out per town-hour, 75% of it metal.
- **Duplicated effort is small inside town and large outside it.** Leased town jobs overlap another bot 0-0.7% of the
  time (smelt_town 6.5%). The largest duplicate is **explore: 69.4 of 122.4 explore bot-h headed for a sighting a townmate
  had headed for in the 30 minutes before**, and those runs led to a harvest of the headed-for block half as often
  (0.65% v 1.23%; confounded by sighting age). The next is a furnace found empty again by a townmate (870 of 1,435 empty
  drains, about 2.5 bot-h).
- **There is no idle labour pool to draw on.** 28.4% of bot-time is inside a skill. Of the 71.6% outside one, the gaps that
  contain a trap, escape or watchdog row hold 521 bot-h (an upper bound for that class). Model latency is 66 bot-h (4.2%).
  At town, S0 counts 35% of bot-time as flagged (a trap row in the last 5 minutes).
- **Bots are rarely together.** A bot is at town 20.3% of the time, and more than 12 blocks below home's level 48.6% of the
  time. Two or more bots are at town together in 27.4% of town-minutes and three or more in 7.1%. The longest stretch with
  three together was 3-9 minutes per town per day. `home` succeeds 29% of the time (47% under the validator's filter).

**2. What is different from the shadow mayor (section 3.1).** The mayor assigned self-maintenance duties that any eligible
bot does equally well (no selection content), was scored on whether the bot did the duty anyway (prediction, not effect),
and had no actuator. The cooperation tier assigns **a task graph with real joint work** (the workshop's segments and bill of
materials, the town's deep-miner slots), **every snapshot is scored against a deterministic greedy assigner and a random
assigner on the same input**, the actuator is the r3 lease that only reorders, and the decision is an **effect** measured
from the world. The owner's choice of a frontier model (C11) is consistent with the prior art: LLM assigners beat greedy
only at frontier scale and only when the input carries the utilities (distances, bags, shortfalls), and 7B-class
assigners did worse than random.

**3. The job assigner (section 3).** Three layers:
- **the bot** keeps every eligibility rule, admission and remedy chain, and re-checks each lease fresh;
- **a host-side validator and lease writer** (deterministic, every 5 minutes, the r3 fencing) issues only leases that
  pass the same eligibility the bot runs, and computes the greedy and random baselines;
- **the overseer** (Claude or GPT, owner C11) chooses who does which open job, every 30 minutes per town, from a compact
  snapshot of about 1.0-1.3k tokens.
- **Jobs:** BUILD(segment), SUPPLY(item), DEEP_MINE, SMELT, BANK, FREE. Soft preference (C13): a bot's successful runs of
  a job in the last 24 h are a tie-break bonus, never a role.
- **No dead ends:** a lease is never a precondition. No bot waits for one, and a refused, ineligible or expired lease
  returns the bot to exactly today's decision path in the same tick.

**4. Spend (C12, section 3.8).** With Claude Sonnet 5.5 at low effort, a call is about $0.017 (2.5k tokens in, about 1.2k
out with thinking). One call per town per 30 minutes is 48 calls a day per town. Shadow in all 13 towns through the Batch
API is about $5.3/day ($159/month), which is over the cap, so **shadow runs in the towns with an open project, at most 6
(about $2.45/day)**. Live in 4 towns is about $3.3/day ($98/month). **Fleet-wide live would be about $320/month and does not
fit the cap.** The hard guard is a pre-call worst-case check plus a post-call ledger of billed tokens. At 100% of the
monthly cap the overseer stops: it writes an empty generation, which revokes every lease within 5 minutes, and the bots
carry on with today's behaviour.

**5. The ledger, stage 1 (section 4).** townindex-01 shipped as the stock store **without** the ledger (no ledger code or
file exists on the fleet). The ledger is now a small journal beside it, written by skills and holding only the facts that
have a consumer: `station` (furnaceseen-01: the 870 repeat empty drains), `progress` (witnessed placements: the
assigner's stall detection and the stage-2 talk), `claim` (a snapshot mirror of segment, slot and furnace leases), `lease`
(each assignment and how it ended), and `need` (derived: BOM minus index stock). It never stores reachability.

**6. The first shared project (C14, section 5): 2 bots build their town's workshop together, by segment, asynchronously.**
- Partition by **region** (segments of the open layer, monument-01's protocol), not by material. MineCollab's agents
  destroyed each other's work when they were split by material.
- **Start at 2 builders, not 3.** VillagerAgent's construction task gained nothing from 2 to 4 agents and lost from 4 to 8.
  3 is a later one-number change.
- Cooperation is measured as **two or more different bots placing cells of one structure on the same day, and cells built
  from material another bot delivered**, read from witnessed placements and the site chest's index records.
- The structure count is the building tier's (enclosed, roof, door, light). The claimable sub-task interface is in 5.2.

**7. Measurement (section 6).** Every effect is read from the world: server-witnessed placements, RCON re-reads at the end,
index observations, bag deltas. Intent rows never count. The live canary's KEEP needs a registered **effect line** that
fails to INCONCLUSIVE (verdict.py v25 semantics: a `REVERT` line without `evidence` blocks KEEP and cannot revert), so a
KEEP cannot mean "nothing objected".

**8. Build order (section 6.3):** S0 adapter fix -> coopread (daily census) -> ledger-01 -> furnaceseen-01 -> workshop-01
(the building tier's canary, with 2 builders) -> the lease reader + Paper arms (oracle, greedy, random, rotation) ->
overseer shadow (Batch) -> assign-01 live in 4 towns -> DEEP_MINE through the assigner when the mineshaft job ships.

**Where the evidence argues against an owner answer (section 7):**
- **C11:** a shadow scored by comparing decisions with "what the bots actually did" measures **prediction**. That is
  exactly the instrument that could not show the mayor a benefit. Keep it as a sanity and executability stage, but going
  live has to rest on the Paper arms and the decision on the live effect line.
- **C14:** "2-3 bots building together" will rarely mean side by side: three are at town together for at most 3-9 minutes
  a day. Recall is not in v1 (29% `home` success). Start at 2.

---

## 1. What cooperation looks like today, measured

Every count gives its denominator. Every zero sits beside a positive control from the same pass.

### 1.1 Shared chests: who feeds whom (`tools/indexflow.py.txt`, `data/indexflow.out`)

**Method.** A container's contents are known only from **server windows** (`obs` records at each open). A bot's mutation
writes a `dirty` mark before its first click and after its last, with one `op` id. Each op's effect is the difference
between the last observation before its first mark and the first observation after its last, attributed to that bot when
no other op on that container falls between them. Provenance of a withdrawn unit is assigned at town-by-item level, under
FIFO and LIFO (the bounds).

**Positive controls and integrity.**
- Every verified town_deposit transfer (88 of 88) names its own pre and verifying observations, and in all 88 the
  difference holds the deposited item.
- Of 399 consecutive observation pairs of a container that differ, **1** has no op between them. So the index sees
  essentially every mutator.
- Of 412 ops, 398 are attributable, 14 unresolved (no later open in the window), 0 ambiguous.

| | units deposited | units withdrawn |
|---|---:|---:|
| metal (iron, copper, gold) | 575 | 474 |
| wood | 417 | 103 |
| fuel | 73 | 48 |
| stone | 64 | 0 |
| tools | 6 | 4 |
| other | 56 | 0 |
| **all, 158 town-h** | **1,191** | **629** |

| provenance of the 629 withdrawn units | FIFO | LIFO |
|---|---:|---:|
| stock already there at the container's first index open | 479 (76.2%) | 349 (55.5%) |
| deposited in the window by **another** bot | 76 (12.1%) | 173 (27.5%) |
| deposited in the window by the **same** bot | 73 (11.6%) | 106 (16.9%) |
| unexplained | 1 | 1 |

- **Of the withdrawn units deposited inside the window, 51% (FIFO) to 62% (LIFO) came from another bot.**
- 46 town-by-item pairs were withdrawn; in **39** of them a different bot deposited that item in the window (metal 23,
  fuel 11, tools 3, wood 2).
- Every town has 2-5 depositing and 3-5 withdrawing bots.
- **Reading:** the containers already do what a bilateral handoff would, without anyone meeting. That is why stage 3's
  REQUEST/OFFER stays deferred (comms C9), and why the first project's supply goes through a site chest (5.3).
- **Limit:** the index started 01:09-01:36Z in 10 towns (19:00Z in 3), so most withdrawals draw stock that predates it,
  and the FIFO/LIFO split is a bound, not a trace of physical items.

### 1.2 Duplicated effort (`tools/coop.py.txt`, `tools/visits.py.txt`)

| what | measured (24 h, 13 towns) | positive control / denominator | reading |
|---|---|---|---|
| **Concurrent town jobs** (a run starting while a townmate is inside the same job; the drain keyed by furnace) | smelt_town 107 of 1,646 (6.5%); drain on the same furnace 5 of 2,237; toolkit 2 of 514; deposit 1 of 400; town_deposit 1 of 153; withdraw_pick, compost, dispose_well 0 of 78 / 76 / 159 | the same sweep finds the smelt_town overlaps | **the leases work**; as the comms design found (0-1%) |
| **Furnace found empty again by a townmate** (60 min, no non-drain session on it between) | **870 of 1,435** "is empty" drains (60.6%); after the same bot 38 | 678 non-drain sessions parsed; comms 10-21: 391 of 922 | about 2.5 bot-h a day (the empty drains' no_effect body time, 4.2 bot-h, times 0.6): **furnaceseen-01's target** |
| **smelt_town with nothing to smelt** | 1,399 of 1,646 "no raw copper" (85.0%), 4.6 bot-h no_effect | 115 successes; "no coal" now 10 | a job that ran out: the owner's C13 example |
| **Explore toward a sighting a townmate headed for in the 30 min before** | **9,270 of 17,070 explore runs, 69.4 of 122.4 explore bot-h**; then a harvest of the headed-for block within 10 min **60 of 9,270 (0.65%)** | fresh-for-the-town headings: 96 of 7,800 (1.23%); same bot's own re-heading 59.7% of headings | **the largest duplicate measured.** Confounded: shared sightings are the oldest and most visited. A host read by sighting age comes before any change (section 6.3, candidate X1) |
| **Gathers contested** (same block, a townmate's gather overlapping in time, end positions within 16 / dy 8) | 521 of 23,456 (2.2%), 515 of them dirt; 7.4 of 169.4 gather bot-h | contested success 55.7% v solo 45.3% (descriptive; location-confounded) | not a problem |
| **Mine runs with a townmate mining within 16 at the same time** | 2 of 6,494 | — | none |
| **The same item crafted by two townmates within 10 min** | 14 of 340 successful crafts (stone_pickaxe 10, furnace 4) | — | small |

### 1.3 Idle time: there is no spare labour (`tools/coop.py.txt`, `tools/gaps.py.txt`, S0)

| bot-time, 1,560 bot-h | bot-h | share |
|---|---:|---:|
| inside any skill row | 443 | 28.4% |
| of it: gather 171.0, explore 122.3, goto 96.5, surface 15.4, mine 9.5 | | |
| of it: all town jobs (smelt_town, drain, toolkit, deposits, withdraws, compost, well) | 18.4 | 1.18% |
| **outside any skill row** | **1,117** | **71.6%** |
| of it, gaps containing a trap, escape, watchdog or stagnation row (first matching class) | 521 | 33.4% |
| of it, gaps containing path-failure rows | 195 | 12.5% |
| of it, gaps containing town or order rows | 173 | 11.1% |
| of it, other event rows | 216 | 13.9% |
| model latency (the decision stream: 118,283 model calls) | 66 | 4.2% |

- The gap classes are an **upper bound** for each class: a 2-minute gap with one watchdog row counts as trap time.
- By length, the out-of-skill time sits in gaps of 10-60 s (444 bot-h) and 1-5 min (532 bot-h); 27 bot-h in gaps of 30
  min or more.
- **S0 at town, 72 h:** 976.9 at-town bot-h = 612.0 free + 24.6 in a town job + 340.3 **flagged** (trap 335.3, drowning
  2.5, death 1.8, low health 0.7). So 35% of at-town time already fails the validator's safety filter.
- **Reading:** a job assigner does not find idle bots; it reorders what busy bots do next. The r3 rule stands: the lease
  changes order, not capacity.

### 1.4 Travel and being together (`tools/coop.py.txt`, `tools/visits.py.txt`, S0)

- **Where bots are** (newest positioned event row per bot-minute, 93,557 of 93,600 minutes covered): at town (48
  horizontal, 12 vertical) **20.3%**; more than 12 blocks below home's level **48.6%**; distance from home median 55, p75
  92, p90 141, p99 246.
- **Movement:** goto + explore 218.8 bot-h (14.0%); minute-to-minute horizontal displacement at least 949 blocks per bot-h.
- **Visits:** a bot crosses into town a median 105 times a day, and the median stay is 2 minutes. That is mostly passing
  the 48-block edge, not visiting.
- **Together:**
  - town-minutes with 0 / 1 / 2 / 3 / 4 / 5 bots at town: 6,403 / 7,196 / 3,798 / 1,136 / 178 / 9 of 18,720;
  - two or more at town together **27.4%**, three or more **7.1%**;
  - a townmate within 16 blocks (dy 8) in **9.2%** of bot-minutes;
  - **the longest stretch with two or more at town was 8-29 minutes per town per day, with three or more 3-9 minutes.**
- **Recall:** `home` succeeded 343 of 1,165 times (29%); under the validator's filter 84 of 177 (47%). RECALL's r3 gate is
  70%, so it stays out of v1.
- **Reading:** "work together" here has to mean **contributing to one structure through its record and its site chest**,
  in the hours each bot happens to be at town (stigmergy, as TERMES did), not standing side by side.

### 1.5 What the deterministic fixes already took

| town supply refusal | 10-20 (town plan, 24 h) | this window | what took it |
|---|---|---|---|
| toolkit "no town container holds N iron ingots" | 428 of 660 (64.8%) | **101 of 514 (19.6%)** | toolkit-03, townindex-01 (indexsearch-01 is live) |
| smelt_town "no coal" | 441 of 1,582 (27.9%) | **10 of 1,646 (0.6%)** | smeltfuel, the coal/iron banking decisions |
| withdraw_pick "no usable pickaxe" | — | 38 of 78 (48.7%) | (small volume) |

The overseer census (10-19) found its headroom in C4 (fuel) and C7 (iron). Both are now mostly gone, taken by deterministic
rules, as it predicted. **The assigner has no self-maintenance headroom left to take. Its only job is the joint work.**

### 1.6 S0 today: nothing to assign, and one instrument bug
- 72 h, 13 towns, 911 valid town-hours (296 of 11,232 town-slots void: isolated-b's census history starts later).
- **Assignable town-hours: 0.** No multi-bot project exists on the fleet.
- **Instrument bug:** treefarm shows as **open** in board-a and hive-c for 71.9 h with 0 builder visits. treefarm-02 was
  REVERTED on 10-19; its record files remain, but its code is not in the fleet build. S0 calls a project open from its
  record alone. **Fix (B0):** open requires the record **and** a row of the project's own kind from that town's build in
  the last 24 h, otherwise `record_without_code`, reported and excluded.

---

## 2. Prior art (searched 10-23; papers, repositories and their issue trackers)

Read through fetch-and-summarise tools, so some figures are second-hand; "approx." marks figures read off plots.

| work | mechanism | what was measured | real v claimed | lesson taken |
|---|---|---|---|---|
| **Project Sid / PIANO** (arXiv 2411.00114; repo altera-al/project-sid) | ~10 concurrent modules, a bottlenecked controller so speech matches action | specialisation: 30 agents × 3 runs, roles labelled from the agents' *stated* goals, cross-checked with actions; **tax: 29 agents × 4 repeats, from real chest deposits** (about 20% of inventory down to 5-10% after an amendment); religion/memes: 500 agents, one run, keyword counts in speech | the tax result is action-measured but small-n; the 1,000+ agent run was not analysed; **no code released** (the repo holds a PDF and a video); the paper itself says agents lacked the spatial reasoning for collaborative building | judge on actions; measure deposits as Sid did; no evidence on building |
| **Voyager** (arXiv 2305.16291; MineDojo/Voyager) | one GPT-4 agent, skill library, curriculum, self-verification | removing self-verification: -73% items | code public; a third-party trial (JVP15/Voyager-LLM-Trials) found only GPT-4-class models got far; issues #185/#186 mineflayer crashes, #194 pickle RCE in shared checkpoints | the world check matters more than the planner: ledger facts are world reads |
| **Mindcraft / MineCollab** (mindcraft-bots/mindcraft; arXiv 2504.17950) | pairwise chat (`!startConversation`) | success "from up to 90% down to less than 30%" from 2 to 5 agents; detailed plans in chat cost >15%; construction blueprint score Claude 3.5 0.36, Llama-8B 0.00; split by material and tool; agents destroying another's stone layer | code public; issues: #30 two bots echoing "What should I do now?", #786 a stuck conversation makes an agent "look dead", #790 self-silencing, #780 cost and "discuss nonsense" | no job negotiation in chat; each cell one owner; never split by material |
| **MineLand** (arXiv 2403.19267) | limited senses, physical needs | 64-128 agents is simulator throughput; cooperation shown on one 2-agent task (about 20% fewer iterations) | the scale claim is not a cooperation result | cooperation evidence covers 2 agents |
| **TeamCraft** (arXiv 2412.05255) | imitation-trained VLA, 2-4 agents | building: centralised 7B 0.42 success, decentralised 0.00; 4 agents 0.02-0.04; "frequently ignoring the fourth agent" | learned policies with full observation, not an LLM over skills | an assigner must cover every bot explicitly |
| **VillagerAgent / VillagerBench** (arXiv 2406.05720) | an LLM task DAG + controller + a shared State Manager | cooking 73.75% v AgentVerse 29.75%; **one construction task: 1 / 2 / 4 / 8 agents -> 100 / 100 / 100 / 66.6% completion, efficiency 12.96 / 17.75 / 17.41 / 12.45 %/min, balance 93 / 82 / 56%** | code public; issue #10: a subtask given to two agents lost its dependency links (fix unmerged) | **2 builders is the measured sweet spot**; the State Manager is the ledger; test the graph split itself |
| **MindAgent** (arXiv 2309.09971) | one central LLM dispatcher | CuisineWorld coordination 0.67-0.69 for 2-4 agents; level 3: GPT-4 0.686, Claude-2 0.31, LLaMA-2 0, GPT-3.5 0 | — | central dispatch worked only at frontier scale |
| **Centralised v decentralised LLM planners** (Chen et al., arXiv 2309.15943) | four multi-robot tasks | dialogue 0-52.5%, central 15-90%, central + local check 57.5-100% (at ~21x tokens on one task); dialogue agents "repeat what previous agents said" | — | central plan plus a local executability check: the validator + bot re-check |
| **LLM v heuristic assignment** (arXiv 2510.23824, grid, 2-6 agents) | makespan | optimal 13.93; GPT-4.1 with distances 15.12; GPT-4.1 without 17.67; greedy 17.93; random 20.54; LLaVA 27.98 | — | **a frontier model beats greedy only when the input carries the utilities; a 7B model is worse than random.** The snapshot must carry distances, bags and shortfalls |
| **Gerkey & Matarić 2004** (IJRR 23(9), MRTA taxonomy) | ST-SR-IA is optimal assignment; greedy is within half of optimal | — | classic | an assigner tying random means the utilities had no signal, not that the algorithm failed: the mayor |
| **Contract Net** (Smith 1980); **blackboards** (Nii 1986) | announce/bid/award; typed shared entries with a control component | — | classic | already in the comms design (stage 3, the ledger) |
| **Generative Agents** (arXiv 2304.03442) | word of mouth | the party spread to 13 of 25; 5 of 12 invited came; 1.3% hallucinated answers | — | intending to come is not coming: measure arrival |
| **TERMES** (Werfel et al., Science 2014) | construction coordinated only through the structure (stigmergy) | — | — | matches 1.4: bots coordinate through the record, not by meeting |
| HAS (arXiv 2403.08282), S-Agents (arXiv 2402.04578) | multi-agent Minecraft | HAS 0.76 v Voyager 0.21; S-Agents' tree beat chain and graph | **claimed** (HAS: no code, single-agent baselines); S-Agents a workshop paper | not relied on |

**Cross-cutting:**
1. Every action-measured Minecraft result gets worse past 2 agents (MineCollab, TeamCraft, VillagerAgent).
2. Central assignment beat chat negotiation wherever both were measured.
3. Central LLM assignment worked only at frontier scale, and only with the utilities in its input.
4. Chat coordination fails in repeated, known ways (echo loops, stuck conversations, self-silencing, cost). A typed ledger
   removes the class.
5. No Minecraft LLM paper measured a split **by region or layer**. The partition here (monument-01's segments) is
   therefore this project's own claim, and it is tested in Paper before any canary.

---

## 3. The job assigner (the overseer's first real job)

### 3.1 What is different this time

| | the shadow mayor (10-03..10-06) | the cooperation tier |
|---|---|---|
| work | self-maintenance duties (free a bag, restore a pick, get wood, get iron): **any eligible bot does them equally well** | a **task graph with joint work**: segments of one structure, a bill of materials, the town's deep-miner slots. *Which* bot matters (where it is, what it carries, what it did yesterday) |
| headroom | ~180 bot-h/day unforced FREE_BAG gap, later taken by per-bot fixes | the project's cells and its supply; 0 today (S0), so nothing is built before the project exists |
| who decided | a deterministic rule | the owner's frontier overseer (C11), **scored on every snapshot against a deterministic greedy assigner and a random assigner on the same input** |
| actuator | none (shadow only) | the r3 lease: reorders the bot's own job list, re-checked by the bot |
| score | concordance: did the bot do it anyway (prediction) | an ITT **effect** from the world (witnessed cells per randomized town-hour), with the effect line that blocks KEEP |
| inputs | world facts with unknown banks | townindex stock (known / stale / dirty / unknown), the project record, bag snapshots |

**On C11 (a frontier overseer because deterministic tied random).** The mayor's tie does not show that a frontier model
will do better. It shows the duties had no selection content: Gerkey & Matarić's point that assignment is only as good as
its utilities. Where the utilities are in the input, the prior art supports the owner: GPT-4.1 with distances beat greedy
(15.1 v 17.9 makespan), and central LLM dispatch worked only at frontier scale. So the design takes C11 as given and adds
two things that make it testable: the snapshot carries the utilities (distance, at-town, bag contents, BOM shortfall,
preference), and a greedy and a random assignment are computed on every snapshot, so "frontier beats greedy beats random"
is a measured claim, not an assumption.

### 3.2 Architecture

```
  bot (every decision)            host, every 5 min per town               overseer, every 30 min per town
  ─────────────────────           ─────────────────────────────            ───────────────────────────────
  job list, eligibility,   <───   roles-<home>.json (gen, leases)   <───   Claude / GPT (C11): one JSON reply
  admission, remedies             validator: schema, caps, the            to one snapshot; abstain allowed
  re-check each lease fresh       bot's own eligibility on the
  release -> baseline path        snapshot; safety filter; spend guard
  writes rows + ledger            greedy + random baselines (logged)
```

- **Host service `mcai-overseer`** on 10.0.0.31, like r3's foreman: Nice 10, MemoryMax 512M, rotation not a hard stop, a
  heartbeat per tick that every read checks. A stale census voids measurement in both arms; a stale overseer is treatment
  downtime in the treated arm (r3 section 5, unchanged).
- **Keys:** the operator places them; the service reads them from a 600 file; they are never logged, never in a snapshot,
  never in ES.
- **The deterministic tick runs every 5 minutes, always.** It builds the snapshot, re-validates the last valid leases and
  re-issues those still eligible, and writes a new generation. A failed, invalid, skipped or over-budget overseer call
  writes an **empty generation** (all leases revoked).
- **The local gpt-oss foreman (r3) is not built.** The owner's C11 replaces it. gpt-oss remains a free fallback the owner
  could choose later; the validator and the arms are model-agnostic.

### 3.3 The job set

| job | what the bot does (existing or building-tier code) | eligibility owner (pure function, the bot and the validator run the same) | cap per town | released when |
|---|---|---|---|---|
| **BUILD:<seg>** | the building tier's builder places the open cells of one segment, holding the segment lease | building tier: `buildEligible(bot, record, seg)` (stand reachable, material in bag or site chest, slot free) | 2 (C14; 3 later) | segment done, lease lost, TTL, refusal, maintenance order |
| **SUPPLY:<item>** | moves a BOM-short item to the project's site chest: from the bag (a verified town deposit to that container), from a town chest (withdraw, then deposit), or by crafting from town stock (planks, stairs, panes, a door, torches) | this design + townindex: the item is short (`need`), the bot holds it or a known-fresh town container does, or it can craft it from known stock | 2 per item | need met, refusal, TTL |
| **DEEP_MINE** | the mineshaft design's deep-mining job from the town shaft | mineshaft-safety: `deepMinerEligible(bot, town)`; slot admission by its own slot leases | 1-2 (mineshaft design) | its own refusals and remedies |
| **SMELT** | smelt_town (copper, iron, sand to glass when the BOM needs glass) | smeltjob's existing admission | 1 | nothing to smelt (the 85% copper case releases at once) |
| **BANK** | town_deposit, sorted to the site chest for BOM items | towndeposit's existing admission | — | nothing bankable |
| **FREE** | the bot's own plan | — | at least 1 FREE per town | — |

**Not leasable:** general MINE (junkwell-01: more mining sends bots into sealed pockets and lava; only DEEP_MINE, under the
mineshaft design's safety); RECALL (29% `home`); GATHER as a role (gathering is a step inside SUPPLY when an item is short
and renewable at the surface: logs, sand); explore (see candidate X1).

**Maintenance always outranks a lease** (r3's starvation rule): the bag-full, spent-tool and no-usable-pickaxe orders and
every reflex rank above any leased job. A composed test keeps a lease eligible while the bag reaches 34 slots and asserts
the deposit runs within the TTL.

### 3.4 The snapshot and the reply

- **Snapshot** (`tools/snapshot.py.txt`; filled from the window's real rows and index at 10-23 10:00Z for all 13 towns,
  with a fixture workshop project): per bot {at_town, distance, dy, health, kinds carried, key items, pickaxes, the last 3
  skills and outcomes, safety flags, successful job counts in 24 h, the jobs it is eligible for now}; the project {state,
  layer, cells done/open/waived, segments with holder and open cells, BOM need / at site / in town}; town stock from the
  index with its known/stale counts; open jobs; caps; the last generation's leases and how each ended; the budget left.
  - **Size: 3,606-3,837 characters per town, about 1.0-1.3k tokens.** The draft system prompt
    (`tools/system_prompt.txt`) is 3,012 characters, about 0.7-0.85k tokens. These are character-based estimates; the
    operator re-measures with the vendor's token counter before the first call.
  - Every value is an enum, a registry name, a fleet bot name or a number (comms principle 6). Free text never enters.
- **Reply** (strict JSON): `{gen, leases: [{bot, job, ttl_min 5..30, reason (enum), evidence: [snapshot paths]}],
  unstaffed: [{job, why (enum)}], abstain}`.
- **The validator** (deterministic, host): schema; `gen` equals the snapshot's; every bot and job exists; the job is in the
  bot's `eligible` list **as recomputed by the validator** (never trusted from the model); caps; at least one FREE; no
  flagged, low-health or away bot on BUILD/SUPPLY; no re-lease of a job a bot refused in the last 30 min. A failing lease
  is dropped and counted against the overseer (invalid rate is a metric).

### 3.5 Claiming and release (r3 4.5, unchanged except where named)
- **Delivery:** `/var/lib/mcai/_pool-<pool>/roles-<home>.json`, atomic rename, with `gen` (persisted, monotone),
  `issued_at`, per-lease `expires_at`.
- **The bot honours** only the newest generation it has seen and only unexpired leases; after a restart it re-reads.
- **A lease is a sort key**, not a command: it moves the leased job to the front of the bot's discretionary town-job order.
  The job's own admission still decides. For BUILD and DEEP_MINE the bot must still win the building tier's segment lease
  or the mineshaft slot; the overseer cannot hand out a segment or a slot itself.
- **Claims belong to their protocols:** segment and slot leases (`link()`, fenced generations, TTL + 60 s reclaim: plinth
  and monument-01), furnace leases. The role lease only says who should try first.
- **Release** writes `_role_released {reason}`: done, refused (with the job's own reason), ineligible on the fresh check,
  expired, revoked (an empty generation), maintenance pre-empted, flagged. The bot's next decision is today's.

### 3.6 Failure handling: no dead ends

| situation | what happens | why it is not a dead end | composed test |
|---|---|---|---|
| no lease, or the file is missing or corrupt | today's behaviour | every consumer's default is today's path | a corrupt file then a valid one |
| a lease the bot cannot perform from where it is (wrong place, no material, segment taken, slot full) | released in the same decision, baseline path | the bot never waits; the overseer's next snapshot sees the release | each job's refusal -> the next decision equals control's |
| the job runs out mid-lease (copper gone, segment done, BOM met) | the job's own `no_effect` releases it | as above; the 30-min no-re-lease stops a loop | smelt with no copper -> released, not re-leased within 30 min |
| the overseer is slow, down, over budget, or returns invalid JSON | empty generation within 5 min; TTL ≤ 30 min bounds a dead service | bots run today's code | kill the service; the leases lapse; decisions match control |
| two bots leased to one segment | impossible past the validator (one per segment); and the segment lease admits one | the loser's lease is ineligible and released | two leases, one segment -> one builder, one release |
| a builder dies or disconnects | the segment lease's TTL frees the segment; the next snapshot re-leases | as monument-01 | kill a builder mid-segment |
| a leased bot's maintenance comes due | the maintenance order runs first | r3 starvation rule | lease + bag reaching 34 -> deposit within the TTL |
| a project stalls (no witnessed placement for 30 min while open and staffed) | the overseer sees `stall_min`; the validator stops re-issuing the stalled job after 2 stalls; the read names the cause (material, stand, waived cells) | building-tier's own stall rule decides the project | a fixture with an unplaceable cell -> waived after 3 visits by different bots, never a stuck lease |
| DEEP_MINE refused by the mineshaft guards | released; the mineshaft design's own remedy | the guard names an executable remedy (their contract) | their chain tests, plus a lease into each refusal |

### 3.7 Soft preference, not roles (C13)
- **Affinity** = the bot's successful runs of that job in the last 24 h (from rows), capped and decayed (half-life 12 h).
- It is in the snapshot (`done24`) and it is the **first tie-break** of the greedy baseline and the validator's
  re-issue order. It never overrides eligibility, caps or safety.
- **Why not roles:** smelt_town shows the stranding the owner described: 1,399 of 1,646 runs found no copper (1.2). A
  fixed smelter would have spent its day there.

### 3.8 Cadence, cost and the hard spend guard (C12)

**Per-call tokens (3.4):** in ~2.0-2.2k (snapshot + system prompt), assumed **2.5k**; out ~150-300 tokens of JSON plus
thinking, assumed **1.2k** at low effort (worst case capped by `max_tokens` 4,000).

**Prices (Anthropic first-party list, cached 2026-09-25; per million tokens in / out):** Claude Sonnet 5.5 $2 / $10;
Claude Haiku 4.5 $1 / $5; Claude Opus 5.5 $4 / $20; the Batch API halves both. **GPT prices were not looked up for this
document**: the guard reads a price table the operator fills from the vendor's page before enabling a GPT model.

| per call | in | out | total | worst case (4k out) |
|---|---:|---:|---:|---:|
| Sonnet 5.5 | $0.0050 | $0.0120 | **$0.017** | $0.045 |
| Haiku 4.5 | $0.0025 | $0.0060 | $0.0085 | $0.023 |
| Opus 5.5 | $0.0100 | $0.0240 | $0.034 | $0.090 |

| plan, 1 call per town per 30 min (48 per town-day), Sonnet 5.5 | calls/day | $/day | $/month |
|---|---:|---:|---:|
| shadow, all 13 towns, Batch | 624 | 5.30 | 159 |
| **shadow, towns with an open project (≤ 6), Batch** | ≤ 288 | **≤ 2.45** | **≤ 73** |
| **live, 4 canary towns, real time** | 192 | **3.26** | **98** |
| live, all 13 towns, real time | 624 | 10.6 | 318 |
| live, all 13 towns, Haiku 4.5 | 624 | 5.3 | 159 |

- The owner's rough figure ($5/day at one call per town per 30 min, mid-size model) holds for about 6 towns live on
  Sonnet 5.5, not 13. Shadow and live do not run at full width at the same time in this plan, so each phase fits the cap
  with room for re-asks (10% of calls repeated, to measure the overseer's own run-to-run disagreement).
- **Event calls:** a call may come sooner than 30 min when a segment frees, a lease is released by refusal, or a stall
  passes 30 min, but **never more than 2 per town per 30 min**; the per-town 30-min allowance is the binding limit.

**The hard spend guard** (host-side, in the service, deterministic, tested before the first call):
1. **A spend ledger** (`~/overseer/spend.jsonl`): every call's billed input, cached and output tokens from the response's
   usage fields, priced from the configured table, with the model and the vendor's request id. The month-to-date total is
   folded from it. A failed write stops the service.
2. **Pre-call check:** the call is sent only if month-to-date + this call's **worst case** (input tokens counted + the
   `max_tokens` cap, at the table price) stays under the monthly cap ($150), and today's spend stays under the daily
   allowance (cap ÷ days in the month, with unspent allowance carried forward up to 2 days).
3. **Order when short:** live towns first, then shadow towns; shadow stops first.
4. **At 80% of the month:** shadow stops; a fleetstatus header line and an alarm row (the alarm-log lesson: alarms surface
   in the header). **At 100%:** the overseer stops. It writes empty generations, so every lease lapses within 5 minutes, and
   **the bots run on**. It restarts at the next month or by an owner raise of the cap.
5. **Reconciliation:** daily, the ledger is compared with the vendor's own usage report (the operator's job, out of band);
   a difference over 5% stops the service until the operator looks. The owner's vendor-side spending limits stay as the
   backstop.
6. **Tests:** the guard's own fixture (a month at 99.9% refuses a call whose worst case would cross; a missing ledger
   refuses everything; a corrupt price table refuses everything) passes before any key is read.

### 3.9 Shadow first (C11), and what it can and cannot show

**Shadow (S2):** the service runs in towns with an open project. It builds snapshots, calls the overseer through the
Batch API (latency does not matter when nothing is delivered), validates, logs the leases it **would** have issued, logs
the greedy and random assignments for the same snapshot, and delivers nothing. For at least 72 h.

| shadow gate | why |
|---|---|
| validator-clean ≥ 98% of leases; abstain rate reported | the model can follow the contract |
| executable at issue and at +5 min ≥ 80% (re-checked on the next snapshot) | leases would not be refused at once |
| no lease to a flagged bot (0) | safety |
| stall recall ≥ 0.6 against S0's stalls | it sees what matters |
| **concordance with what the bots did, reported, never a gate** | **this is prediction, the measure that could not show the mayor a benefit**; a high concordance means the overseer is redundant, a low one is not evidence of value |
| frontier v greedy v random: divergence and the snapshot features where they differ, reported | the first look at whether the frontier's choices differ in a way an outcome could reward |
| spend inside the guard, and the ledger reconciling with the vendor's usage within 5% | the guard works on real billing |

**What decides going live** is not the shadow. It is the Paper arms (6.2, S1): an oracle on the deployable lever must beat
rotation, and the greedy and frontier arms are run against rotation and random in the same paired design. If the oracle
cannot beat rotation, the live canary does not launch: the headroom is not demonstrated (r3's rule).

---

## 4. The comms ledger, stage 1, on the townindex records

### 4.1 Where things stand
- **townindex-01 is on the fleet** (KEPT +360 10-23 01:07Z, promoted 01:17Z) and is the authoritative stock store: `obs`,
  `dirty`, `xfer` records per container (1.1). It was not shipped with the ledger the comms design proposed to ride with
  it (owner C2); no ledger file or code exists on the fleet.
- **indexsearch-01** (the first reader of the index) is a live canary.
- So ledger-01 is now its own small change beside the index. It **does not mirror the index for consumers** (consumers
  read the index directly, comms principle 8); a stock mirror is written only for stage-2 display, as the comms design's
  snapshot-only rule says.

### 4.2 What gets written, who reads it, what decision it changes

| type | written by (automatically, as part of the work) | read by | the decision it changes | measured value today |
|---|---|---|---|---|
| `station` (a furnace's input, fuel, output at an open) | every furnace open: drain, smelt, smelt_town | **furnaceseen-01** (the drain) | the drain skips the walk to a furnace a townmate found empty < 60 min ago, unless newer contrary evidence exists (comms 4.5) | 870 of 1,435 empty drains repeat a townmate's, about 2.5 bot-h/day |
| `progress` (a server-witnessed placement: project, segment, cell, block, by) | the building tier's builder, after each witnessed placement | the overseer's snapshot (`stall_min`, cells done), S0's cells-per-hour, coopread, stage-2 talk | stall detection: the validator stops re-issuing a stalled job; the overseer moves bots | 0 today (no project) |
| `claim` (snapshot mirror of segment, slot and furnace leases, each by its own liveness rule) | one reconciler per town per 30 min (comms 4.3) | stage-2 talk, coopread's duplicate-claim gate | none directly: decisions read the lease files | 0 today |
| `lease` (each role lease issued, honoured, released with its reason) | the overseer service (issue) and the bot (honoured, released) | the overseer's next snapshot (`last_gen`), the reads | the 30-min no-re-lease after a refusal; the overseer's evidence | — |
| `need` (derived in the fold: project BOM − site chest − known town stock) | nobody writes it; `ledgerView()` derives it from the index and the project record | SUPPLY eligibility, the snapshot's `bom` | which item is short and who could bring it | — |
| `death`, `fire_site`, `hazard` | as comms 4.2 (mirrors of world facts) | stage-2 talk only | none (keepout-01 reads world facts) | — |

**Not written, on purpose** (comms 2.4): a bot's failure to reach something, fruitless visits, "sighting gone".

### 4.3 Protocol and gates
- The comms design's file, appender, generations, checkpoint, fold (`ledgerView(entries, now)`), rate rules and dead-end
  table (comms 4.3-4.6) apply unchanged.
- **One addition:** `need` is derived, never stored, so it can never disagree with the index it comes from.
- **Gates (comms 4.7):** L1 parity of every complete mirror snapshot with an independent parse of the retained source
  bytes; L2 integrity (0 unparsed lines, 0 dropped transitions, `_ledger_drop` ≤ 1% of observations); L3 cost (append p95
  < 5 ms, < 2 MB per town per day, fold p95 < 50 ms); L4 no harm by the default gate.

### 4.4 Candidate X1, the explore heading claim (measured first, not designed in)
- 69.4 bot-h a day of explore heads for a sighting a townmate headed for in the last 30 min, and those runs harvested the
  target half as often (1.2). A `heading` claim (a bot heading for sighting S holds it for 20 min; townmates' explore picks
  another) would be a ledger type with a consumer.
- **But the association is confounded:** popular sightings are old ones. The host read X1 (6.3) stratifies by sighting age
  and item before anything is built. It belongs to the expansion lane (E0) if it survives.

---

## 5. The first shared project: 2 bots build their town's workshop (C14)

### 5.1 Shape
- The town plan's workshop plot (ring@1: a strip beside the storehouse, d ≤ 13; stations 2 tables + 3 furnaces). The
  building tier owns its blueprint as an **enclosed building with a roof, a door and a light**, and owns the structure
  count. This design owns only how 2-3 bots share the work.
- **Partition by segment of the open layer** (monument-01's protocol: a frontier layer, segments within it, one builder per
  segment). Not by material (MineCollab).
- **Builders: 2 for the first canary.** The owner said 2-3. VillagerAgent's construction task completed at 1, 2 and 4
  agents alike and gained efficiency only from 1 to 2 (12.96 -> 17.75 -> 17.41 %/min); MineCollab and TeamCraft fall past
  2. A third builder is a tier-1 setting (`BUILD_CAP=3`) once the 2-builder run is read.
- **Asynchronous by construction.** Three bots are at town together 3-9 minutes a day (1.4). Each builder works its own
  segment whenever it is at town; the record carries the state; the site chest carries the material.

### 5.2 The claimable sub-task interface (proposal to the building tier)

The project record is the building tier's (`<project>-<home>.g<N>.json`, fenced generations, `link()`; the town plan's
siting file references it). The cooperation tier needs it to expose:

```json
{"v": 1, "project": "workshop", "home": "355_73_147", "world": "<id>", "gen": 12, "state": "building",
 "structure_complete": false,
 "layer_open": 2,
 "segments": [{"seg": 2, "layer": 2, "cells_open": 31, "cells_done": 9, "cells_waived": 0,
               "lease": {"file": "workshop-355_73_147.seg2.lease.g7.json", "holder": null, "until": null},
               "stands_reachable_from": "apron"}],
 "bom": {"cobblestone": 96, "oak_planks": 64, "oak_stairs": 24, "glass_pane": 8, "oak_door": 1, "torch": 4},
 "site_chest": {"k": "362,72,154", "h": ["362,72,154"]},
 "builders_max": 2, "slots": {"file_prefix": "workshop-355_73_147.slot", "n": 2},
 "stall": {"since": null, "reason": null}}
```

| sub-task | claimed through | eligibility (pure, exported by the building tier) | done when (world-read) |
|---|---|---|---|
| **build a segment** | an admission slot (n = builders_max) + the segment lease, both `link()`-created, TTL 4 min renewed per placement, fenced by the record generation | `buildEligible(bot, record, seg)`: a stand reachable from the bot's walk probe, the segment's material in the bag or the site chest, no flag, no ready rung | every cell of the segment done, done-degraded or waived (monument-01's four states), from the server's block updates and a read-back |
| **supply an item** | no lease: SUPPLY is a deposit into the site chest, verified by townindex's re-open (`xfer ok=1`) | this design: `need(item) > 0` and the bot holds it, or a known-fresh town container holds it, or it can craft it from known stock | the site chest's next observation holds it |
| **craft a part** (door, panes, stairs, torches) | no lease; it is a SUPPLY path | the existing craft admission | a verified deposit of the crafted part |
| **open the next layer** | the record's own CAS | the building tier's frontier rule | the record's `layer_open` advances |

**What the cooperation tier writes into the project:** nothing. It reads the record, the leases and the index, and it
writes role leases and ledger entries. The record has one writer class (the building tier's builder), so there is no shared
mutable state between the two designs.

**What the building tier must emit (for the reads):** a `progress` ledger entry and a positioned row per witnessed
placement, naming project, segment, cell and bot; a row per segment lease taken and lost; the structure-count event when
`structure_complete` flips (its predicate, not ours).

### 5.3 Supply through the site chest
- BOM items reach the site through the site chest, a town container (16 h / 12 v of home), so townindex sees every move
  (1.1's method applies unchanged).
- **Cooperation in material is measured directly:** a cell placed by bot B from material that bot A deposited into the
  site chest. The site chest's index records give A's deposits; B's withdrawal ops give B's draws. FIFO/LIFO bounds as in
  1.1.
- The town store already moves material between bots (51-62% of window-deposited units withdrawn by another bot), so no
  handoff protocol is added.

### 5.4 Deep miners (from the mineshaft design)
- **DEEP_MINE** is a leasable job (3.3). The mineshaft design owns: the shaft, `deepMinerEligible(bot, town)` (an iron
  pickaxe with uses for the trip and the escape, health, kit, no flags), the slot count (1-2 per town) and the slot leases,
  every safety guard and its refusals' remedies, and its canary's harm gates.
- The assigner owns only **who tries first**, among bots that are eligible, with the soft preference ("yesterday's deep
  miner tends to mine").
- **Before the overseer is live** the mineshaft design's own slot protocol is enough: an eligible bot takes a free slot
  first-come. The overseer's lease later only reorders who tries. So the mineshaft canary never depends on this one.
- **Interface:** `deepMineSlots(town) -> {n, held: [bot], free}` and a `_deep_mine` row per trip with outcome, depth and
  items (iron counted from the bag delta at the surface, not from intent).

### 5.5 What "built together" means, measurably
- **Multi-builder project-days:** a project-day on which 2 or more different bots placed witnessed cells of the same
  structure.
- **Cross-funded cells:** cells placed by a bot from material another bot delivered (5.3).
- **Completion:** the building tier's structure count (enclosed, roof, door, light), verified by an RCON re-read.

### 5.6 Dead ends specific to the project

| situation | result |
|---|---|
| no stand reachable for any open cell in a segment | `buildEligible` false; the lease is never issued; after 3 visits by different bots the cells are waived (monument-01's rule), never a stuck segment |
| the site chest full or missing | SUPPLY refuses before walking (`no_room` / `no_target`, the townindex check); the bot's next decision is baseline; the read names the town |
| the BOM item is nowhere in town and not craftable | SUPPLY is not eligible; `unstaffed: {job, why: no_source}`; ordinary gathering (the bot's own plan) may bring it |
| a builder is inside its own segment when the layer would close over it | the building tier's entity rule (no placement while an entity's box touches the cell or the one above) |
| both builders hold all segments and leave town | segment TTL (4 min) frees them |

---

## 6. Measurement and canary plan

### 6.1 Rules for every read in this tier
1. **Effects from the world:** server-witnessed placements and an RCON re-read at the end; index observations; bag deltas
   at verified opens. Intent rows (a lease issued, a row written before an action) never count as an effect.
2. **The unit is the town.** Difference-in-differences against control towns, never canary against fleet (CLAUDE.md).
   Randomization inference over towns; the null from S0's pre-period of the same towns.
3. **ITT over a fixed horizon** (r3 section 5): every randomized town-hour stays in the denominator, including stalls,
   completions and overseer outages. A census outage voids hours in both arms.
4. **KEEP needs the effect.** verdict.py treats `primary` as advisory, so a KEEP alone means "nothing objected"
   (memory: the gate never tests the effect). The registration therefore carries an **effect line**: an `own_lines` entry
   on the read's lower bound, `on_fail: REVERT` **without** `evidence`, and not nullable. Under v25 such a line cannot
   revert; when it fails the verdict is INCONCLUSIVE ("blocked"), and when it is undefined the verdict is UNREADABLE. So a
   KEEP exists only when the effect's lower bound clears the registered bar. The analyst's effect call is still written
   separately and never attributed to verdict.py.
   - A cleaner `on_fail: BLOCK_KEEP` alias is a gate change (both engines, installed between canaries); this design does
     not need it.
5. **Positive controls in every read:** the read must see its own arm's leases, placements and site-chest deposits
   (instrument), and a fixture with a known answer passes before the first live reading.
6. **Exposure before verdict:** unexposed means INCONCLUSIVE early (owner 10-15).

### 6.2 The Paper arms (S1): does assignment have headroom on the workshop at all?
- **Scene:** a sandbox town cut from a real town's index snapshot (real stock and real shortages, not seeded plenty), 5
  bots, the workshop record, 2 builder slots.
- **Arms, same scene, order randomized within pairs:** rotation (today's order, no leases); random leases (same mechanics,
  random eligible choice: the placebo); greedy (the deterministic baseline); oracle (a scripted lease writer with full
  information, on the v1 lease API only); frontier (the overseer, real calls, costs counted by the guard).
- **Pairs:** pre-registered from the run-to-run SD of rotation runs, at least 6 (r3).
- **Measure:** witnessed cells per hour; time to the building tier's structure count; site-chest stalls.
- **Gate to live:** the oracle beats rotation by at least the live canary's minimum detectable effect (paired permutation,
  p < 0.05). If not, the live canary does not launch and the line closes INCONCLUSIVE (headroom not demonstrated).
  Frontier v greedy v random is reported with its interval; **live goes with the frontier only if it is not below greedy**
  (if greedy is as good, the owner is told that the cheaper arm does the same, and decides).

### 6.3 The ordered build list

| # | step | what | tier / read | depends on | cost |
|---|---|---|---|---|---|
| **B0** | S0 adapter fix | `record_without_code`: a project is open only with a row of its own kind from that town's build in 24 h; the building tier's workshop adapter | host tool, no slot; light two-engine review | — | ~0.5 day |
| **B1** | coopread | the daily cooperation census: 1.1's index flows (other-bot share, both bounds), 1.2's duplicates, 1.4's co-presence, multi-builder project-days, cross-funded cells. Positive controls built in (verified xfers; overlap sweep). A fleetstatus line | host tool, no slot | — | ~1 day |
| **B2** | ledger-01 | `station`, `progress`, `claim` mirror, `lease`, derived `need`; observe-only | **tier 2** (4 pools, ≥ 48 bot-h, licence not `rate`); exposure ≥ 200 entries per drawn town; gates L1-L4 | townindex (on the fleet) | ~3 days build + Paper |
| **B3** | furnaceseen-01 | the drain skips a walk to a furnace a townmate found empty < 60 min ago | **tier 2**; exposure ≥ 20 skipped walks; gate 0 drain walks to a live-empty furnace; primary repeats per bot-h DiD; guards furnace output wait, smelt ingots | B2 promoted | ~1 day; worth ~2.5 bot-h/day |
| **B4** | workshop-01 | **the building tier's canary**, built with 2 builder slots, segment leases, the site chest and the 5.2 interface; staffed by today's rotation (no leases yet) | **tier 3** (building tier's registration); this design adds two report lines: multi-builder project-days and cross-funded cells | building tier; B2 for `progress` | building tier's estimate |
| **B5** | S1: the lease reader + Paper arms | the bot-side reader (one sort key), its composed chain and starvation tests (both engines), the spend guard's fixture, the five Paper arms (6.2) | sandbox, no slot; the overseer arm's real calls cost about $1-3 for 6 pairs | B4 code | ~4 days |
| **B6** | S2: overseer shadow | the host service in towns with an open workshop, Batch calls, no delivery, ≥ 72 h; 3.9's gates | host, no slot; owner places keys | B4 KEPT and promoted; B5 oracle passes | ≤ $2.45/day (Sonnet 5.5) |
| **B7** | assign-01: live in 4 towns | frontier leases delivered in 4 canary towns; ≥ 6 control towns with an open project; ITT primary: witnessed workshop (or next queued structure) cells per randomized town-hour; KEEP needs the effect line: **lower bound of the DiD > +15%** (r3); harm gates: deaths (two-death floor, 1.25x), gather and craft completions per bot-h DiD no worse than -10%, any lease to a flagged bot = defect REVERT, immobile/stuck DiD within the null | **tier 3**, the one canary slot, a 4-pool non-bag-fix draw (needs the r3 canary-report support and owner approval); power from S0's pre-period; horizon the shortest giving 80% power, refused beyond 7 days | B6 gates pass; S0 ≥ 20 assignable town-h/day for 48 h; **a project queue long enough to cover the horizon in every eligible town** | $3.26/day live |
| **B8** | DEEP_MINE through the assigner | the mineshaft job becomes leasable (5.4) | inside the mineshaft design's canary first (its own slot protocol), then folded into assign-01's next run | mineshaft-safety; B7 | — |
| X1 | heading-claim read | 4.4: duplicated explore by sighting age and item | host read, no slot | — | ~0.5 day |
| later | stage 2 talk on the showcase from `progress`/`claim`/`lease` (comms 5); Contract Net requests (comms 6, if bag surpluses appear); a 3rd builder (tier 1); fleet-wide overseer (only with a cheaper model or a raised cap) | | | | |

**Timing.** B0, B1 and X1 any time (host, read-only). B2-B3 in the lane after the current queue. B4 is the building tier's
timetable. B5-B6 overlap B4's canary. B7 is at least 2-3 weeks out: it needs the workshop on every town (KEPT and
promoted), 48 h of S0's pre-period, a passed oracle and a 72-h shadow.

**The horizon problem, named.** A workshop in one town may finish within a day. An ITT read over several days then needs
**the next structure queued** in every eligible town (the building tier's queue: storehouse, pavilion, hall), or the
randomized town-hours after completion carry no work and dilute the effect. B7 does not register until the building tier
confirms a queue that covers the horizon.

### 6.4 What closes each step (CLAUDE.md: done means read on the fleet)
- B0, B1, X1: merged, installed from a copy outside `/opt`, the fleetstatus line seen, SHIPPED in memory.
- B2, B3, B4, B7: KEEP / REVERT / INCONCLUSIVE recorded against the sha; teardown in three steps; memory says SHIPPED.
- B5, B6: their gate table recorded as PASS or FAIL in STATE, with the decision it leads to (go, stop, INCONCLUSIVE).

---

## 7. Owner questions

**Answered 10-23 ~13:30Z, designed to:**

| # | owner answer | what this design does | where the evidence pushes back |
|---|---|---|---|
| C11 | a frontier model (Claude or GPT) is the overseer; shadow first, compared against what the bots did; then live in a few towns | 3.2, 3.9, B6, B7 | **the comparison with what bots did is prediction** (the mayor's measure); it is reported, not a gate. Live rests on the Paper arms and the effect line. Greedy and random are computed on every snapshot so "frontier beats greedy" is measured |
| C12 | $150/month to start; design the cadence and a hard guard | 3.8: 30-min cadence, ≤ 2 calls per town per 30 min, the guard stops the overseer (empty generation), never the bots | the cap fits shadow in ≤ 6 towns (Batch) or live in 4 towns; fleet-wide live (~$320/month on Sonnet 5.5) does not fit |
| C13 | flexible jobs with a soft preference | 3.7 | agrees: smelt_town's 85% "no copper" is the stranding |
| C14 | 2-3 bots build their town's workshop; the building tier owns the blueprint and the count | 5 | **start at 2** (VillagerAgent, MineCollab); "together" means the same structure and day, rarely side by side (3 together ≤ 3-9 min/day) |
| C14b | 1-2 deep miners per town assigned by the job assigner | 5.4, B8 | none, provided the mineshaft design owns eligibility and safety |

**New, with recommendations:**

| # | question | recommendation | why |
|---|---|---|---|
| C15 | Which model for the overseer: Claude Sonnet 5.5, Claude Haiku 4.5, or a GPT mid-tier | **Sonnet 5.5 at low effort for shadow and live in 4 towns; Haiku 4.5 as a third Paper arm** | Haiku fleet-wide would be about $159/month, just over the cap; if it holds up in Paper (~$1 of calls) it is the route to more towns |
| C16 | The 4-town live draw needs a 4-pool non-bag-fix draw (r3 decision 3) | **yes, when B7 is ready** | the town is the unit; 4 canary + 6 control eligible towns |
| C17 | Build B0, B1 and X1 now (host, read-only, no slot) | **yes** | the census must stop calling a reverted project open, and the cooperation numbers become a daily line |
| C18 | ledger-01 (B2) and furnaceseen-01 (B3) in the lane after the current queue | **yes, B2 first** | ledger-01 is the substrate for `progress`; furnaceseen is the cheapest measured consumer |
| C19 | If the frontier arm is no better than greedy in Paper, run the live canary with greedy (no API spend) or stop | **run greedy live and keep the frontier in shadow** | the cheaper arm that works is still a cooperation result; the owner keeps the decision |
| C20 | Should the shadow also cover towns without an open project (self-maintenance) | **no** | 1.5: that headroom was taken by the deterministic fixes; it would repeat the mayor at a cost |

---

## 8. Reviews

Pending: round 1 (Claude, independent subagent; Codex, `codex exec --sandbox read-only`). Each round's verdicts, findings
and the changes made are recorded in `cooperation-tier-reviews-2026-10-23.txt` and summarised here.
