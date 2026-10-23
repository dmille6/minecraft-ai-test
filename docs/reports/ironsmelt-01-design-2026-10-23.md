# ironsmelt-01 — the town smelt job smelts raw iron, and stops dispatching into towns it has seen empty (design, 2026-10-23; r2 after Codex + Claude r1)

OWNER 2026-10-23 ~12:40Z: "yes build now" -- the town smelt job (smeltjob-01, `smelt_town`) should smelt raw iron, not
only raw copper. Queue: after chatgate-01, ahead of bamboo-03. Base: fleet `6e1afb52` (poolescape-01 KEPT + promoted).
Branch `ironsmelt-on-6e1afb5`; stacked variants on indexsearch-01 `d4a0f424`, chatgate-01 `9d1f6d02` (on d4a0f424) and
chatgate-01 `3cc5f14d` (on 6e1afb52). Tier 2 (a small fix with strong Paper evidence).

## 1. Rows first (measured 10-23 14:15-14:45Z)

**smelt_town, 24 h, Elasticsearch** (10-22 14:15Z -> 10-23 14:15Z; 1,538,859 skill docs, 80 bots, 24.0 h). Positive
control: the runner's `smelt_town` rows 1,661 (no_effect 1,424, success 146, aborted 66, failed 25) and the skill's own
`_smelt_town` rows 1,661 -- the same population, one per job. By the job's own stop (`_smelt_town` detail `stop=`):

| stop | rows |
|---|---|
| town_has_none ("no raw copper in the bag or in the town containers looked in") | **1,359** |
| interrupted (aborted) | 101 |
| done (success) | 92 |
| search_more | 69 |
| no_fuel | 34 |
| banked_carry / error / withdraw_unsettled | 3 / 2 / 1 |

493 raw copper smelted in the day (the 92 done jobs). The 1,359 town_has_none rows are spread over 63 bots (median 22,
max 33 per bot: the 6-in-a-row pause bounds each bot) and all 13 shared pools (58-134 per pool). Their duration: 417 under
1 s, 293 under 6 s, 481 under 30 s, 168 over 30 s. They opened 1 container in 649 cases, 2 in 252, 3 in 152, up to 12.

**The towns (read-only RCON census 10-23 00:15Z, /home/mike/chestclear3/census-goal-20261023T0015Z.json on 10.0.0.30):**
in the 13 shared towns (the job is off in isolated pools) raw_iron 34-95 per town, **in 5-21 containers per town** (small
stacks), coal 72-283 per town; raw_copper 0-109 per town (4,200 fleet-wide, but 3,963 of it in the three self-isolated
worlds where the job is off). All 16 worlds: raw_iron 899, iron_ingot 1,877, coal 3,692, copper_ingot 12,019.

**The iron flow (the town index, townindex-01, its xfer records 10-23 01:10-14:20Z, ~13 h, 13 shared pools):** raw_iron
deposited into town 47 (town_deposit 23 + deposit 24), iron_ingot deposited 169, raw_copper 374, copper_ingot 305. The
toolkit made 149 iron pickaxes in 24 h (`_kit_ironpick` success 149 of 320; 3 ingots each) -- so the town's iron ingots
fall faster than bots bank them, and the raw iron the towns already hold is the largest unworked iron stock there is.
The model's own `smelt` ran 666 times in 24 h, every one of them raw_iron (287 successes of count 1): nothing smelts town
raw iron.

**Why the churn (the precise test).** The town index records what the server sent at every open of a town container, by
any skill. For each post-warm-up town_has_none job (index running >= 1 h in that pool; 823 jobs), the containers the job
opened (the index's `obs` rows by that bot, `by=withdraw`, inside the job's window) and their index state just BEFORE that
open: of 1,574 such opens, **1,322 (84%) were of a container the index already knew -- opened since its last mutation,
under 6 h old -- held no raw copper**; 188 were dirty, 59 never seen, and 5 dirty-with-copper. In 380 of the 570 jobs with
an open in the index EVERY container opened was such a known-empty one. And **466 of those 570 jobs opened a container
that held raw iron**; all 823 had a known raw-iron holder in town at their start. Positive control on the instrument: the
same test over the 44 done jobs shows the copper they took (12 opens known-with-copper, 12 dirty-with-copper), and no
done job's source chest was known-empty at its open (a rule-out never removed a container a job then took from).

So the job dispatches into containers whose emptiness of copper is already on disk -- the copper miss ("looked, none",
2 h) is written only by the job itself and is ended by ANY deposit into the container (town memory `o=took`), and bots
deposit into the same few chests all day -- while it walks past the raw iron.

**Toolkit over-make (asked):** 0 of 149 iron pickaxes made in 24 h were made by a bot holding an iron copy with more than
40 uses left (91 had 11-40, 51 had <= 10, 7 none) -- ironPickNeed's trip line holds. Bags hold 163 iron pickaxes over 80
bots (0: 5 bots, 1: 19, 2: 34, 3: 15, 4+: 7); the snapshot carries no durability, so whether the 3+ copies are spent
leftovers cannot be read from rows. Not changed here (not the same small change): reported for a follow-up.

## 2. The change

### 2.1 Raw iron is a job input, and it comes first

`SMELT_JOB_INPUTS = ['raw_iron', 'raw_copper']`, in priority order. **Iron first:** iron ingots are the input of the
toolkit's pickaxes (the production chain) and the towns' iron ingots fall daily, while copper ingots have no consumer and
the towns hold 12,019 of them. A job smelts ONE input (one furnace batch is one item), at most 8 (SMELT_JOB_BATCH, one
coal).

The job's order of business:

1. the coal precheck (base): no coal candidate in town -> no_fuel, nothing taken.
2. **the iron pass** (new): the town search for `raw_iron` -- its own 2 h miss (`_iron_miss`), SMELT_COPPER_VISITS visits,
   the copper pass's clock reserve -- taking raw iron from as many containers as it takes to reach 8 (the census: a few
   per container), and coal alongside once iron is in hand. Any raw iron in hand -> the job is an iron job.
3. no iron in hand: if the iron pass was cut with candidates left -> `search_more` (no strike; the next job continues the
   IRON search: copper never pre-empts known-unsearched iron). If the iron search is complete (no candidate left) -> the
   **copper flow exactly as the base**: the bag's own raw copper first, else the copper pass.
4. the coal pass (base) with input in hand, the smelt (base `smelt`, leased town furnace, coal only), the bank.

### 2.2 Only the town's iron is the job's

The bag's own `raw_iron` and `iron_ingot` are the bot's iron ladder (the model's `smelt raw_iron`, its own pickaxe), so an
iron job never smelts-and-banks them and the order never fires on them. Mechanism: the job takes N raw iron from town; it
smelts `min(8, N)` -- never more than the town take, so the bag's own raw iron is never fed in; at the bank it deposits **exactly what it holds above its opening count** of
each iron name (iron_ingot first, then raw_iron), with the bag's opening count held back for that one deposit call by
`swapWithdrawHold` -- the same mechanism the base uses to return unburnt town coal without banking the bag's own. The
copper flow keeps the base rule (all copper is banked: raw_copper / copper_ingot are DEPOSIT_ALWAYS).

An iron job interrupted after its take leaves town raw iron in the bag; after the withdraw hold lapses it is the bot's
own iron (a STANDING_TARGET: its town deposit banks it, or its ladder smelts it). It is never stranded and never lost;
the read's balance marks such a job `unreconciled`, as the base does.

### 2.3 The order does not dispatch into a town it has seen empty

**The index rule-out.** For each INPUT need (raw_iron, raw_copper -- not coal: unchanged), a container whose town-index
entry is KNOWN (`indexStateOf` = known: opened since its last mutation, < 6 h) and holds none of that input, with an
observation not stamped more than 60 s in the future (indexsearch-01's FUTURE_SLACK rule), is out of that need's search
and out of the order's gate. One pure function, `indexRuledOut(entries, keys, need, now)` in smeltjob.mjs; the job's
passes pre-seed their `tried` set with it and the order's gate (`townSearchEmpty` with the same `tried`) uses the same
set, so the gate and the search agree by construction (the toolkit-03 lesson: a gate that judges differently from the
sweep issues orders that open nothing).

**The gate.** `smeltTownOrder` skips `town_has_none` only when the bag holds no raw copper and no copper ingots AND the iron
search has no candidate AND the copper search has no candidate (each: every town container a live miss, index-known-empty,
out of this bot's search, or shut). Today it is the copper search alone.

**No dead end.** The gate refuses only on recorded evidence with a bounded life: a deposit into a container makes its index
entry dirty (and ends its miss and, through town memory's `o=took`, its rule-out), so it is a candidate again at once; a
rule-out lapses at 2 h (the miss's own life), a miss at 2 h. A mutation whose marks failed to write (an fs error) hides a
container for at most those 2 h -- the same exposure a miss whose took mark failed always had (r2, section 4). The bag's raw copper always dispatches. A refusal is a skip, never a refusal of the bot's other moves.
TOWNINDEX=off (index unread) leaves the base's miss-only gate.

### 2.4 Rollback, rows, licence

`IRONSMELT=off` restores the base exactly: copper the only input, no index rule-out, no iron miss (one setting, read once
at module load). A `_ironsmelt_mode` row once per spawn (a kind the base cannot write: the licence). The `_smelt_town`
row gains `in=` (raw_iron | raw_copper | -), `ruled=` (index rule-outs the passes applied) and keeps one format; `bag0`,
`withdrawn`, `smelted`, `deposited`, `bag1`, `left` and the balance verdict are in the JOB'S family (raw_iron + iron_ingot
for an iron job).

### 2.5 What is unchanged (and must stay)

Protected zones (townSearchView's zone shut), keep-out fire columns and the C12 town-job yield (`smelt_town` stays in
keepout's TOWN_JOB_SKILLS), homefix-02's declined refund (`refundDeclined`: the order's state keys are unchanged), the
runner reservation (one skill, maxMs 180 s, one budget), poolescape (no interaction), the furnace lease, coal only, the
6-in-a-row pause and the dry-job bound, the furnace drain (what it drains stays in the bag, as today).

**Coal holds:** one coal smelts 8; the 899 raw iron need ~113 coal against 3,692 in the chests (72-283 per shared town).

## 3. Expected effect and the read

Of the ~1,359 town_has_none jobs a day, every one started in a town with a known raw-iron holder: they become iron jobs
until the town raw iron (34-95 per town) is worked down, then the gate's index rule-out removes most of the copper churn
(84% of the opens). Iron ingots +up to 8 per job; the stock is ~899 raw iron plus ~90/day inflow.

The read (`ironsmeltread.py`, files, canary vs control, difference-in-differences; superseded in detail by section 4's last
bullet and section 5): primary = iron ingots the job made from town raw iron per canary bot-h (the row's bag-measured `smelted`
for `in=fe`), beside world evidence from the town index's server-sent observations; correctness gates per NAME, never a family
total: G1 a broken family balance not explained by same-family pickups (defect), G2 an iron job whose closing raw_iron or
iron_ingot is below its opening count (`fe=r0/i0>r1/i1`; it banked the bot's own iron), G3 an iron job with `fed` > `withdrawn`
(the bag fed its own raw iron: `smelted` can exceed the take when the furnace held prior input, so it is not the gate).

## 4. Review round 1 (design) and what changed (r2)

Codex r1 **CHANGE** (2 P1, 4 P2), Claude r1 **CHANGE** (1 P1, 5 P2, 4 P3). Both: iron-first is right; ownership holds if the
smelt count is capped by the town take; the existing guards are unaffected. Changes:

- **Negative evidence (Codex P1, Claude P1-1).** Measured the index's FALSE-EMPTY rate over its 13 h of records (13 shared pools,
  5,249 obs/dirty records): for every observation showing none of an input, the NEXT observation of the same container with
  NO dirty mark between showed it in **1 of 3,511 pairs for raw_copper and 0 of 1,536 for raw_iron**. Positive control: with a
  dirty mark between, raw copper appeared in 23 of 425 pairs and raw iron in 4 of 83 (deposits happen and the instrument sees
  them). The rule-out now also needs (a) the observation younger than the input's own miss life (2 h, not the index's 6 h:
  bounded re-probing), and (b) no town-memory deposit mark (`o=took`, an independent record written by the depositor) later
  than the observation + 5 s (town_deposit's verifying re-open is captured ~1 ms before its own took mark). Hosts' clocks:
  all 80 bots run on one host (10.0.0.31), so the fold's capture times share a clock; an observation stamped > 60 s ahead is
  no evidence. Mutations no bot makes (owner, hoppers): none in these towns; the 2 h bound covers them.
- **The smelt count (Codex P1, Claude P3-3).** `smelt` merges same-name input already in the furnace and the bag-measured
  `smelted` counts its ingots; so the ownership gate is on `fed` (the bag's raw iron delta across the smelt), and the count is
  `min(8, town take, bag raw above its opening count)` (`ironSmeltCount`).
- **Own iron through the WHOLE job (Codex P2).** The withdraw's room-making deposits keep raw_iron and iron_ingot (the job's
  room keep); the bank is per name (`ironBankPlan`), never a family total; the row carries the bag's own raw/ingot opening and
  closing counts (`fe=r0/i0>r1/i1`), and the read gates per name.
- **Exclusions recomputed (Codex P2).** The rule-out is recomputed at every search view (each `townSearchNext`), never
  pre-seeded into a pass's visited set.
- **Stalled iron searches (Codex P2).** An iron pass cut with candidates left ends `search_more` only if it learned something
  (else `search_stalled`, a strike), with the base's three-in-a-row backoff and dry-job bound -- and a bag that CARRIES raw
  copper smelts it that job instead (an unfinished iron search never idles copper in hand).
- **One input per job by construction (Claude P3-2).** Each pass takes only its own input (and coal once input is in hand);
  misses and `progressed` are per need.
- **Two switches (Claude P2-3).** `IRONSMELT=off` (iron as an input) and `SMELT_RULEOUT=off` (the index rule-out) apart, so a
  read can split the effect; the row's `ru=` lets the read stratify jobs by rule-out.
- **The exits that skip the bank (Claude P2-5).** `withdraw_unsettled` keeps the base (the cursor may hold items: no deposit
  is safe there); an `error` exit of an iron job now attempts the bank (best effort, inside its own try). Interrupted iron jobs
  leave town iron in the bag (it becomes the bot's own); the read counts it ("town iron left in bags").
- **The stacked variant (Codex P2, Claude P2-4).** On indexsearch-01, `indexNeed` learns `raw_iron` (min 1), so the iron pass
  opens the index's known holders first; its mode row and indexsearchread are told that smelt_town's needs are no longer
  positive-only.
- **Measurement (Codex P2, Claude P2-1, P3-4).** Shared-town stocks only: raw_iron 739, iron_ingot 1,638, coal 2,467 (13
  pools). Rates per hour on one window: the index's deposits (unverified deposit-verb xfers included) put ~13 iron ingots/h into
  the shared towns against the toolkit's ~19/h (149 pickaxes x 3 in 24 h, axes and shovels besides). The raw-iron stock is ~92
  full jobs; the inflow (47 raw iron in 13 h, ~87/day) ~11 jobs/day. So the effect has two parts, reported apart: the
  DRAWDOWN of the standing raw iron (days 1-3) and the steady-state FLOW. Gate-level churn cut, bounded: from the index alone
  (misses ignored, so a LOWER bound) 82 of 823 town_has_none jobs would not have been dispatched; the upper bound is the 380 of
  570 jobs whose every open was a known-empty container. Expected: in the drawdown, town_has_none becomes iron jobs (823 of 823
  started with a known raw-iron holder); after it, the rule-out removes between 10% and 67% of the copper churn.
- **The read (both).** World evidence = the town index's observations (server-sent contents at every open by any bot): per
  pool, the raw_iron and iron_ingot held in KNOWN containers at the window's start vs its end (DiD), beside the job's own
  bag-measured counts; deposit-verb xfers are reported as unverified. Plus: ingots per bot-h, no_effect body-seconds per
  bot-h, opens per job, unreconciled share, town iron left in bags; draws from the 13 shared pools only. The Paper e2e
  (sandbox5-8, server read-back) proves the per-name ownership and the town's raw-iron/ingot deltas before registration.

## 5. Code review round 1 and what changed (r2 code)

Codex code r1 **CHANGE** (1 P1, 2 P2, 1 P3); Claude code r1 **APPROVE** (1 P2, 5 P3). Changes:
- The withdraw's state is the caller's (Codex P1): a verified iron take followed by a throw or an abort is adopted by the job,
  so the bank, the balance and the row are the iron job's on every exit (tests: abort mid-withdraw, abort mid-smelt, error).
- A working fake furnace (Codex P2): success, a short town (5 + the bag's own 3: fed=5), prior furnace stock, abort mid-smelt,
  error -- each read from the fake's server-side counts (bots/test/ironsmelt-furnace.test.mjs).
- The read is family-aware (Codex P2): ironsmeltread.py keys on `in=fe|cu`, explains a gain by same-family pickups, gates per
  name (G2) and on `fed` (G3); smeltjobread.py is not registered for this run (it explains every gain by copper pickups).
- The row's iron fields sit right after `stop=` (Codex P3), so the logger's 300-char cap can only cut the search tallies.
- IRONSMELT=off is tested as the base in its own process (Claude P2-1: bots/test/ironsmelt-off.test.mjs).
- The iron pass keeps its own `progressed` (Claude P3-1); carried copper INGOTS also take the copper flow when the iron search is
  unfinished (P3-2); the order's reason says "raw iron left to look for" (P3-3); the mode row says `rule_out=off_noindex` with
  TOWNINDEX=off, and the rule-out is off then (P3-4); a mutant for the copper gate's rule-out (P3-5).
