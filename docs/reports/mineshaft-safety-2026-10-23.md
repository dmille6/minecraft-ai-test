# Mineshaft safety: lava and entombment underground, then diamonds and enchanting (2026-10-23, measurement + design, r9)

OWNER 2026-10-23 ~12:40Z: "mineshaft safety (lava + entombment underground) -> diamonds -> enchanting". Earlier
owner decision (10-19): "diamond after mineshaft safety". The owner answered M7-M10 at ~13:30Z (section 8).

**This is design only.** No bot code, fleet, queue, world or sandbox was changed, and RCON was not used.

**Scope.** The 09-30 rule against open-ended stuck/drowning hunts applies. The scope is underground mining safety for
the diamond tier. Every fix below is either on a mining path, or on the reflex that decides whether a bot standing
beside lava lives.

**Base.** Fleet `6e1afb52` (poolescape-01), origin/main `2baad53c`. indexsearch-01 was deployed on board-a and
placebo-a at 12:17Z, during this measurement. Its read belongs to the operator loop, and this document starts no
canary. The 7-day window does include those two pools, and their last 2 h of rows ran the canary build. indexsearch
changes a town-index search and touches no movement or mining path. That is a judgement, not a measured exclusion.

**r9** takes in the r8 reviews. Both raised a P1 on the same thing: the wait on a protected peer could be unbounded,
when the peer disconnects or keeps working.
- **One deep miner underground per town at a time.** There are still at most 2 leases (M8), so two miners can share
  the job, but only one is ever below the stair top. A second miner is admitted to descend only after the first is
  `out`.
- That removes peer coordination, peer waits and peer traffic completely. Four review rounds kept finding new dead ends
  in them.
- Concurrent underground miners become owner question O13, for a later design.

**r8** took in the r7 reviews. Codex APPROVE (two P2); Claude CHANGE (one P1: two `uncertified` miners could block
each other).
- Coordination now protects only a **certified** peer's footprint, using a fresh, timestamped position file.
- An `uncertified` peer is protected in its body cells only.
- No-plan waits are bounded by the peer's own clock.
- Traffic between the two miners no longer triggers a handover.
- The handover walk is bounded.
- The reload diff covers the whole protected footprint at block-name detail.

**r7** took in the r6 reviews. Codex returned no P1 (two P2, one P3); Claude returned one P1.
- `stairReturn` that makes no progress hands over, even without a break.
- An `uncertified` bot keeps the evacuation profile and walks any valid route first.
- Its kit is stated against today's contract.
- The active leaseholder's branch cuts and ore digs are authorized in the guard and in G6.
- Exit mutations are coordinated with the second miner.
- The stale refusal-chain summary is replaced.

**r6** took in the r5 reviews (Codex 1 P1 and Claude 1 P1, the same finding).
- **One universal handover:** every route-recovery failure, including a branch that cannot be re-cut and both lanes
  broken, ends credit and confinement. The bot goes `uncertified` and today's exit chain runs. The shell guard is
  lifted for that bot's own exit.
- O11 and O12 merge into one residual: today's chain giving up.
- G6 observes at `_genericPlace` and through `blockUpdate`.
- The cache has its own gate.
- `danger_stuck` is keyed by cell and block name.
- `uncertified` is not a leaseholder anywhere.

**r5** took in the r4 reviews (Codex: 3 P1, Claude: 1 P1).
- A failed route recovery now ends the credit and the confinement, and today's exit chain runs.
- `use_stair` runs only where a verified connection exists.
- Branches carry a re-cut reserve instead of zero debt.
- `corridorSafe`'s cache is invalidated by block updates over its full read footprint.
- A mutation observer feeds G6.
- An enclosed unsealable floor hands over after three firings that do not move the bot.
- F1's composition table is corrected.

**r4** took in the r3 reviews: Codex CHANGE (6 P1), Claude CHANGE (1 P1).
- F1 owns the body: a priority runner reservation, a generation token, and air preemption.
- F6's envelope refuses every mutation, survival included, with a `use_stair` rung.
- Stair and branch clearance rules are separated.
- The top must be the surface.
- A leaseholder is confined to its route.
- No 24-hour out-marking.
- The certificate rows carry per-cell observations.

**r3** took in the r2 reviews: Codex CHANGE (8 P1), Claude CHANGE (5 P1).
- F1 gains an in-flight body flag, exhaustive cases, executable steps and a seal for replaceable cells only.
- F2 moves to the arm, is throttled, and needs an open component.
- F4 requires reversible steps.
- F6 becomes the town's two-lane, reserved, lined deep stair, for leaseholders only.
- The lease separates work expiry from evacuation and drops the stair mutex.
- Every gated action logs its own inputs.
- Measurements use event-row timing.

**r2** took in the r1 reviews. Codex returned CHANGE with 11 P1; Claude returned CHANGE with 6 P1. Section 13 has the
record. The main changes:
- F1 is now a bounded, verified move sequence with no trail and no open-ended hold.
- F2 compares against the bot's own recent free cell instead of a room-size rule.
- F4 never opens a cell into lava it cannot see. It has a deterministic in-call return.
- F6 prices the climb above the certificate, keeps a swing floor, uses a zero-break, zero-place profile, and credits
  depth below y=0 only to a deep-miner lease (M8).
- F5 is split: the explore target filter moves early; routing exclusion comes last and has egress rules.
- Every gate now names the row fields it is computed from.
- The measurements were re-run with cell-matched warnings, interval overlap, episode-end censoring, pre-death depth
  binning and per-bot base rates.

---

## 0. Answers first

1. **Lava deaths are not mining deaths.** There were 84 fire deaths in 7 days, and every one was lava or magma.
   - **Warned beforehand.** In 80 of the 84, a guard of the bot's own refused a route or step naming lava more than
     3 s before death. In 65 the named cell was within 3 blocks of where it died; in 44 of those, 10 s or more before.
   - **Idle at death.** 81 were "idle at the moment of death": between skills, after a movement skill was refused or
     aborted beside the lava.
   - **Not digging.** 1 died while `mine` was running. 16 had a mine or gather executing in the last 30 s. The context
     is 150 s, so that is a lower bound on dig exposure, not a cap.
   - **The danger reflex's blind sprint.** 67 of the 84 deaths came during or within 20 s of a danger-block episode,
     which is the reflex that calls `escape()`. `escape()` is a blind 1.5 s sprint-jump forward, in whatever
     direction the bot faces (reflex.mjs:5948).
   - **How often episodes kill.** An episode that starts with dry feet over a DANGER block below ended in a lava death
     31 times out of 303 (10%). One that starts with the feet already in lava did so 32 times out of 74 (43%).
     Episodes split at deaths.
   - **The claim is association, not proof** that the sprint is the killer. Fix F1 replaces it with a verified move.
2. **"Entombed" fires on ordinary dug geometry, at a large cost.** There were 87,090 `_entombed` rows in 7 days, on
   all 80 bots.
   - **The predicate misfires.** A behavioural probe of `isEntombed` returns **true** for:
     - the dead end of a 1x2 tunnel open behind it;
     - the tread of a 2-high stair (not `mine`'s own 3-high stair);
     - an alcove off a corridor.
   - **What it costs.** 78% of the 61,538 episodes are a single firing. The escapes placed about 105k blocks, 74,678
     of them dirt, and 56,873 running skills were interrupted.
   - **Share not measured.** How many of the 87k firings are such geometry is not measured. F2's read measures it.
   - **Gravel and sand are invisible.** No row sees a falling block.
   - **All 17 suffocation deaths had an entombed episode in the 10 min before.** The dead bots' own rates predict 8.7
     (P ≈ 1e-5 under independence). 10 of the 17 rose 3 or more blocks across those rows. Fix F3 investigates this
     before building anything.
3. **Nothing asks bots to go deep, and the exit contract refuses the ones that try.**
   - **How shallow.** 2.3% of bot-time is below y=0, by the event-weighted bucket proxy. There are 0 diamonds in the 80
     bags.
   - **Rarely asked.** Only 4.3% of `mine` calls (2,765 of 63,599) target below y=0, and the exit contract refuses 34%
     of those.
   - **Swings bind, not blocks.** Pickaxe swings decide 3,008 of the 3,209 refusals, not scaffold.
   - **The contract assumes digging home.** It prices the climb home as a fresh dig (debt = 63 − y), even with the
     bot's own walkable stair behind it.
   - **No diamond goal.** There is no diamond rung.
4. **Deep is lethal per hour.** The bottom band, y −64..−33, has 39 bot-h of exposure.
   - **The rate.** It holds 15 deaths by death position (14 of them lava), or 9 by the bot's event-row position 30-60 s
     before death (all 9 lava). That is 23-39 deaths per 100 bot-h, against about 1 at the surface.
   - **Caveat.** The exposure proxy is coarse, and one world (placebo-a) holds 10 of the 15.
   - **The consequence.** The diamond tier waits for F1 and F4, and it ships with F6. M8's cap of one or two deep
     miners per town is the right bound on exposure.
5. **The safe descent built here follows M7 and M9.**
   - **The stair.** A 1-wide, 3-high staircase. Before every dig, placement and move, every opened cell has all six
     faces read, and the cells beyond any open face. Unknown counts as unsafe.
   - **Lava.** Lava visible from an open cell is sealed with a placed, server-witnessed block. Lava hidden behind
     unopened stone is never opened into; the stair turns or stops. There are no water buckets.
   - **The way home.** It is one town stair: two lanes, lined and reserved like the shaft. It is certified as the
     walkable way home, and the exit contract credits it only for a deep-miner leaseholder.
   - **Branches.** Branch tunnels run at feet y=−53, above the generated lava band.

**Ordered fixes:**

| Order | Fix | What it is | Tier |
|---|---|---|---|
| 1 | F1 `lavastep-01` | the danger arm makes a verified, bounded move instead of a blind sprint | 2 candidate (after Paper) |
| 2 | F2 `tombexit-01` | entombed only if the bot's recent free cell is not reachable on foot | 2 candidate (after Paper) |
| 3 | F5a `lavatarget-01` | explore-toward-known skips iron targets beside lava the bot has seen | 2 candidate |
| 4 | F4 `minelava-01` | `mine` reads six faces, seals visible lava, never opens into hidden lava, no blind push, deterministic in-call return | 3 |
| 5 | F5b `lavasight-01` | per-world lava memory in routing, with egress rules | 3 |
| 6 | F6 `deepstair-01` + `deepminer-01` | the town's two-lane reserved deep stair, its certificate and credit, and the deep-miner job | 3 |
| — | F3 `inwall-01` | Paper investigation only, until a mechanism is shown | — |

Then `diamond-01` (banking and pickaxes), then `enchant-01`.

---

## 1. Window, sources, positive controls

**ES window.**
- 7 days: 2026-10-16 14:00Z → 10-23 14:00Z.
- 10,502,877 skill documents; 80 bots; 13,440.0 bot-h. There are no empty hours or 10-minute gaps (`coverage()`).
- The window does not touch 10-07.
- Caveats carried: 7 rotations (~40-60 rows each), the 10-19 flood backfill, and "after 10-14 assumed".

**Instruments.**
- `lib/estelemetry.py` (host copy md5 c3444ffe = repo).
- Per-death context: every skill row of the dead bot in [t−150 s, t+5 s], and its llm rows in [t−30 min, t].
- Scripts are listed in section 14. The JSON inputs are not committed (6-120 MB). The scripts regenerate them from ES.

**Positive controls.**
- `_death`: 276 in all — drowning 91, fire 84, fall 46, other 38, suffocation 17. This re-measures the brief's 273
  (94 / 81 / 47 / 34 / 17); the window is shifted by a few hours.
- Last 24 h: fire 14, other 8, drowning 7, fall 6, suffocation 3.
- Lava rows: `_lava_corridor` 14,107; `_reflex_danger_block` 811; `_lava_adjacent_no_retreat` 666;
  `_lava_adjacent_stand_off` 114.
- Entombment rows: `_entombed` 87,090; `_entombed_unrecoverable` 8,478.
- Triggers: `trigger=interrupt:entombed` 56,873; `trigger=llm:entombed` 29,850.
- Every zero below has a non-zero beside it from the same query.

**Denominators.**
- **Depth exposure:** (bot, 10-minute bucket) cells binned by the bucket's average `bot.pos.y`. The average is over
  rows, not time. 80,631 cells = 13,438 bot-h.
- **Milestone exposure:** llm decisions by `messages.milestone`, 832,539 in all. These are decisions, not bot-time.

---

## 2. Lava and fire deaths (question 1)

### 2.1 What they are

All 84 `fire` deaths are lava, by the explicit message tally in `d8.py` (ten categories plus UNKNOWN; UNKNOWN = 0):
- "tried to swim in lava": 48;
- "... after falling N blocks": 32, falls of 4-29 blocks, median 6;
- "discovered the floor was lava" (magma): 4.

Positive control: the same tally finds 91 "drowned", 46 "fell from a high place", 32 stalagmite, 17 "suffocated in a
wall", 5 stalactite and 1 "doomed to fall". No other fire message ("burned", "walked into fire", "went up in flames")
occurs in the 276.

### 2.2 Depth, skill, and what the bot did in the last 60 s

**Deaths by height** (y band at death):

| y band | lava | lava after a fall | magma |
|---|---|---|---|
| ≥ 64 | 22 | 2 | 0 |
| 48..63 | 4 | 2 | 4 |
| 32..47 | 10 | 18 | 0 |
| 16..31 | 1 | 2 | 0 |
| 0..15 | 1 | 1 | 0 |
| −16..−1 | 2 | 0 | 0 |
| −32..−17 | 1 | 0 | 0 |
| −48..−33 | 3 | 1 | 0 |
| −64..−49 | 4 | 6 | 0 |

**What the bot was doing.**
- Skill at the moment of death, from the `_death` detail: idle 81, explore 2, mine 1.
- Last completed skill:

  | Skill | Deaths | Breakdown |
  |---|---|---|
  | explore | 46 | aborted 34, success 10, no_effect 2 |
  | keepout_exit | 15 | success 11, aborted 3, no_effect 1 |
  | gather | 12 | |
  | mine | 5 | |
  | goto | 4 | |
  | surface | 2 | |

**Rows present in the dead bot's last 60 s** (90 s for explore-toward):

| Row | Deaths with it |
|---|---|
| `_lava_corridor` | 81 |
| `_reflex_danger_block` | 67 |
| `_explore_toward_known` (≤ 90 s) | 61 |
| `_explore_blind_step_refused` | 54 |
| `_fall_path` | 35 |
| `_lava_adjacent_no_retreat` | 14 |

### 2.3 Warned beforehand, or exposed by the bot's own dig? (`d7.py`)

**What counts as a warning.** A `_lava_corridor`, `_explore_blind_step_refused` or `_lava_adjacent_no_retreat` row that
names lava, more than 3 s before the death. `_reflex_danger_block` rows are excluded, because they mean the bot was
already in lava or over it. "Cell-matched" means the row's `at x,y,z` lies within 3 blocks horizontally and 4
vertically of the death position.

| Warning | ≥ 10 s before | 3-10 s before | none |
|---|---|---|---|
| any lava cell | 60 | 20 | 4 |
| cell-matched | **44** | 21 | 19 |

**Warnings 3-10 s before may already be too late.** Some may be refusals planned from a bot already in lava, since
lava takes a few seconds to kill. The robust number is **44 cell-matched warnings at least 10 s before**.

**Digging.**
- A `mine` or `gather` was executing (interval overlap) in the last 30 s, or was running at death, in **16** cases.
- The context is only 150 s, so a skill that started earlier and ended inside the 30 s is missed. **16 is a lower
  bound.**
- The death row itself names `mine` once and `gather` never.

This agrees with phase 2 on 10-07: 30 of 59 deaths "walked in after a warning", and at most 2 dug in.

### 2.4 The danger reflex, and what it is associated with

**`escape()`** (reflex.mjs:5948-5953) is literally:

```js
bot.setControlState('sprint', true); bot.setControlState('forward', true); bot.setControlState('jump', true)
await sleep(1500); bot.clearControlStates()
```

**When it fires.** The danger arm (2541-2559) fires every 2.5 s while the feet cell OR the cell below is in
`DANGER_BLOCKS`: lava, fire, campfire, soul_fire, magma. Each firing interrupts the runner. The row logs
`feet?.name ?? below?.name`.

**Reading the row's detail:**
- `air` / `cave_air` means the feet were clear and the cell below was a DANGER block. The block can be lava, magma or
  fire; the row does not say which.
- `bubble_column` is the feet cell, with magma below.
- The detail does not say whether the bot was on the ground or in the air.

**Episodes.** An episode is a run of rows on one bot no more than 30 s apart, split at **any** death (`d8.py`). A death
counts against an episode if it falls between the episode's first row and 20 s after its last. An episode whose last
row + 20 s runs past the window's end is right-censored and dropped. There were 0 such episodes. Attribution stops at
the first death of any class after the episode starts, so a later life's death is never credited to an earlier
episode. The counts come out the same under every variant tried: splitting at every death or at lava deaths only,
with attribution bounded or not.

| First row | Episodes | Lava death in the episode window |
|---|---|---|
| feet `air`/`cave_air` (DANGER below) | 303 | **31 (10%)** |
| feet `bubble_column` (magma below) | 45 | 4 |
| feet already in a DANGER block | 74 | **32 (43%)** |
| any other feet name | 0 | — |

- 67 distinct lava deaths fall inside an episode window.
- Health at the first row was ≥ 16 in 59 of the 63 fatal `air`/`lava` episodes. These are event rows.
- Of the 32 falls into lava, `_fall_path` saw no active path in 16, an active path in 7, and could not tell in 9.

**A typical timeline** (isolated-b-Bravo, 10-17 06:46Z):
1. explore is aborted at `danger_block`;
2. 13 blind-step refusals: "lava below at 384,70,106";
3. at −6.4 s, `danger_block cave_air` twice, hp 16;
4. at −1.4 s, `danger_block lava`, hp 6;
5. death.

**What this shows.**
- The danger arm's only movement is a sprint in the facing direction. A bot that faces the lava it was walking toward
  is sprinted into it.
- The deaths cluster in these episodes.

**What it does not show.**
- That the sprint caused them. A bot over lava is in danger whatever it does, and the rows record neither controls
  nor yaw.
- The effect evidence must come from Paper (F1).

**The idle stand-off.** `lavaStandOff` is the verified one-step retreat. It runs only when no skill has ended in the
last 20 s (reflex.mjs:2519), but these episodes start 3-10 s after an abort, so it rarely gets to run. In 7 days it
fired 114 times, with 1 fire death within 20 s. "No verified retreat" fired 666 times, with 9.

### 2.5 Milestone, not pool

The milestone is the one in force at the bot's last llm decision. The decision share is used as a proxy for
exposure.

| Milestone | Lava deaths (of 84) | Share of decisions | Ratio |
|---|---|---|---|
| patrol | 33 (39%) | 15.0% | **2.6x** |
| gather_dirt_16 | 30 (36%) | 29.4% | 1.2x |
| gather_iron_ore_3 | 9 (11%) | 9.9% | 1.1x |
| gather_sand_8 | 5 (6%) | 13.3% | 0.45x |
| return | 2 (2%) | 17.8% | 0.13x |

**Patrol is movement, and the fleet's movement is explore aimed at iron.**
- All 141,921 `_explore_toward_known` rows head for `iron_ore`. Against 142,886 `explore` skill rows, nearly every
  explore is steered at a known iron block, often one in a cave wall beside a lava lake.
- An `_explore_toward_known` row came within 90 s before 61 of the 84 deaths.

### 2.6 Where: two seed-level hot spots, and keepout

Many worlds share a seed, and the home sits at about (356, 73, 148) in each. Two 12-block cells hold 32 of the 84
lava deaths:

| Cell | Deaths | What it is |
|---|---|---|
| (336, 36, 204) | 18 | a cave lava lake about 60 blocks from home |
| (396, 72, 108) | 14 | a surface pool about 45 blocks from home |

48 of the 84 died within 64 blocks of that home.

**Keepout cannot reach most of these.**
- 78 of the 84 were the first fire death recorded at their site in their world (sites merge within 3 blocks).
- 15 had just run `keepout_exit`, so an earlier fire site's column was live nearby.
- keepout-01 acts after a death, in one world, and only on digs. It blocks no walk.

### 2.7 `mine` and lava today

- **Mine meets lava rarely.** In 7 days `hazard_interrupt` stopped mine 3,862 times; 3,858 were water and **4 were
  lava**.
- **Gaps that will matter at diamond depth** (section 9):
  - **Lava under the next tread is invisible to the fall probe.** The probe counts lava's empty bounding box as
    "hollow", and refuses only at ≥ 3 hollow with a drop it judges unsurvivable (skills.mjs:12931-12951).
  - **Lava beside the head or feet cell is never read.** Only the ceiling cell's five neighbours are (12957-12967).
  - **`stairLiquid`** (13263) does not match magma or fire. Flowing lava is still named `lava`, so that case is
    covered.
  - **Unknown cells pass.**
  - **Nothing seals.** `mine()` places nothing (mining.mjs:97-104).
  - **The step-recovery push is blind** (13146-13181). isolated-d-Echo, 10-16 18:36Z: `_mine_stair_step_failed` →
    `_reflex_danger_block lava` → death.

---

## 3. Depth: exposure and death rate

Deaths are binned two ways against the same exposure:
- by the death position;
- by the bot's position 30-60 s before death (pre-death; `d7.py`). This uses **event rows only**, because a skill row
  is stamped at its start but carries its end snapshot.

The exposure is the event-weighted 10-minute bucket proxy from section 1.

| y band | bot-h | deaths (at death) | per 100 bot-h | deaths (pre-death y) | per 100 bot-h | lava (pre-death) |
|---|---:|---:|---:|---:|---:|---:|
| ≥ 64 | 3,699 | 34 | 0.92 | 37 | 1.00 | 24 |
| 48..63 | 5,802 | 103 | 1.78 | 105 | 1.81 | 13 |
| 32..47 | 2,448 | 40 | 1.63 | 40 | 1.63 | 21 |
| 16..31 | 756 | 10 | 1.32 | 35 | 4.63 | 3 |
| 0..15 | 421 | 32 | 7.61 | 19 | 4.52 | 1 |
| −32..−1 | 273 | 42 | 15.4 | 7 | 2.56 | 5 |
| **−64..−33** | **39** | **15** | **38.8** | **9** | **23.3** | **9** |

24 deaths had no event row 30-60 s before death.

**Binning by pre-death position moves the falls up**, which is the point of doing it.
- Under −32..−1, 42 deaths by death position become 7 by pre-death position. That is consistent with falls from
  above: the band's death-position deaths are 20 falls and 19 dripstone. It is an inference; no per-death trajectory
  was traced.
- **The bottom band stays lethal under either binning.**
- The bottom band's numbers are small, and 10 of its 15 deaths are in one world (placebo-a, a deep cave reaching the
  −55 band).
- So this table gives an order of magnitude and the shape of the risk. It is not a deep miner's life expectancy.

**Falls and dripstone are 83 deaths in 7 days (30% of all).**
- By running skill: gather 40, explore 18, goto 15, idle 9, mine 1.
- They are not in the owner's lava + entombment scope (owner question O4).
- The diamond tier does not depend on them, because of the reversible-step rule (F6, section 8).

---

## 4. Entombment (question 2)

### 4.1 The predicate, tested

`isEntombed` (reflex.mjs:3391-3442) requires all three of:
- a non-passable cell at feet+2;
- at least 3 of the 4 cardinal cells at **head height** that are not `notAWall`;
- ground at least 4 higher in one of six probe columns at distance 4.

**It never reads feet level, and never asks whether the open side can be walked.**

**The probe.** `probe-entombed.mjs` calls the exported `isEntombedForTest` on stone-filled fixtures, built in the
test suite's conventions:

| Fixture | isEntombed |
|---|---|
| sealed 1x2 pocket (the suite's positive control) | true |
| **dead end of a 1x2 tunnel, open behind at feet and head for 3 cells** | **true** |
| middle of a 1x2 tunnel | false |
| **tread of a 2-high stair (the cell it came from is open, one up)** | **true** |
| corner of a 2x2 room | false |
| **alcove off a corridor** | **true** |

**What the probe covers, and what it does not.**
- `mine`'s own stair opens a third cell above the head (`descentStepCells`, skills.mjs:14458), so its treads read
  false. `mine` and the ore tunnel also hold a `'stair'` claim that silences the arm: mine shows 2 interrupted rows in
  7 days.
- `gather` holds no claim and causes 34% of the episodes.
- The fixtures prove the predicate can misfire. They do not prove which share of the 87k firings were such
  geometry. F2's read measures that directly.

### 4.2 Episodes (7 d)

**Method** (`e1.py`, `e2.py`).
- An episode is a bot's `_entombed` rows no more than 10 min apart and within 4 blocks (3-D) of its first row. It
  splits at a death.
- **Cause** is the skill the first firing interrupted: a `trigger=interrupt:entombed` row that ended within 3 s of
  it. If there is none, the bot was idle.
- **Outcome** is a death within 10 min of the last row; else an `_entombed_unrecoverable` row within the episode
  (+60 s); else "no death or give-up recorded". That last label does not mean the bot was freed.

**61,538 episodes on 80 bots, 4.6 per bot-hour.**

| Cause | Episodes |
|---|---|
| gather | 21,168: dirt 17,953, iron_ore 1,601, oak_log 485, sand 458, cobblestone 308, stone 306 |
| idle | 17,368 |
| explore | 9,595 |
| goto | 9,068 |
| surface | 2,307 |
| home | 453 |
| smelt_town | 386 |
| smelt | 375 |
| craft | 355 |
| furnace_drain | 261 |
| mine | 2 |

**By depth:** y ≥ 60: 14,461; 0..59: 45,515; < 0: 1,560.

| Duration | Episodes | No death or give-up | Gave up | Death ≤ 10 min after |
|---|---:|---:|---:|---:|
| one firing | 48,132 (78.2%) | 46,622 | 1,288 | 219 |
| ≤ 2 min | 9,004 | 8,591 | 365 | 48 |
| 2-10 min | 4,016 | 3,396 | 609 | 11 |
| 10-60 min | 298 | 212 | 85 | 1 |
| > 1 h | 89 | 87 | 1 | 1 |

(The breakdown columns are from `e1.py`'s unsplit run, which has 3 fewer episodes.)

**Chronic bots.** The spells over 1 h belong to a few bots at fixed cells:
- placebo-d-Delta at (198, 34, 188): spells of 9.0, 9.0, 7.6, 5.7 and 5.1 h;
- isolated-c-Alpha at (356, 47, 176);
- isolated-d-Bravo at (341, 60, 201);
- hive-c-Comet at y=−5 during this measurement: "gave up after 4 escape attempts (give-up #6); asked the goal layer
  for a pickaxe", while holding three iron pickaxes.

These are stuck bots. The 09-30 rule keeps them out of scope.

**Deaths** (`e2.py`). Each count is the share of a class's deaths with an entombed episode in the 10 min before. The
expected count comes from each dead bot's **own** episode coverage (2,000 random times per bot).

| Class | n | With an episode | Expected from the bots' own rates |
|---|---:|---:|---:|
| drowning | 91 | 49 | 46.8 |
| fire | 84 | 45 | 44.2 |
| fall | 46 | 29 | 23.6 |
| other | 38 | 24 | 20.2 |
| **suffocation** | **17** | **17** | **8.7** (P(all 17) ≈ 9.7e-6, if independent) |

The fleet base rate is 51.6% of random bot-time points.

**Entombment is not a death precursor in general. Suffocation is the exception.**
- In 10 of the 17, the entombed and marooned rows rise 3 or more blocks. That is consistent with an escape climb,
  but it is an inference from positions.
- The last row is 68-195 s before death. Health falls over about 25 s while the bot is idle.
- 8 of the 17 are hive-d bots, one world, so the deaths are clustered and not independent. The P value is an
  illustration, not a test.
- **No reflex watches for a body inside a block.** `_reflex_suffocating` needs oxygen to drain, and in-wall damage
  does not drain it.

### 4.3 Self-dig, gravel and sand, or a pathing artefact?

**Geometry artefact.** The predicate's misfire is proven on fixtures (4.1) and consistent with 78% single firings.
Its share is not measured.

**Self-dig: gather digging into a face, most of all dirt.** 17,953 episodes, 72% of them at y 0..59. It is plausibly
a loop:
1. gather dirt;
2. stand at the face;
3. the predicate reads "entombed";
4. the bot pillars, spending dirt (net −74,678 dirt across the escapes);
5. gather dirt again (`gather_dirt_16` is 29.4% of decisions).

**Gravel and sand: no instrument sees them.**
- No row observes a `falling_block`.
- The 300-character detail never names the head block.
- `mine` polls for falling blocks; gather and the escapes do not.

**Ghost blocks** (memory: rejected digs leave client air over server stone). They are a candidate for the
suffocation cluster: a climb that believes its head cell is open while the server keeps it solid. That is F3's Paper
investigation.

### 4.4 Cost in bot-time and blocks

**Interrupts.**
- 56,873 running skills were interrupted. 30,524 of them were gathers, and 18,214 of those still ended successful.
- Each interrupt is followed by a new decision. At the 10-15 p50 decision staleness of 28.5 s (ziggurat doc §1.3,
  another window), that is **≈ 450 bot-h, ≈ 3.3%**.
- **This is an estimate, not a measured loss.** Some of those decisions would have happened anyway.

**Spans.** Episode spans sum to 792 bot-h, and 415 h of that is the chronic idle spells. A span can include
intervening activity, so it is not a lower bound on time entombed.

**Blocks.**
- 65,004 `_inventory_mutation cause=entombed_escape` rows; 57,041 of them spent scaffold.
- Net change across those rows:

  | Item | Net |
  |---|---|
  | dirt | −74,678 |
  | andesite | −7,556 |
  | diorite | −7,513 |
  | granite | −7,283 |
  | cobblestone | −3,150 |
  | sand | −2,653 |
  | gravel | −1,070 |

- That is **≈ 105k blocks placed in 7 days**.

**Decisions.** 29,850 llm decisions were triggered by `entombed`.

---

## 5. What keeps bots shallow (question 3)

### 5.1 The model rarely asks

**Requested `mine` target y** over 7 days (63,599 calls):

| Target y | Calls |
|---|---|
| ≥ 64 | 5,493 |
| 48..63 | 25,680 |
| 32..47 | 18,438 |
| 16..31 | 8,606 |
| 0..15 | 2,615 |
| −16..−1 | 1,199 |
| −32..−17 | 988 |
| −48..−33 | 403 |
| −64..−49 | 175 |

**Nothing points deeper.**
- The deepest rung is iron (`gather_iron_ore_3`), and iron lives at y 16-62.
- The prompt (prompt.mjs:250-252) says "ores are below y=16", and names nothing about diamonds.
- `mine`'s default target is y=12 (skills.mjs:12440).

### 5.2 The exit contract refuses deep descents, on swings

**The refusals.**
- `exit_capability_reserve` refused 3,209 calls: 3,008 on pickaxe swings, 193 on scaffold, and 8 on health.
- It refused 34% of calls targeting below y=0, against 1.6% of calls targeting 48..63.
- At the refusals, scaffold-class blocks held were p10 65, p50 287, p90 852.

**The formula.**
- Swings needed = debt + 2 + max(min(12, debt), ⌈debt/4⌉), where debt = 63 − y.
- That is 101 swings at y=−16 and 155 at y=−59, against 131 in a stone pickaxe.

**The contract assumes the way home is dug.**
- For an intact 1:1 stair, the way home is a walk.
- ladder.mjs:20-33 deliberately credits nothing in the bag. ziggurat T6 credits a **verified physical route**.
- F6 applies T6 to the bot's own stair.

### 5.3 The pathfinder and the stair planner

**The pathfinder plans no step into lava.** Lava is in `blocksToAvoid`. Its `maxDropDown` is 6 on walk and 8 on
descend, and it treats water at any depth as a landing. This constrains planning only. Execution can still go wrong:
pathfinder #141; the deaths above.

**`chooseStairBearing` ranks dryness.** Water stops mine 3,858 times a week at y 32-63.

### 5.4 Who is deep now, and what they carry

**Bots below y=0:** 2 of 80 in the latest snapshot.

**Stock in the 80 bags** (latest snapshot per bot):

| Item | Count |
|---|---|
| diamond | **0** |
| lapis_lazuli | 6 |
| redstone | 17 |
| iron_pickaxe | 164 |
| iron_ingot | 183 |
| bucket (empty) | 95 |
| water_bucket | 0 |
| torch | 686 |
| coal | 46 |

The brief's "4 diamonds / 1,429 lapis in town chests" is **not re-measured**. The town index rows carry no per-item
totals, and RCON was not used.

---

## 6. Composition: what exists today

| Component | What it does |
|---|---|
| **keepout-01** (live) | Bars target digs (gather, mine, tunnel) within radius 6, from the site up to +12, of a live `death:fire` site. Adds a route/break veto at cost 101 inside gather/mine/exit runs. **It acts after a death, in one world, on digs.** |
| **protectzone-01** | Wraps dig, place, activate, open, sleep and craft (index.mjs:1202). Path cost 100. Survival digs and places are exempt. |
| **poolescape-01** | The marooned water-pit arm. Reserves the runner and re-checks lava live. |
| **homefix (watchdog)** | Relocation under a runner reservation. The target is never in a fire column. |
| **minewell-01** | `mine`'s well-shell guard, per bearing and per dig. |
| **Runner reservation** | `Runner.reserve(owner, ≤ 20 s)` aborts the skill and declines other runs (`runner_reserved`). Used by the watchdog and poolescape. Body claims (`'stair'`, `'climb'`) are separate. |

**Reflex tick order** (every 500 ms):
1. stranded ladder
2. air
3. pocket rung
4. **idle lava stand-off**
5. **danger block** (sets `inDanger`; interrupts every 2.5 s; the movement arms stand down while it is set)
6. health
7. marooned, including poolescape
8. **entombed**
9. stuck

---

## 7. The fixes, in order

**Common contract for every fix:**
- one decision, in a pure exported function, with behaviour tests (CLAUDE.md: never assert decision logic by text);
- a chain test that runs the refusal through to the next executable action;
- a Paper scene on sandboxes 5-8 under `sbxlock.sh take <sbx> <owner> "<note>"`;
- an env rollback;
- evidence rows that carry structured `args` (the `flattened` mapping, logger.mjs:131), so every gate is recomputed
  from **inputs**, never from the decision's own verdict;
- every gate has a **mutant positive control**: an injected defect, replayed on Paper or offline on recorded rows,
  that the gate must catch before the gate is trusted.

**Tier-2 conditions** (`tierrule.py:84-108`; 10-19 rule). A KEEP at +180 needs all of:
- exactly 4 pools;
- ≥ 48 canary bot-h;
- a declared exposure that is met;
- no WATCH or HOLD;
- a licence of class `kind` or `text`, not `rate`;
- a canary death rate no higher than control's;
- a single-build baseline.

A fix registers as tier 2 only once its Paper evidence exists.

### F1 `lavastep-01`: the danger arm makes a verified, bounded move

**The variable.** The danger arm's `escape()` is replaced by `dangerMove(at, state)`, a pure function that returns
`{case, candidates[], plan[], controls}`. A small executor runs that plan. Every step is followed by a post-check, and
any failed post-check ends the move.

**Inputs** (re-read on every firing):
- feet cell, the cell below, `onGround`, `isInWater`, position and yaw;
- block reads within 3.

**Cases.** Every state in which the arm fires falls into exactly one case. The arm's trigger is the feet cell OR the
cell below being in `DANGER_BLOCKS`: lava, fire, campfire, soul_fire, magma.

**Precedence:** `in`, then `airborne`, then `edge`. An airborne bot whose feet are in fire is `in`. A bot in water over
magma is `in`, not `edge`.

| Case | When | What happens |
|---|---|---|
| `airborne` | `!onGround`, the feet are not in liquid, **and no `dangerMove` sequence is in flight** | Release forward, sprint and jump; no steering. The arm re-evaluates every reflex tick (500 ms), not every 2.5 s, until the bot lands. |
| `in` | the feet cell is any DANGER block (lava, fire, campfire, soul_fire, magma); **or the feet are in any non-DANGER liquid (`bubble_column`, water, flowing water) with DANGER below** | The `stepPlan` search. The origin and its lateral sweep cells are exempt. The first step uses sprint + jump, because leaving lava or water needs the jump; later steps walk. In practice the aimed escape carries most `in` cases: a plan exists mainly when the bot stands in 1-wide lava beside a dry edge. |
| `edge` | `onGround`, the feet cell is not DANGER, and the cell below is DANGER (lava under the centre, or a magma or campfire floor) | The `stepPlan` search, executed as walks. **Jump only on a step whose destination is 1 block up** (prismarine-physics steps 0.6 without a jump). Never sprint. |

**`stepPlan`.** A breadth-first search of at most 3 steps, with |dy| ≤ 1 per step and no more than 4 neighbours each,
so at most about 40 cells are read.

Each step's destination must have:
- feet and head passable and not DANGER;
- a solid, known floor that is not DANGER;
- `cellLavaSafe` true at the destination.

The swept 3-wide line from origin to destination must be supported and DANGER-free, using `lavaStandOff`'s exact
sweep.

Unknown cells refuse. **Every candidate is recorded, with the reason it was rejected.**

**Goal.** The first cell that passes `lavaStandOff`'s exact retreat test: `cellLavaSafe`, supported, passable feet and
head, and the lateral support of the swept footprint. The 3x3 does not have to be clean.

A 1-wide unsupported ledge does **not** qualify. A bot on one gets no plan and goes to the aimed escape, which scores the
direction along the ledge by support.

Each `in` step has a 1 s timeout, because lava slows movement. A failed post-check in `in` goes straight to the aimed
escape, without waiting for the next firing.

**With no plan.** The fallbacks are bounded and deterministic, and every branch moves or seals:
1. **`edge`: seal**, only when the DANGER cell under the bot's centre is **replaceable** (lava, flowing lava, fire or
   soul_fire; magma and campfires are blocks and cannot be sealed). If the bot holds cobble or cobbled_deepslate, it
   places one into that cell. The reference is a solid block adjacent to the cell, and the face clicked is the one
   pointing into the cell. That face is in reach and visible through the fluid; raycasts ignore fluids. The placement is witnessed by a `blockUpdate` within 1 s.
   - **Witnessed:** re-classify the case at once.
   - **Not witnessed, or no block, or no face:** go to step 2.
2. **`edge` and `in`: aimed escape.** For each of the 8 bearings, score the first **6** blocks along its swept line
   (1.5 s of sprint; the origin is not counted) by the following. Collision applies in the fallback ordering too.
   - support (a solid, non-DANGER floor under each cell);
   - collision (the body cells are passable);
   - DANGER cells, counted.

   Pick the bearing with full support and no collision and the fewest DANGER cells. If none has full support, pick the
   one with the most supported cells, then the fewest DANGER cells. Then run the 1.5 s sprint-jump on that bearing.
   - Today's choice is the facing bearing, whatever lies along it. Paper compares the two. **This is not claimed to be
     never worse.**

**Body control: owned, by a priority reservation plus a generation token.**

**The reservation.** At the start, `dangerMove` calls `runner.reserve('lavastep', 6000, 'danger_block')`.
- This aborts the running skill.
- It supersedes any watchdog or poolescape reservation. Their pending runs decline with the existing `a newer
  reservation replaced this one`.
- While it is held, `runner.run` declines everything else (`runner_reserved`). That includes a model-chosen skill
  raised by the `danger_block` decision trigger (cognitive.mjs:404).
- **The one runner change in F1:** `reserve()` refuses to replace a live `lavastep` reservation. It returns
  `{gen: null, refused: 'lavastep'}`, and the watchdog and poolescape callers treat that as a decline.
- The reservation is released by generation at the end.

**The generation token.** `dangerMoving = {gen, deadline}`, where the deadline is a timestamp 6 s out.
- The executor checks gen, deadline, alive and air ownership after **every** await and before **every** control write
  or look.
- Any mismatch ends the move at once. It clears only the controls the move set, and releases the reservation.
- The deadline is checked in the loop, so a hung await cannot keep steering after it passes.

**What stands down while `dangerMoving` holds:**
- a new danger firing does not re-classify, so `airborne` cannot release a jump mid-arc;
- the stand-off, marooned, entombed, stuck and **wall** arms stand down;
- so do the stranded ladder and the pocket rung. Both run before the danger arm in the tick, and gain
  `!dangerMoving` gates;
- any escape routine already running stops at its next ownership check. The entombed arm's `alive()`, pillarOut,
  the ramp and poolescape's checks each gain `&& !dangerMoving`.

**Re-assertion.** Every 50 ms, while the gen is still its own, the executor:
- clears any pathfinder goal (`haltPath`, the 09-29 stale-stop helper);
- re-sets its controls;
- re-asserts its look direction.

A late skill unwind that clears controls, or a `lookAt` inside an unwinding dig, is overridden within 50 ms.

**Air preemption.** Air rescue runs before the danger arm in the tick.
- If the air arm holds the body when a firing comes, `dangerMove` does not start.
- If the air arm takes the body during a move, through its own flag (`airRescueActive` / `airPocketWanted`), the next
  ownership check ends the move. The air rescue owns the body, as today.

**Tests:**
- overlapping ticks during an `in` sprint-jump, with no `airborne` release;
- an entombed pillarOut running when the danger arm fires: it stops;
- a watchdog rescue firing mid-move: its reserve is refused, and it declines;
- a model skill chosen mid-move: it is declined;
- a skill `finally` that clears controls 200 ms in;
- a `lookAt` from an unwinding dig;
- air rescue taking the body mid-move;
- a hung await past the deadline;
- a death mid-move, and a respawn.

**Rows.**
- `_lava_retreat`, **one per firing**: at most one per 2.5 s on the ground, and one per 500 ms while airborne. Its
  args:
  - `episode`, `n`;
  - `case`, `onGround`, `feet`, `below`, `from` (floats), `yaw0`;
  - `candidates`: every cell read, with its feet, head and floor names, its swept-cell names, and its reject reason;
  - `plan`;
  - `seal`: ref cell, face, item, witnessed;
  - `aim`: per-bearing support, collision and DANGER counts, and the bearing chosen;
  - `controls`: each control and the time it was set;
  - `after`: position, feet and below names, and hp at +1.5 s.
- `_lavastep_mode`: the licence (class `kind`).
- Rollback: `LAVASTEP=0`.

**Read.**

**Effect.** Lava deaths inside an episode window, per episode, as a DiD. **Power is low:** about 412 episodes a week
fleet-wide, and about 4 expected on 4 pools in 6 h. The canary is therefore a tripwire plus correctness gates, and
the effect evidence is Paper.

**Correctness gates.** Each is recomputed from `candidates`, `plan`, `aim`, `seal` and `controls`. None is read off the
decision's own verdict.

| Gate | Fails if |
|---|---|
| G1 | an executed step's recorded destination, floor or swept cells hold a DANGER or unknown cell (except, in `in`, the origin and its lateral sweep cells) |
| G2 | an aimed escape ran while `stepPlan`, replayed on the recorded `candidates` (which carry the neighbour reads `cellLavaSafe` used), finds a plan |
| G3 | an `edge` **plan step** (not the aimed escape) was executed with sprint set, or with jump set when its destination was not 1 up |
| G4 | a seal used anything other than cobble or cobbled_deepslate, was aimed at a non-replaceable block, or was unwitnessed and still followed by re-classification |
| G5 | the aimed bearing is not the best by `aim` scores **recomputed** from the recorded per-bearing cell names |

Each gate has a mutant, replayed on Paper:
- allow DANGER in the sweep;
- skip the plan;
- sprint on an `edge` step;
- accept an unwitnessed seal;
- aim at the facing bearing.

**Exposure declared.** At least 3 episodes on the canary arm. About 2 are expected by +180, so a tier-2 KEEP at +180
is unlikely, and the read usually goes on to +360/+540. Below 3 by +360, it is INCONCLUSIVE.

**Paper (the main evidence).** Each scene runs base vs variant, 20 trials each, and reports survival with a 95%
interval:
- S1: a pool edge, facing the pool;
- S2: 1-deep lava, 1 block from shore;
- S3: a 1-wide ledge over a cave lava lake;
- S4: a magma floor;
- S5: falling past the edge of a lava lake;
- S6: a campfire underfoot.

The positive control is the mechanism. In the base arm the sprint must carry the bot from a dry edge into lava in S1
and S3. The fleet's own rates (10% / 43%) are not reproduced, and are not claimed.

**Draw exposure.** Pools with ≥ 20 danger episodes a week: placebo-a, hive-a, hive-b, board-c, placebo-c, placebo-d.
`draw_require`: 2 of them.

**Composition.**

| Component | Effect |
|---|---|
| keepout | No digs. A destination inside a fire column is allowed, and the row names it: leaving lava outranks the column. |
| protectzone | Walks are not wrapped. The seal is a survival placement (exempt). |
| poolescape and the homefix watchdog | F1's `lavastep` reservation supersedes theirs, so their pending runs decline. While F1's is live, their `reserve()` is refused: watchdog's `gen` comes back null and its run declines `runner_reserved`, and poolescape's `renew()` already returns early for another owner (reflex.mjs:1546). They resume after F1 releases. |
| minewell | No interaction. |
| runner reservation | F1 takes `lavastep`, at most 6 s, and only it can hold one during the move (see Body control). |

**In-flight digs and places.** At the start, F1 calls `bot.stopDigging()`. While the gen is live, any dig or placement
other than F1's own seal is refused at the common chokepoints:
- `bot.dig`;
- `_genericPlace`, which `placeBlock`, `_placeBlockWithOptions` and `placeEntity` all call. protectzone already uses it
  (protectzone.mjs:22, 431-438). The airpocket rescue's direct `_placeBlockWithOptions` call (airpocket.mjs:437-439) is
  therefore covered. It is an air rescue, so it ends F1 by air preemption first.

**The enclosed unsealable floor.** Magma or campfire under a bot walled in on every side gives no plan and no seal,
and the aimed escape cannot move it. After **3 consecutive firings that moved the bot less than 0.5 block**:
- F1 sneaks. Sneaking stops magma damage, and Paper confirms whether it stops campfire damage.
- It marks a `danger_stuck` relaxation for 60 s, keyed by **(cell, block name)**. The block must be magma_block,
  campfire or soul_campfire. **Lava and fire are never relaxed.**
- The relaxation ends at once on any `blockUpdate` at the feet or below cell, on any new DANGER cell there, or on a
  move off the cell.
- While it is live, the danger arm stops interrupting and reserving for that (cell, name) only, and
  `recoveryArmsMayRun` treats that one block as non-DANGER. The ordinary escape arms (pillar, dig, ramp) then run under
  their own lava checks.
- The sneak is kept until the bot has left the cell, so an escape arm working from the cell is not re-damaged. It is
  dropped at the 60 s end.
- This is bounded, it is non-lethal in peaceful on magma, and it hands over to rungs that can move a walled bot. It
  is chain-tested.

**Refusal chain.** Search → seal (`edge` only) → aimed escape → (no movement three times) the stuck-cell handover to
the ordinary escape arms. Each step acts from where the bot is or hands over to the next.

The chain test runs every Paper scene through to the next decision. It asserts the bot ends:
- on a safe cell;
- after an aimed escape, re-classified on the next firing;
- or airborne, re-evaluated on landing.

No other end state is allowed.

### F2 `tombexit-01`: entombed only if the bot cannot walk back to where it was just free

**The variable.** The entombed **arm's** firing condition gains `&& !walkBack(at, feet, freeCells)`.
- `isEntombed` itself is unchanged, so its other callers are unaffected: the marooned state (reflex.mjs:2634) and
  escape success (3264).
- A decline sets `lastEscapeAt` as a firing does. The arm's 15 s interval therefore throttles declines too.

**`freeCells`.** A ring of the ground cells the bot stood on in the last 120 s at which `isEntombed` was false.
- It has its own sampler, every reflex tick while on ground, and does not depend on the arm's short-circuit chain.
- A declined firing never adds a cell.
- The ring clears on death, respawn, relocation and teleport.

**`walkBack`.** A breadth-first search of at most 64 nodes over the walk profile's own moves:
- same level;
- step up 1, with headroom;
- drop ≤ 3 onto solid ground;
- no dig, no place;
- every cell known, and no DANGER cell.

It returns the path when **both** of these hold:
- the search reaches a `freeCells` cell at least 3 blocks from the feet;
- **the bot's component is open**: the search hits its 64-node cap without exhausting.

A component that exhausts in under 64 nodes is closed: a sealed pocket, or a sealed short tunnel. There, a free cell
inside it does not count, and the bot stays entombed at once.

**The bound: per area, per episode.** At most **2 declines in 10 minutes within 8 blocks** of the first decline,
counted at the arm's throttled firings, which are at least 15 s apart. The third firing in that area runs today's
arm.
- **A small sealed space is not delayed at all.** The component is closed, so the bot stays entombed at once.
- **A large sealed space** (open beyond 64 nodes, with the bot's free cells inside it) gets two declines, about 30 s,
  then today's arm. It is delayed, never stranded.

**Fixtures** (history-aware build tests; the committed `probe-entombed.mjs` is the r1 predicate probe only).

Declined, given a walk-in history:
- a tunnel dead end;
- a 2-high stair;
- an alcove.

Stay entombed at once:
- the suite's TOMB, with no history;
- a one-way 4-block drop, whose free cell is not walkable back;
- a 6-long tunnel sealed behind the bot (a closed component);
- a covered 2-cell pocket.

Declined twice, then today's arm:
- a large sealed cave that is open beyond 64 nodes, where the bot's free cells are inside.

**Rows.**
- `_entombed_declined`, written on every decline (at most 2 per area per 10 min, by the bound). Args:
  - `cell`, `free_cell`, `free_age_s`;
  - `path`: the cells of the path, with their feet, head and floor names;
  - `nodes`, `area_n`.
- `_entombed_bound`: written when the bound hands a firing to today's arm.
- `_tombexit_mode`: licence class `kind`.
- Rollback: `TOMBEXIT=0`.

**Read.**

**Effect** (DiD). `_entombed` rows per bot-h (baseline about 6.5).

Companion metrics, also DiD:
- interrupts per bot-h;
- scaffold spent in escapes per bot-h;
- gather successes per bot-h.

**Guards (WATCH/HOLD):**
- `_entombed_bound` per bot-h: how often a decline was followed by being sealed in;
- spells longer than 10 min;
- `_entombed_unrecoverable`.

**Tripwires.** Drowning and suffocation, on the two-death floor.

**Correctness gate G1.** No decline that fails any of three replays:
- its recorded `path`, replayed with the walk-profile move rules on its recorded cell names, is a valid walk to a cell
  at least 3 blocks away;
- its `free_cell` has a ring entry with a sample time ≤ 120 s old, and that entry's recorded predicate inputs (ceiling
  name, the four head-level wall names, the ground-probe heights) recompute to "not entombed";
- the search's `nodes` equals 64, so the component was open.

Mutants:
- accept any cell as free: caught by the ring replay;
- skip the component test: caught by the `nodes` check.

The `_entombed_declined` args gain `free_inputs` and `free_t`.

**Exposure.** Minutes on any pool. Tier-2 conditions as listed above.

**Draw exposure.** Every pool.

**Composition.**

| Component | Effect |
|---|---|
| `'stair'` claim | unchanged |
| marooned state and escape success (reflex.mjs:2634-2641, 3264) | Both read `isEntombed`. Under a ceiling the marooned branch is inert (`!upIsOpen`). The escape-success test stays truthful, because a bot with a walk-back path is not entombed. Both get chain tests. |
| air, pocket, poolescape | run before this arm; unchanged |
| keepout, protectzone | fewer survival digs and placements inside them |
| homefix, runner reservation | fewer interrupts; no reservation taken |

**Refusal chain.** A decline is not a refusal. It returns the bot to its next decision with a recorded walk path.
After the bound, today's arm and its chain run unchanged. Gather does not take a `'stair'` claim.

### F5a `lavatarget-01`: explore-toward-known skips iron beside lava the bot has seen

**The variable.** `_explore_toward_known` drops an iron target that has any lava cell within 6 blocks, counting only
cells **this bot named in its own rows in the last 2 h**, from an in-process ring of 256 cells. It also drops any
target whose straight bearing passes within 2 blocks of such a cell. Then it takes the next target, or today's
random bearing.

**Inputs.** Only rows that carry coordinates: `_lava_corridor`, blind-step, F1's `_lava_retreat` once F1 is in, and
F4's `_mine_lava` once F4 is in.

**Why it is early.** It is aimed at the 61 of 84 deaths preceded by explore-toward-known. It is small. It has no
shared store and no routing change.

**Rows.** `_lavatarget_skip`: `target`, `lava_cell`, `distance`, `n_ring`. `_lavatarget_mode`. Rollback
`LAVATARGET=0`.

**Read.**

| Kind | Measure |
|---|---|
| Effect (DiD) | `_lava_corridor` refusals per explore-hour; danger episodes per bot-h |
| No-harm | explore success per bot-h; iron gathered per bot-h |
| Gate G1 | 0 explore-toward targets chosen with a ring cell within 6 |

**Gate G1.** No explore-toward target was chosen with a ring cell within 6 of it. Each `_explore_toward_known` choice
logs, in args, the ring cells within 16 of the chosen target and the ring's size and age, so every choice can be
recomputed.

Mutant: ignore the ring. Paper scene: an iron ore beside a lava pool that the bot has seen, and a second iron ore that is clear. The variant picks the clear one, the base picks the nearer.

**Tier 2 candidate.** Draw: pools with ≥ 1,000 `_lava_corridor` rows a week.

**Composition.** It changes target choice only. keepout, protectzone, homefix, minewell and the reservation are
unchanged.

**Refusal chain.** It refuses nothing. The fallback is today's random bearing.

### F4 `minelava-01`: `mine` reads six faces, never opens into hidden lava, seals visible lava, takes only reversible steps, and returns deterministically

This is a **bundle**, registered as one canary. The parts cannot be split: a stop without a return is the dead end
CLAUDE.md names, and a return over a step that cannot be reversed is not a return.

**The planner.** `stairLavaPlan(at, action, bot)` is pure. It is called fresh before **every** dig, re-dig, placement,
push and move. That includes mine's falling-block re-open and the recovery re-dig (skills.mjs:13021, 13148).

What it reads, for every cell that the action opens or that the body enters:
- all six faces;
- the cell beyond any face that is air or liquid;
- the step's floor (y−2) and the cell under it.

DANGER is `LAVA_LIKE`. Unknown is unsafe.

**The verdicts:**

| Verdict | When | What happens |
|---|---|---|
| `clear` | nothing DANGER or unknown, and the step is reversible | go ahead |
| `seal` | a **replaceable** DANGER cell (lava, flowing lava, fire) lies in, or touches, a cell the step needs, and is reachable. The reference is a solid block adjacent to the DANGER cell, and the face clicked is the one pointing into it. That face is within 4.5 blocks of the eye, and the ray to it is clear apart from fluids. The bot stands on a solid, non-DANGER floor, its body cells are DANGER-free, it holds a seal block, and the target is not in a zone. **In practice:** lava that touches an open cell has usually flowed into it already, so the seal mostly applies to lava that has entered the stair's own cells (from above, or after a block fell). Most lava meetings end in `turn`. | Place cobble or cobbled_deepslate against that face, into the DANGER cell. Wait for a `blockUpdate` within 1 s, then re-read and re-plan. **Unwitnessed means not sealed:** re-plan, which will `turn` if the lava is still there. |
| `turn` | lava is behind a cell not yet opened; or under the floor; or more than one face deep; or any face is unknown; or the step is **not reversible**; or the seal is refused in a zone | exclude this bearing for the rest of the call and re-plan the others with `chooseStairBearing` |
| `stop` | no bearing can `clear` or `seal` | the refusal chain below |

**A hidden lava cell is never opened and then plugged.** Lava flows 4 blocks at 30 ticks per block. Racing that is not
M7.

**Reversible, required before entering any step.** The step's floor is solid, non-falling and not DANGER, and the walk
back up is one step-up move with headroom: the three cells above the lower stand cell are all passable.
- This forbids mine's survivable-drop steps, where the probe accepts a hollow of 1-2 below the tread.
- The no-harm read watches what that costs.

**Also in the bundle:**
- `stairLiquid`'s lava branch uses `LAVA_LIKE`. Magma under a tread is a `turn`. Water behaviour is unchanged (water is
  terrain).
- The fall probe counts lava as lava.
- The recovery push needs the planner's `clear` on its line and is skipped otherwise.
- **The in-call return.** `mine` records the stand cells of the steps it cut in this call. Every step was reversible,
  so the walk back is a sequence of one-step-up moves.
  - On `stop`, it walks them back newest-first. Each move is a `GoalBlock` on a zero-break, zero-place profile (no
    dig, no towers, no scaffold, no parkour, `maxDropDown` 1), and each move is re-planned by `stairLavaPlan` first.
    It ends at the call's start cell.
  - **No steps cut:** `mine`'s existing relocation (`planMineStart`, a walk of ≤ 8, else ≤ 16).
  - **No relocation:** `hazard_interrupt`, "lava on every bearing here", from the start cell.
  - **A return step fails** (a cell changed under the bot: gravel, another bot's dig): the return stops, and
    `unverified` names the cell.

**Why the failed-return case is safe.** F4 does not touch the exit contract. Every step was admitted under today's
swing and scaffold reserve for the bot's depth, so a bot whose return fails still holds today's reserve. The `surface`
chain the contract was designed for applies from where it stands. This is today's chain, entered later and from
higher up. It is not a new dead end.

**Rows.**
- `_mine_lava`, **one per planner call**. Args:
  - `op` (an id per action), `step`, `action` (dig / re-dig / place / push / move), `bearing`;
  - `faces`: per opened or entered cell, the six neighbour names and the beyond-cells;
  - `floor`, `reversible`, `verdict`;
  - `seal`: ref, face, item, witnessed;
  - `push`: the swept cells read;
  - `unknown`.
- `_mine_return`: `op`, `steps`, `from`, `to`, `ok`, `fail_cell`.
- `_minelava_mode`.
- Rollback: `MINELAVA=0`.

The per-action volume is about 3-4 rows per step, at about 5.7 mine calls per bot-h. That is small.

**Tier 3.** Today mine meets lava about 4 times a week, so the canary's job is **no harm**. The effect evidence is
Paper.

**Read.**

No-harm, as DiD:
- mine success rate;
- mine-attributed cobble per bot-h;
- iron per bot-h;
- the `turn:not_reversible` share;
- `exit_capability_reserve`;
- the `_mine_return` failure rate.

**Correctness gates**, each recomputed from `faces`, `floor`, `seal` and `push`, joined to keepout's `_mine_dig` rows
by time and cell:

| Gate | Fails if |
|---|---|
| G1 | a dig whose cell's faces, recorded in that action's `_mine_lava` row, held DANGER or unknown without a witnessed seal of that face |
| G2 | a push with DANGER in the recorded sweep |
| G3 | a step entered whose recorded floor or headroom makes it not reversible |
| G4 | a seal of anything other than cobble or cobbled_deepslate |
| G5 | a `stop` without a `_mine_return` or a `_mine_relocate` row within 5 s. `_mine_relocate` is a new row in this bundle, written on success and on failure |

Mutants: drop the six-face read; skip the reversibility check; seal with dirt; push blind; omit the return.

**Paper.** The base arm must fail S1, S2, S5 and S6.

| Scene | Setup | Expected |
|---|---|---|
| S1 | flowing lava entering the stair's next head cell from an opened ceiling | seal, then dig |
| S2 | hidden lava behind the next tread | turn |
| S3 | lava on three bearings | stop, then return up the call's steps |
| S4 | an unloaded edge | turn or stop |
| S5 | the 10-16 step-failure push | no push |
| S6 | a 2-deep void under the next tread | turn |

**Draw exposure.** Any 4 pools.

**Composition.**

| Component | Effect |
|---|---|
| keepout | wraps digs; a seal is a placement; `turn` re-plans through the keep-out filter |
| protectzone | a seal in a zone is refused, which becomes `turn` |
| minewell | the re-planned bearing passes the shell filter |
| homefix | a watchdog reservation aborts the return like any skill; the bot is on its own reversible stair |
| runner reservation | `mine` keeps its `'stair'` claim |

**Refusal chain.** `stop` leads to one of: the in-call return, relocation, or "lava on every bearing" from the start
cell. If the return itself fails, today's `surface` runs with today's reserve intact. The chain is tested with every
reflex armed, and with interrupted-return, zone and keepout variants.

### F6 `deepstair-01`: the town's certified deep stair (deep miners only)

**Scope (M8).** This covers only the town's deep stair, and only its `deep_miner` leaseholders. Ordinary bots keep
today's exit contract everywhere.

**The stair.**
- **Two lanes**, side by side, 3 high, cut together and **open to each other**. Bots can pass, and a blocked lane is
  left for the other one after 20 s.
- **A spiral** inside a 10x10 footprint, turning every 8 steps, so it stays in loaded chunks near town.
- **Every step is F4-planned and reversible.**
- **Sited by D0, not by F4.** The stair is cut only where D0's survey of the exact route and its shell is clean
  (section 8), and live reads confirm each level before it opens. A `turn` or `stop` during the cut ends the cut at the
  last certified step.
- **The top is a surface cell** (`exitDebt` = 0). Starting at a shaft-01 landing would need T6's full route (portal,
  columns and collar) composed in, so it is left to a later design.
- **Lined like the shaft** (T8/T9). Before a level opens, its 1-cell shell is surveyed, and any falling block, liquid or
  DANGER cell in the shell is replaced with cobble.

**Protected envelope:** both lanes plus the shell. It is a structure in world facts, guarded like the ziggurat T2(b)
structure guard. **Every** dig and **every** place on an envelope cell is refused, by every skill and every recovery
rung, survival included. The exceptions, each one logged as an authorized `_envelope_mutation`:
- the stair's builder, during the cut;
- `stairReturn` repairs, by a leaseholder;
- the **active branch's leaseholder**, for its own F4-planned branch extension. Cutting cell n+1 digs cell n's end
  shell. Ore digs from a branch cell into that branch's shell count too. The branch's floor cells and the shell cells
  beside any stair lane stay protected. After each extension or ore dig the shell is recomputed: the new hole's
  neighbours become shell, and an ore hole that opens onto nothing walkable is sealed with cobble;
- an `uncertified` bot's own exit (the handover);
- the cobble seal that closes an ore hole opening onto nothing walkable, placed by the active branch's leaseholder.

"Anyone else" means any bot other than the one these exceptions name for that cell. The second leaseholder is
"anyone else" on the first one's branch.

So that refusal is not a dead end, a new **rung 0, `use_stair`**, comes before every escape rung (entombed, marooned,
stranded, wall, stuck).
- **It is offered only on a verified connection:** a zero-break path of ≤ 8 nodes from the bot's feet to a lane cell.
  It then walks the up lane. That costs nothing, so it wins.
- **With no connection** (a bot outside the shell, or in a pocket beside it), rung 0 is not offered. The normal rungs
  run with every envelope cell **excluded from their plans**, not refused mid-plan, so each one re-plans in the
  directions that remain.
- A refusal row names the remedy "step away from the stair": walk or dig away from it, as protectzone's `zoneRemedy`
  does.
- Rungs that do not plan, such as pillarOut and the stranded ladder's dig-up, check each cell before they dig or
  place it. An envelope cell makes the rung decline, and the next rung runs. The only exception is an `uncertified`
  bot's own exit.
- Chain tests:
  - a bot in an exterior pocket against the shell;
  - a bot wedged in a corner of the shell;
  - a pocket under the bottom landing, where up is shell;
  - a blocked branch with lava behind the block, which must reach the handover.
- The evacuation profile used by `use_stair` and `stairReturn` has **its own exclusion arrays**, so the
  non-leaseholder lane exclusion does not apply to it. That is the T10 lesson: `exclusionAreasStep` is shared by
  reference.

**Non-leaseholders** get a step exclusion of 1000 on the lane **and branch** cells for every profile except the
evacuation profile, as in T10, so they do not path through. A bot already inside one leaves through `use_stair`.

Water in a lane is its own class in `obs` (W), not P.

**Clearance rules.** Each certificate cell carries its rule.
- **Stair cell:** feet, head and above passable; floor solid, non-falling and not DANGER.
- **Level cell** (branches and the landing at the stair's foot): feet and head passable, floor as above. The ceiling
  may be solid.
- **Junction:** the stair's bottom cell and the first branch cell are both cut 3 high, and certified as stair cells.

**The certificate is the route.** It is the ordered stand cells of each lane from the bottom up, plus each branch's
level cells, with each cell's rule. The return walks exactly those cells, with one `GoalBlock` per cell on the
zero-break, zero-place profile (no dig, no towers, no scaffold, no parkour, `maxDropDown` 1).

**Validation.**
- **Before every dig, placement and move** a leaseholder makes, every route cell is re-read: about 940 cells, each
  classed S, P, D, U or F (solid, passable, DANGER, unloaded, falling).
- **`corridorSafe` runs once per certificate generation.** A run is about 700 samples, around 40k reads, which is
  too many for every action.
  - Each run records its **full read footprint**: every cell it read, including the lateral `cellLavaSafe` cells and
    the drop cells.
  - A cell→segment index subscribes to mineflayer's `blockUpdate` and chunk-unload events.
  - **Any** update or unload of a footprint cell marks its segments stale. Stale segments are recomputed before the
    next credited action, and credit waits for them.
  - Mutant: an unchanged route with lava added beside a segment, which Codex reproduced against the real
    `corridorSafe`. **G7** (Paper) must see the segment marked stale and recomputed unsafe. G1 sees only
    `stale_n`.

**Credit.**
- On a certified **stair** cell (lined, guarded, two lanes), a leaseholder's debt is 0, plus the floor.
- On a certified **branch** cell (single lane, unlined), the debt is the **re-cut reserve**, on top of the floor: 2
  swings and 1 block per branch cell between the bot and the junction (≤ 64 swings for a 32-long branch).
  - The branch cells and their 1-cell shell are **guarded like the envelope**. The same exceptions apply, including
    the active branch's own extension and ore digs. Every other dig and place is refused, so no other bot can open lava
    beside a branch or remove its support.
  - The reserve prices a re-cut. It does not promise that F4 allows one: F4 may `turn` or `stop`, for example on lava
    that has entered a branch cell, or on a refilling gravel column. That case goes to the universal handover below.
- **Anywhere else** (off the route, after an F1 move), the debt is today's `63 − y`.

**Floor.** 30 swings and 32 scaffold blocks, always kept.
- **One shared repair allowance per lease:** 20 swings and 16 blocks, across lane repairs **and** the off-route dig
  back.
- So at least 10 swings and 16 blocks always remain.

**Exits.** Every exit of a **certified** leaseholder goes through `stairReturn`:
- the lease ending;
- any refusal;
- any decision.

An `uncertified` bot is not a leaseholder, for this rule or any other (see the handover).

**Confinement** (section 8): below the top, the runner admits only `deep_miner` and `stairReturn` for a leaseholder.

**A break** at cell k (validation fails there, or a stale `corridorSafe` segment recomputes unsafe):
1. On a stair cell, walk up the valid part.
2. Repair under F4's planner: re-dig a filled cell, place a floor, or seal lava that has entered. Repairs draw on the
   shared allowance of 20 swings and 16 blocks. A branch re-cut draws on the branch reserve.
3. On the stair, switch to the other lane.
4. **Anything else goes to the universal handover.** That covers both lanes broken, a branch F4 cannot re-cut, a repair
   over its allowance, and the other lane unreachable.

**The universal handover.** This is the single rule for every route-recovery failure. It covers stair breaks, branch
breaks, and off-route after F1 (section 8).
- **Credit and confinement end at once.** The record goes to phase `uncertified`, which still counts in the cap.
- **An `uncertified` bot is not a leaseholder anywhere:**
  - not in Exits;
  - not in the homefix row;
  - not for the cognitive chain's forced `stairReturn`;
  - not in confinement;
  - not on reconnect.

  It keeps the **evacuation profile**, which is free of the lane and branch exclusions. `use_stair` remains a normal
  rung for it, whenever a verified connection exists.
- **Its first step is to walk.** It walks the longest still-valid part of the route upward on the evacuation profile
  (or `use_stair`), toward the top. If it reaches the top, it is out.
  - The walk has the same bound as `stairReturn`: 3 attempts, or 5 minutes, without reaching a new cell. Then it
    stops where it is.
- **Otherwise, from where the walk ends, it runs today's exit chain deterministically:** `surface`, then the stranded
  ladder.
- **Its kit** is whatever it holds: the floor plus any unspent branch reserve and budget, and its seal blocks. That is
  about 30-94 swings when the handover comes late in a lease, and up to about 250 early in one. Today's contract would ask about 147 swings at y=−53. **So today's chain may well give
  up from deep below the stair's top.** That is the residual (O11). It is a bot-reachable residual, and the design does
  not claim otherwise.
- **The guard is lifted for this bot's own exit.** Its exit digs and placements on envelope or branch cells are
  allowed, and each is logged as an authorized `_envelope_mutation`. Without that, the guard would strand it. No other
  miner is underground (single occupancy, section 8), so there is no peer to protect or wait for.
- **It leaves the cap** when it is on the surface anywhere (`exitDebt` = 0), or dead.
- **This is the same chain any bot at depth has today.**

**No-progress handover.** A certified leaseholder whose `stairReturn` does not reach a new route cell goes to the
handover, even when every route cell still conforms. The trigger is 3 attempts or 5 minutes, whichever comes first.
It covers:
- a pathfinder stall;
- an empty-path resolve (`path_interrupted`);
- both lanes occupied past the 20 s step-aside. Only one miner is ever underground, and non-leaseholders are excluded,
  so this means an obstruction, not traffic.

Chain test: a bot whose path to the next route cell always resolves empty.

**The residual.** Today's chain giving up: `_deepmine end=uncertified_stranded`, shown in the fleetstatus alarm header
(O11). It compares to a bot that falls into a deep cave today. The kit may be smaller than today's contract would
demand, which is why it is a residual and not "never worse".

**Rows.**
- `_stair_cert`, at every validation:
  - `op` (joined to the action it gates);
  - `cert` (id and generation);
  - `obs`: one class character per route cell, in route order. The gate replays the cell rules on this; it does not
    trust a verdict;
  - `lane`.
- `_stair_cert_full`, once per generation and on any change: the full ordered route with each cell's rule, plus
  `obs_full`, the block names of the whole protected footprint.
- `_exit_credit`, per credited action: `op`, `debt_old`, `debt_new`, `on_route`, `swings_left`, `blocks_left`,
  `floor`, `reserve`, `stale_n`, `lease`.
- `_corridor_recompute`: `op`, `segments`, `trigger`, `result`.
- `_deepstair_break`.
- `_deepstair_mode`.

**Tier 3.** Built and canaried with `deepminer-01`. Paper is the main evidence.

**Gates:**

| Gate | Fails if |
|---|---|
| G1 | a credited action whose same-`op` `obs`, replayed against the route rules, shows a non-conforming cell; or the `obs` is missing; or its `_exit_credit` has `stale_n` > 0 (segments stale at credit time) |
| G2 | any `_deepstair_break` with both lanes broken |
| G3 | a credited action with `swings_left` or `blocks_left` below the floor **plus** the branch re-cut reserve that applies at that cell |
| G4 | a credit without a lease, or with `on_route` false |
| G5 (Paper) | at sampled credited actions, the sandbox driver pauses the bot and RCON-reads every route cell; the world must match that action's `obs` |
| G6 | an envelope or branch dig or place that matches none of the guard's exceptions (see "G6 evidence" below the table) |
| G7 (Paper) | the cache. Change a cell in a segment's footprint that is not a route cell (lava beside the route). The next credited action must wait while `_corridor_recompute` (op, segments, trigger cell, result) runs, and the recompute must find the segment unsafe and go to a break. Mutant: disable invalidation; G7 must fail. |

**G6 evidence.**

*Authorized exceptions:*
- the builder;
- a leaseholder's repair;
- the active branch's own F4-planned extension, ore digs and ore-hole seals;
- an `uncertified` bot's own exit.

*Positive controls that must pass G6:*
- a branch extension;
- a side-ore dig from the branch;
- an ore-hole seal.

*Mutation observer.* At `bot.dig` and `_genericPlace`, every successful mutation is logged as `_envelope_mutation`:
actor, skill or rung, purpose, cell, before and after, lease gen, authorized.

*blockUpdate watcher.* It covers every envelope and branch cell, and logs changes that no bot made: flow, a fall, an
external edit.
- A change seen while loaded is matched to a mutation row by its cell, within a ±2 s window, across all bots' rows.
- A change made while the chunk was unloaded is found on reload, by diffing against `obs_full`. It is then matched
  against **every** mutation row for that cell over the whole unloaded interval, from the unload time to the reload.
- `obs_full` holds the block names of the whole protected footprint, per certificate generation. It lives in the
  record's own file. The row carries only its hash and the changed cells, to keep the log small.

*Positive control:* a shell-only mutation made while the chunk is unloaded must be seen.

*Mutants that must trip G6:*
- a bypassed `placeBlock`;
- a direct `_placeBlockWithOptions` placement;
- a bypassed recovery dig.

**What G1 does and does not cover.** On the fleet, G1 checks that each credited action had a full, conforming
observation. Whether the observation matched the world is checked on Paper, by G5.

Mutants: credit an invalid `obs`; drop the floor; credit off-route; skip the per-action validation; let a survival rung
dig the envelope.

**Composition.**

| Component | Effect |
|---|---|
| keepout | a live fire site near the envelope blocks siting |
| protectzone | the envelope is its own guarded structure kind |
| minewell | siting avoids well shells |
| homefix | a **certified** leaseholder below the top is not relocated; `stairReturn` runs instead. An `uncertified` bot is relocated as any bot is |
| runner reservation | `stairReturn` is a skill holding the `'stair'` claim. F1's `lavastep` reservation outranks it. After F1, the lease has ended (section 8), and the cognitive order chain runs `stairReturn` deterministically as the next action, the way `#keepoutExitOrder` runs, not by model choice |
| F5b | never excludes envelope cells |

**Refusal chain.** Validation failure, or no progress → walk up → repair → switch lanes → the universal handover. The
handover walks the valid route, then runs today's chain, with the guard lifted (coordinated). The alarm fires only if
today's chain gives up (O11).
- An envelope-mutation refusal names `use_stair` only where a verified connection exists.
- Otherwise it names "step away from the stair", and the rungs re-plan with the envelope excluded.

### F5b `lavasight-01`: per-world lava memory in routing, with egress rules

**The variable.**
- **Writes.** Coordinate-bearing lava sightings (the F5a inputs) go to world facts as kind `lava:seen`: cell, count
  and last seen, at most 4,096 per world.
- **Lock.** Writes take keepout-01's pid lock. A contended write is retried at the next sighting (sightings repeat:
  14k rows a week), and the liveness row counts `lavasight_write_skipped`.
- **Routing.** In the walk, gather and explore profiles, each **live-re-read** remembered cell excludes itself and its
  4 cardinals at feet level, and costs 8 within 3.
  - A loaded cell that reads non-DANGER is removed from memory at once. That covers a sealed cell or a changed world.
  - An unloaded cell is kept and costs 8, but is not excluded.

**Egress.**
- No exclusion applies to the first 6 nodes of a path, for a bot whose feet are inside an excluded area. It can always
  leave.
- No exclusion covers a certified stair cell (F6) or a `keepout_exit` route. r2's home-goal exemption is dropped: the 45-block
  hot spot lies on a home route.
- If the walk profile finds no path only because of exclusions, it re-plans once with exclusions downgraded to cost.
  The row says so.

**Rows.**
- `_lavasight`, liveness: `cells`, `written`, `skipped`, `removed_live`, `downgraded`.
- `_lavasight_route`, sampled: `goal`, `excluded_nodes_avoided`, `downgraded`.
- `_lavasight_mode`.
- Rollback: `LAVASIGHT=0`.

**Tier 3.** It is routing-wide.

**Read.**

| Kind | Measure |
|---|---|
| Effect (DiD) | danger episodes per bot-h; `_lava_corridor` per explore-hour |
| No-harm | goto/explore success; path timeouts; iron per bot-h |
| G1 | 0 **planned** nodes inside an exclusion that applied: the `path_update` hook checks each planned path and logs any node it finds inside one, with `_lavasight_route` args `nodes_in_excl` |
| G2 | 0 noPath results caused by exclusions without a downgrade re-plan in the same `op`, from `_lavasight_route` args `excl_blocked` and `downgraded` |

**Draw exposure.** Worlds with ≥ 50 sighted cells in the 24 h before the draw.

**Composition.**

| Component | Effect |
|---|---|
| keepout | A separate kind; never disputes a fire site; no dig rule. |
| protectzone | Costs add. |
| homefix | Relocation targets avoid the exclusion, as they avoid fire columns. |
| poolescape | Its lava check is live; unchanged. |
| F6 | Never excluded. |

**Refusal chain.** Egress, then the downgrade, then today's routing. No goal is unreachable because of memory alone.

### F3 `inwall-01`: Paper investigation only

**Why.** 17 of 17 suffocations followed an entombed episode, and nothing watches for a body inside a block. The
mechanism is unknown.

**Investigation.** On sandboxes 5-8, under `sbxlock.sh take <sbx> mineshaft "<note>"`, replay `pillarOut`,
`digStraightUp` and the escape ramp against four conditions:
- a gravel-capped column;
- a sand-capped column;
- a server-rejected head-cell dig (a ghost block);
- a placement into a cell the body overlaps.

**Record:**
- which conditions put the eye cell in a block;
- what the client reports for that cell;
- the damage sequence.

**Build criteria.** A reflex is designed only once one mechanism reproduces. It must have:
- a trigger the mechanism reaches (for the ghost case, server-side evidence, because client air will not trigger);
- the body grant;
- a complete fallback with verified support for any step down.

Codex r1 P2-15 and Claude agree it stays investigation-only until then.

### Order and why

**The canary order: F1 → F2 → F5a → F4 → F5b. Then the diamond tier: F6 and `deepminer-01` together.**
- F3 runs on a sandbox in parallel and uses no canary slot.
- F1, F2 and F5a are small, and they cut the noise every later read sits in.
- F4 is the descent's base: a mine that cannot open into lava, takes only reversible steps, and returns.
- F5b is the broadest change.
- F6 has no effect without a lease, so it ships with the deep miner.

**One canary at a time.**

---

## 8. The diamond tier and enchanting (sketch), with the owner's M7-M10

### M7, accepted: slower but safer

- **The read cost.** Every action pays the planner's reads. A seal is one placement, about 0.3-0.5 s.
- **Dig time.** Deepslate takes about 0.75 s per block with iron and 1.15 s with stone. These are computed from the
  wiki's Breaking formula, not read from a table.
- **The first descent.** The first descent of a town's stair, from 64 to −53, is 117 steps × 3 cells ≈ 351 digs, about
  5-7 min of digging with iron.
- **Later descents** walk the certificate at 0 digs.
- **The evidence supports M7.** The alternative is section 3's bottom band.

### M8, accepted: one or two deep miners per town, by the job assigner

The evidence argues for the cap. The interface needed from cooperation-1023 follows.

**The job `deep_miner`.** The record lives in world facts, under the keepout pid lock. It has a fencing generation
(`gen`) that increments on every acquire.

```
{ bot, gen, phase: descending | branch | ascending | out, work_expires, renewals }
```

**The cap.** At most **2 records per town with phase ≠ `out`**. **At most 1 of them below the stair top.**
- A second leaseholder's descent is admitted only when the other record is `out`, dead, or retired by an operator.
- A disconnected record keeps the underground slot, because absence is not exit. The second miner then does other
  work above ground. It is not underground, so it cannot be stranded by this.
- An acquire that would make a third is refused. The cap is enforced, not a preference.
- An acquire that meets a busy lock (`WF_LOCK_BUSY`, worldfacts.mjs:184) is also refused, and retried at the next
  decision.
- World facts are kept per pool (`_pool-<pool>/world-facts-<pool>.json`), and a pool is one world, so the cap is per
  world.
- A record leaves the cap only when:
  - its bot is seen at or above the stair top (phase `out`);
  - for `uncertified`, it is on the surface anywhere, with `exitDebt` = 0;
  - or the bot is dead.
- **Work expiry** (60 min, renewable once) changes only `descending` or `branch` to `ascending`. The bot stays in the
  cap until it is out.
- **Disconnect.** The record stays; nothing expires it. On reconnect:
  - a bot whose record is certified and not `out` resumes as `ascending`, and runs `stairReturn` first;
  - an `uncertified` record resumes `uncertified`, and runs today's chain. A bot whose record `gen` is stale (reassigned while it was away; possible
  only if it died) acquires nothing and ascends.
- **Absence is never evidence of exit.** A record that is not `out` stays in the cap until its bot is seen at or above
  the top, or dead.
  - After 24 h unseen, `_deepmine_stale` goes into the fleetstatus alarm header.
  - Only an operator can retire a record, after confirming the bot is out or gone.
- **The cap key** is the town (world + town id), so multi-town worlds count each town apart.

**Traffic.** Only one miner is underground, so there is no miner-to-miner traffic. The two lanes give redundancy
against breaks.
- The lanes are open to each other.
- A bot blocked for more than 20 s by an obstruction steps into the other lane.

**Confinement.** Inside the stair area (within the stair's footprint and branches, below the top), a **certified**
leaseholder runs only `deep_miner` and `stairReturn`. Any other skill (explore, goto, gather, mine) declines with
`lease_confined`. The decline is added to the runner's non-counted declines, like `runner_reserved`.
- Survival reflexes and F1 are not skills, and are never confined.
- The next action after any confined decline is chosen by the cognitive order chain, not the model: `deep_miner` while
  working, `stairReturn` when ascending. The bot never idles on declines.
- So no model-chosen skill can take a leaseholder off the route, or below the −53 floor.
- After an F1 move, the lease has ended, and the order chain runs `stairReturn`. `stairReturn` itself starts, when
  the bot is off-route, with the walk back, then the dig back, then the handover.
- **Gate (certified phases only):** 0 leaseholder actions off-route, except F1's own moves and the bounded recovery
  operations: the walk back and the dig back. Those log `_deepmine_recover`, and the gate admits them. `uncertified`
  actions are not gated by it; they are logged as `_deepmine_uncertified`.

**Preconditions.** The assigner checks them, and the skill re-checks them at its start. A failure is a decline, not a
counted failure.
- Health 20.
- F1 and F4 KEPT, read from the build's licence rows.
- Pickaxe uses:
  - with a certified town stair: branch 200 + floor 30 + 20 for ore;
  - while the stair is still being cut: priced on the steps remaining in this lease, at 6 uses per step. The cut spans
    leases, and the certificate persists between them. Each lease also needs 50 spare.
- A dedicated iron-or-better pickaxe with ≥ 20 uses, for ore.
- ≥ 64 seal blocks, beyond the 32-block floor. If the bag is short, the skill withdraws them from town stock before
  admission. Today town deposit keeps only 8 of the cheapest scaffold block (bankable.mjs:183).
- ≥ 6 free slots.
- Peaceful, so food is not a precondition.
- Torches are optional.

**Budgets, checked continuously.**
- A certified stair costs 0 to walk.
- Cutting costs 6 per step (two lanes, 3 cells each).
- A branch costs 2 per block.
- The floor is never spent except by `stairReturn` repairs.

**The lease ends** on any of:
- a full bag;
- uses down to the floor plus the branch re-cut reserve at the bot's position;
- an F4 `stop`;
- an F1 firing;
- health ≤ 14;
- work expiry.

**Ending it.**
1. Phase `ascending`.
2. Walk the branch route back to the stair.
3. `stairReturn` up the up lane.
4. Bank.
5. Phase `out`.

**Off the route after an F1 move.**
- **The displacement is not bounded vertically.** Repeated firings, an `airborne` fall, or an aimed escape with partial
  support can drop the bot into a cave below a branch.
- **Recovery:**
  1. Walk back on the zero-break profile.
  2. If that fails, dig back to the nearest route cell under F4's planner, within the shared repair allowance.
  3. If that fails too: **the universal handover** (F6). Phase `uncertified`, today's exit chain with the whole kit,
     the guard lifted for its own exit, and the alarm only if today's chain gives up (O11).

**Work no-progress.** In `descending` or `branch`, 3 `deep_miner` attempts, or 10 minutes, without a new step, a new
branch block or an ore moves the record to `ascending`. The bot does not spin until work expiry.

**Rows.** `_deepmine`, per phase change: gen, steps, branch blocks, ores seen and mined by kind, seals, end reason,
diamonds banked.

### M9, accepted: a safe staircase down, then branch tunnels at diamond depth, with no water buckets

**The stair** is F6's two-lane spiral.
- It is sited by gate D0, lined, reserved, and certified.
- The stair starts at the surface. Composing it with shaft-01's landings needs T6's full route, and is left to a
  later design.
- A torch on the inner wall every 8 steps is the visible marker. No decision reads it.

**The depth is feet at y = −53.**
- The Aquifer wiki page gives the lava surface at −54. Tutorial:Mining says air at −55..−63 becomes lava.
- The two disagree by one block, so −53 is the first level clear of both.
- Diamond peaks at −58/−59, so this gives up some ore.

**Branches.**
- 1 wide and 2 high, every 4 blocks, up to 32 blocks long.
- Every action goes through F4's planner in its horizontal form: six faces plus the cells beyond, and unknown counts
  as unsafe.
- Every branch step is **reversible**: a solid, non-falling floor, and a level walk back. It extends the certificate
  as the branch route.
- **A branch never opens into air or a cave.** A face that is air with a void beyond it means `turn`. This keeps deep
  miners off cave floors, the falls population.

**Ore.**
- Found with `findBlocks` within 16.
- An ore is mined only from a branch cell, never by digging down onto it.
- Its six faces and the cells beyond them must be free of DANGER (Baritone's `plausibleToBreak`).
- Ore at or below the −54 band is skipped unless it borders the branch from a side and the cell under it is solid and
  not DANGER.
- Lapis, redstone, iron and gold are mined by the same rule.

**Gate D0 (offline, before any build).** Read the region files read-only, as M0 did.
- Per world and per candidate site, emit the **exact spiral route and its shell**, from the surface down to −53. List
  every obstruction, the lining needed (falling blocks, liquid and DANGER in the shell), and the dig and block cost.
  This is the envelope survey F6's siting relies on. Live reads re-check each level before it opens, because bots may
  have changed the terrain.
- Under each town, count diamond ore, lava, water and air in a 64-block box at y −60..−50.
- Record Paper's anti-xray setting. oretunnel.mjs:3-4 says it is off, but that is unverified, and fake ore would
  mislead `findBlocks`.
- Report the expected diamonds per branch-hour.
- Worlds that share a seed share the answer.
- The deep deaths in placebo-a say the box must be read before a stair is sited there.

### M10, accepted: diamonds go to pickaxes first, then an enchanting table, and no diamond armour

**Banking.**
- Diamonds are already in `bankable.mjs`.
- The deep miner banks them at the end of each lease.
- The town index records them.

**Pickaxes.**
- Toolkit makes diamond pickaxes (3 diamonds + 2 sticks) for the town's deep miners first, then for general use.
- Worn-first applies.

**The enchanting table** (2 diamonds + 4 obsidian + 1 book). Two inputs are blocked today:
- **Obsidian.** With M9 it must be natural, and it is mined with a diamond pickaxe. Under the ore rule, obsidian
  beside lava cannot be mined. Ruined portals are the realistic source.
- **A book.** It needs 3 paper and 1 leather. In peaceful, leather means killing a cow, and the fleet has no attack
  skill.

That is owner question O5.

**Lapis and XP.**
- 1,429 lapis are reported in chests; not re-measured.
- XP comes from ores and smelting.
- Without bookshelves, the table offers enchantments up to level 8.

`enchant-01` stays a sketch until O5 is answered.

---

## 9. Code facts this rests on (file:line, base 6e1afb52)

**Danger and lava reflexes.**
- Danger arm: reflex.mjs:2541-2559. `escape()`: 5948-5953. `DANGER_BLOCKS`: 74.
- Idle stand-off: 2519-2539, gated on no skill ended in the last 20 s.
- lavaguard.mjs:

  | Function | Line |
  |---|---|
  | `cellLavaSafe` | 10 |
  | `dropLavaSafe` | 29 |
  | `corridorSafe` | 48 |
  | `holdForwardSafe` | 68 |
  | `lavaStandOff` | 84 |
  | `stepLineSafe` | 116 |

- `_lava_corridor` is the `path_update` hook (index.mjs:1020-1034).

**Entombment.**
- `isEntombed`: reflex.mjs:3391-3442. The arm: 3028-3268. Claims silence it at 3034.
- `isEntombedForTest`: 6214. `climbNeedAbove` returns at least 1, or its cap: 359-372.

**`mine`.**
- 12409-13374 in skills.mjs. `descentStepCells` (14458) opens tread, head and above.
- Dig order: 13021.
- Checks: 12880-12908, 12957-12967, and the fall probe at 12931-12951.
- Push: 13146-13181. `stairLiquid`: 13263. `chooseStairBearing`: 13362.
- Goal clamp: 12440. Home refusal: 12466-12475. The 90-step cap: 12818.

**Exit contract** (exit-contract.mjs:108-176). Debt is 63 − y. The swings formula is `descentPickNeed`.

**Ore tunnel.** In oretunnel.mjs, `breakHazard` checks six faces (68) and `stepHazard` checks `cellLavaSafe` (89).
`tunnelToOre` (skills.mjs:1717-1833) handles iron only.

**Logger.** `logEvent` `args` is flattened structured data (logger.mjs:110-134). The detail is capped at 300
characters.

**Pathfinder** (`lib/movements.js`).
- Lava is in `blocksToAvoid` (53), so it is never `safe` (233). `getLandingBlock` refuses an unsafe landing (462).
- `safeToBreak` checks above and four sides, but not below (252-263).
- The walk profile allows towers and scaffold (index.mjs:426-450). `canDig=false` alone is not zero-place.

**Runner.** `reserve` is at runner.mjs:48-90 and the claims at 138-181.

**Tier rule.** tierrule.py:84-108.

---

## 10. Prior art (searched 10-23)

**mineflayer-pathfinder.**
- `dontCreateFlow` checks above and four sides; an unloaded neighbour fails open.
- #141 "Pathfinder doesn't avoid lava" is open. It is blamed on physics, and diagonal-down moves do not check the
  final block.
- #78 and #354 cover gravel.

**mineflayer.**
- #2600: ghost blocks under lag (open).
- #3731: buckets unreliable on 1.19-1.21. That supports M9's no-bucket rule on engineering grounds too.

**Baritone.**
- `avoidAdjacentBreaking` checks above, and the sides for sources; it never checks below.
- `MineProcess.plausibleToBreak` skips ore beside lava.
- `legitMineYLevel` is −59.
- `pauseMiningForFallingBlocks` and `avoidUpdatingFallingBlocks` are on.
- Issues #290, #3995 and #4645 cover mining beside lava and falls into lava after an off-centre re-plan.

**Mindcraft.** `digDown` stops for lava or water at the target or below. `self_preservation` places water or walks
to water when in lava.

**Voyager.** collectblock disables `dontCreateFlow` and `dontMineUnderFallingBlock` (#146).

**Odyssey.** `mineDiamond` digs straight down.

**No paper found analyses agent lava deaths.**

**Ideas taken:**

| Idea | Where |
|---|---|
| six faces plus beyond, unknown is unsafe | F4 |
| skip lava-adjacent ore | M9 |
| stair, never shaft | M9 |
| plug with a block, only where it can be placed safely | F4, F1 |
| mine above the lava band | −53 |
| wait for gravel | F3 |
| stop centred before re-planning | F1 |
| torches on one side | M9 |

---

## 11. Owner questions (with recommendations)

**O1: F1's aimed escape.** With no verified step and no seal, the bot sprints along the bearing that scores best for
support, collision and DANGER over 6 blocks, rather than holding still. **Recommend yes.** Holding still in lava is
certain death. Whether the aimed sprint beats today's facing-direction sprint is for Paper to show; it is not claimed.

**O2: F2's endpoint and bound.** The endpoint is a free cell from the last 120 s, at least 3 blocks away, walkable, in
an open component (the search reaches 64 nodes). The bound is 2 declines per 8-block area per 10 min, throttled at
15 s. **Recommend yes.** These are constants, and Paper tunes them.

**O3: the order** F1 → F2 → F5a → F4 → F5b, then F6 with `deepminer-01`, with F3 on a sandbox in parallel.
**Recommend yes.** If diamonds should come sooner, F5b can follow the diamond tier, because deep miners stay on
certified routes.

**O4: falls into caves.** 83 deaths a week (30%), mostly gather and goto paths whose floor gave way. **Recommend a
separate scoped item after this one**, starting from `_fall_path`. The diamond tier does not depend on it, because of
the reversible-step rule.

**O5: enchanting inputs.**
- **Obsidian:** natural only (ruined portals), or one surveyed exception later: a placed water source on a lava
  source, never carried underground. **Recommend natural only for now.**
- **Leather:** a peaceful "hunt one cow" skill, or wait. **Recommend wait.** Pickaxes first (M10) delivers value
  without it.

**O6: depth.** Feet at y=−53 rather than −58/−59. **Recommend −53.** D0 quantifies the ore given up.

**O7: credit scope.**
- Exit-contract credit applies only to deep-miner leaseholders on the certified town stair. Ordinary bots keep
  today's contract everywhere. r2's credit for ordinary bots above y=0 is withdrawn: an unprotected stair has no
  provable break remedy.
- **Recommend accepting this.** Iron mining is unchanged. Credit for ordinary bots can come back later, as its own
  design, with protected stairs.

**O9: the two-lane town stair.**
- It doubles the first cut, to about 700 digs. With 3 iron pickaxes per lease that is roughly 2-3 leases. It needs no
  traffic mutex.
- **Recommend yes.** A 1-wide shared stair needs a mutex with expiry and reconnect rules, and both reviewers found
  dead ends in that.

**O11: the one deep residual.** Every deep-route failure hands over:
- both lanes broken;
- a branch that cannot be re-cut;
- off-route after F1;
- no progress on `stairReturn`.

The bot walks what is left of the route, then runs today's exit chain, with the guard lifted for its own exit and
no other miner being underground.
- Its kit, about 30-94 swings, can be smaller than today's contract would ask for at that depth (about 147 at −53). So
  today's chain can give up. That is the residual, and it is comparable to a bot that falls into a deep cave today.
- With one miner underground at a time, no miner's escape can break another's route.
- **The residual** is today's chain giving up (`uncertified_stranded`), which raises the alarm header.
- **Under "do not change the world",** the person who sees the alarm can:
  - retire the record;
  - restart the bot's process;
  - or, by the owner's decision, `/kill` the bot so it respawns.

  They may not teleport it or edit the world.
- In peaceful, a stranded bot neither starves nor is attacked.
- **Recommend accepting the residual, with `/kill` left as the owner's call.**

**O13: two miners underground at once.** M8 allows one or two deep miners per town.
- The design keeps two leases, but only one bot underground at a time.
- Concurrent occupancy needs miner-to-miner coordination: protected footprints, freshness, disconnect fencing and
  traffic. Four review rounds found a new dead end in that each time.
- **Recommend single occupancy for the first diamond canary.** Design concurrency separately if the yield justifies
  it.

**O10: what M7's "seal" will mostly look like.**
- Lava that touches an open cell has usually flowed into it already. Lava behind stone is never opened into.
- So in `mine` a lava meeting will mostly end in `turn` or `stop`. Seals happen where lava has entered the stair's own
  cells, and on F1's lava edges.
- **For the owner's information. No decision is needed.**

**O8: stock numbers.** "4 diamonds / 1,429 lapis" was not re-measured; the bags hold 0 and 6. **Recommend one
read-only chest census** before `enchant-01` is sized.

## 12. What this does not show

- That F1 saves the bots the sprint is associated with. That is Paper's job.
- The share of entombed firings that are walk-back geometry. F2's read measures it.
- The cause of the suffocations. That is F3.
- Gravel and sand entombments. No instrument sees them.
- Deep death rates with precision. There are 39 bot-h of exposure, and one world dominates.
- The diamond yield at −53. That is D0.

## 13. Review record

`docs/reports/mineshaft-safety-reviews-2026-10-23.txt` holds every round, verbatim, with the response to each finding.

## 14. Reproduce

`docs/reports/mineshaft-safety-2026-10-23.measure/`.
- The ES scripts run on 10.0.0.31 against `~/estel/scripts`. Each writes its JSON to `~/mineshaft-1023/`.
- `es5.py`'s output is compressed before `e1.py` and `e2.py` read it: `gzip -k entomb7d.json`.
- Copy the JSON next to the local analysers to run them.

| Script | What it produces |
|---|---|
| `es1.py` | totals, death rows |
| `es2.py` | per-death context |
| `es3.py` | depth exposure, entombed aggregates |
| `es4.py` | danger rows |
| `es5.py` | the entombment stream |
| `es6.py` | mine calls |
| `es7.py` | escape cost, bags |
| `es9.py` | milestones, explore-toward |
| `d1.py`-`d6.py` | r1 death analyses |
| `d7.py` | r2/r3: cell-matched warnings, interval overlap, censored episodes split at deaths, event-row pre-death depth and first damage |
| `d8.py` | r4: the explicit death-message tally (UNKNOWN = 0); danger episodes split at every death, right-censored ones dropped (0) |
| `e1.py` | episodes |
| `e2.py` | r2: split at deaths, per-bot base rates, the suffocation association |
| `m1.py` | mine depth, exit refusals |
| `probe-entombed.mjs` | the predicate probe; run from `bots/` with `OLLAMA_MODEL` set |
