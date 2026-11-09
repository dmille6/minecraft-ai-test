# zoneguard-01show: no bot changes a cell the tripwire's S4 compares (2026-11-09)

Tier 3 (protected scope: protectzone.mjs, escapeguard.mjs, zonewalk.mjs, index.mjs, skills.mjs bucket/cast). The branch is
`zoneguard-01show`, built on dd79b56a (the showcase's code after the rollback). It is ready to stage and **not released**.

## 1. The incident

| when (Z) | what (showcase-Haven, village-taiga-6_1, box [49,-64,-59,157,90,45], floor_y 54) |
|---|---|
| 01:38 | Inside the zone's column at y 37: `_zone_climb_refused`, then `_zone_walk handler=entombed` (19 digs, ordinary rock) |
| 01:41-01:42 | The `mine` skill (chosen by the model, y 30, then 20, then 16) cut a stair down: y 31, 28, 26, 19 |
| 01:42:52 | `_mine_stair_step_failed dug the tread at (57,18,5)`. That cell is **oak_planks, a baseline cell** (a natural mineshaft under the village) |
| 01:42:54 | `_place_town_sum out.pathfinder.pillar.placed 1`: the bot held cobblestone and placed it into 57,18,5 |
| 02:36 | Tripwire S4 BREACH `57,18,5 oak_planks->cobblestone`. All 14 bots stopped and the code rolled back 2698a667 -> dd79b56a |

## 2. Why the guards let both actions through

| path | rule before the fix | y range it guarded for a bot whose feet are below floor_y |
|---|---|---|
| tripwire S4 (`integrity`) | every baseline palette cell in the box | **y -64..90** (the whole box) |
| chokepoint `bot.dig` / `_genericPlace` (protectzone `gate` -> `blocked`) | the deep exemption opens cells below floor_y | 54..90 only; **-64..53 open** |
| same, survival purpose (a reflex) | `zoneDecision` passes every survival dig, place and use | **nothing** |
| pathfinder price (`zoneCost`: canDig, scaffolding, 1x1 tower) | `blocked` / `placeBlocked` with the bot's feet | 54..90 only |
| mine keep-out (`zoneKeepOut`), findBlocks | `blocked` with the bot's feet | 54..90 only |
| escapeguard (survival digs only) | structure by NAME; below floor_y cobblestone is DEEP_NATURAL and open | the names only, at every depth |
| `pillar_out` (reflex) | the chokepoint, survival purpose | nothing |

Both sides read the same zones file, so the **boxes agree**. The **volumes disagree**: the bots open y -64..53 to a deep bot,
and open everything to a survival purpose. The incident was a non-survival `mine` dig plus a non-survival pathfinder tower,
and both went through the deep exemption.

**escdead-01 r1** (fleet only; the showcase does not have it) widens the deep exemption to cells under natural terrain above
floor_y (`terrainDeep`). It would not have stopped this incident: 57,18,5 is below floor_y in both versions. Its r1 rule ("a
buried village block is never deep") applies above floor_y only.

## 3. The fix

| piece | what it does |
|---|---|
| the baseline | The bots read the tripwire's own file: `PROTECT_ZONES_BASELINE`, else `<pooldir>/zones-baseline.json`, else `/srv/showcase/trip/zones-baseline.json`. It is joined to the zones file by id, and the boxes must overlap (another world's file is never joined). It is re-read on an mtime change; a torn file keeps the last good copy |
| guarded cells (`structGuardOf`) | S_CELL = every baseline cell. S_SUPPORT = the 6 neighbours of a block that hangs, stands or falls (torch, door, carpet, anvil...), for digs. S_COVER = the cell over a dirt_path, for placements |
| `structAt`, checked first | No dig of S_CELL or S_SUPPORT. No placement into S_CELL or S_COVER, and none whose above cell is S_CELL. Every depth, every purpose, survival included. A placement's reference keeps the old rule, so a pillar standing on a mineshaft plank still works |
| `blocked()` (every planner) | Closes any guarded cell before the deep exemption: the pathfinder, mine's keep-out, findBlocks, poolescape and the zone checks in skills |
| escapeguard `guardOf` | A guarded cell is the zone's (`struct`). `escapeDigDecision` refuses it even for air and as a last resort |
| zonewalk | A guarded cell ends the bearing and the next bearing is tried (Codex r1: an anvil support used to throw and end the walk) |
| liquids (Codex r1-r3, Claude r3) | A pour is not a placement (`activateItem`). `liquidFlowReaches` traces the flow: it falls first, each drop renews a 7-cell run, it goes both ways over signs and doors, and lava also hits what it passes beside. An unread cell, or a trace over 4,000 cells, is refused. Used at the chokepoint (`activateItem`), by the bucket skill's pour, and by the obsidian cast's filter (one shared 20,000-cell budget per filter, cached; a scoop is not traced) |
| no baseline (the fleet) | `deepNameBlocked`: a non-survival dig below floor_y of a structure block by name is refused (escapeguard's survival rule, now for every dig) |
| switch, rows | `ZONEGUARD=off` reads no baseline and runs no name rule. `_protectzone_mode ... baseline=ok guarded=N cells=M`, `protect_zone_refused ... struct=1`, and `_protect_zone` counts struct_refused and liquid_refused |

**The remedy stays executable.** The rock around a structure stays open to a deep bot. The walk-out (zonewalk) already tunnels
only through ordinary rock and ends a bearing at a guarded cell, so an entombed bot leaves by a non-zone route. The tests cover
the refusal chain: the ceiling plank and the deep cobblestone are refused, then the walk-out goes south and is out, with no
baseline cell dug. The Paper runs below show it.

**Owner to accept:**
- A drowning or suffocating bot no longer digs a baseline cell for air. It used to: "the scenery absorbs that damage".
- No pour is allowed whose traced flow could reach a guarded cell.

**Not covered (pre-existing):** buildbot's raw `block_place` packets (they place only at record cells), and a survival `use`
with a tool, such as an axe stripping a log.

## 4. Tests and reviews

| | |
|---|---|
| tests | `bots/test/zoneguard.test.mjs`, 22 tests: the incident's dig and tower refused, the real mineflayer-pathfinder 2.4.5 Movements, the reader, the name rule, the composed chain (entombed -> refused -> walk-out out), liquids. 8 anchored mutants. `protectzone.test.mjs` 47/47 (two expectations follow the change: deep planks by name, the filter anchor). zonewalk and escapeguard green |
| Codex | r1: 2 blockers (anvil support aborts the walk-out; bucket flow). r2: 1 (a fixed radius does not bound downhill flow). r3: 1 (a sign under the flow). r4: none |
| Claude (independent subagent) | r1: none. r2: none. r3: 1 (the cast filter traced each candidate, so a lake stalled the event loop). r4: none |

## 5. Paper (sandbox6, failmine scene driver; FM_ZONES = the real 6_1 box, translated; FM_KEEP probes every baseline cell by name before cleanup)

| scene | build | outcome | baseline cells changed |
|---|---|---|---|
| **A. Haven's mine**: deep pocket 57,26,5 over a mineshaft (an oak_planks floor at y 18 and roof at y 21, over x 52..62, z 0..10); scripted `mine 16` | base dd79b56a | the stair cut through it | **3 of 250**: 57,21,4, 57,18,5 (THE INCIDENT's cell), 57,18,6 |
| A | cand 1c7c7370 | the stair turned its bearing (`_mine_bearing_turned`), went around the planks, reached y 17 | **0 of 250** |
| **B. entombed** in a 1x2 pocket at 57,19,5: plank floor and ceiling, cobblestone/mossy to the west, plank + fence to the east | cand 271d2834 | escaped in about 2 min: the walk-out goes south out of the footprint, hp 20 | **0 of 11** |
| B | cand 1c7c7370 | escaped, moved 41, out at 57,20,46, hp 20 | **0 of 11** |
| B (control) | base dd79b56a | escaped the same way (escdead's walk-out already avoids structure names) | 0 of 11 |

Scene A is the incident's control: the base changes the cell the tripwire tripped on, and the candidate does not. Scene B
shows the remedy is still executable from inside the zone (the base passes it too: the deep survival case was already
covered by name, so B guards against a regression rather than showing a difference). Final sha 03e1fddad differs from
1c7c7370 only in the liquid budget check (outside both scenes).

Suite: ci2 `zoneguard-01show-558522714`, **478/479**. The one failure is `nothing-important-is-orphaned` (`bagdiet.test.mjs`,
absent from dd79b56a itself: a base failure). The later commits (r4 cast budget, r4b) were run as the zone set on ci2:
zoneguard 22/22, protectzone 47/47, zonewalk, escapeguard.

## 6. The fleet

The fleet needs the same rule: the deep exemption is there too (wider with escdead-01's terrainDeep), and there is no
tripwire to notice. It is **not a cherry-pick**: the fleet has no zonewalk.mjs and no escdead-01show guardOf, and its
`blocked()` takes escdead's `deep` argument. With no baseline on the fleet, the part that applies is the name rule plus the
liquid trace (inert without a baseline). It is a separate tier-3 piece and is not built here.
