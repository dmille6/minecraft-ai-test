# Afternoon report — Saturday 2026-10-03 (about 7 am to 11 am your time)

## Scoreboard (all 80 bots, 10-hour windows, same script for both, so they compare fairly)
| | 1:00–11:00Z (this morning's window) | 5:00–15:00Z (now) |
|---|---|---|
| Bots with a pickaxe good enough for an iron trip (stone or better, 40+ uses left) | 18 | 28 |
| Bots with no usable pickaxe (none with more than 10 uses left) | 50 | 45 |
| Bots with no pickaxe at all | 23 | 20 |
| Wood gathers that succeed | 38.9% | 37.6% |
| Bots with a nearly full bag (34+ of 36 slots) | 63 | 59 |
| Raw iron gained | 33 | 17 |

**A correction:** this morning's report said 9 trip pickaxes, 56 bots with no pickaxe and 85 raw iron. I worked those
out by hand and can't reproduce them. Re-run over the same hours, the script gives 18, 50 and 33. From now on every
report uses one written script (`scripts/host/scoreboard.py`), so the numbers can be checked.

Nothing new has reached the fleet since this morning: the ore test still holds the test slot. So these changes are
day-to-day movement, not the effect of a fix.

## What worked
- **The ore tunnel is starting to pay.** At its 18-hour check the test bots had collected **8 iron** (3 at 12 hours).
  For the first time that is more per bot-hour than the unchanged bots (+0.031). It reached the ore 7 times, with no
  deaths caused by tunnelling. It decides at about **5:20 pm your time**.
- **The queue now runs itself, in the order you approved.**
  - When the ore test ends, **craftsync** (the lost-crafts fix) starts automatically. Then **logpickup** follows on its
    own.
  - I built ready-to-go versions for every possible outcome: 2 for craftsync, 4 for logpickup. So a revert overnight
    doesn't stop the line. Every version passes all tests.
- **A bug was caught before it shipped.** Moving logpickup onto the older fleet code left it using a timer that only
  the ore-tunnel code has. Every wood gather would have crashed. The tests caught it.
- **Fixed a safety check that never ran.** The project has a check that stops code from using names it never defined.
  It was supposed to run on every deploy, but no fleet deploy script ever ran it. It now runs as part of the tests.
- **Craftroom (the "never craft into a full bag" fix) is rebuilt on top of craftsync.** It went through 4 review
  rounds; ChatGPT now **agrees**, and Claude has one last small fix in progress.
  - The reviews found 7 real problems. The worst: a pickaxe could still be thrown out if the bag filled up during the
    second it takes the server to confirm the inventory.
  - All were fixed, and each fix has a test that fails without it.

## What didn't work / honest problems
- The morning scoreboard numbers were wrong (above).
- Craftroom took four review rounds rather than one, because combining two crafting fixes created new edge cases.
  That is the cost of testing them separately, as you asked, and it caught real bugs.
- One known limit remains in crafting: if an item is picked up in the split second after the craft clicks start, the
  result can still be lost. The code now detects and reports it, but can't prevent it.

## Next (automatic unless you change the order)
1. **~5:20 pm:** ore tunnel decision, then **craftsync starts on its own** (first check about 3 hours later).
2. Craftroom: Claude's last fix, a final check, then a sandbox run on a real Minecraft server before it is queued
   third.
3. Composter: rebuild it on the crafting fixes and redo its "build from logs" sandbox run.
4. Shadow mayor keeps running; its keep/stop decision is due 10-06.
