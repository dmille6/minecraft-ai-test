READ-ONLY design task. You are ChatGPT via `codex exec`; a Claude design runs separately and the two are reconciled after.
Repository: the current directory (a checkout of the minecraft-ai project at the LIVE SHOWCASE RELEASE 8b4ea9cc). Do not edit anything.

## The ask (owner, 2026-11-05)
The owner asked whether an Indian-style STEPWELL is worth it, and said "Yes" to: a showcase landmark that is the miners' SAFE SHARED
DESCENT, in two phases -- (1) surface to the iron layer (~y 16): a terraced stepwell with railings, landings, lighting and a water pool;
(2) down to the lava layer with a SEALED lava/obsidian station (water-cast cells, bucket fill, no open lava on any walkway), after
bucketfix-01 (bucket pour/scoop fix, a fleet canary not yet run) and the obsidian design (docs/reports/obsidian-design-2026-11-04.md).
Design it independently: shape, dimensions, siting, safety, build order, how deep miners use it, pieces/tiers, and the first shippable piece.

## Facts (measured 2026-11-05)
World (showcase, peaceful, Paper 1.21, mineflayer 4.37 bots, 15 bots, one town, home 0,70,0):
- Lava 16,375 cells, ALL at y -64..-55; natural obsidian 78 blocks all at y -55; no lava above y 56 within +-112 of home.
- Iron ore peak y 13-22 (the town stair's y=16 landing is on it); deepslate diamond -52..-59.
- Town layout: wall ring x -46..35, z -20..39 (inside x -39..28, z -13..32). Town stair (shaft-02, bots/src/shaftgeom.mjs: 3x3 spiral round
  a pillar, 1-wide, landings 48/32/16) complete at pillar 25,-26 (box x 23..27, z -31..-24), north-east, outside the wall.
  Land plan sectors (project-0_70_0.land): NW monument, NE industry (the stair), S farms, SE/SW homes, W treefarm, E and N wild; ring
  road radius 26; workR 80. Protected zones: taiga village box x 49..157, z -59..45 (floor_y 54; digging under/inside it is a tripwire
  zone); trial chambers x -20..88, z 65..164 (to bedrock). Other records' boxes: storehub x 10..28 z -59..-49; canefarm x 4..16
  z -91..-86; towers T3 x 36..52 z -20..-4; road R1 x -2..2 z -87..-80; monument (ziggurat, complete) x -55..-26 z -43..-14.
- Stone: bags hold ~6,000 cobblestone on the showcase (28,961 cobble gained per 24 h); town stone_bricks 362 with ~291 owed to other
  bills; stone bricks made at ~130/day. Building is ~2-3% of bot time; measured build rates while a visit runs: tower sink 5 placed + 5
  cleared per visit-minute, the town stair's visits 3.6 digs/min.
- Deep miners TODAY (deepminer-01, bots/src/deepmine.mjs, skills.mjs deep*): descend the town stair to y16, then "deepen" with `mine`
  (a personal stair cut step by step) to feet y -53, branch-mine, return by their trail and the stair.
  Fleet 3 days (80 bots, 6.03M rows): 618 trips; ends home 511, STRANDED on return 81 (13%), collar 23; deepen rows 855: only 91
  "reached_y", 705 (82%) "cut a step but could not stand in it"; 2 deaths during trips (lava swim at y -29 in work, drowned at 51 on
  return) of 55 fleet deaths (27 below y 16); _entombed rows during trips 1,879 (work 1,418, return 434), _marooned 290.
  Showcase 3 days (15 bots, 716k rows): 77 trips, stranded 14 (18%); deepen 67 rows, 5 reached (7%), 58 could-not-stand; 0 deaths.
- Known failure classes: the stair trap (shafttrap-01/02: the entombed/marooned reflexes misfire on bodies in transit inside a spiral,
  pillar dirt into the stair's air cells; fixed by deterministic egress, docs/reports/shafttrap-design-2026-11-03.md); drowning in
  air pockets under wet roofs (apseal); lava steps (lavastep/lavasight/lavatarget, keepout).

Constraints:
- NO admin edits (no /fill /setblock /give, teleport, WorldEdit). Bots dig and place everything, server-acknowledged.
- Movement: mineflayer-pathfinder; steps up 1 by jumping, drops up to ~3 safely; walls/fences are 1.5 high (not jumpable).
- Stairs/slabs need orientation; the orientation helper (townstyle-01, look packet before block_place) is proven on Paper but not yet
  released: full blocks are the safe default for treads.
- Water: pours need bucketfix-01 on the showcase first. Owner: swimming is travel; water is terrain.
- The showcase tripwire (infra/showcase/showcase_trip.py S6 + docs/reports/shop-01-2026-10-25/shopread.py.txt) judges every
  `_build op=place` against the project record's `cells` and every `_build op=clear` against its `clear` list (H1 off_record, H2
  clear_outside: a TRIP that stops the showcase), G3 zone, G4 lease overlap. A new dig/place pattern needs a written rule there.
- Protected code (config/protected-paths.txt: mining depth, deepmine.mjs, skills.mjs deep*/stair*/mine, escapes, reflexes, bucket.mjs)
  is tier 3: two review engines + a fleet canary; it reaches the showcase only via a fleet KEEP. A new building project in its own
  files (like shaftvisit.mjs, sinks.mjs, terrace.mjs, buildrun.mjs runVisit) is tier 2.
- Existing machinery to reuse: buildproj.mjs records/slots/leases, buildrun.mjs runVisit (generic visits), shaftgeom.mjs/shaftvisit.mjs
  (excavation visit, line-before-dig, liquid stop truncates the record), sinks.mjs (growing records, seeded variety), terrace.mjs
  (cut/fill grading), towndress.mjs (lights), landplan.mjs (zones, corridors), paths.mjs (paths to a destination).

## What to produce (plain text, at most ~250 lines)
1. Is it worth it, and for what (landmark vs descent value), given the numbers above?
2. Shape and dimensions (top size, tiers, tier depth, step/landing widths, railings, lights, pool), and how the descent reaches y16 (and
   later -55). Give the geometry precisely enough to code (a cell rule).
3. Siting rule (where on this map; inside or outside the wall; next to the town stair or not) and what to measure on a region copy.
4. Safety: dig order that never opens a cave/water/lava pocket under a walking bot; the cave-breach protocol; railings rule; how to avoid
   the stair-trap reflex misfires; what must be proven on a Paper sandbox.
5. How deep miners use it (what changes in protected code, and when).
6. Pieces in order with tiers, the FIRST shippable piece's exact scope, its tests, its tripwire rule, and its kill switch.
7. Cost: blocks (cobble/bricks/walls/torches), digs, bot-hours (state assumptions).
Name files/functions you read. Disagree with the owner's framing where the numbers say so.
