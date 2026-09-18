# The 102/bot-h WATCH is the actuator gate meeting the live reflex layer, not the owner's rungs (evening session, 18 Sep 14:45 UTC)

Handed to the operator of record; read-only analysis, nothing changed. `owner-01b` breached my own registered line
`refused_actuator_per_bh_canary <= 30` at **102.4**. I set that threshold from a sandbox fixture where no skill ever
ran; this is the first time `ARBITER=1` has met eighty bots' worth of live reflex and skill traffic, so the number is
a measurement, not yet a harm.

## Who is being refused (1,890 refusals, 90 min, 10 bots, since 13:04:27Z)

| holder while refused | n |  | refused call | n |
|---|---|---|---|---|
| gather | 938 | | setControlState | 1,345 |
| goto | 302 | | clearControlStates | 162 |
| explore | 295 | | look | 120 |
| deposit | 149 | | setGoal | 78 |
| **owner:entombed** | **139** | | placeBlock / goto | 95 |

**The owner holds the body for 7% of them.** The rest are the gate arbitrating between a SKILL that holds the body
and callers that are contextless by construction.

## The five call sites, and which need a decision

| site | n | reading |
|---|---|---|
| `EventEmitter.monitorMovement` (pathfinder) | 520 | the pathfinder's movement loop still firing after its goal was taken; "tick bound to nobody" — correct to refuse, and the arbiter's own stop already clears the goal |
| `reflex.mjs:1786` + `:1804` (the water hold) | 623 | the **unowned** float/surface hold, which has no grant to run inside; silently dropped today |
| `unstick` | 235 | an unrouted rescue path: while anything holds the body, unstick is now inert on canary bots |
| `digStraightUp`, `pillarOut` | 159 | rung bodies called after their grant ended (stale continuations) — correct refusals |
| `runner.mjs:264` stop, `Timeout._onTimeout`, `signal.addEventListener` | ~78 | timers and listeners that lost the async context |

Samples show the shape plainly: `setControlState from explore while owner:entombed holds the body (tick bound to
nobody)`. The owner preempted a skill at escape priority; the skill keeps calling for a while and is dropped. That is
Codex's pass-2 finding 2 in the wild — a refusal neither cancels the caller nor tells it anything.

## What I would put to the operator

1. **`unstick` should take a grant** (it is a rescue, and inert-while-held is a regression the sandbox could not show).
2. **The unowned water hold should stand down explicitly or hold a grant**, not be dropped silently.
3. **A preempted skill should stop sooner** — the interrupt fires through `onCancel`, but explore keeps issuing calls
   after it.
4. **Re-baseline my line.** 30/bot-h came from a fixture with no skills. A live floor looks like 60-120/bot-h before
   any of the above; the WATCH should be re-registered against the measured distribution, or split by holder so the
   owner's own refusals (7%) are the part that gates.

Harm check so far: one canary death (13:27:38 board-b-Alpha, "drowned; idle" — the fleet's standing channel), and the
v15c movement guards did not breach at +90.
