**NEITHER as written. Prefer the review’s no-ledger direction, with the corrections below.** The design’s stock bound is unsound; the review overstates both its slot evidence and freedom from dead ends.

Checked `origin/wd-on-6c9a8fb` at `515d99c`. I read both scripts and saved outputs and exercised the branch’s pure predicates in memory. No files or world state were changed; I did not rerun fleet telemetry.

1. **The no-ledger policy is the better next design, but it is a relief exception—not a “never junk” guarantee.**

   The useful invariant is: **cobble may enter existing storage only when that cobble transfer itself empties an inventory slot, while preserving reserves and withdraw holds.** Another item freeing a slot must not qualify cobble.

   Apply this explicitly to both cobblestone and cobbled_deepslate, overriding `wants`; removing standing targets alone is insufficient because `bankableInventory` combines the two. Preserve the existing allowance calculation before applying the slot condition. See [bankable.mjs:145](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/bankable.mjs:145), [bankable.mjs:181](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/bankable.mjs:181), and [bankable.mjs:198](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/bankable.mjs:198).

   This directly addresses slot pressure without adding persistent stock accounting. By contrast, the design’s relief can deposit 56 from a single 64-stack, leaving eight and freeing **nothing**.

   Neither alternative guarantees a 256-item **floor**: a cap limits additions; it does not replenish withdrawals. Neither prevents indefinite chest accumulation through repeated relief. If all surplus cobble is classified as junk without exception, **both proposals contradict the literal owner goal**.

2. **The review’s ledger findings are substantially correct, with an important cache qualification.**

   | Claim | Adjudication and evidence |
   |---|---|
   | Concurrent updates can resurrect stale high stock | **True for the proposed ledger.** The entire file is read, mutated, then replaced without locking. A writer with an older snapshot can overwrite another bot’s downward stock update. Atomic rename prevents torn files, not lost updates. [chestfull.mjs:241](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/chestfull.mjs:241) |
   | `recordOutcome` rebuilds the entry | **True.** Its return objects omit arbitrary fields, including proposed `stock`. A successful deposit calls this through `rememberTown`. [chestfull.mjs:218](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/chestfull.mjs:218), [skills.mjs:2684](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2684), [skills.mjs:2783](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2783) |
   | Isolated-arm town memory is per bot | **True under the generated/default configuration.** `townDir` uses the memory pool; isolated bots receive `self-<bot>` pools. `POOL_STATE_DIR` can override the directory, so code alone does not establish every deployed path. [skills.mjs:2774](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2774), [generate-roster.py:196](/Users/darrellmiller/Documents/code-minecraft-ai/scripts/generate-roster.py:196), [worldfacts.mjs:374](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/worldfacts.mjs:374) |
   | A 30-second cache defeats fresh-open evidence | **Conditional, not an existing stock-reader bug.** The cache exists for the bank-reopen signal, but local `rememberTown` invalidates it. A new stock reader would be stale if it copied the caching without invalidation/direct fresh input. No stock reader exists yet. [skills.mjs:2777](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2777) |

   More fundamentally, a recent observation is **not a current lower bound** when contents can decrease. TTL does not fix that. Failed double-chest identification also needs conservative handling: `chestPartner` can return null. [skills.mjs:2763](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2763). These problems make the ledger disproportionate to this canary.

3. **The review correctly rejects “high occupancy means relief,” but its replacement numbers are estimates, not slot-level verification.**

   `nojunk-rv2.py:109–125` reconstructs relief from per-name totals, combines both stone names, assumes an eight-stone reserve, and treats other negative inventory deltas as evidence of slot relief. That differs from actual stack order, the shared scaffold reserve, withdraw holds, and actual container transfers.

   I exercised [craftroom.mjs:290](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/craftroom.mjs:290):

   | Cobble stacks in transfer order | Deposit | Actual predicate frees a slot | Script’s aggregate estimate |
   |---|---:|---|---|
   | `[64]` | 56 | No | No |
   | `[64, 1]` | 57 | No | Yes |
   | `[1, 63]` | 56 | Yes | No |

   Thus **3.2% is not established as a lower bound**, and “two runs/day” cannot prove absence of dead ends. The ~120/day estimate also includes the simulation’s ≥34-slots/no-other-relief restrictions; it cannot be assigned unchanged to the broader slot-only policy. Future inventories will change under refusal.

   There is also a bounds error in finding 8: the script computes **6,208 as a lower bound**, not “at most banked.” The corrected output reports 7,126 negative cobble items, 6,208 lower-bound items and 4,281 in clean runs (`nojunk-rv2-full.out:6`). Their difference does not prove that all 918 were scaffold; some could have been deposited. **Per-name confirmed transfer logging is necessary.**

4. **Slot-only banking is not safe from dead ends merely by changing `bankableInventory`.**

   **Admission:** `depositDue({bankable:0, occupiedSlots:36, distHome:0})` returns true. Admission also evaluates total bankability rather than the named item’s plan. Therefore both an empty generic plan and `deposit cobblestone` with only unrelated bankable wood can still get through. [bankable.mjs:232](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/bankable.mjs:232), [admission.mjs:346](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/admission.mjs:346). Reject an empty **requested plan before walking**, and recheck in execution. A refusal sentence alone does not prevent repeated proposals.

   **Craftroom:** `depositTarget` already requires a slot to empty and protects ingredients. Keep that shared predicate, with execution matching its stack order; “pick the smallest stack” is not equivalent to the current ordinary transfer. [craftroom.mjs:310](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/craftroom.mjs:310), [skills.mjs:2649](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2649). However, advice currently checks only `bankClosed`, not actual destination capacity. A full destination can still make the suggested remedy impossible. [skills.mjs:4216](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:4216).

   **Milestones:** excluding cobble makes `deposit_surplus` complete when bankability falls below four. But eligible relief that cannot fit still leaves it unfinished when a chest exists and the bank remains open. The review’s blanket termination claim is too strong. [milestones.mjs:805](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/milestones.mjs:805). A bounded, relief-specific unavailable state must also suppress repeated advice and allow the milestone to move on without closing valuable banking.

   **Full chests:** relief remains eligible, so both pre-open recovery and post-transfer failure can reach chest construction. [skills.mjs:2520](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2520), [skills.mjs:2736](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2736), [skills.mjs:2983](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2983). Permit a bounded search of existing storage, but **no relief-driven crafting, placement, or bank closure**. Re-evaluate mixed plans before expansion.

   Also preflight enough compatible room for the **whole qualifying transfer**. Current transfers can partially succeed before throwing; that would bank cobble without freeing its source slot. [skills.mjs:2653](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2653).

   Finally, neither policy creates a disposal path for a full bag with no legal relief destination. Hygiene does not consume cobble on demand. [hygiene.mjs:47](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/hygiene.mjs:47). Preventing futile loops is achievable; guaranteeing bag recovery under every stated constraint is not established.

5. **Use a one-variable mechanism canary, with deterministic safety gates—not a 180/360-minute efficacy verdict.**

   The single treatment should be **current cobble banking versus the completed slot-only policy**. Keep hard-list expansion, wood policy, composter/tool changes, stock ledgers and chest clearing out of this experiment. Admission and recovery integration are required parts of making that treatment correct.

   For ten treatment bots, prefer two whole five-bot towns because storage is shared. The observed 409 cobble-banking runs in 3,840 bot-hours imply only approximately:

   | Duration | Treatment exposure | Historical banking opportunities |
   |---|---:|---:|
   | 180 minutes | 30 bot-hours | 3.2 |
   | 360 minutes | 60 bot-hours | 6.4 |

   These are opportunities, **not guaranteed refusals or successful relief**. The stricter simulation found only five relief cases fleet-wide over 48 hours. Moreover, 49/128 town-six-hour buckets had zero cobble banking (`nojunk-rv2-full.out:56–82`). The review’s five-bot null distribution is not a power calculation for ten bots, but these data provide no basis for claiming adequate short-window power.

   Require deterministic coverage of:

   - Reserves/holds, both stone names, fragmented stacks and wants overrides.
   - Empty and named-item plans rejected before travel.
   - Full and partly-full destinations: no non-slot-freeing cobble transfer, expansion, or repeated craftroom/milestone loop.
   - Confirmed per-name movement and source-slot relief; safe cursor settlement, with no toss/drop.
   - Unchanged non-cobble behavior.

   Exercise these with mocks or replay, without world edits. Production needs observed exposure to both refusal and successful relief; missing coverage means **INCONCLUSIVE**, not a vacuous pass. Report actual events per treatment bot-hour.

   Treat 180/360-minute results as mechanism validation only. Before promotion, use at least a multi-day bag check—actual occupied slots, cobble stacks, inventory-full failures and withdraw shortages—with controls. Even 48–72 hours should be an initial checkpoint, not an automatic proof of safety.
68,090
**NEITHER as written. Prefer the review’s no-ledger direction, with the corrections below.** The design’s stock bound is unsound; the review overstates both its slot evidence and freedom from dead ends.

Checked `origin/wd-on-6c9a8fb` at `515d99c`. I read both scripts and saved outputs and exercised the branch’s pure predicates in memory. No files or world state were changed; I did not rerun fleet telemetry.

1. **The no-ledger policy is the better next design, but it is a relief exception—not a “never junk” guarantee.**

   The useful invariant is: **cobble may enter existing storage only when that cobble transfer itself empties an inventory slot, while preserving reserves and withdraw holds.** Another item freeing a slot must not qualify cobble.

   Apply this explicitly to both cobblestone and cobbled_deepslate, overriding `wants`; removing standing targets alone is insufficient because `bankableInventory` combines the two. Preserve the existing allowance calculation before applying the slot condition. See [bankable.mjs:145](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/bankable.mjs:145), [bankable.mjs:181](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/bankable.mjs:181), and [bankable.mjs:198](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/bankable.mjs:198).

   This directly addresses slot pressure without adding persistent stock accounting. By contrast, the design’s relief can deposit 56 from a single 64-stack, leaving eight and freeing **nothing**.

   Neither alternative guarantees a 256-item **floor**: a cap limits additions; it does not replenish withdrawals. Neither prevents indefinite chest accumulation through repeated relief. If all surplus cobble is classified as junk without exception, **both proposals contradict the literal owner goal**.

2. **The review’s ledger findings are substantially correct, with an important cache qualification.**

   | Claim | Adjudication and evidence |
   |---|---|
   | Concurrent updates can resurrect stale high stock | **True for the proposed ledger.** The entire file is read, mutated, then replaced without locking. A writer with an older snapshot can overwrite another bot’s downward stock update. Atomic rename prevents torn files, not lost updates. [chestfull.mjs:241](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/chestfull.mjs:241) |
   | `recordOutcome` rebuilds the entry | **True.** Its return objects omit arbitrary fields, including proposed `stock`. A successful deposit calls this through `rememberTown`. [chestfull.mjs:218](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/chestfull.mjs:218), [skills.mjs:2684](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2684), [skills.mjs:2783](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2783) |
   | Isolated-arm town memory is per bot | **True under the generated/default configuration.** `townDir` uses the memory pool; isolated bots receive `self-<bot>` pools. `POOL_STATE_DIR` can override the directory, so code alone does not establish every deployed path. [skills.mjs:2774](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2774), [generate-roster.py:196](/Users/darrellmiller/Documents/code-minecraft-ai/scripts/generate-roster.py:196), [worldfacts.mjs:374](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/worldfacts.mjs:374) |
   | A 30-second cache defeats fresh-open evidence | **Conditional, not an existing stock-reader bug.** The cache exists for the bank-reopen signal, but local `rememberTown` invalidates it. A new stock reader would be stale if it copied the caching without invalidation/direct fresh input. No stock reader exists yet. [skills.mjs:2777](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2777) |

   More fundamentally, a recent observation is **not a current lower bound** when contents can decrease. TTL does not fix that. Failed double-chest identification also needs conservative handling: `chestPartner` can return null. [skills.mjs:2763](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2763). These problems make the ledger disproportionate to this canary.

3. **The review correctly rejects “high occupancy means relief,” but its replacement numbers are estimates, not slot-level verification.**

   `nojunk-rv2.py:109–125` reconstructs relief from per-name totals, combines both stone names, assumes an eight-stone reserve, and treats other negative inventory deltas as evidence of slot relief. That differs from actual stack order, the shared scaffold reserve, withdraw holds, and actual container transfers.

   I exercised [craftroom.mjs:290](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/craftroom.mjs:290):

   | Cobble stacks in transfer order | Deposit | Actual predicate frees a slot | Script’s aggregate estimate |
   |---|---:|---|---|
   | `[64]` | 56 | No | No |
   | `[64, 1]` | 57 | No | Yes |
   | `[1, 63]` | 56 | Yes | No |

   Thus **3.2% is not established as a lower bound**, and “two runs/day” cannot prove absence of dead ends. The ~120/day estimate also includes the simulation’s ≥34-slots/no-other-relief restrictions; it cannot be assigned unchanged to the broader slot-only policy. Future inventories will change under refusal.

   There is also a bounds error in finding 8: the script computes **6,208 as a lower bound**, not “at most banked.” The corrected output reports 7,126 negative cobble items, 6,208 lower-bound items and 4,281 in clean runs (`nojunk-rv2-full.out:6`). Their difference does not prove that all 918 were scaffold; some could have been deposited. **Per-name confirmed transfer logging is necessary.**

4. **Slot-only banking is not safe from dead ends merely by changing `bankableInventory`.**

   **Admission:** `depositDue({bankable:0, occupiedSlots:36, distHome:0})` returns true. Admission also evaluates total bankability rather than the named item’s plan. Therefore both an empty generic plan and `deposit cobblestone` with only unrelated bankable wood can still get through. [bankable.mjs:232](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/bankable.mjs:232), [admission.mjs:346](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/admission.mjs:346). Reject an empty **requested plan before walking**, and recheck in execution. A refusal sentence alone does not prevent repeated proposals.

   **Craftroom:** `depositTarget` already requires a slot to empty and protects ingredients. Keep that shared predicate, with execution matching its stack order; “pick the smallest stack” is not equivalent to the current ordinary transfer. [craftroom.mjs:310](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/craftroom.mjs:310), [skills.mjs:2649](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2649). However, advice currently checks only `bankClosed`, not actual destination capacity. A full destination can still make the suggested remedy impossible. [skills.mjs:4216](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:4216).

   **Milestones:** excluding cobble makes `deposit_surplus` complete when bankability falls below four. But eligible relief that cannot fit still leaves it unfinished when a chest exists and the bank remains open. The review’s blanket termination claim is too strong. [milestones.mjs:805](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/milestones.mjs:805). A bounded, relief-specific unavailable state must also suppress repeated advice and allow the milestone to move on without closing valuable banking.

   **Full chests:** relief remains eligible, so both pre-open recovery and post-transfer failure can reach chest construction. [skills.mjs:2520](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2520), [skills.mjs:2736](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2736), [skills.mjs:2983](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2983). Permit a bounded search of existing storage, but **no relief-driven crafting, placement, or bank closure**. Re-evaluate mixed plans before expansion.

   Also preflight enough compatible room for the **whole qualifying transfer**. Current transfers can partially succeed before throwing; that would bank cobble without freeing its source slot. [skills.mjs:2653](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/skills.mjs:2653).

   Finally, neither policy creates a disposal path for a full bag with no legal relief destination. Hygiene does not consume cobble on demand. [hygiene.mjs:47](/Users/darrellmiller/Documents/code-minecraft-ai/bots/src/hygiene.mjs:47). Preventing futile loops is achievable; guaranteeing bag recovery under every stated constraint is not established.

5. **Use a one-variable mechanism canary, with deterministic safety gates—not a 180/360-minute efficacy verdict.**

   The single treatment should be **current cobble banking versus the completed slot-only policy**. Keep hard-list expansion, wood policy, composter/tool changes, stock ledgers and chest clearing out of this experiment. Admission and recovery integration are required parts of making that treatment correct.

   For ten treatment bots, prefer two whole five-bot towns because storage is shared. The observed 409 cobble-banking runs in 3,840 bot-hours imply only approximately:

   | Duration | Treatment exposure | Historical banking opportunities |
   |---|---:|---:|
   | 180 minutes | 30 bot-hours | 3.2 |
   | 360 minutes | 60 bot-hours | 6.4 |

   These are opportunities, **not guaranteed refusals or successful relief**. The stricter simulation found only five relief cases fleet-wide over 48 hours. Moreover, 49/128 town-six-hour buckets had zero cobble banking (`nojunk-rv2-full.out:56–82`). The review’s five-bot null distribution is not a power calculation for ten bots, but these data provide no basis for claiming adequate short-window power.

   Require deterministic coverage of:

   - Reserves/holds, both stone names, fragmented stacks and wants overrides.
   - Empty and named-item plans rejected before travel.
   - Full and partly-full destinations: no non-slot-freeing cobble transfer, expansion, or repeated craftroom/milestone loop.
   - Confirmed per-name movement and source-slot relief; safe cursor settlement, with no toss/drop.
   - Unchanged non-cobble behavior.

   Exercise these with mocks or replay, without world edits. Production needs observed exposure to both refusal and successful relief; missing coverage means **INCONCLUSIVE**, not a vacuous pass. Report actual events per treatment bot-hour.

   Treat 180/360-minute results as mechanism validation only. Before promotion, use at least a multi-day bag check—actual occupied slots, cobble stacks, inventory-full failures and withdraw shortages—with controls. Even 48–72 hours should be an initial checkpoint, not an automatic proof of safety.
