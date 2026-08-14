# 13 · The harness is the contribution

## The brief

Ask what survives from any game-AI project five years later. It's almost
never the results — those get superseded. It's the *instrument*: the
tooling that made the game measurable, controllable, and repeatable. In
TrackMania, the entire research scene exists because one tool (TMInterface)
gave everyone save-states and deterministic control. In Factorio, one
open-source harness (FLE) turned a hobby into a benchmark the whole field
now cites.

So when we plan work, the harness is not overhead on the way to the science —
it IS a first-class product, likely the most durable thing we make. That
changes decisions: telemetry gets built before features, determinism and
replayability are requirements rather than luxuries, and anything we fix in
someone else's library is worth writing up and sending upstream, because the
repro script and the diagnosis are the valuable part and we already paid for
them.

## The deep end

### The scar

An inverted scar — this pattern comes from noticing where our *time went*
and where the *value pooled*. The instrumentation nights (ELK mappings,
`dynamic:strict` battles, exposure tables, per-bot craft/travel reports)
felt like taxes; they turned out to be the reason any finding in this lab is
trustable at all. Meanwhile the collectblock investigation (pattern 4)
produced, as side effects, a minimal repro and a precise retention-leak
diagnosis — which is a finished upstream contribution, arguably worth more
to the world than exp-001's headline result. External evidence agrees:
TMInterface and FLE outlived and out-cited most results built on them.

### The rule

- Harness capabilities are ranked by durability: determinism/replay,
  ground-truth telemetry, programmatic match/run control, decision logging.
  These get built *first*, not retrofitted (a run without decision logs is
  unanalyzable forever — there is no going back for it).
- Upstream findings are packaged while fresh: repro script + diagnosis +
  suggested fix. The bare-client script (pattern 10) is the bug report.
- Schemas and configs live in the repo as the canonical source, with an
  emitted-vs-mapped test — a dashboard that can't be rebuilt from the repo
  is a photograph, not an instrument.
- When choosing platforms, weigh the existing harness ecosystem as heavily
  as the game itself (it's why Factorio ranks above BAR on
  time-to-first-result, and why BAR ranks high on contribution value — its
  harness doesn't exist yet, so building it IS the contribution).

### Why it's true

Results are claims about a moving world — models improve, games patch,
conclusions age. Instruments compound: every later experiment inherits
them, including other people's. In open ecosystems the harness is also the
only part others can *use* without believing your conclusions. A lab whose
tooling is disposable re-pays the tax every project; a lab whose tooling is
a product gets faster every project.

### How it shows up per game

- **Minecraft** (living it): the five-layer runner, evidence gate, pool
  scoping, ELK pipeline, fleet tooling — plus the collectblock report as
  the first upstream artifact.
- **TrackMania**: the coach loop is *deliberately* built as a general
  instrument — "LLM reads learner telemetry, reallocates practice" — with
  TrackMania as its first calibration target, not its definition.
- **BAR**: the whole plan is this pattern — no FLE-equivalent exists, so the
  summarizer, fog-filtered sitrep gadget, decision logger, and match
  orchestration would be the first open harness for LLM commanders on the
  Recoil engine, useful to that community independent of our experiments.

### The prediction

For each platform, the harness will outlive the first three experiments run
on it, and at least one external party (upstream maintainer, another
researcher, a community member) will use a piece of it for purposes we
didn't design. If that never happens, we built it too coupled — which is
itself the failure mode this pattern exists to prevent.

### The record

- **2026-08 · Minecraft**: pattern recognized here; collectblock upstream
  report queued (task #20) as the first deliberate act under it.
- *TrackMania: prediction pending.*
- *BAR: prediction pending.*
