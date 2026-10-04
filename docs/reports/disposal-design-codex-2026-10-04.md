codex
One important correction: a surface dropper alone still allows Paper to merge an emitted item into a matching surface stack. The robust dry design needs its emission point below the merge envelope, with hoppers carrying items there internally. That is materially more expensive than a hand-toss pit; I’ll show the cost and keep the cheaper pit conditional on sandbox evidence.
codex
**1) Ranked recommendation**

**Keep composting; add a sealed dry disposal shaft for residual junk, with container-fed discharge below pickup and merge range.** Do not ship an open “toss and leave” pit.

| Rank | Mechanism | Assessment |
|---|---|---|
| 1 | Existing composting | First choice for supported plants. Already consumes items without creating a junk pile. |
| 2 | Enclosed dry shaft, fed below ground | General residual-junk sink; no hazardous material or biome dependency. Destruction is delayed, and safe feeding costs infrastructure. |
| 3 | Enclosed lava sink | Better throughput once lava is available. A bucket costs three iron, but finding and transporting lava is not guaranteed locally. Prevent bot access and fire spread. |
| 4 | Enclosed cactus sink | Effective on contact, but requires obtaining cactus and suitable placement. Desert/badlands dependence makes it an optional installation. |
| 5 | Productive ballast use | Prefer genuine scaffold/build/fill demand. Not a dependable sink for arbitrary inventory inflow. Never fill occupied tunnels or escape routes merely to empty bags. |
| 6 | Throwing eggs | Consumes eggs, but roughly 1/8 hatch probability creates chickens and eventually more eggs. An animal-management project, not clean general disposal. |

Fire and explosions destroy susceptible item entities but introduce collateral damage; the void requires dangerous, dimension-dependent access. Full hoppers/containers **stop accepting items; they do not delete them**. Do not assume campfires or magma are item incinerators. Lava is not universally destructive: netherite survives it. [Mojang’s netherite description](https://www.minecraft.net/en-us/article/taking-inventory--netherite-ingot)

**Live-code findings, at `56db2cd`:**

- `bots/src/hygiene.mjs:21` includes eggs, flint and both ink sacs, but **omits clay_ball and armadillo_scute**. Dirt/cobble/gravel are not blanket junk there.
- `neverPickUp`, at `hygiene.mjs:28`, filters pursuit only. `skills.mjs:1395` applies it when choosing a dropped entity; `skills.mjs:1358` invokes that sweep after collecting a block. It cannot reject server pickup.
- The test explicitly expects cobblestone to remain collectible: `bots/test/hygiene.test.mjs:48`.
- Composting requires both `NEVER_KEEP` membership and its compostability table: `composter.mjs:39`, `:66`. Execution verifies consumption around `skills.mjs:5038`; deterministic town scheduling is at `composter.mjs:550`.
- Cobblestone is a standing banking target, and scaffold reserves exist: `bankable.mjs:34`, `:80`. **“Not bankable” must not become “safe to destroy.”**

Start residual disposal with the owner’s exact eight item IDs: three eggs, flint, clay_ball, two ink sacs, armadillo_scute. Add decorations and surplus ballast only through explicit allowances protecting recipes, planting, scaffold and current work.

This review is read-only. `STATE.md` is absent from this checkout; the adjacent `../wt-main/docs/reports/STATE.md:114` records the composter promotion to `56db2cd`. Its withdraw warning at `:135` also matches the cursor problem below. This is an independent ChatGPT design, not a claim of completed Claude review.

**2) Exact geometry and pickup proof**

For player feet \(P=(p_x,p_y,p_z)\), standing-player pickup searches:

\[
[p_x-1.3,p_x+1.3]\times[p_y-0.5,p_y+2.3]\times[p_z-1.3,p_z+1.3].
\]

An item’s bottom-centre position \(I\), with a \(0.25^3\) bounding box, intersects when:

\[
|i_x-p_x|<1.425,\quad |i_z-p_z|<1.425,\quad -0.75<i_y-p_y<2.3.
\]

These are the live model’s constants: `bots/src/pickupbox.mjs:13–24`. Its execution predicate adds conservative slack (`:35`); use the **unslacked** bounds for containment analysis. Actual Paper behaviour remains a sandbox verification requirement.

Let the surrounding walking surface be **Y=64**:

| Shaft arrangement | Settled item bottom | Lowest relevant standing feet | Result |
|---|---:|---:|---|
| Three air blocks excavated below surface | 61 | Rim: 64 | Cannot pick up: ΔY = −3 |
| Same shaft; bottom slab in top cell, Y=63 | 61 | 63.5 | Cannot pick up: ΔY = −2.5 |
| Same; bottom-mounted closed trapdoor in Y=63 | 61 | 63.1875 | Cannot pick up: ΔY = −2.1875 |
| Same; full glass block in Y=63 | 61 | 64 | Cannot pick up: ΔY = −3 |

General rule: with floor at \(64-N\) and actual standing height \(S\), isolation from above requires **\(S-(64-N)\ge0.75\)**, with practical margin. Cover thickness changes standing height; opacity does not block pickup. An item landing **on** the cover remains collectible.

**Three deep therefore solves settled-item pickup from above. It does not solve admission, underground neighbours, or Paper merging.**

Paper 1.21.8 searches for merge partners with horizontal inflation \(R\), and normally vertical inflation \(R-0.5\). Thus item centres can merge across approximately \(R+0.25\) horizontally and \(R-0.25\) vertically. Its optional wall check and horizontal-only mode change this; merging also retains the younger age. [Paper 1.21.8 item source](https://raw.githubusercontent.com/PaperMC/Paper/ver/1.21.8/paper-server/patches/sources/net/minecraft/world/entity/item/ItemEntity.java.patch)

**Concrete conservative installation, qualified for measured \(R\le2.5\):**

- Central shaft occupies block column **X=0, Z=0**.
- Input chest: **(0,64,0)**.
- Four downward hoppers: **Y=63,62,61,60**.
- Downward-facing **dropper**, not dispenser: **Y=59**.
- Dry air: **Y=55–58**; items settle with bottom **Y=55**.
- Four-block solid side shell: outer footprint **X,Z=−4…4**, excluding the central mechanism/shaft.
- Four-block solid floor: **Y=51–54**.
- Solid surface deck around the input. No open hatch, fluid, piston, hopper beneath the output, or accessible underground cavity inside the shell.
- A protected redstone pulse connection operates the dropper; its wiring must preserve the shell. Bots drain a bounded batch and verify the dropper inventory fell.

This puts item emission roughly five blocks below surface and settled items nine below it. The side/floor shell also separates items from players and matching item entities in neighbouring caves. Transfers through chest/hoppers create no intermediate loose item.

**Cost:** four hoppers alone require **20 iron plus four chests**, followed by dropper and pulse wiring. That is the price of eliminating both exposed tossing and near-surface merge escape. Natural solid terrain can provide much of the shell. This is portable survival construction, but **not immediately buildable by every full, resource-poor bot**. Use a builder with materials and inventory room; otherwise retain the junk.

For larger merge radii, enlarge the shell and lower emission accordingly; do not silently assume defaults. The two relevant Paper options currently default false in the documentation. [Paper configuration](https://docs.papermc.io/paper/reference/world-configuration/)

The guarantee is conditional on an intact, surveyed structure and verified server mechanics. No survival structure guarantees containment against a player deliberately dismantling it or plugins changing pickup.

**Site and movement design:** select one sticky, world/dimension/home-keyed site, 8–16 blocks from home, clear of bank access and existing works; reject unknown terrain, liquids and cavities. The existing pattern uses configured home coordinates (`config.mjs:139`), deterministic site selection (`composter.mjs:260`), and a shared generation record (`skills.mjs:4918`, `composter.mjs:395`). Live banking itself scans containers near the bot (`skills.mjs:2424`, `:5276`), so it is not an authoritative town-site registry.

Use coordinate-based step/break/place exclusions, plus hard rejection of neighbours and swept movement through the protected volume. `blocksToAvoid` is a block-type set, not a coordinate region. [Pathfinder implementation](https://raw.githubusercontent.com/PrismarineJS/mineflayer-pathfinder/master/lib/movements.js)

Cover **every** movement profile and direct dig/place/reflex path: base exclusions are at `index.mjs:489`, water replaces that array at `:679`, and tunnels clone exclusions at `oretunnel.mjs:188`. The repository already documents a drop-down bypass of step exclusions and supplies a neighbour-filter pattern at `composter.mjs:657–683`.

**3) Failure modes and withdraw integration**

- **Re-collection during a toss:** depth does not protect the item before it falls. The proposed container feed removes that exposure.
- **Cross-wall merging:** a surface dropper alone is insufficient. Matching outside stacks can receive its output. Qualify the entire emitted trajectory, not only the final floor.
- **Items escaping a 1×1 shaft:** ordinary item accumulation does not form a rising physical pile. Water, pistons, falling blocks, block placement overlapping entities, explosions and collision-ejection behaviour can move items. Never seal by placing a block into the item pile. These are external-behaviour cases to test.
- **Falling bots/mobs:** use a permanent solid deck, not a pathfinder-only prohibition. Enclose and spawn-proof the chamber. Loot-picking mobs can interrupt item ageing or transport junk.
- **Unloaded chunks:** items do not age while unloaded. Five minutes means **6,000 ticking game ticks**, not five wall-clock minutes. Lag, unloads, merge rejuvenation and cancelled despawn events extend residence.
- **Blocked feeder:** stopped redstone or a full dropper turns this into storage. Record `queued`, `emitted`, and `despawned` separately; inventory loss is not proof of destruction. Stop admissions when draining cannot be verified.
- **Builder bootstrap:** digging generates more items. Construction must be a separate, capacity-checked job with an exit; a 36-slot bot must not dig itself into its own disposal site.

**The junk swap can use disposal, but make room before withdrawing.**

Normal sequence: inspect chest → leave cursor empty → close → walk to disposal → transfer and drain one approved whole junk stack → verify free capacity → return → reopen and revalidate the wanted item → withdraw. No valuable item waits on a cursor during travel. Do not require the bot to wait five minutes for despawn.

The older branch rejects full inventories and advises “deposit or drop” (`origin/withdraw-home:bots/src/skills.mjs:3824`). The newer branch’s swap exchanges a **bankable** stack into the chest, not a disposal mechanism (`origin/wd-on-6c9a8fb:bots/src/withdrawpick.mjs:117`; `skills.mjs:6264`).

For an **already loaded cursor hold**, walking away is unsafe:

- Keep inventory ownership and settle pending clicks; first return the cursor to verified capacity.
- If both inventories are full, a helper with free capacity can withdraw a legitimate chest stack, creating a return slot. The helper may obtain its own capacity from disposal first.
- Do not treat “close after 30 seconds” or “walk while holding junk on cursor” as disposal.
- If recovery fails, report an unresolved transaction; a disconnect/death can still spill it. Survival release remains an emergency loss path, never a successful disposal.

The branch currently guards inventory operations and retries settlement every second (`skills.mjs:5965`); survival release can close loaded (`:6025`). Its separate **anti-redeposit hold** should start only after confirmed receipt; that branch defines ten minutes (`withdrawpick.mjs:218`, `bankable.mjs:211`).

**4) Paper 1.21.8 sandbox experiment**

Build through survival actions using gathered resources. Record exact Paper build, plugins, merge settings and despawn settings. Read-only server observation may measure entity positions, counts, ages and removal causes.

| Trial | Numeric pass/fail |
|---|---|
| Pickup positive control | **20/20** accessible drops collected after pickup delay. Otherwise the collection instrument is invalid. |
| Geometry | Three-deep rim, slab, trapdoor and glass cases: **100 item batches per arrangement**, bots with free slots circling/crossing; **0 collected** from the floor. Include a deliberately shallow collectible case. |
| Recommended feeder | **100 batches totalling ≥1,000 items**, every approved item type represented; **0 escaped, 0 collected, 0 keepers consumed**, exact count reconciliation. |
| Merge adversary | Matching partial stacks above, beside and below; reverse stack sizes and ages. **0 outbound merges** at deployed settings. Deliberately vulnerable fixture must demonstrate the detector catches a merge. |
| Despawn | Stop feeding after the last emission. All residual items disappear by **6,100 ticking ticks** at a configured 6,000-tick lifetime; every disappearance classified. |
| Unload | After about 1,000 active ticks, unload for ten minutes. Age should resume near its previous value on reload; disappearance must follow remaining active time, not elapsed wall time. |
| Breakage/recovery | **20 interruptions** spanning feeder stalls, reconnects, aborted transfers and shell damage: **0 keeper loss**, no duplicate transfer, damaged installation accepts no further junk. |
| Movement | **1,000 approaches/crossings**, including different profiles and pushes: **0 chamber entries or shell modifications**. |

Egg hatching probabilities, exact dropper emission/throughput, item ejection and destruction timing for lava/cactus remain **external-behaviour claims requiring verification on this build**. Do not assert lava burns literally instantaneously from every trajectory.

I searched upstream source, issues and discussions. Mineflayer’s reported full-inventory withdraw dropping reinforces the need for server-counted transfers; it does not establish disposal safety. [Withdraw issue](https://github.com/PrismarineJS/mineflayer/issues/2020), [toss discussion](https://github.com/PrismarineJS/mineflayer/discussions/2761)

**5) One-variable, five-bot canary**

Branch from **`56db2cd`**, not either withdraw branch. Treatment: **residual-disposal service enabled**. Keep composting, pickup policy and withdraw behaviour unchanged; withdraw integration gets a later experiment.

- Randomly select **one five-bot pool** from eligible pools containing pressured bags with approved residual junk; remaining **75 bots** are control. Record cross-pool use of the structure as contamination.
- Obtain **six hours baseline**, then six hours treatment, with reads at +3h and +6h. Extend to +24h only for insufficient exposure.
- Minimum evidence: **30 completed visits across all five bots**, and complete inventory samples for ≥90% of expected bot-minutes. Below that: **INCONCLUSIVE**.
- Primary gates: difference-in-differences of occupied slots **≤−2 slots/bot** and share of observations at ≥34 slots **≤−15 percentage points**. Require consistent direction in both three-hour treatment windows; report uncertainty, not just point estimates.
- Guardrails: productive gathering per bot-hour DiD ratio **≥0.90**; disposal consumes **≤5% of treatment bot-time**; ≥95% of admitted batches drain within **120 seconds**.
- Immediate stop: any verified keeper destruction, junk re-collection/escape, chamber entry, or false disposal success. Generic death gate follows `CLAUDE.md`: **at least two canary deaths and >1.25× control rate**; report one death without automatically declaring failure.
- Use `scripts/lib/telemetry.py`, full log walks and actual bot-hour denominators. Prove detection with positive controls. Record **KEEP / REVERT / INCONCLUSIVE**, then complete all three teardown steps.

A town-only canary cannot establish relief for bots that never reach town; report that eligible-but-unserved denominator.

**6) Owner questions**

1. Does **contained vanilla despawn** count as acceptable disposal, or must junk be destroyed immediately?
2. Is the robust feeder’s **20-iron-plus-redstone cost** acceptable, or should enclosed lava be preferred once acquired?
3. Confirm the initial eight-item allowlist; what exact reserves permit later disposal of ballast and decorations?
4. For an unrecoverable loaded cursor, is **helper rescue followed by an explicit unresolved alert** the preferred policy, retaining survival release as the emergency exception?
tokens used
125,836
**1) Ranked recommendation**

