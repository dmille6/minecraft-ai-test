# 1 · The evidence gate

## The brief

When a bot tries something, the only honest verdicts are: it worked, it
failed, or we genuinely can't tell. The system is only allowed to *learn* from
the first two. "Can't tell" teaches nothing — it never becomes a memory, a
lesson, or a habit.

This sounds obvious until you watch what happens without it. A bot swims to
the surface for air, and the "gather wood" attempt it abandoned gets recorded
as a success because the code stopped without an error. Now the bot believes
something false, tells its friends, and three bots repeat a move that never
worked. One unverified outcome, believed, costs more than a hundred honest
failures — because failures stop at one bot, while false successes propagate.

The rule: every skill declares up front what the world will look like if it
worked (position changed, inventory grew, block gone), and the system checks.
No check, no lesson.

## The deep end

### The scar

Two incidents, same root:

- **The drowning floor case.** A bot standing in water "completed" its task by
  interrupting it to breathe. The skill returned without throwing, the runner
  logged success, and the lesson store credited a strategy whose actual result
  was near-drowning. The fix required a floor contract: a skill whose
  achievement is positional cannot succeed without a position change.
- **The `unknown` verdict class.** Early skills returned binary
  success/failure. Ambiguous ends (aborts, disconnects, timeouts) got coerced
  into one or the other — usually success, because no exception was thrown.
  The evidence gate added the third verdict and barred it from the lesson
  store: `unknown` is logged for telemetry but never learned.

### The rule

Every skill declares `expects` — the observable world-delta that constitutes
success (see `SKILL_CONTRACTS`). The runner verifies the delta after the run.
Verdicts are `success` / `failed` / `unknown`; only the first two may write to
memory, and `unknown` must never be silently coerced.

### Why it's true

Learning systems amplify whatever crosses the gate. A false failure costs one
retry. A false success becomes a lesson, spreads through shared memory, and
gets *defended* by the avoidance system (contradicting evidence is now
fighting an installed belief). The asymmetry means the gate should be biased:
when in doubt, `unknown` — the only verdict that can't compound.

### How it shows up per game

- **Minecraft** (built, battle-tested): `expects: ['position']` on surface,
  inventory deltas on gather, `SKILL_CONTRACTS` in `bots/src/skills.mjs`.
- **TrackMania**: trivially strong ground truth — lap/segment times are
  unarguable. The gate moves up a level: the *coach's* interventions need it.
  A reward-shaping change may only become "a thing that works" if the
  learning-curve delta is measured against a same-seed control, not because
  the run finished.
- **BAR**: the engine gives perfect ground truth (unit counts, damage,
  economy per frame). The gate applies to *intents*: "raid the north mexes"
  succeeded only if the telemetry gadget shows mex destruction, not because
  the order batch was issued.

### The prediction

In any new game, the first false belief will enter through an action whose
completion was mistaken for its achievement — the equivalent of "the code
returned, therefore it worked." If the gate is built before the memory system,
this never happens; if built after, we will find at least one propagated false
lesson in the first week of logs.

### The record

- **2026-08 · Minecraft/exp-001**: pattern held under load. The gate's
  strictness produced its own finding — avoidance learned faster than
  recovery — which is pattern 5's territory.
- *TrackMania: prediction pending.*
- *BAR: prediction pending.*
