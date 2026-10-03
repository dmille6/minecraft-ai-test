# Evening report — Saturday 2026-10-03 (11 am to 6 pm your time)

## The headline
- **The ore tunnel PASSED and is now on all 80 bots** (5:48 pm your time).
  - Test bots collected iron at about **10x their own earlier rate** (0.004 -> 0.038 iron per bot-hour). The unchanged
    bots stayed flat (0.014 -> 0.016).
  - Zero deaths caused by tunnelling; test bots died less often than the rest (0.019 vs 0.035 per bot-hour).
  - Every safety check was within limits.
- **Craftsync (the lost-crafts fix) went live on 10 test bots at 5:53 pm.** Its first check is at about 8:53 pm.
- **Queue reordered to attack full bags first (your call tonight):**
  craftsync -> craftroom -> composter -> spent-tool cleanup -> (bank slot: decision needed, below) -> logpickup -> rest.

## Scoreboard (same script both windows; 80 bots, 10 hours each)
| | 5:00–15:00Z | 12:57–22:57Z (now) |
|---|---|---|
| Iron-trip pickaxe (stone+, 40+ uses) | 27 | 24 |
| No usable pickaxe | 44 | 47 |
| No pickaxe at all | 21 | 23 |
| Wood gathers that succeed | 37.6% | 40.3% |
| Bags at 34+ of 36 slots | 58 | 61 |
| Raw iron gained, whole fleet | 17 | **6** |

**Honest concern:** fleet-wide raw iron fell all day (33 -> 17 -> 6 per 10 h) with no fleet-wide change. The ore tunnel
reached only 10 test bots until 5:48 pm, so this is the rest of the fleet. Pickaxes and bags are flat-to-worse, which is
the chain we're fixing. With all 80 bots now on the ore tunnel, tomorrow's number is the first real test.

## Why bags stay full (new, measured tonight)
59 bots are at 34+ of 36 slots. Their slots hold:

| What | Share |
|---|---|
| Miscellaneous items: bamboo, apples, eggs, chests, ladders, torches, furnaces, glass | 40% |
| Tools | 22% (half worn out) |
| Compostable junk | 14% |
| Stone | 10% |
| Saplings | 7% |
| Wood | 5% |

The mayor's new daily census agrees: **a full bag is the top reason a bot can't go get wood or iron.**

## What got done today
- **Craftroom** ("never craft into a full bag"): approved by both engines.
  - On a real server the current code threw the pickaxe on the ground in **21 of 21** full-bag trials; craftroom never
    did, except the one known mid-click case.
- **Composter:** approved by both engines; **9 of 9** on the real server.
  - The first sandbox run caught 3 bugs before any bot saw them (bone meal left behind, the stuck watchdog cutting
    visits short, the table spot); all fixed.
  - One fix was redone because it would have slowed every bot's path-planning by about 8%.
- **Both are being rebuilt without logpickup**, which moved later because it fills bags.
- **Spent-tool cleanup:** being built now.
  - Root cause found with data: bots keep worn axes and shovels "in reserve" forever and never use them.
  - Fix: use them up in normal work. Both engines agreed on that part.
- **Shadow mayor:** fixed a blind spot (it almost never saw wood shortages; it now does, per bot).
  - Deployed 1:02 pm. Frozen until its 10-06 decision.
  - Its pass rule was corrected and written down **before** looking at any results.
- **Daily blocker census** added to the scoreboard (your request).
- **A safety check that never ran** (blocks code using undefined names) now runs with every test pass. It caught a
  crash bug before deploy.

## What didn't work / honest problems
- The morning scoreboard numbers were wrong (corrected in the afternoon report).
- **The bank fix, as built in September, frees almost nothing today.** The town chests are full, and it never banks
  the 40% miscellaneous items. See the decision below.
- Several fixes took 3–5 review rounds. Each round found real bugs, but it's slow.
- **Found, not yet fixed:** the 20-second "stuck" watchdog would cut off long iron smelting (8 iron is about 80 s).
  - It hasn't happened yet: smelts are small and iron is scarce.
  - It will matter as iron flows. Queued as a candidate.

## Decision for you (asked earlier tonight)
Replace the bank-fix slot with two smaller fixes that clear more of today's bag, each its own test:
1. **Use the chests bots are carrying.** About 50 sit in full bags. When town chests are full, place one at town and
   deposit into it.
2. **Turn bamboo into sticks** (pickaxe material). Possible now that craftsync fixes unreliable crafting clicks.

## Next (automatic unless you change it)
- **~8:53 pm:** craftsync first check. **~11:53 pm:** craftsync can be kept.
- **Then:** craftroom, composter and tool cleanup, one at a time, about 6 hours each if they pass first time.
