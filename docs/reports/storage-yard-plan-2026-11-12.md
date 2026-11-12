# Storage plan: bags, yards and chests (2026-11-12)

**Owner decisions, 2026-11-12:**

1. Storage yard piles that stack and grow: a stepped structure per kind, expandable, with a stepped side for access that
   moves as the pile grows.
2. A limit that makes bots stop cutting trees when the town has a large excess of logs.
3. No stone or logs in chests, ever. That is what the yard is for.
4. A bot takes from its own bag, then the storage yard, before it mines or cuts more of a material.

Then: "plan it all now, then implement step 1, then fit in 2-4 when it is appropriate. use codex and claude to find the
best approach."

Two independent designs were written from the same brief (Codex; Claude, `claude -p`, opus) and reconciled here. Where
they disagreed, the choice and the reason are stated.

## Why the old approach did not last

Measured 11-12 (fleet, `scripts/lib/telemetry.py`, 6 h walks of 530-540k rows / 80 bots):

- 38 of 80 bots at 34+ of 36 bag slots; town chests 87-100% full; town deposits succeed about 18% of the time.
- Every fix so far added storage or moved items between bag and chest. None added a way out, so storage refilled.
- The log cap (logcap-02, live since 11-10) says `capped` in 15 of 16 towns (468 to 5,321 logs counted in chests, about
  57,800 fleet-wide, against a high mark of 1,024). In capped towns 432 log gathers still succeeded in 6 h, 332 of them
  chosen by the model. The cap removes one idle task and prints a prompt line; it refuses nothing.
- The repeated failure: a refusal or a prompt line gives advice and the model does not follow it. What must happen has
  to be deterministic.

## The model

Logs and the stone family are **bulk**. Bulk lives in three places only: a bag (up to its keep), a yard lane, or the
world. Chests hold everything else.

| | Always true |
|---|---|
| **Bag** | Wood at or under 16 units (`woodkeep.mjs` WOOD_KEEP), stone family at or under 64, plus a declared job's hold. Above that it leaves at the next town stay, to the yard. |
| **Chest** | Never receives a log, stem or stone-family block (after step 4). What is already there may be taken out. |
| **Yard** | One kind per lane. Every pile is a staircase a bot can walk up. Stock is what the world shows, never a journal. |
| **Gathering bulk** | Only for what the bag and the stores cannot supply. |

Retired as the steps land: the chest stock targets and claims journal for logs and stone (`stocktarget.mjs`,
`cobblecap.mjs`), the log half-deposit (`towndeposit.mjs`), the TOWN WOOD prompt line, and new chests for bulk. No more
prompt-only storage rules. Logs are never destroyed (owner 10-17, after wells destroyed 14,585); the junk well stays the
last exit for the cobble family only.

## Step 1: the log limit refuses (built first, alone)

**Where.** A pure decision `logGatherGate` in `bots/src/logcap.mjs`, called from `AdmissionControl` in
`bots/src/admission.mjs` inside the existing `gather` branch. Every model-chosen action passes admission, and admission
already rewrites arguments, so the outcome is deterministic. `admission.mjs` is protected: **tier 3**, two reviewers, a
search of prior art, a fleet canary.

*Disagreement.* Codex would enforce inside `gatherRun` and run the withdrawal inside the gather. Chosen: admission. It
stops the proposal before a decision cycle is spent, touches one protected file, and leaves `gather` itself alone. The
measured leak (332 model-chosen gathers) passes admission. Internal callers that fell on purpose (site clearing, forest,
tree farm) and escape digging do not use admission and are untouched.

**Rule.** Only for a block that is a log, stem, wood or hyphae, only while the town is capped by a proven reading
(logcap-02's own hysteresis: capped above 1,024, resume at or below 768 with 80% coverage; an unread index fails open).
`need` = 16 minus the wood units the bag holds.

| Case | Outcome |
|---|---|
| `need` is 0 or less | **Refused.** "The town holds N logs, above its 1,024 limit, and you carry M wood (your keep is 16): no tree cutting. Craft planks or sticks from your bag, or pick other work." |
| `need` above 0, bot in town, the town index shows logs | **Rewritten to a withdrawal** of the species the town holds most, for `need` (at most 64). |
| `need` above 0, away from town, or a log withdrawal failed for this bot in the last 10 min | **Admitted, clamped** to `need` (4 to 16 logs). |

The third row is the dead-end breaker: a failed withdrawal can never lead to a refused gather, and a bot far from town
with no wood can always cut what its own tools need. A claim of "project" by the model earns no exemption (Codex).

**Rollback.** `LOGGATE=off` (admission behaves as the base; `LOGCAP` keeps its idle rule).

**Proof it worked.** A `_loggate` row per decision (act, need, wood, town logs). Target: successful log gathers in
capped towns from 432 to 60 or fewer per 6 h, counted as cuts, not as gather "success" (a withdrawal can satisfy that).
Guards: plank, stick and table craft failures do not rise; the withdrawal success rate for logs; time spent short of
wood. The canary pools must be capped towns.

**Tests.** Behaviour of `logGatherGate` (uncapped, unread, non-log blocks, each row of the table, the latch); a property
test that it never refuses when `need` is above 0; an admission test that the rewrite reaches the admitted skill;
mutants with unique anchors (the admission call removed, `need > 0` weakened, the latch removed).

## Step 2: bag, then stores, then gather

One pure resolver `bulkSource(kind, need, bag, stores)` returns `bag`, `take from store` or `gather`, applied in admission
to every gather of a bulk kind, and used by builders and the materials job. Until the yard exists the store is today's
chests, so this works alone and already cuts cobble and stone inflow. The yard is added as a store in step 3.

*Order disagreement.* Claude put the yard before this step; Codex put this step first because it works with chests
alone. Chosen: this step first. Step 1 is already this rule for logs.

## Step 3: the yard on the fleet, with lanes that grow

Port `bots/src/yard.mjs` and `yardVisit` from main (they run only on the showcase: 304 blocks, four fixed bays, no logs).

- **Lane:** one kind, 4 blocks wide, up to 6 high, filled far end first, layer by layer, so the near end is always a
  staircase. Layers 1-2 are placed from 2-wide aisles on both sides; higher layers standing on the layer below.
  Capacity `4 x (6L - 15)`: 516 blocks at length 24.
- **Growth:** a lane at 90% grows 8 cells at the far end once the new cells pass siting and the walk proof. The stairs
  stay at the front. A full yard starts another lane; lanes may be detached where a long one does not fit.
- **Taking back:** last in, first out, from the top step, so the stairs never break. Stone taken without the right tool
  comes back as cobblestone; that is accepted and stated.
- **First build:** 2 log lanes (1,032, the cap) and 3 stone lanes (1,548), about 32 x 28, sited outside the wall in the
  yard, wild or homes zones.
- **Workers:** a lease per lane, any bot may stock its own surplus, one clerk. Bag relief and withdrawals go before
  chest draining.

*Disagreement.* Codex proposed lanes 2 wide and 4 high (sixteen lanes, about 66 x 68, to hold 4,000 logs and 4,000
stone). Chosen: wider, taller lanes and a smaller first build, because the log limit stops the inflow and step 4 drains
chests slowly. Not built: a four-sided ziggurat (taking back cannot keep four sides stepped), an unlimited-height pile,
a claims journal for the yard.

## Step 4: chests refuse stone and logs

Town by town, only where a yard is sited, reachable and proven. The deposit plans stop selecting bulk and run a yard
stock visit instead. Chests drain by use (every bulk withdrawal takes from chests first) and by the clerk, 64 a visit.

**This reaches "never in chests" slowly.** About 2,600 logs a town sit above the cap. At the measured draw (40-85 a town
a day) plus the clerk, that is 30-60 days. Faster needs more lanes or more wood projects; destroying logs is not in this
plan.

Never a dead end: yard full grows or opens a lane; growth blocked sends cobble to the well and keeps logs in the bag
with cutting refused; a town with no yard, or one that cannot be reached, keeps the chest path with a row saying so.

## Order and risks

1 -> 2 -> 3 -> 4. Step 1 must not strand a bot short of wood. Step 2 must not send a bot to a yard that is not built.
Step 4 must not refuse a chest deposit in a town without a proven yard.

1. **Throughput.** Placing blocks is the bottleneck (a keeper places 150-520 a day); cobble inflow from mining is not
   measured yet and must be before step 3's sizes are trusted.
2. **Siting.** A 32 x 28 site with room to grow, in 16 towns. The showcase found no site for an 18 x 15 yard inside its
   town ring.
3. **Guards composing.** The admission rewrite meeting the repeat-work and milestone vetoes; a full bag with full
   chests. Each is tested as a chain, not as a single guard.

## Status

| Step | State |
|---|---|
| 1 | Being built 11-12 (tier 3) |
| 2-4 | Planned; each is its own change with its own switch, review and canary |
