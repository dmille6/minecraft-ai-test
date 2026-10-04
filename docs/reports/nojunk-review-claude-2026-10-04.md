# No-junk design: independent Claude review (10-04)

Reviewed `nojunk-design.md` and its supporting outputs, with the code checked at `origin/wd-on-6c9a8fb` (515d99c) in a
read-only detached worktree. I re-ran the telemetry read-only on 10.0.0.31 (`nojunk-rv.py` and `nojunk-rv2.py` →
`nojunk-rv.out` and `nojunk-rv2-full.out`).

The read was rotation-aware, deduplicated per bot, and streamed per bot. Window: 10-02 06:40Z → 10-04 06:40Z (48 h),
with the last 24 h reported separately. It walked **2,307,566 rows from 80 bots in 16 towns**: the 20
`self-isolated-*` bots were regrouped into their 4 worlds. There were 4,012 deposit rows. No RCON, no world access,
no commits.

## Verdict: CHANGE

The never-bank list (§2a) is sound and costs nothing. The logs and planks decision (§2b) is right.

The cobble cap (§2c and §4) has four problems:
- Its central premise ("cobble banking is bag relief") does not survive a slot-level check.
- The relief valve as written puts back about 23% of the leak while relieving almost nothing.
- The "lower bound" ledger has failure modes that inflate the count, which the design does not acknowledge.
- On a 5-bot town, the canary cannot measure its effect or its risk in 180 or 360 minutes.

None of this is fatal. Every item below has a concrete fix.

---

## Code claims: verified

Every file:line citation in §1a, §1d, §2c and §2d matches 515d99c, to within ±3 lines. Specifically:
- `bankable.mjs` 29-38, 81-100, 130, 143-204 (spent-tool rule at 179, creditCap at 199), and 240-283.
- `skills.mjs` deposit: 2522/2529 (recovery eligibility = plan), 2629 (plan after open), 2632-2648 (tools by slot),
  2698-2717 (no_effect + depositNoopReason), 2736 (recovery only when eligible > 0 and moved = 0), 2759 inChest,
  and 2763 chestPartner.
- settleCursor at 5843-5880, which puts a cursor stack into the container (test R1.1 at
  `withdraw-pick.test.mjs:256`), and the withdraw contents snapshot at 6045.
- `admission.mjs` 336-370, `prompt.mjs` ~604, `milestones.mjs` 792-815, `withdrawpick.mjs` 117-131 (roomCandidates
  keeps cobble through INGREDIENT_KEEP), and `craftroom.mjs` 290 (depositFreesSlot) and 354-371.
- `chestfull.mjs` 189-281 (town memory) and 527-545 (returnCursor), `hygiene.mjs` 21 and 47, `composter.mjs` 67,
  `scaffold.mjs` 109.
- mineflayer-pathfinder `movements.js:76-77`: dirt and cobblestone are the default scaffold blocks.

Two code facts the design leans on without stating, both of which bite the build (findings 4 and 5):
- `recordOutcome` rebuilds the whole entry: `{o, at, strikes}`.
- `townDir()` is `poolStateDir(config.memory.pool)`.

---

## Findings

### 1. "64.6% of banked cobble is bag relief" is a correlation with admission, not relief. Almost no cobble deposit frees a slot.

The 60–65% band is confirmed:
- 24 h, ≥34 slots: 62.0% (upper) and 60.5% (lower bound, defined in finding 8).
- 48 h: 62.8% and 61.3%.
- Denominators: 7,130 and 6,208 cobble in 24 h.

The band reflects who gets admitted, not what the deposit relieves. `depositDue` (`bankable.mjs:235`) admits any bot at
≥30 occupied slots with storage in reach, whatever its bankable count. And 56–64 of 80 bots sit at ≥34 slots.

The cobble in a typical run is a partial amount above the 8-block reserve: per cobble-banking run, median 24, p25 9,
p75 54 (n=202 in 24 h).

I simulated the relief at the slot level for every ≥34 cobble-banking run in the last 24 h (denominator: 3,754 cobble
across 133 runs):

| case | cobble | share | runs |
|---|---|---|---|
| another plan entry frees a slot → cap refuses | 2,309 | 61.5% | 46 |
| no other entry frees a slot, **and the relief stack frees none either** → admitted as written | 1,326 | 35.3% | 85 |
| no other entry frees a slot, and the relief stack frees one → relief admits | 119 | 3.2% | **2** |

The 48 h figures are the same shape: 57.2% / 38.7% / 4.1%, with only 5 runs in the relief-frees-a-slot case.

**So cobble was the only thing that freed a slot in about 2 deposit runs a day, fleet-wide.** Refusing cobble at deposit
time creates essentially no immediate dead end.

The real risk is slower and is not what the design guards. The refused cobble is about 60–76 per bot per day: 77–98%
of 6,208 a day, over 80 bots. That is roughly one slot per bot per day accruing in bags, offset by however much more
scaffold and craft use a bigger stack gets. Nobody knows that offset. See finding 6.

*Caveat:* slots are estimated from per-name totals (scoreboard.py's estimator). Fragmented stacks would make a few more
deposits free a slot, so the 3.2% is a lower bound. It is not plausibly 64.6%.

**Fix:** drop the premise from the design and the STATE line. Re-state the risk as accumulation per bot-day.

### 2. The relief valve as written re-opens the leak (attack b): about 23% of cobble, freeing nothing.

"One whole stack beyond the scaffold reserve, at ≥34 slots, when no other entry frees a slot" is identical to today's
behaviour whenever it fires. Today already banks `min(n−8, 64)` per run (creditCap 64), so the relief admits exactly
what the cap meant to refuse. And ≥34 is the fleet's normal state, not an edge case.

Measured on the as-written rule, the cap refuses about 77% of cobble (4,763 of 6,208 in 24 h) and the relief admits
about 23% (1,445). Of that 23%, 92% freed no slot (1,326 of 1,445). With 1 stack of 64, banking 56 leaves 8 in the slot.

**Fix:** relief admits cobble only when `depositFreesSlot(items, [{cobblestone, amount}])` is true for the relief amount
itself. That amount is the smallest whole stack that leaves completely; it is not "one stack beyond reserve".
- Measured: this admits 119 cobble a day in about 2 runs, about 2% of current cobble inflow.
- G2 should assert `depositFreesSlot` on every relief row, not just ≥34 slots.
- Reuse craftroom's predicate, so craftroom's `depositTarget` and the relief agree. Today craftroom already requires a
  stack to empty; the relief as written does not.

### 3. Relief can drive chest expansion: junk into new chests (attack c).

G4 covers cap *refusals*: eligible = 0 → no_effect. A relief stack, though, is eligible. A relief deposit into a full
chest takes `skills.mjs:2736` → `fullChestRecovery`, which can craft and place a new chest (budget 4/day/town) to hold
cobble the policy calls junk. `viaRecovery` at 2522/2529 does the same from a pre-open plan.

**Fix:** relief goes into existing room only. A relief-only plan meeting a full chest ends as no_effect with its own
phrase, never as recovery. Gate G4 must include relief rows.

### 4. The "lower bound" is not a lower bound, and the design's race claim is backwards (attack a).

The ledger sums last-seen counts. That sum is a lower bound only if contents never fall between observations. Ways it
over-counts, which makes a refusal wrong:

- **(a) Lost writes resurrect stale highs.** `updateTownMemory` is read-modify-write over the whole file
  (`chestfull.mjs:241-252`). Take a withdraw that writes X: 200 while another bot writes from a read taken earlier: the
  file goes back to X: 300, still inside the TTL. The design's line "a lost write only lowers the bound" holds only for
  a container's *first* observation.
- **(b) Removals the bots do not see**, such as an exploded or broken chest, or **the admin clear itself**. Every
  pre-clear count stays "fresh" for up to 6 h. After promotion and the clear, every town refuses cobble against empty
  chests for up to 6 h.

  **The clear runbook must invalidate the `stock` entries**, for example by bumping a ledger epoch. This is a file
  operation, not a world edit.
- **(c) Double chests.** `chestPartner` returns null on any failure (`skills.mjs:2763-2772`, a try/catch). A 54-slot
  window recorded at whichever half was opened, then later opened from the other half, is counted twice.

  **Fix:** when `meta.double` is true and the partner cannot be validated, record nothing.
- **(d) `recordOutcome` drops unknown fields.** It returns `{o, at, strikes}` (`chestfull.mjs:218-230`). The deposit's
  own `rememberTown(..., 'took')` at 2684, and every full, unknown or unavailable write, would erase a `stock` field
  stored in the entry.

  **Fix:** use a sidecar key, as `_pick_miss` already does (check that every iteration over entries skips `_`-keys), or
  carry the field explicitly. Write a mutant test that kills it.
- **(e) The cache.** The design relies on the open's write being visible to the plan at 2629. The room reader caches
  for 30 s (`skills.mjs:2777-2793`). If `townStoneRoom()` copies that pattern, the plan reads a stale bound.

  **Fix:** pass the just-opened container's fresh count to the plan directly, and use the ledger only for the
  *other* containers.

The other half of attack (a), whether a bot can **never refuse**: yes, if nothing within the TTL sums to 256. That fails
toward banking, which is acceptable. With 1.4k–8.2k per town (not re-verified: that needs RCON), it will refuse almost
immediately.

Today, (a) through (c) are harmless because stock is far above 256. They matter exactly where the cap is supposed to
work: near 256, after the clear. The canary never exercises that regime (finding 7).

### 5. "Town" is a single bot in 4 of 16 towns.

`townDir() = poolStateDir(config.memory.pool)`, and `generate-roster.py:192` sets `MEMORY_POOL = self-<bot>` for the
isolated arm. Telemetry confirms 20 single-bot pools.

For those 20 bots, the "town ledger" (and today's full/took memory) is per bot. Each bot's bound counts only its own
opens. The cap is still evidence-only, but "256 per town" becomes "per bot's view". It refuses later, and for five bots
it sums the same chests independently.

**Fix:** state this, and either key the stock ledger by world (`homeTownKey` under a world-scoped directory) or accept
it explicitly.

Related: §4 says "5 bots chosen at random, which is one town". Those are two different designs. The cap is
town-level, so the unit has to be a whole town, drawn at random from the 16. An isolated-arm town cannot be named by a
single `canary_pool` literal.

### 6. stonecap-01 cannot read its effect or its risk in 180 or 360 minutes (attack e).

**Exposure.** Grouped by town, 48 h:
- 409 cobble-banking runs over 80 bots × 48 h = **0.107 runs per bot-hour**, or about 3.2 per 5-bot town per 6 h.
- **49 of 128 town-6h buckets banked zero cobble.** Cobble per bot-hour: mean 3.20, median 1.47.

Expected cap refusals:
- As written: 57% of cobble-banking runs (115 of 202) → **about 0.06 per bot-hour**, about 1.8 per town in 360 min
  and about 0.9 at +180.
- With the relief fixed as in finding 2: about 0.105 per bot-hour, about 3.2 per town in 360 min.

G1 and G2 would be judged on 1 to 3 events.

**Effect versus noise.** Null DiD, from the same metric over real towns and adjacent windows:

| window | draws | p5 | p25 | median | p75 | p95 |
|---|---|---|---|---|---|---|
| 6h vs 6h | 112 | −6.75 | −1.42 | 0.32 | 0.89 | 7.54 |
| 12h vs 12h | 80 | −8.37 | −1.69 | 0.00 | 1.24 | 9.33 |

The expected effect is about −0.77 × 3.2 = **−2.5 cobble per bot-hour**, which sits between the null's p5 and p25. A
one-sided 5% read detects it roughly 1 time in 10. INCONCLUSIVE is the likely close, so plan for it.

**Risk tripwire.** The bag risk is about one slot per bot per day (finding 1), about 0.25 slot per bot in 360 min. The
full-bag tripwire cannot move within the canary. **A KEEP at +360 would carry no evidence about the one risk Codex
raised.**

**Fix:** make the canary a **mechanism canary**:
- deterministic gates G1–G5, with the per-name instrument from finding 8
- a non-zero refusal count as the exposure gate (INCONCLUSIVE if fewer than about 3 refusals)

Before fleet promotion, add a **multi-day bag check on the canary town**, at 48–72 h: cobble slots per bag and the
full-bag share, by DiD. "Cobble banked per bot-hour" becomes descriptive, not the verdict. And state the denominator:
"N refusals in M canary bot-hours".

### 7. The canary tests "never bank cobble", not "cap at 256".

The canary town holds 1.4k–8.2k and the clear is deferred until after KEEP. So the bound passes 256 on the first open
and stays there. The read sees a flat refusal plus relief.

What the 256 machinery adds runs only after the clear, fleet-wide, unread:
- the ledger near the threshold
- allow/refuse toggling
- withdraw drawing the reserve down
- stale-after-clear (finding 4b)

**Fix:** either:
- A sandbox scenario at the threshold before build sign-off: a stock of 250 → bank → 256 → refuse → withdraw 3 →
  allow; a double chest; a lost write. Plus a post-clear read with its own gates.
- Or consider the simpler variant in finding 10.

### 8. The instrument counts walk scaffold as "banked".

Deposit rows' `inventory_delta` includes blocks placed on the walk home. In 24 h, cobble leaving bags in deposit rows
was 7,130, but only **6,208 at most** can have been banked. That lower bound subtracts each run's excess over
"deposited N". So at least 13% of what deposit rows lose is not banked. 246 of 570 item-moving runs carry no "deposited N" at all (recovery and
travel details).

The design's G2 ("cobble banked ≤ relief rows × 64") and its effect metric would both read scaffold as banking.

**Fix:** deposit logs moved-per-name, `{cobblestone: k, ...}`, in a structured field. This is part of the variant's
logging, not a behaviour change.

The same applies to G1's "observed ≥ 256". The `deposit-truth` rule forbids digits in the detail, so the evidence needs
its own row or field (e.g. a `town_cap` row with `observed`, `containers`, `oldest_at`), logged only from the execution
path, never from the pure prompt, milestone or admission calls.

### 9. Never-bank list: zero new bag load, confirmed, with a positive control (attack d), but its definition pre-empts owner decision 3.

**Positive control.** In 48 h of item-moving deposit runs, each junk item was **present in the bag before the run** and
did not leave, beyond what the walk explains. Below, "left beyond walk" counts runs where more of the item left than the
run's excess over "deposited N" can account for; 0 means every departure fits walk-home scaffold.

| item | runs it was held | runs it left | left beyond walk |
|---|---|---|---|
| flint | 1,147 | 0 | 0 |
| wheat_seeds | 1,079 | 0 | 0 |
| oak_sapling | 1,049 | 0 | 0 |
| leaf_litter | 998 | 0 | 0 |
| egg | 947 | 0 | 0 |
| ink_sac | 673 | 0 | 0 |
| brown_egg | 640 | 0 | 0 |
| pointed_dripstone | 614 | 0 | 0 |
| bamboo | 368 | 0 | 0 |
| sand | 248 | 1 | 0 |
| gravel | 220 | 1 | 0 |
| andesite | 199 | 5 | 0 |
| diorite | 201 | 4 | 0 |
| granite | 155 | 1 | 0 |
| dirt | 430 | 218 | **2** |

The same query finds 12,288 cobble, and wood and ore leaving. So the 0s are the code refusing, not a blind query. The
list moves essentially nothing into bags.

**But** §2a defines plant litter as `NEVER_KEEP ∪ compostables ∪ kelp ∪ flowers`, and `NEVER_KEEP`
(`hygiene.mjs:21-25`) **contains flint, ink_sac, glow_ink_sac, egg, brown_egg, blue_egg and rail.** As written, the
list classifies the "unused drops" as never-bank, which §2a and owner decision 3 say is still the owner's call.

**Fix:** enumerate BANK_NEVER literally, without unions. Put the drops in only after decision 3.

Also state that the list **overrides `wants`** (that is its only effect). The cap also needs to say whether it
overrides `wants`: a stone-pickaxe rung's wants include cobblestone (`cognitive.mjs:655-694`), so an un-overridden cap
leaks through wants.

### 10. A simpler variant worth putting to the owner: no ledger.

Finding 1 shows that cobble deposits almost never relieve a slot. That allows a variant with **no persistent state**:
- Remove cobblestone and cobbled_deepslate from `STANDING_TARGETS` and from wants-driven banking.
- Bank them only as a slot-freeing relief (finding 2's rule).

All consumers see the same pure answer: admission, prompt, milestone, withdraw room and craftroom. That removes finding
4 entirely (staleness, races, the recordOutcome wipe, double chests, invalidation after the clear) and finding 5.

What it gives up: a guaranteed 256 floor. After the clear, inflow would be relief-only, about 120 a day fleet-wide by
this window's numbers. Whether that keeps up with withdraw ingredient draws (3 cobble per pickless bot's pick) is an
empirical question.

If the owner wants a hard floor, keep the ledger and fix finding 4. In either case this is the cheaper first canary.

### 11. Smaller corrections

- **Spent tools banked are about 30–55 a day, not about 100.** Classified by the pre-run copies of that name: "all
  copies ≤10 uses" is 55 a day, 30 of them with a copy at ≤2 uses, which is consistent with breaking on the walk home.
  Clean runs alone (which exclude breakage) give 30. The other 73 are "mixed" and 56 are "all usable". Moot once
  withdraw ships, but STATE quotes about 100.
- **Prerequisite status.** Withdraw 515d99c is at round 3, both CHANGE (STATE, e2112d8), and the queue ahead is
  craftroom → composter → toolclean → gridfix → chest → withdraw. "Withdraw promoted" is several canaries away. The
  spent-tool gate G3 depends on it.
- **"About 450 cobble per town-day"**: this window gives about 384, with 38% of town-6h buckets at zero. It is present
  per day, not per read window.
- **Relief thresholds.** Relief, hygiene wear-out and the composter all trigger at 34 slots. That is fine, but state the
  priority when all three apply in town.
- **The admission walk.** A stale-low ledger far from town admits a deposit that then refuses on the fresh open
  (no_effect after a walk). It is bounded by the TTL and should be counted in the read ("cap no_effect after walk").

## Attack summary

| | question | answer |
|---|---|---|
| (a) | Is the bound sound? | Not as a strict lower bound: lost-write resurrection, the clear, double chests, the recordOutcome wipe, the 30 s cache. It refuses easily today. Fixes are in finding 4. |
| (b) | Does relief re-open the leak? | Yes: about 23% of cobble, 92% of it freeing no slot. Fix in finding 2. |
| (c) | Does it compose without a dead end or loop? | No dead end: cobble almost never frees a slot. deposit_surplus terminates, since bankable falls below 4 once cobble is excluded or relieved down to reserve. One new path: relief → chest expansion (finding 3). Also a stale-ledger walk followed by no_effect. |
| (d) | Is the never-bank list zero new load? | Yes (positive control above), but its union definition pulls in flint, ink and eggs (finding 9). |
| (e) | Is it measurable in 180/360 min? | No: about 0.06–0.1 refusals per bot-hour, about 2–3 per town in 6 h, and an effect between the null's p5 and p25. Run it as a mechanism canary plus a multi-day bag check (finding 6). |
| (f) | What is missing? | Per-name deposit logging (finding 8), the threshold regime is never exercised (finding 7), a ledger-free alternative (finding 10), and town scoping for the isolated arm (finding 5). |
