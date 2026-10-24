# respawnfall-01: a bot that respawns on a high platform climbs down instead of walking off it (design r5, 2026-10-24)

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

r2 separates **when an episode starts** from **when it is over** (Codex r1 P1-2).

- **The trigger** (`elevation`): the bot is grounded on a solid support, and either
  - its own column has >= ELEVATED_MIN = 8 open cells below it onto anything but water, or
  - at least **EDGE_SIDES = 3 of the 4** cardinal sides drop >= 8 onto anything but water.

  A pillar alone, or inside a deck over the void, has 4 such sides. A natural cliff edge has 1 and a corner 2: a bot that
  spawns beside a ravine is not on a platform and must not dig a shaft beside it. Each side's drop is read from the
  support's level down, from the side cell itself when it is open and from under it when it is a block.

  Water under the bot's own column no longer exempts deadly sides (Codex r1 P1-7). Lava below is elevated.

  **The region (r3; Claude r2 P1-1, Codex r2 P1-2).** `regionAt` floods the stances a body can walk to within 8: a jump of
  1, or a drop of up to REGION_DROP = 6 (the walk profile's maxDropDown). The region is a **platform** when it holds a
  floating stance **and no grounded one**. The definitions were revised in r4 and r5 (Codex r3, Claude r3):
  - **Floating:** a deck up to DECK_MAX = 4 thick over 8 or more open cells onto anything but water, **whose void is open
    to the sky** within SKY_REACH = 32 cells sideways (8 open cells above its top layer). Leaves never float, so a jungle
    canopy is terrain; a cave under a thin natural roof is not open to the sky, so it is not a platform.
  - **Grounded:** 8 solid cells under the support, and either 16 of them or no deadly open run right under the solid
    stretch. An aquifer is ground; a 9-block hanging column is not.
  - A bot that is locally safe on a platform region is elevated: a thick patch of deck, or a tree standing on the deck
    (37 of the 174 spawn-square columns are topped by trees).
  - A bot on the ground beside a bridge over a ravine is not: its own stance is grounded.
  - A cliff top is not: none of its stances float.

  **Transient** readings are flagged and are never a verdict:
  - no position;
  - in the air;
  - no solid support (a rejected dig's ghost air, or the open side of an edge);
  - an unloaded column or side.
- **Done** (`doneAt`): a safe stance, which needs all three of:
  - **at most SAFE_DROP - 1 = 2 open under the support**, or water, so that even breaking it is a fall of <= 3;
  - **no side a deadly drop** (>= 8), walled sides included: riding down under a deck has the deck at the feet's level all
    round and the void just below it, which is an overhang, not an enclosure;
  - **a safe exit**: a side a body can step into whose drop is <= 3, or water. A flat step onto a block counts that block's
    own column, because a step onto a deck cell is still on the platform. Fully walled in rock also counts.

  r3 adds four more conditions:
  - **Lava is never a landing**, under the support or beside it (Codex r2 P1-1).
  - **Drops count the landing's real collision top**: a bottom slab lowers the landing by half a block (Codex r2 P2-5).
  - **On the ground**, a deadly side on fewer than 3 sides is terrain, such as a natural pit or ravine beside the landing
    (Codex r2 P2-4). A pillar with 3 or more deadly sides is never done, grounded or not.
  - **The region is not a platform.**

  A side that drops 4 to 7 beside a safe exit is ordinary terrain. An unreadable cell is unknown, never done.
- **The episode** (`descendOrder`):
  - It **starts** for an elevated bot within SPAWN_WINDOW_MS = 10 min of a `spawn` event (login or respawn).
  - It **runs until done**, window or not. An unknown or transient reading keeps it open and still issues the order, and
    the skill waits on it (Codex r1 P1-6, Claude r1 P2-2).
  - **Two things end it without a safe stance**, each with a `_sky_descend_end` row (Codex r2 P1-3, Claude r2 P2-2):
    - water: swimming is travel, and poolescape and the swim reflexes own a wet body;
    - a body kept **off the ground** for TRANSIENT_MAX_MS = 60 s (a ladder, vines, scaffolding).
  - **Unreadable geometry never ends it** (Codex r3 P1-3): an unloaded column, or no solid support, keeps the bot held.
    After 10 min of waiting the skill raises `_needs_rescue` while still holding it (Claude r3 P1-2).
  - A body on a block edge takes its support from under its hitbox (`bodySupport`), not from the air under its centre.
  - The trigger, and its flood, run **only inside a spawn window or an open episode**, and the flood stops at the first
    grounded stance (Claude r3 P2-3).
  - The model never gets a turn while an episode is open.
  - A cave shelf long after a spawn is cavefall-01's, not this rule.
- **The price** (`descentCost`, `columnReader`) simulates `rideFloorDown` straight down:
  - each step breaks the support, which must be **breakable with what the bot carries** (`diggable`: `planDig` on
    `bestTool`; Claude r1 P2-3), and drops one cell;
  - a solid cell under it is ridden for free, and an open one costs one carried block;
  - it is over at the first `doneAt` support.

  Not priced at all:
  - a liquid one or two below (`rideFloorDown` stops at a liquid two below);
  - an unloaded cell;
  - a support it cannot break;
  - a partial block in the column (Claude r2 P3-7);
  - more than SCAN = 400 steps.

  The reader is memoised per cell, so pricing 288 cells costs about 40k reads (10 ms).
- **The starts** (`rankStarts`): the own support, when it is a **full cube**, and every stance **reachable** from it on its
  own level. Reachability is a 4-connected flood over full-cube supports with two open cells above them, within
  START_RADIUS = 8 (Codex r1 P1-5, Claude r1 P3-10).
  - Another cell is offered only when it saves **SAVE_MIN = 4 blocks plus one per 4 cells walked**.
  - They are sorted by cost, then by walk.
  - A cell whose walk failed is excluded.
  - Only full cubes are ridden, because `rideFloorDown` reads its floor at feet - 1, which on a bottom slab is the cell
    under the slab (Codex r1 P2-9). A bot on a slab is walked to the nearest full cube first.

  On isolated-a, the pillar at (354,148) has 44 cells over y 96-183 and is 3 cells from spawn.

## 3. The skill (`sky_descend`, skills.mjs `skyDescend`)

The skill is chatOnly and a rescue skill. It is issued only by cognitive.mjs's deterministic order, every decision until the
episode is done. It is never the model's choice. **The whole run (SKY_RUN_MS = 140 s: walks, crafts, rides and the stay)
fits inside the runner's 180 s** (Claude r1 P3-7).

0. **Hold and wait.**
   - A transient reading waits 2 s and returns `no_effect` (a `wait` row); the order comes back.
   - Every run sets `bot.skyHoldUntil` for its whole length.
   - **No floor dig within SPAWN_GRACE_MS = 3 s of a spawn**: the server drops those digs (ghost-blocks-are-rejected-digs,
     09-29; Claude r1 P2-5).
1. **The cheapest reachable column** comes from `rankStarts`. Another cell is walked to on the **deck profile**
   (`bot.withDeckMovements`, index.mjs):
   - maxDropDown 3, with `infiniteLiquidDropdownDistance` off, so no plunge into water is planned (Claude r2 P2-3);
   - canDig false, no 1x1 towers, no parkour, no sprint;
   - `scafoldingBlocks` empty;
   - 15 s.

   A walk that does not arrive excludes that cell, and the next is ranked from wherever the bot stands, up to 3 walks.
   After that, the own column is used if it is priced; otherwise the bot stays.
2. **Blocks.** A **free column (cost 0) needs none** (Codex r1 P1-4). A paid one needs cost + MARGIN 2. Short, the bot first
   turns its logs into planks in the 2x2 grid (+3 blocks a log, no table).
3. **Centre, verified, then ride.**
   - The pathfinder's own `fullStop` snaps a body more than 0.2 off the centre once the goal is met (mineflayer-pathfinder
     index.js:330-345, confirmed by Claude r1).
   - The skill **checks** the result: a body still off the centre is never dug under (Codex r1 P1-1).
   - Each ride takes at most the steps the price says are left, and each batch is re-priced.
   - A support that is not a full cube, or feet not on an integer, stops the ride.

**Stay.** The bot stays when there is no priced reachable column, it is still short after the logs, or a step cannot be made.

- It writes one `_needs_rescue` row per cell per 30 min, in ceilescape-01's shape: `arm=sky_descend at=x,y,z ... --
  <reason>`.
- The body is held.
- The order comes back on the next decision.
- **The text says only what is true** (Claude r1 P1-1): what it needs, what it carries, "Held here for rescue
  (`_needs_rescue` raised)". r1 printed "pick up blocks", which no held bot could act on; that is gone.
- A deterministic way to get more material from the platform is owner question Q3. One example is mining a deck cell that
  is not the bot's own support, but on a floating deck the item falls through the hole.

**Outcomes:**

- `grounded`
- `progress` (the run's clock is spent and the episode continues)
- `stay` / `stopped` (failed, failClass needs_rescue)
- `wait` and the no-op `grounded` (no_effect)

## 4. Composition

- **The escape lattice stands aside** while sky_descend owns the episode: `skyEscapeBlocked(bot)` is true while held
  (`skyHoldUntil`) or while the episode is open (`bot.skyActive`, published by cognitive.mjs) (Codex r1 P1-3, Claude r1
  P2-4).
  - It is asked at the **maroon check**. That covers every rung behind it: need_scaffold, need_pickaxe, stranded_high and
    its `step_off` (the deliberate walk-off), and `climb` (pillaring back up its own column).
  - It is asked at the **last-resort branch**, which has no runner-busy guard and whose `dig_down` is priced by health,
    not by SAFE_DROP.
  - The hazard reflexes (drowning, lava, fire, entombed) are separate branches and are unchanged.
- **The stagnation watchdog** stands aside on the same gate: a relocation walk from a deck is the fall.
- **keep-out-01's exit** outranks the order, because a fire column is the nearer danger.
- **Admission** passes `sky_descend` like keepout_exit, but waits on an unsettled inventory click.
- **cavefall-01** (not in this base): its rule filters gather's targets and collectManually's dig. `rideFloorDown` calls
  `bot.dig` on its own floor after a placed block reads back under it, so the floor rule neither sees nor needs it. On the
  deck, cavefall's gather refuses deck cells over the void, which is right. The descent is never a gather.
- **poolescape-01 / ceilescape-01:** a water landing ends a descent, a wading bot is not on a platform, and ceilescape's
  `_needs_rescue` shape is reused (§8.4).
- **entombed:** a bot riding a pillar under a deck has air beside it at body height, so it is not entombed. A bot fully
  walled in rock is `doneAt` (enclosed), so the descent never digs on inside rock.
- **lavastep / lavasight:** a column with lava one or two below is never priced.

## 5. Owner questions

- **Q1. How to measure it.** The platform population was seen only in pools that are never drawn (§8). The options:
  - (a) a canary on 4 drawable pools, as a no-harm correctness check: false triggers and deaths inside a descent;
  - (b) an owner-direct rollout to isolated-a and isolated-d only, read against their own past (12 platform-fall deaths a
    week), reported as before/after with world drift named;
  - (c) both.

  The recommendation is (c).
- **Q2. A held bot.** "Stay put" holds a bot with too few blocks until rescued, writing one `_needs_rescue` row per cell per
  30 min plus the header line (§8.4). Is that enough, or should there be a daily list? Measured, every platform bot this
  week carried enough to climb down.
- **Q3. Material from the platform.** Should a held bot get material from the platform itself? For example, harvesting the
  deck's trees (176 oak_log cells stand on it, and their drops land on the deck), deterministic and bounded. Today it does
  not, and it says so.

## 6. Tests (bots/test/respawnfall.test.mjs: 45 behaviour tests in `npm test`, 79 s in the runner)

**The trigger:**

- the deck at 180;
- a slab support;
- ordinary ground;
- a 7-open ledge;
- a deck over a pond, and lava below;
- **water under one column with deadly sides**;
- the transient readings (no position, airborne, no support, unloaded, a throwing reader);
- a cliff, a corner and a lone pillar.

**Done:**

- a block at 74 is done, at 75 it is not;
- the ground;
- a pillar near the ground (6 is not done, 2 is);
- an unloaded side.

**The price:**

- void = open less 2;
- the pillar = its gaps, ending 2 above the ground;
- lava, unloaded and an unbreakable support are not priced.

**The starts:**

- the reachable pillar wins;
- a moated (unreachable) one does not;
- an excluded walk;
- no headroom;
- a slab support is walked off;
- out of radius;
- a 2-block saving is not walked for.

**The episode:**

- starts in the window;
- runs past it while not done;
- transient keeps it open;
- done ends it;
- done with a transient reading does not end it;
- off.

**The gate** (`skyEscapeBlocked`): held, open, neither.

**The REAL skill on a fake bot with fall physics:**

- climbs down, never more than 3 above the ground;
- the lattice is held off for every dig;
- the hold is released at the end;
- rides a column, bridging only the gap;
- a **free column with 0 blocks**;
- walks (deck profile) to the reachable pillar;
- a walk that never arrives tries each column once, then stays without digging;
- logs to planks;
- too few blocks: stays, held;
- a placement that never takes: no dig;
- not elevated, and **airborne: it waits**;
- centred, and **one that cannot be centred is never dug under**;
- **no dig inside the spawn grace**.

**Anchored mutants, each asserting the behaviour it breaks:**

- done at the trigger threshold;
- an episode ended on a transient reading;
- a reserve on a free column;
- no SAVE_MIN;
- lava priced;
- the side trigger on one side;
- an unbounded ride;
- a run without the hold;
- no centring check.

r1's two vacuous tests are gone (Claude r1 P3-8).

**r3 adds:**

- the thick patch: not done, no free start, elevated;
- the tree on the deck: elevated;
- the ground beside a bridge over a ravine: not a platform, although the bridge is seen floating;
- the lava lake;
- the natural pit beside the landing;
- slab landings;
- a partial block in the column;
- water ending an episode, and the 60-s transient clock with its reset;
- four more anchored mutants: done without the region, the trigger without the region, lava read as a landing, and water
  ignored.

**Wiring** (comments stripped):

- order position;
- `bot.skyActive` published;
- admission;
- the watchdog, maroon check and last-resort branch ask `skyEscapeBlocked`;
- the spawn stamp;
- the registry line.

**Elsewhere:** `fallpath-wired.test.mjs` now counts 8 helpers that restore the walk profile (the deck profile is the
eighth). The full `npm test` result is in §7.

## 7. Paper (sandbox6/7, per-server locks tagged `respawnfall`)

`sandbox/respawnfall/respawnfall-e2e.mjs`, on main's sandbox tree:

- **The whole bot, unmodified.** The model is the sandbox brain answering `explore`.
- **The platform is real:** isolated-a's 1,118 cells, cell for cell with their states, translated by (+4000, 0, +4000)
  (`isolated-a-platform.json`).
- **The respawn is real:** a spawnpoint on the fleet's column, then one kill. Every later death respawns there again.
- **Synthetic:**
  - flat stone ground, top y=70 (feet 71);
  - the jungle not copied;
  - a fleet-typical bag (288 placeable blocks, 64 of them logs), or a pickaxe alone.

Scenes: `deck` (respawn at 353,181,147), `bridge` (355,126,145) and `bare` (the deck, no blocks).

**Results: in progress.**

## 8. Read, registration, tier

### 8.1 Gates (scripts/host/respawnfallread.py, selftested)

**REVERT:**

- `rows_control`: a control `_respawnfall_mode` / `_sky_descend` / `_needs_rescue arm=sky_descend` row after the deploy;
- `licence_all`.

**WATCH**, which blocks an automatic KEEP:

- `descent_fell`: **any** death, or a fall >= 6 with >= 4 hp lost, inside a `sky_descend` run;
- `acted`: any `_sky_descend` row that did something (grounded, progress, stay or stopped). Each is named with its position
  for a human to read.

**HOLD:**

- `runaway`: more than 30 runs by one bot.

**Reported:**

- outcomes;
- `_needs_rescue` by bot and cell;
- blocks placed and ridden;
- fall deaths by arm, under the two-death floor.

### 8.2 Exposure (Codex r1 P10: worded to what was measured)

- **The platform population.** The 12 platform falls and the 4 high episodes that ended in death were all in
  isolated-a/isolated-d. No other platform was seen in the 10 shared-seed worlds' spawn squares, apart from placebo-c's small
  one (cavefall-01 §0.6). Those are three pools that are never drawn (§8.3).
- **What a drawable canary can still meet.** The rule can still fire on drawable pools for:
  - a bot that logs in on its own pillar;
  - a natural spire;
  - a stranded tower bot (board-c-Delta's kind) after a reconnect.

  So a drawable canary is a **no-harm check of exactly those**: the `acted` rows. It is not a measure of the platform
  effect, and its KEEP does not claim one.
- Evidence files:
  - `docs/reports/respawnfall-01-evidence-sky7d.txt`, the episode table, produced by
    `scripts/host/respawnfall/sky7d_pull.py` + `sky7d_episodes.py`;
  - `docs/reports/respawnfall-01-evidence-draw.txt`, the host's drawrequire/drawexposure lines.

### 8.3 Tier

`~/mcai-analysis/drawexposure.py:122` drops isolated-* and placebo-c from the candidates.
`~/mcai-analysis/drawrequire.py` `pick()` returns "required pool %s is never drawable" for them. Both are quoted in the
evidence file.

The coordinator's requirement that isolated-a be in the draw **cannot be met by the scheduler as installed**, and changing
the scheduler is outside this item.

- **Tier 3**, with the no-harm gates.
- **No `draw_require_pools`**, because isolated-a would make the draw refuse forever.
- Owner question Q1 for the isolated rollout.

### 8.4 The header

`scripts/host/respawnfall/rescue_sky.py` (selftested) gives a `needs rescue (respawnfall-01)` line. It lists a bot while its
latest `_sky_descend` row is a stay and it has not moved 2 blocks since. This line is to be merged with ceilescape-01's
`rescue_line.py` when that lands; ceilescape-01 is not on main.

## 9. Review record

| round | Codex | Claude subagent | what changed |
|---|---|---|---|
| design + code r1 (d6b69508) | CHANGES (9 P1, 1 P2) | CHANGES (1 P1, 4 P2, 7 P3) | r2 (16b2e923): done separated from the trigger (Codex P1-2, Claude P3-6); episodes end only on a verified stance (Codex P1-6, Claude P2-2); the lattice/last-resort/watchdog gate (Codex P1-3, Claude P2-4); a free column needs no blocks (P1-4); ranked reachable starts with failed walks excluded (P1-5, Claude P3-10); water under one column (P1-7); truthful stay text, no pickup claim, Q3 (Codex P1-8, Claude P1-1); full-cube supports only (P2-9); diggable supports priced (Claude P2-3); the centre verified (Codex P1-1; Claude showed fullStop snaps); the spawn grace (Claude P2-5); the run inside 140 s (P3-7); vacuous tests replaced (P3-8); G1 any death (P3-11); exposure worded to the measured population with evidence files (Codex P10, Claude P3-12). Claude P3-9 (extract the step_off decision): the gate is now one exported pure predicate, behaviour-tested, asked at two sites |
| design + code r2 (16b2e923) | CHANGES (3 P1, 3 P2) | CHANGES (1 P1, 4 P2, 2 P3) | r3 (1012a88e): the region test in the trigger and done (Claude P1-1, Codex P1-2); lava never a landing (Codex P1-1); water ends an episode and a 60-s transient clock (Codex P1-3, Claude P2-2); the deck walk's liquid plunge off (Claude P2-3); thick decks via the region (Claude P2-4); a grounded landing beside a natural pit (Codex P2-4); slab landings (Codex P2-5); a partial block in the column (Claude P3-7); the stay reason on a partial support (Claude P3-6); Paper deck runs recorded (§7; Codex P2-6, Claude P2-5) |
| design + code r3 (8183bc10 / a58497e4) | CHANGES (3 P1, 2 P2, 1 P3) | CHANGES (2 P1, 1 P2, 2 P3) | r4 (a58497e4, Codex r3): thick decks float (DECK_MAX); leaves never float; a hanging column is not ground; only an airborne body releases on the clock; the lava mutant isolated. r5 (e6455247, Claude r3): the sky-open void test (a cave roof is not a platform); ground = 8 with no deadly run under, or 16 (an aquifer is ground); bodySupport for a body on an edge; a 10-min wait raises _needs_rescue; the flood only inside a window or an episode, stopping at ground; the DECK_MAX bound. Probe on the real 1,118-cell platform: 975/975 stances elevated, 0 falsely done; 2,209 ground samples around it, 0 elevated |
