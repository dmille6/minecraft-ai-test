# Return home reliably, then surface expeditions (2026-10-27, design only, r5)

OWNER 10-27 approved designing two pieces, in this order: **(1) return home reliably** (survival lane), then **(2) surface
expeditions** up to 1,200 blocks (progress lane). OWNER 10-27, later: build **virtual breadcrumbs (a) AND physical
markers (b) together, as one return system**. Waypoints are the primary return path, and markers are the backup that a
bot without its waypoints, or another bot, can follow. "I'm not worried about speed as much as making things work."

This is a design. It changes no code, deploys nothing and touches no world. It builds on
`expansion-plan-2026-10-19.md` §6 (expedition-01, r7, approved by both engines; the owner's X1-X10 answers) and does not
repeat it. Where this document and §6 differ, this one is the newer and is meant to win. The evidence scripts are in
`scripts/host/expeditions1027/` and ran read-only on 10.0.0.31 against the frontier census's hour files
(`~/frontiercensus/out/hours`, folded from ES) and `scripts/lib/estelemetry.py`.

**Window.** 10-20 00Z .. 10-27 00Z, 168 hourly census files, 0 VOID. The 13 census towns are the 12 board, hive and
placebo worlds plus isolated-b, which has been shared since 10-21. homefix-02 went fleet-wide on 10-22 00:28Z, so about two
days of the window ran on homefix-free code. The far-row table below is mostly after 10-22: 117 of 141 rows.

---

## 0. Answers first

1. **The census label does not say what it seems to say.** "home by start band 200-300 3/27" counts **calls to the
   `home` skill** whose single run returned `success`. It does not count trips that made it home.
   - **Start position.** The start is a proxy: the END position of the same bot's previous row within 15 min
     (`fold_events`, `prev_pos`). 188 of 554 rows on 10-26 had no such row and are "start_unknown".
   - **Rows interrupted by a reflex.** These have their trigger overwritten to `interrupt:<reason>` (runner.mjs), so
     `interrupt:* 0/230` is **0 by construction**. It is not evidence that interrupts never get home.
   - **Repeat calls.** One bot that calls `home` ten times and arrives on the eleventh counts as 1 success in 11.
2. **At the trip level, far bots mostly do get home. They are slow, and some come home by dying.** I reconstructed
   excursions from the census's hourly per-bot position samples: 80 bots, 13,435 samples. An excursion starts at a sample
   ≥ 200 blocks from home and ends at the first sample < 48.
   - **Outcomes.** 134 excursions: 130 closed (120 with no death in between, 89.6% of the 134; 10 after a death, the
     bot coming home by respawning) and 4 still out at window end.
   - **Read the labels honestly (Claude r1 P2-6, Codex r1 P2-6).** A respawn followed by walking back out inside the
     hour scores "no death", so death-closures are a LOWER bound. Excursions already out at the window start are
     left-censored (placebo-c-Bravo's began before 10-20). Coverage gaps are bridged, not cut. C0 replaces this.
   - **Time to get back.** Median 2 h (200-300 band) and 3 h (300+); p90 6 h and 11 h. Hourly resolution, so ±1 h.
   - **Denominator.** "Came back by walking" includes every means: `home`, the watchdog, deposit walks, explore.
3. **Far `home` calls come mostly from below the town, not from long surface walks.** 141 rows started ≥ 200 out, from
   38 bots. 125 of them (89%) started **deep**, more than 8 below home.y; the median start was 35 below.
   - **Two caveats (Claude r1 P2-3).** "Deep" is relative to home.y, not proof of being underground: a valley 9 below a
     hill town counts. And the rows are row-weighted: two chronic bots are 56 of the 141. Without them there are 85 rows
     from 36 bots with 22 successes, and the deep share is ≈ 81% if the chronic rows are all deep (both sat at or below
     y = 61). C0 adds a sky-light test so the split is measured, not inferred.
   - **Surface starts:** 8 of 16 succeeded, and 8 of the 15 that were not interrupted.
   - **Deep starts:** 14 of 125 succeeded, and 14 of the 64 not interrupted.
   - **The same split in the 100-200 band:** surface 45/110, deep 51/315.
   - **Positive control:** the same reader finds 1,474 rows and 533 successes in 0-100. The instrument does see
     successes.
4. **Three failure modes carry the far, deep failures. Each is a named code path.**
   - **F1 — a remedy that never ran under the right conditions, printed for days.** placebo-c-Bravo printed `failed / stranded`
     "a direct shaft climb stopped: **dig failed on stone by hand**" 41 times between 10-20 and 10-27, at 559,37,219,
     26 blocks below sea level.
     - On 10-23 and again on 10-24 its tools were a stone shovel, a stone axe and two swords. It had **no pickaxe, no
       cobble, no logs or planks**, and 26 sticks.
     - It left on **10-27 20:40:55Z by drowning**, with the air pocket refused because water was beside the roof cell. It
       respawned at town and banked its bag. **Its return took about 8 days and a death.**
     - board-d-Alpha printed the same chain with "no scaffold blocks left" six times (555,61,116).
     - **Between them, these two bots are 56 of the 141 far rows.**
     - **What actually stopped it (r2, read from the `why` suffix after Claude r1 P1-1 and Codex r1 P1-1).** Over
       10-20..10-27 its `surface` rows stopped 786 times: 595 on "dig failed on stone by hand: **dig exceeded
       ≈ 120 000 ms**" and 188 on "Digging aborted".
     - **Hand-digging stone is legal and allowed by the code** (skills.mjs ~16068, digbudget.mjs ~72). Dry and standing,
       stone takes ≈ 7.5 s by hand. Running past 120 s fits vanilla's dig-speed penalties, ×5 with the head in water and
       ×5 when not on the ground (7.5 s → ≈ 187 s), and the bot drowned in that same cell with water beside its roof. The
       penalty is an inference; P-H3 checks it.
     - **So a remedy existed: hand-dig a staircase.** It failed for want of dry footing. Meanwhile the printed text told
       the bot to "gather wood, craft a pickaxe", which it could not do at y = 37.
     - **A third bot has the same shape:** board-a-Comet, 645 `surface` rows from 359,40,188 (inside 100, so not in the
       far table), "dig failed on copper_ore by hand: dig exceeded 114 955 ms".
     - **board-d-Alpha's "no scaffold blocks left"** is the pillar branch, and a hand-dug staircase needs no blocks.
     - This is CLAUDE.md's "advice printed is not advice taken" case. The instruction printed was wrong, and the right
       remedy never ran under the conditions that make it work.
   - **F2 — a deep, far start burns its budget in path planning and never climbs.** There are 14 deep and 6 surface far
     rows of `unknown / path_budget` saying "ran out of the 25s travel budget toward … **after 0 leg(s)**". In the
     100-200 band there are 49.
     - The cause is in `home` (skills.mjs ~2861): the climb-first repair runs only when `failClass` is `stranded` or
       `no_path`, or is `wrong_elevation` below home. **`path_budget` and `path_timeout` are not in that set.**
     - So a deep bot whose goto spends its 25 s planning never `surface`s. After two no-progress rounds it breaks out
       and returns `path_budget`. The watchdog then calls `home` again, and the same thing happens: board-b-Bravo did it
       4 times in 50 min on 10-23; placebo-d-Bravo 5 times.
   - **F3 — reflex interruptions while underground.** 61 of 125 deep far rows were `aborted / interrupted`: entombed 36,
     stuck 13, stagnation 12. These are the reflexes doing their job in a tunnel, and the return restarts afterwards. Whether
     they cost lives is not measured here (Codex r1 P2-6); C0 counts deaths inside excursions.
5. **Surface far returns work when they get to walk.** "closed 270 blocks toward home, 3 still to go" (hive-b-Alpha);
   "closed 218 … 13 to go" (placebo-d-Echo). Two remaining rows are surface path_budget and no_path "after 0 legs" on a
   surface start, and goto's waypoint legs make each hop short. Breadcrumbs do not address F1-F3; they address the trip
   an expedition creates. That is why the design builds them, and why they are not sold as a fix for today's far
   failures (§3.6).
6. **Deaths beyond 200 blocks: 14 of 203 deaths in the census towns.** By cause: fall 8, drowning 3, other 2, fire 1.
   Falls dominate, as on 10-19.
7. **Recommended order, one variable per canary.** The lane alternates progress and survival (OWNER 10-25):
   - **S: `homeward-01`.** F2 only: `path_budget` / `path_timeout` underground trigger home's existing climb. A
     two-clause fix, split from F1 in r2 (both reviewers).
   - **P: `trail-01`.** Virtual breadcrumbs for every bot leaving town, with `home` following them back. Tier 3.
   - **S: `stranded-01`.** F1: footing first, then a hand-dug staircase, and a `contained` state the watchdog honours.
     Tier 3.
   - **P: `markers-01`.** Physical markers along the trail, and marker-following when the waypoints are gone. Tier 3,
     deterministic gates, showcase first. A survival item from the S queue runs between this and the next entry.
   - **P: `expedition-01`.** The 10-19 §6 errand, re-based on the KEPT trail and markers, with the ring raised to 1,200.
   - **Cleared paths and roads (c)** are a later town project, after outposts. Rails stay undecided (X6/X7).

---

## 1. What the numbers mean (the census's own definitions, read from its code)

`~/frontiercensus/scripts/host/frontiercensus.py` (installed sha 173163bc):

| label | what it counts | what it does not |
|---|---|---|
| `home by start band` | `home` skill rows in the census towns, keyed by the band of the PREVIOUS row's end position (≤ 15 min earlier), counting `status == 'success'` | trips; returns made by any other skill; the 34% of rows whose start is unknown |
| `home by trigger` | the same rows by `trigger_class(trigger)` | the trigger a reflex-interrupted run started with (it is overwritten), so `interrupt:*` cannot have a success |
| band `deaths` | `_death` rows by end position | whether the death happened on a return |

**The quantity the owner is asking about** is "a bot that is out gets back home, alive, in reasonable time". That is a
property of the trip, so this design measures trips: the excursion, defined in §2.1 C0, not the call.

## 2. Return home reliably (survival lane)

### 2.1 C0 — the return census (host-side, no slot, built first)

A trip-level instrument added to the frontier census. It is a new section in the daily text and a new block in the
baselines, so no bot reads it and it needs no slot.

- **Excursion.** It opens when a bot's newest-per-minute position (the census presence fold already computes this) is
  ≥ 100 blocks from home. It closes at the first position for which the ONE arrival predicate holds: `atHome(pos, home)`, a circle of 16
  horizontal and |dy| ≤ 12, the town_deposit predicate (towndeposit.mjs ~97). It is not `inTownBox`, which is square and
  has no upper y bound (townground.mjs ~40; Codex r1 P1-4). The trail reset (§3.2) uses the same predicate.
- **Censoring.** An excursion already open at the window start is left-censored and reported apart. A coverage gap of
  more than 10 min censors the excursion.
- **Excursion fields.**
  - Peak distance band. Depth at its peak, three ways: dy < −8, below SEA_LEVEL, and sky light 0 at the head cell when
    perception logs it.
  - Minutes out, and minutes from its **first return intent** (the first `home` row or `watchdog_home` trigger) to close.
  - How it closed: `walked`, `death` (a `_death` row inside it), or `censored` (still open at the window end, or at a
    gap in coverage).
- **Minute resolution, not hourly.** §0's hourly reconstruction is ±1 h and misses short trips.
- **Primary quantity: return-reliability.** Of excursions with a return intent, the share that closed `walked` within
  **60 min of the intent**. The denominator is excursions with an intent, by band and by depth.
- **Mature cohorts only (r3, Codex r2 P2-6).** An intent counts only if the 60 minutes that follow it lie inside the read
  window and are covered: no coverage gap over 10 min. Intents without that follow-up are counted apart as
  `immature` / `uncovered`. The same rule applies to every arm, period and pre-period. Tested on late-window intents and
  on unequal coverage between arms.
- **Secondary quantities.**
  - **Per-intent `home` success**, so that the primary cannot be credited by deposit walks, explore or relocations
    alone (Claude r1 P2-7).
  - The share that closed by `death`.
  - Excursions open for more than 6 h. This is the placebo-c-Bravo shape, and it is paged on the fleetstatus header.
  - The count of `_stranded_remedy` rows (§2.2).
- **Positive controls.**
  - **Hand-labelled excursions.** 20 excursions, drawn at random and labelled by hand from their rows, must match the
    reader's labels 20 of 20.
  - **The hourly definition.** Re-run separately as `--hourly`, it reproduces §0's 134 = 120 + 10 + 4 exactly.
  - On a window from 10-20 to 10-28 it must find placebo-c-Bravo's excursion as left-censored, open more than 6 h, and
    closed by `death` at 10-27 20:40:55Z.
  - Every closed excursion must have a later position inside the town zone. A zero on any of these makes the
    instrument VOID.
- **Why first.** It gives `homeward-01`, `trail-01` and `expedition-01` the same denominator, from before any of them
  ships. Codex and Claude both said in 10-19 that the instrument comes before the change, and E0 is the precedent.

### 2.2 `homeward-01` (S lane, tier 3): F2 only

**The change.** In `home`'s `stuck` set (skills.mjs ~2861-2862), `path_budget` and `path_timeout` count as stuck **only
when the bot is underground**: below SEA_LEVEL AND with sky light 0 at the head cell. Elsewhere they mean what they mean
today.
- **Pure function.** `homeStuck({ failClass, y, homeY, skyLight })` is exported and behaviour-tested. The repair it
  enables, the one `surface` with `{ until: deadline }`, is unchanged.
- **r1 also proposed an unconditional `climb_first`; it is dropped (Claude r1 P2-4).** Nothing measured it, and deep
  100-200 starts succeed 51 of 315 by walking today.
- **Tests, each killed by a mutant that removes the clause:**
  - a sky-light-0 start at y = 30, 220 out, whose goto returns `path_budget` after 0 legs, calls `surface` before
    `home` breaks;
  - the same goto at the surface does not;
  - neither does a surface basin below sea level with sky light above 0, the false-deep case.

**Read.** It could be tier 2: a small fix with Paper evidence (gate v36). It registers tier 3 if it cannot draw 4 pools
(OWNER 10-23).
- **Primary.** C0's per-intent `home` success for underground starts ≥ 100, DiD. C0's return-reliability is reported
  alongside.
- **Correctness gate G-F2.** An arm `home` whose goto returned `path_budget` or `path_timeout` with sky light 0 below sea
  level, and that did not `surface` before returning, is a defect. The gate is 0 defects in D = 10.
  - **Positive control.** The same reader finds the defect on the pre-period, among the **deep** rows only (Codex r1
    P2-8: r1 counted 6 surface rows too). The 7-day count is 14 deep rows at ≥ 200, plus the deep share of 49 in
    100-200, re-measured.
- **Guards.** Deaths, on the two-death floor and > 1.25x. Deaths within 120 s of a `surface` that the clause started.
  Climbflood: the `surface` must not breach water (P-H5).
- **Kill switch.** `HOMEWARD=0`.

### 2.2b `stranded-01` (S lane, tier 3): F1

**Goal.** Keep the existing escape chain (Codex r1 P1-1). Classify WHY it stopped, run the remedy that clears that
reason, and declare `contained` only for reasons that cannot clear. The decision is one exported pure function,
`strandedRemedy({ stop, inventory, tools, feet, head })`, which maps `surface`'s `stopped` text to a class and returns
the next rung.

| stop class (from `surface`'s `stopped` / `why`) | measured | remedy (deterministic, inside `surface`; never advice) |
|---|---|---|
| `hand_dig_slow`: "dig failed on X by hand: dig exceeded …" with the feet or head in water, or not on the ground | placebo-c-Bravo 595 (+ 188 aborted), board-a-Comet 645 | **Footing first**, chosen by the pure `footingPlan(cells, bag)`. (1) Step to an adjacent dry, standable cell. (2) Or place one held block under the feet: a jump-and-place under the pillar branch's body ownership (`haltPath`, as `shaftAscend`). (3) Or, ONLY if the head cell is air (a submerged bot has ≈ 15 s of air, so a ≈ 187 s wet dig is impossible), hand-dig a water-free neighbour in ONE uninterrupted dig. This is a separately registered skill, `stranded_dig`, issued by the stranded order as its own runner run, not as a step inside `surface` (Codex r3 P2-2). Its registry entry carries a 300 s timeout, so the runner's deadline and hard stop are 300 s + grace for that skill alone. The climb claim is renewed every 30 s while the dig runs (runner.mjs ~130, ~339-343), and the claim's absolute ceiling (today the default timeout + grace, runner.mjs ~134, ~186) is computed from the RUN's effective deadline, not the default (Codex r4 P2-2). The test runs a dig past the default timeout + grace, with entombment active. The emergency reflexes (air, drowning, lava) can still interrupt it. It is tested through the real runner and the real entombment reflex with a dig longer than 180 s. A partial dig is not carried across calls, because a timeout calls `stopDigging` (skills.mjs ~16075, mineflayer digging.js ~165; Codex r2 P1-1). (4) None of these → **`no_footing`**, a legal `contained` reason. Once footed: hand-dig a **staircase**, not a shaft (no blocks needed), one block per dig, each well under 180 s when dry. |
| `dig_aborted`: "Digging aborted" | 188 | The body was taken (air reflex). Retry after the reflex releases it, at most 3 per 10 min; then treat as `hand_dig_slow`. |
| `no_scaffold`: "no scaffold blocks left" | 6 | Hand-dig staircase with the current tool, or by hand if none. No blocks needed. |
| `undiggable`: "cannot break X …" (obsidian, bedrock, protected, `digbudget` refusal) | not measured here | Try the other three bearings of the staircase. If all four are refused, **`contained`**. |
| a pickaxe is held but the climb refused for some other reason | — | Today's chain, unchanged. |

**Crafting is dropped as a rung in r2.** It is not executable as written. A sealed 1x2 pocket has no legal table cell,
`craftroom` models room and `no_room` (craftroom.mjs ~96), and the material counts were wrong: a wooden pickaxe from logs
alone needs 2 logs (Claude r1 P2-8, Codex r1 P1-2). A hand staircase covers every bag, including placebo-c-Bravo's
26 sticks, so a craft adds a failure mode for no new reach. It can return later as an optimisation, with its own Paper
scenes.

**The printed text** names the rung that is running, for example "climbing out by a hand-dug staircase; 7 of 26 steps".
It never says "gather wood" underground.

**Contained reasons (r3).** `undiggable` on every legal bearing (stair and pillar both refused, for any cause: block
hardness, protected cells including protected placement neighbours per protectzone.mjs ~132, or no tread), and
`no_footing` (footingPlan step 4). Holding a pickaxe does not exclude `contained` (Codex r2 P2-4). The selection is the
pure `containedReason(attempts)`, which needs every legal action to have been attempted and refused, with its class.

**`contained`: the watchdog and reflex contract (Claude r1 P1-2, Codex r1 P2-5, Codex r2 P2-5).** r1 left this unwired. Three independent
re-issuers would ignore it:
- the watchdog's stranded-underground `surface` (watchdog.mjs ~311-313);
- stagnation level 1 relocate and level 2 `home` (~565-600);
- level 3's `surface` / `mine` fallback (~742-753).

The contract:
1. **Where it lives.** `bot.contained = { since, reason, rearmKey }`, persisted in the stranded state file so it
   survives a restart. `rearmKey` hashes the held tools and placeable-block counts.
2. **What it suppresses.** One exported pure function, `containedMaySuppress(caller, contained, now)`, gates each
   re-issuer: the watchdog's levels, its stranded `surface`, AND the entombed and stuck reflexes' recovery climbs
   (reflex.mjs ~3232 `escapeStairUp`). While contained, levels 1-3 and the stranded `surface` are suppressed except for **one attempt per hour**:
   a full `strandedRemedy` re-check. Level 3's reconnect (`bot.quit`) still runs once per 6 h, because a reconnect can
   clear client-side ghost blocks.
3. **What re-arms it.** `containedRearm(prev, now)`. It re-arms on **resource change**: a new tool, or placeable blocks
   gained. It re-arms on **sustained displacement**: ≥ 3 blocks from the contained cell held for 60 s, or a y gain of
   2 or more. Hand-dug stone drops nothing, so "blocks gained" fires only through a pickup or a rescuer, never through
   the bot's own digging (Claude r3 P3-3). Reflex nudges inside the cell do not re-arm it. Neither does a reconnect at the same place.
4. **What it never touches.** The emergency reflexes: air, drowning, lava. Their own exits are unchanged.
5. **Rows and paging.** One `_stranded_remedy` row per hour,
   `{reason, have, rung, steps_done}`. The operator is paged after 6 h (C0's open-excursion page).
6. **No world edit**, no `/give`, no teleport. What happens to a bot that is really contained is OWNER QUESTION Q2.

**Composed test (CLAUDE.md).** The real watchdog ladder (levels 1-3 plus the stranded path) and the real entombed and
stuck reflexes run against a contained bot
for 30 simulated minutes, with reflex nudges, a reconnect and then a delivered pickaxe. It passes only if:
- at most one remedy attempt runs per hour while contained;
- nudges do not re-arm it;
- the pickaxe does re-arm it, and the bot climbs out;
- the air reflex still fires.

**Read.**
- **Primary.** C0's return-reliability for underground excursions ≥ 100, DiD. The share of excursions open more than 6 h
  is a co-primary, because this is what F1 changes.
- **Correctness gates.**
  - **G-F1 (r3, Claude r2 P2-2).** Key the gate on (stop class, position rounded to 2 blocks) per bot-hour. More than
    2 remedy attempts per hour with no y gain of at least 1 between them is a defect, unless the bot is in `contained`.
    Positive control: placebo-c-Bravo's pre-period, which fails it on every hour.
  - **G-F1b.** Every `contained` row carries `containedReason`'s attempt list, and every legal action is refused with
    a class. A `contained` row with an unattempted action is a defect.
  - **G-F1c.** Every `hand_dig_slow` stop is followed by a footing attempt row within 60 s.
- **Exposure.** Rare: a few bots a week. The mechanism is therefore proven in Paper (P-H3 to P-H6), and the fleet read
  is correctness-gated over a long registered window (+1,440). INCONCLUSIVE is the honest close if no arm bot strands.
- **Kill switch.** `STRANDED=0`.

### 2.3 Why not breadcrumbs first

The far failures in §0 are mostly from below the town (89% row-weighted, ≈ 81% without the two chronic bots), and the
chronic ones are footing problems underground. A surface trail cannot help a bot at y = 37 in water. The trail is still the right mechanism for the trip an expedition creates: surface, 300-1,200
blocks, beyond the 128-block view distance (`view-distance=8`, bootstrap-mcai.sh:188). It is built next and measured on
the surface excursions that already happen. §0 counts 16 surface far `home` rows in 7 d, with more excursions than rows,
so trail-01's exposure needs C0's measured rate (§3.7).

### 2.4 Paper scenes (homeward-01, stranded-01)

- **P-H1.** Sky-light-0 start at y = 30, 220 from home, open cave above, goto returning `path_budget`. Pass if it
  surfaces and continues.
- **P-H2.** The same at the surface, and in a surface basin below sea level (the false-deep case). Pass if it walks
  with no climb.
- **P-H3.** A sealed cell at y = 37 with the bot standing in 1 block of water, head in water, carrying 26 sticks
  (placebo-c-Bravo's bag). First, the dig-speed inference is measured: a hand dig of stone, wet against dry. Pass if it
  gets footing, then hand-staircases out.
- **P-H4.** The same cell with water beside the roof: the placebo-c-Bravo death cell, with no dry neighbour and no held
  block. Pass if it reaches **`contained` reason `no_footing`** within one call, does not open the water, and the air
  reflex is unchanged.
- **Registration gate (Claude r2 P3-6).** P-H3's wet-versus-dry hand-dig timing must separate (wet ≥ 3x dry) before
  stranded-01 registers. If it does not, the footing rung is aimed at the wrong cause, and stranded-01 goes back to
  design.
- **P-H5.** A climb from a flooded tunnel (climbflood). Pass if the `surface` from P-H1 does not breach a water cell.
- **P-H6.** Variants:
  - stone plus scaffold, with no pickaxe;
  - a pickaxe, no scaffold, open ceiling;
  - an obsidian cap on all four bearings, which should reach `contained`;
  - the 30-minute watchdog ladder against `contained` (above);
  - a full bag;
  - a bag of exactly 1 block, in water (the jump-and-place);
  - a protected cell overhead.

---

## 3. The return system for travel: waypoints + markers (owner 10-27)

### 3.1 The options, weighed against the evidence

| option | what it fixes | evidence it matters | cost | verdict |
|---|---|---|---|---|
| (a) virtual breadcrumbs: a trail file of cells the bot actually stood on | planning beyond loaded chunks: each hop is ≤ 32 blocks to a cell inside view distance and known standable. It also removes repeated re-planning from scratch | the 10-19 analysis: an 800-block return needs ≥ 2 skill calls; pathfinder #229 (goal outside render distance → NoPath); surface far starts here fail path_budget / no_path "after 0 legs" 7 of 16 | no materials; a few KB per trip | **build first** (trail-01) |
| (b) physical markers: a 2-block cobble pillar, torch on top when held | recovery when the trail file is lost or wrong; lets OTHER bots follow; visible on the timelapse | none of the 141 far failures was "lost the waypoints": the trail file survives restarts and deaths (pool state dir). So the reliability value is a hedge, and the benefit is to others and the showcase | per 1,200-block trip at 1 per 64 blocks: 19 pillars = 38 cobble + 19 torches; ≈ 3 s per placement, ≈ 1 min per trip | **build second** (markers-01), owner decision 10-27 |
| (c) cleared paths / roads | slow terrain, and returns that fail on cliffs or water | falls are 8 of 14 deaths beyond 200; but a road is a town project, a big building job, and it changes terrain at scale | thousands of blocks dug or placed | **later**: after outposts, a town project with its own plan (B4 limits clearing to plan plots today) |

### 3.2 trail-01: what is recorded

- **Who.** Every bot, every time it leaves the town zone. The trail is not reserved for expeditions: each bot's normal
  wander (median 57 out, p90 165) is the exposure that measures it before expedition-01 exists.
- **Outbound only, by MODE, not radius (r3; Codex r2 P1-3, Claude r2 P2-3).** A waypoint is recorded only while the
  bot is NOT running `home`, a trail or marker follow, or a watchdog `home`. Detours, U-shaped canyons and wanders back
  inward are all recorded, because they are the route. A partial return records nothing. Its cursor is the state. When recording resumes after a partial return stopped
  at cursor k, the trail is TRUNCATED to k first: the bot has already walked back over k+1..N. New waypoints append
  after k (Claude r3 P3-1; X-T10 gains "partial return, then wander out again").
- **Where.** `trail-<bot>.json` in the pool state dir, written atomically (temp + rename, the planstore pattern). It
  survives restarts and deaths. There is one trail per bot. It is reset when `atHome` holds (§2.1), the same predicate C0 uses, so a perch above town
  does not reset it (Codex r1 P1-4).
- **Waypoint.** A cell the bot **stood on**: feet in air, solid below, no liquid at feet or head, sky light > 0. Each
  waypoint carries:
  - the time, and the dy from the previous waypoint;
  - `oneway`, true when the bot dropped more than 1 block on the way down to it;
  - the chunk key.

  - **Directed edges (Codex r1 P1-3).** Each waypoint also carries the edge from its predecessor: max climb, max drop,
    whether there was a liquid crossing, the swim length, and the last standable rim cell before any drop of more than
    1. The return knows what it must climb, not only the net dy.

  - **Sampling.** Waypoints come from a **1 s position sampler**, not from leg ends, so long legs and swims cannot
    leave gaps. A waypoint is recorded at the first standable cell after ≥ 16 blocks of verified progress. If no
    standable cell appears within 32 (a long swim), the edge is marked `gap` with its length. On the return, a gap edge
    is handed to today's direct path.
  - **Cap.** 400 waypoints. Thinning removes a waypoint only if its neighbours stay within 32 of each other and the
    merged edge keeps both rims. At the cap, recording stops with `trail_truncated`, and the return from beyond that
    point is direct. The ≤ 32-blocks-per-hop promise is therefore a checked invariant, `trailInvariant(trail)`, run on
    every write and in X-T6.
- **Skipped cells.** None of these become waypoints:
  - a cell inside a protected zone (`protectzone.mjs` `parseZones`);
  - a cell within `DEATH_SITE_RADIUS` / `DY` of a recorded death site (`deathsites.mjs`);
  - a lava-adjacent cell (the lavaguard scan the walker already runs);
  - a cell the hazard map flags, if the bot reads it by then (lavasight-01).
- **Rows.** A `_trail` row at each waypoint, at most 1 per 16 blocks of verified progress. Its fields go in `skill.args`:
  `{n, x, y, z, oneway, dist_home}`. A `_trail_reset` row records entering town.
- **Hook points.**
  - **The walk (r3, Claude r2 P3-4).** One hook: the 1 s position sampler (a `physicsTick`-throttled listener started
    in index.mjs beside the other per-bot timers) calls `trailNote(bot, pos, mode)`. No goto or explore hook.
  - **The decision.** `trailNote` itself is a pure decider plus the file write: `trailShouldRecord(prev, pos, cellFacts)`
    is exported and behaviour-tested.
  - **Not hooked.** The movement profile is not touched. trail-01 changes no path that the bot plans outbound.

### 3.3 trail-01: how it is used

- **`home` becomes a trail follower (r3, Codex r2 P1-2)** when the bot is > 100 out at the surface and either:
  - **resumes:** the trail has an active cursor, and some waypoint at or below the cursor is within 48. This is checked
    FIRST, so a return already partly walked is never rejected;
  - **starts:** any waypoint is within 48. The first hop targets the lowest-index waypoint that is loaded and within 32,
    so a meander, a U or a branch is cut short.
  - **The route.** It walks the waypoints in reverse, one hop per goto: `GoalNear` range 2 on a cell it has stood on.
    Each hop is ≤ 32 blocks and inside view distance, so the pathfinder never plans toward an unloaded chunk.
  - **Cursor and shortcut (Claude r1 P2-5, Codex r1 P1-3).** The trail file holds a persistent **return cursor**: the
    index of the next waypoint home. Each hop targets the waypoint nearest home (lowest index) that is loaded
    (`blockAt != null`) and within 32 of the bot. A meander is cut short, never walked back in full. The cursor only
    moves homeward. A restart resumes it after re-snapping to the nearest waypoint at or below the cursor, within 48.
  - **Waypoint list unusable.** A deep start, no trail, or no waypoint within 48: `home` runs today's path
    (and homeward-01's underground path_budget repair).
  - **Follow or walk.** The decision is a new pure function, `homeRoute({ trail, pos, dyHome })` → `trail | direct`,
    and it is tested.
- **A failed hop is never a dead end.** Steps, in order (r4, Codex r3 P1-1):
  - If the hop was a shortcut, fall back to the waypoint AT the cursor (the next one home, adjacent on the recorded
    route), never one past it (Codex r4 P1-1). The cursor advances only on verified arrival at a waypoint. X-T10
    asserts the exact fallback index.
  - Then skip to the next waypoint, then the one after.
  - Then direct `GoalNearXZ` legs toward home at the bearing ±30°: today's path.
  - Then a `oneway` hop gets the ascent profile with scaffold, as today.
- **Budget across calls.** One `home` call keeps the 170 s budget. A trail return longer than one call resumes from the
  nearest waypoint on the next call, because the trail file is the state. The watchdog's level-2 `home` resumes it
  too.
- **Interaction.**
  - **watchdog_home:** level 2 calls `home`, so it now follows the trail; level 3's `surface` is unchanged. A level-1 random relocation (45-70 blocks) can
    take the bot off it; the next `home` re-snaps to the nearest waypoint within 48.
  - **Entombed and stuck reflexes:** they own the body as today, and the trail resumes after them.
  - **town_deposit:** fires on arrival in the zone as today (34 slots). The trail ends at the zone edge and today's last
    leg (`arrivedAt`) finishes.
  - **Bag allowance:** trail-01 carries nothing.
  - **lavamap / hazard map:** waypoints are never placed on hazard cells (§3.2). A death site recorded after a waypoint
    was laid invalidates that waypoint at read time.
- **Kill switches, with an in-flight contract (Codex r1 P2-9).**
  - **`TRAIL=0`.** Recording and following both stop. Trail files are kept, not deleted. Every `home` falls back to
    today's direct path. Expedition ADMISSION closes (§4.7).
  - **`TRAIL_FOLLOW=0`.** Recording continues, for the instrument, and following stops. Admission closes the same way.
  - **Active trips.** Under either switch an active trip goes to `return` on the direct path. A trip already in
    `stranded` or `contained` keeps its phase.
  - **Tests.** Paper flips the switch during outbound travel, during a scaffold return, while contained, and across a
    restart (X-T7).

### 3.4 markers-01: physical markers (owner 10-27: build, after trail-01)

- **What.** A pillar of **2 cobblestone** placed by the bot, with **a torch on top** when the bot holds one.
  - **Why cobble.** It is the surplus the fleet carries: bags held ≈ 430 cobble each on 10-19, the reason for
    cobble-in-bags.
  - **Torches.** Today's bag allowance keeps **0 torches** (bagallowance.mjs:46, "no consumer"). markers-01 adds a torch
    allowance of up to 16, but only while a marker policy is on: it banks and withdraws from town.
  - **Why the torch.** A pillar with a torch is distinct from natural terrain, which matters for both detection and the
    timelapse.
  - **Not an admin edit.** These are blocks the bot places itself, which the owner's no-world-edit rule allows: the
    same kind of placement as scaffold and plinths.
- **Where.** At most one per 64 blocks of trail, on the waypoint cell's neighbour: never on the path cell itself. A
  marker is not placed:
  - inside the town zone (+ 8 margin), a protected zone, or a plan plot;
  - on or beside water or lava, or on sand, gravel or leaves (they fall, or they are not ground);
  - where a marker already stands within 24 blocks. The check is the shared marker index for that town (below) plus a
    look at the block (`blockAt` shows cobble + torch or cobble + cobble);
  - when health is < 14, or a reflex holds the body.
- **Budget per trip.** `markerBudget = min(19, floor((cobble − 64 reserve) / 2))` pillars. The 64 is the scaffold reserve
  that §6.3 of the 10-19 plan sizes for the climb. Torches come out of the 16.
  - **Out of material:** markers stop, and one `_marker_budget_spent` row says so. **The return is never refused**:
    markers are on the outbound only and never a precondition of anything. A test asserts that a bag with 0 cobble
    walks out and returns on waypoints.
- **Placement reservation (r4, Codex r2 P2-7, r3 P2-3).** The whole check, place, publish runs under one exclusive
  `flock` on `markers-<home>.lock`. A placement takes ≤ 10 s, so it is a try-lock: if the lock is busy, the bot skips
  this marker (`_marker_skip reason=busy`).
  - **Under the lock.** The bot re-reads the index. It reconciles any entry without an outcome against the world:
    `blockAt` shows the pillar, so it is recorded as `placed`, or it does not, so it is recorded as `abandoned`. It
    re-checks the 24-block rule, places, reads the pillar back, publishes, and releases.
  - **Afterwards.** A crash after placement but before publication is caught by the next holder's reconciliation. The
    world is the truth; the index is only a cache of it.
  - **Assumption, checked first.** This works only if every bot of a town shares the same pool directory, so that
    flock holds across them. If they do not, markers-01 uses a per-town lease file with a fencing generation instead
    (the plinth and treefarm lease), and a placer whose generation is stale does not place.
- **Shared index, with route topology (Codex r1 P2-7).** `markers-<home>.json` in the pool dir, append-only, one writer
  per line via O_APPEND, so concurrent placement cannot tear it. Each entry holds:
  - the marker cell, and its **approach cell**: the standable waypoint it was placed beside;
  - the trail id and its sequence number, and the **predecessor marker** on the same trail (homeward);
  - the bot, the time, and `seen_at`.
- **Following markers (other bots).** A different bot's `home` with no usable trail may follow markers, through
  `homeRoute`'s new `markers` branch. Starting from the nearest standing marker, it follows ONE trail's predecessor
  chain to its approach cells. It never chains by nearest marker, so crossing trails cannot loop. When the predecessor
  is missing or unreachable, it skips to that one's predecessor. When the chain ends, it takes today's direct path.
  - **A missing marker** (broken, or never there) is removed from the index on sight. Nobody repairs it in v1.
- **Rows.** `_marker` per placement `{x,y,z,torch,budget_left,dist_home}`; `_marker_skip {reason}` at most once per 64
  blocks; `_marker_follow` when a bot uses one.
- **Hook point.** It runs at a waypoint record in `trailNote` and is dispatched as a short sub-step owned by the current
  skill (place 2 + 1). It is not a new brain choice. The placement goes through the existing place helpers that read
  back from the server (the place-read-back lesson).
- **Not an obstacle (Claude r1 P3-10).** The pillar goes on the side of the approach cell AWAY from the edge to the next
  waypoint, never on a 1-wide path or ridge. If no such side exists, it is skipped with `_marker_skip reason=narrow`.
- **Cobble at exit.** C0 measures the cobble held at town exit before registration (Claude r1 P3-9). If most wanderers
  carry 64 or less, markers-01's exposure comes from expedition kits.
- **Kill switch.** `MARKERS=0`. Already-placed markers stay, as harmless blocks, and are listed in the index for a later
  clean-up if the owner wants one.

### 3.5 One variable per canary

The owner chose to build both, not to canary them together. They are separable: markers-01 needs the trail (it places at
waypoints), but the trail does not need markers. So the split is:
1. **trail-01** on its own (P lane, since it opens expeditions). The read is in §3.6.
2. **markers-01** rebased on trail-01 KEPT (S or P lane). Its read is mostly **deterministic**:
   - every placement logged and read back;
   - 0 placements in town, zones, plots or water;
   - 0 duplicates within 24 blocks;
   - 0 returns refused or delayed for want of markers;
   - material within budget;
   - a DiD guard on C0 return-reliability, which must not fall beyond its null band;
   - an exposure floor of ≥ 30 placements in the arm, with each drawn pool ≥ 5 (Codex r1 P2-8).

   Its own benefit, marker-following, is too rare to measure on the fleet (§3.1). It is proven in Paper (X-M2) and
   reported on the fleet, not gated. It goes **onto the showcase first** (OWNER 10-25: the progress pieces go to the
   showcase first), where the timelapse value is the point.
3. Bundling the two would leave a markers effect inseparable from a trail effect. The owner's no-bundling rule says no.
   I see no evidence for an exception.

### 3.6 trail-01 read (tier 3)

- **Primary.** C0 return-reliability for **surface** excursions ≥ 100 with an intent: walked within 60 min of the intent.
  DiD against control, each side against its own pre-period.
- **Exposure floor.** ≥ 30 surface excursions ≥ 100 with an intent in the arm, each drawn pool ≥ 4, set from C0's
  measured rate before registration.
  - **If C0 shows the rate is too low** (§0: surface far `home` rows are few), the honest choice is one of two. Either
    register a long read (+1,440), or let expedition-01 be trail-01's exposure: then trail-01 is a correctness-gated
    KEEP, and expedition-01's read carries the effect. OWNER QUESTION Q4.
- **Correctness gates.**
  - **G-T1.** Every `home` started at the surface > 100 out with a usable trail follows it: a `homeRoute` decision row.
  - **G-T2.** No waypoint is recorded in water, lava, a zone, the town or a death site.
  - **G-T3.** The trail file is reset on every town entry. Positive control: the town entries in the same rows.
  - **G-T4 (r3, Codex r2 P1-3).** Return progress is judged on the cursor alone. A cursor that moves to a higher index
    is a defect. Distance from home is not used, so a detour across a call boundary is allowed.
  - **G-T5.** `trailInvariant` holds on every written trail: no hop longer than 32 that is not marked `gap`.
- **Guards.** Deaths beyond 100 per bot-hour beyond 100, DiD, two-death floor; falls in the arm; the `_trail` row rate,
  which must be ≤ 1 per 16 blocks of verified progress (the row-volume guard).

### 3.7 Paper scenes (trail + markers)

- **X-T1.** 400-block surface route out across a river, a 6-block drop and a lava pool. The bot walks out recording, and
  `home` follows the trail back. Pass if the `oneway` drop is climbed with scaffold.
- **X-T2.** A waypoint blocked after it was laid (a placed block). Pass if the bot skips to the next one.
- **X-T3.** Kill and reconnect mid-return. Pass if it resumes from the nearest waypoint; and if the trail is reset at the
  town edge.
- **X-T4.** The trail leads past a death site recorded after it was laid. Pass if that waypoint is skipped.
- **X-T5.** The view-distance check: a target beyond 128 blocks. Pass if no hop's goal lies in an unloaded chunk (assert
  `bot.blockAt(hop) != null` before each hop).
- **X-M1.** Placement rules: town edge, zone edge, a river bank, sand, an existing marker 20 blocks away. Pass if only the
  legal cells get pillars, and every placement is read back.
- **X-M2.** Bot B, with no trail, 300 out near A's markers. Pass if it follows the index markers home.
- **X-T6.** Long water crossing; a self-crossing route; 400+ waypoints with thinning; repeated timeouts and restarts
  mid-return. Pass if the cursor only moves homeward and `trailInvariant` holds.
- **X-T7.** Kill switches flipped mid-trip: outbound, during a scaffold climb, while contained, and across a restart.
- **X-T8.** A high perch above town, and the corner of the square town zone. Pass if neither resets the trail; only
  `atHome` does.
- **X-T9.** An interrupted `home` partway back. Pass if no homeward waypoint is recorded.
- **X-T10.** A U-shaped canyon route whose reverse detour exceeds 16 blocks across a call boundary; a branch (300 out,
  back to 100 without `home`, then 250 out on another bearing); a restart after returning more than 48 blocks while
  still beyond 100; a narrow canyon where every shortcut is unreachable. Pass if each follows the trail, takes the
  predecessor round the canyon, and the cursor never regresses.
- **X-M4.** Intersecting trails; a missing intermediate marker; two bots placing at the same time; a new protected zone
  across the marker chain. Pass if the bot follows one chain, falls back cleanly, and no index line is torn.
- **X-M4b.** Two bots reaching the same 24-block window together; a placer paused for more than 60 s; a crash after
  placement and before publication. Pass if exactly one pillar stands (spatial uniqueness,
  read from the world).
- **X-M5.** A pillar beside a 1-wide ridge path. Pass if it is skipped as `narrow`, and G-T4 holds.
- **X-M3.** 0 cobble, and then cobble running out mid-trip. Pass if the return happens on waypoints and exactly one
  `_marker_budget_spent` row is written.
- **Sky-light control.** As in the 10-19 plan: a cave cell reads 0 and open sky reads 15, before any trail scene runs.

---

## 4. Surface expeditions (progress lane): expedition-01, re-based

The 10-19 §6 design stands: kit, out, work, return, bank; the lease and trip-state separation; the movement-profile
surface limits; the stranded and contained phases; K0; the dead-end table. These are the changes from it.

1. **The return is trail-01 + markers-01, not a private breadcrumb list.** §6.6's breadcrumbs become the shared trail
   file, so expeditions, `home` and the watchdog all follow the same thing. The trip state keeps only the phase,
   deadline and haul.
2. **The ring goes to 1,200 (OWNER E17).** It starts at 300 and steps out by 100 per `done` trip, back by 100 on a late
   trip or a death, as in §6.4.
   - **The deadline scales with the ring:** at 3.3 b/s a 1,200-block one-way walk is ≥ 6 min of pure walking and, from
     the trip data, more like 20-30 min. So the deadline is home by 45 + 0.1 × ring minutes. At 1,200 that is
     165 min, with work at most 15 min.
   - **E0 publishes candidates to 1,000 today** (DOMAIN_R = 1000). Beyond 1,000 needs E0's domain raised to 1,264
     (region centre) and a re-validated fold. That is a host change and needs no slot.
3. **Targets.**
   - **Today.** E0 has ≈ 400 candidates per town, 300-400 out, every water label `unknown`.
   - **The scan.** The first trips' `_region_scan` rows fill those labels (§6.4).
   - **Ranking.** Scanned land rich in logs or ore, then unscanned land, then water last. The gather numbers favour
     going out: logs ok% is 17.0% near town (0-48) and 28-30% at 48-200, on 10-26.
4. **Group size.** **One bot per town per trip** in v1, as X4 and §6.2. "Small groups" means several towns at once, not
   several bots per trip.
   - **Group trips (2-3 bots sharing a trail and markers)** are v2, after the job assigner exists (cooperation lane,
     C13-C14). The shared trail and marker index are what make them cheap later.
5. **Markers on expeditions.** Expeditions place markers only if markers-01 is KEPT. The kit adds 16 torches and keeps
   64 + 38 cobble (§3.4).
6. **Primary metric.** Unchanged (§6.10): logs + ore gathered per bot-hour by every arm bot, DiD, unit = the town, 4 drawn
   shared towns.
   - **Return gate added:** C0 return-reliability for expedition trips. ≤ 1 `contained` per 8 trips, and ≤ 2 late per 8.
   - **Exposure:** ≥ 8 `done` trips, ≥ 2 of them beyond 400.
7. **Kill switches.** `EXPEDITIONS=0`. A per-town `revoke` file makes the trip turn back (§6.6, X-P7). Removing the trail
   (`TRAIL=0` or `TRAIL_FOLLOW=0`) disables expedition admission: no trail, no trip. Active trips return on the direct
   path (§3.3). This is a refusal with a remedy, `skip:no_trail`, logged, and the
   bot carries on its normal order.

**Dependencies.**
- C0 live, with its controls passed.
- homeward-01 closed: KEPT or INCONCLUSIVE.
- trail-01 KEPT.
- K0 (§6.3) passed.
- markers-01 is optional, and only needed for markers on trips.
- E0 domain to 1,264, before the ring passes 900.

---

## 5. Prior art (searched 10-27; the 10-19 search in that plan's §3 stands)

- **mineflayer-pathfinder** "Having any goal outside renderdistance crashes the bot with NoPath" (issue #229, listed in
  the [issue tracker index](https://issuehunt.io/r/PrismarineJS/mineflayer-pathfinder?tab=idle)). The README claims
  "long distance paths" ([npm](https://npmjs.org/package/mineflayer-pathfinder)) but documents no handling of unloaded
  targets.
  - **The standard workaround.** Intermediate waypoints inside loaded chunks, re-issued as the bot moves. That is goto's
    45-block legs today, and trail hops tomorrow.
  - **The server side.** Paper's "Do not load chunks for Pathfinding"
    ([commit](https://ayakael.net/mirrors/papermc/commit/da850bab55116dca172943b0a962671c768b6e74)) concerns entity
    pathfinding, not clients.
- **Chunk distances.** A client only receives chunks inside the server's view distance. Only chunks inside the simulation
  distance tick
  ([PaperMC forum: chunk ticking range](https://forums.papermc.io/threads/change-the-chunk-ticking-range.1528/),
  [chunks handling](https://forums.papermc.io/threads/chunks-handling.1185),
  [RedstoneFuture optimisation guide](https://github.com/RedstoneFuture/minecraft-optimization)).
  - **The fleet's values.** view-distance = 8 and simulation-distance = 6 (bootstrap-mcai.sh:188-189), so a bot sees
    ≈ 128 blocks around itself.
  - **What follows.** Trail hops of ≤ 32 blocks are always inside it. A hop's target is checked loaded
    (`blockAt != null`) before the goal is set (X-T5).
  - **What also follows.** A dropped item or a furnace at a far outpost does not tick while no player is near: relevant
    to outposts, not to this design.
- **Mindcraft** ([skills.js](https://raw.githubusercontent.com/kolbytn/mindcraft/main/src/agent/library/skills.js)).
  - **How it moves.** `goToPosition` is a single `GoalNear` with a 1,000 ms `getPathTo` probe; if both probes fail it
    "attempt[s] to navigate anyway".
  - **What it lacks.** No maximum distance, no overall timeout, and no waypointing. `goToNearestBlock` caps its search
    at 512 and returns true without checking arrival.
  - **The lesson.** The popular LLM-agent stack has no long-distance return either, and a single goal with no arrival
    check is the failure mode H1 already fixed here.
- **Named-waypoint memory** in other agents: the
  [mc-waypoint skill](https://playbooks.com/skills/bdambrosio/cognitive_workbench/mc-waypoint) labels coordinates for
  later navigation, and [Golem](https://pkg.go.dev/github.com/mab-go/golem) persists memory between sessions. Both store
  destinations. Neither stores a walked trail. Baritone's segmented paths and chunk cache (10-19 §3) remain the closest
  prior art for (a).
- **Not found:** any mineflayer or forum report of bots placing trail markers and other bots following them. (b) is
  original here, so its Paper proof (X-M2) carries the claim.

---

## 6. Open questions for the owner

- **Q1. Order.** C0 first (host, no slot). Then homeward-01 (S), trail-01 (P), stranded-01 (S), markers-01 (P, showcase
  first), expedition-01 (P). Do you want trail-01 ahead of homeward-01 instead? The evidence says the far failures come
  mostly from below the town, which is why homeward-01 is first.
- **Q2. A contained bot**, walled on all four bearings by blocks it cannot break. r2 found that placebo-c-Bravo was NOT
  this case: it needed footing. Its remedies, none of them a world
  edit:
  - (a) Wait and page you at 6 h. This is the design's default.
  - (b) A **rescuer bot**: a town bot with a spare pickaxe walks to it, digs it out, and drops the spare. This is
    cooperation-lane work: the job assigner.
  - (c) Allow the bot to **give up and respawn** at town by letting itself die. That is not a world edit, but it is a
    death on purpose, and it would count in the death gate.

  Which do you want, and is (c) acceptable at all?
- **Q3. Marker look.** A 2-cobble pillar + torch, at most 1 per 64 blocks, outbound only, every bot (not only
  expeditions)? Or markers only on expeditions? The fleet-wide version puts ≈ hundreds of pillars a week around towns;
  the expedition-only version is ≈ 19 per trip. **My recommendation: expedition trips only**, plus wanders beyond 200.
- **Q4. trail-01's read if the fleet's own surface excursions are too few** (C0 will say): run a long read (+1,440), or
  KEEP it on correctness gates only and let expedition-01 measure the effect?
- **Q5. Torches.** The bag allowance holds 0 torches today. May markers-01 raise it to 16 while markers are on?
- **Q6. E0's domain beyond 1,000** (host change, needs no slot), to reach the owner's 1,200.
- **Q7. Old markers.** Leave them standing forever, or clean them up after a year or at a reseed?
- Rails (X6/X7) stay undecided and are not needed by anything here. Cleared roads (c) are recommended as a later town
  project.

---

## 7. Reviews

### Round 1 (r1): Codex CHANGE, Claude CHANGE

**Codex** raised 4 P1 and 5 P2:
- containment mistook missing tools for impossibility;
- the craft rung was not executable;
- trail sampling could not guarantee hops ≤ 32, the return was not restricted to outbound recording, and there was no
  cursor;
- a town reset on `inTownBox`, which has no y bound;
- `contained` had no composed watchdog contract;
- the C0 denominators were inconsistent (134 closed);
- markers carried no route topology;
- F1 and F2 were bundled, and the G-F2 control mixed surface rows;
- the kill switches had no in-flight contract.

**Claude** raised 2 P1, 6 P2 and 4 P3:
- "by hand" proves stone is diggable, so the `why` suffix must be read;
- `contained` was not wired into the watchdog's three re-issuers;
- "deep" is row-weighted and relative;
- `climb_first` was not evidenced;
- the trail recorded returns and its thinning broke the 32-block promise;
- the trip reconstruction was biased (left-censoring, death closures as a lower bound);
- C0's primary could be credited by drift;
- the rung-2 material counts were wrong;
- P3: markers' cobble, the pillar as an obstacle, missing scenes, and the interrupt claim (confirmed).

**r2 applied all of them.** The new evidence is the `why` tabulation. placebo-c-Bravo's 786 stops were hand-dig timeouts
and aborts in water, so F1 became footing + a hand staircase, and crafting was dropped. board-a-Comet showed the same
shape on 645 rows. F1 and F2 were split into stranded-01 and homeward-01. `climb_first` was dropped. Also added in r2:
the `contained` watchdog contract and its pure functions; one `atHome` predicate; outbound-only recording, directed
edges, a 1 s sampler, `trailInvariant` and a return cursor; marker topology and an append-only index; the kill-switch
contract; and new scenes P-H5, P-H6, X-T6 to X-T9, X-M4 and X-M5.

### Round 2 (r2): Codex CHANGE, Claude CHANGE

**Codex** raised 3 P1 and 4 P2:
- footing could need a wet dig that cannot finish, and a partial dig is not carried across calls;
- trail resumption rejected a partly walked return;
- radial monotonicity dropped valid routes, and G-T4 punished detours;
- `contained` equated holding a pickaxe with being able to escape;
- the entombed reflex was outside the contract;
- C0 had no mature-cohort denominator;
- marker reservations raced.

**Claude** raised 1 P1, 2 P2 and 3 P3:
- no terminal state for a failed footing;
- G-F1 was defeated by the changing progress text;
- the branch case left a bot without a trail;
- the hook-point text was stale;
- jump-and-place needs body ownership;
- the dig-penalty inference must gate registration.

**r3 applied all of them:**
- `footingPlan` with a `no_footing` contained reason, and a 300 s `stranded_dig` only when the head is in air;
- `containedReason` and `containedMaySuppress`, now covering the reflexes;
- G-F1 keyed on position and y gain;
- mode-based outbound recording, resume-first eligibility, and cursor-only progress;
- mature cohorts;
- the flock reservation;
- X-T10, X-M4b, P-H4's expected outcome, and the registration gate.

### Round 3 (r3, confirmation): Claude APPROVE (3 P3, applied in r4); Codex CHANGE (1 P1, 2 P2)

**Codex r3:**
- U-shaped shortcuts could all be unreachable;
- the 300 s dig had no runner deadline or claim renewal;
- marker reservation expiry reopened the race.

**r4:**
- predecessor fallback, with the cursor advancing only on arrival;
- `stranded_dig` as its own registered skill with a 300 s timeout and claim renewal;
- the whole check-place-publish under one try-lock, with world reconciliation and a lease-and-fence fallback if the pool
  dir is not shared.

### Round 4 (r4, confirmation): Codex CHANGE (1 P1, 1 P2); Claude APPROVE stands from r3

**Codex r4:**
- the fallback `cursor − 1` skipped the adjacent waypoint;
- the claim's absolute ceiling stayed at the default timeout.

**r5:**
- the fallback goes to the waypoint at the cursor;
- the claim ceiling is taken from the run's effective deadline, with a test past default + grace.
