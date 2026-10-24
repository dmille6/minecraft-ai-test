# The per-seed hazard map (2026-10-24): host data first

OWNER 2026-10-24: build a per-seed hazard map from the telemetry history, as host data first. Bots will use it later,
through the mineshaft design's `lavasight-01` (F5b). This document covers the tool, the first map built from it, and the
staged daily refresh.

**Nothing on the fleet was changed.** That covers bots, worlds, the queue, the scheduler, the manifest, env files and
crontabs. RCON was not used. World reads were read-only, and all but one were of copies: the staged nightly backup, the
dormant `world.pre-reseed-*` copies, and for one positive control the 10-22 NAS archive. The exception is the live
`level.dat`, which is read only to confirm it names the same seed as the staged copy. ES was read with the read-only key. Heavy jobs ran at
`nice -n 19` (and `ionice -c3` on .30).

Branch `hazardmap-1024`. Tool: `scripts/host/hazardmap/`. Evidence: `docs/reports/hazardmap-2026-10-24/`. **r4**
answers the r1-r3 reviews (section 10). The numbers below are from the r3 build at 10-24 06:07Z.

## 0. Answers first

1. **Seeds.** 10 of the 16 fleet worlds share seed `1239381899`: board-a, board-c, board-d, hive-a, hive-b,
   isolated-a..d and placebo-c. Each of the other six has a seed of its own. All six were on `1239381899` until they were
   reseeded:
   - placebo-a 09-18;
   - placebo-b 09-19;
   - hive-c, board-b, hive-d and placebo-d 09-27.

   So their earlier history belongs to the shared seed. Seeds were read from each world's `level.dat`, in the staged
   backup, the live world and the pre-reseed copies.
2. **Coordinates map as the identity.** The brief expected town homes to differ between worlds that share a seed. They
   do not: all 10 shared-seed worlds have their home at **(355, 73, 147)**, which is also the world spawn. Terrain is the
   same at the same absolute coordinates.
   - Bedrock control: the bedrock floor is seeded noise, and no bot digs it. At 867 cells it agrees **1.000** between
     board-a and each of the other 9 shared-seed worlds.
   - Across different seeds it agrees 0.37-0.72, which is chance.
   - A seed whose agreement around its own home falls below 0.99 is not merged: each of its worlds is kept apart, and the
     header alarms.

   The six singleton worlds keep their own homes.
3. **Top hazards on the shared seed.** These are the two hot spots the mineshaft report found, re-found from scratch:

   | Hazard | Deaths since 08-22 | 10-08+ | Last 7 d | Still there |
   |---|---|---|---|---|
   | Surface lava pool, ~45 blocks from home, centre (396, 69, 109) | 188, in 16 worlds | 46 | 18 | yes, in 10 of 10 worlds |
   | Cave lava lake, centre (335, 35, 205) | 291 | 44 | 18 | yes, in 9 of 10 |
   | Drowning, the lake at (356, 60, 178) | 132 | 40 | 14 | |

   - **The board-a copper trap (359, 40, 187)** holds 556.7 trapped bot-h in 4 spells; the longest is 389.9 h. Its
     shape (water under a solid ceiling) is still in board-a and **absent in the other 9 worlds**.
   - **The board-d pits (329, 61, 213) and (555, 61, 116)** hold 273.9 and 167.8 bot-h. The pit check reads them
     **present in the 10-22 backup and absent now in all 10 worlds**. In both, one head-level wall has been opened.
     That matches poolescape-01 digging the bots out on 10-23 (section 5).

   The 10 top hazards on the shared seed hold 89 of its 194 deaths last week.
4. **The value number.** Last week had **277 deaths** (10-17 06:07Z to 10-24 06:07Z). 194 of them could match: another
   world, current or since reseeded away, was on their seed at least 24 h before.
   - **123 died within 3 blocks horizontally and 4 vertically of a same-kind death, in ANOTHER world of their seed, at
     least 24 h earlier.** That is 44% of all deaths and 63% of the 194 that could match.
   - **40 of the 123 had no earlier same-kind death there in their own world, at any lag.** That is what the map adds
     beyond per-world memory (keepout, world facts).
   - **The chance nulls:**
     - with the earlier deaths moved 48 blocks, 6.4 match on average (max 19);
     - with them rotated about the home, which keeps the town's density, 1.7 match (max 3).
   - **By kind (matched / could match / all):** lava 47 / 59 / 80, drowning 34 / 40 / 82, cave fall 25 / 47 / 54,
     dripstone 16 / 40 / 40, suffocation 1 / 8 / 21.
5. **Tool and refresh.** `hazardmap.py` (ES + files + backup verify), `serve.py` (a restricted read-only key's forced
   command) and `test_hazardmap.py` (239 cases, including blind-input mutants and code mutants). The alarm surfaces in
   the fleetstatus header through `patch_fleetstatus.py`. Daily refresh: `install-hazardmap.sh` in three operator steps
   (section 8). Nothing is installed.
6. **Reviews.** See section 10.

## 1. Seeds and coordinates

**Method.** `verify()` on 10.0.0.30 reads `level.dat` (NBT `Data.WorldGenSettings.seed`) with `sudo -n cat` from three
places:
- `/srv/world-backup/staging/<world>/world/`;
- the live `/srv/block2/<world>/world/`;
- each `/srv/block2/<world>/world.pre-reseed-<ts>/`.

A world segment begins at the ext4 birth time of its `world/datapacks`. A retired segment ends at its pre-reseed
timestamp.
- **Positive control:** the byte-search reader and the NBT reader agree on all 16 worlds. `server.properties`
  `level-seed` agrees on all 16 as well.
- **Coverage:** no pre-reseed copy exists for the other 10 worlds, and none of them has a second one.
- **r2 guards:**
  - verify refuses when the staged and live seeds differ, or when the live world was created after the backup. Either
    means the backup holds another generation;
  - seeds resolve only up to the verify file's `made_at` + 1 h. Rows after that are not folded, and the heartbeat reads
    `incomplete`;
  - more than 50 validated rows outside every world segment raises. That count leaves out quarantine rows and rows
    within 30 min of a creation or retirement, so a reseed in the window still builds (r3);
  - the bedrock control for a seed is taken around that seed's own home (r3).

| World | Seed now | Home | Before |
|---|---|---|---|
| board-a, board-c, board-d, hive-a, hive-b, isolated-a, isolated-b, isolated-c, isolated-d, placebo-c | 1239381899 | (355, 73, 147) | created 08-22 / 08-25 |
| placebo-a | 8948499624371160708 | (249, 75, -144) | 1239381899 until 09-18 23:52Z |
| placebo-b | 7843072457371465157 | (282, 65, -388) | 1239381899 until 09-19 11:10Z |
| hive-c | 4394143238757369828 | (-68, 68, -68) | 1239381899 until 09-27 12:35Z |
| board-b | 6443945553241215903 | (-249, 65, 144) | 1239381899 until 09-27 13:09Z |
| hive-d | 4534598234323719516 | (68, 65, 68) | 1239381899 until 09-27 13:23Z |
| placebo-d | 2021899648305791853 | (177, 75, 73) | 1239381899 until 09-27 13:39Z |

- **Merge rule.** A row's seed is the seed of its world's segment at the row's time.
- **Excluded rows:** those before a world existed, inside a 10-min quarantine after a world's creation, or between a
  retirement and the next creation. They are counted: 34 deaths, 221 danger rows and 38 give-ups, all in the history
  window and 0 in the validated one. Most are 08-20..24 rows from a server that came before these worlds.
- Seeds are **strings** in every file, because 64-bit seeds exceed a JavaScript number and lavasight is JS.

**Terrain control** (`verify-summary-2026-10-24.json`). At 867 bedrock cells, y −63..−61 around (355, 147):
- **within the shared seed: 1.000 for 9 of 9 pairs, over 867 cells each, around (355, 147), the seed's home;**
- **across seeds: 0.37-0.72 (21 pairs).**

## 2. Window, sources, controls, denominators

**Window.**
- ES `mcai-skill-agents` from 2026-08-22 to 10-24: 63 UTC days. 10-07 is refused, because it holds duplicate documents.
- Rows before 10-08 are history that ES never reconciled (the `lib/estelemetry` caveat). Each hazard carries
  `deaths.validated` separately.
- The day cache re-counts every closed day against ES on each run, `_water_float` included, and refetches a day whose
  counts changed. On a repeat run, 62 of 62 closed days matched exactly.
- A missing or void validated day raises.

**Sources (validated window, rows):**

| Kind | Rows | Fewest on one closed day |
|---|---|---|
| `_death` | 632 | 28 |
| `_death_site_recorded` | 632 | 28 |
| `_lava_corridor` | 31,581 | 1,510 |
| `_explore_blind_step_refused` (lava) | 47,684 | 1,894 |
| `_reflex_danger_block` | 2,172 | 62 |
| `_lava_adjacent_*` | 1,768 | 27 (no retreat) / 9 (stand-off) |
| `_marooned` | 109,808 | 5,710 |
| `_water_no_air_route` | 4,970 | 102 |
| `_entombed` | 197,683 | 11,176 |
| `_entombed_unrecoverable` | 19,129 | 1,053 |

- Unparsed: 0 in every source.
- Two kinds of row are recognised and skipped: corridor rows refused for UNKNOWN cells name no lava (about 1 a day),
  and campfire danger rows are not lava.
- Wet buckets come from a server-side histogram of `_water_float`, per bot per 10 min.
- Bot-hours are (bot, hour) buckets with at least one row: 7,085-7,455 per world.

**Positive controls, and what makes the build raise.**
- **Death position:** 632 of 632 validated deaths have the same bot's `_death_site_recorded` row within 2 s. In 620
  (98.1%) it names a cell within 1 block of `floor(bot.pos)`. It raises below 90% paired or 95% agreeing. The newest 3
  closed days are checked again on their own: 132 of 132 paired, 127 (96.2%) agreeing. Their floor is 85%, because a
  real break reads near 0% and a 3-day sample is noisier.
- **Deaths:** 277 in 7 days, against the mineshaft report's 276 over a window about 16 h earlier.
- **Hot spots:** the mineshaft report's two top cells come back as the top two lava hazards, with 18 and 18 deaths in 7
  days.
- **Recent health (r2, r3):**
  - Every source, and `_water_float`, must speak on each of the newest 3 closed days (10-21, 10-22 and 10-23 in this
    build). The exception is `_water_no_air_route`. About 80% of its rows are one trapped bot, and it may go quiet once
    he is freed, so it must speak at least once in the newest 7.
  - The unparsed share is judged over the whole window and again over the newest 3 days (with at least 50 rows).
  - Each day's `_death` count must match its `_death_site_recorded` count within 2.
  - Every validated day up to the expected cutoff must be cached, non-void, and closed once it has ended. Each record
    must cover what it should: a closed day its whole day, and today's open day up to within 2 h of the build. A missing
    tail or a stale partial fetch is a stale map.

  A kind renamed or reformatted yesterday cannot hide behind the weeks it spoke before.

**Denominators.** Every number in sections 4-6 states what it is out of.

## 3. What a hazard is (the labels, and where they come from)

Every label comes from a row the bot wrote about the world. None comes from an intent row.

| Kind | Evidence | Cluster link (xz, y) | Still-exists check against the staged backup |
|---|---|---|---|
| `lava` | fire deaths by server message ("tried to swim in lava", "... after falling", "discovered the floor was lava"); guard rows that NAMED a lava cell (`lava below/beside/beside the drop at X,Y,Z`); danger rows (feet cell, or the cell below when the feet are clear) | 3, 4 | lava / magma / fire within 2, y −2..+1 |
| `drowning` | "drowned" deaths | 3, 4 | head-deep water within 1 |
| `cave_fall` | "fell from a high place", "hit the ground", "fell off", "doomed to fall" | 3, 4 | ≥ 4 open cells straight up, within 1 |
| `dripstone` | stalagmite / stalactite deaths | 3, 4 | `pointed_dripstone` within 2, y −2..+16 |
| `water_pit` | a trapped spell ≥ 30 min, ≥ 20% `_marooned` rows, ≥ 50% wet 10-min buckets | 2, 2 | the board-d shape: water on a solid floor, head open, 4 head walls solid |
| `water_ceiling_trap` | a trapped spell ≥ 30 min, ≥ 20% `_water_no_air_route` rows | 2, 2 | the board-a shape: water at feet and head, solid directly above |
| `entombment` | suffocation deaths; ≥ 3 entombed give-ups; trapped spells ≥ 30 min that are ≥ 50% entombed rows | 3, 3 | not block-checkable (own geometry or a ghost block): `not_applicable` |

**A trapped spell** is one bot's merged stream of `_marooned`, `_water_no_air_route`, `_entombed` and
`_entombed_unrecoverable` rows:
- rows no more than 15 min apart;
- within 3 blocks of the spell's first row;
- split at the bot's deaths.

The longest spell, board-a-Comet's, has no gap over 15 min across 389.9 h. Dry maroon spells (633 spells, 1,014 bot-h)
are not water pits by this rule. They are counted and excluded, and are a candidate for a later kind.

**Rules.**
- **Clusters:** single-linkage on distinct cells. A cluster wider than 32 blocks is tiled 16×16.
- **Id:** `<seed>/<kind>/<earliest evidence cell>`, stable while that cell stays in the evidence.
- **What qualifies as a hazard:** any death; any trapped spell; lava with ≥ 2 sighting episodes (distinct bot × 10-min
  bucket); entombment with ≥ 3 give-ups.
- **Confidence:**
  - **high:** deaths in ≥ 2 worlds, or ≥ 3 deaths, or spells totalling ≥ 6 bot-h;
  - **medium:** 2 deaths, or 1 death plus ≥ 2 sighting episodes, or spells ≥ 2 bot-h, or ≥ 5 episodes from ≥ 2 bots;
  - **low:** the rest.
  - A hazard verified absent in every world of its seed drops one level.

## 4. Top hazards per seed

The full list is in `hazardmap-2026-10-24/report-2026-10-24.txt` and in `~/hazardmap/out/hazardmap.json` once
installed. Column notes:
- "Deaths" = all deaths since 08-22 / validated (10-08 onward) / last 7 days.
- "Worlds" = worlds with a death there.
- "Present" = worlds of the seed where the backup copy still shows the hazard.

**Seed 1239381899 (10 worlds; 2,637 hazards).**
- Hazards by kind: lava 253, drowning 1,095, cave fall 386, dripstone 82, entombment 768, water pit 43, ceiling trap 10.
- Confidence: 375 high, 175 medium, 2,087 low. Most low ones are single historical drownings.

| Kind | Centre | Deaths | Worlds | Trapped bot-h | Present | Confidence |
|---|---|---|---|---|---|---|
| lava (surface pool) | 396, 69, 109 | 188 / 46 / 18 | 16 | — | 10 / 10 | high |
| lava (cave lake) | 335, 35, 205 | 291 / 44 / 18 | 16 | — | 9 / 10 | high |
| lava | 334, 39, 154 | 13 / 12 / 9 | 4 | — | 10 / 10 | high |
| lava (magma) | 325, 58, 217 | 34 / 10 / 4 | 10 | — | 7 / 10 | high |
| lava (deep) | 327, −35, 124 | 4 / 4 / 3 | 3 | — | 10 / 10 | high |
| drowning | 356, 60, 178 | 132 / 40 / 14 | 16 | — | 10 / 10 | high |
| drowning | 324, 60, 218 | 88 / 19 / 9 | 14 | — | 10 / 10 | high |
| drowning | 344, 60, 197 | 108 / 17 / 2 | 16 | — | 10 / 10 | high |
| cave fall | 473, −21, 333 | 39 / 11 / 4 | 13 | — | 10 / 10 | high |
| cave fall | 442, 6, 388 | 31 / 6 / 2 | 11 | — | 10 / 10 | high |
| cave fall | 371, −9, 154 | 5 / 5 / 4 | 4 | — | 10 / 10 | high |
| dripstone | 373, −5, 151 | 6 / 6 / 4 | 5 | — | 10 / 10 | high |
| dripstone | 431, −4, 177 | 6 / 6 / 5 | 3 | — | 10 / 10 | high |
| **ceiling trap (board-a copper)** | 359, 40, 187 | 0 | — | **556.7** (4 spells, longest 389.9) | **1 / 10 (board-a)** | high |
| ceiling trap | 419, 60, 83 | 0 | — | 77.2 | 6 / 10 | high |
| **water pit (board-d)** | 329, 61, 213 | 0 | — | **273.9** (3 spells) | **0 / 10** (present 10-22) | medium (absent: lowered) |
| **water pit (board-d)** | 555, 61, 116 | 0 | — | **167.8** | **0 / 10** (present 10-22) | medium (absent: lowered) |
| entombment | 559, 37, 219 | 0 | — | 486.9 (4 spells) | n/a | high |
| entombment | 342, 43, 205 | 1 | 1 | 478.1 (5 spells) | n/a | high |

**Singleton seeds (one world each, history on their own seed only).**

| Seed (world) | Hazards | Deaths 10-08+ / 7 d | Top hazards |
|---|---|---|---|
| placebo-d | 183 | 35 / 18 | lava (209, 32, 110) 5 deaths; lava (225, 55, −2) 5; entombment (198, 34, 187) 206 bot-h (placebo-d-Delta) |
| hive-d | 209 | 61 / 23 | lava (45, 61, 40) 6 deaths (6 validated); drowning (99, 48, 109) 3 |
| hive-c | 219 | 29 / 14 | drowning (−59, 57, −73) 4 deaths, all in the last 7 d; lava (−147, 65, −55) 3 |
| placebo-a | 255 | 33 / 14 | deep lava after falls (157, −55, −161) and (266, −52, −63), 2 each |
| placebo-b | 147 | 18 / 9 | drowning (302, 59, −396) 6 |
| board-b | 170 | 17 / 6 | no hazard has more than 2 deaths |

**What it means for transfer.**
- **Terrain hazards transfer: lava, cave falls and dripstone.** The top ones are present in 9-10 of the 10 shared-seed
  worlds.
- **Trap shapes do not transfer.**
  - The board-a ceiling trap exists in board-a only.
  - Of 400 sampled water-pit probes, the pit shape is present in 4.75% of world copies.

  These traps are partly bot-made geometry: the board-d walls are cobblestone, which the poolescape design reads as the
  pathfinder's bridge blocks. So the map keeps them per world through `exists.by_world`, not per seed.

## 5. Does it still exist? (verify, and its controls)

Verify runs on the staged backup, only after that night's `good <day>` line. 27,914 probes were made across 16 worlds:
26,599 present, 1,287 absent and 28 not generated. It took 70 s and used 544 MB.

**How a negative is claimed (r2, r3).**
- `absent` requires every cell the check read to have been read successfully. That includes cells outside the probe's
  footprint, such as a pit wall at r + 1.
- A probe that straddles an ungenerated chunk, or that hits a cell that does not decode, reads `unknown`.
- A hazard's probes in one world combine as follows: present if any probe is present; absent only if all are absent.
- An absence counts only while two things still match what was checked: the probe cells, and a fingerprint of the
  hazard's whole evidence footprint. It also counts only if no evidence arrived after the request. Late-ingested rows
  change the fingerprint. Otherwise it reads `unchecked`.

**Positive control on a pit that existed.** The 10-22 NAS archive of board-d was read, read-only. It was made before
poolescape-01 freed the bots on 10-23 at 01:50Z.

| Cell | 10-22 backup | 10-24 staged copy |
|---|---|---|
| (329, 61, 213) | `present`: walls cobblestone / cobblestone / andesite / cobblestone | `absent`: one wall dirt, one air, cobblestone above the head |
| (555, 61, 116) | `present`: 4 cobblestone walls | `absent`: the east wall is now air |

That matches the poolescape record: Alpha dug 1 and placed 3, Bravo dug 1 and placed 1.

**The negative control** moves the same probes 48 blocks east and 48 blocks south, in the same world and at the same y.
It used 400 probes per kind (100 for the ceiling trap).

| Kind | Present at the hazard | Present 48 blocks away | Reading |
|---|---|---|---|
| lava | 95.75% | **0.75%** | strong |
| dripstone | 96.0% | 23.3% | good |
| cave fall | 95.0% | 35.5% | moderate |
| water pit | 4.75% | 0.25% | the shape is rare; see section 4 |
| ceiling trap | 59% | 18% | moderate |
| drowning | 96.5% | **43.5%** | **weak**: the town sits on a lake, so head-deep water is common nearby |

A drowning hazard's `present` therefore means little. Lava's means a great deal.

## 6. The map's potential value

**The question.** Of last week's deaths, how many happened at a hazard the map already knew from an earlier death in
another world?

**Definitions.**
- **Match:** a same-kind death in another world of the same seed, within 3 blocks horizontally and 4 vertically, and
  at least 24 h earlier. A daily map cannot know a death from an hour ago.
- **"Beyond per-world memory":** a match that has no earlier same-kind death at the cell in its own world, at ANY lag.
  keepout and world facts update live.
- **Window:** 10-17 06:07Z to 10-24 06:07Z.
- **Denominators:**
  - all 277 deaths;
  - the 194 that could match. For these, another world (current, or since reseeded away) had a segment on their seed
    that began at least 24 h before the death.

  The other 83 died in a singleton-seed world and could not match. The build asserts that every match is one of the 194.

| | Matched | Of 277 | Of 194 |
|---|---:|---:|---:|
| **Headline** | **123** | 44.4% | 63.4% |
| ... with no earlier same-kind death there in their own world (beyond per-world memory) | **40** | 14.4% | 20.6% |
| Chance null 1: earlier deaths moved 48 blocks, 8 directions | mean 6.4, max 19 | 2.3% | 3.3% |
| Chance null 2: earlier deaths rotated 90/180/270° about the home (the town's density kept) | mean 1.7, max 3 | 0.6% | 0.9% |
| Earlier deaths from the validated window (10-08+) only | 102 | | |
| No 24 h lag | 125 | | |
| Any kind (a lava death at a drowning site counts) | 132 | | |
| Link 6 / 6 | 146 | | |

| Kind | Matched / could match / all deaths |
|---|---|
| lava | 47 / 59 / 80 |
| drowning | 34 / 40 / 82 |
| cave fall | 25 / 47 / 54 |
| dripstone | 16 / 40 / 40 |
| suffocation | 1 / 8 / 21 |

The matched deaths come from all 10 shared-seed worlds (isolated-d 31, isolated-a 16, board-d 13, placebo-c 11,
isolated-c 11, others 6-10).

**What the number is.** It is *potential*. A bot dying at a hazard the map knew is not a bot the map would have saved.
That depends on lavasight-01's routing (F5b), which is a canary question. The 40 are the best estimate of what a
cross-world map adds over per-world memory. And keepout covers only fire, and only digs.

## 7. The format (`mcai.hazardmap` v1), for lavasight-01 and expedition planning

`~/hazardmap/out/hazardmap.json` on 10.0.0.31. One dated copy per day is kept for 21 days.

**Rules for consumers.**
- Treat a file past `stale_after` (generated + 36 h) as VOID.
- Refuse a `schema_version` you do not know.
- **Additive fields** may appear without a version change. A renamed or retyped field bumps `schema_version`.

```
{schema: "mcai.hazardmap", schema_version: 1, generated_at, stale_after,
 coords: "absolute block coordinates, floor of the position; one seed = one terrain",
 window: {history_since, validated_since, refused_days, days_folded, until},
 controls: {rows, unparsed, recent_days, death_vs_site_by_day, death_site_recorded, excluded, bot_hours_by_world,
            terrain, verify_backup_day, verify_made_at, world_facts},
 kinds: {<kind>: {what, link, check}}, confidence_rule,
 seeds: {"<seed as a string>": {
   worlds: {<world>: {home: [x,y,z], on_seed_since}}, past_worlds: [{world, from, until}], counts: {<kind>: n},
   hazards: [{
     id: "<seed>/<kind>/<x>,<y>,<z>", kind, center: [x,y,z], bbox: [[x0,y0,z0],[x1,y1,z1]], first_seen, last_seen,
     deaths: {total, validated, last_7d, by_world: {w: n}, messages: {category: n}, cells_total,
              cells: [[x,y,z]] (<= 16, most deaths first, then most recent)},
     sightings: {rows, episodes, by_source, cells_total, cells: [[x,y,z,rows,last_ms]] (<= 64, most-seen first)},
     gave_ups, spells: {n, bot_hours, longest_h, bots}, worlds_with_evidence, death_worlds, bots,
     confidence: "high"|"medium"|"low",
     exists: {summary: "present"|"absent"|"unknown"|"unchecked"|"not_applicable", backup_day, present_in: [w],
              by_world: {w: {state: "present"|"absent"|"not_generated"|"unknown"|"unchecked", found: {...}}}}
   }]}},
 value: {...}}
```

**Per-world view (what F5b's "per-world lava memory" needs).**
1. For world W, take its current seed: `seeds[s].worlds` contains W.
2. Keep the `lava` hazards whose `exists.by_world[W].state` is not `absent`.
3. Use `sightings.cells` plus `deaths.cells` as the cells. lavasight re-reads each cell live anyway, and its design
   already removes a loaded cell that reads non-DANGER.

**Expedition planning** can rank regions by the hazard count and deaths per region, with the same per-world filter.

**Not in v1.**
- Publication into `/var/lib/mcai/_pool-*`. No bot reads this file, and no bot code was changed. The publisher belongs
  with lavasight-01, like `frontierpublish.py`.
- Withdrawal tombstones (the frontier census defers these too).

## 8. The tool and the daily refresh

- **10.0.0.30, cron 04:30Z.** `hazardmap.py verify`:
  - it refuses unless that night's backup logged `good`, and refuses a staged/live seed mismatch;
  - it reads seeds and the probes requested the previous day from the staged copy;
  - it writes `~/hazardmap/out/verify.json`.
- **10.0.0.31, cron 05:10Z.** `hazardmap.py refresh`:
  1. **The gate:** the installed copy's own suite, 239 cases including the mutants. A failure publishes nothing and
     sets the heartbeat to `gate_failed`.
  2. Pull `verify.json` over the restricted key.
  3. Fetch new or changed ES days.
  4. Build. It refuses a verify file older than 72 h, and the header alarms after 30 h.
  5. Write the map, the report and the heartbeat. The heartbeat reads `incomplete` (an alarm) in two cases: rows were
     left unfolded past the seeds' horizon (a missed or failed verify), or a seed failed the terrain control.
  6. Push tomorrow's request. A failed push sets the heartbeat to `push_failed`.

  Lag: a hazard first seen today is `unchecked` until the next night.
- **The alarm:** `hazardmap.py check` prints one line, OK or `HAZARDMAP ALARM: <why>`. The install patches it into the
  installed fleetstatus header with `patch_fleetstatus.py`:
  - it is anchored on the frontier lines, so it composes with structcount's patch;
  - the copy is backed up first, and the edit is idempotent;
  - the repo's `scripts/test_fleetstatus.py` passes 46 of 46 on a patched copy;
  - `--revert` takes out exactly its three insertions. On the installed copy, which already carries structcount's
    patch, patching and then reverting gives back a byte-identical file.
- **The key** is `restrict,from="10.0.0.31",command=".../serve.py"`. It answers `verify` | `status` | `request`
  (stdin, ≤ 16 MB, validated, then written atomically to the one file it may write). It never runs sudo or a shell.
  This is the pattern of the structcount key, which both engines reviewed.

**Install, as mike, from a checkout of `hazardmap-1024`, in order.**
```
on 10.0.0.31:  bash scripts/host/hazardmap/install-hazardmap.sh --on-31
               (copies the tool to ~/hazardmap/app, runs the suite, makes ~/.ssh/id_hazardmap, prints the .30 line)
on 10.0.0.30:  bash scripts/host/hazardmap/install-hazardmap.sh --on-30 '<that line>' --install-cron
               (installs ~/hazardmap/bin, runs the suite, appends the key line with a .bak, runs one verify, adds the 04:30Z cron)
on 10.0.0.31:  bash scripts/host/hazardmap/install-hazardmap.sh --verify --install-cron
               (positive control pull; 7 forbidden requests and port forwarding refused; one refresh, the first backfills
                ~6 min; adds the 05:10Z cron; patches the fleetstatus header line)
```
- **Rollback:**
  - delete the cron lines ending `# hazardmap`;
  - remove the key line on .30 (a `.bak` is beside it);
  - run `patch_fleetstatus.py <installed fleetstatus> --revert`, which keeps any later structcount edit;
  - remove `~/hazardmap` on both hosts.

  Both hosts' cron runs in UTC (`date +%z` = +0000).
- **Rehearsed:** steps 1 and 2 ran end to end in throwaway `HOME`s on both hosts (r1 code), with no cron. The forced
  command was exercised locally. Step 3 needs the real key, so it was not run.
- **Cost:** a full ES backfill takes ~6 min. A daily refresh is about 5 s of recounts and 12 s of build (510 MB). The gate
  takes about 2 min on the Mac and about 6 min at nice 19 on .31: an end-to-end `refresh` there took 6 min 23 s.
  Verify takes about 70 s at nice 19 and 544 MB.
- **Refresh rehearsed end to end on .31** in a dev home, with no key, so the pull and push failed by design:
  - the gate passed;
  - the pull failure kept the previous verify file;
  - fetch and build ran;
  - the push failure set the heartbeat to `push_failed`;
  - `check` printed `HAZARDMAP ALARM: last refresh push_failed ...` and exited 1.

## 9. What this does not show

- **That the map saves anyone.** That is lavasight-01's canary.
- **Bot-hours for death hazards.** keepInventory and immediate respawn make a death's cost the walk back, which is not
  measured. Bot-hours are given only for trapped spells.
- **The causes of suffocation.** Mineshaft F3 owns that. Entombment hazards are labelled from rows only, and are never
  block-checked.
- **Drowning existence.** The check is weak (null 43.5%, section 5).
- **History before 10-08.** It is unreconciled in ES. The validated-only variant (102) is the conservative value.
- **Block states.** A probe reads block names and the waterlogged property only, never fluid levels. The pit check
  accepts any water at the feet.

## 10. Review record

`docs/reports/hazardmap-reviews-2026-10-24.txt` holds each round verbatim, with the response to each finding.

## 11. Reproduce

On 10.0.0.31 (ES key) and 10.0.0.30 (staged backup), from a checkout of the branch:
```
python3 -B scripts/host/hazardmap/test_hazardmap.py                    # 239 cases
python3 -B scripts/host/hazardmap/hazardmap.py fetch --home H           # .31
python3 -B scripts/host/hazardmap/hazardmap.py verify --out O [--request R]   # .30; copy O/verify.json to H/in/
python3 -B scripts/host/hazardmap/hazardmap.py build --home H           # .31; H/out/{hazardmap.json, report-*.txt, request.json}
python3 -B scripts/host/hazardmap/hazardmap.py check --home H           # the header line
```
The r3 map was built at 10-24 06:07Z. Its verify used backup 2026-10-24 and the r3 request.
