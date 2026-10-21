# Bot-to-bot communication in three stages, measured first (2026-10-21, design only, r1)

OWNER 2026-10-21 ~21:10Z: "i would like ... to integrate some kind of communication into our platform where bots are
sharing information and communicating". Then "yes" to a staged plan:
1. automatic structured fact sharing;
2. visible plain-language chat;
3. real conversations.

This is a design, not a build. No bot code was written, nothing was deployed, and no queue, scheduler, manifest, bot or
showcase file was touched. Every number is read-only:
- **Rows:** 24 h of skill rows from the 12 shared towns, through `scripts/lib/telemetry.Events` on 10.0.0.31 (full walk,
  `nice -n 19`). The window is 10-20 20:31Z to 10-21 20:33Z: 1,145,782 rows, 60 bots, about 1,441 bot-h.
- **Deaths:** 7 days of `_death` rows from Elasticsearch, through `scripts/lib/estelemetry.EsEvents`. The window is
  7,868,713 docs and crosses 7 log rotations.
- **State files:** the pool state files under `/var/lib/mcai/_pool-*/`, read only.

The scripts are in `docs/reports/comms-design-2026-10-21/tools/` (as `.py.txt`) and their outputs are in `data/`. The
reviews are in `docs/reports/comms-design-reviews-2026-10-21.txt`.

**What the window contains.**
- The fleet ran 9e7d9980 until toolkit-03 (34d3e5e9) was promoted at 13:37Z.
- toolkit-03 was a canary on board-a, placebo-a and hive-b until then.
- homefix-02 was a canary from 18:05Z on placebo-d, hive-a, board-c and board-b: 20 bots, for 2.5 h of the 24.
- The counts below are therefore descriptive. They are not an arm comparison.
- "Shared towns" means the 12 board, hive and placebo worlds. isolated-b became a shared town at 13:53Z and is not
  included.

---

## 0. Answers first

**1. The fleet already communicates, through files, and that is why the remaining headroom on the bench is small.** Every
bot of a town runs on one host and shares that town's state directory. The shared stores are:
- `world-facts`: hazards, death sites (priced into every path), resource sightings and unreachable goals;
- town memory: each container's "looked, none" misses, which a deposit clears;
- furnace leases;
- the generation files for plinths, tree farms and the siting file;
- the cobble journal.

None of these goes through the model. **What is not shared** is the cost that is left (§2):
- **Repeated "looked, none" in town:** about 2.55 bot-h a day out of 1,441 (0.18%).
  - The biggest single item is a furnace found empty by another bot less than an hour after the last bot found it empty:
    390 of 922 drain checks, 1.07 bot-h.
  - Kit iron is solved. After toolkit-03's promotion, 2 of 81 toolkit runs failed for want of iron.
- **Duplicate town jobs:** none. Every leased job overlaps another bot 0-1% of the time. smelt_town overlaps 7.9%, and
  those overlapping runs are *less* often futile than solo runs (51.5% against 72.6%), so they are parallel work, not
  duplicates.
- **Duplicate builds:** cannot be measured today. No multi-bot project is deployed: 0 project rows in 24 h, while the
  same pattern finds the plinth and board rows.

**2. The largest loss that looks like a communication failure is not one: deaths at a known hazard.**
- Over 7 days, 10 of 130 deaths (7.7%) happened inside a death site already on file. 9 of those 10 sites came from
  *another* bot's death.
- One lava pool in hive-b, at (335, 38, 154), killed 6 bots between 10-19 and 10-21. The death site was shared and priced
  each time.
- Bots spend 0.14% of their time inside a live death site, yet 5 of the 31 deaths in the 24 h happened inside one. The
  sites are real hazards.
- The fact reached every bot: 1,219 planned routes crossed a site and paid its price, and 63 explore targets were skipped
  because of one. **What failed is the response** (a priced detour), not the message.
- So stage 1's job for hazards is to promote a corroborated hazard into a hard constraint that destination planners obey.
  That promotion is an underground-safety canary of its own (keepout-01, §8).

**3. Sharing a failure to *reach* something spreads errors, measured.**
- **Gather:** after a townmate failed the same block within 16 blocks in the last 30 min, a bot's gather failed 31.2% of
  the time (n = 1,175). After no prior failure it failed 38.0% (n = 7,198). After its *own* failure it failed 64.9%
  (n = 8,577).
- A shared "unreachable here" veto would have blocked 1,721 successes to avoid at most 859 failures.
- **Iron sightings:** after another bot's fruitless visit, a bot harvested iron there 3.9% of the time (n = 2,487),
  against 3.8% at a fresh sighting (n = 2,272). A townmate's failure says nothing about mine.
- So **the rule for stage 1: share the state of the world (what a container, furnace, place or structure holds or is),
  read from the server; never share one bot's failure to get somewhere.** This is the hive arm's error, now measured on
  the current fleet.

**4. Stage 1 is a typed town ledger (§4).** Skills write it as part of their work; the model is never involved.
- **Schema:** one entry type per fact. Each fact type has its own evidence rule, adoption (quorum) rule, disproof rule and
  expiry, and every entry says who wrote it, from what evidence.
- **Transport:** an append-only journal in the town's state directory, using the cobble journal's proven protocol
  (torn-line tolerant appends, checkpoints, sealed generations). Chat is not the transport; the reasons are in §4.3.
- **First canary, ledger-01:** observe-only and dual-written. The existing writers also write the ledger, and nothing
  reads it. Its gate is that the ledger's view must equal the existing stores'.
- **Consumers come later, one at a time, each where it pays:**
  - the furnace "empty" fact (furnaceseen-01);
  - the confirmed-hazard keep-out (keepout-01, the safety lane);
  - claims, which mirror the found-01 and monument-01 leases;
  - needs, read by the overseer's SUPPLY role.

**5. Stage 2 is plain-language chat for the owner and the showcase (§5).**
- **Wording:** lines are made from ledger events by templates. An optional cheap LLM rewording is allowed only behind a
  validator that drops any line containing a number, coordinate or name not in its source events.
- **Where it shows:** in-game chat, BlueMap markers, and a caption strip in the timelapse.
- **Rate and parsing:** at most 1 line per bot per 2 min and 1 per town per 20 s. Lines are never parsed back.
- **A prerequisite found in this measurement:** `commands.mjs` obeys chat commands from **any** player name.
  - `!stop` from anyone stops every bot in earshot, and `<bot> goto x y z` moves that bot.
  - A peer's plain-language line that starts with a bot's name and a verb would command that bot. So would a stage-2
    line.
  - Commands ran 0 times in 24 h (29 different trigger values were recorded), so closing the gate changes nothing that
    was measured.
  - **chatgate-01** (owner whitelist only) comes first, before any stage-2 line and before the showcase bots start.

**6. Stage 3 is requests, trades, split builds and rescue, in that order of readiness (§6).**
- **Protocol:** Contract Net in the ledger: REQUEST → OFFER → AWARD → DELIVER, plus CANCEL and EXPIRE. Delivery is
  verified by a server read.
- **Who decides:** offers come from deterministic bag policy and awards from the requester's rule or the foreman. The bench
  brain does not author messages in v1. A `request` verb is tested on the model bench and judged on deliveries.
- **Measured headroom today is small:**
  - At "no coal" stops, a townmate carried coal 49.0% of the time, against 56.5% at random moments, and 8 or more coal
    0% of the time.
  - In distress episodes, a townmate was within 32 blocks 26.9% of the time, against 30.2% at random moments.
- So stage 3 starts with the **first live multi-bot project (monument-01) and the foreman**. Only then is there joint work
  to share.

**7. Build order:** chatgate-01 → ledger-01 (with townindex-01) → talk-01 on the showcase plus a bench no-harm read →
furnaceseen-01 → keepout-01 → claims mirrored inside found-01 and monument-01 → stage 3a (requests and needs) with the
foreman → the bench `request` verb → the rescue census. Timeline and tiers are in §8; owner decisions C1-C10 are in §9.

---

## 1. What already exists

| channel / store | file or medium | written by (automatic?) | read by | trust and lifetime |
|---|---|---|---|---|
| `world-facts-<pool>.json`: hazards | pool dir, read-merge-write with atomic rename | reflexes, after **2 personal hits** (`CONFIRM_AT`) | prompt lines (`promptLines`) | halves every 12 h; `by` list kept |
| world facts: **death sites** | same file | the death handler (`reportDeath`), at weight 4 | **the pathfinder**: every cell within 6 blocks / 6 y costs 16 (a detour, never a wall); explore refuses a sighting within 12; line walks check it | 36 h to zero |
| world facts: resource sightings | same file (cap 200; **all 12 towns are at 200**) | the affordance survey reflex (every 20 s) | explore `knownTarget` (iron first): **every one of 15,028 explore runs in 24 h steered at one** | halves every 12 h; **no "gone" disproof** |
| world facts: unreachable goals | same file | the cognitive loop, on a milestone give-up | milestones (`unreachableBy`, only within 64 blocks) | 24 h |
| town memory (`town-chest-<home>.containers.json`) | pool dir | deposit, withdraw, toolkit and smelt searches | the same searches (`townSearchEmpty`) | per container and need: 60 min (pickaxe, sticks), 2 h (copper, coal); a deposit (`o='took'`) ends a miss at once |
| cobble journal + checkpoint | pool dir, append-only, sealed generations | town deposit, recount | cobblecap, stock targets | a fold of the whole history |
| furnace leases (`furnace-leases/`) | pool dir | smelt, smelt_town, drain | the same | lease TTL |
| plinth, tree farm, siting file, monument (designed) generations | pool dir, compare-and-swap by `link()` | the projects | the projects | immutable generations |
| `[fleet]` chat lines (`comms.mjs`) | in-game chat | reflex hazards; milestone give-ups | the same pool's bots; **numbers only**; fleet-shaped names only; isolated bots ingest nothing | redundant on one host, by its own comment: "the file is authoritative for bots sharing a host" |
| lectern board (`board.mjs`) | pool dir | the `board` verb (the model's choice) | the same verb | typed quorum, disproof outranks quorum, two clocks. **Used 24 times in 24 h by 20 board bots** (10 times in 8 days in August) |
| chat commands (`commands.mjs`) | in-game chat | a human | **every bot, from ANY player name** | none: see §5.3 |

**Who shares a host.**
- All 80 bench bots run on 10.0.0.31 and share their town's directory.
- The showcase's 10 bots share their own VM, 10.0.0.40, with their own world.
- **No world's bots are split across hosts**, so a file reaches every reader that matters. Chat would be needed only if a
  world's bots were split, and that is not planned.

---

## 2. What was measured (denominators first; every zero has its positive control)

All numbers are from the 24 h, 12-town extract (`tools/extract.py.txt` → `data/opps.out`, `opps2.out`, `sight.out`,
`extras.out`) unless a line says ES 7 d (`es_deaths.out`).

### 2.1 Repeated "looked, none" in town (the stage-1 `checked` fact)
A **repeat** is a different bot of the same town reporting the same negative within the window, with nothing in between
that could have refilled it:
- for a container search: any deposit, town_deposit, smelt_town or dispose_well success in that town;
- for a furnace: a load of *that* furnace by smelt or smelt_town.

| negative | all (bot-h) | repeat of another bot (bot-h) | own repeat | today's sharing |
|---|---:|---:|---:|---|
| furnace_drain "the furnace ... is empty", same furnace, 60 min | 922 (2.57) | **390, 42.3% (1.07)**, median gap 17 min | 17 | **none**: the drain has no shared empty fact |
| smelt_town "no raw copper", 2 h | 1,240 (4.05) | 332, 26.8% (1.16) | 51 | yes: a 2 h miss per container; the repeats include the search continuing through containers not yet looked in |
| smelt_town "no coal", 2 h | 247 (1.33) | 58, 23.5% (0.26) | 15 | yes: a 2 h miss |
| toolkit `kit_no_iron`, 60 min | 188 (0.27) | 21, 11.2% (0.06) | 6 | yes; **after the 13:38Z promotion, 2 of 81 toolkit runs failed no-iron** (before it: 186 of 335) |
| withdraw_pick "no usable pickaxe", 60 min | 231 (0.64) | 2, 0.9% (0.00) | 7 | yes (townsearch-01) |

- **A query bug caught by its own control.** The first furnace query printed 0 repeats and 0 own repeats. It had counted
  the drain's own `_furnace_session` (`by=drain`) as a refill. Excluding it gives 390. The overseer census found the same
  class at 316 of 764 (41.4%) on 10-19.
- **Durations:** the median negative lasts 2-12 s and the 90th percentile 11-51 s, so these are short checks, not long
  trips. In total about **2.55 bot-h a day of 1,441 (0.18%)**.
- **Reading:** where the town already shares misses, the repeats are low or are the search making progress. The one
  unshared class is the furnace.

### 2.2 Duplicate jobs (the stage-1 `claim` fact)
A run counts as an overlap when it starts while another bot of the town is inside the same job (on the same furnace, for
the drain). The positive control is that the same detector finds the smelt_town overlaps:

| job | runs | overlapping |
|---|---:|---:|
| smelt_town | 2,098 | 165 (7.9%, 2.12 bot-h): **51.5% of them no_effect, against 72.6% of the 1,933 solo runs** |
| furnace_drain | 1,726 | 0 |
| dispose_well | 121 | 0 |
| toolkit | 416 | 4 (1.0%) |
| withdraw_pick | 389 | 2 (0.5%) |
| town_deposit / compost / count_town / deposit | 136 / 68 / 27 / 442 | 0 |

- **Multi-bot projects:** 0 rows matching monument, project, ziggurat, yard, shaft, tree farm or blueprint in 24 h. The
  same pattern finds `_plinth_step` 12, `build_plinth` 2 and `board` 24.
- **Reading:** the leases work, and parallel smelting is not duplication. Duplicate *builds* will become possible with the
  first multi-bot project (monument-01); today there is nothing to measure. This matches overseer census C10.

### 2.3 Deaths at a known hazard (ES, 7 d)
The 130 deaths that have 36 h of history inside the window (death sites live for 36 h), from 170 `_death` rows, all with a
position:

| radius (horizontal / vertical) | no site on file | site from **another** bot's death | site from its own earlier death |
|---|---:|---:|---:|
| 6 / 6 (the pathfinder's disc) | 120 | **9** | 1 |
| 12 / 12 | 111 | 15 | 4 |
| 24 / 12 | 102 | 22 | 6 |

- **hive-b, (335, 38, 154), fire.** The deaths and the prior death each one followed:

  | death | bot | prior death |
  |---|---|---|
  | 10-20 09:33 | Delta | Comet 10-19 04:16 |
  | 10-20 09:42 | Comet | Delta, 9 min before |
  | 10-21 06:10 | Echo | |
  | 10-21 06:58 | Bravo | |
  | 10-21 08:35 | Alpha | |

  STATE 10-19 has the chain for Comet's first death: `mine` stopped at y = 38 with "lava in the headroom", the lava
  corridor was refused twice, and the marooned climb went into the lava. STATE 10-21 07:40Z describes deaths after
  8-block falls.
- **Other repeats:** placebo-a fire at (344, -56, -142); hive-c drowning at (-58, 57, -73), two bots in the same minute;
  hive-a fall at (410, 1, 174); board-c at (386, 11, 158).
- **Control:**
  - in uniform-time samples, 33 of 23,769 bot positions (0.14%) were inside a live disc;
  - in the same 24 h, 5 of 31 deaths were inside one.
  - The sites are about 100 times as deadly as average ground.
- **Reading:** the fact is shared and read: 1,219 `_death_site_route_crossed` rows and 63 `_explore_target_skipped_death_site`
  rows in 24 h. The response is too weak.
  - About 9 deaths in 5.4 days, roughly 1.7 a day across 12 towns, are the opportunity.
  - It belongs to a safety fix that consumes a *confirmed* hazard (§4.2), not to more messaging.

### 2.4 Does another bot's failure predict mine? (decides what stage 1 must NOT share)
**Gather** (`data/opps2.out` [B]): success and failed rows only, n = 18,355, sorted by whether the same block had failed
earlier within 16 blocks and 30 min:

| prior failure | n | failed |
|---|---:|---:|
| by a townmate only | 1,175 | 31.2% |
| by itself only | 8,577 | **64.9%** |
| both | 1,405 | 35.0% |
| none | 7,198 | 38.0% |

**Iron sightings** (`data/sight.out`). An episode is one bot heading at one sighting over 60 min. The outcome is an iron
gather within 48 blocks of the sighting within 60 min:

| class | n | harvested | explore bot-h |
|---|---:|---:|---:|
| fresh | 2,272 | 3.8% | 38.7 |
| after a townmate's fruitless visit | 2,487 | 3.9% | 49.6 |
| after a townmate's harvest | 557 | 4.1% | 12.1 |

- **Positive control:** the harvest predicate finds 314 iron gathers in the 24 h, and 190 of them (60.5%) followed a
  heading at a sighting within 48 blocks.
- **Reading:** a bot's own failure is strong evidence about itself. A townmate's is none. Sharing reachability would
  block good work. That is the hive arm's 2.6x contradiction rate and 114 blocked decisions, here on today's fleet.
- **A side finding for the expansion lane, not for comms:**
  - all 100.4 bot-h a day of explore are steered at shared iron sightings: 15,042 headings at 1,336 sightings, 786 of them
    chased by 2-5 bots;
  - 0.5-4.0% of headings end in an iron gather there;
  - the sighting *choice* is the problem, and no message fixes it.

### 2.5 Needs and offers (the stage-3 `request` / `offer` facts)
At each shortage, did a townmate's newest bag (within 15 min) hold the item? The control is uniform-time moments in the
same towns:

| shortage | at the event | control |
|---|---:|---:|
| smelt_town "no coal" (n = 247), townmate with at least 1 coal or charcoal | 49.0% | 56.5% |
| the same, at least 8 | 0.0% | 0.5% |
| toolkit no-iron after the promotion (n = 2), at least 3 ingots | 2 of 2 | 96.4% |

The keep rules hold iron and coal in bags (IRON_LADDER). So a townmate "has some" about as often as at any random moment,
and it is almost never a surplus. The overseer census reached the same reading (C4, C7): a banking rule takes this
headroom more cheaply than a message.

### 2.6 Distress (the stage-3 rescue)
- There were 952 distress episodes in 24 h, counting one per bot per 30 min: `_entombed_unrecoverable` 676,
  `_recovery_exhausted` 183, `_stranded_unrecoverable` 93.
- A townmate was within 32 blocks and 16 y in 26.9% of them, against 30.2% at uniform-time control moments.
- 9 of the 952 died within 30 min.
- A rescue needs a trip, and most stuck bots are underground: the place where junkwell-01 showed that more trips mean more
  deaths.

### 2.7 The trust boundary
- **Chat commands:** 0 rows with `trigger = "chat"` in 24 h. The positive control is the 29 distinct trigger values that
  were recorded (reflex, `llm:*`, `interrupt:*`, `watchdog_*`, death and the others).
- **The hole is real:** `attachCommands` (index.mjs:1087) parses any line starting with `!`, or with the bot's own name, from
  **any** username. It runs `stop`, `goto`, `come`, `follow`, `gather`, `home` and `deposit`.

---

## 3. Prior art (searched 10-21; links in the reviews file, round 0)

| work | mechanism | what was measured | lesson taken |
|---|---|---|---|
| **Project Sid / PIANO** (arXiv 2411.00114) | about 10 concurrent modules; one cognitive controller sends a single decision to talk and action, so a bot does not say one thing and do another | role specialisation, memes and religion were read from **speech**; only tax compliance (deposits into a chest) was an action | judge on actions. Talk and action must come from one decision: our talk is *generated from* actions (stage 2) |
| **Mindcraft / MineCollab** (github.com/kolbytn/mindcraft; arXiv 2504.17950) | pairwise LLM conversations (`!startConversation`); busy/idle gating; reply timeouts | success fell from up to 90% to under 30% going from 2 to 5 agents. Explaining a plan in words cost over 15% for every model: "the primary bottleneck ... is efficient natural language communication" | send typed facts and pointers, not prose. A conversation must never pre-empt work |
| **VillagerAgent** (arXiv 2406.05720) | a task DAG, a controller that assigns *ready* subtasks, and a shared state manager; no peer chat | against AgentVerse on farm-to-table: failures 18.2% vs 44.4%, completion 73.75% vs 29.75%, tokens 1.79 vs 10.3 | claims and requests belong in a structured store with dependencies: the foreman plus project leases |
| **MineLand** (arXiv 2403.19267) | chat limited by distance; an incoming message can interrupt running code | 32-128 agents; chat overhead ate part of the cooperation gain | scope to the town (our pool scope). **No interrupts from messages**: our refusal and interrupt history says ownership comes first |
| **Generative Agents** (arXiv 2304.03442) | memory stream, reflection, word of mouth | the party spread from 1 to 13 of 25 agents, and **5 of 12 invitees came**. Relayed facts were embellished | measure arrival, not awareness. Relay records with source and time, never retold text. Hence the "no new facts" validator |
| **Blackboard systems** (Nii 1986, AI Magazine 7(2); LbMAS, arXiv 2507.01701) | knowledge sources write typed entries; a control component schedules; LbMAS adds cleaner and conflict-resolver roles | LbMAS 81.68% vs 80.56%, with fewer tokens | the ledger is a blackboard. It needs garbage collection (expiry) and contradiction handling (disproof), or stale claims pile up |
| **MAST** (arXiv 2503.13657); flooding of manipulated knowledge (arXiv 2407.07791) | a failure taxonomy over 1,600+ traces; poisoned facts that persist through agent memory | inter-agent misalignment 32%; reasoning-action mismatch 13.2%; false facts spread while agents kept working | provenance, expiry and a **world-read check** on every shared fact. A wrong fact in a shared store keeps spreading |
| **Contract Net** (Smith 1980, IEEE Trans. Computers C-29(12)) | announce, bid, award, report; `cancel` carried no penalty in the original; levelled commitment came later | — | stage 3's protocol. Add the two things the original lacked: deadlines (TTL) and a commitment cost (abandon backoff) |
| **BlueMap markers** (bluemap.bluecolored.de wiki "Markers"; BlueMapAPI wiki) | marker sets in the map config, or through the plugin API (not persistent; re-added on enable) | — | the showcase renders with the BlueMap **CLI** every 15 min, so config marker sets regenerated before each render are the cheap route. To be verified on the VM (§5.2) |

The lesson across them: **where outcomes were measured, natural-language messaging cost performance**. The systems that
did better used a structured store with explicit allocation. Where "communication" looked good, it was mostly measured on
the talk itself.

---

## 4. Stage 1: the town ledger (automatic, typed, written by skills)

### 4.1 Principles (each one is a measured lesson)
1. **Automatic.** An entry is written by the skill or reflex that observed the fact, as part of its work. No model
   decision writes or gates it (board: 24 calls a day from 20 bots).
2. **World state, never reachability** (§2.4). A shareable fact is about the world, from a server read or a server event:
   - what a container holds;
   - what a furnace holds;
   - that a bot died here, or that lava is here;
   - that a structure cell is placed;
   - that a sighting is gone.

   "I could not reach X" stays private to the bot (its lessons and its own cooldowns).
3. **Per-type adoption, disproof and expiry** (the board's rules, reused). Disproof outranks quorum. Disproof is a **world
   read**, never the absence of harm: a bot walking past lava safely does not disprove the lava.
4. **Provenance.** Every entry carries `by`, `code`, its evidence class and the ids of the rows it came from. A bad writer
   can be traced, and a read can exclude one build.
5. **Peers inform; they never command.** No entry type names a skill, a goal or a coordinate a bot must go to.
   - A consumer is always a **deterministic** planner that already has its own eligibility and remedy chain.
   - The ledger can only remove a futile option or reorder options.
   - It can never add a move the planner would not make anyway. This is the overseer's lease rule (§4.3 of that design).
6. **Absent or corrupt means today's behaviour.** A reader that cannot fold the ledger acts as it does now (`LEDGER=off`
   is the rollback).

### 4.2 The fact types

| type | written by (automatic) | evidence | adopted when | disproved by (outranks quorum) | expires | read by (planned consumer) |
|---|---|---|---|---|---|---|
| `death` | the death handler (today's `reportDeath`) | server death event + position + cause | 1 (a death is witnessed) | a world read of the cause cell: lava or water absent within 2 blocks of the site | 36 h after the last death (today's weights) | the pathfinder price (today); `confirmed_hazard` |
| `hazard` | reflexes (today's `reportHazard`) | **2 personal hits** of one bot (today's `CONFIRM_AT`) | as today | the same world read | halves every 12 h (today) | prompt lines (today) |
| `confirmed_hazard` (derived in the fold, never posted) | — | **2 deaths by 2 different bots** within 6 blocks / 6 y within 36 h, or 1 death plus another bot's same-cause `hazard` | derived | the world read above → `disputed` (kept, not deleted; it re-adopts on the next death) | 72 h after the last death | **keepout-01** (§8): destination and dig planners |
| `stock` | townindex-01's observation at every town open | the window the SERVER sent | 1: a server read is authoritative for that container at that moment | a newer observation; any mutation marks it `dirty` (townindex) | `stale` at 6 h | indexsearch, toolkit, withdraw, smelt, the foreman |
| `checked` (none of X in container C) | the search that opened C | server window | 1 | a deposit into C (`took`), or an observation of C holding X | 60 min (pickaxe, sticks), 2 h (copper, coal): today's TTLs | the searches (today they read town memory; ledger-01 mirrors it) |
| `station` (furnace F: input, fuel, output) | every furnace open: drain, smelt, smelt_town | server window | 1 | any load session on F by smelt or smelt_town; a newer open | 60 min | **furnaceseen-01**: the drain order skips the walk to F while `empty` is live |
| `sighting` | the affordance survey (today) | client-visible block | 1 (today) | **new:** a survey within 8 blocks of the sighting sees 0 of the kind (world read) → `gone` | halves every 12 h (today) | explore `knownTarget` (today) |
| `claim` (mirror) | a project or job when it takes its lease: found, monument segment, furnace lease, plinth, tree farm | the lease file's own write | **the lease protocol decides** (CAS, `link()`, `wx`); the ledger only mirrors | `released`, or lease expiry | the lease's TTL | stage 2 talk, the foreman, the duplicate-claim gate |
| `progress` | builders, after a server-witnessed placement | placement read-back | 1 | — | 24 h for display | stage 2, timelapse captions, the foreman |
| `discovery` | expedition region scans (`_region_scan`); structures seen | world read | 1 for display; 2 different bots before a planner uses it | a later scan of the region | 7 d | E0 frontier file, expedition targets, stage 2 |
| `need` (derived) | the fold, from `stock` + a project's bill of materials | derived | derived | `stock` shows it met | when met, or 2 h | the foreman's SUPPLY role (stage 3a) |
| `offer` | bag policy: surplus beyond the keep rules (deterministic) | own bag | 1 | the bag no longer holds it | 10 min | stage 3 award |
| `request` / `award` / `deliver` / `cancel` | stage 3 (§6) | | | | | |
| **NOT a type** | gather or goto "unreachable", fruitless visits, path failures, lessons, avoid rules | | | | | stays private (§2.4) |

**Scope.**
- One ledger per town (pool + home + world).
- A bot reads only its own town's ledger, and an entry whose `world` differs is absent. That is comms.mjs's
  "speech is free, belief is scoped".
- An `isolated`-scope bot writes nothing to the ledger and reads nothing from it.

### 4.3 Entry, file, protocol
```json
{"v":1, "id":"hive-a-Bravo:1792603123456:17", "type":"station", "world":"<world id>", "town":"355_73_147",
 "subject":{"furnace":"356,72,145"}, "fact":{"input":0,"fuel":0,"output":0,"state":"empty"},
 "obs":"server_read", "evidence":["<row ts>"], "by":"hive-a-Bravo", "code":"34d3e5e9",
 "observed_at":1792603123456, "posted_at":1792603123460, "until":1792606723456}
```
- **File:** `/var/lib/mcai/_pool-<pool>/ledger-<home>.jsonl`.
- **Writes:** the cobble journal's appender, `'\n' + json + '\n'` through `appendFileSync`. A torn line is skipped by the
  fold.
- **Reads:** a fold from the checkpoint `ledger-<home>.ckpt.json` (atomic rename; any reader may write it).
- **Rotation:** sealed generations (`wx` seal, `link()` base), exactly as cobblecap.mjs. **Reuse that code; do not write
  a third journal implementation.**
- **The fold** is one pure function, `ledgerView(entries, now) -> {type -> subject -> {state, reporters, last, until}}`.
  It reuses board.mjs's `quorumState` (typed quorum, disproof first) and its two clocks.
- **Size:** one line is at most 1 KB, enforced; anything bigger is refused and counted.
- **Why a file and not chat:**
  1. Every world's bots share one host (§1).
  2. C2's first smoke lost **every** directive on the chat path.
  3. Chat is rate-limited and lossy across reconnects.
  4. Chat is the channel a human can type into.

  Chat stays the human-facing channel (stage 2). If a world's bots are ever split across hosts, the cross-host mirror is
  comms.mjs's numbers-only `[fleet]` line, restricted to `death` and `confirmed_hazard`. That is not needed today.

### 4.4 Rate (anti-spam)
- **An entry is written only on a state change** of its fact: new, confirmed, disproved, released or expired. Repeated
  identical observations update the writer's in-memory `last` and are not appended. (The survey re-sees the same iron
  every 20 s; it must not append every 20 s.)
- **Caps:**
  - at most 1 entry per (bot, type, subject) per 60 s;
  - at most 120 entries per bot per hour;
  - over the cap, the entry is dropped and an `_ledger_drop` row counts it.
- **Expected volume:** the town jobs counted in §2 total about 5,400 runs a day across 12 towns, about 450 per town per
  day, or about 19 an hour. With observations and claims, 20-40 entries per town per hour is expected, well under the
  cap. ledger-01 measures the real figure.

### 4.5 Consumers (each is its own small change, measured on behaviour)

| consumer | what changes | measured value today | tier |
|---|---|---|---|
| ledger-01 | nothing reads; dual-write only | — (gate: the view equals the existing stores) | owner-direct with a tripwire, or tier 2 (C2) |
| **furnaceseen-01** | the drain order skips walking to a furnace whose `empty` is live; an adjacent open still happens | 390 repeats a day, 1.07 bot-h (12 towns) | 2 (fold into the next smelt or drain change) |
| **keepout-01** | a `confirmed_hazard` is a hard refusal for destination choice (explore target, mine descent bearing, gather target) and for digs into its column; not for a bot already inside it (see §4.6) | about 1.7 deaths a day at known sites (12 towns, 7 d) | 3 (underground safety) |
| sighting `gone` | knownTarget drops a gone sighting | not measured as a gain (§2.4: peer history does not predict) | measure first in ledger-01's data |
| claims mirror | none (visibility + a duplicate-claim gate) | 0 today (§2.2) | inside found-01 and monument-01 |
| needs → SUPPLY | foreman lease reorder (stage 3a) | needs a live project | 3 |

### 4.6 Dead ends (each refusal names a remedy the bot can perform from where it is)

| situation | what the bot does | why it is not a dead end | composed test |
|---|---|---|---|
| the ledger file is missing, corrupt or another world's | behaves as today | every consumer's default is today's path | a fold of a corrupt file, then a write |
| a stale `empty` furnace fact while the furnace holds output | the drain skips the walk for at most 60 min; any smelt load clears it; an adjacent bot still opens it | output waits at most 60 min; nothing is lost (a furnace keeps its output) | drain order with a live `empty` plus a later smelt session → the order is eligible again |
| a stale `checked` miss | as today (town memory): TTL, or a deposit clears it | unchanged | existing townsearch tests |
| `confirmed_hazard` refuses the only explore target | the next target, then a random bearing (today's knownTarget chain) | explore always has the random bearing | explore → knownTarget → keep-out → random bearing |
| keep-out refuses a mine descent | another bearing (today's `_mine_bearing_turned` path); if every bearing is refused, `mine` refuses with a remedy the bot can perform from where it stands ("walk N blocks away from the marked pool, then mine"), and the brain's next choice runs | the bot is above ground or in its own shaft, and the remedy is a walk on the surface | mine descent with all four bearings in a column → a refusal naming the remedy, then the next decision is not `mine` at the same spot |
| **the bot is inside a confirmed disc** (falling, entombed, marooned) | keep-out does **not** apply to escape, drowning or entombment paths, and a bot inside a disc may always leave (today's `lineHitsDeathSite` rule) | survival reflexes outrank the keep-out | **the hive-b chain itself:** `mine` stops at lava, the corridor refuses, the marooned climb exits. In keepout-01 the climb planner must not choose cells *in* the lava; that is a cell filter, not a keep-out. This is keepout-01's first Paper scene |
| a disputed hazard after a world read showed no lava | it stops being confirmed; the price stays while the site is live | the next death re-adopts it | a dispute followed by a death → confirmed again |
| a claim whose holder dies or disconnects | the lease TTL frees it (found 4 min, blueprint 90 s); the next bot's baseline | as the lease designs | already in found-01 and monument-01 |
| over the write cap | the entry is dropped and counted; behaviour unchanged | consumers fall back to their own reads | a cap test |

### 4.7 Read and gates for ledger-01
- **L1, consistency.**
  - The fold's live `death` sites equal world facts' live death sites (same positions within 1 block, same count).
  - The fold's live `checked` entries equal town memory's live misses.
  - This is deterministic. Any difference names the writer it came from.
- **L2, integrity.** Unparsed lines other than torn tails: 0. Writes refused for size: 0. `_ledger_drop` at most 1% of
  entries.
- **L3, cost.** Ledger write time p95 under 5 ms. File growth under 2 MB per town per day before rotation. Fold time p95
  under 50 ms from the checkpoint.
- **L4, no harm.** No consumer exists, so decisions and outputs (gather ok per bot-h, smelt ingots, deposits) and deaths go
  through the default gate as difference-in-differences, against control.

### 4.8 What stage 1 can buy, plainly
- On today's bench: about 1 bot-h a day from the furnace fact, plus whatever keepout-01 saves of about 1.7 deaths a day.
- Its larger value is as the **substrate** for what is coming:
  - claims and needs for the first multi-bot project and the foreman;
  - discoveries for expeditions;
  - the event source for stage 2's talk, so that talk is generated from facts and cannot drift from them.

---

## 5. Stage 2: visible plain-language chat (for the owner and the showcase)

### 5.1 How lines are made
- **Templates.** Each one is keyed by a ledger type and transition. Each line carries the ledger entry id it came from, in
  the `_say` row; the id never appears in chat. Examples:

  | event | line |
  |---|---|
  | `death` | "Lost one at 335,38,154: lava. Steering clear." |
  | `confirmed_hazard` | "That lava pool at 335,38,154 has taken three of us. Marking it." |
  | `station` empty | "Furnace by the storehouse is empty; nothing to collect." |
  | `progress` | "Placed the last block of the monument's north-east corner (14/14)." |
  | `discovery` | "Village to the east, about 120 blocks. On the map." |
  | `claim` | "Taking the north-east corner of the monument." |
  | `need` | "The monument needs 40 more cobblestone." |

- **Optional rewording (owner decision C6).** On the showcase only, one cheap LLM call per town per 5 min rewords that
  slot's template lines into at most 3 chat lines.
  - It uses gemma4 on the Studio through the showcase proxy, with strict JSON output.
  - **Validator:** every number, coordinate, item and bot name in the output must appear in the source events, and the
    output may not exceed the source's lines. Otherwise the templates are sent.
  - This blocks Park et al.'s embellishment: no new facts can enter the talk.
- **No "fake talk".** Every line is produced by a ledger event. There is no free LLM chatter, and no line a bot did not
  act on.

### 5.2 Where it appears
1. **In-game chat, on the showcase.** The owner joins as `mike`, a spectator, and sees the lines as normal chat. On the
   bench, talk-01's no-harm read sends them in 4 pools. Otherwise the bench stays quiet (C7).
2. **BlueMap markers (showcase).** The showcase renders with the BlueMap CLI every 15 min.
   - A host-side generator on the showcase VM (bench scripts only; no bot code) rewrites a marker-set section of the map
     config from the ledger before each capture:
     - confirmed hazards as red points;
     - discoveries as points;
     - claimed plots as shapes;
     - the last 15 min of lines as HTML labels at the speaker's position.
   - **To be verified on the VM before it is built:** that the CLI renderer and the standalone web server publish config
     marker sets. The plugin API's markers are not persistent and need a Paper plugin.
   - The fallback is a static `markers.json` in the web root, which is unofficial.
3. **The timelapse.** At video build time (not capture time), an ffmpeg `drawtext` caption strip shows the ledger's
   `progress`, `discovery` and `death` lines for each 15-min frame. The frames themselves are untouched, so the archive stays
   clean (C8).

### 5.3 Trust: chatgate-01 comes first
- **The finding:** `commands.mjs` accepts `!verb` or `<botname> verb` from any player. No name filter.
  - On the showcase the owner's own spectator account could, by accident, `!stop` all 10 bots.
  - A bot's plain-language line beginning "hive-a-Bravo come ..." would run `come` on hive-a-Bravo.
- **chatgate-01:**
  - Commands run only for names in `OWNER_CHAT_NAMES`. The default is empty, so the bench has no chat commands at all.
  - On the showcase: `mike`, limited to `status`, `stop` and `resume` (C4).
  - Every other line is ignored before parsing and counted in a `_chat_ignored` row (sampled, at most 1 per minute).
- **Stage-2 lines are built so they can never parse:**
  - they never start with `!`, `[fleet]` or a fleet-shaped name;
  - the template engine refuses a line that matches the command or peer pattern (pinned by a test that runs the real
    `attachCommands` and `startComms` handlers on every template's output).
- **comms.mjs is unchanged:** it still parses only `[fleet]` lines from fleet-shaped names and numbers only. Stage-2 lines
  are ignored by it by construction.
- **Measured cost of closing the gate:** 0 chat-triggered runs in 24 h (§2.7).

### 5.4 Rate
- At most **1 line per bot per 2 min** and **1 line per town per 20 s**, by priority: death and confirmed hazard first,
  then progress and discovery, then claim and need.
- The same line is suppressed for 10 min (dedupe).
- A dropped line is counted, never queued: there is no backlog.
- Today's floor is comms.mjs's 20 s per bot.
- The vanilla server's chat-spam counter adds 20 per message, drains 20 a second, and kicks above 200. That allows about 1
  line a second sustained, or a burst of about 10. This is the vanilla behaviour, not re-checked on Paper 1.21.8.
- The caps here are about 120 times below it per bot.

### 5.5 Dead ends

| situation | result |
|---|---|
| the rate cap is hit | the line is dropped and counted |
| the rewording call fails, times out, or its validator rejects it | the template lines are sent |
| the Studio is reserved (brain test) | templates only; the showcase may be paused (its own rule) |
| `bot.chat` throws or the bot is offline | dropped; the bot's existing reconnect; no retry storm |
| a human or a peer types anything | ignored unless whitelisted (chatgate-01) |
| the marker generator fails | the map keeps the last markers; the capture proceeds (the timelapse's heartbeat is separate) |

### 5.6 Read, gates, tier (talk-01)
- **Deterministic gates:**
  - T1: 0 chat-triggered skill runs from non-whitelisted names;
  - T2: every `_say` row carries a ledger id that exists;
  - T3: the caps held (0 bots over 1 line per 2 min; 0 towns over 1 per 20 s);
  - T4: 0 lines matching the command or peer patterns;
  - T5: rewording rejects counted, with the reason.
- **No harm:** decisions, outputs and deaths, as difference-in-differences against control within the default gate.
  Talk changes no decision, so any movement beyond the noise band is a defect.
- **Tier 2 on 4 bench pools** (talk changes no behaviour, and Paper tests prove the never-parsed property), then on the
  showcase as a KEPT build. The showcase follower takes promoted shas.

---

## 6. Stage 3: requests, trades, split builds, rescue

### 6.1 The protocol (Contract Net, in the ledger; mirrored to chat by stage 2)
1. **REQUEST**: `{req, from, item | job, qty, deliver_to: <town container key or project cell>, until <= now + 20 min,
   reason}`. Written by a deterministic job when its own need is blocked: a project's bill-of-materials shortfall, a kit
   short of iron, a smelt short of coal.
2. **OFFER**: `{req, from, qty, eta}`. Written by a townmate only when its **bag policy** has a surplus beyond the keep
   rules and it is eligible: no ready rung, health over 10, no trap, drowning or full-bag order pending. That is the
   foreman's validator rule.
3. **AWARD**: `{req, to, gen}`. Written by the requester's rule (nearest eligible offer), or by the foreman for project
   jobs. One award per request; the generation fences it.
4. **DELIVER**: the awarded bot deposits into `deliver_to` through the existing verified town deposit (the townindex
   re-open is the proof) and writes `{req, op}`. The requester's own withdraw takes it.
5. **CANCEL** by either side, with a reason. **EXPIRE** when `until` passes.

There is no direct hand-off by tossing items: anyone can pick up a dropped item, and nothing verifies it.

**Split builds** are not a new protocol. They are monument-01's segment leases and the foreman's `BUILD` and `SUPPLY` role
leases. The ledger mirrors them as `claim` and `need` so they can be read and shown.

### 6.2 Who decides, and when an LLM is involved

| actor | v1 | later (experiment) |
|---|---|---|
| bench bot brain (qwen2.5 7B) | **never authors** a request or offer; sees read-only lines about town needs, like today's world-fact prompt lines | a `request` verb inside the existing decision call (no extra calls), tested on the **model bench** (learning loop: 4 worlds × 5 bots, AB/BA crossover, after M6), judged on deliveries completed and fill time, never on messages sent |
| deterministic jobs and bag policy | write REQUEST, OFFER, DELIVER | — |
| the foreman (host, gpt-oss:120b) | awards project jobs and supply; caps and validator as its design (at most 24 calls/h globally; 8-16 GPU-min/h in its canary) | — |
| showcase brain (gemma4) | stage-2 rewording only (C6), about 12 calls/h at p50 1.85 s, about 0.4 GPU-min/h | — |

**Rescue parties are deferred** (§2.6). 952 distress episodes a day, a townmate no nearer than chance, and the underground
deaths that come with more trips.
- **Step 1** is a host-side, read-only **rescue census**, like E0 and S0. Per episode it records:
  - whether a surface-reachable cell within 32 blocks is standable;
  - whether the stuck bot's remedy is an item (blocks, a pickaxe);
  - how the episode ended.
- **Step 2**, only if the census shows a reachable, item-shaped share worth a slot: a HELP request that makes a townmate
  deliver the item to the nearest standable surface cell. It needs a Paper scene where the rescuer survives 10 of 10.
- **A rescuer never descends below its own safe depth, and never enters a hazard disc.**

### 6.3 Measuring cooperation (behaviour, never talk)
- **Canary lane (stage 3a, with the foreman on monument-01; tier 3; unit = the town; difference-in-differences):**
  - Primary: the foreman's own pre-registered measure, witnessed cells placed per project-open town-hour.
  - Secondary: need fill time (open → met) and wasted trips (requests expired unfilled, awards abandoned, deliveries
    sniped).
  - Deterministic gates: duplicate claims on a cell 0; deliveries without a verifying re-open 0; deaths within 120 s of
    a request, award or deliver row are named, and the two-death floor applies.
  - Guard: output per bot-h and deaths per bot-h against control.
- **Model bench:** the crossover's own estimator on the same primary. A brain that "asks a lot" and gets nothing counts as
  a cost.

### 6.4 Dead ends

| situation | requester | other side | why it is not a dead end |
|---|---|---|---|
| a request no one offers | continues its baseline path (gather, mine, smelt); the request expires at `until` | — | **no bot ever waits on a request**; it is a hint to others, never a precondition for the requester |
| an offer not awarded | — | its 10-min `offer` expires; baseline | — |
| an award never delivered (the courier abandons) | the award lease expires at `eta + 5 min`; the requester re-requests at most once, then baseline | the courier gets a 30-min backoff on that request type (Contract Net's commitment cost) and returns to its baseline path | both sides end on the control arm's path |
| a delivered item taken by a third bot | its withdraw finds none; counted as `sniped`; baseline | — | v1 accepts this; a 10-min reservation (like bankable's withdraw hold) is v2 |
| the courier's trip is refused by its own safety guards (depth, hazard, bag) | award expiry as above | releases the award at once (`cancel: refused:<guard>`) | the guard's own remedy applies |
| a split-build segment abandoned | — | monument-01's segment lease TTL; the next bot | as the monument design |
| rescue (v2) with no responder | the stuck bot's existing escape ladder runs regardless; it never waits | — | rescue is additive only |

---

## 7. How the stages compose with the queue's pieces

| piece | what comms takes from it | what comms gives it |
|---|---|---|
| townindex-01 (observe-only) | the `stock` observations (the same open-time reads) | ledger-01 can ride in the same canary, both observe-only (C2) |
| indexsearch-01 | — | its search keeps reading town memory in v1; a later switch to the ledger's `stock`/`checked` is a refactor, not a gain |
| townplan-01 / found-01 | cell `claim`s (reserved / placed) are mirrored | stage-2 lines ("Taking the storehouse's metal section") |
| monument-01 / shaft-01 | segment leases → `claim`; placements → `progress` | the first real `need` (bill of materials) |
| the overseer (staff census S0 live; foreman later) | `claim`, `need`, `progress` in one place; the foreman's role leases are mirrored | a shared, fenced view, instead of a fold of separate files per tick |
| expansion (E0, expedition-01, outpost-01) | `discovery` entries from region scans | shown on the map and in chat; outposts' supply `need`s |
| showcase | ledger + talk-01 + markers + captions | what the owner sees |

---

## 8. Build order, tiers and a timeline

Each step is a separate, small change, built with both engines and the full runner (`npm test`). The queue owner places
each in the one canary lane.

| # | step | what | tier / read | needs | rough timing (one lane) |
|---|---|---|---|---|---|
| 0 | **chatgate-01** | owner whitelist for `commands.mjs`; `_chat_ignored` count | owner-direct with a tripwire (Paper: a peer line and a human `!goto` do nothing; the whitelisted name's `status` works; fleet: 0 chat-triggered rows before and after) | C4 | build 1 day; roll out between canaries; **before the showcase bots start** (add to its start gate) |
| 1 | **ledger-01** | the journal, the fold, dual-writes from world facts, town memory, furnace opens and leases; no reader | inside townindex-01's canary (both observe-only) or owner-direct with a tripwire (C2). Gates L1-L4 | townindex-01 re-varianted on the live tip | with townindex-01: days 3-7 |
| 2 | **talk-01** | templates + `_say` rows + caps; showcase marker generator; caption strip | tier 2 on 4 bench pools (T1-T5 + no harm), then the showcase follower; marker and caption scripts are host-side, on the showcase VM | 0, 1; C5-C8 | week 2 (when the showcase bots start) |
| 3 | **furnaceseen-01** | drain skips the walk to a live `empty` furnace | tier 2. Gate: 0 drain walks to a live-empty furnace; repeats per bot-h, difference-in-differences; guard: furnace output not left longer, smelt ingots not lower | 1 promoted | weeks 2-3, folded with the next smelt or drain change |
| 4 | **keepout-01** | `confirmed_hazard` refuses destinations and dig columns; the climb filter | tier 3, the underground-safety lane; the draw must include towns with a confirmed site (hive-b today); Paper: the hive-b chain; deaths are a tripwire (rare); primary: entries into confirmed discs per bot-h, difference-in-differences | 1 promoted; its own design with both engines (C3) | weeks 2-4, **before expedition-01** |
| 5 | claims mirror | found-01, monument-01 and furnace leases mirror into the ledger | no slot of its own: inside those canaries (a duplicate-claim gate) | 1 | with found-01 / monument-01 |
| 6 | **stage 3a** | `need` (derived) + REQUEST / OFFER / AWARD / DELIVER for project supply | tier 3 with the foreman's S1/S2 on monument-01 (§6.3) | monument-01 KEPT; foreman S0 passed | weeks 4-6+ |
| 7 | bench `request` verb | the brain may request (a verb in the existing call) | model bench crossover (learning loop after M6) | the bench VM; 6 | after the learning loop's M6 (~4 weeks+) |
| 8 | rescue census | host-side, read-only | no slot | homefix-02 decided | any time; rescue design only after it |

The dates are a recommendation, not a queue entry. The live operator session owns the queue (STATE 10-19 12:45Z
COORDINATION). Today's head is homefix-02 (live since 18:05Z), then ironpick-01, protectzone-01, townindex-01 and
indexsearch-01.

---

## 9. Owner decisions (with recommendations)

| # | decision | recommendation | why |
|---|---|---|---|
| C1 | Build stage 1 as a substrate, knowing its bench payoff today is small (about 1 bot-h a day plus part of about 1.7 deaths a day), instead of a standalone "sharing" canary | **yes, as designed** (ledger-01 observe-only, then consumers) | §2: the cheap sharing already exists; the coming projects need claims and needs; talk must come from facts |
| C2 | ledger-01 rides in townindex-01's canary, or rolls out owner-direct with a tripwire | **ride with townindex-01** if its variant is not yet built; otherwise owner-direct | both are observe-only; one slot instead of two |
| C3 | keepout-01 (a confirmed hazard as a hard planner constraint) goes into the underground-safety lane ahead of expedition-01 | **yes** | hive-b's lava pool: 6 deaths by 5 bots in 3 days with the site on file |
| C4 | chatgate-01: chat commands only from `OWNER_CHAT_NAMES`; bench empty; showcase `mike` limited to `status` / `stop` / `resume` | **yes, first** | today any player name commands every bot; 0 uses in 24 h |
| C5 | Stage 2 on the showcase only (bench quiet except talk-01's no-harm pools) | **yes** | talk is for the owner; the bench measures behaviour |
| C6 | Templates only, or templates + an LLM rewording with the no-new-facts validator | **templates first**; rewording after talk-01 is KEPT, if the owner wants livelier text | templates are testable and free; rewording costs about 0.4 GPU-min/h and adds a failure mode |
| C7 | Keep the bench `[fleet]` hazard lines | **keep, unchanged** | harmless; their ingestion is redundant but tested; removing them is churn |
| C8 | Timelapse caption strip at video build (frames untouched) | **yes** | the archive stays clean and the captions are reversible |
| C9 | Stage 3 v1 = item requests through town containers + split builds through the foreman; rescue deferred behind a census | **yes** | §2.5-2.6: no surplus to offer under today's keep rules; distress is underground |
| C10 | Bench brains never author messages in v1; a `request` verb is a model-bench experiment | **yes** | the board: optional, model-chosen communication goes unused; MineCollab: prose costs 15% or more |

---

## 10. What would change the answer
- **A world whose bots span two hosts:** the ledger would need the chat mirror (or a shared mount) for `death` and
  `confirmed_hazard`.
- **A measured predictive peer signal** (a class where a townmate's failure *does* predict mine): it could become a
  `checked` type with quorum 2. §2.4's test is the template for checking, and it is in `tools/`.
- **A banking rule that leaves real surpluses in bags** (iron or coal above a keep threshold): offers would become non-empty,
  and stage 3a's item requests could come before the foreman.
- **The showcase brain proving it acts on read-only town lines** (a sharp change in what it chooses, on behaviour): the
  brain `request` verb might move ahead of the bench test there. Not on the bench.

---

## 11. Reviews
Round 1 is pending. Summaries are added here, and the full text is in `docs/reports/comms-design-reviews-2026-10-21.txt`.
