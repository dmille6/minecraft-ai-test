# stations-01: the town's crafting tables and furnaces (design, 2026-11-06)

## Owner, verbatim (11-06 ~12:40Z)

"what can we do about crafting tables and furnaces? can the greenskeepers pick up all the ones thrown across town and use the
materials for something? can we instruct the bots to use [stations] in town in designated areas that are already built?"
Earlier: owner-stockpile-1102 ("why are we building so many crafting tables, furnaces and chests?"), owner-workshop-uses-1028
(the workshop is the town workbench), owner-gk-town-clean-1104 (a clean, beautiful town).

## Measured (fleet cab8abcf / decbundle canary, 11-06)

**World read** (region files copied from the 16 fleet worlds ~12:40Z, every chunk within 136 blocks of each home: 324 chunks a
town, 0 missing; `docs/reports/stations-2026-11-06/scan.py` (+ collect.py, drive.sh, classify.py) over `townplan_blockdump.py`'s decoder; classified against each town's latest project
records, plan and protected zones from the canary host):

| | count | out of |
|---|---|---|
| crafting tables within 136 of home | 3,828 | 16 towns |
| furnaces within 136 of home | 4,577 | 16 towns |
| workshop fit-out stations (positive control) | 45 | 45 expected (15 complete workshops x 3) |
| in other project records | 9 | |
| in protected zones | 72 | |
| furnaces lit or holding items | 133 | 4,577 furnaces |
| deep (y < home - 20: mines, the town shaft) | 3,711 | 8,405 |
| **surface strays** | **4,435** (~277 a town) | 8,405 |
| ... within 32 of home / 32-72 / 72-136 | 31-76 / 48-118 / 89-171 a town | |
| tables + furnaces in town chests (town index) | 17 + 8 | 16 towns (positive control: 47 chests counted in the same read) |

**Telemetry**, 12 h full walk (`lib.telemetry`, 828,238 rows, 80 of 80 bots, ~960 bot-h; `docs/reports/stations-2026-11-06/m1.py`):

| | count | out of |
|---|---|---|
| smelt placed a furnace ("placed the furnace first") | 101 | 1,033 smelt rows |
| ... of which underground (town footprint 50, ring 15, away 9) | 74 | 101 |
| ... town or ring surface within 64 of the workshop | 7 | 101 |
| ... taken back | **0** (no code path) | 101 |
| craft placed a table | 92 | 895 craft rows |
| ... taken back | 68 | 92 |
| stations left by inventory delta (craft/smelt rows) | 167 (~21 a town-day: matches flowledger's 14-27) | |
| ... underground | 126 (75%) | 167 |
| top-level crafts of a furnace / table | 90 / 19 | none while holding one (the bag allowance works) |

So the leak is **at the source, underground**: smelt in mines puts a furnace down and walks off. The 4,435 surface strays are
history the groundskeepers can clean; the 3,711 deep ones are in mines (walking a mine to fetch a table is movement risk, and
mostly unreachable from town).

## Codex's independent design (codex exec, read-only; given the measurements and the goal, not this design)

Full text: `docs/reports/stations-2026-11-06/codex-design.txt`. In short: one shared station policy (`stationpolicy.mjs`) + `stationkeep.mjs`;
switches STATION_SWEEP / REUSE / RETAKE / SURPLUS + master. Strays at ANY elevation within 136, no nearest-two exemption, tables
and furnaces; persist chunk/band sweep cursors; <= 3 recoveries or 45 s a visit. A furnace only under the same exclusive lease
every smelt caller uses, its window read with all slots explicitly empty (unknown is not empty), unlit, no hopper; never drain
foreign contents. Bank all swept copies explicitly. One station resolver for craft/smelt/make_material/smelt_town and a guard in
place(); no 64-block cutoff in town; bounded path probes; busy = defer, never place. A station-free town uses the plan's `work`
plot station cells. Withdraw before any station recipe; away from town an exact-coordinate recovery obligation, departure blocked
until recovered. Surplus furnaces fill vacant furnace cells of the work strip (a smelting row); two spare tables kept, extra tables
as fuel for already-demanded smelts. Paper must prove: concurrent craft/sweep exclusion, furnace slot sync, full bags/chests, exact
furnace recovery, restarts, chest races.

## Reconciliation

| question | Codex | Claude | chosen, why |
|---|---|---|---|
| where the leak is fixed | both | the source first: 75% of leaks are underground | **both**; the take-back carries the 70% goal, the sweep cleans history |
| take-back | exact placed furnace, under its lease | stationkeep-01's drained check | **stationkeep-01's + Codex's exact-furnace rule** (`smeltRetake` refuses `not_the_job_furnace`); after placing, the job takes THE placed furnace first (`take(only)`); a call that placed and returned before loading takes it back too |
| departure blocked until recovered | yes, persisted obligations | no | **no**: the retake runs inside the call that placed it (smelt's whole session is stationary); a persisted obligation is a new state format for the ~15% left |
| sweep elevation | any | surface band (home -16..+40) | **surface**: the deep ones are in mines; the source fix stops new ones |
| sweep scope | 136, persisted cursors | 136 from one findBlocks over the loaded town | **findBlocks from home** (count 512, radius 193) each visit, nearest the bot first; the ~277 a town clear in days at 4 a visit; a cursor adds state for no gain |
| nearest-two kept | no | no (the workshop is the town's) | **none kept**; the town's stations are the workshop's (or the designated cells) |
| furnace proof | lease + window all empty, no drain, no hopper | same | **same**; mineflayer 4.37.1 emits `windowOpen` only after the window's slot data (`prepareWindow`, lib/plugins/inventory.js), so the one read after `openFurnace` is synchronized |
| banking | explicit deposit of all swept copies | the bag allowance banks every copy past one at the next town deposit | **the allowance** (one of each kept: the bag then never crafts one); no new deposit path |
| resolver | one resolver for every caller, a guard in place() | the in-town craft/smelt look up the town's stations by key first (the existing preferWorkshop path), make_material/smelt_town already do | **existing path extended** (craftLevel's tables, smelt's prefer, `STN.reach` 160 in town); no place() guard (place has a dozen callers; builders own their own stations) |
| busy town furnaces | defer, never place | | **adopted**: in town with the town's furnaces all leased, smelt returns furnace_busy and does not put its own down |
| station-free town | the plan's work-plot cells | | **adopted** (`townStations` / `designatedCell` / `placeDesignated`); the station placed there stays and the workshop builder later finds the cell done |
| withdraw before craft | any station recipe, after a complete chest search | a station craft in town, holding none, the town index showing one | **Claude's**: `withdrawFirst` + matsWithdraw; the craft makes only what was not withdrawn |
| surplus tables | fuel for demanded smelts, keep two | fuel in the bot's own smelt past the one kept | **Claude's**: `SPARE_FUEL_TICKS` (300 ticks, ranked before planks) offered only by smelt and only for the tables past one; never a general fuel (the prompt's fuel hint and the work order stay unchanged) |
| surplus furnaces | a smelting row in the work strip's vacant furnace cells | the withdraw stock | **withdraw stock now**: the chests hold 8 furnaces fleet-wide while 90 are crafted in 12 h, so the swept ones are demand, not surplus; a smelting row places into the workshop record's strip (a building piece with its own tripwire rule) once the chests show a standing furnace surplus |

## Piece built: stations-01 (fleet, tier 2: `protected.py --base 9e9284d7` = not protected)

Built ON gkforever-01 9e9284d7 (it composes with the perpetual grounds: the sweep is part of the tidy visit, the keeper and its
helper are the sweepers, and a sweep visit counts as grounds work). SUPERSEDES stationkeep-01 (its smelt take-back is carried here
with the exact-furnace rule; its 32-block tables-only plaza sweep is replaced). Every part its own switch; `STATIONS=0` = gkforever-01:

- **RETAKE** (`STN_RETAKE`): smelt digs back the furnace it placed (the job's, drained, harvest tool, room, not leased by another);
  also when it placed one and stopped before loading. A furnace at a designated cell stays. Rows `_station_retaken`.
- **SWEEP** (`STN_SWEEP`): the tidy visit (after its grounds work with >= 30 s left, or a complete stage's repair visit via
  `strayDue`) takes up to 4 strays or 90 s, nearest the bot first; exclusions as above; zones unreadable = no sweep. Rows
  `_station_sweep` (found/strays/tried/back/left/skipped) and `_station_swept`.
- **REUSE** (`STN_REUSE`): in town, craft and smelt look up the town's stations by key within 160 first (walk time scaled); with
  them all busy, smelt waits; a plan town's first station goes to its designated cell. Rows `_station_use`.
- **WITHDRAW** (`STN_WITHDRAW`): `craft crafting_table|furnace` in town, holding none, the index showing one -> from the chest.
- **SURPLUS** (`STN_SURPLUS`): spare tables are smelt fuel.

Tests: `bots/test/stations.test.mjs` (pure decisions; the real smelt over a fake world: placed furnace back with the pickaxe, a
standing one never dug, no tool -> left, no block events -> left, spare tables burn and one is kept, one table never burns; the
real sweepFurnace: empty -> dug and back, holding output/fuel/input -> left, an unreadable slot -> left; wiring; 15/15 anchored
mutants). Re-anchored: smelt-plan (same-stack mutant), tidy (recordDamaged), workbench (the wiring regexes).

## Effect (registration)

Owner-facing goal: stations placed and not retaken per town-day **down >= 70%** (flowledger `left_stations`, ~21 a town-day
before), surface strays per town falling (a second world read 24 h after promotion), table/furnace crafts down, value per bot-h not
worse. effectmetrics can count the new rows only on an absolute scale (a zero baseline is unreadable relative): targets
`_station_retaken|success` and `_station_swept|success` rates up (absolute), guardrails items per bot-h and smelt needs_station.

## Paper / mineflayer facts this rests on

- `openFurnace` resolves with the window's slots filled (mineflayer 4.37.1 `prepareWindow` waits for `setWindowItems`): read in
  source; the fleet's furnace_drain uses the same one-read rule (335 empty / 1 drained reads today).
- A furnace dug with a pickaxe drops itself (and, vanilla, its contents: why the sweep proves it empty first); bare-handed it drops
  nothing (the harvest-tool check). collectManually's walk/dig/pickup is the existing table retake's (68 of 92 back today).
- place() at explicit coordinates does not consult the plan (its own reservation): the designated cell is placeable.
- To prove in a Paper sandbox before or during the canary (not run here: no sandbox lock taken): a sweep of a furnace another bot
  is about to load (lease exclusion end to end), and a designated-cell placement in a station-free town (board-c's case).
