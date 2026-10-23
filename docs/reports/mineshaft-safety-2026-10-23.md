# Mineshaft safety: lava and entombment underground, then diamonds and enchanting (2026-10-23, measurement + design, r2)

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

**r2** takes in the r1 reviews. Codex returned CHANGE with 11 P1; Claude returned CHANGE with 6 P1. Section 13 has the
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
   - **Not digging.** 1 died while `mine` was running. At most 16 had any mine or gather executing in the last 30 s.
   - **The danger reflex's blind sprint.** 67 of the 84 deaths came during or within 20 s of a danger-block episode,
     which is the reflex that calls `escape()`. `escape()` is a blind 1.5 s sprint-jump forward, in whatever
     direction the bot faces (reflex.mjs:5948).
   - **How often episodes kill.** An episode that starts with dry feet over a DANGER block below ended in a lava death
     31 times out of 303 (10%). One that starts with the feet already in lava did so 32 times out of 65 (49%).
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
   - **How shallow.** 2.3% of bot-time is below y=0. There are 0 diamonds in 80 bags.
   - **Rarely asked.** Only 4.3% of `mine` calls (2,765 of 63,599) target below y=0, and the exit contract refuses 34%
     of those.
   - **Swings bind, not blocks.** Pickaxe swings decide 3,008 of the 3,209 refusals, not scaffold.
   - **The contract assumes digging home.** It prices the climb home as a fresh dig (debt = 63 − y), even with the
     bot's own walkable stair behind it.
   - **No diamond goal.** There is no diamond rung.
4. **Deep is lethal per hour.** The bottom band, y −64..−33, has 39 bot-h of exposure.
   - **The rate.** It holds 15 deaths by death position, or 9 by the bot's position 30-60 s before death, all of them
     lava. That is 23-39 deaths per 100 bot-h, against about 1 at the surface.
   - **Caveat.** The exposure proxy is coarse, and one world (placebo-a) holds 10 of the 15.
   - **The consequence.** The diamond tier waits for F1, F4 and F6. M8's cap of one or two deep miners per town is the
     right bound on exposure.
5. **The safe descent built here follows M7 and M9.**
   - **The stair.** A 1-wide, 3-high staircase. Before every dig, placement and move, every opened cell has all six
     faces read, and the cells beyond any open face. Unknown counts as unsafe.
   - **Lava.** Lava visible from an open cell is sealed with a placed, server-witnessed block. Lava hidden behind
     unopened stone is never opened into; the stair turns or stops. There are no water buckets.
   - **The way home.** The stair is recorded and certified as the walkable way home. The exit contract credits it
     only through a deep-miner lease.
   - **Branches.** Branch tunnels run at feet y=−53, above the generated lava band.

**Ordered fixes:**

| Order | Fix | What it is | Tier |
|---|---|---|---|
| 1 | F1 `lavastep-01` | the danger arm makes a verified, bounded move instead of a blind sprint | 2 candidate (after Paper) |
| 2 | F2 `tombexit-01` | entombed only if the bot's recent free cell is not reachable on foot | 2 candidate (after Paper) |
| 3 | F5a `lavatarget-01` | explore-toward-known skips iron targets beside lava the bot has seen | 2 candidate |
| 4 | F4 `minelava-01` | `mine` reads six faces, seals visible lava, never opens into hidden lava, no blind push, deterministic in-call return | 3 |
| 5 | F6 `deepstair-01` | certified own-stair return route, with credit gated by a lease below y=0 | 3 |
| 6 | F5b `lavasight-01` | per-world lava memory in routing, with egress rules | 3 |
| — | F3 `inwall-01` | Paper investigation only, until a mechanism is shown | — |

Then the diamond tier: `deepminer-01` (job, spiral stair, branches), `diamond-01` (banking and pickaxes), then
`enchant-01`.

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

All 84 `fire` deaths are lava:
- "tried to swim in lava": 48;
- "... after falling N blocks": 32, falls of 4-29 blocks, median 6;
- "discovered the floor was lava" (magma): 4.

There were no "burned to death" deaths.

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
- The context is only 150 s, so a skill that started earlier and ended inside the 30 s is missed. 16 is therefore
  not a hard upper bound.
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

**Episodes.** An episode is a run of rows on one bot no more than 30 s apart. A death counts against an episode if
it falls between the episode's first row and 20 s after its last.

| First row | Episodes | Lava death in the episode window |
|---|---|---|
| feet `air`/`cave_air` (DANGER below) | 303 | **31 (10%)** |
| feet `bubble_column` (magma below) | 44 | 4 |
| feet already in a DANGER block | 65 | **32 (49%)** |

- 67 distinct lava deaths fall inside an episode window.
- Health at the first row was ≥ 16 in 59 of the 63 fatal `air`/`lava` episodes.
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

Deaths are binned two ways against the same exposure: by the death position, and by the bot's position 30-60 s
before death (pre-death; `d7.py`).

| y band | bot-h | deaths (at death) | per 100 bot-h | deaths (pre-death y) | per 100 bot-h | lava (pre-death) |
|---|---:|---:|---:|---:|---:|---:|
| ≥ 64 | 3,699 | 34 | 0.92 | 39 | 1.05 | 24 |
| 48..63 | 5,802 | 103 | 1.78 | 108 | 1.86 | 13 |
| 32..47 | 2,448 | 40 | 1.63 | 41 | 1.68 | 23 |
| 16..31 | 756 | 10 | 1.32 | 34 | 4.49 | 4 |
| 0..15 | 421 | 32 | 7.61 | 21 | 4.99 | 1 |
| −32..−1 | 273 | 42 | 15.4 | 6 | 2.20 | 5 |
| **−64..−33** | **39** | **15** | **38.8** | **9** | **23.3** | **9** |

18 deaths had no position row 30-60 s before death.

**Binning by pre-death position moves the falls up**, which is the point of doing it.
- Under −32..−1, 42 deaths by death position become 6 by pre-death position. Those bots fell in from above.
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
- In 10 of the 17, the entombed and marooned rows rise 3 or more blocks: an escape climb.
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

**The variable.** The danger arm's `escape()` becomes `dangerMove(at, state)`, a pure function that returns
`{case, moves[], controls}`. The movement code executes it, and stops on any failed post-check.

**Inputs, read live on each firing:**
- feet cell, the cell below, `onGround`, `isInWater`, position, yaw;
- block reads within 3.

**Cases:**

| Case | When | Moves |
|---|---|---|
| `airborne` | `!onGround`, feet not in liquid | Release forward/sprint/jump. No steering. The arm re-evaluates every tick until landing, instead of every 2.5 s. |
| `edge` | `onGround`, feet clear, below is a DANGER block (lava under the centre; magma floor) | A breadth-first search of ≤ 3 walk steps (`stepPlan`, below). Executed **without sprint or jump**: a walk, look first, centred arrival, ≤ 1.5 s per step. |
| `in` | Feet cell is lava, fire or magma, or a `bubble_column` with magma under it | The same search, but the **first** step may leave a hazard cell: only the origin is exempt. The first step is taken with sprint and jump (climbing out of lava needs a jump); later steps walk. |

**`stepPlan` validates each step:**
- the destination is a body cell with feet and head passable and not DANGER;
- the floor is solid and not DANGER, and is known;
- `cellLavaSafe` holds at the destination;
- the swept 3-wide line from origin to destination is supported and lava-free (`lavaStandOff`'s exact sweep; only the
  origin is exempt);
- |dy| ≤ 1 per step.

Unknown cells refuse. Every cell is read now: there is no trail, so a stale or remote cell cannot be chosen. The
search stops at the first cell that is `cellLavaSafe` with no DANGER block in its 3x3 at feet and below. That cell is
the **safe cell**.

**When no plan exists.** This is deterministic and bounded. It replaces r1's open-ended hold.
- **`edge`, step 1: seal.** If the bot holds a seal block (cobble or cobbled_deepslate; never dirt or gravel), it
  places one into the DANGER cell under its centre, against a visible solid face (section F4's placement rule). The
  seal must be witnessed by a `blockUpdate` within 1 s. After a witnessed seal the case is re-evaluated.
- **`edge`, step 2: aimed escape.** If there is no seal block or no face, it runs today's escape, but aimed. The bot
  first turns to the bearing with the fewest DANGER cells in its swept 3-wide line (ties: away from the nearest
  DANGER cell), then runs today's sprint-jump.
- **`in`: aimed escape.** It turns as above, then sprint-jumps.
- **Never worse than today.** Today's sprint goes wherever the bot faces. The aimed sprint goes the same way only when
  no better bearing exists.

**Contention.**
- F1 calls `bot.pathfinder.setGoal(null)` before moving, so it halts a concurrent path. That includes a watchdog
  relocation or poolescape route. It uses the existing `haltPath` helper (the 09-29 stale-stop lesson: `setGoal(null)`
  then `stop()` left a flag set).
- It takes no runner reservation. A watchdog reservation expires on its own (≤ 20 s) with its existing
  `reserve_expired` decline.
- Leaving lava outranks every recovery, as the tick comment already says.

**Rows.** `_lava_retreat` is written **per firing**, at most one per 2.5 s while it is not airborne. Its args:
- `episode`, `n`;
- `case`, `onGround`, `feet`, `below`, `from` (x,y,z floats), `yaw0`;
- `plan`: up to 3 cells, each with feet/head/floor names and the swept-cell names;
- `seal` (cell, face, item, witnessed);
- `aim` (bearing, danger count per bearing);
- `controls` (forward/sprint/jump/sneak, as set);
- `after` (position, feet and below names, hp at +1.5 s).

Also `_lavastep_mode`, the licence and kind. Rollback is `LAVASTEP=0`.

**Read.**

*Effect: lava deaths within an episode window, per episode, DiD.*
- **Power is low.** The fleet has about 412 episodes a week. Four pools for 6 h expect about 4.
- So the canary read is a tripwire plus correctness gates. The effect evidence is Paper.

*Correctness gates* (evidence = defect; each recomputed from `plan`, `seal` and `controls`):

| Gate | Condition |
|---|---|
| G1 | 0 executed steps whose recorded destination, floor or swept cells include a DANGER or unknown cell, other than the `in` origin |
| G2 | 0 aimed or legacy escapes while a valid plan existed (`stepPlan` replayed on the recorded cells) |
| G3 | 0 `edge` or `airborne` firings with sprint or jump set |
| G4 | 0 seals of dirt or gravel, or unwitnessed seals treated as done |

Each gate's mutant is replayed on Paper: allow lava in the sweep; skip the plan; sprint on `edge`; accept an
unwitnessed seal.

*Exposure declared:* ≥ 3 episodes on the canary arm. Otherwise INCONCLUSIVE at +360 (owner 10-15 early close).

*Paper evidence* (main):

| Scene | Setup |
|---|---|
| S1 | pool edge, facing the pool |
| S2 | 1-deep lava, 1 block from shore |
| S3 | 1-wide ledge over a cave lava lake |
| S4 | magma floor |
| S5 | falling past a lava lake edge |

- Base and variant, 20 trials each. Report survival with a 95% interval.
- The positive control is the **mechanism**: base trials record the sprint carrying the bot from a dry edge into lava
  (S1, S3). Matching the fleet's 10% / 49% rates is not required. Constructed scenes do not sample the fleet's
  situations.

**Draw exposure.** Pools with ≥ 20 danger episodes in 7 days: placebo-a 30, hive-a 28, hive-b 28, board-c 28,
placebo-c 26, placebo-d 23. `draw_require`: 2 of them.

**Composition.**

| Component | Effect |
|---|---|
| keepout | No digs. A seal is a placement. A destination inside a fire column is allowed: leaving lava outranks the column, as survival digs do today. The row names it. |
| protectzone | Walks are not wrapped. A seal is a survival placement and is exempt. |
| poolescape, homefix | Their paths are halted. Their reservations expire as today. Unchanged otherwise. |
| minewell | None. A seal is never placed in a well shell: the shell is water and stone, not DANGER. |
| runner reservation | F1 takes none. |

**Refusal chain.** The search, then the seal (`edge`), then the aimed escape. Every branch is executable from where
the bot stands. The chain test covers every scene start through to the next decision, and asserts that the bot ends
on a safe cell, in the aimed escape, or airborne, which re-evaluates on landing. There is no fourth state.

### F2 `tombexit-01`: entombed only if the bot cannot walk back to where it was just free

**The variable.** `isEntombed` gains a last conjunct, `!walkBack(at, feet, freeCells)`.
- `freeCells` is a ring of the bot's last 120 s of ground cells at which `isEntombed` was false. It is cleared on
  death, respawn, relocation and teleport.
- `walkBack` is a breadth-first search of at most 64 nodes over the walk profile's own moves:
  - same level; step up 1 with headroom; drop ≤ 3 onto solid;
  - no dig, no place;
  - every cell known, with no DANGER cell.
- It returns true when the search reaches any cell in `freeCells` that is at least 3 blocks from the feet.

**Why this endpoint.** The bot was not entombed there moments ago and it walked here from there. So F2 never declares
a bot less trapped than it was at a cell it occupied in the last 2 minutes. A sealed pocket the bot was pushed or
spawned into has no free cell, and stays entombed. That includes the suite's TOMB and a covered 2-cell pocket.

**The bound.** A decline happens at most **twice per cell (1 block) per 10 minutes**. The third firing there runs
today's arm. A bot misled by a decline cannot loop.

**Probe fixtures.** The r1 fixtures are re-built for r2 with a `freeCells` history:
- a tunnel walked into from its mouth;
- a 2-high stair walked down;
- an alcove stepped into.

Counterexamples that must stay entombed:
- TOMB, with no history;
- a 6-long tunnel sealed behind the bot after it entered, with no reachable free cell;
- a one-way drop into a pit: the free cell is above a 4-block drop and cannot be walked back to.

**Rows.**
- `_entombed_declined`, sampled at most once a minute per bot. Args: `cell`, `free_cell`, `free_age_s`, `path_len`,
  `nodes`, `decline_n`.
- `_tombexit_mode`, the licence and kind.
- Rollback: `TOMBEXIT=0`.

**Read.**

*Effect* (DiD): `_entombed` rows per bot-h. The baseline is about 6.5. This is the measurement of r1's open question:
what share were walk-back geometry.

*Companions:*
- interrupts by entombed per bot-h;
- scaffold spent in entombed escapes per bot-h (`_inventory_mutation`);
- gather successes per bot-h.

*Guards* (WATCH/HOLD):
- entombed spells longer than 10 min;
- `_entombed_unrecoverable`;
- `_reflex_stuck` and `_livelock_escape` per bot-h. These are the backstops that see a bot whose decline was wrong.

*Tripwires:* drowning and suffocation, on the two-death floor.

*Correctness gate G1:* 0 `_entombed_declined` rows followed within 120 s by **no displacement ≥ 2 blocks** and a
third firing at the same cell. That is the "declined, but could not leave" defect. It is computable from
`_entombed_declined`, `_entombed` and positions.

*Mutant control:* `walkBack` accepts any cell. On Paper's sealed-tunnel scene, G1 must trip.

*Exposure* is met in minutes. Tier 2 with licence kind `_tombexit_mode` and evidence kind `_entombed_declined`.

**Draw exposure.** Every pool. The lowest is board-d, at 1,857 episodes a week.

**Composition.**

| Component | Effect |
|---|---|
| mine / tunnel `'stair'` claim | Unchanged. |
| marooned state and escape success (reflex.mjs:2634-2641, 3264) | Both read `isEntombed`. Under a ceiling the marooned branch is already inert (`!upIsOpen`). The success test reads "no longer entombed" and stays truthful: a bot with a walk-back is not entombed. Both get chain tests. |
| air / pocket / poolescape | Run before the entombed arm. Unchanged. |
| keepout, protectzone | Fewer escape digs and survival placements inside them. |
| homefix, runner reservation | Fewer interrupts; no reservation taken. |

**Refusal chain.** A decline is not a refusal. It hands the bot to the next decision, with a real walk route (the
search used the walk profile's own moves). The bound hands the third firing to today's arm. The stuck arm and the
livelock escape remain behind both.

Gather deliberately does not take a `'stair'` claim. That would also silence real entombments.

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
| Gate G1 | 0 explore-toward targets chosen with a ring cell within 6 (recomputed from the skip rows and the ring dump on `_lavatarget_mode` each hour) |

**Tier 2 candidate.** Draw: pools with ≥ 1,000 `_lava_corridor` rows a week.

**Composition.** It changes target choice only. keepout, protectzone, homefix, minewell and the reservation are
unchanged.

**Refusal chain.** It refuses nothing. The fallback is today's random bearing.

### F4 `minelava-01`: `mine`'s stair reads six faces, never opens into hidden lava, seals visible lava, and returns deterministically

This is a **bundle**, registered as one canary. Its parts cannot be separated without creating the dead end CLAUDE.md
names: a stop with no return.

**The planner.** `stairLavaPlan(at, action, bot)` is pure. It is called fresh before **every** dig, re-dig,
placement and move of a step. That includes the falling-block re-open and the recovery re-dig (skills.mjs:13021,
13148).

**What it reads.**
- For each cell the action opens, or the body enters: all six faces, plus the cell beyond any face that is air or
  liquid.
- The step's floor cell (y−2) and the cell under it.
- DANGER = `LAVA_LIKE`. **Unknown = unsafe.**

**Verdicts:**

| Verdict | When | Then |
|---|---|---|
| `clear` | no DANGER and no unknown | proceed |
| `seal` | a DANGER cell **is visible from a cell already open** (the bot's current body cells, or a cell this step already opened): it touches that open cell, and some solid neighbour of it shows a face toward that open cell within 4.5 blocks of the eye, with a clear line | place a seal block (cobble or cobbled_deepslate) against that face, into the DANGER cell; witness a `blockUpdate` within 1 s, re-read, re-plan |
| `turn` | a DANGER cell lies behind a cell not yet opened; or under the floor; or more than one face deep; or any face is unknown | the bearing is excluded for the rest of this call, and `chooseStairBearing` re-plans the remaining bearings |
| `stop` | no bearing can `clear` or `seal` | stop (refusal chain below) |

**Seal conditions.**
- The bot stands on a solid, non-DANGER floor, and its body cells are DANGER-free.
- It holds ≥ 1 seal block.
- The placement is not into a protected zone. A placement there is refused, so the verdict becomes `turn` with
  `zone`.
- A **hidden lava cell is never opened into, then plugged.** Lava flows 4 blocks at 30 ticks per block. Racing it is
  not "slower but safer" (M7).

**Also in the bundle:**
- `stairLiquid`'s lava branch uses `LAVA_LIKE`. Magma under a tread counts as `turn`, not a dig: the stair must never
  rest on magma. The water behaviour is unchanged, because water is terrain.
- The fall probe counts lava as lava. Lava under the tread means `turn`.
- The step-recovery push requires the planner's `clear` on the push line (feet and feet−1, 3 wide, 2 ahead), and is
  skipped otherwise.
- **Deterministic in-call return.** `mine` records the stand cells of the steps it cut **in this call**. On `stop`,
  it walks them back up, newest first, with `GoalBlock` on a zero-break, zero-place profile, to the call's start cell:
  a cell the bot stood on before the call.
  - If no steps were cut, the bot is already at its start cell, and `mine`'s existing relocation runs
    (`planMineStart`: a walk ≤ 8, else ≤ 16).
  - If that finds nothing, the skill returns `hazard_interrupt` naming "lava on every bearing here".
  - A failed return step stops the return and returns `unverified`, naming the cell. The marooned and stranded
    ladders then have the body, as today.

**Rows.**
- `_mine_lava`, per planner call that is not `clear`, plus one `clear` summary per step. Args:
  - `step`, `action`, `bearing`, `verdict`;
  - `faces`: per opened cell, the six neighbour names plus beyond-cells;
  - `seal`: ref cell, face, item, witnessed;
  - `push`: the swept cells read;
  - `unknown`.
- `_mine_return`: `steps`, `from`, `to`, `ok`, `fail_cell`.
- `_minelava_mode`.
- Rollback: `MINELAVA=0`.

**Tier 3.** It changes `mine`'s geometry. Today mine meets lava about 4 times a week, so the canary's job is **no
harm**. The effect evidence is Paper.

**Read.**

*No-harm* (DiD):
- mine success rate;
- mine-attributed cobble per bot-h;
- iron gathered per bot-h;
- `exit_capability_reserve` and `hazard_interrupt`;
- `_mine_return` failure rate.

*Correctness gates* (recomputed from `faces`, `seal` and `push`, not from `verdict`):

| Gate | Condition |
|---|---|
| G1 | 0 executed digs (keepout's `_mine_dig` row) whose cell's recorded faces at plan time held a DANGER or unknown cell without a witnessed seal of that face |
| G2 | 0 pushes with a DANGER cell in the recorded sweep |
| G3 | 0 seals of anything other than cobble or cobbled_deepslate |
| G4 | 0 `stop`s without a `_mine_return` or relocation row within 5 s |

Mutants: drop the six-face read; seal with dirt; push blind; omit the return.

*Paper* (main; base must fail S1, S2 and S5):

| Scene | Setup | Expected |
|---|---|---|
| S1 | the next head cell borders a lava source visible from the bot's cell | seal, then dig |
| S2 | hidden lava behind the next tread | turn |
| S3 | lava on three bearings | relocate, or stop and return up the call's steps |
| S4 | lava behind an unloaded chunk edge | turn or stop |
| S5 | the 10-16 step-failure push, replayed | no push |

**Draw exposure.** Any 4 pools. mine runs about 5.7 calls per bot-h everywhere.

**Composition.**

| Component | Effect |
|---|---|
| keepout | A seal is a PLACE; keepout wraps digs. `turn` re-plans through `planMineStart`'s keep-out filter. |
| protectzone | Seals are not survival placements, so they are refused in zones; the verdict becomes `turn`. |
| minewell | The re-planned bearing passes the well-shell filter. |
| homefix | The watchdog may reserve the runner mid-return. The return aborts like any skill, and the next decision sees the bot on its own stair, not in lava. |
| runner reservation | `mine` keeps its `'stair'` claim through seal and return. |
| poolescape | None. |

**Refusal chain.** It ends in `stop`, then one of three branches, each executable from where the bot stands:
- with steps cut: a deterministic walk back up the call's own steps;
- with none: relocate;
- else: name "lava on every bearing", from the call's start cell, which the bot reached by walking.

The chain test covers each branch, with every reflex armed, plus interrupted-return, zone and keepout variants.

### F6 `deepstair-01`: a certified stair home, credited with a swing floor and gated below y=0

**The certificate.**
- An ordered list of a stair's stand cells, plus its top cell. Each stand cell carries its feet cell, head cell and
  the cell above (all passable), and the solid, non-DANGER, non-falling floor under the feet.
- `mine` appends a step only if the step is **reversible**: its floor is solid and non-falling, and walking up from it
  is one step-up move with headroom.
- A step that is not reversible (a void, a drop, a cave opening) ends the certificate. The next steps start a new one
  with a new top.
- A call that starts on the bottom stand cell of a valid certificate extends it. That is how a descent chains across
  calls; one call caps at 90 steps.

**Validity, checked before every step's first dig.**
- Every recorded cell is re-read: loaded, unchanged class, no DANGER in any face.
- A probe path from the post-step position to the top uses an explicit **zero-break, zero-place** profile: canDig
  false, no towers, no scaffold, no parkour, maxDropDown 1. It is the profile ziggurat T6 specified.
- Every probe node passes `corridorSafe` (the execution-time lava guard).
- The search may be cached; the block reads are not.

**Debt with a valid certificate.**
- debt = `exitDebt(top)`, today's contract applied at the top cell. The stair below the top is a walk and costs 0.
  This prices the unverified remainder above the top (Codex P1-6, Claude P1-4).
  - A stair cut from the surface: `exitDebt(top)` ≈ 0.
  - A stair started at y=30 underground: `exitDebt(30)`.
- **Swing floor.** At least `exitDebt(top)` + 30 swings are always kept, plus 16 seal blocks. The 30 swings re-dig a
  broken stair; the blocks serve F4's seals.
- **If validation fails at step k after credit has been used:**
  - the bot walks the valid part up to the break;
  - it re-digs or seals the broken cells under F4's rules, within the 30-swing floor;
  - then it continues up.
  - If the break needs more than the floor, the bot is above the break with today's contract. The `surface` chain
    (climbflood-guarded) applies from there, and the row says so.

**Scope** (M8).
- **Above y=0** the credit applies to every bot. This is iron depth, where the death rate is ~1-2 per 100 bot-h.
- **Below y=0** it applies only while the bot holds a `deep_miner` lease (section 8).
- Until the cooperation job exists, below-0 credit is off. The fleet's deep exposure does not grow.

**Loaded chunks.** A cell that is not loaded invalidates the certificate, so a long straight stair loses its credit.
The deep miner's stair is a spiral (section 8), so it stays loaded.

**Rows.**
- `_stair_cert`, at each validation that changes state and once per 10 steps. Args: `id`, `top`, `steps`, `valid`,
  `why`, `cells_read` (a compact list of cell classes), `probe_nodes`, `probe_path` (≤ 32 nodes, compact).
- `_exit_credit`: `debt_old`, `debt_new`, `swings_need_old`, `swings_need_new`, `floor`, `lease`.
- `_deepstair_mode`.
- Rollback: `DEEPSTAIR=0`.

**Tier 3.** It gates going deeper.

**Read.**

*Effect* (DiD), above y=0:
- `exit_capability_reserve` refusals per mine call targeting y < 40;
- iron per bot-h;
- bot-time at y 0..40, which is exposure, not success.

*Gates* (recomputed from `cells_read` and `probe_path`):

| Gate | Condition |
|---|---|
| G1 | 0 credited steps whose recorded cells or probe path held a DANGER, unknown or non-passable body cell at that moment |
| G2 | 0 credited bots below their certificate top for more than 30 min with every `surface` failing while the last `_stair_cert` was valid |
| G3 | 0 credits below y=0 without a lease |

Mutants: credit with an invalid certificate; drop the floor; credit without a lease.

*Death guard:* deaths per 100 bot-h at y 0..40, on the two-death floor.

**Draw exposure.** Pools with ≥ 100 swing refusals a week at y ≥ 0.

**Composition.**

| Component | Effect |
|---|---|
| keepout | A certificate cell inside a fire column is invalid; the bot falls back to today's debt. |
| protectzone | The probe profile prices zones. |
| minewell | `mine` never digs a well shell, so no certificate holds one. |
| homefix | A relocation clears the certificate. |
| runner reservation | None. |
| shaft-01 (HELD) | A verified landing is a certificate top. |
| F5b | Its exclusion never covers a certified cell. |

**Refusal chain.** An invalid certificate falls back to today's debt and today's refusal and remedy. A break after
credit falls back to the walk-up, then the floor re-dig, then today's `surface`. Every step of that is executable,
because the floor reserves the swings.

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
- No exclusion covers a certified stair cell (F6), a `keepout_exit` route, or a path whose goal is home.
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
| G1 | 0 executed path nodes inside an exclusion that applied |
| G2 | 0 bots inside an exclusion area with no path for > 60 s and no downgrade attempted |

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

**The order: F1 → F2 → F5a → F4 → F6 → F5b. F3 runs on a sandbox in parallel; it takes no canary slot.**

- **F1, F2 and F5a** are small and cut the noise every later read sits in. F2 has huge exposure; F1 and F5a are aimed
  at the lava population directly.
- **F4 and F6** are the descent's prerequisites.
- **F5b** is the broadest change, with the least certain gain per canary hour. Deep miners stay on certified stairs
  and branches, so they depend on it least.

**One canary at a time.** Each closes KEEP, REVERT or INCONCLUSIVE before the next starts (CLAUDE.md).

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

The evidence argues for the cap. This is the interface needed from cooperation-1023.

**The job `deep_miner` and its lease.**
- The lease lives in world facts, under the keepout pid lock.
- At most **2 per town**, acquired atomically. An acquire that would make 3 is refused, so the cap is enforced, not a
  soft preference.
- Fields: `{bot, phase: descending|branch|ascending, expires, renewals}`. The phase is updated at each transition.
- 60 min, renewable once. A disconnected or dead holder's lease expires on its own.
- The assigner prefers bots by soft preference; admission is hard.

**The stair mutex.** It is separate from the lease. One bot on the 1-wide stair at a time, in either direction.
- It is acquired at the top or bottom and released at the other end.
- A waiter times out after 5 min and declines the job. It never cuts a second stair.
- A holder that dies or disconnects frees the mutex on expiry: 10 min, renewed every step.

**Preconditions** (assigner, re-checked at the skill's start; a failure is a decline, not a counted failure):
- health 20;
- F1, F4 and F6 KEPT on the fleet, read from the build's licence rows;
- **pickaxe uses:**
  - a certified town stair exists: branch 200 + reserve (`exitDebt(top)` + 30) + 20 for ore;
  - else: 351 + 200 + reserve + 20, which is 3 iron pickaxes;
- a dedicated **iron-or-better pickaxe with ≥ 20 uses**, reserved for diamond ore (diamond needs iron);
- ≥ 64 seal blocks;
- ≥ 6 free slots;
- peaceful worlds, so no food requirement;
- torches: optional, and used only as markers.

**Per-action budgets, checked continuously.** Descending a certified stair costs 0. Cutting costs 3 per step. A
branch costs 2 per block. The reserve is never spent except on the return.

**Ends on:**
- a full bag;
- uses fall to the reserve;
- any F4 `stop`;
- any F1 firing;
- health ≤ 14;
- the lease expires.

**The end is deterministic.**
1. Walk the branch certificate back to the stair: branches are certificate extensions, with horizontal stand cells.
2. Climb the stair certificate.
3. Bank at the town.
4. Release the lease.

If an F1 move took the bot off the certificate, it first walks to the nearest certificate cell reachable by the
zero-break profile. If there is none, today's `surface` chain applies.

**Rows.** `_deepmine` per lease, for the assigner's preference: start, phase changes, steps, branch blocks, ores seen
and mined by kind, seals, end reason, diamonds banked.

### M9, accepted: a safe staircase down, then branch tunnels at diamond depth, with no water buckets

**The stair.**
- **One town stair**, sited by gate D0 and certified by F6.
- **A spiral within a 9x9 footprint**, turning every 8 steps, so it stays loaded and near town. That is
  117 steps ≈ 14.6 turns of 8.
- **Every step is F4-planned and F6-reversible.**
- A torch on the inner wall every 8 steps, as a visible marker that no decision reads.
- When shaft-01 exists, the stair starts at its bottom landing (y≈17).

**Depth: feet y = −53.**
- The Aquifer page gives the lava surface as −54, while Tutorial:Mining says air at −55..−63 becomes lava. The two
  disagree by one block, so −53 is the first level clear of both.
- Diamond peaks at −58/−59, so the depth costs some ore.

**The branches.**
- 1 wide, 2 high, every 4 blocks (3 solid between), up to 32 long.
- Planned by F4's planner in horizontal form: six faces, plus beyond.
- **A branch never opens into air or a cave.** A face that is air with a void beyond it means `turn`. This is the
  reversible-step rule that keeps deep miners off cave floors, the falls population.

**Ore** (`findBlocks` within 16).
- An ore is mined only from a branch cell, never by digging down onto it, and only if its six faces and the cells
  beyond them are DANGER-free (Baritone `plausibleToBreak`).
- Ore below the floor (−54 and lower) is skipped unless it borders the branch floor from a side, with a solid,
  DANGER-free cell under it.
- The same rule takes lapis, redstone, iron and gold.

**Gate D0, offline, before any build.**
- Read the region files read-only, as M0 did for the shaft.
- Under each town, in a 64-block box at −60..−50, count diamond ore, lava, water and air cells.
- Record Paper's anti-xray setting. The comment at oretunnel.mjs:3-4 says it is off, but it is not verified, and fake
  ore would mislead `findBlocks`.
- Report the expected diamonds per branch-hour.
- Worlds that share a seed share the answer. The placebo-a deep deaths say the box must be read before a stair is
  sited there.

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

**O1: F1's aimed escape.** When no verified step and no seal exists, the bot sprints toward the bearing with the
fewest DANGER cells, rather than holding still. **Recommend yes.** Holding still in lava is certain death, and on an
edge the aimed sprint is never worse than today's.

**O2: F2's endpoint and bound.** Endpoint: a free cell from the last 120 s, at least 3 blocks away, walkable in ≤ 64
nodes. Bound: two declines per cell per 10 min. **Recommend yes.** These are constants, and Paper tunes them.

**O3: the order** F1 → F2 → F5a → F4 → F6 → F5b, with F3 on a sandbox in parallel. **Recommend yes.** If diamonds
should come sooner, F5b can follow the diamond tier.

**O4: falls into caves.** 83 deaths a week (30%), mostly gather and goto paths whose floor gave way. **Recommend a
separate scoped item after this one**, starting from `_fall_path`. The diamond tier does not depend on it, because of
the reversible-step rule.

**O5: enchanting inputs.**
- **Obsidian:** natural only (ruined portals), or one surveyed exception later: a placed water source on a lava
  source, never carried underground. **Recommend natural only for now.**
- **Leather:** a peaceful "hunt one cow" skill, or wait. **Recommend wait.** Pickaxes first (M10) delivers value
  without it.

**O6: depth.** Feet at y=−53 rather than −58/−59. **Recommend −53.** D0 quantifies the ore given up.

**O7: below-0 credit before the job exists.** **Recommend off.** F6's below-0 credit is lease-only, so until
cooperation-1023 ships the `deep_miner` job, no bot gets deep credit. This respects M8.

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
| `d7.py` | r2: cell-matched warnings, interval overlap, censored episodes, pre-death depth |
| `e1.py` | episodes |
| `e2.py` | r2: split at deaths, per-bot base rates, the suffocation association |
| `m1.py` | mine depth, exit refusals |
| `probe-entombed.mjs` | the predicate probe; run from `bots/` with `OLLAMA_MODEL` set |
