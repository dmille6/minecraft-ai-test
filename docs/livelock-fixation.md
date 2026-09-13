# Livelock breaker: physical fixation required — v2 (pass 1 folded in)

Pass 1 found two defects: window coverage unspecified (startup or sparse samples could read as fixation), and
"moved"/"gained" undefined as aggregates (net values hide round trips and consumption). v2 defines both.

## The rule (pure function `livelockFixated(samples, { now, windowMs = 180_000, minSamples = 4, minMove = 8 })`)
`samples` is the runner's per-decision record: `{ t, x, y, z, items }` where `items` is the inventory total.
Only samples with `now - windowMs <= t <= now` are used.

1. COVERAGE: fixation can be declared only when the window holds >= minSamples samples AND the span from the oldest
   used sample to the newest is >= windowMs - 30 s. Otherwise the answer is `insufficient` and the breaker does NOT
   fire (a fresh spawn, a reconnect, or a long skill with no decisions never reads as fixation).
2. MOVED = the maximum horizontal distance from the OLDEST sample in the window to ANY later sample (path extent,
   not net). A round trip to a chest 40 blocks away and back reads as moved 40, never 0.
3. GAINED = the sum of POSITIVE inventory-total deltas between consecutive samples. Consumption (crafting planks
   into a table, eating, placing scaffolding) never masks a gain; a bot that gathered 8 then placed 8 reads +8.
4. FIXATED = coverage ok AND (repeatLoop OR rejections >= 3) AND moved < minMove AND gained == 0.

The breaker fires only on FIXATED. Latching, the dig rung and recovery_exhausted are unchanged.

## Tests (pure, with a mutant each)
- coverage: 3 samples over 170 s with rejections -> insufficient, no fire (mutant: coverage check removed -> fires).
- round trip: samples 0 -> 40 blocks -> 0 with rejections -> moved 40, no fire (mutant: net displacement -> fires).
- consumption: items 20 -> 28 -> 20 (gathered then placed) with rejections -> gained 8, no fire (mutant: net -> fires).
- stuck and arguing: 6 samples, moved 2, gained 0, rejections 3 -> fires (positive control).
- stuck and silent: moved 0, gained 0, rejections 1 -> no fire (the stagnation watchdog's case).

## Where the samples come from
The runner already snapshots position and inventory at every decision (`snapshot(bot)` in every log row); the same
values are pushed to a ring buffer of the last 5 minutes at decision time. No new actuation, no new timers.

## Question for the reviewer (second and final pass)
Is v2 acceptable? Name at most three defects with a one-line remedy each.

## v3 — the final pass's three defects, folded in (built as `livelockFixated` in cognitive.mjs, 2026-09-13)
1. Coverage also requires a maximum inter-sample gap (90 s) and starts at the last (re)connect: a new Cognitive
   instance is a new connection, so `startedAt` bounds the window and earlier samples never count.
2. `rejections` and `repeatLoop` are explicit inputs: the caller's consecutive-rejection count and the current
   rejection's reason, scoped to the decision that asks.
3. Every test uses six samples over 175 s (35 s apart) so coverage passes and the metric under test is what decides;
   the coverage test carries its own positive control.
Review closed at two passes. Not yet canaried: it goes as its own change (recovery-ladder-05) after the ladder (-04).
