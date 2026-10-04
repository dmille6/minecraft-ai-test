# Junk well: sandbox results (Paper 1.21.8, sandbox3 10.0.0.30:25601, 2026-10-04)

Driver: `scratchpad/well/well.mjs` (one node process, two bare-mineflayer bots `sandbox-WThrow` (THROWER), `sandbox-WWalk` (WALKER);
mineflayer 4.37.1 / pathfinder 2.4.5 from this worktree's `bots/node_modules`). RCON through `/tmp/sbx-rcon.py sandbox3` (it reads the password itself).
Logs: `scratchpad/well/run2.log` (S0), `run4.log` (S1, first S2, S3, S3b), `run5.log` (S2r, S5), `run6.log` (S4), `run7.log` (S4b), `run8.log` (cleanup).

Sandbox config checked first (same as the fleet for what matters here): `merge-radius.item: 0.5`, `item-despawn-rate: 6000`,
`only-merge-items-horizontally: false`, `alt-item-despawn-rate.enabled: false`. Differences: `simulation-distance=4` (fleet 6), `difficulty=peaceful`
(the fleet is also peaceful: 16/16 world servers read `difficulty=peaceful`).

Arena: a floating stone slab at y 196..199 over x/z 1486..1514. Before building, `execute if blocks <arena> <same box at y280> all` returned
`Test passed, count: 11774` (the arena was all air). As a check that the test can fail, `execute if block 1500 64 1500 air` returned `Test failed`.
Ground layer g = 199, so feet are at y 200.
W1 = (1500, 199, 1500) and W2 = (1494, 199, 1494): `oak_trapdoor[facing=north,half=top,open=false]` at g, air at g-1 = 198, stone floor at 197.
RCON verification: `oak_trapdoor[half=top,open=false,facing=north] -> Test passed`, `air -> Test passed`, `stone(floor) -> Test passed`; as the
negative check, `stone at 198 -> Test failed`.

## How items were counted (and the instrument bug I hit first)
`data get entity @s` replies are truncated by RCON, and a reply that spans several packets throws sbx-rcon.py out of step, because it reads one
packet per command. My first S1 census (run3) produced nonsense totals ("27510 landed"). The fix keeps every reply small:
`execute as <sel> store result score @s wc run data get entity @s Item.count`, then `scoreboard players operation #in wc += <shaft sel> wc`, and the
same for Age (min and max). The shaft selector is `@e[type=item,x=W,y=197,z=W,dx=0,dy=1,dz=0]`. Entity counts come from `execute if entity`.
How I know it works: the census matched exactly what the throws put in, every time (below), and both selectors (shaft and whole arena) were checked.
Anyone reusing sbx-rcon.py for entity listings should read this note first.

## Scene 0 CONTROL: can the instrument see a pickup? PASS (n = 20 stacks)
THROWER stood on a 2-high pillar (feet y 202) and threw 20 distinct stacks (1,232 items) onto the ground at y 200. WALKER started with an empty bag
and walked to each item.
- After the toss: `{"entities":20,"selectorCount":20,"items":1232,"ys":["200.00"]}`; thrower bag `0 0`.
- **WALKER server bag after: 20 stacks, 1,232 items** (read with `data get entity sandbox-WWalk Inventory[i]`); 0 item entities left.
- Bonus: the thrower picked up none of its own items. It stood 2 blocks above them (dy = -2), although they were also 2-4 blocks away horizontally,
  so this does not test the vertical limit on its own.

## Scene 1 ACCURACY: PASS, 59/60 stacks on the first throw, the 1 miss retaken (run4)
THROWER was teleported to 5 stands north of W1, 12 stacks each. At each stand it opened the trapdoor itself (`activateBlock`), threw with
`bot.tossStack`, and closed the trapdoor. The pitch came from the vanilla ballistics in toss.py, aimed at the usable opening
[d-0.375, d+0.1875]. The flap opened on the FAR side: client shape `[[0,0,0.8125,1,1,1]]`.

| stand (axial d, lateral l) | dist | pitch (server `Rotation`) | sim P(in) | tossed | landed in shaft | miss |
|---|---|---|---|---|---|---|
| 1.00, 0 | 1.000 | 54.45 | 0.999 | 12 / 720 | 720 | 0 |
| 1.15, 0 | 1.150 | 48.45 | 0.994 | 12 / 768 | 704 | **1: sand x64 at (1500.53, 200.00, 1501.18)**, on top of the far rim, 0.18 past the hole |
| 0.85, 0 | 0.850 | 58.5 | 1.000 | 12 / 720 | 720 | 0 |
| 1.00, +0.25 | 1.031 | 52.95 (yaw 14.1) | 0.997 | 12 / 768 | 768 | 0 |
| 1.00, -0.25 | 1.031 | 53.55 (yaw -14.1) | 0.999 | 12 / 720 | 720 | 0 |

- The miss was retaken: THROWER walked to it, the outside count went to 0 (`outAfterRetake 0`), and the server bag showed `sandx64` back.
- Final RCON: `#in has 3632 [wc]`, `#all has 3632 [wc]`, `Test passed, count: 59` (shaft) and `Test passed, count: 59` (arena). That is 3,632 items
  thrown, all in the shaft, and 0 anywhere else in the arena.
- Open and close were read back every time, on the client and the server (`execute if block ... oak_trapdoor[open=true|false]` returned
  `Test passed`, 10/10).
- An earlier run (run3, where the census was broken for item totals) threw 58 stacks from the same five stands. The entity counts are valid there:
  shaft `count: 58`, arena `count: 58`, and nothing above y 199.5. So 58/58. Over both runs, **117/118** stacks landed.
- Simulated vs observed: the simulation predicted about 0.997 overall. One miss in 120 attempts is consistent with that, and the one miss came from
  the 1.15 stand, the stand the simulation rated worst.

## Scene 2 ISOLATION: PASS, WALKER picked up 0 (two runs)
**S2 (run4), 59 stacks / 3,632 items in W1.**
- (a) **Trapdoor OPEN, walker at the rim.** WALKER was teleported to 5 spots with its bounding box hanging 0.25 over the hole: horizontal distance
  0.55 from the well centre on the E, S and W sides, and 0.78 on two diagonals. It jumped 4 times at each spot. Its lowest y was 200 at every spot,
  so it never fell. **Walker bag 0/0**, and the well still held 59 entities / 3,632 items.
- (b) 200 scripted passes over the closed trapdoor: 70 straight (x and z), 40 jumping, 30 diagonal and 60 rim-ring segments. Lowest y over all
  passes: 200. Walker bag 0/0 at 50, 100, 150 and 200 passes.
- **Caveat:** by pass 150 the items had started to despawn (24 entities left at 150, 0 at 200), and the "stand on the trapdoor" part ran on an
  empty well. Only about 125 of those passes had items under them. Hence S2r.

**S2r (run5), 20 fresh stacks / 1,232 items, Age reset to 0 by RCON every 50 passes** (a harness step to keep the well full):
- Stood 30 s on the closed trapdoor, with 6 jumps, at (1500.82, 200, 1500.50). Feet y 200.0, which confirms the cap is flush.
- 3 s on each of the 8 rim blocks.
- 200 passes, same mix as above, lowest y 200.
- After stand + rim, and after every 50 passes: **walker bag 0/0**, well `inEnt 20, inItems 1232`. The client saw 0 `playerCollect` events
  for the walker.
- Final RCON: `#in has 1232 [wc]`, `Test passed, count: 20`.
- So the population survived all of it (20 entities before and after). The same bot picked up 20/20 in S0.

## Scene 3 DESPAWN: PASS, gone at about Age 6000
Ages come from the run4 census, with bots within range and forceload on:
- +275.9 s: 59 entities, Age 4246..5367
- +344.3 s: 24 entities, Age 5613..5940. Every entity older than about 5940 is gone.
- +382.2 s: 0 entities (`#in has 0`). The youngest would have been about 6370.
- The control S3b run (bots present) tracked gametime exactly: Age +1216 over gametime +1216.

**No player near (S3b, simple case, forceload removed):** I threw 3 fresh stacks into the well.
- Control, 60 s with both bots present: Age 81..96 -> 1297..1312 (+1216) while gametime went +1216.
- Then both bots disconnected for about 120 s (`There are 0 of a max of 3 players online`). Gametime went 39841944 -> 39844360 (+2416).
- After rejoin: Age 1622..1637. Over gametime +2626 since the end of the control, **the age advanced only +325**. That 325 is about 73 ticks before
  the disconnect, a few seconds of chunk-unload delay, and the rejoin load. So **the despawn timer PAUSES when no player keeps the chunk ticking**.
  The items stayed (3 entities / 192 items after rejoin).
- Second observation: with the chunks **forceloaded** and 0 players online, the age kept counting (+647 Age over +647 gametime, measured between
  runs). A forceloaded town would despawn on schedule. An unattended, non-forceloaded town keeps its well contents until bots return. They stay
  contained, which S2 showed.

## Scene 4 PATHFINDING HAZARD (fleet travel Movements: canDig=false, allow1by1towers=true, allowParkour=false, maxDropDown=6, placeCost=5)
Tested on W2 (empty). Ran 0 is invalid: a harness bug. It called `pathfinder.stop()` after a successful goto, which killed the next goto (the
"stale stop" trap already in memory). Fixed in run6.
- **Closed, through a 1-wide x-corridor: 4/4** planned through the well cell and walked over it. Lowest y 200.
- **OPEN, x-corridor 4/4 and open field 4/4:** every plan routes across the cell. Its node is `1494.5,200,1494.703125`: the planner treats the
  3/16 flap top as standable and offsets the node onto it. **0/8 fell**, lowest y 200.
- **OPEN, z-corridor (crossing at right angles to the flap): 4/4 crossed, 0/4 fell.**
- **OPEN, goal ON the well cell:**
  - along z: **2/2 FELL IN** (ended at y 198.00 in the shaft). Pathfinder still reported `ok`.
  - from the west along x: 2/2 ended perched on the flap edge at (1494.36, 200, 1494.66) rather than falling.
- **Verdict:** the prediction that the planner would walk onto an open trapdoor is confirmed. In practice, a bot passing at walking speed crosses a
  1x1 open hole without dropping (0/12 open crossings). A bot that STOPS on the cell, because its goal is there or presumably because it
  pauses or turns there, falls in, onto whatever is in the well. The admission rule (no other player within 5 while the trapdoor is open) is still
  needed. Not tested: whether a fallen bot can get out, and whether the bag refills from the well contents.

## Scene 5 MOB SPACE: NOT spawn-proof as designed (by code plus measurement). Moot on today's fleet (all peaceful).
- **The design's clearance figure is wrong.** A top-half trapdoor is 3/16 thick at the TOP of its cell. Client shape: `[[0,0.8125,0,1,1,1]]`
  (closed, half=top); vanilla `TrapDoorBlock` uses `Block.boxZ(16, 13, 16)` rotated. The clear height under it is g-1 .. g+0.8125 =
  **1.8125, not 1.5**.
- Vanilla 1.21.8 `NaturalSpawner.isValidSpawnPostitionForType` ends in `noCollision(type.getSpawnAABB(x+0.5, y, z+0.5))`. `ON_GROUND` needs a
  valid floor below and `isValidEmptySpawnBlock` at the spawn position and at the position above. A top-half trapdoor is not a full collision
  block, not a signal source, and not in PREVENT_MOB_SPAWNING_INSIDE, so it passes.
- Heights from `EntityType`:
  - zombie, husk, drowned and witch 1.95; skeleton, stray and bogged 1.99: all blocked.
  - **creeper 1.7: fits.**
  - spider is 1.4 wide: blocked.
- **The shaft is dark at all hours.** Client light data reads `sky 0, block 0` under the closed trapdoor (the surface cell next to it reads sky 15).
  The closed top-half trapdoor's full top face blocks skylight. Under easy difficulty or higher, a creeper can spawn in the well day or night.
  The first time a bot then opens the trapdoor 1 block away, the creeper is 1 block from it.
- Summon check on the sandbox: difficulty set to easy for about 4 s, a creeper and a zombie summoned (NoAI) at (1494.5, 198, 1494.5) under the
  closed trapdoor, then killed, and difficulty set back to `The difficulty is Peaceful`.
  - The creeper stayed at `[1494.5d, 198.0d, 1494.5d]` at `20.0f` health: it fits.
  - The zombie result says nothing: `/summon` skips the collision check that natural spawning makes.
- **On the fleet:** a read-only check found 16/16 worlds at `difficulty=peaceful`, so no hostile mob spawns there today. It matters only for the
  "any Minecraft world" requirement.
- Cheap fix, not tested: the recipe yields 2 trapdoors. Lay the second one **bottom-half on the shaft floor**. A spawn position at g-1 would then
  collide with it (0..3/16), and a spawn position at g has air below it (not a valid floor). Items would rest at g-1+0.1875, which leaves
  dy = -1.81 to a rim player against the -0.75 limit. A bottom slab on the floor works the same way.

## Cleanup (run8)
- `fill <arena> air` filled 3,364 blocks.
- `execute if blocks <arena> <y280 box> all` returned **`Test passed, count: 11774`** (the arena is back to all air).
- 20 leftover item entities killed.
- Scoreboard objectives wc and wa removed (`There are no objectives`).
- `forceload remove` -> `No force loaded chunks were found`.
- Difficulty Peaceful, 0 players online.
- The bots' bags were empty at their last disconnect. The final `clear` returned "No player was found" because they were offline.

## Surprises, in order of consequence
1. The clearance is 1.8125, not 1.5, and the shaft is permanently dark, so **creepers can spawn in the well on non-peaceful worlds**. A design
   correction is needed if "any world" stands (a second trapdoor on the floor).
2. The open trapdoor is a hazard only for a bot that STOPS on the cell. Crossings did not fall (0/12 open crossings); a goal on the cell fell in 2/2 along z.
3. **Despawn pauses with no player near** (+325 Age over +2626 ticks). Forceload keeps it running.
4. Harness: sbx-rcon.py reads one RCON packet, so long `data get` replies are truncated and desync later replies. Use scoreboard sums or per-field queries.
5. The aim works with the real server rotation. `tossStack` throws hit the 13/16 opening 117/118 times. The design's pitch (~52.5 deg at d=1) is
   close to the simulation's best (54.5 deg).
