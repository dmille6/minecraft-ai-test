# escpocket-01: the self-sealed pocket and the way back in (2026-11-07)

PROTECTED scope (reflex.mjs, escdead.mjs, swimunder.mjs, index.mjs step price): tier 3. Branch `escpocket-01` on the live
fleet `45defefa` (buildfix-01 promote). Follows escdead-01 (effect audit 11-07: NOT ACTING; its target isolated-d-Echo pinned
again at 358,58,180). Switch `ESCPOCKET=0` = the base.

## 1. Measurement

**Echo's rows, 11-07 00:00Z to 15:01Z** (16,314 skill rows on one bot; positive control `_climb_flood_guard` 848, `_entombed`
179). Fleet, 24 h to 15:01Z: 2,229,748 skill rows on 80 bots. `_swim_under_refused` 143 rows, all on 3 isolated-d bots
(Echo 47 today). `_swim_under` 8 rows on 7 bots. `_flood_breach` 0. `_flood_breach_refused` 102 rows on 31 bots. At 15:01Z
only Echo is still in the pocket. Delta is at 347,43,177 and Bravo at 389,33,230.

**The audit's "every swim refusal says wide=0" is not right.** Echo's refusals say `wide=0` for the first 30 min of each pin
episode. After that they say `wide=1 -- no way out within 8 cells (3 water cells searched)`. The wide arm does arm. It finds
no way out because the pocket changed.

**The re-entry (07:16Z).** At 07:16:34Z a gather walk fell 12 blocks into the lake. At 07:16:52Z the body was afloat at
358.7,52.5,177.5. At 07:16:57Z it was at 358.5,56.5,180.5, inside the falling-water column under the pocket, with a path
running (`_path_reset goal_updated`). At 07:16:58Z the marooned arm fired (`_marooned` "an open column above -- climbing
out", feet y=56.2). The pillar placed one dirt (`_inventory_mutation cause=maroon_escape dirt -1`). The body rose to y=58
and the flood guard refused the roof.

Bravo did the same at 05:53Z, one minute after its swim out. An explore walk dropped it into the lake. A path was running at
358.5,54.5,180.6 and the body was carried up to 358.3,56.2.

The mechanism is mineflayer-pathfinder 2.4.5. It walks a `noPath` best-partial path: `path = results.path` whatever the
status. Its best partial path from the lake ends at the column bottom, 358,54,180 (real A* on the cut, test T2). While in
water it holds jump every tick (index.js:611), so the body rises up the column into the pocket.

**The pocket now** (the 11-07 03:16:21Z backup region copy, read-only, plus two edits):

| y | 358,y,180 | note |
|---|---|---|
| 63 | diorite | the lid |
| 62 | air (dirt at 03:16Z) | read as "closed by air" |
| 61 | water | one cell |
| 60 | granite | the roof |
| 59 | air | the head |
| 58 | water | the feet. N furnace, S crafting table, E dirt, W stone |
| 57, 56 | falling water | |
| 55 | **dirt** (water at 03:16Z) | Echo's own pillar block |
| 54..53 | falling water | the canary's way out turned west at 54 |

The cut plus dirt at 358,55,180 plus air at 358,62,180 reproduces every live row exactly (test R1):

- narrow: `no way out within 4 cells (3 water cells searched)`;
- wide: `no way out within 8 cells (3 water cells searched)`;
- the startCells string, character for character;
- the breach refusal.

A plug one higher reads "2 water cells", not the live 3. The cut without the plug has the canary's 10-cell exit to dry
356,55,177.

**"Closed by air at y=62".** The breach plan needs two air cells over the water. It printed `top1`, the air cell, even when
`top2`, the diorite at y63, was the one that failed. The refusal was right: it would flood the pocket into a one-cell bubble.
Only the reason named the wrong cell. Fixed: it now says "closed by diorite at y=63 (one air cell under it)".

**The dead-end chain at 358,58,180.** Each rung refuses, and the remedy each one names cannot be carried out from the cell:

1. **Flood guard** (pillar, ramp, shaft): "liquid above the block overhead". It names "leave sideways or downward (mine or
   goto)". Goto is the pathfinder, and it is `sealed_in_liquid`. Nothing mines downward.
2. **plugcut**: "the wet face 0,3,0 is a cell the climb needs open".
3. **Pathfinder**: `sealed_in_liquid`, and "no route out even with digging allowed" (it never starts from a liquid node).
4. **Swim, narrow and wide**: no way out (3 water cells). It never digs.
5. **Breach**: closed above. Correct.
6. **Pool escape**: "no floor under the feet".

The only block between Echo and the canary's exit is the dirt it placed itself, and no rung digs it.

## 2. Design (what is built)

1. **The pocket dig** (`escdead.mjs pocketDigPlan`, and the actuator `pocketDig`). It runs on the wide tier (a 30-min pin, or
   at once in a recorded trap) when no swim exists.
   - **Which block.** One block, or two for a sideways opening. It must border a searched water cell, below or beside it,
     never above (water does not flow up into it).
   - **Height.** At the start's feet level or lower. The pocket's air is the breath, and water cannot rise into the head
     cell from below.
   - **Reach.** Within 4.5 of the eye. Mineflayer allows 5.1; Paper allows 4.5 + 1.
   - **Kind.** Not furniture or a station, not a falling block, not unbreakable, and nothing with lava on any face.
   - **Caller's rule.** Not guarded (`guardMay`), and diggable in 12 s or less from the floating stance with the escape
     policy's tool.
   - **Choice.** The fewest digs win, then the fewest head-wet cells, then the shortest route.
   - **The actuator.** It holds jump while each swing runs, so the body floats in place (Codex r1). It checks ownership and
     air every tick. A yield stops only our own swing (Codex r2). Air under 16 stops the swing and fails the firing. After the
     dig it re-plans the swim on the live world and runs it as before.
   - **Live case.** On LIVE it digs exactly the plug, 358,55,180, dirt, 4.33 from the eye. The swim is then the canary's
     route (test P1). In prismarine-physics the head never goes under during a 3.75-s swing, and the swim reaches 356,55,177
     (test P6).
2. **The pillar's column-cap preflight** (`reflex.mjs columnCapRisk`, run in `pillarOut` before the block count).
   - From a wet start it scans the open column to its first block, the cap. It reads the cap with the same
     `overheadBreakRisk` the climb would ask at the top.
   - A refusal returns FLOOD_RISK before anything is placed. Both arms then run floodBranch, then the swim, then the breach.
   - A cap at feet+2 belongs to the existing checks. A dry side opening below the cap passes, because the climb stops there
     (Codex r1).
   - At the re-entry cell the candidate refuses with zero placements, and the base places the plug (test C2). The narrow swim
     from y=56 has a way out, so the next rung's remedy can be carried out (test C3).
3. **Trap sites** (`trapSiteFrom`, `worldfacts.reportTrap` / `trapSites`, `index.mjs trapPenalty`).
   - Every swim `out` records the pocket: its feet and head cells, and the cells of the start column the body rose by. For
     Echo that is 358,54..59,180. The way out is not recorded.
   - The record is kept per bot and pool-wide in world facts, for 12 h after the last escape. It has count 1, so the 12-h
     prune removes it.
   - Every cell in it costs 101 in the shared step entry (`deathSitePenalty`, which `waterMoves` uses too). Mineflayer deletes
     any move over 100.
   - A body already in a trap cell is never priced out.
   - A body found in a recorded trap gets the wide search at once.
   - On the real A*, the base's best partial path from the lake enters the column. With the price no node is a trap cell, and
     the swim exit 357,54,179 is still reached (test T2).

Not built:
- Pricing pathfinder drop-down landings (mineflayer does not price the landing cell; deathsites.mjs notes the same).
- Stopping the float hold or the drowning rescue from rising into a recorded column. These rows show the pathfinder as the
  mover. The cap preflight, the immediate wide tier and the pocket dig are the backstops if another mover does it.

## 3. Reviews (protected scope: two engines, iterated to none)

**Codex** (`codex exec -s read-only`):
- r1 (d2fb6476): 3 blockers, fixed in b1b3af43.
  1. The dig suspended the float hold without floating the body. Echo sank from y58.2 to y56 in a 3.75-s swing.
  2. The cap preflight refused climbs that have a dry side exit below the cap.
  3. A yielded two-block dig could equip over the new owner's hand.
- r2: 2 blockers, fixed in 6b1a48dd.
  1. A yield could `stopDigging` the new owner's dig.
  2. `bestTool`'s hand swap ran before the ownership check.
- r3: 1 blocker, fixed in d5dcceab. Mineflayer's `dig()` awaits its own `lookAt` before it sets `targetDigBlock`. A yield
  in that window orphaned a swing that later cancelled the new owner's dig. Now the swing looks first, re-checks ownership,
  then calls `bot.dig(block, 'ignore')`, which has no await before `block_dig`.
- r4: no blockers.
- r5, on the Paper finding (8d899a0a): no blockers.

**Independent Claude subagent:**
- r1: no blockers. Its three notes were answered.
- r2: 1 blocker, the same `lookAt` race as Codex r3. Fixed.
- r3: no blockers.
- r4, on 8d899a0a: no blockers.
- Non-blocking edges it raised:
  - With the `'ignore'` dig the face stays "top", which Paper does not check.
  - The side-exit rule counts only dry openings. A wet side opening is now the swim's job. The swim planner finds it.

## 4. Paper proof

Setup:
- Sandboxes 5, 6 and 7, failmine's scene driver, each server's own `failmine` lock taken and released.
- Scenes built with `failmine.cut` from the 11-07 03:16:21Z region copy plus the live edits, with Echo's newest bag.
  - `escpocket-isolated-d-sealed-1107` (cells cb1a793b): plug at 358,55,180, air at 358,62,180, start 358.3,58.2,180.3,
    16 min.
  - `escpocket-isolated-d-column-1107` (cells 8ad7956f): no plug, start 358.5,56.2,180.5, the re-entry cell, 10 min.
- The oracle is `escape`.
- Candidates set ESCDEAD_PIN_MS=60000, so the wide tier arms after 1 min instead of 30.

| scene | build | runs | outcome | how |
|---|---|---|---|---|
| sealed | base 45defefa | 1 | **stayed** 16 min | the live chain |
| sealed | cand b1b3af43 / d5dcceab / 8d899a0a | 3 / 1 / 2 | **escaped** (all runs) | `_swim_under_start wide=1 dig=..,55,..:dirt`, then `_swim_under outcome=out cells=10/10 min_air=17 hp=20->20`, then `_trap_site_recorded via=pocket_dig cells=6` |
| column | base 45defefa | 1 | **stayed** 10 min, matched_fleet | `_marooned` at y=56, then the pocket chain; narrow swim "3 water cells" (the plug) |
| column | cand b1b3af43 | 3 | **escaped** 3/3 | the body floats up to the pocket and the swim gets out once the pin arms |
| column | cand d5dcceab | 1 | escaped | **finding**: an entombed arm that began on the driver's dry holding pad pillared after the teleport and placed the plug. The pocket dig dug it and the second swim got out. Fixed in r4: the cap is read before every placement |
| column | cand 8d899a0a (final) | 3 | **escaped** 3/3 | no placement; `_swim_under outcome=out` |

Paper showed four things the unit tests could not:
- the server accepts the floating dig of the plug;
- the column refills;
- the re-planned swim runs out;
- the bot's own reflex order reaches the pocket dig.

"Cand b1b3af43" is the pre-r2 code. r2 and r3 changed only ownership edges that a single-bot scene cannot reach, and
8d899a0a re-ran both scenes.

## 5. Effect (registration)

- **Primary:** `_swim_under` success rows. 8 in 24 h fleet-wide on 7 bots, so the baseline is not zero.
- **Pinned time:** `_swim_under_refused` rows. 143 in 24 h, all isolated-d, Echo's pin about 7.7 bot-h today.
- **Guardrails:** `_death` failclass `drowning`, and items per bot-hour.
- **The read's own lines:**
  - `_swim_under_start ... dig=` (a new detail field; the base never writes it);
  - `_trap_site_recorded`;
  - `_climb_flood_guard caller=pillar_cap`;
  - `_escpocket_mode on=1` as the licence.
- **Draw:** it must contain isolated-d, where Echo is.
