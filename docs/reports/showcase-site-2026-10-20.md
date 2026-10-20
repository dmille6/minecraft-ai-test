# Showcase site note — for the town-plan agent (2026-10-20)

The showcase world (VM 207, `10.0.0.40:25565`, Paper 1.21.8 build 60, peaceful) is generated, pregenerated and
**empty**: no town is stamped, no bot has joined. Frame 0 of the timelapse is this empty world. The town plan decides the
layout; this note gives the site and the file the showcase expects. Design: `docs/reports/showcase-2026-10-20.md`.

## The site

| | value |
|---|---|
| seed | **1020202620** |
| home (centre of the plot area) | **x 0, z 0** (world spawn is set here); ground base_y **68** (median of the core's surface) |
| candidate plot area | **x -64..64, z -64..64** (128 x 128), measured on a 17 x 17 grid |
| core (storehouse, workshop, first plots) | x -32..32, z -32..32: **no water**, relief p90-p10 **5** blocks |
| whole plot area | relief p90-p10 **8**, wet **1.4 %**, canopy **24 %** (trees ON the plot area: wood for the first tools, cleared as plots are built), no cave hits |
| wood ring (80-128 blocks out) | 7 of 48 sampled columns are logs/leaves (the bench's place-town bar is 12.5 % = 6 of 48) |
| water (well at the edge, farm water) | water on the ring 96 blocks out, e.g. **x -37, z 89** (north-west of home), 29 water columns on rings 96-256 |
| world border | radius 5000 centred on home |
| pregenerated | radius 1024 around home |
| gamerules | the bench's (place-town `GAMERULES`): keepInventory, no weather cycle, immediate respawn, no fire tick, no mob griefing |

How it was chosen: `infra/showcase/site_search.py` scored 49 candidates (spiral, step 96, rings 0-3) on each of three
seeds (20261020, 1020202620, 7243910; logs in `/srv/showcase/ops/site-*.{json,log}` on the VM) for the plan's 128 x 128
footprint, with the surface read from the sky down (place-town's whole-column binary search converges inside 1.21 caves
a fifth to a third of the time). Two candidates passed with the bench's wood ratio; this one sits **at spawn**, in
forest, with water ~100 blocks away -- the owner's "flat / forest / river near spawn". The other (seed 20261020 at
x -177, z -73) is flatter by one block but nearly treeless (canopy 3.5 %).

## What the showcase needs from the town plan

1. **`/srv/showcase/town-site.json`** on the VM, written by (or from) the plan's per-town siting file. Fields the
   showcase reads today (`infra/showcase/make_env.py`, `showcase_ops.validate_site`):

   ```json
   {
     "version": 1,
     "world": "showcase",
     "seed": 1020202620,
     "home":  [0, 69, 0],            // x, y, z -> HOME_X/Y/Z of every showcase bot (y = standing height)
     "board": [3, 69, 0],            // x, y, z -> BOARD_X/Y/Z (the lectern, if the plan keeps one)
     "border_radius": 5000,          // -> WORLD_BORDER_RADIUS
     "builds_core": false,           // true if the plan's code builds its own core (then no place-town stamp)
     "plots": [                      // the plan's own records; carried for the plan's code, not read by the showcase
       {"id": "core", "kind": "storehouse", "min": [-6, -6], "max": [6, 6], "y": 68},
       {"id": "workshop", "kind": "workshop", "min": [..], "max": [..]},
       {"id": "well", "kind": "well", "at": [x, y, z]},
       {"id": "farm-1", "kind": "farm", "min": [..], "max": [..]},
       {"id": "build-1", "kind": "build", "min": [..], "max": [..]}
     ],
     "paths": [[x1, z1, x2, z2]]
   }
   ```

   Only `home`, `board`, `border_radius` (and `builds_core`) are required by the showcase; the rest belongs to the plan.
   If the plan's file uses other names, give the mapping and the showcase adapts `make_env.py`.
2. **The run ids and shas of its first pieces once the bench keeps them** (per-town siting file, sorted deposits,
   station placement into plots), as lines `<run> <sha>` in `/srv/showcase/REQUIRED_KEPT`. The bots start only when each
   has a `recorded KEEP` + `promoted` (or `owner-direct`) row on the bench and is inside the followed release.
3. Whether the bench's town stamp (place-town's platform, two deposit chests, torch chest, lectern; ten beds here)
   should be placed at `home` before the bots start, or the plan's code builds the core itself (`builds_core`).

The showcase never edits the world after frame 0 except that stamp (once, idempotent, before any bot joins) and the
save pauses its backups and timelapse use.
