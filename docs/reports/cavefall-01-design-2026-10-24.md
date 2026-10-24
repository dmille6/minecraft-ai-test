# cavefall-01: gather never digs a floor that has a harmful drop under it (design r3, 2026-10-24)

OWNER 2026-10-24 ~12:30Z: "yes move up cave fall". This is mineshaft-safety O4 (`docs/reports/mineshaft-safety-2026-10-23.md`
§11, approved "as a separate scoped item next"), queued behind lavasight-01. Base: fleet `fb8de72f` (ironsmelt-01, promoted
10-24 08:2xZ; 60 of 80 bots on it at 12:38Z, the other 20 on the townplan-01 canary). Branch `cavefall-on-fb8de72`.

Nothing on the fleet was changed: no bot, queue, scheduler, manifest, env or world. ES was read with the read-only key; the
live files on 10.0.0.31 were read; the 10-24 staged backup was read on 10.0.0.30 through failmine's `fmserve.py` (read-only,
region copies to /tmp). Paper ran only on sandboxes under per-server locks (§7). The context reports named below are on
`main` (`git show origin/main:docs/reports/<name>`); this branch is cut from the deployed sha.

**r2** answered both r1 design reviews (§9): the r1 "step beside it, then dig" executor is gone; the rule is a property of the
TARGET and never walks. **r3** answers the r2 reviews: landing physics corrected (the first stop wins), partial shapes, the
re-ask after the look, gates rebuilt, and **the world-signature evidence withdrawn** (matched controls showed no enrichment):
the fix's share of the falls is unknown.

## 0. Answers first

**Denominator: 96 fall-family deaths of 278 deaths in 7 days** (ES, 10-17 13:00Z to 10-24 13:00Z, 10,516,534 skill docs; the
server's message classifies each one: "fell from a high place" 51, "impaled on a stalagmite" 37, "skewered by a falling
stalactite" 6, "doomed to fall" 2). That is 35% of all deaths. 84 are in caves; 12 are a sky platform (point 6).

1. **What they were doing.** At death: gather 44, explore 21, goto 16, idle 13, mine 1, home 1. **Per hour of the skill:**
   gather 44 per 1,400 gather bot-h (31 per 1,000 h), goto 16 / 678 (24), explore 21 / 950 (22), against 13 idle deaths in
   the ~10,000 bot-h outside those skills (~1.3). In the lead-ups the last gather was for dirt in 45 of 58. In the cave cluster
   under the shared town (x 340-470, z 120-200, y < 45; 47 deaths in 9 worlds): gather 31, explore 8, idle 5, goto 3.
2. **The planner did not plan the fall.** The bot's `_fall_path` record holds the last path the corridor guard accepted. In
   **75 of the 91** deaths with a record that path had **no drop at all**; 13 had a planned drop of 2-5 (inside
   `maxDropDown` 6) and 3 a planned drop beyond it (water landings). The falls are 12-118 blocks. A safer drop limit would not
   touch the 75. (This rules the planner out as the cause; it does not by itself say what the cause was.)
3. **Did they dig their own floor? Not established by any discriminating evidence in the logs or the world.** The code path
   exists (§2) and prior art names it (§3), but every discriminating test came back null:
   - **World signature.** Above 13 of the 67 cave-fall landings inside the region read, the 10-24 backup holds a one-block
     hole in a floor (the column open, at least 3 of 4 neighbours solid at that level). r2 compared that with control cells 3
     blocks away (9 of 169, 5%) and called it a 3.8x enrichment; Claude r2 showed the control was biased (a landing column is
     open up to the bot's height by construction, a control usually is not). **With matched controls -- cave-floor cells 2-8
     blocks away whose open column reaches at least as high as the landing's -- landings 13 of 67 (19%) against matched controls
     38 of 216 (18%):
     no enrichment.**
   - **The reach probe's target** was the cell under the bot's last position in 4 of 35 gather deaths, against 38 of 275
     (13.8%) earlier probes for the same bots: no enrichment.
   isolated-a-Comet's overnight stalagmite death has the hole (y = 30 in a dirt shelf it was gathering on, ledge rows at y 31),
   which is consistent with it and proves nothing alone. **So the share of cave falls this fix can prevent is unknown.** The
   Paper scene (§7) tests whether the base bot does it at all; the canary tests whether it matters.
4. **What the falls are is not established either.** What the logs do and do not say:
   - In 61 of 84 cave deaths the last position logged above the landing is within 1.5 blocks of it horizontally (not a
     discriminator: a walk off an edge lands close too).
   - A block on the active path changed (`_path_reset block_updated`) in the 6 s before the descent in 32 of 84 (38%), against
     13% of 6-s windows 40-170 s earlier for the same bots. mineflayer-pathfinder emits that reset only while a path is active
     (index.js:124, 398-401), so it points at something changing during a walk (a dig-approach dig, a placement, another bot),
     not at gather's own floor dig, which runs with no path.
   - `place_error` (failed scaffold placement, pathfinder #296) is not elevated: 11% vs 10%.
   - The reach probe's chosen target was the cell under the bot's last position in 4 of 35 gather deaths, against 13.8% (38 of
     275) of earlier probes for the same bots: not a discriminator (the probe names a round's front candidate, not each dig).
   - Peaceful worlds: no knockback.
5. **Dripstone is a damage multiplier on the same falls.** Landing on a stalagmite tip deals about twice the fall damage
   (vanilla `PointedDripstoneBlock.fallOn`: `causeFallDamage(distance + 2, 2.0)`, so ceil(2(d - 1)); minecraft.wiki gives
   floor(2d - 1)), lethal from ~11 blocks against 23 onto rock. **25 of the 37 stalagmite deaths fell less than 23 blocks**:
   survivable at full health on plain rock. Gather was running in 20 of the 37. The 6 stalactite deaths are different: 3
   follow a `mine` stair tread cut through the ceiling of a cave (`_mine_stair_step_failed`), which drops the bot and frees the
   stalactites hanging from the block removed.
6. **The respawn loop is a bot-built sky platform, and the falls are real.** isolated-a-Comet's three "fell from a high
   place" deaths of 118, 54 and 87 blocks at 02:01-02:06Z all followed a respawn at **y = 181 or 126** above spawn. The 10-24
   backup of isolated-a holds **340 columns topping at y = 180** (cobblestone, cobbled deepslate, dirt) and **180 at y = 125**,
   **148 of the 441 columns** in the 21x21 square around spawn (355, 147), the `spawnRadius` disc a respawn lands in on the
   highest block of a random column. None of the other 9 shared-seed worlds has it (tops 85-105); placebo-c has a small one
   (32 of 441, y 124-165). The server's message classifies each death as a fall, and the bot's tracker matches the geometry
   (181 - 63 = 118, 126 - 72 = 54, 180 - 93 = 87): **not a tracker artefact**. Rows above y = 110 are dominated by
   `_path_reset block_updated`: the pathfinder bridging on the platform with scaffold blocks, which is how it grows. 12 of the
   96 deaths in the week (isolated-a-Comet 11, isolated-d-Comet 1); ES has isolated-a-Comet above y = 120 on 10-12, 10-16,
   10-17, 10-20 and 10-24. The first of the four overnight deaths, "impaled at (379,7,149)", is point 3's mechanism.
7. **The fix (CF1)**: a cell something can stand on whose removal would drop a body standing on it harmfully -- more than 3
   onto rock, onto a stalagmite tip, into lava, or into the unknown -- is **never a gather target**. Digging it drops the bot
   if it is on it, and drops the item into the cave if it is not, so neither the dig nor the walk to pick the item up can pay.
   It is a candidate filter plus a re-ask before the stance walk and at the dig. It never walks, deletes no pathfinder move,
   and touches no reflex. A short drop onto rock (the ordinary self-dig on a plain) and water are untouched. Rollback
   `CAVEFALL=0`. **Expected size: unknown (point 3).** It removes a deterministic way to die that the code allows and Baritone
   forbids; whether that way is a large part of the 47-84 cave falls a week is exactly what neither the logs nor the world
   could say.
8. **Not in this item, each with an owner question (§5):** the sky platform, the open-column falls, the hazard-map route
   price, a stalagmite-aware drop limit, and `mine`'s stair over a cave ceiling.

## 1. Method, sources, controls

- ES `mcai-skill-agents` through `lib/estelemetry.py` (host copy), 10-17 13:00Z to 10-24 13:00Z: 10,516,534 docs, 80 bots,
  17 rotations (~40-60 rows lost each). Positive control: `_death` 278 here vs failmine's 277 (window 10 h earlier).
- For each fall-family death, every row of the dead bot in [t - 180 s, t + 2 s]. Lava deaths "after falling N blocks" are lava;
  the classifier excludes them (0 of the 96 carry lava).
- Skill bot-hours: the sum of `skill.duration_ms` per skill in the same window (gather 190,915 runs, 1,399.7 bot-h).
- The live files on 10.0.0.31 for the overnight window (790,792 rows, 30 deaths, 11 fall-family), read in write order.
- The 10-24 staged backup on 10.0.0.30 via `fmserve.py region` (r.0.0.mca of the 10 shared-seed worlds), decoded with
  failmine's `Regions` reader, which raises on an absent chunk or section.
- **Controls.** "No drop planned": the same field is non-zero 16 times in the set. The floor-hole signature: the same reader
  and rule at MATCHED cave-floor cells 2-8 blocks away whose open column reaches at least as high as the landing's (216
  readable; r2's unmatched 3-block controls were biased). The block_updated and place_error rates: identical 5.5-s windows. The
  platform's absence in 9 worlds: the same scan that finds it in isolated-a.

## 2. The mechanism in the code (fb8de72f)

- `gatherRun` ranks exposed, safe candidates nearest-first and `probeReachable` moves the first A*-reachable one to the front;
  the probe's goal accepts a stance ON the block (its comment: "approach from above, standing on the block below").
- `collectManually` walks only when `canDigBlock` is false, and `canDigBlock` reaches the block under the feet. Then
  `townTargetPermit`, `isSafeToBreak` (liquids beside, falling blocks and entities above, exclusion areas) and `bot.dig`.
  Nothing on this path reads the column below the target.
- mineflayer-pathfinder digs its own floor only in `getMoveDown`/`getMoveDropDown`, with a landing within `maxDropDown`
  (movements.js `getLandingBlock`). `mine` has its own step-down rule (`mayStepDown`: up to health - 3 blocks onto anything,
  no stalagmite term).

## 3. Prior art (searched 10-24)

- **Baritone**: never breaks the block it stands on unless the cell below is walkable (`MovementDownward`; `breakFromAbove`
  off by default). Issue #3995 ("runs to a position, and digs the block from under its feet, falling, sometimes into lava,
  and dying") is this death; the maintainers' answer is that the rule should make it impossible.
- **mineflayer-pathfinder**: `maxDropDown` bounds planned drops only; #111 (fall-damage cost) was closed pointing at it; #354
  ("disable dig when the block under the bot is gravel... the bot would fall to death") asks for this guard and has none;
  #296 / #181 are failed scaffold placements followed by a fall; #328 dripstone pathing; #31 water landings.
- **Mindcraft** `collectBlock`: candidates filtered by `safeToBreak` only, no under-feet check. **Voyager** disables
  `dontMineUnderFallingBlock`.
- **Taken:** Baritone's rule, stated on the target (a floor needs a walkable landing below it), relaxed to "a fall that does
  no damage", because the 1-3-block self-dig onto rock is how this fleet gets dirt on a plain.

## 4. The design (CF1)

**Rule (`bots/src/cavefall.mjs`, pure; real block objects or literals).** A cell T is a **floor over a drop** when:
1. T is solid (it has a collision shape; a stalagmite counts);
2. something can stand on it: the cell above is open, holds a block that needs T (carpet, snow layer, pressure plate,
   rail, redstone, lily pad), or holds a partial shape a centred body does not meet (an open trapdoor) -- a slab, a block or
   any other solid above is its own floor;
3. the fall a body standing on T would take if T were gone does damage. **Every placement of the 0.6-wide body whose box
   rests on T is tried**: body centres on an 11 x 11 grid from -0.28 to 1.28 (cell-local), edges included (Codex r3 P1: a body
   at x 0.97 misses a fence post that a centred footprint meets). For each placement:
   - the feet are at T's real top within the box (a fence 1.5, a slab 0.5); a carpet, snow layer, rail or pressure plate on T
     goes with T (Codex r3 P2-2);
   - a placement whose box meets any other solid inside its own volume is impossible; one that another cell also holds up at
     the feet does not fall (a body straddling onto a shelf neighbour stays up);
   - otherwise the body falls in every column its box covers and stops at the **first thing any part of it meets** (the highest
     stop): a shape counts only where it overlaps the box's footprint in that column (an open trapdoor's thin wall, a wall
     ladder, a fence post are missed), at its real top; water, lava and an unloaded cell stop it; nothing within 32 is `deep`.
   The **worst placement** is the verdict. Damage: rock ceil(d - 3); stalagmite tip (vertical_direction up, thickness tip)
   ceil(2(d - 1)); water 0; lava, unknown, deep: not survivable. So the lip of a cliff or a shaft (rock under T's own column) is
   kept, the centre of a dirt shelf over a cave is skipped, and a cell no body can stand on (rock above it) is not a floor.

A ceiling block (an ore in a cave roof, rock above it) is never a floor, so the bot under it may still dig it.

**Where it acts (`skills.mjs`).**
- **At enumeration** (Claude r3 P2-1): the same verdict is asked in `findBlocks`' matcher, beside town ground and keep-out, so
  the 32 nearest candidates returned are the nearest that are NOT floors over a drop (otherwise a bot on a shelf gets 32
  shelf cells back, all skipped, and is told there is nothing to gather while ordinary dirt lies just beyond them). A fast
  path keeps that cheap: a full cube directly under T (most candidates are buried) or directly over it decides at once; a
  test proves the fast path changes no verdict.
- **The candidate filter:** `safeTarget` (which already composes town ground, keep-out, `isSafeToBreak` and the iron
  six-face check) starts with `!caveSkip(p)` from `caveFilter(bot)`: one verdict per cell per round, shared by the exposed
  list, the source fallback and the foliage fallback. After both fallbacks the round writes one `_cavefall_skip` row when it
  skipped anything (`own=N nbr=M land=...`: which column decided, so over-refusal is visible).
- **gather's message** when every candidate the round asked about (all lists) is such a floor: "dirt found but all N candidate(s) are floors over a
  drop into a cave (onto stalagmite) -- digging one drops you or the item; gather dirt elsewhere, or explore", failClass
  `no_safe_target`, before the existing water/falling-block message, which in a mixed round now says how many of its
  candidates were floors over a drop.
- **`collectManually`**, the one dig site gather and craft's table retake share: `cavefallDigCheck` before the stance walk
  (no walk is spent on a floor that will not be dug; craft has no candidate filter) and again as the **last word before the
  dig packet**: with CAVEFALL on, every dig takes the shape craft's hook path already had -- an instant `lookAt`, the re-ask,
  then `bot.dig(block, 'ignore')` -- so no await sits between the check and the dig (Codex r2 P2-3). CAVEFALL=0 keeps the
  base's sequence (the library's own look inside `dig`). It throws `no_safe_target` with the remedy first: "floor_dig: dig
  elsewhere -- dirt at 3,29,6 is a floor over a 21.31-block drop onto stalagmite" (gather keeps 120 characters of an error;
  the wording fits craft's caller too). At the dig, a floor dig the bot stands on that is allowed only because its fall is
  short (drop >= 2) or into water writes one `_cavefall_floor allowed` row (the 1-block self-dig on a plain is not logged).

**Remedy chain (CLAUDE.md).**
- *Executable from here:* the remedy is "gather it elsewhere, or explore". The refusal removes one target; it removes no
  move, so wherever the bot stands it can still walk, explore or gather another block.
- *Reachable:* gather excludes a failed target for the run and continues with the next candidate in the same run; only
  when every candidate is such a floor does gather fail, with the message above. A bot that stands on the last floor over a
  cave is not stranded by this rule: it was standing there before the rule, and the rule only takes away the dig that would
  have dropped it.
- *Composed:* reflexes never call `collectManually` (lavastep, poolescape, ceilescape, entombed, the drowning arms,
  homefix's watchdog relocation); keep-out's filter and protectzone's dig veto are independent conjunctions and unchanged;
  town ground is unchanged; the dig approach (gather profile) and mine are untouched. The only new failure is a target
  skipped. It does not erode a shelf or lose items (the r1 executor did both: §9).

**Rows.** `_cavefall_mode` (licence, once per spawn: `on=1 rule=floor_over_drop safe_drop=3 scan=32 ...`); `_cavefall_skip`
(per gather round with a skip: `N of M ... skipped own=A nbr=B land=... front=0|1`); `_cavefall_floor` (`refused` at the dig, `allowed` for a
standing floor dig with drop >= 2 or water). Rollback `CAVEFALL=0`: the mode row says `on=0` and nothing else changes.

**Cost (Codex r4 P3-4).** The enumeration-time verdict runs for every matching cell in range in the sections findBlocks visits,
not for 32: on a dirt plain thousands per round. The fast path makes almost all of them cheap and exact: a full cube over T
(buried cells) is 1 read; a full cube with full cubes under and beside it is 6. Only an exposed floor with an opening under or
beside it pays the full verdict: at most 9 columns x ~35 cells read (cached within the verdict) and 121 placements in memory
(Codex measured 1,024 full shelf verdicts in ~119 ms and 53,248 reads). Out-of-range cells are never judged (the matcher
checks the search radius first, since mineflayer calls it before its own distance test). Whole-search latency on Paper is
recorded in §7.1.

## 5. Not in this item (owner questions)

1. **The sky platform (12 deaths a week, one world).** A bot standing on it has no way down that does not die: the
   pathfinder bridges outward and the bot falls. CF1 removes one route to death (gather digging the platform: the 118-block
   fall) and none of the others. Options: (a) leave it (a death costs a respawn under keepInventory and immediate respawn;
   about a third of isolated-a respawns land on it); (b) a bot-side "descend from a height" skill (a staircase of placed
   blocks, ~110 cobblestone; new behaviour, its own canary); (c) the structure itself is a world question this item may not
   touch. **Recommend (a) now, (b) as a separate item if wanted.** Open: how the first column reached y = 180.
2. **The rest of the cave falls.** Mechanism not established (§0.3-0.4). The failmine cave scenes replayed the fall rows' path
   goals 7 times and the base never fell, so a plain walk is not the reproduction. **Recommend a separate investigation item
   on Paper** (sprinting along 1-wide cave ledges, partial paths ending at an edge, the dig approach), before any fix.
3. **The hazard-map route price.** lavasight-01 delivers cave_fall and dripstone hazards as warn-only centres (its design
   §3.6, `lava-map.json warn`). Their cells are death positions, the **landings** on the cave floor, while the bot walks or
   digs 12-43 blocks above; a price at the landing does not touch the ledge. CF1 needs no map. **Recommend keeping
   lavasight's warn rows as the observation** and revisiting a ledge price after item 2.
4. **A stalagmite-aware drop limit.** 13 of 91 deaths had a planned drop at all. Worth it only after CF1's read.
5. **`mine` over a cave ceiling** (3 stalactite deaths): `mine` owns its step rule.

## 6. Tests (behaviour on exported pure functions; anchored mutants)

`bots/test/cavefall.test.mjs`, 34 cases, on worlds of **real 1.21.8 registry blocks** (`test/helpers/reachlab.mjs`
`mkWorld`), shaped like the cluster: a 3x5 dirt shelf at y 29 off a stone cliff, over a cave floor at y 7 with stalagmite
tips at y 8, or ground, water, lava, unloaded, or nothing.
- cell kinds (only an up tip is a stalagmite; carpet, slab, fence solid; snow layer 1 and grass open; unloaded unknown); the
  damage table; the shelf over the cave (21.3 onto a tip: skipped); over ground (1) and water: kept; lava, unknown, deep:
  skipped; the 3/4 boundary onto rock and a tip under T; the worst-column rule (water under T, rock under the open neighbour);
  standable (carpet and rail above count, a slab does not); carpet on the shelf; a cave-roof ore is not a floor; non-solid
  targets; a throwing reader fails closed; the messages put the remedy first; the rollback.
- r3 additions: the straddle scenarios (water deep under T and rock high beside it -> skipped; a cliff lip and a shaft rim
  -> kept), open and closed trapdoors under and over T, `caveFilter`'s memo and counts across lists, the `allowed` row
  written once in the read's own format (captured through the logger's record tap), `skipDetail`, and the floor removed
  DURING the look (refused by the re-ask after it; dug by the mutant without it).
- The executor on a fake bot: `cavefallDigCheck` refuses with the remedy and passes over ground and water; `on: false` is
  the base. **Wiring by behaviour:** `collectManually` end to end does not dig the shelf cell over the cave and does not walk
  for it; over ground it digs (the base self-dig).
- Mutants (each anchored, present and unique, each turning a named assertion red): both `collectManually` calls removed
  (dug), one removed (still refused: the other holds), a stalagmite read as rock, unknown read as open, the water branch
  removed, the neighbour columns ignored, the carpet rule removed, the standable test removed (a roof ore would be skipped).
  The candidate filter's composition is a structural assertion on the executable line (comments stripped), because
  `gatherRun` does not run on a fake bot; Paper exercises it end to end.

## 7. Paper (sandbox, per-server locks)

`sandbox/cavefall/cavefall-e2e.mjs` (a sandbox branch off main: the driver plus the registry's wired count), the WHOLE bot
(`src/index.mjs`) from a `git archive` of each sha, the model replaced by the sandbox brain answering `gather 4 dirt`. The
arena is built from the measured shape of the cluster at cave depth (shelf y 29, floor y 7); the bot is teleported onto the
shelf's centre with a stone pickaxe, an iron shovel, 16 cobblestone and 8 logs; fleet gamerules; peaceful.
- `cave`: stalagmite tips under the shelf. Base expected to dig its floor and die (the positive control); candidate to skip
  the shelf, collect nothing from it, and live.
- `ground`: the cave filled to y 28. Both must dig the shelf and live: the no-regression control.
- `water`: 2-deep water under the shelf. Both may dig it; both must live.

### 7.1 Results

**PENDING.** Every sandbox5-8 per-server lock was held by other agents for the whole build (sandbox5 by lavastep since 10-23
17:28Z; sandbox6-8 by plugcut-01 from 10-24 12:11Z, with its scenes still running at 15:30Z), and the brief names only those
four. Nothing was run on sandbox..sandbox3. Staged and ready:
- the driver on branch `cavefall-sandbox-1024` @ `46c7d29b` (origin/main + `sandbox/cavefall/cavefall-e2e.mjs` + the registry's
  wired-driver count 20 -> 21; `run-tests.mjs sandbox-registry` passes there);
- the bot roots: `git archive fb8de72f bots` (base) and `git archive 72e1054e bots` (candidate), each with `SHA` and
  `bots/node_modules`.

How to run (from an extract of the sandbox branch, with the lock taken: `sandbox/sbxlock.sh take sandbox6 cavefall "..."`):
```
for scene in cave ground water; do for i in 1 2 3; do
  node sandbox/cavefall/cavefall-e2e.mjs <base root> base-$i $scene sandbox6 4
  node sandbox/cavefall/cavefall-e2e.mjs <cand root> cand-$i $scene sandbox6 4
done; done      # results: $TMPDIR/cavefall-e2e/results.jsonl
```
Admission (both engines, r3-r7): the base must dig its own floor and fall in `cave` in at least 2 of 3 (the positive control);
the candidate must never fall there, dig no shelf cell, and end `no_safe_target` with the all-floors message and a
`_cavefall_skip front=1` row; in `ground` both must dig the shelf and live; in `water` both must live. The result rows carry
gather `duration_ms` (whole-search latency, Codex r4 P3-4). If the base does NOT dig its floor in `cave`, the item stops here
and folds into §5.2.

## 8. Read and registration

`scripts/host/cavefallread.py` (window from the manifest; denominators first; `--selftest` exercises every gate on a fixture
and its control).
- **Licence / arms (BLOCK KEEP):** every canary bot writes `_cavefall_mode on=1`; zero `_cavefall_*` rows on control.
- **G1 (WATCH, blocks an automatic KEEP; a human reviews):** an `allowed` row whose bot stands ON the floor, then a fall
  episode starting within 5 s that lands within 1.5 (x, z) of the column at least 6 and more than the row's drop + 2 below
  the floor's top, measured from the support height (not the tracker's decaying peak).
- **G2 (WATCH, as G1):** after a `refused` row the same bot is seen standing ON the refused cell and then, within 60 s, in its
  column at least 6 below its top: an observed transition through a floor the rule refused (something else removed it).
- G1 and G2 are WATCH, not REVERT (Claude r2 P2-2): an `allowed` dig is the base's dig, and a refused cell removed by
  something else is what the base would have dug itself, so reverting cannot cure either; they say the rule missed.
- **H1 (HOLD):** the canary's share of gather runs ending `no_safe_target` rose by more than 0.10 over the control's change
  (pre vs post). Refusing too much is the harm this change can actually cause. Explore and goto runs per arm are reported
  (a bot pushed off gathering moves more).
- **Exposure:** >= 5 canary rows that are `_cavefall_skip front=1` or `_cavefall_floor refused`, from at least 2 distinct
  bots (Claude r3 P2-2). `front=1` is a PROXY for "the base would have dug it first" (`baseFront`): the skipped cells in the
  border that are exposed and pass the base's own target conjunction (`baseSafe`: town ground, keep-out,
  `isSafeToBreak`/shoreline, iron's six faces) are ranked with the round's kept candidates in the base's two tiers --
  approachable first, then the rest, each by findBlocks' distance from the floored position -- and `front=1` when the head is
  a skipped cell. It does not replay the base's A* reorder (Codex r5 P2-2, r6).
- **Primary (DiD, canary vs control, pre vs post; reported, KEEP does not need it, and it is not expected to move: Claude r2
  P3-10):** gather fall episodes per gather
  bot-hour: `_fall_path` rows (damage or death) with fell >= 12, deduplicated per bot within 10 s, attributed to gather when
  a gather row's interval covers them, excluding those whose feet cell is water. 7-d base: 3,496 gather rows of fell >= 12
  (non-deduplicated) in 1,400 gather bot-h -- most of them the peak tracker summing a walk down plus a planned drop, not
  one fall; a dry run on 10-24 read 4.6-10.5 episodes per gather bot-h by arm and period.
- **No harm (HOLD):** gather success per gather run, canary / control >= 0.43 (immobiledid's line); dirt collected per
  bot-h reported.
- **Reported:** fall-family deaths by cause, canary vs control, under the two-death floor (one is named, not a verdict);
  skips per bot-h; the world signature (§0.3) re-run on the next backup for canary and control cave falls.
- **Draw exposure:** pools with >= 10 `_fall_path` rows "running gather" in the 6 h before the draw.
- **Tier:** `drawexposure.py cavefall-01 --registrations <tmp>` at 13:23Z (6 h, fall_path ~ 'running gather' >= 10): **11 of
  11 drawable pools eligible** (board-a 47, board-b 43, board-c 36, board-d 38, hive-a 78, hive-b 21, hive-c 59, hive-d 53,
  placebo-a 50, placebo-b 17, placebo-d 31), so the 4-pool policy would allow tier 2. **Registered tier 3**: the effect size is
  unknown (§0.3), Paper is pending, and both engines recommended tier 3 (r3-r7). `draw_require_pools` board-c and hive-a, the
  drawable pools with the most cave-fall deaths under the shared town.
- **Registration and entry fragment** (drafts, staged; nothing queued): `~/mcai-analysis/cavefall-01.72e1054e.json` (sha256
  b76c439b...) and `~/mcai-analysis/cavefall-01.queue-entry.draft.json`, which carries a Paper hold and no `approved`, so
  `queue add` refuses it until the Paper record is in. Canary sha `72e1054e` (later commits on the branch are docs only).

## 9. Review record

| round | Codex | Claude subagent | what changed |
|---|---|---|---|
| design r1 | CHANGES (7 P1, 3 P2) | CHANGES (2 P1, 7 P2, 4 P3) | the step-beside executor removed (it lost the item and eroded the shelf, Claude P1-1; unbounded GoalBlock walk, Codex P1-4; abort, P1-5; airborne acceptance, P1-3); the rule moved to the target, with real collision tops, the worst open column (Claude P2-3), carpet/snow support (both), up-tip-only stalagmites (Codex P2-10); the evidence restated (Claude P1-2, Codex P2-9: path_reset needs an active path; the world-hole signature added; Paper pending); remedy-first messages (Codex P1-6); gates rebuilt (Codex P1-7, Claude P2-8); primary population (Claude P2-9) |
| r2 (design + code) | CHANGES (2 P1, 6 P2) | CHANGES (1 P1, 2 P2, 7 P3) | landing physics: the first stop wins, scenarios (centred, straddle) and their worst (Claude P1); partial shapes by footprint, open trapdoors (Codex P1); the re-ask moved after the look (Codex P2-3); `caveFilter` counts after both fallbacks, behaviour-tested (Codex P2-6/8, Claude P3-4); G1/G2 -> WATCH, measured from the support height with an observed transition (Codex P1-2, Claude P2-2), H1 refusal HOLD added; licence roster (Codex P2-7, Claude P3-9); **the world signature withdrawn as evidence (Claude P2-3: matched controls 18% vs 19%)**, expected size now unknown (Codex P2-4); conservative exclusions documented and tested (cliff lip, shaft rim kept; Codex P2-5); skip row split own/nbr (Claude P3-6); mixed message (P3-7); neutral refusal wording (P3-8) |
| r3 (design + code) | CHANGES (1 P1, 4 P2, 1 P3) | **APPROVE** (P2s before launch, 7 P3s) | r4: every body placement over T (11 x 11, edges; Codex P1), departure from T's real top (P2-2), read roster on any build (P2-3), H1 INCONCLUSIVE without denominators (P2-4), route mutants (P2-5), header (P3-6). r5 (Claude's P2s/P3s): the verdict at ENUMERATION with a fast path proven verdict-neutral (P2-1), exposure = front skips + refusals from >= 2 bots (P2-2), withdrawn evidence reworded (P2-3), a CAVEFALL=0 subprocess test of the dig sequence (P3-4), G1 onset rounding (P3-6), H1 floor 100 runs (P3-7), mixed message exposed-only (P3-8), pre-walk-only mutant (P3-9), primary needs >= 4 hp or a death (P3-10); P3-5 is moot (the straddle footprints were replaced) |
| r4 (design + code) | CHANGES (3 P2, 1 P3) | CHANGES (1 P1, 1 P2, 5 P3) | r6: the fast path made exact (full cube over T; or T, the cube under it and all four cardinals full; Codex P2-2); the matcher judges only in-range cells (Codex P2-3, Claude P3-5); a search enumeration emptied is a `no_safe_target` refusal with its row, before gather's early return (Codex P2-1 = Claude P1); `front=1` only for a cell the base would have ranked first (`baseSafe`, exposed, approachable; Codex P2-3, Claude P3-4); cost text (Codex P3-4). r7: ties go to the solid stop (Claude P3-3), the counting-early mutant re-anchored and the emptied-search order asserted (Claude P2-2), the roster from every canary-pool bot seen pre or post (P3-7), H1 text from the constant (P3-6), and **gatherRun behaviour tests** on a fake findBlocks that applies the matcher (all-floors refusal + row; a mixed round digs the nearest non-floor). The full runner caught 5 other suites whose fake gather worlds float dirt over 32+ blocks of air (keepout, keepout-protectzone-compose, protectzone, townground, toolfor-spent): their fixtures now put rock under the dirt, and townground's mutant anchor moved to `baseSafe` |
| r5 (design + code) | CHANGES (2 P2) | CHANGES (1 P2, 6 P3; APPROVE once r8 + the approachable tier) | r8: the boxed-in fast path is bypassed when T carries a carpet or snow layer (Codex P2-1, with its case in the equivalence test); `baseSafe` hoisted so every exposure measure asks the base's own conjunction (Codex P2-2). r9: one `baseFront` measure for every round, ranking skipped and kept candidates in the base's two tiers (approachable first, then nearest; Claude P2/P3-2); the emptied search no longer has its own branch -- it goes on through the round's count and the all-floors refusal like every other round, so a later round (`collected > 0`) writes its row too (P3-5); only skips inside the border count (P3-3); the all-floors message keeps the town-ground and below-ground hints (P3-4); the read's roster wording (P3-7) |
| r6 (confirmation) | CHANGES (1 P2, 1 P3) | **APPROVE** (eac08e5f; 5 P3s) | r10: `baseFront` ranks within a tier by findBlocks' own distance (block coordinates from the floored position; Codex P2, with its counterexample as a test) and the exposure text says so (P3). r11 (Claude's P3s): a fallback's candidates are not ranked against the base's main-block floors, and only cells of the asked type count (P3-1); an emptied round does not repeat the first fallback's searches (P3-2); behaviour tests for a later emptied round's row and for `front=0` when the base itself refuses the floors (P3-3); the skip row's denominator counts in-border cells only (P3-4); the stale comment (P3-5, r10). The r5 P3-6 "dead clause" became live again in r9 (the emptied search reaches it) |
| r7 (confirmation) | **APPROVE** (b819ceae) | **APPROVE** (b819ceae) | no findings; one optional P3 (the later-round test never reaches gather's `collected > 0` return because the fake bag never grows) noted |
| r8 (confirmation) | **APPROVE** (72e1054e) | -- | r12 restores the line `if (reachable.length === 0 && !viaSource)` that drops.test.mjs asserts (the full runner caught it); the emptied-round source skip moved inside the loop's iterable: behaviour identical |

## 10. Questions for the reviewers (r3)

- **R1.** The straddle scenarios and footprints: right, and is anything legitimate still lost?
- **R2.** The forced look before every gather dig (CAVEFALL on): any behaviour risk beside craft's existing use of it?
- **R3.** With no discriminating evidence for the mechanism, is a canary justified once Paper shows the base does it (tier 3,
  effect INCONCLUSIVE expected), or should this wait for item §5.2?
