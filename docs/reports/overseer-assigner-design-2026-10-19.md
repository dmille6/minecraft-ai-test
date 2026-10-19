# The overseer as the town-projects job assigner ("the foreman"): design r2, 2026-10-19

Owner, 10-19 ~13:00Z: "yes". Bring the overseer back as the town-projects job and role assigner. Design it first, with
both engines. This document is design only. No bot code was written, nothing was deployed, no queue was edited, and no
host service was touched.

- **Evidence:** `docs/reports/overseer-assigner-census-2026-10-19.txt` (raw outputs, r1 and r2), produced by
  `scripts/host/overseer_census/*.py`. These are ES queries, read only, run on 10.0.0.31 from ~/estel. `coord_r2.py`
  supersedes `coord.py` for C1-C4 and C7.
- **Reviews:** `docs/reports/overseer-assigner-reviews-2026-10-19.txt`, summarised in section 8.
- **Window:** the 24 h ending about 12:40Z 10-19.
  - 1,495,961 skill docs from 80 bots, 1,920 bot-h; one log rotation crossed.
  - The fleet was a9cff42c, then 6bea246c, then adbec4f4 from about 01:30Z. bamboo-02 ran on hive-a and hive-b from
    02:05Z to 05:15Z, and was REVERTED.
- **"Shared towns"** means the 12 board, hive and placebo worlds. Isolated pools are excluded, as in townprojects D2,
  except where a line says otherwise.

## 0. Answers first

1. **Why C2 and the shadow mayor showed no benefit (section 1).** What they did *not* establish is clear. Why they
   failed is only partly established.
   - **Established limitations:**
     - The mayor gate scored prediction, not effect. It was shadow only, with no actuator.
     - C2 had 3 blocks where about 28 were needed. Its primary metric was 56% cobblestone. It ran on fresh 70-minute
       worlds with no shared task.
   - **Established negative:** GET_WOOD is the one duty with real selection content (which bot is nearest a live log
     sighting). There the rule only **tied** random: xbase 0.72 against leased-random's 0.71. Both are below 1.0, which
     means below the base rate. See 1.1.
   - **Not established:** that the directives displaced work, or that dead sightings caused the losses. The C2 readout
     found no clear dose-response and says it "does not isolate the channel".
   - **The headroom has moved since.** The ~180 bot-h/day full-bag gap went to deterministic per-bot fixes.
2. **What an assigner would help with today: little that a deterministic rule cannot do more cheaply (section 2).**
   - **Distribution headroom exists, but it is policy-shaped.**
     - At 69% of the 484 "no coal in town" smelt stops, a townmate carries fuel.
     - At 77% of the 253 toolkit `no_iron` refusals, a townmate carries 3 or more ingots.
     - Both are as common at town-matched random moments, because `IRON_LADDER` keeps coal and iron in bags.
     - A banking rule takes this headroom deterministically.
   - **Repeated discovery** ("no copper", "empty furnace", "lid-blocked") is at most about 2.4 bot-h/day of 1,920, as
     an upper bound on candidate savings.
   - **The town stock journal is largely blind:** 694 of 814 shared-town counts are lid-blocked.
   - **The coordination problem an assigner exists for is not on the fleet.** The deployed build adbec4f4 contains no
     builder, blueprint or monument code. The same `git ls-tree` grep finds `builder.mjs`, `buildbot.mjs`,
     `monument.mjs` and `structures.mjs` on shaft-01's variant fbc3621. ES shows no multi-bot project rows in 6 days.
3. **Architecture (section 4).**
   - A host-side foreman issues **role leases** in a fenced file.
   - A lease only **reorders** a bot's deterministic town-job list. It never names a coordinate and never calls a
     skill.
   - RECALL is **out of v1** unless S0 shows `home` succeeds at least 70% of the time under the validator's own filter
     (today: 77 of 378, 20%).
   - **Fallback:** every 5-minute deterministic tick rewrites the file. A tick with no valid model answer writes an
     explicit **empty generation**, which revokes all leases at once.
   - **Studio:** brain-01 has priority, and the foreman skips the tick on stale load telemetry.
4. **Measurement (section 5).**
   - **Primary:** intention-to-treat witnessed cells placed per **project-open** town-hour, stalls and outages included.
   - The unit is the town. The analysis is randomization inference, pre-registered with a pre-period null.
   - **Positive controls:**
     - an instrument check (a fixture, and a starved arm);
     - a headroom test (an oracle restricted to the deployable lever against rotation, powered from run-to-run
       variance, at least 6 pairs).
5. **Recommendation (both engines agree, section 8): do NOT revive the acting overseer yet.**
   - **First step S0:** a deterministic, read-only staffing census.
     - It is built **with yard-01's (or monument-01's) read**, not as a standing service that prints zeros.
     - It needs a fixture positive control and a heartbeat.
   - **Meanwhile:** queue the cheap deterministic fixes (coal and iron banking, a town-shared miss memory, lid-blocked
     counts).
   - **The LLM foreman follows the first live multi-bot project,** and only if its gates pass.

## 1. Why C2 and the shadow mayor showed no benefit

### 1.1 The shadow mayor
Sources:
- the registered read of 10-06, `/var/lib/mcai-mayor/score-decision-20261006.json` (11,008 snapshots, 1,814,493 rows,
  10-03 18:02Z to 10-06 03:18Z);
- the memory note `shadow-mayor-stop-1006`;
- `shadow-mayor-plan-2026-10-03.md` lines 61-87.

| duty | mayor xbase / leased-random xbase | the pre-registration's expectation | reading |
|---|---|---|---|
| FREE_BAG | 1.10 / 1.05 | about 1.0 "by construction (no selection value)" (plan lines 70-71) | **measurement:** prediction could not exceed random here |
| RESTORE_PICK | 1.11 / 1.11 | about 1.0, by construction | measurement, as above |
| GET_WOOD | 0.72 / 0.71 | not stated | **a real negative.** This duty has selection content, and the rule tied random; both are below the base rate |
| GET_IRON | 0.69 / 0.70 | "cannot pass in any case" (unknown bank) | measurement |

- **Established:** the gate scored prediction (concordance: the bot did the duty anyway within 30 min). It could not
  score an effect, so it could not show one.
- **Also established:** the plan itself says matched periods "do not by themselves make the ratio unbiased" (lines
  84-87). So the read does **not** prove that every self-maintenance allocation has zero selection value. It shows only
  that *this rule* did not beat random.
- **Headroom moved:** the unforced FREE_BAG gap was 429.6 bot-h over 2.39 days. After that came towndeposit, junk well,
  plinth wells and cobblecap. 24 of 80 bots are still at 34 or more slots (STATE 10-18), but that is each bot's own
  bag.
- **Operational, found now:** `mcai-mayor-shadow` has been **down since 10-13 21:23:49Z**. It hit its own 1 GiB output
  cap (exit 6, which by design stays down). The note "keeps recording" is false for 5.6 days. Nothing was restarted.
  The lesson for S0 is in section 6: a dead census must read **void**, not zero.

### 1.2 C2 (closed loop, 10-07/08)
Source: `model-selection-2026-10-05.md` lines 819-965.

| | evidence | status |
|---|---|---|
| Underpowered | 3 blocks, paired-t with 2 df. For a 30% effect, about 65% power at 20 blocks and 80% at about 28 (lines 956-957) | **established** |
| The primary was not the goal | cobblestone is 56% of none's output, 69% of the det gap and 75% of the esc gap. Iron-tier value is level (lines 863-866) | **established** |
| No joint task | a fresh world restored before each run; 8 bots with empty inventories; 70-min horizon | **established** (design) |
| Allocation skill | gpt-oss:120b was exact on 15 of 15 allocation problems at medium and 55 of 60 at low; all 54 C2 calls were validator-clean | established offline, so it **cannot exclude live allocation failures** |
| Displacement by directives | directives held 2.5-7.3% of bot time. "No clear descriptive dose-response": the two highest-dose ov runs gave the best treatment outputs (lines 887-889). It "does not isolate the channel" (line 945). Completed shares were det 60%, ov 42%, esc 56%; released shares 40%, 57% and 36% (90-min counts, not the 70-min metric window) | **hypothesis, not established** |
| Dead sightings | 3 ov GET_WOOD directives went to a stripped sighting. det block 2 had 8 and was det's best run (302): "not sufficient" (lines 920-925) | **hypothesis, not established** |
| The ov block 1 collapse (82) | unexplained in the readout | **open** |
| Delivery | the first smoke received 0 of 15 (the mineflayer chat-name pattern). The second smoke lost 7 of 18 because an operator's duplicate `mbench_Mayor` client was flapping. The third smoke passed | fixed before the series |

Prior art:
- **MineCollab** (arXiv 2504.17950): detailed plans passed in chat cost about 15%, and success fell from 2 agents to 5
  (`~/Documents/mcai-playground-notes/claude-prior-art.md`).
- **VillagerAgent** (arXiv 2406.05720): a task DAG plus a controller that assigns *ready* subtasks to agents by state
  beat AgentVerse on VillagerBench.
- Both point at the same requirement: an assigner needs a task graph. Here, that graph comes only with a project.

**Verdict on question 1.**
- What is shown: neither test *could* show a benefit from assignment, and on the one selection-bearing duty the rule
  tied random.
- What is not shown: that an LLM assigner cannot help.
- Reviving it is worth it **where there is joint work and a metric that counts it**. That is not the fleet today.

## 2. What an assigner would help with now: the coordination census

Every number gives its denominator. "Control" is the reading it was checked against.

### 2.1 Bot time (24 h, all 80 bots)

| | bot-h | share of 1,920 |
|---|---:|---:|
| body time inside the 27 listed skills | 448 | 23% |
| the brain's idle choice (`llm:idle`): explore 94.4, gather 77.4 (dirt 61.8), goto 44.9, mine 13.3, craft 2.1 | ~232 | 12% |
| town jobs (smelt_town, furnace_drain, count_town, town_deposit, withdraw_pick, toolkit, dispose_well, compost, wear_out, plinth/well, bamboo) | 15.8 | 0.82% |
| outside any listed skill (decisions, cooldowns, reflexes, waits) | ~1,472 | 77% |

- **The ~232 bot-h is not spare labour.** It is the brain's normal choice, about 25 bot-h of it iron mining and
  gathering, and it includes isolated bots.
- It is the **upper bound** a project could draw from. The largest pool, the 1,472 bot-h outside any skill, is
  unexamined here.
- Dirt is 16,746 of the 26,403 gathers and 163 of the 190 gather bot-h. Bots hold a median of 7 dirt afterwards. That
  the dirt is used as scaffold is inferred, not established.

### 2.2 Candidate coordination failures (shared towns)

| # | candidate | measured | control | reading |
|---|---|---|---|---|
| C1 | **Repeated "no raw copper"** | **606 of 952 (63.7%)** repeat another bot's finding in the same town within 2 h with **no** intervening deposit, dispose or smelt success there (r2). 1.60 bot-h | the same parse finds 115 successes and 491 "no coal" | an **upper bound** on candidate savings. Copper arrives at about 28/world/day, so some repeats are due re-checks. Rows do not name the container |
| C2 | **Repeated check of the same empty furnace** | **316 of 764 (41.4%)** within 60 min with no non-drain furnace session in between (r2). 0.76 bot-h | 449 failed and 107 aborted drains parse | candidate savings |
| C3 | **Lid-blocked town counts** | 694 of 814 shared count_town rows are lid-blocked; 188 counted at least one container (the classes overlap). 504 (72.6%) repeat another bot's within 60 min with no intervening change. 0.09 bot-h | — | the bigger fact: **the town stock journal is blind in many towns.** Of the 12,673 refused entries (all pools), 8,687 are `*_unknown`. Their link to lids is inferred |
| C4 | **Smelting waits on fuel** | 491 of 1,746 smelt_town runs stop on "no coal in the town containers". At 336 of 484 (69.4%, 95% CI 65.5-73.6), a townmate carried 1 or more coal or charcoal; at 52 (10.7%), 8 or more | town-matched random moments with the identical predicate: 65.1% (63.2-67.1) for 1 or more, 11.4% for 8 or more | **real distribution headroom, standing and policy-shaped.** Fuel is in bags because `IRON_LADDER` never banks it. A **coal-banking rule** removes it |
| C5 | **Copper supply** | 951 "no raw copper" against 115 successes (101 batches). Successes by world: hive-b 32, board-c 17, hive-c 16, every other world 10 or fewer | 1,646 smelted in the 12 h after smeltjob-01's promotion (STATE 10-17) | **the backlog is mostly gone;** this is supply-bound |
| C6 | **Room skips** | `_smelt_job_skip` 2,113: room 1,267 (60%), town_has_none 537, nothing_to_drain 309 | — | the one place where *which* bot matters. Small while supply binds |
| C7 | **Iron in one bag, needed by another** | 253 toolkit `no_iron` refusals. At 195 (77.1%, 71.9-82.2) a townmate carried 3 or more ingots | town-matched random moments: 78.1% (75.7-80.3) | **real headroom, standing and policy-shaped** (iron is kept in bags). An **iron-banking rule** (a surplus above the bag's own pickaxe need) takes it |
| C8 | **Target contention while gathering** | gather failure rows never name a competitor (0 of 15,791), so that instrument is **blind**. Spatial association: contested gathers succeed 55.9-57.1% against 37.1-40.4% | 3,574 contested cases were found | **descriptive only.** Confounded by location quality; uses end positions and x/z only. Neither harm nor its absence is shown. 1,075 `_dig_collision` rows are uninterpreted |
| C9 | **Jobs pile up or starve** | top-bot share of town successes (towns with 5 or more): smelt_town median 0.60, town_deposit 0.44, withdraw_pick 0.38, toolkit 0.31, dispose_well 0.44, compost 0.43; median 4-5 of 5 bots | — | spread already |
| C10 | **Duplicated builds; projects waiting on haulers** | **not possible on the fleet.** adbec4f4 has no builder, blueprint or monument module. ES shows 0 kinds matching project, ziggurat, monument, shaft, yard, storehouse or hall in 6 days (8.64M docs) | the same grep finds builder, buildbot, monument and structures on fbc3621 (shaft-01's variant). The same ES census sees `build_well` 6,388 and `_plinth_step` 811. The 11 `build` rows are single-bot brain "pillar" plans, with 0 blocks placed | **the assigner's job does not exist yet.** monument-01 and shaft-01 are queued and held; yard-01 is not built |

**Verdict on question 2.**
- C4 and C7 are real distribution headroom. But they are standing and policy-made, so a deterministic banking rule is
  cheaper and more reliable than a model.
- C1-C3 are a shared miss memory, worth at most about 2.4 bot-h/day.
- C3 also says the foreman's main input is blind today.
- Assignment becomes the right lever when a project brings parallel cells, a bill of materials and part chains.

## 3. What the foreman would do, once a project is live
1. **Supply:** point a free bot's next *deterministic* supply job at the project's short bill-of-materials item.
2. **Selection:** give the build or part job to a bot with room, tools and parts. That is the C6 class.
3. **Recall:** bring an idle bot home. This is gated: `home` succeeds 20% of the time today.
4. **Ordering** projects and variants. The strategist's later input.

The mayor showed that a *rule* doing (2) on self-maintenance was not better than random. The bet is that (1) and (2)
over a project's task graph, VillagerAgent-style, beat the fixed rotation. Section 5 tests that bet.

## 4. Architecture

### 4.1 Placement and cadence
- **Host-side** on 10.0.0.31, the `mcai-foreman` unit: Nice 10, MemoryMax 512M, CPUQuota 25%.
  - Output rotation, not a hard stop (the mayor's failure mode).
  - A **heartbeat file** per tick, which every read checks. A stale heartbeat makes the period **void**.
- A **deterministic tick runs every 5 min per town**, always.
- **The model call:** gpt-oss:120b at medium. At most one per town per 15 min, plus events (a project stalled for 10
  min or more, a state change, a released lease), debounced to 5 min.
  - **Global cap:** 24 calls/h.
  - **In the canary:** only the drawn towns.

### 4.2 Inputs (one immutable snapshot per tick, written before any call)
- **Town stock:** a fold of `town-chest-*.cobble.jsonl` `cnt` records per container. Each item is labelled `known`,
  `unknown(lid_blocked)` or `stale(>2 h)`. Unknown is never zero.
- **Project records:** open cells (placeable or not), the bill-of-materials shortfall net of reservations, part chains,
  and the leases (project, furnace, line, siting).
- **Bot roster:** the latest row per bot: position, distance home, estimated slots, tools, current skill and order, trap,
  drowning and low-health flags (last 5 min), refusals by job, and brain-01 stratum.

### 4.3 Outputs: role leases
- **Schema:** `{town, gen, leases: [{bot, role, target?, ttl_min ≤ 30, reason, evidence: [ids]}], unstaffed, abstain?}`.
- **Roles in v1:**
  - `BUILD(project)`;
  - `SUPPLY(item)`: the deterministic withdraw, craft or gather job whose own eligibility already serves that project
    item;
  - `SMELT` / `PARTS`;
  - `FREE`.
- **Not in v1:**
  - **MINE**: junkwell-01 showed that more mining sends bots into the fleet's sealed-pocket and lava deaths.
  - **RECALL**: section 6 gates it on S0's measured `home` success.
- **Bot-side semantics:**
  - A held, unexpired, newest-generation lease changes only the **order** in which the existing town-job list is
    evaluated. It replaces townprojects 6's letter rotation for that bot.
  - Each job still runs its own pure `xOrder(readings)` eligibility and admission.
  - The milestone's ready rung wins. Reflexes are untouched.
  - **No coordinate, no new skill call.** A lease can only make a bot do sooner what a deterministic job would let it do
    anyway.
  - The change is one reader plus one sort key, inside the `if (!order)` chain.

### 4.4 The deterministic validator (host side)
- Schema, ids, a monotone `gen`.
- **Caps:** at most 1 BUILD per project (the project lease remains the fence); at most 2 SUPPLY per item; at most 3 of 5
  bots leased; at least 1 FREE.
- **Executable from here:**
  - The role's job must be eligible for that bot **now**, by the same pure eligibility function the bot runs, evaluated
    on the snapshot.
  - **The bot re-checks it fresh** when it honours the lease. A lease the bot finds ineligible is released at once
    (below), and counted against the model.
- **Safety:** no lease for a bot with a trap or drowning flag in the last 5 min, health ≤ 10, a ready rung, or a reflex
  holding the body.
  - The host cannot see the bot's path, so a lease never moves a bot anywhere a deterministic job would not.
  - The r1 death-site check is dropped as not computable.

### 4.5 Delivery, revocation and the refusal chain
- **Delivery:** write `/var/lib/mcai/_pool-<pool>/roles-<home>.json` atomically by rename, with `gen`, `issued_at` and
  per-lease `expires_at`.
  - Bots already read the pool state directory (furnace leases).
  - Not chat: C2's first smoke lost every directive on the chat path.
- **Fencing:**
  - `gen` is persisted on the host and only increases.
  - A bot honours only the newest `gen` it has seen and `now < expires_at`.
  - After a bot restart, it re-reads the file and honours only unexpired leases.
  - After a host restart, `gen` continues from disk.
- **Revocation:** **every** 5-minute deterministic tick writes a new generation.
  - When there is no valid model answer (an abstain, an invalid answer, a timeout, or the Studio unreachable), that
    generation is **empty**, and every lease is revoked within 5 min.
  - If the foreman itself is dead, TTL (at most 30 min) bounds it, and the heartbeat voids the period.
- **Refusal chain:**
  - A refused, failed, skipped or ineligible role job releases the lease and writes `_role_released`.
  - It costs only that job's normal cooldown.
  - The bot returns to **exactly the baseline decision path**, which is the control arm's.
  - The same role cannot be re-leased to that bot for 30 min.
- **Why this is not a new dead end:**
  - The foreman adds no refusal of its own. Every refusal belongs to an existing job that already has its tested
    remedy chain.
  - The chain test runs a lease into each job's refusal and asserts that the next decision is the baseline one. It is
    tested as a composition, not one guard at a time.
- **World mutation stays bot-only:** bag deltas and server-witnessed placements, as in the townprojects accounting.

### 4.6 Cost, compute and Studio contention with brain-01
- **Money:** none beyond power. No API key is needed. The frontier strategist comes later and is owner-keyed.
- **Memory:** gemma4 8-bit (28 GB, loaded, idle at 12:40Z) plus gpt-oss:120b is about 93 GB co-resident with no swap
  (10-06 re-test; 128 GB Studio).
- **Load:** in the canary, 16 calls/h at about 30-60 s each is 8-16 GPU-min/h.
- **Interference:**
  - C2 measured, with gpt-oss **resident**, brain p50 +0.07-0.24 s and p95 about +1 s while gpt-oss was called.
  - At a 15-30 min cadence the model could unload between calls. So **pin `keep_alive`** for gpt-oss, or measure
    reload spikes against brain-01 in S2.
- **Priority rules:**
  - The foreman **skips** a tick if brain-01's proxy p95 over the last 5 min exceeds 10 s, if that telemetry is
    **stale or missing**, if a `GPU_RESERVED` other than `brain01-live` is held, or if `~/brain01/PAUSE` exists.
  - A skip is an empty generation.
- **Experiments are serialized:** the foreman canary takes the one canary slot (CLAUDE.md), never concurrently with
  brain-01's canary or any other. If a brain-01 subset is KEPT, its pools are excluded from the foreman's draw and from
  its control, with the stratum recorded.

### 4.7 Composition
- brain-01 keeps FREE time.
- townprojects leases stay the fences.
- The strategist (later) reads the foreman's daily town reports and orders projects. It never edits blueprints.

## 5. Measurement: pre-registered, and built not to repeat C2

| | C2 | the foreman |
|---|---|---|
| world | fresh, empty, 70 min | the fleet's own towns with stock, 72 h or more |
| primary | resource value, 56% cobble | **witnessed project cells per project-open town-hour, intention to treat** |
| unit and analysis | 3 sandbox blocks, paired-t with 2 df | the town. **Randomization inference** over towns, with clustered intervals |
| power | stated after the fact | computed **before launch** from S0's pre-period null |
| dose | directives sent | leases honoured (`_role_honoured` / `_role_released` from bot rows) |
| headroom | assumed | S0's assignable town-hours, plus S1's oracle test |

- **Arms:**
  - A, the rotation: control towns, and canary towns in the pre-period.
  - B, foreman leases.
  - The draw is arbitrary over the eligible towns (CLAUDE.md), with brain-01 pools excluded.
- **Eligibility at the draw:** a project is sited and open in the town. With 12 shared towns minus the brain-01 pools,
  S3 needs **at least 4 canary and 6 control eligible towns**. If fewer are eligible, S3 waits.
- **Primary:**
  - The numerator is placed and server-witnessed project cells, RCON-verified at the end.
  - The denominator is the town-hours the project is **open**. That is fixed town-time, and it includes supply stalls,
    foreman skips and Studio outages. It is not "placeable" hours, which treatment changes.
  - If a project completes, the town's next queued project continues the clock. If there is none, the town leaves the
    denominator, in both arms.
- **Decision:**
  - **KEEP:** the lower bound of the DiD above **+15%**, and the harm gates clean.
  - **REVERT:** the upper bound below 0, or any harm gate tripped.
  - Otherwise **INCONCLUSIVE** at the deadline. The deadline is fixed in the registration from the power calculation:
    at least 80% power for +25%. If the power calculation needs more than 7 days, S3 does not launch.
- **Co-primary, reported:** stall-hours (a project open, a part short, no bot on it).
- **Secondary:** shortage-to-delivery latency, lease executability (at least 80% honoured), validator-clean (at least
  98%), brain p95 delta (at most +2 s).
- **Harm gates:**
  - deaths, by the two-death floor and 1.25x the control rate;
  - immobile and stuck DiD within the null;
  - **gather and rung completions per bot-h DiD no worse than -10%** (the displacement budget, stated);
  - any lease to a flagged bot (a deterministic defect means REVERT).
- **Exposure:** at least 60 canary town-hours that are *assignable*. A town-hour is assignable when a project is open,
  2 or more bots are at town, and a role would change the job order. Unexposed means INCONCLUSIVE early (owner 10-15).
- **Positive controls** (S1, Paper sandbox4, before any LLM shadow):
  - **(a) Instrument check.** The S0 census on a **fixture project record** and on a replay of a sandbox yard run must
    count known assignable minutes exactly. The *starved* arm (no BUILD for 30 min) must lower cells per hour.
    - This proves the metric and the census can see staffing. It does **not** prove allocation binds.
  - **(b) Headroom test.** An **oracle restricted to the deployable lever** against the rotation:
    - The oracle is a scripted lease writer that uses only the v1 role API, with the same validator and the same
      bot-side reader.
    - Stock is cut from a real town's census snapshot: the same material provenance and representative shortages, not
      seeded plenty.
    - Arm order is randomized within pairs. The number of pairs is **pre-registered from the yard runs' run-to-run SD,
      with at least 6**.
    - **Pass:** the oracle beats rotation by at least S3's minimum detectable effect, at p < 0.05 by a paired
      permutation test.
    - **If the oracle cannot beat rotation, no LLM can, and the line stops there, recorded as INCONCLUSIVE-by-design.**
- **Analysis code:** the read and its self-test (a failing fixture per gate) exist and pass **before** the pre-period.
  Thresholds are frozen in the registration.

## 6. Smallest first step, then gates

| step | what | gate to the next |
|---|---|---|
| **S0** (about 2 days, built *with* the first multi-bot project's read: yard-01 or monument-01) | **The staffing census.** Deterministic, read-only, host-side, **no LLM, no bot code, no canary slot**. Every 5 min per town it records: open projects, BOM shortfall, bots at town and their state, assignable minutes, cells per open town-hour (the pre-period null), stock with unknowns labelled, **and `home` success under the validator's filter**. Heartbeat plus rotation, with a stale heartbeat reading void. **Its fixture self-test passes before any live reading**: a live zero is a negative, not a control | the project is live and KEPT; S0 shows **at least 20 assignable town-hours/day** across eligible towns for 48 h |
| **S1** | Paper: the bot-side lease reader (one sort key) **and its chain tests, reviewed by both engines**; positive controls (a) and (b) | (a) passes; (b) passes |
| **S2** | LLM foreman in **shadow** for 72 h: proposals on S0 snapshots, nothing delivered | at least 98% validator-clean; at least 80% executable at issue and re-checked at +5 min; brain p95 delta at most +2 s with reload spikes measured; stall-naming recall at least 0.6 against S0's stalls |
| **S3** | the canary, at least 4 towns, in the one canary slot. A non-bag-fix 4-pool draw needs canary-report.py / tripper support **and owner approval** | section 5 |

**In parallel, deterministic, each its own small canary or setting change, owner approval needed:**
- **coal banking** (C4): bank coal and charcoal above a bag reserve;
- **iron banking** (C7): ingots above the bag's own pickaxe need;
- a **town-shared miss memory** (C1-C3);
- **lid-blocked counts** (C3; lidclear refuses dirt lids).

These take the measured headroom without a model, and they make the foreman's stock input honest before it exists.

## 7. What would change the answer
- **A live multi-bot project** with at least 20 assignable town-hours/day in S0, and an oracle that beats rotation. That
  is the expected path to an acting foreman.
- **Fewer, smarter bots** (owner 10-05: 4-8). One town of gemma bots on long projects makes assignment the main lever.
  The canary is then a twin world, not a 4-of-12 draw.
- **Not:** a better model on the old self-maintenance duties. The rule there tied random even on GET_WOOD, and the
  deterministic fixes have since taken that headroom.

## 8. Reviews

The prompt given to both engines is in the reviews file. The reviews were of r1 (cd57e3f3). r2 is this document.

**Round 1: both engines agree: do NOT proceed as an actor now; S0 is the first step.**

| | Codex (`codex exec --sandbox read-only`) | Claude (independent subagent) |
|---|---|---|
| verdict | **CHANGE** | **APPROVE-WITH-CHANGES** |
| proceed as actor now | **no** | **no** |
| first step agreed | **yes** ("S0 remains the appropriate first step; today's LLM shadow lacks a demonstrated assignment opportunity") | **yes**, with a fixture positive control and a heartbeat; cheap fixes queued alongside; S0 built with yard-01's read |

What r2 changed, by finding:

| finding | r2 |
|---|---|
| Codex 1, Claude 1-3: the diagnosis overstated; GET_WOOD omitted; 55/60 at low; displacement and dead sightings unestablished; the smoke loss was an operator duplicate | 1.1 has all four ratios and the GET_WOOD negative. 1.2 sorts findings into established / hypothesis / open. Figures corrected |
| Codex 2, Claude 5: C1-C3 keys, invalidation, denominators | `coord_r2.py`: state-change invalidation, the furnace key, shared-town-only counts. Results relabelled as candidate upper bounds (91% -> 64%, 44% -> 41%, 89% -> 73%) |
| Codex 3, Claude 4-5: C4/C7 predicates and controls; "not special" is not "no headroom" | identical predicates, town-matched controls, bootstrap CIs. Reworded as real, policy-shaped headroom. Coal and iron banking added to section 6 and to decision 6 |
| Codex 4, Claude 5: C8 | descriptive only; the instrument is blind; `_dig_collision` uninterpreted |
| Codex 5, Claude 13: C10 by names only; the 232 bot-h | C10 now rests on the deployed code tree (adbec4f4 against fbc3621), plus ES. The labour pool is an upper bound, not demonstrated |
| Codex 6, Claude 8: RECALL and the revocation gap | RECALL out of v1, gated on S0's `home` success. An empty generation every tick revokes. Bot-side fresh re-check, restart fencing, composed chain tests. Death-site check dropped |
| Codex 7, Claude 11-12: the concurrent lanes, 4-town support, eligibility, call bounds, keep_alive | serialized in the one slot; at least 4 + 6 eligible towns; canary-report support plus owner approval; global 24 calls/h; skip on stale telemetry; keep_alive pinned |
| Codex 8, Claude 9: a post-treatment denominator | intention to treat over project-open town-hours, outages and stalls included; completion handling; randomization inference; power before launch; displacement budget -10% |
| Codex 9, Claude 10: the starved arm is a tautology; 3 pairs are underpowered | starved relabelled as an instrument check. The headroom test is an oracle on the deployable lever, with real-town stock, at least 6 powered pairs and a permutation test. The lease reader moved into S1 |
| Claude 6-7: a zero as control; a silent death | S0 fixture self-test before any live reading; heartbeat voids, plus rotation |

**Round 2** (on r2): recorded below.

(pending)

## 9. Owner decisions needed
1. **Accept "not yet as an actor":** S0 is built with the first multi-bot project's read, and the LLM foreman is gated
   on S0, S1 and S2. Alternatively, override for an immediate LLM shadow, which both reviews expect to repeat the
   mayor result.
2. **Which project comes first:** monument-01 (ziggurat; held behind minewell, needs a re-hold decision) or yard-01
   (townprojects stage 3; not built). The foreman's first possible job waits on this.
3. **A 4-pool non-bag-fix draw for S3:** it needs canary-report and tripper support.
4. **Studio priority:** brain-01 first; the foreman skips under load; gpt-oss keep_alive pinned (about 65 GB resident
   next to gemma).
5. **mcai-mayor-shadow** has been down since 10-13 (output cap). Archive it and leave it stopped (recommended), or
   restart it.
6. **The deterministic fixes,** to queue or not: coal banking, iron banking, a shared miss memory, lid-blocked counts.
