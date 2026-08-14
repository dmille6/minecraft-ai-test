# 6 · Failure text teaches

## The brief

When something fails, the system knows *why* — the error says "no oak logs
within 32 blocks" or "you can't dig without a pickaxe." For a long time we
threw that sentence away and kept only the fact of failure. The bot learned
"gathering failed here" when it could have learned "there are no trees
underground — go up first."

That's the difference between a punishment and a teacher. A bare failure mark
can only steer you away from things. The failure's *text*, fed back into the
next decision, steers you toward the fix. Same information was always there;
we were just spending it as a fine instead of a lesson.

The rule: failure messages are written for the learner, not the log. Every
failure carries a typed class (what kind of wrong) and a human-readable
detail that, ideally, contains the next action ("gather 8+ dirt or
cobblestone first, then run surface again").

## The deep end

### The scar

The learnability review (2026-08-12): bots below ground held every fact
needed to save themselves — craft said "gather oak_log first," gather said
"no oak_log within 32 blocks," every record carried y=-42 — and nothing
joined them. The joined-up version is exactly what a failure detail can
carry. The fix paired with pattern 5: `climbAdvice` converts a stopped climb
into a recipe (no scaffold → "gather 8+ dirt or cobblestone first"; liquid →
"walk away from the water"; dig failed → "craft a pickaxe"), all ending with
"then run surface again" — failure as a pointer to the retry, not a verdict
against it.

### The rule

- Every failure has a `failClass` (typed, aggregatable — `dig_budget`,
  `path_interrupted`, `stranded`, `nothing_found`) and a `detail` (prose,
  fed into subsequent prompts).
- Details are written as instructions where the fix is known, evidence where
  it isn't. "Exceeded 8000ms" is telemetry; "exceeded 8000ms — the block
  needs an iron pickaxe" is curriculum.
- The typed class carries the *quorum* weight in shared memory (a warning
  needs corroboration); the text carries the *pedagogy*.

### Why it's true

An LLM decision layer is a text-in/text-out reasoner: its capacity to avoid
a repeat is bounded by what the failure record says. Numeric codes force the
model to rediscover causes; prose details let one failure transfer as
knowledge. This is uniquely an LLM-agent advantage — an RL policy can't read
"craft a pickaxe first," but a language layer can, which means failure text
is among the highest-leverage bytes in the whole system.

### How it shows up per game

- **Minecraft** (built): `failClass` taxonomy in skills; `climbAdvice`;
  admission-gate rejections carrying the *reason* term (`learned_avoid` vs
  `cooldown` vs `bad_args` — the 58% metric was meaningless until split).
- **TrackMania**: the student can't read, but the coach can — telemetry
  diagnosis ("crashes cluster at turn 3 entry above 480 speed") IS the
  failure text, and the coach's whole function is converting it to
  curriculum. Pace notes are failure text refined into standing advice.
- **BAR**: sitreps upward must carry *why* ("push failed — their T2 arrived
  before ours") not just outcomes, or tier 4 re-orders the same doomed push.
  Every order rejection/override includes its reason for the same reason.

### The prediction

In any new game, decision quality will improve measurably when failure
records go from typed-only to typed+instructive-text, with no model change —
and the improvement will be largest at the smallest models (they benefit most
from being told, least able to infer). Cheap A/B once the harness logs both.

### The record

- **2026-08 · Minecraft**: built into `phase1-learnability`, ships at Block 1
  close. The 58%-veto reclassification (split by reason term) already proved
  the typed half's value in analysis.
- *TrackMania: prediction pending.*
- *BAR: prediction pending.*
