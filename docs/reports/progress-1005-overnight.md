# Overnight report — Sunday night into Monday 2026-10-05 (7 pm to 6:30 am your time)

## The headline
- **Best 10 hours yet.** Same 80 bots, same scoreboard script (fixed overnight to sort by time):

| | 10-03 19:18–10-04 05:18Z | 10-04 14:25Z–10-05 00:25Z | **10-05 01:31–11:31Z** |
|---|---|---|---|
| Bags nearly full (34+ of 36) | 57 | 46 | **38** |
| No usable pickaxe | 44 | 27 | **13** |
| No pickaxe at all | 21 | 14 | **5** |
| Pickaxe good for an iron trip | 20 | 32 | **40** |
| Raw iron mined | 17 | 63 | **160** |
| Wood gathers that succeed | 38.7% | 47.0% | **59.0%** |

These are fleet-wide before/after numbers, so they show the trend, not what any single fix did. The
per-fix canaries are the proof: craftroom (0 of 19 pickaxe crafts lost vs 43% on control), composter
(−2.2 junk slots/bot), spent-tool cleanup (−2.15 spent tools/bot), plus the one-time chest clear.

## What happened overnight
- **Spent-tool cleanup KEPT** (00:05Z) and on all 80 bots since 00:14Z.
- **Chest-full test REVERTED** at 03:17Z by the death check: 3 test-bot deaths in 25 min vs 0 on the
  rest. Investigated: no link to the code (no chest activity before any death; the "mining jump" was four
  bots that had just started their iron goal). The revert stands. The re-run carries real fixes the test
  server found: a bot sealed in a pocket was told it had reached the chest and wrongly closed the bank;
  a chest deep underground was used as a bank. Approved by ChatGPT.
- **Junk well LIVE** on 10 bots since 10:05Z (both engines approved after many rounds; first check ~13:05Z,
  decision ~16:05Z).
- **Grid fix ready** (both engines approve; on the test server the current code stranded crafting
  items 12 of 12 times, the fix 0 of 11). It goes next.
- **Withdraw**: code finished after eight review rounds; waits for the chest-full re-run (it is built on it).
- **Bamboo**: ready; waits for the grid fix (an interrupted fold strands bamboo without it).
- **A measurement bug of mine fixed**: the scoreboard's pickaxe numbers depended on file order across
  the midnight log rotation; yesterday's overnight "pickaxe improvement" was that bug (corrected in that report).

## What the bots are blocked on now (the overseer's tally)
- "Free up bag space" is still first (397 unmet need-checks/hour, down from 554), but the reason has
  changed: "no way to dispose of junk" fell from 229 to 49; "trapped" (stuck underground/walled in) is now
  218. Getting unstuck is becoming the next big lever.
- "Restore a pickaxe" fell from 319 to 144.

## Next (one test at a time, each starts on its own)
junk well (live) -> grid fix -> chest-full re-run -> withdraw -> bamboo -> cobble rule.
Nothing needs you right now.
