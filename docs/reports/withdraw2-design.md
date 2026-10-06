# withdraw2 design v2 (after Codex design check CHANGE: 7 P1 + 1 P2) -- base c902d6f, branch wd2-on-c902d6f

Owner-approved 10-06: item 3 (best-first) and item 1 (iron upgrade). Live: 13 pickaxes withdrawn in 6 h, 7 WOODEN.
Why: bestToolCopy ranks ">= 40 uses" above tier, and the order takes at the FIRST container with any usable copy.

## A. Best-first = INSPECT, THEN TAKE (Codex 1, 2)
- Ranking (pure, withdrawpick.mjs): never spent (remaining <= FLOOR); then tier (toolfor TOOL_TIER: wooden < golden <
  stone < iron < diamond < netherite); then uses left; then lowest slot. PREFER_USES no longer ranks.
- The pickaxe pass first INSPECTS up to WITHDRAW_CONTAINERS (3) candidate containers (open, read, close; no clicks),
  deduplicating double-chest halves, recording every usable pickaxe copy seen (container, slot, name, wear). Then it
  revisits the WINNER (unless it is the container just inspected -- taken in the same open), REVALIDATES the exact copy
  (slot, name, wear) and takes it. If the winner changed, the next-best still-valid copy in that container or the next
  container is used; the row's best_seen is the best copy that was STILL VALID at the take (so G5 is exact).
- Guarantee scoped to inspected containers (the town may have more). No positive census in memory (stale under other
  bots' withdrawals/trades). NEGATIVE evidence only: `_pick_best: { 'x,y,z': { at, tier } }` = "at `at`, nothing here
  was better than `tier`" (-1 = no usable pickaxe; written for both halves of a double chest after an inspection and
  after our own take/trade). A withdrawal by anyone can only lower the true best, so it stays valid; an insertion is
  covered by deposit's 'took' entry (towndeposit does not write one: a missed upgrade for <= 15 min, never a wrong take).
  The upgrade trigger is "not every town container (complete coverage) has fresh _pick_best <= held".

## B. Who the order is for, and in which order the outcomes are tried (Codex 3, 6)
Eligibility inside the skill (and in townOrder): bag best usable pickaxe tier `held` (-1 = none).
  1. held < iron -> after inspection: a copy of tier >= iron -> take the best (A).
  2. else held < iron and the IRON PATH is feasible and its cooldown allows -> iron path (C).
  3. else a copy STRICTLY better than held -> take it (e.g. stone over wooden); end.
  4. else held == -1 (no usable pickaxe) -> the existing stone-ingredient path (unchanged).
  An inspected copy of equal or worse tier than `held` is never taken.
Cooldowns: the existing 5-min order cooldown + backoff; a separate IRON_ATTEMPT_COOLDOWN_MS = 30 min per bot charged
BEFORE any iron-path mutation, kept through failure, abort and unverified outcomes, checked INSIDE the skill (both
triggers), with a per-bot stagger (hash of the name, 0-5 min). An upgrade-only order (held >= 0) also has its own
30-min cooldown in townOrder.
Room gate (townOrder): pickRoom passes if roomPlan(bag, [pickaxe]) is ok OR the bag holds a worse usable pickaxe that
the verified trade can swap out (D).

## C. Iron path (Codex 5, 6, 8)
- Survey = the inspection pass (A) already opened up to 3 containers: per container counts of iron_ingot, stick, planks,
  logs, from the live window. No take until a COMPLETE PLAN exists from those counts:
    ingots = 3 - held; sticks: 2 - held sticks, else wood for them (2 planks -> 4 sticks; a log -> 4 planks); the table:
    reachable (STATION_REACH) or carried, else 4 planks; wood demand = sticks' planks + table planks - held planks
    - 4*held logs; room for every take by roomPlan with live chest capacity for its room-making deposits (decideTakes);
    remaining watchdog time >= IRON_MIN_MS (60 s).
- Order of takes: prerequisites (sticks / wood) first, from their container; server-verified; then RE-PLAN with the
  live bag; then ingots LAST (exact deficit), server-verified. roomKeep gains iron_ingot so no room-making ever banks a
  held ingot.
- Craft via the existing skill: craft(ctx, { item: 'iron_pickaxe', count: 1 }) (craftsync lockstep, craftroom table
  handling). Success = status success, produced >= 1, verification 'server', AND withdraw's own server recount shows
  iron_pickaxe +1 vs the order's baseline.
- Holds: scoped. Taken prerequisites/ingots get a temporary hold (bankable.mjs: new releaseWithdrawHold(name, count))
  released in `finally`; the produced iron_pickaxe gets the usual HOLD_MS hold as soon as the recount shows it, even if
  the craft's table retake threw afterwards.
- On a failed craft the ingots stay in the bag: towndeposit retains iron_ingot (IRON_LADDER) and the model/rung crafts
  iron_pickaxe from held ingots, so they are neither banked nor looped; the next iron attempt (>= 30 min) re-plans with
  held stock and takes only the remaining deficit (normally none).
- Negative evidence for ingots with QUANTITY: `_ingot_seen: { 'x,y,z': { at, count } }` (chest2 town memory, inTown,
  complete coverage, invalidated by a later 'took' or our own take). Ruled out when complete coverage and the fresh sum
  < the ingot deficit. Sticks/wood keep _ingredient_miss. The iron path is not attempted when ruled out (Codex 7).

## D. The worse-pickaxe trade (Codex 4)
Bag full, chest full: the outgoing item may be the bag's worse pickaxe (preferred over a bankable stack). The trade
carries the outgoing tool by IDENTITY (slot, name, wear) and the incoming by identity; immediately before the mode-2
click both are revalidated and the strict tier improvement re-checked; the swap is atomic (the bot never lacks a tool
between clicks). After the click, the server recount must show the incoming copy in and the outgoing out; if the
hotbar received something else and the chest slot holds our old pickaxe, the same mode-2 click swaps it back. Never
trades the only usable pickaxe for anything not strictly better and present at the click.

## E. Rows and the read (Codex 8)
- One baseline server recount before the order's first mutation; one after its last (incl. the craft): srv= is
  cumulative. The row adds, early (before tried=, which is last and may be cut): held=<tier> took_tier=<tier>
  best_seen=<tier> craft=none|server|unverified|failed produced=<n> transform=<names consumed by the craft chain>.
- withdrawread gates: G1 unplanned loss (a server fall of a name not in plan= and not in transform=); G2 spent tool taken;
  G5 took_tier < best_seen; G6 outcome=crafted_iron without craft=server or without srv iron_pickaxe:+1. Unknown
  verification stays unknown (never counted as success). Iron production counted once per order (crafted_iron rows),
  never from nested craft rows.
- Reported DiD: share of withdrawn pickaxes by tier; iron pickaxes per bot-hour (crafted_iron + holders).

## F. Visit budget (Codex 7)
Per order: <= 3 inspections + <= 2 take visits; a container that cannot be reached is not retried this order. Complete
negative evidence (pickaxe-best per container and ingot quantity, 15 min) stops orders for a town that has nothing
better; an upgrade-only order fires at most once per 30 min per bot.

## v3 resolutions (Codex re-check of v2: CHANGE, 3 P1 + 2 P2)
1. FALLBACK: when the winner fails revalidation, ALL remaining observed candidates (every inspected container) are
   re-ranked and the next is revisited/revalidated in turn (within the visit budget). best_seen = the best OBSERVED tier;
   gone = the tiers of candidates PROVEN gone by a failed revalidation. The guarantee is over inspected snapshots plus
   the selected copy's revalidation; G5 trips only when took_tier < the best observed tier not proven gone.
2. TRIGGER: an upgrade order is suppressed only when BOTH branches are ruled out: (better copy ruled out: complete
   _pick_best <= held) AND (iron ruled out: cooldown active, OR complete ingot evidence with fresh sum < deficit, OR a
   prerequisite ruled out by complete evidence). Either still possible -> the order may fire (30-min upgrade cooldown).
3. VISIT BUDGET IN THE PLAN: before any mutation the iron plan must be an executable sequence of <= 2 take visits:
   the ingots' deficit from ONE container, and every prerequisite (sticks or their wood, table planks) either from that
   same container or from ONE other; the bag is simulated across the sequence (roomPlan on the combined takes, room
   deposits into the first visited container within its live capacity). Otherwise the iron path is declined (row).
   Before the ingot visit the plan is re-checked against the live bag; if it no longer holds, ingots are not taken.
4. EVIDENCE NOT TRUNCATED: the row's ledger goes into logEvent `args` (structured, not cut at 300): held, took_tier,
   best_seen, gone, craft, produced, srv (cumulative server delta), plan (names given up), transform (names consumed by
   the craft chain), complete=true. The read uses args; a row without them (or complete!=true) makes the gate UNKNOWN,
   never a pass.
5. IRON RETENTION IN THIS REPO: bankable.mjs bankableInventory keeps up to 3 iron_ingot (exclusion 'iron_upgrade_reserve')
   while the bag's best usable pickaxe tier is below iron -- so a failed craft's ingots are not banked by deposit here;
   towndeposit (separate branch, lands first) retains iron_ingot itself (IRON_LADDER), to be re-checked at the rebase.

## v3.1 (Codex re-check 3: CHANGE, 2 P2 -- adopted as stated)
1. The row records best_valid = the maximum tier among observed candidates NOT individually proven gone (unreachable or
   unvisited candidates stay eligible); the order STOPS rather than take below best_valid.
2. held >= iron rules out the iron branch (and the whole upgrade trigger, which exists only for held < iron).
