# The falls instrument has one gap, and it is in front of the next design (evening session, 18 Sep 11:45 UTC)

Handed to the operator of record. This does not contradict `status-report-2026-09-18.md` — it adds one column to the
same 31 rows, and it changes what the next falls change should be.

## What the rows say when you group them by "did the planner ask for this drop?"

| group | rows | what they are |
|---|---|---|
| planned drop 4-5, fell 4-5 | 27 | `maxDropDown = 6` doing what it is set to do, at one or two hearts each. Not a defect. |
| planned 49, fell ~5 | 1 | the genuine infinite-liquid dropdown the status report names |
| **no planned drop anywhere in the path** | **3** | the bot fell 4-5 blocks on a route with no drop in it |

Heights are damage-implied (`fall damage = blocks - 3`), never the row's `fell N`, which the 1 Hz peak sampler
overstates by keeping height from an earlier hill.

## The gap: all three unplanned rows carry a path that was planned DURING the fall

Every one of the three has the same signature: path status **`partial`**, path age **0 s**, descent onset **0-2 s**
earlier. The record keeps the LAST accepted path, so at a fall that is the pathfinder's mid-fall replan, not the plan
the bot was executing when it left the ground. `index.mjs` already notes whether a path was active at descent onset
(`descentOnset.pathActive`) but keeps only the boolean.

So the three unplanned rows are not yet evidence of an unplanned fall. They are evidence that the instrument cannot
yet see the plan that matters.

## What to do before designing a drop-leg guard

1. **Snapshot the path record at descent onset**, not a flag: in the peak sampler where `descentOnset` is set, keep a
   shallow copy of `lastPlannedPath` (it is already a plain object with a pre-computed drop profile), and have
   `composeFallRow` print both — "at descent" and "now". Small, report-only, no behaviour change.
2. **Reproduce the fatal class in the sandbox instead of waiting for it.** No fatal fall happened in 90 canary
   bot-hours; the fleet's run ~0.01/bot-h at a 35-block median, so a 6-hour 10-bot canary will almost never contain
   one. `sandbox/make-ledge-fixture.py` already builds a platform over a 30-block pit (it was written for explore's
   blind walk); a run with the instrument on answers "what did the planner ask for" for a real 30-block fall in
   minutes.
3. Only then design. The candidates the evidence can distinguish once (1) lands: a leg that steps off an edge the
   plan did not contain (execution overshoot), versus a planned drop whose landing the body misses.

## One row that already has a mechanism
`placebo-b-Comet 03:49:24`: planned 5.3 onto solid, fell ~12, landed on `pointed_dripstone` (which adds damage).
Worth its own look: the planned landing was solid and the bot went past it.
