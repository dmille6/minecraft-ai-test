# Progress report — 2026-10-02 11:20Z (first report; window started 04:45Z)

## In one line
The pickaxe-saving bundle (fixes-03) passed and is being rolled out to all 80 bots now. The next two changes
(the reworked ghost-block fix, then the ore tunnel) are queued to start by themselves.

## What worked
- **fixes-03 KEPT (11:15Z), being promoted fleet-wide now.** 20 test bots vs 40 control bots, 6 hours:
  - Good pickaxes lost: **1** on test bots (120 bot-hours) vs **208** on control (240 bot-hours).
    That is the "full bag throws the held tool away" bug, fixed. It protects iron pickaxes too.
  - Bots no longer count a worn-out pickaxe as "has a pickaxe": 0 of 147 vs 283 of 651 in control.
  - Mining descents: test bots +21%, control -16%.
  - Deaths: 3 vs 8 (per hour, lower than control). Time trapped: +19% vs control, inside normal noise (the
    alarm is +100%).
- **Found why yesterday's version (fixes-02) was reverted:** the old ghost-block fix wrongly "undid" digs the
  server had actually completed (92 of 138 times), so bots saw walls that weren't there and got trapped more
  when digging. Removing it (fixes-03) made the trapping problem go away.
- **Rebuilt the ghost-block fix** to wait up to 3 s for the server before undoing a dig. Three review rounds by
  both ChatGPT and Claude found 12 real bugs; all fixed with tests; both now approve.
- **Rebuilt the ore tunnel** (dig a safe staircase to iron the bot can see) on top of it. All tests pass.
- **The queue now runs on the fleet server itself**, so it keeps moving even when this computer sleeps:
  ghost-block canary next (starts automatically after the rollout), then the ore tunnel if that one passes.

## What didn't work / problems
- **Iron itself has not moved yet**: 6 successful iron gathers in 120 test-bot-hours vs 0 in control. Too few to
  mean anything. The ore tunnel is the change aimed at iron, and it is 2 steps away.
- **Gathering was slightly lower** on the test bots than control (+5% vs +9%); within normal noise, but watched.
- **The control computer slept from ~07:00Z to 11:15Z**, so no check-ins or report happened in that gap. The fleet
  kept running and decided fixes-03 on its own. Nothing was lost, but the 09:00Z report was late.
- The sandbox test world has no lag, so it can't reproduce the ghost-block problem; only the live fleet can test it.

## Next steps (all automatic unless something fails)
1. ~11:40Z: rollout of fixes-03 finishes; ghost-block canary (digsync2-01) starts on its own. Verdict ~17:45Z.
2. If kept: ore-tunnel canary (oretunnel-02) starts on its own. First read ~21:00Z, verdict ~00:00Z.
3. Next report ~16:00Z.
