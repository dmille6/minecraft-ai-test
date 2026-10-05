# Underground safety: evidence and design (Phase 1, 2026-10-05)

Phase 1 only: measurement and design. **No code was changed, nothing was deployed, and nothing was edited in the world or on the sandbox.** Both engines took part: Claude measured the telemetry and read the code; Codex did two independent read-only passes (one before the measurements, one adversarial review after).

## For the owner: the short version

1. **Every drowning in 72 h happened in a sealed water pocket.** That is 109 of the 192 deaths. There were 417 near-drownings in open water and none of them killed a bot. In a sealed pocket, 29% of near-drownings end in death.
2. **The drowning bots had the tools to get out.** 100 of the 109 held a pickaxe, 98 held at least 8 blocks, and 89 carried an empty bucket. All of them died the same way:
   - the air rescue spends about 20 s holding jump toward air that is not there;
   - by then the air is gone in 105 of 108 cases;
   - the escape rung for flooded pockets then refuses with "no air to start with" or "no floor within reach";
   - the bot dies about 100 s after going under, on the 4th rescue attempt in 99 of 109 cases.
3. **The largest single way in is the bot's own escape climb.** When a bot is walled in, it pillars up and breaks the block over its head. **That dig does not check for water at all.**
   - Over 72 h, 117 climbs by bots that were dry before the climb were followed within 20 s by the bot under water.
   - 63 of those became sealed near-drownings, and 30 ended in death. That is **28% of all drownings and 16% of all deaths**, on 22 bots across all 16 pools.
   - It is getting more common as bots mine more: 30, 29, then 58 per day.
   - 3 of the junk-well canary's 4 drownings started this way.
   - The skill version of the same climb has had a water check for weeks. The reflex version never got one.
4. **Recommendation for canary 1:** give the escape climbs the same flood check, with an explicit fallback path the bot can actually perform. It is one variable, and the Paper sandbox can reproduce it deterministically.
5. **The rescue side needs investigation before it can be a canary.** By telemetry, bots live 62–74 s after their air runs out. By vanilla rules they should live about 10 s. Until we know why, nobody should build a rescue that spends that time.
6. **Lava (39 deaths) is mostly deep exploring.** At y < 0 the lava death rate is about 70x the surface rate. That is canary 3, after an investigation.
7. **This cannot be read in 6 h on 10 bots, and the plan says so.**
   - The 6-h read is a harm and instrument check only.
   - The effect read is 20 bots for 24 h.
   - **Stopping rule:** if two canaries in a row reach their exposure and read flat, underground safety stops.

**Why this attempt can converge where earlier ones did not:**
- It does not hunt the long tail of entry routes. It starts from the one state that all 109 drownings passed through.
- It picks the one entry route that is a single, unguarded line of code with a measured rate per climb.
- That rate can be reproduced on Paper and read per event, so it does not depend on rare deaths.
- **What it will not do:** about 70% of drownings come in through gather, goto, falls and other routes, and canary 1 does not touch them. Only the rescue fix (canary 2) can, and its feasibility is unproven.

---

## 1. What was measured

**Window and data.**
- 72 h, 2026-10-02 17:00Z to 2026-10-05 17:15Z.
- 3,598,521 rows from 80 bots.
- Read rotation-aware: day D lives in `skill-*.jsonl-<D+1>.gz`. Files were chosen with `telemetry.open_log` / `predates_window`, which is the same predicate `Events.load` uses.
- Rows deduplicated on (t, bot, kind, detail), then sorted by t.
- 157 event kinds.

**Positive controls.** Each of the sections below has its own. For example: 417 open-water oxygen-critical episodes were found and counted, so "0 open-water deaths" is not an instrument that cannot see open water.

**Exposure.**
- 5,759 bot-hours in total.
- Underground (y < 56): **1,412 bot-hours (24.5%)**.
- Bot-time was carried forward from each row's last known y, with gaps capped at 120 s.

The window spans several canaries: chestfull-01, junkwell-01, chestfull-02 and others. The mechanism findings do not depend on which version a bot ran. The rates are fleet-wide.

### 1.1 Deaths by cause, depth and activity (72 h)

| cause | deaths | where | what the bot was doing (from the `_death` row) |
|---|---:|---|---|
| drowning | **109** | y 55–62: 73, y 40–54: 26, y 0–39: 9, y < 0: 1 | "idle" 101 (the drowning reflex owned the body), gather 4 |
| lava / fire | **39** | y < 0: 12, y 16–39: 7, y 55–62: 8, surface: 7 | idle 37; explore was running in the 30 s before in 17 |
| fall | **36** | 30 of 36 at y < 40 | gather 21, idle 6, explore 4, goto 3 |
| suffocation | 8 | mostly y 55–62 | idle |

**Death rate per 100 bot-hours, by depth:**

| y band | drowning | lava | fall |
|---|---:|---:|---:|
| ≥ 63 (surface) | 0.0 | 0.42 | 0.3 |
| 55–62 | 12.3 | 1.35 | 0 |
| 40–54 | 7.3 | 0.85 | 0.28 |
| 16–39 | 2.9 | 5.0 | 7.9 |
| 0–15 | 8.8 | 3.5 | 14.1 |
| < 0 | 2.5 | **29.6** | **27.2** |

Deep ground (y < 0) is the most dangerous place for lava and falls by a wide margin. Drowning is a shallow-underground problem: flooded caves and pockets just below sea level.

**Milestone at death (drowning).** Unknown 28, gather_iron_ore 23, stockpile_stone 22, stockpile_wood 11, return 11. These are the mining milestones, which is consistent with the junk-well finding that more mining means more exposure.

### 1.2 Near-miss proxies, per 100 underground bot-hours

| proxy | count (72 h) | per 100 ug bot-h | per 10 bots per 6 h |
|---|---:|---:|---:|
| oxygen-critical episodes (rows clustered with 90-s gaps) | 790 | 56.0 | 8.2 |
| … of which sealed (rescue said `sealed`/`unscanned` or a ceiling expired with no air) | 375 | 26.6 | 3.9 |
| … of which fatal | 108 | 7.7 | 1.1 |
| lava danger reflex (`_reflex_danger_block lava`) | 84 | 6.0 | 0.9 |
| underground falls costing ≥ 4 hp / ≥ 10 hp | 505 / 127 | 35.8 / 9.0 | — |
| `_reflex_low_health` at y < 56 | 72 | 5.1 | 0.75 |
| `_lava_corridor` leg refusals (all depths) | 5,287 | — | — |

**Readability (null DiD).**
- Method: 10 random bots against the other 70, 6 h before against 6 h after, 3,000 draws.
- A 50% cut in sealed episodes per underground bot-hour is **0.4 SD** of the null. Oxygen-critical episodes: 0.5 SD. Fatal episodes: 0.3 SD.
- **No outcome proxy is readable on 10 bots in 6 h.** Everything in §4 is designed around that.

## 2. The single mechanism, tested rather than assumed

### 2.1 All drownings are sealed-pocket drownings

| episode class | episodes | fatal | case fatality |
|---|---:|---:|---:|
| oxygen-critical, open water | 417 | **0** | 0% |
| oxygen-critical, sealed | 376 | **109** | 29% |

All 109 drownings were matched to an episode. The pattern inside the fatal episodes is very uniform:
- **Air is already gone at the first rescue ceiling.** In 105 of 108, oxygen was ≤ 0 when the first 20-s rescue ceiling expired (median 31 s after going under). Median health at that point was 19.
- **Death comes 62–74 s after that ceiling** (p10–p90; median 72.5 s).
- **The bot dies on its 4th ceiling** in 99 of 109 cases. Median episode length is 104 s fatal, against 46 s survived.
- **The flooded-pocket rung almost never runs.** It ran in 17 of 109 fatal episodes and succeeded in 0. It ran in 134 of 267 survived ones.

The rung's first refusal in each fatal episode:

| first rung refusal | fatal episodes |
|---|---:|
| "no air to start with" (median health 17.5, **median 51 s left to live**, minimum 10.6 s) | 46 |
| "no floor within reach below" | 32 |
| "no dry opening above the column" | 8 |
| "need N placeable blocks" | 7 |

On "no floor within reach below": I first suspected the rescue's jump-hold lifted the bot off its floor. **That is refuted.** y was unchanged between the first route row and the refusal in 26 of 32 cases. These are simply deep pockets.

**What the bots were carrying when they went under.**
- **Pickaxe with uses left: 100 of 109.** 49 had more than 50 uses.
- **At least 8 placeable blocks: 98 of 109.** 76 had 26 or more.
- **An empty bucket: 89 of 109.**
- Water buckets: 0.
- `scoop=yes` was logged at least once in 19 fatal episodes. It is an observation only: no code path uses the bucket.

**Why the rung cannot run in these pockets, read in the code:**
- The rung was designed for a pocket that has an air cell to breathe from. See `docs/flooded-pocket-rung-design.md` v3, steps 2 and 5.
- `pocketPlan` refuses at oxygen ≤ 0 (`floodpocket.mjs:57`).
- The running rung aborts at oxygen ≤ 6 (`reflex.mjs:4748`, `:4788`).
- The rescue only seizes the body at critical air, which is 5/20. That is already below the abort line.
- So in a pocket with no air at all, the rung cannot run. This holds whether it is dispatched before or after the 20-s ceiling.

### 2.2 How bots get in: the entry routes

For each sealed episode I found the primary tag in the 30 s before the first water row. Priority order: fall ≥ 3 > pillar_out > dig_straight_up > escape dig > mine > ore_tunnel > gather > surface > goto > explore.

| entry | fatal | sealed episodes | case fatality |
|---|---:|---:|---:|
| **pillar_out (escape climb)** | **29** | 57 | **51%** |
| gather | 28 | 136 | 21% |
| goto | 13 | 34 | 38% |
| none / idle | 8 | 14 | 57% |
| fall ≥ 3 | 7 | 15 | 47% |
| explore | 6 | 22 | 27% |
| **mine (stair)** | 6 | 43 | 14% |
| surface | 5 | 19 | 26% |
| dig_straight_up | 3 | 7 | 43% |

**The escape climb is the deadliest entry and the largest single one.** I tested it directly over all 19,401 climbs. A climb here is a run of `pillar_out` / `dig_straight_up` rows less than 15 s apart: 78 bots, 9,204 of the climbs starting at y < 56.
- **117 climbs** (0.6%) were followed within 20 s by a water episode, with the bot **dry in the 60 s before**.
- **63** of those became sealed oxygen-critical episodes, and **30 were fatal (48%)**.
- They are spread across **55 bots and all 16 pools**; the fatal ones were on 22 bots. The busiest single bot had 9, so this is not a chronic-bot artifact.
- Per day: **30, 29, 58**.

**Junk-well canary (10:05–15:13Z), its 6 deaths:**
- 4 drownings. 3 had `pillar_out` in the 30 s before the water, one of them after an 11-block fall. The 4th came from gather.
- All 4 held a pickaxe, blocks and an empty bucket.
- 2 lava deaths: one fell 15 blocks while exploring at y = −55; one was idle at y = −1.

**chestfull-01's board-a-Bravo** died the same way: entombed at y = 45, three `pillar_out` placements, then sealed in liquid at y = 48.

**The code gap (read):**
- **`reflex.mjs` pillarOut has no liquid check at all.** It breaks the head cell (p+2) whenever that cell is not air or water (`:4639`; it is the escape climb used by the entombed handler `:2811` and the marooned handler `:2670`).
- **`digStraightUp` also has no liquid check.** pillarOut falls into it after three stalls (`:4975`).
- **The skill climb is guarded, but incompletely.** `shaftAscend` (`skills.mjs:7853`) is guarded by `overheadBreakRisk` (`scaffold.mjs:216`). That predicate reads the target block and its four sides, but **not the cell above it (p+3)**. Breaking into the bottom of a pocket opens exactly that face.
- **The climb target is planned through water.** `climbNeedAbove` (`reflex.mjs:345`) looks for the first DRY opening and skips water cells on the way.

**Mine (Codex's first pick from reading the code) is small by measurement.**
- `mine` was the primary entry in 6 of 109 fatal episodes, with 14% case fatality.
- Even counting any `mine` run in the prior 5 min, the upper bound is 39 of 109.
- The code gap Codex found is real: headroom and tread side-neighbours are only a tie-break (`skills.mjs:5911`, `:5985`, `:6298`). It is just not where the deaths are.
- The ore tunnel is fully guarded on all six faces (`oretunnel.mjs:66`). Only 1 fatal episode involved it.

### 2.3 Lava and falls (not designed in depth here)

**Lava, 39 deaths.**
- In the 30 s before death: 29 had a `_lava_corridor` leg refusal, 24 a lava danger reflex, 16 an `_explore_blind_step_refused`, and explore was running in 17.
- Only 10 fell ≥ 4 blocks first.
- The pattern is deep exploration beside lava. The corridor guard names the lava, and the bot still ends up in it. In one case the path was ACTIVE when the bot fell 4 into lava (timeline 4 below).
- Mining (mine/ore_tunnel) appears in 2.

**Falls, 36 deaths.**
- All 36 were ≥ 10 blocks, and 30 were at y < 40.
- 21 happened during gather. The gather rows end in "death — but inventory_gain: cobblestone/dirt +N", which points to a digging fall.
- Some are not underground: one was a canopy bot at y = 94.

## 3. Prevention or escape?

| mechanism | deaths (72 h) | avoided by NOT ENTERING | avoided by ESCAPING |
|---|---:|---|---|
| escape climb breaks into water | **30** of 109 drownings | **Yes.** One unguarded dig; the sibling routine already has the guard. | The rescue state below |
| mine stair opens water | 6 (upper bound 39) | Yes (Codex's tread/headroom guard). Small. | Same |
| gather / goto / explore / idle / falls into flooded caves | ~70 | **No single prevention.** The long tail. | **All of them** pass through the same terminal state: sealed, air gone at the first ceiling, pickaxe and blocks held. Feasibility is unproven: 0 of 17 rung runs in fatal episodes succeeded, and the health budget is unexplained (§4.2). |
| lava at depth | 39 | Probably: deep explore against lava the corridor guard already names | A 1–3 s escape; earlier work found it too late |
| falls ≥ 10 | 36 | Probably: digging falls during gather | No |

**What each lever is worth:**
- Prevention removes at most **~30 drownings in 72 h (28% of drownings, 16% of deaths)**. It also removes 63 sealed near-misses.
- Escape could in principle reach all 109, but nothing yet shows it can rescue anyone.
- The order is therefore prevention first: it is cheap, deterministic, and the code fault is certain. Escape follows after the sandbox has answered its open question.

## 4. Design

### 4.1 Canary 1: `climbflood`, a flood check for the escape climbs (one variable)

**The variable.** Every upward escape dig asks one predicate immediately before it breaks a block. The predicate replaces and extends `overheadBreakRisk`, and stays pure and exported.

**What the predicate reads:**
- **The target cell.**
- **The cell above it (p+3), which is new.**
- **The target's four sides.**
- **Water in all its forms:** source or flowing, and waterlogged blocks.
- **Lava: one classifier** covering lava and flowing_lava. This is a Codex finding: `scaffold.mjs:242–252` currently matches `name === 'lava'` only.
- **Unknown cells** count as refusal.
- **Falling blocks:** when the target or p+3 is gravel or sand, also read the cell that will fall in, p+4, and its sides.

**What stays the same:**
- The submerged exemption is kept for water only. A bot whose head and feet are already in water may still dig toward air.
- Lava always refuses.
- Nothing changes for a dry bot whose overhead is dry. That is the regression arm.

**Callers that must all use the predicate.** Codex's second pass found that fixing pillarOut alone leaves bypasses:
1. `pillarOut`'s head dig (`reflex.mjs:4639`);
2. `digStraightUp` (`:4975`), which pillarOut falls into after stalls;
3. the escape ramp's `headroomBreach` digs (`reflex.mjs:4259–4271`). `headroomBreach` ignores water (`scaffold.mjs:684`) and **can return the very ceiling just refused** (`:721`), so "else ramp" would breach the same cell;
4. `shaftAscend`, which gets the p+3 extension for free.

**The refusal chain, with a remedy at every step:**
1. pillarOut / digStraightUp returns a typed result, `flood_risk`, before anything is dug.
2. It must not fall through to the next dig.
3. **Entombed handler.** Today it recognises only `needs_blocks` / `needs_pickaxe` (`:2845`). Unknown results land in the failure counter, and after 4 of those it asks for a pickaxe the bot already holds (`:2747–2780`, Codex). So `flood_risk` gets its own branch, which goes straight to the ramp (`escapeStairUp`). Bearings are still ordered by wetness, and every ramp dig is now under the same predicate.
4. **Marooned handler** (`:2673`). Today it records the result and releases the body. It gets the same branch.
5. **If every ramp bearing is wet:**
   - one `climb_flood_refused` row per back-off, with position and reason;
   - the existing back-off curve;
   - **no** prerequisite request for blocks or a pickaxe, because that would be the wrong remedy;
   - the observation names the move that is still legal: leave the cell sideways or downward (goto/mine away from the water), or wait.
6. **The terminal state is "dry and entombed", not "flooded".** In the trapped-bots analysis, stranded time had a death rate of 0.7x non-stranded time. Codex rightly notes this is confounded, so stranded minutes are a harm line in the read (below), not an assumption.

**Tests: the chain, not the guard.**
- Behaviour tests on the pure predicate, covering every cell it reads, with mutants that assert their anchor is present and unique (`withMutant`).
- Chain tests built from the reflex's own handlers:
  - a refusal never reaches `digStraightUp`;
  - it never reaches a prerequisite request;
  - the ramp never breaches the refused cell;
  - repeated refusals back off rather than spin.
- Registration and wiring tests for each of the 4 callers.

**Paper sandbox scenario.** Run on 10.0.0.30:25599–25602. RCON edits are made only there. Take `/tmp/mcai-sandbox.lock` with `mkdir`, and run at most 2 node processes.
- **Fixture:** a variant of `sandbox/fixtures/synthetic-entombed.json`. A 1x1 stone cell at y ≈ 40: three solid walls, a stone ceiling two above the feet, the open side walled too, so `isEntombed` is true.
- **Kit:** stone pickaxe with ~100 uses, 64 cobblestone, an empty bucket.
- **Arms:** fleet 1918bb5 against the candidate, at least 5 runs each.
- **Read the world back over RCON:**
  - water in the cell;
  - head block;
  - bot y and oxygen;
  - alive at +120 s;
  - the refusal and ramp rows.

| scene | setup | control (expected) | candidate (required) |
|---|---|---|---|
| A, positive control | a 2x2x2 water-source pocket directly above the ceiling block (p+3) | **floods in ≥ 4 of 5** (else the fixture is wrong) | no flood; exits dry by ramp |
| B | water beside the ceiling block | floods | no flood; exits dry |
| C, the dead-end check | A plus every ramp bearing wet | floods | stays dry and alive; one refusal per back-off; no prerequisite request; no spin |
| D | bot already submerged in a flooded shaft, dry above | — | **must still dig up** (the exemption) |
| E | lava above | — | refuses; never digs |
| F, regression | dry geometry | climbs out | climbs out identically |
| G | gravel above the ceiling with water above the gravel | floods | refuses |

**Read plan.** Pools are drawn at random. A 20-bot canary (4 pools) is needed for the effect read; that is still one canary.

- **+6 h: instrument and harm only. No KEEP at this read.**
  - Instrument: guard firings per 100 climb opportunities, broken down by caller and reason. Must be > 0, with a positive control on the control arm's climb rows.
  - Refusal-chain outcomes: out dry by ramp, stayed dry, or later wet.
  - Stranded minutes per bot-hour (≥ 10 min with failure evidence, the trapped-analysis definition), as a DiD.
  - Mining actions and iron per bot-hour, so safety does not come from inactivity.
  - All-cause deaths, under the two-death floor gate.
- **+24 h: effect.**
  - **Metric:** water entry within 5 min of a climb opportunity, bot dry before, per 100 opportunities, as a DiD against control.
  - **Why 5 min and "opportunity":** opportunity means the start of any entombed/marooned escape, including refusals. 5 min rather than 20 s catches a delayed entry by the ramp, which Codex flagged as a false-KEEP route.
  - **Expected:** about 10 control-rate events on 20 bots.
  - **KEEP** requires all of:
    - exposure of ≥ 8 expected events;
    - observed ≤ 2;
    - stranded-minute DiD ≤ +25%;
    - mining throughput DiD ≥ −20%;
    - no death-gate trip.
  - **Not a KEEP threshold:** "zero observed". Zero events carries a Poisson upper bound of about 3 on its own.
  - **If exposure is short at 24 h:** extend once, to 48 h. If it is still short, record INCONCLUSIVE. Under the stopping rule that counts as "not flat", but it still closes the loop.

### 4.2 Canary 2: rescue in a pocket with no air. Sandbox investigation first, not yet a canary.

**What is measured:**
- Air is gone at the first ceiling in 105 of 108 fatal episodes.
- "No air to start with" refused with median health 17.5 and a median 51 s left to live.
- Bots held a pickaxe (100/109), blocks (98/109) and an empty bucket (89/109).

**The contradiction Codex raised, and I agree it blocks the design.** Vanilla drowning damage is 2 HP per second once air reaches −20 (LivingEntity, 20-tick cycle), so 17.5 HP lasts about 9 s. Telemetry shows 62–74 s and a slope of about 0.3 HP/s. Candidate explanations:
- hunger/saturation regeneration;
- auto-eat;
- brief breaths;
- a mis-scaled air reading. The code itself notes the server reports ~400 against an assumed 20.

**A health budget is not spendable until the sandbox reproduces it.**

**Sandbox questions, in order:**
1. In a no-air pocket, with full and with low hunger, how long does a bot live after oxygen reaches 0? Measure server-side health and hunger.
2. Does dispatching the existing rung at the first sealed verdict, instead of after the ceiling, rescue anyone? My prediction is no, because the rescue seizes at air 5 and the rung aborts at 6. That is Codex's least-risky arm, and it must be tested first.
3. Only if (1) shows a real, hunger-independent margin: a breath-hold contract. It would budget the whole sink/dig/place/exit sequence against a conservative damage rate, never against the observed slope, and re-check live.
4. A bucket scoop of the head cell where `scoop=yes` (19 fatal episodes). This is an air-only reflex, consistent with the owner rule.

**Readability.** Sealed episodes run at about 3.9 per 10 bots per 6 h. The outcome is case fatality per sealed episode, which needs about 30 or more canary episodes: 20 bots for roughly 36 h. Sandbox results carry the effect claim; the fleet carries harm.

### 4.3 Canary 3: lava at depth. Investigation.

- At y < 0, lava kills at 29.6 per 100 bot-hours, against 0.4 at the surface.
- 29 of 39 lava deaths had a `_lava_corridor` refusal in the 30 s before. Explore was running in 17.
- The question is how a bot ends up in lava that the guard has already named. Candidate routes:
  - the path executing a leg that was refused afterwards;
  - `block_updated` resets;
  - explore's fallback.
- Earlier lava work (`lava-guards-canary`) found the refusal itself feeding a blind walk. Replay death sites on the sandbox before designing anything.

## 5. Both engines: where they agree and where they differ

| point | Claude (measured) | Codex | resolution |
|---|---|---|---|
| Canary 1 | escape-climb flood check | Pass 1, from reading the code: the `mine` stair tread/headroom guard. **Pass 2, after the measurements: AGREE** with escape-climb first | A measured run beats a reading. Mine is the primary entry in 6 of 109 fatal (upper bound 39), against 29 + 3 for the climbs. The mine guard stays a valid small follow-up. |
| Rescue dead end | real; air gone at the first ceiling in 105/108 | real; earlier dispatch alone is useless because of the oxygen ≤ 6 abort | **Agree.** Canary 2 is sandbox-first. |
| Health budget | measured 62–74 s | vanilla ~9 s; do not spend the observed slope | **Agree.** It blocks canary 2 until explained. |
| Refusal chain | sidestep → ramp → stay dry | the ramp (`headroomBreach`) can re-breach the refused cell; unknown results fall into a pickaxe request; marooned silently drops it; digStraightUp bypasses | **Codex's findings adopted.** They define the 4 callers and the 2 explicit branches in §4.1. |
| Predicate scope | add p+3 | add p+3, waterlogged, flowing_lava (one classifier), unknown = refuse, falling blocks (p+4) | **Adopted.** |
| Read | 6 h harm, 24 h effect | the same; 5 events cannot certify 50%; count opportunities, not suppressed rows; use a delayed-entry window | **Adopted:** 20 bots, an opportunity denominator, a 5-min window. |
| "Stranding is safe" | 0.7x death rate | confounded; not proof | **Adopted** as a measured harm line, not a premise. |

## 6. Ranked plan and stopping rule

1. **climbflood-01**, as in §4.1. Build, Codex review and Paper scenes A–G first. Then a 20-bot canary: 6-h harm read, 24-h effect read.
2. **Rescue sandbox investigation**, as in §4.2 questions 1–2. It can run on the sandbox while canary 1 is live, because it touches no fleet code. A canary follows only if a rescue arm works on Paper.
3. **Lava-at-depth investigation**, as in §4.3. The mine tread guard (Codex) is held in reserve.

**Stopping rule:**
- A canary is **flat** if it reached its preregistered exposure and the effect DiD shows less than a 50% reduction, or crosses zero.
- **Two flat canaries in a row stop the underground-safety thread.** Deaths go back to being harm lines only, and the queue resumes with the junk well.
- An INCONCLUSIVE for lack of exposure gets one extension, is then recorded, and does not count as flat.
- **No new analysis starts while a canary is unread** (CLAUDE.md).

## 7. Example timelines (real rows; t = 0 is the first water row unless stated)

1. **Escape climb into water. placebo-d-Comet, 10-04 20:10Z, y = 5.**
   - Before going under:
     - −46 s: `goto aborted: entombed`;
     - −22 s: `_entombed` "walled in at y=5";
     - −15 s and −0.6 s: `pillar_out` placements.
   - The rescue fails:
     - 0 s: head in water at y = 7 (it rose 2);
     - +10 s: oxygen critical, route `unscanned dist=-1 scoop=no`;
     - ceilings at +31 s, +51 s (hp 18.5), +72 s (hp 10.2, rung "no air to start with") and +93 s (hp 3.2).
   - **Died at +102 s**, holding a pickaxe with 35 uses, 486 blocks and a bucket.
2. **Same mechanism, chestfull-01. board-a-Bravo, 10-05 03:08Z, y = 48.**
   - −125 s: `_entombed` at y = 45, then three `pillar_out` placements.
   - −103 s: `sealed_in_liquid`.
   - Then four ceilings (oxygen −1 → 0), and at −31 s the rung refused "no air to start with".
   - Died. Source: `chestfull-01-revert-evidence.txt`.
3. **Long-tail entry, not a climb. isolated-a-Alpha, 10-03 12:47Z.**
   - −20 s: explore heading for iron at y = 54.
   - −4.7 s: path ACTIVE, fell 11 to y = 41.
   - 0 s: afloat in a flooded cave at y = 46.
   - Sealed, died. Canary 1 would not touch this; only the rescue could.
4. **Lava at depth. placebo-a-Bravo, 10-05 02:22Z, y = −18.**
   - −15 s: explore toward iron.
   - −5.5 s: `_lava_corridor` "lava beside 398,−17,−321 … leg refused".
   - −3 s: blind step refused for the same lava.
   - 0 s: "death (fire): fell 4; path ACTIVE …".
5. **Fall during gather. board-d-Delta, 10-05 11:02Z.**
   - Marooned in a canopy at y = 94: ramp, underfoot and scaffold all refused.
   - Then a gather walk fell 23. Not underground. Shown so falls are not all read as mining.

## 8. What this does not show

- **Which block let the water in.** No row records the broken block. The climb attribution is "dry in the 60 s before, a climb, then under water within 20 s", which is observational. The Paper scenes A–B are what turn it into a mechanism.
- **That the bots could have escaped the other ~70 pockets.** No world check was done. The rung succeeded in 0 of 17 fatal runs.
- **Why bots survive 62–74 s without air.**
- **Lava and fall mechanisms.** Only described here.
- **Pool or version effects.** The window mixes canary versions. Rates are fleet-wide.

## 9. Reproduce

On mike@10.0.0.31, `/tmp/ugsafe/`:

| script | what it does |
|---|---|
| `extract.py <since> <until> rows72.pkl` | streaming, rotation-aware, deduplicated, sorted extract (19-field tuples) |
| `common.py` | shared loaders |
| `a1.py` | kind catalog (positive control) |
| `a2.py` | deaths by cause, depth, activity and milestone |
| `a3.py` | detail-pattern census |
| `a4.py` | water episodes; writes `eps.pkl` |
| `a5.py`, `a7.py`, `a9.py` | inside sealed episodes: rung, oxygen, first route |
| `a6.py`, `a13.py` | timelines |
| `a8.py` | health budget; lava and fall lead-ups |
| `a10.py` | exposure, proxies, null DiD |
| `a11.py` | entry classification |
| `a12.py` | climb → water breaches |
| `a14.py` | junk-well deaths |
| `a15.py` | fall proxy |

Codex outputs are in the session scratchpad: `codex-out.txt` (pass 1) and `codex-out2.txt` (pass 2).
