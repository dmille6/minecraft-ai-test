# dropdig: the next survival fix after swimcentre-01 (design, 2026-11-03)

Survival lane (owner 11-03, memory `owner-gaps-1103` item 3; ledger `survival-supply-1103`). The question was which fix comes
next after swimcentre-01: **drop-and-dig** (swimcentre-01 report section 7: dig the air pocket standing) or a fix for the
**sealed-in-liquid dead end** that has held isolated-d-Delta and isolated-d-Echo in one cell since 11-02. Measured first,
then designed independently by Codex and by me, then reconciled.

**Answer: the wet-ceiling pin ranks first by bot-time; drop-and-dig ranks first by deaths.** The first piece is
**swimunder-01**: a bot pinned in water under a wet ceiling swims out under the wall, the way it came in. drop-and-dig-01
follows as the next S slot. swimcentre-01 does not cover the pin.

## 1. Measurements (files on the fleet host, full walks, `scripts/lib/telemetry.py` stream reader)

Window A: 72 h to 2026-11-03T21:00Z. 80 of 80 bots, 5,654,625 skill rows, 34,560 positioned 10-minute buckets = **5,760
positioned bot-h** (= 80 x 72: the instrument saw every bot every bucket). Window B: the 96 h before that (10-27 21Z to
10-31 21Z), 6,794,064 rows, 7,679 positioned bot-h.

**Deaths** (one `_death` row each, classified by failmine's server-message table):

| | A (72 h) | B (96 h) |
|---|---|---|
| all | 60 | 110 |
| drowned | 26 (21 at y = N.2) | 36 |
| fall + stalactite | 19 | 35 |
| lava | 9 | 16 |
| suffocated | 6 | 23 |

**Still time** (a spell is >= 3 consecutive 10-minute buckets of one bot inside a 3x3x3 box, failmine's definition):

| class | A spells | A bot-h | A bots | B spells | B bot-h |
|---|---|---|---|---|---|
| all still spells | 271 | 302.7 | 76 | 481 | 405.8 |
| **wet ceiling** (`_climb_flood_refused` or `_plugcut` rows in the spell) | **23** | **120.2** (40% of still time, 2.1% of all bot-time) | 21 | 34 | 48.7 |
| of which also `sealed_in_liquid` >= 20 rows | 3 | 82.7 | 3 | 1 | 0.5 |
| entombed, dry | 47 | 36.2 | 36 | 67 | 53.8 |

The three long ones in A: **isolated-d-Delta 41.7 h** (since 11-02 03:11Z) and **isolated-d-Echo 38.0 h** (since 11-02
06:54Z), both at 358.4,58.2,180.7 and still there at 21:07Z; **isolated-c-Bravo 19.2 h** at 355.3,47.1,186.7, still there.
The failmine weekly (7 d to 11-02 03:16Z) ranked the same class first: hive-d 100,54,150 82.6 bot-h (2 bots), placebo-c-Bravo
41.2 h, isolated-d-Bravo 39.9 h, placebo-d-Delta 33.7 h, isolated-c-Alpha 22.2 h, board-a-Comet 21.2 h.

`_plugcut` outcomes fleet-wide (~3 days of files): about 1,000 refusals "the wet face 0,3,0 is a cell the climb needs open"
on ~25 bots, against **6 placements**. plugcut-01 does not reach this shape: the water is directly over the roof.

**The pin cell also kills.** failmine's 72 h mine to 11-03 03:16Z: death cluster #3 = 2 drownings at 358,59,181 (isolated-d),
the week before 4 there; isolated-d-Comet drowned at 356.7,59.2,180.7 on 11-01 04:37Z (a wet-roof refusal, before apseal).

**Drowning lead-ups** (the 180 s before each of the 26 drownings in A; 20 after apseal-01's promotion at 11-01 20:15Z):
the air pocket refused on the TIME budget in 9 (4 of them also had route `out`, which swimcentre targets), route `up` with no
refusal 7 (swimcentre's edge pin), "water continues above the head" 2, "crafting_table is not dug" 1, "air above" 1, the
wet-roof refusal 6 (all before apseal). **drop-and-dig's population is about 5 deaths in 49 h (~2.4 a day)**, before
checking whether a floor is within reach.

**Ranking.** By bot-time the wet-ceiling pin is two orders of magnitude larger: 120.2 bot-h in 72 h (~40 bot-h a day; 12 a
day in window B) against ~2.4 deaths a day, each costing minutes of travel with keepInventory. By deaths, drop-and-dig is
larger (~2.4 a day against ~0.3-0.6 a day at pin sites). Codex reached the same ranking independently (section 3). The pin
also composes two correct guards into a dead end (CLAUDE.md: a refusal must name a remedy the bot can perform from where
it is): the flood row says "leave this cell sideways or downward (mine or goto away from the water)", and goto is the
pathfinder that just refused (`sealed_in_liquid visited=1`).

**swimcentre-01 does not cover it.** swimcentre steers only the drowning rescue, the unowned float hold and the air pocket's
rise, and only toward a column it already rises through. The pinned bots breathe (head in air, health 20, no drowning rows,
11 `_water_float` rows in 41 h); centring in this cell leaves the same roof overhead, and swimcentre never descends.
(`_swim_centre` is 0 at the cell, trivially: swimcentre is not on the fleet yet. The argument is from the code, not that zero.)

## 2. The trap (region copy of the 11-03 03:16Z nightly backup, failmine's read-only reader)

Feet 358,58,180 water source; head 358,59,180 air; roof 358,60,180 granite; 358,61,180 a water source enclosed by dirt.
Head-level walls N/S/E granite, W cobblestone, each touching water. Feet level: W and E water, N a furnace, S a crafting
table (bots placed them). Below: water to y 54. The y 58 layer belongs to a large body of sources. The bots got in from
BELOW: isolated-d-Echo fell into the lake at 352,56,172, floated up into the pocket (`_water_float`), then `_entombed`.
Every rung refuses, each correctly: the pathfinder (no successor from a sealed liquid start, upstream
mineflayer-pathfinder #117 closed WONTFIX), the pillar / ramp breach / shaft ascent (`_climb_flood_guard` "liquid above the
block overhead"), the ramp's sidestep ("no dry side column"), plugcut ("the wet face 0,3,0 is a cell the climb needs open").

**The way out is the way in**: sink one cell under the head-level wall, swim two cells, rise two, and step out onto dry
andesite at 356,60,178. Seven moves, four of them with the head under water.

## 3. Codex's independent design (codex exec, read-only; given the measurements and the code, not my design)

- Ranking: "wet-ceiling pin first overall; drop-and-dig first on demonstrated death exposure" (40.1 bot-h a day potentially
  recoverable vs ~2.45 deaths a day). swimcentre-01: "does not cover case 2 ... it cannot descend beneath head-height walls".
- Fix: a bounded **"swim-under" escape rung**: `swimUnderPlan` (radius 4, descent <= 2, the swept 0.6 x 1.8 body),
  `swimUnderBudget` (full confirmed air, conservative out-and-back time), `swimUnderStep`, `escapeAfterSwim`; per-tick
  waypoint steering, jump off to descend, jump pulses for depth, jump to ascend ("sneak is not descent"); wired into
  floodBranch and the stranded dispatch; a cancellable movement lease; the drowning and lava rescues always pre-empt; cap total
  submersion at 8 s including the return; a verified return to air at every waypoint; on failure return to air before retry;
  no route -> keep breathing, log, escalate; rows `_swim_under_plan/_start/_return/_result`; rollback `SWIMUNDER=0`.
- Paper: the exact isolated-d and isolated-c geometry, two bots in one pocket, blocked return, low air, rescue pre-emption,
  ordinary swimming; unproven: descent and braking under Paper corrections, the collision impulse, return timing.
- drop-and-dig in five lines (section 7 below takes them).

**Reconciliation** (my design converged on the same move before I read Codex's; the differences):

| point | Codex | mine | built |
|---|---|---|---|
| search radius / descent | 4 / 2 | 12 / unbounded | **Codex's 4 / 2** (offline: the same 8 sites are found at 4 and at 7) |
| breath bound | 8 s total submersion incl. return | consecutive head-wet cells | **<= 5 consecutive head-wet cells**, turn-back at air 10/20, back leg is the wake reversed; worst case out + back ~5 s of 15 |
| return route | verified at every waypoint | the wake (cells just taken) | the wake: it is verified by having been swum; each forward cell is re-read before entry |
| trigger | first flood refusal | after the flood branch refuses | the same: after `floodBranch` returns refused in the entombed and marooned arms |
| hooks | floodBranch + stranded dispatch + escape.mjs lattice | floodBranch only | floodBranch arms only (the lattice is untouched: fewer hunks, the same population; the entombed arm fires ~14/h at the pin) |
| rows | 4 kinds | 1 | `_swim_under_start`, `_swim_under` (outcome), `_swim_under_refused` |

## 4. swimunder-01 (built; tier 3: `bots/src/reflex.mjs`, and `bots/src/swimunder.mjs` added to protected scope)

Branch `swimout01-on-53fd28e` (pushed; tip **ec7c7cf6**) on the live fleet sha 53fd28ee. `SWIMUNDER=0` restores the base exactly.

- **Plan** (`swimUnderPlan`, pure): uniform-cost search over feet cells where the 0.6 x 1.8 body fits (feet and head cells
  without a collision box, no lava within a face, no bubble column, no powder snow or anything that hurts, an unloaded cell is
  never clear) and the feet are in water; moves are the four horizontals, up (the cell over the head free) and down (the cell
  under the feet free and wet). The last move may step out onto **dry ground** (air feet and head on a solid floor) sideways,
  or one up beside a free cell over the current head (prismarine-physics 499: the in-water collision impulse clears a 1-high
  ledge). Cost: head-in-water cells, then length; no stretch of more than 5 consecutive head-wet cells. Prefers dry ground;
  an **open surface** (feet in water, head and the two cells above it in air) is the fallback exit.
- **Admission** (`swimUnderAdmit`): air >= 19 of 20, health >= 14, `SWIMUNDER` on. **A null air reading is full air when
  the eye is in air** (Paper finding: mineflayer sets `oxygenLevel` only from the bot's own `air_supply` metadata, sent when
  the air changes, so a bot that has only breathed since it spawned reads null through `oxygen.mjs`; the pinned fleet bots
  are exactly that). During the swim a null reading is replaced by a vanilla estimate (-1/15 per wet tick, +4/15 dry).
- **Controller** (`swimUnderStep`, pure, per physics tick): a sideways move strokes only while the body fits the passage
  under the lower of the two columns' first ceilings (else it rises or sinks first); a vertical move centres first, then
  rises (jump) or sinks (jump released: water gravity; sneak does not sink). Coast-aware brake (water inertia 0.8).
- **Abort** (`swimUnderAbort`): yield, a changed cell, air <= 10 (unless fewer head-wet cells lie ahead than behind), health
  down 2+, no progress for 3 s in one cell, 25 s budget. **Turn back** along the wake to the last cell where the head was in
  air; a stop on an exit (an open surface or dry ground reached early) counts as out.
- **Actuator** (`swimUnder`): one body, controls cleared on every exit except a yield (the new owner's controls are not
  touched). **Reflex wiring** (`swimUnderTry`, modelled on `poolEscapeTry`): only with the feet in water, never while
  poolescape, another swim or a stranded routine runs, never when the arbiter/air pocket/drowning rescue holds the body;
  reserves the runner, `setGoal(null)`, yields every tick to the drowning rescue and danger moves. While it steers, the
  float hold (`owned`), its jump, the stranded ladder and the in-wall exit stand aside. A place with no way out backs off
  5/10/20/40/60 min and logs `_swim_under_refused` with the reason; the existing flood back-off is unchanged in every
  non-`out` case, so no new dead end and no new refusal that names nothing. A no-plan answer that met unloaded cells sets no
  back-off; the first real one backs off 1 min. The refusal row names the start's cells (feet, below, head, roof, sides).
- **Ownership without new terms in old lines**: the float hold and the stranded ladder stand aside through ceilescape-01's
  own `rampSteering` count (`steerRamp(true/false)` around the firing), so ceilescape's and poolescape's wiring anchors stay
  byte-identical; only the in-wall exit's guard gains `!swimmingUnder`. The flood arms keep their base lines; the swim
  follows them and an `out` lifts the back-off.
- **The pillar reads a wet roof from where a floating body rests** (`pillarOut`, gated on `SWIMUNDER`): in the sim, a bot
  that dipped below its cell reads its head cell as feet+2, passes the early flood check and places a block under itself
  before the loop refuses the roof one jump later (D2: the base places); that block would seal the swim route. The roof is
  also read at floor(y + 0.5) + 2, submerged as the resting body is: the same refusal, one placement earlier (D1). It did
  NOT explain the stone seen on Paper's placebo-d cut (section 8).

**Offline coverage** (`bots/scripts/swimunder-offline.mjs` over cuts of every wet-ceiling spell >= 0.5 h in both windows,
56 sites, 168.8 bot-h, from the 11-03 region copies): 11 sites have the feet in water; **a way out at 8 of them, 95.5 of
116.0 wet-start bot-h (82%), all 8 to dry ground**, the longest head-wet run 4. No way out: isolated-c-Bravo 355,47,186
(19.2 h; the water there opens only into 2-high air rooms with no floor in reach) and placebo-a-Echo 319,49,-109 (1.3 h).
The other 45 sites had dry feet in the copy (the dry-entombed class, or a site changed since); swimunder never fires there.
Caveat: the copies are from 11-03 03:16Z; spells from window B were read against later geometry.

## 5. Tests, reviews, Paper

- `bots/test/swimunder.test.mjs`, 25 tests (`node scripts/run-tests.mjs swimunder`; reflex.mjs needs the runner's env): the plan on the real isolated-d, hive-d and isolated-c cuts (P1-P4), the breath bound
  and the hazards (P5-P7), admission/abort/way back (A1-A3), the controller (C1), **behaviour under prismarine-physics on the
  real cuts** with the actuator driving a fake bot at 50 ms a tick (B1 the base float hold stays pinned 60 s; B2 isolated-d
  out to dry ground, min air >= 12; B3 hive-d out; B4 the way closes mid-swim -> back to air, health 20; B5 a yield stops
  steering; B6 the dry exit closes at the last step -> ends at air; B7 the swim on an unreported air reading), the pillar at
  a dip (D1, mutant D2), the refusal row (P8), wiring (W1), four anchored mutants (M1-M4). Real-time 50 ms run: isolated-d out
  in 5.6 s (min air 17/20), hive-d 3.2 s (19/20). Neighbouring suites pass on the branch: ceilescape, climb-flood (3),
  plugcut, poolescape, airpocket, last-resort, homefix2 (3), escapeguard, tombexit, drowning (4). Composes with swimcentre-01:
  the patch cherry-picks cleanly onto its tip and both suites pass on the stack.
- Reviews, one round, blockers only: **Codex r1 no blockers**; note 1 found that under a real 50 ms clock the swim stalled at
  the open surface (a 0.25 height band was never held there) -- fixed (passage-aware stroke, injectable clock in the tests),
  notes 2-3 fixed. **Claude subagent r1 no blockers**; notes (re-read the dry exit, press on when the nearer air is ahead,
  a budget on the way back, alive() honours the air pocket) fixed. Re-checks of the Paper-driven changes (null air; unloaded
  back-off; the pillar's rest-height read and the rampSteering stand-aside): **Codex r2, r3, r4 no blockers; Claude subagent
  r4 no blockers** ("it only refuses a roof the base would also refuse, just one placement sooner"; no path leaks the count).
- Paper: section 8.

## 6. The read (generic +90/+180, plus its own lines)

- Harm: the death gate (two-death floor), the tripper, crash loops. Own lines: `_swim_under` outcomes (out / returned /
  yielded / failed) with min air and health, `_swim_under_refused` reasons, drowning deaths within 2 min of a `_swim_under`
  row (expected 0), canary-pool wet-ceiling still time vs control.
- Exposure: the class is ~1 bot-h per hour fleet-wide but clustered (a few long pins). isolated-d (Delta and Echo, pinned
  now) and isolated-c (Bravo) should be in the draw: **draw isolated-d and isolated-c** if the scheduler allows a pinned pool;
  otherwise the read will likely be "KEEP, goal unverified" and the goal is read after promotion.
- Effect (registration `effect`): `_climb_flood_refused` per bot-hour down >= 30% relative at +72 h (it is the pin's own
  heartbeat: ~14/h per pinned bot); guardrails drowning deaths and items per bot-hour.
- Rollback: the base sha, or `SWIMUNDER=0`.

## 7. Second piece: drop-and-dig-01 (design only; next S slot after swimunder-01)

From swimcentre-01 section 7 with Codex's five lines: after the air pocket's plan is OK and a solid floor is verified within 2
cells below the feet (with a clear descent and the original roof and seals still in reach), release jump, wait up to 1.5 s for
a stable onGround, re-price the dig standing (5x instead of 25x), dig, then rise. Admission prices sink + seals + grounded dig
+ ascent together; absolute target coordinates are kept; a sink that never lands falls back to the floating dig only if that
still fits the remaining budget (never a new dead end). Pure `standingPlan`; Paper AF (floor -1), AFD (floor -2), no floor,
lost contact, tool change; rollback `DROPANDDIG=0`. Population ~2.4 deaths a day (5 in 49 h); the floor depth at the four
post-apseal sites must be read from region copies first (the backup columns showed water at dy -1 under all four).

Falls (35 + 19 in the two windows) stay a measurement, not a fix: read the `_fall_path` nodes against region copies first.

## 8. Paper results (sandbox6, 11-03 21:54Z to 11-04 00:20Z, failmine's scene driver, one fresh bot per run)

The scene `stuck-1899-isolated-d-358_58_180` was cut by failmine (72 h mine to the 11-03 03:16Z backup: stuck cluster #1,
44.2 bot-h, Delta + Echo); arena fidelity 296/296 probes; oracle `escape` (alive, >= 2 blocks away or up, held 20 s, 9 min).

| scene | build | runs | outcome | the swim |
|---|---|---|---|---|
| isolated-d 358,58,180 | base 53fd28ee | 4 | **stayed 4/4**, health 20 (the fleet's chain: flood guard, ramp, plugcut "0,3,0", stranded) | - |
| isolated-d | c9d2888b (r1) | 1 | stayed | every firing refused "air null of 20": the null-air finding |
| isolated-d | 29a2b559, df4ff6b8, 2d1430bb (r2-r4) | 6 | **escaped 6/6**, ~45 s after placement | out to dry ground, 7/7 cells, 5.3-6.2 s, min air 18/20, health 20 -> 20, at the first flood refusal |
| placebo-d 198,34,187 (library) | base 53fd28ee | 2 | escaped 2/2 (plugcut + ceilescape at the 4th refusal, ~4 min) | - : **not a gating scene on this base** |
| placebo-d | r2-r5 | 11 | escaped 8, stayed 3 | out by swim in 3 (6 cells, min air 16, health 20, ~1 min); refused in 8: a stone under the feet (`below=stone`, r5's row) |
| isolated-c 356,47,176 (library) | r2 | 1 | escaped (another rung) | refused "no way out" (as offline); no interference |

**The placebo-d stone is base behaviour**: the base runs show the same `_inventory_mutation cause=entombed_escape stone -1` at
the first entombed firing. The pillar's early flood check refuses in those rows, so where the stone goes in is not
identified (the driver's bag sync at placement, or another arm). Where it lands under the feet, the swim has no route and
the existing plugcut path runs as in the base (two of its runs ended one block up, which the oracle scores "stayed"). Open item
for the read: count `_swim_under_refused ... below=stone`. It does not touch the isolated-d case: the cell under the pinned
fleet bots is water in the backup after 40 h of pillar attempts.

## 9. Queue placement

Fleet lane, S slot: **swimunder-01 after swimcentre-01, behind one P entry** (owner 10-25 P,S,P,S; survival-supply-1103 cap
one S in every two slots). Current head: bagdiet-01 (P, running) -> swimcentre-01 (S) -> bundle-1103a (P) -> towngate-01 ...;
so swimunder-01 goes **after bundle-1103a** (the next P) and before towngate-01 (P). It cherry-picks
cleanly onto swimcentre-01's tip (checked), so the autorebase can stack it on whatever swimcentre leaves. Codex's view: the
same order (pin first among S candidates, after swimcentre). drop-and-dig-01: the S slot after swimunder-01.
Showcase: none (the showcase is a peaceful town world; this is fleet survival).
