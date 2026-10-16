# townsearch-01 — withdraw_pick looks in every town container (2026-10-16)

Owner, 10-16 ~16:30Z: *"can we get the bots to check all the chests in town? seems like the simplest fix"* — approved as a
normal canary. Built on lidclear-01 (both touch withdraw).

## 1. The regression, with its denominators

`_withdraw_pick` order rows (verb=withdraw_pick), ES, 10-09..10-16 16:15Z, all pools:

| outcome | 10-09 | 10-10 | 10-11 | 10-12 | 10-13 | 10-14 | 10-15 | 10-16 (part) |
|---|---|---|---|---|---|---|---|---|
| took_pick | 120 | 79 | 72 | 60 | 37 | 12 | 10 | 6 |
| took_ingredients | 20 | 24 | 35 | 59 | 43 | 24 | 18 | 12 |
| short (no pickaxe, none of the ingredients) | 0 | 0 | 0 | 0 | 0 | 60 | 38 | 36 |
| has_ingredients (no pickaxe found) | 28 | 42 | 40 | 34 | 38 | 54 | 60 | 39 |
| all rows | 181 | 179 | 168 | 171 | 141 | 176 | 162 | 113 |

`short` existed in the code since 10-03 and was never written before 10-14.

Census (read-only RCON, 10-16 16:15Z, the 352 containers known on 10-14; town = within 16 of home horizontally, 12
vertically — the order's own boundary): every one of the 16 towns holds usable pickaxes (12-27, in 5-13 containers;
stone with damage <= 65: 4-16) and, except placebo-d, sticks (56-275, in 1-8 containers).

## 2. Why the 6 containers tried were the wrong ones (rows, not a reading)

1. **Always the same containers.** The base looks for the pickaxe in the 3 containers nearest HOME (mineflayer findBlock
   around home) without a live "no pickaxe here" miss, then for the ingredients in the next 3. The miss lasted 15 min. Over
   10-14 03:00..10-16, 426 orders: each town's orders opened only **5-14 distinct containers of 11-32**, and only **0-3 of
   the 5-13 that hold a usable pickaxe** (board-a 0/10, board-d 0/12, placebo-c 0/13, hive-d 0/6 over 72 orders).
   Positive control: the same join finds the visited holders where they were visited (hive-b 3/7, board-b 5/8 stick holders).
2. **The miss expired before the bot came back.** Same-bot gaps between orders: n=193, median 16.2 min, 66% >= 15 min
   (cooldown 5 + backoff 15 after a failure). So the next order re-opened the same 3 + 3, every time.
3. **The 10-14 02:21Z chest clear removed the redundancy that hid it.** In the 6 containers nearest home, holders of
   [usable pickaxe, >= 2 sticks] before the clear: 1-3 and 4-6 in every town (sticks in 16/16 towns); right after: sticks in
   5/16 towns, then 8-10/16 as deposits refilled. The clear left ONE stick stack (64) per town and ~20 pickaxes in 6-13
   containers. took_pick had already been falling since 10-11 (the nearest copies drawn down); the clear finished it.
4. **No row says a tried container held what was needed.** 134 short rows, 804 visits, every visited container known to
   the census; within 3 h of a census, 0 of 96 visits were to a container holding >= 2 sticks, while the town held them
   elsewhere in 110 of the 134 rows (the other 24: towns with none, e.g. placebo-d). 6 visits by the INGREDIENT pass opened a
   container holding a usable pickaxe and left it (that pass did not look for one).

Not the cause: orderroom-01, stocktarget-01/02 and digtown-01 do not touch withdraw's container choice (withdrawSweep and
withdrawPickRun were unchanged from 10-05 until this change); the ~260 newer containers are not involved (all 804 visited
containers were in the 10-14 census).

**The stock journal already knows where things are.** Folded town journals (16 pools + isolated) against the census: of
267 census containers holding a usable pickaxe the journal counts one in 237 (8 journal positives the census does not have;
2 counted-zero misses — the journal cannot count an iron pickaxe); of 140 stick holders, 119.

## 3. The design (simple, as the owner asked)

- `withdrawpick.mjs townSearchOrder` (pure, tested by truth table): every town container (townCobbleScan's keys: in town,
  never deep, one key per double chest), ranked: **the journal's holders first** (most of the deficit covered, then nearest
  the bot), **then the rest, nearest the bot**. A container is out when, for every need, a miss is younger than 60 min with
  no deposit into it since -- or, for STICKS only, a journal count of 0 is (review r1: the journal cannot count an iron/golden/
  diamond pickaxe, blackstone or crimson/warped planks, so a 0 says nothing about those; `NEED_COUNT_COMPLETE`). A positive
  count newer than a miss wins.
- `skills.mjs withdrawPickRun`: re-ranked after every visit from where the bot stands; up to **16 visits for the pickaxe and
  8 for the ingredients** (Paper: ~1 s a visit in a 12-chest town; no visit starts with < 15 s left). The pickaxe pass runs
  on its own clock, the order's less 40 s (`passClock`), so no part of a pickaxe visit can spend the ingredients' time. **Resumable**: every container that showed none is a miss for 60 min
  (`PICK_MISS_TTL_MS`, `INGREDIENT_MISS_TTL_MS` 15 -> 60; longer than two failed orders' cooldown + backoff), so the next order
  continues where this one stopped. **No loop on the same chest**: a container opened in a pass is out of that pass; a visit
  that could not look inside (chest_unreachable, container_blocked) leaves this bot's search for 30 min. A usable pickaxe seen
  by the ingredient pass is taken.
- townOrder's gates (`townPickMiss`, `townIngredientMiss`) now ask the SAME rule (`townSearchEmpty`: townSearchOrder has no
  candidate, with complete scan coverage), so a newer count showing a pickaxe re-opens the order as it re-opens the search
  (review r1). A deposit still ends a miss at once.
- Unchanged: the visit itself (`withdrawVisit`: the stock journal's draw claims before any click, the count after, server
  verification), lidclear-01's `clearChestLid` inside it, the model's `withdraw` verb (which the plinth's funding uses).
- The order's row gains, right after `verification=`, `town=<containers> cand=<pickaxe>,<ingredient candidates> visits=
  maxrep= vfail=` (searchTally over the WHOLE tried list -- tried= is cut at 300 characters); `_townsearch_mode` licence row
  once per spawn.

## 4. Evidence the change works

- `bots/test/townsearch.test.mjs` (18): the order by truth table; the far-chest town; journal first (one open); a later miss
  beats a stale count (with its positive control); the search resumes across orders in a 60-container town (16 + 16 + 16 + 12), every container
  exactly once, then the next order opens nothing; a walled-in journal holder is left and not walked to next order; a full
  chest holding the sticks once per order; the REFUSAL CHAIN through townOrder -> withdraw_pick -> townOrderOutcome (the town
  known empty -> no order; a deposit anywhere -> the order -> straight to the deposit); lidclear composition (the far chest's
  cobblestone lid dug, then opened); 8 anchored mutants (journal ignored, misses ignored, no fail skip, own opens not excluded,
  the ingredient pass leaves a pickaxe; a count of none not a look, farthest first, a deposit not ending a miss) — each killed
  by an AssertionError, never a crash, each with its positive control on the real code.
- Paper sandbox3 (scene `townsearch`, stock-e2e.cjs; 12 single chests, 11 near home with 5 dirt, ONE 13.9 from home with a
  stone pickaxe (damage 20) and 20 sticks; the real bot, its own town order): **base 51972f9a** opened 6 near chests, `short`,
  far chest still holds the pickaxe (RCON), licence 0. **Candidate** opened 12 in 12.7 s, `took_pick ... town=12 cand=12,-`,
  the server's bag holds the stone pickaxe, the far chest lost exactly it (sticks 20 still there), every near chest still 5
  dirt, licence 1.

## 5. The canary

Read `scripts/host/townsearchread.py` (judges the canary arm; DiD; denominators first): PRIMARY took_pick per bot-hour DiD;
not-found (short | has_ingredients) per order DiD (should fall). Liveness: canary order rows with `town=` >= 1. Arms: no
control `town=` / licence rows. Defects (revert), from the row's own counters: maxrep >= 3 (one container visited 3+ times in
an order); visits > 24. Its selftest runs on rows serialized by the real withdrawRow, one cut at 300 characters. Exposure: >= 6 canary orders with the search. Draw exposure: >= 5 "no usable pickaxe" withdraw_pick rows per pool in
24 h (10-15/16: board-a 12, hive-d 19, placebo-d 9, board-c 8, board-b 6, placebo-a 6 eligible).

Low volume is the honest limit: 2 pools ran 5-15 orders in 6 h in the dry run. Expect extension reads.
