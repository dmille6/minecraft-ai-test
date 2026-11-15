# Why the bots hollow out the ground: the dirt loop (2026-11-15)

Follows [ledger-first-run.md](ledger-first-run.md), which showed the showcase lawn's dirt was dug out from under its
grass. This page says which behaviour does it, what the 11-13 rule changed, and what would stop it. Everything here is
read from saves and logs; no bot code was changed and nothing was run on a live world's server.

## What the bots' own logs say

**Dirt is the thing the bots gather most.** Showcase, all of 11-12 (353,271 rows, 14 bots): 3,891 gather actions, 1,853
of them for dirt (48%), and in 1,208 of those the bot stood inside the town. 327 ended "entombed, but dirt gained": the
bot buried itself getting it.

**Why they want it.** The escape code picks the cheapest block it carries to pillar out with, and dirt is the cheapest:
2,764 "pillar_out: dirt instead of cobblestone" rows that day, and 13,952 scaffold picks in the later 30-hour window.
The cleanup's own fills ask for dirt first as well. A bot that has no blocks to climb with is told to go and get some.

**Why it makes hollows and not open scrapes.** A request for "dirt" matches blocks named dirt. The grass block on top is
a different block, so the bot takes the dirt under it and leaves the grass: a roof over a gap.

**The loop.** Escape uses dirt, so dirt runs out, so the bot gathers dirt where it stands, so the ground gets pits and
hollows, so bots fall in or bury themselves, so they escape again. The pillars left behind are the junk; the holes are
the other half of the same habit.

## What the 11-13 rule did: it moved the digging, it did not reduce it

The rule (cleanzone-02, live 11-13 16:29Z) refuses to gather dirt, sand, gravel or stone inside the 64-block town
square and walks the bot to a point six blocks past the square's edge to gather there.

- **In town it worked.** Dirt and grass broken within 48 of home fell from 2,171 to 3,730 a day to 131 (block history).
- **The demand did not fall.** Showcase, 11-14 15:00Z to 11-15 00:30Z: 1,316 gather-dirt actions in 9.5 hours, 139 an
  hour against 77 an hour on 11-12. Now 1,144 of them with the bot outside the town.
- **The damage went to a ring just outside the square.** The rehearsal world has had the rule on from its first minute.
  Ledger, 9.7 hours in, by distance from home:

| Blocks from home | Columns | Undermined | Pits | Damaged per 1,000 columns |
|---|---|---|---|---|
| 0 to 16 | 1,089 | 3 | 4 | 6 |
| 17 to 32 | 3,136 | 75 | 59 | 43 |
| 33 to 48 | 5,184 | 75 | 77 | 29 |
| 49 to 64 | 7,232 | 114 | 49 | 23 |
| **65 to 70** | 3,240 | **488** | 74 | **174** |
| 71 to 76 | 3,528 | 255 | 51 | 87 |
| 77 to 96 | 13,840 | 481 | 103 | 42 |
| 97 to 128 | 28,800 | 237 | 56 | 10 |

The six-block band where the rule sends every bot is four to eight times as damaged as the town and seventeen times as
damaged as open country: 562 columns in under ten hours. Left alone, a new town gets a moat of hollow ground around it.

## A second source inside the town square

The rehearsal logs show 717 `mine` actions by bots inside the 64-block square and 345 stair treads "cut and not taken"
(171 of them inside it). The rule that stops a bot digging down near home covers 16 blocks, the size it was given for the
fleet's small towns. The town's shared mine stair exists so that each bot does not dig its own hole, but going down it
failed 193 of 223 times (140 of them "step blocked"). So bots cut their own stairs, which is where the stone-sided pits
inside the square come from (544 stone blocks dug at the surface there).

## What would stop it

| | Change | Where it is | Protected code? |
|---|---|---|---|
| P1 | **Take ground from the top, never from under a roof.** A terrain block with a solid block over it is not a gather target unless the bot is down a mine. Grass counts as dirt for this purpose. The same demand then leaves a shallow open scrape, which is visible and fillable, not a hidden hollow | gather's choice of target | Yes (`skills.mjs` gather) |
| P2 | **Climb with what the town has too much of.** Cobblestone is in surplus (bots throw it down the junk well). Every bot keeps a climbing reserve of it, and the escape uses it before dirt | the escape's scaffold pick and the bag's reserve | Yes (`bankable.mjs`, `scaffold.mjs`) |
| P3 | **One place to take soil from.** A marked borrow pit outside the town, dug top down in a tidy rectangle and finished afterwards (a pond, a cellar, a field), instead of "six blocks past the edge" for everyone | the gather rule's exit points | Partly (the rule is not; gather is) |
| P4 | **The mine rule covers the whole town square**, and the shared stair's "step blocked" failure is fixed so the bots have somewhere to go down | `townground.mjs`, the shaft project | To be checked |
| P5 | **A debt for every escape pillar** (step N2 of the recommendation): the block is owed until the world shows it gone | take-back | No |

P1 is the smallest change with the largest effect on hidden hollows and it helps anywhere in a world, not only near a
town. It touches protected code, so it needs the owner's yes for that specific change, both engines' review, and a
release that waits for the rehearsal to end (11-16 14:46Z).

## Not established

- How much of the dirt demand is escapes and how much is the cleanup's own fills.
- Why the escapes happen so often in the first place. That is a question about walking and getting stuck, not about land.
- Whether the block-history drop on 11-14 owes anything to the six hours the model was unreachable that day.
