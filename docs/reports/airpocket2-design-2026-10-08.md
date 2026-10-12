# airpocket-02: the hive-d ice trap, a server-grounded success, and the well floor (design, 2026-10-08, rebased 10-10)

**Ordered by the coordinator** on 10-08, while airpocket-01 ran live. airpocket-01 was kept and promoted. The fleet is now
4970c91 (airpocket-01 plus toolhygiene-01, both kept), and peacefulkit-01 (6f1921a on 4970c91) is live as a canary.

**Branches** (the same airpocket-02 commits, cherry-picked):
- `ap2-on-4970c91`, for today's fleet;
- `ap2-on-6f1921a`, in case peacefulkit-01 is kept.

Both fleets carry airpocket-01. On either branch, the variable is airpocket-02's diff over airpocket-01.

**Not in this build: the open-window equip race.** The owner started a separate session for it ("Fix airpocket's equip
during an open window"). airpocket-02 dropped its own window handoff so the two never duplicate. That fix is pulled in
when it lands on main. Until then the race is airpocket-01's, unchanged and pre-existing on the fleet.

**Status:** not deployed, not chained. §5 holds the Paper proof, §7 the reviews.

## 1. What was found (the missed rescue, 10-08)

hive-d-Alpha drowned twice on the airpocket-01 canary (07:45:33Z and 14:08:10Z) with no `_air_pocket*` row. Fleet logs
were read-only; Paper reproduced the case.

- **Server.** Water freezes around a bot floating at a frozen lake's surface (random tick, snowy biome). The server then
  puts the bot in **swimming pose**: a 0.6-tall box against the ice, eye at y+0.4, in water. Its y is exactly
  62 − 0.605 = 61.395.
- **Client.** mineflayer has no swimming pose. It keeps a standing eye at y+1.62, which is in air, and its head cell (y+1)
  reads ice.
- **Rescue.** `scanBreathableRoute` starts **one cell above** the head cell and returns `up dist=1`. The rescue holds jump
  into the ice for four ceilings. airpocket-01 never triggers on `up`, by design.
- **Paper, freeze-probe trial 2.** The dug ice re-formed and the bot drowned. airpocket-01 logged a **false `success`**:
  the client's 1.62 eye read air, and health flickering 18 ↔ 20 passed "rising".

**Size, from fleet logs since 10-01:**
- 23 of 244 drowning deaths (9.4%), **all in hive-d** (5 bots): **3.1 drownings/day**.
- 42 head-ice episodes in 7.7 days (5.5/day), 24 of them ending in a drowning.
- No other pool had any.
- **Not covered:** 16 further drownings with a false `up dist=1` and the head in WATER. Their mechanism is unproven.

## 2. The changes

All of them are in `bots/src/airpocket.mjs`, with wiring in `bots/src/reflex.mjs`. Every decision is a pure function,
tested on behaviour with anchored mutants.

1. **A pose-aware eye** (`botPose`, `serverPose`, `poseEye`, `boxCollides`, `planBaseY`).
   - **The server's own pose datum comes first.** That is player metadata index 6: 0 stand, 3 swim, 5 crouch.
   - **Otherwise a collision model:** stand (1.8 / eye 1.62), crouch (1.5 / 1.27), swim (0.6 / 0.4), tested against block
     shapes under the 0.6 × 0.6 footprint.
   - **The plan's base cell:** the feet cell when standing, else the cell under the eye's cell.
   - A crouching or swimming bot may have a floor under it (the 1-tall gap under ice).
   - A standing bot ON a slab in its feet cell plans (`standsOn`).
2. **The dig is priced and run with the pose's eye** (`withPoseEye`; Claude r1 P1).
   - mineflayer's finish timer and `digEnv` decide "in water" from `bot.entity.eyeHeight`.
   - Under the trap the 1.62 eye is in air. The 5x submerged penalty was therefore dropped: the client finishes early, the
     server refuses, and the client shows ghost air.
   - The pose's eye is set synchronously, only around a price and around the `bot.dig` call, where mineflayer computes
     its timer.
   - It is restored to mineflayer's own crouch state on every path.
3. **The body agrees with the jump at every dig call** (`bodyAgrees`).
   - mineflayer prices from the client's `onGround` at the call.
   - Paper (1b0cdb5 T2) caught a re-dig the client priced on-ground while the server had the bot jumping: a 900-ms client
     finish against a 4.7-s server break.
   - The jump now follows the client's ground until the two agree (at most 3 × 300 ms). The dig is then re-priced in that
     state, and refused by name if it no longer fits.
4. **`upblocked`** (`routeUpBlocked`).
   - An `up` route is blocked when a solid cell lies strictly between the pose-aware eye cell and the route's air cell.
     Unknown cells never count as a block.
   - Triggering: after 8 s held and 4 s not closing on air.
   - Pre-empting a maroon climb or escape: under the same condition, and only for a step that would run.
   - Each detection writes `_air_pocket_upblocked`. The start row adds `pose=` and `blocked=<block>@<y>`.
   - The rescue itself is unchanged.
5. **Server-grounded success** (`airPocketConfirmed`).
   - The pose-aware eye is in air for 2.5 s.
   - Health is sampled on every server health event.
   - A drop restarts the window.
   - At the end, health has risen or is at its maximum.
6. **Re-dig on refreeze.** Up to 2 more digs, each settled, re-priced and re-admitted. When the re-digs run out, or a
   re-dig reads closed, the outcome is `failed` with `refrozen` (never `opened` over a roof). `airPocketAfter` then gives a
   5-s cooldown, so the next trigger digs again.
7. **The well-floor guard.** Never dig a trapdoor, or a roof or ice with a trapdoor within two above it. That is the junk
   well's floor trapdoor and cap (junkwell-02 reviews).
8. **Dig candidates.** toolhygiene-01's `airPocketTools`, already on 4970c91 (hygiene-switched), is used as it is.

**Rows.** The end row's optional tail adds `pose=` and, only when one occurred, `redig=N`. The required fields still come
first; test F27 checks the 300-character cap.

## 3. The refusal chain (CLAUDE.md)

- **No new dead end.** `upblocked` adds a trigger where today's rescue holds jump into ice for 80 s. A refusal is today's
  behaviour.
- **The remedy is executable from where the bot is.** It digs the cell directly over its own eye, priced as the server will
  price it.
- **A refrozen cell is dug again** within one 5-s cooldown.
- **Residuals:**
  - the 16 head-in-water false-up drownings;
  - a false success at full health with the server's air still positive (C6 catches what follows);
  - the open-window race, owned elsewhere.

## 4. Tests

- **`bots/test/airpocket.test.mjs`: 146 checks.** The airpocket-02 blocks are prefixed AP2-:
  - **L** pose and plan base, including the 1-tall gap;
  - **M** upblocked, trigger and pre-empt;
  - **N** the step on the trap, including a false success refused;
  - **O** re-dig;
  - **Q** well guard;
  - **S** collision model, slab, cooldown, re-pricing, ice guard, health events;
  - **T** server pose, eye pricing and restore, window restart, closed re-dig, call-site settle;
  - wiring checks for each reflex hook, each shown failing on a mutant.
- **`scripts/host/test_airpocket2read.py`: 26 checks.**
- **`npm test`:** 239/239 files on ccc593f7 and 242/242 on 1bea197f (§7).
- **Lint:** only the `withinBody` error, which is already on the base.

## 5. Paper proof

**Setup.**
- Sandboxes: Paper 1.21.8 sandbox and sandbox2, peaceful except H (easy), RCON only.
- Trees: run on 10.0.0.31 with `sandbox/run-bot.sh`. Control is the fleet sha 4970c91 (dbb4d78 for the earliest rows).
- Drivers:
  - `sandbox/craft/freeze-probe.cjs`: scenes T2 and S1, in a frozen_river column, with randomTickSpeed raised to force a
    freeze;
  - `sandbox/craft/airpocket-ab.cjs`: scenes A, A-floor, F, H.
- Reads: every second the server's Pos, Air, Health and the cells. The client probe (`sandbox/craft/posprobe.cjs`) logs, at
  every dig call: the server pose datum, `eyeHeight`, `onGround` and jump, plus the server's block_change/dig_ack (break
  time against the client's finish).

**Scenes.**
- **T2** (the fleet trap, reproduced):
  - a bot floats in the one open cell of an iced pool;
  - the cell freezes around it, and the bot is pushed under the ice;
  - the dug ice re-forms within about 1 s (randomTickSpeed 200).
- **S1** (shallow trap): a floor, ONE water cell, ice, then air above.

**Results** (alive = alive at the end of the window; 150–180 s for T2/S1):

| arm | T2 | S1 | A | A-floor | F | H (easy) |
|---|---|---|---|---|---|---|
| control 4970c91 / dbb4d78 | 2 drowned or drowning at the window's end (dbb4d78: **false `success`** logged at 89.6 s, server Air ≤ 0); 4970c91: 1 died at 125 s, 1 lived (no trap formed) | **4 of 4 drowned** at 104–105 s; `up dist=1`, no `_air_pocket` row | – | – | – | died ~33 s |
| 6187874 / 1b0cdb5 | 5 of 5 lived (one by `failed redig=2` → `upblocked` → success) | 3 of 3 lived (6187874 logged `opened`; 1b0cdb5 `success`) | – | lived | lived (no step: the escape broke the ice) | refused (budget), died like the control |
| 726ea0a | **3 of 3 lived** | **2 of 2 lived**: `upblocked` at 11–16 s, success at 39 s, placed:1, Air 300 | lived (14,102 / 14,100 ms) | lived | lived (4.7 s ice) | refused, died 33.1 s |
| **ccc593f (launch)** | **2 of 2 lived** | **1 of 1 lived** | lived | – | – | – |

- **No false success on airpocket-02.** After every candidate success, server Air rose above 0 within 10 s.
- **The read over all 53 Paper trials (positive control).** C6 fires on both airpocket-01 false successes: the 325df41 freeze probe at 16:59:40 and control dbb4d78 T2:0 at 17:31:53. It fires on none of the airpocket-02 candidate successes. Getting the second one needed C6(a) to count the rescue steering again (`_drowning_up`/`_drowning_route`) as drowning evidence; the client's breathing row there said oxygen 11 while the server's Air stayed ≤ 0. C0 fired once, on a control trial the harness cut in the middle of a step.
- **No "never settled" refusal** appeared in any trial.

**Dig timing, client finish against the server's break:**
- **Matched:**
  - every dig at the swimming eye (0.4, server pose 3);
  - every dig standing on the floor;
  - every A / A-floor / F stone and ice dig, within 100 ms.
- **The re-dig ghost seen on 1b0cdb5** (900 ms client against 4,700 ms server) appeared once more on 726ea0a: the eye cell
  at the call was the refrozen ice. It did **not** appear on ccc593f's re-digs (4,700 / 4,700).
- **Residual, stated.** The first T2 dig, made floating at standing pose (eye 1.62, pose 0), finishes on the client about
  3.3 s before the server breaks the block (11.0–11.8 s against 14.0–15.1 s).
  - Its admission price is 4,700 ms, about 3x short.
  - The server still breaks the block (vanilla's delayed destroy completes a dig the client finished at ≥ 70% progress),
    and success is server-grounded, so all those trials lived.
  - On peaceful, the 14–15 s real cost stays inside the 32-s budget, and the envelope watch aborts on budget regardless.
  - The read reports predicted against actual dig ms for this.
  - A per-tick pricing model was not attempted. The server sums break progress tick by tick across a bobbing body; the
    client prices once, at the call.

**Raw rows** (ccc593f T2:1):
```
_air_pocket_upblocked  the rescue's up dist=1 route crosses ice@122: pose=swim eye_cell=121 at=700,121,700 health=20 held_ms=4999
_air_pocket_start      id=mv2es07b kind=ice cell=700,122,700 block=ice health=20 difficulty=peaceful hunger=0 envelope=0.5 pose=swim blocked=ice@122 trigger_route=upblocked:1 held_ms=8007
_air_pocket            id=mv2es07b outcome=success kind=ice cell=700,122,700 block=ice tool=stone_pickaxe predicted_ms=4700 dig_ms=14421 ms=16934 envelope=0.5 health=20->20 | required_ms=10050 budget_ms=32000 difficulty=peaceful | standing=0 pose=stand eye=air stand=placed:1 --
```

**Logs.** 53 trials since 10-08, in `~/ap-sbx/logs` on 10.0.0.31. `MANIFEST-airpocket-cand.tsv` records the sha, scene and
arm per trial. The sandboxes were restored and the lock released.

**Read dry run** (`CANARY_DRYRUN=hive-d,placebo-d:4970c91:<now − 6 h>`, fleet logs, 641k rows):
- 0 breaches;
- control airpocket-02 rows 0. The control's 1,138 airpocket-01 rows are legitimate;
- instruments: 651 capped rescues and 49 no-air ceilings;
- C6 health rows: 393,463.

## 6. The read and the registration

**`scripts/host/airpocket2read.py`** is a new file. airpocket-01's read is untouched. It is airpocket-01's read plus:

| gate | breach |
|---|---|
| **C6, false success (server-grounded)**, arm a | within 20 s of a success, the server's `bot.health` falls ≥ 2 HP below the success's ending health, AND drowning evidence follows within 30 s: a no-air ceiling, drowning observed, oxygen critical, reflex drowning, or the rescue steering again. The count of health-bearing rows is printed |
| **C6**, arm b | within 30 s of a success, a no-air ceiling (oxygen ≤ 0) with no release (oxygen > 0) in between |
| **C7, upblocked unproven** | an `upblocked` trigger whose `blocked=` is not exactly the planned block at the planned cell's y |

- **Trigger.** The START row's trigger is the decision record. `up` in either row is C4.
- **ARMS.** Judged on rows only airpocket-02 writes (`_air_pocket_upblocked`, and start rows with `pose=`). Both fleets
  write airpocket-01's rows legitimately.
- **EXPOSURE** (`exposure_ready_ap2`): at least 1 mature **successful** `upblocked` attempt, plus the two control
  instruments.

**Registrations** (`docs/reports/airpocket-02.<sha>.json`, class underground-safety):
- airpocket-01's live registration, with the new read and C6/C7 own lines;
- licence `_air_pocket_upblocked` (silent in the baseline);
- `usafegate check-registration`: OK.

**The draw.**
- **It must include hive-d.** The trap exists nowhere else. `drawexposure.py` draws two eligible pools at random and
  cannot force one, so the operator names hive-d plus one random eligible pool (`draw_pools_required`).
- The window is 24 h: on 10-10 the 12-h filter left only placebo-d. At 24 h five pools qualified, hive-d among them.

**Power, stated honestly.**
- With hive-d drawn: about 5.5 trap episodes a day on its 5 bots, so about 1–2 `upblocked` attempts per 6 h.
- The licence row's chance of not appearing by +180 is about 50%, and by +360 about 25%. The extension to exposure covers
  that.
- Without hive-d there is no exposure, and the run can only be INCONCLUSIVE.
- No death endpoint is readable. The effect claim rests on Paper and on the per-attempt gates.

## 7. Reviews and suites

Both engines reviewed every round independently: a fresh Claude subagent (one across all rounds) and Codex
(`codex exec`, read-only).

| round | sha | Codex | Claude | what changed after it |
|---|---|---|---|---|
| 1 | 6187874 | CHANGE | CHANGE | refrozen cells `failed` with a short cooldown, never `opened`; re-digs re-priced; collision model and slabs; health events; ice well guard; C7 exact; C6 oxygen-aware; **the dig priced with the pose's eye** (Claude P1); a drop restarts the window; exposure needs a success |
| — | rebase | — | — | ported to 4970c91; toolhygiene's `airPocketTools` kept; the window handoff removed (a separate owner session owns it) |
| 2 | 1b0cdb56 | CHANGE | APPROVE-WITH-CHANGES | a synchronous eye scope restored to mineflayer's crouch state; a closed re-dig is refrozen |
| 3 | 649c5475 | **APPROVE** | APPROVE-WITH-CHANGES | the body agrees with the jump at the dig call, priced as sent |
| 4 | 726ea0a2 | CHANGE | APPROVE-WITH-CHANGES | a body that never agrees is never dug; an abort wins |
| 5 | 40209b26 | **APPROVE** | APPROVE-WITH-CHANGES | a "never settled" refusal gets the short cooldown |
| 6 | **ccc593f7** | **APPROVE** | **APPROVE** | — |

**Suites** (`npm test`, clean archive exports): **239/239 files** on ccc593f7 (`ap2-on-4970c91`) and **242/242** on 1bea197f
(`ap2-on-6f1921a`).

**Launch preconditions, from both reviewers:**
- the Paper evidence above;
- **the operator names hive-d in the draw**;
- the open-window fix is pulled in when it lands. It does not block this build: the race is pre-existing.
