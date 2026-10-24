# plugcut-01: plug the wet face, then cut (design, 2026-10-24)

**Owner decision (10-24, through the coordinator):** "plug the wet face first, then cut", reusing poolescape's plug planner.
This is a named exception to the no-stuck-hunts rule, like board-d and board-a.
**Targets:** isolated-c-Alpha and placebo-d-Delta, plus isolated-d-Bravo if its chain is the same (it is, see section 1).
**Paper gate:** the failmine library scenes. The candidate must get out where the base stays, with the base as the positive
control, and no library scene may regress.

**Branches.**
- Primary: `plugcut-on-fb8de72` on the fleet's `fb8de72f` (ironsmelt-01).
- Variant: on ceilescape-01's fb8de72f variant `c488c3e3` (section 8).
- Driver and library: `plugcut-sandbox-1024` (origin/main + the isolated-d scene).

## 0. Summary

Chain B (the climb-flood dead end) pins a bot in a water pit under a ceiling two blocks above its feet. The chain runs:

1. The pillar's head dig is refused.
2. The ramp's ceiling breach is refused, because ONE face of the ceiling cell holds water.
3. Every side column is wet.
4. The bot backs off and repeats, for a week, holding 77-645 placeable blocks.

The refusal is right; what is missing is the move a player makes. The fix puts a block into that water first, so the cut
opens onto dry air. Paper then showed two more stops after the cut, and the fix covers them too:

- **The step's wet face.** After the cut, the ramp's FIRST STEP is refused the same way (a wet face beside the step cell).
  The same rule plugs it.
- **The lip.** The ramp handed the bot back at the pit's lip after one step.

Everything is behind a licence: the 4th consecutive flood refusal (a pinned bot), with `PLUGCUT=0` as the rollback.
Nothing relaxes the flood check. Every cut still goes through `overheadBreakRisk` / `stairUpStep` / `digChecked`; the plug
only changes what they read.

## 1. Population (measured; denominators stated)

**ES, 7 d to 10-24 03:20Z, `_climb_flood_refused` by bot.**
- placebo-d-Delta: 1,560.
- isolated-c-Alpha: 1,459.
- isolated-d-Bravo: 1,184.
- isolated-d-Alpha: 633.
- Everyone else: 100-381.

All of the top three show the same chain: `ramp_breach`, "liquid beside the block overhead", `submerged=0`.

**ES, 3 d to 10-24 13:00Z (positive control: 4,647 `_climb_flood_refused`, 5,328 `_climb_flood_ramp`, 40,893 `_entombed`).**
- 51 of the 76 bots with any flood refusal reached the licence (refusals >= 4) at least once.
- The shape this rung acts on, a ceiling refused for water BESIDE it, is concentrated:

  | bot | licensed firings | max streak | ceiling-beside |
  |---|---|---|---|
  | placebo-d-Delta | 657 | 93 | 657 |
  | isolated-d-Bravo | 638 | 129 | 638 |
  | isolated-c-Alpha | 637 | 128 | 637 |
  | isolated-d-Alpha | 448 | 32 | 448 |

- Elsewhere the shape is scattered: 1-13 licensed firings each (hive-d-Comet 13, hive-c-Comet 10, board-c-Comet 9,
  hive-a-Bravo 7, placebo-c-Comet 6, isolated-b-Alpha 5, ...).
- Most other licensed firings are "liquid ABOVE the block overhead" (water over the ceiling: a pocket) or a falling column.
  The rung refuses both by construction (section 2), so it writes one `refused` row there and changes nothing.

**Geometry, from the failmine scenes (region copies, the night of 10-24).** Head in air in all three:

| bot | feet | ceiling (feet+2) | its wet face | the step after the cut | bag |
|---|---|---|---|---|---|
| isolated-c-Alpha | (356,47,176) water[3] over w8 | dirt, a sapling on it | N (356,49,175) w1 | W and S both refused for ONE w1 at (355,48,177) | 77 cobble, dirt, 2 stone picks |
| placebo-d-Delta | (198,34,187) source | dirt | N (198,36,186) source | W (a furnace) and S (a crafting table) allowed | 192 cobble + |
| isolated-d-Bravo | (340,60,200) source | grass | S (340,62,201) w0 | S: its headroom IS the ceiling plug; 3 more faces | 557 cobble, 88 cobbled deepslate, dirt, iron pick |

The isolated-d-Bravo scene was cut for this work (`stuck-1899-isolated-d-340_60_200`, failmine's own `make_scene`, from
`~/failmine-1024/regions/isolated-d`), validated, and proven on the base (section 6).

## 2. Mechanism

### 2.1 The licence

`floodBranch` licenses the firing when `plugDue(plugSoFar(streak, here, now))` holds.
- **When.** Three flood refusals were already counted at THIS place, so the licence starts on the 4th consecutive firing.
- **Why the licence has its own streak** (r2: Codex r1 P1, Claude r1 P2). The arms' `floodRefusals` drives their back-off,
  and it survives a recovery by another route (a marooned pillar, poolescape). So three refusals in one pit could license
  the first refusal in the next.
- **The streak** (`plugStreak`, per bot, held in a WeakMap):
  - "One place" is the feet column (x, z) with y within 2. A bot bobbing in a deep pool moves its feet cell through
    59..61: Paper, isolated-d-Bravo.
  - The streak lapses after 30 min without a refusal (the back-off curve tops out at 10 min).
  - Progress resets it.
  - Tested: three at A, a recovery, then one at B is not licensed; the positive control is four at A.
- **What the licence grants** (`escapeStairUp`):
  - the two plug rungs;
  - the lip rule and the step check (section 2.5);
  - utility-block sparing;
  - poolescape's 90 s budget (`PLUG_BUDGET_MS`) instead of 60 s.
- **Unlicensed firings** are byte-for-byte today's ramp.
- **Rollback:** `PLUGCUT=0`.
- **Licence row:** `_plugcut_mode on=1 after_refusals=3 max_plugs=3 rounds=3 clear_up=2 budget_s=90`, once per spawn.

### 2.2 The ceiling rung (`ceilingPlugPlan`)

**When it runs.** On a `headroomBreach` flood refusal of the ceiling cell (0,2,0) itself, head in air, at most PLUG_ROUNDS
rounds per firing.

**It reads exactly the faces the shared check reads for an ordinary block:** above, plus the four sides. It refuses:
- a bot that is submerged (the check already exempts it);
- a cut that is not a solid dry block, or that is ice;
- a falling block in or on the cut;
- lava, melting ice, a waterlogged block, or a plant or bubble column on any face;
- **a wet face that is the cell ABOVE the cut.** That cell is the climb's next cell. Water there is a pocket (climb-flood-chain
  scene C), and a plug only moves the refusal up one block;
- a wet face with no solid, non-interactive block to click (poolescape's `INTERACTIVE`). The reference may be a kept SOLID
  cell (r2, Codex r1 P2): a step cell about to be cut is clicked like any other, and the plug stays when it is dug. Only
  PLACEMENTS are kept out of the climb's cells, and the bot's own cells are never solid;
- more than PLUG_MAX (3) wet faces, or fewer blocks than plugs.

**It plans only if the plugs will work.** It simulates the plugs and asks `overheadBreakRisk` again; the plan stands only if
the simulated world is allowed. A plug is never placed for nothing.

### 2.3 The step rung (`stepPlugPlan`, `chooseStepPlug`)

**When it runs.** The step loop finds every bearing's first step refused (runway 0).

**How it plans, per bearing.** It asks `stairUpStep` (unchanged) what it refuses:
- If the refusal is not a flood refusal (no tread, lava), it never plugs.
- Otherwise it plugs the wet faces of the refused cell (the same face rules), never into the cells the step's body uses: the
  own column 0..2 and the step's three cells.
- It then asks `stairUpStep` again against the plugged world: up to three cells and PLUG_MAX plugs in all.
- After the third cell's plugs it asks once more (r2, Codex r1 P2). r1 refused every three-cell step; there is now a
  regression test.
- It returns ok only when `stairUpStep` accepts the plugged step.

**How it ranks bearings:**
1. Fewest re-digs of this firing's plugs. Re-digs rank first because the ramp digs bare-handed, and a dig from water with
   the feet off the ground is 25x the block's grounded price: dirt 18.75 s, cobblestone 250 s.
2. Then fewest plugs.
3. Then the facing order.

### 2.4 The actuator (`plugFaces`, reflex.mjs)

Per placement:
1. **Done is asked first.** If the plugs placed so far already make `clear()` true, it waits PLUG_SETTLE_MS (1.2 s) and
   asks again before returning ok (Claude r1 P2: a plug can turn a source's flow onto another face). Then come the cap
   (never more than PLUG_MAX placements), the firing's deadline, and the frame check.
   - Order matters. Paper probe 3 (isolated-d) placed all three step plugs, then a bob took the body out of the frame and
     the finished rung reported "the body moved". `clear()` reads the world, not the body.
2. The plan is re-planned live, before and after the equip (same cell, same reference, or the placement is skipped).
3. `sub0` (the head at this decision) is sampled, then the block is placed.
4. After `FLOW_SETTLE_MS` the cell is ALWAYS read back and the row is written, even when another owner took the body
   meanwhile (Codex r1 P2). The yield is asked after that.

The block comes from poolescape's `poolBlockOf(items, PLACEABLE, pickScaffold)` among scaffold-ranked items only: never a
tool, never a non-scaffold block. pickScaffold prefers dirt, and so did all of Paper's plugs.

It yields to the drowning rescue and the arbiter before every mutation and after every await. One `_plugcut` row per
attempt:
`at= for=ceiling|step:x,z|step cell= ref= block= result=placed|failed|refused|stopped plugged= sub0= sub= -- why`.
A refused step rung writes one `for=step result=refused` row (Claude r1 P3).

### 2.5 After the cut (licensed only), from Paper

**The lip rule.** The ramp's "a route exists again" hand-back waits until the bot is PLUG_CLEAR_UP (2) above the firing's
start.
- Evidence: probe 2 (f0c14f4b). isolated-c and isolated-d stood dry one block up and one over, with a route, then sat idle at
  1.4 blocks.
- The step budget, the deadline and every refusal still bound the climb.

**The step check (`stepTaken`).** A licensed step counts as taken when the body stands in the cell one up and one along the
bearing from the FRAME the step was planned in: floored, x and z as well as y (Claude r1 P3). The old check was raw y
> 0.5 against the jump's start.
- Evidence: probes 2 and 3 (isolated-d). It jumped from bobs at 60.6 and 61.2 and stood on the step at 61.0, and the raw
  check called it refused.
- The lip rule's climb is floored the same way.
- The base keeps the raw check (a pre-existing misread, out of scope).

**Spare the plugs (`sparePlugs`).** The licensed step loop chooses first among the bearings whose first step digs none of
this firing's plugs.
- Evidence: probe 3 (b554b624). isolated-c sank after the cut until it was submerged (the check's own exemption), and the
  longest runway ran N through the ceiling's plug: `_climb_flood_breach ... exempt=1`.
- It falls back to every bearing when the spared ones have no runway.
- The bearing a step plug was just made for goes first. That plan already priced its re-dig: isolated-d's S headroom IS the
  ceiling plug.
- **Utility blocks too** (r2, Claude r1 P3). Spared bearings also exclude a first step that digs an `INTERACTIVE` block.
  placebo-d-Delta's W and S steps dig a furnace and a crafting table, and bare-handed from water the furnace outlasted
  its 55 s (probe 1). This is existing `stairUpStep` behaviour, which the licence now reaches. When nothing else runs, the
  same fallback still digs them.

## 3. Composition (the refusal chain, not one guard)

- **climbflood-01/02.** Unchanged. The guard decides every cut. The rung only places blocks, and only where the guard named a
  wet face.
- **poolescape-01.** Different arm (marooned, wading, no route) and a different geometry (a walled pit with a stair cut out).
  The shared parts:
  - `INTERACTIVE`, `poolBlockOf` and `poolBlockCount` are imported, not copied;
  - the last-pickaxe reserve is untouched, because the plug never uses a tool;
  - in Paper the two composed: isolated-d's run shows `_poolescape_start` and `_poolescape` rows beside the rung's.
- **ceilescape-01** (the variant). Ceilescape prices a swing before it is started; plugcut adds blocks before a flood-refused
  breach.
  - Order: the flood refusal comes first (no swing is priced for a refused cell). After the plugs, the breach loop re-plans,
    and ceilescape prices the now-allowed swing.
  - `floodBranch` passes `{ yieldTo, steering, plug, budgetMs }`.
  - **The licensed firing prices against its own 90 s** (Claude r1 P2). Ceilescape's `fullMs` is the firing's `budgetMs`,
    so ceilescape's "would a full firing fit" asks about 90 s in a licensed firing. That is accurate: the bot's next firing
    is also licensed while it stays pinned. The variant states it and tests it (section 8).
- **homefix-02 / the drowning rescue.** The rung yields. Test: a yield after the equip places nothing and leaves the
  controls alone.
- **keepout-01.** Escape digs and placements are exempt by design (keepout gates gather and mine). The rung adds no move
  toward lava: lava on any face is never plugged, and a "lava against the step" refusal is not a wet refusal.
- **protectzone-01.** A plug is a `place` under the entombed reflex. Its purpose is `survival`, which a zone allows (test,
  with the positive control that a skill's place is refused).
- **entombed / marooned arms.** Both reach `floodBranch` with their own `floodRefusals`. The chain test drives four
  consecutive firings:
  1. firings 1-3 refuse exactly as today: nothing placed, a growing back-off;
  2. firing 4 plugs, cuts and climbs;
  3. the counter resets.

## 4. What it is NOT

- No world edits, no teleports, no `/give`. The blocks are the bot's own.
- No relaxation of the flood check, of lava handling, or of the submerged exemption.
- Not a fix for water ABOVE the ceiling (a pocket: refused, one row), or for falling columns (refused).
- It does not change the base ramp. Every behavioural change is behind the licence.

## 5. Tests (`bots/test/plugcut.test.mjs`, 53; the variant 54)

**Fixtures.** `bots/test/fixtures/plugcut-scenes.json` holds 9x10x9 windows cut from the three failmine scenes by
`pc_fixtures.py`, with full block states.

**Test world.** `bots/test/plugcut-world.mjs` is ceilescape-01's test world copied unchanged, plus three additions:
- `placeBlock` (refuses what the server refuses in the reached cases, with silent rejection as an option);
- the `ledge` option, which models vanilla's fluid jump-out impulse (motion.y = 0.3 on a horizontal collision whose +0.6 box
  is free);
- a ground jump (0.42).

Without `ledge` the copied world has no way for a body to take any step from water.

**What the tests cover:**
- **A. The pure planners on the three columns.** Each has the positive control that the flood check refuses before the plug
  and allows after it. Also:
  - every refusal reason, with positive controls for "too many" and "no face";
  - the step plan for isolated-c (W, one plug at (-1,1,1));
  - the re-dig rank, including a re-dig outranking an extra plug;
  - isolated-d's three-plug S step;
  - the keep cells, non-wet refusals, lava, and the licence.
- **B. The real `escapeStairUp`** in a virtual clock at production timings:
  - the base positive control (the fleet's stop string; nothing dug or placed);
  - the candidate on each column;
  - a silently rejected placement, a plug that washes out, and a displaced body: never cut;
  - the lip rule against the base;
  - the bobbing start;
  - the sinking bot sparing its plug.
- **C. The chain over four firings,** the rollback, the drowning yield, a tool-only bag, lava, and protectzone.
- **D. Wiring.** The licence row is a structural assertion with comments stripped, and it is seen to fail on a mutant.
- **E. Anchored mutants, all killed:**
  - either licence gate removed;
  - no read-back;
  - every firing licensed;
  - the climb's next cell not kept;
  - no re-dig rank;
  - the step plan not re-asked;
  - the licence one refusal late;
  - the lip rule off;
  - the floored check off;
  - no plug sparing;
  - the base budget.

**Existing suites that touch the ramp.** climb-flood-chain (24), climb-flood (33), climb-flood-mutants (35), escape-stair
(35), entombed-escape (39), entombed-gravel (21), poolescape (41) and drowning-yield are all green.
- One existing expectation changed behaviour under the first draft. Climb-flood-chain scene C (water above the ceiling) was
  plugged. That is what made the "cell above the cut is kept" rule.

The full `npm test` and eslint no-undef results are in section 9.

## 6. Paper (failmine scenes, per-server locks on sandbox6-8, model off)

| probe | sha | isolated-c | placebo-d | isolated-d |
|---|---|---|---|---|
| 1 | 4d2f7ed0 (ceiling rung only) | stayed: plugged + cut, then every step refused | **escaped** | **escaped** (the marooned pillar after the cut) |
| 2 | f0c14f4b (+ step rung) | stayed 1.4: dry, one step up, "a route exists again" | **escaped** | stayed 1.4: dry, the taken step misread |
| 3 | b554b624 (+ lip, floor, 90 s) | **escaped** (3 up), but dug its plug out while submerged | -- | stayed 1.0 up: all three step plugs placed, then "the body moved" (a bob) |
| 4 | 3b0fa12a (r2) | **escaped** (357,49,179) | **escaped** (198,33,190) | **escaped** (342,62,201) |

**Base positive control for isolated-d.** On the fleet build fb8de72f (scene-e2e on sandbox7/8): 3 of 3 runs stayed, as the
fleet did, and none passed. The scene is admitted to the failmine library (`plugcut-sandbox-1024` @ 7fa452cc,
failmine.test.mjs 21/21).

**placebo-d in probe 4.** It plugged and cut. Then it spent the firing on the W step's furnace: bare-handed from water,
the dig exceeded 83 s, because both of its steps dig a utility block and the sparing fell back. A second, marooned
firing plugged again and left south into the cave. This is the existing ramp digging what it is given, and it is
named here, not fixed: ceilescape-01 prices such a swing and refuses it (on the variant).

The library gate is in section 9.

## 7. The read and the registration

**Read: `scripts/host/plugcutread.py`.** The canary pool must contain placebo-d (section 7.1).
- **PRIMARY** (blocks KEEP, deterministic, n = 1): placebo-d-Delta leaves its column after the deploy, i.e. >= 2 blocks from
  (198,34,187), and stays out >= 30 min of its own positions. Death-aware: a death is reported, never counted as leaving.
- **G1 (defect, two-death floor).** Canary deaths within 120 s after a `_plugcut result=placed` row of the same bot. One is
  reported; two REVERT.
- **G2 (defect).** A `_plugcut result=placed` row whose bot's head was submerged at the placement. The planner refuses that by
  construction, so the row carries `sub=0|1`.
- **REPORTED (not a gate).** A `_climb_flood_breach` row at a cell this bot plugged within the same firing. Sparing makes
  this rare, but the submerged exemption allows it, as on Paper probe 3. Two or more on the canary is a WATCH.
- **ARMS.** No control `_plugcut*` rows. **LIVENESS.** The licence is on on every canary bot. **INSTRUMENT.** placebo-d-Delta
  positions in >= 75% of its 10-minute buckets.
- **EXPOSURE.** At least 1 canary `_plugcut` row (placebo-d-Delta reaches its 4th refusal within minutes of the restart).
- **PRIMARY needs Delta IN THE PIT AT THE DEPLOY** (r2, Claude r1 P1): its newest position in the 30 min before the cut must
  be inside the box. Otherwise the result is `not_in_pit_at_deploy`, which cannot KEEP.
- **G2 is gated on `sub0`**, the head at the decision. `sub` (after the settle) is reported only: a bot sinking after a
  placement is not a defect.
- **What this canary cannot see.** isolated-c-Alpha and isolated-d-Bravo (and isolated-d-Alpha) are in no drawable pool.
  Two of the three named targets are helped only at promotion. The `--fleet` read 48 h after promotion is their tripwire,
  and that read reports their LEFT state by name.
- **REPORTED.** `_plugcut` results by bot and `for=`; refusal reasons; licensed firings that progressed; every canary death.

### 7.1 Tier (drawexposure, 6 h to 10-24 12:58Z)

The requirement is "a 4th consecutive climb-flood refusal" (`climb_flood_refused` containing `refusals=4 `, min 1 per pool).
- Positive control: 377,261 rows, 80 bots, 198 kinds.
- Eligible: board-a, board-c, hive-a, hive-b, hive-d, placebo-a, placebo-b, placebo-d (8 drawable pools).
- Over 24 h, ten pools are eligible (positive control: 1,494,380 rows, 80 bots, 210 kinds). board-b and placebo-c are the
  exceptions.
- This counts the ARM's counter (`refusals=4`), so it is an upper bound on the licence, which now counts refusals at one
  place.
- Under the 4-pool policy (required pools count toward the 4; placebo-c never drawable), the draw is:
  `draw_require_pools ["placebo-d"]` + 3 more from the 7 other eligible pools.

**Proposed: TIER 3 for the first run.** The reason is the licence exposure itself: outside placebo-d, the licensed firings are
mostly "water ABOVE" (refused, rows only). Only placebo-d is known to hold the acting shape. A tier-2 KEEP at +180 on 4 pools
would rest on one bot. Reviewers: tier 2 is available on the pool count; this design asks for tier 3.

## 8. The variant

The variant is a cherry-pick onto `ceilescape-on-fb8de72` (c488c3e3). The expected conflict is `floodBranch`'s ramp call:
ceilescape's `{ yieldTo, steering }` becomes `{ yieldTo, steering, plug, budgetMs }`. The step loop was not touched by
ceilescape.

## 9. Results (filled as they land)

(npm test, eslint, the isolated-d proof, the library gate.)
