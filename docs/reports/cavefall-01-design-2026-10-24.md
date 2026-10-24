# cavefall-01: gather never digs the block it stands on over a harmful drop (design r1, 2026-10-24)

OWNER 2026-10-24 ~12:30Z: "yes move up cave fall". This is mineshaft-safety O4 (`docs/reports/mineshaft-safety-2026-10-23.md`
§11, approved "as a separate scoped item next"), queued behind lavasight-01. Base: fleet `fb8de72f` (ironsmelt-01, promoted
10-24 08:2xZ; 60 of 80 bots on it at 12:38Z, the other 20 on the townplan-01 canary). Branch `cavefall-on-fb8de72`.

Nothing on the fleet was changed: no bot, queue, scheduler, manifest, env or world. ES was read with the read-only key; the
live files on 10.0.0.31 were read; the 10-24 staged backup was read on 10.0.0.30 through failmine's `fmserve.py` (read-only,
region copies to /tmp). Paper ran only on sandboxes under per-server locks (§7).

## 0. Answers first

**Denominator: 96 fall-family deaths of 278 deaths in 7 days** (ES, 10-17 13:00Z to 10-24 13:00Z, 10,516,534 skill docs; the
server's message classifies each one: "fell from a high place" 51, "impaled on a stalagmite" 37, "skewered by a falling
stalactite" 6, "doomed to fall" 2). That is 35% of all deaths. 84 of them are in caves; 12 are a different thing (point 5).

1. **What they were doing.** At death: gather 44 (dirt in most), explore 21, goto 16, idle 13, mine 1, home 1. In the cave
   cluster under the shared town (x 340-470, z 120-200, y < 45; 47 deaths in 9 worlds): gather 31, explore 8, idle 5, goto 3.
2. **The planner did not plan the fall.** The bot's own `_fall_path` record holds the last path the corridor guard accepted.
   In **75 of the 91** deaths with a record that path had **no drop at all** (max step down 0); 13 had a planned drop of 2-5
   (inside `maxDropDown` 6), and 3 had a planned drop beyond the limit (water landings, `infiniteLiquidDropdownDistance`).
   The deaths are falls of 12-118 blocks. So `maxDropDown` is not the lever: a safer drop limit would not touch 75 of 91.
3. **Vertical falls, not walks off an edge.** In 61 of the 84 cave deaths the last position logged clearly above the landing
   is within 1.5 blocks horizontally of it; 17 are 1.5-4 blocks away and 6 further. Knockback is excluded: every world is
   peaceful.
4. **Dug into, not walked into.** A block on the bot's own path changed (`_path_reset block_updated`) in the 6 s before the
   descent in **32 of 84 (38%)**, against **13% (199 of 1,486)** of 7.5-s windows 40-170 s before death for the same bots (a
   2.9x excess). `place_error` (a failed scaffold placement, mineflayer-pathfinder #296) is NOT elevated: 11% vs 10%. The
   code says why: gather digs the **nearest** candidate, its reach goal accepts **standing on** the block (GoalGetToBlock's
   vertical adjacency, skills.mjs gather), `canDigBlock` reaches 4 down, and nothing between the candidate filter and
   `bot.dig` asks what is under the target (`isSafeToBreak` asks only about liquids beside it and falling blocks above). On
   a dirt shelf over a cave, the first target is the shelf cell under the feet. **This is reproduced on Paper: §7.**
5. **The respawn loop is a bot-built sky platform, and the falls are real.** isolated-a-Comet's 3 "fell from a high place"
   deaths of 118, 54 and 87 blocks at 02:01-02:06Z all followed a respawn at **y = 181 or 126** above spawn. The 10-24
   backup of isolated-a holds a structure there: **340 columns topping at y = 180** (cobblestone, cobbled deepslate, dirt)
   and **180 at y = 125**, covering **148 of the 441 columns** in the 21x21 square around spawn (355, 147) -- the
   `spawnRadius` disc a respawn lands in, on the highest block of a random column. None of the other 9 shared-seed worlds
   has it (tops 85-105); placebo-c has a small one (32 of 441 columns, y 124-165). The server's message classifies each
   death as a fall, and the bot's tracker matches the geometry (181 - 63 = 118, 126 - 72 = 54, 180 - 93 = 87): **not a
   tracker artefact**. The rows above y = 110 are dominated by `_path_reset block_updated` (the pathfinder bridging on the
   platform with scaffold blocks: that is how it grows). 12 of the 96 deaths in the week are this (isolated-a-Comet 11,
   isolated-d-Comet 1); ES has isolated-a-Comet above y = 120 on 10-12, 10-16, 10-17, 10-20 and 10-24. The first of the
   four overnight deaths, "impaled at (379,7,149)", is the cave mechanism: `gather dirt` at y 31-36, then a 23-block fall
   onto a stalagmite.
6. **Dripstone is a damage multiplier on the same falls.** Landing on a stalagmite deals about twice the fall damage
   (minecraft.wiki: floor(2 x distance - 1)), lethal from ~11 blocks against 23 onto stone. **25 of the 37 stalagmite deaths
   fell less than 23 blocks**, so they would have been survivable at full health on plain rock; the shortest was 12. Gather
   was running in 20 of the 37. The 6 stalactite deaths are different: 3 of them follow a `mine` stair tread cut into the
   ceiling of a cave (`_mine_stair_step_failed`: "dug the tread ... but ended 9 below"), which drops the bot and frees the
   stalactites hanging from the block it removed.
7. **The fix (CF1)**, small and composed: at gather's one dig site (`collectManually`), a dig of the block that is the
   bot's **only** support is allowed only when the fall it causes does no damage (a solid floor within 3 blocks, or water at
   any depth). Otherwise the bot first **walks one block to a stance beside the target** and digs it from there (a side
   dig); only when no stance beside it can be reached does the candidate get skipped, naming the remedy. It deletes no
   move, refuses no skill, and never applies to a reflex. Rollback `CAVEFALL=0`.
8. **Not in this item, each with its evidence and an owner question (§5):** the sky platform (needs a descent the bot can
   perform, or a decision about the structure), the hazard-map route price (the map's cave-fall cells are landings, not the
   ledges the bots dig), a stalagmite-aware drop limit (13 of 91 planned a drop at all), `mine`'s stair over a cave
   ceiling (3 deaths).

## 1. Method, sources, controls

- ES `mcai-skill-agents` through `lib/estelemetry.py` (host copy), 10-17 13:00Z to 10-24 13:00Z: 10,516,534 docs, 80 bots,
  17 rotations (~40-60 rows lost each). Positive control: `_death` 278 here vs failmine's 277 (window 10 h earlier).
- For each fall-family death, every row of the dead bot in [t - 180 s, t + 2 s] (minus 9 high-volume diagnostic kinds).
  Lava deaths "after falling N blocks" are lava, not falls; the classifier excludes them (0 of the 96 carry lava).
- The live files on 10.0.0.31 for the overnight window (790,792 rows, 30 deaths, 11 fall-family), read in WRITE order, so a
  skill row sits where the skill ended.
- The 10-24 staged backup on 10.0.0.30 via `fmserve.py region` (r.0.0.mca of the 10 shared-seed worlds), decoded with
  failmine's `Regions` reader, which raises on any absent chunk or section.
- **Controls for each negative:** "no drop planned" is read from a field that is non-zero 16 times in the same set;
  `place_error` "not elevated" uses the same window that finds `block_updated` elevated; the platform's absence in 9
  worlds uses the same scan that finds it in isolated-a.

## 2. The mechanism in the code (fb8de72f)

- `gatherRun` ranks exposed, safe candidates nearest-first; `probeReachable` moves the first A*-reachable one to the front.
  Its goal accepts a stance ON the block. `collectManually` walks only when `canDigBlock` is false, and `canDigBlock` is true
  for the block under the feet. Then `townTargetPermit`, `isSafeToBreak` (liquid/falling-block/exclusion only) and `bot.dig`.
- mineflayer-pathfinder plans a dig of its own floor only in `getMoveDown`/`getMoveDropDown`, and only with a landing within
  `maxDropDown` (movements.js `getLandingBlock`): the planner is not the digger here, gather is.
- Nothing else in the dig path reads the column below the target. `mine` has its own step-down rule (`mayStepDown`, up to
  health - 6 + 3 blocks, which also does not know stalagmites: §5.4).

## 3. Prior art (searched 10-24)

- **Baritone**: never breaks the block it stands on unless the cell below is walkable (`MovementDownward` costs a dig down
  as infinite without a walkable floor at y - 2); `breakFromAbove` is off by default. Issue #3995 ("runs to a position, and
  digs the block from under its feet, falling") is this death, and the maintainers' answer is that the rule should make it
  impossible. `MineProcess` and `BuilderProcess` keep it.
- **mineflayer-pathfinder**: `maxDropDown` (default 4; this fleet 6 walk/gather, 8 descent) bounds planned drops only;
  #111 ("let us decide up to which health we want him to fall") was closed pointing at maxDropDown; #354 (dig under the bot
  onto gravel) asks for exactly this guard and has none; #296 / #181 (failed scaffold placement, then a fall) are the
  bridging failure; #328 is dripstone pathing; #31 water landings. No fix for any of them upstream.
- **Mindcraft** `collectBlock`/`breakBlockAt`: no under-feet check (it uses `safeToBreak` only). **Voyager** disables
  `dontMineUnderFallingBlock`.
- **Taken:** Baritone's rule (a floor dig needs a walkable landing), relaxed to "a fall that does no damage" because a
  1-3-block self-dig onto rock is how this fleet gets dirt on a plain, and refusing it would change every gather.

## 4. The design (CF1)

**Pure rule (`bots/src/cavefall.mjs`).**
- `supportCells(pos)`: the cells of the support layer (`ceil(feet.y) - 1`) under the 0.6-wide box: 1, 2 or 4.
- A dig of T is a **floor dig** when T is one of them, T is solid (a stalagmite counts as a floor), and **no other** support
  cell is solid. A straddling bot keeps its other support, so that dig is not a floor dig.
- `dropBelow(T)`: reads down from T.y - 1 for 32 cells: open cells continue; the first water cell is a water landing; the
  first solid (stalagmite, lava, or an unloaded cell, which is never assumed open) ends the scan; nothing within 32 is `deep`.
- `fallDamage`: solid max(0, drop - 3); stalagmite floor(2 x drop - 1); water 0; lava, unknown, deep: infinite.
- Allowed iff damage < 1. So: over rock within 3, always (the base); over water, always (swimming is travel); otherwise not.
- `sideStances`: the 8 cells around the feet at feet height, cardinals first: open feet and head, a solid floor that is not
  T and not a stalagmite, no corner cut through a wall, and T within 4.5 of the stance's eye.

**Executor (`skills.mjs cavefallFloorGuard`, called once, in `collectManually`, before the town and safety re-asks).**
1. Not a floor dig, or allowed: return (an allowed floor dig writes `_cavefall_floor allowed`).
2. Otherwise, for up to 3 stances: a one-block `GoalBlock` walk on the travel profile (6 s), then **re-judge from where the
   bot actually stands**; the first stance from which it is no longer a floor dig, and T is still in reach, wins
   (`_cavefall_floor stepped`). The town and safety re-asks then run against that stance.
3. None: `_cavefall_floor refused` and throw `no_safe_target`: "floor_dig: dirt at x,y,z is the only block under the bot
   and below it is a 21-block drop onto stalagmite; there is no stance beside it to dig it from -- walk off it onto solid
   ground first (goto a cell beside it), or gather dirt somewhere else". gather already excludes a failed target for the rest
   of the run and moves on to the next candidate.

**Why this is the right size.** It changes one decision at one call site, keeps every base dig that cannot hurt, turns the
harmful one into the same dig from one block away, and refuses only what has no stance at all. It deletes no pathfinder
move and adds no price, so it cannot make a goal unreachable or a bot immobile.

**Remedy chain (CLAUDE.md "a refusal must name a remedy the bot can perform from where it is").**
- *Executable from here:* the remedy is performed, not advised: the step beside is the guard's own walk. The refusal fires
  only when no adjacent stance exists or none could be walked to.
- *Reachable:* a refusal excludes one candidate; gather continues with the others in the same run; the model's next
  decision is unconstrained (goto/explore/another block). A bot whose only footing is a lone 1x1 dirt cell over a void has
  no legal move whether or not this guard exists (it is stuck by geometry, and the existing marooned/entombed rungs own
  that), and the guard does not remove its one move -- it removes the death.
- *Composed:* reflexes never call `collectManually` (lavastep, poolescape, ceilescape, entombed, the drowning arms, homefix's
  watchdog); keepout's gather filter and protectzone's dig veto act before and are unchanged; the step walk is an ordinary
  travel-profile walk, so keepout's step price, the death-site price, lavasight's price (when it lands) and the corridor
  guard all apply to it; town ground re-asks after the step. Tested as a chain in §6.

**Rows.** `_cavefall_mode` (licence, once per spawn: `on=1 safe_drop=3 scan=32 stalagmite=2x water=allow ...`);
`_cavefall_floor` (one per floor-dig decision: `allowed` | `stepped` | `stepped_out_of_reach` | `refused`, with the target,
drop, landing, damage and stance). No row for a dig that is not a floor dig. Rollback: `CAVEFALL=0` (mode row `on=0`, no
other row, the base exactly).

## 5. Not in this item (owner questions)

1. **The sky platform (12 deaths a week, one world).** A bot standing on it has no legal way down that does not die: the
   pathfinder bridges outward and the bot eventually falls. CF1 removes one of its routes to death (gather digging the
   platform: the 118-block fall), and none of the others. Options: (a) leave it (a death costs a respawn under
   keepInventory and immediate respawn; 34% of isolated-a respawns land on it); (b) a bot-side "descend from height" skill
   (a staircase of placed blocks, ~110 cobblestone; a new behaviour, its own canary); (c) the owner decides the structure
   itself, which is a world question this item may not touch. **Recommend (a) now and (b) as a separate item if the owner
   wants it.** Also open: how the first column reached y = 180 (no bot rows above y = 98 in the last 12 h except Comet's).
2. **The hazard-map route price.** lavasight-01 delivers drowning, cave_fall and dripstone hazards as warn-only centres
   (its design §3.6, `lava-map.json warn`). A cave_fall hazard's cells are death positions, i.e. the **landing** on the cave
   floor, while the bot stands on a ledge 12-43 blocks above it; a price at the landing does not touch the ledge walk.
   CF1 needs no map. **Recommend: keep lavasight's warn rows as the observation** (they will say how often planned routes
   pass over a cave-fall cluster) and revisit a ledge price only if CF1 leaves the gather share of falls in place.
3. **A stalagmite-aware drop limit.** 13 of 91 deaths had a planned drop, all within maxDropDown. Pricing a planned drop
   onto pointed dripstone means wrapping `getLandingBlock` in the walk profile. Worth doing only after CF1's read.
4. **`mine` over a cave ceiling** (`mayStepDown` allows up to health - 3 blocks onto anything; 3 stalactite deaths). Its
   own item: `mine` owns its step rule.

## 6. Tests (behaviour on exported pure functions; anchored mutants)

`bots/test/cavefall.test.mjs`, 30 cases, on synthetic worlds shaped like the cluster (a 3x5 dirt shelf at y 29 off a stone
cliff, over a cave floor at y 7 with stalagmites at y 8, or ground, water, lava, unloaded, or nothing):
- the support layer and box (1/2/4 cells); cell kinds (unloaded is unknown, never open); the drop (21 onto a stalagmite;
  1 onto stone; water; lava; unknown; deep); the damage table; the verdict for every landing; a straddling bot; the shelf
  edge; a throwing reader; the stances (order, no target column, no floorless or stalagmite floor, no headroom, a lone cell
  has none); the refusal text names the remedy; the rollback.
- **The executor** on a fake bot whose pathfinder moves it or does not: walks to the first stance and re-judges; no stance
  -> `no_safe_target` with no walk; unwalkable stances tried (3) then refused; out-of-reach stance rejected; ground, water
  and side digs untouched; `on: false` is the base; an abort is an abort.
- **Wiring by behaviour:** `collectManually` end to end on the fake bot digs the shelf cell from beside it over the cave and
  from on top over ground; with the one guard call removed (anchored mutant) it digs standing on it.
- Mutants: other-support ignored; stalagmite as stone; unknown as open; water branch removed; target column as a stance;
  re-judgement skipped; the guard call removed.
- The full `npm test` and eslint no-undef (§9).

## 7. Paper (sandbox, per-server locks)

`sandbox/cavefall/cavefall-e2e.mjs` (on a sandbox branch off main, registry wired count +1), the WHOLE bot (`src/index.mjs`)
from a `git archive` of each sha, the model replaced by the sandbox brain answering `gather 4 dirt`. The arena is built
from the measured shape of the cluster, kept at cave depth (shelf y 29, floor y 7); the bot is teleported onto the shelf's
centre with a stone pickaxe, an iron shovel, 16 cobblestone and 8 logs; fleet gamerules and peaceful.
- `cave`: stalagmites under the shelf. **Base expected to die, candidate to collect and live.**
- `ground`: the cave filled to y 28 (a 1-block floor dig). Both must collect and live, and the candidate writes `allowed`.
- `water`: 3-deep water under the shelf. Both must live (the candidate allows the floor dig into water).
Results: §7.1 (filled in after the runs).

## 8. Read and registration

- **Licence and arms:** every canary bot writes `_cavefall_mode on=1`; zero `_cavefall_*` rows on control.
- **G1 (defect, REVERT):** a canary fall (a `_fall_path` row, fell >= 4) within 10 s after a `_cavefall_floor stepped` or
  `allowed` row of the same bot whose landing was not water: the guard let a harmful floor dig through.
- **G2 (defect, REVERT):** a `_cavefall_floor allowed` row whose own drop/landing fields compute to damage >= 1 (recomputed
  in the read from the row's fields with the same table).
- **Exposure:** >= 5 canary `_cavefall_floor` rows with decision stepped or refused.
- **Primary (DiD, canary vs control, pre vs post):** `_fall_path` rows with fell >= 12 while running gather, per bot-hour.
  7-d base rate: 3,496 such rows / 13,440 bot-h = 0.26 per bot-h fleet-wide, so a 20-bot canary sees ~16 in 3 h.
- **Reported:** fall-family deaths by cause, canary vs control (the two-death floor; one is named, not a verdict); gather
  success per bot-h and dirt collected per bot-h (no-harm: < 0.43 of control is HOLD, as immobiledid); refusals per bot-h.
- **Draw exposure:** pools with >= 10 `_fall_path` rows "running gather" in the 6 h before the draw.
- **Tier** from `drawexposure.py cavefall-01 --registrations <tmp>` under the 4-pool policy (§9).

## 9. Results, reviews

(filled in as they land)

## 10. Questions for the reviewers

- **R1.** Is "damage < 1" the right line (refuse a 4-block self-dig onto rock), or should the line be survivability at the
  bot's health (the `mine` rule)? I chose damage because the remedy (step beside) is cheap and certain.
- **R2.** The executor walks on the travel profile with a 6-s cap and re-judges. Any composition I missed (protectzone's
  place/break, keepout scope, the runner's reservation, lavastep's runner reservation)?
- **R3.** Is the 2.9x block_updated excess plus the code path enough to call the mechanism, given the Paper scene?
- **R4.** Sky platform: agree it is out of scope here?
- **R5.** The primary metric (gather falls >= 12 per bot-h): right population, or should it be all falls >= 12?
