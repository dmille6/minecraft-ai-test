# The per-seed hazard map (2026-10-24): host data first

OWNER 2026-10-24: build a per-seed hazard map from the telemetry history, as host data first. Bots will use it later,
through the mineshaft design's `lavasight-01` (F5b). This document covers the tool, the first map built from it, and the
staged daily refresh.

**Nothing on the fleet was changed.** That covers bots, worlds, the queue, the scheduler, the manifest, env files and
crontabs. RCON was not used. Every world read was a copy: the staged nightly backup, or the dormant `world.pre-reseed-*`
copies. ES was read with the read-only key. Heavy jobs ran at `nice -n 19` (and `ionice -c3` on .30).

Branch `hazardmap-1024`. Tool: `scripts/host/hazardmap/`. Evidence: `docs/reports/hazardmap-2026-10-24/`.

## 0. Answers first

1. **Seeds.** 10 of the 16 fleet worlds share seed `1239381899`: board-a, board-c, board-d, hive-a, hive-b,
   isolated-a..d and placebo-c. Each of the other six has a seed of its own. All six were on `1239381899` until they were
   reseeded:
   - placebo-a 09-18;
   - placebo-b 09-19;
   - hive-c, board-b, hive-d and placebo-d 09-27.

   So their earlier history belongs to the shared seed. Seeds were read from each world's `level.dat`, in the staged
   backup and in the pre-reseed copies.
2. **Coordinates map as the identity.** The brief expected town homes to differ between worlds that share a seed. They
   do not: all 10 shared-seed worlds have their home at **(355, 73, 147)**, which is also the world spawn. Terrain is the
   same at the same absolute coordinates.
   - Bedrock control: the bedrock floor is seeded noise, and no bot digs it. At 867 cells it agrees **1.000** between
     board-a and each of the other 9 shared-seed worlds.
   - Across different seeds it agrees 0.37-0.72, which is chance.

   The six singleton worlds keep their own homes.
3. **Top hazards on the shared seed.** These are the two hot spots the mineshaft report found, re-found from scratch:

   | Hazard | Deaths since 08-22 | 10-08+ | Last 7 d | Still there |
   |---|---|---|---|---|
   | Surface lava pool, ~45 blocks from home, centre (396, 69, 109) | 188, in 16 worlds | 46 | 18 | yes, in 10 of 10 worlds |
   | Cave lava lake, centre (335, 38, 210) | 290 | 43 | 18 | yes, in 9 of 10 |
   | Drowning, the lake at (356, 60, 178) | 132 | 40 | 14 | |

   - **The board-a copper trap (359, 40, 187)** holds 554.6 trapped bot-h in 4 spells; the longest is 387.8 h. Its
     shape (water under a solid ceiling) is still in board-a and **absent in the other 9 worlds**.
   - **The board-d pits (329, 61, 213) and (555, 61, 116)** hold 273.9 and 167.8 bot-h. Both are now **absent in all
     10**, because poolescape-01's digs changed them.

   The 10 top hazards on the shared seed hold 89 of its 195 deaths last week.
4. **The value number.** Last week had **279 deaths** (10-17 04:43Z to 10-24 04:43Z). 195 of them were on a seed that
   two or more worlds shared at that moment, and only those could match.
   - **122 died within 3 blocks horizontally and 4 vertically of a same-kind death, in ANOTHER world of their seed, at
     least 24 h earlier.** That is 44% of all deaths and 63% of the 195 that could match.
   - **42 of the 122 had no such earlier death in their own world.** That is what the map adds beyond per-world memory
     (keepout, world facts).
   - **The chance null:** with the earlier deaths moved 48 blocks, 6.2 match on average (max 19).
   - **By kind:** lava 46 of 79, drowning 34 of 84, cave fall 25 of 55, dripstone 16 of 40, suffocation 1 of 21.
5. **Tool and refresh.** `hazardmap.py` (ES + files + backup verify), `serve.py` (a restricted read-only key's forced
   command) and `test_hazardmap.py` (147 cases, including blind-input mutants and code mutants). Daily refresh:
   `install-hazardmap.sh` in three operator steps (section 8). Nothing is installed.
6. **Reviews.** See section 10.

## 1. Seeds and coordinates

**Method.** `verify()` on 10.0.0.30 reads `level.dat` (NBT `Data.WorldGenSettings.seed`) from
`/srv/world-backup/staging/<world>/world/` with `sudo -n cat`, and does the same in each live
`/srv/block2/<world>/world.pre-reseed-<ts>/`. A world segment begins at the ext4 birth time of its `world/datapacks`,
and a retired segment ends at its pre-reseed timestamp.
- **Positive control:** the byte-search reader and the NBT reader agree on all 16 worlds. `server.properties`
  `level-seed` agrees on all 16 as well.
- **Coverage:** no pre-reseed copy exists for the other 10 worlds, and none of them has a second one.

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
  retirement and the next creation. They are counted: 34 deaths, 221 danger rows and 38 give-ups. Most are the 08-20/21
  rows of an earlier server.
- Seeds are **strings** in every file, because 64-bit seeds exceed a JavaScript number and lavasight is JS.

**Terrain control** (`verify-summary-2026-10-24.json`). At 867 bedrock cells, y −63..−61 around (355, 147):
- **within the shared seed: 1.000 for 9 of 9 pairs;**
- **across seeds: 0.37-0.72 (21 pairs).**

## 2. Window, sources, controls, denominators

**Window.**
- ES `mcai-skill-agents` from 2026-08-22 to 10-24 03:52Z: 63 UTC days. 10-07 is refused, because it holds duplicate
  documents.
- Rows before 10-08 are history that ES never reconciled (the `lib/estelemetry` caveat). Each hazard carries
  `deaths.validated` separately.
- The day cache re-counts every closed day against ES on each run, and refetches a day whose counts changed. On the
  second run, 62 of 62 days matched exactly.

**Sources (validated window, 17 days, rows):**

| Kind | Rows |
|---|---|
| `_death` | 630 |
| `_death_site_recorded` | 630 |
| `_lava_corridor` | 31,370 |
| `_explore_blind_step_refused` (lava) | 47,357 |
| `_reflex_danger_block` | 2,166 |
| `_lava_adjacent_*` | 1,759 |
| `_marooned` | 109,430 |
| `_water_no_air_route` | 4,957 |
| `_entombed` | 196,796 |
| `_entombed_unrecoverable` | 19,036 |

- Unparsed: 0 in every source.
- Corridor rows refused for UNKNOWN cells name no lava. They are recognised and skipped (about 1 a day).
- Wet buckets come from a server-side histogram of `_water_float`, per bot per 10 min.
- Bot-hours are (bot, hour) buckets with at least one row: 7,075-7,445 per world.

**Positive controls.**
- **Death position:** 630 of 630 validated deaths have the same bot's `_death_site_recorded` row within 2 s. In 618
  (98.1%) it names a cell within 1 block of `floor(bot.pos)`. Below 90% paired or 95% agreeing, the build raises.
- **Deaths:** 279 in 7 days, against the mineshaft report's 276 over a window shifted by about 15 h.
- **Hot spots:** the mineshaft report's two top cells come back as the top two lava hazards, with 18 and 18 deaths in 7
  days.
- **The blind guards:** every source has rows on most validated days, and a silent source raises.

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

The longest spell, board-a-Comet's, has no gap over 15 min across 387.8 h. Dry maroon spells (633 spells, 1,014 bot-h)
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

**Seed 1239381899 (10 worlds; 2,636 hazards).**
- Hazards by kind: lava 253, drowning 1,095, cave fall 386, dripstone 82, entombment 767, water pit 43, ceiling trap 10.
- Confidence: 375 high, 175 medium, 2,086 low. Most low ones are single historical drownings.

| Kind | Centre | Deaths | Worlds | Trapped bot-h | Present | Confidence |
|---|---|---|---|---|---|---|
| lava (surface pool) | 396, 69, 109 | 188 / 46 / 18 | 16 | — | 10 / 10 | high |
| lava (cave lake) | 335, 38, 210 | 290 / 43 / 18 | 16 | — | 9 / 10 | high |
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
| **ceiling trap (board-a copper)** | 359, 40, 187 | 0 | — | **554.6** (4 spells, longest 387.8) | **1 / 10 (board-a)** | high |
| ceiling trap | 419, 60, 83 | 0 | — | 77.2 | 6 / 10 | high |
| **water pit (board-d)** | 329, 61, 213 | 0 | — | **273.9** (3 spells) | **0 / 10** | medium (absent: lowered) |
| **water pit (board-d)** | 555, 61, 116 | 0 | — | **167.8** | **0 / 10** | medium (absent: lowered) |
| entombment | 559, 37, 219 | 0 | — | 485.7 (4 spells) | n/a | high |
| entombment | 342, 43, 205 | 1 | 1 | 476.8 (5 spells) | n/a | high |
| entombment | 365, 39, 191 | 4 / 3 / 1 (suffocation) | 3 | 408.2 (9 spells) | n/a | high |

**Singleton seeds (one world each, history on their own seed only).**

| Seed (world) | Hazards | Deaths 10-08+ / 7 d | Top hazards |
|---|---|---|---|
| placebo-d | 183 | 35 / 18 | lava (209, 32, 110) 5 deaths; lava (225, 55, −2) 5; entombment (198, 34, 187) 206.1 bot-h (placebo-d-Delta) |
| hive-d | 209 | 61 / 23 | lava (45, 61, 40) 6 deaths (6 validated); drowning (99, 48, 109) 3 |
| hive-c | 219 | 29 / 14 | drowning (−59, 57, −73) 4 deaths, all in the last 7 d; lava (−147, 65, −55) 3 |
| placebo-a | 255 | 33 / 14 | deep lava after falls (157, −55, −161) and (266, −52, −63), 2 each |
| placebo-b | 147 | 18 / 9 | drowning (302, 59, −396) 6 |
| board-b | 169 | 17 / 6 | no hazard has more than 2 deaths |

**What it means for transfer.**
- **Terrain hazards transfer: lava, cave falls and dripstone.** The top ones are present in 9-10 of the 10 shared-seed
  worlds.
- **Trap shapes do not transfer.**
  - The board-a ceiling trap exists in board-a only.
  - The board-d pits are gone everywhere.
  - Of 400 sampled water-pit probes, the pit shape is present in 4.75% of world copies.

  These traps are partly bot-made geometry (the board-d walls are pathfinder cobblestone), so the map keeps them per
  world through `exists.by_world`, not per seed.

## 5. Does it still exist? (verify, and its negative control)

Verify runs on the staged backup, only after that night's `good <day>` line. 27,917 probes were made across 16 worlds:
26,576 present, 1,313 absent and 28 not generated. It took 65 s and used 540 MB.

**The negative control** moves the same probes 48 blocks east and 48 blocks south, in the same world and at the same y.
It used 400 probes per kind (100 for the ceiling trap).

| Kind | Present at the hazard | Present 48 blocks away | Reading |
|---|---|---|---|
| lava | 95.3% | **0.75%** | strong |
| dripstone | 96.0% | 24.8% | good |
| cave fall | 95.3% | 35.0% | moderate |
| water pit | 4.75% | 0.25% | the shape is rare; see section 4 |
| ceiling trap | 59% | 18% | moderate |
| drowning | 98.3% | **46.3%** | **weak**: the town sits on a lake, so head-deep water is common nearby |

A drowning hazard's `present` therefore means little. Lava's means a great deal.

## 6. The map's potential value

**The question.** Of last week's deaths, how many happened at a hazard the map already knew from an earlier death in
another world?

**Definitions.**
- **Match:** a same-kind death in another world of the same seed, within 3 blocks horizontally and 4 vertically, and
  at least 24 h earlier. A daily map cannot know a death from an hour ago.
- **Window:** 10-17 04:43Z to 10-24 04:43Z.
- **Denominators:** all 279 deaths, and the 195 on a seed that two or more worlds shared at the time of death. The
  other 84 died in a singleton-seed world and could not match.

| | Matched | Of 279 | Of 195 |
|---|---:|---:|---:|
| **Headline** | **122** | 43.7% | 62.6% |
| ... with no such earlier death in their own world (beyond per-world memory) | **42** | 15.1% | 21.5% |
| Chance null: earlier deaths moved 48 blocks, 8 directions | mean 6.2, max 19 | 2.2% | 3.2% |
| Earlier deaths from the validated window (10-08+) only | 102 | | |
| No 24 h lag | 124 | | |
| Any kind (a lava death at a drowning site counts) | 131 | | |
| Link 6 / 6 | 145 | | |

| Kind | Matched / deaths |
|---|---|
| lava | 46 / 79 |
| drowning | 34 / 84 |
| cave fall | 25 / 55 |
| dripstone | 16 / 40 |
| suffocation | 1 / 21 |

The matched deaths come from all 10 shared-seed worlds (isolated-d 31, isolated-a 16, placebo-c 12, board-d 12, others
6-11).

**What the number is.** It is *potential*. A bot dying at a hazard the map knew is not a bot the map would have saved.
That depends on lavasight-01's routing (F5b), which is a canary question. The 42 are the best estimate of what a
cross-world map adds over keepout's per-world fire memory. And keepout covers only fire, and only digs.

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
 controls: {rows, unparsed, death_site_recorded, excluded, bot_hours_by_world, terrain, verify_backup_day, world_facts},
 kinds: {<kind>: {what, link, check}}, confidence_rule,
 seeds: {"<seed as a string>": {
   worlds: {<world>: {home: [x,y,z], on_seed_since}}, past_worlds: [{world, from, until}], counts: {<kind>: n},
   hazards: [{
     id: "<seed>/<kind>/<x>,<y>,<z>", kind, center: [x,y,z], bbox: [[x0,y0,z0],[x1,y1,z1]], first_seen, last_seen,
     deaths: {total, validated, last_7d, by_world: {w: n}, messages: {category: n}, cells: [[x,y,z]] (<= 16)},
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
  - it refuses unless that night's backup logged `good`;
  - it reads seeds and the probes requested the previous day from the staged copy;
  - it writes `~/hazardmap/out/verify.json`.
- **10.0.0.31, cron 05:10Z.** `hazardmap.py refresh`:
  1. **The gate:** the installed copy's own suite, 147 cases including the mutants. A failure publishes nothing and
     sets the heartbeat to `gate_failed`.
  2. Pull `verify.json` over the restricted key.
  3. Fetch new or changed ES days.
  4. Build. It refuses a verify file older than 72 h, since the seeds may predate a reseed.
  5. Write the map, the report and the heartbeat.
  6. Push tomorrow's request.

  Lag: a hazard first seen today is `unchecked` until the next night.
- **The key** is `restrict,from="10.0.0.31",command=".../serve.py"`. It answers `verify` | `status` | `request`
  (stdin, ≤ 16 MB, validated, then written atomically to the one file it may write). It never runs sudo or a shell.
  The structcount key's pattern was reviewed by both engines.

**Install, as mike, from a checkout of `hazardmap-1024`, in order.**
```
on 10.0.0.31:  bash scripts/host/hazardmap/install-hazardmap.sh --on-31
               (copies the tool to ~/hazardmap/app, runs the suite, makes ~/.ssh/id_hazardmap, prints the .30 line)
on 10.0.0.30:  bash scripts/host/hazardmap/install-hazardmap.sh --on-30 '<that line>' --install-cron
               (installs ~/hazardmap/bin, runs the suite, appends the key line with a .bak, runs one verify, adds the 04:30Z cron)
on 10.0.0.31:  bash scripts/host/hazardmap/install-hazardmap.sh --verify --install-cron
               (positive control pull; 7 forbidden requests and port forwarding refused; one refresh, the first backfills
                ~6 min; adds the 05:10Z cron)
```
- **Rollback:** delete the two `# hazardmap` cron lines, the key line on .30 (a `.bak` is beside it), and `~/hazardmap`
  on both hosts.
- **Rehearsed:** steps 1 and 2 ran end to end in throwaway `HOME`s on both hosts, with no cron. The forced command was
  exercised locally. Step 3 needs the real key, so it was not run.
- **Cost:** a full ES backfill takes ~6 min. A daily refresh is about 5 s of recounts, 10 s of build (400 MB) and 30 s of
  gate. Verify takes about 65 s at nice 19 and 540 MB.

## 9. What this does not show

- **That the map saves anyone.** That is lavasight-01's canary.
- **Bot-hours for death hazards.** keepInventory and immediate respawn make a death's cost the walk back, which is not
  measured. Bot-hours are given only for trapped spells.
- **The causes of suffocation.** Mineshaft F3 owns that. Entombment hazards are labelled from rows only, and are never
  block-checked.
- **Drowning existence.** The check is weak (null 46%, section 5).
- **History before 10-08.** It is unreconciled in ES. The validated-only variant (102) is the conservative value.
- **Block states.** A probe reads block names and the waterlogged property only, never fluid levels. The pit check
  accepts any water at the feet.

## 10. Review record

`docs/reports/hazardmap-reviews-2026-10-24.txt` holds each round verbatim, with the response to each finding.

## 11. Reproduce

On 10.0.0.31 (ES key) and 10.0.0.30 (staged backup), from a checkout of the branch:
```
python3 -B scripts/host/hazardmap/test_hazardmap.py                    # 147 cases
python3 -B scripts/host/hazardmap/hazardmap.py fetch --home H           # .31
python3 -B scripts/host/hazardmap/hazardmap.py verify --out O [--request R]   # .30; copy O/verify.json to H/in/
python3 -B scripts/host/hazardmap/hazardmap.py build --home H           # .31; H/out/{hazardmap.json, report-*.txt, request.json}
```
The first map was built at 10-24 04:43Z. Its verify used backup 2026-10-24, made at 04:26Z from the 04:21Z request.
