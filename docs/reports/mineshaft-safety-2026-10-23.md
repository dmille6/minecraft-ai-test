# Mineshaft safety: lava and entombment underground, then diamonds and enchanting (2026-10-23, measurement + design, r1)

OWNER 2026-10-23 ~12:40Z: "mineshaft safety (lava + entombment underground) -> diamonds -> enchanting". Earlier owner
decision (10-19): "diamond after mineshaft safety". The owner answered M7-M10 at ~13:30Z (section 8). **This is design only.
No bot code, fleet, queue, world or sandbox was changed.** RCON was not used. The 09-30 rule against open-ended
stuck/drowning hunts applies: the scope here is underground mining safety for the diamond tier, and every fix below
is either on a mining path or on the reflex that decides whether a bot standing beside lava lives.

Base: fleet `6e1afb52` (poolescape-01), origin/main `2baad53c`. While this was measured, indexsearch-01 was deployed
on board-a and placebo-a (12:17Z). Its read belongs to the operator loop. This document starts no canary, and none of
its numbers depend on those two pools.

---

## 0. Answers first

1. **Lava deaths are not mining deaths.** Over 7 days there were 84 fire deaths, and every one of them is lava or
   magma.
   - 81 of 84 bots had lava named by their own guards at least 3 s before they died (60 of them at least 10 s before).
   - 1 of 84 died while `mine` was running.
   - 77 of 84 were "idle at the moment of death": between skills, after a movement skill had been refused or
     aborted beside the lava.
   - **The last thing that moved most of them was the bot's own danger reflex.** `escape()` is a blind 1.5 s
     sprint-jump forward, in whatever direction the bot faces (reflex.mjs:5948). It fires when lava is under or in
     the feet cell.
   - 63 of 84 lava deaths went through such an episode. Of 302 episodes that began with dry feet over lava, 31 ended
     in a lava death within 20 s. Of 65 that began with the feet already in lava, 32 did.
   - Fix F1 replaces the blind sprint with a directed retreat.
2. **"Entombed" is mostly the predicate misreading ordinary dug geometry.** There are 87,090 `_entombed` rows in
   7 days, on all 80 bots, at 1,000-1,150 per bot.
   - A behavioural probe of `isEntombed` returns **true** for the dead end of a 1x2 tunnel that is open behind, for
     the tread of a 1-wide stair, and for an alcove off a corridor. It returns false for a tunnel's middle.
   - 78% of the 61,536 episodes are a single firing.
   - The response is to pillar up. The escapes spent about 105k blocks in 7 days, 74,678 of them dirt, and 56,873
     skills were interrupted.
   - The bot-time cost is about 3-6% of the fleet: decision gaps after interrupts, plus 387 spells longer than
     10 minutes on a few chronic bots.
   - Telemetry cannot say whether gravel or sand caused any episode, because no row observes a falling block.
     **All 17 suffocation deaths followed an entombed or marooned climb within 10 minutes. The base rate is 52%.**
   - Fixes F2 (an exit-aware predicate) and F3 (investigate, then add a dig-out reflex for a body inside a block).
3. **Nothing asks bots to go deep, and the exit contract refuses the ones that try.**
   - 2.3% of bot-time is below y=0 and 0.3% is below y=-32. There are 0 diamonds in the 80 bags.
   - Only 2,765 of 63,599 `mine` calls (4.3%) asked for a target below y=0. The exit contract refused 951 of those
     (34%).
   - The binding term is **pickaxe swings** (3,008 of 3,209 refusals), not scaffold: the median bot at a refusal
     holds 287 scaffold blocks.
   - The contract prices the climb home as a fresh dig (debt = 63 − y) even when the bot's own walkable stair is
     behind it.
   - There is no diamond rung. The prompt says only "ores are below y=16".
4. **Depth is where the deaths are, per hour.** Deaths per 100 bot-h:

   | Depth | Deaths per 100 bot-h | Note |
   |---|---|---|
   | ≥ 64 | 0.92 | |
   | 0..15 | 7.6 | |
   | −32..−1 | 15.4 | falls and dripstone |
   | −64..−33 | 38.8 | 14 lava in 39 bot-h, 10 of 15 deaths in one world (placebo-a) |

   - At today's rate, a bot working at diamond depth dies roughly every 2.6 bot-hours.
   - **The diamond tier must not start before F1 and F4.** The owner's M8 (one or two deep miners per town) is the
     right way to bound that exposure.
5. **The safe descent this design builds** follows M7 and M9. It is a 1-wide staircase whose every opened cell has
   been probed for lava on all six faces, and one face beyond.
   - Lava is sealed with placed, server-witnessed blocks. There are no water buckets.
   - The stair is recorded as the bot's verified way home, and the exit contract credits it.
   - Branch tunnels run at feet y=−53, one block above the generated lava band (−54 and below).
   - A torch every 8 steps is the visible marker. The recorded stair is the trail the code uses.

**Ordered fixes:**

| # | Fix | Tier |
|---|---|---|
| F1 | `lavastep-01`: directed lava retreat | 2 |
| F2 | `tombexit-01`: exit-aware entombed predicate | 2 |
| F4 | `minelava-01`: six-face lava probe and seal for `mine` | 3 |
| F6 | `deepstair-01`: the own-stair exit credit and the trail | 3 |
| F5 | `lavasight-01`: per-world lava memory feeding routing and explore's target choice | 3 |
| F3 | `inwall-01`: Paper investigation first, then tier 2 | — |

Then the diamond tier: `deepminer-01` (job + descent + branch), `diamond-01` (banking + pickaxes), then `enchant-01`.

---

## 1. Window, sources, positive controls

**ES window.**
- 7 days: 2026-10-16 14:00Z → 10-23 14:00Z.
- 10,502,877 skill documents; 80 bots; 13,440.0 bot-h; no empty hours or 10-minute gaps (`coverage()`).
- The window does not touch 10-07.
- Caveats carried: 7 rotations at ~40-60 rows each, the 10-19 flood backfill, and "after 10-14 assumed".
- 24 h sub-window: 80 bots.

**Instruments.**
- `lib/estelemetry.py` (host copy md5 c3444ffe, identical to the repo's) for counts, terms and rows.
- Per-death context: every skill row of the dead bot in [t−150 s, t+5 s], and its llm rows in [t−30 min, t].
- Scripts are in `docs/reports/mineshaft-safety-2026-10-23.measure/` (section 14).

**Positive controls.**
- `_death` 276, split by class: drowning 91, fire 84, fall 46, other 38, suffocation 17. This re-measures the brief's
  273 (94 / 81 / 47 / 34 / 17); the window is shifted by a few hours.
- Last 24 h: fire 14, other 8, drowning 7, fall 6, suffocation 3. Fire has passed drowning, as the brief said.
- `_lava_corridor` 14,107; `_reflex_danger_block` 811; `_lava_adjacent_no_retreat` 666; `_lava_adjacent_stand_off` 114.
- `_entombed` 87,090 (13,653 in the last 24 h); `_entombed_unrecoverable` 8,478.
- `trigger=interrupt:entombed` 56,873; `trigger=llm:entombed` 29,850.
- Every zero below is reported beside a non-zero from the same query.

**Two denominators.**
- **Depth exposure** is (bot, 10-minute bucket) cells binned by the bucket's average `bot.pos.y`. That gives 80,631
  cells = 13,438 bot-h, against ES coverage of 13,440.
- **Milestone exposure** is llm decisions by `messages.milestone`: 832,539 decisions.

---

## 2. Lava and fire deaths (question 1)

### 2.1 What they are

**All 84 `fire` deaths are lava.**
- "tried to swim in lava" 48.
- "...after falling N blocks" 32. Falls of 4-29 blocks; median 6.
- "discovered the floor was lava" (magma) 4.
- No "burned to death" and no "went up in flames". `deathClass` would put the second one in `other`.

### 2.2 Depth, skill, and what the bot did in the last 60 s

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

**Skill at the moment of death** (from the `_death` detail): idle 81, explore 2, mine 1.

**Last completed skill:** explore 46 (aborted 34, success 10, no_effect 2), keepout_exit 15 (success 11, aborted 3,
no_effect 1), gather 12, mine 5, goto 4, surface 2.

**Rows in the 60 s before death, and how many of the 84 deaths had each:**

| Row | Deaths with it |
|---|---|
| `_lava_corridor` | 81 |
| `_reflex_danger_block` | 67 |
| `_explore_blind_step_refused` | 54 |
| `_explore_toward_known` (within 90 s) | 61 |
| `_fall_path` | 35 |
| `_lava_adjacent_no_retreat` | 14 |

### 2.3 Visible, or exposed by the bot's own dig?

The classifier is `d3.py`.
- "Seen" means a `_lava_corridor`, `_explore_blind_step_refused` or `_lava_adjacent_no_retreat` row naming lava, or a
  `_reflex_danger_block` row reading `lava`, more than 3 s before the death.
- "Dig" means a `mine` or `gather` row that was running within the last 30 s, or a `_mine_dig`, `_dig_approach` or
  `_mine_stair_step_failed` row.

| | n |
|---|---|
| lava seen ≥ 10 s before death | **60** |
| seen 3-10 s before | 21 |
| not seen | 3 |
| a mine/gather dig running within 30 s | 16 |
| ...of which `mine` | 3 |
| lava death while `mine` was the running skill | 1 |

**So the lava was visible, and the bots' own instruments said so.** A dig-exposed lava death is the exception: at most
16, and only 3 involve `mine`. This agrees with phase 2 on 10-07 (30 of 59 "walked in after a warning", ≤ 2 dug in).

**Seen, by depth:**

| Depth | Seen ≥ 10 s | Seen 3-10 s | Not seen |
|---|---|---|---|
| surface (y ≥ 60) | 18 | 9 | 1 |
| caves (0..59) | 29 | 9 | 1 |
| deep (< 0) | 13 | 3 | 1 |

### 2.4 The mover in the last seconds

**Actors logged in the 4 s before first damage** (`d5.py`):

| Actor | Deaths with it |
|---|---|
| `_path_reset` | 55 |
| `_reflex_danger_block` (feet in lava) | 46 |
| `_explore_blind_step_refused` | 43 |
| `_lava_corridor` | 41 |
| `_reflex_danger_block` (feet clear, lava below) | 32 |
| `_fall_path` | 14 |
| a skill row (explore/gather/mine) | 19 |

Of the 32 falls into lava, `_fall_path` says the descent happened with **no path active** in 16, an active path in 7,
and unknown in 9.

**What `escape()` does.** In the danger arm (reflex.mjs:2541-2559), `escape()` (5948-5953) is literally:

```js
bot.setControlState('sprint', true); bot.setControlState('forward', true); bot.setControlState('jump', true)
await sleep(1500); bot.clearControlStates()
```

**When it fires.** The arm fires when the feet cell OR the cell below is in `DANGER_BLOCKS` (lava, fire, campfire,
soul_fire, magma). Its row logs `feet?.name ?? below?.name`, so `air` or `cave_air` in the detail means **the feet were
clear and the lava was below**: the bot stood on an edge with its centre over lava.

**Danger-block episodes (7 d).** Rows ≤ 30 s apart on one bot form an episode.

| First row of the episode | Episodes | Fire death within 20 s |
|---|---|---|
| feet clear, lava below (`air` 89 + `cave_air` 214) | 303 | **31 (10%)** |
| feet clear, `bubble_column` below | 44 | 0 |
| feet already in lava / magma / fire | 65 | **32 (49%)** |

- In both lava rows, nearly all fatal episodes began at health ≥ 16 (59 of 63).
- 63 of the 84 lava deaths (75%) went through one of these episodes.
- Typical timeline (isolated-b-Bravo, 10-17 06:46Z):
  - explore is aborted at `danger_block`;
  - 13 blind-step refusals ("lava below at 384,70,106");
  - −6.4 s: `danger_block cave_air` ×2, hp 16;
  - −1.4 s: `danger_block lava`, hp 6;
  - death.

**What this does and does not show.**
- The sprint is blind by construction. It is the only movement the danger arm makes.
- A bot facing the pool it was walking toward is sprinted into it.
- **What is not proven:** that a different move would have saved those bots. A bot standing over lava is in danger
  whatever it does. The 10% / 49% conversions are the base the read compares against, and the Paper scenes in F1
  supply the effect evidence.

**The other guard.** `lavaStandOff`, the one-step retreat onto verified ground, runs only for idle bots whose last
skill ended more than 20 s ago (reflex.mjs:2519). The fatal episodes start 3-10 s after a skill was aborted, so that
guard is outside its window. It fired 114 times in 7 days, with 1 fire death within 20 s; "no verified retreat"
fired 666 times, with 9.

### 2.5 Milestone, not pool

Lava deaths by the bot's milestone at its last llm decision, against that milestone's share of decisions:

| Milestone | Lava deaths (of 84) | Share of decisions | Ratio |
|---|---|---|---|
| patrol | 33 (39%) | 15.0% | **2.6x** |
| gather_dirt_16 | 30 (36%) | 29.4% | 1.2x |
| gather_iron_ore_3 | 9 (11%) | 9.9% | 1.1x |
| gather_sand_8 | 5 (6%) | 13.3% | 0.45x |
| return | 2 (2%) | 17.8% | 0.13x |
| idle | 2 | 6.6% | |

**Patrol is where lava kills.**
- Patrol is movement.
- Explore is the fleet's movement. 141,921 of 142,886 explore rows start `_explore_toward_known heading for iron_ore`,
  which aims explore at a known iron ore block, often one exposed in a cave wall beside a lava lake.
- That `_explore_toward_known` preceded 61 of the 84 deaths (within 90 s).

### 2.6 Where: two seed-level hot spots

Many worlds share a seed and the home at about (356, 73, 148). Two 12-block cells hold 32 of 84 lava deaths:
- **(336, 36, 204): 18 deaths**, a cave lava lake about 60 blocks from home;
- **(396, 72, 108): 14 deaths**, a surface pool about 45 blocks from home.

In all, 48 of 84 died within 64 blocks of that home.

**78 of 84 were the first fire death recorded at their site in that world** (`_death_site_recorded ... x1`; sites
merge within 3 blocks).
- 15 had just run `keepout_exit`, so they were inside the live column of an earlier fire death 4-6 blocks away.
- keepout-01 acts after a death in one world and **only on digs**. It blocks no walk, and these deaths were walks and
  reflex moves.
- Section 6 has the composition.

### 2.7 Mine and lava today

`mine` meets lava rarely, because it rarely goes deep:
- In 7 days, `hazard_interrupt` stopped mine 3,862 times. 3,858 were water and **4 were lava** ("lava in the
  headroom" 2, "in the tread" 1, "in the ceiling" 1).

The code map (section 9) finds real gaps that will matter at diamond depth:
- **Lava directly under the next tread is not detected.** The fall probe counts lava's empty box as "hollow" and
  refuses only at ≥ 3 hollow with an unsurvivable drop (skills.mjs:12931-12951).
- **Lava beside the head or feet cells is never read.** Only the ceiling cell's five neighbours are (12957-12967).
- `stairLiquid` matches only `lava` and `water`: not magma, flowing variants, or waterlogged blocks (13263).
- **Unknown cells pass the liquid checks.**
- **No seal.** `mine()` places nothing (mining.mjs:97-104).
- **The step-recovery forward push is blind.** It holds `forward` for `STEP_IMPULSE_MS` with no hazard check
  (13146-13181). isolated-d-Echo, 10-16 18:36Z:
  - `_mine_stair_step_failed` "dug the tread ... the stair was cut and not taken";
  - `_reflex_danger_block lava`;
  - death.
  - It is one of the 3 mine-linked lava deaths.

---

## 3. Depth: exposure and death rate

| y band | bot-h | share | deaths | lava | drowning | fall | dripstone | suffocation | deaths per 100 bot-h | lava per 100 bot-h |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ≥ 64 | 3,699 | 27.5% | 34 | 24 | 0 | 10 | 0 | 0 | 0.92 | 0.65 |
| 48..63 | 5,802 | 43.2% | 103 | 10 | 80 | 0 | 0 | 12 | 1.78 | 0.17 |
| 32..47 | 2,448 | 18.2% | 40 | 28 | 4 | 2 | 2 | 4 | 1.63 | 1.14 |
| 16..31 | 756 | 5.6% | 10 | 3 | 3 | 1 | 2 | 1 | 1.32 | 0.40 |
| 0..15 | 421 | 3.1% | 32 | 2 | 4 | 12 | 14 | 0 | 7.61 | 0.48 |
| −32..−1 | 273 | 2.0% | 42 | 3 | 0 | 20 | 19 | 0 | 15.4 | 1.10 |
| −64..−33 | 39 | 0.3% | 15 | 14 | 0 | 1 | 0 | 0 | **38.8** | **36.2** |

**Caveats.**
- The exposure is binned by the 10-minute average y, while a death is binned by where the body ended.
- 30 of 40 deaths below y=0 in phase 2 were bots that had been above 0 thirty seconds earlier: falls into deep caves.
- Below −32 the counts are small: 15 deaths, 10 of them in one world (placebo-a, a deep cave reaching the −55 lava
  band).
- **The table is the right order of magnitude, not a precise rate.** Its consequence for the diamond tier is
  unambiguous anyway: the bottom band is lethal today.

**Falls and dripstone (83 deaths, 30% of all) are the leading killer between y −32 and 15.**
- Gather 40, goto 15, explore 18, idle 9.
- Falls of 12-114 blocks, mostly while a pathfinder path was active with a planned maximum drop of 0. The floor
  disappeared, or the bot left the planned line.
- Falls are not in the owner's lava + entombment scope. This document names them as finding 6 and as owner question
  O4, and builds nothing for them. The deep miner's procedure avoids cave floors (section 7), which is how it stays
  out of this population.

---

## 4. Entombment (question 2)

### 4.1 The predicate, tested

`isEntombed` (reflex.mjs:3391-3442) needs all three of:
- a non-passable cell at feet+2;
- at least 3 of the 4 cardinal cells at **head height only** that are not `notAWall`;
- ground at least 4 higher within six probe columns at distance 4.

**It never looks at feet level, and never asks whether the open side is walkable.** The behavioural probe
`probe-entombed.mjs` calls the exported `isEntombedForTest` on stone-filled fixtures built in the test suite's
conventions:

| Fixture | isEntombed |
|---|---|
| sealed 1x2 pocket (the suite's positive control) | true |
| **dead end of a 1x2 tunnel, open behind at feet and head for 3 cells** | **true** |
| middle of a 1x2 tunnel | false |
| **tread of a 1-wide down-stair (the cell it came from is open, one up)** | **true** |
| corner of a 2x2 room | false |
| **alcove off a corridor** | **true** |

So **a bot standing at the face it is digging, on a stair, or in a nook reads as walled in.** `mine` and the ore tunnel
hold a `'stair'` claim that silences the arm, which is why mine shows 2 interrupted rows in 7 days. `gather` holds no
claim, and it is 34% of the episodes.

### 4.2 Episodes (7 d)

Method (`e1.py`): an episode is a bot's consecutive `_entombed` rows ≤ 10 minutes apart and within 4 blocks (3-D) of
its first row.
- **Cause** is the skill the first firing interrupted: a `trigger=interrupt:entombed` row ending within 3 s. With no
  such row the bot was idle.
- **Outcome** is a death ≤ 10 minutes after the last row, else `_entombed_unrecoverable` within the episode, else
  cleared.

**61,536 episodes on 80 bots: 4.6 per bot-hour.**

| Cause | Episodes |
|---|---|
| gather | 21,168 (dirt 17,953, iron_ore 1,601, oak_log 485, sand 458, cobblestone 308, stone 306) |
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

**Depth:**

| Depth | Episodes |
|---|---|
| y ≥ 60 | 14,461 |
| 0..59 | 45,515 |
| < 0 | 1,560 |

**Duration and outcome:**

| Duration | Episodes | Cleared | Gave up | Died ≤ 10 min |
|---|---:|---:|---:|---:|
| one firing | 48,129 (78.2%) | 46,622 | 1,288 | 219 |
| ≤ 2 min | 9,004 | 8,591 | 365 | 48 |
| 2-10 min | 4,016 | 3,396 | 609 | 11 |
| 10-60 min | 298 | 212 | 85 | 1 |
| > 1 h | 89 | 87 | 1 | 1 |

- The single-firing share is 74-85% for every cause.
- **Chronic bots.** The > 1 h spells belong to a few bots at fixed cells:
  - placebo-d-Delta at (198, 34, 188): 9.0 h, 9.0 h, 7.6 h, 5.7 h, 5.1 h;
  - isolated-c-Alpha at (356, 47, 176);
  - isolated-d-Bravo at (341, 60, 201);
  - hive-c-Comet, which was at y=−5 during this measurement: "gave up after 4 escape attempts (give-up #6); asked the
    goal layer for a pickaxe" while holding three iron pickaxes and a stone one.
  - These are stuck bots, and the 09-30 rule keeps them out of scope here. F2 and F6 touch them only as a side
    effect (section 6).

**Deaths.**
- 164 of the 276 deaths had an entombed episode in the 10 minutes before. **The base rate is 51.9%** (20,000 random
  bot-time points), so overall, entombment is not a death precursor.
- **Suffocation is the exception: 17 of 17**, against that 52% base (p ≈ 0.52^17 ≈ 1.5e-5).
  - Each one follows an escape climb that raised the bot 5-10 blocks: entombed at y=42, then 49 (board-a-Bravo); 19
    → 29 → 39; 54 → 59 → 61.
  - Death comes 90-130 s after the last entombed or marooned row, with health falling over ~25 s while the bot is
    idle.
  - The bot ends inside a block. **Nothing in the reflex layer watches for that.** `_reflex_suffocating` needs
    oxygen to drain, and in-wall damage drains none.

### 4.3 Self-dig, gravel and sand, or pathing artefact?

- **Pathing and geometry artefact: the dominant cause.** It is proven for the predicate (4.1) and consistent with
  78% single firings and with the escape that follows.
- **Self-dig:** gather digging into a face, especially dirt. 17,953 episodes in 7 days, 72% of them underground at
  y 0..59: dirt pockets and cave floors.
  - It feeds a loop. The pillar spends the dirt (net −74,678 dirt over the escapes), and `gather_dirt_16` is the
    single largest milestone, at 29.4% of all decisions.
  - The loop is: gather dirt → stand in the face → "entombed" → pillar up spending dirt → gather dirt again.
- **Gravel or sand:** no telemetry can tell.
  - No row observes a `falling_block` entity, and the 300-character detail never names the head block.
  - `mine` polls for falling blocks, but `gather` and the escapes do not.
  - The suffocation cluster (17/17 after climbs) is the only signal. That is why F3 starts with a Paper
    investigation.
- **Ghost blocks** (memory: rejected digs leave client air over server stone) are a candidate for both the false
  "entombed" and the in-wall suffocation. A climb that believes it opened its head cell, while the server kept it
  solid, ends exactly like the cluster. F3's Paper scene includes a rejected dig.

### 4.4 Cost in bot-time and blocks

**Interrupts: 56,873 skills in 7 days.**
- Of those, 30,524 were gathers, and 18,214 of those still ended successful.
- Each interrupt costs at least one decision cycle. On the 10-15 measurement (ziggurat doc §1.3) that is 28.5 s at
  p50.
- 56,873 × 28.5 s ≈ **450 bot-h ≈ 3.3%** of fleet time. This is an estimate: the p50 is from another window.

**Chronic spans.** The summed span of all episodes is 792 bot-h (5.9%). 415 h of it is idle bots in the long spells
above.

**Blocks.** 65,004 `_inventory_mutation cause=entombed_escape` rows. 57,041 of them spent scaffold.

| Item | Net |
|---|---|
| dirt | −74,678 |
| andesite | −7,556 |
| diorite | −7,513 |
| granite | −7,283 |
| cobblestone | −3,150 |
| sand | −2,653 |
| gravel | −1,070 |

That is **about 105k blocks placed in 7 days, 15k a day**: pillars across 80 worlds' caves.

**Decisions.** 29,850 llm decisions were triggered by `entombed`.

---

## 5. What keeps bots shallow (question 3)

**1. The model rarely asks.** The requested `mine` target y over 7 days (63,599 calls):

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

- The goal ladder's deepest rung is iron (`gather_iron_ore_3`), and iron lives at y 16-62 (phase 2: 83.7% of iron
  was gained there).
- `prompt.mjs:250-252` says "ores are below y=16". No rung, prompt line or affordance names diamond.
- `mine`'s default target is y=12 (skills.mjs:12440).

**2. The exit contract refuses deep descents, on swings.**
- `exit_capability_reserve` refused 3,209 mine calls: 3,008 on pickaxe swings and 193 on scaffold.
- It refused 34% of calls targeting below y=0, against 1.6% of those targeting 48..63.
- Swing need = debt + 2 + max(min(12, debt), ⌈debt/4⌉), with debt = 63 − y. So the need is 101 swings at y=−16 and
  155 at y=−59. A stone pickaxe has 131.
- **The contract assumes the way home must be dug.** For a bot that cut a 1:1 stair, it is a walk: 0 swings, 0
  blocks.
- `ladder.mjs:20-33` deliberately gives ladders in the bag no credit. The shaft design (ziggurat T6) introduced
  credit for a **verified physical route**, never for inventory. F6 applies the same principle to the bot's own
  stair.

**3. The pathfinder does not keep bots shallow.** It walks and drops (`maxDropDown` 6 walk / 8 descend), never steps
into lava (lava is in `blocksToAvoid`), and treats water at any depth as a landing (`infiniteLiquidDropdownDistance`
true).

**4. The stair planner** (`chooseStairBearing`) chooses dryness, not depth. Water stops mine 3,858 times a week at
y 32-63 ("water in the tread ahead — and in every other direction"). That is a shallow-band cap of its own.

**5. Bots below y=0 now:** 2 of 80 in the latest snapshot (isolated-b-Comet y=−2, hive-c-Comet y=−3); 2.3% of
bot-time over 7 days.

**Stock** (latest snapshot per bot; ES):

| Item | In 80 bags |
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

The brief's "4 diamonds in all town chests" and "1,429 lapis" were **not re-measured here**. The town index rows do
not carry per-item totals, and RCON was not used.

---

## 6. Composition: what exists, and why keepout does not reach the population

**keepout-01** (live).
- What it does: no target dig by gather, mine or the tunnel within radius 6 and up to +12 of a live `death:fire`
  site, plus a route and break veto at cost 101 inside gather/mine/exit runs.
- Why it misses this population:
  - It acts after a death, in one world: 78 of 84 deaths were the first at their site.
  - It acts on digs, while the deaths are walks and reflex moves.
- It stays as is. F5 is its pre-death, per-world cousin and does not replace it.
- Note: 15 of 84 lava deaths had `keepout_exit` as the last completed skill (11 success). The exit walked the bot out
  of a column it was in, and lava killed it afterwards. F1's retreat is the move that matters after such an exit,
  and the read reports it by name.

**protectzone-01.** Zone boxes. It wraps dig, place, activate, open, sleep and craft (index.mjs:1202) and adds path
cost 100. Survival digs and places are exempt.

**poolescape-01.** The marooned water-pit arm. It reserves the runner and re-checks lava live.

**homefix (watchdog).** A relocation under a runner reservation. Its target is never in a fire column.

**minewell-01.** Mine's well-shell guard, per bearing and per dig.

**Runner reservation.** `Runner.reserve(owner, ≤ 20 s)` aborts the skill and declines every other run with
`runner_reserved`. It is used by the watchdog and poolescape.

**The reflex tick order (500 ms):**
1. stranded ladder;
2. air;
3. pocket rung;
4. **idle lava stand-off**;
5. **danger block (escape)**;
6. health;
7. marooned (incl. poolescape);
8. **entombed**;
9. stuck.

Section 7 gives each fix's composition against these.

---

## 7. The fixes, in order

Each fix has one variable, a pure exported decision function with behaviour tests (CLAUDE.md: never assert decision
logic by text), a Paper scene on sandboxes 5-8 under `sbxlock.sh`, an env rollback, and the rows its read needs.
Tiers follow the 10-19 rule (`tierrule.py`).

### F1 `lavastep-01`: the danger arm retreats along a verified line; it never sprints blind

**Variable.** `escape()` in the danger arm is replaced by `lavaRetreat(at, feet, trail, yaw)`, a pure function.

**Retreat cell, in order:**
1. **Trail.** The newest cell in the bot's own ring of the last 40 feet cells that is lava-safe (`cellLavaSafe`) and
   supported. The ring is sampled every reflex tick when the bot is on the ground; it is in memory, not a row.
2. **Stand-off.** `lavaStandOff`'s retreat cell (the existing pure guard) when the trail has none.
3. **Cardinal.** The cardinal whose feet+head cells are passable and not lava, with a solid floor and no lava in the
   swept 3-wide line (`holdForwardSafe` geometry).

**Move.**
- Look at the cell first (`bot.lookAt(..., true)`), then forward.
- Jump only when the feet are in liquid. Sprint only when the feet are in lava.
- Stop on arrival (position feedback, ≤ 1.5 s).

**Two cases.**
- **Feet clear, lava below** (303 episodes, 10% fatal): **never jump or sprint.** Step to the retreat cell. With none,
  set `sneak`, clear `forward`, and hold. A sneaking player does not walk off an edge; whether
  prismarine-physics honours that is **unverified**, and Paper scene S3 decides it. This is the case the idle
  stand-off already handles for idle bots. F1 lets it run while interrupted too (no 20 s gate), because the danger
  arm has already interrupted the runner.
- **Feet in lava** (65 episodes, 49% fatal): retreat toward the trail cell with sprint + jump. With no trail cell and
  no cardinal, fall back to today's `escape()`. **The worst case is today's behaviour.**

**Rows.**
- `_lava_retreat`: `case=<over|in> src=<trail|standoff|cardinal|legacy|hold> to=x,y,z from=x,y,z yaw_turn=<deg>
  ahead_was=<block> hp=<n> ok=<0|1> ms=<n>`, once per episode.
- `_lavastep_mode` (licence).
- Rollback: `LAVASTEP=0`.

**Tier 2.**
- Small, one decision, strong Paper evidence. `"tier": 2`, licence `mechanism` (not `rate`).
- The "death rate no higher than control" condition is the tier rule's own.

**Read.**
- *Effect, mechanism* (canary vs control, DiD): the share of danger episodes followed by a fire death within 20 s,
  and the health lost per episode (from `bot.health` on the rows).
  - **Power is low.** The fleet has 412 episodes a week. 4 drawn pools × 6 h expect about 4 episodes; the busiest
    pools have 26-30 a week (placebo-a 30, hive-a 28, hive-b 28, board-c 28, placebo-c 26).
  - So the read **cannot show the death effect**. It is a tripwire plus a correctness gate, and the effect evidence
    is Paper.
- **Correctness gates** (evidence = defect, any one reverts):
  - G1: 0 `_lava_retreat` rows whose target or swept line contains a lava-like or unknown cell, re-checked against
    the row's own cells.
  - G2: 0 retreats with `src=legacy` while a trail or stand-off cell existed (the decision is replayed from the
    row's inputs).
  - G3: 0 `case=over` rows with sprint or jump set.
- **Exposure declared:** ≥ 3 danger episodes on the canary arm, else INCONCLUSIVE at +360 (owner 10-15 early close).
- **Paper (main evidence)**, 20 trials per arm per scene, base vs variant:
  - S1: a bot on a pool edge facing the pool, `danger_block` forced.
  - S2: a bot in 1-deep surface lava, 1 block from shore.
  - S3: a bot on a 1-wide ledge over a cave lava lake.
  - S4: magma floor.
  - Metric: survival and health at +10 s.
  - The base arm must reproduce the fleet's conversion (S1 ~10%, S2 ~50%). That is the positive control; without it
    the scene is not the fleet's trap.

**Draw exposure:** pools with ≥ 20 danger episodes in 7 d (placebo-a, hive-a, hive-b, board-c, placebo-c, placebo-d);
`draw_require` 2 of them.

**Composition.**
- *keepout*: no dig. The retreat is a walk. A retreat cell inside a fire column is allowed: leaving lava outranks
  the column, as survival digs do today. The read names it.
- *protectzone*: walks are not wrapped. No interaction.
- *poolescape*: different arm, and it runs later in the tick. The danger arm already makes the movement arms stand
  down while `inDanger`. Unchanged.
- *homefix*: a watchdog reservation does not stop reflex movement today (escape runs regardless). F1 keeps that.
  Leaving lava must not wait 20 s for a reservation.
- *minewell*: none.
- *runner reservation*: F1 takes none.

**Refusal chain:**
- No retreat cell + feet clear → hold with sneak. That is always executable, and it is the case where standing still
  is safe: the feet are on solid ground.
- No retreat cell + feet in lava → legacy sprint, i.e. today.
- Test the chain: from every scene start, assert the bot ends at a lava-safe cell or in the legacy branch, never in a
  third state.

### F2 `tombexit-01`: entombed means no walkable way out

**Variable.** `isEntombed` gains a final conjunct `!walkExit(at, feet)`, a pure function.

**`walkExit` is a breadth-first walk over body cells**, using the walk profile's own moves: same level, step up 1
with headroom, drop ≤ 3 onto solid. Every cell needs feet and head passable, not lava, and known.

It returns **true** when the walk reaches any of:
- a cell more than 4 blocks (horizontal) from the feet;
- a cell whose column is open to the sky (`climbNeedAbove` = 0);
- more than 24 cells in all.

It returns false within the bound otherwise. **A sealed pocket stays entombed** (the suite's TOMB, a covered 2-cell
pocket, a 1x1 pit). A dug dead end, a stair tread and an alcove do not.

**Rows.**
- `_entombed_exit_open`: `cells=<n> reach=<blocks> via=<far|sky|count>`, sampled at most once a minute per bot.
- `_tombexit_mode`.
- Rollback: `TOMBEXIT=0`.

**Tier 2.** One conjunct, behaviour tests over the six probe fixtures and the existing entombed-escape suite, plus a
Paper scene.

**Read** (huge exposure: about 6.5 `_entombed` rows per bot-h).
- *Effect:* `_entombed` rows per bot-h, DiD; expected sharply down.
  - Companion metrics: `interrupt:entombed` per bot-h; scaffold spent in entombed escapes per bot-h (from
    `_inventory_mutation`); gather successes per bot-h.
- *Guards (WATCH/HOLD):*
  - entombed spells > 10 min per bot-h, which must not rise;
  - `_entombed_unrecoverable`;
  - `_reflex_stuck` and `_livelock_escape` per bot-h. These are the backstops that see a bot F2 declined: a rise is
    the "exit was not really an exit" signal.
- *Tripwires:* drowning and suffocation deaths on the two-death floor.
- **Correctness gate G1:** 0 `_entombed_exit_open` rows followed within 60 s by a `_reflex_stuck` at the same cell
  (≤ 1 block) with health falling, on the canary arm.
- **Paper:** a gather dirt face in a dirt pocket, an iron tunnel dead end, a stair tread, and the suite's TOMB.
  - Base: `_entombed` plus a pillar.
  - Variant: no firing, except at TOMB.
- Exposure is met in minutes, so a tier-2 KEEP at +180 is realistic.

**Draw exposure:** every pool (≥ 1,857 episodes a week, board-d the lowest).

**Composition.**
- *mine/tunnel* `'stair'` claim: unchanged.
- *poolescape and marooned*: different predicates, unchanged. F2 does not touch `maroonState`.
- *airpocket/floodpocket*: they gate on their own states, and the pocket rung runs before the entombed arm.
  Unchanged.
- *keepout*: fewer escape digs inside columns, which is better.
- *protectzone*: fewer survival placements in zones.
- *homefix*: the watchdog sees fewer interrupt-caused stagnation rows. The homefix read is unaffected, because that
  canary is closed.
- *Runner reservation*: fewer interrupts. No reservation taken.

**Refusal chain.**
- "Not entombed" is not a refusal. It hands the bot back to the next decision, and the walk exit is real by
  construction: BFS over the walk profile's own moves.
- A bot that is truly stuck behind a false exit is caught by the stuck arm (35 s) and the livelock escape, as today.
  G1 measures it.

**Not in F2:** gather does not take a `'stair'` claim. That would silence real entombments inside a gather.

### F3 `inwall-01`: a body inside a block digs itself out (investigate first)

**Why.** 17 of 17 suffocations follow an escape climb (4.2), there is no reflex for in-wall damage, and the cause
(gravel or sand falling into the climb's head cell; a rejected dig, i.e. a ghost block; a block placed into the
body's own head cell) is unknown.

**Step 1: Paper investigation, before any build** (sandbox 5-8 under `sbxlock.sh take <sbx> mineshaft "<note>"`).
Replay `pillarOut`, `digStraightUp` and the escape ramp:
- under a gravel-capped column;
- under a sand-capped column;
- with the server rejecting one head-cell dig (a protected spawn region or a plugin-cancelled break);
- with a placement into a cell the body overlaps.

Record which of them puts the bot's eye cell in a block, and how health falls.

**Step 2: the reflex** (tier 2 if step 1 finds one mechanism).
- **Trigger:** health dropped twice within 2 s with no fire, lava, fall, drowning or oxygen cause, while the eye cell
  (client) is solid or a `falling_block` entity was seen within 1 block in the last 5 s.
- **Action:** dig the eye cell, then the feet cell, with `overheadBreakRisk` on each.
- **Ghost case:** if the client says air, send the dig action for that position anyway (packet-witness.mjs confirms
  the server's answer).
- **Rows:** `_inwall` `cell= block= cause_guess= dug= witnessed=`.

**Read:** suffocation deaths are rare (17 a week), so a tripwire, the `_inwall` rows themselves, and Paper.

**Composition.** It runs before the entombed arm in the tick, as a survival dig (exempt from keepout and
protectzone).

**Refusal chain:** if the eye cell cannot be dug (bedrock, protected and not survival-exempt, no tool), dig the feet
cell and step down. If that also fails, the existing arms keep the body. The row names which.

### F4 `minelava-01`: `mine`'s stair reads six faces, seals lava, and stops pushing blind (the diamond-tier prerequisite)

**Variable.** One pure planner, `stairLavaPlan(at, step, bearing)`, called before every step's first dig.

**Inputs:** the three cells to be opened (above, head, tread), plus the tread's floor (y−2) and the cell under it
(y−3).

**For each opened cell**, read all six faces, plus the cell one beyond each face that is open air or liquid.

**Lava-like** = `LAVA_LIKE` (lava, flowing lava, fire, soul_fire, magma, campfires). **Unknown = unsafe.**

**Verdict:**

| Verdict | When | Then |
|---|---|---|
| `clear` | nothing lava-like | dig as today |
| `seal` | every lava-like cell is a single face of a cell to be opened, and is placeable (lava source or flow, a replaceable cell) | first place a scaffold block (cobble or cobbled_deepslate; never dirt or gravel) into each such lava cell, from a position where the bot's body overlaps no lava |
| `turn` | lava is more than one face deep, or under the floor | the bearing is excluded, and `chooseStairBearing` re-plans the remaining bearings for this step |
| `stop` | no bearing is `clear` or `seal` | stop with the remedy (refusal chain) |

**Seal details.**
- Each placement is **witnessed**: a `blockUpdate` to the placed block within 1 s, via packet-witness.mjs. An
  unwitnessed placement counts as no seal, and the plan re-reads.
- Lava under the floor makes the step `turn`, never a seal. The bot does not stand on a block it just placed over
  lava.
- Lava beside the head or feet cell is sealed **before** the cell is opened. This is M7's "slower but safer".

**Also changed:**
- `stairLiquid` uses `LAVA_LIKE` for the lava branch. Water behaviour is unchanged, because "water is terrain" and
  mine's existing water stop stays as is.
- The fall probe counts lava as lava, not hollow: lava under the tread → `turn`.
- The step-recovery forward push requires `holdForwardSafe` (feet and feet−1, 3 wide, 2 ahead) and is skipped
  otherwise ("cut a step but could not stand in it", as today, without the push).

**Rows.** `_mine_lava`: `step=x,y,z bearing=<b> verdict=<clear|seal|turn|stop> cells=<lava cells> placed=<n>
witnessed=<n> unknown=<n>`; `_minelava_mode`. Rollback: `MINELAVA=0`.

**Tier 3.**
- It changes `mine`'s geometry decisions.
- Today mine meets lava 4 times a week. So the canary's job is **no harm** at today's depths, and the effect evidence
  is Paper.

**Read.**
- *No-harm (DiD):* mine success rate, mine-attributed cobble per bot-h, `gather iron_ore` successes per bot-h,
  `exit_capability_reserve` and `hazard_interrupt` counts.
- *Correctness gates* (defect, any one reverts):
  - G1: 0 executed stair digs (`_mine_dig`, keepout's gate row) whose cell had a lava-like or unknown face at dig time
    without a witnessed seal of that face. Recomputed from the `_mine_lava` row of the same step.
  - G2: 0 forward pushes with lava within the swept box.
  - G3: 0 seal placements of dirt or gravel.
- **Paper (main evidence):**
  - S1: a stair whose next head cell borders a lava source → seal, then dig.
  - S2: a 1-deep lava pool under the next tread → turn.
  - S3: lava on three bearings → stop with the remedy, and the bot walks up its own stair.
  - S4: a lava source behind an unknown (unloaded) chunk edge → stop.
  - S5: the fleet's 10-16 step-failure-then-push death, replayed → no push.
  - Base must die or burn in S1, S2 and S5 (positive control).

**Draw exposure:** any 4 pools with ≥ 200 mine calls a week. All of them have that: mine runs 5.7 per bot-h.

**Composition.**
- *keepout*: a seal is a PLACE, and keepout wraps digs only. A `turn` re-plan still passes `planMineStart`'s keep-out
  column filter.
- *protectzone*: seals are placements. In a zone they are refused (not survival). Then the step is `turn`, and the
  row says `zone`.
- *minewell*: the re-planned bearing passes the well-shell filter, which already runs per bearing.
- *homefix and runner reservation*: none. `mine` keeps its `'stair'` claim through the seal.
- *poolescape*: none (water).

**Refusal chain (CLAUDE.md, three checks).**
- `stop` names "walk back up your own stair (`surface`)". That is executable because the stair above was cut and
  walked by this call. F6 makes it verified rather than assumed. Until F6, the remedy names `surface`, whose climb
  already refuses lava (climbflood).
- *Reachable:* the bot is not left advised. The skill returns, and the next decision is the existing `surface`
  admission.
- *Composed:* chain-test `stop` → `surface` → home from the S3 scene, with every reflex armed.

### F6 `deepstair-01`: the bot's own staircase is its verified way home, and the exit contract credits it

**Variable.**
- `mine` records each completed step's cells: tread, head and above, plus the stand cell.
- They form a **stair certificate**: an ordered list from the call's start to here, stored on the bot and in world
  facts with the world tag.
- The exit contract's debt becomes `max(0, y_top_of_certificate − y)` instead of `63 − y` **when the certificate
  revalidates**.

**Revalidation** happens before every step's dig. It block-reads every recorded cell:
- tread solid, head and above passable;
- no lava-like face;
- loaded.

It also runs a canDig=false probe path (≤ 2,000 nodes, 1 s) from the post-step position to the certificate top.

This is the ziggurat T6 certificate applied to the bot's own stair. The search is cached. **The blocks are not.**

**What is not credited:** inventory, ladders, and "I came this way" memory without a block read.

**Torches.** Every 8th step, one torch on the stair's left wall going down (so it is on the right coming home). It is
a visible marker for the owner and the showcase. No decision reads it. If the bot has no torch, there is no torch.

**Rows.**
- `_stair_cert`: `id= top=x,y,z steps=<n> valid=<0|1> why= probe_nodes=`.
- `_exit_credit`: `debt_old= debt_new= swings_need_old= new=`.
- `_deepstair_mode`.
- Rollback: `DEEPSTAIR=0`.

**Tier 3.** It is the gate on going deeper.

**Read.**
- *Effect (DiD):*
  - `exit_capability_reserve` refusals per mine call targeting below 0, which should fall;
  - bot-time below y=0, which should rise. That is exposure, not success.
  - Deaths per 100 bot-h below y=0, read on the two-death floor. Below-0 bot-time is small, so it is reported, not
    gated.
- *Correctness gates:*
  - G1: 0 credited steps whose certificate was invalid at that moment (recomputed from the rows);
  - G2: 0 bots below y=0 more than 30 min after a credited descent with `surface` failing on a valid certificate.
    That is the "credit without a way home" defect.

**Draw exposure:** pools with ≥ 100 deep-target mine calls a week.

**Composition.**
- *keepout*: a certificate cell inside a fire column is **invalid**, so the bot falls back to today's debt.
- *protectzone*: the probe uses the walk profile, which already prices zones.
- *minewell*: a certificate never includes a well-shell cell. mine never digs one.
- *homefix*: a relocation clears the certificate, because the bot is no longer on its stair.
- *runner reservation*: none.
- *shaft-01* (HELD): a shaft landing is a certificate top as well, when the shaft is built. Same rule.

**Refusal chain:** a failed revalidation → today's debt → today's refusal and remedy. **Never worse than today.**

### F5 `lavasight-01`: lava a bot has seen keeps every bot in that world away from it

**Variable.**
- Every lava-like cell named by a bot's own rows (`_lava_corridor`, blind-step, stand-off, danger, `_mine_lava`) is
  written to per-world world facts: a cell, a count, and last seen; capped at 4,096 cells per world, oldest evicted.
- They are written under the pid lock keepout-01 built for world facts.
- **Walk, gather and explore profiles:** step exclusion on known lava cells and their 4 cardinals at feet level; a
  cost of 8 within 3.
- **`_explore_toward_known`:** drops an iron target within 6 of a known lava cell, and any target whose straight
  bearing passes within 2 of one, then picks the next.

**What it targets:**
- the 61 of 84 deaths preceded by explore-toward-known;
- the two seed hot spots: every world rediscovers them today;
- the post-keepout_exit deaths.

It acts **before** the first death in a world, which keepout cannot do.

**Tier 3.** It is routing-wide.

**Read.**
- *Effect, mechanism (DiD):* `_lava_corridor` refusals per explore-hour, and danger episodes per bot-h. Both should
  fall. Lava deaths are a tripwire.
- *No-harm:* explore and goto success per bot-h, iron gathered per bot-h, path timeouts.
- *Gates:*
  - G1: 0 planned path nodes inside the exclusion (from the path_update hook);
  - G2: 0 world-facts write losses (the keepout lock's own counter).

**Draw exposure:** pools whose worlds hold ≥ 50 lava cells seen in the 24 h before the draw.

**Composition.**
- *keepout*: separate store kind (`lava:seen`, not `death:fire`), no dig rule, never disputes a fire site.
- *protectzone*: an independent cost, so the costs add.
- *homefix*: relocation targets must avoid the exclusion (the same check as fire columns).
- *poolescape*: its lava check is live. Unchanged.
- *minewell*: none.

**Refusal chain.** A goal inside an exclusion (a gather target beside lava) is refused naming "the target is beside
lava at x,y,z — pick another". That is executable: gather's enumeration already skips refused candidates.
`_explore_toward_known` falls back to a random bearing, which is today's fallback.

### Order and why

**F1 → F2 → F4 → F6 → F5**, with F3 as an investigation that can run on a sandbox in parallel, since it uses no canary
slot.

- F1 and F2 are small, high-exposure (F2) or high-consequence (F1) tier-2 fixes. They also lower the noise every later
  read sits in: about 5% of bot-time, and 63 of 84 lava deaths.
- F4 and F6 are the descent's prerequisites, and the diamond tier needs both.
- F5 is the broadest change and the least certain gain per hour of canary.

**One canary at a time** (CLAUDE.md). Each closes KEEP, REVERT or INCONCLUSIVE before the next starts.

---

## 8. The diamond tier and enchanting (sketch), with the owner's M7-M10

**M7, accepted: slower but safer.**
- Every stair step pays the six-face read (F4), and a seal when needed. A seal is one placement and about 0.3-0.5 s.
- Deepslate takes about 0.75 s per block with iron and 1.15 s with stone (computed from the wiki's Breaking formula,
  not read from a table). A descent from y=64 to −53 is 117 steps × 3 cells ≈ 351 digs ≈ 5-7 minutes of digging with
  iron, plus seals.
- The evidence supports M7: the cost is minutes, the alternative is a death every ~2.6 deep bot-hours.

**M8, accepted: one or two deep miners per town, assigned by the job assigner.** The evidence argues for the cap: the
deep death rate (section 3) times many bots would be the largest death source in the fleet. **The interface needed
from cooperation-1023:**

- **Job `deep_miner`.** At most 2 concurrently per town, a soft preference, no fixed role.
- **Preconditions,** checked by the assigner and re-checked by the skill at start; failure is a decline, never a
  counted failure:
  - health 20 and hunger ≥ 18;
  - a usable iron pickaxe, with ≥ 400 remaining uses across all held pickaxes (stair ≈ 351, branch ≈ 2 × 100, minus a
    stair already certified);
  - ≥ 64 seal blocks (cobble or cobbled_deepslate);
  - ≥ 16 torches, optional: the marker only;
  - a free slot count ≥ 6;
  - F1, F4 and F6 KEPT on the fleet (a hard gate the assigner reads from the build licence rows, not from a flag).
- **Lease:** 60 minutes, renewable once.
- **Ends on:**
  - the bag is full;
  - remaining pickaxe uses fall below the certificate's return need + 20;
  - any F4 `stop`;
  - any lava retreat (F1) or health ≤ 14;
  - the lease expires.
- **The end is deterministic:** walk the certificate up, bank at town, release.
- **Reports back:** `_deepmine` rows (start, descent, branch blocks, ores seen and mined by kind, seals, end reason,
  diamonds banked), so the assigner can prefer bots whose last lease ended well.
- **Never:** two deep miners on one stair at once. The second waits at the top, or cuts its own. Jobs never preempt a
  survival reflex.

**M9, accepted: a safe staircase down, then branch tunnels at diamond depth. No water buckets.**
- **Descent:** F4 + F6. One town staircase, re-used.
  - The first deep miner cuts it. Its certificate is stored in world facts, so later miners walk it at 0 digs. Their
    revalidation is the F6 rule.
  - When shaft-01 exists, the stair starts at its bottom landing (y≈17).
- **Depth:** feet y = **−53**.
  - Generated lava fills air below −54 (Aquifer page: the lava surface is at −54; Tutorial:Mining says −55..−63). The
    two disagree by one block, so −53 is the first level clear of both.
  - Diamond ore spans −64..16 and peaks at −58/−59. Mining at −53 costs some ore for a lava-free floor.
- **Branches:**
  - 1 wide and 2 high, every 4 blocks (3 solid between), up to 32 long. Every cell is read by F4's planner (six faces
    + one beyond).
  - Ore detection: `findBlocks` for `deepslate_diamond_ore` and `diamond_ore` within 16. The ore tunnel's comment
    says Paper anti-xray is off. **D0 verifies that on the fleet's Paper config before the build.**
  - An ore is mined only if all six of its faces and the cells beyond them are lava-free (Baritone's
    `plausibleToBreak` rule), approached from the branch, never by digging down onto it.
  - Ore in the −54..−63 band is mined only from above, standing on a solid floor, and only when the cell below the ore
    is not lava.
  - The same rule takes lapis, redstone, iron and gold when seen, so the trip pays for itself.
- **Gate D0** (offline, before the build; region files read-only, as M0 did for the shaft):
  - count diamond ore and lava cells in a 64-block box under each town at −60..−50;
  - record the Paper anti-xray setting;
  - report the expected diamonds per branch-hour.
  - Worlds that share a seed share the answer. The 10 placebo-a deep deaths say the box must be read before a stair is
    sited there.

**M10, accepted: diamonds go to pickaxes first, then an enchanting table. No diamond armour.**
- **Banking:** diamonds are already in `bankable.mjs`. The deep miner banks every diamond at the end of a lease; the
  town index records it.
- **Pickaxes:** toolkit makes a diamond pickaxe (3 diamonds + 2 sticks) for the town's deep miners first, then
  general use. The worn-first rule applies.
- **Enchanting table:** 2 diamonds + 4 obsidian + 1 book. It is gated on **two things the fleet cannot make today**:
  - **Obsidian** needs a diamond pickaxe, and with M9 it must be **natural**. It forms where water met a lava source:
    in deep caves near the lava band, in ruined portals. Mining it means standing beside the lava the obsidian came
    from. F4's lava rules apply to the ore rule above.
  - **A book** needs 3 paper (sugar cane) and 1 leather. In peaceful, leather means killing a cow; the fleet has no
    attack skill.
  - Owner question O5.
- **Lapis:** 1,429 are reported in town chests (not re-measured).
- **XP:** enchanting spends levels, and bots earn them from coal, lapis, redstone and diamond ores and from smelting.
  Without bookshelves the best table offer is level 8.
- `enchant-01` is a sketch until O5 is answered.

---

## 9. Code facts this rests on (file:line, base 6e1afb52)

**Danger and lava reflexes.**
- Danger arm: reflex.mjs:2541-2559. `escape()`: 5948-5953. `DANGER_BLOCKS`: 74.
- Idle stand-off: 2519-2539 (gate: idle, no skill ended in 20 s).
- lavaguard.mjs: `cellLavaSafe` 10, `dropLavaSafe` 29, `corridorSafe` 48, `holdForwardSafe` 68, `lavaStandOff` 84,
  `stepLineSafe` 116. `_lava_corridor` is the `path_update` hook (index.mjs:1020-1034).

**Entombment.**
- `isEntombed`: reflex.mjs:3391-3442 (head-level walls only, ceiling at +2, ground probe).
- The arm: 3028-3268 (15 s minimum interval, give-up after 4, backoffs).
- `'stair'` / `'climb'` claims silence it: 3034.
- Test export `isEntombedForTest`: 6214.

**`mine`.**
- Body: skills.mjs:12409-13374.
- `descentStepCells`: 14458. Dig order: 13021.
- Checks: tread/head/ceiling by name 12880-12908; ceiling neighbours 12957-12967; fall probe 12931-12951.
- Blind push: 13146-13181. `stairLiquid`: 13263. `chooseStairBearing`: 13362.
- Goal clamp: 12440. Home refusal: 12466-12475.

**Exit contract.** exit-contract.mjs:124-176: debt 63 − y; swings = debt + 2 + max(min(12, debt), ⌈debt/4⌉).

**Ore tunnel.** oretunnel.mjs: `breakHazard` checks 6 faces for liquid (68); `stepHazard` uses `cellLavaSafe` (89).
`tunnelToOre`: skills.mjs:1717-1833 (iron only).

**Pathfinder** (mineflayer-pathfinder `lib/movements.js`).
- Lava is in `blocksToAvoid` (53), so it is never `safe` (233). `getLandingBlock` refuses unsafe landings (462).
- `safeToBreak` with `dontCreateFlow` checks above and four sides, **not below** (252-263).
- Profiles: index.mjs:414-853 (walk `canDig=false`, `maxDropDown` 6; gather `canDig=true`, `dontCreateFlow`).

**Runner.** `Runner.reserve`: runner.mjs:48-90 (≤ 20 s; `runner_reserved` declines). Body claims: 138-181.

---

## 10. Prior art (searched 10-23; links in the review record)

**mineflayer-pathfinder.**
- `dontCreateFlow` checks above + 4 sides, never below or one beyond. An unloaded neighbour reads `liquid:false`, so
  a dig fails open.
- Issue #141 "Pathfinder doesn't avoid lava" (open; blamed on physics, and diagonal-down moves do not check the final
  block).
- #78 / #354: gravel.
- mineflayer #2600: ghost blocks under lag (open).
- mineflayer #3731: buckets unreliable on 1.19-1.21. **This supports M9's no-bucket rule on engineering grounds too.**

**Baritone.**
- `avoidAdjacentBreaking` refuses any liquid above and source liquids on the sides; below is never checked.
- `MineProcess.plausibleToBreak` **skips ore next to lava**.
- `legitMineYLevel` −59. `pauseMiningForFallingBlocks` and `avoidUpdatingFallingBlocks` default on.
- Open issues #290, #3995 and #4645: mining beside lava, falls into lava after a re-plan off-centre.

**Mindcraft.**
- `digDown` stops if the target or the block below is lava or water.
- `self_preservation` places water or walks to water when in lava.

**Voyager.** Its collectblock sets `dontCreateFlow=false` and `dontMineUnderFallingBlock=false` and never restores
them (collectblock #146).

**Odyssey.** `mineDiamond` digs straight down with no lava check.

**Gap.** No paper found analyses agent lava deaths. Our 84-death table is, as far as I could find, the only such
measurement.

**Ideas taken:**

| Idea | Fix |
|---|---|
| check all six faces + one beyond, with unknown = unsafe | F4 |
| skip lava-adjacent ore | M9 |
| stair, never shaft | M9 |
| plug with a block as the deterministic first response | F4 |
| strip-mine above the lava band | −53 |
| wait for gravel | F3 |
| stop centred before re-planning | F1's retreat ends centred |
| torches on one side | F6 |

---

## 11. Owner questions (with recommendations)

- **O1 (F1's legacy fallback):** with no retreat cell and the feet in lava, keep today's blind sprint as the last
  resort? **Recommend yes.** It is today's behaviour, and the alternative, holding still in lava, is certain death.
- **O2 (F2's bound):** a walk exit = more than 4 blocks away, an open sky column, or more than 24 cells? **Recommend
  yes.** These match the predicate's own 4-block ground probe and the suite's pocket sizes. Paper tunes them, and any
  change is a constant.
- **O3 (the order):** F1 → F2 → F4 → F6 → F5, with F3 in parallel on a sandbox? **Recommend yes.** If the owner wants
  diamonds sooner, F5 can move after the diamond tier: deep miners walk a certified stair and branches, not cave
  floors, so F5 matters less to them than F4 and F6.
- **O4 (falls into caves):** 83 deaths a week (30%). They are not lava or entombment, and they are mostly gather/goto
  paths whose floor vanished. Open a separate scoped item?
  - **Recommend yes, as the next safety design after this one,** starting from the `_fall_path` rows (planned
    maximum drop 0 against real falls of 12-114).
  - The diamond tier does not depend on it: the deep miner stays on its own stair and branches.
- **O5 (enchanting inputs):**
  - **Obsidian:** natural only, under M9. Or allow one controlled exception later: a placed water source poured on a
    lava source at a surveyed site, never carried in a bucket underground. **Recommend natural only for now.**
  - **Leather:** add a peaceful-safe "hunt one cow" skill, or wait? **Recommend waiting.** Pickaxes first (M10)
    delivers value without it.
- **O6 (depth):** feet y=−53 rather than −58/−59? **Recommend −53.** It is one block above the generated lava band. The
  Paper D0 count says how much ore that gives up.
- **O7 (the brief's stock numbers):** "4 diamonds / 1,429 lapis in town chests" could not be re-measured without RCON.
  Bags hold 0 diamonds and 6 lapis. **Recommend** confirming once with a read-only chest census before `enchant-01`
  is sized.

## 12. What this does not show

- That F1's directed retreat saves the bots the blind sprint kills. That is Paper's job, with the fleet's conversion
  as the positive control.
- The cause of the 17 suffocations. F3 investigates first.
- Gravel and sand entombments. No instrument sees them.
- Deep death rates with any precision. The bottom band has 39 bot-h, and one world holds 10 of its 15 deaths.
- Diamond yield at −53. That is D0.

## 13. Review record

See `docs/reports/mineshaft-safety-reviews-2026-10-23.txt`. Independent Claude and Codex reviews, every round.

## 14. Reproduce

`docs/reports/mineshaft-safety-2026-10-23.measure/`. The ES scripts run on 10.0.0.31 against `~/estel/scripts`; the
local analysers read the JSON they write.

| Script | What it does |
|---|---|
| es1.py | totals, deaths |
| es2.py | per-death context |
| es3.py | depth exposure, entombed aggregates |
| es4.py | danger rows |
| es5.py | entombment stream |
| es6.py | mine calls |
| es7.py | escape cost, bags |
| es9.py | milestones, explore-toward |
| d1.py-d6.py | death analysis |
| e1.py | episodes |
| m1.py | mine depth |
| probe-entombed.mjs | the predicate probe; run from `bots/` with OLLAMA_MODEL set, as the runner sets it |
