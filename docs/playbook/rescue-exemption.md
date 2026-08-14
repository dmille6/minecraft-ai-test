# 5 · The rescue exemption

## The brief

We accidentally taught our bots to give up.

The memory system's job is to notice "that didn't work here" and steer bots
away from repeating it. Useful for "don't mine that flooded shaft." Fatal
when applied to the *escape* skills: a bot stuck underground tries to climb
out, fails once, records "climbing out doesn't work," and never tries again.
It has learned helplessness — the avoidance system, working exactly as
designed, walled off the only door.

The rule: skills whose purpose is recovery — get to the surface, go home,
escape the water — are **exempt from avoidance learning, permanently.** A
failed rescue may not become a reason to never attempt rescue. And when a
rescue fails, the response isn't a black mark; it's advice (see pattern 6):
"you need blocks to pillar with — gather some, then try again."

## The deep end

### The scar

exp-001, Block 1: isolated-arm bots stuck deep underground, 4-of-4, while
hive bots — pooling avoid-rules *faster* — were less stuck. Diagnosis: the
lesson store had accumulated context-free avoid keys (`surface:{}` — avoid
"surface" with no arguments, i.e., always) from early failed climbs. The
avoidance was arm-blind but its consequences weren't, and the system's
dominant learned behavior became "don't try." The fix (branch
`phase1-learnability`, shipped at Block 1 close): `rescue: true` on
surface/home in the skill registry; `recordFailure` early-returns for rescue
skills; a purge-on-load that deletes rescue avoid keys already installed;
and `climbAdvice` recipes replacing tombstones with instructions.

### The rule

- Rescue skills never write avoid rules. Not rate-limited — never.
- Existing rescue avoids are purged on load (systems inherit their own bad
  lessons; the fix must clean history, not just stop the bleeding).
- Rescue failures route to advice generation: the failure detail becomes a
  precondition hint ("no scaffold blocks → gather 8+ dirt first"), keeping
  the retry *informed* rather than blind.

### Why it's true

Avoidance learning assumes trying has substitutes — if this spot fails, mine
elsewhere. Rescue has no substitute: the alternative to escaping is staying.
For any skill where not-acting is strictly worse than acting-and-failing,
negative feedback must convert to *guidance*, or the learner converges on
paralysis. This is operant learned helplessness, reproduced in silicon on
the first try — which suggests it's the default outcome, not an edge case.

### How it shows up per game

- **Minecraft** (built): `SKILLS[skill].rescue`, purge in `lessons.mjs`,
  `climbAdvice` in `skills.mjs`.
- **TrackMania**: the coach must never learn "drilling turn 3 doesn't work —
  stop drilling turn 3" from reps that fail (failing reps are what drilling
  *is*). Curriculum selection needs the exemption: practice on weaknesses is
  rescue-shaped, and avoiding weakness because it's weak is the same
  paralysis.
- **BAR**: retreat, base defense, and reclaim/rebuild intents are
  rescue-class. A commander whose memory says "defending doesn't work" after
  one lost defense will stop defending — the strategic version of never
  climbing out.

### The prediction

Any agent system with (a) failure-driven avoidance memory and (b) skills
whose alternative is worse than failure will develop helplessness in category
(b) unless explicitly exempted — and it will look like a *capability*
regression ("the bots got dumber") rather than a memory pathology. Check the
avoid store before retraining anything.

### The record

- **2026-08 · Minecraft**: pattern discovered here; fix built and parked on
  `phase1-learnability`, shipping at Block 1 close per freeze discipline.
  The stuckness asymmetry rides as Block 1 data (hives less stuck despite
  faster avoidance pooling — treatment-driven, survives the bug).
- *TrackMania: prediction pending.*
- *BAR: prediction pending.*
