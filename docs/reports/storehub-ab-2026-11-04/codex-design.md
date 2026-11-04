codex
**Blockers first.** At `7bc965ca`, three assumptions need correction before A/B ships:

- The measured ring site cannot satisfy “extend the storehouse” visually by itself.
- Registry membership alone cannot fix discovery: scans remain radius-limited, and observation/search paths independently reject distant containers.
- Existing bag keeps do not protect clerk cargo across all disposal, deposit and yard paths. A durable cargo file needs execution guards.

I read the approved document from `origin/main` and inspected this checkout. No files changed.

**1. Build the 9 × 5 annex and treat the existing storehouse plus annex as one storage hall.**

Use the free strip `x=-27..-19, z=-4..0`. A one-storey layout can hold eight single chests: two rows at `z=-3,-1`, with chest columns `x=-26,-24,-22,-20`; the central aisle is `z=-2`. Keep lids clear and put the entrance on the storehouse-facing end. Validate approach, standing cells and sign supports before reserving it; the supplied ground measurement does not prove those.

Eight new chests plus nine existing ones give **17 containers / 459 slots**, versus 178 currently occupied. Allocate eight requested groups, each with a named overflow, plus **UNSORTED**. Explicitly map additional materials such as fuel, valuables and earth into those destinations; do not silently classify them as junk.

This changes the place the owner actually visits: bots build the annex, relabel the existing containers and consolidate their contents. Give both buildings matching signs and a visible “SORTED STORAGE” entrance. Existing chests remain usable during construction.

A roof extension introduces stairs, support and access work not established by the siting proof. Merely adding containers lacks the requested visible project. The ring site is buildable, but outside the wall and 35 blocks from the storehouse; reject it for this release. The annex deliberately replaces §3.1’s larger standalone layout.

**2. Add explicit container membership and enumeration; leave `chestfull.mjs inTown` geometric.**

`inTown` describes positions of bots and construction sites as well as containers. Broadening it would change unrelated recovery and deposit behaviour.

Introduce a registry helper with two operations:

- `isTownContainer(home, position)`: existing boundary **or an explicitly registered container**.
- `townContainerKeys(home)`: discovered town containers **union registered keys**, canonicalized for double chests.

Scope records by pool/world/home; register only verified placed containers. Preserve registry knowledge when unloaded, but mark coverage incomplete. Only a loaded block read can establish that a chest disappeared. Include registry generation in the existing **20-second** scan cache key.

Wire both operations into `skills.mjs`:

- `townCobbleScan`: directly add registry coordinates; its current **20-block** scan sphere cannot discover a chest 46 blocks away.
- `cobbleObserve`, `townIndexed`, stock admission, recount and container-memory filters: replace container-specific `inTown` gates.
- `townSearchView`: consume the union; unloaded registered candidates must not become proof that the town lacks an item.
- `townContainers`: union registered candidates while retaining the caller’s reach and visit limits.

With only `townCobbleScan` changed, **stock observations and town-index writes still miss the hall**. With only observation gates changed, **withdraw/kit discovery still misses it**. Additional holdouts include the generic withdrawal iterator around line 11596, deposit recovery’s near-home scan, recount/index candidate filters and composter storage-distance checks. Piece C’s search ranking cannot repair missing candidates.

View-distance 8 and simulation-distance 6 do not override these application filters or guarantee a loaded block.

**3. Keep working stock locally; separate delivery trips from junk trips.**

Keep **320 cobblestone** in the original STONE chest, shared with the yard’s existing policy: `yard.mjs YARD_CHEST_KEEP=320`, refill below **256**, yard visits limited to **64 blocks**. Do not create another 320-item reserve in the annex. Leave excess cobble migration to the yard clerk; its chest withdrawal currently handles cobblestone only. Keep the 62 deepslate in sorted stone storage until an explicit handoff supports it.

Move other misplaced stock to its group or item home, then that group’s overflow. Unknowns go to UNSORTED. Plants use the approved **64/sapling type, 128 bamboo, 32/flower type** caps; **the doc covers it**, including approved surplus composting.

Use one source and one destination class per visit:

- retained cargo: **source → hall → return if refused**;
- disposable cargo: **source → existing well → return if refused**;
- yard work: its separate existing visit.

Avoid carrying tools and ingots to the well unnecessarily. For the rejected ring layout, the well-to-hall leg alone is roughly **55–65 blocks**; source→well→hall is a poor universal route.

Keep the document’s **90-second, six-stack maximum**, with **four free slots**. Stop taking new cargo early enough to attempt delivery or return. An interrupted visit may retain cargo durably; it must not claim completion.

**4. Protect entrusted cargo at execution, including after interruption.**

The doc covers durable intent-before-click, verified transfers, lease fencing and initially avoiding stackable kinds already in the bag. Retain those rules.

The smallest robust addition is a shared **pending-cargo guard**, checked before ordinary `deposit`, `town_deposit`, well/pit disposal, prune, sort tidy and yard work. Pending cargo permits cargo recovery and essential safety actions; it blocks ordinary bag-consuming work. Lease expiry must not remove cargo protection.

Specific hazards:

- `disposeWell` accepts `keep` only for `visit:true`; `throwPhase` ignores it outside `listedOnly`. Normal disposal can throw swords, capped cobble and stock surplus.
- `townKeeps` has no arbitrary cargo-count argument.
- `yardVisit` can craft bamboo and place bag surplus before any hub handoff.
- `sortPut` transfers whole stacks above a personal floor; merged cargo needs a verified count-bounded transfer.
- Death invalidates in-flight transfer assumptions. Reconcile the journal against the server inventory after respawn; never mark missing cargo delivered. Recover retained cargo if present, otherwise record unresolved loss.

Implement clerk disposal as an explicit cargo-count plan, rechecked immediately before each throw. Enforce `HUB_THROWABLE`, all reserve/project guards and the **64-item stone guard**; disable sword, cobble-cap and stock-surplus extensions. Preserve existing well exclusion and closure checks.

**5. Other A/B corrections.**

`sortstore.mjs sortHomes` understands existing group homes and shared overflow—not item homes, plants, review or per-group overflow. `depositOrder` only ranks candidates; `acceptsFor` permits broad fallback mixing. Both need explicit hub routing to achieve purity.

`townindex.mjs GROUP_ORDER` has ten legacy groups, but no distinct food/plants groups; `farm` mixes foods, seeds and plants. Add a hub classifier without casually changing stock accounting categories.

Finally, replace “100 moves/day” and “at most two duplicated kinds” as acceptance requirements: finite migration may finish below 100, while working stock and legitimate overflow create duplicates. Measure verified migration completion, destination purity, unresolved cargo and **zero kept-item throws**.
tokens used
50,244
**Blockers first.** At `7bc965ca`, three assumptions need correction before A/B ships:

- The measured ring site cannot satisfy “extend the storehouse” visually by itself.
- Registry membership alone cannot fix discovery: scans remain radius-limited, and observation/search paths independently reject distant containers.
- Existing bag keeps do not protect clerk cargo across all disposal, deposit and yard paths. A durable cargo file needs execution guards.

I read the approved document from `origin/main` and inspected this checkout. No files changed.

**1. Build the 9 × 5 annex and treat the existing storehouse plus annex as one storage hall.**

Use the free strip `x=-27..-19, z=-4..0`. A one-storey layout can hold eight single chests: two rows at `z=-3,-1`, with chest columns `x=-26,-24,-22,-20`; the central aisle is `z=-2`. Keep lids clear and put the entrance on the storehouse-facing end. Validate approach, standing cells and sign supports before reserving it; the supplied ground measurement does not prove those.

Eight new chests plus nine existing ones give **17 containers / 459 slots**, versus 178 currently occupied. Allocate eight requested groups, each with a named overflow, plus **UNSORTED**. Explicitly map additional materials such as fuel, valuables and earth into those destinations; do not silently classify them as junk.

This changes the place the owner actually visits: bots build the annex, relabel the existing containers and consolidate their contents. Give both buildings matching signs and a visible “SORTED STORAGE” entrance. Existing chests remain usable during construction.

A roof extension introduces stairs, support and access work not established by the siting proof. Merely adding containers lacks the requested visible project. The ring site is buildable, but outside the wall and 35 blocks from the storehouse; reject it for this release. The annex deliberately replaces §3.1’s larger standalone layout.

**2. Add explicit container membership and enumeration; leave `chestfull.mjs inTown` geometric.**

`inTown` describes positions of bots and construction sites as well as containers. Broadening it would change unrelated recovery and deposit behaviour.

Introduce a registry helper with two operations:

- `isTownContainer(home, position)`: existing boundary **or an explicitly registered container**.
- `townContainerKeys(home)`: discovered town containers **union registered keys**, canonicalized for double chests.

Scope records by pool/world/home; register only verified placed containers. Preserve registry knowledge when unloaded, but mark coverage incomplete. Only a loaded block read can establish that a chest disappeared. Include registry generation in the existing **20-second** scan cache key.

Wire both operations into `skills.mjs`:

- `townCobbleScan`: directly add registry coordinates; its current **20-block** scan sphere cannot discover a chest 46 blocks away.
- `cobbleObserve`, `townIndexed`, stock admission, recount and container-memory filters: replace container-specific `inTown` gates.
- `townSearchView`: consume the union; unloaded registered candidates must not become proof that the town lacks an item.
- `townContainers`: union registered candidates while retaining the caller’s reach and visit limits.

With only `townCobbleScan` changed, **stock observations and town-index writes still miss the hall**. With only observation gates changed, **withdraw/kit discovery still misses it**. Additional holdouts include the generic withdrawal iterator around line 11596, deposit recovery’s near-home scan, recount/index candidate filters and composter storage-distance checks. Piece C’s search ranking cannot repair missing candidates.

View-distance 8 and simulation-distance 6 do not override these application filters or guarantee a loaded block.

**3. Keep working stock locally; separate delivery trips from junk trips.**

Keep **320 cobblestone** in the original STONE chest, shared with the yard’s existing policy: `yard.mjs YARD_CHEST_KEEP=320`, refill below **256**, yard visits limited to **64 blocks**. Do not create another 320-item reserve in the annex. Leave excess cobble migration to the yard clerk; its chest withdrawal currently handles cobblestone only. Keep the 62 deepslate in sorted stone storage until an explicit handoff supports it.

Move other misplaced stock to its group or item home, then that group’s overflow. Unknowns go to UNSORTED. Plants use the approved **64/sapling type, 128 bamboo, 32/flower type** caps; **the doc covers it**, including approved surplus composting.

Use one source and one destination class per visit:

- retained cargo: **source → hall → return if refused**;
- disposable cargo: **source → existing well → return if refused**;
- yard work: its separate existing visit.

Avoid carrying tools and ingots to the well unnecessarily. For the rejected ring layout, the well-to-hall leg alone is roughly **55–65 blocks**; source→well→hall is a poor universal route.

Keep the document’s **90-second, six-stack maximum**, with **four free slots**. Stop taking new cargo early enough to attempt delivery or return. An interrupted visit may retain cargo durably; it must not claim completion.

**4. Protect entrusted cargo at execution, including after interruption.**

The doc covers durable intent-before-click, verified transfers, lease fencing and initially avoiding stackable kinds already in the bag. Retain those rules.

The smallest robust addition is a shared **pending-cargo guard**, checked before ordinary `deposit`, `town_deposit`, well/pit disposal, prune, sort tidy and yard work. Pending cargo permits cargo recovery and essential safety actions; it blocks ordinary bag-consuming work. Lease expiry must not remove cargo protection.

Specific hazards:

- `disposeWell` accepts `keep` only for `visit:true`; `throwPhase` ignores it outside `listedOnly`. Normal disposal can throw swords, capped cobble and stock surplus.
- `townKeeps` has no arbitrary cargo-count argument.
- `yardVisit` can craft bamboo and place bag surplus before any hub handoff.
- `sortPut` transfers whole stacks above a personal floor; merged cargo needs a verified count-bounded transfer.
- Death invalidates in-flight transfer assumptions. Reconcile the journal against the server inventory after respawn; never mark missing cargo delivered. Recover retained cargo if present, otherwise record unresolved loss.

Implement clerk disposal as an explicit cargo-count plan, rechecked immediately before each throw. Enforce `HUB_THROWABLE`, all reserve/project guards and the **64-item stone guard**; disable sword, cobble-cap and stock-surplus extensions. Preserve existing well exclusion and closure checks.

**5. Other A/B corrections.**

`sortstore.mjs sortHomes` understands existing group homes and shared overflow—not item homes, plants, review or per-group overflow. `depositOrder` only ranks candidates; `acceptsFor` permits broad fallback mixing. Both need explicit hub routing to achieve purity.

`townindex.mjs GROUP_ORDER` has ten legacy groups, but no distinct food/plants groups; `farm` mixes foods, seeds and plants. Add a hub classifier without casually changing stock accounting categories.

Finally, replace “100 moves/day” and “at most two duplicated kinds” as acceptance requirements: finite migration may finish below 100, while working stock and legitimate overflow create duplicates. Measure verified migration completion, destination purity, unresolved cargo and **zero kept-item throws**.
