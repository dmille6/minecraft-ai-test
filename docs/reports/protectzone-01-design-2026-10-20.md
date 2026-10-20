# protectzone-01 — the showcase village kept as scenery (2026-10-20)

**OWNER DECISION 2026-10-20 ~15:30Z: "option 1"** — the naturally generated village in the showcase world is protected as
scenery: the bots never dig, take apart, build in, open, sleep in or craft at anything in it. Trading with the villagers may
come later; nothing here touches villagers.

Branch `protectzone-on-9e7d998` (from the fleet's control sha `9e7d9980`, read from `/srv/mcbots/trial-manifest.json` on
.31 at 15:4xZ). No world was edited: the protection is the bots' own rule, read from a data file.

## 1. The village (read-only, from the world files)

Region files were copied off VM 207 (`tar -C /srv/showcase/server/world -cf - region`, 36 files, 23,956 chunks walked)
and read with a stdlib NBT reader (`infra/showcase/structure_zones.py`, this branch). Positive control: the same walk found
209 structure starts of 17 kinds, so a missing kind is not a reader blind spot.

**`minecraft:village_taiga`, start chunk (6, 1)**, 92 jigsaw pieces, union box **x 44..149, y 62..90, z -51..37**:

| piece | box (x0 y0 z0 .. x1 y1 z1) |
|---|---|
| taiga_meeting_point_1 (the bell at 93,77,25) | 79 75 16 .. 96 77 37 |
| taiga_tannery_1 | 84 75 6 .. 92 80 14 |
| taiga_fletcher_house_1 | 107 75 6 .. 116 80 16 |
| taiga_weaponsmith_1 | 121 63 -17 .. 127 71 -11 |
| taiga_small_house_2 (x2) | 76 72 -12 .. 82 78 -6; 108 65 -15 .. 114 71 -9 |
| taiga_small_house_4 | 62 69 -13 .. 68 74 -6 |
| taiga_small_house_5 (x2) | 97 76 23 .. 103 82 31; 120 73 -3 .. 128 79 3 |
| 38 streets, 12 decorations / lamp posts, 26 terminators, 12 villager / cat / golem markers | — |

**Block evidence** (the same files; village-made blocks only -- beds, bell, workstations, dirt_path, spruce
planks/doors/trapdoors/stairs, glass panes, torches, cobblestone, chests -- counted inside the village's own pieces):
x **57**..149, y 62..81, z -51..30 -- dirt_path 818, cobblestone ~500, spruce_planks 100, spruce_trapdoor 87, glass_pane
28, wall_torch 19, spruce_door 18, torch 13, spruce_stairs 10, 5 beds, 5 chests. The westmost street piece (straight_02,
x 44..59, z 2..17) left no block west of x 57: its ground is grass and no path was laid. **Usable things inside**: chests
at 124,64,-13; 123,74,-1; 86,76,12; 111,76,12; 101,77,26 -- beds, a crafting table (64,70,-11), 2 grindstones, a fletching
table, 2 water cauldrons, the bell, a campfire. The "hay/pumpkin feature" is 27 pumpkins (taiga decorations and natural
patches); there is no hay in this village.

**The protected footprint** = the extent of those blocks together with every house and town-centre piece, padded 8
horizontally; from the world's bottom up to 8 above the highest roof:

> **`village-taiga-6_1`: box x 49..157, y -64..90, z -59..45** (109 x 105 columns). West edge 49 blocks east of home.

**Why the whole column (Claude r1 P1):** with a box starting a few blocks under the ground, a bot could tunnel in UNDER the
village legally, and its only way up was through the village -- which every non-survival dig refuses, with the walk out
50+ blocks of rock. Protecting the column costs the bots the rock under a 109 x 105 patch and removes that dead end.

That clears the town plan: ring@1's plots stop at Chebyshev 44 (outer plots d 22-44), so the zone leaves a 4-block gap on
the east. **One conflict to flag:** the monument apron (52 x 52 at d >= 25, "by sector") would overlap the zone if the
monument takes the EAST sector. monument-01 must either take another sector or compose zones into its site search
(section 6).

## 2. Every other generated structure within 1,000 blocks of home (Chebyshev, box centre)

Full list: `docs/reports/protectzone-01-structures-2026-10-20.json`.

| kind | n | nearest (distance, box) | recommendation |
|---|---|---|---|
| **village_taiga** (2nd) | 1 | 378: x 309..446, z -396..-264 (14 houses) | **protect** (default villages: yes) -- in the file |
| **village_snowy** | 5 | 787 (x -847..-727, z 698..857), 821, 862 (x -58..86, z 790..934), 926, 934 | **protect** (default) -- in the file |
| **trial_chambers** | 9 | **114: x -16..84, y -43..27, z 69..160 -- under the town's south-east** | **ASK.** Bots mining below y 27 there will cut into it (copper, tuff, vaults, pots, trial spawners -- inert in peaceful) |
| **mineshaft** | ~60 | **36: x -71..93, y -6..29, z -34..106 -- directly under home** | **ASK.** Rails, planks, cobwebs; bots will strip it (probably fine: it is how mines are found) |
| ruined_portal | 5 within 1,000 | 244: x 240..248, y 75..86, z 0..8 | ask (small; obsidian / gold blocks) |
| trail_ruins | 3 | 400: x 6..29, z -426..-375 (buried) | ask |
| igloo | 4 | 283: x -274..-267, y 90..94, z -286..-280 | ask (tiny) |
| shipwreck / ocean ruins / monuments / buried treasure / ocean portals | many | 326+ | no (underwater) |

The data file protects the **seven villages** (the default) and nothing else. Any "ask" row is one more zone object in the
same file -- no code.

## 3. Why code, and not data only

The cheapest correct mechanism would have been a list the fleet build already obeys. There is none:

| candidate | what it reads | why it cannot protect the village |
|---|---|---|
| townzone-01 (kept) | a fixed Chebyshev 16 square around HOME, terrain only | not data; a village 49-157 east is outside it |
| structureguard-01 (`structureguard-on-835ef3f`, NOT kept) | only the monument's own record (`monument-<home>.gN.json`) | not kept; not a box list; target digs only |
| the town plan's siting file (`townplan-<home>.gN.json`, plots) | designed, NOT built (townindex -> ... -> townplan) | not in any kept build |
| treefarm / well records, wellBreakCost, blocksCantBreak | their own cells, or block TYPES (chest, composter, trapdoors) | a type list would protect every chest everywhere |

So `protectzone-01` adds **one per-world file and one guard**. With no file the guard is a pass-through: the bench
(no file) runs exactly as today (tests `GUARD: with no zone loaded...`, `ENUMERATION: ... UNTOUCHED`, `PATH: ... costs
exactly what it costs with no zone`).

## 4. The design

**The file** `<poolStateDir(MEMORY_POOL)>/protected-zones.json` -- on the showcase `/var/lib/mcai/_pool-showcase/` (the
town's own directory; no env change). Version 1; `hashed_seed` binds it to one world (mineflayer's `worldIdFromLogin`
"hi:lo" of sha256(seed)[0..8]; the algorithm reproduces a sandbox bot's logged id `-1909043226:-504800724` for seed
1239381899, and on Paper the real bot logged `zones=1 why=ok ... world=-1909043226:-504800724`). Overworld only.
**Read at spawn and every 30 s on a timer** (never in the A* step); an edit or install needs no restart; **removing the
file is the rollback** (zones off at the next read); a broken or wrong-version file KEEPS the last good list
(`why=stale:...`); every change logs `_protectzone_mode`. A malformed zone is dropped and named; a box wider than 1,024 is
refused as a typo.

**Four layers, one decision** (`zoneDecision`: inside a zone every op is refused; a `survival` purpose may still dig,
place and use -- never open, sleep or craft):

| layer | where | what |
|---|---|---|
| chokepoint | `attachProtectZone` (index.mjs, after the `_dig_town` wrapper) | `bot.dig`; `bot._genericPlace` (placeBlock, _placeBlockWithOptions, placeEntity) judged on the REFERENCE (mineflayer right-clicks it), the destination and the cell above; `bot.activateBlock`; `bot.openBlock` (openContainer/openChest/openFurnace); `bot.sleep`; `bot.craft` with a table. A refusal is a REJECTED, HANDLED promise naming the zone and a walk out at a standable height; an approved open/craft/sleep's own inner activation of the same cell passes |
| enumeration | the same attach: `bot.findBlocks` (findBlock calls it) | never answers a zone cell: gather's candidates, the table / furnace / chest / bed finders, the prompt's and the survey's resource lists; mineflayer's own defaults (`point ||`, `maxDistance || 16`); a search whose sphere meets no zone is handed through untouched |
| pathfinder | `exclusionAreasBreak` and `exclusionAreasPlace` on the shared arrays, before every clone (gather, descend, water, ascend, tunnel, town walk, collectblock's gatherMoves) | 100 in a zone: `safeToBreak` refuses, a scaffold move is dropped. **Walking is untouched** |
| skills | mine (`zoneKeepOut` in minewell's one keep-out; far starts beyond the zone's sides; a per-dig stop; a refusal naming an exit on a side no walk failed on); place (`placeSites` skips zone cells; its refusal names the walk); bucket (no fill / pour within 6 of a zone: the server's ray decides) | |

**Survival keeps priority** (as townzone-01): `digPurpose` (digtown.mjs) is `survival` when a reflex holds the body or the
reflex tick runs the dig (`eat` is not survival). The drowning, entombment and pillar reflexes are never refused; the
scenery absorbs that damage.

## 5. The refusal chain -- every refusal names a move the bot can make from where it is

| # | situation | guard | what the bot does instead | proven by |
|---|---|---|---|---|
| R1 | gather; the nearest dirt/logs are village | enumeration | the search reaches past them | test `CHAIN gather ... reaches past them`; Paper `gather` |
| R2 | gather; only village blocks near | enumeration | gather's own "none found" refusal -- nothing dug | test `CHAIN gather: only zone dirt` (+ positive control) |
| R3 | mine from inside the village (30 from every side) | keep-out + far starts | walks 3 past the nearest side, plans again, descends there | test `CHAIN mine: standing in the MIDDLE`; Paper `mine` |
| R4 | mine; the walk-offs on one side fail (a ravine) | keep-out | `protected_zone` refusal naming `goto X Y Z` on a side no walk failed on, at a standable height; that goto and the next mine succeed **in the same world** | test `CHAIN mine (ONE world)` |
| R5 | a stair started outside runs toward the village | keep-out | another bearing (no refusal) | test `a bearing from just OUTSIDE` |
| R6 | a zone file lands while a stair runs | per-dig stop | `reason=protected_zone_step ... mine again` | test `CHAIN mine (R6)` + mutant |
| R7 | craft; the only table near is the village's | enumeration + place | its own table outside; standing inside the village, `protected_zone` naming the walk out (no placement tried in the zone) | Paper `craft` |
| R8 | withdraw/deposit; a village chest is the nearest container | enumeration + chokepoint | uses town chests; never opens the village's | Paper `chest` |
| R9 | sleep; a village bed is nearest | enumeration + chokepoint | "sleep at home" | test `GUARD` |
| R10 | a path whose cheapest route digs a house wall or towers in the village | pathfinder | walks round on the surface | test `PATH` (real Movements) |
| R11 | entombed / drowning inside the village | survival exemption | the reflex digs / places for air | test `GUARD: SURVIVAL keeps priority` |
| R12 | a bot inside a house | — | cannot arise from pathing (canDig off on the walk profile, doors solid to the pathfinder, zone digs/places vetoed); if put there, the entombment / stranded reflexes are survival | R11 |
| R13 | under the village | — | cannot arise: the zone is the whole column, so no stair or tunnel enters it (Claude r1 P1) | test `DATA` |
| R14 | bucket within 6 of the village | bucket | `protected_zone`: step 7+ away | test `BUCKET (Codex r1 P1)` |

## 6. Follow-ups (not in this change)

- **monument-01** must not site its apron over a zone (compose `zoneKeepOut` into its site search) -- or take a non-east sector.
- **trial chambers under the town** and **the mineshaft under home**: owner to decide (one zone object each).
- Villager trading (owner: "may come later"): entities are not guarded; a trade skill needs only an entity check.

## 7. Evidence

**Unit / behaviour tests** -- `bots/test/protectzone.test.mjs`, 37 tests: the file (parse, world binding, malformed zones,
the reader's stale / rollback rules and that `zones()` never touches the disk), the one decision, the guard on a
mineflayer-shaped fake (rejected + handled promises, placement's three cells, survival, pass-through with no file, the inner
use of an approved call), `findBlocks` through mineflayer 4.37.1's REAL blocks plugin over a real prismarine world, REAL
pathfinder `Movements` (no break, no tower in a zone; walking costs exactly what it costs without one), the REAL gather and
mine skills through the refusal chain (R1-R6, with layer tests and positive controls), bucket, the showcase data, wiring
with anchored mutants. `npm test` (scripts/run-tests.mjs): see the commit record. eslint `no-undef`: only the pre-existing
`reflex.mjs:2384 withinBody`.

**Paper (sandbox, 10.0.0.30:25599, 10-20 15:5x-16:3xZ, lock `protectzone`)** -- `sandbox/protectzone/protectzone-e2e.mjs`:
the REAL bot (this branch's `src/index.mjs`) with a zone file of the showcase's shape (version 1, the sandbox world's own
`hashed_seed`) over a 31 x 26 x 31 "village" (a spruce house with a chest of 16 oak logs, a crafting table and a bed, a
dirt path, a lamp). Verdicts are the SERVER's: `execute if blocks <zone> <pristine clone> all` (24,986 cells) and the
chest's NBT. Every scene ran twice -- without the file (the positive control must break the zone or use the village) and
with it. The bot's licence row read `zones=1 why=ok ids=village-sbx world=-1909043226:-504800724` (the binding live).

PAPER_TABLE


## 8. Review record

### Round 1 (on 192f6b2e): Codex CHANGE, Claude CHANGE

| # | finding | disposition |
|---|---|---|
| Codex P1 | a placement right-clicks its REFERENCE: a village chest/door could be activated from outside | `_genericPlace` judged on reference, destination, destination+up; test `PLACE (Codex r1 P1)` |
| Codex P1 | the bucket's server ray can hit zone water/blocks before the aimed cell | no fill/pour within 6 of a zone; test `BUCKET (Codex r1 P1)` |
| Codex P1 | mine's refusal named a geometric exit not checked against the failed walks; the test swapped worlds | the exit is on a side no walk failed on, at a standable height; test runs goto + mine in the SAME obstructed world |
| Codex P2 | a reload during craft admission -> mineflayer's unawaited activateBlock -> unhandledRejection | refusals are handled promises; an approved open/craft/sleep's own activation passes; test `INNER USE` |
| Codex P2 | findBlocks defaults differ (`?? 16` vs `|| 16`) | mineflayer's own `point ||` / `maxDistance || 16`; test |
| Codex P2 | the committed arena sat outside WORLD_BORDER_RADIUS | moved to 2000,-2400; all scenes rerun |
| Claude P1 | a dead end UNDER the footprint (tunnel in, can only come up through the village) | every zone is a whole column (y0 -64), written so by the generator; test `DATA` |
| Claude P2 | the remedy's y was the bot's own (solid on a hill / in a cave) | `standableY` at the exit column, else named by column; EXIT_PAD 3 -> 4 after Paper showed goto's range-2 arrival on the edge cell |
| Claude P2 | a broken file switched protection off | the last good list stays (`stale:`); only ENOENT turns zones off; every change logs `_protectzone_mode` |
| Claude P2 | `statSync` inside the A* step | `zones()` never touches disk; a 30 s timer refreshes |
| Claude P3 | wrong zone named (7 villages); walk-off label; `eat` counted as survival; every dimension; snowy boxes; tests (real findBlocks, R6, profiles) | the stair's hit cell names the zone; label; `eat` excluded; overworld only; hits only inside piece boxes; real-findBlocks test; R6 test + mutant. The per-profile behaviour test is covered by the wiring test (one shared array before every clone) -- not added |
| (Paper) | craft standing in the zone tried six placements, each refused | `placeSites` skips zone cells; the refusal leads with the goto (craft prefixes its own words and rows cap at 300) |

ROUND2_PLACEHOLDER

