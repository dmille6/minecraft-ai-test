# ceilescape-01: never start a ramp swing that cannot finish; leave sideways, or flag for rescue (design r2, 2026-10-24)

OWNER 2026-10-23, through the coordinator: build the board-a-Comet escape fix ("do whatever you recommend"). This is a named
exception to the 09-30 no-stuck-hunts rule, like board-d's pool escape. The brief is §4 of
`docs/reports/boarda-comet-trap-2026-10-23.md` (on main). This document is the build's design. It is written for the
both-engine design review, and it says where it departs from the brief and why.

Base: fleet `3cc5f14d` (chatgate-01, promoted 10-24 02:02Z). Variant: ironsmelt-01's live canary `fb8de72f`. That canary
touches `skills.mjs`, `smeltjob.mjs`, `cognitive.mjs` and `index.mjs`, not `reflex.mjs` or `scaffold.mjs`, so the variant is the
same diff.

## 1. Population (read-only ES, 7 days to 10-24 03:40Z; `scripts/host/ceilescape_population.py`)

**Positive control.** The query sees 1,927 `_entombed_ramp_cut` rows (1,924 failed, 3 success) and 655 `_marooned_ramp_cut`
rows (649 failed, 6 success).

**Bots with any ramp stop reading "dig exceeded": three, fleet-wide.**

| bot | ramp stops "dig exceeded" | where | position range (7 d) | pickaxes |
|---|---|---|---|---|
| board-a-Comet | 864 (entombed: the ceiling, copper_ore); plus 114 "Digging aborted" | (359,40,187), floating in a falling-water column | x 359.3-359.7, y 39.0-40.2, z 186.5-187.7 | 1 wooden (38 uses left) |
| placebo-c-Bravo | 836 (entombed: the ceiling, stone) + 495 (marooned: a ramp STEP, stone); plus 252 "Digging aborted" | (559,35-37,219), a sealed flooded stone shaft | x 559.3-559.7, y 35.4-37.2, z 218.3-219.5 | none |
| placebo-a-Alpha | 2 (marooned: a step, deepslate) | -- | -- | -- |

This is a LOWER bound on exposure. The price depends on the environment at dig admission (onGround, eye-level water), which the
snapshots do not carry. Ramp rows are written only after the ramp has run. The observe line in §6 measures the rest.

**The two geometries** come from read-only copies of the region files: board-a r.0.0.mca, saved 18:45Z, and placebo-c r.1.0.mca.

- **Comet** (column 359,_,187).
  - The column, bottom up: y 38 stone; y 39 falling water; y 40 falling water (feet); y 41 flowing water at level 2 (head);
    y 42 copper_ore (the ceiling); y 43 copper_ore; y 44+ air (cave).
  - **East** (360,_,187): y 39 dirt (the tread); y 40 dirt (feet); y 41 a ladder (head; its registry bounding box is `block`,
    so `bodyPassable` is false and the ladder is dug); y 42 air (the new column's ceiling: open).
    - (361,40..41,187) is dry air on stone.
    - A flood fill of dry open cells from there covers about 7,000 cells and reaches open sky.
  - **The other bearings:**
    - N: feet is falling water, head flowing water;
    - S: the tread (359,39,188) is flowing water;
    - W: feet is flowing water (358,40,187), and the head dirt (358,41,187) sits beside FALLING water (357,41,187) that rests on
      stone, so it would flood the moment the dirt is dug.
- **placebo-c-Bravo** (column 559,_,219).
  - The column, bottom up: y 34 stone; y 35-37 falling water; y 38 flowing water at level 1; y 39-40 stone.
  - There are water sources at (558,38,219) and (558,39,219).
  - Every horizontal neighbour at the feet and head heights is stone or water.
  - Bobbing from y 35.4 to 37.2, the cell above the head flips between stone (entombed) and water (marooned).
  - There is no dry lateral cell and no exit under any bare-hand budget. **This bot is the escalation case: this design does
    not claim to free it.**

**Prices.** These come from the registry (prismarine-block 1.21.8, `block.digTime`), bare hand, in ms. "Both" means in water at
the eye AND off the ground:

| block | grounded, dry | one penalty | both |
|---|---|---|---|
| copper_ore | 15,000 | 75,000 | **375,000** |
| stone | 7,500 | 37,500 | **187,500** |
| dirt | 750 | 3,750 | 18,750 |
| ladder | 600 | 3,000 | 15,000 |

The ramp's budget is 60 s. The brief said a stone pickaxe would bring the copper to about 28 s. That is wrong: under both
penalties it is 112.5 s. The point does not matter here, because the ramp is bare-handed by design.

## 2. The fact the design rests on: a swing whose start price exceeds the time left cannot finish

1. **mineflayer fixes the dig's wait when the dig starts.**
   - `bot.dig` computes `waitTime = bot.digTime(block)` BEFORE it looks at the block. `bot.digTime` is
     `block.digTime(heldItemType, creative, eyeLevelBlockIsWater, !onGround, ...)`.
   - It then sets `setTimeout(finishDigging, waitTime)` (mineflayer `lib/plugins/digging.js:27, 135, 228-256`).
   - A change of state after the start does not shorten the wait. The look comes after the price, so the real wait is a little
     longer than the price.
2. **`digBounded` (`reflex.mjs:5833`) stops the dig at `min(budget, time left)`.** It calls `stopDigging`, which sends status 1,
   a cancel (`digging.js:165-189`).
3. **The server keeps nothing from a cancelled dig.**
   - Vanilla and Paper judge completion only on status 2 ("finished"): the destroy progress at that moment × the elapsed ticks
     must be at least 0.7.
   - The client sends status 2 only when its own wait is over, and a timed-out dig never gets there.
   - Paper's delayed-destroy state starts only from a status 2. A cancel discards the progress.
4. **The one other ending (Codex r1 P2-7).** A dig also completes early if a block update turns the cell to air
   (`digging.js:192-206`).
   - That is some other actor breaking the block: a bot, or a falling block leaving. It is not a path the bot can count on.
   - Paper confirms the timed-out case for the deployed build: the base positive control (§9) must log `dig exceeded` and must
     leave the block in place.

So when the price of the swing about to start (§3: the hand that will actually dig it, the eye-level water, onGround) exceeds
`deadline - now`, that swing cannot complete, and it leaves nothing behind. **Declining it removes no move that could have
worked.** The rule acts per SWING, and only there:
- cells already cleared stay cleared;
- a multi-dig step still completes over several firings, as it does today (Codex r1 P1-2);
- every other part of the arms is untouched (§5).

The registry stays the only source of hardness. `canBreak` and every refusal stay on the GROUNDED price (`dig-split.test.mjs`
pins that). The price at the time of the swing only answers "can this swing finish in the time left", which is the question the
deadline already answers one line later.

## 3. The decision (pure, `bots/src/ceilescape.mjs`)

**The price** is `digPriceOf(bot, block)`, which is `bot.digTime(block)`: mineflayer's own wait, taken after `safeEmptyHand`.
- It therefore prices the hand that will actually dig. `emptyHand` can keep a tool (`kept_tool`, `failed`: `toolfor.mjs:337-350`),
  and pricing a bare hand would overstate the cost (Codex r1 P1-1, Claude r1 P2-5).
- When an older fake has no `digTime`, it falls back to the registry with `digEnv` (the same inputs).
- An unknown price means "try it", as `planDig` has it: today's path.

**Settling.**
- Only a swing that does not fit is re-priced, after `settledEnv`: `{onGround, eyeWet}` sampled every 1 s until two samples
  agree, or 5 s, with `yieldTo` asked at each sample.
- It runs once per firing (`ceSettled`).
- If the body changed cell during the settle, the breach is planned again from where the body now is (Claude r1 P1-2: no candidate
  offset is ever applied to a shifted origin).
- A jump lands, or a sinking body reaches its floor, before a transient price can decide anything.
- With `CEILESCAPE=0` there is no settle. The swing goes ahead at once, exactly as today, and only the row records what the new
  branch would have done.

**`ceilingEscapeDecision({ ceilingMs, leftMs, fullMs, candidates, refusals, moved })`.** `fullMs` is the firing's whole budget,
60 s.
- **`ceiling`**: `ceilingMs <= leftMs`, or the price is unknown. This is today's code, byte for byte. There is no reserve on this
  comparison, so an affordable ceiling cannot change path.
- **`wait`**: no swing, and no flag. It is returned when:
  - this firing has already sidestepped (one per firing); or
  - the ceiling, or some candidate, would fit a FULL firing's budget even though it does not fit the time left.
  - The firing stops. The next one starts with the full budget and decides again. This is Claude r1 P1-3: an escalation is never
    raised because of time already spent on a gravel swing, a settle or an earlier step.
- **`lateral`**: the cheapest candidate with `costMs + 3,000 <= leftMs`. Ties go dry-first, then in facing order.
- **`escalate`**: nothing fits even a full firing. This is a named stop plus the `_needs_rescue` flag (§5).

**A candidate's cost.**
- Its digs at the price they will be dug at: the held item and the eye-level water now, and OFF the ground when the bot is
  submerged, because the sidestep swims while it digs (Claude r1 P2-6).
- Plus 250 ms (look and hand) and the 300 ms flow settle per dig.
- Plus 500 ms falling settle once if anything was dug.
- Plus the move: 4,500 ms, for the look, a swim-up of at most 2,000 ms and a forward of at most 2,000 ms.
- Plus the new column's ceiling at the price it will be dug at after the step: eye dry (the head must breathe), off the ground
  if the destination feet are water. It is 0 when that cell is open.
- Any unknown price makes the candidate unaffordable.

**The candidates** are the `escapeBearings(yaw)` bearings that pass every filter below:
- **`floodSidestep`**, the existing planner with its flood, lava, tread and new-ceiling rules. A SUBMERGED bot plans with
  `wetFeet: true`.
  - So water in the destination feet cell is allowed: water that flowed into a dug exit must not make that exit
    un-retryable (Codex r1 P1-3).
  - A waterlogged destination head block is refused.
- **`cellFloods` on the destination head cell**, for a submerged bot. The shared flood check exempts water for a submerged bot,
  so nothing else asks this. It applies vanilla's FlowingFluid.spread rules, conservatively:
  - water directly above falls in;
  - a source beside it, or a waterlogged block (which holds a source), spreads in;
  - flowing or falling water beside it spreads sideways only when it rests on a solid block. Over water or over an open cell it
    flows down instead. Level 7 spreads nowhere;
  - an unreadable level counts as a source, and an unloaded cell is a refusal.
  - This is what refuses Comet's W bearing: the head dirt sits beside falling water resting on stone.
  - It passes E: the bot's own level-2 head water rests on falling water, the cell above is air, and the other sides are air
    and stone.
- **No live fire column is entered** (`poolForbid`, as poolescape has it).
- **No falling block above a solid new ceiling.** That column would need several swings the cost model does not price.

**The step loop: per swing (§2), and with no substitution.**
- Before EACH step dig, if `digPriceOf` does not fit the time left, the settle above runs once, the swing is priced again, and
  if it still does not fit the step stops there with no swing. Cells already cleared stay cleared.
- It escalates only on the firing's very first swing, with `steps === 0`, nothing dug yet, and no sidestep. The test is
  `firstSwingEscalation`: when no bearing's first swing (stairUpStep's plan for each) fits even a full firing. Otherwise the stop
  is a `wait`.
- No other bearing is substituted. Both reviewers said it has no measured beneficiary.
- This is placebo-c-Bravo's marooned side: the stone at 187.5 s fits no firing.

## 4. The actuator (`escapeStairUp`, `reflex.mjs`)

**The ceiling loop.**
- `ceilingAdmission` runs after `safeEmptyHand` and before `digChecked(b, 'ramp_breach')`.
- It runs only for the ceiling cell itself (dy === 2). A falling block resting on the ceiling keeps today's path.
- It returns:
  - `dig`: today's swing;
  - `replan`: the body moved, so plan again;
  - `moved`: the sidestep was taken, so re-breach from the new column, as the flood sidestep already does;
  - `stop`: `stopped` and `ceil` say why.
- A failed sidestep stops with its reason. It makes no fallback swing at the ceiling, because §2 says that swing cannot finish.

**`takeSidestep(side, { wetStart, frame })`.** With neither option it is today's function: the existing flood sidestep never
passes them, and a mutant flipping the default must turn the climb-flood suites red (§8). With `wetStart` (the bot is submerged)
and `frame` (the decision's own position):
1. **The frame.** If the body is no longer in the frame's cell after the hand change, the result is `displaced` and the breach is
   planned again (at most once).
2. **Steering.** The water-posture hold stands aside, through `steering(true)`, until the sidestep ends (Claude r1 P1-1).
   - The reflex tick's hold otherwise clears `forward` every 500 ms for a `no_air_route` float (Comet's state: 4,011 rows), and
     steers a `surface_out` itself.
   - The flag reaches the hold as `owned: rescuing || rampSteering`, so the hold returns false while the sidestep steers.
   - The sidestep holds the swim stroke (`jump`) itself, from the first dig to arrival. That is the same life support the hold
     gave.
   - The drowning rescue still preempts, through `yieldTo` at every boundary. On a yield the controls are left to it.
3. **The digs** go through `digChecked`, as today: the live flood check and the flow settle.
4. **The frame stands or is re-made.** After the digs and the falling settle:
   - a body still in the frame's x/z cell and at most one cell lower is re-checked in that frame;
   - any other displacement returns `displaced`.
5. **Both rechecks** call `floodSidestep(..., { wetFeet: true })`.
6. **The move.**
   - First, swim up: wait, at most 2 s, until the feet are at the target's floor or above.
   - Then forward and jump, re-asserted every 60 ms (nothing else may clear the stroke), for at most 2 s, stopping when the body
     enters the target cell.
   - There is no reliance on the ledge impulse. Codex r1 P1-4: `prismarine-physics` grants it only when the raised box holds no
     water. The test world has no impulse at all (§8), so a test passes only if the actuator gets the body up first.
7. **Arrival** requires the target x/z cell, `|y - floor(frame.y)| < 0.5` (the TARGET's floor, not the stale start height), and a
   head cell that is not water. Feet water is allowed.

**What Paper must show, because no unit test can.** Real fluid updates, real physics, and Comet's actual column. That means the
head cell stays dry once the ladder is gone, the swim stroke holds the height, and the forward move enters the cell. §9 holds
the scenes.

## 5. Escalation: a named stop and a flag, nothing else

CLAUDE.md requires a refusal to name a remedy the bot can perform. An escalation names none, and does not pretend to. It is an
UNRESOLVED ESCALATION: "this bot still needs help".

**What changes in the arms: almost nothing.** Both r1 reviews found real costs in the r1 hold and in the prerequisite suppression,
so both are gone:
- **No hold** (Codex r1 P1-5, Claude r1 P1-4).
  - The existing back-offs still pace the firings: `refusalEscalation` runs the ramp on every 4th refusal and backs off up to
    10 min; the marooned arm runs on its 120 s cooldown.
  - An escalated firing now costs about 1-6 s of settle with no swing, where it used to cost 60 s.
  - Every firing re-decides from the live world, so any change in terrain, effects, tools or position is seen at once, with no
    cancel rule to get wrong.
- **The prerequisite is unchanged** (Codex r1 P1-6, Claude r1 P2-8). A bot that can craft a pickaxe from its bag is still asked
  for one.
- **The entombed arm.** `else if (stair?.ceil?.moved)` resets the counters: a lateral exit is progress. On `escalate` it also calls
  `noteRescue`.
- **The marooned arm** calls `noteRescue` on `escalate`.
- **`rampStatus`** scores a lateral exit as success (Claude r1 P3-12).

**`_needs_rescue`** (status failed): at most one row per cell per 30 min (`rescueRowDue`). It carries:
- `arm= at= where=ceiling|step block= price_ms= left_ms= best_ms= env=`
- the decision's reason. For placebo-c-Bravo the reason says the stone is 187.5 s against a 60 s firing. Its grounded,
  eye-in-water price would be 37.5 s, so the flag line also prints `env=` (Claude r1 P3-14: the bot is kept afloat).

**The flag** goes in the fleetstatus header. It is staged as `scripts/host/ceilescape/patch_fleetstatus.py` for the coordinator
to run, in structcount's shape.
- It covers bots whose LATEST `_ceilescape` row in 3 h is `action=escalate`, with no later `moved`/`ceiling` row and no position
  change of more than 2 cells since. That way a rescued or freed bot drops off (Codex r1 P2-10).
- It has a positive control: the rows read, by kind.
- Why it is not in world-facts: world-facts is the bots' shared prompt store. chatgate-01 limits its hazard kinds, so a rescue
  flag there would be a comms change, out of scope.

## 6. Step 0, the observe-only pricing row

**`_ceilescape`**, one row per decision: every ceiling admission (affordable or not) and every step swing that did not fit.
- Fields: `where= at= block= held= grounded_ms= first_ms= env_ms= full_ms= left_ms= env= settled= cands= action=` and the reason.
- `action` is one of `ceiling`, `lateral`, `wait`, `escalate`, or `off` (under `CEILESCAPE=0`, where the arm runs today's code).
- `_ceilescape_mode` is written once per spawn: the licence, `on=0|1`.

**Rollout: the reviewers split.** Codex r1 says ship it first, alone, as a tier-1 owner-direct instrumentation rollout with a 48 h
read. Claude r1 says it can ride inside the canary, with a post-promotion fleet-wide tripwire on `_ceilescape action!=ceiling`.
r2 asks both again on the r2 design. The facts for the decision:
- **Codex's grounds.** Codex rested its case on findings 1-6. The r2 removes the hold, the prerequisite change and the
  substitution, and prices the real hand. What remains changes behaviour only at a swing that cannot finish (§2) and at a
  lateral exit.
- **Cost of a separate rollout.** It is a base change and voids the pre-built variants of every queued canary (ironsmelt-01's
  included).
- **What a 48 h read would size.** The tier (2 vs 3). §9 shows tier 2 is unavailable anyway: only two pools are exposed.
- **The fleet-wide population.** Inside the canary, only the canary pools write the row; the control pools run the base, which
  has none. So before promotion the fleet-wide size is only the logged lower bound (§1), which is Codex's point. A separate
  rollout would measure it before any behaviour ships. Riding inside measures it after promotion, from the tripwire read.

## 7. Composition

| guard | how it composes |
|---|---|
| **drowning rescue / homefix-02 air state** | `yieldTo` at every sample, dig, recheck and move. A yield leaves the controls to the owner, an unchanged contract. The entombed gate already waits for `pocketing`, `pocketPending` and `airPocketBreatheUntil`. |
| **float hold (water posture)** | Stands aside only while a submerged sidestep steers (`owned: rescuing \|\| rampSteering`). The sidestep holds the swim stroke itself. Everywhere else the hold is unchanged, including through the ceiling decision and its settle, where its jump keeps Comet pinned at y 40.2. |
| **poolescape-01** | Untouched. No hold now, so its second hook is reached exactly as today. Comet is not wading: its level-2 head water is not breathable by poolescape's predicate. |
| **keepout-01** | The lateral digs are reflex digs, which `keepoutDigGuard` never refuses (survival purpose), the same as every ramp dig. A live fire column vetoes the destination (`poolForbid`). |
| **protectzone, townground** | Ramp digs are survival-class, as today. |
| **flood check (climbflood-01/02)** | Every lateral dig still goes through `digChecked`. The existing flood sidestep is called without the new options. |
| **entombed / marooned arms** | Progress on `ceil.moved`; `noteRescue` on `escalate`; everything else byte-identical. |

**The chain, tested composed.** Run on the real `escapeStairUp` with the arms' own pure pieces (`refusalEscalation`,
`climbPrereqFor`, `rampStatus`), as `climb-flood-chain.test.mjs` does, over REPEATED firings:
- pillar refusal → escalation → ramp → lateral → re-breach → progress;
- pillar refusal → ramp → escalate → flag, with the prerequisite still written → the next firing re-decides.
The arms' wiring is asserted structurally: comments stripped, anchored, each assertion seen to fail by a mutant. Codex r1 P2-9
was right that `startReflexes` cannot be driven to these branches.

## 8. Tests

`bots/test/ceilescape.test.mjs` runs on `bots/test/ceilescape-world.mjs`.

**The test world.**
- A virtual clock: the global `Date.now`/`setTimeout`, this process only.
  - The REAL prices and the REAL 60 s budget, with no scaling (Codex r1 P2-9).
  - It reproduces the fleet's string exactly: the base on Comet's fixture stops `ceiling dig failed on copper_ore: dig exceeded
    60000ms` after 60 virtual seconds.
- Real prismarine-block 1.21.8 blocks.
- Fixtures copied from the region files, with water levels and the ladder's facing:
  `bots/test/fixtures/ceilescape-{board-a-comet,placebo-c-bravo}.json`, made by
  `docs/reports/ceilescape-01-2026-10-24/make_fixture.py`.
- A deliberately small body physics, with NO ledge impulse:
  - in water, `jump` rises 0.1/tick to the ceiling, and without it the body sinks at `sink`;
  - `forward` enters a cell only if the body fits it at its current height.
- A fake dig that waits `digTime` at its start, as mineflayer does, and rejects one tick after `stopDigging`.

**The cases.**
- **The pure decisions:** `ceiling` / `lateral` / `wait` / `escalate`, the full-budget rule, ranking by full cost (a geometric
  first with a copper new ceiling loses), dry-first ties, unknown prices; `firstSwingEscalation`; `cellFloods` cell by cell
  (above, a source, falling water on stone, falling water on water, level 7, waterlogged, unloaded); `envSettled`;
  `rescueRowDue`; `swingFits`.
- **The real `escapeStairUp`:**
  - **BASE** (`CEILESCAPE=0`) on Comet: one copper swing, `dig exceeded`. This is the positive control.
  - **CANDIDATE** on Comet:
    - it digs the ladder and the dirt and never the copper;
    - water flows into the feet cell before the first recheck;
    - the step east, head dry, re-breach from the open column, `ceil.moved`, `rampStatus` success.
  - **Sinking during the dig** (`sink` > 0 with the stroke released by a mutant, then not): the frame stands, the swim-up and
    forward reach the target.
  - **Displaced two cells:** `displaced`, one replan.
  - **The concurrent float hold:** a fake tick that clears `forward` every 500 ms unless `owned`. With `steering` wired the step
    lands; with it unwired (mutant) it does not.
  - **Water into the head cell before the recheck:** refused, no step.
  - **Lava at (361,40,187)** (beside the destination feet cell): E refused at the plan, escalate.
  - **A source above the head cell:** `cellFloods` refuses E.
  - **A second bearing whose new ceiling is copper:** the dirt one is chosen.
  - **placebo-c-Bravo's shaft:** escalate, no swing, at both of its heights (entombed at 37, marooned at 35).
  - **A dry airborne bot (a jump):** it settles, reprices grounded, and digs.
  - **An affordable ceiling:** the same dig sequence as the base.
  - **A held tool** (`stuckHand`): it is priced with the tool.
  - **Time left vs full budget:** with 20 s left, the copper is a `wait`, not an escalation.
  - **No escalation after a move.**
  - **A drowning yield mid-sidestep:** the controls are untouched, `yielded`.
- **The chain over repeated firings (§7)**, and the arms' wiring (structural, with mutants).
- **Mutants** (`withMutant`, anchor present and unique). Each must turn a named case red:
  - no affordability branch;
  - escalate on time left;
  - geometry-only ranking;
  - no `wetFeet` at the recheck;
  - no `cellFloods`;
  - no fire veto;
  - no settle;
  - forward not re-asserted, or `steering` unwired;
  - the arrival measured against the stale y;
  - the `wetStart` default flipped (must turn a climb-flood case red, or be shown not to; Claude r1 P3-13).
- **The existing suites stay green unmodified.**

Then the full `npm test` (`node scripts/run-tests.mjs`) and eslint `no-undef` on the changed files.

## 9. Paper, read, registration

**Paper.**
- **Setup.** Sandbox5-8 under the per-server lock, owner `ceilescape`. The driver is `sandbox/ceilescape/ceilescape-e2e.mjs`, on
  the poolescape driver's pattern: the whole bot, model off, so the float hold, the drowning rescue and the arms are all live.
- **The arena** is copied cell for cell with states from a FRESH read-only region copy (Claude r1 P2-9). It is 25 × 25 × 24
  around the column, so it includes the cascade's feed (sources about 10 up to the north-west); a drained arena is not Comet's.
- **Scenes:**
  - `comet`;
  - `noexit`: placebo-c-Bravo's shaft;
  - `lava`: lava behind the east dirt, encased;
  - `wethead`: a source set above (360,41,187);
  - `copper2`: a second dry bearing whose new ceiling is copper.
- **Runs.** BASE `3cc5f14d` against CANDIDATE on every scene, repeated firings (12 min a scene). The base is the positive control:
  it must log `dig exceeded` and stay.
- **Outcomes** come from RCON (position, health) and the build's own rows.

**Read** `scripts/host/ceilescaperead.py`.
- **The instrument is `bot.pos`** (all rows), not the rung's rows.
- **Primary, deterministic (Claude r1 P2-10: n = 1).** Did board-a-Comet leave? It counts as left when its x/z leaves
  359.0-360.0 / 186.0-188.0 or its y leaves 38.5-41.0, and it stays out 30 min. Each other canary bot that logs
  `_ceilescape action=lateral` is reported the same way.
- **Gates:**
  - **G1 deaths.** The owner's two-death floor (CLAUDE.md). A canary death within 120 s after a `_ceilescape` row on the same
    bot is reported as mechanism-linked, by name. Two of those, or the death gate, decide.
  - **G2 the unchanged promise** (a correctness REVERT). A `_ceilescape` row with `env_ms <= left_ms` and an action other than
    `ceiling`.
  - **G3 a swing past its price** (a correctness REVERT). A `_ceilescape action=escalate|wait` row followed within 60 s by a
    `dig exceeded` ramp stop on the same bot.
  - **ARMS:** the `_ceilescape_mode` licence on every canary bot, and none on control.
  - **LIVENESS / INSTRUMENT:** position coverage of at least 75 % for the named bots.
  - **EXPOSURE:** at least 1 `_ceilescape` row with an action other than `ceiling` in a canary pool.

**Registration.**
- The drawexposure requirement is `entombed_ramp_cut` + `marooned_ramp_cut` rows containing `dig exceeded`, at least 2 in 6 h.
- Today that is board-a and placebo-c only: two pools, so tier 2's four are unavailable. **TIER 3**, with
  `draw_require_pools: ["board-a", "placebo-c"]`: both exposed pools, where placebo-c exercises the escalation.
- An entry fragment only.

## 10. What it is NOT

- No tool-using ramp: the hands stay empty, as the ramp's invariant requires.
- No change to:
  - `canBreak`, `planDig`, `planDigSplit`, `headroomBreach`, `overheadBreakRisk`, `stairUpStep`, `chooseStairUpBearing`;
  - the pathfinder, the prerequisites, or the arms' cadence;
  - the existing flood sidestep.
- No new water reflex. The sidestep's swim stroke is part of its own move, and it yields to the air reflex.
- Not a fix for placebo-c-Bravo. It removes that bot's futile swings and raises the flag.
- The `surface` skill and the watchdog also dig Comet's copper with a 120 s limit. They are unchanged, and they stop on their
  own once Comet is out.

## 11. Review rounds

| round | Codex | Claude subagent | what changed |
|---|---|---|---|
| design r1 (03799f71) | CHANGES (6 P1, 3 P2) | CHANGES (4 P1, 6 P2, 4 P3) | r2:<br>- price the real hand (`bot.digTime`);<br>- per-swing in the step loop, with no substitution;<br>- the full-budget rule (`wait` vs `escalate`);<br>- wet feet at the plan, plus `cellFloods`;<br>- the frame passed and checked;<br>- the float hold stands aside while steering;<br>- forward re-asserted;<br>- swim-up before forward, no ledge impulse;<br>- no hold;<br>- the prerequisite unchanged;<br>- the flag consumes resolution;<br>- read gates on the death floor;<br>- the Paper arena includes the feed;<br>- the virtual-clock test world. |
