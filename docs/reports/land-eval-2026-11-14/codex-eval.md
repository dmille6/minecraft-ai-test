**My verdict is RESTRUCTURE AROUND A NEW CORE.** Keep the bot execution machinery and useful safety checks. Replace the authority that decides what ground belongs, which changes are repairs, and whether a repair is complete.

I reviewed `.wt-roofclimb/` at commit `46286e9e3c3fd9bf1793585ca055f13df2bcb091`. I made no changes, ran no tests, and contacted no host. Code references below are relative to `.wt-roofclimb/bots/src/`; evidence references mean `docs/reports/land-eval-2026-11-14/evidence.md`.

**1. How the present approach works**

Detection starts with a surface model. `tidyColumn` scans downward to the highest eligible solid block, passing vegetation and rejecting unread, wet, or certain built columns. “Spoil” is a material list including dirt, grass, cobblestone and planks; it is not proof of who placed a block. The original survey identifies raised columns and depressions relative to surrounding heights (`tidy.mjs:43–55,95–109,197–247`).

The newer rough survey adds floating runs, connected clumps and holes, smoothing, lawn resurfacing, recorded scaffold and expired takeback handoffs. Its connected-hole rule allows nine columns, a four-block-wide box and four blocks of depth. Floating detection also depends on height above a local median. Buildings, reservations and neighbouring columns restrict work (`roughground.mjs:45,98–118,133–170,285–373,409–483`). Wider regrading is present, so this is not merely a nine-cell-hole system; it still derives targets from existing surface heights (`roughground.mjs:504–521`; `regrade.mjs:38–83`).

Planning turns cuts and fills into project records. Fills are grouped, layered bottom-up and linked by dependencies; cuts carry expected block names. Special hollow fills retain the cut that opens them. An hourly refresh can append fresh work while excluding busy, guarded and already-known cells (`tidy.mjs:320–347`; `tidyrefresh.mjs:49–52,78–105`). Keeper leases and newer backlog-based quotas assign work to bots (`groundskeeper.mjs:46–58`; `grounds2.mjs:35–63`).

Execution uses the shared builder. It searches for reachable stands and usable placement faces, walks, digs and places through bot effects, and probes uncertain dig outcomes. Tidy cuts recheck water, bodies, footing and hollow occupancy (`buildsite.mjs:706–744`; `buildrun.mjs:797–816,1424–1455`; `skills.mjs:29016–29021`).

Stopping combines physical progress with administrative exceptions. Cuts can be given up after three evaluated visits; fills can be waived after two deferring visits, within a quota. Expired handed-off cuts cease counting as standing. Stage completion uses those adjusted progress counts, plus additional holds (`tidy.mjs:351–375,1815–1826`; `skills.mjs:29173–29175`).

Prevention filters pathfinder placements inside a defined town zone, but releases the ban following repeated failures. Gathering has a separate terrain restriction. Scaffold handoffs preserve some cleanup responsibility, but only temporarily (`cleanzone.mjs:55–63,158–199,293–297`; `litter.mjs:58–65,75–91`).

**2. Assessment against the evidence**

There is worthwhile machinery here. The current window records 718 cobblestone and 261 dirt placements for tidy, plus 49 grass-block cuts among the most common details. That establishes actual work, although it does not establish that every change was desirable (`evidence.md:220–227`). Stand and face checking, uncertain-result probing, and immediate safety checks are sensible foundations (`buildsite.mjs:706–744`; `buildrun.mjs:797–816`; `skills.mjs:29021`).

The failures fall into different categories.

**The intended ground is undefined: a model failure.** The capsule contains 791 depressed columns in 368 pits, requiring 2,416 blocks under the scorecard’s rule. Several large examples have almost no planned coverage (`evidence.md:19–34`). More decisively, it records 26,116 air blocks beneath ground tops (`evidence.md:36–49`).

Those measurements do not prove that every cavity should be filled. They prove that surface height alone is insufficient. A flat artificial deck and solid natural ground can present the same surface to `tidyColumn`; floating detection only investigates qualifying elevated runs, while hollow repair is attached to particular cuts (`tidy.mjs:95–109`; `roughground.mjs:98–118,181–191,338–346`). Wider regrading can preserve unsafe-to-cut columns as anchors and fit surrounding ground to them (`regrade.mjs:95–122`). Consequently, accumulated mess can become the reference surface for subsequent repairs.

**“Does not belong” is approximated by shape and material: another model failure.** Natural dirt and placed dirt are indistinguishable to the spoil list. Recorded scaffold improves certainty, but even that branch refuses scaffold at or below surrounding ground. Handoff intake similarly drops blocks classified as “in_ground” (`tidy.mjs:45`; `roughground.mjs:425–440`; `litter.mjs:118–131`).

The current logs show handoffs dropped for `in_ground`, `built_on` and `record_col` (`evidence.md:104–110`). These are defensible immediate safety decisions. They are not sufficient grounds for concluding that the underlying cleanup obligation disappeared. A bot-made block may have acquired a legitimate supporting role; deciding whether to retain, replace or remove it requires explicit intent.

**Bots cannot reliably execute recognised work: partly fixable limits, partly job design.** The 30-hour window contains 540 temporary-stand refusals for `no_step`, 780 ordinary deferrals, another 138 blocked deferrals and 63 stuck-cell rows (`evidence.md:220–226`). The capsule still has 2,181 open cells among 5,790 recorded tidy fills (`evidence.md:17`).

Better access planning and inventory preparation can improve this in place. However, layering fills does not itself prove that every operation remains reachable throughout construction. The runner searches for access during execution and defers unavailable cells; dependencies can then hold later work (`tidy.mjs:320–340`; `buildrun.mjs:1433–1434,1477–1480`). A repair job should include its access sequence and safe stopping states.

**Administrative completion is weaker than repair: a model failure.** Waivers are necessary to prevent endless retries, but they must remain unresolved obligations. Here, given-up cuts contribute to `cutDone`, waived fills can count as finished, and scaffold handoffs expire after three hours (`tidy.mjs:355–373`; `litter.mjs:58–65`; `tidyrefresh.mjs:176–190`). The capsule contains 40 waived entries (`evidence.md:14`).

Refresh also refuses already-known coordinates, including waived ones, so an hourly refresh is not a general repair of stale obligations (`tidyrefresh.mjs:83–98`). That policy is fixable locally, but the larger issue is the meaning of completion.

**Prevention is useful but does not close the loop.** Current takeback rows include 1,524 dirt-pillar removals and 1,015 dirt-step removals, alongside 1,441 expired pillars and 1,421 expired steps. These selected rows concern the `out` zone, so they are not a town-wide recovery percentage (`evidence.md:128–134`). Cleanzone also logs hundreds of timeout and no-path releases (`evidence.md:92–99`), consistent with its implemented escape valve (`cleanzone.mjs:158–179`).

The historical note’s “no retract rows” claim must therefore not be treated as current fact (`evidence.md:626`). Nevertheless, escape placement needs durable follow-up, not expiring responsibility. That is a lifecycle defect.

**3. The design I would choose**

I would build an offline, read-only planner with a persistent repair ledger. Its inputs would be timestamped save snapshots, CoreProtect history, project plans and completed records, temporary-support receipts, and bot observations. Every observation would retain its source, time and uncertainty.

The central object would be a **three-dimensional desired-state record**, rather than one preferred height per column. It would describe intended surface, required support, protected voids, water, buildings, access routes and temporary structures. A height map would remain useful for shaping lawns, but would not decide ownership or whether an underground space belongs.

For course B, capture untouched terrain before work. Preserve that baseline outside explicitly approved plot and access changes. Inside a plot, record the intended modification before bots start.

For course A, reconstruct changes where history permits. Classify cells as natural, intentional construction, temporary work, unintended modification or unknown. Bot placement alone would not mean junk: buildings and legitimate repairs are bot-made too. No history would mean unknown, not natural. Account for grass spreading, falling blocks and other changes that complicate coordinate history.

For the town’s raised crust, first decide which surfaces are intentional. Retain and support approved streets or lawns where necessary; remove demonstrably temporary decking where the underlying terrain should remain. Preserve caves and intentional tunnels. I would not adopt “fill every cavity” from the final evidence note: its proposed explanation is explicitly unproven (`evidence.md:652`).

Cut work into small spatial jobs: one pillar, one connected pit section, or one accessible pocket beneath a retained surface. Start with perhaps 8–24 mutations per job, then tune using measurements. Every job would include materials, tools, entry route, standing positions, operation dependencies, exit route, temporary supports and teardown.

Simulate each intermediate state. Filling a pit must not seal the only remaining placement face. Removing scaffold must not remove the worker’s exit. Larger repairs would have durable checkpoints; travel, resupply and active work would receive separate budgets.

Bots would revalidate expected blocks and job versions before mutations. Changed conditions would trigger replanning. A blocked job would name its missing prerequisite without blocking unrelated work.

Acceptance would require a fresh world read: required blocks present, removals absent, retained support correct, temporary structures removed, protected cells unchanged, and access preserved. Outcomes would be `accepted`, `blocked`, `cancelled by changed intent`, or `needs review`. Exhausted retries would never mean accepted.

Prevention would use the same ownership system. Every temporary placement would create a durable obligation; every emergency dig would record the displaced state. Recovery would remain available, but its cleanup debt would survive restarts and age. Repeated emergency changes at one location would trigger a permanent access job.

I would reuse the stand/face solver, confirmed mutation machinery, reservations and lease mechanisms (`buildsite.mjs:157–199,706–744`; `buildrun.mjs:797–816,1458–1459`). I would also reuse site preparation’s before/after walk check and actual-world acceptance pattern (`siteprep.mjs:379–411,549–551`). Existing shape detectors would propose candidates, not authorise repairs independently.

**4. Why this verdict**

The three strongest reasons for **RESTRUCTURE AROUND A NEW CORE** are:

1. Surface-relative rules cannot reliably distinguish natural ground, accumulated artificial ground and intentional voids. The measured hollows make this a central problem, not an edge case.
2. Retry exhaustion and receipt expiry can remove work from completion accounting without repairing it (`tidy.mjs:351–373`; `litter.mjs:58–65`).
3. The execution foundation already performs useful physical work, so discarding everything would waste demonstrated capability (`evidence.md:220–227`; `buildrun.mjs:797–816`).

The strongest argument against my verdict is that access failures may dominate practical performance. Better stands, smaller jobs and scheduling improvements could produce substantial gains without a new world model. The 540 failed stand attempts support that argument. However, faster execution cannot answer whether a deck should be removed or supported, or whether natural dirt belongs. Those decisions need a different authority.

**5. The first three things to build**

1. **Build the observation model and independent acceptance scorer.** Produce proposed classifications and desired-state differences without issuing work. On A, manually adjudicate representative pits, pillars, crusts and legitimate structures. Measure correct detections, missed repairs and harmful proposals. On B, require zero cleanup proposals on untouched terrain outside declared alterations. Keep uncertain cells visible.

2. **Build durable mutation obligations and prevention.** Record temporary placements and emergency digs, including their purpose and repair owner. On fresh B copies, exercise ordinary travel, construction, recovery and restart. Every incidental mutation must remain accounted for until independently verified as restored or intentionally adopted. Compare new unresolved mess per bot-hour and successful travel against the baseline; inactivity must not count as prevention.

3. **Build one complete repair executor around small jobs.** Cover an ordinary pit, a pit over the old size limit, a floating pillar and an accessible under-deck pocket. Run on restored A copies with fixed bot-hours and materials. Require accepted repairs, zero protected-cell damage, safe exits, teardown and restart recovery. Report remaining blocked work separately. Repeat on B with known injected mess to measure both restoration and preservation.

**6. What I could not establish**

I could not establish the historical origin of the widespread crust, completeness of CoreProtect history, or the correct intended surface throughout the town. The hollow measurements are not a labelled inventory of unwanted cavities.

The grouped logs do not provide unique-cell histories or a matched before/after experiment. They therefore cannot establish net cleanup rate, causal effects of individual releases, or the current balance between new damage and repair.

I confirmed the checkout commit, but not runtime switches or deployment consistency across the measurement window. I inspected tests without running them. This is a design assessment supported by static code and supplied evidence, not a demonstrated replacement’s performance result.
