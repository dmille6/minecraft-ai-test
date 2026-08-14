# 4 · Bounded everything

## The brief

Our worst outage came from code that looked responsible. It had a timeout! But
the timeout only stopped *waiting* for the stuck operation — it didn't stop
the operation. The stuck thing kept running underneath, invisible, and every
retry stacked another one on top. After a few hours, one bot was carrying
180,000 abandoned operations and the process died of exhaustion.

Hence the lab proverb: **a timeout that doesn't cancel is a leak with a
friendly name.** Giving up on waiting is not the same as making it stop.

The rule: every operation that touches the world gets a time budget, and when
the budget expires, the operation is actually *terminated* — the digging
stops, the navigation goal is cleared, the claim is released. Cleanup is
specific to what was started; there is no generic "oh well" handler.

## The deep end

### The scar

The gatherer OOM hunt. The collectblock library's `waitForPickup` waited
forever on an entity that could vanish; its `cancelTask()` *waited for
completion* instead of cancelling; and `collect()` called `cancelTask()`
first, so every new attempt piled onto the stuck one. Wrapping it in
`Promise.race` timeouts made the symptom worse — race abandonment leaks the
loser. Fatal heap dumps showed 180,061 pending `__awaiter` frames on one bot:
"Ineffective mark-compacts near heap limit." The real fix removed the library
from the path entirely and put bounded, cleanup-bearing wrappers
(`withTimeout` with per-API `onTimeout`: `stopDigging`, `setGoal(null)` before
`stop()`) around everything that remained. Verified: 0 OOM kills with full
exposure afterward.

### The rule

Every world-touching call runs under a budget wrapper that, on expiry:
1. terminates the underlying operation via its API's actual cancel mechanism,
2. releases owned controls (pattern 3),
3. returns a typed failure (`*_budget` failClass) so the gate (pattern 1) and
   the teacher (pattern 6) see an honest, specific outcome.
Abandonment (`Promise.race` and kin) is prohibited: losing a race must still
trigger cleanup.

### Why it's true

In async runtimes, an awaited operation holds its entire retained closure
graph until it settles. Abandonment breaks the *observation* of the promise,
not the promise. Under retry pressure this is unbounded growth by
construction — the leak rate is the failure rate, so it surfaces exactly when
things go wrong, which is when you can least afford it.

### How it shows up per game

- **Minecraft** (built): `withTimeout` in `bots/src/skills.mjs`; `digBounded`
  in reflexes; collectblock exiled behind an opt-in flag.
- **TrackMania**: training-side, not game-side — a run that stops improving
  needs termination criteria (the coach's job), and any harness call into
  TMInterface needs a budget with a real reset, or a hung game instance
  quietly eats a GPU for a night.
- **BAR**: the socket bridge (harness ↔ widget) is the risk surface: an LLM
  call that never returns must not leave a tier holding its decision slot.
  Every intent gets a shelf life; execution of a stale intent is cancelled
  via real order revocation (engine `STOP` orders), not abandonment.

### The prediction

The first resource-exhaustion incident in any new harness will trace to a
wait someone believed was bounded because a timeout *number* appeared near
it. Audit question for every wrapper: "when this fires, what physically
stops?" If the answer is "nothing," it's the leak.

### The record

- **2026-08 · Minecraft**: held, at the cost of a multi-day hunt. The
  amplifier (cancel-that-waits called on every retry) is the detail worth
  remembering: bad cancellation is worse than none.
- *TrackMania: prediction pending.*
- *BAR: prediction pending.*
