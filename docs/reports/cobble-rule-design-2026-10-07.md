# The cobble rule (stonecap-01): design, 2026-10-07

Status: built on `sc-on-c6e91a8` (c238c3d) / `sc-on-92bc84f` (b2dee1a), both engines APPROVE, sandbox-proven, registered (stonecap-01), **not launched**.

## The owner's decision

10-04 ~18:10Z (STATE.md): *"cobble: keep 256/town reserve, bank only when it frees a slot (both-engine no-ledger design)"*.
The order of 10-07 restates it: keep 256 cobblestone per town; a bot banks cobblestone only when doing so frees a slot;
bots need some cobble for scaffolding and pillaring, so never bank below the reserve the scaffold/escape code relies on.

## What already existed

`docs/reports/nojunk-design-2026-10-04.md` (stonecap-01, both engines) and its SYNTHESIS (10-04 07:30Z):
both engines **dropped the per-town 256 ledger** (lost updates in the unlocked town file, per-bot town directories on the
isolated pools, an old observation is not a current lower bound) and agreed that *cobblestone and cobbled deepslate enter
storage only when that cobble transfer itself empties a bag slot*. Required for correctness: no partial transfer that
banks cobble without freeing the slot; no relief-driven chest craft or bank closure; per-name confirmed-transfer rows; no
loop for `deposit_surplus` or craftroom advice. This design builds exactly that, plus the personal reserve.

## Measured (fleet, 30 h to 10-07 17:52Z, 80 bots, `cobblemeasure.py`)

| | |
|---|---|
| deposit runs that lowered the bot's cobble + deepslate | 299 (town deposit canary 10) |
| cobble banked | 10,997 |
| runs whose banked amount was not a whole multiple of 64 (a partial stack, freeing no slot) | 216 of 299 |
| runs that left the bot under 64 cobble + deepslate | 238 of 299 |
| cobble the 64 reserve would have kept | 6,350 of 10,997 |
| bag census 10-07 17:00Z | cobble 133 slots, 6,324 pieces in 69 bags |

Positive control: the same walk saw 646,714 rows and 1,640 deposit rows from all 80 bots. The window contains the
10-07 05:01-11:53Z outage (both arms; a rate, not a DiD).

## The reserve the escape code relies on

| consumer | what it needs |
|---|---|
| `exit-contract.mjs canContinueDescent` | debt + max(min(8, debt), debt/4) scaffold blocks: a descent to y 16 (iron) needs 59 |
| `reflex.mjs` pillar (`PILLAR_MAX_BLOCKS` 24), `scaffoldPrereq` | up to 24 to pillar out; asks for 8 when trapped |
| `bankable.mjs scaffoldKeep` (today) | 8 of the cheapest scaffold |
| `milestones.mjs` stockpile_stone (`STOCKPILE_MAX`) | at most 64 of the stone family |
| `towndeposit.mjs` (92bc84f) | keeps 64 of the stone family, cobble first |
| `well.mjs STONE_GUARD` (junkwell-02) | keeps 64 reserve stone |

**COBBLE_RESERVE = 64** cobblestone + cobbled deepslate: above the iron-depth exit contract (59), equal to the stockpile
rung's ceiling, the town deposit's keep and the well's guard -- one number in four places -- and exactly one slot.

## The rule (bots/src/bankable.mjs, one allowance for every caller)

`cobbleBankStacks(items)`: the cobble stacks that may be banked are WHOLE stacks, **smallest first** (count, then slot),
each taken only while the bag keeps COBBLE_RESERVE of the two names together and the name stays within creditCap (64).
`bankableInventory` (and so `depositPlan`, `bankableExclusion`, admission's `depositDue`, the prompt's CARRYING line,
`deposit_surplus`, withdraw's room plan, craftroom's advice) counts exactly those stacks; nothing else of cobble is
bankable. A bag with no such stack is refused with the new rule `cobble_reserve` ("cobble reserve", no digits).

The transfer (`skills.mjs deposit`) moves each chosen stack with **mineflayer's own `transfer()`** -- the function
`chest.deposit` calls -- with its source range narrowed to that one window slot (round 1, both reviews: no new click
path; the actuator, its `destination full` error, the window-gained accounting and the cursor rescue are the deposit's
existing ones). A stack is started only when the container has room for all of it (`cobbleRoom`: empty container slots
plus same-name partial stacks). After the close, one `_cobble_bank` row per cobble name the plan named, from the server's
recount (`name= planned= tried= moved= kept= src= reserve= no_room=`). `craftroom.mjs depositFreesSlot` walks cobble in the
same smallest-first order, so the advice and the transfer agree.

**Cobble never grows the bank** (the 10-04 SYNTHESIS; both reviews round 1): when everything a deposit could not place
was cobble, the deposit ends `no_effect` -- no chest-full recovery, no new chest, no bank closure; the town-memory shortcut
and `viaRecovery` skip the recovery for a cobble-only plan. **No empty-plan walk**: `depositDue` is false with nothing
bankable (it was true at 30+ slots, and the prompt printed "0 items worth banking ... Use deposit"), and admission refuses
an empty requested plan before the walk (`deposit_nothing_to_bank`, naming the rule).

Examples (stacks -> banked): [64, 30] -> the 30 (keeps 64); [64, 10] -> the 10; [50] -> nothing; [64, 64, 64] -> one 64
(creditCap); [40 cobble, 40 + 64 deepslate] -> 40 cobble and 40 deepslate (keeps 64).

### The 256 per town

Not a code cap. Both engines rejected a town ledger on 10-04, and the owner's own phrase was "(both-engine no-ledger
design)". The towns hold far more than 256 today (the 10-04 clear left 256 of cobble per town and banking has continued
since), nothing but withdraw's 3-per-pickaxe takes cobble out, and a future clear must keep 256. If the owner wants a
**hard cap** (stop banking cobble while a town holds >= 256), that needs evidence of the town's total -- a ledger or a
same-visit count of the containers opened -- and is a separate change. **Owner decision.**

## Remedy check (CLAUDE.md)

- A refused cobble deposit is not a new dead end: the refused amounts are partial stacks, which never freed a slot, and
  cobble under 64, which the escape code needs. Cobble still leaves bags through scaffold (~12k/day), crafting, and
  whole-stack banking above 64; the junk well, compost and bamboo free other slots.
- `deposit_surplus` (`bankableInventory(...).count < 4`) is satisfied when only reserve/partial cobble remains, so no rung
  loops on it; `depositNoopReason` names the rule.
- Chest-full recovery is never entered for a policy refusal (an empty plan starts no recovery); a container with no room
  for a whole stack counts the stack eligible and moved 0, which is the existing "chest is full" path.
- Composition with the town deposit (92bc84f): its allowance comes from `depositPlan`, its own plan already banks whole
  stacks smallest first and keeps 64 of the stone family, so the two agree.

## Prior art (open source, issues, forums; searched 10-07)

No project found keeps a counted cobblestone reserve:
- mineflayer-pathfinder (`lib/movements.js`): scaffolding defaults to dirt and cobblestone; it plans with the blocks in
  hand and resets with `no_scaffolding_blocks` when they run out (index.js).
- Baritone (`Settings.java` `acceptableThrowawayItems`; `CalculationContext.hasThrowaway`): a yes/no check, no count.
- mindcraft (`src/agent/library/skills.js` putInChest/discard): deposits what the model names, no reserve.
- Voyager (`curriculum.py`): at 33+ slots it deposits "useless items" (cobblestone among them) to reach 20 slots;
  it never needs a reserve because it teleports out of stuck spots.
- mineflayer-collectblock (`src/Inventory.ts`): empties the bag only at 0 free slots, whole stacks.
- AE2 level emitters: the closest analogue to "keep N in storage", overflow by priority.
Pitfalls taken from them: mineflayer's `deposit(type, null, n)` takes the FIRST matching slot (so the transfer narrows
`transfer()`'s source range to the chosen slot, smallest first); a missing count deposits one (counts are always whole
stacks); `destination full` leaves the cursor loaded (the deposit's cursor rescue covers the narrowed transfer too); the chest fills partial stacks first (room counts them); scaffold reserve must count cobbled deepslate
(baritone issue 4217); banking shrinks the next path's block budget silently (the reserve is the guard).
Issues: baritone #309, #3019, #4217; mineflayer-pathfinder PR #371, #296; mineflayer #2020.

## Canary stonecap-01

One variable: the cobble rule. Variants `sc-on-c6e91a8` and `sc-on-92bc84f` (the town deposit underneath).
Licence: `_cobble_bank` rows (this build only). Gates (defects, REVERT): C1 a `_cobble_bank` row with kept < 64 that
moved cobble (the reserve breached); C2 a moved amount that is not whole stacks (moved != the sum of the clicked stacks
it reports). Reported: cobble banked per bot-hour DiD (expected: down, ~58% of today's inflow was below the reserve or
partial), cobble slots per bag DiD, share of bots at >= 34 slots DiD (TRIPWIRE: a rise means the reserve costs bag
space), `deposit` no_effect rate. Read: `scripts/host/stonecapread.py`. Exposure: >= 20 canary deposit runs by bots
holding cobble (the rule is evaluated on every one) and the control's positive control (control deposit runs that lowered
cobble). Measured in a 3 h dry run 10-07 15:00-18:00Z (canary = hive-a,board-c as c6e91a8): 52 canary runs holding
cobble on 10 bots (READY), 71 control runs lowered cobble, **62 of those 71 ended under 64** -- the behaviour the rule
removes, so the canary's own count of runs ending under 64 is a direct, powered effect measure (expected ~0, scaffold
placed on the walk aside). The identical-code DiD of cobble banked per bot-hour in that dry run was +8.9: reported, never
gated.

## Reviews

- Round 1 (10-07): Codex CHANGE -- P1 the shift-click transfer was neither guarded nor server-confirmed; P2 cobble relief
  could still build a chest or close the bank; P2 empty plans still advised and walked; P2 the rows could not support the
  gates; P2 exposure arithmetic (0.125/bot-h, not 1.25). Independent Claude APPROVE-WITH-CHANGES -- P1 cobble alone built a
  chest (probe); P2 the client's shift-click prediction skips the chest's last slot (probe); P2 empty-plan walk (probe); P2
  gates; P2 exposure. Both: 64 is a defensible floor; "256 = the clear's reserve, no cap" is an honest reading.
- Fix 2fd827c (all of the above). Round 2: Codex APPROVE-WITH-CHANGES (cap the success path's credited gain at the
  stack) and Claude APPROVE-WITH-CHANGES (before= on the row; rows by src) -> c238c3d. Round 3: Claude APPROVE; Codex
  APPROVE-WITH-CHANGES on the read (the balance tripwire grouped deposits wrongly) -> fixed -> round 4 Codex APPROVE.
- Paper sandbox (10-07, sandbox/craft/cobble-ab.cjs): [64,30] -> the 30 banked, 64 kept in one slot (control banked the 64);
  [50] -> no cobble (control banked 42 to its old 8); a chest with room for 14 -> nothing moved, no chest, no recovery
  (control part-filled +14). Craftsync's recount after real transfers reports src=skipped, so C1 judges the client bag,
  which matched the server's read-back in every trial.
