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

**Block evidence** (the same files; village-made blocks only: beds, bell, workstations, dirt_path, spruce
planks/doors/trapdoors/stairs, glass panes, torches, cobblestone, chests): 1,638 blocks, x **57**..149, y 62..81,
z -51..30 — dirt_path 818, cobblestone 500, spruce_planks 100, spruce_trapdoor 87, glass_pane 28, wall_torch 19,
spruce_door 18, torch 13, spruce_stairs 10, beds 10 (5 beds), chests 5. The westmost street piece (straight_02,
x 44..59, z 2..17) left no block west of x 57: its ground is grass and no path was laid. **Usable things inside**: 5
chests (124,64,-13; 123,74,-1; 86,76,12; 111,76,12; 101,77,26), 5 beds, 1 crafting table (64,70,-11), 2 grindstones, a
fletching table, 2 water cauldrons, the bell, 1 campfire. The "hay/pumpkin feature" is 27 pumpkins (taiga decorations and
natural patches); there is no hay in this village.

**The protected footprint** = the extent of those blocks together with every house and town-centre piece, padded 8
horizontally, from 8 below the lowest village block to 8 above the highest roof:

> **`village-taiga-6_1`: box x 49..157, y 54..90, z -59..45** (109 x 37 x 105). West edge 49 blocks east of home.

That clears the town plan: ring@1's plots stop at Chebyshev 44 (outer plots d 22-44), so the zone leaves a 4-block gap on
the east. **One conflict to flag:** the monument apron (52 x 52 at d >= 25, "by sector") would overlap the zone if the
monument takes the EAST sector. monument-01 must either take another sector or compose zones into its site search
(section 6, follow-ups).

## 2. Every other generated structure within 1,000 blocks of home (Chebyshev, box centre)

| kind | n | nearest (distance, box) | recommendation |
|---|---|---|---|
| **village_taiga** (2nd) | 1 | 378: x 309..446, z -396..-264 (14 houses) | **protect** (default villages: yes) |
| **village_snowy** | 5 | 787 (x -847..-727, z 698..857), 821, 862 (x -58..86, z 790..934), 926, 934 | **protect** (default) |
| **trial_chambers** | 9 within 1,000 | **114: x -16..84, y -43..27, z 69..160 — under the town's south-east** | **ASK.** Bots mining below y 27 south-east of home will cut into it (copper, tuff, vaults, pots, trial spawners -- inert in peaceful) |
| **mineshaft** | ~60 | **36: x -71..93, y -6..29, z -34..106 — directly under home** | **ASK.** Rails, planks, cobwebs; bots will strip it. Probably let them (it is how mines are found) |
| ruined_portal | 5 within 1,000 | 244: x 240..248, y 75..86, z 0..8 | ask (small; obsidian/gold blocks) |
| trail_ruins | 3 | 400: x 6..29, z -426..-375 (buried) | ask |
| shipwreck / beached | 8 | 463 | no (underwater) |
| igloo | 4 | 283: x -274..-267, y 90..94, z -286..-280 | ask (tiny) |
| ocean_ruin_cold / monument / buried_treasure / ruined_portal_ocean | many | 326+ | no |

The data file below protects the **seven villages** (the default) and nothing else. Adding any of the "ask" rows is one
more zone object in the same file -- no code.

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
town's own directory; no env change). Version 1, `hashed_seed` binds it to one world (mineflayer's `worldIdFromLogin`
"hi:lo" of sha256(seed)[0..8]; the algorithm was checked against a sandbox bot's logged id `-1909043226:-504800724` for
seed 1239381899). Re-read at most every 30 s (an install or an edit needs no restart; removing the file is the rollback).
A malformed zone is dropped and named in the licence row; a box over 1,024 on any axis is refused as a typo.

**Four layers, one decision** (`zoneDecision`: inside a zone every op is refused; a `survival` purpose may still dig,
place and use -- never open, sleep or craft):

| layer | where | what |
|---|---|---|
| chokepoint | `attachProtectZone` (index.mjs, after the `_dig_town` wrapper) | `bot.dig`, `bot._genericPlace` (placeBlock, _placeBlockWithOptions, placeEntity all call it), `bot.activateBlock`, `bot.openBlock` (openContainer/openChest/openFurnace), `bot.sleep`, `bot.craft` with a table. A refusal is a REJECTED PROMISE (the pathfinder chains `.then/.catch`; a sync throw would escape it) naming the zone and a goto outside it |
| enumeration | the same attach: `bot.findBlocks` (findBlock calls it) | never answers a zone cell: gather's candidates, the table / furnace / chest / bed finders, the prompt's and the survey's resource lists. mineflayer calls `matching` first with a position-less palette block (passed through), then per cell (judged); a search whose sphere meets no zone is handed through untouched |
| pathfinder | `exclusionAreasBreak` and `exclusionAreasPlace` on the shared arrays, before every clone (gather, descend, water, ascend, tunnel, town walk, collectblock's gatherMoves) | 100 in a zone: `safeToBreak` refuses (< 100 needed), a scaffold move costs > 100 and is dropped. **Walking is untouched** (no step price): the village's paths stay walkable |
| mine | `zoneKeepOut` composed into minewell's one keep-out; `zoneExitColumns` as far starts; a per-dig stop | no stair through a zone or from one; a bot in the middle of the village walks to just beyond its nearest side and descends there |

Plus the bucket skill: no pour into and no scoop from a zone (its reasons list names the zone).

**Survival keeps priority** (as townzone-01): `digPurpose` (digtown.mjs) is `survival` when a reflex holds the body or the
reflex tick runs the dig. The drowning, entombment and pillar reflexes are never refused; the scenery absorbs that damage.

## 5. The refusal chain -- every refusal names a move the bot can make from where it is

| # | situation | guard | what the bot does instead | proven by |
|---|---|---|---|---|
| R1 | gather; the nearest dirt/logs are village | enumeration | the search reaches past them (32 candidates are all eligible) | test `CHAIN gather ... reaches past them`; Paper `gather` |
| R2 | gather; only village blocks anywhere near | enumeration | gather's own "none found" refusal (explore) -- nothing dug | test `CHAIN gather: only zone dirt` (+ positive control) |
| R3 | mine from inside the village (30 from every side) | keep-out + far starts | walks EXIT_PAD (3) past the nearest side, plans again, descends there | test `CHAIN mine: standing in the MIDDLE`; Paper `mine` |
| R4 | mine; every walk-out obstructed | keep-out | `failClass protected_zone`, detail names `goto X Y Z` outside; that goto + mine succeeds | test `CHAIN mine: EVERY walk-out obstructed` |
| R5 | a stair started outside runs toward the village | keep-out | another bearing (no refusal) | test `a bearing from just OUTSIDE` |
| R6 | the world changed under a stair (a stale plan) | per-dig stop | `reason=protected_zone_step ... mine again` (the next plan walks off) | code path shared with townzone's tested stop |
| R7 | craft; the only table near is the village's | enumeration | crafts / places its own table; standing inside the village the placement is refused with "walk out first (goto ...)" | Paper `craft` |
| R8 | withdraw/deposit; a village chest is the nearest container | enumeration + chokepoint | uses town chests; never opens the village's | Paper `chest` |
| R9 | sleep; a village bed is nearest | enumeration + chokepoint | "sleep at home" | test `GUARD` (sleep) |
| R10 | a path whose cheapest route digs a house wall or towers in the village | pathfinder | walks round on the surface; no dig, no scaffold | test `PATH` (real Movements) |
| R11 | a bot entombed / drowning inside the village | survival exemption | the reflex digs / places for air -- never refused | test `GUARD: SURVIVAL keeps priority` |
| R12 | a bot trapped inside a house | — | cannot arise from pathing: canDig is off on the walk profile, doors are solid to the pathfinder (`canOpenDoors=false`) and digs/places in the zone are vetoed, so no path leads inside; if teleported in, the entombment / livelock reflexes are survival and may dig out | reasoning; R11 |

## 6. Follow-ups (not in this change)

- **monument-01** must not site its apron over a zone (compose `zoneKeepOut` into its site search) -- or take a non-east sector.
- **trial chambers under the town** (x -16..84, y -43..27, z 69..160) and **the mineshaft under home**: owner to decide.
- Villager trading (owner: "may come later"): entities are not guarded; a trade skill would only need an entity check.

## 7. Evidence

See the branch's commits for the test run, the Paper sandbox results and the review record (filled in below as they land).
