# ironpick-01: the iron pickaxe in the toolkit (reviews and record, 2026-10-20)

OWNER 2026-10-20 ~03:20Z: "add pickaxe to toolkit". Tier 2 small fix, stacked on toolkit-03.

## Branches

| branch | base | code tip (canary sha) | use when |
|---|---|---|---|
| `ironpick-on-34d3e5e` (PRIMARY) | `tk3-on-9e7d998` @ 34d3e5e9 (toolkit-03 x cobblekeep-01) | 2d410985 | cobblekeep-01 then toolkit-03 KEPT and promoted |
| `ironpick-on-4dab47e` | `tk3-on-adbec4f` @ 4dab47e5 (toolkit-03 on adbec4f4; code = 28dc1158) | f06f27a2 | toolkit-03's adbec4f4 variant KEPT (cobblekeep-01 not) |

The second branch is the first branch's five commits cherry-picked with no conflict. Its change lines (`git diff <base> <tip>`,
+/- lines) are byte-identical to the first's. The records commit sits on top of each tip and changes docs only.

## Cause, measured

- Town chests held 2,324 iron ingots (80 to 240 per town). Source: read-only RCON census on 10.0.0.30,
  ~/chestclear3/census-goal-20261020T0015Z.json.
- Per town, counting containers within 48 of home: 2 to 8 hold at least 11 ingots (the whole kit's 7 + TOWN_IRON_KEEP 4),
  2 to 12 hold at least 7 (the pickaxe's 3 + 4).
- Only 25 of 80 bots held a usable iron pickaxe. Read dry run 10-20 (base, 6 h): 53 of 60 control bots and 13 of 20 canary-arm
  bots were ARMED, meaning no iron pickaxe above 40 uses and no usable diamond pickaxe or better.
- Why: `KIT` was the iron axe and iron shovel only, and withdraw_pick's NEED_GROUPS fetch stone/wooden pickaxes only.

## The change

- **toolkit.mjs**
  - **Kit order.** `KIT` is now iron_pickaxe (3 ingots + 2 sticks, crafted FIRST), iron_axe, iron_shovel.
  - **Need.** `ironPickNeed` is true when the bag has no iron copy above IRONPICK_TRIP_USES 40 (= withdrawpick PREFER_USES =
    oretunnel MIN_TRIP_USES, asserted equal) and no usable diamond+ copy. Per the brief, "<= 40 uses left" is replaced, so 40
    itself is replaced, one off from hasTripPickaxe's `>= 40`. No double trip follows.
  - **Switch.** `TOOLKIT_IRONPICK=on|off`, default on. Off is the base kit exactly.
- **Rules that apply only to a draw that makes the pickaxe** (an axe-and-shovel draw keeps the base rule exactly):
  - The room plan counts one slot per crafted tool (`kitRoomTakes`). The chest visit makes that room the way the draw always
    has (`decideTakes` roomTakes).
  - A credit-funded pickaxe run needs EXISTING empty slots.
  - Prefix draws, pickaxe first: when the town is a known miss for the whole kit's draw, or the bag lacks room, the order is
    for a smaller set (`kitPrefixes`, `args.n`).
  - A whole-town no_iron / no_sticks that the pickaxe's own draw can still meet ends `narrow`. It has no backoff and is capped
    with `more` (`kitNarrows`).
  - Stick hold-back is by quantity (`kitStickHeld`).
  - Draw-size misses run to 7. `kit_iron` stays the name for size 4.
- **Composition with withdraw_pick** (composter.mjs townOrder `pickDefer`, cognitive.mjs):
  - withdraw_pick steps aside only while toolkitOrder's DRY RUN would issue an order that makes the iron pickaxe now. The dry
    run keeps no state and passes every gate: switch, town, cooldown, backoff, iron not ruled out, table, room.
  - Otherwise withdraw_pick runs as before. The kit's order comes later in the same chain, after the well, prune and room
    orders.
  - Order chosen: **the kit's iron pickaxe first; the stone copy only when the kit cannot issue.** The refusal chain is tested
    through the real CognitiveLoop. With no iron in town, one kit run ends no_iron and backs off, then withdraw_pick fetches
    the stone copy.
- **The worn copy** stays in the bag; nothing tosses or wells it.
  - toolFor digs the most-worn copy of a name first, and a copy at or under FLOOR is open beside a keeper (real 1.21.8 blocks
    in the test).
  - The real town deposit (towndeposit.test) keeps the best usable copy per name and banks worst-first, so the fresh copy is
    never banked back. The worn copy can be banked as a spare by a 34+ slot deposit, which is the existing keep-one rule.
  - disposePlan lists no pickaxe.
- **Rows.**
  - Licence `_toolkit_ironpick_mode` (on=, toolkit=, trip_uses=, kit=, max_ingots=), once per spawn.
  - Change row `kit_ironpick` (outcome made best=before->after drew iron_seen keep slots), one per kit run whose needs include
    the pickaxe.
  - No new logged field: `args.n` is inside `skill.args`, which is `flattened`.

## Tests

- **npm test** (`node scripts/run-tests.mjs` from bots/): 271/271 on ironpick-on-34d3e5e (r4 93cb0e57; r4.1 2d410985 is
  test-only, and its suite passes through the runner). 270/270 on ironpick-on-4dab47e (f06f27a2).
- **bots/test/ironpick.test.mjs** covers:
  - pure decisions by worked case
  - toolFor on real blocks
  - the skill end to end in fakeworld: the 30-use scene, the town keep (6 vs 7 ingots), the full bag (room made by banking 3
    whole stacks; the base room rule as control), the drawn-down town (narrow then n=1), sticks short for the whole kit,
    credit-funded no-sticks backoff, sticks-only draw
  - the CHAIN through the real loop: no double trip; the refusal chain; control
  - WIRED structural asserts
- **10 anchored mutants** (withMutant: anchor present and unique), each kill's assertion checked with KILL_WHY=1: noDefer,
  dryCharges, noToolRoom, noChangeRow, floorLine, noPrefix, noNarrow, stickQty, creditSticks, seenAlways.
- **Adjusted suites:**
  - toolkit.test: bags hold a full iron pickaxe where the scene is about the axe and shovel; chain counts are 7 ingots.
  - kitsearch.test: draw sizes; 7-ingot chain. **Re-anchored mutant:** `noStickHoldBack`, on the hold-back line ironpick changed;
    it still removes the whole line.
  - towndeposit.test: the fresh copy stays.
- **eslint no-undef:** exactly one hit, bots/src/reflex.mjs:2384 withinBody (pre-existing).

## The read: scripts/host/ironpickread.py

- **md5:** a4f9a37287b942781efd520976c58512. `--selftest` covers every gate with a failing fixture and a passing control.
- **Defects** (REVERT, canary arm):
  - P1 made_unseen
  - P2 drawn_unserved: needs a later kit run; ends at a death; otherwise pending
  - P3 fresh_banked
  - P4 pick_welled
  - P5 keep_breached: drew > 0 only
  - P6 needless_craft
- **Reported:** holder share DiD (PRIMARY), double trips, craft frequency.
- **Gates:** LIVENESS, ARMS, INSTRUMENT. EXPOSURE is >= 3 pickaxes made, plus armed bots pre on both arms.
- **Positive controls printed:** deposit rows parsed (21 banking a pickaxe in 6 h), well_dispose rows walked (121).
- **Dry run on .31** (CANARY_DRYRUN board-a,hive-a,hive-b,placebo-a, 6 h, base): 723,837 rows; instrument ok (53 armed
  control bots, 173,548 rows with bot.tools); exposure NOT YET (0 kit rows on the base, as it must be).
- **Pre-deploy checks on .31,** against the draft registration in /tmp/ironpick-regs (nothing installed):
  - licencecheck: `_toolkit_ironpick_mode` baseline 0 rows / 6 h
  - changerowcheck: `kit_ironpick` baseline silent
  - drawexposure: all 11 drawable pools eligible

## Reviews

| round | Codex (`codex exec -s read-only`) | Claude subagent |
|---|---|---|
| r1 4ff8a2e8 | CHANGES: P1 read P2 fires on silence; P1 read P6 frequency is no defect | APPROVE WITH CHANGES: P1 iron_seen on sticks-only draws; P2 exposure counts attempts; P2 7-ingot all-or-nothing; P2 Paper; P3s |
| r2 937207d9 | CHANGES: P2 credit-only deposit room; P2 stick hold-back blocks prefixes; P2 read P2 after a death | APPROVE (6 P3s) |
| r3 acc1e018 | CHANGES: P2 credit-funded run with sticks to draw; P2 quantity hold-back changed the base rule | APPROVE (2 P3s) |
| r4 93cb0e57 | **APPROVE** | **APPROVE** (1 test P3, fixed test-only in r4.1 2d410985) |

**Accepted, named:**
- **Trip line at 40.** Per the owner's brief, 40 is replaced; hasTripPickaxe counts 40 as a trip pickaxe.
- **Hot path.** Up to 3 town-miss checks per at-town decision while every prefix is a known miss (it was 1).
- **Worn copy banked.** It may be banked as a spare by a 34+ slot town deposit (keep-one, worst-first).
- **Room is conservative.** No slot freed by a consumed stack is counted, so a bag 2 to 5 slots short gets no pickaxe order,
  and withdraw_pick keeps its turn.
- **One container per draw** (the census shows every town can give it today); drawn-down towns get the prefix.

## Paper (sandbox)

sandbox3, `sandbox/well/stock-e2e.cjs` scenes ironpick / ironpickkeep / ironpickfull (LOCK_OWNER=ironpick). The lock
/tmp/mcai-sandbox.lock on .31 was held 06:58-07:07Z. Every result is read from the WORLD: the server's bag by RCON `data get` /
`execute if items ... iron_pickaxe[minecraft:damage=0|220]`, the chest's contents, and the item entities on the arena.

**CANDIDATE 2d410985 (ironpick-on-34d3e5e):**

- **ironpick: PASS.** The bot starts with a worn iron pickaxe (damage 220 = 30 uses), the axe, the shovel, 9 sticks and a table;
  the chest holds 20 ingots + 64 sticks.
  - The server bag ends with a fresh iron pickaxe (damage 0) and the worn copy, both held.
  - The chest goes 20 -> 17 ingots; 0 items on the ground.
  - Rows: `_kit_ironpick` `outcome=crafted made=1 best=iron_pickaxe@30->iron_pickaxe@250 drew=3 iron_seen=20 keep=4`; licence
    `phase=mode on=1 ...`.
  - No `_withdraw_pick` ran (orders: _toolkit mode, _toolkit kit, _kit_ironpick): no double trip.
- **ironpickkeep: PASS.** The chest holds 6 ingots (3 + KEEP - 1).
  - `outcome=no_iron made=0 drew=0`; the chest keeps 6; no fresh pickaxe; the bag is unchanged.
- **ironpickfull: PASS.** The bag starts at 36/36: worn pickaxe, axe, sticks, table, raw copper 64, copper ingots 64, coal 64,
  29 wool.
  - The town deposit went first (34+ slots) and banked the three stacks. The kit then drew 4 and made the pickaxe AND the
    shovel.
  - The chest goes 20 -> 16 ingots; 0 items on the ground; the worn copy is still held.
  - Room here was made by the town deposit, not by the kit's own room plan, which fakeworld covers (ironpick.test FULL BAG and
    its mutant noToolRoom).

**BASE 34d3e5e9** (an export of tk3-on-9e7d998's bots/ tree), ironpick scene: **BASE_SHAPE true.**

- Over 300 s: no `_kit_ironpick`, no licence, no fresh pickaxe; the chest keeps 20.
- The base's withdraw_pick ran twice for the same worn pickaxe (`_withdraw_pick` failed x2: no stone pickaxe in this town).
  That is the trip the candidate's deferral replaces.
- Not run: the base for keep/full. Their base shape is trivially "no pickaxe", since the base kit never names one.

## Registration

- `docs/reports/ironpick-01.registration-34d3e5e9.json` (PRIMARY) and `docs/reports/ironpick-01.registration-4dab47e5.json`.
- Tier 2: `"tier": 2`, no class; read_minutes [180, 360]; a kind licence; an exposure block; change_rows kit_ironpick.
- Queue entry draft: `docs/reports/ironpick-01.queue-entry.json`. NOT applied; the coordinator queues it.
