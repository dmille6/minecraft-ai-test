# Codex independent design (codex exec, read-only, 2026-11-03 ~21:00Z; given the owner request + measurements, not Claude's design)

**Recommendation:** build a storage annex with 20 numbered intake chests, a separate sorted collection, one rotating clerk, and an optional helper. Start with chest transfers; add one hopper as the public drop point after Paper proof. This is primarily a visible town capability and organization improvement, with modest potential time savings.

This is an independent Codex design for reconciliation with Claude’s design. I read the requested process, state, source headers, transfer implementations, and groundskeeper helper branch. No files were edited; no tests, servers, or SSH were run. Queue recommendations use your supplied ~21Z state, which supersedes the generated 20:20Z `STATE.md`.

**1. Hub design**

**Layout and siting.** Keep the existing storehouse operating during construction. Its 7×7 shell encloses the town plan’s existing chest ring; it cannot accommodate this request without substantial changes. Reuse its palette and construction conventions, not its footprint: [storehouse.mjs](/Users/darrellmiller/Documents/.wt-storehub/bots/src/storehouse.mjs), particularly `storeBlueprint`, `storeSite`, and `storeRecord`.

Reserve an approximately **23×17 annex**, with an additional well courtyard. Put it on the storehouse/workshop side of town, adjoining an existing path and near the stockpile yard. Require dry, modestly graded ground, two-block aisles, open entrances, clear chest lids, and accessible standing positions. Respect existing plots, protected zones, farms, and project reservations. Exact coordinates require a later site survey.

Inside:

- **Receiving bay:** 20 single chests, I01–I20, arranged as four rows of five with gaps preventing accidental double chests.
- **Sorted bay:** initially 12 single chests, with reserved expansion positions.
- **Public frontage:** one hopper receptacle, an accessible direct-deposit chest, and status signs.
- **Side courtyard:** existing-style junk well and composter, away from normal traffic.

The annex may extend beyond current town-container range. `towndeposit.mjs` defines town as 16 horizontal/12 vertical blocks, and indexing/search have their own eligibility checks. Register exact hub containers under their original town; extend the relevant readers deliberately. Do not merely enlarge every nearby-container scan or assume a building record makes its chests discoverable.

**Intake.** A deep open hopper pit is unnecessary. Use a guarded, shallow receptacle with the hopper’s collection space unobstructed. One hopper feeds **I01**; the clerk moves accepted contents directly to sorted storage, or to I02–I20 when receiving needs temporary capacity.

This distinction must be explicit: **one hopper does not distribute items automatically across 20 chests**. In the recommended design, bots distribute across that bank. An unattended, passive 20-chest buffer would need a separately proven hopper network and more iron.

Bots should normally use verified chest deposits rather than toss inventory. Human tossing supplies the visible hopper interaction; bots already holding classified materials can continue depositing directly into group homes. Neither route should impose an unnecessary extra sorting trip.

A hopper accepts junk mechanically. The owner must explicitly reconcile this with the 10-04 rule: recommend allowing junk **temporarily in designated intake chests only**, while keeping it forbidden in sorted stock and ordinary bot deposits. Without that exception, offer accepted-item chest intake and separate plant/junk facilities; an unrestricted hopper cannot enforce the rule.

**Clerks.** Start with **one clerk per town**, selected from bots already doing discretionary town work. Use `buildproj.mjs` lease machinery and the yard’s one-clerk pattern. Rotate terms and release when idle, following `keeperDecision` on `gkhelpers-01show`; do not reserve a bot permanently.

`roles.mjs` currently understands BUILD and MAKE, not BANK. Avoid inventing an unsupported role-file value. Initially schedule clerk visits through `shop.mjs` project work, with feature setup in `features.mjs`.

Each visit:

1. Acquire the clerk lease and recheck available work.
2. Inspect I01 first, then the oldest known backlog.
3. Confirm destination capacity; withdraw from one source, at most six stacks, preserving personal inventory and spare slots.
4. Deliver to group homes, yard handling, composting, or the approved well path.
5. Verify transfers, record unresolved cargo, close windows, release or renew the lease.

Six stacks matches `SORT_MOVE_STACKS`. Reuse `withdrawVisit`, `sortPut`, `verifyTown`, and index dirty/observation handling in [skills.mjs](/Users/darrellmiller/Documents/.wt-storehub/bots/src/skills.mjs:18309). Add explicit cargo tracking: today’s `sortTidyOne` releases withdrawal holds afterward and leaves undelivered items in the bag. Intake cargo needs a recoverable destination and must not silently become ordinary disposable surplus.

Enable a second clerk only when backlog persists, with separate source leases and coordination for shared destinations. The groundskeeper helpers demonstrate bounded cooperation, but their spatial leases do not solve chest-window races. Never allow a bot to hold both yard-clerk and storage-clerk work simultaneously.

**Groups and signs.** Reuse `townindex.mjs::groupOfItem` and `sortstore.mjs::sortHomes`, retaining metal, fuel, stone, wood, tools, farm, valuable, build, earth, and misc. Allocate one home per group plus two overflow chests; expand from observed slot pressure. Existing homes can remain secondary locations during migration.

A category is **not permission to store**: farm classification does not override plant refusals, and earth classification does not make flint useful stock. Apply acceptance/disposal policy before classification.

Keep bulk cobblestone and deepslate in the yard. Reuse `yard.mjs` working-stock rules, including the current cobble refill threshold of 256 and chest retention of 320; do not enlarge cobble chest capacity to absorb 26,448 bagged cobble.

Use signs such as `INTAKE I04`, `WOOD`, `TOOLS`, `OVERFLOW`, and `WELL: LISTED JUNK`. Label hopper capacity/status separately from total intake capacity. Reuse `sortstore.mjs` labels and the proven editor-opening sequence in `sortLabelOne`; calling `bot.updateSign` alone is insufficient.

**Withdrawals.** Search verified positive stock first, then group homes, then bounded fallback. Preserve the 16-chest `withdraw_pick` and 12-chest toolkit limits. Intake is a lower-priority emergency source for usable materials, not 20 additional mandatory visits.

`town-index` is an observation cache, not stock authority. Unknown, stale, and dirty remain distinct. Hopper-fed I01 can change without bot dirty marks, so its observation must never provide a durable negative or guaranteed free-capacity claim. Reopen before acting. Keep the index isolated from disposal decisions, as its header requires.

**Well and plants.** Reuse the existing shallow, two-trapdoor disposal well and `wellSiteRefusal`/`wellAdmission`. Place it sufficiently aside that the five-block player exclusion does not routinely conflict with clerks. Preserve closed-trapdoor cleanup, throw logging, missed-toss recovery, and pickup-proof containment.

For hub cargo, disposal requires `isWellJunk`, all applicable reserve/project guards, and a final per-stack check. Examples include approved eggs, flint, ink sacs, and scutes—not arbitrary contents of a full chest.

Never use fullness to discard tools, ores, ingots, logs, planks, fuel, building parts, food, personal reserves, or unknown items. The existing `NEVER_DISPOSE` guard protects many of these, but [well.mjs](/Users/darrellmiller/Documents/.wt-storehub/bots/src/well.mjs:126) also contains separate sword, cobble, and stock-surplus paths. **Do not automatically apply those exceptions to entrusted hub cargo.** Preserve swords initially despite the separate peaceful-world policy; bulk stone goes to the yard.

Saplings and flowers go to planting needs or the existing composter rules, never the well. Bamboo follows yard/fuel policy, including useful block conversion. Excess plants remain in intake pending an eligible destination; they never enter sorted town stock. A blocked plant destination creates a visible backlog, not permission to delete.

**Funding and failures.** One hopper costs five iron and one chest. Twenty cost 100 iron and 20 crafting chests, in addition to the 20 receiving chests. Showcase’s 120 observed ingots include personal reserves: this is not 120 spendable iron. Fund one hopper from verified surplus after toolkit and project obligations. Reuse eligible surplus chests before crafting; 674 fleet bagged chests are an opportunity, not automatically available stock.

When I01 fills, stop inviting tosses even if other intake chests have room. Offer direct deposit to a verified available intake chest. No ground overflow. An absent clerk leaves contained items safe but receiving capacity limited; an unloaded chunk pauses processing. Do not assign a permanent chunk-loader bot. Ground items remain vulnerable to despawn, so receipt requires observed collection, not “toss succeeded.”

**2. Expected gain and acceptance measures**

The supplied fleet measurements put all listed storage work at **9.1 of 1,923 bot-hours: 0.47%**. Even eliminating it entirely would save less than half a percent; clerks add work. Showcase storage is similarly only 0.3%. Do not promise a large productivity improvement.

The stronger opportunities are discoverability and reliable relief of inventory pressure:

- `withdraw_pick` averages 7.9 chest visits; 64/316 measured searches hit the cap.
- Reported per-chest misses are 86% for pick searches and 78% for toolkit searches.
- 67/312 observed fleet chests are full, despite substantial capacity elsewhere.
- 15,831/16,381 proposed deposits abort at admission. A building alone cannot fix admission-policy mismatch.
- Existing showcase sorting still has misses, so signs and group homes alone are insufficient.

Proposed acceptance targets, measured after bagdiet’s effects settle:

- At least 100 verified stack transfers covering ordinary stock, plants, junk, overflow, and interruption recovery.
- At least 95% of accepted batches reach an eligible destination within ten **loaded, staffed** minutes; report wall-clock latency separately.
- At least 95% of non-overflow sorted slots match their assigned group.
- At least 30% fewer mean chest visits for comparable searches, without lower successful-withdrawal rates.
- Report net storage bot-hours including clerks, unresolved cargo, receipt failures, backlog age, redundant crafts, and yard transfers.

Immediately disable the affected component on any protected-item disposal, confirmed loss/duplication, unsafe well interaction, reserve stripping, or repeated unresolved cursor state. Repeated full-I01 toss losses close hopper intake. No backlog progress for 30 staffed minutes triggers investigation; the project’s three-hour stall rule still applies.

Read full telemetry walks with rotated files, denominators, and positive controls. Missing telemetry is not a pass.

**3. Paper sandbox proof before release**

Using normally acquired materials and bot construction, prove:

- Sneaking placement against the chest, correct hopper output direction, and sneak cleanup after failure.
- Actual capture geometry, burst receipts, obstruction, backpressure, and reopening after capacity returns.
- Pickup-delay and missed-toss behavior with another bot nearby.
- Unloading/reloading behavior; do not equate elapsed wall time with despawn time.
- Chest lid access, placement without unintended pairing, sign editing, and usable approaches.
- Transaction rejection, window timeout, interrupted withdrawal/deposit, disconnect, restart, and cursor recovery.
- Concurrent hopper insertion, clerk withdrawal, and consumer access without claiming an ambiguous delta as verified.
- Clerk failover and lease fencing, including an expired holder resuming.
- Mixed useful/junk/plant batches, full destinations, unavailable yard/composter, and protected cargo.
- End-to-end availability: receive an existing tool, sort it, and have another bot withdraw it without redundantly crafting one.

Record counts before and after, including inventories and item entities. A successful helper return value is not conservation proof.

**4. Shippable pieces**

Tiers below are provisional until the exact diff is classified by [protected.py](/Users/darrellmiller/Documents/.wt-storehub/scripts/lib/protected.py), using [protected-paths.txt](/Users/darrellmiller/Documents/.wt-storehub/config/protected-paths.txt). New, unproven Paper behavior independently requires tier 3.

| Piece | Tier and kill switch | Test plan and read |
|---|---|---|
| **A. Hub geometry and registry** | Tier 2; proposed `STOREHUB_BUILD=off` | Blueprint/siting and container-discovery composition checks; observe accessible chests, preserved existing stock, signs, and construction progress. |
| **B. Bounded clerk and cargo recovery** | Tier 2 using established chest primitives; `STOREHUB_CLERK=off` | Classification, capacity, leases, reserve preservation, interrupted transfers; read verified moves, backlog, cargo age, losses, and clerk time. |
| **C. Consumer integration** | Tier 2 for unprotected search/deposit functions; `STOREHUB_SEARCH=off` | Known/stale/dirty/missing index cases, range coverage, fallback and visit caps; read search visits, successful draws, and crafts avoided. |
| **D. Hopper receiving** | **Tier 3** for unproven placement/receipt behavior; `STOREHUB_HOPPER=off` | Paper proofs above; read actual receipts, missed tosses, full-input incidents, and delivery latency. Disabling software cannot stop human tossing; provide a bot-operated physical closure and status sign. |
| **E. Sink integration and optional helper** | Tier 2 only with unchanged proven well/yard mechanics; separate `STOREHUB_SINKS=off` and `STOREHUB_HELPERS=off` | Policy composition, guarded throws, plant backlog, concurrent destinations; read routed counts, off-policy throws, and helper benefit. Changed movement/well mechanics make the relevant diff tier 3. |

Avoid `cognitive.mjs`, `admission.mjs`, `index.mjs`, and protected movement functions unless required. If necessary, classify honestly and schedule the dependency as tier 3. Each implementation still needs prescribed lint/preflight, the repository test runner, and its focused regression checks.

**5. Queue placement**

Finish **copper hall and signs first**, as ordered. Then showcase A→B→C, followed by E’s sink integration. Each tier-2 release gets its two-hour watch. The hub creates work relevant to expansion, but does not by itself justify going from 10 to 15 bots; confirm sustained useful backlog first.

Fleet A–C and eligible E are **owner-direct tier-2 rollouts**, not automatic new canary entries. Prefer after bagdiet, swimcentre, and bundle-1103a: those changes affect inventory and resource behavior and provide a better baseline. Deploy only between closed canaries, under the deploy lock, with the required 60-minute tripwire. Respect existing validator requirements.

Place D behind the currently committed progress work, including towngate and groundskeeper, in the **next eligible PROGRESS slot**. Do not append it immediately after another P. The supplied tail already lists consecutive P entries; the scheduler/operator must reconcile those with the owner’s P/S alternation. No second slot, no invented survival task, and no calendar promise from “3–4 canaries/day.”

D gets both-engine review and the required implementation-time source/issues search. Protected code must first follow fleet KEEP/promotion before showcase activation. Keep existing queued work and held serving operations separate.

Every rollout records its pinned rollback, check time, and outcome. Register an appropriate effect metric or explicit `none_reason`; read effects at +24/+72 hours. “KEEP, goal unverified” leaves the owner’s task open.

**6. Risks and owner choices**

The principal risks are cargo loss during interrupted transfers, misleading cache observations, inaccessible annex chests, intake congestion, and disposal-policy leakage. Snapshots protect recovery planning; code rollback does not remove constructed blocks or restore discarded items.

Three choices need explicit resolution before activation:

- **Policy:** allow temporary junk in designated intake chests?
- **Mechanism:** accept one hopper with bot distribution across 20 chests, or require unattended passive distribution and its larger iron budget?
- **Staffing:** approve one rotating clerk initially, with a second only when measured backlog warrants it?

My recommendation is the temporary-intake exception, one hopper, and one rotating clerk. Preserve uncertain items, route bulk to the yard, and earn additional automation through observed demand.