# Recorded air-supply packet trace, 2026-08-24

4,645 `entity_metadata` packets from eight live bots — five stuck in water, three
healthy controls — captured by `bots/src/air-trace.mjs` (`AIR_TRACE_MIN=30`).

Kept deliberately after the fix built on them was reverted. The recording is the
expensive part and it is not cheap to retake: it needs a deploy, thirty minutes
of fleet time, and bots that happen to be drowning.

## What it establishes

- Our own entity carries the air supply at **metadata key 1**, in ticks:
  range **-19 .. 300** across the whole trace, never above, counting down
  monotonically under water (985 of 1125 steps falling on `board-a-Comet`).
- **Zero** foreign-entity packets moved `bot.oxygenLevel`. The "nearby fish are
  overwriting our oxygen" hypothesis — which four shipped fixes were built on —
  is dead, and this trace is what killed it.

## What it does NOT establish

That `bot.oxygenLevel` is broken. The trace shows it changing on 0 of 4,058
key-1 packets, and I read that as "mineflayer never tracks air". It is at least
partly an artifact of rounding: `round(air/15)` only moves once per 15 ticks,
so most consecutive packets *should* leave it unchanged. Check that before
building on this again.

## Rows

`{own, after, meta}` where `meta` is the numeric metadata by key. Key 1 is air,
key 9 is health (0..20), key 0 is the shared-flags byte (8 = swimming).
