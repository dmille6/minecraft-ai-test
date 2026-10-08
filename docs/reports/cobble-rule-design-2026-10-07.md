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

### The 256 per town -- THE TOWN COBBLE CAP (owner 10-07, delegated to the operator + Codex; built into stonecap-01)

The 10-07 decision (docs/reports/cobblecap-bamboocraft-decision-codex-2026-10-07.txt) made the 256 a hard cap, built
before the canary. Codex's rule, as built (bots/src/cobblecap.mjs, skills.mjs):

- **Counted, never estimated.** A bot that opens a town container (deposit, withdraw, town deposit, reconciliation)
  appends that container's cobble + deepslate count from the open window, with its capture time. Per container the
  latest capture wins, a tie the larger count. The town total is the sum of the fresh counts (6 h). The mayor's estimate
  is not used.
- **Whole stacks, under the cap, above the bot's 64.** Every stack is admitted by a CLAIM, checked against the counted
  total plus every live claim (the bot's own earlier stacks in a batch included). `cobbleAdmit`: `at_cap` when what is
  known plus what is on its way reaches 256, or when this stack would pass it on a complete count; `unknown` when a town
  container has no fresh count (or the scan did not cover the town) and the known part is below 256 -- "currently below
  256" on a partial count is never enough.
- **Unknown is reconciled before depositing.** A deposit in town whose smallest surplus stack the cap cannot judge first
  opens up to 3 uncounted town containers and counts them (`_cobble_reconcile`). Admission admits that deposit (the one
  empty plan a deposit can change) only in town (`inTown`) and only if an uncounted container is outside its 10 min
  backoff. A container that cannot be counted (lid blocked, unreachable, unopenable, count not written) is backed off and
  named in the refusal. Out of town the refusal names the remedy ("a deposit at town counts the town's chests first").
- **At the ceiling the surplus stays in the bag** -- no new chest, no toss. Only in the variants built on junkwell-02
  (`sc-on-<jw sha>`, used only if junkwell-02 is KEPT) do whole stacks above the 64 go down the well while the town is
  PROVEN at the cap (`cobbleWellCap === 'at_cap'`, re-read at the first cobble click; whole planned stack; >= 64 left).
- **A container outside town never takes cobble** (the cap is the town's); a cobble-only plan targets town containers and
  walks home when none is in reach.

THE JOURNAL (after Codex rounds 1-7 and Claude rounds 1-4; both engines approved): no lock. One append-only file per town
(`<pool state dir>/<townKey>.cobble.jsonl`); each record one line, written by one append that begins with a newline (a
writer that died mid-line can never swallow the next record). Every reader folds the same order, so a claim is decided
at its own place and every reader agrees (8-process race, 20-25 trials, clock skew +-5 s: worst total 254, 0 overshoots,
0 disagreements). A count and the releases it includes share one line; a count that releases a claim on its own
container, or resolves a void of it, replaces the standing count whatever the clocks say. An admitted claim never
expires by time (a clock cannot fence a paused transfer): it is reserved until its release, or until the bot's NEXT
connection voids it -- a reconnect is a new connection (`<process start ms>-<pid>-<rand>-c<n>`); the void, written at the
first read after login, fences every later record of that bot from any older connection, and an older connection's void
is ignored. A window that is no longer the bot's, or a connection that has ended, writes no count: its releases mark the
container unknown until recounted. A checkpoint of the fold's own state (atomic rename, every 256 KB folded) keeps each
read linear (8 MB: 66 ms cold, 0.2 ms after); more than 32 MB to fold fails closed (unknown).

Residuals (classified by Codex, accepted): the interval between a silent disconnect and the client's first sign of it;
an OS-frozen process across checks; operator deletion or disk corruption of the journal; cross-process ordering assumes
process start times follow login order. Fail-closed costs (Claude): a removed bot's live claims stay reserved for good (the
read lists live claims older than 1 h by bot); the journal is not rotated (needed before fleet-wide promotion).

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
- THE CAP (10-07 evening, owner-delegated): Codex rounds 1-7 CHANGE, round 8 APPROVE; Claude rounds 1-3 CHANGE, round 4 and the
  final delta APPROVE (see "The 256 per town" above for what each round changed). Mutants (scripts/mutants/mutants-canaries-1007.py
  cobble): 65/65 killed on sc-on-c6e91a8 @ 06e2964, 67/67 on sc-on-92bc84f @ 971fb09. Paper sandbox (sandbox/craft/cobble-cap-ab.cjs):
  town 250 -> no cobble moved (control 314); 100 -> exactly the 30 (130; control 164); double chest and deepslate as 100; an
  unopened barrel reconciled then used; a chest outside town got logs only; `deposit cobblestone` at 250 refused at admission; a
  reconnect voided the previous process's claim, recounted and banked (160); the 92bc84f town deposit at 220 banked exactly one
  stack (control 270). The well coupling (sc-on-<jw sha>): Codex r1-r2 CHANGE, r3 APPROVE; Claude APPROVE.
