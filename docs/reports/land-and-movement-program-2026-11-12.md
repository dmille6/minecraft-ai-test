# Land care and movement: the program (2026-11-12)

Owner (11-12): "is there a better approach for bots movement and pathfinding along with a
better approach to cleaning up the land (in town and out of town) ... grounds keeping and
terraforming the land", then "Yes, design it, test it, deploy it. lets get this working
we've been fighting it for days".

Two independent designs (Codex, and a separate Claude given only the brief, the data and
the code) are reconciled here. They agree on every piece and differ on the order of the
first two. Both are in the session scratchpad (`land-design-codex.out`,
`land-design-claude.out`).

## What the data says

Showcase, 14 bots, 24 hours to 2026-11-12 13:39Z (333,896 rows; 20,160 bot-minutes).

| | Measured |
|---|---|
| Bot time spent on cleanup | 218 minutes, 1.1% |
| Cells the cleanup fixed | 269 |
| Rate when a cleanup visit works | about 2.5 cells a minute |
| Cleanup visits that fixed nothing | 49 of 131 (a helper took the job and found nothing assigned to it) |
| Stray blocks placed in town and margin | 3,730 |
| Ground blocks dug in town | 332 |
| Cleanup backlog | 2,431 fills and 496 cuts left; grew about 380 in the day |
| Working time spent getting back to the surface | 11.8% |
| "Buried" events | 2,576, of which 1,976 underground |
| Failed route searches | 7,064, of which 3,466 underground |
| Where the stray blocks are | 465 small areas; 25 hold a quarter, 77 hold half; 92% in areas more than one bot uses |

**One structural fact explains most of it.** Many things change the terrain (walking,
escapes, mining) and nothing that is reliably scheduled owns access or restoration. Each
bot solves each crossing for itself with dirt, and each bot that goes down digs its own
way. Repair is one keeper and a few helpers on a role lease, so it gets 1% of the time
however the lease rules are tuned. That is why eight patches to those rules changed
nothing.

Two facts I had wrong before the measurement:

- The two-minute cutoff on cleanup visits is the 180-second skill limit, not a cleanup
  setting. Visits cannot be made longer; there have to be more of them, by more bots.
- The town already has a target-surface solver (`regrade.mjs`) and a cleanup plan of
  6,861 cells. "Grade to a plan" means finishing and freezing that plan, not a new one.

## The pieces, in order

Each ships to the showcase on its own, has one off switch, and is read for a day against
the table above.

### 0. Take back what a walk placed (built; releasing today)

`takeback-01show`: a bot digs back its own scaffold block once it has passed it. Both
reviewers clear it after three rounds. Switch `TAKEBACK`.

### 1. Cleanup becomes ordinary, funded work (building now)

`grounds-01show`, switch `GROUNDS2`. Not protected code.

- Any builder at the surface in town takes a ready cleanup segment, with the full work
  the keeper does today. The existing segment leases and spacing rule keep bots apart; at
  most four on the grounds at once.
- A guaranteed share, decided in code: while more than 500 cells are open, every second
  build visit goes to the grounds; above 100, every fourth.
- A visit that fixes nothing spends that bot's share for ten minutes, so empty visits
  cannot loop.
- Stairs at the spots bots keep climbing are taken before plain fills.
- The keeper lease stays only for what needs one holder (publishing the survey, the
  forest, the water walk, countryside siting).

Expected: build visits are 14% of working time, so half of them is about 600 minutes a
day against today's 218. At the measured rate that is roughly 700 to 1,500 cells a day.
With piece 0 cutting new mess, the backlog should fall instead of grow. Proof row
`_grounds_quota`; the number is net backlog change per day (today +380).

Codex put this first and Claude put stairs first. I took Codex's order because the
stairs are built by this same crew: funding the crew and putting stairs at the head of
its queue delivers both.

### 2. One way down and one way up

Protected code (`mine`, `surface`, the stair skills): two reviewers.

- In the town area, mining goes down by the town stair, by walking there in code, not by
  a refusal.
- Outside town, a bot records the staircase it digs and walks back up it.
- The return is repaired from where the bot stands before any new exit is dug; the
  survival escape remains the last resort.

Expected: surface time from 11.8% toward 7 to 9%, buried events underground down a
quarter to a half. Risk: the stair becomes a queue; emergency exit must never wait for a
lease.

### 3. Escapes and dug ground are put back

The take-back design's pieces 3 and 4, with receipts that survive a restart and
unfinished ones handed to the grounds crew. Expected: half of escape pillars gone within
a day.

### 4. Freeze the surface plan

Grade to a fixed target height per column in small tiles, ordered by climb traffic. A
tile is done when every column is within one block of target, which also makes it
walkable without placing. Today the survey re-anchors on the current ground, so new mess
re-enters the plan as new work.

### 5. Then, and only then, ban placing while walking

Both designs say a ban is not safe yet: route searches already fail 7,064 times a day.
It needs the stairs from piece 1 and the return route from piece 2 first, and a coded
fallback (reroute, step back, raise an access job).

### Outside the town

Take-back applies everywhere now. The grounds share extends to the countryside rings
(`country.mjs`) once the backlog inside is under 500. I am not proposing to groom open
wilderness.

## What stops

- No more patches to the keeper and helper lease rules. Piece 1 replaces the helper
  leases, the idle strikes and the fitness checks; they are removed after its rollback
  window.
- No more placement surcharges. `scaftown` goes when piece 5 lands.

## Most likely ways this fails

1. **The share is spent on setup, not work.** Visits are two minutes; if the walk to the
   segment takes one of them, yield halves. The proof row carries cells per visit.
2. **Stairs get ignored.** They are sited where bots climbed with a block in hand, which
   may not be where the route search goes without one. Each stair's nearby placement
   count shows this within a day.
3. **Cleanup removes access someone needs.** A cut that was the only way up strands the
   next bot. Stairs first, and take-back's rule of never digging under a body, are the
   bounds.
