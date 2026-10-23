# board-a-Comet: one bot, one trap, under copper (2026-10-23, investigation only, r4)

This is the owner's named exception to the 09-30 no-stuck-hunts rule, following the production report's §8 finding that board-a
logs about 23 h/day of "no air route" holds. It covers one bot and one trap. Nothing was changed: no code, no world edits, no
teleports, no RCON and no restarts.

**Sources:**
- read-only ES (estelemetry, `nice -n 19`);
- a read-only copy of the region file `/srv/block2/board-a/world/region/r.0.0.mca` from 10.0.0.30; chunk (22,11) was last saved
  18:45:07Z;
- the bot code on origin/main (fleet 6e1afb52).

Scripts and outputs are in `boarda-comet-2026-10-23/`. `q1-q9.py` are the ES queries, `anvil_read.py`/`compact.py`/`probe.py` the
region reader, `geometry-r00-1845Z.txt` the block map, and `spotcheck.txt` the coordinator's independent spot-check.

## 1. The bot

- **Which bot: board-a-Comet.** Over 10-08 → 10-23 it wrote 4,011 of board-a's 4,018 `_water_no_air_route` rows (Delta 4, Bravo 2,
  Echo 1). Positive control: all five board-a bots log 265k-281k documents in the window.
- **Its share of the holds.** Over 7 days it accounts for 162.3 of the fleet's 164.1 bot-h of no-air-route holds (23.2 h/day), level
  every day.
- **It has not moved.** Its position stays in x 359.3-359.7, y 39.0-40.2, z 186.5-187.7 on every day from 10-08 to 10-23
  (spot-check, 8.8k-15.4k positioned rows a day).
  - That is the cell (359, 40, 187): 4 blocks east, 40 blocks south and **33 blocks below** home (355, 73, 147).
  - Positive control: the other four board-a bots range over 90-250 blocks.
- **When it arrived:** about 09-28 04:00Z. It cut one step east at 15:05Z, then has bobbed at y = 40.2 since about 16:30Z: **about
  25 days.** ES before 10-07 is not reconciled, so the start is approximate.
- **What it does there.**
  - It has not died since 10-08 (the fleet had 616 deaths in that time).
  - It runs the current build: 6e1afb52, and it logged `_poolescape_mode` today.
- **This is the chronic `no_safe_target` emitter.** It is the fleet's top emitter: 1,177 in 7 days, about 168/day, mostly oak
  logs beside water (in the last 24 h, 172 of 185 were logs and 13 sand). It is also why board-a carries 23.5 h/day of exposure in the production report's BASE.
- **Bag, 20:59Z:**
  - health 20, hunger 20;
  - one wooden pickaxe (21/59 used);
  - 3 placeable blocks as the reflexes count them (2 cobblestone, 1 dirt), plus 7 crafting tables, 4 glass and 2 ladders that the
    count leaves out;
  - no logs and 1 stick, so it cannot make a stone pickaxe.

## 2. The geometry (copy of r.0.0.mca, 18:45Z save)

The bot's column (359, y, 187):

| y | block |
|---|---|
| 44-46 | air (open to the cave) |
| 43 | copper_ore |
| 42 | **copper_ore (the ceiling)** |
| 41 | flowing water, level 2 (head) |
| 40 | falling water (feet) |
| 39 | falling water |
| 38 | stone |

- **The water.** There is no source within 3 blocks. The cascade is fed from sources about 10 blocks up to the north-west.
- **Neighbours, feet (y 40):** N falling water, S stone, W flowing water, **E (360,40,187) dirt**.
- **Neighbours, head (y 41):** N flowing water, S dirt, W dirt, **E (360,41,187) a ladder** (not waterlogged).
- **Beyond the east side.** (361, 40..41, 187) is dry air on stone. A flood fill of dry open cells from there covers about 7,000
  cells and reaches open sky at (352, 61, 171).
- **One dig of dirt leads to dry cave.**
- **How it breathes (inferred).** This comes from the vanilla eye-in-water rule, not from a measurement.
  - Floating against the copper puts the eye at about y 41.82, just above the level-2 surface (about 41.67), so the bot breathes.
  - Its air reads 16-19/20, and drops to 5/20 when it sinks, which gives 5 drowning-rescue rows a day.
  - The margin is about 0.15 block (41.82 − 41.67). That is inferred; neither the region copy nor the ES rows measure the live
    margin.

The full 11-layer map is `geometry-r00-1845Z.txt`.

## 3. Why every rung fails or never fires

This is the CLAUDE.md pattern: individually correct guards meeting where the bot has no legal move.
- Every rung that runs and DIGS attempts the **vertical** exit through copper. None of the budgets observed affords it: the 60 s
  ramp, the 120 s surface skill, and the 67-160 s float dig.
- The other rungs never run (marooned, poolescape) or refuse on other grounds (pillar, lattice, drowning rescue, mine, gather).
- The one cheap **lateral** dig is refused by the pathfinder's flood rule.
The ramp already has a sidestep that would take it, but that sidestep is only reachable after a flood refusal.

| rung | what happens to Comet | evidence (last 24 h) |
|---|---|---|
| marooned arm (poolescape is hooked here) | never runs: the cell above the head is not passable (copper), so `maroonState` → 'none' (`reflex.mjs:2621`, `:2639`) | 0 `_marooned` rows from it in 15 days; 5,869 fleet-wide in 24 h on 75 bots |
| poolescape (10-23) | never admitted: `wading` (`poolescape.mjs:66-70`) needs a head cell breathable by its own predicate (`poolescape.mjs:40-41`), and level-2 water is not; it also needs open room above | 0 `_poolescape_start`; 3 on board-d since deploy |
| entombed → pillar | refused: a 4-block climb with 3 counted blocks (`reflex.mjs:5500-5511`; `:3476` does not count tables or glass) | 624 `_entombed`, 624 `_maroon_climb_refused` |
| entombed → escape ramp | the 60 s budget (`:4468`) admits the copper because it prices it at a bare hand **on the ground** (15 s, under the 30 s cap). Under water and off the ground it is 375 s (bare hand: the ramp empties its hand first, `:4594`, `:4724`), so the dig times out (`:4543-4556`) and the ramp stops (`:4730`). The sideways fallback (`:4670-4716`) is wired only to a flood refusal. | 154 failed `_entombed_ramp_cut` (`q5.json`): **122** "ceiling dig failed on copper_ore: dig exceeded 60000ms", 31 "Digging aborted", 1 drowning-rescue yield; steps=0 |
| `surface`, watchdog levels 0 and 3-10 | dig the same copper with a 120 s limit | 169 "no altitude gained … dig exceeded 114956ms" |
| goto float dig | prices the copper at 187.5-375 s and aborts it at 67-160 s | 18 `_goto_float_dig` failed |
| pathfinder (goto, watchdog relocate/home, livelock relocation) | the one cheap exit is the east dirt. `dontCreateFlow` refuses breaking it because its west face is liquid: `safeToBreak` in the pinned mineflayer-pathfinder 2.4.5 (upstream `lib/movements.js` about lines 234-244; set at `index.mjs:693/763/855`). In the reconstructed geometry that refusal is SUFFICIENT; it is not shown to be the cause of every recorded `noPath` | 5,848 `_path_noPath`; "no route out of here even with digging allowed"; `_relocate_landed` failed WET ×40 |
| stranded lattice (ride_floor_down) | the block underfoot is water (`skills.mjs:15133`) | 28 "placed 0, nothing underfoot to stand on" |
| drowning rescue (when it sinks) | air pocket: "needs 59250 ms, budget 32000 ms"; flooded-pocket rung: "need 9 placeable, have 3" | 5 each |
| `mine` | the exit reserve refuses ("3 scaffold blocks against a 23-block climb out") | 12 |
| gather | targets beside water | 185 `no_safe_target`: 172 oak-log refusals and 13 sand refusals |

## 4. Proposed fix: a DESIGN BRIEF for the build (not built; the build gets its own both-engine review)

The change is in `escapeStairUp` (`reflex.mjs`), on the entombed arm Comet already reaches. Two Codex rounds each found a further
composition hazard, so this section is a list of REQUIREMENTS the build must meet and test. It is not a finished design.

1. **Price the ceiling as the actuator will dig it.**
   - The ramp empties its hand before ceiling and sidestep digs (`reflex.mjs:4594`, `:4724`), so the price is bare hand, in water
     and off the ground when the bot is so. For Comet that is copper 375 s.
   - The same doubly-penalised price applies to the east dirt: about **18.75 s** (0.75 s × 5 × 5). r1 said 3.75 s, which carries
     only one penalty.
2. **When the ceiling is unaffordable, choose a lateral bearing by its whole cost, or none.**
   - Evaluate every bearing `chooseFloodSidestep` would accept (`scaffold.mjs:838-879`). It picks the first geometric fit today, so
     it needs ranking.
   - For each bearing, sum: its digs at the same environmental price, the 300 ms flow wait, the settle and move, and the dig of its
     NEW ceiling.
   - Take the cheapest bearing that fits the remaining budget.
   - **If no bearing fits, the outcome is an UNRESOLVED ESCALATION, not a remedy.** The brief does not claim that an in-world remedy
     exists or is absent.
     - Log a named refusal ("no affordable ramp exit: ceiling Xs, best bearing Ys").
     - Back off the ramp for that cell for up to 30 minutes, to stop the 60 s swing loop and the entombed → material-prerequisite →
       unreachable-gather loop (`reflex.mjs:3221` onward). The backoff is CANCELLED as soon as anything that sets the price changes:
       position, onGround, eye-cell water, or the held tools and inventory.
     - Raise a world-facts "stuck: needs rescue" flag with the cell, surfaced in the fleetstatus header, for a human or the overseer.
     - CLAUDE.md requires a refusal to name a remedy the bot can perform. This branch names none; it escalates. The owner should read
       it as "this bot still needs help", not as a fix.
   - **A tool-using variant is a SEPARATE design question.** With a stone pickaxe the copper would cost about 28 s under both
     penalties, but the ramp empties its hand (`reflex.mjs:4594`, `:4724`), so that price is not reachable by this ramp. Letting the
     ramp hold a stone-or-better pickaxe for an unaffordable ceiling changes a standing invariant, and needs its own design and
     review. It is not part of this brief.
   - **Repricing waits for the state to settle, bounded by time.** Any bot whose price depends on a changing state (airborne,
     sinking, rising, or an eye cell going wet or dry) is re-priced once that state is stable: the same onGround and eye-water on
     two samples 1 s apart, up to 5 s.
     - Only a bot still unaffordable after that takes the lateral branch.
     - A submerged bot can settle onto a floor, or rise until its eye cell is dry. Bare-hand stone falls from about 187.5 s (both
       penalties) to 37.5 s (one), which may fit, so it is not priced "at once" either.
     - Comet floats in a stable state, so its price does not change.
3. **Keep the height through the dig, and replan after any vertical move.**
   - In water the bot sinks while it digs: the evidence records y 39.0 as well as 40.2. The east tread is the dirt at y 39, so the
     move onto it is a rise, which `takeSidestep`'s forward-only move (`reflex.mjs:4618`) cannot make once the start position
     (`:4595`) has gone stale.
   - The manoeuvre holds jump (swim up) during the dig. Drowning ownership stays with the air reflex: the ramp yields to it if air
     falls below its threshold.
   - After the dig it re-reads the bot's position. If it has dropped, it re-plans the bearing from the new cell.
   - It moves with forward + jump to step up onto the tread. The arrival height check (`:4632`) is evaluated against the replanned
     target, not the stale one.
4. **Make "submerged start" consistent through planning, both rechecks and arrival.**
   - `takeSidestep` re-runs `floodSidestep` twice before it moves (`reflex.mjs:4607-4617`), and that planner rejects water in the
     destination feet cell unconditionally (`scaffold.mjs:849`).
   - When the bot STARTED submerged, all three checks accept water in the feet cell: the plan, both rechecks, and arrival (the
     arrival check that r1 named).
   - The other conditions stay: a breathable head cell, solid footing, no lava in or beside the path, and body ownership.
   - Without this, Comet would dig the dirt and then refuse to move.

**Rejected:** exempting the pathfinder's `dontCreateFlow`. It is library behaviour on every navigation profile. No world edits are
needed.

**Tests it needs:**
- **Behaviour.** A fixture of this region's cells for the real `escapeStairUp`, with water flowing into the dug cell BEFORE the first
  recheck:
  - base 6e1afb52 times out on the copper (the fixture must set the conditions that produce a timeout, not assume one);
  - the candidate digs the east dirt, passes both rechecks, steps east and ends with a breathable head, never swinging at the
    copper;
  - **a sinking-during-dig case:** the bot drops from 40.2 to 39.0 while digging. The candidate must replan and step up, not refuse
    at arrival;
  - **a no-affordable-exit case:** every bearing is expensive. The candidate must log the named refusal, back off and raise the
    flag. It must not swing, and it must not loop into the material prerequisite;
  - **an inventory change during the backoff** (a stone pickaxe arrives) cancels the backoff and re-prices;
  - **a submerged-to-grounded case:** the bot settles onto a floor, and the price changes and is used;
  - **a dry airborne case:** a jump, then landing, then a re-price.
- **Mutants** (with `withMutant`, each anchor present and unique). Each of these must turn a case red:
  - removing the affordability branch;
  - ranking by geometry only, so a competing bearing with an expensive new ceiling is picked first;
  - removing the submerged acceptance at the recheck, which reproduces the dig-then-refuse;
  - lava at (361,40,187), which must refuse;
  - an affordable ceiling, under which today's behaviour must be unchanged;
  - a transient airborne price, which must wait and re-price.
- **The chain.** Test pillar refusal → escalation → ramp on the same fixture.
- **The population first, honestly bounded.** The logged rows cannot count every bot the new branch would reach. The price
  needs the environment at dig admission (onGround, eye-cell water, effects: `digbudget.mjs:191`), which the snapshots omit
  (`state.mjs:35`), and ramp rows are emitted only after execution (`reflex.mjs:3203`).
  - So step 0 of the build is an OBSERVE-ONLY pricing row: log, at every ramp admission, the environment, the grounded and
    environmental prices, and the chosen action, then read 48 h. It is new executable instrumentation, not a constant, so its
    rollout class is for the reviewers to decide under the tier rules. It is not pre-classified here.
  - Until then, the 2 bots with "dig exceeded" are a LOWER bound on exposure, and the tier is chosen after the read.
- **Paper sandbox, under the sandbox lock:** copy this area and run the whole bot with Comet's inventory, base against candidate.
  Variants: lava behind the dirt, a true water source in the head cell, and a second bearing with a copper ceiling.

**Owner-facing cost:**
- **Risk:** low to moderate. The lateral dig itself is low risk; the new pricing branch changes ramp behaviour for every bot it
  reaches, which the population replay must size first.
- **Tier.** Tier 2, with board-a required in the draw (as poolescape-01 had board-d), if the observe-only read shows a small
  population; otherwise tier 3. The observe-only row's class is decided at its own review.
- **What it could gain (CONDITIONAL estimates, not promises):**
  - about 23 bot-h/day for Comet (about 1.2 % of fleet bot-time) IF it gets out and can then path to the surface. The flood fill
    reaching sky does not prove a walkable route: it ignores clearance, footing and climbable rises, and its sky test accepts leaves
    and water;
  - about 168 `no_safe_target`/day gone;
  - board-a off the production report's trapped list.
- **The same pattern may exist elsewhere.** Two bots fleet-wide logged "ceiling dig exceeded" in 7 days: Comet (870) and
  placebo-c-Bravo (839, on stone). The latter is out of this scope.

## 5. Open questions (these qualify sections 2-4)

- **The live world may differ from the 18:45Z save.** No RCON was used to check it, and the inventory (20:59Z) and terrain
  (18:45Z) are not simultaneous. A fresh region copy before the build would settle it.
- **Reproduction.** The region binary is not committed (10 MB of world data). `anvil_read.py` and `compact.py` re-read any copy of
  `r.0.0.mca`. The ES query scripts and `q5.json`, `q8.out` and `spotcheck.txt` are in the folder; the other queries print to stdout
  when re-run.
- **The breathing margin is inferred, not measured.**
- **Whether the bot can path to the surface from the east side is not verified.** The flood fill only shows that the dry region
  reaches open sky.
- **The float row's ending text looks wrong.** It reads "ended because ashore" while the head stays in water. This is cosmetic.

## 6. Review

**Codex r1:** CHANGE.
- **P1.** The wet-arrival change missed the planner's pre-move rechecks. §4.3 now covers the plan, both rechecks and arrival.
- **P2s:**
  - the affordability fallback needed a budgeted bearing choice and a defined no-exit behaviour (§4.2);
  - the bare-hand pricing; dirt is 18.75 s (§4.1);
  - the count breakdowns (122/31/1 and 172/13);
  - conditional gains, the flood-fill limits and reproducibility (§4, §5).
- **P3s:** the poolescape predicate citation, and the pathfinder citation pinned to 2.4.5.

**Codex r2:** CHANGE.
- **P1.** Sinking during the dig makes the forward-only move and the stale arrival check refuse. §4.3 now holds height, replans and
  steps up, with a test case.
- **P2.** The no-affordable-exit branch needs a terminal remedy, and airborne repricing must be bounded. §4.2 gained a named
  refusal, a backoff, a surfaced stuck flag and a time-bounded landing wait. Its "remedy" was superseded in r3 by an unresolved
  escalation.
- **P2.** The population replay cannot see admission state. §4 now makes an observe-only pricing row step 0, with "dig exceeded"
  as a lower bound.
- **P3.** Exact-version verification of the pathfinder needs the deployed node_modules. It is cited as the pinned 2.4.5 upstream.

**Codex r3:** CHANGE.
- **P2.** The remedy named was not executable by this ramp. The no-exit outcome is now an unresolved escalation, and the
  tool-using ramp is split out as a separate design question.
- **P2.** Submerged repricing. All changing states now wait for stability, the backoff cancels on any price-relevant change, and the
  test cases are added.
- **P2.** The observe-only row is no longer pre-classified as tier 1.
- **P3.** The absolute wording in §3 is replaced by observed attempts and budgets.

**Codex r4:** APPROVE. Its two P3s are applied: the breathing margin is 0.15 block, inferred, and the r2 "remedy" is marked as superseded.

The brief has a single-engine review, Codex only. The coordinator required both engines for the scoreboard, not for this
investigation. The BUILD that follows it must get both.
