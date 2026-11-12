# No walking mess: design (2026-11-12)

Owner rule (11-12): "Walking must not place dirt or dig ground. Escapes undo what they
placed. Even outside the town I want the same rules to apply."

Two independent designs (Codex, and a separate Claude given only the brief and the code)
were reconciled here. Both are in the session scratchpad; their shared conclusions and the
one place I overruled them are marked.

## What is true today

Showcase, 14 bots, 12 hours to 2026-11-12 13:20Z (`_place_town`, `_dig_town`,
`_scaftown_hits`; 165,892 rows read):

| | Count |
|---|---|
| Blocks placed in town and margin by movement | 1,772 (80% dirt) |
| of which ordinary walking (pathfinder) | 1,321 |
| of which escape reflexes and skills | about 450 |
| Placed outside town, same window | about 2,700 |
| Placed cells later dug at the same spot | 75 |
| Ground blocks dug in town | 176 |
| Cells the cleanup crew fixed | about 140 |

- Walking placements come in small piles: 664 bursts, median 1 block, 90% are 4 or fewer.
- The skill running at the time: gather 482, explore 292, goto 232, surface 110.

**The 11-07 change (scaftown-01) already prefers placement-free routes, and it is not
enough.** It priced 74,826 of 90,689 walk searches and bots still chose a placing route
585 times. Another 16,324 searches ran out of their preference budget, 10,783 were capped
searches it never prices, and 5,080 ran unpriced because the goal had just failed. So a
"search without placing first" piece, which both designers proposed as piece 1, would
repeat that result. I moved it to piece 2.

## The reading of the rule

A flat ban cannot be met in every world: a bot in a pit with no route out must place or
dig to leave, and the owner's standing constraint is that bots survive and move anywhere.
Both designers reached this independently. So the rule is implemented as:

1. Walking never digs (already true) and places only when no other route exists.
2. **Whatever a walk or an escape places, the same bot takes back** as soon as it has
   passed, while the block is still in reach.
3. What it cannot take back is counted and handed on, never silently left.
4. A spot that needs a block again and again is a missing stair or path, and gets one.

## Pieces, in order

### 1. Take back what a walk placed (first to ship)

- **Receipt.** `placeaudit.mjs` already wraps `bot.placeBlock` and sees every movement
  placement with its cell, block and source. On `outcome=placed` with `reason=pathfinder`
  it adds a receipt to the bot's list, in town and outside.
- **When it is taken back.** A receipt is ripe when the bot is on the ground, is not on
  or above that column, is at least one block away horizontally, and can still reach and
  see the block. A watcher inside the walk leg halts the leg when a receipt is ripe or is
  about to leave reach; `gotoLegs` digs the ripe receipts and re-plans the leg from where
  the bot stands. A sweep at the end of the skill takes any that are still in reach.
- **Never dug:** a cell that no longer holds the block it placed, a cell with anything
  standing on it, a cell inside a build record or a protected zone, the block under the
  bot. These close as `adopted` or `deferred`.
- **Loop bounds.** At most 12 take-back halts per walk. A cell placed twice in one walk is
  kept for that walk (`kept=reuse`).
- **Left behind.** A receipt out of reach stays open for an opportunistic pass, then
  expires as `left`. In town those cells already reach the cleanup crew through the climbs
  ledger.
- **Code:** new `takeback.mjs` (pure decisions and the executor), `placeaudit.mjs`
  (receipts), `skills.mjs::gotoLegs` (protected). Switch `TAKEBACK=off`. Row `_takeback`
  with `outcome=dug|adopted|deferred|kept|left` and a ten-minute `_takeback_sum`.

### 2. A hard no-place first search

Replaces the +20 price with a rule: the first search phase offers no placements at all
(the library places nothing when the search starts with zero scaffold blocks), then the
existing restart and latch fall back to the base search. Extends to gather's approach
walk. Cheap, because scaftown's fallback machinery exists. Expected effect is small.

### 3. Escapes take back their pillars

Receipts for `pillarOut`, `digStraightUp`, `surface` and `shaftAscend` (`reflex.mjs`,
protected). Taken back only after the escape has ended and the bot stands beside the
column: top down, as far as reach allows, the rest handed on.

### 4. Dug ground is put back

- Escape and transit digs in the surface band get a receipt and are refilled with the
  block the bot just picked up, only from three or more blocks away and never from below.
- Gathering dirt or sand out of town ground is refused inside the town area, with the
  remedy executed in code: take it from the yard or walk out first.

### 5. Repeated spots become access

A 3x3 spot that needed a block on three walks in 48 hours is a missing stair. In town it
goes to the groundskeeper's stair list (`climbSpots`, already there). Outside town the
block is kept and counted, capped per bot per day.

## What I expect, and what would say it is hurting

- **Piece 1:** of walking placements in town and margin, at least half taken back by the
  bot that placed them (today 75 of 1,772, about 4%). The number is `_takeback
  outcome=dug` against `_place_town outcome=placed reason=pathfinder`.
- **All pieces:** blocks left standing at or below a quarter of those placed.
- **Hurting if:** any death with a `_takeback` row in the 30 seconds before it; walk
  failures (`no_path` plus timeouts) up more than 10%; median walk time up more than 15%;
  more than 90 seconds per bot-hour spent taking back.

## Most likely ways it fails

1. **Out of reach by the time it is safe.** Long pillars and fast walks leave receipts
   behind; they show up as `left`. This is a number in the read, not a hidden gap.
2. **Churn.** A step taken back is needed again on the way home, so time is lost. The
   reuse rule and piece 5 are the bound; three walks may be too slow a trigger.
3. **Bypasses.** Gather's approach, explore and the builders' walks do not all pass
   through `gotoLegs`; the skill-end sweep catches some. The read will list placements by
   skill so the uncovered ones are visible.

## Rollout

Showcase first, one piece at a time, each read for a day against the baseline above. All
pieces touch protected movement code: two reviewers, a search of prior art, then a fleet
canary at the front of the queue. The fleet line has no placement instrument yet, so its
first canary carries `placeaudit` with it.

Prior art: neither mineflayer-pathfinder nor Baritone removes blocks after a path.
Baritone's `allowPlace=false` searches placement-free routes only, which is piece 2.
