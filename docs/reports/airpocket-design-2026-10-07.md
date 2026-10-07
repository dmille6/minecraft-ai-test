# airpocket-01: a dig step inside the drowning rescue (design, 2026-10-07)

**Owner approval:** the owner approved building this canary on 10-07 at about 19:45Z. It was rank 1 in
`docs/reports/underground-safety-phase2-2026-10-07.md` §5.1.

**Branches:**
- `ap-on-c6e91a8`: the fleet's current version.
- `ap-on-92bc84f`: in case towndeposit-02 is kept.

**Launch shas:** `ee21207` on `ap-on-c6e91a8`, and `dbb4d78` on `ap-on-92bc84f`. The two carry the same airpocket
commits, cherry-picked.

**Status:** not deployed and not chained. The section 9 log records what this branch did in each review round. The
Paper sandbox evidence is in §7.

## 1. The problem, in measured numbers

All of these come from the phase-2 report.

- Every drowning in 5 days (170 of them) happened in a sealed water pocket.
- Every drowned bot since climbflood held a pickaxe with uses left.
- All fleet worlds run in peaceful mode. There, a drowning bot lives **83–90 s after its air runs out**, losing a steady
  0.31 HP/s. This was measured on the Paper sandbox server. On `easy` the same bot dies in 18 s.
- **A cell dug directly above a submerged head stays air**, because water does not flow upward. One dig therefore gives
  the bot a pocket to breathe in, however thick the roof is.
  - With a stone pickaxe, the dig takes 2.9 s standing on the floor and 14.1 s floating against the roof.
  - The client's own dig-time prediction matched the server to within 0.06 s.
- Today's rescue only holds jump toward air. The flooded-pocket rung refuses once the air is gone ("no air to start
  with").
- In the saved worlds, 43 of the 170 drowning sites (25%) pass this design's geometry and health checks. A further 17
  ice sites pass only if the ice branch is enabled.

## 2. The variable (one)

The variable is a new step inside the drowning rescue. It is written in `bots/src/airpocket.mjs` and wired in
`bots/src/reflex.mjs`.

**When it runs** (`airPocketTrigger`, a pure function). All of these must be true:
- the rescue is already running;
- the rescue's own scan found no air straight above (its route direction is not `up`);
- either the scan says **sealed**, or the rescue has been running for **8 s and has not closed on air for 4 s**. That
  second clause means a working swim is never cut off. Today, 4 of 46 rescues on an out or unscanned route still reached
  air between 8 and 20 s;
- no escape, flooded-pocket rung or maroon climb is in flight. **Exception (pre-emption):** inside a SEALED rescue, an
  in-flight escape or maroon climb is told to yield (`airPocketPreempt`, pure). Their pillarOut `alive` callbacks turn
  false, their current dig is stopped, and a `_air_pocket_preempt` row is logged. The step then runs on the next tick.
  - **Why** (Paper sandbox, 10-07): in a sealed column the entombed escape dug the roof bare-handed while floating
    (37.5 s against its dig budget). It held `escaping` for about 58 s while the step waited, and the budget ran out.
    One trial refused at 15.3 HP and drowned like the control. Another was admitted with 517 ms to spare.
  - Two individually correct guards had composed into a dead end.
  - **The pre-empt fires only when the step would run** (`stepWouldRun`, asked last). That check prices the dig at the
    worst case, floating and in water. On Paper scene H (easy), a bot that was on the ground for a moment priced the
    2.9-s standing dig: the pre-empt fired, and half a second later the floating price was refused.
  - The request to yield lapses after 3 s unless the tick renews it.
  - A refusal while an escape is in flight and not pre-empted is still logged:
    `_air_pocket_refused … (an escape is in flight; not pre-empted)`, at most once per 30 s.
  - The flooded-pocket rung is never pre-empted;
- no cooldown is active. A refusal sets a 5-s cooldown; a failed or aborted step sets 60 s.

**What it digs** (`airPocketPlan`, a pure function). It looks at cells relative to the feet cell:
- the head and the feet must both be in water (a waterlogged block counts as water);
- the first non-water cell above the head must be at +2 or +3, that is, within 2 cells of the head. It qualifies in one
  of two ways:
  - **pocket:** a solid, diggable block that does not fall. Its four sides must hold no liquid and no unknown cell. The
    cell above it must hold no liquid, no unknown cell and nothing that falls. Bedrock, containers and spawners are never
    dug. Packed and blue ice take this rule, because they do not melt into water.
  - **ice:** plain ice (or frosted ice) with **air directly above it**. Broken over water, ice becomes water, so the bot
    then rises one cell into the air above. This branch is behind `AP_ICE_ENABLED`, and §7 decides its default.

Anything else is refused, with the reason named.

**Admission** (`airPocketAdmit` and `airPocketInputs`, both pure). The damage envelope is fixed:
- **0.5 HP/s** when the server reports `peaceful` and the bot has no Hunger effect;
- **2.0 HP/s** on any other world: vanilla drowning damage with no healing, an upper bound anywhere.

Two inputs had to be read differently from the obvious source:
- **Difficulty** comes from `difficultyOf`: the server's difficulty packet, recorded on `bot.serverDifficulty`.
  Mineflayer's own `bot.game.difficulty` is always undefined on 1.21.8. The sandbox pilot found this: the first
  candidate refused every dig on a peaceful world, because it read that field.
- **Hunger** is found by its minecraft-data name `Hunger` (id 16), matched case-insensitively.

The work required is `predictedDigMs(cell, the fastest held tool, digEnv)` × 1.5, plus 3 s. The step is admitted only
if that fits within `(health − 4) / envelope`, which keeps a 4 HP reserve.

**The step** (`airPocketStep`):
1. Release the horizontal controls.
2. **A bot standing on a floor digs with jump released.** Jump would lift it off the floor, which makes the dig 5x
   slower than mineflayer priced it. Mineflayer would then report the dig finished early, and the client would show
   ghost air. A floating bot holds jump against the roof.
3. Equip the fastest tool, bounded to 1.5 s. Re-price the dig with the tool actually held; it must still fit the budget.
   Check the bot is still in the planned column.
4. Dig with a deadline of `min(the remaining budget, max(2 × predicted, predicted + 2 s))`. **The dig is sent inside the
   step or never** (Codex r5): a bounded look (500 ms), then `digGate`, a pure check made synchronously (not aborted, the
   roof still holds the planned block, the held tool is the one priced, still in the column), then
   `bot.dig(block, 'ignore')`. In the installed mineflayer that writes start-dig with no await before it, and sends the
   same face as the default path. mineflayer's own look is unbounded, so without this a stalled look could start the dig
   after the step had returned and cancel a newer dig.
5. A watch runs every 250 ms. It calls `stopDigging` and aborts the step on any of these:
   - a **breach:** more than 7 HP lost within the last 10 s. The sandbox's own peaceful health series never reaches
     that; the easy series reaches it before death;
   - the **budget running out;**
   - a **skill** reported by the guard. The guard interrupts any skill that starts during the step, because cognition is
     not stopped by the tick's early return;
   - **a dig on another block.**
6. Read the roof cell back. It must now be air (pocket) or water/air (ice).
7. Hold jump for the rise.
8. **Success** means the eye position (y + 1.62) has been in an air cell for 2 s, **and** health is rising, or is at its
   maximum. A drowning bot's health stays flat for about 30 s, so "health not falling" would count a drowning bot as a
   success. The step never relies on `bot.oxygenLevel`, which other entities' air values corrupt.
9. **Opened, not failed.** If the roof cell is open but breathing was not confirmed in the window, the outcome is
   `opened`. The place now has air, so it is treated like a success for the rescue's memory. On 5b6c530, 3 of 7 Paper
   trials breathed briefly while the body sank and had been logged as failures.
10. **Stand with the eye in the pocket** (`standInPocket`, only on success).
    - **Why, on a floor:** on Paper A-floor, once the rescue released jump, the bot sank back to the floor with its eye
      in water. Air fell to 83 of 300 before the rescue lifted it again.
    - **Why, in a deep column:** on Paper A (sandbox2, 9ad287a and a56b648), 3 of 3 trials sank about 6 blocks after a
      confirmed success, with Air at 42–56. Nothing held jump. Across all 35 successful trials, the bot held its place
      exactly when the rescue's own steering logged `_drowning_breathing` 1.6–2.0 s after success. So depending on
      whoever holds jump after the step was the defect.
    - **What:** jump-and-place under the rising bot, one block per cell between the feet and the air cell, so the bot
      stands with its eye in the dug cell. `standRef` (pure) picks what to place against:
      - the block below, if solid (a floor, or the previous stand block);
      - else the first solid side wall of the cell, with the face that touches it;
      - else nothing. Open water with no solid neighbour is left alone (`stand=none`).
      - **Never an interactive block** (both r7 reviews): a place on a chest, furnace, door, trapdoor, gate, button,
        lever, bed or sign opens or toggles it instead, and a door could let water in.
    - **A wall place never uses a falling block** (both r7 reviews): it has water under it, so sand or gravel would drop
      through the column, and the read-back could still see it solid for a moment and log `placed:1`. An unsupported
      place asks for non-falling blocks only (`standCandidates`, pure) and refuses a falling one by name.
    - **Residual:** a wall that is a slab or stairs. The read-back decides, and a failed place stops the stand by name
      while the rescue keeps the bot.
    - **Each place:**
      1. a bounded look (500 ms);
      2. `standGate`, a pure check made synchronously: not aborted, the block is in hand, still in the planned column,
         feet above the cell being filled;
      3. the packet is sent with `forceLook: 'ignore'`, which in the installed mineflayer writes it with no await before
         it. So a place is sent inside the call or never, and none can land after the step returns (Codex r4);
      4. the cell is read back. Any failure stops the stand and names why (`stand=stopped:…`), leaving jump held.
11. On success jump stays held, and the rescue's own release clears it once the head has been out for the dwell. On
    failure jump is released.

**Wiring in reflex.mjs.**
- While the step runs, every other tick returns at the top. The running skill is interrupted at the start.
- The air reflex keeps its body; nothing is handed off.
- **`_air_pocket_start`** is logged before anything moves.
- **The rescue's state afterwards** comes from the pure `airPocketAfter`:
  - **On success or opened** the fail memory is cleared (`drownFails`, `drownFailPos`, `drownFailHealth`) and the
    ceiling and progress clocks restart. The place now has air, so a bot that sinks back is lifted into the pocket by
    the rescue's ordinary `up dist=1` route.
  - **Breathe first.** For 10 s after a success or opened pocket, the entombed escape and the maroon climb do not start.
    Air refills to 300 in about 4 s. On Paper (bf99227, aca3063), about 2 s after success the entombed escape seized the
    body and released the float, and the bot sank with Air at 46–58. The drowning rescue itself is never held.
  - **On failure** a 60-s cooldown is set and the ceiling clock is left as it was. A failed dig therefore leads straight
    to the next ceiling and then the flooded-pocket rung, as today. Expect one extra `drowning_ceiling_no_air` row per
    failure; the read reports that line and never gates on it.

## 3. The refusal chain and composition (CLAUDE.md)

- **No new dead end.** The step adds an action and removes none. A refusal is today's rescue, unchanged. It does not
  claim the refused cases.
- **The remedy is executable from where the bot is.** It digs the cell over its own head with a tool it is holding. In
  POST, 14 of 14 drowning bots held a pickaxe. Ice breaks by hand.
- **Composition with neighbouring code:**
  - **climbflood** guards climb digs made while the bot is not submerged. airpocket digs only when submerged, under a
    stricter check.
  - **The flooded-pocket rung** is untouched. It gets the next tick after a failed ceiling, and it holds airpocket off
    while it runs (`othersBusy`).
  - **The entombed and marooned handlers** are pre-empted inside a sealed rescue. They yield through `alive`, which
    returns 'preempted'; the handler counts that as neither a success nor a failure. A new escape cannot start while the
    step runs, because of the tick's early return.
- **After success** the bot is dry-headed but enclosed. That is the trapped-bots problem: it costs time, not lives.
- **The owner's water rule** ("the only water reflex is getting air") holds: this is getting air.

## 4. Rows

All three rows are written only by this build.

`_air_pocket_preempt` is logged when an in-flight escape is asked to yield (at most once per 30 s). `_air_pocket_start` is logged before anything moves:

```
id=X kind=K cell=x,y,z block=B health=H difficulty=D hunger=0|1 envelope=E trigger_route=R:N held_ms=N
```

`_air_pocket` records the attempt's outcome:

```
id=X outcome=success|opened|aborted|failed kind=pocket|ice cell=x,y,z block=B tool=T standing=0|1 predicted_ms=N dig_ms=N
ms=N envelope=E health=A->B eye=E stand=none|placed:N|stopped:why -- why | required_ms=N budget_ms=N difficulty=D hunger=0|1 trigger_route=R:N held_ms=N
```

`_air_pocket_refused` records a refusal. It is throttled to one per reason and position every 30 s:

```
reason=... at=x,y,z health=H difficulty=D hunger=0|1 trigger_route=R:N held_ms=N
```

## 5. Tests

`bots/test/airpocket.test.mjs`: 100 checks, run by `npm test`. They test behaviour, never text, except for the wiring.

| block | what it checks |
|---|---|
| **A** | **The plan on the measured geometries.** Every refusal carries the dry-roof positive control. |
| **B** | Envelope and admission. |
| **C** | **The breach detector on the sandbox's own server-side health series** (`sandbox/drown/run1.jsonl.gz`): 5 peaceful trials never breach, and 2 easy trials breach before death. |
| **D** | Confirmation. Flat health is not success. |
| **E** | **The trigger:** sealed, the 8-s/4-s rule, an up route, the cooldown, and the closing-on-air rule with its mutant. |
| **F** | **The step on a fake bot:** success with jump kept; an abort on a breach, asserting exactly that reason; ice; never reaching air; flat health; a roof that changed; forward released and a column change; a rejected or hung equip re-priced; standing against floating jump; the guard; a foreign dig; jump re-asserted when cleared; `opened`; the stand on a floor, against the wall of a deep column, and none in open water; `standRef`; the stand stopping by name; `standGate`; no place sent after the step returns with a look slower than every timeout; abort, a failed equip and a push off the column mid-stand, and an abort during the rise or after a place; `digGate`; no start-dig sent after the step returns with a stalled look; a push off the column or a changed roof during the look is never dug; mutants of each. |
| **G** | **Wiring:** the early return, the trigger before steering, `if (ran) return`, the start row before the step, the after-state, the busy guard, the packet difficulty, the closing clock and the skill guard. Comments are stripped first, and each check is shown failing on a mutant. |
| **H** | Anchored mutants of every decision line, each present and unique. |
| **I** | **The world's inputs.** The pilot bug (`bot.game.difficulty`) and the `hunger`/`Hunger` lookup are each a killed mutant. |
| **J** | **The after-state** (success clears the memory; failure sets a cooldown) and the busy guard, each with a mutant. |
| **K** | **Pre-empting an in-flight escape:** only inside a sealed rescue, never the rung, never with an up route or during a cooldown, and only when the step would run (asked last). The climb yields after its jump sleep without placing (K7/K8). Mutants plus wiring checks for the stopped dig, both pillar `alive` callbacks, the worst-case price and the breathe hold. |

**Read tests:** `scripts/host/test_airpocketread.py` (22 checks; REAL ROWS builds rows with the bot's own `airPocketRow` via node and cuts them at 300). Each correctness gate fires on its own fixture log, a
clean attempt passes, and immature attempts and other-build rows are handled. Malformed numerics, unknown words and a
start after its end are each C0. Stand outcomes are parsed (including negative y) and reported, never gated.

**Suite:** `npm test` is green at both launch shas: **236/236 files on ee21207** (`ap-on-c6e91a8`) and **237/237 on
dbb4d78** (`ap-on-92bc84f`). Each ran in a clean archive export.
- An earlier run on 562d9e7 caught `tool-safe`'s count of live `scaffoldFor` sites; the stand is a fifth site (2c74bf0).
- One parallel run collided on a shared `/tmp` path in `llm-admission-attribution`. That test passes alone, and the final
  runs were sequential.

**Lint (ee21207):** `eslint src/*.mjs` reports one error, the `withinBody` no-undef that the baseline already carries.
`lint:movement` fails on two test files that the base already carries (`test/pathhalt.test.mjs`,
`test/pickuplog-review.test.mjs`). airpocket adds no pathfinder writer: reflex is not flagged, and the step halts through
`haltPath`.

## 6. The read: `scripts/host/airpocketread.py`

- **LIVENESS:** canary `_air_pocket` + `_air_pocket_refused` rows ≥ 1, written by the canary build.
- **CORRECTNESS:** read per attempt. An attempt is the pair `_air_pocket_start` id=X … `_air_pocket` id=X. Any breach
  reverts.

  | gate | the breach |
  |---|---|
  | C0, malformed | a missing or non-finite field; no start row; or a start row with no end row although the bot kept logging for 120 s |
  | C1, false success | a success followed within 120 s by the same bot drowning. This is a per-attempt tripwire, not a proof of mechanism. Attempts whose follow-up is not yet inside the window are immature and not judged |
  | C2, dug into danger | a lava, fire or suffocation death (judged on the cause text only), or a lava danger-block row, between the start row and 30 s after the end row |
  | C3, reserve spent | an attempt that did not succeed ends below 3 HP, or any death happens between the start and end rows |
  | C4, up-route trigger | the row's `trigger_route=up` |
  | C5, envelope | envelope 0.5 on a world that is not peaceful |

- **ARMS:** the control writes no `_air_pocket*` rows.
- **INSTRUMENT** (both gated):
  - the control's capped rescues;
  - the control's no-air sealed ceilings (oxygen ≤ 0).
- **A KEEP also needs at least 1 success.** Attempts that never work make the run INCONCLUSIVE.
- **EXPOSURE:** at least 2 mature canary attempts, and both instruments.
- **REPORTED:**
  - outcomes and refusal reasons;
  - DiDs of capped rescues, no-air ceilings, drowning deaths, all deaths, entombed+marooned rows and mine rows per
    bot-h;
  - a flag when the pre-window has under half the post bot-h.
- **POWER:**
  - In the dry run, hive-c + hive-d (10 bots, base build) logged 16 no-air sealed ceilings in about 60 bot-h. That is
    about 2–6 attempts per 6 h on those pools, against about 1 on average pools.
  - No death endpoint is readable. The effect claim rests on the Paper sandbox and the per-attempt gates.
- **Dry run on 10.0.0.31 (22:28Z, read copied to `~/mcai-analysis` and `/tmp`):**
  - command: `CANARY_DRYRUN=hive-c,hive-d:c6e91a8:<now − 6 h>`, 360 min, 27 s;
  - rows walked: 548,500. The walk reported 1 unparsable line;
  - result: 0 `_air_pocket*` rows from either arm, as expected on the base build; no breaches;
  - instruments: 651 control capped rescues and 34 control no-air ceilings;
  - in this window the base build on hive-c + hive-d logged 0.067 deaths/bot-h against the control's 0.026 (2.6x). This is
    the death-gate bias again.
- **`drawexposure.py airpocket-01 --hours 12`:** hive-c, hive-d, placebo-a, placebo-b and placebo-d qualify.
- **`licencecheck.py`:** the baseline (309,824 rows, 80 bots) is silent on `_air_pocket`.

**draw_exposure.** Each drawn pool needs real sealed drownings in the prior 12 h:
- ≥ 3 `drowning_ceiling_no_air` rows containing "(oxygen 0,";
- ≥ 1 `_death` row containing "drowned".

The oxygen filter drops stuck bots that sit at full oxygen. It is a subset of the read's "oxygen ≤ 0" count, because it
ignores −1. In the 12-h dry run at 19:54Z, hive-c, hive-d and placebo-d qualified.

**THE DEATH GATE IS BIASED FOR THIS DRAW. Do not launch until the adaptive extension exists** (Claude review).
- The live gate compares the canary with the control at the same time.
- draw_exposure deliberately picks pools that drown more. In the dry run, the base build on hive-c + hive-d had 4
  deaths at 0.067/bot-h against the control's 0.021: 3.2x, past the two-death floor.
- So a no-change canary drawn this way would trip the gate on its pools' own baseline.
- **The adaptive rule the owner approved on 10-07 is what makes this run decidable:**
  - a trip with zero mechanism-linked deaths extends the read to 24 h on 20 bots;
  - the extension is judged on the three-part rule, which uses PRE-adjusted DiDs and net output;
  - a death within 120 s of the bot's own `_air_pocket` row is mechanism-linked (`linkage_extra`).
- Another agent is building that tooling. **Launch only once it exists**, or with the operator explicitly accepting a
  likely false trip.

## 7. Paper sandbox proof

**Setup.**
- **Harness:** Paper 1.21.8 sandboxes, sandbox (25599) and sandbox2 (25600), both peaceful. Scene H set `easy` for its
  own window and was restored each time.
- **Bots:** the real bot, run from each arm's tree on 10.0.0.31 with `sandbox/run-bot.sh`.
- **Driver:** `sandbox/craft/airpocket-ab.cjs`, summarised by `summarize-airpocket.py`.
- **Oracle:** every second the driver read Air, Health and Pos from the server, plus a deathCount scoreboard and the
  roof cells.
- **Kit:** the drowners' typical kit, a stone pickaxe at about 100 uses, 64 cobblestone and an empty bucket.
- **Raw results:** 75 trials on 10.0.0.31 in `~/ap-sbx/main/sandbox/log/airpocket-ab/`.

**Scenes:**

| scene | setup |
|---|---|
| A | the hive-c geometry: a deep 1x1 water column with no floor and a stone roof over the head |
| A-floor | A, but standing on a floor |
| B | a roof 3 blocks thick |
| C | water beside the roof cell |
| D | lava above the roof cell |
| E | sand above the roof cell |
| F | the hive-d geometry: ice with air above it |
| G | open water |
| H | A on `easy` |
| I | the head cell is stone |
| J | A, run for 300 s |

**Results** (from the trial manifest `~/ap-sbx/logs/MANIFEST-airpocket-cand.tsv`; Y = alive at the end of the window):

| sha | A | A-floor | F | J (300 s) | C | D | E | G | H (easy) | I |
|---|---|---|---|---|---|---|---|---|---|---|
| **control c6e91a8** | NNN | N | NNN | NNN | N | – | – | Y | N | – |
| 950e89c | N | – | – | – | NN | N | N | Y | – | N |
| 8c2c7f9 | N | – | – | – | – | N | N | Y | – | – |
| 569e236 | NN | Y | YY | N | – | – | – | – | N | N |
| 5b6c530 | YYY | YY | Y | YY | – | – | – | – | N | – |
| 48b3509 | YYY | YY | YY | YY | N | N | N | Y | N | N |
| bf99227 | YY | YY | Y | Y | N | N | N | Y | N | N |
| aca3063 | YY | Y | YY | – | N | – | – | – | – | – |
| e142b8f | YYY | Y | – | Y | N | – | – | – | N | – |
| 9ad287a | YY | YY | Y | Y | – | – | – | – | N | – |
| a56b648 | Y | YY | – | – | – | – | – | – | N | – |
| 796e5fd | YY | YY | Y | Y | – | – | – | – | N | – |
| 2a803a1 | YYY | Y | Y | Y | – | – | – | – | N | – |
| **562d9e7** | YY | Y | Y | Y | – | – | – | – | N | – |

`562d9e7` is the last sha with Paper scenes. The launch sha `325df41` differs from it only in the row format and in one
test count; see the 325df41 note below.

**What the table shows:**
- **The control dies in every sealed scene:** 104–105 s after submersion in A, A-floor, F, J and C, and at 33.1 s on
  easy.
- **From 5b6c530 on, the candidate survives every admitted sealed scene (A, A-floor, F, J): 59 of 59 trials over 10 shas.**
  Three F trials on sandbox2 (5b6c530, 9ad287a, 2a803a1) ran no step: the escape's pillar broke the ice with cobblestone
  2–6 s in, before any rescue, and the bot lived.
- On 569e236, B (a 3-thick roof) ran once: alive, after one dig.
- **The refusal scenes C, D, E and I** refuse with the named reason ("water beside", "lava above", "sand above", "head
  cell is stone"). They never dig the roof cell, and they die like the control. That is today's behaviour, unchanged,
  as designed.
- **G (open water)** writes no `_air_pocket` row in any arm and lives.
- **H (easy)** never digs: the 2.0 HP/s envelope refuses it. It dies at 32.1–33.1 s, like the control (33.1 s). From a56b648 on,
  H logs one `_air_pocket_refused` row and no pre-empt.

**Timings** (48b3509 onward; times from submersion; the stand adds 0.5–1 s after success from 9ad287a on):
- **Pre-empt and start:** the pre-empt fires at 11.0–11.4 s and the step starts 0.5 s later at 20 HP. The budget is
  32,000 ms, against 24,150 ms needed for stone and 10,050 ms for ice.
- **Dig time, predicted against measured on the server:**

  | material | predicted | measured |
  |---|---:|---:|
  | stone | 14,100 ms | 14,100–14,102 ms |
  | ice | 4,700 ms | 4,700–4,702 ms |

- **Breathing:** the roof reads air at 26.0–26.1 s for stone and water at 17 s for ice, and the eye is in air in the same
  second. Server Y stays between 39.98 and 41.20 during the dig, and server health never falls below 18–19.
- **J (300 s):** every candidate was alive at 300 s with no rescue re-seizure after the step. Every control died at
  104–105 s.

**Four early defects the sandbox found, all fixed:**

| fixed in | defect | evidence |
|---|---|---|
| 8c2c7f9 | the step read `bot.game.difficulty`, which is undefined on 1.21.8, so the envelope was always 2.0 and every dig refused | rows: "needs 24150 ms, budget 8000 ms … difficulty=undefined" |
| 5b6c530 | a bare-handed entombed escape held `escaping` for about 58 s, and the busy guard waited until the budget ran out | 569e236 J refused at 15.3 HP and drowned |
| 48b3509 | the floating body sank 3 blocks during the dig, and a briefly-breathing success was logged as failed | 5b6c530, 3 of 7 trials |
| bf99227 | pre-empt then refuse | 48b3509 H, C, E, I |

**Later defects, none fatal in the sandbox:**

| fixed in | defect | evidence |
|---|---|---|
| e142b8f | about 2 s after success the entombed escape seized the body and released the float | bf99227/aca3063 A: the bot sank with Air at 46–58 of 300 |
| 9ad287a | on a floor, the bot sank back with its eye in water once jump was released | e142b8f A-floor: Air fell to 83 |
| 9ad287a | H pre-empted on a momentary on-ground price, then refused | e142b8f H |
| 2a803a1 | in a floorless column nothing held jump after success | 9ad287a/a56b648 A on sandbox2: 3 of 3 sank to Y 34.9–35.0, Air 42–56. Across 35 successful trials, holding was predicted exactly by a `_drowning_breathing` row within 2 s of success |
| 325df41 | every `_air_pocket` row with `stand=` exceeded the logger's 300-character cap | see the read, below |

**The launch candidate 562d9e7** (server reads; times from submersion):

| trial | dig / predicted ms | success | stand= | 30 s after success: min Y, min Air | alive |
|---|---|---|---|---|---|
| A:0 (sandbox2) | 14,101 / 14,100 | 28.1 s | placed:1 | 41.00, 258 | yes |
| A:1 (sandbox2) | 14,102 / 14,100 | 27.9 s | placed:2 | 41.00, 182 | yes |
| A-floor:0 | 14,102 / 14,100 | 28.2 s | placed:1 | 41.20, 238 | yes |
| J:0 (300 s) | 14,100 / 14,100 | 28.0 s | placed:1 | 41.12, 178 | yes, at 300 s |
| F:0 (sandbox2) | 4,701 / 4,700 | 19.5 s | placed:2 | 42.00, 253 | yes |
| H:0 (easy) | no step | – | – | – | no, at 32.1 s, like the control |

- The server reads cobblestone at the placed cell from 28.0–28.1 s (F: 20.0 s).
- **The bot holds without jump.** From 6 s after success to the end of the window it never goes below Y 41.0, and Air
  is 300 throughout. In A it sits at exactly Y 41.00 in about a fifth of polls, with Air 300 at every one of them. At
  that height the eye is at 42.62, in the dug cell.
- J holds the pocket until 243.5 s, when the entombed escape tunnels out sideways, as on earlier shas.
- **The sink-back did not reproduce** on 796e5fd, 2a803a1 or 562d9e7: 0 of 8 column A/J trials, 3 of them on sandbox2.

**The read on real rows: the positive control found a defect.** `airpocketread.py` was run over the candidate bots'
own sandbox logs (`AIRPOCKET_LOG_ROOT=~/ap-sbx/logs`, from 48b3509 on, 132 min):
- 49 mature attempts parsed (42 pocket, 7 ice), all successes;
- 38 refusals;
- **24 C0 breaches.** Every row carrying `stand=` had been cut at 300 characters by `logger.mjs`, and the
  `| required_ms … trigger_route` tail that C0 validates was gone.

On the fleet this would have reverted the canary on its first successful attempt. 325df41 writes the read's required
fields first and keeps the trigger on the start row; test F27 and the read test REAL ROWS now build rows with the
bot's own `airPocketRow`. Earlier rows (before the stand existed) had parsed clean: 20 attempts, 0 breaches.

**325df41 on Paper: real rows, and the read on them.**

| trial | pre-empt | dig / predicted ms | success | stand= | 30 s after success: min Y, min Air | row length | alive |
|---|---|---|---|---|---|---|---|
| A:0 (sandbox2) | 11.4 s | 14,102 / 14,100 | 28.2 s | placed:1 | 41.06, 242 | 250 | yes |
| A-floor:0 | 11.2 s | 14,102 / 14,100 | 28.1 s | placed:1 | 41.06, 243 | 250 | yes |
| F:0 (sandbox2) | 11.2 s | 4,701 / 4,700 | 19.5 s | placed:2 | 42.00, 243 | 242 | yes |

- From 6 s after success, Y never went below 41.0 (F: 42.0) and Air stayed at 300.
- The rows are 242–250 characters, with every required field intact. The same rows on 562d9e7 were exactly 300 and cut
  inside `trigger_route=`.
- **`airpocketread.py` over these rows** (`AIRPOCKET_LOG_ROOT`, from the first 325df41 trial):
  - 3 mature attempts, 0 breaches;
  - trigger `sealed`, taken from the start rows;
  - `STAND {'placed:1': 2, 'placed:2': 1}`.

  The same read over the earlier stand-era rows gives 24 C0 breaches. So the read can see the defect, and it no longer
  fires on the fixed rows.
- ee21207 changes only the health rounding in this row: the value is now floored, never rounded.

**Ice: `AP_ICE_ENABLED` stays true.** In every F trial where the step ran (569e236 on, 11 trials including 796e5fd and
562d9e7), the ice broke in 4.7 s, the bot breathed at about 17–19.5 s, and it lived. On 562d9e7 it then stood on 2 placed
blocks with Air 253 or more. On bf99227 the flooded-pocket rung pillared the bot out dry afterwards.

## 8. Risks

- **Ice turns to water and the bot must rise one cell.** That is the same step that failed for the 11 open-water deaths
  in the phase-2 report. Scene F decides it; see §7 for `AP_ICE_ENABLED`.
- **A bot whose client position is wrong.** The plan reads the client's world. The read gates false success (C1) on
  actual deaths.
- **Time spent digging is time not spent swimming.** A sealed scan, or 8 s without closing on air, comes first.
- **Stranding.** A breathing bot in a 1-cell pocket over water is enclosed. It is alive, the cost is lost time, and the
  read reports stranding rows.

## 9. Reviews

Both engines reviewed every round independently: a fresh Claude subagent (one agent across all rounds) and Codex
(`codex exec`, read-only). Each round reviewed the branch head named.

| round | sha | Codex | Claude | what the round changed |
|---|---|---|---|---|
| 1 | first build | CHANGE | CHANGE | Hunger key; horizontal controls released; bounded equip and re-price; start row and read pairing; F2 asserts the exact reason; a standing bot digs with jump released; skills interrupted and guarded; the 8-s rule waits for 4 s without closing on air; success keeps jump; the death-gate bias stated as a launch precondition |
| 2 | — | CHANGE | APPROVE-WITH-CHANGES | pre-empt only when the step would run; cancellation reaches the climb (`alive` through `digStraightUp`); cleanup scoped to the roof cell; NaN/Infinity rows are C0; immature successes do not count |
| 3 | bf99227 | CHANGE | APPROVE-WITH-CHANGES | no place or sprint after a yield; the pre-empt decision extracted (`stepWouldRun`); the request lapses after 3 s; strict numeric and word validation in the read, and start before end |
| 4 | 9ad287a | CHANGE | APPROVE | the stand's raced `placeBlock` could send after the step returned → place with `forceLook: 'ignore'` after a bounded look and `standGate` |
| 5 | a56b648 | CHANGE | APPROVE | the dig had the same late-send shape → bounded look, `digGate`, `bot.dig(block, 'ignore')`; the 2-s late poll removed; the stand reports an abort during the rise and after a place |
| 6 | 796e5fd | **APPROVE** | APPROVE | — (Paper then showed the deep-column sink-back) |
| 7 | 2a803a1 | CHANGE | APPROVE-WITH-CHANGES | both: a wall stand must never use a falling block, and never place against an interactive block |
| 8 | 562d9e7 | APPROVE-WITH-CHANGES | APPROVE | — (then the read's positive control on the Paper logs found the 300-character cut, and the full suite found the scaffold-site count) |
| 9 | 325df41 | CHANGE | APPROVE | Codex: rounding health lifts 2.99 to 3 and hides C3 → floored |
| 10 | ee21207 | **APPROVE-WITH-CHANGES** | **APPROVE** | — (Codex: docs cleanup; the reference re-check stays advisable) |

**Final verdicts on ee21207:** Claude APPROVE; Codex APPROVE-WITH-CHANGES, the changes being documentation cleanup plus the stated reference re-check residual. Both are conditional on the launch preconditions below.

**Stated residuals, all non-lethal.** In each case the stand stops by name and the rescue keeps the bot.
- **Reference re-validation** (Codex r8): the stand's reference is chosen before the equip, rise and look waits. It is
  not re-checked for interactivity just before the send. That needs a block to change beside a submerged bot within
  about 3 s.
- **Slab or stair walls** as a reference: the read-back decides.
- **Abort masked by a failed place** (Codex r6): an abort that coincides with a failed place is reported as "did not turn
  solid".
- **Row formats** (Claude r9): the `_air_pocket_start` row writes raw health; its worst case is about 200 characters, under
  the cap. The `_air_pocket_refused` row puts `trigger_route` after free text, so a long reason can cut it. Nothing gates
  on it today.

**Launch preconditions (both reviewers):**
1. The adaptive death-rule extension tooling exists (§6).
2. §7 records the Paper confirmation, with the deep column at `stand=placed:1` and holding without jump. Recorded for
   562d9e7. The launch sha ee21207 differs only in the row format (325df41, ee21207) and a test count (2c74bf0). Real
   rows from 325df41 are in §7.
