# Brief: the town's common mineshaft -- independent design (Codex), 2026-10-30

OWNER 10-30: "A common mineshaft seems like a good idea let's find the best approach and add it to the queue use both
Claude and codex for the best solution." You are one of the two engines. Design INDEPENDENTLY first (Claude is doing the
same in parallel; we then converge). Process is FUN MODE (docs/PROCESS-fun-mode.md): visible progress, blockers-only reviews,
generic canary read (tripper, death gate with a two-death floor, crash loops, the change's own defect lines). Owner
constraints (CLAUDE.md): bots must survive/move/gather/build in any world; bots changing the world is wanted; NO admin edits
(no tp, /give, /setblock, /fill); swimming is travel, water is terrain; pathfinder must not bridge water; peaceful worlds.

## Repo / code to read (this worktree is the fleet's next lineage: zigfleet-on-d1453ed2)
- Fleet trunk building stack: bots/src/buildproj.mjs (records, slot leases), shop.mjs (PROJECTS, activeProject, buildOrder),
  ziggurat.mjs / wall.mjs / paths.mjs (projects with own visits), skills.mjs buildShop (~17090) and shopKeepOut (~17015:
  every project's record cells are mine's keep-out), index.mjs ~596-680 (profiles: walk profile canDig=false; project
  footprint is a BREAK/PLACE price on walk/gather profiles, escape profiles keep survival digs), townplan.mjs OUTER.shaft
  (the town plan already reserves a `shaft` outer plot sector, d=19 r=26).
- mine skill: skills.mjs mine() ~14231 (staircase descent, 12-block home refusal, composed keep-out minewell.mjs
  composeKeepOut). surface skill ~18992. oretunnel.mjs. exit-contract.mjs.
- The OLD build: branch origin/shaft-on-1f066b0 (sha 41dc9d66; queue entry shaft-01 variant fbc3621 = its dev base). Files
  bots/src/shaftplan.mjs, shaftindex.mjs, shaftjob.mjs, shaftbot.mjs, shaftguard.mjs (+ hunks in skills/index/reflex/cognitive).
  It is on a DEAD lineage (needs structures.mjs/monumentjob.mjs/structureguard which the fleet no longer has; the trunk
  replaced them with buildproj/shop projects). Design: docs/reports/ziggurat-mineshaft-2026-10-15.md section 4 (two 1x1
  LADDER columns side by side, lined, landings every 8 levels with room+stub, down to y=16, a cobble CAP between visits,
  T1-T11 trap table, a bot.dig chokepoint, reflex hold, BUILD ONLY; shaftuse-01 routing later).
- docs/reports/mineshaft-safety-2026-10-23.md (r10 APPROVED, owner answered): F6 deepstair-01 (two-lane 3-high spiral stair,
  certified, deep miners only, y=-53, later), M9, O1-O13. Shipped since: lavastep-01, lavasight-01, cavefall-01,
  ceilescape-01, plugcut-01, respawnfall-01.

## Measured today (24 h to 2026-10-30 ~18:30Z, 80 bots, full walk of /var/log/mcai skill files, 1.81M rows)
- Skill bot-hours by bot y band: >=64: 212; 48-63: 140; 32-47: 82; 16-31: 47; 0-15: 23; -32..-1: 18; <-32: 4.
- mine: 7,895 calls (12.1 bot-h), 6,098 success / 851 failed / 942 unknown; target-y band 48s 2,380, 32s 2,196, 16s 1,456,
  0s 479, >=64 735, <0 649. Cobble+deepslate collected during mine: 19,408/day.
- gather iron_ore attempts by bot band (success): >=64 216 (16, 7%); 48s 609 (93, 15%); 32s 664 (131, 20%); 16s 418 (121,
  29%); 0s 122 (48, 39%); <0 62 (17).
- raw iron gained (inventory deltas) 518/day: 16s 152, 32s 145, 48s 90, 0s 71, <0 40, >=64 20. Per skill-bot-hour in the
  band: 16s 3.2/h, 32s 1.8/h, 48s 0.64/h, >=64 0.09/h.
- deaths 32/day by death y band: 48-63: 9 (6 drowned); 32-47: 4; 16-31: 3; 0-15: 5; <0: 11. Per skill-bot-h: 16s 0.06,
  48s 0.06, 0s 0.22, <0 0.48.
- 1.21 generation: iron triangle -24..56 peaking at y=16 (+ mountains); diamonds peak ~-59; deepslate below 0 (slower digs);
  lava aquifers mostly below ~-54 but lava pools anywhere.

## Fleet / queue facts
- One canary slot, 2 pools (10 bots) per draw. Next: zigfleet-01 (merges the building stack -- house, ziggurat v2, paths,
  wall code -- into the fleet; ziggurat ON in every pool). The new shaft entry goes right after it, variants pre-built on
  zigfleet-on-d1453ed2 (d24f6e36) and zigfleet-on-4d43a9ca (69116052).
- Tier: anything touching mine/escape/reflex/pathfinding/index.mjs/cognitive.mjs is protected = tier 3 (two engines + canary).

## Questions (answer each, with a recommendation and why)
1. Geometry: two ladder columns (shaft-01), one ladder column, a 2x2 spiral staircase (1 step down per cell, 3 headroom,
   fully lined 4x4 ring), a 3x3-around-pillar spiral, a straight stair, or something else? Consider pathfinder behaviour
   (mineflayer-pathfinder 2.4.5 moves: forward/diagonal/jump-up/drop-down, ladders getMoveUp), falls, traffic, build cost,
   cobble, materials chain (ladders need sticks), reflex interactions (entombed predicate, escape rungs), self-rescue.
2. Depth target and landings (where bots get off), given the measurements.
3. Siting relative to the town plan's shaft sector / wall / ziggurat / home refusal (12) / town ground (16).
4. Water/lava/cave/falling-block handling during build and in use; lighting.
5. How miners USE it: deterministic routing in mine (and surface?), prompt line, or rely on the walk-profile pathfinder.
   Is BUILD ONLY worth a canary, or build+use together, or build then use? (Fun mode: "KEEP, goal unverified" when not exposed.)
6. Protection of shaft cells from target/transit/survival digs, and the refusal chain (a new refusal must name a remedy the
   bot can perform from where it is).
7. Integration: a PROJECTS entry in the trunk's project framework (record cells -> keep-out/footprint for free) vs own
   records like shaft-01; what of shaft-01's code survives.
8. The metric it should move, and exposure in a 2-pool canary within the +90/+180 reads.
9. Biggest risks / blockers you foresee.
Keep it concrete and short (<= 120 lines). Do NOT edit files.
