# Trapped bots: who is really stranded, and why (read-only analysis, 2026-10-05)

Window: 24 h, 2026-10-04 11:40Z to 2026-10-05 11:40Z, plus a 6 h slice (05:40Z to 11:40Z) as a check. Nothing was changed: no code, no deploys, no world edits, no RCON.

## The answer

1. **Most "trapped" rows are noise. A minority are real, and some of those are severe.** The mayor's rule (any `_entombed*`/`_marooned*` row in the last 5 min) flags bots as trapped for **35.9% of all bot-time**. Half of those episodes end within 2 min, and only about 1 in 7 lasts 10 min or more.
2. **Bots that are really stranded:** I count a bot as stranded when it stays within 8 blocks of where it was trapped for at least 10 min, with logged evidence that it tried to move and could not. That is **14.7% of fleet bot-time**. Counting only episodes of 30 min or more gives **10.6%**. On average that is about **8 to 12 of the 80 bots stuck at any moment**.
3. **The time is concentrated.** Four bots have been stuck in one spot all day, which is 4.5% of fleet bot-time by themselves. One of them has been in the same spot since **09-28**. The rest is spread thinly: 47 bots lose 5 to 20% of their own time. Only 2 bots were never stranded for 10 min or more.
4. **Why:** a long stranding is a dead end where two or more guards meet:
   - an escape that is refused for lack of blocks;
   - a request for a pickaxe the bot cannot get from where it is;
   - a ceiling dig that times out, often underwater;
   - a pathfinder with no legal first move;
   - the recovery breaker latching after 3 relocation ladders in an hour.

   Water is involved in a third of stranded time. **44% of stranded time starts with the bot already holding a pickaxe and at least 26 placeable blocks**, so missing materials is only part of the story.
5. **Stranding does not kill.** For a bot already 2+ min into an episode, the death rate per bot-hour is 0.7x the rate outside episodes, and the drowning rate is 1.0x. Deaths that do happen inside episodes happen in the first ~3 min, when the bot falls into a flooded pocket. **The cost of stranding is lost time, not deaths.**
6. **It matters, but it is not the main limit.** Getting every stranded minute back would add about 12 to 17% working time. Two things are bigger. Bots spend **74% of bot-time outside any logged skill**, and still **71% even when they are not stranded**. That gap is not explained here.
7. **The mayor's "trapped" blocker overstates the problem 3 to 7 times.** It reproduces exactly (FREE_BAG trapped-blocked 2,177 in 10 h = 218/h), and here is what those blocks really were:
   - **82/h (38%):** the bot had already moved 8+ blocks away; the 5-min window outlives the episode;
   - **54/h (25%):** episodes under 2 min old;
   - **79/h (36%):** episodes at least 2 min old;
   - **31/h (14%):** episodes over 10 min old with evidence the bot could not move.

---

## 1. What "trapped" means in the data

**Positive control.** 1,228,023 rows were walked: 80 bots, 1,903.5 bot-hours, 645 rows per bot-hour, 146 event kinds, read rotation-aware and sorted by time. After 10:05:20Z, the 10 junk-well canary bots (placebo-a, board-b) are cut out of every fleet number.

| kind (24 h) | rows | per bot-h | bots | in mayor rule? |
|---|---:|---:|---:|---|
| `_path_no_legal_move` | 30,909 | 16.2 | 79 | no (row has no position) |
| `_entombed` ("walled in at y=N") | 10,436 | 5.5 | 80 | **yes** |
| `_stagnation` | 6,639 | 3.5 | 80 | no |
| `_marooned` | 4,401 | 2.3 | 78 | **yes** |
| `_maroon_climb_refused` | 3,509 | 1.8 | 55 | no (prefix is `_maroon_`) |
| `_drowning_ceiling_no_air` | 3,499 | 1.8 | 49 | no |
| `_flooded_pocket_rung` | 1,557 | 0.8 | 49 | no |
| `_entombed_unrecoverable` / `_marooned_needs_pickaxe` / `_entombed_needs_blocks` | 871 / 789 / 766 | 0.4 each | 75 / 60 / 45 | **yes** |
| `_entombed_ramp_cut` / `_marooned_ramp_cut` / `_marooned_underfoot` / `_marooned_needs_scaffold` (failed) | 604 / 250 / 195 / 195 | 0.1-0.3 | 20-31 | **yes** |
| `_stranded_underground` / `_stranded_unrecoverable` / `_stranded` | 516 / 236 / 93 | 0.27 / 0.12 / 0.05 | 54 / 11 / 12 | no |
| `_recovery_exhausted` | 212 | 0.11 | 71 | no |
| deaths | 67 | 0.035 | 41 | — |

Mayor-rule rows total about **9.7 per bot-hour**, which is one every ~6 min per bot. The 5-min window therefore covers 35.9% of bot-time. Half of all random bot-moments have a mayor-rule row in the previous 10 min.

**Why routine work trips it:** `isEntombed()` (reflex.mjs @1918bb5) fires when three things are true together:
- there is a solid block two above the feet;
- at least 3 of the 4 side cells are not passable;
- there is higher ground within 4 blocks.

A bot standing in its own 1-wide cut or a sand pit meets all three. Example from **isolated-a-Alpha at 06:29**: it logged `_entombed_unrecoverable` ("asked the goal layer for a pickaxe"), then `_prereq_satisfied` ("had 2/2 after 0s"), and 34 s later a `goto` took it home.

## 2. Real stranding measured as bot-time

**How an episode is defined.**
- It opens on a mayor-rule row.
- It closes when the bot is 8 or more blocks (3-D) from where it was **first** trapped, or when it dies.
- Otherwise it is censored at the end of the window.

Skill rows are timed to their end, because the position snapshot is taken at the end of the skill. "Failure evidence" means at least one of these appears inside the episode:
- at least 3 no-legal-move / noPath rows;
- `_recovery_exhausted`;
- any `_stranded*` row;
- at least 3 move attempts with none succeeding.

| episode length | episodes | share of episodes | share of fleet bot-time | of which has failure evidence |
|---|---:|---:|---:|---:|
| < 30 s | 673 | 9.6% | 0.1% | 2% |
| 30 s - 2 min | 3,212 | 46.0% | 3.1% | 21% |
| 2 - 10 min | 2,597 | 37.2% | 9.4% | 44% |
| 10 - 30 min | 408 | 5.8% | 5.5% | 75% |
| 30 min - 2 h | 78 | 1.1% | 3.8% | 99% |
| > 2 h | 16 | 0.2% | 6.8% | 100% |
| **all** | **6,984** | p50 104 s, p90 468 s, p99 39 min | **28.8%** | |

**Headline: stranded ≥10 min with failure evidence = 14.7% of bot-time** (380 episodes, 78 bots). Stranded ≥30 min = 10.6% (93 episodes, 53 bots). In the 6 h slice the same measures read 13.4% and 8.7%.

**Independent check by position alone.** These are stretches where the bot stays within 3 blocks of one point, with no trap rows used to define them:
- **≥30 min: 10.9% of bot-time.** 8.6% of bot-time contains trap rows plus failure evidence. Only **0.3%** has no trap row away from town.
- **≥10 min: 18.4% of bot-time.** 10.7% has trap rows plus failure evidence.
- The two measures agree on most cases. 78% of the stranded-episode time falls inside these still stretches, and 63% of the still time away from town falls inside stranded episodes.

**Stillness control (this is what makes short episodes weak evidence).** It compares how often a bot stays within 8 blocks for the next 10 or 30 min, starting from a trap opening versus a random moment with no trap row:

| starting point | next 10 min | next 30 min |
|---|---:|---:|
| a trap opening | 19.5% | 12.6% |
| a random moment with no trap row in the prior 5 min | 14.2% | 5.0% |

Bots often stand still for 10 min with no trap at all. So a single trap row predicts long stillness only weakly. Stillness of 30 min or more is 2.5x more likely after a trap row, and that is where nearly all episodes carry failure evidence.

**Sensitivity to the 8-block radius.** Share of bot-time stranded ≥10 min with failure evidence:

| radius | 4 blocks | 8 blocks | 16 blocks |
|---|---:|---:|---:|
| stranded share | 10.2% | 14.7% | 21.6% |

The order of the findings does not change. The size does, so the honest range is **roughly 9 to 15%**.

**Who carries it** (≥10 min with failure evidence, share of each bot's own time over 24 h):

| bot | stranded | where | stuck since (pre-window check) |
|---|---:|---|---|
| board-a-Comet | 100% | 359,40,187 (y=40) | **2026-09-28 15:22Z**, still there 11:59Z |
| placebo-c-Bravo | 100% | 559,37,219 (y=37, in water) | **2026-10-02 18:48Z**, still there |
| placebo-c-Echo | 81% | 383,59,177 (flooded pocket) | 2026-10-04 17:10Z, still there |
| board-c-Bravo | 75% | ~677,71-73,560 (inside a hill) | 2026-10-04 22:45Z, still there |
| hive-a-Echo | 49% | — | — |
| isolated-d-Echo | 35% | — | — |
| board-c-Comet / placebo-a-Bravo / isolated-d-Alpha / isolated-d-Bravo | 25-29% | — | — |

How the 80 bots are spread:
- **4 bots:** more than 50% of their own time stranded;
- **12 bots:** 20 to 50%;
- **47 bots:** 5 to 20%;
- **15 bots:** under 5%;
- **2 bots:** never stranded for 10 min or more.

The top 4 bots carry 31% of all stranded time, and the top 10 carry 47%. By pool, placebo-c, board-a and board-c carry the most and placebo-b, hive-d and placebo-d the least.

**Where they are** (y at the start, weighted by stranded time):

| y | 55-62 | 40-54 | ≥ 63 (at or above sea level) | 0-39 | < 0 |
|---|---:|---:|---:|---:|---:|
| share | 30% | 28% | 22% | 19% | 1% |

This is shallow ground, not deep mines.

**What they were doing:**
- **Milestone:** unknown 27% (mostly the all-day bots), stockpile_wood 15%, idle 13%, gather_iron_ore 11%.
- **Last skill before:** none in the prior 5 min 25%, gather failed 24%, goto failed 9%, mine success 9%.

## 3. Why: causes in the rows

Causes for episodes of 10 min or more with failure evidence. Each episode can carry several tags, and each tag is weighted by stranded time:

| cause tag | share of stranded time |
|---|---:|
| recovery breaker latched ("3 relocation ladders in the last hour ... breaker is off") | 66% |
| refused: not enough blocks to pillar (`_maroon_climb_refused`, `needs_blocks`) | 49% |
| asked for a pickaxe / no tool for the ceiling | 47% |
| pathfinder: no legal first move | 44% |
| ceiling dig timed out or aborted ("dig exceeded 60000ms") | 38% |
| water: sealed or flooded pocket | 36% |
| watchdog: no first leg exists / deterministic rescue exhausted | 32% |
| none of the above | 12% |

What the bot was carrying when the episode opened (read from the trap row itself; blocks counted with the reflex's own `PLACEABLE` list):

| inventory at the start | share of stranded time |
|---|---:|
| usable pickaxe AND ≥ 26 blocks | 44% |
| pickaxe, < 26 blocks | 28% |
| no pickaxe AND < 26 blocks | 26% |
| no pickaxe, ≥ 26 blocks | 2% |

"Usable" here means more than 0 uses left, so 1-use pickaxes count.

**Example timelines** (short row sequences, real data):

1. **board-a-Comet: stuck at y=40 since 09-28.** Every ~15 s it logs `_entombed` "walled in at y=40", then `_maroon_climb_refused` "will not start a 24-block climb with 1 placeable block(s)". Every few minutes:
   - `_entombed_ramp_cut` "ceiling dig failed on copper_ore: dig exceeded 60000ms";
   - `_entombed_needs_blocks` "asked the goal layer for 26x dirt", then `_prereq_abandoned` "had 1/26 after 915s";
   - `surface` "dig failed on copper_ore **by hand**: dig exceeded 114953ms — this stone needs a pickaxe";
   - deposits fail with "No path to the goal!";
   - water rows (`_water_no_air_route`) are present.

   It is holding **a wooden pickaxe with 38 uses**, plus 9 stone pickaxes at 1 use each and 1 dirt. 803 move attempts in 24 h, 0 succeeded. The climb's `bestTool` presumably returns nothing for copper_ore, because a wooden pickaxe cannot harvest it, so the dig is priced and run bare-handed. A bare-handed dig while floating in water is far slower than the 115 s budget. That is **likely, not proven**. It survived 4 code versions this window.
2. **placebo-c-Bravo: y=37, in water, since 10-02.** Sequence:
   - `_entombed_ramp_cut` "ceiling dig failed on stone: dig exceeded 60000ms" and `_entombed_needs_blocks` "26x dirt";
   - `gather bamboo` "you are at y=37 ... run surface first";
   - `surface` "dig failed on stone by hand: dig exceeded 119996ms — gather wood, craft a pickaxe";
   - `explore` "explored 0 blocks in 14 legs", then dozens of `_path_no_legal_move sealed_in_liquid visited=1`;
   - `craft stone_pickaxe` "short 3x cobblestone".

   Bag: no pickaxe, 0 placeable blocks, no logs or table, 408 bamboo. **Every remedy it is told about needs something it cannot get from a water-filled stone pocket.** This is the CLAUDE.md "local policy composition" dead end.
3. **placebo-c-Echo: flooded pocket at 383,59,177 since 10-04 17:10.**
   - 17:10:05 `goto aborted "entombed"`, then a brief float, then `_maroon_climb_refused` "7-block climb with 2 placeable block(s)".
   - Since then: `_drowning_ceiling_no_air` 1,746x/day "held 20s and never reached air — sealed", `_drowning_rescue_yielded` "351 ceilings expired here with no air and no harm", and `_flooded_pocket_rung` "refused: no pickaxe in hand: 2 submerged bare-hand digs exceed one breath".
   - Health stays 18-20, so the bot is alive and permanently boxed. The drowning reflex and the escape reflexes take turns, and neither can dig.
4. **board-c-Bravo: inside a hill at y≈71, since 10-04 22:45.**
   - `_marooned_needs_pickaxe` "column above is capped by stone, and no usable tool is available — asked for pickaxe" fires 335x/day.
   - Each time it is followed by `craft wooden_pickaxe` "short 2x oak_log" and `gather oak_log` "found but unreachable after 3 attempts".
   - Bag: no pickaxe, 0 logs, 11 dirt, 12 raw copper. The pickaxe remedy needs wood it cannot reach.
5. **The common, harmless kind: board-b-Echo at 22:29.**
   - `_entombed` "walled in at y=60" during a path timeout.
   - 36 s later it composts at 12 blocks away. Episode over.
   - 56% of all episodes look like this and are under 2 min long.

## 4. How episodes end, and the link to deaths

- **Episodes of 10 min or more with failure evidence (380):** 372 moved away, 2 died, 6 were still stuck at the end of the window. The 4 all-day bots account for most of the censored time.
- **How they got out:** the move that freed them was almost always an ordinary skill run by the LLM: goto, gather, surface or explore, usually going up. The logged escape reflexes almost never show up as what freed the bot.
- **Restarts:** these were not counted as an ending because position survives a restart. board-a-Comet went through 4 code-version changes in the window without moving.
- **Deaths:** 67 in the window: drowned 40, fell 13, lava 12, suffocated 2.
  - 19 happened inside an episode of any age: 16 drownings, 2 suffocations, 1 lava. For drowning that is 1.6x the outside rate per bot-hour; for all causes it is 1.0x.
  - **15 of the 19 happened within ~3 min of the episode opening.** That is a bot dropping into a flooded pocket, not a bot dying of long stranding.
  - For episodes already 2 min old: 10 deaths. The drowning rate ratio is 1.0x and the all-cause ratio 0.7x.
  - No fall deaths happened inside an episode.
  - (An earlier version of this analysis said "40/40 drownings were preceded by a trap row". That was true but meaningless. It counted drowning-response rows as trap rows, and the base rate for "a trap row in the last 10 min" is 52% of all bot-moments.)

## 5. Is stranding the limiting factor?

| time sink (24 h, share of fleet bot-time) | share |
|---|---:|
| outside any logged skill: LLM deliberation, reflexes, waiting (interval union) | **73.8%** |
| … for bots that are **not** stranded | 70.8% |
| **stranded ≥10 min with failure evidence** | **14.7%** (range ~9-15%) |
| all episodes ≥2 min (the upper bound, includes ordinary stillness) | 25.5% |
| gather failed (all) | 4.0% |
| travel: goto + explore, all outcomes | ~8% |
| deposit failed + craft failed | ~0.4% |

Stranding is the largest **physical** time sink identified here. It is bigger than travel, and much bigger than deposit and craft refusals. Getting it all back would add roughly 12 to 17% working time. But bots are outside any skill for 71% of the time even when they are free, which is a larger and separate question. **Stranding is a real, standing tax, not the limiting factor.** The exception is the four bots that are effectively out of the fleet: 5% of capacity, one of them for 7 days.

**What the mayor's "trapped" blocker would read under stricter rules** (FREE_BAG, 10 h, from the mayor's own snapshots):

| rule | FREE_BAG trapped-blocked per h | vs today |
|---|---:|---:|
| today: any trap row in the last 5 min | 218 | — |
| in an episode open ≥ 2 min (not yet moved 8 blocks) | 79 | 36% |
| in an episode open ≥ 10 min with failure evidence | 31 | 14% |

"Trapped" was the **only** blocker on 199/h of the 218/h. Changing the rule would put about 140 to 185 FREE_BAG candidate-evaluations per hour back in play. These are repeated snapshot observations, not distinct bots: 47 distinct bots fall into the strict class over 10 h.

The same pattern holds for the other duties:
- GET_IRON: 367/h blocked → 57/h under the strict rule;
- RESTORE_PICK: 72/h → 33/h;
- GET_WOOD: 34/h → 28/h. Wood barely changes because its trapped-blocked candidates are almost all long, real strandings, spread over only 7 distinct bots.

The owner's "397/h" FREE_BAG figure is a different unit from my 544/h of candidate evaluations. The 218/h numerator matches exactly.

## 6. Canary pools (placebo-a, board-b on 911d792 since 10:05Z), reported separately

| group | 08:30-10:05Z (before) | 10:05-11:40Z (after) |
|---|---:|---:|
| canary 10 bots: mayor flag | 30.0% | 40.7% |
| canary 10 bots: stranded ≥10 min with failure evidence | 8.3% | 3.4% |
| canary 10 bots: `_entombed` per bot-h | 5.2 | 7.3 |
| control 70 bots: mayor flag | 35.8% | 35.6% |
| control 70 bots: stranded ≥10 min with failure evidence | 13.6% | 11.3% |
| control 70 bots: `_entombed` per bot-h | 5.0 | 5.0 |

That is 15.7 canary bot-hours with a deploy restart in the middle, and a restart resets the escape back-off. **Not readable either way.** It is noted here only so nobody reads it later as a finding.

## 7. Independent check (Codex, read-only) and what changed

Codex reviewed the scripts and outputs. Its objections, and what was done about each:

1. **Skill rows record the position at the end but the timestamp at the start.** Fixed: skill rows are re-timed to start + duration. The headline totals moved less than 0.2 points. The death link did change; see §4.
2. **"Stayed within 8 blocks" shows the bot did not move, not that it could not.** Addressed with the failure-evidence split and the stillness control (§2). Episodes of 30 min or more have 99% failure evidence; episodes of 2 to 10 min have only 44%, so I do not count them as stranding. No manual or world check of terrain was done.
3. **The inventory claim was two separate percentages, not the combination, and was read from the previous row.** Fixed: the trap row's own snapshot is used, blocks are counted with the reflex's `PLACEABLE` list, and the table shows the combined breakdown.
4. **Mayor reclassification:** added the 22 canary candidates, the "died within 5 min" class, the trapped-only-blocker count, the distinct-bot count, and a note on the denominator.
5. **Thresholds:** radii 4/8/16 for episodes and 1/3/5 for position checks are reported. Still stretches now end at the last position inside them. Mayor windows shorter than 5 min were not swept; the 2-min and 10-min reclassification covers that question.
6. **The "four bots all day" claim:** checked before the window opened. The dates are in the table, and the word "restart" is now defined as a code-version change.
7. **Activity time** is now an interval union. "How it ended" is still a heuristic: the row that closed the episode, or the skill running at that moment.
8. **The drowning link is now normalised by exposure** and uses only the mayor's rule rows (§4).

## What this does not show

- **Whether any one bot could physically have got out.** Nothing was checked against the world with RCON; the "why" comes from what the rows say. The copper_ore "by hand" explanation for board-a-Comet is an inference from the inventory and the message text, not a test.
- **That freeing stranded bots would raise output by the stranded share.** Free bots also spend most of their time outside any skill.
- **That the thresholds are right.** The size moves with them (10 to 22% across radii); the ranking does not.
- **Anything about the junk-well canary.**
- **Causes within the 10-30 min band.** It is 25% without failure evidence and may include ordinary idling in a pit.
- **A full picture of deaths.** It is one day, 67 deaths, and the death results are about rates, not individual deaths.

## Reproduce

On mike@10.0.0.31, in `/tmp/trapped/`:
- **Extract:** `extract.py` builds the compact, rotation-aware, deduped and sorted pickle. Blocks are counted with the reflex's `PLACEABLE` list.
- **Main analysis:** `final.py` (results in `final-h24.txt`, `final-h6.txt`, and `final-{can,ctl,canpre,ctlpre}.txt` for the canary split). Command: `python3 final.py rows24.pkl <start> <end> <tag> [census]`.
- **Supporting scripts:**
  - `pass4.py`: the first death base-rate control;
  - `extra.py`: skill coverage and the any-age death link;
  - `since.py`: the pre-window history of the four all-day bots;
  - `examples.py`: the timelines.
- **First-pass scripts** (`episodes.py`, `deep.py`, `pass3.py`) are kept so you can see what Codex corrected.
- **Codex's review:** `codex-out.txt` in the session scratchpad.
