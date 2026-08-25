# What the field already solved, and we rebuilt badly

**2026-08-25.** A deliberately non-Minecraft survey — game AI, robotics,
RTS, pathfinding literature — put to three analysts on an identical brief:
ChatGPT, `gpt-oss:120b`, and `qwen2.5:32b`.

## The finding both strong analysts reached independently

**We built a subsumption architecture from 1986 without its arbitration
primitives.**

Brooks' layered control (1986) gives higher layers two named operations over
lower ones:

- **inhibition** — block a lower layer's *output* from reaching the effectors
- **suppression** — replace a lower layer's *input* with the suppressing message

We have the layers. We have no bus. Three independent command generators — the
LLM planner, the running skill, and the 500ms reflex — all call
`bot.setControlState` and `pathfinder.setGoal` **directly**. ChatGPT's phrasing
is the precise one:

> *"The bug is not 'layered architecture'; the bug is multiple uncoordinated
> writers to the same effectors."*

That is what `path_reset` at **19.3% of all events** actually measures.
mineflayer-pathfinder emits reset on goal change; we change goals from three
places that do not know about each other.

### What it would look like

Only one module may touch the body. Everything else submits a command:

```ts
interface BodyCommand {
  owner: "reflex" | "skill" | "planner"
  priority: number
  ttlMs: number
  goal?: Goal
  controls?: Partial<ControlState>
  cancelToken: AbortSignal
  reason: string
}
```

**Inhibition**: while the drowning reflex holds a lease, the skill stays alive
and its movement writes are ignored.

**Suppression** is the more interesting one, and we already built one instance
of it by accident today. Rather than seizing the body from `swim_to`, the
reflex replaces the skill's *traversal policy*:

```ts
skillContext.movementPolicy = {
  allowSubmergedCruise: false,
  requireAirEveryBlocks: 12,
  maxSubmergedSeconds: 6,
}
```

That is exactly the porpoising fix committed this morning — implemented as a
special case inside `swim_to` instead of as an architectural primitive.

### What arbitration will NOT fix

Both analysts were explicit, and agreed:

- **semantic deadlocks.** Arbitration decides *which* command wins; it cannot
  reason about *why* a command is impossible. `gather → mine → craft → bamboo`
  needs a planner, not a bus.
- **the 83-minute skill.** That is missing cooperative cancellation.
- **impossible paths.** Ownership reduces churn; it does not make a route exist.

## The second structural gap: there is no tactical layer

```
   500 ms   reflex        (emergency only)
   ???      <nothing>
   33 s     LLM planner
```

Shipped game AI ticks behavior trees at **10–60 Hz** while planners run rarely.
We have the planner and the emergency reflex and **nothing in between** — so
every question of the form *"am I still making progress? is this target still
valid? should I abort?"* has no owner, and falls to either a 33-second loop that
is far too slow or a 500ms reflex that only knows about death.

The reference implementation is **ROS2 Nav2**, which wraps navigation in
behavior trees with explicit recovery, replanning and controller behaviours —
i.e. navigation as an *executor with recovery*, not "set a goal and hope".

## GOAP is overkill; the minimal version is a backward-chaining resolver

The tech tree is a DAG. Full GOAP search is only warranted where there are
genuine costed alternatives (mine exposed stone vs dig down vs find a cave).
The minimal fix is typed preconditions and effects per skill:

```ts
Action {
  name: "craft_stone_pickaxe",
  requires: ["has:stick>=2", "has:cobblestone>=3", "has:crafting_table"],
  produces: ["has:stone_pickaxe"],
  consumes:  ["stick:2", "cobblestone:3"],
}
```

with one rule that would have prevented the deadlock outright:

> **No skill may return "need X" unless the executor can ask the resolver for
> an executable subplan for X.**

Our `pendingPrereq` publishes a want with no plan behind it. That is the defect.

## The LLM is being used for the wrong job

StarCraft solved "reach tier N from the current state" two decades ago —
UAlbertaBot/BOSS, and COEP for continual online build-order *adaptation*. A
deterministic planner should own tech progression, recipe expansion, tool tiers,
ordering, and retry budgets.

The LLM should do what a symbolic planner cannot: interpret unexpected
observations, classify failure traces, propose exploration when the planner has
no route, and turn run data into hypotheses. It should not be deciding to
`gather bamboo` when the recipe graph says that is irrelevant.

## Pathfinding: keep what we have

Recast/Detour is the industry navmesh standard — and it is **the wrong tool for
a world the agent can dig, place, pillar, flood and stream in chunks**. Building
a Minecraft navmesh is a research project, not a next move.

HPA* is applicable, but only as a **macro layer**: a chunk/region graph with
cached exit costs, invalidated on block change, refined locally by the existing
pathfinder. Do that *after* ownership, not instead of it.

## Reading list, with what each solves that we do badly

| Source | Solves |
|---|---|
| [ROS2 Nav2 behavior trees](https://docs.nav2.org/behavior_trees/index.html) | navigation as an executor with recovery behaviours |
| [BehaviorTree.CPP](https://github.com/behaviortree/behaviortree.cpp) / [py_trees](https://github.com/splintered-reality/py_trees) | async actions, running/success/failure, cancellation, decorators |
| [UAlbertaBot / BOSS](https://github.com/w4tsn/BOSS) | deterministic tech progression under prerequisites |
| [recastnavigation](https://github.com/recastnavigation/recastnavigation) | path corridors, local replanning, dynamic obstacles — study, don't port |
| [A Survey of Behavior Trees in Robotics and AI](https://arxiv.org/pdf/2005.05842) | the formal semantics we are missing |
| Brooks 1986, subsumption | inhibition/suppression, the arbitration we lack |

## Where the analysts differed

`qwen2.5:32b` (on the 3090, 2 tok/s — a 19GB model in 24GB spills) **inverted
the priority direction**, proposing that the cognitive loop suppress the reflex
"if reaching a safe area is more important than immediate survival". That is
backwards for a safety layer and would have been shipped by anyone who took the
cheapest available answer.

ChatGPT and `gpt-oss:120b` agreed on every structural point above.

## Ranked

1. **Locomotion arbiter** — one owner of the body, leases, inhibition. Directly
   targets the 19.3%.
2. **A 5–10 Hz tactical layer** between reflex and planner.
3. **Backward-chaining prerequisite resolver**; no unplanned `need X`.
4. **Move tech progression out of the LLM** into a deterministic planner.
5. HPA* macro layer — only after 1.
