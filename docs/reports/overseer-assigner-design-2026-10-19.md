# The overseer as the town-projects job assigner ("the foreman"): design, 2026-10-19

Owner, 10-19 ~13:00Z: "yes". Bring the overseer back as the town-projects job and role assigner. Design it first, with
both engines. This document is design only. No bot code was written, nothing was deployed, and no queue was edited.

The evidence is in `docs/reports/overseer-assigner-census-2026-10-19.txt`, made by the scripts in
`scripts/host/overseer_census/` (ES, read only, run on 10.0.0.31 from ~/estel). The window is the 24 h ending about
12:40Z on 10-19:
- 1,495,961 skill docs from 80 bots, 1,920 bot-hours;
- one log rotation is crossed;
- the fleet was a9cff42c, then 6bea246c, then adbec4f4 from about 01:30Z;
- the bamboo-02 canary ran on hive-a and hive-b from 02:05Z to 05:15Z.

Unless a line says otherwise, "shared towns" means the 12 board, hive and placebo worlds. Isolated pools stay out, as in
townprojects D2.

## 0. Answers first

1. **Why C2 and the shadow mayor showed nothing:** mostly measurement and headroom. It was not a lack of allocation
   skill: the same gpt-oss:120b was optimal on 55 of 60 benchmark allocations.
   - The shadow mayor could not show a benefit by construction. It never acted, so its gate scored *prediction*: did
     the bot do the duty anyway. On self-maintenance duties every eligible bot is equivalent, and its own
     pre-registration expected about 1.0 for FREE_BAG and RESTORE_PICK.
   - C2 tested 8 newborn bots in a fresh world for 70 minutes. It used a value metric that was 56% cobblestone and
     only 3 blocks (it needed 20-28). There was nothing joint to coordinate.
   - Its directives also displaced the bots' own work: 40-57% were released after a failed step, and some went to
     dead sightings.
   - Since then, the real headroom, about 180 bot-h/day of full bags, has gone to deterministic per-bot fixes:
     town deposit, the junk well, plinth wells, withdraw and toolkit.
2. **What an assigner would help with today: almost nothing.** The coordination failures in the fleet data are small or
   are not coordination at all:
   - Redundant discovery: 91% of the "no copper" findings, 44% of the "empty furnace" checks and 89% of the
     "lid-blocked" counts repeat a townmate's finding. Together they cost **3.0 bot-h/day of 1,920 (0.16%)**.
   - Smelting is short of supply, not labour. 491 of 1,746 smelt_town runs stop on "no coal in town", because coal is
     never banked by policy. 951 find no copper at all.
   - Townmates carry iron or coal at those moments no more often than at random moments.
   - Gathering shows no measurable target contention.
   - The jobs are already spread across bots: the top bot's share of a town's successes has a median of 0.31-0.60.
   - **The problem an assigner exists for has not reached the fleet.** In 6 days there are no multi-bot project rows:
     nobody builds a shared structure, so two bots cannot duplicate a build and no project can wait for haulers. The
     same census sees 6,388 single-bot `build_well` rows.
   - **The labour is there.** About 230 bot-h/day of body time is the brain's idle choice: explore 94, gather 77 (dirt
     62), goto 45.
3. **Architecture (section 4):**
   - A host-side foreman per shared town, every 15 minutes plus events, on gpt-oss:120b on the Studio.
   - Its output is **role leases**, delivered as a fenced file, never in chat.
   - A lease only **reorders the deterministic town-job list** for the bot that holds it, and may add one deterministic
     `home` recall. It never names coordinates. It never pre-empts a ready rung or a reflex, and it never creates a
     mining role.
   - Fallback: leases expire on their TTL and the fixed rotation, which is the control behaviour, resumes.
4. **Measurement (section 5):**
   - The primary metric is witnessed project cells placed per active town-hour, read as a world-level DiD over 4 drawn
     towns for 72 h or more.
   - Exposure is town-hours in which assignment is possible.
   - **Positive control:** a Paper dose-response test that shows staffing moves the metric before any canary. C2 never
     established that allocation was binding.
5. **Recommendation, which both reviewers must agree on (section 8):**
   - **Do not revive the acting overseer yet.**
   - The first step is a deterministic, read-only **staffing census**. It needs no LLM and no bot code. It runs on the
     host and turns on with the first live multi-bot project (monument-01 or yard-01).
   - Then comes the Paper dose-response test. The LLM shadow and then a canary follow only if their gates pass
     (section 6).
   - What would make the overseer worth reviving now is in section 7.

## 1. Why C2 and the shadow mayor showed no benefit

### 1.1 The shadow mayor
Sources: the registered read of 10-06 (`/var/lib/mcai-mayor/score-decision-20261006.json`, 11,008 snapshots,
1,814,493 rows, 10-03 18:02Z to 10-06 03:18Z) and `shadow-mayor-plan-2026-10-03.md`.

| cause | evidence | kind |
|---|---|---|
| The gate measured prediction, not effect | Shadow only, no actuator. "Concordance" means the bot did the duty anyway within 30 min. The mayor's xbase against leased-random was 1.10/1.05 for FREE_BAG and 1.11/1.11 for RESTORE_PICK; the pre-registration (addendum, 18:41Z 10-03) predicted ~1.0 for both "by construction (no selection value)". | **measurement** |
| GET_IRON could not pass | Its shortage was unknown-bank, so it never entered the unforced gap (pre-registration) | measurement |
| The need was real, and it went elsewhere | The deterministic FREE_BAG gap was 429.6 unforced bot-h over 2.39 days (about 180/day). It was then taken by per-bot fixes: towndeposit, junk well, plinth wells, cobblecap. 24 of 80 bots still sit at 34 or more slots (STATE 10-18), but each bot can fix its own bag; no second bot is needed | **headroom moved** |
| Duties were self-maintenance | FREE_BAG, RESTORE_PICK, GET_WOOD and GET_IRON are each one bot's own problem. Choosing *which* bot adds nothing when every bot needs the same thing | **no coordination content** |

### 1.2 C2 (the closed loop, 10-07/08)
Source: `model-selection-2026-10-05.md`, "C2 readout".

| cause | evidence | kind |
|---|---|---|
| Underpowered | 3 blocks; paired-t with 2 degrees of freedom. The readout itself computes about 65% power at 20 blocks and 80% at 28 blocks for a 30% effect | **measurement** |
| The metric was not the goal | 56% of the control's output was cobblestone; the det and esc gaps were 69% and 75% cobble; iron-tier value was level. Cobble is junk now (cap 1000, the junk well throws it) | **measurement** |
| No joint task | A fresh world, 70 min, empty bags, no town, no stock, no project | **no headroom** |
| Orders displaced the bots' own work | Completed share: det 60%, ov 42%, esc 56%. Released after a failed step: 23, 44 and 26. Directives held a bot for 2.5-7.3% of bot time. det and esc were lower in every block | **inexecutable / displacement** |
| Orders aimed at dead sightings | Three ov GET_WOOD directives went to a stripped sighting (377,174). det block 2 had 8 such directives | **inexecutable** |
| Delivery was fragile | The chat-name pattern made the first smoke receive 0 of 15. The second smoke lost 7 of 18 while two directors with the same name flapped | channel (fixed before the series) |

Prior art agrees on the displacement. In MineCollab (arXiv 2504.17950), passing detailed plans in chat cost about 15%,
and success fell from 2 agents to 5 (`~/Documents/mcai-playground-notes/claude-prior-art.md`). VillagerAgent (arXiv
2406.05720) does help, but with a task DAG and a controller that assigns *ready* subtasks to agents by state. That is the
shape proposed in section 4, and it needs a task graph, which our fleet only gets with a project.

**Verdict on question 1:** reviving is worth it **only where there is joint work and a metric that counts it**. Neither
existed in C2 or in the mayor read, and neither exists on the fleet today.

## 2. What an assigner would help with now: the coordination census

Every count below gives its denominator. Every zero or "not special" carries the positive control it was read against.

### 2.1 Where bot time goes (the denominator for everything below)

| | bot-h / 24 h | share of 1,920 |
|---|---:|---:|
| body time inside the 27 skills listed (scripts: coord.py A) | 448 | 23% |
| of which the brain's idle choice (trigger `llm:idle`): explore 94.4, gather 77.4 (dirt 61.8), goto 44.9, mine 13.3, craft 2.1 | ~232 | 12% |
| of which town jobs (smelt_town, furnace_drain, count_town, town_deposit, withdraw_pick, toolkit, dispose_well, compost, wear_out, plinth/well, bamboo) | 15.8 | 0.82% |

- The llm stream holds 163,941 decisions in 24 h, and 151,102 of them (92%) are `idle` triggers.
- Dirt is 16,746 of the 26,403 gathers and 163 of the 190 gather bot-h. The bots hold a median of 7 dirt after a dirt
  gather. Its purpose (scaffold) is inferred, not established here.
- **Reading:** the free labour that a project could use exists, about 230 bot-h/day. Today's town jobs use less than 1%
  of bot time.

### 2.2 Candidate coordination failures

| # | candidate | measured (24 h, shared towns) | control | reading |
|---|---|---|---|---|
| C1 | **Duplicated discovery: "no raw copper"** | 865 of 951 (91.0%) repeat another bot's identical finding in the same town within the 2 h per-bot memory; 2.05 bot-h | the same pass finds 115 successes and 491 "no coal", so the parse sees other classes | real, cheap. A **town-shared miss memory** removes it deterministically |
| C2 | **Duplicated check: the same empty furnace** | 339 of 773 (43.9%) within 60 min of another bot; 0.82 bot-h | the parse finds 449 failed and 107 aborted drains | real, cheap; same fix |
| C3 | **Duplicated lid-blocked counts** | 628 of 704 (89.2%) within 60 min; 0.11 bot-h. 704 of 822 shared-town count_town rows are lid-blocked | 470 count_town rows did count | the bigger fact: **the town stock journal is blind in many towns**. Of 12,673 refused entries, 8,687 (69%) are `*_unknown`. That is the foreman's main input; see 4.6 |
| C4 | **Smelting waits on fuel** | 491 of 1,746 smelt_town runs (28%): "no coal in the town containers" (board-b 160, board-c 154, board-a 64). A townmate carried 8 or more coal at 53 of the 490 shared-town moments (10.8%) | the same test at 2,000 random moments: 7.7% | **supply/policy, not distribution.** Coal is never town-banked (towndeposit IRON_LADDER), so the town has none, and bags have little to share. A deterministic coal-banking rule is the remedy |
| C5 | **Smelting waits on copper** | 951 "no raw copper" against 115 successes (101 batches). Successes per world: hive-b 32, board-c 17, hive-c 16, every other world 10 or fewer | 1,646 copper smelted in the 12 h after smeltjob-01's promotion (STATE 10-17) | **the backlog is mostly gone**; copper is now mined at about 28/world/day (townprojects 5). Not labour-bound |
| C6 | **Skips for want of room** | `_smelt_job_skip` 2,113: room 1,267 (60%), town_has_none 537, nothing_to_drain 309 | — | the one place where *which bot* matters: a full-bagged bot meets the job. Small today because supply is the limit (C4, C5) |
| C7 | **Iron held by one bot, needed by another** | 258 toolkit `no_iron` refusals; a townmate carried 3 or more ingots at 200 of them (77.5%) | random moments: 78.2% | **not special.** Iron lives in bags by policy, at all times. A banking rule, not an assigner |
| C8 | **Target contention while gathering** | gather rows cannot name a competitor (0 of 15,791 failures do), so that instrument is **blind**. Spatial test instead: a gather is "contested" if a townmate's gather of the same block ended within R blocks in the previous W seconds. Contested gathers succeed **more** often: R8/60 s 55.9% vs 40.4%; R32/300 s 57.1% vs 37.1% (17.7% contested) | the machinery finds 3,574 contested cases, so it can see co-location | **no harm detectable**; co-location marks good spots |
| C9 | **Jobs pile onto one bot or starve** | top-bot share of a town's successes (towns with 5 or more): smelt_town median 0.60 (0.34-1.00), town_deposit 0.44, withdraw_pick 0.38, toolkit 0.31, dispose_well 0.44, compost 0.43; median distinct bots 4-5 of 5 | — | spread already. A preference of 0.60 for smelting is not a failure |
| C10 | **Two bots duplicate a build; a project waits for haulers; bots idle while it waits** | **not observable: no multi-bot project ran on the fleet in 6 days** (8.64M docs; the kinds matching project, ziggurat, monument, shaft, yard, storehouse or hall: 0) | the same census sees `build_well` 6,388, `_plinth_step` 811, `build_plinth` 96, `_well_built` 15. The 11 `build` rows are single-bot brain "pillar" plans, 0 blocks placed in all 11 | **the assigner's real job does not exist yet.** monument-01 (ziggurat), shaft-01 and yard-01 are queued or held |

Also found, operationally: **`mcai-mayor-shadow` has been DOWN since 10-13 21:23:49Z.** It reached its own 1 GiB output
cap (exit 6, which by design stays down). The memory note "keeps recording snapshots" is false for the last 5.6 days.
This design does not need it (section 4.6), so nothing was restarted.

**Verdict on question 2:** today there is no coordination failure worth a model.
- C1-C3 are a deterministic shared memory, worth about 3 bot-h/day.
- C3's blind stock journal, C4 and C7 are deterministic policy (lids, coal banking, iron banking).
- The job worth assigning appears with the first multi-bot project. That project will have parallel cells, a bill of
  materials and parts chains (townprojects 5 and 12), and about 230 bot-h/day of idle labour to draw on.

## 3. What the foreman is for, once a project is live

The levers, in the order of their likely value:
1. **Recall:** bring an idle bot home to staff a stalled project. Only 48.5% of bot time is within 48 blocks of home
   (townprojects 1.3), and every town job is at-town only.
2. **Supply:** point a free bot's next deterministic supply job at the project's short bill-of-materials item. Without
   it, the idle brain picks dirt (61.8 bot-h/day).
3. **Selection:** give the job to a bot that has room, tools and parts. The C6 class.
4. **Ordering projects and variants** within a town. That is the strategist's input later.

The mayor read says lever 3 alone is about random for self-maintenance. Levers 1 and 2 are where a planner that sees the
whole town and the bill of materials can beat each bot's local rule. This is the bet, and section 5 tests it.

## 4. Architecture

### 4.1 Placement and cadence
- **Host-side service** on 10.0.0.31, the `mcai-foreman` unit, with the same limits as the mayor unit (Nice 10,
  MemoryMax 512M, CPUQuota 25%). It runs one tick per shared town every 5 min, deterministically.
- **The model call** is gpt-oss:120b at reasoning medium. It runs at most every **15 min** per town, plus on events: a
  project stalled for 10 min or more, a project's state changed, or a lease was refused. It debounces to at most one
  call per town per 5 min.
- In shadow it covers every shared town. In the canary it covers only the drawn towns (4 towns, about 16 calls/h).

### 4.2 Inputs, one immutable snapshot per tick, written before the call
- **Town stock:** a fold of `town-chest-*.cobble.jsonl` `cnt` records per container. Each item is labelled `known`,
  `unknown(lid_blocked)` or `stale(>2 h)`. Unknown is never zero (lesson C3).
- **The project record and queue:** open cells, placeable now or not; the bill of materials short net of reservations;
  part chains; leases and reservations (project, furnace, line, siting).
- **The bot roster:** the latest row per bot (pos, distance to home, estimated slots, tools and uses, current skill and
  order, `_entombed`/`_marooned`/drowning/low-health flags in the last 5 min, refusal rows by job).
- **Brain-01 status:** which bots are on gemma (a stratum, not a lever).

### 4.3 Outputs: role leases
- The output is strict JSON, validated against a schema:
  `{town, gen, leases: [{bot, role, target?, ttl_min ≤ 30, reason, evidence: [ids]}], unstaffed: [...], abstain?}`.
- **Roles (v1):**
  - `BUILD(project)`: prefer the `build` job;
  - `SUPPLY(item)`: prefer the deterministic withdraw, craft or gather job whose *own* eligibility already names that
    item for the project;
  - `SMELT` / `PARTS`: prefer the furnace and make_part jobs;
  - `RECALL`: the existing deterministic `home` skill, once per lease, only from the surface and only when not
    trapped;
  - `FREE`: the brain decides, as today.
- **v1 does not create MINE roles.** junkwell-01's revert showed that sending bots back to mining sends them into the
  fleet's standing sealed-pocket and lava deaths (owner 10-07, "exposure deaths").
- **What a lease does in the bot:**
  - It changes the *order* in which the existing deterministic town-job list is evaluated for that bot. It replaces
    townprojects 6's fixed letter rotation for the bot that holds it.
  - Every job still runs through its own pure `xOrder(readings)` eligibility and admission. The milestone's ready rung
    still wins. Reflexes are untouched.
  - **A lease can only make a bot do sooner what a deterministic job would let it do anyway.** It never names a
    coordinate and never creates a skill call.
  - The bot-side change is one reader plus one sort key, inside the `if (!order)` chain.

### 4.4 The deterministic validator (host side, before the file is written)
- Schema-valid; ids known; the lease generation is monotone.
- Caps:
  - at most one BUILD per project (the project lease stays the real fence);
  - at most 2 SUPPLY per item;
  - at most 3 of 5 bots leased per town;
  - at least 1 FREE bot always.
- **Executable from here** (CLAUDE.md, refusal remedies):
  - The role's job must be eligible for that bot now, or become eligible after a RECALL whose path class the roster
    shows is open (the bot is not entombed, marooned, underwater or below y 50, and is within 128 blocks).
  - Anything else is rejected as `inexecutable` and logged. That counts against the model, not the bot.
- **Safety:**
  - no lease for a bot with a trap or drowning flag in the last 5 min, or with health ≤ 10;
  - no RECALL that crosses a recorded death site (the `_death_site_recorded` set);
  - no lease that would keep a bot from its ready rung (rung state is read from the roster).
- An abstain or an invalid answer writes no leases. That is a tick of the control behaviour, and it is logged.

### 4.5 Delivery and the refusal chain
- **Delivery:**
  - The leases are written atomically to `/var/lib/mcai/_pool-<pool>/roles-<home>.json` (`gen`, `issued_at`,
    per-lease `expires_at`). Bots already read their pool's state directory, as with the furnace leases.
  - Not chat: C2's delivery failed twice on the mineflayer chat path.
  - The bot honours a lease only while `now < expires_at` and `gen` is the newest it has seen.
- **The refusal chain, tested as a chain rather than a single guard:**
  - A refused, failed or skipped role job **drops the lease for that bot** (with a `_role_released` row), costs the
    job's normal cooldown, and returns the bot to FREE.
  - The next foreman tick sees the release. A released bot cannot be re-leased to the same role for 30 min.
  - So a lease can never hold a bot in a loop or a dead end. The worst case is today's behaviour.

### 4.6 The fallback when the model or the Studio is down
- If no valid answer arrives within 120 s, or the Studio is unreachable, the tick writes nothing.
- Leases expire on their TTL (at most 30 min). Bots run the deterministic rotation, which is exactly the control arm.
- A down period is therefore **lost exposure, not harm**. The read counts it, and the canary extends instead of judging
  it.
- The foreman does not depend on the mayor recorder, which is down (section 2). It folds its own snapshot from the
  journals and the bot rows.

### 4.7 Cost, compute and Studio contention with brain-01
- **Money:** nothing beyond electricity. It is local, and no API key is needed. The frontier strategist stays later and
  owner-keyed.
- **Memory:** gemma4 8-bit (28 GB, loaded now, idle) plus gpt-oss:120b on Ollama was about 93 GB co-resident with no
  swap (10-06 re-test on the cleared Studio, 128 GB).
- **Load:** 16 calls/h at about 30-60 s each is 8-16 GPU-min/h in the canary; 48 calls/h in a fleet-wide shadow.
- **Measured interference** (C2, the same pair): while gpt-oss was being called, the brain's p50 rose 0.07-0.24 s and
  its p95 about 1 s. brain-01's capacity is 10 bots at p95 6.8 s, inside a 15 s budget.
- **Rules:**
  - (a) The brain has priority. The foreman skips a tick whenever brain-01's proxy p95 over the last 5 min exceeds
    10 s, or a `GPU_RESERVED` other than `brain01-live` is held.
  - (b) It honours `~/brain01/PAUSE`, which coordinates with andy-eval.
  - (c) The shadow runs at a 30-min cadence while brain-01 is live.
  - (d) The foreman canary is never drawn in brain-01's pools, so the two levers are not confounded.

### 4.8 How it composes with the rest
- **brain-01** keeps deciding FREE time. The foreman only claims time for deterministic project jobs, and the stratum
  is recorded.
- **townprojects** leases (project, furnace, line, siting) stay the fences. The foreman cannot hand out what a lease
  holds.
- **The strategist (later)** reads the foreman's daily town reports and sets project order. The foreman never edits
  blueprints.

## 5. Measurement: pre-registered, and built not to repeat C2

| item | C2 | the foreman |
|---|---|---|
| world | fresh, empty, 70 min | the fleet's own towns with stock, 72 h or more |
| what is counted | resource value, 56% cobble | **project cells placed and witnessed by the server, per active town-hour** (RCON-verified at the end) |
| unit and power | 3 sandbox blocks | world-level DiD over 4 drawn towns against 8 control towns. A pre-period null gives the SD, and the duration is computed from it **before launch** |
| dose | directives sent | leases **honoured**, from the bot-side rows (`_role_honoured` / `_role_released`) |
| displacement | unmeasured until after | gather and rung completions per bot-h DiD, inside the null band (a harm gate) |
| headroom proven first | no | **the staffing census plus the dose-response positive control** (below) |

**Arms:**
- A is today's deterministic rotation: every control town, and canary towns in the pre-period.
- B is the foreman's leases in the 4 drawn towns.
- The towns are drawn arbitrarily (CLAUDE.md), with brain-01 pools excluded, from the towns where the project is live.

**Primary (the decision):** the difference-in-differences of witnessed project cells per active town-hour.
- "Active" means a project is open and has at least one placeable cell.
- **KEEP** needs the lower bound above +15% and the harm gates clean.
- **REVERT** needs the upper bound below 0, or any harm gate tripped.
- Otherwise INCONCLUSIVE at the deadline.

**Secondary:**
- stall-hours: a project is open, a part is short, and no bot holds a role on it;
- latency from a part shortage to the part delivered;
- recall success;
- lease executability (at least 80% honoured, or the model is the problem);
- validator-clean rate (at least 98%);
- brain p95 delta (at most +2 s).

**Harm gates:**
- deaths: the two-death floor and 1.25x the control rate;
- immobile and stuck DiD within the null;
- gather and rung completions DiD within the null;
- no lease to a flagged bot (a deterministic defect means REVERT).

**Exposure:** at least 60 canary town-hours that are *assignable*. A town-hour is assignable when a project is active,
2 or more bots are at town or recallable, and a role would change something (a short part, or no builder).
- An unexposed canary closes INCONCLUSIVE early (owner 10-15 rule).

**Positive control, required before any canary:** a Paper dose-response on sandbox4.
- Setup: 5 real bots, a yard-01 project and a seeded stock. Three arms, each run 3 times:
  - rotation;
  - **starved**: no BUILD for 30 min;
  - **ideal staffing**: a scripted oracle with leases.
- If *starved* does not lower cells/hour against rotation, staffing is not the binding constraint, and the foreman
  cannot show anything. Stop and record INCONCLUSIVE-by-design.
- If *ideal* does not beat rotation, the headroom is below what the canary can detect. Stop.
- The foreman's LLM arm is not needed for this control. It decides whether an allocator can matter **before** paying for
  one.

**Analysis:** the read script is written and its self-test passes (failing fixtures for every gate) **before** the
pre-period starts. The 15% threshold and the duration are fixed in the registration, with no change after the first
read.

## 6. Smallest first step, then gates

| step | what | needs | gate to the next |
|---|---|---|---|
| **S0 (now, about 1-2 days)** | **The staffing census, deterministic and read-only on the host.** Every 5 min per shared town it records: projects active or open, short BOM items, bots at town or recallable, what each does, and assignable town-minutes. It also folds stock and labels unknown. **No LLM, no bot code, no canary slot.** It reports "nothing to assign" until a project goes live, which is itself the C10 positive control on the instrument | the journals and ES rows that exist | first live multi-bot project (monument-01 or yard-01) KEPT; then the census shows **≥ 20 assignable town-hours/day across the shared towns** for 48 h (the mayor plan's unforced-gap shape) |
| S1 | Paper dose-response (section 5) | yard-01's builder on sandbox4 | *starved* lower and *ideal* higher than rotation, each in 3 of 3 pairs |
| S2 | **Foreman in shadow for 72 h:** the LLM proposes leases on the census snapshots; nothing is delivered | gpt-oss on the Studio, the validator | at least 98% validator-clean; at least 80% executable at issue (re-checked at +5 min); brain p95 delta at most +2 s; stall-naming recall at least 0.6 against the census's own stalls; both engines review the bot-side reader |
| S3 | **Canary, 4 towns** (the bag-fix-style 4-pool draw, never widened mid-run) | bot-side lease reader (one sort key), its chain tests, Paper | section 5 KEEP / REVERT / INCONCLUSIVE |

The cheap fixes the census found are deterministic and separate from the foreman. Each is its own small canary or
setting change, and each needs owner approval:
- a town-shared miss memory (C1-C3);
- coal banking (C4);
- the lid-blocked counts (C3), with lidclear for dirt lids.

## 7. If not now, what would change the answer
- **A live multi-bot project with a measured stall budget.** If yard-01 or monument-01 runs and the census shows at
  least 20 assignable town-hours/day, the foreman has a job. This is the expected path.
- **Fewer, smarter bots (owner 10-05: 4-8 bots).** With one town of 4-8 gemma bots on long projects, assignment becomes
  the main lever, and the canary can be that world's whole population, against a twin.
- **Evidence that the brain's idle choices waste labour a project could use.** That would be the census's
  idle-while-assignable minutes, which today read 0 only because no project exists.
- **What would NOT change it:** a better model on the old self-maintenance duties. The read already says they have no
  selection value.

## 8. Reviews

Both engines must agree on (a) whether to proceed and (b) the first step. Their verdicts are recorded below exactly as
given.

(pending)

## 9. Owner decisions needed
1. **Accept "not yet, as an actor."** Build S0, the census, now. Gate the LLM foreman on a live multi-bot project and
   the dose-response test. Or override and ask for S2 shadow at once on today's jobs (expected to repeat the mayor).
2. **Which project goes first:** monument-01 (ziggurat; held behind minewell, needs a re-hold decision) or yard-01
   (townprojects stage 3; not built yet). The foreman's first possible job depends on it.
3. **The foreman canary draws 4 pools** (bag-fix style), because one town is a demonstration only.
4. **Studio priority:** brain-01 first, the foreman skips under load, 30-min shadow cadence while brain-01 is live.
5. **The mayor-shadow recorder** has been down since 10-13 (output cap). Archive it and leave it stopped (recommended),
   or restart it.
6. **The deterministic fixes the census found** (shared miss memory, coal banking, lid-blocked counts): queue them or
   not.
