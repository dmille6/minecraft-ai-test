# "Navigation" is 6.8% of the navigation problem — 19 September 2026, 12:30 UTC

Read over 24 h to 19 Sep 12:25Z. Positive control: 753,271 rows, 80 bots, 33,511 gather calls, 25,469 failures.
Gather sits at **6,292/33,205 = 18.9%** against the ≥40% two-week gate.

**Queue item 3 says the failure is "navigation refusing to reach a block it can see". That premise is wrong, and it
is mine — both review engines adopted it from my memo, and the daily session carried it into STATE.** The number
that was quoted (`unreachable` + `no_path` = 15,385) is real. What it contains is not.

## What the 15,385 actually are

| sub-class | n | share | what it is |
|---|---:|---:|---|
| `unreachable`: **"buried — use mine to dig down"** | **8,036** | **52.2%** | the block exists, below rock. Not a pathing failure — a **remedy printed as advice** |
| `no_path`: **A\* reached a candidate** | **3,845** | **25.0%** | *the path worked.* The bot walked there and `collect` came back empty |
| `unreachable`: "could not stand within reach" | 2,397 | 15.6% | target selection: no standable cell adjacent to any candidate |
| `no_path`: **A\* reached none** | **1,049** | **6.8%** | **a genuine no-route. This is the whole of "navigation cannot find a way."** |

**A real pathfinding failure is 6.8% of the thing named after it.** An intervention aimed at the pathfinder would
address one event in fifteen.

## The two things that are actually happening

### 1. A remedy printed, and taken a third of the time (52%)
`gather` finds the block, sees it is buried, and refuses with *"use mine to dig down"*. Measured over 400 of those
refusals: **a `mine` call follows within 180 s in 137 = 34.2%.** So roughly **5,300 refusals in 24 h are advice the
model did not act on** — and each one is a gather marked failed.

This is the project's own recorded class: *"One refusal printed the correct remedy 262 times and the model never
acted on it. Advice printed is not advice taken; if it must happen, make it deterministic rather than advisory."*
The same note already observes that `craft` recurses but **no skill ever calls `gather`** — there is no
gather→mine edge either. The remedy is real, executable, and reachable; it is simply not wired.

### 2. Arrival without acquisition (25%)
Of the 3,845 where A* **did** reach a candidate, what `collect` then said:

```
1663  nothing -- it returned without gathering
1587  Digging aborted
 215  Digging aborted | arrived_out_of_reach
 480  arrived_out_of_reach (pathfinder resolve / timeout / pathfind)
```

**1,587 "Digging aborted"** is not navigation at all — something cancelled the dig after the walk succeeded. The
interrupt tax is the obvious suspect and is recorded but never recomputed: *"the air reflex could cancel any running
skill ungated; it aborted 9.8% of every run."* **That number is still not computed, and it is now blocking a queue
decision for the second time** — it was also the open question on whether drowning deserved a canary slot.

## What this changes

- **The navigation canary as scoped would target 6.8% of its own metric.** Do not deploy it as conceived.
- **The first intervention is a gather→mine edge**, making the buried remedy deterministic instead of advisory. It
  addresses 52% of the failures, it is a wiring change rather than a new mechanism, and the remedy it invokes already
  exists and already works when called.
- **The second is the dig-abort question**, and it is a one-hour read with no canary slot: what cancels 1,587 digs?
  Until that is known, "Digging aborted" is 10% of all gather failures with no owner.
- **`no_safe_target` (8,175, excluded from the 15,385 above) is a third thing again** — "candidates are beside water
  or under falling blocks". A safety refusal, correctly classified out of the reachability count by the daily
  session, and untouched here.

## Method note, because this is the third time in three days

The premise survived my own memo, an independent Claude review, an independent ChatGPT review, and a STATE queue
entry — **because all four read the same fail-class labels and none read the detail strings underneath them.**
`unreachable` and `no_path` are honest names for the buckets and misleading names for their contents. The label was
the instrument, and the instrument was not checked against the thing it named.
