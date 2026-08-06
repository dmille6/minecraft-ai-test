# 30-day plan: build an instrument that can observe itself

**Status:** plan only, nothing here is implemented.
**Written:** 2026-08-06, after a day that found nine defects, all of which were
found because a human asked a question rather than because anything reported them.

## The goal, stated so it can fail

At day 30 we can say **what happened and why, without trusting the agent's own
story.**

We do **not** claim the agents learn. We do not attempt to make them smarter.
The deliverable is an instrument, and the test of an instrument is whether it
detects things — including deliberately planted faults.

## The reframe that changes the sequencing

The 7b-vs-14b A/B currently running is **not interpretable as model evidence.**
It has spanned a milestone-controller fix, an inventory telemetry deploy, an
endpoint-pool change and three window resets. With no `decision_id` and no
record of human intervention, it mostly measures which harness state each model
happened to experience.

Read it out as a **shakedown of the telemetry pipeline** — did milestone events
fire, did both arms stay alive, did the guard hold — and then discard it as
model evidence.

Consequence: **freeze experiments, not repairs.** The earlier plan waited for
the A/B before touching the fleet. That protects a result that does not exist.
Observability work starts immediately.

## Hardware reality

- **R640s (4× 384GB, 8TB NVMe) and the 40TB NAS are available now.**
- **The A6000 arrives at ~day 30.** It is the hand-off point, not a resource
  during this work. Anything that depends on it is a day-31 plan.
- The flagship colony **is not migrated.** It stays where it is and is treated
  as a long-running observational subject. Replicates run on disposable worlds.
  Migration is considered only after backup, restore and rollback are drilled.

---

## Week 1 — the causal spine

Without this, everything later is cargo: you cannot compare models, snapshots,
baselines or hardware if a decision cannot be joined to its outcome.

- `decision_id` threaded through: cognitive proposal → gate verdict → skill run
  → world delta → reward → failure class. One id joins all three indices.
- **Human interventions become first-class events**, with blast radius: every
  deploy, restart, config change and manual fix emits a record naming which runs
  it taints. We are the dominant confound and are currently invisible in our own
  telemetry.
- Failure class `other` below 10%.
- Bot `log()` diagnostics reach Elasticsearch (only ERROR/WARN do today).
- Numeric inventory fields; `flattened` cannot aggregate.
- **Data quality fails closed**: an event missing `decision_id`, run id, world
  id, code sha or timestamp is rejected and counted, not quietly indexed.
- Clock discipline: monotonic *and* wall-clock timestamps on every event.

**Exit test:** sample 20 reinforcement events at random; reconstruct the full
causal chain for at least 19. Fewer than 19 means week 1 is not done.

## Week 2 — reproducibility, honestly scoped

Minecraft is not deterministic. Random ticks, mob spawns, weather, chunk load
order, bot login order, pathfinder timing and LLM sampling all vary. "The same
trace twice" is not achievable and pretending otherwise would manufacture the
exact false confidence this project exists to avoid.

- World snapshot/restore to NAS, taken from a **stopped or save-flushed** server
  so region, player and entity state are consistent.
- **Run manifest**: world snapshot id, code sha, config hash, model and
  sampling params, prompt version, schema version, bot roster, server version,
  plugin list.
- Immutable versioned event archive on NVMe/NAS. Elasticsearch is demoted to a
  search and dashboard layer over it. The raw JSONL already exists; it needs
  archiving, not trusting.
- Pregenerated chunks and a fixed world border, to remove chunk-generation
  variance as a confound.
- Frozen schema contract with an explicit migration policy.

**Exit test:** same initial snapshot and manifest, two runs, **bounded
divergence fully explained by recorded sources of nondeterminism.** Not
identical traces.

## Week 3 — replication capacity

- Provision one R640 as a Minecraft world farm. **Plan around tick capacity,
  not RAM**: Paper's main loop is single-threaded per world, and these Xeons
  have many cores of mediocre single-core performance. Start at 8 worlds,
  target 8–12, treat 16 as unproven until measured under real bot load.
- One R640 as bot fleet host. Deal with the per-IP `connection-throttle`
  (default 4000ms) by staggering joins and lowering it on private lab servers —
  not by inventing a network namespace per world.
- One R640 as archive + telemetry. **No Elasticsearch cluster** — single node
  plus the immutable archive is sufficient, and clustering now is infrastructure
  theatre.
- One R640 as batch runner. **Human-triggered, deterministic, idempotent,
  resumable, with locks and dry-run.** Not an agent: an agent running the
  experiments becomes part of the confound.
- Run quarantine: a world with bad ingest or schema drift fails closed rather
  than contaminating shared analysis.

**Exit test:** launch 8 worlds from one snapshot, run 8 fleets, collect
comparable telemetry from all of them, with one world deliberately failed and
correctly quarantined.

## Week 4 — negative controls first, then baselines

The most important experiment is not "does the LLM do well." It is **"can this
instrument detect a fault it was not told about."**

- **Negative controls** — plant these and verify the instrument catches every
  one:
  - a deliberately broken skill that reports success
  - an impossible goal
  - a fake reward with no measured world delta
  - a memory store filled with shuffled nonsense
  If any of these pass undetected, the instrument is not finished, and no
  positive result from it means anything.
- **Random-selector arm.** Cheapest and most brutal control: if the cognitive
  layer cannot beat random skill selection on milestones per bot-hour, the whole
  cognitive layer is decoration. Run this early; it may be the most informative
  number of the month.
- Then: scripted bot, current LLM bot. No-memory and shuffled-memory arms only
  after the harness proves it distinguishes the obvious cases.
- 72h hands-off frozen run on the flagship, in parallel. **Demoted from exit
  criterion to a parallel observation** — it does not prove the instrument
  works, but it is the only measurement of how much of the improvement is us.
- A6000 arrives. Install only. It is experiment infrastructure — parallel arms
  and evaluators — not a bigger agent brain.

**Exit test:** a report a third party can regenerate from raw artifacts, in
which every planted negative control was caught.

---

## Explicitly cut from 30 days

- Elasticsearch clustering
- Any A6000-dependent capability
- Fine-tuning of any kind — training on today's traces would bake today's
  measurement bugs into weights permanently
- Strategic/planning tier
- Fleet resource allocation
- More bots, new roles, personas
- Migrating the flagship colony

## Open decisions that need a human

1. **Bot identity**: names, UUIDs, auth mode across many worlds. Offline-mode
   UUIDs are derived from usernames, so 8 worlds × 5 bots needs a naming scheme
   decided before it is baked into telemetry.
2. **How much of the flagship's history is worth preserving** if its schema
   diverges from the new archive format.
3. **Whether a null result is an acceptable month-30 outcome.** It should be —
   "the cognitive layer does not beat random" is a real finding — but that has
   to be agreed before the data arrives, not after.

## The standard this plan is held to

Every deliverable above has an exit test that can fail. If a week's exit test
does not fail cleanly when the work is incomplete, the exit test is wrong and
should be rewritten before the work starts.
