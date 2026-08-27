# Synthetic generations — a deferred experiment

**Status: DEFERRED. Not scheduled. Do not start this.**

Logged 2026-08-27 so the idea survives; explicitly parked by the project owner
as "long term, not something we will do for a long time." It is written down
because it is good, not because it is next.

## Where it came from

A question about whether **WorldBox** — the pixel-art god-simulator — is used
for AI research and whether it belongs on our roadmap. The honest answer was
no, for reasons that hold regardless of what the modding surface turns out to
support:

- its "civilizations" are game-AI entities and state machines, not agents with
  agent-local belief state, memory provenance, or inspectable reasons for
  action — which is the crux for a Zollman study
- it would be a new platform integration, not a port: mineflayer, the reflex
  layer, every perception and movement primitive, the deterministic skills,
  bot lifecycle and world provisioning would all be rewritten
- ranked 7th of 8 candidate platforms for our question, behind Neural MMO,
  Melting Pot, Stanford's Generative Agents, Crafter and NetHack
- and we are 23 days into a block whose measurement clock has never started,
  on a fleet that caps at stone tools and has gathered iron ore zero times.
  A second platform now rewards platform shopping over measurement.

But WorldBox does offer **one thing Minecraft does not give naturally**, and
that thing is worth keeping.

## The one idea worth stealing

**Population turnover.** Birth, aging, death, dynasties, replacement cohorts —
and therefore the question:

> Does collective memory help *descendants* learn faster, and does it preserve
> falsehoods after the original witnesses are gone?

That is a sharper version of our actual research question than anything
currently instrumented. It is the difference between "shared memory propagates
error" and "shared memory outlives the evidence that created it."

## How to get it here, without a new platform

Treat death as an **experimental intervention**, not a simulated biological
process. No new engine, no new harness.

- cohorts of bots with finite lifetimes — retire after N hours or N milestones
- spawn replacements under new identities
- **configurable inheritance** as the treatment axis:
  none · full shared memory · compressed cultural memory ·
  costly access via travel · corrupted oral tradition · placebo archive
- world artifacts persist across cohorts: signs, chests, maps, the bulletin
  board, structures
- measure whether true **and false** beliefs survive turnover

## The first test case, already in hand

`goto:{"x":355,"y":73,"z":147}` — the "home is unreachable" rule. Four bots
failed to path home from four different origins; because the rule is keyed by
destination, their unrelated failures merged into the most-corroborated and
most-wrong belief in the fleet, and it accounted for 12 of 13 inherited
citations.

Does that belief outlive the four bots that created it? That is the whole
experiment in one question, and the data to ask it already exists.

## Preconditions before this is even discussable

1. A measurement block has actually run, start to finish.
2. The claim format is fixed — belief identity keyed on the fact rather than
   on exact arguments (see the memory `tech-ceiling-is-the-shaft` and the
   board/hive schema work).
3. Iron ore has been gathered at least once, i.e. the substrate supports
   progression at all.

Until all three hold, this is a distraction wearing a lab coat.
