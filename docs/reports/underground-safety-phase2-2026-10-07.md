# Underground safety, phase 2: what is left after climbflood, and what to build next (2026-10-07)

This is analysis and design only. **No code was changed, nothing was deployed, and no fleet world was edited.**
- Fleet worlds were only READ, from their saved region files with `scripts/host/ugsafe2_roof.py` and `ugsafe2_column.py`.
  No RCON was used on them.
- The only world edits were on Paper sandbox2, over RCON, for the rescue-timing experiment in section 3.

The doc was revised after an independent Claude review and a Codex review (section 7).

## For the owner: the short version

1. **The escape-climb route into water now almost never fires.**
   - Since climbflood went fleet-wide, bots made 5,393 escape climbs. 3 of them ended in water within 20 s, and none of
     the 3 became a sealed pocket or a death.
   - In phase 1's 72 h it was 113 water entries out of 19,401 climbs, 61 sealed pockets and 28 deaths.
   - This is a per-climb before/after, so it describes what happened rather than proving a cause. The evidence that
     climbflood works is still climbflood-02's own canary: 0 deaths in 63.7 bot-h against 9 in 191.
2. **There have been 29 deaths since then, over 1,092 bot-hours** (13.6 h of fleet time, outages excluded):
   - 14 drownings, 6 lava, 5 falls, 4 suffocations;
   - **2.66 per 100 bot-h**, against 3.32 in phase 1. That is also a before/after, and it is not evidence.
   - 3 of the 4 suffocations hit about 80 s after a bot reconnected following the outage. It has happened after every
     outage: 6 of all 16 suffocations, against 0 of 287 other deaths. **It is a restart artifact, not a trend.**
3. **Drowning still happens the same way.**
   - All 14 drownings were in a sealed pocket.
   - All 14 bots held a pickaxe with uses left and at least 8 blocks. 13 also had an empty bucket.
   - 12 of the 14 were at y 55–62, just under a lake surface or a town platform.
   - The way in is now mostly **gather** (7 of 14).
4. **The rescue-timing puzzle is solved: it is peaceful mode.**
   - The sandbox measured it on the server. A drowning bot in peaceful lives **83–90 s after its air runs out**,
     losing a steady 0.31–0.32 HP/s (5 trials). The same pocket on `easy` kills in **18 s** (2 trials).
   - Today's rescue never uses that minute. Its own steps only hold jump. The one step that can dig, the flooded-pocket
     rung, refuses as soon as air is gone ("no air to start with"), because it budgets in **air**, not health.
5. **About a third of the drowned bots qualify for a one-dig escape, on today's saved world.** The sandbox found that a cell dug straight above a
   drowning bot's head **stays air**, because water does not flow upward. So one dig makes a breathing pocket, however
   thick the roof is, as long as no water touches that cell.
   - I read the saved world at all 170 drowning sites and applied that rule plus a health budget with a 4 HP reserve.
     **60 of 170 (35%) qualify**, including 5 of the 14 since climbflood:
     - 43 have stone, dirt or grass over the head with no water beside it. The sandbox supports these: **43 of 170
       (25%)**.
     - 17 have one block of ice with air above it, all in hive-d's frozen lakes. The ice escape is **untested**.
   - That is a screen on today's save, not a count of lives that would have been saved.
   - The bot already holds the pickaxe. A floating dig takes about 14 s with a stone pickaxe (3 s standing on the
     floor), and the bot has more than a minute.
6. **Lava (59 deaths in 5 days) comes mostly from bots moving off again beside lava they have just been warned about.**
   - 32 of the 59 died within 60 s of starting explore (18), gather (12) or goto (2). Each of those moves started
     within 120 s of the bot's own guard naming the lava.
   - Per start, that is 1.0% (explore) and 0.45% (gather), against ≤ 0.02% with no warning.
   - Below y 0 it is dangerous but rarely chosen. It is 1.2% of bot-time and 1.0% of iron, and it carries 13% of
     deaths. Most of those are falls *into* deep caves from above.
7. **Recommended canaries, in order** (section 5 gives the risk and read for each):
   1. **`airpocket`**: inside the drowning rescue, dig the one cell above the head when the rules say it stays air.
      It is budgeted on health, with a fixed damage envelope. It qualifies about 25–35% of drownings.
   2. **`lavaadmit`**: after a bot's own lava warning, its next explore, gather or goto first walks back along its own
      trail. It covers up to 54% of lava deaths.
   3. **`deepfloor`**: no voluntary descent below y 0. It is cheap, and covers about 3% of deaths.
   4. **`sealedswim`**: never plan a swim under a solid roof. This waits on more evidence and an owner decision on the
      "water is terrain" rule.
8. **Nothing here can be read in 6 h on 10 bots.** That window expects about 1.6 deaths, about 2.4 sealed pockets and
   under 1 lava near-miss.
   - A 6-h read can only show that the new code fires, is correct each time it fires, and does no harm.
   - The effect has to come from the Paper sandbox.
9. **Exposure-normalised death reading (evidence for the gate rule the operator is drafting).** Junkwell-01 tripled
   mining (+6.74 mine rows per bot-h, 99th percentile of the null). Its time underground fell.
   - The live gate reverts it: lower bound 1.40x per bot-h.
   - Normalised per mine row (bound 0.97x) or per underground bot-h (1.09–1.20x), it **would not have tripped at its
     endpoint**. Its point ratios are still 2.6–3.9x.
   - **Normalising by the activity the change raises excuses, by construction, a change that kills by sending bots into
     risky work.** On a rough null (overlapping windows, 3 against 8 hits), it also raised the gate's false-trip rate on
     same-version pools from 1.6% to 4.1%.
   - My reading of the evidence:
     - keep the live all-cause per-bot-h gate as the safety gate;
     - report the normalised ratios and a mechanism split as diagnostics;
     - backtest any change to the rule against the known death reverts first.
   - Net output (items gained minus items carried into deaths) is inside the noise at that size: a band of about ±50
     items/bot-h.
   - 3 of junkwell-01's 6 canary deaths came through the climb route that climbflood now guards.

---

## 1. Deaths since climbflood went fleet-wide

### 1.1 Method, windows and positive control

**How the rows were read** (`scripts/host/ugsafe2_extract.py`):
- Rows come from `/var/log/mcai/<bot>/skill-<bot>.jsonl` plus every rotated `.gz`. Files were chosen with
  `telemetry.py`'s mtime predicate.
- Rows are deduplicated on (t, bot, kind, detail) and sorted by t: 5,595,661 rows from 80 bots, 10-02 17:00Z to
  10-07 17:40Z.
- The decision stream (milestone and skill per decision) comes from `llm-<bot>.jsonl`.

**Exposure:**
- Bot-time is carried forward from each observation's y, with gaps capped at 120 s.
- A skill row is stamped at its start, but its bot snapshot is taken at its end. So each skill snapshot is re-timed to
  t + duration before it is carried forward (Codex/Claude review).
- "Underground" means y < 56, phase 1's definition.

| window | span (UTC) | bot-h | underground bot-h |
|---|---|---:|---:|
| P1 (phase 1) | 10-02 17:00 → 10-05 17:15 | 5,779.0 | 1,413.6 (24.5%) |
| MID | 10-05 17:15 → 10-06 21:01, minus the 17:07–19:50 outage | 2,009.5 | 470.5 (23.4%) |
| **POST** (climbflood fleet-wide) | 10-06 21:01 → 10-07 17:40, minus the 05:01–11:53 outage | **1,091.6** | **261.3 (23.9%)** |

**Positive control: the same code on phase 1's window reproduces phase 1.**

| measure | phase 1 published | this code |
|---|---|---|
| deaths (drowning / lava / fall / suffocation) | 192 (109 / 39 / 36 / 8) | 192 (109 / 39 / 36 / 8), exact |
| underground bot-h | 1,412 | 1,413.6 |
| oxygen-critical episodes | 790 | 793 |
| sealed episodes | 375 | 377 |
| fatal episodes | 108 | 110 |
| climb → water within 20 s | 117 | 113 |
| … sealed | 63 | 61 |
| … fatal | 30 | 28 |

So the instrument can see each thing that it reports a small number of below.

### 1.2 Rates

Deaths per 100 bot-h, and per 100 underground bot-h (95% Poisson interval):

| cause | P1 /100 bot-h | MID | **POST** | POST per 100 underground bot-h |
|---|---:|---:|---:|---:|
| drowning | 1.89 (n=109) | 2.34 (47) | **1.28 (14)** | 5.36 (2.93–8.99) |
| lava | 0.67 (39) | 0.70 (14) | **0.55 (6)** | 2.30 |
| fall | 0.62 (36) | 0.85 (17) | **0.46 (5)** | 1.91 |
| suffocation | 0.14 (8) | 0.20 (4) | **0.37 (4)** | 1.53 |
| **all causes** | **3.32 (192)** | **4.08 (82)** | **2.66 (29)** | 11.10 (7.43–15.94) |

**Use the per-bot-h column.**
- 12 of the 14 POST drownings were at y 55–62, which is above the y < 56 underground line.
- Only 15 of the 29 POST deaths were underground at all.
- Drowning per 100 bot-h *in the y 55–62 band*: P1 6.09, MID 7.20, POST 5.31.

Water episodes per 100 underground bot-h:

| | P1 | MID | POST |
|---|---:|---:|---:|
| oxygen-critical | 56.1 | 54.0 | 39.8 |
| sealed (the rescue's own verdict, not geometry) | 26.7 | 26.1 | 16.8 (44 episodes) |
| case fatality per sealed episode | 29% | 39% | 32% |

**None of the fleet-wide changes from P1 to POST is evidence.** CLAUDE.md does not count before/after comparisons:
pools moved −45% to +77% in 6 h with no code change.

| escape climbs | P1 (72 h) | MID | POST |
|---|---:|---:|---:|
| climbs (underground) | 19,401 (9,212) | 10,394 (5,349) | 5,393 (2,692) |
| dry → water within 20 s | 113 (5.82 per 1,000) | 79 (7.60) | **3 (0.56)** |
| … sealed | 61 | 45 | **0** |
| … fatal | 28 | 22 | **0** |
| `_climb_flood_guard` / `_refused` / `_breach` rows | 0 / 0 / 0 | 32 / 8 / 2 | 882 / 307 / 5 |

**How to read the climb table:**
- It is a per-opportunity before/after, so it is descriptive.
- It is credible because the drop is tenfold, and because 882 guard firings show the guard being exercised.
- It is not a DiD. The causal evidence is climbflood-02's canary read.

### 1.3 The 29 POST deaths

What was true across the whole set:
- **Activity at death:** idle for all 14 drownings and all 6 lava deaths (a reflex, or nothing, owned the body); 3 of
  the 4 suffocations; and none of the 5 falls, which died running gather (3) or goto (2).
- **Milestone at death:** gather_dirt_16 in 10, gather_iron_ore_3 in 5, stockpile_stone in 5, gather_oak_log_12 in 3,
  stockpile_wood in 2, return in 2, gather_sand_8 in 1, gather_cobblestone_8 in 1.
- **What the drowned bots carried:**
  - a pickaxe with uses left: 14/14;
  - at least 8 placeable blocks: 14/14;
  - an empty bucket: 13/14;
  - a usable iron pickaxe: 9/14.
- **Cost:** 15 iron pickaxes and 10,947 items were carried into the 29 deaths. In P1 it was 17 iron pickaxes over 192
  deaths.

| cause | n | depth | entry route (how the bot got there; phase 1's priority order) |
|---|---:|---|---|
| drowning | 14 | y 55–62: 12; y 54: 1; y 14: 1 | gather 7, goto 2, explore 1, mine 1, fall 1, escape 1, pillar_out 1 |
| lava | 6 | y < 0: 3; y 18–35: 2; y 70: 1 | walked in after its own guard named the lava 4, fell in 2 |
| fall | 5 | y < 0: 3; y 7: 1; y 32: 1 | fell 26–75 blocks during gather 3 / goto 2 |
| suffocation | 4 | y 16–65 | 3 at 78–82 s after reconnecting from the outage |

**Sealed water episodes in POST: 44, of which 14 were fatal.** By entry route:

| entry route | episodes | fatal |
|---|---:|---:|
| gather | 17 | 7 |
| mine | 11 | 1 |
| explore | 5 | 1 |
| escape | 3 | 1 |
| goto | 3 | 2 |
| fall | 2 | 1 |
| craft | 2 | 0 |
| pillar_out | 1 | 1 |

**Caveat on entry routes** (both reviews): the "entry" is the highest-priority tag among the rows in the 30 s before
the first water row. It names an overlapping activity, not a proven cause.

**Which routes remain now that the climb route is guarded.** Fatal drownings per 100 underground bot-h:

| route | P1 | MID | POST |
|---|---:|---:|---:|
| pillar_out / dig_straight_up | 2.26 | 4.66 | 0.38 (1 death; ice in the head cell, hive-d) |
| gather | 1.55 | 2.12 | **2.67** (7) |
| goto | 0.78 | 0.64 | 0.76 |
| mine | 0.42 | 0.42 | 0.38 |

So gather is now the largest way in.
- The hive-c town sits on a stone platform over a flooded cave: water at y 56–61, a stone roof at 62–63.
- Its bots drowned under it four times in POST.
- In one of those deaths (hive-c-Bravo, 12:41Z), the bot's own `_death_site_route_crossed` rows show its planned route
  passing through that water at y 57–60. That is one example, not a measured share.

**Drownings by world, all 3 windows (170):**

| world | drownings |
|---|---:|
| hive-d | 39 |
| hive-c | 21 |
| isolated-a | 19 |
| placebo-b | 11 |
| isolated-d | 11 |
| hive-a | 9 |
| every other world | ≤ 8 |

**A drowning canary must contain hive-d or hive-c.** `drawrec.sh` never draws isolated pools or placebo-c, so 49 of the
170 drownings (isolated 42, placebo-c 7) are outside any canary by construction.

## 2. The rescue: what happens inside a fatal drowning

Every fatal drowning episode, all 3 windows (`scripts/host/ugsafe2_fatal.py`):

| | P1 (109) | MID (47) | POST (14) |
|---|---:|---:|---:|
| first rescue ceiling reporting oxygen ≤ 0 → death: median (p10–p90) | 72 s (62–74) | 72 s (67–76) | 72 s (61–74) |
| health at that ceiling ÷ seconds to death, median (an average, not a live slope) | 0.26 HP/s | 0.26 | 0.27 |
| the rescue's own verdict was `up dist=N` at least once | 29 | 4 | 5 |
| the rescue's own verdict was only sealed / unscanned | 80 | 42 | 9 |
| a skill owned the body and the rescue stood down (`_water_travel_uninterrupted`) | 34 | 16 | 6 |
| rung refusal rows: "no air to start with" | 46 | 18 | 10 |
| rung refusal rows: "no floor within reach below" | 34 | 13 | 2 |

**Positive control:** survived sealed episodes reported `up dist=N` in 147 of 267 (P1) and 25 of 30 (POST), so the field
can see a route up.

**Caveat on the oxygen reading:** the "oxygen ≤ 0" in the ceiling row is the client's reading. The sandbox (section 3C)
shows that reading is polluted by other entities' air values. The ceiling also lags the moment air runs out by about
16 s.

### 2.1 What is above the drowned bots (the saved world, read only)

**Method:**
- For all 170 drowning sites I read each world's region files: `ugsafe2_roof.py` on 10.0.0.30, which uses
  `scripts/lib/anvil.py`. The world for an isolated bot is `isolated-<x>`, not its pool label.
- At each site I walked the column up from the head cell.
- The positive control is that the reader returns the hive-c town exactly: a stone_bricks platform at y 66, grass at
  64, a bed and a torch.
- **Caveat:** the save is NOW, not the instant of death. Later digs, melting and freezing are included, and P1 sites
  are 2–5 days old.

**Straight up from the head**, all 170 sites:

| what is above | sites |
|---|---:|
| open water to air | 11 |
| 1 solid block, then air (33 ice) | 57 |
| 2 solid blocks | 22 |
| 3 solid blocks | 16 |
| 4 or more | 22 |
| no air within 12 | 42 |

**The air-pocket rule.** The sandbox finding is that a dug cell directly above the head stays air. So the useful test is
not how thick the roof is. It is whether the first solid cell above the head's water can be dug into a pocket that
stays dry: its four sides and the cell above it hold no liquid and nothing that falls. Ice is the exception: broken
over water it becomes water, so it only helps when air is directly above it.

**Applying the rule plus the health budget of section 5.1** (`ugsafe2_admit.py`):

| class | all 170 | P1 109 | MID 47 | POST 14 |
|---|---:|---:|---:|---:|
| **admitted: air pocket** (stone 34, dirt 3, andesite/diorite 4, grass 1, cobblestone 1) | **43** | 26 | 13 | 4 |
| **admitted: ice with air above** (all hive-d) | **17** | 9 | 7 | 1 |
| not admitted: water beside the first solid cell (the pocket would flood) | 69 | | | |
| not admitted: the head cell itself is solid in the save (16 ice, 4 dirt, 1 cobblestone) | 21 | | | |
| not admitted: open water (nothing to dig) | 11 | | | |
| not admitted: over budget (3 floating grass, 2 bare-handed stone, 1 planks) or not diggable | 9 | | | |

That is **60 of 170 (35%) admitted.** In POST it is 5 of 14. Without the untested ice it is 43 of 170 (25%).

**This is a screen under stated assumptions, not live admission and not prevented deaths:**
- every site is given 18.7 HP at dispatch and the 0.5 HP/s envelope with a 4 HP reserve (a 29.4-s budget);
- the tool is taken from the death inventory, and non-iron pickaxes are treated as stone;
- the region reader sees block names only, so waterlogged sides are invisible;
- all 60 admitted sites have exactly one water cell between the head and the dug cell, so the "within 2 cells"
  condition is met.

**Two classes are unresolved, and no canary below claims them:**
- **The 11 open-water deaths.** Example: hive-c-Bravo at −38,60,2. The save shows water at 61–62 and air at 63. The
  rescue reported "up dist=2" for 80 s, and the bot's y stayed at 60.4. A bot holding jump in open water rises, and this
  one did not. Candidates are a client/server position desync, ghost blocks, or a block that was there only at the time.
- **The 21 "head cell solid" sites.** The hive-d bots at y 61.4 under ice at 62 would have had their eyes in air. Either
  the save is not the instant of death (cold-biome water freezes over time), or the client position is wrong.

The 17 admitted ice sites share the open-water risk in their last step, the rise after breaking the ice. The sandbox has
not tested ice (section 5.1, scene F).

### 2.2 Why today's code does not use that minute

Read at the fleet sha c6e91a8 (main):
- **The drowning rescue's own steps only hold jump toward air** (`reflex.mjs` around :1940–2000). When a 20-s ceiling
  ends without air, it hands the next tick to the flooded-pocket rung (`pocketWanted`, :1999).
- **The rung can dig, but it is built around air.**
  - `pocketPlan` (`floodpocket.mjs:57`) refuses at oxygen ≤ 0 ("no air to start with").
  - The running rung aborts at oxygen ≤ 6 (`POCKET_OXYGEN_ABORT`).
  - Every submerged dig is priced against one 15-s breath.
  - It needs a floor within 6 blocks below and a known dry opening above.
- **In the deaths these conditions fail almost every time.** The air is gone, and the pockets under ice or a town
  platform are deep water with no floor.
- **The health budget, and the air-pocket geometry, are never used.**

## 3. The rescue-timing puzzle: resolved on the server

**Mechanism.** Every fleet world runs `difficulty=peaceful` (`scripts/provision-block2.sh`; `bots/src/foodskip.mjs`).
Vanilla drowning deals 2 HP every 20 ticks once the air supply is spent. Peaceful (Player.aiStep / FoodData.tick, with
the natural-regeneration gamerule on) works against it in three ways:
- it heals +1 HP and restores +1 saturation every 20 ticks;
- it keeps food topped up;
- with food at 20 and saturation above 0, it heals up to 1 HP every 10 ticks, at 1.5 saturation per HP.

The prediction is a steady **−0.33 HP/s** after an initial saturation buffer.

**Paper sandbox2** (Paper 1.21.8, 20 TPS). A bare mineflayer 4.37.1 client, `sandbox-Drown`, sat in a sealed 1x1x2 water
pocket. Every number below is read from the server over RCON every 0.5 s. The driver and raw results are in the session
scratchpad `sbx/` and on 10.0.0.31 at `~/drowntime/run1.jsonl`. Difficulty was restored to peaceful after each easy
trial.

**A. Survival:**

| arm | n | submersion → Air 0 | Air 0 → death | steady HP/s | shape |
|---|---:|---:|---:|---:|---|
| peaceful, food 20, saturation full (the fleet's state) | 3 | 15.15 s | **89.8–89.9 s** | **−0.312 to −0.322** | HP sits at 18–19 for 32–35 s while saturation drains, then falls linearly |
| peaceful, saturation 0 at entry | 2 | 15.1 s | 82.9, 83.8 s | −0.313, −0.314 | saturation refills during the 15 s of air |
| peaceful, saturation held at 0 (Hunger effect) | 1 | 15.15 s | 20.8 s | −0.907 | only the +1 HP/s peaceful heal is left |
| **easy**, full food | 2 | 15.15 s | **17.8 s** | −1.79 | about 7 s of buffer, then a steep fall |

**Reconciled with the fleet.** The fleet's 72 s is measured from the first no-air rescue *ceiling*. That comes about
16 s after air runs out: the rescue seizes at 25% air and holds for 20 s. 72 + 16 ≈ 88 s, which matches 83–90 s.

**B. Escape primitives.** Peaceful. Each starts when the server's Air is ≤ 0. The kit is a stone pickaxe at damage 31,
64 cobblestone and an empty bucket.

| primitive | n | median | head in air at | HP left |
|---|---:|---:|---:|---:|
| dig the stone above the head cell, standing on the floor | 9 | 2.88 s (2.85–2.91) | about 3.25 s | 18–19 |
| the same dig, floating against the ceiling | 3 | 14.11 s | 14.85 s | 18–20 |
| a 1x1 column with a roof 1, 2 or 3 blocks thick: dig, then jump | 3 per thickness | — | **3.25 s for every thickness** | 18–19 |
| bucket on the head-cell source, 1x1x2 pocket | 3 | 0.30 s | immediately | 20 |
| bucket in a 3x3x2 pocket | 3 | the cell refills in about 0.5 s | **not an escape** | — |
| place cobblestone into a side water cell | 3 | 0.52 s | **never** | — |

**What the primitives show:**
- **One dug cell is enough.** The cell dug straight above the head stays air, because water does not flow upward. The
  bot breathes about 0.35 s after the dig, whatever the roof's thickness, as long as that cell's sides hold no water.
- **The client's dig-time estimate is right.** Mineflayer's prediction matched the server within 0.06 s (2,850 ms and
  14,100 ms).
- **Floating costs 5x.**

**C. The client's own view:**
- **Oxygen:** `bot.oxygenLevel` reads −1 for most of a drowning. In 229 of 2,048 polls with server Air ≤ 0 it read
  3–20, because of writes from other entities (bats, glow squid).
- **Health:** client health matches the server (14 of 4,737 polls off by more than 0.5).
- **So a rescue may budget on `bot.health`, but not on `bot.oxygenLevel`.**

**Verdict.** A deterministic escape is executable in the time the bots have, on peaceful worlds.
- One dig takes 3 s from the floor and 14 s floating. The budget after air runs out is about 85 s.
- On `easy` the bot dies about 18 s after air runs out. A rescue that starts at the first no-air ceiling (about 16 s
  in) has almost nothing left, so off peaceful the step will refuse. That is safe, but it does nothing there. The 2 HP/s
  envelope in section 5.1 makes it refuse rather than gamble.

**Not tested in the sandbox** (and owed before a canary):
- the ice case;
- deep water with no floor and a roof whose sides are water;
- the full reflex stack running together.

## 4. Lava: entry routes, depth, and a cheap prevention

Every lava/fire death in the 3 windows: 59 (`scripts/host/ugsafe2_lava.py`). "Warning" means a `_lava_corridor` refusal,
an explore blind-step refusal naming lava, or a `_lava_adjacent_*` row, more than 3 s before the death.
`_reflex_danger_block lava` is excluded, because it fires once the bot is already in lava.

| entry class | n | what it means |
|---|---:|---|
| walked in after a warning | **30** | no fall and no dig, and the bot's own guards named the lava 3–30 s before |
| fell in | 15 | a fall of 4–34 blocks ending in lava; 7 of them at y < 0 |
| dug in | 9 | 8 were escape-climb `_scaffold_pick` digs; **0 in POST**, because climbflood refuses lava for every climb dig |
| walked in, no warning | 5 | |

**The last decision before death was explore in 34 of 59 and gather in 16.**

**The sequence that repeats.** A movement skill ends or is aborted beside lava. The model chooses another. Its first leg
is refused "after 1 samples", but by then the bot is in the lava.
- placebo-c-Echo, 10-02: explore started 11 s before death and was aborted for low health 6 s before. The corridor
  refusal for the leg came in the same second.
- isolated-b-Delta, 10-07 04:52Z: repeated explore runs beside one pool, then 15 blind-step refusals in 10 s, then death.

**The opportunity, measured** (`scripts/host/ugsafe2_lavaopp.py`). An opportunity is a movement-skill start within 120 s
of the same bot's pre-entry lava warning. Each death is counted once, against the last start before it:

| skill started | warned starts | in lava ≤ 60 s | lava death ≤ 60 s | unwarned starts | death ≤ 60 s |
|---|---:|---:|---:|---:|---:|
| explore | 1,808 | 35 | **18 (1.00%)** | 60,873 | 12 (0.020%) |
| gather | 2,646 | 15 | **12 (0.45%)** | 159,482 | 2 (0.001%) |
| goto | 2,287 | 9 | 2 (0.09%) | 68,563 | 2 (0.003%) |
| mine | 561 | 1 | 0 | 46,501 | 1 (0.002%) |

- **That is 32 unique lava deaths of 59 (54%).**
- **Confound** (Claude review): warned against unwarned also compares being near lava against not. So this measures
  "starting to move near named lava", not "starting a skill" as such.
- The warned starts run at about 76 per 100 bot-h, so about 45 on 10 bots in 6 h.

**Depth.** Where the iron and the deaths are, over 5 days (`scripts/host/ugsafe2_ironband.py`: 8,880 bot-h, 962 iron
gained). Iron is credited at the y where the gathering skill ended. This script's bot-time is not re-timed, so the
bot-time shares are approximate:

| y band | bot-time | iron gained | deaths (all 3 windows) |
|---|---:|---:|---:|
| ≥ 63 | 56.6% | 13.4% | 23 |
| 40–62 | 34.5% | **62.6%** | 180 |
| 16–39 | 5.5% | 21.1% | 39 |
| 0–15 | 2.2% | 1.9% | 21 |
| **< 0** | **1.2%** | **1.0%** | **40** |

- **Iron per hour below y 0 is about average (0.83x), but there are very few such hours.** The iron wall is y 16–62.
- **30 of the 40 deaths below y 0 were bots that had been above y 0 thirty seconds earlier.** They fell into a deep
  cave: 23 falls, 6 lava, 1 drowning.
- **Only 10 (9 lava, 1 fall) were bots already working deep.**
- So a floor on voluntary descent addresses at most about 10 deaths in 5 days, about 3% of all deaths.

**The pre-dig lava check for climbs already exists.** Climbflood refuses lava on every climb dig, and there were 0
dug-in lava deaths in POST. Mining digs into lava (`mine`, `_ore_tunnel`) appear in ≤ 2 of the 59. The ore tunnel checks
all six faces. **No mining constraint is needed for lava, so iron mining is untouched.**

## 5. Ranked canary candidates

Each candidate is one variable, with a remedy the bot can perform from where it is, and a read that says what it can and
cannot show.

**Expected events on 10 bots in 6 h** (POST rates, average pools; 60 bot-h, about 14 underground):

| event | expected |
|---|---:|
| all deaths | 1.6 |
| drownings | 0.8 |
| sealed episodes | 2.4 |
| lava deaths | 0.3 |
| lava-warned movement starts | about 45, with about 0.4 lava near-misses among them |

**No death endpoint, and no lava near-miss rate, is readable in 6 h on 10 bots.**

| rank | canary | deaths addressable (5-day evidence) | risk | remedy from where the bot is |
|---|---|---|---|---|
| 1 | **`airpocket`**: a dig step inside the drowning rescue | 60 of 170 drownings (35%) pass the screen, 43 (25%) without the untested ice; POST 5 of 14 | low–medium: runs only inside a failing sealed episode (case fatality 29–39%); a new dig in the rescue | dig the one cell above the head with the pickaxe held (14/14 POST drowners had one), then rise into it |
| 2 | **`lavaadmit`**: a retreat before any movement after the bot's own lava warning | up to 32 of 59 lava deaths (54%) | low: movement near named lava is deferred; stranding is a harm line | walk back to its own last trail point ≥ 8 blocks from the named lava; that ground has already been stood on |
| 3 | **`deepfloor`**: no voluntary descent below y 0 (targets and path nodes) | about 10 deaths in 5 days (3%) | low: 1.0% of iron was gathered below y 0; the cost itself is not measured | descend no further; nothing else changes |
| 4 | **`sealedswim`**: the pathfinder never plans a submerged node under a solid roof | unmeasured: the one route example does not size it | medium, and **an owner decision**, because it constrains swimming | a surface route, or the target's next candidate |
| reserve | mine-stair tread/headroom guard (Codex, phase 1) | mine was the entry for 1 of 14 fatal drownings in POST | low | — |

### 5.1 `airpocket` (canary 1)

**The variable.** A new step **inside the drowning rescue**. The air reflex already owns the body there at air
priority, so there is no hand-off to arbitrate (Codex).
- **When it runs:** at the rescue's first `sealed` route verdict, which is usually at seizure with a few seconds of air
  left (Claude review). Failing that, at the first ceiling that ends without air.
- **While it runs:** the ceiling-expiry and release checks are suspended, controls stay owned, and a cancellation stops
  the dig (`stopDigging`) and returns to the rescue's hold.

**When it digs.** All of these must hold, in the bot's own block view:
- head and feet are in water;
- the first non-water cell above the head is within 2 cells of the head, and is one of:
  - **solid, diggable and not a falling block** (packed and blue ice included), with no liquid, falling block or unknown
    cell on its 4 sides or above it. Digging it makes a pocket that stays air.
  - **plain ice with air directly above**. Breaking it opens the column, and the bot rises one cell.

**Budget: a fixed damage envelope, not a trailing fit** (Codex round 2, critical):
- **The envelope:**
  - **0.5 HP/s** when the server reports `peaceful` (`bot.game.difficulty`, as `foodskip.mjs` already reads it) and no
    Hunger effect is active. The sandbox's worst steady loss there was 0.32;
  - **2.0 HP/s** anywhere else. That is vanilla drowning damage with no healing, so it is an upper bound on any world.
- **The reserve is 4 HP.** The step may start only if `(health − 4) / envelope ≥ required`.
- **Required** = `predictedDigMs(cell, tool, {inWater: true, notOnGround})` × 1.5 + 3 s for equipping, latency and the
  rise. The sandbox showed the prediction to be exact.
- **The dig** is `digBounded`, with its deadline set to the remaining envelope budget.
- **It aborts** if the live health loss over any 3 s exceeds the envelope (the envelope was wrong), or if the budget
  runs out.
- **Abort outcome:** the bot is back in today's state. It is drowning in a sealed pocket, holding jump, with less time
  left than if it had held jump all along, which today achieves nothing in this geometry. That cost is the step's risk,
  and the fleet read measures it (deaths per bot-h, and health at abort).

**Success and after:**
- **Success** means the eye position (entity y + 1.62) is inside the dug, now-air cell, **and** `bot.health` then
  **rises**. In peaceful, a breathing bot heals. "Health not falling" is not enough, because a drowning bot shows flat
  health for 30 s (sandbox). The step never relies on `bot.oxygenLevel` (sandbox C).
- **After success** the step keeps the body, holding jump so the head stays in the pocket and the bot does not sink back
  into the suppressed spot. It hands over only to a handler that moves the bot dry (climbflood-guarded), or after 60 s
  of rising health.
- The bot is then dry-headed but enclosed, which is the trapped-bots problem: lost time, not death.

**Refusal.** `_air_pocket_refused` names the reason, and the rescue continues exactly as today. This adds an action and
removes none. A refusal is therefore today's outcome, not a new dead end. It is also not a remedy for the refused cases,
and this canary does not claim them.

**Rows written:**
- `_air_pocket`: plan cell, material, tool, health, slope, budget, predicted and actual ms, outcome, head cell after;
- `_air_pocket_refused`.

**Paper sandbox, before any fleet run.** Both arms, ≥ 5 runs per scene. The server is read back: Health, Air (eye-level
breathing confirmed by server Air rising), the cells, and alive at +120 s. One run per scene uses the full reflex
stack for **≥ 5 minutes**, counting re-seizures, sinking back and health.

| scene | setup | required of the candidate |
|---|---|---|
| A | hive-c geometry: deep water with no floor, a 1-stone roof whose sides are stone | pocket made, breathing |
| B | a 3-thick roof | pocket after one dig |
| C | water beside the roof cell | refuses |
| D | lava above the roof cell | refuses |
| E | sand above | refuses |
| F | **an ice sheet with air above (hive-d)** | breaks the ice and rises (the open-water risk) |
| G | open water | no-op |
| H | the same as A on `easy` | refuses (the 2 HP/s envelope); never dies digging. This scene can only show refusal |
| I | the head cell solid | refuses |

**What the read can show:**

| read | what it can show |
|---|---|
| fleet, 6 h, 10 bots (must include hive-d or hive-c) | **liveness:** ≥ 1 `_air_pocket` row, about 1 opportunity expected. **Correctness:** each one read back (head in air after, health not falling, no foreign liquid, no suffocation within 30 s). **Harm lines:** deaths per bot-h, stranded minutes, mine rows/bot-h. It **cannot** show fewer drownings. |
| fleet, 48 h, 20 bots | case fatality per sealed episode, as a DiD, from about 30 canary sealed episodes. **Still underpowered** for anything less than a halving. |

The effect claim rests on the sandbox scenes and the per-attempt read-back.

### 5.2 `lavaadmit` (canary 2)

**The variable.**
- **When it applies:** a movement skill (explore, gather, goto) is admitted within 120 s of the bot's own pre-entry lava
  warning.
- **What it does:** the bot first walks, by lava-avoiding A*, to the most recent point in its own trail that is ≥ 8 blocks
  from every lava cell named in that window. The trail is a ring of the last 60 positions, sampled every 2 s. Then the
  skill runs.
- **If there is no trail point, or the walk fails,** the skill is refused for the rest of a 120-s window, and the bot
  holds still. That is the existing `_lava_adjacent_no_retreat` behaviour. Other skills still run.
- **The window is anchored to the FIRST warning**, and the bot's own hold-still rows (`_lava_adjacent_no_retreat`,
  re-emitted every 60 s at `reflex.mjs:2294`) never start or extend a window (Claude round 2). Otherwise a failed
  retreat would refresh the window forever.
- **It never refuses twice in a row for the same lava:** after one refused window, the next movement runs as today. The
  worst case is therefore today's behaviour, delayed by 120 s.
- **No advice-only remedy:** the refusal is deterministic and time-bounded.

**What the read can show:**

| read | what it can show |
|---|---|
| 6 h, 10 bots | about 45 opportunities: the gate fires, the retreat succeeds or fails, the refusal expires |
| any affordable fleet size | **not** the effect. In-lava near-misses at about 0.9% give about 3 per 24 h on 20 bots |

The effect claim needs a sandbox replay of "a movement skill started beside a named lava pool", both arms.

### 5.3 `deepfloor` and `sealedswim`

**`deepfloor`** is the descent restriction only (Codex round 2: clamping targets alone is not enough):
- mine, explore, goto and gather targets below y 0 are refused or clamped;
- path nodes below y 0 are excluded from the movement profile, so a route cannot pass below 0 either;
- a bot already below 0 is not evacuated, because that would be a second variable.

It is cheap and safe, and worth about 3% of deaths.

**`sealedswim`** first needs an instrument: count the planned path nodes that are submerged under a solid roof. That
must show the gather and goto entries really are planned swims, and not digs that broke into water. After that it needs
the owner's answer on the water rule.

## 6. An exposure-normalised death reading, grounded on junkwell-01

This section is the evidence for the gate rule the operator is drafting; the script is `scripts/host/ugsafe2_jw.py`.

**Design:**
- **Canary:** placebo-a and board-b, 10 bots, on 911d792, 10-05 10:05 → 15:13Z.
- **PRE:** the 5 h 08 min before. The fleet was on 1918bb5 from about 00:07Z, with no restart inside PRE.
- **Control:** the other 70 bots, all on 1918bb5 only.
- **Positive control:** canary mine rows per bot come out at 16.2 → 50.0. STATE recorded 15.9 → 48.9.
- **Disclosed:** the canary's POST holds 268 rows from the old build (1918bb5). These come from the restart lag right
  after 10:05Z, against 37,258 canary-build rows.

| | canary PRE | canary POST | control PRE | control POST | DiD (null 95%, percentile) |
|---|---:|---:|---:|---:|---:|
| bot-h | 50.8 | 51.6 | 355.8 | 361.6 | |
| underground share | 42.8% | 32.3% | 22.4% | 25.2% | **−0.133** (−0.18…+0.18, 7th) |
| mine rows / bot-h | 3.19 | 9.68 | 6.95 | 6.70 | **+6.74** (−4.3…+4.0, 99th) |
| deaths, all (underground) | 3 (3) | 6 (5) | 16 (6) | 11 (7) | |
| deaths / bot-h | 0.059 | 0.116 | 0.045 | 0.030 | +0.072 |
| deaths / 100 underground bot-h | 13.8 | 36.0 | 20.0 | 12.1 | +30.2 |
| deaths / 1,000 mine rows | 18.5 | 12.0 | 6.5 | 4.5 | −4.6 |
| positive inventory steps / bot-h ("gained") | 91.9 | 112.1 | 65.2 | 65.1 | **+20.2** (−25.9…+22.1, 97th) |
| items carried into deaths | 1,167 | 3,137 | 9,908 | 4,715 | |
| iron pickaxes lost | 0 | 3 | 6 | 4 | |
| net (gained − carried into deaths) / bot-h | 69.0 | 51.4 | 37.3 | 52.1 | **−32.3** (−57.8…+43.7, 9th) |

**The live gate's arithmetic under each exposure.** The gate is ≥ 2 deaths and a one-sided 95% lower bound of the rate
ratio > 1.25 (`scripts/deathgate.py`), applied at the +5 h endpoint only.

| exposure | point ratio | lower bound | junkwell-01 at its endpoint | false-act rate on the null |
|---|---:|---:|---|---:|
| bot-h (the live gate) | 3.82 | **1.40** | **reverts** | 1.6% |
| underground bot-h, all deaths | 2.98 | 1.09 | does not trip | 4.1% |
| underground bot-h, underground deaths only | 3.89 | 1.20 | does not trip | — |
| mine rows | 2.64 | 0.97 | does not trip | 4.1% |
| (the old point-ratio rule) | | | reverts | 35.2% |

**About the null:**
- It is 193 random 2-pool draws over 64 overlapping windows of 5.13 h.
- Only bots that ran the window's majority build are used, and pools carrying a live canary drop out (Claude/Codex).
- It is one evaluation at the end. The live gate polls every 5 min, which raises its false rate.
- Overlapping windows make the 1.6% and 4.1% rough: they are 3 and 8 hits. In 37 windows a live canary dropped 60–80
  bots, so those controls were small.
- Same-version pools are still not exchangeable worlds, so this is not a general false-trip probability.
- The null measures false reverts only. **It does not measure the false holds a normalised rule would add.**

**What this says, for the rule:**
1. **The exposure that rose was mining actions, not time underground.** The canary's underground share fell 10 points
   while its mine rows tripled. An underground-hours denominator does not describe this change.
2. **But mine rows are a post-treatment variable** (Codex, Claude).
   - Normalising by them asks whether each mine action was more dangerous. It does not ask whether the fleet is
     safer.
   - A change that kills by sending bots into risky work is excused by construction.
   - The owner's 10-07 decision (keep bag fixes that free space even when they raise mining) makes that trade a policy
     choice, not a statistical one.
   - **Evidence-based reading:**
     - the live all-cause per-bot-h gate stays the safety gate;
     - normalised ratios are reported beside it as a diagnostic;
     - a normalised ratio can never by itself turn a trip into a KEEP;
     - any rule change is backtested against the known reverts where deaths entered the decision (`deathgate.py`
       names 15, including swim_to and rl-08b) before it is adopted. That backtest was not done here.
3. **"Would not trip at the endpoint" is not "safe".**
   - A bound of 0.97 is not equivalence, and no 5-min sequential replay was run.
   - The canary pools were already worse per mine row before the change (18.5 against 6.5 per 1,000). On a ratio of
     ratios it is 0.92 per mine row, which is pool heterogeneity that a 10-bot, 5-h read cannot settle.
4. **Mechanism split.**
   - **Linked deaths, 0 of 6:** none had a `*well*` row by the same bot in the 120 s before.
   - **Positive control:** the canary bots wrote 75 `*well*` rows in POST, so the query can see them. It has not been
     validated against a known linked death, and spatial linkage and delayed effects were not tested.
   - **What the 6 deaths were:**
     - 4 drownings, entering by pillar_out ×2, fall and gather;
     - 2 lava, entering by fall (y −55) and pillar_out (y −1).
   - **3 of the 6 came through the escape-climb route, guarded since 10-06.**
   - **Proposed classes for the rule:**
     - **linked:** the change's own rows within 120 s, or within 16 blocks of its site; judged deterministically;
     - **exposure:** within 180 s of the activity the change raised; reported per unit of that activity;
     - **background:** the live gate.
5. **The net-output check is real but cannot be read at this size.**
   - "Gained" counts positive inventory steps, not gathering. A junk well disposes items and the server picks some back
     up (`_well_recollected`), so the metric is inflated for exactly this change.
   - Gross gain was at the 97th percentile of the null, and net at the 9th. Both sit inside a band of about ±50
     items/bot-h.
   - Use 20 bots for 24 h or more. Weight by value: iron and iron pickaxes separately, not raw item counts.

## 7. Independent reviews

**Round 1 (draft without sandbox results): both reviewers returned CHANGE.**

- **Codex** (`codex exec`): VERDICT CHANGE, 11 findings, 1 critical.
  - The climb result is a before/after.
  - The health budget is unproven (trailing slope, no reserve, no fallback, no latency).
  - The rung's escape priority (50) loses to the air reflex (100).
  - The 72 s figure is an average, not a slope, and its quantiles were combined across windows.
  - The 53% included open-water sites.
  - Entry attribution and the skill-row re-timing.
  - Mine rows are a post-treatment denominator.
  - "Held" was overstated, and the null was not identical code.
  - The linked-death negative lacked a positive control.
  - The remedies were advisory.
  - Lava deaths were possibly double-counted.
- **Claude** (independent subagent): VERDICT CHANGE.
  - Most numbers reproduce end to end: it re-ran the bounds as 1.40 / 1.08 / 0.97 and confirmed 20 unique lava deaths
    under the old definition.
  - 53% was inflated by the open-water and head-cell-solid sites.
  - The ice → swim step is the unresolved open-water failure.
  - The floating dig is 5x slower, and the budget refuses 2-block roofs.
  - Mine rows are post-treatment, and the null was not identical code.
  - "Gained" is inflated by a junk well.
  - lavastart's control is wrong, and gather after a warning is as deadly as explore.
  - The world list was wrong (isolated-a 19, isolated-d 11).
  - Per-underground-hour rates mislead when 12/14 drownings sit above y 56.
  - The suffocation "artifact" lacked a positive control.
  - `climbs (ug 0)` was a bug.

**What changed in response:**
- Skill snapshots are re-timed. This moved "gained" from about 102 to about 60 per bot-h fleet-wide; the death and
  episode counts are unchanged.
- The null keeps single-version bots only.
- Lava warnings exclude `_reflex_danger_block`, and lava deaths are deduplicated across all movement skills.
- The canary became `lavaadmit` (explore, gather and goto, with a deterministic fallback).
- Roof eligibility now uses the sandbox-measured air-pocket rule plus a per-site health budget: 37% in round 2,
  35% after round 2 added the reserve, not 53%.
- The rescue became a step inside the air reflex, with a continuous budget and a 2 HP/s fallback.
- The world list and the per-bot-h framing were corrected.
- The suffocation positive control was added (6 of 16 against 0 of 287).
- Section 6 was rewritten as evidence for the rule, not a recommendation to normalise.
- The climb and before/after wording was corrected.

**Round 2 (on the revision with the sandbox results):**

- **Claude: APPROVE-WITH-CHANGES.** "The analysis now holds; 5.1 and 5.2 need design fixes before build."
  - It independently re-verified the new numbers on the host: 63 = 46 + 17, 32 unique lava deaths, the suffocation
    control (146 reconnects found; the 6 sit at 78–82 s), every junkwell number and bound, the null, and 49 of 170.
  - Its new items:
    1. The lavaadmit window refreshed forever on the bot's own hold-still rows (high).
    2. "Health not falling" cannot tell success from drowning.
    3. Off peaceful the step always refuses.
    4. A bot that releases after success sinks back.
    5. The summary overstated "saved".
    6. The 1.6% → 4.1% figure is rough.
    7. Packed and blue ice belong under the dig rule.
- **Codex: CHANGE.**
  - Round-1 items now RESOLVED: 1, 3, 4, 7, 8, 11.
  - PARTLY resolved:
    - 2: the budget;
    - 5: "would have saved" still overreaches;
    - 6: the ironband timing, and the 90-s episodes are unvalidated;
    - 9: the linked-death query is not validated against a known linked death;
    - 10: deepfloor's target clamp does not enforce the restriction.
  - New:
    - **critical:** a trailing-slope budget is not safe on every world;
    - the execution details (suspended release checks, cancellation, the rise) were not specified;
    - 63 is an assumption-dependent screen;
    - section 6 should disclose the 268 old-build rows and the limits of the null;
    - lava refusals can recur.

**What changed after round 2** (both reviewers' items, all applied):
- **The budget** is now a fixed damage envelope with a 4 HP reserve, not a trailing fit: 0.5 HP/s on peaceful with no
  Hunger effect, 2.0 HP/s anywhere else. It aborts when the live loss exceeds the envelope, and the abort outcome is
  stated.
- **Dispatch** is at the first `sealed` verdict. Release checks are suspended and cancellation is specified.
- **Success** now needs the eye inside the dug cell AND health rising. After success the step keeps the body.
- **The sandbox full-stack scene** now runs for ≥ 5 minutes.
- **Scene H** is labelled as able to show refusal only.
- **The admission screen** now carries the reserve and is stated as a screen: 60/170, and 43/170 without the untested
  ice.
- **Packed and blue ice** moved to the dig rule. No site changed class.
- **lavaadmit** is anchored to the first warning, ignores the bot's own hold-still rows, and never refuses twice in a row.
- **deepfloor** now also excludes path nodes below y 0, and covers gather.
- **Section 6** discloses the 268 old-build rows, calls the null rough and non-exchangeable, and states the linked-query
  limit.
- **Wording:** "closed" became "guarded", and "saved" became "qualify on today's save".

**Not re-reviewed after these final edits.**
- Codex's last verdict stands at CHANGE, and Claude's at APPROVE-WITH-CHANGES.
- The remaining Codex objection worth naming: the 90-s episode definition and the entry attribution are phase 1's
  method and were not validated by sensitivity runs.

## 8. What this does not show

- **That climbflood reduced drownings fleet-wide.**
- **The instant-of-death terrain.** The roof reading is today's save.
- **Why 11 bots drowned under open water**, and why the 21 hive-d bots appear to sit inside their own ice cell.
- **That ice → rise works.** It was not sandbox-tested.
- **Falls** (58 deaths in 5 days, 19%). They are mostly gather digs ("descent path unknown"), and are the next thread.
- **The lava step at block level.** The sequence is in the rows; the exact entry needs a sandbox replay.
- **Any effect of any candidate.** Nothing has been built.

## 9. Reproduce

All scripts are in `scripts/host/`.

**On mike@10.0.0.31** (`~/ugsafe2/`, with `lib/telemetry.py` and `deathgate.py` copied next to the scripts):

| script | what it does |
|---|---|
| `ugsafe2_extract.py 2026-10-02T17:00:00Z 2026-10-07T17:45:00Z rows` | per-bot extract (about 8 min) |
| `ugsafe2_analyse.py rows an.pkl` | about 6 min |
| `ugsafe2_report.py an.pkl` | section 1.2 |
| `ugsafe2_deaths.py an.pkl POST [ctx]` | section 1.3 |
| `ugsafe2_fatal.py an.pkl rows` | section 2 |
| `ugsafe2_lava.py an.pkl` | section 4 |
| `ugsafe2_lavaopp.py an.pkl rows` | section 4 |
| `ugsafe2_ironband.py rows <since> <until>` | section 4 |
| `ugsafe2_jw.py an.pkl rows` | section 6 |
| `ugsafe2_admit.py an.pkl roof5.tsv` | section 2.1 |

**On mike@10.0.0.30** (`/tmp/ugsafe2/`, with `scripts/lib/anvil.py`; read-only):

| script | what it does |
|---|---|
| `ugsafe2_roof.py < sites.tsv` | each input line is `label world x y z`; produces `roof5.tsv` |
| `ugsafe2_column.py <world> x y z` | prints one column |

The site list comes from `an.pkl` (every `_death` with cause drowning).
