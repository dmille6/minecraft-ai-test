# The layer under the seven modes

Written 2026-08-23, before building any of it, because the alternative is seven
more fixes stacked on the ones already stacked. Sources: an independent GPT-5.5
architecture review, and published work on Minecraft agents (Baritone, Voyager,
GITM, Project Sid/PIANO) plus the mineflayer-pathfinder issue tracker.

## How we got here

We implemented swimming as a REFLEX — an emergency response to stop drowning —
when water is a MODE OF MOVEMENT we had never built. It cost a day and tripled
the drowning death rate before that became obvious.

Generalising the mistake gives a diagnostic:

> Any handler that says "recover from state S" needs a paired mode that says
> "use S deliberately", or S is a capability wearing a hazard's clothes.

Applied to our reflex inventory it finds seven:

| # | reflex that exists | missing mode |
|---|---|---|
| 1 | `stuck` / `unstick_oscillation` / stranded | controlled descent |
| 2 | `marooned_needs_scaffold`, `entombed` | route construction: bridge/ramp/stair/ladder |
| 3 | `drowning` / `oxygen_critical_state` | water travel *(half-built)* |
| 4 | `reflex_danger_block` | hazard-adjacent routing |
| 5 | `entombed_unrecoverable` | deliberate tunnelling |
| 6 | `reflex_low_health` | combat / retreat *(nothing exists)* |
| 7 | `reflex_ate` | food production *(inert on peaceful)* |

Descent ranks first on evidence already in our own source (`index.mjs:334`):
5,115 stranded and 3,340 no_path at y=60–79 in seven days, against 40,696 events
in the deep caves everyone assumes is the problem. *"Bots DIE underground; they
LOSE THEIR TIME up here."*

## The inverse, which matters more

Three of our CAPABILITIES manufacture the hazards the reflexes fight, and two of
those are documented in our own comments:

- **`mine` digs down** — *"Digging down manufactures the one-way shaft that
  maroons bots, which is the failure mode the whole marooned/pillarOut apparatus
  exists to fix"* (`index.mjs:351`)
- **`allow1by1towers`** — Miner01 towered 14 blocks, could not get down, and that
  one bot produced roughly a third of that run's goto failures (`index.mjs:208`)
- **`explore`** — *"the generic relocation valve — what a bot reaches for when it
  does not know what else to do"*, 35,304 learned_avoid vetoes, more than twice
  the next worst (`skills.mjs:3111`)

Water was the same shape: the planner priced a wet step at ~86 so bots would
avoid water, they ended up in it anyway with no way to travel through it, and the
drowning reflex then fired constantly. **The hazard was manufactured upstream by
the avoidance policy.**

## The frame: it is not seven skills, it is one missing object

The seven modes are real but they are a level too low. What is actually missing:

> The bot does not persistently know which local states afford **entry, exit,
> return, construction, extraction or continuation** *for this bot with this
> inventory and health*. It treats terrain as momentary collision geometry rather
> than as a graph of reversible and irreversible commitments.

**Every trap in this system is a one-way door the bot walked through without
knowing it was one-way.** That reframes entrapment — our #1 productivity killer —
from a movement problem into a *knowledge* problem.

Current memory says "hazard here", "resource here", "unreachable target",
"action failed". It never says *"this topology changed"*, *"this edge is
one-way"*, *"this route is now an asset"*, or *"this plan consumed its own exit"*.

## What the field does, and what it implies for us

- **Baritone** models movement as a typed set — Traverse, Ascend, Descend,
  Diagonal, Pillar, Parkour, ParkourPlace, Fall, Downward — each with its own
  cost function AND execution routine. It bridges gaps, climbs and descends vines
  and ladders, breaks falls by grabbing ladders midair, and can fall arbitrary
  distances placing a water bucket beneath itself. **Descend and Fall are
  first-class movements, not rescues.** Ours are neither.
- **Voyager** keeps an ever-growing skill library of executable code in a vector
  DB, retrieved by docstring embedding, composing complex skills from simple
  ones: 3.3x unique items, 15.3x faster tech-tree progression, and the only
  system in its comparison to mine diamonds. **Our skill set is fixed and our
  milestone ladder is fixed.**
- **GITM** decomposes goals → sub-goals → structured actions, with text memory of
  successful plans, reaching 67.5% on ObtainDiamond. **Our ladder is flat, not
  hierarchical, and it terminates at stone_pickaxe.**
- **Project Sid / PIANO** runs many concurrent modules with a central coherence
  mechanism across 1,000 agents. Our 500ms-reflex/30s-cognitive split is a
  two-module special case of the same idea.

The consistent finding across all four: **agents that accumulate reusable
structure beat agents with a fixed capability set.** We have a fixed set.

## Library bugs we are probably already hitting

From the mineflayer-pathfinder tracker, all plausibly live in our deployment and
all worth checking against our pinned version before we build on top:

| issue | symptom | our matching evidence |
|---|---|---|
| #273 | partial path leaves an active goal; bot stuck until a new goal is set | `_path_reset` at ~95/bot-h, goto ~34% |
| #296 | fails to place a block while scaffolding but keeps moving, and falls | 7 fall deaths appeared after the water work |
| #54 | **cannot jump higher than the water block it is in** | swim measured 1.3–2.5 m/s vs ~5.6; our `swim_to` holds `jump` continuously |
| #222 | hangs indefinitely on an unbreakable block | stuck/stagnation |

**#54 is the swim-speed bug.** Holding `jump` in water cannot raise the bot above
the water block it occupies; it bobs. That is a concrete, cheap fix.

## The programme, in dependency order

**Layer 0 — the affordance ledger.** A persistent, per-bot, edge-based record of
what was actually tried: `A→B worked by walking`, `B→A failed, drop too high`,
`A→B needs scaffold`, `shaft at x,z is one-way down without 12 blocks`, `this
crossing made 80 blocks of progress and was not a failure`, `this route was built
and should be reused`. Edges, not a world model. **Record only what actions
prove.**

**Layer 1 — the capability model.** "I am currently a wooden-pickaxe, no-blocks,
no-ladder, no-boat, no-known-route agent." Today capability is discovered at
failure time; it should shape admission before the LLM picks anything.

**Layer 2 — commitment contracts.** Every topology-changing or topology-entering
skill declares preconditions, an expected progress signal, an abort threshold, an
exit obligation, and the ledger fact it writes:
- `mine` may descend only with an ascent contract
- towering may build only with a descent contract, or the tower is committed as
  reusable infrastructure
- `explore` may relocate only within a home-range budget unless it has a
  route-back or a cache purpose
- route construction succeeds only if it creates a reusable traversable edge, not
  merely if blocks were placed

**Layer 3 — admission prices reversibility**, not just learned-avoid. A one-way
action is not forbidden; it must be knowingly bought.

**Layer 4 — the seven modes**, as implementations that satisfy contracts and
write affordances. In order: controlled descent, route construction (bridge
first), water travel (finish it), tunnelling, hazard-adjacent routing, retreat,
food production.

**Layer 5 — economy and endpoints.** Deposit-driven milestones, route reuse,
resource siting, tech ladder extension. *Only here*, because bots can want
productivity and still lack the topology to sustain it.

## What we would regret building the seven modes as siblings

Seven hand-authored islands, each with its own movement profile, failure
vocabulary, abort logic and telemetry:

- water travel learns "crossing progress" while descent still learns "stranding"
- route construction places infrastructure that `goto` and `explore` never prefer
  or preserve
- tunnelling creates shafts unless bound to an ascent contract
- combat retreat flees into terrain the bot cannot exit
- food production lets bots spend longer trapped, productively doing nothing
- controlled descent fixes towers locally while `allow1by1towers` still makes
  non-reversible climbs elsewhere

The core regret: **skills encoding policy that belongs in a shared layer.**

## The failure mode of this plan

Over-modelling. A beautiful traversal ledger that is stale, expensive and too
conservative — bots stop taking useful risks because everything needs a contract,
and the system becomes safer and less productive, with fewer spectacular failures
and slower learning.

The guardrail: keep the ledger **edge-based and empirical, never
symbolic-world-complete**. Do not model Minecraft. Model the bot's lived
affordances.

## Immediate order of work

1. Verify the four pathfinder issues against our pinned version. #54 is the
   swim-speed fix and is nearly free.
2. Layer 0 + Layer 1, minimal: edges and capability, no contracts yet.
3. `climb_down` and `bridge_to` as the first two contract-bearing modes.
4. Only then the deposit economy and the tech ladder.

Every step passes the lexicographic harm gate before the next starts. That gate
exists because optimising a mechanism-local metric — drowning escape rate — while
harm rose is exactly how this week went.
