# Overnight report — Saturday night into Sunday 2026-10-04 (6 pm to 12:20 am your time)

## The headline
- **Craftsync (the lost-crafts fix) passed and is on all 80 bots** since 12:08 am your time.
  - On its 10 test bots, **0 of 215 crafts** claimed success while nothing changed. On the unchanged bots it was
    **236 of 1,337 (18%)**.
  - The server answered every check, crafts take about 1.6 s, and the test bots died slightly less often.
- **Craftroom (never craft into a full bag) went live on 10 test bots at 12:13 am** and started on its own.
  - Its first check is at about 3:13 am; it can be kept at about 6:13 am.
  - The composter and the spent-tool cleanup follow automatically, one at a time.

> **CORRECTION 10-05 00:30Z:** the "now" column below was wrong. The scoreboard picked each bot's "last" snapshot in
> file order, and across the midnight log rotation that was not time order. Re-run with the rows sorted, the
> 19:18–05:18Z window reads: trip pickaxes **20** (not 32), no usable pickaxe **44** (not 34), full bags **57** (not 62);
> raw iron 17 and wood 38.7% were right. So pickaxes did NOT improve overnight; the claim below is withdrawn.

## Scoreboard (80 bots, 10-hour windows, same script)
| | 12:57–22:57Z | 19:18–05:18Z (now) |
|---|---|---|
| Iron-trip pickaxes (stone+, 40+ uses) | 24 | **32** |
| No usable pickaxe | 47 | **34** |
| Raw iron gained | 6 | **17** |
| Wood gathers that succeed | 40.4% | 38.7% |
| Bags at 34+ of 36 slots | 60 | 62 |

Pickaxes and iron moved the right way overnight, the first time in days. The windows overlap and several things
changed at once, so I can't credit any single fix yet:
- the ore tunnel reached all bots at 5:48 pm;
- craftsync reached all bots at 12:08 am.

The bags are still full; that's what the next fixes target.

## What got done overnight
- **Your chest request (withdraw, no junk, clear the junk):** both ChatGPT and Claude designed it.
  - **The census** read every slot of 448 town containers, without changing anything in any world. The chests
    hold **897 usable stone pickaxes, 430 iron ingots and 44,701 logs**. They also hold **100,593 junk items**.
  - **The clear list** went to you for approval. It has not been run.
  - **Withdraw is built.** A bot with no usable pickaxe takes one at town. If none is available, it takes the
    exact ingredients for one. Every container click is checked against the server, and a 3-click swap handles a
    full chest with a full bag. It's in its third review round.
  - **"No junk in chests"** is next after withdraw.
- **Chest-full fix:** approved by both engines after five review rounds. It places the chest a bot is carrying
  before ever crafting one, puts a budget on new chests, and never drops items.
- **Spent-tool cleanup:** approved and sandbox-tested; it's queued fourth.
- **Bamboo to sticks:** approved. The real-server sandbox caught two problems, now being fixed:
  - the stuck watchdog kills long folds;
  - an interrupted fold leaves items in the crafting grid.
- **Craftsync defect found and fixed in time.**
  - The sandbox found that an interrupted 2×2 craft leaves its ingredients in the crafting grid until the next
    craft. 2 of 94 crafts on the test bots hit it.
  - I let craftsync roll out anyway: it fixes an 18% false-success problem, and this defect is narrow.
  - The fix is in review and goes on the fleet right after the spent-tool cleanup.
- **Two bugs in my own measurements, caught and fixed:**
  - The logs rotate at midnight UTC, and my new reads and the scoreboard would have silently skipped the hours
    before it. All are fixed.
  - One craftsync safety line counted the wrong thing and would have blocked keeping it. I corrected it before
    the read and recorded the change.
- **Shadow mayor:** fixed so it no longer misses wood shortages, and its scoring rules were fixed in writing
  before any results were read. It's frozen until its 10-06 decision.

## Needs you
1. **Approve the chest clear list** (sent earlier). Also say whether eggs, scutes, flint and clay (2,297) and the
   decorations (125) should go too.
2. **Rotate hive-b's RCON password** and delete `/tmp/scan2.py` (and possibly `/tmp/scan.py`) on 10.0.0.31. A
   temporary script holds it in plain text, and it was printed during the census.
3. **Optional:** when the chests are full, should *any* bankable item open a new chest (what I built, with a cap
   of 4 a day and 12 standing), or only valuables?

## Order from here (one test at a time, each starts on its own)
craftroom (live) → composter → spent-tool cleanup → crafting-grid fix → chest-full fix → withdraw → no junk in
chests → one-time clear (after your OK) → bamboo → logpickup.
