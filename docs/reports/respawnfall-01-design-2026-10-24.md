# respawnfall-01: a bot that respawns on a high platform climbs down instead of walking off it (design r1, 2026-10-24)

OWNER 2026-10-24 (through the coordinator): no world edits, so the one-time cleanup of isolated-a's sky platform is
**not pursued** (that plan was never written). Build the code fix instead. A bot that spawns or respawns on a high
platform with a deadly drop climbs down safely: its own pillars or stairs, placing blocks, digging down, by the cheapest
safe path. If there is no safe way down, it raises the existing `_needs_rescue` flag and stays put. It must compose with
cavefall-01's floor rule, poolescape, ceilescape, entombed and lavastep. Every refusal names a remedy the bot can carry
out. Base: fleet `2d1aa8c1` (townplan-01, promoted 15:25Z). Branch `respawnfall-on-2d1aa8c`.

Nothing on the fleet was changed: no bot, queue, scheduler, manifest, env or world. ES was read with the read-only key.
The 10-24 staged backup was read through failmine's `fmserve.py`, which is read-only and writes region copies to /tmp.
Paper runs only on sandboxes under per-server locks (§7).

## 0. Findings (denominators first)

1. **The platform exists, and only in non-drawable pools.**
   - isolated-a's 10-24 backup holds **1,118 bot-placed cells** in x 315-430, y 95-186, z 90-210: cobblestone 641, oak_log
     176, dirt 97, oak_leaves 96, others 108. That is 503 cells at y=180 and 290 at y=125, mostly 1-wide bridges.
   - Of the **441 columns** within 10 of spawn (355,147), **174** have a bot-placed cell. A respawn lands on the highest
     block of a random column in that square. The top of a column is at y=180 in 62 columns, at y=125 in 49 and at
     y=182-186 in 37 (trees on the deck).
   - The other 9 shared-seed worlds have no platform (tops 85-105; cavefall-01 design §0.6). placebo-c has a small one
     (32 of 441 columns, y 124-165).
   - isolated-*, placebo-c and every other exposed population is **never drawable**: drawexposure.py and drawrequire.py
     both exclude them (§8).
2. **The deaths, 7 days to 10-24 13:00Z (ES, 10,532,760 docs, 278 `_death`):**
   - **12 of the 278 deaths** are falls from the platform: isolated-a-Comet 11 and isolated-d-Comet 1.
   - They fell 46-118 blocks. At the moment of death the bots were running explore (5), goto (3) or gather (1), or were
     idle (3).
   - Every one sits inside an episode that began with the bot above y=120 (§0.3).
3. **Every high episode, all pools.** 972 rows in the week stood at y >= 110. Split at gaps over 5 minutes, that is
   **12 episodes on 9 bots**:
   - 4 episodes ended in deaths (isolated-a-Comet 3, isolated-d-Comet 1), and those 4 hold all 12 deaths: a respawn loop;
   - 8 ended with the bot leaving, or the rows stopping, at y 110-124. Those are terrain or low builds, not the platform.
4. **What they carried.** At the start of each platform episode the bot held **247-349 placeable blocks** (the RESCUE_BLOCK
   set), 64-66 of them logs; isolated-d-Comet held 439. A straight 1x1 descent from y=180 to this ground costs about 105.
   - So in all 4 death episodes the fix's normal branch would have run; the "stay" branch would not have fired.
   - What was missing was a decision to go down, not material.
5. **Nothing makes a respawned bot come down.**
   - The model picks explore or goto. The pathfinder walks the deck and its 1-wide bridges, places scaffold (most rows
     above y=110 are `_path_reset block_updated`), and the bot falls.
   - None of the 12 fall deaths sits on a planned drop. The cavefall-01 §0.2 audit found 75 of 91 fall-death paths had no
     drop at all.
   - The stranded_high reflex (`maroonState`, y >= 125) fires only when **no path can start**. On a deck a path can
     always start, so it never fires there.
   - `rideFloorDown` exists and works: 23 production calls placed 140 blocks and 21 of them descended (its comment). It is
     reached only from goto after a proven noPath, and from the stranded_high reflex.
6. **Expected size.** At most 12 deaths a week, all in isolated-a/isolated-d, which canaries cannot draw. The fix removes
   the respawn loop's mechanism (§2). Its effect cannot be measured on a drawable canary (§8).

## 1. Prior art

- **Baritone** (`MovementDescend`, `MovementDownward`, `MovementFall`):
  - it falls only up to `maxFallHeightNoWater` (default 3) onto solid ground, or 23 onto a water bucket it places;
  - `MovementDownward` breaks the block under its own feet and drops one block, which is exactly `rideFloorDown`'s free
    branch.
  - SAFE_DROP = 3 is that same number.
- **mineflayer-pathfinder** 2.4.5: `maxDropDown` is a per-Movements number (6 on this fleet's walk profile, 8 on
  descend). There is no "place a block under yourself and descend" move. `getMoveDown` digs down only onto a landing
  within maxDropDown. The deck profile below sets maxDropDown to 3 and turns off digging, towering, parkour, sprinting and
  scaffold bridging.
- **mineflayer-pathfinder #296** (forceLook on placement) is already handled in `rideFloorDown`.
- **Vanilla:** fall damage is ceil(d - 3), and a respawn with keepInventory keeps the bag; the fleet's gamerule, observed
  in §0.4's bags.

## 2. The rule (bots/src/respawnfall.mjs, pure)

- **Elevated** (`elevation`): the bot is grounded on a solid support, and either
  - its own column has >= ELEVATED_MIN = 8 open cells below before the first solid, or
  - at least **EDGE_SIDES = 3 of the 4** cardinal sides drop >= 8.
  A pillar alone, or inside a deck over the void, has 4 such sides. A natural cliff edge has 1 and a corner 2: a bot that
  spawns beside a ravine is not on a platform and must not dig a shaft beside it.

  Each side's drop is read from the support's level down: from the side cell itself when it is open, else from under it.

  Not elevated:
  - a water landing (swimming is travel);
  - an unloaded column (asked again on the next decision, never guessed);
  - a bot that is not on the ground.

  Lava below is elevated.
- **The order** (`descendOrder`): it is issued for an elevated bot within SPAWN_WINDOW_MS = 10 min of a `spawn` event
  (login or respawn), or while an episode that started that way is still elevated. A cave shelf long after a spawn is not
  this rule; that is cavefall-01's.
- **The price** (`descentCost`, `columnReader`) simulates `rideFloorDown` straight down from a support cell:
  - each step the support moves down one;
  - a solid cell under it is ridden for free, and an open one costs one carried block;
  - only cells above the support ever change, so the runs below stay as read.

  The descent is done at the first support with **at most SAFE_DROP = 3 open under it (or water) and fewer than
  EDGE_SIDES deadly sides**.

  Not priced at all:
  - lava or water in the column, or two below it (`rideFloorDown` stops at a liquid two below);
  - an unloaded cell under it or beside it;
  - more than SCAN = 400 steps.

  The reader is memoised per cell, so pricing 288 cells costs about 40k reads (10 ms in the test).
- **The cheapest start** (`cheapestStart`): every stance within START_RADIUS = 8 on the support's level (solid support,
  two open cells above) is priced. The own cell is the default. Another cell wins only if it saves **SAVE_MIN = 4** blocks,
  because a walk across a deck has its own risk.

  On isolated-a, the pillar at (354,148) has 44 cells over y 96-183 and is 3 cells from spawn.

## 3. The skill (`sky_descend`, skills.mjs `skyDescend`)

The skill is chatOnly and a rescue skill. It runs only from cognitive.mjs's deterministic order and is never the model's
choice. Steps 1 to 3:

1. **The cheapest column.** If it is another cell, the bot walks there on the **deck profile** (`bot.withDeckMovements`,
   index.mjs):
   - maxDropDown 3;
   - canDig false, no 1x1 towers, no parkour, no sprint (a sprint overshoots a 1-wide bridge);
   - `scafoldingBlocks` empty, so nothing in the walk steps past what is already there;
   - a 15 s clock.

   Wherever the walk ends is priced again: a short walk is not an arrival.
2. **Short of blocks:** carried logs become planks in the 2x2 grid, which needs no table. Each log gives 3 more blocks.
3. **Centre and ride.** The bot centres on the support cell (a straddling body does not drop) and repeats
   `rideFloorDown`. **Each ride takes at most the steps the price says are left**, because rideFloorDown does not know the
   stopping test and would ride a pillar on into the ground (the first test caught that: 32 blocks instead of 28). Every
   batch is re-priced, and a batch that is no longer priced stops.

**Stay.** The bot stays when there is no priced column, it is still short after crafting, or the first step fails.

- It writes one `_needs_rescue` row per cell per 30 min, in ceilescape-01's shape: `arm=sky_descend at=x,y,z ... --
  <reason>`.
- It holds the body for SKY_STAY_MS = 30 s. `bot.skyHoldUntil` = that + 60 s.
- The order comes back on the next decision, so the model never gets a turn to walk it off.

**Outcomes:**

- `grounded` (success)
- `progress` (success: this run's 150 s clock is spent; the order continues while elevated)
- `stay` / `stopped` (failed, failClass needs_rescue)
- `no_effect` (not elevated)

Every run writes a `_sky_descend` row, evidence first: y before and after, the open run, blocks had and needed, placed,
rode, walked, crafted, stopped.

**Refusals and their remedies, from where the bot stands.**

- Short of blocks: "Pick up blocks (cobblestone, dirt, logs) and it climbs down at once; otherwise it waits here for
  rescue". This is executable if any reach: the pickup sweep runs, and the next decision re-prices. Logs are already
  converted.
- No priced column: names the reason (lava, unloaded, deeper than the scan) and says it waits for rescue.
- In every case the deliberate alternative is refused (next section).

## 4. Composition

- **The escape lattice's bottom rung, `step_off`** (walk off the edge on purpose, escape.mjs), is refused at **both** of
  its reflex sites while `skyHoldActive(bot)`:
  - the stranded_high lattice;
  - the y < 125 last-resort drop.

  The owner's rule for a bot with no safe way down is "stay put", and step_off is precisely the walk-off.
- **The stagnation watchdog** stands aside while held (`skyHoldUntil`): a bot holding still on purpose is not stuck, and
  the relocation walk is the fall.
- **stranded_high / marooned** run only when `!runner.isBusy()`, so they cannot interrupt a running descent. Between runs,
  a bot mid-column with no path start may get the lattice's `ride_floor_down` or `dig_down`. Those go down too and are
  priced against survivable health. step_off is refused while held.
- **keep-out-01's exit** outranks the order: it is applied after it in cognitive.mjs, because a fire column is the nearer
  danger.
- **Admission** passes `sky_descend` like keepout_exit (no repeat window or learned rule) but waits on an unsettled
  inventory click.
- **cavefall-01** (not in this base): its rule filters gather's targets and checks collectManually's dig. `rideFloorDown`
  calls `bot.dig` directly on its own floor after reading back a placed block under it, so the floor rule neither sees
  nor needs to see it. When both ship, a gather on the deck refuses deck cells over the void, which is right. The descent
  is never a gather.
- **poolescape-01 / ceilescape-01:** water landings are not elevated, so no descent into water is attempted, and a wading
  bot is not on a platform. ceilescape's `_needs_rescue` row shape is reused so its header line can carry this arm
  (§8.4).
- **entombed:** a bot riding a pillar under the deck has air on its sides, so it is not entombed. A bot that bridges down
  inside a 1x1 hole it dug stands on its placed block with open air beside, the same.
- **lavastep / lavasight:** a column with lava in it or two below is never priced, so no descent goes toward lava.

## 5. Owner questions

- **Q1.** None of the exposed pools can be drawn, so the canary cannot measure this (§8). Options:
  - (a) a canary on 4 drawable pools as a no-harm correctness gate only (false triggers, falls during a descent);
  - (b) an owner-direct rollout to isolated-a and isolated-d only, read against their own past (12 deaths a week),
    reported as before and after with world drift named;
  - (c) both.
  The recommendation is (c). The drawable canary proves it does nothing where there is no platform; isolated-a then shows
  the loop end.
- **Q2.** "Stay put" holds a bot that has no blocks indefinitely: one `_needs_rescue` row per cell per 30 min. Is the
  header line (§8.4) enough, or should the operator get a daily list? Measured, every platform bot this week carried enough
  to climb down.

## 6. Tests (bots/test/respawnfall.test.mjs, 29 behaviour tests, in `npm test`)

**The pure rule on isolated-a's shape:**

- a deck at 180 over ground at 71;
- the pillar with its gaps;
- a water landing and lava;
- unloaded below;
- a 7-open ledge;
- a cliff edge, a corner and a lone pillar.

**descentCost:**

- void = open less 3;
- pillar = its gaps;
- lava and unloaded are not priced.

**cheapestStart:**

- the pillar wins from spawn;
- the own cell is kept when nothing saves 4;
- out of radius;
- unreachable;
- no headroom.

**descendOrder:**

- the spawn window;
- an active episode;
- off.

**The REAL skill on a fake bot with fall physics** (a broken floor drops the body to the next solid):

- 200 blocks: it climbs down to descentDone;
- it rides a column, placing only the gap less SAFE_DROP;
- 10 blocks: it walks on the deck profile to the pillar and rides it;
- a short walk is priced where it ended;
- logs are crafted into planks (crafts = ceil(deficit/3)), then it climbs down;
- too few blocks: it stays, with no dig and no walk, raises needs_rescue and sets the hold;
- a placement that never takes: it never digs its floor;
- not elevated: no_effect;
- off-centre: it centres.

**Anchored mutants** (present and unique), each killed:

- water read as deadly;
- unknown read as open;
- no spawn window;
- the block count skipped;
- no watchdog hold;
- no SAVE_MIN;
- the side rule dropped in the price;
- lava priced;
- one deadly side enough.

**Wiring** (comments stripped):

- order position before keep-out;
- admission;
- watchdog;
- spawn stamp;
- registry line;
- both step_off sites ask the hold.

## 7. Paper (sandbox, per-server locks tagged `respawnfall`)

`sandbox/respawnfall/respawnfall-e2e.mjs`, on main's sandbox tree:

- **The whole bot, unmodified.** The model is the sandbox brain answering `explore`.
- **The platform is real:** isolated-a's 1,118 cells, cell for cell with their states, translated by (+4000, 0, +4000).
- **The respawn is real:** a spawnpoint on the fleet's column, then one kill. Every later death respawns there again,
  which is the loop.
- **Synthetic, and said so in every result row:**
  - flat stone ground with its top at y=70;
  - the jungle not copied;
  - a fleet-typical bag (288 placeable blocks, 64 of them logs), or a pickaxe alone.

Scenes: `deck` (respawn at 353,181,147), `bridge` (355,126,145) and `bare` (the deck with no blocks). Base `2d1aa8c1` and
candidate are each run on their own server in parallel pairs.

Read per run:

- deaths and falls;
- time to the ground alive;
- maximum drift (bare: the candidate must stay on its cell);
- `sky_descend` / `_sky_descend` / `_needs_rescue` rows;
- how many of the 1,118 platform cells still stand.

**Results: PENDING** (the sandboxes are held by cavefall-01's runs until those finish).

## 8. Read, registration, tier

### 8.1 Gates (scripts/host/respawnfallread.py, selftested)

**REVERT:**

- `rows_control`: a control `_sky_descend` / `_respawnfall_mode` row after the deploy;
- `licence_all`: every canary-pool bot seen carries `_respawnfall_mode on=1`.

**WATCH**, which blocks an automatic KEEP; a human reads it:

- `descent_fell`: a canary fall episode (a fall-family death, or fell >= 6 with >= 4 hp lost) inside a `sky_descend` run's
  interval (+5 s);
- `acted`: any canary `_sky_descend` row other than `no_effect` (grounded, progress, stay or stopped). No drawable world
  has a platform (§0.1), so every such row is either a real bot pillar or a false trigger, and a human reads its position
  before KEEP.

**HOLD:**

- `runaway`: more than 30 `sky_descend` runs by one canary bot in the window.

**Reported:**

- runs by outcome;
- `_needs_rescue` by bot and cell;
- blocks placed and ridden;
- fall-family deaths by arm, under the two-death floor.

### 8.2 Exposure

On a drawable pool there is none by construction (§0.1). The gates above are correctness and no-harm only. KEEP means
"did no harm where it should not fire": the licence is on, no acted row went unexplained, and there are no runaways.

### 8.3 Tier

drawexposure.py excludes isolated-* and placebo-c from the candidates, and drawrequire.py refuses an isolated pool in
`draw_require_pools` ("required pool %s is never drawable"). The coordinator's requirement that isolated-a be in the draw
**cannot be met by the scheduler as installed**, and changing the scheduler is outside this item. Registered **tier 3**
with the no-harm gates, plus owner question Q1. The registration is staged with no `draw_require_pools`, because
isolated-a would make the draw refuse forever.

### 8.4 The header

ceilescape-01's `rescue_line.py` lists `_ceilescape action=escalate` rows. ceilescape-01 is not on main. respawnfall's
`_needs_rescue` rows carry `arm=sky_descend`, and `scripts/host/respawnfall/rescue_sky.py` gives the same kind of line for
them: a bot is listed while its latest `_sky_descend` row is a stay and it has not moved 2 blocks since. It is to be merged
into the one header line when ceilescape lands.

## 9. Review record

| round | Codex | Claude subagent | what changed |
|---|---|---|---|
| design + code r1 | pending | pending | |
