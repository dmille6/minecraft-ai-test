# 2 · The cadence stack

## The brief

A bot needs more than one speed of thinking. Yanking your hand off a stove is
not the same kind of decision as choosing a career — and wiring both to the
same brain ruins both.

So we stack brains by speed. At the bottom: pure reflexes — hard-coded rules
that fire in milliseconds (you're drowning, swim up; you're on fire, move).
No AI involved, ever. Above that, increasingly slow and increasingly smart
layers: quick tactical calls every few seconds, deliberate planning every
half minute, grand strategy every few minutes. Each layer up sees a bigger
picture, decides less often, and hands its decision down as guidance rather
than direct control.

The rule that makes it work: **the bottom layer is never a language model.**
An LLM is too slow for survival and too expensive for twitching. If a
decision must happen in under a second, it's a rule, not a thought.

## The deep end

### The scar

Not one incident but the architecture's whole origin: bots died to drowning
and lava during the 20–30 seconds their LLM was thinking. The 500ms reflex
layer (breathing, eating, fleeing) exists because deliberation-speed survival
is a contradiction. The complementary scar is the admission gate: when the
LLM layer was allowed to fire too often, it thrashed — proposing, abandoning,
re-proposing — so cadence control (`LLM_DECISION_COOLDOWN_MS`) became a
first-class mechanism, not a rate limit bolted on.

### The rule

Layers, slowest on top, each with: a cadence, a scope of authority, an input
summary appropriate to its altitude, and a defined handoff (intent flows
down; compressed reports flow up). Tier 0 is deterministic code. The
inference budget concentrates where the volume is: cheap models at fast
tiers, expensive models at slow tiers.

### Why it's true

Latency and judgment trade off through model size, and no single point on
that curve serves both ends. Stacking also bounds cost — the fast tier makes
thousands of calls per hour and must be cheap; the slow tier's model can be
two orders of magnitude larger because it fires two orders of magnitude less
often. And it bounds damage: a bad tactical call wastes seconds; only the
slow, well-resourced tier can waste an hour.

### How it shows up per game

- **Minecraft** (built): 500ms reflexes → 20–30s LLM deliberation →
  admission gate → deterministic skills. Two tiers of thought.
- **TrackMania**: the stack splits across *paradigms* — tier 0 is an entire
  RL policy (control is all reflex here), and the LLM tiers become the coach:
  drill selection every few minutes, reward design every few runs. Purest
  form of "the bottom layer is never an LLM."
- **BAR** (designed 2026-08-12): the five-tier commander — Lua rules (frame),
  3–4B squad tactics (2–5s), 7–8B front coordination (5–20s), 14B operational
  (30–60s), 70B strategy (1–5min). Hardware maps to the pyramid: 3090 carries
  tiers 1–3, RTX 6000 carries tier 4.

### The prediction

Any single-model, single-cadence agent in a real-time game will exhibit one
of two failure silhouettes: deaths-while-thinking (cadence too slow for the
environment) or thrash (cadence faster than actions can complete, plans
cancelled before they run — see pattern 3). BAR tier count is itself an
experiment: we predict 5-tier beats 3-tier at equal GPU budget, and commit to
finding out.

### The record

- **2026-08 · Minecraft**: held. Every removal of a layer (reflexes off,
  cooldown too short) produced the predicted silhouette.
- *TrackMania: prediction pending.*
- *BAR: prediction pending — tier-count experiment pre-registered in spirit.*
