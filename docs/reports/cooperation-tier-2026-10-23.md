# The cooperation tier: a frontier overseer as job assigner, the town ledger, and the first shared build (design r2, 2026-10-23)

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
workshop blueprint and the structure count) and mineshaft safety (`mineshaft-safety-1023`: the deep-miner job). Neither
branch was on origin when this was written (14:40Z). Everything this document needs from them is a named contract proposal
(5.2, 5.4), to be reconciled when they land.

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
  `r2fix.py.txt` and `r2b.py.txt` supersede them where the round-1 reviews found a fault (named in place).
- **Open loop at the time.** `canary-sched.py status` at 14:20Z: "S6 open loop: canary d4a0f42 is deployed on
  board-a,placebo-a with no KEEP/REVERT/INCONCLUSIVE recorded". The owner directed this parallel design work on 10-23 and
  the host loop reads indexsearch-01 on its own schedule. This work read no canary row, ran no read and touched nothing of
  the canary.

---

## 0. Answers first

**1. Cooperation today is real but thin, and it happens through shared state, not through meeting (section 1).**
- **The town chests are a shared pool.** In 158 town-hours the index saw 412 container mutations; 398 are attributable to
  one bot (14 had no later open; 0 ambiguous). Of 629 units withdrawn, **79 to 150 (12.6-23.8%) provably or possibly came
  from another bot's deposit into that same container** (valid per-container bounds); most of the rest is stock older than
  the index. The flow is small: 1,191 units in and 629 out, about 4 out per town-hour, 75% of it metal.
- **Duplicated effort is small.** Leased town jobs start inside a townmate's run of the same job at or below chance
  (deposit 0.25% v 0.54% expected; the drain on the same furnace 0.2%). smelt_town is above chance (6.5% v 1.95%):
  copper arrives for everyone at once. The largest repeat is a furnace found empty again by a townmate (870 of 1,435 empty
  drains, about 2.5 bot-h a day). Explore **co-targets** shared sightings (9,210 of 16,958 explore runs headed for one a
  townmate headed for in the 30 min before), but explore toward a sighting almost never ends in a harvest at it, shared or
  not: **13 location-verified harvests in 16,958 runs** (r2). That is a target-quality problem, not a cooperation one.
- **The census cannot find idle labour.** 28.4% of bot-time is inside a skill row. S0 counts 612 of 977 at-town bot-h
  (63%) as free, but the out-of-skill time is mostly short gaps around reflex, trap and path activity (1.3).
- **Bots are rarely together for long, and rarely at town.** A bot is at town 20.3% of the time and more than 12 blocks
  below home's level 48.6% of the time. Two or more bots are at town together about 394 minutes per town-day, three or more
  about **102 minutes**, but in short pieces: the longest unbroken stretch with three was 3-9 minutes per town. An away,
  unflagged bot is inside the town-job radius within 30 minutes **42.8%** of the time.

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
- **Jobs:** BUILD(segment), SUPPLY(item), DEEP_MINE, SMELT, BANK, FREE. Soft preference (C13): a bot's recent successes at
  a job are a tie-break, never a role.
- **BUILD and SUPPLY are next-visit leases:** issued to a bot wherever it is (if safe), acted on only inside its town-job
  chain when it next reaches town. A lease never causes travel.
- **No dead ends:** a lease is never a precondition. No bot waits for one; a refused, ineligible or expired lease returns
  the bot to exactly today's decision path in the same decision.

**4. Spend (C12, section 3.8).** Claude Sonnet 5.5 at low effort: about $0.017 a call (2.5k tokens in, about 1.2k out with
thinking), list prices re-checked 10-23. **Calls are hard-capped at 48 per town-day** (an event pulls the next call forward,
it never adds one), plus 10% re-asks. Shadow in real time in 3 towns: about $2.70/day ($81/month). Live in 4 towns: about
$3.59/day ($108/month). **Fleet-wide live (13 towns) would be about $350/month on Sonnet 5.5 and $175 on Haiku 4.5: neither
fits the cap.** The guard reserves each call's worst case before it is sent, keeps the reservation until billed usage
arrives, and stops the overseer (empty generations, every lease lapses within 5 minutes) at the cap. **The bots carry on.**

**5. The ledger, stage 1 (section 4).** townindex-01 shipped as the stock store **without** the ledger (no ledger code or
file is on the fleet). ledger-01 is now a small journal beside it with only what has a consumer now: `station` (for
furnaceseen-01: the 870 repeat empty drains) and a snapshot mirror of `claim`s. `progress` arrives with the workshop's
builder, `lease` mirrors with the overseer. The derived quantities (`to_site`, `short_town`) are computed by readers from
the index and the project record, never stored. Reachability is never shared.

**6. The first shared project (C14, section 5): 2 bots build their town's workshop together, by segment.**
- Partition by **region** (segments of the open layer, monument-01's protocol), not by material: MineCollab's agents undid
  each other's work when split by material.
- **Start at 2 builders.** The prior art does not establish an optimum (VillagerAgent's construction task completed at 1,
  2 and 4 agents, slower at 8), so 2 is chosen for local reasons: two bots are at town together about 394 minutes per
  town-day and three only about 102, and each extra builder is another lease to fence. A third is a one-number change.
- **Material flows through a reserved site chest**, which every other picker skips.
- Cooperation is measured as **multi-builder project-days** and **units that non-builders delivered to the site chest and
  builders then drew**, from witnessed placements and the site chest's index records.

**7. Measurement (section 6).** Effects come from the world: server-witnessed placements, RCON re-reads at the end, index
observations and bag deltas. Intent rows never count. The live canary's registration carries an **effect line** that fails
to INCONCLUSIVE (verdict.py v25: a `REVERT` own line without `evidence` lands in `blocked`, never reverts and never falls
through to KEEP), so KEEP cannot mean "nothing objected".

**8. Build order (6.3):** B0 S0's capability fix -> B1 coopread -> B2 ledger-01 -> B3 furnaceseen-01 -> B4 workshop-01 (the
building tier's canary, 2 builders, reserved site chest, the SUPPLY job) -> B5 lease reader + Paper arms -> B6 overseer
shadow (3 towns, real time) -> B7 assign-01 live in 4 towns -> B8 DEEP_MINE through the assigner.

**Where the evidence argues against an owner answer (section 7):**
- **C11:** "compare the shadow's decisions with what the bots actually did" measures **prediction**, the instrument that
  could not show the mayor a benefit. It is kept as a sanity report, but going live rests on the Paper arms, and the
  decision on the live effect line.
- **C14:** start at 2 builders, not 3; "together" will mostly mean the same structure on the same day, in turns.

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
  `ver` observations, with the transfer's bot as the attributed bot, and the difference holds the item (`data/r2b.out` [V]).
- Of 399 consecutive observation pairs of a container that differ, **1** has no op between them: the index sees
  essentially every mutator.
- 412 ops = 398 attributed + 14 unresolved (no later open in the window) + 0 ambiguous.

| | units deposited | units withdrawn |
|---|---:|---:|
| metal (iron, copper, gold) | 575 | 474 |
| wood | 417 | 103 |
| fuel | 73 | 48 |
| stone | 64 | 0 |
| tools | 6 | 4 |
| other | 56 | 0 |
| **all, 158 town-h** | **1,191** | **629** |

**Provenance, per container (r2: r1 pooled across containers and called two orderings "bounds"; both were wrong).**
- **Valid bounds** on units withdrawn by bot B from container K that came from **another** bot's deposit into K:
  - lower: the most B withdrew from K at any point, beyond K's stock at its first index open plus B's own deposits into K
    so far;
  - upper: what B withdrew, capped by other bots' deposits into K before B's last withdrawal.
  - Summed: **79 to 150 of 629 withdrawn units (12.6-23.8%).**
- **Two allocation scenarios** (not bounds): own-first gives stock 473 / same bot 77 / other bot 78; others-first gives
  405 / 88 / 135. Under either, about half or more of the window-deposited units that were withdrawn came from another bot
  (78 of 155; 135 of 223).
- **Pooled at town level** (descriptive): 46 town-by-item pairs were withdrawn, and in 39 a different bot deposited that
  item somewhere in town in the window (metal 23, fuel 11, tools 3, wood 2). Every town has 2-5 depositing and 3-5
  withdrawing bots.
- **Reading:** the containers already pass material between bots without anyone meeting. That is why stage 3's
  REQUEST/OFFER stays deferred (comms C9), and why the project's supply goes through a site chest (5.3).

### 1.2 Duplicated effort (`tools/r2fix.py.txt` [O] [X], chance null `tools/r2b.py.txt` [N])

r1's overlap used fixed neighbour windows; r2 uses a complete interval sweep and reports both run incidence and overlapped
time.

| job | runs | starts inside a townmate's run of the same job | expected by chance (independence) | overlapped bot-time | no_effect+failed: overlapping v solo |
|---|---:|---:|---:|---:|---|
| smelt_town | 1,646 | 107 (6.5%) | 1.95% | 0.25 of 7.31 bot-h | 93% v 87% |
| furnace_drain (same furnace) | 2,237 | 5 (0.2%) | 2.13% (any furnace) | 0.00 of 7.17 | — |
| toolkit | 514 | 2 (0.4%) | 0.42% | 0.00 of 1.33 | — |
| deposit | 400 | 1 (0.25%) | 0.54% | 0.00 of 1.31 | — |
| town_deposit | 153 | 1 (0.7%) | 0.02% | 0.00 of 0.08 | — |
| withdraw_pick / compost / dispose_well | 78 / 76 / 159 | 0 / 0 / 0 | 0.28% / 0.04% / 0.15% | 0 | — |

- The positive control is the same sweep finding the smelt_town overlaps.
- **Reading:** leased jobs overlap at or below chance. That is descriptive; it does not show the leases cause it, because
  the jobs are rare. smelt_town overlaps above chance because the same copper arrival triggers every bot.

| other duplicate | measured | control / denominator | reading |
|---|---|---|---|
| **furnace found empty again by a townmate** (60 min, no non-drain session on it between) | **870 of 1,435** "is empty" drains (60.6%); after the same bot 38 | 678 non-drain sessions parsed; comms 10-21: 391 of 922 | about 2.5 bot-h a day (the empty drains' no_effect body time, 4.2 bot-h, times 0.6): **furnaceseen-01's target** |
| smelt_town with nothing to smelt | 1,399 of 1,646 "no raw copper" (85.0%), 4.6 bot-h | 115 successes; "no coal" 10 | a job that ran out: the owner's C13 example |
| gathers of the same block by a townmate at the same time (end positions within 16 / dy 8) | 293 of 23,566 starts (1.2%); 1.7 of 171.0 gather bot-h overlapped | — | not a problem |
| mine runs with a townmate mining within 16 at the same time | 1 of 6,494 | — | none |
| the same item crafted by two townmates within 10 min | 14 of 340 successful crafts (stone_pickaxe 10, furnace 4) | — | small |
| **explore co-targeting** (a heading at a sighting a townmate headed for in the 30 min before) | 9,210 of 16,958 explore runs with a heading (68.8 of 121.4 explore bot-h); censored at the window end 112 | — | **co-targeting, not duplicated effort:** explore re-aims every leg, and a claim would only send the bot elsewhere |
| explore -> a same-block gather **completed** within 10 min of the run's end, its end position within 24 (dy 16) of the sighting, one gather credited to one explore | **fresh 10 of 7,748 (0.13%); co-targeted 3 of 9,210 (0.03%)**; same block elsewhere 52 (0.67%) v 36 (0.39%) | the Claude r1 reviewer's bag-delta control (raw_iron rising within 10 min): 1.22% v 0.54% | **explore toward shared sightings almost never harvests at them.** The difference is at most ~50 harvests a day fleet-wide; a target-quality question for the expansion lane (X1), not a cooperation lever |

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
- **Together** (r2; r1 quoted the longest stretch as if it were the total):

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
- **Fix (B0), r2:** S0 decides **capability** from the town's build, not from activity. A project is capable when the town's
  running build sha descends from the project's merge commit (or carries its registered variant). A capable project whose
  record is open but which places nothing is kept as **open and stalled** with zero production, so a starved project stays
  visible. A record without capable code is `record_without_code`: reported, excluded from assignable time.

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
- **Keys:** the operator places them; the service reads a 600 file; never logged, never in a snapshot, never in ES. The
  operator creates a **dedicated vendor workspace or key with its own vendor-side spend limit set at the cap** before the
  first call (required, 3.8).
- **The deterministic tick runs every 5 minutes, always.** It builds the snapshot, re-validates the newest valid leases on
  fresh facts and re-issues those that still pass, and writes a new generation. A failed, invalid, skipped or over-budget
  overseer call writes an **empty generation** (all leases revoked).
- The local gpt-oss foreman of r3 is not built: C11 replaces it. The validator, the arms and the guard are model-agnostic,
  so gpt-oss (no API cost) stays an owner option.

### 3.3 The job set

| job | what the bot does | eligibility (pure, exported by the owning module; host part / bot part) | cap per town | released when |
|---|---|---|---|---|
| **BUILD:<seg>** | the building tier's builder places the open cells of one segment, holding the segment lease | building tier `buildEligible`: host = material for the segment in bag or site chest, segment unleased, slot free, no flag, health > 10; bot = a stand reachable by the walk probe | 2 (C14) | segment done, lease lost, TTL, refusal, maintenance pre-empts |
| **SUPPLY:<item>** | **new code (B4)**: move a short item to the site chest: from the bag (verified deposit into the site chest), from a town chest (withdraw, then deposit), or by crafting it from known stock (planks, stairs, panes, door, torches) | this design: host = `to_site(item) > 0` and (the bag holds it, or a fresh known town container other than the site chest holds it above its reserve, or it is craftable from known stock); bot = the site chest has room, **re-checked immediately before the deposit** | 2 per item | `to_site` met, no room, refusal, TTL |
| **DEEP_MINE** | the mineshaft design's deep-mining job from the town shaft | mineshaft-safety `deepMinerEligible`; slot admission by its own slot leases | 1-2 (theirs) | its own refusals and remedies |
| **SMELT** | smelt_town (copper, iron; sand to glass when the BOM needs glass) | smeltjob's existing admission | 1 | nothing to smelt (releases at once) |
| **BANK** | town_deposit as today (the site chest is excluded, 5.3) | towndeposit's existing admission | — | nothing bankable |
| **FREE** | the bot's own plan | — | at least 1 per town | — |

**Quantities (r2: r1's single `need` could never become positive while any other chest held the item).**
- `to_site(item)` = material needed by the project's **open** cells − what the site chest holds. It drives SUPPLY from a bag
  or a town chest.
- `short_town(item)` = `to_site(item)` − fresh known stock in other town containers above their reserve. It drives SUPPLY's
  craft path, and when nothing can be crafted, `unstaffed: {job: SUPPLY:<item>, why: no_source}`.
- **Reserves:** SUPPLY never draws a town container below the stock-target floors and the kit reserves already in code
  (cobble's floor, the kit's 4 spare ingots), so the project cannot strip the town's tools.

**Not leasable:** general MINE (junkwell-01: more mining sent bots into sealed pockets and lava; only DEEP_MINE, under the
mineshaft design's safety); RECALL (29% `home`); GATHER as a role (gathering stays the bot's own plan; `short_town` makes
the shortage visible to the overseer and the talk); explore.

**Maintenance always outranks a lease** (r3's starvation rule): bag-full, spent-tool and no-usable-pickaxe orders and every
reflex rank above any leased job.

**The SUPPLY loop guard (Claude r1).** Withdraw from chest A, find the site chest full, and a baseline town_deposit could put
the items back into A; SUPPLY would run again. So: SUPPLY checks site-chest room **before** the withdraw and again before
the deposit; a "no room" outcome releases the lease **and** sets a 30-min per-bot SUPPLY cooldown for that item (a
deterministic cooldown, not a lease rule). A composed chain test runs exactly that loop and asserts at most one withdraw per
30 minutes.

### 3.4 The snapshot and the reply
- **The live snapshot** comes from the shipped index fold (`townindex.mjs` `indexView`, via node on the host: known / stale /
  dirty / unknown per container, world-checked), the project record, and each bot's **completion-time** snapshot (a skill
  row's position and bag belong to its end; event rows to their emission). Unknown or dirty stock is never counted as held.
- **Per bot:** at_town, distance, dy, arrival rate in the last 24 h, health, carried kinds, key items, pickaxes, the last 3
  skills and outcomes, safety flags, successful runs per job in 24 h, and `eligible`: **the validator's filtered output** on
  host facts, so the model never sees an ineligible choice.
- **Project:** state, layer, cells done / open / waived, segments (holder, open cells), per item `to_site` and
  `short_town`, `stall_min`.
- **Size (synthetic, for costing only).** `tools/snapshot.py.txt` filled the fields from the window's real rows and the
  raw index at 10-23 10:00Z for all 13 towns, with a fixture workshop and invented `eligible` lists. It is not a faithful
  input: it ignores dirty marks, pools stale stock and pairs end-of-skill bags with start times. It sizes the call only:
  **3,606-3,837 characters, about 1.0-1.3k tokens.** The draft system prompt (`tools/system_prompt.txt`) is 3,012
  characters, about 0.7-0.85k tokens. The operator re-measures both with the vendor's token counter before any call.
- Every value is an enum, a registry name, a fleet bot name or a number (comms principle 6).
- **Reply** (strict JSON): `{gen, leases: [{bot, job, ttl_min 5..30, reason (enum), evidence: [snapshot paths]}],
  unstaffed: [{job, why (enum)}], abstain}`.
- **The validator:** schema; `gen` equals the **newest** snapshot generation for that town and no empty generation has been
  written since (a late reply after a revoke, or after the project advanced, is discarded); every bot and job exists; the job
  is in the validator's own `eligible` for that bot; caps; at least one FREE; no lease to a bot flagged **at issue time**;
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
- **Binding:** the bot honours a lease only if world, project and segment match what it reads, and the project record's
  generation is not past `record_gen` by a layer change. Otherwise it is stale and ignored.
- **Next-visit (r2, Claude r1 P1).** BUILD and SUPPLY leases are issued to safe bots wherever they are. The lease does
  nothing until the bot is inside its town-job chain at town; then it puts the leased job first among the discretionary town
  jobs. **It never causes travel**, so it is not RECALL. Each 5-minute tick re-issues still-valid leases, so a lease lives
  while the overseer keeps choosing it; an away, unflagged bot is inside the town-job radius within 30 min 42.8% of the time
  (1.4). The share of leases that meet an arrival before expiry is a shadow gate (3.9).
- **A lease is a sort key, not a command.** The job's own admission still decides. For BUILD and DEEP_MINE the bot must still
  win the building tier's segment lease or the mineshaft slot: the overseer cannot grant a segment or a slot.
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
| **no open cell is reachable** (every stand fails the walk probe) | `buildEligible` fails for every bot; BUILD is not issued; the project is **stalled: unreachable**, named in the read, the overseer told; the building tier's own stall and waiver rules decide what happens to the project (monument-01: waive after 3 visits, and safety wins over progress: a frontier can stop and wait for the owner) | **the bots are never stuck** (they never wait on the project); **the project can be** — that is the building tier's honest outcome, not hidden | a fixture with an unreachable cell: no bot stalls; the project reports `stalled: unreachable` |
| a project stalls (no witnessed placement for 30 min while open and staffed) | the validator stops re-issuing that job after 2 stalls; **the counter resets** on a witnessed placement in that project or a new record generation | — | stall, then a placement -> leases resume |
| DEEP_MINE refused by the mineshaft guards | released; the mineshaft design's remedy | their contract: every refusal names an executable remedy | their chain tests, plus a lease into each refusal |

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

| per call | expected | worst case (4k out) |
|---|---:|---:|
| Sonnet 5.5 | **$0.017** | $0.045 |
| Haiku 4.5 | $0.0085 | $0.023 |
| Opus 5.5 | $0.034 | $0.090 |

**Cadence, hard:** at most **48 calls per town-day** (one per 30 min). An event (a segment freed, a refusal, a stall past 30
min) may **pull the next call forward**, never add one. Re-asks (10% of calls, to measure the overseer's own run-to-run
disagreement) are budgeted on top: 52.8 calls per town-day.

| plan (Sonnet 5.5, 52.8 calls per town-day) | $/day expected | $/month (30 d) | worst case $/day |
|---|---:|---:|---:|
| **S1 Paper arms** (6 pairs, ~2 h each, frontier arm only) | ~$1-3 once | — | — |
| **S2 shadow, 3 towns, real time** (72 h) | **2.70** | (81) | 7.1 |
| **S3 live, 4 canary towns** (≤ 7 days) | **3.59** | (108) | 9.5 |
| live, all 13 towns | 11.7 | 350 | 31 |
| live, all 13 towns on Haiku 4.5 | 5.8 | 175 | 15.8 |

- The owner's estimate (about $5/day at one call per town per 30 min on a mid-size model) matches about 5-6 towns on
  Sonnet 5.5, not all 13.
- **A month of this plan** (Paper, 72 h shadow, a 7-day live canary) is about $36 expected and $90 worst case: inside the
  cap. Running shadow and live together is not planned.

**The hard spend guard** (host-side, deterministic, in the service, fixture-tested before any key is read):
1. **One process, one lock.** All calls go through one service holding `flock ~/overseer/spend.lock` for every ledger
   write. A second instance refuses to start.
2. **Reserve before sending.** Before a request is sent, the guard appends a **reservation** of its worst case (counted input
   tokens + the `max_tokens` cap, at the table price) to `~/overseer/spend.jsonl` and fsyncs it. The send happens only if
   month-to-date **billed + all open reservations** + this reservation stays under the monthly cap ($150), and the same
   holds against the daily allowance (cap ÷ days in month, unspent allowance carried at most 2 days).
3. **Settle from billed usage.** A reservation is replaced by the billed amount (input, cached, output tokens from the
   response's usage fields, with the vendor request id). A timeout, crash or a response with no usage **keeps the
   reservation open** until reconciliation settles it.
4. **No hidden retries.** The SDK client runs with `max_retries=0`; each retry the service makes is its own reservation.
5. **Reconciliation, automated.** Daily, the service reads the vendor's usage/cost API (or the operator's export) and settles
   open reservations. A difference over 5% between ledger and vendor, or **no recorded reconciliation in 36 h**, stops the
   overseer until the operator looks.
6. **Order when short:** live towns first, then shadow; shadow stops first.
7. **At 80% of the month:** shadow stops; a fleetstatus header line and an alarm row (alarms surface in the header). **At
   100%** (or any guard failure: missing ledger, corrupt price table, failed write): **the overseer stops, and stopping
   means it keeps writing empty generations every tick**, so every lease lapses within 5 minutes and stays lapsed; **the
   bots run on** with today's behaviour. It restarts next month or when the owner raises the cap.
8. **At B7's launch** the guard reserves the whole horizon's worst case (7 days × 4 towns ≈ $66) against the month; if it
   does not fit, B7 does not launch.
9. **Backstop:** the dedicated vendor workspace or key with its own limit at the cap (3.2).
10. **Tests:** concurrent submissions, a restart with open reservations, a timeout with no usage, month rollover, a month at
    99.9% refusing a call whose worst case would cross, a missing ledger, a corrupt price table.

### 3.9 Shadow first (C11), and what it can and cannot show

**Shadow (S2):** the service runs **in real time** in 3 towns with an open workshop (Batch would make `last_gen`, event
calls and the 30-min no-re-lease unreproducible). It builds snapshots, calls, validates, and logs the leases it **would**
have issued, plus the greedy and random assignments for the same snapshot. It delivers nothing. At least 72 h.

| shadow gate | why |
|---|---|
| validator-clean ≥ 98% of leases; abstain rate reported | the model follows the contract |
| executable on the next snapshot ≥ 80% (host part) | leases would not be refused at once |
| **leased bots that reach the town-job radius before expiry ≥ 40%** (the 42.8% baseline arrival rate; below it the overseer picks bots that do not come) | next-visit leases meet arrivals |
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
| `claim` (snapshot mirror of furnace, segment and slot leases, each by its own liveness rule) | one reconciler per town per 30 min (comms 4.3) | coopread's duplicate-claim gate (which reads the lease files directly), stage-2 talk | none directly: decisions read the lease files | **B2** (furnace leases now; segment and slot leases when B4 writes them) |
| `progress` (a server-witnessed placement: project, segment, cell, block, bot) | the building tier's builder, after each witnessed placement | the snapshot's cells and `stall_min`, S0's cells per hour, coopread, stage-2 talk | stall detection; the validator's 2-stall rule | **B4** (with the builder) |
| `lease` mirror (issued / honoured / released + reason) | the reconciler, from the `_role_*` rows (the single source, 3.5) | stage-2 talk; the reads use the rows | none | **B6** |
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
Explore toward shared sightings almost never ends in a harvest at the sighting (13 of 16,958 runs, location-verified; 1.2).
Co-targeting is not the problem; the sightings are. A host read by sighting age and kind (X1) goes to the expansion lane
(E0) before anyone builds a heading claim.

---

## 5. The first shared project: 2 bots build their town's workshop (C14)

### 5.1 Shape
- The town plan's workshop plot (ring@1 beside the storehouse, d ≤ 13). The building tier owns its blueprint as an
  **enclosed building with a roof, a door and a light**, and owns the structure count. This design owns how 2-3 bots share
  the work.
- **Footprint, a question for the building tier:** the town plan measured the free strips beside the cores at 5x3, 5x2 and
  4x2; an enclosed building with a door may need more. This design's fixture is sized like a 7x5 enclosure; the building
  tier confirms the footprint fits ring@1's workshop plot in the bench towns.
- **Partition by segment of the open layer** (monument-01: one frontier layer, segments within it, one builder per segment).
- **Builders: 2 for the first canary** (0.6). A third is a tier-1 setting (`BUILD_CAP=3`) once the 2-builder run is read.
- **Asynchronous by construction:** each builder works its own segment in its spells at town; the record carries the state;
  the site chest carries the material.

### 5.2 The claimable sub-task interface (proposal to the building tier)

```json
{"v": 1, "project": "workshop", "home": "355_73_147", "world": "<id>", "gen": 12, "state": "building",
 "structure_complete": false, "layer_open": 2,
 "segments": [{"seg": 2, "layer": 2, "cells_open": 31, "cells_done": 9, "cells_waived": 0,
               "material_open": {"oak_planks": 22, "cobblestone": 9},
               "lease": {"file": "workshop-355_73_147.seg2.lease.g7.json", "holder": null, "until": null}}],
 "bom_open": {"cobblestone": 35, "oak_planks": 43, "oak_stairs": 16, "glass_pane": 6, "oak_door": 1, "torch": 4},
 "site_chest": {"k": "362,72,154", "h": ["362,72,154"], "reserved": true},
 "builders_max": 2, "slots": {"file_prefix": "workshop-355_73_147.slot", "n": 2},
 "stall": {"since": null, "reason": null}}
```

| sub-task | claimed through | eligibility (pure, exported by the building tier) | done when (world-read) |
|---|---|---|---|
| **build a segment** | an admission slot (n = builders_max) + the segment lease: `link()`, TTL 4 min renewed before each placement, fence check of the record generation before every mutation, reclaim after TTL + 60 s | `buildEligible(bot, record, seg)`, split into a host part (material, slot, segment free, safety) and a bot part (a stand reachable by the walk probe) | every cell of the segment done, done-degraded or waived under the building tier's rules (monument-01's states and cover rule if it adopts them), from server block updates and a read-back |
| **supply an item** | no lease: a verified deposit into the site chest (townindex's re-open, `xfer ok=1`) | this design: `to_site(item) > 0` and a source (3.3) | the site chest's next observation holds it |
| **craft a part** (door, panes, stairs, torches) | no lease: a SUPPLY path | the existing craft admission | a verified deposit of the part |
| **open the next layer** | the record's own CAS | the building tier's frontier rule | `layer_open` advances |

**What the cooperation tier writes into the project:** nothing. It reads the record, the leases and the index, and writes
role leases, `_role_*` rows and ledger entries. The record has one writer class: the building tier's builder.

**What the building tier must emit:** a `progress` entry and a positioned row per witnessed placement (project, segment,
cell, bot); a row per segment lease taken and lost; the structure-count event when `structure_complete` flips (its
predicate); `material_open` per segment and `bom_open` (open cells only, so `to_site` is net of placed cells).

### 5.3 The reserved site chest (r2, Claude r1 P1: it is shared mutable state)
- The site chest is a town container (16 h / 12 v), so townindex sees every move. It is also where every other picker would
  otherwise reach: town_deposit, withdraw (every-chest search), toolkit (every-chest search), the smelt jobs, and the town
  plan's `allocateHomes` (which would class it as a home, overflow or drain and let tidy empty it).
- **So the siting file declares it reserved** (`townplan` plot `work`, cell role `site_chest`, `reserved: true`), and every
  container picker excludes reserved containers: deposit and town_deposit targets, withdraw, toolkit and smelt searches,
  `allocateHomes`, tidy and dispose. Only SUPPLY (deposit) and the builder (withdraw) touch it.
- **A composed test:** a baseline town_deposit, toolkit, withdraw_pick and smelt_town run beside a stocked site chest leave
  it byte-identical by server read; then SUPPLY deposits and the builder draws.
- A reserved chest whose project completes is released by the building tier's completion transition.

### 5.4 Deep miners (from the mineshaft design)
- **DEEP_MINE** is a leasable job (3.3). The mineshaft design owns the shaft, `deepMinerEligible(bot, town)` (an iron pickaxe
  with uses for the trip and the escape, health, kit, no flags), the slot count and slot leases, every safety guard and its
  remedies, and its canary's harm gates.
- The assigner owns only **who tries first** among eligible bots, with the soft preference.
- **Before the overseer is live**, the mineshaft design's own slot protocol is enough (first eligible bot takes a free slot),
  so the mineshaft canary never depends on this one.
- **Interface:** `deepMineSlots(town) -> {n, held: [bot], free}`; `deepMinerEligible` split into host and bot parts like
  `buildEligible`; a `_deep_mine` row per trip with outcome, depth and items, iron counted from the bag delta at the
  surface, not from intent.

### 5.5 What "built together" means, measurably
- **Multi-builder project-days:** a project-day on which 2 or more different bots placed witnessed cells of the same
  structure.
- **Site-chest supply by non-builders:** units that bots other than the builders deposited into the reserved site chest and
  builders then withdrew (the site chest's index records; only SUPPLY and builders touch it, so attribution is clean).
- **Cells placed from delivered material**, conservatively: a builder's placements of an item counted against its bag stock
  at the start of its segment lease plus its site-chest draws in that lease; only placements in excess of the bag stock are
  attributed to the site chest, and through it to depositors. Unknown provenance stays unknown.
- **Completion:** the building tier's structure count (enclosed, roof, door, light), verified by an RCON re-read.

### 5.6 Dead ends specific to the project

| situation | result |
|---|---|
| no stand reachable for any open cell | 3.6: bots never wait; the project stalls under the building tier's rules and is named |
| the site chest full or missing | SUPPLY refuses before the withdraw (`no_room` / `no_target`); per-item cooldown; the read names the town |
| an item nowhere in town and not craftable | SUPPLY not eligible; `unstaffed: no_source`; ordinary gathering may bring it |
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
   under a `rate` licence.) The registration is fixture-tested against verdict.py before launch: a passing, a failing and an
   undefined lower bound give KEEP-eligible, INCONCLUSIVE and UNREADABLE. The analyst's effect call is still written
   separately.
5. **Positive controls in every read:** the read sees its own arm's leases, placements and site-chest deposits, and a
   fixture with a known answer passes before the first live reading.
6. **Exposure before verdict:** unexposed means INCONCLUSIVE early (owner 10-15).

### 6.2 The Paper arms (S1): does assignment have headroom on the workshop at all?
- **Scene:** a sandbox town cut from a real town's index snapshot (real stock and shortages), 5 bots, the workshop record,
  2 builder slots, the reserved site chest. **The bots come and go as on the fleet:** each bot is released to its own plan
  away from town and returns on a schedule drawn from the measured arrival process (about 20% of time at town; 42.8% of
  away, unflagged minutes followed by an arrival within 30 min), so no arm gets a world where everyone is present.
- **Arms, same scene, order randomized within pairs:** rotation (today's order, no leases); random leases (the placebo);
  greedy (deterministic: eligible bot nearest the segment, then most material, then affinity); oracle (a scripted lease
  writer with full information including the arrival schedule, on the v1 lease API only); frontier (real calls, costs
  through the guard); Haiku 4.5 as an optional sixth (C15).
- **Pairs:** pre-registered from the run-to-run SD of rotation runs, at least 6 (r3).
- **Measure:** witnessed cells per hour; time to the building tier's structure count; site-chest stall minutes.
- **Gate to live:** the oracle beats rotation by at least the live canary's minimum detectable effect (paired permutation,
  p < 0.05). Otherwise the live canary does not launch and the line closes INCONCLUSIVE (headroom not demonstrated).
- **Which arm goes live, pre-registered:** the frontier goes live if its paired mean is at least greedy's minus one
  pre-registered margin (the rotation SD ÷ 2) and it beats random (p < 0.05). If the frontier is below that and greedy
  beats rotation, the owner is asked to choose greedy live (no API spend; C19). If neither beats rotation, nothing goes
  live.

### 6.3 The ordered build list

| # | step | what | tier / read | depends on | cost |
|---|---|---|---|---|---|
| **B0** | S0 capability fix | capability by build-sha ancestry to the project's merge commit (or its registered variant); a capable open project with no placements stays open and stalled; `record_without_code` reported and excluded; the workshop adapter | host tool, no slot; light two-engine review | — | ~0.5 day |
| **B1** | coopread | the daily cooperation census: per-container provenance bounds (1.1), the overlap sweep with its chance null (1.2), co-presence and arrivals (1.4), multi-builder project-days and site-chest supply (5.5). Positive controls built in (the verified-transfer attribution path; the overlap sweep). A fleetstatus line | host tool, no slot | — | ~1 day |
| **B2** | ledger-01 | `station` + the `claim` mirror (furnace leases); observe-only | **tier 2** (4 pools, ≥ 48 bot-h, licence not `rate`); exposure ≥ 200 entries per drawn town; L1-L4 | townindex (on the fleet) | ~2 days + Paper |
| **B3** | furnaceseen-01 | the drain skips a walk to a furnace a townmate found empty < 60 min ago | **tier 2**; exposure ≥ 20 skipped walks; gate 0 drain walks to a live-empty furnace; primary repeats per bot-h DiD; guards furnace output wait and smelt ingots | B2 promoted | ~1 day; worth ~2.5 bot-h/day |
| **B4** | workshop-01 | **the building tier's canary**, with 2 builder slots, segment leases, the 5.2 interface, `progress` entries, the reserved site chest (5.3: every picker's exclusion and its composed test), and the **SUPPLY job (new code, owned here: withdraw / craft -> verified deposit into the site chest; room re-checks; the loop guard and its chain test)**. Staffed by today's rotation: no leases yet | **tier 3** (the building tier's registration); this design adds report lines: multi-builder project-days, site-chest supply by non-builders, SUPPLY refusals by reason | building tier; B2 | building tier's estimate + ~3 days for SUPPLY and the reservation |
| **B5** | S1 | the bot-side lease reader (one sort key, next-visit, binding checks), its composed chain and starvation tests (both engines), the host/bot eligibility parity test, the spend guard's fixtures, the Paper arms (6.2) | sandbox, no slot | B4 code | ~4 days; ~$1-3 of calls |
| **B6** | S2 shadow | real time, 3 towns with an open workshop, ≥ 72 h, 3.9's gates | host, no slot; owner places keys in a dedicated workspace | B4 KEPT and promoted; B5's oracle gate passes | ~$2.70/day |
| **B7** | assign-01 live in 4 towns | leases delivered in 4 canary towns; **≥ 6 control towns with an open project**; ITT primary: witnessed project cells per randomized town-hour; **effect line: the lower bound of the town-level DiD of witnessed cells per town-hour, against an absolute bar** (cells per town-hour, set from S0's pre-period so a town with a zero pre-period cannot make a ratio undefined; drawexposure's non-degenerate pre-period required at the draw); **power** computed before launch by simulation from S0's pre-period null for the KEEP rule itself (the lower bound clearing the bar when the true effect is +30%), horizon the shortest giving 80%, refused beyond 7 days; **exposure ≥ 60 assignable canary town-hours** (r3) and **≥ 30 leases honoured within TTL that end in a witnessed placement or a verified site-chest deposit**; licence `kind` = the `_role_*` rows; harm gates: deaths (two-death floor, 1.25x control), **rung completions per bot-h** and gather completions per bot-h DiD no worse than -10%, immobile and stuck DiD within the null, **a lease issued to a bot flagged at issue time = a defect REVERT** | **tier 3**; **holds the one canary slot for up to 7 days**; a 4-pool non-bag-fix draw (needs canary-report support and owner approval, r3 decision 3) | B6 gates; S0 ≥ 20 assignable town-h/day for 48 h; **the next structures (the building tier's queue) KEPT and promoted before launch**, so every eligible town has work for the whole horizon | ~$3.59/day; guard reserves ~$66 worst case at launch |
| **B8** | DEEP_MINE through the assigner | the mineshaft job becomes leasable (5.4) | inside the mineshaft canary first (its own slots), then in assign-01's next run | mineshaft-safety; B7 | — |
| X1 | sighting-quality read | 4.4, for the expansion lane | host read, no slot | — | ~0.5 day |
| later | stage 2 talk on the showcase from `progress` / `claim` / `lease` (comms 5); Contract Net requests (comms 6, if bag surpluses appear); a third builder (tier 1); a wider overseer (only with a cheaper model or a raised cap) | | | | |

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
| C14 | 2-3 bots build their town's workshop; the building tier owns the blueprint and the count | 5 | **start at 2**: three are at town together about 102 min per town-day, in pieces of at most 3-9 min |
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

---

## 8. Reviews

The prompts and full texts are in `cooperation-tier-reviews-2026-10-23.txt`.

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
