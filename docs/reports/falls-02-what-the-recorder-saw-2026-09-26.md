# falls-02 KEPT, and the fall class finally has a shape: a quarter of damaging falls are overshoots while a path is actively steering (26 Sep 04:00 UTC)

The fall-path recorder was reverted on 18 Sep on two deaths that were neither falls (a sealed-pocket drowning and a
marooned bot beside lava, both idle). It was restored as `falls-02` (37a68c3) and **KEPT at +180**, deaths 1 canary vs
2 control at identical rates. `promotion: none`, so it was recorded and torn down rather than promoted -- correct
inside the 24-27 Sep program window. **This read is therefore the artifact: the instrument is not live on the fleet.**

## Exposure and linkage

106 `fall_path` rows on the canary (all `damage`, 0 `death`) against a floor of 8; control emitted **0**. Every row
carries a planned path: `no planned path on record: 0/106`.

## What it saw, over 60 canary bot-h

| observation | value | reading |
|---|---|---|
| path state at descent onset | **ACTIVE 76**, unknown 24, none 6 | falls happen while the pathfinder is steering, not during unowned drift |
| planned max drop | median 4, p90 5 | the planner stays inside its own bound (`mdd=6`) |
| path had a drop beyond policy | **5/106** | planning is not the violation |
| landed onto liquid | **5/106** | the liquid-dropdown hypothesis stays dead, now on 106 rows |
| actual fall > planned + 2 | **28/106 (26%)** | the missed-landing class, and it is real |
| actual fall <= 6 blocks | 98/106 | most damaging falls are small and frequent |

The overshoots include rows with **no planned drop at all** where the bot fell 15 and 22 blocks. Sampled rows are
consistent: `fell 10, hp -2; descent 2s ago: path ACTIVE; path 2s old, still active ... max 5, 0>6, water 0, lava 0`.
A path that permits 5 was active, and the bot fell 10.

## The finding

**The planner is obeying its bound and the bot is landing harder than planned anyway, while a path is actively
steering it.** Only 5 of 106 rows had a planned drop beyond policy, but 28 exceeded the plan by more than two blocks.
That points at execution rather than planning: the bot is leaving the planned line mid-descent. It is the same shape
as the open question from `blindstep-01` -- a verified line is not a verified trajectory -- and here there is data for
it rather than a hypothesis.

The second half of the picture is unglamorous and probably larger in aggregate: 98 of 106 damaging falls are six
blocks or less, i.e. **the planner's permitted drop routinely costs health**. `mdd=6` is priced as free and is not.

## Two small things

1. **A label to fix.** The row prints `damage-implied fall vs planned drop: [(p, a), ...]` but the tuples are
   `(planned, actual)` and the filter is `a > p + 2`. The computation is right; the wording is the reverse of the
   print order. I read it as a defect and had to check `fallread.py:69` to clear it. Anyone reading the txt without
   the source will reach the wrong conclusion about every pair.
2. **The recorder is not live.** `promotion: none` was right for the program window, but the observability this read
   demonstrates disappears with the teardown. It should be promoted once the window closes on 27 Sep, otherwise the
   next fall question starts from nothing again -- which is exactly where 18 Sep started.
