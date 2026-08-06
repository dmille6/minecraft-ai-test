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
- **Fix `unstick`.** It is the last line of defence against a wedged bot, it
  ran 292 times in three hours, and it FAILS 36% of the time (188 rescued, 104
  not). Raising that to ~90% is worth more than any pathfinder change and does
  not touch the movement rules, so it carries no experimental risk. This is a
  repair, not an experiment.

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
- **Navigation constraint arms.** `allowParkour` on/off, `canDig` off vs
  dig-only-when-stuck, `maxDropDown` 6 vs higher, `thinkTimeout` 5s vs 10s.
  Each is a one-line change scored on movement-failure rate and milestones per
  bot-hour.

  This CANNOT run before the causal spine exists. Run today it would be
  uninterpretable for exactly the reason the 7b/14b A/B is uninterpretable --
  no `decision_id`, no intervention record, and a harness still being repaired
  underneath it. The temptation to run it early, because it is only a one-line
  config change, is the trap.
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

## Finding: navigation is constrained, not broken (2026-08-06)

87% of skill failures are movement-related. The obvious reading is "the
pathfinder is bad" and it is wrong.

Three hours of evidence:

```
101  "no route toward ..."      A* proved the goal unreachable
  7  "pathfinding exceeded"     timeouts -- rare
 ~90 "stalled N blocks short"   partial progress, then no legal continuation
188  unstick found a legal step
104  unstick FAILED             36% failure rate
```

Seven timeouts in three hours. The pathfinder is not slow and is not failing to
compute -- it is computing correctly and reporting, accurately, that no route
exists.

A first theory -- that the bots had dug their surroundings into traps -- was
DISPROVEN by altitude. Movement failures track successes almost exactly at every
height (y=70-74: 194 failures/145 successes; y=75-79: 215/216; below y=70:
28/29), and split evenly between `gather` (214) and `goto` (207). Failures are
proportional to activity everywhere, not concentrated in pits. Recorded here
because the wrong theory was stated confidently before it was checked.

The real suspect is the movement ruleset:

```js
moves.canDig = false          // digging caused constant tunnelling
moves.allowParkour = false    // "top source of stuck states"
moves.maxDropDown = 6         // raised from 4 after a bot sat immobile 10 min
moves.allow1by1towers = true
thinkTimeout = 5000           // lowered from 10s to protect the harvest budget
```

Each was added to fix a real observed problem. Their JOINT cost has never been
measured. Three compounding restrictions on how a bot may cross terrain produce
a fleet that, in dense forest, often genuinely has nowhere legal to go. Same
accumulate-without-review shape as failure counts that never decayed and a
`skipped` list that only grew.

Note especially that `allowParkour` was disabled BEFORE the entombment reflex
and `unstick` existed. The evidence that condemned it predates its safety net --
reputation outliving the code that earned it, which is a pattern this project
has now hit four times.

## Explicitly cut from 30 days

- Elasticsearch clustering
- Any A6000-dependent capability
- Fine-tuning of any kind — training on today's traces would bake today's
  measurement bugs into weights permanently
- Strategic/planning tier
- Fleet resource allocation
- More bots, new roles, personas
- Migrating the flagship colony

## Decisions taken (2026-08-06)

### 1. Bot identity: identical names everywhere, `world_id` mandatory

Bots are `Scout01 … Gather02` in EVERY world. The world is a separate, required
telemetry dimension; it is never encoded in the username.

The alternative (`w03-Scout01`) puts meaning inside a string that then has to be
parsed identically in more than one place, which is the exact defect that froze
the admission gate: the action key was `JSON.stringify` over model output in one
file and a separate `key()` in another, and they drifted. Role, arm and world
belong in structured fields.

Identical names also make the comparison we actually want trivial -- Scout01 in
world A against Scout01 in world B, same role, same chain, different condition --
and avoid Minecraft's 16-character username limit, which gets tight once world
and arm are prefixed.

The failure mode ("two worlds become indistinguishable if `world_id` is
missing") is already covered by the week-1 gate that rejects any event lacking
`world_id`, `run_id` or code sha. That gate exists for this.

Offline-mode UUIDs derive from the username, so identical names give identical
UUIDs across worlds. That is acceptable and arguably correct: "the same agent
identity under different conditions" is the object of study. Separate servers
keep separate player data.

### 2. Flagship history: frozen, labelled, never migrated

Preserve it all raw. Stamp it `schema_version: pre-instrument` and
`evidence_class: historical/uninstrumented`. Analysis tooling must REFUSE to
join it to post-instrument data.

Migrating it into the new schema is the most dangerous option available, because
it would make known-bad data look like good data. The contamination is precisely
known: `status` reinforced as a win 115 times off a hardcoded flag; `worked`
counts spanning both the measured and unmeasured eras; no `decision_id`; 36% of
failures classed `other`; version stamps pinned to a stale commit. Cleaned and
merged, none of that remains visible.

It is not deleted, because it is the raw material for the failure museum and the
only record of what an UNINSTRUMENTED run looks like -- which is the control
condition for the entire thesis. Storage is not the constraint at 40TB.

`world_id: flagship` is backfilled during archiving.

### 3. A null result is an acceptable day-30 outcome

Agreed BEFORE the data exists, which is the only time such an agreement means
anything. "The cognitive layer does not beat random skill selection" is a
finding, not a failure, and it would be one of the more useful things this
project could report.

## Immediate, before anything else

A flagship backup and RESTORE drill. Not a backup -- a drill: prove the world
can be restored from the NAS copy into a throwaway server and comes up intact.
An untested backup is a belief, and this project has spent a day learning what
untested beliefs cost.

## The standard this plan is held to

Every deliverable above has an exit test that can fail. If a week's exit test
does not fail cleanly when the work is incomplete, the exit test is wrong and
should be rewritten before the work starts.
