# ceilescape-01: never start a ramp swing that cannot finish; leave sideways, or flag for rescue (design r3 + records, 2026-10-24)

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
  - the ceiling, or some candidate, would fit a FRESH firing: the full budget minus the 5 s settle (`freshBudgetMs`). A
    swing that did not fit at its first price is re-priced only after that settle, so comparing it against the bare 60 s left
    a 1-5 s window in which every firing waited and none escalated (Codex r2 P2-5, Claude r2 P3-1).
  - The firing stops. The next one starts with a full budget and decides again. This is Claude r1 P1-3: an escalation is never
    raised because of time already spent on a gravel swing, a settle or an earlier step.
- **`lateral`**: the cheapest candidate with `costMs + 3,000 <= leftMs`. Ties go dry-first, then in facing order.
- **`escalate`**: nothing fits even a fresh firing. This is a named stop plus the `_needs_rescue` flag (§5).
- **The block priced is the block swung at** (Codex r2 P1-2). If the ceiling changed during the settle (a different name or
  state), the breach is planned again, never priced as the new block and dug as the stale one.

**A candidate's cost.**
- Its digs at the price they will be dug at. That means the held item and the eye-level water now, and OFF the ground when the
  bot is submerged, because the sidestep swims while it digs (Claude r1 P2-6).
- Plus 250 ms (look and hand) and the 300 ms flow settle per dig.
- Plus 500 ms falling settle once if anything was dug.
- Plus the move: 4,500 ms, for the look, a swim-up of at most 2,000 ms and a forward of at most 2,000 ms.
- Plus the new column's ceiling at the ARRIVAL state (Codex r2 P2-6):
  - the hand held now, since a kept tool stays kept;
  - this bot's effects and enchantments;
  - a dry eye, because the head must breathe;
  - off the ground whenever the feet may be wet on arrival (a submerged start's dug feet cell can flood after the plan);
  - plus its own overhead, flow settle and falling settle.
  - It is 0 when that cell is open.
- Any unknown price makes the candidate unaffordable.

**The candidates** are the `escapeBearings(yaw)` bearings that pass every filter below:
- **`floodSidestep`**, the existing planner with its flood, lava, tread and new-ceiling rules. A SUBMERGED bot plans with
  `wetFeet: true`.
  - So water in the destination feet cell is allowed: water that flowed into a dug exit must not make that exit
    un-retryable (Codex r1 P1-3).
  - A waterlogged destination head block is refused.
- **`cellFloods` on the destination head cell**, for a submerged bot. The shared flood check exempts water for a submerged bot,
  so nothing else asks this. It is CONSERVATIVE BY CONSTRUCTION (Codex r2 P1-3, Claude r2 P3-4): every water neighbour floods the
  cell EXCEPT the one case vanilla's FlowingFluid.spread provably keeps out.
  - **The exemption:** a flowing or falling (non-source) water cell whose cell BELOW is plain water (a water hole: it flows down,
    never sideways), and which has NO source beside it. Vanilla also spreads sideways after flowing down when 3 sources neighbour
    it; any source refuses here. Level 7 is vanilla's last level and spreads nowhere.
  - **Everything else refuses:**
    - water above;
    - a source beside the cell, or a waterlogged block (which holds a source);
    - flowing water over air, over a waterlogged block, or over any other non-water cell;
    - an unreadable level;
    - an unloaded cell.
  - Face occlusion is ignored, which can only refuse more.
  - The sidestep RE-ASKS it before the move, after the digs (a feed that opened during them).
  - It refuses Comet's W bearing (falling water resting on stone beside the head dirt). It passes E on exactly the exemption: the
    bot's own level-2 head water rests on falling water and has no source beside it.
- **No live fire column is entered** (`poolForbid`, as poolescape has it).
- **No falling block above a solid new ceiling.** That column would need several swings the cost model does not price.

**The step loop: per swing (§2), and with no substitution.**
- Before EACH step dig, if `digPriceOf` does not fit the time left, the settle above runs once, the swing is priced again (on
  the same block: a changed cell stops the step), and if it still does not fit the step stops there with no swing. Cells
  already cleared stay cleared.
- It escalates only on the firing's very first swing (`steps === 0`, nothing dug yet, no sidestep), through
  `firstSwingEscalation`.
  - **The chooser's bearing decides** (Codex r2 P2-5). The loop picks the same bearing again from the same cell, so another
    bearing that could start is NAMED in the reason ("could start but is not the chooser's"), not counted as a way out.
  - **A bearing whose step needs no swing** is a move the bot has (Claude r2 P2-2). It is priced 0, and a firing with one is
    never escalated.
  - Otherwise, if the chosen swing does not fit a fresh firing, the result is `escalate`; if it does, `wait`.
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
1. **The frame.** After the hand change (an await), the owner is asked again before a single control is set, and a body no
   longer in the frame's cell returns `displaced`; the breach is planned again (at most once) (Codex r2 P1-4).
2. **Steering.** The water-posture hold stands aside, through `steering(true)`, until the sidestep ends (Claude r1 P1-1).
   - The reflex tick's hold otherwise clears `forward` every 500 ms for a `no_air_route` float (Comet's state: 4,011 rows), and
     steers a `surface_out` itself.
   - The flag reaches the hold as `owned: rescuing || rampSteering`, so the hold returns false while the sidestep steers. It is a
     COUNT, so two overlapping sidesteps cannot clear each other (Claude r2 P3-5).
   - The stranded lattice, the one other steerer of a wet unowned body, also stands aside: its trigger gains `!rampSteering`
     (Claude r2 P2-1; Comet logs about 28 ride_floor_down runs a day).
   - The sidestep holds the swim stroke (`jump`) itself, from the first dig to arrival. That is the same life support the hold
     gave.
   - The drowning rescue still preempts, through `yieldTo` at every boundary. On a yield the controls are left to it.
   - The hold standing aside ends its `water_no_air_route` row ("no longer in water") and a new one starts after the sidestep:
     the production report's no-air-route series shows a seam at a sidestep (Claude r2 P3-6), named in the read.
3. **The digs** go through `digChecked`, as today: the live flood check and the flow settle.
4. **The frame stands or is re-made**, for every frame-carrying sidestep, wet or dry (Codex r2 P1-4). This is checked after the
   digs and the falling settle, and again IMMEDIATELY BEFORE THE STROKE (after the look and the swim-up, both awaits):
   - a body still in the frame's x/z cell and at most one cell lower stands in the plan;
   - any other displacement returns `displaced`.
5. **Both rechecks** call `floodSidestep(..., { wetFeet: true })`, and then `cellFloods` on the head cell is asked again.
6. **The move.**
   - First, swim up: wait, at most 2 s, until the feet are at the target's floor or above.
   - Then forward and jump, re-asserted every 60 ms (nothing else may clear the stroke), for at most 2 s, stopping when the body
     enters the target cell.
   - There is no reliance on the ledge impulse. Codex r1 P1-4: `prismarine-physics` grants it only when the raised box holds no
     water. The test world has no impulse at all (§8), so a test passes only if the actuator gets the body up first.
7. **Arrival.**
   - It first lets a stroke that carried onto dry ground land (at most 600 ms more; Claude r2 P3-2).
   - It then requires the target x/z cell, `|y - floor(frame.y)| < 0.5` (the TARGET's floor, not the stale start height), and a
     head cell that is not water.
   - Feet water is allowed.

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

**`_needs_rescue`** (status failed): at most one row per cell per 30 min, counted per cell over the bot's 8 newest cells, so
a bot that alternates between two cells (placebo-c-Bravo's two heights) is not reset by each change (`rescueRowDue`, Claude r2
P3-3). It carries:
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

**Rollout: DECIDED at r2, both engines: it rides INSIDE the canary.** Codex r2: "MAY RIDE INSIDE THE CANARY ... An extra base
change is not justified solely to size this narrowed population", given tier 3 with board-a and placebo-c required, the
predeployment validation, and a committed post-promotion fleet-wide tripwire read. Claude r2: still inside. The tripwire is part
of the read (section 9): after promotion, every `_ceilescape` row with `action` other than `ceiling` fleet-wide, by bot, for
48 h -- the population the step-0 row was for. The r1 split and the facts it turned on:
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
- **The existing suites stay green**, unmodified except body-claim.test.mjs's two arm delimiters (now anchored on the outer
  chain's flood arm; a meta-test shows the re-anchored window still fails with that arm deleted).
- **What the test world cannot see (Claude code r1 P3-5)**, which is why the Paper scenes matter:
  - forward is 0.2 a tick in water, generous next to real swimming; the 2 s windows absorb it;
  - there is no lookAt latency, so no near-miss timeout ever appears;
  - water flow is scripted per test, not simulated;
  - a dry body drops to its floor in one tick and never ground-jumps, so the 600 ms landing wait is not exercised here.
- **The sink case** uses a SLOW swimmer (`rise` 0.015/tick) that sinks a full cell on the LAST dig, so the frame's
  sank-one branch and the swim-up wait really run (the stroke starts with the body still below its target floor); the
  no-swim-up mutant then never enters (Claude code r1 P1: at 0.1/tick the stroke alone restored the height, and the old
  mutant could not fail).

Then the full `npm test` (`node scripts/run-tests.mjs`) and eslint `no-undef` on the changed files.

## 9. Paper, read, registration

**Paper.**
- **Setup.** Per-server locks, owner `ceilescape`. sandbox5-8 were all held by other agents on 10-24 (lavastep, failmine),
  so the runs used sandbox, sandbox2 and sandbox3 (the same registry and lock check). The driver is `sandbox/ceilescape/ceilescape-e2e.mjs`, on
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
- **A death is not an escape** (Claude code r2 P1): only positions before the bot's first post-deploy `_death` count, and a
  bot that dies first reads `died`.
- **Primary, deterministic (Claude r1 P2-10: n = 1).** Did board-a-Comet leave? It counts as left when its x/z leaves
  359.0-360.0 / 186.0-188.0 or its y leaves 38.5-41.0, and it stays out 30 min. Each other canary bot that logs
  `_ceilescape action=lateral` is reported the same way.
- **Gates:**
  - **G1 deaths.** The owner's two-death floor (CLAUDE.md). A canary death within 120 s after a `_ceilescape` row on the same
    bot is reported as mechanism-linked, by name. Two of those, or the death gate, decide.
  - **G2 the unchanged promise** (a correctness REVERT). A `_ceilescape` row on a bot whose newest `_ceilescape_mode` licence is
    `on=1`, with `env_ms <= left_ms` and an action other than `ceiling`. The rollback's `action=off` rows are exempt (Codex r2
    P2-7).
  - **G3 a declined swing that was swung anyway** (a correctness REVERT). This is judged per FIRING, by its ID (Codex code
    r2 P2): every `_ceilescape` row carries `fire=<id>` from its escapeStairUp call, and the arms' ramp_cut rows carry the same
    `fire=`, so a stranded lattice's stair_up (rows, no ramp_cut) never joins another firing. The gate trips when the firing's last `_ceilescape` row says `wait` or `escalate`
    and its ramp_cut row reads `dig exceeded`.
    - REPORTED, not gated (Claude r2 P2-3): firings whose last row says `ceiling` and which still end `dig exceeded`. There are
      two kinds:
      - `env_ms > left_ms - 1000`: a near miss, today's behaviour. There is no reserve on purpose, and mineflayer prices before
        its look.
      - otherwise: the price model is wrong. Two or more of these is a WATCH.

  - **ARMS:** the `_ceilescape_mode` licence on every canary bot, and none on control.
  - **LIVENESS / INSTRUMENT:** position coverage of at least 75 % for the named bots.
  - **EXPOSURE:** at least 1 `_ceilescape` row with an action other than `ceiling` in a canary pool.

**Registration (measured 10-24 05:00Z).**
- `drawexposure.py` (6 h; `entombed_ramp_cut` containing `dig exceeded`, at least 2 per pool) finds **board-a only**
  (26 rows); every other drawable pool reads 0. placebo-c is NOT drawable at all: `drawrec.sh` never takes placebo-c or
  isolated-* (drawrequire.py). So the escalation path cannot be exposed by the canary; Paper exercises it (`noexit`).
- One exposed pool, not tier 2's four: **TIER 3**, with `draw_require_pools: ["board-a"]` and no kind-based
  `draw_exposure` requirement (poolescape-01's shape: a one-pool requirement makes drawexposure refuse, "two are needed").
  Exposure is the read's: at least 1 canary `_ceilescape` row with an action other than `ceiling`.
- **The flag's first live run is after promotion** (Claude code r2 P3-2): the post-promotion `--fleet` tripwire must show,
  within 3 h, placebo-c-Bravo writing `action=escalate` and the fleetstatus header printing `!! needs rescue ... placebo-c-Bravo`.
- An entry fragment only: `docs/reports/ceilescape-01.queue-entry-fragment.json` and the registrations
  `docs/reports/ceilescape-01.<sha8>.json`.

## 9a. Paper results (10-24, the final candidate 37ebba2b against the base 3cc5f14d)

**The driver.** `sandbox/ceilescape/ceilescape-e2e.mjs` is on branch `ceilescape-sandbox-1024`. That branch is origin/main plus
the driver and the registry test's wired count, 19 → 20.
- Driver reviews: Claude r1 CHANGES, r2-r9 APPROVE; Codex r1-r8 CHANGES, then **r9 APPROVE (520cd12b)**. Every round after
  r2 made the classification stricter. None of them can turn a run into LEFT.
- **LEFT** means all of the following:
  - out of the TRAP: the column, plus each of its eight neighbours that held water at setup;
  - feet and head confirmed not fluid (water, bubble column, lava, or a waterlogged block), held 30 s to the last observed poll;
  - the scene still set at the end (the column's water and ceiling);
  - alive and in the arena.
  - This is stricter than the design's arrival, which allows wet feet.
- **INVALID**, never a negative, if any of these fails: the rows were read; the build's own licence is present (candidate
  on=1) or absent (base: no `_ceilescape` rows); the sha matches; at least 80% of polls observed position and health; the
  bot is alive and connected; no block observation failed.
- Before measuring, every scene edit, the live bag (by id and count), the teleport height and a fresh body (health 20,
  food 20) are verified.
- A base STAYED counts as the positive control only when the scene held AND the base logged its futile `dig exceeded`.

**The clean set (r9 driver; 10 of 10 valid; 12 min a scene; per-server locks on sandbox, sandbox2 and sandbox3, because
sandbox5-8 were held by other agents).** The record is `docs/reports/ceilescape-01-paper-2026-10-24.jsonl`.

| scene | BASE 3cc5f14d | CANDIDATE 37ebba2b |
|---|---|---|
| comet (the live column) | STAYED, control (3 × `dig exceeded` on the copper) | **LEFT** east: 1 lateral; ladder + dirt dug, copper intact; health 20 |
| copper2 (a dry south decoy with a copper new ceiling) | STAYED, control | **LEFT** east, not south: the dearer decoy untouched |
| lava (lava behind the east feet cell) | STAYED, control | STAYED, 4 escalations, nothing dug, lava intact, health 20 |
| wethead (a source beside the east head cell) | STAYED, control | STAYED, 4 escalations, nothing dug (cellFloods), health 20 |
| noexit (placebo-c-Bravo's shaft) | STAYED, control | STAYED, 4 escalations, no swing, 1 `_needs_rescue`, health 20 |

**Before r9.** The r1 driver runs on da0d07b0 and 8685e231 read the same outcomes. The r2 driver measured nothing: its bag
check refused every run at a truncated RCON reply.

## 9b. The failure-mining input (coordinator 10-24): chain B is a different dead end

`failmine-1024` (b9994cb0) found four week-long wet-under-ceiling bots, failing through two chains:
- **A** (`_entombed` → `_maroon_climb_refused` → ramp "dig exceeded"): board-a-Comet and placebo-c-Bravo. This is ceilescape-01.
- **B** (`_climb_flood_guard` / `_climb_flood_refused`): isolated-c-Alpha and placebo-d-Delta. The scene cuts, decoded:
  - both bots wade with the head in AIR, so the flood check has no submerged exemption;
  - the dirt ceiling has one wet face: isolated-c-Alpha's N is water[1] on granite, placebo-d-Delta's N is a source on stone;
  - every lateral bearing is wet;
  - **no swing is ever attempted**, so there is no price problem.

**Both engines: DIFFERENT** (Codex and Claude, independently, on the cuts).
- B is a CORRECT flood refusal.
- ceilescape-01 as built does not touch it: the flood refusal comes before `ceilingAdmission`, and the flood sidestep runs
  without the new options.
- The remedy is a separate design: PLUG the wet face first, then cut, reusing poolescape-01's plug planner, as a rung in the
  flood branch for an entombed, unsubmerged bot. Both bots hold 77-192 cobblestone.
- poolescape never takes these bots: maroonState is 'none' for an entombed bot, and poolStep needs a floor and headroom.
- Relaxing the flood guard is rejected (the drownings history). A bucket answers only a source, not flowing water.

So ceilescape-01 stays scoped to chain A, and B is proposed as its own fix. The library gate below confirms that B is not
regressed.

**The library gate** runs the failmine tree's own `scene-e2e.mjs` and `abVerdict`, 3 base and 3 candidate runs per scene, on
sandbox6-8 under `failmine` per-server locks:
| library scene (failmine b9994cb0) | chain | base (3 runs) | candidate 37ebba2b (3 runs) | verdict |
|---|---|---|---|---|
| stuck-1899-board-a-359_40_187 | A | stayed ×3 (as the fleet) | **escaped ×3** (first in 241 s) | **PASS** |
| stuck-1899-placebo-c-559_37_219 | A, no exit | stayed ×3 | stayed ×3: 2 `_ceilescape` escalations and 1 `_needs_rescue` per run, no timed-out swing | FAIL, as designed: the escalation case |
| stuck-1899-isolated-c-356_47_176 | B | stayed ×3 | stayed ×3 | FAIL, out of scope (chain B) |
| stuck-1853-placebo-d-198_34_187 | B | stayed ×3 | stayed ×3; the same row kinds as the base, and no `_ceilescape` row | FAIL, out of scope (chain B): not regressed |

The record is `ceilescape-01-2026-10-24/failmine-library-gate.jsonl`.

The library's own whole-family verdict for "stuck" is therefore **FAIL**. It is honestly so, because ceilescape frees one of
the four bots:
- placebo-c-Bravo has no exit a bare hand can afford. It gets the flag instead of the futile swing.
- isolated-c-Alpha and placebo-d-Delta need the separate plug-then-cut fix (above).
- No library scene's base failed to reproduce, and no candidate run regressed a base behaviour.

**The tier is unchanged.** drawexposure (6 h and 24 h, `entombed_ramp_cut` containing `dig exceeded`) finds board-a only,
because chain A's other bot is in placebo-c, which is never drawable. placebo-d belongs to chain B, so it is not this fix's
population. TIER 3 stands.

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
| design r2 + code (09e02b96) | CHANGES (3 P1, 3 P2); r1 P1s all RESOLVED; step 0 inside | APPROVE (4 P2, 7 P3); step 0 inside | r3:<br>- the block priced is the block swung at (replan on change);<br>- `cellFloods` conservative (only water-over-water with no source beside is exempt) and re-asked before the move;<br>- frame checks for every frame-carrying sidestep, after the hand change and immediately before the stroke;<br>- `wait` judged on a fresh firing (minus the settle);<br>- the chooser's bearing decides the step escalation, a free step is a move;<br>- the new ceiling priced at the arrival state, with its settles;<br>- the stranded lattice stands aside; steering a count;<br>- arrival waits for the landing;<br>- rescue rows per cell;<br>- G2 exempts `off`, G3 per firing with a near-miss report;<br>- tests: 60, incl. CEILESCAPE=0 vs the BASE module trace for trace on four scenes. |
| code r1 (da0d07b0) | CHANGES (1 P1, 3 P2); r2 design P1s RESOLVED except the recheck | CHANGES (1 P1 test-only, 4 P2, 5 P3) | r4:<br>- the destination (tread, lava, head flooding) and the frame asked AFTER the swim-up, immediately before the stroke;<br>- the steering counter raised inside the try;<br>- the sink case on a slow swimmer, with a real no-swim-up kill and a lava-during-the-rise case (killed by the old order);<br>- Bravo's marooned step admission asserted unconditionally;<br>- the read: the column box of section 9, the licence at each decision's time, G3 bounded to a firing's own rows;<br>- the trace comparison loads the base scaffold.mjs too;<br>- rescue_line() selftested on a fake EsEvents. |
| code r2 (79bbdc71) | CHANGES (2 P2, read only); r1 all RESOLVED | CHANGES (1 P1 read-only, 3 P3) | r5:<br>- a death is not an escape (the primary reads only pre-death positions: `died`);<br>- the liveness gate reads the latest licence;<br>- G3 pairs rows by a FIRING ID (`fire=` on every `_ceilescape` row and on both arms' ramp_cut rows);<br>- floodBranch passes the steering flag too;<br>- the post-promotion check for the flag named. |
| code r3 (8685e231) | **APPROVE** (all r2 RESOLVED, no findings) | **APPROVE** (3 P3) | r6 (tests and the read's header only; bots/src unchanged): mutants for the five new wiring assertions (flood-branch steering x2, floodBranch's own call, both ramp_cut `fire=` lines); the G3 blind spot (floodBranch and lattice firings write no ramp_cut row) named in the read's header. |
| Paper driver r1-r10 | r1-r8 CHANGES, **r9 APPROVE** (520cd12b) | r1 CHANGES, r2-r9 APPROVE | the clean ten-scene set ran on r9; r10 adds kelp/seagrass to the fluids (neither arena holds any) |
| scope: chain B (failmine) | **DIFFERENT** | **DIFFERENT** | ceilescape stays scoped to chain A; plug-then-cut proposed separately; library gate (section 9b) |
