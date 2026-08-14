# 7 · Boundaries by architecture

## The brief

Our experiment compares groups of bots that share knowledge against loners
who can't. That comparison is only real if the loners *actually can't* —
one leak and we're comparing "sharers" against "sharers with extra steps."

We learned that a boundary maintained by good intentions always leaks. Our
bots politely kept their memories separate, and then leaked hard-won survival
knowledge through the village chat — a channel nobody thought of as "memory."
The information didn't care what we called the channel.

The rule: isolation is enforced by the system's plumbing, not by policy.
Messages carry their group's stamp; listeners drop anything from outside the
group *at the socket*, before any bot "decides" anything; and any channel
without a stamp is rejected outright. If a boundary matters to the science,
there's a test proving it holds.

## The deep end

### The scar

The chat contamination bug: chat was global while belief was pooled
(commit `e24495b`, "chat is global, belief must not be"). Isolated-arm bots
were ingesting hive discoveries via `announce*` messages — hazard locations,
technique reports — a full side-channel around the memory-scope treatment.
Fix: every announcement carries a `POOL` token; listeners return early on
pool mismatch; *unpooled* messages are rejected too (fail-closed — the
dangerous default is accepting unstamped traffic); isolated bots ingest
nothing. Locked by `comms-scope.test.mjs`.

### The rule

- Every information channel is enumerated and classified: in-treatment
  (scoped) or out (blocked). "We didn't think of it as a channel" is the
  failure mode, so the enumeration errs broad: chat, shared files, world
  state, even operator interventions (which are arm-blind for this reason).
- Scoping is enforced at ingestion, fail-closed, below the decision layer —
  a bot cannot choose to listen across a boundary.
- Each boundary that the experimental design depends on has a dedicated test
  asserting a cross-boundary message is dropped.

### Why it's true

Information is the treatment variable in every experiment this lab runs.
Leaks don't announce themselves — they *improve* the control group, which
looks like "no effect" rather than "broken experiment," the least detectable
kind of wrong. Discipline-based boundaries fail because systems grow
channels faster than conventions propagate; only enforcement collocated with
the channel itself survives refactors.

### How it shows up per game

- **Minecraft** (built): `MEMORY_POOL` scoping in memory, lessons, world
  facts, and comms; the pool is the boundary of ALL sharing.
- **TrackMania**: pace-note libraries are the treatment. Student B "with A's
  notes but not A's weights" requires the negative too: the uncoached control
  must provably receive *no* notes — and no shared filesystem paths where a
  note could be read by accident.
- **BAR**: two boundaries. Fog-of-war between opponents: the synced telemetry
  gadget sees everything, so per-commander sitreps MUST filter through
  `Spring.IsUnitInLos` per ally team — one omniscient leak silently
  invalidates every match it touched. And between-match memory arms (shared
  vs isolated scouting lore) reuse the pool pattern verbatim.

### The prediction

Every new game will have at least one channel nobody initially classified as
"information flow" (BAR candidates: the lobby/chat layer, replay files
readable across arms, shared map caches). It will be found either by
enumeration up front or by a contaminated result later. The enumeration
session costs an hour; the contaminated block costs the block.

### The record

- **2026-08 · Minecraft**: leak found live (chat), fixed and tested;
  contamination window quantifiable via 'reported over chat' citations in
  pre-fix records.
- *TrackMania: prediction pending.*
- *BAR: prediction pending — LOS-filter test is a design-now harness item.*
