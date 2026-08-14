# 3 · One owner per control

## The brief

When two parts of a program can both steer, and neither knows the other
exists, the vehicle oscillates. One system says "climb the shaft," another
says "that pathfinding goal looks stale, clear it" — and the bot spends an
hour turning in place while both systems believe they're helping.

The rule has three parts. Every control (movement goal, dig target, look
direction) has **exactly one owner** at a time. The owner **re-asserts** its
claim continuously while it works — so a squatter gets evicted immediately
rather than discovered later. And the owner **releases explicitly** when
done — nothing is ever cleaned up by "it's probably been long enough," because
your timeout will fire exactly when the legitimate owner needed ten more
seconds.

## The deep end

### The scar

Surface climbs were being killed in 2–6 seconds by our *own* reflex layer: a
goal-hygiene guard saw a pathfinder goal it didn't recognize and cleared it —
while the ascent code was mid-climb using it. The fix that stuck was
architectural: `shaftAscend` owns no pathfinder goal at all (dig-and-pillar,
nothing to steal), and the ownership rule became doctrine (see the
`control-state-has-no-owner` memory): the guard wasn't wrong to exist, it was
wrong to clear state it didn't own.

### The rule

- Seize a control once, explicitly.
- Re-assert ownership every tick you still need it (cheap, idempotent).
- Release explicitly on completion, failure, or abort — all three paths.
- No component may clear a control it does not own; no component may
  timeout-clear its *own* controls as a substitute for real release paths.

### Why it's true

Multi-writer state with implicit lifetimes is a race by construction. The
re-assert discipline converts "who owns this?" from a forensic question into
a live signal, and explicit release forces every failure path to be written
(the paths that timeout-clearing lets you skip are exactly the ones that
leak). This is the concurrency lesson every system relearns; agents relearn
it harder because the LLM adds a writer whose behavior isn't enumerable.

### How it shows up per game

- **Minecraft** (built): pathfinder goals, dig operations, look control.
  The watchdog escalation ladder respects skill ownership; rescue skills own
  their controls end-to-end.
- **TrackMania**: the coach and the RL training loop share the game instance.
  Save-state restores, speed changes, and run resets need one owner —
  a coach restoring a save state mid-evaluation-run poisons the metric the
  same way goal-clearing killed climbs.
- **BAR**: the sharpest version — five tiers CAN all issue orders to the
  same units. Ownership becomes scope: strategy owns standing intent, a
  front's units are owned by their tier-2 coordinator, tier-1 may interrupt
  within its envelope. Every cross-tier override is logged as an event, never
  performed silently.

### The prediction

In any new game, the first "agent oscillates / freezes / undoes its own work"
bug will trace to two components writing one control with no ownership
protocol — and it will initially be misdiagnosed as a model-quality problem.
Check writers before blaming brains.

### The record

- **2026-08 · Minecraft**: held; the doctrine ended the goal-stealing class
  of bugs outright.
- *TrackMania: prediction pending.*
- *BAR: prediction pending — arbitration design already applies this pattern.*
