# The dig-abort read: two diggers, one bot — 19 September 2026, 13:55 UTC

Queue item, one hour, no canary slot. It was blocking two decisions: whether drowning deserves a slot (its
remaining case rested on an "interrupt tax" nobody had recomputed) and what the second navigation target should
be. **Both are now answered, and one of them is answered in the negative.**

24 h to 19 Sep 13:50Z. Positive control: 751,848 rows, 80 bots, 33,612 gather runs.

## The number

**1,928 gather runs end with `Digging aborted` = 5.7% of all gather runs.** 1,892 of them are classed
`failed/no_path`, which is how they reach the "navigation" bucket that queue item 3 was named after. Every one
reads *"[probe: success, slate N, A\* reached a candidate] [collect said: Digging aborted]"* — **the walk
succeeded and the dig did not.**

## It is NOT the interrupt tax. The control says so.

The standing hypothesis, from a memory entry never recomputed, was that reflexes cancel digs: *"the air reflex
could cancel any running skill ungated; it aborted 9.8% of every run."* Reflex-family rows in the 15 s before:

| | reflex row present |
|---|---|
| aborted digs (n=1,925) | **3.8%** |
| successful gathers (n=1,925, same window, sampled) | **3.7%** |

**No association.** 96% of aborted digs have no reflex activity at all nearby. The single most common
"interrupter" was `_marooned_needs_pickaxe` at 19 events — 1.0%.

**Consequence for the queue: drowning's last remaining argument is gone.** Its case was already reduced to
(a) it corrupts canary reads, which v23 closed, and (b) an unmeasured interrupt tax. (b) is now measured and it
is not there. Drowning remains 58% of deaths, but deaths already clear both program gates, so nothing in the
program moves by fixing it. It should drop below navigation and stay there.

## It is NOT a timeout either

A fixed timeout would spike the duration histogram. It does not:

```
p10 3.1s   p25 3.3s   MEDIAN 4.5s   p75 8.3s   p90 17.0s   p99 45.7s   max 140.3s
```

Smooth, no cluster at any budget value. (All gather runs: median 717 ms, p90 30.4 s.)

## What it is — VERIFIED by reading mineflayer

`Digging aborted` has exactly one source: `bot.stopDigging()`, at
`bots/node_modules/mineflayer/lib/plugins/digging.js:189`. And at the top of `dig()` itself, line **127**:

```js
if (bot.targetDigBlock) bot.stopDigging()
```

**A new dig request cancels the dig already in flight, and the first one's promise rejects with
`Digging aborted`.** The variable guarding the cancellation face is even named
`stoppedBecauseOfNewDigRequest`. So these 1,928 runs are **two concurrent diggers on one bot**, and the loser
is the one that was already working.

## Which second digger — INFERRED, not verified

The second digger emits no telemetry row of its own. Ranking every row in the 15 s before an abort against the
same window before a success found nothing that discriminates: the best was `_prereq_satisfied` at 5.8% vs 1.5%,
on small numbers. An unlogged digger is exactly what `mineflayer-pathfinder` is — it equips and breaks
obstructing blocks internally (`index.js:483-492`) with no `logEvent`.

The block mix supports it: **cobblestone 1,209, stone 385, coal_ore 110** — stone-family, what a pathfinder
tunnels through, not what a bot is usually asked to gather.

**This is an actuator-ownership defect, and it is the one the movement owner exists to fix.** owner-01's gate
attributes the pathfinder *tick* per grant — but it gates `setControlState`, not `dig`. Two diggers is the same
class of bug one layer down, and it is currently invisible: nothing logs the collision, and the only evidence is
a mineflayer error string arriving in a gather detail.

## What to do

1. **Gate `dig` in the arbiter the way `setControlState` is gated.** It makes the collision refusable and, more
   importantly, *observable* — right now a 5.7% failure mode is inferred from an upstream library's wording.
2. **Log it before fixing it.** A single row at the cancel point, naming both the incumbent and the requester,
   converts this whole document from inference to measurement and costs nothing behavioural.
3. Do **not** fix it by retrying the dig. The loser is cancelled because the winner wants the body; retrying
   without ownership makes two diggers into three.

## Honest limits

The 5.7% is gather runs that *report* the string; a dig cancelled and then succeeding on retry inside the same
run would not appear. Whether closing this converts to acquired items is unmeasured — the same trap as the
`leaf-01` endpoint, and it should be registered the same way, on items and not on the absence of the error.
