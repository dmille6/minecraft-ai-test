# ceilescape-01: never start a ceiling dig that cannot finish; leave sideways, or ask for rescue (design r1, 2026-10-24)

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

## 2. The fact the design rests on: a dig whose start price exceeds the time left never finishes

1. **mineflayer fixes the dig's wait when the dig starts.** Its `bot.dig` computes
   `waitTime = bot.digTime(block)`, which is `block.digTime(heldType, creative, eyeLevelBlockIsWater, !onGround, ...)`, and sets
   `setTimeout(finishDigging, waitTime)` (mineflayer `lib/plugins/digging.js:27, 135, 248-252`).
   - `digEnv(bot)` (`digbudget.mjs:191`) mirrors those inputs argument for argument.
   - A change of state after the start does not shorten the wait.
2. **`digBounded` stops the dig at `min(budget, time left)`** (`reflex.mjs:5833`), with `stopDigging`.
3. **Vanilla discards the progress of an aborted dig.** A later dig starts from zero.

So when `predictedDigMs(block, null, digEnv(bot)) > deadline - now` at the moment of the swing, that swing cannot complete, and
it leaves nothing behind. Today the ramp makes that swing:
- it holds the body for the rest of its budget (up to 60 s);
- it returns `ceiling dig failed ... dig exceeded`;
- after four of those, the entombed arm asks the goal layer for materials the bot cannot reach.

**Declining that swing removes no move that could have worked.** This is the property that lets the new branch compose with
every existing guard: it acts only where today's action is certain to fail.

The registry stays the only source of hardness. `canBreak` and the refusal stay on the GROUNDED price (`dig-split.test.mjs`
pins that, and this design keeps it). The environmental price is used only to ask "can this particular swing finish in the
time left", which is the question the deadline already answers one line later.

## 3. The decision (pure, `bots/src/ceilescape.mjs`)

`ceilingEscapeDecision({ ceilingMs, leftMs, candidates })`:
- **`ceiling`**: today's code, unchanged. Returned when `ceilingMs` is unknown (null: test fakes, modded blocks; `planDig`
  treats unknown as "try it", so this does too) or `ceilingMs <= leftMs`.
- **`lateral`**: otherwise, the cheapest affordable candidate, where `costMs + CE_RESERVE_MS <= leftMs`. Ties go in the facing
  order that `escapeBearings` gives. A candidate's cost is:
  - the sum of its digs at the CURRENT environmental price (the bot digs them from where it is);
  - `FLOW_SETTLE_MS` (300) per dig, and `FALLING_SETTLE_MS` (500) once if anything was dug;
  - `CE_MOVE_MS` (2,000): the look, at most 1,500 of forward, and the 250 settle;
  - the new column's ceiling at the GROUNDED-DRY price (the destination is dry by plan, §4; 0 when that cell is open).
  - A candidate with any unknown price is never affordable. "I cannot price it" is not "it is cheap".
- **`escalate`**: otherwise. It carries the reason, worded for the row:
  `no affordable ramp exit: ceiling <block> <s>s against <s>s left; best bearing <dir> <s>s (<why>) | none (<why>)`.

**The candidates** are each `escapeBearings(yaw)` bearing for which `floodSidestep` (`scaffold.mjs:838`) returns `ok`, with
exactly today's flood, lava, tread and new-ceiling rules. Two filters are added:
- **The destination feet cell must be dry at plan time.** This is already true: `floodSidestep` refuses an empty water cell
  there.
- **A live fire column is never entered** (`poolForbid` / `routeForbids` on the feet and head cells, as poolescape has it).

`CE_RESERVE_MS` = 3,000 covers the stabilisation sample and the yield checks. `ceilingMs <= leftMs` carries no reserve on purpose:
an affordable ceiling must take exactly today's path (§8, the "unchanged" mutant).

**Repricing waits for a stable state (the brief's item 2), bounded.**
- Only an UNAFFORDABLE first price triggers it. An affordable price goes straight to today's dig, with no wait added.
- Then `settledEnv` samples `{onGround, eyeWet}` every `CE_SETTLE_SAMPLE_MS` (1,000) until two consecutive samples agree, or
  `CE_SETTLE_MAX_MS` (5,000) has passed. It reprices from the last sample.
- It asks `yieldTo` at every sample. A drowning rescue that takes the body ends the firing, as it does today.
- A jump in progress (dry and airborne) lands within the wait and reprices grounded.
- A bot that is still unaffordable after that takes the lateral branch or escalates.
- Comet floats in a steady state (eye cell water, airborne), so it is priced once more and stays at 375 s.

**The first step gets the same rule** (placebo-c-Bravo's 495 marooned rows). At `steps === 0` in the step loop, before the first
dig of the chosen bearing's step, it prices that step's digs at the environmental price.
- If they do not fit the time left, the code settles and reprices as above.
- If they still do not fit, the step is substituted: the cheapest AFFORDABLE first step among the bearings that `stairUpStep`
  allows is taken instead (`stepEscapeDecision`).
- If there is none, the result is `escalate` ("no affordable first step: ...").
- At `steps > 0` nothing changes, because progress has been made and the next firing resumes from the top.
- The step's bearing choice (`chooseStairUpBearing`, by runway) is untouched wherever its step is affordable.

## 4. The actuator (`escapeStairUp`, `reflex.mjs:4464`)

**The ceiling loop.**
- The new code runs immediately before `digChecked(b, 'ramp_breach')`, and only when `ceilEscapeOn()` and `plan.dig[0]` is the
  ceiling cell itself (dy === 2). A falling block resting on the ceiling (dy === 3) is not priced: it keeps today's path.
- On `lateral`, and only when `sidestepped === 0`, it calls `takeSidestep(side, { wetStart: submergedAt(bot) })`.
  - `true`: `sidestepped++` and `continue`. The breach is planned again from the new cell, as the flood sidestep already does.
  - `'displaced'`: the loop re-plans from where the bot now is, at most `CE_REPLANS` (1) times.
  - Anything else: stop with the sidestep's reason. No fallback swing at the ceiling is made: §2 says it cannot finish.
- On `escalate`: stop with the reason and set `ceil = { action: 'escalate', where: 'ceiling', ... }`. No swing.
- `finish()` returns a new field, `ceil`: `null` when the branch never ran, otherwise `{ action, where, ceilingMs, leftMs, bestMs,
  bear, reason, moved }`.

**`takeSidestep(side, { wetStart = false })`.** With `wetStart` false it is byte-for-byte today's function. The existing flood
sidestep (`reflex.mjs:4670-4716`) never passes the option. With `wetStart` true (the bot began the sidestep submerged), this is
the brief's items 3 and 4:
1. **Hold `jump` while it digs** (the swim stroke keeps the height). It asks `yieldTo` at every boundary, as today. On a yield
   the controls are left to the new owner. Otherwise the jump is released before the move.
2. **After the digs and the falling settle, read the position again.**
   - The target is the planned cell in the ORIGINAL frame: `fx, fz`, and the tread at `floor(p0.y) - 1`.
   - The bot may have sunk while digging (Comet's rows show y 39.0 as well as 40.2). If it is still in the same x/z cell and its
     feet are at most one cell lower, the plan stands: the rechecks run in that same original frame, as they do today.
   - Any other displacement (horizontal, or more than one cell down) returns `'displaced'`, and the loop re-plans from scratch.
3. **Both rechecks** call `floodSidestep(..., { wetFeet: true })`.
   - The new `wetFeet` option accepts an EMPTY water cell in the destination FEET cell only. That is water that flowed into the
     dug cell; the brief's fixture has exactly that.
   - It still requires a dry, solid tread, a head cell that is breathable (passable and not water), no lava in or beside the
     cells, and the new ceiling rules.
   - `wetFeet` defaults to false, so every other caller is unchanged.
4. **Move with forward + jump** for at most 1,500 ms, stopping when the bot enters `fx, fz`; then release and settle 250 ms.
   - The jump is what climbs the one-cell rise after a sink: the poolescape physics, `prismarine-physics` index.js:499, gives a
     horizontally collided bot in water vel.y 0.3.
5. **Arrival** requires the target x/z cell and `|q.y - floor(p0.y)| < 0.5`, measured against the TARGET's floor and not the
   stale start height. It also requires a head cell that is not water. Feet water is allowed.

**What the plan refuses, deliberately (a departure from the brief's item 4).** The brief accepts water in the destination feet
cell "at the plan" for a bot that started submerged. This design accepts it only at the rechecks and on arrival, and plans only
dry destinations.
- The reason is measured on Comet's W bearing. Its feet are water, so a wet-feet plan would rank it CHEAPEST: the head dirt at
  18.75 s plus an open-ish new column, against E's 33.75 s.
- But its head dirt sits beside falling water on stone, so digging the dirt floods the head cell. The recheck would refuse,
  after the bot had spent 19 s and opened one more water cell beside its only breathing margin.
- A wet destination is still reachable: it is simply never the reason a bearing wins.
- The brief's own concern (the dig-then-refuse when water flows INTO the dug feet cell) is fully covered by the rechecks and
  arrival accepting it.

## 5. Escalation: a named refusal, a hold, no prerequisite, a flag

CLAUDE.md requires a refusal to name a remedy the bot can perform from where it is. This branch names none, and it does not
pretend to. The outcome is an UNRESOLVED ESCALATION, as the brief says: "this bot still needs help".

**The rows.**
- **`_needs_rescue`** (status failed), once per escalation. Its detail:
  `arm=entombed|marooned at=x,y,z where=ceiling|step ceiling=<block>:<ms> left=<ms> best=<dir>:<ms>|none env=g<0|1>w<0|1> hold_min=30
  -- <reason>`.
  - Nothing else in the fleet writes this kind.
- **`_needs_rescue_cancel`**, when a hold ends early, naming why.

**The hold** (`rescueHoldStep`, pure). The `rescueHold` object is shared by both arms, so one escalation quiets both.
- **What it holds.**
  - The entombed arm does not fire while it is held: its gate gains `&& !rescueHeld()`.
  - The marooned arm's `need_scaffold` branch skips ONLY the ramp while held, and reports it as
    `ramp: held (needs rescue since <t>)`. `harvestAdjacent`, the underfoot dig and poolescape's second hook still run, so
    nothing that can move the bot is removed.
- **No prerequisite.** On an escalated or held firing, neither arm writes `pendingPrereq` (`climbPrereqFor` /
  `scaffoldPrereq`): the material loop the brief names.
  - The `_entombed_needs_blocks` / `_marooned_needs_scaffold` rows still write, so their denominators are kept. Their detail
    says `escalated: needs rescue` in place of "asked the goal layer".
- **It ends** at 30 min (`CE_HOLD_MS`), or earlier on any change that can change the price or the remedies:
  - the bot's x/z cell changes;
  - its feet floor leaves `[anchor - 2, anchor + 2]`. That band is wider than both measured bobs: Comet's floor 39-40 and
    placebo-c-Bravo's 35-37. Without it, the hold would cancel on every bob.
  - the inventory key changes: tools by name, and the placeable-block count the pillar uses;
  - a STABLE environment with fewer dig penalties than the one the escalation was priced in: the same `{onGround, eyeWet}` on two
    samples at least 1 s apart.
  - **Departure from the brief:** the brief cancels on ANY onGround or eye-water change. A bobbing bot flips both every few
    seconds, so a hold that ended on a flip would not hold at all. A change toward a cheaper price is the case the brief cares
    about, and that is the case kept.
- **On expiry or cancel** the next firing re-runs the whole arm and reprices. A bot that still has no exit writes a new
  `_needs_rescue` (about 2/h at most per bot).

**The flag** goes in the fleetstatus header. It is host-side and staged as `scripts/host/ceilescape/patch_fleetstatus.py`, which
the coordinator runs, in the same shape as structcount's patcher.
- One line: `needs rescue: <bot> at x,y,z (<arm>, since <first row in 3 h>)` for every bot with a `_needs_rescue` row in the
  last 3 h.
- It has a positive control: the line prints `needs rescue: none (N rows of kind ... read)` when there are none.
- It is surfaced, not logged into a file nobody reads (the 10-20 ELK lesson).
- **Why not world-facts.** The brief named "world-facts" as the flag's home. World-facts is the bots' shared prompt store
  (chatgate-01 limits its hazard kinds to `entombed`, `drowning` and `suffocating`), so putting a rescue flag there would place it
  in other bots' prompts. That is a comms change, and out of scope. A human or the overseer reads the fleetstatus line.

## 6. Step 0, the observe-only pricing row: it rides inside the canary

**`_ceilescape`**, one row per decision: at every ramp ceiling admission and every first-step admission, affordable or not. It
records:

`arm= at= where=ceiling|step block= grounded_ms= env_ms= left_ms= env=g<>w<> settled=<ms|-> cands=E:33750+...|- action=ceiling|lateral|escalate|off
outcome=dug|moved|refused:<why>|escalated`

Volume: the fleet's ramps fired about 370 times a day over the 7 days, so a 20-bot draw writes a few dozen rows a day.

**Proposal, for the reviewers to decide: it rides inside the canary as a reported line, not as its own tier-1 rollout.**
- **Cost.** A separate owner-direct rollout is a base change. It would void the pre-built variants of every queued canary
  (ironsmelt-01's included), and the coordinator asked to avoid that if the evidence allows.
- **Why the evidence allows it.**
  - The row cannot change a decision. With `CEILESCAPE=0` (the rollback) it still writes `action=off` plus what the decision
    WOULD have been, and the arm runs today's code.
  - The population question it answers ("how many bots does the new branch reach?") has a hard lower bound already (§1: three
    bots in 7 days).
  - By §2, the branch acts only where today's swing is certain to fail. So a larger population changes how much the canary can
    gain, not what it can break.
- **Tier.** The tier is chosen on the logged population (§9). The canary's read reports the `_ceilescape` rows, so the 48 h
  sizing comes out of the canary's own pools. The fleet-wide size is read after promotion from the same row.

## 7. Composition (each guard, and the chain)

| guard | how it composes |
|---|---|
| **drowning rescue / homefix-02 air state** | `yieldTo` at every sample, dig, recheck and move; a yield leaves the controls to the owner (unchanged contract). The entombed gate already waits for `pocketing`/`pocketPending`/`airPocketBreatheUntil`; the hold never blocks the drowning or air-pocket reflexes (they have their own gates). |
| **poolescape-01** | Not on Comet's path (`wading` needs a breathable head: level-2 water is not). The hold does NOT skip poolescape's second hook; a wading bot whose ramp escalated still gets the pool rung. |
| **keepout-01** | The lateral dig is a reflex dig (survival purpose, `guardPurpose`), which `keepoutDigGuard` never refuses -- same as every ramp dig today. A live fire column is a movement VETO on the destination (`poolForbid`), as poolescape has it. |
| **protectzone** | Ramp digs are survival-class (`SURVIVAL_OPS`); zones are not consulted, as for the ramp today and poolescape's veto rule ("a veto would build the dead end"). |
| **townground** | Unchanged (the reflex tick runs under `digScoped({purpose: 'survival'})`). |
| **flood check (climbflood-01/02)** | Every lateral dig still goes through `digChecked` (overheadBreakRisk on the live world, with the submerged exemption read NOW). The flood sidestep path is not touched (`wetStart` defaults false). |
| **entombed arm** | `steps > 0` OR `ceil.moved` counts as progress (counters reset); `ceil.action === 'escalate'` -> needs-rescue path; everything else unchanged. |

**The refusal chain, tested composed** (CLAUDE.md "composed"): pillar refuses (needs_blocks) -> refusal escalation -> ramp ->
ceiling unaffordable -> (a) lateral: dig, recheck, step, re-breach from the new cell, steps -> progress; (b) no lateral:
`_needs_rescue`, hold, NO prerequisite, no swing; the next three ticks do not fire; an inventory change cancels and the next
firing reprices. Run through the REAL entombed arm (`startReflexes` on a fake bot, as `entombed-escape.test.mjs` does).

## 8. Tests (behaviour first; source assertions only for wiring)

`bots/test/ceilescape.test.mjs`, on a fixture copied from the region file (`bots/test/fixtures/ceilescape-board-a-comet.json`, the
11x11x8 block around the bot with water levels and the ladder's facing; and `ceilescape-placebo-c-bravo.json`):
- the pure decision: unknown/affordable -> `ceiling`; ranking by FULL cost (a geometrically-first bearing with a copper new ceiling
  loses to a later dirt one); reserve; ties in facing order; unknown prices never affordable; escalate reason text.
- `rescueHoldStep`: holds through Comet's and placebo-c's measured bobs; cancels on cell, band, inventory, and a stable cheaper env;
  not on a one-sample flip; expires at 30 min.
- **the real `escapeStairUp`** on a fake bot whose dig sleeps the price at dig start (mineflayer's rule, §2), at a time scale
  (prices /20, budget 6 s) where the arithmetic is the same:
  - BASE positive control: the same fixture with `CEILESCAPE=0` swings at the copper and stops `dig exceeded` (the fixture sets
    the conditions; nothing is assumed);
  - candidate: digs the ladder and the dirt (never the copper), passes both rechecks with water flowing into the feet cell before
    the first, steps east, head breathable, re-breaches from (360,40,187) (open), `ceil.moved`;
  - sinking during the dig (40.2 -> 39.0): the plan stands, forward+jump climbs, arrival against the target floor;
  - displaced two cells: `displaced`, one replan;
  - water INTO the head cell before the recheck: refused, no step (the recheck guards);
  - lava at (361,40,187): E refused at plan, escalate;
  - placebo-c-Bravo's shaft: escalate, no swing, no prerequisite;
  - a dry airborne bot (a jump): settles, reprices grounded, digs (the transient-price case);
  - submerged -> grounded during the settle: the grounded price is used;
  - affordable ceiling: byte-identical dig sequence to base (the "unchanged" case);
  - drowning yield mid-lateral: controls untouched, `yielded`.
- the chain (§7) through the real arm; the hold blocks firings; an inventory change (a stone pickaxe arrives) cancels and reprices;
  the marooned arm while held: ramp skipped, poolescape hook still reached (wiring + behaviour on a wading fixture).
- **mutants** (`withMutant`, anchor present and unique, each must turn a named case red): remove the affordability branch; rank by
  geometry only; drop `wetFeet` at the recheck (dig-then-refuse returns); allow wet feet at the plan (W chosen); drop the fire veto;
  drop the settle (transient escalates); hold cancels on any env flip; no-prereq guard removed; the `wetStart` default flipped (the
  existing flood sidestep changes -- the climb-flood suites go red).
- existing suites stay green unmodified (escape-stair, climb-flood*, entombed-*, dig-split, poolescape).

Full `npm test` from `bots/` (`node scripts/run-tests.mjs`); eslint `no-undef` on the changed files.

## 9. Paper, read, registration

**Paper** (sandbox5-8, per-server lock owner `ceilescape`, driver `sandbox/ceilescape/ceilescape-e2e.mjs` on the poolescape
driver's pattern: the whole bot, model off; the arena copied cell for cell from the region copies WITH states; the bot given
Comet's bag). Scenes: `comet` (the live column), `noexit` (placebo-c-Bravo's shaft), `lava` (comet with lava behind the east dirt,
encased), `wethead` (comet with a source above (360,41,187)'s neighbour so the head floods), `copper2` (a second bearing whose new
ceiling is copper). BASE `3cc5f14d` vs CANDIDATE on every scene; the base is the positive control (it must stay in the column and
log `dig exceeded`). Outcome from the world (RCON position, health) and the build's own rows.

**Read** `scripts/host/ceilescaperead.py` (instrument = `bot.pos`, not the rung's rows): a TRAPPED spell = a bot whose x/z stays
in one 2x2 cell for >= 30 min while below y 63 with no route row; trapped bot-h pre/post, canary vs control (DiD). Gates: G1 a
canary bot that escapes and dies within 10 min of a `_ceilescape outcome=moved` (REVERT); G2 drowning/suffocation inside a
ramp window (start to end + 120 s) on a canary bot (REVERT); G3 a `_ceilescape` row with `env_ms <= left_ms` and an action other than
`ceiling` (the "unchanged" promise, REVERT); G4 a `_needs_rescue` row for a bot whose position moved > 2 cells in the
prior 10 min (a false escalation, REVERT); ARMS, LIVENESS, INSTRUMENT (row coverage), EXPOSURE (>= 1 `_ceilescape` row with
action != ceiling in a canary pool). Primary: trapped bot-h, canary pools, post <= half of pre with DiD < 0 (KEEP needs it).

**Registration.** drawexposure requirement: `entombed_ramp_cut` + `marooned_ramp_cut` rows containing `dig exceeded`, min 2 in 6 h.
Today that is board-a and placebo-c only -- two pools, so not tier 2's four: **TIER 3**, `draw_require_pools: ["board-a",
"placebo-c"]` (both exposed pools; board-a is the one the fix can free). An entry fragment only; no queue commands.

## 10. What it is NOT

- No tool-using ramp (the brief's separate question): the hands stay empty, the invariant that exempts the ramp from
  `mayDigForEscape` is kept.
- No change to `canBreak`, `planDig`, `planDigSplit`, `headroomBreach`, `overheadBreakRisk`, `stairUpStep`,
  `chooseStairUpBearing`, the pathfinder, or the flood sidestep's behaviour.
- No new water reflex; swimming stays travel. The jump during the dig is part of the escape's own stroke, and yields to the air
  reflex like every other control this routine sets.
- Not a fix for placebo-c-Bravo. It stops that bot's futile swings and its material-prerequisite loop and raises the flag.
- The `surface` skill and the watchdog also dig Comet's copper with a 120 s limit (169 rows/day in the board-a report). They are
  not changed here; if Comet leaves the column they stop on their own.

## 11. Open questions for the reviewers

1. Step 0 as a reported line inside the canary (§6) vs a tier-1 owner-direct rollout first.
2. The hold's cancel rule (§5): band +-2 floors and "stable and cheaper" in place of the brief's "any onGround/eye-water change".
3. Dry destinations only at the plan (§4) in place of the brief's wet-feet-at-plan.
4. The first-step substitution (§3) -- in scope for placebo-c-Bravo's marooned rows, or leave the step loop untouched.
