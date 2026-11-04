# yarduse-01: why the stock yard stands unused, and the fix (2026-11-04)

OWNER 2026-11-04: "we built a large area outside the town to put excess materials, it seems to have been built but doesnt
seem to be used, why?"

The yard is the stockpile yard from stockyard-01 and yardsite-01 (owner 11-02: bulk cobble at the town edge; resource model
Q1 "yard full -> surplus stone down the well, metered, from bags only: YES"). It is `bots/src/yard.mjs`, the visit is
`skills.mjs yardVisit`, and the showcase yard is yard@1 at anchor -50,5, orient S. It has 4 bays x 76 pile slots = 304.

## 1. Measured (showcase, 15 bots, 48 h 11-02 12:56Z .. 11-04 12:56Z)

Source: `scripts/lib/telemetry.py` full walk of `/var/log/mcai/showcase-*/skill-*` on .40, rotated files included. That
is 374,125 skill rows from all 15 bots. The world was read by RCON `execute if block` (read only). The scripts are in
`~/scratch/yarduse/` on .40.

| What | Number (denominator) |
|---|---|
| Pile placements, 11-03 06:00Z .. now | 244. Bay0 77, bay1 77, bay2 90, **bay3 0** |
| World now (RCON) | Bay0 76/76 cobblestone, bay1 76/76, bay2 75 + 1 dirt, **bay3 71 air + 5 spruce_leaves on layer 4 (y=72)** |
| Yard room for cobblestone | **0** since 11-03 09:22Z, apart from 6 min on 11-04 |
| `_yard` rows | **12** in 48 h (of 374,125 rows), all kind=stock. 9 on 11-03 07:11-09:22Z (227 placed, then full); 3 on 11-04 09:59-10:00Z |
| Refill / clerk / upkeep rows | **0 / 0 / 0** |
| The only withdrawal ever | showcase-Lumen's ordinary `gather cobblestone` mined 16 pile blocks out of bay2 at 11-04 09:54Z (`_reach_probe hit=` on pile slots) |
| Bag cobble at 31,047 decisions (non-underscore skill rows) | cobblestone p10 194 / p50 474 / p90 719 / max 1,059; deepslate p90 61; used slots p50 29 / p75 30 / p90 32 |
| Bag surplus above YARD_BAG_KEEP 128 | >= 64 at **92.4%** of decisions (28,699 of 31,047). Median 377 |
| Bags' cobble family, all 15 bots | 5,433 now, 3,529 48 h ago |
| Town chests' cobble | At the 1,000 cap: `_cobble_bank` town_after p50 983 (n 47). 935 `_stock_refused` rows, 932 of them cobble_cap |
| **The junk well** | **9,066 cobble in 28 `_well_dispose` rows** (cap=at_cap, ~324 each, the bag at 34-36 -> 25-27 slots). **2,893 of it while the yard still had room** (11-03 07:11-09:22Z); 6,173 after it filled |
| Cobble placed by consumer (`_build op=place`) | yard 584, tower 546, tidy (groundskeeper fills) 546 (+171 dirt), hall 114, paths 63, shrine 37, road 15 |
| Bills drawn from town chests | tower 911 cobblestone in 12 of 87 visits; tidy 148 in 1 of 478. **Nothing draws from the piles** |
| `_coal_site coal run refused on project:yard` | 30 of 1,503 such rows: coal under record cells, refused correctly (not a cause) |

Positive controls: the same walk counts 1,320 `_sink op=pick` rows, 216 `_well_dispose` rows and 1,543 `_build_visit`
rows. Those include 36 visits to project=yard, 10 of which were `yard_stock`. So the zero refill, clerk and upkeep rows
are absences, not a blind query.

## 2. Why it is unused, ranked

1. **It filled in 2 h 11 min and then had no outflow.** 227 blocks went in on 11-03. Nothing ever takes stock out:
   - The refill waits for the chests to drop below 256, and they sat at 788-1,000.
   - Sinks and the tidy pay their bills from the bag, then from the chests.

   With no room, `yardWork` returns kind=null, the yard is never `due`, and it is never offered: 26 h with no yard work.
2. **A quarter of it was locked by five leaves.** An overhanging spruce left 5 leaf blocks on bay 3's top layer. `bayStates`
   counts them as `foreign`, and an empty bay with foreign blocks is never given to a material. The upkeep (`yardClutter`)
   scans only the aisle cells at +1/+2, never the bays, so nothing ever cleared them. Cost: 76 of 304 slots.
3. **The well never asks the yard.** `cobbleWellCap` and `disposePlan` throw whole stacks above the bot's 64 once the
   chests are at the cap. 2,893 cobble went down the well while the yard had room, and 9,066 in total, against the yard's
   584 (15x).
4. **Capacity is tiny next to the flow.** About 4,500 cobble a day is surplus, and 304 slots hold roughly 1.6 h of it. A
   bounded yard has to be a buffer that turns over, not a store.

## 3. Designs

### Claude

- **Bay clutter.** A pile slot holding a non-bulk, non-kept block is the upkeep's job (kind=tidy on a pile slot). If a
  blocked bay leaves the surplus less than a stack of room, the upkeep goes first (`dueFirst`). The same visit then stocks
  the bay it cleared.
- **Yard before well.** At the cap, the well leaves `YARD_BAG_KEEP_COBBLE + min(room, 64)` in the bag:
  - Only while the yard has >= 16 room, is not resting, and has no unanswered deferral.
  - A deferral makes the bot's stock urgent, which puts it in the picker's repair tier.
  - A stock visit that placed answers the deferral.
  - An unanswered deferral blocks the next one for 30 min. During that time the well throws as before, so a bag is never
    held full on the yard's promise.
- **Consumers draw from the yard.** Sinks (tower/road/shrine/dress) and the groundskeeper's tidy fills take the bill's
  cobblestone from the pile tops before the chests. This is a bounded yard visit (kind=draw, the yard's own lease and
  rows), dug with a pickaxe and collected into the bag.
- **Kill switches:** `YARD_BEFORE_WELL=off`, `YARD_DRAW=off`.

### Codex (independent, given the measurements only)

1. No consumer connection.
2. The well bypasses the yard.
3. Capacity.
4. Foreign blocks strand capacity.
5. Scheduling: no yardWork means no visit, and the 20-min rests.

Its design:

- **First piece:** "one complete yard-before-well transaction including bay maintenance and executable fallback; do not
  ship a standalone well veto".
  - Pure route, maintenance and service functions in yard.mjs.
  - Allow partial deposits below 64.
  - Every planning and execution path on the same policy.
  - Urgent logistics priority with bounded retries.
  - Clutter triggers maintenance even at zero room.
  - Remedies for: unread yard, clutter, busy lease, missing tool, failed route, and full yard (metered bag-only well).
- **Second piece:** consumer withdrawals in buildSink/buildTidy before the chests:
  - Bounded by bill, bag, tool and visit time.
  - Reverse ramp order, counted from the inventory and not the digs.
  - Drawn accounting so withdrawn blocks are not restocked or discarded.
  - Count yard holdings in sinkPressure.
- **Third:** tune throughput. 656 slots buys about 3.5 h; keep the yard bounded.
- **Tripwire:** proposed explicit pile_place / pile_take / yard_clear kinds.

### Reconciled

| Point | Decision | Why |
|---|---|---|
| Causes | Same four. Codex ranks "no consumer" first, Claude "full + no outflow" first; these are the same fact | - |
| Bay maintenance + yard before well, together | Yes: both are in the first piece, with the bounded deferral as the executable fallback | Both engines |
| Consumer draws | **In the same branch, behind its own switch** (`YARD_DRAW=off`), not a separate later piece | The owner asked for both in one instruction. It shares the yard visit, and the reviewers judged it together |
| New tripwire kinds | **No new kinds** | The tripwire already accepts project=yard `kind=tidy` on any pile slot (yardread-01 `yard_tidy_ok`) and bulk places on pile slots (`yard_place_ok`). Bay clutter and draw digs are exactly those rows. Fewer kinds is less surface |
| Yard holdings in sinkPressure | **Deferred** | Pressure p median is 0.49 already. Not needed for the yard to turn over |
| A bigger yard (yard@2) | **Not now** | Both engines agree a buffer must turn over. yard@2 did not fit the showcase (yardsite-01) |
| Partial deposits below 64 | Yes, for a deferred bag (`deferred` -> pressed -> placed > 0 qualifies) | Codex |
| Unread yard | No deferral (room 0 -> the well's own 64) | A guess never holds cobble |
| Remedies | busy lease -> deferral expiry; failed visit -> rest -> well; clutter that will not dig -> 2 empty clearings hold it off for 2 h | No first-in-line loop |

## 4. Built: yarduse-01 (tier 2, showcase piece; not protected)

`python3 scripts/lib/protected.py` reports yard.mjs, well.mjs, shop.mjs, and skills.mjs yardVisit / yardWorkNow /
buildSink / buildTidy / cobbleWellCap / throwPhase / disposeWell: none are protected.

- **yard.mjs**
  - `bayClutter`.
  - `yardWork` gains `bayClutter` (upkeep `first`) and `deferred` (urgent).
  - `yardWellKeep`, `yardDeferOk` / `yardDeferred`.
  - `yardDrawPlan` (`YARD_DRAW_MAX` 32), `collectMore`, `yardFlag`.
  - `_yard_mode` prints `before_well=` and `draw=`.
- **well.mjs**
  - `cobbleWellStacks(items, { reserve })`, never below 64.
  - `disposePlan` gains `cobbleReserve`.
  - The `_well_dispose` row gains `yard_kept=`.
- **skills.mjs**
  - `wellCobbleReserveNow`: a 30 s memo per bot. It is read by `cobbleWellCap`, by every at-cap `disposePlan` caller
    (valveProof, townWellTakes, throwPhase, disposeWell entry, pruneWellRule) and by the recount offer.
  - throwPhase stamps `bot.yardDeferAt`.
  - yardVisit:
    - kind `draw`.
    - Clearing the bay clutter, then stocking in the same visit.
    - `yardCollect` after every dig-back.
    - `bot.yardStockAt` when it placed.
    - Draw rest is separate from stock rest.
  - shopActive: a blocked bay is `dueFirst`.
  - `yardDrawFor` runs in buildSink and buildTidy before `matsWithdraw`. What it puts in the bag goes to `tookAll` (the
    drawn record).
- **Tests:** `bots/test/yarduse.test.mjs` (behaviour):
  - The live case is rebuilt on the fake server: three bays full, the dirt, the five leaves.
  - The old plan finds no work.
  - The real runner clears 6 and then places 64 into bay 3.
  - The well plan over a real bag keeps 192 and throws the rest; the bag kept is exactly one stock visit.
  - The deferral is bounded.
  - The draw digs 32 with the runner.
  - The collection stop rule.
  - The order reads the live case as work through `shopDamaged`. A deferral makes a partial surplus work, and a stock
    answers it.
  - Anchored wiring checks, each killed by a one-character mutant, plus 3 behaviour mutants.
  - `well.test.mjs`'s reserve mutant was re-anchored.

### Reviews

- Codex r1 (blockers only): **NO BLOCKERS**.
- Claude subagent r1 (independent; the draw rests on dig-and-collect behaviour never seen live, so two engines):
  **BLOCKER**. A pile block dug from the aisle drops onto the pile, out of pickup reach. buildbot's dig never collects, and
  the single `pickupNearbyItems` call (4 walks, 8 blocks) would leave most of a 64-block draw to despawn. This was latent
  in the refill path too, which has never run live. Fixed in r1 (71b7efe9):
  - `yardCollect` sweeps while drops remain in the piles' box and sweeps gain (8 sweeps, 2 idle).
  - The dig runVisit ends 15 s early to leave time.
  - `YARD_DRAW_MAX` 32.
  - A draw that collected under half of what it dug rests the draw.

## 5. What a Paper sandbox should prove (not proven; fake-server chain only)

1. A cobblestone pile block dug with a pickaxe from the aisle drops one cobblestone, and `yardCollect` walking the ramp
   collects >= 90% of 32 drops inside the draw's 60 s.
2. Spruce leaves on layer 4 are dug from the aisle by hand (no tool needed; they may drop a sapling or stick, which is
   fine).
3. Placing on the cleared bay 3 top faces from the aisle and ramp (already proven live: 244 placements on bays 0-2).

## 6. The live read (+2 h, then +24 h; telemetry.py full walks)

- **Bay 3 unlocked.** A `_build project=yard op=clear kind=tidy` row on each of the 5 leaf cells and on the dirt. Bay 3
  then fills (RCON).
- **Yard before well.**
  - `_well_dispose` rows with `yard_kept=`, followed within 30 min by a `_yard kind=stock` placed > 0 from the same bot.
  - Cobble to the well per day falls from 4,533/day (9,066 / 48 h). The denominator is the at-cap well rows.
- **Draws.**
  - `_yard kind=draw` rows: dug (from the bag) against cleared (the digs), with **dug/cleared >= 0.8** (the collection
    works).
  - `fromYard=` on tower and tidy `_build_visit` rows.
  - Chest draws below the 48 h baseline (tower 911, tidy 148).
- **Turnover.** Yard holdings move both ways in `_yard yard=` across the day, not pinned at 227.
- **Tripwire.** `clear_outside` and `off_record` stay 0 for project=yard.

## 7. Queue

**Showcase lane** (both engines): after the current showcase stack (sinkfix-04 7bc965ca live; siteprep2 in flight). It is
small, bounded and switchable, so it can be folded with the next showcase batch ahead of the 15-bot step. The 15 bots add
consumers and inflow both.

**Fleet:** the yard is on only in YARD_POOLS (showcase). The fleet yard rollout (owner 2x) waits for this read.
