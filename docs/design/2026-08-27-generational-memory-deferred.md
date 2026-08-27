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

### What the search found (added after the write-up)

A web pass against the indexes directly, with a control query to prove the
queries worked, settles it harder than the reasoning above:

| index | query | result |
|---|---|---|
| arXiv | `all:"WorldBox"` | **0** |
| arXiv | `all:"MineDojo"` (control) | 8 |
| Semantic Scholar / DBLP / Crossref | `WorldBox` | **0 / 0 / 0** |

Not "hard to find" — absent. No papers, no preprints, no workshop papers.

And the decisive technical fact: **the LLM plays the god, not the
inhabitants.** The community bridge's action space is `invoke_power`, `spawn`,
`paint_tile`, `set_speed`, `pause`; the read space is `get_world_state`,
`list_kingdoms`, `query_actors`. There is **no per-unit action API**. The thing
people imagine — Project Sid-style agents living inside a civilization — is
precisely what WorldBox does not afford.

The units confirm it. The decompiled namespace is `ai.behaviours`:
hierarchical task→action lists with retry checks at unit/city/kingdom tiers,
hand-authored and stateless-reactive. Units carry `money, experience, renown,
kills, food_consumed, births` — counters, not memory. Nothing transfers
between units. The community's own reverse-engineered API reference has pages
for Actor, City, Kingdom, Building, WorldTile and **no page for a behaviour or
decision API at all**.

Blockers beyond that: closed source (Unity, Mono backend), no official mod API,
**no headless mode** — every working bridge needs the game window, the best is
Windows-only — **very likely non-reproducible** simulation, and ~16 GB RAM for a 30x30-zone map
with 40x40 crashing. The save format is the bright spot: `.wbox` is
zlib-compressed JSON beside a SQLite stats DB, both parseable offline, with
three independent third-party readers.

**Determinism: assume NO, and this is the decisive technical disqualifier
independent of everything else.** There is an internal world seed but *you
cannot enter one* — `generateNewMap()` takes no parameters, "add world seeds"
is an open and never-implemented feature request, and the genetics seed is
derived from the wall-clock UTC creation hour. Version 0.51.0 shipped
"fixed: a single-thread random number generator was running during multi-thread"
and "increased random entropy in general". Nobody has ever tested save-reload
reproducibility. For a lab whose entire method is controlled arms compared
against each other, plan for replicates rather than seed-matched pairs — which
is a much weaker experimental instrument than what Minecraft already gives us.

Also: there is **no culling**. The developer, on Steam: *"WorldBox simulat[es]
all existing entities… Opposite to example, Minecraft, where if there's no
players on a specific chunk it's kept in 'storage'."* Cost is O(total
entities), lag onset is reported around 1,000 population, and ~30fps at 6,000.

**Two corrections from a second pass that read the binary directly**, recorded
because the first version of this doc got them wrong:

- **Speed is NOT capped at 20x.** `x10/x15/x20` are hidden from the UI but
  accepted programmatically, and the game computes
  `Time.fixedDeltaTime * Config.time_scale_asset.multiplier` — mutating that
  multiplier in place gives arbitrary turbo in about two lines. But the speed
  is not faithful: the game's own debug menu warns that its fastest mode
  "can cause lag and **simulation inconsistencies**" and that "some process
  will not go past 20x speed", and the changelog is a long history of fixing
  individual subsystems that behaved differently when sped up. **Do not assume
  5x is 5x the same simulation.**

  (An earlier version of this note said the sim was single-threaded, inferred
  from the absence of Job System and Burst symbols. That inference was wrong —
  the changelog shows the game is multithreaded. Absence of those symbols means
  it does not use Unity's job system, not that it uses one thread.)
- **The game ships its own undocumented automation harness.**
  `Assets/Scripts/tools/auto_tester/` — 66 files, `AutoTesterBot.cs` and ~60
  behaviours including `TesterBehGenerateMap`, `LoadWorld`, `FillWorld`,
  `SpawnRandomCivUnit`, `ChangeWorldSpeed`, `WaitYears`, `RequireUnits`,
  `CheckWorld`, `Shutdown`. It is driven by a debug-menu button rather than a
  CLI flag, but a Harmony mod can drive it. Nobody appears to have written
  about this publicly.

Neither correction changes the verdict, and that is the point worth keeping:
the disqualifier was never speed or tooling. It is that the action space is
god-only and the units hold no beliefs. A faster, better-instrumented way to
play deity is still not a way to study agents.

The whole AI-adjacent niche is four months old, every repo single-author, and
the star ceiling is 6.

**The likely source of the claim** is Project Sid ([arXiv:2411.00114], 10–1000+
Minecraft agents under the PIANO architecture) or AIvilization
([arXiv:2602.10429], tens of thousands of agents in a resource-constrained
pixel sandbox — which *looks* like WorldBox and does what people imagine
WorldBox does).

### Worth stealing from the search, unrelated to WorldBox

- **`vukyn/worldbit`** — someone looked at WorldBox and *rebuilt* it in Go as
  "a deterministic agent-based world simulator — an experiment harness with a
  viewer attached, not a game." Headless batch seed runs, parameter sweeps,
  FNV-1a state hash identical at every tick, no floats, no uncontrolled
  randomness. That is what wanting the research thing actually looks like.
- **`Lous12/worldbox-modding-docs`** tags every API claim with an evidence
  status — `VERIFIED-REVERSIBLE` under snapshot→one-write→restore proof,
  `VERIFIED-LIFECYCLE` with stale-read counts — and keeps a `graveyard/` of
  falsified assumptions. Unpaid modders running our own evidence-gate
  discipline, independently.
- **Better second platforms than WorldBox, if it ever comes up**: RimWorld has
  `pardeike/RimBridgeServer`, an in-game MCP server by the author of Harmony;
  Dwarf Fortress has DFHack and has been run headless in text mode by an LLM.
  Both expose the *colonist* layer and run without a display. WorldBox does
  neither.

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
