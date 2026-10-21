# Bot-to-bot communication in three stages, measured first (2026-10-21, design only, r5)

OWNER 2026-10-21 ~21:10Z: "i would like ... to integrate some kind of communication into our platform where bots are
sharing information and communicating". Then "yes" to a staged plan:
1. automatic structured fact sharing;
2. visible plain-language chat;
3. real conversations.

This is a design, not a build. No bot code was written, nothing was deployed, and no queue, scheduler, manifest, bot or
showcase file was touched.

**Sources (all read-only).**
- **Rows:** 24 h of skill rows from the 12 shared towns, read with `scripts/lib/telemetry.Events` on 10.0.0.31 (full
  walk, `nice -n 19`).
  - Window: 10-20 20:31Z to 10-21 20:33Z.
  - 1,145,782 rows, 60 bots, about 1,441 bot-h.
- **Deaths:** 9 days of `_death` rows from Elasticsearch, through `scripts/lib/estelemetry.EsEvents`. The first 2 days
  warm up the replay and the last 7 are judged.
- **Other reads:**
  - the pool state files under `/var/lib/mcai/_pool-*/`;
  - one bot's journal per town;
  - two Paper logs on 10.0.0.30.
- **Where everything is:** the scripts are in `docs/reports/comms-design-2026-10-21/tools/` (as `.py.txt`), and their
  outputs are in `data/`. Rounds 2-5 re-measured everything the reviews questioned (`v3.py.txt`, `deaths_v5.py.txt`;
  v3 = v2 plus the logEvent timestamp fix and JavaScript rounding, and its numbers equal v2's to the row or within 1);
  the r1 numbers are kept in `data/` for comparison. The reviews are in `docs/reports/comms-design-reviews-2026-10-21.txt`.

**Timing rule for every measurement.**
- A skill row (`logSkill`, no leading underscore) stamps its skill's start (`startedAt`), and its `bot.pos` and
  `bot.inventory` are the snapshot at completion (start + duration).
- An event row (`logEvent`, leading underscore, e.g. `_toolkit`) stamps its emission, and its snapshot is at that time.
- So a fact from row q is available from q's *completion* (skill rows) or emission (event rows).
- A row's pre-action position is the bot's newest snapshot before the row started.

**What the window contains.**
- The fleet ran 9e7d9980 until toolkit-03 (34d3e5e9) was promoted at 13:37Z. toolkit-03 was a canary on board-a,
  placebo-a and hive-b until then.
- homefix-02 was a canary from 18:05Z on placebo-d, hive-a, board-c and board-b: 20 bots, for 2.5 h of the 24.
- The counts are descriptive, not an arm comparison.
- "Shared towns" means the 12 board, hive and placebo worlds. isolated-b became a shared town at 13:53Z and is not
  included.

---

## 0. Answers first

**1. The fleet already shares facts through files, so the remaining headroom on the bench is small.** Every bot of a town
runs on one host and shares the town's state directory. The shared stores are:
- `world-facts`: hazards, death sites (priced into every path), resource sightings and milestone give-ups;
- town memory: "looked, none" per container, which a deposit clears;
- furnace leases;
- the generation files for plinths, tree farms and the siting file;
- the cobble journal.

None of these goes through the model. **What is left that a shared fact could save (§2):**
- **Repeated "looked, none" in town:** 2.6-4.5 bot-h a day out of 1,441 (0.18-0.31%). The low end is r1's conservative
  count and the high end r3's nearest-predecessor count (§2.1).
  - The one class that is not shared today is a furnace found empty again by another bot within an hour: 391 of 922
    drain checks, 1.07 bot-h.
  - Kit iron is solved: after toolkit-03's promotion, 2 of 81 toolkit runs failed for want of iron.
- **Concurrent town jobs:** leased jobs overlap another bot 0-1% of the time. smelt_town overlaps 7.9%, and those runs
  were *less* often futile than solo runs (51.5% against 72.6%). That is plausibly parallel work, not duplication.
- **Duplicate builds:** cannot be measured. No multi-bot project is deployed: 0 project rows in 24 h, while the same
  pattern finds the plinth and board rows.

**2. Deaths at a known hazard are real, but more messaging will not fix them.**
- **Replaying the production death-site rules over 7 days:**
  - 13 of 171 deaths (7.6%) happened inside a live death site. 11 of those sites held another bot's earlier death.
  - This is an approximate replay (`data/deaths_v5.out`). It does not replay the 120-site cap.
  - On write order it brackets production with two extremes, which give identical counts:
    - the file pruned just before every death;
    - the file pruned only by the death writes themselves (merge-before-prune on stored counts).
  - **4 deaths were inside a site that met a "confirmed" rule** (at least 2 deaths by 2 bots), all at one hive-b lava pool
    at (335-337, 38, 154). That pool had 6 deaths by 5 bots from 10-19 to 10-21.
- **The site's centre had been shared and was being read:**
  - 1,219 `_death_site_route_crossed` rows in 24 h;
  - Alpha's and Echo's routes paid the site's price in the minute before they died. The price was paid, not avoided:
    their dirt gathers' targets were inside the disc.
- **The mechanism, from the rows:** three of the four confirmed deaths fall inside the 24 h window.

  | death | what the bot was doing | how it reached the lava |
  |---|---|---|
  | Echo | a dirt gather from y 43 | the gather carried it down to y 38 (no fall row) |
  | Alpha | a dirt gather at the pit edge | fell 6 blocks just after |
  | Bravo | standing above the pool about 2.5 min after reaching a goal | fell 9 blocks without a dig of its own |

  - The pathfinder never prices a drop-down landing cell (`deathsites.mjs` says so).
  - Nothing stops a gather or dig in the column above the pool.
  - Comet's 10-20 death is outside the rows read here.
- **So the fix is a safety change** (keepout-01, §8): refuse dig and gather candidates in the column above a live
  **fire** death site, wherever the bot stands.
  - It directly targets **2 of those 3** (Echo, Alpha). Bravo's unpowered fall needs the separate drop-landing variant.
  - Triggered by any live fire site, it would have covered 7 of the 52 fire deaths in 7 days, against 4 for the "2 deaths
    by 2 bots" rule. At 10-21 20:00Z there were 6-8 live fire sites in 5-7 towns (by write order). One-death sites lapse in about 36 h, so
    the draw list is recomputed at launch.
  - It reads world facts directly and needs no ledger.

**3. Sharing one bot's failure to *reach* something spreads errors. Measured with completion-time availability and
pre-action positions (`data/v3.out`):**
- **Gather:** after a townmate's completed failure of the same block within 16 blocks (dy ≤ 8) in the last 30 min, a
  bot's gather failed 31.7% of the time (n = 574). After no prior failure it failed 37.5% (n = 8,487). After its *own*
  failure it failed 65.1% (n = 8,515).
  - The same holds at radius 4, 8 and 32, and per block (dirt: 28% after a peer, 28% after none, 40% after its own).
  - A veto on a townmate's failure would have refused 909 gathers that succeeded.
- **Iron sightings:** with a full 60-min follow-up, a bot harvested iron after another bot's fruitless visit 2.3% of the
  time (n = 2,819), against 2.4% with no completed peer visit (n = 2,221).
- **But the fleet already does this:** a townmate's milestone give-up within 64 blocks cuts a bot's own budget from 25
  attempts to 8 (`milestones.mjs`). 347 of the 374 attempt-count skips in 24 h used the shortened budget
  (`data/milestone_skips.txt`).
- **The rule for stage 1:**
  - **share the state of the world, read from the server** (what a container or furnace holds, a death, lava at a place,
    a placed cell);
  - **never share one bot's failure to get somewhere;**
  - the milestone give-up path is retired only after its own measurement (unreach-01, owner decision C11).

**4. Stage 1 is a typed town ledger (§4).** Skills write it as part of their work; the model is never involved.
- **What it holds:**
  - *authoritative* for the facts no store holds today: furnace state, claims of project jobs, progress, discoveries,
    needs, and the stage-3 messages;
  - a *mirror* (with a pointer) of the facts that already have an owner: townindex's stock, town memory's misses, world
    facts' deaths and hazards.
- **Fact types:** each has its own evidence, adoption, disproof and expiry rule.
  - Disproof is a world read that covers the cells it is about.
  - Missing coverage means *unknown*, never *gone*.
- **Transport:** the cobble journal's proven append protocol, in the town's state directory.
- **Writes:**
  - transitions such as a release, a disproof, a cancel or a delivery are never dropped;
  - repeated observations are coalesced, with a durable refresh every 10 min.
- **First canary, ledger-01:** observe-only. Its gate is that the ledger's view must match the stores it mirrors, after
  their cap and merge rules are replayed.

**5. Stage 2 is plain-language chat for the owner and the showcase (§5).**
- **Wording:** lines are made from ledger events by templates. A cheap LLM may only *choose among* pre-written phrasings,
  each keeping its slots (actor, relation, polarity, quantities). Free rewording stays off.
- **Where it shows:** in-game chat, BlueMap markers and a caption strip in the timelapse.
- **Rate and parsing:** at most 1 line per bot per 2 min and 1 per town per 20 s. Lines are never parsed back.
- **chatgate-01 comes first** (two measured findings):
  - `commands.mjs` obeys `!stop`, `!goto x y z`, `<bot> come` and the rest from **any** player name.
  - comms.mjs's peer ingestion is **not working**. hive-a's server carried 17 `[fleet]` lines from 4 peers today, and
    hive-a-Alpha's journal logged 0 ingestions in 24 h. The other 11 towns' bots show 0 as well (`data/chatcheck.txt`).
  - chatgate-01 restricts commands to an owner whitelist and retires the dead, forgeable chat ingestion. The `[fleet]`
    announcements stay.
  - The stage-2 code ships in the same build behind `TALK=off`, and is switched on only on the showcase.

**6. Stage 3: requests and split builds, with the foreman, then rescue only after a census (§6).**
- **Protocol:** REQUEST → OFFER → AWARD → DELIVER, with CANCEL and EXPIRE, as Contract Net.
  - It is a fenced state machine in the ledger.
  - Offers come only from a deterministic bag-surplus rule, with the quantity reserved.
  - Delivery is into a container in the courier's own town, proved by a server read.
  - No bilateral trade in v1.
- **The headroom today is small:**
  - at "no coal" stops a townmate carried coal 49.0% of the time, against 45.3% at town-matched moments, and 8 or more
    coal 0% of the time;
  - distressed bots had a townmate within 32 blocks 25.6% of the time, against 29.7% at matched moments.
- **So stage 3a starts with the first live multi-bot project (monument-01) and the foreman, through its S0-S3 gates.**
- **Model bench:** the bench brain gets a `request` verb only as an experiment there. The bench splits each world 3/2, so
  cooperation itself must be read at the town level in the canary lane.

**7. Build order:**
1. a Paper probe of the chat event, then chatgate-01 with TALK off;
2. keepout-01 (safety; no ledger needed);
3. ledger-01, with or after townindex-01;
4. the showcase's TALK switch, plus its markers and captions;
5. furnaceseen-01;
6. the claims mirror inside found-01 and monument-01;
7. unreach-01 (measure first);
8. stage 3a with the foreman;
9. the bench `request` verb;
10. the rescue census.

Tiers and timing are in §8; owner decisions C1-C12 are in §9.

---

## 1. What already exists

| channel / store | medium | written by (automatic?) | read by | trust and lifetime |
|---|---|---|---|---|
| `world-facts-<pool>.json` hazards | pool dir, read-merge-write with atomic rename; **`MAX_SITES` 120 shared with death sites** (placebo-a 119, board-b 118, placebo-d 116 in today's files, so death sites can be evicted) | reflexes, after **2 personal hits** (`CONFIRM_AT`) | prompt lines (`promptLines`) | halves every 12 h; `by` list |
| world facts: **death sites** | same file | the death handler (`reportDeath`): weight 4; merges a same-class death within 3 blocks / 3 y of the kept centre (+4 per death) | **the pathfinder**: cells within 6 / 6 cost 16 (a detour; above 100 a move is deleted). Explore refuses a sighting within 12. Line walks are checked. **Drop-down landings are not priced** | live while the weight is at least 1: 36 h after a single death, longer when merged |
| world facts: resource sightings | same file (cap 200; **all 12 towns at 200**) | the affordance survey (every 20 s); merged within 24 blocks | explore `knownTarget`: **all 15,028 explore runs in 24 h contained a heading at one** (per-run join) | halves every 12 h; no disproof |
| world facts: `unreachable` (milestone give-ups) | same file; also announced as `[fleet] ... unreachable` | the cognitive loop on a give-up | **milestones: a townmate's give-up within 64 blocks cuts the budget from 25 attempts to 8.** 347 of 374 attempt skips used 8 | 24 h |
| town memory (`town-chest-<home>.containers.json`) | pool dir | deposit, withdraw, toolkit and smelt searches | the same (`townSearchEmpty`) | per container and need: 60 min (pickaxe, sticks), 2 h (copper, coal); a deposit (`o='took'`) ends a miss |
| cobble journal + checkpoint + sealed generations | pool dir, append-only | town deposit, recount | cobblecap, stock targets | fold of the whole history |
| furnace leases (`furnace-leases/`) | pool dir | smelt, smelt_town, drain | the same | lease TTL |
| plinth, tree farm, siting file, monument (designed) | pool dir, compare-and-swap by `link()` | the projects | the projects | immutable generations |
| `[fleet]` chat (`comms.mjs`) | in-game chat | reflex hazards; milestone give-ups (20 s per bot floor) | **nobody, in practice.** 0 ingestions in 24 h in 12 journals, while the server carried the lines (`data/chatcheck.txt`). When it worked it accepted any name with the fleet's hyphen count, and free hazard text (24 chars) that reaches prompt lines | redundant with the file on one host, by its own comment |
| lectern board (`board.mjs`) | pool dir | the `board` verb (the model's choice) | the same verb | typed quorum, disproof outranks quorum, two clocks. **24 calls in 24 h from 20 board bots** |
| chat commands (`commands.mjs`) | in-game chat | a human | **any player name**, for `stop`, `resume`, `status`, `help`, `goto`, `come`, `follow`, `gather`, `home`, `deposit` | none (§5.3) |

**Hosts.**
- All 80 bench bots run on 10.0.0.31.
- The showcase's 10 bots run on their own VM (10.0.0.40) with their own world.
- No world's bots span hosts, so a file reaches every reader that matters.
- **Identity:** bench bots connect offline-mode and the showcase runs `online-mode=false` with a whitelist. A player name
  is therefore not authentication. Trust in a chat name rests on LAN access plus the server whitelist.

---

## 2. What was measured (denominators first; every zero has its positive control)

### 2.1 Repeated "looked, none" in town (`data/v3.out` [R]; r1 in `opps.out`)
**Definitions.**
- A *repeat* is a negative whose clean predecessor was reported by another bot of the same town. A clean predecessor is
  a negative completed within the window, with no refill completed between the two.
- **Refills:**
  - for containers, any deposit or town_deposit success in the town. This is a town-wide proxy, which makes the count
    conservative. The rows do not name a container per item.
  - for a furnace, a non-drain `_furnace_session` on that furnace. Such a session is not necessarily a load, so this is
    also conservative.
- **Two ways to count:** "nearest" requires the nearest clean predecessor to be another bot; "any" requires any clean
  predecessor to be.
- **r1 for comparison:** r1 counted smelt_town successes and furnace sessions as container refills, and stopped at the
  latest same-bot negative. That is the low end of the range.

| negative | all (bot-h) | nearest is another bot (bot-h) | any peer | r1 (conservative) | shared today? |
|---|---:|---:|---:|---:|---|
| furnace_drain "is empty", same furnace, 60 min | 922 (2.57) | **391, 42.4% (1.07)** | 393 | 390 | **no** |
| smelt_town "no raw copper", 2 h | 1,240 (4.05) | 754, 60.8% (2.43) | 938 | 332 | yes, per container; the repeats include the search continuing through containers not yet looked in |
| smelt_town "no coal", 2 h | 247 (1.33) | 150, 60.7% (0.74) | 186 | 58 | yes |
| toolkit `kit_no_iron`, 60 min | 188 (0.27) | 103, 54.8% (0.14) | 113 | 21 | yes. After the 13:38Z promotion: 2 failures in 81 runs (before it: 186 in 335) |
| withdraw_pick "no usable pickaxe", 60 min | 231 (0.64) | 46, 19.9% (0.11) | 64 | 2 | yes |

- **A query bug caught by its own control.** The r1 furnace query first printed 0 repeats and 0 own repeats: it counted
  the drain's own session (`by=drain`) as a refill. The overseer census found the same class at 316 of 764 (41.4%) on
  10-19.
- **Size:** the median negative lasts 2-12 s. In total the repeats cost 2.6 bot-h a day (r1, conservative) to 4.5
  (nearest-predecessor) of 1,441. This is a **proxy**: it is the time in repeats, not proven avoidable time. The
  "any peer" column is a count only.

### 2.2 Concurrent town jobs (`v3.out` [O], complete interval sweep)
A run counts as an overlap when it starts while another bot of the town is inside the same job (on the same furnace, for
the drain):

| job | runs | overlapping |
|---|---:|---:|
| smelt_town | 2,098 | 165, 7.9%: **51.5% of them no_effect, against 72.6% of the 1,933 solo runs** |
| furnace_drain | 1,726 | 0 |
| dispose_well | 121 | 0 |
| toolkit | 416 | 4 |
| withdraw_pick | 389 | 2 |
| deposit | 442 | 4 |
| town_deposit / compost | 136 / 68 | 0 |

- The positive control is that the same sweep finds the smelt_town overlaps.
- Overlapping smelt runs are plausibly parallel work. A selection effect is possible: overlaps happen when there is
  copper.
- Why leased jobs do not overlap is not shown. Leases are a likely reason, not a proven one.
- **Multi-bot projects:** 0 rows matching monument, project, ziggurat, yard, shaft, tree farm or blueprint. The same regex
  finds `_plinth_step` 12, `build_plinth` 2 and `board` 24.

### 2.3 Deaths at a known site (`data/deaths_v5.out`; ES query 10-12 20:00Z .. 10-21 20:00Z = a 2-day warm-up + 7.0 judged days)
**The replay follows production:**
- reportDeath reads the stored sites, merges a same-class death within 3 blocks / 3 y (+4 to the *stored* count,
  `last` reset), then prunes (one halving per whole 12 h, weight < 1 dropped). It is run at both write-order extremes;
- live while the weight is at least 1;
- covered when within 6 blocks / 6 y of any live centre.

It does not replay the 120-site cap (shared with hazards), and eviction could change which centres survive. So the
counts are **approximate**, not a bound on production.

**Reconciled:** 33 deaths in the 24 h file window = 33 in ES for the same window, matched row for row. r1's "31" came from
its control's own window.

| 171 judged deaths (both write-order extremes agree) | count |
|---|---:|
| no live site | 158 |
| site holding another bot's death | **11** |
| site from its own deaths only | 2 |
| **inside a CONFIRMED fire site** (live; at least 2 deaths by at least 2 bots) | **4**: hive-b Comet 10-20 09:42, Echo 10-21 06:10, Bravo 06:58, Alpha 08:35 |

- **Deaths by class (the 171 judged):** drowning 65, fire 52, fall 24, other 16, suffocation 14.
- **r1's control** (24 h, its 36 h discs): 0.14% of uniform-time bot positions were inside a live disc, while 5 of the 31
  deaths in its window were. This is descriptive and the death count is small.
- **The hive-b chain** (`data/hiveb_chain.out`):
  - **Alpha 08:35:** gathering dirt at (334.5, 38, 154.5). In the minute before, three routes crossed the site's centre at
    y 44-48 and paid its price. `_fall_path`: "fell 8 ... ended by goal_reached 2s ago (liqdrop=true)", then "tried to
    swim in lava after falling 6 blocks".
  - **Echo 06:10:** gathering dirt at y 43, then the lava corridor refused the leg ("lava below at 334,38,154"), then
    another dirt gather took it down to y 38, where it died. There is no fall row.
  - **Bravo 06:58:** explore. Its goal had been reached about 152 s earlier above the pool. Its blind steps were refused
    ("lava below"), then it "fell 9", then died, without a dig of its own.
- **Reading:**
  - The site was on file and read. The price was paid, not avoided: the gather targets were inside the disc.
  - The killing moves are a gather or dig in the column above the pool (Echo, Alpha), and an unpowered drop (Bravo).
  - **Opportunity, by trigger** (`data/deaths_v5.out`):
    - 4 deaths in 7 days at a site with at least 2 deaths by 2 bots, all at one pool;
    - **7 of 52 fire deaths** inside a live fire site with at least 1 death;
    - 11 deaths of any class at a site holding another bot's death.
  - **v1 (dig and gather refusal) targets the gather share of these.** The drop share needs the second variant.

### 2.4 Does a townmate's failure predict mine? (decides what stage 1 must NOT share; `v3.out` [G] [S])
**Gather** (success and failed rows). A prior failure counts only if it *completed* before the current gather started,
was of the same block, and is within R blocks and 8 y of the bot's *pre-action* position:

| radius / window | peer only | own only | none |
|---|---:|---:|---:|
| 4 / 10 min | 34.8% of 92 | 67.9% of 6,875 | 39.1% of 11,251 |
| 8 / 30 | 32.2% of 348 | 66.8% | 37.4% |
| 16 / 30 | 31.7% of 574 | 65.1% of 8,515 | 37.5% of 8,487 |
| 32 / 60 | 33.2% of 1,628 | 67.0% | 37.4% |

Per block at 16 / 30:

| block | peer only | own only | none |
|---|---:|---:|---:|
| dirt | 28% of 541 | 40% | 28% |
| iron ore | 71% of 14 | 85% | 70% |
| sand | 16 of 16 | 95% | 88% |
| oak log | 2 of 3 | 98% | 42% |

- A veto on any townmate failure would have refused **909** gathers that succeeded.
- The `own` effect is large and consistent. The `peer` effect is nil or slightly negative.
- **Limits:**
  - positions are snapshots, not the gather's target cell;
  - stratification is by block only;
  - the peer cells for sand and logs are small.

  So this is strong evidence that a peer's failure carries no information, and grounds for the rule. It is not proof for
  every block.

**Iron sightings.** An episode is the first heading at a sighting within 60 min, and only episodes with a complete 60-min
follow-up count (224 excluded). The class comes from the *latest* completed peer episode. The outcome is an iron gather
within R blocks and 16 y:

| R | no completed peer episode | after a peer's fruitless visit | after a peer's harvest |
|---|---:|---:|---:|
| 24 | 0.6% of 2,221 | 0.6% of 2,856 | 0 of 15 |
| 48 | 2.4% of 2,221 | 2.3% of 2,819 | 5.8% of 52 |

The positive control is the 314 iron gathers in 24 h (`extras.out` [E1]). Explore spent 100.4 bot-h steered at these
sightings. That is a target-choice problem for the expansion lane; a message would not fix it.

**The live exception:** milestone give-ups (`data/milestone_skips.txt`). 347 of 374 attempt-count skips used the
peer-shortened budget of 8. Whether those skips were wrong is not measured; that is unreach-01's read (C11).

### 2.5 Needs and offers (`v3.out` [N]; one town-matched control moment per event × 5)
| shortage | at the event | town-matched control |
|---|---:|---:|
| smelt_town "no coal" (n = 247): a townmate's bag held at least 1 coal or charcoal | 49.0% | 45.3% |
| the same, at least 8 | 0.0% | 1.2% |

- Holding is not surplus: the keep rules (IRON_LADDER) hold coal for the bag's own use.
- The overseer census reached the same reading (C4, C7): a banking rule takes this more cheaply than a message.

### 2.6 Distress (`v3.out` [P])
- 952 episodes in 24 h, counting one per bot per 30 min: `_entombed_unrecoverable` 676, `_recovery_exhausted` 183,
  `_stranded_unrecoverable` 93.
- A townmate was within 32 blocks and 16 y in 25.6% of them, against 29.7% at town-matched control moments.
- 9 died within 30 min (`extras.out` [E3]).

### 2.7 The chat channel (`data/chatcheck.txt`)
- **Commands:** 0 "chat command" journal lines in 24 h, in one bot's journal per town (12 journals). The positive control
  is 2,668-4,327 INFO lines in each.
  - The journal line covers `stop`, `resume` and `help`, which leave no skill row.
  - 0 skill rows had `trigger=chat` (29 trigger values were recorded).
- **Peer ingestion:** 0 "peer reported hazard / peer gave up" lines in the same 12 journals. The positive control is the
  Paper log: hive-a's server carried 19 `[fleet]` lines today, 17 of them from hive-a-Alpha's 4 townmates.
  - So ingestion does not work. It may be the same `chat` event that `commands.mjs` uses, which is not diagnosed here.
  - Whether `commands.mjs`'s listener fires at all is therefore **unknown**. The gate is needed anyway: one library or
    format change re-arms it.

---

## 3. Prior art (searched 10-21; links and quotes in the reviews file, round 0)

| work | mechanism | what was measured | lesson taken |
|---|---|---|---|
| **Project Sid / PIANO** (arXiv 2411.00114) | about 10 concurrent modules; one cognitive controller sends a single decision to talk and action | role specialisation, memes and religion were read from **speech**; only tax compliance (deposits) was an action | judge on actions. Talk is *generated from* actions, so it cannot drift from them |
| **Mindcraft / MineCollab** (github.com/kolbytn/mindcraft; arXiv 2504.17950) | pairwise LLM conversations; busy/idle gating | success fell from up to 90% to under 30% going from 2 to 5 agents. Explaining a plan in words cost over 15% | typed facts and pointers, not prose. Talk never pre-empts work |
| **VillagerAgent** (arXiv 2406.05720) | a task DAG, a controller assigning *ready* subtasks, a shared state manager | against AgentVerse: failures 18.2% vs 44.4%, completion 73.75% vs 29.75%, tokens 1.79 vs 10.3 | claims and requests live in a structured store with an assigner: the foreman plus leases |
| **MineLand** (arXiv 2403.19267) | distance-limited chat; messages can interrupt code | chat overhead ate part of the cooperation gain | scope to the town; **messages never interrupt a skill** |
| **Generative Agents** (arXiv 2304.03442) | memory stream, reflection, word of mouth | the party spread from 1 to 13 of 25 agents and 5 of 12 invitees came; facts were embellished | measure arrival. Relay records, not retold text. Hence slot-preserving phrasings only |
| **Blackboard systems** (Nii 1986, AI Magazine 7(2); LbMAS, arXiv 2507.01701) | typed entries plus a control component; cleaner and conflict-resolver roles | LbMAS 81.68% vs 80.56% with fewer tokens | the ledger is a blackboard. It needs expiry (the cleaner) and disproof (the conflict-resolver) |
| **MAST** (arXiv 2503.13657); flooding (arXiv 2407.07791) | a failure taxonomy; poisoned facts that persist in agent memory | inter-agent misalignment about 32%; false facts spread | provenance, expiry and a world-read check on every shared fact |
| **Contract Net** (Smith 1980, IEEE Trans. Computers C-29(12)) | announce / bid / award / report; `cancel` without penalty | — | stage 3's protocol, plus deadlines and a commitment cost |
| **BlueMap** (wiki "Markers"; BlueMapAPI wiki; CLI source `BlueMapCLI.java`) | config marker sets and an API (API markers not persistent). The CLI reads config markers and has a markers update path (Codex r1, from the CLI source) | — | the showcase renders with the CLI, so config marker sets regenerated before each capture. Verify on the pinned jar (§5.2) |

---

## 4. Stage 1: the town ledger (automatic, typed, written by skills)

### 4.1 Principles (each is a measured lesson)
1. **Automatic.** The skill or reflex that observed a fact writes it, as part of its work. No model decision writes or
   gates an entry.
2. **World state, never reachability** (§2.4). Shareable facts are server reads or server events: a container's
   contents, a furnace's slots, a death, lava seen at cells, a placed cell. "I could not reach X" stays private.
   - The one live exception, the milestone give-up, is measured before it changes (unreach-01).
3. **Disproof outranks quorum, and needs coverage.**
   - A disproof is a world read of the very cells the fact is about, all loaded.
   - Partial coverage leaves the fact `unknown`, never gone.
   - A bot passing a hazard safely disproves nothing.
4. **Provenance.** Every entry carries `by`, `code`, its evidence class and the ids of the rows it came from.
5. **Peers inform, never command.**
   - No entry names a skill, a goal, or a coordinate a bot must go to.
   - Every consumer is a deterministic planner with its own eligibility and remedy chain.
   - The ledger can only remove a futile option or reorder options a planner already has (the overseer's lease rule).
   - The one exception is stage 3's DELIVER, whose destination comes from a peer. It is bounded in §6.1: the courier opts
     in through its own deterministic OFFER, and the destination must be a container in its own town.
6. **Nothing reaches a prompt as free text.** Any ledger field that a prompt or chat line can show is one of:
   - an enum;
   - a name from the item or block registry;
   - a fleet bot name;
   - a number.

   `reason` fields are enums. Writers refuse free text.
7. **Absent or corrupt means today's behaviour** (`LEDGER=off` is the rollback).
8. **One authority per fact.** Where a store already owns a fact, the ledger mirrors it with a `ref` and never decides
   against it.

### 4.2 The fact types

| type | authority | written by (automatic) | evidence | adopted when | disproved by (outranks quorum) | expires | consumer |
|---|---|---|---|---|---|---|---|
| `death` | world facts (mirrored) | the death handler | the server's death event, with position and class | always (an immutable event) | never (it is a past event) | display: 7 d | stage 2; keepout reads world facts directly |
| `hazard` (inferred: entombed, drowning spot, lava seen) | world facts (mirrored) | reflexes, at 2 personal hits (today) | own reflex rows | as today | lava: a read of the hazard's recorded cells, all loaded, showing no lava. Other kinds: none defined (expiry only) | as today (halves every 12 h) | prompt lines (today) |
| `fire_site` (derived; **fire/lava deaths only**) | **world facts**: a pure function in deathsites.mjs (`fireSites(sites)`) plus a `disputed` field on the site, written by the lava read. keepout-01 and the ledger mirror both read this one component | — | any live fire death site: a death is a server event, so 1 is enough. `confirmed` (≥ 2 deaths by ≥ 2 bots) is reported as a stratum, not a gate | derived | a lava read of the site's 6-block disc, every cell loaded, showing no lava → `disputed` (kept; the next fire death clears the dispute). It is taken by keepout-01's own refusal path, when the refusing bot is within loaded range of the disc. Keep-out keeps bots away, so **in practice expiry is the usual exit** | while the site is live | keepout-01. **Water, falls, other and unknown never qualify** ("water is terrain") |
| `stock` | **townindex-01** (mirrored) | townindex's observation at each open | the server window | as townindex | as townindex (`dirty`, newer observation) | as townindex (`stale` at 6 h) | the foreman's input (later) |
| `checked` (container C has none of X) | **town memory** (mirrored) | the search that opened C | the server window | as today | a deposit into C (`took`), or an observation of C holding X | 60 min / 2 h (today) | the searches keep reading town memory |
| `station` (furnace F's input, fuel and output) | **the ledger** | every furnace open (drain, smelt, smelt_town) | the server window | 1 | a later open of F; any load session on F | 60 min, refreshed by each open | furnaceseen-01 |
| `claim` | **the lease file** (mirrored): found, monument segment, furnace lease, plinth, tree farm | the project, when it takes or loses its lease | the lease write | the lease protocol decides (CAS, `link()`, `wx`) | `released`, or lease expiry | the lease TTL | stage 2; the foreman; the duplicate-claim gate |
| `progress` | **the ledger** | builders, after a server-witnessed placement | placement read-back | 1 | — | display: 24 h | stage 2, captions, the foreman |
| `discovery` | **the ledger** (E0 keeps its own frontier file) | expedition region scans; a structure seen | world read | 1 for display; 2 different bots before a planner uses it | a later scan of that region | 7 d | E0, expedition targets, stage 2 |
| `need` (derived) | the fold | — | `stock` + a project's bill of materials | derived | `stock` shows it met | when met, or 2 h | the foreman's SUPPLY role (stage 3a) |
| `request` / `offer` / `award` / `deliver` / `cancel` | **the ledger** + award lease files | §6.1 | | | | | |
| **NOT a type** | — | gather or goto "unreachable", fruitless visits, path failures, lessons, avoid rules, sighting "gone" (§2.4 found no value; a sighting is merged over 24 blocks, so no read can cover it) | | | | | private |

**Scope.**
- One ledger per town (pool + home + world). An entry whose `world` differs is absent.
- An isolated-scope bot neither writes nor reads.

### 4.3 Entry, file, protocol, fold
```json
{"v":1, "id":"hive-a-Bravo:1792603123456:17", "type":"station", "world":"<world id>", "town":"355_73_147",
 "subject":{"furnace":"356,72,145"}, "fact":{"input":0,"fuel":0,"output":0,"state":"empty"},
 "obs":"server_read", "evidence":["<row ts>"], "by":"hive-a-Bravo", "code":"34d3e5e9",
 "observed_at":1792603123456, "posted_at":1792603123460, "until":1792606723456}
```
- **File:** `/var/lib/mcai/_pool-<pool>/ledger-<home>.jsonl`.
- **Writes:** cobblecap.mjs's appender (`'\n' + json + '\n'`; torn lines skipped).
- **Generations and checkpoint:** sealed generations (`wx` seal, `link()` base, a reader folds base N + generation N
  only), and a checkpoint by atomic rename.
- **The protocol is reused, not reimplemented,** including cobblecap's "confirm before you mutate" re-read, used for
  claims and awards.
- **Fold:** one pure function, `ledgerView(entries, now)`.
  - It orders by `observed_at`, then `id`.
  - It stores state **before** expiry in the checkpoint, and applies expiry when it is read. So a checkpoint never bakes in
    one reader's clock.
- **The board's rules, adapted.** `board.quorumState` knows only `worked` against failure reports, so the fold uses a
  typed adapter:
  - `adoptRule[type](reports)` and `disproofRule[type](reads)`, each pinned by a behaviour fixture per type;
  - a disproof outranks reports observed *before* it;
  - a report observed *after* a disproof re-opens the fact (the board's "disputed is not deletion");
  - expiry is per type (table above), from `observed_at` for freshness and from the newest report for shelf life.
- **Size:** one line is at most 1 KB; anything bigger is refused and counted.
- **Bootstrap and reconciliation (for the mirrored types):**
  - **Who:** one reconciler per town per 30-min window. It claims the window with a `wx` marker
    `ledger-<home>.recon.<window>`; the other bots skip it.
  - **What it writes:** a `snapshot_begin {gen}` entry, then one bounded entry per subject (each under 1 KB), then
    `snapshot_end {gen, n}`.
  - **Ordering is by ledger append order (byte offset), never by timestamps.**
    - `snapshot_begin` is appended **before** the source is read.
    - Each snapshot entry carries the snapshot's `gen`.
    - Journal sources (townindex) also record their own revision, the byte offset read up to.
  - **How it is read:**
    - the fold uses a snapshot only when its end marker is present with the right count. An interrupted snapshot is
      ignored, and the next window redoes it.
    - a complete snapshot **replaces** the mirror's view of that store as of `snapshot_begin`'s offset. Subjects absent from
      it are removed.
    - every mirror entry appended **after** `snapshot_begin`'s offset is then replayed over it in offset order. That
      includes `removed` entries, whatever their `observed_at`, because such an entry may have been committed after the
      source was read. Entries before that offset are superseded.
    - equal timestamps never decide anything: offset order does.
  - **Tests:**
    - a reconciler killed mid-snapshot leaves the previous complete one in force;
    - a subject deleted at the source disappears at the next complete snapshot;
    - a mutation, or a deletion, appended during the snapshot survives it;
    - a delayed write (observed before the cutoff, appended after it) survives;
    - two entries with equal timestamps fold in offset order.
  - **Marker pruning:** markers older than the last 4 windows are deleted.
  - The mirror is therefore exact at complete snapshots and approximate between them.
- **Why a file and not chat:**
  1. Every world's bots share one host.
  2. Chat ingestion is dead today (§2.7).
  3. C2's first smoke lost every directive on the chat path.
  4. Chat is the channel a human can type into.

  If a world's bots ever span hosts, a cross-host mirror needs a new, authenticated and enumerated protocol. Not needed
  now.

### 4.4 Rate (anti-spam), without dropping state
- **Never dropped by the cap:** transitions and safety events (released, disproved, cancel, award, deliver, expire,
  death), and **every observation whose state differs from the last one written for that subject** (empty → loaded, a
  load session). They are written synchronously and a failed write is retried at the next tick.
- **A crash** between an action and its append can still lose a transition. Recovery then comes from the source:
  - the lease files for claims and awards;
  - the reconciliation for mirrors;
  - the next open for `station`.

  A stale `empty` therefore lasts at most its 60-min expiry.
- **Flapping alarm (L2):** an uncapped class that writes more than 10 times its expected entries per subject per hour
  raises an alarm row. It is never a drop.
- **Coalesced:** only *identical* repeated observations. They update the writer's in-memory `last`, and are appended at
  most once per subject per 10 min as a durable refresh, so freshness survives a restart. The affordance survey re-sees
  the same iron every 20 s; it must not append every 20 s.
- **Tests:** cap exhausted, then empty → loaded (written); cap exhausted, then a restart, then an open (written).
- **Capped (observations only):** at most 120 observation entries per bot per hour. Over the cap, the entry is dropped and
  an `_ledger_drop` row counts it.
- **Expected volume:** the town jobs in §2 are about 5,400 runs a day across 12 towns, about 19 per town per hour.
  Including refreshes and claims, 20-40 entries per town per hour.

### 4.5 Consumers (each its own small change, measured on behaviour)

| consumer | what changes | measured value today | needs the ledger? |
|---|---|---|---|
| ledger-01 | nothing reads; mirror + new types written | — (gate: parity) | is it |
| **keepout-01** (§8) | gather and mine refuse dig candidates in the column above a live fire site (6-block disc, from the site's y up to +12), **whatever the body's position**. Second variable, separate: price drop-down landing cells in the disc | 7 of 52 fire deaths in 7 d were inside a live fire site (4 of them at a site with 2 deaths by 2 bots) | **no**: reads world facts' `fireSites` |
| **furnaceseen-01** | **the newest evidence about F wins.** It may be the bot's own `bot.furnaceSeen` (today: 6 h, cleared when F is seen lit) or the town's `station` (60 min). Any newer contrary evidence clears both: a townmate's non-empty open, a load session, or seeing F lit. A skip caused by the town fact lasts at most 60 min; the bot's own memory behaves as today. An open by an adjacent bot still happens. Tests: a missed load, and a crash with own memory populated, are both corrected by the next contrary open | 391 repeats a day by *other* bots, 1.07 bot-h (12 towns); the bot's own memory already stops its own repeats (17) | yes (`station`) |
| claims mirror | none (visibility + a duplicate-claim gate) | 0 today | yes |
| needs → SUPPLY | the foreman's lease reorder (stage 3a) | needs a live project | yes |

### 4.6 Dead ends (each refusal names a remedy the bot can perform from where it is)

| situation | what the bot does | why it is not a dead end | composed test |
|---|---|---|---|
| the ledger is missing, corrupt or another world's | behaves as today | every consumer's default is today's path | a fold of a corrupt file followed by a write |
| a stale `empty` furnace fact while F holds output | the drain skips the walk for at most 60 min; any open or load clears it; never dropped (§4.4) | a furnace keeps its output; it waits at most 60 min | empty → load → the order is eligible again; empty → restart → state from the checkpoint |
| a claim whose holder dies or disconnects | the lease TTL frees it; the `released` / `expired` entry is never dropped | as the lease designs | claim → release; claim → crash → expiry |
| keepout-01 refuses every gather candidate of a block | gather refuses deterministically: "every candidate is above a marked lava pool". The same skill then **moves its search centre**, inside its own budget, to the nearest candidate outside every column. The search is bounded at 32 blocks and needs a route the pathfinder plans without entering a column. It is a deterministic step, not advice | the bot can walk on its own level | gather dirt with all candidates in the column → the next candidate is outside it within the same run; repeated refusals at one spot ≤ 2 (a gate) |
| no outside candidate, or no safe route to one (enclosed terrain, overlapping columns), **with the bot outside the column** | gather ends **without a dig** ("no safe candidate within 32"), and **the refused (skill, block) is suppressed for this bot for 10 min while it is within 32 blocks of the column.** This is a deterministic cooldown entry, so the next decision cannot reselect it | ending a skill with no dig is always executable; the cooldown makes the next decision a different one | enclosed pocket beside a pool → no dig in the column, and the next 10 min contain no same gather at that spot |
| keepout-01 refuses a mine descent | **the whole planned descent column is checked before the first dig.** `mine` turns its bearing (today's `_mine_bearing_turned`). If all four are refused, it walks off deterministically (bounded at 32 blocks, a column-free route) to a cell outside before descending, inside the same run. With none, it ends without digging, **and `mine` is suppressed for this bot for 10 min within 32 blocks of the column** (the same deterministic cooldown as gather) | the bot is above or beside the column; the cooldown makes the next decision a different one | four bearings refused → a walk-off, then a descent outside; **mid-staircase:** a descent from y 72 whose plan meets a column at y 50 is refused at planning, not at y 50; **sustained:** at most 1 mine refusal at one spot in 10 min, over a 30-min Paper run |
| **a bot inside the column** (it walked in, respawned there, or fell in) | **the exemption covers moving out only**: escape, drowning, entombment, respawn and walk-off moves. Dig and gather candidates in the column are refused **whatever the body's position**. Before anything else, a body inside runs **`_keepout_exit`**, a deterministic step that keepout-01 starts itself, without waiting for the stranded detector: (1) a walk whose route only has to **leave the column outward**, the way `lineHitsDeathSite` lets a bot inside a disc walk out; (2) if no outward walk exists, the escape step: dig at or above foot level *away from the centre*, never below the feet, or pillar up. These digs are exempt. A pillar that cannot reach above the column's top (site y + 12), for want of blocks or because of a ceiling, counts as `failed`. (3) It records its outcome (`out` / `failed`); `failed` hands over to today's stranded ladder, which is also exempt. **(4) It does not start inside a yielded town column (C12)** while the bot is on that town job. There, keep-out refuses only non-town-job digs | survival moves outrank keep-out; `_keepout_exit` is started deterministically, not advised | **Paper:** (a) a bot at y 43 above the pool told to gather dirt → no dig in the column, and the bot is outside it within 60 s (Echo's and Alpha's starts); (b) **a sealed ledge above the pool, with gather, mine and explore all refused → outside the column within 60 s** (Bravo's case); plus a marooned climb, overlapping columns, no safe explore bearing, and entombed inside a column (the escape digs are exempt) |
| a town chest, furnace, home or respawn inside a live fire column | keep-out yields for town-job targets and home cells, and `_keepout_exit` does not start there during the town job. The read names the town as a finding, for an owner decision | town jobs must stay possible | a fixture with a furnace inside a column: **the drain job completes**, and no non-town dig happens in the column |
| over the observation cap | the observation is dropped and counted; transitions are never dropped | consumers fall back to their own reads for observations | a cap test with a pending release |

### 4.7 Read and gates for ledger-01
- **L1, parity.** At each 30-min reconciliation, the mirror's live view equals its source:
  - death sites: the fold replays `reportDeath`'s merge and decay **and** world facts' 120-site cap. A site evicted by the
    cap is listed, not counted as a mismatch;
  - town memory's live misses;
  - townindex's live entries.
  - A difference names its writer. The fixtures are an eviction, a merged long-lived site, and a restart between
    reconciliations.
- **L2, integrity.** Unparsed lines other than torn tails: 0. Size refusals: 0. A dropped transition: 0. `_ledger_drop`
  at most 1% of observations.
- **L3, cost.** Append p95 under 5 ms. Under 2 MB per town per day before rotation. Fold from the checkpoint p95 under
  50 ms.
- **L4, no harm.** No consumer exists, so outputs and deaths go through the default gate, as difference-in-differences
  against control.

### 4.8 What stage 1 buys, plainly
- On today's bench: about 1 bot-h a day from the furnace fact.
- keepout-01 needs no ledger and stands on its own.
- The ledger's value is as the **substrate** for what is coming:
  - claims and needs for the first multi-bot project and the foreman;
  - discoveries for expeditions;
  - the only event source for stage 2, so the talk cannot say what did not happen.

---

## 5. Stage 2: visible plain-language chat (for the owner and the showcase)

### 5.1 How lines are made
- **Templates.** Each is keyed by ledger type and transition. Its slots are actor, relation, polarity, item, quantity and
  place. Every line logs a `_say` row with the ledger id it came from; the id never appears in chat. Examples:

  | event | line |
  |---|---|
  | `death` | "Lost one at 335,38,154: lava." |
  | `fire_site` (2 or more deaths) | "That lava pool at 335,38,154 has taken 3 of us. Marking it." |
  | `station` empty | "The furnace by the storehouse is empty." |
  | `progress` | "Placed the last block of the monument's north-east corner (14/14)." |
  | `discovery` | "Village about 120 blocks east. On the map." |
  | `claim` | "Taking the monument's north-east corner." |
  | `need` | "The monument needs 40 more cobblestone." |

- **Optional LLM choice (showcase only; C6).**
  - Each template has 3-6 hand-written phrasings, all with the same slots. Once per town per 5 min, one gemma4 call
    (strict JSON) picks a phrasing for each queued line and may merge two lines that share an actor.
  - **Validator:** each output line must equal a listed phrasing with the source event's slot values, character for
    character after substitution. Otherwise the plain template is sent.
  - **The command/peer filter (§5.3) runs on the final text.**
  - Unrestricted rewording is not offered. Names, items and numbers can be rearranged into false statements, so a "no new
    facts" check is not enough (Codex r1).
- **No free chatter.** Every line comes from an event a bot actually caused.

### 5.2 Where it appears
1. **In-game chat, on the showcase only** (`TALK=on` there; off on the bench). The owner's spectator `mike` sees it.
2. **BlueMap markers (showcase).** A host-side generator on the showcase VM rewrites a marker set from the ledger before
   each 15-min CLI render:
   - confirmed hazards as red points;
   - discoveries as points;
   - claimed plots as shapes;
   - the last 15 min of lines as labels at the speaker's position.

   **Before building, verify on the pinned jar:**
   - that the CLI's config marker sets (or its markers update path, which Codex found in `BlueMapCLI.java`) are served by
     the showcase's web server;
   - that labels are escaped;
   - that a removed marker disappears.

   There is no web-root `markers.json` fallback: none is shown to work.
3. **Timelapse.** At video build time only, an ffmpeg `drawtext` caption strip shows the `progress`, `discovery` and
   `death` lines for each 15-min slot. The frames are untouched (C8).

### 5.3 Trust: chatgate-01 comes first
**What chatgate-01 does:**
- **Commands:** they run only for names in `OWNER_CHAT_NAMES`, per command. The bench default is empty (no chat commands).
  The showcase gets `mike` (C4; the recommendation is `status` only, with `stop`/`resume` as the owner's choice).
  Anything else is ignored before parsing and sampled into `_chat_ignored` (at most 1 per minute).
- **Peer ingestion is retired:** comms.mjs's `startComms` is not attached. It is dead today (§2.7), redundant with the file
  on one host, and forgeable (any name with the fleet's hyphen count, and free hazard text that reaches prompts). The
  `[fleet]` announcements stay, as visible lines (C7).
- **Prompt lines from world facts:** hazard `kind` is restricted to the known enum before display.
- **`TALK` code ships, off.** The template engine refuses any line that starts with `!`, `[fleet]`, or a fleet-shaped or
  whitelisted name, or that contains a command verb right after a name.

**Paper tests** (with mutants that must fail):

| test | expected |
|---|---|
| unauthorized `!stop` | the runner is NOT cancelled |
| unauthorized `!goto 10 70 10` (valid coordinates) | no dispatch |
| a peer line `hive-a-Bravo come` | no dispatch |
| a forged `[fleet] hive-a hazard <text>` | nothing ingested |
| an authorized `status`, as the positive control | works |
| **every template and phrasing output, sent by a whitelisted speaker** | parses as nothing |

- **Handler tests run alongside the Paper transport probe.** They inject synthetic `chat` events on the bot object, so
  they test the handlers whether or not the event fires on the live server. The authorized `status` is their positive
  control.
- **Mutant 1:** remove the output filter, **and feed it an unsafe candidate line** ("hive-a-Bravo come"). The filter test
  must then fail. Safe templates alone could not expose a missing filter.
- **Mutant 2:** whitelist all names. The unauthorized handler tests must then fail.

**Measured cost of closing:** 0 commands (journals) and 0 ingestions in 24 h (§2.7).

**First, a Paper probe of the chat event** (one scene, before chatgate-01 is built). Peer ingestion is dead while the
server carried the lines, so mineflayer's `chat` event may not fire on Paper 1.21.8 offline-mode ("[Not Secure]"
lines). The probe decides what chatgate-01 is:
- **If `chat` fires:** the gate as above. The authorized `status` is the positive control.
- **If it does not:** chatgate-01 *is* the gate, and nothing changes behaviour today. Paper then proves only that the
  channel is dead today; the handler tests carry the gate's evidence. A whitelisted `mike status` would
  then need a listener fix (for example `messagestr`). That would switch chat commands back on for whitelisted names: a
  behaviour change, stated in C4, with its own Paper tests.

### 5.4 Rate
- At most **1 line per bot per 2 min** and **1 per town per 20 s**, by priority: death and confirmed hazard first, then
  progress and discovery, then claim and need.
- The same text is suppressed for 10 min.
- A dropped line is counted, never queued.
- **Against the server's limit:** the vanilla chat-spam counter adds 20 per message, drains 20 a second and kicks above
  200. That allows about 1 line a second sustained, or a burst of about 10. This is vanilla behaviour, not re-checked on
  Paper 1.21.8. The caps here are about 120 times below it per bot.

### 5.5 Dead ends

| situation | result |
|---|---|
| a cap is hit | the line is dropped and counted |
| the LLM choice fails, times out or fails validation | the plain template |
| the Studio is reserved | templates only (the showcase may pause by its own rule) |
| `bot.chat` throws or the bot is offline | dropped; no retry storm |
| a human or a peer types anything | ignored unless whitelisted for that command |
| the marker generator fails | the last markers stay; the capture proceeds |

### 5.6 Reads, gates, tier
- **No lane slot of its own.** The TALK code rides in chatgate-01's build, flag off. On the bench it changes nothing:
  - it sends nothing;
  - T6 below checks that;
  - chatgate-01's read covers it.
- **Switching it on is a showcase config change** (owner-direct counts as kept there, owner 10-21). It is read on the
  showcase with these gates:
  - T1: 0 chat-dispatched skills or cancels from non-whitelisted names;
  - T2: every `_say` row's ledger id exists;
  - T3: the caps held;
  - T4: 0 lines matching the command or peer patterns;
  - T5: LLM-choice rejects counted, with reasons;
  - **exposure:** at least 50 `_say` rows before any read counts.
- **T6 (bench, chatgate-01's read):** with `TALK=off`, 0 `_say` rows and 0 chat lines from talk.

---

## 6. Stage 3: requests, split builds, rescue

### 6.1 The protocol: a fenced state machine in the ledger (Contract Net)

| step | written by (deterministic) | content | fence |
|---|---|---|---|
| REQUEST | a job whose own need is blocked: a project's bill-of-materials shortfall, a kit short of iron, a smelt short of coal | `{req, from, item (registry name), qty, deliver_to (a container key in the requester's town, existing in townindex), until ≤ now + 20 min, reason (enum)}` | one live request per (bot, item) |
| OFFER | a townmate whose **bag policy** shows a surplus beyond its keep rules for that item, and that is eligible now (no ready rung, health over 10, no trap or drowning flag, no full-bag or spent-tool order pending: the foreman's validator) | `{req, from, qty, eta}` | **the quantity is reserved**: the bag policy subtracts live offers from surplus, so the same items cannot be offered twice. At most 1 live offer per bot |
| AWARD | **derived in the fold**: the earliest eligible offer by `observed_at`, ties by id. The foreman instead names the winner for project jobs. **The winning courier creates the award lease**, because the requester has gone back to baseline and is not waiting | `{req, to, qty, gen, state: awarded, until}` | **an award lease file `award-<req>.json` created `wx`**: exactly one award per request. Later states are new generations linked onto it (`link()`, the siting-file protocol), so a cancelled or expired award can never be mistaken for a live one |
| DELIVER | the courier, in order: re-check eligibility and bag **fresh**; check that `deliver_to` exists and has room (townindex); **link the generation `awarded → delivering`**, recording the container's pre-count of the item from a fresh open (this is the atomic claim); then the existing verified town deposit; then link `delivered` with the `op` | `{req, op}`: the townindex transfer record, with its pre-state and verifying re-open | `delivering` is linked only onto a live `awarded` generation, and only one generation can win a `link()` |
| CANCEL / EXPIRE | either side (reason enum), or the clock | | transitions are never dropped (§4.4) |

- **Legal transitions:** open → offered → awarded → delivering → delivered or cancelled. awarded → cancelled or
  expired. Open and offered can also expire.
  - **awarded → expired** is derived from the lease's `until`, which is `eta + 5 min`. Any reader may write the expired
    generation.
  - Anything else is refused. Only the named writer of each step may write it. The requester or the foreman may cancel
    an `awarded` lease. Only the courier writes `delivering`, and only the courier ends it.
- **The reservation** belongs to the courier's offer from OFFER until delivered, cancelled or expired. After that, the bag
  policy releases it.
- **Serialization:**
  - Cancellation and expiry may be linked only onto `awarded`. Once `delivering` is linked, only the courier ends it:
    `delivered`, or `cancelled` with a reason. So a cancel can no longer land between the claim and the click.
  - **An uncertain transfer** (a crash after `delivering`, with no `delivered` written) **ends as `unknown`.** It is never
    claimed as delivered and never retried automatically. A shared container's count cannot attribute a transfer, since
    other bots deposit and withdraw.
    - **The courier, on restart:** compares its own bag with the pre-delivery bag recorded in `delivering`. This is
      attributable evidence. If the items left its bag, it links `delivered (bag_evidence)`; otherwise `unknown`. The
      container count is logged as a cross-check only.
    - **Anyone else:** may link only `unknown`, and only after `delivering.until` (the skill's clock, about 3 min) plus
      5 min. A courier that resumes after a later generation exists stops, and writes nothing.
    - **The reservation** is released at `unknown`. The requester's need is recomputed from `stock`, so reality (the
      index's next open) decides whether to ask again.
    - **Tests:** concurrent deposits and withdrawals of the item during the delivery; a courier resuming after a takeover.
  - **A derived winner that never creates the lease** (it crashed or moved on): the next offer becomes the winner only
    when the first winner's 10-min offer expires. The request's 20-min `until` bounds the whole wait.
- **No bilateral trade in v1.** A swap is two linked requests with an atomic pairing rule; it is designed separately, if
  ever.
- **Split builds** are monument-01's segment leases plus the foreman's BUILD and SUPPLY role leases. The ledger mirrors
  them.
- **Principle 5 holds:**
  - REQUEST informs;
  - the courier opts in through its own policy;
  - `deliver_to` is bounded to its own town's containers;
  - the walk is the existing deposit's.

### 6.2 Who decides, and when an LLM is involved

| actor | v1 | later (experiment) |
|---|---|---|
| bench brain (qwen2.5 7B) | **never authors** a message; may see read-only enum lines about town needs | a `request` verb inside the existing decision call (no extra calls) on the **model bench** (see §6.3) |
| deterministic jobs and bag policy | write REQUEST, OFFER, DELIVER | — |
| the foreman (host, gpt-oss:120b) | awards project jobs and supply, through its S0 → S1 (Paper) → S2 (shadow) → S3 (canary) path. At most 24 calls/h globally; 8-16 GPU-min/h in its canary | — |
| showcase brain (gemma4) | stage-2 phrasing choice only: at most 12 calls/h at a p50 of 1.85 s, about 0.4 GPU-min/h | — |

**Rescue is deferred** (§2.6: 952 episodes a day, a townmate no nearer than chance, mostly underground).
- **Step 1** is a host-side, read-only **rescue census**, like E0 and S0. Per episode it records:
  - whether a standable surface cell within 32 blocks is reachable;
  - whether the remedy is an item (blocks, a pickaxe);
  - how the episode ended.
- **Step 2** comes only if the census shows a reachable, item-shaped share worth a slot: a REQUEST for the item delivered to
  that surface cell, with a Paper scene where the rescuer survives 10 of 10.
- **A rescuer never descends below its own safe depth and never enters a hazard disc.**

### 6.3 Measuring cooperation (behaviour, never talk)
**Canary lane (stage 3a, tier 3, unit = the town):**
- **Primary:** the foreman's pre-registered measure. Witnessed cells placed per **randomized town-hour over a fixed
  horizon**, including completion and stalls: all randomized town-hours, not only project-open ones.
- **Secondary:**
  - need fill time (open → met);
  - requests expired unfilled, awards abandoned, deliveries sniped.
- **Deterministic gates:**
  - duplicate awards per request: 0;
  - deliveries without a verifying re-open: 0 (`delivered (bag_evidence)` and `unknown` are reported separately and never
    counted as verified);
  - deaths within 120 s of a request, award or deliver row are named, with the two-death floor.
- **Exposure:** at least 10 offers in the canary arm, or the read closes INCONCLUSIVE early (owner 10-15 rule). Offers
  are near-empty under today's keep rules (§2.5).
- **Estimator:** a cooperation-specific estimator is pre-registered with interference treatment and a power calculation
  before the canary. The foreman's own is the template.

**Model bench** (learning loop: 4 worlds × 5 bots, each world split 3/2, AB/BA crossover):
- Because bots of both arms share a town, cooperation leaks between arms. The bench can measure only the
  **requester-side** effect of the verb (its own fill times and output), with interference named.
- The cooperation effect itself is a town-level estimand and belongs to the canary lane.
- A brain that asks a lot and gets nothing counts as a cost.

### 6.4 Dead ends

| situation | requester | other side | why it is not a dead end |
|---|---|---|---|
| no one offers | continues its baseline path; the request expires | — | **no bot ever waits on a request**: it is a hint to others, never a precondition |
| an offer not awarded | — | the offer expires at 10 min; the reservation is freed | — |
| awarded, never delivered | the award lease expires at `eta + 5 min`; at most one re-request, then baseline | 30-min backoff on that request type (commitment cost); baseline | both end on the control arm's path |
| `deliver_to` full or gone | — | `cancel: no_room` / `no_target` before walking (townindex check) or at the open; baseline | the requester's next request may name another container |
| delivered, taken by a third bot | its withdraw finds none; `sniped` counted; baseline | — | v1 accepts it; a 10-min hold (like bankable's) is v2 |
| the courier's own guards refuse the trip (depth, hazard, bag) | award expiry | releases at once (`cancel: refused_<guard>`); its next decision is the baseline one (a composed test asserts this) | — |
| starvation: an offer keeps the courier from maintenance | — | bag-full, spent-tool and no-pickaxe orders rank **above** DELIVER (the foreman's rule) | a composed test: offer live while the bag reaches 34 → the deposit runs within the TTL |
| a split-build segment abandoned | — | the segment lease TTL; the next bot | as monument-01 |

---

## 7. How the stages compose with the queue's pieces

| piece | comms takes | comms gives |
|---|---|---|
| townindex-01 (observe-only) | `stock` observations (mirrored) | ledger-01 can ride with it as a newly reviewed combined variant (C2) |
| indexsearch-01 | — | unchanged; it keeps reading town memory and the index |
| townplan-01 / found-01 | cell claims (mirrored) | stage-2 lines |
| monument-01 / shaft-01 | segment leases → `claim`; placements → `progress` | the first real `need` |
| overseer (S0 staff census live; foreman later) | `claim`, `need`, `progress` in one place | a fenced view, instead of a fold of separate files per tick |
| expansion (E0, expedition-01, outpost-01) | `discovery` | map and chat; outposts' supply `need`s. keepout-01 lands **before** expedition-01 |
| showcase | ledger + TALK + markers + captions | what the owner sees |

---

## 8. Build order, tiers and a timeline (one canary lane; the operator session owns the queue)

| # | step | what | tier / read (CLAUDE.md "Deploys") | needs | rough timing |
|---|---|---|---|---|---|
| 0 | **chat-event probe** | one Paper scene: does mineflayer's `chat` fire for "[Not Secure] <name>" lines? | sandbox, no slot | — | day 1 |
| 1 | **chatgate-01** | commands whitelist; comms ingestion retired; enum prompt kinds; TALK code shipped **off** | **tier 2** (a small fix with strong Paper evidence: §5.3's tests and mutants). Registration: 4 pools; licence not `rate`; **exposure field: canary bot-h with the gate active, read from a `_chatgate_mode` startup row (like the other `_*_mode` rows), at least 48.** This duplicates tier condition 3 (48 bot-h), and that is honest: nothing can be exposed on the bench, since chat commands run 0 times a day; KEEP at +180 with T6, no harm and the licence row. An owner-direct rollout would be an **exception to the tier policy** the owner must grant (C4) | 0 | build 1-2 days; the next free slot; **before the showcase bots start** (add to its start gate) |
| 2 | **keepout-01** | dig and gather candidates in the column above a live **fire** site refused, whatever the body's position (v1). Drop-landing pricing is a separate later variant | **tier 3**, the underground-safety lane. **Draw: towns with a live fire site,** recomputed at launch (at 10-21 20:00Z: 6-8 live fire sites in 5-7 towns by write order -- hive-a, hive-b ×2, hive-c, hive-d, placebo-a, and possibly board-a, board-d). Paper is the main evidence (the hive-b starts and the sealed ledge). Exposure field: gather and mine candidates refused for a column, at least 20. **Primary, computed host-side for both arms, restricted to the cells today's rows can see:** `_reach_probe` `hit=` gather candidates inside a column of a live fire site (sites replayed with `deaths_v5`'s rules), per bot-h. Both arms write that row on today's code. **Positive control (required before the read counts):** the same query finds 86 in-column candidates in hive-b in 24 h, including 16 of Echo's in 06:00-06:10 and 10 of Alpha's in 08:25-08:35 before their deaths (`data/reach_probe_control.txt`). Mine descents have no positioned dig row in the control build, so they are covered by Paper and a canary-arm deterministic gate (`_keepout_refused` rows, mine planned-dig cells in a column = 0), **not** by the difference-in-differences. The control build computes no columns itself. **The control is restricted to towns that also have a live fire site** (the null must match the drawn stratum). If fewer than 2 such control towns exist, the read closes on Paper plus the deterministic gates, with no difference-in-differences. Early INCONCLUSIVE if the drawn sites lapse unexposed. Deaths are a tripwire | its own design with both engines (C3) | weeks 1-3 |
| 3 | **ledger-01** | journal, fold, mirrors + `station` / `claim` / `progress` writers; no reader | **tier 2** on its own registration, or as a **newly reviewed combined variant** with townindex-01 (both observe-only). Licence not `rate`. Exposure field: ledger entries written per drawn town, at least 200. Gates L1-L4 | townindex-01's variant on the live tip | with townindex-01: weeks 1-2 |
| 4 | **TALK on (showcase)** + markers + captions | showcase config; host scripts on the showcase VM | showcase owner-direct (owner 10-21: counts as kept); T1-T5 + exposure | 1, 3; jar check (§5.2); C5-C8 | when the showcase bots start (week 2+) |
| 5 | **furnaceseen-01** | drain skips the walk to a live-empty furnace | tier 2. Licence not `rate`. Exposure field: drain walks skipped, at least 20. Gate: 0 drain walks to a live-empty furnace. Repeats per bot-h, as difference-in-differences. Guard: furnace output not waiting longer; smelt ingots not lower | 3 promoted | weeks 2-3, folded with the next smelt or drain change |
| 6 | claims mirror | found-01, monument-01 and furnace leases → ledger | inside those canaries (a duplicate-claim gate) | 3 | with found-01 / monument-01 |
| 7 | **unreach-01** | **(a) the read, now:** sizes the peer-shortened skips by milestone and how often a skipped milestone later succeeds for the same bot. It cannot settle the question, because the cutoff at 8 censors the attempts that would show the answer. **(b) the decision:** a controlled canary in which the canary arm keeps the full 25 (the cut off), read on milestone completions per bot-h and time-to-complete, as difference-in-differences. Exposure field: attempt-count skips in the canary arm, at least 20 | (a) host-side, no slot; (b) tier 2 | — | (a) now; (b) after it (C11) |
| 8 | **stage 3a** | `need` + REQUEST / OFFER / AWARD / DELIVER for project supply | tier 3 with the foreman's S1-S3 on monument-01 (§6.3) | monument-01 KEPT; foreman S0 passed | weeks 4-6+ |
| 9 | bench `request` verb | a brain verb (no extra call) | model bench (learning loop, after M6) | bench VM | 4+ weeks |
| 10 | rescue census | host, read-only | no slot | homefix-02 decided | any time |

The timing is a recommendation. Today's head is homefix-02 (live 18:05Z), then ironpick-01, protectzone-01, townindex-01
and indexsearch-01.

---

## 9. Owner decisions (with recommendations)

| # | decision | recommendation | why |
|---|---|---|---|
| C1 | Build stage 1 as a substrate (bench payoff today: about 1 bot-h a day from the furnace fact), not a standalone "sharing" canary | **yes** | §2: the cheap sharing exists; the coming projects need claims and needs; talk must come from facts |
| C2 | ledger-01 as its own tier-2 run, or as a reviewed combined variant with townindex-01 | **combined, if townindex-01's live-tip variant is not yet built** | both observe-only; one slot |
| C3 | keepout-01 (fire/lava only; triggered by any live fire site) in the underground-safety lane, ahead of expedition-01 and of TALK | **yes, trigger = any live fire site** | hive-b: 6 deaths by 5 bots in 3 days at a shared, priced site. 7 of 52 fire deaths were inside a live fire site; v1 targets the gather share |
| C4 | chatgate-01 at tier 2, or an owner-direct exception; the bench whitelist empty; showcase `mike` gets `status` (and `stop`/`resume`?). If the probe shows the `chat` event is dead, whether to fix the listener for whitelisted names (a behaviour change) | **tier 2; `mike`: `status` only** (a stop typed by accident halts all 10 showcase bots; the operator has the units). **Do not fix the listener in chatgate-01**; that would be its own change | today any name commands every bot on that town's server, if the event fires |
| C5 | TALK on the showcase only; the bench stays quiet | **yes** | talk is for the owner; the bench measures behaviour |
| C6 | Templates only, or plus an LLM choice among fixed phrasings | **templates first**; the LLM choice later, if wanted | free rewording cannot be verified |
| C7 | Retire comms.mjs's chat *ingestion* (dead and forgeable); keep the `[fleet]` announcements | **yes** | §2.7 |
| C8 | Timelapse caption strip at video build | **yes** | frames untouched |
| C9 | Stage 3 v1 = item requests through town containers + split builds through the foreman; no trades; rescue behind a census | **yes** | §2.5-2.6 |
| C10 | Bench brains never author messages in v1; a `request` verb is a model-bench experiment, requester-side only | **yes** | optional model-chosen comms go unused (the board); prose costs 15% or more (MineCollab) |
| C11 | The milestone peer give-up (25 → 8 attempts): run unreach-01's host read now, then decide by a controlled canary | **read now; decide by the canary** | it is reachability sharing, live in 93% of attempt skips; §2.4 says peer failures do not predict elsewhere; an observational read cannot see past the censoring |
| C12 | A live fire site covering a town chest, furnace or home | **yield for town jobs and report the town** | town jobs must stay possible; the owner decides any relocation |

---

## 10. What would change the answer
- **A world whose bots span hosts:** a cross-host mirror would need a new, authenticated, enumerated protocol.
- **A measured predictive peer signal:** a `checked`-style type with quorum 2. §2.4's tools are the template.
- **Banking rules that leave real surpluses:** offers would become non-empty, and item requests could come before the
  foreman.
- **unreach-01 showing the peer give-up *does* predict:** then it is the one reachability fact worth keeping, and it should
  get a quorum (2 bots) instead of 1.

---

## 11. Reviews
- **Round 1 (r1): Codex CHANGE (8 P1, 6 P2, 1 P3); Claude CHANGE (3 P1, 12 P2, 9 P3).** All of it is taken into r2. The
  table of changes and the full texts are in the reviews file. The main changes:
  - re-measured with completion-time availability and pre-action positions;
  - the death replay follows production semantics (13 of 169 in the r2/r3 window; 4 confirmed; 13 of 171 in r4/r5's exact 7.0-day window);
  - the hive-b mechanism (digs above the pool, unpriced drops) moves keepout-01 off the ledger and onto gather and mine
    candidates;
  - fire/lava only;
  - the milestone give-up is named as live reachability sharing (unreach-01);
  - chat ingestion is found dead and retired;
  - tier-2 registrations instead of owner-direct;
  - TALK ships off, with no slot of its own;
  - slot-preserving phrasings only;
  - stage 3 is a fenced state machine with reserved quantities;
  - the cooperation estimand is town-level, and bench interference is named.
- **Round 2 (r2): Codex CHANGE (2 P1, 7 P2, 2 P3); Claude CHANGE (1 P1, 5 P2, 5 P3).**
  - **Both P1s:** keep-out's body-inside exemption cancelled the fix for Echo and Alpha. Now digs and gathers in a column
    are refused wherever the bot stands, and only moves out are exempt.
  - **Codex's second P1:** walk-offs now have a bounded search, a column-free route, and an executable no-dig fallback.
  - **The other changes in r3:**
    - the logEvent timestamp fix and JavaScript rounding (numbers unchanged);
    - one authority for fire-site disputes (world facts);
    - changed observations are uncapped;
    - complete-snapshot bootstrap and a single reconciler;
    - the award lifecycle (awarded → expired, the courier creates the lease, linked generations, idempotent op);
    - exposure fields for the tier-2 runs;
    - the chat-event probe first;
    - keepout overclaims corrected (v1 targets the gather share);
    - the alternative trigger (7 of 52) adopted;
    - unreach-01 decided by a controlled canary.
- **Round 3 (r3): Codex CHANGE (1 P1, 5 P2, 1 P3); Claude CHANGE (1 P1, 2 P2, 7 P3).**
  - **Both P1s:** a bot inside a column with no outward walk had no selected remedy. That was Bravo's death.
    - Now keepout-01 starts a deterministic `_keepout_exit`: an outward-only first segment, else the exempt escape dig or
      pillar, else today's stranded ladder.
    - Refused gathers outside a column get a 10-min deterministic cooldown.
    - A sealed-ledge Paper scene must end outside the column within 60 s.
  - **Also in r4:**
    - keepout's primary is computed host-side for both arms, with the control matched to towns that have a fire site;
    - the death replay uses explicit 7.0-day bounds plus a write-order variant (identical counts) and is labelled
      approximate;
    - DELIVER has an atomic `awarded → delivering` claim, and uncertain transfers resolve by pre-count;
    - snapshot replacement semantics;
    - furnace newest-evidence precedence;
    - injected-event handler tests, and an unsafe-candidate mutant;
    - flapping alarm, marker pruning, the stated dispute exit, the unreach-01 exposure field, and refreshed denominators.
- **Round 4 (r4): Codex CHANGE (5 P2, 1 P3); Claude CHANGE (1 P2, 4 P3). No P1 from either.**
  - **Replay:** deaths_v5 replays merge-before-prune on stored counts at both write-order extremes (identical counts); the
    class breakdown is regenerated for 171; "upper bound" is removed.
  - **Uncertain delivery:** ends as `unknown`, on bag evidence, with fenced takeover.
  - **keepout primary:** restricted to the observable `_reach_probe hit=` candidates, with a positive control (86 in
    hive-b; Echo 16, Alpha 10 before their deaths). Mine is covered by Paper and a deterministic gate only.
  - **mine:** gets the 10-min cooldown and a sustained test.
  - **`_keepout_exit`:** yields inside a town column during the town job; a failed pillar is `failed`.
  - **Snapshots:** ordered by ledger offset, with delayed-write and tie tests.
- **Round 5:** pending.
