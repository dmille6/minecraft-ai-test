# Ziggurat + shared mineshaft + dig avoidance (2026-10-15, measurement + design, r5.1)

OWNER 10-15 ~03Z: "lets do it". The owner asked for three things:
- a 48 x 48 stepped ziggurat per shared world, as the flagship, hollow first;
- one permanent shared mineshaft per town;
- an end to unneeded stone mining.

This document measures where stone comes from and then designs the three pieces. **This task changes no fleet code,
and nothing here is built, queued or deployed.**

r2 took in the r1 reviews (Codex CHANGE, 7 P1; Claude CHANGE, 4 P1). r3 takes in r2 (Codex CHANGE, 4 P1; Claude
CHANGE, 1 P1), whose shared P1 was that the ziggurat's self-repair could stall its own layer barrier. See §8. The
biggest corrections since r1:
- **Mine start positions.** A skill row's `@timestamp` is its START (logger.mjs:59), and its snapshot is the END
  (runner.mjs:431). r1 got this wrong, so every per-call number below was recomputed.
- **The shaft and withdraw cuts.** Both were recomputed on the population each rule can actually serve. Both are
  smaller than r1 said.
- **The ziggurat's honest cost.** It is 14.7k blocks, mostly cobble, not "3.8k cobble".
- **r3.** The barrier applies to the open frontier only. Damage below it never blocks the build (§3.3, §3.6). The shaft
  specification gains safe states per mutation, its own exclusion arrays and the routing order (§4). The withdraw rule
  is limited to bots at the surface (§5.1). The numbers are reconciled.

> **OWNER DECISION 10-15 ~05:00Z:** "lets work on a shared mineshaft, and build a ziggurat that is no hollow as an interesting
> project per world".
> - **Z1 = SOLID, by layers.**
> - **Z2-Z8 are operator defaults**, taken from §7's recommendations. The owner can change any of them:
>   - Z2: a monument lane, sharing the projects' budget;
>   - Z3: the generic builder's first job;
>   - Z4: the town floor goes first;
>   - Z5: S1 → S2 → S3;
>   - Z6: S=3;
>   - Z7: no stone_bricks;
>   - Z8: foreign skin accepted.
> - **Build progress:**
>   - Stage 1, the offline gates: `zig-stage1-z0m0-2026-10-15.md`, both engines APPROVE.
>   - Stage 2, stonewithdraw-01: built, both engines APPROVE (`stonewithdraw-01-reviews-2026-10-15.txt`).
>   - **Departures recorded by stage 2:**
>     - the withdraw rewrite is **surface only** (the deep probe was dropped in review);
>     - §5.1(a), the rung's own order, and the change to mine's rung credit within 48 are not built.

## 0. Answers first

**1. `mine`'s staircase is the largest single source of cobble.**
- **Scale.** Over 15 h the fleet collected 28,417 cobble and deepslate. That is 23.7 per bot-hour, about 45.5k a day.
  Of that, **14,405 (50.7%) was collected while `mine` was running.**
- **What it is.** `mine` only cuts a descending staircase (`descentStepCells`, up to 3 cells per block of descent). It
  never mines sideways, so this cobble is the price of vertical travel.
- **Seven days of ES agree:** 47.6% of 348,431.
- **The other activities, by share of cobble collected:**

  | Activity | Share |
  |---|---|
  | goto's dig retry | 17.0% |
  | gathering stone | 9.2% |
  | approach digs of other gathers | 6.5% |
  | survival reflexes | 5.4% |
  | the iron gather / ore tunnel | 5.1% |
  | `surface` | 4.2% |

- These are **activity-attributed collections**, not traced digs (§1.1).

**2. Most mine calls are small steps inside a loop of iron attempts.**
- 74% of calls descend less than 2 blocks.
- The next skill after a mine call is another mine (3,182 times), goto (1,187) or gather iron_ore (844).
- The bots step down, try for iron, and step down again.

**3. A town shaft can absorb only near-home descents.**
- **Descent ceiling.** In the 12 shared worlds, mine calls starting within 48 of home produced 4,376 cobble in 15 h.
  The part of their descent above y=16 (the shaft bottom) is pro-rated at 4,181, about **6.7k a day** of the shared
  fleet's 34.5k-a-day gross. This ceiling assumes every such call is on the shaft network.
- **Candidate floor.** Calls that start at the surface near home produced 465 cobble, about 0.74k a day. They are a
  candidate, not a guarantee: M0 checks the walk to each real collar.
- **Central case.** Shaft routing **hops landing to landing**, so step-sized calls are served too (§4.4). Assuming half
  the underground near-home calls are connected, and counting the ascents, the cut is **≈ 4.7k a day (low 0.94k, high
  8.2k)**. That is about **14% (3-24%) of shared gross**.

**4. Gathering stone is the 64-reserve refilling itself, and the town can supply it.**
- 94% of gather-stone runs start with fewer than 64 in the bag.
- The towns hold the stock: 4,413 cobble across the 12 shared towns (journal fold). Eight sit at the 256 cap
  (248-256). Three are above it: board-d 578, hive-c 486, placebo-b 1,245. Only placebo-c (64) is below. Deposits
  above the cap are refused.
- The rule is a deterministic **withdraw instead of dig**: for bots at the surface within 48 of home, from town stock
  above a floor of 64.
- It cuts only **≈ 0.2-0.75k a day (central ≈ 0.4k)**, because most near-home stone gathers happen underground
  (§5.1). It is cheap, and
  deposits refill the band, but it is small.

**5. goto only digs after its walk planner fails.** goto's 1,311 dig retries in 15 h follow a failed walk plan. Whether
a walk route existed is not measurable today, so §5.2 instruments that first and claims no cut.

**6. Ziggurat geometry: 48 base, 8 tiers of 2, setback 3, 16 high.**

| Variant | Blocks | Verdict |
|---|---|---|
| True hollow shell | 3,780 | 2,116 of its cells (= 46², one roof cell over every interior column) sit over air. While it is built, the open interior is a deep pit. |
| **Solid by layers** (recommended v1) | **14,688** | Every cell rests on the one below. Bots build it walking on the growing slab, as the town floor does. There is no cavity, so no trap. |

- **The skin** (3,780) is cobblestone. **The core** (10,908) accepts cobble, deepslate and the stone-family blocks the
  scaffold reserve allows. Stone-family flow is small, so **expect ≈ 11-14k cobble per world**.
- **Funding binds, not labour.**
  - Labour: 1.4-6 world-days.
  - Funding today: ≈ 0.6-2.5k per world-day (typical ≈ 1-1.5k), so **≈ 1-3.5 weeks per world**.
  - After the shaft: ≈ 0.2-2k per world-day, so **≈ 1-10.5 weeks**.
  - These are planning ranges, not a closed material balance. Z0 reconciles each world (§3.2).

**7. Recommended order:** offline siting checks → withdraw rule + transit instrument → ziggurat → shaft. The ziggurat
should start on today's surplus, before the shaft shrinks it (Z5).

---

## 1. Measurement: stone and cobble production by cause

### 1.1 Window, sources, denominators, and what the instruments can and cannot say

**Window W:** 2026-10-14 11:30Z to 10-15 02:30Z.
- That is 15.0 h, starting 20 min after digtown-01 was promoted fleet-wide (11:10Z), so every bot carries `_dig_town`.
- 80 bots, 1,198.3 active bot-hours (distinct bot-minutes / 60).

**The walk.** A streaming full walk of every bot's `skill-*.jsonl` read **897,944 rows**:
- the live file plus `-20261015.gz`, which holds the 10-14 rows;
- the scripts that also open `-20261014.gz` filter by time, so the result is the same.

**Reconciliation.**

| Count | Files | ES |
|---|---|---|
| All rows | 897,944 | 897,899 |
| `mine` rows | 6,857 | 6,857 |

The 45-row gap is the 23:57Z rotation race that estelemetry documents.

**Scripts:** `ziggurat-mineshaft-2026-10-15.measure.py.txt`
- stonecause: the full walk
- mine2: mine calls, sessions, per-call table
- near: near-home surface and gather-stone
- pool: per-pool supply
- pass2: bag at the start of a call
- between: skill sequences
- es7d: seven days of ES
- zig: the voxel model

**What digtown can say.**
- `_dig_town_sum` counts **every** dig, but per minute and only by outcome.
- Its purpose and class split exists only inside the town box (Chebyshev 16 plus a margin of 4).
- `_dig_town` per-dig rows (block, purpose, by) exist only for town-ground cells (digtown.mjs:120-128).
- So digtown gives the fleet-wide **dig total** and the **town-box breakdown**.

**Cause by material, fleet-wide, comes from `_pickups`.**
- **Attribution.** Each summary attributes every collected item to the skill or reflex running at the moment of
  collection (`attributeTo`, pickuplog.mjs:74-78). That labels the collecting activity, not the breaker. An item
  another bot dropped is attributed to whatever the collector was doing (Codex r1 P2-9).
- **Cross-check.** The inventory deltas on `mine`'s own rows give 14,003 cobble, against the 14,405 attributed to mine
  by pickups. That is 97%.
- **Position.** Each summary's position is where the bot was at the **flush**, up to 60 s after the pickups
  (pickuplog.mjs:422-438). Distance and depth from `_pickups` are therefore flush-position proxies (Codex r1 P2-8). The
  per-call mine numbers in §1.3 use the call's own start position instead.

**Positive controls for the parser.**
- 21,817 of 21,817 `_pickups` rows had a parsable tail.
- The tails total 85,882 items; the parsed groups sum to 85,815 (99.92%).
- The hidden-groups tail ("+N groups not shown") occurred **0** times, out of 21,817 tails read.

**Dig total** (`_dig_town_sum`, 30,710 summaries):

| Measure | Count |
|---|---|
| Digs of any block | **126,612** (105.7 per bot-hour) |
| Confirmed by the server | 118,647 (93.7%) |
| Aborted | 6,970 |
| Rejected | 455 |
| Unconfirmed | 375 |
| Foreign | 126 |
| Pending at flush | 34 |
| Death | 4 |
| Unaccounted (no outcome key in the window) | 1 |

- Cobble and deepslate collected: 28,417, which is 22% of all digs.
- Stone-family (andesite, diorite, granite, tuff, calcite) adds 4,926.
- Dirt is 41,735.

### 1.2 THE TABLE: cobble + cobbled_deepslate collected, by activity (W, 15 h, 1,198 bot-h, 80 bots)

| Activity (source label) | Cobble | Share | Per bot-h | /day | Needed? (judgement, see the notes) |
|---|---|---|---|---|---|
| **`mine`**, the staircase descent (`mine:yNN`) | **14,405** | **50.7%** | 12.0 | 23.0k | `mine` digs nothing but descent steps. Near a shaft, that vertical travel is unneeded (§4). |
| **goto**, the dig retry after "no route on foot" (incl. goto:fill/pour/pillar/shelter, 157) | 4,818 | 17.0% | 4.0 | 7.7k | It digs only after the walk planner failed. Unknown until §5.2 measures it. |
| **gather stone** (`gather:stone` 1,475, `gather:cobblestone` 1,140) | 2,616 | 9.2% | 2.2 | 4.2k | 94% of runs start below the 64 reserve. The town holds the stock (§5.1). |
| gather approaches (`gather:dirt` 1,521, `oak_log` 185, `sand` 133) | 1,839 | 6.5% | 1.5 | 2.9k | The target was dirt, logs or sand. |
| survival (`reflex:escape` 1,034, `marooned` 493, drown/flooded 6) | 1,533 | 5.4% | 1.3 | 2.5k | Not touched. |
| iron gather / ore tunnel (`gather:iron_ore` 1,410, `coal_ore` 34) | 1,444 | 5.1% | 1.2 | 2.3k | Iron. Not touched. |
| `surface`, the ascent | 1,181 | 4.2% | 1.0 | 1.9k | Near a shaft, unneeded. |
| idle 257, home 185, explore 63, other 76 | 581 | 2.0% | 0.5 | 0.9k | Small. Includes others' drops. |
| **Total** | **28,417** | 100% | 23.7 | 45.5k | |

**The split by pool type.** Shared pools (12 worlds, 60 bots) collected 34.5k a day (pool.py). Isolated pools (4
worlds, 20 bots, per-bot towns) collected 10.9k a day. The ziggurat and the shaft are designed for the 12 shared
worlds, and their cuts are stated against 34.5k.

**Seven days of ES** (10-08..10-14, `_pickups` per day, each day ending 23:56Z, 348,431 cobble):

| Activity | Share |
|---|---|
| mine | 47.6% |
| gather stone | 20.1% |
| goto | 13.0% |
| ore | 5.6% |
| survival | 4.6% |
| approaches | 4.3% |
| surface | 3.0% |

- Gather stone **fell from 27.2% (10-08) to 8.6% (10-14)**, and mine rose from 45.2% to 51.9%. W is the current mix.
- Every day carries ES's rotation caveat. 10-14 also carries "past the reconciled 18:46Z".

### 1.3 `mine`: what it is, where, and how it is called

**Volume.**
- 6,857 calls (5.7 per bot-hour). 90% were triggered by `llm:idle`.
- 12,299 blocks of descent and 14,003 cobble.
- Only **11.3 bot-hours, 0.9% of bot-time.** The staircase costs material and risk, not time.

**Start position (r2).**
- The start is the bot's latest **observation** at or before the call's start. A skill row's observation time is
  `@timestamp + duration` and an event's is its `@timestamp`.
- All 6,857 calls had one.
- Staleness was 28.5 s at p50, 34.9 s at p90 and 131 s at p99. That gap is the model's decision time, during which the
  bot is idle.

**Calls are small.**
- 5,078 calls (74.1%) descended less than 2 blocks.
- By the descent requested (start y − args.y):

  | Requested | Calls | Cobble |
  |---|---|---|
  | ≤ 2 | 4,537 | 4,173 |
  | 3-7 | 1,394 | 3,412 |
  | ≥ 8 | 926 | 6,418 |

**They sit inside an iron loop.**
- The skill that follows a mine call is mine 3,182 times, goto 1,187, gather iron_ore 844, gather dirt 403, explore 343,
  and others.
- Between two mine calls (at most 4 skills apart, 5,719 pairs), the most common skills are goto 1,517, gather iron_ore
  1,165 and explore 450.

**Sessions (Codex r1 P2-10).**

| Definition | Sessions | Median calls | Median drop | p90 drop |
|---|---|---|---|---|
| Strict: any other skill row, a `_death`, or a position jump > 8 between one call's end and the next call's start (restart, teleport; 10 splits; Codex r3 P2-10) ends it | 3,685 | 1 | 2 | 7 |
| r1's loose mine-only grouping (gap ≤ 10 min) | 861 | — | — | — |

- With the strict definition the result is the same at G = 5, 10 and 20 min.
- **"Descent" is not one act here. It is a walk down, interleaved with other work**, so eligibility below is measured
  **per call**.

**Per call, shared pools only** (5,249 calls, 10,994 cobble, 9,406 blocks descended):

| Start | Distance from home | Calls | Cobble | Start above y=16 | Blocks descended |
|---|---|---|---|---|---|
| surface (≥ home.y−4) | ≤ 24 | 175 | 33 | 33 | 86 |
| surface | 25-48 | 125 | 432 | 432 | 453 |
| surface | 49-96 | 308 | 1,102 | 1,102 | 1,023 |
| surface | > 96 | 269 | 393 | 393 | 586 |
| underground | ≤ 24 | 948 | 1,685 | 1,601 | 1,452 |
| underground | 25-48 | 1,118 | 2,226 | 2,125 | 1,848 |
| underground | 49-96 | 1,288 | 3,150 | 3,024 | 2,433 |
| underground | > 96 | 1,018 | 1,973 | 1,699 | 1,524 |
| **≤ 48, all starts** | | **2,366** | **4,376** | **4,191** | 3,839 |

The 175 surface calls within 24 yielded 33 cobble. That is consistent with `mine`'s 12-block home refusal: 276
`forbidden` failures in W.

**The bag at the start of a call:**
- 4,572 of 6,857 calls (67%) began with 128 or more cobble+deepslate in the bag;
- those calls produced 9,175 cobble.

**Is a stair re-cut where one existed?**
- Telemetry cannot see earlier stairs.
- The code has **no input for them**. `chooseStairBearing` ranks by dry runway and liquids (skills.mjs:10438-10470).
  `mine` only skips cells that happen to be air already (skills.mjs:10104-10117).
- So an existing stair is reused only by accident. "Every descent is a new staircase" is the expectation, not a
  measurement (Codex r1 P2-9).

### 1.4 The town box (the only per-block digtown rows)

There are 2,307 `_dig_town` rows in W.

| Block | Purpose | Confirmed |
|---|---|---|
| dirt | target | 1,304 |
| grass_block | target | 443 |
| stone | survival | 99 (+37 aborted) |
| stone | target | 93 |
| **cobblestone** | target | **92** |
| stone | transit | 34 |
| cobblestone | survival | 16 |
| cobblestone | transit | 10 |

- **The 92 cobblestone target digs are gather digging bot-placed cobble near home.** A cobble monument must be removed
  from gather's enumeration (§3.6).
- Stone digging inside the box is about 350 cells in 15 h. **The stone problem is underground and away from town.**

### 1.5 Supply, sinks, stock

**Skill-row inventory deltas** for cobble+deepslate, from W scaled to a day. These are net within each skill. They are
not a closed town balance: deaths, passive pickups between skills and chest stock are outside them (Codex r1 P2-12).

| Side | Total | By skill |
|---|---|---|
| Gains | 40.0k | mine 22.8k, goto 7.5k, gather:iron_ore 2.2k, gather:dirt 2.0k, gather:stone 2.0k, gather:cobblestone 1.3k, surface 1.2k |
| Losses | 30.9k | **Scaffold and pillars inside other skills ≈ 21.6k** (gather:oak_log 8.8k, explore 6.3k, gather:dirt 3.8k, goto 2.7k); **dispose_well 3.7k** (cobble destroyed in the junk well, 7 pools); craft 2.4k; deposit + town_deposit 0.8k |
| **Net** | **+9.1k** | |

**Stock.**
- **Bags:** 18,160 cobble+deepslate, 13,533 of it above the 64 reserve.
- **Town chests** (latest `cnt` per container in the cobble journals of 12 shared towns): **4,413**.
  - Eight towns sit at the cap (248-256: board-a, board-b, board-c, hive-a, hive-b, hive-d, placebo-a at 256;
    placebo-d at 248).
  - Three are above it (board-d 578, hive-c 486, placebo-b 1,245), and one is below (placebo-c 64).
  - These are town totals over 10-30 containers each.
  - Positive control: townprojects §1.1 measured 4,448.

**Per shared world** (5 bots), per day:

| Measure | Range | Median |
|---|---|---|
| Net cobble | −139 to +1,506 | ≈ 640 |
| Well disposal | 0 to 1,858 | — |
| Stone-family net in skills | 110 to 808 | — |
| Bag surplus above 64 (now) | 386 to 3,173 | ≈ 800 |

Bags hold only 198 stone-family blocks fleet-wide, so most stone-family is shed.

---

## 2. The ziggurat: geometry and cost

### 2.1 Shape

- 48 x 48 base. Square tiers **2 blocks high**, set back **S = 3** per side per tier.
- 8 tiers: sides 48, 42, 36, 30, 24, 18, 12, 6. Height 16.
- **Terraces are 3 wide.**
- **A 3-wide grand stair faces home:** one full block at the foot of each tier wall, so every climb step is +1. That is
  the pathfinder's ordinary step-up.
- **Every drop on the structure is ≤ 2**, so no fall damage and no guard is needed (the projects rule guards drops
  over 3).
- **Why 2 high:** from a terrace the eye is at s+2.62. A top-face click needs the eye above the face (plinth standFor),
  so only s+1 and s+2 can be placed. One tier is exactly what one terrace can reach.

### 2.2 Cost per tier (voxel model, `zig.py`, reproduced by Codex and Claude)

| Tier | Side | Skin (26-adjacent shell) | Solid |
|---|---|---|---|
| 0 | 48 | 892 | 4,608 |
| 1 | 42 | 772 | 3,528 |
| 2 | 36 | 652 | 2,592 |
| 3 | 30 | 532 | 1,800 |
| 4 | 24 | 412 | 1,152 |
| 5 | 18 | 292 | 648 |
| 6 | 12 | 172 | 288 |
| 7 | 6 | 56 | 72 |
| **Total** | | **3,780** | **14,688** |

**Additions:**
- the stair, 24 blocks;
- the **foundation**: fill under the footprint wherever the ground is below the base. This depends on the site, and Z0
  measures it. +10-30% is assumed until then.

**Variants:**

| Variant | Tiers | Height | Solid | Skin |
|---|---|---|---|---|
| S = 2 | 12 | 24 | 20,800 | 4,516 |
| S = 4 | 6 | 12 | 11,648 | 3,412 |
| 64 base, S = 3 | 11 | 22 | 33,352 | 6,748 |

### 2.3 Hollow vs solid (owner decision Z1)

**Why a hollow stepped shell has overhangs.**
- Tier i's wall stands on tier i−1's roof, and that roof spans inward over the cavity.
- For every cell to rest on the cell below, the shell would need thickness T_{i−1} ≥ T_i + S. That recursion reaches
  the full half-width, which is solid.
- In the model, **2,116 skin cells sit over air**. That is exactly 46²: one roof cell over every interior column of the
  46 x 46 interior. It is the same for every S, because it is a property of any roofed hollow (Claude r1 P2-5).

**Can they be placed?**
- They can only go against a side face, bridging inward from the growing roof.
- Plinth's `supportsFor` does allow side faces (Claude r1 P2-5; r1 was wrong to say otherwise).
- The unproven part is a **stand**. On a roof that grows inward over a void, plinth's stand rule needs the eye above the
  face and a clear line of sight to it. No Paper run has tested that.
- Worse, **until each roof ring closes, the interior is an open pit up to 15 deep inside walls.** A bot that falls in is
  entombed, and its escape digs the structure. That is the CLAUDE.md trap class.

**Recommended v1 (Z1-a): SOLID BY LAYERS, cobble skin, mixed stone core.**
- **Every cell is placed on the top face of the cell below.** The bot's eye is above the face, because it stands on the
  layer below or on the slab being filled.
- **Bots walk on the growing slab, with every step ±1.** This is the same motion as the town floor fill, which was
  Paper-proven: 241/241, a walker case 243/243, SIGKILL x2 241/241.
- **No cavity exists at any moment.**
- **Skin** (3,780) is cobblestone. **Core** (10,908) accepts cobblestone, cobbled_deepslate, andesite, diorite, granite
  and tuff.
  - Stone-family is drawn only above the scaffold reserve: `STONE_GUARD` 64 over `RESERVE_STONE`, the well's
    `guardLeft` rule (well.mjs:97-108). Claude r1 P2-6 showed they are not junk to the exit contract.
  - Never dirt: it would pay bots to dig town ground.
  - Never gravel or sand: they fall.
- **Expect the core to be mostly cobble.** Bags hold 198 stone-family blocks, and its flow is 0.1-0.8k per world-day.
  So Z1-a is **14.7k blocks, ≈ 11-14k of them cobble**.

**The other choices:**
- **Z1-b:** true hollow (3,780). Gated on a Paper proof of inward roof stands and a build order that closes each roof
  before anyone can fall in.
- **Z1-c:** S=4 solid (11,648).
- **Z1-d:** a smaller base.

### 2.4 Build time

**Labour.**
- Paper paces:
  - town floor: 0.5 s per block median, 1.2 s p90;
  - board-a's real town: 32 per 35-86 s;
  - plinth: 47-56 a minute on site.
- With 3-5x fleet overhead, that is 0.07-0.30 placements a second on the job.
- Budget: ≤ 10 min of body time per bot-hour (the projects §5 cap, shared).
- Exposure: bots near the site. Z0 must measure it (§3.2), because time within 48 of home (48.5%) is only an upper
  bound.
- Per world: 5 × 0.485 × 600 s × 0.07-0.30 ≈ **100-440 placements per world-hour**, so 14.7k takes **33-147
  world-hours (1.4-6 days)**.

**Funding**, per shared world per day:

| Source | Today | After the shaft and the withdraw rule |
|---|---|---|
| Net cobble | median ≈ 640 (−139 to 1,506) | median ≈ 200-250 (central shaft + withdraw ≈ 0.42k per world-day; part returns as reserve refills) |
| Well redirect (only where a well disposes) | 0-1,858 | unchanged |
| Stone-family above the guard | ≈ 0.1-0.8k | unchanged |
| **Total** | **≈ 0.6-2.5k** (typical ≈ 1-1.5k) | **≈ 0.2-2k** |

- Starting stock: the bag surplus (0.4-3.2k) plus chest stock above the floor (§3.4).
- Today: 14.7k takes **≈ 1-3.5 weeks** per world, plus the foundation, plus the town floor's backlog first (Z4, about
  3.3k per town, ≈ 2-3 days).
- After the cuts: **≈ 1-10.5 weeks.**
- None of this is a closed material balance: deaths, passive pickups and chest transfers are outside the skill deltas.
  Z0 reconciles each world: stock, deposits, withdrawals, the well redirect, the foundation and the floor backlog
  (Codex r1/r2 P2-12).
- **Part of the cut returns.** The scaffold sinks (≈ 21.6k a day) are unchanged and the 64 reserve refills, so some cut
  digging reappears as gather-stone (Claude r1 P2-8). The net falls by less than the gross cut.

---

## 3. The ziggurat as a project

### 3.1 Lane (decided here; owner may override, Z2)

The ziggurat is a **monument lane**, separate from the town-projects WIP=1, and it shares that lane's body-time budget
(≤ 10 min per bot-hour across both).

| Reason | Detail |
|---|---|
| Disjoint material | The monument uses cobble and stone-family. The projects use copper, logs, iron and furnaces, and the storehouse only 150 cobble. |
| Disjoint site | Its own reserved footprint in the shared `townsites-<home>` file. |
| Order | When both are runnable, the project job goes first. |

There is one monument per shared world. Isolated pools are excluded, as in D2.

### 3.2 Siting (offline first, gate Z0)

**Footprint:** 48 x 48 plus a 2-cell walk apron, so 52 x 52.

**Exclusions:**
- **Apron at Chebyshev ≥ 25 from home.** That clears:
  - the plinth (≤ 21);
  - the zone and storage cylinder (16);
  - the town floor's box (16) **and its +8 walk and flood read margin (24)** (Codex r1 P2-13).
- At least 8 from the shaft collar and any yard or hall site.
- Not on these, each with a 2-cell margin:
  - tree-farm plots;
  - planted sapling cells (`_plant_spot`);
  - wells or plinth;
  - chests or any town furniture;
  - water or lava in or under the footprint;
  - logs or leaves.

**Base y** is the highest ground cell in the footprint.
- **No cutting** except vegetation (grass, flowers, snow layers).
- Ground below the base is filled as foundation, with core material.

**Score:**
- foundation cells;
- plus a penalty for distance from home;
- plus a penalty for **known voids under the footprint**: air within 20 below the base, read from the region copy. A
  bot under the footprint is the trap of §3.6.
- A site whose foundation exceeds 30% of the plan is rejected.

**Z0 (before any fleet code).** Run the planner offline on read-only region copies of the 12 shared worlds, as the
town floor did. Per world it reports:
- the site, base y, foundation cells, void cells beneath, and blockers;
- **from ES position history, the bot-hours per day spent within 32 of the site centre.** That is the labour exposure
  the estimate above only bounds.

If a world has no site with the centre within 64, the lane is off there and the reason is named.

### 3.3 Plan, record, leases, cooperation

**The plan** is a pure function of (site, geometry, version): an ordered cell list.
- **Order:** layer by layer from the bottom. Within a layer, centre outward, so a builder always has open, walkable
  cells behind it.
- Each cell carries `{x, y, z, layer, tier, role: skin|core|stair|foundation, seg}`.
- **Offline proof per layer**, using plinth's `supportsFor` + `standFor` and the town floor's walk model:
  - every cell has support;
  - every cell has a stand with the eye above the face;
  - every stand is walk-reachable from the apron.
- The plan is **frozen** by version and never re-searched on a visit.

**Completion is role-specific (Codex r1 P2-14), and no cell can block the build forever (r2 P1, both engines).**
Every cell of the open layer ends in one of four states:
- **done:** a skin or stair cell holding cobblestone (or stone_bricks, if Z7), or a core or foundation cell holding the
  planned core material;
- **done-degraded:**
  - a core or foundation cell holding **any full, non-falling solid**, dirt included. That covers what `pillarOut`
    leaves: SCAFFOLD_RANK puts dirt first (toolfor.mjs:368-372, reflex.mjs:3326).
  - a skin or stair cell holding a foreign full solid. It is counted `foreign_skin` in the read and left alone, because
    the monument never digs in v1. A witnessed replace-dig by the monument job only is a later option (Z8).
- **waived:** a cell that, after 3 visits by different bots, still holds a non-full block, or is air that cannot be
  placed. It is recorded in the record's `waived` set and named in the read.
  - Visits where the cell was skipped because an entity stood in it do not count (Claude r3 P3).
  - **Every waived cell is waived only under the cover rule below** (Codex r3 P1, r4 P1).
- **open:** still to do.

**The record** is `monument-<home>.g<N>.json` in `poolStateDir`.
- Fields: `{v, world, home, site, base_y, geom, version, state, layer_open, stuck: {cellKey: visits}, waived: [cellKey], damage: {voids, foreign_skin, repaired}, last_confirmed_at, prev}`.
- Generations are fenced (blueprint §2) and written atomically (temp file, then rename).
- `stuck` and `last_confirmed_at` live **in the record**, so stall timing survives restarts.

**Progress is read from the world.**
- A visit re-derives the remaining cells of the open layer from loaded chunks.
- The job is therefore resumable by construction: a SIGKILL, a restart or a new bot re-derives the same work.

**Frontier layer barrier (Codex r1 P1-5; r2 P1).**
- Only one layer is open per world: the **frontier**.
- Layer k+1 opens when every cell of layer k is done, done-degraded or waived. The record's `layer_open` then advances
  under fencing. **It never moves back down.**
- So construction never has internal steps above 1 and never has unfinished internal walls. An interrupted build leaves
  at most one partial layer, a ±1 step.
- **The cover rule, so no drop deeper than 1 ever persists (Codex r3 P1).**
  - **Every** waived cell at layer k creates a **cover obligation**, whether it holds air or any block without a full
    collision cube (a wall torch has an empty collision box). The obligation is based on footing, not on air vs
    non-air. The cell directly above it in layer k+1 (the **cover**) is placed before every other cell within
    Chebyshev 1 of it in k+1, **except one anchor**.
  - **Why an anchor (Claude r5 P2).** The cover's only possible faces are its four k+1 side neighbours: the waived cell
    below offers no solid face, and the layer-k neighbours are diagonal to it. So exactly **one anchor**, a k+1 side
    neighbour of the cover, is placed first, from a stand with a walk route. The cover is then placed against the
    anchor's side face.
  - **Invariant:**
    - While the anchor stands and the cover does not, the hole is at most 2 deep, and only on the anchor's side. That is
      under the 3-block fall-damage threshold.
    - On every other side the hole is at most 1 deep.
    - No other k+1 cell within Chebyshev 1 is placed until the cover exists.
    - The Paper scene asserts this at every step.
  - If the cover cannot be placed after 3 visits, those cells cannot complete, layer k+1 cannot close, and **the
    frontier stops**. The job is then stalled after 72 h, with the cell named.
  - **Safety wins over progress.** The read names the stall, and the owner decides.
  - A waived cell never counts as footing in the walk model or the plan's stand proof.
  - So the unfinished-step invariant holds with waivers: ±1 everywhere, and ≤ 2 only beside an anchor, while that
    anchor's cover is pending.
  - **Paper scene:** the same coordinate waived in 4 successive layers, once as air and once as stacked wall torches,
    with a bystander. The cover is placed each time,
    or the frontier stops. A drop of 2 appears only beside a pending anchor, and a drop of 3 or more never
    appears.

**Damage below the frontier never blocks the build.**
- It is **reported**: `damage.voids`, `foreign_skin`, missing exposed cells, and gravel or sand left by an escape
  (which can fall and open a void; Claude r3 P3). The census covers closed layers each visit, rate-limited to the open
  layer's neighbours plus one random 8 x 8 patch.
- It is **repaired opportunistically**, only where it is cheap:
  - an **air cell that is exposed** (a stand with the eye above a supporting face is walk-reachable, e.g. the 1x1 hole
    an escape leaves at the top) is re-placed in the same visit, at most 8 per visit, before frontier work;
  - an **enclosed void** (an escape passage sealed over by later layers) is accepted and counted. It is structurally
    harmless, because placed blocks do not fall.

**Segments within the open layer.**
- The layer is split into 4 quadrants, plus one centre segment for the first 10 x 10.
- A builder holds:
  - one **admission slot**: `monument-<home>.slot{0,1,2}.lease.g<N>.json`, at most 3 per world, created exclusively
    with `link()`, 4-min TTL, renewed before each step, carrying the record generation as a fencing token;
  - one **segment lease**, the same protocol.
- A stale owner's next step fails its fence check and stops.
- A slot is reclaimed only after its TTL plus 60 s of clock slack (plinth's rule).
- Builders on adjacent quadrants work their cells farthest from the shared edges first.
- **A cell is never placed while an entity's bounding box touches it or the cell above it** (Claude r1 P2-13). A
  bystander standing in a layer cell is never walled in, because its cell is skipped until it moves.

**Stall and abandon** follow projects §3.2: no confirmed placement for 72 h means stalled, with the reason named. Cells
stuck for 3 visits become **waived**, never skipped silently: the read names each one. The chain test is an escape
column through layers 0..k, then the build reaches k+1 and completes. A waived share above 2% of a layer is a read
defect.

### 3.4 Funding, admission, and the junk well (Codex r1 P1-4, Claude r1 P1-4)

**One pure function decides.** `monumentAdmit(bot, record, now)` returns either `{ admit: true, budget, sources }` or
`{ admit: false, reason }`. It is true only if every condition holds:
- the bot can spend at least 16;
- a slot and a segment are free;
- the cooldown (10 min per bot) has passed;
- the bot-hour budget has room;
- no milestone conversion is ready;
- the bot is not at a full bag with a conversion pending;
- the layer has stands reachable from the bot's walk probe;
- no backoff applies (1 h with nothing open, 30 min after a fault).

**Sources, in order:**
1. Bag cobble above 64 + 1 (keep one pit-cover block, as plinth does).
2. Stone-family above the `guardLeft` reserve.
3. Town chests above a floor of **256**.
   - This draw is meant for after **cobblecap-1000** raises the cap. Today towns sit at 256, so it yields about
     nothing (§1.5).
   - At most 3 × min(64, short) per visit, as plinth does.

**Order position** (cognitive):
- after survival, milestone orders, build_plinth and town_deposit;
- after the town floor while it has fillable targets (Z4).

**The junk well.**
- **Its disposal of cobble and stone-family yields only on a lap where the order actually issued to this bot is the
  monument visit** (Claude r2 P3).
  - `monumentAdmit` is necessary, but not sufficient: a project job may win the lap first.
  - The visit consumes the material.
- In every other case the well behaves exactly as today. A full bag always has an outlet.
- Chain tests:
  - a full bag with a ready conversion → well;
  - an exhausted budget → well;
  - no free slot → well;
  - an unreachable segment → well;
  - a monument visit that fails mid-way → the well's next lap behaves as today.

### 3.5 Building primitive (no digs)

- Plinth's planner over the frozen cells: the projects "generic builder", stage 3.
- Top face first, then side faces, never a bottom face.
- One click per 4 ticks, at most 2 attempts.
- **Every placement is witnessed** by the server's block update (digtown's outcome logic in reverse).
- **No digs**, except clearing vegetation inside the footprint (class free).
- A visit is capped at 32-64 placements and 90 s.

### 3.6 Protection and composition (Codex r1 P1-6, Claude r1 P1-3)

**Monument cells are guarded against TARGET digs only:**
- gather's enumeration filter and `safeTarget`. This is **required**: §1.4's 92 cobblestone target digs show gather
  mining placed cobble.
- `mine`'s per-step bearing check;
- the ore tunnel's profile.

**Transit and survival are left untouched,** the same policy townzone-01 settled on.
- A hard veto on a 48 x 48 solid block creates the trap Claude r1 P1-3 named: a bot in a cave or its own stair **under**
  the footprint has no vertical exit for about 24 blocks.
  - `surface`'s `GoalY` probe (3,000 nodes, skills.mjs:12413) would fail;
  - `pillarOut` digs straight up (reflex.mjs:2950-2953);
  - the reflex's terminal advice asks for a pickaxe the bot already holds (reflex.mjs:2903-2917).
- So escapes and goto's dig retry may cut through the monument.
- **Damage is absorbed, not reworked** (§3.3: the frontier barrier never moves down).
  - An escape column through the structure is mostly refilled by `pillarOut`'s own placements under the climbing bot,
    usually dirt, which core cells accept as done-degraded.
  - The 1x1 hole it leaves at the top is an exposed air cell, which the next visit re-places.
  - Enclosed voids and foreign skin are counted, never chased.
- **The read counts losses by purpose**, so this policy is checked, not assumed.

**Pathfinder.** No break exclusion on the footprint. A place exclusion on stair cells only, so the pathfinder never
scaffolds onto the grand stair.

**Chain tests:**
- a bot entombed under the footprint centre at base−5 and base−20 with 0 scaffold blocks → it gets out (the digs read
  `survival`);
- a bot against the outer wall with only the wall side open → it gets out;
- gather cobblestone beside the monument → 0 monument cells targeted.

### 3.7 Progress you can see

| Where | What |
|---|---|
| The world map | The terrain appears on the BlueMap snapshot render (infra/bluemap). A host-side follow-up writes a static marker per site from the record: name, % complete, open layer. It is read-only. |
| Telemetry | One `_monument` row per visit: placed / confirmed / refused / foreign, layer, segment, funding by source, bag before and after. |
| Scoreboard | A daily line per world: layers done, cells placed today, days to complete at the 7-day pace. |
| Weekly long-run check | "Did it build something from its own materials?" now has a number. |

### 3.8 Canary read (when built; Codex r1 P2-17, Claude r1 P3-18)

**Exposure.** Admitted visits, builder-hours, and cells verified against cells expected in the open layer. Each comes
with the instrument's positive control: the read sees the canary's own placed cells.

**Primary.** A DiD on cobble + stone-family well disposal per bot-hour, which should fall. It is reported alongside
**confirmed placements per pool-hour**: a level, with exposure, not a verdict.

**Gates:**
- **G1 cells lost**, by purpose (target / transit / survival) and canary arm only (the wellread lesson). Unloaded and
  unread cells are reported separately, never counted as kept.
- **G2:** milestone conversions, DiD.
- **G3:** bag-full minutes and tool tosses, DiD. This is the well-skip safety.
- **G4:** a bot stuck within 4 of the footprint for more than 10 min.
- **G5:** deaths, on the two-death floor.

---

## 4. One permanent shared mineshaft per town

This builds on blueprint §7b (designed 10-05, never built). The trap survey of `mine`, the reflexes and the keep-outs
was done 10-15 and is §4.3.

### 4.1 Geometry (Codex r1 P1-7)

**Coordinates.** Shaft-local, with **+z pointing away from home**.

**Core.** Two cells per level, (0,y,0) and (1,y,0).
- **Both are ladder columns** (r3, Codex r2 P2-5). Column 0's ladders hang on its x=−1 wall, column 1's on its x=2
  wall. The home-side wall z=−1 stays free for the collar entry.
- No open drop exists. An entity that moves *into* a ladder has its fall reset. Landing on top of a ladder block is not
  protected, which is why the collar is closed to other routes (T10).

**Lining.** At every non-landing level, the perimeter x ∈ {−1..2}, z ∈ {−1, 1} plus x ∈ {−1, 2} at z=0 must be solid,
full, non-falling and non-liquid. Anything else is replaced with cobble **before** the core cell beside it is opened.

**Collar** (top level c = the ground level at the site):
- The top ladders are at level c−1 in both columns. At level c, cells (0,c,0) and (1,c,0) are open air, with a cobble
  rim at level c on the −x, +x and +z sides.
- The entry pad is (0..1, c, −1), at feet level c, standing on solid ground at c−1.
- A shaft profile steps from the pad into (·,c,0), then moves down into the ladder at c−1 (PF getMoveDown on a
  climbable).
- **The exact entry mechanics are a Paper scene (T7)**, with a 1-block-lower collar as the fallback geometry.
- The open cells (·,c,0) and every ladder cell are under the **T10 step exclusion** for every profile except the
  shaft profiles.

**Landings** every 8 levels, at y_L = c − 8k for k = 1..K while y_L ≥ 16.
- A **terminal landing** is added at max(16, survey stop) when that is more than 3 below the last regular landing.
- **The shaft bottom B is the lowest landing's level**, and both columns end on that landing's floor. For c = 73 the
  landings are 65, 57, 49, 41, 33, 25 and 17, with no terminal, so **B = 17**.
- **Every "y16" in the cut estimate means B.** At B = 17 the difference is at most one block per crossing call (Codex
  r3 P2-5). Residual digging below the shaft is B − y.
- **Portal:** at levels y_L and y_L+1 the lining cells (0,·,1) and (1,·,1) are open. That is a 2-wide, 2-high doorway
  on the +z side.
- **Room:** x −1..2, z 2..4, levels y_L..y_L+1. Its six-sided shell (floor y_L−1, ceiling y_L+2, walls) is lined to
  the same rule as the shaft.
- **Stub:** x 0..1, z 5..8, 2 high, lined the same way. **Its end face at z=9 (x 0..1, levels y_L−2..y_L+1), and every
  cell of `mine`'s first tread from z=8, are NOT reserved** (Claude r3 P2-1b).
  - This is the only place digging continues: by `mine`, the ore tunnel or the iron gather, with their own liquid
    checks.
  - The T3 test covers it: from every stub end, `mine({y: y_L−4})`, gather iron_ore and the tunnel are all admitted.
- One torch per room.
- **The bottom landing's floor is solid.** Both columns end on it. A bot that slides down stands on a proven floor with
  a walk to column 1. A path from a core column, or to a goal outside the envelope and above, plans on `shaft-up`
  (T10).

**Excavation envelope** = core + portals + rooms + stubs. The **survey envelope** is that plus its 1-cell shell, read
before any cell of a level opens.

**Size**, for home.y ≈ 65-75 down to 16:
- about 55 levels;
- core digs ≈ 110, plus 6 landings × (24 room + 16 stub + 4 portal) ≈ 264, so ≈ 370 digs once (≈ 300-400 cobble,
  which feed the lining);
- ≈ 110 ladders (≈ 260 sticks ≈ 33 logs);
- lining placements ≈ 60-200;
- 6-8 torches.

### 4.2 Siting (gate M0, offline)

**The collar is at Chebyshev 17-21 from home.**
- That is outside the zone and the town floor box (16), so the builder's digs are not town-ground target digs.
- It is outside `mine`'s 12-block home refusal (Euclidean, skills.mjs:9836) and the ore tunnel's 12-block `nearHome`,
  so a bot at a landing may mine and tunnel (trap T3).
- It must avoid the plinth stair and ring, the ziggurat apron (≥ 8 away), the tree farm, saplings, chests and water.

**Column choice:** an offline survey of the region copies over the **whole survey envelope**, from the collar to 16.
- It counts liquids, waterlogged blocks, falling blocks and cavities.
- The cleanest candidate wins.
- If liquid crosses the envelope, the bottom is set above it.
- M0 reports the collar, bottom, landings and expected lining placements per world.

### 4.3 Composition with `mine`, the exit contract and the reflexes (traps and fixes)

| # | Finding (file:line) | Fix: deterministic, with a chain test and a Paper scene |
|---|---|---|
| T1 | The entombment reflex treats a ladder overhead as a ceiling (boundingBox 'block'; scaffold.mjs:171, reflex.mjs:3250-3289). In the shaft, its `pillarOut` digs the ladder and plugs the shaft. | (a) The shaft route holds the `'climb'` claim, which already quiets the reflex. (b) `isEntombed` gains a pure `ladderExit(cells)`: a continuous climbable column reaching a landing or the collar is an exit. Chain test: a bot at every depth with every reflex armed → 0 digs, it climbs. |
| T2 | Escape rungs damage the shaft. `dig_down` and `ride_floor_down` break the ladder underfoot. `breach_head_wall`, `escapeStairUp` and `harvestAdjacent` dig the lining. `shaftAscend` digs ladders overhead (escape.mjs:200-215, skills.mjs:12035). | (a) A new rung 0, **`use_ladder`**: when the bot's or an adjacent cell is a verified shaft column, climb it. It costs nothing, so it always wins. (b) structureguard refuses **shaft** cells (core, ladders, lining, portals, rooms, stubs) to every rung. This differs from the monument, because inside the shaft the ladder is always a legal move. Chain test: every rung armed, in the shaft and at each landing; also a bot in a landing room with the portal blocked by another bot → it waits and then climbs, with no dig. |
| T3 | Home-radius dead end: `mine` and the tunnel are refused near home at full depth (skills.mjs:9836, oretunnel.mjs:52). | Collar at ≥ 17. Landings and stubs on +z. Test: from every stub end, `mine({y: y_L − 4})` is admitted. |
| T4 | `mine` ignores structures, and every `mine` counts as `stockpile_stone` (milestones.mjs:58). | The structure guard's per-step check turns the bearing. From a stub end, outward bearings are always free. §5.1 changes the stockpile credit near town only. |
| T5 | The tunnel profile cannot use ladders: MoveDown is off and climbables are vetoed (oretunnel.mjs:59,92,184). | Wanted: the tunnel never routes through the shaft. It starts at the stub end. |
| T6 | **The exit contract gives ladders no credit**, deliberately: "inventory possession is not capability" (ladder.mjs:21-33). | **Credit a physical, verified shaft, never ladders in the bag** (Codex r1 P1-3, Claude r1 P2-9). Below landing L: scaffold debt = max(0, y_L − y) instead of 63 − y. The pickaxe-swing reserve and the health floor are kept unchanged. The credit requires a **zero-break, zero-place** route: a dedicated probe profile with canDig=false, no towers, no scaffolding, no parkour, loaded chunks only. It must lead from the bot's **post-step** position to L: the return from where the step leaves the bot (Codex r2 P1-3). The certificate is the path's node list plus L's column cells. **Only the search is cached**; the certificate is **revalidated before every dig or hop by block reads** of every node's floor and body cells, the portal, both columns from L to the collar, and the collar exit, all loaded and unchanged. A staircase step extends the certificate by its own walk-up move. A failed revalidation re-runs the probe (≤ 2,000 nodes, 1 s), and a failed probe gives today's debt. The 273 `exit_capability_reserve` refusals in W are the population; the shaftuse read reports how many were within the catchment. |
| T7 | Pathfinder climbs and descends ladders (getMoveUp cost 1; getLandingBlock stops on each ladder; PF :462, :536) and never breaks a climbable (:286). A search of mineflayer-pathfinder issues and forums found no known ladder-traversal defect, only an open "climbing vines" request. | Unproven at 55 levels. A Paper scene times a full descent and ascent on both columns, with an interrupt mid-ladder. |
| T8 | Water and lava. | **Build:** survey the envelope before opening; line first; stop above any liquid. **In use:** every lined cell except the stub's end face (shaft, room, stub walls, floor, ceiling) is reserved and never dug, so the only face that can meet liquid later is the stub's continuation, where `mine` and the tunnel run their own liquid checks as today. |
| T9 | A builder mid-level without materials, tools or a way back (Codex r2 P1-4). | **Reserve what the survey counted.** Before a level opens, the builder holds the non-solid cells of that level's whole survey envelope (a landing level's room, stub and portal shell included: up to ≈ 60), 2 ladders + 1 spare, pickaxe durability ≥ the envelope's digs + 10, and a verified ladder column to the collar. Otherwise it ends the visit and climbs. **Safe state after every single mutation:** (1) Lining placements come first; a rejected placement leaves the cell open, but its core neighbour is still sealed. (2) A core cell is dug from the laddered cell above it, and the next mutation is that cell's ladder. If interrupted between the two, the open cell is 1 deep under a ladder, and on resume the builder's first act is to place it: a ladder's collision shape is only a 3/16 plate on the wall, so the builder **centres itself** in the cell and places it there (Claude r3 P3). That placement is part of the Paper scene. (3) Room and stub cells are dug standing on already-lined floor, the retreat is a walk back through the portal to column 1, and each cell's shell is lined before it opens. The Paper scene interrupts at every mutation, including disconnect and a rejected placement. |
| T10 | **Falling into the shaft** (Claude r1 P2-10). Pathfinder marks a ladder safe and physical (movements.js:233-234), so a route across the collar can step onto the top ladder and slide. | A **permanent step exclusion (1000)** on both columns and the open collar cells for every profile except the two shaft profiles. `shaft-down` excludes column 1, and `shaft-up` excludes column 0. That enforces the traffic rule. **r3:** `exclusionAreasStep` is shared by reference across the profiles (index.mjs ~545, ~723), so the shaft profiles get **their own arrays** (a structural test asserts it, and a behaviour test asserts `shaft-down` can enter column 0). **A path plans on `shaft-up` when its start is in a core column, or when its goal lies outside the envelope and above its start** (Claude r2 P2-C, narrowed by r3 P2-1a). So a bot that slid to the bottom climbs out for a tree or an explore with 0 digs. A path that starts in a room or stub and aims at or below the landing (`mine`, the tunnel, an iron gather from the stub end) uses the skill's own profile, **with the column exclusions added**. `use_ladder` (T2) and T6's column check use `shaft-up` too. During the build, the core is excluded for everyone but the builder. |
| T11 | Two bots meeting in a room or portal. | Rooms are 4x3. A bot blocked in a portal for more than 20 s re-plans; T2's chain test covers it. |

### 4.4 Use, which must be deterministic (CLAUDE.md: "advice printed is not advice taken"; Codex r1 P1-2)

**Order of the checks (Codex r2 P1-2, Claude r2 P3).**
1. Validate the intent, using admission's existing target checks (bedrock, above the bot, a pickaxe for > 2 down).
2. Select the effective landing L_req (below).
3. Check the health floor, and the pickaxe reserve **for the residual digs only**.
4. Build the T6 certificate **from L_req**: the return route from the destination, not from here.
5. Travel.

**`mine`'s 12-block home refusal applies to the residual digging, not to the hop.** A hop digs nothing near home. So
the 276 calls refused today as `forbidden` (in W) may become hops: **descents with zero digs. They are new descents,
not a cut**, and the read counts them separately.

**Landing hop (descent).** `mine({y})` goes through the shaft when all of these hold:
- the shaft record has a verified landing below the bot;
- the bot is within 48 (Chebyshev) of the collar;
- the T6 probe reaches the collar (from the surface) or a landing (from underground).

The route takes **the landing L_req = the lowest landing with y_L ≥ y if one exists below the bot; else the next
landing below the bot**. So a step-sized request ("one or two below me") becomes a hop to the next landing, which may
overshoot the request by up to 7. The result detail says so, for example "reached landing y=48 (5 below the
request)".

Then:
1. walk;
2. descend `shaft-down` to L_req;
3. stop at the stub end;
4. if y < y_L_req, cut the residual with the normal staircase, outward bearings only.

**A target below the shaft bottom** gets residual = bottom − y. That part is ordinary `mine` digging, and the cut
estimate credits nothing below 16.

Otherwise `mine` behaves exactly as today. A `_shaft_use` row records: eligible, taken or not with the reason,
landing, overshoot, residual, outcome, time.

**Ascent.** `surface` and goto-home from below home.y − 8 take the legs landing → `shaft-up` → collar when the T6
probe reaches a landing within 400 nodes and the landing is within 48. Otherwise today's code.

**Expected cut, shared pools, W scaled to a day (Codex r1 P2-11, Claude r1 P1-2):**

| Part | Measured basis | Assumption | Cut / day |
|---|---|---|---|
| Descent, surface starts ≤ 48 from home | 465 cobble, all above y16 (0.74k/day) | A **candidate**: all served, if M0's walk to the real collar holds | 0.74k |
| Descent, underground starts ≤ 48, **pro-rated to the part of each call's descent above y16** (Codex r2 P2-6) | 3,716 cobble (5.95k/day) | Served only if on the shaft network. Today these bots descended by their own stairs, so after the shaft, how many start from a landing or reach one by walking is **the unknown**. 0% / 50% / 100%. | 0 / 2.97k / 5.95k |
| Ascent, `surface` near home | 248 net cobble (shared, start ≤ 48, inventory deltas) → 0.4k/day | 50% / 75% / 100% | 0.2k / 0.3k / 0.4k |
| Ascent, goto near home and underground | 1,381 cobble (shared, flush-position proxy) → 2.2k/day | 0% / 30% / 50% | 0 / 0.66k / 1.1k |
| **Total** | | low / central / high | **≈ 0.94k / 4.67k / 8.19k a day** |

That is 3% / 14% / 24% of shared gross (34.5k).

**Watch the iron tunnel.** Hops send every ore tunnel to the stub ends, so `gather:iron_ore` cobble may rise near the
shaft (Claude r2 P3). The shaftuse read reports it beside the iron guard.

These are design bounds. **shaftuse-01 measures adoption and the cut.**
- The distances are from **home**, while the collar is 17-21 from home. A bot ≤ 48 from home is ≤ 69 from the collar,
  so the 48-from-collar rule admits a slightly different set. M0 recomputes this per site.

### 4.5 Building the shaft (the new primitive)

`dig_shaft` works **one level per visit step**:
1. **survey** the envelope;
2. **line** every non-solid shell cell;
3. **dig** the level's cells;
4. **ladder** both columns;
5. **verify** both columns are continuous to the collar;
6. **descend.**

- **Witnessed digs.** A silent or rejected dig stops the level (the ghost-block lesson).
- **A real mutex.** The lease is held together with a host-local lock across each dig (§7b, Codex's coordinator).
- **Reservation.** All envelope cells are reserved from the moment they are planned.
- **Materials.** The builder crafts ladders from its own logs or the chest's (7 sticks → 3). Torches come from stock.

### 4.6 Canaries (two, separate)

**shaft-01 (build only).**
- Exposure: one shaft complete or stopped with a reason, and verified cells against expected cells.
- Gates:
  - 0 envelope cells lost (world read, canary arm only; unread and unloaded cells reported separately);
  - ladder continuity on both columns;
  - 0 open liquid faces (RCON read);
  - 0 deaths in the envelope.

**shaftuse-01** (routing, ascent legs, T1, T2, T6, T10).
- **Exposure / adoption:** eligible calls, routed calls, completed descents and ascents, overshoot distribution.
- **Primary:** mine-attributed cobble per bot-hour, DiD. It is read **with** iron and ore gathered per bot-hour, and
  with `gather:iron_ore` cobble, as guards: a routing failure that stops mining would also "cut cobble" (Codex r1
  P2-17), and the tunnel may dig more from the stub ends.
- **Separately:** hops from calls that would have been `forbidden` (new descents, not a cut).
- **Gates:** deaths on the two-death floor; stuck within 8 of the shaft; `exit_capability_reserve` refusals; falls in
  the shaft.

---

## 5. Rules that avoid digging stone that is not needed

### 5.1 Withdraw before dig (first, cheapest)

**Facts.**
- `stockpile_stone` asks for min(16+8n, 64) of the `COBBLE` family (milestones.mjs:755-765).
- It has **no town-stock check**. Its hint ends "or mine to reach it", and any `mine` serves it (milestones.mjs:58).
- In W, among gather-stone runs with a bag snapshot (898):
  - 841 (94%) began below 64;
  - 255 (28%) were triggered by entombment: a stuck bot gathering scaffold.
- **Shared pools, start ≤ 48 from home, not entombed:** 364 net cobble in the skill rows, ≈ 470 collected (≈ 0.75k a
  day). **Only 111 of the 364 started at the surface** (y ≥ home.y − 8). The other 253 were underground near home
  (near.py; Claude r2 P2-B).

**Town stock (Claude r1 P1-1).**
- Shared towns hold 4,413 cobble. Eight of 12 sit at the cap (248-256), three are above it and one is below (§1.5).
- A withdraw floor of 256 would take nothing. **The floor is 64.**
- Each town then has a ~190 band that **deposits refill**: at the cap, deposits are refused today, and bags above the
  reserve hold 13.5k. So the band is a recurring flow, not a one-time drain.

**Rule.** A pure `stoneSource({bagCobble, townCobble, distHome, need, entombed, withdrawFailedRecently})` returns
withdraw or gather. It is applied **deterministically**: the model proposes gather in 90% of these runs (Claude r1
P2-11).
- **(a)** The rung's own order becomes a town order, `withdraw cobblestone <need>`.
- **(b)** An admission rewrite replaces a model-proposed `gather stone|cobblestone` with `withdraw cobblestone <need>`
  when **all** of these hold:
  - within 48 of home;
  - **and either** at the surface (y ≥ home.y − 8), **or** a zero-dig walk probe (the T6 probe profile, ≤ 2,000 nodes)
    reaches a town chest from here. A bot at depth is never sent up through goto's dig retry, which could dig more
    than the gather would have (Claude r2 P2-B);
  - not entombed;
  - town cobble ≥ need + 64;
  - no withdraw failure in the last 10 min.

  The rewrite is logged.
- **Fallback.** A failed withdraw (empty, unreachable, chest gone) → gather, as today, with a 10-min memory. There is
  no dead end.
- **The hint near home** says to withdraw from the town chest. Outside 48 it keeps "or mine". Removing that globally
  would first need a positive control that gather reaches buried stone from the surface (Claude r1 P2-11).
- **`withdraw` of the COBBLE family counts toward `stockpile_stone`.** `mine` keeps its credit outside 48, and loses
  it within 48.
- r1's "refuse gather when the bag already holds 64" is **dropped**. It was 151 cobble, used a different material
  predicate, and its remedy was not executable (Codex r1 P2-15).

**Expected cut:** the surface population is 111 net ≈ 142 collected, ≈ 0.23k a day. The underground near-home
population adds up to ≈ 0.52k a day, as far as the walk probe admits it. **≈ 0.2-0.75k a day (central ≈ 0.4k =
0.23k + an assumed third of the 0.52k; Claude r3 P3)**,
shared, plus isolated pools wherever their towns hold stock. It is small. Its value is that it is cheap, it drains
chests that refuse deposits, and it stops near-home stone holes.

**Canary:** a DiD on gather-stone cobble per bot-hour within 48.
- Gates: stockpile completion and milestone conversions must not fall; chest withdraw failures.

### 5.2 Transit: instrument, then decide (no cut claimed)

**Facts.**
- goto walks on canDig=false. It digs only in its single "no route on foot" retry on the ascend profile.
- That retry fires when a leg advanced < 2 blocks (skills.mjs:499-540), which can be an **executor** failure as well
  as a search failure (Codex r1 P2-16).
- In W:
  - `_goto_dig_retry` fired 1,311 times (819 success);
  - goto took 4,697 cobble (deltas), of which 3,152 (67%) came with ≥ 128 already in the bag;
  - 88% of goto cobble was collected ≥ 9 below home.y (flush-position proxy).
- Walk-plan failures in W: `_path_noPath` 68,025 and `_path_timeout` 29,422. A `noPath` exhausts only the planner's
  bounded graph: loaded chunks, exclusions and search limits. It is not proof that no walk route exists.

**Step 1 (telemetry only).** `_goto_dig_retry` carries:
- the failing leg's plan status (noPath / timeout / partial), visited nodes, search bounds and profile;
- the executor outcome (advanced, stuck, interrupted);
- bag cobble;
- the retry's digs, with cells.

**Step 2 (only if step 1 shows timeouts or executor failures carrying a material share).** When bag cobble ≥ 128,
re-plan the walk once with a doubled budget, or re-execute the plan, before the dig retry.
- **No dig surcharge.** A surcharge can push moves past pathfinder's 100 prune threshold. The townground amendment
  measured that it removed a 2-high wall move.
- The upper bound is the 3,152 in W (5.0k a day). Nothing is claimed until step 1 reads.

### 5.3 Not touched, on purpose

| Activity | Collected in W | Why it stays |
|---|---|---|
| Survival digs | 1,533 | Needed. |
| Iron gather / ore tunnel | 1,444 | Iron. |
| Gather approaches | 1,839 | They aim at dirt, logs and sand. |

### 5.4 Expected total and its consequence (Z5)

**Expected total (shared):** shaft ≈ 0.94 / 4.67 / 8.19k (low / central / high) + withdraw ≈ 0.23 / 0.4 / 0.75k ≈
**1.2 / 5.1 / 8.9k a day, or 3% / 15% / 26% of shared gross (34.5k)**. Transit is unknown until §5.2 reads.

**The consequence.**
- **Shared net cobble is ≈ 7.4k a day** (pool.py: the 12 shared pools' net in W, scaled).
- At the central cut, net falls toward ≈ 2-4k a day, once part of the cut returns as reserve refills.
- At the high cut, net can reach ≈ 0 in several pools.
- The ziggurat is then funded mainly by the well redirect, stone-family, and the stock that exists today (13.5k in
  bags above the reserve, ≈ 4.4k in chests).
- **That is why S2 comes before S3.**

---

## 6. Staging: what to build first

| Step | What | Depends on | Why this order |
|---|---|---|---|
| S0 | **Offline Z0 + M0**: ziggurat sites (foundation, voids, exposure) and shaft envelope surveys, all 12 shared worlds, read-only | nothing | Says whether each world fits before any code exists |
| S1 | **stonewithdraw-01** (§5.1) + **the goto retry instrument** (§5.2 step 1) | nothing in flight | Small. Removes digs only where the town holds stock. |
| S2 | **monument-01**, the ziggurat, solid by layers (Z1-a) | structureguard-01 (projects stage 2, on minewell-01); the generic builder (stage 3) | Starts while the surplus is largest. Redirects the well. Recommended as the generic builder's first client, ahead of the yard (Z3): one material, no furnaces, no interior. |
| S3 | **shaft-01** (build only), then **shaftuse-01** | structureguard-01; witnessed digs + the mutex (new); S2 under way | The largest cut, plus safety (stair hazards: 233 `hazard_interrupt` in W). Also the most composition risk. |
| later | §5.2 step 2 | step 1 data | Only if it matters |

**Every step gets Paper scenes before the fleet:**

| Step | Paper scenes |
|---|---|
| S1 | withdraw and fallback |
| S2 | walk-on layer fill with 2-3 builders and a bystander; the layer barrier across a kill; the under-footprint escape |
| S3 | T1/T2/T10 chains; a 55-level descent and ascent on both columns; a builder interrupted at every step of a level |

townfloor-01 runs before S2 (Z4).

## 7. Owner decisions

| # | Decision | Recommendation |
|---|---|---|
| **Z1** | Ziggurat form. (a) Solid by layers: 14.7k blocks, ≈ 11-14k of them cobble, proven primitives, no cavity. (b) True hollow: 3,780 blocks, but 2,116 cells over air, needs a new Paper proof of inward roof stands, and the interior is a pit while built. (c) S=4 solid: 11.6k. (d) A smaller base. | **(a).** The owner expected "hollow ≈ 10k". Solid is ≈ 1.5x that, and it is the only form buildable with proven, trap-free primitives. |
| **Z2** | A monument lane outside the projects' WIP=1, sharing their body-time budget, with project jobs first. | Yes |
| **Z3** | The ziggurat as the generic builder's first client, ahead of the yard. | Yes. The alternative is D7's order with the ziggurat after the hall (≈ +9-13 weeks). |
| **Z4** | The town floor takes the surplus before the ziggurat. | Yes. It is finite (≈ 3.3k per town) and repairs the town. |
| **Z5** | Accept that the shaft and the withdraw rule (central ≈ −5.1k a day shared) slow the ziggurat, to ≈ 1-10.5 weeks per world. | Yes, with S1 → S2 → S3. Or hold S3 until the ziggurat's tier 0 is done. |
| Z6 | Setback: S=3 (8 tiers, 16 high) vs S=2 (12 tiers, 24 high, 2-wide terraces) vs S=4. | S=3 |
| Z7 | Use the stone_bricks D8 freed for the top tier and the stair (≈ 130 blocks, ≈ 130 smelts). | Optional, later |
| Z8 | Foreign skin blocks: (a) count and accept them; (b) let the monument job alone do a witnessed replace-dig. | (a) for v1. Revisit with the read's `foreign_skin` count. |

## 8. Review record

- **r1** (Codex CHANGE: 7 P1, 10 P2, 1 P3; Claude CHANGE: 4 P1, 9 P2, 5 P3). Full texts are in
  `ziggurat-mineshaft-reviews-2026-10-15.txt`. Every finding is taken in r2:

  | Finding | Section |
  |---|---|
  | Start-time method, Codex P1-1 / Claude P3-14 | §1.3 recomputed |
  | Shaft eligibility, Codex P1-2 / Claude P1-2 | landing hop, per-call table, low/central/high, §4.4 |
  | Exit credit, Codex P1-3 / Claude P2-9 | zero-break/zero-place probe, landing debt, reserves kept, cached, T6 |
  | Well deadlock, Codex P1-4 / Claude P1-4 | `monumentAdmit`, §3.4 |
  | Concurrency, Codex P1-5 | layer barrier, §3.3 |
  | Remedies, Codex P1-6 / Claude P1-3 | target-only guard plus self-repair, §3.6 |
  | Shaft spec, Codex P1-7 | portals, envelope, interruption states, §4.1, T9 |
  | Withdraw stock, Claude P1-1 | floor 64, journal fold, §5.1 |
  | Pickup position and attribution, P2-8/9 | §1.1 |
  | Sessions, P2-10 | §1.3 |
  | Denominators, P2-11 / Claude P2-12 | shared vs isolated throughout |
  | Funding, P2-12 / Claude P2-7/8 | §2.4, §5.4 |
  | Siting margin, P2-13 | apron ≥ 25, Z0 exposure |
  | Completion and leases, P2-14 | §3.3 |
  | Material predicate, P2-15 | full-bag refusal dropped |
  | Transit, P2-16 | §5.2 |
  | Canary observability, P2-17 / Claude P3-18 | §3.8, §4.6 |
  | Builder side faces and 46², Claude P2-5 | §2.3 |
  | Stone guard, Claude P2-6 | §2.3, §3.4 |
  | Fall in shaft, Claude P2-10 | T10 |
  | Withdraw deterministic, Claude P2-11 | §5.1 |
  | Bystander, Claude P2-13 | §3.3 |
  | OSS search, Claude P2-12 | T7 |
  | Accounting nits, P3 | §1.1 |

- **r2** (Codex CHANGE, 4 P1 + 3 P2 + 1 P3; Claude CHANGE, 1 P1 + 2 P2 + 7 P3). Full texts are in the reviews file.
  Codex marked RESOLVED: r1 P1-1, P1-4, P1-6 and P2-8/9/13/14/15/16/17. Claude marked RESOLVED: all of its r1
  findings. r3 takes in every r2 finding:

  | Finding | Section |
  |---|---|
  | Self-repair stalls the barrier (both P1) | frontier barrier, done-degraded/waived, damage absorbed, §3.3 and §3.6, Z8 |
  | Landing-hop check order (Codex P1-2) | §4.4: intent → landing → health and pickaxe for residual → T6 from the destination → travel; the home refusal applies to residual digs only; `forbidden` hops counted as new descents |
  | T6 cache (Codex P1-3, Claude P3) | only the search is cached; the certificate is revalidated per step by block reads, from the post-step position |
  | Build safe states and reserve (Codex P1-4) | T9: per-mutation safe states; reserve from the survey count |
  | Collar, terminal landing and profiles (Codex P2-5) | ladders on the x walls, collar mechanics plus a Paper fallback, terminal landing rule, shaft profiles for `use_ladder` and T6 |
  | Below-bottom yield (Codex P2-6) | pro-rated above y16 |
  | Arithmetic (Codex P3-7, Claude P3) | 0.94 / 4.67 / 8.19k; totals 1.2 / 5.1 / 8.9k; town list fixed |
  | Withdraw depth (Claude P2-B) | surface-or-probe condition, re-measured |
  | T10 traps other profiles (Claude P2-C) | paths starting in the envelope use `shaft-up`; own exclusion arrays |
  | Well on project laps (Claude P3) | yields only when the monument order is issued |
  | Tunnel at stub ends (Claude P3) | guard in the shaftuse read |
  | Session discontinuities (Codex P2-10) | sessions no longer drive any estimate. Restarts are not split, and the reason is stated here. |
  | Funding as a closed balance (Codex P2-12) | stated as planning ranges, with Z0 reconciliation per world |

- **r3** (Codex CHANGE: 1 new P1 + the P2-5 bottom; Claude **APPROVE**: 1 new P2 + 5 P3). Codex marked RESOLVED:
  its r2 P1-1..P1-4, P2-6, P3-7; r1 P1-2, P1-3, P2-11, P2-12. r4 takes in:

  | Finding | Section |
  |---|---|
  | Waivers let the frontier pass a hole (Codex P1) | cover rule: the cell above a waived air cell goes first, its neighbours wait, otherwise the frontier stops; Paper scene with aligned waivers and a bystander (§3.3) |
  | Terminal landing vs 16 (Codex P2-5) | B = lowest landing; all "y16" means B (§4.1) |
  | Session discontinuities (Codex P2-10) | position-jump split, 10 splits, §1.3 |
  | Stub-end semantics (Claude P2-1) | `shaft-up` only from a core column or for goals above and outside; the end face and the first tread are unreserved (§4.1, T8, T10) |
  | P3s | bystander visits do not count toward waivers; ladder plate centring; withdraw central assumption stated; weeks 3.5 / 10.5; gravel and sand in the census |

- **r4** (Codex CHANGE: one P1 left — non-air, non-full waived cells such as wall torches had no cover obligation;
  RESOLVED: P2-5, r1 P1-7, P2-10, and Claude's stub-end P2). r5: **every** waived cell carries the cover obligation,
  because the rule is about footing. A waived cell is never footing. The Paper scene adds stacked wall torches. The
  stale `shaft-up` sentence in §4.1 is aligned with T10.
- **r5:** Codex **APPROVE** (the r4 P1 resolved, no new P1). Claude **APPROVE**, with one P2: the cover had no face to
  click, so every waiver would have stopped the frontier.
  - r5.1 takes that P2: **one anchor** in k+1, then the cover against it.
  - The invariant becomes ≤ 2 deep beside the anchor only, under the fall threshold. It is stated, and the Paper scene
    asserts it.
  - **Codex r6: APPROVE** (no new P1). Its wording nit, the Paper scene's drop sentence, is fixed.
- **Final:** both engines APPROVE (Codex r5/r6, Claude r3/r5). No disagreement remains. Residuals are assigned to the
  named Paper scenes and to the Z0/M0 offline gates.

## Files

- `docs/reports/ziggurat-mineshaft-2026-10-15.measure.py.txt`: every script named in §1.1.
- `docs/reports/ziggurat-mineshaft-reviews-2026-10-15.txt`: review texts.
- Host scratch `~/zig/` on 10.0.0.31 (stonecause.json, mine.json).
