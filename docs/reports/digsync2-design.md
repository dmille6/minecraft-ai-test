# digsync-v2: a grace after the ack

Branch `digsync2-on-8453c09` = fleet-candidate `8453c09` + digsync re-applied (reverts of 8453c09, a008101, 38f65ec)
+ this change. Code: `bots/src/digsync.mjs`, caller `collectManually` in `bots/src/skills.mjs`, totals row in
`bots/src/index.mjs`, tests `bots/test/digsync.test.mjs`.

## The measured defect

fixes-02 canary, 10 bots, 3 h, Paper 1.21.x. Out of **138 restores**, **92 (67%)** were contradicted by the server
sending AIR (`block_change` / `multi_block_change`) within 2 s of the restore (`falseRestore`). One bot: predicted 245,
confirmed 233 (server word before the ack), 12 settled with no word, 12 restored, 11 of those false.

Reading: on this server the `acknowledge_player_digging` for a STOP often arrives before the block update. The likely
mechanism is a delayed destroy (STOP arrives with server-side progress < 1 and the block breaks a few ticks later); that
mechanism is inferred from the timing, not verified in Paper's source. Whatever the cause, v1 restored stone where the
server had air for up to ~2 s (the tail past 2 s was not measured), and climbs (entombment-detection rows) ran 2.3-5x
faster in the 2 minutes after a rollback.

## The change

1. **Grace.** An ack that settles a prediction with no server word yet no longer restores. The prediction moves to
   phase `grace` for `GRACE_MS = 3000` after the ack. Any server word for that position during the grace (any state,
   AIR included) settles it on that word at once. Silence until expiry restores `prior`, as v1 did at the ack.
   A prediction that already has a server word at ack time settles at the ack, unchanged.
2. **Explicit phases.** `awaiting-ack` is governed by the backstop (`BACKSTOP_MS = 5000` from the prediction);
   `grace` is governed only by the grace timer (from the ack). The backstop never pre-empts a grace.
3. **Cancellation.** A newer prediction at the same position replaces a grace and keeps the OLDER prior. A
   `map_chunk` / `unload_chunk` for the column drops it. Spawn, death and disconnect (`end`) clear the ledger. Each of
   these now tells any waiter `{ broken: null, pending: false }` at once (v1 did this for spawn and death only).
4. **A server word is not a rollback.** A settlement on the server's word (before the ack or during the grace) may
   write that state into the world model (mineflayer writes it too, so this is idempotent), but it does not count as
   `rolledBack` and does not produce a `dig_rollback` row. `rolledBack` now means exactly "digsync restored the prior
   on its own authority": grace expiry or backstop.
5. **waitSettled contract.** Resolves as soon as the outcome is KNOWN: at the ack when the server already spoke (the
   common confirmed case, no added wait), the moment the server speaks during a grace, or at grace expiry. Default
   timeout = `graceMs + tickMs + ACK_WAIT_MS` (4500 ms in production), so a refused dig gets a truthful
   `broken: false` instead of `pending`. Takes an optional abort `signal`. `collectManually` now calls it with the
   default timeout and the skill's signal, then `check(signal)`. Its v1 extra 600 ms sleep after `broken: false` is
   removed: that was the delayed-destroy allowance, which the grace now owns. A refused dig costs ~ack + 3.0-3.5 s
   in `collectManually` (v1: ack + 0.6 s); a confirmed dig costs nothing extra; `pending: true` (no ack in 4.5 s, or
   aborted) behaves as before (falls through to the local read; abort throws).

## New counters (on the `dig_sync` heartbeat row and every `dig_rollback` row)

The totals line now prints every key in `counts`, in a fixed order, as `key=value` (v1's nine keys first, unchanged).

| counter | meaning |
|---|---|
| `graceStarted` | acks that found no server word and opened a grace |
| `graceAir` | the server said AIR during the grace (the v1 false restore, now avoided) |
| `graceOther` | the server said a non-air state during the grace (an explicit refusal) |
| `graceExpired` | grace ran out with no word: the prior was restored (also counted in `rolledBack`) |
| `graceDropped` | grace cancelled by a re-dig, chunk replace/unload, spawn, death or disconnect |
| `graceLt250` .. `graceLt3000`, `graceGe3000` | ack-to-word delay for `graceAir + graceOther` |
| `falseRestore` | a restore contradicted by AIR within `FALSE_RESTORE_MS` (now 10 s, was 2 s); excludes a position the bot re-dug after the restore |
| `lateAirLt2s`, `lateAirLt5s`, `lateAirLt10s` | the same, bucketed by delay after the restore |

Books: `graceStarted = graceAir + graceOther + graceExpired + graceDropped + (still pending)`.

## What the canary read should gate on (proposal)

Difference-in-differences against the control pools, per CLAUDE.md; fixes are a correctness gate:

- **Primary:** `falseRestore / rolledBack` falls from 0.67 to **< 0.15** on the canary. Note the 10 s window is wider
  than v1's 2 s, so this is a conservative comparison (v1's 0.67 would only be higher on a 10 s window).
- Report `graceAir / graceStarted` (expected high: it is the share v1 would have restored falsely) and the
  `graceLt*` histogram. If `graceGe3000` or `lateAirLt5s` / `lateAirLt10s` carry real mass, GRACE_MS is too short.
- Entombment-detection climbs within 2 min of a rollback: should fall toward the no-rollback rate.
- `repeatMax < 10`; `predictFailed == 0`.
- Liveness: every canary bot writes its `dig_sync` heartbeat (10 min) on the canary build.
- Tripwires: dig_unconfirmed and tunnel stalls must not rise. A refused dig now keeps its ghost air ~3 s longer than
  v1 before the restore.

## Not verified

- That Paper's delayed destroy is the mechanism (inferred from timing on the fleet; not read in Paper's source).
- Listener order on the live bot: the tests assume digsync's `block_change` listener runs before mineflayer's blocks
  plugin writes the state (digsync attaches right after `createBot`, plugins inject later). Either order converges,
  because a grace settlement on the server's word writes the same state mineflayer writes.
- `GRACE_MS = 3000` covers the measured 2 s window with margin; the tail past 2 s is what the new buckets measure.
