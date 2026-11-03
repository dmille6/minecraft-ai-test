# The rule-based town job assigner (design + stage 1, 2026-11-03)

**Owner 11-03** (memory `owner-gaps-1103`, item 4): "YES: rule-based job assigner per town", and "at some point i'd like to
approach the mayor/overseer project again". Ledger row `jobassign-1103`.

**How this was made.** Codex (`codex exec`, read-only, web search) and a Claude subagent each wrote a design from the same brief
and the same 6-hour census, without seeing each other's. This file reconciles the two (§11 lists where they disagreed). Both
engines then reviewed this file and the stage-1 code once, blockers only (§12).

**Status.** Stage 1 (the shadow) is built, tested and installed on the canary host as a host read (§7). Nothing on a bot
changes. Stages 2 and later are designed here, not built.

## 0. The answer

- **The assigner.** Each of the 16 towns gets a deterministic **role engine**, `scripts/lib/jobrules.py`.
  - It is pure and runs on the host.
  - Every tick it turns the town's needs into demand for eight roles: low stock, open projects, the grounds, the stair, the
    smelter backlog, and safety.
  - It staffs those roles from the town's 5 bots with hysteresis, a term and a rest, aging so that no role starves, and caps
    sized for a 5-bot town.
- **The existing leases stay.** The keeper, the deep-miner slot, the builder slots and the yard clerk remain the execution
  locks. **A live lease holder always holds its role.** The engine decides only who gets the **first right** to the next one.
- **What a role can change, stated honestly:**
  - A bot is at town about 9.3% of the time (median stay 1 minute).
  - Build work is 3.1% of skill time.
  - B5's Paper arms showed the BUILD order is not the bottleneck (noise dwarfs every assigner).
  - So a role that only reorders work at town cannot add throughput. What it can add is **coverage** (every needed job has an
    owner), **specialisation** (today every bot in a town visits every project), and **legibility** ("Alpha is the town's
    miner" — the showcase story and the owner's teamwork goal).
  - A role reaches the bot's time *outside* town only through a later tier-3 stage, built only if the shadow shows that it is
    needed.
- **The rollout** is shadow, then advisory, then binding.
- **The mayor hook.** The rules emit up to four complete, valid **options** plus a `choices` field, the land plan's pattern.
  - A later LLM mayor may only *pick* among them.
  - Anything invalid, late or absent falls back to option 0, the rules, permanently.

## 1. What the fleet does now (the brief's census)

Source: `scripts/lib/telemetry.py` `Events.load(since_minutes=360)`, full walk, 11-03 ~03:30Z. The walk covered 497,249 rows,
80 bots and a 6.01 h span, so 480 bot-hours.

**Positive control.** The first pass read `duration_ms` from the normalized row, found 0 bot-hours and raised on the division.
The re-read took it from the raw row and found 135.2.

**Time inside top-level skill rows: 135.2 of 480 bot-hours (28%).**

| Skill | Bot-hours | Share of skill time |
|---|---|---|
| gather | 67.9 | 50% |
| goto | 24.8 | 18% |
| explore | 18.9 | 14% |
| mine | 6.3 | |
| build_shop | 4.3 | 3.1% |
| surface | 3.0 | |
| smelt_town | 2.6 | |
| home | 1.9 | |
| smelt, furnace_drain, craft | about 1 each | |
| deep_mine | 0.3 | canary pools only |

The LLM brain picks gather, explore, mine and goto. Town jobs come from the deterministic town-job chain, and only while a bot
is at town.

**554 `_build_visit` rows in the 6 h.** In nearly every town, every bot visits every project:

| Town | Project | Visits | Bots |
|---|---|---|---|
| hive-d | shop | 49 | 5 |
| placebo-b | monument | 133 | 5 |
| any town | shaft | — | 4–5 |

**0 `_keeper`, 0 `_yard` and 0 `_role_honoured` rows.** These features are not on the fleet. The positive control in the same
walk found `_build_visit` 554, `_shaft` 428 and `_smelt_job_tally` 1,454.

**All 16 pools are shared 5-bot towns.** The isolated pools became shared towns on 10-20 (`owner-fleet-reshape-1020`); their
`_pool-self-isolated-*` directories are stale since 10-23. Each pool is its own world, so no fact crosses pools.

## 2. Roles and the needs-to-demand rules

The facts are read with the bots' own modules (`scripts/host/jobfacts.mjs`, read-only):

- the project records (`buildproj.mjs recordHead`) and the build (`shop.mjs activeProject` itself);
- the live leases (`leaseState`);
- the town index (`townindex.mjs`: known containers only);
- the flow ledger's chest stock;
- each bot's newest row.

**Unknown is never zero.** Unknown stock keeps a latch as it was, and it never opens a shortage.

**Latches.** A stock need turns on below LOW and off at TARGET or above (LTN's request threshold, with hysteresis). Marks:

| Item | LOW | TARGET | Source |
|---|---|---|---|
| cobble | 256 | 1,000 | owner |
| logs | 512 | 2,000 | LOW owner; TARGET proposed |
| usable iron | 15 | 30 | proposed |
| raw iron + raw copper (smelter) | opens at ≥ 16 | closes at 0 | proposed |

marks-01 replaces these with its table once shipped.

| Role | Class | Demand is on when | Seats | Base priority |
|---|---|---|---|---|
| builder | primary | `activeProject` over the town's list without the tidy and the yard is open | min(2, the project's `builders`) | 50 |
| deep miner | primary | the stair is complete with the y=16 landing, **and** iron is latched low or diamonds < 3, **and** no safety hold | 1 (`DEEPMINE_SLOTS`) | 55 |
| miner | primary | cobble or iron latched low | 1 | 45 (+15 when cobble is low) |
| explorer | primary | the town is idle (every project stands), no safety hold | 1 | 20 |
| groundskeeper | duty | the workshop stands and the tidy is open or damaged (`keeperWanted`'s rule) | 1 | 40 |
| clerk | duty | a complete yard and a stock backlog | 1 | 40 |
| farmer / tree-farmer | duty | a complete tree farm, or logs latched low | 1 | 30 (+25 when logs are low) |
| smelter | duty | the smeltable latch | 1 | 45 |

**Safety holds:**
- **Deep miner** demand is 0 after 2 deaths in the town in 2 h, or after a `_deepmine end=stranded` in 6 h. These times are kept
  in the shadow's state, because one read window is 70 minutes.
- **Explorer** demand is 0 after 2 deaths in the town in 2 h.
- **Any role:** a bot is ineligible when it is flagged (a death, a drowning, a trap or an unrecoverable entombment in the last
  5 minutes, or health ≤ 10) or unseen for 10 minutes.
- `_entombed` alone is **not** a flag. It is a routine reflex: 107 rows in 10 minutes fleet-wide (measured 11-03). Flagging it
  left only 1–2 of 5 bots eligible.

**Supported.** A role whose feature is not on a pool's build is `unsupported`: logged, never staffed. This applies to:
- the deep miner without `_deepmine` rows in the last 24 h;
- the explorer without `_expedition` rows;
- the clerk with no yard record;
- the groundskeeper with the tidy off.

Food is not a role. The fleet is peaceful and skips food (owner 10-05).

## 3. The role state machine, fairness and caps

```
 none --take--> HELD --renew each tick--> HELD
                  | term over (not a live native holder)  -> released `term`,    REST (role's rest)
                  | demand off for GRACE 20 min            -> released `no_work`, 10-min cooldown
                  | bot flagged / unseen 10 min / dead     -> released, no rest
                  | displaced (see below)                  -> released, 10-min cooldown
```

Advisory and binding (§6) add `OFFERED`. A role is offered, and the bot's ack is **evidence, not a message**: its
`_role_honoured` row, or its name appearing on the role's native lease. An offer the bot has not acted on lapses after 90
minutes, because a bot arrives at town about once a bot-hour.

**Terms and rests (minutes):**

| Role | Term | Rest |
|---|---|---|
| builder | 180 | 60 |
| deep miner | 120 | 60 |
| miner | 120 | 60 |
| explorer | 180 | 120 |
| groundskeeper | 240 | 60 (the keeper's own `GK` numbers) |
| clerk | 60 | 30 |
| farmer | 120 | 30 |
| smelter | 60 | 30 |

**Hysteresis:**
- The demand latches above.
- A held role cannot be displaced inside its **minimum dwell of 30 minutes**.
- After the dwell, a waiting role displaces the least urgent held role only if it is ahead by **20 points for 2 consecutive
  ticks**, or if it is starving.

**Fairness between roles: aging.**
- Urgency is `base × (1 + unfilled minutes / 60)`.
- A role with demand on and no bot for **120 minutes** goes first, and may displace (DFHack labormanager's unclaimed-posting
  rule).
- The shadow counts every tick a role starves.

**Fairness between bots:**
1. The live native lease holder first. Native ownership is never overridden.
2. Then the role's last holder within 30 minutes of its release (deepmine's `PREFER_MS` soft preference, generalised).
3. Primaries then prefer a bot at town, then the most free bag slots.
4. Duties go to the bot with the fewest decayed role-hours (12 h half-life), so chores are spread.
5. Name breaks ties.

**Caps for a 5-bot town:**
- One role per bot.
- At least 1 eligible bot stays free. Gather is half of all skill time, and the generalist keeps it.
- At most 3 primaries.
- Miner and deep miner together at most 2.
- Each duty has 1 seat.
- With 2 eligible bots there is 1 seat; with 1 eligible bot, none.

## 4. How a role acts on a bot: the actuator, by stage

| Level | Mechanism | Reaches | Tier |
|---|---|---|---|
| **A0, shadow** | nothing reads the result | nothing | 1 (a read-only host report; `protected.py`: not protected) |
| **A1, first right** | each non-protected module's own take gets one optional input, the role file's holder. A non-holder's take answers `preferred_other` while a *fresh* holder exists (seen ≤ 10 min, offer ≤ 90 min old), and then **today's chain runs minus that one job**. A stale holder, a missing file or a stale file means today's behaviour. | who does the keeper, builder-slot, clerk and tree-farm work; no new travel | **2**: `groundskeeper.mjs keeperDecision`, `shop.mjs buildOrder` slots, `yard.mjs`, `treefarm.mjs` (none protected). The deep miner's `lease()` input lives in `deepmine.mjs`, which **is protected**, so it is tier 3 and goes in a later bundle. |
| **A2, at-town sort** | the shipped B5 reader (`roles.mjs` + its `cognitive.mjs` hook, `ROLES=on`): a held BUILD/MAKE lease goes first among the discretionary town jobs | the order of jobs during the 9.3% of time at town | **3**: activating dormant protected code on the fleet |
| **A3, the goal line outside town** | a held role adds its item to the milestone `wanted` hoist that `prompt.mjs` already applies (miner: `iron_ore`; farmer: logs; builder: the bill's short part) | the 50% gather share. The milestone channel moved verb choice from 8.4% to 27–60% (`workorder.mjs` header) | **3**: the argument is passed from `cognitive.mjs` |
| **A4, bounded return** | a holder with due role work, more than 60 minutes from town, gets one return intent per term-hour: one departure per 30 minutes, a 10-minute travel budget, and two failed decisions release it | town presence | **3**, built only if A3 shows holders never arrive |

**What a role never does:**
- It never blocks gather, explore, the deposit, the toolkit, milestones or any reflex. Maintenance outranks it, as in RimWorld,
  where needs override work.
- It never preempts a running skill.
- It never revokes a deep trip mid-way.
- Through A3 it never causes travel.

**The refusal at A1 names its remedy, and there is no dead end:**
- `preferred_other` returns no order, so the bot's next choice is today's chain without that job.
- After 90 minutes without the holder, or with the holder unseen for 10 minutes, the take is open to all.
- The composed test is "holder offline + demand on, for 2 h": a non-holder must take the job.

## 5. One system: the existing leases become roles

| Existing | Today | Becomes | What does not change |
|---|---|---|---|
| groundskeeper `keeper` lease (30-min renewal, term 4 h, rest 1 h; branch `groundskeeper-on-62b8dd2`, queued) | the first bot to take it | role **groundskeeper**, using the same `GK` numbers and `keeperWanted` rule; A1 adds the role holder to `keeperDecision` | the lease file, its term and rest, release-on-no-work. groundskeeper-01 ships first, **unchanged** |
| deep miner `project-<home>.deepmine.slot1` (TTL 8 min, `PREFER_MS` 30 min) | the eligible bot at the stair top | role **deep miner**: its `last` preference becomes the role holder while a role file is fresh | the trip machine, the exit credit, `DEEPMINE_POOLS`. **deepminer-01 in the slot now is untouched**; the shadow only reads its lease |
| builder slots (`takeSlot`, `BUILDERS_MAX` 2, per-plot `builders`) | first come | role **builder** ×2: the first right on the active plot's slots | segment leases, record gens, fences |
| yard clerk (`YARD_BUILDERS` 1, showcase only, no fleet site) | the yard's admission slot | role **clerk**, demanded on backlog only | slot mechanics; off where the yard is off |
| tree farm | its builders | building = builder; upkeep of a complete farm = **farmer** | its records and leases |
| furnace leases, `mats-lease` | seconds-long mutexes | **unchanged, never a role** | — |
| B5 `roles-<home>.json` v1 `leases[]` | Paper arms only | the same file; v stays 1; a new `roles[]` array (the v1 reader reads only `leases`); builder roles also write a v1 BUILD lease so A2 needs no reader change | `leaseFor` binding rules |

**One writer per town file.** The host writer takes `~/jobshadow/writer.lock`. The B5 Paper arms only ever write sandbox
directories.

**Adoption order** (Codex): observe, then import the live owners, then coordinate new acquisitions.
- The host **never** writes a module lease or a `.released` marker.
- If imported holders exceed a cap, no new work is issued; nobody is evicted.

The queue (stuckcells-01 → bagdiet-01 → stationkeep-01 → marks-01 → towngate-01 → groundskeeper-01) is not reordered. Stage 1
depends on nothing in it.

## 6. The mayor hook

**Options, every tick (`jobrules.options`):**
- `opt0` is the rules' staffing.
- Up to three complete alternatives, each within the same caps:
  - the least urgent held role swapped for the most urgent unstaffed one;
  - the builders on another open project whose `after` stands;
  - the second-best bot for the top primary.
- `choices` holds what the rules leave open. Now: `project_next`. Later: the land plan's `spokeOrder`, the expedition bearing,
  the marks-01 sink instance, and role titles for the showcase.

**The request** must be at most 2,000 input tokens, counted exactly. It reuses `caller.py` and `spendguard.py`:

```json
{"gen": 812, "pool": "hive-c", "needs": {"builder": {"on": true, "why": "project:shop", "unfilled_min": 0}},
 "bots": [{"bot": "hive-c-Alpha", "eligible": true, "role": "builder", "hours24": 1.5}],
 "options": [{"id": "opt0", "roles": {"builder": ["hive-c-Alpha"]}, "change": "rules"}],
 "choices": {"project_next": ["shop", "house1"]}}
```

**The reply** is `{"gen", "pick": "opt0..3", "choices": {"project_next"?}}` or `{"abstain": true}`.

**Validation (`jobrules.validate_pick`, tested):**
- `gen` is current and at most 2 ticks old.
- `pick` is one of that tick's ids.
- Every `choices` value is a member of the offered set.
- At the advisory stage, the picked option is re-validated on the newest facts (caps, eligibility, the free bot, no flagged
  bot).
- **Anything else is `opt0`.** The mayor can never create a role, a bot, a project, a coordinate or a threshold.

**Following the land plan, the mayor chooses *what*:** the role mix and the next project, the places where a story and a taste
matter. It does not choose who goes where, because greedy already ties a frontier model on that (B5).

**Cadence and cost:**
- At most 1 call per town per hour, and only when there are at least 2 meaningful options.
- Fleet ceiling: 384 calls a day, about 0.8M input tokens.
- First arm: a **local model at $0** on the serving GPUs (the 5080/3090 llama.cpp line; owner: the Blackwell is for tests
  only), in **replay and shadow**.
- A frontier arm only inside the spend guard, with a **$15/month sub-budget inside the $150 cap**.

**The rules run and write every tick whether or not a mayor exists.**

**Mayor go/no-go:**
- invalid replies ≤ 5%;
- a pick other than `opt0` in ≥ 20% of calls (else the mayor adds nothing);
- latency ≤ 20 s.

## 7. Shadow, advisory, binding

### Stage 1: the shadow (built; tier 1, a read-only host report)

`scripts/host/jobshadow.py run`, every 10 minutes on the canary host at nice 19. A 70-minute walk takes about 15 s and 0.7 GB
RSS (measured).

**Each run is one tick for each of the 16 towns:**
- the facts (§2);
- demand, then assign, then options;
- **what the bots actually did**, from their rows. The role of a row:

  | Row | Role |
  |---|---|
  | a `_build_visit` on the tidy | groundskeeper |
  | a `_build_visit` on the yard | clerk |
  | a `_build_visit` on a complete tree farm | farmer |
  | any other `_build_visit` that worked | builder |
  | `deep_mine` | deep miner |
  | `mine`, or `gather` of an ore or stone | miner |
  | `gather` of logs or saplings | farmer |
  | `smelt_town`, `furnace_drain`, `make_material`, `smelt` | smelter |
  | `explore`, `expedition` | explorer |

**It writes** `~/jobshadow/out/ticks-<day>.jsonl` (tick and eval rows), `state.json` and `latest.json`, and one line to
`~/digest/jobshadow.log`. **It writes nothing into `/var/lib/mcai`.** The test proves that `jobfacts.mjs` leaves a pool
directory byte-identical.

| Measure | Definition | Denominator |
|---|---|---|
| **coverage** (primary) | a role with demand on: did any bot of the town do that role's work **that moved something** in the last 60 min (a build visit with placed + cleared + planted > 0, a successful skill row, a deep-miner progress op) | need-ticks per role per town |
| tried | the same, counting attempts that moved nothing (a visit that placed 0, a failed skill row) | need-ticks |
| **gap towns** | towns where a role's coverage is < 50% over ≥ 6 need-ticks | towns with that need |
| **concordance**, rules vs random | an assigned bot did its role's work in the 30 min after the tick, for the rules and for a seeded random staffing of the same size. **This is prediction, not effect** (the shadow mayor's lesson): reported, never a gate | assigned bot-ticks per arm |
| specialisation | bots doing builder work per builder-need tick (today about 5 of 5) | builder-need ticks |
| churn | role takes + releases per town-hour, and the **unplanned** releases (not a term rotation, not a native import) per town-hour | town-hours |
| starvation | ticks a role waited ≥ 120 min | need-ticks |
| unsupported / unknown | ticks a role was unsupported; index known/unknown containers | ticks |

**Positive controls on every run.** A failure writes an `ERROR` line, never a quiet zero:
- rows > 0;
- ≥ 40 bots;
- `_build_visit` > 0 (asserted explicitly: `Events.count` raises `ZeroLooksWrong` only when a near-miss name exists);
- `jobfacts` read ≥ 12 of the pools seen.

Every run, ok or ERROR, writes a `run` row naming the 16 towns it should have ticked, so a failed run or a town missing from the
rows counts as missing town-ticks.

**Stage-1 go/no-go, at +24 h** (`jobshadow.py summary`):
- (a) ≥ 95% of the expected town-ticks (16 towns × every run, failed runs included) valid;
- (b) unplanned releases ≤ 1 per town-hour (planned term rotations are the design, not churn);
- (c) **a real gap**: some supported role with coverage < 50% in ≥ 4 of 16 towns.

If (c) fails for every role, the assigner has nothing to fix in coverage. Then only the specialisation and legibility case
remains. The read says so, and the next stage goes to the owner as that question rather than being built by default
(INCONCLUSIVE is a legitimate close).

### Stage 2: the writer (tier 1)

The shadow writes `roles-<home>.json`: v1, plus `roles[]`, `mode: "shadow"`, under the writer lock. Bots run with `ROLES` off,
so nothing reads it. The check: `readRoles` parses it, `leaseFor` returns `off`, and `gen` is monotone.

### Stage 3: advisory A1 (tier 2)

The `preferred_other` first right in the non-protected modules (§4), showcase first, then the fleet owner-direct with a
60-minute tripwire. Only the roles with a gap from (c), plus the groundskeeper and builder specialisation the owner asked for.

**KEEP:**
- the gapped role's coverage rises ≥ 15 points against the control towns;
- no role's coverage falls more than 10 points;
- builder specialisation rises (bots doing builder work per need tick falls from about 5 toward 2);
- `build_shop` placements per town-hour are not below control by more than 20% (a guard, since B5 says noise dominates);
- `preferred_other` followed by the job going undone for more than 60 minutes in under 10% of offers;
- the generic death and tripper read.

### Stage 4: binding

The first right becomes exclusive while the holder is fresh. The remedy for a non-holder is unchanged: today's chain minus that
job.

Build it only if advisory shows non-holders still doing more than 30% of a role's work.

## 8. Staged plan (canary-sized pieces)

| # | Piece | Tier | What | KEEP read |
|---|---|---|---|---|
| **1** | **jobshadow-01** (built) | 1 (host report) | `jobrules.py` + `jobshadow.py` + `jobfacts.mjs` + tests; cron every 10 min on the canary host; log only | the first real run, then +24 h `summary`: the §7 go/no-go |
| 2 | jobshadow-02, the writer | 1 (host script; bots run `ROLES` off) | `roles-<home>.json` in the pool directories, `mode: "shadow"`, under the writer lock | 6 h: files fresh in 16/16 towns, gen monotone, 0 reader errors |
| 3 | roles-01, advisory A1 | 2 | first right in the groundskeeper, shop slots, yard and tree farm; `jobroles.mjs` reader (not protected); default = today's when the file is missing or stale | showcase 2 h, then the fleet with a 60-minute tripwire; the §7 advisory lines |
| 4 | roleswant-01, A3 (+ A2, + the deepmine first right) | 3 (two engines, a search, the slot) | a held role's item into `wanted`; `ROLES=on` for the at-town sort; the deep miner's `lease()` reads the role holder. Bundled: all three are the town decision in protected files, and each falls back to today's path on a missing or stale file | holders' role-work share outside town vs control ≥ +10 points; gather yield not down more than 15%; the death gate; +90/+180 generic |
| 5 | roles-02, binding | 2 (+3 for the deepmine half) | exclusive first right with the stale-holder fallback | §7 binding |
| 6 | rollout | — | 20 bots per stage, a read per stage (the owner's qwen rule) | coverage and the death gate per stage |
| 7 | mayor-replay | 1 (host, replay only) | a local model picks among the logged options; `opt0` is applied | §6 mayor go/no-go |
| 8 | mayor-advisory | 2 (config) | apply the mayor's pick in one pool | no worse than `opt0` on coverage; the death gate; the owner's read of what got built |
| — | A4 bounded return | 3 | only if stage 4 shows holders never arrive | arrivals per offer, travel failures, deaths |

## 9. Alternatives and why not

| Alternative | Why not |
|---|---|
| The frontier overseer live now (B6/B7) | In Paper every frontier arm was ≤ greedy and random, and they cost money. Kept only as a stage-7 picker among options. |
| Fixed castes (Alpha is always the builder) | The most legible, but a dead or offline bot leaves a hole, and nobody rests or rotates. Kept only as the continuity tie-break. |
| Auction or contract-net bidding by bots | Two or more bots are at town together about 2% of the time, so bids go stale. It is bot-side tier-3 code. |
| Bot-side response thresholds with no host | No global caps or fairness, every change is tier 3, and it is hard to shadow. Its thresholds and hysteresis are borrowed into the host rules. |
| More per-module leases (the status quo) | No cross-role fairness or caps. It is what produced 5 of 5 bots on every project. |
| Optimal matching (Hungarian / ILP) | 5 bots × 8 roles is tiny, and stale positions and unknown stock dominate. Greedy with aging is enough. |
| Pure greedy re-assignment every tick | Churn: tools and trips abandoned half-way (Codex). |
| A prompt line "you are the miner" alone | Advice printed is not advice taken. Only the measured milestone channel is used (A3). |
| Recall all bots to town; builders wait for a hauler | Kills exploration capacity, and recreates the supply/build start-up deadlock (cooperation tier §3.3). |

## 10. Prior art (searched by both engines, 11-03)

| Source | What it does | What we borrow |
|---|---|---|
| [MineColonies Town Hall](https://minecolonies.com/wiki/buildings/townhall/) | automatic worker hiring fills open workplaces, only at buildings in automatic mode | a role exists only where work and capability exist; an owner or mayor **pin** the rules never override |
| [MineColonies Warehouse](https://minecolonies.com/wiki/buildings/warehouse/) | courier slots scale with the warehouse level (2 a level) | the clerk is a duty sized by backlog, not a headcount |
| [DFHack autolabor](https://docs.dfhack.org/en/stable/docs/tools/autolabor.html) | min/max dwarves per labour, about a third haulers, an idle dwarf is added only if none already idles on that labour | per-role seats, the free bot, no duplicate idle holder |
| [DFHack labormanager](https://docs.dfhack.org/en/stable/docs/tools/labormanager.html) | staffing balanced against skill, an idle reserve, a warning for unclaimed postings | the free reserve and the starvation rule |
| [Dwarf Therapist](https://github.com/Dwarf-Therapist/Dwarf-Therapist) | a readable labour grid with a semi-automatic optimiser | the per-town role table in the tick rows (demand, owner, eligibility, rest), not an opaque score |
| [RimWorld Work](https://rimworldwiki.com/wiki/Work) | 1–4 priorities per pawn and work type; needs override work; a pawn finishes its current task | roles are priorities, not commands; maintenance and reflexes outrank them; no mid-skill preemption |
| [Factorio LTN manual](https://forums.factorio.com/viewtopic.php?t=51072) | requester and provider thresholds, bounded deliveries, a depot of idle trains | LOW/TARGET demand latches; the free bot as the depot. The direct fetch returned 403; the search indexed the manual |
| [Factorio FFF-374, smarter robots](https://factorio.com/blog/post/fff-374) | dispatch by availability and travel, not nearest-idle alone | at-town and free slots rank after feasibility |
| [Bonabeau, Theraulaz & Deneubourg 1996](https://pmc.ncbi.nlm.nih.gov/articles/PMC1688885) | response thresholds; doing a task lowers a worker's threshold for it | demand from deficit; continuity (the last holder is preferred) |
| [Voyager](https://arxiv.org/abs/2305.16291) | an LLM curriculum proposes tasks over a verified skill library | the mayor proposes *among* verified options; it never invents actions |
| [MINDcraft / MineCollab](https://arxiv.org/abs/2504.17950) | LLM agents lose up to 15% when they must communicate detailed plans | coordination stays in files and enums, not chat |
| [MindAgent](https://arxiv.org/abs/2309.09971) | an LLM as a zero-shot dispatcher | the mayor's seat, after B5 showed greedy ties it on matching |
| This repo: B5 (`assign.mjs`, `roles.mjs`), the shadow mayor (10-03), the land plan's `choices` | validator, greedy, TTL leases; prediction is not effect | the validator, the file, the binding rules and the `choices` shape |

The Dwarf Fortress wiki's labour page returned 429 to the Claude engine, so its v50 work details are cited from the search
summary only.

## 11. Where the engines disagreed, and how it was settled

| Point | Claude | Codex | Settled |
|---|---|---|---|
| Isolated pools | a control, no roles ("12 shared towns") | 16 towns, under a private-isolation contract | **Both stale.** All 16 pools have been shared towns since 10-20 (§1). |
| The advisory actuator | A1 first right in the modules, tier 2, deepmine included | the B5 sort bridge first, tier 3, then the module adapters | **A1 tier 2 for the non-protected modules.** `deepmine.mjs` is protected (`config/protected-paths.txt`), so its first right goes to the tier-3 bundle, as does `ROLES=on` (activating protected code). |
| Free bots in a 5-bot town | ≥ 2 | ≥ 1, with 4 assigned | **≥ 1 free and at most 3 primaries**: duties are short, and gather keeps a generalist. |
| Fairness | aging plus a 120-min starvation jump | a rotating fourth "service seat" in 15-min quanta | **Aging and starvation** (simpler, testable), plus Codex's displacement margin (20 points for 2 ticks) and its no-work cooldown (10 min, not a full rest). |
| Travel | A3, the `wanted` hoist, before any recall | a bounded return/supply intent | **A3 first** (no new travel; a measured channel). The bounded return (A4) only if A3 shows holders never arrive. |
| Stage-1 gate | needs a real coverage gap, else stop | validity, invariants and exposure counts | **Both:** validity first, then (c) a gap; without one the next stage goes to the owner as a question. |
| Mayor cost | local qwen first, 1 call / 30 min | replay first, 1 call / hour, a $15 sub-budget | **Local model, replay first, 1 call / hour, $15 sub-budget** for any frontier arm. |
| Iron marks | < 24 | 15 / 30 | **15 / 30.** The towns hold 10–19 ingots today (jobfacts, 11-03), so < 24 would keep the miner on everywhere. |
| Roles per bot | 1 primary + 1 duty | one | **One:** legible, and the shadow's measures stay clean. |

**Both engines agreed independently on:**
- the shadow is a host read, not a bot canary;
- the native lease holder wins;
- B5 rules out a throughput claim;
- the mayor picks among options, with the rules as the fallback;
- concordance is prediction, not effect.

## 12. Blocker reviews (one round, both engines)

Both engines reviewed this file and the stage-1 code at `827b892e` (the first commit on the branch), blockers only,
without seeing each other's review. Both said **BLOCKERS**. Every one is fixed, with a test, in the next commit; a second round
re-checked only those fixes (below).

| From | Blocker | Fix |
|---|---|---|
| Claude 3, Codex 1 | A live native lease holder never took over a role the rules had given to another bot, and could be handed a second role | Step 0 of `assign`: native holders are imported first (a rules holder of that role is released `native`, no rest; a native bot leaves any other role); imports may exceed a cap, nobody native is evicted. Tests: the repro, one role per bot when native twice. |
| Claude 4, Codex 2 | A starving primary could make a 4th primary; caps were not re-enforced when bots dropped out; a mayor option could break a cap | At a primary or miner cap, starvation displaces a primary (a miner) instead of taking a free seat; after the held-role checks the least urgent non-native holders go until seats and primaries fit; `caps_ok` filters every option. Tests for each. |
| Codex 3 | Visits and rows that moved nothing (`no_tool placed=0`, a complete visit with no counts, `_expedition op=skip`) counted as role work, hiding gaps | `role_of` returns progress: a build visit counts when placed + cleared + planted (+ dug/filled/felled/repaired) > 0; skill rows on `success`; deep-miner progress ops; skips and errors are no work. Coverage uses progress; attempts are reported as `tried`. |
| Claude 2, Codex 4 | The validity gate could not see a failed run or a missing town | A `run` row every run (ok or ERROR) naming the 16 expected towns; validity = ticks / expected town-ticks. |
| Codex 5 | The `_build_visit` control does not raise on 0 when no near-miss name exists | `proof['build_visit'] > 0` asserted. |
| Claude 1 | The churn gate failed on correct behaviour (term rotations) | Gate (b) counts unplanned releases only; a 24-h steady-need test passes it while total churn > 1 (the positive control). |
| Codex 6 | Stage 1 is tier 1 by fun mode (a non-protected read-only report), not tooling | Relabelled (§7, §8). |
| Codex 7 | A stale shadow becomes a stallcheck finding, which reaches the owner's daily notice | **Not taken as a blocker:** the "never page the owner" line was this review brief's own over-strict wording. A dead monitor surfacing like every other monitor is the project's rule ("alarm log nobody reads"). The shadow itself raises no alarm. |

**Round 2** (both engines, the fixes only). FIXED: native ownership, caps (Claude fuzzed 3,000 seeds × 40 ticks: no duplicate
role, no cap or seat break, no option breaking caps, no crash), the build-visit control, the tier, churn. Still open, fixed in
round 2's commit:

| From | Blocker | Fix |
|---|---|---|
| Codex r2 | Zero-progress deep-miner and expedition rows (`branch n=0`, `pickaxe why=not_made`, `marker_skip ... no_effect`) still read as progress | The producers' own vocabularies (`skills.mjs deepRow` / `exRow`): `landing/deepen/seal/surfaced` always progress; `ore`/`branch` only with `n > 0`; `repair` only when repaired; `pickaxe` only when made; expedition `start/marker/deposit/detour/home_follow`; skips and `no_effect` are attempts. Tests for each named row. |
| Claude r2 | Validity's denominator was the runs that wrote a row: a crash outside the try, a run `flock` skipped or a silent cron was invisible | The whole run is wrapped (every failure writes `run ok:false`), and the expected town-ticks are also taken from the **schedule** (one run per 10 min from the first run in the window × 16 towns); the larger wins. Tested with two runs 60 min apart (7 × 16 expected). |

**Round 3** (both engines, the round-2 fixes only). Both found the same two residues, fixed in round 3's commit:

| From | Blocker | Fix |
|---|---|---|
| Claude r3, Codex r3 | `deepen` is written on every call, a stall included (`n=-40->-40`, status defaults to success); Codex also: an expedition `deposit items=0` | `deepen` counts only when `n=y0->y1` went down; an empty deposit is an attempt. Tests for both rows. |
| Codex r3 (Claude r3 as a note) | The schedule started at the first SURVIVING run in the window: six runs at the end of 24 h read 100% valid | The schedule starts at the window's start, or at the first run ever when the shadow is younger than the window. Tested both ways. |

**Round 4** re-checked these two fixes only (below the table's commit).

Non-blocking notes acted on: the displacement count restarts when the waiting role is not ahead (consecutive, as designed);
the cron line takes `flock -n` (no overlapping runs); clerk demand is the backlog only. Left as notes: `jobfacts` reads the
`*On({}, pool)` defaults, not the pools' drop-ins, and gives `activeProject` no `waiting`/`due`/`free`, so `active_build` can
differ from what a bot picks (the tick row carries `active_build`; a mismatch with the rows' actual projects shows in the read).

## 13. First real run

_Filled in below after the install._
