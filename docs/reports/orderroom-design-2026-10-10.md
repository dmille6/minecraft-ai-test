# orderroom-01 — no craft order without room; the named remedy becomes the order

## FINAL STATE (2026-10-12 12:50Z host clock) — BUILT, BOTH ENGINES APPROVE (round 6), NOT launched, NOT queued

| fleet base | branch @ canary sha | registration | npm test |
|---|---|---|---|
| 0cdb1a8 (fleet) | or-on-0cdb1a8 @ 4825f17 | docs/reports/orderroom-01.4825f17.json | 244/244 |
| 82aef34 (gridfix-01, if kept) | or-on-82aef34 @ 8223061 | docs/reports/orderroom-01.8223061.json | 246/246 |
| 8212674 (bamboo-01 on gridfix, if kept) | or-on-8212674 @ 411aa37 | docs/reports/orderroom-01.411aa37.json | 247/247 |

Queue entry: docs/reports/orderroom-01.queue-entry.json (after bamboo-01). Read: scripts/host/orderroomread.py, installed at
~/mcai-analysis/orderroomread.py (md5 4c96f509...). Reviews: docs/reports/orderroom-reviews-2026-10-12.txt (Codex r1 CHANGE,
r2 CHANGE, r3 CHANGE, r4 CHANGE, r5 CHANGE, r6 APPROVE; Claude r1 lost to a rate limit, r2-r5 APPROVE-WITH-CHANGES, r6 APPROVE).

What changed after the r2 design below (r3-r8, each a reviewer finding): route B with a carried table simulates both the walk
and the put-down (unknown only when they disagree); route C puts the table down right before the first step that needs it;
the craft's own wear-out counts tools not tries; a pickup-only shortage is the craft's own; `home` only toward a deposit that
can run (roomExclusions) and credited only when no longer far; interruptions (runner abort or a skill-reported interrupted
walk) are free; crafts issued on an unknown room are tagged "(room via unknown)" and the wear route "(room via wear)"; the
room order's X is chosen outside the iron ladder first, and within it cheapest-first (coal before ingots).

The read (final): C1/C2/C5/C6 and a catastrophe line REVERT (defect); productive_low (Poisson expected-count test),
completion_low (room -> craft within 15 min, per episode, immature excluded), unknown_high and evidence_short (including an
undefined productivity test) block KEEP and are folded into exposure_ready. The PRIMARY, refused rung craft orders per bot-h
DiD, is REPORTED: three dry runs on identical code read +5.19, +4.78 and -2.78, so it is not a decision line.

Paper (sandbox4, 10-12, real bot, server oracle; sandbox/craft/orderroom-ab.cjs): candidate or-on-0cdb1a8 -- `far` home ->
town_deposit (chest +65) -> craft; `kept` home -> build_well (the junk well's order, first by design) -> deposit raw_iron
(chest +20) -> craft; `room` craft at once. Control 0cdb1a8 -- `far`/`kept` craft failed for no room x3 and was refused
(cooldown) x12-14 in 180 s, never crafted. Same result on 4970c91 (10-10, sandbox).

Class ORDINARY: the aim and gates are decision throughput; the slot a remedy frees is taken by the craft's output.

---


_Design r2 (19:40Z), BUILT on or-on-4970c91 (see "r2 changes"). r1 reviews: Codex CHANGE (10 findings), Claude r1 lost to an
API rate limit. The r1 text follows the r2 changes for the record; where they disagree, r2 is the design._

## r2 changes (Codex r1, finding by finding)

1. **The craft's ROUTE, not its fallback plan** — `skills.mjs craftRouteFor` mirrors craftLevel's order: (A) a recipe
   needing no table, `recipesFor(.., null)[0]`; (B) else a crafting_table within 32: `recipesFor(.., table)[0]`, walked to,
   nothing placed; (C) else `craftPlanFor` with a leading "put the carried table down" step. `craftRoomCheck` runs
   `chainPeak` over those steps.
2. **The craft's own make-room kept** — with `short <= 2` and a tool `craftRoomRemedy` would wear out (the same function
   makeCraftRoom uses, including the replaced-pickaxe case), the craft is issued (`via: 'wear'`); after the craft is refused
   for room (`inventory_full`) that route is not trusted for `ROOM_WEAR_TRUST_MS` = 10 min, so a wear that cannot find a
   cell does not loop.
3. **Pickup slot held** exactly as admitRoom holds it (`pickupNearest`); the table-retake slot is not (tableYields).
   `ok: null` (no route, unnamed ingredient, unreadable world) issues the order as before — documented limitation.
4. **The gate's memory is read before a remedy is issued** — `AdmissionControl.memoryRefuses(skill, args)`: cooldown live,
   learned failures >= 4, or the repeat window full -> that remedy kind is excluded and the next one (or the model) takes
   the turn. A pure read (tested: recent/vetoStreak/blockedCount unchanged); conservative (a probation pass is not gambled
   on); never used to admit anything. All deposits share `deposit:{}` (declared args are empty) — so this is per skill.
5. **No home loop** — `home` is named only when `farFromBank` (more than 96 from home by admission's own distance AND no
   non-deep chest within 48: exactly where deposit_not_worth_it refuses). At home a backed-off or gate-refused deposit
   gives `none`, not a home walk (mutant-tested). A home walk that made progress (`travel_incomplete`) continues; the
   admission cooldown on it is honoured by finding 4.
6. **No deterministic placement.** Codex: four sites and a height do not prove an exit stays open. The order never
   places; the craft refusal's advice may still say so. The 14% "place" cases fall to the next remedy (eat / deposit / home).
7. **Composition** — town deposit still overrides the rung (it runs first at town); wear_out and the town orders run
   before the room order. Remedies do not serve the rung, so the 45-min no-progress give-up still bounds a rung whose
   room cannot be made. Refused remedies are prevented by finding 4 rather than fed to the livelock breaker.
8. **Instruments** — the `_room_order` row is written at the OUTCOME and carries its issue-time facts (`craft`, `short`,
   `slots` before) plus the measured `slots` after, `freed`, `verdict`, the run status and `lost` (names whose count fell,
   capped 120 chars). C3 (a join) is dropped: the row carries its own room verdict. C2 is on `lost` (see read).
9. **Productive gates** added to the read (below): remedy -> craft completion, craft successes DiD, give-ups, travel.
10. **Paper control**: a standing table (route B) and a stick stack that does not empty (the control then MUST fail for
    room). **Class**: see "Class" — still ORDINARY, with the rule stated.

## The read (r2)

- LIVENESS: canary `_craft_noroom` >= 1 and `_room_order` >= 1; control 0 of each (C4, with the loop's version linkage).
- CORRECTNESS (REVERT):
  - C1 rung craft orders admitted into a bag without room: canary craft ORDERS failing `inventory_full` with "No room for"
    (pickup refusals "step away from" counted separately) — breach if >= 3 AND canary/bot-h > 0.2 x control/bot-h.
  - C2 a deposit room order whose `lost` names anything but its X, `chest` (deposit recovery may build one) and food.
  - C5 room orders refused at admission (`run=refused:`) > 10% of canary room orders (finding 4 should make it ~0).
  - C6 a `home` room order issued when the bot was within 96 of home (`farFromBank` violated) > 0.
- PRIMARY: refused rung craft orders per bot-h, DiD vs the same-length PRE window, warm (first 30 min dropped).
- PRODUCTIVE (REVERT if worse beyond the null): rung craft successes per bot-h DiD must not fall; remedy -> craft
  completion (share of `_room_order` ok rows followed by that craft's success within 15 min) reported with denominator;
  milestone no-progress give-ups per bot-h DiD; home walks failed per bot-h. Deaths: the two-death floor.
- INSTRUMENT (positive controls): control refused rung craft orders >= 1; control no-room craft failures >= 1.

## Class: ORDINARY (rule stated)

Owner D1: bag-fix = a change whose aim is to free usable bag capacity, judged on its own bag metric. orderroom's aim and
primary are decision throughput (refused/failed craft orders). Its slots freed are incidental: one remedy per blocked
craft (the 10-10 rate of no-room craft failures was ~1.0 per bot-h before repeats; distinct blocked episodes far fewer),
each followed at once by the craft's output taking a slot. Expected bag DiD well inside bagread's measured bands
(-0.8 .. -1.7 slots), so a bag-fix primary could not KEEP it. Reported: slots freed per room order and slots/bot DiD.

---

## r1 (superseded where r2 says so)


_2026-10-10, design r1. Base: fleet `4970c91`. Evidence: docs/reports/orderveto-investigation-2026-10-10.md (10-10,
80 bots, 13.5 h): 3,608 refused craft/smelt rung orders, ~90% after a craft that failed for NO ROOM; 1,124 admitted
no-room craft failures; 44 runs of >= 10 refused orders (14.8 bot-h, longest ~41 min). The failed craft names a remedy
(home-then-deposit 62%, deposit 21%, place 14%) that nothing executes; given a turn the model took it 14 of 112 times._

## The change (three parts, one variable: "the rung craft is issued only with room, and the room is made first")

### 1. readyFor asks the craft's OWN room check (skills.mjs `craftRoomCheck`, new export; workorder.mjs readyFor)

`craftRoomCheck(bot, item, count = 1)` composes exactly the functions the craft skill runs before its first execution:
- `craftPlanFor(bot, item, count, tableReady)` (the craft's plan; `tableReady` = readyFor's own `near`, carried or in
  reach) -> its steps;
- each step `roomRecipe(registry, step.recipe.ref, step.item)` x `step.crafts`, and, when a step needs a table that is
  not standing within reach but is carried, a leading "place the table" step (`consumes crafting_table x1`, no output:
  `chainPeak`'s documented shape);
- `chainPeak(bag, steps)` -> the highest occupancy the chain reaches, i.e. `craftRoom` per execution, the same
  simulation `admitRoom` runs (largest stack first, output stacking, nbt). `ok` iff `peak <= 36`; `short = peak - 36`.
- Reservations, matched to what the craft does: the table it would take back is NOT reserved (when that is the only
  missing slot the craft goes first: `rs.tableYields`); the pickup slot is NOT reserved (the craft settles a pending
  pickup itself, `settlePickup`). Both make the check never stricter than the craft.
- Ingredients the simulation cannot find, or no plan: `{ ok: null }` = unknown -> the order is issued exactly as today.

readyFor: `craftReady` additionally requires `room.ok !== false`. When the recipe is satisfiable but there is no room it
returns `noRoom: { item, short, keep }` (keep = every step's ingredients, the craft's own `protect`).

The craft's internal make-room (wear out one spent tool, up to twice) is not lost: with the craft order gone, the
EXISTING `wear_out` housekeeping order (same wearOutPlan tools, cognitive.mjs) becomes reachable and runs first.

### 2. The named remedy is the order (workorder.mjs `roomOrder`, pure; skills.mjs `roomRemedy`)

`roomRemedy(bot, items, keep)` = the craft refusal's own `slotRemedy` (craftroom.mjs roomAdvice + adviseDeposit +
the far-from-home branch), returning `{ kind, item, text }`:

| kind | order | executable from here because | frees the slot because |
|---|---|---|---|
| place | `place {item}` | `placeSites(bot)` found a site AND (new) >= 4 open sites around the bot and y >= 50: never in a 1x2 tunnel or stair, the reason craft itself refuses to place (makeCraftRoom) | `bagFill.cheapest` is a single-item stack of an inert allowlisted block, and the stack place() takes (`placeStackOf`) |
| eat | `eat` | eat refuses only at full hunger; advised only when hunger < 20 | the food is a single item |
| deposit | `deposit {item: X}` | `adviseDeposit` = admission's own `depositDue` + `bankClosed` (never names a deposit admission refuses) | `depositTarget`: X's deposit, simulated as deposit() runs it (`depositFreesSlot`), empties a stack; X is never one of the craft's ingredients; X comes from `depositPlan` = bankable only |
| home | `home` | rescue skill, never learned-avoided | none by itself: at home `depositWorthIt` holds (distHome <= 96), so the next room order is `deposit X` |
| closed / none | no order | the bank is closed / nothing can be freed | the model decides; the rung's give-up applies |

Placement in the order chain (cognitive.mjs #tick): rung order (now room-gated) -> town deposit (unchanged, first at
town) -> wear_out -> town orders (compost, withdraw_pick, build) -> **room order** -> planting -> model. So everything
that already frees slots runs before it.

**The town-deposit gap is closed by not depending on it.** At home the room order is `deposit X`, chosen by the craft's
remedy from the bankable plan — not `town_deposit`, whose 34-slot trigger and log/cobble/wanted keeps (towndeposit.mjs
93-111, 230-245) can leave the slot the craft needs. If town_deposit fires first at town and frees the slot, the
next tick's room check passes and the craft order returns; if it frees nothing, the room order follows.

**State, bounded (`roomState`, like townState):** one room order per kind at a time; after it runs, the bag is
re-read: slots fell (or `home` arrived) = success, no backoff; `home` failed with progress (`travel_incomplete`) = no
backoff (keep walking); anything else (failed, no_effect, freed nothing, refused at admission) = that kind backs off
ROOM_BACKOFF_MS = 10 min; a refusal at admission backs off 2 min. A dropped kind falls to the next one in the table's
order on the next tick (`roomAdvice` evaluated with the backed-off kinds excluded).

### 3. The prompt stops advertising the craft (prompt.mjs)

buildUserPrompt takes `noRoom`: `craftableNow` drops the item; the rung's `HINT: craft with item=X` is replaced by
`HINT: no room in the bag for X (N slot(s) short): <remedy text>`.

## Rows (new event kinds only; never a new field)

- `_craft_noroom` (no_effect): `item=X short=N slots=S kind=K target=T` — once per item per 5 min while suppressed.
- `_room_order` (success|failed|no_effect, at the OUTCOME): `kind=K item=T craft=X slots=A->B freed=F status=S lost=name:n,...`
  (`lost` = in-process bag delta, every name whose count fell).

## Class: ORDINARY

The change does not raise bag capacity: each remedy frees one slot that the craft's output fills at once (net ~0).
Its endpoint is decision throughput (refused/failed craft orders), not occupancy.

## The read (`orderroomread.py`)

- LIVENESS: canary `_craft_noroom` >= 1 and `_room_order` >= 1; control 0 of each.
- CORRECTNESS (REVERT):
  - C1 no craft without room: canary craft ORDERS that failed for no room (`inventory_full`, "No room for") — breach if
    >= 3 AND the canary rate per bot-h > 0.2 x control's. (A pickup landing between check and craft is the residual.)
  - C2 no unbankable item banked: a canary `deposit` room order whose `lost` names any item other than its X (food
    excepted: auto-eat), or an X that is not in the deposit plan's bankable view (X equals the order's item; the read
    checks lost ⊆ {X}).
  - C3 a room order issued with room: canary `_room_order` rows whose bag had room for the craft (re-checked from the
    `_craft_noroom` row it followed within 60 s; none = orphan) — breach > 0.
  - C4 arms: control `_craft_noroom`/`_room_order` rows > 0.
- PRIMARY (registered): refused craft orders per bot-h, DiD (canary vs control, post vs same-length pre), warm window
  (first 30 min dropped). Expected strongly negative.
- SECONDARY / tripwires: admitted no-room craft failures per bot-h DiD; executed decisions per bot-h DiD; slots freed
  per room order; craft successes after a room order within 10 min; home walks failed; deaths (two-death floor);
  rung residence / no-progress give-ups DiD; items per bot-h (immobiledid).
- INSTRUMENT (positive controls): control refused craft orders >= 1; control no-room craft failures >= 1.
- draw_exposure: pools with >= 3 no-room craft failures in 12 h (57 of 80 bots had refused orders on 10-10).

## Paper proof (sandbox, RCON lock as other agents)

Two bots on the same seed, each with a 36-slot bag (one single `andesite` / or the bankable oak_log stacks), a
craft-ready stone_pickaxe rung (cobblestone, sticks, a carried table): canary build -> issues no craft, runs the room
order (place / home->deposit to a town chest), then crafts; control build -> the craft order fails for no room and is
refused on the following decisions. Evidence: `_craft_noroom`, `_room_order`, the craft row, RCON `data get` of the
chest / block placed.

## Variants

4970c91 (fleet), 6f1921a (peacefulkit; touches composter/foodskip/skills.mjs), 0cdb1a8 (jw-on-6f1921a) because this
reads deposit advice in skills.mjs.
