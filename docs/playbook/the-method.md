# 12 · The method

## The brief

The hardest discipline in this lab isn't in the code — it's resisting the
urge to *improve things mid-experiment*. Every small fix while an experiment
runs quietly destroys the comparison the experiment exists to make: was the
change in behavior your treatment, or your Tuesday patch?

So the method is four commitments, made *before* the data arrives:

1. **Arms** — groups differing in exactly one thing (who can share knowledge
   with whom), everything else identical.
2. **Pre-registration** — write down what you'll measure and what would count
   as a win *before* looking. Otherwise you'll find something in the noise,
   because there's always something in the noise.
3. **The freeze** — once the block starts, code doesn't change. Fixes are
   built, parked on a branch, and ship *between* blocks. If quality ever
   collapses, you end the block early — you don't patch it mid-stream.
4. **Blind hands** — when the operator must intervene (rescue a bot), the
   intervention follows the same written protocol for every arm and gets
   logged with before/after state. Helping one arm more than another *is* a
   treatment, whether you meant it or not.

## The deep end

### The scar

Accumulated, not singular. Pre-exp-001 data was ruled unusable as evidence —
weeks of running with continuous fixes meant no window was comparable to any
other (the memory archive is literally labeled "contaminated — do not
restore"). The 58%-veto alarm tested the freeze hardest: the alarming number
*was the finding*, and the agreed response was an emergency tripwire defined
in advance (close early only if non-forced admissions hit ~zero for 2+
hours), explicitly not a mid-stream patch. The undeclared-deploy incident
(instance #2's tripper stopping the fleet because a manifest wasn't updated
before restart) hardened the declaration rule. Pre-registration came from
the round-2 external review: primary metric productivity-per-bot-hour,
death decomposed into four metrics, everything else labeled exploratory —
committed before Block 2 opens.

### The rule

- One treatment variable per experiment; the unit of analysis defined up
  front (for us: the memory pool, not the bot).
- Pre-registered primary + secondaries; late-arriving metrics are marked
  exploratory forever.
- Freeze = pinned code digest, converged and verified on every host; parked
  branches ship at block boundaries; early close beats mid-block patching.
- Interventions: written protocol, arm-blind application, logged events with
  before/after state, never escalated out of worry.
- Deploys declared before restart, always, even for "small" things.

### Why it's true

Agent systems invite tinkering because they visibly struggle, and every
tinker is an uncontrolled co-treatment. The freeze converts "we think the
board arm helped" into "the board arm differed by exactly this." And
pre-registration is the defense against ourselves: with hundreds of logged
metrics, *some* will move; deciding in advance which ones count is the
difference between measurement and storytelling.

### How it shows up per game

- **Minecraft** (live): exp-001 — frozen at a pinned digest, arms fixed,
  let-it-ride rulings holding against real temptation (stuck bots riding as
  data), report skeleton written before close.
- **TrackMania**: same-seed/same-budget arms; the freeze covers the *student
  and environment* (game version, physics, hyperparameters) while the coach
  varies — the coach IS the treatment. Pre-register the four efficiencies
  (sample, compute, transfer, supervision) before the first coached run.
- **BAR**: freeze extends to the game itself — engine+game+maps pinned as an
  immutable bundle per block (upstream balance patches are undeclared
  deploys). Continuous outcomes pre-registered alongside win/loss because
  win/loss is one bit per half hour.

### The prediction

On every new platform there will be a moment mid-block where a fix is
obvious, cheap, one line, and *clearly* right — and shipping it would cost
the block's comparability. The park-and-ship-at-boundary mechanism is what
makes the discipline survivable; without a branch to park on, the freeze
breaks within days. Build the parking lot before the block starts.

### The record

- **2026-08 · Minecraft**: holding under live pressure — `phase1-learnability`
  parked while its bug's consequences accrue as data; the 58% alarm
  reclassified rather than patched; tripwire never yet fired.
- *TrackMania: prediction pending.*
- *BAR: prediction pending.*
